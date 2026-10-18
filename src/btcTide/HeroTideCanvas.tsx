import React, { useRef, useEffect, useState, useMemo } from 'react';
import {
  SecondBin,
  BtcFeedStatus,
  HeroSceneMode,
  HeroFxLevel,
  ActiveTideSignal,
  AggTrade,
  LiquidationItem,
} from './types';
import {
  subscribeLiveTrades,
  subscribeLiveLiquidations,
  buildContinuousSecondSeries,
  detectWaveformEvents,
} from './useBtcTideStore';
import { Waves, Orbit, Sparkles, ShieldAlert, Clock } from 'lucide-react';

interface HeroTideCanvasProps {
  currentPrice: number | null;
  status: BtcFeedStatus;
  messageAgeMs: number;
  secondBins: SecondBin[];
  activeSignal: ActiveTideSignal | null;
}

interface TradeParticle {
  id: string;
  side: 'BUY' | 'SELL';
  price: number;
  qty: number;
  usdValue: number;
  radius: number;
  progress: number; // 0 (at camp) -> 1 (at knot / orb)
  speed: number;
  yOffsetNorm: number; // deterministic [-0.36, 0.36] from trade id
  angleOffset: number;
}

interface LargePrintEffect {
  id: string;
  side: 'BUY' | 'SELL';
  price: number;
  usdValue: number;
  createdAt: number;
  durationMs: number;
}

interface SparkParticle {
  id: string;
  side: 'BUY' | 'SELL';
  angle: number;
  speed: number;
  progress: number;
  usdValue: number;
}

interface DriveComet {
  id: string;
  side: 'BUY' | 'SELL';
  progress: number;
  yOffsetNorm: number;
  netVolBtc: number;
}

interface AbsorbShockwave {
  id: string;
  side: 'BUY' | 'SELL';
  createdAt: number;
  durationMs: number;
  netVolBtc: number;
}

/**
 * Pure deterministic hash from a string (e.g. real trade ID) to [0, 1].
 * Never uses Math.random().
 */
function deterministicUnit(str: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function formatUsdShort(val: number): string {
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

export const HeroTideCanvas: React.FC<HeroTideCanvasProps> = React.memo(
  ({ currentPrice, status, messageAgeMs, secondBins, activeSignal }) => {
    const [sceneMode, setSceneMode] = useState<HeroSceneMode>('TUG_OF_WAR');
    const [fxLevel, setFxLevel] = useState<HeroFxLevel>('HIGH');
    const [reducedMotion, setReducedMotion] = useState<boolean>(false);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // Live mutable refs for the requestAnimationFrame loop
    const stateRef = useRef({
      currentPrice,
      status,
      secondBins,
      activeSignal,
      sceneMode,
      fxLevel,
      reducedMotion,
    });

    useEffect(() => {
      stateRef.current = {
        currentPrice,
        status,
        secondBins,
        activeSignal,
        sceneMode,
        fxLevel,
        reducedMotion,
      };
    }, [currentPrice, status, secondBins, activeSignal, sceneMode, fxLevel, reducedMotion]);

    // Respect prefers-reduced-motion
    useEffect(() => {
      if (typeof window === 'undefined' || !window.matchMedia) return;
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReducedMotion(mq.matches);
      const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }, []);

    // Live particle & FX buffers driven strictly by real exchange events
    const particlesRef = useRef<TradeParticle[]>([]);
    const largePrintsRef = useRef<LargePrintEffect[]>([]);
    const sparksRef = useRef<SparkParticle[]>([]);
    const cometsRef = useRef<DriveComet[]>([]);
    const shockwavesRef = useRef<AbsorbShockwave[]>([]);
    const seenEventSecsRef = useRef<Set<string>>(new Set());

    // Smoothed price & knot coordinates
    const animStateRef = useRef({
      smoothedPrice: null as number | null,
      smoothedMin2m: null as number | null,
      smoothedMax2m: null as number | null,
      smoothedBuy10s: 0,
      smoothedSell10s: 0,
      wavePhase: 0,
      knotPulse: 0,
      lastFrameTime: 0,
    });

    // Subscribe to real-time live aggTrades
    useEffect(() => {
      const unsubTrades = subscribeLiveTrades((trade: AggTrade) => {
        const { fxLevel: fx, reducedMotion: rm, status: st } = stateRef.current;
        if (st === 'OFFLINE' || st === 'STALE') return;

        // Impulse on knot
        animStateRef.current.knotPulse = Math.min(
          1,
          animStateRef.current.knotPulse + Math.min(0.45, Math.log10(Math.max(trade.usdValue, 50)) * 0.08)
        );

        // Large Print >= $50K ring & floating label
        if (trade.usdValue >= 50000) {
          largePrintsRef.current.push({
            id: `lp_${trade.id}`,
            side: trade.aggressorSide,
            price: trade.price,
            usdValue: trade.usdValue,
            createdAt: performance.now(),
            durationMs: 3600,
          });
          if (largePrintsRef.current.length > 8) {
            largePrintsRef.current.shift();
          }
        }

        if (fx === 'OFF' || rm) return;

        const maxParticles = fx === 'HIGH' ? 90 : 32;
        if (particlesRef.current.length >= maxParticles) {
          // In LITE mode or high load, prioritize larger trades
          if (fx === 'LITE' && trade.usdValue < 500) return;
          particlesRef.current.shift();
        }

        const u1 = deterministicUnit(trade.id, 1);
        const u2 = deterministicUnit(trade.id, 2);
        // Bigger trade = bigger particle (strictly scaled from real USD notional)
        const logUsd = Math.log10(Math.max(trade.usdValue, 20));
        const radius = Math.max(2.0, Math.min(13.5, (logUsd - 1.1) * 2.5));
        const speed = 0.65 + Math.min(0.85, logUsd * 0.14);

        particlesRef.current.push({
          id: trade.id,
          side: trade.aggressorSide,
          price: trade.price,
          qty: trade.qty,
          usdValue: trade.usdValue,
          radius,
          progress: 0,
          speed,
          yOffsetNorm: (u1 - 0.5) * 0.68,
          angleOffset: (u2 - 0.5) * 1.4,
        });
      });

      const unsubLiqs = subscribeLiveLiquidations((liq: LiquidationItem) => {
        const { fxLevel: fx, reducedMotion: rm, status: st } = stateRef.current;
        if (st === 'OFFLINE' || st === 'STALE' || fx === 'OFF' || rm) return;

        const sparkCount = fx === 'HIGH' ? 14 : 6;
        for (let i = 0; i < sparkCount; i++) {
          const angle = (Math.PI * 2 * i) / sparkCount + deterministicUnit(liq.id, i) * 0.35;
          const speed = 1.1 + deterministicUnit(liq.id, i + 50) * 1.2;
          sparksRef.current.push({
            id: `${liq.id}_s_${i}`,
            side: liq.side, // SELL = long liq, BUY = short liq
            angle,
            speed,
            progress: 0,
            usdValue: liq.usdValue,
          });
        }
        if (sparksRef.current.length > 60) {
          sparksRef.current.splice(0, sparksRef.current.length - 60);
        }
      });

      return () => {
        unsubTrades();
        unsubLiqs();
      };
    }, []);

    // Detect real ABSORB & DRIVE waveform events and trigger golden walls / shockwaves / comets
    const recentWaveformEvents = useMemo(() => {
      if (secondBins.length < 7) return [];
      const continuous = buildContinuousSecondSeries(secondBins, 180);
      const { events } = detectWaveformEvents(continuous);
      return events;
    }, [secondBins]);

    useEffect(() => {
      if (recentWaveformEvents.length === 0 || status !== 'LIVE') return;
      const latestSec = secondBins.length > 0 ? secondBins[secondBins.length - 1].sec : 0;

      for (const ev of recentWaveformEvents) {
        const key = `${ev.type}_${ev.side}_${ev.sec}`;
        if (seenEventSecsRef.current.has(key)) continue;
        seenEventSecsRef.current.add(key);

        // Only trigger visual FX for fresh events within the last 12 seconds
        if (latestSec - ev.sec <= 12) {
          if (ev.type === 'DRIVE') {
            const count = fxLevel === 'HIGH' ? 3 : 1;
            for (let i = 0; i < count; i++) {
              cometsRef.current.push({
                id: `${key}_c_${i}`,
                side: ev.side,
                progress: i * -0.18,
                yOffsetNorm: (i - 1) * 0.22,
                netVolBtc: ev.netVolBtc,
              });
            }
          } else if (ev.type === 'ABSORB') {
            shockwavesRef.current.push({
              id: `${key}_sw`,
              side: ev.side,
              createdAt: performance.now(),
              durationMs: 2800,
              netVolBtc: ev.netVolBtc,
            });
          }
        }
      }
    }, [recentWaveformEvents, secondBins, status, fxLevel]);

    // Compute HUD metrics strictly from real last-60s secondBins
    const hudStats = useMemo(() => {
      if (secondBins.length === 0) {
        return {
          buyPct: null as number | null,
          sellPct: null as number | null,
          tradesPerMin: 0,
          buy10sBtc: 0,
          sell10sBtc: 0,
          cvd3mBtc: 0,
        };
      }
      const latestSec = secondBins[secondBins.length - 1].sec;
      const start60s = latestSec - 59;
      const start10s = latestSec - 9;
      const start180s = latestSec - 179;

      let buy60 = 0;
      let sell60 = 0;
      let trades60 = 0;
      let buy10 = 0;
      let sell10 = 0;
      let cvd3m = 0;

      for (let i = secondBins.length - 1; i >= 0; i--) {
        const b = secondBins[i];
        if (b.sec < start180s) break;
        cvd3m += b.buyVol - b.sellVol;
        if (b.sec >= start60s) {
          buy60 += b.buyVol;
          sell60 += b.sellVol;
          trades60 += b.count;
        }
        if (b.sec >= start10s) {
          buy10 += b.buyVol;
          sell10 += b.sellVol;
        }
      }

      const total60 = buy60 + sell60;
      const buyPct = total60 > 0 ? Math.round((buy60 / total60) * 100) : null;
      const sellPct = buyPct !== null ? 100 - buyPct : null;

      return {
        buyPct,
        sellPct,
        tradesPerMin: trades60,
        buy10sBtc: buy10,
        sell10sBtc: sell10,
        cvd3mBtc: cvd3m,
      };
    }, [secondBins]);

    // Main High-DPI Canvas Render Loop
    useEffect(() => {
      let rafId: number | null = null;

      const renderFrame = (nowMs: number) => {
        // Pause all animation when tab is hidden
        if (typeof document !== 'undefined' && document.hidden) {
          animStateRef.current.lastFrameTime = nowMs;
          rafId = requestAnimationFrame(renderFrame);
          return;
        }

        const dt = animStateRef.current.lastFrameTime
          ? Math.min(0.06, (nowMs - animStateRef.current.lastFrameTime) / 1000)
          : 0.016;
        animStateRef.current.lastFrameTime = nowMs;

        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
          rafId = requestAnimationFrame(renderFrame);
          return;
        }

        const dpr = window.devicePixelRatio || 1;
        const rect = container.getBoundingClientRect();
        const width = Math.max(300, Math.floor(rect.width));
        const height = Math.max(250, Math.floor(rect.height));

        if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
          canvas.width = width * dpr;
          canvas.height = height * dpr;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          rafId = requestAnimationFrame(renderFrame);
          return;
        }

        ctx.save();
        ctx.scale(dpr, dpr);

        const {
          currentPrice: livePrice,
          status: feedStatus,
          secondBins: bins,
          activeSignal: sig,
          sceneMode: mode,
          fxLevel: fx,
          reducedMotion: rm,
        } = stateRef.current;

        const isAnimated = fx !== 'OFF' && !rm && feedStatus === 'LIVE';
        const isOfflineOrStale = feedStatus === 'OFFLINE' || feedStatus === 'STALE';

        // Background
        const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
        bgGrad.addColorStop(0, '#060709');
        bgGrad.addColorStop(0.5, '#090b10');
        bgGrad.addColorStop(1, '#050608');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        // Subtle tactical grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
        ctx.lineWidth = 1;
        const gridStep = 48;
        for (let gx = gridStep; gx < width; gx += gridStep) {
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, height);
          ctx.stroke();
        }
        for (let gy = gridStep; gy < height; gy += gridStep) {
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.lineTo(width, gy);
          ctx.stroke();
        }

        // If no real data has arrived yet -> No boot animation with fake data
        if (bins.length === 0 || livePrice === null) {
          ctx.restore();
          rafId = requestAnimationFrame(renderFrame);
          return;
        }

        // Compute real 2-minute (120s) price bounds and 10s buy/sell volume
        const latestSec = bins[bins.length - 1].sec;
        const start2m = latestSec - 119;
        const start10s = latestSec - 9;

        let rawMin2m = livePrice;
        let rawMax2m = livePrice;
        let buy10s = 0;
        let sell10s = 0;

        for (let i = bins.length - 1; i >= 0; i--) {
          const b = bins[i];
          if (b.sec < start2m) break;
          if (b.lowPrice < rawMin2m) rawMin2m = b.lowPrice;
          if (b.highPrice > rawMax2m) rawMax2m = b.highPrice;
          if (b.sec >= start10s) {
            buy10s += b.buyVol;
            sell10s += b.sellVol;
          }
        }

        // Expand range slightly if activeSignal has SL/TP so vertical lines fit comfortably
        if (sig) {
          rawMin2m = Math.min(rawMin2m, sig.slPrice, sig.tpPrice);
          rawMax2m = Math.max(rawMax2m, sig.slPrice, sig.tpPrice);
        }

        const minSpan = Math.max(rawMax2m - rawMin2m, 8);
        const targetMin = rawMin2m - minSpan * 0.12;
        const targetMax = rawMax2m + minSpan * 0.12;

        const anim = animStateRef.current;
        const lerpRate = isAnimated ? Math.min(1, dt * 7.5) : 1;

        anim.smoothedPrice =
          anim.smoothedPrice === null
            ? livePrice
            : anim.smoothedPrice + (livePrice - anim.smoothedPrice) * lerpRate;
        anim.smoothedMin2m =
          anim.smoothedMin2m === null
            ? targetMin
            : anim.smoothedMin2m + (targetMin - anim.smoothedMin2m) * lerpRate;
        anim.smoothedMax2m =
          anim.smoothedMax2m === null
            ? targetMax
            : anim.smoothedMax2m + (targetMax - anim.smoothedMax2m) * lerpRate;

        anim.smoothedBuy10s += (buy10s - anim.smoothedBuy10s) * lerpRate;
        anim.smoothedSell10s += (sell10s - anim.smoothedSell10s) * lerpRate;

        if (isAnimated) {
          anim.wavePhase += dt * 3.2;
          anim.knotPulse = Math.max(0, anim.knotPulse - dt * 1.8);
        }

        // Advance active particles, sparks, comets, and prune expired FX
        if (isAnimated) {
          for (let i = particlesRef.current.length - 1; i >= 0; i--) {
            const p = particlesRef.current[i];
            p.progress += dt * p.speed;
            if (p.progress >= 1) {
              particlesRef.current.splice(i, 1);
            }
          }
          for (let i = sparksRef.current.length - 1; i >= 0; i--) {
            const s = sparksRef.current[i];
            s.progress += dt * s.speed;
            if (s.progress >= 1) {
              sparksRef.current.splice(i, 1);
            }
          }
          for (let i = cometsRef.current.length - 1; i >= 0; i--) {
            const c = cometsRef.current[i];
            c.progress += dt * 0.85;
            if (c.progress >= 1) {
              cometsRef.current.splice(i, 1);
            }
          }
        }

        largePrintsRef.current = largePrintsRef.current.filter(
          (lp) => nowMs - lp.createdAt < lp.durationMs
        );
        shockwavesRef.current = shockwavesRef.current.filter(
          (sw) => nowMs - sw.createdAt < sw.durationMs
        );

        const priceSpan = Math.max(0.01, anim.smoothedMax2m - anim.smoothedMin2m);
        const padX = Math.max(44, width * 0.08);
        const usableW = width - padX * 2;

        const priceToX = (p: number) => {
          const norm = (p - anim.smoothedMin2m!) / priceSpan;
          return Math.max(padX * 0.5, Math.min(width - padX * 0.5, padX + norm * usableW));
        };

        // =====================================================================
        // SCENE 1: TUG-OF-WAR TIDE (DEFAULT)
        // =====================================================================
        if (mode === 'TUG_OF_WAR') {
          const centerY = height * 0.54;
          const knotX = priceToX(anim.smoothedPrice);

          // 1. Active Signal SL and TP Vertical Lines with Profit & Loss Zones
          if (sig && feedStatus === 'LIVE') {
            const entryX = priceToX(sig.entryPrice);
            const slX = priceToX(sig.slPrice);
            const tpX = priceToX(sig.tpPrice);

            // Profit Zone (between Entry and TP)
            const profitLeft = Math.min(entryX, tpX);
            const profitW = Math.abs(tpX - entryX);
            ctx.fillStyle = 'rgba(20, 184, 166, 0.08)';
            ctx.fillRect(profitLeft, 44, profitW, height - 74);

            // Loss Zone (between Entry and SL)
            const lossLeft = Math.min(entryX, slX);
            const lossW = Math.abs(slX - entryX);
            ctx.fillStyle = 'rgba(244, 63, 94, 0.08)';
            ctx.fillRect(lossLeft, 44, lossW, height - 74);

            // Entry vertical line
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(232, 184, 74, 0.65)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(entryX, 44);
            ctx.lineTo(entryX, height - 30);
            ctx.stroke();

            // SL vertical line
            ctx.strokeStyle = 'rgba(244, 63, 94, 0.85)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(slX, 44);
            ctx.lineTo(slX, height - 30);
            ctx.stroke();

            // TP vertical line
            ctx.strokeStyle = 'rgba(20, 184, 166, 0.9)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(tpX, 44);
            ctx.lineTo(tpX, height - 30);
            ctx.stroke();
            ctx.restore();

            // Zone & Line Labels
            ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
            ctx.fillStyle = '#f43f5e';
            ctx.textAlign = 'center';
            ctx.fillText(`SL $${sig.slPrice.toFixed(0)}`, slX, height - 36);

            ctx.fillStyle = '#2dd4bf';
            ctx.fillText(`TP $${sig.tpPrice.toFixed(0)}`, tpX, height - 36);

            ctx.fillStyle = '#FFD97A';
            ctx.fillText(`${sig.direction} ENTRY`, entryX, 56);
          }

          // 2. Green (Teal) Buyer Tide Waves from Left & Red (Rose) Seller Tide Waves from Right
          // Wave height strictly follows the last 10s of real buy and sell volume
          const maxRefVol10s = Math.max(anim.smoothedBuy10s + anim.smoothedSell10s, 0.4);
          const buyWaveRatio = Math.min(1, anim.smoothedBuy10s / maxRefVol10s);
          const sellWaveRatio = Math.min(1, anim.smoothedSell10s / maxRefVol10s);

          const maxWaveH = height * 0.34;
          const buyAmp = 10 + buyWaveRatio * maxWaveH;
          const sellAmp = 10 + sellWaveRatio * maxWaveH;

          const waveLayers = fx === 'HIGH' ? 3 : 2;

          // Left Camp -> Knot: Buyer Teal Tide Waves
          for (let layer = 0; layer < waveLayers; layer++) {
            const layerScale = 1 - layer * 0.25;
            const alpha = isOfflineOrStale ? 0.08 : 0.14 + layer * 0.08;
            ctx.beginPath();
            ctx.moveTo(0, height);
            ctx.lineTo(0, centerY);

            const steps = 42;
            for (let s = 0; s <= steps; s++) {
              const t = s / steps;
              const x = t * knotX;
              // Envelope peaks near the clash knot and tapers at camp
              const envelope = 0.35 + 0.65 * Math.sin(t * Math.PI * 0.75);
              const wave =
                Math.sin(t * 9 - anim.wavePhase * (1.2 + layer * 0.3) + layer) *
                buyAmp *
                layerScale *
                envelope;
              const y = centerY - buyAmp * 0.35 * envelope + wave * 0.45;
              ctx.lineTo(x, y);
            }
            ctx.lineTo(knotX, height);
            ctx.closePath();

            const buyGrad = ctx.createLinearGradient(0, centerY - buyAmp, knotX, height);
            buyGrad.addColorStop(0, `rgba(20, 184, 166, ${alpha * 1.4})`);
            buyGrad.addColorStop(1, `rgba(13, 148, 136, 0.02)`);
            ctx.fillStyle = buyGrad;
            ctx.fill();

            if (layer === waveLayers - 1) {
              ctx.strokeStyle = isOfflineOrStale
                ? 'rgba(115,115,115,0.3)'
                : 'rgba(45, 212, 191, 0.75)';
              ctx.lineWidth = 2;
              ctx.stroke();
            }
          }

          // Right Camp -> Knot: Seller Rose Tide Waves
          for (let layer = 0; layer < waveLayers; layer++) {
            const layerScale = 1 - layer * 0.25;
            const alpha = isOfflineOrStale ? 0.08 : 0.14 + layer * 0.08;
            ctx.beginPath();
            ctx.moveTo(width, height);
            ctx.lineTo(width, centerY);

            const steps = 42;
            for (let s = 0; s <= steps; s++) {
              const t = s / steps;
              const x = width - t * (width - knotX);
              const envelope = 0.35 + 0.65 * Math.sin(t * Math.PI * 0.75);
              const wave =
                Math.sin(t * 9 - anim.wavePhase * (1.2 + layer * 0.3) + layer + 1.5) *
                sellAmp *
                layerScale *
                envelope;
              const y = centerY - sellAmp * 0.35 * envelope + wave * 0.45;
              ctx.lineTo(x, y);
            }
            ctx.lineTo(knotX, height);
            ctx.closePath();

            const sellGrad = ctx.createLinearGradient(width, centerY - sellAmp, knotX, height);
            sellGrad.addColorStop(0, `rgba(244, 63, 94, ${alpha * 1.4})`);
            sellGrad.addColorStop(1, `rgba(225, 29, 72, 0.02)`);
            ctx.fillStyle = sellGrad;
            ctx.fill();

            if (layer === waveLayers - 1) {
              ctx.strokeStyle = isOfflineOrStale
                ? 'rgba(115,115,115,0.3)'
                : 'rgba(251, 113, 133, 0.75)';
              ctx.lineWidth = 2;
              ctx.stroke();
            }
          }

          // 3. ABSORB = Golden Wall near the Knot
          const recentAbsorb = recentWaveformEvents
            .slice()
            .reverse()
            .find((e) => e.type === 'ABSORB' && latestSec - e.sec <= 18);

          if (recentAbsorb && !isOfflineOrStale) {
            const wallOffset = recentAbsorb.side === 'BUY' ? 22 : -22;
            const wallX = Math.max(padX, Math.min(width - padX, knotX + wallOffset));
            const wallTop = centerY - height * 0.28;
            const wallBottom = centerY + height * 0.24;

            ctx.save();
            const wallGrad = ctx.createLinearGradient(0, wallTop, 0, wallBottom);
            wallGrad.addColorStop(0, 'rgba(255, 217, 122, 0)');
            wallGrad.addColorStop(0.5, 'rgba(255, 217, 122, 0.85)');
            wallGrad.addColorStop(1, 'rgba(255, 217, 122, 0)');

            ctx.strokeStyle = wallGrad;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(wallX, wallTop);
            ctx.lineTo(wallX, wallBottom);
            ctx.stroke();

            // Golden shield aura
            ctx.fillStyle = 'rgba(232, 184, 74, 0.14)';
            ctx.fillRect(wallX - 6, wallTop + 12, 12, wallBottom - wallTop - 24);

            ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
            ctx.fillStyle = '#FFD97A';
            ctx.textAlign = 'center';
            ctx.fillText(`ABSORB WALL (${recentAbsorb.netVolBtc.toFixed(2)}₿)`, wallX, wallTop - 4);
            ctx.restore();
          }

          // 4. DRIVE = Comet Trails pushing toward the Knot
          for (const comet of cometsRef.current) {
            if (comet.progress < 0) continue;
            const isBuy = comet.side === 'BUY';
            const startX = isBuy ? 0 : width;
            const curX = startX + (knotX - startX) * comet.progress;
            const tailLen = (isBuy ? -1 : 1) * 68;
            const curY = centerY + comet.yOffsetNorm * (height * 0.35);

            const cometGrad = ctx.createLinearGradient(curX, curY, curX + tailLen, curY);
            cometGrad.addColorStop(0, isBuy ? 'rgba(45, 212, 191, 0.95)' : 'rgba(251, 113, 133, 0.95)');
            cometGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

            ctx.strokeStyle = cometGrad;
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(curX, curY);
            ctx.lineTo(curX + tailLen, curY);
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(curX, curY, 3, 0, Math.PI * 2);
            ctx.fill();
          }

          // 5. Real Trade Particles traveling from Camp to Knot
          for (const p of particlesRef.current) {
            const isBuy = p.side === 'BUY';
            const startX = isBuy ? 0 : width;
            const x = startX + (knotX - startX) * p.progress;
            // Converge vertically onto the knot as progress -> 1
            const spreadFactor = 1 - Math.pow(p.progress, 1.6);
            const y =
              centerY +
              p.yOffsetNorm * (height * 0.42) * spreadFactor +
              Math.sin(p.progress * Math.PI * 2 + anim.wavePhase) * 5 * spreadFactor;

            if (fx === 'HIGH') {
              ctx.fillStyle = isBuy
                ? 'rgba(20, 184, 166, 0.22)'
                : 'rgba(244, 63, 94, 0.22)';
              ctx.beginPath();
              ctx.arc(x, y, p.radius * 2.1, 0, Math.PI * 2);
              ctx.fill();
            }

            ctx.fillStyle = isBuy ? '#2dd4bf' : '#fb7185';
            ctx.beginPath();
            ctx.arc(x, y, p.radius, 0, Math.PI * 2);
            ctx.fill();
          }

          // 6. Liquidation Sparks at the Knot
          for (const sp of sparksRef.current) {
            const dist = sp.progress * 75;
            const sx = knotX + Math.cos(sp.angle) * dist;
            const sy = centerY + Math.sin(sp.angle) * dist;
            const alpha = Math.max(0, 1 - sp.progress);
            ctx.strokeStyle =
              sp.side === 'SELL'
                ? `rgba(251, 113, 133, ${alpha})`
                : `rgba(45, 212, 191, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx - Math.cos(sp.angle) * 10, sy - Math.sin(sp.angle) * 10);
            ctx.stroke();
          }

          // 7. Large Prints (>= $50K) Expanding Ring & Floating Label
          for (const lp of largePrintsRef.current) {
            const age = (nowMs - lp.createdAt) / lp.durationMs;
            if (age < 0 || age > 1) continue;
            const lpX = priceToX(lp.price);
            const ringR = 12 + age * 58;
            const alpha = Math.max(0, 1 - age);
            const isBuy = lp.side === 'BUY';

            ctx.strokeStyle = isBuy
              ? `rgba(45, 212, 191, ${alpha * 0.85})`
              : `rgba(251, 113, 133, ${alpha * 0.85})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(lpX, centerY, ringR, 0, Math.PI * 2);
            ctx.stroke();

            const floatY = centerY - 26 - age * 38;
            ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
            ctx.fillStyle = isBuy
              ? `rgba(45, 212, 191, ${alpha})`
              : `rgba(251, 113, 133, ${alpha})`;
            ctx.textAlign = 'center';
            ctx.fillText(
              `${lp.side} ${formatUsdShort(lp.usdValue)}`,
              lpX,
              floatY
            );
          }

          // 8. Glowing Knot marking the Current Price
          const knotBaseR = 9 + anim.knotPulse * 7;
          if (!isOfflineOrStale) {
            const glowGrad = ctx.createRadialGradient(
              knotX,
              centerY,
              2,
              knotX,
              centerY,
              knotBaseR * 3.6
            );
            glowGrad.addColorStop(0, 'rgba(255, 217, 122, 0.95)');
            glowGrad.addColorStop(0.45, 'rgba(232, 184, 74, 0.35)');
            glowGrad.addColorStop(1, 'rgba(232, 184, 74, 0)');
            ctx.fillStyle = glowGrad;
            ctx.beginPath();
            ctx.arc(knotX, centerY, knotBaseR * 3.6, 0, Math.PI * 2);
            ctx.fill();
          }

          // Vertical knot tether
          ctx.strokeStyle = isOfflineOrStale
            ? 'rgba(115, 115, 115, 0.35)'
            : 'rgba(255, 217, 122, 0.5)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(knotX, centerY - 38);
          ctx.lineTo(knotX, centerY + 38);
          ctx.stroke();

          // Knot Core
          ctx.fillStyle = isOfflineOrStale ? '#737373' : '#FFD97A';
          ctx.beginPath();
          ctx.arc(knotX, centerY, knotBaseR, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();

          // 9. X-Axis 2-Minute Price Scale Bar at Bottom
          const axisY = height - 18;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(padX, axisY);
          ctx.lineTo(width - padX, axisY);
          ctx.stroke();

          ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.fillStyle = 'rgba(163, 163, 163, 0.8)';
          const tickCount = 5;
          for (let t = 0; t <= tickCount; t++) {
            const frac = t / tickCount;
            const pVal = anim.smoothedMin2m + frac * priceSpan;
            const tx = padX + frac * usableW;
            ctx.textAlign = t === 0 ? 'left' : t === tickCount ? 'right' : 'center';
            ctx.fillText(`$${pVal.toFixed(0)}`, tx, height - 5);
          }

          // Camp Side Watermarks
          ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.fillStyle = 'rgba(45, 212, 191, 0.55)';
          ctx.textAlign = 'left';
          ctx.fillText(
            `◀ BUY CAMP · 10S VOL: ${anim.smoothedBuy10s.toFixed(2)} ₿`,
            12,
            height - 32
          );
          ctx.fillStyle = 'rgba(251, 113, 133, 0.55)';
          ctx.textAlign = 'right';
          ctx.fillText(
            `10S VOL: ${anim.smoothedSell10s.toFixed(2)} ₿ · SELL CAMP ▶`,
            width - 12,
            height - 32
          );
        } else {
          // =====================================================================
          // SCENE 2: FLOW REACTOR
          // =====================================================================
          const cx = width * 0.5;
          const cy = height * 0.46;
          const maxR = Math.min(width, height) * 0.31;

          const total10s = anim.smoothedBuy10s + anim.smoothedSell10s;
          const buyBalance = total10s > 0 ? anim.smoothedBuy10s / total10s : 0.5;

          // 1. Incoming Particles from Left (Buy) and Right (Sell) into Central Orb
          for (const p of particlesRef.current) {
            const isBuy = p.side === 'BUY';
            const startX = isBuy ? 0 : width;
            const startY = cy + p.yOffsetNorm * (height * 0.55);
            const x = startX + (cx - startX) * p.progress;
            const y =
              startY +
              (cy - startY) * p.progress +
              Math.sin(p.progress * Math.PI) * p.angleOffset * 28;

            ctx.fillStyle = isBuy ? '#2dd4bf' : '#fb7185';
            ctx.beginPath();
            ctx.arc(x, y, p.radius, 0, Math.PI * 2);
            ctx.fill();
          }

          // 2. Shockwave on ABSORB
          for (const sw of shockwavesRef.current) {
            const age = (nowMs - sw.createdAt) / sw.durationMs;
            if (age < 0 || age > 1) continue;
            const r = maxR * 0.4 + age * maxR * 1.1;
            const alpha = Math.max(0, 1 - age);
            ctx.strokeStyle = `rgba(255, 217, 122, ${alpha * 0.9})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
          }

          // 3. 60-Tick Seconds Ring (outer ring)
          const secRingR = maxR * 1.05;
          const nowSecOfMin = new Date().getUTCSeconds();
          const secLookup = new Map<number, SecondBin>();
          for (let i = Math.max(0, bins.length - 65); i < bins.length; i++) {
            const b = bins[i];
            secLookup.set(b.sec % 60, b);
          }

          for (let s = 0; s < 60; s++) {
            const angle = (s / 60) * Math.PI * 2 - Math.PI / 2;
            const bin = secLookup.get(s);
            const isCurrentSec = s === nowSecOfMin;
            const innerR = secRingR - (isCurrentSec ? 7 : 4);
            const outerR = secRingR + (isCurrentSec ? 6 : 3);

            let strokeColor = 'rgba(255, 255, 255, 0.14)';
            if (isCurrentSec) {
              strokeColor = '#FFD97A';
            } else if (bin) {
              if (bin.buyVol > bin.sellVol) strokeColor = 'rgba(45, 212, 191, 0.85)';
              else if (bin.sellVol > bin.buyVol) strokeColor = 'rgba(251, 113, 133, 0.85)';
            }

            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = isCurrentSec ? 2.5 : 1.8;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
            ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
            ctx.stroke();
          }

          // 4. CVD Arc Ring (middle ring)
          const cvdRingR = maxR * 0.82;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(cx, cy, cvdRingR, 0, Math.PI * 2);
          ctx.stroke();

          // Compute 3m CVD normalized arc
          let cvd3m = 0;
          let total3m = 0;
          const cutoff3m = latestSec - 179;
          for (let i = bins.length - 1; i >= 0; i--) {
            if (bins[i].sec < cutoff3m) break;
            cvd3m += bins[i].buyVol - bins[i].sellVol;
            total3m += bins[i].buyVol + bins[i].sellVol;
          }
          const cvdRatio = total3m > 0 ? Math.max(-1, Math.min(1, cvd3m / (total3m * 0.6))) : 0;
          const startAngle = -Math.PI / 2;
          const endAngle = startAngle + cvdRatio * Math.PI;

          ctx.strokeStyle = cvd3m >= 0 ? '#14b8a6' : '#f43f5e';
          ctx.lineWidth = 6;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.arc(cx, cy, cvdRingR, startAngle, endAngle, cvdRatio < 0);
          ctx.stroke();

          // 5. Comets on DRIVE orbiting the Reactor
          for (const comet of cometsRef.current) {
            if (comet.progress < 0) continue;
            const isBuy = comet.side === 'BUY';
            const dir = isBuy ? 1 : -1;
            const headAngle = -Math.PI / 2 + comet.progress * Math.PI * 2 * dir;
            const orbitR = maxR * 0.94;
            const hx = cx + Math.cos(headAngle) * orbitR;
            const hy = cy + Math.sin(headAngle) * orbitR;

            ctx.strokeStyle = isBuy ? '#2dd4bf' : '#fb7185';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(
              cx,
              cy,
              orbitR,
              headAngle - dir * 0.55,
              headAngle,
              !isBuy
            );
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }

          // 6. Central Orb colored by real Buy/Sell Balance
          const orbR = maxR * 0.42 + anim.knotPulse * 8;
          const orbColor =
            buyBalance >= 0.53
              ? 'rgba(20, 184, 166, 0.88)'
              : buyBalance <= 0.47
              ? 'rgba(244, 63, 94, 0.88)'
              : 'rgba(232, 184, 74, 0.85)';

          const orbGlow = ctx.createRadialGradient(cx, cy, 4, cx, cy, orbR * 2.1);
          orbGlow.addColorStop(0, orbColor);
          orbGlow.addColorStop(0.55, buyBalance >= 0.5 ? 'rgba(20, 184, 166, 0.2)' : 'rgba(244, 63, 94, 0.2)');
          orbGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');

          ctx.fillStyle = orbGlow;
          ctx.beginPath();
          ctx.arc(cx, cy, orbR * 2.1, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#090b10';
          ctx.beginPath();
          ctx.arc(cx, cy, orbR * 0.72, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = orbColor;
          ctx.lineWidth = 2.5;
          ctx.stroke();

          ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText(`CVD ${cvd3m >= 0 ? '+' : ''}${cvd3m.toFixed(2)}₿`, cx, cy + 4);

          // 7. Price Ribbon at the Bottom
          const ribbonTop = height - 48;
          const ribbonBottom = height - 10;
          const ribbonH = ribbonBottom - ribbonTop;
          const ribbonBins = bins.slice(-120);

          if (ribbonBins.length >= 2) {
            ctx.beginPath();
            for (let i = 0; i < ribbonBins.length; i++) {
              const rx = (i / (ribbonBins.length - 1)) * width;
              const normP = (ribbonBins[i].lastPrice - anim.smoothedMin2m!) / priceSpan;
              const ry = ribbonBottom - Math.max(0, Math.min(1, normP)) * ribbonH;
              if (i === 0) ctx.moveTo(rx, ry);
              else ctx.lineTo(rx, ry);
            }
            ctx.strokeStyle = '#FFD97A';
            ctx.lineWidth = 1.8;
            ctx.stroke();

            ctx.lineTo(width, height);
            ctx.lineTo(0, height);
            ctx.closePath();
            const ribGrad = ctx.createLinearGradient(0, ribbonTop, 0, height);
            ribGrad.addColorStop(0, 'rgba(232, 184, 74, 0.22)');
            ribGrad.addColorStop(1, 'rgba(232, 184, 74, 0.0)');
            ctx.fillStyle = ribGrad;
            ctx.fill();
          }
        }

        ctx.restore();
        rafId = requestAnimationFrame(renderFrame);
      };

      rafId = requestAnimationFrame(renderFrame);
      return () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
      };
    }, []);

    const isOffline = status === 'OFFLINE';
    const isStale = status === 'STALE';
    const hasTrades = secondBins.length > 0 && currentPrice !== null;

    const formatPrice = (val: number | null) => {
      if (val === null || val <= 0) return '--';
      return `$${val.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    };

    return (
      <div className="relative w-full bg-[#07080c] border border-[#E8B84A]/25 rounded-xl overflow-hidden shadow-[0_6px_30px_rgba(0,0,0,0.65)]">
        {/* Top HUD & Controls Bar */}
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2.5 bg-black/70 border-b border-white/10 backdrop-blur-md font-mono text-xs">
          {/* Left HUD: Price, Mood Chip (BUYERS / SELLERS IN CONTROL %), Trades / Min */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* HUD Price */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-neutral-400 uppercase">PRICE:</span>
              <span
                className={`text-sm sm:text-base font-extrabold tracking-tight ${
                  isOffline || isStale ? 'text-neutral-500' : 'text-white'
                }`}
              >
                {formatPrice(currentPrice)}
              </span>
            </div>

            {/* Mood Chip: BUYERS / SELLERS IN CONTROL % */}
            {hudStats.buyPct !== null && hudStats.sellPct !== null ? (
              hudStats.buyPct >= 50 ? (
                <div
                  className={`px-2 py-0.5 rounded border text-[11px] font-bold ${
                    isOffline || isStale
                      ? 'bg-neutral-900 border-neutral-700 text-neutral-500'
                      : 'bg-teal-950/70 border-teal-500/40 text-teal-300'
                  }`}
                >
                  BUYERS IN CONTROL {hudStats.buyPct}%
                </div>
              ) : (
                <div
                  className={`px-2 py-0.5 rounded border text-[11px] font-bold ${
                    isOffline || isStale
                      ? 'bg-neutral-900 border-neutral-700 text-neutral-500'
                      : 'bg-rose-950/70 border-rose-500/40 text-rose-300'
                  }`}
                >
                  SELLERS IN CONTROL {hudStats.sellPct}%
                </div>
              )
            ) : (
              <div className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-neutral-400 text-[11px]">
                CONTROL: --
              </div>
            )}

            {/* Trades per Minute */}
            <div className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-neutral-300 text-[11px]">
              <span className="text-neutral-400">TPM: </span>
              <span className="text-[#FFD97A] font-bold">
                {hasTrades ? hudStats.tradesPerMin.toLocaleString() : '--'}
              </span>
            </div>
          </div>

          {/* Right Controls: Scene Toggle & FX Levels */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Scene Toggle: Tug-of-War Tide (default) / Flow Reactor */}
            <div className="flex items-center p-0.5 rounded-lg bg-black/80 border border-white/10">
              <button
                onClick={() => setSceneMode('TUG_OF_WAR')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono transition-all cursor-pointer ${
                  sceneMode === 'TUG_OF_WAR'
                    ? 'bg-[#E8B84A] text-black font-bold shadow-[0_0_10px_rgba(232,184,74,0.3)]'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Waves className="w-3 h-3" />
                <span>Tug-of-War Tide</span>
              </button>
              <button
                onClick={() => setSceneMode('FLOW_REACTOR')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono transition-all cursor-pointer ${
                  sceneMode === 'FLOW_REACTOR'
                    ? 'bg-[#E8B84A] text-black font-bold shadow-[0_0_10px_rgba(232,184,74,0.3)]'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Orbit className="w-3 h-3" />
                <span>Flow Reactor</span>
              </button>
            </div>

            {/* FX Levels: HIGH / LITE / OFF */}
            <div className="flex items-center p-0.5 rounded-lg bg-black/80 border border-white/10">
              <span className="px-1.5 text-[10px] text-neutral-500 flex items-center gap-0.5">
                <Sparkles className="w-2.5 h-2.5 text-[#FFD97A]" /> FX
              </span>
              {(['HIGH', 'LITE', 'OFF'] as HeroFxLevel[]).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setFxLevel(lvl)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all cursor-pointer ${
                    fxLevel === lvl
                      ? 'bg-white/15 text-[#FFD97A] font-bold border border-[#E8B84A]/40'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Hero Canvas Stage */}
        <div ref={containerRef} className="relative w-full h-[270px] sm:h-[320px]">
          <canvas
            ref={canvasRef}
            className={`block w-full h-full transition-opacity duration-300 ${
              isOffline ? 'opacity-25' : isStale ? 'opacity-50' : 'opacity-100'
            }`}
          />

          {/* Waiting for First Real Trade (No Fake Boot Animation) */}
          {!hasTrades && !isOffline && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none font-mono text-xs text-neutral-400">
              <span>collecting live data...</span>
            </div>
          )}

          {/* FEED OFFLINE Dimmed Overlay */}
          {isOffline && (
            <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px] flex flex-col items-center justify-center font-mono">
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-950/80 border border-rose-500/50 text-rose-300 font-bold text-sm tracking-wider shadow-[0_0_24px_rgba(244,63,94,0.3)]">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                <span>FEED OFFLINE</span>
              </div>
              <span className="text-[11px] text-neutral-400 mt-1.5">
                Signals paused · Reconnecting to live exchange stream...
              </span>
            </div>
          )}

          {/* STALE Feed Warning Banner */}
          {isStale && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-md bg-amber-950/85 border border-amber-500/50 text-amber-300 font-mono text-xs font-bold flex items-center gap-1.5 pointer-events-none">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>FEED STALE ({(messageAgeMs / 1000).toFixed(1)}s) · SIGNALS PAUSED</span>
            </div>
          )}
        </div>
      </div>
    );
  }
);

HeroTideCanvas.displayName = 'HeroTideCanvas';
