import fs from 'fs';
import path from 'path';
import { DATA_DIR, writeJsonAtomic } from './deploymentSafety.ts';
import {
  Candle,
  getCandleStore,
  buildTimeframeFromM5,
  mergeCandleSeries,
  saveCandlesToDisk,
  backfillCandleGaps,
} from './candleEngine.ts';
import {
  getLastValidTick,
  evaluateMarketPriceStatus,
} from './marketPriceEngine.ts';
import {
  initBlackstonePlanEngine,
  evaluateLivePlanEngine,
  setPlanPinMode,
  BlackstonePlanPayload,
} from './blackstonePlanEngine.ts';
import { getBlackstoneTapeState, BlackstoneTapeState } from './blackstoneTapeEngine.ts';
import {
  getZoneRecordsSummary,
  getBacktestState,
  ZoneSummaryRow,
  BacktestStatePayload,
  BacktestPeriodMetrics,
} from './blackstoneRecordEngine.ts';

export type BlackstoneZoneId =
  | 'SARRAF_CORE'
  | 'CROWN_1'
  | 'CROWN_2'
  | 'CROWN_3'
  | 'ROOT_1'
  | 'ROOT_2'
  | string;

export type BlackstoneZoneName =
  | 'Sarraf Core'
  | 'Crown 1'
  | 'Crown 2'
  | 'Crown 3'
  | 'Root 1'
  | 'Root 2'
  | string;

export type BlackstoneZoneSide = 'sell side' | 'buy side' | 'centre';

export type BlackstoneZoneGrade = 'A' | 'B';

export type BlackstoneZoneStatusKind = 'FRESH' | 'TESTED' | 'USED';

export type BlackstoneDayStateLabel = 'QUIET' | 'NORMAL' | 'WILD' | 'PENDING';

/**
 * Centralized session configuration object (Dubai UTC+4).
 * Kept in one config object because London times shift with daylight saving.
 */
export const BLACKSTONE_SESSION_CONFIG = {
  timezone: 'Asia/Dubai',
  utcOffsetHours: 4,
  tradingDayOpenHourDubai: 2, // 02:00 Dubai
  dailyLockHourDubai: 4, // 04:00 Dubai
  sessions: {
    asia: {
      key: 'asia' as const,
      label: 'Asia',
      startHourDubai: 2, // 02:00 Dubai
      startMinuteDubai: 0,
      endHourDubai: 11, // 11:00 Dubai
      endMinuteDubai: 0,
      windowLabel: '02:00–11:00 Dubai',
    },
    london: {
      key: 'london' as const,
      label: 'London',
      startHourDubai: 11, // 11:00 Dubai
      startMinuteDubai: 0,
      endHourDubai: 17, // 17:00 Dubai
      endMinuteDubai: 0,
      windowLabel: '11:00–17:00 Dubai',
    },
  },
} as const;

export interface BlackstoneRetiredZoneRecord {
  key: string;
  id: BlackstoneZoneId;
  name: BlackstoneZoneName;
  side: 'sell side' | 'buy side';
  level: number;
  low: number;
  high: number;
  proximal: number;
  distal: number;
  grade: BlackstoneZoneGrade;
  score: number;
  touches: number;
  sources?: string[];
  formedAtIso: string;
  retiredAtIso: string;
  retiredAtDubai: string;
  closePrice: number;
  beyondDollars: number;
  reason: string;
}

export interface BlackstoneLockedZoneBase {
  key: string; // immutable reaction base key (side + baseStartIso)
  id: BlackstoneZoneId;
  name: BlackstoneZoneName;
  level: number;
  low: number;
  high: number;
  proximal: number;
  distal: number;
  side: 'sell side' | 'buy side';
  initialSide: 'sell side' | 'buy side';
  grade: BlackstoneZoneGrade;
  score: number;
  touches: number;
  departureDollars: number;
  baseWidthDollars: number;
  baseStartIso: string;
  formedAtIso: string;
  isNew: boolean;
  promoted: boolean;
  isSarrafCore?: boolean;
  tag?: 'Sarraf Core' | null;
  tags?: string[];
  sources?: string[];
}

export interface BlackstoneEvaluatedZone extends BlackstoneLockedZoneBase {
  displayRole: 'sell side' | 'buy side' | 'centre';
  status: 'FRESH' | 'TESTED';
  statusLabel: string; // 'FRESH' | 'TESTED 1'
  testsCount: number;
  distanceDollars: number | null;
  distanceFormatted: string;
}

export interface BlackstoneOpeningGap {
  prevClose: number | null;
  openPrice: number | null;
  gapDollars: number | null;
  gapPercent: number | null;
  direction: 'UP' | 'DOWN' | 'FLAT' | 'PENDING';
}

export interface BlackstoneOpeningRange {
  high: number | null;
  low: number | null;
  width: number | null;
  openPrice: number | null;
  closePrice: number | null;
  candlesCount: number;
}

export interface BlackstoneDayState {
  label: BlackstoneDayStateLabel;
  openingRangeWidth: number | null;
  todayHigh: number | null;
  todayLow: number | null;
  todayRangeSoFar: number | null;
  storedDaysCount: number;
  adr20: number | null;
  dayBudgetPercent: number | null;
  dayBudgetDisplay: string;
}

export interface BlackstoneCamarillaLevels {
  h3: number | null;
  l3: number | null;
  h4: number | null;
  l4: number | null;
}

export interface BlackstoneProfileLevels {
  poc: number | null;
  vah: number | null;
  val: number | null;
  totalCandles: number;
}

export interface BlackstoneLockedLevels {
  pdh: number | null;
  pdl: number | null;
  prevClose: number | null;
  todayOpen: number | null;
  camarilla: BlackstoneCamarillaLevels;
  profile: BlackstoneProfileLevels;
  adr4: number | null;
  adrDaysUsed: number;
}

export interface BlackstoneAdrLiveState {
  adr4: number | null;
  adrDaysUsed: number;
  todayHigh: number | null;
  todayLow: number | null;
  todayRangeSoFar: number | null;
  adrUsedPct: number | null;
  adrHighProjection: number | null;
  adrLowProjection: number | null;
}

export type BlackstoneRefCategory = 'DAY' | 'CAMARILLA' | 'PROFILE' | 'ADR';

export interface BlackstoneReferenceLevelItem {
  key: string;
  label: string;
  category: BlackstoneRefCategory;
  price: number;
  distanceDollars: number | null;
  distanceFormatted: string;
}

export interface BlackstoneDailyLockRecord {
  engineVersion: 4;
  sessionDate: string; // YYYY-MM-DD in Dubai session calendar
  openTimeIso: string;
  openTimeDubai: string;
  lockTimeIso: string;
  lockTimeDubai: string;
  lockedAtIso: string;
  lockReferencePrice: number | null;
  h1TradingDaysCount: number;
  historyStatus: 'READY' | 'Building history';
  openingGap: BlackstoneOpeningGap;
  openingRange: BlackstoneOpeningRange;
  lockedLevels?: BlackstoneLockedLevels;
  dayState: BlackstoneDayState;
  zones: BlackstoneLockedZoneBase[];
  grade: Record<string, BlackstoneZoneGrade>;
  score: Record<string, number>;
  touches: Record<string, number>;
  sources: Record<string, string[]>;
  retiredZones: BlackstoneRetiredZoneRecord[];
}

export interface BlackstoneStatePayload {
  sessionDate: string;
  isLocked: boolean;
  lockStateLabel:
    | 'LOCKED'
    | 'BUILDING HISTORY'
    | 'OPENING RANGE (02:00–04:00)'
    | 'WAITING FOR CANDLES';
  h1TradingDaysCount: number;
  historyStatus: 'READY' | 'Building history';
  isAdmin: boolean;
  openTimeIso: string;
  openTimeDubai: string;
  lockTimeIso: string;
  lockTimeDubai: string;
  lockedAtIso: string | null;
  nextLockIso: string;
  nextLockCountdownSeconds: number;
  nextLockCountdownFormatted: string;
  marketStatus: 'LIVE' | 'MARKET_CLOSED' | 'FEED_STALE';
  livePrice: number | null;
  sourceLabel: 'Ahmad server';
  dubaiClock: string;
  openingGap: BlackstoneOpeningGap;
  openingRange: BlackstoneOpeningRange;
  lockedLevels: BlackstoneLockedLevels;
  adrState: BlackstoneAdrLiveState;
  referenceLevels: BlackstoneReferenceLevelItem[];
  dayState: BlackstoneDayState;
  zones: BlackstoneEvaluatedZone[];
  visibleZones: BlackstoneEvaluatedZone[];
  aboveZone: BlackstoneEvaluatedZone | null;
  belowZone: BlackstoneEvaluatedZone | null;
  retiredZones: BlackstoneRetiredZoneRecord[];
  lockHistory: BlackstoneDailyLockRecord[];
  allLocksCount: number;
  plan: BlackstonePlanPayload;
  tape: BlackstoneTapeState;
  zoneRecords: ZoneSummaryRow[];
  backtest: BacktestStatePayload;
}

export { setPlanPinMode };
export type { BlackstonePlanPayload, BlackstoneTapeState, ZoneSummaryRow, BacktestStatePayload, BacktestPeriodMetrics };

const LOCKS_FILE_PERSISTENT = path.resolve(DATA_DIR, 'blackstone_locks.json');
const LOCKS_FILE_LOCAL = path.resolve(process.cwd(), 'data', 'blackstone_locks.json');

const DUBAI_OFFSET_MS = BLACKSTONE_SESSION_CONFIG.utcOffsetHours * 60 * 60 * 1000;
const MIN_SEPARATION_DOLLARS = 10.0;
const CONFLUENCE_RADIUS_DOLLARS = 3.0;
const OPPOSING_ROOM_DOLLARS = 17.0;

let lastH1HistoryRequestMs = 0;

function round2(n: number): number {
  return Number(n.toFixed(2));
}

export function formatDubaiTimeHHMM(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
  if (isNaN(ms)) return '--:-- Dubai';
  const dubaiDate = new Date(ms + DUBAI_OFFSET_MS);
  const hh = String(dubaiDate.getUTCHours()).padStart(2, '0');
  const mm = String(dubaiDate.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} Dubai`;
}

export function formatDubaiClockFull(nowMs: number = Date.now()): string {
  const dubaiDate = new Date(nowMs + DUBAI_OFFSET_MS);
  const hh = String(dubaiDate.getUTCHours()).padStart(2, '0');
  const mm = String(dubaiDate.getUTCMinutes()).padStart(2, '0');
  const ss = String(dubaiDate.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatCountdownHHMMSS(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(clamped / 3600)).padStart(2, '0');
  const mm = String(Math.floor((clamped % 3600) / 60)).padStart(2, '0');
  const ss = String(clamped % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Map a UTC timestamp to its Dubai trading day key (YYYY-MM-DD, where day starts at 02:00 Dubai / 22:00 UTC).
 */
function getDubaiTradingDayKey(timestampMs: number): string {
  const shifted = new Date(timestampMs + 2 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Compute the active Dubai trading session window:
 * Market opens at 02:00 Dubai time (22:00 UTC previous calendar day).
 * Lock occurs at 04:00 Dubai time (00:00 UTC on sessionDate).
 * Asia session: 02:00 to 11:00 Dubai.
 * London session: 11:00 to 17:00 Dubai.
 */
export function getDubaiSessionTiming(nowMs: number = Date.now()): {
  sessionDate: string;
  openTimeMs: number;
  openTimeIso: string;
  lockTimeMs: number;
  lockTimeIso: string;
  asiaStartMs: number;
  asiaEndMs: number;
  londonStartMs: number;
  londonEndMs: number;
  nextLockMs: number;
  nextLockIso: string;
  isPastLockTime: boolean;
} {
  const sessionClockMs = nowMs + 2 * 60 * 60 * 1000;
  const sessionDateObj = new Date(sessionClockMs);

  const sessionDow = sessionDateObj.getUTCDay();
  if (sessionDow === 6) {
    sessionDateObj.setUTCDate(sessionDateObj.getUTCDate() - 1);
  } else if (sessionDow === 0) {
    sessionDateObj.setUTCDate(sessionDateObj.getUTCDate() - 2);
  }

  const y = sessionDateObj.getUTCFullYear();
  const m = sessionDateObj.getUTCMonth();
  const d = sessionDateObj.getUTCDate();
  const sessionDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // 04:00 Dubai on YYYY-MM-DD is 00:00:00 UTC on YYYY-MM-DD
  const lockTimeMs = Date.UTC(y, m, d, 0, 0, 0, 0);
  // 02:00 Dubai on YYYY-MM-DD is 22:00:00 UTC on the previous day (lockTimeMs - 2 hours)
  const openTimeMs = lockTimeMs - 2 * 60 * 60 * 1000;

  const asiaCfg = BLACKSTONE_SESSION_CONFIG.sessions.asia;
  const londonCfg = BLACKSTONE_SESSION_CONFIG.sessions.london;

  const asiaStartOffsetMs =
    ((asiaCfg.startHourDubai - BLACKSTONE_SESSION_CONFIG.tradingDayOpenHourDubai) * 60 +
      asiaCfg.startMinuteDubai) *
    60 *
    1000;
  const asiaEndOffsetMs =
    ((asiaCfg.endHourDubai - BLACKSTONE_SESSION_CONFIG.tradingDayOpenHourDubai) * 60 +
      asiaCfg.endMinuteDubai) *
    60 *
    1000;

  const londonStartOffsetMs =
    ((londonCfg.startHourDubai - BLACKSTONE_SESSION_CONFIG.tradingDayOpenHourDubai) * 60 +
      londonCfg.startMinuteDubai) *
    60 *
    1000;
  const londonEndOffsetMs =
    ((londonCfg.endHourDubai - BLACKSTONE_SESSION_CONFIG.tradingDayOpenHourDubai) * 60 +
      londonCfg.endMinuteDubai) *
    60 *
    1000;

  const asiaStartMs = openTimeMs + asiaStartOffsetMs;
  const asiaEndMs = openTimeMs + asiaEndOffsetMs;
  const londonStartMs = openTimeMs + londonStartOffsetMs;
  const londonEndMs = openTimeMs + londonEndOffsetMs;

  const isPastLockTime = nowMs >= lockTimeMs;

  let nextLockDate = new Date(lockTimeMs);
  if (nowMs >= lockTimeMs) {
    nextLockDate = new Date(lockTimeMs + 24 * 60 * 60 * 1000);
    while (nextLockDate.getUTCDay() === 6 || nextLockDate.getUTCDay() === 0) {
      nextLockDate = new Date(nextLockDate.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  return {
    sessionDate,
    openTimeMs,
    openTimeIso: new Date(openTimeMs).toISOString(),
    lockTimeMs,
    lockTimeIso: new Date(lockTimeMs).toISOString(),
    asiaStartMs,
    asiaEndMs,
    londonStartMs,
    londonEndMs,
    nextLockMs: nextLockDate.getTime(),
    nextLockIso: nextLockDate.toISOString(),
    isPastLockTime,
  };
}

/**
 * Count distinct Dubai trading days stored in H1 candles.
 */
export function countStoredH1TradingDays(): number {
  const store = getCandleStore();
  const h1 = store.H1 || [];
  const days = new Set<string>();
  for (const bar of h1) {
    const t = new Date(bar.openTime).getTime();
    if (isNaN(t)) continue;
    const shifted = new Date(t + 2 * 60 * 60 * 1000);
    const dow = shifted.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    days.add(shifted.toISOString().slice(0, 10));
  }
  return days.size;
}

/**
 * Ask the existing candle feed for more H1 history when fewer than 30 trading days are stored.
 * Never invents data if the feed does not have 30 days.
 */
export async function requestMoreH1HistoryFromFeed(): Promise<number> {
  try {
    const res = await fetch('https://biquote.io/api/XAUUSD/ohlc?interval=1h&limit=1000', {
      headers: { Accept: 'application/json', 'User-Agent': 'SARRAF-Engine/2.0' },
    });
    if (res.ok) {
      const data = await res.json();
      const rawBars: any[] = data.bars || data.candles || [];
      if (Array.isArray(rawBars) && rawBars.length > 0) {
        const chronological = [...rawBars].reverse();
        const incoming: Candle[] = chronological.map((b: any, idx: number) => ({
          openTime: b.openTime || new Date(b.time || Date.now()).toISOString(),
          open: Number(b.open),
          high: Number(b.high),
          low: Number(b.low),
          close: Number(b.close),
          volume: Number(b.tickVolume || b.volume || 1),
          isClosed: idx < chronological.length - 1,
          usableForZones: true,
        }));
        const store = getCandleStore();
        store.H1 = mergeCandleSeries(store.H1 || [], incoming, 1200);
        saveCandlesToDisk();
      }
    }
  } catch {
    // Feed unavailable; fallback to backfillCandleGaps
    await backfillCandleGaps().catch(() => {});
  }
  return countStoredH1TradingDays();
}

/**
 * Load all saved v4 daily lock records from data/blackstone_locks.json.
 * Discards legacy v1/v2/v3 records from previous engines.
 */
export function loadBlackstoneLocksFromDisk(): BlackstoneDailyLockRecord[] {
  const candidates = [LOCKS_FILE_LOCAL, LOCKS_FILE_PERSISTENT];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (r: any) =>
              r &&
              r.engineVersion === 4 &&
              typeof r.sessionDate === 'string' &&
              Array.isArray(r.zones)
          );
        }
      }
    } catch (err: any) {
      console.warn(`[BLACKSTONE ENGINE] Failed reading ${filePath}:`, err.message);
    }
  }
  return [];
}

/**
 * Persist daily lock records to both data/blackstone_locks.json and /app/data/blackstone_locks.json
 * (one record per day, sorted chronologically).
 */
export function saveBlackstoneLocksToDisk(records: BlackstoneDailyLockRecord[]): void {
  const byDate = new Map<string, BlackstoneDailyLockRecord>();
  for (const rec of records) {
    if (rec && rec.sessionDate && rec.engineVersion === 4) {
      byDate.set(rec.sessionDate, rec);
    }
  }
  const deduplicated = Array.from(byDate.values()).sort((a, b) =>
    a.sessionDate.localeCompare(b.sessionDate)
  );

  try {
    writeJsonAtomic(LOCKS_FILE_PERSISTENT, deduplicated);
  } catch (err: any) {
    console.error('[BLACKSTONE ENGINE] Failed writing persistent locks file:', err.message);
  }

  try {
    if (LOCKS_FILE_LOCAL !== LOCKS_FILE_PERSISTENT) {
      writeJsonAtomic(LOCKS_FILE_LOCAL, deduplicated);
    }
  } catch (err: any) {
    console.error('[BLACKSTONE ENGINE] Failed writing local data/blackstone_locks.json:', err.message);
  }
}

interface ConfluenceReference {
  label: string;
  price: number;
}

/**
 * Compute prior day's Time-at-Price (TPO) profile:
 * Since spot gold has no centralized exchange volume, count how many candles traded at each $0.50 price bucket.
 * Returns POC (Point of Control) and 70% Value Area (VAH / VAL).
 */
function computeTimeAtPriceProfile(candles: Candle[]): BlackstoneProfileLevels {
  if (!candles || candles.length === 0) {
    return { poc: null, vah: null, val: null, totalCandles: 0 };
  }

  const bucketStep = 0.5;
  const countsMap = new Map<number, number>();
  let minPrice = Infinity;
  let maxPrice = -Infinity;

  for (const bar of candles) {
    if (!Number.isFinite(bar.low) || !Number.isFinite(bar.high)) continue;
    const low = Math.min(bar.low, bar.high);
    const high = Math.max(bar.low, bar.high);
    if (low < minPrice) minPrice = low;
    if (high > maxPrice) maxPrice = high;

    const startBucket = Math.floor(low / bucketStep) * bucketStep;
    const endBucket = Math.ceil(high / bucketStep) * bucketStep;
    const maxSteps = 400; // safety guard against corrupt spikes
    let steps = 0;
    for (let p = startBucket; p <= endBucket + 1e-6 && steps < maxSteps; p += bucketStep, steps++) {
      const key = round2(p);
      countsMap.set(key, (countsMap.get(key) || 0) + 1);
    }
  }

  if (countsMap.size === 0) {
    return { poc: null, vah: null, val: null, totalCandles: candles.length };
  }

  const buckets = Array.from(countsMap.entries())
    .map(([price, count]) => ({ price, count }))
    .sort((a, b) => a.price - b.price);

  const midPrice = (minPrice + maxPrice) / 2;
  let pocIdx = 0;
  let bestCount = -1;
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    if (
      b.count > bestCount ||
      (b.count === bestCount && Math.abs(b.price - midPrice) < Math.abs(buckets[pocIdx].price - midPrice))
    ) {
      bestCount = b.count;
      pocIdx = i;
    }
  }

  const totalTpoCount = buckets.reduce((acc, b) => acc + b.count, 0);
  const targetVaCount = totalTpoCount * 0.7;

  let lowIdx = pocIdx;
  let highIdx = pocIdx;
  let currentVaCount = buckets[pocIdx].count;

  while (currentVaCount < targetVaCount && (lowIdx > 0 || highIdx < buckets.length - 1)) {
    const nextDownCount = lowIdx > 0 ? buckets[lowIdx - 1].count : -1;
    const nextUpCount = highIdx < buckets.length - 1 ? buckets[highIdx + 1].count : -1;

    if (nextUpCount >= nextDownCount && highIdx < buckets.length - 1) {
      highIdx++;
      currentVaCount += buckets[highIdx].count;
    } else if (lowIdx > 0) {
      lowIdx--;
      currentVaCount += buckets[lowIdx].count;
    } else if (highIdx < buckets.length - 1) {
      highIdx++;
      currentVaCount += buckets[highIdx].count;
    } else {
      break;
    }
  }

  return {
    poc: round2(buckets[pocIdx].price),
    vah: round2(buckets[highIdx].price),
    val: round2(buckets[lowIdx].price),
    totalCandles: candles.length,
  };
}

/**
 * Compute 4-day Average Daily Range (ADR) from the last 4 completed trading days prior to openTimeMs.
 * Handles edge cases when fewer than 4 prior days exist in stored candles.
 */
function computePrior4DayAdr(
  openTimeMs: number,
  m5All: Candle[],
  h1All: Candle[],
  fallbackRange: number | null
): { adr4: number | null; adrDaysUsed: number } {
  const dayRangesMap = new Map<string, { high: number; low: number; count: number }>();
  const combinedPrior = [...h1All, ...m5All].filter((c) => {
    const t = new Date(c.openTime).getTime();
    return !isNaN(t) && t < openTimeMs;
  });

  for (const bar of combinedPrior) {
    const t = new Date(bar.openTime).getTime();
    const sessionDayObj = new Date(t + 2 * 60 * 60 * 1000);
    const dow = sessionDayObj.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const dayKey = sessionDayObj.toISOString().slice(0, 10);
    const existing = dayRangesMap.get(dayKey);
    if (!existing) {
      dayRangesMap.set(dayKey, { high: bar.high, low: bar.low, count: 1 });
    } else {
      if (bar.high > existing.high) existing.high = bar.high;
      if (bar.low < existing.low) existing.low = bar.low;
      existing.count += 1;
    }
  }

  const completedDays = Array.from(dayRangesMap.entries())
    .map(([date, d]) => ({
      date,
      range: round2(d.high - d.low),
      count: d.count,
    }))
    .filter((d) => d.range > 0.5)
    .sort((a, b) => a.date.localeCompare(b.date));

  const last4 = completedDays.slice(-4);
  if (last4.length > 0) {
    const avg = round2(last4.reduce((sum, d) => sum + d.range, 0) / last4.length);
    return { adr4: avg, adrDaysUsed: last4.length };
  }

  if (fallbackRange !== null && fallbackRange > 0) {
    return { adr4: round2(fallbackRange), adrDaysUsed: 1 };
  }

  return { adr4: null, adrDaysUsed: 0 };
}

/**
 * Compute confluence reference points and locked daily levels at 04:00 Dubai:
 * - Prior day high (PDH), prior day low (PDL), today's Open (02:00 Dubai)
 * - Camarilla H3, L3, H4, L4 from prior day H, L, C
 * - Prior day Time-at-Price Profile: POC, VAH, VAL (70% Value Area)
 * - 4-day ADR (average range of previous 4 completed trading days)
 */
function computeSessionReferences(
  timing: ReturnType<typeof getDubaiSessionTiming>,
  upToMs: number
): {
  prevClose: number | null;
  openingGap: BlackstoneOpeningGap;
  openingRange: BlackstoneOpeningRange;
  lockedLevels: BlackstoneLockedLevels;
  confluenceRefs: ConfluenceReference[];
} {
  const store = getCandleStore();
  const m5All = [...(store.M5 || [])].sort(
    (a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime()
  );
  const m15All = [...(store.M15 || [])].sort(
    (a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime()
  );
  const h1All = [...(store.H1 || [])].sort(
    (a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime()
  );

  // Prior trading day (02:00 to 02:00 Dubai)
  let prevDayBars: Candle[] = [];
  let prevDayProfileSourceBars: Candle[] = [];
  for (let daysBack = 1; daysBack <= 5; daysBack++) {
    const endMs = timing.openTimeMs - (daysBack - 1) * 24 * 60 * 60 * 1000;
    const startMs = endMs - 24 * 60 * 60 * 1000;
    const m5Bars = m5All.filter((c) => {
      const t = new Date(c.openTime).getTime();
      return t >= startMs && t < endMs;
    });
    const m15Bars = m15All.filter((c) => {
      const t = new Date(c.openTime).getTime();
      return t >= startMs && t < endMs;
    });
    const h1Bars = h1All.filter((c) => {
      const t = new Date(c.openTime).getTime();
      return t >= startMs && t < endMs;
    });
    const combined = m5Bars.length > 0 ? m5Bars : m15Bars.length > 0 ? m15Bars : h1Bars;
    if (combined.length > 0) {
      prevDayBars = [...h1Bars, ...m15Bars, ...m5Bars].sort(
        (a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime()
      );
      prevDayProfileSourceBars =
        m5Bars.length >= 6 ? m5Bars : m15Bars.length >= 4 ? m15Bars : h1Bars;
      break;
    }
  }

  const pdh =
    prevDayBars.length > 0 ? round2(Math.max(...prevDayBars.map((c) => c.high))) : null;
  const pdl =
    prevDayBars.length > 0 ? round2(Math.min(...prevDayBars.map((c) => c.low))) : null;
  const prevClose =
    prevDayBars.length > 0
      ? round2(prevDayBars[prevDayBars.length - 1].close)
      : null;

  // Camarilla levels from prior day H, L, C
  const camarilla: BlackstoneCamarillaLevels = {
    h3: null,
    l3: null,
    h4: null,
    l4: null,
  };
  if (pdh !== null && pdl !== null && prevClose !== null && pdh >= pdl) {
    const range = pdh - pdl;
    camarilla.h3 = round2(prevClose + (range * 1.1) / 4);
    camarilla.l3 = round2(prevClose - (range * 1.1) / 4);
    camarilla.h4 = round2(prevClose + (range * 1.1) / 2);
    camarilla.l4 = round2(prevClose - (range * 1.1) / 2);
  }

  // Time-at-Price Profile (POC, VAH, VAL) for prior day
  const profile = computeTimeAtPriceProfile(prevDayProfileSourceBars);

  // Opening range (02:00 to 04:00 Dubai) + fallback if early in the session with few candles
  const openingWindowCandles = m5All.filter((c) => {
    const t = new Date(c.openTime).getTime();
    return t >= timing.openTimeMs && t < timing.lockTimeMs;
  });

  const todayAnyCandles = [...m5All, ...m15All, ...h1All]
    .filter((c) => {
      const t = new Date(c.openTime).getTime();
      return t >= timing.openTimeMs && t <= upToMs;
    })
    .sort((a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime());

  const sourceOrCandles =
    openingWindowCandles.length > 0
      ? openingWindowCandles
      : h1All.filter((c) => {
          const t = new Date(c.openTime).getTime();
          return t >= timing.openTimeMs && t < timing.lockTimeMs;
        });

  let openingGap: BlackstoneOpeningGap = {
    prevClose,
    openPrice: null,
    gapDollars: null,
    gapPercent: null,
    direction: 'PENDING',
  };

  let openingRange: BlackstoneOpeningRange = {
    high: null,
    low: null,
    width: null,
    openPrice: null,
    closePrice: null,
    candlesCount: 0,
  };

  const sessionCandlesForOpen =
    sourceOrCandles.length > 0 ? sourceOrCandles : todayAnyCandles;

  if (sessionCandlesForOpen.length > 0) {
    const openPrice = round2(sessionCandlesForOpen[0].open);
    const orList = sourceOrCandles.length > 0 ? sourceOrCandles : sessionCandlesForOpen;
    const closePrice = round2(orList[orList.length - 1].close);
    const rangeHigh = round2(Math.max(...orList.map((c) => c.high)));
    const rangeLow = round2(Math.min(...orList.map((c) => c.low)));
    const rangeWidth = round2(rangeHigh - rangeLow);

    const gapDollars = prevClose !== null ? round2(openPrice - prevClose) : null;
    const gapPercent =
      prevClose !== null && prevClose > 0 && gapDollars !== null
        ? Number(((gapDollars / prevClose) * 100).toFixed(3))
        : null;
    const direction: 'UP' | 'DOWN' | 'FLAT' | 'PENDING' =
      gapDollars === null
        ? 'PENDING'
        : Math.abs(gapDollars) < 0.05
          ? 'FLAT'
          : gapDollars > 0
            ? 'UP'
            : 'DOWN';

    openingGap = {
      prevClose,
      openPrice,
      gapDollars,
      gapPercent,
      direction,
    };

    openingRange = {
      high: rangeHigh,
      low: rangeLow,
      width: rangeWidth,
      openPrice,
      closePrice,
      candlesCount: sourceOrCandles.length,
    };
  }

  const todayOpen = openingRange.openPrice ?? prevClose;
  const fallbackPrevRange = pdh !== null && pdl !== null && pdh > pdl ? pdh - pdl : null;
  const { adr4, adrDaysUsed } = computePrior4DayAdr(
    timing.openTimeMs,
    m5All,
    h1All,
    fallbackPrevRange
  );

  const lockedLevels: BlackstoneLockedLevels = {
    pdh,
    pdl,
    prevClose,
    todayOpen,
    camarilla,
    profile,
    adr4,
    adrDaysUsed,
  };

  const confluenceRefs: ConfluenceReference[] = [];
  if (pdh !== null) confluenceRefs.push({ label: 'PDH', price: pdh });
  if (pdl !== null) confluenceRefs.push({ label: 'PDL', price: pdl });
  if (todayOpen !== null) {
    confluenceRefs.push({ label: 'Today Open', price: todayOpen });
  }
  if (camarilla.h3 !== null) confluenceRefs.push({ label: 'Cam H3', price: camarilla.h3 });
  if (camarilla.l3 !== null) confluenceRefs.push({ label: 'Cam L3', price: camarilla.l3 });
  if (camarilla.h4 !== null) confluenceRefs.push({ label: 'Cam H4', price: camarilla.h4 });
  if (camarilla.l4 !== null) confluenceRefs.push({ label: 'Cam L4', price: camarilla.l4 });
  if (profile.poc !== null) confluenceRefs.push({ label: 'POC', price: profile.poc });
  if (profile.vah !== null) confluenceRefs.push({ label: 'VAH', price: profile.vah });
  if (profile.val !== null) confluenceRefs.push({ label: 'VAL', price: profile.val });
  if (openingRange.high !== null) {
    confluenceRefs.push({ label: 'OR High', price: openingRange.high });
  }
  if (openingRange.low !== null) {
    confluenceRefs.push({ label: 'OR Low', price: openingRange.low });
  }

  // Asia High/Low if Asia session has completed by upToMs
  if (upToMs >= timing.asiaEndMs) {
    const asiaBars = m5All.filter((c) => {
      const t = new Date(c.openTime).getTime();
      return t >= timing.asiaStartMs && t < timing.asiaEndMs;
    });
    if (asiaBars.length > 0) {
      confluenceRefs.push({
        label: 'Asia High',
        price: round2(Math.max(...asiaBars.map((c) => c.high))),
      });
      confluenceRefs.push({
        label: 'Asia Low',
        price: round2(Math.min(...asiaBars.map((c) => c.low))),
      });
    }
  }

  // London High/Low if London session has completed by upToMs
  if (upToMs >= timing.londonEndMs) {
    const londonBars = m5All.filter((c) => {
      const t = new Date(c.openTime).getTime();
      return t >= timing.londonStartMs && t < timing.londonEndMs;
    });
    if (londonBars.length > 0) {
      confluenceRefs.push({
        label: 'London High',
        price: round2(Math.max(...londonBars.map((c) => c.high))),
      });
      confluenceRefs.push({
        label: 'London Low',
        price: round2(Math.min(...londonBars.map((c) => c.low))),
      });
    }
  }

  return { prevClose, openingGap, openingRange, lockedLevels, confluenceRefs };
}

/**
 * Helper to compute confluence sources & bonus score:
 * +4 per locked reference level or $50 round number within $3 of the zone (maximum +12).
 */
function computeZoneConfluenceBonus(
  low: number,
  high: number,
  confluenceRefs: ConfluenceReference[]
): { matchedSources: string[]; confScore: number } {
  const matchedSources: string[] = [];
  const seenLabels = new Set<string>();

  for (const ref of confluenceRefs) {
    if (
      ref.price >= low - CONFLUENCE_RADIUS_DOLLARS &&
      ref.price <= high + CONFLUENCE_RADIUS_DOLLARS
    ) {
      if (!seenLabels.has(ref.label)) {
        seenLabels.add(ref.label);
        matchedSources.push(`${ref.label} (${ref.price.toFixed(2)})`);
      }
    }
  }

  // Check $50 round numbers within $3 of [low, high]
  const minRound = Math.floor((low - CONFLUENCE_RADIUS_DOLLARS) / 50) * 50;
  const maxRound = Math.ceil((high + CONFLUENCE_RADIUS_DOLLARS) / 50) * 50;
  for (let r = minRound; r <= maxRound; r += 50) {
    if (r > 0 && r >= low - CONFLUENCE_RADIUS_DOLLARS && r <= high + CONFLUENCE_RADIUS_DOLLARS) {
      const label = `Round $50 (${r.toFixed(0)})`;
      if (!seenLabels.has(label)) {
        seenLabels.add(label);
        matchedSources.push(label);
      }
    }
  }

  const confScore = Math.min(12, matchedSources.length * 4);
  return { matchedSources, confScore };
}

/**
 * Compute live ADR projection (up/down) and ADR used % against the locked 4-day ADR.
 */
function computeLiveAdrState(
  lockedLevels: BlackstoneLockedLevels,
  dayState: BlackstoneDayState,
  livePrice: number | null
): BlackstoneAdrLiveState {
  const adr4 = lockedLevels.adr4 ?? dayState.adr20 ?? null;
  const anchorPrice = livePrice ?? lockedLevels.todayOpen ?? lockedLevels.prevClose ?? null;
  const todayHigh = dayState.todayHigh ?? anchorPrice;
  const todayLow = dayState.todayLow ?? anchorPrice;
  const todayRangeSoFar =
    dayState.todayRangeSoFar !== null
      ? dayState.todayRangeSoFar
      : todayHigh !== null && todayLow !== null
        ? round2(Math.max(0, todayHigh - todayLow))
        : 0;

  const adrUsedPct =
    adr4 !== null && adr4 > 0 && todayRangeSoFar !== null
      ? round2((todayRangeSoFar / adr4) * 100)
      : null;

  // Live ADR High/Low projections from session low/high (or todayOpen when session range is minimal)
  const baseForHigh = todayLow ?? lockedLevels.todayOpen ?? anchorPrice;
  const baseForLow = todayHigh ?? lockedLevels.todayOpen ?? anchorPrice;

  const adrHighProjection =
    adr4 !== null && baseForHigh !== null ? round2(baseForHigh + adr4) : null;
  const adrLowProjection =
    adr4 !== null && baseForLow !== null ? round2(baseForLow - adr4) : null;

  return {
    adr4,
    adrDaysUsed: lockedLevels.adrDaysUsed || 0,
    todayHigh,
    todayLow,
    todayRangeSoFar,
    adrUsedPct,
    adrHighProjection,
    adrLowProjection,
  };
}

/**
 * Build flat list of Reference Levels for UI chips (Day, Camarilla, Profile, ADR).
 */
function buildReferenceLevelsList(
  lockedLevels: BlackstoneLockedLevels,
  adrState: BlackstoneAdrLiveState,
  livePrice: number | null
): BlackstoneReferenceLevelItem[] {
  const rawItems: Array<{ key: string; label: string; category: BlackstoneRefCategory; price: number | null }> = [
    { key: 'PDH', label: 'PDH', category: 'DAY', price: lockedLevels.pdh },
    { key: 'PDL', label: 'PDL', category: 'DAY', price: lockedLevels.pdl },
    { key: 'OPEN', label: 'Open', category: 'DAY', price: lockedLevels.todayOpen },
    { key: 'H4', label: 'H4', category: 'CAMARILLA', price: lockedLevels.camarilla.h4 },
    { key: 'H3', label: 'H3', category: 'CAMARILLA', price: lockedLevels.camarilla.h3 },
    { key: 'L3', label: 'L3', category: 'CAMARILLA', price: lockedLevels.camarilla.l3 },
    { key: 'L4', label: 'L4', category: 'CAMARILLA', price: lockedLevels.camarilla.l4 },
    { key: 'VAH', label: 'VAH', category: 'PROFILE', price: lockedLevels.profile.vah },
    { key: 'POC', label: 'POC', category: 'PROFILE', price: lockedLevels.profile.poc },
    { key: 'VAL', label: 'VAL', category: 'PROFILE', price: lockedLevels.profile.val },
    { key: 'ADR_HIGH', label: 'ADR High', category: 'ADR', price: adrState.adrHighProjection },
    { key: 'ADR_LOW', label: 'ADR Low', category: 'ADR', price: adrState.adrLowProjection },
  ];

  const list: BlackstoneReferenceLevelItem[] = [];
  for (const item of rawItems) {
    if (item.price === null || !Number.isFinite(item.price)) continue;
    const dist = livePrice !== null && livePrice > 0 ? round2(item.price - livePrice) : null;
    const distanceFormatted =
      dist === null
        ? '—'
        : dist > 0
          ? `+$${dist.toFixed(2)}`
          : dist < 0
            ? `-$${Math.abs(dist).toFixed(2)}`
            : '$0.00';
    list.push({
      key: item.key,
      label: item.label,
      category: item.category,
      price: round2(item.price),
      distanceDollars: dist,
      distanceFormatted,
    });
  }
  return list;
}

/**
 * Day state (information only):
 * - Opening range size and today's range so far against the average daily range of the last 20 stored days ("day budget" in percent).
 * - Label QUIET if opening range < $5, WILD if > $30, otherwise NORMAL.
 * - Use the 20-day average ONLY when 20 stored days exist; otherwise show "Building history" and never fill with fake numbers.
 */
export function computeBlackstoneDayState(
  openTimeMs: number,
  openingRangeWidth: number | null
): BlackstoneDayState {
  const store = getCandleStore();
  const m5All = store.M5 || [];

  const todayEndMs = openTimeMs + 24 * 60 * 60 * 1000;
  const todayCandles = m5All.filter((c) => {
    const t = new Date(c.openTime).getTime();
    return t >= openTimeMs && t < todayEndMs;
  });

  let todayHigh: number | null = null;
  let todayLow: number | null = null;
  let todayRangeSoFar: number | null = null;

  if (todayCandles.length > 0) {
    todayHigh = round2(Math.max(...todayCandles.map((c) => c.high)));
    todayLow = round2(Math.min(...todayCandles.map((c) => c.low)));
    todayRangeSoFar = round2(todayHigh - todayLow);
  }

  let label: BlackstoneDayStateLabel = 'PENDING';
  if (openingRangeWidth !== null) {
    if (openingRangeWidth < 5) {
      label = 'QUIET';
    } else if (openingRangeWidth > 30) {
      label = 'WILD';
    } else {
      label = 'NORMAL';
    }
  }

  // Group stored H1/M5 candles prior to today's open into Dubai trading days
  const dayRangesMap = new Map<string, { high: number; low: number }>();
  const priorCandles = [...(store.M5 || []), ...(store.H1 || [])].filter((c) => {
    const t = new Date(c.openTime).getTime();
    return !isNaN(t) && t < openTimeMs;
  });

  for (const bar of priorCandles) {
    const t = new Date(bar.openTime).getTime();
    const sessionDayObj = new Date(t + 2 * 60 * 60 * 1000);
    const dow = sessionDayObj.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const dayKey = sessionDayObj.toISOString().slice(0, 10);
    const existing = dayRangesMap.get(dayKey);
    if (!existing) {
      dayRangesMap.set(dayKey, { high: bar.high, low: bar.low });
    } else {
      if (bar.high > existing.high) existing.high = bar.high;
      if (bar.low < existing.low) existing.low = bar.low;
    }
  }

  const completedDays = Array.from(dayRangesMap.entries())
    .map(([date, hl]) => ({
      date,
      range: round2(hl.high - hl.low),
    }))
    .filter((d) => d.range > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const storedDaysCount = completedDays.length;

  if (storedDaysCount >= 20 && todayRangeSoFar !== null) {
    const last20 = completedDays.slice(-20);
    const adr20 = round2(last20.reduce((sum, d) => sum + d.range, 0) / 20);
    const dayBudgetPercent = adr20 > 0 ? round2((todayRangeSoFar / adr20) * 100) : null;
    return {
      label,
      openingRangeWidth,
      todayHigh,
      todayLow,
      todayRangeSoFar,
      storedDaysCount,
      adr20,
      dayBudgetPercent,
      dayBudgetDisplay:
        dayBudgetPercent !== null ? `${dayBudgetPercent.toFixed(1)}%` : 'Building history',
    };
  }

  return {
    label,
    openingRangeWidth,
    todayHigh,
    todayLow,
    todayRangeSoFar,
    storedDaysCount,
    adr20: null,
    dayBudgetPercent: null,
    dayBudgetDisplay: 'Building history',
  };
}

interface RawReactionCandidate {
  key: string;
  side: 'sell side' | 'buy side';
  baseStartIso: string;
  formedAtIso: string;
  formedAtMs: number;
  confirmIdx: number;
  proximal: number;
  distal: number;
  low: number;
  high: number;
  level: number;
  baseWidthDollars: number;
  departureDollars: number;
  touches: number;
  score: number;
  grade: BlackstoneZoneGrade;
  sources: string[];
  isNew: boolean;
}

/**
 * Scan stored H1 candles from the last 10 trading days up to `upToMs` for reaction zones:
 * 1. Base: 1 to 3 consecutive H1 candles whose combined range is $8 or less.
 * 2. Departure: within the next 3 H1 candles price closes at least $15 away from the base on one side,
 *    with at least 2 of those 3 candles in that direction.
 *    Base above departure going down = sell side zone.
 *    Base below departure going up = buy side zone.
 * 3. Zone edges: proximal edge = near edge of the base bodies, distal edge = far extreme of the base.
 *    Keep the zone width between $3 and $8.
 * 4. Only look at the last 10 trading days.
 * 5. Freshness: count touches after the zone formed (a touch is price entering the zone).
 *    A zone with 2 or more touches is dropped.
 *    A zone is USED and retired when a closed M5 candle ends more than $1 beyond its distal edge.
 * 6. Score (0 to 100) and Grade A (>= 70) / Grade B (50 to 69). Below 50 is never shown.
 */
function scanAndScoreReactionZones(
  upToMs: number,
  openTimeMs: number,
  lockTimeMs: number,
  confluenceRefs: ConfluenceReference[],
  referencePrice?: number
): {
  eligibleZones: RawReactionCandidate[];
  retiredToday: BlackstoneRetiredZoneRecord[];
} {
  const store = getCandleStore();
  const h1All = [...(store.H1 || [])]
    .filter((b) => {
      const closeTimeMs = new Date(b.openTime).getTime() + 60 * 60 * 1000;
      return !isNaN(closeTimeMs) && closeTimeMs <= upToMs;
    })
    .sort((a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime());

  if (h1All.length < 4) {
    return { eligibleZones: [], retiredToday: [] };
  }

  // Filter to only the last 10 trading days
  const allTradingDays = Array.from(
    new Set(h1All.map((b) => getDubaiTradingDayKey(new Date(b.openTime).getTime())))
  ).sort();
  const last10Set = new Set(allTradingDays.slice(-10));
  const lookbackH1 = h1All.filter((b) =>
    last10Set.has(getDubaiTradingDayKey(new Date(b.openTime).getTime()))
  );

  const m5ClosedAll = (store.M5 || [])
    .filter((c, idx, arr) => {
      const t = new Date(c.openTime).getTime();
      return c.isClosed && idx < arr.length - 1 && !isNaN(t) && t <= upToMs;
    })
    .sort((a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime());

  interface UnscoredCandidate {
    key: string;
    side: 'sell side' | 'buy side';
    baseStartIso: string;
    formedAtIso: string;
    formedAtMs: number;
    confirmIdx: number;
    proximal: number;
    distal: number;
    low: number;
    high: number;
    level: number;
    baseWidthDollars: number;
    departureDollars: number;
  }

  const rawList: UnscoredCandidate[] = [];

  for (let i = 0; i < lookbackH1.length - 1; i++) {
    for (let len = 1; len <= 3; len++) {
      if (i + len >= lookbackH1.length) continue;
      const base = lookbackH1.slice(i, i + len);
      const baseHigh = Math.max(...base.map((b) => b.high));
      const baseLow = Math.min(...base.map((b) => b.low));
      const bodyHigh = Math.max(...base.map((b) => Math.max(b.open, b.close)));
      const bodyLow = Math.min(...base.map((b) => Math.min(b.open, b.close)));

      const next3 = lookbackH1.slice(i + len, Math.min(lookbackH1.length, i + len + 3));
      if (next3.length === 0) continue;

      // 1. Sell side candidate (base above departure going down)
      // Keep the $3 to $8 height clamp from distal baseHigh
      const sellWickSpan = baseHigh - bodyHigh;
      const sellRawSpan = sellWickSpan >= 2.0 ? sellWickSpan : baseHigh - bodyLow;
      if (sellRawSpan > 0) {
        const sellDistal = round2(baseHigh);
        const clampedWidth = round2(Math.max(3.0, Math.min(8.0, sellRawSpan)));
        const sellProximal = round2(sellDistal - clampedWidth);
        const minCloseNext3 = Math.min(...next3.map((b) => b.close));
        const sellDeparture = round2(sellProximal - minCloseNext3);
        const sellBelowCount = next3.filter(
          (b) => b.close < b.open || b.close <= sellProximal - 10.0
        ).length;

        if (sellDeparture >= 15.0 && sellBelowCount >= 2) {
          let confirmIdx = i + len;
          for (let k = 0; k < next3.length; k++) {
            if (sellProximal - next3[k].close >= 15.0) {
              confirmIdx = i + len + k;
              break;
            }
          }
          const formedAtIso = lookbackH1[confirmIdx].openTime;
          const formedAtMs = new Date(formedAtIso).getTime() + 60 * 60 * 1000;
          rawList.push({
            key: `SELL_${base[0].openTime}`,
            side: 'sell side',
            baseStartIso: base[0].openTime,
            formedAtIso,
            formedAtMs,
            confirmIdx,
            proximal: sellProximal,
            distal: sellDistal,
            low: sellProximal,
            high: sellDistal,
            level: round2((sellProximal + sellDistal) / 2),
            baseWidthDollars: clampedWidth,
            departureDollars: sellDeparture,
          });
        }
      }

      // 2. Buy side candidate (base below departure going up)
      // Keep the $3 to $8 height clamp from distal baseLow
      const buyWickSpan = bodyLow - baseLow;
      const buyRawSpan = buyWickSpan >= 2.0 ? buyWickSpan : bodyHigh - baseLow;
      if (buyRawSpan > 0) {
        const buyDistal = round2(baseLow);
        const clampedWidth = round2(Math.max(3.0, Math.min(8.0, buyRawSpan)));
        const buyProximal = round2(buyDistal + clampedWidth);
        const maxCloseNext3 = Math.max(...next3.map((b) => b.close));
        const buyDeparture = round2(maxCloseNext3 - buyProximal);
        const buyAboveCount = next3.filter(
          (b) => b.close > b.open || b.close >= buyProximal + 10.0
        ).length;

        if (buyDeparture >= 15.0 && buyAboveCount >= 2) {
          let confirmIdx = i + len;
          for (let k = 0; k < next3.length; k++) {
            if (next3[k].close - buyProximal >= 15.0) {
              confirmIdx = i + len + k;
              break;
            }
          }
          const formedAtIso = lookbackH1[confirmIdx].openTime;
          const formedAtMs = new Date(formedAtIso).getTime() + 60 * 60 * 1000;
          rawList.push({
            key: `BUY_${base[0].openTime}`,
            side: 'buy side',
            baseStartIso: base[0].openTime,
            formedAtIso,
            formedAtMs,
            confirmIdx,
            proximal: buyProximal,
            distal: buyDistal,
            low: buyDistal,
            high: buyProximal,
            level: round2((buyProximal + buyDistal) / 2),
            baseWidthDollars: clampedWidth,
            departureDollars: buyDeparture,
          });
        }
      }
    }
  }

  // Deduplicate identical baseStartIso keys (keep tightest baseWidth / strongest departure)
  const uniqueByKey = new Map<string, UnscoredCandidate>();
  for (const item of rawList) {
    const existing = uniqueByKey.get(item.key);
    if (
      !existing ||
      item.departureDollars - item.baseWidthDollars >
        existing.departureDollars - existing.baseWidthDollars
    ) {
      uniqueByKey.set(item.key, item);
    }
  }

  const surviving: Array<UnscoredCandidate & { touches: number }> = [];
  const retiredTodayMap = new Map<string, BlackstoneRetiredZoneRecord>();

  for (const z of uniqueByKey.values()) {
    let touches = 0;
    let inZone = false;
    let brokenBeforeToday = false;
    let brokenInH1Today: { iso: string; closePrice: number } | null = null;

    for (let k = z.confirmIdx + 1; k < lookbackH1.length; k++) {
      const bar = lookbackH1[k];
      const barMs = new Date(bar.openTime).getTime();
      const brokeDistal =
        z.side === 'sell side'
          ? bar.close > z.distal + 1.0
          : bar.close < z.distal - 1.0;

      if (brokeDistal) {
        if (barMs < openTimeMs) {
          brokenBeforeToday = true;
          break;
        } else if (!brokenInH1Today) {
          brokenInH1Today = { iso: bar.openTime, closePrice: round2(bar.close) };
        }
      }

      const overlaps = bar.low <= z.high && bar.high >= z.low;
      if (overlaps && !inZone) {
        touches += 1;
        inZone = true;
      } else if (!overlaps) {
        inZone = false;
      }
    }

    if (brokenBeforeToday) {
      continue;
    }

    // Check closed M5 candles today for retirement (> $1 beyond distal edge)
    const evalStartMs = Math.max(openTimeMs, z.formedAtMs);
    const m5AfterFormation = m5ClosedAll.filter(
      (b) => new Date(b.openTime).getTime() >= evalStartMs
    );

    let m5BreakBar: Candle | null = null;
    for (const bar of m5AfterFormation) {
      const isRetired =
        z.side === 'sell side'
          ? bar.close > z.distal + 1.0
          : bar.close < z.distal - 1.0;
      if (isRetired) {
        m5BreakBar = bar;
        break;
      }
    }

    if (m5BreakBar || brokenInH1Today) {
      const retiredIso = m5BreakBar ? m5BreakBar.openTime : brokenInH1Today!.iso;
      const closePrice = m5BreakBar
        ? round2(m5BreakBar.close)
        : brokenInH1Today!.closePrice;
      const beyondDollars =
        z.side === 'sell side'
          ? round2(closePrice - z.distal)
          : round2(z.distal - closePrice);

      // Compute score & grade at time of retirement
      const depNorm = Math.max(0, Math.min(1, (z.departureDollars - 15) / 15));
      const depScore = Math.round(10 + depNorm * 25);
      const tightScore = Math.round(
        Math.max(3, Math.min(15, ((8 - z.baseWidthDollars) / 5) * 12 + 3))
      );
      const freshScore = touches === 0 ? 25 : 10;
      const { matchedSources, confScore } = computeZoneConfluenceBonus(
        z.low,
        z.high,
        confluenceRefs
      );
      const totalScore = Math.min(100, depScore + tightScore + freshScore + confScore + 10);

      if (totalScore >= 50 && touches <= 2) {
        const grade: BlackstoneZoneGrade = totalScore >= 70 ? 'A' : 'B';
        retiredTodayMap.set(z.key, {
          key: z.key,
          id: z.key,
          name: z.side === 'sell side' ? 'Sell Reaction Zone' : 'Buy Reaction Zone',
          side: z.side,
          level: z.level,
          low: z.low,
          high: z.high,
          proximal: z.proximal,
          distal: z.distal,
          grade,
          score: totalScore,
          touches: Math.min(touches, 1),
          sources: matchedSources,
          formedAtIso: z.formedAtIso,
          retiredAtIso: retiredIso,
          retiredAtDubai: formatDubaiTimeHHMM(retiredIso),
          closePrice,
          beyondDollars,
          reason:
            z.side === 'sell side'
              ? `Closed M5 at ${closePrice.toFixed(2)} (+$${beyondDollars.toFixed(2)} beyond sell distal ${z.distal.toFixed(2)})`
              : `Closed M5 at ${closePrice.toFixed(2)} (-$${beyondDollars.toFixed(2)} beyond buy distal ${z.distal.toFixed(2)})`,
        });
      }
      continue;
    }

    // Freshness rule: a zone with 2 or more touches is dropped
    if (touches >= 2) {
      continue;
    }

    surviving.push({ ...z, touches });
  }

  // Score surviving zones (0 to 100)
  const scored: RawReactionCandidate[] = [];
  for (const z of surviving) {
    // 1. Departure strength up to 35 ($15 gives 10, $30 or more gives 35)
    const depNorm = Math.max(0, Math.min(1, (z.departureDollars - 15) / 15));
    const depScore = Math.round(10 + depNorm * 25);

    // 2. Base tightness up to 15
    const tightScore = Math.round(
      Math.max(3, Math.min(15, ((8 - z.baseWidthDollars) / 5) * 12 + 3))
    );

    // 3. Freshness: 25 if untouched (0 touches) or 10 with 1 touch
    const freshScore = z.touches === 0 ? 25 : 10;

    // 4. Confluence up to 12 (+4 for each locked level or $50 round number within $3)
    const { matchedSources, confScore } = computeZoneConfluenceBonus(
      z.low,
      z.high,
      confluenceRefs
    );

    // 5. Room to the next opposing zone of $17 or more: 10
    const opposing = surviving.filter((o) => o.side !== z.side);
    let nearestOpposingRoom = Infinity;
    for (const o of opposing) {
      if (z.side === 'sell side' && o.proximal < z.proximal) {
        nearestOpposingRoom = Math.min(nearestOpposingRoom, z.proximal - o.proximal);
      } else if (z.side === 'buy side' && o.proximal > z.proximal) {
        nearestOpposingRoom = Math.min(nearestOpposingRoom, o.proximal - z.proximal);
      }
    }
    const roomScore = nearestOpposingRoom >= OPPOSING_ROOM_DOLLARS ? 10 : 0;

    const totalScore = Math.min(
      100,
      depScore + tightScore + freshScore + confScore + roomScore
    );

    // Below 50 is never shown
    if (totalScore < 50) {
      continue;
    }

    const grade: BlackstoneZoneGrade = totalScore >= 70 ? 'A' : 'B';

    scored.push({
      key: z.key,
      side: z.side,
      baseStartIso: z.baseStartIso,
      formedAtIso: z.formedAtIso,
      formedAtMs: z.formedAtMs,
      confirmIdx: z.confirmIdx,
      proximal: z.proximal,
      distal: z.distal,
      low: z.low,
      high: z.high,
      level: z.level,
      baseWidthDollars: z.baseWidthDollars,
      departureDollars: z.departureDollars,
      touches: z.touches,
      score: totalScore,
      grade,
      sources: matchedSources,
      isNew: z.formedAtMs > lockTimeMs,
    });
  }

  // Enforce at least $10 apart within the same side (above vs below referencePrice)
  const rankedByScore = [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.departureDollars - a.departureDollars;
  });

  const deduplicated: RawReactionCandidate[] = [];
  for (const cand of rankedByScore) {
    const tooClose = deduplicated.some(
      (kept) => Math.abs(kept.level - cand.level) < MIN_SEPARATION_DOLLARS
    );
    if (!tooClose) {
      deduplicated.push(cand);
    }
  }

  // Guarantee at least 1 zone above and 1 zone below price when they exist in the last 10 days of H1 data
  if (typeof referencePrice === 'number' && referencePrice > 0) {
    const hasAbove = deduplicated.some((z) => z.level >= referencePrice);
    if (!hasAbove) {
      const bestAbove = rankedByScore
        .filter((z) => z.level >= referencePrice)
        .sort((a, b) => Math.abs(a.level - referencePrice) - Math.abs(b.level - referencePrice))[0];
      if (bestAbove) {
        deduplicated.push(bestAbove);
      }
    }

    const hasBelow = deduplicated.some((z) => z.level < referencePrice);
    if (!hasBelow) {
      const bestBelow = rankedByScore
        .filter((z) => z.level < referencePrice)
        .sort((a, b) => Math.abs(a.level - referencePrice) - Math.abs(b.level - referencePrice))[0];
      if (bestBelow) {
        deduplicated.push(bestBelow);
      }
    }
  }

  return {
    eligibleZones: deduplicated,
    retiredToday: Array.from(retiredTodayMap.values()),
  };
}

/**
 * Assign BLACKSTONE names to a selected set of up to 5 reaction zones:
 * - Name zones by distance from price at lock time, nearest first:
 *   Crown 1 nearest above, Crown 2, Crown 3 further up;
 *   Root 1 nearest below, Root 2 further down.
 * - The highest score also gets the tag "Sarraf Core".
 */
function assignZoneNamesAndIds(
  selected: Array<{
    key: string;
    side: 'sell side' | 'buy side';
    level: number;
    low: number;
    high: number;
    proximal: number;
    distal: number;
    grade: BlackstoneZoneGrade;
    score: number;
    touches: number;
    departureDollars: number;
    baseWidthDollars: number;
    baseStartIso: string;
    formedAtIso: string;
    isNew: boolean;
    promoted: boolean;
    sources?: string[];
  }>,
  referencePrice: number,
  currentPrice?: number
): BlackstoneLockedZoneBase[] {
  if (selected.length === 0) return [];

  const evalRef = (z: { isNew: boolean; promoted: boolean; level: number }) =>
    z.isNew || z.promoted ? (currentPrice ?? referencePrice) : referencePrice;

  // Above price: sorted nearest first (ascending by level) -> Crown 1, Crown 2, Crown 3
  const above = selected
    .filter((z) => z.level >= evalRef(z))
    .sort((a, b) => a.level - b.level)
    .slice(0, 3);

  // Below price: sorted nearest first (descending by level) -> Root 1, Root 2
  const below = selected
    .filter((z) => z.level < evalRef(z))
    .sort((a, b) => b.level - a.level)
    .slice(0, 2);

  // Enforce max 5 total while preserving at least 1 above and 1 below when available
  const combinedSelected = [...above, ...below].slice(0, 5);
  if (combinedSelected.length === 0) return [];

  // Identify the highest-scoring zone (ties broken by closeness to referencePrice) for "Sarraf Core" tag
  let coreKey = combinedSelected[0].key;
  let bestZone = combinedSelected[0];
  for (let i = 1; i < combinedSelected.length; i++) {
    const curr = combinedSelected[i];
    if (
      curr.score > bestZone.score ||
      (curr.score === bestZone.score &&
        Math.abs(curr.level - referencePrice) < Math.abs(bestZone.level - referencePrice))
    ) {
      bestZone = curr;
      coreKey = curr.key;
    }
  }

  const result: BlackstoneLockedZoneBase[] = [];

  for (let i = 0; i < above.length; i++) {
    const z = above[i];
    const num = i + 1;
    const isCore = z.key === coreKey;
    const tags: string[] = [];
    if (isCore) tags.push('Sarraf Core');
    if (z.isNew) tags.push('NEW');
    result.push({
      ...z,
      id: `CROWN_${num}`,
      name: `Crown ${num}`,
      initialSide: z.side,
      isSarrafCore: isCore,
      tag: isCore ? 'Sarraf Core' : null,
      tags,
    });
  }

  for (let i = 0; i < below.length; i++) {
    const z = below[i];
    const num = i + 1;
    const isCore = z.key === coreKey;
    const tags: string[] = [];
    if (isCore) tags.push('Sarraf Core');
    if (z.isNew) tags.push('NEW');
    result.push({
      ...z,
      id: `ROOT_${num}`,
      name: `Root ${num}`,
      initialSide: z.side,
      isSarrafCore: isCore,
      tag: isCore ? 'Sarraf Core' : null,
      tags,
    });
  }

  // Sort descending by price level so chart & Level Map display top-to-bottom cleanly
  return result.sort((a, b) => b.level - a.level);
}

/**
 * Select the initial locked zones at 04:00 Dubai:
 * - Always keep at least 1 zone above and 1 zone below price when they exist in the last 10 days of H1 data.
 * - Up to 3 above (Crown 1, Crown 2, Crown 3) and up to 2 below (Root 1, Root 2) by distance from lock price, nearest first.
 * - Highest scoring one gets the tag "Sarraf Core".
 * - Maximum 5 zones in total.
 */
function selectInitialLockZones(
  candidates: RawReactionCandidate[],
  referencePrice: number
): BlackstoneLockedZoneBase[] {
  if (candidates.length === 0) return [];
  const preLockCandidates = candidates.filter((c) => !c.isNew);

  // Closest eligible zones above price (fallback to all candidates if preLock has none above)
  let abovePool = preLockCandidates.filter((c) => c.level >= referencePrice);
  if (abovePool.length === 0) {
    abovePool = candidates.filter((c) => c.level >= referencePrice);
  }
  const abovePrice = abovePool
    .sort((a, b) => Math.abs(a.level - referencePrice) - Math.abs(b.level - referencePrice))
    .slice(0, 3);

  // Closest eligible zones below price (fallback to all candidates if preLock has none below)
  let belowPool = preLockCandidates.filter((c) => c.level < referencePrice);
  if (belowPool.length === 0) {
    belowPool = candidates.filter((c) => c.level < referencePrice);
  }
  const belowPrice = belowPool
    .sort((a, b) => Math.abs(a.level - referencePrice) - Math.abs(b.level - referencePrice))
    .slice(0, 2);

  // Keep up to 5 total while always keeping at least 1 above and 1 below when available
  let selectedAbove = abovePrice;
  let selectedBelow = belowPrice;
  if (selectedAbove.length + selectedBelow.length > 5) {
    if (selectedBelow.length === 2 && selectedAbove.length === 3) {
      // Both fit in 5 (3 + 2 = 5)
    } else {
      selectedAbove = selectedAbove.slice(0, Math.max(1, 5 - selectedBelow.length));
    }
  }

  const combined = [...selectedAbove, ...selectedBelow].map((c) => ({
    key: c.key,
    side: c.side,
    level: c.level,
    low: c.low,
    high: c.high,
    proximal: c.proximal,
    distal: c.distal,
    grade: c.grade,
    score: c.score,
    touches: c.touches,
    departureDollars: c.departureDollars,
    baseWidthDollars: c.baseWidthDollars,
    baseStartIso: c.baseStartIso,
    formedAtIso: c.formedAtIso,
    isNew: c.isNew,
    promoted: false,
    sources: c.sources,
  }));

  return assignZoneNamesAndIds(combined, referencePrice);
}

/**
 * Reconcile an existing 04:00 Dubai lock record with current session candles:
 * 1. Locked zones never move (their low/high/proximal/distal/level are frozen).
 * 2. If a locked zone is retired today (closed M5 > $1 beyond distal), it moves to `retiredZones` ("Used today"),
 *    and the next best eligible zone is promoted.
 * 3. Always keep at least 1 zone above and 1 zone below price when they exist in the last 10 days of H1 data.
 * 4. Name zones by distance from lock price, nearest first (Crown 1..3 above, Root 1..2 below) with "Sarraf Core" tag on highest score.
 */
function reconcileDailyLockWithIntraday(
  lockRecord: BlackstoneDailyLockRecord,
  currentScan: {
    eligibleZones: RawReactionCandidate[];
    retiredToday: BlackstoneRetiredZoneRecord[];
  },
  referencePrice: number
): {
  updatedZones: BlackstoneLockedZoneBase[];
  updatedRetired: BlackstoneRetiredZoneRecord[];
  changed: boolean;
} {
  const lockRefPrice = lockRecord.lockReferencePrice ?? referencePrice;
  const retiredByKey = new Map<string, BlackstoneRetiredZoneRecord>();
  for (const r of lockRecord.retiredZones || []) {
    if (r && r.name && !r.name.includes('Reaction Zone')) {
      retiredByKey.set(r.key, r);
    }
  }

  // Map of raw historical scans that breached distal edge today
  const currentScanRetiredByKey = new Map<string, BlackstoneRetiredZoneRecord>();
  for (const r of currentScan.retiredToday) {
    currentScanRetiredByKey.set(r.key, r);
  }

  const currentCandidateByKey = new Map<string, RawReactionCandidate>();
  for (const c of currentScan.eligibleZones) {
    currentCandidateByKey.set(c.key, c);
  }

  let changed = false;
  const activeLocked: BlackstoneLockedZoneBase[] = [];

  for (const lockedZone of lockRecord.zones) {
    // Check if this locked zone was retired today
    const retiredMatch = retiredByKey.get(lockedZone.key) || currentScanRetiredByKey.get(lockedZone.key);
    if (retiredMatch) {
      retiredByKey.set(lockedZone.key, {
        ...retiredMatch,
        id: lockedZone.id,
        name: lockedZone.name,
        level: lockedZone.level,
        low: lockedZone.low,
        high: lockedZone.high,
        proximal: lockedZone.proximal,
        distal: lockedZone.distal,
      });
      changed = true;
      continue;
    }

    // Update touch count if touched once today, or drop if 2+ touches
    const liveCand = currentCandidateByKey.get(lockedZone.key);
    if (!liveCand) {
      changed = true;
      continue;
    }

    if (liveCand.touches !== lockedZone.touches) {
      changed = true;
    }

    // Never move a locked zone's price edges!
    activeLocked.push({
      ...lockedZone,
      touches: liveCand.touches,
      score: lockedZone.score,
      grade: lockedZone.grade,
    });
  }

  // Ensure at least 1 zone above and 1 zone below price when they exist in the last 10 days of H1 data
  const ensureSidePresent = (sideAbove: boolean) => {
    const hasSide = activeLocked.some((z) =>
      sideAbove ? z.level >= referencePrice : z.level < referencePrice
    );
    if (!hasSide) {
      const existingKeys = new Set(activeLocked.map((z) => z.key));
      const candidateForSide = currentScan.eligibleZones
        .filter(
          (c) =>
            (sideAbove ? c.level >= referencePrice : c.level < referencePrice) &&
            !existingKeys.has(c.key) &&
            !retiredByKey.has(c.key)
        )
        .sort(
          (a, b) => Math.abs(a.level - referencePrice) - Math.abs(b.level - referencePrice)
        )[0];

      if (candidateForSide) {
        // If already at 5 zones on the other side, drop the furthest one on the other side to make room
        if (activeLocked.length >= 5) {
          activeLocked.sort(
            (a, b) => Math.abs(a.level - referencePrice) - Math.abs(b.level - referencePrice)
          );
          activeLocked.pop();
        }
        activeLocked.push({
          key: candidateForSide.key,
          id: sideAbove ? 'CROWN_1' : 'ROOT_1',
          name: sideAbove ? 'Crown 1' : 'Root 1',
          level: candidateForSide.level,
          low: candidateForSide.low,
          high: candidateForSide.high,
          proximal: candidateForSide.proximal,
          distal: candidateForSide.distal,
          side: candidateForSide.side,
          initialSide: candidateForSide.side,
          grade: candidateForSide.grade,
          score: candidateForSide.score,
          touches: candidateForSide.touches,
          departureDollars: candidateForSide.departureDollars,
          baseWidthDollars: candidateForSide.baseWidthDollars,
          baseStartIso: candidateForSide.baseStartIso,
          formedAtIso: candidateForSide.formedAtIso,
          isNew: candidateForSide.isNew,
          promoted: !candidateForSide.isNew,
          sources: candidateForSide.sources,
        });
        changed = true;
      }
    }
  };

  ensureSidePresent(true);
  ensureSidePresent(false);

  // Promote next best eligible pre-lock zone if a locked zone was retired
  const retiredSlotCount = Math.max(0, lockRecord.zones.length - activeLocked.length);
  if (retiredSlotCount > 0 && activeLocked.length < 5) {
    const existingKeys = new Set(activeLocked.map((z) => z.key));
    const promotionPool = currentScan.eligibleZones
      .filter(
        (c) =>
          !c.isNew &&
          !existingKeys.has(c.key) &&
          !retiredByKey.has(c.key) &&
          activeLocked.every((az) => Math.abs(az.level - c.level) >= MIN_SEPARATION_DOLLARS)
      )
      .sort((a, b) => b.score - a.score);

    for (const promo of promotionPool.slice(0, retiredSlotCount)) {
      if (activeLocked.length >= 5) break;
      const aboveCount = activeLocked.filter((z) => z.level >= lockRefPrice).length;
      const belowCount = activeLocked.filter((z) => z.level < lockRefPrice).length;
      if (promo.level >= lockRefPrice && aboveCount >= 3) continue;
      if (promo.level < lockRefPrice && belowCount >= 2) continue;

      activeLocked.push({
        key: promo.key,
        id: promo.level >= lockRefPrice ? 'CROWN_1' : 'ROOT_1',
        name: promo.level >= lockRefPrice ? 'Crown 1' : 'Root 1',
        level: promo.level,
        low: promo.low,
        high: promo.high,
        proximal: promo.proximal,
        distal: promo.distal,
        side: promo.side,
        initialSide: promo.side,
        grade: promo.grade,
        score: promo.score,
        touches: promo.touches,
        departureDollars: promo.departureDollars,
        baseWidthDollars: promo.baseWidthDollars,
        baseStartIso: promo.baseStartIso,
        formedAtIso: promo.formedAtIso,
        isNew: false,
        promoted: true,
        sources: promo.sources,
      });
      changed = true;
    }
  }

  // Append any NEW reaction zones that formed later in the day (after 04:00 Dubai lock) with isNew: true
  const existingKeys = new Set(activeLocked.map((z) => z.key));
  const newIntradayZones = currentScan.eligibleZones
    .filter(
      (c) =>
        c.isNew &&
        !existingKeys.has(c.key) &&
        !retiredByKey.has(c.key) &&
        activeLocked.every((az) => Math.abs(az.level - c.level) >= MIN_SEPARATION_DOLLARS)
    )
    .sort((a, b) => b.score - a.score);

  for (const nz of newIntradayZones) {
    if (activeLocked.length >= 5) break;
    const aboveCount = activeLocked.filter((z) => z.level >= lockRefPrice).length;
    const belowCount = activeLocked.filter((z) => z.level < lockRefPrice).length;
    if (nz.level >= lockRefPrice && aboveCount >= 3) continue;
    if (nz.level < lockRefPrice && belowCount >= 2) continue;

    activeLocked.push({
      key: nz.key,
      id: nz.level >= lockRefPrice ? 'CROWN_1' : 'ROOT_1',
      name: nz.level >= lockRefPrice ? 'Crown 1' : 'Root 1',
      level: nz.level,
      low: nz.low,
      high: nz.high,
      proximal: nz.proximal,
      distal: nz.distal,
      side: nz.side,
      initialSide: nz.side,
      grade: nz.grade,
      score: nz.score,
      touches: nz.touches,
      departureDollars: nz.departureDollars,
      baseWidthDollars: nz.baseWidthDollars,
      baseStartIso: nz.baseStartIso,
      formedAtIso: nz.formedAtIso,
      isNew: true,
      promoted: false,
      sources: nz.sources,
    });
    changed = true;
  }

  // Name zones by distance from price at lock time, nearest first (Crown 1..3 above, Root 1..2 below)
  // and tag highest score with "Sarraf Core"
  const ordered = assignZoneNamesAndIds(activeLocked, lockRefPrice, referencePrice);
  if (
    ordered.length !== lockRecord.zones.length ||
    ordered.some(
      (z, idx) =>
        z.id !== lockRecord.zones[idx]?.id ||
        z.name !== lockRecord.zones[idx]?.name ||
        z.isSarrafCore !== lockRecord.zones[idx]?.isSarrafCore ||
        z.tag !== lockRecord.zones[idx]?.tag
    )
  ) {
    changed = true;
  }

  const updatedRetired = Array.from(retiredByKey.values())
    .filter((r) => r.name && !r.name.includes('Reaction Zone'))
    .sort(
      (a, b) => new Date(b.retiredAtIso).getTime() - new Date(a.retiredAtIso).getTime()
    );

  if (updatedRetired.length !== (lockRecord.retiredZones || []).length) {
    changed = true;
  }

  return {
    updatedZones: ordered,
    updatedRetired,
    changed,
  };
}

/**
 * Format active zones for the UI response, computing live distance and status label.
 */
function formatZonesForDisplay(
  zones: BlackstoneLockedZoneBase[],
  livePrice: number | null,
  isAdmin: boolean
): BlackstoneEvaluatedZone[] {
  return zones.map((z) => {
    const displayRole: 'sell side' | 'buy side' | 'centre' =
      z.isSarrafCore || z.id === 'SARRAF_CORE' ? 'centre' : z.side;

    const status: 'FRESH' | 'TESTED' = z.touches > 0 ? 'TESTED' : 'FRESH';
    const statusLabel = z.touches > 0 ? 'TESTED 1' : 'FRESH';

    const distanceDollars =
      livePrice !== null && livePrice > 0 ? round2(z.level - livePrice) : null;
    const distanceFormatted =
      distanceDollars === null
        ? '—'
        : distanceDollars > 0
          ? `+$${distanceDollars.toFixed(2)}`
          : distanceDollars < 0
            ? `-$${Math.abs(distanceDollars).toFixed(2)}`
            : '$0.00';

    const item: BlackstoneEvaluatedZone = {
      ...z,
      displayRole,
      status,
      statusLabel,
      testsCount: z.touches,
      distanceDollars,
      distanceFormatted,
    };

    if (!isAdmin) {
      delete item.sources;
    }

    return item;
  });
}

/**
 * Build server-side visibleZones list:
 * - Always keeps at least 1 zone above and 1 zone below price when they exist.
 * - Up to 5 zones total, sorted top-to-bottom by level.
 */
function computeServerVisibleZones(
  formattedZones: BlackstoneEvaluatedZone[],
  referencePrice: number | null
): {
  visibleZones: BlackstoneEvaluatedZone[];
  aboveZone: BlackstoneEvaluatedZone | null;
  belowZone: BlackstoneEvaluatedZone | null;
} {
  if (formattedZones.length === 0) {
    return { visibleZones: [], aboveZone: null, belowZone: null };
  }
  if (referencePrice === null || referencePrice <= 0) {
    return {
      visibleZones: formattedZones.slice(0, 5),
      aboveZone: formattedZones[0] || null,
      belowZone: formattedZones[formattedZones.length - 1] || null,
    };
  }

  const aboveAll = formattedZones
    .filter((z) => z.level >= referencePrice)
    .sort((a, b) => Math.abs(a.level - referencePrice) - Math.abs(b.level - referencePrice));
  const belowAll = formattedZones
    .filter((z) => z.level < referencePrice)
    .sort((a, b) => Math.abs(a.level - referencePrice) - Math.abs(b.level - referencePrice));

  const nearestAbove = aboveAll[0] || null;
  const nearestBelow = belowAll[0] || null;

  const visibleMap = new Map<string, BlackstoneEvaluatedZone>();
  if (nearestAbove) visibleMap.set(nearestAbove.key, nearestAbove);
  if (nearestBelow) visibleMap.set(nearestBelow.key, nearestBelow);

  for (const z of formattedZones) {
    if (visibleMap.size >= 5) break;
    if (Math.abs(z.level - referencePrice) <= 60 || visibleMap.size < 5) {
      visibleMap.set(z.key, z);
    }
  }

  const visibleZones = Array.from(visibleMap.values())
    .sort((a, b) => b.level - a.level)
    .slice(0, 5);

  return {
    visibleZones,
    aboveZone: nearestAbove,
    belowZone: nearestBelow,
  };
}

function sanitizeRetiredForUser(
  retired: BlackstoneRetiredZoneRecord[],
  isAdmin: boolean
): BlackstoneRetiredZoneRecord[] {
  if (isAdmin) return retired;
  return retired.map((r) => {
    const copy = { ...r };
    delete copy.sources;
    return copy;
  });
}

function sanitizeHistoryRecordForUser(
  rec: BlackstoneDailyLockRecord,
  isAdmin: boolean
): BlackstoneDailyLockRecord {
  if (isAdmin) return rec;
  return {
    ...rec,
    sources: {},
    zones: (rec.zones || []).map((z) => {
      const copy = { ...z };
      delete copy.sources;
      return copy;
    }),
    retiredZones: sanitizeRetiredForUser(rec.retiredZones || [], false),
  };
}

/**
 * Initialize the server-side BLACKSTONE H1 Reaction Zone Engine.
 */
export function initBlackstoneEngine(): void {
  try {
    initBlackstonePlanEngine();
    const store = getCandleStore();
    if (store.M5 && store.M5.length > 0) {
      store.M15 = mergeCandleSeries(store.M15, buildTimeframeFromM5(store.M5, 15));
      store.M30 = mergeCandleSeries(store.M30, buildTimeframeFromM5(store.M5, 30));
      store.H1 = mergeCandleSeries(store.H1, buildTimeframeFromM5(store.M5, 60));
      saveCandlesToDisk();
    }

    const h1Days = countStoredH1TradingDays();
    if (h1Days < 30) {
      lastH1HistoryRequestMs = Date.now();
      requestMoreH1HistoryFromFeed()
        .then(() => {
          getBlackstoneState();
        })
        .catch(() => {});
    }

    getBlackstoneState();
    console.log(
      `[BLACKSTONE ENGINE] Initialized server-side H1 Reaction Zone Engine (${h1Days} H1 trading days stored).`
    );
  } catch (err: any) {
    console.error('[BLACKSTONE ENGINE] Initialization error:', err.message);
  }
}

/**
 * Main server snapshot for BLACKSTONE view.
 */
export function getBlackstoneState(
  nowMs: number = Date.now(),
  isAdmin: boolean = false
): BlackstoneStatePayload {
  const timing = getDubaiSessionTiming(nowMs);
  const marketEval = evaluateMarketPriceStatus();
  const lastTick = getLastValidTick();

  const marketStatus: 'LIVE' | 'MARKET_CLOSED' | 'FEED_STALE' =
    marketEval.status === 'MARKET_CLOSED'
      ? 'MARKET_CLOSED'
      : marketEval.isLive
        ? 'LIVE'
        : 'FEED_STALE';

  const livePrice =
    lastTick && lastTick.price > 0 ? round2(lastTick.price) : null;

  // Check if at least 30 trading days of H1 history are stored; if not, ask the feed
  const h1TradingDaysCount = countStoredH1TradingDays();
  if (h1TradingDaysCount < 30 && nowMs - lastH1HistoryRequestMs > 60_000) {
    lastH1HistoryRequestMs = nowMs;
    requestMoreH1HistoryFromFeed().catch(() => {});
  }
  const historyStatus: 'READY' | 'Building history' =
    h1TradingDaysCount >= 30 ? 'READY' : 'Building history';

  const { openingGap, openingRange, lockedLevels: computedLockedLevels, confluenceRefs } =
    computeSessionReferences(timing, nowMs);
  const liveDayState = computeBlackstoneDayState(timing.openTimeMs, openingRange.width);

  const store = getCandleStore();
  const fallbackCandleClose =
    store.M5 && store.M5.length > 0
      ? round2(store.M5[store.M5.length - 1].close)
      : store.H1 && store.H1.length > 0
        ? round2(store.H1[store.H1.length - 1].close)
        : 4000;

  const effectiveReferencePrice =
    livePrice ?? openingRange.closePrice ?? openingRange.openPrice ?? fallbackCandleClose;

  const allLocks = loadBlackstoneLocksFromDisk();
  let todayLock = allLocks.find((r) => r.sessionDate === timing.sessionDate) || null;

  const currentScan = scanAndScoreReactionZones(
    nowMs,
    timing.openTimeMs,
    timing.lockTimeMs,
    confluenceRefs,
    effectiveReferencePrice
  );

  if (todayLock) {
    const { updatedZones, updatedRetired, changed } = reconcileDailyLockWithIntraday(
      todayLock,
      currentScan,
      effectiveReferencePrice
    );

    // Ensure lockedLevels are persisted once at lock time and never change during the day
    const persistedLockedLevels = todayLock.lockedLevels || computedLockedLevels;
    const needsLockedLevelsBackfill = !todayLock.lockedLevels;

    if (
      changed ||
      needsLockedLevelsBackfill ||
      todayLock.h1TradingDaysCount !== h1TradingDaysCount ||
      todayLock.dayState?.todayRangeSoFar !== liveDayState.todayRangeSoFar
    ) {
      const gradeMap: Record<string, BlackstoneZoneGrade> = {};
      const scoreMap: Record<string, number> = {};
      const touchesMap: Record<string, number> = {};
      const sourcesMap: Record<string, string[]> = {};

      for (const z of updatedZones) {
        gradeMap[z.id] = z.grade;
        scoreMap[z.id] = z.score;
        touchesMap[z.id] = z.touches;
        sourcesMap[z.id] = z.sources || [];
      }

      todayLock = {
        ...todayLock,
        h1TradingDaysCount,
        historyStatus,
        lockedLevels: persistedLockedLevels,
        dayState: liveDayState,
        zones: updatedZones,
        grade: gradeMap,
        score: scoreMap,
        touches: touchesMap,
        sources: sourcesMap,
        retiredZones: updatedRetired,
      };

      const updatedAll = [
        ...allLocks.filter((r) => r.sessionDate !== timing.sessionDate),
        todayLock,
      ];
      saveBlackstoneLocksToDisk(updatedAll);
    }

    const countdownSeconds = Math.max(0, Math.floor((timing.nextLockMs - nowMs) / 1000));
    const priorHistory = allLocks
      .filter((r) => r.sessionDate < timing.sessionDate)
      .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate))
      .map((r) => sanitizeHistoryRecordForUser(r, isAdmin));

    const formattedZones = formatZonesForDisplay(todayLock.zones, livePrice, isAdmin);
    const formattedRetired = sanitizeRetiredForUser(todayLock.retiredZones || [], isAdmin);
    const activeLockedLevels = todayLock.lockedLevels || persistedLockedLevels;
    const adrState = computeLiveAdrState(activeLockedLevels, liveDayState, livePrice);
    const referenceLevels = buildReferenceLevelsList(activeLockedLevels, adrState, livePrice);
    const plan = evaluateLivePlanEngine(
      formattedZones,
      todayLock.retiredZones || [],
      adrState.adrUsedPct,
      adrState.adr4
    );
    const { visibleZones, aboveZone, belowZone } = computeServerVisibleZones(
      formattedZones,
      livePrice ?? effectiveReferencePrice
    );

    return {
      sessionDate: todayLock.sessionDate,
      isLocked: true,
      lockStateLabel: 'LOCKED',
      h1TradingDaysCount,
      historyStatus,
      isAdmin,
      openTimeIso: todayLock.openTimeIso,
      openTimeDubai: todayLock.openTimeDubai,
      lockTimeIso: todayLock.lockTimeIso,
      lockTimeDubai: todayLock.lockTimeDubai,
      lockedAtIso: todayLock.lockedAtIso,
      nextLockIso: timing.nextLockIso,
      nextLockCountdownSeconds: countdownSeconds,
      nextLockCountdownFormatted: formatCountdownHHMMSS(countdownSeconds),
      marketStatus,
      livePrice,
      sourceLabel: 'Ahmad server',
      dubaiClock: formatDubaiClockFull(nowMs),
      openingGap: todayLock.openingGap,
      openingRange: todayLock.openingRange,
      lockedLevels: activeLockedLevels,
      adrState,
      referenceLevels,
      dayState: liveDayState,
      zones: formattedZones,
      visibleZones,
      aboveZone,
      belowZone,
      retiredZones: formattedRetired,
      lockHistory: priorHistory,
      allLocksCount: allLocks.length,
      plan,
      tape: getBlackstoneTapeState(),
      zoneRecords: getZoneRecordsSummary(todayLock.zones),
      backtest: getBacktestState(),
    };
  }

  // Not yet locked for today: build initial 04:00 Dubai lock if past lockTimeMs
  const lockRefPrice =
    openingRange.closePrice ?? openingRange.openPrice ?? effectiveReferencePrice;

  const lockAt0400Refs = computeSessionReferences(timing, timing.lockTimeMs);
  const scanAtLock = scanAndScoreReactionZones(
    timing.isPastLockTime ? timing.lockTimeMs : nowMs,
    timing.openTimeMs,
    timing.lockTimeMs,
    lockAt0400Refs.confluenceRefs,
    lockRefPrice
  );

  const initialZones = selectInitialLockZones(scanAtLock.eligibleZones, lockRefPrice);

  if (timing.isPastLockTime && (initialZones.length > 0 || currentScan.eligibleZones.length > 0)) {
    const draftLock: BlackstoneDailyLockRecord = {
      engineVersion: 4,
      sessionDate: timing.sessionDate,
      openTimeIso: timing.openTimeIso,
      openTimeDubai: '02:00 Dubai',
      lockTimeIso: timing.lockTimeIso,
      lockTimeDubai: '04:00 Dubai',
      lockedAtIso: new Date(nowMs).toISOString(),
      lockReferencePrice: lockRefPrice,
      h1TradingDaysCount,
      historyStatus,
      openingGap,
      openingRange,
      lockedLevels: lockAt0400Refs.lockedLevels,
      dayState: liveDayState,
      zones: initialZones,
      grade: {},
      score: {},
      touches: {},
      sources: {},
      retiredZones: scanAtLock.retiredToday,
    };

    const reconciled = reconcileDailyLockWithIntraday(
      draftLock,
      currentScan,
      effectiveReferencePrice
    );

    const gradeMap: Record<string, BlackstoneZoneGrade> = {};
    const scoreMap: Record<string, number> = {};
    const touchesMap: Record<string, number> = {};
    const sourcesMap: Record<string, string[]> = {};

    for (const z of reconciled.updatedZones) {
      gradeMap[z.id] = z.grade;
      scoreMap[z.id] = z.score;
      touchesMap[z.id] = z.touches;
      sourcesMap[z.id] = z.sources || [];
    }

    todayLock = {
      ...draftLock,
      zones: reconciled.updatedZones,
      grade: gradeMap,
      score: scoreMap,
      touches: touchesMap,
      sources: sourcesMap,
      retiredZones: reconciled.updatedRetired,
    };

    const updatedAll = [
      ...allLocks.filter((r) => r.sessionDate !== timing.sessionDate),
      todayLock,
    ];
    saveBlackstoneLocksToDisk(updatedAll);
  }

  const activeZones = todayLock ? todayLock.zones : initialZones;
  const activeRetired = todayLock ? todayLock.retiredZones : currentScan.retiredToday;
  const activeLockedLevels =
    todayLock?.lockedLevels ?? lockAt0400Refs.lockedLevels ?? computedLockedLevels;
  const adrState = computeLiveAdrState(activeLockedLevels, liveDayState, livePrice);
  const referenceLevels = buildReferenceLevelsList(activeLockedLevels, adrState, livePrice);

  const countdownSeconds = Math.max(0, Math.floor((timing.nextLockMs - nowMs) / 1000));
  const priorHistory = allLocks
    .filter((r) => r.sessionDate < timing.sessionDate)
    .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate))
    .map((r) => sanitizeHistoryRecordForUser(r, isAdmin));

  const lockStateLabel =
    activeZones.length === 0
      ? 'WAITING FOR CANDLES'
      : timing.isPastLockTime
        ? 'LOCKED'
        : 'OPENING RANGE (02:00–04:00)';

  const formattedZones = formatZonesForDisplay(activeZones, livePrice, isAdmin);
  const { visibleZones, aboveZone, belowZone } = computeServerVisibleZones(
    formattedZones,
    livePrice ?? effectiveReferencePrice
  );

  return {
    sessionDate: timing.sessionDate,
    isLocked: Boolean(todayLock),
    lockStateLabel,
    h1TradingDaysCount,
    historyStatus,
    isAdmin,
    openTimeIso: timing.openTimeIso,
    openTimeDubai: '02:00 Dubai',
    lockTimeIso: timing.lockTimeIso,
    lockTimeDubai: '04:00 Dubai',
    lockedAtIso: todayLock ? todayLock.lockedAtIso : null,
    nextLockIso: timing.nextLockIso,
    nextLockCountdownSeconds: countdownSeconds,
    nextLockCountdownFormatted: formatCountdownHHMMSS(countdownSeconds),
    marketStatus,
    livePrice,
    sourceLabel: 'Ahmad server',
    dubaiClock: formatDubaiClockFull(nowMs),
    openingGap,
    openingRange,
    lockedLevels: activeLockedLevels,
    adrState,
    referenceLevels,
    dayState: liveDayState,
    zones: formattedZones,
    visibleZones,
    aboveZone,
    belowZone,
    retiredZones: sanitizeRetiredForUser(activeRetired, isAdmin),
    lockHistory: priorHistory,
    allLocksCount: todayLock ? priorHistory.length + 1 : priorHistory.length,
    plan: evaluateLivePlanEngine(
      formattedZones,
      activeRetired,
      adrState.adrUsedPct,
      adrState.adr4
    ),
    tape: getBlackstoneTapeState(),
    zoneRecords: getZoneRecordsSummary(todayLock ? todayLock.zones : activeZones),
    backtest: getBacktestState(),
  };
}

/**
 * Return candles for M5, M15, M30, or H1 aggregated from stored server candles and kept live with the live price.
 * A new candle starts when the real period ends.
 */
export function getBlackstoneCandles(tfParam: string): {
  tf: 'M5' | 'M15' | 'M30' | 'H1';
  candles: Candle[];
  openTimeIso: string;
  lockTimeIso: string;
} {
  const normalized = (tfParam || 'M15').toUpperCase();
  const tf: 'M5' | 'M15' | 'M30' | 'H1' =
    normalized === 'M5' || normalized === 'M30' || normalized === 'H1' ? normalized : 'M15';

  const store = getCandleStore();
  const m5Base = [...(store.M5 || [])].sort(
    (a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime()
  );

  let list: Candle[] = [];
  if (tf === 'M5') {
    list = m5Base;
  } else {
    const periodMinutes = tf === 'M15' ? 15 : tf === 'M30' ? 30 : 60;
    const builtFromM5 = buildTimeframeFromM5(m5Base, periodMinutes);
    list = mergeCandleSeries(store[tf] || [], builtFromM5, 1200);
  }

  // Update latest candle with live tick if available, or advance to new candle when period ends
  const lastTick = getLastValidTick();
  if (lastTick && lastTick.price > 0 && list.length > 0) {
    const periodMinutes = tf === 'M5' ? 5 : tf === 'M15' ? 15 : tf === 'M30' ? 30 : 60;
    const periodMs = periodMinutes * 60 * 1000;
    const nowMs =
      typeof lastTick.timestamp === 'number'
        ? lastTick.timestamp
        : lastTick.timestamp
          ? new Date(lastTick.timestamp).getTime()
          : Date.now();
    const currentBucketMs = Math.floor(nowMs / periodMs) * periodMs;
    const currentBucketIso = new Date(currentBucketMs).toISOString();

    const last = list[list.length - 1];
    const lastBarTime = new Date(last.openTime).getTime();

    if (last.openTime === currentBucketIso || lastBarTime === currentBucketMs) {
      list[list.length - 1] = {
        ...last,
        high: Math.max(last.high, lastTick.price),
        low: Math.min(last.low, lastTick.price),
        close: lastTick.price,
        isClosed: false,
      };
    } else if (currentBucketMs > lastBarTime) {
      list[list.length - 1] = {
        ...last,
        isClosed: true,
      };
      list.push({
        openTime: currentBucketIso,
        open: lastTick.price,
        high: lastTick.price,
        low: lastTick.price,
        close: lastTick.price,
        volume: 1,
        isClosed: false,
        usableForZones: true,
      });
    }
  }

  const timing = getDubaiSessionTiming();
  return {
    tf,
    candles: list.slice(-160),
    openTimeIso: timing.openTimeIso,
    lockTimeIso: timing.lockTimeIso,
  };
}
