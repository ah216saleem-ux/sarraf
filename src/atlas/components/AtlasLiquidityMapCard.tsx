// src/atlas/components/AtlasLiquidityMapCard.tsx
import React from 'react';
import { AtlasLiquidityLevel, AtlasZone } from '../atlasTypes';
import { Waves, Shield, CheckCircle2, XCircle, ArrowUpRight, ArrowDownRight, Sparkles } from 'lucide-react';

interface AtlasLiquidityMapCardProps {
  levels?: AtlasLiquidityLevel[];
  livePrice?: number;
  atr14?: number;
  zones?: AtlasZone[];
}

export const AtlasLiquidityMapCard: React.FC<AtlasLiquidityMapCardProps> = ({
  levels = [],
  livePrice = 0,
  atr14 = 15,
  zones = [],
}) => {
  const intactCount = levels.filter((l) => l.status === 'INTACT').length;
  const sweptCount = levels.filter((l) => l.status === 'SWEPT').length;
  const confluenceCount = zones.filter((z) => z.hasLiquidityBadge).length;

  return (
    <div className="bg-[#0b101b] border border-neutral-800 rounded-lg p-4 sm:p-5 shadow-lg">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-neutral-800/80 gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Waves className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-neutral-100 tracking-wider uppercase font-mono">
                LIQUIDITY MAP
              </h3>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-indigo-950/60 border border-indigo-800/60 text-indigo-300">
                MULTI-SESSION POOLS
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              PDH/PDL, Asia & London extremes, Previous Week H/L with live sweep status
            </p>
          </div>
        </div>

        {/* Stats Strip */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <div className="px-2.5 py-1 rounded bg-neutral-900 border border-neutral-800 flex items-center gap-1.5">
            <span className="text-neutral-400">INTACT:</span>
            <span className="text-emerald-400 font-bold">{intactCount}</span>
          </div>
          <div className="px-2.5 py-1 rounded bg-neutral-900 border border-neutral-800 flex items-center gap-1.5">
            <span className="text-neutral-400">SWEPT:</span>
            <span className="text-neutral-300 font-bold">{sweptCount}</span>
          </div>
          {confluenceCount > 0 && (
            <div className="px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/30 flex items-center gap-1.5 text-amber-300">
              <Sparkles className="w-3 h-3" />
              <span>CONFLUENCE: {confluenceCount}</span>
            </div>
          )}
        </div>
      </div>

      {/* Levels Grid / Table */}
      {levels.length === 0 ? (
        <div className="py-8 text-center text-xs font-mono text-neutral-500">
          CALCULATING LIQUIDITY POOLS FROM HISTORICAL H1 DATA...
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-400 text-[11px] uppercase tracking-wider bg-neutral-950/40">
                <th className="py-2.5 px-3">Liquidity Pool</th>
                <th className="py-2.5 px-3">Session / Period</th>
                <th className="py-2.5 px-3">Level ($)</th>
                <th className="py-2.5 px-3">Dist to Spot</th>
                <th className="py-2.5 px-3">State</th>
                <th className="py-2.5 px-3">Confluence / Zone Alignment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-850">
              {levels.map((lvl) => {
                const isIntact = lvl.status === 'INTACT';
                const isHigh = lvl.type === 'HIGH';
                const dist = livePrice > 0 ? lvl.price - livePrice : 0;
                const distAbs = Math.abs(dist).toFixed(1);

                // Check if aligned with a zone
                const alignedZone = zones.find(
                  (z) =>
                    z.id === lvl.nearestZoneId ||
                    Math.abs(z.level - lvl.price) <= Math.max(2, 0.3 * (atr14 || 15))
                );

                return (
                  <tr
                    key={lvl.id}
                    className={`hover:bg-neutral-900/50 transition-colors ${
                      isIntact ? '' : 'opacity-70 bg-neutral-950/20'
                    }`}
                  >
                    {/* Pool Name */}
                    <td className="py-3 px-3 font-semibold text-neutral-200">
                      <div className="flex items-center gap-2">
                        {isHigh ? (
                          <span className="p-1 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                            <ArrowUpRight className="w-3 h-3" />
                          </span>
                        ) : (
                          <span className="p-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <ArrowDownRight className="w-3 h-3" />
                          </span>
                        )}
                        <div>
                          <div className="text-neutral-100 font-bold">{lvl.label}</div>
                          <div className="text-[10px] text-neutral-400">{lvl.id}</div>
                        </div>
                      </div>
                    </td>

                    {/* Session / Period */}
                    <td className="py-3 px-3 text-neutral-400 text-[11px]">
                      {lvl.sessionTime || 'Current Cycle'}
                    </td>

                    {/* Price */}
                    <td className="py-3 px-3">
                      <span className="text-sm font-bold text-neutral-100">
                        ${lvl.price.toFixed(2)}
                      </span>
                    </td>

                    {/* Dist to Spot */}
                    <td className="py-3 px-3">
                      {livePrice > 0 ? (
                        <span
                          className={`font-semibold ${
                            Math.abs(dist) <= 5
                              ? 'text-amber-400'
                              : dist > 0
                              ? 'text-neutral-300'
                              : 'text-neutral-400'
                          }`}
                        >
                          {dist > 0 ? `+${distAbs} pts` : `-${distAbs} pts`}
                        </span>
                      ) : (
                        <span className="text-neutral-500">—</span>
                      )}
                    </td>

                    {/* Status: INTACT or SWEPT */}
                    <td className="py-3 px-3">
                      {isIntact ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold tracking-wide bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                          <CheckCircle2 className="w-3 h-3" />
                          INTACT
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold tracking-wide bg-neutral-800 text-neutral-400 border border-neutral-700">
                          <XCircle className="w-3 h-3" />
                          SWEPT
                        </span>
                      )}
                    </td>

                    {/* Confluence */}
                    <td className="py-3 px-3">
                      {alignedZone ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1 font-bold text-amber-300">
                            <Shield className="w-3 h-3 text-amber-400" />
                            {alignedZone.tier} ({alignedZone.id})
                          </span>
                          <span className="text-[10px] text-neutral-400">
                            Within {lvl.nearestZoneDist ?? Math.abs(alignedZone.level - lvl.price).toFixed(1)} pts · {alignedZone.grade === 'A' ? 'Grade A' : 'Grade B'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-neutral-500 text-[11px]">No immediate zone overlap</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Institutional Explanatory Footer */}
      <div className="mt-4 pt-3 border-t border-neutral-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between text-[11px] text-neutral-400 gap-2 font-mono">
        <div>
          <span className="text-amber-400 font-semibold">Institutional Rule:</span> Sell zones within 0.3×ATR of an intact high, or buy zones near an intact low, earn the <span className="text-amber-300 font-bold">[LIQUIDITY]</span> badge & upgrade to Grade A.
        </div>
        <div className="text-neutral-500 text-[10px]">
          ATR(14): ${atr14.toFixed(1)} | Confluence Threshold: &le; ${(0.3 * atr14).toFixed(1)} pts
        </div>
      </div>
    </div>
  );
};
