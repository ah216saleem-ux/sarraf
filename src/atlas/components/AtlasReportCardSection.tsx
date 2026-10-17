// src/atlas/components/AtlasReportCardSection.tsx
import React from 'react';
import { AtlasReportCard, AtlasHistoryEntry } from '../atlasTypes';
import { CheckCircle2, History, RotateCcw, ShieldCheck, XCircle, MinusCircle } from 'lucide-react';

interface AtlasReportCardSectionProps {
  yesterdayReportCard: AtlasReportCard | null;
  rollingAccuracy7d: number | string | null;
  historyList: AtlasHistoryEntry[];
  selectedHistoryDate: string | null;
  onSelectHistoryDate: (date: string | null) => void;
}

export const AtlasReportCardSection: React.FC<AtlasReportCardSectionProps> = ({
  yesterdayReportCard,
  rollingAccuracy7d,
  historyList = [],
  selectedHistoryDate,
  onSelectHistoryDate,
}) => {
  const numericAccuracy =
    typeof rollingAccuracy7d === 'number'
      ? rollingAccuracy7d
      : typeof rollingAccuracy7d === 'string' && !isNaN(parseFloat(rollingAccuracy7d))
      ? parseFloat(rollingAccuracy7d)
      : null;

  return (
    <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-[#E8B84A]/30 space-y-4 font-mono">
      {/* Header & Rolling Accuracy */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-[#FFD97A]" />
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-white tracking-wider">
              YESTERDAY REPORT CARD & HISTORICAL ACCURACY
            </h3>
            <span className="text-[10px] text-neutral-400">
              REAL 24H PRICE ACTION VERIFICATION (0.5×ATR REVERSAL THRESHOLD)
            </span>
          </div>
        </div>

        {/* Rolling 7-day Accuracy % Badge */}
        <div>
          {numericAccuracy !== null ? (
            <span
              className={`text-xs font-extrabold px-3 py-1 rounded-xl border flex items-center gap-1.5 ${
                numericAccuracy >= 70
                  ? 'text-emerald-400 bg-emerald-950/70 border-emerald-700/60 shadow-[0_0_12px_rgba(34,197,94,0.2)]'
                  : numericAccuracy >= 50
                  ? 'text-[#FFD97A] bg-amber-950/70 border-amber-700/60 shadow-[0_0_12px_rgba(232,184,74,0.2)]'
                  : 'text-rose-400 bg-rose-950/70 border-rose-700/60'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{numericAccuracy.toFixed(1)}% ACCURACY (LAST 7 DAYS)</span>
            </span>
          ) : (
            <span className="text-xs font-bold px-3 py-1 rounded-xl bg-neutral-900 border border-neutral-700 text-neutral-400">
              COLLECTING HISTORY
            </span>
          )}
        </div>
      </div>

      {/* History Selector: Last 5 published sets (levels only, read-only) */}
      <div className="p-3 rounded-xl bg-black/50 border border-white/5 space-y-2">
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <span className="flex items-center gap-1.5 font-bold text-white">
            <History className="w-3.5 h-3.5 text-[#FFD97A]" />
            <span>HISTORICAL SET SELECTOR (LAST 5 SESSIONS)</span>
          </span>
          <span className="text-[10px] text-neutral-500">READ-ONLY ARCHIVE</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {/* Today Live button */}
          <button
            onClick={() => onSelectHistoryDate(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
              selectedHistoryDate === null
                ? 'bg-[#E8B84A] text-black border-[#E8B84A] shadow-[0_0_10px_rgba(232,184,74,0.3)]'
                : 'bg-black/60 text-neutral-400 border-white/10 hover:text-white hover:border-[#E8B84A]/30'
            }`}
          >
            TODAY (LIVE)
          </button>

          {/* Historical date buttons */}
          {historyList.map((entry) => {
            const isSelected = selectedHistoryDate === entry.date;
            return (
              <button
                key={entry.date}
                onClick={() => onSelectHistoryDate(entry.date)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-[#E8B84A] text-black border-[#E8B84A] shadow-[0_0_10px_rgba(232,184,74,0.3)]'
                    : 'bg-black/60 text-neutral-300 border-white/10 hover:text-white hover:border-[#E8B84A]/30'
                }`}
              >
                <span>{entry.date}</span>
                {entry.reportCard && (
                  <span
                    className={`text-[9px] px-1 py-0.2 rounded ${
                      isSelected
                        ? 'bg-black text-white'
                        : entry.reportCard.accuracyPercent >= 60
                        ? 'text-emerald-400 bg-emerald-950'
                        : 'text-amber-400 bg-amber-950'
                    }`}
                  >
                    {entry.reportCard.accuracyPercent.toFixed(0)}%
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Selected Historical Banner */}
        {selectedHistoryDate && (
          <div className="mt-2 p-2.5 rounded-lg bg-amber-950/40 border border-amber-600/40 text-xs text-amber-200 flex items-center justify-between">
            <span>
              <strong>VIEWING ARCHIVE:</strong> Showing frozen levels and report card for{' '}
              <strong>{selectedHistoryDate}</strong>.
            </span>
            <button
              onClick={() => onSelectHistoryDate(null)}
              className="px-2 py-1 rounded bg-[#E8B84A] text-black font-extrabold text-[10px] flex items-center gap-1 hover:bg-[#FFD97A] cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>RETURN TO LIVE</span>
            </button>
          </div>
        )}
      </div>

      {/* Yesterday Mini Table */}
      {yesterdayReportCard ? (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center justify-between text-xs gap-2">
            <span className="font-bold text-neutral-200">
              YESTERDAY'S PERFORMANCE ({yesterdayReportCard.date})
            </span>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-emerald-400 font-bold">
                {yesterdayReportCard.respectedCount} RESPECTED
              </span>
              <span className="text-neutral-500">·</span>
              <span className="text-rose-400 font-bold">
                {yesterdayReportCard.brokenCount} BROKEN
              </span>
              <span className="text-neutral-500">·</span>
              <span className="text-neutral-400">
                {yesterdayReportCard.ignoredCount} IGNORED
              </span>
              <span className="text-neutral-500">·</span>
              <span className="text-[#FFD97A] font-extrabold">
                {yesterdayReportCard.accuracyPercent.toFixed(1)}% ACCURACY
              </span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/5">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-black/60 text-[10px] text-neutral-400 uppercase border-b border-white/10">
                <tr>
                  <th className="py-2.5 px-3">ZONE</th>
                  <th className="py-2.5 px-3">LEVEL</th>
                  <th className="py-2.5 px-3">OUTCOME</th>
                  <th className="py-2.5 px-3">REAL REVERSAL / DETAILS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-black/30">
                {yesterdayReportCard.zones.map((r) => {
                  return (
                    <tr key={r.zoneId} className="hover:bg-white/[0.02]">
                      <td className="py-2 px-3 font-bold text-white whitespace-nowrap">
                        <span className="w-7 inline-block">{r.zoneId}</span>
                        <span className="text-neutral-400 font-normal">{r.name}</span>
                      </td>
                      <td className="py-2 px-3 text-neutral-200 whitespace-nowrap">
                        ${r.level.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {r.outcome === 'RESPECTED' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/40">
                            <CheckCircle2 className="w-3 h-3" />
                            RESPECTED
                          </span>
                        ) : r.outcome === 'BROKEN' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-rose-400 bg-rose-950/60 border border-rose-800/40">
                            <XCircle className="w-3 h-3" />
                            BROKEN
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-neutral-400 bg-neutral-900 border border-neutral-700">
                            <MinusCircle className="w-3 h-3" />
                            IGNORED
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-[11px] text-neutral-400">
                        {r.notes}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="py-6 text-center text-neutral-500 text-xs">
          COLLECTING HISTORY · Waiting for first daily rollover evaluation
        </div>
      )}
    </div>
  );
};
