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
import { Waves, Clock, Activity, Layers, Zap, Target, AlertTriangle, ShieldCheck, ShieldAlert, Send } from 'lucide-react';

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
    liveSelfCheck,
    telegramTelemetry,
    funnelDiagnostics,
  } = store;

  const telemetry = telegramTelemetry || liveSelfCheck?.telegramTelemetry;
  const lastTelegramSentStr = useMemo(() => {
    if (!telemetry?.lastMessageSentAt) return 'None yet';
    return `${new Date(telemetry.lastMessageSentAt).toISOString().slice(11, 19)} UTC`;
  }, [telemetry?.lastMessageSentAt]);

  const isTelegramIdle12h = useMemo(() => {
    if (!telemetry?.lastMessageSentAt) return true;
    return Date.now() - telemetry.lastMessageSentAt > 12 * 3600 * 1000;
  }, [telemetry?.lastMessageSentAt]);

  const [testSetupSending, setTestSetupSending] = useState(false);
  const [testSetupStatus, setTestSetupStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const handleSendTestSetup = async () => {
    if (testSetupSending) return;
    setTestSetupSending(true);
    setTestSetupStatus(null);
    try {
      const res = await fetch('/api/btc-tide/test-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        const msgId = data.telegram_message_id || data.messageId;
        setTestSetupStatus({
          ok: true,
          message: msgId
            ? `TEST setup sent to Telegram (msg #${msgId}, ${data.elapsedMs ?? 0}ms)`
            : 'TEST setup queued/sent to Telegram',
        });
      } else {
        setTestSetupStatus({
          ok: false,
          message: data?.error || `Telegram test setup queued (${res.status})`,
        });
      }
    } catch (err: any) {
      setTestSetupStatus({
        ok: false,
        message: err?.message || 'Network error sending test setup',
      });
    } finally {
      setTestSetupSending(false);
    }
  };

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

        {/* 24/7 Live Dispatch Self-Check & Telegram Outbox Telemetry Row */}
        <div className="mt-2.5 pt-2.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
          <div className="flex flex-wrap items-center gap-2">
            {/* Live Dispatch Badge */}
            {liveSelfCheck?.liveDispatchActive ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-bold text-[10px]">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                24/7 AUTO ENGINE: ON · REAL TELEGRAM DISPATCH
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 font-bold text-[10px]">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                24/7 ENGINE RUNNING · TELEGRAM QUEUING:{' '}
                {liveSelfCheck?.blockingReasons?.length
                  ? liveSelfCheck.blockingReasons.join(' · ')
                  : 'Verifying Telegram...'}
              </span>
            )}

            {/* 7-Point Startup & Live Self-Check Pills */}
            {liveSelfCheck?.checks && (
              <div className="flex flex-wrap items-center gap-1">
                {liveSelfCheck.checks.map((chk) => (
                  <span
                    key={chk.id}
                    title={`${chk.label}: ${chk.detail}`}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border cursor-help ${
                      chk.passed
                        ? 'bg-emerald-950/50 border-emerald-500/30 text-emerald-300'
                        : 'bg-rose-950/60 border-rose-500/50 text-rose-300'
                    }`}
                  >
                    {chk.passed ? '✓' : '✗'} {chk.label}
                  </span>
                ))}
              </div>
            )}
            {/* Adaptive Quiet-Market Mode Badge */}
            {decision.adaptiveModeActive && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-950/70 border border-cyan-500/50 text-cyan-300 font-bold text-[10px]">
                ⚡ Adaptive mode ON (Conf &ge;{decision.requiredConfidence ?? 65}% · Lead &ge;{decision.requiredLead ?? 18}%)
              </span>
            )}

            {/* 12h Telegram Idle Warning */}
            {isTelegramIdle12h && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-950/70 border border-amber-500/50 text-amber-300 font-semibold text-[10px]"
                title="Nothing was sent to Telegram in the last 12 hours"
              >
                <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                No Telegram dispatch in 12h
              </span>
            )}
          </div>

          {/* Telegram Outbox Telemetry: Last Sent Time, Queue Size, Sent Today + Send Test Setup Button */}
          <div className="flex flex-wrap items-center gap-2 px-2.5 py-1 rounded-lg bg-black/60 border border-white/10 text-[10px] text-neutral-300">
            <span className="flex items-center gap-1 text-[#FFD97A] font-semibold">
              <Send className="w-3 h-3" />
              TELEGRAM
            </span>
            <span className="text-white/20">|</span>
            <span>
              Last Sent: <strong className="text-white">{lastTelegramSentStr}</strong>
            </span>
            <span className="text-white/20">|</span>
            <span>
              Queue:{' '}
              <strong
                className={
                  (telemetry?.queueSize ?? 0) > 0 ? 'text-amber-300' : 'text-emerald-400'
                }
              >
                {telemetry?.queueSize ?? 0}
              </strong>
            </span>
            <span className="text-white/20">|</span>
            <span>
              Sent Today:{' '}
              <strong className="text-teal-300">{telemetry?.totalMessagesSentToday ?? 0}</strong>
            </span>
            <span className="text-white/20">|</span>
            <button
              type="button"
              onClick={handleSendTestSetup}
              disabled={testSetupSending}
              className="px-2 py-0.5 rounded bg-[#E8B84A]/20 hover:bg-[#E8B84A]/35 border border-[#E8B84A]/50 text-[#FFD97A] font-bold text-[10px] transition-colors cursor-pointer disabled:opacity-50"
              title="Send a clearly marked TEST setup message to Telegram right now"
            >
              {testSetupSending ? 'Sending...' : 'Send test setup'}
            </button>
          </div>
        </div>
        {testSetupStatus && (
          <div
            className={`mt-2 px-2.5 py-1.5 rounded-lg border font-mono text-[11px] flex items-center justify-between ${
              testSetupStatus.ok
                ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                : 'bg-amber-950/50 border-amber-500/40 text-amber-300'
            }`}
          >
            <span>{testSetupStatus.message}</span>
            <button
              type="button"
              onClick={() => setTestSetupStatus(null)}
              className="text-[10px] underline opacity-80 hover:opacity-100 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Dashboard Alert Banner when latest signal expired (260m pre-TP1 or 260m max lifetime after TP1) */}
      {!activeTrade &&
        (closedTrades[0]?.outcome === 'EXPIRED' ||
          closedTrades[0]?.outcome === 'EXPIRED_AFTER_TP1') && (
          <div className="bg-amber-950/60 border border-amber-500/50 rounded-xl px-3.5 py-2.5 font-mono text-xs flex flex-wrap items-center justify-between gap-2 text-amber-200 shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
            <div className="flex items-center gap-2 font-bold text-amber-300">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                {closedTrades[0].outcome === 'EXPIRED_AFTER_TP1'
                  ? `MAX 260M LIFETIME AFTER TP1 - CLOSE AT MARKET (${closedTrades[0].side})`
                  : `SIGNAL EXPIRED (260M) - CLOSE AT MARKET (${closedTrades[0].side})`}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <span>
                Entry:{' '}
                <strong className="text-white">
                  $
                  {closedTrades[0].entryPrice.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </span>
              <span>
                Close Price:{' '}
                <strong className="text-white">
                  $
                  {(closedTrades[0].closePrice ?? closedTrades[0].entryPrice).toLocaleString(
                    'en-US',
                    {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }
                  )}
                </strong>
              </span>
              <span>
                Real R:{' '}
                <strong
                  className={
                    (closedTrades[0].realizedR ?? 0) >= 0 ? 'text-teal-300' : 'text-rose-300'
                  }
                >
                  {(closedTrades[0].realizedR ?? 0) >= 0 ? '+' : ''}
                  {(closedTrades[0].realizedR ?? 0).toFixed(2)}R
                </strong>
              </span>
            </div>
          </div>
        )}

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
            lastClosedTrade={closedTrades[0] || null}
            currentPrice={currentPrice}
            status={status}
            isSpotStale={feedStale?.spot}
            spotAgeMs={feedAges?.spot}
          />

          {/* Phase 5 Item 1: "Why no trade?" 24h Filter Funnel Diagnostics & Best 6h Score Panel */}
          <div className="bg-[#08080a] border border-[#E8B84A]/25 rounded-xl p-4 sm:p-5 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)] space-y-3.5 font-mono">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-[#FFD97A]" />
                <span className="text-xs font-bold uppercase tracking-wider text-white">
                  WHY NO TRADE? · 24H FILTER FUNNEL DIAGNOSTICS
                </span>
                {decision.adaptiveModeActive && (
                  <span className="px-2 py-0.5 rounded bg-cyan-950/70 border border-cyan-500/40 text-cyan-300 text-[10px] font-bold">
                    Adaptive mode ON
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                <span className="text-neutral-400">
                  24h Blocked Ticks:{' '}
                  <strong className="text-white">
                    {funnelDiagnostics?.totalBlockedTicks24h ?? 0}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={handleSendTestSetup}
                  disabled={testSetupSending}
                  className="px-2.5 py-1 rounded bg-[#E8B84A]/20 hover:bg-[#E8B84A]/35 border border-[#E8B84A]/50 text-[#FFD97A] font-bold text-[10px] transition-colors cursor-pointer disabled:opacity-50"
                >
                  {testSetupSending ? 'Sending TEST...' : 'Send test setup to Telegram'}
                </button>
              </div>
            </div>

            {/* Ranked Blocking Gates Summary String */}
            <div className="bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-neutral-200">
              <span className="text-[#FFD97A] font-bold mr-1.5">24h Funnel Summary:</span>
              <span>
                {funnelDiagnostics?.summaryLine ||
                  'Collecting 24h engine tick diagnostics...'}
              </span>
            </div>

            {/* Ranked Bars + Best Score in Last 6h */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {/* Ranked Gates List */}
              <div className="lg:col-span-2 bg-black/40 border border-white/5 rounded-lg p-3 space-y-2">
                <div className="text-[10px] text-neutral-400 uppercase font-bold">
                  RANKED BLOCKING GATES (LAST 24H)
                </div>
                {funnelDiagnostics?.rankedGates && funnelDiagnostics.rankedGates.length > 0 ? (
                  <div className="space-y-1.5">
                    {funnelDiagnostics.rankedGates.slice(0, 8).map((g) => (
                      <div key={g.gate} className="space-y-0.5 text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="text-neutral-200 font-semibold">{g.label}</span>
                          <span className="text-[#FFD97A] font-bold">
                            {g.pct.toFixed(1)}%{' '}
                            <span className="text-neutral-500 font-normal">({g.count} ticks)</span>
                          </span>
                        </div>
                        <div className="h-1.5 bg-neutral-900 rounded-full overflow-hidden border border-white/5">
                          <div
                            className="h-full bg-gradient-to-r from-[#E8B84A] to-amber-500"
                            style={{ width: `${Math.min(100, g.pct)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-neutral-500 py-3">
                    No blocked ticks recorded in the last 24h yet.
                  </div>
                )}
              </div>

              {/* Best Score Seen in Last 6h */}
              <div className="bg-black/40 border border-white/5 rounded-lg p-3 flex flex-col justify-between space-y-2">
                <div>
                  <div className="text-[10px] text-neutral-400 uppercase font-bold">
                    BEST SCORE SEEN (LAST 6H)
                  </div>
                  {funnelDiagnostics?.bestScore6h ? (
                    <div className="mt-2 space-y-1.5 text-xs">
                      <div className="flex items-baseline justify-between">
                        <span className="text-neutral-400">Peak Confidence:</span>
                        <span className="text-lg font-black text-[#FFD97A]">
                          {funnelDiagnostics.bestScore6h.confidence.toFixed(0)}%
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-neutral-400">Peak Lead:</span>
                        <span className="text-sm font-bold text-teal-300">
                          +{funnelDiagnostics.bestScore6h.lead.toFixed(0)}%
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-neutral-400">Favored Side:</span>
                        <span
                          className={`text-xs font-bold ${
                            funnelDiagnostics.bestScore6h.side === 'LONG'
                              ? 'text-teal-400'
                              : funnelDiagnostics.bestScore6h.side === 'SHORT'
                              ? 'text-rose-400'
                              : 'text-neutral-300'
                          }`}
                        >
                          {funnelDiagnostics.bestScore6h.side}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between text-[11px]">
                        <span className="text-neutral-400">Seen At:</span>
                        <span className="text-neutral-300">
                          {new Date(funnelDiagnostics.bestScore6h.recordedAt)
                            .toISOString()
                            .slice(11, 19)}{' '}
                          UTC
                        </span>
                      </div>
                      <div className="pt-1 border-t border-white/5 text-[10px] text-neutral-400">
                        Gate at peak: <span className="text-neutral-200">{funnelDiagnostics.bestScore6h.waitReason}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-neutral-500 py-4">
                      Waiting for first post-warmup score peak...
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-white/10 text-[10px] text-neutral-400">
                  Target:Conf &ge;{decision.requiredConfidence ?? 68}% · Lead &ge;{decision.requiredLead ?? 22}% · Watch alert @ 60%/15% (max 1/hr)
                </div>
              </div>
            </div>
          </div>

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
