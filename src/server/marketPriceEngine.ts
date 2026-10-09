import fs from 'fs';
import path from 'path';
import { DATA_DIR, writeJsonAtomic } from './deploymentSafety.ts';
import { getCandleStore } from './candleEngine.ts';

export const LAST_TICK_FILE = path.resolve(DATA_DIR, 'lastTick.json');

export type PriceStatus = 'LIVE' | 'MARKET_CLOSED' | 'FEED_STALE' | 'FEED_OFFLINE';

export interface PersistedTickData {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  spread: number;
  dayDiffPercent: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  timestamp: string; // ISO string from source
  lastReceivedAt: number; // Unix epoch ms
  source: string;
  marketState?: string;
}

export interface MarketScheduleResult {
  isOpen: boolean;
  state: 'OPEN' | 'WEEKEND_CLOSE' | 'DAILY_BREAK';
  nextOpenTime: string | null; // ISO UTC or null if open
  nextCloseTime: string | null; // ISO UTC or null if closed
}

export interface NYTimeParts {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number; // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
  hour: number;
  minute: number;
  second: number;
}

const nyPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hour12: false,
});

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getNYParts(date: Date): NYTimeParts {
  const parts = nyPartsFormatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    dayOfWeek: WEEKDAY_MAP[map.weekday] ?? 0,
    hour: parseInt(map.hour === '24' ? '0' : map.hour, 10),
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
  };
}

/**
 * Creates an exact UTC Date from target wall-clock parameters in America/New_York.
 * Fully DST-aware (handles EDT UTC-4 and EST UTC-5 dynamically).
 */
export function createDateFromNY(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number = 0,
  second: number = 0
): Date {
  // Start with initial guess assuming UTC-4
  let d = new Date(Date.UTC(year, month - 1, day, hour + 4, minute, second));
  for (let i = 0; i < 4; i++) {
    const parts = getNYParts(d);
    const targetMin = Date.UTC(year, month - 1, day, hour, minute, second) / 60000;
    const currentMin =
      Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) / 60000;
    const diffMin = targetMin - currentMin;
    if (diffMin === 0) break;
    d = new Date(d.getTime() + diffMin * 60000);
  }
  return d;
}

// Institutional Gold / Spot market schedule (DST-aware America/New_York):
// - Weekly close: Friday 17:00 America/New_York
// - Weekly open: Sunday 18:00 America/New_York
// - Daily break: Monday-Thursday 17:00-18:00 America/New_York
export function getMarketSchedule(now: Date = new Date()): MarketScheduleResult {
  const ny = getNYParts(now);
  const timeVal = ny.hour * 60 + ny.minute;

  // 1. Weekend Close: Friday 17:00 NY through Sunday 18:00 NY
  if (ny.dayOfWeek === 5 && timeVal >= 17 * 60) {
    const nextOpen = createDateFromNY(ny.year, ny.month, ny.day + 2, 18, 0, 0);
    return {
      isOpen: false,
      state: 'WEEKEND_CLOSE',
      nextOpenTime: nextOpen.toISOString(),
      nextCloseTime: null,
    };
  }

  if (ny.dayOfWeek === 6) {
    const nextOpen = createDateFromNY(ny.year, ny.month, ny.day + 1, 18, 0, 0);
    return {
      isOpen: false,
      state: 'WEEKEND_CLOSE',
      nextOpenTime: nextOpen.toISOString(),
      nextCloseTime: null,
    };
  }

  if (ny.dayOfWeek === 0 && timeVal < 18 * 60) {
    const nextOpen = createDateFromNY(ny.year, ny.month, ny.day, 18, 0, 0);
    return {
      isOpen: false,
      state: 'WEEKEND_CLOSE',
      nextOpenTime: nextOpen.toISOString(),
      nextCloseTime: null,
    };
  }

  // 2. Daily Maintenance Break: Monday-Thursday 17:00 to 18:00 NY
  if (ny.dayOfWeek >= 1 && ny.dayOfWeek <= 4 && timeVal >= 17 * 60 && timeVal < 18 * 60) {
    const nextOpen = createDateFromNY(ny.year, ny.month, ny.day, 18, 0, 0);
    return {
      isOpen: false,
      state: 'DAILY_BREAK',
      nextOpenTime: nextOpen.toISOString(),
      nextCloseTime: null,
    };
  }

  // 3. Market is officially OPEN: compute nextCloseTime in America/New_York
  let nextClose: Date;
  if (ny.dayOfWeek === 0) {
    // Sunday >= 18:00 NY -> closes Monday 17:00 NY
    nextClose = createDateFromNY(ny.year, ny.month, ny.day + 1, 17, 0, 0);
  } else if (timeVal < 17 * 60) {
    // Weekday before 17:00 NY -> closes today at 17:00 NY
    nextClose = createDateFromNY(ny.year, ny.month, ny.day, 17, 0, 0);
  } else {
    // Weekday (Mon-Thu) after 18:00 NY -> closes tomorrow at 17:00 NY
    nextClose = createDateFromNY(ny.year, ny.month, ny.day + 1, 17, 0, 0);
  }

  return {
    isOpen: true,
    state: 'OPEN',
    nextOpenTime: null,
    nextCloseTime: nextClose.toISOString(),
  };
}

// In-memory last valid tick cache
let lastValidTick: PersistedTickData = {
  symbol: 'XAUUSD',
  price: 4165.5,
  bid: 4165.35,
  ask: 4165.65,
  high: 4182.2,
  low: 4148.8,
  open: 4158.0,
  previousClose: 4155.0,
  spread: 0.3,
  dayDiffPercent: 0.25,
  direction: 'FLAT',
  timestamp: new Date().toISOString(),
  lastReceivedAt: Date.now(),
  source: 'biquote.io (MetaTrader 5)',
};

// Load last persisted tick from disk on startup
export function loadLastTickFromDisk(): PersistedTickData {
  try {
    console.log(`[MARKET PRICE] Resolved lastTick.json path: ${LAST_TICK_FILE} (under DATA_DIR: ${DATA_DIR})`);
    if (fs.existsSync(LAST_TICK_FILE)) {
      const raw = fs.readFileSync(LAST_TICK_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data && typeof data.price === 'number') {
        lastValidTick = {
          ...lastValidTick,
          ...data,
        };
        console.log(`[MARKET PRICE] Restored last valid tick from disk: $${lastValidTick.price} (${lastValidTick.timestamp})`);
      }
    }
  } catch (err: any) {
    console.warn('[MARKET PRICE] Failed to load lastTick.json from disk:', err.message);
  }
  return lastValidTick;
}

// Save last valid tick atomically to disk
export function saveLastTickToDisk(): void {
  try {
    writeJsonAtomic(LAST_TICK_FILE, lastValidTick);
  } catch (err: any) {
    console.warn('[MARKET PRICE] Failed to save lastTick.json:', err.message);
  }
}

function getComputedPreviousClose(): number {
  try {
    const store = getCandleStore();
    if (store && Array.isArray(store.D1) && store.D1.length >= 2) {
      // Completed previous D1 candle close
      const prevD1 = store.D1[store.D1.length - 2];
      if (prevD1 && typeof prevD1.close === 'number' && prevD1.close > 0) {
        return Number(prevD1.close.toFixed(2));
      }
    } else if (store && Array.isArray(store.D1) && store.D1.length === 1) {
      const d1 = store.D1[0];
      if (d1 && typeof d1.open === 'number' && d1.open > 0) {
        return Number(d1.open.toFixed(2));
      }
    }
  } catch {}
  return lastValidTick.previousClose && lastValidTick.previousClose > 0
    ? lastValidTick.previousClose
    : Number((lastValidTick.price - 5.0).toFixed(2));
}

function getRolling24hHighLow(currentPrice: number): { high: number; low: number } {
  let rollingHigh = currentPrice;
  let rollingLow = currentPrice;

  try {
    const store = getCandleStore();
    if (store && Array.isArray(store.H1) && store.H1.length > 0) {
      const recent24 = store.H1.slice(-24);
      if (recent24.length > 0) {
        const highs = recent24.map((c) => c.high).filter((h) => typeof h === 'number' && h > 0);
        const lows = recent24.map((c) => c.low).filter((l) => typeof l === 'number' && l > 0);
        if (highs.length > 0) rollingHigh = Math.max(...highs);
        if (lows.length > 0) rollingLow = Math.min(...lows);
      }
    }
  } catch {}

  // Price must ALWAYS be between Low and High (expand them dynamically if price breaks out)
  const finalHigh = Number(Math.max(rollingHigh, currentPrice, lastValidTick.high > 0 ? lastValidTick.high : currentPrice).toFixed(2));
  const finalLow = Number(Math.min(rollingLow, currentPrice, lastValidTick.low > 0 ? lastValidTick.low : currentPrice).toFixed(2));

  return { high: finalHigh, low: finalLow };
}

// Record an incoming real tick from feed
export function recordLiveTick(tick: {
  symbol?: string;
  price: number;
  bid: number;
  ask: number;
  high?: number;
  low?: number;
  open?: number;
  previousClose?: number;
  spread?: number;
  dayDiffPercent?: number;
  direction?: 'UP' | 'DOWN' | 'FLAT';
  timestamp?: string;
  source?: string;
  marketState?: string;
  lastReceivedAt?: number;
}): PersistedTickData {
  const now = tick.lastReceivedAt ?? Date.now();
  const prevPrice = lastValidTick.price;
  const direction: 'UP' | 'DOWN' | 'FLAT' =
    tick.direction ||
    (tick.price > prevPrice ? 'UP' : tick.price < prevPrice ? 'DOWN' : 'FLAT');

  const computedPrevClose = getComputedPreviousClose();
  const { high: rollingHigh, low: rollingLow } = getRolling24hHighLow(tick.price);
  const dayDiffPercent = computedPrevClose > 0
    ? Number((((tick.price - computedPrevClose) / computedPrevClose) * 100).toFixed(2))
    : 0;

  lastValidTick = {
    symbol: tick.symbol || 'XAUUSD',
    price: Number(tick.price.toFixed(2)),
    bid: Number(tick.bid.toFixed(2)),
    ask: Number(tick.ask.toFixed(2)),
    high: Math.max(rollingHigh, tick.high ?? rollingHigh),
    low: Math.min(rollingLow, tick.low ?? rollingLow),
    open: Number((tick.open ?? lastValidTick.open ?? computedPrevClose).toFixed(2)),
    previousClose: computedPrevClose,
    spread: Number((tick.spread ?? (tick.ask - tick.bid)).toFixed(2)),
    dayDiffPercent,
    direction,
    timestamp: tick.timestamp || new Date().toISOString(),
    lastReceivedAt: now,
    source: tick.source || 'biquote.io (MetaTrader 5)',
    marketState: tick.marketState,
  };

  return lastValidTick;
}

export function getLastValidTick(): PersistedTickData {
  return lastValidTick;
}

// Evaluate status according to A1 requirements:
// - Status = LIVE | MARKET_CLOSED | FEED_STALE | FEED_OFFLINE
// - use feed marketState when present, otherwise schedule fallback
// - Scheduled closed hours = MARKET_CLOSED
// - Scheduled open hours with tick older than 5s = FEED_STALE, older than 60s = FEED_OFFLINE
export function evaluateMarketPriceStatus(now: Date = new Date()): {
  status: PriceStatus;
  isLive: boolean;
  quoteAgeSeconds: number;
  nextOpenTime: string | null;
  nextCloseTime: string | null;
  tick: PersistedTickData;
} {
  const schedule = getMarketSchedule(now);
  const tick = getLastValidTick();
  const ageSeconds = Math.max(0, Math.round((now.getTime() - tick.lastReceivedAt) / 1000));

  const feedStateClosed =
    tick.marketState?.toUpperCase() === 'CLOSED' ||
    tick.marketState?.toUpperCase() === 'OFFLINE';

  // 1. If feed reports closed or schedule is in closed hours -> MARKET_CLOSED
  if (feedStateClosed || !schedule.isOpen) {
    let nextOpen = schedule.nextOpenTime;
    if (!nextOpen) {
      // If feed reports closed during scheduled open hours, compute next scheduled opening in America/New_York
      const ny = getNYParts(now);
      const timeVal = ny.hour * 60 + ny.minute;
      if (ny.dayOfWeek === 5) {
        // Friday at any time -> opens Sunday 18:00 NY
        nextOpen = createDateFromNY(ny.year, ny.month, ny.day + 2, 18, 0, 0).toISOString();
      } else if (ny.dayOfWeek === 6) {
        // Saturday -> opens Sunday 18:00 NY
        nextOpen = createDateFromNY(ny.year, ny.month, ny.day + 1, 18, 0, 0).toISOString();
      } else if (ny.dayOfWeek === 0) {
        if (timeVal < 18 * 60) {
          nextOpen = createDateFromNY(ny.year, ny.month, ny.day, 18, 0, 0).toISOString();
        } else {
          nextOpen = createDateFromNY(ny.year, ny.month, ny.day + 1, 18, 0, 0).toISOString();
        }
      } else {
        // Monday-Thursday
        if (timeVal < 17 * 60) {
          nextOpen = createDateFromNY(ny.year, ny.month, ny.day, 18, 0, 0).toISOString();
        } else {
          nextOpen = createDateFromNY(ny.year, ny.month, ny.day + 1, 18, 0, 0).toISOString();
        }
      }
    }

    return {
      status: 'MARKET_CLOSED',
      isLive: false,
      quoteAgeSeconds: ageSeconds,
      nextOpenTime: nextOpen,
      nextCloseTime: null,
      tick,
    };
  }

  // 2. Scheduled OPEN: Evaluate feed freshness
  if (ageSeconds <= 5) {
    return {
      status: 'LIVE',
      isLive: true,
      quoteAgeSeconds: ageSeconds,
      nextOpenTime: null,
      nextCloseTime: schedule.nextCloseTime,
      tick,
    };
  }

  if (ageSeconds <= 60) {
    return {
      status: 'FEED_STALE',
      isLive: false,
      quoteAgeSeconds: ageSeconds,
      nextOpenTime: null,
      nextCloseTime: schedule.nextCloseTime,
      tick,
    };
  }

  return {
    status: 'FEED_OFFLINE',
    isLive: false,
    quoteAgeSeconds: ageSeconds,
    nextOpenTime: null,
    nextCloseTime: schedule.nextCloseTime,
    tick,
  };
}
