import React from 'react';
import { ZoneItem } from '../data/commandTypes';

interface LiquidityZonesPanelProps {
  liquidityZones: ZoneItem[];
  currentPrice: number;
  isDimmed: boolean;
  freshness: string;
}

export const LiquidityZonesPanel: React.FC<LiquidityZonesPanelProps> = ({
  liquidityZones,
  currentPrice,
  isDimmed,
  freshness,
}) => {
  // Enforce zones rule:
  // - BUY (demand / support) must be below current price
  // - SELL (supply / resistance) must be above current price
  // - Within $25 of price only
  // - Nearest first
  const validZones = liquidityZones
    .filter((zone) => {
      if (currentPrice <= 0) return true;
      const dist = Math.abs(zone.mid - currentPrice);
      if (dist > 25.0) return false;

      const isBuyZone = zone.type === 'SUPPORT' || zone.type === 'EQL' || zone.type === 'BUY_ZONE';
      const isSellZone = zone.type === 'RESISTANCE' || zone.type === 'EQH' || zone.type === 'SELL_ZONE';

      if (isBuyZone) return zone.mid < currentPrice;
      if (isSellZone) return zone.mid > currentPrice;
      return true;
    })
    .sort((a, b) => Math.abs(a.mid - currentPrice) - Math.abs(b.mid - currentPrice));

  return (
    <div
      className={`relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 transition-opacity duration-300 overflow-hidden ${
        isDimmed ? 'opacity-40' : 'opacity-100'
      }`}
    >
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent" />

      {/* Header */}
      <div className="flex items-center justify-between font-mono mb-1.5">
        <span className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-[0.12em]">
          9. LIQUIDITY ZONES (±$25)
        </span>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8a96a8]">
          <span className="px-1 py-0.2 rounded bg-white/5 uppercase">ESTIMATED</span>
          <span>·</span>
          <span>{freshness}</span>
        </div>
      </div>

      {validZones.length === 0 ? (
        <div className="h-[44px] flex items-center justify-center font-mono text-[11px] text-[#8a96a8]">
          collecting data...
        </div>
      ) : (
        /* Single compact list, one row per zone: coloured dot, name, price on the right */
        <div className="space-y-0.5 font-mono text-[11px]">
          {validZones.map((zone) => {
            const isBuy = zone.mid < currentPrice;
            const dotColor = isBuy ? 'bg-[#22e08a]' : 'bg-[#ff3b6b]';
            const typeLabel = isBuy ? 'DEMAND' : 'SUPPLY';

            return (
              <div
                key={zone.id}
                className="flex items-center justify-between h-[22px]"
              >
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                  <span className="text-[#8a96a8] font-medium">{zone.label}</span>
                  <span className="text-[9px] text-[#8a96a8]/70 uppercase">({typeLabel})</span>
                </div>

                <span className="text-[#e8edf5] font-bold tabular-nums">
                  ${zone.mid.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
