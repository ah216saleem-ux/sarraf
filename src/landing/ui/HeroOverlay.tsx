import React, { useMemo } from 'react';
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
  Shield,
  Activity,
  ChevronDown,
  Clock,
  AlertTriangle,
} from 'lucide-react';

interface HeroOverlayProps {
  opacity: number;
  onWatchLive: () => void;
}

export const HeroOverlay: React.FC<HeroOverlayProps> = ({ opacity, onWatchLive }) => {
  const { priceData, openLoginModal } = useMarket();

  // Unified status checks
  const isLive = priceData.status === 'LIVE';
  const isClosed = priceData.status === 'MARKET_CLOSED';
  const isStale = priceData.status === 'FEED_STALE';
  const isOffline = priceData.status === 'FEED_OFFLINE';

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

  return (
    <div
      className="min-h-screen w-full flex flex-col justify-between px-4 sm:px-8 pt-20 sm:pt-28 pb-6 sm:pb-12 transition-opacity duration-300 pointer-events-auto overflow-x-hidden"
      style={{ opacity }}
    >
      <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-12 items-center my-auto">
        {/* Left Column: Kinetic Editorial Headline & Action CTAs */}
        <div className="lg:col-span-7 flex flex-col items-start space-y-4 sm:space-y-6">
          {/* Eyebrow Label */}
          <div className="flex items-center gap-2.5 text-[11px] sm:text-xs font-mono tracking-[0.25em] text-[#FFD97A]/80 uppercase">
            <span className="w-5 sm:w-8 h-[1px] bg-[#E8B84A]" />
            <span>INSTITUTIONAL PRECISION ENGINE</span>
          </div>

          {/* Kinetic Headline: words rise from a mask line by line */}
          <div className="overflow-hidden">
            <h1 className="text-3xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white leading-[1.08]">
              <span className="inline-block transform animate-in slide-in-from-bottom-8 duration-700 ease-out">
                Gold, moving in
              </span>{' '}
              <br />
              <span className="font-serif italic font-normal text-[#FFD97A] gold-glow-text inline-block transform animate-in slide-in-from-bottom-12 duration-1000 delay-150 ease-out">
                real time.
              </span>
            </h1>
          </div>

          {/* Subtext */}
          <p className="text-sm sm:text-lg text-neutral-300 font-light max-w-xl leading-relaxed">
            Direct institutional order book feed for XAU/USD. Sub-millisecond tick aggregation, mathematical execution boundaries, and algorithmic macro clarity.
          </p>

          {/* Action Buttons: Enter SARRAF + Watch Live + Open Telegram */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 pt-2 w-full xs:w-auto">
            <button
              onClick={openLoginModal}
              className="w-full xs:w-auto px-6 sm:px-8 py-3.5 rounded-full bg-gradient-to-r from-[#B88628] via-[#E8B84A] to-[#FFD97A] text-black font-bold text-xs font-mono tracking-widest uppercase hover:brightness-110 active:scale-95 transition-all duration-300 shadow-[0_0_30px_rgba(232,184,74,0.35)] cursor-pointer text-center"
            >
              Enter SARRAF
            </button>

            {/* Telegram Button (Hero variant with QR code on desktop) */}
            <TelegramButton variant="hero" label="Open Telegram" />

            <button
              onClick={onWatchLive}
              className="w-full xs:w-auto px-5 sm:px-6 py-3.5 rounded-full bg-black/50 backdrop-blur-md border border-[#E8B84A]/30 hover:border-[#FFD97A] text-neutral-200 hover:text-[#FFD97A] text-xs font-mono tracking-widest uppercase transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Watch Live</span>
              <Activity className="w-3.5 h-3.5 text-[#E8B84A] animate-pulse" />
            </button>
          </div>

          {/* Institutional Trust markers */}
          <div className="pt-3 flex flex-wrap items-center gap-5 text-[11px] font-mono text-neutral-400">
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-[#E8B84A]" />
              <span>Zero Slippage Routing</span>
            </div>
            <span className="text-neutral-700 hidden sm:inline">/</span>
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-[#E8B84A]" />
              <span>Sub-40ms Telegram Relays</span>
            </div>
            <span className="text-neutral-700 hidden sm:inline">/</span>
            <div>
              <span className="text-neutral-400">Tier-1 Liquidity Depth</span>
            </div>
          </div>
        </div>

        {/* Right Column: Floating 3D Glass Hero Price Card */}
        <div className="lg:col-span-5 flex justify-center lg:justify-end w-full">
          <div className="w-full max-w-md glass-panel-glow rounded-2xl p-5 sm:p-7 relative overflow-hidden transition-all duration-300 hover:border-[#FFD97A]/50 bg-[#09090c]/85 border border-[#E8B84A]/25 backdrop-blur-xl">
            {/* Top metadata & Status Badge */}
            <div className="flex items-center justify-between border-b border-[#E8B84A]/15 pb-4">
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
            <div className="py-5 sm:py-6 flex flex-col items-start">
              <div className="w-full flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">
                  {isLive ? 'INSTITUTIONAL MID MARKET' : 'LAST KNOWN PRICE (DISPLAY ONLY)'}
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

              {/* Odometer Price Display: Never blank or OFFLINE, always shows price */}
              <HeroOdometer
                price={priceData.price ?? 4165.5}
                isLive={isLive}
                direction={priceData.direction}
                status={priceData.status}
              />

              {/* Timestamp & Reopen / Stale notice */}
              <div className="w-full mt-2 text-[10px] font-mono text-neutral-400 flex flex-wrap items-center justify-between gap-1">
                <span>Last tick: {tickTimeFormatted.combined}</span>
                {isClosed && priceData.nextOpenTime && (
                  <span className="text-[#FFD97A]/80 font-semibold">
                    Reopens {new Date(priceData.nextOpenTime).toUTCString().slice(0, 22)} UTC
                  </span>
                )}
              </div>

              {/* 24h Delta and Real M15 Sparkline */}
              <div className="mt-4 w-full flex items-end justify-between border-t border-white/5 pt-3">
                {priceChange ? (
                  <div className="flex flex-col">
                    <span className="text-[10px] font-mono text-neutral-500">TODAY'S CHANGE</span>
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

                {/* Real Server M15 Sparkline (Hides if unavailable) */}
                <HeroSparkline />
              </div>
            </div>

            {/* Bid / Ask & Spread Matrix */}
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[#E8B84A]/15 font-mono text-xs">
              <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 flex flex-col">
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
                  BID (SELL)
                </span>
                <span className="text-sm font-semibold text-neutral-200 mt-0.5">
                  {priceData.bid !== null ? `$${priceData.bid.toFixed(2)}` : '—'}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 flex flex-col">
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
                  ASK (BUY)
                </span>
                <span className="text-sm font-semibold text-neutral-200 mt-0.5">
                  {priceData.ask !== null ? `$${priceData.ask.toFixed(2)}` : '—'}
                </span>
              </div>
            </div>

            {/* High / Low 24h & Spread ticker */}
            <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-neutral-400 px-1">
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

      {/* Scroll indicator hint */}
      <div className="flex flex-col items-center justify-center text-center pt-8 pb-2">
        <span className="font-mono text-[10px] tracking-[0.3em] text-[#FFD97A]/60 uppercase mb-2">
          SCROLL TO EXPLORE SARRAF
        </span>
        <ChevronDown className="w-4 h-4 text-[#E8B84A] animate-bounce" />
      </div>
    </div>
  );
};
