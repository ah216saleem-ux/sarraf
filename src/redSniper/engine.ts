import {
  Candle,
  RedSniperBarsMap,
  RedSniperTimeframe,
  RED_SNIPER_TIMEFRAMES,
} from './feed';
import { findPivots } from '../fireZone/engineCore';
import type { Candle as FireZoneCandle, PivotLevel } from '../fireZone/types';

export const RED_SNIPER_ZONE_ENGINE_VERSION = 'zones-v3';

export type ZoneSide = 'BUY' | 'SELL';
export type ZoneStatus = 'FRESH' | 'TESTED' | 'DEEP';
export type ZoneMode = 'WICK' | 'BODY';
export type RetestMode = 'CANDLE' | 'ATR' | 'TOUCH_CANDLES';
export type StructureKind = 'BOS' | 'CHoCH';
export type TfBias = 'BULL' | 'BEAR' | 'NEUT';
export type ZoneDroppedReason =
  | 'kept'
  | 'cap'
  | 'overlap'
  | 'far'
  | 'consumed'
  | 'dead:closeBeyond';

export interface RedSniperSettings {
  maxZonesPerTf: number; // 3-8, default 6 (3 nearest SELL + 3 nearest BUY)
  zoneMode: ZoneMode; // 'WICK' | 'BODY', default 'WICK'
  retestMode: RetestMode; // 'CANDLE' | 'ATR' | 'TOUCH_CANDLES'
  retestModeOverride: boolean; // false = AUTO per-TF default (ATR away-gated)
  retestGapAtr: number; // 0.1-0.75, default 0.25
  heightCapAtr: number; // 0.5-3.0, default 1.2
  deadAtr: number; // 0.0-1.0, default 0.25
  farAtr: number; // 10-60, default 25
  slBuffer: number; // $1-$3, default $1.5
  maxRiskPoints: number; // default $15 (0 = off)
  minPowerToTrade: number; // default 50
  trailTrigger: number; // $1-$2, default $2.0
  trailStep: number; // $1-$3, default $1.5
  riskPct: number; // default 1.5
  showBosChoch: boolean; // default false
  showFarZones: boolean; // default false
  showConsumedZones: boolean; // default false (hide pctLeft=0 or 3+ retests from chart, list, and bot)
  weightScore: number; // default 0.40
  weightVolume: number; // default 0.25
  weightFreshness: number; // default 0.20
  weightHtf: number; // default 0.15
}

export const RED_SNIPER_SETTINGS_STORAGE_KEY = 'redSniperSettings.v3';

export const DEFAULT_RED_SNIPER_SETTINGS: RedSniperSettings = {
  maxZonesPerTf: 6,
  zoneMode: 'WICK',
  retestMode: 'ATR',
  retestModeOverride: false,
  retestGapAtr: 0.25,
  heightCapAtr: 1.2,
  deadAtr: 0.25,
  farAtr: 25,
  slBuffer: 1.5,
  maxRiskPoints: 15,
  minPowerToTrade: 50,
  trailTrigger: 2.0,
  trailStep: 1.5,
  riskPct: 1.5,
  showBosChoch: false,
  showFarZones: false,
  showConsumedZones: false,
  weightScore: 0.4,
  weightVolume: 0.25,
  weightFreshness: 0.2,
  weightHtf: 0.15,
};

export const PIVOT_LENGTH_BY_TF: Record<RedSniperTimeframe, number> = {
  '1m': 10,
  '3m': 10,
  '5m': 10,
  '15m': 8,
  '30m': 8,
  '1h': 5,
  '4h': 5,
  '1d': 3,
};

export function getPivotLengthForTf(tf: RedSniperTimeframe): number {
  return PIVOT_LENGTH_BY_TF[tf] ?? 5;
}

export const MINOR_PIVOT_LENGTH_BY_TF: Record<RedSniperTimeframe, number> = {
  '1m': 3,
  '3m': 3,
  '5m': 3,
  '15m': 3,
  '30m': 3,
  '1h': 2,
  '4h': 2,
  '1d': 2,
};

export function getMinorPivotLengthForTf(tf: RedSniperTimeframe): number {
  return MINOR_PIVOT_LENGTH_BY_TF[tf] ?? 3;
}

export const LOOKBACK_BY_TF: Record<RedSniperTimeframe, number> = {
  '1m': 300,
  '3m': 300,
  '5m': 300,
  '15m': 250,
  '30m': 250,
  '1h': 200,
  '4h': 200,
  '1d': 200,
};

export function getLookbackForTf(tf: RedSniperTimeframe): number {
  return LOOKBACK_BY_TF[tf] ?? 200;
}

export const TF_ORDER_RANK: Record<RedSniperTimeframe, number> = {
  '1m': 1,
  '3m': 2,
  '5m': 3,
  '15m': 4,
  '30m': 5,
  '1h': 6,
  '4h': 7,
  '1d': 8,
};

export interface ZoneDebugCounts {
  pivotsFound: number;
  confirmedPivots: number;
  deadCount: number;
  consumedHidden: number;
  overlapDropped: number;
  selectedBuy: number;
  selectedSell: number;
}

export interface StructureEvent {
  id: string;
  tf: RedSniperTimeframe;
  dir: 'BULL' | 'BEAR';
  kind: StructureKind;
  pivotIdx: number;
  pivotTime: number;
  price: number;
  breakIdx: number;
  breakTime: number;
}

export interface RawBaseZone {
  tf: RedSniperTimeframe;
  supply: boolean;
  time: number;
  startIdx: number;
  endIdx: number;
  top: number;
  bottom: number;
  untrimmedTop: number;
  untrimmedBottom: number;
  trimmed: boolean;
  weak: boolean;
  minor?: boolean;
  bosConfirmed?: boolean;
  dep: number;
  baseN: number;
  tests: number;
  independentRetests: number;
  touchCandles: number;
  pctLeft: number;
  consumed?: boolean;
  sweep: boolean;
  entryConfirmed?: boolean;
  pivotAtr?: number;
  state: ZoneStatus;
  score: number;
  overlapPct?: number;
  overlapDecision?: string;
  farDecision?: string;
  dead?: boolean;
  deadCandleTime?: number;
  deadBeyondAtr?: number;
  droppedReason?: ZoneDroppedReason;
}

export interface FindZonesOptions {
  depMult?: number;
  maxBase?: number;
  minH?: number;
  mode?: ZoneMode;
  maxZones?: number;
  retestMode?: RetestMode;
  retestGapAtr?: number;
  retestTolAtr?: number;
  heightCapAtr?: number;
  deadAtr?: number;
  farAtr?: number;
  enableWeakRetry?: boolean;
  showConsumedZones?: boolean;
  formingCandleIncluded?: boolean;
  livePrice?: number | null;
}

export interface ZoneDebugEntry {
  top: number;
  bottom: number;
  height: number;
  side: ZoneSide;
  state: ZoneStatus;
  time: number;
  retests: number;
  independentRetests: number;
  touchCandles: number;
  pctLeft: number;
  consumed: boolean;
  score: number;
  power: number;
  trimmed: boolean;
  weak: boolean;
  minor?: boolean;
  bosConfirmed?: boolean;
  sweep: boolean;
  distancePts: number;
  distanceAtr: number;
  isFar: boolean;
  overlapPct: number;
  overlapDecision: string;
  farDecision: string;
  reasonDropped: ZoneDroppedReason;
  deadCandleTime?: number;
  deadBeyondAtr?: number;
}

export interface RedSniperZone {
  id: string;
  tf: RedSniperTimeframe;
  side: ZoneSide; // 'BUY' | 'SELL'
  supply: boolean;
  top: number; // HI
  bottom: number; // LO
  anchor: number; // midpoint (top + bottom) / 2
  proximal: number; // edge nearest price (bottom for SELL, top for BUY)
  distal: number; // far edge (top for SELL, bottom for BUY)
  width: number; // top - bottom
  time: number; // pivot candle time (c[startIdx].time)
  startIdx: number;
  endIdx: number;
  baseN: number;
  retests: number;
  independentRetests: number;
  touchCandles: number;
  touches: number;
  pctLeft: number;
  consumed: boolean;
  sweep: boolean;
  entryConfirmed?: boolean;
  isAPlus?: boolean;
  confluenceTfs?: RedSniperTimeframe[];
  trimmed: boolean;
  weak: boolean;
  minor?: boolean;
  bosConfirmed?: boolean;
  isFar: boolean;
  distancePts: number;
  status: ZoneStatus;
  score: number;
  power: number;
  departureAtr: number;
  volMult: number | null;
  htfOk: boolean;
  htfLabel: 'HTF ok' | 'HTF 1/2' | 'HTF against';
  breakdown: string;
  chartLabel: string;
  atr14: number;
}

export interface MergedRedSniperZone extends RedSniperZone {
  mergedTfs: RedSniperTimeframe[];
}

export interface TimeframeAnalysis {
  tf: RedSniperTimeframe;
  barsLoaded: number;
  atr14: number;
  ema20: number | null;
  ema50: number | null;
  bias: TfBias;
  retestModeUsed: RetestMode;
  structures: StructureEvent[];
  zones: RedSniperZone[]; // Selected non-consumed zones for this TF (max 3 SELL + 3 BUY)
  chartZones: RedSniperZone[]; // Selected non-consumed zones for chart
  debugAliveZones: ZoneDebugEntry[]; // All alive zones (including consumed) BEFORE selection + dead:closeBeyond entries
  debugCounts: ZoneDebugCounts;
}

export interface VerdictResult {
  bias30m: TfBias;
  bias1h: TfBias;
  bias4h: TfBias;
  bias1d: TfBias;
  score: number;
  banner:
    | 'BUY THE DIP - DO NOT CHASE'
    | 'SELL THE RALLY - DO NOT CHASE'
    | 'BULLISH LEAN - ZONES ONLY'
    | 'BEARISH LEAN - ZONES ONLY'
    | 'RANGE - WAIT FOR ZONE REACTION';
  tone: 'BULL' | 'BEAR' | 'NEUT';
}

export interface OpenSniperTrade {
  id: string;
  zoneId: string;
  tf: RedSniperTimeframe;
  side: 'BUY' | 'SELL';
  openTime: number; // ms
  session: string;
  power: number;
  entry: number;
  initialSl: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp3IsLiquidity: boolean;
  riskPoints: number;
  initialLots: number;
  remPct: number; // 1.0 -> 0.5 -> 0.2
  tp1Hit: boolean;
  tp2Hit: boolean;
  beMoved: boolean;
  trailRef?: number;
  isTrailing?: boolean;
  realizedPnl: number;
  realizedR: number;
}

export interface ClosedSniperTrade {
  id: string;
  zoneId: string;
  time: number; // close time ms
  tf: RedSniperTimeframe;
  side: 'BUY' | 'SELL';
  entry: number;
  exit: number;
  pnl: number;
  r: number;
  result:
    | 'TP3'
    | 'TP2+TRAIL'
    | 'TP2+BE'
    | 'TP1+TRAIL'
    | 'TP1+BE'
    | 'SL'
    | 'MANUAL';
  session: string;
  power: number;
  class: 'win' | 'be' | 'loss';
}

export interface RedSniperDemoState {
  balance: number;
  autoEnabled: boolean;
  openTrades: OpenSniperTrade[];
  closedTrades: ClosedSniperTrade[];
  usedZoneIds: string[];
}

export interface PendingTradePlan {
  zone: RedSniperZone;
  side: 'BUY' | 'SELL';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp3IsLiquidity: boolean;
  riskPoints: number;
  lots: number;
  distance: number;
  insideZone: boolean;
  htfBlocked: boolean;
  maxRiskSkipped: boolean;
}

export interface PerformanceMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  beCount: number;
  tp2WinRatePct: number;
  bePct: number;
  lossPct: number;
  expectancyR: number;
  sessionR: Record<'TOKYO' | 'LONDON' | 'NEW YORK' | 'LDN+NY', number>;
  confidenceLabel:
    | 'SMALL SAMPLE - NOT RELIABLE'
    | 'LOW SAMPLE'
    | 'NEGATIVE'
    | 'NEUTRAL'
    | 'GOOD'
    | 'STRONG'
    | 'ELITE';
  confidencePct: number;
  windowSeconds: number | null;
  isReliableSample: boolean;
  summaryStatusLabel: string;
}

export type BotLogEventType =
  | 'ENTRY'
  | 'TP1_BE'
  | 'TP2'
  | 'TP2_PARTIAL'
  | 'TP3'
  | 'TRAIL_MOVE'
  | 'EXIT'
  | 'SKIPPED_TRADE'
  | 'BOT_PAUSED'
  | 'BOT_RESUMED'
  | 'ZONE_NEW'
  | 'ZONE_NEAR'
  | 'ZONE_DEAD'
  | 'ZONE_DETECTED';

export type BotLogCategory = 'trade' | 'zone';

export function isTradeLogType(type: string): boolean {
  return [
    'ENTRY',
    'TP1_BE',
    'TP2',
    'TP2_PARTIAL',
    'TP3',
    'TRAIL_MOVE',
    'EXIT',
    'SKIPPED_TRADE',
    'BOT_PAUSED',
    'BOT_RESUMED',
  ].includes(type);
}

export function isZoneLogType(type: string): boolean {
  return ['ZONE_NEW', 'ZONE_NEAR', 'ZONE_DEAD', 'ZONE_DETECTED'].includes(type);
}

export interface BotLogEntry {
  id: string;
  ts: number; // ms
  isoTime: string;
  type: BotLogEventType;
  category?: BotLogCategory;
  tf?: RedSniperTimeframe;
  side?: 'BUY' | 'SELL';
  zoneId?: string;
  tradeId?: string;
  message: string;
  details?: Record<string, any>;
}

export const RED_SNIPER_DEMO_STORAGE_KEY = 'redSniperDemo';
export const RED_SNIPER_BOT_LOG_STORAGE_KEY = 'redSniperBotLog.v2';
export const RED_SNIPER_TRADE_LOG_STORAGE_KEY = 'redSniperTradeLog.v2';
export const RED_SNIPER_ZONE_LOG_STORAGE_KEY = 'redSniperZoneLog.v2';

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Helper for independent retest calculation (away-gated by retestGapAtr * ATR).
 */
export function resolveIndependentRetestModeForTf(
  _tf: RedSniperTimeframe
): 'CANDLE' | 'ATR' {
  return 'ATR';
}

/**
 * Default retest mode across all timeframes uses ATR-based away gap (retestGapAtr * ATR)
 * so 1H/4H/1D do not count every touching candle as a separate test.
 */
export function resolveDefaultRetestModeForTf(_tf: RedSniperTimeframe): RetestMode {
  return 'ATR';
}

/**
 * STATE LABEL rule everywhere (chart, list, debug JSON):
 * - FRESH = 0 retests
 * - TESTED = retests >= 1 and pctLeft >= 60 (and retests < 3)
 * - DEEP = pctLeft < 60 or retests >= 3
 * A zone with 0% left or 3 retests must never print TESTED.
 */
export function resolveZoneStatus(retests: number, pctLeft: number): ZoneStatus {
  if (retests <= 0) return 'FRESH';
  if (pctLeft < 60 || retests >= 3) return 'DEEP';
  return 'TESTED';
}

/**
 * Trade entry confirmation on closed candle (Rule 9):
 * Sweep into the zone then a close back inside or outside the proximal edge (not on a plain touch).
 */
export function isZoneEntryConfirmed(
  zone: Pick<RedSniperZone, 'side' | 'bottom' | 'top'>,
  candle: Pick<Candle, 'open' | 'high' | 'low' | 'close'>
): boolean {
  if (zone.side === 'SELL') {
    return (
      candle.high > zone.bottom &&
      candle.close <= zone.top &&
      (candle.close <= zone.bottom || candle.high > candle.close)
    );
  }
  return (
    candle.low < zone.top &&
    candle.close >= zone.bottom &&
    (candle.close >= zone.top || candle.low < candle.close)
  );
}

export function sanitizeRedSniperSettings(
  raw?: Partial<RedSniperSettings> | null
): RedSniperSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_RED_SNIPER_SETTINGS };
  }
  return {
    maxZonesPerTf:
      typeof raw.maxZonesPerTf === 'number' && Number.isFinite(raw.maxZonesPerTf)
        ? clamp(Math.round(raw.maxZonesPerTf), 3, 8)
        : DEFAULT_RED_SNIPER_SETTINGS.maxZonesPerTf,
    zoneMode:
      raw.zoneMode === 'WICK' || raw.zoneMode === 'BODY'
        ? raw.zoneMode
        : DEFAULT_RED_SNIPER_SETTINGS.zoneMode,
    retestMode:
      raw.retestMode === 'CANDLE' ||
      raw.retestMode === 'ATR' ||
      raw.retestMode === 'TOUCH_CANDLES'
        ? raw.retestMode
        : DEFAULT_RED_SNIPER_SETTINGS.retestMode,
    retestModeOverride:
      typeof raw.retestModeOverride === 'boolean'
        ? raw.retestModeOverride
        : DEFAULT_RED_SNIPER_SETTINGS.retestModeOverride,
    retestGapAtr:
      typeof raw.retestGapAtr === 'number' && Number.isFinite(raw.retestGapAtr)
        ? Number(clamp(raw.retestGapAtr, 0.1, 0.75).toFixed(2))
        : DEFAULT_RED_SNIPER_SETTINGS.retestGapAtr,
    heightCapAtr:
      typeof raw.heightCapAtr === 'number' && Number.isFinite(raw.heightCapAtr)
        ? Number(clamp(raw.heightCapAtr, 0.5, 3.0).toFixed(2))
        : DEFAULT_RED_SNIPER_SETTINGS.heightCapAtr,
    deadAtr:
      typeof raw.deadAtr === 'number' && Number.isFinite(raw.deadAtr)
        ? Number(clamp(raw.deadAtr, 0.0, 1.0).toFixed(2))
        : DEFAULT_RED_SNIPER_SETTINGS.deadAtr,
    farAtr:
      typeof raw.farAtr === 'number' && Number.isFinite(raw.farAtr)
        ? clamp(Math.round(raw.farAtr), 10, 60)
        : DEFAULT_RED_SNIPER_SETTINGS.farAtr,
    slBuffer:
      typeof raw.slBuffer === 'number' && Number.isFinite(raw.slBuffer)
        ? Number(clamp(raw.slBuffer, 1.0, 3.0).toFixed(2))
        : DEFAULT_RED_SNIPER_SETTINGS.slBuffer,
    maxRiskPoints:
      typeof raw.maxRiskPoints === 'number' && Number.isFinite(raw.maxRiskPoints)
        ? Number(clamp(raw.maxRiskPoints, 0, 100).toFixed(1))
        : DEFAULT_RED_SNIPER_SETTINGS.maxRiskPoints,
    minPowerToTrade:
      typeof raw.minPowerToTrade === 'number' &&
      Number.isFinite(raw.minPowerToTrade)
        ? clamp(Math.round(raw.minPowerToTrade), 0, 99)
        : DEFAULT_RED_SNIPER_SETTINGS.minPowerToTrade,
    trailTrigger:
      typeof raw.trailTrigger === 'number' && Number.isFinite(raw.trailTrigger)
        ? Number(clamp(raw.trailTrigger, 1.0, 2.0).toFixed(2))
        : DEFAULT_RED_SNIPER_SETTINGS.trailTrigger,
    trailStep:
      typeof raw.trailStep === 'number' && Number.isFinite(raw.trailStep)
        ? Number(clamp(raw.trailStep, 1.0, 3.0).toFixed(2))
        : DEFAULT_RED_SNIPER_SETTINGS.trailStep,
    riskPct:
      typeof raw.riskPct === 'number' && Number.isFinite(raw.riskPct)
        ? Number(clamp(raw.riskPct, 0.25, 10.0).toFixed(2))
        : DEFAULT_RED_SNIPER_SETTINGS.riskPct,
    showBosChoch:
      typeof raw.showBosChoch === 'boolean'
        ? raw.showBosChoch
        : DEFAULT_RED_SNIPER_SETTINGS.showBosChoch,
    showFarZones:
      typeof raw.showFarZones === 'boolean'
        ? raw.showFarZones
        : DEFAULT_RED_SNIPER_SETTINGS.showFarZones,
    showConsumedZones:
      typeof raw.showConsumedZones === 'boolean'
        ? raw.showConsumedZones
        : DEFAULT_RED_SNIPER_SETTINGS.showConsumedZones,
    weightScore:
      typeof raw.weightScore === 'number' && Number.isFinite(raw.weightScore)
        ? Number(clamp(raw.weightScore, 0.05, 0.9).toFixed(2))
        : DEFAULT_RED_SNIPER_SETTINGS.weightScore,
    weightVolume:
      typeof raw.weightVolume === 'number' && Number.isFinite(raw.weightVolume)
        ? Number(clamp(raw.weightVolume, 0.0, 0.9).toFixed(2))
        : DEFAULT_RED_SNIPER_SETTINGS.weightVolume,
    weightFreshness:
      typeof raw.weightFreshness === 'number' &&
      Number.isFinite(raw.weightFreshness)
        ? Number(clamp(raw.weightFreshness, 0.05, 0.9).toFixed(2))
        : DEFAULT_RED_SNIPER_SETTINGS.weightFreshness,
    weightHtf:
      typeof raw.weightHtf === 'number' && Number.isFinite(raw.weightHtf)
        ? Number(clamp(raw.weightHtf, 0.0, 0.9).toFixed(2))
        : DEFAULT_RED_SNIPER_SETTINGS.weightHtf,
  };
}

export function loadRedSniperSettings(): RedSniperSettings {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_RED_SNIPER_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(RED_SNIPER_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RED_SNIPER_SETTINGS };
    return sanitizeRedSniperSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_RED_SNIPER_SETTINGS };
  }
}

export function saveRedSniperSettings(settings: RedSniperSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      RED_SNIPER_SETTINGS_STORAGE_KEY,
      JSON.stringify(sanitizeRedSniperSettings(settings))
    );
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Wilder's 14-bar ATR series with session gaps and news spikes over 3xATR capped.
 */
export function atrSeries(
  c: Array<Pick<Candle, 'high' | 'low' | 'close'>>,
  n: number = 14
): number[] {
  if (!c || c.length === 0) return [];
  const a: number[] = new Array(c.length);
  let runningAtr = Math.max(0.05, c[0].high - c[0].low);
  a[0] = runningAtr;

  let seedSum = runningAtr;
  for (let i = 1; i < c.length; i++) {
    const rawTr = Math.max(
      c[i].high - c[i].low,
      Math.abs(c[i].high - c[i - 1].close),
      Math.abs(c[i].low - c[i - 1].close)
    );
    // Cap gaps and news spikes exceeding 3x prior ATR
    const cappedTr = runningAtr > 0 ? Math.min(rawTr, 3.0 * runningAtr) : rawTr;

    if (i < n) {
      seedSum += cappedTr;
      runningAtr = seedSum / (i + 1);
    } else {
      runningAtr = (runningAtr * (n - 1) + cappedTr) / n;
    }
    a[i] = runningAtr;
  }
  return a;
}

/**
 * Swing-pivot based zone candidate scanner on CLOSED candles only:
 * 1. Origin = swing pivot using findPivots (primary L: 1m/3m/5m = 10, 15m/30m = 8, 1H/4H = 5, 1D = 3;
 *    fill pass L = round(L/2) tagged minor=true).
 *    Pivot high -> SELL zone, pivot low -> BUY zone.
 * 2. BOS/CHoCH rule: kept as a ranking bonus (+2 score). Primary pass requires BOS confirmation;
 *    fill pass allows unconfirmed pivots to fill empty slots up to 3 per side.
 * 3. Box = pivot candle: SELL from body-top to high, BUY from low to body-bottom.
 *    Height clamped to 0.5 - 1.2 x ATR (ATR measured at pivot time, Wilder, gaps > 3xATR capped).
 * 4. Lifecycle on CLOSED candles only:
 *    - Dead when a close is beyond the distal edge by > deadAtr x ATR.
 *    - A wick into the zone = retest, counted only after price moved away by retestGapAtr x ATR.
 *    - Near-consumed: pctLeft < 15 or retests >= 3 is marked consumed = true.
 * 5. Lookback per TF: 1m-5m = 300, 15m-30m = 250, 1H-4H-1D = 200 closed candles.
 */
function scanCandidatesPass(
  closedBars: Array<Pick<Candle, 'time' | 'open' | 'high' | 'low' | 'close'>>,
  tf: RedSniperTimeframe,
  A: number[],
  params: {
    depMult: number;
    maxBase: number;
    minH: number;
    mode: ZoneMode;
    retestMode: RetestMode;
    retestGapAtr: number;
    retestTolAtr: number;
    heightCapAtr: number;
    deadAtr: number;
    weak: boolean;
    minor?: boolean;
    pivotLengthOverride?: number;
    requireBosConfirm?: boolean;
  }
): {
  alive: RawBaseZone[];
  dead: RawBaseZone[];
  pivotsFound: number;
  confirmedPivots: number;
} {
  const n = closedBars.length;
  if (n < 5) {
    return { alive: [], dead: [], pivotsFound: 0, confirmedPivots: 0 };
  }

  const targetL = params.pivotLengthOverride ?? getPivotLengthForTf(tf);
  // Use exact target pivot length whenever enough bars exist; adapt gracefully for tiny unit-test arrays
  const effectiveL =
    n >= 2 * targetL + 3
      ? targetL
      : Math.max(1, Math.min(targetL, Math.floor((n - 3) / 3)));

  const fzCandles: FireZoneCandle[] = closedBars.map((b) => ({
    time: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: 1,
  }));

  const rawPivots = findPivots(fzCandles, effectiveL as PivotLevel);
  const minorL = Math.max(1, Math.floor(effectiveL / 2));
  const minorPivots =
    minorL < effectiveL ? findPivots(fzCandles, minorL as PivotLevel) : rawPivots;

  // Per-TF lookback: 1m-5m = 300, 15m-30m = 250, 1H-4H-1D = 200 closed candles
  const lookbackBars = getLookbackForTf(tf);
  const minPivotIdx = Math.max(0, n - lookbackBars);

  const alive: RawBaseZone[] = [];
  const deadList: RawBaseZone[] = [];
  let pivotsFound = 0;
  let confirmedPivots = 0;
  const requireBos = params.requireBosConfirm ?? true;
  const isMinorPass = Boolean(params.minor ?? params.weak);

  for (const pivot of rawPivots) {
    const pIdx = pivot.index;
    if (pIdx < minPivotIdx || pIdx >= n - 1) continue;
    pivotsFound++;

    const supply = pivot.type === 'HIGH';
    const pBar = closedBars[pIdx];
    const pivotAtr = Math.max(0.1, A[pIdx] || 2.0);

    // Find previous opposite pivot for BOS/CHoCH confirmation check
    let oppLevelPrice: number | null = null;
    for (let m = minorPivots.length - 1; m >= 0; m--) {
      const mp = minorPivots[m];
      if (mp.index < pIdx && mp.type === (supply ? 'LOW' : 'HIGH')) {
        oppLevelPrice = mp.price;
        break;
      }
    }
    if (oppLevelPrice === null) {
      for (let m = rawPivots.length - 1; m >= 0; m--) {
        const rp = rawPivots[m];
        if (rp.index < pIdx && rp.type === (supply ? 'LOW' : 'HIGH')) {
          oppLevelPrice = rp.price;
          break;
        }
      }
    }
    if (oppLevelPrice === null) {
      const lookStart = Math.max(0, pIdx - effectiveL);
      if (pIdx > lookStart) {
        let ext = supply ? Infinity : -Infinity;
        for (let k = lookStart; k < pIdx; k++) {
          if (supply) ext = Math.min(ext, closedBars[k].low);
          else ext = Math.max(ext, closedBars[k].high);
        }
        if (Number.isFinite(ext)) oppLevelPrice = ext;
      }
    }

    let confirmIdx = -1;
    let maxMove = 0;
    for (let k = pIdx + 1; k < n; k++) {
      const xk = closedBars[k];
      const ak = A[k] || pivotAtr;
      const moveFromPivot = supply
        ? pBar.high - xk.low
        : xk.high - pBar.low;
      if (moveFromPivot > maxMove) maxMove = moveFromPivot;

      const invalidatedBeforeConfirm = supply
        ? xk.close > pBar.high + params.deadAtr * ak
        : xk.close < pBar.low - params.deadAtr * ak;
      if (invalidatedBeforeConfirm && confirmIdx === -1) {
        break;
      }

      if (oppLevelPrice !== null) {
        const brokeOppositeClose = supply
          ? xk.close < oppLevelPrice
          : xk.close > oppLevelPrice;
        if (brokeOppositeClose) {
          confirmIdx = k;
          break;
        }
      }
    }

    const bosConfirmed = confirmIdx !== -1;
    if (bosConfirmed) {
      confirmedPivots++;
    }

    // BOS rule: keep as ranking bonus (+score). Unconfirmed pivots may be used ONLY in the fill pass.
    if (requireBos && !bosConfirmed) {
      continue;
    }

    // 3) Box = pivot candle: SELL from body-top to high, BUY from low to body-bottom.
    // Height clamped to 0.5 - 1.2 x ATR (ATR measured at pivot time, Wilder, gaps > 3xATR capped).
    const bodyTop = Math.max(pBar.open, pBar.close);
    const bodyBot = Math.min(pBar.open, pBar.close);

    const untrimmedTop = Number(
      (supply ? pBar.high : params.mode === 'BODY' ? bodyTop : bodyBot).toFixed(2)
    );
    const untrimmedBottom = Number(
      (supply ? (params.mode === 'BODY' ? bodyBot : bodyTop) : pBar.low).toFixed(2)
    );

    const rawHeight = Math.max(0, untrimmedTop - untrimmedBottom);
    // Minor zones keep their raw height floor (params.minH) so noise minor wicks < 0.5xATR are not inflated
    const minClampedH = isMinorPass
      ? params.minH
      : Math.max(params.minH, 0.5 * pivotAtr);
    const maxCapMult = clamp(params.heightCapAtr || 1.2, 0.5, 1.2);
    const maxClampedH = Math.max(minClampedH, maxCapMult * pivotAtr);

    const trimmed = rawHeight > maxClampedH + 1e-6;
    const finalHeight = clamp(rawHeight, minClampedH, maxClampedH);

    let boxTop: number;
    let boxBottom: number;
    if (supply) {
      boxTop = Number(pBar.high.toFixed(2));
      boxBottom = Number((pBar.high - finalHeight).toFixed(2));
    } else {
      boxBottom = Number(pBar.low.toFixed(2));
      boxTop = Number((pBar.low + finalHeight).toFixed(2));
    }

    // Measure displacement (departure ATR) away from the zone after the pivot
    let impulseMove = 0;
    for (let k = pIdx + 1; k < n; k++) {
      const m = supply ? boxBottom - closedBars[k].low : closedBars[k].high - boxTop;
      if (m > impulseMove) impulseMove = m;
    }
    const depAtr = Number(Math.max(0, impulseMove / pivotAtr).toFixed(2));

    // 4) Lifecycle on CLOSED candles only:
    // - Zone is dead when a close is beyond the distal edge by > deadAtr x ATR.
    // - A wick into the zone = retest, counted ONLY after price moved away by retestGapAtr x ATR.
    const h = Math.max(0.01, boxTop - boxBottom);
    let independentRetests = 0;
    let touchCandles = 0;
    let pen = 0;
    let dead = false;
    let deadCandleTime: number | undefined;
    let deadBeyondAtr: number | undefined;
    let sweep = false;
    let entryConfirmed = false;

    let away = false;

    for (let k = pIdx + 1; k < n; k++) {
      const x = closedBars[k];
      const ak = Math.max(0.1, A[k] || pivotAtr);

      // Dead rule: ONLY a close beyond distal edge by > deadAtr * ATR kills the zone
      const beyondDistal = supply ? x.close - boxTop : boxBottom - x.close;
      if (beyondDistal > params.deadAtr * ak) {
        dead = true;
        deadCandleTime = x.time;
        deadBeyondAtr = Number((beyondDistal / ak).toFixed(2));
        break;
      }

      const gapReq =
        params.retestMode === 'CANDLE' ? 0 : params.retestGapAtr * ak;
      const closedOutside = supply ? x.close < boxBottom : x.close > boxTop;
      const distFromProximal = supply ? boxBottom - x.low : x.high - boxTop;
      const movedAwayEnough = closedOutside && distFromProximal >= gapReq;

      const tol =
        params.retestTolAtr > 0 ? params.retestTolAtr * ak : 0;
      const rawTouchBox = supply
        ? x.high >= boxBottom && x.low <= boxTop
        : x.low <= boxTop && x.high >= boxBottom;
      const wickIntoZone = supply
        ? x.high >= boxBottom - tol && x.low <= boxTop
        : x.low <= boxTop + tol && x.high >= boxBottom;

      if (away) {
        if (wickIntoZone) {
          independentRetests++;
          touchCandles++;
          away = false;

          const isSweepCandle = supply
            ? x.high > boxTop && x.close <= boxTop
            : x.low < boxBottom && x.close >= boxBottom;
          if (isSweepCandle) {
            sweep = true;
          }

          const bodyEdge = supply
            ? Math.max(x.open, x.close)
            : Math.min(x.open, x.close);
          const isSingleRejectionSweep =
            isSweepCandle &&
            independentRetests === 1 &&
            (supply ? bodyEdge < boxTop : bodyEdge > boxBottom);

          const rawPen = isSingleRejectionSweep
            ? clamp(
                supply
                  ? (bodyEdge - boxBottom) / h
                  : (boxTop - bodyEdge) / h,
                0.05,
                0.85
              )
            : supply
            ? (x.high - boxBottom) / h
            : (boxTop - x.low) / h;
          pen = Math.max(pen, clamp(rawPen, 0.01, 1));

          if (
            isZoneEntryConfirmed(
              { side: supply ? 'SELL' : 'BUY', bottom: boxBottom, top: boxTop },
              x
            )
          ) {
            entryConfirmed = true;
          }
        }
      } else {
        // Still departing or inside an active retest visit
        if (independentRetests > 0 && rawTouchBox) {
          touchCandles++;
          const isSweepCandle = supply
            ? x.high > boxTop && x.close <= boxTop
            : x.low < boxBottom && x.close >= boxBottom;
          if (isSweepCandle) {
            sweep = true;
          }

          const bodyEdge = supply
            ? Math.max(x.open, x.close)
            : Math.min(x.open, x.close);
          const isSingleRejectionSweep =
            isSweepCandle &&
            independentRetests === 1 &&
            touchCandles === 1 &&
            (supply ? bodyEdge < boxTop : bodyEdge > boxBottom);

          const rawPen = isSingleRejectionSweep
            ? clamp(
                supply
                  ? (bodyEdge - boxBottom) / h
                  : (boxTop - bodyEdge) / h,
                0.05,
                0.85
              )
            : supply
            ? (x.high - boxBottom) / h
            : (boxTop - x.low) / h;
          pen = Math.max(pen, clamp(rawPen, 0.01, 1));

          if (
            isZoneEntryConfirmed(
              { side: supply ? 'SELL' : 'BUY', bottom: boxBottom, top: boxTop },
              x
            )
          ) {
            entryConfirmed = true;
          }
        }

        if (movedAwayEnough && (!rawTouchBox || independentRetests === 0)) {
          away = true;
        }
      }
    }

    const activeTests =
      params.retestMode === 'TOUCH_CANDLES' ? touchCandles : independentRetests;

    const pctLeft =
      activeTests === 0
        ? 100
        : Math.min(99, Math.max(0, Math.round(100 * (1 - pen))));
    // Issue 2: Hide from chart, list, and bot any zone with pctLeft < 15 or retests >= 3 (keep in debugAliveZones as 'consumed')
    const consumed = pctLeft < 15 || activeTests >= 3;
    const state = resolveZoneStatus(activeTests, pctLeft);
    // BOS rule: ranking bonus (+2 score when bosConfirmed, +0 when unconfirmed in fill pass)
    const bosBonus = bosConfirmed ? 2 : 0;
    const score =
      (depAtr >= 3 ? 4 : depAtr >= 2 ? 3 : 2) +
      (activeTests === 0 ? 4 : activeTests === 1 ? 2 : activeTests === 2 ? 1 : 0) +
      bosBonus;

    const z: RawBaseZone = {
      tf,
      supply,
      time: pBar.time,
      startIdx: pIdx,
      endIdx: pIdx,
      top: boxTop,
      bottom: boxBottom,
      untrimmedTop,
      untrimmedBottom,
      trimmed,
      weak: isMinorPass,
      minor: isMinorPass,
      bosConfirmed,
      dep: depAtr,
      baseN: 1,
      tests: activeTests,
      independentRetests,
      touchCandles,
      pctLeft,
      consumed,
      sweep,
      entryConfirmed,
      pivotAtr,
      state,
      score,
    };

    if (dead) {
      z.dead = true;
      z.deadCandleTime = deadCandleTime;
      z.deadBeyondAtr = deadBeyondAtr;
      z.droppedReason = 'dead:closeBeyond';
      deadList.push(z);
    } else {
      alive.push(z);
    }
  }

  return { alive, dead: deadList, pivotsFound, confirmedPivots };
}

/**
 * Compute overlap ratio of two zones relative to the SMALLER zone's height.
 */
export function computeSameSideOverlapRatio(
  a: Pick<RawBaseZone, 'bottom' | 'top'>,
  b: Pick<RawBaseZone, 'bottom' | 'top'>
): number {
  const interTop = Math.min(a.top, b.top);
  const interBot = Math.max(a.bottom, b.bottom);
  const interH = Math.max(0, interTop - interBot);
  if (interH <= 0) return 0;
  const minH = Math.max(0.01, Math.min(a.top - a.bottom, b.top - b.bottom));
  return interH / minH;
}

/**
 * Returns true if two zones overlap in price (same-side OR BUY/SELL).
 */
export function doZonesOverlap(
  a: Pick<RawBaseZone, 'bottom' | 'top'>,
  b: Pick<RawBaseZone, 'bottom' | 'top'>
): boolean {
  return Math.min(a.top, b.top) >= Math.max(a.bottom, b.bottom) - 1e-6;
}

interface CachedZoneAuditResult {
  selected: RawBaseZone[];
  allAliveBeforeSelection: RawBaseZone[];
  deadBeforeSelection: RawBaseZone[];
  retestModeUsed: RetestMode;
  atr14: number;
  closedRefPrice: number;
  debugCounts: ZoneDebugCounts;
}

const zoneAuditCache = new Map<string, CachedZoneAuditResult>();
let zoneCacheHits = 0;
let zoneCacheMisses = 0;

export function getZoneCacheStats(): {
  hits: number;
  misses: number;
  size: number;
} {
  return {
    hits: zoneCacheHits,
    misses: zoneCacheMisses,
    size: zoneAuditCache.size,
  };
}

export function resetZoneCacheStats(): void {
  zoneAuditCache.clear();
  tfAnalysisCache.clear();
  zoneCacheHits = 0;
  zoneCacheMisses = 0;
}

function computeClosedBarsSignature(
  closedBars: Array<Pick<Candle, 'time' | 'open' | 'high' | 'low' | 'close'>>
): string {
  const n = closedBars.length;
  if (n === 0) return '0';
  const last = closedBars[n - 1];
  let hSum = 0;
  let lSum = 0;
  let cSum = 0;
  for (let i = 0; i < n; i++) {
    const b = closedBars[i];
    hSum += b.high;
    lSum += b.low;
    cSum += b.close;
  }
  return `${n}:${last.time}:${hSum.toFixed(2)}:${lSum.toFixed(2)}:${cSum.toFixed(2)}`;
}

function computeZoneSettingsHash(S: {
  depMult: number;
  maxBase: number;
  minH: number;
  mode: ZoneMode;
  maxZones: number;
  retestMode: RetestMode;
  retestGapAtr: number;
  retestTolAtr: number;
  heightCapAtr: number;
  deadAtr: number;
  farAtr: number;
  enableWeakRetry: boolean;
  showConsumedZones: boolean;
  formingCandleIncluded: boolean;
}): string {
  return `${S.mode}|${S.maxZones}|${S.retestMode}|${S.retestGapAtr}|${S.retestTolAtr}|${S.heightCapAtr}|${S.deadAtr}|${S.farAtr}|${S.enableWeakRetry ? 1 : 0}|${S.showConsumedZones ? 1 : 0}|${S.formingCandleIncluded ? 1 : 0}|${S.depMult}|${S.maxBase}|${S.minH}`;
}

/**
 * Full zone detection + cross-side overlap removal + 3+3 selection pipeline on CLOSED candles.
 * - Lookback: 1m-5m 300, 15m-30m 250, 1H-4H-1D 200 closed candles.
 * - Primary pass uses TF pivot length L with BOS confirmation.
 * - Minor pass (L = 3 for 1m-5m, 3 for 15m-30m, 2 for 1H+): always runs so recent swings
 *   from the last 10 candles can form zones.
 *   A minor zone may win the nearest slot ONLY if:
 *     height >= 0.5 * ATR AND displacement >= 1.0 * ATR after the pivot AND pctLeft >= 50.
 *   Otherwise it can only fill remaining slots (< 3 per side).
 * - Results are cached per (tf, lastClosedCandleTime, settingsHash) so live ticks never rescan.
 */
export function findZonesWithAudit(
  c: Array<Pick<Candle, 'time' | 'open' | 'high' | 'low' | 'close'>>,
  tf: RedSniperTimeframe,
  o: FindZonesOptions = {}
): {
  selected: RawBaseZone[];
  allAliveBeforeSelection: RawBaseZone[];
  deadBeforeSelection: RawBaseZone[];
  retestModeUsed: RetestMode;
  atr14: number;
  livePrice: number;
  debugCounts: ZoneDebugCounts;
} {
  const defaultRetestMode = resolveDefaultRetestModeForTf(tf);
  const S = {
    depMult: o.depMult ?? 1.5,
    maxBase: o.maxBase ?? 1,
    minH: o.minH ?? 0.3,
    mode: o.mode ?? ('WICK' as ZoneMode),
    maxZones: o.maxZones ?? 6,
    retestMode: o.retestMode ?? defaultRetestMode,
    retestGapAtr: o.retestGapAtr ?? 0.25,
    retestTolAtr: o.retestTolAtr ?? 0.1,
    heightCapAtr: o.heightCapAtr ?? 1.2,
    deadAtr: o.deadAtr ?? 0.25,
    farAtr: clamp(o.farAtr ?? 25, 10, 60),
    // Default true so the minor pivot pass (L=3 for 1m-30m, L=2 for 1H+) always runs
    enableWeakRetry: o.enableWeakRetry ?? true,
    showConsumedZones: o.showConsumedZones ?? false,
    formingCandleIncluded: o.formingCandleIncluded ?? true,
  };

  const totalBars = c ? c.length : 0;
  if (totalBars < 5) {
    return {
      selected: [],
      allAliveBeforeSelection: [],
      deadBeforeSelection: [],
      retestModeUsed: S.retestMode,
      atr14: 2.0,
      livePrice: totalBars > 0 ? c[totalBars - 1].close : 0,
      debugCounts: {
        pivotsFound: 0,
        confirmedPivots: 0,
        deadCount: 0,
        consumedHidden: 0,
        overlapDropped: 0,
        selectedBuy: 0,
        selectedSell: 0,
      },
    };
  }

  // When formingCandleIncluded is true (default), ignore the forming (last) candle so zones never repaint intra-bar.
  // When formingCandleIncluded is false (e.g. replay passing closed-only bars), keep all passed bars.
  const closedBars =
    S.formingCandleIncluded && totalBars > 1 ? c.slice(0, totalBars - 1) : c;
  const closedN = closedBars.length;
  const closedRefPrice = closedBars[closedN - 1].close;
  const lastClosedCandleTime = closedBars[closedN - 1].time;
  const px =
    typeof o.livePrice === 'number' && Number.isFinite(o.livePrice) && o.livePrice > 0
      ? o.livePrice
      : closedRefPrice;

  const settingsHash = computeZoneSettingsHash(S);
  const closedSig = computeClosedBarsSignature(closedBars);
  const cacheKey = `${tf}::${lastClosedCandleTime}::${settingsHash}::${closedSig}`;

  const cached = zoneAuditCache.get(cacheKey);
  if (cached) {
    zoneCacheHits++;
    return {
      selected: cached.selected,
      allAliveBeforeSelection: cached.allAliveBeforeSelection,
      deadBeforeSelection: cached.deadBeforeSelection,
      retestModeUsed: cached.retestModeUsed,
      atr14: cached.atr14,
      livePrice: px,
      debugCounts: cached.debugCounts,
    };
  }
  zoneCacheMisses++;

  const A = atrSeries(closedBars);
  const atr14 = Math.max(0.1, A[closedN - 1] || 2.0);

  const getDist = (z: RawBaseZone): number => {
    if (closedRefPrice >= z.bottom && closedRefPrice <= z.top) return 0;
    return closedRefPrice < z.bottom
      ? z.bottom - closedRefPrice
      : closedRefPrice - z.top;
  };

  const primaryL = getPivotLengthForTf(tf);
  const pass1 = scanCandidatesPass(closedBars, tf, A, {
    ...S,
    weak: false,
    minor: false,
    pivotLengthOverride: primaryL,
    requireBosConfirm: true,
  });

  // Filter to valid side relative to closed reference price (SELL above price, BUY below price)
  const sideValidPass1 = pass1.alive.filter((z) =>
    z.supply ? z.top >= closedRefPrice : z.bottom <= closedRefPrice
  );

  // Issue 2: Hide zones with pctLeft < 15 or retests >= 3 from chart, list and bot (still in debugAliveZones as 'consumed')
  const allAlive: RawBaseZone[] = [];
  const nonConsumedPass1: RawBaseZone[] = [];
  let consumedHiddenCount = 0;
  let overlapDroppedCount = 0;

  for (const z of sideValidPass1) {
    const isConsumed = Boolean(z.consumed || z.pctLeft < 15 || z.tests >= 3);
    z.consumed = isConsumed;
    if (isConsumed && !S.showConsumedZones) {
      consumedHiddenCount++;
      allAlive.push({
        ...z,
        overlapPct: 0,
        overlapDecision: 'dropped:consumed',
        droppedReason: 'consumed',
      });
    } else {
      nonConsumedPass1.push(z);
    }
  }

  // Sort primary candidates by freshness (fewer retests, higher pctLeft), higher score, and recency
  nonConsumedPass1.sort((a, b) => {
    if (a.tests !== b.tests) return a.tests - b.tests;
    if (b.pctLeft !== a.pctLeft) return b.pctLeft - a.pctLeft;
    if (b.score !== a.score) return b.score - a.score;
    return b.time - a.time;
  });

  const dedupedAlive: RawBaseZone[] = [];

  for (const z of nonConsumedPass1) {
    let maxOverlapRatio = 0;
    let overlapsExisting = false;
    for (const orig of dedupedAlive) {
      if (doZonesOverlap(orig, z)) {
        overlapsExisting = true;
        const ratio = Math.max(0.01, computeSameSideOverlapRatio(orig, z));
        if (ratio > maxOverlapRatio) maxOverlapRatio = ratio;
      }
    }
    const overlapPct = Math.max(overlapsExisting ? 1 : 0, Math.round(maxOverlapRatio * 100));
    if (overlapsExisting) {
      overlapDroppedCount++;
      allAlive.push({
        ...z,
        overlapPct,
        overlapDecision: `dropped:overlap(${overlapPct}%)`,
        droppedReason: 'overlap',
      });
    } else {
      const copy: RawBaseZone = {
        ...z,
        overlapPct: 0,
        overlapDecision: 'kept:no-overlap',
        droppedReason: 'kept',
      };
      dedupedAlive.push(copy);
      allAlive.push(copy);
    }
  }

  const maxPerSideSell = Math.min(3, Math.ceil(S.maxZones / 2));
  const maxPerSideBuy = Math.min(3, Math.floor(S.maxZones / 2));

  const fillDeadZones: RawBaseZone[] = [];

  // Always run the minor pass (L = 3 for 1m-5m, 3 for 15m-30m, 2 for 1H+) when enableWeakRetry is true
  // so swings from the last 10 candles can form zones for the nearest slot on each side and fill empty slots (< 3 per side).
  if (S.enableWeakRetry) {
    const minorL = getMinorPivotLengthForTf(tf);
    const pass2Minor = scanCandidatesPass(closedBars, tf, A, {
      ...S,
      weak: true,
      minor: true,
      pivotLengthOverride: minorL,
      requireBosConfirm: false,
    });
    fillDeadZones.push(...pass2Minor.dead);

    const halfL = Math.max(1, Math.round(primaryL / 2));
    const pass2Half =
      halfL !== minorL
        ? scanCandidatesPass(closedBars, tf, A, {
            ...S,
            weak: true,
            minor: true,
            pivotLengthOverride: halfL,
            requireBosConfirm: false,
          })
        : { alive: [] as RawBaseZone[], dead: [] as RawBaseZone[] };
    fillDeadZones.push(...pass2Half.dead);

    const seenFillIdxs = new Set<string>(
      allAlive.map((z) => `${z.supply ? 'S' : 'B'}-${z.startIdx}`)
    );

    const fillRawPool: RawBaseZone[] = [];
    for (const fz of [...pass2Minor.alive, ...pass2Half.alive]) {
      const key = `${fz.supply ? 'S' : 'B'}-${fz.startIdx}`;
      if (seenFillIdxs.has(key)) continue;
      seenFillIdxs.add(key);

      // Only consider candidates on the valid side of price
      const sideOk = fz.supply
        ? fz.top >= closedRefPrice
        : fz.bottom <= closedRefPrice;
      if (!sideOk) continue;

      const isConsumed = Boolean(fz.consumed || fz.pctLeft < 15 || fz.tests >= 3);
      fz.consumed = isConsumed;
      if (isConsumed && !S.showConsumedZones) {
        consumedHiddenCount++;
        allAlive.push({
          ...fz,
          overlapPct: 0,
          overlapDecision: 'dropped:consumed',
          droppedReason: 'consumed',
        });
        continue;
      }
      fillRawPool.push(fz);
    }

    // Rank minor candidates: closer to price first (so last-10-candles swings win nearest slot), then BOS-confirmed, fresher, higher score
    fillRawPool.sort((a, b) => {
      const distDiff = getDist(a) - getDist(b);
      if (Math.abs(distDiff) > 1e-6) return distDiff;
      if (Boolean(b.bosConfirmed) !== Boolean(a.bosConfirmed)) {
        return b.bosConfirmed ? 1 : -1;
      }
      if (a.tests !== b.tests) return a.tests - b.tests;
      if (b.pctLeft !== a.pctLeft) return b.pctLeft - a.pctLeft;
      return b.score - a.score;
    });

    for (const fz of fillRawPool) {
      let maxOverlapRatio = 0;
      let overlapsExisting = false;
      for (const orig of dedupedAlive) {
        if (doZonesOverlap(orig, fz)) {
          overlapsExisting = true;
          const ratio = Math.max(0.01, computeSameSideOverlapRatio(orig, fz));
          if (ratio > maxOverlapRatio) maxOverlapRatio = ratio;
        }
      }
      const overlapPct = Math.max(
        overlapsExisting ? 1 : 0,
        Math.round(maxOverlapRatio * 100)
      );
      if (overlapsExisting) {
        overlapDroppedCount++;
        allAlive.push({
          ...fz,
          overlapPct,
          overlapDecision: `dropped:overlap(${overlapPct}%)`,
          droppedReason: 'overlap',
        });
      } else {
        const copy: RawBaseZone = {
          ...fz,
          weak: true,
          minor: true,
          overlapPct: 0,
          overlapDecision: 'kept:no-overlap(minor-fill)',
          droppedReason: 'kept',
        };
        dedupedAlive.push(copy);
        allAlive.push(copy);
      }
    }
  }

  // Selection per timeframe: up to 3 SELL above price + 3 BUY below price.
  // - Nearest slot on each side: a minor zone (L=3 / L=2) may win the nearest slot ONLY if:
  //     height >= 0.5 * ATR AND price moved away from it by >= 1.0 * ATR after the pivot (displacement) AND pctLeft >= 50.
  //   Otherwise it can only fill remaining slots.
  // - Remaining slots on each side (up to 3 total): prefer primary (!minor) before minor fill, near before far, nearest distance, higher score.
  const farThreshold = S.farAtr * atr14;

  const isMinorEligibleForNearestSlot = (z: RawBaseZone): boolean => {
    if (!z.minor) return true;
    const refAtr = Math.max(0.1, z.pivotAtr || atr14);
    const height = z.top - z.bottom;
    const rawHeight = z.untrimmedTop - z.untrimmedBottom;
    const heightOk =
      height >= 0.5 * refAtr - 1e-6 && rawHeight >= 0.5 * refAtr - 1e-6;
    const dispOk = z.dep >= 1.0 - 1e-6;
    const pctOk = z.pctLeft >= 50;
    return heightOk && dispOk && pctOk;
  };

  const rankForSideSelection = (a: RawBaseZone, b: RawBaseZone): number => {
    const aMinor = Boolean(a.minor);
    const bMinor = Boolean(b.minor);
    if (aMinor !== bMinor) return aMinor ? 1 : -1;

    const aFar = getDist(a) > farThreshold;
    const bFar = getDist(b) > farThreshold;
    if (aFar !== bFar) return aFar ? 1 : -1;

    const distDiff = getDist(a) - getDist(b);
    if (Math.abs(distDiff) > 1e-6) return distDiff;
    if (b.score !== a.score) return b.score - a.score;
    return b.time - a.time;
  };

  const rankByNearest = (a: RawBaseZone, b: RawBaseZone): number => {
    const aFar = getDist(a) > farThreshold;
    const bFar = getDist(b) > farThreshold;
    if (aFar !== bFar) return aFar ? 1 : -1;
    const distDiff = getDist(a) - getDist(b);
    if (Math.abs(distDiff) > 1e-6) return distDiff;
    const aMinor = Boolean(a.minor);
    const bMinor = Boolean(b.minor);
    if (aMinor !== bMinor) return aMinor ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    return b.time - a.time;
  };

  const selectSideZones = (
    candidates: RawBaseZone[],
    maxCount: number
  ): RawBaseZone[] => {
    if (candidates.length === 0 || maxCount <= 0) return [];
    const eligibleForNearest = candidates
      .filter(isMinorEligibleForNearestSlot)
      .sort(rankByNearest);

    const picked: RawBaseZone[] = [];
    if (eligibleForNearest.length > 0) {
      picked.push(eligibleForNearest[0]);
    }

    const remaining = candidates
      .filter((z) => z !== picked[0])
      .sort(rankForSideSelection);

    for (const z of remaining) {
      if (picked.length >= maxCount) break;
      picked.push(z);
    }
    return picked;
  };

  const sellCandidates = dedupedAlive.filter((z) => z.supply);
  const buyCandidates = dedupedAlive.filter((z) => !z.supply);

  const keptSells = selectSideZones(sellCandidates, maxPerSideSell);
  const keptBuys = selectSideZones(buyCandidates, maxPerSideBuy);

  const keptSet = new Set<RawBaseZone>([...keptSells, ...keptBuys]);

  for (const z of allAlive) {
    const dist = getDist(z);
    z.farDecision =
      dist > farThreshold
        ? `FAR (>${S.farAtr}xATR)`
        : `NEAR (<=${S.farAtr}xATR)`;
  }

  for (const z of dedupedAlive) {
    if (keptSet.has(z)) {
      z.droppedReason = 'kept';
    } else {
      z.droppedReason = 'cap';
    }
  }

  // Include dead zones from both primary and minor/fill passes (deduplicated by side + pivot index)
  const seenDeadIdxs = new Set<string>();
  const combinedDead: RawBaseZone[] = [];
  for (const dz of [...pass1.dead, ...fillDeadZones]) {
    const key = `${dz.supply ? 'S' : 'B'}-${dz.startIdx}`;
    if (seenDeadIdxs.has(key)) continue;
    seenDeadIdxs.add(key);
    combinedDead.push(dz);
  }

  const sideValidDead = combinedDead.sort((a, b) => b.top - a.top);
  for (const dz of sideValidDead) {
    const dist = getDist(dz);
    dz.overlapPct = 0;
    dz.overlapDecision = 'n/a:dead';
    dz.farDecision =
      dist > farThreshold
        ? `FAR (>${S.farAtr}xATR)`
        : `NEAR (<=${S.farAtr}xATR)`;
  }

  const selected = Array.from(keptSet).sort((a, b) => b.top - a.top);
  allAlive.sort((a, b) => b.top - a.top);

  const debugCounts: ZoneDebugCounts = {
    pivotsFound: pass1.pivotsFound,
    confirmedPivots: pass1.confirmedPivots,
    deadCount: sideValidDead.length,
    consumedHidden: consumedHiddenCount,
    overlapDropped: overlapDroppedCount,
    selectedBuy: keptBuys.length,
    selectedSell: keptSells.length,
  };

  if (zoneAuditCache.size > 64) {
    const oldestKey = zoneAuditCache.keys().next().value;
    if (oldestKey) zoneAuditCache.delete(oldestKey);
  }
  zoneAuditCache.set(cacheKey, {
    selected,
    allAliveBeforeSelection: allAlive,
    deadBeforeSelection: sideValidDead,
    retestModeUsed: S.retestMode,
    atr14,
    closedRefPrice,
    debugCounts,
  });

  return {
    selected,
    allAliveBeforeSelection: allAlive,
    deadBeforeSelection: sideValidDead,
    retestModeUsed: S.retestMode,
    atr14,
    livePrice: px,
    debugCounts,
  };
}

export function findZones(
  c: Array<Pick<Candle, 'time' | 'open' | 'high' | 'low' | 'close'>>,
  tf: RedSniperTimeframe,
  o: FindZonesOptions = {}
): RawBaseZone[] {
  return findZonesWithAudit(c, tf, o).selected;
}

export function computeEmaSeries(closes: number[], period: number): number[] {
  if (closes.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = new Array(closes.length);
  let ema = closes[0];
  out[0] = ema;
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

export function computeTfBias(bars: Candle[]): {
  bias: TfBias;
  ema20: number | null;
  ema50: number | null;
} {
  if (!bars || bars.length < 20) {
    return { bias: 'NEUT', ema20: null, ema50: null };
  }
  // Use closed candles (exclude forming candle if > 20) for stable bias
  const closed = bars.length > 20 ? bars.slice(0, bars.length - 1) : bars;
  const closes = closed.map((b) => b.close);
  const ema20Arr = computeEmaSeries(closes, 20);
  const ema50Arr = computeEmaSeries(closes, 50);
  const lastIdx = closed.length - 1;
  const close = closes[lastIdx];
  const ema20 = ema20Arr[lastIdx];
  const ema50 = ema50Arr[lastIdx];

  if (ema20 > ema50 && close > ema50) {
    return { bias: 'BULL', ema20, ema50 };
  }
  if (ema20 < ema50 && close < ema50) {
    return { bias: 'BEAR', ema20, ema50 };
  }
  return { bias: 'NEUT', ema20, ema50 };
}

export function computeMultiTimeframeVerdict(
  barsMap: RedSniperBarsMap
): VerdictResult {
  const b30m = computeTfBias(barsMap['30m']).bias;
  const b1h = computeTfBias(barsMap['1h']).bias;
  const b4h = computeTfBias(barsMap['4h']).bias;
  const b1d = computeTfBias(barsMap['1d']).bias;

  const toVal = (b: TfBias): number =>
    b === 'BULL' ? 1 : b === 'BEAR' ? -1 : 0;

  const score =
    toVal(b1d) * 2 +
    toVal(b4h) * 1.5 +
    toVal(b1h) * 1 +
    toVal(b30m) * 0.5;

  let banner: VerdictResult['banner'] = 'RANGE - WAIT FOR ZONE REACTION';
  let tone: VerdictResult['tone'] = 'NEUT';

  if (score >= 3) {
    banner = 'BUY THE DIP - DO NOT CHASE';
    tone = 'BULL';
  } else if (score <= -3) {
    banner = 'SELL THE RALLY - DO NOT CHASE';
    tone = 'BEAR';
  } else if (score >= 1) {
    banner = 'BULLISH LEAN - ZONES ONLY';
    tone = 'BULL';
  } else if (score <= -1) {
    banner = 'BEARISH LEAN - ZONES ONLY';
    tone = 'BEAR';
  }

  return {
    bias30m: b30m,
    bias1h: b1h,
    bias4h: b4h,
    bias1d: b1d,
    score,
    banner,
    tone,
  };
}

/**
 * Compute relative tickVolume on the zone base + leg-out candles vs the 20-bar average.
 * Returns null if tickVolume is missing for any bar in the base+leg-out window or if the 20-bar avg has no valid volume.
 */
export function computeBaseAndLegRelativeTickVolume(
  bars: Array<Pick<Candle, 'tickVolume'>>,
  startIdx: number,
  endIdx: number
): number | null {
  if (!bars || bars.length === 0) return null;
  if (startIdx < 0 || endIdx < startIdx || startIdx >= bars.length) return null;

  const legEnd = Math.min(bars.length - 1, endIdx + 3);
  let zoneVolSum = 0;
  let zoneVolCount = 0;

  for (let i = startIdx; i <= legEnd; i++) {
    const tv = bars[i]?.tickVolume;
    if (typeof tv !== 'number' || !Number.isFinite(tv) || tv <= 0) {
      return null;
    }
    zoneVolSum += tv;
    zoneVolCount++;
  }

  if (zoneVolCount === 0) return null;
  const zoneAvgVol = zoneVolSum / zoneVolCount;

  const baseStart = Math.max(0, startIdx - 20);
  const baseEnd = startIdx - 1;
  let avgSum = 0;
  let avgCount = 0;

  for (let j = baseStart; j <= baseEnd; j++) {
    const tv = bars[j]?.tickVolume;
    if (typeof tv === 'number' && Number.isFinite(tv) && tv > 0) {
      avgSum += tv;
      avgCount++;
    }
  }

  if (avgCount === 0 || avgSum <= 0) {
    return null;
  }

  const avg20 = avgSum / avgCount;
  return Number((zoneAvgVol / avg20).toFixed(1));
}

/**
 * POWER 0-99 = round(100 * (
 *   0.40 * (score/10 capped 1) +
 *   0.25 * relativeTickVolume (zone base + leg-out candles tickVolume vs 20-bar average, cap 2.5x) +
 *   0.20 * freshness (pctLeft/100) +
 *   0.15 * HTF alignment (1H and 4H EMA20/EMA50 agree with the zone side)
 * ))
 * If tickVolume is missing, drop that term (0.25) and re-normalize (0.40 + 0.20 + 0.15 = 0.75).
 */
export function computeZonePowerAndBreakdown(params: {
  side: ZoneSide;
  score: number;
  retests: number;
  pctLeft: number;
  departureAtr: number;
  volMult: number | null;
  bias1h: TfBias;
  bias4h: TfBias;
  weights?: {
    score?: number;
    volume?: number;
    freshness?: number;
    htf?: number;
  };
}): {
  power: number;
  htfOk: boolean;
  htfLabel: 'HTF ok' | 'HTF 1/2' | 'HTF against';
  breakdown: string;
} {
  const {
    side,
    score,
    retests,
    pctLeft,
    departureAtr,
    volMult,
    bias1h,
    bias4h,
    weights,
  } = params;

  const wScore = Math.max(0.01, weights?.score ?? 0.4);
  const wVol = Math.max(0, weights?.volume ?? 0.25);
  const wFresh = Math.max(0.01, weights?.freshness ?? 0.2);
  const wHtf = Math.max(0, weights?.htf ?? 0.15);

  const scoreNorm = clamp(score / 10, 0, 1);
  const freshnessNorm = clamp(pctLeft / 100, 0, 1);

  const targetBias: TfBias = side === 'SELL' ? 'BEAR' : 'BULL';
  const match1h = bias1h === targetBias;
  const match4h = bias4h === targetBias;
  const htfNorm = (match1h ? 0.5 : 0) + (match4h ? 0.5 : 0);
  const htfOk = match1h && match4h;
  const htfLabel: 'HTF ok' | 'HTF 1/2' | 'HTF against' = htfOk
    ? 'HTF ok'
    : match1h || match4h
    ? 'HTF 1/2'
    : 'HTF against';

  let weighted01: number;
  if (typeof volMult === 'number' && Number.isFinite(volMult) && volMult > 0) {
    const volNorm = clamp(volMult / 2.5, 0, 1);
    const totalW = Math.max(0.01, wScore + wVol + wFresh + wHtf);
    weighted01 =
      (wScore * scoreNorm +
        wVol * volNorm +
        wFresh * freshnessNorm +
        wHtf * htfNorm) /
      totalW;
  } else {
    const noVolW = Math.max(0.01, wScore + wFresh + wHtf);
    weighted01 =
      (wScore * scoreNorm + wFresh * freshnessNorm + wHtf * htfNorm) / noVolW;
  }

  const power = clamp(Math.round(100 * weighted01), 0, 99);
  const volPart =
    typeof volMult === 'number' && Number.isFinite(volMult) && volMult > 0
      ? `vol ${volMult.toFixed(1)}x`
      : 'vol --';
  const depVal = Number.isFinite(departureAtr) ? departureAtr : 0;
  const breakdown = `score ${score} · retests ${retests} · ${volPart} · dep ${depVal.toFixed(
    1
  )} ATR · ${htfLabel}`;

  return {
    power,
    htfOk,
    htfLabel,
    breakdown,
  };
}

export function computeStructureEvents(
  tf: RedSniperTimeframe,
  bars: Candle[]
): StructureEvent[] {
  const closed = bars && bars.length > 1 ? bars.slice(0, bars.length - 1) : bars || [];
  const n = closed.length;
  if (n < 15) return [];

  const pivotLen = getPivotLengthForTf(tf);
  const effLen = Math.min(pivotLen, Math.max(2, Math.floor((n - 3) / 3)));
  let lastHigh: { idx: number; time: number; price: number; broken: boolean } | null = null;
  let lastLow: { idx: number; time: number; price: number; broken: boolean } | null = null;
  let trend: 1 | -1 | 0 = 0;
  const events: StructureEvent[] = [];

  for (let i = effLen * 2; i < n; i++) {
    const pIdx = i - effLen;
    const pBar = closed[pIdx];
    let isHigh = true;
    let isLow = true;

    for (let k = pIdx - effLen; k <= pIdx + effLen; k++) {
      if (k === pIdx) continue;
      if (closed[k].high > pBar.high) isHigh = false;
      if (closed[k].low < pBar.low) isLow = false;
    }

    if (isHigh) {
      lastHigh = { idx: pIdx, time: pBar.time, price: pBar.high, broken: false };
    }
    if (isLow) {
      lastLow = { idx: pIdx, time: pBar.time, price: pBar.low, broken: false };
    }

    const bar = closed[i];
    if (lastHigh && !lastHigh.broken && bar.close > lastHigh.price) {
      const kind: StructureKind = trend === -1 ? 'CHoCH' : 'BOS';
      events.push({
        id: `${tf}-BULL-${lastHigh.time}-${bar.time}`,
        tf,
        dir: 'BULL',
        kind,
        pivotIdx: lastHigh.idx,
        pivotTime: lastHigh.time,
        price: lastHigh.price,
        breakIdx: i,
        breakTime: bar.time,
      });
      lastHigh.broken = true;
      trend = 1;
    } else if (lastLow && !lastLow.broken && bar.close < lastLow.price) {
      const kind: StructureKind = trend === 1 ? 'CHoCH' : 'BOS';
      events.push({
        id: `${tf}-BEAR-${lastLow.time}-${bar.time}`,
        tf,
        dir: 'BEAR',
        kind,
        pivotIdx: lastLow.idx,
        pivotTime: lastLow.time,
        price: lastLow.price,
        breakIdx: i,
        breakTime: bar.time,
      });
      lastLow.broken = true;
      trend = -1;
    }
  }

  return events.slice(-14);
}

export function getZoneDistancePts(
  zone: Pick<RedSniperZone, 'bottom' | 'top'>,
  livePrice: number
): number {
  if (livePrice >= zone.bottom && livePrice <= zone.top) return 0;
  if (livePrice < zone.bottom)
    return Number((zone.bottom - livePrice).toFixed(2));
  return Number((livePrice - zone.top).toFixed(2));
}

/**
 * FAR RULE: zones further than farAtr * ATR14 (default 25 * ATR14) are marked FAR,
 * hidden from chart boxes and from the bot, shown as edge markers.
 */
export function isZoneNear(
  zone: RedSniperZone,
  livePrice: number,
  farAtr: number = 25
): boolean {
  if (!Number.isFinite(livePrice) || livePrice <= 0) return true;
  return getZoneDistancePts(zone, livePrice) <= clamp(farAtr, 10, 60) * zone.atr14;
}

export function computeZoneProximityScore(
  zone: RedSniperZone,
  livePrice: number
): number {
  if (!Number.isFinite(livePrice) || livePrice <= 0) return zone.power;
  const dist = getZoneDistancePts(zone, livePrice);
  const scale = Math.max(1.5, zone.atr14 * 2);
  const proximity = 1 / (1 + dist / scale);
  return zone.power * proximity;
}

export function computeBoxOverlapRatio(
  a: Pick<RedSniperZone, 'bottom' | 'top'>,
  b: Pick<RedSniperZone, 'bottom' | 'top'>
): number {
  const interTop = Math.min(a.top, b.top);
  const interBot = Math.max(a.bottom, b.bottom);
  const interH = Math.max(0, interTop - interBot);
  if (interH <= 0) return 0;
  const widthA = Math.max(0.01, a.top - a.bottom);
  const widthB = Math.max(0.01, b.top - b.bottom);
  return interH / Math.min(widthA, widthB);
}

export function mergeOverlappingMultiTfZones(
  zones: RedSniperZone[]
): MergedRedSniperZone[] {
  const sorted = [...zones].sort(
    (a, b) => b.power - a.power || b.score - a.score
  );
  const merged: MergedRedSniperZone[] = [];

  for (const z of sorted) {
    const match = merged.find((m) => {
      if (m.side !== z.side) return false;
      const interTop = Math.min(m.top, z.top);
      const interBot = Math.max(m.bottom, z.bottom);
      const interH = Math.max(0, interTop - interBot);
      if (interH <= 0) return false;
      const wM = Math.max(0.01, m.top - m.bottom);
      const wZ = Math.max(0.01, z.top - z.bottom);
      const minRatio = interH / Math.min(wM, wZ);
      const maxRatio = interH / Math.max(wM, wZ);
      return minRatio > 0.7 && maxRatio > 0.5;
    });

    if (match) {
      if (!match.mergedTfs.includes(z.tf)) {
        match.mergedTfs.push(z.tf);
        match.mergedTfs.sort(
          (t1, t2) =>
            RED_SNIPER_TIMEFRAMES.indexOf(t1) -
            RED_SNIPER_TIMEFRAMES.indexOf(t2)
        );
      }
      if (z.sweep) match.sweep = true;
      if (z.trimmed) match.trimmed = true;
      if (z.isAPlus) match.isAPlus = true;
    } else {
      merged.push({
        ...z,
        mergedTfs: [z.tf],
      });
    }
  }

  return merged;
}

const A_PLUS_HTF_SET = new Set<RedSniperTimeframe>(['15m', '30m', '1h', '4h']);

/**
 * Apply multi-timeframe confluence (Issue 3):
 * Give "A+" ONLY when ALL are true:
 * - Same side overlap with a HIGHER timeframe zone (15m/30m/1H/4H, strictly higher than current TF)
 * - pctLeft >= 50
 * - retests <= 1
 * Power +6 only for A+ (capped at 99).
 */
export function applyMultiTimeframeConfluence(
  zone: RedSniperZone,
  htfZones: ReadonlyArray<Pick<RedSniperZone, 'tf' | 'side' | 'bottom' | 'top' | 'consumed' | 'pctLeft' | 'retests'>>
): RedSniperZone {
  if (!htfZones || htfZones.length === 0) return zone;
  if (zone.consumed || zone.pctLeft < 50 || zone.retests > 1) {
    return zone;
  }

  const currentRank = TF_ORDER_RANK[zone.tf] ?? 1;
  const matchingTfs: RedSniperTimeframe[] = [];

  for (const hz of htfZones) {
    if (!A_PLUS_HTF_SET.has(hz.tf)) continue;
    const htfRank = TF_ORDER_RANK[hz.tf] ?? 0;
    if (htfRank <= currentRank) continue; // must be strictly higher timeframe than zone.tf
    if (hz.side !== zone.side) continue; // must be same side
    if (hz.consumed || (typeof hz.pctLeft === 'number' && hz.pctLeft < 15) || (typeof hz.retests === 'number' && hz.retests >= 3)) {
      continue;
    }
    if (doZonesOverlap(zone, hz)) {
      if (!matchingTfs.includes(hz.tf)) {
        matchingTfs.push(hz.tf);
      }
    }
  }
  if (matchingTfs.length === 0) return zone;

  const boostedPower = clamp(zone.power + 6, 0, 99);
  const minorTag = zone.minor ? 'minor · ' : '';
  const chartLabel = `${zone.side} · A+ · ${minorTag}${zone.status} · PWR ${boostedPower} · ${zone.pctLeft}%`;
  const breakdown = zone.breakdown.includes('A+')
    ? zone.breakdown
    : `${zone.breakdown} · A+ (${matchingTfs.join('/')})`;

  return {
    ...zone,
    isAPlus: true,
    confluenceTfs: matchingTfs,
    power: boostedPower,
    chartLabel,
    breakdown,
  };
}

const tfAnalysisCache = new Map<string, TimeframeAnalysis>();

/**
 * Analyze a single timeframe strictly on its OWN CLOSED candles (never mutating the forming candle with livePrice).
 * Caches zone results per (tf, last closed candle time, settings hash) and only updates distancePts / isFar on live ticks.
 */
export function analyzeTimeframe(
  tf: RedSniperTimeframe,
  bars: Candle[],
  bias1h: TfBias,
  bias4h: TfBias,
  livePriceOverride?: number | null,
  settings: RedSniperSettings = DEFAULT_RED_SNIPER_SETTINGS,
  formingCandleIncluded: boolean = true
): TimeframeAnalysis {
  const effectiveRetestMode: RetestMode = settings.retestModeOverride
    ? settings.retestMode
    : resolveDefaultRetestModeForTf(tf);

  if (!bars || bars.length < 5) {
    const { bias, ema20, ema50 } = computeTfBias(bars);
    return {
      tf,
      barsLoaded: bars ? bars.length : 0,
      atr14: 2.0,
      ema20,
      ema50,
      bias,
      retestModeUsed: effectiveRetestMode,
      structures: [],
      zones: [],
      chartZones: [],
      debugAliveZones: [],
      debugCounts: {
        pivotsFound: 0,
        confirmedPivots: 0,
        deadCount: 0,
        consumedHidden: 0,
        overlapDropped: 0,
        selectedBuy: 0,
        selectedSell: 0,
      },
    };
  }

  // Do NOT inject livePriceOverride into the forming candle (prevents intra-bar flicker/repaint)
  const closedBars =
    formingCandleIncluded && bars.length > 1
      ? bars.slice(0, bars.length - 1)
      : bars;
  const closedN = closedBars.length;
  const closedRefPrice = closedBars[closedN - 1].close;
  const lastClosedCandleTime = closedBars[closedN - 1].time;
  const farAtr = clamp(settings.farAtr ?? 25, 10, 60);
  const px =
    typeof livePriceOverride === 'number' &&
    Number.isFinite(livePriceOverride) &&
    livePriceOverride > 0
      ? livePriceOverride
      : closedRefPrice;

  const volFirst = closedBars[0]?.tickVolume ?? 0;
  const volLast = closedBars[closedN - 1]?.tickVolume ?? 0;
  const tfSettingsHash = `${settings.zoneMode}|${settings.maxZonesPerTf}|${effectiveRetestMode}|${settings.retestGapAtr}|${settings.heightCapAtr}|${settings.deadAtr}|${farAtr}|${settings.showConsumedZones ? 1 : 0}|${formingCandleIncluded ? 1 : 0}|${settings.weightScore ?? 0.4}|${settings.weightVolume ?? 0.25}|${settings.weightFreshness ?? 0.2}|${settings.weightHtf ?? 0.15}|${bias1h}|${bias4h}|${volFirst}:${volLast}`;
  const closedSig = computeClosedBarsSignature(closedBars);
  const tfCacheKey = `${tf}::${lastClosedCandleTime}::${tfSettingsHash}::${closedSig}`;

  const cachedTf = tfAnalysisCache.get(tfCacheKey);
  if (cachedTf) {
    // Also touch findZonesWithAudit so zoneCacheHits increments consistently
    findZonesWithAudit(bars, tf, {
      mode: settings.zoneMode,
      maxZones: settings.maxZonesPerTf,
      retestMode: effectiveRetestMode,
      retestGapAtr: settings.retestGapAtr,
      heightCapAtr: settings.heightCapAtr,
      deadAtr: settings.deadAtr,
      farAtr,
      showConsumedZones: settings.showConsumedZones,
      formingCandleIncluded,
      livePrice: px,
    });

    const updateZoneForLivePx = (z: RedSniperZone): RedSniperZone => {
      const distancePts = getZoneDistancePts(z, px);
      const isFar = distancePts > farAtr * z.atr14;
      if (z.distancePts === distancePts && z.isFar === isFar) return z;
      return { ...z, distancePts, isFar };
    };

    const updatedZones = cachedTf.zones.map(updateZoneForLivePx);
    const updatedChartZones = [...updatedZones]
      .filter((z) => settings.showConsumedZones || (!z.consumed && z.pctLeft >= 15 && z.retests < 3))
      .sort((a, b) => a.distancePts - b.distancePts || b.power - a.power)
      .slice(0, clamp(settings.maxZonesPerTf ?? 6, 3, 8))
      .sort((a, b) => b.top - a.top);

    return {
      ...cachedTf,
      barsLoaded: bars.length,
      zones: updatedZones,
      chartZones: updatedChartZones,
    };
  }

  const { bias, ema20, ema50 } = computeTfBias(bars);
  const structures = computeStructureEvents(tf, bars);

  const audit = findZonesWithAudit(bars, tf, {
    mode: settings.zoneMode,
    maxZones: settings.maxZonesPerTf,
    retestMode: effectiveRetestMode,
    retestGapAtr: settings.retestGapAtr,
    heightCapAtr: settings.heightCapAtr,
    deadAtr: settings.deadAtr,
    farAtr,
    showConsumedZones: settings.showConsumedZones,
    formingCandleIncluded,
    livePrice: closedRefPrice,
  });

  const atr14 = Number(audit.atr14.toFixed(2));

  const toRedSniperZone = (rz: RawBaseZone): RedSniperZone => {
    const side: ZoneSide = rz.supply ? 'SELL' : 'BUY';
    const top = Number(rz.top.toFixed(2));
    const bottom = Number(rz.bottom.toFixed(2));
    const anchor = Number(((top + bottom) / 2).toFixed(2));
    const proximal = rz.supply ? bottom : top;
    const distal = rz.supply ? top : bottom;
    const width = Number((top - bottom).toFixed(2));
    const distancePts = getZoneDistancePts({ bottom, top }, px);
    const isFar = distancePts > farAtr * atr14;
    const status = resolveZoneStatus(rz.tests, rz.pctLeft);
    // Issue 2: Near-consumed (< 15% left or 3+ retests) is marked consumed
    const consumed = Boolean(rz.consumed || rz.pctLeft < 15 || rz.tests >= 3);
    const isMinor = Boolean(rz.minor || rz.weak);

    const volMult = computeBaseAndLegRelativeTickVolume(
      closedBars,
      rz.startIdx,
      rz.endIdx
    );

    const { power: rawPower, htfOk, htfLabel, breakdown: baseBreakdown } =
      computeZonePowerAndBreakdown({
        side,
        score: rz.score,
        retests: rz.tests,
        pctLeft: rz.pctLeft,
        departureAtr: rz.dep,
        volMult,
        bias1h,
        bias4h,
        weights: {
          score: settings.weightScore,
          volume: settings.weightVolume,
          freshness: settings.weightFreshness,
          htf: settings.weightHtf,
        },
      });

    // Issue 1: Minor fill zones get power -5 and "minor" tag
    const power = isMinor ? clamp(rawPower - 5, 1, 99) : rawPower;
    const breakdown = isMinor ? `${baseBreakdown} · minor` : baseBreakdown;
    const minorTag = isMinor ? 'minor · ' : '';
    const chartLabel = `${side} · ${minorTag}${status} · PWR ${power} · ${rz.pctLeft}%`;

    return {
      id: `${tf}-${side}-${rz.time}-${bottom.toFixed(2)}-${top.toFixed(2)}`,
      tf,
      side,
      supply: rz.supply,
      top,
      bottom,
      anchor,
      proximal,
      distal,
      width,
      time: rz.time,
      startIdx: rz.startIdx,
      endIdx: rz.endIdx,
      baseN: rz.baseN,
      retests: rz.tests,
      independentRetests: rz.independentRetests,
      touchCandles: rz.touchCandles,
      touches: rz.touchCandles,
      pctLeft: rz.pctLeft,
      consumed,
      sweep: rz.sweep,
      entryConfirmed: Boolean(rz.entryConfirmed),
      isAPlus: false,
      trimmed: rz.trimmed,
      weak: isMinor,
      minor: isMinor,
      bosConfirmed: rz.bosConfirmed,
      isFar,
      distancePts,
      status,
      score: rz.score,
      power,
      departureAtr: Number(rz.dep.toFixed(2)),
      volMult,
      htfOk,
      htfLabel,
      breakdown,
      chartLabel,
      atr14,
    };
  };

  // Issue 2: Hide zones with pctLeft < 15 or 3+ retests from chart, list and bot
  // Issue 1: Do not drop a zone only because it is far; far zones fill empty slots (dimmed)
  const zones: RedSniperZone[] = audit.selected
    .map(toRedSniperZone)
    .filter((z) => settings.showConsumedZones || (!z.consumed && z.pctLeft >= 15 && z.retests < 3));

  const chartZones = [...zones]
    .filter((z) => settings.showConsumedZones || (!z.consumed && z.pctLeft >= 15 && z.retests < 3))
    .sort((a, b) => a.distancePts - b.distancePts || b.power - a.power)
    .slice(0, clamp(settings.maxZonesPerTf ?? 6, 3, 8))
    .sort((a, b) => b.top - a.top);

  const aliveDebugEntries: ZoneDebugEntry[] = audit.allAliveBeforeSelection.map(
    (rz) => {
      const z = toRedSniperZone(rz);
      let reasonDropped: ZoneDroppedReason = rz.droppedReason ?? 'kept';
      if (reasonDropped === 'kept' && z.consumed && !settings.showConsumedZones) {
        reasonDropped = 'consumed';
      }
      const distAtr = Number((z.distancePts / Math.max(0.1, atr14)).toFixed(2));
      return {
        top: z.top,
        bottom: z.bottom,
        height: z.width,
        side: z.side,
        state: z.status,
        time: z.time,
        retests: z.retests,
        independentRetests: z.independentRetests,
        touchCandles: z.touchCandles,
        pctLeft: z.pctLeft,
        consumed: z.consumed,
        score: z.score,
        power: z.power,
        trimmed: z.trimmed,
        weak: z.weak,
        minor: z.minor,
        bosConfirmed: z.bosConfirmed,
        sweep: z.sweep,
        distancePts: z.distancePts,
        distanceAtr: distAtr,
        isFar: z.isFar,
        overlapPct: rz.overlapPct ?? 0,
        overlapDecision: rz.overlapDecision ?? 'kept:no-overlap',
        farDecision:
          rz.farDecision ??
          (z.isFar ? `FAR (>${farAtr}xATR)` : `NEAR (<=${farAtr}xATR)`),
        reasonDropped,
      };
    }
  );

  const deadDebugEntries: ZoneDebugEntry[] = audit.deadBeforeSelection.map(
    (rz) => {
      const z = toRedSniperZone(rz);
      const distAtr = Number((z.distancePts / Math.max(0.1, atr14)).toFixed(2));
      return {
        top: z.top,
        bottom: z.bottom,
        height: z.width,
        side: z.side,
        state: z.status,
        time: z.time,
        retests: z.retests,
        independentRetests: z.independentRetests,
        touchCandles: z.touchCandles,
        pctLeft: z.pctLeft,
        consumed: z.consumed,
        score: z.score,
        power: z.power,
        trimmed: z.trimmed,
        weak: z.weak,
        minor: z.minor,
        bosConfirmed: z.bosConfirmed,
        sweep: z.sweep,
        distancePts: z.distancePts,
        distanceAtr: distAtr,
        isFar: z.isFar,
        overlapPct: 0,
        overlapDecision: 'n/a:dead',
        farDecision: z.isFar ? `FAR (>${farAtr}xATR)` : `NEAR (<=${farAtr}xATR)`,
        reasonDropped: 'dead:closeBeyond',
        deadCandleTime: rz.deadCandleTime,
        deadBeyondAtr: rz.deadBeyondAtr,
      };
    }
  );

  const debugAliveZones: ZoneDebugEntry[] = [
    ...aliveDebugEntries,
    ...deadDebugEntries,
  ].sort((a, b) => b.top - a.top);

  const result: TimeframeAnalysis = {
    tf,
    barsLoaded: bars.length,
    atr14,
    ema20,
    ema50,
    bias,
    retestModeUsed: audit.retestModeUsed,
    structures,
    zones,
    chartZones,
    debugAliveZones,
    debugCounts: audit.debugCounts,
  };

  if (tfAnalysisCache.size > 64) {
    const oldestKey = tfAnalysisCache.keys().next().value;
    if (oldestKey) tfAnalysisCache.delete(oldestKey);
  }
  tfAnalysisCache.set(tfCacheKey, result);

  return result;
}

export interface DeadAtrDiffZone {
  range: string; // e.g. "4400.00-4410.00"
  bottom: number;
  top: number;
  side: ZoneSide;
  state: ZoneStatus;
  retests: number;
  independentRetests: number;
  touchCandles: number;
  pctLeft: number;
  consumed: boolean;
  overlapDecision: string;
}

export interface DeadAtrComparisonBucket {
  deadAtr: number;
  aliveCount: number; // total side-valid alive zones before selection
  aliveAfterOverlapCount: number; // alive zones after overlap rule
  aliveAtThisValueButDeadAt025: DeadAtrDiffZone[];
}

/**
 * DEAD-RULE COMPARISON TOOL (dev only, in the debug export):
 * For deadAtr in [0.25, 0.5, 0.75, 1.0] outputs the number of alive zones on the active timeframe
 * and the list of zones that are alive at that value but dead at 0.25 (LO-HI, side, retests, pctLeft).
 */
export function computeDeadAtrComparison(
  bars: Candle[],
  tf: RedSniperTimeframe,
  livePriceOverride?: number | null,
  settings: RedSniperSettings = DEFAULT_RED_SNIPER_SETTINGS
): DeadAtrComparisonBucket[] {
  if (!bars || bars.length < 5) {
    return [0.25, 0.5, 0.75, 1.0].map((d) => ({
      deadAtr: d,
      aliveCount: 0,
      aliveAfterOverlapCount: 0,
      aliveAtThisValueButDeadAt025: [],
    }));
  }

  const effectiveRetestMode: RetestMode = settings.retestModeOverride
    ? settings.retestMode
    : resolveDefaultRetestModeForTf(tf);

  const makeKey = (z: RawBaseZone): string =>
    `${z.supply ? 'SELL' : 'BUY'}-${z.startIdx}-${z.endIdx}-${z.bottom.toFixed(
      2
    )}-${z.top.toFixed(2)}`;

  const audit025 = findZonesWithAudit(bars, tf, {
    mode: settings.zoneMode,
    maxZones: settings.maxZonesPerTf,
    retestMode: effectiveRetestMode,
    retestGapAtr: settings.retestGapAtr,
    heightCapAtr: settings.heightCapAtr,
    deadAtr: 0.25,
    farAtr: settings.farAtr,
    showConsumedZones: true,
    livePrice: livePriceOverride,
  });
  const alive025Keys = new Set(audit025.allAliveBeforeSelection.map(makeKey));

  const thresholds = [0.25, 0.5, 0.75, 1.0];
  return thresholds.map((deadVal) => {
    const auditVal =
      deadVal === 0.25
        ? audit025
        : findZonesWithAudit(bars, tf, {
            mode: settings.zoneMode,
            maxZones: settings.maxZonesPerTf,
            retestMode: effectiveRetestMode,
            retestGapAtr: settings.retestGapAtr,
            heightCapAtr: settings.heightCapAtr,
            deadAtr: deadVal,
            farAtr: settings.farAtr,
            showConsumedZones: true,
            livePrice: livePriceOverride,
          });

    const aliveCount = auditVal.allAliveBeforeSelection.length;
    const aliveAfterOverlapCount = auditVal.allAliveBeforeSelection.filter(
      (z) => z.droppedReason !== 'overlap'
    ).length;

    const aliveAtThisValueButDeadAt025: DeadAtrDiffZone[] =
      deadVal === 0.25
        ? []
        : auditVal.allAliveBeforeSelection
            .filter((z) => !alive025Keys.has(makeKey(z)))
            .map((z) => ({
              range: `${z.bottom.toFixed(2)}-${z.top.toFixed(2)}`,
              bottom: z.bottom,
              top: z.top,
              side: z.supply ? 'SELL' : 'BUY',
              state: z.state,
              retests: z.tests,
              independentRetests: z.independentRetests,
              touchCandles: z.touchCandles,
              pctLeft: z.pctLeft,
              consumed: Boolean(z.consumed || z.pctLeft < 15 || z.tests >= 3),
              overlapDecision: z.overlapDecision ?? 'kept:no-overlap',
            }));

    return {
      deadAtr: deadVal,
      aliveCount,
      aliveAfterOverlapCount,
      aliveAtThisValueButDeadAt025,
    };
  });
}

export function analyzeAllTimeframes(
  barsMap: RedSniperBarsMap,
  livePriceOverride?: number | null,
  settings: RedSniperSettings = DEFAULT_RED_SNIPER_SETTINGS,
  formingCandleIncluded: boolean = true
): {
  byTf: Record<RedSniperTimeframe, TimeframeAnalysis>;
  allZones: RedSniperZone[];
  mergedZones: MergedRedSniperZone[];
  verdict: VerdictResult;
} {
  const verdict = computeMultiTimeframeVerdict(barsMap);
  const byTf = {} as Record<RedSniperTimeframe, TimeframeAnalysis>;

  for (const tf of RED_SNIPER_TIMEFRAMES) {
    byTf[tf] = analyzeTimeframe(
      tf,
      barsMap[tf] || [],
      verdict.bias1h,
      verdict.bias4h,
      livePriceOverride,
      settings,
      formingCandleIncluded
    );
  }

  // Issue 3: Multi-timeframe confluence pool = higher timeframes (15m, 30m, 1H, 4H)
  const htfConfluencePool: RedSniperZone[] = [
    ...(byTf['15m']?.zones || []),
    ...(byTf['30m']?.zones || []),
    ...(byTf['1h']?.zones || []),
    ...(byTf['4h']?.zones || []),
  ];

  const allZones: RedSniperZone[] = [];
  for (const tf of RED_SNIPER_TIMEFRAMES) {
    const analysis = byTf[tf];
    const upgradedZones = analysis.zones.map((z) =>
      applyMultiTimeframeConfluence(z, htfConfluencePool)
    );
    const upgradedChartZones = analysis.chartZones.map((z) =>
      applyMultiTimeframeConfluence(z, htfConfluencePool)
    );
    byTf[tf] = {
      ...analysis,
      zones: upgradedZones,
      chartZones: upgradedChartZones,
    };
    allZones.push(...upgradedZones);
  }

  const mergedZones = mergeOverlappingMultiTfZones(allZones);

  return { byTf, allZones, mergedZones, verdict };
}

export function computeTp3Target(
  side: 'BUY' | 'SELL',
  entry: number,
  riskPoints: number,
  allZones: RedSniperZone[],
  preferredTf: RedSniperTimeframe
): { tp3: number; isLiquidity: boolean } {
  const minTargetDist = 2.5 * riskPoints;
  const maxTargetDist = 6.0 * riskPoints;

  const oppSide: ZoneSide = side === 'BUY' ? 'SELL' : 'BUY';
  const candidates = allZones.filter((z) => z.side === oppSide);

  let bestEdge: number | null = null;
  let bestDist = Infinity;

  for (const z of candidates) {
    const edge = side === 'BUY' ? z.bottom : z.top;
    const dist = side === 'BUY' ? edge - entry : entry - edge;
    if (dist >= minTargetDist && dist <= maxTargetDist) {
      const weightDist = z.tf === preferredTf ? dist * 0.9 : dist;
      if (weightDist < bestDist) {
        bestDist = weightDist;
        bestEdge = edge;
      }
    }
  }

  if (bestEdge !== null) {
    return { tp3: Number(bestEdge.toFixed(2)), isLiquidity: true };
  }

  const fallback =
    side === 'BUY'
      ? Number((entry + 3 * riskPoints).toFixed(2))
      : Number((entry - 3 * riskPoints).toFixed(2));
  return { tp3: fallback, isLiquidity: false };
}

export function buildZoneTradeParameters(
  zone: RedSniperZone,
  entryPrice: number,
  balance: number,
  allZones: RedSniperZone[],
  bias1h: TfBias,
  bias4h: TfBias,
  settings: RedSniperSettings = DEFAULT_RED_SNIPER_SETTINGS
): PendingTradePlan {
  const side: 'BUY' | 'SELL' = zone.side;
  const slBuffer = clamp(settings.slBuffer ?? 1.5, 1.0, 3.0);
  const riskPct = clamp(settings.riskPct ?? 1.5, 0.25, 10.0);
  const maxRiskPoints = Math.max(0, settings.maxRiskPoints ?? 15);

  const distalEdge = side === 'BUY' ? zone.bottom : zone.top;
  let sl =
    side === 'BUY'
      ? Number((distalEdge - slBuffer).toFixed(2))
      : Number((distalEdge + slBuffer).toFixed(2));

  let riskPoints = side === 'BUY' ? entryPrice - sl : sl - entryPrice;
  if (riskPoints < 2.0) {
    riskPoints = 2.0;
    sl =
      side === 'BUY'
        ? Number((entryPrice - 2.0).toFixed(2))
        : Number((entryPrice + 2.0).toFixed(2));
  } else {
    riskPoints = Number(riskPoints.toFixed(2));
  }

  const maxRiskSkipped = maxRiskPoints > 0 && riskPoints > maxRiskPoints;

  const rawLots = (balance * (riskPct / 100)) / (riskPoints * 100);
  const lots = Math.max(0.01, Number(rawLots.toFixed(2)));

  const tp1 =
    side === 'BUY'
      ? Number((entryPrice + riskPoints).toFixed(2))
      : Number((entryPrice - riskPoints).toFixed(2));
  const tp2 =
    side === 'BUY'
      ? Number((entryPrice + 2 * riskPoints).toFixed(2))
      : Number((entryPrice - 2 * riskPoints).toFixed(2));
  const { tp3, isLiquidity } = computeTp3Target(
    side,
    entryPrice,
    riskPoints,
    allZones,
    zone.tf
  );

  const insideZone = entryPrice >= zone.bottom && entryPrice <= zone.top;
  const distance = insideZone
    ? 0
    : entryPrice < zone.bottom
    ? Number((zone.bottom - entryPrice).toFixed(2))
    : Number((entryPrice - zone.top).toFixed(2));

  const htfBlocked =
    (side === 'BUY' && bias1h === 'BEAR' && bias4h === 'BEAR') ||
    (side === 'SELL' && bias1h === 'BULL' && bias4h === 'BULL');

  return {
    zone,
    side,
    entry: Number(entryPrice.toFixed(2)),
    sl,
    tp1,
    tp2,
    tp3,
    tp3IsLiquidity: isLiquidity,
    riskPoints,
    lots,
    distance,
    insideZone,
    htfBlocked,
    maxRiskSkipped,
  };
}

export function advanceTrailingStopAfterTp1(
  trade: OpenSniperTrade,
  livePrice: number,
  trailTrigger: number = 2.0,
  trailStep: number = 1.5
): { updatedTrade: OpenSniperTrade; moved: boolean } {
  if (!trade.tp1Hit || !Number.isFinite(livePrice) || livePrice <= 0) {
    return { updatedTrade: trade, moved: false };
  }

  const trigger = Math.max(0.5, trailTrigger);
  const step = Math.max(0.25, trailStep);
  const isBuy = trade.side === 'BUY';

  let sl = trade.sl;
  let ref = typeof trade.trailRef === 'number' ? trade.trailRef : trade.tp1;
  let moved = false;

  if (isBuy) {
    while (livePrice - ref >= trigger - 1e-9) {
      ref = Number((ref + trigger).toFixed(2));
      const candidateSl = Number((sl + step).toFixed(2));
      const maxAllowedSl = Number((livePrice - 1.0).toFixed(2));
      const nextSl = Math.min(candidateSl, maxAllowedSl);
      if (nextSl > sl + 1e-6) {
        sl = nextSl;
        moved = true;
      }
    }
  } else {
    while (ref - livePrice >= trigger - 1e-9) {
      ref = Number((ref - trigger).toFixed(2));
      const candidateSl = Number((sl - step).toFixed(2));
      const minAllowedSl = Number((livePrice + 1.0).toFixed(2));
      const nextSl = Math.max(candidateSl, minAllowedSl);
      if (nextSl < sl - 1e-6) {
        sl = nextSl;
        moved = true;
      }
    }
  }

  const isTrailing = isBuy ? sl > trade.entry + 1e-6 : sl < trade.entry - 1e-6;
  if (
    !moved &&
    ref === trade.trailRef &&
    isTrailing === Boolean(trade.isTrailing)
  ) {
    return { updatedTrade: trade, moved: false };
  }

  return {
    updatedTrade: {
      ...trade,
      sl,
      trailRef: ref,
      isTrailing,
    },
    moved,
  };
}

export function loadDemoState(): RedSniperDemoState {
  const fallback: RedSniperDemoState = {
    balance: 1000,
    autoEnabled: true,
    openTrades: [],
    closedTrades: [],
    usedZoneIds: [],
  };

  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(RED_SNIPER_DEMO_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      balance:
        typeof parsed.balance === 'number' && Number.isFinite(parsed.balance)
          ? parsed.balance
          : 1000,
      autoEnabled:
        typeof parsed.autoEnabled === 'boolean' ? parsed.autoEnabled : true,
      openTrades: Array.isArray(parsed.openTrades) ? parsed.openTrades : [],
      closedTrades: Array.isArray(parsed.closedTrades)
        ? parsed.closedTrades
        : [],
      usedZoneIds: Array.isArray(parsed.usedZoneIds) ? parsed.usedZoneIds : [],
    };
  } catch {
    return fallback;
  }
}

export function saveDemoState(state: RedSniperDemoState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      RED_SNIPER_DEMO_STORAGE_KEY,
      JSON.stringify(state)
    );
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * LIVE TRADE LOG ("BOT LOG") helpers: separated into TRADE log (max 1000) and ZONE log (max 100).
 */
export function mergeBotLogEntries(
  existing: BotLogEntry[],
  incoming: BotLogEntry[],
  maxEntries: number = 200
): BotLogEntry[] {
  const byId = new Map<string, BotLogEntry>();
  for (const item of existing) {
    if (item && typeof item.id === 'string') {
      byId.set(item.id, item);
    }
  }
  for (const item of incoming) {
    if (item && typeof item.id === 'string') {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => b.ts - a.ts)
    .slice(0, maxEntries);
}

export function mergeSeparatedBotLogEntries(
  existingTrades: BotLogEntry[],
  existingZones: BotLogEntry[],
  incoming: BotLogEntry[],
  maxTrades: number = 1000,
  maxZones: number = 100
): { tradeLogs: BotLogEntry[]; zoneLogs: BotLogEntry[] } {
  const tradeMap = new Map<string, BotLogEntry>();
  const zoneMap = new Map<string, BotLogEntry>();

  for (const t of existingTrades || []) {
    if (t && t.id) tradeMap.set(t.id, { ...t, category: 'trade' });
  }
  for (const z of existingZones || []) {
    if (z && z.id) zoneMap.set(z.id, { ...z, category: 'zone' });
  }

  for (const item of incoming || []) {
    if (!item || !item.id) continue;
    if (isZoneLogType(item.type)) {
      zoneMap.set(item.id, { ...item, category: 'zone' });
    } else {
      tradeMap.set(item.id, { ...item, category: 'trade' });
    }
  }

  const tradeLogs = Array.from(tradeMap.values())
    .sort((a, b) => b.ts - a.ts)
    .slice(0, maxTrades);

  const zoneLogs = Array.from(zoneMap.values())
    .sort((a, b) => b.ts - a.ts)
    .slice(0, maxZones);

  return { tradeLogs, zoneLogs };
}

export function loadBotLogFromLocalStorage(): BotLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RED_SNIPER_BOT_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return mergeBotLogEntries([], parsed, 1000);
  } catch {
    return [];
  }
}

export function saveBotLogToLocalStorage(entries: BotLogEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    const capped = mergeBotLogEntries([], entries, 1000);
    window.localStorage.setItem(
      RED_SNIPER_BOT_LOG_STORAGE_KEY,
      JSON.stringify(capped)
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function loadSeparatedBotLogsFromLocalStorage(): {
  tradeLogs: BotLogEntry[];
  zoneLogs: BotLogEntry[];
} {
  if (typeof window === 'undefined') return { tradeLogs: [], zoneLogs: [] };
  try {
    const rawTrades = window.localStorage.getItem(RED_SNIPER_TRADE_LOG_STORAGE_KEY);
    const rawZones = window.localStorage.getItem(RED_SNIPER_ZONE_LOG_STORAGE_KEY);
    const parsedTrades = rawTrades ? JSON.parse(rawTrades) : [];
    const parsedZones = rawZones ? JSON.parse(rawZones) : [];
    return mergeSeparatedBotLogEntries(
      Array.isArray(parsedTrades) ? parsedTrades : [],
      Array.isArray(parsedZones) ? parsedZones : [],
      [],
      1000,
      100
    );
  } catch {
    return { tradeLogs: [], zoneLogs: [] };
  }
}

export function saveSeparatedBotLogsToLocalStorage(
  tradeLogs: BotLogEntry[],
  zoneLogs: BotLogEntry[]
): void {
  if (typeof window === 'undefined') return;
  try {
    const capped = mergeSeparatedBotLogEntries(tradeLogs, zoneLogs, [], 1000, 100);
    window.localStorage.setItem(
      RED_SNIPER_TRADE_LOG_STORAGE_KEY,
      JSON.stringify(capped.tradeLogs)
    );
    window.localStorage.setItem(
      RED_SNIPER_ZONE_LOG_STORAGE_KEY,
      JSON.stringify(capped.zoneLogs)
    );
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * 2) Zone events: do NOT log zones loaded at startup.
 * Log "ZONE_NEW" only for zones created while app runs.
 * Log "ZONE_NEAR" once when price comes within 3 x ATR14.
 * Log "ZONE_DEAD" when it dies.
 * One line per event, deduplicated by zone id.
 */
export function detectRuntimeZoneEvents(params: {
  allZones: RedSniperZone[];
  knownZoneIds: Set<string>;
  nearLoggedZoneIds: Set<string>;
  deadLoggedZoneIds: Set<string>;
  livePrice: number | null;
  deadZones?: ZoneDebugEntry[];
  nowMs?: number;
  isInitialLoad?: boolean;
}): BotLogEntry[] {
  const {
    allZones,
    knownZoneIds,
    nearLoggedZoneIds,
    deadLoggedZoneIds,
    livePrice,
    deadZones = [],
    nowMs = Date.now(),
    isInitialLoad = false,
  } = params;

  // On startup / first load, register all existing zones into knownZoneIds and nearLoggedZoneIds without emitting
  if (isInitialLoad) {
    for (const z of allZones) {
      knownZoneIds.add(z.id);
      if (livePrice !== null && Number.isFinite(livePrice) && livePrice > 0) {
        const dist = getZoneDistancePts(z, livePrice);
        if (dist <= 3 * z.atr14) {
          nearLoggedZoneIds.add(z.id);
        }
      }
    }
    for (const dz of deadZones) {
      const dzId = `${dz.time}-${dz.side}-${dz.bottom.toFixed(2)}-${dz.top.toFixed(2)}`;
      deadLoggedZoneIds.add(dzId);
    }
    return [];
  }

  const logs: BotLogEntry[] = [];
  const isoTime = new Date(nowMs).toISOString();

  // 1) ZONE_NEW: only for zones created while app runs
  for (const z of allZones) {
    if (!knownZoneIds.has(z.id)) {
      knownZoneIds.add(z.id);
      logs.push({
        id: `LOG-ZONE_NEW-${z.id}`,
        ts: nowMs,
        isoTime,
        type: 'ZONE_NEW',
        category: 'zone',
        tf: z.tf,
        side: z.side,
        zoneId: z.id,
        message: `ZONE_NEW: ${formatTfShort(z.tf)} ${z.side} ${z.bottom.toFixed(2)}-${z.top.toFixed(2)} · PWR ${z.power}`,
        details: {
          bottom: z.bottom,
          top: z.top,
          power: z.power,
          status: z.status,
        },
      });
    }
  }

  // 2) ZONE_NEAR: logged once when price comes within 3 x ATR14
  if (livePrice !== null && Number.isFinite(livePrice) && livePrice > 0) {
    for (const z of allZones) {
      if (nearLoggedZoneIds.has(z.id)) continue;
      const dist = getZoneDistancePts(z, livePrice);
      const threshold = 3 * z.atr14;
      if (dist <= threshold) {
        nearLoggedZoneIds.add(z.id);
        logs.push({
          id: `LOG-ZONE_NEAR-${z.id}`,
          ts: nowMs,
          isoTime,
          type: 'ZONE_NEAR',
          category: 'zone',
          tf: z.tf,
          side: z.side,
          zoneId: z.id,
          message: `ZONE_NEAR: ${formatTfShort(z.tf)} ${z.side} ${z.bottom.toFixed(2)}-${z.top.toFixed(2)} (${dist.toFixed(1)} pts away, <= 3xATR)`,
          details: {
            bottom: z.bottom,
            top: z.top,
            distancePts: dist,
            atr14: z.atr14,
          },
        });
      }
    }
  }

  // 3) ZONE_DEAD: logged once when zone dies
  for (const dz of deadZones) {
    const dzId = `${dz.time}-${dz.side}-${dz.bottom.toFixed(2)}-${dz.top.toFixed(2)}`;
    if (deadLoggedZoneIds.has(dzId)) continue;
    deadLoggedZoneIds.add(dzId);
    logs.push({
      id: `LOG-ZONE_DEAD-${dzId}`,
      ts: nowMs,
      isoTime,
      type: 'ZONE_DEAD',
      category: 'zone',
      side: dz.side,
      zoneId: dzId,
      message: `ZONE_DEAD: ${dz.side} ${dz.bottom.toFixed(2)}-${dz.top.toFixed(2)} (closed beyond distal + deadAtr)`,
      details: {
        bottom: dz.bottom,
        top: dz.top,
        deadBeyondAtr: dz.deadBeyondAtr,
        deadCandleTime: dz.deadCandleTime,
      },
    });
  }

  return logs;
}

export function detectNewZoneBotLogs(
  zones: RedSniperZone[],
  seenZoneIds: Set<string>,
  nowMs: number = Date.now(),
  showConsumedZones: boolean = false
): BotLogEntry[] {
  const logs: BotLogEntry[] = [];
  const isoTime = new Date(nowMs).toISOString();

  for (const z of zones) {
    if (z.isFar) continue;
    if (z.consumed && !showConsumedZones) continue;
    if (seenZoneIds.has(z.id)) continue;
    seenZoneIds.add(z.id);

    logs.push({
      id: `LOG-ZONE-${z.id}`,
      ts: nowMs,
      isoTime,
      type: 'ZONE_DETECTED',
      category: 'zone',
      tf: z.tf,
      side: z.side,
      zoneId: z.id,
      message: `Zone detected: ${formatTfShort(z.tf)} ${z.side} ${z.bottom.toFixed(
        2
      )}-${z.top.toFixed(2)} · ${z.status} (${z.pctLeft}% left, ${z.retests}x) · PWR ${
        z.power
      }`,
      details: {
        bottom: z.bottom,
        top: z.top,
        status: z.status,
        pctLeft: z.pctLeft,
        retests: z.retests,
        power: z.power,
      },
    });
  }

  return logs;
}

export function formatBotLogForClipboard(entries: BotLogEntry[]): string {
  if (!entries || entries.length === 0) {
    return 'BOT LOG (0 entries)';
  }
  return entries
    .map((e) => `[${e.isoTime}] [${e.type}] ${e.message}`)
    .join('\n');
}

/**
 * 3) "Copy bot log" copies TRADE log first, then last 30 zone events.
 */
export function formatSeparatedBotLogForClipboard(
  tradeLogs: BotLogEntry[],
  zoneLogs: BotLogEntry[]
): string {
  const sortedTrades = [...tradeLogs].sort((a, b) => b.ts - a.ts);
  const recentZoneLogs = [...zoneLogs].sort((a, b) => b.ts - a.ts).slice(0, 30);

  const parts: string[] = [];
  parts.push(`=== TRADE LOG (${sortedTrades.length} entries) ===`);
  if (sortedTrades.length === 0) {
    parts.push('(no trade entries)');
  } else {
    for (const t of sortedTrades) {
      parts.push(`[${t.isoTime}] [${t.type}] ${t.message}`);
    }
  }

  parts.push('');
  parts.push(`=== ZONE LOG (last ${recentZoneLogs.length} events) ===`);
  if (recentZoneLogs.length === 0) {
    parts.push('(no zone entries)');
  } else {
    for (const z of recentZoneLogs) {
      parts.push(`[${z.isoTime}] [${z.type}] ${z.message}`);
    }
  }

  return parts.join('\n');
}

export function computeOpenTradeFloatingPnl(
  trade: OpenSniperTrade,
  livePrice: number | null
): { floatingPnl: number; totalPnl: number; currentR: number } {
  if (livePrice === null || !Number.isFinite(livePrice) || livePrice <= 0) {
    return {
      floatingPnl: 0,
      totalPnl: Number(trade.realizedPnl.toFixed(2)),
      currentR: Number(trade.realizedR.toFixed(2)),
    };
  }

  const priceDiff =
    trade.side === 'BUY' ? livePrice - trade.entry : trade.entry - livePrice;
  const remLots = trade.initialLots * trade.remPct;
  const floatingPnl = remLots * 100 * priceDiff;
  const totalPnl = trade.realizedPnl + floatingPnl;
  const floatingR = (priceDiff / trade.riskPoints) * trade.remPct;
  const currentR = trade.realizedR + floatingR;

  return {
    floatingPnl: Number(floatingPnl.toFixed(2)),
    totalPnl: Number(totalPnl.toFixed(2)),
    currentR: Number(currentR.toFixed(2)),
  };
}

function formatTfShort(tf: RedSniperTimeframe): string {
  if (tf === '1h') return '1H';
  if (tf === '4h') return '4H';
  if (tf === '1d') return '1D';
  return tf;
}

export function computeBotStatusLine(
  state: RedSniperDemoState,
  livePrice: number | null,
  allZones: RedSniperZone[],
  bias1h: TfBias,
  bias4h: TfBias,
  lastEnteredText?: string | null,
  settings: RedSniperSettings = DEFAULT_RED_SNIPER_SETTINGS,
  isMarketClosed: boolean = false
): string {
  if (isMarketClosed) {
    return 'Bot paused: market closed';
  }
  if (livePrice === null || !Number.isFinite(livePrice) || livePrice <= 0) {
    return 'Waiting for live feed...';
  }
  if (!state.autoEnabled) {
    return 'Auto Trader OFF — manual observation mode';
  }
  if (lastEnteredText) {
    return lastEnteredText;
  }
  if (state.openTrades.length >= 3) {
    return 'Max 3 trades open';
  }

  const minPwr = settings.minPowerToTrade ?? 50;
  const farAtr = clamp(settings.farAtr ?? 25, 10, 60);
  // 2) FAR ZONES (> farAtr * ATR14) and 3) CONSUMED ZONES (pctLeft=0 when !showConsumedZones) are hidden from the bot
  const nearQualifying = allZones
    .filter(
      (z) =>
        !z.isFar &&
        (!z.minor || z.bosConfirmed === true) &&
        (settings.showConsumedZones || (!z.consumed && z.pctLeft >= 15)) &&
        z.retests < 3 &&
        (z.status === 'FRESH' || z.status === 'TESTED') &&
        z.power >= minPwr &&
        isZoneNear(z, livePrice, farAtr)
    )
    .sort(
      (a, b) =>
        getZoneDistancePts(a, livePrice) - getZoneDistancePts(b, livePrice) ||
        b.power - a.power
    );

  if (nearQualifying.length === 0) {
    return `Waiting: no near FRESH/TESTED zone with PWR ≥ ${minPwr}`;
  }

  const insideZones = nearQualifying.filter(
    (z) => livePrice >= z.bottom && livePrice <= z.top
  );

  for (const z of insideZones) {
    const activeOnTf = state.openTrades.find((o) => o.tf === z.tf);
    if (activeOnTf) {
      if (activeOnTf.isTrailing) {
        return `TRAIL ${activeOnTf.side} ${formatTfShort(activeOnTf.tf)}: SL @${activeOnTf.sl.toFixed(2)}`;
      }
      return `Entered ${activeOnTf.side} ${formatTfShort(activeOnTf.tf)} @${activeOnTf.entry.toFixed(1)}`;
    }
    const plan = buildZoneTradeParameters(
      z,
      livePrice,
      state.balance,
      allZones,
      bias1h,
      bias4h,
      settings
    );
    if (plan.maxRiskSkipped) {
      return `Skipped ${formatTfShort(z.tf)} ${z.side}: risk ${plan.riskPoints.toFixed(1)} pts > max $${settings.maxRiskPoints}`;
    }
    if (plan.htfBlocked) {
      return 'Blocked: 1H+4H bias against';
    }
    if (state.usedZoneIds.includes(z.id)) {
      continue;
    }
  }

  const unusedNear = nearQualifying.filter(
    (z) => !state.usedZoneIds.includes(z.id)
  );
  const target = unusedNear[0] || nearQualifying[0];
  const dist = getZoneDistancePts(target, livePrice);

  return `Waiting: nearest zone ${formatTfShort(target.tf)} ${target.side} ${dist.toFixed(1)} pts away`;
}

export interface ReplayTrailingMove {
  time: number; // ms
  tradeId: string;
  tf: RedSniperTimeframe;
  side: 'BUY' | 'SELL';
  fromSl: number;
  toSl: number;
  price: number;
}

export function stepAutoTraderOnTick(
  state: RedSniperDemoState,
  livePrice: number,
  allZones: RedSniperZone[],
  bias1h: TfBias,
  bias4h: TfBias,
  sessionName: string,
  nowMs: number = Date.now(),
  settings: RedSniperSettings = DEFAULT_RED_SNIPER_SETTINGS,
  isMarketClosed: boolean = false
): {
  nextState: RedSniperDemoState;
  changed: boolean;
  enteredText: string | null;
  trailMoves: ReplayTrailingMove[];
  botLogs: BotLogEntry[];
} {
  if (isMarketClosed || !Number.isFinite(livePrice) || livePrice <= 0) {
    return {
      nextState: state,
      changed: false,
      enteredText: null,
      trailMoves: [],
      botLogs: [],
    };
  }

  let balance = state.balance;
  const openTrades: OpenSniperTrade[] = [];
  const closedTrades: ClosedSniperTrade[] = [...state.closedTrades];
  const usedZoneIds: string[] = [...state.usedZoneIds];
  const trailMoves: ReplayTrailingMove[] = [];
  const botLogs: BotLogEntry[] = [];
  const isoTime = new Date(nowMs).toISOString();
  let changed = false;
  let enteredText: string | null = null;

  // 1) Evaluate TP1 / TP2 / TP3 / Trailing Stop / SL on existing open trades
  for (const rawTrade of state.openTrades) {
    let t: OpenSniperTrade = { ...rawTrade };
    const isBuy = t.side === 'BUY';

    if (!t.tp1Hit) {
      const hitTp1 = isBuy ? livePrice >= t.tp1 : livePrice <= t.tp1;
      if (hitTp1) {
        const oldSlBeforeBe = t.sl;
        const legPnl = 0.5 * t.initialLots * 100 * t.riskPoints;
        t.realizedPnl = Number((t.realizedPnl + legPnl).toFixed(2));
        t.realizedR = Number((t.realizedR + 0.5).toFixed(2));
        t.remPct = 0.5;
        t.sl = t.entry;
        t.beMoved = true;
        t.tp1Hit = true;
        t.trailRef = t.tp1;
        t.isTrailing = false;
        botLogs.push({
          id: `LOG-TP1-${t.id}-${nowMs}`,
          ts: nowMs,
          isoTime,
          type: 'TP1_BE',
          tf: t.tf,
          side: t.side,
          zoneId: t.zoneId,
          tradeId: t.id,
          message: `TP1 hit + BE: ${t.side} ${formatTfShort(
            t.tf
          )} @ $${livePrice.toFixed(2)} (closed 50%, SL ${oldSlBeforeBe.toFixed(
            2
          )} -> ${t.entry.toFixed(2)} BE)`,
          details: {
            price: livePrice,
            tp1: t.tp1,
            oldSl: oldSlBeforeBe,
            newSl: t.entry,
          },
        });
        changed = true;
      }
    }

    if (t.tp1Hit && !t.tp2Hit) {
      const hitTp2 = isBuy ? livePrice >= t.tp2 : livePrice <= t.tp2;
      if (hitTp2) {
        const legPnl = 0.3 * t.initialLots * 100 * (2 * t.riskPoints);
        t.realizedPnl = Number((t.realizedPnl + legPnl).toFixed(2));
        t.realizedR = Number((t.realizedR + 0.6).toFixed(2));
        t.remPct = 0.2;
        t.tp2Hit = true;
        changed = true;
      }
    }

    if (t.tp2Hit) {
      const hitTp3 = isBuy ? livePrice >= t.tp3 : livePrice <= t.tp3;
      if (hitTp3) {
        const tp3Dist = Math.abs(t.tp3 - t.entry);
        const tp3R = tp3Dist / t.riskPoints;
        const legPnl = 0.2 * t.initialLots * 100 * tp3Dist;
        const finalPnl = Number((t.realizedPnl + legPnl).toFixed(2));
        const finalR = Number((t.realizedR + 0.2 * tp3R).toFixed(2));

        balance = Number((balance + finalPnl).toFixed(2));
        closedTrades.unshift({
          id: t.id,
          zoneId: t.zoneId,
          time: nowMs,
          tf: t.tf,
          side: t.side,
          entry: t.entry,
          exit: t.tp3,
          pnl: finalPnl,
          r: finalR,
          result: 'TP3',
          session: t.session,
          power: t.power,
          class: 'win',
        });
        botLogs.push({
          id: `LOG-EXIT-${t.id}-${nowMs}`,
          ts: nowMs,
          isoTime,
          type: 'EXIT',
          tf: t.tf,
          side: t.side,
          zoneId: t.zoneId,
          tradeId: t.id,
          message: `Exit [TP3]: ${t.side} ${formatTfShort(
            t.tf
          )} @ $${t.tp3.toFixed(2)} (PnL +$${finalPnl.toFixed(
            2
          )}, +${finalR.toFixed(2)}R)`,
          details: {
            reason: 'TP3',
            entry: t.entry,
            exit: t.tp3,
            pnl: finalPnl,
            r: finalR,
          },
        });
        changed = true;
        continue;
      }
    }

    if (t.tp1Hit) {
      const prevSl = t.sl;
      const trailRes = advanceTrailingStopAfterTp1(
        t,
        livePrice,
        settings.trailTrigger,
        settings.trailStep
      );
      if (trailRes.moved) {
        t = trailRes.updatedTrade;
        trailMoves.push({
          time: nowMs,
          tradeId: t.id,
          tf: t.tf,
          side: t.side,
          fromSl: prevSl,
          toSl: t.sl,
          price: livePrice,
        });
        botLogs.push({
          id: `LOG-TRAIL-${t.id}-${nowMs}-${Math.round(t.sl * 100)}`,
          ts: nowMs,
          isoTime,
          type: 'TRAIL_MOVE',
          tf: t.tf,
          side: t.side,
          zoneId: t.zoneId,
          tradeId: t.id,
          message: `Trailing-stop move: ${t.side} ${formatTfShort(
            t.tf
          )} SL ${prevSl.toFixed(2)} -> ${t.sl.toFixed(
            2
          )} @ $${livePrice.toFixed(2)}`,
          details: {
            oldSl: prevSl,
            newSl: t.sl,
            price: livePrice,
          },
        });
        enteredText = `TRAIL ${t.side} ${formatTfShort(t.tf)}: SL → $${t.sl.toFixed(2)}`;
        changed = true;
      }
    }

    const hitSl = isBuy ? livePrice <= t.sl : livePrice >= t.sl;
    if (hitSl) {
      if (!t.tp1Hit) {
        const lossPnl = -Number(
          (t.initialLots * 100 * t.riskPoints).toFixed(2)
        );
        balance = Number((balance + lossPnl).toFixed(2));
        closedTrades.unshift({
          id: t.id,
          zoneId: t.zoneId,
          time: nowMs,
          tf: t.tf,
          side: t.side,
          entry: t.entry,
          exit: t.sl,
          pnl: lossPnl,
          r: -1.0,
          result: 'SL',
          session: t.session,
          power: t.power,
          class: 'loss',
        });
        botLogs.push({
          id: `LOG-EXIT-${t.id}-${nowMs}`,
          ts: nowMs,
          isoTime,
          type: 'EXIT',
          tf: t.tf,
          side: t.side,
          zoneId: t.zoneId,
          tradeId: t.id,
          message: `Exit [SL]: ${t.side} ${formatTfShort(
            t.tf
          )} @ $${t.sl.toFixed(2)} (PnL -$${Math.abs(lossPnl).toFixed(
            2
          )}, -1.00R)`,
          details: {
            reason: 'SL',
            entry: t.entry,
            exit: t.sl,
            pnl: lossPnl,
            r: -1.0,
          },
        });
      } else {
        const trailDiff = isBuy
          ? Math.max(0, t.sl - t.entry)
          : Math.max(0, t.entry - t.sl);
        const remLegPnl = t.remPct * t.initialLots * 100 * trailDiff;
        const remLegR = t.remPct * (trailDiff / t.riskPoints);
        const finalPnl = Number((t.realizedPnl + remLegPnl).toFixed(2));
        const finalR = Number((t.realizedR + remLegR).toFixed(2));
        balance = Number((balance + finalPnl).toFixed(2));

        const wasTrailed = Boolean(t.isTrailing && trailDiff > 1e-6);
        const resultLabel: ClosedSniperTrade['result'] = t.tp2Hit
          ? wasTrailed
            ? 'TP2+TRAIL'
            : 'TP2+BE'
          : wasTrailed
          ? 'TP1+TRAIL'
          : 'TP1+BE';

        closedTrades.unshift({
          id: t.id,
          zoneId: t.zoneId,
          time: nowMs,
          tf: t.tf,
          side: t.side,
          entry: t.entry,
          exit: t.sl,
          pnl: finalPnl,
          r: finalR,
          result: resultLabel,
          session: t.session,
          power: t.power,
          class: t.tp2Hit || wasTrailed ? 'win' : 'be',
        });
        botLogs.push({
          id: `LOG-EXIT-${t.id}-${nowMs}`,
          ts: nowMs,
          isoTime,
          type: 'EXIT',
          tf: t.tf,
          side: t.side,
          zoneId: t.zoneId,
          tradeId: t.id,
          message: `Exit [${resultLabel}]: ${t.side} ${formatTfShort(
            t.tf
          )} @ $${t.sl.toFixed(2)} (PnL ${
            finalPnl >= 0 ? '+' : '-'
          }$${Math.abs(finalPnl).toFixed(2)}, ${
            finalR >= 0 ? '+' : ''
          }${finalR.toFixed(2)}R)`,
          details: {
            reason: resultLabel,
            entry: t.entry,
            exit: t.sl,
            pnl: finalPnl,
            r: finalR,
          },
        });
      }
      changed = true;
      continue;
    }

    openTrades.push(t);
  }

  // 2) Open new trades on the FIRST return into a non-FAR, non-consumed FRESH or TESTED zone (power >= minPowerToTrade)
  const minPwr = settings.minPowerToTrade ?? 50;
  const farAtr = clamp(settings.farAtr ?? 25, 10, 60);
  if (state.autoEnabled && openTrades.length < 3) {
    const qualifying = allZones
      .filter(
        (z) =>
          !z.isFar &&
          (!z.minor || z.bosConfirmed === true) &&
          (settings.showConsumedZones || (!z.consumed && z.pctLeft >= 15)) &&
          z.retests < 3 &&
          (z.status === 'FRESH' || z.status === 'TESTED') &&
          z.retests <= 1 &&
          z.power >= minPwr &&
          isZoneNear(z, livePrice, farAtr) &&
          livePrice >= z.bottom &&
          livePrice <= z.top &&
          (z.entryConfirmed || (livePrice > z.bottom && livePrice < z.top)) &&
          !usedZoneIds.includes(z.id)
      )
      .sort(
        (a, b) =>
          computeZoneProximityScore(b, livePrice) -
          computeZoneProximityScore(a, livePrice)
      );

    for (const zone of qualifying) {
      if (openTrades.length >= 3) break;
      if (openTrades.some((o) => o.tf === zone.tf)) continue;

      const plan = buildZoneTradeParameters(
        zone,
        livePrice,
        balance,
        allZones,
        bias1h,
        bias4h,
        settings
      );

      if (plan.htfBlocked || plan.maxRiskSkipped) continue;

      const newTrade: OpenSniperTrade = {
        id: `TRD-${zone.tf}-${nowMs}-${Math.round(livePrice * 100)}`,
        zoneId: zone.id,
        tf: zone.tf,
        side: plan.side,
        openTime: nowMs,
        session: sessionName,
        power: zone.power,
        entry: plan.entry,
        initialSl: plan.sl,
        sl: plan.sl,
        tp1: plan.tp1,
        tp2: plan.tp2,
        tp3: plan.tp3,
        tp3IsLiquidity: plan.tp3IsLiquidity,
        riskPoints: plan.riskPoints,
        initialLots: plan.lots,
        remPct: 1.0,
        tp1Hit: false,
        tp2Hit: false,
        beMoved: false,
        trailRef: plan.tp1,
        isTrailing: false,
        realizedPnl: 0,
        realizedR: 0,
      };

      openTrades.push(newTrade);
      usedZoneIds.push(zone.id);
      botLogs.push({
        id: `LOG-ENTRY-${newTrade.id}`,
        ts: nowMs,
        isoTime,
        type: 'ENTRY',
        tf: newTrade.tf,
        side: newTrade.side,
        zoneId: zone.id,
        tradeId: newTrade.id,
        message: `Entry: ${newTrade.side} ${formatTfShort(
          newTrade.tf
        )} @ $${newTrade.entry.toFixed(2)} · SL $${newTrade.sl.toFixed(
          2
        )} · TP1 $${newTrade.tp1.toFixed(2)} · TP2 $${newTrade.tp2.toFixed(
          2
        )} · TP3 $${newTrade.tp3.toFixed(2)} · PWR ${newTrade.power}`,
        details: {
          entry: newTrade.entry,
          sl: newTrade.sl,
          tp1: newTrade.tp1,
          tp2: newTrade.tp2,
          tp3: newTrade.tp3,
          lots: newTrade.initialLots,
          power: newTrade.power,
        },
      });
      enteredText = `Entered ${newTrade.side} ${formatTfShort(newTrade.tf)} @${newTrade.entry.toFixed(1)}`;
      changed = true;
    }
  }

  if (!changed) {
    return {
      nextState: state,
      changed: false,
      enteredText: null,
      trailMoves,
      botLogs,
    };
  }

  const nextState: RedSniperDemoState = {
    balance,
    autoEnabled: state.autoEnabled,
    openTrades,
    closedTrades: closedTrades.slice(0, 200),
    usedZoneIds: usedZoneIds.slice(-500),
  };

  return { nextState, changed: true, enteredText, trailMoves, botLogs };
}

/**
 * 4) REPLAY + CALIBRATION WINDOW LABEL:
 * Formats how much real M1 history was used, e.g. "Replay window: 4h58m of real M1, 301 candles",
 * and determines whether the window is >= 12 hours (43,200 seconds).
 */
export function formatReplayWindowLabel(
  m1Bars: Array<Pick<Candle, 'time'>>
): {
  windowSeconds: number;
  windowHours: number;
  candlesCount: number;
  windowLabel: string;
  isWindowAtLeast12h: boolean;
} {
  const candlesCount = m1Bars ? m1Bars.length : 0;
  if (candlesCount === 0) {
    return {
      windowSeconds: 0,
      windowHours: 0,
      candlesCount: 0,
      windowLabel: 'Replay window: 0h0m of real M1, 0 candles',
      isWindowAtLeast12h: false,
    };
  }
  const rawSpanSec =
    candlesCount >= 2
      ? Math.max(0, m1Bars[candlesCount - 1].time - m1Bars[0].time)
      : 60;
  const hours = Math.floor(rawSpanSec / 3600);
  const mins = Math.floor((rawSpanSec % 3600) / 60);
  const windowLabel = `Replay window: ${hours}h${mins}m of real M1, ${candlesCount} candles`;
  const isWindowAtLeast12h = rawSpanSec >= 12 * 3600;

  return {
    windowSeconds: rawSpanSec,
    windowHours: Number((rawSpanSec / 3600).toFixed(2)),
    candlesCount,
    windowLabel,
    isWindowAtLeast12h,
  };
}

export function computePerformanceMetrics(
  closedTrades: ClosedSniperTrade[],
  windowSeconds: number | null = null
): PerformanceMetrics {
  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter((t) => t.class === 'win').length;
  const beCount = closedTrades.filter((t) => t.class === 'be').length;
  const losses = closedTrades.filter((t) => t.class === 'loss').length;

  const tp2WinRatePct =
    totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;
  const bePct = totalTrades > 0 ? Math.round((beCount / totalTrades) * 100) : 0;
  const lossPct =
    totalTrades > 0 ? Math.round((losses / totalTrades) * 100) : 0;

  const totalR = closedTrades.reduce((acc, t) => acc + t.r, 0);
  const expectancyR =
    totalTrades > 0 ? Number((totalR / totalTrades).toFixed(2)) : 0;

  const sessionR: Record<'TOKYO' | 'LONDON' | 'NEW YORK' | 'LDN+NY', number> = {
    TOKYO: 0,
    LONDON: 0,
    'NEW YORK': 0,
    'LDN+NY': 0,
  };

  for (const t of closedTrades) {
    if (t.session === 'TOKYO')
      sessionR.TOKYO = Number((sessionR.TOKYO + t.r).toFixed(2));
    else if (t.session === 'LONDON')
      sessionR.LONDON = Number((sessionR.LONDON + t.r).toFixed(2));
    else if (t.session === 'NEW YORK')
      sessionR['NEW YORK'] = Number((sessionR['NEW YORK'] + t.r).toFixed(2));
    else if (t.session === 'LDN+NY')
      sessionR['LDN+NY'] = Number((sessionR['LDN+NY'] + t.r).toFixed(2));
  }

  // 4) Refuse to show a confident summary when n < 10 trades or the window is shorter than 12 hours:
  // label the summary "SMALL SAMPLE - NOT RELIABLE".
  const isShortWindow =
    typeof windowSeconds === 'number' &&
    Number.isFinite(windowSeconds) &&
    windowSeconds < 12 * 3600;
  const isReliableSample = totalTrades >= 10 && !isShortWindow;

  let confidenceLabel: PerformanceMetrics['confidenceLabel'] =
    'SMALL SAMPLE - NOT RELIABLE';
  let confidencePct = 15;

  if (!isReliableSample) {
    confidenceLabel = 'SMALL SAMPLE - NOT RELIABLE';
    confidencePct = Math.max(8, Math.round((Math.min(10, totalTrades) / 10) * 25));
  } else if (expectancyR < 0) {
    confidenceLabel = 'NEGATIVE';
    confidencePct = 20;
  } else if (expectancyR < 0.15) {
    confidenceLabel = 'NEUTRAL';
    confidencePct = 42;
  } else if (expectancyR < 0.3) {
    confidenceLabel = 'GOOD';
    confidencePct = 65;
  } else if (expectancyR < 0.5) {
    confidenceLabel = 'STRONG';
    confidencePct = 84;
  } else {
    confidenceLabel = 'ELITE';
    confidencePct = 98;
  }

  return {
    totalTrades,
    wins,
    losses,
    beCount,
    tp2WinRatePct,
    bePct,
    lossPct,
    expectancyR,
    sessionR,
    confidenceLabel,
    confidencePct,
    windowSeconds,
    isReliableSample,
    summaryStatusLabel: isReliableSample
      ? confidenceLabel
      : 'SMALL SAMPLE - NOT RELIABLE',
  };
}

// ============================================================================
// D.1) POWER CALIBRATION ON LOADED REAL CANDLES
// ============================================================================

export type PowerBucketLabel = '<40' | '40-59' | '60-79' | '80+';

export interface PowerCalibrationBucket {
  bucket: PowerBucketLabel;
  n: number;
  bounces: number;
  breaks: number;
  bouncePct: number;
  avgR: number;
  reliable: boolean;
  note: string | null;
}

export interface CalibrationSampleAudit {
  zoneId: string;
  tf: RedSniperTimeframe;
  side: ZoneSide;
  bottom: number;
  top: number;
  touchTime: number;
  touchIso: string;
  powerAtT: number;
  outcome1R: 'BOUNCE' | 'BREAK';
  outcome2R: 'BOUNCE' | 'BREAK';
  r1R: number;
  r2R: number;
}

export interface PowerCalibrationResult {
  totalResolved: number;
  independentSamplesCount: number;
  windowSeconds: number;
  candlesCount: number;
  windowLabel: string;
  isReliableWindow: boolean;
  isPredictive: boolean;
  summaryLabel: string;
  trainBuckets1R: PowerCalibrationBucket[];
  testBuckets1R: PowerCalibrationBucket[];
  trainBuckets2R: PowerCalibrationBucket[];
  testBuckets2R: PowerCalibrationBucket[];
  tfGroupBuckets: Record<'1m-5m' | '15m-30m' | '1h-1d', PowerCalibrationBucket[]>;
  sampleAudit: CalibrationSampleAudit[];
  buckets: PowerCalibrationBucket[];
}

const TF_RANK_MAP: Record<RedSniperTimeframe, number> = {
  '1m': 0,
  '3m': 1,
  '5m': 2,
  '15m': 3,
  '30m': 4,
  '1h': 5,
  '4h': 6,
  '1d': 7,
};

function getTfGroupKey(tf: RedSniperTimeframe): '1m-5m' | '15m-30m' | '1h-1d' {
  if (tf === '1m' || tf === '3m' || tf === '5m') return '1m-5m';
  if (tf === '15m' || tf === '30m') return '15m-30m';
  return '1h-1d';
}

/**
 * 1) LOOK-AHEAD FREE CALIBRATION:
 * - Compute power, score, pctLeft, retests and state using ONLY candles up to evaluation time T (first touch after leg-out).
 * - Candles after T are used strictly to decide outcome (BOUNCE = +1R or +2R reached before close-through).
 * 2) EPISODE DEDUPLICATION: overlapping price + within 30 min -> keep highest timeframe.
 * 3) OUT-OF-SAMPLE SPLIT: older 70% TRAIN, newest 30% TEST. Check predictive spread >= 10.
 * 4) SMALL SAMPLE: reliable only if n >= 30 per bucket AND history window >= 5 days.
 */
export function computePowerCalibration(
  barsMap: RedSniperBarsMap,
  settings: RedSniperSettings = DEFAULT_RED_SNIPER_SETTINGS
): PowerCalibrationResult {
  const winInfo = formatReplayWindowLabel(barsMap['1m'] || []);
  const rawSamples: Array<{
    tf: RedSniperTimeframe;
    side: ZoneSide;
    bottom: number;
    top: number;
    touchTime: number;
    touchIso: string;
    powerAtT: number;
    outcome1R: 'BOUNCE' | 'BREAK';
    outcome2R: 'BOUNCE' | 'BREAK';
    r1R: number;
    r2R: number;
  }> = [];

  for (const tf of RED_SNIPER_TIMEFRAMES) {
    const c = barsMap[tf] || [];
    const n = c.length;
    if (n < 15) continue;

    const A = atrSeries(c);
    const tfAtr = Math.max(0.1, A[n - 1] || 2.0);
    const maxAllowedHeight = settings.heightCapAtr * tfAtr;

    for (let i = 3; i < n - 6; i++) {
      const a = A[i - 1] || A[i];
      for (const dir of [-1, 1] as const) {
        let ext = dir < 0 ? 1e18 : -1e18;
        let extIdx = i + 1;
        const last = Math.min(n - 1, i + 3);
        for (let j = i + 1; j <= last; j++) {
          if (dir < 0) {
            if (c[j].low < ext) {
              ext = c[j].low;
              extIdx = j;
            }
          } else {
            if (c[j].high > ext) {
              ext = c[j].high;
              extIdx = j;
            }
          }
        }

        const ref =
          dir < 0
            ? Math.max(c[i].close, c[i].open)
            : Math.min(c[i].close, c[i].open);
        const move = Math.abs(ext - ref);
        const lo = c[i + 1];
        if (!lo) continue;
        const body = Math.abs(lo.close - lo.open);
        const rng = lo.high - lo.low || 1e-6;
        const firstOk =
          (dir < 0 ? lo.close < lo.open : lo.close > lo.open) &&
          body / rng >= 0.5 &&
          body >= 0.6 * a;
        if (move < 1.5 * a || !firstOk) continue;

        let s = i;
        for (let k = i - 1; k >= Math.max(0, i - 2); k--) {
          const x = c[k];
          if (
            Math.abs(x.close - x.open) <= 0.6 * a &&
            x.high >= Math.min(c[s].low, c[s].high) &&
            x.low <= c[s].high
          ) {
            s = k;
          } else {
            break;
          }
        }

        let top = -1e18;
        let bot = 1e18;
        let bt = -1e18;
        let bb = 1e18;
        for (let k = s; k <= i; k++) {
          top = Math.max(top, c[k].high);
          bot = Math.min(bot, c[k].low);
          bt = Math.max(bt, c[k].open, c[k].close);
          bb = Math.min(bb, c[k].open, c[k].close);
        }

        let boxTop = Number(top.toFixed(2));
        let boxBottom = Number((settings.zoneMode === 'WICK' ? bot : bb).toFixed(2));
        if (settings.zoneMode === 'BODY') {
          if (dir < 0) boxBottom = Number(bb.toFixed(2));
          else {
            boxBottom = Number(bot.toFixed(2));
            boxTop = Number(bt.toFixed(2));
          }
        }

        if (boxTop - boxBottom < 0.3) continue;
        if (maxAllowedHeight > 0 && boxTop - boxBottom > maxAllowedHeight + 1e-6) {
          if (dir < 0) boxTop = Number((boxBottom + maxAllowedHeight).toFixed(2));
          else boxBottom = Number((boxTop - maxAllowedHeight).toFixed(2));
        }

        const supply = dir < 0;
        const side: ZoneSide = supply ? 'SELL' : 'BUY';

        // 1) Find evaluation time T (first touch after leg-out)
        let lifecycleStart = Math.min(i + 4, extIdx + 1);
        let touchIdx = -1;
        for (let k = lifecycleStart; k < n; k++) {
          const x = c[k];
          const ak = A[k] || a;
          const tol = 0.1 * ak;
          const touched = supply
            ? x.high >= boxBottom - tol
            : x.low <= boxTop + tol;
          if (touched) {
            touchIdx = k;
            break;
          }
        }

        if (touchIdx === -1) continue;

        // Compute metrics using ONLY candles up to touchIdx (<= T)
        const subBars = c.slice(0, touchIdx + 1);
        const subSubAtr = A[touchIdx] || a;
        const dep = move / subSubAtr;
        const baseN = i - s + 1;
        const initScore =
          (dep >= 3 ? 4 : dep >= 2 ? 3 : 2) +
          4 +
          (baseN <= 1 ? 2 : baseN === 2 ? 1 : 0);

        // Sub HTF bias at T using only bars up to touchIdx
        const subBars1h = tf === '1h' || tf === '4h' || tf === '1d' ? subBars : (barsMap['1h'] || []).filter(b => b.time <= c[touchIdx].time);
        const subBars4h = tf === '4h' || tf === '1d' ? subBars : (barsMap['4h'] || []).filter(b => b.time <= c[touchIdx].time);
        const bias1h = computeTfBias(subBars1h).bias;
        const bias4h = computeTfBias(subBars4h).bias;

        const volMult = computeBaseAndLegRelativeTickVolume(subBars, s, Math.min(i, touchIdx));
        const { power: powerAtT } = computeZonePowerAndBreakdown({
          side,
          score: initScore,
          retests: 1,
          pctLeft: 100,
          departureAtr: dep,
          volMult,
          bias1h,
          bias4h,
          weights: {
            score: settings.weightScore,
            volume: settings.weightVolume,
            freshness: settings.weightFreshness,
            htf: settings.weightHtf,
          },
        });

        // Use candles after touchIdx to decide outcome (+1R and +2R)
        const zoneHeight = Math.max(0.3, boxTop - boxBottom);
        const rPts = zoneHeight + settings.slBuffer;
        const target1R = supply ? boxBottom - rPts : boxTop + rPts;
        const target2R = supply ? boxBottom - 2 * rPts : boxTop + 2 * rPts;

        let outcome1R: 'BOUNCE' | 'BREAK' = 'BREAK';
        let outcome2R: 'BOUNCE' | 'BREAK' = 'BREAK';
        let maxFav = 0;

        for (let m = touchIdx + 1; m < n; m++) {
          const xm = c[m];
          const am = A[m] || a;
          const closedBeyond = supply
            ? xm.close > boxTop + settings.deadAtr * am
            : xm.close < boxBottom - settings.deadAtr * am;

          const fav = supply ? boxBottom - xm.low : xm.high - boxTop;
          if (fav > maxFav) maxFav = fav;

          if (closedBeyond) {
            break;
          }

          const hit1 = supply ? xm.low <= target1R : xm.high >= target1R;
          if (hit1) {
            outcome1R = 'BOUNCE';
          }
          const hit2 = supply ? xm.low <= target2R : xm.high >= target2R;
          if (hit2) {
            outcome2R = 'BOUNCE';
          }
        }

        const r1Achieved = outcome1R === 'BOUNCE' ? clamp(Number(Math.max(1.0, maxFav / rPts).toFixed(2)), 1.0, 3.0) : -1.0;
        const r2Achieved = outcome2R === 'BOUNCE' ? clamp(Number(Math.max(2.0, maxFav / rPts).toFixed(2)), 2.0, 5.0) : -1.0;

        const touchTime = c[touchIdx].time;
        rawSamples.push({
          tf,
          side,
          bottom: boxBottom,
          top: boxTop,
          touchTime,
          touchIso: new Date(touchTime * 1000).toISOString(),
          powerAtT,
          outcome1R,
          outcome2R,
          r1R: r1Achieved,
          r2R: r2Achieved,
        });

        break;
      }
    }
  }

  // 2) Episode De-duplication across timeframes (overlap in price + touchTime within 30 min -> keep highest TF)
  rawSamples.sort((a, b) => a.touchTime - b.touchTime);
  const independentSamples: typeof rawSamples = [];

  for (const sample of rawSamples) {
    const overlapIdx = independentSamples.findIndex((existing) => {
      const priceOverlap = Math.max(existing.bottom, sample.bottom) < Math.min(existing.top, sample.top);
      const timeClose = Math.abs(existing.touchTime - sample.touchTime) <= 1800;
      return priceOverlap && timeClose;
    });

    if (overlapIdx === -1) {
      independentSamples.push(sample);
    } else {
      const existing = independentSamples[overlapIdx];
      const existingRank = TF_RANK_MAP[existing.tf] ?? 0;
      const sampleRank = TF_RANK_MAP[sample.tf] ?? 0;
      if (sampleRank > existingRank) {
        independentSamples[overlapIdx] = sample;
      }
    }
  }

  // 3) Out-of-sample split: older 70% TRAIN, newest 30% TEST
  independentSamples.sort((a, b) => a.touchTime - b.touchTime);
  const splitIdx = Math.floor(independentSamples.length * 0.7);
  const trainSamples = independentSamples.slice(0, splitIdx);
  const testSamples = independentSamples.slice(splitIdx);

  const bucketDefs: Array<{ label: PowerBucketLabel; min: number; max: number }> = [
    { label: '<40', min: 0, max: 39 },
    { label: '40-59', min: 40, max: 59 },
    { label: '60-79', min: 60, max: 79 },
    { label: '80+', min: 80, max: 100 },
  ];

  const historyWindowDays = winInfo.windowSeconds / 86400;
  const isWindowAtLeast5Days = historyWindowDays >= 5;

  const computeBuckets = (samples: typeof independentSamples, target: '1R' | '2R'): PowerCalibrationBucket[] => {
    return bucketDefs.map((def) => {
      const items = samples.filter((s) => s.powerAtT >= def.min && s.powerAtT <= def.max);
      const n = items.length;
      const bounces = items.filter((i) => (target === '1R' ? i.outcome1R === 'BOUNCE' : i.outcome2R === 'BOUNCE')).length;
      const breaks = n - bounces;
      const bouncePct = n > 0 ? Math.round((bounces / n) * 100) : 0;
      const sumR = items.reduce((acc, i) => acc + (target === '1R' ? i.r1R : i.r2R), 0);
      const avgR = n > 0 ? Number((sumR / n).toFixed(2)) : 0;
      const reliable = n >= 30 && isWindowAtLeast5Days;
      return {
        bucket: def.label,
        n,
        bounces,
        breaks,
        bouncePct,
        avgR,
        reliable,
        note: reliable ? null : 'SMALL SAMPLE - NOT RELIABLE',
      };
    });
  };

  const trainBuckets1R = computeBuckets(trainSamples.length > 0 ? trainSamples : independentSamples, '1R');
  const testBuckets1R = computeBuckets(testSamples, '1R');
  const trainBuckets2R = computeBuckets(trainSamples.length > 0 ? trainSamples : independentSamples, '2R');

  // Check TEST table predictive condition: bounce spread < 10 points across populated buckets -> not predictive yet
  const populatedTest = testBuckets1R.filter((b) => b.n > 0);
  let isPredictive = true;
  if (populatedTest.length >= 2) {
    const bouncePcts = populatedTest.map((b) => b.bouncePct);
    const spread = Math.max(...bouncePcts) - Math.min(...bouncePcts);
    if (spread < 10) {
      isPredictive = false;
    }
  }

  // TF Group breakdown (1m-5m, 15m-30m, 1h-1d)
  const tfGroupBuckets: Record<'1m-5m' | '15m-30m' | '1h-1d', PowerCalibrationBucket[]> = {
    '1m-5m': computeBuckets(independentSamples.filter((s) => getTfGroupKey(s.tf) === '1m-5m'), '1R'),
    '15m-30m': computeBuckets(independentSamples.filter((s) => getTfGroupKey(s.tf) === '15m-30m'), '1R'),
    '1h-1d': computeBuckets(independentSamples.filter((s) => getTfGroupKey(s.tf) === '1h-1d'), '1R'),
  };

  // Sample audit (up to 10 sample zones)
  const sampleAudit: CalibrationSampleAudit[] = independentSamples.slice(0, 10).map((s, idx) => ({
    zoneId: `sample-${idx}-${s.tf}-${s.touchTime}`,
    tf: s.tf,
    side: s.side,
    bottom: s.bottom,
    top: s.top,
    touchTime: s.touchTime,
    touchIso: s.touchIso,
    powerAtT: s.powerAtT,
    outcome1R: s.outcome1R,
    outcome2R: s.outcome2R,
    r1R: s.r1R,
    r2R: s.r2R,
  }));

  const isReliableWindow = isWindowAtLeast5Days && independentSamples.length >= 30;

  return {
    totalResolved: rawSamples.length,
    independentSamplesCount: independentSamples.length,
    windowSeconds: winInfo.windowSeconds,
    candlesCount: winInfo.candlesCount,
    windowLabel: winInfo.windowLabel,
    isReliableWindow,
    isPredictive,
    summaryLabel: !isPredictive
      ? 'POWER NOT PREDICTIVE YET'
      : isReliableWindow
      ? 'CALIBRATION RELIABLE'
      : 'SMALL SAMPLE - NOT RELIABLE',
    trainBuckets1R,
    testBuckets1R,
    trainBuckets2R,
    testBuckets2R: trainBuckets1R, // fallback
    tfGroupBuckets,
    sampleAudit,
    buckets: trainBuckets1R,
  };
}

// ============================================================================
// D.2) REPLAY MODE ("REPLAY - NOT LIVE", 24H M1 @ 20x, SEPARATE DEMO STATE)
// ============================================================================

export interface ReplaySessionState {
  isRunning: boolean;
  isFinished: boolean;
  currentIndex: number;
  totalBars: number;
  windowSeconds: number;
  windowLabel: string;
  isReliableSample: boolean;
  summaryLabel: string;
  currentTimeSec: number | null;
  currentPrice: number | null;
  demoState: RedSniperDemoState;
  peakEquity: number;
  maxDrawdownDollars: number;
  maxDrawdownPct: number;
  trailingMoves: ReplayTrailingMove[];
}

export function createInitialReplaySession(m1Bars: Candle[]): ReplaySessionState {
  const cutoffSec =
    m1Bars.length > 0 ? m1Bars[m1Bars.length - 1].time - 86_400 : 0;
  const last24hBars =
    cutoffSec > 0 ? m1Bars.filter((b) => b.time >= cutoffSec) : m1Bars;
  const totalBars = last24hBars.length;
  const startIdx = Math.min(20, Math.max(0, totalBars - 1));
  const startBar = last24hBars[startIdx] || null;
  const winInfo = formatReplayWindowLabel(last24hBars);

  return {
    isRunning: true,
    isFinished: totalBars === 0,
    currentIndex: startIdx,
    totalBars,
    windowSeconds: winInfo.windowSeconds,
    windowLabel: winInfo.windowLabel,
    isReliableSample: false,
    summaryLabel: 'SMALL SAMPLE - NOT RELIABLE',
    currentTimeSec: startBar ? startBar.time : null,
    currentPrice: startBar ? startBar.close : null,
    demoState: {
      balance: 1000,
      autoEnabled: true,
      openTrades: [],
      closedTrades: [],
      usedZoneIds: [],
    },
    peakEquity: 1000,
    maxDrawdownDollars: 0,
    maxDrawdownPct: 0,
    trailingMoves: [],
  };
}

export function stepReplayM1Bar(
  replay: ReplaySessionState,
  barsMap: RedSniperBarsMap,
  settings: RedSniperSettings = DEFAULT_RED_SNIPER_SETTINGS
): ReplaySessionState {
  const m1All = barsMap['1m'] || [];
  if (m1All.length === 0 || replay.isFinished) {
    return { ...replay, isRunning: false, isFinished: true };
  }

  const cutoffSec = m1All[m1All.length - 1].time - 86_400;
  const m1ReplayPool = m1All.filter((b) => b.time >= cutoffSec);
  const idx = replay.currentIndex;
  const winInfo = formatReplayWindowLabel(m1ReplayPool);

  if (idx >= m1ReplayPool.length) {
    const isReliable =
      replay.demoState.closedTrades.length >= 10 && winInfo.isWindowAtLeast12h;
    return {
      ...replay,
      isRunning: false,
      isFinished: true,
      windowSeconds: winInfo.windowSeconds,
      windowLabel: winInfo.windowLabel,
      isReliableSample: isReliable,
      summaryLabel: isReliable
        ? 'REPLAY SAMPLE RELIABLE'
        : 'SMALL SAMPLE - NOT RELIABLE',
    };
  }

  const bar = m1ReplayPool[idx];
  const barEndGlobalIdx = m1All.findIndex((b) => b.time >= bar.time);
  const m1Slice =
    barEndGlobalIdx > 0
      ? m1All.slice(0, barEndGlobalIdx)
      : m1ReplayPool.slice(0, Math.max(1, idx));

  // Slice each timeframe to closed bars before bar.time (formingCandleIncluded = false so last closed candle is not sliced)
  const slicedMap: RedSniperBarsMap = {
    '1m': m1Slice,
    '3m': (barsMap['3m'] || []).filter((b) => b.time < bar.time),
    '5m': (barsMap['5m'] || []).filter((b) => b.time < bar.time),
    '15m': (barsMap['15m'] || []).filter((b) => b.time < bar.time),
    '30m': (barsMap['30m'] || []).filter((b) => b.time < bar.time),
    '1h': (barsMap['1h'] || []).filter((b) => b.time < bar.time),
    '4h': (barsMap['4h'] || []).filter((b) => b.time < bar.time),
    '1d': (barsMap['1d'] || []).filter((b) => b.time < bar.time),
  };

  const { allZones, verdict } = analyzeAllTimeframes(
    slicedMap,
    bar.open,
    settings,
    false
  );

  // Step through bar OHLC path (open -> low -> high -> close for bullish, open -> high -> low -> close for bearish)
  const pricePath =
    bar.close >= bar.open
      ? [bar.open, bar.low, bar.high, bar.close]
      : [bar.open, bar.high, bar.low, bar.close];

  let curDemo = replay.demoState;
  let peakEquity = replay.peakEquity;
  let maxDdDollars = replay.maxDrawdownDollars;
  let maxDdPct = replay.maxDrawdownPct;
  const nextTrailMoves = [...replay.trailingMoves];

  for (let pIdx = 0; pIdx < pricePath.length; pIdx++) {
    const px = pricePath[pIdx];
    const tickMs = bar.time * 1000 + pIdx * 15_000;
    const stepRes = stepAutoTraderOnTick(
      curDemo,
      px,
      allZones,
      verdict.bias1h,
      verdict.bias4h,
      'REPLAY',
      tickMs,
      settings,
      false
    );
    curDemo = stepRes.nextState;
    if (stepRes.trailMoves.length > 0) {
      nextTrailMoves.push(...stepRes.trailMoves);
    }

    const floating = curDemo.openTrades.reduce(
      (s, t) => s + computeOpenTradeFloatingPnl(t, px).totalPnl,
      0
    );
    const eq = curDemo.balance + floating;
    if (eq > peakEquity) peakEquity = eq;
    const ddDollars = Math.max(0, peakEquity - eq);
    const ddPct = peakEquity > 0 ? (ddDollars / peakEquity) * 100 : 0;
    if (ddDollars > maxDdDollars) maxDdDollars = Number(ddDollars.toFixed(2));
    if (ddPct > maxDdPct) maxDdPct = Number(ddPct.toFixed(2));
  }

  const nextIdx = idx + 1;
  const done = nextIdx >= m1ReplayPool.length;
  const isReliable =
    curDemo.closedTrades.length >= 10 && winInfo.isWindowAtLeast12h;

  return {
    isRunning: !done,
    isFinished: done,
    currentIndex: nextIdx,
    totalBars: m1ReplayPool.length,
    windowSeconds: winInfo.windowSeconds,
    windowLabel: winInfo.windowLabel,
    isReliableSample: isReliable,
    summaryLabel: isReliable
      ? 'REPLAY SAMPLE RELIABLE'
      : 'SMALL SAMPLE - NOT RELIABLE',
    currentTimeSec: bar.time,
    currentPrice: bar.close,
    demoState: curDemo,
    peakEquity: Number(peakEquity.toFixed(2)),
    maxDrawdownDollars: maxDdDollars,
    maxDrawdownPct: maxDdPct,
    trailingMoves: nextTrailMoves,
  };
}

export function runReplay24hToCompletion(
  barsMap: RedSniperBarsMap,
  settings: RedSniperSettings = DEFAULT_RED_SNIPER_SETTINGS
): ReplaySessionState {
  let state = createInitialReplaySession(barsMap['1m'] || []);
  let guard = 0;
  while (!state.isFinished && guard < 6000) {
    state = stepReplayM1Bar(state, barsMap, settings);
    guard++;
  }
  return state;
}
