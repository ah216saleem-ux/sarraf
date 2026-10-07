import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart2,
  TrendingUp,
  TrendingDown,
  Download,
  AlertTriangle,
  Award,
  Clock,
  Layers,
  Sparkles,
  RefreshCw,
  PieChart,
} from 'lucide-react';

export const PerformanceTab: React.FC = () => {
  const [metrics, setMetrics] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPerformance = useCallback(async () => {
    try {
      const res = await fetch('/api/performance');
      if (res.ok) {
        const json = await res.json();
        setMetrics(json.metrics);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchPerformance();
  }, [fetchPerformance]);

  const handleExportCsv = () => {
    window.location.href = '/api/performance/export-csv';
  };

  const isShortHistory = !metrics?.isHistoryReliable;

  return (
    <div className="space-y-6 font-mono text-xs">
      {/* Short History Reliability Banner */}
      {isShortHistory && (
        <div className="bg-amber-950/40 border border-amber-600/50 rounded-2xl p-4 flex items-center justify-between gap-3 text-amber-300">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <strong className="block text-sm font-bold text-amber-200">
                HISTORY TOO SHORT - STATISTICAL METRICS NOT YET RELIABLE
              </strong>
              <span className="text-[11px] text-amber-300/80">
                Live database has {metrics?.historyDaysCount ?? 0} days / {metrics?.totalSignals ?? 0} signals. Institutional confidence requires at least 14 days and &ge;30 completed setups.
              </span>
            </div>
          </div>

          <span className="text-[10px] px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 font-bold shrink-0">
            PROVISIONAL DATA
          </span>
        </div>
      )}

      {/* Top Header */}
      <div className="glass-panel p-5 sm:p-6 rounded-2xl border border-[#E8B84A]/25 relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-[#E8B84A]/10 border border-[#E8B84A]/30 text-[#FFD97A]">
              <BarChart2 className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                SARRAF INSTITUTIONAL PERFORMANCE DESK
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E8B84A]/15 border border-[#E8B84A]/30 text-[#FFD97A]">
                  AUDITED
                </span>
              </h2>
              <p className="text-[11px] text-neutral-400">
                Zero lookahead backtests, session breakdowns, risk-adjusted returns & cumulative R multiples.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setIsLoading(true);
                fetchPerformance().finally(() => setIsLoading(false));
              }}
              className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-neutral-300 hover:text-white transition-colors cursor-pointer"
              title="Refresh Performance"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={handleExportCsv}
              className="px-4 py-2 bg-[#E8B84A] hover:bg-[#FFD97A] text-black font-bold rounded-xl shadow-[0_0_12px_rgba(232,184,74,0.3)] flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Primary Metric Grid */}
        <div className="mt-5 pt-4 border-t border-white/10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3 rounded-xl bg-black/40 border border-white/5">
            <span className="text-[10px] text-neutral-500 block uppercase">WIN RATE</span>
            <span className="text-base font-bold text-emerald-400">
              {metrics?.winRatePercent ?? 0}%
            </span>
          </div>

          <div className="p-3 rounded-xl bg-black/40 border border-white/5">
            <span className="text-[10px] text-neutral-500 block uppercase">TOTAL RETURN (R)</span>
            <span className="text-base font-bold text-[#FFD97A]">
              {metrics?.totalRMultiples ? `+${metrics.totalRMultiples}R` : '0.00R'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-black/40 border border-white/5">
            <span className="text-[10px] text-neutral-500 block uppercase">PROFIT FACTOR</span>
            <span className="text-base font-bold text-white">
              {metrics?.profitFactor ?? '1.00'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-black/40 border border-white/5">
            <span className="text-[10px] text-neutral-500 block uppercase">TOTAL TRADES</span>
            <span className="text-base font-bold text-white">
              {metrics?.totalSignals ?? 0}{' '}
              <span className="text-[10px] text-neutral-400 font-normal">
                ({metrics?.wins ?? 0}W / {metrics?.losses ?? 0}L / {metrics?.breakevens ?? 0}BE)
              </span>
            </span>
          </div>

          <div className="p-3 rounded-xl bg-black/40 border border-white/5">
            <span className="text-[10px] text-neutral-500 block uppercase">BEST DAY</span>
            <span className="text-base font-bold text-emerald-400">
              +{metrics?.bestDayR ?? 0}R
            </span>
          </div>

          <div className="p-3 rounded-xl bg-black/40 border border-white/5">
            <span className="text-[10px] text-neutral-500 block uppercase">AVG DURATION</span>
            <span className="text-base font-bold text-neutral-300">
              {metrics?.averageDurationMinutes ?? 0}m
            </span>
          </div>
        </div>
      </div>

      {/* Middle Grid: Equity Curve in R & Session Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Cols: Equity Curve Visualizer */}
        <div className="lg:col-span-7 space-y-4 glass-panel p-5 rounded-2xl border border-white/10">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <h3 className="font-bold text-white tracking-wider flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span>CUMULATIVE EQUITY CURVE (R-MULTIPLES)</span>
            </h3>
            <span className="text-[10px] text-neutral-400">Normalized Risk Base</span>
          </div>

          {metrics?.equityCurve?.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-neutral-500 text-center">
              No closed trade history yet. As signals close, equity progression will render here.
            </div>
          ) : (
            <div className="h-48 flex items-end gap-2 pt-4 px-2 bg-black/40 rounded-xl border border-white/5 overflow-x-auto">
              {metrics?.equityCurve?.map((pt: any, i: number) => {
                const heightPct = Math.min(100, Math.max(15, (pt.rCumulative + 5) * 10));
                const isPositive = pt.rCumulative >= 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group min-w-[32px]">
                    <span className="text-[9px] text-[#FFD97A] opacity-0 group-hover:opacity-100 transition-opacity">
                      +{pt.rCumulative}R
                    </span>
                    <div
                      style={{ height: `${heightPct}%` }}
                      className={`w-full rounded-t transition-all ${
                        isPositive ? 'bg-gradient-to-t from-emerald-900 to-emerald-400' : 'bg-rose-500'
                      }`}
                    />
                    <span className="text-[8px] text-neutral-500 truncate max-w-[30px]">
                      #{pt.index}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right 5 Cols: Session & Score Breakdown */}
        <div className="lg:col-span-5 space-y-4 glass-panel p-5 rounded-2xl border border-white/10">
          <h3 className="font-bold text-white tracking-wider flex items-center gap-2 pb-3 border-b border-white/10">
            <PieChart className="w-4 h-4 text-[#FFD97A]" />
            <span>SESSION & SCORE CATEGORIZATION</span>
          </h3>

          <div className="space-y-3">
            <div className="bg-black/40 p-3 rounded-xl border border-white/5 space-y-2">
              <span className="text-[10px] text-neutral-400 font-bold block uppercase">TRADING SESSION PERFORMANCE</span>
              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="p-2 rounded bg-white/5">
                  <span className="text-neutral-400 block text-[9px]">ASIAN</span>
                  <span className="font-bold text-white">{metrics?.sessionBreakdown?.ASIAN?.winRate ?? 0}% WR</span>
                  <span className="text-[9px] text-[#FFD97A] block">{metrics?.sessionBreakdown?.ASIAN?.rTotal ?? 0}R</span>
                </div>
                <div className="p-2 rounded bg-white/5">
                  <span className="text-neutral-400 block text-[9px]">LONDON</span>
                  <span className="font-bold text-white">{metrics?.sessionBreakdown?.LONDON?.winRate ?? 0}% WR</span>
                  <span className="text-[9px] text-[#FFD97A] block">{metrics?.sessionBreakdown?.LONDON?.rTotal ?? 0}R</span>
                </div>
                <div className="p-2 rounded bg-white/5">
                  <span className="text-neutral-400 block text-[9px]">NEW YORK</span>
                  <span className="font-bold text-white">{metrics?.sessionBreakdown?.NEW_YORK?.winRate ?? 0}% WR</span>
                  <span className="text-[9px] text-[#FFD97A] block">{metrics?.sessionBreakdown?.NEW_YORK?.rTotal ?? 0}R</span>
                </div>
              </div>
            </div>

            <div className="bg-black/40 p-3 rounded-xl border border-white/5 space-y-2">
              <span className="text-[10px] text-neutral-400 font-bold block uppercase">SCORE BUCKET CONVICTION</span>
              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="p-2 rounded bg-white/5">
                  <span className="text-neutral-400 block text-[9px]">80 - 84 SCORE</span>
                  <span className="font-bold text-white">{metrics?.scoreBreakdown?.['80_84']?.winRate ?? 0}% WR</span>
                </div>
                <div className="p-2 rounded bg-white/5">
                  <span className="text-neutral-400 block text-[9px]">85 - 89 SCORE</span>
                  <span className="font-bold text-white">{metrics?.scoreBreakdown?.['85_89']?.winRate ?? 0}% WR</span>
                </div>
                <div className="p-2 rounded bg-white/5">
                  <span className="text-neutral-400 block text-[9px]">90+ INSTITUTIONAL</span>
                  <span className="font-bold text-emerald-400">{metrics?.scoreBreakdown?.['90_PLUS']?.winRate ?? 0}% WR</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
