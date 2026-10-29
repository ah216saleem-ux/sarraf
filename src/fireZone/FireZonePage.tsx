// src/fireZone/FireZonePage.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { useFireZoneFeed } from './feed';
import { buildChartModel } from './engine';
import { FireZoneSignalCard, FireZoneGatesSection } from './FireZoneSignalAndGates';
import { FireZoneChart } from './FireZoneChart';
import {
  FireZoneNearestCard,
  FireZoneOtherZonesList,
  FireZoneEventCard,
} from './FireZoneCards';
import { FireZoneLadder } from './FireZoneLadder';
import { FireZoneBacktestCard } from './FireZoneBacktestCard';
import { FireZoneLearnTab, FireZoneRiskTab } from './FireZoneLearnAndRisk';

type FireZoneSubTab = 'DESK' | 'LEARN' | 'RISK';

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

function formatUtcSnapshot(date: Date): string {
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export const FireZonePage: React.FC = () => {
  const {
    candles,
    dataReloadSeq,
    currentPrice,
    isMarketOpen,
    connectionStatus,
    isLoading,
    engineResult,
    backtestResult,
    refetch,
  } = useFireZoneFeed();

  const [subTab, setSubTab] = useState<FireZoneSubTab>('DESK');
  const [utcTime, setUtcTime] = useState<string>(() => formatUtcSnapshot(new Date()));

  const chartModel = useMemo(() => buildChartModel(engineResult), [engineResult]);

  useEffect(() => {
    setUtcTime(formatUtcSnapshot(new Date()));
    const timer = setInterval(() => {
      setUtcTime(formatUtcSnapshot(new Date()));
    }, 15000);
    return () => clearInterval(timer);
  }, [currentPrice]);

  const isLive = isMarketOpen && connectionStatus === 'LIVE';

  return (
    <div
      className="w-full min-h-screen overflow-x-hidden fz-page-scope"
      style={
        {
          '--bg': '#07090d',
          '--card': '#0d1117',
          '--bd': '#1a212b',
          '--tx': '#eef1f6',
          '--mu': '#7e8794',
          '--gold': '#f2b94b',
          '--up': '#2fe08a',
          '--dn': '#ff4d66',
          '--cy': '#5ee2ea',
          backgroundColor: 'var(--bg)',
          color: 'var(--tx)',
          fontFamily: "'Manrope', sans-serif",
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
        } as React.CSSProperties
      }
    >
      <style>{`
        @keyframes fzNowPulse {
          0%, 100% { box-shadow: 0 0 10px rgba(242, 185, 75, 0.18); }
          50% { box-shadow: 0 0 22px rgba(242, 185, 75, 0.45); }
        }
        @keyframes fzFadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fz-now-pulse {
          animation: fzNowPulse 2s ease-in-out infinite;
        }
        .fz-fade-up {
          animation: fzFadeUp 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
      `}</style>

      <div className="w-full max-w-[560px] mx-auto px-3 py-3">
        {/* 1. Header row: 34px square logo + FIRE ZONE + GOLD SWING TRADE RADAR + status pill */}
        <header className="w-full flex items-center justify-between gap-2 py-1 fz-fade-up">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center shrink-0 select-none"
              style={{
                backgroundColor: 'rgba(242, 185, 75, 0.12)',
                border: '1px solid var(--gold)',
                fontSize: '17px',
              }}
            >
              🔥
            </div>

            <div className="min-w-0">
              <div
                style={{
                  fontSize: '15px',
                  fontWeight: 800,
                  letterSpacing: '0.16em',
                  color: 'var(--tx)',
                  lineHeight: 1.15,
                  whiteSpace: 'nowrap',
                }}
              >
                FIRE ZONE
              </div>
              <div
                style={{
                  fontSize: '9px',
                  fontWeight: 800,
                  letterSpacing: '0.2em',
                  color: 'var(--gold)',
                  lineHeight: 1.25,
                  whiteSpace: 'nowrap',
                }}
              >
                GOLD SWING TRADE RADAR
              </div>
            </div>
          </div>

          {/* Right side: status pill (green filled "LIVE" when feed works, gold outlined "OFFLINE" otherwise) */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider"
              style={
                isLive
                  ? {
                      ...monoStyle,
                      backgroundColor: 'var(--up)',
                      color: '#07090d',
                      border: '1px solid var(--up)',
                    }
                  : {
                      ...monoStyle,
                      backgroundColor: 'transparent',
                      color: 'var(--gold)',
                      border: '1px solid var(--gold)',
                    }
              }
            >
              {isLive ? 'LIVE' : 'OFFLINE'}
            </span>

            <button
              type="button"
              onClick={() => refetch()}
              disabled={isLoading}
              title="Refresh market data"
              className="p-1.5 rounded-[9px] transition-colors cursor-pointer disabled:opacity-50"
              style={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--bd)',
                color: 'var(--mu)',
              }}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#f2b94b]' : ''}`}
              />
            </button>
          </div>
        </header>

        {/* Sub-tab switcher: DESK / LEARN / RISK */}
        <div
          className="mt-2.5 flex items-center gap-1 p-1 rounded-[12px] fz-fade-up"
          style={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--bd)',
          }}
        >
          {(['DESK', 'LEARN', 'RISK'] as FireZoneSubTab[]).map((tab) => {
            const active = subTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setSubTab(tab)}
                className="flex-1 py-1.5 rounded-[8px] text-[11px] font-extrabold tracking-wider transition-all cursor-pointer"
                style={
                  active
                    ? {
                        ...monoStyle,
                        backgroundColor: 'var(--gold)',
                        color: '#07090d',
                      }
                    : {
                        ...monoStyle,
                        color: 'var(--mu)',
                      }
                }
              >
                {tab}
              </button>
            );
          })}
        </div>

        {/* OFFLINE Banner if feed unreachable */}
        {connectionStatus === 'OFFLINE' && (
          <div
            className="mt-[11px] p-3 rounded-[14px] flex items-center justify-between gap-3 text-xs"
            style={{
              backgroundColor: 'rgba(242, 185, 75, 0.08)',
              border: '1px solid rgba(242, 185, 75, 0.35)',
              color: 'var(--gold)',
            }}
          >
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 shrink-0" style={{ color: 'var(--gold)' }} />
              <span>
                Market feed is currently OFFLINE. Showing last real received data — never synthetic candles.
              </span>
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="px-2.5 py-1 rounded-lg font-bold cursor-pointer shrink-0"
              style={{
                ...monoStyle,
                backgroundColor: 'rgba(242, 185, 75, 0.16)',
                border: '1px solid var(--gold)',
                color: 'var(--tx)',
              }}
            >
              RETRY
            </button>
          </div>
        )}

        {/* SUB-TAB CONTENT */}
        {subTab === 'LEARN' ? (
          <FireZoneLearnTab />
        ) : subTab === 'RISK' ? (
          <FireZoneRiskTab activePlan={engineResult.activePlan} />
        ) : (
          /* DESK TAB */
          <div>
            {/* Blocks 2-5: Hero Live Price + Decision Engine + Fusion Confidence + Engine Health */}
            <FireZoneSignalCard
              gateEval={engineResult.gateEval}
              currentPrice={currentPrice}
              snapshotUtc={utcTime}
            />

            {/* Two Setup Cards: BUY SETUP first, then SELL SETUP */}
            <div>
              <FireZoneNearestCard
                side="BUY"
                plan={engineResult.buyNearestPlan}
                isActive={engineResult.activeSide === 'BUY'}
                currentPrice={currentPrice}
              />
              <FireZoneNearestCard
                side="SELL"
                plan={engineResult.sellNearestPlan}
                isActive={engineResult.activeSide === 'SELL'}
                currentPrice={currentPrice}
              />
            </div>

            {/* Chart Card (with 15m/30m/1H/4H/1D candle buttons, zones locked to H1) */}
            <FireZoneChart
              candles={candles}
              dataReloadSeq={dataReloadSeq}
              engineResult={engineResult}
              chartModel={chartModel}
              currentPrice={currentPrice}
              isLoading={isLoading}
            />

            {/* ZONE LADDER (sorted highest to lowest, sliding MARKET NOW row) */}
            <FireZoneLadder
              chartModel={chartModel}
              sellPlan={engineResult.sellNearestPlan}
              buyPlan={engineResult.buyNearestPlan}
              ladder={chartModel.ladder}
              currentPrice={currentPrice}
              dataReloadSeq={dataReloadSeq}
            />

            {/* WHY ENTRY IS BLOCKED card + EXECUTION SAFETY GATES card */}
            <FireZoneGatesSection gateEval={engineResult.gateEval} />

            {/* OTHER ZONES list (compact rows for SWING and DEEP) */}
            <FireZoneOtherZonesList
              buyZones={engineResult.buyZones}
              sellZones={engineResult.sellZones}
            />

            {/* LEVEL EVENTS card (latest event sentence + collapsible history of last 10 retired zones) */}
            <FireZoneEventCard
              latestLevelEvent={engineResult.latestLevelEvent}
              retiredHistory={engineResult.retiredHistory}
            />

            {/* BACKTEST card */}
            <FireZoneBacktestCard backtest={backtestResult} />
          </div>
        )}

        {/* D) FOOTER */}
        <footer
          className="mt-4 pt-3 pb-4 text-center text-xs border-t"
          style={{ color: 'var(--mu)', borderColor: 'var(--bd)' }}
        >
          Fire Zone - gold swing radar - research tool, not trading advice. Yeh analysis hai, signal nahi. Educational use only.
        </footer>
      </div>
    </div>
  );
};

export default FireZonePage;
