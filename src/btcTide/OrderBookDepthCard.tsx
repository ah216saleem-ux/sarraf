import React from 'react';
import { OrderBookDepth, BtcFeedStatus } from './types';
import { Layers, Scale, ShieldAlert } from 'lucide-react';

interface OrderBookDepthCardProps {
  depth: OrderBookDepth;
  status: BtcFeedStatus;
  isBookStale?: boolean;
  bookAgeMs?: number;
}

function formatUsdCompact(val: number | undefined | null): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return '--';
  const abs = Math.abs(val);
  if (abs >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

export const OrderBookDepthCard: React.FC<OrderBookDepthCardProps> = React.memo(
  ({ depth, status, isBookStale = false, bookAgeMs = 0 }) => {
    const isStaleOrOffline = status === 'STALE' || status === 'OFFLINE' || isBookStale;
    const {
      bids,
      asks,
      bestBid,
      bestAsk,
      midPrice,
      bidTotal,
      askTotal,
      bidUsd10 = 0,
      askUsd10 = 0,
      imbalancePct,
      avgLevelSizeBtc = 0,
      walls = [],
      spread,
      spreadBps,
    } = depth;

    const hasData = bids.length > 0 && asks.length > 0;
    const isBidHeavy = imbalancePct !== null && imbalancePct >= 0;

    // Gauge position from -100 to +100 mapped to 0% - 100%
    const clampedImb = imbalancePct !== null ? Math.max(-100, Math.min(100, imbalancePct)) : 0;
    const gaugeMarkerLeftPct = ((clampedImb + 100) / 200) * 100;

    const resolvedBestBid = bestBid ?? (bids.length > 0 ? bids[0].price : null);
    const resolvedBestAsk = bestAsk ?? (asks.length > 0 ? asks[0].price : null);
    const resolvedMidPrice =
      midPrice ??
      (resolvedBestBid !== null && resolvedBestAsk !== null
        ? Number(((resolvedBestBid + resolvedBestAsk) / 2).toFixed(2))
        : null);

    return (
      <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 backdrop-blur-md flex flex-col justify-between shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
        <div>
          {/* Card Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#FFD97A]" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                ORDER BOOK · DEPTH20@100MS SNAPSHOT
              </span>
              {isBookStale && (
                <span className="px-1.5 py-0.5 rounded bg-amber-950/70 border border-amber-500/50 text-amber-300 text-[10px] font-bold font-mono animate-pulse">
                  STALE ({(bookAgeMs / 1000).toFixed(1)}s)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px] text-neutral-400">
              <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-neutral-300">
                Top 8 Rows · Full Replace
              </span>
            </div>
          </div>

          {/* Best Bid / Mid Price in Centre / Best Ask & Spread Bar */}
          <div
            className={`grid grid-cols-3 items-center gap-2 my-2.5 p-2 rounded-lg bg-black/50 border border-white/10 font-mono ${
              isStaleOrOffline ? 'opacity-60' : ''
            }`}
          >
            {/* Best Bid Highlight */}
            <div className="flex flex-col items-start px-2 py-1 rounded bg-teal-950/30 border border-teal-500/30">
              <span className="text-[9px] uppercase tracking-wider text-teal-300/80 font-semibold">
                BEST BID
              </span>
              <span
                className={`text-xs sm:text-sm font-bold ${
                  isStaleOrOffline ? 'text-neutral-400' : 'text-teal-400'
                }`}
              >
                {resolvedBestBid !== null ? `$${resolvedBestBid.toFixed(2)}` : '--'}
              </span>
            </div>

            {/* Centre: Mid Price + Spread ($ & bps) */}
            <div className="flex flex-col items-center justify-center text-center px-1">
              <span className="text-[9px] uppercase tracking-wider text-neutral-400">
                MID PRICE
              </span>
              <span
                className={`text-sm sm:text-base font-extrabold tracking-tight ${
                  isStaleOrOffline ? 'text-neutral-400' : 'text-[#FFD97A]'
                }`}
              >
                {resolvedMidPrice !== null ? `$${resolvedMidPrice.toFixed(2)}` : '--'}
              </span>
              <span className="text-[10px] text-neutral-400 mt-0.5">
                SPREAD:{' '}
                <strong className={isStaleOrOffline ? 'text-neutral-500' : 'text-white'}>
                  {spread !== null ? `$${spread.toFixed(2)}` : '--'}
                </strong>{' '}
                {spreadBps !== null ? `(${spreadBps.toFixed(2)} bps)` : ''}
              </span>
            </div>

            {/* Best Ask Highlight */}
            <div className="flex flex-col items-end px-2 py-1 rounded bg-rose-950/30 border border-rose-500/30">
              <span className="text-[9px] uppercase tracking-wider text-rose-300/80 font-semibold">
                BEST ASK
              </span>
              <span
                className={`text-xs sm:text-sm font-bold ${
                  isStaleOrOffline ? 'text-neutral-400' : 'text-rose-400'
                }`}
              >
                {resolvedBestAsk !== null ? `$${resolvedBestAsk.toFixed(2)}` : '--'}
              </span>
            </div>
          </div>

          {/* Top-10 USD Notional Imbalance Gauge (-100 to +100) */}
          <div
            className={`bg-black/40 border border-white/5 rounded-lg p-2.5 mb-2.5 font-mono text-xs ${
              isStaleOrOffline ? 'opacity-60' : ''
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-1 mb-1.5">
              <div className="text-[11px]">
                <span className="text-teal-400 font-bold">
                  BID 10L: {hasData ? formatUsdCompact(bidUsd10) : '--'}
                </span>
                <span className="text-neutral-500 text-[10px] ml-1">
                  ({hasData ? `${bidTotal.toFixed(3)}₿` : '--'})
                </span>
              </div>

              <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                <Scale className="w-3.5 h-3.5 text-[#FFD97A]" />
                <span
                  className={
                    isStaleOrOffline || imbalancePct === null
                      ? 'text-neutral-400'
                      : isBidHeavy
                      ? 'text-teal-300 font-bold'
                      : 'text-rose-300 font-bold'
                  }
                >
                  {imbalancePct !== null
                    ? `${imbalancePct > 0 ? '+' : ''}${imbalancePct.toFixed(1)} (${
                        isBidHeavy ? 'BID HEAVY' : 'ASK HEAVY'
                      })`
                    : '--'}
                </span>
              </div>

              <div className="text-[11px] text-right">
                <span className="text-rose-400 font-bold">
                  ASK 10L: {hasData ? formatUsdCompact(askUsd10) : '--'}
                </span>
                <span className="text-neutral-500 text-[10px] ml-1">
                  ({hasData ? `${askTotal.toFixed(3)}₿` : '--'})
                </span>
              </div>
            </div>

            {/* Gauge Track: -100 ... 0 ... +100 */}
            <div className="relative h-3 bg-neutral-900 rounded-full overflow-hidden border border-white/10 flex">
              {/* Left half (-100 to 0, Ask Heavy) */}
              <div className="w-1/2 h-full flex justify-end border-r border-white/20">
                {imbalancePct !== null && imbalancePct < 0 && (
                  <div
                    className={`h-full transition-all duration-150 ${
                      isStaleOrOffline ? 'bg-neutral-600' : 'bg-rose-500/80'
                    }`}
                    style={{ width: `${Math.min(100, Math.abs(imbalancePct))}%` }}
                  />
                )}
              </div>
              {/* Right half (0 to +100, Bid Heavy) */}
              <div className="w-1/2 h-full flex justify-start">
                {imbalancePct !== null && imbalancePct > 0 && (
                  <div
                    className={`h-full transition-all duration-150 ${
                      isStaleOrOffline ? 'bg-neutral-600' : 'bg-teal-500/80'
                    }`}
                    style={{ width: `${Math.min(100, imbalancePct)}%` }}
                  />
                )}
              </div>
              {/* Pointer indicator */}
              {imbalancePct !== null && (
                <div
                  className="absolute top-0 bottom-0 w-1 bg-[#FFD97A] shadow-[0_0_6px_#FFD97A] transition-all duration-150"
                  style={{ left: `calc(${gaugeMarkerLeftPct}% - 2px)` }}
                />
              )}
            </div>

            <div className="flex justify-between text-[9px] text-neutral-500 mt-1">
              <span>-100 (100% ASK)</span>
              <span>0 (BALANCED)</span>
              <span>+100 (100% BID)</span>
            </div>

            {/* Walls Line (> 5x average level size) */}
            <div className="mt-2 pt-1.5 border-t border-white/5 flex flex-wrap items-center justify-between gap-1 text-[10px]">
              <div className="flex items-center gap-1.5 text-neutral-300">
                <ShieldAlert className="w-3.5 h-3.5 text-[#FFD97A] shrink-0" />
                <span className="uppercase font-bold text-neutral-400">
                  WALLS (&gt;5x AVG {avgLevelSizeBtc > 0 ? `${avgLevelSizeBtc.toFixed(3)}₿` : '--'}):
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {walls.length === 0 ? (
                  <span className="text-neutral-500">None &gt;5x in top 20 levels</span>
                ) : (
                  walls.slice(0, 3).map((w, idx) => (
                    <span
                      key={`${w.side}_${w.price}_${idx}`}
                      className={`px-1.5 py-0.5 rounded font-bold border ${
                        w.side === 'BID'
                          ? 'bg-teal-950/60 border-teal-500/40 text-teal-300'
                          : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
                      }`}
                    >
                      {w.side} ${w.price.toFixed(2)} · {w.qty.toFixed(3)}₿ ({w.multipleOfAvg.toFixed(1)}x)
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Top 8 Levels Table per side: price, size in BTC, cumulative size, depth bar */}
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs ${
              isStaleOrOffline ? 'opacity-60' : ''
            }`}
          >
            {/* Top 8 Bids (Teal) */}
            <div>
              <div className="grid grid-cols-3 text-[10px] text-neutral-400 uppercase pb-1.5 border-b border-white/5 px-1.5">
                <span>BID ($)</span>
                <span className="text-right">SIZE (BTC)</span>
                <span className="text-right">CUM (BTC)</span>
              </div>
              <div className="space-y-1 mt-1.5">
                {bids.slice(0, 8).map((b, idx) => {
                  const isBest = idx === 0;
                  return (
                    <div
                      key={b.price}
                      className={`relative grid grid-cols-3 items-center py-0.5 px-1.5 rounded overflow-hidden ${
                        isBest
                          ? 'ring-1 ring-teal-400/50 bg-teal-950/30 font-bold'
                          : ''
                      }`}
                    >
                      <div
                        className={`absolute left-0 inset-y-0 transition-all duration-150 ${
                          isStaleOrOffline ? 'bg-neutral-800/30' : 'bg-teal-500/20'
                        }`}
                        style={{ width: `${b.depthPct}%` }}
                      />
                      <span
                        className={`relative text-[11px] flex items-center gap-1 ${
                          isStaleOrOffline
                            ? 'text-neutral-400'
                            : isBest
                            ? 'text-teal-300 font-extrabold'
                            : 'text-teal-400 font-semibold'
                        }`}
                      >
                        <span>${b.price.toFixed(2)}</span>
                        {b.isWall && (
                          <span className="text-[8px] px-1 rounded bg-[#FFD97A]/20 text-[#FFD97A] border border-[#FFD97A]/40">
                            {b.multipleOfAvg}x
                          </span>
                        )}
                      </span>
                      <span className="relative text-right text-neutral-200 text-[11px]">
                        {b.qty.toFixed(4)}
                      </span>
                      <span className="relative text-right text-neutral-400 text-[11px]">
                        {b.total.toFixed(4)}
                      </span>
                    </div>
                  );
                })}
                {bids.length === 0 && (
                  <div className="text-neutral-600 text-center py-6 text-xs">
                    Waiting for btcusdt@depth20@100ms snapshot...
                  </div>
                )}
              </div>
            </div>

            {/* Top 8 Asks (Rose) */}
            <div>
              <div className="grid grid-cols-3 text-[10px] text-neutral-400 uppercase pb-1.5 border-b border-white/5 px-1.5">
                <span>ASK ($)</span>
                <span className="text-right">SIZE (BTC)</span>
                <span className="text-right">CUM (BTC)</span>
              </div>
              <div className="space-y-1 mt-1.5">
                {asks.slice(0, 8).map((a, idx) => {
                  const isBest = idx === 0;
                  return (
                    <div
                      key={a.price}
                      className={`relative grid grid-cols-3 items-center py-0.5 px-1.5 rounded overflow-hidden ${
                        isBest
                          ? 'ring-1 ring-rose-400/50 bg-rose-950/30 font-bold'
                          : ''
                      }`}
                    >
                      <div
                        className={`absolute right-0 inset-y-0 transition-all duration-150 ${
                          isStaleOrOffline ? 'bg-neutral-800/30' : 'bg-rose-500/20'
                        }`}
                        style={{ width: `${a.depthPct}%` }}
                      />
                      <span
                        className={`relative text-[11px] flex items-center gap-1 ${
                          isStaleOrOffline
                            ? 'text-neutral-400'
                            : isBest
                            ? 'text-rose-300 font-extrabold'
                            : 'text-rose-400 font-semibold'
                        }`}
                      >
                        <span>${a.price.toFixed(2)}</span>
                        {a.isWall && (
                          <span className="text-[8px] px-1 rounded bg-[#FFD97A]/20 text-[#FFD97A] border border-[#FFD97A]/40">
                            {a.multipleOfAvg}x
                          </span>
                        )}
                      </span>
                      <span className="relative text-right text-neutral-200 text-[11px]">
                        {a.qty.toFixed(4)}
                      </span>
                      <span className="relative text-right text-neutral-400 text-[11px]">
                        {a.total.toFixed(4)}
                      </span>
                    </div>
                  );
                })}
                {asks.length === 0 && (
                  <div className="text-neutral-600 text-center py-6 text-xs">
                    Waiting for btcusdt@depth20@100ms snapshot...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

OrderBookDepthCard.displayName = 'OrderBookDepthCard';
