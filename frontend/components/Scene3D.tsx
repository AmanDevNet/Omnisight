import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html, QuadraticBezierLine, Environment, Sparkles, Grid } from "@react-three/drei";
import { useNetworkStore, Device } from "@/store/useNetworkStore";
import { useMemo, useState, useRef } from "react";
import * as THREE from "three";
import Heatmap from "./Heatmap";

// Deterministic positioning
const pseudoRandom = (seed: string) => {
  let h = 0xdeadbeef;
  for(let i=0; i<seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 2654435761);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
};

// ... formatBytes and SpatialCardNode remain exactly the same ...
function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const SpatialCardNode = ({ device, index, total }: { device: Device, index: number, total: number }) => {
  const [hovered, setHover] = useState(false);
  const setHoveredNode = useNetworkStore(state => state.setHoveredNode);
  
  const { x, y, z } = useMemo(() => {
    // Spider web radial distribution
    const dynamicSpread = total > 50 ? 1.0 : 0.6;
    const phi = index * 2.39996; // Golden angle for even distribution
    const radius = 15 + (index * dynamicSpread); 
    const elevation = Math.max(-10, Math.min(10, ((device.ping_ms || 10) / 10) - 2));
    
    return { 
      x: Math.cos(phi) * radius, 
      y: elevation,
      z: Math.sin(phi) * radius 
    };
  }, [index, device.ping_ms, total]);

  const isOffline = device.status === 'offline';
  
  const startObj = new THREE.Vector3(0, 0, 0);
  const endObj = new THREE.Vector3(x, y, z);
  
  const typeStr = device.device_type?.toLowerCase() || "";
  let accentColor = isOffline ? '#525252' : '#a3a3a3'; // Unknown fallback
  
  if (!isOffline) {
    if (device.ping_ms && device.ping_ms > 200) {
      accentColor = '#ef4444'; // Red tint for high latency
    } else if (typeStr.includes("windows") || typeStr.includes("laptop") || typeStr.includes("pc") || typeStr.includes("macbook")) {
      accentColor = '#3b82f6'; // Blue
    } else if (typeStr.includes("phone") || typeStr.includes("mobile") || typeStr.includes("android") || typeStr.includes("ios") || typeStr.includes("apple")) {
      accentColor = '#22c55e'; // Green
    } else if (typeStr.includes("infrastructure") || typeStr.includes("router") || typeStr.includes("ap")) {
      accentColor = '#f97316'; // Orange
    }
  }

  // Dynamic Sizes based on device type
  let baseSize = 0.4;
  if (typeStr.includes("router") || typeStr.includes("ap") || typeStr.includes("infrastructure")) baseSize = 1.4;
  else if (typeStr.includes("laptop") || typeStr.includes("pc") || typeStr.includes("windows") || typeStr.includes("macbook")) baseSize = 1.0;
  else if (typeStr.includes("phone") || typeStr.includes("apple") || typeStr.includes("android") || typeStr.includes("mobile") || typeStr.includes("ios")) baseSize = 0.7;
  else baseSize = 0.4; // unknown / IoT

  // Scale down slightly if massive network
  const finalSize = total > 50 ? baseSize * 0.7 : baseSize;

  return (
    <group>
      {/* Spider Web Lines - Connected to center (0,0,0) */}
      <QuadraticBezierLine 
        start={startObj} 
        end={endObj} 
        mid={new THREE.Vector3().copy(startObj).lerp(endObj, 0.5).setY(y - 5)} 
        color={accentColor} 
        lineWidth={(hovered || (device.ping_ms && device.ping_ms > 200)) ? 1.5 : 0.6}
        transparent 
        opacity={isOffline ? 0.2 : (hovered ? 0.9 : 0.4)} 
      />

      <mesh 
        position={[x, y, z]} 
        onPointerOver={(e) => { 
          e.stopPropagation(); 
          setHover(true); 
          setHoveredNode({ device, pos: [x, y, z] });
        }}
        onPointerOut={() => {
          setHover(false);
          setHoveredNode(null);
        }}
      >
        <sphereGeometry args={[finalSize, 24, 24]} />
        <meshStandardMaterial 
           color={accentColor} 
           emissive={accentColor} 
           emissiveIntensity={hovered ? 2.0 : 1.0} 
           transparent 
           opacity={isOffline ? 0.4 : 1.0} 
        />
      </mesh>
    </group>
  );
};

// Global Tooltip to completely eliminate hover lag
const GlobalHoverCard = () => {
  const hoveredNode = useNetworkStore(state => state.hoveredNode);
  if (!hoveredNode) return null;

  const { device, pos } = hoveredNode;
  const isOffline = device.status === 'offline';
  const dType = device.device_type || "Unidentified Device";
  const icon = device.device_icon || "❓";
  const isMlPredicted = device.is_ml_predicted;
  const isVerified = device.is_verified;
  const ping = device.ping_ms ? `${Math.round(device.ping_ms)}ms` : "—";

  return (
    <Html position={pos} center style={{ pointerEvents: 'none', zIndex: 100 }}>
       <div 
          className="flex flex-col gap-2 bg-[#0a0a0a]/95 backdrop-blur-xl border border-neutral-700 shadow-[0_0_40px_rgba(0,0,0,0.8)] rounded-2xl p-4 min-w-[220px]"
        >
          <div className="flex items-center gap-3 border-b border-neutral-800 pb-2">
             <div className="text-xl">{icon}</div>
             <div className="flex flex-col">
               <span className="text-white text-sm font-bold tracking-tight">{device.ip}</span>
               <span className="text-neutral-400 text-[11px] font-medium">{dType}</span>
             </div>
          </div>

          <div className="flex flex-col mt-2 gap-1.5 opacity-90">
             <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-500">IP Address</span>
                <span className="font-mono text-neutral-300">{device.ip}</span>
             </div>
             <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-500">MAC</span>
                <span className="font-mono text-neutral-300">{device.mac}</span>
             </div>
             
             {!isOffline && (
               <div className="flex justify-between items-center text-xs">
                  <span className="text-neutral-500">Latency</span>
                  <span className={`${device.ping_ms && device.ping_ms > 100 ? 'text-amber-400 font-bold' : 'text-neutral-300'}`}>{ping}</span>
               </div>
             )}

             <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-500">OS Name</span>
                <span className="text-neutral-300 font-medium">
                  {device.nmap_os ? device.nmap_os : (
                    device.os_ttl === 128 ? 'Windows' : (
                      device.os_ttl === 64 ? 'Linux/Android/iOS' : (
                        device.os_ttl === 255 ? 'Network Infrastructure' : 'Unknown'
                      )
                    )
                  )}
                </span>
             </div>
          </div>

          {device.prediction && (
            <div className="mt-1 flex flex-col gap-1.5">
              <div className="text-[#3b82f6] text-[11px] font-semibold px-2.5 py-1.5 bg-[#3b82f6]/10 border border-[#3b82f6]/30 rounded text-center">
                {device.prediction}
              </div>
              <div className="flex justify-end gap-1">
                 {isMlPredicted && <span className="text-[8px] font-bold text-purple-400 uppercase tracking-widest bg-purple-500/20 px-1.5 py-0.5 rounded shadow-[0_0_8px_rgba(168,85,247,0.3)] border border-purple-500/30">🤖 ML Predicted</span>}
                 {isVerified && <span className="text-[8px] font-bold text-green-400 uppercase tracking-widest bg-green-500/20 px-1.5 py-0.5 rounded shadow-[0_0_8px_rgba(74,222,128,0.3)] border border-green-500/30">✓ Verified</span>}
              </div>
            </div>
          )}
        </div>
    </Html>
  );
};

export default function Scene3D() {
  const devices = useNetworkStore(state => state.activeDevices);
  
  return (
    <div className="w-full h-full bg-[#030303] absolute inset-0 z-0 selection:bg-neutral-800">
      <Canvas camera={{ position: [0, 60, 80], fov: 40 }}>
        <color attach="background" args={["#030303"]} />
        {/* Pushed fog far out so grids don't turn instantly black */}
        <fog attach="fog" args={["#030303", 80, 400]} />
        
        <pointLight position={[0, 50, 0]} intensity={2.0} color="#3b82f6" />
        <Environment preset="city" />
        <Heatmap />

        <Sparkles count={800} scale={150} size={1.5} speed={0.2} opacity={0.15} color="#a5b4fc" />
        
        {/* Infinite Grid effect - Massive floor and ceiling grids to cover 3D space fully */}
        <Grid 
          position={[0, -20, 0]} 
          args={[2000, 2000]} 
          cellSize={3} 
          cellThickness={1} 
          cellColor="#222222" 
          sectionSize={15} 
          sectionThickness={1.5} 
          sectionColor="#333333" 
          fadeDistance={250} 
        />
        <Grid 
          position={[0, 50, 0]} 
          rotation={[Math.PI, 0, 0]}
          args={[2000, 2000]} 
          cellSize={3} 
          cellThickness={1} 
          cellColor="#222222" 
          sectionSize={15} 
          sectionThickness={1.5} 
          sectionColor="#333333" 
          fadeDistance={250} 
        />

        <Html position={[0, 0, 0]} transform center sprite zIndexRange={[100, 0]}>
          <div className="flex flex-col items-center justify-center p-6 bg-gradient-to-b from-neutral-900 to-black border border-neutral-800 rounded-3xl shadow-[0_0_50px_rgba(255,255,255,0.05)] pointer-events-none">
            <div className="w-14 h-14 bg-white rounded-2xl mb-4 flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.5)]">
              <div className="text-black text-xl font-bold">GTW</div>
            </div>
            <div className="text-white text-md font-semibold tracking-tight">Main Network Router</div>
          </div>
        </Html>

        {devices.map((d, i) => (
          <SpatialCardNode key={d.mac + d.ip} device={d} index={i} total={devices.length} />
        ))}

        <GlobalHoverCard />

        <OrbitControls 
          enablePan={true}
          enableZoom={true} 
          enableRotate={true} 
          autoRotate={false} 
          maxPolarAngle={Math.PI / 1.5}
          minDistance={10}
          maxDistance={300}
          makeDefault 
        />
      </Canvas>
    </div>
  );
}
