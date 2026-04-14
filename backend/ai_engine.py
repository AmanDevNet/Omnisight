from __future__ import annotations

from collections import Counter, deque
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Any, Deque, Dict, List, Optional

try:
    from sklearn.ensemble import IsolationForest, RandomForestClassifier  # type: ignore
    import numpy as np  # type: ignore
except Exception:  # pragma: no cover
    IsolationForest = getattr(globals(), "IsolationForest", None)
    RandomForestClassifier = getattr(globals(), "RandomForestClassifier", None)
    np = getattr(globals(), "np", None)

from backend.scanner import Device


class NetworkAIEngine:
    """
    Lightweight anomaly/insights engine for WiFi network scans.

    Notes:
    - Expects `devices` to be a list of `backend.scanner.Device` objects.
    - Device.status is derived externally; if missing, treated as "online".
    - Designed to never crash on None/empty/first-run scenarios.
    """

    def __init__(self) -> None:
        self.scan_history: List[Dict[str, Any]] = []  # max 100 entries
        self.device_first_seen: Dict[str, datetime] = {}  # mac -> datetime
        self.ping_history: Dict[str, Deque[float]] = {}  # ip -> deque(maxlen=10)
        # Best-effort: sklearn/numpy may be unavailable or binary-incompatible on some installs.
        self.model: Optional[object] = None  # IsolationForest, trained after 10 scans
        self.rf_model: Optional[object] = None # RandomForestClassifier
        self.labeled_data: List[Dict[str, Any]] = []  # ML Training set
        self.scan_count: int = 0

    def get_ping_stats(self, ip: str) -> Tuple[float, float, float, float]:
        dq = self.ping_history.get(ip)
        if not dq: return (0.0, 0.0, 0.0, 0.0)
        vals = [v for v in dq if v is not None and v >= 0]
        if not vals: return (0.0, 0.0, 0.0, 0.0)
        mean_p = mean(vals)
        min_p = min(vals)
        max_p = max(vals)
        std_p = 0.0
        if len(vals) > 1:
            variance = sum((v - mean_p) ** 2 for v in vals) / len(vals)
            std_p = variance ** 0.5
        return (mean_p, std_p, min_p, max_p)

    def extract_features(self, d: Device, now: datetime, ping_stats: Tuple[float, float, float, float]) -> List[float]:
        mean_p, std_p, min_p, max_p = ping_stats
        mac = getattr(d, "mac", "") or ""
        # Randomized MAC logic (second char is 2, 6, a, or e)
        is_random = 1.0 if len(mac) >= 2 and mac[1].lower() in "26ae" else 0.0
        hr = float(now.astimezone(timezone.utc).hour)
        bw = float(getattr(d, "bandwidth_bps", 0.0))
        return [mean_p, std_p, min_p, max_p, is_random, hr, bw]

    def _train_rf_model(self):
        if np is None or RandomForestClassifier is None:
            return
        if len(self.labeled_data) < 15:
            return  # Need more ground truth to train

        X = []
        y = []
        for row in self.labeled_data:
            X.append(row["features"])
            y.append(row["label"])

        try:
            model = RandomForestClassifier(n_estimators=50, max_depth=5, random_state=42)
            model.fit(np.array(X), np.array(y))
            self.rf_model = model
            # Keep rolling buffer of 500 samples
            if len(self.labeled_data) > 500:
                self.labeled_data = self.labeled_data[-500:]
        except Exception:
            self.rf_model = None

    def update(self, devices: List[Device]) -> Dict[str, Any]:
        now = self._now()
        devices = devices or []

        for d in devices:
            mac = getattr(d, "mac", None)
            ip = getattr(d, "ip", None)
            if isinstance(mac, str) and mac and mac not in self.device_first_seen:
                self.device_first_seen[mac] = now

            ping = getattr(d, "ping_ms", None)
            if isinstance(ip, str) and ip:
                if ping is not None:
                    try:
                        p = float(ping)
                    except (TypeError, ValueError):
                        p = None
                    if p is not None:
                        if ip not in self.ping_history:
                            self.ping_history[ip] = deque(maxlen=10)
                        self.ping_history[ip].append(p)

        pings = [float(d.ping_ms) for d in devices if getattr(d, "ping_ms", None) is not None]
        avg_ping = mean(pings) if pings else 0.0

        online_count = 0
        for d in devices:
            status = getattr(d, "status", None)
            if status != "offline":
                online_count += 1

        self.scan_history.append(
            {
                "timestamp": now,
                "device_count": int(len(devices)),
                "avg_ping": float(avg_ping),
                "online_count": int(online_count),
            }
        )
        if len(self.scan_history) > 100:
            self.scan_history = self.scan_history[-100:]

        self.scan_count += 1

        if self.scan_count >= 10:
            try:
                self._train_model()
            except Exception:
                self.model = None

        if self.scan_count % 50 == 0 or (self.scan_count == 10 and len(self.labeled_data) > 5):
            self._train_rf_model()

        return self.get_insights(devices)

    def _train_model(self) -> None:
        # Features from scan_history: [device_count, avg_ping]
        if len(self.scan_history) < 10:
            return
        if np is None or IsolationForest is None:
            self.model = None
            return

        X = np.array(
            [[h.get("device_count", 0), h.get("avg_ping", 0.0)] for h in self.scan_history],
            dtype=float,
        )
        if X.shape[0] < 10:
            return

        model = IsolationForest(contamination=0.05, random_state=42)
        model.fit(X)
        self.model = model

    def detect_anomalies(self, devices: List[Device]) -> List[Dict[str, Any]]:
        devices = devices or []
        if self.scan_count < 10:
            return []
        if not devices:
            return []

        now = self._now()

        # Build per-device feature vectors:
        # [ping_ms (or 0), ping_delta_vs_baseline (or 0), is_new (0/1)]
        feats: List[List[float]] = []
        meta: List[Dict[str, Any]] = []

        for d in devices:
            ip = getattr(d, "ip", "")
            mac = getattr(d, "mac", "")
            vendor = getattr(d, "vendor", None)

            ping = getattr(d, "ping_ms", None)
            ping_f: float = 0.0
            if ping is not None:
                try:
                    ping_f = float(ping)
                except (TypeError, ValueError):
                    ping_f = 0.0

            baseline = self._baseline_ping(ip)
            delta = (ping_f - baseline) if (baseline is not None and ping_f > 0) else 0.0

            first = self.device_first_seen.get(mac)
            is_new = 0.0
            if first is not None and (now - first) <= timedelta(minutes=5):
                is_new = 1.0

            feats.append([ping_f, delta, is_new])
            meta.append(
                {
                    "ip": ip,
                    "mac": mac,
                    "vendor": vendor,
                    "ping": ping_f if ping_f > 0 else None,
                    "baseline": baseline,
                    "is_new": bool(is_new),
                    "first_seen": first,
                }
            )

        if np is None or IsolationForest is None:
            # Fallback: heuristic-only (no ML) to avoid crashing.
            return self._heuristic_anomalies(meta, now)

        X = np.array(feats, dtype=float)
        if X.shape[0] < 5:
            # Not enough samples to do meaningful unsupervised anomaly detection.
            return []

        # Use a dedicated model for device vectors each call to avoid feature-dimension mismatch.
        # (self.model is trained on scan_history features per spec.)
        try:
            dev_model = IsolationForest(contamination=0.05, random_state=42)
            dev_model.fit(X)
            preds = dev_model.predict(X)  # -1 anomaly, 1 normal
        except Exception:
            return self._heuristic_anomalies(meta, now)

        out: List[Dict[str, Any]] = []
        for i, pred in enumerate(preds):
            if int(pred) != -1:
                continue

            m = meta[i]
            ip = m["ip"]
            mac = m["mac"]
            vendor = m["vendor"]
            ping = m["ping"]
            baseline = m["baseline"]
            is_new = m["is_new"]
            first = m["first_seen"]

            reason = "Unusual network behavior"
            if ping is not None and baseline is not None and baseline > 0 and ping > 3.0 * baseline:
                reason = f"Ping spike: {int(round(ping))}ms vs baseline {int(round(baseline))}ms"
            elif is_new:
                reason = "New unrecognized device"

            severity = "medium"
            odd_hour = False
            try:
                hour = now.astimezone(timezone.utc).hour
                odd_hour = (hour >= 23) or (hour < 6)
            except Exception:
                odd_hour = False

            if (ping is not None and ping > 300) or (is_new and odd_hour):
                severity = "high"

            out.append(
                {
                    "ip": ip,
                    "mac": mac,
                    "vendor": vendor,
                    "reason": reason,
                    "severity": severity,
                }
            )

        return out

    def _heuristic_anomalies(self, meta: List[Dict[str, Any]], now: datetime) -> List[Dict[str, Any]]:
        """
        Non-ML fallback used when sklearn/numpy aren't available.
        Flags:
        - ping spike > 3x baseline (when baseline exists)
        - new device (first seen < 5 minutes)
        """
        out: List[Dict[str, Any]] = []
        for m in meta:
            ip = m.get("ip", "")
            mac = m.get("mac", "")
            vendor = m.get("vendor", None)
            ping = m.get("ping")
            baseline = m.get("baseline")
            is_new = bool(m.get("is_new", False))

            reason = None
            if isinstance(ping, (int, float)) and isinstance(baseline, (int, float)) and baseline > 0:
                if ping > 3.0 * baseline:
                    reason = f"Ping spike: {int(round(ping))}ms vs baseline {int(round(baseline))}ms"
            if reason is None and is_new:
                reason = "New unrecognized device"

            if reason is None:
                continue

            odd_hour = False
            try:
                hour = now.astimezone(timezone.utc).hour
                odd_hour = (hour >= 23) or (hour < 6)
            except Exception:
                odd_hour = False

            severity = "medium"
            if (isinstance(ping, (int, float)) and ping > 300) or (is_new and odd_hour):
                severity = "high"

            out.append(
                {
                    "ip": ip,
                    "mac": mac,
                    "vendor": vendor,
                    "reason": reason,
                    "severity": severity,
                }
            )
        return out

    def get_insights(self, devices: List[Device]) -> Dict[str, Any]:
        devices = devices or []
        now = self._now()

        # Vendor breakdown (rare grouped into Unknown)
        vendors = [self._vendor_str(getattr(d, "vendor", None)) for d in devices]
        counts = Counter(vendors)
        vendor_breakdown: Dict[str, int] = {}
        for v, c in counts.items():
            if v != "Unknown" and c <= 1:
                vendor_breakdown["Unknown"] = vendor_breakdown.get("Unknown", 0) + int(c)
            else:
                vendor_breakdown[v] = int(c)

        # Ping zones (return as lists of device dicts)
        ping_zones: Dict[str, List[Dict[str, Any]]] = {
            "nearby": [],
            "mid": [],
            "far": [],
            "unknown": [],
        }

        # New devices
        new_devices: List[Dict[str, Any]] = []

        # High latency
        high_latency: List[Dict[str, Any]] = []

        # Build device payload once
        for d in devices:
            ip = getattr(d, "ip", "")
            mac = getattr(d, "mac", "")
            vendor = getattr(d, "vendor", None)
            ping = getattr(d, "ping_ms", None)
            last_seen = getattr(d, "last_seen", None)
            status = getattr(d, "status", "online")

            ping_f: Optional[float]
            if ping is None:
                ping_f = None
            else:
                try:
                    ping_f = float(ping)
                except (TypeError, ValueError):
                    ping_f = None

            first = self.device_first_seen.get(mac, now)
            if mac and (now - first) <= timedelta(minutes=5):
                new_devices.append(
                    {
                        "ip": ip,
                        "mac": mac,
                        "vendor": vendor,
                        "first_seen": self._iso(first),
                        "ping_ms": ping_f,
                    }
                )

            payload = {
                "ip": ip,
                "mac": mac,
                "vendor": vendor,
                "ping_ms": ping_f,
                "last_seen": self._iso(last_seen) if isinstance(last_seen, datetime) else None,
                "status": status,
            }

            if ping_f is None:
                ping_zones["unknown"].append(payload)
            elif ping_f <= 20:
                ping_zones["nearby"].append(payload)
            elif 21 <= ping_f <= 100:
                ping_zones["mid"].append(payload)
            else:
                ping_zones["far"].append(payload)

            if ping_f is not None and ping_f > 200:
                high_latency.append(payload)

        anomalies = self.detect_anomalies(devices)
        summary = self.get_summary_text(devices)

        return {
            "timestamp": self._iso(now),
            "scan_count": int(self.scan_count),
            "vendor_breakdown": vendor_breakdown,
            "ping_zones": ping_zones,
            "new_devices": new_devices,
            "high_latency": high_latency,
            "anomalies": anomalies,
            "summary": summary,
        }

    def get_summary_text(self, devices: List[Device]) -> str:
        devices = devices or []

        total = len(devices)
        online = 0
        pings: List[float] = []
        high_latency_count = 0

        for d in devices:
            if getattr(d, "status", None) != "offline":
                online += 1
            ping = getattr(d, "ping_ms", None)
            if ping is not None:
                try:
                    pf = float(ping)
                except (TypeError, ValueError):
                    pf = None
                if pf is not None:
                    pings.append(pf)
                    if pf > 200:
                        high_latency_count += 1

        avg = mean(pings) if pings else 0.0

        if self.scan_count < 10:
            return (
                f"{total} devices detected, {online} online. "
                f"Average ping is {int(round(avg))}ms. "
                f"Still learning network baseline ({self.scan_count}/10 scans)."
            )

        anomalies = self.detect_anomalies(devices)
        a_count = len(anomalies)

        if a_count == 0:
            return (
                f"{total} devices active on campus network, {online} online. "
                f"Average ping is {int(round(avg))}ms with {high_latency_count} devices showing high latency. "
                "No anomalies detected."
            )

        # Mention up to 2 highlights
        highlights: List[str] = []
        for a in anomalies[:2]:
            ip = a.get("ip", "unknown")
            reason = a.get("reason", "anomaly")
            if isinstance(reason, str) and reason.lower().startswith("ping spike"):
                highlights.append(f"ping spike on {ip}")
            elif isinstance(reason, str) and "new" in reason.lower():
                highlights.append("1 new device")
            else:
                highlights.append(f"unusual behavior on {ip}")
        hl = " and ".join(highlights) if highlights else "network anomalies"

        return (
            f"{total} devices active on campus network, {online} online. "
            f"Average ping is {int(round(avg))}ms with {high_latency_count} devices showing high latency. "
            f"{a_count} anomalies detected: {hl}."
        )

    def _baseline_ping(self, ip: str) -> Optional[float]:
        if not isinstance(ip, str) or not ip:
            return None
        dq = self.ping_history.get(ip)
        if not dq:
            return None
        vals = [v for v in dq if isinstance(v, (int, float)) and v >= 0]
        if not vals:
            return None
        try:
            return float(mean(vals))
        except Exception:
            return None

    @staticmethod
    def _vendor_str(v: Optional[str]) -> str:
        s = (v or "").strip()
        return s if s else "Unknown"

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    @staticmethod
    def _iso(dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()

    def classify_device(
        self, d: Device, now: datetime
    ) -> Dict[str, Any]:
        """
        Classify a device using exactly requested Pipeline:
        1. MAC Vendor logic -> Ground Truth
        2. Randomized MAC Detection
        3. Random Forest ML prediction (if trained)
        """
        vendor = getattr(d, "vendor", "") or ""
        v = vendor.lower()
        ip = getattr(d, "ip", "")
        mac = getattr(d, "mac", "") or ""
        
        bw = float(getattr(d, "bandwidth_bps", 0.0))
        ping_stats = self.get_ping_stats(ip)
        mean_p, std_p, min_p, max_p = ping_stats

        is_randomized = len(mac) >= 2 and mac[1].lower() in "26ae"

        def has_any(keys: List[str]) -> bool:
            return any(k in v for k in keys)

        # -------------------------------------------------------------
        # STEP 1 & 2: Rule Based Labeling (High Confidence)
        # -------------------------------------------------------------
        label = None
        icon = "❓"
        confidence = 0
        rule_hit = False

        if has_any(["cisco", "meraki", "wnc", "ruckus", "aruba", "ubiquiti", "juniper", "extreme", "netgear", "tp-link", "d-link"]):
            label, icon, confidence, rule_hit = f"Network Infrastructure ({vendor.strip()})", "📡", 85, True
        elif has_any(["xiaomi", "redmi"]):
            label, icon, confidence, rule_hit = "Xiaomi Android Phone", "📱", 85, True
        elif has_any(["oppo"]):
            label, icon, confidence, rule_hit = "OPPO Android Phone", "📱", 85, True
        elif has_any(["vivo"]):
            label, icon, confidence, rule_hit = "Vivo Android Phone", "📱", 85, True
        elif has_any(["realme"]):
            label, icon, confidence, rule_hit = "Realme Android Phone", "📱", 85, True
        elif has_any(["samsung"]):
            label, icon, confidence, rule_hit = "Samsung Device (Phone/Tablet)", "📱", 85, True
        elif has_any(["apple"]):
            label, icon, confidence, rule_hit = "Apple Device (iPhone/MacBook)", "🍎", 85, True
        elif has_any(["huawei"]):
            label, icon, confidence, rule_hit = "Huawei Device", "📱", 85, True
        elif has_any(["intel", "realtek", "broadcom", "qualcomm", "dell", "lenovo", "hp ", "hewlett", "asus", "acer", "toshiba", "microsoft", "gigabyte", "msi"]):
            label, icon, confidence, rule_hit = f"Laptop/PC ({vendor.strip()})", "💻", 85, True
        elif has_any(["azurewave", "liteon", "lite-on", "alps", "foxconn", "pegatron", "quanta", "compal", "wistron"]):
            label, icon, confidence, rule_hit = f"Windows Laptop ({vendor.strip()} chip)", "💻", 85, True
        elif has_any(["espressif", "raspberry", "arduino", "hisilicon", "hangzhou", "shenzhen", "tuyasmart", "amazon", "ring", "nest", "sonos"]):
            label, icon, confidence, rule_hit = f"IoT Device ({vendor.strip()})", "🔌", 85, True
        elif v.strip() and "unknown" not in v:
            # Random known vendor
            label, icon, confidence, rule_hit = f"Network Device ({vendor.strip()})", "🔌", 75, True

        os_ttl = getattr(d, "os_ttl", None)
        if not rule_hit and os_ttl is not None:
            if os_ttl == 128:
                label, icon, confidence, rule_hit = f"Windows PC/Laptop (TTL inference)", "💻", 75, True
            elif os_ttl == 64:
                if is_randomized:
                    label, icon, confidence, rule_hit = "Android/iOS Mobile Device (TTL=64)", "📱", 70, True
                else:
                    label, icon, confidence, rule_hit = "Linux/Mobile Device (TTL=64)", "📱", 65, True
            elif os_ttl == 255:
                label, icon, confidence, rule_hit = "Network Infrastructure (TTL=255)", "📡", 80, True

        features = self.extract_features(d, now, ping_stats)

        # Auto-Label Training Data for ML!
        if rule_hit and label:
            # We use generic bucket labels for the model
            target_class = "Unknown"
            if "Phone" in label or "iPhone" in label or "Samsung" in label: target_class = "Phone"
            elif "Laptop" in label or "PC" in label or "MacBook" in label: target_class = "Laptop"
            elif "Infrastructure" in label: target_class = "Router/AP"
            elif "IoT" in label: target_class = "IoT"

            if target_class != "Unknown":
                self.labeled_data.append({"features": features, "label": target_class})

        is_ml = False

        # -------------------------------------------------------------
        # STEP 3 & 4: Behavioral Inference & ML
        # -------------------------------------------------------------
        if not rule_hit:
            # First, try the Random Forest if trained!
            if self.rf_model is not None and np is not None:
                try:
                    X_infer = np.array([features])
                    pred_class = self.rf_model.predict(X_infer)[0]
                    probs = self.rf_model.predict_proba(X_infer)[0]
                    rf_conf = int(max(probs) * 100)

                    if rf_conf > 55:
                        is_ml = True
                        confidence = rf_conf
                        if pred_class == "Phone":
                            label, icon = "Likely Android/iOS Phone", "📱"
                        elif pred_class == "Laptop":
                            label, icon = "Likely Windows/Mac Laptop", "💻"
                        elif pred_class == "Router/AP":
                            label, icon = "Likely Router/AP", "📡"
                        elif pred_class == "IoT":
                            label, icon = "Likely IoT/Smart Device", "🔌"
                except Exception:
                    pass

            # Fallback to heuristics if ML skipped or confidence too low
            if not is_ml:
                os_ttl = getattr(d, "os_ttl", None)
                if os_ttl == 128:
                    label, icon, confidence = "Windows Device", "💻", 65
                elif os_ttl == 64:
                    if mean_p > 0 and std_p > 20:
                        label, icon, confidence = "Mobile Device (Active)", "📱", 65
                    elif 0 < mean_p < 10 and std_p < 2:
                        label, icon, confidence = "Could be Linux/Android", "📱", 60
                    else:
                        label, icon, confidence = "Android or iOS Device", "📱", 60
                elif os_ttl == 255:
                    label, icon, confidence = "Network Infrastructure", "📡", 80
                else:
                    if is_randomized:
                        label, icon, confidence = "Unknown Mobile Device", "📱", 50
                    elif 0 < mean_p < 10 and std_p < 2:
                        label, icon, confidence = "Likely Infrastructure/IoT", "🔌", 60
                    elif mean_p > 0 and std_p > 20: 
                        label, icon, confidence = "Likely Mobile Device", "📱", 60
                    else:
                        label, icon, confidence = "Unidentified Device", "❓", 0

        if not label:
            label, icon, confidence = "Unidentified Device", "❓", 0

        # Construct payload with Passive Discovery Overrides
        hostname = getattr(d, "hostname", None)
        upnp_model = getattr(d, "upnp_model", None)
        nmap_os = getattr(d, "nmap_os", None)
        
        is_verified_override = rule_hit
        if nmap_os:
            # Absolute precision from TCP SYN OS matrices
            if "windows" in nmap_os.lower() or "linux" in nmap_os.lower() or "mac" in nmap_os.lower(): icon = "💻"
            if "apple" in nmap_os.lower() or "ios" in nmap_os.lower(): icon = "📱"
            if "router" in nmap_os.lower() or "switch" in nmap_os.lower(): icon = "📡"
            prediction_str = f"{icon} {nmap_os} — 95% confidence (Nmap OS TCP)"
            is_verified_override = True
        elif hostname:
            # Overrule ML with hard network announcements
            if "iphone" in hostname.lower() or "ipad" in hostname.lower() or "phone" in hostname.lower(): icon = "📱"
            elif "macbook" in hostname.lower() or "laptop" in hostname.lower() or "desktop" in hostname.lower(): icon = "💻"
            prediction_str = f"{icon} {hostname} — 100% confidence (Network Name)"
            is_verified_override = True
        elif upnp_model:
            prediction_str = f"{icon} {upnp_model} — 90% confidence (UPnP Discovery)"
            is_verified_override = True
        elif confidence == 0:
            prediction_str = f"❓ {label} — insufficient data"
        else:
            prediction_str = f"{icon} {label} — {confidence}% confidence"

        return {
            "type": label.split("(")[0].strip() if "(" in label else label, 
            "icon": icon,
            "prediction": prediction_str,
            "is_ml_predicted": is_ml,
            "is_verified": is_verified_override,
        }

