"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useNetworkStore } from "@/store/useNetworkStore";

export default function Heatmap() {
  const isHeatmapVisible = useNetworkStore(state => state.isHeatmapVisible);
  const devices = useNetworkStore(state => state.activeDevices);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);

  const CANVAS_SIZE = 1024; // High-res map
  const WORLD_SIZE = 260; // Represents [-130, 130] WebGL span
  
  useEffect(() => {
    if (!canvasRef.current) {
        canvasRef.current = document.createElement("canvas");
        canvasRef.current.width = CANVAS_SIZE;
        canvasRef.current.height = CANVAS_SIZE;
        textureRef.current = new THREE.CanvasTexture(canvasRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isHeatmapVisible || !canvasRef.current || !textureRef.current) return;
    
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    // Clear the deep space void natively
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)"; 
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Rasterize nodes
    devices.forEach((dev, index) => {
        const total = devices.length;
        const dynamicSpread = total > 50 ? 1.0 : 0.6;
        const phi = index * 2.39996;
        const radius = 15 + (index * dynamicSpread); 
        
        const worldX = Math.cos(phi) * radius;
        const worldZ = Math.sin(phi) * radius;

        // Project coordinate matrix into Canvas grids
        const cx = ((worldX + (WORLD_SIZE/2)) / WORLD_SIZE) * CANVAS_SIZE;
        const cy = ((worldZ + (WORLD_SIZE/2)) / WORLD_SIZE) * CANVAS_SIZE;

        const ping = dev.ping_ms;
        const isOffline = dev.status === 'offline';
        
        let colorCenter = "rgba(20, 20, 20, 0.4)"; 
        if (!isOffline && ping !== null) {
            if (ping < 20) colorCenter = "rgba(34, 197, 94, 0.9)"; // Strong Emerald
            else if (ping <= 100) colorCenter = "rgba(234, 179, 8, 0.8)"; // Medium Amber
            else colorCenter = "rgba(239, 68, 68, 0.8)"; // Weak Crimson
        }

        const dropoffRadius = CANVAS_SIZE * 0.12; 
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, dropoffRadius);
        gradient.addColorStop(0, colorCenter);
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

        ctx.fillStyle = gradient;
        ctx.fillRect(cx - dropoffRadius, cy - dropoffRadius, dropoffRadius * 2, dropoffRadius * 2);
    });

    // Flag memory hook to force Three.js to re-consume the updated canvas!
    textureRef.current.needsUpdate = true;
  }, [devices, isHeatmapVisible]);

  if (!isHeatmapVisible || !textureRef.current) return null;

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -6, 0]}>
      <planeGeometry args={[WORLD_SIZE, WORLD_SIZE]} />
      <meshBasicMaterial 
        map={textureRef.current} 
        transparent 
        opacity={0.8} 
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}
