// src/fireZone/FireZoneBacktestCard.tsx
import React from 'react';
import { BarChart2 } from 'lucide-react';
import { FireZoneBacktestSummary } from './backtest';

const glassCardStyle: React.CSSProperties = {
  background: 'var(--card, #0d1117)',
  border: '1px solid var(--bd, #1a212b)',
  borderRadius: '14px',
  padding: '15px',
  marginTop: '11px',
  fontFamily: "'Manrope', sans-serif",
};

const tileStyle: React.CSSProperties = {
  backgroundColor: 'rgba(255, 255, 255, 0.025)',
  border: '1px solid var(--bd, #1a212b)',
  borderRadius: '10px',
};

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

export const FireZoneBacktestCard: React.FC<{ backtest: FireZoneBacktestSummary }> =
  React.memo(({ backtest }) => {
    const verdictColor =
      backtest.verdict === 'positive edge shown'
        ? '#2fe08a'
        : backtest.verdict === 'sample too small'
        ? '#f2b94b'
        : '#ff4d66';

    return (
      <section className="space-y-4 fz-fade-up" style={glassCardStyle}>
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-[#f2b94b]" />
            <span
              style={{
                fontSize: '10px',
                letterSpacing: '0.2em',
                fontWeight: 800,
                color: 'var(--mu, #7e8794)',
                textTransform: 'uppercase',
              }}
            >
              BACKTEST
            </span>
          </div>


          <span
            className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
            style={{
              backgroundColor: 'rgba(242, 185, 75, 0.10)',
              border: `1px solid ${verdictColor}`,
              color: verdictColor,
              ...monoStyle,
            }}
          >
            {backtest.verdict}
          </span>
        </div>

        {/* 4 Tiles: Trades, Win %, Avg R, Profit Factor */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="p-3 space-y-1" style={tileStyle}>
            <span className="text-[10px] uppercase tracking-wider text-white/45 block">
              Trades
            </span>
            <span
              className="text-lg font-extrabold text-[#f4efe6] tabular-nums"
              style={monoStyle}
            >
              {backtest.trades}
            </span>
          </div>

          <div className="p-3 space-y-1" style={tileStyle}>
            <span className="text-[10px] uppercase tracking-wider text-white/45 block">
              Win %
            </span>
            <span
              className="text-lg font-extrabold tabular-nums"
              style={{
                color: backtest.winRate >= 50 ? '#2ee6a0' : '#ff5d6c',
                ...monoStyle,
              }}
            >
              {backtest.winRate.toFixed(1)}%
            </span>
          </div>

          <div className="p-3 space-y-1" style={tileStyle}>
            <span className="text-[10px] uppercase tracking-wider text-white/45 block">
              Avg R
            </span>
            <span
              className="text-lg font-extrabold tabular-nums"
              style={{
                color: backtest.avgR >= 0 ? '#2ee6a0' : '#ff5d6c',
                ...monoStyle,
              }}
            >
              {backtest.avgR >= 0
                ? `+${backtest.avgR.toFixed(2)}R`
                : `${backtest.avgR.toFixed(2)}R`}
            </span>
          </div>

          <div className="p-3 space-y-1" style={tileStyle}>
            <span className="text-[10px] uppercase tracking-wider text-white/45 block">
              Profit Factor
            </span>
            <span
              className="text-lg font-extrabold tabular-nums"
              style={{
                color: backtest.profitFactor >= 1 ? '#2ee6a0' : '#ff5d6c',
                ...monoStyle,
              }}
            >
              {backtest.profitFactor.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Footer line for STRONG+ and max DD + verdict text 12.5px muted */}
        <div
          className="p-3 rounded-xl space-y-2 text-xs"
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.025)',
            border: '1px solid rgba(255, 255, 255, 0.07)',
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2" style={monoStyle}>
            <span className="text-white/75">
              STRONG+ zones (&ge;55):{' '}
              <strong className="text-[#f4efe6]">{backtest.strongTrades}</strong> trades ·{' '}
              <strong className="text-[#2ee6a0]">{backtest.strongWinRate.toFixed(1)}%</strong>{' '}
              win ·{' '}
              <strong
                style={{ color: backtest.strongAvgR >= 0 ? '#2ee6a0' : '#ff5d6c' }}
              >
                {backtest.strongAvgR >= 0
                  ? `+${backtest.strongAvgR.toFixed(2)}R`
                  : `${backtest.strongAvgR.toFixed(2)}R`}
              </strong>{' '}
              avg
            </span>

            <span className="text-[#ff5d6c]">
              Max DD: <strong>-{backtest.maxDrawdownR.toFixed(2)}R</strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-white/10 text-[12.5px] text-white/50">
            <span>
              Verdict: <strong style={{ color: verdictColor }}>{backtest.verdict}</strong>
            </span>
            <span className="italic">{backtest.disclaimer}</span>
          </div>
        </div>
      </section>
    );
  });
