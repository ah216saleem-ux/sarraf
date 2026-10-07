import React from 'react';
import { Activity, Send, ShieldCheck, ArrowRight } from 'lucide-react';

const STEPS = [
  {
    step: '01',
    title: 'Live Gold Price',
    subtitle: 'Microsecond Ingestion',
    desc: 'Real-time XAU/USD order flow streams directly into the institutional engine. Ticks are verified, consolidated across M15/H1 candles, and filtered for algorithmic structure.',
    icon: Activity,
    highlight: 'Direct COMEX / MT5 tick feed',
  },
  {
    step: '02',
    title: 'Signal on Telegram',
    subtitle: 'Zero-Friction Push',
    desc: 'When high-conviction order imbalance aligns, a dedicated setup fires to private Telegram bots. Clear Entry Zone, Stop Loss, and layered TP1 to TP4 coordinates arrive in under 40ms.',
    icon: Send,
    highlight: 'No noise · Single setup focus',
  },
  {
    step: '03',
    title: 'Outcome & Cooldown',
    subtitle: 'Systematic Capital Guard',
    desc: 'Take-profit targets trigger trailing stops automatically. Upon trade closure, a mandatory 30 to 45 minute algorithmic cooldown locks the desk, preventing revenge trades.',
    icon: ShieldCheck,
    highlight: 'Algorithmic equity protection',
  },
];

export const HowItWorksSection: React.FC = () => {
  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-12">
      <div className="text-center max-w-xl mx-auto mb-10">
        <div className="inline-flex items-center gap-2 text-[10px] font-mono tracking-[0.25em] text-[#FFD97A] uppercase mb-2">
          <span className="w-4 h-[1px] bg-[#E8B84A]" />
          <span>EXECUTION WORKFLOW</span>
          <span className="w-4 h-[1px] bg-[#E8B84A]" />
        </div>
        <h3 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
          How SARRAF{' '}
          <span className="font-serif italic text-[#FFD97A] gold-glow-text">
            operates.
          </span>
        </h3>
        <p className="mt-2 text-xs sm:text-sm text-neutral-400 font-light leading-relaxed">
          Three streamlined stages from raw gold order flow to systematic execution and capital discipline.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {STEPS.map((s, idx) => {
          const Icon = s.icon;
          return (
            <div
              key={s.step}
              className="glass-panel p-6 rounded-2xl border border-[#E8B84A]/25 relative group hover:border-[#FFD97A]/60 transition-all duration-300 bg-[#08080b]/80 backdrop-blur-md flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="font-mono text-2xl font-black text-[#E8B84A]/40 group-hover:text-[#FFD97A] transition-colors">
                    {s.step}
                  </span>
                  <div className="w-9 h-9 rounded-full bg-[#E8B84A]/10 border border-[#E8B84A]/30 flex items-center justify-center text-[#FFD97A] group-hover:scale-110 transition-transform shadow-[0_0_12px_rgba(232,184,74,0.15)]">
                    <Icon className="w-4 h-4" />
                  </div>
                </div>

                <div className="text-[10px] font-mono uppercase tracking-widest text-[#FFD97A]/70 mb-1">
                  {s.subtitle}
                </div>
                <h4 className="text-lg font-bold text-white mb-2 tracking-tight">
                  {s.title}
                </h4>
                <p className="text-xs text-neutral-300 font-light leading-relaxed">
                  {s.desc}
                </p>
              </div>

              <div className="mt-6 pt-3 border-t border-white/5 flex items-center justify-between text-[10px] font-mono text-[#FFD97A]">
                <span>{s.highlight}</span>
                {idx < 2 && (
                  <ArrowRight className="w-3.5 h-3.5 text-neutral-600 group-hover:text-[#FFD97A] group-hover:translate-x-1 transition-all hidden md:block" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
