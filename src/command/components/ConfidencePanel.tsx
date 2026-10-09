import React from 'react';
import { ConfidenceBreakdown } from '../data/commandTypes';

interface ConfidencePanelProps {
  confidence: ConfidenceBreakdown;
  signalConfidence?: number;
  isDimmed: boolean;
  freshness: string;
}

export const ConfidencePanel: React.FC<ConfidencePanelProps> = ({
  confidence,
  signalConfidence,
  isDimmed,
  freshness,
}) => {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (confidence.overall / 100) * circumference;

  const rows = [
    { label: 'Flow', val: confidence.flow, dot: 'bg-[#22e08a]' },
    { label: 'Structure', val: confidence.structure, dot: 'bg-[#38bdf8]' },
    { label: 'Liquidity', val: confidence.liquidity, dot: 'bg-[#22e08a]' },
    { label: 'Momentum', val: confidence.momentum, dot: 'bg-[#f5a524]' },
    { label: 'Sentiment', val: confidence.sentiment, dot: 'bg-[#38bdf8]' },
    { label: 'Market Total', val: confidence.overall, dot: 'bg-[#22e08a]' },
  ];

  const hasData = confidence.overall > 0;

  return (
    <div
      className={`relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 transition-opacity duration-300 overflow-hidden ${
        isDimmed ? 'opacity-40' : 'opacity-100'
      }`}
    >
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent" />

      {/* Header */}
      <div className="flex items-center justify-between font-mono mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-[0.12em]">
            10. MARKET CONFIDENCE
          </span>
          {typeof signalConfidence === 'number' && (
            <span className="text-[9px] px-1 py-0.2 rounded bg-[#38bdf8]/10 text-[#38bdf8] border border-[#38bdf8]/30">
              SIGNAL CONFIDENCE: {signalConfidence}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8a96a8]">
          <span className="px-1 py-0.2 rounded bg-white/5 uppercase">ESTIMATED</span>
          <span>·</span>
          <span>{freshness}</span>
        </div>
      </div>

      {!hasData ? (
        <div className="h-[96px] flex items-center justify-center font-mono text-[11px] text-[#8a96a8]">
          collecting data...
        </div>
      ) : (
        <div className="flex items-center gap-5 font-mono">
          {/* Left: Small 96px circular ring */}
          <div className="relative w-[96px] h-[96px] flex-shrink-0 flex items-center justify-center">
            <svg className="w-[96px] h-[96px] transform -rotate-90">
              <circle
                cx="48"
                cy="48"
                r={radius}
                className="stroke-[#04060b]"
                strokeWidth="6"
                fill="transparent"
              />
              <circle
                cx="48"
                cy="48"
                r={radius}
                stroke="#22e08a"
                strokeWidth="6"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
                className="transition-all duration-300 ease-out"
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-black text-[#e8edf5] tabular-nums">
                {confidence.overall}%
              </span>
            </div>
          </div>

          {/* Right: Compact rows (label, % with tiny coloured dot), no big caption */}
          <div className="flex-1 space-y-0.5 text-[11px]">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between h-[20px]">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${r.dot}`} />
                  <span className="text-[#8a96a8]">{r.label}</span>
                </div>
                <span className="text-[#e8edf5] font-bold tabular-nums">
                  {r.val}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
