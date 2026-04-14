from __future__ import annotations

from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

import os
import time
from google import genai as google_genai

try:
    if "GEMINI_API_KEY" not in os.environ:
        print("Warning: GEMINI_API_KEY missing from environment.")
except Exception as e:
    print(f"Warning: Failed to setup Gemini vars - {e}")
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.ai_engine import NetworkAIEngine
from backend.scanner import AsyncNetworkScanner, Device
from backend import database

app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # allow frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _time_ago(dt: datetime) -> str:
    now = _utc_now()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta_s = max(0, int((now - dt.astimezone(timezone.utc)).total_seconds()))

    if delta_s < 60:
        return "just now"
    if delta_s < 60 * 60:
        return f"{delta_s // 60}m ago"
    if delta_s < 60 * 60 * 24:
        h = delta_s // 3600
        m = (delta_s % 3600) // 60
        return f"{h}h {m}m ago"
    return f"{delta_s // (60 * 60 * 24)}d ago"


def _device_to_api(d: Device, *, offline_after_s: float) -> Dict[str, Any]:
    now = _utc_now()
    age_s = (now - d.last_seen).total_seconds()
    status = "offline" if age_s > offline_after_s else "online"
    
    bw = getattr(d, "bandwidth_bps", 0.0)
    classification = ai_engine.classify_device(d, now)
    
    first_seen = _first_seen.get(d.mac)
    return {
        "ip": d.ip,
        "mac": d.mac,
        "vendor": d.vendor,
        "ping_ms": d.ping_ms,
        "last_seen": _iso(d.last_seen),
        "status": status,
        "device_type": classification["type"],
        "device_icon": classification["icon"],
        "prediction": classification.get("prediction", "❓ Unknown Device"),
        "is_ml_predicted": classification.get("is_ml_predicted", False),
        "is_verified": classification.get("is_verified", False),
        "os_ttl": getattr(d, "os_ttl", None),
        "nmap_os": getattr(d, "nmap_os", None),
        "ping_history": getattr(d, "ping_history", []),
        "connected_since": _time_ago(first_seen) if first_seen else "unknown",
        "bandwidth_bps": bw,
    }


_first_seen: Dict[str, datetime] = {}
_last_seen_ips: Set[str] = set()


scanner = AsyncNetworkScanner(interval_s=20.0)
ai_engine = NetworkAIEngine()


@app.on_event("startup")
async def startup_event() -> None:
    scanner.start_background()
    asyncio.create_task(network_logger_task())
    asyncio.create_task(dvr_snapshot_task())

@app.on_event("shutdown")
async def shutdown_event() -> None:
    scanner.stop_background()


@app.get("/")
async def root() -> Dict[str, Any]:
    devices = scanner.get_devices_snapshot()
    return {"status": "running", "device_count": len(devices)}


@app.get("/api/devices")
async def get_devices() -> Dict[str, Any]:
    devices = scanner.get_devices_snapshot()
    offline_after_s = 120.0
    data = [_device_to_api(d, offline_after_s=offline_after_s) for d in devices]
    
    # Update history AFTER snapshot.
    now = _utc_now()
    global _last_seen_ips
    for d in devices:
        if d.mac not in _first_seen:
            _first_seen[d.mac] = now
    _last_seen_ips = {d.ip for d in devices}

    # Feed AI engine (do not return result here).
    try:
        ai_engine.update(devices)
    except Exception as e:
        print(f"Error fetching state: {e}")
        return {"error": str(e)}

    return {"type": "devices", "data": data, "timestamp": _iso(_utc_now()), "error": scanner.last_error()}


async def dvr_snapshot_task():
    while True:
        try:
            devices = scanner.get_devices_snapshot()
            if devices:
                data = [_device_to_api(d, offline_after_s=120.0) for d in devices]
                # Inject states silently into the DB
                database.save_snapshot(data)
                
                # Phase 14: RAG Document Generation
                active = [d for d in data if d["status"] == "online"]
                top_degraded = sorted([d for d in active if d["ping_ms"] is not None], key=lambda x: x["ping_ms"] or 0, reverse=True)[:5]
                anomalies = [d for d in data if d.get("is_anomalous", False)]
                mobiles = len([d for d in active if "Mobile" in d.get("device_type", "")])
                laptops = len([d for d in active if "PC" in d.get("device_type", "") or "Windows" in d.get("device_type", "")])
                infra = len([d for d in active if "Infrastructure" in d.get("device_type", "")])
                pings = [d["ping_ms"] for d in active if d["ping_ms"] is not None]
                avg_ping = sum(pings) / len(pings) if pings else 0
                now_str = _utc_now().strftime("%I:%M %p")
                
                degraded_str = ", ".join([f"{d['ip']} at {int(d['ping_ms'])}ms" for d in top_degraded])
                summary = f"At {now_str}, {len(active)} devices connected. {mobiles} mobile devices, {laptops} laptops, {infra} router. Average ping {int(avg_ping)}ms. Degraded devices: {degraded_str}. {len(anomalies)} anomalies detected."
                
                doc_id = str(time.time())
                database.add_rag_document(
                    doc_id=doc_id,
                    text=summary,
                    metadata={"timestamp": time.time(), "device_count": len(active), "avg_ping": float(avg_ping), "anomaly_count": len(anomalies)}
                )

        except Exception as e:
            print(f"DVR Snapshot Error: {e}")
        await asyncio.sleep(20)

@app.get("/api/dvr/bounds")
async def dvr_bounds():
    min_ts, max_ts = database.get_dvr_bounds()
    return {"min": min_ts, "max": max_ts}

@app.get("/api/dvr/snapshot/{ts}")
async def dvr_snapshot(ts: float):
    state = database.get_snapshot_at(ts)
    return {"data": state}


async def network_logger_task():
    seen_macs = set()
    first_run = True
    while True:
        try:
            devices = scanner.get_devices_snapshot()
            current_macs = set(d.mac for d in devices)
            
            # Find new connections
            new_macs = current_macs - seen_macs
            if not first_run: 
                for mac in new_macs:
                    d = next((x for x in devices if x.mac == mac), None)
                    if d:
                        database.log_event("CONNECT", d.ip, d.mac, {"vendor": d.vendor})
            seen_macs = current_macs
            first_run = False
            
            # Log bandwidth hogs (>500KB/s)
            for d in devices:
                bw = getattr(d, 'bandwidth_bps', 0)
                if bw > 500000:
                    database.log_event("HIGH_BANDWIDTH", d.ip, d.mac, {"bps": bw})
        except Exception:
            pass
        await asyncio.sleep(10)


@app.get("/api/ai-insights")
async def get_ai_insights() -> Dict[str, Any]:
    devices = scanner.get_devices_snapshot()
    return ai_engine.get_insights(devices)


@app.get("/api/summary")
async def get_summary() -> Dict[str, Any]:
    devices = scanner.get_devices_snapshot()
    return {
        "summary": ai_engine.get_summary_text(devices),
        "anomalies": ai_engine.detect_anomalies(devices),
        "scan_count": ai_engine.scan_count,
    }


@app.get("/api/insights")
async def get_insights() -> Dict[str, Any]:
    devices = scanner.get_devices_snapshot()
    now = _utc_now()
    offline_after_s = 120.0

    def first_seen_for(d: Device) -> datetime:
        return _first_seen.get(d.mac, d.last_seen)

    def dev_with_first_seen(d: Device) -> Dict[str, Any]:
        base = _device_to_api(d, offline_after_s=offline_after_s)
        base["first_seen"] = _iso(first_seen_for(d))
        return base

    new_devices = [
        {
            "ip": d.ip,
            "mac": d.mac,
            "vendor": d.vendor,
            "first_seen": _iso(first_seen_for(d)),
            "ping_ms": d.ping_ms,
        }
        for d in devices
        if (now - first_seen_for(d)).total_seconds() <= 5 * 60
    ]

    just_joined = [
        dev_with_first_seen(d)
        for d in devices
        if (now - first_seen_for(d)).total_seconds() <= 30
    ]

    zones: Dict[str, List[Dict[str, Any]]] = {
        "nearby": [],
        "mid": [],
        "far": [],
        "unknown": [],
    }
    for d in devices:
        ping = d.ping_ms
        item = dev_with_first_seen(d)
        if ping is None:
            zones["unknown"].append(item)
        elif ping <= 20:
            zones["nearby"].append(item)
        elif 21 <= ping <= 100:
            zones["mid"].append(item)
        else:
            zones["far"].append(item)

    return {
        "new_devices": new_devices,
        "zones": zones,
        "total": len(devices),
        "just_joined": just_joined,
    }

@app.get("/api/debug/discovery")
async def debug_discovery() -> Dict[str, Any]:
    devices = scanner.get_devices_snapshot()
    
    mdns_count = 0
    netbios_count = 0
    upnp_count = 0
    nmap_count = 0
    ml_fallback_count = 0
    samples = []
    
    import re
    conf_bins = {">80%": 0, "60-80%": 0, "<60% (Unidentified)": 0}
    
    for d in devices:
        c = ai_engine.classify_device(d, _utc_now())
        is_ml = c.get("is_ml_predicted", False)
        
        m = re.search(r"(\d+)% confidence", c.get("prediction", ""))
        conf = int(m.group(1)) if m else 0
        if conf >= 80: conf_bins[">80%"] += 1
        elif conf >= 60: conf_bins["60-80%"] += 1
        else: conf_bins["<60% (Unidentified)"] += 1
        
        has_mdns = False
        mdns_collector = getattr(scanner, "mdns", None)
        if mdns_collector and d.ip in mdns_collector.names:
            has_mdns = True
            
        if has_mdns:
            mdns_count += 1
        elif getattr(d, "hostname", None):
            netbios_count += 1
            
        if getattr(d, "upnp_model", None):
            upnp_count += 1
            
        if getattr(d, "nmap_os", None):
            nmap_count += 1
            
        if is_ml:
            ml_fallback_count += 1
            
        if len(samples) < 5 and (getattr(d, "hostname", None) or getattr(d, "upnp_model", None) or is_ml):
            samples.append({
                "ip": d.ip,
                "mac": d.mac,
                "hostname": getattr(d, "hostname", None),
                "upnp_model": getattr(d, "upnp_model", None),
                "nmap_os": getattr(d, "nmap_os", None),
                "os_ttl": getattr(d, "os_ttl", None),
                "is_ml_predicted": is_ml,
                "prediction": c.get("prediction")
            })

    # Fill remaining samples if needed
    for d in devices:
        if len(samples) >= 5: 
            break
        if d.ip not in [s["ip"] for s in samples]:
            c = ai_engine.classify_device(d, _utc_now())
            samples.append({
                "ip": d.ip,
                "mac": d.mac,
                "hostname": getattr(d, "hostname", None),
                "upnp_model": getattr(d, "upnp_model", None),
                "nmap_os": getattr(d, "nmap_os", None),
                "os_ttl": getattr(d, "os_ttl", None),
                "is_ml_predicted": c.get("is_ml_predicted", False),
                "prediction": c.get("prediction")
            })

    return {
        "metrics": {
            "total_devices": len(devices),
            "mdns_identified": mdns_count,
            "netbios_identified": netbios_count,
            "upnp_identified": upnp_count,
            "nmap_identified": nmap_count,
            "ml_predicted": ml_fallback_count,
            "ml_training_samples_collected": len(getattr(ai_engine, "labeled_data", [])),
            "confidence_distribution": conf_bins,
            "rf_features_used": [
                 "ping_mean", "ping_std", "ping_min", "ping_max", 
                 "is_randomized_mac", "hour_of_day", "bandwidth_bps"
            ]
        },
        "samples": samples
    }

@app.websocket("/ws")
async def ws_devices(ws: WebSocket) -> None:
    await ws.accept()
    previous_anomalies = set()
    
    while True:
        try:
            devices = scanner.get_devices_snapshot()
            offline_after_s = 120.0
            
            # Phase 16: Instant ML Anomaly Push
            current_anomalies = {d.ip for d in devices if getattr(d, 'is_anomalous', False)}
            new_anomalies = current_anomalies - previous_anomalies
            
            for ip in new_anomalies:
                device = next((d for d in devices if d.ip == ip), None)
                if device:
                    ping = getattr(device, 'ping_ms', None)
                    if ping and ping > 150:
                        reason = f"High latency spike: {int(ping)}ms limit exceeded"
                        severity = "high"
                    else:
                        reason = "Anomalous signature detected by ML Engine"
                        severity = "medium"
                        
                    await ws.send_json({
                        "type": "anomaly_alert",
                        "ip": ip,
                        "reason": reason,
                        "severity": severity,
                        "timestamp": _iso(_utc_now())
                    })
            
            previous_anomalies = current_anomalies
            
            # Map devices to JSON API format
            data = [_device_to_api(d, offline_after_s=offline_after_s) for d in devices]
            
            # Construct the exact event payload the React frontend expects
            state = {
                "type": "devices",
                "data": data,
                "timestamp": _iso(_utc_now()),
                "error": scanner.last_error(),
                "host_info": scanner.get_host_info()
            }
            
            await ws.send_json(state)
            await asyncio.sleep(5)
            
        except WebSocketDisconnect:
            print("Client disconnected.")
            break
        except Exception as e:
            print(f"WebSocket unhandled error: {e}")
            break

class ChatRequest(BaseModel):
    message: str

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    try:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return {"response": "GEMINI_API_KEY is not configured in the environment."}
            
        client = google_genai.Client(api_key=api_key)
        
        devices = scanner.get_devices_snapshot()
        active = [d for d in devices if d.ping_ms is not None]
        active.sort(key=lambda x: x.ping_ms or 0, reverse=True)
        
        top_degraded = active[:5]
        anomalies = [d for d in devices if getattr(d, 'is_anomalous', False)]
        
        types = {}
        for d in active:
            dt_lower = (getattr(d, 'device_type', 'Unknown') or 'Unknown').lower()
            if 'windows' in dt_lower or 'laptop' in dt_lower or 'pc' in dt_lower: t = 'Windows/PC'
            elif 'phone' in dt_lower or 'mobile' in dt_lower or 'ios' in dt_lower or 'android' in dt_lower: t = 'Mobile'
            elif 'infra' in dt_lower or 'router' in dt_lower or 'ap' in dt_lower: t = 'Infrastructure'
            else: t = 'Unknown'
            types[t] = types.get(t, 0) + 1
            
        context_str = (
            f"SYSTEM CONTEXT: You are OmniSight, an AI network assistant.\n"
            f"LIMITATIONS: You are operating on a shared campus network where client isolation is strictly enforced. You CANNOT measure individual bandwidth for other IP addresses. If explicitly asked about bandwidth, explain this hardware limitation.\n"
            f"SNAPSHOT: Total: {len(devices)}, Active: {len(active)}.\n"
            f"TYPES: {types}.\n"
            f"TOP 5 PINGS: " + ", ".join([f"{d.ip}: {int(d.ping_ms)}ms" for d in top_degraded]) + ".\n"
            f"ANOMALIES: {len(anomalies)} detected.\n"
            f"Keep your answers strictly under 3 sentences. Use markdown to answer directly.\n\n"
            f"USER QUERY: {req.message}"
        )
        
        response = client.models.generate_content(
            model='gemini-2.0-flash',
            contents=context_str[:2000] 
        )
        return {"response": response.text}
    except Exception as e:
        return {"response": f"Error calling AI: {str(e)}"}

@app.post("/api/rag/query")
async def rag_query_endpoint(req: ChatRequest):
    try:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return {"response": "GEMINI_API_KEY is not configured in the environment."}
            
        docs = database.query_rag_documents(req.message, n_results=5)
        context_str = "\n".join([f"- {d}" for d in docs])
        
        devices = scanner.get_devices_snapshot()
        live_count = len([d for d in devices if d.ping_ms is not None])
        
        full_prompt = (
            f"SYSTEM: You are OmniSight, an AI network assistant.\n"
            f"Your knowledge incorporates natively embedded historical network logs (RAG).\n\n"
            f"HISTORICAL SCANS (from ChromaDB):\n{context_str}\n\n"
            f"CURRENT STATE: {live_count} active devices right now.\n\n"
            f"USER QUERY: {req.message}\n"
            f"Provide a concise summary answering the user's question, strictly under 3 sentences. Use markdown."
        )
        
        client = google_genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=full_prompt
        )
        return {"response": response.text}
    except Exception as e:
        return {"response": f"RAG AI Error: {str(e)}"}