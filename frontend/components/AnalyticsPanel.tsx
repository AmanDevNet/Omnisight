"use client";

import { useNetworkStore } from "@/store/useNetworkStore";
import { motion, AnimatePresence } from "framer-motion";
import { X, Activity, AlertTriangle, Monitor, Smartphone, Server, HelpCircle } from "lucide-react";
import { useMemo } from "react";

export default function AnalyticsPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const devices = useNetworkStore(state => state.activeDevices);
  const timeline = useNetworkStore(state => state.historyTimeline);

  // 1. Device Breakdown
  const typeCounts = useMemo(() => {
    let win = 0; let mobile = 0; let infra = 0; let unk = 0;
    devices.forEach(d => {
      const ts = (d.device_type || "").toLowerCase();
      if (ts.includes("windows") || ts.includes("laptop") || ts.includes("pc") || ts.includes("macbook")) win++;
      else if (ts.includes("phone") || ts.includes("mobile") || ts.includes("android") || ts.includes("ios") || ts.includes("apple")) mobile++;
      else if (ts.includes("infrastructure") || ts.includes("router") || ts.includes("ap")) infra++;
      else unk++;
    });
    return { win, mobile, infra, unk };
  }, [devices]);

  // 2. OS Distribution (TTL)
  const osCounts = useMemo(() => {
    let win = 0; let lin = 0; let infra = 0; let unk = 0;
    devices.forEach(d => {
      if (d.os_ttl === 128) win++;
      else if (d.os_ttl === 64) lin++;
      else if (d.os_ttl === 255) infra++;
      else unk++;
    });
    return { win, lin, infra, unk };
  }, [devices]);

  // 3. Latency Distribution
  const latCounts = useMemo(() => {
    let fast = 0; let mid = 0; let slow = 0; let unk = 0;
    devices.forEach(d => {
      if (d.ping_ms === null) unk++;
      else if (d.ping_ms < 20) fast++;
      else if (d.ping_ms <= 100) mid++;
      else slow++;
    });
    return { fast, mid, slow, unk };
  }, [devices]);

  // 4. Anomaly Log
  const anomalies = useMemo(() => {
    return devices.filter(d => d.is_anomalous).slice(0, 10); // Simulating anomaly list from active state
  }, [devices]);

  // 5. Top 10 Worst Latency
  const worstLatency = useMemo(() => {
    return [...devices].filter(d => d.ping_ms !== null).sort((a, b) => (b.ping_ms || 0) - (a.ping_ms || 0)).slice(0, 10);
  }, [devices]);

  // Timeline SVG Generation
  const maxCount = Math.max(1, ...timeline.map(t => t.count), 50);
  const points = timeline.map((pt, i) => `${(i / Math.max(1, timeline.length - 1)) * 100},${100 - ((pt.count / maxCount) * 100)}`).join(" ");

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
            className="fixed right-0 top-0 bottom-0 w-[420px] bg-[#0a0a0a]/95 backdrop-blur-2xl border-l border-white/10 z-50 overflow-y-auto flex flex-col shadow-2xl"
          >
            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5 sticky top-0 z-10">
               <div className="flex items-center gap-3">
                 <div className="bg-blue-500/20 p-2 rounded-lg border border-blue-500/30">
                   <Activity size={20} className="text-blue-400" />
                 </div>
                 <h2 className="text-white font-bold text-lg tracking-tight">Network Analytics</h2>
               </div>
               <button onClick={onClose} className="text-neutral-400 hover:text-white bg-white/5 hover:bg-white/10 p-2 rounded-full transition-all">
                 <X size={18} />
               </button>
            </div>

            <div className="p-6 flex flex-col gap-8">
              
              {/* Component 1: Timeline Map */}
              <div className="flex flex-col gap-3">
                <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Network Timeline (Last 30 Scans)</h3>
                <div className="h-32 bg-black/40 rounded-xl border border-white/5 relative p-2 overflow-hidden flex items-end">
                   {timeline.length > 1 ? (
                     <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
                       <polyline points={points} fill="none" stroke="#3b82f6" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                       <path d={`M 0,100 L ${points} L 100,100 Z`} fill="url(#gradient)" opacity="0.3" />
                       <defs>
                          <linearGradient id="gradient" x1="0" x2="0" y1="0" y2="1">
                             <stop offset="0%" stopColor="#3b82f6" />
                             <stop offset="100%" stopColor="transparent" />
                          </linearGradient>
                       </defs>
                     </svg>
                   ) : (
                     <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-600">Gathering telemetry...</div>
                   )}
                </div>
              </div>

              {/* Component 2: Dual OS / Device breakdowns */}
              <div className="grid grid-cols-2 gap-4">
                 <div className="flex flex-col gap-3">
                    <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Hardware</h3>
                    <div className="flex flex-col gap-2">
                       <Bar id="PC" val={typeCounts.win} total={devices.length} color="bg-blue-500" icon={<Monitor size={12}/>} />
                       <Bar id="Mobile" val={typeCounts.mobile} total={devices.length} color="bg-green-500" icon={<Smartphone size={12}/>} />
                       <Bar id="AP" val={typeCounts.infra} total={devices.length} color="bg-orange-500" icon={<Server size={12}/>} />
                       <Bar id="Unk" val={typeCounts.unk} total={devices.length} color="bg-neutral-500" icon={<HelpCircle size={12}/>} />
                    </div>
                 </div>

                 <div className="flex flex-col gap-3">
                    <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Operating Systems</h3>
                    <div className="flex flex-col gap-2">
                       <Bar id="Windows" val={osCounts.win} total={devices.length} color="bg-blue-400" />
                       <Bar id="Lin/iOS" val={osCounts.lin} total={devices.length} color="bg-green-400" />
                       <Bar id="Infra" val={osCounts.infra} total={devices.length} color="bg-orange-400" />
                       <Bar id="Unknown" val={osCounts.unk} total={devices.length} color="bg-neutral-500" />
                    </div>
                 </div>
              </div>

              {/* Component 3: Latency Distribution */}
              <div className="flex flex-col gap-3">
                 <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Latency Distribution</h3>
                 <div className="flex h-4 rounded-full overflow-hidden w-full bg-black/40">
                    <div style={{ width: `${(latCounts.fast / Math.max(1, devices.length)) * 100}%` }} className="bg-emerald-500 transition-all duration-500" title="<20ms" />
                    <div style={{ width: `${(latCounts.mid / Math.max(1, devices.length)) * 100}%` }} className="bg-amber-500 transition-all duration-500" title="20-100ms" />
                    <div style={{ width: `${(latCounts.slow / Math.max(1, devices.length)) * 100}%` }} className="bg-rose-500 transition-all duration-500" title=">100ms" />
                    <div style={{ width: `${(latCounts.unk / Math.max(1, devices.length)) * 100}%` }} className="bg-neutral-600 transition-all duration-500" title="Timeout" />
                 </div>
                 <div className="flex justify-between text-[10px] text-neutral-400 font-medium px-1">
                    <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500"/>&lt;20ms ({latCounts.fast})</span>
                    <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-500"/>20-100ms ({latCounts.mid})</span>
                    <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-rose-500"/>&gt;100ms ({latCounts.slow})</span>
                 </div>
              </div>

              {/* Component 4: Worst Latencies */}
              <div className="flex flex-col gap-3">
                 <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Top 10 Latency Degradations</h3>
                 <div className="flex flex-col gap-1">
                   {worstLatency.map((d, i) => (
                     <div key={d.ip} className="flex justify-between items-center p-2.5 rounded-lg bg-white/[0.03] hover:bg-white/10 transition-all border border-transparent hover:border-white/10 group cursor-pointer">
                        <div className="flex items-center gap-3">
                           <span className="text-[10px] font-bold text-neutral-600 w-3">{i + 1}</span>
                           <div className="flex flex-col">
                             <span className="text-xs text-neutral-200 font-mono">{d.ip}</span>
                             <span className="text-[10px] text-neutral-500">{d.device_type || 'Unknown'}</span>
                           </div>
                        </div>
                        <div className={`text-xs font-bold font-mono ${(d.ping_ms||0) > 100 ? 'text-rose-400' : 'text-amber-400'}`}>
                           {Math.round(d.ping_ms||0)} ms
                        </div>
                     </div>
                   ))}
                   {worstLatency.length === 0 && <span className="text-xs text-neutral-600 italic px-2">No active ICMP/ARP latency buffers detected.</span>}
                 </div>
              </div>

              {/* Component 5: Anomalies */}
              <div className="flex flex-col gap-3">
                 <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Anomaly Log</h3>
                 <div className="flex flex-col gap-2">
                   {anomalies.map(a => (
                     <div key={a.ip} className="flex items-start gap-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20">
                       <AlertTriangle size={14} className="text-rose-400 mt-0.5 shrink-0" />
                       <div className="flex flex-col gap-0.5">
                         <span className="text-xs text-rose-200 font-semibold">{a.ip} flagged anomalous</span>
                         <span className="text-[10px] text-rose-200/60">Unexpected traffic burst or signature mismatch.</span>
                       </div>
                     </div>
                   ))}
                   {anomalies.length === 0 && (
                     <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex flex-col items-center justify-center gap-2">
                       <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                       <span className="text-xs font-medium text-emerald-400">Zero active network anomalies.</span>
                     </div>
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

function Bar({ id, val, total, color, icon }: { id: string, val: number, total: number, color: string, icon?: React.ReactNode }) {
  const pct = total === 0 ? 0 : (val / total) * 100;
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex justify-between text-[10px] uppercase font-bold text-neutral-400">
        <span className="flex items-center gap-1.5">{icon} {id}</span>
        <span>{val}</span>
      </div>
      <div className="h-1.5 w-full bg-black/50 rounded-full overflow-hidden">
         <motion.div 
           initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: "easeOut" }}
           className={`h-full ${color}`} 
         />
      </div>
    </div>
  )
}
