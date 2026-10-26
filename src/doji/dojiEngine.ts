// src/doji/dojiEngine.ts

export type DojiTimeframe = '15m' | '30m' | '1h' | '4h';
export type DojiZoneState = 'waiting' | 'armed' | 'used';

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
  isWithin5Atr?: boolean;
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
}

export interface ActiveDojiSignal {
  status: 'ACTIVE' | 'WATCHING' | 'WAITING FOR DOJI CLOSE';
  direction: 'BUY' | 'SELL';
  timeframe: DojiTimeframe;
  targetZone: string;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
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

/**
 * Deduplicate bars chronologically by openTime
 */
export function deduplicateBars(bars: RawBar[]): RawBar[] {
  const seen = new Set<string>();
  const out: RawBar[] = [];
  for (const b of bars) {
    if (!b || !b.openTime) continue;
    if (!seen.has(b.openTime)) {
      seen.add(b.openTime);
      out.push(b);
    }
  }
  return out;
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
 * - Red candle (if redOnly is true): close <= open
 * - body <= 20% of range
 * - upper and lower wick diff <= 15% of range
 * - range >= 0.5 * ATR(14)
 */
export function checkIsDoji(
  bar: RawBar,
  atr: number,
  redOnly: boolean
): {
  isDoji: boolean;
  body: number;
  range: number;
  upperWick: number;
  lowerWick: number;
  wickDiff: number;
  isRed: boolean;
} {
  const range = bar.high - bar.low;
  const isRed = bar.close <= bar.open;

  if (range <= 0.3) {
    return { isDoji: false, body: 0, range, upperWick: 0, lowerWick: 0, wickDiff: 0, isRed };
  }

  if (redOnly && !isRed) {
    return { isDoji: false, body: 0, range, upperWick: 0, lowerWick: 0, wickDiff: 0, isRed };
  }

  const body = Math.abs(bar.close - bar.open);
  const upperWick = bar.high - Math.max(bar.open, bar.close);
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;
  const wickDiff = Math.abs(upperWick - lowerWick);

  const cond1 = body <= 0.20 * range;
  const cond2 = wickDiff <= 0.15 * range;
  const cond3 = range >= 0.5 * atr;

  return {
    isDoji: cond1 && cond2 && cond3,
    body,
    range,
    upperWick,
    lowerWick,
    wickDiff,
    isRed,
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
  const { high, low, range, body, wickDiff, barIndex, isBroken, breakDirection } = zone;

  // 1. Shape (max 3): 1.5*(1 - body/(range*0.20)) + 1.5*(1 - wickDiff/(range*0.15)), each part >= 0
  const shapePart1 = Math.max(0, 1.5 * (1 - body / (range * 0.20)));
  const shapePart2 = Math.max(0, 1.5 * (1 - wickDiff / (range * 0.15)));
  const shapeScore = clamp(shapePart1 + shapePart2, 0, 3);

  // 2. Cost (max 2): risk = (high - low) + 2.5; 2 * clamp((25 - risk)/17, 0, 1)
  const risk = high - low + 2.5;
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

  const rawStrength = shapeScore + costScore + trendScore + stageScore + freshnessScore + closenessScore;
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
 * Extract valid Doji zones and diagnostic stats for a specific timeframe from all loaded bars:
 * - Red candle only (when redOnly is true) or all candles (when redOnly is false)
 * - body <= 20% range, wickDiff <= 15% range, range >= 0.5 ATR(14)
 * - Zone remains valid until broken (closes on one side then closes on the other side) or price moves > 8 ATR away
 * - Trade execution does NOT remove the zone from the chart; it marks the zone as "used" (isUsed: true)
 * - Max 5 valid zones per timeframe (keep 5 newest, combining used and unused)
 */
export function extractValidDojiZonesWithStats(
  bars: RawBar[],
  timeframe: DojiTimeframe,
  currentPrice: number,
  redOnly: boolean,
  consumedOpenTimes?: Set<string>
): {
  zones: DojiZone[];
  stats: DojiTimeframeStats;
} {
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
      },
    };
  }

  const latestAtr = computeAtr14(closedBars);
  const rollingAtrs = closedBars.map((_, idx) =>
    computeAtr14(closedBars.slice(0, Math.max(2, idx + 1)))
  );
  const peakAtr = Math.max(latestAtr, ...rollingAtrs);

  const emaList = computeEma(closedBars, 9);
  const currentEma9 = emaList.length > 0 ? emaList[emaList.length - 1].value : currentPrice;

  const validZones: DojiZone[] = [];
  const totalClosed = closedBars.length;
  let dojisCount = 0;
  let redOnlyDojisCount = 0;
  let redOnlyUncappedValidCount = 0;

  for (let i = 0; i < totalClosed; i++) {
    const bar = closedBars[i];
    const atrAtBar = rollingAtrs[i] || latestAtr;
    const effectiveAtrForDoji = Math.min(latestAtr, atrAtBar);

    const checkRed = checkIsDoji(bar, effectiveAtrForDoji, true);
    if (checkRed.isDoji) {
      redOnlyDojisCount += 1;
    }

    const check = checkIsDoji(bar, effectiveAtrForDoji, redOnly);
    if (!check.isDoji) continue;

    dojisCount += 1;

    const high = Number(bar.high.toFixed(2));
    const low = Number(bar.low.toFixed(2));
    const mid = Number(((high + low) / 2).toFixed(2));

    // Invalidation check 1: Distance > 8 ATR
    const distFromLevel =
      currentPrice >= low && currentPrice <= high
        ? 0
        : Math.min(Math.abs(currentPrice - high), Math.abs(currentPrice - low));
    if (distFromLevel > 8 * peakAtr) {
      continue;
    }

    // Follow subsequent closed bars to track break & cancellation (close on one side then close on the other side)
    let isBroken = false;
    let breakDirection: 'UP' | 'DOWN' | null = null;
    let breakBarIndex: number | null = null;
    let breakTime: string | null = null;
    let breakTimeDisplay: string | null = null;
    let isCancelled = false;

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
        if (breakDirection === 'UP' && nextBar.close < low) {
          isCancelled = true;
          break;
        }
        if (breakDirection === 'DOWN' && nextBar.close > high) {
          isCancelled = true;
          break;
        }
      }
    }

    if (isCancelled) continue;

    if (checkRed.isDoji) {
      redOnlyUncappedValidCount += 1;
    }

    const isUsed = consumedOpenTimes ? consumedOpenTimes.has(bar.openTime) : false;
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
      },
      currentPrice,
      currentEma9,
      latestAtr,
      totalClosed
    );

    const openTimeSec = Math.floor(new Date(bar.openTime).getTime() / 1000) + 4 * 3600;
    const barTime = formatDubaiShortTime(bar.openTime);
    const distPts = Number((mid - currentPrice).toFixed(2));
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
      isWithin5Atr,
    });
  }

  const keptZones = validZones.slice(-5);

  return {
    zones: keptZones,
    stats: {
      timeframe,
      barsCount,
      requestedBars: 1000,
      dojisCount,
      validCount: keptZones.length,
      totalUncappedValidCount: validZones.length,
      redOnlyDojisCount,
      redOnlyValidCount: Math.min(5, redOnlyUncappedValidCount),
      redOnlyUncappedValidCount,
      atr: latestAtr,
    },
  };
}

export function extractValidDojiZones(
  bars: RawBar[],
  timeframe: DojiTimeframe,
  currentPrice: number,
  redOnly: boolean,
  consumedOpenTimes?: Set<string>
): DojiZone[] {
  return extractValidDojiZonesWithStats(
    bars,
    timeframe,
    currentPrice,
    redOnly,
    consumedOpenTimes
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
 * Compute active signal based on current price and nearest valid Doji zone
 */
export function computeActiveSignal(
  currentPrice: number,
  timeframe: DojiTimeframe,
  zones: DojiZone[]
): ActiveDojiSignal {
  const target = getNearestValidZone(zones, timeframe, currentPrice);

  const nowDubaiStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

  if (!target) {
    return {
      status: 'WATCHING',
      direction: 'BUY',
      timeframe,
      targetZone: `Scanning ${timeframe} zones`,
      entryPrice: Number((currentPrice - 2.0).toFixed(2)),
      stopLoss: Number((currentPrice - 7.0).toFixed(2)),
      tp1: Number((currentPrice + 4.5).toFixed(2)),
      tp2: Number((currentPrice + 9.0).toFixed(2)),
      tp3: Number((currentPrice + 15.0).toFixed(2)),
      distanceToZone: '0.0 pts',
      riskReward: '1:3.0',
      confidenceScore: 80,
      issuedTime: `${nowDubaiStr} Dubai`,
    };
  }

  const isBuy = target.breakDirection === 'UP' || currentPrice >= target.high;
  const entryPrice = isBuy ? target.high : target.low;
  const slOffset = 3.5;
  const stopLoss = isBuy
    ? Number((target.low - slOffset).toFixed(2))
    : Number((target.high + slOffset).toFixed(2));

  const risk = Math.max(Math.abs(entryPrice - stopLoss), 2.5);
  const tp1 = isBuy ? Number((entryPrice + risk * 1.5).toFixed(2)) : Number((entryPrice - risk * 1.5).toFixed(2));
  const tp2 = isBuy ? Number((entryPrice + risk * 2.5).toFixed(2)) : Number((entryPrice - risk * 2.5).toFixed(2));
  const tp3 = isBuy ? Number((entryPrice + risk * 4.0).toFixed(2)) : Number((entryPrice - risk * 4.0).toFixed(2));

  const distancePts = Math.abs(currentPrice - entryPrice).toFixed(1);
  const confidence = Math.round(target.strength * 10);

  return {
    status: target.isBroken ? 'ACTIVE' : 'WATCHING',
    direction: isBuy ? 'BUY' : 'SELL',
    timeframe,
    targetZone: `${target.breakDirection === 'UP' ? '▲ Breakout' : target.breakDirection === 'DOWN' ? '▼ Breakdown' : 'Zone'} (${target.low.toFixed(1)} - ${target.high.toFixed(1)})`,
    entryPrice,
    stopLoss,
    tp1,
    tp2,
    tp3,
    distanceToZone: `${distancePts} pts`,
    riskReward: '1:3.2',
    confidenceScore: confidence,
    issuedTime: `${nowDubaiStr} Dubai`,
  };
}
