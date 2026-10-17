// src/atlas/components/AtlasAnalyzingSkeleton.tsx
import React from 'react';
import { Clock, Activity } from 'lucide-react';

interface AtlasAnalyzingSkeletonProps {
  countdownText: string;
}

export const AtlasAnalyzingSkeleton: React.FC<AtlasAnalyzingSkeletonProps> = ({ countdownText }) => {
  // Extract remaining time or show countdown
  const timeRemaining = countdownText.replace('NEW ZONES IN ', '');

  return (
    <div className="glass-panel p-6 sm:p-8 rounded-2xl border border-amber-500/40 text-center font-mono space-y-5 animate-pulse">
      <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/40 flex items-center justify-center text-amber-400 mx-auto">
        <Activity className="w-6 h-6 animate-spin text-amber-400" />
      </div>

      <div className="space-y-1">
        <h3 className="text-base sm:text-lg font-extrabold text-amber-300 tracking-wider">
          ANALYZING MARKET… {timeRemaining} REMAINING
        </h3>
        <p className="text-xs text-neutral-400 max-w-md mx-auto leading-relaxed">
          60-minute post-rollover analysis window active. Processing sarraf order flow, collecting closed H1 candles, and preparing fresh frozen supply/demand zones.
        </p>
      </div>

      {/* Skeleton Cards Stack */}
      <div className="max-w-2xl mx-auto space-y-2 pt-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-12 w-full rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between px-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-6 rounded bg-white/10" />
              <div className="w-32 h-4 rounded bg-white/10" />
            </div>
            <div className="w-24 h-4 rounded bg-white/10" />
          </div>
        ))}
      </div>

      <div className="inline-flex items-center gap-2 text-xs text-amber-400/80 px-3 py-1.5 rounded-lg bg-amber-950/40 border border-amber-800/40">
        <Clock className="w-3.5 h-3.5" />
        <span>FROZEN MATRIX PUBLISHES AT ROLLOVER + 60 MIN</span>
      </div>
    </div>
  );
};
