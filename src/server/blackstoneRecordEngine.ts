import fs from 'fs';
import path from 'path';
import { DATA_DIR, writeJsonAtomic } from './deploymentSafety.ts';
import { getCandleStore } from './candleEngine.ts';
import { countStoredH1TradingDays } from './blackstoneEngine.ts';

export interface DailyZoneRecord {
  date: string; // YYYY-MM-DD
  zoneId: string;
  zoneName: string;
  tests: number;
  held: number;
  broken: number;
}

export interface ZonePeriodStats {
  tests: number;
  held: number;
  broken: number;
  holdRatePct: number | null; // null if tests === 0 -> renders as "—"
}

export interface ZoneSummaryRow {
  zoneId: string;
  zoneName: string;
  today: ZonePeriodStats;
  d30: ZonePeriodStats;
  d60: ZonePeriodStats;
  d90: ZonePeriodStats;
  totalStoredTests: number;
  rating: string | null; // null if totalStoredTests < 10 -> renders as "— (Requires 10 tests)"
}

export interface StoredSignalRecord {
  id: string;
  createdAt: string; // ISO
  closedAt: string; // ISO
  date: string; // YYYY-MM-DD
  zoneId: string;
  zoneName: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  exitPrice: number;
  exitReason: string;
  pnlDollars: number;
  pnlR: number;
  m15Atr: number;
  outcome: 'WIN' | 'LOSS' | 'BE';
}

export interface BacktestPeriodMetrics {
  days: number;
  tradesCount: number;
  winsCount: number;
  lossesCount: number;
  beCount: number;
  winRatePct: number | null; // null if 0 trades -> renders "—"
  netR: number | null; // null if 0 trades -> renders "—"
  totalPnlDollars: number | null; // null if 0 trades -> renders "—"
  profitFactor: number | null; // null if 0 trades -> renders "—"
}

export interface BacktestRulesMetadata {
  gates: Array<{ id: number; name: string; rule: string }>;
  fixedPlan: {
    stopLoss: string;
    tp1: string;
    tp2: string;
    tp3: string;
    positionSplits: string;
    beRule: string;
  };
  limits: {
    maxTradesPerDay?: number;
    maxTradesPerLevelPerDay: number;
    maxStoppedTradesPerDay: number;
    postExitClearanceDistance: string;
    newsPauseWindow: string;
  };
}

export interface BacktestStatePayload {
  d30: BacktestPeriodMetrics;
  d60: BacktestPeriodMetrics;
  d90: BacktestPeriodMetrics;
  totalTradesStored: number;
  tradeLog: StoredSignalRecord[];
  rules: BacktestRulesMetadata;
  candlesCountM5: number;
  candlesCountM15: number;
  candlesCountH1: number;
  storedDaysCountH1: number;
}

const ZONE_RECORDS_FILE = path.resolve(DATA_DIR, 'blackstone_zone_records.json');
const SIGNALS_HISTORY_FILE = path.resolve(DATA_DIR, 'blackstone_signals_history.json');

// In-memory caches synced to disk
let cachedZoneRecords: DailyZoneRecord[] | null = null;
let cachedSignalsHistory: StoredSignalRecord[] | null = null;

function getTodayDateStr(): string {
  try {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
    return d; // YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function loadZoneRecordsFromDisk(): DailyZoneRecord[] {
  if (cachedZoneRecords) return cachedZoneRecords;
  try {
    if (fs.existsSync(ZONE_RECORDS_FILE)) {
      const raw = fs.readFileSync(ZONE_RECORDS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        cachedZoneRecords = parsed;
        return cachedZoneRecords;
      }
    }
  } catch (err: any) {
    console.warn('[BLACKSTONE RECORD] Error reading zone records:', err.message);
  }
  cachedZoneRecords = [];
  return cachedZoneRecords;
}

export function saveZoneRecordsToDisk(records: DailyZoneRecord[]): void {
  cachedZoneRecords = records;
  try {
    writeJsonAtomic(ZONE_RECORDS_FILE, records);
  } catch (err: any) {
    console.error('[BLACKSTONE RECORD] Failed saving zone records:', err.message);
  }
}

export function loadSignalsHistoryFromDisk(): StoredSignalRecord[] {
  if (cachedSignalsHistory) return cachedSignalsHistory;
  try {
    if (fs.existsSync(SIGNALS_HISTORY_FILE)) {
      const raw = fs.readFileSync(SIGNALS_HISTORY_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        cachedSignalsHistory = parsed;
        return cachedSignalsHistory;
      }
    }
  } catch (err: any) {
    console.warn('[BLACKSTONE RECORD] Error reading signals history:', err.message);
  }
  cachedSignalsHistory = [];
  return cachedSignalsHistory;
}

export function saveSignalsHistoryToDisk(signals: StoredSignalRecord[]): void {
  cachedSignalsHistory = signals;
  try {
    writeJsonAtomic(SIGNALS_HISTORY_FILE, signals);
  } catch (err: any) {
    console.error('[BLACKSTONE RECORD] Failed saving signals history:', err.message);
  }
}

/**
 * Record a zone test result on the server (tests, held, broken) for a given date (defaults to today).
 */
export function recordZoneTestOutcome(
  zoneId: string,
  zoneName: string,
  outcome: 'HELD' | 'BROKEN',
  targetDate?: string
): void {
  const dateStr = targetDate || getTodayDateStr();
  const records = loadZoneRecordsFromDisk();

  let entry = records.find((r) => r.date === dateStr && r.zoneId === zoneId);
  if (!entry) {
    entry = {
      date: dateStr,
      zoneId,
      zoneName,
      tests: 0,
      held: 0,
      broken: 0,
    };
    records.push(entry);
  }

  entry.tests += 1;
  if (outcome === 'HELD') {
    entry.held += 1;
  } else {
    entry.broken += 1;
  }

  saveZoneRecordsToDisk(records);
}

const CORE_ZONE_DEFINITIONS: Array<{ id: string; name: string }> = [
  { id: 'CROWN_1', name: 'Crown 1' },
  { id: 'CROWN_2', name: 'Crown 2' },
  { id: 'CROWN_3', name: 'Crown 3' },
  { id: 'ROOT_1', name: 'Root 1' },
  { id: 'ROOT_2', name: 'Root 2' },
];

function computePeriodStats(
  records: DailyZoneRecord[],
  zoneId: string,
  minDateInclusive: string
): ZonePeriodStats {
  const filtered = records.filter(
    (r) => r.zoneId === zoneId && r.date >= minDateInclusive
  );

  let tests = 0;
  let held = 0;
  let broken = 0;

  for (const r of filtered) {
    tests += r.tests || 0;
    held += r.held || 0;
    broken += r.broken || 0;
  }

  if (tests === 0) {
    return { tests: 0, held: 0, broken: 0, holdRatePct: null };
  }

  const holdRatePct = Number(((held / tests) * 100).toFixed(1));
  return { tests, held, broken, holdRatePct };
}

function calculateZoneRating(totalStoredTests: number, holdRatePct: number | null): string | null {
  // "A zone gets a rating only after 10 stored tests."
  if (totalStoredTests < 10 || holdRatePct === null) {
    return null;
  }
  if (holdRatePct >= 80) return `ELITE (${holdRatePct.toFixed(0)}%)`;
  if (holdRatePct >= 70) return `STRONG (${holdRatePct.toFixed(0)}%)`;
  if (holdRatePct >= 60) return `RELIABLE (${holdRatePct.toFixed(0)}%)`;
  return `DEVELOPING (${holdRatePct.toFixed(0)}%)`;
}

/**
 * Returns zone test summary for Today, 30d, 60d, 90d per zone.
 * Uses a dash (represented as null) until real stored data exists (minimum 10 stored tests).
 * Rows use the same names as the Level map.
 */
export function getZoneRecordsSummary(
  currentLockedZones?: Array<{ id: string; name: string }>
): ZoneSummaryRow[] {
  const records = loadZoneRecordsFromDisk();
  const todayStr = getTodayDateStr();

  const nowMs = Date.now();
  const d30DateStr = new Date(nowMs - 30 * 86400000).toISOString().slice(0, 10);
  const d60DateStr = new Date(nowMs - 60 * 86400000).toISOString().slice(0, 10);
  const d90DateStr = new Date(nowMs - 90 * 86400000).toISOString().slice(0, 10);

  // Discover all zones present from Level map / current locked zones
  const zoneMap = new Map<string, string>();
  if (currentLockedZones && currentLockedZones.length > 0) {
    for (const z of currentLockedZones) {
      if (z.name && !z.name.includes('Reaction Zone')) {
        zoneMap.set(z.id, z.name);
      }
    }
  } else {
    for (const c of CORE_ZONE_DEFINITIONS) {
      zoneMap.set(c.id, c.name);
    }
  }

  // Filter out any bogus/generic records like "Buy Reaction Zone" or "Sell Reaction Zone"
  const cleanRecords = records.filter(
    (r) => r.zoneName && !r.zoneName.includes('Reaction Zone')
  );

  for (const r of cleanRecords) {
    if (!zoneMap.has(r.zoneId)) {
      zoneMap.set(r.zoneId, r.zoneName || r.zoneId);
    }
  }

  const result: ZoneSummaryRow[] = [];

  for (const [zoneId, zoneName] of zoneMap.entries()) {
    const today = computePeriodStats(cleanRecords, zoneId, todayStr);
    const d30 = computePeriodStats(cleanRecords, zoneId, d30DateStr);
    const d60 = computePeriodStats(cleanRecords, zoneId, d60DateStr);
    const d90 = computePeriodStats(cleanRecords, zoneId, d90DateStr);

    const allZoneRecords = cleanRecords.filter((r) => r.zoneId === zoneId);
    const totalStoredTests = allZoneRecords.reduce((acc, cur) => acc + (cur.tests || 0), 0);
    const totalHeld = allZoneRecords.reduce((acc, cur) => acc + (cur.held || 0), 0);

    // Show dashes unless a zone has at least 10 real stored tests
    const overallHoldRate =
      totalStoredTests >= 10
        ? Number(((totalHeld / totalStoredTests) * 100).toFixed(1))
        : null;

    const rating = calculateZoneRating(totalStoredTests, overallHoldRate);

    result.push({
      zoneId,
      zoneName,
      today: totalStoredTests >= 10 ? today : { tests: 0, held: 0, broken: 0, holdRatePct: null },
      d30: totalStoredTests >= 10 ? d30 : { tests: 0, held: 0, broken: 0, holdRatePct: null },
      d60: totalStoredTests >= 10 ? d60 : { tests: 0, held: 0, broken: 0, holdRatePct: null },
      d90: totalStoredTests >= 10 ? d90 : { tests: 0, held: 0, broken: 0, holdRatePct: null },
      totalStoredTests,
      rating,
    });
  }

  return result;
}

/**
 * Record a closed trade signal from the live engine into permanent history.
 */
export function recordClosedSignalToHistory(trade: {
  id: string;
  zoneId: string;
  zoneName: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  currentStopLoss: number;
  tp1: { price: number };
  tp2: { price: number };
  tp3: { price: number };
  exitPrice?: number;
  exitReason?: string;
  totalPnlDollars?: number;
  totalPnlR?: number;
  m15Atr?: number;
  entryTimeIso?: string;
  exitTimeIso?: string;
}): void {
  const history = loadSignalsHistoryFromDisk();
  // Prevent duplicate insertion
  if (history.some((h) => h.id === trade.id)) return;

  const nowIso = new Date().toISOString();
  const pnlR = trade.totalPnlR ?? 0;
  const outcome: 'WIN' | 'LOSS' | 'BE' = pnlR > 0.05 ? 'WIN' : pnlR < -0.05 ? 'LOSS' : 'BE';

  const record: StoredSignalRecord = {
    id: trade.id,
    createdAt: trade.entryTimeIso || nowIso,
    closedAt: trade.exitTimeIso || nowIso,
    date: getTodayDateStr(),
    zoneId: trade.zoneId,
    zoneName: trade.zoneName,
    side: trade.side === 'BUY' ? 'LONG' : 'SHORT',
    entryPrice: trade.entryPrice,
    stopLoss: trade.currentStopLoss,
    tp1: trade.tp1.price,
    tp2: trade.tp2.price,
    tp3: trade.tp3.price,
    exitPrice: trade.exitPrice ?? trade.entryPrice,
    exitReason: trade.exitReason || 'Closed',
    pnlDollars: trade.totalPnlDollars ?? 0,
    pnlR,
    m15Atr: trade.m15Atr ?? 0,
    outcome,
  };

  history.unshift(record);
  saveSignalsHistoryToDisk(history);
}

function computeBacktestPeriod(signals: StoredSignalRecord[], days: number): BacktestPeriodMetrics {
  const cutoffMs = Date.now() - days * 86400000;
  const filtered = signals.filter((s) => new Date(s.closedAt).getTime() >= cutoffMs);

  if (filtered.length === 0) {
    return {
      days,
      tradesCount: 0,
      winsCount: 0,
      lossesCount: 0,
      beCount: 0,
      winRatePct: null, // Dash until real data exists
      netR: null,
      totalPnlDollars: null,
      profitFactor: null,
    };
  }

  let wins = 0;
  let losses = 0;
  let be = 0;
  let netR = 0;
  let totalPnl = 0;
  let grossWinDollars = 0;
  let grossLossDollars = 0;

  for (const s of filtered) {
    netR += s.pnlR;
    totalPnl += s.pnlDollars;

    if (s.outcome === 'WIN') {
      wins++;
      grossWinDollars += Math.max(0, s.pnlDollars);
    } else if (s.outcome === 'LOSS') {
      losses++;
      grossLossDollars += Math.abs(Math.min(0, s.pnlDollars));
    } else {
      be++;
    }
  }

  const winRatePct = Number(((wins / (wins + losses || 1)) * 100).toFixed(1));
  const profitFactor =
    grossLossDollars > 0
      ? Number((grossWinDollars / grossLossDollars).toFixed(2))
      : grossWinDollars > 0
        ? 99.9
        : null;

  return {
    days,
    tradesCount: filtered.length,
    winsCount: wins,
    lossesCount: losses,
    beCount: be,
    winRatePct,
    netR: Number(netR.toFixed(2)),
    totalPnlDollars: Number(totalPnl.toFixed(2)),
    profitFactor,
  };
}

export function getBacktestState(): BacktestStatePayload {
  const signals = loadSignalsHistoryFromDisk();
  const candleStore = getCandleStore();

  const candlesM5 = candleStore.M5?.length || 0;
  const candlesM15 = candleStore.M15?.length || 0;
  const candlesH1 = candleStore.H1?.length || 0;
  const storedDaysCountH1 = countStoredH1TradingDays();

  const d30 = computeBacktestPeriod(signals, 30);
  const d60 = computeBacktestPeriod(signals, 60);
  const d90 = computeBacktestPeriod(signals, 90);

  const rules: BacktestRulesMetadata = {
    gates: [
      {
        id: 1,
        name: 'Zone Integrity',
        rule: 'Not broken and at most 3 tests, or the first retest after a break.',
      },
      {
        id: 2,
        name: 'Reaction Wick',
        rule: 'The touching candle has a rejection wick of at least 30% of its range against the zone.',
      },
      {
        id: 3,
        name: 'Close Confirmation',
        rule: 'Touching candle closed outside the zone, is one of the last 2 closed candles, and live price is still outside.',
      },
      {
        id: 4,
        name: 'Room to Run',
        rule: 'The next opposing zone is at least $17.00 away from the entry price.',
      },
    ],
    fixedPlan: {
      stopLoss: 'max(1.5 x ATR14(M15), zone width + 0.25 x ATR14(M15))',
      tp1: '1.0R (triggers Stop Loss move to Entry / Breakeven)',
      tp2: '1.7R',
      tp3: '2.5R (capped $0.50 before the next zone if closer)',
      positionSplits: 'Position split evenly in thirds (1/3 off at each TP)',
      beRule: 'After TP1 is hit, stop loss moves unconditionally to breakeven',
    },
    limits: {
      maxTradesPerDay: 4,
      maxTradesPerLevelPerDay: 2,
      maxStoppedTradesPerDay: 3,
      postExitClearanceDistance: '$8.00 clearance away from level required to unblock',
      newsPauseWindow: 'Signals paused from 30m before to 15m after HIGH impact events',
    },
  };

  return {
    d30,
    d60,
    d90,
    totalTradesStored: signals.length,
    tradeLog: signals.slice(0, 50),
    rules,
    candlesCountM5: candlesM5,
    candlesCountM15: candlesM15,
    candlesCountH1: candlesH1,
    storedDaysCountH1,
  };
}
