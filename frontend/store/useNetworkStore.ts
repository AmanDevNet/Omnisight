import { create } from "zustand";
import { HostInfo } from "@/hooks/useWebSocket";

export type DeviceStatus = "online" | "offline";

export interface Device {
  ip: string;
  mac: string;
  vendor: string | null;
  status: DeviceStatus;
  first_seen?: string;
  last_seen: string;
  ping_ms: number | null;
  is_anomalous?: boolean; 
  bandwidth_bps?: number; // Real-time bandwidth tracking
  device_type?: string;
  device_icon?: string;
  prediction?: string;
  is_ml_predicted?: boolean;
  is_verified?: boolean;
  os_ttl?: number;
  nmap_os?: string;
  ping_history?: number[];
}

interface NetworkState {
  devices: Device[];
  dvrDevices: Device[];
  isDVRMode: boolean;
  isHeatmapVisible: boolean;
  activeDevices: Device[];
  hostInfo: HostInfo | null;
  historyTimeline: { time: string, count: number }[];
  isConnected: boolean;
  lastUpdate: Date | null;
  error: string | null;
  hoveredNode: { device: Device, pos: [number, number, number] } | null;
  setDevices: (devices: Device[]) => void;
  setDVRDevices: (dvrDevices: Device[]) => void;
  setDVRMode: (isDVRMode: boolean) => void;
  setHeatmapVisible: (isHeatmapVisible: boolean) => void;
  setHostInfo: (info: HostInfo | null) => void;
  appendTimeline: (count: number) => void;
  setConnectionStatus: (isConnected: boolean, error?: string | null) => void;
  setHoveredNode: (node: { device: Device, pos: [number, number, number] } | null) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  devices: [],
  dvrDevices: [],
  isDVRMode: false,
  isHeatmapVisible: false,
  activeDevices: [],
  hostInfo: null,
  historyTimeline: [],
  isConnected: false,
  lastUpdate: null,
  error: null,
  hoveredNode: null,
  setDevices: (devices) => set((state) => ({ devices, activeDevices: state.isDVRMode ? state.dvrDevices : devices, lastUpdate: new Date() })),
  setDVRDevices: (dvrDevices) => set((state) => ({ dvrDevices, activeDevices: state.isDVRMode ? dvrDevices : state.devices })),
  setDVRMode: (isDVRMode) => set((state) => ({ isDVRMode, activeDevices: isDVRMode ? state.dvrDevices : state.devices })),
  setHeatmapVisible: (isHeatmapVisible) => set({ isHeatmapVisible }),
  setHostInfo: (hostInfo) => set({ hostInfo }),
  appendTimeline: (count) => set((state) => {
    const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });
    const newHistory = [...state.historyTimeline, { time: now, count }];
    return { historyTimeline: newHistory.slice(-30) };
  }),
  setConnectionStatus: (isConnected, error = null) => set({ isConnected, error }),
  setHoveredNode: (hoveredNode) => set({ hoveredNode }),
}));
