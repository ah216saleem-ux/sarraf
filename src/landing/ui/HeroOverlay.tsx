import React, { useEffect, useState } from 'react';
import { useMarket } from '../../context/MarketContext';
import { TrendingUp, TrendingDown, Shield, Activity, ChevronDown } from 'lucide-react';

interface HeroOverlayProps {
  opacity: number;
  onWatchLive: () => void;
}

export const HeroOverlay: React.FC<HeroOverlayProps> = ({ opacity, onWatchLive }) => {
  const { priceData, openLoginModal } = useMarket();
  const [flashColor, setFlashColor] = useState<'emerald' | 'rose' | null>(null);

  useEffect(() => {
    if (priceData.direction === 'up') {
      setFlashColor('emerald');
    } else if (priceData.direction === 'down') {
      setFlashColor('rose');
    }
    const timer = setTimeout(() => setFlashColor(null), 450);
    return () => clearTimeout(timer);
  }, [priceData.tickPulse, priceData.direction]);

  if (opacity <= 0.01) return null;

  return (
    <div
      className="min-h-screen w-full flex flex-col justify-between px-4 sm:px-8 pt-20 sm:pt-28 pb-6 sm:pb-12 transition-opacity duration-300 pointer-events-auto overflow-x-hidden"
      style={{ opacity }}
    >
      <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-10 items-center my-auto">
        {/* Left Column: Big Editorial Typography & CTA */}
        <div className="lg:col-span-7 flex flex-col items-start space-y-4 sm:space-y-6">
          {/* Eyebrow Label */}
          <div className="flex items-center gap-2.5 text-[11px] sm:text-xs font-mono tracking-[0.2em] sm:tracking-[0.25em] text-[#FFD97A]/80 uppercase">
            <span className="w-4 sm:w-6 h-[1px] bg-[#E8B84A]" />
            <span>INSTITUTIONAL PRECISION ENGINE</span>
          </div>

          {/* Headline with ONE italic serif accent word in gold */}
          <h1 className="text-3xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white leading-[1.1]">
            Gold, moving in{' '}
            <span className="font-serif italic font-normal text-[#FFD97A] gold-glow-text">
              real time.
            </span>
          </h1>

          {/* Subtext */}
          <p className="text-sm sm:text-lg text-neutral-400 font-light max-w-xl leading-relaxed">
            Direct institutional order book feed for XAU/USD. Sub-millisecond tick aggregation, mathematical execution boundaries, and algorithmic macro clarity.
          </p>

          {/* Action Buttons: "Login" & "Watch Live" */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 pt-1 sm:pt-2 w-full xs:w-auto">
            <button
              onClick={openLoginModal}
              className="w-full xs:w-auto px-6 sm:px-7 py-3 sm:py-3.5 rounded-full bg-gradient-to-r from-[#B88628] via-[#E8B84A] to-[#FFD97A] text-black font-semibold text-xs font-mono tracking-widest uppercase hover:brightness-110 transition-all duration-300 shadow-[0_0_30px_rgba(232,184,74,0.35)] cursor-pointer active:scale-95 text-center"
            >
              Enter SARRAF
            </button>

            <button
              onClick={onWatchLive}
              className="w-full xs:w-auto px-6 sm:px-7 py-3 sm:py-3.5 rounded-full bg-black/40 backdrop-blur-md border border-[#E8B84A]/30 hover:border-[#FFD97A] text-white hover:text-[#FFD97A] text-xs font-mono tracking-widest uppercase transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Watch Live</span>
              <Activity className="w-3.5 h-3.5 text-[#E8B84A] animate-pulse" />
            </button>
          </div>

          {/* Institutional Trust markers (unboxed clean typography) */}
          <div className="pt-4 flex flex-wrap items-center gap-6 text-[11px] font-mono text-neutral-400">
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-[#E8B84A]" />
              <span>Zero Slippage Routing</span>
            </div>
            <span className="text-neutral-700">/</span>
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-[#E8B84A]" />
              <span>Sub-40ms Telegram Relays</span>
            </div>
            <span className="text-neutral-700">/</span>
            <div className="text-neutral-400">
              <span>Tier-1 Liquidity Depth</span>
            </div>
          </div>
        </div>

        {/* Right Column: Floating 3D Glass Live Price Panel */}
        <div className="lg:col-span-5 flex justify-center lg:justify-end w-full">
          <div className="w-full max-w-md glass-panel-glow rounded-2xl p-5 sm:p-7 relative overflow-hidden transition-all duration-300 hover:border-[#FFD97A]/50">
            {/* Top metadata */}
            <div className="flex items-center justify-between border-b border-[#E8B84A]/15 pb-4">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold tracking-widest text-[#FFD97A]">
                  XAU/USD
                </span>
                <span className="text-[10px] font-mono text-neutral-400 px-1.5 py-0.5 rounded bg-white/5 border border-white/10">
                  SPOT GOLD
                </span>
              </div>
              <div
                className={`flex items-center gap-1.5 text-[10px] font-mono ${
                  priceData.status === 'LIVE'
                    ? 'text-emerald-400'
                    : priceData.status === 'STALE'
                    ? 'text-amber-400'
                    : 'text-neutral-400'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    priceData.status === 'LIVE'
                      ? 'bg-emerald-400 animate-pulse'
                      : priceData.status === 'STALE'
                      ? 'bg-amber-400'
                      : 'bg-neutral-500'
                  }`}
                />
                <span>
                  {priceData.status === 'LIVE'
                    ? 'BIQUOTE.IO LIVE'
                    : priceData.status === 'STALE'
                    ? 'FEED STALE (>5s)'
                    : 'FEED OFFLINE'}
                </span>
              </div>
            </div>

            {/* Live ticking price counter */}
            <div className="py-5 sm:py-6 flex flex-col items-start">
              <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 mb-1">
                INSTITUTIONAL MID MARKET
              </span>

              {(priceData.status === 'LIVE' || priceData.status === 'STALE') && priceData.price !== null ? (
                <>
                  <div
                    className={`flex items-baseline gap-2 transition-colors duration-200 ${
                      flashColor === 'emerald'
                        ? 'text-emerald-300 drop-shadow-[0_0_12px_rgba(52,211,153,0.8)]'
                        : flashColor === 'rose'
                        ? 'text-rose-300 drop-shadow-[0_0_12px_rgba(244,63,94,0.8)]'
                        : 'text-white'
                    }`}
                  >
                    <span className="text-2xl font-mono text-[#E8B84A]">$</span>
                    <span className="text-3xl sm:text-5xl font-mono font-bold tracking-tight">
                      {priceData.price.toFixed(2)}
                    </span>
                    <span className="text-xs font-mono text-neutral-400">USD</span>
                    {priceData.status === 'STALE' && (
                      <span className="ml-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        STALE
                      </span>
                    )}
                  </div>

                  {/* 24h Delta */}
                  <div className="mt-3 flex items-center gap-3 text-xs font-mono">
                    <div
                      className={`flex items-center gap-1 px-2 py-0.5 rounded ${
                        (priceData.change24h ?? 0) >= 0
                          ? 'text-emerald-400 bg-emerald-950/40 border border-emerald-800/40'
                          : 'text-rose-400 bg-rose-950/40 border border-rose-800/40'
                      }`}
                    >
                      {(priceData.change24h ?? 0) >= 0 ? (
                        <TrendingUp className="w-3.5 h-3.5" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {(priceData.change24h ?? 0) >= 0 ? '+' : ''}
                        {(priceData.change24h ?? 0).toFixed(2)} ({priceData.changePercent24h ?? 0}%)
                      </span>
                    </div>
                    <span className="text-neutral-500 text-[11px]">24H RANGE</span>
                  </div>
                </>
              ) : (
                <div className="py-2">
                  <div className="text-2xl sm:text-4xl font-mono font-bold tracking-wider text-neutral-400">
                    OFFLINE
                  </div>
                  <span className="text-[11px] font-mono text-neutral-400 mt-1 block">
                    Connecting to biquote.io COMEX feed...
                  </span>
                </div>
              )}
            </div>

            {/* Bid / Ask & Market Depth Matrix */}
            <div className="grid grid-cols-2 gap-3 pt-4 border-t border-[#E8B84A]/15 font-mono text-xs">
              <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 flex flex-col">
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
                  BID (SELL)
                </span>
                <span className="text-sm font-semibold text-neutral-200 mt-0.5">
                  {priceData.bid !== null ? `$${priceData.bid.toFixed(2)}` : 'OFFLINE'}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 flex flex-col">
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
                  ASK (BUY)
                </span>
                <span className="text-sm font-semibold text-neutral-200 mt-0.5">
                  {priceData.ask !== null ? `$${priceData.ask.toFixed(2)}` : 'OFFLINE'}
                </span>
              </div>
            </div>

            {/* High / Low 24h ticker */}
            <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-neutral-400 px-1">
              <span>24H L: {priceData.low24h !== null ? `$${priceData.low24h.toFixed(2)}` : '—'}</span>
              <span>SPREAD: {priceData.spread !== null ? `${priceData.spread.toFixed(2)}` : '—'}</span>
              <span>24H H: {priceData.high24h !== null ? `$${priceData.high24h.toFixed(2)}` : '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll indicator hint */}
      <div className="flex flex-col items-center justify-center text-center pt-8 pb-2">
        <span className="font-mono text-[10px] tracking-[0.3em] text-[#FFD97A]/60 uppercase mb-2">
          SCROLL TO ENTER VAULT
        </span>
        <ChevronDown className="w-4 h-4 text-[#E8B84A] animate-bounce" />
      </div>
    </div>
  );
};
