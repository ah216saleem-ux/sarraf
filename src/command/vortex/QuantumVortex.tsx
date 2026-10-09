import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import * as THREE from 'three';
import { useCommandFeed } from '../data/useCommandFeed';
import { MarketScanVisualizer, ScanLabelAnchor, DiscAnchor } from './MarketScanVisualizer';
import { WaveformSpectrumPanel } from './WaveformSpectrumPanel';
import { QuantumVortexProps, QuantumVortexHooks, Phase4State } from './types';
import { Activity, Zap } from 'lucide-react';

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

  // LITE Mode (stored in localStorage inside try/catch)
  const [isLite, setIsLite] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const stored = localStorage.getItem('sarraf_market_scan_lite');
      return stored === 'true';
    } catch {
      return false;
    }
  });

  const toggleLite = useCallback(() => {
    setIsLite((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('sarraf_market_scan_lite', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Intro state (2.5s once per tab session)
  const [introActive, setIntroActive] = useState<boolean>(() => {
    if (typeof window === 'undefined' || prefersReducedMotion) return false;
    const played = sessionStorage.getItem('sarraf_market_scan_intro');
    return !played;
  });
  const [introProgress, setIntroProgress] = useState<number>(prefersReducedMotion ? 1.0 : 0.0);

  // Smooth number tweens for HUD BUY FLOW & SELL FLOW
  const [displayBuyRatio, setDisplayBuyRatio] = useState<number>(feed.buyRatio);
  const [displaySellRatio, setDisplaySellRatio] = useState<number>(feed.sellRatio);

  // Flash color state for central live price under sculpture
  const [priceFlash, setPriceFlash] = useState<'UP' | 'DOWN' | 'NONE'>('NONE');
  const prevPriceRef = useRef<number>(feed.currentPrice);

  // Projected 6 scan labels with connector lines and numbers (Requirement 3)
  interface ProjectedScanLabel {
    id: string;
    numId: string;
    label: string;
    value: string;
    color: string;
    glow: string;
    nodeX: number;
    nodeY: number;
    labelX: number;
    labelY: number;
    visible: boolean;
    opacity: number;
  }
  const [projectedLabels, setProjectedLabels] = useState<ProjectedScanLabel[]>([]);

  // Projected S/R and Zone Discs at real price heights
  interface ProjectedDiscLabel {
    id: string;
    label: string;
    price: number;
    x: number;
    y: number;
    visible: boolean;
    color: string;
  }
  const [projectedDiscs, setProjectedDiscs] = useState<ProjectedDiscLabel[]>([]);

  const lastAnchorUpdateTimeRef = useRef<number>(0);
  const feedRef = useRef(feed);
  useEffect(() => {
    feedRef.current = feed;
  }, [feed]);

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
    scan: MarketScanVisualizer;
    animFrameId: number;
    clock: THREE.Clock;
    isDragging: boolean;
    dragStartX: number;
    dragStartY: number;
    rotVelX: number;
    rotVelY: number;
    targetDistance: number;
    currentDistance: number;
    introStartTime: number;
    fpsCounter: number;
    lastFpsCheck: number;
    lowFpsDuration: number;
  } | null>(null);

  // Phase 4 Hook Definitions
  const triggerSignal = useCallback((side: 'BUY' | 'SELL') => {
    setPhase4State((prev) => ({
      ...prev,
      shockwaveActive: true,
      shockwaveTime: performance.now(),
      shockwaveSide: side,
    }));
    threeRef.current?.scan.triggerSignal(side);
  }, []);

  const triggerResult = useCallback((result: 'TP' | 'SL') => {
    setPhase4State((prev) => ({
      ...prev,
      resultActive: true,
      resultTime: performance.now(),
      resultType: result,
    }));
    threeRef.current?.scan.triggerResult(result);
  }, []);

  const setCooldown = useCallback((secondsLeft: number) => {
    setPhase4State((prev) => ({
      ...prev,
      cooldownSeconds: secondsLeft,
    }));
    threeRef.current?.scan.setCooldown(secondsLeft);
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
    sessionStorage.setItem('sarraf_market_scan_intro', 'true');
  };

  // Sync LITE mode to MarketScanVisualizer
  useEffect(() => {
    if (threeRef.current) {
      threeRef.current.scan.setLiteMode(isLite);
    }
  }, [isLite]);

  // Real Tick Pulse: bright scan pulse traveling along tube from newest to oldest
  useEffect(() => {
    if (feed.currentPrice > 0 && prevPriceRef.current > 0 && feed.currentPrice !== prevPriceRef.current) {
      const isUp = feed.currentPrice > prevPriceRef.current || feed.tickDirection === 'BUY';
      setPriceFlash(isUp ? 'UP' : 'DOWN');

      const delta = feed.currentPrice - prevPriceRef.current;
      threeRef.current?.scan.triggerTickPulse({
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

  // Update Price Sculpture with real candles (Requirement 1: real data only)
  useEffect(() => {
    if (threeRef.current && feed.candles.length > 0) {
      const supZone = feed.liquidityZones.find((z) => z.type === 'SUPPORT');
      const resZone = feed.liquidityZones.find((z) => z.type === 'RESISTANCE');
      const supportLevel = supZone?.mid || feed.low24h || 0;
      const resistanceLevel = resZone?.mid || feed.high24h || 0;

      threeRef.current.scan.updateCandles(
        feed.candles,
        feed.currentPrice,
        supportLevel,
        resistanceLevel,
        feed.absorptionBuyZones,
        feed.absorptionSellZones,
        feed.originLevels
      );
    }
  }, [
    feed.candles,
    feed.currentPrice,
    feed.liquidityZones,
    feed.low24h,
    feed.high24h,
    feed.absorptionBuyZones,
    feed.absorptionSellZones,
    feed.originLevels,
  ]);

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
    const height = Math.max(240, (container.clientHeight || 320) - 80);

    const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;
    // Cap DPR to 1.5 as per performance specification
    const maxDpr = Math.min(window.devicePixelRatio || 1, 1.5);

    // 1. Scene & Camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#04060b');

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0.7, 6.2);
    camera.lookAt(0, 0, 0);

    // 2. Renderer with ACESFilmic tone mapping, 0.9 exposure, sRGB encoding
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !isMobile && !isLite,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(maxDpr);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // 3. MARKET SCAN 3D Point-Cloud Visualizer
    const scan = new MarketScanVisualizer(isMobile, isLite);
    scene.add(scan.group);

    // State container
    const clock = new THREE.Clock();
    const inst = {
      scene,
      camera,
      renderer,
      scan,
      animFrameId: 0,
      clock,
      isDragging: false,
      dragStartX: 0,
      dragStartY: 0,
      rotVelX: 0,
      rotVelY: 0,
      targetDistance: 6.2,
      currentDistance: 6.2,
      introStartTime: performance.now(),
      fpsCounter: 0,
      lastFpsCheck: performance.now(),
      lowFpsDuration: 0,
    };
    threeRef.current = inst;

    // Load initial real candles if already available
    if (feed.candles.length > 0) {
      const supZone = feed.liquidityZones.find((z) => z.type === 'SUPPORT');
      const resZone = feed.liquidityZones.find((z) => z.type === 'RESISTANCE');
      const supportLevel = supZone?.mid || feed.low24h || 0;
      const resistanceLevel = resZone?.mid || feed.high24h || 0;

      scan.updateCandles(
        feed.candles,
        feed.currentPrice,
        supportLevel,
        resistanceLevel,
        feed.absorptionBuyZones,
        feed.absorptionSellZones,
        feed.originLevels
      );
    }

    // 4. Mouse & Touch Interaction (drag-to-rotate with inertia, pinch/scroll zoom limited)
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
      inst.targetDistance = Math.max(4.6, Math.min(8.0, inst.targetDistance + e.deltaY * 0.0035));
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
        inst.targetDistance = Math.max(4.6, Math.min(8.0, inst.targetDistance + diff * 0.01));
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

    // 5. Resize Observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = Math.max(200, entry.contentRect.height - 80);
        if (w > 0 && h > 0) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      }
    });
    resizeObserver.observe(container);

    // 6. Intersection Observer (pause rendering when off-screen)
    let isIntersecting = true;
    const intersectionObserver = new IntersectionObserver((entries) => {
      isIntersecting = entries[0].isIntersecting;
    });
    intersectionObserver.observe(container);

    // 7. Animation Render Loop
    let introDone = prefersReducedMotion;
    const renderLoop = () => {
      inst.animFrameId = requestAnimationFrame(renderLoop);

      // Skip render if tab hidden or off-screen
      if (document.visibilityState === 'hidden' || !isIntersecting) {
        return;
      }

      const delta = Math.min(clock.getDelta(), 0.1);

      // Auto-enable LITE if frame rate stays under 30fps for 3 seconds
      inst.fpsCounter++;
      const nowTime = performance.now();
      if (nowTime - inst.lastFpsCheck >= 1000) {
        const fps = (inst.fpsCounter * 1000) / (nowTime - inst.lastFpsCheck);
        inst.fpsCounter = 0;
        inst.lastFpsCheck = nowTime;
        if (fps < 30) {
          inst.lowFpsDuration += 1;
          if (inst.lowFpsDuration >= 3 && !isLite) {
            setIsLite(true);
            try {
              localStorage.setItem('sarraf_market_scan_lite', 'true');
            } catch {
              // ignore
            }
          }
        } else {
          inst.lowFpsDuration = 0;
        }
      }

      // Intro progress calculation (2.5 seconds, tap to skip)
      let curIntro = 1.0;
      if (!introDone) {
        const elapsedIntro = (performance.now() - inst.introStartTime) / 2500;
        curIntro = Math.min(1.0, elapsedIntro);
        setIntroProgress(curIntro);
        if (curIntro >= 1.0) {
          introDone = true;
          setIntroActive(false);
          sessionStorage.setItem('sarraf_market_scan_intro', 'true');
        }
      }

      // Smooth camera zoom
      inst.currentDistance += (inst.targetDistance - inst.currentDistance) * 0.08;
      camera.position.z = inst.currentDistance;

      // Apply drag rotation with inertia (slow auto-rotation when not dragging)
      if (!inst.isDragging) {
        inst.rotVelY += prefersReducedMotion ? 0.0001 : 0.00032;
      }
      scene.rotation.y += inst.rotVelY;
      scene.rotation.x = Math.max(-0.55, Math.min(0.55, scene.rotation.x + inst.rotVelX));
      inst.rotVelX *= 0.92;
      inst.rotVelY *= 0.92;

      // Update Visualizer (tint lerp, shader uniforms, dust, rings, flashes)
      const liveBuyRatio = feedRef.current.buyRatio;
      scan.update(delta, curIntro, phase4State, liveBuyRatio);

      renderer.render(scene, camera);

      // Project the 6 Scan Label Anchors (Requirement 3: numbered labels with connector lines)
      if (nowTime - lastAnchorUpdateTimeRef.current > 32) {
        lastAnchorUpdateTimeRef.current = nowTime;
        const w = container.clientWidth || 360;
        const h = Math.max(200, (container.clientHeight || 320) - 80);
        const rawAnchors = scan.getLabelAnchors();

        // 6 Scan Readouts from real live feed
        const readouts: Record<string, { val: string; col: string; glow: string }> = {
          momentum: {
            val: feedRef.current.confidence.momentum > 0
              ? `${feedRef.current.confidence.momentum}%`
              : (feedRef.current.regime.trend !== 'N/A' ? feedRef.current.regime.trend : 'COLLECTING'),
            col: feedRef.current.confidence.momentum >= 55
              ? 'text-[#22e08a]'
              : feedRef.current.confidence.momentum <= 45
              ? 'text-[#ff3b6b]'
              : 'text-[#f5c451]',
            glow: feedRef.current.confidence.momentum >= 55
              ? 'border-[#22e08a]/40 shadow-[0_0_10px_rgba(34,224,138,0.2)]'
              : feedRef.current.confidence.momentum <= 45
              ? 'border-[#ff3b6b]/40 shadow-[0_0_10px_rgba(255,59,107,0.2)]'
              : 'border-[#f5c451]/40 shadow-[0_0_10px_rgba(245,196,81,0.2)]',
          },
          sentiment: {
            val: feedRef.current.buyRatio >= 54 ? 'BULLISH' : feedRef.current.buyRatio <= 46 ? 'BEARISH' : 'NEUTRAL',
            col: feedRef.current.buyRatio >= 54
              ? 'text-[#22e08a]'
              : feedRef.current.buyRatio <= 46
              ? 'text-[#ff3b6b]'
              : 'text-[#f5c451]',
            glow: feedRef.current.buyRatio >= 54
              ? 'border-[#22e08a]/40 shadow-[0_0_10px_rgba(34,224,138,0.2)]'
              : feedRef.current.buyRatio <= 46
              ? 'border-[#ff3b6b]/40 shadow-[0_0_10px_rgba(255,59,107,0.2)]'
              : 'border-[#f5c451]/40 shadow-[0_0_10px_rgba(245,196,81,0.2)]',
          },
          poc: {
            val: feedRef.current.originLevels[0]?.priceLevel
              ? `$${feedRef.current.originLevels[0].priceLevel.toFixed(1)}`
              : 'N/A',
            col: 'text-[#38bdf8]',
            glow: 'border-[#38bdf8]/40 shadow-[0_0_10px_rgba(56,189,248,0.2)]',
          },
          absorption: {
            val: (feedRef.current.absorptionBuyZones.length + feedRef.current.absorptionSellZones.length > 0)
              ? `${feedRef.current.absorptionBuyZones.length + feedRef.current.absorptionSellZones.length} ZONES`
              : 'ACTIVE',
            col: 'text-[#e8edf5]',
            glow: 'border-white/20',
          },
          tickdata: {
            val: feedRef.current.spread > 0
              ? `$${feedRef.current.spread.toFixed(2)} SPD`
              : `${feedRef.current.buyTicks60s + feedRef.current.sellTicks60s} T/M`,
            col: feedRef.current.spread <= 0.35 ? 'text-[#22e08a]' : 'text-[#f5c451]',
            glow: feedRef.current.spread <= 0.35
              ? 'border-[#22e08a]/40 shadow-[0_0_10px_rgba(34,224,138,0.2)]'
              : 'border-[#f5c451]/40 shadow-[0_0_10px_rgba(245,196,81,0.2)]',
          },
          fvg: {
            val: feedRef.current.nearestFvgOrOb || 'N/A',
            col: feedRef.current.nearestFvgOrOb ? 'text-[#f5c451]' : 'text-[#8a96a8]',
            glow: 'border-white/20',
          },
        };

        const projected = rawAnchors.map((a, idx) => {
          const toCam = camera.position.clone().sub(a.worldPos).normalize();
          const dot = a.normal.dot(toCam);
          const isFacing = dot > 0.05;

          const p = a.worldPos.clone().project(camera);
          const nodeX = (p.x * 0.5 + 0.5) * w;
          const nodeY = (-p.y * 0.5 + 0.5) * h;

          const isLeft = a.worldPos.x < 0;
          const isTop = a.worldPos.y > 0;
          const offsetX = isLeft ? -46 : 46;
          const offsetY = isTop ? -18 : 18;
          const labelX = Math.max(50, Math.min(w - 50, nodeX + offsetX));
          const labelY = Math.max(34, Math.min(h - 34, nodeY + offsetY));

          const readout = readouts[a.id] || { val: 'N/A', col: 'text-white', glow: 'border-white/10' };

          // Fade labels in one-by-one during intro
          const staggerStart = 0.3 + (idx / 6) * 0.5;
          const introFade = Math.min(1.0, Math.max(0.0, (curIntro - staggerStart) / 0.2));

          return {
            id: a.id,
            numId: a.numId,
            label: a.label,
            value: readout.val,
            color: readout.col,
            glow: readout.glow,
            nodeX,
            nodeY,
            labelX,
            labelY,
            visible: isFacing && p.z < 1.0 && introFade > 0.05,
            opacity: Math.max(0, Math.min(1, (dot - 0.05) * 3.5)) * introFade,
          };
        });

        setProjectedLabels(projected);

        // Project Discs
        const rawDiscs = scan.getDiscAnchors();
        const discProj = rawDiscs.map((d) => {
          const p = d.worldPos.clone().project(camera);
          const x = (p.x * 0.5 + 0.5) * w;
          const y = (-p.y * 0.5 + 0.5) * h;
          return {
            id: d.id,
            label: d.label,
            price: d.price,
            x: Math.max(40, Math.min(w - 40, x)),
            y: Math.max(20, Math.min(h - 20, y)),
            visible: p.z < 1.0 && p.z > -1.0,
            color: d.color,
          };
        });
        setProjectedDiscs(discProj);
      }
    };

    renderLoop();

    // 8. Cleanup on Unmount (dispose everything)
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

      scan.dispose();
      renderer.dispose();
      threeRef.current = null;
    };
  }, [prefersReducedMotion, isLite]);

  const isDisconnected = feed.connection.status === 'RECONNECTING' || feed.connection.status === 'OFFLINE';
  const hasCandleData = feed.candles.length >= 2;

  // Fallback banner if WebGL fails (Requirement 7)
  if (!webglAvailable) {
    return (
      <div className={`relative rounded-xl bg-[#070b14] border border-[#f5c451]/30 p-4 font-mono text-[#e8edf5] ${className}`}>
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] text-[#8a96a8] uppercase">BUY FLOW %</span>
            <span className="text-xl font-bold text-[#22e08a]">{displayBuyRatio.toFixed(1)}%</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-[#f5c451] uppercase tracking-wider">MARKET SCAN 3D</span>
            <span className="text-2xl font-bold text-white">${feed.currentPrice.toFixed(2)}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-[#8a96a8] uppercase">SELL FLOW %</span>
            <span className="text-xl font-bold text-[#ff3b6b]">{displaySellRatio.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full rounded-xl overflow-hidden bg-[#04060b] border border-[#f5c451]/25 select-none flex flex-col ${className}`}
    >
      {/* 3D WebGL Canvas Area */}
      <div className="relative w-full h-[220px] sm:h-[250px] overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-full block cursor-grab active:cursor-grabbing touch-none"
        />

        {/* Not enough candle data prompt (Requirement 1: show only dust and text "collecting data", never fake candles) */}
        {!hasCandleData && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 bg-black/40">
            <div className="px-3 py-1.5 rounded-lg bg-black/80 border border-[#f5c451]/30 text-xs font-mono text-[#f5c451] flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#f5c451] animate-ping" />
              <span className="tracking-wider uppercase">COLLECTING DATA...</span>
            </div>
          </div>
        )}

        {/* SVG Layer: Ring markers, thin connector lines, and subtle network lines (Requirement 3) */}
        <svg className="absolute inset-0 pointer-events-none w-full h-full z-20">
          {/* Faint network lines between anchors */}
          {projectedLabels.length >= 2 && (
            <g opacity={0.2}>
              {projectedLabels.slice(0, -1).map((a, i) => {
                const next = projectedLabels[i + 1];
                if (!a.visible || !next.visible) return null;
                return (
                  <line
                    key={`net-${a.id}-${next.id}`}
                    x1={a.nodeX}
                    y1={a.nodeY}
                    x2={next.nodeX}
                    y2={next.nodeY}
                    stroke="#f5c451"
                    strokeWidth={0.8}
                    strokeDasharray="2,3"
                  />
                );
              })}
            </g>
          )}

          {/* Individual connector lines and ring markers */}
          {projectedLabels.map((a) => {
            if (!a.visible || a.opacity <= 0.05) return null;
            return (
              <g key={`marker-${a.id}`} opacity={a.opacity} className="transition-opacity duration-150">
                {/* Thin connector line to label */}
                <line
                  x1={a.nodeX}
                  y1={a.nodeY}
                  x2={a.labelX}
                  y2={a.labelY}
                  stroke="#f5c451"
                  strokeWidth={1}
                  strokeDasharray="2,2"
                  opacity={0.65}
                />
                {/* Small ring marker anchored to real 3D point */}
                <circle cx={a.nodeX} cy={a.nodeY} r={3.2} stroke="#f5c451" strokeWidth={1.4} fill="#04060b" />
                <circle cx={a.nodeX} cy={a.nodeY} r={1.2} fill="#f5c451" />
              </g>
            );
          })}
        </svg>

        {/* 6 Camera-Facing Anchored Labels (Requirement 3: Numbered tracking labels with connector lines) */}
        {projectedLabels.map((a) => {
          return (
            <div
              key={`label-${a.id}`}
              style={{
                left: `${a.labelX}px`,
                top: `${a.labelY}px`,
                opacity: a.visible ? a.opacity : 0,
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }}
              className={`absolute z-20 flex flex-col items-center justify-center py-0.5 px-1.5 rounded bg-black/85 backdrop-blur-md border ${a.glow} transition-opacity duration-150 select-none shadow-[0_2px_10px_rgba(0,0,0,0.8)]`}
            >
              <div className="flex items-center gap-1">
                <span className="text-[6.5px] font-mono text-[#f5c451]/80 font-bold">
                  [{a.numId}]
                </span>
                <span className="text-[7px] font-mono uppercase tracking-[0.08em] text-[#8a96a8] truncate max-w-[80px]">
                  {a.label}
                </span>
              </div>
              <span className={`text-[8.5px] sm:text-[9px] font-mono font-bold tabular-nums truncate max-w-[85px] ${a.color}`}>
                {a.value}
              </span>
            </div>
          );
        })}

        {/* Translucent S/R & Demand/Supply Disc Price Tags (Requirement 1) */}
        {projectedDiscs.map((d) => {
          if (!d.visible) return null;
          return (
            <div
              key={`disc-${d.id}`}
              style={{
                left: `${d.x}px`,
                top: `${d.y}px`,
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }}
              className="absolute z-15 px-1.5 py-0.5 rounded text-[7.5px] font-mono font-bold backdrop-blur-sm bg-black/60 border border-white/10 select-none"
            >
              <span style={{ color: d.color }}>{d.label}</span>
            </div>
          );
        })}

        {/* Reconnecting Dimming Overlay (Requirement 5) */}
        {isDisconnected && (
          <div className="absolute inset-0 bg-[#04060b]/80 backdrop-blur-[2px] z-30 flex items-center justify-center p-4 pointer-events-none">
            <div className="px-3.5 py-1.5 rounded-full bg-[#ff3b6b]/20 border border-[#ff3b6b]/50 text-[#ff3b6b] flex items-center gap-2 text-xs font-mono font-bold animate-pulse shadow-[0_0_20px_rgba(255,59,107,0.3)]">
              <span className="w-2 h-2 rounded-full bg-[#ff3b6b] animate-ping" />
              <span>RECONNECTING · NO STALE DATA</span>
            </div>
          </div>
        )}

        {/* Intro Overlay (2.5s once per tab session with Tap to Skip, Requirement 5) */}
        {introActive && (
          <div
            onClick={handleSkipIntro}
            className="absolute inset-0 z-40 bg-[#04060b]/92 backdrop-blur-sm flex flex-col items-center justify-center p-4 cursor-pointer transition-opacity duration-300"
          >
            <div className="flex flex-col items-center space-y-2 text-center pointer-events-auto">
              <div className="w-8 h-8 rounded-full bg-[#38bdf8]/20 border border-[#38bdf8]/60 flex items-center justify-center text-[#38bdf8] animate-pulse shadow-[0_0_20px_rgba(56,189,248,0.4)]">
                <Activity className="w-4 h-4 text-[#38bdf8]" />
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] font-mono tracking-[0.16em] uppercase text-[#f5c451] font-bold">
                  MARKET SCAN 3D INITIALIZING
                </span>
                <div className="text-xs font-mono text-[#8a96a8]">
                  Tap anywhere to skip
                </div>
              </div>
              <div className="w-36 h-1 bg-white/10 rounded-full overflow-hidden mt-1">
                <div
                  className="h-full bg-gradient-to-r from-[#22e08a] via-[#f5c451] to-[#ff3b6b] transition-all duration-75"
                  style={{ width: `${Math.round(introProgress * 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* TOP HUD BAR: BUY FLOW (Left), Title & LITE switch (Center), SELL FLOW (Right) (Requirement 6 & 7) */}
        <div className="absolute top-2 left-2 right-2 flex items-start justify-between pointer-events-none z-25">
          {/* Left: BUY FLOW % */}
          <div className="flex flex-col items-start bg-black/55 backdrop-blur-md px-2 py-1 rounded border border-[#22e08a]/25 shadow-[0_2px_10px_rgba(34,224,138,0.1)]">
            <span className="text-[8.5px] uppercase tracking-[0.1em] font-mono text-[#8a96a8]">
              BUY FLOW (60S)
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-base sm:text-lg font-bold font-mono tabular-nums text-[#22e08a]">
                {displayBuyRatio.toFixed(1)}%
              </span>
              <span className="text-[8px] font-mono text-[#22e08a]/70">EST.</span>
            </div>
          </div>

          {/* Center-Top: Title + LITE switch */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-[#f5c451]/30">
              <span className="w-1.5 h-1.5 rounded-full bg-[#f5c451] animate-pulse" />
              <span className="text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-[#f5c451]">
                MARKET SCAN
              </span>
            </div>

            {/* LITE Mode Switch (Requirement 7) */}
            <button
              type="button"
              onClick={toggleLite}
              className={`pointer-events-auto px-2 py-0.5 rounded text-[8px] font-mono font-bold transition-all border ${
                isLite
                  ? 'bg-[#38bdf8]/20 border-[#38bdf8] text-[#38bdf8] shadow-[0_0_8px_rgba(56,189,248,0.3)]'
                  : 'bg-black/40 border-white/15 text-[#8a96a8] hover:text-white'
              }`}
              title="Toggle Lite Mode (8,000 points, turns off glitch & dust)"
            >
              <Zap className="w-2.5 h-2.5 inline mr-0.5" />
              LITE {isLite ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Right: SELL FLOW % */}
          <div className="flex flex-col items-end text-right bg-black/55 backdrop-blur-md px-2 py-1 rounded border border-[#ff3b6b]/25 shadow-[0_2px_10px_rgba(255,59,107,0.1)]">
            <span className="text-[8.5px] uppercase tracking-[0.1em] font-mono text-[#8a96a8]">
              SELL FLOW (60S)
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-[8px] font-mono text-[#ff3b6b]/70">EST.</span>
              <span className="text-base sm:text-lg font-bold font-mono tabular-nums text-[#ff3b6b]">
                {displaySellRatio.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* Live Price Tag under sculpture */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 pointer-events-none z-25">
          <div
            className={`px-2.5 py-0.5 rounded backdrop-blur-md border transition-all duration-200 ${
              priceFlash === 'UP'
                ? 'bg-[#22e08a]/20 border-[#22e08a] text-[#22e08a] shadow-[0_0_15px_rgba(34,224,138,0.5)] scale-105'
                : priceFlash === 'DOWN'
                ? 'bg-[#ff3b6b]/20 border-[#ff3b6b] text-[#ff3b6b] shadow-[0_0_15px_rgba(255,59,107,0.5)] scale-105'
                : 'bg-black/60 border-white/15 text-[#e8edf5]'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] font-mono tracking-wider text-[#8a96a8] uppercase">
                XAU/USD
              </span>
              <span className="w-1 h-1 rounded-full bg-[#f5c451]" />
              <span className="text-sm font-bold font-mono tabular-nums">
                ${feed.currentPrice > 0 ? feed.currentPrice.toFixed(2) : '---.--'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM PANEL: Spectrum + Waveform readout (Requirement 4) */}
      <WaveformSpectrumPanel
        currentPrice={feed.currentPrice}
        spread={feed.spread}
        buyTicks60s={feed.buyTicks60s}
        sellTicks60s={feed.sellTicks60s}
        change24h={feed.change24h}
        tickTape={feed.tickTape}
        tickDirection={feed.tickDirection}
      />
    </div>
  );
});

QuantumVortex.displayName = 'QuantumVortex';
