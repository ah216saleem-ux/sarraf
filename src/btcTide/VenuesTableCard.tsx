import React from 'react';
import { VenuesTableData, BtcFeedStatus } from './types';
import { Globe, ArrowUpRight, ArrowDownRight, RefreshCw } from 'lucide-react';

interface VenuesTableCardProps {
  venuesData: VenuesTableData;
  status: BtcFeedStatus;
}

export const VenuesTableCard: React.FC<VenuesTableCardProps> = React.memo(
  ({ venuesData, status }) => {
    const isStaleOrOffline = status === 'STALE' || status === 'OFFLINE';
    const { venues, medianPrice, spread, highestVenue, lowestVenue, totalVolumeBtc } = venuesData;

    const formatPrice = (val: number | null) => {
      if (val === null || val <= 0) return '--';
      return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    return (
      <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 backdrop-blur-md flex flex-col shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
        {/* Header & Global Cross-Venue Summary */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#FFD97A]" />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
              CROSS-VENUE LIQUIDITY &amp; ARBITRAGE (8 VENUES · 3S POLL)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
            <div>
              <span className="text-neutral-400">MEDIAN: </span>
              <span className="text-white font-bold">{formatPrice(medianPrice)}</span>
            </div>
            <div>
              <span className="text-neutral-400">SPREAD: </span>
              <span className="text-[#FFD97A] font-bold">
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

        {/* Venues Table */}
        <div className="overflow-x-auto mt-2">
          <table className="w-full font-mono text-xs text-left">
            <thead>
              <tr className="text-[10px] text-neutral-400 uppercase border-b border-white/5">
                <th className="py-2 px-2">VENUE</th>
                <th className="py-2 px-2 text-right">PRICE (USD)</th>
                <th className="py-2 px-2 text-right">DIFF VS MEDIAN</th>
                <th className="py-2 px-2 text-right">24H VOLUME</th>
                <th className="py-2 px-2 text-right">VOL SHARE</th>
                <th className="py-2 px-2 text-center">STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {venues.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-neutral-500">
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#FFD97A]" />
                      <span>Polling real tickers from 8 venues...</span>
                    </div>
                  </td>
                </tr>
              ) : (
                venues.map((v) => {
                  const isPositiveDiff = v.diffVsMedian !== null && v.diffVsMedian >= 0;
                  const diffColor =
                    v.diffVsMedian === null
                      ? 'text-neutral-500'
                      : isPositiveDiff
                      ? 'text-teal-400'
                      : 'text-rose-400';

                  return (
                    <tr key={v.venue} className="hover:bg-white/5 transition-colors">
                      <td className="py-2 px-2 font-bold text-white flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            v.status === 'ONLINE' ? 'bg-emerald-400' : 'bg-neutral-600'
                          }`}
                        />
                        <span>{v.venue}</span>
                        {v.venue === 'Hyperliquid' && (
                          <span className="text-[9px] text-neutral-500 font-normal">(MID)</span>
                        )}
                      </td>

                      <td className="py-2 px-2 text-right font-semibold text-white">
                        {formatPrice(v.price)}
                      </td>

                      <td className={`py-2 px-2 text-right font-bold ${diffColor}`}>
                        {v.diffVsMedian !== null ? (
                          <span className="flex items-center justify-end gap-0.5">
                            {isPositiveDiff ? (
                              <ArrowUpRight className="w-3 h-3 shrink-0" />
                            ) : (
                              <ArrowDownRight className="w-3 h-3 shrink-0" />
                            )}
                            <span>
                              {isPositiveDiff ? '+' : ''}${v.diffVsMedian.toFixed(2)}{' '}
                              <span className="text-[10px] font-normal">
                                ({isPositiveDiff ? '+' : ''}
                                {v.diffVsMedianBps} bps)
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
                            <div className="w-12 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#FFD97A] rounded-full"
                                style={{ width: `${Math.min(100, v.volSharePct * 2.5)}%` }}
                              />
                            </div>
                            <span className="text-[#FFD97A] font-semibold">
                              {v.volSharePct.toFixed(1)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-neutral-600">--</span>
                        )}
                      </td>

                      <td className="py-2 px-2 text-center">
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                            v.status === 'ONLINE'
                              ? 'bg-emerald-950/60 border border-emerald-500/30 text-emerald-400'
                              : 'bg-neutral-900 border border-neutral-700 text-neutral-500'
                          }`}
                        >
                          {v.status}
                        </span>
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

VenuesTableCard.displayName = 'VenuesTableCard';
