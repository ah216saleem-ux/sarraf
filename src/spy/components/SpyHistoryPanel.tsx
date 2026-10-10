import React, { useState } from 'react';
import { SpyHistoryRecord, SpyHistoryStats, SpyExpiryOption } from '../types';
import {
  History,
  ArrowUpRight,
  ArrowDownRight,
  Shield,
  Clock,
  TrendingUp,
  Award,
  AlertCircle,
  Percent,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

interface SpyHistoryPanelProps {
  history: SpyHistoryRecord[];
  stats: SpyHistoryStats | null;
}

export const SpyHistoryPanel: React.FC<SpyHistoryPanelProps> = ({ history, stats }) => {
  const [filterExpiry, setFilterExpiry] = useState<SpyExpiryOption | 'ALL'>('ALL');

  const filteredHistory =
    filterExpiry === 'ALL'
      ? history
      : history.filter((h) => h.expiry === filterExpiry);

  const activeStatsItem = stats
    ? filterExpiry === 'ALL'
      ? stats.total
      : stats.perExpiry[filterExpiry]
    : { total: 0, wins: 0, losses: 0, winRate: null, active: 0 };

  const noTradeCount = stats?.noTradeCount || 0;

  return (
    <div className="glass-panel p-4 sm:p-6 rounded-2xl border border-white/10 bg-black/60 shadow-[0_4px_30px_rgba(0,0,0,0.6)] space-y-5">
      {/* Header & Expiry Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <History className="w-5 h-5 text-[#E8B84A]" />
          <div>
            <h3 className="font-mono text-sm sm:text-base font-bold text-white tracking-wider">
              SPY OPTIONS PERFORMANCE & AUDIT TRAIL
            </h3>
            <p className="font-mono text-[11px] text-neutral-400">
              Auto-resolved at expiry against real tick data. 100% deterministic audit log.
            </p>
          </div>
        </div>

        {/* Expiry Filter Pills */}
        <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/10 font-mono text-xs overflow-x-auto max-w-full">
          {(['ALL', '15m', '30m', '45m', '1H', '4H', 'CLOSE'] as const).map((exp) => (
            <button
              key={exp}
              onClick={() => setFilterExpiry(exp)}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                filterExpiry === exp
                  ? 'bg-[#E8B84A] text-black font-bold shadow-[0_0_10px_rgba(232,184,74,0.3)]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              {exp}
            </button>
          ))}
        </div>
      </div>

      {/* Institutional Stats Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono">
        <div className="p-3.5 rounded-xl bg-white/5 border border-white/10">
          <div className="text-[10px] text-neutral-400 uppercase tracking-wider">RESOLVED SIGNALS</div>
          <div className="text-xl font-black text-white mt-1">{activeStatsItem.total}</div>
          <div className="text-[10px] text-neutral-500 mt-0.5">
            Active: <span className="text-[#E8B84A] font-bold">{activeStatsItem.active}</span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/20">
          <div className="text-[10px] text-emerald-400 uppercase tracking-wider">WINS</div>
          <div className="text-xl font-black text-emerald-300 mt-1">{activeStatsItem.wins}</div>
          <div className="text-[10px] text-emerald-500/80 mt-0.5">Target / Settle</div>
        </div>

        <div className="p-3.5 rounded-xl bg-rose-950/20 border border-rose-500/20">
          <div className="text-[10px] text-rose-400 uppercase tracking-wider">LOSSES</div>
          <div className="text-xl font-black text-rose-300 mt-1">{activeStatsItem.losses}</div>
          <div className="text-[10px] text-rose-500/80 mt-0.5">Invalidation / Settle</div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#E8B84A]/10 border border-[#E8B84A]/20">
          <div className="text-[10px] text-[#E8B84A] uppercase tracking-wider">WIN RATE</div>
          <div className="text-xl font-black mt-1">
            {activeStatsItem.winRate !== null ? (
              <span className={activeStatsItem.winRate >= 55 ? 'text-emerald-400' : 'text-[#E8B84A]'}>
                {activeStatsItem.winRate}%
              </span>
            ) : (
              <span className="text-xs font-semibold text-neutral-400">
                COLLECTING DATA ({activeStatsItem.total}/10)
              </span>
            )}
          </div>
          <div className="text-[10px] text-neutral-500 mt-0.5">
            {activeStatsItem.winRate !== null ? '10+ signals resolved' : 'Requires min 10 signals'}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-neutral-900/40 border border-neutral-800">
          <div className="text-[10px] text-neutral-400 uppercase tracking-wider">NO TRADE FILTERED</div>
          <div className="text-xl font-black text-amber-300 mt-1">{noTradeCount}</div>
          <div className="text-[10px] text-neutral-500 mt-0.5">Selective discipline</div>
        </div>
      </div>

      {/* History Table */}
      {filteredHistory.length === 0 ? (
        <div className="py-10 text-center font-mono text-xs text-neutral-500 border border-white/5 rounded-xl bg-black/40">
          No historical options signals logged for {filterExpiry} yet. Signals are permanently recorded and resolved at expiry.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-white/10 text-neutral-500 text-[10px] uppercase">
                <th className="py-2.5 px-3">TIME</th>
                <th className="py-2.5 px-3">EXPIRY</th>
                <th className="py-2.5 px-3">SETUP & STRIKE</th>
                <th className="py-2.5 px-3">ENTRY</th>
                <th className="py-2.5 px-3">SL / TP</th>
                <th className="py-2.5 px-3">MFE / MAE</th>
                <th className="py-2.5 px-3">CONF</th>
                <th className="py-2.5 px-3">STATUS & OUTCOME</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredHistory.map((item) => {
                const isCall = item.direction === 'CALL';
                const isPut = item.direction === 'PUT';
                const isWin = item.outcome === 'WIN';
                const isLoss = item.outcome === 'LOSS';
                const isActive = item.status === 'ACTIVE';

                return (
                  <tr key={item.id} className="hover:bg-white/5 transition-colors">
                    <td className="py-3 px-3 text-neutral-400 whitespace-nowrap">
                      <div>{item.time}</div>
                      <div className="text-[9px] text-neutral-600">{item.id.slice(0, 15)}</div>
                    </td>

                    <td className="py-3 px-3 font-bold text-white whitespace-nowrap">
                      {item.expiry}
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black ${
                            isCall
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : isPut
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-neutral-800 text-neutral-400'
                          }`}
                        >
                          {isCall ? (
                            <ArrowUpRight className="w-3 h-3" />
                          ) : isPut ? (
                            <ArrowDownRight className="w-3 h-3" />
                          ) : (
                            <Shield className="w-3 h-3" />
                          )}
                          <span>{item.direction}</span>
                        </span>
                        {item.approxAtmStrike && (
                          <span className="text-[10px] font-bold text-neutral-300">
                            ${item.approxAtmStrike} strike
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-3 text-white font-bold whitespace-nowrap">
                      {item.entry ? `$${item.entry.toFixed(2)}` : '—'}
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="text-rose-400 text-[10px]">
                        SL: {item.sl ? `$${item.sl.toFixed(2)}` : '—'}
                      </div>
                      <div className="text-emerald-400 text-[10px]">
                        TP: {item.tp ? `$${item.tp.toFixed(2)}` : '—'}
                      </div>
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap text-[10px]">
                      <div className="text-emerald-400">
                        +${item.maxFavorableMove.toFixed(2)}
                      </div>
                      <div className="text-rose-400">
                        -${item.maxAdverseMove.toFixed(2)}
                      </div>
                    </td>

                    <td className="py-3 px-3 text-neutral-300 font-bold whitespace-nowrap">
                      {item.confidence}%
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap">
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E8B84A]/10 border border-[#E8B84A]/30 text-[9px] font-bold text-[#E8B84A]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#E8B84A] animate-ping" />
                          ACTIVE
                        </span>
                      ) : isWin ? (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-[9px] font-black text-emerald-400">
                            <CheckCircle2 className="w-3 h-3" />
                            WIN
                          </span>
                          <span className="text-[9px] text-neutral-400">
                            @ ${item.resolvedPrice?.toFixed(2) || '—'}
                          </span>
                        </div>
                      ) : isLoss ? (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-950/60 border border-rose-500/40 text-[9px] font-black text-rose-400">
                            <XCircle className="w-3 h-3" />
                            LOSS
                          </span>
                          <span className="text-[9px] text-neutral-400">
                            @ ${item.resolvedPrice?.toFixed(2) || '—'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-neutral-500">RESOLVED</span>
                      )}
                      {item.resolutionReason && (
                        <div className="text-[8px] text-neutral-500 mt-0.5 max-w-[150px] truncate" title={item.resolutionReason}>
                          {item.resolutionReason}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
