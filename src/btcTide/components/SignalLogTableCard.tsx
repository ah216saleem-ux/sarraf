import React from 'react';
import { BtcTideTradeRecord, BtcTideStats } from '../../server/btcTideSignalDatabase';
import { Database, TrendingUp, Award, Clock, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface SignalLogTableCardProps {
  closedTrades: BtcTideTradeRecord[];
  stats: BtcTideStats;
}

function formatPrice(val: number | null): string {
  if (val === null || val <= 0) return '--';
  return `$${val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDuration(startMs: number, endMs: number | null): string {
  if (!endMs) return '--';
  const sec = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}m ${ss}s`;
}

export const SignalLogTableCard: React.FC<SignalLogTableCardProps> = React.memo(
  ({ closedTrades, stats }) => {
    const { totalClosed, winRate, avgR, winsCount, lossesCount } = stats;

    return (
      <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 sm:p-5 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)] space-y-4">
        {/* Card Header & Global Stats */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                  SIGNAL OUTCOME LOG &amp; PERFORMANCE
                </span>
                <span className="font-mono text-[10px] px-2 py-0.2 rounded bg-white/5 border border-white/10 text-emerald-400 flex items-center gap-1">
                  <Database className="w-2.5 h-2.5" />
                  PERSISTED TO DISK DATABASE
                </span>
              </div>
              <div className="font-mono text-[11px] text-neutral-400">
                Tracked to real exchange execution (SL, TP1+BE, TP2, TP3, EXPIRED)
              </div>
            </div>
          </div>

          {/* Win Rate & Avg R Badges */}
          <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
            {/* Win Rate */}
            <div className="bg-black/60 border border-white/10 rounded-lg px-3 py-1.5 flex items-center gap-2">
              <Award className="w-4 h-4 text-[#FFD97A]" />
              <div>
                <div className="text-[9px] text-neutral-400 uppercase">WIN RATE</div>
                <div
                  className={`text-sm font-black ${
                    winRate === null
                      ? 'text-neutral-500'
                      : winRate >= 50
                      ? 'text-teal-400'
                      : 'text-rose-400'
                  }`}
                >
                  {winRate !== null ? `${winRate}%` : '--'}
                </div>
              </div>
            </div>

            {/* Average R */}
            <div className="bg-black/60 border border-white/10 rounded-lg px-3 py-1.5 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-teal-400" />
              <div>
                <div className="text-[9px] text-neutral-400 uppercase">AVERAGE R</div>
                <div
                  className={`text-sm font-black ${
                    avgR === null
                      ? 'text-neutral-500'
                      : avgR >= 0
                      ? 'text-teal-400'
                      : 'text-rose-400'
                  }`}
                >
                  {avgR !== null ? `${avgR > 0 ? '+' : ''}${avgR} R` : '--'}
                </div>
              </div>
            </div>

            {/* Total Closed Trades */}
            <div className="bg-black/60 border border-white/10 rounded-lg px-3 py-1.5">
              <div className="text-[9px] text-neutral-400 uppercase">CLOSED TRADES</div>
              <div className="text-sm font-black text-white">
                {totalClosed} ({winsCount}W / {lossesCount}L)
              </div>
            </div>
          </div>
        </div>

        {/* Closed Signals Table */}
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-xs text-left">
            <thead>
              <tr className="text-[10px] text-neutral-400 uppercase border-b border-white/5">
                <th className="py-2 px-2">TIME (UTC)</th>
                <th className="py-2 px-2">SIDE</th>
                <th className="py-2 px-2 text-right">ENTRY</th>
                <th className="py-2 px-2 text-right">SL</th>
                <th className="py-2 px-2 text-right">TP1 / TP2 / TP3</th>
                <th className="py-2 px-2 text-center">OUTCOME</th>
                <th className="py-2 px-2 text-right">REALIZED R</th>
                <th className="py-2 px-2 text-right">DURATION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {closedTrades.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-neutral-500 text-xs">
                    No closed signals yet. Signals fire only after &ge; 3 min of live data, &ge; 68%
                    confidence, and &ge; 22% lead over opposite side.
                  </td>
                </tr>
              ) : (
                closedTrades.map((t) => {
                  const isLong = t.side === 'LONG';
                  const isWin = typeof t.realizedR === 'number' && t.realizedR > 0;
                  const isLoss = typeof t.realizedR === 'number' && t.realizedR < 0;

                  return (
                    <tr key={t.id} className="hover:bg-white/5 transition-colors">
                      <td className="py-2.5 px-2 text-neutral-400 text-[11px]">
                        {new Date(t.entryTime).toISOString().replace('T', ' ').slice(5, 19)}
                      </td>

                      <td className="py-2.5 px-2">
                        <span
                          className={`font-black text-[10px] px-1.5 py-0.5 rounded ${
                            isLong
                              ? 'bg-teal-950/60 text-teal-300 border border-teal-500/40'
                              : 'bg-rose-950/60 text-rose-300 border border-rose-500/40'
                          }`}
                        >
                          {t.side}
                        </span>
                      </td>

                      <td className="py-2.5 px-2 text-right font-bold text-white">
                        {formatPrice(t.entryPrice)}
                      </td>

                      <td className="py-2.5 px-2 text-right text-rose-300">
                        {formatPrice(t.initialSlPrice)}
                      </td>

                      <td className="py-2.5 px-2 text-right text-neutral-300 text-[11px]">
                        <span>{formatPrice(t.tp1Price)}</span> /{' '}
                        <span>{formatPrice(t.tp2Price)}</span> /{' '}
                        <span className="text-[#FFD97A]">{formatPrice(t.tp3Price)}</span>
                      </td>

                      <td className="py-2.5 px-2 text-center">
                        <span
                          className={`font-bold text-[10px] px-2 py-0.5 rounded-full ${
                            t.outcome === 'TP3'
                              ? 'bg-teal-900/80 text-teal-200 border border-teal-400'
                              : t.outcome === 'TP2'
                              ? 'bg-teal-950/80 text-teal-300 border border-teal-500/40'
                              : t.outcome === 'TP1+BE'
                              ? 'bg-[#FFD97A]/20 text-[#FFD97A] border border-[#FFD97A]/40'
                              : t.outcome === 'SL'
                              ? 'bg-rose-950/80 text-rose-300 border border-rose-500/40'
                              : 'bg-neutral-900 text-neutral-400 border border-neutral-700'
                          }`}
                        >
                          {t.outcome || 'CLOSED'}
                        </span>
                      </td>

                      <td
                        className={`py-2.5 px-2 text-right font-extrabold ${
                          isWin ? 'text-teal-400' : isLoss ? 'text-rose-400' : 'text-neutral-300'
                        }`}
                      >
                        {typeof t.realizedR === 'number'
                          ? `${t.realizedR > 0 ? '+' : ''}${t.realizedR.toFixed(2)} R`
                          : '--'}
                      </td>

                      <td className="py-2.5 px-2 text-right text-neutral-400 text-[11px]">
                        {formatDuration(t.entryTime, t.closedAt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
);

SignalLogTableCard.displayName = 'SignalLogTableCard';
