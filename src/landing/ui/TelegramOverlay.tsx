import React, { useState, useEffect } from 'react';
import { Send, CheckCircle2 } from 'lucide-react';
import { TelegramButton } from '../../components/TelegramButton';
import { FaqAccordion } from './FaqAccordion';

interface TelegramOverlayProps {
  opacity: number;
}

export const TelegramOverlay: React.FC<TelegramOverlayProps> = ({ opacity }) => {
  const [typedIndex, setTypedIndex] = useState(0);
  const [showOutcome, setShowOutcome] = useState(false);

  // Exact honest SARRAF Telegram execution message format
  const signalText = `⚡ SARRAF XAU/USD SIGNAL
SYMBOL: XAU/USD (Spot Gold)
DIRECTION: BUY / LONG
ENTRY ZONE: $4,165.20 - $4,167.00
STOP LOSS: $4,153.00

TARGET 1: $4,175.00
TARGET 2: $4,184.00
TARGET 3: $4,196.00
TARGET 4: $4,212.00

STATUS: One Signal Active · Cooldown On Close`;

  useEffect(() => {
    if (opacity < 0.2) {
      setTypedIndex(0);
      setShowOutcome(false);
      return;
    }

    const interval = setInterval(() => {
      setTypedIndex((prev) => {
        if (prev < signalText.length) {
          return prev + 4;
        } else {
          setShowOutcome(true);
          return prev;
        }
      });
    }, 20);

    return () => clearInterval(interval);
  }, [opacity, signalText.length]);

  if (opacity <= 0.01) return null;

  return (
    <div
      className="min-h-screen w-full flex flex-col justify-center px-4 sm:px-8 py-16 pointer-events-auto overflow-x-hidden transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{ opacity }}
    >
      <div className="max-w-6xl mx-auto w-full my-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-12 items-center">
          {/* Left column: Editorial message */}
          <div className="lg:col-span-6 space-y-4 sm:space-y-6">
            <div className="flex items-center gap-3 text-xs font-mono tracking-[0.25em] text-[#FFD97A]/80 uppercase">
              <Send className="w-4 h-4 text-[#E8B84A]" />
              <span>TELEGRAM NOTIFICATIONS</span>
            </div>

            <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
              Direct to Telegram.{' '}
              <span className="font-serif italic text-[#FFD97A] gold-glow-text">
                Zero friction.
              </span>
            </h2>

            <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
              Every signal arrives directly on your phone via the SARRAF Telegram bot. Clean parameters, clear targets, and automatic progress updates.
            </p>

            <div className="space-y-3 font-mono text-xs text-neutral-300 pt-1">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Signals delivered to Telegram bot</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>One signal at a time with clear Entry, SL and TP levels</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>TP / SL updates and cooldown between setups</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Pauses around high-impact news</span>
              </div>
            </div>

            {/* ONE clear primary CTA: Open Telegram Bot */}
            <div className="pt-3">
              <TelegramButton variant="hero" label="Open Telegram Bot" />
            </div>
          </div>

          {/* Right column: Realistic glass telegram message window with Sample Signal & Outcome */}
          <div className="lg:col-span-6 flex justify-center lg:justify-end w-full">
            <div className="w-full max-w-md rounded-2xl p-5 border border-[#E8B84A]/30 bg-[#09090d]/90 backdrop-blur-xl shadow-[0_0_30px_rgba(0,0,0,0.8)]">
              {/* Window header */}
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#B88628] to-[#FFD97A] flex items-center justify-center font-bold text-xs text-black shadow-[0_0_10px_#E8B84A]">
                    S
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-mono font-bold text-white tracking-wider">
                        SARRAF BOT
                      </h4>
                      <span className="text-[9px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded bg-[#E8B84A]/20 text-[#FFD97A] border border-[#E8B84A]/35">
                        SAMPLE
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      BOT ONLINE
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-neutral-400">NOW</span>
              </div>

              {/* Signal message display with line-by-line typing */}
              <div className="mt-4 p-4 rounded-xl bg-black/70 border border-white/5 font-mono text-xs text-neutral-200 leading-relaxed whitespace-pre-wrap min-h-[190px]">
                {signalText.slice(0, typedIndex)}
                {typedIndex < signalText.length && (
                  <span className="inline-block w-2 h-4 bg-[#FFD97A] ml-0.5 animate-pulse" />
                )}
              </div>

              {/* Sample Outcome Message Pop-in */}
              {showOutcome && (
                <div className="mt-3 p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 font-mono text-xs animate-in fade-in slide-in-from-top-2 duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]">
                  <div className="flex items-center justify-between text-emerald-300 font-bold mb-1">
                    <div className="flex items-center gap-1.5">
                      <span>🎯 TARGET 1 HIT</span>
                      <span className="text-[9px] px-1 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-normal">
                        SAMPLE UPDATE
                      </span>
                    </div>
                    <span className="text-[10px] text-emerald-400/80">JUST NOW</span>
                  </div>
                  <div className="text-neutral-300 text-[11px] leading-relaxed">
                    XAU/USD hit $4,175.00 (+100 pips). Stop Loss moved to Entry Zone.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="mt-8 border-t border-white/5 pt-8">
          <FaqAccordion />
        </div>
      </div>
    </div>
  );
};
