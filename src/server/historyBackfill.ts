import fs from 'fs';
import path from 'path';
import {
  getHistoricalRates,
  Instrument,
  Price,
  Timeframe,
  Format,
} from 'dukascopy-node';
import { DATA_DIR, writeJsonAtomic } from './deploymentSafety.ts';
import {
  RedSniperStoredCandle,
  RedSniperBackfillStatus,
} from './redsniperStore.ts';

export type BackfillTimeframe = '1m' | '1d';
export type RebuiltHigherTf = '5m' | '15m' | '30m' | '1h' | '4h';
export type AllRedSniperTf = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export interface HistoryProvider {
  name: string;
  fetchCandles(
    tf: BackfillTimeframe,
    fromMs: number,
    toMs: number
  ): Promise<RedSniperStoredCandle[]>;
}

export interface FiveDayChunkSpec {
  key: string;
  fromMs: number;
  toMs: number;
  fromIso: string;
  toIso: string;
}

export interface PersistedBackfillState {
  provider: string;
  completedChunkKeys: string[];
  d1Completed: boolean;
  calibratedOffsetPts: number | null;
  offsetWarning: string | null;
  m1HistBars: number;
  d1HistBars: number;
  lastUpdatedIso: string;
  finishedAt: string | null;
  lastError?: string | null;
}

export interface BackfillBannerState {
  showBanner: boolean;
  state: 'NOT_RUN' | 'RUNNING' | 'FAILED' | 'COMPLETED';
  bannerText: string;
  providerError: string | null;
  progressPct: number;
}

/**
 * Bucket alignment boundaries (identical to the live feed & chart feed):
 * - 1m:  60s    -> Math.floor(timeSec / 60) * 60       (every minute at :00s UTC)
 * - 3m:  180s   -> Math.floor(timeSec / 180) * 180     (every 3 minutes from 00:00 UTC)
 * - 5m:  300s   -> Math.floor(timeSec / 300) * 300     (00:00, 00:05, 00:10, ... UTC)
 * - 15m: 900s   -> Math.floor(timeSec / 900) * 900     (00:00, 00:15, 00:30, 00:45 UTC)
 * - 30m: 1800s  -> Math.floor(timeSec / 1800) * 1800   (00:00, 00:30 UTC)
 * - 1h:  3600s  -> Math.floor(timeSec / 3600) * 3600   (every hour on the hour XX:00 UTC)
 * - 4h:  14400s -> Math.floor((timeSec - offsetSec) / 14400) * 14400 + offsetSec
 * - 1d:  86400s -> Math.floor((timeSec - offsetSec) / 86400) * 86400 + offsetSec
 */
export const BUCKET_PERIOD_SECONDS: Record<AllRedSniperTf, number> = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

export function alignTimestampSecToBucket(
  timeSec: number,
  tf: AllRedSniperTf,
  offsetHours: number = 0
): number {
  const periodSec = BUCKET_PERIOD_SECONDS[tf] ?? 60;
  const safeOffsetHours =
    (tf === '4h' || tf === '1d') && Number.isFinite(offsetHours)
      ? Math.round(offsetHours)
      : 0;
  const offsetSec = safeOffsetHours * 3600;
  return Math.floor((timeSec - offsetSec) / periodSec) * periodSec + offsetSec;
}

const DUKASCOPY_CACHE_DIR = path.resolve(DATA_DIR, 'dukascopy-cache');
const CHUNK_DISK_CACHE_DIR = path.resolve(DATA_DIR, 'history-chunks');
const DEFAULT_BACKFILL_STATE_FILE = path.resolve(
  DATA_DIR,
  'redsniper_backfill_state.json'
);

function ensureCacheDirs(): void {
  if (!fs.existsSync(DUKASCOPY_CACHE_DIR)) {
    fs.mkdirSync(DUKASCOPY_CACHE_DIR, { recursive: true });
  }
  if (!fs.existsSync(CHUNK_DISK_CACHE_DIR)) {
    fs.mkdirSync(CHUNK_DISK_CACHE_DIR, { recursive: true });
  }
}

function getChunkDiskCacheFile(
  providerName: string,
  tf: BackfillTimeframe,
  fromMs: number,
  toMs: number
): string {
  const fromSec = Math.floor(fromMs / 1000);
  const toSec = Math.floor(toMs / 1000);
  const safeProvider = providerName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.resolve(
    CHUNK_DISK_CACHE_DIR,
    `${safeProvider}_${tf}_${fromSec}_${toSec}.json`
  );
}

function getD1LatestDiskCacheFile(providerName: string): string {
  const safeProvider = providerName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.resolve(CHUNK_DISK_CACHE_DIR, `${safeProvider}_1d_latest.json`);
}

function readCachedChunkFromDisk(
  providerName: string,
  tf: BackfillTimeframe,
  fromMs: number,
  toMs: number,
  allowEmptyArray: boolean = false
): RedSniperStoredCandle[] | null {
  try {
    const file = getChunkDiskCacheFile(providerName, tf, fromMs, toMs);
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && (parsed.length > 0 || allowEmptyArray)) {
        return parsed;
      }
    }
    if (tf === '1d') {
      const latestFile = getD1LatestDiskCacheFile(providerName);
      if (fs.existsSync(latestFile)) {
        const raw = fs.readFileSync(latestFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    }
  } catch {
    // Ignore corrupted cache file
  }
  return null;
}

function writeCachedChunkToDisk(
  providerName: string,
  tf: BackfillTimeframe,
  fromMs: number,
  toMs: number,
  candles: RedSniperStoredCandle[],
  allowEmptyArray: boolean = false
): void {
  if (!candles || (candles.length === 0 && !allowEmptyArray)) return;
  try {
    ensureCacheDirs();
    const file = getChunkDiskCacheFile(providerName, tf, fromMs, toMs);
    writeJsonAtomic(file, candles);
    if (tf === '1d' && candles.length > 0) {
      writeJsonAtomic(getD1LatestDiskCacheFile(providerName), candles);
    }
  } catch {
    // Best-effort cache write
  }
}

/**
 * Estimate buyVol/sellVol from OHLC close location within the bar range when provider only gives total volume.
 */
function splitVolumeByBarClose(
  open: number,
  high: number,
  low: number,
  close: number,
  tickVolume: number
): { buyVol: number; sellVol: number } {
  const safeVol = Math.max(1, Math.round(tickVolume));
  const range = high - low;
  let buyRatio = 0.5;
  if (range > 1e-6) {
    buyRatio = Math.max(0.05, Math.min(0.95, (close - low) / range));
  } else if (close > open) {
    buyRatio = 0.7;
  } else if (close < open) {
    buyRatio = 0.3;
  }
  const buyVol = Math.round(safeVol * buyRatio);
  const sellVol = Math.max(0, safeVol - buyVol);
  return { buyVol, sellVol };
}

/**
 * Returns true if a UTC timestamp (in ms) falls inside the standard forex/gold weekend market closure:
 * Saturday 00:00 UTC through Sunday 21:59 UTC.
 */
export function isGoldWeekendClosedUtc(timestampMs: number): boolean {
  const d = new Date(timestampMs);
  const day = d.getUTCDay(); // 0 = Sun, 6 = Sat
  const hour = d.getUTCHours();
  if (day === 6) return true;
  if (day === 0 && hour < 22) return true;
  return false;
}

/**
 * Returns true if the entire [fromMs, toMs] interval lies within a single weekend closure.
 */
export function isEntireRangeWeekendUtc(fromMs: number, toMs: number): boolean {
  if (toMs <= fromMs) return true;
  const durationHours = (toMs - fromMs) / (3600 * 1000);
  if (durationHours > 48) return false;
  const stepMs = 30 * 60 * 1000;
  for (let t = fromMs; t < toMs; t += stepMs) {
    if (!isGoldWeekendClosedUtc(t)) {
      return false;
    }
  }
  return isGoldWeekendClosedUtc(toMs - 1);
}

/**
 * 1A) DukascopyProvider (default)
 * Uses "dukascopy-node" package, instrument "xauusd" (Instrument.xauusd), timeframe m1 and d1.
 * Uses mid price if supported by Price enum, otherwise bid (Price.bid).
 */
export class DukascopyProvider implements HistoryProvider {
  public readonly name = 'dukascopy';
  public readonly instrumentCode: string;
  public readonly priceTypeUsed: 'mid' | 'bid';

  constructor() {
    this.instrumentCode = Instrument?.xauusd || 'xauusd';
    const supportedPrices = Price as Record<string, string>;
    this.priceTypeUsed =
      typeof supportedPrices?.mid === 'string' ? 'mid' : 'bid';
  }

  public async fetchCandles(
    tf: BackfillTimeframe,
    fromMs: number,
    toMs: number
  ): Promise<RedSniperStoredCandle[]> {
    if (toMs <= fromMs || isEntireRangeWeekendUtc(fromMs, toMs)) {
      return [];
    }

    const cached = readCachedChunkFromDisk(this.name, tf, fromMs, toMs);
    if (cached) {
      return cached;
    }

    ensureCacheDirs();
    const dukaTf = tf === '1d' ? Timeframe.d1 : Timeframe.m1;
    const rawRows = (await getHistoricalRates({
      instrument: this.instrumentCode as any,
      dates: {
        from: new Date(fromMs),
        to: new Date(toMs),
      },
      timeframe: dukaTf,
      priceType: this.priceTypeUsed as any,
      format: Format.json,
      volumes: true,
      ignoreFlats: true,
      useCache: true,
      cacheFolderPath: DUKASCOPY_CACHE_DIR,
      batchSize: 10,
      pauseBetweenBatchesMs: 150,
      retryCount: 3,
      pauseBetweenRetriesMs: 500,
    })) as Array<{
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume?: number;
    }>;

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return [];
    }

    const out: RedSniperStoredCandle[] = [];
    for (const r of rawRows) {
      if (!r || typeof r.timestamp !== 'number') continue;
      const open = Number(r.open);
      const high = Number(r.high);
      const low = Number(r.low);
      const close = Number(r.close);
      if (
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close) ||
        open <= 0 ||
        high <= 0 ||
        low <= 0 ||
        close <= 0
      ) {
        continue;
      }

      if (tf === '1m' && isGoldWeekendClosedUtc(r.timestamp)) {
        continue;
      }

      const alignedSec = alignTimestampSecToBucket(
        Math.floor(r.timestamp / 1000),
        tf
      );
      const rawVol = Number(r.volume ?? 0);
      const tickVolume = Math.max(
        1,
        Math.round(rawVol > 0 ? rawVol * 1000 : 10)
      );
      const { buyVol, sellVol } = splitVolumeByBarClose(
        open,
        high,
        low,
        close,
        tickVolume
      );

      out.push({
        time: alignedSec,
        open,
        high,
        low,
        close,
        tickVolume,
        buyVol,
        sellVol,
        isClosed: true,
        source: 'hist',
      });
    }

    const deduped = mergeHistAndLiveCandles(out, [], tf, 500000);
    writeCachedChunkToDisk(this.name, tf, fromMs, toMs, deduped);
    return deduped;
  }
}

/**
 * 1B) OandaProvider (optional, used when env OANDA_TOKEN is set)
 * Practice endpoint: https://api-fxpractice.oanda.com/v3/instruments/XAU_USD/candles
 * price=M (mid), granularity M1 / D, max 5000 candles per request, paginate with from/to.
 */
export class OandaProvider implements HistoryProvider {
  public readonly name = 'oanda';
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(token?: string) {
    this.token = (
      token ||
      process.env.OANDA_TOKEN ||
      process.env.OANDA_API_KEY ||
      ''
    ).trim();
    this.baseUrl =
      'https://api-fxpractice.oanda.com/v3/instruments/XAU_USD/candles';
  }

  public async fetchCandles(
    tf: BackfillTimeframe,
    fromMs: number,
    toMs: number
  ): Promise<RedSniperStoredCandle[]> {
    if (!this.token) {
      throw new Error('OANDA_TOKEN is not configured for OandaProvider');
    }
    if (toMs <= fromMs || isEntireRangeWeekendUtc(fromMs, toMs)) {
      return [];
    }

    const cached = readCachedChunkFromDisk(this.name, tf, fromMs, toMs);
    if (cached) {
      return cached;
    }

    const granularity = tf === '1d' ? 'D' : 'M1';
    const periodMs = tf === '1d' ? 86400 * 1000 : 60 * 1000;
    const maxStepMs = 4900 * periodMs;

    const collected: RedSniperStoredCandle[] = [];
    let cursorFromMs = fromMs;

    while (cursorFromMs < toMs) {
      const windowToMs = Math.min(toMs, cursorFromMs + maxStepMs);
      const params = new URLSearchParams({
        price: 'M',
        granularity,
        from: new Date(cursorFromMs).toISOString(),
        to: new Date(windowToMs).toISOString(),
      });

      const res = await fetch(`${this.baseUrl}?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          'Accept-Datetime-Format': 'RFC3339',
        },
      });

      if (!res.ok) {
        throw new Error(`OandaProvider HTTP ${res.status} for ${granularity}`);
      }

      const json: any = await res.json();
      const rawCandles: any[] = Array.isArray(json?.candles)
        ? json.candles
        : [];

      for (const c of rawCandles) {
        if (!c || !c.time || !c.mid) continue;
        const tMs = Date.parse(c.time);
        if (Number.isNaN(tMs) || tMs <= 0) continue;
        if (tf === '1m' && isGoldWeekendClosedUtc(tMs)) continue;

        const open = Number(c.mid.o);
        const high = Number(c.mid.h);
        const low = Number(c.mid.l);
        const close = Number(c.mid.c);
        if (
          !Number.isFinite(open) ||
          !Number.isFinite(high) ||
          !Number.isFinite(low) ||
          !Number.isFinite(close)
        ) {
          continue;
        }

        const alignedSec = alignTimestampSecToBucket(
          Math.floor(tMs / 1000),
          tf
        );
        const tickVolume = Math.max(1, Number(c.volume ?? 1));
        const { buyVol, sellVol } = splitVolumeByBarClose(
          open,
          high,
          low,
          close,
          tickVolume
        );

        collected.push({
          time: alignedSec,
          open,
          high,
          low,
          close,
          tickVolume,
          buyVol,
          sellVol,
          isClosed: c.complete !== false,
          source: 'hist',
        });
      }

      if (windowToMs >= toMs) break;
      cursorFromMs = windowToMs;
    }

    const deduped = mergeHistAndLiveCandles(collected, [], tf, 500000);
    writeCachedChunkToDisk(this.name, tf, fromMs, toMs, deduped);
    return deduped;
  }
}

/**
 * Factory choosing HistoryProvider by env HISTORY_PROVIDER (default "dukascopy").
 * Uses OandaProvider when HISTORY_PROVIDER="oanda" or when OANDA_TOKEN is set and HISTORY_PROVIDER is not explicitly "dukascopy".
 */
export function createHistoryProvider(overrideName?: string): HistoryProvider {
  const rawEnv = (overrideName || process.env.HISTORY_PROVIDER || '')
    .trim()
    .toLowerCase();
  const hasOandaToken = Boolean(
    (process.env.OANDA_TOKEN || '').trim()
  );

  if (rawEnv === 'oanda' || (!rawEnv && hasOandaToken)) {
    return new OandaProvider();
  }
  return new DukascopyProvider();
}

/**
 * Build 5-day M1 download chunks covering the requested trading days (default 260 trading days = 52 5-day weekday chunks),
 * skipping weekend closures.
 */
export function buildFiveDayM1Chunks(
  toMs: number = Date.now(),
  tradingDaysTarget: number = 260,
  explicitFromMs?: number
): FiveDayChunkSpec[] {
  const FIVE_DAYS_MS = 5 * 86400 * 1000;
  const ONE_DAY_MS = 86400 * 1000;

  // 260 trading days = 52 weeks (~364 calendar days)
  const calendarDays = Math.ceil((tradingDaysTarget / 5) * 7) + 4;
  const startMs =
    explicitFromMs !== undefined
      ? explicitFromMs
      : toMs - calendarDays * ONE_DAY_MS;

  const chunks: FiveDayChunkSpec[] = [];
  let cursor = startMs;

  while (cursor < toMs) {
    // Advance cursor past weekend closure if cursor starts inside Saturday 00:00 .. Sunday 22:00 UTC
    while (cursor < toMs && isGoldWeekendClosedUtc(cursor)) {
      cursor += 3600 * 1000;
    }
    if (cursor >= toMs) break;

    let chunkEnd = Math.min(toMs, cursor + FIVE_DAYS_MS);

    // If chunkEnd lands inside the weekend, trim chunkEnd to Saturday 00:00 UTC and advance next cursor to Sunday 22:00 UTC
    const dCursor = new Date(cursor);
    const dayOfWeek = dCursor.getUTCDay(); // 0=Sun..6=Sat
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      const daysUntilSaturday = 6 - dayOfWeek;
      const satMidnightMs =
        Date.UTC(
          dCursor.getUTCFullYear(),
          dCursor.getUTCMonth(),
          dCursor.getUTCDate() + daysUntilSaturday,
          0,
          0,
          0
        );
      if (satMidnightMs > cursor && satMidnightMs < chunkEnd) {
        chunkEnd = satMidnightMs;
      }
    }

    if (!isEntireRangeWeekendUtc(cursor, chunkEnd) && chunkEnd > cursor) {
      const fromSec = Math.floor(cursor / 1000);
      const toSec = Math.floor(chunkEnd / 1000);
      chunks.push({
        key: `m1_${fromSec}_${toSec}`,
        fromMs: cursor,
        toMs: chunkEnd,
        fromIso: new Date(cursor).toISOString(),
        toIso: new Date(chunkEnd).toISOString(),
      });
    }

    cursor = chunkEnd;
  }

  return chunks;
}

/**
 * 3A) OFFSET CALIBRATION
 * Compute the median of (live M1 close - provider M1 close) over the last 24h overlap
 * and return { offsetPts, overlapCount, warning }.
 */
export function computeMedianCloseOffset(
  liveM1: ReadonlyArray<RedSniperStoredCandle>,
  providerM1: ReadonlyArray<RedSniperStoredCandle>,
  overlapWindowSec: number = 86400
): {
  offsetPts: number;
  overlapCount: number;
  warning: string | null;
} {
  if (!liveM1 || liveM1.length === 0 || !providerM1 || providerM1.length === 0) {
    return { offsetPts: 0, overlapCount: 0, warning: null };
  }

  const providerByTime = new Map<number, number>();
  for (const p of providerM1) {
    if (p && Number.isFinite(p.time) && Number.isFinite(p.close)) {
      const aligned = alignTimestampSecToBucket(p.time, '1m');
      providerByTime.set(aligned, p.close);
    }
  }

  const sortedLive = [...liveM1]
    .filter((c) => c && Number.isFinite(c.time) && Number.isFinite(c.close))
    .sort((a, b) => a.time - b.time);

  if (sortedLive.length === 0) {
    return { offsetPts: 0, overlapCount: 0, warning: null };
  }

  const newestLiveSec = sortedLive[sortedLive.length - 1].time;
  const cutoffSec = newestLiveSec - overlapWindowSec;

  let diffs: number[] = [];
  for (const lb of sortedLive) {
    const aligned = alignTimestampSecToBucket(lb.time, '1m');
    if (aligned < cutoffSec) continue;
    const provClose = providerByTime.get(aligned);
    if (provClose !== undefined && Number.isFinite(provClose)) {
      diffs.push(lb.close - provClose);
    }
  }

  // Fallback to all overlapping timestamps if last 24h had no overlap
  if (diffs.length === 0) {
    for (const lb of sortedLive) {
      const aligned = alignTimestampSecToBucket(lb.time, '1m');
      const provClose = providerByTime.get(aligned);
      if (provClose !== undefined && Number.isFinite(provClose)) {
        diffs.push(lb.close - provClose);
      }
    }
  }

  if (diffs.length === 0) {
    return { offsetPts: 0, overlapCount: 0, warning: null };
  }

  diffs.sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  const medianRaw =
    diffs.length % 2 === 1
      ? diffs[mid]
      : (diffs[mid - 1] + diffs[mid]) / 2;
  const offsetPts = Number(medianRaw.toFixed(4));

  let warning: string | null = null;
  if (Math.abs(offsetPts) > 3) {
    warning = `Calibrated offset ${offsetPts >= 0 ? '+' : ''}${offsetPts.toFixed(
      2
    )} pts exceeds 3.00 pts threshold`;
    console.warn(`[RED SNIPER BACKFILL] WARNING: ${warning}`);
  }

  console.log(
    `[RED SNIPER BACKFILL] Calibrated M1 offset (live - provider): ${
      offsetPts >= 0 ? '+' : ''
    }${offsetPts.toFixed(3)} pts over ${diffs.length} overlapping M1 bars`
  );

  return {
    offsetPts,
    overlapCount: diffs.length,
    warning,
  };
}

/**
 * Apply calibrated constant offset to all 'hist' candles (leaves 'live' candles unchanged).
 */
export function applyOffsetToHistCandles(
  candles: ReadonlyArray<RedSniperStoredCandle>,
  offsetPts: number
): RedSniperStoredCandle[] {
  if (!candles || candles.length === 0) return [];
  const safeOffset = Number.isFinite(offsetPts) ? offsetPts : 0;
  return candles.map((c) => {
    const src = c.source === 'hist' ? 'hist' : 'live';
    if (src !== 'hist' || safeOffset === 0) {
      return { ...c, source: src };
    }
    return {
      ...c,
      open: Number((c.open + safeOffset).toFixed(3)),
      high: Number((c.high + safeOffset).toFixed(3)),
      low: Number((c.low + safeOffset).toFixed(3)),
      close: Number((c.close + safeOffset).toFixed(3)),
      source: 'hist',
    };
  });
}

/**
 * 3B) MERGE BY TIMESTAMP
 * Live candles ('live') ALWAYS win in the overlap over historical ('hist') candles.
 * Fills gaps, removes duplicates, and returns ascending chronological candles.
 */
export function mergeHistAndLiveCandles(
  histCandles: ReadonlyArray<RedSniperStoredCandle>,
  liveCandles: ReadonlyArray<RedSniperStoredCandle>,
  tf: AllRedSniperTf,
  maxLimit: number = 400000
): RedSniperStoredCandle[] {
  const byTime = new Map<number, RedSniperStoredCandle>();

  // 1. Insert historical candles first
  for (const c of histCandles || []) {
    if (
      !c ||
      typeof c.time !== 'number' ||
      !Number.isFinite(c.time) ||
      c.time <= 0
    ) {
      continue;
    }
    const aligned = alignTimestampSecToBucket(c.time, tf);
    const src = c.source === 'live' ? 'live' : 'hist';
    const prev = byTime.get(aligned);
    if (!prev || prev.source !== 'live') {
      byTime.set(aligned, {
        ...c,
        time: aligned,
        source: src,
      });
    }
  }

  // 2. Insert live candles (always overwrite 'hist' in the overlap)
  for (const c of liveCandles || []) {
    if (
      !c ||
      typeof c.time !== 'number' ||
      !Number.isFinite(c.time) ||
      c.time <= 0
    ) {
      continue;
    }
    const aligned = alignTimestampSecToBucket(c.time, tf);
    const prev = byTime.get(aligned);
    const src = c.source === 'hist' ? 'hist' : 'live';

    if (prev && prev.source === 'live' && src === 'hist') {
      continue;
    }

    let buyVol = c.buyVol || 0;
    let sellVol = c.sellVol || 0;
    const tickVolume =
      c.tickVolume > 0 ? c.tickVolume : prev?.tickVolume || 1;
    if (buyVol + sellVol === 0 && prev && prev.buyVol + prev.sellVol > 0) {
      const ratio =
        prev.buyVol / Math.max(1, prev.buyVol + prev.sellVol);
      buyVol = Math.round(tickVolume * ratio);
      sellVol = Math.max(0, tickVolume - buyVol);
    } else if (buyVol + sellVol === 0) {
      const split = splitVolumeByBarClose(
        c.open,
        c.high,
        c.low,
        c.close,
        tickVolume
      );
      buyVol = split.buyVol;
      sellVol = split.sellVol;
    }

    byTime.set(aligned, {
      time: aligned,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      tickVolume,
      buyVol,
      sellVol,
      isClosed: c.isClosed ?? prev?.isClosed ?? true,
      source: src,
    });
  }

  const sorted = Array.from(byTime.values()).sort((a, b) => a.time - b.time);
  if (sorted.length > maxLimit) {
    return sorted.slice(-maxLimit);
  }
  return sorted;
}

export interface TimeframeRebuildAlignmentOptions {
  h4AlignmentOffsetHours?: number;
  dailyAlignmentUtcHour?: number;
}

/**
 * Rebuild a single higher timeframe (5m / 15m / 30m / 1h / 4h / 1d) from M1 candles
 * using optional hour alignment offset (h4AlignmentOffsetHours for 4h, dailyAlignmentUtcHour for 1d).
 */
export function rebuildSingleTimeframeFromM1(
  m1Candles: ReadonlyArray<RedSniperStoredCandle>,
  tf: RebuiltHigherTf | '1d',
  offsetHours: number = 0,
  maxBars: number = 10000
): RedSniperStoredCandle[] {
  if (!m1Candles || m1Candles.length === 0) return [];
  const sortedM1 = [...m1Candles].sort((a, b) => a.time - b.time);
  const periodSec = BUCKET_PERIOD_SECONDS[tf];
  const expectedM1Bars = periodSec / 60;
  const safeOffsetHours =
    (tf === '4h' || tf === '1d') && Number.isFinite(offsetHours)
      ? Math.round(offsetHours)
      : 0;
  const offsetSec = safeOffsetHours * 3600;
  const buckets = new Map<number, RedSniperStoredCandle[]>();

  for (const bar of sortedM1) {
    const bucketSec =
      Math.floor((bar.time - offsetSec) / periodSec) * periodSec + offsetSec;
    let group = buckets.get(bucketSec);
    if (!group) {
      group = [];
      buckets.set(bucketSec, group);
    }
    group.push(bar);
  }

  const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
  const rebuilt: RedSniperStoredCandle[] = [];

  for (let i = 0; i < keys.length; i++) {
    const bucketSec = keys[i];
    const group = buckets.get(bucketSec)!;
    const open = group[0].open;
    const close = group[group.length - 1].close;
    let high = group[0].high;
    let low = group[0].low;
    let tickVolume = 0;
    let buyVol = 0;
    let sellVol = 0;
    let hasLive = false;

    for (const b of group) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      tickVolume += b.tickVolume || 0;
      buyVol += b.buyVol || 0;
      sellVol += b.sellVol || 0;
      if (b.source === 'live') hasLive = true;
    }

    const isLast = i === keys.length - 1;
    rebuilt.push({
      time: bucketSec,
      open,
      high,
      low,
      close,
      tickVolume,
      buyVol,
      sellVol,
      isClosed: !isLast || group.length >= expectedM1Bars,
      source: hasLive ? 'live' : 'hist',
    });
  }

  return rebuilt.length > maxBars ? rebuilt.slice(-maxBars) : rebuilt;
}

/**
 * 3C) REBUILD 5m / 15m / 30m / 1H / 4H FROM MERGED M1 SERIES
 * Uses the exact same UTC bucket alignment as the live feed (plus optional h4AlignmentOffsetHours for 4H):
 * - 5m:  Math.floor(timeSec / 300) * 300
 * - 15m: Math.floor(timeSec / 900) * 900
 * - 30m: Math.floor(timeSec / 1800) * 1800
 * - 1h:  Math.floor(timeSec / 3600) * 3600
 * - 4h:  Math.floor((timeSec - h4OffsetSec) / 14400) * 14400 + h4OffsetSec
 * When `liveHigherTfByTf` is supplied, live candles win in any bucket where live M1 did not cover the full bucket,
 * ensuring zero seams between historical and live data.
 */
export function rebuildTimeframesFromMergedM1(
  mergedM1: ReadonlyArray<RedSniperStoredCandle>,
  liveHigherTfByTf?: Partial<Record<RebuiltHigherTf, ReadonlyArray<RedSniperStoredCandle>>>,
  maxBarsPerTf: number = 10000,
  alignmentOptions?: TimeframeRebuildAlignmentOptions
): Record<RebuiltHigherTf, RedSniperStoredCandle[]> {
  const result: Record<RebuiltHigherTf, RedSniperStoredCandle[]> = {
    '5m': [],
    '15m': [],
    '30m': [],
    '1h': [],
    '4h': [],
  };

  if (!mergedM1 || mergedM1.length === 0) {
    if (liveHigherTfByTf) {
      for (const tf of ['5m', '15m', '30m', '1h', '4h'] as RebuiltHigherTf[]) {
        const liveList = liveHigherTfByTf[tf];
        if (liveList && liveList.length > 0) {
          result[tf] = mergeHistAndLiveCandles([], liveList, tf, maxBarsPerTf);
        }
      }
    }
    return result;
  }

  const h4OffsetHours = alignmentOptions?.h4AlignmentOffsetHours ?? 0;
  const tfs: RebuiltHigherTf[] = ['5m', '15m', '30m', '1h', '4h'];

  for (const tf of tfs) {
    const tfOffset = tf === '4h' ? h4OffsetHours : 0;
    const rebuilt = rebuildSingleTimeframeFromM1(
      mergedM1,
      tf,
      tfOffset,
      maxBarsPerTf
    );

    const liveTfBars = liveHigherTfByTf?.[tf];
    if (liveTfBars && liveTfBars.length > 0 && tfOffset === 0) {
      const taggedLive = liveTfBars.map((c) => ({
        ...c,
        source: 'live' as const,
      }));
      result[tf] = mergeHistAndLiveCandles(
        rebuilt,
        taggedLive,
        tf,
        maxBarsPerTf
      );
    } else {
      result[tf] = rebuilt;
    }
  }

  return result;
}

// ============================================================================
// PROVIDER ERROR CLASSIFIER & BACKFILL BANNER FORMATTER
// ============================================================================

/**
 * Normalize and classify provider errors so UI DIAGNOSTICS clearly surfaces:
 * - "network blocked" (DNS, ECONNREFUSED, ETIMEDOUT, fetch failed, 403)
 * - "rate limit" (HTTP 429, Too Many Requests)
 * - "instrument not found" (HTTP 404, invalid instrument, unknown symbol)
 */
export function classifyBackfillProviderError(err: any): string {
  const rawMsg = String(err?.message || err || 'Unknown provider error').trim();
  const code = String(err?.code || err?.cause?.code || '').toUpperCase();
  const lower = `${code} ${rawMsg}`.toLowerCase();

  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return lower.startsWith('rate limit')
      ? rawMsg
      : `rate limit (${rawMsg})`;
  }

  if (
    lower.includes('instrument not found') ||
    lower.includes('invalid instrument') ||
    lower.includes('unknown instrument') ||
    lower.includes('unknown symbol') ||
    lower.includes('404')
  ) {
    return lower.startsWith('instrument not found')
      ? rawMsg
      : `instrument not found (${rawMsg})`;
  }

  if (
    lower.includes('network blocked') ||
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('eai_again') ||
    lower.includes('fetch failed') ||
    lower.includes('socket hang up') ||
    lower.includes('403')
  ) {
    return lower.startsWith('network blocked')
      ? rawMsg
      : `network blocked (${rawMsg})`;
  }

  return rawMsg;
}

/**
 * Compute DIAGNOSTICS banner state for backfill visibility:
 * - When backfill is not completed, show a clear banner:
 *   "BACKFILL NOT RUN" | "BACKFILL RUNNING n%" | "BACKFILL FAILED: <error>"
 */
export function formatBackfillBannerState(
  backfill?: Partial<RedSniperBackfillStatus> | null
): BackfillBannerState {
  if (!backfill || (!backfill.running && backfill.status === 'idle')) {
    return {
      showBanner: true,
      state: 'NOT_RUN',
      bannerText: 'BACKFILL NOT RUN',
      providerError: null,
      progressPct: 0,
    };
  }

  if (backfill.running || backfill.status === 'running') {
    const pct = Math.max(0, Math.min(99, Math.round(backfill.progressPct || 0)));
    return {
      showBanner: true,
      state: 'RUNNING',
      bannerText: `BACKFILL RUNNING ${pct}%`,
      providerError: null,
      progressPct: pct,
    };
  }

  if (backfill.status === 'error') {
    const errText = classifyBackfillProviderError(
      backfill.error || 'Unknown provider error'
    );
    const pct = Math.max(0, Math.min(99, Math.round(backfill.progressPct || 0)));
    return {
      showBanner: true,
      state: 'FAILED',
      bannerText: `BACKFILL FAILED: ${errText}`,
      providerError: errText,
      progressPct: pct,
    };
  }

  if (backfill.status === 'completed') {
    return {
      showBanner: false,
      state: 'COMPLETED',
      bannerText: 'BACKFILL COMPLETED (100%)',
      providerError: null,
      progressPct: 100,
    };
  }

  return {
    showBanner: true,
    state: 'NOT_RUN',
    bannerText: 'BACKFILL NOT RUN',
    providerError: null,
    progressPct: 0,
  };
}

// ============================================================================
// RESUMABLE, THROTTLED BACKFILL JOB RUNNER & PROGRESS TELEMETRY
// ============================================================================

export function loadPersistedBackfillState(
  stateFilePath: string = DEFAULT_BACKFILL_STATE_FILE
): PersistedBackfillState | null {
  try {
    if (!fs.existsSync(stateFilePath)) return null;
    const raw = fs.readFileSync(stateFilePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.completedChunkKeys)) {
      return parsed as PersistedBackfillState;
    }
  } catch {}
  return null;
}

export function savePersistedBackfillState(
  state: PersistedBackfillState,
  stateFilePath: string = DEFAULT_BACKFILL_STATE_FILE
): void {
  try {
    const dir = path.dirname(stateFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    writeJsonAtomic(stateFilePath, state);
  } catch {}
}

function buildInitialBackfillStatus(
  stateFilePath: string = DEFAULT_BACKFILL_STATE_FILE
): RedSniperBackfillStatus {
  const saved = loadPersistedBackfillState(stateFilePath);
  if (saved) {
    const isCompleted = Boolean(saved.finishedAt && saved.d1Completed && !saved.lastError);
    const isError = Boolean(saved.lastError);
    const completedChunks =
      (saved.completedChunkKeys?.length || 0) + (saved.d1Completed ? 1 : 0);
    const totalChunks = Math.max(completedChunks, 53);
    const progressPct = isCompleted
      ? 100
      : Math.min(99, Math.round((completedChunks / Math.max(1, totalChunks)) * 100));

    return {
      running: false,
      status: isCompleted ? 'completed' : isError ? 'error' : 'idle',
      provider: saved.provider || process.env.HISTORY_PROVIDER || 'dukascopy',
      progressPct,
      completedChunks,
      totalChunks,
      calibratedOffsetPts: saved.calibratedOffsetPts ?? null,
      offsetWarning: saved.offsetWarning ?? null,
      m1HistBars: saved.m1HistBars ?? 0,
      d1HistBars: saved.d1HistBars ?? 0,
      startedAt: saved.lastUpdatedIso || null,
      finishedAt: saved.finishedAt || null,
      error: saved.lastError || null,
    };
  }

  return {
    running: false,
    status: 'idle',
    provider: process.env.HISTORY_PROVIDER || 'dukascopy',
    progressPct: 0,
    completedChunks: 0,
    totalChunks: 0,
    calibratedOffsetPts: null,
    offsetWarning: null,
    m1HistBars: 0,
    d1HistBars: 0,
    startedAt: null,
    finishedAt: null,
    error: null,
  };
}

let currentBackfillStatus: RedSniperBackfillStatus = buildInitialBackfillStatus();

let activeBackfillPromise: Promise<RedSniperBackfillStatus> | null = null;

export function getRedSniperBackfillStatus(): RedSniperBackfillStatus {
  return { ...currentBackfillStatus };
}

export function initBackfillStatusFromDisk(
  stateFilePath: string = DEFAULT_BACKFILL_STATE_FILE
): RedSniperBackfillStatus {
  currentBackfillStatus = buildInitialBackfillStatus(stateFilePath);
  return { ...currentBackfillStatus };
}

async function fetchChunkWithRetry(
  provider: HistoryProvider,
  tf: BackfillTimeframe,
  fromMs: number,
  toMs: number,
  maxRetries: number = 3,
  baseBackoffMs: number = 250
): Promise<RedSniperStoredCandle[]> {
  let attempt = 0;
  let lastErr: any = null;
  while (attempt <= maxRetries) {
    try {
      const candles = await provider.fetchCandles(tf, fromMs, toMs);
      // Persist downloaded chunk to disk cache so completed chunks are never re-downloaded after restart
      writeCachedChunkToDisk(provider.name, tf, fromMs, toMs, candles, true);
      return candles;
    } catch (err: any) {
      lastErr = err;
      attempt++;
      if (attempt > maxRetries) break;
      const delay = baseBackoffMs * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr || new Error(`Failed fetching ${tf} chunk ${fromMs}..${toMs}`);
}

export interface RunBackfillOptions {
  provider?: HistoryProvider;
  nowMs?: number;
  m1TradingDays?: number;
  d1CalendarDays?: number;
  throttleMs?: number;
  stateFilePath?: string;
  forceReset?: boolean;
  h4AlignmentOffsetHours?: number;
  dailyAlignmentUtcHour?: number;
  liveCandlesByTf?: Partial<Record<AllRedSniperTf, RedSniperStoredCandle[]>>;
  onPersistMerged?: (
    mergedByTf: Record<Exclude<AllRedSniperTf, '3m'>, RedSniperStoredCandle[]>,
    offsetPts: number
  ) => Promise<void> | void;
}

/**
 * Execute the resumable, throttled history backfill job:
 * - Downloads M1 for the last 260 trading days in 5-day weekday chunks (skipping weekends, retrying with backoff).
 * - Downloads native D1 for the last 1000+ trading days (~1480 calendar days).
 * - After a server restart, does NOT re-download completed chunks (resumes from saved state & disk chunk cache).
 * - Computes 24h median close offset (live M1 - provider M1) and applies it to all 'hist' candles.
 * - Merges with 'live' candles (live wins in overlap) and rebuilds 5m/15m/30m/1h/4h from merged M1.
 */
export async function runRedSniperHistoryBackfill(
  options: RunBackfillOptions = {}
): Promise<{
  status: RedSniperBackfillStatus;
  mergedByTf: Record<Exclude<AllRedSniperTf, '3m'>, RedSniperStoredCandle[]>;
  offsetPts: number;
  overlapCount: number;
}> {
  const provider = options.provider || createHistoryProvider();
  const nowMs = options.nowMs ?? Date.now();
  const m1TradingDays = options.m1TradingDays ?? 260;
  // 1000 trading days of D1 ~= 1480 calendar days so native D1 >= 1000 bars
  const d1CalendarDays = options.d1CalendarDays ?? 1480;
  const throttleMs = options.throttleMs ?? 25;
  const stateFilePath = options.stateFilePath ?? DEFAULT_BACKFILL_STATE_FILE;

  const chunks = buildFiveDayM1Chunks(nowMs, m1TradingDays);
  const totalSteps = chunks.length + 1; // +1 for native D1

  const prevSaved = options.forceReset
    ? null
    : loadPersistedBackfillState(stateFilePath);
  const completedKeysSet = new Set<string>(
    prevSaved?.completedChunkKeys || []
  );
  let d1AlreadyDone = Boolean(!options.forceReset && prevSaved?.d1Completed);

  currentBackfillStatus = {
    running: true,
    status: 'running',
    provider: provider.name,
    progressPct: Math.min(
      99,
      Math.round(
        ((completedKeysSet.size + (d1AlreadyDone ? 1 : 0)) /
          Math.max(1, totalSteps)) *
          100
      )
    ),
    completedChunks: completedKeysSet.size + (d1AlreadyDone ? 1 : 0),
    totalChunks: totalSteps,
    calibratedOffsetPts: prevSaved?.calibratedOffsetPts ?? null,
    offsetWarning: prevSaved?.offsetWarning ?? null,
    m1HistBars: prevSaved?.m1HistBars ?? 0,
    d1HistBars: prevSaved?.d1HistBars ?? 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };

  try {
    // 1. Native D1 for the last 1000 trading days (~1480 calendar days):
    //    If already marked completed in saved state and cached on disk, do NOT re-download from provider.
    const d1FromMs = nowMs - d1CalendarDays * 86400 * 1000;
    let rawD1Hist: RedSniperStoredCandle[] | null = null;
    if (d1AlreadyDone) {
      rawD1Hist = readCachedChunkFromDisk(
        provider.name,
        '1d',
        d1FromMs,
        nowMs,
        true
      );
    }
    if (!rawD1Hist) {
      rawD1Hist = await fetchChunkWithRetry(
        provider,
        '1d',
        d1FromMs,
        nowMs
      );
      d1AlreadyDone = true;
    }

    // 2. Download M1 in 5-day weekday chunks (resumable & throttled; skip completed chunks on disk)
    const allM1HistChunks: RedSniperStoredCandle[][] = [];
    let completedCount = 0;

    for (let idx = 0; idx < chunks.length; idx++) {
      const ch = chunks[idx];
      let chunkBars: RedSniperStoredCandle[] | null = null;
      const wasCompleted = !options.forceReset && completedKeysSet.has(ch.key);

      if (wasCompleted) {
        chunkBars = readCachedChunkFromDisk(
          provider.name,
          '1m',
          ch.fromMs,
          ch.toMs,
          true
        );
      }

      if (chunkBars === null) {
        chunkBars = await fetchChunkWithRetry(
          provider,
          '1m',
          ch.fromMs,
          ch.toMs
        );
      }

      if (chunkBars.length > 0) {
        allM1HistChunks.push(chunkBars);
      }

      completedKeysSet.add(ch.key);
      completedCount = idx + 1;
      const pct = Math.min(
        99,
        Math.round(((completedCount + 1) / Math.max(1, totalSteps)) * 100)
      );

      currentBackfillStatus = {
        ...currentBackfillStatus,
        progressPct: pct,
        completedChunks: completedCount + 1,
        totalChunks: totalSteps,
      };

      // Persist resumable checkpoint after each newly downloaded chunk or every 4 chunks
      if (!wasCompleted || idx % 4 === 0 || idx === chunks.length - 1) {
        savePersistedBackfillState(
          {
            provider: provider.name,
            completedChunkKeys: Array.from(completedKeysSet),
            d1Completed: true,
            calibratedOffsetPts: currentBackfillStatus.calibratedOffsetPts,
            offsetWarning: currentBackfillStatus.offsetWarning,
            m1HistBars: currentBackfillStatus.m1HistBars,
            d1HistBars: rawD1Hist.length,
            lastUpdatedIso: new Date().toISOString(),
            finishedAt: null,
            lastError: null,
          },
          stateFilePath
        );
      }

      if (!wasCompleted && throttleMs > 0 && idx < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, throttleMs));
      }
    }

    const rawM1Hist = mergeHistAndLiveCandles(
      allM1HistChunks.flat(),
      [],
      '1m',
      400000
    );

    // 3. Calibrate offset against live M1 over last 24h overlap
    const liveM1 = (options.liveCandlesByTf?.['1m'] || []).filter(
      (c) => c.source !== 'hist'
    );
    const { offsetPts, overlapCount, warning } = computeMedianCloseOffset(
      liveM1,
      rawM1Hist,
      86400
    );

    const calibratedM1Hist = applyOffsetToHistCandles(rawM1Hist, offsetPts);
    const calibratedD1Hist = applyOffsetToHistCandles(rawD1Hist, offsetPts);

    // 4. Merge M1 ('live' wins in overlap) and D1 ('live' wins in overlap)
    const mergedM1 = mergeHistAndLiveCandles(
      calibratedM1Hist,
      liveM1,
      '1m',
      400000
    );
    const liveD1 = (options.liveCandlesByTf?.['1d'] || []).filter(
      (c) => c.source !== 'hist'
    );
    const dailyOffsetHours = options.dailyAlignmentUtcHour ?? 0;
    const d1FromM1WithOffset =
      dailyOffsetHours !== 0
        ? rebuildSingleTimeframeFromM1(mergedM1, '1d', dailyOffsetHours, 10000)
        : [];
    const baseD1 =
      dailyOffsetHours !== 0 && d1FromM1WithOffset.length > 0
        ? mergeHistAndLiveCandles(calibratedD1Hist, d1FromM1WithOffset, '1d', 10000)
        : calibratedD1Hist;
    const mergedD1 = mergeHistAndLiveCandles(
      baseD1,
      liveD1,
      '1d',
      10000
    );

    // 5. Rebuild 5m / 15m / 30m / 1H / 4H from merged M1 and merge with live direct TFs (live wins)
    const rebuiltMap = rebuildTimeframesFromMergedM1(
      mergedM1,
      {
        '5m': (options.liveCandlesByTf?.['5m'] || []).filter(
          (c) => c.source !== 'hist'
        ),
        '15m': (options.liveCandlesByTf?.['15m'] || []).filter(
          (c) => c.source !== 'hist'
        ),
        '30m': (options.liveCandlesByTf?.['30m'] || []).filter(
          (c) => c.source !== 'hist'
        ),
        '1h': (options.liveCandlesByTf?.['1h'] || []).filter(
          (c) => c.source !== 'hist'
        ),
        '4h': (options.liveCandlesByTf?.['4h'] || []).filter(
          (c) => c.source !== 'hist'
        ),
      },
      10000,
      {
        h4AlignmentOffsetHours: options.h4AlignmentOffsetHours ?? 0,
        dailyAlignmentUtcHour: options.dailyAlignmentUtcHour ?? 0,
      }
    );

    const mergedByTf: Record<
      Exclude<AllRedSniperTf, '3m'>,
      RedSniperStoredCandle[]
    > = {
      '1m': mergedM1,
      '5m': rebuiltMap['5m'],
      '15m': rebuiltMap['15m'],
      '30m': rebuiltMap['30m'],
      '1h': rebuiltMap['1h'],
      '4h': rebuiltMap['4h'],
      '1d': mergedD1,
    };

    if (options.onPersistMerged) {
      await options.onPersistMerged(mergedByTf, offsetPts);
    }

    const finishedIso = new Date().toISOString();
    currentBackfillStatus = {
      running: false,
      status: 'completed',
      provider: provider.name,
      progressPct: 100,
      completedChunks: totalSteps,
      totalChunks: totalSteps,
      calibratedOffsetPts: offsetPts,
      offsetWarning: warning,
      m1HistBars: calibratedM1Hist.length,
      d1HistBars: calibratedD1Hist.length,
      startedAt: currentBackfillStatus.startedAt,
      finishedAt: finishedIso,
      error: null,
    };

    savePersistedBackfillState(
      {
        provider: provider.name,
        completedChunkKeys: Array.from(completedKeysSet),
        d1Completed: true,
        calibratedOffsetPts: offsetPts,
        offsetWarning: warning,
        m1HistBars: calibratedM1Hist.length,
        d1HistBars: calibratedD1Hist.length,
        lastUpdatedIso: finishedIso,
        finishedAt: finishedIso,
        lastError: null,
      },
      stateFilePath
    );

    return {
      status: { ...currentBackfillStatus },
      mergedByTf,
      offsetPts,
      overlapCount,
    };
  } catch (err: any) {
    const classifiedError = classifyBackfillProviderError(err);
    console.error('[RED SNIPER BACKFILL] Provider Error:', classifiedError);
    const failedIso = new Date().toISOString();
    currentBackfillStatus = {
      ...currentBackfillStatus,
      running: false,
      status: 'error',
      error: classifiedError,
      finishedAt: failedIso,
    };
    savePersistedBackfillState(
      {
        provider: provider.name,
        completedChunkKeys: Array.from(completedKeysSet),
        d1Completed: d1AlreadyDone,
        calibratedOffsetPts: currentBackfillStatus.calibratedOffsetPts,
        offsetWarning: currentBackfillStatus.offsetWarning,
        m1HistBars: currentBackfillStatus.m1HistBars,
        d1HistBars: currentBackfillStatus.d1HistBars,
        lastUpdatedIso: failedIso,
        finishedAt: null,
        lastError: classifiedError,
      },
      stateFilePath
    );
    throw err;
  }
}

export function triggerAsyncRedSniperBackfill(
  options: RunBackfillOptions = {}
): Promise<RedSniperBackfillStatus> {
  if (activeBackfillPromise && currentBackfillStatus.running) {
    return activeBackfillPromise;
  }
  activeBackfillPromise = runRedSniperHistoryBackfill(options)
    .then((res) => res.status)
    .finally(() => {
      activeBackfillPromise = null;
    });
  return activeBackfillPromise;
}
