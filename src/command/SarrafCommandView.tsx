import React, { useState, useEffect } from 'react';
import { useCommandFeed, formatFreshness } from './data/useCommandFeed';
import { CommandHeader } from './components/CommandHeader';
import { TopAreaPlaceholders } from './components/TopAreaPlaceholders';
import { PriceMarketPanel } from './components/PriceMarketPanel';
import { FlowVolumePanel } from './components/FlowVolumePanel';
import { MarketRegimePanel } from './components/MarketRegimePanel';
import { BuySellRatioPanel } from './components/BuySellRatioPanel';
import { TickTapePanel } from './components/TickTapePanel';
import { CandlestickChartPanel } from './components/CandlestickChartPanel';
import { AbsorptionPanel } from './components/AbsorptionPanel';
import { OriginProfilePanel } from './components/OriginProfilePanel';
import { LiquidityZonesPanel } from './components/LiquidityZonesPanel';
import { ConfidencePanel } from './components/ConfidencePanel';
import { TickFlowHistogramPanel } from './components/TickFlowHistogramPanel';
import { TickImpactNetPanel } from './components/TickImpactNetPanel';
import { SpreadVolumeHistPanel } from './components/SpreadVolumeHistPanel';
import { LiquiditySummaryPanel } from './components/LiquiditySummaryPanel';
import { FastForward, Shield, Sparkles } from 'lucide-react';

export const SarrafCommandView: React.FC = () => {
  const feed = useCommandFeed();

  // Intro state: 2-second fade/slide intro, then staggered slide-in of cards in 40ms steps
  const [isIntroActive, setIsIntroActive] = useState(() => {
    if (typeof window !== 'undefined') {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) return false;
      return true;
    }
    return false;
  });

  const [cardsRevealed, setCardsRevealed] = useState(false);

  useEffect(() => {
    if (!isIntroActive) {
      setCardsRevealed(true);
      return;
    }

    const timer = setTimeout(() => {
      setIsIntroActive(false);
      setCardsRevealed(true);
    }, 2000);

    return () => clearTimeout(timer);
  }, [isIntroActive]);

  const handleSkipIntro = () => {
    setIsIntroActive(false);
    setCardsRevealed(true);
  };

  const isDimmed = feed.connection.status === 'RECONNECTING' || feed.connection.status === 'OFFLINE';

  // Real freshness computed timestamps
  const tickFreshness = formatFreshness(feed.lastTickTimestamp);
  const candleFreshness = formatFreshness(feed.lastCandleTimestamp);
  const derivedFreshness = formatFreshness(feed.lastDerivedTimestamp || feed.lastTickTimestamp);

  const nearestSup = feed.liquidityZones.find((z) => z.type === 'SUPPORT')?.mid || (feed.currentPrice > 0 ? feed.currentPrice - 3.5 : 0);
  const nearestRes = feed.liquidityZones.find((z) => z.type === 'RESISTANCE')?.mid || (feed.currentPrice > 0 ? feed.currentPrice + 3.5 : 0);

  return (
    <div className="relative min-h-screen w-full bg-[#04060b] text-[#e8edf5] px-2 sm:px-3 py-2 font-mono select-none overflow-x-hidden">
      {/* 2-Second Cinematic Intro Overlay with Tap-to-Skip */}
      {isIntroActive && (
        <div
          onClick={handleSkipIntro}
          className="fixed inset-0 z-50 bg-[#04060b]/95 backdrop-blur-md flex flex-col items-center justify-center p-4 cursor-pointer select-none transition-opacity duration-300 ease-out"
        >
          <div className="flex flex-col items-center max-w-xs w-full text-center space-y-3">
            <div className="w-10 h-10 rounded-lg bg-[#070b14] border border-[#38bdf8]/40 flex items-center justify-center text-[#38bdf8] shadow-[0_0_15px_rgba(56,189,248,0.25)]">
              <Shield className="w-5 h-5 text-[#E8B84A]" />
            </div>

            <div>
              <div className="flex items-center justify-center gap-1 text-[10px] tracking-[0.12em] font-bold text-[#38bdf8] uppercase">
                <Sparkles className="w-3 h-3 text-[#38bdf8]" />
                <span>SARRAF COMMAND</span>
              </div>
              <h2 className="text-base font-bold text-[#e8edf5] tracking-wider mt-0.5">
                XAU/USD CORE ONLINE
              </h2>
            </div>

            {/* Glowing scanning progress bar */}
            <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden relative">
              <div className="absolute inset-y-0 left-0 bg-[#38bdf8] w-full animate-pulse" />
            </div>

            <button
              onClick={handleSkipIntro}
              className="mt-2 inline-flex items-center gap-1 px-3 py-1 rounded bg-[#070b14] border border-[#38bdf8]/30 text-[9px] text-[#8a96a8] hover:text-[#e8edf5] font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              <FastForward className="w-2.5 h-2.5 text-[#38bdf8]" />
              <span>TAP TO SKIP</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Container of Stacked Cards (8px gap) */}
      <div className="max-w-4xl mx-auto space-y-2 pb-12">
        {/* HEADER */}
        <CommandHeader
          connection={feed.connection}
          selectedTimeframe={feed.selectedTimeframe}
          onTimeframeChange={feed.setTimeframe}
        />

        {/* Reconnecting Banner if Feed Dropped */}
        {isDimmed && (
          <div className="px-3 py-2 rounded-lg bg-[#ff3b6b]/10 border border-[#ff3b6b]/30 flex items-center justify-between text-[11px] text-[#ff3b6b] animate-pulse font-mono">
            <span className="font-bold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff3b6b] animate-ping" />
              BiQuote feed disconnected · Reconnecting...
            </span>
            <span className="text-[9px] text-[#8a96a8]">
              Dimmed (no stale data)
            </span>
          </div>
        )}

        {/* Stack of Cards with 40ms Staggered Slide-In */}
        <div className="space-y-2">
          {/* Card 0: Top Area Placeholders */}
          <div
            className={`transition-all duration-300 ease-out ${
              cardsRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: '0ms' }}
          >
            <TopAreaPlaceholders
              buyRatio={feed.buyRatio}
              sellRatio={feed.sellRatio}
              isDimmed={isDimmed}
              freshness={tickFreshness}
            />
          </div>

          {/* Panel 1: Price & Market Data */}
          <div
            className={`transition-all duration-300 ease-out ${
              cardsRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: '40ms' }}
          >
            <PriceMarketPanel
              currentPrice={feed.currentPrice}
              previousPrice={feed.previousPrice}
              bid={feed.bid}
              ask={feed.ask}
              spread={feed.spread}
              high24h={feed.high24h}
              low24h={feed.low24h}
              change24h={feed.change24h}
              changePercent24h={feed.changePercent24h}
              tickDirection={feed.tickDirection}
              sparkline={feed.sparkline}
              isDimmed={isDimmed}
              freshness={tickFreshness}
            />
          </div>

          {/* Panel 2: Flow & Volume */}
          <div
            className={`transition-all duration-300 ease-out ${
              cardsRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: '80ms' }}
          >
            <FlowVolumePanel
              buyTicks60s={feed.buyTicks60s}
              sellTicks60s={feed.sellTicks60s}
              flatTicks60s={feed.flatTicks60s}
              buyRatio={feed.buyRatio}
              sellRatio={feed.sellRatio}
              liquidityGrade={feed.liquidityGrade}
              isDimmed={isDimmed}
              freshness={tickFreshness}
            />
          </div>

          {/* Panel 3: Market Regime */}
          <div
            className={`transition-all duration-300 ease-out ${
              cardsRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: '120ms' }}
          >
            <MarketRegimePanel
              regime={feed.regime}
              isDimmed={isDimmed}
              freshness={derivedFreshness}
            />
          </div>

          {/* Panel 4: Buy / Sell Ratio */}
          <div
            className={`transition-all duration-300 ease-out ${
              cardsRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: '160ms' }}
          >
            <BuySellRatioPanel
              buyRatio={feed.buyRatio}
              sellRatio={feed.sellRatio}
              buyTicks60s={feed.buyTicks60s}
              sellTicks60s={feed.sellTicks60s}
              isDimmed={isDimmed}
              freshness={tickFreshness}
            />
          </div>

          {/* Panel 5: Tick Tape */}
          <div
            className={`transition-all duration-300 ease-out ${
              cardsRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: '200ms' }}
          >
            <TickTapePanel
              tickTape={feed.tickTape}
              buyTicks60s={feed.buyTicks60s}
              sellTicks60s={feed.sellTicks60s}
              buyDeltaSum60s={feed.buyDeltaSum60s}
              sellDeltaSum60s={feed.sellDeltaSum60s}
              isDimmed={isDimmed}
              freshness={tickFreshness}
            />
          </div>

          {/* Panel 6: XAUUSD Candlestick Chart */}
          <div
            className={`transition-all duration-300 ease-out ${
              cardsRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: '240ms' }}
          >
            <CandlestickChartPanel
              candles={feed.candles}
              timeframe={feed.selectedTimeframe}
              currentPrice={feed.currentPrice}
              supportLevel={nearestSup}
              resistanceLevel={nearestRes}
              isDimmed={isDimmed}
              freshness={candleFreshness}
            />
          </div>

          {/* Panel 7: Tick Absorption */}
          <div
            className={`transition-all duration-300 ease-out ${
              cardsRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: '280ms' }}
          >
            <AbsorptionPanel
              buyZones={feed.absorptionBuyZones}
              sellZones={feed.absorptionSellZones}
              currentPrice={feed.currentPrice}
              isDimmed={isDimmed}
              freshness={candleFreshness}
            />
          </div>

          {/* Panel 8: Origin Profile */}
          <div
            className={`transition-all duration-300 ease-out ${
              cardsRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: '320ms' }}
          >
            <OriginProfilePanel
              originLevels={feed.originLevels}
              originDisplacements={feed.originDisplacements}
              currentPrice={feed.currentPrice}
              isDimmed={isDimmed}
              freshness={candleFreshness}
            />
          </div>

          {/* Panel 9: Liquidity Zones */}
          <div
            className={`transition-all duration-300 ease-out ${
              cardsRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: '360ms' }}
          >
            <LiquidityZonesPanel
              liquidityZones={feed.liquidityZones}
              currentPrice={feed.currentPrice}
              isDimmed={isDimmed}
              freshness={candleFreshness}
            />
          </div>

          {/* Panel 10: Confidence Matrix */}
          <div
            className={`transition-all duration-300 ease-out ${
              cardsRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: '400ms' }}
          >
            <ConfidencePanel
              confidence={feed.confidence}
              isDimmed={isDimmed}
              freshness={derivedFreshness}
            />
          </div>

          {/* Panel 11: Tick Flow Histogram */}
          <div
            className={`transition-all duration-300 ease-out ${
              cardsRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: '440ms' }}
          >
            <TickFlowHistogramPanel
              minuteFlows={feed.minuteFlows}
              isDimmed={isDimmed}
              freshness={tickFreshness}
            />
          </div>

          {/* Panel 12: Tick Impact & Net */}
          <div
            className={`transition-all duration-300 ease-out ${
              cardsRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: '480ms' }}
          >
            <TickImpactNetPanel
              minuteFlows={feed.minuteFlows}
              buyTicks60s={feed.buyTicks60s}
              sellTicks60s={feed.sellTicks60s}
              isDimmed={isDimmed}
              freshness={tickFreshness}
            />
          </div>

          {/* Panel 13: Spread & Volume Histograms */}
          <div
            className={`transition-all duration-300 ease-out ${
              cardsRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: '520ms' }}
          >
            <SpreadVolumeHistPanel
              spread={feed.spread}
              spreadHistory={feed.spreadHistory}
              volumeHistory={feed.volumeHistory}
              isDimmed={isDimmed}
              freshness={tickFreshness}
            />
          </div>

          {/* Panel 14: Liquidity Summary */}
          <div
            className={`transition-all duration-300 ease-out ${
              cardsRevealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: '560ms' }}
          >
            <LiquiditySummaryPanel
              liquidityGrade={feed.liquidityGrade}
              nearestZone={feed.nearestZone}
              spread={feed.spread}
              totalTicks60s={feed.buyTicks60s + feed.sellTicks60s + feed.flatTicks60s}
              isDimmed={isDimmed}
              freshness={derivedFreshness}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
