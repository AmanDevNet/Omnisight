"use client";

import { useNetworkStore } from "@/store/useNetworkStore";
import { useEffect, useState } from "react";
import { Search, Activity, LayoutGrid, WifiHigh, RadioTower, Clock, Map } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import OmniChat from "./OmniChat";
import AnalyticsPanel from "./AnalyticsPanel";
import BandwidthPanel from "./BandwidthPanel";
import DVRScrubber from "./DVRScrubber";

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function CyberHUD() {
  const { activeDevices: devices, isConnected, isDVRMode, setDVRMode, isHeatmapVisible, setHeatmapVisible } = useNetworkStore();
  const onlineCount = devices.filter(d => d.status === 'online').length;
  const anomalousCount = devices.filter(d => d.is_anomalous).length;
  const totalBandwidth = devices.reduce((acc, d) => acc + (d.bandwidth_bps || 0), 0);

  const [sysTime, setSysTime] = useState<string>("");
  const [isOmniOpen, setIsOmniOpen] = useState(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [isBandwidthOpen, setIsBandwidthOpen] = useState(false);

  useEffect(() => {
    setSysTime(new Date().toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute:'2-digit' }));
    const interval = setInterval(() => setSysTime(new Date().toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute:'2-digit' })), 1000);
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOmniOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('keydown', handleKeyDown);
    }
  }, []);

  return (
    <>
      <OmniChat isOpen={isOmniOpen} onClose={() => setIsOmniOpen(false)} />
      <AnalyticsPanel isOpen={isAnalyticsOpen} onClose={() => setIsAnalyticsOpen(false)} />
      <BandwidthPanel isOpen={isBandwidthOpen} onClose={() => setIsBandwidthOpen(false)} />
      <DVRScrubber />
      
      {/* Heatmap Legend */}
      <AnimatePresence>
        {isHeatmapVisible && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-8 right-8 z-40 bg-[#0a0a0a]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-[0_0_40px_rgba(0,0,0,0.8)] flex flex-col gap-3 pointer-events-none"
          >
            <h3 className="text-white text-[10px] font-black uppercase tracking-widest border-b border-white/10 pb-2 mb-1 opacity-80">Signal Topology</h3>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
              <span className="text-neutral-300 text-xs font-medium">{'<20ms'} <span className="text-neutral-500 ml-1">Strong</span></span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]" />
              <span className="text-neutral-300 text-xs font-medium">{'20-100ms'} <span className="text-neutral-500 ml-1">Medium</span></span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
              <span className="text-neutral-300 text-xs font-medium">{'>100ms'} <span className="text-neutral-500 ml-1">Weak</span></span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-neutral-800 border border-neutral-700" />
              <span className="text-neutral-300 text-xs font-medium">Offline <span className="text-neutral-500 ml-1">No Ping</span></span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between p-6">
      
      {/* Top Floating Header - 'Dynamic Island' style */}
      <motion.div 
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-full flex justify-center pointer-events-auto"
      >
        <div className="flex items-center gap-6 bg-[#0a0a0a]/80 backdrop-blur-xl border border-white/10 rounded-full px-6 py-3 shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
          
          <div className="flex items-center gap-2 pr-6 border-r border-white/10">
            <RadioTower size={16} className={isConnected ? "text-emerald-400" : "text-neutral-500"} />
            <span className="text-sm font-medium text-white tracking-tight flex items-center gap-2">
               Omni<span className="text-neutral-500">Sight</span>
               {isDVRMode && (
                  <span className="bg-rose-500 text-black text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded shadow-[0_0_10px_rgba(244,63,94,0.4)]">
                     Historical
                  </span>
               )}
            </span>
          </div>

          <div className="flex items-center gap-8 text-sm">
             <div className="flex flex-col">
               <span className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider">Nodes</span>
               <span className="text-white font-medium">{onlineCount} <span className="text-neutral-600">/ {devices.length}</span></span>
             </div>
             
             <div className="flex flex-col">
               <span className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider">Traffic</span>
               <span className="text-white font-medium">{formatBytes(totalBandwidth)}</span>
             </div>

             <div className="flex flex-col">
               <span className="text-[10px] text-neutral-500 font-medium uppercase tracking-wider">Health</span>
               <div className="flex items-center gap-1.5">
                 <div className={`w-1.5 h-1.5 rounded-full ${anomalousCount > 0 ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`} />
                 <span className={anomalousCount > 0 ? 'text-rose-400 font-medium' : 'text-neutral-300 font-medium'}>
                    {anomalousCount > 0 ? `${anomalousCount} Alerts` : 'Optimal'}
                 </span>
               </div>
             </div>
          </div>

          <div className="pl-6 border-l border-white/10 text-neutral-400 text-sm font-medium">
             {sysTime}
          </div>
        </div>
      </motion.div>

      {/* Bottom Floating Pill Toolbar */}
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-full flex justify-center pointer-events-auto"
      >
        <div className="flex items-center gap-2 bg-[#0a0a0a]/90 backdrop-blur-2xl border border-white/10 rounded-full p-1.5 shadow-[0_0_50px_rgba(255,255,255,0.03)]">
          <IconButton icon={<LayoutGrid size={18} />} active={!isAnalyticsOpen && !isBandwidthOpen} tooltip="Spatial View" onClick={() => { setIsAnalyticsOpen(false); setIsBandwidthOpen(false); }} />
          <IconButton icon={<Map size={18} />} tooltip="Signal Heatmap" active={isHeatmapVisible} onClick={() => { setHeatmapVisible(!isHeatmapVisible); }} />
          <div className="w-px h-6 bg-white/10 mx-1" />
          
          <IconButton icon={<Activity size={18} />} tooltip="Analytics" active={isAnalyticsOpen} onClick={() => { setIsAnalyticsOpen(true); setIsBandwidthOpen(false); }} />
          <IconButton icon={<WifiHigh size={18} />} tooltip="Bandwidth Probe" active={isBandwidthOpen} onClick={() => { setIsBandwidthOpen(true); setIsAnalyticsOpen(false); }} />
          
          <div className="w-px h-6 bg-white/10 mx-2" />

          <IconButton icon={<Clock size={18} />} tooltip={isDVRMode ? "Return to Live Mode" : "Network DVR Playback"} active={isDVRMode} onClick={() => setDVRMode(!isDVRMode)} />
          
          <div className="w-px h-6 bg-white/10 mx-2" />
          
          <div className="relative group cursor-text" onClick={() => setIsOmniOpen(true)}>
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <div className="bg-white/5 border border-white/5 rounded-full pl-9 pr-4 py-2 text-sm text-neutral-400 w-48 flex justify-between items-center hover:border-white/20 transition-all">
              <span>Ask OmniSight...</span>
              <kbd className="text-[10px] font-sans px-1.5 py-0.5 rounded-md bg-white/10 text-neutral-500 ml-2">⌘K</kbd>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
    </>
  );
}

function IconButton({ icon, active = false, tooltip = "", onClick }: { icon: React.ReactNode, active?: boolean, tooltip?: string, onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`p-2.5 rounded-full transition-all flex items-center justify-center relative group
      ${active ? 'bg-white text-black shadow-lg' : 'text-neutral-400 hover:text-white hover:bg-white/10'}`}>
      {icon}
      
      <div className="absolute -top-10 scale-95 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all bg-[#1a1a1a] border border-white/10 text-white text-xs py-1.5 px-3 rounded-lg whitespace-nowrap shadow-xl">
        {tooltip}
      </div>
    </button>
  );
}
