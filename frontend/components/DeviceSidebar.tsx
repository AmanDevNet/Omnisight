"use client";

import { useMemo, useState } from "react";

import { Device } from "@/hooks/useWebSocket";

function vendorLabel(v: string | null): string {
  const s = (v || "Unknown").trim();
  return s.length ? s : "Unknown";
}

function fmtPing(ms: number | null): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  return `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
}

function typeLabel(t?: string): string {
  const s = (t || "Unknown").trim();
  return s.length ? s : "Unknown";
}

export default function DeviceSidebar({
  devices,
  selectedIp,
  onSelectIp,
}: {
  devices: Device[];
  selectedIp: string | null;
  onSelectIp: (ip: string | null) => void;
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = devices;
    if (query) {
      list = devices.filter((d) => {
        const v = (d.vendor || "").toLowerCase();
        return d.ip.toLowerCase().includes(query) || v.includes(query);
      });
    }
    return [...list].sort((a, b) => {
      // online first
      if (a.status !== b.status) return a.status === "online" ? -1 : 1;
      const ap = a.ping_ms ?? Number.POSITIVE_INFINITY;
      const bp = b.ping_ms ?? Number.POSITIVE_INFINITY;
      if (ap !== bp) return ap - bp;
      return a.ip.localeCompare(b.ip);
    });
  }, [devices, q]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-700/60 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Devices</div>
            <div className="text-xs text-slate-400">{filtered.length} shown</div>
          </div>
          {selectedIp ? (
            <button
              className="text-xs text-slate-300 hover:text-slate-100"
              onClick={() => onSelectIp(null)}
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="mt-3">
          <input
            suppressHydrationWarning
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by IP or vendor…"
            className="w-full rounded-lg bg-slate-900/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 ring-1 ring-slate-700/60 focus:outline-none focus:ring-2 focus:ring-purple-400/40"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="divide-y divide-slate-700/40">
          {filtered.map((d) => {
            const selected = d.ip === selectedIp;
            return (
              <button
                key={d.ip}
                onClick={() => onSelectIp(d.ip)}
                className={[
                  "w-full text-left px-4 py-3 transition-colors",
                  selected ? "bg-purple-500/10" : "hover:bg-slate-800/30",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          "h-2 w-2 rounded-full",
                          d.status === "online" ? "bg-emerald-400" : "bg-rose-400",
                        ].join(" ")}
                      />
                      <div className="truncate font-mono text-sm text-slate-100">
                        <span className="mr-1">{d.device_icon || "❓"}</span>
                        {d.ip}
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <div className="truncate text-xs text-slate-400">{vendorLabel(d.vendor)}</div>
                      <span className="inline-flex items-center rounded-full bg-slate-800/50 px-2 py-0.5 text-[10px] font-semibold text-slate-300 ring-1 ring-slate-700/50">
                        {typeLabel(d.device_type)}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <span className="inline-flex items-center rounded-full bg-slate-900/40 px-2 py-1 text-xs font-semibold text-slate-200 ring-1 ring-slate-700/60">
                      {fmtPing(d.ping_ms)}
                    </span>
                    <div className="mt-1 text-[10px] text-slate-500">
                      joined {d.connected_since || "unknown"}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

