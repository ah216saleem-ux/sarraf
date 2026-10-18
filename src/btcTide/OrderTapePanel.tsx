import React, { useState, useMemo } from 'react';
import { AggTrade, BtcFeedStatus, TapeSizeFilter } from './types';
import { Terminal } from 'lucide-react';

interface OrderTapePanelProps {
  trades: AggTrade[];
  status: BtcFeedStatus;
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

export const OrderTapePanel: React.FC<OrderTapePanelProps> = React.memo(({ trades, status }) => {
  const [sizeFilter, setSizeFilter] = useState<TapeSizeFilter>('ALL');
  const isStaleOrOffline = status === 'STALE' || status === 'OFFLINE';

  const minUsd = useMemo(() => {
    const f = FILTER_OPTIONS.find((o) => o.key === sizeFilter);
    return f ? f.minUsd : 0;
  }, [sizeFilter]);

  const filteredTrades = useMemo(() => {
    if (minUsd <= 0) return trades.slice(0, 80);
    return trades.filter((t) => t.usdValue >= minUsd).slice(0, 80);
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
        </div>

        {/* Size Filters: ALL, $1K, $10K, $25K */}
        <div className="flex items-center p-0.5 rounded-lg bg-black/60 border border-white/10 font-mono text-[11px]">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.key}
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
        {filteredTrades.length === 0 ? (
          <div className="h-full flex items-center justify-center text-neutral-500 text-xs">
            {trades.length === 0
              ? 'collecting live data...'
              : `No live trades >= $${minUsd.toLocaleString()} seen yet...`}
          </div>
        ) : (
          filteredTrades.map((t) => {
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
                <span className={`col-span-2 font-bold text-[11px] ${rowColor}`}>
                  {t.aggressorSide}
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
