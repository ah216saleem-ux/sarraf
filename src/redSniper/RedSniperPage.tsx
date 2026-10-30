import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  RED_SNIPER_TIMEFRAMES,
  RedSniperTimeframe,
  useRedSniperFeed,
} from './feed';
import {
  analyzeAllTimeframes,
  buildZoneTradeParameters,
  ClosedSniperTrade,
  computeBotStatusLine,
  computeOpenTradeFloatingPnl,
  computePerformanceMetrics,
  computeZoneProximityScore,
  getZoneDistancePts,
  isZoneNear,
  loadDemoState,
  OpenSniperTrade,
  RedSniperDemoState,
  saveDemoState,
  stepAutoTraderOnTick,
  TfBias,
} from './engine';
import { RedSniperChart } from './RedSniperChart';

const HUD_CLIP =
  'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))';
const HUD_CLIP_SM =
  'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))';

function formatHudDate(d: Date): string {
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const months = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  const dayName = days[d.getDay()];
  const dayNum = String(d.getDate()).padStart(2, '0');
  const monName = months[d.getMonth()];
  const year = d.getFullYear();
  return `${dayName}, ${dayNum} ${monName} ${year}`;
}

function formatTfLabel(tf: RedSniperTimeframe): string {
  if (tf === '1h') return '1H';
  if (tf === '4h') return '4H';
  if (tf === '1d') return '1D';
  return tf;
}

function biasBadgeColor(bias: TfBias): { text: string; border: string; bg: string } {
  if (bias === 'BULL') {
    return {
      text: '#00e676',
      border: 'rgba(0, 230, 118, 0.45)',
      bg: 'rgba(0, 230, 118, 0.08)',
    };
  }
  if (bias === 'BEAR') {
    return {
      text: '#ff2d45',
      border: 'rgba(255, 45, 69, 0.45)',
      bg: 'rgba(255, 45, 69, 0.1)',
    };
  }
  return {
    text: '#ffab00',
    border: 'rgba(255, 171, 0, 0.45)',
    bg: 'rgba(255, 171, 0, 0.08)',
  };
}

export const RedSniperPage: React.FC = () => {
  const {
    bars,
    livePrice,
    bid,
    ask,
    spread,
    connectionStatus,
    isMarketClosed,
    isLoading,
    session,
    rolling60sFlow,
  } = useRedSniperFeed();

  const [selectedTf, setSelectedTf] = useState<RedSniperTimeframe>('15m');
  const [demoState, setDemoState] = useState<RedSniperDemoState>(() => loadDemoState());
  const [showFarZones, setShowFarZones] = useState<boolean>(false);
  const [lastEnteredDecision, setLastEnteredDecision] = useState<string | null>(null);
  const [nowDate, setNowDate] = useState<Date>(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNowDate(new Date()), 5_000);
    return () => clearInterval(t);
  }, []);

  const hasLiveFeed =
    livePrice !== null && Number.isFinite(livePrice) && livePrice > 0;
  const isFeedReady = connectionStatus === 'CONNECTED' || hasLiveFeed;

  // Run pure engine across all 8 timeframes on closed + forming bars
  const { byTf, allZones, verdict } = useMemo(
    () => analyzeAllTimeframes(bars),
    [bars]
  );

  // Step auto-trader on every live tick
  useEffect(() => {
    if (!hasLiveFeed || livePrice === null) return;
    setDemoState((prev) => {
      const { nextState, changed, enteredText } = stepAutoTraderOnTick(
        prev,
        livePrice,
        allZones,
        verdict.bias1h,
        verdict.bias4h,
        session.name,
        Date.now()
      );
      if (enteredText) {
        setLastEnteredDecision(enteredText);
      } else {
        setLastEnteredDecision(null);
      }
      if (changed) {
        saveDemoState(nextState);
        return nextState;
      }
      return prev;
    });
  }, [livePrice, hasLiveFeed, allZones, verdict.bias1h, verdict.bias4h, session.name]);

  // Bot status decision line updated on every tick
  const botStatusLine = useMemo(
    () =>
      computeBotStatusLine(
        demoState,
        livePrice,
        allZones,
        verdict.bias1h,
        verdict.bias4h,
        lastEnteredDecision
      ),
    [demoState, livePrice, allZones, verdict.bias1h, verdict.bias4h, lastEnteredDecision]
  );

  const handleToggleAuto = useCallback(() => {
    setDemoState((prev) => {
      const next: RedSniperDemoState = {
        ...prev,
        autoEnabled: !prev.autoEnabled,
      };
      saveDemoState(next);
      return next;
    });
  }, []);

  const handleManualCloseTrade = useCallback(
    (tradeId: string) => {
      if (livePrice === null || !Number.isFinite(livePrice)) return;
      setDemoState((prev) => {
        const target = prev.openTrades.find((t) => t.id === tradeId);
        if (!target) return prev;
        const { totalPnl, currentR } = computeOpenTradeFloatingPnl(target, livePrice);
        const closedItem: ClosedSniperTrade = {
          id: target.id,
          zoneId: target.zoneId,
          time: Date.now(),
          tf: target.tf,
          side: target.side,
          entry: target.entry,
          exit: livePrice,
          pnl: totalPnl,
          r: currentR,
          result: 'MANUAL',
          session: target.session,
          power: target.power,
          class: target.tp2Hit ? 'win' : currentR >= 0 ? 'be' : 'loss',
        };
        const next: RedSniperDemoState = {
          ...prev,
          balance: Number((prev.balance + totalPnl).toFixed(2)),
          openTrades: prev.openTrades.filter((t) => t.id !== tradeId),
          closedTrades: [closedItem, ...prev.closedTrades].slice(0, 200),
        };
        saveDemoState(next);
        return next;
      });
    },
    [livePrice]
  );

  const handleResetDemo = useCallback(() => {
    const fresh: RedSniperDemoState = {
      balance: 1000,
      autoEnabled: demoState.autoEnabled,
      openTrades: [],
      closedTrades: [],
      usedZoneIds: [],
    };
    saveDemoState(fresh);
    setDemoState(fresh);
    setLastEnteredDecision(null);
  }, [demoState.autoEnabled]);

  // Compute Open P&L and Equity
  const openPnl = useMemo(() => {
    if (!hasLiveFeed || livePrice === null) return 0;
    return Number(
      demoState.openTrades
        .reduce((acc, t) => acc + computeOpenTradeFloatingPnl(t, livePrice).totalPnl, 0)
        .toFixed(2)
    );
  }, [demoState.openTrades, hasLiveFeed, livePrice]);

  const equity = Number((demoState.balance + openPnl).toFixed(2));

  // Compute LIVE TICK VOLUME metrics:
  // (a) projected volume = currentTickVolume / max(elapsedSecondsInMinute, 5) * 60 compared with avg of last 30 CLOSED M1 bars
  // (b) "last closed M1: N"
  // (c) buy/sell % from rolling 60-second tick window (show "--" until >= 20 ticks)
  const m1VolumeStats = useMemo(() => {
    const m1 = bars['1m'] || [];
    if (m1.length === 0) {
      return {
        currentVol: null as number | null,
        lastClosedVol: null as number | null,
        projectedVol: null as number | null,
        projMult: null as number | null,
      };
    }

    const formingBar = m1[m1.length - 1];
    const lastClosedBar = m1.length >= 2 ? m1[m1.length - 2] : null;
    const closed30 = m1.slice(Math.max(0, m1.length - 31), m1.length - 1);

    const avg30Closed =
      closed30.length > 0
        ? closed30.reduce((s, b) => s + b.tickVolume, 0) / closed30.length
        : formingBar.tickVolume || 1;

    const nowSec = Math.floor(Date.now() / 1000);
    const elapsedInMinute = Math.max(5, Math.min(60, nowSec - formingBar.time));
    const projectedVol = Math.round((formingBar.tickVolume / elapsedInMinute) * 60);
    const projMult =
      avg30Closed > 0 ? Number((projectedVol / avg30Closed).toFixed(1)) : 1.0;

    return {
      currentVol: formingBar.tickVolume,
      lastClosedVol: lastClosedBar ? lastClosedBar.tickVolume : null,
      projectedVol,
      projMult,
    };
  }, [bars, livePrice, nowDate]);

  // Filter zones within max(6*ATR14, 1.5% of price) by default and rank by power x proximity
  const nearZones = useMemo(() => {
    if (!hasLiveFeed || livePrice === null) return allZones;
    return allZones.filter((z) => isZoneNear(z, livePrice));
  }, [allZones, hasLiveFeed, livePrice]);

  const sortedStrongZones = useMemo(() => {
    const source = showFarZones ? allZones : nearZones;
    if (!hasLiveFeed || livePrice === null) {
      return [...source].sort((a, b) => b.power - a.power);
    }
    return [...source].sort(
      (a, b) =>
        computeZoneProximityScore(b, livePrice) -
        computeZoneProximityScore(a, livePrice)
    );
  }, [allZones, nearZones, showFarZones, hasLiveFeed, livePrice]);

  // Nearest pending trade plan (using near qualifying zones ranked by proximity/power)
  const pendingPlan = useMemo(() => {
    if (!hasLiveFeed || livePrice === null || nearZones.length === 0) return null;
    const qualifying = nearZones.filter((z) => z.power >= 50);
    const pool = qualifying.length > 0 ? qualifying : nearZones;

    const sortedByDist = [...pool].sort(
      (a, b) =>
        getZoneDistancePts(a, livePrice) - getZoneDistancePts(b, livePrice) ||
        computeZoneProximityScore(b, livePrice) -
          computeZoneProximityScore(a, livePrice)
    );

    const nearest = sortedByDist[0];
    if (!nearest) return null;

    const insideNow = livePrice >= nearest.bottom && livePrice <= nearest.top;
    const refEntry = insideNow
      ? livePrice
      : nearest.side === 'BULL'
      ? nearest.top
      : nearest.bottom;

    const plan = buildZoneTradeParameters(
      nearest,
      refEntry,
      demoState.balance,
      allZones,
      verdict.bias1h,
      verdict.bias4h
    );

    // Override insideZone and distance strictly from livePrice vs zone bounds
    const liveDistPts = getZoneDistancePts(nearest, livePrice);
    return {
      ...plan,
      insideZone: insideNow,
      distance: liveDistPts,
    };
  }, [hasLiveFeed, livePrice, nearZones, allZones, demoState.balance, verdict.bias1h, verdict.bias4h]);

  // Historical performance metrics
  const perf = useMemo(
    () => computePerformanceMetrics(demoState.closedTrades),
    [demoState.closedTrades]
  );

  const currentTfAnalysis = byTf[selectedTf];
  const currentTfCandles = bars[selectedTf] || [];
  const currentTfZones = currentTfAnalysis?.zones || [];
  const currentTfBullCount = currentTfZones.filter((z) => z.side === 'BULL').length;
  const currentTfBearCount = currentTfZones.filter((z) => z.side === 'BEAR').length;

  // SVG Donut math for TP2 Win Rate
  const donutRadius = 32;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const winStroke = (perf.tp2WinRatePct / 100) * donutCircumference;

  return (
    <div
      className="mx-auto w-full max-w-[540px] bg-black px-2.5 pb-12 pt-2 text-[#f2f4f8] select-none"
      style={{ fontFamily: "'Rajdhani', sans-serif" }}
    >
      {/* Top Feed Status Banner if not connected */}
      {!isFeedReady && (
        <div
          className="mb-2.5 border border-[#ff2d45] bg-[#140407] px-3 py-2 text-center text-xs font-bold tracking-[0.2em] text-[#ff2d45]"
          style={{ fontFamily: "'Orbitron', sans-serif", clipPath: HUD_CLIP_SM }}
        >
          WAITING FOR LIVE FEED
        </div>
      )}

      {/* 1) DATE CARD + MULTI-TIMEFRAME BIAS TILES + VERDICT BANNER */}
      <section
        className="border border-[#ff2d45]/35 bg-[#07070b] p-3.5 shadow-[0_0_24px_rgba(255,45,69,0.08)]"
        style={{ clipPath: HUD_CLIP }}
      >
        {/* Top Row: Brand + Live Price */}
        <div className="flex items-center justify-between border-b border-[#ff2d45]/20 pb-2.5">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 bg-[#ff2d45] shadow-[0_0_8px_#ff2d45]" />
              <h1
                className="text-sm font-extrabold tracking-[0.22em] text-[#ff2d45]"
                style={{ fontFamily: "'Orbitron', sans-serif" }}
              >
                RED SNIPER
              </h1>
            </div>
            <div
              className="mt-1 text-[11px] font-semibold tracking-[0.12em] text-neutral-300"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {formatHudDate(nowDate)} &nbsp;Session: {session.name}
            </div>
          </div>

          <div className="text-right" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            <div className="text-lg font-bold tracking-tight text-white">
              {hasLiveFeed && livePrice !== null
                ? `$${livePrice.toFixed(2)}`
                : 'WAITING FOR LIVE FEED'}
            </div>
            <div className="text-[10px] text-neutral-400">
              {isMarketClosed
                ? 'MARKET CLOSED'
                : spread !== null
                ? `SPR ${spread.toFixed(2)} (${bid?.toFixed(2) ?? '-'} / ${ask?.toFixed(2) ?? '-'})`
                : connectionStatus}
            </div>
          </div>
        </div>

        {/* MULTI-TIMEFRAME BIAS TILES (M30 / H1 / H4 / D1) */}
        <div className="mt-3">
          <div
            className="mb-1.5 text-[10px] font-bold tracking-[0.22em] text-neutral-400"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            MULTI-TIMEFRAME BIAS
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                { label: 'M30', bias: verdict.bias30m },
                { label: 'H1', bias: verdict.bias1h },
                { label: 'H4', bias: verdict.bias4h },
                { label: 'D1', bias: verdict.bias1d },
              ] as const
            ).map((item) => {
              const c = biasBadgeColor(item.bias);
              return (
                <div
                  key={item.label}
                  className="flex flex-col items-center justify-center py-2 text-center"
                  style={{
                    background: c.bg,
                    border: `1px solid ${c.border}`,
                    clipPath: HUD_CLIP_SM,
                  }}
                >
                  <span
                    className="text-[10px] font-bold tracking-[0.18em] text-neutral-300"
                    style={{ fontFamily: "'Orbitron', sans-serif" }}
                  >
                    {item.label}
                  </span>
                  <span
                    className="mt-0.5 text-xs font-bold tracking-wider"
                    style={{
                      color: c.text,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {isFeedReady ? item.bias : 'WAIT'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* VERDICT BANNER */}
        <div
          className="mt-3 flex items-center justify-between px-3 py-2"
          style={{
            background:
              verdict.tone === 'BULL'
                ? 'rgba(0, 230, 118, 0.1)'
                : verdict.tone === 'BEAR'
                ? 'rgba(255, 45, 69, 0.14)'
                : 'rgba(255, 171, 0, 0.1)',
            border: `1px solid ${
              verdict.tone === 'BULL'
                ? 'rgba(0, 230, 118, 0.45)'
                : verdict.tone === 'BEAR'
                ? 'rgba(255, 45, 69, 0.5)'
                : 'rgba(255, 171, 0, 0.45)'
            }`,
            clipPath: HUD_CLIP_SM,
          }}
        >
          <span
            className="text-[11px] font-extrabold tracking-[0.14em]"
            style={{
              fontFamily: "'Orbitron', sans-serif",
              color:
                verdict.tone === 'BULL'
                  ? '#00e676'
                  : verdict.tone === 'BEAR'
                  ? '#ff2d45'
                  : '#ffab00',
            }}
          >
            {isFeedReady ? verdict.banner : 'WAITING FOR LIVE FEED'}
          </span>
          <span
            className="text-[11px] font-bold text-neutral-300"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            SCORE {verdict.score > 0 ? `+${verdict.score}` : verdict.score}
          </span>
        </div>
      </section>

      {/* 2) BALANCE / EQUITY / OPEN P&L / SESSION TILES */}
      <section className="mt-2.5 grid grid-cols-4 gap-2">
        <div
          className="border border-[#ff2d45]/25 bg-[#07070b] p-2.5"
          style={{ clipPath: HUD_CLIP_SM }}
        >
          <div
            className="text-[9px] font-bold tracking-[0.18em] text-neutral-400"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            BALANCE
          </div>
          <div
            className="mt-1 text-sm font-bold text-white"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            ${demoState.balance.toFixed(2)}
          </div>
        </div>

        <div
          className="border border-[#ff2d45]/25 bg-[#07070b] p-2.5"
          style={{ clipPath: HUD_CLIP_SM }}
        >
          <div
            className="text-[9px] font-bold tracking-[0.18em] text-neutral-400"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            EQUITY
          </div>
          <div
            className="mt-1 text-sm font-bold text-white"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            ${equity.toFixed(2)}
          </div>
        </div>

        <div
          className="border border-[#ff2d45]/25 bg-[#07070b] p-2.5"
          style={{ clipPath: HUD_CLIP_SM }}
        >
          <div
            className="text-[9px] font-bold tracking-[0.18em] text-neutral-400"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            OPEN P&amp;L
          </div>
          <div
            className="mt-1 text-sm font-bold"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              color: openPnl > 0 ? '#00e676' : openPnl < 0 ? '#ff2d45' : '#e2e8f0',
            }}
          >
            {openPnl >= 0 ? `+$${openPnl.toFixed(2)}` : `-$${Math.abs(openPnl).toFixed(2)}`}
          </div>
        </div>

        <div
          className="border border-[#ff2d45]/25 bg-[#07070b] p-2.5"
          style={{ clipPath: HUD_CLIP_SM }}
        >
          <div
            className="text-[9px] font-bold tracking-[0.18em] text-neutral-400"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            SESSION
          </div>
          <div
            className="mt-1 truncate text-xs font-bold text-[#ff2d45]"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {session.name}
          </div>
        </div>
      </section>

      {/* 3) LIVE TICK VOLUME TILES (current M1 + last closed M1, projected vs 30 closed M1 avg, 60s rolling buy/sell % est., zones count) */}
      <section
        className="mt-2.5 border border-[#ff2d45]/30 bg-[#07070b] p-3"
        style={{ clipPath: HUD_CLIP }}
      >
        <div
          className="mb-2 text-[10px] font-bold tracking-[0.22em] text-[#ff2d45]"
          style={{ fontFamily: "'Orbitron', sans-serif" }}
        >
          LIVE TICK VOLUME
        </div>
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          <div className="border border-white/10 bg-black/70 p-2">
            <div className="text-[9px] text-neutral-400">M1 TICK VOL</div>
            <div className="mt-0.5 text-sm font-bold text-white">
              {!isFeedReady
                ? 'WAITING'
                : m1VolumeStats.currentVol !== null
                ? m1VolumeStats.currentVol
                : 'NO DATA'}
            </div>
            <div className="mt-0.5 text-[9px] text-neutral-500">
              last closed M1:{' '}
              {m1VolumeStats.lastClosedVol !== null ? m1VolumeStats.lastClosedVol : '--'}
            </div>
          </div>

          <div className="border border-white/10 bg-black/70 p-2">
            <div className="text-[9px] text-neutral-400">PROJ VS 30-BAR AVG</div>
            <div
              className="mt-0.5 text-sm font-bold"
              style={{
                color:
                  m1VolumeStats.projMult !== null && m1VolumeStats.projMult >= 1.5
                    ? '#00e676'
                    : '#f2f4f8',
              }}
            >
              {!isFeedReady
                ? 'WAITING'
                : m1VolumeStats.projMult !== null
                ? `${m1VolumeStats.projMult.toFixed(1)}x`
                : 'NO DATA'}
            </div>
            <div className="mt-0.5 text-[9px] text-neutral-500">
              proj: {m1VolumeStats.projectedVol !== null ? m1VolumeStats.projectedVol : '--'}
            </div>
          </div>

          <div className="border border-white/10 bg-black/70 p-2">
            <div className="text-[9px] text-neutral-400">BUY/SELL est. (60s)</div>
            <div className="mt-0.5 text-xs font-bold">
              {!isFeedReady ? (
                <span className="text-neutral-400">WAITING</span>
              ) : rolling60sFlow.buyPct !== null && rolling60sFlow.sellPct !== null ? (
                <span>
                  <span className="text-[#00e676]">{rolling60sFlow.buyPct}%</span>
                  <span className="text-neutral-500">/</span>
                  <span className="text-[#ff2d45]">{rolling60sFlow.sellPct}%</span>
                </span>
              ) : (
                <span className="text-neutral-400">--</span>
              )}
            </div>
            <div className="mt-0.5 text-[9px] text-neutral-500">
              {rolling60sFlow.tickCount}/20 ticks
            </div>
          </div>

          <div className="border border-white/10 bg-black/70 p-2">
            <div className="text-[9px] text-neutral-400">ZONES COUNT</div>
            <div className="mt-0.5 text-sm font-bold text-[#ff2d45]">
              {isFeedReady ? nearZones.length : 'WAITING'}
            </div>
            <div className="mt-0.5 text-[9px] text-neutral-500">
              total all TFs: {isFeedReady ? allZones.length : '--'}
            </div>
          </div>
        </div>
      </section>

      {/* 4) TIMEFRAME BUTTONS: 1m 3m 5m 15m 30m 1H 4H 1D */}
      <section className="mt-2.5 grid grid-cols-8 gap-1.5">
        {RED_SNIPER_TIMEFRAMES.map((tf) => {
          const active = selectedTf === tf;
          return (
            <button
              key={tf}
              type="button"
              onClick={() => setSelectedTf(tf)}
              className={`cursor-pointer py-2 text-center text-xs font-bold transition-all ${
                active
                  ? 'border border-[#ff2d45] bg-[#ff2d45] text-black shadow-[0_0_14px_rgba(255,45,69,0.5)]'
                  : 'border border-[#ff2d45]/25 bg-[#09090f] text-neutral-300 hover:border-[#ff2d45]/60 hover:text-white'
              }`}
              style={{
                fontFamily: "'Orbitron', sans-serif",
                clipPath: HUD_CLIP_SM,
              }}
            >
              {formatTfLabel(tf)}
            </button>
          );
        })}
      </section>

      {/* 5) CHART (candles, tick-volume bars, zones, BOS/CHoCH, open trade lines) */}
      <section
        className="mt-2.5 overflow-hidden border border-[#ff2d45]/35 bg-[#050508]"
        style={{ clipPath: HUD_CLIP }}
      >
        <div className="flex items-center justify-between border-b border-[#ff2d45]/20 px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] font-bold tracking-[0.18em] text-[#ff2d45]"
              style={{ fontFamily: "'Orbitron', sans-serif" }}
            >
              TACTICAL CHART // {formatTfLabel(selectedTf)}
            </span>
            {isLoading && (
              <span className="text-[10px] font-mono text-neutral-400">SYNCING...</span>
            )}
          </div>
          <div
            className="flex items-center gap-2 text-[10px] font-bold"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            <span className="text-[#00e676]">BULL {currentTfBullCount}</span>
            <span className="text-neutral-500">·</span>
            <span className="text-[#ff2d45]">BEAR {currentTfBearCount}</span>
            <span className="text-neutral-500">·</span>
            <span className="text-neutral-300">
              ATR {currentTfAnalysis ? currentTfAnalysis.atr14.toFixed(2) : '-'}
            </span>
          </div>
        </div>

        <RedSniperChart
          tf={selectedTf}
          candles={currentTfCandles}
          atr14={currentTfAnalysis?.atr14 ?? 2.5}
          zones={currentTfZones}
          structures={currentTfAnalysis?.structures || []}
          openTrades={demoState.openTrades}
          pendingPlan={pendingPlan}
          livePrice={livePrice}
          isConnected={isFeedReady}
        />
      </section>

      {/* 6) AUTO ON/OFF BAR + BOT STATUS LINE */}
      <section
        className="mt-2.5 border border-[#ff2d45]/35 bg-[#07070b] px-3.5 py-2.5"
        style={{ clipPath: HUD_CLIP_SM }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div
              className="text-xs font-extrabold tracking-[0.18em] text-white"
              style={{ fontFamily: "'Orbitron', sans-serif" }}
            >
              AUTO SNIPER EXECUTION
            </div>
            <div
              className="text-[11px] text-neutral-400"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              PWR ≥ 50 · 1.5% RISK · MAX 3 OPEN ({demoState.openTrades.length}/3)
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetDemo}
              className="cursor-pointer border border-white/15 bg-black px-2.5 py-1.5 text-[10px] font-bold tracking-wider text-neutral-400 hover:border-white/40 hover:text-white"
              style={{ fontFamily: "'Orbitron', sans-serif" }}
            >
              RESET
            </button>

            <button
              type="button"
              onClick={handleToggleAuto}
              className={`cursor-pointer px-4 py-1.5 text-xs font-extrabold tracking-[0.18em] transition-all ${
                demoState.autoEnabled
                  ? 'border border-[#00e676] bg-[#00e676]/15 text-[#00e676] shadow-[0_0_14px_rgba(0,230,118,0.3)]'
                  : 'border border-[#ff2d45] bg-[#ff2d45]/15 text-[#ff2d45]'
              }`}
              style={{
                fontFamily: "'Orbitron', sans-serif",
                clipPath: HUD_CLIP_SM,
              }}
            >
              {demoState.autoEnabled ? 'AUTO ON' : 'AUTO OFF'}
            </button>
          </div>
        </div>

        {/* One-line Bot Decision Status updated on every tick */}
        <div
          className="mt-2 border-t border-white/10 pt-1.5 text-[11px] font-semibold text-neutral-300"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          <span className="text-[#ff2d45]">BOT: </span>
          <span>{botStatusLine}</span>
        </div>
      </section>

      {/* 7) TRADE PLAN (open trades, or pending plan for nearest zone) */}
      <section
        className="mt-2.5 border border-[#ff2d45]/35 bg-[#07070b] p-3.5"
        style={{ clipPath: HUD_CLIP }}
      >
        <div className="mb-2.5 flex items-center justify-between border-b border-[#ff2d45]/20 pb-2">
          <span
            className="text-xs font-extrabold tracking-[0.2em] text-[#ff2d45]"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            TRADE PLAN
          </span>
          <span
            className="text-[11px] font-bold text-neutral-300"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {demoState.openTrades.length > 0
              ? `ACTIVE POSITIONS (${demoState.openTrades.length})`
              : 'PENDING NEAREST ZONE'}
          </span>
        </div>

        {!isFeedReady ? (
          <div
            className="py-4 text-center text-xs font-bold tracking-[0.18em] text-[#ff2d45]"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            WAITING FOR LIVE FEED
          </div>
        ) : demoState.openTrades.length > 0 ? (
          <div className="space-y-2.5">
            {demoState.openTrades.map((tr: OpenSniperTrade) => {
              const { totalPnl, currentR } = computeOpenTradeFloatingPnl(tr, livePrice);
              const isBuy = tr.side === 'BUY';
              return (
                <div
                  key={tr.id}
                  className="border border-white/15 bg-black/80 p-3"
                  style={{
                    clipPath: HUD_CLIP_SM,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="px-2 py-0.5 text-xs font-extrabold text-black"
                        style={{ background: isBuy ? '#00e676' : '#ff2d45' }}
                      >
                        {tr.side} {formatTfLabel(tr.tf)}
                      </span>
                      <span className="text-xs font-bold text-neutral-300">
                        {tr.initialLots.toFixed(2)} LOT ({Math.round(tr.remPct * 100)}% OPEN)
                      </span>
                      <span className="text-[11px] text-[#ff2d45]">PWR {tr.power}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleManualCloseTrade(tr.id)}
                      className="cursor-pointer border border-[#ff2d45]/50 bg-[#ff2d45]/10 px-2 py-0.5 text-[10px] font-bold text-[#ff2d45] hover:bg-[#ff2d45] hover:text-black"
                    >
                      CLOSE
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-neutral-500">ENTRY</span>
                      <div className="font-bold text-white">{tr.entry.toFixed(2)}</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-neutral-500">STOP LOSS</span>
                      <div
                        className="font-bold"
                        style={{ color: tr.beMoved ? '#00e5ff' : '#ff2d45' }}
                      >
                        {tr.beMoved ? `BE (${tr.entry.toFixed(2)})` : tr.sl.toFixed(2)}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-neutral-500">LIVE P&amp;L</span>
                      <div
                        className="font-bold"
                        style={{ color: totalPnl >= 0 ? '#00e676' : '#ff2d45' }}
                      >
                        {totalPnl >= 0
                          ? `+$${totalPnl.toFixed(2)}`
                          : `-$${Math.abs(totalPnl).toFixed(2)}`}{' '}
                        ({currentR >= 0 ? `+${currentR.toFixed(2)}R` : `${currentR.toFixed(2)}R`})
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2 border-t border-white/10 pt-2 text-[11px]">
                    <div className={tr.tp1Hit ? 'text-[#00e676] font-bold' : 'text-neutral-300'}>
                      T1 (50%): {tr.tp1.toFixed(2)} {tr.tp1Hit ? '✓' : ''}
                    </div>
                    <div className={tr.tp2Hit ? 'text-[#00e676] font-bold' : 'text-neutral-300'}>
                      T2 (30%): {tr.tp2.toFixed(2)} {tr.tp2Hit ? '✓' : ''}
                    </div>
                    <div className="text-right text-amber-400">
                      T3 (20%): {tr.tp3.toFixed(2)} {tr.tp3IsLiquidity ? '[LIQ]' : '[3R]'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : pendingPlan && livePrice !== null ? (
          <div
            className="border border-white/15 bg-black/80 p-3"
            style={{
              clipPath: HUD_CLIP_SM,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="px-2 py-0.5 text-xs font-extrabold text-black"
                  style={{
                    background: pendingPlan.side === 'BUY' ? '#00e676' : '#ff2d45',
                  }}
                >
                  PENDING {pendingPlan.side} · {formatTfLabel(pendingPlan.zone.tf)}
                </span>
                <span className="text-xs font-bold text-white">
                  {pendingPlan.lots.toFixed(2)} LOT
                </span>
              </div>
              <span className="text-xs font-bold text-[#ff2d45]">
                PWR {pendingPlan.zone.power}
              </span>
            </div>

            <div className="mt-1.5 text-[11px] text-neutral-300">
              ZONE: {pendingPlan.zone.bottom.toFixed(2)} – {pendingPlan.zone.top.toFixed(2)}{' '}
              {livePrice >= pendingPlan.zone.bottom && livePrice <= pendingPlan.zone.top ? (
                <span className="font-bold text-[#00e676]">(INSIDE ZONE)</span>
              ) : livePrice < pendingPlan.zone.bottom ? (
                <span className="text-amber-400">
                  ({pendingPlan.distance.toFixed(1)} pts away — price must rally up into zone)
                </span>
              ) : (
                <span className="text-amber-400">
                  ({pendingPlan.distance.toFixed(1)} pts away — price must drop down into zone)
                </span>
              )}
              {pendingPlan.htfBlocked ? ' · HTF BLOCKED (1H+4H OPPOSE)' : ''}
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
              <div className="border border-white/10 bg-[#07070c] p-2">
                <div className="text-[9px] text-neutral-500">ENTRY</div>
                <div className="font-bold text-white">{pendingPlan.entry.toFixed(2)}</div>
              </div>
              <div className="border border-white/10 bg-[#07070c] p-2">
                <div className="text-[9px] text-neutral-500">STOP LOSS</div>
                <div className="font-bold text-[#ff2d45]">{pendingPlan.sl.toFixed(2)}</div>
              </div>
              <div className="border border-white/10 bg-[#07070c] p-2">
                <div className="text-[9px] text-neutral-500">TP1 (1R · 50%)</div>
                <div className="font-bold text-[#00e676]">{pendingPlan.tp1.toFixed(2)}</div>
              </div>
              <div className="border border-white/10 bg-[#07070c] p-2">
                <div className="text-[9px] text-neutral-500">TP2 (2R · 30%)</div>
                <div className="font-bold text-[#00e676]">{pendingPlan.tp2.toFixed(2)}</div>
              </div>
              <div className="border border-white/10 bg-[#07070c] p-2">
                <div className="text-[9px] text-neutral-500">
                  TP3 ({pendingPlan.tp3IsLiquidity ? 'LIQ' : '3R'} · 20%)
                </div>
                <div className="font-bold text-amber-400">{pendingPlan.tp3.toFixed(2)}</div>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="py-4 text-center text-xs text-neutral-400"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            NO QUALIFYING NEAR ZONES DETECTED
          </div>
        )}
      </section>

      {/* 8) STRONG ZONES ALL TIMEFRAMES (tap = switch TF, SHOW FAR ZONES toggle) */}
      <section
        className="mt-2.5 border border-[#ff2d45]/35 bg-[#07070b] p-3.5"
        style={{ clipPath: HUD_CLIP }}
      >
        <div className="mb-2.5 flex items-center justify-between border-b border-[#ff2d45]/20 pb-2">
          <span
            className="text-xs font-extrabold tracking-[0.2em] text-[#ff2d45]"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            STRONG ZONES // ALL TIMEFRAMES
          </span>
          <button
            type="button"
            onClick={() => setShowFarZones((v) => !v)}
            className={`cursor-pointer border px-2 py-0.5 text-[10px] font-bold tracking-wider transition-colors ${
              showFarZones
                ? 'border-[#ff2d45] bg-[#ff2d45]/20 text-[#ff2d45]'
                : 'border-white/15 bg-black text-neutral-400 hover:border-white/35 hover:text-white'
            }`}
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            SHOW FAR ZONES: {showFarZones ? 'ON' : 'OFF'}
          </button>
        </div>

        {!isFeedReady ? (
          <div
            className="py-4 text-center text-xs font-bold tracking-[0.18em] text-[#ff2d45]"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            WAITING FOR LIVE FEED
          </div>
        ) : sortedStrongZones.length === 0 ? (
          <div
            className="py-4 text-center text-xs text-neutral-400"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            NO NEAR ZONES WITHIN 6×ATR / 1.5%
          </div>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {sortedStrongZones.map((z) => {
              const isBull = z.side === 'BULL';
              const isSelectedTf = z.tf === selectedTf;
              const distPts =
                livePrice !== null ? getZoneDistancePts(z, livePrice) : null;
              const distLabel =
                distPts === null
                  ? '--'
                  : distPts === 0
                  ? 'INSIDE'
                  : `${distPts.toFixed(1)} pts away`;

              return (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => setSelectedTf(z.tf)}
                  className={`w-full cursor-pointer border p-2.5 text-left transition-all ${
                    isSelectedTf
                      ? 'border-[#ff2d45] bg-[#14060a]'
                      : 'border-white/10 bg-black/80 hover:border-[#ff2d45]/50'
                  }`}
                  style={{
                    clipPath: HUD_CLIP_SM,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className="px-1.5 py-0.5 text-[10px] font-extrabold text-black"
                        style={{ background: isBull ? '#00e676' : '#ff2d45' }}
                      >
                        {formatTfLabel(z.tf)} {z.side}
                      </span>
                      <span className="text-xs font-bold text-white">
                        {z.bottom.toFixed(2)} – {z.top.toFixed(2)}
                      </span>
                      <span
                        className={`text-[10px] font-semibold ${
                          distPts === 0 ? 'text-[#00e676]' : 'text-cyan-400'
                        }`}
                      >
                        {distLabel}
                      </span>
                      <span className="text-[10px] text-neutral-400">
                        · {z.status} · {z.pctLeft}% left
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <div className="h-1.5 w-10 bg-white/10">
                        <div
                          className="h-full"
                          style={{
                            width: `${z.power}%`,
                            background: isBull ? '#00e676' : '#ff2d45',
                          }}
                        />
                      </div>
                      <span
                        className="text-xs font-extrabold"
                        style={{ color: isBull ? '#00e676' : '#ff2d45' }}
                      >
                        PWR {z.power}
                      </span>
                    </div>
                  </div>

                  {/* Power breakdown line */}
                  <div className="mt-1 text-[10px] text-neutral-400">{z.breakdown}</div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 9) HISTORICAL PERFORMANCE */}
      <section
        className="mt-2.5 border border-[#ff2d45]/35 bg-[#07070b] p-3.5"
        style={{ clipPath: HUD_CLIP }}
      >
        <div className="mb-3 flex items-center justify-between border-b border-[#ff2d45]/20 pb-2">
          <span
            className="text-xs font-extrabold tracking-[0.2em] text-[#ff2d45]"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            HISTORICAL PERFORMANCE
          </span>
          <span
            className="text-[11px] font-bold text-neutral-300"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            TP2+ WIN RATE
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Donut Chart */}
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
            <svg className="h-20 w-20 -rotate-90" viewBox="0 0 80 80">
              <circle
                cx="40"
                cy="40"
                r={donutRadius}
                fill="transparent"
                stroke="rgba(255, 255, 255, 0.1)"
                strokeWidth="7"
              />
              <circle
                cx="40"
                cy="40"
                r={donutRadius}
                fill="transparent"
                stroke="#00e676"
                strokeWidth="7"
                strokeDasharray={`${winStroke} ${donutCircumference}`}
                strokeLinecap="butt"
              />
            </svg>
            <div
              className="absolute inset-0 flex flex-col items-center justify-center text-center"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              <span className="text-sm font-extrabold text-white">
                {perf.tp2WinRatePct}%
              </span>
              <span className="text-[8px] text-neutral-400">TP2 WIN</span>
            </div>
          </div>

          {/* Core Stats Grid */}
          <div
            className="grid flex-1 grid-cols-3 gap-2 text-xs"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            <div className="border border-white/10 bg-black/70 p-2">
              <div className="text-[9px] text-neutral-500">TRADES</div>
              <div className="font-bold text-white">{perf.totalTrades}</div>
            </div>
            <div className="border border-white/10 bg-black/70 p-2">
              <div className="text-[9px] text-neutral-500">W / L / BE</div>
              <div className="font-bold text-white">
                <span className="text-[#00e676]">{perf.wins}</span>/
                <span className="text-[#ff2d45]">{perf.losses}</span>/
                <span className="text-amber-400">{perf.beCount}</span>
              </div>
            </div>
            <div className="border border-white/10 bg-black/70 p-2">
              <div className="text-[9px] text-neutral-500">EXPECTANCY</div>
              <div
                className="font-bold"
                style={{ color: perf.expectancyR >= 0 ? '#00e676' : '#ff2d45' }}
              >
                {perf.expectancyR >= 0
                  ? `+${perf.expectancyR.toFixed(2)}R`
                  : `${perf.expectancyR.toFixed(2)}R`}
              </div>
            </div>
            <div className="border border-white/10 bg-black/70 p-2">
              <div className="text-[9px] text-neutral-500">BE %</div>
              <div className="font-bold text-amber-400">{perf.bePct}%</div>
            </div>
            <div className="border border-white/10 bg-black/70 p-2">
              <div className="text-[9px] text-neutral-500">LOSS %</div>
              <div className="font-bold text-[#ff2d45]">{perf.lossPct}%</div>
            </div>
            <div className="border border-white/10 bg-black/70 p-2">
              <div className="text-[9px] text-neutral-500">CONFIDENCE</div>
              <div className="truncate font-bold text-[#ff2d45]">
                {perf.confidenceLabel}
              </div>
            </div>
          </div>
        </div>

        {/* Per-Session R */}
        <div
          className="mt-3 grid grid-cols-4 gap-2 text-center text-xs"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {(['TOKYO', 'LONDON', 'NEW YORK', 'LDN+NY'] as const).map((sKey) => {
            const rVal = perf.sessionR[sKey];
            return (
              <div key={sKey} className="border border-white/10 bg-black/60 py-1.5">
                <div className="text-[9px] text-neutral-400">{sKey}</div>
                <div
                  className="font-bold"
                  style={{
                    color: rVal > 0 ? '#00e676' : rVal < 0 ? '#ff2d45' : '#94a3b8',
                  }}
                >
                  {rVal > 0 ? `+${rVal.toFixed(2)}R` : `${rVal.toFixed(2)}R`}
                </div>
              </div>
            );
          })}
        </div>

        {/* Confidence Bar */}
        <div className="mt-3">
          <div
            className="mb-1 flex items-center justify-between text-[10px]"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            <span className="text-neutral-400">SYSTEM CONFIDENCE</span>
            <span className="font-bold text-[#ff2d45]">{perf.confidenceLabel}</span>
          </div>
          <div className="h-2 w-full bg-white/10">
            <div
              className="h-full transition-all"
              style={{
                width: `${perf.confidencePct}%`,
                background:
                  perf.confidenceLabel === 'ELITE' || perf.confidenceLabel === 'STRONG'
                    ? '#00e676'
                    : perf.confidenceLabel === 'GOOD' || perf.confidenceLabel === 'NEUTRAL'
                    ? '#ffab00'
                    : '#ff2d45',
              }}
            />
          </div>
        </div>
      </section>

      {/* 10) SESSIONS CARD (Tokyo/London/New York OPEN/CLOSED + window label) */}
      <section
        className="mt-2.5 border border-[#ff2d45]/35 bg-[#07070b] p-3.5"
        style={{ clipPath: HUD_CLIP }}
      >
        <div className="mb-2.5 flex items-center justify-between border-b border-[#ff2d45]/20 pb-2">
          <span
            className="text-xs font-extrabold tracking-[0.2em] text-[#ff2d45]"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            SESSIONS
          </span>
          <span
            className="text-[11px] font-bold text-amber-400"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {session.window}
          </span>
        </div>

        <div
          className="grid grid-cols-3 gap-2 text-center text-xs"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {[
            { name: 'TOKYO', open: session.tokyo, hours: '09:00-18:00 JST' },
            { name: 'LONDON', open: session.london, hours: '08:00-16:30 LDN' },
            { name: 'NEW YORK', open: session.newYork, hours: '08:00-17:00 NY' },
          ].map((s) => (
            <div
              key={s.name}
              className="border p-2.5"
              style={{
                borderColor: s.open
                  ? 'rgba(0, 230, 118, 0.45)'
                  : 'rgba(255, 255, 255, 0.1)',
                background: s.open
                  ? 'rgba(0, 230, 118, 0.08)'
                  : 'rgba(0, 0, 0, 0.7)',
                clipPath: HUD_CLIP_SM,
              }}
            >
              <div
                className="text-[10px] font-bold text-white"
                style={{ fontFamily: "'Orbitron', sans-serif" }}
              >
                {s.name}
              </div>
              <div
                className="mt-1 text-xs font-extrabold"
                style={{ color: s.open ? '#00e676' : '#64748b' }}
              >
                {s.open ? 'OPEN' : 'CLOSED'}
              </div>
              <div className="mt-0.5 text-[9px] text-neutral-500">{s.hours}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 11) TRADE HISTORY */}
      <section
        className="mt-2.5 border border-[#ff2d45]/35 bg-[#07070b] p-3.5"
        style={{ clipPath: HUD_CLIP }}
      >
        <div className="mb-2.5 flex items-center justify-between border-b border-[#ff2d45]/20 pb-2">
          <span
            className="text-xs font-extrabold tracking-[0.2em] text-[#ff2d45]"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            TRADE HISTORY
          </span>
          <span
            className="text-[11px] text-neutral-400"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {demoState.closedTrades.length} LOGGED
          </span>
        </div>

        {demoState.closedTrades.length === 0 ? (
          <div
            className="py-4 text-center text-xs text-neutral-400"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            NO CLOSED TRADES YET
          </div>
        ) : (
          <div
            className="max-h-72 space-y-2 overflow-y-auto pr-1 text-xs"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {demoState.closedTrades.map((t) => {
              const timeStr = new Date(t.time).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });
              const badgeColor =
                t.class === 'win'
                  ? '#00e676'
                  : t.class === 'be'
                  ? '#ffab00'
                  : '#ff2d45';
              return (
                <div
                  key={t.id}
                  className="border border-white/10 bg-black/80 p-2.5"
                  style={{ clipPath: HUD_CLIP_SM }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-black"
                        style={{ background: badgeColor }}
                      >
                        {t.class.toUpperCase()} · {t.result}
                      </span>
                      <span className="font-bold text-white">
                        {t.side} {formatTfLabel(t.tf)}
                      </span>
                      <span className="text-[10px] text-neutral-400">
                        PWR {t.power} · {t.session}
                      </span>
                    </div>
                    <span className="text-[10px] text-neutral-500">{timeStr}</span>
                  </div>

                  <div className="mt-1.5 flex items-center justify-between text-[11px]">
                    <span className="text-neutral-300">
                      {t.entry.toFixed(2)} → {t.exit.toFixed(2)}
                    </span>
                    <span className="font-bold" style={{ color: badgeColor }}>
                      {t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`}{' '}
                      ({t.r >= 0 ? `+${t.r.toFixed(2)}R` : `${t.r.toFixed(2)}R`})
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default RedSniperPage;
