import React, { useEffect, useState, memo } from 'react';
import { Globe, Clock } from 'lucide-react';

interface SessionConfig {
  id: string;
  name: string;
  timeZone: string;
  openHourLocal: number; // e.g. 8 for 08:00 local time (DST-adjusted automatically by IANA zone)
  closeHourLocal: number; // e.g. 17 for 17:00 local time
}

const SESSIONS: SessionConfig[] = [
  {
    id: 'sydney',
    name: 'Sydney',
    timeZone: 'Australia/Sydney',
    openHourLocal: 7,
    closeHourLocal: 16,
  },
  {
    id: 'tokyo',
    name: 'Tokyo',
    timeZone: 'Asia/Tokyo',
    openHourLocal: 9,
    closeHourLocal: 18,
  },
  {
    id: 'london',
    name: 'London',
    timeZone: 'Europe/London',
    openHourLocal: 8,
    closeHourLocal: 17,
  },
  {
    id: 'newyork',
    name: 'New York',
    timeZone: 'America/New_York',
    openHourLocal: 8,
    closeHourLocal: 17,
  },
];

function formatDurationMinutes(totalMinutes: number): string {
  const clamped = Math.max(1, Math.round(totalMinutes));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  if (hours > 0) {
    return `${hours}h ${String(mins).padStart(2, '0')}m`;
  }
  return `${mins}m`;
}

// Gold spot weekend closure: Fri 22:00 UTC -> Sun 23:00 UTC
function getGlobalWeekendClosure(now: Date): {
  isClosed: boolean;
  minutesUntilSundayOpen: number;
} {
  const utcDay = now.getUTCDay(); // 0 = Sun, 5 = Fri, 6 = Sat
  const utcHours = now.getUTCHours();
  const utcMins = now.getUTCMinutes();
  const currentDayMinutes = utcHours * 60 + utcMins;

  // Friday >= 22:00 UTC
  if (utcDay === 5 && currentDayMinutes >= 22 * 60) {
    const minsLeftFri = 24 * 60 - currentDayMinutes;
    const minsSat = 24 * 60;
    const minsSun = 23 * 60;
    return {
      isClosed: true,
      minutesUntilSundayOpen: minsLeftFri + minsSat + minsSun,
    };
  }

  // All day Saturday
  if (utcDay === 6) {
    const minsLeftSat = 24 * 60 - currentDayMinutes;
    const minsSun = 23 * 60;
    return {
      isClosed: true,
      minutesUntilSundayOpen: minsLeftSat + minsSun,
    };
  }

  // Sunday < 23:00 UTC
  if (utcDay === 0 && currentDayMinutes < 23 * 60) {
    return {
      isClosed: true,
      minutesUntilSundayOpen: 23 * 60 - currentDayMinutes,
    };
  }

  return { isClosed: false, minutesUntilSundayOpen: 0 };
}

function getZoneParts(now: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = dtf.formatToParts(now);
  let hour = 0;
  let minute = 0;
  let weekday = 'Mon';
  for (const p of parts) {
    if (p.type === 'hour') hour = parseInt(p.value, 10) % 24;
    if (p.type === 'minute') minute = parseInt(p.value, 10);
    if (p.type === 'weekday') weekday = p.value;
  }
  return {
    hour,
    minute,
    weekday,
    localTimeStr: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

function computeSessionState(now: Date, session: SessionConfig) {
  const weekend = getGlobalWeekendClosure(now);
  const { hour, minute, localTimeStr } = getZoneParts(now, session.timeZone);
  const curMins = hour * 60 + minute;
  const openMins = session.openHourLocal * 60;
  const closeMins = session.closeHourLocal * 60;

  if (weekend.isClosed) {
    // During global weekend closure (Fri 22:00 UTC -> Sun 23:00 UTC), all gold desks are closed
    return {
      isOpen: false,
      localTimeStr,
      countdownText: `Opens in ${formatDurationMinutes(weekend.minutesUntilSundayOpen)}`,
    };
  }

  const isOpen = curMins >= openMins && curMins < closeMins;
  if (isOpen) {
    const minsToClose = closeMins - curMins;
    // Also cap by Friday 22:00 UTC if Friday close arrives first
    const utcDay = now.getUTCDay();
    const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
    const minsToFriClose =
      utcDay === 5 && utcMins < 22 * 60 ? 22 * 60 - utcMins : Infinity;
    const effectiveClose = Math.min(minsToClose, minsToFriClose);
    return {
      isOpen: true,
      localTimeStr,
      countdownText: `Closes in ${formatDurationMinutes(effectiveClose)}`,
    };
  }

  // Closed on an active trading day: calculate minutes until next local open
  let minsToOpen =
    curMins < openMins ? openMins - curMins : 24 * 60 - curMins + openMins;

  // If next open falls inside the Friday 22:00 UTC weekend close, add the weekend duration
  const utcDay = now.getUTCDay();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (utcDay === 5 && utcMins + minsToOpen >= 22 * 60) {
    const minsUntilSunOpen = 24 * 60 - utcMins + 24 * 60 + 23 * 60;
    minsToOpen = Math.max(minsToOpen, minsUntilSunOpen);
  }

  return {
    isOpen: false,
    localTimeStr,
    countdownText: `Opens in ${formatDurationMinutes(minsToOpen)}`,
  };
}

export const MarketSessionsClock: React.FC = memo(() => {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const utcStr = `${String(now.getUTCHours()).padStart(2, '0')}:${String(
    now.getUTCMinutes()
  ).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')} UTC`;

  const localStr = `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes()
  ).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} LOCAL`;

  const weekend = getGlobalWeekendClosure(now);

  return (
    <div className="rv rv-d3 sarraf-glass p-3.5 sm:p-4 max-w-lg mt-2.5 font-mono">
      <span className="sarraf-corner-tl" />
      <span className="sarraf-corner-tr" />
      <span className="sarraf-corner-bl" />
      <span className="sarraf-corner-br" />

      {/* Top row: Widget title + Live UTC & Local Clocks */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-white/10 text-[10px]">
        <div className="flex items-center gap-1.5 text-[#FFD97A] tracking-[0.2em] uppercase font-semibold">
          <Globe className="w-3 h-3 text-[#E8B84A]" />
          <span>GLOBAL BULLION SESSIONS</span>
          {weekend.isClosed && (
            <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/35 text-[8.5px] text-amber-300">
              WEEKEND CLOSED
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[10px] text-neutral-300 tabular-nums">
          <Clock className="w-3 h-3 text-[#E8B84A]" />
          <span className="text-white font-semibold">{utcStr}</span>
          <span className="text-neutral-600">·</span>
          <span className="text-neutral-400">{localStr}</span>
        </div>
      </div>

      {/* 4 Session Cards Grid: Sydney, Tokyo, London, New York */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {SESSIONS.map((session) => {
          const st = computeSessionState(now, session);
          return (
            <div
              key={session.id}
              className={`p-2 rounded-xl border transition-colors ${
                st.isOpen
                  ? 'bg-emerald-950/25 border-emerald-500/35'
                  : 'bg-black/45 border-white/8'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-bold text-white tracking-wider uppercase">
                  {session.name}
                </span>
                <span className="inline-flex items-center gap-1 text-[8.5px] font-semibold uppercase">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      st.isOpen
                        ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                        : 'bg-[#E8B84A]/75'
                    }`}
                  />
                  <span
                    className={
                      st.isOpen ? 'text-emerald-300' : 'text-[#FFD97A]/80'
                    }
                  >
                    {st.isOpen ? 'OPEN' : 'CLOSED'}
                  </span>
                </span>
              </div>

              <div className="mt-1 flex items-baseline justify-between text-[10px] tabular-nums">
                <span className="text-neutral-400">{st.localTimeStr}</span>
              </div>

              <div className="mt-0.5 text-[9px] text-neutral-400 truncate tabular-nums">
                {st.countdownText}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

MarketSessionsClock.displayName = 'MarketSessionsClock';
