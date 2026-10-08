import React from 'react';
import { Lock, Sparkles } from 'lucide-react';

interface TopAreaPlaceholdersProps {
  buyRatio: number;
  sellRatio: number;
  isDimmed: boolean;
  freshness: string;
}

export const TopAreaPlaceholders: React.FC<TopAreaPlaceholdersProps> = ({
  buyRatio,
  sellRatio,
  isDimmed,
  freshness,
}) => {
  const sniperGates = [
    { id: 'g1', name: 'W1/D1 Context' },
    { id: 'g2', name: 'H4 Bias' },
    { id: 'g3', name: 'H1 Confirmation' },
    { id: 'g4', name: 'M30 Refinement' },
    { id: 'g5', name: 'M15 Body Close' },
    { id: 'g6', name: 'M5 Retest' },
    { id: 'g7', name: 'M5 Confirmation' },
    { id: 'g8', name: 'Entry' },
  ];

  return (
    <div className={`space-y-2 transition-opacity duration-300 ${isDimmed ? 'opacity-40' : 'opacity-100'}`}>
      {/* Reserved Block for Phase 2 Animation with Live BUY FLOW % & SELL FLOW % */}
      <div className="relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent" />

        <div className="flex items-center justify-between gap-2">
          {/* Left Live Box: BUY FLOW % */}
          <div className="flex-1 flex flex-col items-start font-mono">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-[0.12em] text-[#8a96a8]">
                BUY FLOW (EST.)
              </span>
              <span className="text-[8px] text-[#8a96a8]/70 uppercase">· {freshness}</span>
            </div>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-lg sm:text-xl font-bold tabular-nums text-[#22e08a]">
                {buyRatio}%
              </span>
              <span className="text-[9px] text-[#8a96a8]">60s</span>
            </div>
          </div>

          {/* Center Reserved Animation Slot */}
          <div className="flex-[1.2] flex items-center justify-center py-1 px-2 rounded bg-[#04060b] border border-dashed border-[#38bdf8]/25 text-center">
            <div className="flex items-center gap-1 text-[9px] font-mono text-[#38bdf8]">
              <Sparkles className="w-2.5 h-2.5 text-[#38bdf8]" />
              <span>PHASE 2 3D CORE</span>
            </div>
          </div>

          {/* Right Live Box: SELL FLOW % */}
          <div className="flex-1 flex flex-col items-end text-right font-mono">
            <div className="flex items-center gap-1.5 justify-end">
              <span className="text-[8px] text-[#8a96a8]/70 uppercase">{freshness} ·</span>
              <span className="text-[9px] uppercase tracking-[0.12em] text-[#8a96a8]">
                SELL FLOW (EST.)
              </span>
            </div>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-[9px] text-[#8a96a8]">60s</span>
              <span className="text-lg sm:text-xl font-bold tabular-nums text-[#ff3b6b]">
                {sellRatio}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2-Column Compact Row: DECISION & AHMED SNIPER CHAIN */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
        {/* DECISION Card */}
        <div className="md:col-span-4 relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 flex flex-col justify-between overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent" />

          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold tracking-[0.12em] text-[#38bdf8] uppercase">
              DECISION
            </span>
            <span className="text-[9px] font-mono text-[#8a96a8]">PHASE 4 · N/A</span>
          </div>

          <div className="flex items-center justify-between my-1">
            <div className="flex items-center gap-1.5 font-mono">
              <span className="w-2 h-2 rounded-full bg-[#f5a524]" />
              <span className="text-base font-bold text-[#f5a524] tracking-wider">WAIT</span>
            </div>
            <span className="text-[9px] font-mono text-[#8a96a8]">NO SETUP (N/A)</span>
          </div>

          <span className="text-[10px] font-mono text-[#8a96a8] truncate">
            Awaiting Phase 4 sniper convergence gates.
          </span>
        </div>

        {/* AHMED SNIPER CHAIN Card */}
        <div className="md:col-span-8 relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 flex flex-col justify-between overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent" />

          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-mono font-bold tracking-[0.12em] text-[#38bdf8] uppercase">
              AHMED SNIPER CHAIN
            </span>
            <span className="text-[9px] font-mono text-[#8a96a8]">PHASE 4 · N/A</span>
          </div>

          {/* Compact 8 gates grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 font-mono">
            {sniperGates.map((gate) => (
              <div
                key={gate.id}
                className="flex items-center justify-between px-1.5 py-1 rounded bg-[#04060b] border border-white/5 h-[24px]"
              >
                <span className="text-[9px] text-[#8a96a8] truncate max-w-[85px]">
                  {gate.name}
                </span>
                <div className="flex items-center gap-1 text-[8px] text-[#8a96a8] font-bold">
                  <Lock className="w-2.5 h-2.5 text-[#8a96a8]" />
                  <span>LOCKED</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
