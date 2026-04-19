<div align="center">
  <img src="https://images.unsplash.com/photo-1550751827-4bd374c3f58b?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80" alt="OmniSight Banner" width="100%" style="border-radius: 10px; margin-bottom: 20px;"/>
  
  <h1>OmniSight Network Visualizer</h1>
  <p><strong>Cloud-Native 3D Network Telemetry & AI Anomaly Detection</strong></p>

  <p>
    <a href="https://github.com/AmanDevNet/Omnisight/commits"><img src="https://img.shields.io/github/last-commit/AmanDevNet/Omnisight?style=flat-square&color=06b6d4" alt="Last Commit"></a>
    <a href="https://fastapi.tiangolo.com/"><img src="https://img.shields.io/badge/FastAPI-005571?style=flat-square&logo=fastapi" alt="FastAPI"></a>
    <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=nextdotjs&logoColor=white" alt="Next.js"></a>
    <a href="https://docs.pmnd.rs/react-three-fiber"><img src="https://img.shields.io/badge/React_Three_Fiber-444444?style=flat-square&logo=react" alt="R3F"></a>
  </p>
</div>

---

## 📖 What is OmniSight?

**OmniSight** is an advanced network monitoring platform that transforms invisible network traffic into an interactive, real-time 3D visualization. 

Instead of reading through endless lists of IP addresses and static logs, OmniSight provides administrators with a dynamic "spatial map" of their network. It actively profiles connected devices, monitors bandwidth consumption, and utilizes Machine Learning to alert users the second an unrecognized or anomalous device breaches the network. 

Built as a modern **SaaS application**, OmniSight allows users to deploy a lightweight packet-sniffing "Agent" on any local network, which then securely streams the data up to a cloud dashboard accessible from anywhere in the world.

---

## 🏗️ Technical Architecture

OmniSight operates using a distributed **Cloud/Edge** architecture, divided into three distinct systems:

1. **The Edge Agent (`/agent_run.py`)**
   A highly concurrent Python scanner that sits on the user's local network. It performs low-level packet sniffing (Scapy), ARP sweeps, ICMP pings, and mDNS/SSDP service discovery to map active devices. It streams this telemetry to the cloud via secure API connections.
   
2. **The Cloud Backend (`/backend`)**
   A multi-tenant **FastAPI** server that acts as the platform's brain. 
   - Uses **WebSockets** to handle thousands of live data points per second.
   - Utilizes a **Scikit-Learn Random Forest** pipeline to dynamically classify devices based on OUI boundaries, latency variance, and TTL signatures.
   - Encompasses a **Retrieval-Augmented Generation (RAG)** pipeline utilizing **Google Gemini 2.0 Flash** over a **ChromaDB** vector store, enabling users to ask historical questions in natural language.
   - Relies on **SQLite** for persistent, tenant-isolated data storage and user authentication (JWT/API Keys).

3. **The User Interface (`/frontend`)**
   A **Next.js** web application providing a premium, glassmorphic UX. 
   - Renders devices natively in the GPU via **React Three Fiber** and WebGL.
   - **Zustand** is used to hydrate the frontend store with WebSocket streams, eliminating latency between real-world network events and the UI dashboard.

---

## ✨ Features

* **Live 3D Network Topology**: Watch devices interact in three-dimensional space with real-time ping tracking and bandwidth visualizers.
* **Threat Detection ML**: Immediately flags spoofed MAC addresses or unrecognized device signatures.
* **OmniChat (AI Analyst)**: Ask questions like *"Did any unknown devices connect last night?"* and receive mathematically accurate answers derived from vector-embedded network logs.
* **Network DVR Time Machine**: Scrub backward in time to see exactly what your network looked like during past outages or latency spikes.
* **Zero-Config Agent Deployment**: Users only need their unique API Key to start mapping out an entire TCP/IP subroutine securely.

---

## 🚀 Quick Start Guide

As a distributed application, you need to execute the API, the Web Dashboard, and the Local Agent.

### 1. Start the FastAPI Cloud Server
```bash
# Clone the repository
git clone https://github.com/AmanDevNet/Omnisight.git
cd Omnisight

# Set up Python environment & dependencies
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

# Run the backend
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Start the Next.js Frontend
```bash
# Open a new terminal
cd frontend

# Install Node dependencies
npm install

# Run the development server
npm run dev
```
> **Visit `http://localhost:3000`** in your browser, Create a new account, and copy the provided API Key.

### 3. Run the Local Agent
```bash
# Open a third terminal in the project root
set OMNISIGHT_API_KEY="YOUR_API_KEY_HERE"

# Start the packet sniffer
python agent_run.py
```
> Go back to your browser dashboard. You will instantly see your local network nodes populate the 3D space!

---

## 🔑 Environment Variables
You will need the following `.env` capabilities configured to use the AI engine securely:

```ini
# Backend (.env)
GEMINI_API_KEY=your_gemini_api_key_here

# Frontend (.env.local) - Optional for cloud deployments
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
```

---

## 📬 Contact & Creator

**Aman Sharma**  
*Full Stack Software Engineer & Cloud Systems Developer*

- 🔗 **LinkedIn:** [Aman Sharma](https://www.linkedin.com/in/AmanDevNet)
- 🐙 **GitHub:** [@AmanDevNet](https://github.com/AmanDevNet)
- ✉️ **Email:** aman.sharmadev1@gmail.com *(Please replace this with your actual email if needed prior to pushing)*

> *OmniSight was built to demonstrate proficiency in handling highly concurrent WebSocket networking, Machine Learning pipelines, and modern React Three Fiber graphics capabilities.*
