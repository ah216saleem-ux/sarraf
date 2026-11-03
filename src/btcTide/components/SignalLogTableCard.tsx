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
    const visibleClosedTrades = React.useMemo(
      () => closedTrades.filter((t) => t.outcome !== 'VOID'),
      [closedTrades]
    );
    const {
      totalClosed,
      winRate,
      avgR,
      expectancy = null,
      expectancyUsdPerBtc = null,
      avgPnlUsdPerBtc = null,
      tp1HitRate = null,
      slRate = null,
      avgSlPct = null,
      expiredRate = null,
      worstLosingComponent = null,
      winsCount,
      lossesCount,
      expiredCount = 0,
    } = stats;

    return (
      <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 sm:p-5 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)] space-y-4">
        {/* Card Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                  SIGNAL ANALYTICS, BACKTEST STATS &amp; OUTCOME LOG
                </span>
                <span className="font-mono text-[10px] px-2 py-0.2 rounded bg-white/5 border border-white/10 text-emerald-400 flex items-center gap-1">
                  <Database className="w-2.5 h-2.5" />
                  SQLITE PERSISTED
                </span>
              </div>
              <div className="font-mono text-[11px] text-neutral-400">
                Real closed trades only (True R against real SL distance &amp; Dollar PnL per 1 BTC)
              </div>
            </div>
          </div>
        </div>

        {/* BTC Signal Analytics & Backtest Stats Panel */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-2.5 font-mono text-xs">
          {/* 1. Total Trades & Win Rate */}
          <div className="bg-black/60 border border-white/10 rounded-lg px-3 py-2">
            <div className="text-[9px] text-neutral-400 uppercase">TRADES · WIN %</div>
            <div className="text-sm font-black text-white mt-0.5">
              {totalClosed}{' '}
              <span className="text-[10px] font-normal text-neutral-400">
                ({winsCount}W/{lossesCount}L)
              </span>
            </div>
            <div className="text-[10px] text-teal-300 font-semibold">
              {winRate !== null ? `Win: ${winRate}%` : 'Win: --'}
            </div>
          </div>

          {/* 2. TP1 Hit Rate */}
          <div className="bg-black/60 border border-white/10 rounded-lg px-3 py-2 flex items-center gap-2">
            <Award className="w-4 h-4 text-[#FFD97A] shrink-0" />
            <div>
              <div className="text-[9px] text-neutral-400 uppercase">TP1 HIT RATE</div>
              <div
                className={`text-sm font-black mt-0.5 ${
                  tp1HitRate === null
                    ? 'text-neutral-500'
                    : tp1HitRate >= 55
                    ? 'text-teal-400'
                    : 'text-[#FFD97A]'
                }`}
              >
                {tp1HitRate !== null ? `${tp1HitRate}%` : '--'}
              </div>
            </div>
          </div>

          {/* 3. Average Realized R */}
          <div className="bg-black/60 border border-white/10 rounded-lg px-3 py-2 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-teal-400 shrink-0" />
            <div>
              <div className="text-[9px] text-neutral-400 uppercase">AVG REALIZED R</div>
              <div
                className={`text-sm font-black mt-0.5 ${
                  avgR === null
                    ? 'text-neutral-500'
                    : avgR >= 0
                    ? 'text-teal-400'
                    : 'text-rose-400'
                }`}
              >
                {avgR !== null ? `${avgR > 0 ? '+' : ''}${avgR.toFixed(2)} R` : '--'}
              </div>
              {avgPnlUsdPerBtc !== null && (
                <div className="text-[9px] text-neutral-400">
                  {avgPnlUsdPerBtc >= 0 ? '+' : '-'}${Math.abs(avgPnlUsdPerBtc).toFixed(0)}/BTC
                </div>
              )}
            </div>
          </div>

          {/* 4. Expectancy (in R) */}
          <div className="bg-black/60 border border-white/10 rounded-lg px-3 py-2">
            <div className="text-[9px] text-neutral-400 uppercase">EXPECTANCY (R)</div>
            <div
              className={`text-sm font-black mt-0.5 ${
                expectancy === null
                  ? 'text-neutral-500'
                  : expectancy >= 0
                  ? 'text-teal-400'
                  : 'text-rose-400'
              }`}
            >
              {expectancy !== null ? `${expectancy > 0 ? '+' : ''}${expectancy.toFixed(2)} R` : '--'}
            </div>
          </div>

          {/* 5. Expectancy ($ / 1 BTC) */}
          <div className="bg-black/60 border border-white/10 rounded-lg px-3 py-2">
            <div className="text-[9px] text-neutral-400 uppercase">EXPECTANCY ($/1 BTC)</div>
            <div
              className={`text-sm font-black mt-0.5 ${
                expectancyUsdPerBtc === null
                  ? 'text-neutral-500'
                  : expectancyUsdPerBtc >= 0
                  ? 'text-teal-400'
                  : 'text-rose-400'
              }`}
            >
              {expectancyUsdPerBtc !== null
                ? `${expectancyUsdPerBtc >= 0 ? '+' : '-'}$${Math.abs(expectancyUsdPerBtc).toFixed(2)}`
                : '--'}
            </div>
          </div>

          {/* 6. Avg SL % */}
          <div className="bg-black/60 border border-white/10 rounded-lg px-3 py-2">
            <div className="text-[9px] text-neutral-400 uppercase">AVG SL %</div>
            <div className="text-sm font-black text-[#FFD97A] mt-0.5">
              {avgSlPct !== null ? `${avgSlPct.toFixed(2)}%` : '--'}
            </div>
          </div>

          {/* 7. SL Hit Rate */}
          <div className="bg-black/60 border border-white/10 rounded-lg px-3 py-2">
            <div className="text-[9px] text-neutral-400 uppercase">SL HIT RATE</div>
            <div
              className={`text-sm font-black mt-0.5 ${
                slRate === null ? 'text-neutral-500' : 'text-rose-300'
              }`}
            >
              {slRate !== null ? `${slRate}% (${lossesCount})` : '--'}
            </div>
          </div>

          {/* 8. EXPIRED Rate */}
          <div className="bg-black/60 border border-white/10 rounded-lg px-3 py-2">
            <div className="text-[9px] text-neutral-400 uppercase">EXPIRED RATE</div>
            <div
              className={`text-sm font-black mt-0.5 ${
                expiredRate === null ? 'text-neutral-500' : 'text-amber-300'
              }`}
            >
              {expiredRate !== null ? `${expiredRate}% (${expiredCount})` : '--'}
            </div>
          </div>

          {/* 9. Worst Component in Losing Trades */}
          <div className="bg-black/60 border border-white/10 rounded-lg px-3 py-2">
            <div className="text-[9px] text-neutral-400 uppercase">TOP LOSING COMP</div>
            <div
              className="text-xs font-bold text-rose-300 mt-0.5 truncate"
              title={
                worstLosingComponent
                  ? `${worstLosingComponent.name} aligned in ${worstLosingComponent.count}/${worstLosingComponent.totalLossesWithData} losing trades`
                  : 'No losing trades with component breakdown yet'
              }
            >
              {worstLosingComponent
                ? `${worstLosingComponent.name} (${worstLosingComponent.count}/${worstLosingComponent.totalLossesWithData})`
                : '--'}
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
                <th className="py-2 px-2">TREND · FLOW · ATR</th>
                <th className="py-2 px-2 text-right">ENTRY</th>
                <th className="py-2 px-2 text-right">SL (-1.00R)</th>
                <th className="py-2 px-2 text-right">TP1 / TP2 / TP3 (TRUE R)</th>
                <th className="py-2 px-2 text-center">OUTCOME</th>
                <th className="py-2 px-2 text-right">REALIZED R</th>
                <th className="py-2 px-2 text-right">PNL / 1 BTC</th>
                <th className="py-2 px-2 text-right">DURATION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {visibleClosedTrades.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-neutral-500 text-xs">
                    No closed signals yet. Signals fire only after &ge; 3 min of live data, &ge; 68%
                    confidence (65% Adaptive), &ge; 22% lead (18% Adaptive), HTF trend filter, and 45s confirmation.
                  </td>
                </tr>
              ) : (
                visibleClosedTrades.map((t) => {
                  const isLong = t.side === 'LONG';
                  const isWin = typeof t.realizedR === 'number' && t.realizedR > 0;
                  const isLoss = typeof t.realizedR === 'number' && t.realizedR < 0;
                  const slDist =
                    typeof t.slDist === 'number' && t.slDist > 0
                      ? t.slDist
                      : t.oneR > 0
                      ? t.oneR
                      : Math.abs(t.entryPrice - t.initialSlPrice);
                  const tp1R =
                    typeof t.tp1R === 'number' && t.tp1R > 0
                      ? t.tp1R
                      : slDist > 0
                      ? Number((Math.abs(t.tp1Price - t.entryPrice) / slDist).toFixed(2))
                      : 1.0;
                  const tp2R =
                    typeof t.tp2R === 'number' && t.tp2R > 0
                      ? t.tp2R
                      : slDist > 0
                      ? Number((Math.abs(t.tp2Price - t.entryPrice) / slDist).toFixed(2))
                      : 2.0;
                  const tp3R =
                    typeof t.tp3R === 'number' && t.tp3R > 0
                      ? t.tp3R
                      : slDist > 0
                      ? Number((Math.abs(t.tp3Price - t.entryPrice) / slDist).toFixed(2))
                      : 3.0;
                  const pnlUsdPerBtc =
                    typeof t.pnlUsdPerBtc === 'number' && Number.isFinite(t.pnlUsdPerBtc)
                      ? t.pnlUsdPerBtc
                      : typeof t.realizedR === 'number'
                      ? Number((t.realizedR * slDist).toFixed(2))
                      : null;

                  return (
                    <tr key={t.id} className="hover:bg-white/5 transition-colors">
                      <td className="py-2.5 px-2 text-neutral-400 text-[11px]">
                        {new Date(t.entryTime).toISOString().replace('T', ' ').slice(5, 19)}
                      </td>

                      <td className="py-2.5 px-2">
                        <div className="flex items-center gap-1">
                          <span
                            className={`font-black text-[10px] px-1.5 py-0.5 rounded ${
                              isLong
                                ? 'bg-teal-950/60 text-teal-300 border border-teal-500/40'
                                : 'bg-rose-950/60 text-rose-300 border border-rose-500/40'
                            }`}
                          >
                            {t.side}
                          </span>
                          {t.grade && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-white/10 text-[#FFD97A] font-bold">
                              {t.grade}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-[10px] text-neutral-300">
                        <div>{t.trendState || t.engine_version || 'v6.6'}</div>
                        <div className="text-neutral-500">
                          {typeof t.flowBuyPct === 'number' ? `${t.flowBuyPct.toFixed(0)}% Buy` : '--'}
                          {typeof t.atr5m === 'number'
                            ? ` · 5m $${t.atr5m.toFixed(0)}`
                            : typeof t.atrShort === 'number'
                            ? ` · ATR $${t.atrShort.toFixed(1)}`
                            : ''}
                          {typeof t.atr15m === 'number' ? ` · 15m $${t.atr15m.toFixed(0)}` : ''}
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-right font-bold text-white">
                        {formatPrice(t.entryPrice)}
                      </td>

                      <td className="py-2.5 px-2 text-right text-rose-300">
                        <div>{formatPrice(t.initialSlPrice)}</div>
                        <div className="text-[9px] text-neutral-400">
                          -${slDist.toFixed(0)}
                          {typeof t.slPct === 'number' && t.slPct > 0
                            ? ` (${t.slPct.toFixed(2)}%)`
                            : ''}{' '}
                          · -1.00R
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-right text-neutral-300 text-[11px]">
                        <div>
                          <span>{formatPrice(t.tp1Price)}</span> /{' '}
                          <span>{formatPrice(t.tp2Price)}</span> /{' '}
                          <span className="text-[#FFD97A]">{formatPrice(t.tp3Price)}</span>
                        </div>
                        <div className="text-[9px] text-teal-400">
                          +{tp1R.toFixed(2)}R / +{tp2R.toFixed(2)}R / +{tp3R.toFixed(2)}R
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-center">
                        <span
                          className={`font-bold text-[10px] px-2 py-0.5 rounded-full ${
                            t.outcome === 'TP3'
                              ? 'bg-teal-900/80 text-teal-200 border border-teal-400'
                              : t.outcome === 'TP2'
                              ? 'bg-teal-950/80 text-teal-300 border border-teal-500/40'
                              : t.outcome === 'TP1+BE' || t.outcome === 'EXPIRED_AFTER_TP1'
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

                      <td
                        className={`py-2.5 px-2 text-right font-bold ${
                          pnlUsdPerBtc !== null && pnlUsdPerBtc > 0
                            ? 'text-teal-300'
                            : pnlUsdPerBtc !== null && pnlUsdPerBtc < 0
                            ? 'text-rose-300'
                            : 'text-neutral-400'
                        }`}
                      >
                        {pnlUsdPerBtc !== null
                          ? `${pnlUsdPerBtc >= 0 ? '+' : '-'}$${Math.abs(pnlUsdPerBtc).toFixed(2)}`
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
