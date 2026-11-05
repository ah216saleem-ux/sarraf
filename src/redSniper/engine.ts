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
  | 'consumed'
  | 'dead:closeBeyond';

export let INDICATOR_PARITY_SHIFT = true;

export function setIndicatorParityShift(val: boolean): void {
  INDICATOR_PARITY_SHIFT = Boolean(val);
  resetZoneCacheStats();
}

export interface RedSniperSettings {
  maxZonesPerTf: number; // legacy total cap, default 5
  zonesPerSide: number; // 3-5, default 5 (newest N alive zones per side by creation order)
  hideConsumed: boolean; // default false (do NOT hide tested/consumed zones unless enabled)
  zoneMode: ZoneMode; // 'WICK' | 'BODY', default 'WICK'
  retestMode: RetestMode; // 'CANDLE' | 'ATR' | 'TOUCH_CANDLES'
  retestModeOverride: boolean; // false = AUTO per-TF default (ATR away-gated)
  retestGapAtr: number; // 0.1-0.75, default 0.25
  heightCapAtr: number; // 0.5-3.0, default 1.2
  deadAtr: number; // 0.0-1.0, default 0.0 (close beyond bottom/top)
  farAtr: number; // 10-60, default 25
  slBuffer: number; // $1-$3, default $1.5
  maxRiskPoints: number; // default $15 (0 = off)
  minPowerToTrade: number; // default 50
  trailTrigger: number; // $1-$2, default $2.0
  trailStep: number; // $1-$3, default $1.5
  riskPct: number; // default 1.5
  showBosChoch: boolean; // default false
  showFarZones: boolean; // default false
  showConsumedZones: boolean; // default true (mirrors !hideConsumed)
  weightScore: number; // default 0.40
  weightVolume: number; // default 0.25
  weightFreshness: number; // default 0.20
  weightHtf: number; // default 0.15
}

export const RED_SNIPER_SETTINGS_STORAGE_KEY = 'redSniperSettings.v3';

export const DEFAULT_RED_SNIPER_SETTINGS: RedSniperSettings = {
  maxZonesPerTf: 5,
  zonesPerSide: 5,
  hideConsumed: false,
  zoneMode: 'WICK',
  retestMode: 'ATR',
  retestModeOverride: false,
  retestGapAtr: 0.25,
  heightCapAtr: 1.2,
  deadAtr: 0,
  farAtr: 25,
  slBuffer: 1.5,
  maxRiskPoints: 15,
  minPowerToTrade: 50,
  trailTrigger: 2.0,
  trailStep: 1.5,
  riskPct: 1.5,
  showBosChoch: false,
  showFarZones: false,
  showConsumedZones: true,
  weightScore: 0.4,
  weightVolume: 0.25,
  weightFreshness: 0.2,
  weightHtf: 0.15,
};

export const PIVOT_LENGTH_BY_TF: Record<RedSniperTimeframe, number> = {
  '1m': 5,
  '3m': 5,
  '5m': 5,
  '15m': 5,
  '30m': 5,
  '1h': 5,
  '4h': 5,
  '1d': 5,
};

export function getPivotLengthForTf(tf: RedSniperTimeframe): number {
  return PIVOT_LENGTH_BY_TF[tf] ?? 5;
}

export const MINOR_PIVOT_LENGTH_BY_TF: Record<RedSniperTimeframe, number> = {
  '1m': 5,
  '3m': 5,
  '5m': 5,
  '15m': 5,
  '30m': 5,
  '1h': 5,
  '4h': 5,
  '1d': 5,
};

export function getMinorPivotLengthForTf(tf: RedSniperTimeframe): number {
  return MINOR_PIVOT_LENGTH_BY_TF[tf] ?? 5;
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

export const NEXT_HIGHER_TF: Record<RedSniperTimeframe, RedSniperTimeframe> = {
  '1m': '5m',
  '3m': '5m',
  '5m': '15m',
  '15m': '30m',
  '30m': '1h',
  '1h': '4h',
  '4h': '1d',
  '1d': '1d',
};

export function getNextHigherTf(tf: RedSniperTimeframe): RedSniperTimeframe {
  return NEXT_HIGHER_TF[tf] ?? '1h';
}

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
  bull: boolean;
  choch: boolean;
  pivotIndex: number;
  level: number;
  breakIndex: number;
  dir: 'BULL' | 'BEAR';
  kind: StructureKind;
  pivotIdx: number;
  pivotTime: number;
  price: number;
  breakIdx: number;
  breakTime: number;
  locIndex?: number;
}

export interface RawBaseZone {
  tf: RedSniperTimeframe;
  bull: boolean;
  supply: boolean;
  time: number;
  originIndex: number;
  eIndex?: number;
  eVolume?: number;
  startIdx: number;
  endIdx: number;
  breakIndex?: number;
  top: number;
  bottom: number;
  untrimmedTop: number;
  untrimmedBottom: number;
  trimmed: boolean;
  weak: boolean;
  minor?: boolean;
  choch: boolean;
  bosConfirmed?: boolean;
  dep: number;
  baseN: number;
  tests: number;
  independentRetests: number;
  touchCandles: number;
  pctLeft: number;
  pwr: number;
  checks: string[];
  key: string;
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
  zonesPerSide?: number;
  hideConsumed?: boolean;
  parityShift?: boolean;
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
  htfBias?: TfBias;
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
  key: string;
  tf: RedSniperTimeframe;
  bull: boolean;
  side: ZoneSide; // 'BUY' | 'SELL'
  supply: boolean;
  top: number; // HI
  bottom: number; // LO
  anchor: number; // midpoint (top + bottom) / 2
  proximal: number; // edge nearest price (bottom for SELL, top for BUY)
  distal: number; // far edge (top for SELL, bottom for BUY)
  width: number; // top - bottom
  time: number; // OB extreme candle time (c[originIndex].time)
  originIndex: number;
  eIndex?: number;
  eVolume?: number;
  startIdx: number;
  endIdx: number;
  baseN: number;
  choch: boolean;
  tests: number;
  retests: number;
  independentRetests: number;
  touchCandles: number;
  touches: number;
  pctLeft: number;
  pwr: number;
  checks: string[];
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
  zones: RedSniperZone[]; // Selected zones for this TF (newest N per side)
  chartZones: RedSniperZone[]; // Selected zones for chart (same list as zones)
  debugAliveZones: ZoneDebugEntry[]; // All alive zones BEFORE selection + dead:closeBeyond entries
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
  statusBadge?: string;
  structureChip?: 'CHoCH' | 'BOS';
  scoreChip?: string;
  scoreCount?: number;
  cautionWarning?: string | null;
}

export const MIN_ZONE_BOX_HEIGHT_PX = 14;

export interface ChartZoneBoxLayout {
  zone: RedSniperZone;
  xStart: number;
  xEnd: number;
  boxW: number;
  boxTop: number;
  boxBot: number;
  boxH: number;
  labelText: string;
  labelX: number;
  labelY: number;
  labelInsideBox: boolean;
  showLabel: boolean;
  pwrBarX: number;
  pwrBarY: number;
  pwrBarW: number;
  pwrBarMaxW: number;
  pwrBarH: number;
  isAPlus: boolean;
  isHighlighted: boolean;
  isDimmed: boolean;
}

export interface StructureLineRenderSpec {
  id: string;
  bull: boolean;
  choch: boolean;
  text: 'CHoCH' | 'BOS';
  pivotIndex: number;
  breakIndex: number;
  pivotTime: number;
  breakTime: number;
  level: number;
  labelPlacement: 'ABOVE' | 'BELOW';
  strokeColor: string;
  textColor: string;
  lineWidth: number;
}

export interface AuctionProfileResult {
  poc: number;
  vah: number;
  val: number;
  totalVolume: number;
  binsCount: number;
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
  | 'ZONE_DETECTED'
  | 'NEW'
  | 'BROKEN';

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
  return [
    'ZONE_NEW',
    'ZONE_NEAR',
    'ZONE_DEAD',
    'ZONE_DETECTED',
    'NEW',
    'BROKEN',
  ].includes(type);
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

export function resolveIndependentRetestModeForTf(
  _tf: RedSniperTimeframe
): 'CANDLE' | 'ATR' {
  return 'ATR';
}

export function resolveDefaultRetestModeForTf(_tf: RedSniperTimeframe): RetestMode {
  return 'ATR';
}

/**
 * STATE LABEL rule everywhere (chart, list, debug JSON):
 * - FRESH = 0 retests
 * - TESTED = retests >= 1 and pctLeft >= 60 (and retests < 3)
 * - DEEP = pctLeft < 60 or retests >= 3
 */
export function resolveZoneStatus(retests: number, pctLeft: number): ZoneStatus {
  if (retests <= 0) return 'FRESH';
  if (pctLeft < 60 || retests >= 3) return 'DEEP';
  return 'TESTED';
}

/**
 * Trade entry confirmation on closed candle:
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
  const hideConsumed =
    typeof raw.hideConsumed === 'boolean'
      ? raw.hideConsumed
      : typeof raw.showConsumedZones === 'boolean'
      ? !raw.showConsumedZones
      : DEFAULT_RED_SNIPER_SETTINGS.hideConsumed;
  const zonesPerSide =
    typeof raw.zonesPerSide === 'number' && Number.isFinite(raw.zonesPerSide)
      ? clamp(Math.round(raw.zonesPerSide), 3, 5)
      : DEFAULT_RED_SNIPER_SETTINGS.zonesPerSide;

  return {
    maxZonesPerTf:
      typeof raw.maxZonesPerTf === 'number' && Number.isFinite(raw.maxZonesPerTf)
        ? clamp(Math.round(raw.maxZonesPerTf), 1, 8)
        : DEFAULT_RED_SNIPER_SETTINGS.maxZonesPerTf,
    zonesPerSide,
    hideConsumed,
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
    showConsumedZones: !hideConsumed,
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
 * Returns true if two zones overlap in price.
 */
export function doZonesOverlap(
  a: Pick<RawBaseZone, 'bottom' | 'top'>,
  b: Pick<RawBaseZone, 'bottom' | 'top'>
): boolean {
  return Math.min(a.top, b.top) >= Math.max(a.bottom, b.bottom) - 1e-6;
}

interface InternalPivotRecord {
  idx: number;
  time: number;
  level: number;
}

/**
 * Phase 4 Rule 2 & 3:
 * - Scan ALL loaded closed bars (no lookback cap).
 * - Use ONLY internal pivot length 5 for order blocks (remove length-10 merge).
 * - Strict pivot detection: a pivot high is strictly greater than the 5 bars on each side (low mirrors).
 * - Keep a list of pivot highs and a list of pivot lows (newest first).
 * - Bullish break = a candle CLOSE crosses above the newest pivot high in the list.
 *   On break: trend flip -> CHoCH, else BOS; then clear the pivot-high list. Require at least 2 pivot lows ever stored.
 * - Bearish break mirrors this.
 */
export function scanMergedStructuresOnClosedBars(
  closedBars: Array<Pick<Candle, 'time' | 'open' | 'high' | 'low' | 'close'>>,
  tf: RedSniperTimeframe
): { events: StructureEvent[]; pivotsFound: number } {
  const n = closedBars.length;
  if (n < 11) return { events: [], pivotsFound: 0 };

  const L = 5;
  let pivotHighs: InternalPivotRecord[] = [];
  let pivotLows: InternalPivotRecord[] = [];
  let totalPivotHighsEver = 0;
  let totalPivotLowsEver = 0;
  let trend: 1 | -1 | 0 = 0;
  let pivotsFound = 0;
  const events: StructureEvent[] = [];

  for (let i = L * 2; i < n; i++) {
    const pIdx = i - L;
    const pBar = closedBars[pIdx];
    let isStrictHigh = true;
    let isStrictLow = true;

    for (let k = pIdx - L; k <= pIdx + L; k++) {
      if (k === pIdx) continue;
      if (closedBars[k].high >= pBar.high) {
        isStrictHigh = false;
      }
      if (closedBars[k].low <= pBar.low) {
        isStrictLow = false;
      }
      if (!isStrictHigh && !isStrictLow) break;
    }

    if (isStrictHigh) {
      pivotsFound++;
      totalPivotHighsEver++;
      pivotHighs.unshift({ idx: pIdx, time: pBar.time, level: pBar.high });
    }
    if (isStrictLow) {
      pivotsFound++;
      totalPivotLowsEver++;
      pivotLows.unshift({ idx: pIdx, time: pBar.time, level: pBar.low });
    }

    const bar = closedBars[i];
    const prevClose = i > 0 ? closedBars[i - 1].close : bar.open;

    // Bullish break: CLOSE crosses above the newest pivot high in the list; require >= 2 pivot lows ever stored
    if (pivotHighs.length > 0 && totalPivotLowsEver >= 2) {
      const newestPH = pivotHighs[0];
      if (prevClose <= newestPH.level && bar.close > newestPH.level) {
        const choch = trend === -1;
        const kind: StructureKind = choch ? 'CHoCH' : 'BOS';
        events.push({
          id: `${tf}-BULL-${newestPH.time}-${bar.time}`,
          tf,
          bull: true,
          choch,
          pivotIndex: newestPH.idx,
          level: newestPH.level,
          breakIndex: i,
          dir: 'BULL',
          kind,
          pivotIdx: newestPH.idx,
          pivotTime: newestPH.time,
          price: newestPH.level,
          breakIdx: i,
          breakTime: bar.time,
          locIndex: newestPH.idx,
        });
        trend = 1;
        pivotHighs = [];
      }
    }

    // Bearish break: CLOSE crosses below the newest pivot low in the list; require >= 2 pivot highs ever stored
    if (pivotLows.length > 0 && totalPivotHighsEver >= 2) {
      const newestPL = pivotLows[0];
      if (prevClose >= newestPL.level && bar.close < newestPL.level) {
        const choch = trend === 1;
        const kind: StructureKind = choch ? 'CHoCH' : 'BOS';
        events.push({
          id: `${tf}-BEAR-${newestPL.time}-${bar.time}`,
          tf,
          bull: false,
          choch,
          pivotIndex: newestPL.idx,
          level: newestPL.level,
          breakIndex: i,
          dir: 'BEAR',
          kind,
          pivotIdx: newestPL.idx,
          pivotTime: newestPL.time,
          price: newestPL.level,
          breakIdx: i,
          breakTime: bar.time,
          locIndex: newestPL.idx,
        });
        trend = -1;
        pivotLows = [];
      }
    }
  }

  return {
    events,
    pivotsFound,
  };
}

/**
 * Evaluate the 6-check score and PWR formula:
 * 1. CHoCH (the break was a CHoCH)
 * 2. Higher-TF trend agrees (use the next higher TF)
 * 3. Premium/Discount (bull below range midpoint, bear above)
 * 4. FVG after the OB
 * 5. Fresh (no retest)
 * 6. Volume above 1.2x the 30-bar average
 * PWR = min(96, 40 + 9 * checks.length). A+ = 4 or more checks.
 */
export function evaluateZoneSixChecksAndPwr(params: {
  closedBars: Array<Pick<Candle, 'open' | 'high' | 'low' | 'close'> & { tickVolume?: number }>;
  bull: boolean;
  choch: boolean;
  originIndex: number;
  eIndex?: number;
  eVolume?: number;
  breakIndex: number;
  top: number;
  bottom: number;
  tests: number;
  rangeMid: number;
  htfBias: TfBias;
}): { checks: string[]; pwr: number; isAPlus: boolean } {
  const {
    closedBars,
    bull,
    choch,
    originIndex,
    eIndex,
    eVolume,
    breakIndex,
    top,
    bottom,
    tests,
    rangeMid,
    htfBias,
  } = params;

  const checks: string[] = [];

  // 1) CHoCH
  if (choch) {
    checks.push('CHoCH');
  }

  // 2) Higher-TF trend agrees (next higher TF)
  const expectedBias: TfBias = bull ? 'BULL' : 'BEAR';
  if (htfBias === expectedBias) {
    checks.push('HTF');
  }

  // 3) Premium / Discount (bull below range midpoint, bear above)
  const obMid = (top + bottom) / 2;
  if (bull ? obMid <= rangeMid : obMid >= rangeMid) {
    checks.push(bull ? 'DISC' : 'PREM');
  }

  // 4) FVG after the OB
  const n = closedBars.length;
  const fvgSearchStart = Math.max(0, Math.min(originIndex, eIndex ?? originIndex));
  const fvgSearchEnd = Math.min(n - 3, Math.max(originIndex, breakIndex + 1));
  let hasFvg = false;
  for (let k = fvgSearchStart; k <= fvgSearchEnd; k++) {
    const c0 = closedBars[k];
    const c2 = closedBars[k + 2];
    if (!c0 || !c2) continue;
    if (bull && c2.low > c0.high) {
      hasFvg = true;
      break;
    }
    if (!bull && c2.high < c0.low) {
      hasFvg = true;
      break;
    }
  }
  if (hasFvg) {
    checks.push('FVG');
  }

  // 5) Fresh (no retest)
  if (tests === 0) {
    checks.push('FRESH');
  }

  // 6) Volume above 1.2x the 30-bar average (using stored volume of candle E and OB impulse)
  const refIdx = eIndex ?? originIndex;
  const avgStart = Math.max(0, refIdx - 30);
  const avgEnd = refIdx - 1;
  let volSum = 0;
  let volCount = 0;
  for (let j = avgStart; j <= avgEnd; j++) {
    const tv = closedBars[j]?.tickVolume;
    if (typeof tv === 'number' && Number.isFinite(tv) && tv > 0) {
      volSum += tv;
      volCount++;
    }
  }
  if (volCount > 0) {
    const avg30 = volSum / volCount;
    let maxObVol = typeof eVolume === 'number' && Number.isFinite(eVolume) ? eVolume : 0;
    const obVolEnd = Math.min(n - 1, Math.max(originIndex + 1, breakIndex));
    for (let j = Math.max(0, Math.min(refIdx, originIndex)); j <= obVolEnd; j++) {
      const tv = closedBars[j]?.tickVolume;
      if (typeof tv === 'number' && Number.isFinite(tv) && tv > maxObVol) {
        maxObVol = tv;
      }
    }
    if (avg30 > 0 && maxObVol > 1.2 * avg30) {
      checks.push('VOL');
    }
  }

  const pwr = Math.min(96, 40 + 9 * checks.length);
  const isAPlus = checks.length >= 4;

  return { checks, pwr, isAPlus };
}

interface CachedZoneAuditResult {
  selected: RawBaseZone[];
  allAliveBeforeSelection: RawBaseZone[];
  deadBeforeSelection: RawBaseZone[];
  structures: StructureEvent[];
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
  mode: ZoneMode;
  zonesPerSide: number;
  parityShift: boolean;
  retestMode: RetestMode;
  retestGapAtr: number;
  retestTolAtr: number;
  deadAtr: number;
  farAtr: number;
  hideConsumed: boolean;
  formingCandleIncluded: boolean;
  htfBias: TfBias;
}): string {
  return `${S.mode}|${S.zonesPerSide}|${S.parityShift ? 1 : 0}|${S.retestMode}|${S.retestGapAtr}|${S.retestTolAtr}|${S.deadAtr}|${S.farAtr}|${S.hideConsumed ? 1 : 0}|${S.formingCandleIncluded ? 1 : 0}|${S.htfBias}`;
}

/**
 * Phase 4 Order Block & Structure zone detection on ALL CLOSED candles (no lookback cap):
 * 1) STRUCTURE: internal pivot length 5 only, strict >/< 5 bars on each side, pivot lists (newest first),
 *    break when close crosses newest pivot (requiring >= 2 opposite pivots ever stored), clear broken side's pivot list.
 * 2) ORDER BLOCK construction with INDICATOR_PARITY_SHIFT (default true):
 *    - Scan bars loc + 1 .. breakBar. Bullish: extreme = lowest low (ties -> most recent). Bearish: extreme = highest high (ties -> most recent).
 *    - Let E be candle ONE BAR BEFORE extreme when parityShift=true, or extreme itself when false.
 *    - Bullish: bottom = extreme.low, top = hl2(E). Bearish: top = extreme.high, bottom = hl2(E).
 *    - Refine using candle E (hlcc4 check).
 *    - Zone start time = extreme candle time. Store volume of candle E.
 * 3) OVERLAP RULE: compare ONLY with the most recent still-alive OB of the same side:
 *    - Bullish: drop new if new.bottom < prev.top.
 *    - Bearish: drop new if new.top > prev.bottom.
 * 4) MITIGATION: bullish OB deleted when close < bottom; bearish OB deleted when close > top. Nothing else removes a zone.
 *    Do NOT hide tested zones by default (hideConsumed default false).
 * 5) SELECTION: show the NEWEST N alive zones per side by creation order (zonesPerSide default 5, allowed 3-5).
 */
export function findZonesWithAudit(
  c: Array<Pick<Candle, 'time' | 'open' | 'high' | 'low' | 'close'> & { tickVolume?: number }>,
  tf: RedSniperTimeframe,
  o: FindZonesOptions = {}
): {
  selected: RawBaseZone[];
  allAliveBeforeSelection: RawBaseZone[];
  deadBeforeSelection: RawBaseZone[];
  structures?: StructureEvent[];
  retestModeUsed: RetestMode;
  atr14: number;
  livePrice: number;
  debugCounts: ZoneDebugCounts;
} {
  const defaultRetestMode = resolveDefaultRetestModeForTf(tf);
  const hideConsumed =
    typeof o.hideConsumed === 'boolean'
      ? o.hideConsumed
      : typeof o.showConsumedZones === 'boolean'
      ? !o.showConsumedZones
      : false;
  const zonesPerSide = clamp(
    typeof o.zonesPerSide === 'number'
      ? o.zonesPerSide
      : typeof o.maxZones === 'number'
      ? o.maxZones
      : 5,
    1,
    5
  );
  const parityShift =
    typeof o.parityShift === 'boolean' ? o.parityShift : INDICATOR_PARITY_SHIFT;

  const S = {
    mode: o.mode ?? ('WICK' as ZoneMode),
    zonesPerSide,
    parityShift,
    retestMode: o.retestMode ?? defaultRetestMode,
    retestGapAtr: o.retestGapAtr ?? 0.25,
    retestTolAtr: o.retestTolAtr ?? 0.0,
    deadAtr: o.deadAtr ?? 0.0,
    farAtr: clamp(o.farAtr ?? 25, 10, 60),
    hideConsumed,
    showConsumedZones: !hideConsumed,
    formingCandleIncluded: o.formingCandleIncluded ?? true,
    htfBias: o.htfBias ?? ('NEUT' as TfBias),
  };

  const totalBars = c ? c.length : 0;
  if (totalBars < 12) {
    return {
      selected: [],
      allAliveBeforeSelection: [],
      deadBeforeSelection: [],
      structures: [],
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

  // Use CLOSED candles only (never the forming candle when formingCandleIncluded is true)
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
      structures: cached.structures,
      retestModeUsed: cached.retestModeUsed,
      atr14: cached.atr14,
      livePrice: px,
      debugCounts: cached.debugCounts,
    };
  }
  zoneCacheMisses++;

  const A = atrSeries(closedBars);
  const atr14 = Math.max(0.1, A[closedN - 1] || 2.0);
  const farThreshold = S.farAtr * atr14;

  // Range midpoint over TF lookback window for Premium/Discount check
  const lookbackStart = Math.max(0, closedN - getLookbackForTf(tf));
  let rangeHigh = -Infinity;
  let rangeLow = Infinity;
  for (let i = lookbackStart; i < closedN; i++) {
    if (closedBars[i].high > rangeHigh) rangeHigh = closedBars[i].high;
    if (closedBars[i].low < rangeLow) rangeLow = closedBars[i].low;
  }
  const rangeMid =
    Number.isFinite(rangeHigh) && Number.isFinite(rangeLow)
      ? (rangeHigh + rangeLow) / 2
      : closedRefPrice;

  // Scan ALL loaded closed bars using internal pivot length 5 only
  const { events: structures, pivotsFound } = scanMergedStructuresOnClosedBars(
    closedBars,
    tf
  );

  const breaksByBar = new Map<number, StructureEvent[]>();
  for (const ev of structures) {
    const list = breaksByBar.get(ev.breakIndex) || [];
    list.push(ev);
    breaksByBar.set(ev.breakIndex, list);
  }

  interface LiveObTracker {
    zone: RawBaseZone;
    away: boolean;
    maxPen: number;
  }

  const liveTrackers: LiveObTracker[] = [];
  const deadOBs: RawBaseZone[] = [];
  const skippedOverlapOBs: RawBaseZone[] = [];
  let overlapDroppedCount = 0;

  // Walk ALL closed bars chronologically (0 .. closedN - 1, no lookback cap)
  for (let i = 0; i < closedN; i++) {
    const bar = closedBars[i];
    const ak = Math.max(0.1, A[i] || atr14);
    const deadOffset = S.deadAtr > 0 ? S.deadAtr * ak : 0;

    // 1) Update existing live OBs on bar i (Mitigation + Retests)
    for (let tIdx = liveTrackers.length - 1; tIdx >= 0; tIdx--) {
      const tr = liveTrackers[tIdx];
      const z = tr.zone;
      if (i <= (z.breakIndex ?? z.endIdx)) continue;

      // Phase 4 Rule 6) MITIGATION:
      // Bullish OB deleted when close < bottom; Bearish OB deleted when close > top. Nothing else removes a zone.
      const mitigated = z.bull
        ? bar.close < z.bottom - deadOffset
        : bar.close > z.top + deadOffset;

      if (mitigated) {
        const beyondDist = z.bull ? z.bottom - bar.close : bar.close - z.top;
        z.dead = true;
        z.deadCandleTime = bar.time;
        z.deadBeyondAtr = Number(Math.max(0.01, beyondDist / ak).toFixed(2));
        z.droppedReason = 'dead:closeBeyond';
        deadOBs.push(z);
        liveTrackers.splice(tIdx, 1);
        continue;
      }

      // Retest & penetration tracking (informational: FRESH/TESTED and tests count)
      const h = Math.max(0.01, z.top - z.bottom);
      const tol = S.retestTolAtr > 0 ? S.retestTolAtr * ak : 0;
      const gapReq = S.retestMode === 'CANDLE' ? 0 : S.retestGapAtr * ak;
      const closedOutside = z.bull ? bar.close > z.top : bar.close < z.bottom;
      const distOutside = z.bull ? bar.low - z.top : z.bottom - bar.high;
      const movedAway =
        (z.bull ? bar.low > z.top : bar.high < z.bottom) ||
        (closedOutside && distOutside >= gapReq);

      const touchedZone = z.bull
        ? bar.low <= z.top + tol && bar.high >= z.bottom
        : bar.high >= z.bottom - tol && bar.low <= z.top;

      if (tr.away) {
        if (touchedZone) {
          z.tests++;
          z.independentRetests++;
          z.touchCandles++;
          tr.away = false;

          const isSweep = z.bull
            ? bar.low < z.bottom && bar.close >= z.bottom
            : bar.high > z.top && bar.close <= z.top;
          if (isSweep) z.sweep = true;

          const rawPen = z.bull
            ? (z.top - bar.low) / h
            : (bar.high - z.bottom) / h;
          tr.maxPen = Math.max(tr.maxPen, clamp(rawPen, 0.01, 1));
          z.pctLeft = Math.max(0, Math.round(100 * (1 - tr.maxPen)));

          if (
            isZoneEntryConfirmed(
              { side: z.bull ? 'BUY' : 'SELL', bottom: z.bottom, top: z.top },
              bar
            )
          ) {
            z.entryConfirmed = true;
          }
        }
      } else {
        if (z.independentRetests > 0 && touchedZone) {
          z.touchCandles++;
          const isSweep = z.bull
            ? bar.low < z.bottom && bar.close >= z.bottom
            : bar.high > z.top && bar.close <= z.top;
          if (isSweep) z.sweep = true;

          const rawPen = z.bull
            ? (z.top - bar.low) / h
            : (bar.high - z.bottom) / h;
          tr.maxPen = Math.max(tr.maxPen, clamp(rawPen, 0.01, 1));
          z.pctLeft = Math.max(0, Math.round(100 * (1 - tr.maxPen)));

          if (
            isZoneEntryConfirmed(
              { side: z.bull ? 'BUY' : 'SELL', bottom: z.bottom, top: z.top },
              bar
            )
          ) {
            z.entryConfirmed = true;
          }
        }
        if (movedAway) {
          tr.away = true;
        }
      }

      if (S.retestMode === 'TOUCH_CANDLES') {
        z.tests = z.touchCandles;
      }

      z.consumed = z.pctLeft < 10 || z.tests >= 4;
      z.state = resolveZoneStatus(z.tests, z.pctLeft);
    }

    // 2) Phase 4 Rule 4: ORDER-BLOCK CONSTRUCTION on structure break at bar i
    const eventsAtI = breaksByBar.get(i);
    if (!eventsAtI || eventsAtI.length === 0) continue;

    for (const ev of eventsAtI) {
      const loc = Math.max(0, ev.locIndex ?? ev.pivotIndex);
      const searchStart = Math.min(i, loc + 1);
      const searchEnd = Math.min(closedN - 1, i);
      let extremeIdx = searchStart;

      // Scan bars loc + 1 .. breakBar. Ties -> most recent bar (<= for bull, >= for bear).
      if (ev.bull) {
        let minLow = Infinity;
        for (let k = searchStart; k <= searchEnd; k++) {
          if (closedBars[k].low <= minLow) {
            minLow = closedBars[k].low;
            extremeIdx = k;
          }
        }
      } else {
        let maxHigh = -Infinity;
        for (let k = searchStart; k <= searchEnd; k++) {
          if (closedBars[k].high >= maxHigh) {
            maxHigh = closedBars[k].high;
            extremeIdx = k;
          }
        }
      }

      // Let E be the candle ONE BAR BEFORE the extreme candle when parityShift=true (or extreme itself when false)
      const eIdx = S.parityShift ? Math.max(0, extremeIdx - 1) : extremeIdx;
      const extremeCandle = closedBars[extremeIdx];
      const eCandle = closedBars[eIdx];
      const eHl2 = (eCandle.high + eCandle.low) / 2;
      const eHlcc4 =
        (eCandle.high + eCandle.low + 2 * eCandle.close) / 4;

      let rawTop: number;
      let rawBottom: number;
      let trimmed = false;

      if (ev.bull) {
        rawBottom = extremeCandle.low;
        rawTop = eHl2 >= rawBottom ? eHl2 : (extremeCandle.high + extremeCandle.low) / 2;
        const mid = (rawTop + rawBottom) / 2;
        if (mid < Math.min(eCandle.open, eCandle.close) && rawTop > eHlcc4) {
          rawTop = mid;
          trimmed = true;
        }
      } else {
        rawTop = extremeCandle.high;
        rawBottom = eHl2 <= rawTop ? eHl2 : (extremeCandle.high + extremeCandle.low) / 2;
        const mid = (rawTop + rawBottom) / 2;
        if (mid > Math.max(eCandle.open, eCandle.close) && rawBottom < eHlcc4) {
          rawBottom = mid;
          trimmed = true;
        }
      }

      if (rawTop - rawBottom < 0.05) {
        if (ev.bull) rawTop = rawBottom + 0.05;
        else rawBottom = rawTop - 0.05;
      }

      const boxTop = Number(rawTop.toFixed(2));
      const boxBottom = Number(rawBottom.toFixed(2));
      const pivotAtr = Math.max(0.1, A[extremeIdx] || atr14);

      // Measure departure in ATR units from OB to break bar
      const depMove = ev.bull
        ? Math.max(0, closedBars[i].high - boxTop)
        : Math.max(0, boxBottom - closedBars[i].low);
      const depAtr = Number((depMove / pivotAtr).toFixed(2));

      const originIndex = extremeIdx;
      const eVolume =
        typeof eCandle.tickVolume === 'number' && Number.isFinite(eCandle.tickVolume)
          ? eCandle.tickVolume
          : 0;
      const key = `${tf}-${ev.bull ? 'BULL' : 'BEAR'}-${originIndex}-${boxBottom.toFixed(2)}-${boxTop.toFixed(2)}`;

      const candidateZone: RawBaseZone = {
        tf,
        bull: ev.bull,
        supply: !ev.bull,
        time: extremeCandle.time, // Zone start time = the extreme candle time
        originIndex,
        eIndex: eIdx,
        eVolume,
        startIdx: originIndex,
        endIdx: originIndex,
        breakIndex: i,
        top: boxTop,
        bottom: boxBottom,
        untrimmedTop: Number((ev.bull ? eHl2 : extremeCandle.high).toFixed(2)),
        untrimmedBottom: Number((ev.bull ? extremeCandle.low : eHl2).toFixed(2)),
        trimmed,
        weak: false,
        minor: false,
        choch: ev.choch,
        bosConfirmed: true,
        dep: depAtr,
        baseN: 1,
        tests: 0,
        independentRetests: 0,
        touchCandles: 0,
        pctLeft: 100,
        pwr: 40,
        checks: [],
        key,
        consumed: false,
        sweep: false,
        entryConfirmed: false,
        pivotAtr,
        state: 'FRESH',
        score: 0,
      };

      // Phase 4 Rule 5: OVERLAP RULE
      // Compare ONLY with the most recent still-alive OB of the same side:
      // Bullish: drop the new one if new.bottom < prev.top
      // Bearish: drop the new one if new.top > prev.bottom
      let prevSameSide: RawBaseZone | null = null;
      for (let t = liveTrackers.length - 1; t >= 0; t--) {
        if (liveTrackers[t].zone.bull === ev.bull) {
          prevSameSide = liveTrackers[t].zone;
          break;
        }
      }

      if (prevSameSide) {
        const shouldDropByOverlap = ev.bull
          ? candidateZone.bottom < prevSameSide.top
          : candidateZone.top > prevSameSide.bottom;

        if (shouldDropByOverlap) {
          const r = Math.max(0.01, computeSameSideOverlapRatio(prevSameSide, candidateZone));
          const overlapPct = Math.max(1, Math.round(r * 100));
          overlapDroppedCount++;
          skippedOverlapOBs.push({
            ...candidateZone,
            overlapPct,
            overlapDecision: `dropped:overlap(${overlapPct}%)`,
            droppedReason: 'overlap',
          });
          continue;
        }
      }

      const breakBar = closedBars[i];
      const alreadyOutside = ev.bull
        ? breakBar.close > boxTop
        : breakBar.close < boxBottom;

      liveTrackers.push({
        zone: {
          ...candidateZone,
          overlapPct: 0,
          overlapDecision: 'kept:no-overlap',
          droppedReason: 'kept',
        },
        away: alreadyOutside,
        maxPen: 0,
      });
    }
  }

  const getDist = (z: RawBaseZone): number => {
    if (closedRefPrice >= z.bottom && closedRefPrice <= z.top) return 0;
    return closedRefPrice < z.bottom
      ? z.bottom - closedRefPrice
      : closedRefPrice - z.top;
  };

  // Compute 6-check score and PWR for all tracked OBs
  const finalizeZoneScore = (z: RawBaseZone): void => {
    const { checks, pwr } = evaluateZoneSixChecksAndPwr({
      closedBars,
      bull: z.bull,
      choch: z.choch,
      originIndex: z.originIndex,
      eIndex: z.eIndex,
      eVolume: z.eVolume,
      breakIndex: z.breakIndex ?? z.endIdx,
      top: z.top,
      bottom: z.bottom,
      tests: z.tests,
      rangeMid,
      htfBias: S.htfBias,
    });
    z.checks = checks;
    z.pwr = pwr;
    z.score = checks.length;
    const dist = getDist(z);
    z.farDecision =
      dist > farThreshold
        ? `FAR (>${S.farAtr}xATR)`
        : `NEAR (<=${S.farAtr}xATR)`;
  };

  const liveOBs = liveTrackers.map((t) => t.zone);
  for (const z of liveOBs) finalizeZoneScore(z);
  for (const z of skippedOverlapOBs) finalizeZoneScore(z);
  for (const dz of deadOBs) {
    finalizeZoneScore(dz);
    dz.overlapPct = 0;
    dz.overlapDecision = 'n/a:dead';
  }

  // Phase 4 Rule 6: Do NOT hide tested zones unless hideConsumed is true
  const allAlive: RawBaseZone[] = [...skippedOverlapOBs];
  const selectablePool: RawBaseZone[] = [];
  let consumedHiddenCount = 0;

  for (const z of liveOBs) {
    const isConsumed = Boolean(z.consumed || z.pctLeft < 10 || z.tests >= 4);
    z.consumed = isConsumed;
    if (isConsumed && S.hideConsumed) {
      consumedHiddenCount++;
      allAlive.push({
        ...z,
        overlapDecision: 'dropped:consumed',
        droppedReason: 'consumed',
      });
    } else {
      selectablePool.push(z);
      allAlive.push(z);
    }
  }

  // Phase 4 Rule 7: SELECTION — Show the NEWEST N alive zones per side by creation order (not nearest)
  const bullPool = selectablePool.filter((z) => z.bull);
  const bearPool = selectablePool.filter((z) => !z.bull);

  const keptBull = bullPool.slice(-S.zonesPerSide);
  const keptBear = bearPool.slice(-S.zonesPerSide);
  const keptSet = new Set<RawBaseZone>([...keptBull, ...keptBear]);

  for (const z of selectablePool) {
    if (keptSet.has(z)) {
      z.droppedReason = 'kept';
    } else {
      z.droppedReason = 'cap';
    }
  }

  const selectedBuy = keptBull.length;
  const selectedSell = keptBear.length;
  const keptZones: RawBaseZone[] = [...keptBull, ...keptBear];

  const selected = [...keptZones].sort((a, b) => b.top - a.top);
  allAlive.sort((a, b) => b.top - a.top);
  const sortedDead = [...deadOBs].sort((a, b) => b.top - a.top);

  const debugCounts: ZoneDebugCounts = {
    pivotsFound,
    confirmedPivots: structures.length,
    deadCount: sortedDead.length,
    consumedHidden: consumedHiddenCount,
    overlapDropped: overlapDroppedCount,
    selectedBuy,
    selectedSell,
  };

  if (zoneAuditCache.size > 64) {
    const oldestKey = zoneAuditCache.keys().next().value;
    if (oldestKey) zoneAuditCache.delete(oldestKey);
  }
  zoneAuditCache.set(cacheKey, {
    selected,
    allAliveBeforeSelection: allAlive,
    deadBeforeSelection: sortedDead,
    structures,
    retestModeUsed: S.retestMode,
    atr14,
    closedRefPrice,
    debugCounts,
  });

  return {
    selected,
    allAliveBeforeSelection: allAlive,
    deadBeforeSelection: sortedDead,
    structures,
    retestModeUsed: S.retestMode,
    atr14,
    livePrice: px,
    debugCounts,
  };
}

export function findZones(
  c: Array<Pick<Candle, 'time' | 'open' | 'high' | 'low' | 'close'> & { tickVolume?: number }>,
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

/**
 * Compute internal structure break events on CLOSED candles only (L=5 internal pivots).
 */
export function computeStructureEvents(
  tf: RedSniperTimeframe,
  bars: Candle[],
  formingCandleIncluded: boolean = true
): StructureEvent[] {
  if (!bars || bars.length < 12) return [];
  const closed =
    formingCandleIncluded && bars.length > 1
      ? bars.slice(0, bars.length - 1)
      : bars;
  return scanMergedStructuresOnClosedBars(closed, tf).events;
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
 * One-line label inside the box:
 * "SELL • A+ • CHoCH • FRESH • PWR 85"
 * (BUY/SELL, "A+" only if A+, CHoCH or BOS, FRESH or TESTED, PWR n).
 */
export function formatZoneChartLabel(
  zone: Pick<
    RedSniperZone,
    'side' | 'bull' | 'isAPlus' | 'checks' | 'choch' | 'tests' | 'retests' | 'pwr' | 'power'
  >
): string {
  const side: ZoneSide = zone.side || (zone.bull ? 'BUY' : 'SELL');
  const isAPlus = Boolean(
    zone.isAPlus || (Array.isArray(zone.checks) && zone.checks.length >= 4)
  );
  const structTag = zone.choch ? 'CHoCH' : 'BOS';
  const testsCount =
    typeof zone.tests === 'number'
      ? zone.tests
      : typeof zone.retests === 'number'
      ? zone.retests
      : 0;
  const freshTag = testsCount <= 0 ? 'FRESH' : 'TESTED';
  const pwrVal =
    typeof zone.pwr === 'number' && Number.isFinite(zone.pwr)
      ? zone.pwr
      : zone.power;

  const parts: string[] = [side];
  if (isAPlus) {
    parts.push('A+');
  }
  parts.push(structTag, freshTag, `PWR ${pwrVal}`);
  return parts.join(' • ');
}

/**
 * Structure Lines Specification:
 * For the last 8 breaks draw a dashed horizontal line from the broken pivot to the break candle,
 * with the text "CHoCH" or "BOS" centered on the line (above the line for bullish, below for bearish;
 * green = bullish, dark red = bearish, CHoCH brighter than BOS).
 */
export function getVisibleStructureLineSpecs(
  structures: ReadonlyArray<StructureEvent>,
  maxBreaks: number = 8
): StructureLineRenderSpec[] {
  if (!structures || structures.length === 0) return [];
  const cap = Math.max(1, maxBreaks);
  const recent = structures.slice(-cap);
  return recent.map((st) => {
    const bull = Boolean(st.bull ?? st.dir === 'BULL');
    const choch = Boolean(st.choch ?? st.kind === 'CHoCH');
    const text: 'CHoCH' | 'BOS' = choch ? 'CHoCH' : 'BOS';
    const level = typeof st.level === 'number' ? st.level : st.price;
    const strokeColor = bull
      ? choch
        ? 'rgba(47, 208, 143, 0.95)'
        : 'rgba(47, 208, 143, 0.52)'
      : choch
      ? 'rgba(216, 58, 76, 0.95)'
      : 'rgba(139, 20, 32, 0.72)';
    const textColor = bull
      ? choch
        ? '#7ff0c0'
        : 'rgba(47, 208, 143, 0.85)'
      : choch
      ? '#ff8a96'
      : 'rgba(216, 58, 76, 0.85)';
    return {
      id: st.id,
      bull,
      choch,
      text,
      pivotIndex: st.pivotIndex ?? st.pivotIdx,
      breakIndex: st.breakIndex ?? st.breakIdx,
      pivotTime: st.pivotTime,
      breakTime: st.breakTime,
      level,
      labelPlacement: bull ? 'ABOVE' : 'BELOW',
      strokeColor,
      textColor,
      lineWidth: choch ? 1.4 : 1.0,
    };
  });
}

/**
 * Phase 4 Rule 8:
 * - Draw zone boxes with TRUE price height (minimum 14px, no stacking shift).
 * - Label inside the box, one line, font 9px, no line crossing the text.
 * - If two labels collide vertically (|a.labelY - b.labelY| < 12), hide the lower-PWR label.
 */
export function layoutChartZoneBoxes(params: {
  zones: ReadonlyArray<RedSniperZone>;
  priceToY: (price: number) => number | null;
  timeToX: (time: number) => number;
  plotWidth: number;
  plotHeight: number;
  highlightedZoneId?: string | null;
  defaultAtr?: number;
  minBoxHeightPx?: number;
  gapPx?: number;
}): {
  boxes: ChartZoneBoxLayout[];
  clippedTopZones: RedSniperZone[];
  clippedBottomZones: RedSniperZone[];
} {
  const {
    zones,
    priceToY,
    timeToX,
    plotWidth,
    plotHeight,
    highlightedZoneId = null,
    defaultAtr = 2.0,
    minBoxHeightPx = MIN_ZONE_BOX_HEIGHT_PX,
  } = params;

  const minH = Math.max(MIN_ZONE_BOX_HEIGHT_PX, minBoxHeightPx);
  const clippedTopZones: RedSniperZone[] = [];
  const clippedBottomZones: RedSniperZone[] = [];

  const boxes: ChartZoneBoxLayout[] = [];

  for (const z of zones) {
    const yTopRaw = priceToY(z.top);
    const yBotRaw = priceToY(z.bottom);
    if (yTopRaw === null || yBotRaw === null) continue;

    const rawMin = Math.min(yTopRaw, yBotRaw);
    const rawMax = Math.max(yTopRaw, yBotRaw);

    if (rawMax < 0) {
      clippedTopZones.push(z);
      continue;
    }
    if (rawMin > plotHeight) {
      clippedBottomZones.push(z);
      continue;
    }

    const clampedMin = Math.max(0, rawMin);
    const clampedMax = Math.min(plotHeight, rawMax);
    const rawH = Math.max(0, clampedMax - clampedMin);
    const boxH = Math.max(minH, rawH);

    // True price height (expanded symmetrically around midpoint only if rawH < minH, NO stacking shift)
    let boxTop = rawH >= minH ? clampedMin : (clampedMin + clampedMax) / 2 - boxH / 2;
    let boxBot = boxTop + boxH;

    if (boxTop < 0) {
      boxTop = 0;
      boxBot = Math.min(plotHeight, boxH);
    } else if (boxBot > plotHeight) {
      boxBot = plotHeight;
      boxTop = Math.max(0, plotHeight - boxH);
    }

    const xStart = Math.max(0, Math.min(plotWidth - 36, timeToX(z.time)));
    const xEnd = plotWidth;
    const boxW = Math.max(36, xEnd - xStart);
    const refAtr = Math.max(0.5, z.atr14 || defaultAtr || 2.0);
    const isDimmed = Boolean(z.isFar || z.distancePts > 6 * refAtr);
    const isAPlus = Boolean(
      z.isAPlus || (Array.isArray(z.checks) && z.checks.length >= 4)
    );

    const labelText = formatZoneChartLabel(z);
    const labelY = boxTop + boxH / 2;
    const labelX = xStart + 8;
    const pwrBarH = 2;
    const pwrBarY = boxBot - pwrBarH;
    const pwrBarX = xStart;
    const pwrBarMaxW = boxW;
    const pwrVal = z.pwr ?? z.power;
    const pwrBarW = Math.round((pwrBarMaxW * clamp(pwrVal, 0, 100)) / 100);

    boxes.push({
      zone: z,
      xStart,
      xEnd,
      boxW,
      boxTop,
      boxBot,
      boxH,
      labelText,
      labelX,
      labelY,
      labelInsideBox: labelY > boxTop && labelY < boxBot,
      showLabel: true,
      pwrBarX,
      pwrBarY,
      pwrBarW,
      pwrBarMaxW,
      pwrBarH,
      isAPlus,
      isHighlighted: z.id === highlightedZoneId,
      isDimmed,
    });
  }

  // If two labels collide vertically (|a.labelY - b.labelY| < 12), hide the lower-PWR label
  const byPwrDesc = [...boxes].sort(
    (a, b) =>
      (b.zone.pwr ?? b.zone.power) - (a.zone.pwr ?? a.zone.power) ||
      (b.isHighlighted ? 1 : 0) - (a.isHighlighted ? 1 : 0)
  );
  const acceptedLabelYs: number[] = [];
  for (const b of byPwrDesc) {
    const collides = acceptedLabelYs.some((y) => Math.abs(y - b.labelY) < 12);
    if (collides) {
      b.showLabel = false;
    } else {
      b.showLabel = true;
      acceptedLabelYs.push(b.labelY);
    }
  }

  boxes.sort((a, b) => a.boxTop - b.boxTop || b.zone.top - a.zone.top);

  return { boxes, clippedTopZones, clippedBottomZones };
}

export interface ZoneComparisonMatch {
  expectedPrice: number;
  side: ZoneSide | 'ANY';
  matched: boolean;
  distancePts: number | null;
  matchedZone: {
    id: string;
    tf: RedSniperTimeframe;
    side: ZoneSide;
    bottom: number;
    top: number;
    mid: number;
    diffPts: number;
    choch?: boolean;
  } | null;
}

export interface ZoneComparisonReport {
  tf: RedSniperTimeframe;
  tolerancePts: number;
  totalExpected: number;
  expectedCount: number;
  matchedCount: number;
  missingCount: number;
  matches: ZoneComparisonMatch[];
  missingPrices: number[];
}

/**
 * Phase 4 Rule 9: Compare detected zones against a list of expected zone prices
 * (per TF, per side) and report which are matched within `tolerancePts` (default 3 points) and which are missing.
 */
export function compareZonesWithReference(
  detectedZones: ReadonlyArray<
    Pick<RedSniperZone, 'id' | 'tf' | 'side' | 'bottom' | 'top'> & { choch?: boolean }
  >,
  referenceInput: string | ReadonlyArray<number | { price: number; side?: ZoneSide }>,
  tfOrSide: RedSniperTimeframe | ZoneSide = '15m',
  tolerancePts: number = 3,
  maybeTf?: RedSniperTimeframe
): ZoneComparisonReport {
  const defaultSide: ZoneSide | 'ANY' =
    tfOrSide === 'BUY' || tfOrSide === 'SELL' ? tfOrSide : 'ANY';
  const tf: RedSniperTimeframe =
    maybeTf ??
    (tfOrSide !== 'BUY' && tfOrSide !== 'SELL' ? tfOrSide : '15m');

  const parsedExpected: Array<{ price: number; side: ZoneSide | 'ANY' }> = [];

  if (typeof referenceInput === 'string') {
    const lines = referenceInput.split(/[\r\n;]+/);
    let currentSide: ZoneSide | 'ANY' = defaultSide;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const upper = line.toUpperCase();
      if (upper.includes('SELL') || upper.includes('BEAR')) {
        currentSide = 'SELL';
      } else if (upper.includes('BUY') || upper.includes('BULL')) {
        currentSide = 'BUY';
      }
      const numMatches = line.match(/\d+(?:\.\d+)?/g);
      if (numMatches) {
        for (const nm of numMatches) {
          const val = Number(nm);
          if (Number.isFinite(val) && val > 100) {
            parsedExpected.push({ price: val, side: currentSide });
          }
        }
      }
    }
  } else if (Array.isArray(referenceInput)) {
    for (const item of referenceInput) {
      if (typeof item === 'number' && Number.isFinite(item)) {
        parsedExpected.push({ price: item, side: defaultSide });
      } else if (item && typeof item === 'object' && Number.isFinite(item.price)) {
        parsedExpected.push({
          price: item.price,
          side: item.side === 'BUY' || item.side === 'SELL' ? item.side : defaultSide,
        });
      }
    }
  }

  const matches: ZoneComparisonMatch[] = [];
  const missingPrices: number[] = [];

  for (const exp of parsedExpected) {
    const candidates = detectedZones.filter(
      (z) => exp.side === 'ANY' || z.side === exp.side
    );

    let bestZone: (Pick<RedSniperZone, 'id' | 'tf' | 'side' | 'bottom' | 'top'> & {
      choch?: boolean;
    }) | null = null;
    let bestDiff = Infinity;

    for (const z of candidates) {
      const distToRange =
        exp.price >= z.bottom && exp.price <= z.top
          ? 0
          : exp.price < z.bottom
          ? z.bottom - exp.price
          : exp.price - z.top;
      if (distToRange < bestDiff) {
        bestDiff = distToRange;
        bestZone = z;
      }
    }

    const nearestDist = Number.isFinite(bestDiff) ? Number(bestDiff.toFixed(2)) : null;

    if (bestZone && bestDiff <= tolerancePts + 1e-6) {
      const mid = Number(((bestZone.top + bestZone.bottom) / 2).toFixed(2));
      matches.push({
        expectedPrice: exp.price,
        side: exp.side,
        matched: true,
        distancePts: nearestDist,
        matchedZone: {
          id: bestZone.id,
          tf: bestZone.tf,
          side: bestZone.side,
          bottom: bestZone.bottom,
          top: bestZone.top,
          mid,
          diffPts: Number(bestDiff.toFixed(2)),
          choch: bestZone.choch,
        },
      });
    } else {
      missingPrices.push(exp.price);
      matches.push({
        expectedPrice: exp.price,
        side: exp.side,
        matched: false,
        distancePts: nearestDist,
        matchedZone: null,
      });
    }
  }

  const matchedCount = matches.filter((m) => m.matched).length;
  return {
    tf,
    tolerancePts,
    totalExpected: parsedExpected.length,
    expectedCount: parsedExpected.length,
    matchedCount,
    missingCount: parsedExpected.length - matchedCount,
    matches,
    missingPrices,
  };
}

/**
 * Phase 3 Optional "Auction" Toggle:
 * VAH / POC / VAL lines computed from the last 288 M5 candles.
 * Spread each candle's volume over 1-point bins, POC = highest bin,
 * value area = expand from POC until 70% of total volume.
 */
export function computeAuctionProfileFromM5(
  m5Candles: ReadonlyArray<Pick<Candle, 'high' | 'low' | 'close'> & { tickVolume?: number }>,
  lookback: number = 288
): AuctionProfileResult | null {
  if (!m5Candles || m5Candles.length === 0) return null;
  const closed =
    m5Candles.length > 1
      ? m5Candles.slice(Math.max(0, m5Candles.length - 1 - lookback), m5Candles.length - 1)
      : m5Candles.slice(-lookback);
  if (closed.length === 0) return null;

  let minLow = Infinity;
  let maxHigh = -Infinity;
  for (const c of closed) {
    if (Number.isFinite(c.low) && c.low < minLow) minLow = c.low;
    if (Number.isFinite(c.high) && c.high > maxHigh) maxHigh = c.high;
  }
  if (!Number.isFinite(minLow) || !Number.isFinite(maxHigh) || maxHigh < minLow) {
    return null;
  }

  const minBin = Math.floor(minLow);
  const maxBin = Math.floor(maxHigh);
  const binsCount = Math.max(1, Math.min(5000, maxBin - minBin + 1));
  const bins = new Float64Array(binsCount);
  let totalVolume = 0;

  for (const c of closed) {
    const vol =
      typeof c.tickVolume === 'number' && Number.isFinite(c.tickVolume) && c.tickVolume > 0
        ? c.tickVolume
        : 1;
    const bStart = clamp(Math.floor(Math.min(c.low, c.high)) - minBin, 0, binsCount - 1);
    const bEnd = clamp(Math.floor(Math.max(c.low, c.high)) - minBin, 0, binsCount - 1);
    const span = Math.max(1, bEnd - bStart + 1);
    const share = vol / span;
    for (let b = bStart; b <= bEnd; b++) {
      bins[b] += share;
    }
    totalVolume += vol;
  }

  if (totalVolume <= 0) return null;

  let pocIdx = 0;
  let maxBinVol = -1;
  for (let i = 0; i < binsCount; i++) {
    if (bins[i] > maxBinVol) {
      maxBinVol = bins[i];
      pocIdx = i;
    }
  }

  const targetVol = 0.7 * totalVolume;
  let lowIdx = pocIdx;
  let highIdx = pocIdx;
  let accumVol = bins[pocIdx];

  while (accumVol < targetVol && (lowIdx > 0 || highIdx < binsCount - 1)) {
    const downVol = lowIdx > 0 ? bins[lowIdx - 1] : -1;
    const upVol = highIdx < binsCount - 1 ? bins[highIdx + 1] : -1;
    if (upVol >= downVol && highIdx < binsCount - 1) {
      highIdx++;
      accumVol += bins[highIdx];
    } else if (lowIdx > 0) {
      lowIdx--;
      accumVol += bins[lowIdx];
    } else {
      break;
    }
  }

  const poc = Number((minBin + pocIdx + 0.5).toFixed(2));
  const val = Number((minBin + lowIdx).toFixed(2));
  const vah = Number((minBin + highIdx + 1).toFixed(2));

  return {
    poc,
    vah: Math.max(poc, vah),
    val: Math.min(poc, val),
    totalVolume: Number(totalVolume.toFixed(2)),
    binsCount,
  };
}

/**
 * Compute Equilibrium (EQ) level and range high/low over the timeframe lookback window.
 */
export function computeEquilibriumLevel(
  candles: ReadonlyArray<Pick<Candle, 'high' | 'low'>>,
  tf: RedSniperTimeframe = '5m'
): { eq: number; rangeHigh: number; rangeLow: number } | null {
  if (!candles || candles.length === 0) return null;
  const closed = candles.length > 1 ? candles.slice(0, candles.length - 1) : candles;
  const start = Math.max(0, closed.length - getLookbackForTf(tf));
  let rangeHigh = -Infinity;
  let rangeLow = Infinity;
  for (let i = start; i < closed.length; i++) {
    if (closed[i].high > rangeHigh) rangeHigh = closed[i].high;
    if (closed[i].low < rangeLow) rangeLow = closed[i].low;
  }
  if (!Number.isFinite(rangeHigh) || !Number.isFinite(rangeLow)) return null;
  return {
    eq: Number(((rangeHigh + rangeLow) / 2).toFixed(2)),
    rangeHigh: Number(rangeHigh.toFixed(2)),
    rangeLow: Number(rangeLow.toFixed(2)),
  };
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

const A_PLUS_HTF_SET = new Set<RedSniperTimeframe>(['15m', '30m', '1h', '4h', '1d']);

/**
 * Annotates multi-timeframe confluence while preserving 6-check A+ (checks.length >= 4) and PWR formula.
 */
export function applyMultiTimeframeConfluence(
  zone: RedSniperZone,
  htfZones: ReadonlyArray<Pick<RedSniperZone, 'tf' | 'side' | 'bottom' | 'top' | 'consumed' | 'pctLeft' | 'retests'>>
): RedSniperZone {
  const isPhase2APlus = Array.isArray(zone.checks) && zone.checks.length >= 4;
  if (!htfZones || htfZones.length === 0) {
    return isPhase2APlus !== Boolean(zone.isAPlus)
      ? { ...zone, isAPlus: isPhase2APlus }
      : zone;
  }

  const currentRank = TF_ORDER_RANK[zone.tf] ?? 1;
  const matchingTfs: RedSniperTimeframe[] = [];

  for (const hz of htfZones) {
    if (!A_PLUS_HTF_SET.has(hz.tf)) continue;
    const htfRank = TF_ORDER_RANK[hz.tf] ?? 0;
    if (htfRank <= currentRank) continue;
    if (hz.side !== zone.side) continue;
    if (doZonesOverlap(zone, hz)) {
      if (!matchingTfs.includes(hz.tf)) {
        matchingTfs.push(hz.tf);
      }
    }
  }

  if (matchingTfs.length === 0) {
    return isPhase2APlus !== Boolean(zone.isAPlus)
      ? { ...zone, isAPlus: isPhase2APlus }
      : zone;
  }

  const breakdown = zone.breakdown.includes('MTF')
    ? zone.breakdown
    : `${zone.breakdown} · MTF (${matchingTfs.join('/')})`;

  return {
    ...zone,
    isAPlus: isPhase2APlus,
    confluenceTfs: matchingTfs,
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
  formingCandleIncluded: boolean = true,
  nextHigherTfBiasOverride?: TfBias
): TimeframeAnalysis {
  const effectiveRetestMode: RetestMode = settings.retestModeOverride
    ? settings.retestMode
    : resolveDefaultRetestModeForTf(tf);

  if (!bars || bars.length < 12) {
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

  const closedBars =
    formingCandleIncluded && bars.length > 1
      ? bars.slice(0, bars.length - 1)
      : bars;
  const closedN = closedBars.length;
  const closedRefPrice = closedBars[closedN - 1].close;
  const lastClosedCandleTime = closedBars[closedN - 1].time;
  const farAtr = clamp(settings.farAtr ?? 25, 10, 60);
  const zonesPerSide = clamp(settings.zonesPerSide ?? 5, 3, 5);
  const hideConsumed =
    typeof settings.hideConsumed === 'boolean'
      ? settings.hideConsumed
      : !settings.showConsumedZones;
  const px =
    typeof livePriceOverride === 'number' &&
    Number.isFinite(livePriceOverride) &&
    livePriceOverride > 0
      ? livePriceOverride
      : closedRefPrice;

  // Next higher TF bias for the 6-check score
  const effectiveHtfBias: TfBias =
    nextHigherTfBiasOverride ??
    (tf === '1h' || tf === '4h' || tf === '1d' ? bias4h : bias1h);

  const volFirst = closedBars[0]?.tickVolume ?? 0;
  const volLast = closedBars[closedN - 1]?.tickVolume ?? 0;
  const tfSettingsHash = `${settings.zoneMode}|${zonesPerSide}|${INDICATOR_PARITY_SHIFT ? 1 : 0}|${effectiveRetestMode}|${settings.retestGapAtr}|${settings.deadAtr}|${farAtr}|${hideConsumed ? 1 : 0}|${formingCandleIncluded ? 1 : 0}|${effectiveHtfBias}|${bias1h}|${bias4h}|${volFirst}:${volLast}`;
  const closedSig = computeClosedBarsSignature(closedBars);
  const tfCacheKey = `${tf}::${lastClosedCandleTime}::${tfSettingsHash}::${closedSig}`;

  const cachedTf = tfAnalysisCache.get(tfCacheKey);
  if (cachedTf) {
    findZonesWithAudit(bars, tf, {
      mode: settings.zoneMode,
      zonesPerSide,
      hideConsumed,
      parityShift: INDICATOR_PARITY_SHIFT,
      retestMode: effectiveRetestMode,
      retestGapAtr: settings.retestGapAtr,
      deadAtr: settings.deadAtr,
      farAtr,
      formingCandleIncluded,
      livePrice: px,
      htfBias: effectiveHtfBias,
    });

    const updateZoneForLivePx = (z: RedSniperZone): RedSniperZone => {
      const distancePts = getZoneDistancePts(z, px);
      const isFar = distancePts > farAtr * z.atr14;
      if (z.distancePts === distancePts && z.isFar === isFar) return z;
      return { ...z, distancePts, isFar };
    };

    const updatedZones = cachedTf.zones.map(updateZoneForLivePx);
    const updatedChartZones = [...updatedZones].sort((a, b) => b.top - a.top);

    return {
      ...cachedTf,
      barsLoaded: bars.length,
      zones: updatedZones,
      chartZones: updatedChartZones,
    };
  }

  const { bias, ema20, ema50 } = computeTfBias(bars);

  const audit = findZonesWithAudit(bars, tf, {
    mode: settings.zoneMode,
    zonesPerSide,
    hideConsumed,
    parityShift: INDICATOR_PARITY_SHIFT,
    retestMode: effectiveRetestMode,
    retestGapAtr: settings.retestGapAtr,
    deadAtr: settings.deadAtr,
    farAtr,
    formingCandleIncluded,
    livePrice: closedRefPrice,
    htfBias: effectiveHtfBias,
  });

  const structures = audit.structures ?? computeStructureEvents(tf, bars, formingCandleIncluded);
  const atr14 = Number(audit.atr14.toFixed(2));

  const toRedSniperZone = (rz: RawBaseZone): RedSniperZone => {
    const bull = Boolean(rz.bull ?? !rz.supply);
    const side: ZoneSide = bull ? 'BUY' : 'SELL';
    const top = Number(rz.top.toFixed(2));
    const bottom = Number(rz.bottom.toFixed(2));
    const anchor = Number(((top + bottom) / 2).toFixed(2));
    const proximal = bull ? top : bottom;
    const distal = bull ? bottom : top;
    const width = Number((top - bottom).toFixed(2));
    const distancePts = getZoneDistancePts({ bottom, top }, px);
    const isFar = distancePts > farAtr * atr14;
    const status = resolveZoneStatus(rz.tests, rz.pctLeft);
    const consumed = Boolean(rz.consumed || rz.pctLeft < 10 || rz.tests >= 4);
    const originIndex = rz.originIndex ?? rz.startIdx;
    const choch = Boolean(rz.choch);
    const checks = Array.isArray(rz.checks) ? rz.checks : [];
    const pwr =
      typeof rz.pwr === 'number' && Number.isFinite(rz.pwr)
        ? rz.pwr
        : Math.min(96, 40 + 9 * checks.length);
    const isAPlus = checks.length >= 4;
    const key =
      rz.key ||
      `${tf}-${bull ? 'BULL' : 'BEAR'}-${originIndex}-${bottom.toFixed(2)}-${top.toFixed(2)}`;

    const volMult = computeBaseAndLegRelativeTickVolume(
      closedBars,
      rz.startIdx,
      rz.endIdx
    );

    const targetBias: TfBias = bull ? 'BULL' : 'BEAR';
    const htfOk = effectiveHtfBias === targetBias;
    const htfLabel: 'HTF ok' | 'HTF 1/2' | 'HTF against' = htfOk
      ? 'HTF ok'
      : effectiveHtfBias === 'NEUT'
      ? 'HTF 1/2'
      : 'HTF against';

    const checksLabel = checks.length > 0 ? checks.join('+') : 'NONE';
    const breakdown = `${choch ? 'CHoCH' : 'BOS'} · checks(${checks.length}/6: ${checksLabel}) · tests ${rz.tests} · ${rz.pctLeft}% left · ${htfLabel}`;
    const chartLabel = formatZoneChartLabel({
      side,
      bull,
      isAPlus,
      checks,
      choch,
      tests: rz.tests,
      retests: rz.tests,
      pwr,
      power: pwr,
    });

    return {
      id: `${tf}-${side}-${rz.time}-${bottom.toFixed(2)}-${top.toFixed(2)}`,
      key,
      tf,
      bull,
      side,
      supply: !bull,
      top,
      bottom,
      anchor,
      proximal,
      distal,
      width,
      time: rz.time,
      originIndex,
      eIndex: rz.eIndex,
      eVolume: rz.eVolume,
      startIdx: rz.startIdx,
      endIdx: rz.endIdx,
      baseN: rz.baseN,
      choch,
      tests: rz.tests,
      retests: rz.tests,
      independentRetests: rz.independentRetests,
      touchCandles: rz.touchCandles,
      touches: rz.touchCandles,
      pctLeft: rz.pctLeft,
      pwr,
      checks,
      consumed,
      sweep: rz.sweep,
      entryConfirmed: Boolean(rz.entryConfirmed),
      isAPlus,
      trimmed: rz.trimmed,
      weak: false,
      minor: false,
      bosConfirmed: true,
      isFar,
      distancePts,
      status,
      score: checks.length,
      power: pwr,
      departureAtr: Number(rz.dep.toFixed(2)),
      volMult,
      htfOk,
      htfLabel,
      breakdown,
      chartLabel,
      atr14,
    };
  };

  // Phase 4 Rule 6 & 7: Use the exact selected list (newest N per side, do not hide tested zones unless hideConsumed=true)
  const zones: RedSniperZone[] = audit.selected
    .map(toRedSniperZone)
    .filter((z) => !hideConsumed || (!z.consumed && z.pctLeft >= 10 && z.retests < 4));

  const chartZones = [...zones].sort((a, b) => b.top - a.top);

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
  aliveCount: number;
  aliveAfterOverlapCount: number;
  aliveAtThisValueButDeadAt025: DeadAtrDiffZone[];
}

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
              consumed: Boolean(z.consumed || z.pctLeft < 10 || z.tests >= 4),
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
  const biasByTf = {} as Record<RedSniperTimeframe, TfBias>;
  for (const tf of RED_SNIPER_TIMEFRAMES) {
    biasByTf[tf] = computeTfBias(barsMap[tf] || []).bias;
  }

  const byTf = {} as Record<RedSniperTimeframe, TimeframeAnalysis>;
  for (const tf of RED_SNIPER_TIMEFRAMES) {
    const nextHtf = getNextHigherTf(tf);
    const nextHtfBias = biasByTf[nextHtf] ?? verdict.bias1h;
    byTf[tf] = analyzeTimeframe(
      tf,
      barsMap[tf] || [],
      verdict.bias1h,
      verdict.bias4h,
      livePriceOverride,
      settings,
      formingCandleIncluded,
      nextHtfBias
    );
  }

  const htfConfluencePool: RedSniperZone[] = [
    ...(byTf['15m']?.zones || []),
    ...(byTf['30m']?.zones || []),
    ...(byTf['1h']?.zones || []),
    ...(byTf['4h']?.zones || []),
    ...(byTf['1d']?.zones || []),
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
  preferredTf: RedSniperTimeframe,
  rangeExtreme?: number | null
): { tp3: number; isLiquidity: boolean } {
  // Phase 3 rule: TP3 = nearest opposite zone or range extreme (min 2R, else 3R)
  const minTargetDist = 2.0 * riskPoints;

  const oppSide: ZoneSide = side === 'BUY' ? 'SELL' : 'BUY';
  const candidates = allZones.filter((z) => z.side === oppSide);

  let bestEdge: number | null = null;
  let bestDist = Infinity;

  for (const z of candidates) {
    const edge = side === 'BUY' ? z.bottom : z.top;
    const dist = side === 'BUY' ? edge - entry : entry - edge;
    if (dist >= minTargetDist - 1e-6) {
      const weightDist = z.tf === preferredTf ? dist * 0.98 : dist;
      if (weightDist < bestDist) {
        bestDist = weightDist;
        bestEdge = edge;
      }
    }
  }

  if (bestEdge !== null) {
    return { tp3: Number(bestEdge.toFixed(2)), isLiquidity: true };
  }

  if (typeof rangeExtreme === 'number' && Number.isFinite(rangeExtreme)) {
    const extDist = side === 'BUY' ? rangeExtreme - entry : entry - rangeExtreme;
    if (extDist >= minTargetDist - 1e-6) {
      return { tp3: Number(rangeExtreme.toFixed(2)), isLiquidity: true };
    }
  }

  const fallback =
    side === 'BUY'
      ? Number((entry + 3 * riskPoints).toFixed(2))
      : Number((entry - 3 * riskPoints).toFixed(2));
  return { tp3: fallback, isLiquidity: false };
}

/**
 * Phase 3 Trade Plan & Auto Sniper Builder:
 * - Status badge: PENDING BUY/SELL LIMIT (x pts away) or IN ZONE (wait for M1 confirmation).
 * - Entry = zone near edge (top for BUY, bottom for SELL).
 * - Stop Loss = far edge +/- 0.1 ATR (bottom - 0.1*ATR for BUY, top + 0.1*ATR for SELL).
 * - Lot from balance x risk %.
 * - TP1 = 1R, TP2 = 2R, TP3 = nearest opposite zone or range extreme (min 2R, else 3R).
 * - Chips: CHoCH/BOS, score x/6. Warning if score < 4 ("not A+, use caution").
 */
export function buildZoneTradeParameters(
  zone: RedSniperZone,
  entryPrice: number,
  balance: number,
  allZones: RedSniperZone[],
  bias1h: TfBias,
  bias4h: TfBias,
  settings: RedSniperSettings = DEFAULT_RED_SNIPER_SETTINGS,
  rangeExtreme?: number | null
): PendingTradePlan {
  const side: 'BUY' | 'SELL' = zone.side;
  const riskPct = clamp(settings.riskPct ?? 1.5, 0.25, 10.0);
  const maxRiskPoints = Math.max(0, settings.maxRiskPoints ?? 15);

  const nearEdge = side === 'BUY' ? zone.top : zone.bottom;
  const farEdge = side === 'BUY' ? zone.bottom : zone.top;
  const atr = Math.max(0.1, zone.atr14 || 2.0);
  const slOffset = Number((0.1 * atr).toFixed(2));

  const entry = Number(nearEdge.toFixed(2));
  const sl =
    side === 'BUY'
      ? Number((farEdge - slOffset).toFixed(2))
      : Number((farEdge + slOffset).toFixed(2));

  const rawRiskPoints = side === 'BUY' ? entry - sl : sl - entry;
  const riskPoints = Number(Math.max(0.05, rawRiskPoints).toFixed(2));

  const maxRiskSkipped = maxRiskPoints > 0 && riskPoints > maxRiskPoints;

  const rawLots = (balance * (riskPct / 100)) / (riskPoints * 100);
  const lots = Math.max(0.01, Number(rawLots.toFixed(2)));

  const tp1 =
    side === 'BUY'
      ? Number((entry + riskPoints).toFixed(2))
      : Number((entry - riskPoints).toFixed(2));
  const tp2 =
    side === 'BUY'
      ? Number((entry + 2 * riskPoints).toFixed(2))
      : Number((entry - 2 * riskPoints).toFixed(2));
  const { tp3, isLiquidity } = computeTp3Target(
    side,
    entry,
    riskPoints,
    allZones,
    zone.tf,
    rangeExtreme
  );

  const refPx =
    typeof entryPrice === 'number' && Number.isFinite(entryPrice) && entryPrice > 0
      ? entryPrice
      : entry;
  const insideZone = refPx >= zone.bottom && refPx <= zone.top;
  const distance = insideZone
    ? 0
    : refPx < zone.bottom
    ? Number((zone.bottom - refPx).toFixed(2))
    : Number((refPx - zone.top).toFixed(2));

  const statusBadge = insideZone
    ? 'IN ZONE (wait for M1 confirmation)'
    : `PENDING ${side} LIMIT (${distance.toFixed(1)} pts away)`;

  const scoreCount = Array.isArray(zone.checks)
    ? zone.checks.length
    : typeof zone.score === 'number'
    ? zone.score
    : 0;
  const structureChip: 'CHoCH' | 'BOS' = zone.choch ? 'CHoCH' : 'BOS';
  const scoreChip = `score ${scoreCount}/6`;
  const cautionWarning = scoreCount < 4 ? 'not A+, use caution' : null;

  const htfBlocked =
    (side === 'BUY' && bias1h === 'BEAR' && bias4h === 'BEAR') ||
    (side === 'SELL' && bias1h === 'BULL' && bias4h === 'BULL');

  return {
    zone,
    side,
    entry,
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
    statusBadge,
    structureChip,
    scoreChip,
    scoreCount,
    cautionWarning,
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

  // 1) ZONE_NEW (NEW): only for zones created while app runs
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
        message: `NEW: ${formatTfShort(z.tf)} ${z.side} ${z.bottom.toFixed(2)}-${z.top.toFixed(2)} · PWR ${z.power}`,
        details: {
          event: 'NEW',
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

  // 3) ZONE_DEAD (BROKEN): logged once when zone is mitigated by close beyond
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
      message: `BROKEN: ${dz.side} ${dz.bottom.toFixed(2)}-${dz.top.toFixed(2)} (closed beyond zone)`,
      details: {
        event: 'BROKEN',
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
  // FAR ZONES (> farAtr * ATR14) and CONSUMED ZONES (penetration > 90% / pctLeft < 10 or 4+ tests) are hidden from the bot
  const nearQualifying = allZones
    .filter(
      (z) =>
        !z.isFar &&
        (!z.minor || z.bosConfirmed === true) &&
        (settings.showConsumedZones || (!z.consumed && z.pctLeft >= 10)) &&
        z.retests < 4 &&
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
          (settings.showConsumedZones || (!z.consumed && z.pctLeft >= 10)) &&
          z.retests < 4 &&
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

  // Refuse to show a confident summary when n < 30 trades or the window is shorter than 12 hours:
  // label the summary "SMALL SAMPLE - NOT RELIABLE".
  const isShortWindow =
    typeof windowSeconds === 'number' &&
    Number.isFinite(windowSeconds) &&
    windowSeconds < 12 * 3600;
  const isReliableSample = totalTrades >= 30 && !isShortWindow;

  let confidenceLabel: PerformanceMetrics['confidenceLabel'] =
    'SMALL SAMPLE - NOT RELIABLE';
  let confidencePct = 15;

  if (!isReliableSample) {
    confidenceLabel = 'SMALL SAMPLE - NOT RELIABLE';
    confidencePct = Math.max(8, Math.round((Math.min(30, totalTrades) / 30) * 25));
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
