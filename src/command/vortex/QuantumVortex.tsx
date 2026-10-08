import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import * as THREE from 'three';
import { useCommandFeed } from '../data/useCommandFeed';
import { vortexVertexShader, vortexFragmentShader } from './vortexShaders';
import { TickBurstPool } from './TickBurstPool';
import { CandleRing } from './CandleRing';
import { CoreMesh } from './CoreMesh';
import { QuantumVortexProps, QuantumVortexHooks, Phase4State } from './types';
import { Zap, Activity, ShieldAlert, Sparkles, AlertCircle, RefreshCw } from 'lucide-react';

export const QuantumVortex = forwardRef<QuantumVortexHooks, QuantumVortexProps>(({
  className = '',
  onRegisterHooks,
}, ref) => {
  const feed = useCommandFeed();

  // Container & Canvas references
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // WebGL availability state
  const [webglAvailable, setWebglAvailable] = useState<boolean>(true);

  // Reduced motion preference
  const prefersReducedMotion = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  // Intro state (2.5s once per tab session)
  const [introActive, setIntroActive] = useState<boolean>(() => {
    if (typeof window === 'undefined' || prefersReducedMotion) return false;
    const played = sessionStorage.getItem('sarraf_quantum_vortex_intro');
    return !played;
  });
  const [introProgress, setIntroProgress] = useState<number>(prefersReducedMotion ? 1.0 : 0.0);

  // Smooth number tweens for HUD BUY FLOW & SELL FLOW
  const [displayBuyRatio, setDisplayBuyRatio] = useState<number>(feed.buyRatio);
  const [displaySellRatio, setDisplaySellRatio] = useState<number>(feed.sellRatio);

  // Flash color state for central live price under core
  const [priceFlash, setPriceFlash] = useState<'UP' | 'DOWN' | 'NONE'>('NONE');
  const prevPriceRef = useRef<number>(feed.currentPrice);

  // Phase 4 Hook State
  const [phase4State, setPhase4State] = useState<Phase4State>({
    shockwaveActive: false,
    shockwaveTime: 0,
    shockwaveSide: 'BUY',
    resultActive: false,
    resultTime: 0,
    resultType: 'TP',
    cooldownSeconds: 0,
  });

  // Three.js instances ref
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    vortexPoints: THREE.Points;
    vortexMaterial: THREE.ShaderMaterial;
    coreMesh: CoreMesh;
    candleRing: CandleRing;
    tickBursts: TickBurstPool;
    animFrameId: number;
    clock: THREE.Clock;
    isDragging: boolean;
    dragStartX: number;
    dragStartY: number;
    rotVelX: number;
    rotVelY: number;
    targetDistance: number;
    currentDistance: number;
    buyRatioSmoothed: number;
    speedSmoothed: number;
    tiltSmoothed: number;
    introStartTime: number;
  } | null>(null);

  // Phase 4 Hook Definitions
  const triggerSignal = useCallback((side: 'BUY' | 'SELL') => {
    setPhase4State((prev) => ({
      ...prev,
      shockwaveActive: true,
      shockwaveTime: performance.now(),
      shockwaveSide: side,
    }));
    threeRef.current?.coreMesh.triggerSignal(side);
  }, []);

  const triggerResult = useCallback((result: 'TP' | 'SL') => {
    setPhase4State((prev) => ({
      ...prev,
      resultActive: true,
      resultTime: performance.now(),
      resultType: result,
    }));
    threeRef.current?.coreMesh.triggerResult(result);
  }, []);

  const setCooldown = useCallback((secondsLeft: number) => {
    setPhase4State((prev) => ({
      ...prev,
      cooldownSeconds: secondsLeft,
    }));
    threeRef.current?.coreMesh.setCooldown(secondsLeft);
  }, []);

  // Expose imperative hooks
  useImperativeHandle(ref, () => ({
    triggerSignal,
    triggerResult,
    setCooldown,
  }), [triggerSignal, triggerResult, setCooldown]);

  useEffect(() => {
    if (onRegisterHooks) {
      onRegisterHooks({ triggerSignal, triggerResult, setCooldown });
    }
  }, [onRegisterHooks, triggerSignal, triggerResult, setCooldown]);

  // Skip Intro Handler
  const handleSkipIntro = () => {
    setIntroActive(false);
    setIntroProgress(1.0);
    sessionStorage.setItem('sarraf_quantum_vortex_intro', 'true');
  };

  // Price Flash Trigger on Live Ticks
  useEffect(() => {
    if (feed.currentPrice > 0 && prevPriceRef.current > 0 && feed.currentPrice !== prevPriceRef.current) {
      const isUp = feed.currentPrice > prevPriceRef.current || feed.tickDirection === 'BUY';
      setPriceFlash(isUp ? 'UP' : 'DOWN');

      // Emit tick burst into 3D pool
      const delta = feed.currentPrice - prevPriceRef.current;
      threeRef.current?.tickBursts.emit({
        direction: feed.tickDirection,
        delta,
      });

      const timer = setTimeout(() => {
        setPriceFlash('NONE');
      }, 350);
      prevPriceRef.current = feed.currentPrice;
      return () => clearTimeout(timer);
    }
    prevPriceRef.current = feed.currentPrice;
  }, [feed.currentPrice, feed.tickDirection]);

  // Smooth tween for HUD ratios
  useEffect(() => {
    let animId: number;
    const step = () => {
      setDisplayBuyRatio((prev) => {
        const diff = feed.buyRatio - prev;
        return Math.abs(diff) < 0.1 ? feed.buyRatio : Number((prev + diff * 0.12).toFixed(1));
      });
      setDisplaySellRatio((prev) => {
        const diff = feed.sellRatio - prev;
        return Math.abs(diff) < 0.1 ? feed.sellRatio : Number((prev + diff * 0.12).toFixed(1));
      });
      animId = requestAnimationFrame(step);
    };
    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [feed.buyRatio, feed.sellRatio]);

  // Update Candle Ring with active candles
  useEffect(() => {
    if (threeRef.current && feed.candles.length > 0) {
      threeRef.current.candleRing.updateCandles(feed.candles);
    }
  }, [feed.candles]);

  // Main Three.js Lifecycle
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    // Check WebGL support
    try {
      const testCanvas = document.createElement('canvas');
      const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
      if (!gl) {
        setWebglAvailable(false);
        return;
      }
    } catch {
      setWebglAvailable(false);
      return;
    }

    const width = container.clientWidth || 360;
    const height = container.clientHeight || 280;

    const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;
    const particleCount = isMobile ? 4000 : 12000;
    const maxDpr = isMobile ? 1.5 : Math.min(window.devicePixelRatio || 1, 2.0);

    // 1. Scene & Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#04060b');

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 1.2, 6.8);
    camera.lookAt(0, 0, 0);

    // 2. Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !isMobile,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(maxDpr);

    // 3. Vortex Particles Geometry & Shader
    const positions = new Float32Array(particleCount * 3);
    const seeds = new Float32Array(particleCount * 4);
    const types = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 0.1;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 0.1;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.1;

      // Seed attributes for individual spiral flow
      seeds[i * 4 + 0] = Math.random(); // radius offset
      seeds[i * 4 + 1] = Math.random() * Math.PI * 2; // initial theta
      seeds[i * 4 + 2] = 0.5 + Math.random() * 0.8; // speed multiplier
      seeds[i * 4 + 3] = Math.random(); // stream offset / phase

      types[i] = Math.random(); // 0.0 to 1.0 selector
    }

    const vortexGeometry = new THREE.BufferGeometry();
    vortexGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    vortexGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    vortexGeometry.setAttribute('aType', new THREE.BufferAttribute(types, 1));

    const vortexMaterial = new THREE.ShaderMaterial({
      vertexShader: vortexVertexShader,
      fragmentShader: vortexFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uBuyRatio: { value: 0.5 },
        uDominance: { value: 0.0 },
        uSpeed: { value: 1.0 },
        uTilt: { value: 0.0 },
        uBreathe: { value: 1.0 },
        uIntroProgress: { value: prefersReducedMotion ? 1.0 : 0.0 },
        uPixelRatio: { value: maxDpr },
        uGlitch: { value: 0.0 },
        uShockwave: { value: 0.0 },
        uColorGold: { value: new THREE.Color('#f5c451') },
        uColorBuy: { value: new THREE.Color('#22e08a') },
        uColorSell: { value: new THREE.Color('#ff3b6b') },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const vortexPoints = new THREE.Points(vortexGeometry, vortexMaterial);
    scene.add(vortexPoints);

    // 4. Central Core Mesh
    const coreMesh = new CoreMesh();
    scene.add(coreMesh.group);

    // 5. Candlestick Ring
    const candleRing = new CandleRing();
    scene.add(candleRing.group);

    // 6. Tick Burst Pool
    const tickBursts = new TickBurstPool();
    scene.add(tickBursts.mesh);

    // State container
    const clock = new THREE.Clock();
    const inst = {
      scene,
      camera,
      renderer,
      vortexPoints,
      vortexMaterial,
      coreMesh,
      candleRing,
      tickBursts,
      animFrameId: 0,
      clock,
      isDragging: false,
      dragStartX: 0,
      dragStartY: 0,
      rotVelX: 0,
      rotVelY: 0,
      targetDistance: 6.8,
      currentDistance: 6.8,
      buyRatioSmoothed: 0.5,
      speedSmoothed: 1.0,
      tiltSmoothed: 0.0,
      introStartTime: performance.now(),
    };
    threeRef.current = inst;

    // Load initial candles if already available
    if (feed.candles.length > 0) {
      candleRing.updateCandles(feed.candles);
    }

    // 7. Mouse & Touch Interaction (Drag with Inertia & Zoom)
    const onMouseDown = (e: MouseEvent) => {
      inst.isDragging = true;
      inst.dragStartX = e.clientX;
      inst.dragStartY = e.clientY;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!inst.isDragging) return;
      const dx = e.clientX - inst.dragStartX;
      const dy = e.clientY - inst.dragStartY;
      inst.dragStartX = e.clientX;
      inst.dragStartY = e.clientY;

      inst.rotVelY += dx * 0.0035;
      inst.rotVelX += dy * 0.0035;
    };

    const onMouseUp = () => {
      inst.isDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      inst.targetDistance = Math.max(4.8, Math.min(8.8, inst.targetDistance + e.deltaY * 0.004));
    };

    // Touch handlers for mobile
    let touchStartDist = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        inst.isDragging = true;
        inst.dragStartX = e.touches[0].clientX;
        inst.dragStartY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        inst.isDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchStartDist = Math.sqrt(dx * dx + dy * dy);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && inst.isDragging) {
        const dx = e.touches[0].clientX - inst.dragStartX;
        const dy = e.touches[0].clientY - inst.dragStartY;
        inst.dragStartX = e.touches[0].clientX;
        inst.dragStartY = e.touches[0].clientY;

        inst.rotVelY += dx * 0.004;
        inst.rotVelX += dy * 0.004;
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const diff = touchStartDist - dist;
        inst.targetDistance = Math.max(4.8, Math.min(8.8, inst.targetDistance + diff * 0.01));
        touchStartDist = dist;
      }
    };

    const onTouchEnd = () => {
      inst.isDragging = false;
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);

    // 8. Resize Observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w > 0 && h > 0) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      }
    });
    resizeObserver.observe(container);

    // 9. Intersection Observer (pause rendering when scrolled out of view)
    let isIntersecting = true;
    const intersectionObserver = new IntersectionObserver((entries) => {
      isIntersecting = entries[0].isIntersecting;
    });
    intersectionObserver.observe(container);

    // 10. Animation Render Loop
    let introDone = prefersReducedMotion;
    const renderLoop = () => {
      inst.animFrameId = requestAnimationFrame(renderLoop);

      // Skip render if tab hidden or off-screen
      if (document.visibilityState === 'hidden' || !isIntersecting) {
        return;
      }

      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsedTime = clock.getElapsedTime();

      // Intro progress calculation (2.5 seconds)
      let curIntro = 1.0;
      if (!introDone) {
        const elapsedIntro = (performance.now() - inst.introStartTime) / 2500;
        curIntro = Math.min(1.0, elapsedIntro);
        setIntroProgress(curIntro);
        if (curIntro >= 1.0) {
          introDone = true;
          setIntroActive(false);
          sessionStorage.setItem('sarraf_quantum_vortex_intro', 'true');
        }
      }

      // Smooth camera zoom
      inst.currentDistance += (inst.targetDistance - inst.currentDistance) * 0.08;
      camera.position.z = inst.currentDistance;

      // Apply drag rotation with inertia
      if (!inst.isDragging) {
        inst.rotVelY += 0.0003; // Gentle auto-rotate
      }
      scene.rotation.y += inst.rotVelY;
      scene.rotation.x = Math.max(-0.6, Math.min(0.6, scene.rotation.x + inst.rotVelX));
      inst.rotVelX *= 0.92;
      inst.rotVelY *= 0.92;

      // Smooth buy/sell ratio uniform
      const targetRatio = feed.buyRatio / 100;
      inst.buyRatioSmoothed += (targetRatio - inst.buyRatioSmoothed) * 0.08;

      // Balanced logic (45-55%): breathe slowly
      const dominance = Math.abs(inst.buyRatioSmoothed - 0.5) * 2.0; // 0.0 to 1.0
      const targetSpeed = 1.0 + dominance * 0.8; // Up to 1.8x
      inst.speedSmoothed += (targetSpeed - inst.speedSmoothed) * 0.05;

      const targetTilt = (inst.buyRatioSmoothed > 0.5 ? 1 : -1) * dominance * 0.1396; // Max 8 degrees
      inst.tiltSmoothed += (targetTilt - inst.tiltSmoothed) * 0.05;

      const breathe = 1.0 + Math.sin(elapsedTime * 1.5) * (0.04 * (1.0 - dominance * 0.7));

      // Update Vortex Uniforms
      vortexMaterial.uniforms.uTime.value = elapsedTime;
      vortexMaterial.uniforms.uBuyRatio.value = inst.buyRatioSmoothed;
      vortexMaterial.uniforms.uDominance.value = dominance;
      vortexMaterial.uniforms.uSpeed.value = inst.speedSmoothed;
      vortexMaterial.uniforms.uTilt.value = inst.tiltSmoothed;
      vortexMaterial.uniforms.uBreathe.value = breathe;
      vortexMaterial.uniforms.uIntroProgress.value = curIntro;

      // Update Phase 4 hooks in uniforms
      if (phase4State.shockwaveActive) {
        const waveProgress = (performance.now() - phase4State.shockwaveTime) / 1000;
        vortexMaterial.uniforms.uShockwave.value = Math.min(1.0, waveProgress);
      } else {
        vortexMaterial.uniforms.uShockwave.value = 0.0;
      }

      if (phase4State.resultActive && phase4State.resultType === 'SL') {
        const glitchProgress = (performance.now() - phase4State.resultTime) / 800;
        vortexMaterial.uniforms.uGlitch.value = Math.max(0.0, 1.0 - glitchProgress);
      } else {
        vortexMaterial.uniforms.uGlitch.value = 0.0;
      }

      // Update Subsystems
      coreMesh.update(delta, curIntro, phase4State);
      candleRing.update(delta, curIntro);
      tickBursts.update(delta);

      renderer.render(scene, camera);
    };

    renderLoop();

    // 11. Cleanup on Unmount
    return () => {
      cancelAnimationFrame(inst.animFrameId);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();

      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);

      vortexGeometry.dispose();
      vortexMaterial.dispose();
      coreMesh.dispose();
      candleRing.dispose();
      tickBursts.dispose();
      renderer.dispose();
      threeRef.current = null;
    };
  }, [prefersReducedMotion]);

  // Real Values for 6 Floating HUD Badges
  const hudBadges = [
    {
      id: 'momentum',
      label: 'MOMENTUM',
      value: feed.confidence.momentum > 0 ? `${feed.confidence.momentum}%` : (feed.regime.trend !== 'N/A' ? feed.regime.trend : 'COLLECTING'),
      color: feed.confidence.momentum >= 55 ? 'text-[#22e08a]' : feed.confidence.momentum <= 45 ? 'text-[#ff3b6b]' : 'text-[#f5c451]',
      glow: feed.confidence.momentum >= 55 ? 'border-[#22e08a]/30' : feed.confidence.momentum <= 45 ? 'border-[#ff3b6b]/30' : 'border-[#f5c451]/30',
    },
    {
      id: 'sentiment',
      label: 'SENTIMENT',
      value: feed.buyRatio >= 54 ? 'BULLISH' : feed.buyRatio <= 46 ? 'BEARISH' : 'NEUTRAL',
      color: feed.buyRatio >= 54 ? 'text-[#22e08a]' : feed.buyRatio <= 46 ? 'text-[#ff3b6b]' : 'text-[#f5c451]',
      glow: feed.buyRatio >= 54 ? 'border-[#22e08a]/30' : feed.buyRatio <= 46 ? 'border-[#ff3b6b]/30' : 'border-[#f5c451]/30',
    },
    {
      id: 'poc',
      label: 'POC/PROFILE',
      value: feed.originLevels[0]?.priceLevel ? `$${feed.originLevels[0].priceLevel.toFixed(1)}` : 'N/A',
      color: 'text-[#e8edf5]',
      glow: 'border-[#38bdf8]/30',
    },
    {
      id: 'absorption',
      label: 'ABSORPTION',
      value: (feed.absorptionBuyZones.length + feed.absorptionSellZones.length > 0)
        ? `${feed.absorptionBuyZones.length + feed.absorptionSellZones.length} ZONES`
        : 'ACTIVE',
      color: 'text-[#e8edf5]',
      glow: 'border-white/10',
    },
    {
      id: 'tickdata',
      label: 'TICK DATA',
      value: feed.spread > 0 ? `$${feed.spread.toFixed(2)} SPD` : `${feed.buyTicks60s + feed.sellTicks60s} T/M`,
      color: feed.spread <= 0.35 ? 'text-[#22e08a]' : 'text-[#f5c451]',
      glow: feed.spread <= 0.35 ? 'border-[#22e08a]/30' : 'border-[#f5c451]/30',
    },
    {
      id: 'fvg',
      label: 'FVG/OB',
      value: feed.liquidityZones[0]?.label || (feed.nearestZone ? feed.nearestZone.label : 'N/A'),
      color: 'text-[#e8edf5]',
      glow: 'border-white/10',
    },
  ];

  const isDisconnected = feed.connection.status === 'RECONNECTING' || feed.connection.status === 'OFFLINE';

  // Fallback banner if WebGL fails
  if (!webglAvailable) {
    return (
      <div className={`relative rounded-xl bg-[#070b14] border border-[#f5c451]/30 p-4 font-mono text-[#e8edf5] ${className}`}>
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] text-[#8a96a8] uppercase">BUY FLOW %</span>
            <span className="text-xl font-bold text-[#22e08a]">{displayBuyRatio}%</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-[#f5c451]">XAU/USD CORE</span>
            <span className="text-2xl font-bold text-white">${feed.currentPrice.toFixed(2)}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-[#8a96a8] uppercase">SELL FLOW %</span>
            <span className="text-xl font-bold text-[#ff3b6b]">{displaySellRatio}%</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-[290px] sm:h-[320px] rounded-xl overflow-hidden bg-[#04060b] border border-[#f5c451]/25 select-none ${className}`}
    >
      {/* 3D WebGL Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-grab active:cursor-grabbing touch-none"
      />

      {/* Reconnecting Dimming Overlay */}
      {isDisconnected && (
        <div className="absolute inset-0 bg-[#04060b]/75 backdrop-blur-[2px] z-30 flex items-center justify-center p-4 pointer-events-none">
          <div className="px-3.5 py-1.5 rounded-full bg-[#ff3b6b]/20 border border-[#ff3b6b]/50 text-[#ff3b6b] flex items-center gap-2 text-xs font-mono font-bold animate-pulse shadow-[0_0_20px_rgba(255,59,107,0.3)]">
            <span className="w-2 h-2 rounded-full bg-[#ff3b6b] animate-ping" />
            <span>RECONNECTING FEED · NO STALE DATA</span>
          </div>
        </div>
      )}

      {/* Intro Overlay with Tap to Skip (2.5s once per tab session) */}
      {introActive && (
        <div
          onClick={handleSkipIntro}
          className="absolute inset-0 z-40 bg-[#04060b]/90 backdrop-blur-sm flex flex-col items-center justify-center p-4 cursor-pointer transition-opacity duration-300"
        >
          <div className="flex flex-col items-center space-y-2 text-center pointer-events-auto">
            <div className="w-8 h-8 rounded-full bg-[#f5c451]/20 border border-[#f5c451]/60 flex items-center justify-center text-[#f5c451] animate-pulse shadow-[0_0_20px_rgba(245,196,81,0.4)]">
              <Sparkles className="w-4 h-4 text-[#f5c451]" />
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] font-mono tracking-[0.16em] uppercase text-[#f5c451] font-bold">
                QUANTUM VORTEX INITIALIZING
              </span>
              <div className="text-xs font-mono text-[#8a96a8]">
                Tap anywhere to skip
              </div>
            </div>
            {/* Intro progress line */}
            <div className="w-36 h-1 bg-white/10 rounded-full overflow-hidden mt-1">
              <div
                className="h-full bg-gradient-to-r from-[#22e08a] via-[#f5c451] to-[#ff3b6b] transition-all duration-75"
                style={{ width: `${Math.round(introProgress * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* HTML OVERLAY HUD */}
      <div className="absolute inset-0 pointer-events-none p-2 sm:p-3 flex flex-col justify-between z-20">
        {/* TOP HUD BAR: BUY FLOW (Left), Status Badge (Center), SELL FLOW (Right) */}
        <div className="flex items-start justify-between">
          {/* Left: BUY FLOW % */}
          <div className="flex flex-col items-start bg-black/40 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-[#22e08a]/25 shadow-[0_2px_10px_rgba(34,224,138,0.1)]">
            <span className="text-[9px] uppercase tracking-[0.12em] font-mono text-[#8a96a8]">
              BUY FLOW (60S)
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-lg sm:text-xl font-bold font-mono tabular-nums text-[#22e08a]">
                {displayBuyRatio.toFixed(1)}%
              </span>
              <span className="text-[9px] font-mono text-[#22e08a]/70">EST.</span>
            </div>
          </div>

          {/* Center-Top: Title & State Indicator */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md border border-[#f5c451]/30">
            <span className="w-1.5 h-1.5 rounded-full bg-[#f5c451] animate-pulse" />
            <span className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-[#f5c451]">
              QUANTUM VORTEX 3D
            </span>
          </div>

          {/* Right: SELL FLOW % */}
          <div className="flex flex-col items-end text-right bg-black/40 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-[#ff3b6b]/25 shadow-[0_2px_10px_rgba(255,59,107,0.1)]">
            <span className="text-[9px] uppercase tracking-[0.12em] font-mono text-[#8a96a8]">
              SELL FLOW (60S)
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-[9px] font-mono text-[#ff3b6b]/70">EST.</span>
              <span className="text-lg sm:text-xl font-bold font-mono tabular-nums text-[#ff3b6b]">
                {displaySellRatio.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* CENTER OVERLAY: LIVE PRICE IN CRISP MONOSPACE UNDER THE CORE */}
        <div className="self-center flex flex-col items-center text-center mt-auto mb-auto pointer-events-none">
          <div
            className={`px-3 py-1 rounded-lg backdrop-blur-md border transition-all duration-200 ${
              priceFlash === 'UP'
                ? 'bg-[#22e08a]/20 border-[#22e08a] text-[#22e08a] shadow-[0_0_20px_rgba(34,224,138,0.5)] scale-105'
                : priceFlash === 'DOWN'
                ? 'bg-[#ff3b6b]/20 border-[#ff3b6b] text-[#ff3b6b] shadow-[0_0_20px_rgba(255,59,107,0.5)] scale-105'
                : 'bg-black/60 border-white/15 text-[#e8edf5]'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono tracking-wider text-[#8a96a8] uppercase">
                XAU/USD SPOT
              </span>
              <span className="w-1 h-1 rounded-full bg-[#f5c451]" />
            </div>
            <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums tracking-tight">
              ${feed.currentPrice > 0 ? feed.currentPrice.toFixed(2) : '---.--'}
            </div>
          </div>
        </div>

        {/* BOTTOM HUD: 6 CAMERA-FACING LABELS FROM REAL PANELS */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 sm:gap-1.5 pt-1">
          {hudBadges.map((badge) => (
            <div
              key={badge.id}
              className={`flex flex-col items-center justify-center py-1 px-1.5 rounded-md bg-black/60 backdrop-blur-md border ${badge.glow} transition-colors`}
            >
              <span className="text-[7.5px] sm:text-[8px] font-mono uppercase tracking-[0.08em] text-[#8a96a8] truncate max-w-full">
                {badge.label}
              </span>
              <span className={`text-[9px] sm:text-[10px] font-mono font-bold tabular-nums truncate max-w-full ${badge.color}`}>
                {badge.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

QuantumVortex.displayName = 'QuantumVortex';
