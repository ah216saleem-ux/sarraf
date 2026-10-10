import React, {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  useCallback,
  useMemo,
} from 'react';
import { useCommandFeed } from '../data/useCommandFeed';
import { commandStore } from '../data/commandFeedStore';
import {
  QuantumVortexProps,
  QuantumVortexHooks,
  GateArcState,
} from './types';
import {
  FlowRiversVisualizer,
  FloatingLabelProjection,
} from './FlowRiversVisualizer';
import { useCommandSignal } from '../signal/useCommandSignal';
import { Play, Pause, RotateCcw } from 'lucide-react';

export const AHMED_GATES_ORDER = [
  { id: 'gate_1', name: 'HTF Trend Bias', shortName: 'HTF', timeframe: 'H4/H1' },
  { id: 'gate_2', name: 'Liquidity Sweep', shortName: 'SWP', timeframe: 'M15' },
  { id: 'gate_3', name: 'Structural Shift (MSS)', shortName: 'MSS', timeframe: 'M15' },
  { id: 'gate_4', name: 'Order Block (OB)', shortName: 'OB', timeframe: 'M15' },
  { id: 'gate_5', name: 'Fair Value Gap (FVG)', shortName: 'FVG', timeframe: 'M5' },
  { id: 'gate_6', name: 'Momentum Alignment', shortName: 'MOM', timeframe: 'M5' },
  { id: 'gate_7', name: 'Tick Volume Surge', shortName: 'VOL', timeframe: 'M1' },
  { id: 'gate_8', name: 'BiQuote Spread & Execution', shortName: 'EXE', timeframe: 'M1' },
];

export const QuantumVortex = forwardRef<QuantumVortexHooks, QuantumVortexProps>(
  ({ className = '', onRegisterHooks, variant = 'command', signalEngine: externalSignalEngine }, ref) => {
    const feed = useCommandFeed();
    const internalSignal = useCommandSignal();
    const signalEngine = externalSignalEngine || internalSignal;

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const visualizerRef = useRef<FlowRiversVisualizer | null>(null);

    // Lite Mode State (persisted in localStorage)
    const [isLite, setIsLite] = useState<boolean>(() => {
      if (typeof window !== 'undefined') {
        return localStorage.getItem('sarraf_vortex_lite') === 'true';
      }
      return false;
    });

    const toggleLite = useCallback(() => {
      setIsLite((prev) => {
        const next = !prev;
        if (typeof window !== 'undefined') {
          localStorage.setItem('sarraf_vortex_lite', String(next));
        }
        visualizerRef.current?.setLiteMode(next);
        return next;
      });
    }, []);

    // Prefers reduced motion
    const reducedMotion = useMemo(() => {
      if (typeof window !== 'undefined') {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      }
      return false;
    }, []);

    // 2s Intro Animation (tap to skip)
    const [isIntroRunning, setIsIntroRunning] = useState<boolean>(() => !reducedMotion);
    const skipIntro = useCallback(() => {
      setIsIntroRunning(false);
      visualizerRef.current?.skipIntro();
    }, []);

    useEffect(() => {
      if (reducedMotion) {
        setIsIntroRunning(false);
        return;
      }
      const timer = setTimeout(() => {
        setIsIntroRunning(false);
      }, 2000);
      return () => clearTimeout(timer);
    }, [reducedMotion]);

    // Replay Mode State (for when market is closed or user engages replay)
    const isMarketClosed = feed.connection.status === 'MARKET_CLOSED' || !feed.connection.isLive;
    const [userReplayActive, setUserReplayActive] = useState<boolean>(false);
    const [isReplayPlaying, setIsReplayPlaying] = useState<boolean>(true);
    const [replayCursor, setReplayCursor] = useState<number>(0);

    const isReplayMode = isMarketClosed || userReplayActive;

    // Cooldown state
    const [cooldownSec, setCooldownSec] = useState<number>(0);
    useEffect(() => {
      if (cooldownSec <= 0) return;
      const interval = setInterval(() => {
        setCooldownSec((s) => Math.max(0, s - 1));
      }, 1000);
      return () => clearInterval(interval);
    }, [cooldownSec]);

    // Active tooltip gate
    const [activeGateTooltip, setActiveGateTooltip] = useState<GateArcState | null>(null);

    // Dynamic screen overlay positions from 3D projection
    const [labels, setLabels] = useState<FloatingLabelProjection[]>([]);
    const [priceHead, setPriceHead] = useState<{
      x: number;
      y: number;
      price: number;
      direction: 'BUY' | 'SELL' | 'FLAT';
    }>({
      x: 0,
      y: 0,
      price: feed.currentPrice || 0,
      direction: 'FLAT',
    });

    // Rolling Price History (Last 300 ticks or 120 M1 closes)
    const rollingPriceHistoryRef = useRef<number[]>([]);

    // Expose Hooks for Signal Manager (Section A.6)
    useImperativeHandle(
      ref,
      () => ({
        triggerSignal: (side: 'BUY' | 'SELL') => {
          visualizerRef.current?.triggerSignal(side);
        },
        triggerResult: (result: 'TP' | 'SL') => {
          visualizerRef.current?.triggerResult(result);
        },
        setCooldown: (secondsLeft: number) => {
          setCooldownSec(secondsLeft);
          visualizerRef.current?.setCooldown(secondsLeft);
        },
      }),
      []
    );

    useEffect(() => {
      if (onRegisterHooks) {
        onRegisterHooks({
          triggerSignal: (side: 'BUY' | 'SELL') => {
            visualizerRef.current?.triggerSignal(side);
          },
          triggerResult: (result: 'TP' | 'SL') => {
            visualizerRef.current?.triggerResult(result);
          },
          setCooldown: (secondsLeft: number) => {
            setCooldownSec(secondsLeft);
            visualizerRef.current?.setCooldown(secondsLeft);
          },
        });
      }
    }, [onRegisterHooks]);

    // Initialize FlowRiversVisualizer Three.js Scene
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const visualizer = new FlowRiversVisualizer({
        canvas,
        isLite,
        reducedMotion,
        variant,
      });

      visualizer.onLabelsUpdate = (newLabels) => {
        setLabels(newLabels);
      };

      visualizer.onPriceHeadUpdate = (x, y, p, dir) => {
        setPriceHead({ x, y, price: p, direction: dir });
      };

      visualizerRef.current = visualizer;

      const handleResize = () => {
        visualizer.handleResize();
      };
      window.addEventListener('resize', handleResize);

      // Intersection Observer to pause rendering when offscreen
      let observer: IntersectionObserver | null = null;
      if (typeof IntersectionObserver !== 'undefined' && containerRef.current) {
        observer = new IntersectionObserver(
          (entries) => {
            const entry = entries[0];
            if (visualizerRef.current) {
              (visualizerRef.current as any).isPaused = !entry.isIntersecting;
            }
          },
          { threshold: 0.1 }
        );
        observer.observe(containerRef.current);
      }

      return () => {
        window.removeEventListener('resize', handleResize);
        observer?.disconnect();
        visualizer.destroy();
        visualizerRef.current = null;
      };
    }, [isLite, reducedMotion, variant]);

    // Replay Mode Simulation Loop
    useEffect(() => {
      if (!isReplayMode || !isReplayPlaying) return;

      // Extract historical seed points from candles or sparkline
      const candlePrices: number[] = [];
      if (commandStore.candles?.M1?.length) {
        for (const c of commandStore.candles.M1) {
          candlePrices.push(c.close);
        }
      } else if (feed.candles?.length) {
        for (const c of feed.candles) {
          candlePrices.push(c.close);
        }
      } else if (feed.sparkline?.length) {
        candlePrices.push(...feed.sparkline);
      }

      if (candlePrices.length === 0) return;

      const replayInterval = setInterval(() => {
        setReplayCursor((prev) => {
          const next = (prev + 1) % candlePrices.length;
          const currentPrice = candlePrices[next];
          const prevPrice = candlePrices[(next - 1 + candlePrices.length) % candlePrices.length];
          const delta = Number((currentPrice - prevPrice).toFixed(2));

          // Feed into visualizer
          if (visualizerRef.current) {
            const historySlice = candlePrices.slice(Math.max(0, next - 200), next + 1);
            visualizerRef.current.updateData({
              currentPrice,
              previousPrice: prevPrice,
              bid: currentPrice - 0.15,
              ask: currentPrice + 0.15,
              spread: 0.3,
              buyRatio: delta > 0 ? 62 : delta < 0 ? 38 : 50,
              sellRatio: delta > 0 ? 38 : delta < 0 ? 62 : 50,
              ticksPerMin: 85,
              tickDirection: delta > 0 ? 'BUY' : delta < 0 ? 'SELL' : 'FLAT',
              tickDelta: delta,
              priceHistory: historySlice.length > 10 ? historySlice : candlePrices.slice(0, 50),
              nearestSupport: currentPrice - 3.5,
              nearestResistance: currentPrice + 3.5,
              pocPrice: currentPrice - 1.2,
              absorptionPrice: currentPrice - 2.8,
              fvgPrice: currentPrice + 1.8,
              activeSignal: null,
              isMarketClosed: true,
              isReplay: true,
            });
          }

          return next;
        });
      }, 800);

      return () => clearInterval(replayInterval);
    }, [isReplayMode, isReplayPlaying, feed.candles, feed.sparkline]);

    // Live Feed & Signal Engine Data Pipeline
    useEffect(() => {
      if (isReplayMode) return; // Replay loop handles closed state
      if (!visualizerRef.current) return;

      const price = feed.currentPrice;
      if (price <= 0) return;

      // Maintain rolling history of last 300 ticks
      const hist = rollingPriceHistoryRef.current;
      hist.push(price);
      if (hist.length > 300) hist.shift();

      // If history is small, backfill with M1 closes
      let completeHistory = [...hist];
      if (completeHistory.length < 20 && commandStore.candles?.M1?.length) {
        const m1Closes = commandStore.candles.M1.map((c) => c.close);
        completeHistory = [...m1Closes.slice(-120), ...completeHistory];
      } else if (completeHistory.length < 20 && feed.candles?.length) {
        const cCloses = feed.candles.map((c) => c.close);
        completeHistory = [...cCloses.slice(-120), ...completeHistory];
      } else if (completeHistory.length < 10 && feed.sparkline?.length) {
        completeHistory = [...feed.sparkline, ...completeHistory];
      }

      // Nearest Support / Resistance from Liquidity Zones
      let nearestSupport: number | undefined;
      let nearestResistance: number | undefined;
      if (feed.liquidityZones?.length) {
        for (const zone of feed.liquidityZones) {
          if (zone.type === 'SUPPORT' && zone.mid < price) {
            if (!nearestSupport || zone.mid > nearestSupport) nearestSupport = zone.mid;
          } else if (zone.type === 'RESISTANCE' && zone.mid > price) {
            if (!nearestResistance || zone.mid < nearestResistance) nearestResistance = zone.mid;
          }
        }
      }

      // POC price from Origin Levels (highest volumeWeight)
      let pocPrice: number | undefined;
      if (feed.originLevels?.length) {
        const sortedLevels = [...feed.originLevels].sort((a, b) => b.volumeWeight - a.volumeWeight);
        pocPrice = sortedLevels[0]?.priceLevel;
      }

      // Absorption price
      const absZone = feed.absorptionBuyZones?.[0] || feed.absorptionSellZones?.[0];
      const absorptionPrice = absZone ? absZone.mid : undefined;

      // FVG / OB price
      const fvgZone = feed.originDisplacements?.[0];
      const fvgPrice = fvgZone ? fvgZone.originPrice : undefined;

      // Active Signal Levels
      let activeSignalData = null;
      if (signalEngine?.state?.activeSignal) {
        const sig: any = signalEngine.state.activeSignal;
        activeSignalData = {
          side: sig.side,
          entry: Number(sig.entry ?? sig.entryPrice ?? price),
          sl: Number(sig.sl ?? sig.stopLoss ?? price - 10),
          tp1: Number(sig.tp1 ?? sig.takeProfit1 ?? price + 10),
          tp2: sig.tp2 ?? sig.takeProfit2,
          tp3: sig.tp3 ?? sig.takeProfit3,
        };
      }

      // Real Ahmed Sniper Gates
      const gates: GateArcState[] = AHMED_GATES_ORDER.map((def) => {
        const liveGate = signalEngine?.state?.gates?.find((g) => g.id === def.id);
        return {
          id: def.id,
          name: def.name,
          shortName: def.shortName,
          timeframe: def.timeframe,
          status: liveGate ? liveGate.status : 'LOCKED',
          reason: liveGate?.reason || 'Awaiting live tick alignment',
        };
      });

      // Flow stats
      const totalFlow = (feed.buyTicks60s || 0) + (feed.sellTicks60s || 0);
      const buyRatio = totalFlow > 0 ? ((feed.buyTicks60s || 0) / totalFlow) * 100 : 50;
      const sellRatio = totalFlow > 0 ? ((feed.sellTicks60s || 0) / totalFlow) * 100 : 50;

      visualizerRef.current.updateData({
        currentPrice: price,
        previousPrice: feed.previousPrice || price,
        bid: feed.bid || price - 0.15,
        ask: feed.ask || price + 0.15,
        spread: feed.spread || 0.3,
        buyRatio,
        sellRatio,
        ticksPerMin: feed.volumeHistory?.[feed.volumeHistory.length - 1] || totalFlow || 25,
        tickDirection: feed.tickDirection || 'FLAT',
        tickDelta: Number((price - (feed.previousPrice || price)).toFixed(2)),
        priceHistory: completeHistory,
        nearestSupport,
        nearestResistance,
        pocPrice,
        absorptionPrice,
        fvgPrice,
        activeSignal: activeSignalData,
        gates,
        isMarketClosed: false,
        isReplay: false,
      });
    }, [feed, signalEngine, isReplayMode]);

    // Active Signal Values
    const activeSignal: any = signalEngine?.state?.activeSignal;
    const isSignalActive = Boolean(activeSignal);
    const livePnL = signalEngine?.livePnL ?? 0;

    // Gates Alignment Calculation
    const realGateStates: GateArcState[] = useMemo(() => {
      return AHMED_GATES_ORDER.map((def) => {
        const live = signalEngine?.state?.gates?.find((g) => g.id === def.id);
        return {
          id: def.id,
          name: def.name,
          shortName: def.shortName,
          timeframe: def.timeframe,
          status: live ? live.status : 'LOCKED',
          reason: live?.reason || 'Evaluation in progress',
        };
      });
    }, [signalEngine?.state?.gates]);

    const passCount = realGateStates.filter((g) => g.status === 'PASS').length;

    // Single Status Tag: Strictly ONE of LIVE, REPLAY, RECONNECTING, MARKET CLOSED
    const statusTag = useMemo(() => {
      if (isReplayMode) {
        return { text: 'REPLAY', color: 'text-[#f5c451]', border: 'border-[#f5c451]/50', bg: 'bg-[#f5c451]/10' };
      }
      if (feed.connection.status === 'RECONNECTING') {
        return { text: 'RECONNECTING', color: 'text-[#f5c451]', border: 'border-[#f5c451]/40', bg: 'bg-[#f5c451]/10' };
      }
      if (feed.connection.status === 'MARKET_CLOSED') {
        return { text: 'MARKET CLOSED', color: 'text-[#8a9ba8]', border: 'border-[#8a9ba8]/40', bg: 'bg-[#8a9ba8]/10' };
      }
      return { text: 'LIVE', color: 'text-[#22e08a]', border: 'border-[#22e08a]/40', bg: 'bg-[#22e08a]/10' };
    }, [feed.connection.status, isReplayMode]);

    const isHero = variant === 'hero';

    // Flow Percentages
    const totalFlowCount = (feed.buyTicks60s || 0) + (feed.sellTicks60s || 0);
    const buyFlowPercent = totalFlowCount > 0 ? Math.round(((feed.buyTicks60s || 0) / totalFlowCount) * 100) : 50;
    const sellFlowPercent = totalFlowCount > 0 ? 100 - buyFlowPercent : 50;

    return (
      <div
        ref={containerRef}
        className={`relative w-full rounded-xl border border-white/10 bg-[#04060b] shadow-2xl overflow-hidden font-mono select-none ${className}`}
      >
        {/* SECTION 7: SLIM HEADER ROW ABOVE THE CANVAS */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-white/5 bg-[#070b14]/90 z-20 relative">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tracking-[0.2em] text-[#e2e8f0] uppercase">
              FLOW RIVERS
            </span>
            <span className="text-[9px] text-[#5b6577] hidden sm:inline">
              XAU/USD STREAM
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Replay Controls if market closed */}
            {isMarketClosed && (
              <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded px-1.5 py-0.5 text-[9px]">
                <button
                  onClick={() => setIsReplayPlaying((p) => !p)}
                  className="text-[#f5c451] hover:text-white transition-colors cursor-pointer"
                  title={isReplayPlaying ? 'Pause Replay' : 'Play Replay'}
                >
                  {isReplayPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => setReplayCursor(0)}
                  className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
                  title="Rewind Replay"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* LITE Toggle */}
            <button
              onClick={toggleLite}
              className={`text-[9px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                isLite
                  ? 'bg-[#f5c451]/20 border-[#f5c451] text-[#f5c451] font-bold'
                  : 'bg-white/5 border-white/10 text-neutral-400 hover:text-white'
              }`}
              title="Toggle LITE Performance Mode (reduced particle count)"
            >
              LITE {isLite ? 'ON' : 'OFF'}
            </button>

            {/* Status Tag: Strictly ONE of LIVE, REPLAY, RECONNECTING, MARKET CLOSED */}
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-bold border tracking-wider ${statusTag.bg} ${statusTag.border} ${statusTag.color}`}
            >
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  statusTag.text === 'LIVE'
                    ? 'bg-[#22e08a] animate-ping'
                    : statusTag.text === 'REPLAY'
                    ? 'bg-[#f5c451]'
                    : statusTag.text === 'RECONNECTING'
                    ? 'bg-[#f5c451] animate-pulse'
                    : 'bg-[#8a9ba8]'
                }`}
              />
              <span>{statusTag.text}</span>
            </div>
          </div>
        </div>

        {/* SECTION 7: COMPACT BUY / SELL FLOW % BOXES IN TOP CORNERS */}
        <div className="absolute top-11 left-3 z-10 pointer-events-none">
          <div className="h-11 px-2.5 py-1 rounded bg-[#070b14]/85 border border-[#22e08a]/30 backdrop-blur-md flex flex-col justify-center shadow-lg">
            <span className="text-[8px] text-[#22e08a] font-bold tracking-wider uppercase">
              BUY FLOW
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-xs font-bold text-[#e2e8f0]">
                {buyFlowPercent}%
              </span>
              <div className="w-10 h-1 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#22e08a] transition-all duration-300"
                  style={{ width: `${buyFlowPercent}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="absolute top-11 right-3 z-10 pointer-events-none">
          <div className="h-11 px-2.5 py-1 rounded bg-[#070b14]/85 border border-[#ff3b6b]/30 backdrop-blur-md flex flex-col justify-center items-end shadow-lg">
            <span className="text-[8px] text-[#ff3b6b] font-bold tracking-wider uppercase">
              SELL FLOW
            </span>
            <div className="flex items-baseline gap-1">
              <div className="w-10 h-1 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#ff3b6b] transition-all duration-300 ml-auto"
                  style={{ width: `${sellFlowPercent}%` }}
                />
              </div>
              <span className="text-xs font-bold text-[#e2e8f0]">
                {sellFlowPercent}%
              </span>
            </div>
          </div>
        </div>

        {/* SECTION 6: COOLDOWN PILL (mm:ss) IN TOP RIGHT */}
        {cooldownSec > 0 && (
          <div className="absolute top-24 right-3 z-20 pointer-events-none">
            <div className="px-2.5 py-1 rounded-full bg-[#070b14]/90 border border-[#f5c451]/60 text-[#f5c451] text-[9px] font-bold tracking-widest shadow-[0_0_15px_rgba(245,196,81,0.25)] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#f5c451] animate-ping" />
              <span>
                COOLDOWN {Math.floor(cooldownSec / 60).toString().padStart(2, '0')}:
                {(cooldownSec % 60).toString().padStart(2, '0')}
              </span>
            </div>
          </div>
        )}

        {/* WEBGL 3D CANVAS VIEWPORT (min height 320px mobile, 380px desktop) */}
        <div className="relative w-full h-[320px] sm:h-[380px] bg-[#04060b]">
          <canvas
            ref={canvasRef}
            className="w-full h-full block cursor-crosshair"
          />

          {/* SECTION 8: 2-SECOND INTRO OVERLAY (TAP TO SKIP) */}
          {isIntroRunning && (
            <div
              onClick={skipIntro}
              className="absolute inset-0 z-30 bg-[#04060b]/85 backdrop-blur-sm flex flex-col items-center justify-center cursor-pointer transition-opacity duration-300"
            >
              <div className="text-center space-y-1 animate-pulse">
                <div className="text-[10px] text-[#22e08a] font-bold tracking-[0.25em] uppercase">
                  FLOW RIVERS INITIALIZING
                </div>
                <div className="text-[9px] text-[#8a9ba8]">
                  STREAMING BIQUOTE PARTICLES • TAP TO SKIP
                </div>
              </div>
            </div>
          )}

          {/* SECTION 2: LIVE MONOSPACE PRICE AT THREAD HEAD */}
          {priceHead.x > 0 && priceHead.y > 0 && (
            <div
              className="absolute z-20 pointer-events-none transform -translate-y-1/2 transition-transform duration-75"
              style={{
                left: `${Math.min(priceHead.x + 8, (containerRef.current?.clientWidth || 800) - 95)}px`,
                top: `${priceHead.y}px`,
              }}
            >
              <div
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider backdrop-blur-md shadow-md border ${
                  priceHead.direction === 'BUY'
                    ? 'bg-[#22e08a]/20 border-[#22e08a] text-[#22e08a]'
                    : priceHead.direction === 'SELL'
                    ? 'bg-[#ff3b6b]/20 border-[#ff3b6b] text-[#ff3b6b]'
                    : 'bg-black/60 border-white/20 text-[#ffd97a]'
                }`}
              >
                ${(priceHead.price || feed.currentPrice || 0).toFixed(2)}
              </div>
            </div>
          )}

          {/* SECTION 4: HORIZONTAL LEVEL BANDS & ACTIVE SIGNAL LINES */}
          {/* Nearest Support / Resistance */}
          {feed.liquidityZones?.map((z) => {
            const worldY = visualizerRef.current?.priceToWorldY(z.mid);
            if (worldY === undefined) return null;
            const screen = (visualizerRef.current as any)?.worldToScreen(0, worldY, 0);
            if (!screen || screen.y < 20 || screen.y > 360) return null;

            return (
              <div
                key={z.id}
                className="absolute left-0 right-0 pointer-events-none flex items-center"
                style={{ top: `${screen.y}px` }}
              >
                <div className="w-full h-[1px] bg-white/[0.08]" />
                <span className="absolute left-2 text-[8px] text-[#8a9ba8]/80 font-mono -translate-y-1/2 bg-[#04060b]/80 px-1 rounded">
                  {z.type === 'SUPPORT' ? 'SUP' : 'RES'} ${z.mid.toFixed(2)}
                </span>
              </div>
            );
          })}

          {/* Active Signal Dashed Lines across whole canvas (Command Variant only) */}
          {!isHero && isSignalActive && activeSignal && (
            <>
              {/* Entry Line */}
              {(activeSignal.entry ?? activeSignal.entryPrice) && (
                <div
                  className="absolute left-0 right-0 pointer-events-none flex items-center z-10"
                  style={{
                    top: `${
                      (visualizerRef.current as any)?.worldToScreen(
                        0,
                        visualizerRef.current?.priceToWorldY(activeSignal.entry ?? activeSignal.entryPrice),
                        0
                      )?.y || 160
                    }px`,
                  }}
                >
                  <div className="w-full border-t border-dashed border-[#ffd97a]/60" />
                  <span className="absolute right-3 -translate-y-1/2 text-[8px] font-bold text-[#ffd97a] bg-[#070b14]/90 px-1 rounded border border-[#ffd97a]/40">
                    ENTRY ${(activeSignal.entry ?? activeSignal.entryPrice).toFixed(2)}
                  </span>
                </div>
              )}

              {/* SL Line (Red) */}
              {(activeSignal.sl ?? activeSignal.stopLoss) && (
                <div
                  className="absolute left-0 right-0 pointer-events-none flex items-center z-10"
                  style={{
                    top: `${
                      (visualizerRef.current as any)?.worldToScreen(
                        0,
                        visualizerRef.current?.priceToWorldY(activeSignal.sl ?? activeSignal.stopLoss),
                        0
                      )?.y || 200
                    }px`,
                  }}
                >
                  <div className="w-full border-t border-dashed border-[#ff3b6b]/70" />
                  <span className="absolute right-3 -translate-y-1/2 text-[8px] font-bold text-[#ff3b6b] bg-[#070b14]/90 px-1 rounded border border-[#ff3b6b]/40">
                    SL ${(activeSignal.sl ?? activeSignal.stopLoss).toFixed(2)}
                  </span>
                </div>
              )}

              {/* TP1 Line (Green) */}
              {(activeSignal.tp1 ?? activeSignal.takeProfit1) && (
                <div
                  className="absolute left-0 right-0 pointer-events-none flex items-center z-10"
                  style={{
                    top: `${
                      (visualizerRef.current as any)?.worldToScreen(
                        0,
                        visualizerRef.current?.priceToWorldY(activeSignal.tp1 ?? activeSignal.takeProfit1),
                        0
                      )?.y || 120
                    }px`,
                  }}
                >
                  <div className="w-full border-t border-dashed border-[#22e08a]/70" />
                  <span className="absolute right-3 -translate-y-1/2 text-[8px] font-bold text-[#22e08a] bg-[#070b14]/90 px-1 rounded border border-[#22e08a]/40">
                    TP1 ${(activeSignal.tp1 ?? activeSignal.takeProfit1).toFixed(2)}
                  </span>
                </div>
              )}
            </>
          )}

          {/* SECTION 5: FLOATING LABELS IN STREAM (9px monospace, thin connector + ring marker) */}
          {labels.map((lbl) => (
            <div
              key={lbl.id}
              className="absolute z-10 pointer-events-none"
              style={{ left: `${lbl.x}px`, top: `${lbl.y}px` }}
            >
              <div
                className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#070b14]/80 border backdrop-blur-sm shadow"
                style={{
                  borderColor: lbl.color,
                  boxShadow: `0 0 8px ${lbl.glowColor}`,
                }}
              >
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: lbl.color }}
                />
                <span className="text-[8px] text-[#8a9ba8] tracking-wider uppercase">
                  {lbl.label}
                </span>
                <span className="text-[9px] font-bold text-[#e2e8f0]">
                  {lbl.value}
                </span>
                {lbl.subValue && (
                  <span className="text-[8px] text-[#5b6577]">
                    {lbl.subValue}
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* ACTIVE SIGNAL STATUS BADGE (Top Center) */}
          {!isHero && isSignalActive && activeSignal && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
              <div
                className={`px-3 py-1 rounded-full text-[9px] font-bold tracking-widest border backdrop-blur-md shadow-lg flex items-center gap-2 ${
                  activeSignal.side === 'BUY'
                    ? 'bg-[#22e08a]/15 border-[#22e08a]/50 text-[#22e08a]'
                    : 'bg-[#ff3b6b]/15 border-[#ff3b6b]/50 text-[#ff3b6b]'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full animate-ping bg-current" />
                <span>
                  ACTIVE {activeSignal.side} @ ${(activeSignal.entry ?? activeSignal.entryPrice ?? 0).toFixed(2)}
                </span>
                <span className="text-white/80">
                  PnL: {livePnL >= 0 ? '+' : ''}${livePnL.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* SECTION 6: GATE BAR AND TRADE STATE (Command Variant Only) */}
        {!isHero && (
          <div className="p-2 sm:p-2.5 border-t border-white/5 bg-[#070b14]/95 z-20 relative">
            {/* Slim bar of 8 small pills */}
            <div className="grid grid-cols-8 gap-1 mb-1.5">
              {realGateStates.map((gate) => {
                const colorBg =
                  gate.status === 'PASS'
                    ? 'bg-[#22e08a]/20 border-[#22e08a] text-[#22e08a]'
                    : gate.status === 'FAIL'
                    ? 'bg-[#ff3b6b]/20 border-[#ff3b6b] text-[#ff3b6b]'
                    : 'bg-[#5b6577]/20 border-[#5b6577] text-[#8a9ba8]';

                return (
                  <button
                    key={gate.id}
                    onClick={() => setActiveGateTooltip(gate)}
                    className={`py-1 rounded text-center border text-[8px] font-bold transition-all hover:brightness-125 cursor-pointer relative ${colorBg}`}
                    title={`${gate.name}: ${gate.status}`}
                  >
                    <span>{gate.shortName}</span>
                    <div
                      className={`w-1 h-1 rounded-full mx-auto mt-0.5 ${
                        gate.status === 'PASS'
                          ? 'bg-[#22e08a]'
                          : gate.status === 'FAIL'
                          ? 'bg-[#ff3b6b]'
                          : 'bg-[#5b6577]'
                      }`}
                    />
                  </button>
                );
              })}
            </div>

            {/* State Line Under the Gate Bar */}
            <div className="flex items-center justify-between text-[9px] text-[#8a9ba8]">
              <div>
                {isSignalActive ? (
                  <span
                    className={`font-bold ${
                      activeSignal?.side === 'BUY' ? 'text-[#22e08a]' : 'text-[#ff3b6b]'
                    }`}
                  >
                    ACTIVE {activeSignal?.side} SIGNAL • 8/8 CONVERGED
                  </span>
                ) : (
                  <span>
                    WAITING FOR ALIGNMENT{' '}
                    <span className="text-[#ffd97a] font-bold">{passCount}/8 PASS</span>
                  </span>
                )}
              </div>

              <div className="text-[8px] text-[#5b6577]">
                AHMED SNIPER ENGINE
              </div>
            </div>

            {/* Gate Tooltip Modal */}
            {activeGateTooltip && (
              <div
                onClick={() => setActiveGateTooltip(null)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm z-30 flex items-center justify-center p-3 cursor-pointer"
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="bg-[#0b111d] border border-white/20 rounded-lg p-3 max-w-xs w-full shadow-2xl space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">
                      {activeGateTooltip.name}
                    </span>
                    <span
                      className={`text-[8px] font-bold px-1.5 py-0.5 rounded border ${
                        activeGateTooltip.status === 'PASS'
                          ? 'bg-[#22e08a]/20 border-[#22e08a] text-[#22e08a]'
                          : activeGateTooltip.status === 'FAIL'
                          ? 'bg-[#ff3b6b]/20 border-[#ff3b6b] text-[#ff3b6b]'
                          : 'bg-[#5b6577]/20 border-[#5b6577] text-[#8a9ba8]'
                      }`}
                    >
                      {activeGateTooltip.status}
                    </span>
                  </div>
                  <div className="text-[9px] text-[#8a9ba8]">
                    Timeframe: {activeGateTooltip.timeframe}
                  </div>
                  <div className="text-[9px] text-[#cbd5e1] bg-black/40 p-1.5 rounded border border-white/5">
                    {activeGateTooltip.reason}
                  </div>
                  <button
                    onClick={() => setActiveGateTooltip(null)}
                    className="w-full mt-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-[9px] font-bold tracking-wider uppercase transition-colors"
                  >
                    CLOSE
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);

QuantumVortex.displayName = 'QuantumVortex';
