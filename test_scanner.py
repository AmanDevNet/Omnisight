import asyncio
from backend.scanner import AsyncNetworkScanner

async def main():
    scanner = AsyncNetworkScanner()
    print("Scanning your network... (takes ~3 seconds)")
    try:
        devices = await scanner.scan_once()
        if not devices:
            print("No devices found. Check Npcap is installed and run as Administrator.")
        for d in devices:
            print(f"  IP: {d.ip:<16} MAC: {d.mac:<20} Vendor: {d.vendor or 'Unknown':<30} Ping: {d.ping_ms}ms")
    except Exception as e:
        print(f"Error: {e}")

asyncio.run(main())