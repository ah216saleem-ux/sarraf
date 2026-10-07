import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DATA_DIR,
  writeJsonAtomic,
  recoverCorruptedFileFromLatestBackup,
} from './deploymentSafety.ts';

export interface Candle {
  openTime: string; // ISO string
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
  hasGapBefore?: boolean;
  gapDurationMinutes?: number;
  usableForZones?: boolean;
}

export interface CandleStore {
  symbol: string;
  lastUpdated: string;
  htfBootstrapMethod: string;
  M15: Candle[];
  M30: Candle[];
  H1: Candle[];
  H4: Candle[];
  D1: Candle[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const DATA_FILE = path.resolve(DATA_DIR, 'candles.json');

let store: CandleStore = {
  symbol: 'XAUUSD',
  lastUpdated: new Date().toISOString(),
  htfBootstrapMethod: 'NATIVE_BIQUOTE_OHLC_INTERVALS',
  M15: [],
  M30: [],
  H1: [],
  H4: [],
  D1: [],
};

let lastSaveTime = 0;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Detect gaps (weekend closures, trading halts, server downtime) in chronological candle series
export function detectGaps(candles: Candle[], expectedIntervalMinutes: number): number {
  if (!candles || candles.length < 2) {
    if (candles && candles.length === 1) {
      candles[0].hasGapBefore = false;
      candles[0].usableForZones = true;
    }
    return 0;
  }

  const expectedDiffMs = expectedIntervalMinutes * 60 * 1000;
  let gapCount = 0;

  candles[0].hasGapBefore = false;
  candles[0].usableForZones = true;

  for (let i = 1; i < candles.length; i++) {
    const prevTime = new Date(candles[i - 1].openTime).getTime();
    const currTime = new Date(candles[i].openTime).getTime();
    const diffMs = currTime - prevTime;

    // Tolerance threshold: if gap is greater than 1.4x expected interval
    if (diffMs > expectedDiffMs * 1.4) {
      gapCount += 1;
      const gapMins = Math.round(diffMs / (60 * 1000));
      candles[i].hasGapBefore = true;
      candles[i].gapDurationMinutes = gapMins;
      candles[i].usableForZones = false;
      candles[i - 1].usableForZones = false;
    } else {
      candles[i].hasGapBefore = false;
      candles[i].gapDurationMinutes = 0;
      if (candles[i].usableForZones === undefined) {
        candles[i].usableForZones = true;
      }
    }
  }

  return gapCount;
}

// Run gap detection across all active stores
export function runGapDetectionAudit() {
  const m15Gaps = detectGaps(store.M15, 15);
  const m30Gaps = detectGaps(store.M30, 30);
  const h1Gaps = detectGaps(store.H1, 60);
  const h4Gaps = detectGaps(store.H4, 240);
  const d1Gaps = detectGaps(store.D1, 1440);

  return { m15Gaps, m30Gaps, h1Gaps, h4Gaps, d1Gaps };
}

// Aggregate H4 candles from H1 candles aligned to broker session boundaries
export function buildH4FromH1(h1Candles: Candle[]): Candle[] {
  if (!h1Candles || h1Candles.length === 0) return [];
  const h4Map = new Map<string, Candle[]>();

  for (const bar of h1Candles) {
    const t = new Date(bar.openTime).getTime();
    const floored = Math.floor(t / (4 * 3600 * 1000)) * (4 * 3600 * 1000);
    const key = new Date(floored).toISOString();
    if (!h4Map.has(key)) h4Map.set(key, []);
    h4Map.get(key)!.push(bar);
  }

  const result: Candle[] = [];
  for (const [openTime, bars] of h4Map.entries()) {
    result.push({
      openTime,
      open: bars[0].open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      close: bars[bars.length - 1].close,
      volume: bars.reduce((sum, b) => sum + b.volume, 0),
      isClosed: bars.length >= 4,
      usableForZones: true,
    });
  }

  return result.sort((a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime());
}

// Aggregate D1 candles from H1 candles aligned to UTC day boundaries (00:00 UTC)
export function buildD1FromH1(h1Candles: Candle[]): Candle[] {
  if (!h1Candles || h1Candles.length === 0) return [];
  const d1Map = new Map<string, Candle[]>();

  for (const bar of h1Candles) {
    const d = new Date(bar.openTime);
    const dayKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T00:00:00.000Z`;
    if (!d1Map.has(dayKey)) d1Map.set(dayKey, []);
    d1Map.get(dayKey)!.push(bar);
  }

  const result: Candle[] = [];
  for (const [openTime, bars] of d1Map.entries()) {
    result.push({
      openTime,
      open: bars[0].open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      close: bars[bars.length - 1].close,
      volume: bars.reduce((sum, b) => sum + b.volume, 0),
      isClosed: bars.length >= 24,
      usableForZones: true,
    });
  }

  return result.sort((a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime());
}

// Load persisted candles from disk
export function loadCandlesFromDisk(): CandleStore {
  ensureDataDir();
  if (fs.existsSync(DATA_FILE)) {
    try {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.H1) && parsed.H1.length > 0) {
        store = {
          symbol: parsed.symbol || 'XAUUSD',
          lastUpdated: parsed.lastUpdated || new Date().toISOString(),
          htfBootstrapMethod: parsed.htfBootstrapMethod || 'NATIVE_BIQUOTE_OHLC_INTERVALS',
          M15: parsed.M15 || [],
          M30: parsed.M30 || [],
          H1: parsed.H1 || [],
          H4: parsed.H4 || [],
          D1: parsed.D1 || [],
        };
        runGapDetectionAudit();
        console.log(`[CANDLE ENGINE] Loaded candles from disk: H1=${store.H1.length}, M30=${store.M30.length}, M15=${store.M15.length}, H4=${store.H4.length}, D1=${store.D1.length}`);
        return store;
      }
    } catch (err: any) {
      console.error('[CANDLE ENGINE] Corrupted candles.json detected:', err.message);
      const recovered = recoverCorruptedFileFromLatestBackup('candles.json');
      if (recovered) {
        return loadCandlesFromDisk();
      }
    }
  }
  return store;
}

// Persist candles to disk so history survives restarts (keep up to 1200 per timeframe)
export function saveCandlesToDisk() {
  try {
    ensureDataDir();
    store.lastUpdated = new Date().toISOString();
    writeJsonAtomic(DATA_FILE, store);
    lastSaveTime = Date.now();
  } catch (err: any) {
    console.error('[CANDLE ENGINE] Failed to save candles to disk:', err.message);
  }
}

// Helper to align timestamps to timeframe boundary
function getPeriodStartTime(timestampMs: number, periodMinutes: number): string {
  const periodMs = periodMinutes * 60 * 1000;
  const floored = Math.floor(timestampMs / periodMs) * periodMs;
  return new Date(floored).toISOString();
}

function updateTimeframeCandles(
  candles: Candle[],
  periodMinutes: number,
  price: number,
  timestampMs: number
) {
  const openTime = getPeriodStartTime(timestampMs, periodMinutes);
  const current = candles[candles.length - 1];

  if (!current || current.openTime !== openTime) {
    if (current) {
      current.isClosed = true;
    }

    const prevTime = current ? new Date(current.openTime).getTime() : 0;
    const diffMs = prevTime > 0 ? timestampMs - prevTime : 0;
    const expectedDiffMs = periodMinutes * 60 * 1000;
    const hasGap = diffMs > expectedDiffMs * 1.4;

    candles.push({
      openTime,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 1,
      isClosed: false,
      hasGapBefore: hasGap,
      gapDurationMinutes: hasGap ? Math.round(diffMs / 60000) : 0,
      usableForZones: !hasGap,
    });

    // Retain up to 1200 candles to fulfill minimum 1000 candles requirement
    if (candles.length > 1200) {
      candles.shift();
    }
  } else {
    current.high = Math.max(current.high, price);
    current.low = Math.min(current.low, price);
    current.close = price;
    current.volume += 1;
  }
}

// Process new tick from live feed into all 5 timeframes
export function processTick(price: number, timestampMs: number) {
  updateTimeframeCandles(store.M15, 15, price, timestampMs);
  updateTimeframeCandles(store.M30, 30, price, timestampMs);
  updateTimeframeCandles(store.H1, 60, price, timestampMs);
  updateTimeframeCandles(store.H4, 240, price, timestampMs);
  updateTimeframeCandles(store.D1, 1440, price, timestampMs);

  if (Date.now() - lastSaveTime > 25000) {
    saveCandlesToDisk();
  }
}

// Fetch authentic historical candles from biquote.io endpoint for a specific interval
async function fetchTimeframeOhlc(intervalParam: '15m' | '30m' | '1h' | '4h' | '1d'): Promise<Candle[]> {
  const res = await fetch(`https://biquote.io/api/XAUUSD/ohlc?interval=${intervalParam}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'SARRAF-Engine/2.0' },
  });

  if (!res.ok) {
    throw new Error(`biquote ohlc endpoint (${intervalParam}) returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const rawBars: any[] = data.bars || data.candles || [];

  if (!Array.isArray(rawBars) || rawBars.length === 0) {
    return [];
  }

  // Reverse descending array to chronological ascending order [oldest -> newest]
  const chronological = [...rawBars].reverse();

  return chronological.map((b: any, idx: number) => ({
    openTime: b.openTime || new Date(b.time || Date.now()).toISOString(),
    open: Number(b.open),
    high: Number(b.high),
    low: Number(b.low),
    close: Number(b.close),
    volume: Number(b.tickVolume || b.volume || 1),
    isClosed: idx < chronological.length - 1, // latest bar is forming/open
    usableForZones: true,
  }));
}

// Bootstrap authentic historical candles from biquote.io for M15, M30, H1, H4, D1
export async function bootstrapHistoricalCandles(): Promise<boolean> {
  const hasEnough =
    store.H1.length >= 80 &&
    store.M30.length >= 100 &&
    store.M15.length >= 100 &&
    store.H4.length >= 40 &&
    store.D1.length >= 20;

  if (hasEnough) {
    runGapDetectionAudit();
    return true;
  }

  try {
    console.log('[CANDLE ENGINE] Fetching authentic historical candles from biquote.io for M15, M30, H1, H4, D1...');

    const [m15Bars, m30Bars, h1Bars, h4Bars, d1Bars] = await Promise.all([
      fetchTimeframeOhlc('15m'),
      fetchTimeframeOhlc('30m'),
      fetchTimeframeOhlc('1h'),
      fetchTimeframeOhlc('4h'),
      fetchTimeframeOhlc('1d'),
    ]);

    if (m15Bars.length > 0) store.M15 = m15Bars;
    if (m30Bars.length > 0) store.M30 = m30Bars;
    if (h1Bars.length > 0) store.H1 = h1Bars;

    if (h4Bars.length > 0) {
      store.H4 = h4Bars;
      store.htfBootstrapMethod = 'NATIVE_BIQUOTE_OHLC_INTERVALS (Direct 4h & 1d API bootstrap)';
    } else if (store.H1.length > 0) {
      store.H4 = buildH4FromH1(store.H1);
      store.htfBootstrapMethod = 'AGGREGATED_FROM_STORED_H1_CANDLES (Session boundary aligned)';
    }

    if (d1Bars.length > 0) {
      store.D1 = d1Bars;
    } else if (store.H1.length > 0) {
      store.D1 = buildD1FromH1(store.H1);
    }

    runGapDetectionAudit();
    saveCandlesToDisk();

    console.log(`[CANDLE ENGINE] Bootstrapped real history: M15=${store.M15.length}, M30=${store.M30.length}, H1=${store.H1.length}, H4=${store.H4.length}, D1=${store.D1.length} (${store.htfBootstrapMethod})`);
    return true;
  } catch (err: any) {
    console.warn('[CANDLE ENGINE] Historical bootstrap failed, attempting H1 candle aggregation fallback:', err.message);
    if (store.H1.length > 0) {
      store.H4 = buildH4FromH1(store.H1);
      store.D1 = buildD1FromH1(store.H1);
      store.htfBootstrapMethod = 'AGGREGATED_FROM_STORED_H1_CANDLES (Session boundary aligned)';
      runGapDetectionAudit();
      saveCandlesToDisk();
      return true;
    }
  }

  return false;
}

// Get closed candles only (excluding active forming candle and gap candles when requested)
export function getClosedCandles(timeframe: 'M15' | 'M30' | 'H1' | 'H4' | 'D1', includeGaps: boolean = false): Candle[] {
  const list = store[timeframe];
  if (!list || list.length === 0) return [];
  
  // Exclude last candle if it is still forming
  const closed = list.slice(0, -1);
  if (includeGaps) return closed;
  return closed.filter((c) => !c.hasGapBefore);
}

// Usable candle counts audit
export function getUsableCandleCounts() {
  const m15Usable = store.M15.filter((c, i) => i < store.M15.length - 1 && !c.hasGapBefore).length;
  const m30Usable = store.M30.filter((c, i) => i < store.M30.length - 1 && !c.hasGapBefore).length;
  const h1Usable = store.H1.filter((c, i) => i < store.H1.length - 1 && !c.hasGapBefore).length;
  const h4Usable = store.H4.filter((c, i) => i < store.H4.length - 1 && !c.hasGapBefore).length;
  const d1Usable = store.D1.filter((c, i) => i < store.D1.length - 1 && !c.hasGapBefore).length;

  return { m15Usable, m30Usable, h1Usable, h4Usable, d1Usable };
}

export function getEngineStatus() {
  const { m15Usable, m30Usable, h1Usable, h4Usable, d1Usable } = getUsableCandleCounts();

  const h1Ready = h1Usable >= 80;
  const m30Ready = m30Usable >= 100;
  const m15Ready = m15Usable >= 100;
  const htfFullReady = h4Usable >= 40 && d1Usable >= 20;

  let state: 'READY' | 'HTF LIMITED' | 'WARMING UP' = 'WARMING UP';
  let message = '';

  if (h1Ready && m30Ready && m15Ready) {
    if (htfFullReady) {
      state = 'READY';
      message = `Engine READY: Full multi-timeframe alignment (M15:${m15Usable}, M30:${m30Usable}, H1:${h1Usable}, H4:${h4Usable}, D1:${d1Usable} usable bars).`;
    } else {
      state = 'HTF LIMITED';
      message = `Engine in HTF LIMITED mode: H1 bias active (H4:${h4Usable}/40, D1:${d1Usable}/20 bars).`;
    }
  } else {
    state = 'WARMING UP';
    message = `Engine WARMING UP: Accumulating bars (H1:${h1Usable}/80, M30:${m30Usable}/100, M15:${m15Usable}/100).`;
  }

  const h1Gaps = store.H1.filter((c) => c.hasGapBefore).length;
  const m30Gaps = store.M30.filter((c) => c.hasGapBefore).length;
  const m15Gaps = store.M15.filter((c) => c.hasGapBefore).length;
  const h4Gaps = store.H4.filter((c) => c.hasGapBefore).length;
  const d1Gaps = store.D1.filter((c) => c.hasGapBefore).length;

  return {
    engineState: state,
    h1Count: store.H1.length,
    m30Count: store.M30.length,
    m15Count: store.M15.length,
    h4Count: store.H4.length,
    d1Count: store.D1.length,
    usable: {
      m15: m15Usable,
      m30: m30Usable,
      h1: h1Usable,
      h4: h4Usable,
      d1: d1Usable,
    },
    gaps: {
      m15: m15Gaps,
      m30: m30Gaps,
      h1: h1Gaps,
      h4: h4Gaps,
      d1: d1Gaps,
    },
    signalsActive: state === 'READY' || state === 'HTF LIMITED',
    htfBootstrapMethod: store.htfBootstrapMethod,
    message,
  };
}

export function getCandleStore(): CandleStore {
  return store;
}
