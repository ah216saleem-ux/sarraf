import React from 'react';
import type { BacktestStatePayload, BacktestPeriodMetrics } from '../server/blackstoneEngine';

interface BlackstoneBacktestViewProps {
  backtest: BacktestStatePayload | null | undefined;
}

const cardStyle: React.CSSProperties = {
  backgroundColor: '#0b0b0e',
  border: '1px solid #1f1d18',
  fontFamily: "'DM Sans', sans-serif",
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
        className="rounded-[12px] p-5 text-xs text-[#8e8779] text-center"
        style={cardStyle}
      >
        Loading backtest history...
      </div>
    );
  }

  const {
    d30,
    d60,
    d90,
    totalTradesStored,
    tradeLog,
    candlesCountM5,
    candlesCountM15,
    candlesCountH1,
    storedDaysCountH1,
  } = backtest;

  const renderPeriodCard = (title: string, metrics: BacktestPeriodMetrics) => {
    const hasData = metrics.tradesCount > 0 && metrics.netR !== null;

    return (
      <div className="rounded-[12px] p-4 space-y-2.5" style={cardStyle}>
        <div
          className="flex items-center justify-between pb-2"
          style={{ borderBottom: '1px solid #1f1d18' }}
        >
          <h3
            className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
            style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
          >
            {title}
          </h3>
          <span className="text-xs text-[#8e8779] tabular-nums" style={monoStyle}>
            {hasData ? `${metrics.tradesCount} trades` : '0 trades'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 pt-0.5">
          <div>
            <div className="text-[11px] text-[#8e8779] uppercase font-semibold">
              NET R
            </div>
            <div
              className={`text-xl font-bold tabular-nums ${
                hasData
                  ? (metrics.netR ?? 0) >= 0
                    ? 'text-[#3fbf8f]'
                    : 'text-[#e5584f]'
                  : 'text-[#8e8779]'
              }`}
              style={monoStyle}
            >
              {hasData ? `${(metrics.netR ?? 0) > 0 ? '+' : ''}${metrics.netR}R` : '—'}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-[#8e8779] uppercase font-semibold">
              WIN RATE
            </div>
            <div
              className={`text-xl font-bold tabular-nums ${
                hasData ? 'text-[#f4efe6]' : 'text-[#8e8779]'
              }`}
              style={monoStyle}
            >
              {hasData && metrics.winRatePct !== null
                ? `${metrics.winRatePct.toFixed(1)}%`
                : '—'}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-[#8e8779] uppercase font-semibold">
              W / L / BE
            </div>
            <div
              className="text-sm font-semibold tabular-nums text-[#f4efe6]"
              style={monoStyle}
            >
              {hasData ? (
                <>
                  <span className="text-[#3fbf8f]">{metrics.winsCount}W</span> ·{' '}
                  <span className="text-[#e5584f]">{metrics.lossesCount}L</span> ·{' '}
                  <span className="text-[#8e8779]">{metrics.beCount}BE</span>
                </>
              ) : (
                '—'
              )}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-[#8e8779] uppercase font-semibold">
              PROFIT FACTOR
            </div>
            <div
              className="text-sm font-semibold tabular-nums text-[#d9b25a]"
              style={monoStyle}
            >
              {hasData && metrics.profitFactor !== null
                ? metrics.profitFactor.toFixed(2)
                : '—'}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3.5" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Candle Store Counts Bar */}
      <div
        className="rounded-[12px] px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
        style={cardStyle}
      >
        <span
          className="font-bold uppercase tracking-wider text-[#d9b25a]"
          style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
        >
          STORED CANDLES
        </span>

        <div
          className="flex flex-wrap items-center gap-3 text-xs text-[#8e8779] tabular-nums"
          style={monoStyle}
        >
          <span>
            M5: <strong className="text-[#f4efe6]">{candlesCountM5}</strong>
          </span>
          <span>·</span>
          <span>
            M15: <strong className="text-[#f4efe6]">{candlesCountM15}</strong>
          </span>
          <span>·</span>
          <span>
            H1: <strong className="text-[#d9b25a]">{storedDaysCountH1}d</strong> (
            {candlesCountH1})
          </span>
        </div>
      </div>

      {/* 30d, 60d, 90d Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {renderPeriodCard('30 DAYS', d30)}
        {renderPeriodCard('60 DAYS', d60)}
        {renderPeriodCard('90 DAYS', d90)}
      </div>

      {/* Trade Log */}
      <div className="rounded-[12px] p-4 space-y-3" style={cardStyle}>
        <div
          className="flex flex-wrap items-center justify-between gap-2 pb-2.5"
          style={{ borderBottom: '1px solid #1f1d18' }}
        >
          <div className="flex items-center gap-2">
            <h2
              className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
              style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
            >
              TRADE LOG
            </h2>
            <span className="text-xs text-[#8e8779] tabular-nums" style={monoStyle}>
              ({totalTradesStored})
            </span>
          </div>
        </div>

        {tradeLog.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#8e8779]">
            0 closed trades stored.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr
                  className="text-[#8e8779] uppercase text-[11px]"
                  style={{ borderBottom: '1px solid #1f1d18' }}
                >
                  <th className="py-2 px-2.5 font-semibold">Closed</th>
                  <th className="py-2 px-2.5 font-semibold">Zone</th>
                  <th className="py-2 px-2.5 font-semibold">Side</th>
                  <th className="py-2 px-2.5 font-semibold">Entry</th>
                  <th className="py-2 px-2.5 font-semibold">SL</th>
                  <th className="py-2 px-2.5 font-semibold">Exit</th>
                  <th className="py-2 px-2.5 font-semibold text-right">Net R</th>
                  <th className="py-2 px-2.5 font-semibold text-right">P&amp;L ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#181612]">
                {tradeLog.map((t) => {
                  const isWin = t.outcome === 'WIN';
                  const isLoss = t.outcome === 'LOSS';
                  return (
                    <tr key={t.id}>
                      <td
                        className="py-2 px-2.5 text-[#8e8779] tabular-nums"
                        style={monoStyle}
                      >
                        {t.closedAt.slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="py-2 px-2.5 font-semibold text-[#f4efe6]">
                        {t.zoneName}
                      </td>
                      <td className="py-2 px-2.5">
                        <span
                          className={`font-bold ${
                            t.side === 'LONG' ? 'text-[#3fbf8f]' : 'text-[#e5584f]'
                          }`}
                          style={monoStyle}
                        >
                          {t.side}
                        </span>
                      </td>
                      <td
                        className="py-2 px-2.5 text-[#f4efe6] tabular-nums"
                        style={monoStyle}
                      >
                        {t.entryPrice.toFixed(2)}
                      </td>
                      <td
                        className="py-2 px-2.5 text-[#8e8779] tabular-nums"
                        style={monoStyle}
                      >
                        {t.stopLoss.toFixed(2)}
                      </td>
                      <td
                        className="py-2 px-2.5 font-bold text-[#f4efe6] tabular-nums"
                        style={monoStyle}
                      >
                        {t.exitPrice.toFixed(2)}
                      </td>
                      <td
                        className={`py-2 px-2.5 text-right font-bold tabular-nums ${
                          isWin
                            ? 'text-[#3fbf8f]'
                            : isLoss
                              ? 'text-[#e5584f]'
                              : 'text-[#8e8779]'
                        }`}
                        style={monoStyle}
                      >
                        {t.pnlR > 0 ? `+${t.pnlR.toFixed(2)}` : t.pnlR.toFixed(2)}R
                      </td>
                      <td
                        className={`py-2 px-2.5 text-right font-bold tabular-nums ${
                          isWin
                            ? 'text-[#3fbf8f]'
                            : isLoss
                              ? 'text-[#e5584f]'
                              : 'text-[#8e8779]'
                        }`}
                        style={monoStyle}
                      >
                        {t.pnlDollars > 0
                          ? `+$${t.pnlDollars.toFixed(2)}`
                          : `$${t.pnlDollars.toFixed(2)}`}
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
