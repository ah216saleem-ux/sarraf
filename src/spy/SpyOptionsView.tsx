import React, { useState, useEffect, useRef } from 'react';
import { useSpyFeed } from './useSpyFeed';
import { SpyExpiryOption } from './types';
import { SpyTopBar } from './components/SpyTopBar';
import { SpyExpiryChips } from './components/SpyExpiryChips';
import { SpyScanAnimation } from './components/SpyScanAnimation';
import { SpyResultCard } from './components/SpyResultCard';
import { SpyCandleMiniChart } from './components/SpyCandleMiniChart';
import { SpyHistoryPanel } from './components/SpyHistoryPanel';
import {
  Zap,
  AlertCircle,
  Play,
  Square,
  Sparkles,
  RefreshCw,
  Radio,
  Clock,
  ShieldAlert,
} from 'lucide-react';

export const SpyOptionsView: React.FC = () => {
  const {
    feedState,
    expiryOptions,
    candles,
    selectedTimeframe,
    setSelectedTimeframe,
    activeAnalysis,
    history,
    stats,
    priceFlash,
    runAnalysis,
    analysisError,
  } = useSpyFeed();

  const [selectedExpiry, setSelectedExpiry] = useState<SpyExpiryOption>('15m');
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [isAutoScan, setIsAutoScan] = useState(false);
  const [autoScanStatus, setAutoScanStatus] = useState<string | null>(null);

  const isMarketClosed = !feedState.marketHours.marketOpen;
  const isDataStale = !feedState.isFresh || feedState.dataFreshnessMs > 10000;

  // Selected expiry status
  const currentExpiryStatus = expiryOptions.find((o) => o.expiry === selectedExpiry);
  const isSelectedExpiryDisabled = currentExpiryStatus ? !currentExpiryStatus.enabled : false;

  const isStartDisabled = isMarketClosed || isDataStale || isSelectedExpiryDisabled;

  // Handle manual Start Signal click
  const handleStartSignal = async () => {
    if (isScanning) {
      // STOP action
      setIsScanning(false);
      setIsAutoScan(false);
      return;
    }

    if (isStartDisabled) return;

    setIsScanning(true);
    setScanResult(null);

    // Run backend deterministic calculation
    const result = await runAnalysis(selectedExpiry);
    setScanResult(result);
  };

  const handleScanAnimationComplete = () => {
    setIsScanning(false);
  };

  // Auto-Scan Engine Loop
  const autoScanTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isAutoScan) {
      if (autoScanTimerRef.current) clearInterval(autoScanTimerRef.current);
      setAutoScanStatus(null);
      return;
    }

    if (isMarketClosed || isDataStale) {
      setAutoScanStatus('Auto-scan paused: Market closed or data stale.');
      return;
    }

    setAutoScanStatus(`Auto-scanning ${selectedExpiry} for valid Smart Money setup...`);

    const runAutoScanPass = async () => {
      if (isScanning) return;

      const opt = expiryOptions.find((o) => o.expiry === selectedExpiry);
      if (opt && !opt.enabled) {
        setAutoScanStatus(`Auto-scan on hold: ${opt.disabledReason || 'Expiry locked/cooldown'}`);
        return;
      }

      setAutoScanStatus(`Evaluating live candles on ${selectedExpiry}...`);
      const result = await runAnalysis(selectedExpiry);
      if (result) {
        if (result.decision === 'CALL' || result.decision === 'PUT') {
          setScanResult(result);
          setAutoScanStatus(`Valid ${result.decision} setup detected at $${result.currentPrice}! Signal active.`);
        } else {
          setAutoScanStatus(`Selectivity active: Confluence score ${result.totalScore}% < 70%. Monitoring...`);
        }
      }
    };

    // Run immediately then every 25 seconds
    runAutoScanPass();
    autoScanTimerRef.current = setInterval(runAutoScanPass, 25000);

    return () => {
      if (autoScanTimerRef.current) clearInterval(autoScanTimerRef.current);
    };
  }, [isAutoScan, isMarketClosed, isDataStale, selectedExpiry, expiryOptions, isScanning, runAnalysis]);

  const currentResultToDisplay = scanResult || activeAnalysis;

  return (
    <div className="space-y-6">
      {/* Top Bar: Real SPY price, quote, market hours, freshness */}
      <SpyTopBar feed={feedState} priceFlash={priceFlash} />

      {/* Main Analysis Control Card */}
      <div className="glass-panel p-5 sm:p-6 rounded-2xl border border-[#E8B84A]/30 bg-black/60 shadow-[0_4px_30px_rgba(0,0,0,0.6)] space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#E8B84A] animate-pulse" />
              <h2 className="font-mono text-sm sm:text-base font-bold text-white tracking-wider">
                SARRAF QUANT OPTIONS ENGINE • S&P 500
              </h2>
            </div>
            <p className="font-mono text-xs text-neutral-400 mt-1">
              Deterministic Smart Money confluence (Order Blocks, Sweeps, FVG, Structure shifts, Volume, and ATR feasibility).
            </p>
          </div>

          {/* Action Controls: START SIGNAL / STOP + AUTO-SCAN Toggle */}
          <div className="flex flex-wrap items-center gap-3">
            {/* AUTO-SCAN Toggle */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 font-mono text-xs">
              <button
                onClick={() => {
                  if (!isAutoScan && isStartDisabled) return;
                  setIsAutoScan(!isAutoScan);
                }}
                disabled={!isAutoScan && isStartDisabled}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  isAutoScan ? 'bg-[#E8B84A]' : 'bg-neutral-800'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-black shadow ring-0 transition duration-200 ease-in-out ${
                    isAutoScan ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
              <div className="flex flex-col">
                <span className="text-[11px] font-bold text-neutral-200 flex items-center gap-1">
                  <Radio className={`w-3 h-3 ${isAutoScan ? 'text-emerald-400 animate-pulse' : 'text-neutral-500'}`} />
                  AUTO-SCAN
                </span>
                <span className="text-[9px] text-neutral-400">
                  {isAutoScan ? 'SCANNING' : 'OFF'}
                </span>
              </div>
            </div>

            {/* Big START SIGNAL Button */}
            <button
              onClick={handleStartSignal}
              disabled={!isScanning && isStartDisabled}
              className={`relative px-6 py-3 rounded-xl font-mono text-sm font-black tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 shadow-xl ${
                isScanning
                  ? 'bg-rose-600 text-white hover:bg-rose-700 border border-rose-500 shadow-[0_0_20px_rgba(225,29,72,0.4)] active:scale-95'
                  : isStartDisabled
                  ? 'bg-neutral-800 text-neutral-500 border border-neutral-700 cursor-not-allowed opacity-60'
                  : 'bg-[#E8B84A] text-black hover:bg-[#f3c559] border border-[#E8B84A] shadow-[0_0_25px_rgba(232,184,74,0.4)] active:scale-95'
              }`}
            >
              {isScanning ? (
                <>
                  <Square className="w-4 h-4 fill-current" />
                  <span>STOP SCAN</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>START SIGNAL</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Expiry Selector Chips */}
        <SpyExpiryChips
          selectedExpiry={selectedExpiry}
          onSelectExpiry={setSelectedExpiry}
          options={expiryOptions}
          disabledAll={isMarketClosed || isScanning}
        />

        {/* Status Banners: Closed market, Stale data, Auto-Scan status, Cooldown/Lock */}
        {isMarketClosed ? (
          <div className="p-3.5 rounded-xl bg-neutral-900/80 border border-neutral-800 font-mono text-xs text-neutral-400 flex items-center gap-3">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <strong className="text-neutral-200">US REGULAR SESSION IS CLOSED:</strong> Last close was{' '}
              <span className="text-white font-bold">${feedState.previousClose?.toFixed(2) || 'N/A'}</span>. Live execution unlocks at next regular session open ({feedState.marketHours.nextOpen}). START SIGNAL is disabled.
            </div>
          </div>
        ) : isDataStale ? (
          <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 font-mono text-xs text-amber-300 flex items-center gap-3">
            <Clock className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
            <div>
              <strong className="text-amber-200">DATA IS STALE (&gt;10s old):</strong> Feed latency is{' '}
              {Math.round(feedState.dataFreshnessMs / 1000)}s. START SIGNAL is guarded and blocked until fresh quotes arrive.
            </div>
          </div>
        ) : currentExpiryStatus && !currentExpiryStatus.enabled ? (
          <div className="p-3.5 rounded-xl bg-neutral-900/80 border border-amber-500/30 font-mono text-xs text-amber-300 flex items-center gap-3">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <strong className="text-amber-200">EXPIRY LOCKED:</strong> {currentExpiryStatus.disabledReason}
            </div>
          </div>
        ) : null}

        {/* Auto-scan live telemetry badge if active */}
        {isAutoScan && autoScanStatus && (
          <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 font-mono text-xs text-emerald-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
            <span>{autoScanStatus}</span>
          </div>
        )}

        {/* Analysis Error Notification if failed */}
        {analysisError && !isScanning && (
          <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 font-mono text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{analysisError}</span>
          </div>
        )}
      </div>

      {/* 3D Scan Visualizer (Rendered during manual or auto scan) */}
      {isScanning && (
        <div className="space-y-2">
          <SpyScanAnimation
            isScanning={isScanning}
            candles={candles}
            gates={scanResult?.gates || []}
            finalDecision={scanResult?.decision || null}
            durationMs={6500}
            onScanComplete={handleScanAnimationComplete}
          />
        </div>
      )}

      {/* Result Card: CALL / PUT / NO TRADE with Smart Money gate breakdown & levels */}
      {!isScanning && currentResultToDisplay && (
        <SpyResultCard result={currentResultToDisplay} />
      )}

      {/* Real SPY Candlestick Chart */}
      <SpyCandleMiniChart
        candles={candles}
        currentPrice={feedState.currentPrice}
        timeframe={selectedTimeframe}
        onTimeframeChange={setSelectedTimeframe}
        entryPrice={currentResultToDisplay?.entryPrice}
        slPrice={currentResultToDisplay?.slPrice}
        tpPrice={currentResultToDisplay?.tpPrice}
      />

      {/* Historical Signals & Selective Audit Trail */}
      <SpyHistoryPanel history={history} stats={stats} />
    </div>
  );
};
