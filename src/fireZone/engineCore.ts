// src/fireZone/engineCore.ts
import {
  Candle,
  Pivot,
  PivotLevel,
  StructureEvent,
  StructureEventType,
  ZoneSide,
  ZoneType,
  ZoneStrengthLabel,
  FireZone,
} from './types';

/**
 * Compute Average True Range (ATR 14).
 */
export function computeAtr(candles: Candle[], period: number = 14): number {
  if (candles.length < 2) return 2.0;

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    trs.push(tr);
  }

  if (trs.length < period) {
    const sum = trs.reduce((a, b) => a + b, 0);
    return Math.max(0.5, Number((sum / (trs.length || 1)).toFixed(2)));
  }

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }

  return Math.max(0.5, Number(atr.toFixed(2)));
}

/**
 * Detect swing pivots for a given L lookback window.
 * Bar j is a swing high if high[j] >= every high in [j-L, j+L].
 */
export function findPivots(candles: Candle[], L: PivotLevel): Pivot[] {
  const pivots: Pivot[] = [];
  const len = candles.length;
  if (len < 2 * L + 1) return pivots;

  for (let j = L; j < len - L; j++) {
    const c = candles[j];

    let isHigh = c.high > candles[j - 1].high || c.high > candles[j + 1].high;
    if (isHigh) {
      for (let k = j - L; k <= j + L; k++) {
        if (candles[k].high > c.high) {
          isHigh = false;
          break;
        }
      }
    }

    let isLow = c.low < candles[j - 1].low || c.low < candles[j + 1].low;
    if (isLow) {
      for (let k = j - L; k <= j + L; k++) {
        if (candles[k].low < c.low) {
          isLow = false;
          break;
        }
      }
    }

    if (isHigh) {
      pivots.push({
        index: j,
        time: c.time,
        type: 'HIGH',
        price: c.high,
        level: L,
        volume: c.volume,
      });
    }

    if (isLow) {
      pivots.push({
        index: j,
        time: c.time,
        type: 'LOW',
        price: c.low,
        level: L,
        volume: c.volume,
      });
    }
  }

  return pivots;
}

/**
 * Compute market structure (BOS / CHoCH) and resulting trend (+1, -1, 0).
 */
export function computeStructureAndTrend(
  candles: Candle[],
  pivots: Pivot[]
): { trend: 1 | -1 | 0; events: StructureEvent[] } {
  let trend: 1 | -1 | 0 = 0;
  const events: StructureEvent[] = [];

  if (candles.length === 0 || pivots.length === 0) {
    return { trend, events };
  }

  let lastUnbrokenHigh: Pivot | null = null;
  let lastUnbrokenLow: Pivot | null = null;
  let pivotCursor = 0;

  for (let k = 0; k < candles.length; k++) {
    const bar = candles[k];

    while (pivotCursor < pivots.length) {
      const p = pivots[pivotCursor];
      if (p.index + p.level <= k) {
        if (p.type === 'HIGH') {
          lastUnbrokenHigh = p;
        } else {
          lastUnbrokenLow = p;
        }
        pivotCursor++;
      } else {
        break;
      }
    }

    if (lastUnbrokenHigh && bar.close > lastUnbrokenHigh.price) {
      const eventType: StructureEventType = trend === -1 ? 'CHoCH' : 'BOS';
      events.push({
        barIndex: k,
        time: bar.time,
        direction: 1,
        type: eventType,
        brokenPivotPrice: lastUnbrokenHigh.price,
        brokenPivotIndex: lastUnbrokenHigh.index,
        closePrice: bar.close,
      });
      trend = 1;
      lastUnbrokenHigh = null;
    }

    if (lastUnbrokenLow && bar.close < lastUnbrokenLow.price) {
      const eventType: StructureEventType = trend === 1 ? 'CHoCH' : 'BOS';
      events.push({
        barIndex: k,
        time: bar.time,
        direction: -1,
        type: eventType,
        brokenPivotPrice: lastUnbrokenLow.price,
        brokenPivotIndex: lastUnbrokenLow.index,
        closePrice: bar.close,
      });
      trend = -1;
      lastUnbrokenLow = null;
    }
  }

  return { trend, events };
}

/**
 * Extract zones from pivots, evaluate lifecycle (dead on close, wicks do not kill),
 * and compute freshness-based strength score.
 */
export function extractZones(
  candles: Candle[],
  pivots: Pivot[],
  zh: number,
  currentPrice: number
): {
  liveZones: FireZone[];
  deadZones: FireZone[];
  recentlyBroken: FireZone[];
} {
  const totalBars = candles.length;
  const liveZones: FireZone[] = [];
  const deadZones: FireZone[] = [];
  const minPivotIndex = Math.max(0, totalBars - 150);

  for (const pivot of pivots) {
    if (pivot.index < minPivotIndex) continue;

    const isHigh = pivot.type === 'HIGH';
    const side: ZoneSide = isHigh ? 'SELL' : 'BUY';
    const top = isHigh ? Number(pivot.price.toFixed(2)) : Number((pivot.price + zh).toFixed(2));
    const bottom = isHigh ? Number((pivot.price - zh).toFixed(2)) : Number(pivot.price.toFixed(2));
    const anchor = Number(((top + bottom) / 2).toFixed(3));

    let isDead = false;
    let deathBarIndex: number | undefined;
    let deathTime: number | undefined;
    let touches = 0;

    for (let k = pivot.index + 1; k < totalBars; k++) {
      const c = candles[k];
      if (side === 'SELL') {
        if (c.close > top) {
          isDead = true;
          deathBarIndex = k;
          deathTime = c.time;
          break;
        }
        if (c.high >= bottom) {
          touches++;
        }
      } else {
        if (c.close < bottom) {
          isDead = true;
          deathBarIndex = k;
          deathTime = c.time;
          break;
        }
        if (c.low <= top) {
          touches++;
        }
      }
    }

    const freshnessPts = touches === 0 ? 4 : touches === 1 ? 2 : 0;
    const originWeight = pivot.level === 50 ? 5 : pivot.level === 20 ? 3 : 1;
    const score = originWeight + freshnessPts;
    const label: ZoneStrengthLabel =
      score >= 11 ? 'CRITICAL' : score >= 8 ? 'STRONG' : 'MODERATE';

    let distance = 0;
    if (currentPrice > top) {
      distance = Number((currentPrice - top).toFixed(2));
    } else if (currentPrice < bottom) {
      distance = Number((bottom - currentPrice).toFixed(2));
    }

    const zone: FireZone = {
      id: `${side}-${pivot.level}-${pivot.time}-${pivot.price.toFixed(1)}`,
      side,
      top,
      bottom,
      anchor,
      pivotIndex: pivot.index,
      pivotTime: pivot.time,
      pivotPrice: pivot.price,
      pivotLevel: pivot.level,
      isLive: !isDead,
      isDead,
      deathBarIndex,
      deathTime,
      barsAgoBroken: deathBarIndex !== undefined ? totalBars - 1 - deathBarIndex : undefined,
      touches,
      score,
      label,
      distance,
    };

    if (isDead) {
      deadZones.push(zone);
    } else {
      liveZones.push(zone);
    }
  }

  const recentlyBroken = [...deadZones]
    .sort((a, b) => (b.deathBarIndex ?? 0) - (a.deathBarIndex ?? 0))
    .slice(0, 10);

  return { liveZones, deadZones, recentlyBroken };
}
