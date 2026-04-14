"use client";

import { useNetworkStore, Device } from "@/store/useNetworkStore";
import { motion, AnimatePresence } from "framer-motion";
import { X, WifiHigh, ActivitySquare, Server, Link2, ShieldAlert } from "lucide-react";
import { useMemo, useEffect, useState } from "react";

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default function BandwidthPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const devices = useNetworkStore(state => state.activeDevices);
  const hostInfo = useNetworkStore(state => state.hostInfo);

  // State to track Per-Second speeds and Anomaly Spikes
  const [prevHostInfo, setPrevHostInfo] = useState(hostInfo);
  const [speeds, setSpeeds] = useState({ sent: 0, recv: 0 });
  const [prevAvgPing, setPrevAvgPing] = useState(0);
  const [stressEvent, setStressEvent] = useState<{ time: string, msg: string } | null>(null);

  useEffect(() => {
    if (hostInfo && prevHostInfo) {
      const dSent = Math.max(0, hostInfo.bytes_sent - prevHostInfo.bytes_sent);
      const dRecv = Math.max(0, hostInfo.bytes_recv - prevHostInfo.bytes_recv);
      setSpeeds({ sent: dSent / 5.0, recv: dRecv / 5.0 }); // 5 second polling interval estimate
    }
    setPrevHostInfo(hostInfo);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostInfo]);

  const activeDevices = devices.filter(d => d.status === 'online' && d.ping_history && d.ping_history.length > 0);
  
  // Overall congested logic
  const avgPingAll = activeDevices.length > 0 ? activeDevices.reduce((sum, d) => sum + (d.ping_ms || 0), 0) / activeDevices.length : 0;
  
  useEffect(() => {
     if (prevAvgPing > 0 && avgPingAll > prevAvgPing * 1.5 && avgPingAll > 60) {
        setStressEvent({
           time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' }),
           msg: `Sudden latency spike (Avg: ${Math.round(avgPingAll)}ms)`
        });
     }
     if (avgPingAll > 0) setPrevAvgPing(avgPingAll);
  }, [avgPingAll, prevAvgPing]);

  const devicesOver300 = activeDevices.filter(d => (d.ping_ms || 0) > 300).length;
  const devicesOver200 = activeDevices.filter(d => (d.ping_ms || 0) > 200).length;
  
  let congestionStr = "✅ Network Healthy";
  let congestionCol = "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
  
  if (devicesOver200 > 10) { 
    congestionStr = "🔴 Network Congested"; 
    congestionCol = "text-rose-400 bg-rose-500/10 border-rose-500/30"; 
  } else if (devicesOver300 > 0) { 
    congestionStr = "⚠️ High Latency Detected"; 
    congestionCol = "text-amber-400 bg-amber-500/10 border-amber-500/30"; 
  }

  // Sort descending by highest ping to expose degraded connections
  const matrixDevices = [...activeDevices]
    .sort((a, b) => (b.ping_ms || 0) - (a.ping_ms || 0))
    .slice(0, 10);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
            onClick={onClose}
          />
          <motion.div 
            initial={{ x: "100%", opacity: 0 }} 
            animate={{ x: 0, opacity: 1 }} 
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 w-[460px] bg-[#050505]/95 backdrop-blur-2xl border-l border-white/10 z-50 overflow-y-auto flex flex-col shadow-2xl"
          >
            <div className="p-6 border-b border-neutral-800 flex justify-between items-center sticky top-0 z-10 bg-[#050505]/80 backdrop-blur-xl">
               <div className="flex items-center gap-3">
                 <div className="bg-emerald-500/20 p-2 rounded-lg border border-emerald-500/30">
                   <WifiHigh size={20} className="text-emerald-400" />
                 </div>
                 <h2 className="text-white font-bold text-lg tracking-tight">Bandwidth Probe</h2>
               </div>
               <button onClick={onClose} className="text-neutral-400 hover:text-white bg-white/5 hover:bg-white/10 p-2 rounded-full transition-all">
                 <X size={18} />
               </button>
            </div>

            <div className="p-6 flex flex-col gap-8">
              
              {/* Disclaimer */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                 <ShieldAlert size={18} className="text-amber-400 shrink-0 mt-0.5" />
                 <p className="text-xs text-amber-200/90 leading-relaxed font-medium">
                   <strong className="text-amber-400 font-bold block mb-1">Shared Campus Network Disclaimer</strong>
                   Due to wireless non-promiscuous adapter limitations, we can only safely measure your own machine's specific network interface usage, not other devices.
                 </p>
              </div>

              {/* Congestion & Stress Info */}
              <div className="flex flex-col gap-3">
                 <h3 className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Global Telemetry Status</h3>
                 <div className={`p-4 rounded-xl border flex items-center justify-between ${congestionCol}`}>
                    <div className="flex items-center gap-3">
                       <ActivitySquare size={24} />
                       <div className="flex flex-col">
                          <span className="font-bold text-sm tracking-tight">{congestionStr}</span>
                          <span className="text-[10px] opacity-70 font-semibold uppercase">{Math.round(avgPingAll)} ms average network sector ping</span>
                       </div>
                    </div>
                 </div>
                 {stressEvent && (
                    <div className="mt-1 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 flex flex-col gap-1 mx-1">
                       <span className="text-rose-400 font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                         <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" /> Network Stress Indicator
                       </span>
                       <span className="text-rose-200/80 text-xs">{stressEvent.msg} at {stressEvent.time}</span>
                    </div>
                 )}
              </div>

              {/* Host Stats */}
              <div className="flex flex-col gap-3">
                 <h3 className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Local Host Uplink</h3>
                 <div className="grid grid-cols-2 gap-3">
                    <StatBlock label="Upload Speed" value={`${formatBytes(speeds.sent)}/s`} icon={<Server size={14}/>} tint="text-blue-400" />
                    <StatBlock label="Download Speed" value={`${formatBytes(speeds.recv)}/s`} icon={<Server size={14}/>} tint="text-emerald-400" />
                    <StatBlock label="Total Sent Tracker" value={formatBytes(hostInfo?.bytes_sent || 0)} icon={<Link2 size={14}/>} />
                    <StatBlock label="Total Received" value={formatBytes(hostInfo?.bytes_recv || 0)} icon={<Link2 size={14}/>} />
                 </div>
                 {hostInfo?.iface && (
                   <div className="mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/5 text-xs text-neutral-400 font-mono flex items-center gap-2">
                     <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Bound to: {hostInfo.iface}
                   </div>
                 )}
              </div>

              {/* Node Matrix */}
              <div className="flex flex-col gap-3 pb-8">
                 <h3 className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Degraded Connections & Health (Top 10)</h3>
                 <div className="flex flex-col border border-white/10 rounded-xl overflow-hidden bg-black/20">
                    <div className="grid grid-cols-[1fr_80px_50px_60px] text-[9px] font-bold uppercase tracking-widest text-neutral-500 p-3 bg-white/5 border-b border-white/10">
                       <span>Target IP Node</span>
                       <span>Type</span>
                       <span className="text-center">Ping</span>
                       <span className="text-right">5-Tick</span>
                    </div>
                    {matrixDevices.length === 0 ? (
                       <div className="p-8 text-center text-xs text-neutral-500 italic">Awaiting sufficient ping telemetry...</div>
                    ) : (
                       matrixDevices.map((d, i) => <NodeRow key={d.ip} d={d} i={i} />)
                    )}
                 </div>
              </div>

            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function StatBlock({ label, value, icon, tint = "text-white" }: { label: string, value: string, icon: React.ReactNode, tint?: string }) {
  return (
    <div className="flex flex-col gap-1.5 p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
      <div className="flex items-center gap-1.5 text-[10px] font-bold text-neutral-500 uppercase">
        {icon} {label}
      </div>
      <div className={`text-lg font-bold font-mono tracking-tight ${tint}`}>
        {value}
      </div>
    </div>
  )
}

function NodeRow({ d, i }: { d: Device, i: number }) {
  const history = d.ping_history || [];
  
  // Stability proxy: variance
  const max = Math.max(...history, 1);
  const min = Math.min(...history);
  const variance = max - min;
  
  const pingMs = d.ping_ms || 0;
  
  let dotColor = "bg-emerald-500/50 border-emerald-500";
  let txtColor = "text-emerald-400";
  
  if (pingMs > 200 || variance > 100) { dotColor = "bg-rose-500/50 border-rose-500"; txtColor = "text-rose-400"; }
  else if (pingMs > 80 || variance > 40) { dotColor = "bg-amber-500/50 border-amber-500"; txtColor = "text-amber-400"; }

  // SVG Sparkline Polyline Generation
  const svgW = 60; const svgH = 16;
  const pathMax = Math.max(...history, 50);
  const points = history.map((val, idx) => {
    const x = (idx / Math.max(1, history.length - 1)) * svgW;
    const y = svgH - ((val / pathMax) * svgH);
    return `${x},${Math.max(1, Math.min(svgH-1, y))}`;
  }).join(" ");

  return (
    <div className={`grid grid-cols-[1fr_80px_50px_60px] items-center p-3 text-xs ${i !== 0 ? 'border-t border-white/5' : ''} hover:bg-white/5 transition-colors`}>
       <div className="flex items-center gap-2.5 font-mono text-neutral-300">
         <div className={`w-2 h-2 rounded-full border ${dotColor}`} title={pingMs > 200 ? "Degraded" : "Nominal"} />
         {d.ip}
       </div>
       <div className="text-[9px] text-neutral-500 font-bold uppercase tracking-widest truncate pr-2">
         {d.device_type || 'Unknown'}
       </div>
       <div className={`text-center font-bold font-mono ${txtColor}`}>
         {Math.round(pingMs)}
       </div>
       <div className="flex justify-end">
         {history.length > 1 ? (
            <svg width={svgW} height={svgH} className="overflow-visible">
               <polyline points={points} fill="none" stroke={dotColor.includes('rose') ? '#fb7185' : '#34d399'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
         ) : (
            <span className="text-[10px] text-neutral-600 font-medium">Wait...</span>
         )}
       </div>
    </div>
  )
}
