from __future__ import annotations

import asyncio
import ipaddress
import socket
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import psutil
import requests


class ScannerError(RuntimeError):
    pass


class ScannerPermissionError(ScannerError):
    pass


try:
    from zeroconf import Zeroconf, ServiceBrowser
except ImportError:
    Zeroconf = None
    ServiceBrowser = None

@dataclass
class Device:
    ip: str
    mac: str
    vendor: Optional[str]
    last_seen: datetime
    ping_ms: Optional[float]
    bandwidth_bps: float = 0.0
    os_ttl: Optional[int] = None
    hostname: Optional[str] = None
    upnp_model: Optional[str] = None
    nmap_os: Optional[str] = None
    ping_history: List[float] = field(default_factory=list)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _detect_local_subnet() -> Tuple[ipaddress.IPv4Network, str]:
    """
    Returns (IPv4Network, interface_name).
    Picks the first UP, non-loopback interface with an IPv4 + netmask.
    """
    if_addrs = psutil.net_if_addrs()
    if_stats = psutil.net_if_stats()

    candidates: List[Tuple[str, str, str]] = []
    for if_name, addrs in if_addrs.items():
        stats = if_stats.get(if_name)
        if not stats or not stats.isup:
            continue
        for a in addrs:
            if a.family != socket.AF_INET:
                continue
            ip = a.address
            netmask = a.netmask
            if not ip or not netmask:
                continue
            if ip.startswith("127."):
                continue
            candidates.append((if_name, ip, netmask))

    if not candidates:
        raise ScannerError(
            "Could not auto-detect local IPv4 subnet. Ensure you are connected to a network."
        )

    # Prefer interfaces that look like Wi-Fi/Ethernet on Windows/Linux.
    preferred = ("wi-fi", "wifi", "wlan", "ethernet", "eth", "en", "wlp")
    candidates.sort(
        key=lambda t: (
            0
            if any(p in t[0].lower() for p in preferred)
            else 1,
            t[0].lower(),
        )
    )
    if_name, ip, netmask = candidates[0]

    network = ipaddress.IPv4Network((ip, netmask), strict=False)
    return network, if_name


_VENDOR_CACHE_LOCK = threading.Lock()
_VENDOR_CACHE: Dict[str, Optional[str]] = {}


def _normalize_mac(mac: str) -> str:
    return mac.strip().lower().replace("-", ":")


def _lookup_vendor(mac: str) -> Optional[str]:
    """
    Best-effort vendor lookup with small in-memory cache.
    Uses a public endpoint; failures return None (unknown vendor).
    """
    mac_n = _normalize_mac(mac)
    if not mac_n:
        return None

    with _VENDOR_CACHE_LOCK:
        if mac_n in _VENDOR_CACHE:
            return _VENDOR_CACHE[mac_n]

    vendor: Optional[str] = None
    try:
        # Lightweight public API (best-effort). Keep timeout small so scans stay fast.
        r = requests.get(f"https://api.macvendors.com/{mac_n}", timeout=1.0)
        if r.status_code == 200:
            v = (r.text or "").strip()
            vendor = v or None
    except Exception:
        vendor = None

    with _VENDOR_CACHE_LOCK:
        _VENDOR_CACHE[mac_n] = vendor
    return vendor


def _netbios_lookup(ip: str) -> Optional[str]:
    pkt = (
        b'\x12\x34\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00'
        b'\x20\x43\x4b\x41\x41\x41\x41\x41\x41\x41\x41\x41\x41\x41\x41\x41\x41'
        b'\x41\x41\x41\x41\x41\x41\x41\x41\x41\x41\x41\x41\x41\x41\x41\x41\x00'
        b'\x00\x21\x00\x01'
    )
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(0.5)
        sock.sendto(pkt, (ip, 137))
        data, _ = sock.recvfrom(1024)
        sock.close()
        num_names = data[56]
        if num_names > 0:
            for i in range(num_names):
                offset = 57 + (i * 18)
                if offset + 15 > len(data): break
                name = data[offset:offset+15].decode('ascii', errors='ignore').strip()
                if name and not all(c == '\x00' for c in name):
                    # Filter out Workgroup broadcasts and generic network tags
                    if name.upper() not in ["WORKGROUP", "MSHOME", "LOCAL", "LAN"]:
                        return name
    except Exception:
        pass
    return None

def _upnp_ssdp_discover() -> Dict[str, str]:
    discovered = {}
    msg = (
        "M-SEARCH * HTTP/1.1\r\n"
        "HOST: 239.255.255.250:1900\r\n"
        "MAN: \"ssdp:discover\"\r\n"
        "MX: 1\r\n"
        "ST: ssdp:all\r\n\r\n"
    )
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.settimeout(1.0)
        sock.sendto(msg.encode('utf-8'), ('239.255.255.250', 1900))
        st = time.time()
        while time.time() - st < 1.0:
            try:
                data, addr = sock.recvfrom(1024)
                ip = addr[0]
                text = data.decode('ascii', errors='ignore')
                for line in text.split('\r\n'):
                    if line.lower().startswith('server:'):
                        discovered[ip] = line.split(':', 1)[1].strip()
            except socket.timeout:
                break
    except Exception:
        pass
    finally:
        sock.close()
    return discovered

class MDNSCollector:
    def __init__(self):
        self.names = {}
        if Zeroconf is None:
            return
        self.zc = Zeroconf()
        self.browsers = [
            ServiceBrowser(self.zc, "_workstation._tcp.local.", self),
            ServiceBrowser(self.zc, "_http._tcp.local.", self),
            ServiceBrowser(self.zc, "_apple-mobdev2._tcp.local.", self),
            ServiceBrowser(self.zc, "_googlecast._tcp.local.", self),
            ServiceBrowser(self.zc, "_spotify-connect._tcp.local.", self),
            ServiceBrowser(self.zc, "_smb._tcp.local.", self)
        ]
        
    def add_service(self, zc, type_, name):
        try:
            info = zc.get_service_info(type_, name)
            if info:
                for ip_bytes in info.parsed_addresses():
                    ip = socket.inet_ntoa(ip_bytes) if len(ip_bytes) == 4 else None
                    if ip:
                        clean_name = name.split('.')[0].replace('\\032', ' ')
                        self.names[ip] = clean_name
        except Exception:
            pass
            
    def update_service(self, *args, **kwargs): pass
    def remove_service(self, *args, **kwargs): pass
    
    def get(self, ip: str) -> Optional[str]:
        return self.names.get(ip)


def run_nmap_os(ip: str) -> Optional[str]:
    import subprocess
    try:
        proc = subprocess.run(
            ["nmap", "-O", "-Pn", "--max-os-tries", "1", "--host-timeout", "4s", ip],
            capture_output=True,
            text=True,
            timeout=8.0
        )
        for line in proc.stdout.splitlines():
            line = line.strip()
            if line.startswith("OS details:"):
                return line.split(":", 1)[1].strip()
            if line.startswith("Aggressive OS guesses:"):
                return line.split(":", 1)[1].split(",", 1)[0].strip()
    except Exception:
        pass
    return None

class NmapBackgroundQueue:
    def __init__(self):
        from queue import Queue
        self.os_map = {}
        self.queue = Queue()
        self.seen = set()
        self.thread = threading.Thread(target=self._worker, name="nmap-worker", daemon=True)
        self.thread.start()

    def add(self, ip: str):
        if ip not in self.seen:
            self.seen.add(ip)
            self.queue.put(ip)

    def _worker(self):
        while True:
            ip = self.queue.get()
            os_name = run_nmap_os(ip)
            if os_name:
                self.os_map[ip] = os_name
            time.sleep(3.0)  # Safe delay to prevent network interface saturation
            self.queue.task_done()


async def _ping_ms(ip: str, timeout_ms: int = 800) -> Tuple[Optional[float], Optional[int]]:
    """
    Best-effort single-echo ping via system ping command (Windows/Linux).
    Returns latency in ms if parsed, else None.
    """
    if psutil.WINDOWS:
        # -n 1: one ping, -w timeout in ms
        cmd = ["ping", "-n", "1", "-w", str(timeout_ms), ip]
    else:
        # -c 1: one ping, -W timeout in seconds (integer)
        cmd = ["ping", "-c", "1", "-W", str(max(1, int(timeout_ms / 1000))), ip]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        out_b, _ = await proc.communicate()
        out = (out_b or b"").decode(errors="ignore")
    except Exception:
        return None, None

    ttl_val = None
    out_l = out.lower()
    
    # Parse TTL
    idx_ttl = out_l.find("ttl=")
    if idx_ttl != -1:
        tail_ttl = out_l[idx_ttl + 4 : idx_ttl + 4 + 6]
        num_ttl = "".join(c for c in tail_ttl if c.isdigit())
        if num_ttl: ttl_val = int(num_ttl)

    # Parse Time (Windows format)
    idx = out_l.find("time=")
    if idx != -1:
        tail = out_l[idx + 5 : idx + 5 + 20]
        tail = tail.replace("<", "").strip()
        num = ""
        for c in tail:
            if c.isdigit() or c == ".":
                num += c
            else:
                break
        try:
            return float(num) if num else None, ttl_val
        except ValueError:
            return None, ttl_val

    # Parse Time (Linux rare format)
    idx = out_l.find("time ")
    if idx != -1:
        tail = out_l[idx + 5 : idx + 5 + 20].strip()
        num = ""
        for c in tail:
            if c.isdigit() or c == ".":
                num += c
            else:
                break
        try:
            return float(num) if num else None, ttl_val
        except ValueError:
            return None, ttl_val

    return None, ttl_val


def _arp_scan_blocking(network: ipaddress.IPv4Network, iface: str, timeout_s: float) -> List[Tuple[str, str, float]]:
    """
    Blocking ARP scan using scapy. Returns list of (ip, mac, arp_ping_ms).
    """
    try:
        from scapy.all import ARP, Ether, conf, srp  # type: ignore
    except ModuleNotFoundError as e:
        raise ScannerError(
            "Missing dependency 'scapy'. Install requirements and retry. "
            "On Windows you also need Npcap installed for packet capture."
        ) from e

    # Ensure scapy doesn't try to talk to IPv6 in unexpected ways.
    conf.verb = 0
    # Limit scan to first /24 block to keep it fast
    target = str(list(network.subnets(new_prefix=24))[0])
    pkt = Ether(dst="ff:ff:ff:ff:ff:ff") / ARP(pdst=target)
    ans, _ = srp(pkt, timeout=timeout_s, retry=1)
    results: List[Tuple[str, str, float]] = []
    for snd, rcv in ans:
        ip = getattr(rcv, "psrc", None)
        mac = getattr(rcv, "hwsrc", None)
        if ip and mac:
            arp_ping_ms = (rcv.time - snd.sent_time) * 1000.0
            results.append((str(ip), _normalize_mac(str(mac)), arp_ping_ms))
    return results


class AsyncNetworkScanner:
    """
    Asyncio-friendly network scanner that also supports a background scanning thread.

    - `await scan_once()` performs one discovery scan and returns devices.
    - `start_background()` starts a daemon thread scanning every `interval_s`.
    - `get_devices_snapshot()` returns the latest known devices (with last_seen updates).
    """

    def __init__(
        self,
        interval_s: float = 20.0,
        arp_timeout_s: float = 2.0,
        ping_timeout_ms: int = 800,
        max_concurrent_pings: int = 64,
    ) -> None:
        self.interval_s = interval_s
        self.arp_timeout_s = arp_timeout_s
        self.ping_timeout_ms = ping_timeout_ms
        self.max_concurrent_pings = max_concurrent_pings

        self._lock = threading.Lock()
        self._devices: Dict[str, Device] = {}
        self._last_error: Optional[str] = None
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

        self._bw_lock = threading.Lock()
        self._byte_counts: Dict[str, int] = {}
        self._last_bw_time = time.time()
        self._sniffer_stop = threading.Event()
        self._sniffer_thread: Optional[threading.Thread] = None

        self._network: Optional[ipaddress.IPv4Network] = None
        self._iface: Optional[str] = None
        
        self.mdns = MDNSCollector()
        self.nmap_q = NmapBackgroundQueue()

    def _ensure_network(self) -> Tuple[ipaddress.IPv4Network, str]:
        if self._network is None or self._iface is None:
            net, iface = _detect_local_subnet()
            self._network, self._iface = net, iface
        return self._network, self._iface

    def last_error(self) -> Optional[str]:
        with self._lock:
            return self._last_error

    def get_devices_snapshot(self) -> List[Device]:
        now = time.time()
        with self._bw_lock:
            dt = now - self._last_bw_time
            counts = self._byte_counts
            self._byte_counts = {}
            self._last_bw_time = now

        with self._lock:
            snap = sorted(self._devices.values(), key=lambda d: d.ip)
            for d in snap:
                bps = (counts.get(d.ip, 0) / dt) if dt > 0 else 0
                d.bandwidth_bps = bps
            return snap

    def get_host_info(self) -> dict:
        import psutil
        with self._lock:
            iface = self._iface
        net_io = psutil.net_io_counters()
        return {
            "bytes_sent": net_io.bytes_sent,
            "bytes_recv": net_io.bytes_recv,
            "iface": iface
        }

    async def scan_once(self) -> List[Device]:
        network, iface = self._ensure_network()

        try:
            pairs = await asyncio.to_thread(_arp_scan_blocking, network, iface, self.arp_timeout_s)
        except PermissionError as e:
            msg = (
                "Insufficient permissions for ARP scanning. "
                "On Linux run as root (sudo). On Windows install Npcap and run as Administrator. "
                f"Original error: {e}"
            )
            with self._lock:
                self._last_error = msg
            raise ScannerPermissionError(msg) from e
        except OSError as e:
            # Windows often raises OSError when Npcap isn't installed or permissions are missing.
            msg = (
                "Network scan failed (OS error). "
                "If you're on Windows, ensure Npcap is installed and run as Administrator. "
                f"Original error: {e}"
            )
            with self._lock:
                self._last_error = msg
            raise ScannerError(msg) from e
        except Exception as e:
            msg = f"Network scan failed unexpectedly: {e}"
            with self._lock:
                self._last_error = msg
            raise ScannerError(msg) from e

        now = _utc_now()
        sem = asyncio.Semaphore(self.max_concurrent_pings)
        
        # Pull SSDP snapshot asynchronously
        ssdp_map = await asyncio.to_thread(_upnp_ssdp_discover)

        async def enrich(ip: str, mac: str, arp_ping: float) -> Device:
            self.nmap_q.add(ip)
            nmap_os = self.nmap_q.os_map.get(ip)
            
            vendor = await asyncio.to_thread(_lookup_vendor, mac)

            async with sem:
                ping, ttl = await _ping_ms(ip, timeout_ms=self.ping_timeout_ms)
                
            if ping is None:
                ping = arp_ping
                
            nb_name = await asyncio.to_thread(_netbios_lookup, ip)
            mdns_name = self.mdns.get(ip)
            upnp_name = ssdp_map.get(ip)
            
            hostname = mdns_name or nb_name
            return Device(
                ip=ip, mac=mac, vendor=vendor, last_seen=now, ping_ms=ping,
                os_ttl=ttl, hostname=hostname, upnp_model=upnp_name, nmap_os=nmap_os
            )

        devices = await asyncio.gather(*(enrich(ip, mac, arp) for ip, mac, arp in pairs))

        with self._lock:
            for d in devices:
                old_d = self._devices.get(d.ip)
                if old_d:
                    if d.ping_ms is not None:
                        d.ping_history = (old_d.ping_history + [d.ping_ms])[-5:]
                    else:
                        d.ping_history = old_d.ping_history
                else:
                    d.ping_history = [d.ping_ms] if d.ping_ms is not None else []
                self._devices[d.ip] = d
            self._last_error = None

        return devices

    async def _run_loop(self) -> None:
        while not self._stop.is_set():
            try:
                await self.scan_once()
            except ScannerPermissionError as e:
                # Permission errors should not spam too aggressively, but at least print them!
                print(f"[Scanner] Permission Denied: Run terminal as Administrator! ({e})")
            except Exception as e:
                print(f"[Scanner] Warning: Scan failed - {e}")
            await asyncio.sleep(self.interval_s)

    def _packet_handler(self, pkt) -> None:
        try:
            if pkt.haslayer("IP"):
                src = pkt["IP"].src
                dst = pkt["IP"].dst
                length = len(pkt)
                with self._bw_lock:
                    self._byte_counts[src] = self._byte_counts.get(src, 0) + length
                    self._byte_counts[dst] = self._byte_counts.get(dst, 0) + length
        except Exception:
            pass

    def _sniffer_loop(self) -> None:
        try:
            from scapy.all import sniff
            sniff(prn=self._packet_handler, store=0, stop_filter=lambda x: self._sniffer_stop.is_set())
        except Exception:
            pass

    def start_background(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._sniffer_stop.clear()

        def runner() -> None:
            asyncio.run(self._run_loop())

        self._thread = threading.Thread(target=runner, name="network-scanner", daemon=True)
        self._thread.start()

        self._sniffer_thread = threading.Thread(target=self._sniffer_loop, name="packet-sniffer", daemon=True)
        self._sniffer_thread.start()

    def stop_background(self, timeout_s: float = 2.0) -> None:
        self._stop.set()
        self._sniffer_stop.set()
        t = self._thread
        if t:
            t.join(timeout=timeout_s)
        st = self._sniffer_thread
        if st:
            st.join(timeout=timeout_s)

