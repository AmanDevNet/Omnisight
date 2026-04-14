"use client";

import { useEffect, useState, useRef } from "react";
import { Play, Pause, X, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNetworkStore } from "@/store/useNetworkStore";

export default function DVRScrubber() {
  const { isDVRMode, setDVRMode, setDVRDevices } = useNetworkStore();
  
  const [bounds, setBounds] = useState({ min: 0, max: 0 });
  const [currentTs, setCurrentTs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isDVRMode) {
       fetch("http://localhost:8000/api/dvr/bounds")
         .then(r => r.json())
         .then(data => {
            if (data.min && data.max) {
              setBounds({ min: data.min, max: data.max });
              setCurrentTs(data.max); // Start at the newest snapshot
            }
         }).catch(console.error);
    } else {
       if (timerRef.current) clearInterval(timerRef.current);
       setIsPlaying(false);
    }
  }, [isDVRMode]);

  useEffect(() => {
    if (!isDVRMode || currentTs === 0) return;
    
    fetch(`http://localhost:8000/api/dvr/snapshot/${currentTs}`)
      .then(r => r.json())
      .then(data => {
         if (data.data) {
           setDVRDevices(data.data);
         }
      }).catch(console.error);
      
  }, [currentTs, isDVRMode, setDVRDevices]);

  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(() => {
         setCurrentTs(prev => {
            if (prev + 15 >= bounds.max) {
               setIsPlaying(false);
               return bounds.max;
            }
            return prev + 15;
         });
      }, 500); // 0.5s playback speed = 15s real-time step
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isPlaying, bounds.max]);

  if (!isDVRMode) return null;

  const formatDate = (ts: number) => {
     if (!ts) return "--:--";
     return new Date(ts * 1000).toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute:'2-digit', second:'2-digit' });
  };

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4 pointer-events-auto"
      >
        <div className="bg-[#0a0a0a]/90 backdrop-blur-2xl border border-rose-500/50 shadow-[0_0_80px_rgba(244,63,94,0.15)] rounded-2xl p-5 flex flex-col gap-5 relative overflow-hidden">
          
          {/* Subtle red pulsing background for DVR mode */}
          <div className="absolute inset-0 bg-gradient-to-r from-rose-500/0 via-rose-500/5 to-rose-500/0 animate-pulse pointer-events-none" />

          <div className="flex items-center justify-between relative z-10">
             <div className="flex items-center gap-3">
                <div className="bg-rose-500 text-black text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded flex items-center gap-2">
                   <div className="w-1.5 h-1.5 bg-black rounded-full animate-bounce" />
                   PLAYBACK MODE
                </div>
                <span className="text-rose-200 font-mono text-sm border-l border-white/10 pl-3">
                   {formatDate(currentTs)}
                </span>
             </div>
             <button 
               onClick={() => { setDVRMode(false); setIsPlaying(false); }}
               className="text-white/40 hover:text-white transition-colors p-1"
             >
               <X size={18} />
             </button>
          </div>

          <div className="flex items-center gap-4 relative z-10">
             <button 
               onClick={() => setIsPlaying(!isPlaying)}
               className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 hover:bg-rose-200 transition-all shrink-0 shadow-lg cursor-pointer"
             >
               {isPlaying ? <Pause size={18} className="fill-black" /> : <Play size={18} className="fill-black ml-1" />}
             </button>
             
             <input 
               type="range"
               min={bounds.min}
               max={bounds.max}
               step={15}
               value={currentTs}
               onChange={(e) => {
                  setIsPlaying(false);
                  setCurrentTs(parseFloat(e.target.value));
               }}
               className="w-full accent-rose-500 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
             />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
