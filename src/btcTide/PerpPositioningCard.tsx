import React, { useState, useEffect } from 'react';
import { PerpPositioning, BtcFeedStatus } from './types';
import { Zap, Clock, TrendingUp, TrendingDown, Flame, Database } from 'lucide-react';

interface PerpPositioningCardProps {
  perp: PerpPositioning;
  status: BtcFeedStatus;
  isPerpsStale?: boolean;
  perpsAgeMs?: number;
}

function formatCountdown(targetMs: number | null): string {
  if (!targetMs) return '--:--:--';
  const diffSec = Math.max(0, Math.floor((targetMs - Date.now()) / 1000));
  const hh = String(Math.floor(diffSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
  const ss = String(diffSec % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatUsdCompact(val: number | null): string {
  if (val === null || !Number.isFinite(val)) return '--';
  const abs = Math.abs(val);
  if (abs >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

export const PerpPositioningCard: React.FC<PerpPositioningCardProps> = React.memo(
  ({ perp, status, isPerpsStale = false, perpsAgeMs = 0 }) => {
    const isStaleOrOffline = status === 'STALE' || status === 'OFFLINE' || isPerpsStale;
    const [countdown, setCountdown] = useState<string>('--:--:--');

    useEffect(() => {
      const update = () => {
        if (typeof document !== 'undefined' && document.hidden) return;
        setCountdown(formatCountdown(perp.nextFundingTime));
      };
      update();
      const interval = setInterval(update, 1000);
      return () => clearInterval(interval);
    }, [perp.nextFundingTime]);

    const {
      markPrice,
      fundingRate,
      fundingRateNative,
      fundingIntervalHours = 8,
      openInterest,
      oiChange1h,
      oiChange1hPct,
      oiHistoryStatus = 'building 0m/60m',
      basis,
      basisBps,
      longShortRatio,
      longAccountPct,
      shortAccountPct,
      longShortMeasure = 'Accounts',
      liquidations5m = [],
      recentLiquidations = [],
      totalLiq5mUsd,
      longLiq5mUsd,
      shortLiq5mUsd,
      sources,
    } = perp;

    const isBasisPositive = basis !== null && basis >= 0;
    const isFundingPositive = fundingRate !== null && fundingRate >= 0;
    const isOiChangePositive = oiChange1h !== null && oiChange1h >= 0;

    const nowMs = Date.now();
    const allEventsRaw = [...recentLiquidations, ...liquidations5m];
    const seenLiqIds = new Set<string>();
    const allUniqueEvents = allEventsRaw.filter((item) => {
      if (seenLiqIds.has(item.id)) return false;
      seenLiqIds.add(item.id);
      return true;
    }).sort((a, b) => b.time - a.time);

    // Strictly separate events inside the 5 min window from older events
    const fiveMinCutoff = nowMs - 5 * 60 * 1000;
    const eventsInside5m = allUniqueEvents.filter((l) => l.time >= fiveMinCutoff);
    const olderEvents = allUniqueEvents.filter((l) => l.time < fiveMinCutoff).slice(0, 10);

    return (
      <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 backdrop-blur-md flex flex-col justify-between shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
        <div>
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#FFD97A]" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                PERP POSITIONING &amp; DERIVATIVES
              </span>
              {isPerpsStale && (
                <span className="px-1.5 py-0.5 rounded bg-amber-950/70 border border-amber-500/50 text-amber-300 text-[10px] font-bold font-mono animate-pulse">
                  STALE ({(perpsAgeMs / 1000).toFixed(1)}s)
                </span>
              )}
            </div>
            <div className="font-mono text-[11px] text-neutral-400 flex items-center gap-2">
              <span>MARK:</span>
              <span
                className={`font-bold ${
                  isStaleOrOffline || markPrice === null ? 'text-neutral-500' : 'text-white'
                }`}
              >
                {markPrice !== null ? `$${markPrice.toFixed(2)}` : '--'}
              </span>
              {sources?.markPrice && (
                <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[9px] text-neutral-300 uppercase">
                  {sources.markPrice}
                </span>
              )}
            </div>
          </div>

          {/* Grid of Key Perp Metrics */}
          <div
            className={`grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3 font-mono text-xs ${
              isStaleOrOffline ? 'opacity-60' : ''
            }`}
          >
            {/* 1. Funding Rate (8h-Equivalent + Source Native Interval) & Next Funding Countdown */}
            <div className="bg-black/40 border border-white/5 rounded-lg p-2.5 flex flex-col justify-between">
              <div>
                <div className="text-[10px] text-neutral-400 uppercase flex items-center justify-between gap-1">
                  <span>FUNDING (8H-EQ)</span>
                  <span className="text-[9px] px-1 py-0.2 rounded bg-white/5 border border-white/10 text-neutral-300 truncate max-w-[95px]">
                    {sources?.funding || 'OKX SWAP'}
                  </span>
                </div>
                <div
                  className={`text-sm sm:text-base font-bold mt-1 flex items-baseline gap-1.5 ${
                    isStaleOrOffline || fundingRate === null
                      ? 'text-neutral-500'
                      : isFundingPositive
                      ? 'text-teal-400'
                      : 'text-rose-400'
                  }`}
                >
                  <span>
                    {fundingRate !== null
                      ? `${isFundingPositive ? '+' : ''}${(fundingRate * 100).toFixed(4)}%`
                      : '--'}
                  </span>
                  {fundingRate !== null && (
                    <span className="text-[9px] font-normal text-neutral-400">
                      /8h (native {fundingIntervalHours}h
                      {fundingIntervalHours === 1 && fundingRateNative !== null && fundingRateNative !== undefined
                        ? `: ${fundingRateNative >= 0 ? '+' : ''}${(fundingRateNative * 100).toFixed(4)}%`
                        : ''}
                      )
                    </span>
                  )}
                </div>
              </div>
              <div className="text-[10px] text-neutral-400 mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3 text-[#FFD97A] shrink-0" />
                <span>NEXT ({fundingIntervalHours}h):</span>
                <span
                  className={`font-semibold ${
                    isStaleOrOffline ? 'text-neutral-500' : 'text-[#FFD97A]'
                  }`}
                >
                  {countdown}
                </span>
              </div>
            </div>

            {/* 2. Open Interest (BTC) & Same-Source SQLite 1h Change */}
            <div className="bg-black/40 border border-white/5 rounded-lg p-2.5 flex flex-col justify-between">
              <div>
                <div className="text-[10px] text-neutral-400 uppercase flex items-center justify-between gap-1">
                  <span>OI (BTC)</span>
                  <span className="text-[9px] px-1 py-0.2 rounded bg-white/5 border border-white/10 text-neutral-300 truncate max-w-[95px]">
                    {sources?.openInterest || 'OKX SWAP'}
                  </span>
                </div>
                <div
                  className={`text-sm sm:text-base font-bold mt-1 ${
                    isStaleOrOffline || openInterest === null ? 'text-neutral-500' : 'text-white'
                  }`}
                >
                  {openInterest !== null
                    ? `${openInterest.toLocaleString('en-US', { maximumFractionDigits: 0 })} BTC`
                    : '--'}
                </div>
              </div>
              <div className="text-[10px] mt-1 font-semibold flex items-center gap-1">
                {oiChange1h !== null ? (
                  <span
                    className={`flex items-center gap-0.5 ${
                      isStaleOrOffline
                        ? 'text-neutral-500'
                        : isOiChangePositive
                        ? 'text-teal-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {isOiChangePositive ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    <span>
                      {isOiChangePositive ? '+' : ''}
                      {oiChange1h.toFixed(1)} BTC (
                      {oiChange1hPct !== null
                        ? `${oiChange1hPct > 0 ? '+' : ''}${oiChange1hPct.toFixed(2)}%`
                        : '1h'}
                      )
                    </span>
                  </span>
                ) : (
                  <span className="text-amber-300/90 flex items-center gap-1 text-[10px]">
                    <Database className="w-3 h-3 text-[#FFD97A] shrink-0" />
                    <span>{oiHistoryStatus || 'building 0m/60m'}</span>
                  </span>
                )}
              </div>
            </div>

            {/* 3. Perp vs Spot Basis */}
            <div className="bg-black/40 border border-white/5 rounded-lg p-2.5 flex flex-col justify-between">
              <div>
                <div className="text-[10px] text-neutral-400 uppercase flex items-center justify-between gap-1">
                  <span>BASIS</span>
                  <span className="text-[9px] px-1 py-0.2 rounded bg-white/5 border border-white/10 text-neutral-300 truncate max-w-[95px]">
                    {sources?.basis || 'OKX SWAP'}
                  </span>
                </div>
                <div
                  className={`text-sm sm:text-base font-bold mt-1 ${
                    isStaleOrOffline || basis === null
                      ? 'text-neutral-500'
                      : isBasisPositive
                      ? 'text-teal-400'
                      : 'text-rose-400'
                  }`}
                >
                  {basis !== null ? `${isBasisPositive ? '+' : ''}$${basis.toFixed(2)}` : '--'}
                </div>
              </div>
              <div className="text-[10px] text-neutral-400 mt-1">
                {basisBps !== null
                  ? `${basisBps > 0 ? '+' : ''}${basisBps.toFixed(1)} bps vs spot`
                  : '--'}
              </div>
            </div>

            {/* 4. Global Long/Short Ratio (Source + Accounts vs Positions Measure) */}
            <div className="bg-black/40 border border-white/5 rounded-lg p-2.5 flex flex-col justify-between">
              <div>
                <div className="text-[10px] text-neutral-400 uppercase flex items-center justify-between gap-1">
                  <span>L/S ({longShortMeasure.toUpperCase()})</span>
                  <span
                    className="text-[9px] px-1 py-0.2 rounded bg-white/5 border border-white/10 text-neutral-300 truncate max-w-[105px]"
                    title={`${sources?.longShort || 'OKX'} · Measures ${longShortMeasure}`}
                  >
                    {sources?.longShort || `OKX (${longShortMeasure})`}
                  </span>
                </div>
                <div
                  className={`text-sm sm:text-base font-bold mt-1 flex items-baseline gap-1.5 ${
                    isStaleOrOffline || longShortRatio === null
                      ? 'text-neutral-500'
                      : 'text-[#FFD97A]'
                  }`}
                >
                  <span>{longShortRatio !== null ? `${longShortRatio.toFixed(2)}x` : '--'}</span>
                  <span className="text-[9px] font-normal text-neutral-400">
                    {longShortMeasure}
                  </span>
                </div>
              </div>
              <div className="text-[10px] mt-1 flex items-center justify-between">
                <span className={isStaleOrOffline ? 'text-neutral-500' : 'text-teal-400'}>
                  {longAccountPct !== null ? `${longAccountPct}% L` : '--'}
                </span>
                <span className={isStaleOrOffline ? 'text-neutral-500' : 'text-rose-400'}>
                  {shortAccountPct !== null ? `${shortAccountPct}% S` : '--'}
                </span>
              </div>
            </div>
          </div>

          {/* Liquidations: 5m Total + Last 10 Events */}
          <div
            className={`mt-3.5 pt-3 border-t border-white/5 ${
              isStaleOrOffline ? 'opacity-60' : ''
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 font-mono text-xs">
              <div className="flex items-center gap-1.5 text-neutral-300">
                <Flame className="w-3.5 h-3.5 text-rose-400" />
                <span className="font-bold text-white uppercase text-[11px]">
                  LIQUIDATIONS (5M TOTAL &amp; LAST 10 EVENTS)
                </span>
                {sources?.liquidations && (
                  <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[9px] text-neutral-300 uppercase">
                    {sources.liquidations}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-white font-bold">
                  5M TOTAL: {formatUsdCompact(totalLiq5mUsd)}
                </span>
                <span className="text-rose-400">LONG: {formatUsdCompact(longLiq5mUsd)}</span>
                <span className="text-teal-400">SHORT: {formatUsdCompact(shortLiq5mUsd)}</span>
              </div>
            </div>

            {/* Inside 5m Window Liquidations List */}
            <div className="max-h-36 overflow-y-auto divide-y divide-white/[0.04] font-mono text-[11px] pr-1">
              <div className="text-[10px] uppercase font-bold text-neutral-400 py-1 flex items-center justify-between">
                <span>Recent Events (&le; 5m Window)</span>
                <span className="text-neutral-500 font-normal">All times UTC</span>
              </div>
              {eventsInside5m.length === 0 ? (
                <div className="py-2 text-center text-neutral-500 text-xs">
                  Zero liquidations recorded in last 5 minutes · Listening on Binance / OKX / Bybit...
                </div>
              ) : (
                eventsInside5m.map((l) => {
                  const isLongLiq = l.side === 'SELL';
                  return (
                    <div
                      key={l.id}
                      className="flex items-center justify-between py-1 px-1 hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-neutral-500 text-[10px]">
                          {new Date(l.time).toISOString().slice(11, 19)} UTC
                        </span>
                        <span
                          className={`font-bold text-[9px] px-1 py-0.2 rounded ${
                            isLongLiq
                              ? 'bg-rose-950/60 text-rose-300 border border-rose-500/40'
                              : 'bg-teal-950/60 text-teal-300 border border-teal-500/40'
                          }`}
                        >
                          {isLongLiq ? 'LONG REKT' : 'SHORT REKT'}
                        </span>
                        {l.source && (
                          <span className="text-[9px] text-neutral-500 hidden sm:inline">
                            [{l.source}]
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold">${l.price.toFixed(2)}</span>
                        <span
                          className={`font-bold ${
                            isLongLiq ? 'text-rose-400' : 'text-teal-400'
                          }`}
                        >
                          {formatUsdCompact(l.usdValue)} ({l.qty.toFixed(3)}₿)
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
              {olderEvents.length > 0 && (
                <div className="mt-2 pt-2 border-t border-white/5">
                  <div className="text-[10px] uppercase font-bold text-neutral-500 py-1">
                    Older Liquidations (&gt; 5m)
                  </div>
                  {olderEvents.map((l) => {
                    const isLongLiq = l.side === 'SELL';
                    return (
                      <div
                        key={l.id}
                        className="flex items-center justify-between py-1 px-1 hover:bg-white/5 transition-colors opacity-75 text-[10px]"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-neutral-500">
                            {new Date(l.time).toISOString().slice(11, 19)} UTC
                          </span>
                          <span
                            className={`font-bold text-[8px] px-1 py-0.2 rounded ${
                              isLongLiq
                                ? 'bg-rose-950/40 text-rose-300/80 border border-rose-500/30'
                                : 'bg-teal-950/40 text-teal-300/80 border border-teal-500/30'
                            }`}
                          >
                            {isLongLiq ? 'LONG REKT' : 'SHORT REKT'}
                          </span>
                          {l.source && (
                            <span className="text-[9px] text-neutral-600 hidden sm:inline">
                              [{l.source}]
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-neutral-300">${l.price.toFixed(2)}</span>
                          <span className={isLongLiq ? 'text-rose-400/80' : 'text-teal-400/80'}>
                            {formatUsdCompact(l.usdValue)} ({l.qty.toFixed(3)}₿)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

PerpPositioningCard.displayName = 'PerpPositioningCard';
