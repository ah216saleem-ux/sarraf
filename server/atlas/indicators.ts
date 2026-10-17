// server/atlas/indicators.ts
import { Candle } from '../../src/server/candleEngine';
import { TimeframeTrend } from './atlasTypes';

export function calculateEMA(candles: Candle[], period: number): number | null {
  if (!candles || candles.length < period) return null;
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) {
    ema += candles[i].close;
  }
  ema /= period;

  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
  }
  return Number(ema.toFixed(2));
}

export function calculateATR(candles: Candle[], period: number = 14): number {
  if (!candles || candles.length < 2) return 10.0;
  const count = Math.min(candles.length - 1, period);
  let trSum = 0;

  const startIdx = candles.length - count;
  for (let i = startIdx; i < candles.length; i++) {
    const current = candles[i];
    const prev = candles[i - 1];
    const hl = current.high - current.low;
    const hpc = Math.abs(current.high - prev.close);
    const lpc = Math.abs(current.low - prev.close);
    const tr = Math.max(hl, hpc, lpc);
    trSum += tr;
  }

  const atr = trSum / count;
  return Number(atr.toFixed(2));
}

export function findSwings(candles: Candle[], lookback: number = 5): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];

  if (!candles || candles.length < lookback * 2 + 1) {
    return { highs, lows };
  }

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];
    let isHigh = true;
    let isLow = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= current.high) isHigh = false;
      if (candles[j].low <= current.low) isLow = false;
    }

    if (isHigh) highs.push(Number(current.high.toFixed(2)));
    if (isLow) lows.push(Number(current.low.toFixed(2)));
  }

  return { highs, lows };
}

export function countZoneTouches(candles: Candle[], top: number, bottom: number, days: number = 20): number {
  if (!candles || candles.length === 0) return 0;
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;

  const sorted = candles
    .filter((c) => {
      const ts = new Date(c.openTime).getTime();
      return !isNaN(ts) && ts >= cutoff;
    })
    .sort((a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime());

  let distinctTouches = 0;
  let inEvent = false;
  let consecutiveOutside = 0;

  for (const c of sorted) {
    const isInside = c.high >= bottom && c.low <= top;
    if (isInside) {
      if (!inEvent) {
        distinctTouches++;
        inEvent = true;
      }
      consecutiveOutside = 0;
    } else {
      if (inEvent) {
        consecutiveOutside++;
        if (consecutiveOutside >= 3) {
          inEvent = false;
        }
      }
    }
  }

  return distinctTouches;
}

export function calculateRSI(candles: Candle[], period: number = 14): number {
  if (!candles || candles.length <= period) return 50.0;
  let gains = 0;
  let losses = 0;

  for (let i = candles.length - period; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100.0;
  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  return Number(rsi.toFixed(1));
}

export function aggregateWeeklyCandles(d1Candles: Candle[]): Candle[] {
  if (!d1Candles || d1Candles.length === 0) return [];
  const weeksMap = new Map<string, Candle[]>();

  for (const c of d1Candles) {
    const d = new Date(c.openTime);
    if (isNaN(d.getTime())) continue;
    // Calculate week year + week number
    const target = new Date(d.valueOf());
    const dayNr = (d.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setUTCMonth(0, 1);
    if (target.getUTCDay() !== 4) {
      target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
    }
    const weekNumber = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
    const key = `${d.getUTCFullYear()}-W${weekNumber}`;

    if (!weeksMap.has(key)) weeksMap.set(key, []);
    weeksMap.get(key)!.push(c);
  }

  const weekly: Candle[] = [];
  for (const list of weeksMap.values()) {
    if (list.length === 0) continue;
    const openTime = list[0].openTime;
    const open = list[0].open;
    const close = list[list.length - 1].close;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;

    for (const c of list) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume || 0;
    }

    weekly.push({
      openTime,
      open,
      high,
      low,
      close,
      volume,
      isClosed: true,
    });
  }

  return weekly;
}

export function aggregateMonthlyCandles(d1Candles: Candle[]): Candle[] {
  if (!d1Candles || d1Candles.length === 0) return [];
  const monthsMap = new Map<string, Candle[]>();

  for (const c of d1Candles) {
    const d = new Date(c.openTime);
    if (isNaN(d.getTime())) continue;
    const key = c.openTime.slice(0, 7); // e.g. 2026-10
    if (!monthsMap.has(key)) monthsMap.set(key, []);
    monthsMap.get(key)!.push(c);
  }

  const monthly: Candle[] = [];
  for (const list of monthsMap.values()) {
    if (list.length === 0) continue;
    const openTime = list[0].openTime;
    const open = list[0].open;
    const close = list[list.length - 1].close;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;

    for (const c of list) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume || 0;
    }

    monthly.push({
      openTime,
      open,
      high,
      low,
      close,
      volume,
      isClosed: true,
    });
  }

  return monthly;
}

export function computeTimeframeTrend(
  candles: Candle[],
  tf: 'MN' | 'W1' | 'D1' | 'H4' | 'H1',
  weight: number
): TimeframeTrend {
  if (!candles || candles.length < 3) {
    return {
      timeframe: tf,
      trend: 'NO DATA',
      ema50: null,
      ema100: null,
      ema200: null,
      structure: 'Insufficient data bars',
      weight,
    };
  }

  const lastCandle = candles[candles.length - 1];
  const ema50 = calculateEMA(candles, 50);
  const ema100 = calculateEMA(candles, 100);
  const ema200 = calculateEMA(candles, 200);

  // Evaluate structure from recent candles
  const lookback = Math.min(10, candles.length);
  const recent = candles.slice(-lookback);
  const firstHalf = recent.slice(0, Math.floor(lookback / 2));
  const secondHalf = recent.slice(Math.floor(lookback / 2));

  const firstHigh = Math.max(...firstHalf.map((c) => c.high));
  const firstLow = Math.min(...firstHalf.map((c) => c.low));
  const secondHigh = Math.max(...secondHalf.map((c) => c.high));
  const secondLow = Math.min(...secondHalf.map((c) => c.low));

  const isHigherHighs = secondHigh > firstHigh;
  const isHigherLows = secondLow > firstLow;
  const isLowerHighs = secondHigh < firstHigh;
  const isLowerLows = secondLow < firstLow;

  let trend: 'BULLISH' | 'BEARISH' | 'RANGE' = 'RANGE';
  let structure = 'Range-bound structure';

  // If we have full EMAs, combine EMA alignment + structure
  if (ema50 !== null && ema100 !== null) {
    if (lastCandle.close > ema50 && ema50 > ema100) {
      trend = 'BULLISH';
      structure = 'Price > EMA50 > EMA100 (Bullish alignment)';
    } else if (lastCandle.close < ema50 && ema50 < ema100) {
      trend = 'BEARISH';
      structure = 'Price < EMA50 < EMA100 (Bearish alignment)';
    } else if (isHigherHighs && isHigherLows) {
      trend = 'BULLISH';
      structure = 'Higher highs & higher lows structure';
    } else if (isLowerHighs && isLowerLows) {
      trend = 'BEARISH';
      structure = 'Lower highs & lower lows structure';
    }
  } else {
    // Structure-based
    if (isHigherHighs && isHigherLows) {
      trend = 'BULLISH';
      structure = 'Higher highs & higher lows structure';
    } else if (isLowerHighs && isLowerLows) {
      trend = 'BEARISH';
      structure = 'Lower highs & lower lows structure';
    }
  }

  return {
    timeframe: tf,
    trend,
    ema50,
    ema100,
    ema200,
    structure,
    weight,
  };
}

export function computeParticipationRatio(h1Candles: Candle[]): {
  ratio: number;
  status: 'HIGH' | 'NORMAL' | 'LOW';
} {
  if (!h1Candles || h1Candles.length < 5) {
    return { ratio: 1.0, status: 'NORMAL' };
  }

  const currentVol = h1Candles[h1Candles.length - 1].volume || 1;
  const lookback = Math.min(20, h1Candles.length - 1);
  const sample = h1Candles.slice(-lookback - 1, -1);
  const sumVol = sample.reduce((acc, c) => acc + (c.volume || 1), 0);
  const avgVol = Math.max(1, sumVol / Math.max(1, sample.length));

  const ratio = Number((currentVol / avgVol).toFixed(2));
  let status: 'HIGH' | 'NORMAL' | 'LOW' = 'NORMAL';
  if (ratio >= 1.3) status = 'HIGH';
  else if (ratio <= 0.7) status = 'LOW';

  return { ratio, status };
}
