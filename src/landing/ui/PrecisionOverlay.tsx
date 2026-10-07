import React from 'react';
import { Target, Compass, Clock } from 'lucide-react';
import { HowItWorksSection } from './HowItWorksSection';

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
      className="min-h-screen w-full flex flex-col justify-center px-4 sm:px-8 py-16 pointer-events-auto overflow-x-hidden"
      style={{ opacity }}
    >
      <div className="max-w-6xl mx-auto w-full my-auto">
        {/* Eyebrow & Headline */}
        <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-12">
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
          <p className="mt-3 text-neutral-400 text-xs sm:text-sm">
            Engineered without retail clutter. Three non-negotiable laws that govern every SARRAF execution cycle.
          </p>
        </div>

        {/* 3 Simple Promise Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
          {promises.map((p) => {
            const Icon = p.icon;
            return (
              <div
                key={p.num}
                className="glass-panel p-6 sm:p-7 rounded-2xl relative group hover:border-[#FFD97A]/60 transition-all duration-300 bg-[#08080a]/85 border border-[#E8B84A]/20"
              >
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[#E8B84A]/90 tracking-widest font-semibold">
                      RULE // {p.num}
                    </span>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-[#E8B84A]/10 border border-[#E8B84A]/30 flex items-center justify-center text-[#FFD97A] group-hover:scale-110 transition-transform">
                    <Icon className="w-4 h-4" />
                  </div>
                </div>

                <h3 className="text-lg sm:text-xl font-bold text-white mb-2.5">
                  <span className="font-serif italic text-[#FFD97A]">{p.accent} </span>
                  {p.rest}
                </h3>

                <p className="text-xs text-neutral-300 font-light leading-relaxed">
                  {p.desc}
                </p>

                <div className="mt-5 pt-3 border-t border-white/5 flex items-center justify-between text-[10px] font-mono text-neutral-400">
                  <span>EXECUTION PROTOCOL</span>
                  <span className="text-[#FFD97A] font-semibold">VERIFIED</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Animated 3-step How It Works Section (B5 requirement) */}
        <div className="mt-6 border-t border-white/5 pt-6">
          <HowItWorksSection />
        </div>
      </div>
    </div>
  );
};
