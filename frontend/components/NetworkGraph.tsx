"use client";

import * as d3 from "d3";
import { useEffect, useMemo, useRef, useState } from "react";

import { Device } from "@/hooks/useWebSocket";

type NodeType = "router" | "device";

type GraphNode = {
  id: string;
  type: NodeType;
  ip: string;
  mac?: string;
  vendor?: string | null;
  ping_ms?: number | null;
  last_seen?: string;
  device_type?: string;
  device_icon?: string;
  connected_since?: string;
  status?: "online" | "offline";
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
};

type GraphLink = { source: string | GraphNode; target: string | GraphNode };

function isRouter(d: Device): boolean {
  const ip = d.ip || "";
  const v = (d.vendor || "").toLowerCase();
  return ip.endsWith(".1") || v.includes("cisco") || v.includes("meraki");
}

function vendorColor(vendor: string | null | undefined): string {
  const v = (vendor || "").toLowerCase();
  if (v.includes("cisco") || v.includes("meraki")) return "#fb923c"; // orange-400
  if (v.includes("xiaomi")) return "#f87171"; // red-400
  if (v.includes("intel")) return "#60a5fa"; // blue-400
  if (v.includes("oppo")) return "#34d399"; // green-400
  if (v.includes("azurewave")) return "#facc15"; // yellow-400
  return "#94a3b8"; // slate-400 (Unknown)
}

function nodeRadius(node: GraphNode): number {
  if (node.type === "router") return 26;
  const p = node.ping_ms;
  if (p == null || Number.isNaN(p)) return 10;
  // Inversely proportional to ping, but clamp for stability.
  const r = 22 - Math.min(18, Math.max(0, p)) * 0.6;
  return Math.max(7, Math.min(18, r));
}

const RING_NEAR = 120;
const RING_MID = 250;
const RING_FAR = 380;

function ringRadiusForPing(ping: number | null | undefined): number {
  if (ping == null || Number.isNaN(ping)) return RING_MID;
  if (ping <= 20) return RING_NEAR;
  if (ping <= 100) return RING_MID;
  return RING_FAR;
}

function linkX(n: string | GraphNode): number {
  return typeof n === "string" ? 0 : (n.x ?? 0);
}

function linkY(n: string | GraphNode): number {
  return typeof n === "string" ? 0 : (n.y ?? 0);
}

export default function NetworkGraph({
  devices,
  selectedIp,
  onSelectIp,
}: {
  devices: Device[];
  selectedIp: string | null;
  onSelectIp: (ip: string | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const simRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);

  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    node: GraphNode;
  } | null>(null);

  const { nodes, links, routerIp } = useMemo(() => {
    const router = devices.find(isRouter) || devices.find((d) => d.ip.endsWith(".1")) || null;
    const routerNode: GraphNode = {
      id: router?.ip || "router",
      type: "router",
      ip: router?.ip || "router",
      vendor: router?.vendor ?? "Router",
      ping_ms: router?.ping_ms ?? null,
      mac: router?.mac ?? undefined,
      last_seen: router?.last_seen ?? undefined,
      status: router?.status ?? "online",
    };

    const devNodes: GraphNode[] = devices
      .filter((d) => d.ip !== routerNode.ip)
      .map((d) => ({
        id: d.ip,
        type: "device",
        ip: d.ip,
        mac: d.mac,
        vendor: d.vendor,
        ping_ms: d.ping_ms,
        last_seen: d.last_seen,
        device_type: d.device_type,
        device_icon: d.device_icon,
        connected_since: d.connected_since,
        status: d.status,
      }));

    const allNodes = [routerNode, ...devNodes];
    const allLinks: GraphLink[] = devNodes.map((n) => ({
      source: routerNode.id,
      target: n.id,
    }));

    return { nodes: allNodes, links: allLinks, routerIp: routerNode.ip };
  }, [devices]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    const g = gRef.current;
    if (!wrap || !svg || !g) return;

    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      svg.setAttribute("width", String(r.width));
      svg.setAttribute("height", String(r.height));
      simRef.current?.alpha(0.4).restart();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const svgEl = svgRef.current;
    const gEl = gRef.current;
    const wrap = wrapRef.current;
    if (!svgEl || !gEl || !wrap) return;

    const svg = d3.select(svgEl);
    const g = d3.select(gEl);
    const { width, height } = wrap.getBoundingClientRect();

    svg.attr("width", width).attr("height", height);

    // Zoom / pan
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 3])
      .on("zoom", (ev) => {
        g.attr("transform", ev.transform.toString());
      });
    svg.call(zoom);

    // Click background to clear tooltip/selection
    svg.on("click", () => {
      setTooltip(null);
      onSelectIp(null);
    });

    return () => {
      svg.on(".zoom", null);
      svg.on("click", null);
    };
  }, [onSelectIp]);

  useEffect(() => {
    const svgEl = svgRef.current;
    const gEl = gRef.current;
    const wrap = wrapRef.current;
    if (!svgEl || !gEl || !wrap) return;

    const g = d3.select(gEl);
    const { width, height } = wrap.getBoundingClientRect();

    // Keep last positions by reusing existing simulation nodes when possible.
    const prevSim = simRef.current;
    const prevNodes = (prevSim?.nodes() || []) as GraphNode[];
    const prevById = new Map(prevNodes.map((n) => [n.id, n]));

    const simNodes: GraphNode[] = nodes.map((n) => {
      const prev = prevById.get(n.id);
      return prev ? { ...prev, ...n } : { ...n };
    });

    const simLinks: GraphLink[] = links.map((l) => ({ ...l }));

    // Layers
    g.selectAll("*").remove();

    g.append("defs")
      .append("filter")
      .attr("id", "softGlow")
      .append("feDropShadow")
      .attr("dx", 0)
      .attr("dy", 0)
      .attr("stdDeviation", 2.5)
      .attr("flood-color", "#a78bfa")
      .attr("flood-opacity", 0.35);

    const ringsG = g.append("g").attr("pointer-events", "none");
    const linkG = g.append("g").attr("stroke-opacity", 0.7);
    const nodeG = g.append("g");

    // Proximity rings centered on router (router pinned to center)
    const cx = width / 2;
    const cy = height / 2;
    const rings = [
      { r: RING_NEAR, color: "#34d399", label: "Nearby < 20ms" }, // emerald-400
      { r: RING_MID, color: "#facc15", label: "Mid 20-100ms" }, // yellow-400
      { r: RING_FAR, color: "#fb7185", label: "Far > 100ms" }, // rose-400
    ] as const;

    for (const ring of rings) {
      ringsG
        .append("circle")
        .attr("cx", cx)
        .attr("cy", cy)
        .attr("r", ring.r)
        .attr("fill", "none")
        .attr("stroke", ring.color)
        .attr("stroke-opacity", 0.2)
        .attr("stroke-width", 1.2)
        .attr("stroke-dasharray", "6 6");

      ringsG
        .append("text")
        .attr("x", cx)
        .attr("y", cy - ring.r - 8)
        .attr("text-anchor", "middle")
        .attr("fill", "#94a3b8")
        .attr("font-size", 11)
        .attr("font-family", "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial")
        .attr("opacity", 0.8)
        .text(ring.label);
    }

    const link = linkG
      .selectAll("line")
      .data(simLinks)
      .enter()
      .append("line")
      .attr("stroke", "#94a3b8")
      .attr("stroke-width", 1.2)
      .attr("stroke-dasharray", "6 6")
      .attr("class", "nv-dash");

    const node = nodeG
      .selectAll<SVGGElement, GraphNode>("g")
      .data(simNodes, (d: GraphNode) => d.id)
      .enter()
      .append("g")
      .style("cursor", "pointer")
      .on("click", (ev, d) => {
        ev.stopPropagation();
        onSelectIp(d.type === "router" ? routerIp : d.ip);

        const rect = (wrapRef.current || wrap).getBoundingClientRect();
        setTooltip({
          x: ev.clientX - rect.left,
          y: ev.clientY - rect.top,
          node: d,
        });
      });

    node
      .append("circle")
      .attr("r", (d) => nodeRadius(d))
      .attr("class", "nv-node-circle")
      .attr("fill", (d) => (d.type === "router" ? "#7c3aed" : vendorColor(d.vendor)))
      .attr("fill-opacity", (d) => (d.type === "router" ? 0.9 : 0.85))
      .attr("filter", (d) => (d.type === "router" ? "url(#softGlow)" : null))
      .attr("stroke", (d) => (d.status === "online" ? "#34d399" : "#fb7185"))
      .attr("stroke-width", (d) => (d.type === "router" ? 2.5 : 2))
      .attr("stroke-opacity", 0.95);

    // WiFi icon for router
    const wifi = node.filter((d) => d.type === "router").append("g").attr("pointer-events", "none");
    wifi
      .append("path")
      .attr(
        "d",
        "M -10 2 C -4 -4 4 -4 10 2 M -7 6 C -3 2 3 2 7 6 M -3 10 C -1 8 1 8 3 10",
      )
      .attr("fill", "none")
      .attr("stroke", "#f3e8ff")
      .attr("stroke-width", 2.2)
      .attr("stroke-linecap", "round");
    wifi
      .append("circle")
      .attr("cx", 0)
      .attr("cy", 13)
      .attr("r", 2.2)
      .attr("fill", "#f3e8ff");

    // Labels for selected node only (to reduce clutter)
    node
      .append("text")
      .attr("class", "nv-node-label")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => (d.type === "router" ? 38 : 28))
      .attr("fill", "#e2e8f0")
      .attr("font-size", 11)
      .attr("font-family", "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace")
      .attr("opacity", 0.0)
      .text((d) => (d.type === "router" ? "router" : d.ip));

    // Drag
    const drag = d3
      .drag<SVGGElement, GraphNode>()
      .on("start", (ev, d) => {
        if (!ev.active) sim.alphaTarget(0.2).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (ev, d) => {
        d.fx = ev.x;
        d.fy = ev.y;
      })
      .on("end", (ev, d) => {
        if (!ev.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    node.call(drag);

    // Force simulation
    const sim = d3
      .forceSimulation<GraphNode>(simNodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(simLinks)
          .id((d) => d.id)
          .distance((l) => {
            const t = typeof l.target === "string" ? null : l.target;
            const p = t?.ping_ms;
            if (p == null) return 170;
            return Math.max(70, Math.min(240, 80 + p * 8));
          })
          .strength(0.8),
      )
      .force("charge", d3.forceManyBody().strength(-220))
      .force("collide", d3.forceCollide<GraphNode>((d) => nodeRadius(d) + 6).iterations(2))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "radial",
        d3
          .forceRadial<GraphNode>(
            (d) => (d.type === "router" ? 0 : ringRadiusForPing(d.ping_ms)),
            width / 2,
            height / 2,
          )
          .strength((d) => (d.type === "router" ? 0 : d.ping_ms == null ? 0.06 : 0.12)),
      )
      .force("x", d3.forceX(width / 2).strength(0.04))
      .force("y", d3.forceY(height / 2).strength(0.04));

    // Pin router near center
    const router = simNodes.find((n) => n.type === "router");
    if (router) {
      router.fx = width / 2;
      router.fy = height / 2;
    }

    simRef.current = sim;

    // Tick throttling via rAF to avoid DOM over-updates.
    let raf = 0;
    const tick = () => {
      raf = 0;
      link
        .attr("x1", (d) => linkX(d.source))
        .attr("y1", (d) => linkY(d.source))
        .attr("x2", (d) => linkX(d.target))
        .attr("y2", (d) => linkY(d.target));

      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    };

    sim.on("tick", () => {
      if (!raf) raf = requestAnimationFrame(tick);
    });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      sim.stop();
    };
  }, [nodes, links, onSelectIp, routerIp]);

  useEffect(() => {
    // Update selection highlight without rebuilding sim.
    const gEl = gRef.current;
    if (!gEl) return;
    const g = d3.select(gEl);
    g.selectAll<SVGCircleElement, GraphNode>("circle.nv-node-circle")
      .attr("stroke-width", (d) => {
        const isSel = selectedIp && (d.ip === selectedIp || (d.type === "router" && selectedIp === d.ip));
        return d.type === "router" ? (isSel ? 4 : 2.5) : isSel ? 3.2 : 2;
      })
      .attr("stroke-opacity", (d) => {
        const isSel = selectedIp && (d.ip === selectedIp || (d.type === "router" && selectedIp === d.ip));
        return isSel ? 1 : 0.95;
      });

    g.selectAll<SVGTextElement, GraphNode>("text.nv-node-label").attr("opacity", (d) => {
      if (!selectedIp) return 0;
      const isSel = d.type === "router" ? selectedIp === d.ip : d.ip === selectedIp;
      return isSel ? 0.95 : 0;
    });
  }, [selectedIp]);

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <style>{`
        .nv-dash { animation: nvDash 1.2s linear infinite; }
        @keyframes nvDash { to { stroke-dashoffset: -24; } }
      `}</style>
      <svg ref={svgRef} className="h-full w-full">
        <g ref={gRef} />
      </svg>

      {tooltip ? (
        <div
          className="absolute z-10 max-w-[260px] rounded-lg bg-slate-950/80 px-3 py-2 text-xs text-slate-100 ring-1 ring-slate-700/60 backdrop-blur"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm">
              <span className="mr-1">{tooltip.node.device_icon || (tooltip.node.type === "router" ? "📡" : "❓")}</span>
              <span className="font-semibold">{tooltip.node.device_type || (tooltip.node.type === "router" ? "Router/AP" : "Unknown")}</span>
              <span className="text-slate-400"> · </span>
              <span className="font-mono">{tooltip.node.type === "router" ? "router" : tooltip.node.ip}</span>
            </div>
            <span
              className={[
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                tooltip.node.status === "online"
                  ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/20"
                  : "bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/20",
              ].join(" ")}
            >
              {tooltip.node.status}
            </span>
          </div>
          <div className="mt-1 space-y-1 text-slate-300">
            <Row k="IP" v={tooltip.node.ip} mono />
            {tooltip.node.mac ? <Row k="MAC" v={tooltip.node.mac} mono /> : null}
            <Row k="Vendor" v={tooltip.node.vendor || "Unknown"} />
            <Row k="Ping" v={tooltip.node.ping_ms == null ? "—" : `${tooltip.node.ping_ms} ms`} />
            <Row k="Connected" v={tooltip.node.connected_since ? tooltip.node.connected_since : "unknown"} />
          </div>
          <div className="mt-2 text-[10px] text-slate-400">
            Click background to close
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-slate-400">{k}</div>
      <div className={mono ? "font-mono text-slate-200" : "text-slate-200"}>{v}</div>
    </div>
  );
}

