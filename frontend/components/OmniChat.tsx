"use client";

import { useEffect, useState, useRef } from "react";
import { Search, Loader2, Sparkles, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function OmniChat({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<{role: 'user' | 'ai', content: string}[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    const userText = query.trim();
    setMessages(prev => [...prev, { role: 'user', content: userText }]);
    setQuery("");
    setIsTyping(true);

    try {
      const res = await fetch("http://localhost:8000/api/rag/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText })
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'ai', content: data.response }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', content: "Error connecting to AI Agent. Is the backend running?" }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
          {/* Subtle click-away backdrop */}
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            onClick={onClose}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />

          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="w-full max-w-2xl bg-[#0a0a0a]/90 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[0_30px_100px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col relative"
          >
            {/* Minimalist output area */}
            {messages.length > 0 && (
              <div className="max-h-[50vh] overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-white/10">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-5 py-3 text-sm leading-relaxed
                      ${msg.role === 'user' 
                        ? 'bg-white/10 text-white font-medium ml-auto rounded-tr-sm' 
                        : 'bg-transparent text-white/80 font-light pr-4'}`}
                    >
                      {msg.role === 'ai' && <Sparkles size={14} className="inline mr-2 text-blue-400 mb-0.5" />}
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex items-center gap-2 text-white/40 text-sm px-5 pb-4">
                     <Loader2 size={14} className="animate-spin" /> Analyzing network telemetry...
                  </div>
                )}
              </div>
            )}

            {/* Omni input bar */}
            <form onSubmit={handleSubmit} className="relative flex items-center border-t border-white/5 p-2">
              <Search size={20} className="absolute left-6 text-white/40" />
              <input 
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Ask OmniSight anything... (e.g. 'Who is using the most bandwidth?')"
                className="w-full bg-transparent text-white placeholder:text-white/30 text-lg px-14 py-4 focus:outline-none"
                autoComplete="off"
              />
              <button type="button" onClick={onClose} className="absolute right-4 p-2 text-white/40 hover:text-white/80 hover:bg-white/5 rounded-full transition-colors">
                <X size={16} />
              </button>
            </form>
            
            {/* Quick Actions (Empty State) */}
            {messages.length === 0 && (
              <div className="bg-black/40 px-6 py-4 border-t border-white/5 flex gap-3 overflow-x-auto scrollbar-hide">
                <QuickPrompt text="Which devices have the highest latency?" onClick={setQuery} />
                <QuickPrompt text="Are there any security anomalies?" onClick={setQuery} />
                <QuickPrompt text="Summarize the current network health" onClick={setQuery} />
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function QuickPrompt({ text, onClick }: { text: string, onClick: (t: string) => void }) {
  return (
    <button 
      type="button"
      onClick={() => onClick(text)}
      className="shrink-0 text-xs font-medium text-white/50 bg-white/5 hover:bg-white/10 hover:text-white transition-all px-4 py-2 rounded-full border border-white/5"
    >
      {text}
    </button>
  );
}
