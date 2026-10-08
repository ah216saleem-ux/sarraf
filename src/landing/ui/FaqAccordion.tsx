import React, { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';

interface FaqItem {
  q: string;
  a: string;
}

const FAQS: FaqItem[] = [
  {
    q: 'What is SARRAF?',
    a: 'SARRAF is a live market analysis and signal delivery platform for spot gold (XAU/USD). It tracks real-time price feeds, calculates key technical support and resistance levels, and provides structured trade setups.',
  },
  {
    q: 'How do signals arrive?',
    a: 'Signals are delivered directly to the SARRAF Telegram bot. Each message contains exact parameters: Direction (BUY/SELL), Entry Zone, Stop Loss, and Take Profit targets.',
  },
  {
    q: 'How many signals are issued per day?',
    a: 'SARRAF focuses on disciplined execution with one signal active at a time. The system only triggers when market conditions align, with mandatory cooldown between trades.',
  },
  {
    q: 'Is this financial advice?',
    a: 'No. SARRAF provides computational market research, macro news monitoring, and automated signals for informational purposes only. Trading precious metals carries risk; past performance is no guarantee of future returns.',
  },
];

export const FaqAccordion: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (idx: number) => {
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 sm:py-12">
      <div className="text-center max-w-xl mx-auto mb-6 sm:mb-8">
        <div className="inline-flex items-center gap-2 text-[10px] font-mono tracking-[0.25em] text-[#FFD97A] uppercase mb-2">
          <HelpCircle className="w-3.5 h-3.5 text-[#E8B84A]" />
          <span>FREQUENTLY ASKED QUESTIONS</span>
        </div>
        <h3 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
          Clarity &{' '}
          <span className="font-serif italic text-[#FFD97A] gold-glow-text">
            transparency.
          </span>
        </h3>
      </div>

      <div className="space-y-3 font-mono">
        {FAQS.map((faq, idx) => {
          const isOpen = openIndex === idx;
          return (
            <div
              key={faq.q}
              className="rounded-xl border border-[#E8B84A]/20 bg-[#08080a]/80 backdrop-blur-md overflow-hidden transition-all duration-200"
            >
              <button
                onClick={() => toggle(idx)}
                className="w-full p-4 sm:p-5 flex items-center justify-between text-left text-xs sm:text-sm font-semibold text-white hover:text-[#FFD97A] transition-colors cursor-pointer"
              >
                <span>{faq.q}</span>
                <ChevronDown
                  className={`w-4 h-4 text-[#E8B84A] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] shrink-0 ml-3 ${
                    isOpen ? 'rotate-180' : 'rotate-0'
                  }`}
                />
              </button>

              {isOpen && (
                <div className="px-4 sm:px-5 pb-5 text-xs text-neutral-300 font-light leading-relaxed border-t border-white/5 pt-3 animate-in fade-in duration-200">
                  {faq.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
