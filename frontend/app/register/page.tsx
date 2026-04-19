"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Network, ArrowRight, Loader2 } from "lucide-react";

export default function Register() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${apiUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.detail || "Registration failed");
      } else {
        localStorage.setItem("omnisight_api_key", data.api_key);
        router.push("/dashboard/setup");
      }
    } catch (err) {
      setError("Network error. Is the server running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-white flex flex-col justify-center items-center p-4">
      <Link href="/" className="absolute top-8 left-8 text-cyan-400 font-bold tracking-widest flex items-center gap-2 hover:opacity-80">
        <Network className="w-6 h-6" /> OMNISIGHT
      </Link>
      
      <div className="w-full max-w-md bg-white/[0.02] border border-white/10 p-8 rounded-2xl backdrop-blur-xl shadow-2xl">
        <h2 className="text-3xl font-bold mb-2">Create Account</h2>
        <p className="text-slate-400 mb-8 text-sm">Join the next generation of network visualization.</p>

        {error && <div className="bg-red-500/10 border border-red-500/50 text-red-400 text-sm p-3 rounded mb-6">{error}</div>}

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Email</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition"
              placeholder="you@example.com"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Password</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition"
              placeholder="••••••••"
              required
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full mt-4 bg-cyan-500 hover:bg-cyan-400 text-black font-bold p-3 rounded-lg flex justify-center items-center gap-2 transition disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Sign Up <ArrowRight className="w-4 h-4" /></>}
          </button>
        </form>

        <p className="mt-8 text-center text-sm text-slate-500">
          Already have an account? <Link href="/login" className="text-cyan-400 hover:underline">Log in</Link>
        </p>
      </div>
    </div>
  );
}
