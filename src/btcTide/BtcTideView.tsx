import React, { useState, useEffect, useMemo } from 'react';
import { useBtcTideStore, computeWindowFlowStats } from './useBtcTideStore';
import { WindowOption } from './types';
import { FlowVolumePanel } from './FlowVolumePanel';
import { OrderTapePanel } from './OrderTapePanel';
import { LargePrintsPanel } from './LargePrintsPanel';
import { AggressionWaveformCanvas } from './AggressionWaveformCanvas';
import { CvdAndDeltaPanel } from './CvdAndDeltaPanel';
import { OrderBookDepthCard } from './OrderBookDepthCard';
import { PerpPositioningCard } from './PerpPositioningCard';
import { VenuesTableCard } from './VenuesTableCard';
import { HeroTideCanvas } from './HeroTideCanvas';
import { BtcTideDecisionCard } from './components/BtcTideDecisionCard';
import { ActiveTradePlanCard } from './components/ActiveTradePlanCard';
import { SignalLogTableCard } from './components/SignalLogTableCard';
import {
  Waves,
  RefreshCw,
  Clock,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

export const BtcTideView: React.FC = () => {
  const { store, setWindow, reconnect } = useBtcTideStore();
  const {
    activeSource,
    status,
    messageAgeMs,
    currentPrice,
    priceFlash,
    bookTicker,
    depth,
    perp,
    venues,
    session,
    selectedWindow,
    activeSignal,
    decision,
    activeTrade,
    closedTrades,
    signalStats,
    secondBins,
    recentTrades,
    largePrints,
  } = store;

  const isLive = status === 'LIVE';
  const isStale = status === 'STALE';
  const isOffline = status === 'OFFLINE';
  const isConnecting = status === 'CONNECTING';

  // Live UTC Clock
  const [utcTime, setUtcTime] = useState<string>('');

  useEffect(() => {
    const updateUtc = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const now = new Date();
      const hours = String(now.getUTCHours()).padStart(2, '0');
      const minutes = String(now.getUTCMinutes()).padStart(2, '0');
      const seconds = String(now.getUTCSeconds()).padStart(2, '0');
      setUtcTime(`${hours}:${minutes}:${seconds} UTC`);
    };
    updateUtc();
    const interval = setInterval(updateUtc, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatPrice = (val: number | null) => {
    if (val === null || val <= 0) return '--';
    return val.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Compute flow & volume stats for the selected window (1m / 5m / 15m)
  const windowStats = useMemo(
    () => computeWindowFlowStats(secondBins, selectedWindow),
    [secondBins, selectedWindow]
  );

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-6 py-4 space-y-4 overflow-x-hidden">
      {/* 1. Header: BTC TIDE, BTC/USDT, Status Badge, UTC Clock, Window Switch */}
      <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-3 sm:p-5 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Title & Currency Pair */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#B88628]/30 to-[#FFD97A]/20 border border-[#E8B84A]/40 flex items-center justify-center text-[#FFD97A] shadow-[0_0_15px_rgba(232,184,74,0.2)]">
              <Waves className="w-5 h-5 text-[#FFD97A]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-mono text-base sm:text-lg font-bold tracking-wider text-white">
                  BTC TIDE
                </h2>
                <span className="font-mono text-[11px] sm:text-xs font-semibold px-2 py-0.5 rounded bg-white/5 border border-white/10 text-neutral-300">
                  BTC/USDT
                </span>
              </div>
              <div className="font-mono text-[10px] sm:text-[11px] text-neutral-400 mt-0.5">
                Binance &amp; Bybit Public WS · 24/7 Node.js Backend &amp; SQLite Signals
              </div>
            </div>
          </div>

          {/* Right: Status Badge, UTC Clock, Window Switch */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 font-mono text-xs">
            {/* Live UTC Clock */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/10 text-neutral-300 text-[11px] sm:text-xs">
              <Clock className="w-3.5 h-3.5 text-[#FFD97A]" />
              <span>{utcTime || '--:--:-- UTC'}</span>
            </div>

            {/* Status Badge with Active Source (Binance vs Bybit Fallback) */}
            {isLive && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-950/70 border border-emerald-500/40 text-emerald-400 font-semibold shadow-[0_0_12px_rgba(16,185,129,0.2)] text-[11px] sm:text-xs">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span>LIVE ({activeSource})</span>
              </div>
            )}

            {isStale && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-950/70 border border-amber-500/50 text-amber-300 font-semibold animate-pulse text-[11px] sm:text-xs">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>STALE ({activeSource} · {(messageAgeMs / 1000).toFixed(1)}s)</span>
              </div>
            )}

            {isConnecting && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-yellow-950/70 border border-yellow-500/40 text-yellow-300 font-semibold text-[11px] sm:text-xs">
                <RefreshCw className="w-3 h-3 text-yellow-400 animate-spin" />
                <span>CONNECTING ({activeSource})</span>
              </div>
            )}

            {isOffline && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-950/70 border border-rose-500/50 text-rose-300 font-semibold text-[11px] sm:text-xs">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                <span>OFFLINE ({activeSource})</span>
                <button
                  onClick={reconnect}
                  className="ml-1 p-0.5 hover:text-white transition-colors cursor-pointer"
                  title="Reconnect"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Window Switch: 1m / 5m / 15m */}
            <div className="flex items-center p-0.5 rounded-lg bg-black/60 border border-white/10">
              {(['1m', '5m', '15m'] as WindowOption[]).map((win) => (
                <button
                  key={win}
                  onClick={() => setWindow(win)}
                  className={`px-2.5 py-1 rounded-md transition-all font-mono text-xs cursor-pointer ${
                    selectedWindow === win
                      ? 'bg-[#E8B84A] text-black font-bold shadow-[0_0_8px_rgba(232,184,74,0.3)]'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {win}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 1B. Full-Width Hero Canvas: Tug-of-War Tide & Flow Reactor */}
      <HeroTideCanvas
        currentPrice={currentPrice}
        status={status}
        messageAgeMs={messageAgeMs}
        secondBins={secondBins}
        activeSignal={activeSignal}
      />

      {/* 2. Primary Metrics Grid: Live Price, Bid, Ask, Spread, Session High/Low, Ticks Seen */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Metric 1: Live Price */}
        <div className="col-span-2 sm:col-span-1 bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-3.5 backdrop-blur-md">
          <div className="font-mono text-[10px] uppercase text-neutral-400 tracking-wider">
            LIVE PRICE
          </div>
          <div
            className={`font-mono text-2xl font-extrabold tracking-tight transition-colors duration-150 mt-1 flex items-baseline gap-1.5 ${
              isOffline || isStale
                ? 'text-neutral-500 opacity-60'
                : priceFlash === 'up'
                ? 'text-teal-300 drop-shadow-[0_0_10px_rgba(20,184,166,0.6)]'
                : priceFlash === 'down'
                ? 'text-rose-300 drop-shadow-[0_0_10px_rgba(244,63,94,0.6)]'
                : 'text-white'
            }`}
          >
            <span>${formatPrice(currentPrice)}</span>
          </div>
          <div className="font-mono text-[10px] text-neutral-400 mt-0.5">
            {priceFlash === 'up' ? (
              <span className="text-teal-400 flex items-center gap-0.5">
                <ArrowUpRight className="w-3 h-3" /> UPTICK
              </span>
            ) : priceFlash === 'down' ? (
              <span className="text-rose-400 flex items-center gap-0.5">
                <ArrowDownRight className="w-3 h-3" /> DOWNTICK
              </span>
            ) : (
              <span>USDT SPOT</span>
            )}
          </div>
        </div>

        {/* Metric 2: Best Bid */}
        <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-3.5 backdrop-blur-md">
          <div className="font-mono text-[10px] uppercase text-teal-400/90 tracking-wider">
            BEST BID
          </div>
          <div
            className={`font-mono text-xl font-bold tracking-tight mt-1 ${
              isOffline || isStale ? 'text-neutral-500' : 'text-teal-400'
            }`}
          >
            ${formatPrice(bookTicker.bid)}
          </div>
          <div className="font-mono text-[10px] text-neutral-400 mt-0.5">BUY SIDE WALL</div>
        </div>

        {/* Metric 3: Best Ask */}
        <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-3.5 backdrop-blur-md">
          <div className="font-mono text-[10px] uppercase text-rose-400/90 tracking-wider">
            BEST ASK
          </div>
          <div
            className={`font-mono text-xl font-bold tracking-tight mt-1 ${
              isOffline || isStale ? 'text-neutral-500' : 'text-rose-400'
            }`}
          >
            ${formatPrice(bookTicker.ask)}
          </div>
          <div className="font-mono text-[10px] text-neutral-400 mt-0.5">SELL SIDE WALL</div>
        </div>

        {/* Metric 4: Spread */}
        <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-3.5 backdrop-blur-md">
          <div className="font-mono text-[10px] uppercase text-neutral-400 tracking-wider">
            SPREAD
          </div>
          <div
            className={`font-mono text-xl font-bold tracking-tight mt-1 ${
              isOffline || isStale ? 'text-neutral-500' : 'text-neutral-200'
            }`}
          >
            {bookTicker.spread !== null ? `$${bookTicker.spread.toFixed(2)}` : '--'}
          </div>
          <div className="font-mono text-[10px] text-neutral-400 mt-0.5">
            {bookTicker.spreadBps !== null ? `${bookTicker.spreadBps.toFixed(2)} bps` : '-- bps'}
          </div>
        </div>

        {/* Metric 5: Session High / Low */}
        <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-3.5 backdrop-blur-md">
          <div className="font-mono text-[10px] uppercase text-neutral-400 tracking-wider">
            SESSION RANGE
          </div>
          <div className="font-mono text-xs font-semibold mt-1 space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-neutral-400">H:</span>
              <span
                className={`font-bold ${
                  isOffline || isStale ? 'text-neutral-500' : 'text-teal-400'
                }`}
              >
                ${formatPrice(session.sessionHigh)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-neutral-400">L:</span>
              <span
                className={`font-bold ${
                  isOffline || isStale ? 'text-neutral-500' : 'text-rose-400'
                }`}
              >
                ${formatPrice(session.sessionLow)}
              </span>
            </div>
          </div>
          <div className="font-mono text-[10px] text-neutral-400 mt-0.5">SINCE PAGE OPEN</div>
        </div>

        {/* Metric 6: Ticks Seen */}
        <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-3.5 backdrop-blur-md">
          <div className="font-mono text-[10px] uppercase text-neutral-400 tracking-wider">
            TICKS SEEN
          </div>
          <div
            className={`font-mono text-xl font-bold tracking-tight mt-1 ${
              isOffline || isStale ? 'text-neutral-500' : 'text-[#FFD97A]'
            }`}
          >
            {session.ticksSeen.toLocaleString()}
          </div>
          <div className="font-mono text-[10px] text-neutral-400 mt-0.5">
            {secondBins.length}s / 1,800s BINS
          </div>
        </div>
      </div>

      {/* 3. Live 1-Second Signal Engine Decision Card & Active Trade Plan Card */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 8-Component Weighted Decision Engine Card */}
        <BtcTideDecisionCard
          decision={decision}
          status={status}
          currentPrice={currentPrice}
        />

        {/* Live Active Trade Plan with Reticle Lock-On & Live R P&L */}
        <ActiveTradePlanCard
          trade={activeTrade}
          currentPrice={currentPrice}
          status={status}
        />
      </div>

      {/* 4. Real Closed Signal Outcome Log & Win Rate (Persisted to Database) */}
      <SignalLogTableCard
        closedTrades={closedTrades}
        stats={signalStats}
      />

      {/* 5. Flow & Volume Panel for Selected Window (1m / 5m / 15m) */}
      <FlowVolumePanel
        stats={windowStats}
        selectedWindow={selectedWindow}
        status={status}
      />

      {/* 4. Real Depth & Perp Derivatives Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Order Book: Top 8 levels each side with depth bars and imbalance % */}
        <OrderBookDepthCard depth={depth} status={status} />

        {/* Perp Positioning: Funding rate, countdown, open interest, 1h OI change, basis, L/S ratio, 5m liquidations */}
        <PerpPositioningCard perp={perp} status={status} />
      </div>

      {/* 5. Aggression Waveform (Last 3 Min: 1s Bars, Price Line, Rolling Net, >=$50K Dots, ABSORB/DRIVE Labels) */}
      <AggressionWaveformCanvas secondBins={secondBins} status={status} />

      {/* 6. 3-Min CVD with Price Overlay & Delta per 10 Seconds (Last 5 Min) Bars */}
      <CvdAndDeltaPanel secondBins={secondBins} status={status} />

      {/* 7. Order Tape & Large Prints (>= $50K) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OrderTapePanel trades={recentTrades} status={status} />
        <LargePrintsPanel largePrints={largePrints} status={status} />
      </div>

      {/* 8. Cross-Venue Table (8 Venues · 3s Poll: OKX, Gate.io, Bybit, MEXC, Bitget, KuCoin, Hyperliquid, Binance) */}
      <VenuesTableCard venuesData={venues} status={status} />
    </div>
  );
};
