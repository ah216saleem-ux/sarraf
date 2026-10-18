import React from 'react';
import { BtcFeedStatus, WindowFlowStats, WindowOption } from './types';
import { Activity, ArrowUpRight, ArrowDownRight, Clock } from 'lucide-react';

interface FlowVolumePanelProps {
  stats: WindowFlowStats;
  selectedWindow: WindowOption;
  status: BtcFeedStatus;
  isSpotStale?: boolean;
  spotAgeMs?: number;
}

function formatUsdCompact(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

export const FlowVolumePanel: React.FC<FlowVolumePanelProps> = React.memo(
  ({ stats, selectedWindow, status, isSpotStale = false, spotAgeMs = 0 }) => {
    const isStaleOrOffline = isSpotStale || status === 'STALE' || status === 'OFFLINE';
    const ageLabel =
      spotAgeMs > 0 && spotAgeMs < 999999 ? `${(spotAgeMs / 1000).toFixed(1)}s` : '--';
    const hasTrades = stats.tradeCount > 0 && stats.totalVolBtc > 0;
    const isWarming = !stats.isFullWindow || stats.secondsCollected < stats.windowSeconds;
    const isPctGreyed = isStaleOrOffline || isWarming || !hasTrades;

    const buyPct = stats.buyFlowPct !== null ? stats.buyFlowPct : 50;
    const sellPct = stats.sellFlowPct !== null ? stats.sellFlowPct : 50;
    const isDeltaPositive = stats.deltaBtc >= 0;

    return (
      <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
        {/* Panel Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#FFD97A]" />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
              FLOW &amp; VOLUME ({selectedWindow} WINDOW · 3S SMOOTHED)
            </span>
            {isStaleOrOffline && (
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300">
                STALE · {ageLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px]">
            {isWarming ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/40 border border-amber-500/30 text-amber-300 font-semibold">
                <Clock className="w-3 h-3 text-amber-400" />
                warming {stats.secondsCollected}/{stats.windowSeconds} s
              </span>
            ) : (
              <span className="text-teal-400 font-semibold">
                full {stats.windowSeconds}/{stats.windowSeconds} s window
              </span>
            )}
          </div>
        </div>

        {/* Big BUY FLOW % and SELL FLOW % Boxes (Full window only; greyed out while warming) */}
        <div className="grid grid-cols-2 gap-3 mt-3.5">
          <div
            className={`rounded-xl p-3.5 border transition-colors ${
              isPctGreyed
                ? 'bg-neutral-900/45 border-neutral-800 text-neutral-500'
                : 'bg-teal-950/25 border-teal-500/35'
            }`}
          >
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-between">
              <span className={isPctGreyed ? 'text-neutral-500' : 'text-teal-400/90'}>
                BUY FLOW %
              </span>
              {isWarming ? (
                <span className="text-[9px] text-neutral-500 lowercase font-normal">
                  warming {stats.secondsCollected}/{stats.windowSeconds} s
                </span>
              ) : (
                <ArrowUpRight className="w-3.5 h-3.5 text-teal-400" />
              )}
            </div>
            <div
              className={`font-mono text-2xl sm:text-3xl font-extrabold tracking-tight mt-1 ${
                isPctGreyed ? 'text-neutral-500' : 'text-teal-400'
              }`}
            >
              {hasTrades && stats.buyFlowPct !== null
                ? `${stats.buyFlowPct.toFixed(1)}%`
                : '--'}
            </div>
            <div className="font-mono text-[11px] text-neutral-400 mt-1">
              {hasTrades
                ? `${stats.buyVolBtc.toFixed(4)} BTC · ${formatUsdCompact(stats.buyVolUsd)}`
                : '--'}
            </div>
          </div>

          <div
            className={`rounded-xl p-3.5 border transition-colors ${
              isPctGreyed
                ? 'bg-neutral-900/45 border-neutral-800 text-neutral-500'
                : 'bg-rose-950/25 border-rose-500/35'
            }`}
          >
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider flex items-center justify-between">
              <span className={isPctGreyed ? 'text-neutral-500' : 'text-rose-400/90'}>
                SELL FLOW %
              </span>
              {isWarming ? (
                <span className="text-[9px] text-neutral-500 lowercase font-normal">
                  warming {stats.secondsCollected}/{stats.windowSeconds} s
                </span>
              ) : (
                <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" />
              )}
            </div>
            <div
              className={`font-mono text-2xl sm:text-3xl font-extrabold tracking-tight mt-1 ${
                isPctGreyed ? 'text-neutral-500' : 'text-rose-400'
              }`}
            >
              {hasTrades && stats.sellFlowPct !== null
                ? `${stats.sellFlowPct.toFixed(1)}%`
                : '--'}
            </div>
            <div className="font-mono text-[11px] text-neutral-400 mt-1">
              {hasTrades
                ? `${stats.sellVolBtc.toFixed(4)} BTC · ${formatUsdCompact(stats.sellVolUsd)}`
                : '--'}
            </div>
          </div>
        </div>

        {/* Buy / Sell Split Bar */}
        <div className="mt-3.5">
          <div className="h-3 bg-neutral-900 rounded-full overflow-hidden flex border border-white/10 p-0.5">
            <div
              className={`h-full rounded-l-full transition-all duration-300 ${
                isPctGreyed
                  ? 'bg-neutral-700'
                  : 'bg-gradient-to-r from-teal-600 to-teal-400'
              }`}
              style={{ width: `${hasTrades ? Math.max(3, Math.min(97, buyPct)) : 50}%` }}
            />
            <div
              className={`h-full rounded-r-full transition-all duration-300 ${
                isPctGreyed
                  ? 'bg-neutral-800'
                  : 'bg-gradient-to-l from-rose-600 to-rose-400'
              }`}
              style={{ width: `${hasTrades ? Math.max(3, Math.min(97, sellPct)) : 50}%` }}
            />
          </div>
        </div>

        {/* 4 Metric Cells: Buy Volume, Sell Volume, Net Delta, Trade Count */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3.5 pt-3 border-t border-white/5 font-mono">
          <div className="bg-black/40 border border-white/5 rounded-lg p-2.5">
            <div className="text-[10px] text-neutral-400 uppercase">BUY VOLUME</div>
            <div
              className={`text-sm sm:text-base font-bold mt-0.5 ${
                isStaleOrOffline ? 'text-neutral-500' : 'text-teal-400'
              }`}
            >
              {hasTrades ? `${stats.buyVolBtc.toFixed(4)} BTC` : '--'}
            </div>
            <div className="text-[10px] text-neutral-400 mt-0.5">
              {hasTrades ? formatUsdCompact(stats.buyVolUsd) : '--'}
            </div>
          </div>

          <div className="bg-black/40 border border-white/5 rounded-lg p-2.5">
            <div className="text-[10px] text-neutral-400 uppercase">SELL VOLUME</div>
            <div
              className={`text-sm sm:text-base font-bold mt-0.5 ${
                isStaleOrOffline ? 'text-neutral-500' : 'text-rose-400'
              }`}
            >
              {hasTrades ? `${stats.sellVolBtc.toFixed(4)} BTC` : '--'}
            </div>
            <div className="text-[10px] text-neutral-400 mt-0.5">
              {hasTrades ? formatUsdCompact(stats.sellVolUsd) : '--'}
            </div>
          </div>

          <div className="bg-black/40 border border-white/5 rounded-lg p-2.5">
            <div className="text-[10px] text-neutral-400 uppercase">NET DELTA</div>
            <div
              className={`text-sm sm:text-base font-bold mt-0.5 ${
                isStaleOrOffline
                  ? 'text-neutral-500'
                  : isDeltaPositive
                  ? 'text-teal-400'
                  : 'text-rose-400'
              }`}
            >
              {hasTrades
                ? `${isDeltaPositive ? '+' : ''}${stats.deltaBtc.toFixed(4)} BTC`
                : '--'}
            </div>
            <div className="text-[10px] text-neutral-400 mt-0.5">
              {hasTrades
                ? `${isDeltaPositive ? '+' : '-'}${formatUsdCompact(Math.abs(stats.deltaUsd))}`
                : '--'}
            </div>
          </div>

          <div className="bg-black/40 border border-white/5 rounded-lg p-2.5">
            <div className="text-[10px] text-neutral-400 uppercase">TRADE COUNT</div>
            <div
              className={`text-sm sm:text-base font-bold mt-0.5 ${
                isStaleOrOffline ? 'text-neutral-500' : 'text-[#FFD97A]'
              }`}
            >
              {hasTrades ? stats.tradeCount.toLocaleString() : '--'}
            </div>
            <div className="text-[10px] text-neutral-400 mt-0.5">
              {hasTrades ? `${formatUsdCompact(stats.totalVolUsd)} total` : '--'}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

FlowVolumePanel.displayName = 'FlowVolumePanel';
