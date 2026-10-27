// src/doji/SarrafDojiView.tsx
import React, { useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Clock,
  Layers,
  Activity,
  Maximize2,
  Settings,
  Play,
} from 'lucide-react';
import {
  DojiTimeframe,
  DojiZone,
  formatSignedDollar,
  formatRoundedSignedDollar,
} from './dojiEngine';
import { useDojiFeed } from './useDojiFeed';
import { DojiChart } from './DojiChart';
import { ActiveSignalCard } from './ActiveSignalCard';
import { TradeLogSection } from './TradeLogSection';

const ALL_TIMEFRAMES: DojiTimeframe[] = ['15m', '30m', '1h', '4h'];

export const SarrafDojiView: React.FC = () => {
  const [selectedTf, setSelectedTf] = useState<DojiTimeframe>('15m');
  const [showZones, setShowZones] = useState<boolean>(true);
  const [showEma9, setShowEma9] = useState<boolean>(true);
  const [latestTrigger, setLatestTrigger] = useState<number>(0);
  const [resetTrigger, setResetTrigger] = useState<number>(0);
  const [fitZonesTrigger, setFitZonesTrigger] = useState<number>(0);
  const [focusedZoneRequest, setFocusedZoneRequest] = useState<{
    zone: DojiZone;
    seq: number;
  } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isRejectionsDebugOpen, setIsRejectionsDebugOpen] = useState<boolean>(false);

  const [isBacktesting, setIsBacktesting] = useState<boolean>(false);
  const [backtestResult, setBacktestResult] = useState<{
    totalTrades: number;
    winRate: number;
    averageR: number;
    maxDrawdown: number;
    wins: number;
    losses: number;
    tf: string;
  } | null>(null);
  const [backtestError, setBacktestError] = useState<string | null>(null);

  const {
    currentTfBars,
    livePrice,
    dayChange,
    dayChangePercent,
    isMarketClosed,
    isLoadingCandles,
    trendFilter,
    setTrendFilter,
    retestConfirm,
    setRetestConfirm,
    minZoneStrength,
    setMinZoneStrength,
    tp1R,
    setTp1R,
    tp2R,
    setTp2R,
    tp3R,
    setTp3R,
    showAllZones,
    setShowAllZones,
    maxZonesPerTf,
    setMaxZonesPerTf,
    maxDistanceAtr,
    setMaxDistanceAtr,
    zonesMap,
    tfStatsMap,
    allValidZones,
    currentTfZones,
    activeSignal,
    allTrades,
    activeTradesMap,
    activeTrade,
  } = useDojiFeed(selectedTf);

  const isUp = dayChange >= 0;

  const handleZoneClick = (zone: DojiZone) => {
    setSelectedTf(zone.timeframe);
    setShowZones(true);
    setFocusedZoneRequest({ zone, seq: Date.now() });
  };

  const runQuickBacktest = async () => {
    setIsBacktesting(true);
    setBacktestError(null);
    try {
      const query = new URLSearchParams({
        tf: selectedTf,
        mode: 'indicator',
        trend: trendFilter ? '1' : '0',
        merge: '1',
        confirm: retestConfirm ? '1' : '0',
        tp1R: String(tp1R),
        tp2R: String(tp2R),
        tp3R: String(tp3R),
        minZoneStrength: String(minZoneStrength),
      });
      const res = await fetch(`/api/doji/backtest?${query.toString()}`);
      if (!res.ok) {
        throw new Error(`Backtest failed: ${res.statusText}`);
      }
      const data = await res.json();
      setBacktestResult({
        totalTrades: data.totalTrades ?? 0,
        winRate: data.winRate ?? 0,
        averageR: data.averageR ?? 0,
        maxDrawdown: data.maxDrawdownR ?? data.maxDrawdown ?? 0,
        wins: data.wins ?? 0,
        losses: data.losses ?? 0,
        tf: selectedTf,
      });
    } catch (err: any) {
      setBacktestError(err?.message || 'Backtest failed');
    } finally {
      setIsBacktesting(false);
    }
  };

  // Up to 5 Top setups across valid zones
  const topSetups = useMemo(() => {
    const list = allValidZones.map((z) => {
      const activeForTf = activeTradesMap[z.timeframe];
      const isTradeOnZone = Boolean(
        activeForTf &&
          activeForTf.status === 'OPEN' &&
          (activeForTf.zoneOpenTime === z.openTime || activeForTf.zoneId === z.id)
      );
      const isReady = Boolean(z.isRetestLive || isTradeOnZone);
      const state: 'ready' | 'armed' | 'waiting' = isReady
        ? 'ready'
        : z.zoneState === 'armed' || z.isBroken
        ? 'armed'
        : 'waiting';
      const stateScore = state === 'ready' ? 3 : state === 'armed' ? 2 : 1;
      return {
        zone: z,
        state,
        stateScore,
        side: z.side || (z.breakDirection === 'UP' ? 'BUY' : 'SELL'),
      };
    });

    list.sort((a, b) => {
      if (b.stateScore !== a.stateScore) return b.stateScore - a.stateScore;
      return b.zone.strength - a.zone.strength;
    });

    return list.slice(0, 5);
  }, [allValidZones, activeTradesMap]);

  return (
    <div className="space-y-3.5 font-['DM_Sans',sans-serif] text-[#f0eadb] pb-8">
      {/* 1) Compact Single-Row Header: "Doji zones" + XAUUSD Price + Day Change + Status Dot */}
      <div className="px-3.5 py-2.5 rounded-[12px] bg-[#12100c] border border-[#2b261b] flex flex-wrap items-center justify-between gap-2 overflow-hidden">
        <h1 className="text-base sm:text-lg font-bold text-[#f0eadb] font-['Bricolage_Grotesque',sans-serif] whitespace-nowrap shrink-0">
          Doji zones
        </h1>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 font-['JetBrains_Mono',monospace] tabular-nums text-xs sm:text-sm min-w-0">
          <span className="font-bold text-[#f2d78f] whitespace-nowrap">
            {livePrice > 0 ? `$${livePrice.toFixed(2)}` : '—'}
          </span>

          <span
            className={`text-[11px] sm:text-xs font-semibold whitespace-nowrap ${
              isUp ? 'text-[#3fbf8f]' : 'text-[#e5584f]'
            }`}
          >
            {formatSignedDollar(dayChange)} ({isUp ? '+' : '–'}
            {Math.abs(dayChangePercent).toFixed(2)}%)
          </span>

          <div
            className="flex items-center gap-1.5 shrink-0"
            title={isMarketClosed ? 'Market closed · last price' : 'Live'}
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isMarketClosed ? 'bg-[#d9b25a]' : 'bg-[#3fbf8f]'
              }`}
            />
            {isMarketClosed && (
              <span className="text-[11px] text-[#9d947e] font-['DM_Sans',sans-serif] whitespace-nowrap">
                Market closed · last price
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 2) Chart Card */}
      <div className="p-3.5 sm:p-4 rounded-[12px] bg-[#12100c] border border-[#2b261b] space-y-3">
        {/* Controls Row (flex-wrap so all buttons remain visible without clipping) */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#2b261b]">
          {/* Timeframe Buttons: 15m, 30m, 1h, 4h with active zone count on that timeframe */}
          <div className="flex items-center gap-1 bg-[#1a1711] p-1 rounded-[8px] border border-[#2b261b] font-['JetBrains_Mono',monospace] text-xs">
            {ALL_TIMEFRAMES.map((tf) => {
              const activeZonesCount = zonesMap[tf]?.length ?? 0;
              const isSelected = selectedTf === tf;
              return (
                <button
                  key={tf}
                  onClick={() => setSelectedTf(tf)}
                  className={`px-2.5 py-1 rounded-[6px] transition-colors font-bold cursor-pointer flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-[#d9b25a] text-[#0a0907]'
                      : 'text-[#9d947e] hover:text-[#f0eadb]'
                  }`}
                >
                  <span>{tf}</span>
                  <span
                    className={`px-1 py-0.2 rounded text-[10px] tabular-nums ${
                      isSelected
                        ? 'bg-[#0a0907]/20 text-[#0a0907]'
                        : activeZonesCount > 0
                        ? 'bg-[#12100c] text-[#f2d78f] border border-[#d9b25a]/60'
                        : 'bg-[#12100c] text-[#9d947e]'
                    }`}
                    title={`Active zones on ${tf}: ${activeZonesCount}`}
                  >
                    {activeZonesCount}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Action Buttons: Zones, EMA 9, Trend filter, Retest confirm, Fit zones, Latest, Settings */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              onClick={() => setShowZones((prev) => !prev)}
              className={`px-2.5 py-1 rounded-[8px] border transition-colors cursor-pointer font-medium flex items-center gap-1 ${
                showZones
                  ? 'bg-[#1a1711] text-[#f2d78f] border-[#d9b25a]'
                  : 'bg-[#1a1711] text-[#9d947e] border-[#2b261b] hover:text-[#f0eadb]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Zones</span>
            </button>

            <button
              onClick={() => setShowEma9((prev) => !prev)}
              className={`px-2.5 py-1 rounded-[8px] border transition-colors cursor-pointer font-medium flex items-center gap-1 ${
                showEma9
                  ? 'bg-[#1a1711] text-[#f2d78f] border-[#d9b25a]'
                  : 'bg-[#1a1711] text-[#9d947e] border-[#2b261b] hover:text-[#f0eadb]'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>EMA 9</span>
            </button>

            <button
              type="button"
              onClick={() => setTrendFilter((prev) => !prev)}
              className={`px-2.5 py-1 rounded-[8px] border transition-colors cursor-pointer font-medium flex items-center gap-1 ${
                trendFilter
                  ? 'bg-[#1a1711] text-[#f2d78f] border-[#d9b25a]'
                  : 'bg-[#1a1711] text-[#9d947e] border-[#2b261b] hover:text-[#f0eadb]'
              }`}
              title="Trend filter: 15m/30m use 1h EMA21 + slope, 1h uses 4h EMA21 + slope, 4h no filter"
            >
              <span>Trend filter</span>
            </button>

            <button
              type="button"
              onClick={() => setRetestConfirm((prev) => !prev)}
              className={`px-2.5 py-1 rounded-[8px] border transition-colors cursor-pointer font-medium flex items-center gap-1 ${
                retestConfirm
                  ? 'bg-[#1a1711] text-[#f2d78f] border-[#d9b25a]'
                  : 'bg-[#1a1711] text-[#9d947e] border-[#2b261b] hover:text-[#f0eadb]'
              }`}
              title="Retest confirmation: require >=50% rejection wick on zone side or engulfing close away from zone"
            >
              <span>Retest confirm</span>
            </button>

            <button
              onClick={() => {
                setShowZones(true);
                setFitZonesTrigger((t) => t + 1);
              }}
              className="px-2.5 py-1 rounded-[8px] bg-[#1a1711] border border-[#2b261b] text-[#f0eadb] hover:border-[#d9b25a] transition-colors cursor-pointer font-medium flex items-center gap-1"
            >
              <Maximize2 className="w-3.5 h-3.5 text-[#d9b25a]" />
              <span>Fit zones</span>
            </button>

            <button
              onClick={() => setLatestTrigger((t) => t + 1)}
              className="px-2.5 py-1 rounded-[8px] bg-[#1a1711] border border-[#2b261b] text-[#f0eadb] hover:border-[#d9b25a] transition-colors cursor-pointer font-medium flex items-center gap-1"
            >
              <Clock className="w-3.5 h-3.5 text-[#d9b25a]" />
              <span>Latest</span>
            </button>

            <button
              onClick={() => setIsSettingsOpen((prev) => !prev)}
              className={`px-2.5 py-1 rounded-[8px] border transition-colors cursor-pointer font-medium flex items-center gap-1.5 ${
                isSettingsOpen
                  ? 'bg-[#1a1711] text-[#f2d78f] border-[#d9b25a]'
                  : 'bg-[#1a1711] text-[#9d947e] border-[#2b261b] hover:text-[#f0eadb]'
              }`}
              title="Settings"
            >
              <Settings className="w-3.5 h-3.5 text-[#d9b25a]" />
              <span>Settings</span>
            </button>
          </div>
        </div>

        {/* Collapsible Settings Panel */}
        {isSettingsOpen && (
          <div className="p-3.5 rounded-[10px] bg-[#1a1711] border border-[#2b261b] space-y-3.5 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-[#2b261b]">
              <div className="flex items-center gap-1.5 font-bold text-[#f2d78f] uppercase tracking-wider font-['JetBrains_Mono',monospace]">
                <Settings className="w-3.5 h-3.5" />
                <span>Settings</span>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="text-[11px] text-[#9d947e] hover:text-[#f0eadb] cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-['DM_Sans',sans-serif]">
              {/* Min strength */}
              <div className="p-2.5 rounded-[8px] bg-[#12100c] border border-[#2b261b] space-y-1.5">
                <div className="text-[11px] text-[#9d947e] font-medium">Min zone strength</div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.5}
                    value={minZoneStrength}
                    onChange={(e) => setMinZoneStrength(parseFloat(e.target.value))}
                    className="w-full accent-[#d9b25a]"
                  />
                  <span className="w-8 font-['JetBrains_Mono',monospace] font-bold text-[#f2d78f] tabular-nums text-right">
                    {minZoneStrength.toFixed(1)}
                  </span>
                </div>
              </div>

              {/* Show all zones switch */}
              <div className="p-2.5 rounded-[8px] bg-[#12100c] border border-[#2b261b] space-y-1.5">
                <div className="text-[11px] text-[#9d947e] font-medium">Zone visibility</div>
                <button
                  type="button"
                  onClick={() => setShowAllZones((prev) => !prev)}
                  className={`w-full py-1 px-2 rounded-[6px] border text-xs font-semibold cursor-pointer transition-colors flex items-center justify-between ${
                    showAllZones
                      ? 'bg-[#d9b25a]/15 text-[#f2d78f] border-[#d9b25a]'
                      : 'bg-[#1a1711] text-[#9d947e] border-[#2b261b] hover:text-[#f0eadb]'
                  }`}
                >
                  <span>{showAllZones ? 'Show all zones' : '3 nearest above/below'}</span>
                  <span className="text-[10px] px-1 py-0.2 rounded bg-[#0a0907] text-[#d9b25a] font-['JetBrains_Mono',monospace]">
                    {showAllZones ? 'ALL' : '3+3'}
                  </span>
                </button>
              </div>

              {/* Take Profit R-multiples */}
              <div className="p-2.5 rounded-[8px] bg-[#12100c] border border-[#2b261b] space-y-1.5 sm:col-span-2">
                <div className="text-[11px] text-[#9d947e] font-medium flex items-center justify-between">
                  <span>Take Profit R-multiples</span>
                  <span className="text-[10px] text-[#9d947e]">Risk cap: 2.5 * ATR</span>
                </div>
                <div className="grid grid-cols-3 gap-2 font-['JetBrains_Mono',monospace]">
                  <label className="flex items-center gap-1 bg-[#1a1711] px-2 py-1 rounded border border-[#2b261b]">
                    <span className="text-[10px] text-[#9d947e]">TP1:</span>
                    <input
                      type="number"
                      step={0.5}
                      min={0.5}
                      max={10}
                      value={tp1R}
                      onChange={(e) => setTp1R(parseFloat(e.target.value) || 1.0)}
                      className="w-full bg-transparent text-[#3fbf8f] font-bold text-xs focus:outline-none"
                    />
                    <span className="text-[10px] text-[#9d947e]">R</span>
                  </label>
                  <label className="flex items-center gap-1 bg-[#1a1711] px-2 py-1 rounded border border-[#2b261b]">
                    <span className="text-[10px] text-[#9d947e]">TP2:</span>
                    <input
                      type="number"
                      step={0.5}
                      min={0.5}
                      max={10}
                      value={tp2R}
                      onChange={(e) => setTp2R(parseFloat(e.target.value) || 2.0)}
                      className="w-full bg-transparent text-[#3fbf8f] font-bold text-xs focus:outline-none"
                    />
                    <span className="text-[10px] text-[#9d947e]">R</span>
                  </label>
                  <label className="flex items-center gap-1 bg-[#1a1711] px-2 py-1 rounded border border-[#2b261b]">
                    <span className="text-[10px] text-[#9d947e]">TP3:</span>
                    <input
                      type="number"
                      step={0.5}
                      min={0.5}
                      max={15}
                      value={tp3R}
                      onChange={(e) => setTp3R(parseFloat(e.target.value) || 3.0)}
                      className="w-full bg-transparent text-[#3fbf8f] font-bold text-xs focus:outline-none"
                    />
                    <span className="text-[10px] text-[#9d947e]">R</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Quick Backtest Section */}
            <div className="p-3 rounded-[8px] bg-[#12100c] border border-[#2b261b] space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-[#f0eadb]">
                    Backtest ({selectedTf})
                  </div>
                  <div className="text-[11px] text-[#9d947e]">
                    Runs over last 1000 candles with current filters (Trend: {trendFilter ? 'ON' : 'OFF'}, Confirm: {retestConfirm ? 'ON' : 'OFF'})
                  </div>
                </div>
                <button
                  type="button"
                  onClick={runQuickBacktest}
                  disabled={isBacktesting}
                  className="px-3 py-1.5 rounded-[6px] bg-[#d9b25a] text-[#0a0907] font-bold text-xs cursor-pointer hover:bg-[#e6c572] transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isBacktesting ? (
                    <>
                      <span className="w-3 h-3 border-2 border-[#0a0907] border-t-transparent rounded-full animate-spin" />
                      <span>Running...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3 fill-current" />
                      <span>Run backtest</span>
                    </>
                  )}
                </button>
              </div>

              {backtestError && (
                <div className="text-xs text-[#e5584f]">{backtestError}</div>
              )}

              {backtestResult && (
                <div className="p-2.5 rounded-[6px] bg-[#1a1711] border border-[#d9b25a]/40 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-['JetBrains_Mono',monospace] tabular-nums">
                  <div>
                    <div className="text-[10px] text-[#9d947e]">TOTAL TRADES</div>
                    <div className="text-sm font-bold text-[#f0eadb] mt-0.5">
                      {backtestResult.totalTrades}{' '}
                      <span className="text-[10px] text-[#9d947e] font-normal">
                        ({backtestResult.wins}W / {backtestResult.losses}L)
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#9d947e]">WIN RATE</div>
                    <div className="text-sm font-bold text-[#3fbf8f] mt-0.5">
                      {backtestResult.winRate.toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#9d947e]">AVERAGE R</div>
                    <div
                      className={`text-sm font-bold mt-0.5 ${
                        backtestResult.averageR >= 0 ? 'text-[#3fbf8f]' : 'text-[#e5584f]'
                      }`}
                    >
                      {backtestResult.averageR >= 0 ? '+' : ''}
                      {backtestResult.averageR.toFixed(2)} R
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#9d947e]">MAX DRAWDOWN</div>
                    <div className="text-sm font-bold text-[#e5584f] mt-0.5">
                      {backtestResult.maxDrawdown <= 0
                        ? `${backtestResult.maxDrawdown.toFixed(2)} R`
                        : `-${backtestResult.maxDrawdown.toFixed(2)} R`}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Diagnostics & Rejection counters in Settings */}
            <div className="pt-2 border-t border-[#2b261b]">
              <button
                type="button"
                onClick={() => setIsRejectionsDebugOpen((prev) => !prev)}
                className="w-full flex items-center justify-between text-left text-[#9d947e] hover:text-[#f0eadb] transition-colors cursor-pointer py-0.5 font-['JetBrains_Mono',monospace] text-[11px]"
              >
                <span>Rejection counters & diagnostics</span>
                <span className="flex items-center gap-1">
                  <span>{isRejectionsDebugOpen ? 'Hide' : 'Show'}</span>
                  {isRejectionsDebugOpen ? (
                    <ChevronUp className="w-3.5 h-3.5 text-[#d9b25a]" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-[#d9b25a]" />
                  )}
                </span>
              </button>

              {isRejectionsDebugOpen && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] text-[#9d947e] font-['JetBrains_Mono',monospace]">
                  {ALL_TIMEFRAMES.map((tf) => {
                    const st = tfStatsMap[tf];
                    const rej = st?.rejections || {
                      byBody: 0,
                      byWickSymmetry: 0,
                      byAtrRange: 0,
                      byRedOnly: 0,
                      byBreakCancel: 0,
                      byDistance8Atr: 0,
                      byMaxZonesCap: 0,
                    };
                    const blockedByTrend = st?.blockedByTrend ?? 0;
                    const blockedByConfirm = st?.blockedByConfirm ?? 0;
                    const mergedDojis = st?.mergedDojisCount ?? 0;
                    return (
                      <div
                        key={tf}
                        className="p-2 rounded-[6px] bg-[#12100c] border border-[#2b261b] leading-relaxed space-y-1"
                      >
                        <div>
                          <span className="text-[#f2d78f] font-bold">{tf}</span> · rejected by body: {rej.byBody} · wick symmetry: {rej.byWickSymmetry} · ATR range: {rej.byAtrRange} · break/cancel: {rej.byBreakCancel}
                        </div>
                        <div>
                          <span className="text-[#f0eadb] font-semibold">Setups blocked</span> · trend: {blockedByTrend} · confirm: {blockedByConfirm} · merged: {mergedDojis}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Chart */}
        {isLoadingCandles ? (
          <div className="h-[380px] w-full bg-[#0a0907] rounded-[8px] flex flex-col items-center justify-center text-[#9d947e] border border-[#2b261b] space-y-2">
            <span className="w-5 h-5 border-2 border-[#d9b25a] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-[#f2d78f]">Loading candles...</span>
          </div>
        ) : (
          <DojiChart
            bars={currentTfBars}
            timeframe={selectedTf}
            livePrice={livePrice}
            showZones={showZones}
            showEma9={showEma9}
            zones={currentTfZones}
            minZoneStrength={minZoneStrength}
            showAllZones={showAllZones}
            flaggedOpenTimeSecs={tfStatsMap[selectedTf]?.flaggedOpenTimeSecs}
            activeTrade={activeTrade}
            latestTrigger={latestTrigger}
            resetTrigger={resetTrigger}
            fitZonesTrigger={fitZonesTrigger}
            focusedZoneRequest={focusedZoneRequest}
          />
        )}
      </div>

      {/* 2b) Top Setups (up to 5 rows) */}
      <div className="p-3.5 sm:p-4 rounded-[12px] bg-[#12100c] border border-[#2b261b] space-y-2.5 font-['JetBrains_Mono',monospace] text-xs">
        <div className="flex items-center justify-between border-b border-[#2b261b] pb-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#d9b25a]" />
            <h2 className="text-sm sm:text-base font-bold text-[#f0eadb] font-['Bricolage_Grotesque',sans-serif]">
              Top setups
            </h2>
          </div>
          <span className="text-[11px] text-[#9d947e] font-['DM_Sans',sans-serif]">
            Tap row to focus zone
          </span>
        </div>

        {topSetups.length === 0 ? (
          <div className="py-4 text-center text-[#9d947e] text-xs font-['DM_Sans',sans-serif]">
            No setups found
          </div>
        ) : (
          <div className="divide-y divide-[#2b261b]/60">
            {topSetups.map(({ zone, state, side }) => {
              const isBuy = side === 'BUY';
              const isSelected = selectedTf === zone.timeframe;
              return (
                <div
                  key={zone.id}
                  onClick={() => handleZoneClick(zone)}
                  className={`py-2 px-2 -mx-2 rounded-[6px] hover:bg-[#1a1711] transition-colors cursor-pointer flex flex-wrap items-center justify-between gap-2 tabular-nums ${
                    isSelected ? 'bg-[#1a1711]/40' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded bg-[#12100c] border border-[#2b261b] text-[#f2d78f] text-[11px] font-bold shrink-0">
                      {zone.timeframe}
                    </span>
                    <span
                      className={`font-bold text-[11px] px-1.5 py-0.5 rounded border ${
                        isBuy
                          ? 'bg-[#3fbf8f]/10 text-[#3fbf8f] border-[#3fbf8f]/30'
                          : 'bg-[#e5584f]/10 text-[#e5584f] border-[#e5584f]/30'
                      }`}
                    >
                      {side}
                    </span>
                    <span className="text-[#f0eadb] font-semibold">
                      ${zone.low.toFixed(2)} – ${zone.high.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <span
                      className="font-bold text-[11px]"
                      style={{ color: zone.strengthColor }}
                    >
                      {zone.strength.toFixed(1)}/10
                    </span>

                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                        state === 'ready'
                          ? 'bg-[#3fbf8f]/20 text-[#3fbf8f] border-[#3fbf8f]'
                          : state === 'armed'
                          ? 'bg-[#d9b25a]/15 text-[#f2d78f] border-[#d9b25a]/50'
                          : 'bg-[#12100c] text-[#9d947e] border-[#2b261b]'
                      }`}
                    >
                      {state}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3) Active Signal Card */}
      <ActiveSignalCard
        trade={activeTrade}
        signal={activeSignal}
        activeTradesMap={activeTradesMap}
        onSelectTimeframe={(tf) => setSelectedTf(tf)}
        timeframe={selectedTf}
        livePrice={livePrice}
        zones={currentTfZones}
        allValidZones={allValidZones}
        isMarketClosed={isMarketClosed}
      />

      {/* 4) Valid Zones Card: 2-line zero-truncation layout, 12px mono */}
      <div className="p-4 rounded-[12px] bg-[#12100c] border border-[#2b261b] space-y-2.5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#2b261b] pb-2.5">
          <h2 className="text-base font-bold text-[#f0eadb] font-['Bricolage_Grotesque',sans-serif]">
            Valid zones
          </h2>
          <span className="text-xs text-[#9d947e] font-['JetBrains_Mono',monospace] tabular-nums">
            {allValidZones.length}
          </span>
        </div>

        <div className="space-y-1.5 overflow-hidden">
          {allValidZones.length === 0 ? (
            <div className="py-5 text-center text-[#9d947e] text-xs">
              No valid zones
            </div>
          ) : (
            allValidZones.map((zone) => {
              const isSelected = selectedTf === zone.timeframe;
              const isDistUp = zone.distancePts >= 0;
              const breakArrow = zone.breakDirection === 'UP' ? '▲' : '▼';
              const isBelowMinStrength = zone.strength < minZoneStrength;

              return (
                <div
                  key={zone.id}
                  onClick={() => handleZoneClick(zone)}
                  className={`px-2.5 py-2 rounded-[8px] bg-[#1a1711] border transition-colors cursor-pointer space-y-1 text-[12px] font-['JetBrains_Mono',monospace] tabular-nums ${
                    isSelected
                      ? 'border-[#d9b25a]'
                      : 'border-[#2b261b] hover:border-[#d9b25a]/60'
                  } ${isBelowMinStrength ? 'opacity-60' : ''}`}
                >
                  {/* Pehli line: [timeframe chip] time "23 Oct 18:45" · strength "8.0/10" (colored) · zone state ("waiting" | "armed ▼ since ..." | "used") */}
                  <div className="flex flex-wrap items-center gap-1.5 leading-snug">
                    <span className="px-1.5 py-0.5 rounded bg-[#12100c] border border-[#2b261b] text-[#f2d78f] text-[11px] font-semibold shrink-0">
                      {zone.timeframe}
                    </span>

                    <span className="text-[#f0eadb] whitespace-nowrap">
                      {zone.barTime}
                    </span>

                    <span className="text-[#9d947e]">·</span>

                    <span
                      className="font-bold whitespace-nowrap"
                      style={{ color: zone.strengthColor }}
                    >
                      {zone.strength.toFixed(1)}/10
                    </span>

                    <span className="text-[#9d947e]">·</span>

                    {zone.zoneState === 'used' ? (
                      <span className="px-1.5 py-0.2 rounded bg-[#12100c] border border-[#2b261b] text-[#9d947e] text-[11px] shrink-0">
                        used
                      </span>
                    ) : zone.zoneState === 'armed' ? (
                      <span className="px-1.5 py-0.2 rounded bg-[#12100c] border border-[#d9b25a]/50 text-[#f2d78f] text-[11px] shrink-0">
                        armed{' '}
                        <span
                          className={
                            zone.breakDirection === 'UP'
                              ? 'text-[#3fbf8f] font-bold'
                              : 'text-[#e5584f] font-bold'
                          }
                        >
                          {breakArrow}
                        </span>{' '}
                        since {zone.breakTimeDisplay}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.2 rounded bg-[#12100c] border border-[#2b261b] text-[#9d947e] text-[11px] shrink-0">
                        waiting
                      </span>
                    )}

                    {zone.isRetestLive && zone.retestLiveText && (
                      <>
                        <span className="text-[#9d947e]">·</span>
                        <span className="px-1.5 py-0.2 rounded bg-[#12100c] border border-[#d9b25a] text-[#f2d78f] text-[11px] font-bold shrink-0">
                          {zone.retestLiveText}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Doosri line: poora high / low · ▲ ya ▼ · current price se doori "+$5.27" · (if armed: "Waiting for retest to 4016.19 (+$9)") */}
                  <div className="flex flex-wrap items-center gap-1.5 leading-snug text-[#9d947e]">
                    <span className="text-[#f0eadb] font-semibold whitespace-nowrap">
                      {zone.high.toFixed(2)} / {zone.low.toFixed(2)}
                    </span>

                    {zone.breakDirection === 'UP' && (
                      <>
                        <span>·</span>
                        <span className="text-[#3fbf8f] font-bold">▲</span>
                      </>
                    )}
                    {zone.breakDirection === 'DOWN' && (
                      <>
                        <span>·</span>
                        <span className="text-[#e5584f] font-bold">▼</span>
                      </>
                    )}

                    <span>·</span>

                    <span
                      className={`font-semibold whitespace-nowrap ${
                        isDistUp ? 'text-[#e5584f]' : 'text-[#3fbf8f]'
                      }`}
                    >
                      {formatSignedDollar(zone.distancePts)}
                    </span>

                    {zone.zoneState === 'armed' && zone.retestLevel !== null && (
                      <>
                        <span>·</span>
                        <span className="text-[#f2d78f] whitespace-nowrap">
                          Waiting for retest to {zone.retestLevel.toFixed(2)} (
                          {formatRoundedSignedDollar(zone.retestDistancePts)})
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Per-timeframe diagnostic summary lines: "15m · 1000 bars (requested 1000) · N dojis · M valid" */}
        <div className="pt-2.5 border-t border-[#2b261b] grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-[#9d947e] font-['JetBrains_Mono',monospace] tabular-nums">
          {ALL_TIMEFRAMES.map((tf) => {
            const st = tfStatsMap[tf] || {
              timeframe: tf,
              barsCount: 0,
              requestedBars: 1000,
              dojisCount: 0,
              validCount: 0,
              redOnlyDojisCount: 0,
              redOnlyValidCount: 0,
            };
            const reqBars = st.requestedBars || 1000;

            return (
              <div key={tf} className="break-words leading-snug">
                {tf} · {st.barsCount} bars (requested {reqBars}) · {st.dojisCount} dojis · {st.validCount} valid
              </div>
            );
          })}
        </div>

        {/* Collapsible debug section: per-timeframe rejection counters & last 15 flagged doji times */}
        <div className="pt-2 border-t border-[#2b261b] text-[11px] font-['JetBrains_Mono',monospace] tabular-nums">
          <button
            type="button"
            onClick={() => setIsRejectionsDebugOpen((prev) => !prev)}
            className="w-full flex items-center justify-between text-left text-[#9d947e] hover:text-[#f0eadb] transition-colors cursor-pointer py-0.5"
          >
            <span>Rejection counters & diagnostics</span>
            <span className="flex items-center gap-1 text-[11px]">
              <span>{isRejectionsDebugOpen ? 'Hide' : 'Show'}</span>
              {isRejectionsDebugOpen ? (
                <ChevronUp className="w-3.5 h-3.5 text-[#d9b25a]" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-[#d9b25a]" />
              )}
            </span>
          </button>

          {isRejectionsDebugOpen && (
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] text-[#9d947e]">
              {ALL_TIMEFRAMES.map((tf) => {
                const st = tfStatsMap[tf];
                const rej = st?.rejections || {
                  byBody: 0,
                  byWickSymmetry: 0,
                  byAtrRange: 0,
                  byRedOnly: 0,
                  byBreakCancel: 0,
                  byDistance8Atr: 0,
                  byMaxZonesCap: 0,
                };
                const capLimit = st?.maxZonesPerTf ?? 50;
                const distLimit = st?.maxDistanceAtr ?? 0;
                const blockedByTrend = st?.blockedByTrend ?? 0;
                const blockedByConfirm = st?.blockedByConfirm ?? 0;
                const mergedDojis = st?.mergedDojisCount ?? 0;
                const last15Items = st?.last15FlaggedDojis || [];
                return (
                  <div
                    key={tf}
                    className="p-2 rounded-[6px] bg-[#1a1711] border border-[#2b261b] leading-relaxed space-y-1"
                  >
                    <div>
                      <span className="text-[#f2d78f] font-bold">{tf}</span> · rejected by body: {rej.byBody} · by wick symmetry: {rej.byWickSymmetry} · by ATR range: {rej.byAtrRange} · by red-only: {rej.byRedOnly} · by break/cancel: {rej.byBreakCancel} · by distance {distLimit > 0 ? `>${distLimit} ATR` : '(off)'}: {rej.byDistance8Atr} · by keep-last-{capLimit} cap: {rej.byMaxZonesCap ?? 0}
                    </div>
                    <div>
                      <span className="text-[#f0eadb] font-semibold">Setups blocked</span> · by trend filter: {blockedByTrend} · by retest confirm: {blockedByConfirm} · merged dojis: {mergedDojis}
                    </div>
                    <div className="text-[#c9bfa8] space-y-0.5">
                      <div className="font-semibold text-[#f0eadb]">
                        Last 15 flagged (Asia/Dubai):
                      </div>
                      {last15Items.length > 0 ? (
                        <div className="space-y-0.5">
                          {last15Items.map((item) => (
                            <div key={item.openTime} className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[#f0eadb]">{item.barTime}</span>
                              <span>·</span>
                              <span>
                                H {item.high.toFixed(2)} / L {item.low.toFixed(2)}
                              </span>
                              <span>·</span>
                              <span
                                className={
                                  item.status === 'waiting' || item.status === 'armed'
                                    ? 'text-[#3fbf8f] font-semibold'
                                    : 'text-[#9d947e]'
                                }
                              >
                                {item.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div>none</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Trade Log */}
      <TradeLogSection trades={allTrades} livePrice={livePrice} />
    </div>
  );
};

