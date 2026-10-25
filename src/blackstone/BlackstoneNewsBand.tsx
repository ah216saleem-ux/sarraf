import React, { useState, useEffect } from 'react';
import type { BlackstoneNewsState } from '../server/blackstonePlanEngine';

interface BlackstoneNewsBandProps {
  news: BlackstoneNewsState | null | undefined;
}

export const BlackstoneNewsBand: React.FC<BlackstoneNewsBandProps> = ({ news }) => {
  // Local 1-second ticker to keep the live countdown ticking smoothly between server polls
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!news || !news.available) {
    return (
      <div
        className="rounded-[18px] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs backdrop-blur-md"
        style={{
          backgroundColor: 'rgba(18, 22, 34, 0.72)',
          border: '1px solid rgba(140, 160, 255, 0.14)',
          color: '#8d97b8',
          fontFamily: "'Sora', sans-serif",
        }}
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#8d97b8]/50" />
          <span className="font-semibold uppercase tracking-wider text-[#e9edff]">
            MACRO CALENDAR
          </span>
          <span className="text-[#8d97b8]">·</span>
          <span className="text-[#8d97b8] font-medium">News unavailable</span>
        </div>
        <span className="text-[11px] text-[#8d97b8]">
          Signals running normally
        </span>
      </div>
    );
  }

  const { nextEvent, isNewsPauseActive } = news;

  if (!nextEvent) {
    return (
      <div
        className="rounded-[18px] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs backdrop-blur-md"
        style={{
          backgroundColor: 'rgba(18, 22, 34, 0.72)',
          border: '1px solid rgba(140, 160, 255, 0.14)',
          color: '#8d97b8',
          fontFamily: "'Sora', sans-serif",
        }}
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#4df0b4]" />
          <span className="font-semibold uppercase tracking-wider text-[#52e3ff]">
            MACRO CALENDAR
          </span>
          <span className="text-[#8d97b8]">·</span>
          <span className="text-[#e9edff]/90">
            No high or medium impact events scheduled in near window
          </span>
        </div>
        <span className="text-[#4df0b4] font-semibold text-[11px]">
          Trading window open
        </span>
      </div>
    );
  }

  // Dynamic live countdown from UTC timestamp
  const eventMs = new Date(nextEvent.timeUtc).getTime();
  const diffSec = Math.floor((eventMs - Date.now()) / 1000);
  const minutesUntil = Math.floor(diffSec / 60);

  let liveCountdownStr = nextEvent.countdownFormatted;
  if (!isNaN(diffSec)) {
    if (diffSec > 86400) {
      const days = Math.floor(diffSec / 86400);
      const hours = Math.floor((diffSec % 86400) / 3600);
      const mins = Math.floor((diffSec % 3600) / 60);
      const secs = Math.max(0, diffSec % 60);
      liveCountdownStr = `${days}d ${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
    } else if (diffSec > 0) {
      const hours = Math.floor(diffSec / 3600);
      const mins = Math.floor((diffSec % 3600) / 60);
      const secs = Math.max(0, diffSec % 60);
      liveCountdownStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else {
      const pastSecs = Math.abs(diffSec);
      const pastMins = Math.floor(pastSecs / 60);
      const remSecs = pastSecs % 60;
      liveCountdownStr = `+${pastMins}m ${remSecs}s since release`;
    }
  }

  // Visual state rules:
  // 1. Red during the pause window (30m before to 15m after for HIGH impact)
  // 2. Cyan (#52e3ff) and pulsing in the last 60 minutes before the event
  // 3. Otherwise Nova dark glass card
  const isPauseWindow = isNewsPauseActive || nextEvent.isPauseWindow;
  const isWithin60m = !isPauseWindow && minutesUntil <= 60 && minutesUntil >= 0;

  const containerStyle: React.CSSProperties = isPauseWindow
    ? {
        backgroundColor: 'rgba(54, 16, 26, 0.82)',
        border: '1.5px solid #ff6b7f',
        boxShadow: '0 0 24px rgba(255, 107, 127, 0.28)',
        fontFamily: "'Sora', sans-serif",
      }
    : isWithin60m
      ? {
          backgroundColor: 'rgba(14, 34, 48, 0.80)',
          border: '1.5px solid #52e3ff',
          boxShadow: '0 0 24px rgba(82, 227, 255, 0.28)',
          fontFamily: "'Sora', sans-serif",
        }
      : {
          backgroundColor: 'rgba(18, 22, 34, 0.72)',
          border: '1px solid rgba(140, 160, 255, 0.14)',
          fontFamily: "'Sora', sans-serif",
        };

  return (
    <div
      className={`rounded-[18px] px-4 py-3 backdrop-blur-md transition-all space-y-2 ${
        isWithin60m ? 'animate-pulse' : ''
      }`}
      style={containerStyle}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Impact Tag & Event Name */}
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              isPauseWindow
                ? 'bg-[#ff6b7f] animate-ping'
                : isWithin60m
                  ? 'bg-[#52e3ff] animate-ping'
                  : 'bg-[#52e3ff]'
            }`}
          />
          {/* Impact tag: HIGH or MED */}
          <span
            className={`px-2 py-0.5 rounded-[6px] text-[10px] font-bold tracking-wider uppercase border shrink-0 ${
              nextEvent.impact === 'HIGH'
                ? 'bg-[#ff6b7f]/20 border-[#ff6b7f]/60 text-[#ff6b7f]'
                : 'bg-[#52e3ff]/15 border-[#52e3ff]/45 text-[#52e3ff]'
            }`}
          >
            {nextEvent.impact} IMPACT
          </span>
          <span className="text-sm font-semibold text-[#e9edff] tracking-wide truncate">
            {nextEvent.name}
          </span>
        </div>

        {/* Right: Live Countdown & BULLISH / BEARISH FOR GOLD chip with confidence */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Live countdown */}
          <div
            className="flex items-center gap-1.5 rounded-[8px] px-2.5 py-1"
            style={{
              backgroundColor: 'rgba(7, 9, 15, 0.65)',
              border: '1px solid rgba(140, 160, 255, 0.16)',
            }}
          >
            <span className="text-[10px] uppercase font-semibold text-[#8d97b8]">
              Countdown
            </span>
            <span
              className={`text-xs font-bold tabular-nums ${
                isPauseWindow
                  ? 'text-[#ff6b7f]'
                  : isWithin60m
                    ? 'text-[#52e3ff]'
                    : 'text-[#e9edff]'
              }`}
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {liveCountdownStr}
            </span>
          </div>

          {/* BULLISH / BEARISH FOR GOLD chip with News tab confidence */}
          {nextEvent.decisionDirection === 'BULLISH' ? (
            <span
              className="px-3 py-1 rounded-[8px] text-xs font-bold tracking-wide flex items-center gap-1.5"
              style={{
                backgroundColor: 'rgba(77, 240, 180, 0.16)',
                border: '1px solid rgba(77, 240, 180, 0.55)',
                color: '#4df0b4',
              }}
            >
              <span>BULLISH FOR GOLD</span>
              <span
                className="tabular-nums font-bold"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                {nextEvent.confidencePercent ?? 0}%
              </span>
            </span>
          ) : nextEvent.decisionDirection === 'BEARISH' ? (
            <span
              className="px-3 py-1 rounded-[8px] text-xs font-bold tracking-wide flex items-center gap-1.5"
              style={{
                backgroundColor: 'rgba(255, 107, 127, 0.18)',
                border: '1px solid rgba(255, 107, 127, 0.55)',
                color: '#ff6b7f',
              }}
            >
              <span>BEARISH FOR GOLD</span>
              <span
                className="tabular-nums font-bold"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                {nextEvent.confidencePercent ?? 0}%
              </span>
            </span>
          ) : (
            <span
              className="px-3 py-1 rounded-[8px] text-xs font-semibold"
              style={{
                backgroundColor: 'rgba(140, 160, 255, 0.08)',
                border: '1px solid rgba(140, 160, 255, 0.2)',
                color: '#8d97b8',
              }}
            >
              Decision pending
            </span>
          )}
        </div>
      </div>

      {/* Pause Window Warning Banner */}
      {isPauseWindow && (
        <div
          className="pt-2 flex flex-wrap items-center justify-between gap-2 text-xs"
          style={{
            borderTop: '1px solid rgba(255, 107, 127, 0.35)',
            color: '#ff6b7f',
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold uppercase tracking-wider">
              News pause window active: signals paused
            </span>
            <span className="text-[11px] text-[#e9edff]/80">
              (30m before to 15m after {nextEvent.impact} impact release)
            </span>
          </div>
          <span className="text-[11px] font-semibold text-[#e9edff]">
            Open trades keep running
          </span>
        </div>
      )}
    </div>
  );
};
