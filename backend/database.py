import sqlite3
import json
import time
from datetime import datetime, timezone
import os
import chromadb

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "network_events.db")
CHROMA_PATH = os.path.join(os.path.dirname(__file__), "..", "chroma_db")
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
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            timestamp REAL,
            state TEXT
        )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_snapshots_time ON snapshots (timestamp)')
    conn.commit()
    conn.close()

def log_event(event_type: str, ip: str, mac: str, details: dict):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        INSERT INTO events (timestamp, event_type, ip, mac, details)
        VALUES (?, ?, ?, ?, ?)
    ''', (time.time(), event_type, ip, mac, json.dumps(details)))
    conn.commit()
    conn.close()

def get_recent_events(minutes: int = 60):
    cutoff = time.time() - (minutes * 60)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        SELECT timestamp, event_type, ip, mac, details 
        FROM events 
        WHERE timestamp >= ?
        ORDER BY timestamp DESC
    ''', (cutoff,))
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

def cleanup_snapshots(hours: int = 24):
    cutoff = time.time() - (hours * 3600)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('DELETE FROM snapshots WHERE timestamp < ?', (cutoff,))
    conn.commit()
    conn.close()

def save_snapshot(devices_dict_list: list):
    cleanup_snapshots(24) # Auto prune
    js = json.dumps(devices_dict_list)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('INSERT INTO snapshots (timestamp, state) VALUES (?, ?)', (time.time(), js))
    conn.commit()
    conn.close()

def get_dvr_bounds():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT MIN(timestamp), MAX(timestamp) FROM snapshots')
    row = c.fetchone()
    conn.close()
    if not row or not row[0]: return 0.0, 0.0
    return row[0], row[1]

def get_snapshot_at(ts: float):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    # Find the snapshot closest to requested timestamp natively
    c.execute('''
        SELECT state FROM snapshots 
        ORDER BY ABS(timestamp - ?) ASC 
        LIMIT 1
    ''', (ts,))
    row = c.fetchone()
    conn.close()
    if row and row[0]:
        try:
            return json.loads(row[0])
        except Exception: pass
    return []

# Ensure DB is created on import
init_db()
