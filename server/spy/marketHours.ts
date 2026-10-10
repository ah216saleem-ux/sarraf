/**
 * US Equity Market Hours Engine (New York Regular Session 09:30 - 16:00 ET)
 * Handles DST automatically via America/New_York timezone and US Holiday calendar.
 */

import { SpyMarketHours, SpyExpiryOption, SpyExpiryStatus } from './types.ts';

// Standard US Market Holidays for 2025-2027 (NYSE / NASDAQ calendar)
const US_HOLIDAYS_MAP: Record<string, string> = {
  // 2025
  '2025-01-01': "New Year's Day",
  '2025-01-20': 'Martin Luther King Jr. Day',
  '2025-02-17': "Presidents' Day",
  '2025-04-18': 'Good Friday',
  '2025-05-26': 'Memorial Day',
  '2025-06-19': 'Juneteenth National Independence Day',
  '2025-07-04': 'Independence Day',
  '2025-09-01': 'Labor Day',
  '2025-11-27': 'Thanksgiving Day',
  '2025-12-25': 'Christmas Day',

  // 2026
  '2026-01-01': "New Year's Day",
  '2026-01-19': 'Martin Luther King Jr. Day',
  '2026-02-16': "Presidents' Day",
  '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth National Independence Day',
  '2026-07-03': 'Independence Day (Observed)',
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving Day',
  '2026-12-25': 'Christmas Day',

  // 2027
  '2027-01-01': "New Year's Day",
  '2027-01-18': 'Martin Luther King Jr. Day',
  '2027-02-15': "Presidents' Day",
  '2027-03-26': 'Good Friday',
  '2027-05-31': 'Memorial Day',
  '2027-06-18': 'Juneteenth (Observed)',
  '2027-07-05': 'Independence Day (Observed)',
  '2027-09-06': 'Labor Day',
  '2027-11-25': 'Thanksgiving Day',
  '2027-12-24': 'Christmas Day (Observed)',
};

export interface NewYorkTimeComponents {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  hour: number; // 0-23
  minute: number; // 0-59
  second: number;
  dateKey: string; // YYYY-MM-DD
  minutesSinceMidnight: number;
}

/**
 * Accurately parses current time into New York local time components
 */
export function getNewYorkTime(now = new Date()): NewYorkTimeComponents {
  // Format into New York timezone parts
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(now);
  const partMap: Record<string, string> = {};
  for (const part of parts) {
    partMap[part.type] = part.value;
  }

  const year = parseInt(partMap.year, 10);
  const month = parseInt(partMap.month, 10);
  const day = parseInt(partMap.day, 10);
  const hour = parseInt(partMap.hour, 10);
  const minute = parseInt(partMap.minute, 10);
  const second = parseInt(partMap.second, 10);

  const weekdayStr = partMap.weekday; // 'Sun', 'Mon', etc.
  const weekdayLookup: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = weekdayLookup[weekdayStr] ?? 0;

  const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const minutesSinceMidnight = hour * 60 + minute;

  return {
    year,
    month,
    day,
    dayOfWeek,
    hour,
    minute,
    second,
    dateKey,
    minutesSinceMidnight,
  };
}

/**
 * Calculates next market open ISO string and human readable time
 */
export function calculateNextMarketOpen(nyTime: NewYorkTimeComponents): string {
  // We want to find the next valid weekday 09:30 ET that is not a holiday
  let checkYear = nyTime.year;
  let checkMonth = nyTime.month;
  let checkDay = nyTime.day;

  // If today is a weekday and before 09:30 ET and not a holiday, today 09:30 ET is next open
  const isTodayWeekday = nyTime.dayOfWeek >= 1 && nyTime.dayOfWeek <= 5;
  const isTodayHoliday = !!US_HOLIDAYS_MAP[nyTime.dateKey];

  if (isTodayWeekday && !isTodayHoliday && nyTime.minutesSinceMidnight < 570) {
    return `${nyTime.dateKey} 09:30:00 ET`;
  }

  // Otherwise start searching from tomorrow
  let curr = new Date(Date.UTC(nyTime.year, nyTime.month - 1, nyTime.day + 1, 13, 30)); // approx 09:30 ET in UTC
  for (let i = 0; i < 14; i++) {
    const checkNY = getNewYorkTime(curr);
    const isWkday = checkNY.dayOfWeek >= 1 && checkNY.dayOfWeek <= 5;
    const isHol = !!US_HOLIDAYS_MAP[checkNY.dateKey];
    if (isWkday && !isHol) {
      return `${checkNY.dateKey} 09:30:00 ET`;
    }
    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  return 'Next Regular Session 09:30 ET';
}

/**
 * Evaluates full US Equity market hours status
 */
export function evaluateSpyMarketHours(now = new Date()): SpyMarketHours {
  const ny = getNewYorkTime(now);

  const isWeekend = ny.dayOfWeek === 0 || ny.dayOfWeek === 6;
  const holidayName = US_HOLIDAYS_MAP[ny.dateKey];
  const isHoliday = !!holidayName;

  // Regular Trading Hours: 09:30 to 16:00 ET
  // 09:30 = 9 * 60 + 30 = 570 minutes
  // 16:00 = 16 * 60 = 960 minutes
  const regularOpenMin = 570;
  const regularCloseMin = 960;

  // Pre-market: 04:00 to 09:30 ET (240 to 570)
  // After-hours: 16:00 to 20:00 ET (960 to 1200)

  let session: SpyMarketHours['session'] = 'CLOSED';
  let marketOpen = false;
  let minutesToClose = 0;

  if (isWeekend) {
    session = 'WEEKEND';
  } else if (isHoliday) {
    session = 'HOLIDAY';
  } else if (ny.minutesSinceMidnight >= regularOpenMin && ny.minutesSinceMidnight < regularCloseMin) {
    session = 'REGULAR';
    marketOpen = true;
    minutesToClose = regularCloseMin - ny.minutesSinceMidnight;
  } else if (ny.minutesSinceMidnight >= 240 && ny.minutesSinceMidnight < regularOpenMin) {
    session = 'PRE_MARKET';
  } else if (ny.minutesSinceMidnight >= regularCloseMin && ny.minutesSinceMidnight < 1200) {
    session = 'AFTER_HOURS';
  } else {
    session = 'CLOSED';
  }

  const nextOpen = calculateNextMarketOpen(ny);
  const currentTimeET = `${ny.dateKey} ${String(ny.hour).padStart(2, '0')}:${String(ny.minute).padStart(2, '0')}:${String(ny.second).padStart(2, '0')} ET`;

  return {
    marketOpen,
    session,
    minutesToClose,
    nextOpen,
    currentTimeET,
    isHoliday,
    holidayName,
  };
}

/**
 * Returns available expiry options with enablement status based on minutes to market close and lock/cooldown
 */
export function getExpiryOptionsStatus(
  marketHours: SpyMarketHours,
  lockStatusChecker?: (expiry: SpyExpiryOption) => {
    isLocked: boolean;
    isCooldown: boolean;
    cooldownSecondsLeft: number;
    lockReason?: string;
  }
): SpyExpiryStatus[] {
  const { marketOpen, minutesToClose } = marketHours;

  const definitions: Array<{ expiry: SpyExpiryOption; label: string; durationMinutes: number }> = [
    { expiry: '15m', label: '15 MIN', durationMinutes: 15 },
    { expiry: '30m', label: '30 MIN', durationMinutes: 30 },
    { expiry: '45m', label: '45 MIN', durationMinutes: 45 },
    { expiry: '1H', label: '1 HOUR', durationMinutes: 60 },
    { expiry: '4H', label: '4 HOURS', durationMinutes: 240 },
    { expiry: 'CLOSE', label: 'MARKET CLOSE', durationMinutes: Math.max(1, minutesToClose) },
  ];

  return definitions.map((def) => {
    if (!marketOpen) {
      return {
        ...def,
        enabled: false,
        disabledReason: 'Market is currently closed (09:30-16:00 ET regular session only)',
      };
    }

    // Check lock/cooldown
    if (lockStatusChecker) {
      const lock = lockStatusChecker(def.expiry);
      if (lock.isLocked) {
        return {
          ...def,
          enabled: false,
          isLocked: lock.isLocked,
          isCooldown: lock.isCooldown,
          cooldownSecondsLeft: lock.cooldownSecondsLeft,
          lockReason: lock.lockReason,
          disabledReason: lock.lockReason,
        };
      }
    }

    if (def.expiry === 'CLOSE') {
      // CLOSE is valid as long as regular session is open and at least 5 minutes remain
      const enabled = minutesToClose >= 5;
      return {
        ...def,
        enabled,
        disabledReason: enabled ? undefined : 'Less than 5 minutes remaining to market close',
      };
    }

    // A chip is disabled if the expiry duration exceeds remaining minutes to close
    const enabled = minutesToClose >= def.durationMinutes;
    return {
      ...def,
      enabled,
      disabledReason: enabled
        ? undefined
        : `Expiry (${def.label}) exceeds remaining session (${minutesToClose}m left until 16:00 ET close)`,
    };
  });
}
