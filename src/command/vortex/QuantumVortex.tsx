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
import NeuralCore, { NeuralCoreHandle } from './NeuralCore';
import { CoreLabel, CoreMode, CoreSignal, CoreTick, Tone } from './NeuralCoreEngine';
import { useCommandSignal } from '../signal/useCommandSignal';

export const AHMED_GATES_ORDER = [
  { id: 'g1', name: 'W1/D1 Context', shortName: 'D1', timeframe: 'D1' },
  { id: 'g2', name: 'H4 Bias', shortName: 'H4', timeframe: 'H4' },
  { id: 'g3', name: 'H1 Confirmation', shortName: 'H1', timeframe: 'H1' },
  { id: 'g4', name: 'M30 Refinement', shortName: 'M30', timeframe: 'M30' },
  { id: 'g5', name: 'M15 Body Close', shortName: 'M15', timeframe: 'M15' },
  { id: 'g6', name: 'M5 Retest', shortName: 'M5R', timeframe: 'M5' },
  { id: 'g7', name: 'M5 Confirmation', shortName: 'M5C', timeframe: 'M5' },
  { id: 'g8', name: 'Entry Trigger', shortName: 'TICK', timeframe: 'TICK' },
];

const QuantumVortexInner = forwardRef<QuantumVortexHooks, QuantumVortexProps & { signalEngine: any }>(
  ({ className = '', onRegisterHooks, variant = 'command', signalEngine, buyRatio: propBuyRatio, sellRatio: propSellRatio }, ref) => {
    const feed = useCommandFeed();
    const coreRef = useRef<NeuralCoreHandle | null>(null);

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
        return next;
      });
    }, []);

    // Active tooltip gate
    const [activeGateTooltip, setActiveGateTooltip] = useState<GateArcState | null>(null);

    // Forward hooks to NeuralCore ref
    useImperativeHandle(
      ref,
      () => ({
        triggerSignal: (side: 'BUY' | 'SELL') => {
          coreRef.current?.triggerSignal(side);
        },
        triggerResult: (result: 'TP' | 'SL') => {
          coreRef.current?.triggerResult(result);
        },
        setCooldown: (secondsLeft: number) => {
          coreRef.current?.setCooldown(secondsLeft);
        },
      }),
      []
    );

    useEffect(() => {
      if (onRegisterHooks) {
        onRegisterHooks({
          triggerSignal: (side: 'BUY' | 'SELL') => {
            coreRef.current?.triggerSignal(side);
          },
          triggerResult: (result: 'TP' | 'SL') => {
            coreRef.current?.triggerResult(result);
          },
          setCooldown: (secondsLeft: number) => {
            coreRef.current?.setCooldown(secondsLeft);
          },
        });
      }
    }, [onRegisterHooks]);

    // Real ticks mapping: last ~300 real ticks from existing feed store as { ts, price, delta } oldest -> newest
    const liveTicks: CoreTick[] = useMemo(() => {
      // Prefer tickHistory (holds up to 300 sequential real ticks)
      const raw = feed.tickHistory && feed.tickHistory.length > 0 ? feed.tickHistory : feed.tickTape.slice().reverse();
      if (!raw || raw.length === 0) return [];
      const res: CoreTick[] = [];
      for (let i = 0; i < raw.length; i++) {
        const t = raw[i];
        const prevPrice = i > 0 ? raw[i - 1].price : t.price;
        const delta = Number((t.price - prevPrice).toFixed(2));
        res.push({
          ts: t.timestamp,
          price: t.price,
          delta,
        });
      }
      return res;
    }, [feed.tickHistory, feed.tickTape]);

    // Stored real ticks from candles/sparkline for replay mode (visual only, never feeds signal engine or Telegram)
    const replayTicks: CoreTick[] = useMemo(() => {
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

      if (candlePrices.length === 0) return [];
      const startTs = Date.now() - candlePrices.length * 60000;
      const res: CoreTick[] = [];
      for (let i = 0; i < candlePrices.length; i++) {
        const p = candlePrices[i];
        const prev = i > 0 ? candlePrices[i - 1] : p;
        res.push({
          ts: startTs + i * 60000,
          price: p,
          delta: Number((p - prev).toFixed(2)),
        });
      }
      return res;
    }, [feed.candles, feed.sparkline]);

    // Determine CoreMode:
    // 'live' when market open;
    // 'reconnecting' when feed is disconnected/reconnecting;
    // 'closed' or 'replay' ONLY when market is officially closed ('replay' only if stored real ticks exist, else 'closed').
    const isMarketClosed = feed.connection.status === 'MARKET_CLOSED';
    const isReconnecting = feed.connection.status === 'RECONNECTING' || feed.connection.status === 'OFFLINE';

    const mode: CoreMode = useMemo(() => {
      if (isMarketClosed) {
        return replayTicks.length > 0 ? 'replay' : 'closed';
      }
      if (isReconnecting) {
        return 'reconnecting';
      }
      return 'live';
    }, [isMarketClosed, isReconnecting, replayTicks.length]);

    // Status tag presentation: LIVE / REPLAY / RECONNECTING / MARKET CLOSED
    const statusTag = useMemo(() => {
      if (mode === 'replay') {
        return { text: 'REPLAY', color: 'text-[#f5c451]', border: 'border-[#f5c451]/50', bg: 'bg-[#f5c451]/10', dot: 'bg-[#f5c451]' };
      }
      if (mode === 'reconnecting') {
        return { text: 'RECONNECTING', color: 'text-[#f5c451]', border: 'border-[#f5c451]/40', bg: 'bg-[#f5c451]/10', dot: 'bg-[#f5c451]' };
      }
      if (mode === 'closed') {
        return { text: 'MARKET CLOSED', color: 'text-[#8a9ba8]', border: 'border-[#8a9ba8]/40', bg: 'bg-[#8a9ba8]/10', dot: 'bg-[#8a9ba8]' };
      }
      return { text: 'LIVE', color: 'text-[#22e08a]', border: 'border-[#22e08a]/40', bg: 'bg-[#22e08a]/10', dot: 'bg-[#22e08a] animate-ping' };
    }, [mode]);

    // Window: 60-second rolling tick tape window
    // Buy/Sell Flow Share (sum 100, null when collecting data)
    const totalTicks60 = (feed.buyTicks60s || 0) + (feed.sellTicks60s || 0);
    const buyPct: number | null = totalTicks60 >= 5 ? feed.buyRatio : null;
    const sellPct: number | null = totalTicks60 >= 5 ? feed.sellRatio : null;

    // Real labels mapping with tones (bull green, bear red, neutral grey, na dark grey) and real details
    const labels: CoreLabel[] = useMemo(() => {
      // 1. SENTIMENT
      // Window: 60-second rolling tick tape window
      let sentVal = 'N/A';
      let sentTone: Tone = 'na';
      let sentDetail: string | undefined = undefined;
      if (totalTicks60 >= 5) {
        const b = feed.buyRatio;
        const diff = b - 50;
        if (Math.abs(diff) < 0.01) {
          sentVal = 'NEUTRAL';
          sentTone = 'neutral';
        } else {
          sentVal = `${diff > 0 ? '+' : '-'}${Math.abs(diff).toFixed(0)}% ${diff > 0 ? 'BUY' : 'SELL'}`;
          sentTone = diff > 2 ? 'bull' : diff < -2 ? 'bear' : 'neutral';
        }
        sentDetail = `60s flow share: ${b.toFixed(1)}% buyers vs ${(100 - b).toFixed(1)}% sellers across ${totalTicks60} ticks.`;
      }

      // 2. MOMENTUM
      // Window: 60-second rolling tick tape window
      let momVal = 'N/A';
      let momTone: Tone = 'na';
      let momDetail: string | undefined = undefined;
      if (totalTicks60 >= 5) {
        if (feed.buyRatio > 55) {
          momVal = 'BULLISH';
          momTone = 'bull';
          momDetail = `Aggressive buy delta with ${feed.buyTicks60s || 0} upticks driving upward pressure.`;
        } else if (feed.buyRatio < 45) {
          momVal = 'BEARISH';
          momTone = 'bear';
          momDetail = `Aggressive sell delta with ${feed.sellTicks60s || 0} downticks driving downward pressure.`;
        } else {
          momVal = 'NEUTRAL';
          momTone = 'neutral';
          momDetail = `Balanced two-way flow with steady order book equilibrium.`;
        }
      }

      // 3. MARKET REGIME
      let regVal = feed.regime?.trend || 'N/A';
      let regTone: Tone = 'na';
      let regDetail: string | undefined = undefined;
      if (regVal && regVal !== 'collecting data') {
        if (regVal.includes('BULLISH')) regTone = 'bull';
        else if (regVal.includes('BEARISH')) regTone = 'bear';
        else regTone = 'neutral';
        const htf = feed.regime?.htfBias ? ` HTF bias: ${feed.regime.htfBias}.` : '';
        const sess = feed.regime?.session ? ` Active session: ${feed.regime.session}.` : '';
        regDetail = `Market regime: ${regVal}.${htf}${sess}`;
      } else {
        regVal = 'N/A';
      }

      // 4. POC / PROFILE
      let pocVal = 'N/A';
      let pocTone: Tone = 'na';
      let pocDetail: string | undefined = undefined;
      if (feed.originLevels && feed.originLevels.length > 0) {
        // Highest volume weight level is the POC
        const sortedByVol = [...feed.originLevels].sort((a, b) => b.volumeWeight - a.volumeWeight);
        const pocLvl = sortedByVol[0];
        pocVal = `$${pocLvl.priceLevel.toFixed(2)}`;
        pocTone = 'neutral';
        pocDetail = `Point of Control at $${pocLvl.priceLevel.toFixed(2)} with volume weight ${pocLvl.volumeWeight.toFixed(0)}%.`;
      }

      // 5. ABSORPTION
      let absVal = 'N/A';
      let absTone: Tone = 'na';
      let absDetail: string | undefined = undefined;
      const hasAbsBuy = feed.absorptionBuyZones && feed.absorptionBuyZones.length > 0;
      const hasAbsSell = feed.absorptionSellZones && feed.absorptionSellZones.length > 0;
      if (hasAbsBuy || hasAbsSell) {
        if (hasAbsBuy && !hasAbsSell) {
          absVal = `$${feed.absorptionBuyZones[0].mid.toFixed(2)} BUY`;
          absTone = 'bull';
          absDetail = `Passive buy absorption defending zone at $${feed.absorptionBuyZones[0].mid.toFixed(2)}.`;
        } else if (hasAbsSell && !hasAbsBuy) {
          absVal = `$${feed.absorptionSellZones[0].mid.toFixed(2)} SELL`;
          absTone = 'bear';
          absDetail = `Passive sell absorption capping zone at $${feed.absorptionSellZones[0].mid.toFixed(2)}.`;
        } else {
          const buyMid = feed.absorptionBuyZones[0].mid;
          const sellMid = feed.absorptionSellZones[0].mid;
          absVal = `$${buyMid.toFixed(1)} / $${sellMid.toFixed(1)}`;
          absTone = 'neutral';
          absDetail = `Two-sided liquidity blocks active between $${buyMid.toFixed(2)} and $${sellMid.toFixed(2)}.`;
        }
      }

      // 6. FVG / OB
      let fvgVal = feed.nearestFvgOrOb || 'N/A';
      let fvgTone: Tone = 'na';
      let fvgDetail: string | undefined = undefined;
      if (fvgVal && fvgVal !== 'N/A') {
        if (fvgVal.toLowerCase().includes('bull')) fvgTone = 'bull';
        else if (fvgVal.toLowerCase().includes('bear')) fvgTone = 'bear';
        else fvgTone = 'neutral';
        fvgDetail = `Nearest institutional key level or imbalance: ${fvgVal}.`;
      } else {
        fvgVal = 'location weak';
        fvgTone = 'neutral';
      }

      // 7. STRUCTURE
      let structVal = feed.regime?.structure || 'N/A';
      let structTone: Tone = 'na';
      let structDetail: string | undefined = undefined;
      if (structVal && structVal !== 'collecting data') {
        if (structVal.includes('BOS') || structVal.includes('BULLISH')) structTone = 'bull';
        else if (structVal.includes('CHOCH') || structVal.includes('BEARISH')) structTone = 'bear';
        else structTone = 'neutral';
        structDetail = `Current market structure: ${structVal}.`;
      } else {
        structVal = 'N/A';
      }

      // 8. TICK DATA
      const tpm = feed.volumeHistory?.[feed.volumeHistory.length - 1] || totalTicks60 || 0;
      const tickDelta = feed.currentPrice && feed.previousPrice ? feed.currentPrice - feed.previousPrice : 0;
      const tickDataVal = `${tpm}/m · Δ${tickDelta >= 0 ? '+' : ''}${tickDelta.toFixed(2)}`;
      const tickDataTone: Tone = tickDelta > 0 ? 'bull' : tickDelta < 0 ? 'bear' : 'neutral';
      const tickDataDetail = `Pacing at ${tpm} ticks/min with net tick delta ${tickDelta >= 0 ? '+' : ''}${tickDelta.toFixed(2)}.`;

      // 9. TICK IMPACT
      let impactVal = 'N/A';
      let impactTone: Tone = 'na';
      let impactDetail: string | undefined = undefined;
      if (feed.minuteFlows && feed.minuteFlows.length >= 5) {
        const curBucket = feed.minuteFlows[feed.minuteFlows.length - 1];
        if (curBucket && curBucket.impactDollarsPerTick > 0) {
          impactVal = `$${curBucket.impactDollarsPerTick.toFixed(2)}/t`;
          impactTone = curBucket.netTicks >= 0 ? 'bull' : 'bear';
          impactDetail = `Order flow impact is $${curBucket.impactDollarsPerTick.toFixed(2)} per tick (${curBucket.netTicks >= 0 ? '+' : ''}${curBucket.netTicks} net ticks).`;
        }
      }

      return [
        { key: 'sentiment', title: 'SENTIMENT', value: sentVal, tone: sentTone, detail: sentDetail },
        { key: 'momentum', title: 'MOMENTUM', value: momVal, tone: momTone, detail: momDetail },
        { key: 'regime', title: 'MARKET REGIME', value: regVal, tone: regTone, detail: regDetail },
        { key: 'poc', title: 'POC / PROFILE', value: pocVal, tone: pocTone, detail: pocDetail },
        { key: 'absorption', title: 'ABSORPTION', value: absVal, tone: absTone, detail: absDetail },
        { key: 'fvgob', title: 'FVG / OB', value: fvgVal, tone: fvgTone, detail: fvgDetail },
        { key: 'structure', title: 'STRUCTURE', value: structVal, tone: structTone, detail: structDetail },
        { key: 'tickData', title: 'TICK DATA', value: tickDataVal, tone: tickDataTone, detail: tickDataDetail },
        { key: 'tickImpact', title: 'TICK IMPACT', value: impactVal, tone: impactTone, detail: impactDetail },
      ];
    }, [
      totalTicks60,
      feed.buyTicks60s,
      feed.sellTicks60s,
      feed.buyRatio,
      feed.regime?.trend,
      feed.regime?.structure,
      feed.regime?.htfBias,
      feed.regime?.session,
      feed.originLevels,
      feed.absorptionBuyZones,
      feed.absorptionSellZones,
      feed.nearestFvgOrOb,
      feed.volumeHistory,
      feed.currentPrice,
      feed.previousPrice,
      feed.minuteFlows,
    ]);

    // Active real signal mapping: { side: 'BUY'|'SELL', entry, sl, tp1, tp2, tp3 }
    // Pass null when there is no active signal, when it is closed, or when the market is closed and signal is stale.
    const activeCoreSignal: CoreSignal | null = useMemo(() => {
      const sig = signalEngine?.state?.activeSignal;
      const lifecycle = signalEngine?.state?.lifecycle;
      if (!sig || lifecycle !== 'ACTIVE' || isMarketClosed) return null;
      if (sig.closedAt || sig.closeReason) return null;
      if (!isFinite(sig.entry) || !isFinite(sig.sl) || !isFinite(sig.tp1) || !isFinite(sig.tp2) || !isFinite(sig.tp3)) {
        return null;
      }

      return {
        side: sig.side,
        entry: sig.entry,
        sl: sig.sl,
        tp1: sig.tp1,
        tp2: sig.tp2,
        tp3: sig.tp3,
      };
    }, [
      signalEngine?.state?.activeSignal?.id,
      signalEngine?.state?.activeSignal?.side,
      signalEngine?.state?.activeSignal?.entry,
      signalEngine?.state?.activeSignal?.sl,
      signalEngine?.state?.activeSignal?.tp1,
      signalEngine?.state?.activeSignal?.tp2,
      signalEngine?.state?.activeSignal?.tp3,
      signalEngine?.state?.activeSignal?.closedAt,
      signalEngine?.state?.activeSignal?.closeReason,
      signalEngine?.state?.lifecycle,
      isMarketClosed,
    ]);

    // Real Ahmed Sniper Gates
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
    const isHero = variant === 'hero';

    return (
      <div
        className={`relative w-full rounded-xl border border-white/10 bg-[#03050a] shadow-2xl overflow-hidden font-mono select-none ${className}`}
      >
        {/* SLIM HEADER ROW: SARRAF NEURAL CORE + status tag LIVE/REPLAY/RECONNECTING/MARKET CLOSED */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-white/5 bg-[#050811]/90 z-20 relative">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tracking-[0.2em] text-[#e2e8f0] uppercase">
              SARRAF NEURAL CORE
            </span>
            {!isHero && (
              <span className="text-[9px] text-[#5b6577] hidden sm:inline">
                XAU/USD CORE
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* LITE Toggle */}
            <button
              onClick={toggleLite}
              className={`text-[9px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                isLite
                  ? 'bg-[#f5c451]/20 border-[#f5c451] text-[#f5c451] font-bold'
                  : 'bg-white/5 border-white/10 text-neutral-400 hover:text-white'
              }`}
              title="Toggle LITE Performance Mode"
            >
              LITE {isLite ? 'ON' : 'OFF'}
            </button>

            {/* Status Tag: LIVE / REPLAY / RECONNECTING / MARKET CLOSED */}
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-bold border tracking-wider ${statusTag.bg} ${statusTag.border} ${statusTag.color}`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${statusTag.dot}`} />
              <span>{statusTag.text}</span>
            </div>
          </div>
        </div>

        {/* NEURAL CORE CANVAS VIEWPORT - nothing overlays the canvas */}
        <NeuralCore
          ref={coreRef}
          variant={variant}
          lite={isLite}
          mode={mode}
          livePrice={feed.currentPrice > 0 ? feed.currentPrice : null}
          buyPct={buyPct}
          sellPct={sellPct}
          labels={labels}
          signal={activeCoreSignal}
          ticks={liveTicks}
          replayTicks={replayTicks}
          height="clamp(380px, 62vw, 520px)"
        />

        {/* 8-PILL AHMED GATE BAR UNDER CANVAS (Command Variant Only - no strategy words on hero variant) */}
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
                {activeCoreSignal ? (
                  <span className="text-[#22e08a] font-bold">SIGNAL ACTIVE</span>
                ) : (
                  <span>
                    ALIGNMENT <span className="text-[#ffd97a] font-bold">{passCount}/8 PASS</span>
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

const QuantumVortexWithInternalSignal = forwardRef<QuantumVortexHooks, QuantumVortexProps>((props, ref) => {
  const internalSignal = useCommandSignal();
  return <QuantumVortexInner {...props} signalEngine={internalSignal} ref={ref} />;
});

export const QuantumVortex = forwardRef<QuantumVortexHooks, QuantumVortexProps>((props, ref) => {
  if (props.signalEngine) {
    return <QuantumVortexInner {...props} signalEngine={props.signalEngine} ref={ref} />;
  }
  return <QuantumVortexWithInternalSignal {...props} ref={ref} />;
});

QuantumVortex.displayName = 'QuantumVortex';
