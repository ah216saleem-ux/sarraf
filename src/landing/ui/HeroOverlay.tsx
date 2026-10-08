import React, { useMemo, useState, useRef } from 'react';
import { useMarket } from '../../context/MarketContext';
import { HeroOdometer } from './HeroOdometer';
import { HeroSparkline } from './HeroSparkline';
import { TelegramButton } from '../../components/TelegramButton';
import {
  formatReopenCountdown,
  formatLastTickTime,
  formatQuoteAge,
} from '../../lib/marketPriceUtils';
import {
  TrendingUp,
  TrendingDown,
  Clock,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react';

interface HeroOverlayProps {
  opacity: number;
  onWatchLive?: () => void;
}

export const HeroOverlay: React.FC<HeroOverlayProps> = ({ opacity }) => {
  const { priceData, openLoginModal } = useMarket();

  // Unified status checks
  const isLive = priceData.status === 'LIVE';
  const isClosed = priceData.status === 'MARKET_CLOSED';
  const isStale = priceData.status === 'FEED_STALE';
  const isOffline = priceData.status === 'FEED_OFFLINE';

  // 3D Card Gentle Tilt State
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rx = -((y - centerY) / centerY) * 6; // max 6 deg
    const ry = ((x - centerX) / centerX) * 6;
    setTilt({ rx, ry });
  };

  const handleMouseLeave = () => {
    setTilt({ rx: 0, ry: 0 });
  };

  const reopenCountdown = useMemo(() => {
    return formatReopenCountdown(priceData.nextOpenTime);
  }, [priceData.nextOpenTime]);

  const tickTimeFormatted = useMemo(() => {
    return formatLastTickTime(priceData.lastTickTimeString || priceData.timestamp);
  }, [priceData.lastTickTimeString, priceData.timestamp]);

  const quoteAgeFormatted = useMemo(() => {
    return formatQuoteAge(priceData.quoteAgeSeconds);
  }, [priceData.quoteAgeSeconds]);

  // Today's change vs previous close (if available)
  const priceChange = useMemo(() => {
    if (priceData.previousClose && priceData.price) {
      const diff = priceData.price - priceData.previousClose;
      const pct = (diff / priceData.previousClose) * 100;
      return { diff: Number(diff.toFixed(2)), pct: Number(pct.toFixed(2)) };
    }
    if (typeof priceData.changePercent24h === 'number') {
      return {
        diff: priceData.change24h ?? 0,
        pct: priceData.changePercent24h,
      };
    }
    return null;
  }, [priceData.price, priceData.previousClose, priceData.change24h, priceData.changePercent24h]);

  if (opacity <= 0.01) return null;

  // Shrink card into sticky mini bar as user scrolls away
  const cardScale = Math.max(0.85, opacity);
  const cardTranslateY = (1 - opacity) * 40;

  return (
    <div
      className="min-h-screen w-full flex flex-col justify-between px-3 xs:px-4 sm:px-8 pt-16 sm:pt-24 pb-4 sm:pb-8 transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] pointer-events-auto overflow-x-hidden"
      style={{ opacity }}
    >
      <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-10 items-center my-auto py-2">
        {/* Left Column: Kinetic Split-Text Headline & Action CTAs */}
        <div className="lg:col-span-7 flex flex-col items-start space-y-3 sm:space-y-5">
          {/* Kinetic Headline: words rise with layered depth */}
          <div className="overflow-hidden">
            <h1 className="text-3xl xs:text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white leading-[1.08]">
              <span className="inline-block transform animate-in slide-in-from-bottom-8 duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]">
                Gold, moving in
              </span>{' '}
              <br />
              <span className="font-serif italic font-normal text-[#FFD97A] gold-glow-text inline-block transform animate-in slide-in-from-bottom-12 duration-900 delay-100 ease-[cubic-bezier(0.22,1,0.36,1)]">
                real time.
              </span>
            </h1>
          </div>

          {/* Honest Subline */}
          <p className="text-xs xs:text-sm sm:text-base text-neutral-300 font-light max-w-lg leading-relaxed">
            Live XAU/USD price tracking and disciplined trade signals delivered directly to Telegram.
          </p>

          {/* Action Buttons: Enter SARRAF + Open Telegram Bot */}
          <div className="flex flex-row flex-wrap items-center gap-2.5 sm:gap-4 pt-1 sm:pt-2 w-full xs:w-auto">
            <button
              onClick={openLoginModal}
              className="flex-1 xs:flex-none px-5 sm:px-8 py-3 sm:py-3.5 rounded-full bg-gradient-to-r from-[#B88628] via-[#E8B84A] to-[#FFD97A] text-black font-bold text-xs font-mono tracking-widest uppercase hover:brightness-110 active:scale-95 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] shadow-[0_0_25px_rgba(232,184,74,0.35)] cursor-pointer text-center"
            >
              Enter SARRAF
            </button>

            <TelegramButton
              variant="hero"
              label="Open Telegram Bot"
              className="flex-1 xs:flex-none"
            />
          </div>
        </div>

        {/* Right Column: Floating 3D Glass Hero Price Card */}
        <div className="lg:col-span-5 flex justify-center lg:justify-end w-full">
          <div
            ref={cardRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="w-full max-w-sm sm:max-w-md rounded-2xl p-4 sm:p-6 relative overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] bg-[#09090c]/90 border border-[#E8B84A]/30 backdrop-blur-xl shadow-[0_15px_40px_rgba(0,0,0,0.85)] will-change-transform group"
            style={{
              transform: `perspective(1000px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) scale(${cardScale}) translate3d(0, ${cardTranslateY}px, 0)`,
            }}
          >
            {/* Moving light sweep highlight effect */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
              <div className="absolute -inset-full bg-gradient-to-r from-transparent via-white/5 to-transparent rotate-45 transform translate-x-[-150%] group-hover:translate-x-[250%] transition-transform duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)]" />
            </div>

            {/* Top metadata & Status Badge */}
            <div className="flex items-center justify-between border-b border-[#E8B84A]/15 pb-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold tracking-widest text-[#FFD97A]">
                  XAU/USD
                </span>
                <span className="text-[10px] font-mono text-neutral-400 px-1.5 py-0.5 rounded bg-white/5 border border-white/10">
                  SPOT GOLD
                </span>
              </div>

              {/* Status Badge */}
              {isLive ? (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-[10px] font-mono text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.25)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  <span className="font-semibold tracking-wider">LIVE FEED</span>
                </div>
              ) : isClosed ? (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-950/60 border border-amber-500/40 text-[10px] font-mono text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.25)]">
                  <Clock className="w-3 h-3 text-amber-400" />
                  <span className="font-semibold tracking-wider">MARKET CLOSED</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-950/60 border border-rose-500/40 text-[10px] font-mono text-rose-300">
                  <AlertTriangle className="w-3 h-3 text-rose-400" />
                  <span className="font-semibold tracking-wider">
                    {isStale ? 'FEED STALE' : 'FEED OFFLINE'}
                  </span>
                </div>
              )}
            </div>

            {/* Price section with Odometer */}
            <div className="py-3 sm:py-5 flex flex-col items-start">
              <div className="w-full flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">
                  {isLive ? 'LIVE XAU/USD PRICE' : 'LAST KNOWN PRICE'}
                </span>

                {/* Status-specific helper readout */}
                {isClosed && (
                  <span className="text-[10px] font-mono font-medium text-amber-400">
                    {reopenCountdown}
                  </span>
                )}
                {(isStale || isOffline) && (
                  <span className="text-[10px] font-mono text-amber-300">
                    {quoteAgeFormatted}
                  </span>
                )}
              </div>

              {/* Odometer Price Display */}
              <HeroOdometer
                price={priceData.price ?? 4165.5}
                isLive={isLive}
                direction={priceData.direction}
                status={priceData.status}
              />

              {/* Timestamp & Reopen / Stale notice */}
              <div className="w-full mt-1.5 text-[9px] sm:text-[10px] font-mono text-neutral-400 flex flex-wrap items-center justify-between gap-1">
                <span>Last tick: {tickTimeFormatted.combined}</span>
                {isClosed && priceData.nextOpenTime && (
                  <span className="text-[#FFD97A]/80 font-semibold">
                    Reopens {new Date(priceData.nextOpenTime).toUTCString().slice(0, 22)} UTC
                  </span>
                )}
              </div>

              {/* Today's Change and Sparkline */}
              <div className="mt-3 w-full flex items-end justify-between border-t border-white/5 pt-2.5">
                {priceChange ? (
                  <div className="flex flex-col">
                    <span className="text-[9px] font-mono text-neutral-500">TODAY'S CHANGE</span>
                    <div
                      className={`flex items-center gap-1 text-xs font-mono font-bold mt-0.5 ${
                        priceChange.diff >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {priceChange.diff >= 0 ? (
                        <TrendingUp className="w-3.5 h-3.5" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {priceChange.diff >= 0 ? '+' : ''}
                        {priceChange.diff.toFixed(2)} ({priceChange.pct.toFixed(2)}%)
                      </span>
                    </div>
                  </div>
                ) : (
                  <div />
                )}

                <HeroSparkline />
              </div>
            </div>

            {/* Bid / Ask & Spread Matrix */}
            <div className="grid grid-cols-2 gap-2.5 pt-2.5 border-t border-[#E8B84A]/15 font-mono text-xs">
              <div className="p-2 sm:p-2.5 rounded-lg bg-black/40 border border-white/5 flex flex-col">
                <span className="text-[9px] text-neutral-500 uppercase tracking-wider">
                  BID (SELL)
                </span>
                <span className="text-xs sm:text-sm font-semibold text-neutral-200 mt-0.5">
                  {priceData.bid !== null ? `$${priceData.bid.toFixed(2)}` : '—'}
                </span>
              </div>
              <div className="p-2 sm:p-2.5 rounded-lg bg-black/40 border border-white/5 flex flex-col">
                <span className="text-[9px] text-neutral-500 uppercase tracking-wider">
                  ASK (BUY)
                </span>
                <span className="text-xs sm:text-sm font-semibold text-neutral-200 mt-0.5">
                  {priceData.ask !== null ? `$${priceData.ask.toFixed(2)}` : '—'}
                </span>
              </div>
            </div>

            {/* High / Low 24h & Spread ticker */}
            <div className="mt-2.5 flex items-center justify-between text-[9px] sm:text-[10px] font-mono text-neutral-400 px-1">
              <span>
                {priceData.low24h !== null ? `24H L: $${priceData.low24h.toFixed(2)}` : ''}
              </span>
              <span>
                {priceData.spread !== null ? `SPREAD: ${priceData.spread.toFixed(2)}` : ''}
              </span>
              <span>
                {priceData.high24h !== null ? `24H H: $${priceData.high24h.toFixed(2)}` : ''}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Subtle Scroll indicator hint */}
      <div className="flex flex-col items-center justify-center text-center pt-2 sm:pt-4 pb-1">
        <span className="font-mono text-[9px] tracking-[0.3em] text-[#FFD97A]/60 uppercase mb-1">
          SCROLL TO EXPLORE SARRAF
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-[#E8B84A] animate-bounce" />
      </div>
    </div>
  );
};
