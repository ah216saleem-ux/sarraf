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
} from '../server/blackstoneEngine';

type BlackstoneTab = 'ZONES' | 'DAILY LOCK' | 'TAPE' | 'ZONE RECORD' | 'BACKTEST';
type BlackstoneTimeframe = 'M5' | 'M15' | 'H1';

const INNER_TABS: Array<{ id: BlackstoneTab; label: string }> = [
  { id: 'ZONES', label: 'Zones' },
  { id: 'DAILY LOCK', label: 'Daily lock' },
  { id: 'TAPE', label: 'Tape' },
  { id: 'ZONE RECORD', label: 'Zone record' },
  { id: 'BACKTEST', label: 'Backtest' },
];

const novaCardStyle: React.CSSProperties = {
  backgroundColor: 'rgba(18, 22, 34, 0.72)',
  border: '1px solid rgba(140, 160, 255, 0.14)',
  fontFamily: "'Sora', sans-serif",
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
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-bold"
      style={
        isGradeA
          ? {
              backgroundColor: 'rgba(82, 227, 255, 0.18)',
              border: '1px solid rgba(82, 227, 255, 0.55)',
              color: '#52e3ff',
            }
          : {
              backgroundColor: 'rgba(140, 160, 255, 0.10)',
              border: '1px solid rgba(140, 160, 255, 0.25)',
              color: '#e9edff',
            }
      }
      title={score !== undefined ? `Grade ${grade} (${score}/100)` : `Grade ${grade}`}
    >
      <span>{grade}</span>
      {score !== undefined && (
        <span
          className="text-[10px] font-semibold opacity-90 tabular-nums"
          style={monoStyle}
        >
          {score}
        </span>
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
  const [dubaiTime, setDubaiTime] = useState<string>(() => formatDubaiClock(new Date()));
  const [countdownText, setCountdownText] = useState<string>('00:00:00');

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

  const effectiveLivePrice = isFeedLive ? feed.currentPrice : null;

  const isAdmin = Boolean(
    user?.isAdmin || user?.role === 'admin' || serverState?.isAdmin
  );

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

  const renderLevelMapRow = (z: BlackstoneEvaluatedZone) => {
    const isSelected = selectedZone?.id === z.id;
    const isBuy = z.side === 'buy side';
    const sideColor = isBuy ? '#4df0b4' : '#ff6b7f';
    const statusText = z.touches > 0 ? 'TESTED 1' : 'FRESH';

    return (
      <button
        key={z.id}
        type="button"
        onClick={() => setSelectedZoneId(z.id)}
        className="w-full text-left px-3.5 py-3 rounded-[12px] transition-all cursor-pointer flex flex-col gap-1.5"
        style={
          isSelected
            ? {
                backgroundColor: isBuy
                  ? 'rgba(77, 240, 180, 0.12)'
                  : 'rgba(255, 107, 127, 0.12)',
                border: `1px solid ${sideColor}`,
                boxShadow: `0 0 16px ${
                  isBuy ? 'rgba(77, 240, 180, 0.18)' : 'rgba(255, 107, 127, 0.18)'
                }`,
              }
            : {
                backgroundColor: 'rgba(7, 9, 15, 0.45)',
                border: '1px solid rgba(140, 160, 255, 0.10)',
              }
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Left: Name + Sarraf Core tag + Grade chip (A or B with score) */}
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: sideColor }}
            />
            <span className="text-sm font-bold text-[#e9edff]">{z.name}</span>
            {z.isSarrafCore && (
              <span
                className="px-2 py-0.5 rounded-[5px] text-[10px] font-bold uppercase"
                style={{
                  backgroundColor: 'rgba(82, 227, 255, 0.16)',
                  border: '1px solid rgba(82, 227, 255, 0.5)',
                  color: '#52e3ff',
                }}
              >
                Sarraf Core
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

          {/* Right: Range, Status, Distance in dollars */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {/* Range */}
            <span
              className="font-bold text-[#e9edff] tabular-nums"
              style={monoStyle}
            >
              {z.low.toFixed(2)} – {z.high.toFixed(2)}
            </span>

            {/* Status */}
            <span
              className="px-2 py-0.5 rounded-[5px] text-[10px] font-bold uppercase"
              style={
                z.touches > 0
                  ? {
                      backgroundColor: 'rgba(82, 227, 255, 0.14)',
                      color: '#52e3ff',
                    }
                  : {
                      backgroundColor: 'rgba(77, 240, 180, 0.14)',
                      color: '#4df0b4',
                    }
              }
            >
              {statusText}
            </span>

            {/* Distance in dollars */}
            <span
              className="font-bold tabular-nums min-w-[56px] text-right"
              style={{ ...monoStyle, color: sideColor }}
            >
              {z.distanceFormatted}
            </span>
          </div>
        </div>

        {isAdmin && z.sources && z.sources.length > 0 && (
          <div className="text-[11px] text-[#8d97b8] pl-4">
            Confluence: {z.sources.join(' · ')}
          </div>
        )}
      </button>
    );
  };

  return (
    <div
      className="relative w-full min-h-screen overflow-x-hidden rounded-[20px] p-3 sm:p-5 space-y-4"
      style={{
        backgroundColor: '#07090f',
        backgroundImage:
          'radial-gradient(circle at 0% 0%, rgba(82, 227, 255, 0.13) 0%, transparent 45%), radial-gradient(circle at 100% 0%, rgba(155, 114, 255, 0.13) 0%, transparent 45%)',
        color: '#e9edff',
        fontFamily: "'Sora', sans-serif",
      }}
    >
      {/* 1. NOVA HEADER: small "XAUUSD spot gold" with LIVE chip, big 52px light price with cyan glow, Dubai time, Zones locked 04:00, Source Ahmad server on the right */}
      <header
        className="w-full rounded-[18px] px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4 backdrop-blur-md"
        style={novaCardStyle}
      >
        {/* Left: small "XAUUSD spot gold" + LIVE chip + big 52px price */}
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-medium tracking-wide text-[#8d97b8]">
              XAUUSD spot gold
            </span>
            {isMarketClosed ? (
              <span
                className="px-2 py-0.5 rounded-[6px] text-[10px] font-bold uppercase tracking-wider"
                style={{
                  backgroundColor: 'rgba(255, 107, 127, 0.16)',
                  border: '1px solid rgba(255, 107, 127, 0.5)',
                  color: '#ff6b7f',
                }}
              >
                MARKET CLOSED
              </span>
            ) : !isFeedLive ? (
              <span
                className="px-2 py-0.5 rounded-[6px] text-[10px] font-bold uppercase tracking-wider"
                style={{
                  backgroundColor: 'rgba(140, 160, 255, 0.14)',
                  border: '1px solid rgba(140, 160, 255, 0.35)',
                  color: '#8d97b8',
                }}
              >
                FEED STALE
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[6px] text-[10px] font-bold uppercase tracking-wider"
                style={{
                  backgroundColor: 'rgba(77, 240, 180, 0.16)',
                  border: '1px solid rgba(77, 240, 180, 0.55)',
                  color: '#4df0b4',
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#4df0b4] animate-pulse" />
                <span>LIVE</span>
              </span>
            )}
          </div>

          <div
            className="text-[40px] sm:text-[52px] font-light leading-none tracking-tight text-[#e9edff] tabular-nums"
            style={{
              ...monoStyle,
              textShadow: '0 0 24px rgba(82, 227, 255, 0.35)',
            }}
          >
            {isFeedLive ? feed.currentPrice.toFixed(2) : '—'}
          </div>
        </div>

        {/* Right: Dubai time, Zones locked 04:00, Source Ahmad server (wraps on phones) */}
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <div className="flex flex-col">
            <span className="text-[11px] text-[#8d97b8]">Dubai time</span>
            <span
              className="text-sm font-semibold text-[#e9edff] tabular-nums"
              style={monoStyle}
            >
              {dubaiTime}
            </span>
          </div>

          <div
            className="flex flex-col pl-4"
            style={{ borderLeft: '1px solid rgba(140, 160, 255, 0.14)' }}
          >
            <span className="text-[11px] text-[#8d97b8]">Zones locked</span>
            <span
              className="text-sm font-semibold text-[#52e3ff] tabular-nums"
              style={monoStyle}
            >
              04:00
            </span>
          </div>

          <div
            className="flex flex-col pl-4"
            style={{ borderLeft: '1px solid rgba(140, 160, 255, 0.14)' }}
          >
            <span className="text-[11px] text-[#8d97b8]">Source</span>
            <span className="text-sm font-semibold text-[#e9edff]">
              Ahmad server
            </span>
          </div>
        </div>
      </header>

      {/* 2. TABS: Zones, Daily lock, Tape, Zone record, Backtest (Active tab has a cyan underline) */}
      <nav
        className="flex items-center gap-1 sm:gap-2 overflow-x-auto px-2"
        style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
      >
        {INNER_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-3.5 py-2.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                isActive
                  ? 'text-[#e9edff]'
                  : 'text-[#8d97b8] hover:text-[#e9edff]'
              }`}
            >
              {tab.label}
              {isActive && (
                <span
                  className="absolute left-0 right-0 bottom-0 h-[2.5px] rounded-t-full"
                  style={{
                    backgroundColor: '#52e3ff',
                    boxShadow: '0 0 12px rgba(82, 227, 255, 0.7)',
                  }}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* 3. NEWS BAND UNDER THE TABS */}
      <BlackstoneNewsBand news={serverState?.plan?.news} />

      {/* 4. ZONES TAB: Desktop = chart and Level map on the left, Live Plan stack on the right. Phones = one column. */}
      {activeTab === 'ZONES' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* LEFT COLUMN (Desktop): Chart + Level Map */}
          <div className="lg:col-span-7 space-y-4 min-w-0">
            <BlackstoneZoneChart
              candles={candles}
              zones={activeVisibleZones}
              selectedZoneId={selectedZone?.id || null}
              onSelectZone={(id) => setSelectedZoneId(id)}
              timeframe={timeframe}
              onChangeTimeframe={(tf) => setTimeframe(tf)}
              lockTimeIso={serverState?.lockTimeIso || ''}
              openTimeIso={serverState?.openTimeIso || ''}
              livePrice={effectiveLivePrice}
              isFeedLive={isFeedLive}
              isMarketClosed={isMarketClosed}
              activeTrade={serverState?.plan?.activeTrade}
              newsPauseNotice={serverState?.plan?.news?.pauseNoticeText}
            />

            {/* LEVEL MAP: rows ordered by price with a dashed "price now" divider between sell side and buy side */}
            <div
              className="rounded-[18px] p-4 sm:p-5 space-y-3 backdrop-blur-md"
              style={novaCardStyle}
            >
              <div
                className="flex flex-wrap items-center justify-between gap-2 pb-3"
                style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
              >
                <div className="flex items-center gap-2.5">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
                    LEVEL MAP
                  </h2>
                  <span className="text-xs text-[#8d97b8]">
                    Tap a row to highlight on chart
                  </span>
                </div>
                {serverState?.historyStatus === 'Building history' && (
                  <span className="text-xs font-semibold text-[#52e3ff]">
                    Building history
                  </span>
                )}
              </div>

              {sortedLevelMapZones.length === 0 ? (
                <p className="text-sm text-[#8d97b8] py-4">
                  {serverState?.historyStatus === 'Building history'
                    ? 'Building history — waiting for qualifying Grade A or B H1 reaction zones.'
                    : 'No active Grade A or B reaction zones locked for this session.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {/* Sell side rows (above live price, ordered highest to lowest) */}
                  {sellSideZones.length > 0 ? (
                    sellSideZones.map((z) => renderLevelMapRow(z))
                  ) : (
                    <div className="text-xs text-[#8d97b8] px-3 py-2">
                      No sell side zone in the last 10 days of H1 data.
                    </div>
                  )}

                  {/* Dashed "price now" divider between sell side and buy side */}
                  <div className="py-2 flex items-center gap-3">
                    <div
                      className="flex-1 border-t border-dashed"
                      style={{ borderColor: 'rgba(82, 227, 255, 0.45)' }}
                    />
                    <div
                      className="px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-2"
                      style={{
                        backgroundColor: 'rgba(82, 227, 255, 0.12)',
                        border: '1px dashed rgba(82, 227, 255, 0.55)',
                        color: '#52e3ff',
                      }}
                    >
                      <span className="uppercase tracking-wider text-[10px] text-[#8d97b8]">
                        price now
                      </span>
                      <span
                        className="font-bold text-[#e9edff] tabular-nums"
                        style={monoStyle}
                      >
                        {effectiveLivePrice !== null
                          ? effectiveLivePrice.toFixed(2)
                          : '—'}
                      </span>
                    </div>
                    <div
                      className="flex-1 border-t border-dashed"
                      style={{ borderColor: 'rgba(82, 227, 255, 0.45)' }}
                    />
                  </div>

                  {/* Buy side rows (below live price, ordered highest to lowest) */}
                  {buySideZones.length > 0 ? (
                    buySideZones.map((z) => renderLevelMapRow(z))
                  ) : (
                    <div className="text-xs text-[#8d97b8] px-3 py-2">
                      No buy side zone in the last 10 days of H1 data.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN (Desktop): Live Plan stack */}
          <div className="lg:col-span-5 min-w-0">
            <BlackstoneLivePlanCard
              plan={serverState?.plan}
              zones={zones}
              livePrice={effectiveLivePrice}
              onPinZone={handlePinZone}
              onSelectChartZone={(id) => setSelectedZoneId(id)}
            />
          </div>
        </div>
      )}

      {/* DAILY LOCK VIEW */}
      {activeTab === 'DAILY LOCK' && (
        <div className="space-y-4">
          {serverState?.historyStatus === 'Building history' && (
            <div
              className="rounded-[18px] px-4 py-3 flex flex-wrap items-center justify-between gap-2 backdrop-blur-md"
              style={novaCardStyle}
            >
              <span className="text-sm font-semibold text-[#52e3ff]">
                Building history
              </span>
              <span className="text-xs text-[#8d97b8]">
                Stored H1 history:{' '}
                <span className="text-[#e9edff] font-semibold" style={monoStyle}>
                  {serverState.h1TradingDaysCount}
                </span>{' '}
                trading days (scanning last 10 trading days).
              </span>
            </div>
          )}

          <div
            className="rounded-[18px] p-5 space-y-4 backdrop-blur-md"
            style={novaCardStyle}
          >
            <div
              className="flex flex-wrap items-center justify-between gap-2 pb-3"
              style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
            >
              <div className="flex items-center gap-2.5">
                <h2 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
                  DAILY LOCK
                </h2>
                <span className="text-xs text-[#8d97b8]">
                  · Session{' '}
                  <span style={monoStyle}>{serverState?.sessionDate || '—'}</span>
                </span>
              </div>
              <span className="text-xs font-semibold text-[#52e3ff]">
                {serverState?.lockStateLabel || 'LOCKED'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div
                className="rounded-[12px] p-3.5 space-y-1"
                style={{
                  backgroundColor: 'rgba(7, 9, 15, 0.55)',
                  border: '1px solid rgba(140, 160, 255, 0.12)',
                }}
              >
                <div className="text-xs font-semibold uppercase text-[#8d97b8]">
                  OPEN TIME
                </div>
                <div
                  className="text-base font-bold text-[#e9edff] tabular-nums"
                  style={monoStyle}
                >
                  02:00
                </div>
                <div className="text-xs text-[#8d97b8]">
                  Dubai time · Open{' '}
                  <span className="text-[#e9edff]" style={monoStyle}>
                    {serverState?.openingGap?.openPrice !== null &&
                    serverState?.openingGap?.openPrice !== undefined
                      ? serverState.openingGap.openPrice.toFixed(2)
                      : '—'}
                  </span>
                </div>
              </div>

              <div
                className="rounded-[12px] p-3.5 space-y-1"
                style={{
                  backgroundColor: 'rgba(7, 9, 15, 0.55)',
                  border: '1px solid rgba(140, 160, 255, 0.12)',
                }}
              >
                <div className="text-xs font-semibold uppercase text-[#8d97b8]">
                  LOCK TIME
                </div>
                <div
                  className="text-base font-bold text-[#52e3ff] tabular-nums"
                  style={monoStyle}
                >
                  04:00
                </div>
                <div className="text-xs text-[#8d97b8]">
                  Dubai time · Zones frozen for session
                </div>
              </div>

              <div
                className="rounded-[12px] p-3.5 space-y-1"
                style={{
                  backgroundColor: 'rgba(7, 9, 15, 0.55)',
                  border: '1px solid rgba(140, 160, 255, 0.12)',
                }}
              >
                <div className="text-xs font-semibold uppercase text-[#8d97b8]">
                  OPENING GAP
                </div>
                {serverState?.openingGap?.gapDollars !== null &&
                serverState?.openingGap?.gapDollars !== undefined ? (
                  <>
                    <div
                      className={`text-base font-bold tabular-nums ${
                        serverState.openingGap.gapDollars > 0
                          ? 'text-[#4df0b4]'
                          : serverState.openingGap.gapDollars < 0
                            ? 'text-[#ff6b7f]'
                            : 'text-[#e9edff]'
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
                    <div className="text-xs text-[#8d97b8]">
                      Prev close{' '}
                      <span className="text-[#e9edff]" style={monoStyle}>
                        {serverState.openingGap.prevClose !== null
                          ? serverState.openingGap.prevClose.toFixed(2)
                          : '—'}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-[#8d97b8]">Pending 02:00 open</div>
                )}
              </div>

              <div
                className="rounded-[12px] p-3.5 space-y-1"
                style={{
                  backgroundColor: 'rgba(7, 9, 15, 0.55)',
                  border: '1px solid rgba(140, 160, 255, 0.12)',
                }}
              >
                <div className="text-xs font-semibold uppercase text-[#8d97b8]">
                  OPENING RANGE
                </div>
                {serverState?.openingRange?.low !== null &&
                serverState?.openingRange?.high !== null &&
                serverState?.openingRange !== undefined ? (
                  <>
                    <div
                      className="text-sm font-bold text-[#e9edff] tabular-nums"
                      style={monoStyle}
                    >
                      {serverState.openingRange.low.toFixed(2)} –{' '}
                      {serverState.openingRange.high.toFixed(2)}
                    </div>
                    <div className="text-xs text-[#8d97b8]">
                      02:00–04:00 · Width{' '}
                      <span className="text-[#52e3ff]" style={monoStyle}>
                        ${serverState.openingRange.width?.toFixed(2)}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-[#8d97b8]">Pending 02:00–04:00</div>
                )}
              </div>

              <div
                className="rounded-[12px] p-3.5 space-y-1"
                style={{
                  backgroundColor: 'rgba(7, 9, 15, 0.55)',
                  border: '1px solid rgba(82, 227, 255, 0.3)',
                }}
              >
                <div className="text-xs font-semibold uppercase text-[#52e3ff]">
                  NEXT LOCK COUNTDOWN
                </div>
                <div
                  className="text-base font-bold text-[#52e3ff] tabular-nums"
                  style={monoStyle}
                >
                  {countdownText}
                </div>
                <div className="text-xs text-[#8d97b8]">
                  Until next 04:00 Dubai lock
                </div>
              </div>
            </div>

            <div
              className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3"
              style={{ borderTop: '1px solid rgba(140, 160, 255, 0.14)' }}
            >
              <div
                className="rounded-[12px] p-3.5 space-y-1"
                style={{
                  backgroundColor: 'rgba(7, 9, 15, 0.55)',
                  border: '1px solid rgba(140, 160, 255, 0.12)',
                }}
              >
                <div className="text-xs font-semibold uppercase text-[#8d97b8]">
                  DAY STATE
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-base font-bold ${
                      dayState?.label === 'WILD'
                        ? 'text-[#ff6b7f]'
                        : dayState?.label === 'QUIET'
                          ? 'text-[#8d97b8]'
                          : 'text-[#52e3ff]'
                    }`}
                  >
                    {dayState?.label || 'NORMAL'}
                  </span>
                  {dayState?.openingRangeWidth !== null &&
                    dayState?.openingRangeWidth !== undefined && (
                      <span className="text-xs text-[#8d97b8]" style={monoStyle}>
                        (OR ${dayState.openingRangeWidth.toFixed(2)})
                      </span>
                    )}
                </div>
                <div className="text-xs text-[#8d97b8]">Opening range regime</div>
              </div>

              <div
                className="rounded-[12px] p-3.5 space-y-1"
                style={{
                  backgroundColor: 'rgba(7, 9, 15, 0.55)',
                  border: '1px solid rgba(140, 160, 255, 0.12)',
                }}
              >
                <div className="text-xs font-semibold uppercase text-[#8d97b8]">
                  TODAY&apos;S RANGE SO FAR
                </div>
                <div
                  className="text-base font-bold text-[#e9edff] tabular-nums"
                  style={monoStyle}
                >
                  {dayState?.todayRangeSoFar !== null &&
                  dayState?.todayRangeSoFar !== undefined
                    ? `$${dayState.todayRangeSoFar.toFixed(2)}`
                    : '—'}
                </div>
                <div className="text-xs text-[#8d97b8]">
                  {dayState?.todayLow !== null &&
                  dayState?.todayHigh !== null &&
                  dayState !== undefined ? (
                    <span style={monoStyle}>
                      {dayState.todayLow.toFixed(2)} – {dayState.todayHigh.toFixed(2)}
                    </span>
                  ) : (
                    'From 02:00 Dubai open'
                  )}
                </div>
              </div>

              <div
                className="rounded-[12px] p-3.5 space-y-1"
                style={{
                  backgroundColor: 'rgba(7, 9, 15, 0.55)',
                  border: '1px solid rgba(140, 160, 255, 0.12)',
                }}
              >
                <div className="text-xs font-semibold uppercase text-[#8d97b8]">
                  DAY BUDGET
                </div>
                {dayState?.dayBudgetPercent !== null &&
                dayState?.dayBudgetPercent !== undefined ? (
                  <>
                    <div
                      className="text-base font-bold text-[#52e3ff] tabular-nums"
                      style={monoStyle}
                    >
                      {dayState.dayBudgetPercent.toFixed(1)}%
                    </div>
                    <div className="text-xs text-[#8d97b8]">
                      20-day avg range{' '}
                      <span className="text-[#e9edff]" style={monoStyle}>
                        ${dayState.adr20?.toFixed(2)}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-semibold text-[#e9edff]">
                      Building history
                    </div>
                    <div className="text-xs text-[#8d97b8]">
                      Requires 20 stored trading days
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Locked Reaction Zones Card */}
          <div
            className="rounded-[18px] p-5 space-y-3 backdrop-blur-md"
            style={novaCardStyle}
          >
            <div
              className="flex flex-wrap items-center justify-between gap-2 pb-3"
              style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
            >
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
                LOCKED ZONES
              </h2>
              <span className="text-xs text-[#8d97b8]">
                Frozen at 04:00 Dubai · Grade A (70+) & Grade B (50–69) only
              </span>
            </div>

            {zones.length === 0 ? (
              <p className="text-sm text-[#8d97b8] py-2">
                No active Grade A or B reaction zones locked for this session.
              </p>
            ) : (
              <div className="space-y-2">
                {zones.map((z) => renderLevelMapRow(z))}
              </div>
            )}
          </div>

          {/* Used Today List */}
          <div
            className="rounded-[18px] p-5 space-y-3 backdrop-blur-md"
            style={novaCardStyle}
          >
            <div
              className="flex flex-wrap items-center justify-between gap-2 pb-3"
              style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
            >
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
                USED TODAY
              </h2>
              <span className="text-xs text-[#8d97b8]">
                Retired when a closed M5 candle ends more than $1.00 beyond distal edge
              </span>
            </div>

            {retiredZones.length === 0 ? (
              <p className="text-sm text-[#8d97b8] leading-relaxed">
                No locked reaction zones have been used and retired today.
              </p>
            ) : (
              <div className="divide-y divide-[rgba(140,160,255,0.12)]">
                {retiredZones.map((rz) => (
                  <div key={rz.key} className="py-3 flex flex-col gap-1">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{
                            backgroundColor:
                              rz.side === 'buy side' ? '#4df0b4' : '#ff6b7f',
                          }}
                        />
                        <span className="text-sm font-semibold text-[#e9edff]">
                          {rz.name}
                        </span>
                        <GradeChip grade={rz.grade} score={rz.score} />
                        <span
                          className="text-sm font-bold text-[#e9edff] tabular-nums"
                          style={monoStyle}
                        >
                          {rz.low.toFixed(2)} – {rz.high.toFixed(2)}
                        </span>
                        <span
                          className="text-xs font-semibold"
                          style={{
                            color: rz.side === 'buy side' ? '#4df0b4' : '#ff6b7f',
                          }}
                        >
                          {rz.side}
                        </span>
                      </div>

                      <span
                        className="px-2 py-0.5 rounded-[6px] text-xs font-semibold"
                        style={{
                          backgroundColor: 'rgba(255, 107, 127, 0.15)',
                          border: '1px solid rgba(255, 107, 127, 0.35)',
                          color: '#ff6b7f',
                        }}
                      >
                        USED · {rz.retiredAtDubai}
                      </span>
                    </div>
                    <div className="text-xs text-[#8d97b8] pl-4">{rz.reason}</div>
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
