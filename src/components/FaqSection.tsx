import React, { useState, useEffect } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export const SARRAF_FAQ_ITEMS: FaqItem[] = [
  {
    id: 'faq-access',
    question: 'How do I get access?',
    answer:
      'SARRAF is a private, invite-only gold intelligence terminal. Click “Enter” to open the SARRAF Terminal Login modal and select “Request access” or tap “Contact Admin on WhatsApp” to verify your profile and receive your personal terminal credentials.',
  },
  {
    id: 'faq-signals',
    question: 'When do signals arrive?',
    answer:
      'Signals are dispatched in real time during active London and New York bullion liquidity windows whenever an institutional confluence setup triggers. Only one active setup is tracked at a time—with automated break-even alerts at Target 1 and pre-news volatility shields before CPI, FOMC, and NFP releases.',
  },
  {
    id: 'faq-risk',
    question: 'What is the risk?',
    answer:
      'Spot gold (XAU/USD) and leveraged derivatives carry a high level of risk and may not be suitable for every participant. Every SARRAF setup includes a hard invalidation stop-loss and staged take-profit levels, but past performance does not guarantee future results. Never trade with capital you cannot afford to lose.',
  },
  {
    id: 'faq-privacy',
    question: 'Is my data private?',
    answer:
      'Yes. SARRAF never stores passwords in client storage, never sells user telemetry, and uses encrypted session cookies for authenticated terminal access. When you request an invite via WhatsApp, your message is sent directly from your device to the administrator.',
  },
  {
    id: 'faq-markets',
    question: 'Which markets do you cover?',
    answer:
      'SARRAF is dedicated exclusively to spot gold (XAU/USD) and the primary US macro catalysts—US Dollar Index (DXY), Treasury yields, CPI, NFP, and Federal Reserve policy—that drive bullion order flow across Sydney, Tokyo, London, and New York.',
  },
];

export const FaqSection: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  // Ensure FAQPage JSON-LD is present in document head when mounted
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const scriptId = 'sarraf-faq-jsonld';
    if (document.getElementById(scriptId)) return;

    const script = document.createElement('script');
    script.id = scriptId;
    script.type = 'application/ld+json';
    script.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: SARRAF_FAQ_ITEMS.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    });
    document.head.appendChild(script);

    return () => {
      const existing = document.getElementById(scriptId);
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
    };
  }, []);

  const toggleItem = (idx: number) => {
    setOpenIndex((prev) => (prev === idx ? null : idx));
  };

  return (
    <div className="w-full max-w-3xl mx-auto text-left mt-6">
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.26em] text-[#FFD97A] uppercase">
          <HelpCircle className="w-3.5 h-3.5 text-[#E8B84A]" />
          <span>FREQUENTLY ASKED QUESTIONS</span>
        </div>
        <span className="font-mono text-[10px] text-neutral-500 uppercase tracking-widest">
          05 BRIEFINGS
        </span>
      </div>

      <div className="space-y-2">
        {SARRAF_FAQ_ITEMS.map((item, idx) => {
          const isOpen = openIndex === idx;
          const panelId = `${item.id}-panel`;
          const btnId = `${item.id}-button`;

          return (
            <div
              key={item.id}
              className="sarraf-glass overflow-hidden transition-colors"
            >
              <h3>
                <button
                  id={btnId}
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggleItem(idx)}
                  className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#FFD97A]"
                >
                  <span className="text-xs sm:text-sm font-medium text-white tracking-tight">
                    {item.question}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-[#FFD97A] shrink-0 transition-transform duration-300 ${
                      isOpen ? 'rotate-180' : 'rotate-0'
                    }`}
                  />
                </button>
              </h3>

              <div
                id={panelId}
                role="region"
                aria-labelledby={btnId}
                className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                  isOpen
                    ? 'grid-rows-[1fr] opacity-100'
                    : 'grid-rows-[0fr] opacity-0'
                }`}
              >
                <div className="overflow-hidden">
                  <p className="px-4 pb-3.5 pt-0.5 text-xs sm:text-[13px] text-neutral-300 leading-relaxed border-t border-white/5">
                    {item.answer}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FaqSection;
