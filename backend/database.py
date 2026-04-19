import sqlite3
import json
import time
from datetime import datetime, timezone
import os
import chromadb

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "saas_events.db")
CHROMA_PATH = os.path.join(os.path.dirname(__file__), "..", "chroma_saas_db")
chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)
scans_collection = chroma_client.get_or_create_collection(name="network_scans")

def add_rag_document(doc_id: str, text: str, metadata: dict):
    scans_collection.add(
        documents=[text],
        metadatas=[metadata],
        ids=[doc_id]
    )

def query_rag_documents(query_text: str, n_results: int = 5):
    results = scans_collection.query(
        query_texts=[query_text],
        n_results=n_results
    )
    if results and "documents" in results and len(results["documents"]) > 0:
        return results["documents"][0]
    return []

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE,
            password_hash TEXT,
            api_key TEXT UNIQUE,
            created_at REAL
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            timestamp REAL,
            event_type TEXT,
            ip TEXT,
            mac TEXT,
            details TEXT
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            timestamp REAL,
            state TEXT
        )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_snapshots_time ON snapshots (timestamp)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_snapshots_user ON snapshots (user_id)')
    conn.commit()
    conn.close()

def log_event(user_id: int, event_type: str, ip: str, mac: str, details: dict):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        INSERT INTO events (user_id, timestamp, event_type, ip, mac, details)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (user_id, time.time(), event_type, ip, mac, json.dumps(details)))
    conn.commit()
    conn.close()

def get_recent_events(user_id: int, minutes: int = 60):
    cutoff = time.time() - (minutes * 60)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        SELECT timestamp, event_type, ip, mac, details 
        FROM events 
        WHERE user_id = ? AND timestamp >= ?
        ORDER BY timestamp DESC
    ''', (user_id, cutoff))
    rows = c.fetchall()
    conn.close()
    
    events = []
    for r in rows:
        events.append({
            "timestamp": datetime.fromtimestamp(r[0], tz=timezone.utc).isoformat(),
            "event_type": r[1],
            "ip": r[2],
            "mac": r[3],
            "details": json.loads(r[4])
        })
    return events

    return events

def cleanup_snapshots(user_id: int, hours: int = 24):
    cutoff = time.time() - (hours * 3600)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('DELETE FROM snapshots WHERE user_id = ? AND timestamp < ?', (user_id, cutoff))
    conn.commit()
    conn.close()

def save_snapshot(user_id: int, devices_dict_list: list):
    cleanup_snapshots(user_id, 24) # Auto prune
    js = json.dumps(devices_dict_list)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('INSERT INTO snapshots (user_id, timestamp, state) VALUES (?, ?, ?)', (user_id, time.time(), js))
    conn.commit()
    conn.close()

def get_dvr_bounds(user_id: int):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT MIN(timestamp), MAX(timestamp) FROM snapshots WHERE user_id = ?', (user_id,))
    row = c.fetchone()
    conn.close()
    if not row or not row[0]: return 0.0, 0.0
    return row[0], row[1]

def get_snapshot_at(user_id: int, ts: float):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        SELECT state FROM snapshots 
        WHERE user_id = ?
        ORDER BY ABS(timestamp - ?) ASC 
        LIMIT 1
    ''', (user_id, ts))
    row = c.fetchone()
    conn.close()
    if row and row[0]:
        try:
            return json.loads(row[0])
        except Exception: pass
    return []

def get_user_by_api_key(api_key: str):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT id, email, created_at FROM users WHERE api_key = ?', (api_key,))
    row = c.fetchone()
    conn.close()
    if row:
        return {"id": row[0], "email": row[1], "api_key": api_key, "created_at": row[2]}
    return None

import uuid
def create_user(email: str, password_hash: str) -> dict:
    api_key = str(uuid.uuid4())
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    try:
        c.execute('INSERT INTO users (email, password_hash, api_key, created_at) VALUES (?, ?, ?, ?)',
                  (email, password_hash, api_key, time.time()))
        user_id = c.lastrowid
        conn.commit()
        return {"id": user_id, "email": email, "api_key": api_key}
    except Exception as e:
        return {"error": str(e)}
    finally:
        conn.close()

def verify_user(email: str, password_hash: str):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT id, api_key FROM users WHERE email = ? AND password_hash = ?', (email, password_hash))
    row = c.fetchone()
    conn.close()
    if row:
        return {"id": row[0], "email": email, "api_key": row[1]}
    return None

# Ensure DB is created on import
init_db()
