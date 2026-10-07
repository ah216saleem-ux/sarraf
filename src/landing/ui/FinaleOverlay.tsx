import React from 'react';
import { useMarket } from '../../context/MarketContext';
import { KeyRound, ArrowRight } from 'lucide-react';

interface FinaleOverlayProps {
  opacity: number;
}

export const FinaleOverlay: React.FC<FinaleOverlayProps> = ({ opacity }) => {
  const { openLoginModal } = useMarket();

  if (opacity <= 0.01) return null;

  return (
    <div
      className="min-h-screen w-full flex flex-col justify-between px-4 sm:px-8 pt-24 pb-8 pointer-events-auto"
      style={{ opacity }}
    >
      <div className="max-w-4xl mx-auto w-full text-center my-auto space-y-8">
        <div className="inline-flex items-center gap-3 text-xs font-mono tracking-[0.3em] text-[#FFD97A] uppercase">
          <KeyRound className="w-4 h-4 text-[#E8B84A]" />
          <span>VAULT ACCESS PROTOCOL</span>
        </div>

        <h2 className="text-3xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white leading-tight">
          The Vault is{' '}
          <span className="font-serif italic font-normal text-[#FFD97A] gold-glow-text">
            unlocked.
          </span>
        </h2>

        <p className="text-sm sm:text-lg text-neutral-300 font-light max-w-xl mx-auto leading-relaxed">
          Step across the threshold. Live gold price telemetry, execution algorithms, and macro radar are synchronized and waiting.
        </p>

        {/* Big Magnetic CTA "Enter SARRAF" */}
        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4 w-full">
          <button
            onClick={openLoginModal}
            className="group relative w-full sm:w-auto px-7 sm:px-10 py-4 sm:py-5 rounded-full bg-gradient-to-r from-[#B88628] via-[#E8B84A] to-[#FFD97A] text-black font-bold text-xs sm:text-sm font-mono tracking-[0.2em] uppercase hover:scale-105 active:scale-95 transition-all duration-300 shadow-[0_0_50px_rgba(232,184,74,0.5)] cursor-pointer flex items-center justify-center gap-3 overflow-hidden"
          >
            <span className="relative z-10">Enter SARRAF</span>
            <ArrowRight className="w-4 h-4 relative z-10 group-hover:translate-x-1 transition-transform" />
            <span className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
          </button>
        </div>

        <div className="pt-2 text-xs font-mono text-neutral-500">
          Institutional Credentials Required · Immediate Access Available
        </div>
      </div>

      {/* Footer with small risk disclaimer */}
      <footer className="max-w-6xl mx-auto w-full pt-12 border-t border-white/5 text-[11px] font-mono text-neutral-500 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2 text-neutral-400">
            <span className="font-bold text-white tracking-widest">SARRAF</span>
            <span>© 2026 SARRAF INSTITUTIONAL CORP. ALL RIGHTS RESERVED.</span>
          </div>
          <div className="flex items-center gap-6">
            <span className="text-[#E8B84A]/80">LONDON · NEW YORK · DUBAI · ZURICH</span>
          </div>
        </div>

        <p className="text-[10px] text-neutral-600 leading-normal text-center sm:text-left">
          <strong>Risk Disclaimer:</strong> Trading involves risk. Signals are not financial advice. Past results do not guarantee future results.
        </p>
      </footer>
    </div>
  );
};
