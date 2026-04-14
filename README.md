# OmniSight

OmniSight is a real-time local network visualization and monitoring tool. It tracks connected devices, analyzes network behavior for anomalies, and displays everything in an interactive 3D map.

## Overview

Most standard network scanners are blind to modern devices because of firewalls and randomized MAC addresses. OmniSight bypasses this by intercepting low-level broadcast packets to guarantee discovery.

It uses an algorithmic approach to profile each device based on its ping stability and bandwidth usage. This allows the system to identify whether a device is a phone, laptop, or router. It also detects anomalies, such as unexpected latency spikes or unknown devices connecting at odd hours.

All data is streamed live into a 3D interface, creating a spatial heatmap of your network. The system also records a history of your network state into a database, letting you query past network events using natural language commands.

## Architecture

* **Backend:** Python and FastAPI. Uses scapy for raw packet sniffing to ensure accuracy instead of standard ping sweeps.
* **Analysis Engine:** Utilizes machine learning (Random Forest and Isolation Forest) to classify device types dynamically and flag traffic anomalies.
* **Frontend:** Next.js and React Three Fiber for 3D rendering. Uses WebSockets for real-time data streaming.
* **Data Persistence:** SQLite for snapshots and ChromaDB for vector-based history search.

## Setup Instructions

**Prerequisites:** You must install Npcap on Windows for the packet sniffer to run.

1. Configure Environment:
   Open `backend/.env` and add your API key:
   ```text
   GEMINI_API_KEY=your_key_here
   ```

2. Start the Backend:
   Open a terminal as Administrator (required for packet sniffing).
   ```bash
   cd backend
   python -m venv venv
   venv\Scripts\activate
   pip install -r requirements.txt
   pip install scikit-learn chromadb google-genai
   uvicorn main:app --reload
   ```

3. Start the Frontend:
   Open a new normal terminal.
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

4. Access the dashboard at `http://localhost:3000`.
