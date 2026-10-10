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
  PulseNetVisualizer,
  PulseNetOverlayProjection,
} from './PulseNetVisualizer';
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
    const visualizerRef = useRef<PulseNetVisualizer | null>(null);
    const [webGlFailed, setWebGlFailed] = useState<boolean>(false);

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

    // Replay Mode State (when market is closed or user engages replay)
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

    // Dynamic screen overlay projections from PulseNet 3D scene
    const [overlayData, setOverlayData] = useState<PulseNetOverlayProjection>({
      priceHead: {
        x: 0,
        y: 0,
        price: feed.currentPrice || 0,
        direction: 'FLAT',
        visible: false,
      },
      networkStats: {
        activeNodes: 0,
        activeLines: 0,
        ticksPerMin: 0,
      },
    });

    // Expose Hooks for Signal Manager
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

    // Initialize PulseNetVisualizer Three.js Scene
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      try {
        const visualizer = new PulseNetVisualizer({
          canvas,
          isLite,
          reducedMotion,
          variant,
        });

        visualizer.onProjectionUpdate = (projection) => {
          setOverlayData(projection);
        };

        visualizerRef.current = visualizer;

        const handleResize = () => {
          visualizer.handleResize();
        };
        window.addEventListener('resize', handleResize);

        // Pause rendering when tab is hidden or element is offscreen
        const handleVisibilityChange = () => {
          if (visualizerRef.current) {
            visualizerRef.current.isPaused = document.hidden;
          }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        let observer: IntersectionObserver | null = null;
        if (typeof IntersectionObserver !== 'undefined' && containerRef.current) {
          observer = new IntersectionObserver(
            (entries) => {
              const entry = entries[0];
              if (visualizerRef.current) {
                visualizerRef.current.isPaused = !entry.isIntersecting;
              }
            },
            { threshold: 0.1 }
          );
          observer.observe(containerRef.current);
        }

        return () => {
          window.removeEventListener('resize', handleResize);
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          observer?.disconnect();
          visualizer.destroy();
          visualizerRef.current = null;
        };
      } catch (err) {
        console.error('PulseNet WebGL failed, falling back to static calm panel:', err);
        setWebGlFailed(true);
      }
    }, [isLite, reducedMotion, variant]);

    // Replay Mode Simulation Loop (stream historical stored ticks/candles visually only)
    useEffect(() => {
      if (!isReplayMode || !isReplayPlaying) return;

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

          if (visualizerRef.current) {
            const historySlice = candlePrices.slice(Math.max(0, next - 160), next + 1);
            visualizerRef.current.updateData({
              currentPrice,
              previousPrice: prevPrice,
              bid: currentPrice - 0.15,
              ask: currentPrice + 0.15,
              spread: 0.3,
              ticksPerMin: 68,
              tickDirection: delta > 0 ? 'BUY' : delta < 0 ? 'SELL' : 'FLAT',
              tickDelta: delta,
              priceHistory: historySlice.length > 5 ? historySlice : candlePrices.slice(0, 40),
              nearestSupport: currentPrice - 3.5,
              nearestResistance: currentPrice + 3.5,
              activeSignal: null,
              isMarketClosed: true,
              isReplay: true,
            });
          }

          return next;
        });
      }, 700);

      return () => clearInterval(replayInterval);
    }, [isReplayMode, isReplayPlaying, feed.candles, feed.sparkline]);

    // Live Feed & Real Ahmed Sniper Gates Data Pipeline
    useEffect(() => {
      if (isReplayMode) return;
      if (!visualizerRef.current) return;

      const price = feed.currentPrice;
      if (price <= 0) return;

      // Extract real history
      let completeHistory: number[] = [];
      if (feed.sparkline?.length) {
        completeHistory = [...feed.sparkline];
      } else if (feed.candles?.length) {
        completeHistory = feed.candles.map((c) => c.close);
      } else if (commandStore.candles?.M1?.length) {
        completeHistory = commandStore.candles.M1.map((c) => c.close);
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

      const totalFlow = (feed.buyTicks60s || 0) + (feed.sellTicks60s || 0);

      visualizerRef.current.updateData({
        currentPrice: price,
        previousPrice: feed.previousPrice || price,
        bid: feed.bid || price - 0.15,
        ask: feed.ask || price + 0.15,
        spread: feed.spread || 0.3,
        ticksPerMin: feed.volumeHistory?.[feed.volumeHistory.length - 1] || totalFlow || 25,
        tickDirection: feed.tickDirection || 'FLAT',
        tickDelta: Number((price - (feed.previousPrice || price)).toFixed(2)),
        priceHistory: completeHistory,
        nearestSupport,
        nearestResistance,
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

    // Status Tag: REPLAY or RECONNECTING or LIVE or MARKET CLOSED
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

    return (
      <div
        ref={containerRef}
        className={`relative w-full rounded-xl border border-white/10 bg-[#03050a] shadow-2xl overflow-hidden font-mono select-none ${className}`}
      >
        {/* SLIM HEADER ROW */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-white/5 bg-[#050811]/90 z-20 relative">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tracking-[0.2em] text-[#e2e8f0] uppercase">
              PULSE NET
            </span>
            {!isHero && (
              <span className="text-[9px] text-[#5b6577] hidden sm:inline">
                CONSTELLATION • XAU/USD
              </span>
            )}
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
              title="Toggle LITE Performance Mode (disables bloom & lowers count)"
            >
              LITE {isLite ? 'ON' : 'OFF'}
            </button>

            {/* Status Tag: Amber tag REPLAY or RECONNECTING */}
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-bold border tracking-wider ${statusTag.bg} ${statusTag.border} ${statusTag.color}`}
            >
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  statusTag.text === 'LIVE'
                    ? 'bg-[#22e08a] animate-ping'
                    : statusTag.text === 'REPLAY' || statusTag.text === 'RECONNECTING'
                    ? 'bg-[#f5c451]'
                    : 'bg-[#8a9ba8]'
                }`}
              />
              <span>{statusTag.text}</span>
            </div>
          </div>
        </div>

        {/* TOP OVERLAYS (Variant hero: only live price, tick count and the network itself, no strategy words) */}
        {isHero ? (
          <div className="absolute top-11 left-3 z-10 pointer-events-none flex items-center gap-3">
            <div className="px-2.5 py-1 rounded bg-[#050811]/80 border border-white/10 backdrop-blur-md">
              <span className="text-[8px] text-[#8a9ba8] uppercase tracking-wider block">
                PRICE
              </span>
              <span className="text-xs font-bold text-[#e2e8f0]">
                ${(feed.currentPrice || 0).toFixed(2)}
              </span>
            </div>
            <div className="px-2.5 py-1 rounded bg-[#050811]/80 border border-white/10 backdrop-blur-md">
              <span className="text-[8px] text-[#8a9ba8] uppercase tracking-wider block">
                TICKS
              </span>
              <span className="text-xs font-bold text-[#8fb4e8]">
                {overlayData.networkStats.ticksPerMin} /m
              </span>
            </div>
          </div>
        ) : (
          /* Command variant: Network telemetry metrics */
          <div className="absolute top-11 left-3 z-10 pointer-events-none flex items-center gap-2">
            <div className="px-2.5 py-1 rounded bg-[#050811]/85 border border-white/10 backdrop-blur-md flex flex-col justify-center shadow-lg">
              <span className="text-[8px] text-[#8fb4e8] font-bold tracking-wider uppercase">
                CONSTELLATION
              </span>
              <div className="text-[10px] text-[#e2e8f0] font-bold">
                {overlayData.networkStats.activeNodes} NODES • {overlayData.networkStats.activeLines} LINKS
              </div>
            </div>
          </div>
        )}

        {/* COOLDOWN PILL (mm:ss) */}
        {cooldownSec > 0 && (
          <div className="absolute top-11 right-3 z-20 pointer-events-none">
            <div className="px-2.5 py-1 rounded-full bg-[#050811]/90 border border-[#f5c451]/60 text-[#f5c451] text-[9px] font-bold tracking-widest shadow-[0_0_15px_rgba(245,196,81,0.25)] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#f5c451] animate-ping" />
              <span>
                COOLDOWN {Math.floor(cooldownSec / 60).toString().padStart(2, '0')}:
                {(cooldownSec % 60).toString().padStart(2, '0')}
              </span>
            </div>
          </div>
        )}

        {/* WEBGL 3D CANVAS VIEWPORT (WebGL failure falls back to a calm static dark panel with the live price text) */}
        <div className="relative w-full h-[320px] sm:h-[380px] bg-[#03050a]">
          {webGlFailed ? (
            <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-2 bg-[#03050a]">
              <div className="w-2 h-2 rounded-full bg-[#8fb4e8] animate-pulse" />
              <div className="text-sm font-bold text-[#e2e8f0]">
                ${(feed.currentPrice || 0).toFixed(2)}
              </div>
              <div className="text-[10px] text-[#5b6577]">
                PULSE NET CALM PANEL • XAU/USD LIVE
              </div>
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              className="w-full h-full block cursor-grab active:cursor-grabbing"
            />
          )}

          {/* PINPOINT LIVE PRICE AT ACTIVE HEAD NODE */}
          {overlayData.priceHead.visible && overlayData.priceHead.x > 0 && (
            <div
              className="absolute z-20 pointer-events-none transform -translate-y-1/2 transition-transform duration-75"
              style={{
                left: `${Math.min(overlayData.priceHead.x + 8, (containerRef.current?.clientWidth || 800) - 95)}px`,
                top: `${overlayData.priceHead.y}px`,
              }}
            >
              <div
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider backdrop-blur-md shadow-md border ${
                  overlayData.priceHead.direction === 'BUY'
                    ? 'bg-[#22e08a]/20 border-[#22e08a] text-[#22e08a]'
                    : overlayData.priceHead.direction === 'SELL'
                    ? 'bg-[#ff3b6b]/20 border-[#ff3b6b] text-[#ff3b6b]'
                    : 'bg-black/60 border-white/20 text-[#ffd97a]'
                }`}
              >
                ${(overlayData.priceHead.price || feed.currentPrice || 0).toFixed(2)}
              </div>
            </div>
          )}

          {/* ACTIVE SIGNAL STATUS BADGE (Top Center - Command Variant only) */}
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

        {/* GATE BAR AND TRADE STATE (Command Variant Only - no strategy words on hero variant) */}
        {!isHero && (
          <div className="p-2 sm:p-2.5 border-t border-white/5 bg-[#050811]/95 z-20 relative">
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
