import React from 'react';
import { useMarket } from '../../context/MarketContext';
import { KeyRound, ArrowRight } from 'lucide-react';
import { TelegramButton } from '../../components/TelegramButton';

interface FinaleOverlayProps {
  opacity: number;
}

export const FinaleOverlay: React.FC<FinaleOverlayProps> = ({ opacity }) => {
  const { openLoginModal } = useMarket();

  if (opacity <= 0.01) return null;

  return (
    <div
      className="min-h-screen w-full flex flex-col justify-between px-4 sm:px-8 pt-20 sm:pt-24 pb-8 sm:pb-12 pointer-events-auto overflow-x-hidden transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{ opacity }}
    >
      {/* Centered Vault Unlocked Content with dark gradient backdrop for WCAG AA readability */}
      <div className="max-w-4xl mx-auto w-full text-center my-auto relative z-10 px-5 py-8 sm:py-12 rounded-3xl bg-black/80 backdrop-blur-md border border-[#E8B84A]/25 shadow-[0_0_80px_rgba(0,0,0,0.9)]">
        <div className="inline-flex items-center gap-2.5 text-xs font-mono tracking-[0.3em] text-[#FFD97A] uppercase mb-4">
          <KeyRound className="w-4 h-4 text-[#E8B84A]" />
          <span>SARRAF VAULT</span>
        </div>

        <h2 className="text-3xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white leading-[1.1] drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)]">
          The Vault is{' '}
          <span className="font-serif italic font-normal text-[#FFD97A] gold-glow-text">
            unlocked.
          </span>
        </h2>

        <p className="mt-4 text-sm sm:text-lg text-neutral-200 font-light max-w-xl mx-auto leading-relaxed drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
          Live XAU/USD price, disciplined trade signals delivered to Telegram, and automated news pauses.
        </p>

        {/* Dual CTA: Enter SARRAF + Open Telegram Bot */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4 w-full">
          <button
            onClick={openLoginModal}
            className="group relative w-full sm:w-auto px-8 sm:px-10 py-4 rounded-full bg-gradient-to-r from-[#B88628] via-[#E8B84A] to-[#FFD97A] text-black font-bold text-xs sm:text-sm font-mono tracking-[0.2em] uppercase hover:scale-105 active:scale-95 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] shadow-[0_0_50px_rgba(232,184,74,0.45)] cursor-pointer flex items-center justify-center gap-3 overflow-hidden"
          >
            <span className="relative z-10">Enter SARRAF</span>
            <ArrowRight className="w-4 h-4 relative z-10 group-hover:translate-x-1 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]" />
            <span className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]" />
          </button>

          <TelegramButton variant="hero" label="Open Telegram Bot" />
        </div>

        <div className="mt-4 text-xs font-mono text-neutral-400">
          Live XAU/USD Price · Telegram Bot Dispatch · One Signal At A Time
        </div>
      </div>

      {/* Footer: simple © 2026 SARRAF and the risk disclaimer. No fake company or locations. */}
      <footer className="max-w-6xl mx-auto w-full mt-10 pt-6 sm:pt-8 border-t border-white/10 text-[11px] font-mono text-neutral-400 space-y-4 relative z-10 bg-black/70 backdrop-blur-sm p-4 rounded-xl">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 text-neutral-300">
            <span className="font-bold text-white tracking-widest">SARRAF</span>
            <span>·</span>
            <span>© 2026 SARRAF</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <TelegramButton variant="footer" label="Open Telegram Bot" />
          </div>
        </div>

        <div className="pt-2 border-t border-white/5">
          <p className="text-[10px] sm:text-[11px] text-neutral-400 leading-relaxed text-center sm:text-left block w-full">
            <strong className="text-neutral-300">Risk Disclaimer:</strong> Trading spot gold (XAU/USD) involves significant financial risk and is not suitable for all investors. All signals, macro updates, and analytical zones are for informational and research purposes only and do not constitute financial or investment advice. Past performance is no guarantee of future returns.
          </p>
        </div>
      </footer>
    </div>
  );
};
