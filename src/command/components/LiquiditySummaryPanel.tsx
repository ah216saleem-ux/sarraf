import React from 'react';
import { NearestZoneData } from '../data/useCommandFeed';

interface LiquiditySummaryPanelProps {
  liquidityGrade: 'HIGH' | 'MED' | 'LOW';
  nearestZone: NearestZoneData | null;
  spread: number;
  totalTicks60s: number;
  isDimmed: boolean;
  freshness: string;
}

export const LiquiditySummaryPanel: React.FC<LiquiditySummaryPanelProps> = ({
  liquidityGrade,
  nearestZone,
  spread,
  isDimmed,
  freshness,
}) => {
  const gradeColor =
    liquidityGrade === 'HIGH'
      ? 'text-[#22e08a]'
      : liquidityGrade === 'MED'
      ? 'text-[#f5a524]'
      : 'text-[#ff3b6b]';

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
          14. LIQUIDITY
        </span>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8a96a8]">
          <span className="px-1 py-0.2 rounded bg-white/5 uppercase">ESTIMATED</span>
          <span>·</span>
          <span>{freshness}</span>
        </div>
      </div>

      {/* 22px row height rows, label left, value right */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 font-mono text-[11px]">
        <div className="flex items-center justify-between h-[22px]">
          <span className="text-[#8a96a8]">Grade</span>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${liquidityGrade === 'HIGH' ? 'bg-[#22e08a]' : liquidityGrade === 'MED' ? 'bg-[#f5a524]' : 'bg-[#ff3b6b]'}`} />
            <span className={`font-bold tabular-nums uppercase ${gradeColor}`}>
              {liquidityGrade}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between h-[22px]">
          <span className="text-[#8a96a8]">Spread</span>
          <span className="text-[#38bdf8] font-bold tabular-nums">
            {spread > 0 ? `$${spread.toFixed(2)}` : 'collecting data...'}
          </span>
        </div>

        <div className="flex items-center justify-between h-[22px]">
          <span className="text-[#8a96a8]">Nearest Zone</span>
          <span className="text-[#e8edf5] font-bold tabular-nums">
            {nearestZone ? `$${nearestZone.price.toFixed(2)}` : 'collecting data...'}
          </span>
        </div>

        <div className="flex items-center justify-between h-[22px]">
          <span className="text-[#8a96a8]">Zone Offset</span>
          <span className="text-[#8a96a8] tabular-nums">
            {nearestZone ? `$${nearestZone.distance.toFixed(2)} away` : 'N/A'}
          </span>
        </div>
      </div>
    </div>
  );
};
