// src/doji/TradeLogSection.tsx
import React, { useState, useMemo } from 'react';
import { Clock, Activity } from 'lucide-react';
import { DojiTrade, computeLivePnl } from './dojiSignalEngine';
import {
  DojiTimeframe,
  formatSignedDollar,
  formatHeldDuration,
} from './dojiEngine';

interface TradeLogSectionProps {
  trades: DojiTrade[];
  livePrice: number;
}

export const TradeLogSection: React.FC<TradeLogSectionProps> = ({
  trades,
  livePrice,
}) => {
  const [selectedTfFilter, setSelectedTfFilter] = useState<'All' | DojiTimeframe>('All');
  const [selectedResultFilter, setSelectedResultFilter] = useState<'All' | 'Wins' | 'Losses'>('All');

  const getTradePnl = (t: DojiTrade): number => {
    if (t.status === 'OPEN') {
      if (livePrice > 0) {
        return computeLivePnl(t, livePrice);
      }
      return typeof t.livePnlDollars === 'number' ? t.livePnlDollars : t.pnlDollars;
    }
    return t.pnlDollars;
  };

  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      if (selectedTfFilter !== 'All' && t.timeframe !== selectedTfFilter) return false;
      const isWin = t.result === 'TP1' || t.result === 'TP2' || t.result === 'TP3';
      const isLoss = t.result === 'SL';
      if (selectedResultFilter === 'Wins' && !isWin) return false;
      if (selectedResultFilter === 'Losses' && !isLoss) return false;
      return true;
    });
  }, [trades, selectedTfFilter, selectedResultFilter]);

  const stats = useMemo(() => {
    const totalTrades = trades.length;
    const wins = trades.filter((t) => t.result === 'TP1' || t.result === 'TP2' || t.result === 'TP3').length;
    const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
    const netPnl = trades.reduce((acc, t) => acc + getTradePnl(t), 0);

    return {
      totalTrades,
      reachedTp1Count: wins,
      winRate,
      netPnl: Number(netPnl.toFixed(2)),
    };
  }, [trades, livePrice]);

  const equityPoints = useMemo(() => {
    if (trades.length === 0) return [];
    let running = 0;
    const pts = [0];
    const chronological = [...trades].reverse();
    for (const t of chronological) {
      running += getTradePnl(t);
      pts.push(Number(running.toFixed(2)));
    }
    return pts;
  }, [trades, livePrice]);

  const minEquity = equityPoints.length > 0 ? Math.min(...equityPoints) : 0;
  const maxEquity = equityPoints.length > 0 ? Math.max(...equityPoints) : 10;
  const equityRange = maxEquity - minEquity || 1;

  return (
    <div className="p-4 rounded-[12px] bg-[#12100c] border border-[#2b261b] space-y-4 font-['DM_Sans',sans-serif]">
      {/* Title & Summary Tiles */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#2b261b]">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#d9b25a]" />
            <h2 className="text-base font-bold text-[#f0eadb] font-['Bricolage_Grotesque',sans-serif]">
              Trade log
            </h2>
          </div>
          <span className="text-xs text-[#9d947e]">
            Results on loaded candles
          </span>
        </div>

        {/* 3 Summary Tiles: Trades / Reached TP1 / Net */}
        <div className="flex items-center gap-2 flex-wrap font-['JetBrains_Mono',monospace] tabular-nums">
          <div className="bg-[#1a1711] px-3 py-1.5 rounded-[8px] border border-[#2b261b]">
            <span className="text-[10px] text-[#9d947e] uppercase block font-['DM_Sans',sans-serif]">Trades</span>
            <span className="text-xs sm:text-sm font-bold text-[#f0eadb]">{stats.totalTrades}</span>
          </div>

          <div className="bg-[#1a1711] px-3 py-1.5 rounded-[8px] border border-[#2b261b]">
            <span className="text-[10px] text-[#9d947e] uppercase block font-['DM_Sans',sans-serif]">Reached TP1</span>
            <span className="text-xs sm:text-sm font-bold text-[#3fbf8f]">
              {stats.reachedTp1Count} ({stats.winRate}%)
            </span>
          </div>

          <div className="bg-[#1a1711] px-3 py-1.5 rounded-[8px] border border-[#2b261b]">
            <span className="text-[10px] text-[#9d947e] uppercase block font-['DM_Sans',sans-serif]">Net</span>
            <span
              className={`text-xs sm:text-sm font-bold ${
                stats.netPnl >= 0 ? 'text-[#3fbf8f]' : 'text-[#e5584f]'
              }`}
            >
              {formatSignedDollar(stats.netPnl)}
            </span>
          </div>
        </div>
      </div>

      {/* Running P/L Sparkline */}
      {equityPoints.length > 1 && (
        <div className="p-3 rounded-[8px] bg-[#1a1711] border border-[#2b261b] space-y-1">
          <div className="flex items-center justify-between text-[11px] text-[#9d947e]">
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3 text-[#d9b25a]" />
              <span>Running P/L</span>
            </span>
            <span className="font-bold text-[#f2d78f] font-['JetBrains_Mono',monospace] tabular-nums">
              {formatSignedDollar(stats.netPnl)}
            </span>
          </div>

          <div className="h-14 w-full relative">
            <svg className="w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#d9b25a" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#d9b25a" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {(() => {
                const zeroY = 90 - ((0 - minEquity) / equityRange) * 80;
                return (
                  <line
                    x1="0"
                    y1={zeroY}
                    x2="100"
                    y2={zeroY}
                    stroke="#2b261b"
                    strokeDasharray="2 2"
                    strokeWidth="0.6"
                  />
                );
              })()}

              <path
                d={`M 0 100 ${equityPoints
                  .map((val, idx) => {
                    const x = (idx / (equityPoints.length - 1)) * 100;
                    const y = 90 - ((val - minEquity) / equityRange) * 80;
                    return `L ${x} ${y}`;
                  })
                  .join(' ')} L 100 100 Z`}
                fill="url(#equityGrad)"
              />

              <path
                d={equityPoints
                  .map((val, idx) => {
                    const x = (idx / (equityPoints.length - 1)) * 100;
                    const y = 90 - ((val - minEquity) / equityRange) * 80;
                    return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                  })
                  .join(' ')}
                fill="none"
                stroke={stats.netPnl >= 0 ? '#d9b25a' : '#e5584f'}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      )}

      {/* Filters: Timeframe & Result */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1 bg-[#1a1711] p-1 rounded-[8px] border border-[#2b261b] font-['JetBrains_Mono',monospace]">
          {(['All', '15m', '30m', '1h', '4h'] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setSelectedTfFilter(tf)}
              className={`px-2.5 py-1 rounded-[6px] transition-colors font-semibold cursor-pointer ${
                selectedTfFilter === tf
                  ? 'bg-[#12100c] text-[#f2d78f] border border-[#d9b25a]'
                  : 'text-[#9d947e] hover:text-[#f0eadb] border border-transparent'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-[#1a1711] p-1 rounded-[8px] border border-[#2b261b]">
          {(['All', 'Wins', 'Losses'] as const).map((res) => (
            <button
              key={res}
              onClick={() => setSelectedResultFilter(res)}
              className={`px-2.5 py-1 rounded-[6px] transition-colors font-semibold cursor-pointer ${
                selectedResultFilter === res
                  ? 'bg-[#12100c] text-[#f2d78f] border border-[#d9b25a]'
                  : 'text-[#9d947e] hover:text-[#f0eadb] border border-transparent'
              }`}
            >
              {res}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop View: Table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-[#2b261b] text-[11px] text-[#9d947e] font-semibold">
              <th className="py-2.5 px-3">Time</th>
              <th className="py-2.5 px-2">TF</th>
              <th className="py-2.5 px-2">Side</th>
              <th className="py-2.5 px-2">Strength</th>
              <th className="py-2.5 px-3">Entry</th>
              <th className="py-2.5 px-3">SL</th>
              <th className="py-2.5 px-2 text-center">Held</th>
              <th className="py-2.5 px-3 text-center">Result</th>
              <th className="py-2.5 px-3 text-right">P/L</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2b261b] font-['JetBrains_Mono',monospace] tabular-nums">
            {filteredTrades.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-[#9d947e] font-['DM_Sans',sans-serif] text-xs">
                  No trades match the selected filter
                </td>
              </tr>
            ) : (
              filteredTrades.map((t) => {
                const isBuy = t.side === 'BUY';
                const isWin = t.result === 'TP1' || t.result === 'TP2' || t.result === 'TP3';
                const pnl = getTradePnl(t);
                const heldText = t.heldDisplay || formatHeldDuration(t.barsHeld, t.timeframe);

                return (
                  <tr key={t.id} className="hover:bg-[#1a1711]/60 transition-colors">
                    <td className="py-2.5 px-3 text-[#9d947e] whitespace-nowrap">
                      {t.entryTimeDisplay}
                    </td>
                    <td className="py-2.5 px-2">
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-[#1a1711] text-[#f2d78f] border border-[#2b261b]">
                        {t.timeframe}
                      </span>
                    </td>
                    <td className="py-2.5 px-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          isBuy
                            ? 'bg-[#3fbf8f]/15 text-[#3fbf8f] border-[#3fbf8f]/40'
                            : 'bg-[#e5584f]/15 text-[#e5584f] border-[#e5584f]/40'
                        }`}
                      >
                        {t.side}
                      </span>
                    </td>
                    <td className="py-2.5 px-2">
                      <span
                        className="font-bold text-[11px]"
                        style={{ color: t.zoneStrengthColor }}
                      >
                        {t.zoneStrength.toFixed(1)}/10
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-bold text-[#f0eadb]">
                      ${t.entryPrice.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-[#9d947e] whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span>${t.initialSl.toFixed(2)}</span>
                        {t.isBreakeven && (
                          <span className="px-1.5 py-0.5 rounded bg-[#1a1711] border border-[#2b261b] text-[#9d947e] text-[10px] font-bold">
                            BE
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-center text-[#9d947e] whitespace-nowrap">
                      {heldText}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          t.status === 'OPEN'
                            ? 'bg-[#1a1711] text-[#f2d78f] border-[#d9b25a]/50'
                            : isWin
                            ? 'bg-[#3fbf8f]/15 text-[#3fbf8f] border-[#3fbf8f]/40'
                            : 'bg-[#e5584f]/15 text-[#e5584f] border-[#e5584f]/40'
                        }`}
                      >
                        {t.status === 'OPEN' ? 'Open' : t.result}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold whitespace-nowrap">
                      <span className={pnl >= 0 ? 'text-[#3fbf8f]' : 'text-[#e5584f]'}>
                        {formatSignedDollar(pnl)}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile View: Cards */}
      <div className="block sm:hidden space-y-2.5">
        {filteredTrades.length === 0 ? (
          <div className="py-6 text-center text-[#9d947e] text-xs">
            No trades found
          </div>
        ) : (
          filteredTrades.map((t) => {
            const isBuy = t.side === 'BUY';
            const isWin = t.result === 'TP1' || t.result === 'TP2' || t.result === 'TP3';
            const pnl = getTradePnl(t);
            const heldText = t.heldDisplay || formatHeldDuration(t.barsHeld, t.timeframe);

            return (
              <div
                key={t.id}
                className="p-3 rounded-[8px] bg-[#1a1711] border border-[#2b261b] space-y-2 text-xs font-['JetBrains_Mono',monospace] tabular-nums"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        isBuy
                          ? 'bg-[#3fbf8f]/15 text-[#3fbf8f] border-[#3fbf8f]/40'
                          : 'bg-[#e5584f]/15 text-[#e5584f] border-[#e5584f]/40'
                      }`}
                    >
                      {t.side}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#12100c] text-[#f2d78f] border border-[#2b261b]">
                      {t.timeframe}
                    </span>
                    <span className="text-[11px] text-[#9d947e]">
                      {t.entryTimeDisplay}
                    </span>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                      t.status === 'OPEN'
                        ? 'bg-[#12100c] text-[#f2d78f] border-[#d9b25a]/50'
                        : isWin
                        ? 'bg-[#3fbf8f]/15 text-[#3fbf8f] border-[#3fbf8f]/40'
                        : 'bg-[#e5584f]/15 text-[#e5584f] border-[#e5584f]/40'
                    }`}
                  >
                    {t.status === 'OPEN' ? 'Open' : t.result}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-[#12100c] p-2 rounded-[6px] border border-[#2b261b] text-[11px]">
                  <div>
                    <span className="text-[9px] text-[#9d947e] block font-['DM_Sans',sans-serif]">ENTRY</span>
                    <span className="font-bold text-[#f0eadb]">${t.entryPrice.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-[#9d947e] block font-['DM_Sans',sans-serif]">SL</span>
                    <span className="inline-flex items-center gap-1 text-[#e5584f] font-bold">
                      <span>${t.initialSl.toFixed(2)}</span>
                      {t.isBreakeven && (
                        <span className="px-1 py-0.2 rounded bg-[#1a1711] border border-[#2b261b] text-[#9d947e] text-[9px] font-bold">
                          BE
                        </span>
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] text-[#9d947e] block font-['DM_Sans',sans-serif]">HELD</span>
                    <span className="text-[#f0eadb]">{heldText}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 text-[11px]">
                  <span className="text-[#9d947e] font-['DM_Sans',sans-serif]">
                    Strength:{' '}
                    <strong className="font-['JetBrains_Mono',monospace]" style={{ color: t.zoneStrengthColor }}>
                      {t.zoneStrength.toFixed(1)}/10
                    </strong>
                  </span>
                  <div className="flex items-center gap-1 font-bold">
                    <span className="text-[#9d947e] font-['DM_Sans',sans-serif]">P/L:</span>
                    <span className={pnl >= 0 ? 'text-[#3fbf8f]' : 'text-[#e5584f]'}>
                      {formatSignedDollar(pnl)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
