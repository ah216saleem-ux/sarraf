// src/doji/SarrafDojiView.tsx
import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Clock,
  Layers,
  Activity,
  Sliders,
  Filter,
  Maximize2,
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
  const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(false);

  const {
    currentTfBars,
    livePrice,
    dayChange,
    dayChangePercent,
    isMarketClosed,
    isLoadingCandles,
    redOnly,
    setRedOnly,
    tfStatsMap,
    allValidZones,
    currentTfZones,
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
          {/* Timeframe Buttons: 15m, 30m, 1h, 4h with open trade count (Gold fill ONLY on selected timeframe button) */}
          <div className="flex items-center gap-1 bg-[#1a1711] p-1 rounded-[8px] border border-[#2b261b] font-['JetBrains_Mono',monospace] text-xs">
            {ALL_TIMEFRAMES.map((tf) => {
              const openCount = activeTradesMap[tf]?.status === 'OPEN' ? 1 : 0;
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
                        : openCount > 0
                        ? 'bg-[#12100c] text-[#f2d78f] border border-[#d9b25a]/60'
                        : 'bg-[#12100c] text-[#9d947e]'
                    }`}
                    title={`Open trades on ${tf}: ${openCount}`}
                  >
                    {openCount}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Action Buttons: Zones, EMA 9, Red only, Fit zones, Latest, Reset view */}
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
              onClick={() => setRedOnly((prev) => !prev)}
              className={`px-2.5 py-1 rounded-[8px] border transition-colors cursor-pointer font-medium flex items-center gap-1 ${
                redOnly
                  ? 'bg-[#1a1711] text-[#f2d78f] border-[#d9b25a]'
                  : 'bg-[#1a1711] text-[#9d947e] border-[#2b261b] hover:text-[#f0eadb]'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Red only</span>
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
              onClick={() => {
                setShowZones(true);
                setShowEma9(true);
                setResetTrigger((t) => t + 1);
              }}
              className="px-2.5 py-1 rounded-[8px] bg-[#1a1711] border border-[#2b261b] text-[#f0eadb] hover:border-[#d9b25a] transition-colors cursor-pointer font-medium flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#9d947e]" />
              <span>Reset view</span>
            </button>
          </div>
        </div>

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
            activeTrade={activeTrade}
            latestTrigger={latestTrigger}
            resetTrigger={resetTrigger}
            fitZonesTrigger={fitZonesTrigger}
            focusedZoneRequest={focusedZoneRequest}
          />
        )}
      </div>

      {/* 3) Active Signal Card */}
      <ActiveSignalCard
        trade={activeTrade}
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

              return (
                <div
                  key={zone.id}
                  onClick={() => handleZoneClick(zone)}
                  className={`px-2.5 py-2 rounded-[8px] bg-[#1a1711] border transition-colors cursor-pointer space-y-1 text-[12px] font-['JetBrains_Mono',monospace] tabular-nums ${
                    isSelected
                      ? 'border-[#d9b25a]'
                      : 'border-[#2b261b] hover:border-[#d9b25a]/60'
                  }`}
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
                        isDistUp ? 'text-[#3fbf8f]' : 'text-[#e5584f]'
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
            const dojisDelta = !redOnly ? st.dojisCount - (st.redOnlyDojisCount ?? st.dojisCount) : 0;
            const validDelta = !redOnly ? st.validCount - (st.redOnlyValidCount ?? st.validCount) : 0;

            return (
              <div key={tf} className="break-words leading-snug">
                {tf} · {st.barsCount} bars (requested {reqBars}) · {st.dojisCount} dojis
                {dojisDelta > 0 ? ` (+${dojisDelta})` : ''} · {st.validCount} valid
                {validDelta > 0 ? ` (+${validDelta})` : ''}
              </div>
            );
          })}
        </div>
      </div>

      {/* 5) Advanced (Collapsible) */}
      <div className="rounded-[12px] bg-[#12100c] border border-[#2b261b] overflow-hidden">
        <button
          onClick={() => setIsAdvancedOpen((prev) => !prev)}
          className="w-full p-4 flex items-center justify-between text-left cursor-pointer hover:bg-[#1a1711]/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#d9b25a]" />
            <span className="text-base font-bold text-[#f0eadb] font-['Bricolage_Grotesque',sans-serif]">
              Advanced
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#9d947e]">
            <span>{isAdvancedOpen ? 'Hide' : 'Show'}</span>
            {isAdvancedOpen ? (
              <ChevronUp className="w-4 h-4 text-[#d9b25a]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[#d9b25a]" />
            )}
          </div>
        </button>

        {isAdvancedOpen && (
          <div className="p-4 pt-0 border-t border-[#2b261b] space-y-3 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-3">
              <div className="p-2.5 rounded-[8px] bg-[#1a1711] border border-[#2b261b]">
                <div className="text-[10px] text-[#9d947e]">CANDLE FILTER</div>
                <div className="text-sm font-bold text-[#f2d78f] mt-0.5 font-['JetBrains_Mono',monospace]">
                  {redOnly ? 'Red only' : 'All'}
                </div>
              </div>
              <div className="p-2.5 rounded-[8px] bg-[#1a1711] border border-[#2b261b]">
                <div className="text-[10px] text-[#9d947e]">VALID ZONES</div>
                <div className="text-sm font-bold text-[#f0eadb] mt-0.5 font-['JetBrains_Mono',monospace] tabular-nums">
                  {allValidZones.length}
                </div>
              </div>
              <div className="p-2.5 rounded-[8px] bg-[#1a1711] border border-[#2b261b]">
                <div className="text-[10px] text-[#9d947e]">EMA 9</div>
                <div className="text-sm font-bold text-[#d9b25a] mt-0.5 font-['JetBrains_Mono',monospace]">
                  {showEma9 ? 'Shown' : 'Hidden'}
                </div>
              </div>
              <div className="p-2.5 rounded-[8px] bg-[#1a1711] border border-[#2b261b]">
                <div className="text-[10px] text-[#9d947e]">TIMEZONE</div>
                <div className="text-sm font-bold text-[#f0eadb] mt-0.5 font-['JetBrains_Mono',monospace]">
                  GMT+4
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 6) Trade Log */}
      <TradeLogSection trades={allTrades} livePrice={livePrice} />
    </div>
  );
};

