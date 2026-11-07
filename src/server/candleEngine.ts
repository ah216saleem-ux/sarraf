import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DATA_DIR,
  writeJsonAtomic,
  recoverCorruptedFileFromLatestBackup,
  getDataDirDiskStats,
} from './deploymentSafety.ts';
import {
  initRedSniperDatabase,
  saveCandlesToSqlite,
  getCandlesFromSqlite,
  loadRedSniperBotLogFromSqlite,
  appendRedSniperBotLogToSqlite,
  clearRedSniperBotLogFromSqlite,
  setRedSniperDbPath,
  closeRedSniperDatabase,
} from './redSniperDatabase.ts';
import {
  getRedSniperStore,
  initActiveStore,
  setRedSniperStore,
  detectRedSniperGaps,
  RedSniperGap,
  RedSniperHealthReport,
  RedSniperStoredCandle,
  RedSniperBackfillStatus,
  ServerBotLogEntry,
  RED_SNIPER_DIRECT_TFS as STORE_DIRECT_TFS,
} from './redsniperStore.ts';
import {
  HistoryProvider,
  DukascopyProvider,
  OandaProvider,
  createHistoryProvider,
  buildFiveDayM1Chunks,
  computeMedianCloseOffset,
  applyOffsetToHistCandles,
  mergeHistAndLiveCandles,
  rebuildSingleTimeframeFromM1,
  rebuildTimeframesFromMergedM1,
  classifyBackfillProviderError,
  formatBackfillBannerState,
  initBackfillStatusFromDisk,
  runRedSniperHistoryBackfill,
  triggerAsyncRedSniperBackfill,
  getRedSniperBackfillStatus,
  BackfillBannerState,
} from './historyBackfill.ts';

export {
  initRedSniperDatabase,
  setRedSniperDbPath,
  closeRedSniperDatabase,
  getRedSniperStore,
  initActiveStore,
  setRedSniperStore,
  DukascopyProvider,
  OandaProvider,
  createHistoryProvider,
  buildFiveDayM1Chunks,
  computeMedianCloseOffset,
  applyOffsetToHistCandles,
  mergeHistAndLiveCandles,
  rebuildSingleTimeframeFromM1,
  rebuildTimeframesFromMergedM1,
  classifyBackfillProviderError,
  formatBackfillBannerState,
  initBackfillStatusFromDisk,
  runRedSniperHistoryBackfill,
  triggerAsyncRedSniperBackfill,
  getRedSniperBackfillStatus,
  getDataDirDiskStats,
};
export type {
  RedSniperHealthReport,
  RedSniperGap,
  RedSniperBackfillStatus,
  HistoryProvider,
  BackfillBannerState,
};

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
  source?: 'hist' | 'live';
}

export interface CandleStore {
  symbol: string;
  lastUpdated: string;
  htfBootstrapMethod: string;
  M1: Candle[];
  M5: Candle[];
  M15: Candle[];
  M30: Candle[];
  H1: Candle[];
  H4: Candle[];
  D1: Candle[];
}

const DATA_FILE = path.resolve(DATA_DIR, 'candles.json');

let store: CandleStore = {
  symbol: 'XAUUSD',
  lastUpdated: new Date().toISOString(),
  htfBootstrapMethod: 'NATIVE_BIQUOTE_OHLC_INTERVALS',
  M1: [],
  M5: [],
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
  const m1Gaps = detectGaps(store.M1, 1);
  const m5Gaps = detectGaps(store.M5, 5);
  const m15Gaps = detectGaps(store.M15, 15);
  const m30Gaps = detectGaps(store.M30, 30);
  const h1Gaps = detectGaps(store.H1, 60);
  const h4Gaps = detectGaps(store.H4, 240);
  const d1Gaps = detectGaps(store.D1, 1440);

  return { m1Gaps, m5Gaps, m15Gaps, m30Gaps, h1Gaps, h4Gaps, d1Gaps };
}

// Aggregate M3 candles from M1 candles
export function buildM3FromM1(m1Candles: Candle[]): Candle[] {
  if (!m1Candles || m1Candles.length === 0) return [];
  const periodMs = 3 * 60 * 1000;
  const sorted = [...m1Candles].sort(
    (a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime()
  );
  const map = new Map<number, Candle[]>();
  for (const bar of sorted) {
    const t = new Date(bar.openTime).getTime();
    if (Number.isNaN(t)) continue;
    const floored = Math.floor(t / periodMs) * periodMs;
    const list = map.get(floored);
    if (list) list.push(bar);
    else map.set(floored, [bar]);
  }
  const keys = Array.from(map.keys()).sort((a, b) => a - b);
  const result: Candle[] = [];
  for (let idx = 0; idx < keys.length; idx++) {
    const bucketMs = keys[idx];
    const bars = map.get(bucketMs)!;
    const isLast = idx === keys.length - 1;
    result.push({
      openTime: new Date(bucketMs).toISOString(),
      open: bars[0].open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      close: bars[bars.length - 1].close,
      volume: bars.reduce((sum, b) => sum + (b.volume || 1), 0),
      isClosed: !isLast || bars.length >= 3,
      usableForZones: true,
    });
  }
  return result;
}

// Aggregate M5 candles from M1 candles
export function buildM5FromM1(m1Candles: Candle[]): Candle[] {
  if (!m1Candles || m1Candles.length === 0) return [];
  const map = new Map<string, Candle[]>();
  for (const bar of m1Candles) {
    const t = new Date(bar.openTime).getTime();
    const floored = Math.floor(t / (5 * 60 * 1000)) * (5 * 60 * 1000);
    const key = new Date(floored).toISOString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(bar);
  }
  const result: Candle[] = [];
  for (const [openTime, bars] of map.entries()) {
    result.push({
      openTime,
      open: bars[0].open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      close: bars[bars.length - 1].close,
      volume: bars.reduce((sum, b) => sum + b.volume, 0),
      isClosed: bars.length >= 5,
      usableForZones: true,
    });
  }
  return result.sort((a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime());
}

// Aggregate M15, M30, or H1 candles directly from M5 base candles
export function buildTimeframeFromM5(m5Candles: Candle[], periodMinutes: 15 | 30 | 60): Candle[] {
  if (!m5Candles || m5Candles.length === 0) return [];
  const periodMs = periodMinutes * 60 * 1000;
  const expectedM5Bars = periodMinutes / 5;
  const sortedM5 = [...m5Candles].sort(
    (a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime()
  );
  const map = new Map<number, Candle[]>();
  for (const bar of sortedM5) {
    const t = new Date(bar.openTime).getTime();
    if (isNaN(t)) continue;
    const floored = Math.floor(t / periodMs) * periodMs;
    if (!map.has(floored)) map.set(floored, []);
    map.get(floored)!.push(bar);
  }
  const bucketKeys = Array.from(map.keys()).sort((a, b) => a - b);
  const nowBucket = Math.floor(Date.now() / periodMs) * periodMs;
  const result: Candle[] = [];
  for (let i = 0; i < bucketKeys.length; i++) {
    const bucketMs = bucketKeys[i];
    const bars = map.get(bucketMs)!;
    const isLatestBucket = i === bucketKeys.length - 1;
    const allM5Closed = bars.every((b) => b.isClosed);
    const isClosed = !isLatestBucket || (bucketMs < nowBucket && allM5Closed) || (bars.length >= expectedM5Bars && allM5Closed);
    result.push({
      openTime: new Date(bucketMs).toISOString(),
      open: bars[0].open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      close: bars[bars.length - 1].close,
      volume: bars.reduce((sum, b) => sum + (b.volume || 1), 0),
      isClosed,
      usableForZones: true,
    });
  }
  return result;
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

// Merge candle series keeping history and sorted ascending ('live' wins over 'hist' in overlap)
export function mergeCandleSeries(existing: Candle[], incoming: Candle[], maxLimit: number = 10000): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of existing) {
    const t = new Date(c.openTime).getTime();
    if (!isNaN(t)) {
      byTime.set(t, { ...c, openTime: new Date(t).toISOString() });
    }
  }
  for (const c of incoming) {
    const t = new Date(c.openTime).getTime();
    if (!isNaN(t)) {
      const prev = byTime.get(t);
      if (prev && prev.source === 'live' && c.source === 'hist') {
        continue;
      }
      byTime.set(t, { ...c, openTime: new Date(t).toISOString() });
    }
  }
  const sorted = Array.from(byTime.values()).sort(
    (a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime()
  );
  if (sorted.length > maxLimit) {
    return sorted.slice(-maxLimit);
  }
  return sorted;
}

// ============================================================================
// RED SNIPER LONG-TERM JSONL CANDLE STORE & BOT LOG PERSISTENCE
// ============================================================================

export type RedSniperStoreTf = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
export type RedSniperDirectStoreTf = Exclude<RedSniperStoreTf, '3m'>;
export type { RedSniperStoredCandle };

const RED_SNIPER_DIRECT_TFS: RedSniperDirectStoreTf[] = [
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  '1d',
];

const redSniperStore: Record<RedSniperDirectStoreTf, RedSniperStoredCandle[]> = {
  '1m': [],
  '5m': [],
  '15m': [],
  '30m': [],
  '1h': [],
  '4h': [],
  '1d': [],
};

let lastRedSniperJsonlSaveMs = 0;
let redSniperWorkerStarted = false;

export function getRedSniperTfPeriodSeconds(tf: RedSniperStoreTf): number {
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

export function alignTimeSecToTf(timeSec: number, tf: RedSniperStoreTf): number {
  const p = getRedSniperTfPeriodSeconds(tf);
  return Math.floor(timeSec / p) * p;
}

function getRedSniperJsonlFilePath(tf: RedSniperDirectStoreTf): string {
  return path.resolve(DATA_DIR, `redsniper_candles_${tf}.jsonl`);
}

function candleToRedSniperStored(c: Candle, tf: RedSniperDirectStoreTf): RedSniperStoredCandle | null {
  const ms = Date.parse(c.openTime);
  if (Number.isNaN(ms) || ms <= 0) return null;
  const time = alignTimeSecToTf(Math.floor(ms / 1000), tf);
  if (!Number.isFinite(c.open) || !Number.isFinite(c.high) || !Number.isFinite(c.low) || !Number.isFinite(c.close)) {
    return null;
  }
  const tickVolume = Math.max(0, Number(c.volume || 0));
  return {
    time,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    tickVolume,
    buyVol: 0,
    sellVol: 0,
    isClosed: Boolean(c.isClosed),
    source: c.source === 'hist' ? 'hist' : 'live',
  };
}

/**
 * Pure deduplication and merge by candle `time` (unix seconds), sorted ascending.
 * Live candles ('live') win over historical ('hist') candles in the overlap.
 * Preserves local buyVol/sellVol ratio when incoming official OHLC has 0 buyVol/sellVol.
 */
export function dedupeAndMergeRedSniperCandles(
  existing: RedSniperStoredCandle[],
  incoming: RedSniperStoredCandle[],
  maxLimit: number = 10000
): RedSniperStoredCandle[] {
  const byTime = new Map<number, RedSniperStoredCandle>();

  for (const c of existing) {
    if (!c || !Number.isFinite(c.time) || c.time <= 0) continue;
    byTime.set(c.time, { ...c, source: c.source === 'hist' ? 'hist' : 'live' });
  }

  for (const c of incoming) {
    if (!c || !Number.isFinite(c.time) || c.time <= 0) continue;
    const prev = byTime.get(c.time);
    const inSource = c.source === 'hist' ? 'hist' : 'live';
    if (!prev) {
      byTime.set(c.time, { ...c, source: inSource });
    } else {
      // Live candles always win over historical candles in the overlap
      if (prev.source === 'live' && inSource === 'hist') {
        continue;
      }
      const tickVolume = c.tickVolume > 0 ? c.tickVolume : prev.tickVolume;
      const inFlow = (c.buyVol || 0) + (c.sellVol || 0);
      const prevFlow = (prev.buyVol || 0) + (prev.sellVol || 0);
      let buyVol = c.buyVol || 0;
      let sellVol = c.sellVol || 0;

      if (inFlow === 0 && prevFlow > 0 && tickVolume > 0) {
        const ratio = prev.buyVol / prevFlow;
        buyVol = Math.round(tickVolume * ratio);
        sellVol = Math.max(0, tickVolume - buyVol);
      }

      byTime.set(c.time, {
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        tickVolume,
        buyVol,
        sellVol,
        isClosed: c.isClosed ?? prev.isClosed,
        source: inSource,
      });
    }
  }

  const sorted = Array.from(byTime.values()).sort((a, b) => a.time - b.time);
  if (sorted.length > maxLimit) {
    return sorted.slice(-maxLimit);
  }
  return sorted;
}

/**
 * Build higher timeframes (3m, 5m, 15m, 30m) from stored M1 candles aligned to UTC bucket boundaries.
 */
export function buildHigherTfFromStoredM1(
  m1Candles: RedSniperStoredCandle[],
  tf: '3m' | '5m' | '15m' | '30m',
  maxLimit: number = 5000
): RedSniperStoredCandle[] {
  if (!m1Candles || m1Candles.length === 0) return [];
  const periodSec = getRedSniperTfPeriodSeconds(tf);
  const sortedM1 = dedupeAndMergeRedSniperCandles([], m1Candles, 50000);
  const buckets = new Map<number, RedSniperStoredCandle[]>();

  for (const bar of sortedM1) {
    const bucketSec = Math.floor(bar.time / periodSec) * periodSec;
    const list = buckets.get(bucketSec);
    if (list) list.push(bar);
    else buckets.set(bucketSec, [bar]);
  }

  const out: RedSniperStoredCandle[] = [];
  const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
  const expectedM1Count = periodSec / 60;

  for (let idx = 0; idx < keys.length; idx++) {
    const bucketSec = keys[idx];
    const group = buckets.get(bucketSec)!;
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
      tickVolume += b.tickVolume || 0;
      buyVol += b.buyVol || 0;
      sellVol += b.sellVol || 0;
    }

    const isLast = idx === keys.length - 1;
    out.push({
      time: bucketSec,
      open,
      high,
      low,
      close,
      tickVolume,
      buyVol,
      sellVol,
      isClosed: !isLast || group.length >= expectedM1Count,
    });
  }

  if (out.length > maxLimit) {
    return out.slice(-maxLimit);
  }
  return out;
}

/**
 * Determine if stored M1 candles cover the requested range for a higher timeframe (3m, 5m, 15m, 30m).
 */
export function doesStoredM1CoverRange(
  m1Candles: RedSniperStoredCandle[],
  directTfCandles: RedSniperStoredCandle[],
  tf: '3m' | '5m' | '15m' | '30m',
  requestedLimit: number
): boolean {
  if (!m1Candles || m1Candles.length === 0) return false;
  if (tf === '3m') return true;
  if (!directTfCandles || directTfCandles.length === 0) return true;

  const built = buildHigherTfFromStoredM1(m1Candles, tf, requestedLimit);
  if (built.length >= requestedLimit) return true;
  if (built.length >= directTfCandles.length && m1Candles[0].time <= directTfCandles[0].time) {
    return true;
  }
  return false;
}

function loadRedSniperJsonlForTf(tf: RedSniperDirectStoreTf): RedSniperStoredCandle[] {
  ensureDataDir();
  const filePath = getRedSniperJsonlFilePath(tf);
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const parsed: RedSniperStoredCandle[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (
          obj &&
          typeof obj.time === 'number' &&
          Number.isFinite(obj.time) &&
          obj.time > 0 &&
          Number.isFinite(Number(obj.open)) &&
          Number.isFinite(Number(obj.high)) &&
          Number.isFinite(Number(obj.low)) &&
          Number.isFinite(Number(obj.close))
        ) {
          parsed.push({
            time: alignTimeSecToTf(obj.time, tf),
            open: Number(obj.open),
            high: Number(obj.high),
            low: Number(obj.low),
            close: Number(obj.close),
            tickVolume: Math.max(0, Number(obj.tickVolume ?? obj.volume ?? 0)),
            buyVol: Math.max(0, Number(obj.buyVol ?? 0)),
            sellVol: Math.max(0, Number(obj.sellVol ?? 0)),
            isClosed: obj.isClosed !== false,
            source: obj.source === 'hist' ? 'hist' : 'live',
          });
        }
      } catch {
        // Skip malformed line
      }
    }
    const maxCap = tf === '1m' ? 400000 : 10000;
    return dedupeAndMergeRedSniperCandles([], parsed, maxCap);
  } catch (err: any) {
    console.warn(`[RED SNIPER STORE] Failed reading ${filePath}:`, err?.message);
    return [];
  }
}

export async function saveRedSniperJsonlStoreToDisk(): Promise<number> {
  let totalSaved = 0;
  try {
    ensureDataDir();
    const storeInstance = getRedSniperStore();
    for (const tf of RED_SNIPER_DIRECT_TFS) {
      const list = redSniperStore[tf] || [];
      if (list.length === 0) continue;
      // Persist every closed candle (all bars before the latest forming bar, plus latest if marked isClosed)
      const closedBars = list.filter((b, idx) => idx < list.length - 1 || b.isClosed === true);
      if (closedBars.length === 0) continue;

      // Persist to active store backend (Firestore in prod, SQLite in dev/tests)
      try {
        const count = await storeInstance.saveCandles(closedBars, tf);
        totalSaved += count;
      } catch (err: any) {
        console.warn(`[RED SNIPER STORE] Timeframe ${tf} save warning:`, err?.message);
      }

      try {
        const filePath = getRedSniperJsonlFilePath(tf);
        const tmpPath = `${filePath}.tmp`;
        // Keep JSONL bounded to 15000 for 1m and 10000 for HTFs so disk writes stay fast while SQLite holds full 400k M1
        const jsonlSlice = tf === '1m' ? closedBars.slice(-15000) : closedBars.slice(-10000);
        const payload = jsonlSlice.map((b) => JSON.stringify(b)).join('\n') + '\n';
        fs.writeFileSync(tmpPath, payload, 'utf-8');
        fs.renameSync(tmpPath, filePath);
      } catch {}
    }
    lastRedSniperJsonlSaveMs = Date.now();
  } catch (err: any) {
    console.warn('[RED SNIPER STORE] Failed saving store:', err?.message);
  }
  return totalSaved;
}

function syncStoreToRedSniperMemory(): void {
  const mapPairs: Array<[RedSniperDirectStoreTf, Candle[]]> = [
    ['1m', store.M1],
    ['5m', store.M5],
    ['15m', store.M15],
    ['30m', store.M30],
    ['1h', store.H1],
    ['4h', store.H4],
    ['1d', store.D1],
  ];
  for (const [tf, legacyList] of mapPairs) {
    const converted: RedSniperStoredCandle[] = [];
    for (const c of legacyList || []) {
      const sc = candleToRedSniperStored(c, tf);
      if (sc) converted.push(sc);
    }
    const maxCap = tf === '1m' ? 400000 : 10000;
    redSniperStore[tf] = dedupeAndMergeRedSniperCandles(redSniperStore[tf], converted, maxCap);
  }
}

// Load persisted candles from disk
export function loadCandlesFromDisk(): CandleStore {
  ensureDataDir();
  for (const tf of RED_SNIPER_DIRECT_TFS) {
    redSniperStore[tf] = loadRedSniperJsonlForTf(tf);
    const maxCap = tf === '1m' ? 400000 : 10000;
    const fromSqlite = getCandlesFromSqlite(tf, maxCap);
    if (fromSqlite.length > 0) {
      redSniperStore[tf] = dedupeAndMergeRedSniperCandles(redSniperStore[tf], fromSqlite, maxCap);
    }
  }
  if (fs.existsSync(DATA_FILE)) {
    try {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && (Array.isArray(parsed.H1) || Array.isArray(parsed.M15))) {
        store = {
          symbol: parsed.symbol || 'XAUUSD',
          lastUpdated: parsed.lastUpdated || new Date().toISOString(),
          htfBootstrapMethod: parsed.htfBootstrapMethod || 'NATIVE_BIQUOTE_OHLC_INTERVALS',
          M1: parsed.M1 || [],
          M5: parsed.M5 || [],
          M15: parsed.M15 || [],
          M30: parsed.M30 || [],
          H1: parsed.H1 || [],
          H4: parsed.H4 || [],
          D1: parsed.D1 || [],
        };
        syncStoreToRedSniperMemory();
        // Also ensure store.M1..D1 includes any older candles from redSniperStore
        const toLegacy = (sc: RedSniperStoredCandle): Candle => ({
          openTime: new Date(sc.time * 1000).toISOString(),
          open: sc.open,
          high: sc.high,
          low: sc.low,
          close: sc.close,
          volume: sc.tickVolume || 1,
          isClosed: sc.isClosed !== false,
          usableForZones: true,
          source: sc.source === 'hist' ? 'hist' : 'live',
        });
        store.M1 = mergeCandleSeries(redSniperStore['1m'].slice(-10000).map(toLegacy), store.M1, 10000);
        store.M5 = mergeCandleSeries(redSniperStore['5m'].map(toLegacy), store.M5, 10000);
        store.M15 = mergeCandleSeries(redSniperStore['15m'].map(toLegacy), store.M15, 10000);
        store.M30 = mergeCandleSeries(redSniperStore['30m'].map(toLegacy), store.M30, 10000);
        store.H1 = mergeCandleSeries(redSniperStore['1h'].map(toLegacy), store.H1, 10000);
        store.H4 = mergeCandleSeries(redSniperStore['4h'].map(toLegacy), store.H4, 10000);
        store.D1 = mergeCandleSeries(redSniperStore['1d'].map(toLegacy), store.D1, 10000);

        runGapDetectionAudit();
        saveRedSniperJsonlStoreToDisk();
        console.log(`[CANDLE ENGINE] Loaded candles from disk: M1=${store.M1.length}, M5=${store.M5.length}, M15=${store.M15.length}, M30=${store.M30.length}, H1=${store.H1.length}, H4=${store.H4.length}, D1=${store.D1.length}`);
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
  syncStoreToRedSniperMemory();
  return store;
}

// Persist candles to disk so history survives restarts
export function saveCandlesToDisk() {
  try {
    ensureDataDir();
    store.lastUpdated = new Date().toISOString();
    writeJsonAtomic(DATA_FILE, store);
    const localDataDir = path.resolve(process.cwd(), 'data');
    if (localDataDir !== DATA_DIR) {
      if (!fs.existsSync(localDataDir)) {
        fs.mkdirSync(localDataDir, { recursive: true });
      }
      writeJsonAtomic(path.resolve(localDataDir, 'candles.json'), store);
    }
    syncStoreToRedSniperMemory();
    saveRedSniperJsonlStoreToDisk();
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
  timestampMs: number,
  maxRetain: number = 5000
): boolean {
  const openTime = getPeriodStartTime(timestampMs, periodMinutes);
  const current = candles[candles.length - 1];
  let didClose = false;

  if (!current || current.openTime !== openTime) {
    if (current) {
      current.isClosed = true;
      didClose = true;
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

    if (candles.length > maxRetain) {
      candles.shift();
    }
  } else {
    current.high = Math.max(current.high, price);
    current.low = Math.min(current.low, price);
    current.close = price;
    current.volume += 1;
  }

  return didClose;
}

// Process new tick from live feed into all 7 timeframes
export function processTick(price: number, timestampMs: number) {
  const c1 = updateTimeframeCandles(store.M1, 1, price, timestampMs, 10000);
  const c5 = updateTimeframeCandles(store.M5, 5, price, timestampMs, 5000);
  const c15 = updateTimeframeCandles(store.M15, 15, price, timestampMs, 5000);
  const c30 = updateTimeframeCandles(store.M30, 30, price, timestampMs, 5000);
  const c60 = updateTimeframeCandles(store.H1, 60, price, timestampMs, 5000);
  const c240 = updateTimeframeCandles(store.H4, 240, price, timestampMs, 5000);
  const c1440 = updateTimeframeCandles(store.D1, 1440, price, timestampMs, 5000);

  if (c5 && store.M5.length > 0) {
    store.M15 = mergeCandleSeries(store.M15, buildTimeframeFromM5(store.M5, 15), 5000);
    store.M30 = mergeCandleSeries(store.M30, buildTimeframeFromM5(store.M5, 30), 5000);
    store.H1 = mergeCandleSeries(store.H1, buildTimeframeFromM5(store.M5, 60), 5000);
  }

  const anyClosed = c1 || c5 || c15 || c30 || c60 || c240 || c1440;
  if (anyClosed || Date.now() - lastSaveTime > 25000) {
    saveCandlesToDisk();
  }
}

const REQUIRED_MIN_BARS_BY_TF: Record<RedSniperStoreTf, number> = {
  '1m': 5000,
  '3m': 3000,
  '5m': 5000,
  '15m': 4000,
  '30m': 3000,
  '1h': 2500,
  '4h': 1500,
  '1d': 1000,
};

async function fetchTimeframeOhlcPage(
  intervalParam: string,
  limit: number,
  fromIso?: string,
  toIso?: string
): Promise<Candle[]> {
  const params = new URLSearchParams({
    interval: intervalParam,
    limit: String(limit),
  });
  if (fromIso) params.set('from', fromIso);
  if (toIso) params.set('to', toIso);

  const res = await fetch(`https://biquote.io/api/XAUUSD/ohlc?${params.toString()}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'SARRAF-Engine/2.0' },
  });

  if (!res.ok) {
    throw new Error(`biquote ohlc endpoint (${intervalParam}) returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const rawBars: any[] = data?.data?.bars || data?.bars || data?.candles || data?.data?.candles || [];

  if (!Array.isArray(rawBars) || rawBars.length === 0) {
    return [];
  }

  const tf = (['1m', '5m', '15m', '30m', '1h', '4h', '1d'].includes(intervalParam)
    ? intervalParam
    : '1m') as RedSniperDirectStoreTf;

  // Reverse descending array to chronological ascending order [oldest -> newest]
  const chronological = [...rawBars].reverse();

  return chronological.map((b: any, idx: number) => {
    const rawMs = b.openTime
      ? Date.parse(b.openTime)
      : typeof b.time === 'number'
      ? b.time < 10_000_000_000
        ? b.time * 1000
        : b.time
      : Date.parse(String(b.time || '')) || Date.now();
    const alignedSec = alignTimeSecToTf(Math.floor(rawMs / 1000), tf);
    return {
      openTime: new Date(alignedSec * 1000).toISOString(),
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.tickVolume || b.volume || 1),
      isClosed: idx < chronological.length - 1,
      usableForZones: true,
      source: 'live',
    };
  });
}

// Fetch authentic historical candles from biquote.io endpoint for a specific interval up to required depth
async function fetchTimeframeOhlc(intervalParam: string, limit: number = 5000): Promise<Candle[]> {
  const tf = (['1m', '5m', '15m', '30m', '1h', '4h', '1d'].includes(intervalParam)
    ? intervalParam
    : '1m') as RedSniperDirectStoreTf;
  const targetBars = Math.max(REQUIRED_MIN_BARS_BY_TF[tf] ?? 1000, limit);
  const reqLimit = Math.max(1000, targetBars);

  let collected = await fetchTimeframeOhlcPage(intervalParam, reqLimit);
  if (collected.length === 0 || limit <= 50) {
    return collected;
  }

  const periodSec = getRedSniperTfPeriodSeconds(tf);
  let attempts = 0;
  while (collected.length < targetBars && attempts < 3) {
    attempts++;
    const oldestMs = Date.parse(collected[0]?.openTime || '');
    if (Number.isNaN(oldestMs) || oldestMs <= 0) break;
    const oldestSec = Math.floor(oldestMs / 1000);
    const toSec = attempts === 1 ? oldestSec - periodSec : oldestSec;
    const chunkBars = attempts === 1 ? 500 : 1000 * attempts;
    const fromIso = new Date((toSec - chunkBars * periodSec) * 1000).toISOString();
    const toIso = new Date(toSec * 1000).toISOString();

    try {
      const olderBatch = await fetchTimeframeOhlcPage(intervalParam, reqLimit, fromIso, toIso);
      const strictlyOlder = olderBatch.filter((b) => Date.parse(b.openTime) < oldestMs);
      if (strictlyOlder.length === 0) {
        if (attempts >= 2) break;
        continue;
      }
      collected = mergeCandleSeries(strictlyOlder, collected, Math.max(5000, targetBars));
    } catch {
      break;
    }
  }

  return collected;
}

let activeRedSniperGaps: RedSniperGap[] = [];

export function getActiveRedSniperGaps(): RedSniperGap[] {
  return activeRedSniperGaps;
}

export function areAnyRedSniperTimeframesBelowMinimum(): boolean {
  const checkTfs: Array<Exclude<RedSniperDirectStoreTf, '1m'>> = [
    '5m',
    '15m',
    '30m',
    '1h',
    '4h',
    '1d',
  ];
  for (const tf of checkTfs) {
    const loaded = redSniperStore[tf]?.length ?? 0;
    const minReq = REQUIRED_MIN_BARS_BY_TF[tf] ?? 1000;
    if (loaded < minReq) {
      return true;
    }
  }
  return false;
}

async function persistMergedBackfillCandles(
  mergedByTf: Record<RedSniperDirectStoreTf, RedSniperStoredCandle[]>,
  offsetPts: number
): Promise<void> {
  const toLegacy = (sc: RedSniperStoredCandle): Candle => ({
    openTime: new Date(sc.time * 1000).toISOString(),
    open: sc.open,
    high: sc.high,
    low: sc.low,
    close: sc.close,
    volume: sc.tickVolume || 1,
    isClosed: sc.isClosed !== false,
    usableForZones: true,
    source: sc.source === 'hist' ? 'hist' : 'live',
  });

  for (const tf of RED_SNIPER_DIRECT_TFS) {
    const maxCap = tf === '1m' ? 400000 : 10000;
    redSniperStore[tf] = dedupeAndMergeRedSniperCandles(
      redSniperStore[tf],
      mergedByTf[tf] || [],
      maxCap
    );
  }

  store.M1 = mergeCandleSeries(
    redSniperStore['1m'].slice(-10000).map(toLegacy),
    store.M1,
    10000
  );
  store.M5 = mergeCandleSeries(
    redSniperStore['5m'].map(toLegacy),
    store.M5,
    10000
  );
  store.M15 = mergeCandleSeries(
    redSniperStore['15m'].map(toLegacy),
    store.M15,
    10000
  );
  store.M30 = mergeCandleSeries(
    redSniperStore['30m'].map(toLegacy),
    store.M30,
    10000
  );
  store.H1 = mergeCandleSeries(
    redSniperStore['1h'].map(toLegacy),
    store.H1,
    10000
  );
  store.H4 = mergeCandleSeries(
    redSniperStore['4h'].map(toLegacy),
    store.H4,
    10000
  );
  store.D1 = mergeCandleSeries(
    redSniperStore['1d'].map(toLegacy),
    store.D1,
    10000
  );
  store.htfBootstrapMethod = `DEEP_HISTORY_BACKFILL_MERGED (offset=${
    offsetPts >= 0 ? '+' : ''
  }${offsetPts.toFixed(3)}pts)`;

  await saveRedSniperJsonlStoreToDisk();
  saveCandlesToDisk();

  console.log(
    `[RED SNIPER BACKFILL] Persisted merged history | 5m=${redSniperStore['5m'].length}/${REQUIRED_MIN_BARS_BY_TF['5m']}, 15m=${redSniperStore['15m'].length}/${REQUIRED_MIN_BARS_BY_TF['15m']}, 30m=${redSniperStore['30m'].length}/${REQUIRED_MIN_BARS_BY_TF['30m']}, 1h=${redSniperStore['1h'].length}/${REQUIRED_MIN_BARS_BY_TF['1h']}, 4h=${redSniperStore['4h'].length}/${REQUIRED_MIN_BARS_BY_TF['4h']}, 1d=${redSniperStore['1d'].length}/${REQUIRED_MIN_BARS_BY_TF['1d']}`
  );
}

/**
 * Execute or trigger the deep history backfill job and merge into the Red Sniper store.
 */
export async function executeRedSniperBackfill(options?: {
  forceReset?: boolean;
  asyncMode?: boolean;
  throttleMs?: number;
}): Promise<RedSniperBackfillStatus> {
  syncStoreToRedSniperMemory();
  const liveCandlesByTf: Partial<Record<RedSniperStoreTf, RedSniperStoredCandle[]>> = {};
  for (const tf of RED_SNIPER_DIRECT_TFS) {
    liveCandlesByTf[tf] = (redSniperStore[tf] || []).filter(
      (c) => c.source !== 'hist'
    );
  }

  const runOpts = {
    forceReset: options?.forceReset ?? false,
    throttleMs: options?.throttleMs ?? 15,
    liveCandlesByTf,
    onPersistMerged: persistMergedBackfillCandles,
  };

  if (options?.asyncMode) {
    triggerAsyncRedSniperBackfill(runOpts).catch((err) => {
      console.warn('[RED SNIPER BACKFILL] Background job warning:', err?.message);
    });
    return getRedSniperBackfillStatus();
  }

  const res = await runRedSniperHistoryBackfill(runOpts);
  return res.status;
}

/**
 * Poll broker OHLC (M1 first, plus M5/M15/M30/H1/H4/D1) and merge/persist closed candles at least once per minute.
 * Compares newest stored M1 time with now, fills broker history, and updates remaining holes in activeRedSniperGaps.
 * Logs one line per minute only on change ("saved N candles") or on error.
 */
export async function syncBrokerCandlesToStore(): Promise<number> {
  try {
    const [m1Bars, m5Bars, m15Bars, m30Bars, h1Bars, h4Bars, d1Bars] = await Promise.all([
      fetchTimeframeOhlc('1m', REQUIRED_MIN_BARS_BY_TF['1m']).catch(() => []),
      fetchTimeframeOhlc('5m', REQUIRED_MIN_BARS_BY_TF['5m']).catch(() => []),
      fetchTimeframeOhlc('15m', REQUIRED_MIN_BARS_BY_TF['15m']).catch(() => []),
      fetchTimeframeOhlc('30m', REQUIRED_MIN_BARS_BY_TF['30m']).catch(() => []),
      fetchTimeframeOhlc('1h', REQUIRED_MIN_BARS_BY_TF['1h']).catch(() => []),
      fetchTimeframeOhlc('4h', REQUIRED_MIN_BARS_BY_TF['4h']).catch(() => []),
      fetchTimeframeOhlc('1d', REQUIRED_MIN_BARS_BY_TF['1d']).catch(() => []),
    ]);

    if (m1Bars.length > 0) store.M1 = mergeCandleSeries(store.M1, m1Bars, 10000);
    if (m5Bars.length > 0) store.M5 = mergeCandleSeries(store.M5, m5Bars, 10000);
    if (m15Bars.length > 0) store.M15 = mergeCandleSeries(store.M15, m15Bars, 10000);
    if (m30Bars.length > 0) store.M30 = mergeCandleSeries(store.M30, m30Bars, 10000);
    if (h1Bars.length > 0) store.H1 = mergeCandleSeries(store.H1, h1Bars, 10000);
    if (h4Bars.length > 0) store.H4 = mergeCandleSeries(store.H4, h4Bars, 10000);
    if (d1Bars.length > 0) store.D1 = mergeCandleSeries(store.D1, d1Bars, 10000);

    syncStoreToRedSniperMemory();

    // Gap detection: check any remaining holes in M1 candles compared with now (never invent candles)
    activeRedSniperGaps = detectRedSniperGaps(redSniperStore['1m'].slice(-10000));

    const savedCount = await saveRedSniperJsonlStoreToDisk();
    if (savedCount > 0) {
      console.log(
        `[RED SNIPER STORE] saved ${savedCount} candles | barsLoaded per TF: 5m=${redSniperStore['5m'].length}/${REQUIRED_MIN_BARS_BY_TF['5m']}, 15m=${redSniperStore['15m'].length}/${REQUIRED_MIN_BARS_BY_TF['15m']}, 30m=${redSniperStore['30m'].length}/${REQUIRED_MIN_BARS_BY_TF['30m']}, 1h=${redSniperStore['1h'].length}/${REQUIRED_MIN_BARS_BY_TF['1h']}, 4h=${redSniperStore['4h'].length}/${REQUIRED_MIN_BARS_BY_TF['4h']}, 1d=${redSniperStore['1d'].length}/${REQUIRED_MIN_BARS_BY_TF['1d']}`
      );
    }

    // Automatically trigger background deep history backfill on startup/sync if any timeframe is below its minimum
    if (areAnyRedSniperTimeframesBelowMinimum() && !getRedSniperBackfillStatus().running) {
      executeRedSniperBackfill({ asyncMode: true }).catch(() => {});
    }

    return savedCount;
  } catch (err: any) {
    console.error('[RED SNIPER STORE] Periodic broker sync error:', err?.message);
    return 0;
  }
}

export function startRedSniperCandlePersistenceWorker(): void {
  if (redSniperWorkerStarted) return;
  redSniperWorkerStarted = true;
  // Safe cold start: catch-up immediately first, then run every 60s
  syncBrokerCandlesToStore().catch((err) => {
    console.error('[RED SNIPER STORE] Startup catch-up error:', err?.message);
  });
  setInterval(() => {
    syncBrokerCandlesToStore().catch((err) => {
      console.error('[RED SNIPER STORE] Periodic worker error:', err?.message);
    });
  }, 60 * 1000);
}

export async function seedRedSniperMemoryFromStore(): Promise<void> {
  const storeInstance = getRedSniperStore();
  for (const tf of RED_SNIPER_DIRECT_TFS) {
    try {
      const maxCap = tf === '1m' ? 400000 : 10000;
      const fromStore = await storeInstance.getCandles(tf, maxCap);
      if (fromStore.length > 0) {
        redSniperStore[tf] = dedupeAndMergeRedSniperCandles(redSniperStore[tf], fromStore, maxCap);
      }
    } catch {}
  }
}

/**
 * Health telemetry returning stored rows per timeframe, oldest and newest candle time,
 * last write time, backend, persistent flag, gaps, firestoreOps counters, backfill progress, and instance uptime.
 */
export async function getRedSniperHealth(): Promise<RedSniperHealthReport> {
  const storeInstance = getRedSniperStore();
  const diskStats = getDataDirDiskStats(DATA_DIR);
  try {
    const base = await storeInstance.getHealth();
    return {
      ...base,
      backend: storeInstance.getBackendName(),
      persistent: storeInstance.isPersistent(),
      isKService: Boolean(process.env.K_SERVICE),
      instanceUptimeSeconds: Math.floor(process.uptime()),
      gaps: activeRedSniperGaps,
      dataDirPath: diskStats.dataDirPath,
      dataDirFreeBytes: diskStats.dataDirFreeBytes,
      dataDirFreeFormatted: diskStats.dataDirFreeFormatted,
      firestoreOps: base.firestoreOps,
      readLimitExceeded: base.readLimitExceeded,
      backfill: getRedSniperBackfillStatus(),
    };
  } catch (err: any) {
    return {
      ok: false,
      backend: storeInstance.getBackendName(),
      persistent: storeInstance.isPersistent(),
      isKService: Boolean(process.env.K_SERVICE),
      instanceUptimeSeconds: Math.floor(process.uptime()),
      gaps: activeRedSniperGaps,
      storedRowsPerTf: {},
      totalRows: 0,
      oldestCandleTime: null,
      oldestCandleIso: null,
      newestCandleTime: null,
      newestCandleIso: null,
      lastWriteTime: null,
      lastWriteIso: null,
      dbSource: storeInstance.getDbSource(),
      dataDirPath: diskStats.dataDirPath,
      dataDirFreeBytes: diskStats.dataDirFreeBytes,
      dataDirFreeFormatted: diskStats.dataDirFreeFormatted,
      botLogCount: 0,
      readLimitExceeded: false,
      backfill: getRedSniperBackfillStatus(),
    };
  }
}

/**
 * Serve candles for GET /api/redsniper/candles?tf=1m&limit=5000.
 * Loads direct timeframe candles from store/broker first; uses M1 aggregation ONLY as a fallback when direct candles are empty.
 */
export async function getRedSniperCandlesForApi(
  tfRaw: string,
  limitRaw: number = 5000
): Promise<{
  tf: RedSniperStoreTf;
  source: 'store' | 'broker';
  builtFromM1: boolean;
  count: number;
  oldestTime: number | null;
  oldestIso: string | null;
  newestTime: number | null;
  bars: RedSniperStoredCandle[];
  candles: RedSniperStoredCandle[];
}> {
  const validTfs: RedSniperStoreTf[] = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];
  const tf: RedSniperStoreTf = validTfs.includes(tfRaw as RedSniperStoreTf)
    ? (tfRaw as RedSniperStoreTf)
    : '1m';
  const reqMin = REQUIRED_MIN_BARS_BY_TF[tf] ?? 1000;
  const maxAllowed = tf === '1m' ? 50000 : 10000;
  const limit = Math.max(1, Math.min(maxAllowed, Math.max(reqMin, Number(limitRaw) || 5000)));

  syncStoreToRedSniperMemory();

  // If store for M1 or requested TF is completely empty, attempt an immediate sync from broker
  if (redSniperStore['1m'].length === 0 || (tf !== '3m' && redSniperStore[tf].length === 0)) {
    await syncBrokerCandlesToStore();
  }

  // Also merge any bars from active store
  const storeInstance = getRedSniperStore();
  if (tf !== '3m') {
    try {
      const maxCap = tf === '1m' ? 400000 : 10000;
      const fromStore = await storeInstance.getCandles(tf, limit);
      if (fromStore.length > 0) {
        redSniperStore[tf] = dedupeAndMergeRedSniperCandles(redSniperStore[tf], fromStore, maxCap);
      }
    } catch {}
  }

  // If any timeframe is still below its required minimum and backfill is not running, trigger background backfill
  if (areAnyRedSniperTimeframesBelowMinimum() && !getRedSniperBackfillStatus().running) {
    executeRedSniperBackfill({ asyncMode: true }).catch(() => {});
  }

  const m1Stored = redSniperStore['1m'] || [];
  let bars: RedSniperStoredCandle[] = [];
  let builtFromM1 = false;

  if (tf === '3m') {
    bars = buildHigherTfFromStoredM1(m1Stored, '3m', limit);
    builtFromM1 = true;
  } else if (tf === '5m' || tf === '15m' || tf === '30m') {
    const directStored = redSniperStore[tf] || [];
    if (directStored.length > 0) {
      bars = directStored.slice(-limit);
      builtFromM1 = false;
    } else {
      // M1 aggregation ONLY as a fallback when direct TF candles are empty
      bars = buildHigherTfFromStoredM1(m1Stored, tf, limit);
      builtFromM1 = true;
    }
  } else {
    bars = (redSniperStore[tf] || []).slice(-limit);
  }

  return {
    tf,
    source: 'store',
    builtFromM1,
    count: bars.length,
    oldestTime: bars.length > 0 ? bars[0].time : null,
    oldestIso: bars.length > 0 ? new Date(bars[0].time * 1000).toISOString() : null,
    newestTime: bars.length > 0 ? bars[bars.length - 1].time : null,
    bars,
    candles: bars,
  };
}

// ============================================================================
// SERVER BOT LOG PERSISTENCE (Active Store with local fallback)
// ============================================================================

const RED_SNIPER_BOT_LOG_FILE = path.resolve(DATA_DIR, 'redsniper_bot_log.json');
let serverBotLogCache: ServerBotLogEntry[] | null = null;

export async function loadRedSniperBotLogFromDisk(): Promise<ServerBotLogEntry[]> {
  const storeInstance = getRedSniperStore();
  try {
    const fromStore = await storeInstance.loadLogs();
    if (fromStore.length > 0) {
      serverBotLogCache = fromStore;
      return fromStore;
    }
  } catch (err: any) {
    console.warn('[RED SNIPER BOT LOG] Error loading from store:', err?.message);
  }
  if (serverBotLogCache !== null) return serverBotLogCache;
  ensureDataDir();
  if (!fs.existsSync(RED_SNIPER_BOT_LOG_FILE)) {
    serverBotLogCache = [];
    return serverBotLogCache;
  }
  try {
    const raw = fs.readFileSync(RED_SNIPER_BOT_LOG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      serverBotLogCache = parsed.slice(0, 200);
      return serverBotLogCache;
    }
  } catch (err: any) {
    console.warn('[RED SNIPER BOT LOG] Could not read redsniper_bot_log.json:', err?.message);
  }
  serverBotLogCache = [];
  return serverBotLogCache;
}

export async function appendRedSniperBotLogToDisk(incoming: ServerBotLogEntry[]): Promise<ServerBotLogEntry[]> {
  const storeInstance = getRedSniperStore();
  try {
    const saved = await storeInstance.appendLogs(incoming);
    serverBotLogCache = saved;
    try {
      ensureDataDir();
      writeJsonAtomic(RED_SNIPER_BOT_LOG_FILE, saved);
    } catch {}
    return saved;
  } catch (err: any) {
    console.error('[RED SNIPER BOT LOG] Error appending logs:', err?.message);
    const current = serverBotLogCache || [];
    const merged = [...incoming, ...current].slice(0, 200);
    serverBotLogCache = merged;
    return merged;
  }
}

export async function clearRedSniperBotLogOnDisk(): Promise<ServerBotLogEntry[]> {
  const storeInstance = getRedSniperStore();
  serverBotLogCache = [];
  try {
    await storeInstance.clearLogs();
  } catch (err: any) {
    console.error('[RED SNIPER BOT LOG] Error clearing logs:', err?.message);
  }
  try {
    ensureDataDir();
    writeJsonAtomic(RED_SNIPER_BOT_LOG_FILE, []);
  } catch {}
  return [];
}

// Bootstrap authentic historical candles from biquote.io for M1, M5, M15, M30, H1, H4, D1
export async function bootstrapHistoricalCandles(): Promise<boolean> {
  startRedSniperCandlePersistenceWorker();

  const hasEnough =
    store.M1.length >= REQUIRED_MIN_BARS_BY_TF['1m'] &&
    store.M5.length >= REQUIRED_MIN_BARS_BY_TF['5m'] &&
    store.M15.length >= REQUIRED_MIN_BARS_BY_TF['15m'] &&
    store.M30.length >= REQUIRED_MIN_BARS_BY_TF['30m'] &&
    store.H1.length >= REQUIRED_MIN_BARS_BY_TF['1h'] &&
    store.H4.length >= REQUIRED_MIN_BARS_BY_TF['4h'] &&
    store.D1.length >= REQUIRED_MIN_BARS_BY_TF['1d'];

  if (hasEnough) {
    runGapDetectionAudit();
    console.log(
      `[RED SNIPER HISTORY] Startup barsLoaded per TF: 5m=${store.M5.length}/${REQUIRED_MIN_BARS_BY_TF['5m']}, 15m=${store.M15.length}/${REQUIRED_MIN_BARS_BY_TF['15m']}, 30m=${store.M30.length}/${REQUIRED_MIN_BARS_BY_TF['30m']}, 1h=${store.H1.length}/${REQUIRED_MIN_BARS_BY_TF['1h']}, 4h=${store.H4.length}/${REQUIRED_MIN_BARS_BY_TF['4h']}, 1d=${store.D1.length}/${REQUIRED_MIN_BARS_BY_TF['1d']}`
    );
    return true;
  }

  try {
    console.log('[CANDLE ENGINE] Fetching authentic historical candles from biquote.io for M1, M5, M15, M30, H1, H4, D1...');

    const [m1Bars, m5Bars, m15Bars, m30Bars, h1Bars, h4Bars, d1Bars] = await Promise.all([
      fetchTimeframeOhlc('1m', REQUIRED_MIN_BARS_BY_TF['1m']).catch(() => []),
      fetchTimeframeOhlc('5m', REQUIRED_MIN_BARS_BY_TF['5m']).catch(() => []),
      fetchTimeframeOhlc('15m', REQUIRED_MIN_BARS_BY_TF['15m']).catch(() => []),
      fetchTimeframeOhlc('30m', REQUIRED_MIN_BARS_BY_TF['30m']).catch(() => []),
      fetchTimeframeOhlc('1h', REQUIRED_MIN_BARS_BY_TF['1h']).catch(() => []),
      fetchTimeframeOhlc('4h', REQUIRED_MIN_BARS_BY_TF['4h']).catch(() => []),
      fetchTimeframeOhlc('1d', REQUIRED_MIN_BARS_BY_TF['1d']).catch(() => []),
    ]);

    if (m1Bars.length > 0) store.M1 = mergeCandleSeries(store.M1, m1Bars, 10000);
    if (m5Bars.length > 0) store.M5 = mergeCandleSeries(store.M5, m5Bars, 5000);
    if (m15Bars.length > 0) store.M15 = mergeCandleSeries(store.M15, m15Bars, 5000);
    if (m30Bars.length > 0) store.M30 = mergeCandleSeries(store.M30, m30Bars, 5000);
    if (h1Bars.length > 0) store.H1 = mergeCandleSeries(store.H1, h1Bars, 5000);

    // Use M1 aggregation ONLY as a fallback when M5 is empty
    if (store.M5.length === 0 && store.M1.length > 0) {
      const fromM1 = buildM5FromM1(store.M1);
      store.M5 = mergeCandleSeries(store.M5, fromM1, 5000);
    }

    if (h4Bars.length > 0) {
      store.H4 = mergeCandleSeries(store.H4, h4Bars, 5000);
      store.htfBootstrapMethod = 'NATIVE_BIQUOTE_OHLC_INTERVALS (Direct 4h & 1d API bootstrap)';
    } else if (store.H4.length === 0 && store.H1.length > 0) {
      store.H4 = buildH4FromH1(store.H1);
      store.htfBootstrapMethod = 'AGGREGATED_FROM_STORED_H1_CANDLES (Session boundary aligned)';
    }

    if (d1Bars.length > 0) {
      store.D1 = mergeCandleSeries(store.D1, d1Bars, 5000);
    } else if (store.D1.length === 0 && store.H1.length > 0) {
      store.D1 = buildD1FromH1(store.H1);
    }

    runGapDetectionAudit();
    saveCandlesToDisk();

    if (areAnyRedSniperTimeframesBelowMinimum() && !getRedSniperBackfillStatus().running) {
      executeRedSniperBackfill({ asyncMode: true }).catch(() => {});
    }

    console.log(
      `[RED SNIPER HISTORY] Startup barsLoaded per TF: 5m=${store.M5.length}/${REQUIRED_MIN_BARS_BY_TF['5m']}, 15m=${store.M15.length}/${REQUIRED_MIN_BARS_BY_TF['15m']}, 30m=${store.M30.length}/${REQUIRED_MIN_BARS_BY_TF['30m']}, 1h=${store.H1.length}/${REQUIRED_MIN_BARS_BY_TF['1h']}, 4h=${store.H4.length}/${REQUIRED_MIN_BARS_BY_TF['4h']}, 1d=${store.D1.length}/${REQUIRED_MIN_BARS_BY_TF['1d']} (${store.htfBootstrapMethod})`
    );
    return true;
  } catch (err: any) {
    console.warn('[CANDLE ENGINE] Historical bootstrap failed, attempting aggregation fallback:', err.message);
    if (store.M1.length > 0 && store.M5.length === 0) {
      store.M5 = mergeCandleSeries(store.M5, buildM5FromM1(store.M1), 5000);
    }
    if (store.H1.length > 0) {
      if (store.H4.length === 0) store.H4 = buildH4FromH1(store.H1);
      if (store.D1.length === 0) store.D1 = buildD1FromH1(store.H1);
      store.htfBootstrapMethod = 'AGGREGATED_FROM_STORED_H1_CANDLES (Session boundary aligned)';
      runGapDetectionAudit();
      saveCandlesToDisk();
      return true;
    }
  }

  return false;
}

// On server startup: backfill the missing gap from the candle source before enabling the signal engine
export async function backfillCandleGaps(): Promise<boolean> {
  try {
    const [m1Bars, m5Bars, m15Bars, m30Bars, h1Bars, h4Bars, d1Bars] = await Promise.all([
      fetchTimeframeOhlc('1m', REQUIRED_MIN_BARS_BY_TF['1m']).catch(() => []),
      fetchTimeframeOhlc('5m', REQUIRED_MIN_BARS_BY_TF['5m']).catch(() => []),
      fetchTimeframeOhlc('15m', REQUIRED_MIN_BARS_BY_TF['15m']).catch(() => []),
      fetchTimeframeOhlc('30m', REQUIRED_MIN_BARS_BY_TF['30m']).catch(() => []),
      fetchTimeframeOhlc('1h', REQUIRED_MIN_BARS_BY_TF['1h']).catch(() => []),
      fetchTimeframeOhlc('4h', REQUIRED_MIN_BARS_BY_TF['4h']).catch(() => []),
      fetchTimeframeOhlc('1d', REQUIRED_MIN_BARS_BY_TF['1d']).catch(() => []),
    ]);

    let anyMerged = false;
    if (m1Bars.length > 0) { store.M1 = mergeCandleSeries(store.M1, m1Bars, 10000); anyMerged = true; }
    if (m5Bars.length > 0) { store.M5 = mergeCandleSeries(store.M5, m5Bars, 5000); anyMerged = true; }
    if (m15Bars.length > 0) { store.M15 = mergeCandleSeries(store.M15, m15Bars, 5000); anyMerged = true; }
    if (m30Bars.length > 0) { store.M30 = mergeCandleSeries(store.M30, m30Bars, 5000); anyMerged = true; }
    if (h1Bars.length > 0) { store.H1 = mergeCandleSeries(store.H1, h1Bars, 5000); anyMerged = true; }

    if (h4Bars.length > 0) {
      store.H4 = mergeCandleSeries(store.H4, h4Bars, 5000);
      anyMerged = true;
    } else if (store.H4.length === 0 && store.H1.length > 0) {
      store.H4 = buildH4FromH1(store.H1);
      anyMerged = true;
    }

    if (d1Bars.length > 0) {
      store.D1 = mergeCandleSeries(store.D1, d1Bars, 5000);
      anyMerged = true;
    } else if (store.D1.length === 0 && store.H1.length > 0) {
      store.D1 = buildD1FromH1(store.H1);
      anyMerged = true;
    }

    if (anyMerged) {
      runGapDetectionAudit();
      saveCandlesToDisk();
      console.log(
        `[RED SNIPER HISTORY] Startup backfill barsLoaded per TF: 5m=${store.M5.length}/${REQUIRED_MIN_BARS_BY_TF['5m']}, 15m=${store.M15.length}/${REQUIRED_MIN_BARS_BY_TF['15m']}, 30m=${store.M30.length}/${REQUIRED_MIN_BARS_BY_TF['30m']}, 1h=${store.H1.length}/${REQUIRED_MIN_BARS_BY_TF['1h']}, 4h=${store.H4.length}/${REQUIRED_MIN_BARS_BY_TF['4h']}, 1d=${store.D1.length}/${REQUIRED_MIN_BARS_BY_TF['1d']}`
      );
      return true;
    }
  } catch (err: any) {
    console.log('[CANDLE ENGINE] Startup gap backfill skipped (upstream unreachable)');
  }
  return false;
}

export function isHistoryGenuinelyMissing(): boolean {
  return store.D1.length < 5 || store.H1.length < 5;
}

// Get closed candles only (excluding active forming candle and gap candles when requested)
export function getClosedCandles(timeframe: 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1', includeGaps: boolean = false): Candle[] {
  const list = store[timeframe];
  if (!list || list.length === 0) return [];
  
  // Exclude last candle if it is still forming
  const closed = list.slice(0, -1);
  if (includeGaps) return closed;
  return closed.filter((c) => !c.hasGapBefore);
}

// Usable candle counts audit
export function getUsableCandleCounts() {
  const m1Usable = store.M1.filter((c, i) => i < store.M1.length - 1 && !c.hasGapBefore).length;
  const m5Usable = store.M5.filter((c, i) => i < store.M5.length - 1 && !c.hasGapBefore).length;
  const m15Usable = store.M15.filter((c, i) => i < store.M15.length - 1 && !c.hasGapBefore).length;
  const m30Usable = store.M30.filter((c, i) => i < store.M30.length - 1 && !c.hasGapBefore).length;
  const h1Usable = store.H1.filter((c, i) => i < store.H1.length - 1 && !c.hasGapBefore).length;
  const h4Usable = store.H4.filter((c, i) => i < store.H4.length - 1 && !c.hasGapBefore).length;
  const d1Usable = store.D1.filter((c, i) => i < store.D1.length - 1 && !c.hasGapBefore).length;

  return { m1Usable, m5Usable, m15Usable, m30Usable, h1Usable, h4Usable, d1Usable };
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
    lastRedSniperJsonlSaveMs,
    message,
  };
}

export function getCandleStore(): CandleStore {
  return store;
}

