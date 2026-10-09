import React from 'react';
import { MinuteFlowBucket } from '../data/commandTypes';

interface TickFlowHistogramPanelProps {
  minuteFlows: MinuteFlowBucket[];
  isDimmed: boolean;
  freshness: string;
}

export const TickFlowHistogramPanel: React.FC<TickFlowHistogramPanelProps> = ({
  minuteFlows,
  isDimmed,
  freshness,
}) => {
  const displayBuckets = minuteFlows.slice(-60);
  const currentNet = displayBuckets[displayBuckets.length - 1]?.netTicks || 0;
  const maxNet = Math.max(5, ...displayBuckets.map((b) => Math.abs(b.netTicks)));
  const hasEnoughBuckets = displayBuckets.length >= 20;

  return (
    <div
      className={`relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 transition-opacity duration-300 overflow-hidden ${
        isDimmed ? 'opacity-40' : 'opacity-100'
      }`}
    >
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent" />

      {/* Header */}
      <div className="flex items-center justify-between font-mono mb-1">
        <span className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-[0.12em]">
          11. TICK FLOW
        </span>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8a96a8]">
          <span className="px-1 py-0.2 rounded bg-white/5 uppercase">ESTIMATED</span>
          <span>·</span>
          <span>{freshness}</span>
        </div>
      </div>

      {!hasEnoughBuckets ? (
        <div className="h-[60px] flex items-center justify-center font-mono text-[11px] text-[#8a96a8]">
          collecting data ({displayBuckets.length}/40 buckets)...
        </div>
      ) : (
        <>
          {/* Current value as a large number above */}
          <div className="flex items-baseline gap-1.5 font-mono mb-1.5">
            <span
              className={`text-xl font-black tabular-nums ${
                currentNet >= 0 ? 'text-[#22e08a]' : 'text-[#ff3b6b]'
              }`}
            >
              {currentNet >= 0 ? `+${currentNet}` : currentNet}
            </span>
            <span className="text-[10px] text-[#8a96a8]">net ticks</span>
          </div>

          {/* 40-60 thin per-minute bars: height 40px, 1px-2px thin vertical bars */}
          <div className="relative h-[40px] w-full bg-[#04060b] rounded px-1 flex items-center">
            {/* Zero center horizontal dashed line */}
            <div className="absolute left-1 right-1 top-1/2 -translate-y-1/2 border-b border-white/10 z-0" />

            <div className="relative z-10 w-full h-full flex items-center justify-between gap-[1px]">
              {displayBuckets.map((b, idx) => {
                const isPos = b.netTicks >= 0;
                const hPct = Math.min(100, (Math.abs(b.netTicks) / maxNet) * 95);
                return (
                  <div key={idx} className="flex-1 h-full flex flex-col justify-center items-center min-w-[2px]">
                    <div className="w-full h-1/2 flex items-end justify-center">
                      {isPos && (
                        <div
                          className="w-full max-w-[4px] rounded-[0.5px] bg-[#22e08a]"
                          style={{ height: `${Math.max(4, hPct)}%` }}
                        />
                      )}
                    </div>
                    <div className="w-full h-1/2 flex items-start justify-center">
                      {!isPos && (
                        <div
                          className="w-full max-w-[4px] rounded-[0.5px] bg-[#ff3b6b]"
                          style={{ height: `${Math.max(4, hPct)}%` }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
