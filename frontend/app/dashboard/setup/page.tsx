"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Network, Copy, CheckCircle2, Terminal } from "lucide-react";

export default function SetupPage() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const key = localStorage.getItem("omnisight_api_key");
    if (!key) {
      router.push("/login");
    } else {
      setApiKey(key);
    }
  }, [router]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!apiKey) return null;

  return (
    <div className="min-h-screen bg-[#020617] text-white p-8">
      <Link href="/dashboard" className="text-cyan-400 font-bold tracking-widest flex items-center gap-2 hover:opacity-80 mb-12">
        <Network className="w-6 h-6" /> OMNISIGHT <span className="text-white ml-2">RETURN TO DASHBOARD</span>
      </Link>
      
      <div className="max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold mb-4">Set Up Your Network Agent</h1>
        <p className="text-slate-400 mb-12 text-lg">
          To visualize your local network, you need to run the OmniSight Agent on a computer or Raspberry Pi connected to your Wi-Fi.
        </p>

        <div className="bg-white/[0.02] border border-white/10 rounded-xl p-8 mb-8 backdrop-blur-sm">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-sm">1</span> 
            Your Secret API Key
          </h2>
          <p className="text-slate-400 text-sm mb-4">This key gives your agent permission to securely stream data to your dashboard.</p>
          
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-black/50 border border-white/10 p-4 rounded-lg font-mono text-cyan-300">
              {apiKey}
            </code>
            <button 
              onClick={copyToClipboard}
              className="bg-cyan-900 border border-cyan-700/50 hover:bg-cyan-800 p-4 rounded-lg transition"
            >
              {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5 text-cyan-400" />}
            </button>
          </div>
        </div>

        <div className="bg-white/[0.02] border border-white/10 rounded-xl p-8 backdrop-blur-sm">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-sm">2</span> 
            Run the Agent
          </h2>
          <p className="text-slate-400 text-sm mb-4">
            Download the <code>omnisight_agent.py</code> script from our GitHub repository, and run it on your local network using the command line.
          </p>
          
          <div className="bg-black/80 rounded-lg p-6 font-mono text-sm border border-white/5 space-y-4">
             <div className="text-slate-500"># 1. Set your API key environment variable</div>
             <div className="flex items-start gap-3">
               <Terminal className="w-4 h-4 text-cyan-500 mt-0.5 shrink-0" />
               <div className="text-slate-300 break-all">
                 <span className="text-pink-400">export</span> OMNISIGHT_API_KEY=<span className="text-amber-300">"{apiKey}"</span>
               </div>
             </div>
             
             <div className="text-slate-500 mt-6"># 2. Run the agent</div>
             <div className="flex items-center gap-3">
               <Terminal className="w-4 h-4 text-cyan-500" />
               <div className="text-slate-300">python omnisight_agent.py</div>
             </div>
          </div>
        </div>
        
        <div className="mt-12 flex justify-center">
             <Link href="/dashboard" className="px-8 py-4 bg-cyan-500 text-black font-bold rounded hover:bg-cyan-400 transition">
                 I've started the agent - Go to Dashboard
             </Link>
        </div>
      </div>
    </div>
  );
}
