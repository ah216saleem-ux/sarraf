import React, { useState, useMemo } from 'react';
import { AggTrade, BtcFeedStatus, TapeSizeFilter } from './types';
import { Terminal } from 'lucide-react';

interface OrderTapePanelProps {
  trades: AggTrade[];
  status: BtcFeedStatus;
  isSpotStale?: boolean;
  spotAgeMs?: number;
}

interface GroupedTapeRow {
  id: string;
  anchorTime: number;
  time: number;
  price: number;
  qty: number;
  usdValue: number;
  aggressorSide: 'BUY' | 'SELL';
  fillCount: number;
}

const FILTER_OPTIONS: { key: TapeSizeFilter; label: string; minUsd: number }[] = [
  { key: 'ALL', label: 'ALL', minUsd: 0 },
  { key: '1K', label: '$1K', minUsd: 1000 },
  { key: '10K', label: '$10K', minUsd: 10000 },
  { key: '25K', label: '$25K', minUsd: 25000 },
];

function formatUtcTimeMs(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0').slice(0, 2);
  return `${hh}:${mm}:${ss}.${ms}`;
}

function formatUsdSize(val: number): string {
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

export const OrderTapePanel: React.FC<OrderTapePanelProps> = React.memo(
  ({ trades, status, isSpotStale = false, spotAgeMs = 0 }) => {
    // Default filter is $1K per specification
    const [sizeFilter, setSizeFilter] = useState<TapeSizeFilter>('1K');
    const isStaleOrOffline = isSpotStale || status === 'STALE' || status === 'OFFLINE';
    const ageLabel =
      spotAgeMs > 0 && spotAgeMs < 999999 ? `${(spotAgeMs / 1000).toFixed(1)}s` : '--';

    const minUsd = useMemo(() => {
      const f = FILTER_OPTIONS.find((o) => o.key === sizeFilter);
      return f ? f.minUsd : 1000;
    }, [sizeFilter]);

    // Group fills with the same price and side inside 100 ms into one row
    const groupedTrades = useMemo(() => {
      const groups: GroupedTapeRow[] = [];

      for (let i = 0; i < trades.length; i++) {
        const t = trades[i];
        const prev = groups[groups.length - 1];

        if (
          prev &&
          prev.aggressorSide === t.aggressorSide &&
          Math.abs(prev.price - t.price) < 0.005 &&
          Math.abs(prev.anchorTime - t.time) <= 100
        ) {
          prev.qty += t.qty;
          prev.usdValue += t.usdValue;
          prev.fillCount += 1;
        } else {
          groups.push({
            id: `${t.id}-${t.time}`,
            anchorTime: t.time,
            time: t.time,
            price: t.price,
            qty: t.qty,
            usdValue: t.usdValue,
            aggressorSide: t.aggressorSide,
            fillCount: 1,
          });
        }
      }

      if (minUsd <= 0) return groups.slice(0, 80);
      return groups.filter((g) => g.usdValue >= minUsd).slice(0, 80);
    }, [trades, minUsd]);

    return (
      <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 backdrop-blur-md flex flex-col shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
        {/* Header & Size Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[#FFD97A]" />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
              ORDER TAPE
            </span>
            <span className="font-mono text-[10px] text-neutral-500">100ms grouped</span>
            {isStaleOrOffline && (
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300">
                STALE · {ageLabel}
              </span>
            )}
          </div>

        {/* Size Filters: ALL, $1K (default), $10K, $25K */}
        <div className="flex items-center p-0.5 rounded-lg bg-black/60 border border-white/10 font-mono text-[11px]">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setSizeFilter(opt.key)}
              className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                sizeFilter === opt.key
                  ? 'bg-[#E8B84A] text-black font-bold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-12 gap-1 font-mono text-[10px] text-neutral-400 uppercase py-2 border-b border-white/5">
        <span className="col-span-3">UTC TIME</span>
        <span className="col-span-2">SIDE</span>
        <span className="col-span-3 text-right">PRICE</span>
        <span className="col-span-2 text-right">BTC</span>
        <span className="col-span-2 text-right">USD</span>
      </div>

      {/* Scrollable Trade Rows */}
      <div className="h-64 overflow-y-auto divide-y divide-white/[0.03] font-mono text-xs pr-1">
        {groupedTrades.length === 0 ? (
          <div className="h-full flex items-center justify-center text-neutral-500 text-xs">
            {trades.length === 0
              ? 'collecting live data...'
              : `No live grouped fills >= $${minUsd.toLocaleString()} seen yet...`}
          </div>
        ) : (
          groupedTrades.map((t) => {
            const isBuy = t.aggressorSide === 'BUY';
            const rowColor = isStaleOrOffline
              ? 'text-neutral-500'
              : isBuy
              ? 'text-teal-400'
              : 'text-rose-400';

            return (
              <div
                key={t.id}
                className={`grid grid-cols-12 gap-1 items-center py-1 px-1 ${
                  t.usdValue >= 25000
                    ? isBuy
                      ? 'bg-teal-950/25'
                      : 'bg-rose-950/25'
                    : ''
                }`}
              >
                <span className="col-span-3 text-[11px] text-neutral-400 truncate">
                  {formatUtcTimeMs(t.time)}
                </span>
                <span className={`col-span-2 font-bold text-[11px] flex items-center gap-1 ${rowColor}`}>
                  <span>{t.aggressorSide}</span>
                  {t.fillCount > 1 && (
                    <span className="text-[9px] px-1 rounded bg-white/10 text-neutral-300 font-normal">
                      ×{t.fillCount}
                    </span>
                  )}
                </span>
                <span className={`col-span-3 text-right font-semibold truncate ${rowColor}`}>
                  ${t.price.toFixed(2)}
                </span>
                <span className="col-span-2 text-right text-neutral-300 truncate">
                  {t.qty.toFixed(4)}
                </span>
                <span className={`col-span-2 text-right font-semibold truncate ${rowColor}`}>
                  {formatUsdSize(t.usdValue)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

OrderTapePanel.displayName = 'OrderTapePanel';
