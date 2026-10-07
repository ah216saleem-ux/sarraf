import React from 'react';
import { useMarket } from '../../context/MarketContext';

interface NavbarProps {
  onScrollTo: (sceneIndex: number) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onScrollTo }) => {
  const { openLoginModal, priceData } = useMarket();

  return (
    <header className="fixed top-0 left-0 right-0 z-40 px-4 sm:px-8 py-4 transition-all duration-300">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand / Logo */}
        <div
          onClick={() => onScrollTo(0)}
          className="cursor-pointer flex items-center gap-2.5 group"
        >
          <div className="w-2.5 h-2.5 bg-gradient-to-tr from-[#B88628] to-[#FFD97A] rotate-45 shadow-[0_0_10px_#E8B84A] transition-transform duration-300 group-hover:rotate-90" />
          <span className="font-mono text-base tracking-[0.25em] font-bold text-white group-hover:text-[#FFD97A] transition-colors">
            SARRAF
          </span>
          <span className="hidden sm:inline-block font-mono text-[10px] tracking-widest text-[#E8B84A]/60 px-1.5 py-0.5 border border-[#E8B84A]/20 rounded">
            INSTITUTIONAL
          </span>
        </div>

        {/* Center Navigation Links & Live Status Pill */}
        <div className="flex items-center gap-4 sm:gap-8">
          <nav className="hidden md:flex items-center gap-7 text-xs font-mono tracking-wider text-neutral-400">
            <button
              onClick={() => onScrollTo(1)}
              className="hover:text-[#FFD97A] transition-colors cursor-pointer py-1"
            >
              LIVE
            </button>
            <button
              onClick={() => onScrollTo(2)}
              className="hover:text-[#FFD97A] transition-colors cursor-pointer py-1"
            >
              PRECISION
            </button>
            <button
              onClick={() => onScrollTo(3)}
              className="hover:text-[#FFD97A] transition-colors cursor-pointer py-1"
            >
              NEWS
            </button>
            <button
              onClick={() => onScrollTo(4)}
              className="hover:text-[#FFD97A] transition-colors cursor-pointer py-1"
            >
              TELEGRAM
            </button>
          </nav>

          {/* Glass status pill */}
          <div
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/40 backdrop-blur-md border text-[10px] sm:text-[11px] font-mono tracking-wider shadow-[0_0_15px_rgba(232,184,74,0.12)] ${
              priceData.status === 'LIVE'
                ? 'border-[#E8B84A]/25 text-[#FFD97A]'
                : priceData.status === 'STALE'
                ? 'border-amber-500/40 text-amber-300'
                : 'border-neutral-700 text-neutral-400'
            }`}
          >
            <span className="relative flex h-2 w-2">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  priceData.status === 'LIVE'
                    ? 'bg-emerald-400'
                    : priceData.status === 'STALE'
                    ? 'bg-amber-400'
                    : 'bg-neutral-500'
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  priceData.status === 'LIVE'
                    ? 'bg-emerald-500'
                    : priceData.status === 'STALE'
                    ? 'bg-amber-500'
                    : 'bg-neutral-500'
                }`}
              />
            </span>
            <span className="hidden xs:inline">
              {priceData.status === 'LIVE'
                ? 'ALL SYSTEMS LIVE'
                : priceData.status === 'STALE'
                ? 'FEED STALE'
                : 'FEED OFFLINE'}
            </span>
            <span className="xs:hidden">
              {priceData.status}
            </span>
          </div>

          {/* Login button (glass pill, gold border) */}
          <button
            onClick={openLoginModal}
            className="group relative inline-flex items-center gap-2 px-4 sm:px-5 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-[#E8B84A]/60 hover:border-[#FFD97A] text-xs font-mono tracking-widest text-[#FFD97A] hover:text-white transition-all duration-300 shadow-[0_0_20px_rgba(232,184,74,0.15)] hover:shadow-[0_0_25px_rgba(232,184,74,0.35)] cursor-pointer overflow-hidden"
          >
            <span className="relative z-10 font-medium">LOGIN</span>
            <span className="relative z-10 text-[10px] text-[#E8B84A] group-hover:translate-x-0.5 transition-transform">
              →
            </span>
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-[#E8B84A]/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
          </button>
        </div>
      </div>
    </header>
  );
};
