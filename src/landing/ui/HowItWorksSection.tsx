import React from 'react';
import { Activity, Send, ShieldCheck, ArrowRight } from 'lucide-react';

const STEPS = [
  {
    step: '01',
    title: 'Live XAU/USD price',
    subtitle: 'Real-Time Market Data',
    desc: 'Live gold spot ticks stream continuously. Technical structures are analyzed across M15 and H1 candles to identify key support and resistance zones.',
    icon: Activity,
    highlight: 'Real-time spot price tracking',
  },
  {
    step: '02',
    title: 'Signals delivered to Telegram',
    subtitle: 'Direct Bot Dispatch',
    desc: 'When technical criteria align, a structured setup is dispatched directly to the Telegram bot. Each signal includes exact Entry Zone, Stop Loss, and Take Profit levels.',
    icon: Send,
    highlight: 'One signal at a time',
  },
  {
    step: '03',
    title: 'TP / SL updates and cooldown',
    subtitle: 'Disciplined Lifecycle',
    desc: 'Telegram receives live progress updates as targets are hit. When a trade completes at SL or TP, the system enters cooldown before scanning for the next opportunity.',
    icon: ShieldCheck,
    highlight: 'Post-trade cooldown',
  },
];

export const HowItWorksSection: React.FC = () => {
  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8 sm:py-12">
      <div className="text-center max-w-xl mx-auto mb-8 sm:mb-10">
        <div className="inline-flex items-center gap-2 text-[10px] font-mono tracking-[0.25em] text-[#FFD97A] uppercase mb-2">
          <span className="w-4 h-[1px] bg-[#E8B84A]" />
          <span>WORKFLOW</span>
          <span className="w-4 h-[1px] bg-[#E8B84A]" />
        </div>
        <h3 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
          How SARRAF{' '}
          <span className="font-serif italic text-[#FFD97A] gold-glow-text">
            operates.
          </span>
        </h3>
        <p className="mt-2 text-xs sm:text-sm text-neutral-400 font-light leading-relaxed">
          Three clear stages from live market observation to Telegram dispatch and trade cooldown.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {STEPS.map((s, idx) => {
          const Icon = s.icon;
          return (
            <div
              key={s.step}
              className="p-6 rounded-2xl border border-[#E8B84A]/25 relative group hover:border-[#FFD97A]/60 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] bg-[#08080b]/85 backdrop-blur-md flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="font-mono text-2xl font-black text-[#E8B84A]/40 group-hover:text-[#FFD97A] transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]">
                    {s.step}
                  </span>
                  <div className="w-9 h-9 rounded-full bg-[#E8B84A]/10 border border-[#E8B84A]/30 flex items-center justify-center text-[#FFD97A] group-hover:scale-110 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] shadow-[0_0_12px_rgba(232,184,74,0.15)]">
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
                  <ArrowRight className="w-3.5 h-3.5 text-neutral-600 group-hover:text-[#FFD97A] group-hover:translate-x-1 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hidden md:block" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
