import React from 'react';
import type { BacktestStatePayload, BacktestPeriodMetrics } from '../server/blackstoneEngine';

interface BlackstoneBacktestViewProps {
  backtest: BacktestStatePayload | null | undefined;
}

const novaCardStyle: React.CSSProperties = {
  backgroundColor: 'rgba(18, 22, 34, 0.72)',
  border: '1px solid rgba(140, 160, 255, 0.14)',
  fontFamily: "'Sora', sans-serif",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

export const BlackstoneBacktestView: React.FC<BlackstoneBacktestViewProps> = ({
  backtest,
}) => {
  if (!backtest) {
    return (
      <div
        className="rounded-[18px] p-6 text-sm text-[#8d97b8] text-center backdrop-blur-md"
        style={novaCardStyle}
      >
        Loading real backtest and signal history from Ahmad server...
      </div>
    );
  }

  const { d30, d60, d90, totalTradesStored, tradeLog, rules, candlesCountM5, candlesCountM15, candlesCountH1, storedDaysCountH1 } = backtest;

  const renderPeriodCard = (title: string, metrics: BacktestPeriodMetrics) => {
    const hasData = metrics.tradesCount > 0 && metrics.netR !== null;

    return (
      <div
        className="rounded-[18px] p-5 space-y-3 backdrop-blur-md"
        style={novaCardStyle}
      >
        <div
          className="flex items-center justify-between pb-2.5"
          style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
        >
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
            {title}
          </h3>
          <span
            className="text-xs text-[#8d97b8] tabular-nums"
            style={monoStyle}
          >
            {hasData ? `${metrics.tradesCount} trades` : '0 trades stored'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          {/* Net R */}
          <div>
            <div className="text-[11px] text-[#8d97b8] uppercase font-semibold">
              NET R
            </div>
            <div
              className={`text-xl font-bold tabular-nums ${
                hasData
                  ? (metrics.netR ?? 0) >= 0
                    ? 'text-[#4df0b4]'
                    : 'text-[#ff6b7f]'
                  : 'text-[#8d97b8]'
              }`}
              style={monoStyle}
            >
              {hasData ? `${(metrics.netR ?? 0) > 0 ? '+' : ''}${metrics.netR}R` : '—'}
            </div>
          </div>

          {/* Win Rate */}
          <div>
            <div className="text-[11px] text-[#8d97b8] uppercase font-semibold">
              WIN RATE
            </div>
            <div
              className={`text-xl font-bold tabular-nums ${
                hasData ? 'text-[#e9edff]' : 'text-[#8d97b8]'
              }`}
              style={monoStyle}
            >
              {hasData && metrics.winRatePct !== null ? `${metrics.winRatePct.toFixed(1)}%` : '—'}
            </div>
          </div>

          {/* Wins / Losses / BE */}
          <div>
            <div className="text-[11px] text-[#8d97b8] uppercase font-semibold">
              W / L / BE
            </div>
            <div
              className="text-sm font-semibold tabular-nums text-[#e9edff]"
              style={monoStyle}
            >
              {hasData ? (
                <>
                  <span className="text-[#4df0b4]">{metrics.winsCount}W</span> ·{' '}
                  <span className="text-[#ff6b7f]">{metrics.lossesCount}L</span> ·{' '}
                  <span className="text-[#8d97b8]">{metrics.beCount}BE</span>
                </>
              ) : (
                '—'
              )}
            </div>
          </div>

          {/* Profit Factor */}
          <div>
            <div className="text-[11px] text-[#8d97b8] uppercase font-semibold">
              PROFIT FACTOR
            </div>
            <div
              className="text-sm font-semibold tabular-nums text-[#52e3ff]"
              style={monoStyle}
            >
              {hasData && metrics.profitFactor !== null ? metrics.profitFactor.toFixed(2) : '—'}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4" style={{ fontFamily: "'Sora', sans-serif" }}>
      {/* Real Candle Store Integrity Banner */}
      <div
        className="rounded-[18px] p-4 flex flex-wrap items-center justify-between gap-3 backdrop-blur-md"
        style={novaCardStyle}
      >
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-[#4df0b4] animate-pulse" />
          <div className="flex flex-col">
            <span className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
              REAL STORED ENGINE DATABASE
            </span>
            <span className="text-xs text-[#8d97b8]">
              Computed strictly from stored candles and live engine signals. No synthetic or sample trades.
            </span>
          </div>
        </div>

        <div
          className="flex flex-wrap items-center gap-3 text-xs text-[#8d97b8] tabular-nums"
          style={monoStyle}
        >
          <span>
            M5 Bars: <strong className="text-[#e9edff]">{candlesCountM5}</strong>
          </span>
          <span>·</span>
          <span>
            M15 Bars: <strong className="text-[#e9edff]">{candlesCountM15}</strong>
          </span>
          <span>·</span>
          <span>
            H1 Trading Days:{' '}
            <strong className="text-[#52e3ff]">{storedDaysCountH1}</strong> ({candlesCountH1} bars)
          </span>
        </div>
      </div>

      {/* 30d, 60d, 90d Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {renderPeriodCard('30 DAYS PERFORMANCE', d30)}
        {renderPeriodCard('60 DAYS PERFORMANCE', d60)}
        {renderPeriodCard('90 DAYS PERFORMANCE', d90)}
      </div>

      {/* Rules in Use */}
      <div
        className="rounded-[18px] p-5 space-y-4 backdrop-blur-md"
        style={novaCardStyle}
      >
        <div
          className="pb-3 flex flex-wrap items-center justify-between gap-2"
          style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
        >
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
            RULES IN USE (DETERMINISTIC LIVE ENGINE)
          </h2>
          <span className="text-xs text-[#8d97b8]">
            Enforced on Ahmad server
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-xs">
          {/* 4 Entry Gates */}
          <div
            className="rounded-[12px] p-3.5 space-y-2"
            style={{
              backgroundColor: 'rgba(7, 9, 15, 0.55)',
              border: '1px solid rgba(140, 160, 255, 0.12)',
            }}
          >
            <div className="text-[11px] font-bold uppercase text-[#52e3ff]">
              THE 4 ENTRY GATES
            </div>
            <ul className="space-y-1.5 text-[#8d97b8]">
              {rules.gates.map((g) => (
                <li key={g.id} className="flex gap-2">
                  <span className="text-[#4df0b4] font-bold shrink-0">
                    Gate {g.id}:
                  </span>
                  <span>
                    <strong className="text-[#e9edff]">{g.name}</strong> — {g.rule}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Fixed Plan */}
          <div
            className="rounded-[12px] p-3.5 space-y-2"
            style={{
              backgroundColor: 'rgba(7, 9, 15, 0.55)',
              border: '1px solid rgba(140, 160, 255, 0.12)',
            }}
          >
            <div className="text-[11px] font-bold uppercase text-[#52e3ff]">
              FIXED TRADE PLAN & TARGETS
            </div>
            <ul className="space-y-1 text-[#8d97b8]">
              <li>
                <strong className="text-[#e9edff]">Stop Loss:</strong> {rules.fixedPlan.stopLoss}
              </li>
              <li>
                <strong className="text-[#e9edff]">TP1:</strong> {rules.fixedPlan.tp1}
              </li>
              <li>
                <strong className="text-[#e9edff]">TP2:</strong> {rules.fixedPlan.tp2}
              </li>
              <li>
                <strong className="text-[#e9edff]">TP3:</strong> {rules.fixedPlan.tp3}
              </li>
              <li>
                <strong className="text-[#e9edff]">Position:</strong> {rules.fixedPlan.positionSplits}
              </li>
              <li>
                <strong className="text-[#e9edff]">BE Trailing:</strong> {rules.fixedPlan.beRule}
              </li>
            </ul>
          </div>

          {/* Engine Limits */}
          <div
            className="rounded-[12px] p-3.5 space-y-2"
            style={{
              backgroundColor: 'rgba(7, 9, 15, 0.55)',
              border: '1px solid rgba(140, 160, 255, 0.12)',
            }}
          >
            <div className="text-[11px] font-bold uppercase text-[#52e3ff]">
              RISK LIMITS & NEWS WINDOW
            </div>
            <ul className="space-y-1.5 text-[#8d97b8]">
              <li>
                <strong className="text-[#e9edff]">Level Daily Limit:</strong> Max{' '}
                {rules.limits.maxTradesPerLevelPerDay} trades per zone per day
              </li>
              <li>
                <strong className="text-[#e9edff]">Circuit Breaker:</strong> Pause after{' '}
                {rules.limits.maxStoppedTradesPerDay} stopped trades in a day until tomorrow
              </li>
              <li>
                <strong className="text-[#e9edff]">Clearance:</strong>{' '}
                {rules.limits.postExitClearanceDistance}
              </li>
              <li>
                <strong className="text-[#e9edff]">News Window:</strong>{' '}
                {rules.limits.newsPauseWindow}
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Trade Log */}
      <div
        className="rounded-[18px] p-5 space-y-3 backdrop-blur-md"
        style={novaCardStyle}
      >
        <div
          className="flex flex-wrap items-center justify-between gap-2 pb-3"
          style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
        >
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
              TRADE LOG (STORED SIGNALS)
            </h2>
            <span
              className="text-xs text-[#8d97b8] tabular-nums"
              style={monoStyle}
            >
              · {totalTradesStored} total closed signals recorded
            </span>
          </div>
          <span className="text-xs text-[#8d97b8]">
            Real outcomes from live engine
          </span>
        </div>

        {tradeLog.length === 0 ? (
          <div className="py-8 text-center text-sm text-[#8d97b8] leading-relaxed">
            0 closed trades stored. Real signals from Ahmad server will record here upon exit.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr
                  className="text-[#8d97b8] uppercase text-[11px]"
                  style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
                >
                  <th className="py-2.5 px-3 font-semibold">Date / Closed</th>
                  <th className="py-2.5 px-3 font-semibold">Zone</th>
                  <th className="py-2.5 px-3 font-semibold">Side</th>
                  <th className="py-2.5 px-3 font-semibold">Entry</th>
                  <th className="py-2.5 px-3 font-semibold">SL</th>
                  <th className="py-2.5 px-3 font-semibold">Exit</th>
                  <th className="py-2.5 px-3 font-semibold">Reason</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Net R</th>
                  <th className="py-2.5 px-3 font-semibold text-right">P&L ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(140,160,255,0.08)]">
                {tradeLog.map((t) => {
                  const isWin = t.outcome === 'WIN';
                  const isLoss = t.outcome === 'LOSS';
                  return (
                    <tr key={t.id}>
                      <td className="py-2.5 px-3 text-[#8d97b8] tabular-nums" style={monoStyle}>
                        {t.closedAt.slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#e9edff]">
                        {t.zoneName}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`font-bold ${
                            t.side === 'LONG' ? 'text-[#4df0b4]' : 'text-[#ff6b7f]'
                          }`}
                        >
                          {t.side}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[#e9edff] tabular-nums" style={monoStyle}>
                        {t.entryPrice.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-[#8d97b8] tabular-nums" style={monoStyle}>
                        {t.stopLoss.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-[#e9edff] tabular-nums" style={monoStyle}>
                        {t.exitPrice.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-[#8d97b8] max-w-xs truncate" title={t.exitReason}>
                        {t.exitReason}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-bold tabular-nums ${
                          isWin
                            ? 'text-[#4df0b4]'
                            : isLoss
                              ? 'text-[#ff6b7f]'
                              : 'text-[#8d97b8]'
                        }`}
                        style={monoStyle}
                      >
                        {t.pnlR > 0 ? `+${t.pnlR.toFixed(2)}` : t.pnlR.toFixed(2)}R
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-bold tabular-nums ${
                          isWin
                            ? 'text-[#4df0b4]'
                            : isLoss
                              ? 'text-[#ff6b7f]'
                              : 'text-[#8d97b8]'
                        }`}
                        style={monoStyle}
                      >
                        {t.pnlDollars > 0 ? `+$${t.pnlDollars.toFixed(2)}` : `$${t.pnlDollars.toFixed(2)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
