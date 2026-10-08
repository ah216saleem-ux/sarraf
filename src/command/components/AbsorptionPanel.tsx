import React from 'react';
import { ZoneItem } from '../data/commandTypes';

interface AbsorptionPanelProps {
  buyZones: ZoneItem[];
  sellZones: ZoneItem[];
  currentPrice: number;
  isDimmed: boolean;
  freshness: string;
}

export const AbsorptionPanel: React.FC<AbsorptionPanelProps> = ({
  buyZones,
  sellZones,
  currentPrice,
  isDimmed,
  freshness,
}) => {
  const hasZones = buyZones.length > 0 || sellZones.length > 0;

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
          7. TICK ABSORPTION
        </span>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8a96a8]">
          <span className="px-1 py-0.2 rounded bg-white/5 uppercase">ESTIMATED</span>
          <span>·</span>
          <span>{freshness}</span>
        </div>
      </div>

      {!hasZones ? (
        <div className="h-[44px] flex items-center justify-center font-mono text-[11px] text-[#8a96a8]">
          collecting data...
        </div>
      ) : (
        /* Compact 2-Column: BUY ZONES | SELL ZONES */
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11px]">
          {/* BUY ZONES */}
          <div>
            <div className="text-[9px] font-bold text-[#22e08a] uppercase tracking-wider mb-1">
              BUY ZONES
            </div>
            <div className="space-y-1">
              {buyZones.length === 0 ? (
                <div className="text-[10px] text-[#8a96a8] h-[22px] flex items-center">
                  collecting data...
                </div>
              ) : (
                buyZones.map((z) => {
                  const diffDollars = currentPrice > 0 ? Math.abs(currentPrice - z.mid).toFixed(2) : '0.00';
                  return (
                    <div
                      key={z.id}
                      className="flex items-center justify-between h-[22px]"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[#e8edf5] font-bold tabular-nums">
                          ${z.mid.toFixed(2)}
                        </span>
                        <span
                          className={`text-[8px] px-1 py-0.2 rounded font-bold uppercase ${
                            z.status === 'fresh'
                              ? 'text-[#22e08a] bg-[#22e08a]/10'
                              : 'text-[#f5a524] bg-[#f5a524]/10'
                          }`}
                        >
                          {z.status}
                        </span>
                      </div>

                      {/* Dollars away */}
                      <span className="text-[#8a96a8] text-[10px] tabular-nums">
                        ${diffDollars} away
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* SELL ZONES */}
          <div>
            <div className="text-[9px] font-bold text-[#ff3b6b] uppercase tracking-wider mb-1">
              SELL ZONES
            </div>
            <div className="space-y-1">
              {sellZones.length === 0 ? (
                <div className="text-[10px] text-[#8a96a8] h-[22px] flex items-center">
                  collecting data...
                </div>
              ) : (
                sellZones.map((z) => {
                  const diffDollars = currentPrice > 0 ? Math.abs(z.mid - currentPrice).toFixed(2) : '0.00';
                  return (
                    <div
                      key={z.id}
                      className="flex items-center justify-between h-[22px]"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[#e8edf5] font-bold tabular-nums">
                          ${z.mid.toFixed(2)}
                        </span>
                        <span
                          className={`text-[8px] px-1 py-0.2 rounded font-bold uppercase ${
                            z.status === 'fresh'
                              ? 'text-[#ff3b6b] bg-[#ff3b6b]/10'
                              : 'text-[#f5a524] bg-[#f5a524]/10'
                          }`}
                        >
                          {z.status}
                        </span>
                      </div>

                      {/* Dollars away */}
                      <span className="text-[#8a96a8] text-[10px] tabular-nums">
                        ${diffDollars} away
                      </span>
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
