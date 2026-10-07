import React, { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';

interface FaqItem {
  q: string;
  a: string;
}

const FAQS: FaqItem[] = [
  {
    q: 'What is SARRAF?',
    a: 'SARRAF is a high-precision institutional analytical engine specifically built for spot gold (XAU/USD). It tracks real-time COMEX and MetaTrader 5 order books, computes multi-timeframe structural zones, and generates disciplined risk-managed trade setups.',
  },
  {
    q: 'How do signals arrive?',
    a: 'Signals are broadcast directly to your private Telegram client via our secure low-latency webhook runner. Each message contains exact numerical entry parameters: Direction (BUY/SELL), Entry Zone, Stop Loss, and 4 Take-Profit targets.',
  },
  {
    q: 'How many signals are issued per day?',
    a: 'SARRAF enforces strict quality over volume. The system targets between 1 to 3 highest-conviction setups per trading day, bounded by an algorithmic daily ceiling and mandatory 30-45 minute cooldowns between trades.',
  },
  {
    q: 'Is this financial advice?',
    a: 'No. SARRAF provides computational market research, macro news radar monitoring, and automated execution models for informational purposes. Trading precious metals carries capital risk; past simulation or live performance is never a guarantee of future outcomes.',
  },
];

export const FaqAccordion: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (idx: number) => {
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-12">
      <div className="text-center max-w-xl mx-auto mb-8">
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
                  className={`w-4 h-4 text-[#E8B84A] transition-transform duration-300 shrink-0 ml-3 ${
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
