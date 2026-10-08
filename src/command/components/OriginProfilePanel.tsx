import React from 'react';
import { OriginLevel, OriginDisplacement } from '../data/commandTypes';

interface OriginProfilePanelProps {
  originLevels: OriginLevel[];
  originDisplacements: OriginDisplacement[];
  currentPrice: number;
  isDimmed: boolean;
  freshness: string;
}

export const OriginProfilePanel: React.FC<OriginProfilePanelProps> = ({
  originLevels,
  originDisplacements,
  currentPrice,
  isDimmed,
  freshness,
}) => {
  const hasData = originLevels.length > 0 || originDisplacements.length > 0;

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
          8. ORIGIN PROFILE
        </span>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8a96a8]">
          <span className="px-1 py-0.2 rounded bg-white/5 uppercase">ESTIMATED</span>
          <span>·</span>
          <span>{freshness}</span>
        </div>
      </div>

      {!hasData ? (
        <div className="h-[44px] flex items-center justify-center font-mono text-[11px] text-[#8a96a8]">
          collecting data...
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 font-mono text-[11px]">
          {/* Left: Horizontal Profile with Thin Highlighted Current-Price Line */}
          <div className="space-y-1">
            <span className="text-[9px] text-[#8a96a8] uppercase block mb-1">
              ORIGIN POWER PROFILE
            </span>
            <div className="space-y-1.5 relative">
              {originLevels.length === 0 ? (
                <div className="text-[10px] text-[#8a96a8] h-[22px] flex items-center">
                  collecting data...
                </div>
              ) : (
                originLevels.map((lvl, idx) => {
                  const isNear = currentPrice > 0 && Math.abs(lvl.priceLevel - currentPrice) < 3.0;
                  return (
                    <div key={idx} className="relative">
                      <div className="flex items-center justify-between h-[18px]">
                        <span className={`text-[10px] tabular-nums ${isNear ? 'text-[#38bdf8] font-bold' : 'text-[#8a96a8]'}`}>
                          ${lvl.priceLevel.toFixed(1)}
                        </span>
                        <div className="flex items-center gap-2">
                          <div className="w-24 sm:w-28 h-1.5 bg-[#04060b] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#38bdf8]"
                              style={{ width: `${lvl.volumeWeight}%` }}
                            />
                          </div>
                          <span className="text-[9px] text-[#e8edf5] tabular-nums w-6 text-right">
                            {lvl.volumeWeight}%
                          </span>
                        </div>
                      </div>
                      {/* Thin highlighted current-price line if near */}
                      {isNear && (
                        <div className="w-full h-[1px] bg-[#38bdf8]/60 my-0.5" />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Last Displacements List */}
          <div className="space-y-1">
            <span className="text-[9px] text-[#8a96a8] uppercase block mb-1">
              LAST DISPLACEMENTS
            </span>
            <div className="space-y-1">
              {originDisplacements.length === 0 ? (
                <div className="text-[10px] text-[#8a96a8] h-[22px] flex items-center">
                  collecting data...
                </div>
              ) : (
                originDisplacements.map((od) => {
                  const isBull = od.direction === 'BULLISH';
                  const moveDollars = (Math.abs(od.targetPrice - od.originPrice)).toFixed(2);
                  return (
                    <div
                      key={od.id}
                      className="flex items-center justify-between h-[22px]"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${isBull ? 'bg-[#22e08a]' : 'bg-[#ff3b6b]'}`} />
                        <span className="text-[#e8edf5] tabular-nums font-bold">
                          ${od.originPrice.toFixed(1)} → ${od.targetPrice.toFixed(1)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 tabular-nums text-[10px]">
                        <span className={isBull ? 'text-[#22e08a] font-bold' : 'text-[#ff3b6b] font-bold'}>
                          {isBull ? `+$${moveDollars}` : `-$${moveDollars}`}
                        </span>
                        <span className="text-[#8a96a8]">Pwr {od.powerScore}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
