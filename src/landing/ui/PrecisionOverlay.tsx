import React from 'react';
import { Target, Compass, Clock } from 'lucide-react';

interface PrecisionOverlayProps {
  opacity: number;
}

export const PrecisionOverlay: React.FC<PrecisionOverlayProps> = ({ opacity }) => {
  if (opacity <= 0.01) return null;

  const promises = [
    {
      num: '01',
      title: 'One signal at a time.',
      accent: 'One signal',
      rest: 'at a time.',
      icon: Target,
      desc: 'No conflicting ideas. No second-guessing. You receive only the single highest-conviction setup across all gold sessions.',
    },
    {
      num: '02',
      title: 'Clear Entry, SL, TP.',
      accent: 'Clear Entry,',
      rest: 'SL, TP.',
      icon: Compass,
      desc: 'Strict mathematical invalidation levels and layered profit targets mapped before any capital enters the market.',
    },
    {
      num: '03',
      title: 'Cooldown discipline.',
      accent: 'Cooldown',
      rest: 'discipline.',
      icon: Clock,
      desc: 'Mandatory algorithmic cooldown between cycles to eliminate revenge trades and guard institutional equity drawdowns.',
    },
  ];

  return (
    <div
      className="min-h-screen w-full flex flex-col justify-center px-4 sm:px-8 py-20 pointer-events-auto"
      style={{ opacity }}
    >
      <div className="max-w-6xl mx-auto w-full">
        {/* Eyebrow & Headline */}
        <div className="text-center max-w-2xl mx-auto mb-12 sm:mb-16">
          <div className="inline-flex items-center gap-3 text-xs font-mono tracking-[0.25em] text-[#FFD97A]/80 uppercase mb-3">
            <span className="w-6 h-[1px] bg-[#E8B84A]" />
            <span>INSTITUTIONAL CODE</span>
            <span className="w-6 h-[1px] bg-[#E8B84A]" />
          </div>
          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white">
            Purity of execution,{' '}
            <span className="font-serif italic text-[#FFD97A] gold-glow-text">
              guaranteed.
            </span>
          </h2>
          <p className="mt-3 text-neutral-400 text-sm sm:text-base">
            Engineered without retail clutter. Three non-negotiable laws that govern every SARRAF execution cycle.
          </p>
        </div>

        {/* 3 Simple Promise Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {promises.map((p) => {
            const Icon = p.icon;
            return (
              <div
                key={p.num}
                className="glass-panel p-6 sm:p-8 rounded-2xl relative group hover:border-[#FFD97A]/60 transition-all duration-300"
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[#E8B84A]/70 tracking-widest">
                      RULE // {p.num}
                    </span>
                    <span className="text-[9px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      DEMO
                    </span>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-[#E8B84A]/10 border border-[#E8B84A]/30 flex items-center justify-center text-[#FFD97A] group-hover:scale-110 transition-transform">
                    <Icon className="w-4 h-4" />
                  </div>
                </div>

                <h3 className="text-xl sm:text-2xl font-bold text-white mb-3">
                  <span className="font-serif italic text-[#FFD97A]">{p.accent} </span>
                  {p.rest}
                </h3>

                <p className="text-sm text-neutral-400 font-light leading-relaxed">
                  {p.desc}
                </p>

                <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-[11px] font-mono text-neutral-500">
                  <span>EXECUTION PROTOCOL</span>
                  <span className="text-[#FFD97A]">VERIFIED</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
