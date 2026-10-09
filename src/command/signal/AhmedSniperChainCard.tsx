import React, { useState } from 'react';
import { SniperGateResult } from './types';
import { CheckCircle2, XCircle, Lock, Info, ChevronDown, ChevronUp } from 'lucide-react';

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
  const [selectedGate, setSelectedGate] = useState<string | null>(null);
  const [showAllDetails, setShowAllDetails] = useState<boolean>(false);

  const passedCount = gates.filter((g) => g.status === 'PASS').length;
  const isAllPassed = passedCount === gates.length && gates.length > 0;

  return (
    <div className="relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3.5 py-3 flex flex-col justify-between overflow-hidden shadow-lg select-none font-mono">
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

        <div className="flex items-center gap-2">
          {/* Alignment status counter */}
          <div className="flex items-center gap-1.5 text-[9px]">
            <span className="text-[#8a96a8]">CONVERGENCE:</span>
            <span className={`font-bold ${isAllPassed ? 'text-[#22e08a]' : passedCount >= 5 ? 'text-[#f5a524]' : 'text-[#8a96a8]'}`}>
              {passedCount}/8 PASS
            </span>
          </div>

          {/* Toggle details button */}
          <button
            onClick={() => setShowAllDetails(!showAllDetails)}
            className="flex items-center gap-0.5 text-[9px] text-[#38bdf8] hover:text-[#e8edf5] transition-colors cursor-pointer"
          >
            <span>{showAllDetails ? 'COMPACT' : 'DETAILS'}</span>
            {showAllDetails ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
          </button>
        </div>
      </div>

      {/* Gate Grid: 8 Gates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-1.5 my-2.5">
        {gates.map((gate, index) => {
          const isSelected = selectedGate === gate.id;

          // Color tokens per status
          let statusColor = 'text-[#8a96a8] border-white/5 bg-[#04060b]';
          let badgeBg = 'bg-white/5 text-[#8a96a8]';
          let StatusIcon = Lock;

          if (isFeedDimmed) {
            statusColor = 'text-[#8a96a8] border-white/5 bg-[#04060b] opacity-60';
          } else if (gate.status === 'PASS') {
            statusColor = 'border-[#22e08a]/30 bg-[#22e08a]/5 text-[#22e08a]';
            badgeBg = 'bg-[#22e08a]/10 text-[#22e08a] border border-[#22e08a]/30';
            StatusIcon = CheckCircle2;
          } else if (gate.status === 'FAIL') {
            statusColor = 'border-[#ff3b6b]/30 bg-[#ff3b6b]/5 text-[#ff3b6b]';
            badgeBg = 'bg-[#ff3b6b]/10 text-[#ff3b6b] border border-[#ff3b6b]/30';
            StatusIcon = XCircle;
          } else {
            statusColor = 'border-white/5 bg-[#04060b] text-[#8a96a8]';
            badgeBg = 'bg-white/5 text-[#8a96a8] border border-white/5';
            StatusIcon = Lock;
          }

          return (
            <div
              key={gate.id}
              onClick={() => setSelectedGate(isSelected ? null : gate.id)}
              className={`p-2 rounded border transition-all cursor-pointer flex flex-col justify-between min-h-[58px] ${statusColor} ${
                isSelected ? 'ring-1 ring-[#38bdf8]' : ''
              }`}
            >
              {/* Gate number & name */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 truncate">
                  <span className="text-[8px] font-bold text-[#8a96a8] px-1 py-0.2 rounded bg-black/40">
                    {index + 1}
                  </span>
                  <span className="text-[9.5px] font-bold text-white/90 truncate">
                    {gate.shortName}
                  </span>
                  {gate.isEstimated && (
                    <span className="text-[7px] text-[#f5a524] px-1 rounded bg-[#f5a524]/10" title="Derived micro-timeframe model">
                      [EST]
                    </span>
                  )}
                </div>

                <div className={`flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded ${badgeBg}`}>
                  <StatusIcon className="w-2.5 h-2.5" />
                  <span>{gate.status}</span>
                </div>
              </div>

              {/* Short Reason / Trigger Condition */}
              <p className="text-[8px] text-[#8a96a8] line-clamp-1 mt-1 leading-tight" title={gate.reason}>
                {gate.reason}
              </p>
            </div>
          );
        })}
      </div>

      {/* Expanded Details or Selected Gate View */}
      {(showAllDetails || selectedGate) && (
        <div className="mt-1 p-2 rounded bg-[#04060b] border border-white/10 text-[9px] text-[#8a96a8] space-y-1">
          {selectedGate ? (
            (() => {
              const g = gates.find((item) => item.id === selectedGate);
              if (!g) return null;
              return (
                <div>
                  <div className="flex items-center justify-between text-white font-bold mb-0.5">
                    <span>
                      GATE {g.name} ({g.timeframe})
                    </span>
                    <span className={g.status === 'PASS' ? 'text-[#22e08a]' : g.status === 'FAIL' ? 'text-[#ff3b6b]' : 'text-[#8a96a8]'}>
                      {g.status} · {g.direction}
                    </span>
                  </div>
                  <p className="text-[#8a96a8]">{g.reason}</p>
                </div>
              );
            })()
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {gates.map((g, i) => (
                <div key={g.id} className="flex items-start gap-1">
                  <span className="font-bold text-white/70">G{i + 1}:</span>
                  <span className="truncate">{g.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Institutional Thresholds Verification Footer */}
      <div className="pt-2 border-t border-white/5 flex flex-wrap items-center justify-between text-[8px] text-[#8a96a8] gap-2">
        <div className="flex items-center gap-3">
          <span>
            CONFIDENCE: <strong className={confidence >= 65 ? 'text-[#22e08a]' : 'text-[#8a96a8]'}>{confidence.toFixed(0)}%</strong> (Min 65%)
          </span>
          <span>
            OPPOSING PATH: <strong className={pathClearR >= 10 ? 'text-[#22e08a]' : 'text-[#8a96a8]'}>+${pathClearR.toFixed(1)}</strong> (Min 1R / $10)
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-white/50">
          <Info className="w-2.5 h-2.5" />
          <span>Only triggers when all 8 gates PASS in same direction</span>
        </div>
      </div>
    </div>
  );
};
