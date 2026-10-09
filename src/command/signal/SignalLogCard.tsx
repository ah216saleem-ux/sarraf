import React from 'react';
import { CommandSignalLogEntry, SignalEngineStats } from './types';
import { ArrowUpRight, ArrowDownRight, CheckCircle2, XCircle, TrendingUp, DollarSign, Award, Layers } from 'lucide-react';

interface SignalLogCardProps {
  history: CommandSignalLogEntry[];
  stats: SignalEngineStats;
  paperMode: boolean;
}

export const SignalLogCard: React.FC<SignalLogCardProps> = ({
  history,
  stats,
  paperMode,
}) => {
  return (
    <div className="relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3.5 py-3 flex flex-col justify-between overflow-hidden shadow-lg select-none font-mono">
      {/* Top subtle glow bar */}
      <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#38bdf8]/50 to-transparent" />

      {/* Header Row */}
      <div className="flex items-center justify-between pb-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold tracking-[0.14em] text-[#38bdf8] uppercase">
            SIGNAL LOG
          </span>
          <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/5 text-[#8a96a8] border border-white/5">
            LAST 20 EXITS
          </span>
        </div>

        <div className="flex items-center gap-2 text-[9px] text-[#8a96a8]">
          <span>RECORDED EXITS: <strong className="text-white">{stats.totalSignals}</strong></span>
        </div>
      </div>

      {/* Aggregated Real Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-2.5">
        {/* Total Trades */}
        <div className="p-2 rounded bg-[#04060b] border border-white/5 flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-white/5 flex items-center justify-center text-[#8a96a8]">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <div>
            <span className="text-[8px] text-[#8a96a8] uppercase font-bold">TOTAL SIGNALS</span>
            <div className="text-xs font-bold text-white">{stats.totalSignals}</div>
          </div>
        </div>

        {/* Win Rate */}
        <div className="p-2 rounded bg-[#04060b] border border-white/5 flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-[#22e08a]/10 flex items-center justify-center text-[#22e08a]">
            <Award className="w-3.5 h-3.5" />
          </div>
          <div>
            <span className="text-[8px] text-[#8a96a8] uppercase font-bold">WIN RATE</span>
            <div className={`text-xs font-bold ${stats.winRate >= 50 ? 'text-[#22e08a]' : stats.totalSignals > 0 ? 'text-[#ff3b6b]' : 'text-white'}`}>
              {stats.totalSignals > 0 ? `${stats.winRate.toFixed(1)}%` : '0.0%'}
            </div>
          </div>
        </div>

        {/* Average Result */}
        <div className="p-2 rounded bg-[#04060b] border border-white/5 flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-[#38bdf8]/10 flex items-center justify-center text-[#38bdf8]">
            <TrendingUp className="w-3.5 h-3.5" />
          </div>
          <div>
            <span className="text-[8px] text-[#8a96a8] uppercase font-bold">AVG RESULT</span>
            <div className={`text-xs font-bold ${stats.avgResultDollars >= 0 ? 'text-[#22e08a]' : 'text-[#ff3b6b]'}`}>
              {stats.totalSignals > 0
                ? `${stats.avgResultDollars >= 0 ? '+' : ''}$${stats.avgResultDollars.toFixed(2)}`
                : '$0.00'}
            </div>
          </div>
        </div>

        {/* Net Realized PnL */}
        <div className="p-2 rounded bg-[#04060b] border border-white/5 flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-[#E8B84A]/10 flex items-center justify-center text-[#E8B84A]">
            <DollarSign className="w-3.5 h-3.5" />
          </div>
          <div>
            <span className="text-[8px] text-[#8a96a8] uppercase font-bold">NET PNL</span>
            <div className={`text-xs font-bold ${stats.totalPnLDollars >= 0 ? 'text-[#22e08a]' : 'text-[#ff3b6b]'}`}>
              {stats.totalSignals > 0
                ? `${stats.totalPnLDollars >= 0 ? '+' : ''}$${stats.totalPnLDollars.toFixed(2)}`
                : '$0.00'}
            </div>
          </div>
        </div>
      </div>

      {/* History Table / List (Last 20) */}
      <div className="border border-white/5 rounded overflow-hidden">
        {history.length === 0 ? (
          <div className="py-6 px-3 text-center bg-[#04060b]">
            <p className="text-[10px] text-[#8a96a8]">
              No closed signals recorded in current session.
            </p>
            <p className="text-[8.5px] text-[#8a96a8]/70 mt-0.5">
              Ahmed Sniper engine will log real trade results (TP1/TP2/TP3/SL) with live dollar outcomes.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[190px] overflow-y-auto">
            <table className="w-full text-left text-[9px]">
              <thead className="bg-[#04060b] text-[#8a96a8] uppercase text-[8px] border-b border-white/5 sticky top-0">
                <tr>
                  <th className="py-1.5 px-2">TIME</th>
                  <th className="py-1.5 px-2">SIDE</th>
                  <th className="py-1.5 px-2">ENTRY</th>
                  <th className="py-1.5 px-2">EXIT</th>
                  <th className="py-1.5 px-2">RESULT</th>
                  <th className="py-1.5 px-2 text-right">DOLLARS PNL</th>
                  <th className="py-1.5 px-2 text-center">MODE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-[#070b14]/50">
                {history.map((item) => {
                  const isWin = item.pnlDollars > 0;
                  const isLoss = item.pnlDollars < 0;

                  return (
                    <tr key={item.id} className="hover:bg-white/5 transition-colors">
                      <td className="py-1.5 px-2 text-white/70 whitespace-nowrap">
                        {item.timeStr || new Date(item.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                      </td>
                      <td className="py-1.5 px-2 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded font-bold text-[8px] ${
                            item.side === 'BUY'
                              ? 'bg-[#22e08a]/10 text-[#22e08a] border border-[#22e08a]/30'
                              : 'bg-[#ff3b6b]/10 text-[#ff3b6b] border border-[#ff3b6b]/30'
                          }`}
                        >
                          {item.side === 'BUY' ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                          {item.side}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 font-bold text-white whitespace-nowrap">
                        ${item.entry.toFixed(2)}
                      </td>
                      <td className="py-1.5 px-2 text-white/80 whitespace-nowrap">
                        ${item.closePrice.toFixed(2)}
                      </td>
                      <td className="py-1.5 px-2 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 font-bold ${
                            isWin ? 'text-[#22e08a]' : isLoss ? 'text-[#ff3b6b]' : 'text-[#8a96a8]'
                          }`}
                        >
                          {isWin ? <CheckCircle2 className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
                          {item.result}
                        </span>
                      </td>
                      <td
                        className={`py-1.5 px-2 text-right font-bold whitespace-nowrap ${
                          isWin ? 'text-[#22e08a]' : isLoss ? 'text-[#ff3b6b]' : 'text-[#8a96a8]'
                        }`}
                      >
                        {item.pnlDollars >= 0 ? `+$${item.pnlDollars.toFixed(2)}` : `-$${Math.abs(item.pnlDollars).toFixed(2)}`}
                      </td>
                      <td className="py-1.5 px-2 text-center whitespace-nowrap">
                        <span
                          className={`px-1 py-0.2 rounded text-[7.5px] font-bold ${
                            item.isPaper
                              ? 'bg-[#E8B84A]/10 text-[#E8B84A] border border-[#E8B84A]/30'
                              : 'bg-[#22e08a]/10 text-[#22e08a] border border-[#22e08a]/30'
                          }`}
                        >
                          {item.isPaper ? 'PAPER' : 'LIVE'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[8px] text-[#8a96a8]">
        <span>Institutional Verification: Only real closed signals logged</span>
        <span>Telegram Dispatch: Disabled (Phase 4 Paper Mode)</span>
      </div>
    </div>
  );
};
