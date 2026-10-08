import React from 'react';

interface FlowVolumePanelProps {
  buyTicks60s: number;
  sellTicks60s: number;
  flatTicks60s: number;
  buyRatio: number;
  sellRatio: number;
  liquidityGrade: 'HIGH' | 'MED' | 'LOW';
  isDimmed: boolean;
  freshness: string;
}

export const FlowVolumePanel: React.FC<FlowVolumePanelProps> = ({
  buyTicks60s,
  sellTicks60s,
  flatTicks60s,
  buyRatio,
  sellRatio,
  liquidityGrade,
  isDimmed,
  freshness,
}) => {
  const totalTicks = buyTicks60s + sellTicks60s + flatTicks60s;
  const netFlow = buyTicks60s - sellTicks60s;

  const liquidityColor =
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
          2. FLOW & VOLUME
        </span>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8a96a8]">
          <span className="px-1 py-0.2 rounded bg-white/5 uppercase">ESTIMATED</span>
          <span>·</span>
          <span>{freshness}</span>
        </div>
      </div>

      {totalTicks === 0 ? (
        <div className="h-[44px] flex items-center justify-center font-mono text-[11px] text-[#8a96a8]">
          collecting data...
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 font-mono text-[11px]">
          {/* Tick Flow Row with thin 6px pill bar */}
          <div className="flex items-center justify-between h-[22px]">
            <span className="text-[#8a96a8]">Tick Flow</span>
            <div className="flex items-center gap-2">
              <div className="w-16 h-1.5 bg-[#04060b] rounded-full overflow-hidden flex">
                <div
                  className="bg-[#22e08a] h-full"
                  style={{ width: `${buyRatio}%` }}
                />
                <div
                  className="bg-[#ff3b6b] h-full"
                  style={{ width: `${sellRatio}%` }}
                />
              </div>
              <span
                className={`tabular-nums font-bold ${
                  netFlow >= 0 ? 'text-[#22e08a]' : 'text-[#ff3b6b]'
                }`}
              >
                {netFlow >= 0 ? `+${netFlow}` : netFlow}
              </span>
            </div>
          </div>

          {/* Tick Side Row */}
          <div className="flex items-center justify-between h-[22px]">
            <span className="text-[#8a96a8]">Tick Side</span>
            <div className="flex items-center gap-1.5 tabular-nums">
              <span className="text-[#22e08a] font-bold">{buyRatio}% B</span>
              <span className="text-[#8a96a8]">/</span>
              <span className="text-[#ff3b6b] font-bold">{sellRatio}% S</span>
            </div>
          </div>

          {/* Volume Row with thin 6px blue bar */}
          <div className="flex items-center justify-between h-[22px]">
            <span className="text-[#8a96a8]">Volume</span>
            <div className="flex items-center gap-2">
              <div className="w-16 h-1.5 bg-[#04060b] rounded-full overflow-hidden">
                <div
                  className="bg-[#38bdf8] h-full"
                  style={{ width: `${Math.min(100, (totalTicks / 60) * 100)}%` }}
                />
              </div>
              <span className="text-[#e8edf5] tabular-nums font-bold">
                {totalTicks} ticks
              </span>
            </div>
          </div>

          {/* Liquidity Row */}
          <div className="flex items-center justify-between h-[22px]">
            <span className="text-[#8a96a8]">Liquidity</span>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${liquidityGrade === 'HIGH' ? 'bg-[#22e08a]' : liquidityGrade === 'MED' ? 'bg-[#f5a524]' : 'bg-[#ff3b6b]'}`} />
              <span className={`font-bold tabular-nums uppercase ${liquidityColor}`}>
                {liquidityGrade}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
