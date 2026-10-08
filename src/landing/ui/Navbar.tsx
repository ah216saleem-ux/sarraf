import React from 'react';
import { useMarket } from '../../context/MarketContext';
import { TelegramButton } from '../../components/TelegramButton';

interface NavbarProps {
  onScrollTo: (sceneIndex: number) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onScrollTo }) => {
  const { openLoginModal, priceData } = useMarket();

  // Status mapping
  const isLive = priceData.status === 'LIVE';
  const isClosed = priceData.status === 'MARKET_CLOSED';
  const isStale = priceData.status === 'FEED_STALE';
  const isOffline = priceData.status === 'FEED_OFFLINE';

  const pillBorderClass = isLive
    ? 'border-[#E8B84A]/30 text-[#FFD97A] shadow-[0_0_15px_rgba(232,184,74,0.15)]'
    : isClosed
    ? 'border-amber-500/40 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.15)]'
    : isStale
    ? 'border-amber-600/50 text-amber-400'
    : 'border-rose-700/50 text-rose-300';

  const dotPingClass = isLive
    ? 'bg-emerald-400'
    : isClosed
    ? 'bg-amber-400'
    : isStale
    ? 'bg-amber-500'
    : 'bg-rose-500';

  const dotBaseClass = isLive
    ? 'bg-emerald-500'
    : isClosed
    ? 'bg-amber-500'
    : isStale
    ? 'bg-amber-500'
    : 'bg-rose-500';

  const statusLabel = isLive
    ? 'ALL SYSTEMS LIVE'
    : isClosed
    ? 'MARKET CLOSED'
    : isStale
    ? 'FEED STALE'
    : 'FEED OFFLINE';

  return (
    <header className="fixed top-0 left-0 right-0 z-40 px-3 sm:px-8 py-3.5 sm:py-4 transition-all duration-300 bg-gradient-to-b from-black/80 via-black/40 to-transparent backdrop-blur-[2px]">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        {/* Brand / Logo */}
        <div
          onClick={() => onScrollTo(0)}
          className="cursor-pointer flex items-center gap-2 group shrink-0"
        >
          <div className="w-2.5 h-2.5 bg-gradient-to-tr from-[#B88628] to-[#FFD97A] rotate-45 shadow-[0_0_10px_#E8B84A] transition-transform duration-300 group-hover:rotate-90" />
          <span className="font-mono text-sm sm:text-base tracking-[0.25em] font-bold text-white group-hover:text-[#FFD97A] transition-colors">
            SARRAF
          </span>
          <span className="hidden md:inline-block font-mono text-[9px] tracking-widest text-[#E8B84A]/70 px-1.5 py-0.5 border border-[#E8B84A]/25 rounded">
            XAU/USD
          </span>
        </div>

        {/* Center Navigation Links */}
        <nav className="hidden lg:flex items-center gap-7 text-xs font-mono tracking-wider text-neutral-400">
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

        {/* Right Controls: Telegram Button + Status Pill + Login */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Telegram Button in Navbar */}
          <TelegramButton variant="nav" label="Telegram Bot" />

          {/* Unified Glass status pill (A1 requirement) */}
          <div
            className={`inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border text-[10px] sm:text-[11px] font-mono tracking-wider shrink-0 ${pillBorderClass}`}
            title={`SARRAF Status: ${statusLabel}`}
          >
            <span className="relative flex h-2 w-2">
              {isLive && (
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotPingClass}`}
                />
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${dotBaseClass}`}
              />
            </span>
            <span className="hidden sm:inline font-medium">
              {statusLabel}
            </span>
            <span className="sm:hidden font-medium">
              {isLive ? 'LIVE' : isClosed ? 'CLOSED' : isStale ? 'STALE' : 'OFFLINE'}
            </span>
          </div>

          {/* Login button (glass pill, gold border) */}
          <button
            onClick={openLoginModal}
            className="group relative inline-flex items-center gap-1.5 sm:gap-2 px-3.5 sm:px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-[#E8B84A]/60 hover:border-[#FFD97A] text-[11px] sm:text-xs font-mono tracking-widest text-[#FFD97A] hover:text-white transition-all duration-300 shadow-[0_0_20px_rgba(232,184,74,0.15)] hover:shadow-[0_0_25px_rgba(232,184,74,0.35)] cursor-pointer overflow-hidden shrink-0"
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
