import React, { useState, useEffect, useMemo, useRef } from 'react';
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
import { LiquidityTapeCanvas } from './LiquidityTapeCanvas';
import { BtcTideDecisionCard } from './components/BtcTideDecisionCard';
import { ActiveTradePlanCard } from './components/ActiveTradePlanCard';
import { SignalLogTableCard } from './components/SignalLogTableCard';
import { BtcTideDebugDrawer } from './components/BtcTideDebugDrawer';
import { Waves, Clock, Activity, Layers, Zap, Target } from 'lucide-react';

export type BtcTideSubTab = 'FLOW' | 'BOOK' | 'PERPS' | 'SIGNALS';

export const BtcTideView: React.FC = () => {
  const { store, setWindow } = useBtcTideStore();
  const {
    activeSource,
    status,
    messageAgeMs,
    feedAges,
    feedSources,
    feedStale,
    reconcile,
    geoBlockedNotice,
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
    heatmapHistory,
  } = store;

  const [activeSubTab, setActiveSubTab] = useState<BtcTideSubTab>('FLOW');

  // Debug Drawer: Toggle by tapping title 5 times
  const [debugTapCount, setDebugTapCount] = useState(0);
  const [isDebugDrawerOpen, setIsDebugDrawerOpen] = useState(false);
  const tapTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleTitleTap = () => {
    setDebugTapCount((prev) => {
      const next = prev + 1;
      if (next >= 5) {
        setIsDebugDrawerOpen((o) => !o);
        return 0;
      }
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      tapTimerRef.current = setTimeout(() => setDebugTapCount(0), 3000);
      return next;
    });
  };

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

  // Compute flow & volume stats for the selected window (1m / 5m / 15m)
  const windowStats = useMemo(
    () => computeWindowFlowStats(secondBins, selectedWindow),
    [secondBins, selectedWindow]
  );

  const subTabs: Array<{ id: BtcTideSubTab; label: string; icon: React.ReactNode }> = [
    { id: 'FLOW', label: 'FLOW', icon: <Activity className="w-3.5 h-3.5 shrink-0" /> },
    { id: 'BOOK', label: 'BOOK', icon: <Layers className="w-3.5 h-3.5 shrink-0" /> },
    { id: 'PERPS', label: 'PERPS', icon: <Zap className="w-3.5 h-3.5 shrink-0" /> },
    { id: 'SIGNALS', label: 'SIGNALS', icon: <Target className="w-3.5 h-3.5 shrink-0" /> },
  ];

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-6 py-3 space-y-3 overflow-x-hidden">
      {/* 1. Compact Header: BTC TIDE, 4 Feed Dots (SPOT, BOOK, PERPS, VENUES), UTC Clock */}
      <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Left: Title & Source */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#B88628]/30 to-[#FFD97A]/20 border border-[#E8B84A]/40 flex items-center justify-center text-[#FFD97A] shrink-0">
              <Waves className="w-4 h-4 text-[#FFD97A]" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  onClick={handleTitleTap}
                  className="font-mono text-sm sm:text-base font-bold tracking-wider text-white select-none cursor-pointer hover:text-[#FFD97A] transition-colors"
                  title="BTC TIDE (Tap 5 times to open Upstream Debug Drawer)"
                >
                  BTC TIDE
                  {debugTapCount > 0 && debugTapCount < 5 && (
                    <span className="ml-1.5 text-[10px] text-[#FFD97A] font-normal animate-pulse">
                      [{debugTapCount}/5]
                    </span>
                  )}
                </h2>
                <span className="font-mono text-[11px] text-neutral-400">
                  BTC/USDT · <span className="text-neutral-200 font-semibold">{activeSource}</span>
                </span>
                {geoBlockedNotice && (
                  <span
                    className="font-mono text-[9px] text-amber-300 font-bold"
                    title={geoBlockedNotice}
                  >
                    · GEO-FALLBACK
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: 4 Feed Dots (SPOT, BOOK, PERPS, VENUES) & UTC Clock */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            {/* 4 Feed Status Dots */}
            <div className="flex items-center gap-2 sm:gap-2.5 px-2.5 py-1 rounded-lg bg-black/60 border border-white/10 font-mono text-[10px] sm:text-[11px]">
              {[
                {
                  id: 'SPOT',
                  label: 'SPOT',
                  ageMs: feedAges?.spot ?? 999999,
                  source: feedSources?.spot ?? activeSource,
                  isStale: feedStale?.spot ?? true,
                  thresholdSec: 5,
                  reconcileMismatch: Boolean(reconcile?.spotMismatch),
                  reconcileDiffPct: reconcile?.spotDiffPct ?? null,
                },
                {
                  id: 'BOOK',
                  label: 'BOOK',
                  ageMs: feedAges?.book ?? 999999,
                  source: feedSources?.book ?? `${activeSource} Orderbook`,
                  isStale: feedStale?.book ?? true,
                  thresholdSec: 3,
                  reconcileMismatch: Boolean(reconcile?.bookMismatch),
                  reconcileDiffPct: reconcile?.bookDiffPct ?? null,
                },
                {
                  id: 'PERPS',
                  label: 'PERPS',
                  ageMs: feedAges?.perps ?? 999999,
                  source: feedSources?.perps ?? 'Binance Futures',
                  isStale: feedStale?.perps ?? true,
                  thresholdSec: 20,
                  reconcileMismatch: false,
                  reconcileDiffPct: null,
                },
                {
                  id: 'VENUES',
                  label: 'VENUES',
                  ageMs: feedAges?.venues ?? 999999,
                  source: feedSources?.venues ?? 'Cross-Venue (9 Exchanges)',
                  isStale: feedStale?.venues ?? true,
                  thresholdSec: 10,
                  reconcileMismatch: false,
                  reconcileDiffPct: null,
                },
              ].map((dot) => {
                const thresholdMs = dot.thresholdSec * 1000;
                const isRed = dot.reconcileMismatch || dot.ageMs > thresholdMs;
                const colorClass = isRed
                  ? 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.85)]'
                  : 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]';

                const ageFormatted = dot.ageMs < 999999 ? `${(dot.ageMs / 1000).toFixed(1)}s` : '--';
                const reconcileNote = dot.reconcileMismatch
                  ? ` · RECONCILE MISMATCH (${dot.reconcileDiffPct}% > 0.1%)`
                  : '';

                return (
                  <div
                    key={dot.id}
                    className="flex items-center gap-1 cursor-help"
                    title={`${dot.label}: ${dot.source} · Age: ${ageFormatted} (threshold ${dot.thresholdSec}s)${reconcileNote}`}
                  >
                    <span className={`inline-block w-2 h-2 rounded-full ${colorClass} transition-colors`} />
                    <span
                      className={`font-semibold text-[10px] ${
                        isRed ? 'text-rose-400' : 'text-neutral-200'
                      }`}
                    >
                      {dot.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Live UTC Clock */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 border border-white/10 text-neutral-300 text-[11px]">
              <Clock className="w-3 h-3 text-[#FFD97A]" />
              <span>{utcTime || '--:--:-- UTC'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Top Hero: LIQUIDITY TAPE Data-Literal Canvas */}
      <LiquidityTapeCanvas
        currentPrice={currentPrice}
        priceFlash={priceFlash}
        status={status}
        messageAgeMs={messageAgeMs}
        secondBins={secondBins}
        activeSignal={activeSignal}
        activeTrade={activeTrade}
        decision={decision}
        bookTicker={bookTicker}
        session={session}
        isSpotStale={feedStale?.spot}
        spotAgeMs={feedAges?.spot}
        isBookStale={feedStale?.book}
        bookAgeMs={feedAges?.book}
        heatmapHistory={heatmapHistory}
        recentTrades={recentTrades}
      />

      {/* 3. Sticky Segmented Control with 4 Sub-Tabs: FLOW | BOOK | PERPS | SIGNALS */}
      <div className="sticky top-2 z-30 bg-[#08080a]/95 backdrop-blur-md border border-[#E8B84A]/30 rounded-xl p-1.5 shadow-[0_6px_24px_rgba(0,0,0,0.75)] flex items-center justify-between gap-2">
        <div className="grid grid-cols-4 gap-1 w-full">
          {subTabs.map((tab) => {
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSubTab(tab.id)}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg font-mono text-xs font-bold tracking-wider transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#E8B84A] text-black shadow-[0_0_12px_rgba(232,184,74,0.35)]'
                    : 'text-neutral-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Active Sub-Tab Content (Only ONE section renders at a time) */}
      {activeSubTab === 'FLOW' && (
        <div className="space-y-4">
          {/* Window Switch Bar for Flow & Volume */}
          <div className="flex items-center justify-between px-1">
            <span className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">
              FLOW &amp; AGGRESSION WINDOW
            </span>
            <div className="flex items-center p-0.5 rounded-lg bg-[#08080a] border border-white/10">
              {(['1m', '5m', '15m'] as WindowOption[]).map((win) => (
                <button
                  key={win}
                  type="button"
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

          {/* Flow and Volume Boxes */}
          <FlowVolumePanel
            stats={windowStats}
            selectedWindow={selectedWindow}
            status={status}
            isSpotStale={feedStale?.spot}
            spotAgeMs={feedAges?.spot}
          />

          {/* Aggression Waveform */}
          <AggressionWaveformCanvas
            secondBins={secondBins}
            status={status}
            isSpotStale={feedStale?.spot}
            spotAgeMs={feedAges?.spot}
          />

          {/* CVD & Delta per 10s */}
          <CvdAndDeltaPanel
            secondBins={secondBins}
            status={status}
            isSpotStale={feedStale?.spot}
            spotAgeMs={feedAges?.spot}
          />

          {/* Tape with Filters & Large Prints */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <OrderTapePanel
              trades={recentTrades}
              status={status}
              isSpotStale={feedStale?.spot}
              spotAgeMs={feedAges?.spot}
            />
            <LargePrintsPanel
              largePrints={largePrints}
              status={status}
              isSpotStale={feedStale?.spot}
              spotAgeMs={feedAges?.spot}
            />
          </div>
        </div>
      )}

      {activeSubTab === 'BOOK' && (
        <div className="space-y-4">
          <OrderBookDepthCard
            depth={depth}
            status={status}
            isBookStale={feedStale?.book}
            bookAgeMs={feedAges?.book}
          />
          <VenuesTableCard
            venuesData={venues}
            status={status}
            isVenuesStale={feedStale?.venues}
            venuesAgeMs={feedAges?.venues}
          />
        </div>
      )}

      {activeSubTab === 'PERPS' && (
        <div className="space-y-4">
          <PerpPositioningCard
            perp={perp}
            status={status}
            isPerpsStale={feedStale?.perps}
            perpsAgeMs={feedAges?.perps}
          />
        </div>
      )}

      {activeSubTab === 'SIGNALS' && (
        <div className="space-y-4">
          {/* Active Trade Card */}
          <ActiveTradePlanCard
            trade={activeTrade}
            currentPrice={currentPrice}
            status={status}
            isSpotStale={feedStale?.spot}
            spotAgeMs={feedAges?.spot}
          />

          {/* 8-Component Breakdown (Collapsed by Default) */}
          <BtcTideDecisionCard
            decision={decision}
            status={status}
            currentPrice={currentPrice}
            defaultCollapsed={true}
            isSpotStale={feedStale?.spot}
            spotAgeMs={feedAges?.spot}
          />

          {/* Signal Log */}
          <SignalLogTableCard
            closedTrades={closedTrades}
            stats={signalStats}
          />
        </div>
      )}

      {/* Hidden Upstream Debug & Health Telemetry Drawer (Toggled by tapping title 5x) */}
      <BtcTideDebugDrawer
        isOpen={isDebugDrawerOpen}
        onClose={() => setIsDebugDrawerOpen(false)}
      />
    </div>
  );
};
