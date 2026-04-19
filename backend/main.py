from __future__ import annotations

from dotenv import load_dotenv
from pathlib import Path
import os
import time
import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Set, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai as google_genai

load_dotenv(Path(__file__).parent / ".env")

try:
    if "GEMINI_API_KEY" not in os.environ:
        print("Warning: GEMINI_API_KEY missing from environment.")
except Exception as e:
    print(f"Warning: Failed to setup Gemini vars - {e}")

from backend.ai_engine import NetworkAIEngine
from backend.scanner import Device
from backend import database

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    if delta_s < 60: return "just now"
    if delta_s < 60 * 60: return f"{delta_s // 60}m ago"
    if delta_s < 60 * 60 * 24:
        return f"{delta_s // 3600}h {(delta_s % 3600) // 60}m ago"
    return f"{delta_s // (60 * 60 * 24)}d ago"


class UserState:
    def __init__(self):
        self.ai_engine = NetworkAIEngine()
        self.first_seen: Dict[str, datetime] = {}
        self.last_seen_ips: Set[str] = set()
        self.latest_devices: List[Device] = []
        self.host_info: Dict[str, Any] = {}
        self.last_dvr_snapshot = 0.0
        self.last_logger_run = 0.0

user_states: Dict[int, UserState] = {}

def get_user_state(user_id: int) -> UserState:
    if user_id not in user_states:
        user_states[user_id] = UserState()
    return user_states[user_id]

def _device_to_api(d: Device, state: UserState, offline_after_s: float) -> Dict[str, Any]:
    now = _utc_now()
    age_s = (now - d.last_seen).total_seconds()
    status = "offline" if age_s > offline_after_s else "online"
    bw = getattr(d, "bandwidth_bps", 0.0)
    classification = state.ai_engine.classify_device(d, now)
    first_seen = state.first_seen.get(d.mac)
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


# Auth Endpoints
class AuthRegister(BaseModel):
    email: str
    password: str

class AuthLogin(BaseModel):
    email: str
    password: str

@app.post("/api/auth/register")
def register(req: AuthRegister):
    res = database.create_user(req.email, req.password)
    if "error" in res:
        raise HTTPException(status_code=400, detail=res["error"])
    return res

@app.post("/api/auth/login")
def login(req: AuthLogin):
    res = database.verify_user(req.email, req.password)
    if not res:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return res

async def get_user_from_header(x_api_key: str = Header(...)):
    user = database.get_user_by_api_key(x_api_key)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid API Key")
    return user


# Agent Endpoints
class AgentPushRequest(BaseModel):
    devices: List[Dict[str, Any]]
    host_info: Dict[str, Any]

@app.post("/api/agent/push")
async def agent_push(req: AgentPushRequest, user: dict = Depends(get_user_from_header)):
    user_id = user["id"]
    state = get_user_state(user_id)
    
    # Hydrate raw dicts into Device dataclasses
    now = _utc_now()
    parsed_devices = []
    for d_dict in req.devices:
        last_seen = d_dict.get("last_seen")
        if isinstance(last_seen, str):
            try:
                last_seen = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
            except:
                last_seen = now
        else:
            last_seen = now
            
        dev = Device(
            ip=d_dict["ip"],
            mac=d_dict["mac"],
            vendor=d_dict["vendor"],
            last_seen=last_seen,
            ping_ms=d_dict.get("ping_ms"),
            bandwidth_bps=d_dict.get("bandwidth_bps", 0.0),
            os_ttl=d_dict.get("os_ttl"),
            hostname=d_dict.get("hostname"),
            upnp_model=d_dict.get("upnp_model"),
            nmap_os=d_dict.get("nmap_os"),
            ping_history=d_dict.get("ping_history", [])
        )
        parsed_devices.append(dev)
        
    state.latest_devices = parsed_devices
    state.host_info = req.host_info
    
    # Update AI Engine
    try:
        state.ai_engine.update(state.latest_devices)
    except Exception as e:
        print(f"Error updating AI state for {user_id}: {e}")
        
    # Update first seen
    utcnow = _utc_now()
    for d in state.latest_devices:
        if d.mac not in state.first_seen:
            state.first_seen[d.mac] = utcnow
    state.last_seen_ips = {d.ip for d in state.latest_devices}

    # Run background tasks asynchronously
    asyncio.create_task(run_agent_logger(user_id, state))
    asyncio.create_task(run_agent_dvr(user_id, state))
    
    return {"status": "ok", "devices_accepted": len(state.latest_devices)}


async def run_agent_logger(user_id: int, state: UserState):
    now = time.time()
    if now - state.last_logger_run < 10.0:
        return
    state.last_logger_run = now
    
    devices = state.latest_devices
    current_macs = set(d.mac for d in devices)
    new_macs = current_macs - set(state.first_seen.keys())
    
    for mac in new_macs:
        d = next((x for x in devices if x.mac == mac), None)
        if d:
            database.log_event(user_id, "CONNECT", d.ip, d.mac, {"vendor": d.vendor})
            
    for d in devices:
        bw = getattr(d, 'bandwidth_bps', 0)
        if bw > 500000:
            database.log_event(user_id, "HIGH_BANDWIDTH", d.ip, d.mac, {"bps": bw})


async def run_agent_dvr(user_id: int, state: UserState):
    now = time.time()
    if now - state.last_dvr_snapshot < 20.0:
        return
    state.last_dvr_snapshot = now
    
    if state.latest_devices:
        data = [_device_to_api(d, state, offline_after_s=120.0) for d in state.latest_devices]
        database.save_snapshot(user_id, data)
        
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
        
        database.add_rag_document(
            doc_id=f"{user_id}_{time.time()}",
            text=summary,
            metadata={"user_id": user_id, "timestamp": time.time(), "device_count": len(active), "avg_ping": float(avg_ping)}
        )

# Frontend Endpoints (Requires User Header/Auth)
@app.get("/api/devices")
async def get_devices(user: dict = Depends(get_user_from_header)) -> Dict[str, Any]:
    state = get_user_state(user["id"])
    data = [_device_to_api(d, state, offline_after_s=120.0) for d in state.latest_devices]
    return {"type": "devices", "data": data, "timestamp": _iso(_utc_now()), "error": None}

@app.get("/api/dvr/bounds")
def get_dvr_bounds(user: dict = Depends(get_user_from_header)):
    user_id = user["id"]
    from backend.database import get_db_connection
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT MIN(timestamp), MAX(timestamp) FROM snapshots WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    if not row or row[0] is None:
        return {"min": 0, "max": 0}
    return {"min": row[0], "max": row[1]}

@app.get("/api/dvr/snapshot/{ts}")
def get_dvr_snapshot(ts: float, user: dict = Depends(get_user_from_header)):
    user_id = user["id"]
    from backend.database import get_db_connection
    import json
    conn = get_db_connection()
    c = conn.cursor()
    # Find closest snapshot within 30 seconds
    c.execute("SELECT data FROM snapshots WHERE user_id = ? AND timestamp >= ? ORDER BY timestamp ASC LIMIT 1", (user_id, ts - 15))
    row = c.fetchone()
    conn.close()
    if not row:
        return {"data": []}
    try:
        return {"data": json.loads(row[0])}
    except:
        return {"data": []}

@app.websocket("/ws")
async def ws_devices(ws: WebSocket):
    # Retrieve api key from query param for websocket
    api_key = ws.query_params.get("api_key")
    if not api_key:
        await ws.close(code=1008)
        return
        
    user = database.get_user_by_api_key(api_key)
    if not user:
        await ws.close(code=1008)
        return
        
    await ws.accept()
    user_id = user["id"]
    state = get_user_state(user_id)
    previous_anomalies = set()
    
    while True:
        try:
            offline_after_s = 120.0
            devices = state.latest_devices
            
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
            data = [_device_to_api(d, state, offline_after_s) for d in devices]
            
            payload = {
                "type": "devices",
                "data": data,
                "timestamp": _iso(_utc_now()),
                "error": None,
                "host_info": state.host_info
            }
            
            await ws.send_json(payload)
            await asyncio.sleep(5)
            
        except WebSocketDisconnect:
            break
        except Exception as e:
            print(f"WebSocket unhandled error: {e}")
            break


class ChatRequest(BaseModel):
    message: str

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest, user: dict = Depends(get_user_from_header)):
    try:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key: return {"response": "GEMINI_API_KEY is not configured."}
        client = google_genai.Client(api_key=api_key)
        
        state = get_user_state(user["id"])
        devices = state.latest_devices
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
            f"SNAPSHOT: Total: {len(devices)}, Active: {len(active)}.\n"
            f"TYPES: {types}.\n"
            f"TOP 5 PINGS: " + ", ".join([f"{d.ip}: {int(d.ping_ms)}ms" for d in top_degraded]) + ".\n"
            f"ANOMALIES: {len(anomalies)} detected.\n"
            f"Keep your answers strictly under 3 sentences. Use markdown to answer directly.\n\n"
            f"USER QUERY: {req.message}"
        )
        
        response = client.models.generate_content(model='gemini-2.0-flash', contents=context_str[:2000])
        return {"response": response.text}
    except Exception as e:
        return {"response": f"Error calling AI: {str(e)}"}

@app.post("/api/rag/query")
async def rag_query_endpoint(req: ChatRequest, user: dict = Depends(get_user_from_header)):
    try:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key: return {"response": "GEMINI_API_KEY is not configured."}
            
        docs = database.query_rag_documents(req.message, n_results=5)
        # Filter for user_id natively in chroma logic (left simple for now)
        context_str = "\n".join([f"- {d}" for d in docs])
        
        state = get_user_state(user["id"])
        live_count = len([d for d in state.latest_devices if d.ping_ms is not None])
        
        full_prompt = (
            f"SYSTEM: You are OmniSight, an AI network assistant.\n"
            f"Your knowledge incorporates natively embedded historical network logs (RAG).\n\n"
            f"HISTORICAL SCANS (from ChromaDB):\n{context_str}\n\n"
            f"CURRENT STATE: {live_count} active devices right now.\n\n"
            f"USER QUERY: {req.message}\n"
            f"Provide a concise summary answering the user's question, strictly under 3 sentences. Use markdown."
        )
        
        client = google_genai.Client(api_key=api_key)
        response = client.models.generate_content(model='gemini-2.0-flash', contents=full_prompt)
        return {"response": response.text}
    except Exception as e:
        return {"response": f"RAG AI Error: {str(e)}"}