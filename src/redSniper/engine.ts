import {
  Candle,
  RedSniperBarsMap,
  RedSniperTimeframe,
  RED_SNIPER_TIMEFRAMES,
} from './feed';

export type ZoneSide = 'BULL' | 'BEAR';
export type ZoneStatus = 'FRESH' | 'TESTED' | 'DEEP';
export type StructureKind = 'BOS' | 'CHoCH';
export type TfBias = 'BULL' | 'BEAR' | 'NEUT';

export interface StructureEvent {
  id: string;
  tf: RedSniperTimeframe;
  dir: ZoneSide;
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
  side: ZoneSide;
  kind: StructureKind;
  obIdx: number;
  obTime: number;
  breakIdx: number;
  breakTime: number;
  top: number;
  bottom: number;
  width: number;
  touches: number;
  maxPenetration: number;
  pctLeft: number;
  status: ZoneStatus;
  power: number;
  dispAtr: number;
  volMult: number;
  bodyEff: number;
  hasFvg: boolean;
  htfOk: boolean;
  breakdown: string;
  atr14: number;
}

export interface TimeframeAnalysis {
  tf: RedSniperTimeframe;
  atr14: number;
  ema20: number | null;
  ema50: number | null;
  bias: TfBias;
  structures: StructureEvent[];
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
  result: 'TP3' | 'TP2+BE' | 'TP1+BE' | 'SL' | 'MANUAL';
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

interface PivotPoint {
  idx: number;
  time: number;
  price: number;
  broken: boolean;
}

/**
 * Check if index `p` is a 5-bar left / 5-bar right pivot high or pivot low.
 */
function isPivotHigh5(bars: Candle[], p: number): boolean {
  if (p < 5 || p + 5 >= bars.length) return false;
  const v = bars[p].high;
  for (let i = p - 5; i < p; i++) {
    if (bars[i].high > v) return false;
  }
  for (let i = p + 1; i <= p + 5; i++) {
    if (bars[i].high >= v) return false;
  }
  return true;
}

function isPivotLow5(bars: Candle[], p: number): boolean {
  if (p < 5 || p + 5 >= bars.length) return false;
  const v = bars[p].low;
  for (let i = p - 5; i < p; i++) {
    if (bars[i].low < v) return false;
  }
  for (let i = p + 1; i <= p + 5; i++) {
    if (bars[i].low <= v) return false;
  }
  return true;
}

/**
 * Analyze a single timeframe:
 * 1) 5-bar left/right pivots + BOS / CHoCH breaks
 * 2) Order blocks from break legs (min thickness 0.3)
 * 3) Mitigation (candle closes through far edge), touches, penetration, overlap pruning (keep older), top 3 per side
 * 4) POWER 0-99 calculation from real inputs + breakdown string
 */
export function analyzeTimeframe(
  tf: RedSniperTimeframe,
  bars: Candle[],
  bias1h: TfBias,
  bias4h: TfBias
): TimeframeAnalysis {
  const atrSeries = computeAtr14Series(bars);
  const latestAtr = atrSeries.length > 0 ? atrSeries[atrSeries.length - 1] : 2.5;
  const { bias, ema20, ema50 } = computeTfBias(bars);

  if (!bars || bars.length < 15) {
    return {
      tf,
      atr14: latestAtr,
      ema20,
      ema50,
      bias,
      structures: [],
      zones: [],
    };
  }

  let lastPivotHigh: PivotPoint | null = null;
  let lastPivotLow: PivotPoint | null = null;
  let trend: 1 | -1 | 0 = 0;

  const structures: StructureEvent[] = [];
  const rawCandidateZones: RedSniperZone[] = [];

  for (let bIdx = 10; bIdx < bars.length; bIdx++) {
    // At bar `bIdx`, pivot candidate at `candIdx = bIdx - 5` has 5 bars to its right confirmed
    const candIdx = bIdx - 5;
    if (isPivotHigh5(bars, candIdx)) {
      lastPivotHigh = {
        idx: candIdx,
        time: bars[candIdx].time,
        price: bars[candIdx].high,
        broken: false,
      };
    }
    if (isPivotLow5(bars, candIdx)) {
      lastPivotLow = {
        idx: candIdx,
        time: bars[candIdx].time,
        price: bars[candIdx].low,
        broken: false,
      };
    }

    const bar = bars[bIdx];

    // Check Bullish break of last unbroken pivot high
    if (lastPivotHigh && !lastPivotHigh.broken && bar.close > lastPivotHigh.price) {
      const kind: StructureKind = trend === -1 ? 'CHoCH' : 'BOS';
      trend = 1;
      lastPivotHigh.broken = true;

      const structEvent: StructureEvent = {
        id: `${tf}-BULL-${lastPivotHigh.time}-${bar.time}`,
        tf,
        dir: 'BULL',
        kind,
        pivotIdx: lastPivotHigh.idx,
        pivotTime: lastPivotHigh.time,
        price: lastPivotHigh.price,
        breakIdx: bIdx,
        breakTime: bar.time,
      };
      structures.push(structEvent);

      // Order block: lowest-low candle between pivotIdx and breakIdx
      let obIdx = lastPivotHigh.idx;
      for (let k = lastPivotHigh.idx; k <= bIdx; k++) {
        if (bars[k].low < bars[obIdx].low) {
          obIdx = k;
        }
      }
      const obBar = bars[obIdx];
      const hl2 = (obBar.high + obBar.low) / 2;
      const bottom = Number(obBar.low.toFixed(2));
      const top = Number(Math.max(hl2, Math.min(obBar.open, obBar.close)).toFixed(2));
      const width = Number((top - bottom).toFixed(2));

      if (width >= 0.3) {
        const zone = evaluateCandidateZone(
          tf,
          'BULL',
          kind,
          obIdx,
          bIdx,
          top,
          bottom,
          bars,
          atrSeries,
          bias1h,
          bias4h
        );
        if (zone) rawCandidateZones.push(zone);
      }
    }

    // Check Bearish break of last unbroken pivot low
    if (lastPivotLow && !lastPivotLow.broken && bar.close < lastPivotLow.price) {
      const kind: StructureKind = trend === 1 ? 'CHoCH' : 'BOS';
      trend = -1;
      lastPivotLow.broken = true;

      const structEvent: StructureEvent = {
        id: `${tf}-BEAR-${lastPivotLow.time}-${bar.time}`,
        tf,
        dir: 'BEAR',
        kind,
        pivotIdx: lastPivotLow.idx,
        pivotTime: lastPivotLow.time,
        price: lastPivotLow.price,
        breakIdx: bIdx,
        breakTime: bar.time,
      };
      structures.push(structEvent);

      // Order block: highest-high candle between pivotIdx and breakIdx
      let obIdx = lastPivotLow.idx;
      for (let k = lastPivotLow.idx; k <= bIdx; k++) {
        if (bars[k].high > bars[obIdx].high) {
          obIdx = k;
        }
      }
      const obBar = bars[obIdx];
      const hl2 = (obBar.high + obBar.low) / 2;
      const bottom = Number(Math.min(hl2, Math.max(obBar.open, obBar.close)).toFixed(2));
      const top = Number(obBar.high.toFixed(2));
      const width = Number((top - bottom).toFixed(2));

      if (width >= 0.3) {
        const zone = evaluateCandidateZone(
          tf,
          'BEAR',
          kind,
          obIdx,
          bIdx,
          top,
          bottom,
          bars,
          atrSeries,
          bias1h,
          bias4h
        );
        if (zone) rawCandidateZones.push(zone);
      }
    }
  }

  // Hide overlapping same-side zones (keep the older) and keep top 3 per side per timeframe
  const pruneSideZones = (side: ZoneSide): RedSniperZone[] => {
    const sideZones = rawCandidateZones
      .filter((z) => z.side === side)
      .sort((a, b) => a.obTime - b.obTime); // oldest first

    const nonOverlapping: RedSniperZone[] = [];
    for (const candidate of sideZones) {
      const overlapsOlder = nonOverlapping.some(
        (older) => Math.max(older.bottom, candidate.bottom) <= Math.min(older.top, candidate.top)
      );
      if (!overlapsOlder) {
        nonOverlapping.push(candidate);
      }
    }

    // Keep top 3 by power (then recency)
    return nonOverlapping
      .sort((a, b) => b.power - a.power || b.obTime - a.obTime)
      .slice(0, 3);
  };

  const finalBull = pruneSideZones('BULL');
  const finalBear = pruneSideZones('BEAR');

  return {
    tf,
    atr14: latestAtr,
    ema20,
    ema50,
    bias,
    structures: structures.slice(-18),
    zones: [...finalBear, ...finalBull].sort((a, b) => b.top - a.top),
  };
}

function evaluateCandidateZone(
  tf: RedSniperTimeframe,
  side: ZoneSide,
  kind: StructureKind,
  obIdx: number,
  breakIdx: number,
  top: number,
  bottom: number,
  bars: Candle[],
  atrSeries: number[],
  bias1h: TfBias,
  bias4h: TfBias
): RedSniperZone | null {
  const width = top - bottom;
  if (width < 0.3) return null;

  // Check mitigation & touches after breakIdx
  let touches = 0;
  let maxPenetration = 0;
  let inTouchExcursion = false;

  for (let m = breakIdx + 1; m < bars.length; m++) {
    const c = bars[m];
    if (side === 'BULL') {
      // Bull zone dies when a candle CLOSES below bottom
      if (c.close < bottom) {
        return null;
      }
      if (c.low <= top) {
        if (!inTouchExcursion) {
          touches += 1;
          inTouchExcursion = true;
        }
        const pen = clamp((top - c.low) / width, 0, 1);
        if (pen > maxPenetration) maxPenetration = pen;
      } else {
        inTouchExcursion = false;
      }
    } else {
      // Bear zone dies when a candle CLOSES above top
      if (c.close > top) {
        return null;
      }
      if (c.high >= bottom) {
        if (!inTouchExcursion) {
          touches += 1;
          inTouchExcursion = true;
        }
        const pen = clamp((c.high - bottom) / width, 0, 1);
        if (pen > maxPenetration) maxPenetration = pen;
      } else {
        inTouchExcursion = false;
      }
    }
  }

  const pctLeft = touches === 0 ? 100 : Math.round(clamp(100 * (1 - maxPenetration), 0, 100));
  const status: ZoneStatus =
    touches === 0 ? 'FRESH' : pctLeft >= 60 ? 'TESTED' : 'DEEP';

  // POWER 0-99 from real inputs:
  // 1) Displacement 30% (extreme of the leg minus zone edge, divided by ATR14, capped at 3 ATR)
  const atrAtBreak = Math.max(0.2, atrSeries[breakIdx] || atrSeries[atrSeries.length - 1] || 2.0);
  const legEnd = Math.min(bars.length - 1, breakIdx + 8);
  let legExtreme = side === 'BULL' ? top : bottom;
  for (let j = obIdx; j <= legEnd; j++) {
    if (side === 'BULL' && bars[j].high > legExtreme) legExtreme = bars[j].high;
    if (side === 'BEAR' && bars[j].low < legExtreme) legExtreme = bars[j].low;
  }
  const dispPoints = side === 'BULL' ? Math.max(0, legExtreme - top) : Math.max(0, bottom - legExtreme);
  const dispAtr = Number((dispPoints / atrAtBreak).toFixed(1));
  const dispScore = clamp(dispAtr / 3.0, 0, 1) * 30;

  // 2) Relative tick volume 25% (zone candle tickVolume / avg of previous 20 candles, capped 2.5x)
  const volStart = Math.max(0, obIdx - 20);
  let volSum = 0;
  let volCount = 0;
  for (let j = volStart; j < obIdx; j++) {
    if (bars[j].tickVolume > 0) {
      volSum += bars[j].tickVolume;
      volCount += 1;
    }
  }
  const avgVol20 = volCount > 0 ? volSum / volCount : bars[obIdx].tickVolume || 1;
  const zoneCandleVol = Math.max(bars[obIdx].tickVolume, bars[breakIdx].tickVolume);
  const volMult = avgVol20 > 0 ? Number((zoneCandleVol / avgVol20).toFixed(1)) : 1.0;
  const volScore = clamp(volMult / 2.5, 0, 1) * 25;

  // 3) Freshness 15% (pctLeft)
  const freshScore = (pctLeft / 100) * 15;

  // 4) Body efficiency 10% (break candle body/range)
  const breakBar = bars[breakIdx];
  const breakRange = Math.max(0.01, breakBar.high - breakBar.low);
  const bodyEff = clamp(Math.abs(breakBar.close - breakBar.open) / breakRange, 0, 1);
  const bodyScore = bodyEff * 10;

  // 5) FVG 10% (gap present around break)
  let hasFvg = false;
  const fvgStart = Math.max(1, obIdx);
  const fvgEnd = Math.min(bars.length - 2, breakIdx + 1);
  for (let j = fvgStart; j <= fvgEnd; j++) {
    if (side === 'BULL' && bars[j + 1].low > bars[j - 1].high) {
      hasFvg = true;
      break;
    }
    if (side === 'BEAR' && bars[j + 1].high < bars[j - 1].low) {
      hasFvg = true;
      break;
    }
  }
  const fvgScore = hasFvg ? 10 : 0;

  // 6) HTF alignment 10% (EMA20 vs EMA50 and price vs EMA50 on 1H and 4H agree with zone direction)
  const targetBias: TfBias = side === 'BULL' ? 'BULL' : 'BEAR';
  const match1h = bias1h === targetBias;
  const match4h = bias4h === targetBias;
  const htfScore = (match1h ? 5 : 0) + (match4h ? 5 : 0);
  const htfOk = match1h && match4h;

  let rawPower = dispScore + volScore + freshScore + bodyScore + fvgScore + htfScore;
  if (kind === 'CHoCH') {
    rawPower *= 1.06;
  }
  const power = clamp(Math.round(rawPower), 0, 99);

  const parts: string[] = [
    kind,
    `vol ${volMult.toFixed(1)}x`,
    `disp ${dispAtr.toFixed(1)} ATR`,
  ];
  if (hasFvg) parts.push('FVG');
  if (htfOk) parts.push('HTF ok');
  else if (match1h || match4h) parts.push('HTF partial');

  const latestTfAtr =
    atrSeries.length > 0 ? atrSeries[atrSeries.length - 1] : atrAtBreak;

  return {
    id: `${tf}-${side}-${bars[obIdx].time}`,
    tf,
    side,
    kind,
    obIdx,
    obTime: bars[obIdx].time,
    breakIdx,
    breakTime: bars[breakIdx].time,
    top,
    bottom,
    width: Number(width.toFixed(2)),
    touches,
    maxPenetration,
    pctLeft,
    status,
    power,
    dispAtr,
    volMult,
    bodyEff: Number(bodyEff.toFixed(2)),
    hasFvg,
    htfOk,
    breakdown: parts.join(' · '),
    atr14: latestTfAtr,
  };
}

export function analyzeAllTimeframes(barsMap: RedSniperBarsMap): {
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
      verdict.bias4h
    );
    byTf[tf] = analysis;
    allZones.push(...analysis.zones);
  }

  return { byTf, allZones, verdict };
}

/**
 * Find the nearest opposite-side zone edge if it lies between 2.5R and 6R from entry; otherwise return 3R.
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

  const oppSide: ZoneSide = side === 'BUY' ? 'BEAR' : 'BULL';
  const candidates = allZones.filter((z) => z.side === oppSide);

  let bestEdge: number | null = null;
  let bestDist = Infinity;

  // Prefer same timeframe or higher timeframe opposite zones first
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
 * Build trade parameters for a zone at a given entry price and balance.
 */
export function buildZoneTradeParameters(
  zone: RedSniperZone,
  entryPrice: number,
  balance: number,
  allZones: RedSniperZone[],
  bias1h: TfBias,
  bias4h: TfBias
): PendingTradePlan {
  const side: 'BUY' | 'SELL' = zone.side === 'BULL' ? 'BUY' : 'SELL';
  const buffer = clamp(0.3 * zone.atr14, 1.0, 2.0);

  let sl =
    side === 'BUY'
      ? Number((zone.bottom - buffer).toFixed(2))
      : Number((zone.top + buffer).toFixed(2));

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

  // Risk 1.5% of balance per trade, 1 lot = 100 oz -> lots = balance*0.015/(riskPoints*100), min 0.01
  const rawLots = (balance * 0.015) / (riskPoints * 100);
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
  lastEnteredText?: string | null
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

  const nearQualifying = allZones
    .filter((z) => z.power >= 50 && isZoneNear(z, livePrice))
    .sort((a, b) => getZoneDistancePts(a, livePrice) - getZoneDistancePts(b, livePrice) || b.power - a.power);

  if (nearQualifying.length === 0) {
    return 'Waiting: no near zone with PWR ≥ 50';
  }

  // Check if price is currently inside any qualifying near zone
  const insideZones = nearQualifying.filter(
    (z) => livePrice >= z.bottom && livePrice <= z.top
  );

  for (const z of insideZones) {
    const activeOnTf = state.openTrades.find((o) => o.tf === z.tf);
    if (activeOnTf) {
      return `Entered ${activeOnTf.side} ${formatTfShort(activeOnTf.tf)} @${activeOnTf.entry.toFixed(1)}`;
    }
    const side: 'BUY' | 'SELL' = z.side === 'BULL' ? 'BUY' : 'SELL';
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

  // Find nearest unused qualifying near zone
  const unusedNear = nearQualifying.filter((z) => !state.usedZoneIds.includes(z.id));
  const target = unusedNear[0] || nearQualifying[0];
  const dist = getZoneDistancePts(target, livePrice);
  const side: 'BUY' | 'SELL' = target.side === 'BULL' ? 'BUY' : 'SELL';
  const blocked =
    (side === 'BUY' && bias1h === 'BEAR' && bias4h === 'BEAR') ||
    (side === 'SELL' && bias1h === 'BULL' && bias4h === 'BULL');

  if (dist === 0 && blocked) {
    return 'Blocked: 1H+4H bias against';
  }

  return `Waiting: nearest zone ${formatTfShort(target.tf)} ${target.side} ${dist.toFixed(1)} pts away`;
}

/**
 * Evaluate SL/TP on every live tick, and open new trades if autoEnabled and price is inside a qualifying near zone.
 */
export function stepAutoTraderOnTick(
  state: RedSniperDemoState,
  livePrice: number,
  allZones: RedSniperZone[],
  bias1h: TfBias,
  bias4h: TfBias,
  sessionName: string,
  nowMs: number = Date.now()
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

  // 1) Evaluate SL / TP on existing open trades
  for (const rawTrade of state.openTrades) {
    const t: OpenSniperTrade = { ...rawTrade };
    const isBuy = t.side === 'BUY';

    // Check TP1 (1R -> close 50%, move SL to entry = break-even and HIDE SL line)
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

    // Check SL (or Break-Even stop if TP1 was already hit)
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
      } else if (t.tp1Hit && !t.tp2Hit) {
        // TP1 hit (+50%), remaining 50% closed at BE (entry)
        const finalPnl = Number(t.realizedPnl.toFixed(2));
        const finalR = Number(t.realizedR.toFixed(2));
        balance = Number((balance + finalPnl).toFixed(2));
        closedTrades.unshift({
          id: t.id,
          zoneId: t.zoneId,
          time: nowMs,
          tf: t.tf,
          side: t.side,
          entry: t.entry,
          exit: t.entry,
          pnl: finalPnl,
          r: finalR,
          result: 'TP1+BE',
          session: t.session,
          power: t.power,
          class: 'be',
        });
      } else {
        // TP2 hit (+50% at 1R, +30% at 2R), remaining 20% closed at BE (entry) -> win=TP2+ reached
        const finalPnl = Number(t.realizedPnl.toFixed(2));
        const finalR = Number(t.realizedR.toFixed(2));
        balance = Number((balance + finalPnl).toFixed(2));
        closedTrades.unshift({
          id: t.id,
          zoneId: t.zoneId,
          time: nowMs,
          tf: t.tf,
          side: t.side,
          entry: t.entry,
          exit: t.entry,
          pnl: finalPnl,
          r: finalR,
          result: 'TP2+BE',
          session: t.session,
          power: t.power,
          class: 'win',
        });
      }
      changed = true;
      continue;
    }

    openTrades.push(t);
  }

  // 2) Open new trades if autoEnabled and price is inside a qualifying near zone (power >= 50)
  if (state.autoEnabled && openTrades.length < 3) {
    // Only include zones within max(6*ATR14, 1.5% of price) and rank by power x proximity
    const qualifying = allZones
      .filter(
        (z) =>
          z.power >= 50 &&
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
      // Max 1 open trade per timeframe
      if (openTrades.some((o) => o.tf === zone.tf)) continue;

      const plan = buildZoneTradeParameters(
        zone,
        livePrice,
        balance,
        allZones,
        bias1h,
        bias4h
      );

      // Skip if BOTH 1H and 4H bias oppose the trade
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

  // Confidence bar: <10 trades LOW SAMPLE, <0 NEGATIVE, <0.15R NEUTRAL, <0.3 GOOD, <0.5 STRONG, else ELITE
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
