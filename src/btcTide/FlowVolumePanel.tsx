import React from 'react';
import { BtcFeedStatus, WindowFlowStats, WindowOption } from './types';
import { Activity, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface FlowVolumePanelProps {
  stats: WindowFlowStats;
  selectedWindow: WindowOption;
  status: BtcFeedStatus;
}

function formatUsdCompact(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

export const FlowVolumePanel: React.FC<FlowVolumePanelProps> = React.memo(
  ({ stats, selectedWindow, status }) => {
    const isStaleOrOffline = status === 'STALE' || status === 'OFFLINE';
    const hasTrades = stats.tradeCount > 0 && stats.totalVolBtc > 0;

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
              FLOW &amp; VOLUME ({selectedWindow} WINDOW)
            </span>
          </div>
          <div className="font-mono text-[11px] text-neutral-400">
            {hasTrades
              ? `${stats.secondsCollected}s / ${stats.windowSeconds}s live window`
              : 'Collecting live trades...'}
          </div>
        </div>

        {/* Big BUY FLOW % and SELL FLOW % Boxes */}
        <div className="grid grid-cols-2 gap-3 mt-3.5">
          <div
            className={`rounded-xl p-3.5 border transition-colors ${
              isStaleOrOffline
                ? 'bg-neutral-900/40 border-neutral-800 text-neutral-500'
                : 'bg-teal-950/25 border-teal-500/35'
            }`}
          >
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-teal-400/90 flex items-center justify-between">
              <span>BUY FLOW %</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-teal-400" />
            </div>
            <div
              className={`font-mono text-2xl sm:text-3xl font-extrabold tracking-tight mt-1 ${
                isStaleOrOffline ? 'text-neutral-500' : 'text-teal-400'
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
              isStaleOrOffline
                ? 'bg-neutral-900/40 border-neutral-800 text-neutral-500'
                : 'bg-rose-950/25 border-rose-500/35'
            }`}
          >
            <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-rose-400/90 flex items-center justify-between">
              <span>SELL FLOW %</span>
              <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" />
            </div>
            <div
              className={`font-mono text-2xl sm:text-3xl font-extrabold tracking-tight mt-1 ${
                isStaleOrOffline ? 'text-neutral-500' : 'text-rose-400'
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
              className={`h-full rounded-l-full transition-all duration-200 ${
                isStaleOrOffline || !hasTrades
                  ? 'bg-neutral-700'
                  : 'bg-gradient-to-r from-teal-600 to-teal-400'
              }`}
              style={{ width: `${hasTrades ? Math.max(3, Math.min(97, buyPct)) : 50}%` }}
            />
            <div
              className={`h-full rounded-r-full transition-all duration-200 ${
                isStaleOrOffline || !hasTrades
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
