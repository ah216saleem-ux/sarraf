import React from 'react';
import { SpyFeedState } from '../types';
import { Clock, ShieldCheck, Activity, RefreshCw, AlertCircle } from 'lucide-react';

interface SpyTopBarProps {
  feed: SpyFeedState;
  priceFlash: 'UP' | 'DOWN' | null;
}

export const SpyTopBar: React.FC<SpyTopBarProps> = ({ feed, priceFlash }) => {
  const { currentPrice, previousClose, changeDollar, changePercent, lastQuote, marketHours, isFresh, status } = feed;

  // Compute change if not direct
  const computedChange =
    changeDollar !== null
      ? changeDollar
      : currentPrice !== null && previousClose !== null
      ? currentPrice - previousClose
      : 0;

  const computedChangePct =
    changePercent !== null
      ? changePercent
      : previousClose && previousClose > 0 && computedChange
      ? (computedChange / previousClose) * 100
      : 0;

  const isPositive = computedChange >= 0;

  return (
    <header className="glass-panel p-4 rounded-2xl border border-white/10 bg-black/60 shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Left: Symbol & Market Badge */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#E8B84A]/20 via-[#c9a24a]/10 to-transparent border border-[#E8B84A]/30 flex items-center justify-center shadow-[0_0_12px_rgba(232,184,74,0.15)]">
            <span className="font-mono font-black text-sm text-[#E8B84A]">SPY</span>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-base font-bold text-white tracking-wider">
                SPDR S&P 500 ETF TRUST
              </h1>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-neutral-300">
                NYSE ARCA
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono text-neutral-400">
              <span>FEED: {feed.source === 'ALPACA_IEX' ? 'ALPACA IEX LIVE' : feed.source === 'TWELVEDATA' ? 'TWELVE DATA' : 'STORED DISK CACHE'}</span>
              <span>•</span>
              <span className="text-neutral-500">{marketHours.currentTimeET || 'ET TIME'}</span>
            </div>
          </div>
        </div>

        {/* Center: Live Price & Quote Spread */}
        <div className="flex items-center gap-6">
          {/* Price display */}
          <div className="text-right">
            <div className="flex items-baseline justify-end gap-2">
              <span className="text-[11px] font-mono text-neutral-400">LAST</span>
              <span
                className={`font-mono text-2xl sm:text-3xl font-extrabold tracking-tight transition-colors duration-300 ${
                  priceFlash === 'UP'
                    ? 'text-[#22e08a] drop-shadow-[0_0_8px_rgba(34,224,138,0.5)]'
                    : priceFlash === 'DOWN'
                    ? 'text-[#ff3b6b] drop-shadow-[0_0_8px_rgba(255,59,107,0.5)]'
                    : 'text-white'
                }`}
              >
                {currentPrice !== null ? `$${currentPrice.toFixed(2)}` : 'N/A'}
              </span>
            </div>

            {/* Change Dollar & Pct */}
            <div className="flex items-center justify-end gap-1.5 font-mono text-xs">
              <span className={isPositive ? 'text-[#22e08a]' : 'text-[#ff3b6b]'}>
                {isPositive ? '+' : ''}
                {computedChange.toFixed(2)} ({isPositive ? '+' : ''}
                {computedChangePct.toFixed(2)}%)
              </span>
            </div>
          </div>

          {/* Bid / Ask Box */}
          {lastQuote && lastQuote.bidPrice > 0 && lastQuote.askPrice > 0 ? (
            <div className="hidden sm:flex flex-col border-l border-white/10 pl-4 font-mono text-[11px]">
              <div className="flex items-center justify-between gap-3 text-neutral-400">
                <span>BID:</span>
                <span className="text-emerald-400 font-semibold">${lastQuote.bidPrice.toFixed(2)}</span>
                <span className="text-neutral-600 text-[9px]">x{lastQuote.bidSize}</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-neutral-400">
                <span>ASK:</span>
                <span className="text-rose-400 font-semibold">${lastQuote.askPrice.toFixed(2)}</span>
                <span className="text-neutral-600 text-[9px]">x{lastQuote.askSize}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-neutral-500 text-[10px]">
                <span>SPREAD:</span>
                <span>${(lastQuote.askPrice - lastQuote.bidPrice).toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div className="hidden sm:flex flex-col border-l border-white/10 pl-4 font-mono text-[11px] text-neutral-500">
              <span>SPREAD: SARRAF</span>
              <span>DEPTH: INTEGRATED</span>
            </div>
          )}
        </div>

        {/* Right: Market Status & Freshness */}
        <div className="flex items-center gap-3">
          {/* Freshness indicator */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 font-mono text-xs"
            title={`Latency: ${feed.dataFreshnessMs}ms`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isFresh
                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse'
                  : 'bg-amber-400'
              }`}
            />
            <span className="text-[11px] text-neutral-300">
              {isFresh ? 'LIVE SYNC' : 'STALE'}
            </span>
          </div>

          {/* Market Status Chip */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs font-bold border ${
              status === 'LIVE'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                : status === 'MARKET CLOSED'
                ? 'bg-neutral-800 text-neutral-300 border-neutral-700'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{status}</span>
          </div>

          {/* Session Countdown / Remaining */}
          <div className="hidden md:flex flex-col text-right font-mono text-[10px]">
            {marketHours.marketOpen ? (
              <>
                <span className="text-neutral-400">MINUTES TO CLOSE</span>
                <span className="text-[#E8B84A] font-bold">{marketHours.minutesToClose} MIN (16:00 ET)</span>
              </>
            ) : (
              <>
                <span className="text-neutral-400">NEXT SESSION</span>
                <span className="text-neutral-300 font-bold">{marketHours.nextOpen}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
