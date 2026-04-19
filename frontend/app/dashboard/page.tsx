"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Scene3D from "@/components/Scene3D";
import CyberHUD from "@/components/CyberHUD";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useNetworkStore } from "@/store/useNetworkStore";

// Silent component that bridges the WebSocket hook into the Zustand store
function NetworkHydrator({ apiKey }: { apiKey: string }) {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws";
  const { devices, hostInfo, isConnected, lastUpdate, error } = useWebSocket(`${wsUrl}?api_key=${apiKey}`);
  const setDevices = useNetworkStore((state) => state.setDevices);
  const setConnectionStatus = useNetworkStore((state) => state.setConnectionStatus);
  const setHostInfo = useNetworkStore((state) => state.setHostInfo);
  const appendTimeline = useNetworkStore((state) => state.appendTimeline);

  useEffect(() => {
    setDevices(devices);
    if (devices.length > 0) appendTimeline(devices.filter(d => d.status === 'online').length);
  }, [devices, setDevices, appendTimeline]);

  useEffect(() => {
    setHostInfo(hostInfo);
  }, [hostInfo, setHostInfo]);

  useEffect(() => {
    // If we get an error or disconnect, it could be bad auth
    setConnectionStatus(isConnected, error);
  }, [isConnected, error, setConnectionStatus]);

  return null;
}

export default function Dashboard() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    const key = localStorage.getItem("omnisight_api_key");
    if (!key) {
      router.push("/login");
    } else {
      setApiKey(key);
    }
  }, [router]);

  if (!apiKey) return <div className="h-screen w-screen bg-black flex items-center justify-center text-white">Authenticating...</div>;

  return (
    <div className="relative w-screen h-screen bg-[#020617] overflow-hidden">
      <NetworkHydrator apiKey={apiKey} />
      <CyberHUD />
      <Scene3D />
    </div>
  );
}
