"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import DeviceSidebar from "@/components/DeviceSidebar";
import NetworkGraph from "@/components/NetworkGraph";
import { Device, useWebSocket } from "@/hooks/useWebSocket";

function fmtPing(ms: number | null): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  return `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
}

function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function avgPing(devices: Device[]): number | null {
  const vals = devices.map((d) => d.ping_ms).filter((v): v is number => typeof v === "number");
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

type InsightsDevice = {
  ip: string;
  mac: string;
  vendor: string | null;
  ping_ms: number | null;
  first_seen: string;
};

type InsightsResponse = {
  just_joined: InsightsDevice[];
};

function timeAgo(from: Date, now: Date): string {
  const s = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function vendorLabel(v: string | null): string {
  const s = (v || "Unknown").trim();
  return s.length ? s : "Unknown";
}

function vendorDotColor(v: string | null): string {
  const x = (v || "").toLowerCase();
  if (x.includes("cisco") || x.includes("meraki")) return "bg-orange-400";
  if (x.includes("xiaomi")) return "bg-red-400";
  if (x.includes("intel")) return "bg-blue-400";
  if (x.includes("oppo")) return "bg-emerald-400";
  if (x.includes("azurewave")) return "bg-yellow-400";
  return "bg-slate-400";
}

type FeedItem = {
  key: string;
  ip: string;
  vendor: string | null;
  firstSeen: Date;
  createdAt: Date;
};

type SummaryAnomaly = {
  ip: string;
  reason: string;
  severity: "high" | "medium" | string;
  mac?: string;
  vendor?: string | null;
};

type SummaryResponse = {
  summary: string;
  anomalies: SummaryAnomaly[];
  scan_count: number;
};

export default function NetworkDashboard() {
  const { devices, isConnected, lastUpdate, error } = useWebSocket("ws://localhost:8000/ws");
  const [selectedIp, setSelectedIp] = useState<string | null>(null);

  const [feed, setFeed] = useState<FeedItem[]>([]);
  const seenKeysRef = useRef<Set<string>>(new Set());

  const [aiSummary, setAiSummary] = useState<SummaryResponse | null>(null);

  const stats = useMemo(() => {
    const total = devices.length;
    const online = devices.filter((d) => d.status === "online").length;
    const avg = avgPing(devices);
    return { total, online, avg };
  }, [devices]);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/insights", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as unknown;
        const data = json as Partial<InsightsResponse>;
        if (!data.just_joined || !Array.isArray(data.just_joined)) return;

        const now = new Date();
        const incoming: FeedItem[] = [];
        for (const d of data.just_joined) {
          if (!d || typeof d !== "object") continue;
          const dev = d as InsightsDevice;
          if (typeof dev.ip !== "string") continue;
          if (typeof dev.mac !== "string") continue;
          if (typeof dev.first_seen !== "string") continue;
          const fs = new Date(dev.first_seen);
          const key = `${dev.mac}|${dev.first_seen}`;
          if (Number.isNaN(fs.getTime())) continue;
          if (seenKeysRef.current.has(key)) continue;
          incoming.push({
            key,
            ip: dev.ip,
            vendor: dev.vendor ?? null,
            firstSeen: fs,
            createdAt: now,
          });
        }

        if (!incoming.length) return;
        // Oldest -> newest, then add, then keep last 10
        incoming.sort((a, b) => a.firstSeen.getTime() - b.firstSeen.getTime());

        for (const it of incoming) seenKeysRef.current.add(it.key);
        if (cancelled) return;

        setFeed((prev) => {
          const next = [...prev, ...incoming];
          return next.slice(Math.max(0, next.length - 10));
        });
      } catch {
        // keep quiet; WS status already shows connectivity
      }
    };

    poll();
    const id = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/summary", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as unknown;
        if (!json || typeof json !== "object") return;
        const o = json as Partial<SummaryResponse>;
        if (typeof o.summary !== "string") return;
        const scan_count = typeof o.scan_count === "number" ? o.scan_count : 0;
        const anomalies = Array.isArray(o.anomalies) ? (o.anomalies as SummaryAnomaly[]) : [];
        if (cancelled) return;
        setAiSummary({ summary: o.summary, anomalies, scan_count });
      } catch {
        // ignore; panel can stay stale/offline
      }
    };

    poll();
    const id = window.setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="border-b border-slate-700/60 bg-[#0f172a] px-4 py-3">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-purple-600/20 ring-1 ring-purple-400/30 flex items-center justify-center">
              <span className="text-purple-200 font-semibold">Wi</span>
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight">WiFi Network Visualizer</div>
              <div className="text-xs text-slate-400">
                Live device discovery via ARP + WebSocket
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Stat label="Total" value={String(stats.total)} />
            <Stat label="Online" value={String(stats.online)} />
            <Stat label="Avg ping" value={fmtPing(stats.avg)} />
            <Stat label="Last scan" value={fmtTime(lastUpdate)} />
            <Stat
              label="WS"
              value={isConnected ? "connected" : "disconnected"}
              tone={isConnected ? "good" : "bad"}
            />
          </div>
        </div>

        {error ? (
          <div className="mx-auto mt-3 max-w-[1600px] rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200 ring-1 ring-rose-400/20">
            {error}
          </div>
        ) : null}
      </div>

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-4">
        <div className="flex gap-4">
          <div className="w-[70%] min-w-0">
            <div className="relative h-[calc(100vh-220px)] rounded-xl bg-[#1e293b] ring-1 ring-slate-700/60 overflow-hidden">
              <NetworkGraph
                devices={devices}
                selectedIp={selectedIp}
                onSelectIp={setSelectedIp}
              />

              <LiveFeedPanel items={feed} />
            </div>
          </div>
          <div className="w-[30%] min-w-[320px]">
            <div className="h-[calc(100vh-220px)] rounded-xl bg-[#1e293b] ring-1 ring-slate-700/60 overflow-hidden">
              <DeviceSidebar
                devices={devices}
                selectedIp={selectedIp}
                onSelectIp={setSelectedIp}
              />
            </div>
          </div>
        </div>

        <AIInsightsPanel ai={aiSummary} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-200 ring-emerald-400/20 bg-emerald-500/10"
      : tone === "bad"
        ? "text-rose-200 ring-rose-400/20 bg-rose-500/10"
        : "text-slate-200 ring-slate-600/30 bg-slate-800/40";
  return (
    <div className={`rounded-lg px-3 py-2 ring-1 ${toneCls}`}>
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function LiveFeedPanel({ items }: { items: FeedItem[] }) {
  const [, setTick] = useState(0);

  // Refresh "time ago" text smoothly.
  useEffect(() => {
    const id = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const current = new Date();

  return (
    <div className="absolute bottom-3 left-3 w-[360px] max-w-[90%]">
      <div className="rounded-xl bg-[#1e293b] ring-1 ring-slate-700/60 shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-700/50 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <div className="text-sm font-semibold">Live Feed</div>
          </div>
          <div className="text-xs text-slate-400">{items.length ? "live" : "waiting…"}</div>
        </div>

        <div className="max-h-[200px] overflow-auto px-2 py-2">
          <div className="space-y-2">
            {items.length === 0 ? (
              <div className="px-2 py-3 text-xs text-slate-400">
                No new devices yet.
              </div>
            ) : (
              items.map((it) => {
                const fresh = (current.getTime() - it.createdAt.getTime()) < 2000;
                return (
                  <div
                    key={it.key}
                    className={[
                      "rounded-lg bg-slate-900/30 px-2 py-2 ring-1 ring-slate-700/40",
                      "transition-transform transition-opacity duration-300",
                      fresh ? "animate-[feedIn_280ms_ease-out]" : "",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${vendorDotColor(it.vendor)}`} />
                          <div className="text-xs text-slate-200">
                            <span className="font-semibold">New device joined</span>{" "}
                            <span className="text-slate-400">·</span>{" "}
                            <span className="text-slate-100">{vendorLabel(it.vendor)}</span>
                          </div>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="font-mono text-xs text-slate-200">{it.ip}</div>
                          <div className="text-xs text-slate-500">•</div>
                          <div className="text-xs text-slate-400">{timeAgo(it.firstSeen, current)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes feedIn {
          from { transform: translateY(10px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function AIInsightsPanel({ ai }: { ai: SummaryResponse | null }) {
  const scanCount = ai?.scan_count ?? 0;
  const learning = scanCount < 10;
  const progress = Math.max(0, Math.min(1, scanCount / 10));
  const anomalies = ai?.anomalies ?? [];

  return (
    <div className="w-full rounded-xl bg-[#1e293b] ring-1 ring-slate-700/60 p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="text-base font-semibold">🧠 Network Intelligence</div>
            </div>
            {learning ? (
              <div className="text-xs text-slate-300">Learning baseline... ({scanCount}/10)</div>
            ) : (
              <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-400/20">
                Model Active
              </span>
            )}
          </div>

          {learning ? (
            <div className="mt-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-900/40 ring-1 ring-slate-700/50">
                <div
                  className="h-full bg-purple-400/70"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          ) : null}

          <div className="mt-3 text-sm leading-6 text-slate-100">
            {ai?.summary ?? "Waiting for AI summary…"}
          </div>
        </div>

        <div className="min-w-0">
          {anomalies.length > 0 ? (
            <>
              <div className="text-base font-semibold">⚠️ Anomalies Detected</div>
              <div className="mt-3 space-y-2">
                {anomalies.slice(0, 5).map((a, idx) => (
                  <div
                    key={`${a.ip}-${idx}`}
                    className="flex items-start justify-between gap-3 rounded-lg bg-slate-900/30 px-3 py-2 ring-1 ring-slate-700/40"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={[
                          "mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                          a.severity === "high"
                            ? "bg-rose-500/15 text-rose-200 ring-rose-400/20"
                            : "bg-yellow-500/15 text-yellow-200 ring-yellow-400/20",
                        ].join(" ")}
                      >
                        {a.severity}
                      </span>
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-slate-100">{a.ip}</div>
                        <div className="mt-0.5 text-xs text-slate-300">{a.reason}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-sm font-semibold text-emerald-300">✅ No anomalies detected</div>
          )}
        </div>
      </div>
    </div>
  );
}

