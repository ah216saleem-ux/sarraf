import React from 'react';
import { MarketRegimeData } from '../data/commandTypes';

interface MarketRegimePanelProps {
  regime: MarketRegimeData;
  isDimmed: boolean;
  freshness: string;
}

export const MarketRegimePanel: React.FC<MarketRegimePanelProps> = ({
  regime,
  isDimmed,
  freshness,
}) => {
  const trendColor =
    regime.trend.includes('BULLISH')
      ? 'text-[#22e08a]'
      : regime.trend.includes('BEARISH')
      ? 'text-[#ff3b6b]'
      : 'text-[#f5a524]';

  const volColor =
    regime.volatility === 'EXPANSION'
      ? 'text-[#ff3b6b]'
      : regime.volatility === 'NORMAL'
      ? 'text-[#22e08a]'
      : 'text-[#f5a524]';

  const newsColor =
    regime.newsImpact === 'HIGH USD IMMINENT' || regime.newsImpact === 'POST-RELEASE VOLATILITY'
      ? 'text-[#ff3b6b]'
      : regime.newsImpact === 'MODERATE'
      ? 'text-[#f5a524]'
      : 'text-[#38bdf8]';

  return (
    <div
      className={`relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 transition-opacity duration-300 overflow-hidden ${
        isDimmed ? 'opacity-40' : 'opacity-100'
      }`}
    >
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent" />

      {/* Header */}
      <div className="flex items-center justify-between font-mono mb-2">
        <span className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-[0.12em]">
          3. MARKET REGIME
        </span>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8a96a8]">
          <span className="px-1 py-0.2 rounded bg-white/5 uppercase">ESTIMATED</span>
          <span>·</span>
          <span>{freshness}</span>
        </div>
      </div>

      {/* Clean 2-Column Rows (22px row height, label left, value right) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 font-mono text-[11px]">
        <div className="flex items-center justify-between h-[22px]">
          <span className="text-[#8a96a8]">Trend</span>
          <span className={`font-bold tabular-nums ${trendColor}`}>
            {regime.trend}
          </span>
        </div>

        <div className="flex items-center justify-between h-[22px]">
          <span className="text-[#8a96a8]">Structure</span>
          <span className="text-[#e8edf5] font-bold truncate max-w-[170px] text-right">
            {regime.structure}
          </span>
        </div>

        <div className="flex items-center justify-between h-[22px]">
          <span className="text-[#8a96a8]">Volatility</span>
          <span className={`font-bold uppercase ${volColor}`}>
            {regime.volatility}
          </span>
        </div>

        <div className="flex items-center justify-between h-[22px]">
          <span className="text-[#8a96a8]">Session</span>
          <span className="text-[#e8edf5] font-bold">
            {regime.session}
          </span>
        </div>

        <div className="flex items-center justify-between h-[22px]">
          <span className="text-[#8a96a8]">News Impact</span>
          <span className={`font-bold ${newsColor}`}>
            {regime.newsImpact}
          </span>
        </div>

        <div className="flex items-center justify-between h-[22px]">
          <span className="text-[#8a96a8]">HTF Bias</span>
          <span className="text-[#e8edf5] font-bold">
            {regime.htfBias}
          </span>
        </div>
      </div>
    </div>
  );
};
