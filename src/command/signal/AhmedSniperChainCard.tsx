import React, { useState } from 'react';
import { SniperGateResult } from './types';
import { CheckCircle2, XCircle, Lock, Clock, ChevronDown, ChevronUp } from 'lucide-react';

interface AhmedSniperChainCardProps {
  gates: SniperGateResult[];
  confidence: number;
  pathClearR: number;
  isFeedDimmed: boolean;
}

export const AhmedSniperChainCard: React.FC<AhmedSniperChainCardProps> = ({
  gates,
  confidence,
  pathClearR,
  isFeedDimmed,
}) => {
  const [expandedGate, setExpandedGate] = useState<string | null>(null);

  const passedCount = gates.filter((g) => g.status === 'PASS').length;
  const isAllPassed = passedCount === gates.length && gates.length > 0;

  return (
    <div className="relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 flex flex-col justify-between overflow-hidden shadow-lg select-none font-mono">
      {/* Top subtle glow bar */}
      <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#38bdf8]/50 to-transparent" />

      {/* Header Row */}
      <div className="flex items-center justify-between pb-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold tracking-[0.14em] text-[#38bdf8] uppercase">
            AHMED SNIPER CHAIN
          </span>
          <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/5 text-[#8a96a8] border border-white/5">
            8 GATES
          </span>
        </div>

        {/* Alignment status counter */}
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="text-[#8a96a8]">ALIGNMENT:</span>
          <span
            className={`font-bold ${
              isAllPassed
                ? 'text-[#22e08a]'
                : passedCount >= 5
                ? 'text-[#f5a524]'
                : 'text-[#8a96a8]'
            }`}
          >
            {passedCount}/8 PASS
          </span>
        </div>
      </div>

      {/* Compact 2-Column Grid */}
      <div className="grid grid-cols-2 gap-1.5 my-2">
        {gates.map((gate, index) => {
          const isExpanded = expandedGate === gate.id;

          let dotBg = 'bg-[#8a96a8]';
          let textColor = 'text-[#8a96a8]';
          let statusLabel = 'LOCKED';
          let borderClass = 'border-white/5 bg-[#04060b]';

          if (isFeedDimmed) {
            dotBg = 'bg-[#8a96a8]';
            statusLabel = 'LOCKED';
          } else if (gate.status === 'PASS') {
            dotBg = 'bg-[#22e08a]';
            textColor = 'text-[#22e08a]';
            statusLabel = 'OK';
            borderClass = 'border-[#22e08a]/20 bg-[#22e08a]/5';
          } else if (gate.status === 'FAIL') {
            dotBg = 'bg-[#ff3b6b]';
            textColor = 'text-[#ff3b6b]';
            statusLabel = 'FAIL';
            borderClass = 'border-[#ff3b6b]/20 bg-[#ff3b6b]/5';
          }

          return (
            <div
              key={gate.id}
              onClick={() => setExpandedGate(isExpanded ? null : gate.id)}
              className={`p-1.5 rounded border transition-all cursor-pointer flex flex-col justify-center ${borderClass} hover:border-[#38bdf8]/40`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 truncate">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotBg}`} />
                  <span className="text-[10px] font-bold text-white/90 truncate">
                    {gate.shortName || gate.name}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <span className={`text-[9px] font-bold ${textColor}`}>
                    {statusLabel}
                  </span>
                  {isExpanded ? (
                    <ChevronUp className="w-2.5 h-2.5 text-[#8a96a8]" />
                  ) : (
                    <ChevronDown className="w-2.5 h-2.5 text-[#8a96a8]" />
                  )}
                </div>
              </div>

              {/* Tap to expand one-line reason */}
              {isExpanded && (
                <div className="mt-1.5 pt-1.5 border-t border-white/5 text-[8.5px] text-[#8a96a8] leading-tight">
                  <div className="text-white/80 font-bold mb-0.5">
                    {gate.name} ({gate.timeframe})
                  </div>
                  <p>{gate.reason}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* SARRAF Thresholds Verification Footer */}
      <div className="pt-1.5 border-t border-white/5 flex items-center justify-between text-[8px] text-[#8a96a8]">
        <div className="flex items-center gap-2">
          <span>
            CONF: <strong className={confidence >= 65 ? 'text-[#22e08a]' : 'text-[#8a96a8]'}>{confidence.toFixed(0)}%</strong>
          </span>
          <span>·</span>
          <span>
            PATH: <strong className={pathClearR >= 10 ? 'text-[#22e08a]' : 'text-[#8a96a8]'}>+${pathClearR.toFixed(1)}</strong>
          </span>
        </div>
        <span className="text-white/40">Tap gate to view reason</span>
      </div>
    </div>
  );
};
