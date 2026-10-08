import React from 'react';

interface SpreadVolumeHistPanelProps {
  spread: number;
  spreadHistory: number[];
  volumeHistory: number[];
  isDimmed: boolean;
  freshness: string;
}

export const SpreadVolumeHistPanel: React.FC<SpreadVolumeHistPanelProps> = ({
  spread,
  spreadHistory,
  volumeHistory,
  isDimmed,
  freshness,
}) => {
  const hasSpread = spread > 0;
  const currentVol = volumeHistory[volumeHistory.length - 1] ?? 0;
  const maxSpread = Math.max(0.4, ...spreadHistory);
  const maxVol = Math.max(5, ...volumeHistory);

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
          13. SPREAD & VOLUME
        </span>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8a96a8]">
          <span className="px-1 py-0.2 rounded bg-white/5 uppercase">ESTIMATED</span>
          <span>·</span>
          <span>{freshness}</span>
        </div>
      </div>

      {/* Compact 2-column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
        {/* Spread Histogram */}
        <div>
          <span className="text-[9px] text-[#8a96a8] uppercase block">
            SPREAD
          </span>
          {/* Fix 3: Show spread in dollars (e.g. $0.35 or 0.35), not pips */}
          <div className="flex items-baseline gap-1 mt-0.5 mb-1.5">
            {hasSpread ? (
              <>
                <span className="text-xl font-black text-[#38bdf8] tabular-nums">
                  ${spread.toFixed(2)}
                </span>
                <span className="text-[9px] text-[#8a96a8]">dollars</span>
              </>
            ) : (
              <span className="text-sm font-medium text-[#8a96a8]">collecting data...</span>
            )}
          </div>

          {/* 40px height bar histogram */}
          <div className="h-[40px] w-full bg-[#04060b] rounded px-1.5 flex items-end justify-between gap-[2px]">
            {spreadHistory.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-[9px] text-[#8a96a8]">
                collecting data...
              </div>
            ) : (
              spreadHistory.map((s, idx) => {
                const hPct = Math.min(100, (s / maxSpread) * 90);
                return (
                  <div
                    key={idx}
                    className="flex-1 bg-[#38bdf8] rounded-t-[1px]"
                    style={{ height: `${Math.max(2, hPct)}%` }}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* Volume Histogram */}
        <div>
          <span className="text-[9px] text-[#8a96a8] uppercase block">
            TICK VOLUME
          </span>
          <div className="flex items-baseline gap-1 mt-0.5 mb-1.5">
            {volumeHistory.length > 0 ? (
              <>
                <span className="text-xl font-black text-[#e8edf5] tabular-nums">
                  {currentVol}
                </span>
                <span className="text-[9px] text-[#8a96a8]">ticks/sample</span>
              </>
            ) : (
              <span className="text-sm font-medium text-[#8a96a8]">collecting data...</span>
            )}
          </div>

          {/* 40px height bar histogram */}
          <div className="h-[40px] w-full bg-[#04060b] rounded px-1.5 flex items-end justify-between gap-[2px]">
            {volumeHistory.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-[9px] text-[#8a96a8]">
                collecting data...
              </div>
            ) : (
              volumeHistory.map((v, idx) => {
                const hPct = Math.min(100, (v / maxVol) * 90);
                return (
                  <div
                    key={idx}
                    className="flex-1 bg-[#22e08a] rounded-t-[1px]"
                    style={{ height: `${Math.max(2, hPct)}%` }}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
