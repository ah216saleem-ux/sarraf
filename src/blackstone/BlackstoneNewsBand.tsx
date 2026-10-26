import React, { useState, useEffect } from 'react';
import type { BlackstoneNewsState } from '../server/blackstonePlanEngine';

interface BlackstoneNewsBandProps {
  news: BlackstoneNewsState | null | undefined;
}

export const BlackstoneNewsBand: React.FC<BlackstoneNewsBandProps> = ({ news }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!news || !news.available) {
    return (
      <div
        className="rounded-[12px] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
        style={{
          backgroundColor: '#0b0b0e',
          border: '1px solid #1f1d18',
          color: '#8e8779',
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#8e8779]/50" />
          <span className="font-semibold uppercase tracking-wider text-[#f4efe6]">
            MACRO CALENDAR
          </span>
          <span>·</span>
          <span>Offline</span>
        </div>
      </div>
    );
  }

  const { nextEvent, isNewsPauseActive } = news;

  if (!nextEvent) {
    return (
      <div
        className="rounded-[12px] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
        style={{
          backgroundColor: '#0b0b0e',
          border: '1px solid #1f1d18',
          color: '#8e8779',
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#3fbf8f]" />
          <span className="font-semibold uppercase tracking-wider text-[#d9b25a]">
            MACRO CALENDAR
          </span>
          <span>·</span>
          <span className="text-[#f4efe6]">No scheduled events in window</span>
        </div>
      </div>
    );
  }

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
      liveCountdownStr = `+${pastMins}m ${remSecs}s`;
    }
  }

  const isPauseWindow = isNewsPauseActive || nextEvent.isPauseWindow;
  const isWithin60m = !isPauseWindow && minutesUntil <= 60 && minutesUntil >= 0;

  const containerStyle: React.CSSProperties = isPauseWindow
    ? {
        backgroundColor: '#140b0b',
        border: '1px solid #e5584f',
        fontFamily: "'DM Sans', sans-serif",
      }
    : isWithin60m
      ? {
          backgroundColor: '#12100b',
          border: '1px solid #d9b25a',
          fontFamily: "'DM Sans', sans-serif",
        }
      : {
          backgroundColor: '#0b0b0e',
          border: '1px solid #1f1d18',
          fontFamily: "'DM Sans', sans-serif",
        };

  return (
    <div className="rounded-[12px] px-3.5 py-2.5 space-y-1.5" style={containerStyle}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              isPauseWindow ? 'bg-[#e5584f]' : 'bg-[#d9b25a]'
            }`}
          />
          <span
            className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold tracking-wider uppercase shrink-0"
            style={
              nextEvent.impact === 'HIGH'
                ? {
                    backgroundColor: 'rgba(229, 88, 79, 0.14)',
                    border: '1px solid rgba(229, 88, 79, 0.45)',
                    color: '#e5584f',
                    fontFamily: "'JetBrains Mono', monospace",
                  }
                : {
                    backgroundColor: 'rgba(217, 178, 90, 0.14)',
                    border: '1px solid rgba(217, 178, 90, 0.45)',
                    color: '#d9b25a',
                    fontFamily: "'JetBrains Mono', monospace",
                  }
            }
          >
            {nextEvent.impact}
          </span>
          <span className="text-xs sm:text-sm font-semibold text-[#f4efe6] truncate">
            {nextEvent.name}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-1.5 rounded-[6px] px-2.5 py-1"
            style={{
              backgroundColor: '#12110e',
              border: '1px solid #26231c',
            }}
          >
            <span
              className={`text-xs font-bold tabular-nums ${
                isPauseWindow
                  ? 'text-[#e5584f]'
                  : isWithin60m
                    ? 'text-[#d9b25a]'
                    : 'text-[#f4efe6]'
              }`}
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {liveCountdownStr}
            </span>
          </div>

          {nextEvent.decisionDirection === 'BULLISH' ? (
            <span
              className="px-2.5 py-1 rounded-[6px] text-xs font-bold tracking-wide flex items-center gap-1.5"
              style={{
                backgroundColor: 'rgba(63, 191, 143, 0.14)',
                border: '1px solid rgba(63, 191, 143, 0.45)',
                color: '#3fbf8f',
              }}
            >
              <span>BULLISH</span>
              <span
                className="tabular-nums font-bold"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                {nextEvent.confidencePercent ?? 0}%
              </span>
            </span>
          ) : nextEvent.decisionDirection === 'BEARISH' ? (
            <span
              className="px-2.5 py-1 rounded-[6px] text-xs font-bold tracking-wide flex items-center gap-1.5"
              style={{
                backgroundColor: 'rgba(229, 88, 79, 0.14)',
                border: '1px solid rgba(229, 88, 79, 0.45)',
                color: '#e5584f',
              }}
            >
              <span>BEARISH</span>
              <span
                className="tabular-nums font-bold"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                {nextEvent.confidencePercent ?? 0}%
              </span>
            </span>
          ) : (
            <span
              className="px-2.5 py-1 rounded-[6px] text-xs font-semibold"
              style={{
                backgroundColor: '#12110e',
                border: '1px solid #26231c',
                color: '#8e8779',
              }}
            >
              Pending
            </span>
          )}
        </div>
      </div>

      {isPauseWindow && (
        <div
          className="pt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs"
          style={{
            borderTop: '1px solid rgba(229, 88, 79, 0.3)',
            color: '#e5584f',
          }}
        >
          <span className="font-bold uppercase tracking-wider">News pause active</span>
        </div>
      )}
    </div>
  );
};
