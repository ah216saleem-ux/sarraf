import React, { useState } from 'react';
import type { BlackstonePlanPayload } from '../server/blackstonePlanEngine';
import type { BlackstoneEvaluatedZone, BlackstoneZoneId } from '../server/blackstoneEngine';

type LivePlanPhase = BlackstonePlanPayload['phase'];

interface BlackstoneLivePlanCardProps {
  plan: BlackstonePlanPayload | null | undefined;
  zones: BlackstoneEvaluatedZone[];
  livePrice: number | null;
  onPinZone: (mode: 'AUTO' | 'MANUAL', zoneId?: BlackstoneZoneId | null) => void;
  onSelectChartZone?: (id: BlackstoneZoneId) => void;
}

const ALL_PHASES: LivePlanPhase[] = [
  'WATCHING',
  'APPROACHING',
  'IN ZONE',
  'TRADE LIVE',
  'PAUSED',
];

const novaCardStyle: React.CSSProperties = {
  backgroundColor: 'rgba(18, 22, 34, 0.72)',
  border: '1px solid rgba(140, 160, 255, 0.14)',
  fontFamily: "'Sora', sans-serif",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

export const BlackstoneLivePlanCard: React.FC<BlackstoneLivePlanCardProps> = ({
  plan,
  zones,
  livePrice,
  onPinZone,
  onSelectChartZone,
}) => {
  const [manualZoneSelect, setManualZoneSelect] = useState<string>('');

  if (!plan) {
    return (
      <div
        className="rounded-[18px] p-5 text-sm backdrop-blur-md"
        style={{ ...novaCardStyle, color: '#8d97b8' }}
      >
        Initializing Live Plan engine on Ahmad server...
      </div>
    );
  }

  const {
    phase,
    phaseDescription,
    mode,
    pinnedZoneId,
    targetZone,
    transitionMessage,
    stopDistanceDollars,
    plannedTrade,
    gates,
    nearestZones,
    activeTrade,
    todaySignals,
    tradesToday,
    maxTrades,
    stopsToday,
    maxStops,
    pauseReason,
  } = plan;

  const isTradeLive = Boolean(activeTrade && activeTrade.status === 'ACTIVE');
  const currentPrice = livePrice ?? plannedTrade?.plannedEntry ?? null;

  // Calculate rail positions (from Stop Loss to TP3)
  const tradeSide = activeTrade ? activeTrade.side : plannedTrade?.side ?? 'BUY';
  const isBuy = tradeSide === 'BUY';

  const stopPrice = activeTrade
    ? activeTrade.currentStopLoss
    : plannedTrade
      ? plannedTrade.stopLoss
      : null;
  const entryPrice = activeTrade
    ? activeTrade.entryPrice
    : plannedTrade
      ? plannedTrade.plannedEntry
      : null;
  const tp1Price = activeTrade
    ? activeTrade.tp1.price
    : plannedTrade
      ? plannedTrade.tp1
      : null;
  const tp2Price = activeTrade
    ? activeTrade.tp2.price
    : plannedTrade
      ? plannedTrade.tp2
      : null;
  const tp3Price = activeTrade
    ? activeTrade.tp3.price
    : plannedTrade
      ? plannedTrade.tp3
      : null;

  // Rail normalization: left (0%) = Stop Loss, right (100%) = TP3
  let progressPct = 0;
  if (stopPrice !== null && tp3Price !== null && currentPrice !== null) {
    const totalSpan = Math.abs(tp3Price - stopPrice);
    if (totalSpan > 0) {
      const distanceFromStop = isBuy
        ? currentPrice - stopPrice
        : stopPrice - currentPrice;
      progressPct = Math.max(0, Math.min(100, (distanceFromStop / totalSpan) * 100));
    }
  }

  const getStationPct = (price: number | null): number => {
    if (price === null || stopPrice === null || tp3Price === null) return 0;
    const totalSpan = Math.abs(tp3Price - stopPrice);
    if (totalSpan === 0) return 0;
    const dist = isBuy ? price - stopPrice : stopPrice - price;
    return Math.max(0, Math.min(100, (dist / totalSpan) * 100));
  };

  const entryPct = getStationPct(entryPrice);
  const tp1Pct = getStationPct(tp1Price);
  const tp2Pct = getStationPct(tp2Price);

  // Live P&L display
  const pnlDollars = activeTrade ? activeTrade.totalPnlDollars : 0;
  const pnlR = activeTrade ? activeTrade.totalPnlR : 0;
  const isProfit = pnlDollars > 0;
  const isLoss = pnlDollars < 0;

  // Target zone distance formatting
  const matchedZone = targetZone
    ? zones.find((z) => z.id === targetZone.id)
    : null;
  const targetDistanceStr = matchedZone
    ? matchedZone.distanceFormatted
    : targetZone && livePrice !== null
      ? `${targetZone.level >= livePrice ? '+' : '-'}$${Math.abs(targetZone.level - livePrice).toFixed(2)}`
      : '—';

  const getPhaseChipStyle = (p: LivePlanPhase, isActive: boolean): React.CSSProperties => {
    if (!isActive) {
      return {
        backgroundColor: 'rgba(7, 9, 15, 0.5)',
        border: '1px solid rgba(140, 160, 255, 0.14)',
        color: '#8d97b8',
      };
    }
    if (p === 'PAUSED') {
      return {
        backgroundColor: 'rgba(255, 107, 127, 0.18)',
        border: '1px solid #ff6b7f',
        color: '#ff6b7f',
        boxShadow: '0 0 16px rgba(255, 107, 127, 0.45)',
      };
    }
    if (p === 'TRADE LIVE') {
      return {
        backgroundColor: 'rgba(77, 240, 180, 0.18)',
        border: '1px solid #4df0b4',
        color: '#4df0b4',
        boxShadow: '0 0 16px rgba(77, 240, 180, 0.45)',
      };
    }
    return {
      backgroundColor: 'rgba(82, 227, 255, 0.18)',
      border: '1px solid #52e3ff',
      color: '#52e3ff',
      boxShadow: '0 0 16px rgba(82, 227, 255, 0.45)',
    };
  };

  // Moves in dollars for Trade Plan Table
  const slMoveStr =
    entryPrice !== null && stopPrice !== null
      ? `${isBuy ? '-' : '+'}$${Math.abs(entryPrice - stopPrice).toFixed(2)}`
      : `-$${stopDistanceDollars.toFixed(2)}`;
  const tp1MoveStr =
    entryPrice !== null && tp1Price !== null
      ? `${isBuy ? '+' : '-'}$${Math.abs(tp1Price - entryPrice).toFixed(2)}`
      : '+$10.00';
  const tp2MoveStr =
    entryPrice !== null && tp2Price !== null
      ? `${isBuy ? '+' : '-'}$${Math.abs(tp2Price - entryPrice).toFixed(2)}`
      : '+$17.00';
  const tp3MoveStr =
    entryPrice !== null && tp3Price !== null
      ? `${isBuy ? '+' : '-'}$${Math.abs(tp3Price - entryPrice).toFixed(2)}`
      : '+$25.00';

  return (
    <div className="space-y-4" style={{ fontFamily: "'Sora', sans-serif" }}>
      <style>{`
        @keyframes novaScanLine {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
        .nova-scan-bar {
          animation: novaScanLine 3.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .nova-scan-bar {
            animation: none !important;
            display: none !important;
          }
        }
      `}</style>

      {/* 1. LIVE PLAN CARD */}
      <div
        className="relative overflow-hidden rounded-[18px] p-4 sm:p-5 space-y-4 backdrop-blur-md"
        style={novaCardStyle}
      >
        {/* Thin cyan line scanning across the card top while the engine runs (off with prefers-reduced-motion) */}
        {phase !== 'PAUSED' && (
          <div className="pointer-events-none absolute top-0 left-0 right-0 h-[2px] overflow-hidden motion-reduce:hidden">
            <div
              className="nova-scan-bar h-full w-2/5"
              style={{
                background:
                  'linear-gradient(90deg, transparent, #52e3ff, rgba(82, 227, 255, 0.9), transparent)',
              }}
            />
          </div>
        )}

        {/* Top Row: Title + Auto-follow / Manual pin switch */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
              LIVE PLAN
            </h2>
            <p className="text-xs text-[#8d97b8] mt-0.5">{phaseDescription}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex items-center gap-1 rounded-[10px] p-1"
              style={{
                backgroundColor: 'rgba(7, 9, 15, 0.65)',
                border: '1px solid rgba(140, 160, 255, 0.14)',
              }}
            >
              <button
                type="button"
                onClick={() => onPinZone('AUTO')}
                className={`px-2.5 py-1 rounded-[7px] text-xs font-semibold transition-all cursor-pointer ${
                  mode === 'AUTO'
                    ? 'bg-[#52e3ff] text-[#07090f] font-bold shadow-[0_0_10px_rgba(82,227,255,0.3)]'
                    : 'text-[#8d97b8] hover:text-[#e9edff]'
                }`}
              >
                Auto-follow
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetId =
                    manualZoneSelect || (targetZone ? targetZone.id : zones[0]?.id);
                  onPinZone('MANUAL', targetId);
                }}
                className={`px-2.5 py-1 rounded-[7px] text-xs font-semibold transition-all cursor-pointer ${
                  mode === 'MANUAL'
                    ? 'bg-[#52e3ff] text-[#07090f] font-bold shadow-[0_0_10px_rgba(82,227,255,0.3)]'
                    : 'text-[#8d97b8] hover:text-[#e9edff]'
                }`}
              >
                Manual pin
              </button>
            </div>

            {mode === 'MANUAL' && (
              <select
                value={pinnedZoneId || ''}
                onChange={(e) => {
                  setManualZoneSelect(e.target.value);
                  onPinZone('MANUAL', e.target.value);
                }}
                className="rounded-[9px] px-2.5 py-1.5 text-xs text-[#e9edff] focus:outline-none"
                style={{
                  backgroundColor: 'rgba(7, 9, 15, 0.85)',
                  border: '1px solid rgba(82, 227, 255, 0.4)',
                }}
              >
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} ({z.level.toFixed(2)}) · {z.side}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Phase chips: WATCHING, APPROACHING, IN ZONE, TRADE LIVE, PAUSED with active glowing */}
        <div className="flex flex-wrap items-center gap-1.5">
          {ALL_PHASES.map((p) => {
            const isActive = phase === p;
            return (
              <span
                key={p}
                className={`px-2.5 py-1 rounded-[8px] text-[11px] font-bold uppercase tracking-wider transition-all ${
                  isActive ? 'scale-[1.02]' : 'opacity-70'
                }`}
                style={getPhaseChipStyle(p, isActive)}
              >
                {p}
              </span>
            );
          })}
        </div>

        {/* Pause reason banner when paused */}
        {pauseReason && (
          <div
            className="rounded-[12px] px-3.5 py-2.5 text-xs flex items-center gap-2"
            style={{
              backgroundColor: 'rgba(255, 107, 127, 0.14)',
              border: '1px solid rgba(255, 107, 127, 0.45)',
              color: '#ff6b7f',
            }}
          >
            <span className="w-2 h-2 rounded-full bg-[#ff6b7f] shrink-0" />
            <span className="font-semibold">{pauseReason}</span>
          </div>
        )}

        {/* Transition Notice Banner */}
        {transitionMessage && (
          <div
            className="rounded-[12px] px-3.5 py-2 text-xs flex items-center justify-between gap-2"
            style={{
              backgroundColor: 'rgba(82, 227, 255, 0.10)',
              border: '1px solid rgba(82, 227, 255, 0.35)',
              color: '#e9edff',
            }}
          >
            <span className="font-semibold text-[#52e3ff]">{transitionMessage}</span>
            <span className="text-[11px] text-[#8d97b8]">Flipped to retest</span>
          </div>
        )}

        {/* Target zone, range, distance + Daily trade & stop counters */}
        <div
          className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3"
          style={{ borderTop: '1px solid rgba(140, 160, 255, 0.14)' }}
        >
          {/* Target Zone info */}
          <div
            className="rounded-[12px] p-3 space-y-1"
            style={{
              backgroundColor: 'rgba(7, 9, 15, 0.55)',
              border: '1px solid rgba(140, 160, 255, 0.12)',
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase font-semibold text-[#8d97b8]">
                Target zone
              </span>
              {targetZone && (
                <span
                  className="text-[11px] font-semibold"
                  style={{
                    color: targetZone.side === 'buy side' ? '#4df0b4' : '#ff6b7f',
                  }}
                >
                  {targetZone.side}
                </span>
              )}
            </div>
            {targetZone ? (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectChartZone?.(targetZone.id)}
                    className="text-sm font-bold text-[#e9edff] hover:text-[#52e3ff] transition-colors cursor-pointer text-left"
                  >
                    {targetZone.name}
                  </button>
                  <span
                    className="text-xs font-bold text-[#52e3ff] tabular-nums"
                    style={monoStyle}
                  >
                    {targetDistanceStr}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-[#8d97b8]">
                  <span>Range</span>
                  <span
                    className="text-[#e9edff] font-semibold tabular-nums"
                    style={monoStyle}
                  >
                    {targetZone.low.toFixed(2)} – {targetZone.high.toFixed(2)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-[#8d97b8] py-1">
                No active zone in range
              </div>
            )}
          </div>

          {/* Daily Counters: "Trades today X of 4" and "Stops today X of 3" */}
          <div
            className="rounded-[12px] p-3 flex flex-col justify-between gap-2"
            style={{
              backgroundColor: 'rgba(7, 9, 15, 0.55)',
              border: '1px solid rgba(140, 160, 255, 0.12)',
            }}
          >
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8d97b8]">Trades today</span>
              <span
                className="font-bold text-[#e9edff] tabular-nums"
                style={monoStyle}
              >
                Trades today {tradesToday ?? todaySignals.length} of {maxTrades ?? 4}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8d97b8]">Stops today</span>
              <span
                className={`font-bold tabular-nums ${
                  (stopsToday ?? 0) >= (maxStops ?? 3)
                    ? 'text-[#ff6b7f]'
                    : 'text-[#e9edff]'
                }`}
                style={monoStyle}
              >
                Stops today {stopsToday ?? 0} of {maxStops ?? 3}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. TRADE RAIL CARD */}
      <div
        className={`rounded-[18px] p-4 sm:p-5 space-y-4 backdrop-blur-md transition-opacity ${
          isTradeLive ? 'opacity-100' : 'opacity-55'
        }`}
        style={novaCardStyle}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
              TRADE RAIL
            </h3>
            {!isTradeLive ? (
              <span
                className="px-2.5 py-0.5 rounded-[7px] text-[11px] font-bold"
                style={{
                  backgroundColor: 'rgba(140, 160, 255, 0.12)',
                  border: '1px solid rgba(140, 160, 255, 0.24)',
                  color: '#8d97b8',
                }}
              >
                PREVIEW, no trade
              </span>
            ) : (
              <span
                className="px-2.5 py-0.5 rounded-[7px] text-[11px] font-bold uppercase"
                style={{
                  backgroundColor: isBuy
                    ? 'rgba(77, 240, 180, 0.18)'
                    : 'rgba(255, 107, 127, 0.18)',
                  border: `1px solid ${isBuy ? '#4df0b4' : '#ff6b7f'}`,
                  color: isBuy ? '#4df0b4' : '#ff6b7f',
                }}
              >
                {tradeSide} · LIVE
              </span>
            )}
          </div>

          {/* Open result in dollars and R when live */}
          {isTradeLive ? (
            <div
              className="flex items-center gap-2 rounded-[9px] px-3 py-1"
              style={{
                backgroundColor: 'rgba(7, 9, 15, 0.75)',
                border: '1px solid rgba(140, 160, 255, 0.18)',
              }}
            >
              <span className="text-[11px] text-[#8d97b8]">Open result</span>
              <span
                className={`text-sm font-bold tabular-nums ${
                  isProfit
                    ? 'text-[#4df0b4]'
                    : isLoss
                      ? 'text-[#ff6b7f]'
                      : 'text-[#e9edff]'
                }`}
                style={monoStyle}
              >
                {pnlDollars >= 0 ? '+' : ''}${pnlDollars.toFixed(2)} (
                {pnlR >= 0 ? '+' : ''}
                {pnlR.toFixed(2)} R)
              </span>
            </div>
          ) : (
            <span className="text-xs text-[#8d97b8]">
              PREVIEW, no trade
            </span>
          )}
        </div>

        {/* Rail Track */}
        <div className="relative pt-7 pb-6 px-3">
          <div
            className="h-2 w-full rounded-full relative overflow-hidden"
            style={{ backgroundColor: 'rgba(7, 9, 15, 0.85)' }}
          >
            {isTradeLive && (
              <div
                className="h-full transition-all duration-300"
                style={{
                  width: `${progressPct}%`,
                  backgroundColor: isLoss ? '#ff6b7f' : '#4df0b4',
                }}
              />
            )}
          </div>

          {/* Stop Loss Station (0%) */}
          <div className="absolute top-1/2 -translate-y-1/2 left-3 -translate-x-1/2 flex flex-col items-center">
            <div
              className="w-3.5 h-3.5 rounded-full border-2"
              style={{
                backgroundColor: '#ff6b7f',
                borderColor: '#07090f',
              }}
            />
            <span className="text-[10px] font-bold text-[#ff6b7f] uppercase mt-1.5">
              {activeTrade?.beMoved ? 'BE' : 'SL'}
            </span>
            <span
              className="text-[10px] text-[#8d97b8] tabular-nums"
              style={monoStyle}
            >
              {stopPrice !== null ? stopPrice.toFixed(2) : '—'}
            </span>
          </div>

          {/* Entry Station */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center"
            style={{ left: `calc(0.75rem + (100% - 1.5rem) * ${entryPct / 100})` }}
          >
            <div
              className="w-3 h-3 rounded-full border-2"
              style={{
                backgroundColor: '#e9edff',
                borderColor: '#07090f',
              }}
            />
            <span className="text-[10px] font-semibold text-[#e9edff] uppercase mt-1.5">
              Entry
            </span>
            <span
              className="text-[10px] text-[#8d97b8] tabular-nums"
              style={monoStyle}
            >
              {entryPrice !== null ? entryPrice.toFixed(2) : '—'}
            </span>
          </div>

          {/* TP1 Station */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center"
            style={{ left: `calc(0.75rem + (100% - 1.5rem) * ${tp1Pct / 100})` }}
          >
            <div
              className="w-3 h-3 rounded-full border-2"
              style={{
                backgroundColor: activeTrade?.tp1.hit ? '#4df0b4' : '#2a5c4e',
                borderColor: '#07090f',
              }}
            />
            <span className="text-[10px] font-bold text-[#4df0b4] uppercase mt-1.5">
              TP1
            </span>
            <span
              className="text-[10px] text-[#8d97b8] tabular-nums"
              style={monoStyle}
            >
              {tp1Price !== null ? tp1Price.toFixed(2) : '—'}
            </span>
          </div>

          {/* TP2 Station */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center"
            style={{ left: `calc(0.75rem + (100% - 1.5rem) * ${tp2Pct / 100})` }}
          >
            <div
              className="w-3 h-3 rounded-full border-2"
              style={{
                backgroundColor: activeTrade?.tp2.hit ? '#4df0b4' : '#2a5c4e',
                borderColor: '#07090f',
              }}
            />
            <span className="text-[10px] font-bold text-[#4df0b4] uppercase mt-1.5">
              TP2
            </span>
            <span
              className="text-[10px] text-[#8d97b8] tabular-nums"
              style={monoStyle}
            >
              {tp2Price !== null ? tp2Price.toFixed(2) : '—'}
            </span>
          </div>

          {/* TP3 Station (100%) */}
          <div className="absolute top-1/2 -translate-y-1/2 right-3 translate-x-1/2 flex flex-col items-center">
            <div
              className="w-3.5 h-3.5 rounded-full border-2"
              style={{
                backgroundColor: activeTrade?.tp3.hit ? '#52e3ff' : '#265c6b',
                borderColor: '#07090f',
              }}
            />
            <span className="text-[10px] font-bold text-[#52e3ff] uppercase mt-1.5">
              TP3
            </span>
            <span
              className="text-[10px] text-[#8d97b8] tabular-nums"
              style={monoStyle}
            >
              {tp3Price !== null ? tp3Price.toFixed(2) : '—'}
            </span>
          </div>

          {/* Live Marker (only pulses when trade is LIVE) */}
          {isTradeLive && currentPrice !== null && stopPrice !== null && tp3Price !== null && (
            <div
              className="absolute top-0 -translate-x-1/2 flex flex-col items-center z-10 transition-all duration-200"
              style={{
                left: `calc(0.75rem + (100% - 1.5rem) * ${progressPct / 100})`,
              }}
            >
              <div
                className="px-2 py-0.5 rounded text-[10px] font-bold tabular-nums flex items-center gap-1"
                style={{
                  backgroundColor: '#52e3ff',
                  color: '#07090f',
                  ...monoStyle,
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#07090f] animate-ping" />
                <span>{currentPrice.toFixed(2)}</span>
              </div>
              <div className="w-3 h-3 rounded-full bg-[#52e3ff] ring-4 ring-[#52e3ff]/35 animate-pulse mt-1" />
            </div>
          )}
        </div>

        {/* TP1 / TP2 / TP3 Chips */}
        <div
          className="grid grid-cols-3 gap-2 pt-2"
          style={{ borderTop: '1px solid rgba(140, 160, 255, 0.14)' }}
        >
          {[
            {
              label: 'TP1',
              price: tp1Price,
              hit: Boolean(activeTrade?.tp1.hit),
            },
            {
              label: 'TP2',
              price: tp2Price,
              hit: Boolean(activeTrade?.tp2.hit),
            },
            {
              label: 'TP3',
              price: tp3Price,
              hit: Boolean(activeTrade?.tp3.hit),
            },
          ].map((tp) => (
            <div
              key={tp.label}
              className="rounded-[10px] px-2.5 py-2 flex items-center justify-between gap-1 text-xs"
              style={
                tp.hit
                  ? {
                      backgroundColor: 'rgba(77, 240, 180, 0.2)',
                      border: '1px solid #4df0b4',
                      color: '#4df0b4',
                      boxShadow: '0 0 12px rgba(77, 240, 180, 0.25)',
                    }
                  : {
                      backgroundColor: 'rgba(7, 9, 15, 0.55)',
                      border: '1px solid rgba(140, 160, 255, 0.12)',
                      color: '#8d97b8',
                    }
              }
            >
              <span className="font-bold">{tp.label}</span>
              <span
                className="font-semibold tabular-nums text-[#e9edff]"
                style={monoStyle}
              >
                {tp.price !== null ? tp.price.toFixed(2) : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 3. TRADE PLAN TABLE: Entry, Stop loss, TP1, TP2, TP3 with price, move in dollars, size 1/3 */}
      <div
        className="rounded-[18px] p-4 sm:p-5 space-y-3 backdrop-blur-md"
        style={novaCardStyle}
      >
        <div
          className="flex flex-wrap items-center justify-between gap-2 pb-2.5"
          style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
        >
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
            TRADE PLAN TABLE
          </h3>

          {/* Header chip "PREVIEW · NO TRADE" or "SELL · LIVE" / "BUY · LIVE" */}
          {isTradeLive ? (
            <span
              className="px-2.5 py-0.5 rounded-[7px] text-[11px] font-bold uppercase"
              style={{
                backgroundColor: isBuy
                  ? 'rgba(77, 240, 180, 0.18)'
                  : 'rgba(255, 107, 127, 0.18)',
                border: `1px solid ${isBuy ? '#4df0b4' : '#ff6b7f'}`,
                color: isBuy ? '#4df0b4' : '#ff6b7f',
              }}
            >
              {tradeSide} · LIVE
            </span>
          ) : (
            <span
              className="px-2.5 py-0.5 rounded-[7px] text-[11px] font-bold uppercase"
              style={{
                backgroundColor: 'rgba(140, 160, 255, 0.10)',
                border: '1px solid rgba(140, 160, 255, 0.22)',
                color: '#8d97b8',
              }}
            >
              PREVIEW · NO TRADE
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr
                className="text-[11px] text-[#8d97b8]"
                style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.12)' }}
              >
                <th className="py-2 font-semibold">Station</th>
                <th className="py-2 font-semibold">Price</th>
                <th className="py-2 font-semibold">Move ($)</th>
                <th className="py-2 font-semibold text-right">Size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(140,160,255,0.08)]">
              {/* Entry */}
              <tr>
                <td className="py-2.5 font-semibold text-[#e9edff]">
                  Entry ({tradeSide})
                </td>
                <td
                  className="py-2.5 font-bold text-[#e9edff] tabular-nums"
                  style={monoStyle}
                >
                  {entryPrice !== null ? entryPrice.toFixed(2) : '—'}
                </td>
                <td
                  className="py-2.5 text-[#8d97b8] tabular-nums"
                  style={monoStyle}
                >
                  $0.00
                </td>
                <td
                  className="py-2.5 text-right text-[#8d97b8] tabular-nums"
                  style={monoStyle}
                >
                  Full
                </td>
              </tr>

              {/* Stop loss */}
              <tr>
                <td className="py-2.5 font-semibold text-[#ff6b7f]">
                  Stop loss {activeTrade?.beMoved ? '(BE)' : ''}
                </td>
                <td
                  className="py-2.5 font-bold text-[#e9edff] tabular-nums"
                  style={monoStyle}
                >
                  {stopPrice !== null ? stopPrice.toFixed(2) : '—'}
                </td>
                <td
                  className="py-2.5 text-[#ff6b7f] font-semibold tabular-nums"
                  style={monoStyle}
                >
                  {slMoveStr}
                </td>
                <td
                  className="py-2.5 text-right text-[#8d97b8] tabular-nums"
                  style={monoStyle}
                >
                  Full
                </td>
              </tr>

              {/* TP1 */}
              <tr>
                <td className="py-2.5 font-semibold text-[#4df0b4]">TP1</td>
                <td
                  className="py-2.5 font-bold text-[#e9edff] tabular-nums"
                  style={monoStyle}
                >
                  {tp1Price !== null ? tp1Price.toFixed(2) : '—'}
                </td>
                <td
                  className="py-2.5 text-[#4df0b4] font-semibold tabular-nums"
                  style={monoStyle}
                >
                  {tp1MoveStr}
                </td>
                <td
                  className="py-2.5 text-right text-[#e9edff] font-semibold tabular-nums"
                  style={monoStyle}
                >
                  1/3
                </td>
              </tr>

              {/* TP2 */}
              <tr>
                <td className="py-2.5 font-semibold text-[#4df0b4]">TP2</td>
                <td
                  className="py-2.5 font-bold text-[#e9edff] tabular-nums"
                  style={monoStyle}
                >
                  {tp2Price !== null ? tp2Price.toFixed(2) : '—'}
                </td>
                <td
                  className="py-2.5 text-[#4df0b4] font-semibold tabular-nums"
                  style={monoStyle}
                >
                  {tp2MoveStr}
                </td>
                <td
                  className="py-2.5 text-right text-[#e9edff] font-semibold tabular-nums"
                  style={monoStyle}
                >
                  1/3
                </td>
              </tr>

              {/* TP3 */}
              <tr>
                <td className="py-2.5 font-semibold text-[#52e3ff]">
                  TP3 {plannedTrade?.tp3Capped ? '(Capped)' : ''}
                </td>
                <td
                  className="py-2.5 font-bold text-[#e9edff] tabular-nums"
                  style={monoStyle}
                >
                  {tp3Price !== null ? tp3Price.toFixed(2) : '—'}
                </td>
                <td
                  className="py-2.5 text-[#52e3ff] font-semibold tabular-nums"
                  style={monoStyle}
                >
                  {tp3MoveStr}
                </td>
                <td
                  className="py-2.5 text-right text-[#e9edff] font-semibold tabular-nums"
                  style={monoStyle}
                >
                  1/3
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. ENTRY GATES: 2x2 grid, PASS or WAIT with the real measured value */}
      <div
        className="rounded-[18px] p-4 sm:p-5 space-y-3 backdrop-blur-md"
        style={novaCardStyle}
      >
        <div
          className="flex items-center justify-between gap-2 pb-2.5"
          style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
        >
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
            ENTRY GATES
          </h3>
          <span
            className="px-2 py-0.5 rounded-[6px] text-[10px] font-bold uppercase"
            style={
              gates.allPassed
                ? {
                    backgroundColor: 'rgba(77, 240, 180, 0.18)',
                    border: '1px solid #4df0b4',
                    color: '#4df0b4',
                  }
                : {
                    backgroundColor: 'rgba(140, 160, 255, 0.10)',
                    border: '1px solid rgba(140, 160, 255, 0.2)',
                    color: '#8d97b8',
                  }
            }
          >
            {gates.allPassed ? 'ALL 4 PASS' : 'WAITING'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {[
            { title: 'Zone Integrity', gate: gates.gate1 },
            { title: 'Reaction', gate: gates.gate2 },
            { title: 'Close Confirm', gate: gates.gate3 },
            { title: 'Room to Run', gate: gates.gate4 },
          ].map(({ title, gate: g }, idx) => (
            <div
              key={title}
              className="rounded-[12px] p-3 space-y-1.5"
              style={
                g.passed
                  ? {
                      backgroundColor: 'rgba(77, 240, 180, 0.08)',
                      border: '1px solid rgba(77, 240, 180, 0.35)',
                    }
                  : {
                      backgroundColor: 'rgba(7, 9, 15, 0.55)',
                      border: '1px solid rgba(140, 160, 255, 0.12)',
                    }
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#e9edff]">
                  {idx + 1}. {title}
                </span>
                <span
                  className="px-2 py-0.5 rounded-[5px] text-[10px] font-bold uppercase"
                  style={
                    g.passed
                      ? {
                          backgroundColor: '#4df0b4',
                          color: '#07090f',
                        }
                      : {
                          backgroundColor: 'rgba(140, 160, 255, 0.14)',
                          color: '#8d97b8',
                        }
                  }
                >
                  {g.passed ? 'PASS' : 'WAIT'}
                </span>
              </div>
              <p
                className="text-xs text-[#8d97b8] tabular-nums"
                style={monoStyle}
              >
                {g.detail}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 5. NEAREST ZONES PAIR: sell side above, buy side below, with price, grade, distance */}
      <div
        className="rounded-[18px] p-4 sm:p-5 space-y-3 backdrop-blur-md"
        style={novaCardStyle}
      >
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
          NEAREST ZONES PAIR
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Sell side above */}
          <div
            className="rounded-[12px] p-3 flex items-center justify-between gap-2"
            style={{
              backgroundColor: 'rgba(255, 107, 127, 0.07)',
              border: '1px solid rgba(255, 107, 127, 0.3)',
            }}
          >
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#ff6b7f] block">
                Sell side above
              </span>
              {nearestZones.above ? (
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span className="text-xs font-bold text-[#e9edff] truncate">
                    {nearestZones.above.name}
                  </span>
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                    style={{
                      backgroundColor: 'rgba(140, 160, 255, 0.14)',
                      color: '#e9edff',
                    }}
                  >
                    {nearestZones.above.grade}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-[#8d97b8] mt-1 block">None</span>
              )}
            </div>

            <div className="text-right shrink-0">
              <span
                className="text-xs font-bold text-[#e9edff] tabular-nums block"
                style={monoStyle}
              >
                {nearestZones.above ? nearestZones.above.level.toFixed(2) : '—'}
              </span>
              <span
                className="text-[11px] font-semibold text-[#ff6b7f] tabular-nums"
                style={monoStyle}
              >
                {nearestZones.above ? nearestZones.above.distanceFormatted : '—'}
              </span>
            </div>
          </div>

          {/* Buy side below */}
          <div
            className="rounded-[12px] p-3 flex items-center justify-between gap-2"
            style={{
              backgroundColor: 'rgba(77, 240, 180, 0.07)',
              border: '1px solid rgba(77, 240, 180, 0.3)',
            }}
          >
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#4df0b4] block">
                Buy side below
              </span>
              {nearestZones.below ? (
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span className="text-xs font-bold text-[#e9edff] truncate">
                    {nearestZones.below.name}
                  </span>
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                    style={{
                      backgroundColor: 'rgba(140, 160, 255, 0.14)',
                      color: '#e9edff',
                    }}
                  >
                    {nearestZones.below.grade}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-[#8d97b8] mt-1 block">None</span>
              )}
            </div>

            <div className="text-right shrink-0">
              <span
                className="text-xs font-bold text-[#e9edff] tabular-nums block"
                style={monoStyle}
              >
                {nearestZones.below ? nearestZones.below.level.toFixed(2) : '—'}
              </span>
              <span
                className="text-[11px] font-semibold text-[#4df0b4] tabular-nums"
                style={monoStyle}
              >
                {nearestZones.below ? nearestZones.below.distanceFormatted : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 6. TODAY'S SIGNALS: time, side, zone, entry, reason, result in R. Empty state "No signals yet today." */}
      <div
        className="rounded-[18px] p-4 sm:p-5 space-y-3 backdrop-blur-md"
        style={novaCardStyle}
      >
        <div
          className="flex items-center justify-between gap-2 pb-2.5"
          style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
        >
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
            TODAY&apos;S SIGNALS
          </h3>
          <span
            className="text-xs text-[#8d97b8] tabular-nums"
            style={monoStyle}
          >
            {todaySignals.length}
          </span>
        </div>

        {todaySignals.length === 0 ? (
          <p className="text-xs text-[#8d97b8] py-2">No signals yet today.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr
                  className="text-[11px] text-[#8d97b8]"
                  style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.12)' }}
                >
                  <th className="py-2 font-semibold">Time</th>
                  <th className="py-2 font-semibold">Side</th>
                  <th className="py-2 font-semibold">Zone</th>
                  <th className="py-2 font-semibold">Entry</th>
                  <th className="py-2 font-semibold">Reason</th>
                  <th className="py-2 font-semibold text-right">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(140,160,255,0.08)]">
                {todaySignals.map((sig) => {
                  const sigBuy = sig.side === 'BUY';
                  const reasonText =
                    sig.exitReason ||
                    (sig.status === 'CLOSED_PROFIT'
                      ? 'Target hit'
                      : sig.status === 'CLOSED_BREAKEVEN'
                        ? 'Breakeven'
                        : 'Stop loss');
                  return (
                    <tr key={sig.id}>
                      <td
                        className="py-2.5 text-[#8d97b8] tabular-nums"
                        style={monoStyle}
                      >
                        {sig.entryTimeDubai}
                      </td>
                      <td className="py-2.5">
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
                          style={{
                            backgroundColor: sigBuy
                              ? 'rgba(77, 240, 180, 0.16)'
                              : 'rgba(255, 107, 127, 0.16)',
                            color: sigBuy ? '#4df0b4' : '#ff6b7f',
                          }}
                        >
                          {sig.side}
                        </span>
                      </td>
                      <td className="py-2.5 font-semibold text-[#e9edff]">
                        {sig.zoneName}
                      </td>
                      <td
                        className="py-2.5 text-[#e9edff] tabular-nums"
                        style={monoStyle}
                      >
                        {sig.entryPrice.toFixed(2)}
                      </td>
                      <td className="py-2.5 text-[#8d97b8]">{reasonText}</td>
                      <td
                        className={`py-2.5 text-right font-bold tabular-nums ${
                          sig.totalPnlR > 0
                            ? 'text-[#4df0b4]'
                            : sig.totalPnlR < 0
                              ? 'text-[#ff6b7f]'
                              : 'text-[#e9edff]'
                        }`}
                        style={monoStyle}
                      >
                        {sig.totalPnlR >= 0 ? '+' : ''}
                        {sig.totalPnlR.toFixed(2)} R
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
