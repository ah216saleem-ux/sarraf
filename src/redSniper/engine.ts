import {
  Candle,
  RedSniperBarsMap,
  RedSniperTimeframe,
  RED_SNIPER_TIMEFRAMES,
} from './feed';
import {
  Candle as FireZoneCandle,
  FireZone,
  ZoneSide as FireZoneSide,
  ZoneStrengthLabel,
  ZoneType,
} from '../fireZone/types';
import { computeAtr } from '../fireZone/engineCore';
import {
  ZONE_HALF,
  buildRankedLevels,
  selectZonesFromLevels,
  extractZoneOriginCandidates,
  evaluateOriginCandidate,
  clusterAndBonusZoneCandidates,
} from '../fireZone/levels';
import {
  isZoneBrokenByClosedCandle,
  isZoneBrokenByLivePrice,
} from '../fireZone/lifecycle';
import {
  DualStructureResult,
  StructureBreakLine,
  computeDualStructure,
} from '../fireZone/structure';

export {
  ZONE_HALF,
  computeAtr,
  buildRankedLevels,
  selectZonesFromLevels,
  extractZoneOriginCandidates,
  evaluateOriginCandidate,
  clusterAndBonusZoneCandidates,
  isZoneBrokenByClosedCandle,
  isZoneBrokenByLivePrice,
  computeDualStructure,
};

export type ZoneSide = FireZoneSide; // 'BUY' | 'SELL'
export type ZoneStatus = 'FRESH' | 'TESTED' | 'DEEP';
export type StructureKind = 'BOS' | 'CHoCH';
export type TfBias = 'BULL' | 'BEAR' | 'NEUT';
export type ZoneWidthMode = 'FIXED_4' | 'ATR';

export interface RedSniperSettings {
  maxZonesPerTf: number; // 3-8, default 5
  minPowerToTrade: number; // default 50
  zoneWidthMode: ZoneWidthMode; // 'FIXED_4' | 'ATR', default 'ATR'
  slBuffer: number; // $1-$3, default $1.5
  trailTrigger: number; // $1-$2, default $2.0
  trailStep: number; // $1-$3, default $1.5
  riskPct: number; // default 1.5
  showBosChoch: boolean; // default false
  showFarZones: boolean; // default false
}

export const RED_SNIPER_SETTINGS_STORAGE_KEY = 'redSniperSettings';

export const DEFAULT_RED_SNIPER_SETTINGS: RedSniperSettings = {
  maxZonesPerTf: 5,
  minPowerToTrade: 50,
  zoneWidthMode: 'ATR',
  slBuffer: 1.5,
  trailTrigger: 2.0,
  trailStep: 1.5,
  riskPct: 1.5,
  showBosChoch: false,
  showFarZones: false,
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

export interface RedSniperZone {
  id: string;
  tf: RedSniperTimeframe;
  side: ZoneSide; // 'BUY' | 'SELL'
  slotType: ZoneType; // 'NEAREST' | 'DEEP'
  strengthLabel: ZoneStrengthLabel; // 'CRITICAL' | 'STRONG' | 'MODERATE'
  score: number;
  anchor: number;
  top: number; // HI
  bottom: number; // LO
  width: number;
  pivotIdx: number;
  pivotTime: number;
  pivotLevel: 5 | 15 | 20 | 50;
  retests: number;
  touches: number;
  maxPenetration: number;
  pctLeft: number;
  status: ZoneStatus;
  power: number;
  departureAtr: number;
  volMult: number | null; // null if tickVolume is missing
  htfOk: boolean;
  htfLabel: 'HTF ok' | 'HTF 1/2' | 'HTF against';
  breakdown: string;
  atr14: number;
}

export interface TimeframeAnalysis {
  tf: RedSniperTimeframe;
  atr14: number;
  halfWidth: number;
  ema20: number | null;
  ema50: number | null;
  bias: TfBias;
  structures: StructureEvent[];
  dualStructure: DualStructureResult;
  zones: RedSniperZone[];
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
  result: 'TP3' | 'TP2+TRAIL' | 'TP2+BE' | 'TP1+TRAIL' | 'TP1+BE' | 'SL' | 'MANUAL';
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
  confidenceLabel: 'LOW SAMPLE' | 'NEGATIVE' | 'NEUTRAL' | 'GOOD' | 'STRONG' | 'ELITE';
  confidencePct: number;
}

export const RED_SNIPER_DEMO_STORAGE_KEY = 'redSniperDemo';

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
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
    minPowerToTrade:
      typeof raw.minPowerToTrade === 'number' && Number.isFinite(raw.minPowerToTrade)
        ? clamp(Math.round(raw.minPowerToTrade), 0, 99)
        : DEFAULT_RED_SNIPER_SETTINGS.minPowerToTrade,
    zoneWidthMode:
      raw.zoneWidthMode === 'FIXED_4' || raw.zoneWidthMode === 'ATR'
        ? raw.zoneWidthMode
        : DEFAULT_RED_SNIPER_SETTINGS.zoneWidthMode,
    slBuffer:
      typeof raw.slBuffer === 'number' && Number.isFinite(raw.slBuffer)
        ? Number(clamp(raw.slBuffer, 1.0, 3.0).toFixed(2))
        : DEFAULT_RED_SNIPER_SETTINGS.slBuffer,
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
 * Compute halfWidth for a timeframe:
 * - For H1 ('1h') or when zoneWidthMode === 'FIXED_4': fixed ZONE_HALF = 2.0 ($4 wide).
 * - For other timeframes when zoneWidthMode === 'ATR': clamp(0.5 * ATR14, 1.0, 8.0).
 */
export function computeTimeframeZoneHalfWidth(
  tf: RedSniperTimeframe,
  atr14: number,
  zoneWidthMode: ZoneWidthMode = 'ATR'
): number {
  if (tf === '1h' || zoneWidthMode === 'FIXED_4') {
    return ZONE_HALF;
  }
  return Number(clamp(0.5 * Math.max(0.5, atr14), 1.0, 8.0).toFixed(2));
}

export function toFireZoneCandles(bars: Candle[]): FireZoneCandle[] {
  return bars.map((b) => ({
    time: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: Number.isFinite(b.tickVolume) ? b.tickVolume : 0,
  }));
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

export function computeAtr14Series(bars: Candle[]): number[] {
  if (bars.length === 0) return [];
  const tr: number[] = new Array(bars.length);
  tr[0] = Math.max(0.01, bars[0].high - bars[0].low);

  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const prevC = bars[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
  }

  const atr: number[] = new Array(bars.length);
  const period = 14;
  let sum = 0;

  for (let i = 0; i < bars.length; i++) {
    if (i < period) {
      sum += tr[i];
      atr[i] = Math.max(0.1, sum / (i + 1));
    } else {
      atr[i] = Math.max(0.1, (atr[i - 1] * (period - 1) + tr[i]) / period);
    }
  }

  return atr;
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

export function computeMultiTimeframeVerdict(barsMap: RedSniperBarsMap): VerdictResult {
  const b30m = computeTfBias(barsMap['30m']).bias;
  const b1h = computeTfBias(barsMap['1h']).bias;
  const b4h = computeTfBias(barsMap['4h']).bias;
  const b1d = computeTfBias(barsMap['1d']).bias;

  const toVal = (b: TfBias): number => (b === 'BULL' ? 1 : b === 'BEAR' ? -1 : 0);

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
 * Compute relative tickVolume on the pivot candle and the 3 candles that follow vs the 20-bar avg.
 * Returns null if tickVolume is missing for any bar in the pivot window or if the 20-bar avg has no valid volume.
 * Never fakes a number.
 */
export function computePivotRelativeTickVolume(
  closedBars: Array<Pick<Candle, 'tickVolume'>>,
  pivotIndex: number
): number | null {
  if (!closedBars || closedBars.length === 0) return null;
  if (pivotIndex < 0 || pivotIndex >= closedBars.length) return null;

  const endPivotWindow = Math.min(closedBars.length - 1, pivotIndex + 3);
  let pivotVolSum = 0;
  let pivotVolCount = 0;

  for (let i = pivotIndex; i <= endPivotWindow; i++) {
    const tv = closedBars[i]?.tickVolume;
    if (typeof tv !== 'number' || !Number.isFinite(tv) || tv <= 0) {
      // Missing tickVolume for a bar in the pivot + 3 candles window -> return null
      return null;
    }
    pivotVolSum += tv;
    pivotVolCount++;
  }

  if (pivotVolCount === 0) return null;
  const pivotAvgVol = pivotVolSum / pivotVolCount;

  const baseStart = Math.max(0, pivotIndex - 20);
  const baseEnd = pivotIndex - 1;
  let baseSum = 0;
  let baseCount = 0;

  for (let j = baseStart; j <= baseEnd; j++) {
    const tv = closedBars[j]?.tickVolume;
    if (typeof tv === 'number' && Number.isFinite(tv) && tv > 0) {
      baseSum += tv;
      baseCount++;
    }
  }

  if (baseCount === 0 || baseSum <= 0) {
    return null;
  }

  const avg20 = baseSum / baseCount;
  return Number((pivotAvgVol / avg20).toFixed(1));
}

/**
 * 2) POWER 0-99 (real & explainable):
 * power = round(100 * (
 *   0.45 * fireZoneScoreNormalized(score/14 capped 1) +
 *   0.25 * relativeTickVolume(cap 2.5x of the 20-bar avg, measured on the pivot candle and the 3 candles that follow) +
 *   0.15 * freshness +
 *   0.15 * higherTimeframeAlignment(1H and 4H EMA20/EMA50 direction agrees with the zone side)
 * ))
 * If tickVolume is missing for a bar, drop that term (0.25) and re-normalize the remaining weights
 * (0.45 + 0.15 + 0.15 = 0.75) - never fake a number; show "--" for volume in the breakdown.
 * Breakdown format: "score 9 STRONG · retests 0 · vol 1.8x · dep 2.4 ATR · HTF ok" (or "vol --" if missing).
 */
export function computeZonePowerAndBreakdown(params: {
  side: ZoneSide;
  score: number;
  strengthLabel: ZoneStrengthLabel;
  retests: number;
  departureAtr: number;
  volMult: number | null;
  bias1h: TfBias;
  bias4h: TfBias;
}): {
  power: number;
  htfOk: boolean;
  htfLabel: 'HTF ok' | 'HTF 1/2' | 'HTF against';
  breakdown: string;
} {
  const {
    side,
    score,
    strengthLabel,
    retests,
    departureAtr,
    volMult,
    bias1h,
    bias4h,
  } = params;

  const scoreNorm = clamp(score / 14, 0, 1);
  const freshnessNorm = retests <= 0 ? 1.0 : retests === 1 ? 0.5 : 0.0;

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
    weighted01 =
      0.45 * scoreNorm +
      0.25 * volNorm +
      0.15 * freshnessNorm +
      0.15 * htfNorm;
  } else {
    // Missing tickVolume: drop 0.25 term and re-normalize remaining weights (0.45 + 0.15 + 0.15 = 0.75)
    weighted01 =
      (0.45 * scoreNorm + 0.15 * freshnessNorm + 0.15 * htfNorm) / 0.75;
  }

  const power = clamp(Math.round(100 * weighted01), 0, 99);
  const volPart =
    typeof volMult === 'number' && Number.isFinite(volMult) && volMult > 0
      ? `vol ${volMult.toFixed(1)}x`
      : 'vol --';
  const depVal = Number.isFinite(departureAtr) ? departureAtr : 0;
  const breakdown = `score ${score} ${strengthLabel} · retests ${retests} · ${volPart} · dep ${depVal.toFixed(
    1
  )} ATR · ${htfLabel}`;

  return {
    power,
    htfOk,
    htfLabel,
    breakdown,
  };
}

function mapStructureBreaksToEvents(
  tf: RedSniperTimeframe,
  breaks: StructureBreakLine[]
): StructureEvent[] {
  return breaks.map((b) => ({
    id: `${tf}-${b.id}`,
    tf,
    dir: b.direction === 1 ? 'BULL' : 'BEAR',
    kind: b.label === 'BOS' ? 'BOS' : 'CHoCH',
    pivotIdx: b.pivotIndex,
    pivotTime: b.pivotTime,
    price: b.pivotPrice,
    breakIdx: b.breakIndex,
    breakTime: b.breakTime,
  }));
}

/**
 * Analyze a single timeframe by directly reusing src/fireZone (levels.ts, engineCore.ts, lifecycle.ts, structure.ts):
 * - Runs on that timeframe's closed candles (bars.length >= 2 ? bars.slice(0, -1) : bars), matching runFireZoneEngine.
 * - Uses livePrice (or last bar close) for live provisional break (> 0.5*ATR) and valid-side selection.
 * - Keeps up to settings.maxZonesPerTf (default 5, allowed 3-8): nearest valid zones first, then highest-score deeper zones.
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

  if (!bars || bars.length === 0) {
    const emptyDual = computeDualStructure([]);
    return {
      tf,
      atr14: 2.0,
      halfWidth: tf === '1h' ? ZONE_HALF : 2.0,
      ema20,
      ema50,
      bias,
      structures: [],
      dualStructure: emptyDual,
      zones: [],
    };
  }

  const closedBars = bars.length >= 2 ? bars.slice(0, -1) : bars;
  const closedFireCandles = toFireZoneCandles(closedBars);
  const atr14 = computeAtr(closedFireCandles, 14);
  const halfWidth = computeTimeframeZoneHalfWidth(tf, atr14, settings.zoneWidthMode);

  const closedRefBar = closedBars[closedBars.length - 1];
  const refPrice = closedRefBar.close;
  const livePrice =
    typeof livePriceOverride === 'number' &&
    Number.isFinite(livePriceOverride) &&
    livePriceOverride > 0
      ? livePriceOverride
      : bars[bars.length - 1].close;

  const dualStructure = computeDualStructure(closedFireCandles);
  const structures = mapStructureBreaksToEvents(tf, [
    ...dualStructure.internal.breaks,
    ...dualStructure.swing.breaks,
  ]).slice(-12);

  const brokenIds = new Set<string>();

  let allRankedLevels = buildRankedLevels(
    closedFireCandles,
    [],
    [],
    refPrice,
    [],
    atr14,
    [],
    brokenIds,
    halfWidth
  );

  let selection = selectZonesFromLevels(
    allRankedLevels,
    refPrice,
    atr14,
    closedRefBar.time,
    closedFireCandles.length - 1,
    undefined,
    closedFireCandles,
    [],
    livePrice,
    brokenIds,
    [],
    {
      halfWidth,
      maxZones: settings.maxZonesPerTf,
    }
  );

  // Live provisional break check (> 0.5*ATR beyond far edge): immediately replace if broken
  let anyLiveBreak = false;
  for (const z of [...selection.buyZones, ...selection.sellZones]) {
    const check = isZoneBrokenByLivePrice(z.side, z.bottom, z.top, livePrice, atr14);
    if (check.broken && !brokenIds.has(z.id)) {
      anyLiveBreak = true;
      brokenIds.add(z.id);
    }
  }

  if (anyLiveBreak) {
    allRankedLevels = buildRankedLevels(
      closedFireCandles,
      [],
      [],
      livePrice,
      [],
      atr14,
      [],
      brokenIds,
      halfWidth
    );
    selection = selectZonesFromLevels(
      allRankedLevels,
      livePrice,
      atr14,
      closedRefBar.time,
      closedFireCandles.length - 1,
      undefined,
      closedFireCandles,
      [],
      livePrice,
      brokenIds,
      [],
      {
        halfWidth,
        maxZones: settings.maxZonesPerTf,
      }
    );
  }

  const mapFireZoneToRedSniperZone = (fz: FireZone): RedSniperZone => {
    const retests = fz.touches;
    const maxPenetration = clamp(fz.maxPenetration ?? 0, 0, 1);
    const pctLeft =
      retests === 0 ? 100 : Math.round(clamp(100 * (1 - maxPenetration), 0, 100));
    const status: ZoneStatus =
      retests === 0
        ? 'FRESH'
        : retests > 2 || maxPenetration > 0.5
        ? 'DEEP'
        : 'TESTED';

    // Only compute volume on real pivot bars (not fallback EXT150)
    const isFallbackExtreme = fz.score === 3 && fz.touches === 0 && fz.departureAtr === 0;
    const volMult = isFallbackExtreme
      ? null
      : computePivotRelativeTickVolume(closedBars, fz.pivotIndex);

    const { power, htfOk, htfLabel, breakdown } = computeZonePowerAndBreakdown({
      side: fz.side,
      score: fz.score,
      strengthLabel: fz.label,
      retests,
      departureAtr: fz.departureAtr ?? 0,
      volMult,
      bias1h,
      bias4h,
    });

    return {
      id: `${tf}-${fz.id}`,
      tf,
      side: fz.side,
      slotType: fz.type || 'NEAREST',
      strengthLabel: fz.label,
      score: fz.score,
      anchor: fz.anchor,
      top: fz.top,
      bottom: fz.bottom,
      width: Number((fz.top - fz.bottom).toFixed(2)),
      pivotIdx: fz.pivotIndex,
      pivotTime: fz.pivotTime,
      pivotLevel: fz.pivotLevel,
      retests,
      touches: retests,
      maxPenetration,
      pctLeft,
      status,
      power,
      departureAtr: fz.departureAtr ?? 0,
      volMult,
      htfOk,
      htfLabel,
      breakdown,
      atr14,
    };
  };

  const combined = [...selection.sellZones, ...selection.buyZones]
    .map(mapFireZoneToRedSniperZone)
    .sort((a, b) => b.anchor - a.anchor);

  return {
    tf,
    atr14,
    halfWidth,
    ema20,
    ema50,
    bias,
    structures,
    dualStructure,
    zones: combined,
  };
}

export function analyzeAllTimeframes(
  barsMap: RedSniperBarsMap,
  livePriceOverride?: number | null,
  settings: RedSniperSettings = DEFAULT_RED_SNIPER_SETTINGS
): {
  byTf: Record<RedSniperTimeframe, TimeframeAnalysis>;
  allZones: RedSniperZone[];
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

  return { byTf, allZones, verdict };
}

/**
 * Find the nearest opposite-side Fire Zone edge if it lies between 2.5R and 6R from entry; otherwise return 3R.
 */
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

/**
 * 5) TRADE MANAGEMENT:
 * - SL = far edge of zone -/+ slBuffer (minimum total risk $2). Do NOT use the Fire Zone $12 stop.
 * - TP1 = 1R (close 50%, move SL to entry = break-even, hide the SL line)
 * - TP2 = 2R (close 30%)
 * - TP3 = nearest opposite Fire Zone edge between 2.5R and 6R, else 3R (close 20%).
 */
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

  let sl =
    side === 'BUY'
      ? Number((zone.bottom - slBuffer).toFixed(2))
      : Number((zone.top + slBuffer).toFixed(2));

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
  };
}

/**
 * Pure helper to step a trade's trailing stop after TP1:
 * Every time price moves another trailTrigger ($2 by default) beyond the last trail reference
 * (starting from TP1 price once TP1 is hit), move SL forward by trailStep ($1.5 by default)
 * in the profit direction. SL only moves forward, never backward, and never closer than $1 to live price.
 */
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
  if (!moved && ref === trade.trailRef && isTrailing === Boolean(trade.isTrailing)) {
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
      closedTrades: Array.isArray(parsed.closedTrades) ? parsed.closedTrades : [],
      usedZoneIds: Array.isArray(parsed.usedZoneIds) ? parsed.usedZoneIds : [],
    };
  } catch {
    return fallback;
  }
}

export function saveDemoState(state: RedSniperDemoState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RED_SNIPER_DEMO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
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

export function getZoneDistancePts(zone: RedSniperZone, livePrice: number): number {
  if (livePrice >= zone.bottom && livePrice <= zone.top) return 0;
  if (livePrice < zone.bottom) return Number((zone.bottom - livePrice).toFixed(2));
  return Number((livePrice - zone.top).toFixed(2));
}

/**
 * By default only include zones within max(6 * ATR14 of that zone's timeframe, 1.5% of price) of livePrice.
 */
export function isZoneNear(zone: RedSniperZone, livePrice: number): boolean {
  if (!Number.isFinite(livePrice) || livePrice <= 0) return true;
  const maxDist = Math.max(6 * zone.atr14, 0.015 * livePrice);
  return getZoneDistancePts(zone, livePrice) <= maxDist;
}

/**
 * Rank by power x proximity (closer = higher).
 */
export function computeZoneProximityScore(zone: RedSniperZone, livePrice: number): number {
  if (!Number.isFinite(livePrice) || livePrice <= 0) return zone.power;
  const dist = getZoneDistancePts(zone, livePrice);
  const scale = Math.max(1.5, zone.atr14 * 2);
  const proximity = 1 / (1 + dist / scale);
  return zone.power * proximity;
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
  settings: RedSniperSettings = DEFAULT_RED_SNIPER_SETTINGS
): string {
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
  const nearQualifying = allZones
    .filter((z) => z.power >= minPwr && isZoneNear(z, livePrice))
    .sort(
      (a, b) =>
        getZoneDistancePts(a, livePrice) - getZoneDistancePts(b, livePrice) ||
        b.power - a.power
    );

  if (nearQualifying.length === 0) {
    return `Waiting: no near zone with PWR ≥ ${minPwr}`;
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
    const side: 'BUY' | 'SELL' = z.side;
    const blocked =
      (side === 'BUY' && bias1h === 'BEAR' && bias4h === 'BEAR') ||
      (side === 'SELL' && bias1h === 'BULL' && bias4h === 'BULL');
    if (blocked) {
      return 'Blocked: 1H+4H bias against';
    }
    if (state.usedZoneIds.includes(z.id)) {
      continue;
    }
  }

  const unusedNear = nearQualifying.filter((z) => !state.usedZoneIds.includes(z.id));
  const target = unusedNear[0] || nearQualifying[0];
  const dist = getZoneDistancePts(target, livePrice);
  const side: 'BUY' | 'SELL' = target.side;
  const blocked =
    (side === 'BUY' && bias1h === 'BEAR' && bias4h === 'BEAR') ||
    (side === 'SELL' && bias1h === 'BULL' && bias4h === 'BULL');

  if (dist === 0 && blocked) {
    return 'Blocked: 1H+4H bias against';
  }

  return `Waiting: nearest zone ${formatTfShort(target.tf)} ${target.side} ${dist.toFixed(1)} pts away`;
}

/**
 * Evaluate SL/TP/Trailing Stop on every live tick, and open new trades if autoEnabled and price is inside a qualifying near zone.
 */
export function stepAutoTraderOnTick(
  state: RedSniperDemoState,
  livePrice: number,
  allZones: RedSniperZone[],
  bias1h: TfBias,
  bias4h: TfBias,
  sessionName: string,
  nowMs: number = Date.now(),
  settings: RedSniperSettings = DEFAULT_RED_SNIPER_SETTINGS
): { nextState: RedSniperDemoState; changed: boolean; enteredText: string | null } {
  if (!Number.isFinite(livePrice) || livePrice <= 0) {
    return { nextState: state, changed: false, enteredText: null };
  }

  let balance = state.balance;
  const openTrades: OpenSniperTrade[] = [];
  const closedTrades: ClosedSniperTrade[] = [...state.closedTrades];
  const usedZoneIds: string[] = [...state.usedZoneIds];
  let changed = false;
  let enteredText: string | null = null;

  // 1) Evaluate TP1 / TP2 / TP3 / Trailing Stop / SL on existing open trades
  for (const rawTrade of state.openTrades) {
    let t: OpenSniperTrade = { ...rawTrade };
    const isBuy = t.side === 'BUY';

    // Check TP1 (1R -> close 50%, move SL to entry = break-even and HIDE SL line, initialize trailRef = tp1)
    if (!t.tp1Hit) {
      const hitTp1 = isBuy ? livePrice >= t.tp1 : livePrice <= t.tp1;
      if (hitTp1) {
        const legPnl = 0.5 * t.initialLots * 100 * t.riskPoints;
        t.realizedPnl = Number((t.realizedPnl + legPnl).toFixed(2));
        t.realizedR = Number((t.realizedR + 0.5).toFixed(2));
        t.remPct = 0.5;
        t.sl = t.entry;
        t.beMoved = true;
        t.tp1Hit = true;
        t.trailRef = t.tp1;
        t.isTrailing = false;
        changed = true;
      }
    }

    // Check TP2 (2R -> close 30%)
    if (t.tp1Hit && !t.tp2Hit) {
      const hitTp2 = isBuy ? livePrice >= t.tp2 : livePrice <= t.tp2;
      if (hitTp2) {
        const legPnl = 0.3 * t.initialLots * 100 * (2 * t.riskPoints);
        t.realizedPnl = Number((t.realizedPnl + legPnl).toFixed(2));
        t.realizedR = Number((t.realizedR + 0.6).toFixed(2)); // 0.3 * 2R = 0.6R
        t.remPct = 0.2;
        t.tp2Hit = true;
        changed = true;
      }
    }

    // Check TP3 (close last 20%)
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
        changed = true;
        continue;
      }
    }

    // Step TRAILING STOP after TP1 (if price moved >= trailTrigger beyond trailRef)
    if (t.tp1Hit) {
      const trailRes = advanceTrailingStopAfterTp1(
        t,
        livePrice,
        settings.trailTrigger,
        settings.trailStep
      );
      if (trailRes.moved) {
        t = trailRes.updatedTrade;
        enteredText = `TRAIL ${t.side} ${formatTfShort(t.tf)}: SL → $${t.sl.toFixed(2)}`;
        changed = true;
      }
    }

    // Check SL (or Break-Even / Trailed stop if TP1 was already hit)
    const hitSl = isBuy ? livePrice <= t.sl : livePrice >= t.sl;
    if (hitSl) {
      if (!t.tp1Hit) {
        // Full 1R loss
        const lossPnl = -Number((t.initialLots * 100 * t.riskPoints).toFixed(2));
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
      } else {
        // Closed on BE or Trailed SL after TP1 (and possibly TP2)
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
      }
      changed = true;
      continue;
    }

    openTrades.push(t);
  }

  // 2) Open new trades if autoEnabled and price is inside a qualifying near zone (power >= settings.minPowerToTrade)
  const minPwr = settings.minPowerToTrade ?? 50;
  if (state.autoEnabled && openTrades.length < 3) {
    const qualifying = allZones
      .filter(
        (z) =>
          z.power >= minPwr &&
          isZoneNear(z, livePrice) &&
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

      if (plan.htfBlocked) continue;

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
      enteredText = `Entered ${newTrade.side} ${formatTfShort(newTrade.tf)} @${newTrade.entry.toFixed(1)}`;
      changed = true;
    }
  }

  if (!changed) {
    return { nextState: state, changed: false, enteredText: null };
  }

  const nextState: RedSniperDemoState = {
    balance,
    autoEnabled: state.autoEnabled,
    openTrades,
    closedTrades: closedTrades.slice(0, 200),
    usedZoneIds: usedZoneIds.slice(-500),
  };

  return { nextState, changed: true, enteredText };
}

/**
 * Compute Historical Performance metrics from closed trades.
 */
export function computePerformanceMetrics(
  closedTrades: ClosedSniperTrade[]
): PerformanceMetrics {
  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter((t) => t.class === 'win').length;
  const beCount = closedTrades.filter((t) => t.class === 'be').length;
  const losses = closedTrades.filter((t) => t.class === 'loss').length;

  const tp2WinRatePct = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;
  const bePct = totalTrades > 0 ? Math.round((beCount / totalTrades) * 100) : 0;
  const lossPct = totalTrades > 0 ? Math.round((losses / totalTrades) * 100) : 0;

  const totalR = closedTrades.reduce((acc, t) => acc + t.r, 0);
  const expectancyR = totalTrades > 0 ? Number((totalR / totalTrades).toFixed(2)) : 0;

  const sessionR: Record<'TOKYO' | 'LONDON' | 'NEW YORK' | 'LDN+NY', number> = {
    TOKYO: 0,
    LONDON: 0,
    'NEW YORK': 0,
    'LDN+NY': 0,
  };

  for (const t of closedTrades) {
    if (t.session === 'TOKYO') sessionR.TOKYO = Number((sessionR.TOKYO + t.r).toFixed(2));
    else if (t.session === 'LONDON')
      sessionR.LONDON = Number((sessionR.LONDON + t.r).toFixed(2));
    else if (t.session === 'NEW YORK')
      sessionR['NEW YORK'] = Number((sessionR['NEW YORK'] + t.r).toFixed(2));
    else if (t.session === 'LDN+NY')
      sessionR['LDN+NY'] = Number((sessionR['LDN+NY'] + t.r).toFixed(2));
  }

  let confidenceLabel: PerformanceMetrics['confidenceLabel'] = 'LOW SAMPLE';
  let confidencePct = 15;

  if (totalTrades < 10) {
    confidenceLabel = 'LOW SAMPLE';
    confidencePct = Math.max(8, Math.round((totalTrades / 10) * 25));
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
  };
}
