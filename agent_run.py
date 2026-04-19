import asyncio
import os
import requests
import json
from dataclasses import asdict
from backend.scanner import AsyncNetworkScanner

API_URL = os.getenv("OMNISIGHT_URL", "http://localhost:8000")
API_KEY = os.getenv("OMNISIGHT_API_KEY")

async def main():
    if not API_KEY:
        print("Error: OMNISIGHT_API_KEY is not set.")
        print("Please set your API key provided by the OmniSight Dashboard.")
        print("Example: set OMNISIGHT_API_KEY=your_api_key_here")
        return

    print(f"Starting OmniSight Agent...")
    print(f"Target Cloud: {API_URL}")
    print("Initializing Network Scanner... (may take a few seconds)")
    
    scanner = AsyncNetworkScanner(interval_s=20.0)
    scanner.start_background()

    while True:
        await asyncio.sleep(15)
        devices = scanner.get_devices_snapshot()
        host_info = scanner.get_host_info()
        
        if not devices:
            continue

        # Convert devices to dicts
        devices_data = []
        for d in devices:
            d_dict = asdict(d)
            if d_dict.get("last_seen"):
                d_dict["last_seen"] = d_dict["last_seen"].isoformat()
            devices_data.append(d_dict)

        payload = {
            "devices": devices_data,
            "host_info": host_info
        }

        try:
            res = requests.post(
                f"{API_URL}/api/agent/push",
                json=payload,
                headers={"x-api-key": API_KEY},
                timeout=10
            )
            if res.status_code == 200:
                print(f"[{requests.utils.time.ctime()}] Pushed {len(devices)} devices successfully.")
            elif res.status_code == 401:
                print(f"[{requests.utils.time.ctime()}] Error: Invalid API Key. Please verify.")
            else:
                print(f"[{requests.utils.time.ctime()}] Error {res.status_code}: {res.text}")
        except Exception as e:
            print(f"[{requests.utils.time.ctime()}] Network error pushing to cloud: {e}")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nAgent stopped.")
