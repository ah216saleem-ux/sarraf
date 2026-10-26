import React, { useState, useEffect, useCallback } from 'react';
import { useCommandFeed } from '../command/data/useCommandFeed';
import { useMarket } from '../context/MarketContext';
import { BlackstoneZoneChart, BlackstoneCandle } from './BlackstoneZoneChart';
import { BlackstoneLivePlanCard } from './BlackstoneLivePlanCard';
import { BlackstoneNewsBand } from './BlackstoneNewsBand';
import { BlackstoneTapeView } from './BlackstoneTapeView';
import { BlackstoneZoneRecordView } from './BlackstoneZoneRecordView';
import { BlackstoneBacktestView } from './BlackstoneBacktestView';
import type {
  BlackstoneStatePayload,
  BlackstoneEvaluatedZone,
  BlackstoneZoneId,
  BlackstoneZoneGrade,
  BlackstoneRetiredZoneRecord,
  BlackstoneRefCategory,
  BlackstoneReferenceLevelItem,
} from '../server/blackstoneEngine';

type BlackstoneTab = 'ZONES' | 'DAILY LOCK' | 'TAPE' | 'ZONE RECORD' | 'BACKTEST';
type BlackstoneTimeframe = 'M5' | 'M15' | 'H1';

const REF_CHIP_GROUPS: Array<{ id: BlackstoneRefCategory; label: string; color: string }> = [
  { id: 'DAY', label: 'Day', color: '#d9b25a' },
  { id: 'CAMARILLA', label: 'Camarilla', color: '#a78bfa' },
  { id: 'PROFILE', label: 'Profile', color: '#38bdf8' },
  { id: 'ADR', label: 'ADR', color: '#f59e0b' },
];

const INNER_TABS: Array<{ id: BlackstoneTab; label: string }> = [
  { id: 'ZONES', label: 'Zones' },
  { id: 'DAILY LOCK', label: 'Daily lock' },
  { id: 'TAPE', label: 'Tape' },
  { id: 'ZONE RECORD', label: 'Zone record' },
  { id: 'BACKTEST', label: 'Backtest' },
];

const cardStyle: React.CSSProperties = {
  backgroundColor: '#0b0b0e',
  border: '1px solid #1f1d18',
  fontFamily: "'DM Sans', sans-serif",
};

const innerBoxStyle: React.CSSProperties = {
  backgroundColor: '#12110e',
  border: '1px solid #26231c',
};

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

function formatDubaiClock(date: Date): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dubai',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    const dubaiMs = date.getTime() + 4 * 60 * 60 * 1000;
    const d = new Date(dubaiMs);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
}

function formatCountdownFromIso(targetIso: string | undefined, fallbackSec: number): string {
  if (targetIso) {
    const diffSec = Math.max(0, Math.floor((new Date(targetIso).getTime() - Date.now()) / 1000));
    const hh = String(Math.floor(diffSec / 3600)).padStart(2, '0');
    const mm = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
    const ss = String(diffSec % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  const s = Math.max(0, Math.floor(fallbackSec));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const GradeChip: React.FC<{ grade: BlackstoneZoneGrade; score?: number }> = ({
  grade,
  score,
}) => {
  const isGradeA = grade === 'A';
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] text-[10.5px] font-bold"
      style={
        isGradeA
          ? {
              backgroundColor: 'rgba(217, 178, 90, 0.14)',
              border: '1px solid rgba(217, 178, 90, 0.45)',
              color: '#f2d78f',
              ...monoStyle,
            }
          : {
              backgroundColor: '#161511',
              border: '1px solid #2b271e',
              color: '#8e8779',
              ...monoStyle,
            }
      }
    >
      <span>{grade}</span>
      {score !== undefined && (
        <span className="text-[10px] font-medium opacity-85 tabular-nums">{score}</span>
      )}
    </span>
  );
};

export const BlackstoneView: React.FC = () => {
  const feed = useCommandFeed();
  const { priceData, user } = useMarket();
  const [activeTab, setActiveTab] = useState<BlackstoneTab>('ZONES');
  const [timeframe, setTimeframe] = useState<BlackstoneTimeframe>('M15');
  const [serverState, setServerState] = useState<BlackstoneStatePayload | null>(null);
  const [candles, setCandles] = useState<BlackstoneCandle[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<BlackstoneZoneId | null>(null);
  const [focusSeq, setFocusSeq] = useState<number>(0);
  const [dubaiTime, setDubaiTime] = useState<string>(() => formatDubaiClock(new Date()));
  const [countdownText, setCountdownText] = useState<string>('00:00:00');
  const [activeRefGroups, setActiveRefGroups] = useState<Record<BlackstoneRefCategory, boolean>>({
    DAY: true,
    CAMARILLA: true,
    PROFILE: true,
    ADR: true,
  });

  const toggleRefGroup = useCallback((group: BlackstoneRefCategory) => {
    setActiveRefGroups((prev) => ({
      ...prev,
      [group]: !prev[group],
    }));
  }, []);

  const handleFocusZone = useCallback((id: BlackstoneZoneId) => {
    setSelectedZoneId(id);
    setFocusSeq((prev) => prev + 1);
  }, []);

  const fetchServerState = useCallback(async () => {
    try {
      const savedToken =
        typeof window !== 'undefined' ? localStorage.getItem('sarraf_session_token') : null;
      const headers: Record<string, string> = savedToken
        ? { 'x-sarraf-session': savedToken }
        : {};
      const res = await fetch('/api/blackstone/state', {
        headers,
        credentials: 'include',
      });
      if (!res.ok) return;
      const data: BlackstoneStatePayload = await res.json();
      setServerState(data);
    } catch {
      // ignore transient network errors
    }
  }, []);

  const fetchCandles = useCallback(async (tf: BlackstoneTimeframe) => {
    try {
      const res = await fetch(`/api/blackstone/candles?tf=${tf}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.candles)) {
        setCandles(data.candles);
      }
    } catch {
      // ignore transient network errors
    }
  }, []);

  const handlePinZone = useCallback(
    async (mode: 'AUTO' | 'MANUAL', zoneId?: BlackstoneZoneId | null) => {
      try {
        const savedToken =
          typeof window !== 'undefined' ? localStorage.getItem('sarraf_session_token') : null;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(savedToken ? { 'x-sarraf-session': savedToken } : {}),
        };
        await fetch('/api/blackstone/plan/pin', {
          method: 'POST',
          headers,
          body: JSON.stringify({ mode, zoneId }),
        });
        fetchServerState();
      } catch {
        // ignore transient network errors
      }
    },
    [fetchServerState]
  );

  useEffect(() => {
    fetchServerState();
    const poll = setInterval(fetchServerState, 5000);
    return () => clearInterval(poll);
  }, [fetchServerState, user]);

  useEffect(() => {
    fetchCandles(timeframe);
    const poll = setInterval(() => fetchCandles(timeframe), 10000);
    return () => clearInterval(poll);
  }, [timeframe, fetchCandles]);

  useEffect(() => {
    const tickClock = () => {
      setDubaiTime(formatDubaiClock(new Date()));
      if (serverState) {
        setCountdownText(
          formatCountdownFromIso(
            serverState.nextLockIso,
            serverState.nextLockCountdownSeconds
          )
        );
      }
    };
    tickClock();
    const interval = setInterval(tickClock, 1000);
    return () => clearInterval(interval);
  }, [serverState]);

  const isMarketClosed =
    feed.connection.status === 'MARKET_CLOSED' ||
    priceData.status === 'MARKET_CLOSED' ||
    serverState?.marketStatus === 'MARKET_CLOSED';

  const isFeedLive =
    !isMarketClosed &&
    feed.connection.status === 'LIVE' &&
    feed.hasReceivedTick &&
    feed.currentPrice > 0;

  const fallbackCandleClose =
    candles.length > 0 ? candles[candles.length - 1].close : null;
  const effectiveLivePrice = isFeedLive
    ? feed.currentPrice
    : feed.currentPrice > 0
      ? feed.currentPrice
      : fallbackCandleClose;

  const zones: BlackstoneEvaluatedZone[] = serverState?.zones || [];
  const retiredZones: BlackstoneRetiredZoneRecord[] = serverState?.retiredZones || [];
  const activeVisibleZones = serverState?.visibleZones || zones;

  const selectedZone =
    activeVisibleZones.find((z) => z.id === selectedZoneId) ||
    activeVisibleZones[0] ||
    zones.find((z) => z.id === selectedZoneId) ||
    zones[0] ||
    null;

  // Order Level Map rows by price descending (sell side above, buy side below)
  const sortedLevelMapZones = [...activeVisibleZones].sort((a, b) => b.level - a.level);
  const sellSideZones = sortedLevelMapZones.filter((z) => z.side === 'sell side');
  const buySideZones = sortedLevelMapZones.filter((z) => z.side === 'buy side');

  const dayState = serverState?.dayState;
  const adrState = serverState?.adrState;
  const allReferenceLevels: BlackstoneReferenceLevelItem[] = serverState?.referenceLevels || [];
  const filteredReferenceLevels = allReferenceLevels.filter(
    (item) => activeRefGroups[item.category]
  );

  const renderLevelMapRow = (z: BlackstoneEvaluatedZone) => {
    const isSelected = selectedZone?.id === z.id;
    const isBuy = z.side === 'buy side';
    const isCore = Boolean(z.isSarrafCore || z.id === 'SARRAF_CORE');
    const sideColor = isBuy ? '#3fbf8f' : '#e5584f';
    const statusText = z.touches > 0 ? 'TESTED' : 'FRESH';

    return (
      <button
        key={z.id}
        type="button"
        onClick={() => handleFocusZone(z.id)}
        className="relative w-full text-left px-3.5 py-2.5 rounded-[10px] transition-colors cursor-pointer overflow-hidden flex flex-col gap-1"
        style={
          isSelected
            ? {
                backgroundColor: isBuy
                  ? 'rgba(63, 191, 143, 0.08)'
                  : 'rgba(229, 88, 79, 0.08)',
                border: `1px solid ${sideColor}`,
              }
            : {
                backgroundColor: '#12110e',
                border: '1px solid #26231c',
              }
        }
      >
        {/* Cyan left accent bar for Sarraf Core */}
        {isCore && (
          <span
            className="absolute left-0 top-0 bottom-0 w-[3.5px]"
            style={{ backgroundColor: '#38bdf8' }}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Left: Name + Sarraf Core + Grade + Side */}
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: sideColor }}
            />
            <span className="text-sm font-bold text-[#f4efe6]">{z.name}</span>
            {isCore && (
              <span
                className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold uppercase"
                style={{
                  backgroundColor: 'rgba(56, 189, 248, 0.12)',
                  border: '1px solid rgba(56, 189, 248, 0.45)',
                  color: '#38bdf8',
                  ...monoStyle,
                }}
              >
                Core
              </span>
            )}
            <GradeChip grade={z.grade} score={z.score} />
            <span
              className="text-[11px] font-semibold uppercase"
              style={{ color: sideColor }}
            >
              {z.side}
            </span>
          </div>

          {/* Right: Range, Status, Distance */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <span
              className="font-semibold text-[#f4efe6] tabular-nums"
              style={monoStyle}
            >
              {z.low.toFixed(2)} – {z.high.toFixed(2)}
            </span>

            <span
              className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold uppercase"
              style={
                z.touches > 0
                  ? {
                      backgroundColor: 'rgba(217, 178, 90, 0.12)',
                      color: '#d9b25a',
                      ...monoStyle,
                    }
                  : {
                      backgroundColor: 'rgba(63, 191, 143, 0.12)',
                      color: '#3fbf8f',
                      ...monoStyle,
                    }
              }
            >
              {statusText}
            </span>

            <span
              className="font-bold tabular-nums min-w-[52px] text-right"
              style={{ ...monoStyle, color: sideColor }}
            >
              {z.distanceFormatted}
            </span>
          </div>
        </div>
      </button>
    );
  };

  return (
    <div
      className="relative w-full min-h-screen overflow-x-hidden rounded-[14px] p-2.5 sm:p-4 space-y-3.5"
      style={{
        backgroundColor: '#050507',
        color: '#f4efe6',
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {/* 1. HERO CARD: Pure black premium theme with subtle gold gradient on price and thin gold-tinted border */}
      <header
        className="w-full rounded-[12px] px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-4"
        style={{
          backgroundColor: '#0b0b0e',
          border: '1px solid #262219',
          boxShadow: 'inset 0 1px 0 rgba(217, 178, 90, 0.14)',
        }}
      >
        {/* Left: XAUUSD spot gold + status + gold gradient price */}
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium tracking-wide text-[#8e8779]">
              XAUUSD · Spot Gold
            </span>
            {isMarketClosed ? (
              <span
                className="px-2 py-0.5 rounded-[5px] text-[10px] font-bold uppercase tracking-wider"
                style={{
                  backgroundColor: 'rgba(217, 178, 90, 0.12)',
                  border: '1px solid rgba(217, 178, 90, 0.35)',
                  color: '#d9b25a',
                  ...monoStyle,
                }}
              >
                MARKET CLOSED
              </span>
            ) : !isFeedLive ? (
              <span
                className="px-2 py-0.5 rounded-[5px] text-[10px] font-bold uppercase tracking-wider"
                style={{
                  backgroundColor: '#161511',
                  border: '1px solid #2b271e',
                  color: '#8e8779',
                  ...monoStyle,
                }}
              >
                LAST PRICE
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] text-[10px] font-bold uppercase tracking-wider"
                style={{
                  backgroundColor: 'rgba(63, 191, 143, 0.12)',
                  border: '1px solid rgba(63, 191, 143, 0.4)',
                  color: '#3fbf8f',
                  ...monoStyle,
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#3fbf8f]" />
                <span>LIVE</span>
              </span>
            )}
          </div>

          <div
            className="text-[34px] sm:text-[44px] font-bold leading-none tracking-tight tabular-nums"
            style={{
              ...monoStyle,
              backgroundImage:
                'linear-gradient(180deg, #fffdf8 0%, #f3dfb2 52%, #d9b25a 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              color: '#f2d78f',
            }}
          >
            {effectiveLivePrice !== null ? effectiveLivePrice.toFixed(2) : '—'}
          </div>
        </div>

        {/* Right: Dubai time, Zones locked 04:00, Source Ahmad server */}
        <div className="flex flex-wrap items-center gap-3.5 sm:gap-5">
          <div className="flex flex-col">
            <span className="text-[11px] text-[#8e8779]">Dubai time</span>
            <span
              className="text-xs sm:text-sm font-semibold text-[#f4efe6] tabular-nums"
              style={monoStyle}
            >
              {dubaiTime}
            </span>
          </div>

          <div
            className="flex flex-col pl-3.5"
            style={{ borderLeft: '1px solid #1f1d18' }}
          >
            <span className="text-[11px] text-[#8e8779]">Zones locked</span>
            <span
              className="text-xs sm:text-sm font-semibold text-[#d9b25a] tabular-nums"
              style={monoStyle}
            >
              04:00
            </span>
          </div>

          <div
            className="flex flex-col pl-3.5"
            style={{ borderLeft: '1px solid #1f1d18' }}
          >
            <span className="text-[11px] text-[#8e8779]">Source</span>
            <span className="text-xs sm:text-sm font-semibold text-[#f4efe6]">
              Ahmad server
            </span>
          </div>
        </div>
      </header>

      {/* 2. NAVIGATION TABS: Gold accent on active tab */}
      <nav
        className="flex items-center gap-1 overflow-x-auto pb-1"
        style={{ borderBottom: '1px solid #1f1d18' }}
      >
        {INNER_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-3 py-2 rounded-[8px] text-xs sm:text-sm font-semibold transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                isActive
                  ? 'bg-[#d9b25a] text-[#090806] font-bold'
                  : 'text-[#8e8779] hover:text-[#f4efe6]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* 3. NEWS BAND */}
      <BlackstoneNewsBand news={serverState?.plan?.news} />

      {/* 4. ZONES TAB */}
      {activeTab === 'ZONES' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
          {/* LEFT COLUMN: Chart + Level Map */}
          <div className="lg:col-span-7 space-y-3.5 min-w-0">
            <BlackstoneZoneChart
              candles={candles}
              zones={activeVisibleZones}
              selectedZoneId={selectedZone?.id || null}
              onSelectZone={(id) => handleFocusZone(id)}
              timeframe={timeframe}
              onChangeTimeframe={(tf) => setTimeframe(tf)}
              lockTimeIso={serverState?.lockTimeIso || ''}
              openTimeIso={serverState?.openTimeIso || ''}
              livePrice={effectiveLivePrice}
              isFeedLive={isFeedLive}
              isMarketClosed={isMarketClosed}
              activeTrade={serverState?.plan?.activeTrade}
              newsPauseNotice={serverState?.plan?.news?.pauseNoticeText}
              focusSeq={focusSeq}
              referenceLevels={filteredReferenceLevels}
            />

            {/* LEVEL MAP + REFERENCE CHIPS (Day / Camarilla / Profile / ADR) */}
            <div className="rounded-[12px] p-3.5 sm:p-4 space-y-3" style={cardStyle}>
              <div
                className="flex flex-wrap items-center justify-between gap-2 pb-2.5"
                style={{ borderBottom: '1px solid #1f1d18' }}
              >
                <div className="flex items-center gap-2">
                  <h2
                    className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
                    style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
                  >
                    LEVEL MAP
                  </h2>
                  <span
                    className="text-[11px] text-[#8e8779] tabular-nums"
                    style={monoStyle}
                  >
                    ({sortedLevelMapZones.length})
                  </span>
                </div>

                {/* Day / Camarilla / Profile / ADR filter chips */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {REF_CHIP_GROUPS.map((grp) => {
                    const isOn = activeRefGroups[grp.id];
                    return (
                      <button
                        key={grp.id}
                        type="button"
                        onClick={() => toggleRefGroup(grp.id)}
                        className="px-2 py-0.5 rounded-[6px] text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                        style={
                          isOn
                            ? {
                                backgroundColor: 'rgba(217, 178, 90, 0.14)',
                                border: `1px solid ${grp.color}`,
                                color: '#f4efe6',
                                ...monoStyle,
                              }
                            : {
                                backgroundColor: '#12110e',
                                border: '1px solid #26231c',
                                color: '#8e8779',
                                ...monoStyle,
                              }
                        }
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            backgroundColor: isOn ? grp.color : '#5a554c',
                          }}
                        />
                        <span>{grp.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {sortedLevelMapZones.length === 0 ? (
                <p className="text-xs text-[#8e8779] py-3">
                  No active zones for this session.
                </p>
              ) : (
                <div className="space-y-2">
                  {/* Sell side rows */}
                  {sellSideZones.length > 0 ? (
                    sellSideZones.map((z) => renderLevelMapRow(z))
                  ) : (
                    <div className="text-xs text-[#8e8779] px-3 py-1.5">
                      No sell side zone
                    </div>
                  )}

                  {/* Dashed "price now" divider */}
                  <div className="py-1.5 flex items-center gap-3">
                    <div
                      className="flex-1 border-t border-dashed"
                      style={{ borderColor: 'rgba(217, 178, 90, 0.35)' }}
                    />
                    <div
                      className="px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-2"
                      style={{
                        backgroundColor: 'rgba(217, 178, 90, 0.08)',
                        border: '1px dashed rgba(217, 178, 90, 0.45)',
                        color: '#d9b25a',
                      }}
                    >
                      <span className="uppercase tracking-wider text-[10px] text-[#8e8779]">
                        price now
                      </span>
                      <span
                        className="font-bold text-[#f4efe6] tabular-nums"
                        style={monoStyle}
                      >
                        {effectiveLivePrice !== null
                          ? effectiveLivePrice.toFixed(2)
                          : '—'}
                      </span>
                    </div>
                    <div
                      className="flex-1 border-t border-dashed"
                      style={{ borderColor: 'rgba(217, 178, 90, 0.35)' }}
                    />
                  </div>

                  {/* Buy side rows */}
                  {buySideZones.length > 0 ? (
                    buySideZones.map((z) => renderLevelMapRow(z))
                  ) : (
                    <div className="text-xs text-[#8e8779] px-3 py-1.5">
                      No buy side zone
                    </div>
                  )}
                </div>
              )}

              {/* Locked Reference Levels Grid (Day / Camarilla / Profile / ADR) */}
              {filteredReferenceLevels.length > 0 && (
                <div
                  className="pt-3 space-y-2"
                  style={{ borderTop: '1px solid #1f1d18' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8e8779]">
                    <span className="uppercase font-semibold tracking-wider text-[#d9b25a]">
                      04:00 Locked Reference Levels
                    </span>
                    {adrState?.adr4 !== null && adrState?.adr4 !== undefined && (
                      <span style={monoStyle}>
                        ADR(4d) ${adrState.adr4.toFixed(2)}
                        {adrState.adrUsedPct !== null
                          ? ` · Used ${adrState.adrUsedPct.toFixed(1)}%`
                          : ''}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                    {filteredReferenceLevels.map((ref) => {
                      const catColor =
                        ref.category === 'DAY'
                          ? '#d9b25a'
                          : ref.category === 'CAMARILLA'
                            ? '#a78bfa'
                            : ref.category === 'PROFILE'
                              ? '#38bdf8'
                              : '#f59e0b';
                      return (
                        <div
                          key={ref.key}
                          className="rounded-[8px] px-2.5 py-1.5 flex items-center justify-between gap-1.5 text-xs"
                          style={innerBoxStyle}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: catColor }}
                            />
                            <span
                              className="font-bold text-[11px] truncate"
                              style={{ color: catColor, ...monoStyle }}
                            >
                              {ref.label}
                            </span>
                          </div>
                          <div className="text-right shrink-0" style={monoStyle}>
                            <div className="font-semibold text-[#f4efe6] text-[11.5px] tabular-nums">
                              {ref.price.toFixed(2)}
                            </div>
                            <div className="text-[10px] text-[#8e8779] tabular-nums">
                              {ref.distanceFormatted}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Live Plan stack */}
          <div className="lg:col-span-5 min-w-0">
            <BlackstoneLivePlanCard
              plan={serverState?.plan}
              zones={zones}
              livePrice={effectiveLivePrice}
              onPinZone={handlePinZone}
              onSelectChartZone={(id) => handleFocusZone(id)}
            />
          </div>
        </div>
      )}

      {/* DAILY LOCK VIEW */}
      {activeTab === 'DAILY LOCK' && (
        <div className="space-y-3.5">
          {serverState?.historyStatus === 'Building history' && (
            <div
              className="rounded-[12px] px-4 py-3 flex flex-wrap items-center justify-between gap-2"
              style={cardStyle}
            >
              <span className="text-xs font-semibold text-[#d9b25a]">
                Building history
              </span>
              <span className="text-xs text-[#8e8779]" style={monoStyle}>
                {serverState.h1TradingDaysCount} trading days stored
              </span>
            </div>
          )}

          <div className="rounded-[12px] p-4 space-y-3.5" style={cardStyle}>
            <div
              className="flex flex-wrap items-center justify-between gap-2 pb-2.5"
              style={{ borderBottom: '1px solid #1f1d18' }}
            >
              <div className="flex items-center gap-2">
                <h2
                  className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
                  style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
                >
                  DAILY LOCK
                </h2>
                <span className="text-xs text-[#8e8779]" style={monoStyle}>
                  · {serverState?.sessionDate || '—'}
                </span>
              </div>
              <span
                className="text-xs font-semibold text-[#d9b25a]"
                style={monoStyle}
              >
                {serverState?.lockStateLabel || 'LOCKED'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              <div className="rounded-[10px] p-3 space-y-1" style={innerBoxStyle}>
                <div className="text-[11px] font-semibold uppercase text-[#8e8779]">
                  OPEN TIME
                </div>
                <div
                  className="text-base font-bold text-[#f4efe6] tabular-nums"
                  style={monoStyle}
                >
                  02:00
                </div>
                <div className="text-xs text-[#8e8779]">
                  Open{' '}
                  <span className="text-[#f4efe6]" style={monoStyle}>
                    {serverState?.openingGap?.openPrice !== null &&
                    serverState?.openingGap?.openPrice !== undefined
                      ? serverState.openingGap.openPrice.toFixed(2)
                      : '—'}
                  </span>
                </div>
              </div>

              <div className="rounded-[10px] p-3 space-y-1" style={innerBoxStyle}>
                <div className="text-[11px] font-semibold uppercase text-[#8e8779]">
                  LOCK TIME
                </div>
                <div
                  className="text-base font-bold text-[#d9b25a] tabular-nums"
                  style={monoStyle}
                >
                  04:00
                </div>
                <div className="text-xs text-[#8e8779]">Dubai</div>
              </div>

              <div className="rounded-[10px] p-3 space-y-1" style={innerBoxStyle}>
                <div className="text-[11px] font-semibold uppercase text-[#8e8779]">
                  OPENING GAP
                </div>
                {serverState?.openingGap?.gapDollars !== null &&
                serverState?.openingGap?.gapDollars !== undefined ? (
                  <>
                    <div
                      className={`text-base font-bold tabular-nums ${
                        serverState.openingGap.gapDollars > 0
                          ? 'text-[#3fbf8f]'
                          : serverState.openingGap.gapDollars < 0
                            ? 'text-[#e5584f]'
                            : 'text-[#f4efe6]'
                      }`}
                      style={monoStyle}
                    >
                      {serverState.openingGap.gapDollars > 0 ? '+' : ''}
                      {serverState.openingGap.gapDollars.toFixed(2)} (
                      {serverState.openingGap.gapPercent !== null &&
                      serverState.openingGap.gapPercent > 0
                        ? '+'
                        : ''}
                      {serverState.openingGap.gapPercent?.toFixed(3)}%)
                    </div>
                    <div className="text-xs text-[#8e8779]">
                      Prev close{' '}
                      <span className="text-[#f4efe6]" style={monoStyle}>
                        {serverState.openingGap.prevClose !== null
                          ? serverState.openingGap.prevClose.toFixed(2)
                          : '—'}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-[#8e8779]">Pending 02:00</div>
                )}
              </div>

              <div className="rounded-[10px] p-3 space-y-1" style={innerBoxStyle}>
                <div className="text-[11px] font-semibold uppercase text-[#8e8779]">
                  OPENING RANGE
                </div>
                {serverState?.openingRange?.low !== null &&
                serverState?.openingRange?.high !== null &&
                serverState?.openingRange !== undefined ? (
                  <>
                    <div
                      className="text-sm font-bold text-[#f4efe6] tabular-nums"
                      style={monoStyle}
                    >
                      {serverState.openingRange.low.toFixed(2)} –{' '}
                      {serverState.openingRange.high.toFixed(2)}
                    </div>
                    <div className="text-xs text-[#8e8779]">
                      Width{' '}
                      <span className="text-[#d9b25a]" style={monoStyle}>
                        ${serverState.openingRange.width?.toFixed(2)}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-[#8e8779]">02:00–04:00</div>
                )}
              </div>

              <div
                className="rounded-[10px] p-3 space-y-1"
                style={{
                  backgroundColor: '#12110e',
                  border: '1px solid rgba(217, 178, 90, 0.35)',
                }}
              >
                <div className="text-[11px] font-semibold uppercase text-[#d9b25a]">
                  NEXT LOCK
                </div>
                <div
                  className="text-base font-bold text-[#d9b25a] tabular-nums"
                  style={monoStyle}
                >
                  {countdownText}
                </div>
                <div className="text-xs text-[#8e8779]">04:00 Dubai</div>
              </div>
            </div>

            <div
              className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-3"
              style={{ borderTop: '1px solid #1f1d18' }}
            >
              <div className="rounded-[10px] p-3 space-y-1" style={innerBoxStyle}>
                <div className="text-[11px] font-semibold uppercase text-[#8e8779]">
                  DAY STATE
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-base font-bold ${
                      dayState?.label === 'WILD'
                        ? 'text-[#e5584f]'
                        : dayState?.label === 'QUIET'
                          ? 'text-[#8e8779]'
                          : 'text-[#d9b25a]'
                    }`}
                  >
                    {dayState?.label || 'NORMAL'}
                  </span>
                  {dayState?.openingRangeWidth !== null &&
                    dayState?.openingRangeWidth !== undefined && (
                      <span className="text-xs text-[#8e8779]" style={monoStyle}>
                        (OR ${dayState.openingRangeWidth.toFixed(2)})
                      </span>
                    )}
                </div>
              </div>

              <div className="rounded-[10px] p-3 space-y-1" style={innerBoxStyle}>
                <div className="text-[11px] font-semibold uppercase text-[#8e8779]">
                  TODAY&apos;S RANGE
                </div>
                <div
                  className="text-base font-bold text-[#f4efe6] tabular-nums"
                  style={monoStyle}
                >
                  {dayState?.todayRangeSoFar !== null &&
                  dayState?.todayRangeSoFar !== undefined
                    ? `$${dayState.todayRangeSoFar.toFixed(2)}`
                    : '—'}
                </div>
                {dayState?.todayLow !== null &&
                  dayState?.todayHigh !== null &&
                  dayState !== undefined && (
                    <div className="text-xs text-[#8e8779]" style={monoStyle}>
                      {dayState.todayLow.toFixed(2)} – {dayState.todayHigh.toFixed(2)}
                    </div>
                  )}
              </div>

              <div className="rounded-[10px] p-3 space-y-1" style={innerBoxStyle}>
                <div className="text-[11px] font-semibold uppercase text-[#8e8779]">
                  ADR USED %
                </div>
                {adrState?.adrUsedPct !== null && adrState?.adrUsedPct !== undefined ? (
                  <>
                    <div
                      className="text-base font-bold text-[#d9b25a] tabular-nums"
                      style={monoStyle}
                    >
                      {adrState.adrUsedPct.toFixed(1)}%
                    </div>
                    <div className="text-xs text-[#8e8779]">
                      ADR(4d){' '}
                      <span className="text-[#f4efe6]" style={monoStyle}>
                        ${adrState.adr4?.toFixed(2)}
                      </span>
                    </div>
                  </>
                ) : dayState?.dayBudgetPercent !== null &&
                  dayState?.dayBudgetPercent !== undefined ? (
                  <>
                    <div
                      className="text-base font-bold text-[#d9b25a] tabular-nums"
                      style={monoStyle}
                    >
                      {dayState.dayBudgetPercent.toFixed(1)}%
                    </div>
                    <div className="text-xs text-[#8e8779]">
                      ADR{' '}
                      <span className="text-[#f4efe6]" style={monoStyle}>
                        ${dayState.adr20?.toFixed(2)}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-[#8e8779]">Building history</div>
                )}
              </div>
            </div>
          </div>

          {/* Locked Zones */}
          <div className="rounded-[12px] p-4 space-y-3" style={cardStyle}>
            <div
              className="flex flex-wrap items-center justify-between gap-2 pb-2.5"
              style={{ borderBottom: '1px solid #1f1d18' }}
            >
              <h2
                className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
                style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
              >
                LOCKED ZONES
              </h2>
              <span className="text-xs text-[#8e8779]" style={monoStyle}>
                04:00
              </span>
            </div>

            {zones.length === 0 ? (
              <p className="text-xs text-[#8e8779] py-2">No active zones.</p>
            ) : (
              <div className="space-y-2">
                {zones.map((z) => renderLevelMapRow(z))}
              </div>
            )}
          </div>

          {/* Used Today List */}
          <div className="rounded-[12px] p-4 space-y-3" style={cardStyle}>
            <div
              className="flex flex-wrap items-center justify-between gap-2 pb-2.5"
              style={{ borderBottom: '1px solid #1f1d18' }}
            >
              <h2
                className="text-xs font-bold uppercase tracking-wider text-[#d9b25a]"
                style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
              >
                USED TODAY
              </h2>
              <span className="text-xs text-[#8e8779]" style={monoStyle}>
                {retiredZones.length}
              </span>
            </div>

            {retiredZones.length === 0 ? (
              <p className="text-xs text-[#8e8779]">None today.</p>
            ) : (
              <div className="divide-y divide-[#1f1d18]">
                {retiredZones.map((rz) => (
                  <div
                    key={rz.key}
                    className="py-2.5 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{
                          backgroundColor:
                            rz.side === 'buy side' ? '#3fbf8f' : '#e5584f',
                        }}
                      />
                      <span className="text-sm font-semibold text-[#f4efe6]">
                        {rz.name}
                      </span>
                      <GradeChip grade={rz.grade} score={rz.score} />
                      <span
                        className="text-xs font-bold text-[#f4efe6] tabular-nums"
                        style={monoStyle}
                      >
                        {rz.low.toFixed(2)} – {rz.high.toFixed(2)}
                      </span>
                    </div>

                    <span
                      className="px-2 py-0.5 rounded-[5px] text-[11px] font-semibold"
                      style={{
                        backgroundColor: 'rgba(229, 88, 79, 0.12)',
                        border: '1px solid rgba(229, 88, 79, 0.35)',
                        color: '#e5584f',
                        ...monoStyle,
                      }}
                    >
                      USED · {rz.retiredAtDubai}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'ZONE RECORD' && (
        <BlackstoneZoneRecordView records={serverState?.zoneRecords} />
      )}

      {activeTab === 'TAPE' && (
        <BlackstoneTapeView
          tape={serverState?.tape}
          livePrice={effectiveLivePrice}
          isFeedLive={isFeedLive}
        />
      )}

      {activeTab === 'BACKTEST' && (
        <BlackstoneBacktestView backtest={serverState?.backtest} />
      )}
    </div>
  );
};
