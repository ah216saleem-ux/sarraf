import React from 'react';
import { AggTrade, BtcFeedStatus } from './types';
import { Flame } from 'lucide-react';

interface LargePrintsPanelProps {
  largePrints: AggTrade[];
  status: BtcFeedStatus;
  isSpotStale?: boolean;
  spotAgeMs?: number;
}

function formatUtcTimeSec(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatUsdSize(val: number): string {
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  return `$${(val / 1e3).toFixed(1)}K`;
}

export const LargePrintsPanel: React.FC<LargePrintsPanelProps> = React.memo(
  ({ largePrints, status, isSpotStale = false, spotAgeMs = 0 }) => {
    const isStaleOrOffline = isSpotStale || status === 'STALE' || status === 'OFFLINE';
    const ageLabel =
      spotAgeMs > 0 && spotAgeMs < 999999 ? `${(spotAgeMs / 1000).toFixed(1)}s` : '--';

    return (
      <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 backdrop-blur-md flex flex-col shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-[#FFD97A]" />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
              LARGE PRINTS (&gt;= $50K)
            </span>
            {isStaleOrOffline && (
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300">
                STALE · {ageLabel}
              </span>
            )}
          </div>
          <span
            className={`font-mono text-[11px] ${
              isStaleOrOffline ? 'text-neutral-500' : 'text-neutral-400'
            }`}
          >
            {largePrints.length} SEEN
          </span>
        </div>

        {/* Column Headers: Time, Side, Size, Price */}
        <div className="grid grid-cols-12 gap-1 font-mono text-[10px] text-neutral-400 uppercase py-2 border-b border-white/5">
          <span className="col-span-3">TIME</span>
          <span className="col-span-2">SIDE</span>
          <span className="col-span-4 text-right">SIZE</span>
          <span className="col-span-3 text-right">PRICE</span>
        </div>

        {/* Scrollable List */}
        <div className="h-64 overflow-y-auto divide-y divide-white/[0.04] font-mono text-xs pr-1">
          {largePrints.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-neutral-500 text-xs text-center px-4">
              <span>Waiting for live prints &gt;= $50,000...</span>
              <span className="text-[10px] text-neutral-600 mt-1">
                Populates strictly from real exchange executions
              </span>
            </div>
          ) : (
            largePrints.map((p) => {
              const isBuy = p.aggressorSide === 'BUY';
              const sideColor = isStaleOrOffline
                ? 'text-neutral-500'
                : isBuy
                ? 'text-teal-400'
                : 'text-rose-400';

              return (
                <div
                  key={p.id}
                  className={`grid grid-cols-12 gap-1 items-center py-1.5 px-1.5 ${
                    isStaleOrOffline
                      ? ''
                      : isBuy
                      ? 'bg-teal-950/20'
                      : 'bg-rose-950/20'
                  }`}
                >
                  <span className="col-span-3 text-[11px] text-neutral-400 truncate">
                    {formatUtcTimeSec(p.time)}
                  </span>
                  <span className={`col-span-2 font-bold text-[11px] ${sideColor}`}>
                    {p.aggressorSide}
                  </span>
                  <span className={`col-span-4 text-right font-bold truncate ${sideColor}`}>
                    {formatUsdSize(p.usdValue)}{' '}
                    <span className="text-[10px] font-normal text-neutral-400">
                      ({p.qty.toFixed(3)} BTC)
                    </span>
                  </span>
                  <span
                    className={`col-span-3 text-right font-semibold truncate ${
                      isStaleOrOffline ? 'text-neutral-500' : 'text-white'
                    }`}
                  >
                    ${p.price.toFixed(2)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }
);

LargePrintsPanel.displayName = 'LargePrintsPanel';
