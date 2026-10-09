import React from 'react';
import { MinuteFlowBucket } from '../data/commandTypes';

interface TickImpactNetPanelProps {
  minuteFlows: MinuteFlowBucket[];
  buyTicks60s: number;
  sellTicks60s: number;
  isDimmed: boolean;
  freshness: string;
}

export const TickImpactNetPanel: React.FC<TickImpactNetPanelProps> = ({
  minuteFlows,
  buyTicks60s,
  sellTicks60s,
  isDimmed,
  freshness,
}) => {
  const currentBucket = minuteFlows[minuteFlows.length - 1];
  const hasData = Boolean(minuteFlows.length >= 5 && currentBucket && (currentBucket.buyTicks + currentBucket.sellTicks > 0));
  const currentImpact = currentBucket?.impactDollarsPerTick ?? 0;
  const maxImpact = Math.max(0.5, ...minuteFlows.map((b) => b.impactDollarsPerTick));

  const net60s = buyTicks60s - sellTicks60s;
  const isNetBullish = net60s >= 0;

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
          12. TICK IMPACT & NET
        </span>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8a96a8]">
          <span className="px-1 py-0.2 rounded bg-white/5 uppercase">ESTIMATED</span>
          <span>·</span>
          <span>{freshness}</span>
        </div>
      </div>

      {/* Compact 2-column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
        {/* Tick Impact ($ per tick, height 40px bar histogram) */}
        <div>
          <span className="text-[9px] text-[#8a96a8] uppercase block">
            TICK IMPACT
          </span>
          {/* Large number above: real dollar price delta per tick, no hardcoded fallbacks */}
          <div className="flex items-baseline gap-1 mt-0.5 mb-1.5">
            {hasData ? (
              <>
                <span className="text-xl font-black text-[#e8edf5] tabular-nums">
                  ${currentImpact.toFixed(2)}
                </span>
                <span className="text-[9px] text-[#8a96a8]">/ tick</span>
              </>
            ) : (
              <span className="text-sm font-medium text-[#8a96a8]">
                collecting data...
              </span>
            )}
          </div>

          {/* 40px height bar histogram */}
          <div className="h-[40px] w-full bg-[#04060b] rounded px-1.5 flex items-end justify-between gap-[2px]">
            {minuteFlows.length < 5 ? (
              <div className="w-full h-full flex items-center justify-center text-[9px] text-[#8a96a8]">
                collecting data ({minuteFlows.length}/5)...
              </div>
            ) : (
              minuteFlows.map((b, idx) => {
                const hPct = Math.min(100, (b.impactDollarsPerTick / maxImpact) * 90);
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

        {/* Tick Net (60s net with up/down counts) */}
        <div className="flex flex-col justify-between">
          <div>
            <span className="text-[9px] text-[#8a96a8] uppercase block">
              TICK NET (60S)
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span
                className={`text-xl font-black tabular-nums ${
                  isNetBullish ? 'text-[#22e08a]' : 'text-[#ff3b6b]'
                }`}
              >
                {isNetBullish ? `+${net60s}` : net60s}
              </span>
              <span className="text-[9px] text-[#8a96a8]">net ticks</span>
            </div>
          </div>

          {/* Up / Down counts row (22px row height) */}
          <div className="flex items-center justify-between h-[22px] text-[11px] mt-1 pt-1 border-t border-white/5">
            <span className="text-[#22e08a] font-bold tabular-nums">
              +{buyTicks60s} UP
            </span>
            <span className="text-[#8a96a8]">·</span>
            <span className="text-[#ff3b6b] font-bold tabular-nums">
              -{sellTicks60s} DN
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
