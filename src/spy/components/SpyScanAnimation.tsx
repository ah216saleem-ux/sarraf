/**
 * SPY 3D Multi-Timeframe Scan Visualizer (Three.js)
 * Clean rotating candle-ring and point-cloud with live gate evaluation HUD.
 * 60fps, mobile-friendly, DPR capped, clean WebGL disposal.
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { SpyGateEvaluation, SpySignalDecision, SpyCandle } from '../types';
import { ShieldCheck, Activity, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

interface SpyScanAnimationProps {
  isScanning: boolean;
  candles: SpyCandle[];
  gates: SpyGateEvaluation[];
  finalDecision: SpySignalDecision | null;
  durationMs?: number;
  onScanComplete?: () => void;
}

export const SpyScanAnimation: React.FC<SpyScanAnimationProps> = ({
  isScanning,
  candles,
  gates,
  finalDecision,
  durationMs = 6800,
  onScanComplete,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [activeGateIndex, setActiveGateIndex] = useState<number>(0);
  const [scanProgress, setScanProgress] = useState<number>(0);

  // 7 Smart Money Gates
  const defaultGateNames = [
    'Ga: Order Block',
    'Gb: Sweep Wick',
    'Gc: FVG Retest',
    'Gd: CHoCH / BOS',
    'Ge: Trend Alignment',
    'Gf: Relative Volume',
    'Gg: Macro Filters',
  ];

  useEffect(() => {
    if (!isScanning) {
      setScanProgress(0);
      setActiveGateIndex(0);
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(100, Math.round((elapsed / durationMs) * 100));
      setScanProgress(progress);

      // Gate lighting milestones: ~14%, ~28%, ~42%, ~56%, ~70%, ~84%, ~96%
      if (progress >= 96) {
        setActiveGateIndex(7);
      } else if (progress >= 84) {
        setActiveGateIndex(6);
      } else if (progress >= 70) {
        setActiveGateIndex(5);
      } else if (progress >= 56) {
        setActiveGateIndex(4);
      } else if (progress >= 42) {
        setActiveGateIndex(3);
      } else if (progress >= 28) {
        setActiveGateIndex(2);
      } else if (progress >= 14) {
        setActiveGateIndex(1);
      }

      if (elapsed >= durationMs) {
        clearInterval(interval);
        if (onScanComplete) {
          onScanComplete();
        }
      }
    }, 50);

    return () => clearInterval(interval);
  }, [isScanning, durationMs, onScanComplete]);

  // Three.js Scene Setup
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 340;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x03050a, 0.04);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.set(0, 7, 13);
    camera.lookAt(0, 0, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.95;
      container.appendChild(renderer.domElement);
    } catch {
      return;
    }

    // Candle Ring Group
    const ringGroup = new THREE.Group();
    scene.add(ringGroup);

    // Build 3D candle bars in a circular orbit
    const ringRadius = 5.2;
    const sampleCandles = candles.length > 0 ? candles.slice(-48) : [];
    const candleCount = sampleCandles.length > 0 ? sampleCandles.length : 36;

    const candleMeshes: THREE.Mesh[] = [];
    const boxGeo = new THREE.BoxGeometry(0.22, 1, 0.22);

    for (let i = 0; i < candleCount; i++) {
      const angle = (i / candleCount) * Math.PI * 2;
      const c = sampleCandles[i];
      const isBull = c ? c.close >= c.open : i % 2 === 0;
      const heightVal = c ? Math.max(0.25, Math.min(3.0, Math.abs(c.close - c.open) * 1.5)) : 0.8 + Math.sin(i) * 0.4;

      const mat = new THREE.MeshBasicMaterial({
        color: isBull ? 0x22e08a : 0xff3b6b,
        transparent: true,
        opacity: 0.65,
      });

      const mesh = new THREE.Mesh(boxGeo, mat);
      mesh.scale.set(1, heightVal, 1);
      mesh.position.set(
        Math.cos(angle) * ringRadius,
        heightVal / 2 - 0.5,
        Math.sin(angle) * ringRadius
      );
      mesh.rotation.y = -angle;
      ringGroup.add(mesh);
      candleMeshes.push(mesh);
    }

    // Outer Target Rings
    const ringGeo1 = new THREE.RingGeometry(ringRadius - 0.1, ringRadius + 0.1, 64);
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0xe8b84a,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25,
    });
    const ringMesh1 = new THREE.Mesh(ringGeo1, ringMat1);
    ringMesh1.rotation.x = Math.PI / 2;
    ringMesh1.position.y = -0.6;
    scene.add(ringMesh1);

    const ringGeo2 = new THREE.RingGeometry(2.2, 2.3, 48);
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
    });
    const ringMesh2 = new THREE.Mesh(ringGeo2, ringMat2);
    ringMesh2.rotation.x = Math.PI / 2;
    ringMesh2.position.y = -0.55;
    scene.add(ringMesh2);

    // Point Cloud Core
    const particleCount = 180;
    const particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const pAngle = Math.random() * Math.PI * 2;
      const pRadius = 1.0 + Math.random() * 4.0;
      positions[i * 3] = Math.cos(pAngle) * pRadius;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 2.5;
      positions[i * 3 + 2] = Math.sin(pAngle) * pRadius;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const particleMat = new THREE.PointsMaterial({
      color: 0xcfe6ff,
      size: 0.12,
      transparent: true,
      opacity: 0.5,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // Animation Loop
    let animId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();

      // Rotate candle ring
      ringGroup.rotation.y += delta * 0.45;
      ringMesh2.rotation.z += delta * 0.6;
      particles.rotation.y -= delta * 0.2;

      // Dynamic color shift based on final decision when nearing completion
      if (finalDecision) {
        let targetColor = 0xc9a24a; // Neutral/gold
        if (finalDecision === 'CALL') targetColor = 0x22e08a;
        if (finalDecision === 'PUT') targetColor = 0xff3b6b;

        ringMat2.color.lerp(new THREE.Color(targetColor), delta * 2.0);
        particleMat.color.lerp(new THREE.Color(targetColor), delta * 2.0);
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container) return;
      const newW = container.clientWidth || 600;
      const newH = container.clientHeight || 340;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(newW, newH);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animId);
      boxGeo.dispose();
      ringGeo1.dispose();
      ringMat1.dispose();
      ringGeo2.dispose();
      ringMat2.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      candleMeshes.forEach((m) => {
        if (m.material instanceof THREE.Material) m.material.dispose();
      });
      renderer.dispose();
      if (container && renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [candles, finalDecision]);

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-[#E8B84A]/30 bg-[#03050a] shadow-[0_0_30px_rgba(0,0,0,0.8)]">
      {/* 3D Canvas Mount */}
      <div ref={mountRef} className="w-full h-72 sm:h-80" />

      {/* Floating SARRAF Scan Overlay HUD */}
      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4 sm:p-5 bg-gradient-to-t from-black/80 via-transparent to-black/60">
        {/* Top Scan Status Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#E8B84A] animate-ping" />
            <span className="font-mono text-xs font-black text-white tracking-widest uppercase">
              3D MULTI-TIMEFRAME QUANT SCAN
            </span>
          </div>

          <div className="flex items-center gap-3 font-mono text-xs">
            <span className="text-neutral-400">PROGRESS:</span>
            <span className="text-[#E8B84A] font-extrabold">{scanProgress}%</span>
          </div>
        </div>

        {/* Bottom Gate Sequencer Matrix */}
        <div className="space-y-1.5 max-w-xl mx-auto w-full">
          <div className="text-center font-mono text-[10px] text-neutral-400 tracking-wider pb-1">
            DETERMINISTIC EVALUATION PIPELINE
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-1.5">
            {defaultGateNames.map((gateName, idx) => {
              const isEvaluated = activeGateIndex > idx;
              const isCurrent = activeGateIndex === idx;
              const realGate = gates[idx];
              const passed = realGate ? realGate.passed : isEvaluated;

              return (
                <div
                  key={idx}
                  className={`p-1.5 rounded-lg border font-mono text-[10px] transition-all duration-300 ${
                    isEvaluated
                      ? passed
                        ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                        : 'bg-rose-950/40 border-rose-500/50 text-rose-300'
                      : isCurrent
                      ? 'bg-[#E8B84A]/20 border-[#E8B84A] text-white shadow-[0_0_10px_rgba(232,184,74,0.3)] animate-pulse'
                      : 'bg-black/40 border-white/5 text-neutral-500'
                  }`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-bold text-[9px]">{realGate ? `G${realGate.letter}` : gateName.slice(0, 2)}</span>
                    {isEvaluated ? (
                      passed ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <XCircle className="w-3 h-3 text-rose-400" />
                      )
                    ) : isCurrent ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#E8B84A] animate-ping" />
                    ) : (
                      <span className="text-neutral-600">•</span>
                    )}
                  </div>
                  <div className="truncate text-[8px] font-medium text-neutral-300">
                    {realGate ? realGate.name.split(' ')[0] : gateName.split(' ')[1] || gateName}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Progress track */}
          <div className="w-full bg-white/10 rounded-full h-1 mt-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-[#E8B84A] via-[#38bdf8] to-[#22e08a] h-1 rounded-full transition-all duration-100 ease-out"
              style={{ width: `${scanProgress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
