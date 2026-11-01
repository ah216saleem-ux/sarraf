import {
  Candle,
  RedSniperBarsMap,
  RedSniperTimeframe,
  RED_SNIPER_TIMEFRAMES,
} from './feed';

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
  | 'dead:closeBeyond';

export interface RedSniperSettings {
  maxZonesPerTf: number; // 3-8, default 6
  zoneMode: ZoneMode; // 'WICK' | 'BODY', default 'WICK'
  retestMode: RetestMode; // 'CANDLE' | 'ATR' | 'TOUCH_CANDLES'
  retestModeOverride: boolean; // false = AUTO per-TF default (independent retests for 1m-30m, TOUCH_CANDLES for 1H/4H/1D)
  retestGapAtr: number; // 0.1-0.75, default 0.25
  heightCapAtr: number; // 1.0-3.0, default 2.0
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
  showConsumedZones: boolean; // default false (hide pctLeft=0 zones from chart and bot by default)
  weightScore: number; // default 0.40
  weightVolume: number; // default 0.25
  weightFreshness: number; // default 0.20
  weightHtf: number; // default 0.15
}

export const RED_SNIPER_SETTINGS_STORAGE_KEY = 'redSniperSettings.v3';

export const DEFAULT_RED_SNIPER_SETTINGS: RedSniperSettings = {
  maxZonesPerTf: 6,
  zoneMode: 'WICK',
  retestMode: 'CANDLE',
  retestModeOverride: false,
  retestGapAtr: 0.25,
  heightCapAtr: 2.0,
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
  dep: number;
  baseN: number;
  tests: number;
  independentRetests: number;
  touchCandles: number;
  pctLeft: number;
  consumed?: boolean;
  sweep: boolean;
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
  time: number; // origin base candle time (c[startIdx].time)
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
  trimmed: boolean;
  weak: boolean;
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
  zones: RedSniperZone[]; // All selected zones for this TF (including >6 if within 4*ATR, and consumed zones with consumed=true)
  chartZones: RedSniperZone[]; // Nearest <= maxZones non-FAR and non-consumed zones (unless showFarZones / showConsumedZones)
  debugAliveZones: ZoneDebugEntry[]; // All alive zones BEFORE selection + dead:closeBeyond entries
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
  | 'ZONE_DETECTED'
  | 'ENTRY'
  | 'TP1_BE'
  | 'TRAIL_MOVE'
  | 'EXIT';

export interface BotLogEntry {
  id: string;
  ts: number; // ms
  isoTime: string;
  type: BotLogEventType;
  tf?: RedSniperTimeframe;
  side?: 'BUY' | 'SELL';
  zoneId?: string;
  tradeId?: string;
  message: string;
  details?: Record<string, any>;
}

export const RED_SNIPER_DEMO_STORAGE_KEY = 'redSniperDemo';
export const RED_SNIPER_BOT_LOG_STORAGE_KEY = 'redSniperBotLog.v1';

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Helper for independent retest calculation (away-gated: CANDLE for 1m-5m, ATR for 15m+).
 */
export function resolveIndependentRetestModeForTf(
  tf: RedSniperTimeframe
): 'CANDLE' | 'ATR' {
  return tf === '1m' || tf === '3m' || tf === '5m' ? 'CANDLE' : 'ATR';
}

/**
 * 2) RETEST MODE defaults:
 * AUTO = independent retests for 1m-30m (CANDLE for 1m-5m, ATR for 15m-30m)
 * and TOUCH_CANDLES for 1H, 4H, 1D.
 */
export function resolveDefaultRetestModeForTf(tf: RedSniperTimeframe): RetestMode {
  if (tf === '1h' || tf === '4h' || tf === '1d') {
    return 'TOUCH_CANDLES';
  }
  return resolveIndependentRetestModeForTf(tf);
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
        ? Number(clamp(raw.heightCapAtr, 1.0, 3.0).toFixed(2))
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
 * Rolling 14-bar simple moving average of True Range.
 */
export function atrSeries(
  c: Array<Pick<Candle, 'high' | 'low' | 'close'>>,
  n: number = 14
): number[] {
  const a: number[] = [];
  const tr = c.map((x, i) =>
    i
      ? Math.max(
          x.high - x.low,
          Math.abs(x.high - c[i - 1].close),
          Math.abs(x.low - c[i - 1].close)
        )
      : x.high - x.low
  );
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    s += tr[i];
    if (i >= n) s -= tr[i - n];
    a.push(s / Math.min(i + 1, n));
  }
  return a;
}

/**
 * Scan raw alive base zones for a given depMult (1.5 standard, or 1.2 for weak retry).
 * Applies:
 * - Height cap <= heightCapAtr * ATR14 of its timeframe (trimming the FAR/distal side and keeping the proximal edge).
 * - Lifecycle after departure leg:
 *   - Dead when a CLOSE is beyond the far edge by > 0.25 * ATR.
 *   - Retest counted when any wick enters the box (with 0.1 * ATR14 tolerance beyond the proximal edge) after having been "away"
 *     (closed outside the box for >= 1 candle AND moved >= retestGapAtr * ATR14 from the proximal edge).
 *   - Any zone with tests >= 1 is TESTED (if pctLeft >= 60) or DEEP, never FRESH.
 */
function scanCandidatesPass(
  c: Array<Pick<Candle, 'time' | 'open' | 'high' | 'low' | 'close'>>,
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
  }
): { alive: RawBaseZone[]; dead: RawBaseZone[] } {
  const n = c.length;
  if (n < 5) return { alive: [], dead: [] };
  const tfAtr = Math.max(0.1, A[n - 1] || 2.0);
  const maxAllowedHeight = params.heightCapAtr * tfAtr;
  const effectiveIndependentMode =
    params.retestMode === 'TOUCH_CANDLES'
      ? resolveIndependentRetestModeForTf(tf)
      : params.retestMode;
  const useAtrGap = effectiveIndependentMode === 'ATR';
  const alive: RawBaseZone[] = [];
  const deadList: RawBaseZone[] = [];

  for (let i = 3; i < n - 1; i++) {
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
      const body = Math.abs(lo.close - lo.open);
      const rng = lo.high - lo.low || 1e-6;
      const minFirstBodyAtr = params.weak ? 0.5 : 0.6;
      const firstOk =
        (dir < 0 ? lo.close < lo.open : lo.close > lo.open) &&
        body / rng >= 0.5 &&
        body >= minFirstBodyAtr * a;
      if (move < params.depMult * a || !firstOk) continue;

      const b0 = c[i];
      if (
        dir < 0
          ? b0.close < b0.open && Math.abs(b0.close - b0.open) > 0.7 * a
          : b0.close > b0.open && Math.abs(b0.close - b0.open) > 0.7 * a
      ) {
        continue;
      }

      let s = i;
      for (let k = i - 1; k >= Math.max(0, i - params.maxBase + 1); k--) {
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
      let boxBottom = Number((params.mode === 'WICK' ? bot : bb).toFixed(2));
      if (params.mode === 'BODY') {
        if (dir < 0) {
          boxBottom = Number(bb.toFixed(2));
        } else {
          boxBottom = Number(bot.toFixed(2));
          boxTop = Number(bt.toFixed(2));
        }
      }

      if (boxTop - boxBottom < params.minH) continue;

      const untrimmedTop = boxTop;
      const untrimmedBottom = boxBottom;
      let trimmed = false;

      // 1) HEIGHT CAP: trim ONLY zones taller than heightCapAtr * ATR14 (default 2.0 * ATR14).
      // Un-trimmed zones keep their exact real base high-low.
      if (maxAllowedHeight > 0 && boxTop - boxBottom > maxAllowedHeight + 1e-6) {
        trimmed = true;
        if (dir < 0) {
          // Supply (SELL): keep proximal (bottom), trim distal (top)
          boxTop = Number((boxBottom + maxAllowedHeight).toFixed(2));
        } else {
          // Demand (BUY): keep proximal (top), trim distal (bottom)
          boxBottom = Number((boxTop - maxAllowedHeight).toFixed(2));
        }
      }

      const z: RawBaseZone = {
        tf,
        supply: dir < 0,
        time: c[s].time,
        startIdx: s,
        endIdx: i,
        top: boxTop,
        bottom: boxBottom,
        untrimmedTop,
        untrimmedBottom,
        trimmed,
        weak: params.weak,
        dep: move / a,
        baseN: i - s + 1,
        tests: 0,
        independentRetests: 0,
        touchCandles: 0,
        pctLeft: 100,
        sweep: false,
        state: 'FRESH',
        score: 0,
      };

      const h = Math.max(0.01, z.top - z.bottom);
      let independentRetests = 0;
      let touchCandles = 0;
      let pen = 0;
      let dead = false;
      let deadCandleTime: number | undefined;
      let deadBeyondAtr: number | undefined;
      let sweep = false;

      // Determine the first bar where price has closed outside the box (and moved >= retestGapAtr * ATR if in ATR mode)
      let lifecycleStart = Math.min(i + 4, extIdx + 1);
      for (let j = i + 1; j <= last; j++) {
        const xj = c[j];
        const aj = A[j] || a;
        const closedOut = z.supply ? xj.close < z.bottom : xj.close > z.top;
        const distProx = z.supply ? z.bottom - xj.low : xj.high - z.top;
        const gapOk = !useAtrGap || distProx >= params.retestGapAtr * aj;
        if (closedOut && gapOk) {
          lifecycleStart = j + 1;
          break;
        }
      }

      let away = true;
      let closedOutsideSinceTouch = true;
      let movedGapSinceTouch = true;

      for (let k = lifecycleStart; k < n; k++) {
        const x = c[k];
        const ak = A[k] || a;

        // 3) DEAD RULE: ONLY a close beyond far edge by > deadAtr * ATR kills the zone
        const beyondDistal = z.supply
          ? x.close - z.top
          : z.bottom - x.close;
        if (beyondDistal > params.deadAtr * ak) {
          dead = true;
          deadCandleTime = x.time;
          deadBeyondAtr = Number((beyondDistal / ak).toFixed(2));
          break;
        }

        // 4) RETEST COUNT + 5) RETEST COUNT COMPARISON (independentRetests vs touchCandles):
        // touchCandles = number of candles whose range touches the box after the leg-out.
        // independentRetests = away-gated retests (CANDLE or ATR mode).
        const tol = params.retestTolAtr * ak;
        const touchedWithTol = z.supply
          ? x.high >= z.bottom - tol && x.low <= z.top
          : x.low <= z.top + tol && x.high >= z.bottom;
        const strictlyInsideBox = z.supply
          ? x.high >= z.bottom && x.low <= z.top
          : x.low <= z.top && x.high >= z.bottom;

        if (touchedWithTol) {
          touchCandles++;
        }

        const isTouchCandle = away ? touchedWithTol : strictlyInsideBox;

        if (isTouchCandle) {
          if (away) {
            independentRetests++;
            away = false;
            closedOutsideSinceTouch = false;
            movedGapSinceTouch = !useAtrGap;
          }
          const rawPen = z.supply
            ? (x.high - z.bottom) / h
            : (z.top - x.low) / h;
          const clampedPen = Math.max(0.01, Math.min(1, rawPen));
          pen = Math.max(pen, clampedPen);

          if (
            z.supply
              ? x.high > z.top && x.close <= z.top
              : x.low < z.bottom && x.close >= z.bottom
          ) {
            sweep = true;
          }
        } else {
          const closedOutside = z.supply
            ? x.close < z.bottom
            : x.close > z.top;
          if (closedOutside) {
            closedOutsideSinceTouch = true;
          }
          if (useAtrGap) {
            const distFromProximal = z.supply
              ? z.bottom - x.low
              : x.high - z.top;
            if (distFromProximal >= params.retestGapAtr * ak) {
              movedGapSinceTouch = true;
            }
          } else {
            movedGapSinceTouch = true;
          }
          if (closedOutsideSinceTouch && movedGapSinceTouch) {
            away = true;
          }
        }
      }

      const activeTests =
        params.retestMode === 'TOUCH_CANDLES' ? touchCandles : independentRetests;

      z.independentRetests = independentRetests;
      z.touchCandles = touchCandles;
      z.tests = activeTests;
      z.pctLeft =
        activeTests === 0
          ? 100
          : Math.min(99, Math.max(0, Math.round(100 * (1 - pen))));
      z.consumed = z.pctLeft <= 0;
      z.sweep = sweep;
      z.state = resolveZoneStatus(activeTests, z.pctLeft);
      z.score =
        (z.dep >= 3 ? 4 : z.dep >= 2 ? 3 : 2) +
        (activeTests === 0 ? 4 : activeTests === 1 ? 2 : activeTests === 2 ? 1 : 0) +
        (z.baseN <= 1 ? 2 : z.baseN === 2 ? 1 : 0);

      if (dead) {
        z.dead = true;
        z.deadCandleTime = deadCandleTime;
        z.deadBeyondAtr = deadBeyondAtr;
        z.droppedReason = 'dead:closeBeyond';
        deadList.push(z);
        continue;
      }

      alive.push(z);
      break;
    }
  }

  return { alive, dead: deadList };
}

/**
 * 1) OVERLAP RULE: compute overlap ratio of two zones relative to the SMALLER zone's height.
 * Remove a same-side zone ONLY if it overlaps another same-side zone by >= 70% of the smaller zone's height.
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
 * Full zone detection + deduplication + weak retry + selection pipeline.
 * Returns selected zones, all alive zones BEFORE selection (with droppedReason), and dead:closeBeyond zones.
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
} {
  const defaultRetestMode = resolveDefaultRetestModeForTf(tf);
  const S = {
    depMult: o.depMult ?? 1.5,
    maxBase: o.maxBase ?? 3,
    minH: o.minH ?? 0.3,
    mode: o.mode ?? ('WICK' as ZoneMode),
    maxZones: o.maxZones ?? 6,
    retestMode: o.retestMode ?? defaultRetestMode,
    retestGapAtr: o.retestGapAtr ?? 0.25,
    retestTolAtr: o.retestTolAtr ?? 0.1,
    heightCapAtr: o.heightCapAtr ?? 2.0,
    deadAtr: o.deadAtr ?? 0.25,
    farAtr: clamp(o.farAtr ?? 25, 10, 60),
    enableWeakRetry: o.enableWeakRetry ?? true,
  };

  const n = c.length;
  if (n < 5) {
    return {
      selected: [],
      allAliveBeforeSelection: [],
      deadBeforeSelection: [],
      retestModeUsed: S.retestMode,
      atr14: 2.0,
      livePrice: n > 0 ? c[n - 1].close : 0,
    };
  }

  const A = atrSeries(c);
  const atr14 = Math.max(0.1, A[n - 1] || 2.0);
  const px =
    typeof o.livePrice === 'number' && Number.isFinite(o.livePrice) && o.livePrice > 0
      ? o.livePrice
      : c[n - 1].close;

  // Pass 1: Standard detection (depMult = 1.5)
  const pass1 = scanCandidatesPass(c, tf, A, {
    ...S,
    weak: false,
  });

  // Filter to valid side relative to live price (supply above price, demand below price, plus zones price is inside)
  const sideValidStandard = pass1.alive.filter((z) =>
    z.supply ? z.bottom >= px - 1 : z.top <= px + 1
  );

  // Sort by score desc, then newer time desc for >= 70% overlap deduplication
  sideValidStandard.sort((x, y) => y.score - x.score || y.time - x.time);

  const dedupedAlive: RawBaseZone[] = [];
  const allAlive: RawBaseZone[] = [];

  for (const z of sideValidStandard) {
    let maxOverlapRatio = 0;
    for (const orig of dedupedAlive) {
      if (orig.supply !== z.supply) continue;
      const ratio = computeSameSideOverlapRatio(orig, z);
      if (ratio > maxOverlapRatio) maxOverlapRatio = ratio;
    }
    const overlapPct = Math.round(maxOverlapRatio * 100);
    // 1) OVERLAP RULE: remove a same-side zone ONLY if it overlaps another same-side zone by >= 70% of the SMALLER zone's height
    if (maxOverlapRatio >= 0.7) {
      allAlive.push({
        ...z,
        overlapPct,
        overlapDecision: `dropped:overlap>=70%(${overlapPct}%)`,
        droppedReason: 'overlap',
      });
    } else {
      const overlapDecision =
        overlapPct > 0 ? `kept:partial(${overlapPct}%<70%)` : 'kept:no-overlap';
      const copy: RawBaseZone = {
        ...z,
        overlapPct,
        overlapDecision,
        droppedReason: 'kept',
      };
      dedupedAlive.push(copy);
      allAlive.push(copy);
    }
  }

  // 4) LOW-ZONE TIMEFRAMES: if fewer than 4 alive zones, rerun detection with depMult 1.2 and merge extra zones tagged "weak"
  if (S.enableWeakRetry && dedupedAlive.length < 4 && S.depMult > 1.2) {
    const passWeak = scanCandidatesPass(c, tf, A, {
      ...S,
      depMult: 1.2,
      weak: true,
    });
    const sideValidWeak = passWeak.alive
      .filter((z) => (z.supply ? z.bottom >= px - 1 : z.top <= px + 1))
      .sort((x, y) => y.score - x.score || y.time - x.time);

    for (const wz of sideValidWeak) {
      const sameOrigin = allAlive.some(
        (existing) =>
          existing.supply === wz.supply &&
          existing.startIdx === wz.startIdx &&
          existing.endIdx === wz.endIdx
      );
      if (sameOrigin) continue;

      let maxOverlapRatio = 0;
      for (const orig of dedupedAlive) {
        if (orig.supply !== wz.supply) continue;
        const ratio = computeSameSideOverlapRatio(orig, wz);
        if (ratio > maxOverlapRatio) maxOverlapRatio = ratio;
      }
      const overlapPct = Math.round(maxOverlapRatio * 100);
      if (maxOverlapRatio >= 0.7) {
        allAlive.push({
          ...wz,
          overlapPct,
          overlapDecision: `dropped:overlap>=70%(${overlapPct}%)`,
          droppedReason: 'overlap',
        });
      } else {
        const overlapDecision =
          overlapPct > 0 ? `kept:partial(${overlapPct}%<70%)` : 'kept:no-overlap';
        const copy: RawBaseZone = {
          ...wz,
          overlapPct,
          overlapDecision,
          droppedReason: 'kept',
        };
        dedupedAlive.push(copy);
        allAlive.push(copy);
      }
    }
  }

  // 2) SELECTION (chosen AFTER the >= 70% overlap rule):
  // Rank all alive zones by score - distance/(8 * ATR14).
  // Keep the best maxZones (default 6, up to 8), AND always keep every alive zone within 4 * ATR14 of live price.
  // Zones further than farAtr * ATR14 (default 25 * ATR14) are FAR.
  const getDist = (z: RawBaseZone): number => {
    if (px >= z.bottom && px <= z.top) return 0;
    return px < z.bottom ? z.bottom - px : px - z.top;
  };
  const rank = (z: RawBaseZone): number =>
    z.score - Math.abs((z.top + z.bottom) / 2 - px) / (atr14 * 8);

  const nearThreshold = 4 * atr14;
  const farThreshold = S.farAtr * atr14;

  const sortedByRank = [...dedupedAlive].sort((a, b) => rank(b) - rank(a));
  const keptSet = new Set<RawBaseZone>();

  // Always keep every alive zone within 4 * ATR14 of live price (never dropped)
  for (const z of sortedByRank) {
    if (getDist(z) <= nearThreshold) {
      keptSet.add(z);
    }
  }

  // Fill up to S.maxZones with the highest-ranked non-FAR alive zones first
  for (const z of sortedByRank) {
    if (keptSet.size >= S.maxZones) break;
    if (getDist(z) <= farThreshold) {
      keptSet.add(z);
    }
  }

  // If still under S.maxZones, allow top-ranked FAR zones into the list (marked isFar)
  for (const z of sortedByRank) {
    if (keptSet.size >= S.maxZones) break;
    keptSet.add(z);
  }

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
      z.droppedReason = getDist(z) > farThreshold ? 'far' : 'cap';
    }
  }

  // Include all dead:closeBeyond zones so debug JSON can inspect why and when they were killed
  const sideValidDead = [...pass1.dead].sort((a, b) => b.top - a.top);
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

  return {
    selected,
    allAliveBeforeSelection: allAlive,
    deadBeforeSelection: sideValidDead,
    retestModeUsed: S.retestMode,
    atr14,
    livePrice: px,
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
  const closes = bars.map((b) => b.close);
  const ema20Arr = computeEmaSeries(closes, 20);
  const ema50Arr = computeEmaSeries(closes, 50);
  const lastIdx = bars.length - 1;
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
  const n = bars.length;
  if (n < 15) return [];

  const pivotLen = 5;
  let lastHigh: { idx: number; time: number; price: number; broken: boolean } | null = null;
  let lastLow: { idx: number; time: number; price: number; broken: boolean } | null = null;
  let trend: 1 | -1 | 0 = 0;
  const events: StructureEvent[] = [];

  for (let i = pivotLen * 2; i < n; i++) {
    const pIdx = i - pivotLen;
    const pBar = bars[pIdx];
    let isHigh = true;
    let isLow = true;

    for (let k = pIdx - pivotLen; k <= pIdx + pivotLen; k++) {
      if (k === pIdx) continue;
      if (bars[k].high >= pBar.high) isHigh = false;
      if (bars[k].low <= pBar.low) isLow = false;
    }

    if (isHigh) {
      lastHigh = { idx: pIdx, time: pBar.time, price: pBar.high, broken: false };
    }
    if (isLow) {
      lastLow = { idx: pIdx, time: pBar.time, price: pBar.low, broken: false };
    }

    const bar = bars[i];
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
 * 2) FAR RULE: zones further than farAtr * ATR14 (default 25 * ATR14) are marked FAR,
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

/**
 * 5) DUPLICATES: in the ALL-TIMEFRAMES list, merge zones from different timeframes
 * whose boxes overlap > 70% into one row with badges ("5m 15m"), keeping the strongest power.
 */
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
  // Sort by power desc, then score desc so the strongest power zone becomes the primary row
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
      // Both boxes overlap > 70% (and neither box is more than 2x the other's height)
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
    } else {
      merged.push({
        ...z,
        mergedTfs: [z.tf],
      });
    }
  }

  return merged;
}

/**
 * Analyze a single timeframe on its OWN candles.
 */
export function analyzeTimeframe(
  tf: RedSniperTimeframe,
  bars: Candle[],
  bias1h: TfBias,
  bias4h: TfBias,
  livePriceOverride?: number | null,
  settings: RedSniperSettings = DEFAULT_RED_SNIPER_SETTINGS
): TimeframeAnalysis {
  const { bias, ema20, ema50 } = computeTfBias(bars);
  const effectiveRetestMode: RetestMode = settings.retestModeOverride
    ? settings.retestMode
    : resolveDefaultRetestModeForTf(tf);

  if (!bars || bars.length < 5) {
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
    };
  }

  const effectiveBars: Candle[] =
    typeof livePriceOverride === 'number' &&
    Number.isFinite(livePriceOverride) &&
    livePriceOverride > 0
      ? bars.map((b, idx) =>
          idx === bars.length - 1
            ? {
                ...b,
                close: livePriceOverride,
                high: Math.max(b.high, livePriceOverride),
                low: Math.min(b.low, livePriceOverride),
              }
            : b
        )
      : bars;

  const structures = computeStructureEvents(tf, effectiveBars);

  const farAtr = clamp(settings.farAtr ?? 25, 10, 60);

  const audit = findZonesWithAudit(effectiveBars, tf, {
    mode: settings.zoneMode,
    maxZones: settings.maxZonesPerTf,
    retestMode: effectiveRetestMode,
    retestGapAtr: settings.retestGapAtr,
    heightCapAtr: settings.heightCapAtr,
    deadAtr: settings.deadAtr,
    farAtr,
    livePrice: livePriceOverride,
  });

  const atr14 = Number(audit.atr14.toFixed(2));
  const px = audit.livePrice;

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
    const consumed = rz.pctLeft <= 0;

    const volMult = computeBaseAndLegRelativeTickVolume(
      effectiveBars,
      rz.startIdx,
      rz.endIdx
    );

    const { power, htfOk, htfLabel, breakdown } = computeZonePowerAndBreakdown({
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

    const chartLabel = `${side} · ${status} · PWR ${power} · ${rz.pctLeft}% left · ${rz.tests}x`;

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
      trimmed: rz.trimmed,
      weak: rz.weak,
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

  const zones: RedSniperZone[] = audit.selected.map(toRedSniperZone);

  // 3) CONSUMED ZONES: hide zones with pctLeft = 0 from the chart by default (unless showConsumedZones is true).
  // They stay in the debug JSON and the list with a "consumed" tag.
  const chartPool = zones.filter(
    (z) =>
      (settings.showFarZones || !z.isFar) &&
      (settings.showConsumedZones || !z.consumed)
  );
  const chartZones = [...chartPool]
    .sort((a, b) => a.distancePts - b.distancePts || b.power - a.power)
    .slice(0, clamp(settings.maxZonesPerTf ?? 6, 3, 8))
    .sort((a, b) => b.top - a.top);

  const aliveDebugEntries: ZoneDebugEntry[] = audit.allAliveBeforeSelection.map(
    (rz) => {
      const z = toRedSniperZone(rz);
      let reasonDropped: ZoneDroppedReason = rz.droppedReason ?? 'kept';
      if (reasonDropped === 'kept' && z.isFar && !settings.showFarZones) {
        reasonDropped = 'far';
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

  return {
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
  };
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
  aliveAfterOverlapCount: number; // alive zones after >= 70% overlap rule
  aliveAtThisValueButDeadAt025: DeadAtrDiffZone[];
}

/**
 * 4) DEAD-RULE COMPARISON TOOL (dev only, in the debug export):
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

  const effectiveBars: Candle[] =
    typeof livePriceOverride === 'number' &&
    Number.isFinite(livePriceOverride) &&
    livePriceOverride > 0
      ? bars.map((b, idx) =>
          idx === bars.length - 1
            ? {
                ...b,
                close: livePriceOverride,
                high: Math.max(b.high, livePriceOverride),
                low: Math.min(b.low, livePriceOverride),
              }
            : b
        )
      : bars;

  const effectiveRetestMode: RetestMode = settings.retestModeOverride
    ? settings.retestMode
    : resolveDefaultRetestModeForTf(tf);

  const makeKey = (z: RawBaseZone): string =>
    `${z.supply ? 'SELL' : 'BUY'}-${z.startIdx}-${z.endIdx}-${z.bottom.toFixed(
      2
    )}-${z.top.toFixed(2)}`;

  const audit025 = findZonesWithAudit(effectiveBars, tf, {
    mode: settings.zoneMode,
    maxZones: settings.maxZonesPerTf,
    retestMode: effectiveRetestMode,
    retestGapAtr: settings.retestGapAtr,
    heightCapAtr: settings.heightCapAtr,
    deadAtr: 0.25,
    farAtr: settings.farAtr,
    livePrice: livePriceOverride,
  });
  const alive025Keys = new Set(audit025.allAliveBeforeSelection.map(makeKey));

  const thresholds = [0.25, 0.5, 0.75, 1.0];
  return thresholds.map((deadVal) => {
    const auditVal =
      deadVal === 0.25
        ? audit025
        : findZonesWithAudit(effectiveBars, tf, {
            mode: settings.zoneMode,
            maxZones: settings.maxZonesPerTf,
            retestMode: effectiveRetestMode,
            retestGapAtr: settings.retestGapAtr,
            heightCapAtr: settings.heightCapAtr,
            deadAtr: deadVal,
            farAtr: settings.farAtr,
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
              consumed: z.pctLeft <= 0,
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
  settings: RedSniperSettings = DEFAULT_RED_SNIPER_SETTINGS
): {
  byTf: Record<RedSniperTimeframe, TimeframeAnalysis>;
  allZones: RedSniperZone[];
  mergedZones: MergedRedSniperZone[];
  verdict: VerdictResult;
} {
  const verdict = computeMultiTimeframeVerdict(barsMap);
  const byTf = {} as Record<RedSniperTimeframe, TimeframeAnalysis>;
  const allZones: RedSniperZone[] = [];

  for (const tf of RED_SNIPER_TIMEFRAMES) {
    const analysis = analyzeTimeframe(
      tf,
      barsMap[tf] || [],
      verdict.bias1h,
      verdict.bias4h,
      livePriceOverride,
      settings
    );
    byTf[tf] = analysis;
    allZones.push(...analysis.zones);
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
 * 5) LIVE TRADE LOG ("BOT LOG") helpers: persisted in localStorage + server file, capped at last 200 entries.
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

export function loadBotLogFromLocalStorage(): BotLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RED_SNIPER_BOT_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return mergeBotLogEntries([], parsed, 200);
  } catch {
    return [];
  }
}

export function saveBotLogToLocalStorage(entries: BotLogEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    const capped = mergeBotLogEntries([], entries, 200);
    window.localStorage.setItem(
      RED_SNIPER_BOT_LOG_STORAGE_KEY,
      JSON.stringify(capped)
    );
  } catch {
    // Ignore storage quota errors
  }
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
        (settings.showConsumedZones || !z.consumed) &&
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
          (settings.showConsumedZones || !z.consumed) &&
          (z.status === 'FRESH' || z.status === 'TESTED') &&
          z.retests <= 1 &&
          z.power >= minPwr &&
          isZoneNear(z, livePrice, farAtr) &&
          livePrice >= z.bottom &&
          livePrice <= z.top &&
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

export interface PowerCalibrationResult {
  totalResolved: number;
  windowSeconds: number;
  candlesCount: number;
  windowLabel: string;
  isReliableWindow: boolean;
  summaryLabel: string;
  buckets: PowerCalibrationBucket[];
}

/**
 * Replays each historical zone on the loaded real candles across all timeframes:
 * - BOUNCE = price reached +1R (R = zone height + SL buffer) before a close-through (> deadAtr * ATR).
 * - BREAK = zone died first by closing beyond distal edge + deadAtr * ATR.
 * Groups by power bucket (<40, 40-59, 60-79, 80+): n, bounce %, avg R.
 * Refuses to show a confident summary when n < 10 or the M1 window is shorter than 12 hours ("SMALL SAMPLE - NOT RELIABLE").
 */
export function computePowerCalibration(
  barsMap: RedSniperBarsMap,
  settings: RedSniperSettings = DEFAULT_RED_SNIPER_SETTINGS
): PowerCalibrationResult {
  const verdict = computeMultiTimeframeVerdict(barsMap);
  const outcomes: Array<{ power: number; outcome: 'BOUNCE' | 'BREAK'; r: number }> = [];
  const winInfo = formatReplayWindowLabel(barsMap['1m'] || []);

  for (const tf of RED_SNIPER_TIMEFRAMES) {
    const c = barsMap[tf] || [];
    const n = c.length;
    if (n < 10) continue;

    const A = atrSeries(c);
    const tfAtr = Math.max(0.1, A[n - 1] || 2.0);
    const maxAllowedHeight = settings.heightCapAtr * tfAtr;

    for (let i = 3; i < n - 4; i++) {
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
        const body = Math.abs(lo.close - lo.open);
        const rng = lo.high - lo.low || 1e-6;
        const firstOk =
          (dir < 0 ? lo.close < lo.open : lo.close > lo.open) &&
          body / rng >= 0.5 &&
          body >= 0.6 * a;
        if (move < 1.5 * a || !firstOk) continue;

        const b0 = c[i];
        if (
          dir < 0
            ? b0.close < b0.open && Math.abs(b0.close - b0.open) > 0.7 * a
            : b0.close > b0.open && Math.abs(b0.close - b0.open) > 0.7 * a
        ) {
          continue;
        }

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
        const dep = move / a;
        const baseN = i - s + 1;
        // Initial score at formation (0 retests, 100% left)
        const initScore =
          (dep >= 3 ? 4 : dep >= 2 ? 3 : 2) +
          4 +
          (baseN <= 1 ? 2 : baseN === 2 ? 1 : 0);

        const volMult = computeBaseAndLegRelativeTickVolume(c, s, i);
        const { power } = computeZonePowerAndBreakdown({
          side,
          score: initScore,
          retests: 0,
          pctLeft: 100,
          departureAtr: dep,
          volMult,
          bias1h: verdict.bias1h,
          bias4h: verdict.bias4h,
          weights: {
            score: settings.weightScore,
            volume: settings.weightVolume,
            freshness: settings.weightFreshness,
            htf: settings.weightHtf,
          },
        });

        let lifecycleStart = Math.min(i + 4, extIdx + 1);
        for (let j = i + 1; j <= last; j++) {
          const xj = c[j];
          const closedOut = supply ? xj.close < boxBottom : xj.close > boxTop;
          if (closedOut) {
            lifecycleStart = j + 1;
            break;
          }
        }

        // Wait for first touch after departure
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

        if (touchIdx === -1) break;

        const zoneHeight = Math.max(0.3, boxTop - boxBottom);
        const rPts = zoneHeight + settings.slBuffer;
        const target1R = supply ? boxBottom - rPts : boxTop + rPts;
        let outcome: 'BOUNCE' | 'BREAK' | null = null;
        let maxFavorablePts = 0;

        for (let m = touchIdx; m < n; m++) {
          const xm = c[m];
          const am = A[m] || a;
          const closedBeyond = supply
            ? xm.close > boxTop + settings.deadAtr * am
            : xm.close < boxBottom - settings.deadAtr * am;

          if (m > touchIdx) {
            const fav = supply ? boxBottom - xm.low : xm.high - boxTop;
            if (fav > maxFavorablePts) maxFavorablePts = fav;
          } else {
            if (closedBeyond) {
              outcome = 'BREAK';
              break;
            }
          }

          if (closedBeyond) {
            outcome = 'BREAK';
            break;
          }

          const hit1R = supply ? xm.low <= target1R : xm.high >= target1R;
          if (hit1R) {
            outcome = 'BOUNCE';
            const fav = supply ? boxBottom - xm.low : xm.high - boxTop;
            if (fav > maxFavorablePts) maxFavorablePts = fav;
            break;
          }
        }

        if (outcome === 'BOUNCE') {
          const rAchieved = clamp(
            Number(Math.max(1.0, maxFavorablePts / rPts).toFixed(2)),
            1.0,
            3.0
          );
          outcomes.push({ power, outcome: 'BOUNCE', r: rAchieved });
        } else if (outcome === 'BREAK') {
          outcomes.push({ power, outcome: 'BREAK', r: -1.0 });
        }

        break;
      }
    }
  }

  const bucketDefs: Array<{
    label: PowerBucketLabel;
    min: number;
    max: number;
  }> = [
    { label: '<40', min: 0, max: 39 },
    { label: '40-59', min: 40, max: 59 },
    { label: '60-79', min: 60, max: 79 },
    { label: '80+', min: 80, max: 100 },
  ];

  const isReliableWindow =
    winInfo.isWindowAtLeast12h && outcomes.length >= 10;

  const buckets: PowerCalibrationBucket[] = bucketDefs.map((def) => {
    const items = outcomes.filter(
      (o) => o.power >= def.min && o.power <= def.max
    );
    const n = items.length;
    const bounces = items.filter((i) => i.outcome === 'BOUNCE').length;
    const breaks = items.filter((i) => i.outcome === 'BREAK').length;
    const bouncePct = n > 0 ? Math.round((bounces / n) * 100) : 0;
    const sumR = items.reduce((s, i) => s + i.r, 0);
    const avgR = n > 0 ? Number((sumR / n).toFixed(2)) : 0;
    const reliable = n >= 10 && winInfo.isWindowAtLeast12h;
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

  return {
    totalResolved: outcomes.length,
    windowSeconds: winInfo.windowSeconds,
    candlesCount: winInfo.candlesCount,
    windowLabel: winInfo.windowLabel,
    isReliableWindow,
    summaryLabel: isReliableWindow
      ? 'CALIBRATION RELIABLE'
      : 'SMALL SAMPLE - NOT RELIABLE',
    buckets,
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
    barEndGlobalIdx >= 0 ? m1All.slice(0, barEndGlobalIdx + 1) : m1ReplayPool.slice(0, idx + 1);

  // Slice each timeframe up to bar.time so there is zero lookahead bias
  const slicedMap: RedSniperBarsMap = {
    '1m': m1Slice,
    '3m': (barsMap['3m'] || []).filter((b) => b.time <= bar.time),
    '5m': (barsMap['5m'] || []).filter((b) => b.time <= bar.time),
    '15m': (barsMap['15m'] || []).filter((b) => b.time <= bar.time),
    '30m': (barsMap['30m'] || []).filter((b) => b.time <= bar.time),
    '1h': (barsMap['1h'] || []).filter((b) => b.time <= bar.time),
    '4h': (barsMap['4h'] || []).filter((b) => b.time <= bar.time),
    '1d': (barsMap['1d'] || []).filter((b) => b.time <= bar.time),
  };

  const { allZones, verdict } = analyzeAllTimeframes(
    slicedMap,
    bar.open,
    settings
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
