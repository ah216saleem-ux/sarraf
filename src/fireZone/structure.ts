// src/fireZone/structure.ts
import { Candle } from './types';

export const INTERNAL_PIVOT_LEN = 5;
export const SWING_PIVOT_LEN = 20;

export type StructureLayerKind = 'INTERNAL' | 'SWING';
export type StructureBreakLabel = 'BOS' | 'CHoCH' | 'CHoCH+';
export type SwingPointTag = 'HH' | 'HL' | 'LH' | 'LL';

export interface StructurePivotPoint {
  index: number;
  time: number;
  price: number;
  type: 'HIGH' | 'LOW';
  swingTag?: SwingPointTag;
}

export interface StructureBreakLine {
  id: string;
  layer: StructureLayerKind;
  direction: 1 | -1; // 1 = bullish, -1 = bearish
  label: StructureBreakLabel;
  pivotIndex: number;
  pivotTime: number;
  pivotPrice: number;
  breakIndex: number;
  breakTime: number;
  midIndex: number;
  midTime: number;
}

export interface LayerStructureResult {
  layer: StructureLayerKind;
  pivotLength: number;
  trend: 1 | -1 | 0;
  breaks: StructureBreakLine[];
  confirmedPivots: StructurePivotPoint[];
}

export interface DualStructureResult {
  internal: LayerStructureResult;
  swing: LayerStructureResult;
}

/**
 * Pure indicator-style Market Structure engine (LuxAlgo / IANI Pine style)
 * for a single layer (INTERNAL L=5 or SWING L=20).
 *
 * Rules:
 * - Maintain a stack of confirmed pivot highs (newest first), a stack of confirmed pivot lows (newest first),
 *   and a trend state (+1 / -1 / 0).
 * - Pivot at bar j = k - L is confirmed at bar k if high[j] >= all highs in [j-L, j+L] (or low[j] <= all lows).
 * - Bullish break: close crosses ABOVE newest pivot high (prevClose <= level && curClose > level)
 *   AND layer already has at least 2 pivot lows stored.
 *   * If trend was bearish (-1): label CHoCH+ if newest low > previous low, else CHoCH.
 *   * Otherwise: label BOS.
 *   * Set trend = +1, then CLEAR the pivot-high stack (consumed, never fires twice).
 * - Bearish break: close crosses BELOW newest pivot low (prevClose >= level && curClose < level)
 *   AND layer already has at least 2 pivot highs stored.
 *   * If trend was bullish (+1): label CHoCH+ if newest high < previous high, else CHoCH.
 *   * Otherwise: label BOS.
 *   * Set trend = -1, then CLEAR the pivot-low stack (consumed, never fires twice).
 */
export function computeLayerStructure(
  candles: Candle[],
  pivotLength: number,
  layer: StructureLayerKind
): LayerStructureResult {
  const n = candles.length;
  const breaks: StructureBreakLine[] = [];
  const confirmedPivots: StructurePivotPoint[] = [];

  if (n < 2 * pivotLength + 1) {
    return {
      layer,
      pivotLength,
      trend: 0,
      breaks,
      confirmedPivots,
    };
  }

  // Stacks with newest first (index 0 = newest)
  const pivotHighs: StructurePivotPoint[] = [];
  const pivotLows: StructurePivotPoint[] = [];
  let lastSwingHighPrice: number | null = null;
  let lastSwingLowPrice: number | null = null;
  let trend: 1 | -1 | 0 = 0;

  for (let k = 1; k < n; k++) {
    // 1. Check if bar j = k - pivotLength is now confirmed as a pivot at bar k
    const j = k - pivotLength;
    if (j >= pivotLength) {
      const candidate = candles[j];

      let isHigh =
        candidate.high > candles[j - 1].high || candidate.high > candles[j + 1].high;
      if (isHigh) {
        for (let m = j - pivotLength; m <= j + pivotLength; m++) {
          if (candles[m].high > candidate.high) {
            isHigh = false;
            break;
          }
        }
      }

      let isLow =
        candidate.low < candles[j - 1].low || candidate.low < candles[j + 1].low;
      if (isLow) {
        for (let m = j - pivotLength; m <= j + pivotLength; m++) {
          if (candles[m].low < candidate.low) {
            isLow = false;
            break;
          }
        }
      }

      if (isHigh) {
        const swingTag: SwingPointTag =
          lastSwingHighPrice === null || candidate.high >= lastSwingHighPrice ? 'HH' : 'LH';
        lastSwingHighPrice = candidate.high;
        const pt: StructurePivotPoint = {
          index: j,
          time: candidate.time,
          price: candidate.high,
          type: 'HIGH',
          swingTag,
        };
        pivotHighs.unshift(pt);
        confirmedPivots.push(pt);
      }

      if (isLow) {
        const swingTag: SwingPointTag =
          lastSwingLowPrice === null || candidate.low >= lastSwingLowPrice ? 'HL' : 'LL';
        lastSwingLowPrice = candidate.low;
        const pt: StructurePivotPoint = {
          index: j,
          time: candidate.time,
          price: candidate.low,
          type: 'LOW',
          swingTag,
        };
        pivotLows.unshift(pt);
        confirmedPivots.push(pt);
      }
    }

    const prevClose = candles[k - 1].close;
    const curClose = candles[k].close;

    // 2. Check Bullish Break of NEWEST pivot high
    if (pivotHighs.length > 0 && pivotLows.length >= 2) {
      const newestHigh = pivotHighs[0];
      if (prevClose <= newestHigh.price && curClose > newestHigh.price) {
        let label: StructureBreakLabel = 'BOS';
        if (trend === -1) {
          const newestLow = pivotLows[0];
          const prevLow = pivotLows[1];
          label = newestLow.price > prevLow.price ? 'CHoCH+' : 'CHoCH';
        }

        const midIndex = Math.floor((newestHigh.index + k) / 2);
        breaks.push({
          id: `${layer}-BULL-${newestHigh.index}-${k}`,
          layer,
          direction: 1,
          label,
          pivotIndex: newestHigh.index,
          pivotTime: newestHigh.time,
          pivotPrice: newestHigh.price,
          breakIndex: k,
          breakTime: candles[k].time,
          midIndex,
          midTime: candles[midIndex]?.time ?? candles[k].time,
        });

        trend = 1;
        // Consume pivot-high stack so it can never fire twice
        pivotHighs.length = 0;
      }
    }

    // 3. Check Bearish Break of NEWEST pivot low
    if (pivotLows.length > 0 && pivotHighs.length >= 2) {
      const newestLow = pivotLows[0];
      if (prevClose >= newestLow.price && curClose < newestLow.price) {
        let label: StructureBreakLabel = 'BOS';
        if (trend === 1) {
          const newestHigh = pivotHighs[0];
          const prevHigh = pivotHighs[1];
          label = newestHigh.price < prevHigh.price ? 'CHoCH+' : 'CHoCH';
        }

        const midIndex = Math.floor((newestLow.index + k) / 2);
        breaks.push({
          id: `${layer}-BEAR-${newestLow.index}-${k}`,
          layer,
          direction: -1,
          label,
          pivotIndex: newestLow.index,
          pivotTime: newestLow.time,
          pivotPrice: newestLow.price,
          breakIndex: k,
          breakTime: candles[k].time,
          midIndex,
          midTime: candles[midIndex]?.time ?? candles[k].time,
        });

        trend = -1;
        // Consume pivot-low stack so it can never fire twice
        pivotLows.length = 0;
      }
    }
  }

  return {
    layer,
    pivotLength,
    trend,
    breaks,
    confirmedPivots,
  };
}

/**
 * Compute both INTERNAL (L=5) and SWING (L=20) market structure layers.
 */
export function computeDualStructure(
  candles: Candle[],
  internalLen = INTERNAL_PIVOT_LEN,
  swingLen = SWING_PIVOT_LEN
): DualStructureResult {
  return {
    internal: computeLayerStructure(candles, internalLen, 'INTERNAL'),
    swing: computeLayerStructure(candles, swingLen, 'SWING'),
  };
}

export interface AutoscaleNearestZonesOption {
  nearestBuy?: { bottom: number; top: number; anchor: number } | null;
  nearestSell?: { bottom: number; top: number; anchor: number } | null;
  currentPrice: number;
  atr: number;
}

/**
 * Pure helper for chart autoscaleInfoProvider:
 * Uses ONLY the min low and max high of the candles inside the visible logical range [fromLogical, toLogical],
 * plus 6% padding top and bottom.
 * Optionally extends for NEAREST BUY and NEAREST SELL on initial view if they are within 8*ATR of currentPrice
 * (capped so far zones, walls, plan lines, and structure lines never stretch the scale).
 */
export function computeVisibleAutoscaleRange(
  candles: Candle[],
  fromLogical: number,
  toLogical: number,
  nearestZonesOption?: AutoscaleNearestZonesOption
): { minValue: number; maxValue: number } | null {
  if (!candles || candles.length === 0) return null;

  const startIdx = Math.max(0, Math.floor(fromLogical));
  const endIdx = Math.min(candles.length - 1, Math.ceil(toLogical));

  const sliceStart = startIdx <= endIdx ? startIdx : Math.max(0, candles.length - 100);
  const sliceEnd = startIdx <= endIdx ? endIdx : candles.length - 1;

  let minLow = Infinity;
  let maxHigh = -Infinity;

  for (let i = sliceStart; i <= sliceEnd; i++) {
    const c = candles[i];
    if (!c) continue;
    if (Number.isFinite(c.low) && c.low < minLow) minLow = c.low;
    if (Number.isFinite(c.high) && c.high > maxHigh) maxHigh = c.high;
  }

  if (!Number.isFinite(minLow) || !Number.isFinite(maxHigh) || maxHigh < minLow) {
    return null;
  }

  const candleSpan = Math.max(0.5, maxHigh - minLow);

  if (nearestZonesOption && nearestZonesOption.currentPrice > 0) {
    const maxNearestDist = 8 * Math.max(1.5, nearestZonesOption.atr);
    // Cap extension beyond candle range so the price axis always stays tight around candles
    const maxAllowedExtension = Math.min(maxNearestDist, candleSpan * 0.25);

    const nb = nearestZonesOption.nearestBuy;
    if (
      nb &&
      Math.abs(nearestZonesOption.currentPrice - nb.anchor) <= maxNearestDist &&
      minLow - nb.bottom <= maxAllowedExtension
    ) {
      minLow = Math.min(minLow, nb.bottom);
    }

    const ns = nearestZonesOption.nearestSell;
    if (
      ns &&
      Math.abs(ns.anchor - nearestZonesOption.currentPrice) <= maxNearestDist &&
      ns.top - maxHigh <= maxAllowedExtension
    ) {
      maxHigh = Math.max(maxHigh, ns.top);
    }
  }

  const span = Math.max(0.5, maxHigh - minLow);
  const pad = span * 0.06;

  return {
    minValue: Number((minLow - pad).toFixed(4)),
    maxValue: Number((maxHigh + pad).toFixed(4)),
  };
}

