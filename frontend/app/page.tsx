"use client";

import { useEffect } from "react";
import Scene3D from "@/components/Scene3D";
import CyberHUD from "@/components/CyberHUD";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useNetworkStore } from "@/store/useNetworkStore";

// Silent component that bridges the WebSocket hook into the Zustand store
function NetworkHydrator() {
  const { devices, hostInfo, isConnected, lastUpdate, error } = useWebSocket("ws://localhost:8000/ws");
  const setDevices = useNetworkStore((state) => state.setDevices);
  const setConnectionStatus = useNetworkStore((state) => state.setConnectionStatus);
  const setHostInfo = useNetworkStore((state) => state.setHostInfo);
  const appendTimeline = useNetworkStore((state) => state.appendTimeline);

  useEffect(() => {
    setDevices(devices);
    // Track total active connection counts over 30 ticks
    if (devices.length > 0) appendTimeline(devices.filter(d => d.status === 'online').length);
  }, [devices, setDevices, appendTimeline]);

  useEffect(() => {
    setHostInfo(hostInfo);
  }, [hostInfo, setHostInfo]);

  useEffect(() => {
    setConnectionStatus(isConnected, error);
  }, [isConnected, error, setConnectionStatus]);

  // Optionally could sync lastUpdate to store here as well, store already sets it on devices update.
  return null;
}

export default function Home() {
  return (
    <div className="relative w-screen h-screen bg-[#020617] overflow-hidden">
      <NetworkHydrator />
      <CyberHUD />
      <Scene3D />
    </div>
  );
}
