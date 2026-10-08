import React from 'react';
import { useMarket } from '../../context/MarketContext';
import { TelegramButton } from '../../components/TelegramButton';
import { formatReopenCountdown } from '../../lib/marketPriceUtils';
import { Clock } from 'lucide-react';

interface StickyPriceBarProps {
  progress: number;
}

export const StickyPriceBar: React.FC<StickyPriceBarProps> = ({ progress }) => {
  const { priceData } = useMarket();

  // Show after scrolling past the hero (progress > 0.15) and before the finale completes (progress < 0.92)
  const isVisible = progress > 0.15 && progress < 0.92;

  if (!isVisible) return null;

  const isLive = priceData.status === 'LIVE';
  const isClosed = priceData.status === 'MARKET_CLOSED';
  const isStale = priceData.status === 'FEED_STALE';
  const currentPrice = priceData.price ?? 4165.5;

  const reopenCountdown = formatReopenCountdown(priceData.nextOpenTime);

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[94%] max-w-xl animate-in fade-in slide-in-from-bottom-4 duration-300 pointer-events-auto">
      <div className="flex items-center justify-between gap-3 px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-full bg-[#0a0a0d]/90 backdrop-blur-xl border border-[#E8B84A]/30 shadow-[0_10px_35px_rgba(0,0,0,0.8),0_0_20px_rgba(232,184,74,0.15)]">
        {/* Left: Symbol & Price */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-bold text-white tracking-wider">
              XAU/USD
            </span>
            <span className="font-mono text-sm sm:text-base font-bold text-[#FFD97A]">
              ${currentPrice.toFixed(2)}
            </span>
          </div>

          {/* Status badge */}
          {isLive ? (
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-[9px] font-mono text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              <span className="hidden xs:inline">LIVE</span>
            </div>
          ) : isClosed ? (
            <div
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-950/60 border border-amber-500/40 text-[9px] font-mono text-amber-300"
              title={reopenCountdown}
            >
              <Clock className="w-2.5 h-2.5 text-amber-400" />
              <span className="hidden sm:inline">CLOSED ({reopenCountdown})</span>
              <span className="sm:hidden">CLOSED</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-950/60 border border-rose-500/40 text-[9px] font-mono text-rose-300">
              <span>{isStale ? 'STALE' : 'OFFLINE'}</span>
            </div>
          )}
        </div>

        {/* Right: Open Telegram Button */}
        <div className="shrink-0">
          <TelegramButton variant="stickyBar" label="Open Telegram Bot" />
        </div>
      </div>
    </div>
  );
};
