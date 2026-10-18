import React from 'react';
import { VenuesTableData, BtcFeedStatus } from './types';
import { Globe, ArrowUpRight, ArrowDownRight, RefreshCw, AlertTriangle } from 'lucide-react';

interface VenuesTableCardProps {
  venuesData: VenuesTableData;
  status: BtcFeedStatus;
  isVenuesStale?: boolean;
  venuesAgeMs?: number;
}

export const VenuesTableCard: React.FC<VenuesTableCardProps> = React.memo(
  ({ venuesData, status, isVenuesStale = false, venuesAgeMs = 0 }) => {
    const isStaleOrOffline = status === 'STALE' || status === 'OFFLINE' || isVenuesStale;
    const { venues, medianPrice, spread, highestVenue, lowestVenue } = venuesData;

    const formatPrice = (val: number | null) => {
      if (val === null || !Number.isFinite(val) || val <= 0) return '--';
      return `$${val.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    };

    return (
      <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 backdrop-blur-md flex flex-col shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
        {/* Header & Global Cross-Venue Summary */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#FFD97A]" />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
              CROSS-VENUE LIQUIDITY &amp; ARBITRAGE (9 VENUES · 3S POLL)
            </span>
            {isVenuesStale && (
              <span className="px-1.5 py-0.5 rounded bg-amber-950/70 border border-amber-500/50 text-amber-300 text-[10px] font-bold font-mono animate-pulse">
                STALE ({(venuesAgeMs / 1000).toFixed(1)}s)
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
            <div>
              <span className="text-neutral-400">MEDIAN: </span>
              <span className={`font-bold ${isStaleOrOffline ? 'text-neutral-500' : 'text-white'}`}>
                {formatPrice(medianPrice)}
              </span>
            </div>
            <div>
              <span className="text-neutral-400">SPREAD: </span>
              <span
                className={`font-bold ${
                  isStaleOrOffline ? 'text-neutral-500' : 'text-[#FFD97A]'
                }`}
              >
                {spread !== null ? `$${spread.toFixed(2)}` : '--'}
              </span>
            </div>
            {highestVenue && (
              <span className="text-teal-400 font-semibold text-[10px] px-1.5 py-0.5 rounded bg-teal-950/50 border border-teal-500/30">
                HIGH: {highestVenue}
              </span>
            )}
            {lowestVenue && (
              <span className="text-rose-400 font-semibold text-[10px] px-1.5 py-0.5 rounded bg-rose-950/50 border border-rose-500/30">
                LOW: {lowestVenue}
              </span>
            )}
          </div>
        </div>

        {/* Empty / Loading State */}
        {venues.length === 0 ? (
          <div className="py-8 text-center text-neutral-500 font-mono text-xs">
            <div className="flex items-center justify-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#FFD97A]" />
              <span>Polling real tickers from 9 venues...</span>
            </div>
          </div>
        ) : (
          <div className={isStaleOrOffline ? 'opacity-60' : ''}>
            {/* Mobile Compact 2-Line Cards (< sm) */}
            <div className="sm:hidden grid grid-cols-1 gap-2 mt-3 font-mono text-xs">
              {venues.map((v) => {
                const isPositiveDiff = v.diffVsMedianBps !== null && v.diffVsMedianBps >= 0;
                const diffColor =
                  v.diffVsMedianBps === null || isStaleOrOffline
                    ? 'text-neutral-500'
                    : isPositiveDiff
                    ? 'text-teal-400'
                    : 'text-rose-400';

                return (
                  <div
                    key={v.venue}
                    className="p-2.5 rounded-lg bg-black/50 border border-white/10 flex flex-col gap-1"
                  >
                    {/* Line 1: Venue Name + Status/Outlier + Price */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            v.status === 'ONLINE' ? 'bg-emerald-400' : 'bg-rose-500'
                          }`}
                        />
                        <span className="font-bold text-white">{v.venue}</span>
                        {v.isOutlier && (
                          <span className="px-1.5 py-0.2 rounded bg-amber-950/80 border border-amber-500/50 text-amber-300 text-[9px] font-bold uppercase flex items-center gap-0.5">
                            <AlertTriangle className="w-2.5 h-2.5" /> OUTLIER
                          </span>
                        )}
                      </div>
                      <span
                        className={`font-bold text-sm ${
                          isStaleOrOffline || v.price === null ? 'text-neutral-500' : 'text-white'
                        }`}
                      >
                        {formatPrice(v.price)}
                      </span>
                    </div>

                    {/* Line 2: Diff vs Median in bps + 24h Volume Share */}
                    <div className="flex items-center justify-between text-[11px] text-neutral-400">
                      <div className={`font-semibold flex items-center gap-1 ${diffColor}`}>
                        <span>DIFF:</span>
                        {v.diffVsMedianBps !== null ? (
                          <span>
                            {isPositiveDiff ? '+' : ''}
                            {v.diffVsMedianBps.toFixed(1)} bps (
                            {v.diffVsMedian !== null
                              ? `${v.diffVsMedian >= 0 ? '+' : ''}$${v.diffVsMedian.toFixed(2)}`
                              : '--'}
                            )
                          </span>
                        ) : (
                          <span>--</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span>VOL SHARE:</span>
                        <span className="text-[#FFD97A] font-bold">
                          {v.volSharePct !== null ? `${v.volSharePct.toFixed(1)}%` : '--'}
                        </span>
                        {v.volume24h !== null && (
                          <span className="text-neutral-500 text-[10px]">
                            ({v.volume24h.toLocaleString('en-US', { maximumFractionDigits: 0 })}₿)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table (>= sm) */}
            <div className="hidden sm:block overflow-x-auto mt-2">
              <table className="w-full font-mono text-xs text-left">
                <thead>
                  <tr className="text-[10px] text-neutral-400 uppercase border-b border-white/5">
                    <th className="py-2 px-2">VENUE</th>
                    <th className="py-2 px-2 text-right">PRICE (USD)</th>
                    <th className="py-2 px-2 text-right">DIFF VS MEDIAN (BPS)</th>
                    <th className="py-2 px-2 text-right">24H VOLUME</th>
                    <th className="py-2 px-2 text-right">24H VOL SHARE</th>
                    <th className="py-2 px-2 text-center">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {venues.map((v) => {
                    const isPositiveDiff = v.diffVsMedianBps !== null && v.diffVsMedianBps >= 0;
                    const diffColor =
                      v.diffVsMedianBps === null || isStaleOrOffline
                        ? 'text-neutral-500'
                        : isPositiveDiff
                        ? 'text-teal-400'
                        : 'text-rose-400';

                    return (
                      <tr key={v.venue} className="hover:bg-white/5 transition-colors">
                        <td className="py-2 px-2 font-bold text-white">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                v.status === 'ONLINE' ? 'bg-emerald-400' : 'bg-rose-500'
                              }`}
                            />
                            <span>{v.venue}</span>
                            {v.venue === 'Hyperliquid' && (
                              <span className="text-[9px] text-neutral-500 font-normal">(PERP)</span>
                            )}
                            {v.venue === 'Coinbase' && (
                              <span className="text-[9px] text-neutral-500 font-normal">(USD)</span>
                            )}
                            {v.isOutlier && (
                              <span
                                className="px-1.5 py-0.2 rounded bg-amber-950/80 border border-amber-500/50 text-amber-300 text-[9px] font-bold uppercase flex items-center gap-0.5"
                                title="More than 0.5% (50 bps) from median — excluded from median calculation"
                              >
                                <AlertTriangle className="w-2.5 h-2.5" /> OUTLIER
                              </span>
                            )}
                          </div>
                        </td>

                        <td
                          className={`py-2 px-2 text-right font-semibold ${
                            isStaleOrOffline || v.price === null ? 'text-neutral-500' : 'text-white'
                          }`}
                        >
                          {formatPrice(v.price)}
                        </td>

                        <td className={`py-2 px-2 text-right font-bold ${diffColor}`}>
                          {v.diffVsMedianBps !== null ? (
                            <span className="flex items-center justify-end gap-0.5">
                              {isPositiveDiff ? (
                                <ArrowUpRight className="w-3 h-3 shrink-0" />
                              ) : (
                                <ArrowDownRight className="w-3 h-3 shrink-0" />
                              )}
                              <span>
                                {isPositiveDiff ? '+' : ''}
                                {v.diffVsMedianBps.toFixed(1)} bps{' '}
                                <span className="text-[10px] font-normal text-neutral-400">
                                  ({v.diffVsMedian !== null && v.diffVsMedian >= 0 ? '+' : ''}$
                                  {v.diffVsMedian?.toFixed(2)})
                                </span>
                              </span>
                            </span>
                          ) : (
                            '--'
                          )}
                        </td>

                        <td className="py-2 px-2 text-right text-neutral-300">
                          {v.volume24h !== null
                            ? `${v.volume24h.toLocaleString('en-US', {
                                maximumFractionDigits: 1,
                              })} ₿`
                            : '--'}
                        </td>

                        <td className="py-2 px-2 text-right">
                          {v.volSharePct !== null ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <div className="w-14 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-[#FFD97A] rounded-full"
                                  style={{ width: `${Math.min(100, v.volSharePct * 2)}%` }}
                                />
                              </div>
                              <span className="text-[#FFD97A] font-semibold w-11 text-right">
                                {v.volSharePct.toFixed(1)}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-neutral-600">--</span>
                          )}
                        </td>

                        <td className="py-2 px-2 text-center">
                          {v.isOutlier ? (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-950/60 border border-amber-500/40 text-amber-300">
                              OUTLIER (&gt;0.5%)
                            </span>
                          ) : (
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                v.status === 'ONLINE'
                                  ? 'bg-emerald-950/60 border border-emerald-500/30 text-emerald-400'
                                  : 'bg-rose-950/60 border border-rose-500/30 text-rose-400'
                              }`}
                              title={v.errorReason || undefined}
                            >
                              {v.status}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }
);

VenuesTableCard.displayName = 'VenuesTableCard';
