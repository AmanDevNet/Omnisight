import Link from "next/link";
import { Network, Shield, Zap, Activity } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
      {/* Navbar */}
      <nav className="flex justify-between items-center p-6 lg:px-12 border-b border-white/5">
        <div className="text-cyan-400 font-bold tracking-widest text-2xl flex items-center gap-2">
            <Network className="w-8 h-8" />
            OMNISIGHT
        </div>
        <div className="flex gap-4">
          <Link href="/login" className="px-5 py-2 text-sm font-medium hover:text-cyan-400 transition">Log In</Link>
          <Link href="/register" className="px-5 py-2 text-sm font-medium bg-cyan-950 text-cyan-400 border border-cyan-800/50 rounded-md hover:bg-cyan-900 transition shadow-[0_0_15px_rgba(34,211,238,0.2)]">Sign Up Free</Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex flex-col items-center justify-center pt-32 pb-20 px-6 text-center space-y-8 relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-600/20 blur-[120px] rounded-full pointer-events-none"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-blue-900/10 blur-[150px] rounded-full pointer-events-none"></div>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-500/20 bg-cyan-500/5 text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-4">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
          </span>
          SaaS Beta Version 2.0 Now Live
        </div>

        <h1 className="text-5xl lg:text-7xl font-extrabold tracking-tight max-w-4xl bg-clip-text text-transparent bg-gradient-to-br from-white via-slate-200 to-slate-500">
          Visualize your network in true <span className="text-cyan-400">3D Space.</span>
        </h1>
        
        <p className="text-lg lg:text-xl text-slate-400 max-w-2xl leading-relaxed">
          OmniSight is a high-performance network mapping agent that securely streams your local telemetry to a breathtaking cloud dashboard. Powered by real-time ML anomaly detection.
        </p>

        <div className="flex gap-6 mt-8 relative z-10">
          <Link href="/register" className="px-8 py-4 text-sm font-bold bg-cyan-500 text-black rounded-sm hover:bg-cyan-400 transition shadow-[0_0_30px_rgba(34,211,238,0.4)] flex items-center gap-2">
            Get Your Free Agent <Activity className="w-4 h-4" />
          </Link>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl mt-32 relative z-10 text-left">
            <div className="p-6 rounded-xl border border-white/5 bg-white/[0.02] backdrop-blur-sm hover:bg-white/[0.04] transition">
                <Network className="w-8 h-8 text-cyan-400 mb-4" />
                <h3 className="text-xl font-bold mb-2">Real-Time Cloud Sync</h3>
                <p className="text-sm text-slate-400">Install the tiny 5MB agent on your router or Raspberry Pi and watch the data stream instantly to your web dashboard.</p>
            </div>
            <div className="p-6 rounded-xl border border-white/5 bg-white/[0.02] backdrop-blur-sm hover:bg-white/[0.04] transition">
                <Shield className="w-8 h-8 text-emerald-400 mb-4" />
                <h3 className="text-xl font-bold mb-2">AI Anomaly Detection</h3>
                <p className="text-sm text-slate-400">Our Machine Learning engine builds a fingerprint of your network behavior and alerts you the second a rogue device joins.</p>
            </div>
            <div className="p-6 rounded-xl border border-white/5 bg-white/[0.02] backdrop-blur-sm hover:bg-white/[0.04] transition">
                <Zap className="w-8 h-8 text-amber-400 mb-4" />
                <h3 className="text-xl font-bold mb-2">Zero Config Setup</h3>
                <p className="text-sm text-slate-400">Just paste your secret API key into the agent CLI and OmniSight handles all the packet-sniffing, ARP scanning, and websockets.</p>
            </div>
        </div>
      </main>
    </div>
  );
}
