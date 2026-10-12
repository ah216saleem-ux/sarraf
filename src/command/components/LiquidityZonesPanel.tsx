import React from 'react';
import { SarrafZone, ZoneItem } from '../data/commandTypes';

interface LiquidityZonesPanelProps {
  liquidityZones?: ZoneItem[];
  sarrafZones?: SarrafZone[];
  currentPrice: number;
  isDimmed: boolean;
  freshness: string;
}

export const LiquidityZonesPanel: React.FC<LiquidityZonesPanelProps> = ({
  liquidityZones = [],
  sarrafZones = [],
  currentPrice,
  isDimmed,
  freshness,
}) => {
  // If sarrafZones from the unified zone engine are available, use them directly (single source of truth)
  const displayItems = React.useMemo(() => {
    if (sarrafZones && sarrafZones.length > 0) {
      return sarrafZones
        .filter((z) => {
          if (currentPrice <= 0) return true;
          return Math.abs(z.mid - currentPrice) <= 25.0;
        })
        .map((z) => {
          const sourcesCount = Math.max(
            1,
            z.confluenceTags.length + (z.touchesCount ? z.touchesCount - 1 : 0)
          );
          let name = z.label;

          if (z.type === 'OB') {
            name = `${z.side === 'SELL' ? 'Resistance' : 'Support'} (${sourcesCount} src)`;
          } else if (z.type === 'FVG') {
            name = `${z.side === 'SELL' ? 'Supply FVG' : 'Demand FVG'} (${sourcesCount} src)`;
          } else if (z.type === 'BSL') {
            name = `Equal highs (BSL) (${sourcesCount} src)`;
          } else if (z.type === 'SSL') {
            name = `Equal lows (SSL) (${sourcesCount} src)`;
          } else if (z.type === 'PDH') {
            name = `Liquidity PDH`;
          } else if (z.type === 'PDL') {
            name = `Liquidity PDL`;
          } else if (sourcesCount >= 3) {
            name = `Major Zone (${sourcesCount} src)`;
          }

          const isBuy = z.side === 'BUY';

          return {
            id: z.id,
            name,
            price: z.mid,
            isBuy,
            rating: z.rating,
            status: z.status,
          };
        })
        .sort((a, b) =>
          currentPrice > 0
            ? Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice)
            : b.rating - a.rating
        );
    }

    // Fallback to legacy liquidityZones if sarrafZones not yet populated
    return liquidityZones
      .filter((z) => {
        if (currentPrice <= 0) return true;
        return Math.abs(z.mid - currentPrice) <= 25.0;
      })
      .map((z) => {
        const isBuy = z.type === 'SUPPORT' || z.type === 'EQL' || z.type === 'BUY_ZONE';
        return {
          id: z.id,
          name: z.label,
          price: z.mid,
          isBuy,
          rating: z.strength || 50,
          status: z.status || 'fresh',
        };
      })
      .sort((a, b) =>
        currentPrice > 0
          ? Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice)
          : b.rating - a.rating
      );
  }, [sarrafZones, liquidityZones, currentPrice]);

  return (
    <div
      className={`relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 transition-opacity duration-300 overflow-hidden select-none font-mono ${
        isDimmed ? 'opacity-40' : 'opacity-100'
      }`}
    >
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent" />

      {/* Header */}
      <div className="flex items-center justify-between font-mono mb-1.5 pb-1 border-b border-white/5">
        <span className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-[0.12em]">
          9. LIQUIDITY ZONES (±$25)
        </span>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8a96a8]">
          <span className="px-1 py-0.2 rounded bg-white/5 uppercase">UNIFIED ENGINE</span>
          <span>·</span>
          <span>{freshness}</span>
        </div>
      </div>

      {displayItems.length === 0 ? (
        <div className="h-[44px] flex items-center justify-center font-mono text-[11px] text-[#8a96a8]">
          collecting data...
        </div>
      ) : (
        <div className="space-y-1 font-mono text-[11px] mt-1.5">
          {displayItems.slice(0, 8).map((zone, idx) => {
            const dotColor = zone.isBuy ? 'bg-[#22e08a]' : 'bg-[#ff3b6b]';

            return (
              <div
                key={`${zone.id}-${idx}`}
                className="flex items-center justify-between h-[22px] px-1 rounded hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2 truncate">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                  <span className="text-[#e8edf5]/90 font-medium truncate">
                    {zone.name}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-white/5 text-[#38bdf8]">
                    p{zone.rating}
                  </span>
                  <span className="text-[#e8edf5] font-bold tabular-nums">
                    ${zone.price.toFixed(1)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
