import { useEffect, useMemo, useRef, useState } from "react";

export type DeviceStatus = "online" | "offline";

export type Device = {
  ip: string;
  mac: string;
  vendor: string | null;
  ping_ms: number | null;
  last_seen: string; // ISO string from backend
  status: DeviceStatus;
  device_type?: string;
  device_icon?: string;
  connected_since?: string;
  os_ttl?: number;
  nmap_os?: string;
  ping_history?: number[];
};

export type HostInfo = {
  bytes_sent: number;
  bytes_recv: number;
  iface: string | null;
};

export type DevicesMessage = {
  type: "devices";
  timestamp: string;
  data: Device[];
  host_info?: HostInfo;
};

function isDevicesMessage(v: unknown): v is DevicesMessage {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.type !== "devices") return false;
  if (typeof o.timestamp !== "string") return false;
  if (!Array.isArray(o.data)) return false;
  return true;
}

export function useWebSocket(url: string = "ws://localhost:8000/ws") {
  const [devices, setDevices] = useState<Device[]>([]);
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const shouldReconnect = useRef(true);

  const connect = () => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (!shouldReconnect.current) return;
        if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
        reconnectTimer.current = window.setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        setError("WebSocket error");
      };

      ws.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data as string) as unknown;
          if (!isDevicesMessage(parsed)) return;
          setDevices(parsed.data);
          if (parsed.host_info) {
             setHostInfo(parsed.host_info);
          }
          setLastUpdate(new Date(parsed.timestamp));
          setError(null);
        } catch {
          setError("Failed to parse WebSocket message");
        }
      };
    } catch {
      setError("Failed to connect WebSocket");
      setIsConnected(false);
      if (!shouldReconnect.current) return;
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = window.setTimeout(connect, 3000);
    }
  };

  useEffect(() => {
    shouldReconnect.current = true;
    connect();
    return () => {
      shouldReconnect.current = false;
      setIsConnected(false);
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return useMemo(
    () => ({ devices, hostInfo, isConnected, lastUpdate, error }),
    [devices, hostInfo, isConnected, lastUpdate, error],
  );
}

