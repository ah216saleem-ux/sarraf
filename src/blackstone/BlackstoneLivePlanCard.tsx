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

const cardStyle: React.CSSProperties = {
  backgroundColor: '#0b0b0e',
  border: '1px solid #1f1d18',
  fontFamily: "'DM Sans', sans-serif",
};

const innerBoxStyle: React.CSSProperties = {
  backgroundColor: '#12110e',
  border: '1px solid #26231c',
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
        className="rounded-[12px] p-4 text-xs"
        style={{ ...cardStyle, color: '#8e8779' }}
      >
        Loading live plan...
      </div>
    );
  }

  const {
    phase,
    mode,
    pinnedZoneId,
    targetZone,
    m15Atr,
    stopDistanceDollars,
    adrUsedPct,
    adrDollars,
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

  const pnlDollars = activeTrade ? activeTrade.totalPnlDollars : 0;
  const pnlR = activeTrade ? activeTrade.totalPnlR : 0;
  const isProfit = pnlDollars > 0;
  const isLoss = pnlDollars < 0;

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
        backgroundColor: '#12110e',
        border: '1px solid #26231c',
        color: '#8e8779',
        ...monoStyle,
      };
    }
    if (p === 'PAUSED') {
      return {
        backgroundColor: 'rgba(229, 88, 79, 0.14)',
        border: '1px solid #e5584f',
        color: '#e5584f',
        ...monoStyle,
      };
    }
    if (p === 'TRADE LIVE') {
      return {
        backgroundColor: 'rgba(63, 191, 143, 0.14)',
        border: '1px solid #3fbf8f',
        color: '#3fbf8f',
        ...monoStyle,
      };
    }
    return {
      backgroundColor: '#d9b25a',
      border: '1px solid #d9b25a',
      color: '#090806',
      ...monoStyle,
    };
  };

  const slMoveStr =
    entryPrice !== null && stopPrice !== null
      ? `${isBuy ? '-' : '+'}$${Math.abs(entryPrice - stopPrice).toFixed(2)}`
      : `-$${stopDistanceDollars.toFixed(2)}`;
  const tp1MoveStr =
    entryPrice !== null && tp1Price !== null
      ? `${isBuy ? '+' : '-'}$${Math.abs(tp1Price - entryPrice).toFixed(2)}`
      : `${isBuy ? '+' : '-'}$${(stopDistanceDollars * 1.0).toFixed(2)}`;
  const tp2MoveStr =
    entryPrice !== null && tp2Price !== null
      ? `${isBuy ? '+' : '-'}$${Math.abs(tp2Price - entryPrice).toFixed(2)}`
      : `${isBuy ? '+' : '-'}$${(stopDistanceDollars * 1.7).toFixed(2)}`;
  const tp3MoveStr =
    entryPrice !== null && tp3Price !== null
      ? `${isBuy ? '+' : '-'}$${Math.abs(tp3Price - entryPrice).toFixed(2)}`
      : `${isBuy ? '+' : '-'}$${(stopDistanceDollars * 2.5).toFixed(2)}`;

  const effectiveZoneScore =
    targetZone?.score ?? matchedZone?.score ?? null;

  return (
    <div className="space-y-3.5" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* 1. LIVE PLAN CARD */}
      <div className="rounded-[12px] p-3.5 sm:p-4 space-y-3.5" style={cardStyle}>
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2
            className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
            style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
          >
            LIVE PLAN
          </h2>

          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex items-center gap-1 rounded-[8px] p-0.5"
              style={innerBoxStyle}
            >
              <button
                type="button"
                onClick={() => onPinZone('AUTO')}
                className={`px-2.5 py-1 rounded-[6px] text-xs font-semibold transition-colors cursor-pointer ${
                  mode === 'AUTO'
                    ? 'bg-[#d9b25a] text-[#090806] font-bold'
                    : 'text-[#8e8779] hover:text-[#f4efe6]'
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
                className={`px-2.5 py-1 rounded-[6px] text-xs font-semibold transition-colors cursor-pointer ${
                  mode === 'MANUAL'
                    ? 'bg-[#d9b25a] text-[#090806] font-bold'
                    : 'text-[#8e8779] hover:text-[#f4efe6]'
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
                className="rounded-[8px] px-2.5 py-1 text-xs text-[#f4efe6] focus:outline-none"
                style={{
                  backgroundColor: '#12110e',
                  border: '1px solid rgba(217, 178, 90, 0.45)',
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

        {/* Phase chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {ALL_PHASES.map((p) => {
            const isActive = phase === p;
            return (
              <span
                key={p}
                className="px-2 py-0.5 rounded-[5px] text-[10.5px] font-bold uppercase tracking-wider"
                style={getPhaseChipStyle(p, isActive)}
              >
                {p}
              </span>
            );
          })}
        </div>

        {pauseReason && (
          <div
            className="rounded-[8px] px-3 py-2 text-xs flex items-center gap-2"
            style={{
              backgroundColor: 'rgba(229, 88, 79, 0.12)',
              border: '1px solid rgba(229, 88, 79, 0.4)',
              color: '#e5584f',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#e5584f] shrink-0" />
            <span className="font-semibold">{pauseReason}</span>
          </div>
        )}

        {/* Target zone + Zone score + ADR used % + Daily counters */}
        <div
          className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2.5"
          style={{ borderTop: '1px solid #1f1d18' }}
        >
          <div className="rounded-[10px] p-3 space-y-1.5" style={innerBoxStyle}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase font-semibold text-[#8e8779]">
                Target zone
              </span>
              {targetZone && (
                <span
                  className="text-[11px] font-semibold"
                  style={{
                    color: targetZone.side === 'buy side' ? '#3fbf8f' : '#e5584f',
                  }}
                >
                  {targetZone.side}
                </span>
              )}
            </div>
            {targetZone ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectChartZone?.(targetZone.id)}
                    className="text-sm font-bold text-[#f4efe6] hover:text-[#d9b25a] transition-colors cursor-pointer text-left"
                  >
                    {targetZone.name}
                  </button>
                  <span
                    className="text-xs font-bold text-[#d9b25a] tabular-nums"
                    style={monoStyle}
                  >
                    {targetDistanceStr}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-[#8e8779]">
                  <span>Range</span>
                  <span
                    className="text-[#f4efe6] font-semibold tabular-nums"
                    style={monoStyle}
                  >
                    {targetZone.low.toFixed(2)} – {targetZone.high.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-[#8e8779]">
                  <span>Zone score</span>
                  <span
                    className="inline-flex items-center gap-1.5 font-bold text-[#f2d78f] tabular-nums"
                    style={monoStyle}
                  >
                    <span>
                      {effectiveZoneScore !== null ? `${effectiveZoneScore}/100` : '—'}
                    </span>
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px]"
                      style={{
                        backgroundColor: 'rgba(217, 178, 90, 0.14)',
                        border: '1px solid rgba(217, 178, 90, 0.4)',
                        color: '#f2d78f',
                      }}
                    >
                      {targetZone.grade}
                    </span>
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-[#8e8779] py-1">No active zone</div>
            )}
          </div>

          <div
            className="rounded-[10px] p-3 flex flex-col justify-between gap-1.5"
            style={innerBoxStyle}
          >
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8e8779]">ADR used %</span>
              <span
                className="font-bold text-[#d9b25a] tabular-nums"
                style={monoStyle}
              >
                {adrUsedPct !== null && adrUsedPct !== undefined
                  ? `${adrUsedPct.toFixed(1)}%`
                  : '—'}
                {adrDollars !== null && adrDollars !== undefined && (
                  <span className="text-[10.5px] font-normal text-[#8e8779] ml-1">
                    (${adrDollars.toFixed(1)})
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8e8779]">Trades today</span>
              <span
                className="font-bold text-[#f4efe6] tabular-nums"
                style={monoStyle}
              >
                {tradesToday ?? todaySignals.length} / {maxTrades ?? 4}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8e8779]">Stops today</span>
              <span
                className={`font-bold tabular-nums ${
                  (stopsToday ?? 0) >= (maxStops ?? 3)
                    ? 'text-[#e5584f]'
                    : 'text-[#f4efe6]'
                }`}
                style={monoStyle}
              >
                {stopsToday ?? 0} / {maxStops ?? 3}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. TRADE RAIL CARD */}
      <div
        className={`rounded-[12px] p-3.5 sm:p-4 space-y-3.5 transition-opacity ${
          isTradeLive ? 'opacity-100' : 'opacity-70'
        }`}
        style={cardStyle}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
              style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
            >
              TRADE RAIL
            </h3>
            {!isTradeLive ? (
              <span
                className="px-2 py-0.5 rounded-[5px] text-[10.5px] font-semibold"
                style={{
                  ...innerBoxStyle,
                  color: '#8e8779',
                  ...monoStyle,
                }}
              >
                PREVIEW
              </span>
            ) : (
              <span
                className="px-2 py-0.5 rounded-[5px] text-[10.5px] font-bold uppercase"
                style={{
                  backgroundColor: isBuy
                    ? 'rgba(63, 191, 143, 0.14)'
                    : 'rgba(229, 88, 79, 0.14)',
                  border: `1px solid ${isBuy ? '#3fbf8f' : '#e5584f'}`,
                  color: isBuy ? '#3fbf8f' : '#e5584f',
                  ...monoStyle,
                }}
              >
                {tradeSide} · LIVE
              </span>
            )}
          </div>

          {isTradeLive && (
            <div
              className="flex items-center gap-2 rounded-[6px] px-2.5 py-1"
              style={innerBoxStyle}
            >
              <span
                className={`text-xs font-bold tabular-nums ${
                  isProfit
                    ? 'text-[#3fbf8f]'
                    : isLoss
                      ? 'text-[#e5584f]'
                      : 'text-[#f4efe6]'
                }`}
                style={monoStyle}
              >
                {pnlDollars >= 0 ? '+' : ''}${pnlDollars.toFixed(2)} (
                {pnlR >= 0 ? '+' : ''}
                {pnlR.toFixed(2)}R)
              </span>
            </div>
          )}
        </div>

        {/* Rail Track */}
        <div className="relative pt-6 pb-5 px-3">
          <div
            className="h-1.5 w-full rounded-full relative overflow-hidden"
            style={{ backgroundColor: '#161511' }}
          >
            {isTradeLive && (
              <div
                className="h-full transition-all duration-300"
                style={{
                  width: `${progressPct}%`,
                  backgroundColor: isLoss ? '#e5584f' : '#3fbf8f',
                }}
              />
            )}
          </div>

          {/* Stop Loss Station */}
          <div className="absolute top-1/2 -translate-y-1/2 left-3 -translate-x-1/2 flex flex-col items-center">
            <div
              className="w-3 h-3 rounded-full border-2"
              style={{
                backgroundColor: '#e5584f',
                borderColor: '#050507',
              }}
            />
            <span className="text-[10px] font-bold text-[#e5584f] uppercase mt-1">
              {activeTrade?.beMoved ? 'BE' : 'SL'}
            </span>
            <span
              className="text-[10px] text-[#8e8779] tabular-nums"
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
                backgroundColor: '#d9b25a',
                borderColor: '#050507',
              }}
            />
            <span className="text-[10px] font-semibold text-[#f4efe6] uppercase mt-1">
              Entry
            </span>
            <span
              className="text-[10px] text-[#8e8779] tabular-nums"
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
                backgroundColor: activeTrade?.tp1.hit ? '#3fbf8f' : '#2a4a3c',
                borderColor: '#050507',
              }}
            />
            <span className="text-[10px] font-bold text-[#3fbf8f] uppercase mt-1">
              TP1
            </span>
            <span
              className="text-[10px] text-[#8e8779] tabular-nums"
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
                backgroundColor: activeTrade?.tp2.hit ? '#3fbf8f' : '#2a4a3c',
                borderColor: '#050507',
              }}
            />
            <span className="text-[10px] font-bold text-[#3fbf8f] uppercase mt-1">
              TP2
            </span>
            <span
              className="text-[10px] text-[#8e8779] tabular-nums"
              style={monoStyle}
            >
              {tp2Price !== null ? tp2Price.toFixed(2) : '—'}
            </span>
          </div>

          {/* TP3 Station */}
          <div className="absolute top-1/2 -translate-y-1/2 right-3 translate-x-1/2 flex flex-col items-center">
            <div
              className="w-3 h-3 rounded-full border-2"
              style={{
                backgroundColor: activeTrade?.tp3.hit ? '#d9b25a' : '#4a3d22',
                borderColor: '#050507',
              }}
            />
            <span className="text-[10px] font-bold text-[#d9b25a] uppercase mt-1">
              TP3
            </span>
            <span
              className="text-[10px] text-[#8e8779] tabular-nums"
              style={monoStyle}
            >
              {tp3Price !== null ? tp3Price.toFixed(2) : '—'}
            </span>
          </div>

          {isTradeLive && currentPrice !== null && stopPrice !== null && tp3Price !== null && (
            <div
              className="absolute top-0 -translate-x-1/2 flex flex-col items-center z-10 transition-all duration-200"
              style={{
                left: `calc(0.75rem + (100% - 1.5rem) * ${progressPct / 100})`,
              }}
            >
              <div
                className="px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums"
                style={{
                  backgroundColor: '#d9b25a',
                  color: '#090806',
                  ...monoStyle,
                }}
              >
                {currentPrice.toFixed(2)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. TRADE PLAN TABLE */}
      <div className="rounded-[12px] p-3.5 sm:p-4 space-y-2.5" style={cardStyle}>
        <div
          className="flex flex-wrap items-center justify-between gap-2 pb-2"
          style={{ borderBottom: '1px solid #1f1d18' }}
        >
          <div className="flex items-center gap-2">
            <h3
              className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
              style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
            >
              TRADE LEVELS
            </h3>
            <span
              className="text-[11px] text-[#8e8779] tabular-nums"
              style={monoStyle}
            >
              ATR14 ${m15Atr.toFixed(2)} · 1R ${stopDistanceDollars.toFixed(2)}
            </span>
          </div>

          <span
            className="px-2 py-0.5 rounded-[5px] text-[10.5px] font-bold uppercase"
            style={
              isTradeLive
                ? {
                    backgroundColor: isBuy
                      ? 'rgba(63, 191, 143, 0.14)'
                      : 'rgba(229, 88, 79, 0.14)',
                    border: `1px solid ${isBuy ? '#3fbf8f' : '#e5584f'}`,
                    color: isBuy ? '#3fbf8f' : '#e5584f',
                    ...monoStyle,
                  }
                : {
                    ...innerBoxStyle,
                    color: '#8e8779',
                    ...monoStyle,
                  }
            }
          >
            {isTradeLive ? `${tradeSide} · LIVE` : 'PREVIEW'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr
                className="text-[11px] text-[#8e8779]"
                style={{ borderBottom: '1px solid #1f1d18' }}
              >
                <th className="py-1.5 font-semibold">Level</th>
                <th className="py-1.5 font-semibold">Price</th>
                <th className="py-1.5 font-semibold">Move ($)</th>
                <th className="py-1.5 font-semibold text-right">Size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#181612]">
              <tr>
                <td className="py-2 font-semibold text-[#d9b25a]">
                  Entry ({tradeSide})
                </td>
                <td
                  className="py-2 font-bold text-[#f4efe6] tabular-nums"
                  style={monoStyle}
                >
                  {entryPrice !== null ? entryPrice.toFixed(2) : '—'}
                </td>
                <td className="py-2 text-[#8e8779] tabular-nums" style={monoStyle}>
                  $0.00
                </td>
                <td
                  className="py-2 text-right text-[#8e8779] tabular-nums"
                  style={monoStyle}
                >
                  Full
                </td>
              </tr>

              <tr>
                <td className="py-2 font-semibold text-[#e5584f]">
                  Stop loss {activeTrade?.beMoved ? '(BE)' : '(-1.0R)'}
                </td>
                <td
                  className="py-2 font-bold text-[#f4efe6] tabular-nums"
                  style={monoStyle}
                >
                  {stopPrice !== null ? stopPrice.toFixed(2) : '—'}
                </td>
                <td
                  className="py-2 text-[#e5584f] font-semibold tabular-nums"
                  style={monoStyle}
                >
                  {slMoveStr}
                </td>
                <td
                  className="py-2 text-right text-[#8e8779] tabular-nums"
                  style={monoStyle}
                >
                  Full
                </td>
              </tr>

              <tr>
                <td className="py-2 font-semibold text-[#3fbf8f]">TP1 (1.0R)</td>
                <td
                  className="py-2 font-bold text-[#f4efe6] tabular-nums"
                  style={monoStyle}
                >
                  {tp1Price !== null ? tp1Price.toFixed(2) : '—'}
                </td>
                <td
                  className="py-2 text-[#3fbf8f] font-semibold tabular-nums"
                  style={monoStyle}
                >
                  {tp1MoveStr}
                </td>
                <td
                  className="py-2 text-right text-[#f4efe6] font-semibold tabular-nums"
                  style={monoStyle}
                >
                  {activeTrade?.tp1.hit ? 'Hit' : '1/3'}
                </td>
              </tr>

              <tr>
                <td className="py-2 font-semibold text-[#3fbf8f]">TP2 (1.7R)</td>
                <td
                  className="py-2 font-bold text-[#f4efe6] tabular-nums"
                  style={monoStyle}
                >
                  {tp2Price !== null ? tp2Price.toFixed(2) : '—'}
                </td>
                <td
                  className="py-2 text-[#3fbf8f] font-semibold tabular-nums"
                  style={monoStyle}
                >
                  {tp2MoveStr}
                </td>
                <td
                  className="py-2 text-right text-[#f4efe6] font-semibold tabular-nums"
                  style={monoStyle}
                >
                  {activeTrade?.tp2.hit ? 'Hit' : '1/3'}
                </td>
              </tr>

              <tr>
                <td className="py-2 font-semibold text-[#d9b25a]">TP3 (2.5R)</td>
                <td
                  className="py-2 font-bold text-[#f4efe6] tabular-nums"
                  style={monoStyle}
                >
                  {tp3Price !== null ? tp3Price.toFixed(2) : '—'}
                </td>
                <td
                  className="py-2 text-[#d9b25a] font-semibold tabular-nums"
                  style={monoStyle}
                >
                  {tp3MoveStr}
                </td>
                <td
                  className="py-2 text-right text-[#f4efe6] font-semibold tabular-nums"
                  style={monoStyle}
                >
                  {activeTrade?.tp3.hit ? 'Hit' : '1/3'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. ENTRY GATES */}
      <div className="rounded-[12px] p-3.5 sm:p-4 space-y-2.5" style={cardStyle}>
        <div
          className="flex items-center justify-between gap-2 pb-2"
          style={{ borderBottom: '1px solid #1f1d18' }}
        >
          <h3
            className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
            style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
          >
            ENTRY GATES
          </h3>
          <span
            className="px-2 py-0.5 rounded-[5px] text-[10px] font-bold uppercase"
            style={
              gates.allPassed
                ? {
                    backgroundColor: 'rgba(63, 191, 143, 0.14)',
                    border: '1px solid #3fbf8f',
                    color: '#3fbf8f',
                    ...monoStyle,
                  }
                : {
                    ...innerBoxStyle,
                    color: '#8e8779',
                    ...monoStyle,
                  }
            }
          >
            {gates.allPassed ? 'ALL PASS' : 'WAITING'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { title: 'Zone Integrity', gate: gates.gate1 },
            { title: 'Reaction', gate: gates.gate2 },
            { title: 'Close Confirm', gate: gates.gate3 },
            { title: 'Room to Run', gate: gates.gate4 },
          ].map(({ title, gate: g }, idx) => (
            <div
              key={title}
              className="rounded-[10px] p-2.5 space-y-1"
              style={
                g.passed
                  ? {
                      backgroundColor: 'rgba(63, 191, 143, 0.06)',
                      border: '1px solid rgba(63, 191, 143, 0.35)',
                    }
                  : innerBoxStyle
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#f4efe6]">
                  {idx + 1}. {title}
                </span>
                <span
                  className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold uppercase"
                  style={
                    g.passed
                      ? {
                          backgroundColor: '#3fbf8f',
                          color: '#060608',
                          ...monoStyle,
                        }
                      : {
                          backgroundColor: '#1b1914',
                          color: '#8e8779',
                          ...monoStyle,
                        }
                  }
                >
                  {g.passed ? 'PASS' : 'WAIT'}
                </span>
              </div>
              <p className="text-[11px] text-[#8e8779] tabular-nums" style={monoStyle}>
                {g.detail}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 5. NEAREST ZONES PAIR */}
      <div className="rounded-[12px] p-3.5 sm:p-4 space-y-2.5" style={cardStyle}>
        <h3
          className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
          style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
        >
          NEAREST ZONES
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* Sell side above */}
          <button
            type="button"
            disabled={!nearestZones.above}
            onClick={() =>
              nearestZones.above && onSelectChartZone?.(nearestZones.above.id)
            }
            className="rounded-[10px] p-2.5 flex items-center justify-between gap-2 text-left cursor-pointer disabled:cursor-default"
            style={{
              backgroundColor: 'rgba(229, 88, 79, 0.06)',
              border: '1px solid rgba(229, 88, 79, 0.28)',
            }}
          >
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#e5584f] block">
                Sell above
              </span>
              {nearestZones.above ? (
                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                  <span className="text-xs font-bold text-[#f4efe6] truncate">
                    {nearestZones.above.name}
                  </span>
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                    style={{
                      backgroundColor: '#181612',
                      color: '#f2d78f',
                      ...monoStyle,
                    }}
                  >
                    {nearestZones.above.grade}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-[#8e8779] mt-0.5 block">None</span>
              )}
            </div>

            <div className="text-right shrink-0">
              <span
                className="text-xs font-bold text-[#f4efe6] tabular-nums block"
                style={monoStyle}
              >
                {nearestZones.above ? nearestZones.above.level.toFixed(2) : '—'}
              </span>
              <span
                className="text-[11px] font-semibold text-[#e5584f] tabular-nums"
                style={monoStyle}
              >
                {nearestZones.above ? nearestZones.above.distanceFormatted : '—'}
              </span>
            </div>
          </button>

          {/* Buy side below */}
          <button
            type="button"
            disabled={!nearestZones.below}
            onClick={() =>
              nearestZones.below && onSelectChartZone?.(nearestZones.below.id)
            }
            className="rounded-[10px] p-2.5 flex items-center justify-between gap-2 text-left cursor-pointer disabled:cursor-default"
            style={{
              backgroundColor: 'rgba(63, 191, 143, 0.06)',
              border: '1px solid rgba(63, 191, 143, 0.28)',
            }}
          >
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#3fbf8f] block">
                Buy below
              </span>
              {nearestZones.below ? (
                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                  <span className="text-xs font-bold text-[#f4efe6] truncate">
                    {nearestZones.below.name}
                  </span>
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                    style={{
                      backgroundColor: '#181612',
                      color: '#f2d78f',
                      ...monoStyle,
                    }}
                  >
                    {nearestZones.below.grade}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-[#8e8779] mt-0.5 block">None</span>
              )}
            </div>

            <div className="text-right shrink-0">
              <span
                className="text-xs font-bold text-[#f4efe6] tabular-nums block"
                style={monoStyle}
              >
                {nearestZones.below ? nearestZones.below.level.toFixed(2) : '—'}
              </span>
              <span
                className="text-[11px] font-semibold text-[#3fbf8f] tabular-nums"
                style={monoStyle}
              >
                {nearestZones.below ? nearestZones.below.distanceFormatted : '—'}
              </span>
            </div>
          </button>
        </div>
      </div>

      {/* 6. TODAY'S SIGNALS */}
      <div className="rounded-[12px] p-3.5 sm:p-4 space-y-2.5" style={cardStyle}>
        <div
          className="flex items-center justify-between gap-2 pb-2"
          style={{ borderBottom: '1px solid #1f1d18' }}
        >
          <h3
            className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
            style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
          >
            TODAY&apos;S SIGNALS
          </h3>
          <span className="text-xs text-[#8e8779] tabular-nums" style={monoStyle}>
            {todaySignals.length}
          </span>
        </div>

        {todaySignals.length === 0 ? (
          <p className="text-xs text-[#8e8779] py-1">No signals yet today.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr
                  className="text-[11px] text-[#8e8779]"
                  style={{ borderBottom: '1px solid #1f1d18' }}
                >
                  <th className="py-1.5 font-semibold">Time</th>
                  <th className="py-1.5 font-semibold">Side</th>
                  <th className="py-1.5 font-semibold">Zone</th>
                  <th className="py-1.5 font-semibold">Entry</th>
                  <th className="py-1.5 font-semibold text-right">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#181612]">
                {todaySignals.map((sig) => {
                  const sigBuy = sig.side === 'BUY';
                  return (
                    <tr key={sig.id}>
                      <td
                        className="py-2 text-[#8e8779] tabular-nums"
                        style={monoStyle}
                      >
                        {sig.entryTimeDubai}
                      </td>
                      <td className="py-2">
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
                          style={{
                            backgroundColor: sigBuy
                              ? 'rgba(63, 191, 143, 0.14)'
                              : 'rgba(229, 88, 79, 0.14)',
                            color: sigBuy ? '#3fbf8f' : '#e5584f',
                            ...monoStyle,
                          }}
                        >
                          {sig.side}
                        </span>
                      </td>
                      <td className="py-2 font-semibold text-[#f4efe6]">
                        {sig.zoneName}
                      </td>
                      <td
                        className="py-2 text-[#f4efe6] tabular-nums"
                        style={monoStyle}
                      >
                        {sig.entryPrice.toFixed(2)}
                      </td>
                      <td
                        className={`py-2 text-right font-bold tabular-nums ${
                          sig.totalPnlR > 0
                            ? 'text-[#3fbf8f]'
                            : sig.totalPnlR < 0
                              ? 'text-[#e5584f]'
                              : 'text-[#f4efe6]'
                        }`}
                        style={monoStyle}
                      >
                        {sig.totalPnlR > 0 ? '+' : ''}
                        {sig.totalPnlR.toFixed(2)}R
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
