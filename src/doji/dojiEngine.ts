// src/doji/dojiEngine.ts

export type DojiTimeframe = '15m' | '30m' | '1h' | '4h';
export type DojiZoneState = 'waiting' | 'armed' | 'used';
export type DojiMode = 'indicator' | 'strict' | 'loose';
export type DojiZoneLifetime = 'untilBroken' | 'armed';
export type DojiDebugStatus =
  | 'waiting'
  | 'broken-up'
  | 'broken-down'
  | 'armed'
  | 'used'
  | 'cancelled'
  | 'hidden-by-cap'
  | 'hidden-by-distance';

export interface FlaggedDojiDebugItem {
  openTime: string;
  barTime: string;
  high: number;
  low: number;
  status: DojiDebugStatus;
}

export interface DojiRejectionCounts {
  byBody: number;
  byWickSymmetry: number;
  byAtrRange: number;
  byRedOnly: number;
  byBreakCancel: number;
  byDistance8Atr: number;
  byMaxZonesCap: number;
}

export interface RawBar {
  openTime: string; // ISO 8601
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  tickVolume?: number;
  isOpen?: boolean;
}

export interface DojiZone {
  id: string;
  timeframe: DojiTimeframe;
  barIndex: number;
  openTime: string; // ISO 8601
  openTimeSec: number; // Dubai GMT+4 timestamp in seconds
  barTime: string; // Formatted Dubai display string
  high: number;
  low: number;
  open: number;
  close: number;
  range: number;
  body: number;
  upperWick: number;
  lowerWick: number;
  wickDiff: number;
  isRed: boolean;

  // Break, arm & usage status
  zoneState: DojiZoneState;
  isBroken: boolean;
  breakDirection: 'UP' | 'DOWN' | null;
  breakBarIndex: number | null;
  breakTime: string | null;
  breakTimeDisplay: string | null;
  retestLevel: number | null;
  retestDistancePts: number;
  hasSignalFormed: boolean;
  isUsed: boolean;

  // Live retest heads-up when live price touches an armed zone's retest level before bar close
  isRetestLive?: boolean;
  retestLiveCloseTime?: string | null;
  retestLiveText?: string | null;

  // Strength metrics (0 - 10)
  shapeScore: number;
  costScore: number;
  trendScore: number;
  stageScore: number;
  freshnessScore: number;
  closenessScore: number;
  strength: number;
  strengthLabel: 'Strong' | 'Medium' | 'Weak';
  strengthColor: string;

  distancePts: number;
  side?: 'SELL' | 'BUY';
  isWithin5Atr?: boolean;
  mergedCount?: number;
  mergedOpenTimes?: string[];
}

export interface DojiTimeframeStats {
  timeframe: DojiTimeframe;
  barsCount: number;
  requestedBars: number;
  dojisCount: number;
  validCount: number;
  totalUncappedValidCount?: number;
  redOnlyDojisCount?: number;
  redOnlyValidCount?: number;
  redOnlyUncappedValidCount?: number;
  atr?: number;
  rejections?: DojiRejectionCounts;
  flaggedOpenTimeSecs?: number[];
  last10FlaggedDubaiTimes?: string[];
  last15FlaggedDojis?: FlaggedDojiDebugItem[];
  maxZonesPerTf?: number;
  maxDistanceAtr?: number;
  zoneLifetime?: DojiZoneLifetime;
  blockedByTrend?: number;
  blockedByConfirm?: number;
  mergedDojisCount?: number;
  trendFilter?: boolean;
  zoneMerge?: boolean;
  retestConfirm?: boolean;
}

export interface ActiveDojiSignal {
  status: 'ACTIVE' | 'WATCHING' | 'WAITING FOR DOJI CLOSE';
  direction: 'BUY' | 'SELL';
  timeframe: DojiTimeframe;
  targetZone: string;
  entryPrice: number;
  stopLoss: number;
  risk: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp1Rr: string;
  tp2Rr: string;
  tp3Rr: string;
  distanceToZone: string;
  riskReward: string;
  confidenceScore: number;
  issuedTime: string;
}

export interface DojiTradeLogEntry {
  id: string;
  time: string;
  timeframe: DojiTimeframe;
  direction: 'BUY' | 'SELL';
  entry: number;
  exit: number;
  pnlR: number;
  status: 'WIN' | 'LOSS' | 'OPEN';
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

export function getTimeframeIntervalMs(tf: DojiTimeframe): number {
  switch (tf) {
    case '15m':
      return 15 * 60 * 1000;
    case '30m':
      return 30 * 60 * 1000;
    case '1h':
      return 60 * 60 * 1000;
    case '4h':
      return 4 * 60 * 60 * 1000;
  }
}

/**
 * Format signed dollar amount: "+$2.16" and "–$0.51" (sign before $)
 */
export function formatSignedDollar(val: number): string {
  const num = Number(val) || 0;
  if (num < 0) {
    return `–$${Math.abs(num).toFixed(2)}`;
  }
  return `+$${num.toFixed(2)}`;
}

/**
 * Format rounded signed dollar amount: "+$9" and "–$15" (sign before $)
 */
export function formatRoundedSignedDollar(val: number): string {
  const num = Math.round(Number(val) || 0);
  if (num < 0) {
    return `–$${Math.abs(num)}`;
  }
  return `+$${num}`;
}

/**
 * Format Dubai timestamp as "23 Oct 18:45"
 */
export function formatDubaiShortTime(isoOrDate: string | Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(isoOrDate))
    .replace(',', '');
}

/**
 * Format Dubai HH:mm time as "11:00"
 */
export function formatDubaiHourMin(msOrDate: number | string | Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(msOrDate));
}

/**
 * Compute current signal bar close time in Dubai HH:mm format (e.g. "11:00")
 */
export function getSignalBarCloseTimeDubai(bars: RawBar[], timeframe: DojiTimeframe): string {
  const intervalMs = getTimeframeIntervalMs(timeframe);
  if (bars && bars.length > 0) {
    const lastBar = bars[bars.length - 1];
    const openMs = new Date(lastBar.openTime).getTime();
    if (Number.isFinite(openMs)) {
      const closeMs = lastBar.isOpen ? openMs + intervalMs : openMs + 2 * intervalMs;
      return formatDubaiHourMin(closeMs);
    }
  }
  const alignedCloseMs = Math.ceil(Date.now() / intervalMs) * intervalMs;
  return formatDubaiHourMin(alignedCloseMs);
}

/**
 * Evaluate whether an armed zone is currently experiencing a live retest on the unclosed bar
 */
export function evaluateZoneLiveRetest(
  zone: {
    barIndex: number;
    high: number;
    low: number;
    isBroken: boolean;
    breakDirection: 'UP' | 'DOWN' | null;
    breakBarIndex: number | null;
    isUsed: boolean;
  },
  bars: RawBar[],
  timeframe: DojiTimeframe,
  currentPrice: number
): {
  isRetestLive: boolean;
  retestLiveCloseTime: string | null;
  retestLiveText: string | null;
} {
  if (!zone.isBroken || zone.isUsed || !zone.breakDirection || !bars || bars.length === 0) {
    return { isRetestLive: false, retestLiveCloseTime: null, retestLiveText: null };
  }

  const closedBars = bars.filter((b) => !b.isOpen);
  const currentBarIdx = closedBars.length; // index of the currently forming bar
  if (currentBarIdx < zone.barIndex + 2) {
    return { isRetestLive: false, retestLiveCloseTime: null, retestLiveText: null };
  }
  if (zone.breakBarIndex !== null && currentBarIdx <= zone.breakBarIndex) {
    return { isRetestLive: false, retestLiveCloseTime: null, retestLiveText: null };
  }

  const lastBar = bars[bars.length - 1];
  const refPrice = currentPrice > 0 ? currentPrice : lastBar.close;
  const liveHigh = lastBar.isOpen ? Math.max(lastBar.high, refPrice) : refPrice;
  const liveLow = lastBar.isOpen ? Math.min(lastBar.low, refPrice) : refPrice;

  let touched = false;
  if (zone.breakDirection === 'DOWN') {
    // SELL retest live: live bar high or live price touches/crosses >= zone.low without closing > zone.high
    touched = liveHigh >= zone.low && refPrice <= zone.high;
  } else if (zone.breakDirection === 'UP') {
    // BUY retest live: live bar low or live price touches/crosses <= zone.high without closing < zone.low
    touched = liveLow <= zone.high && refPrice >= zone.low;
  }

  if (!touched) {
    return { isRetestLive: false, retestLiveCloseTime: null, retestLiveText: null };
  }

  const closeTimeStr = getSignalBarCloseTimeDubai(bars, timeframe);
  return {
    isRetestLive: true,
    retestLiveCloseTime: closeTimeStr,
    retestLiveText: `RETEST LIVE · signal bar close par: ${closeTimeStr}`,
  };
}

/**
 * Format trade opened timestamp in Dubai time as "Opened Fri 23 Oct 19:00"
 */
export function formatOpenedTime(isoOrDate: string | Date): string {
  const d = new Date(isoOrDate);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `Opened ${get('weekday')} ${get('day')} ${get('month')} ${get('hour')}:${get('minute')}`;
}

/**
 * Format held duration in hours and minutes ("2h 15m", "45m", "4h") instead of bars
 */
export function formatHeldDuration(barsHeld: number, timeframe: DojiTimeframe): string {
  const tfMins =
    timeframe === '15m' ? 15 : timeframe === '30m' ? 30 : timeframe === '1h' ? 60 : 240;
  const totalMins = Math.max(1, barsHeld) * tfMins;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

export function deduplicateBars(bars: RawBar[]): RawBar[] {
  const byTime = new Map<number, RawBar>();
  for (const b of bars) {
    if (!b || !b.openTime) continue;
    const ms = new Date(b.openTime).getTime();
    if (!Number.isFinite(ms)) continue;
    const open = Number(b.open);
    const high = Number(b.high);
    const low = Number(b.low);
    const close = Number(b.close);
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
    byTime.set(ms, {
      ...b,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
    });
  }
  return Array.from(byTime.entries())
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1]);
}

/**
 * Calculate ATR(14) on closed bars
 */
export function computeAtr14(bars: RawBar[]): number {
  if (!bars || bars.length < 2) return 3.5;
  const period = 14;
  let trSum = 0;
  const count = Math.min(period, bars.length - 1);
  for (let i = bars.length - count; i < bars.length; i++) {
    const prevClose = bars[i - 1].close;
    const cur = bars[i];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prevClose),
      Math.abs(cur.low - prevClose)
    );
    trSum += tr;
  }
  return Number((trSum / count).toFixed(2)) || 3.5;
}

/**
 * Check if a candle matches Doji criteria:
 * - 'indicator' mode (default, exact TradingView Pine logic):
 *   - isRed = close < open
 *   - bodySize = abs(open - close); totalRange = high - low
 *   - upperWick = high - max(open, close); lowerWick = min(open, close) - low
 *   - isSmallBody = bodySize <= totalRange * 0.20 (configurable bodyPct)
 *   - wicksSymmetric = abs(upperWick - lowerWick) <= totalRange * 0.15 AND (upperWick > 0 OR lowerWick > 0) (configurable wickDiffPct)
 *   - doji = isRed AND isSmallBody AND wicksSymmetric
 *   - NO ATR filter, NO minimum range (range > 0.3) check, NO red-only toggle (red is always required)
 * - 'strict' mode (exact legacy logic):
 *   - Red candle (if redOnly is true): close <= open
 *   - body <= bodyPct * range (default 20%)
 *   - upper and lower wick diff <= wickDiffPct * range (default 15%)
 *   - range >= minRangeAtr * ATR(14) (default 0.5) and range > 0.3
 * - 'loose' mode:
 *   - body <= bodyPct * range (default 10%)
 *   - does NOT require wick symmetry
 *   - does NOT require range >= 0.5 * ATR (uses configurable minRangeAtr, default 0.2)
 *   - does NOT require red-only
 */
export function checkIsDoji(
  bar: RawBar,
  atr: number,
  redOnly: boolean = true,
  mode: DojiMode = 'indicator',
  bodyPct: number = mode === 'loose' ? 0.10 : 0.20,
  wickDiffPct: number = 0.15,
  minRangeAtr: number = mode === 'strict' ? 0.5 : 0.2
): {
  isDoji: boolean;
  body: number;
  range: number;
  upperWick: number;
  lowerWick: number;
  wickDiff: number;
  isRed: boolean;
  rejectedBy?: 'body' | 'wickSymmetry' | 'atrRange' | 'redOnly' | null;
} {
  const normBodyPct = bodyPct > 1 ? bodyPct / 100 : bodyPct;
  const normWickDiffPct = wickDiffPct > 1 ? wickDiffPct / 100 : wickDiffPct;

  if (mode === 'indicator') {
    const isRed = bar.close < bar.open;
    const bodySize = Math.abs(bar.open - bar.close);
    const totalRange = bar.high - bar.low;
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const wickDiff = Math.abs(upperWick - lowerWick);
    const isSmallBody = bodySize <= totalRange * normBodyPct;
    const wicksSymmetric =
      wickDiff <= totalRange * normWickDiffPct && (upperWick > 0 || lowerWick > 0);
    const isDoji = isRed && isSmallBody && wicksSymmetric;

    let rejectedBy: 'body' | 'wickSymmetry' | 'atrRange' | 'redOnly' | null = null;
    if (!isDoji) {
      if (!isSmallBody) rejectedBy = 'body';
      else if (!wicksSymmetric) rejectedBy = 'wickSymmetry';
      else if (!isRed) rejectedBy = 'redOnly';
    }

    return {
      isDoji,
      body: bodySize,
      range: totalRange,
      upperWick,
      lowerWick,
      wickDiff,
      isRed,
      rejectedBy,
    };
  }

  const range = bar.high - bar.low;
  const isRed = bar.close <= bar.open;

  const body = Math.abs(bar.close - bar.open);
  const upperWick = bar.high - Math.max(bar.open, bar.close);
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;
  const wickDiff = Math.abs(upperWick - lowerWick);

  if (mode === 'strict') {
    const cond1 = range > 0 && body <= normBodyPct * range;
    const cond2 = range > 0 && wickDiff <= normWickDiffPct * range;
    const cond3 = range > 0.3 && range >= minRangeAtr * atr;
    const condRed = !redOnly || isRed;

    let rejectedBy: 'body' | 'wickSymmetry' | 'atrRange' | 'redOnly' | null = null;
    if (!(cond1 && cond2 && cond3 && condRed)) {
      if (!cond1) rejectedBy = 'body';
      else if (!cond2) rejectedBy = 'wickSymmetry';
      else if (!cond3) rejectedBy = 'atrRange';
      else if (!condRed) rejectedBy = 'redOnly';
    }

    if (range <= 0.3) {
      return {
        isDoji: false,
        body: 0,
        range,
        upperWick: 0,
        lowerWick: 0,
        wickDiff: 0,
        isRed,
        rejectedBy,
      };
    }

    if (redOnly && !isRed) {
      return {
        isDoji: false,
        body: 0,
        range,
        upperWick: 0,
        lowerWick: 0,
        wickDiff: 0,
        isRed,
        rejectedBy,
      };
    }

    return {
      isDoji: cond1 && cond2 && cond3,
      body,
      range,
      upperWick,
      lowerWick,
      wickDiff,
      isRed,
      rejectedBy,
    };
  }

  // 'loose' mode:
  // - body <= bodyPct * range (default 10%)
  // - do NOT require wick symmetry
  // - do NOT require range >= 0.5*ATR (use configurable minRangeAtr, default 0.2)
  // - do NOT require red-only
  if (range <= 0) {
    return {
      isDoji: false,
      body: 0,
      range,
      upperWick: 0,
      lowerWick: 0,
      wickDiff: 0,
      isRed,
      rejectedBy: 'atrRange',
    };
  }

  const condBody = body <= normBodyPct * range;
  const condAtr = range >= minRangeAtr * atr;
  const isDoji = condBody && condAtr;
  let rejectedBy: 'body' | 'wickSymmetry' | 'atrRange' | 'redOnly' | null = null;
  if (!isDoji) {
    if (!condBody) rejectedBy = 'body';
    else if (!condAtr) rejectedBy = 'atrRange';
  }

  return {
    isDoji,
    body,
    range,
    upperWick,
    lowerWick,
    wickDiff,
    isRed,
    rejectedBy,
  };
}

/**
 * Calculate Exponential Moving Average (EMA) with given period
 */
export function computeEma(bars: RawBar[], period: number = 9): { time: number; value: number }[] {
  if (!bars || bars.length < period) return [];

  const k = 2 / (period + 1);
  const result: { time: number; value: number }[] = [];

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += bars[i].close;
  }
  let ema = sum / period;

  const firstTime = Math.floor(new Date(bars[period - 1].openTime).getTime() / 1000) + 4 * 3600;
  result.push({ time: firstTime, value: Number(ema.toFixed(2)) });

  for (let i = period; i < bars.length; i++) {
    const close = bars[i].close;
    ema = close * k + ema * (1 - k);
    const t = Math.floor(new Date(bars[i].openTime).getTime() / 1000) + 4 * 3600;
    result.push({ time: t, value: Number(ema.toFixed(2)) });
  }

  return result;
}

/**
 * Calculate dynamic strength score (0.0 to 10.0) for a zone
 */
export interface HtfEma21Point {
  openMs: number;
  close: number;
  ema21: number;
  slope: number;
}

export function getHtfTimeframe(tf: DojiTimeframe): DojiTimeframe | null {
  if (tf === '15m' || tf === '30m') return '1h';
  if (tf === '1h') return '4h';
  return null;
}

/**
 * Build EMA21 + slope series from higher-timeframe bars for trend filtering
 */
export function buildHtfEma21Series(htfBars?: RawBar[]): HtfEma21Point[] {
  if (!htfBars || htfBars.length === 0) return [];
  const closed = deduplicateBars(htfBars).filter((b) => !b.isOpen);
  if (closed.length === 0) return [];

  const period = 21;
  const k = 2 / (period + 1);
  const series: HtfEma21Point[] = [];

  let sum = 0;
  let ema = closed[0].close;

  for (let i = 0; i < closed.length; i++) {
    const c = closed[i].close;
    const prevEma = ema;
    if (i < period) {
      sum += c;
      ema = sum / (i + 1);
    } else {
      ema = c * k + ema * (1 - k);
    }
    const openMs = new Date(closed[i].openTime).getTime();
    const slope = i > 0 ? ema - prevEma : 0;
    series.push({
      openMs,
      close: c,
      ema21: ema,
      slope,
    });
  }

  return series;
}

/**
 * Check higher-timeframe trend filter:
 * - For 15m and 30m: 1h trend (price above/below 1h EMA21 and EMA21 slope)
 * - For 1h: 4h trend (price above/below 4h EMA21 and EMA21 slope)
 * - For 4h: no filter (always returns true)
 */
export function checkHtfTrendAtTime(
  side: 'BUY' | 'SELL',
  timeframe: DojiTimeframe,
  barTimeMs: number,
  currentPrice: number,
  htfSeries?: HtfEma21Point[]
): boolean {
  if (timeframe === '4h') return true;
  if (!htfSeries || htfSeries.length === 0) return true;

  // Find latest HTF closed candle at or before barTimeMs
  let idx = 0;
  for (let j = htfSeries.length - 1; j >= 0; j--) {
    if (htfSeries[j].openMs <= barTimeMs) {
      idx = j;
      break;
    }
  }
  const pt = htfSeries[idx];
  if (!pt) return true;

  if (side === 'BUY') {
    return currentPrice > pt.ema21 && pt.slope > 0;
  }
  return currentPrice < pt.ema21 && pt.slope < 0;
}

/**
 * Check retest confirmation on a closed candle:
 * - Rejects the zone with a wick at least 50% of candle range on the zone side, OR
 * - Engulfing close away from the zone
 */
export function checkRetestConfirmation(
  side: 'BUY' | 'SELL',
  currentBar: RawBar,
  prevBar?: RawBar
): boolean {
  const range = currentBar.high - currentBar.low;
  if (range <= 0) return false;

  const upperWick = currentBar.high - Math.max(currentBar.open, currentBar.close);
  const lowerWick = Math.min(currentBar.open, currentBar.close) - currentBar.low;

  if (side === 'BUY') {
    const hasRejectionWick = lowerWick >= 0.5 * range;
    const prevBodyHigh = prevBar ? Math.max(prevBar.open, prevBar.close) : Infinity;
    const prevBodyLow = prevBar ? Math.min(prevBar.open, prevBar.close) : -Infinity;
    const isBullishEngulfing = Boolean(
      prevBar &&
        currentBar.close > currentBar.open &&
        (currentBar.close > prevBar.high ||
          (currentBar.close >= prevBodyHigh &&
            currentBar.open <= prevBodyLow &&
            currentBar.close - currentBar.open > Math.abs(prevBar.close - prevBar.open)))
    );
    return hasRejectionWick || isBullishEngulfing;
  }

  const hasRejectionWick = upperWick >= 0.5 * range;
  const prevBodyHigh = prevBar ? Math.max(prevBar.open, prevBar.close) : Infinity;
  const prevBodyLow = prevBar ? Math.min(prevBar.open, prevBar.close) : -Infinity;
  const isBearishEngulfing = Boolean(
    prevBar &&
      currentBar.close < currentBar.open &&
      (currentBar.close < prevBar.low ||
        (currentBar.close <= prevBodyLow &&
          currentBar.open >= prevBodyHigh &&
          currentBar.open - currentBar.close > Math.abs(prevBar.close - prevBar.open)))
  );
  return hasRejectionWick || isBearishEngulfing;
}

/**
 * Calculate dynamic strength score (0.0 to 10.0) for a zone
 */
export function calculateZoneStrength(
  zone: {
    high: number;
    low: number;
    range: number;
    body: number;
    wickDiff: number;
    barIndex: number;
    isBroken: boolean;
    breakDirection: 'UP' | 'DOWN' | null;
    mergedCount?: number;
  },
  currentPrice: number,
  currentEma9: number,
  atr: number,
  totalClosedBars: number
): {
  strength: number;
  shapeScore: number;
  costScore: number;
  trendScore: number;
  stageScore: number;
  freshnessScore: number;
  closenessScore: number;
  strengthLabel: 'Strong' | 'Medium' | 'Weak';
  strengthColor: string;
} {
  const { high, low, range, body, wickDiff, barIndex, isBroken, breakDirection, mergedCount } = zone;
  const safeRange = Math.max(range, 0.01);

  // 1. Shape (max 3): 1.5*(1 - body/(range*0.20)) + 1.5*(1 - wickDiff/(range*0.15)), each part >= 0
  const shapePart1 = Math.max(0, 1.5 * (1 - body / (safeRange * 0.20)));
  const shapePart2 = Math.max(0, 1.5 * (1 - wickDiff / (safeRange * 0.15)));
  const shapeScore = clamp(shapePart1 + shapePart2, 0, 3);

  // 2. Cost (max 2): risk = range + 2.5; 2 * clamp((25 - risk)/17, 0, 1)
  const risk = safeRange + 2.5;
  const costScore = 2 * clamp((25 - risk) / 17, 0, 1);

  // 3. Trend (max 2): zone break ho chuka aur price EMA9 ke usi taraf = 2; break nahi hua = 1; ulta = 0
  let trendScore = 1;
  if (isBroken) {
    if (breakDirection === 'UP') {
      trendScore = currentPrice >= currentEma9 ? 2 : 0;
    } else if (breakDirection === 'DOWN') {
      trendScore = currentPrice <= currentEma9 ? 2 : 0;
    }
  }

  // 4. Stage (max 1): break ho chuka = 1, nahi = 0.3
  const stageScore = isBroken ? 1.0 : 0.3;

  // 5. Freshness (max 1): 1 - bars_since_doji/80, 0 se neeche nahi
  const barsSinceDoji = Math.max(0, totalClosedBars - 1 - barIndex);
  const freshnessScore = Math.max(0, 1 - barsSinceDoji / 80);

  // 6. Closeness (max 1):
  // break ke baad: 1 - (price se level ka fasla / ATR)/1.5, 0 se neeche nahi; break se pehle: 0.3
  let closenessScore = 0.3;
  if (isBroken && atr > 0) {
    const level = breakDirection === 'UP' ? high : low;
    const dist = Math.abs(currentPrice - level);
    closenessScore = Math.max(0, 1 - dist / atr / 1.5);
  }

  // +1 to strength per additional merged doji (max 10)
  const mergeBonus = Math.max(0, (mergedCount ?? 1) - 1);
  const rawStrength =
    shapeScore + costScore + trendScore + stageScore + freshnessScore + closenessScore + mergeBonus;
  const strength = Number(clamp(rawStrength, 0, 10).toFixed(1));

  let strengthLabel: 'Strong' | 'Medium' | 'Weak' = 'Weak';
  let strengthColor = '#e5584f'; // Red
  if (strength >= 7.0) {
    strengthLabel = 'Strong';
    strengthColor = '#3fbf8f'; // Green
  } else if (strength >= 5.0) {
    strengthLabel = 'Medium';
    strengthColor = '#d9b25a'; // Gold
  }

  return {
    strength,
    shapeScore,
    costScore,
    trendScore,
    stageScore,
    freshnessScore,
    closenessScore,
    strengthLabel,
    strengthColor,
  };
}

/**
 * Merge Doji zones that overlap or are within 0.3 * ATR of each other into a single zone (min low to max high)
 * and add +1 to strength per additional merged doji (max 10).
 */
export function mergeDojiZonesList(
  zones: DojiZone[],
  atr: number,
  currentPrice: number,
  currentEma9: number,
  totalClosedBars: number
): { mergedZones: DojiZone[]; mergedExtraCount: number } {
  if (!zones || zones.length <= 1) {
    return { mergedZones: zones || [], mergedExtraCount: 0 };
  }

  const maxGap = 0.3 * (atr > 0 ? atr : 3.5);
  interface Cluster {
    low: number;
    high: number;
    items: DojiZone[];
  }

  const clusters: Cluster[] = zones.map((z) => ({
    low: z.low,
    high: z.high,
    items: [z],
  }));

  // Iteratively merge any two clusters that overlap or are within 0.3 * ATR and share the same break state
  let didMerge = true;
  while (didMerge) {
    didMerge = false;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i];
        const b = clusters[j];
        const aRep = a.items[a.items.length - 1];
        const bRep = b.items[b.items.length - 1];
        const sameDirection = aRep.breakDirection === bRep.breakDirection;
        const gap = Math.max(a.low, b.low) - Math.min(a.high, b.high);

        if (sameDirection && gap <= maxGap) {
          a.low = Number(Math.min(a.low, b.low).toFixed(2));
          a.high = Number(Math.max(a.high, b.high).toFixed(2));
          a.items.push(...b.items);
          a.items.sort((x, y) => x.barIndex - y.barIndex);
          clusters.splice(j, 1);
          didMerge = true;
          break;
        }
      }
      if (didMerge) break;
    }
  }

  let mergedExtraCount = 0;
  const mergedZones: DojiZone[] = clusters.map((cluster) => {
    if (cluster.items.length === 1) {
      const single = cluster.items[0];
      return {
        ...single,
        mergedCount: single.mergedCount ?? 1,
        mergedOpenTimes: single.mergedOpenTimes ?? [single.openTime],
      };
    }

    const items = cluster.items;
    const first = items[0];
    const last = items[items.length - 1];
    const best = [...items].sort((x, y) => y.strength - x.strength)[0];
    const totalMergedDojis = items.reduce((acc, z) => acc + (z.mergedCount ?? 1), 0);
    mergedExtraCount += totalMergedDojis - 1;

    const low = cluster.low;
    const high = cluster.high;
    const mid = Number(((high + low) / 2).toFixed(2));
    const isBroken = items.some((z) => z.isBroken);
    const breakItem = [...items].reverse().find((z) => z.isBroken) || last;
    const breakDirection = breakItem.breakDirection;
    const isUsed = items.some((z) => z.isUsed);
    const zoneState: DojiZoneState = isUsed ? 'used' : isBroken ? 'armed' : 'waiting';

    const retestLevel: number | null = isBroken
      ? breakDirection === 'UP'
        ? high
        : low
      : null;
    const retestDistancePts =
      retestLevel !== null
        ? Number((retestLevel - currentPrice).toFixed(2))
        : Number((mid - currentPrice).toFixed(2));

    const distPts = Number((mid - currentPrice).toFixed(2));
    const side: 'SELL' | 'BUY' = distPts >= 0 ? 'SELL' : 'BUY';
    const distFromLevel =
      currentPrice >= low && currentPrice <= high
        ? 0
        : Math.min(Math.abs(currentPrice - high), Math.abs(currentPrice - low));
    const isWithin5Atr = distFromLevel <= 5 * (atr > 0 ? atr : 3.5);

    const strengthRes = calculateZoneStrength(
      {
        high,
        low,
        range: best.range,
        body: best.body,
        wickDiff: best.wickDiff,
        barIndex: last.barIndex,
        isBroken,
        breakDirection,
        mergedCount: totalMergedDojis,
      },
      currentPrice,
      currentEma9,
      atr,
      totalClosedBars
    );

    const allOpenTimes = Array.from(
      new Set(items.flatMap((z) => z.mergedOpenTimes ?? [z.openTime]))
    );

    return {
      ...last,
      id: first.id,
      barIndex: last.barIndex,
      openTime: first.openTime,
      openTimeSec: first.openTimeSec,
      barTime: last.barTime,
      high,
      low,
      range: best.range,
      body: best.body,
      wickDiff: best.wickDiff,
      zoneState,
      isBroken,
      breakDirection,
      breakBarIndex: breakItem.breakBarIndex,
      breakTime: breakItem.breakTime,
      breakTimeDisplay: breakItem.breakTimeDisplay,
      retestLevel,
      retestDistancePts,
      hasSignalFormed: isUsed,
      isUsed,
      ...strengthRes,
      distancePts: distPts,
      side,
      isWithin5Atr,
      mergedCount: totalMergedDojis,
      mergedOpenTimes: allOpenTimes,
    };
  });

  mergedZones.sort((a, b) => a.openTimeSec - b.openTimeSec);
  return { mergedZones, mergedExtraCount };
}

/**
 * Extract valid Doji zones and diagnostic stats for a specific timeframe from all loaded bars:
 * - Supports 'indicator', 'strict', and 'loose' DojiMode with configurable bodyPct, wickDiffPct, minRangeAtr
 * - Zone remains valid until broken (closes on one side then closes on the other side) or price moves > maxDistanceAtr ATR away (default 8 ATR)
 * - Trade execution does NOT remove the zone from the chart; it marks the zone as "used" (isUsed: true)
 * - Configurable max valid zones per timeframe (default keep last 10, combining used and unused)
 */
export function extractValidDojiZonesWithStats(
  bars: RawBar[],
  timeframe: DojiTimeframe,
  currentPrice: number,
  redOnly: boolean = true,
  consumedOpenTimes?: Set<string>,
  mode: DojiMode = 'indicator',
  bodyPct: number = mode === 'loose' ? 0.10 : 0.20,
  wickDiffPct: number = 0.15,
  minRangeAtr: number = mode === 'strict' ? 0.5 : 0.2,
  maxZonesPerTf: number = 50,
  maxDistanceAtr: number = 0,
  zoneLifetime: DojiZoneLifetime = 'untilBroken',
  zoneMerge: boolean = true
): {
  zones: DojiZone[];
  stats: DojiTimeframeStats;
} {
  const rejections: DojiRejectionCounts = {
    byBody: 0,
    byWickSymmetry: 0,
    byAtrRange: 0,
    byRedOnly: 0,
    byBreakCancel: 0,
    byDistance8Atr: 0,
    byMaxZonesCap: 0,
  };

  const uniqueBars = deduplicateBars(bars || []);
  const barsCount = uniqueBars.length;
  const closedBars = uniqueBars.filter((b) => !b.isOpen);

  if (closedBars.length < 15) {
    return {
      zones: [],
      stats: {
        timeframe,
        barsCount,
        requestedBars: 1000,
        dojisCount: 0,
        validCount: 0,
        totalUncappedValidCount: 0,
        redOnlyDojisCount: 0,
        redOnlyValidCount: 0,
        redOnlyUncappedValidCount: 0,
        atr: 3.5,
        rejections,
        flaggedOpenTimeSecs: [],
        last10FlaggedDubaiTimes: [],
        last15FlaggedDojis: [],
        maxZonesPerTf,
        maxDistanceAtr,
        zoneLifetime,
        zoneMerge,
        mergedDojisCount: 0,
      },
    };
  }

  const latestAtr = computeAtr14(closedBars);
  const rollingAtrs = closedBars.map((_, idx) =>
    computeAtr14(closedBars.slice(0, Math.max(2, idx + 1)))
  );

  const emaList = computeEma(closedBars, 9);
  const currentEma9 = emaList.length > 0 ? emaList[emaList.length - 1].value : currentPrice;

  const validZones: DojiZone[] = [];
  const flaggedOpenTimeSecs: number[] = [];
  const flaggedDubaiTimes: string[] = [];
  const flaggedDebugItems: FlaggedDojiDebugItem[] = [];
  const debugItemByOpenTime = new Map<string, FlaggedDojiDebugItem>();
  const totalClosed = closedBars.length;
  let dojisCount = 0;
  let redOnlyDojisCount = 0;
  let redOnlyUncappedValidCount = 0;

  for (let i = 0; i < totalClosed; i++) {
    const bar = closedBars[i];
    const atrAtBar = rollingAtrs[i] || latestAtr;
    const effectiveAtrForDoji = Math.min(latestAtr, atrAtBar);

    const checkRed = checkIsDoji(
      bar,
      effectiveAtrForDoji,
      true,
      mode,
      bodyPct,
      wickDiffPct,
      minRangeAtr
    );
    if (checkRed.isDoji) {
      redOnlyDojisCount += 1;
    }

    const check = checkIsDoji(
      bar,
      effectiveAtrForDoji,
      redOnly,
      mode,
      bodyPct,
      wickDiffPct,
      minRangeAtr
    );
    if (!check.isDoji) {
      if (check.rejectedBy === 'body') rejections.byBody += 1;
      else if (check.rejectedBy === 'wickSymmetry') rejections.byWickSymmetry += 1;
      else if (check.rejectedBy === 'atrRange') rejections.byAtrRange += 1;
      else if (check.rejectedBy === 'redOnly') rejections.byRedOnly += 1;
      continue;
    }

    dojisCount += 1;
    const openTimeSec = Math.floor(new Date(bar.openTime).getTime() / 1000) + 4 * 3600;
    flaggedOpenTimeSecs.push(openTimeSec);
    const barTime = formatDubaiShortTime(bar.openTime);
    flaggedDubaiTimes.push(barTime);

    const high = Number(bar.high.toFixed(2));
    const low = Number(bar.low.toFixed(2));
    const mid = Number(((high + low) / 2).toFixed(2));

    const debugItem: FlaggedDojiDebugItem = {
      openTime: bar.openTime,
      barTime,
      high,
      low,
      status: 'waiting',
    };
    flaggedDebugItems.push(debugItem);
    debugItemByOpenTime.set(bar.openTime, debugItem);

    // Follow subsequent closed bars to track break above high or below low
    let isBroken = false;
    let breakDirection: 'UP' | 'DOWN' | null = null;
    let breakBarIndex: number | null = null;
    let breakTime: string | null = null;
    let breakTimeDisplay: string | null = null;
    let isFailed = false;

    for (let j = i + 1; j < totalClosed; j++) {
      const nextBar = closedBars[j];

      if (!isBroken) {
        if (nextBar.close > high) {
          isBroken = true;
          breakDirection = 'UP';
          breakBarIndex = j;
          breakTime = nextBar.openTime;
          breakTimeDisplay = formatDubaiShortTime(nextBar.openTime);
        } else if (nextBar.close < low) {
          isBroken = true;
          breakDirection = 'DOWN';
          breakBarIndex = j;
          breakTime = nextBar.openTime;
          breakTimeDisplay = formatDubaiShortTime(nextBar.openTime);
        }
      } else {
        // Price closed back through the zone after the break -> failed
        if (breakDirection === 'UP' && nextBar.close < low) {
          isFailed = true;
          break;
        } else if (breakDirection === 'DOWN' && nextBar.close > high) {
          isFailed = true;
          break;
        }
      }
    }

    const isUsed = consumedOpenTimes ? consumedOpenTimes.has(bar.openTime) : false;

    // Single lifecycle: zone stays while 'waiting' or 'armed'.
    // Remove when used (setup taken) or failed (price closed back through it).
    if (isFailed) {
      rejections.byBreakCancel += 1;
      debugItem.status = 'cancelled';
      continue;
    }
    if (isUsed) {
      rejections.byBreakCancel += 1;
      debugItem.status = 'used';
      continue;
    }

    // Distance filter: when on (maxDistanceAtr > 0), use latestAtr, not peakAtr
    const distFromLevel =
      currentPrice >= low && currentPrice <= high
        ? 0
        : Math.min(Math.abs(currentPrice - high), Math.abs(currentPrice - low));
    if (maxDistanceAtr > 0 && distFromLevel > maxDistanceAtr * latestAtr) {
      rejections.byDistance8Atr += 1;
      debugItem.status = 'hidden-by-distance';
      continue;
    }

    if (checkRed.isDoji) {
      redOnlyUncappedValidCount += 1;
    }

    const zoneState: DojiZoneState = isUsed ? 'used' : isBroken ? 'armed' : 'waiting';
    debugItem.status = zoneState;

    const retestLevel: number | null = isBroken
      ? breakDirection === 'UP'
        ? high
        : low
      : null;
    const retestDistancePts =
      retestLevel !== null
        ? Number((retestLevel - currentPrice).toFixed(2))
        : Number((mid - currentPrice).toFixed(2));

    const liveRetestInfo = evaluateZoneLiveRetest(
      {
        barIndex: i,
        high,
        low,
        isBroken,
        breakDirection,
        breakBarIndex,
        isUsed,
      },
      uniqueBars,
      timeframe,
      currentPrice
    );

    const strengthRes = calculateZoneStrength(
      {
        high,
        low,
        range: check.range,
        body: check.body,
        wickDiff: check.wickDiff,
        barIndex: i,
        isBroken,
        breakDirection,
        mergedCount: 1,
      },
      currentPrice,
      currentEma9,
      latestAtr,
      totalClosed
    );

    const distPts = Number((mid - currentPrice).toFixed(2));
    const side: 'SELL' | 'BUY' = distPts >= 0 ? 'SELL' : 'BUY';
    const isWithin5Atr = distFromLevel <= 5 * latestAtr;

    validZones.push({
      id: `doji-zone-${timeframe}-${bar.openTime}`,
      timeframe,
      barIndex: i,
      openTime: bar.openTime,
      openTimeSec,
      barTime,
      high,
      low,
      open: bar.open,
      close: bar.close,
      range: check.range,
      body: check.body,
      upperWick: check.upperWick,
      lowerWick: check.lowerWick,
      wickDiff: check.wickDiff,
      isRed: check.isRed,
      zoneState,
      isBroken,
      breakDirection,
      breakBarIndex,
      breakTime,
      breakTimeDisplay,
      retestLevel,
      retestDistancePts,
      hasSignalFormed: isUsed,
      isUsed,
      ...liveRetestInfo,
      ...strengthRes,
      distancePts: distPts,
      side,
      isWithin5Atr,
      mergedCount: 1,
      mergedOpenTimes: [bar.openTime],
    });
  }

  let effectiveValidZones = validZones;
  let mergedDojisCount = 0;

  if (zoneMerge && validZones.length > 1) {
    const mergedResult = mergeDojiZonesList(
      validZones,
      latestAtr,
      currentPrice,
      currentEma9,
      totalClosed
    );
    effectiveValidZones = mergedResult.mergedZones;
    mergedDojisCount = mergedResult.mergedExtraCount;
  }

  const keptZones =
    maxZonesPerTf > 0 ? effectiveValidZones.slice(-maxZonesPerTf) : effectiveValidZones;
  rejections.byMaxZonesCap = Math.max(0, effectiveValidZones.length - keptZones.length);

  if (rejections.byMaxZonesCap > 0) {
    const keptOpenTimes = new Set<string>(
      keptZones.flatMap((z) => z.mergedOpenTimes ?? [z.openTime])
    );
    for (const z of validZones) {
      if (!keptOpenTimes.has(z.openTime)) {
        const dbg = debugItemByOpenTime.get(z.openTime);
        if (dbg) {
          dbg.status = 'hidden-by-cap';
        }
      }
    }
  }

  return {
    zones: keptZones,
    stats: {
      timeframe,
      barsCount,
      requestedBars: 1000,
      dojisCount,
      validCount: keptZones.length,
      totalUncappedValidCount: effectiveValidZones.length,
      redOnlyDojisCount,
      redOnlyValidCount:
        maxZonesPerTf > 0
          ? Math.min(maxZonesPerTf, redOnlyUncappedValidCount)
          : redOnlyUncappedValidCount,
      redOnlyUncappedValidCount,
      atr: latestAtr,
      rejections,
      flaggedOpenTimeSecs,
      last10FlaggedDubaiTimes: flaggedDubaiTimes.slice(-10),
      last15FlaggedDojis: flaggedDebugItems.slice(-15),
      maxZonesPerTf,
      maxDistanceAtr,
      zoneLifetime,
      zoneMerge,
      mergedDojisCount,
    },
  };
}

export function extractValidDojiZones(
  bars: RawBar[],
  timeframe: DojiTimeframe,
  currentPrice: number,
  redOnly: boolean = true,
  consumedOpenTimes?: Set<string>,
  mode: DojiMode = 'indicator',
  bodyPct: number = mode === 'loose' ? 0.10 : 0.20,
  wickDiffPct: number = 0.15,
  minRangeAtr: number = mode === 'strict' ? 0.5 : 0.2,
  maxZonesPerTf: number = 50,
  maxDistanceAtr: number = 0,
  zoneLifetime: DojiZoneLifetime = 'untilBroken',
  zoneMerge: boolean = true
): DojiZone[] {
  return extractValidDojiZonesWithStats(
    bars,
    timeframe,
    currentPrice,
    redOnly,
    consumedOpenTimes,
    mode,
    bodyPct,
    wickDiffPct,
    minRangeAtr,
    maxZonesPerTf,
    maxDistanceAtr,
    zoneLifetime,
    zoneMerge
  ).zones;
}

/**
 * Find the nearest valid zone to currentPrice among ALL valid zones (used and unused combined)
 */
export function getNearestValidZone(
  zones: DojiZone[],
  timeframe?: DojiTimeframe,
  currentPrice?: number
): DojiZone | null {
  if (!zones || zones.length === 0) return null;
  const pool = timeframe ? zones.filter((z) => z.timeframe === timeframe) : zones;
  const candidates = pool.length > 0 ? pool : zones;
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    if (typeof currentPrice === 'number' && currentPrice > 0) {
      const distA =
        currentPrice >= a.low && currentPrice <= a.high
          ? 0
          : Math.min(Math.abs(currentPrice - a.high), Math.abs(currentPrice - a.low));
      const distB =
        currentPrice >= b.low && currentPrice <= b.high
          ? 0
          : Math.min(Math.abs(currentPrice - b.high), Math.abs(currentPrice - b.low));
      if (distA !== distB) return distA - distB;
    }
    return Math.abs(a.distancePts) - Math.abs(b.distancePts);
  });

  return sorted[0] || null;
}

/**
 * Calculate real risk:reward string (e.g. "1:2.4") from entry price, stop loss, and a TP level.
 */
export function calculateRealRiskReward(
  entryPrice: number,
  stopLoss: number,
  tpPrice: number
): string {
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(tpPrice - entryPrice);
  if (risk <= 0 || reward <= 0) {
    return '—';
  }
  return `1:${(reward / risk).toFixed(1)}`;
}

/**
 * Compute active signal setup for the selected timeframe:
 * - Only issues an ACTIVE trade setup when a doji zone from the indicator is broken and then retested
 *   (and meets the minimum zone strength to trade, default 7).
 * - Calculates real risk from entry to stop loss based on zone high/low plus an ATR-based buffer (default 0.25 * ATR).
 * - Calculates real risk:reward from the TP levels.
 */
export function computeActiveSignal(
  currentPrice: number,
  timeframe: DojiTimeframe,
  zones: DojiZone[],
  atr: number = 3.5,
  slAtrMultiplier: number = 0.25,
  minZoneStrength: number = 5,
  activeTrade?: {
    side: 'BUY' | 'SELL';
    entryPrice: number;
    initialSl: number;
    currentSl?: number;
    risk?: number;
    tp1: number;
    tp2: number;
    tp3: number;
    tp1Rr?: string;
    tp2Rr?: string;
    tp3Rr?: string;
    riskReward?: string;
    zoneId?: string;
    zoneOpenTime?: string;
    zoneStrength?: number;
    entryTimeDisplay?: string;
    status?: 'OPEN' | 'CLOSED';
  } | null,
  tp1R: number = 1.0,
  tp2R: number = 2.0,
  tp3R: number = 3.0
): ActiveDojiSignal {
  const nowDubaiStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

  const tfZones = zones.filter((z) => z.timeframe === timeframe);

  // If activeTrade is explicitly passed (from simulateTradesForTimeframe), only issue setup if an OPEN retest trade exists and meets minZoneStrength.
  // If activeTrade is undefined (standalone call), look for a zone on the timeframe that is broken AND retested (hasSignalFormed / isUsed) and meets minZoneStrength.
  const openTradeValid =
    activeTrade &&
    activeTrade.status === 'OPEN' &&
    (typeof activeTrade.zoneStrength !== 'number' || activeTrade.zoneStrength >= minZoneStrength)
      ? activeTrade
      : null;

  const retestedZones = tfZones.filter(
    (z) =>
      z.isBroken &&
      z.breakDirection !== null &&
      (z.hasSignalFormed || z.isUsed || z.zoneState === 'used') &&
      z.strength >= minZoneStrength
  );

  const matchedZone = openTradeValid
    ? tfZones.find(
        (z) =>
          (openTradeValid.zoneOpenTime && z.openTime === openTradeValid.zoneOpenTime) ||
          (openTradeValid.zoneId && z.id === openTradeValid.zoneId)
      ) ||
      retestedZones[retestedZones.length - 1] ||
      null
    : activeTrade === undefined
    ? retestedZones[retestedZones.length - 1] || null
    : null;

  if (!openTradeValid && !matchedZone) {
    const nearest = getNearestValidZone(zones, timeframe, currentPrice);
    const isBuyLean = nearest ? nearest.breakDirection === 'UP' : true;
    return {
      status: nearest ? 'WATCHING' : 'WAITING FOR DOJI CLOSE',
      direction: isBuyLean ? 'BUY' : 'SELL',
      timeframe,
      targetZone: nearest
        ? `${nearest.low.toFixed(2)} – ${nearest.high.toFixed(2)}`
        : `Scanning ${timeframe} zones`,
      entryPrice: 0,
      stopLoss: 0,
      risk: 0,
      tp1: 0,
      tp2: 0,
      tp3: 0,
      tp1Rr: '—',
      tp2Rr: '—',
      tp3Rr: '—',
      distanceToZone: nearest ? formatSignedDollar(nearest.distancePts) : '—',
      riskReward: '—',
      confidenceScore: nearest ? Math.round(nearest.strength * 10) : 0,
      issuedTime: nearest ? nearest.barTime : `${nowDubaiStr} Dubai`,
    };
  }

  const safeAtr = typeof atr === 'number' && atr > 0 ? atr : 3.5;
  const slBuffer = slAtrMultiplier * safeAtr;

  const isBuy = openTradeValid
    ? openTradeValid.side === 'BUY'
    : matchedZone!.breakDirection === 'UP';

  const entryPrice = openTradeValid
    ? Number(openTradeValid.entryPrice.toFixed(2))
    : Number((isBuy ? matchedZone!.high : matchedZone!.low).toFixed(2));

  // Stop loss based on zone high/low plus ATR-based buffer (default 0.25 * ATR)
  const zoneBasedSl = matchedZone
    ? Number((isBuy ? matchedZone.low - slBuffer : matchedZone.high + slBuffer).toFixed(2))
    : Number(openTradeValid!.initialSl.toFixed(2));

  const stopLoss = openTradeValid
    ? Number(openTradeValid.initialSl.toFixed(2))
    : zoneBasedSl;

  // Real risk from entry to stop loss
  const risk = Number(Math.abs(entryPrice - stopLoss).toFixed(2));

  // Skip any setup whose risk is larger than 2.5 * ATR
  const maxAllowedRisk = 2.5 * safeAtr;
  if (risk > maxAllowedRisk && !openTradeValid) {
    const nearest = getNearestValidZone(zones, timeframe, currentPrice);
    const isBuyLean = nearest ? nearest.breakDirection === 'UP' : true;
    return {
      status: nearest ? 'WATCHING' : 'WAITING FOR DOJI CLOSE',
      direction: isBuyLean ? 'BUY' : 'SELL',
      timeframe,
      targetZone: nearest
        ? `${nearest.low.toFixed(2)} – ${nearest.high.toFixed(2)}`
        : `Scanning ${timeframe} zones`,
      entryPrice: 0,
      stopLoss: 0,
      risk: 0,
      tp1: 0,
      tp2: 0,
      tp3: 0,
      tp1Rr: '—',
      tp2Rr: '—',
      tp3Rr: '—',
      distanceToZone: nearest ? formatSignedDollar(nearest.distancePts) : '—',
      riskReward: '—',
      confidenceScore: nearest ? Math.round(nearest.strength * 10) : 0,
      issuedTime: nearest ? nearest.barTime : `${nowDubaiStr} Dubai`,
    };
  }

  const tp1 = openTradeValid
    ? Number(openTradeValid.tp1.toFixed(2))
    : Number((isBuy ? entryPrice + tp1R * risk : entryPrice - tp1R * risk).toFixed(2));
  const tp2 = openTradeValid
    ? Number(openTradeValid.tp2.toFixed(2))
    : Number((isBuy ? entryPrice + tp2R * risk : entryPrice - tp2R * risk).toFixed(2));
  const tp3 = openTradeValid
    ? Number(openTradeValid.tp3.toFixed(2))
    : Number((isBuy ? entryPrice + tp3R * risk : entryPrice - tp3R * risk).toFixed(2));

  const tp1Rr = calculateRealRiskReward(entryPrice, stopLoss, tp1);
  const tp2Rr = calculateRealRiskReward(entryPrice, stopLoss, tp2);
  const tp3Rr = calculateRealRiskReward(entryPrice, stopLoss, tp3);
  const riskReward = tp3Rr;

  const distancePts = Math.abs(currentPrice - entryPrice).toFixed(1);
  const zoneStrength = openTradeValid?.zoneStrength ?? matchedZone?.strength ?? 0;
  const confidence = Math.round(zoneStrength * 10);

  return {
    status: 'ACTIVE',
    direction: isBuy ? 'BUY' : 'SELL',
    timeframe,
    targetZone: matchedZone
      ? `${matchedZone.breakDirection === 'UP' ? '▲ Breakout' : '▼ Breakdown'} (${matchedZone.low.toFixed(2)} – ${matchedZone.high.toFixed(2)})`
      : `${isBuy ? '▲ Breakout' : '▼ Breakdown'}`,
    entryPrice,
    stopLoss,
    risk,
    tp1,
    tp2,
    tp3,
    tp1Rr,
    tp2Rr,
    tp3Rr,
    distanceToZone: `${distancePts} pts`,
    riskReward,
    confidenceScore: confidence,
    issuedTime: openTradeValid?.entryTimeDisplay || matchedZone?.barTime || `${nowDubaiStr} Dubai`,
  };
}
