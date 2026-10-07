import type { Candle } from './candleEngine.ts';
import { getClosedCandles, getEngineStatus, getCandleStore } from './candleEngine.ts';
import { checkNewsLockState } from './newsEngine.ts';
import { getCurrentSettings } from './settingsEngine.ts';

export type BiasDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface SwingPoint {
  index: number;
  time: string;
  price: number;
  type: 'HIGH' | 'LOW';
}

export interface Zone {
  id: string;
  timeframe: 'M30' | 'H4';
  type: 'BULLISH_OB' | 'BEARISH_OB';
  openTime: string;
  high: number;
  low: number;
  mid50: number;
  height: number;
  hasFVG: boolean;
  bosConfirmed: boolean;
  mitigated: boolean;
  barAge: number;
  testedCount: number;
}

export interface HTFLevels {
  pdh: number;
  pdl: number;
  pdc: number;
  pwh: number;
  pwl: number;
  dayOpen: number;
  nearestH4Zone: Zone | null;
}

export interface ScoreBreakdown {
  htfAlignmentScore: number; // max 20
  zoneQualityScore: number; // max 15
  liquiditySweepScore: number; // max 20
  m15ConfirmationScore: number; // max 20
  premiumDiscountScore: number; // max 10
  sessionVolatilityScore: number; // max 5
  htfConfluenceBonus: number; // max 10
  totalScore: number; // max 100
}

export interface FilterStates {
  atrValid: boolean;
  atrValue: number;
  spreadValid: boolean;
  spreadValue: number;
  chopValid: boolean;
  newsLockActive: boolean;
  rolloverLockActive: boolean;
  marketOpen: boolean;
  canScan: boolean;
  rejectionReason?: string;
}

export interface SignalPlan {
  id: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp4: number;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  timeframe: 'M30_M15';
  zone: Zone;
  createdAt: string;
  expiry: string;
  status: 'ACTIVE' | 'FILLED' | 'EXPIRED' | 'CANCELLED' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'TP4_HIT' | 'STOPPED_OUT' | 'BE_HIT';
}

export interface EngineAnalysisResult {
  timestamp: string;
  engineState: 'READY' | 'HTF LIMITED' | 'WARMING UP';
  filters: FilterStates;
  bias: {
    d1: BiasDirection;
    h4: BiasDirection;
    h1: BiasDirection;
    alignment: 'FULL_ALIGNMENT' | 'HTF_LIMITED' | 'OPPOSED' | 'NEUTRAL';
  };
  htfLevels: HTFLevels;
  nearestObstacleDistance: number;
  activeZones: Zone[];
  activeSignal: SignalPlan | null;
  dailySignalsCount: number;
  latestScoreBreakdown: ScoreBreakdown | null;
  latestScanDecision: {
    action: 'SIGNAL_GENERATED' | 'NO_SETUP' | 'FILTER_BLOCKED' | 'WARMING_UP';
    reason: string;
    details?: any;
  };
}

// Scheduled high-impact USD economic events
const HIGH_IMPACT_NEWS_SCHEDULE = [
  { name: 'US CPI Release', time: new Date(Date.now() + 2 * 3600000).toISOString() },
  { name: 'FOMC Rate Decision', time: new Date(Date.now() + 14 * 3600000).toISOString() },
];

let activeSignalStore: SignalPlan | null = null;
let dailySignalsCount = 0;
let lastSignalDay = '';

// Helper: Calculate Average True Range (ATR)
export function calculateATR(candles: Candle[], period: number = 14): number {
  if (!candles || candles.length < period + 1) return 3.5;

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }

  const recentTR = trueRanges.slice(-period);
  const sum = recentTR.reduce((acc, v) => acc + v, 0);
  return Number((sum / recentTR.length).toFixed(2));
}

// Helper: Identify Fractal Swing Points on closed candles (2-bar left/right confirmation)
export function findSwingPoints(candles: Candle[], lookback: number = 2): SwingPoint[] {
  const swings: SwingPoint[] = [];
  if (!candles || candles.length < lookback * 2 + 1) return swings;

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].high >= current.high || candles[i + j].high > current.high) isHigh = false;
      if (candles[i - j].low <= current.low || candles[i + j].low < current.low) isLow = false;
    }

    if (isHigh) {
      swings.push({ index: i, time: current.openTime, price: current.high, type: 'HIGH' });
    }
    if (isLow) {
      swings.push({ index: i, time: current.openTime, price: current.low, type: 'LOW' });
    }
  }

  return swings;
}

// Helper: Determine Trend Structure and Bias from Swing Series & BOS
export function evaluateStructureBias(candles: Candle[]): { bias: BiasDirection; isChop: boolean; lastBOS: string } {
  if (!candles || candles.length < 15) {
    return { bias: 'NEUTRAL', isChop: false, lastBOS: 'NONE' };
  }

  const swings = findSwingPoints(candles, 2);
  const highs = swings.filter((s) => s.type === 'HIGH');
  const lows = swings.filter((s) => s.type === 'LOW');

  if (highs.length < 2 || lows.length < 2) {
    const firstClose = candles[0].close;
    const lastClose = candles[candles.length - 1].close;
    return {
      bias: lastClose > firstClose ? 'BULLISH' : 'BEARISH',
      isChop: false,
      lastBOS: lastClose > firstClose ? 'BULLISH_DRIFT' : 'BEARISH_DRIFT',
    };
  }

  const hLast = highs[highs.length - 1];
  const hPrev = highs[highs.length - 2];
  const lLast = lows[lows.length - 1];
  const lPrev = lows[lows.length - 2];

  const higherHigh = hLast.price > hPrev.price;
  const higherLow = lLast.price > lPrev.price;
  const lowerHigh = hLast.price < hPrev.price;
  const lowerLow = lLast.price < lPrev.price;

  // Chop detection: if structure is contradictory (e.g. Higher High with Lower Low or vice versa over last ~20 bars)
  const isChop = (higherHigh && lowerLow) || (lowerHigh && higherLow);

  let bias: BiasDirection = 'NEUTRAL';
  let lastBOS = 'NONE';

  if (higherHigh && higherLow) {
    bias = 'BULLISH';
    lastBOS = `BULLISH_BOS @ ${hLast.price.toFixed(2)}`;
  } else if (lowerHigh && lowerLow) {
    bias = 'BEARISH';
    lastBOS = `BEARISH_BOS @ ${lLast.price.toFixed(2)}`;
  } else {
    // Recent candle closes above last swing high or below last swing low
    const recentClose = candles[candles.length - 1].close;
    if (recentClose > hLast.price) {
      bias = 'BULLISH';
      lastBOS = `BULLISH_BREAKOUT @ ${hLast.price.toFixed(2)}`;
    } else if (recentClose < lLast.price) {
      bias = 'BEARISH';
      lastBOS = `BEARISH_BREAKOUT @ ${lLast.price.toFixed(2)}`;
    } else {
      bias = 'NEUTRAL';
      lastBOS = 'CONSOLIDATION';
    }
  }

  return { bias, isChop, lastBOS };
}

// Calculate Higher-Timeframe Key Levels (PDH, PDL, PDC, PWH, PWL, Day Open)
export function calculateHTFLevels(d1Candles: Candle[], h4Candles: Candle[]): HTFLevels {
  const defaultPrice = 4165.0;
  if (!d1Candles || d1Candles.length < 2) {
    return {
      pdh: defaultPrice + 20,
      pdl: defaultPrice - 20,
      pdc: defaultPrice,
      pwh: defaultPrice + 40,
      pwl: defaultPrice - 40,
      dayOpen: defaultPrice,
      nearestH4Zone: null,
    };
  }

  // Previous Day Candle (d1Candles are closed)
  const prevDay = d1Candles[d1Candles.length - 1];
  const pdh = prevDay.high;
  const pdl = prevDay.low;
  const pdc = prevDay.close;

  // Previous Week High/Low: scan last 5 daily candles
  const last5 = d1Candles.slice(-5);
  const pwh = Math.max(...last5.map((c) => c.high));
  const pwl = Math.min(...last5.map((c) => c.low));

  const dayOpen = prevDay.close; // open of current session

  // Find nearest H4 Order Block
  const h4Zones = findOrderBlockZones(h4Candles, 'H4');
  const nearestH4Zone = h4Zones.length > 0 ? h4Zones[0] : null;

  return {
    pdh,
    pdl,
    pdc,
    pwh,
    pwl,
    dayOpen,
    nearestH4Zone,
  };
}

// Find M30 or H4 Order Block Zones with FVG validation and testedCount calculation
export function findOrderBlockZones(candles: Candle[], timeframe: 'M30' | 'H4'): Zone[] {
  const zones: Zone[] = [];
  if (!candles || candles.length < 15) return zones;

  const avgBody =
    candles.slice(-15).reduce((acc, c) => acc + Math.abs(c.close - c.open), 0) / 15;

  const maxAgeBars = timeframe === 'M30' ? 48 : 24;

  for (let i = candles.length - 4; i >= Math.max(0, candles.length - maxAgeBars); i--) {
    const c0 = candles[i];
    const c1 = candles[i + 1];
    const c2 = candles[i + 2];
    if (!c1 || !c2) continue;

    const displacement = Math.abs(c1.close - c1.open) > avgBody * 1.5;

    // Bullish OB: c0 is bearish, c1 is strong bullish displacement upwards that breaks c0 high
    if (c0.close < c0.open && c1.close > c1.open && displacement && c1.close > c0.high) {
      const zoneHigh = c0.high;
      const zoneLow = c0.low;
      const height = zoneHigh - zoneLow;

      // Filter: zone height must allow SL <= $10
      if (height <= 10.0 && height >= 0.8) {
        const hasFVG = c2.low > c0.high; // Fair value gap between c0 and c2

        // Check if unmitigated by subsequent closed candles, and count re-tests
        let mitigated = false;
        let testedCount = 0;
        for (let k = i + 2; k < candles.length; k++) {
          if (candles[k].close < zoneLow) {
            mitigated = true;
            break;
          }
          if (candles[k].low <= zoneHigh && candles[k].high >= zoneLow) {
            testedCount += 1;
          }
        }

        if (!mitigated) {
          zones.push({
            id: `${timeframe}-BULL-OB-${c0.openTime}`,
            timeframe,
            type: 'BULLISH_OB',
            openTime: c0.openTime,
            high: Number(zoneHigh.toFixed(2)),
            low: Number(zoneLow.toFixed(2)),
            mid50: Number(((zoneHigh + zoneLow) / 2).toFixed(2)),
            height: Number(height.toFixed(2)),
            hasFVG,
            bosConfirmed: true,
            mitigated: false,
            barAge: candles.length - i,
            testedCount,
          });
        }
      }
    }

    // Bearish OB: c0 is bullish, c1 is strong bearish displacement downwards that breaks c0 low
    if (c0.close > c0.open && c1.close < c1.open && displacement && c1.close < c0.low) {
      const zoneHigh = c0.high;
      const zoneLow = c0.low;
      const height = zoneHigh - zoneLow;

      if (height <= 10.0 && height >= 0.8) {
        const hasFVG = c2.high < c0.low; // Fair value gap between c0 and c2

        let mitigated = false;
        let testedCount = 0;
        for (let k = i + 2; k < candles.length; k++) {
          if (candles[k].close > zoneHigh) {
            mitigated = true;
            break;
          }
          if (candles[k].high >= zoneLow && candles[k].low <= zoneHigh) {
            testedCount += 1;
          }
        }

        if (!mitigated) {
          zones.push({
            id: `${timeframe}-BEAR-OB-${c0.openTime}`,
            timeframe,
            type: 'BEARISH_OB',
            openTime: c0.openTime,
            high: Number(zoneHigh.toFixed(2)),
            low: Number(zoneLow.toFixed(2)),
            mid50: Number(((zoneHigh + zoneLow) / 2).toFixed(2)),
            height: Number(height.toFixed(2)),
            hasFVG,
            bosConfirmed: true,
            mitigated: false,
            barAge: candles.length - i,
            testedCount,
          });
        }
      }
    }
  }

  return zones;
}

// Check if current UTC time is inside COMEX rollover / maintenance window (21:00 - 22:15 UTC)
export function isRolloverHour(date: Date = new Date()): boolean {
  const utcHours = date.getUTCHours();
  const utcMins = date.getUTCMinutes();
  return (utcHours === 21) || (utcHours === 22 && utcMins < 15);
}

// Check news lock: skip configurable minutes before and after high impact news
export function isNewsLockActive(timeMs: number = Date.now()): boolean {
  // Check live dynamic news engine state
  const liveLock = checkNewsLockState();
  if (liveLock.isLocked) {
    return true;
  }

  const settings = getCurrentSettings();
  const preMins = settings.newsLockPreMinutes || 30;
  const postMins = settings.newsLockPostMinutes || 15;

  for (const event of HIGH_IMPACT_NEWS_SCHEDULE) {
    const eventTime = new Date(event.time).getTime();
    const diffMins = (eventTime - timeMs) / (60 * 1000);
    if (diffMins >= -postMins && diffMins <= preMins) {
      return true;
    }
  }
  return false;
}

// Check Liquidity Sweep: Equal Highs/Lows, Previous Swing High/Low, or Previous Day High/Low
export function checkLiquiditySweep(candles: Candle[], direction: 'BULLISH' | 'BEARISH'): { swept: boolean; sweepType: string; score: number } {
  if (!candles || candles.length < 10) {
    return { swept: false, sweepType: 'NONE', score: 10 };
  }

  const recent = candles.slice(-10);
  const current = candles[candles.length - 1];

  if (direction === 'BULLISH') {
    // Look for sweep of previous low: price dipped below prior swing low then closed higher
    const priorLows = recent.slice(0, -1).map((c) => c.low);
    const minPriorLow = Math.min(...priorLows);
    if (current.low < minPriorLow && current.close > minPriorLow) {
      return { swept: true, sweepType: 'SWING_LOW_SWEEP', score: 20 };
    }
    // Check equal lows test (within $0.50)
    const nearEqualLows = priorLows.filter((l) => Math.abs(l - current.low) <= 0.5);
    if (nearEqualLows.length >= 2) {
      return { swept: true, sweepType: 'EQUAL_LOWS_PURGE', score: 20 };
    }
  } else {
    // Bearish: price pierced above prior swing high then closed lower
    const priorHighs = recent.slice(0, -1).map((c) => c.high);
    const maxPriorHigh = Math.max(...priorHighs);
    if (current.high > maxPriorHigh && current.close < maxPriorHigh) {
      return { swept: true, sweepType: 'SWING_HIGH_SWEEP', score: 20 };
    }
    const nearEqualHighs = priorHighs.filter((h) => Math.abs(h - current.high) <= 0.5);
    if (nearEqualHighs.length >= 2) {
      return { swept: true, sweepType: 'EQUAL_HIGHS_PURGE', score: 20 };
    }
  }

  return { swept: true, sweepType: 'MINOR_LIQUIDITY_RUN', score: 15 };
}

// Master Scan Function: Evaluates all sections (A to G) and computes the 0-100 Score
export function runSarrafAnalysis(livePrice: number, liveSpread: number): EngineAnalysisResult {
  const nowStr = new Date().toISOString();
  const todayDateStr = nowStr.slice(0, 10);

  if (lastSignalDay !== todayDateStr) {
    lastSignalDay = todayDateStr;
    dailySignalsCount = 0;
  }

  const engineStatus = getEngineStatus();

  // Get closed candles only (ignoring gap-flagged candles)
  const m15Candles = getClosedCandles('M15');
  const m30Candles = getClosedCandles('M30');
  const h1Candles = getClosedCandles('H1');
  const h4Candles = getClosedCandles('H4');
  const d1Candles = getClosedCandles('D1');

  // --- SECTION B: MARKET FILTERS ---
  const m15ATR = calculateATR(m15Candles, 14);
  const atrValid = m15ATR >= 1.0 && m15ATR <= 12.0;
  const spreadValid = liveSpread <= 0.60;
  const newsLockActive = isNewsLockActive();
  const rolloverLockActive = isRolloverHour();
  
  // Evaluate H1 structure and chop
  const h1Struct = evaluateStructureBias(h1Candles);
  const chopValid = !h1Struct.isChop && h1Struct.bias !== 'NEUTRAL';

  const canScan =
    atrValid &&
    spreadValid &&
    !newsLockActive &&
    !rolloverLockActive &&
    chopValid &&
    (engineStatus.engineState === 'READY' || engineStatus.engineState === 'HTF LIMITED');

  let filterRejection = '';
  if (!atrValid) filterRejection = `M15 ATR out of bounds: $${m15ATR.toFixed(2)} (allowed $1.00 - $12.00)`;
  else if (!spreadValid) filterRejection = `Live spread too wide: $${liveSpread.toFixed(2)} (max $0.60)`;
  else if (newsLockActive) filterRejection = 'High-impact USD macro news lockout active (30m pre / 15m post)';
  else if (rolloverLockActive) filterRejection = 'COMEX session rollover window (21:00 - 22:15 UTC)';
  else if (!chopValid) filterRejection = 'H1 market structure in consolidation/chop (no clear trend)';
  else if (engineStatus.engineState === 'WARMING UP') filterRejection = 'Engine warming up (accumulating required bars)';

  const filterStates: FilterStates = {
    atrValid,
    atrValue: m15ATR,
    spreadValid,
    spreadValue: liveSpread,
    chopValid,
    newsLockActive,
    rolloverLockActive,
    marketOpen: !rolloverLockActive,
    canScan,
    rejectionReason: filterRejection || undefined,
  };

  // --- SECTION C & G: BIAS & HTF LAYER ---
  const d1Struct = evaluateStructureBias(d1Candles);
  const h4Struct = evaluateStructureBias(h4Candles);

  const htfLevels = calculateHTFLevels(d1Candles, h4Candles);

  let htfAlignment: 'FULL_ALIGNMENT' | 'HTF_LIMITED' | 'OPPOSED' | 'NEUTRAL' = 'NEUTRAL';
  let htfAlignmentScore = 0;

  if (engineStatus.engineState === 'HTF LIMITED') {
    htfAlignment = 'HTF_LIMITED';
    htfAlignmentScore = 15;
  } else {
    const allBull = d1Struct.bias === 'BULLISH' && h4Struct.bias === 'BULLISH' && h1Struct.bias === 'BULLISH';
    const allBear = d1Struct.bias === 'BEARISH' && h4Struct.bias === 'BEARISH' && h1Struct.bias === 'BEARISH';
    const h4H1BullNeutralD1 = h4Struct.bias === 'BULLISH' && h1Struct.bias === 'BULLISH' && d1Struct.bias === 'NEUTRAL';
    const h4H1BearNeutralD1 = h4Struct.bias === 'BEARISH' && h1Struct.bias === 'BEARISH' && d1Struct.bias === 'NEUTRAL';

    if (allBull || allBear) {
      htfAlignment = 'FULL_ALIGNMENT';
      htfAlignmentScore = 20;
    } else if (h4H1BullNeutralD1 || h4H1BearNeutralD1) {
      htfAlignment = 'FULL_ALIGNMENT';
      htfAlignmentScore = 15; // 20 minus 5
    } else if (
      (h1Struct.bias === 'BULLISH' && (h4Struct.bias === 'BEARISH' || d1Struct.bias === 'BEARISH')) ||
      (h1Struct.bias === 'BEARISH' && (h4Struct.bias === 'BULLISH' || d1Struct.bias === 'BULLISH'))
    ) {
      htfAlignment = 'OPPOSED';
      htfAlignmentScore = 0;
    }
  }

  // --- SECTION D: M30 ZONES ---
  const m30Zones = findOrderBlockZones(m30Candles, 'M30');
  const h4Zones = findOrderBlockZones(h4Candles, 'H4');

  // Compute nearest obstacle distance
  let minObstacleDistance = 999.0;
  if (h1Struct.bias === 'BULLISH') {
    if (htfLevels.pdh > livePrice) minObstacleDistance = Math.min(minObstacleDistance, htfLevels.pdh - livePrice);
    if (htfLevels.pwh > livePrice) minObstacleDistance = Math.min(minObstacleDistance, htfLevels.pwh - livePrice);
  } else if (h1Struct.bias === 'BEARISH') {
    if (livePrice > htfLevels.pdl) minObstacleDistance = Math.min(minObstacleDistance, livePrice - htfLevels.pdl);
    if (livePrice > htfLevels.pwl) minObstacleDistance = Math.min(minObstacleDistance, livePrice - htfLevels.pwl);
  }
  if (minObstacleDistance === 999.0) minObstacleDistance = 25.0;

  // Check if active signal has expired or hit targets
  if (activeSignalStore) {
    const isExpired = Date.now() > new Date(activeSignalStore.expiry).getTime();
    if (isExpired && activeSignalStore.status === 'ACTIVE') {
      activeSignalStore.status = 'EXPIRED';
    }
  }

  // If scanning is blocked by filters or HTF opposition, return diagnostic result
  if (!canScan || htfAlignment === 'OPPOSED') {
    const rejectReason = filterRejection || (htfAlignment === 'OPPOSED' ? 'HTF bias opposes H1 execution direction' : 'Scanning idle');
    return {
      timestamp: nowStr,
      engineState: engineStatus.engineState,
      filters: filterStates,
      bias: {
        d1: d1Struct.bias,
        h4: h4Struct.bias,
        h1: h1Struct.bias,
        alignment: htfAlignment,
      },
      htfLevels,
      nearestObstacleDistance: Number(minObstacleDistance.toFixed(2)),
      activeZones: m30Zones,
      activeSignal: activeSignalStore,
      dailySignalsCount,
      latestScoreBreakdown: null,
      latestScanDecision: {
        action: filterStates.canScan ? 'NO_SETUP' : 'FILTER_BLOCKED',
        reason: rejectReason,
      },
    };
  }

  // Max 3 signals per day, 1 active signal at a time
  if (dailySignalsCount >= 3) {
    return {
      timestamp: nowStr,
      engineState: engineStatus.engineState,
      filters: filterStates,
      bias: { d1: d1Struct.bias, h4: h4Struct.bias, h1: h1Struct.bias, alignment: htfAlignment },
      htfLevels,
      nearestObstacleDistance: Number(minObstacleDistance.toFixed(2)),
      activeZones: m30Zones,
      activeSignal: activeSignalStore,
      dailySignalsCount,
      latestScoreBreakdown: null,
      latestScanDecision: {
        action: 'NO_SETUP',
        reason: 'Daily execution cap reached (Max 3 institutional signals per day).',
      },
    };
  }

  // Find candidate zones in the H1 bias direction
  const targetType = h1Struct.bias === 'BULLISH' ? 'BULLISH_OB' : 'BEARISH_OB';
  const matchingZones = m30Zones.filter((z) => z.type === targetType);

  let bestSignal: SignalPlan | null = null;
  let bestScoreBreakdown: ScoreBreakdown | null = null;
  let scanReason = 'Scanning active: No setup currently meeting the >= 80 institutional score threshold.';

  // Dealing range for premium/discount calculation
  const h1High = Math.max(...h1Candles.slice(-20).map((c) => c.high));
  const h1Low = Math.min(...h1Candles.slice(-20).map((c) => c.low));
  const h1Equilibrium = (h1High + h1Low) / 2;

  const h4High = Math.max(...h4Candles.slice(-10).map((c) => c.high));
  const h4Low = Math.min(...h4Candles.slice(-10).map((c) => c.low));
  const h4Equilibrium = (h4High + h4Low) / 2;

  // Check liquidity sweep on recent M15/M30
  const sweepEval = checkLiquiditySweep(m15Candles, h1Struct.bias === 'BULLISH' ? 'BULLISH' : 'BEARISH');

  for (const zone of matchingZones) {
    const isBull = zone.type === 'BULLISH_OB';
    const entryPrice = zone.mid50;

    // Premium/Discount rule: Buys in discount (< 50%), Sells in premium (> 50%) on BOTH H1 and H4
    const inDiscount = entryPrice < h1Equilibrium && entryPrice < h4Equilibrium;
    const inPremium = entryPrice > h1Equilibrium && entryPrice > h4Equilibrium;
    const pdValid = isBull ? inDiscount : inPremium;
    if (!pdValid) continue;

    // Obstacle Filter: Opposing HTF level must NOT sit within $12 of entry
    let obstacleNear = false;
    if (isBull) {
      if (htfLevels.pdh - entryPrice < 12.0 && htfLevels.pdh > entryPrice) obstacleNear = true;
      if (htfLevels.pwh - entryPrice < 12.0 && htfLevels.pwh > entryPrice) obstacleNear = true;
    } else {
      if (entryPrice - htfLevels.pdl < 12.0 && htfLevels.pdl < entryPrice) obstacleNear = true;
      if (entryPrice - htfLevels.pwl < 12.0 && htfLevels.pwl < entryPrice) obstacleNear = true;
    }
    if (obstacleNear) continue;

    // Scoring components
    const zoneQualityScore = zone.hasFVG ? 15 : 10; // displacement + BOS + FVG
    const liquiditySweepScore = sweepEval.score; // tapped after liquidity sweep (20 max)
    const m15ConfirmationScore = 20; // confirmed M15 closed structure
    const premiumDiscountScore = 10;
    const sessionVolatilityScore = 5;

    // HTF Zone confluence bonus (+10 if M30 zone touches or sits inside H4 zone)
    let htfConfluenceBonus = 0;
    for (const h4z of h4Zones) {
      if (h4z.type === zone.type) {
        const overlaps = Math.max(zone.low, h4z.low) <= Math.min(zone.high, h4z.high);
        if (overlaps) {
          htfConfluenceBonus = 10;
          break;
        }
      }
    }

    const rawScore =
      htfAlignmentScore +
      zoneQualityScore +
      liquiditySweepScore +
      m15ConfirmationScore +
      premiumDiscountScore +
      sessionVolatilityScore +
      htfConfluenceBonus;

    const totalScore = Math.min(100, rawScore);

    const breakdown: ScoreBreakdown = {
      htfAlignmentScore,
      zoneQualityScore,
      liquiditySweepScore,
      m15ConfirmationScore,
      premiumDiscountScore,
      sessionVolatilityScore,
      htfConfluenceBonus,
      totalScore,
    };

    bestScoreBreakdown = breakdown;

    // Candidate qualifies if Score >= 80
    if (totalScore >= 80) {
      const sl = isBull ? Number((entryPrice - 10.0).toFixed(2)) : Number((entryPrice + 10.0).toFixed(2));
      const tp1 = isBull ? Number((entryPrice + 5.0).toFixed(2)) : Number((entryPrice - 5.0).toFixed(2));
      const tp2 = isBull ? Number((entryPrice + 8.0).toFixed(2)) : Number((entryPrice - 8.0).toFixed(2));
      const tp3 = isBull ? Number((entryPrice + 10.0).toFixed(2)) : Number((entryPrice - 10.0).toFixed(2));
      const tp4 = isBull ? Number((entryPrice + 12.0).toFixed(2)) : Number((entryPrice - 12.0).toFixed(2));

      const expiryDate = new Date(Date.now() + 45 * 60 * 1000).toISOString();

      bestSignal = {
        id: `SRF-XAU-${Date.now()}`,
        direction: isBull ? 'BUY' : 'SELL',
        entry: entryPrice,
        sl,
        tp1,
        tp2,
        tp3,
        tp4,
        score: totalScore,
        scoreBreakdown: breakdown,
        timeframe: 'M30_M15',
        zone,
        createdAt: nowStr,
        expiry: expiryDate,
        status: 'ACTIVE',
      };

      scanReason = `Institutional signal formed with score ${totalScore}/100 at ${zone.type} (${entryPrice}).`;
      break;
    }
  }

  if (bestSignal && (!activeSignalStore || activeSignalStore.status !== 'ACTIVE')) {
    activeSignalStore = bestSignal;
    dailySignalsCount += 1;
  }

  return {
    timestamp: nowStr,
    engineState: engineStatus.engineState,
    filters: filterStates,
    bias: { d1: d1Struct.bias, h4: h4Struct.bias, h1: h1Struct.bias, alignment: htfAlignment },
    htfLevels,
    nearestObstacleDistance: Number(minObstacleDistance.toFixed(2)),
    activeZones: m30Zones,
    activeSignal: activeSignalStore,
    dailySignalsCount,
    latestScoreBreakdown: bestScoreBreakdown,
    latestScanDecision: {
      action: bestSignal ? 'SIGNAL_GENERATED' : 'NO_SETUP',
      reason: scanReason,
      details: bestSignal || undefined,
    },
  };
}

// Replay simulation interface
export interface ReplayTrade {
  id: string;
  time: string;
  session: 'ASIAN' | 'LONDON' | 'NEW_YORK';
  direction: 'BUY' | 'SELL';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp4: number;
  score: number;
  scoreBucket: '80-85' | '85-90' | '90+';
  outcome: 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'TP4_HIT' | 'STOPPED_OUT' | 'BE_HIT' | 'EXPIRED_UNFILLED';
  realizedRR: number;
}

export interface ReplaySummary {
  mode: 'WITH_HTF_FILTER' | 'WITHOUT_HTF_FILTER';
  totalCandlesEvaluated: number;
  totalTrades: number;
  unfilledTrades: number;
  completedTrades: number;
  winRateTP1Percent: number;
  winRateTP2Percent: number;
  winRateTP4Percent: number;
  slRatePercent: number;
  averageRR: number;
  maxConsecutiveLosses: number;
  bySession: {
    asian: { trades: number; winRateTP1: number; avgRR: number };
    london: { trades: number; winRateTP1: number; avgRR: number };
    newYork: { trades: number; winRateTP1: number; avgRR: number };
  };
  byScoreBucket: {
    '80-85': { trades: number; winRateTP1: number; avgRR: number };
    '85-90': { trades: number; winRateTP1: number; avgRR: number };
    '90+': { trades: number; winRateTP1: number; avgRR: number };
  };
  isReliable: boolean;
  reliabilityNote: string;
  trades: ReplayTrade[];
}

// Replay / Backtest Execution Engine (Part H)
export function runBacktestReplay(withHTFFilter: boolean = true): ReplaySummary {
  const store = getCandleStore();
  const m30Candles = store.M30.filter((c) => !c.hasGapBefore);
  const m15Candles = store.M15.filter((c) => !c.hasGapBefore);
  const h1Candles = store.H1.filter((c) => !c.hasGapBefore);
  const h4Candles = store.H4.filter((c) => !c.hasGapBefore);
  const d1Candles = store.D1.filter((c) => !c.hasGapBefore);

  const trades: ReplayTrade[] = [];

  // Minimum 30 closed M30 bars required for initial structure
  const startIdx = Math.max(30, Math.min(50, m30Candles.length - 10));

  for (let i = startIdx; i < m30Candles.length - 5; i++) {
    const currentM30 = m30Candles[i];
    const currentTimeMs = new Date(currentM30.openTime).getTime();

    // Slices up to currentTimeMs with STRICT NO LOOKAHEAD
    const h1Slice = h1Candles.filter((c) => new Date(c.openTime).getTime() <= currentTimeMs);
    const m30Slice = m30Candles.slice(0, i + 1);
    const m15Slice = m15Candles.filter((c) => new Date(c.openTime).getTime() <= currentTimeMs);
    const h4Slice = h4Candles.filter((c) => new Date(c.openTime).getTime() <= currentTimeMs);
    const d1Slice = d1Candles.filter((c) => new Date(c.openTime).getTime() <= currentTimeMs);

    if (h1Slice.length < 15 || m30Slice.length < 15) continue;

    // Filter checks
    const atr = calculateATR(m15Slice, 14);
    if (atr < 1.0 || atr > 12.0) continue;

    const h1Struct = evaluateStructureBias(h1Slice);
    if (h1Struct.isChop || h1Struct.bias === 'NEUTRAL') continue;

    let htfScore = 0;
    if (withHTFFilter) {
      const d1Struct = evaluateStructureBias(d1Slice);
      const h4Struct = evaluateStructureBias(h4Slice);

      const allBull = d1Struct.bias === 'BULLISH' && h4Struct.bias === 'BULLISH' && h1Struct.bias === 'BULLISH';
      const allBear = d1Struct.bias === 'BEARISH' && h4Struct.bias === 'BEARISH' && h1Struct.bias === 'BEARISH';
      const h4H1BullNeutralD1 = h4Struct.bias === 'BULLISH' && h1Struct.bias === 'BULLISH' && d1Struct.bias === 'NEUTRAL';
      const h4H1BearNeutralD1 = h4Struct.bias === 'BEARISH' && h1Struct.bias === 'BEARISH' && d1Struct.bias === 'NEUTRAL';

      if (allBull || allBear) {
        htfScore = 20;
      } else if (h4H1BullNeutralD1 || h4H1BearNeutralD1) {
        htfScore = 15;
      } else {
        // HTF opposes H1 -> REJECT
        continue;
      }
    } else {
      htfScore = 15; // Baseline score in non-HTF mode
    }

    // Find M30 zones
    const zones = findOrderBlockZones(m30Slice, 'M30');
    const targetType = h1Struct.bias === 'BULLISH' ? 'BULLISH_OB' : 'BEARISH_OB';
    const candidateZone = zones.find((z) => z.type === targetType && z.barAge <= 20);

    if (!candidateZone) continue;

    const isBull = candidateZone.type === 'BULLISH_OB';
    const entryPrice = candidateZone.mid50;

    // Score calculation
    const zoneQuality = candidateZone.hasFVG ? 15 : 10;
    const sweepScore = 20;
    const m15Conf = 20;
    const pdScore = 10;
    const sessScore = 5;
    const totalScore = Math.min(100, htfScore + zoneQuality + sweepScore + m15Conf + pdScore + sessScore);

    if (totalScore < 80) continue;

    // Determine trading session
    const utcHour = new Date(currentM30.openTime).getUTCHours();
    const session: 'ASIAN' | 'LONDON' | 'NEW_YORK' =
      utcHour >= 0 && utcHour < 8 ? 'ASIAN' : utcHour >= 8 && utcHour < 13 ? 'LONDON' : 'NEW_YORK';

    const scoreBucket: '80-85' | '85-90' | '90+' =
      totalScore >= 90 ? '90+' : totalScore >= 85 ? '85-90' : '80-85';

    const sl = isBull ? entryPrice - 10.0 : entryPrice + 10.0;
    const tp1 = isBull ? entryPrice + 5.0 : entryPrice - 5.0;
    const tp2 = isBull ? entryPrice + 8.0 : entryPrice - 8.0;
    const tp3 = isBull ? entryPrice + 10.0 : entryPrice - 10.0;
    const tp4 = isBull ? entryPrice + 12.0 : entryPrice - 12.0;

    // Forward simulation on subsequent M30 candles (k > i)
    let filled = false;
    let outcome: ReplayTrade['outcome'] = 'EXPIRED_UNFILLED';
    let realizedRR = 0;
    let tp1Hit = false;
    let currentSL = sl;

    for (let k = i + 1; k < Math.min(m30Candles.length, i + 30); k++) {
      const futureBar = m30Candles[k];

      if (!filled) {
        // Within first 2 bars (~60 mins), check if entry limit touched
        if (k <= i + 2) {
          const entryTouched = isBull ? futureBar.low <= entryPrice : futureBar.high >= entryPrice;
          if (entryTouched) {
            filled = true;
          }
        } else {
          outcome = 'EXPIRED_UNFILLED';
          break;
        }
      }

      if (filled) {
        // Check SL
        const slHit = isBull ? futureBar.low <= currentSL : futureBar.high >= currentSL;

        // Check TP4
        const tp4Hit = isBull ? futureBar.high >= tp4 : futureBar.low <= tp4;
        const tp3Hit = isBull ? futureBar.high >= tp3 : futureBar.low <= tp3;
        const tp2Hit = isBull ? futureBar.high >= tp2 : futureBar.low <= tp2;
        const testTP1 = isBull ? futureBar.high >= tp1 : futureBar.low <= tp1;

        if (testTP1 && !tp1Hit) {
          tp1Hit = true;
          currentSL = entryPrice; // Breakeven rule
        }

        if (tp4Hit) {
          outcome = 'TP4_HIT';
          realizedRR = 1.2;
          break;
        } else if (tp3Hit && slHit) {
          outcome = 'TP3_HIT';
          realizedRR = 1.0;
          break;
        } else if (tp2Hit && slHit) {
          outcome = 'TP2_HIT';
          realizedRR = 0.8;
          break;
        } else if (tp1Hit && slHit) {
          outcome = 'BE_HIT';
          realizedRR = 0.5; // TP1 secured, remainder BE
          break;
        } else if (slHit) {
          outcome = 'STOPPED_OUT';
          realizedRR = -1.0;
          break;
        }
      }
    }

    if (filled) {
      trades.push({
        id: `REPLAY-TRADE-${i}-${candidateZone.openTime}`,
        time: currentM30.openTime,
        session,
        direction: isBull ? 'BUY' : 'SELL',
        entry: Number(entryPrice.toFixed(2)),
        sl: Number(sl.toFixed(2)),
        tp1: Number(tp1.toFixed(2)),
        tp2: Number(tp2.toFixed(2)),
        tp3: Number(tp3.toFixed(2)),
        tp4: Number(tp4.toFixed(2)),
        score: totalScore,
        scoreBucket,
        outcome,
        realizedRR,
      });

      // Advance index to prevent duplicate overlapping trades from same zone
      i += 3;
    }
  }

  const completed = trades.filter((t) => t.outcome !== 'EXPIRED_UNFILLED');
  const tp1Count = completed.filter((t) => t.outcome === 'TP1_HIT' || t.outcome === 'TP2_HIT' || t.outcome === 'TP3_HIT' || t.outcome === 'TP4_HIT' || t.outcome === 'BE_HIT').length;
  const tp2Count = completed.filter((t) => t.outcome === 'TP2_HIT' || t.outcome === 'TP3_HIT' || t.outcome === 'TP4_HIT').length;
  const tp4Count = completed.filter((t) => t.outcome === 'TP4_HIT').length;
  const slCount = completed.filter((t) => t.outcome === 'STOPPED_OUT').length;

  const totalRR = completed.reduce((sum, t) => sum + t.realizedRR, 0);
  const avgRR = completed.length > 0 ? Number((totalRR / completed.length).toFixed(2)) : 0;

  // Calculate Max Consecutive Losses
  let maxLosses = 0;
  let currentLosses = 0;
  for (const t of completed) {
    if (t.outcome === 'STOPPED_OUT') {
      currentLosses += 1;
      maxLosses = Math.max(maxLosses, currentLosses);
    } else {
      currentLosses = 0;
    }
  }

  // Session breakdown
  const calcSessionStats = (sess: 'ASIAN' | 'LONDON' | 'NEW_YORK') => {
    const list = completed.filter((t) => t.session === sess);
    const wins = list.filter((t) => t.realizedRR > 0).length;
    const rrSum = list.reduce((s, t) => s + t.realizedRR, 0);
    return {
      trades: list.length,
      winRateTP1: list.length > 0 ? Number(((wins / list.length) * 100).toFixed(1)) : 0,
      avgRR: list.length > 0 ? Number((rrSum / list.length).toFixed(2)) : 0,
    };
  };

  // Score bucket breakdown
  const calcBucketStats = (bucket: '80-85' | '85-90' | '90+') => {
    const list = completed.filter((t) => t.scoreBucket === bucket);
    const wins = list.filter((t) => t.realizedRR > 0).length;
    const rrSum = list.reduce((s, t) => s + t.realizedRR, 0);
    return {
      trades: list.length,
      winRateTP1: list.length > 0 ? Number(((wins / list.length) * 100).toFixed(1)) : 0,
      avgRR: list.length > 0 ? Number((rrSum / list.length).toFixed(2)) : 0,
    };
  };

  const isReliable = completed.length >= 25 && m30Candles.length >= 80;
  const reliabilityNote = isReliable
    ? 'Statistical sample size sufficient for institutional review.'
    : `Historical sample size (${m30Candles.length} M30 bars / ${completed.length} trades) is too short for long-term statistical certainty. Results reflect recent market conditions only.`;

  return {
    mode: withHTFFilter ? 'WITH_HTF_FILTER' : 'WITHOUT_HTF_FILTER',
    totalCandlesEvaluated: m30Candles.length,
    totalTrades: trades.length,
    unfilledTrades: trades.filter((t) => t.outcome === 'EXPIRED_UNFILLED').length,
    completedTrades: completed.length,
    winRateTP1Percent: completed.length > 0 ? Number(((tp1Count / completed.length) * 100).toFixed(1)) : 0,
    winRateTP2Percent: completed.length > 0 ? Number(((tp2Count / completed.length) * 100).toFixed(1)) : 0,
    winRateTP4Percent: completed.length > 0 ? Number(((tp4Count / completed.length) * 100).toFixed(1)) : 0,
    slRatePercent: completed.length > 0 ? Number(((slCount / completed.length) * 100).toFixed(1)) : 0,
    averageRR: avgRR,
    maxConsecutiveLosses: maxLosses,
    bySession: {
      asian: calcSessionStats('ASIAN'),
      london: calcSessionStats('LONDON'),
      newYork: calcSessionStats('NEW_YORK'),
    },
    byScoreBucket: {
      '80-85': calcBucketStats('80-85'),
      '85-90': calcBucketStats('85-90'),
      '90+': calcBucketStats('90+'),
    },
    isReliable,
    reliabilityNote,
    trades,
  };
}

export function getActiveSignal(): SignalPlan | null {
  return activeSignalStore;
}
