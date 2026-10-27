// src/doji/DojiBacktestPage.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { DojiTimeframe, DojiMode } from './dojiEngine';
import { DojiTrade } from './dojiSignalEngine';

interface BacktestBucketStats {
  key: string;
  label: string;
  range: string;
  totalTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  averageR: number;
  totalR: number;
  maxDrawdown: number;
  maxDrawdownR: number;
  maxDrawdownDollars: number;
  totalPnlDollars: number;
}

interface BacktestTradeItem extends DojiTrade {
  risk: number;
  rMultiple: number;
}

interface BacktestApiResponse {
  tf: DojiTimeframe;
  mode: DojiMode;
  candlesCount: number;
  closedCandlesCount: number;
  fromTime: string | null;
  toTime: string | null;
  currentPrice: number;
  slAtrMultiplier: number;
  dojiEngine: {
    dojisFlagged: number;
    validZonesCount: number;
    totalUncappedValidZones: number;
    atr: number;
  };
  totalTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  averageR: number;
  totalR: number;
  maxDrawdown: number;
  maxDrawdownR: number;
  maxDrawdownDollars: number;
  totalPnlDollars: number;
  byZoneStrength: {
    below5: BacktestBucketStats;
    '5to7': BacktestBucketStats;
    above7: BacktestBucketStats;
  };
  strengthBuckets: BacktestBucketStats[];
  activeTrade: DojiTrade | null;
  trades: BacktestTradeItem[];
}

const TIMEFRAMES: DojiTimeframe[] = ['15m', '30m', '1h', '4h'];
const MODES: { value: DojiMode; label: string }[] = [
  { value: 'indicator', label: 'Indicator' },
  { value: 'strict', label: 'Strict' },
  { value: 'loose', label: 'Loose' },
];

export const DojiBacktestPage: React.FC = () => {
  const [tf, setTf] = useState<DojiTimeframe>(() => {
    if (typeof window === 'undefined') return '15m';
    const param = new URLSearchParams(window.location.search).get('tf');
    if (param === '15m' || param === '30m' || param === '1h' || param === '4h') {
      return param;
    }
    return '15m';
  });

  const [mode, setMode] = useState<DojiMode>(() => {
    if (typeof window === 'undefined') return 'indicator';
    const param = new URLSearchParams(window.location.search).get('mode');
    if (param === 'indicator' || param === 'strict' || param === 'loose') {
      return param;
    }
    return 'indicator';
  });

  const [data, setData] = useState<BacktestApiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBacktest = useCallback(async (selectedTf: DojiTimeframe, selectedMode: DojiMode) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(
        typeof window !== 'undefined' ? window.location.search : ''
      );
      params.set('tf', selectedTf);
      params.set('mode', selectedMode);
      const res = await fetch(`/api/doji/backtest?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.message || errJson?.error || `HTTP ${res.status}`);
      }
      const json: BacktestApiResponse = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Failed to load backtest results');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tf', tf);
      url.searchParams.set('mode', mode);
      window.history.replaceState({}, '', url.toString());
    }
    void fetchBacktest(tf, mode);
  }, [tf, mode, fetchBacktest]);

  const formatSignedR = (val: number) => {
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(2)}R`;
  };

  const formatSignedDollars = (val: number) => {
    const sign = val > 0 ? '+' : val < 0 ? '-' : '';
    return `${sign}$${Math.abs(val).toFixed(2)}`;
  };

  return (
    <div className="min-h-screen bg-[#0B0E11] text-[#E6EDF3] font-sans px-3 sm:px-6 py-4 sm:py-6">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Header & Controls */}
        <div className="bg-[#12171D] border border-[#222B35] rounded-lg p-3.5 sm:p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <a
                  href="/"
                  className="text-xs font-mono px-2 py-1 rounded bg-[#1B222C] border border-[#2C3644] text-[#8B949E] hover:text-white transition-colors"
                >
                  ← Terminal
                </a>
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-white">
                  DOJI Backtest (Last 1,000 Candles)
                </h1>
              </div>
              <p className="text-xs text-[#8B949E] mt-1 font-mono">
                SL = Zone High/Low ± 0.25×ATR · TP1/TP2/TP3 = +$6 / +$11 / +$15 (1/3 each, BE after TP1)
              </p>
            </div>

            <button
              type="button"
              onClick={() => fetchBacktest(tf, mode)}
              disabled={loading}
              className="px-2.5 py-1 rounded text-xs font-mono border bg-[#1B222C] text-[#E6EDF3] border-[#2C3644] hover:border-[#48576A] disabled:opacity-50"
            >
              {loading ? 'Running...' : 'Refresh'}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#1E2630]">
            {/* Timeframe Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono text-[#8B949E] mr-1">TF:</span>
              {TIMEFRAMES.map((itemTf) => (
                <button
                  key={itemTf}
                  type="button"
                  onClick={() => setTf(itemTf)}
                  className={`px-2.5 py-1 rounded text-xs font-mono font-semibold border transition-colors ${
                    tf === itemTf
                      ? 'bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/40'
                      : 'bg-[#161B22] text-[#8B949E] border-[#262C36] hover:text-white'
                  }`}
                >
                  {itemTf}
                </button>
              ))}
            </div>

            {/* Mode Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono text-[#8B949E] mr-1">Mode:</span>
              <div className="inline-flex rounded border border-[#262C36] overflow-hidden">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMode(m.value)}
                    className={`px-2.5 py-1 text-xs font-mono font-medium transition-colors ${
                      mode === m.value
                        ? 'bg-[#38BDF8]/15 text-[#38BDF8]'
                        : 'bg-[#161B22] text-[#8B949E] hover:text-white'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-[#EF4444]/10 border border-[#EF4444]/40 text-[#EF4444] rounded-lg p-3 text-xs font-mono">
            Error: {error}
          </div>
        )}

        {loading && !data ? (
          <div className="bg-[#12171D] border border-[#222B35] rounded-lg p-8 text-center text-xs font-mono text-[#8B949E]">
            Running backtest over 1,000 candles for {tf.toUpperCase()} ({mode})...
          </div>
        ) : null}

        {data && (
          <>
            {/* Overall Performance Summary Table */}
            <div className="bg-[#12171D] border border-[#222B35] rounded-lg overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-[#222B35] flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-mono font-semibold uppercase tracking-wider text-[#E6EDF3]">
                  Overall Backtest Summary ({data.tf.toUpperCase()} · {data.mode.toUpperCase()})
                </span>
                <span className="text-[11px] font-mono text-[#8B949E]">
                  Candles: {data.candlesCount} · Flagged Dojis: {data.dojiEngine.dojisFlagged} · ATR14: ${data.dojiEngine.atr.toFixed(2)}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead>
                    <tr className="bg-[#161C24] text-[#8B949E] border-b border-[#222B35]">
                      <th className="py-2.5 px-3 font-medium">Total Trades</th>
                      <th className="py-2.5 px-3 font-medium">Win Rate</th>
                      <th className="py-2.5 px-3 font-medium">W / L</th>
                      <th className="py-2.5 px-3 font-medium">Average R</th>
                      <th className="py-2.5 px-3 font-medium">Total R</th>
                      <th className="py-2.5 px-3 font-medium">Max Drawdown</th>
                      <th className="py-2.5 px-3 font-medium text-right">Net P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-[#1E2630]/60 bg-[#12171D]">
                      <td className="py-3 px-3 font-bold text-white text-sm">
                        {data.totalTrades}
                      </td>
                      <td
                        className={`py-3 px-3 font-bold text-sm ${
                          data.winRate >= 50 ? 'text-[#22C55E]' : 'text-[#F59E0B]'
                        }`}
                      >
                        {data.winRate.toFixed(2)}%
                      </td>
                      <td className="py-3 px-3 text-[#C9D1D9]">
                        <span className="text-[#22C55E]">{data.wins}W</span>
                        {' / '}
                        <span className="text-[#EF4444]">{data.losses}L</span>
                      </td>
                      <td
                        className={`py-3 px-3 font-bold ${
                          data.averageR >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                        }`}
                      >
                        {formatSignedR(data.averageR)}
                      </td>
                      <td
                        className={`py-3 px-3 font-semibold ${
                          data.totalR >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                        }`}
                      >
                        {formatSignedR(data.totalR)}
                      </td>
                      <td className="py-3 px-3 text-[#EF4444] font-semibold">
                        -{data.maxDrawdownR.toFixed(2)}R{' '}
                        <span className="text-[#8B949E] font-normal">
                          (-${data.maxDrawdownDollars.toFixed(2)})
                        </span>
                      </td>
                      <td
                        className={`py-3 px-3 font-bold text-right ${
                          data.totalPnlDollars >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                        }`}
                      >
                        {formatSignedDollars(data.totalPnlDollars)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Results Split by Zone Strength Table */}
            <div className="bg-[#12171D] border border-[#222B35] rounded-lg overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-[#222B35] flex items-center justify-between">
                <span className="text-xs font-mono font-semibold uppercase tracking-wider text-[#E6EDF3]">
                  Results Split by Zone Strength
                </span>
                <span className="text-[11px] font-mono text-[#8B949E]">
                  Below 5 · 5 to 7 · Above 7
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead>
                    <tr className="bg-[#161C24] text-[#8B949E] border-b border-[#222B35]">
                      <th className="py-2.5 px-3 font-medium">Zone Strength</th>
                      <th className="py-2.5 px-3 font-medium">Total Trades</th>
                      <th className="py-2.5 px-3 font-medium">Win Rate</th>
                      <th className="py-2.5 px-3 font-medium">W / L</th>
                      <th className="py-2.5 px-3 font-medium">Average R</th>
                      <th className="py-2.5 px-3 font-medium">Total R</th>
                      <th className="py-2.5 px-3 font-medium">Max Drawdown</th>
                      <th className="py-2.5 px-3 font-medium text-right">Net P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E2630]">
                    {data.strengthBuckets.map((bucket) => (
                      <tr key={bucket.key} className="hover:bg-[#161C24]/60">
                        <td className="py-2.5 px-3 font-semibold text-white">
                          {bucket.label}{' '}
                          <span className="text-[#8B949E] font-normal">({bucket.range})</span>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-[#E6EDF3]">
                          {bucket.totalTrades}
                        </td>
                        <td
                          className={`py-2.5 px-3 font-semibold ${
                            bucket.totalTrades === 0
                              ? 'text-[#8B949E]'
                              : bucket.winRate >= 50
                              ? 'text-[#22C55E]'
                              : 'text-[#F59E0B]'
                          }`}
                        >
                          {bucket.winRate.toFixed(2)}%
                        </td>
                        <td className="py-2.5 px-3 text-[#C9D1D9]">
                          <span className="text-[#22C55E]">{bucket.wins}W</span>
                          {' / '}
                          <span className="text-[#EF4444]">{bucket.losses}L</span>
                        </td>
                        <td
                          className={`py-2.5 px-3 font-semibold ${
                            bucket.totalTrades === 0
                              ? 'text-[#8B949E]'
                              : bucket.averageR >= 0
                              ? 'text-[#22C55E]'
                              : 'text-[#EF4444]'
                          }`}
                        >
                          {formatSignedR(bucket.averageR)}
                        </td>
                        <td
                          className={`py-2.5 px-3 ${
                            bucket.totalTrades === 0
                              ? 'text-[#8B949E]'
                              : bucket.totalR >= 0
                              ? 'text-[#22C55E]'
                              : 'text-[#EF4444]'
                          }`}
                        >
                          {formatSignedR(bucket.totalR)}
                        </td>
                        <td className="py-2.5 px-3 text-[#EF4444]">
                          -{bucket.maxDrawdownR.toFixed(2)}R{' '}
                          <span className="text-[#8B949E]">
                            (-${bucket.maxDrawdownDollars.toFixed(2)})
                          </span>
                        </td>
                        <td
                          className={`py-2.5 px-3 font-semibold text-right ${
                            bucket.totalTrades === 0
                              ? 'text-[#8B949E]'
                              : bucket.totalPnlDollars >= 0
                              ? 'text-[#22C55E]'
                              : 'text-[#EF4444]'
                          }`}
                        >
                          {formatSignedDollars(bucket.totalPnlDollars)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Individual Simulated Trades Table */}
            <div className="bg-[#12171D] border border-[#222B35] rounded-lg overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-[#222B35] flex items-center justify-between">
                <span className="text-xs font-mono font-semibold uppercase tracking-wider text-[#E6EDF3]">
                  Simulated Closed Trades ({data.trades.length})
                </span>
                {data.activeTrade && (
                  <span className="text-[11px] font-mono text-[#38BDF8]">
                    + 1 Open ({data.activeTrade.side} @ {data.activeTrade.entryPrice.toFixed(2)})
                  </span>
                )}
              </div>

              {data.trades.length === 0 ? (
                <div className="p-6 text-center text-xs font-mono text-[#8B949E]">
                  No closed trades triggered in this 1,000-candle window.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead>
                      <tr className="bg-[#161C24] text-[#8B949E] border-b border-[#222B35]">
                        <th className="py-2 px-3 font-medium">Entry (Dubai)</th>
                        <th className="py-2 px-3 font-medium">Side</th>
                        <th className="py-2 px-3 font-medium">Strength</th>
                        <th className="py-2 px-3 font-medium">Entry</th>
                        <th className="py-2 px-3 font-medium">SL (Risk)</th>
                        <th className="py-2 px-3 font-medium">Outcome</th>
                        <th className="py-2 px-3 font-medium">R</th>
                        <th className="py-2 px-3 font-medium text-right">P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1E2630]">
                      {[...data.trades].reverse().map((t) => (
                        <tr key={t.id} className="hover:bg-[#161C24]/60">
                          <td className="py-2 px-3 text-[#C9D1D9] whitespace-nowrap">
                            {t.entryTimeDisplay}
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                t.side === 'BUY'
                                  ? 'bg-[#22C55E]/15 text-[#22C55E]'
                                  : 'bg-[#EF4444]/15 text-[#EF4444]'
                              }`}
                            >
                              {t.side}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-semibold text-white">
                            {t.zoneStrength}/10
                          </td>
                          <td className="py-2 px-3 text-[#E6EDF3]">
                            {t.entryPrice.toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-[#8B949E]">
                            {t.initialSl.toFixed(2)} (${t.risk.toFixed(2)})
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`font-semibold ${
                                t.result === 'SL' ? 'text-[#EF4444]' : 'text-[#22C55E]'
                              }`}
                            >
                              {t.result}
                            </span>
                          </td>
                          <td
                            className={`py-2 px-3 font-semibold ${
                              t.rMultiple >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                            }`}
                          >
                            {formatSignedR(t.rMultiple)}
                          </td>
                          <td
                            className={`py-2 px-3 font-semibold text-right ${
                              t.pnlDollars >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                            }`}
                          >
                            {formatSignedDollars(t.pnlDollars)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
