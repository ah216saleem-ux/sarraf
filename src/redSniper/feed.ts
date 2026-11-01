import { useState, useEffect, useRef, useCallback } from 'react';
import * as signalR from '@microsoft/signalr';
import { commandStore } from '../command/data/commandFeedStore';

export type RedSniperTimeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export type RedSniperConnectionStatus = 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';

export interface Candle {
  time: number; // UTC unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
  buyVol: number;
  sellVol: number;
}

export type RedSniperBarsMap = Record<RedSniperTimeframe, Candle[]>;

export interface RedSniperSessionInfo {
  tokyo: boolean;
  london: boolean;
  newYork: boolean;
  name: 'TOKYO' | 'LONDON' | 'NEW YORK' | 'LDN+NY' | 'OFF';
  window:
    | 'LONDON OPEN WINDOW'
    | 'NEW YORK OPEN WINDOW'
    | 'LONDON / NEW YORK OVERLAP'
    | 'ASIAN RANGE'
    | 'MARKET QUIET';
}

export interface Rolling60sFlow {
  tickCount: number;
  buyVol: number;
  sellVol: number;
  buyPct: number | null;
  sellPct: number | null;
}

export interface HistoryFromToLogEntry {
  page: number;
  limit: number;
  from: string | null;
  to: string | null;
  returnedBars: number;
  newOlderBarsAdded: number;
}

export interface TimeframeHistoryLog {
  tf: RedSniperTimeframe;
  source: 'store' | 'broker';
  barsLoaded: number;
  oldestCandleTime: number | null;
  oldestCandleIso: string | null;
  builtFromM1: boolean;
  targetBars: number;
  requestedBars: number;
  finalBarsLoaded: number;
  returnedBarsPerPage: number[];
  fromToUsed: HistoryFromToLogEntry[];
  historyLimitReached: string | null;
}

export type RedSniperHistoryDiagnosticsMap = Record<
  RedSniperTimeframe,
  TimeframeHistoryLog
>;

export interface RedSniperFeedState {
  bars: RedSniperBarsMap;
  historyDiagnostics: RedSniperHistoryDiagnosticsMap;
  livePrice: number | null;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  lastTickTime: number | null;
  connectionStatus: RedSniperConnectionStatus;
  isMarketClosed: boolean;
  isLoading: boolean;
  session: RedSniperSessionInfo;
  rolling60sFlow: Rolling60sFlow;
}

export const RED_SNIPER_TIMEFRAMES: RedSniperTimeframe[] = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  '1d',
];

const DIRECT_FETCH_TIMEFRAMES: Exclude<RedSniperTimeframe, '3m'>[] = [
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  '1d',
];

export function getTimeframeSeconds(tf: RedSniperTimeframe): number {
  switch (tf) {
    case '1m':
      return 60;
    case '3m':
      return 180;
    case '5m':
      return 300;
    case '15m':
      return 900;
    case '30m':
      return 1800;
    case '1h':
      return 3600;
    case '4h':
      return 14400;
    case '1d':
      return 86400;
  }
}

export function getBucketStartSec(timestampSec: number, tf: RedSniperTimeframe): number {
  const periodSec = getTimeframeSeconds(tf);
  return Math.floor(timestampSec / periodSec) * periodSec;
}

/**
 * Pure session calculator using Intl.DateTimeFormat in Asia/Tokyo, Europe/London, and America/New_York.
 * Tokyo: 09:00-18:00 JST
 * London: 08:00-16:30 Europe/London
 * New York: 08:00-17:00 America/New_York
 * Weekends closed.
 */
export function sessions(now: Date = new Date()): RedSniperSessionInfo {
  const extractLocalTime = (timeZone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    let weekday = '';
    let hour = 0;
    let minute = 0;

    for (const part of parts) {
      if (part.type === 'weekday') weekday = part.value;
      if (part.type === 'hour') hour = parseInt(part.value, 10) % 24;
      if (part.type === 'minute') minute = parseInt(part.value, 10);
    }

    const isWeekend = weekday === 'Sat' || weekday === 'Sun';
    const minutesOfDay = hour * 60 + minute;
    return { isWeekend, minutesOfDay };
  };

  const tky = extractLocalTime('Asia/Tokyo');
  const ldn = extractLocalTime('Europe/London');
  const ny = extractLocalTime('America/New_York');

  // Tokyo: 09:00 (540) to 18:00 (1080)
  const tokyo = !tky.isWeekend && tky.minutesOfDay >= 9 * 60 && tky.minutesOfDay < 18 * 60;
  // London: 08:00 (480) to 16:30 (990)
  const london = !ldn.isWeekend && ldn.minutesOfDay >= 8 * 60 && ldn.minutesOfDay < 16 * 60 + 30;
  // New York: 08:00 (480) to 17:00 (1020)
  const newYork = !ny.isWeekend && ny.minutesOfDay >= 8 * 60 && ny.minutesOfDay < 17 * 60;

  let name: RedSniperSessionInfo['name'] = 'OFF';
  let window: RedSniperSessionInfo['window'] = 'MARKET QUIET';

  if (london && newYork) {
    name = 'LDN+NY';
    window = 'LONDON / NEW YORK OVERLAP';
  } else if (london) {
    name = 'LONDON';
    window = 'LONDON OPEN WINDOW';
  } else if (newYork) {
    name = 'NEW YORK';
    window = 'NEW YORK OPEN WINDOW';
  } else if (tokyo) {
    name = 'TOKYO';
    window = 'ASIAN RANGE';
  }

  return {
    tokyo,
    london,
    newYork,
    name,
    window,
  };
}

/**
 * Normalize raw candle from biquote.io /ohlc endpoint or server candle store.
 * Preserves existing buyVol/sellVol if present, otherwise initializes to 0 (never faked).
 */
export function normalizeRedSniperCandle(raw: any, tf: RedSniperTimeframe): Candle | null {
  if (!raw || typeof raw !== 'object') return null;

  const tRaw = raw.time ?? raw.openTime;
  let timeSec = 0;

  if (typeof tRaw === 'number') {
    timeSec = tRaw > 10_000_000_000 ? Math.floor(tRaw / 1000) : Math.floor(tRaw);
  } else if (typeof tRaw === 'string') {
    const parsed = Date.parse(tRaw);
    if (!Number.isNaN(parsed)) {
      timeSec = Math.floor(parsed / 1000);
    }
  }

  const open = Number(raw.open);
  const high = Number(raw.high);
  const low = Number(raw.low);
  const close = Number(raw.close);
  const tickVolume = Math.max(0, Number(raw.tickVolume ?? raw.volume ?? 0));

  if (
    !timeSec ||
    !Number.isFinite(open) ||
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    !Number.isFinite(close) ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0
  ) {
    return null;
  }

  const alignedTime = getBucketStartSec(timeSec, tf);
  const buyVol = typeof raw.buyVol === 'number' && Number.isFinite(raw.buyVol) ? Math.max(0, raw.buyVol) : 0;
  const sellVol = typeof raw.sellVol === 'number' && Number.isFinite(raw.sellVol) ? Math.max(0, raw.sellVol) : 0;

  return {
    time: alignedTime,
    open,
    high,
    low,
    close,
    tickVolume: Number.isFinite(tickVolume) ? tickVolume : 0,
    buyVol,
    sellVol,
  };
}

/**
 * Sort ascending by time and deduplicate by time (latest entry wins, preserving local buyVol/sellVol ratio scaled to official tickVolume).
 */
export function sortAndDedupeCandles(candles: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();

  for (const c of candles) {
    if (!c || !Number.isFinite(c.time) || c.time <= 0) continue;
    const prev = byTime.get(c.time);
    if (!prev) {
      byTime.set(c.time, { ...c });
    } else {
      const mergedTickVol = c.tickVolume > 0 ? c.tickVolume : prev.tickVolume;
      const incomingFlow = c.buyVol + c.sellVol;
      const prevFlow = prev.buyVol + prev.sellVol;

      let buyVol = c.buyVol;
      let sellVol = c.sellVol;

      if (incomingFlow === 0 && prevFlow > 0 && mergedTickVol > 0) {
        const buyRatio = prev.buyVol / prevFlow;
        buyVol = Math.round(mergedTickVol * buyRatio);
        sellVol = Math.max(0, mergedTickVol - buyVol);
      }

      byTime.set(c.time, {
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        tickVolume: mergedTickVol,
        buyVol,
        sellVol,
      });
    }
  }

  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

/**
 * Build higher timeframe bars (3m, 5m, 15m, 30m) by aggregating 1m bars aligned to UTC buckets.
 */
export function buildHigherTimeframeFrom1m(
  m1Bars: Candle[],
  tf: '3m' | '5m' | '15m' | '30m',
  existingBars: Candle[] = [],
  maxBars: number = 2000
): Candle[] {
  if (!m1Bars || m1Bars.length === 0) {
    return sortAndDedupeCandles(existingBars).slice(-maxBars);
  }

  const sorted1m = sortAndDedupeCandles(m1Bars);
  const buckets = new Map<number, Candle[]>();

  for (const bar of sorted1m) {
    const bucketSec = getBucketStartSec(bar.time, tf);
    const list = buckets.get(bucketSec);
    if (list) {
      list.push(bar);
    } else {
      buckets.set(bucketSec, [bar]);
    }
  }

  const existingByTime = new Map<number, Candle>();
  for (const b of existingBars) {
    existingByTime.set(b.time, b);
  }

  const aggregated: Candle[] = [];
  for (const [bucketSec, group] of buckets.entries()) {
    const open = group[0].open;
    const close = group[group.length - 1].close;
    let high = group[0].high;
    let low = group[0].low;
    let tickVolume = 0;
    let buyVol = 0;
    let sellVol = 0;

    for (const b of group) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      tickVolume += b.tickVolume;
      buyVol += b.buyVol;
      sellVol += b.sellVol;
    }

    const prevBar = existingByTime.get(bucketSec);
    if (buyVol + sellVol === 0 && prevBar && prevBar.buyVol + prevBar.sellVol > 0 && tickVolume > 0) {
      const ratio = prevBar.buyVol / (prevBar.buyVol + prevBar.sellVol);
      buyVol = Math.round(tickVolume * ratio);
      sellVol = Math.max(0, tickVolume - buyVol);
    } else if (buyVol + sellVol > 0 && tickVolume > 0 && buyVol + sellVol !== tickVolume) {
      const ratio = buyVol / (buyVol + sellVol);
      buyVol = Math.round(tickVolume * ratio);
      sellVol = Math.max(0, tickVolume - buyVol);
    }

    aggregated.push({
      time: bucketSec,
      open,
      high,
      low,
      close,
      tickVolume,
      buyVol,
      sellVol,
    });
  }

  return sortAndDedupeCandles([...existingBars, ...aggregated]).slice(-maxBars);
}

/**
 * Build 3m bars by aggregating 1m bars aligned to 180-second UTC buckets.
 */
export function build3mFrom1m(
  m1Bars: Candle[],
  existing3mBars: Candle[] = [],
  maxBars: number = 2000
): Candle[] {
  return buildHigherTimeframeFrom1m(m1Bars, '3m', existing3mBars, maxBars);
}

/**
 * Check if stored 1m bars cover the requested range for building 3m/5m/15m/30m.
 */
export function doesM1CoverTimeframeRange(
  m1Bars: Candle[],
  directBars: Candle[],
  tf: '3m' | '5m' | '15m' | '30m',
  targetBars: number = 400
): boolean {
  if (!m1Bars || m1Bars.length === 0) return false;
  if (tf === '3m') return true;
  if (!directBars || directBars.length === 0) return true;
  const agg = buildHigherTimeframeFrom1m(m1Bars, tf, [], 5000);
  if (agg.length >= targetBars) return true;
  if (agg.length >= directBars.length && agg[0].time <= directBars[0].time) {
    return true;
  }
  return false;
}

/**
 * Reconcile official broker OHLC + tickVolume into local bars while preserving local buyVol/sellVol ratio scaled to broker tickVolume.
 */
export function reconcileOfficialBars(
  localBars: Candle[],
  officialBars: Candle[],
  maxBars: number = 2000
): Candle[] {
  if (!officialBars || officialBars.length === 0) return localBars;

  const byTime = new Map<number, Candle>();
  for (const bar of localBars) {
    byTime.set(bar.time, { ...bar });
  }

  for (const off of officialBars) {
    const existing = byTime.get(off.time);
    let buyVol = 0;
    let sellVol = 0;

    if (existing) {
      const localFlowTotal = existing.buyVol + existing.sellVol;
      if (localFlowTotal > 0 && off.tickVolume > 0) {
        const buyRatio = existing.buyVol / localFlowTotal;
        buyVol = Math.round(off.tickVolume * buyRatio);
        sellVol = Math.max(0, off.tickVolume - buyVol);
      }
    }

    byTime.set(off.time, {
      time: off.time,
      open: off.open,
      high: off.high,
      low: off.low,
      close: off.close,
      tickVolume: off.tickVolume,
      buyVol,
      sellVol,
    });
  }

  return Array.from(byTime.values())
    .sort((a, b) => a.time - b.time)
    .slice(-maxBars);
}

async function fetchBrokerOhlcPage(
  interval: Exclude<RedSniperTimeframe, '3m'>,
  limit: number,
  fromIso?: string,
  toIso?: string
): Promise<Candle[]> {
  const params = new URLSearchParams({
    interval,
    limit: String(limit),
  });
  if (fromIso) params.set('from', fromIso);
  if (toIso) params.set('to', toIso);
  const query = params.toString();

  const urls = [
    `https://biquote.io/api/XAUUSD/ohlc?${query}`,
    `/api/doji/ohlc?${query}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const json = await res.json();
      const rawList =
        json?.data?.bars ||
        json?.bars ||
        json?.candles ||
        json?.data?.candles ||
        (Array.isArray(json) ? json : []);

      if (Array.isArray(rawList) && rawList.length > 0) {
        const normalized: Candle[] = [];
        for (let i = rawList.length - 1; i >= 0; i--) {
          const c = normalizeRedSniperCandle(rawList[i], interval);
          if (c) normalized.push(c);
        }
        if (normalized.length > 0) {
          return sortAndDedupeCandles(normalized);
        }
      }
    } catch {
      // Try next fallback URL
    }
  }

  return [];
}

export async function fetchBrokerOhlcWithDiagnostics(
  interval: Exclude<RedSniperTimeframe, '3m'>,
  limit: number
): Promise<{ bars: Candle[]; diagnostics: TimeframeHistoryLog }> {
  const targetBars =
    limit <= 20
      ? limit
      : interval === '4h'
      ? Math.max(400, limit)
      : interval === '1d'
      ? Math.max(300, limit)
      : Math.max(400, limit);

  const requestedBars = limit <= 20 ? limit : Math.max(1000, targetBars);
  const returnedBarsPerPage: number[] = [];
  const fromToUsed: HistoryFromToLogEntry[] = [];

  // Page 1: Try larger limit (1000) to capture maximum available bars in one request
  let collected = await fetchBrokerOhlcPage(interval, requestedBars);
  returnedBarsPerPage.push(collected.length);
  fromToUsed.push({
    page: 1,
    limit: requestedBars,
    from: null,
    to: null,
    returnedBars: collected.length,
    newOlderBarsAdded: collected.length,
  });

  if (collected.length === 0 || limit <= 20) {
    const sliced = collected.slice(-targetBars);
    const oldestTime = sliced.length > 0 ? sliced[0].time : null;
    return {
      bars: sliced,
      diagnostics: {
        tf: interval,
        source: 'broker',
        barsLoaded: sliced.length,
        oldestCandleTime: oldestTime,
        oldestCandleIso: oldestTime ? new Date(oldestTime * 1000).toISOString() : null,
        builtFromM1: false,
        targetBars,
        requestedBars,
        finalBarsLoaded: sliced.length,
        returnedBarsPerPage,
        fromToUsed,
        historyLimitReached:
          limit > 20 && sliced.length < targetBars
            ? `history limit reached: ${sliced.length} bars`
            : null,
      },
    };
  }

  // If fewer than targetBars candles were returned, paginate backward using chunked from/to windows
  const periodSec = getTimeframeSeconds(interval);
  let attempts = 0;
  while (collected.length < targetBars && attempts < 3) {
    attempts++;
    const oldestSec = collected[0]?.time;
    if (!oldestSec || oldestSec <= 0) break;

    const toSec = attempts === 1 ? oldestSec - periodSec : oldestSec;
    const chunkBars = attempts === 1 ? 250 : 500 * attempts;
    const fromIso = new Date((toSec - chunkBars * periodSec) * 1000).toISOString();
    const toIso = new Date(toSec * 1000).toISOString();

    const olderBatch = await fetchBrokerOhlcPage(
      interval,
      requestedBars,
      fromIso,
      toIso
    );
    const strictlyOlder = olderBatch.filter((b) => b.time < oldestSec);
    returnedBarsPerPage.push(olderBatch.length);
    fromToUsed.push({
      page: attempts + 1,
      limit: requestedBars,
      from: fromIso,
      to: toIso,
      returnedBars: olderBatch.length,
      newOlderBarsAdded: strictlyOlder.length,
    });

    if (strictlyOlder.length === 0) {
      if (attempts >= 2) break;
      continue;
    }
    collected = sortAndDedupeCandles([...strictlyOlder, ...collected]);
  }

  const finalBars = collected.slice(-Math.max(targetBars, 500));
  const historyLimitReached =
    finalBars.length < targetBars
      ? `history limit reached: ${finalBars.length} bars`
      : null;
  const oldestTime = finalBars.length > 0 ? finalBars[0].time : null;

  return {
    bars: finalBars,
    diagnostics: {
      tf: interval,
      source: 'broker',
      barsLoaded: finalBars.length,
      oldestCandleTime: oldestTime,
      oldestCandleIso: oldestTime ? new Date(oldestTime * 1000).toISOString() : null,
      builtFromM1: false,
      targetBars,
      requestedBars,
      finalBarsLoaded: finalBars.length,
      returnedBarsPerPage,
      fromToUsed,
      historyLimitReached,
    },
  };
}

/**
 * 1) SERVER CANDLE STORE FIRST:
 * Query GET /api/redsniper/candles?tf=...&limit=5000 first, and fall back to biquote only if it is empty.
 */
export async function fetchStoreCandlesFirstWithFallback(
  interval: Exclude<RedSniperTimeframe, '3m'>,
  limit: number = 5000
): Promise<{ bars: Candle[]; diagnostics: TimeframeHistoryLog }> {
  const targetBars =
    interval === '1m'
      ? Math.min(5000, limit)
      : interval === '1d'
      ? Math.max(300, Math.min(2000, limit))
      : Math.max(400, Math.min(2000, limit));

  try {
    const res = await fetch(
      `/api/redsniper/candles?tf=${encodeURIComponent(interval)}&limit=${limit}`,
      { headers: { Accept: 'application/json' } }
    );
    if (res.ok) {
      const json = await res.json();
      const rawCandles = Array.isArray(json?.candles) ? json.candles : [];
      if (rawCandles.length > 0) {
        const normalized: Candle[] = [];
        for (const r of rawCandles) {
          const c = normalizeRedSniperCandle(r, interval);
          if (c) normalized.push(c);
        }
        const deduped = sortAndDedupeCandles(normalized).slice(-limit);
        if (deduped.length > 0) {
          const oldestTime = deduped[0].time;
          const builtFromM1 = Boolean(json?.builtFromM1);
          const source: 'store' | 'broker' =
            json?.source === 'broker' ? 'broker' : 'store';
          return {
            bars: deduped,
            diagnostics: {
              tf: interval,
              source,
              barsLoaded: deduped.length,
              oldestCandleTime: oldestTime,
              oldestCandleIso: new Date(oldestTime * 1000).toISOString(),
              builtFromM1,
              targetBars,
              requestedBars: limit,
              finalBarsLoaded: deduped.length,
              returnedBarsPerPage: [deduped.length],
              fromToUsed: [
                {
                  page: 1,
                  limit,
                  from: new Date(oldestTime * 1000).toISOString(),
                  to: new Date(deduped[deduped.length - 1].time * 1000).toISOString(),
                  returnedBars: deduped.length,
                  newOlderBarsAdded: deduped.length,
                },
              ],
              historyLimitReached:
                deduped.length < 400
                  ? `history limit reached: ${deduped.length} bars`
                  : null,
            },
          };
        }
      }
    }
  } catch {
    // Fall back to broker if server store is unreachable or empty
  }

  return fetchBrokerOhlcWithDiagnostics(interval, 500);
}

export async function fetchBrokerOhlc(
  interval: Exclude<RedSniperTimeframe, '3m'>,
  limit: number
): Promise<Candle[]> {
  const res = await fetchBrokerOhlcWithDiagnostics(interval, limit);
  return res.bars;
}

const EMPTY_BARS_MAP: RedSniperBarsMap = {
  '1m': [],
  '3m': [],
  '5m': [],
  '15m': [],
  '30m': [],
  '1h': [],
  '4h': [],
  '1d': [],
};

function makeEmptyDiagnosticsMap(): RedSniperHistoryDiagnosticsMap {
  const out = {} as RedSniperHistoryDiagnosticsMap;
  for (const tf of RED_SNIPER_TIMEFRAMES) {
    out[tf] = {
      tf,
      source: 'store',
      barsLoaded: 0,
      oldestCandleTime: null,
      oldestCandleIso: null,
      builtFromM1: false,
      targetBars: tf === '4h' ? 400 : tf === '1d' ? 300 : tf === '3m' ? 160 : 400,
      requestedBars: tf === '3m' ? 0 : 5000,
      finalBarsLoaded: 0,
      returnedBarsPerPage: [],
      fromToUsed: [],
      historyLimitReached: null,
    };
  }
  return out;
}

export function useRedSniperFeed(): RedSniperFeedState {
  const [bars, setBars] = useState<RedSniperBarsMap>(EMPTY_BARS_MAP);
  const [historyDiagnostics, setHistoryDiagnostics] =
    useState<RedSniperHistoryDiagnosticsMap>(() => makeEmptyDiagnosticsMap());
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [bid, setBid] = useState<number | null>(null);
  const [ask, setAsk] = useState<number | null>(null);
  const [spread, setSpread] = useState<number | null>(null);
  const [lastTickTime, setLastTickTime] = useState<number | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<RedSniperConnectionStatus>('DISCONNECTED');
  const [isMarketClosed, setIsMarketClosed] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [session, setSession] = useState<RedSniperSessionInfo>(() => sessions());
  const [rolling60sFlow, setRolling60sFlow] = useState<Rolling60sFlow>({
    tickCount: 0,
    buyVol: 0,
    sellVol: 0,
    buyPct: null,
    sellPct: null,
  });

  const barsRef = useRef<RedSniperBarsMap>(EMPTY_BARS_MAP);
  const livePriceRef = useRef<number | null>(null);
  const bidRef = useRef<number | null>(null);
  const askRef = useRef<number | null>(null);
  const prevTickPriceRef = useRef<number | null>(null);
  const lastTickSideRef = useRef<'BUY' | 'SELL'>('BUY');
  const isMarketClosedRef = useRef<boolean>(false);
  const connectionStatusRef = useRef<RedSniperConnectionStatus>('DISCONNECTED');
  const isSyncingToCommandStoreRef = useRef<boolean>(false);
  const rollingTicksRef = useRef<Array<{ ts: number; side: 'BUY' | 'SELL'; vol: number }>>([]);

  useEffect(() => {
    connectionStatusRef.current = connectionStatus;
  }, [connectionStatus]);

  // Update session state every 15s
  useEffect(() => {
    const timer = setInterval(() => {
      setSession(sessions(new Date()));
    }, 15_000);
    return () => clearInterval(timer);
  }, []);

  // Unified handler for incoming ticks (SignalR ReceiveTick, fallback polling, commandStore)
  const applyIncomingQuote = useCallback(
    (
      quote: {
        mid?: number;
        price?: number;
        bid?: number;
        ask?: number;
        volume?: number;
        tickVolume?: number;
        marketState?: string;
        status?: string;
        marketOpen?: boolean;
        previousClose?: number;
        close?: number;
        dayDiffPercent?: number;
        timestamp?: string | number;
        time?: string | number;
      },
      fromCommandStore: boolean = false
    ) => {
      if (!quote) return;

      const stateStr = (quote.marketState || quote.status || '').toLowerCase();
      const closed =
        quote.marketOpen === false
          ? true
          : quote.marketOpen === true
          ? false
          : stateStr === 'closed' ||
            stateStr === 'offline' ||
            stateStr === 'market_closed';

      setIsMarketClosed(closed);
      isMarketClosedRef.current = closed;

      const nextBid =
        typeof quote.bid === 'number' && Number.isFinite(quote.bid) && quote.bid > 0
          ? Number(quote.bid.toFixed(2))
          : bidRef.current;
      const nextAsk =
        typeof quote.ask === 'number' && Number.isFinite(quote.ask) && quote.ask > 0
          ? Number(quote.ask.toFixed(2))
          : askRef.current;

      if (nextBid !== bidRef.current) {
        bidRef.current = nextBid;
        setBid(nextBid);
      }
      if (nextAsk !== askRef.current) {
        askRef.current = nextAsk;
        setAsk(nextAsk);
      }

      if (nextBid !== null && nextAsk !== null && nextAsk >= nextBid) {
        setSpread(Number((nextAsk - nextBid).toFixed(2)));
      }

      const rawMid =
        typeof quote.mid === 'number'
          ? quote.mid
          : typeof quote.price === 'number'
          ? quote.price
          : typeof quote.bid === 'number' && typeof quote.ask === 'number'
          ? (quote.bid + quote.ask) / 2
          : null;

      if (rawMid === null || !Number.isFinite(rawMid) || rawMid <= 0) return;

      const p = Number(rawMid.toFixed(2));
      const nowMs = Date.now();
      livePriceRef.current = p;
      setLivePrice(p);
      setLastTickTime(nowMs);

      // Synchronize with global commandStore if this quote came from SignalR / polling
      if (!fromCommandStore && !isSyncingToCommandStoreRef.current) {
        try {
          isSyncingToCommandStoreRef.current = true;
          commandStore.processIncomingFeedQuote({
            price: p,
            bid: nextBid ?? undefined,
            ask: nextAsk ?? undefined,
            previousClose:
              quote.previousClose ??
              quote.close ??
              (commandStore.previousClose || undefined),
            dayDiffPercent: quote.dayDiffPercent,
            marketOpen: !closed,
            timestamp: quote.timestamp
              ? new Date(quote.timestamp).toISOString()
              : new Date(nowMs).toISOString(),
          });
        } finally {
          isSyncingToCommandStoreRef.current = false;
        }
      }

      if (closed) {
        return;
      }

      // Classify tick as BUY or SELL using the tick rule:
      // price up vs previous tick = BUY, down = SELL, unchanged = same side as last
      let side: 'BUY' | 'SELL' = lastTickSideRef.current;
      const prevPrice = prevTickPriceRef.current;
      if (prevPrice !== null) {
        if (p > prevPrice) {
          side = 'BUY';
        } else if (p < prevPrice) {
          side = 'SELL';
        } else {
          side = lastTickSideRef.current;
        }
      } else {
        const m1List = barsRef.current['1m'];
        const currentM1Open =
          m1List && m1List.length > 0 ? m1List[m1List.length - 1].open : p;
        if (p > currentM1Open) side = 'BUY';
        else if (p < currentM1Open) side = 'SELL';
      }

      prevTickPriceRef.current = p;
      lastTickSideRef.current = side;

      // Increment tickVolume by 1 per tick (or by tick.volume if payload has a positive volume)
      const rawTickVol =
        typeof quote.volume === 'number' && Number.isFinite(quote.volume) && quote.volume > 0
          ? quote.volume
          : typeof quote.tickVolume === 'number' &&
            Number.isFinite(quote.tickVolume) &&
            quote.tickVolume > 0
          ? quote.tickVolume
          : 1;

      // Update rolling 60-second tick window (require >= 20 ticks before computing buy%/sell%)
      const cutoffMs = nowMs - 60_000;
      const updatedWindow = rollingTicksRef.current.filter((item) => item.ts >= cutoffMs);
      updatedWindow.push({ ts: nowMs, side, vol: rawTickVol });
      rollingTicksRef.current = updatedWindow;

      let winBuy = 0;
      let winSell = 0;
      for (const item of updatedWindow) {
        if (item.side === 'BUY') winBuy += item.vol;
        else winSell += item.vol;
      }
      const winTotal = winBuy + winSell;
      const hasEnoughTicks = updatedWindow.length >= 20 && winTotal > 0;
      const buyPct = hasEnoughTicks ? Math.round((winBuy / winTotal) * 100) : null;
      const sellPct = hasEnoughTicks && buyPct !== null ? 100 - buyPct : null;

      setRolling60sFlow({
        tickCount: updatedWindow.length,
        buyVol: winBuy,
        sellVol: winSell,
        buyPct,
        sellPct,
      });

      const rawTs = quote.timestamp ?? quote.time;
      let tickTimeMs = nowMs;
      if (typeof rawTs === 'number' && Number.isFinite(rawTs)) {
        tickTimeMs = rawTs > 10_000_000_000 ? rawTs : rawTs * 1000;
      } else if (typeof rawTs === 'string') {
        const parsed = Date.parse(rawTs);
        if (!Number.isNaN(parsed)) tickTimeMs = parsed;
      }
      const tickSec = Math.floor(tickTimeMs / 1000);

      // Update forming candle across ALL 8 timeframes (with UTC bucket rollover)
      const currentMap = barsRef.current;
      const nextMap: RedSniperBarsMap = { ...currentMap };

      for (const tf of RED_SNIPER_TIMEFRAMES) {
        const tfBars = nextMap[tf] ? [...nextMap[tf]] : [];
        const bucketSec = getBucketStartSec(tickSec, tf);

        if (tfBars.length === 0) {
          tfBars.push({
            time: bucketSec,
            open: p,
            high: p,
            low: p,
            close: p,
            tickVolume: rawTickVol,
            buyVol: side === 'BUY' ? rawTickVol : 0,
            sellVol: side === 'SELL' ? rawTickVol : 0,
          });
        } else {
          const lastIdx = tfBars.length - 1;
          const lastBar = tfBars[lastIdx];

          if (bucketSec > lastBar.time) {
            // New bucket started: close previous candle and open a new one
            tfBars.push({
              time: bucketSec,
              open: p,
              high: p,
              low: p,
              close: p,
              tickVolume: rawTickVol,
              buyVol: side === 'BUY' ? rawTickVol : 0,
              sellVol: side === 'SELL' ? rawTickVol : 0,
            });
            const maxRetention = tf === '1m' ? 5000 : 2000;
            if (tfBars.length > maxRetention) {
              tfBars.splice(0, tfBars.length - maxRetention);
            }
          } else {
            // Update forming candle
            tfBars[lastIdx] = {
              ...lastBar,
              high: Math.max(lastBar.high, p),
              low: Math.min(lastBar.low, p),
              close: p,
              tickVolume: lastBar.tickVolume + rawTickVol,
              buyVol: lastBar.buyVol + (side === 'BUY' ? rawTickVol : 0),
              sellVol: lastBar.sellVol + (side === 'SELL' ? rawTickVol : 0),
            };
          }
        }

        nextMap[tf] = tfBars;
      }

      barsRef.current = nextMap;
      setBars(nextMap);
    },
    []
  );

  // Sync with commandStore so top bar & RED SNIPER share live quotes
  useEffect(() => {
    const syncFromStore = () => {
      if (isSyncingToCommandStoreRef.current) return;
      const storePrice = commandStore.currentPrice;
      if (storePrice > 0 && storePrice !== livePriceRef.current) {
        applyIncomingQuote(
          {
            price: storePrice,
            bid: commandStore.bid || undefined,
            ask: commandStore.ask || undefined,
            previousClose: commandStore.previousClose || undefined,
            dayDiffPercent: commandStore.changePercent24h || undefined,
            marketOpen: commandStore.marketOpen,
            timestamp: commandStore.lastTickAt || Date.now(),
          },
          true
        );
      }
    };

    const unsubscribe = commandStore.subscribe(syncFromStore);
    syncFromStore();
    return () => {
      unsubscribe();
    };
  }, [applyIncomingQuote]);

  // Fallback quote polling: GET https://biquote.io/api/latest?symbols=XAUUSD
  const pollBiquoteLatest = useCallback(async () => {
    const urls = [
      'https://biquote.io/api/latest?symbols=XAUUSD',
      'https://biquote.io/api/XAUUSD',
      '/api/price/xauusd',
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) continue;
        const json = await res.json();

        let item: any = null;
        if (Array.isArray(json)) {
          item = json.find((q) => q?.symbol === 'XAUUSD') || json[0];
        } else if (Array.isArray(json?.data)) {
          item = json.data.find((q: any) => q?.symbol === 'XAUUSD') || json.data[0];
        } else if (Array.isArray(json?.quotes)) {
          item = json.quotes.find((q: any) => q?.symbol === 'XAUUSD') || json.quotes[0];
        } else if (json?.XAUUSD && typeof json.XAUUSD === 'object') {
          item = json.XAUUSD;
        } else if (json?.data && typeof json.data === 'object') {
          item = json.data.XAUUSD || json.data;
        } else {
          item = json;
        }

        if (
          item &&
          (typeof item.mid === 'number' ||
            typeof item.price === 'number' ||
            typeof item.bid === 'number')
        ) {
          applyIncomingQuote(item);
          return;
        }
      } catch {
        // Ignore network errors and try next fallback
      }
    }
  }, [applyIncomingQuote]);

  // 1. Initial Load: Fetch from server candle store first (/api/redsniper/candles?tf=..&limit=5000),
  // fall back to biquote only if empty, and build 3m, 5m, 15m, 30m from stored M1 when M1 covers the range.
  useEffect(() => {
    let isCancelled = false;

    async function loadHistory() {
      setIsLoading(true);
      const results = await Promise.all(
        DIRECT_FETCH_TIMEFRAMES.map((tf) => fetchStoreCandlesFirstWithFallback(tf, 5000))
      );

      if (isCancelled) return;

      const m1Res = results[0];
      const m5Res = results[1];
      const m15Res = results[2];
      const m30Res = results[3];
      const h1Res = results[4];
      const h4Res = results[5];
      const d1Res = results[6];

      const m1 = m1Res.bars;
      const m3 = build3mFrom1m(m1, [], 2000);

      // Build 5m, 15m, 30m from stored M1 when stored M1 covers the requested range
      const useM1For5m =
        m1Res.diagnostics.source === 'store' &&
        doesM1CoverTimeframeRange(m1, m5Res.bars, '5m', 400);
      const m5 = useM1For5m
        ? buildHigherTimeframeFrom1m(m1, '5m', m5Res.bars, 2000)
        : m5Res.bars;

      const useM1For15m =
        m1Res.diagnostics.source === 'store' &&
        doesM1CoverTimeframeRange(m1, m15Res.bars, '15m', 400);
      const m15 = useM1For15m
        ? buildHigherTimeframeFrom1m(m1, '15m', m15Res.bars, 2000)
        : m15Res.bars;

      const useM1For30m =
        m1Res.diagnostics.source === 'store' &&
        doesM1CoverTimeframeRange(m1, m30Res.bars, '30m', 400);
      const m30 = useM1For30m
        ? buildHigherTimeframeFrom1m(m1, '30m', m30Res.bars, 2000)
        : m30Res.bars;

      const h1 = h1Res.bars;
      const h4 = h4Res.bars;
      const d1 = d1Res.bars;

      const nextDiag = makeEmptyDiagnosticsMap();
      for (const r of results) {
        nextDiag[r.diagnostics.tf] = r.diagnostics;
      }

      const oldestM3 = m3.length > 0 ? m3[0].time : null;
      nextDiag['3m'] = {
        tf: '3m',
        source: m1Res.diagnostics.source,
        barsLoaded: m3.length,
        oldestCandleTime: oldestM3,
        oldestCandleIso: oldestM3 ? new Date(oldestM3 * 1000).toISOString() : null,
        builtFromM1: true,
        targetBars: 160,
        requestedBars: m1Res.diagnostics.requestedBars,
        finalBarsLoaded: m3.length,
        returnedBarsPerPage: [m3.length],
        fromToUsed: m1Res.diagnostics.fromToUsed,
        historyLimitReached:
          m3.length < 160 ? `history limit reached: ${m3.length} bars` : null,
      };

      if (useM1For5m && m5.length > 0) {
        nextDiag['5m'] = {
          ...nextDiag['5m'],
          source: 'store',
          barsLoaded: m5.length,
          finalBarsLoaded: m5.length,
          oldestCandleTime: m5[0].time,
          oldestCandleIso: new Date(m5[0].time * 1000).toISOString(),
          builtFromM1: true,
        };
      }
      if (useM1For15m && m15.length > 0) {
        nextDiag['15m'] = {
          ...nextDiag['15m'],
          source: 'store',
          barsLoaded: m15.length,
          finalBarsLoaded: m15.length,
          oldestCandleTime: m15[0].time,
          oldestCandleIso: new Date(m15[0].time * 1000).toISOString(),
          builtFromM1: true,
        };
      }
      if (useM1For30m && m30.length > 0) {
        nextDiag['30m'] = {
          ...nextDiag['30m'],
          source: 'store',
          barsLoaded: m30.length,
          finalBarsLoaded: m30.length,
          oldestCandleTime: m30[0].time,
          oldestCandleIso: new Date(m30[0].time * 1000).toISOString(),
          builtFromM1: true,
        };
      }

      setHistoryDiagnostics(nextDiag);

      const initialMap: RedSniperBarsMap = {
        '1m': m1,
        '3m': m3,
        '5m': m5,
        '15m': m15,
        '30m': m30,
        '1h': h1,
        '4h': h4,
        '1d': d1,
      };

      barsRef.current = initialMap;
      setBars(initialMap);

      const latest1m = m1.length > 0 ? m1[m1.length - 1] : null;
      const latest15m = m15.length > 0 ? m15[m15.length - 1] : null;
      const fallbackClose = latest1m?.close ?? latest15m?.close ?? null;

      if (livePriceRef.current === null && fallbackClose !== null && fallbackClose > 0) {
        const rounded = Number(fallbackClose.toFixed(2));
        livePriceRef.current = rounded;
        prevTickPriceRef.current = rounded;
        setLivePrice(rounded);
      }

      setIsLoading(false);
      await pollBiquoteLatest();
    }

    loadHistory();

    return () => {
      isCancelled = true;
    };
  }, [pollBiquoteLatest]);

  // 2. Real-time SignalR connection to https://biquote.io/hubs/tick
  useEffect(() => {
    let hubConnection: signalR.HubConnection | null = null;
    let isMounted = true;

    async function startSignalR() {
      try {
        hubConnection = new signalR.HubConnectionBuilder()
          .withUrl('https://biquote.io/hubs/tick', {
            skipNegotiation: false,
            transport:
              signalR.HttpTransportType.WebSockets |
              signalR.HttpTransportType.ServerSentEvents,
          })
          .withAutomaticReconnect([0, 1500, 3000, 5000, 10000])
          .configureLogging(signalR.LogLevel.None)
          .build();

        hubConnection.onreconnecting(() => {
          if (isMounted) setConnectionStatus('RECONNECTING');
        });

        hubConnection.onreconnected(async () => {
          if (isMounted) setConnectionStatus('CONNECTED');
          try {
            await hubConnection?.invoke('Subscribe', ['XAUUSD']);
          } catch {}
        });

        hubConnection.onclose(() => {
          if (isMounted) setConnectionStatus('DISCONNECTED');
        });

        hubConnection.on('ReceiveTick', (tick: any) => {
          if (!isMounted || !tick) return;
          applyIncomingQuote(tick);
        });

        await hubConnection.start();
        if (isMounted) {
          setConnectionStatus('CONNECTED');
          await hubConnection.invoke('Subscribe', ['XAUUSD']);
        }
      } catch {
        if (isMounted) setConnectionStatus('DISCONNECTED');
      }
    }

    startSignalR();

    return () => {
      isMounted = false;
      if (hubConnection) {
        hubConnection.stop().catch(() => {});
      }
    };
  }, [applyIncomingQuote]);

  // 3. Fallback polling every 3s when open & SignalR disconnected; every 60s when market closed
  useEffect(() => {
    if (isMarketClosed) {
      const closedTimer = setInterval(() => {
        pollBiquoteLatest();
      }, 60_000);
      return () => clearInterval(closedTimer);
    }

    if (connectionStatus !== 'CONNECTED') {
      const openFallbackTimer = setInterval(() => {
        if (!isMarketClosedRef.current && connectionStatusRef.current !== 'CONNECTED') {
          pollBiquoteLatest();
        }
      }, 3_000);
      return () => clearInterval(openFallbackTimer);
    }
  }, [isMarketClosed, connectionStatus, pollBiquoteLatest]);

  // 4. Every 60s re-fetch the last 3 bars of each interval from the ohlc endpoint (limit=3)
  // and replace locally built forming candle values with broker's official OHLC + tickVolume
  // while keeping our buyVol/sellVol ratio scaled to broker tickVolume.
  useEffect(() => {
    let isCancelled = false;

    const reconcileAll = async () => {
      const [m1Last, m5Last, m15Last, m30Last, h1Last, h4Last, d1Last] = await Promise.all([
        fetchBrokerOhlc('1m', 9),
        fetchBrokerOhlc('5m', 3),
        fetchBrokerOhlc('15m', 3),
        fetchBrokerOhlc('30m', 3),
        fetchBrokerOhlc('1h', 3),
        fetchBrokerOhlc('4h', 3),
        fetchBrokerOhlc('1d', 3),
      ]);

      if (isCancelled) return;

      const current = barsRef.current;
      const reconciled1m = reconcileOfficialBars(current['1m'], m1Last.slice(-3), 5000);
      const recent1mFor3m = reconcileOfficialBars(current['1m'], m1Last, 5000).slice(-15);
      const reconciled3m = build3mFrom1m(recent1mFor3m, current['3m'], 2000);

      const nextMap: RedSniperBarsMap = {
        '1m': reconciled1m,
        '3m': reconciled3m,
        '5m': reconcileOfficialBars(current['5m'], m5Last, 2000),
        '15m': reconcileOfficialBars(current['15m'], m15Last, 2000),
        '30m': reconcileOfficialBars(current['30m'], m30Last, 2000),
        '1h': reconcileOfficialBars(current['1h'], h1Last, 2000),
        '4h': reconcileOfficialBars(current['4h'], h4Last, 2000),
        '1d': reconcileOfficialBars(current['1d'], d1Last, 2000),
      };

      barsRef.current = nextMap;
      setBars(nextMap);
    };

    const timer = setInterval(() => {
      void reconcileAll();
    }, 60_000);

    return () => {
      isCancelled = true;
      clearInterval(timer);
    };
  }, []);

  return {
    bars,
    historyDiagnostics,
    livePrice,
    bid,
    ask,
    spread,
    lastTickTime,
    connectionStatus,
    isMarketClosed,
    isLoading,
    session,
    rolling60sFlow,
  };
}
