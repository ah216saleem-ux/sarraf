// src/fireZone/chartOverlay.ts
import { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { Candle, FireZoneEngineResult } from './types';
import { StructureBreakLine } from './structure';
import {
  buildChartModel,
  ChartModelZone,
  ChartModelPlanLine,
  FireZoneChartModel,
} from './engineGatesAndLadder';

export { buildChartModel };
export type { ChartModelZone, ChartModelPlanLine, FireZoneChartModel };

export interface EdgeZoneBadge {
  id: string;
  position: 'TOP' | 'BOTTOM';
  side: 'BUY' | 'SELL';
  text: string;
}

export interface ChartLayerToggles {
  showInternal: boolean;
  showSwing: boolean;
  showLabels: boolean;
}

let lastDebugLogKey = '';

function resolveModel(
  modelOrEngine: FireZoneChartModel | FireZoneEngineResult
): FireZoneChartModel {
  if ('zones' in modelOrEngine && 'planLines' in modelOrEngine) {
    return modelOrEngine;
  }
  return buildChartModel(modelOrEngine);
}

/**
 * Legacy helper kept for API compatibility (edge badges removed from 007 chart UI).
 */
export function computeOutOfRangeZoneBadges(
  _series: ISeriesApi<'Candlestick'>,
  _modelOrEngine: FireZoneChartModel | FireZoneEngineResult,
  _plotHeight: number
): EdgeZoneBadge[] {
  return [];
}

function drawLivePriceScaleTag(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  plotWidth: number,
  totalWidth: number,
  plotHeight: number
) {
  if (y < 6 || y > plotHeight - 6) return;
  const tagW = Math.max(48, totalWidth - plotWidth - 4);
  const tagH = 16;
  const tagX = totalWidth - tagW - 2;
  const tagY = Math.max(1, Math.min(plotHeight - tagH - 1, Math.round(y - tagH / 2)));

  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = '#f2b94b';
  ctx.strokeStyle = '#f2b94b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(tagX, tagY, tagW, tagH);
  ctx.fill();
  ctx.stroke();

  ctx.font = `bold 9.5px 'JetBrains Mono', monospace`;
  ctx.fillStyle = '#07090d';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, totalWidth - 5, tagY + tagH / 2);
  ctx.restore();
}

function resolveTimeCoordinate(
  chart: IChartApi,
  targetTime: number,
  candles: Candle[]
): number | null {
  const ts = chart.timeScale();
  const direct = ts.timeToCoordinate(targetTime as UTCTimestamp);
  if (direct !== null) return direct;
  if (!candles || candles.length === 0) return null;

  // Fallback for 4H/1D timeframes where H1 timestamp falls inside a larger bar
  let bestBarTime = candles[0].time;
  let minDiff = Math.abs(candles[0].time - targetTime);
  for (let i = 1; i < candles.length; i++) {
    const d = Math.abs(candles[i].time - targetTime);
    if (d < minDiff) {
      minDiff = d;
      bestBarTime = candles[i].time;
    }
  }
  return ts.timeToCoordinate(bestBarTime as UTCTimestamp);
}

/**
 * 5) STRUCTURE (BOS / CHoCH):
 * Keep the pivot-to-break horizontal line and centered label,
 * only SWING structure by default (internal toggle OFF), max last 4 breaks,
 * 60% opacity, 9px labels, so they never hide the zones.
 */
function drawStructureBreakSegment(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  brk: StructureBreakLine,
  plotWidth: number,
  plotHeight: number,
  candles: Candle[]
) {
  const y = series.priceToCoordinate(brk.pivotPrice);
  if (y === null || y < 10 || y > plotHeight - 10) return;

  const x1Raw = resolveTimeCoordinate(chart, brk.pivotTime, candles);
  const x2Raw = resolveTimeCoordinate(chart, brk.breakTime, candles);
  if (x1Raw === null || x2Raw === null) return;

  if (x2Raw < 0 || x1Raw > plotWidth) return;

  const x1 = Math.max(0, x1Raw);
  const x2 = Math.min(plotWidth, x2Raw);
  if (x2 - x1 < 4) return;

  const isBull = brk.direction === 1;
  const color = isBull ? '#2fe08a' : '#ff4d66';

  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.0;
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();

  const midRaw = resolveTimeCoordinate(chart, brk.midTime, candles);
  const midX =
    midRaw !== null && midRaw >= x1 && midRaw <= x2 ? midRaw : (x1 + x2) / 2;

  ctx.font = `bold 9px 'JetBrains Mono', monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = isBull ? 'bottom' : 'top';
  ctx.shadowColor = '#08080b';
  ctx.shadowBlur = 3;

  const labelY = isBull ? y - 2 : y + 2;
  ctx.fillText(brk.label, midX, labelY);
  ctx.restore();
}

/**
 * Clean "007" Chart Overlay:
 * 1) Up to 4 zones (SELL near, SELL deep, BUY near, BUY deep):
 *    - Thin box [LO, HI] ($4 tall), full plot width (0 to plotWidth)
 *    - Border: 1.3px solid (#ff4d66 SELL, #2fe08a BUY)
 *    - Fill: 7% opacity
 *    - Label above top-left of each box, 10px bold mono, same color as box:
 *      "FIRE ZONE SELL 4115.13 - CRITICAL - near" / "... - deep"
 *      with text shadow in chart background color (#08080b) and non-overlapping vertical shift (<14px).
 * 2) Subtle SWING BOS/CHoCH structure (max last 4 breaks, 60% opacity, 9px labels).
 * 3) Gold #f2b94b 1px solid horizontal line at live price with price tag on the right axis.
 */
export function drawFireZoneCanvasOverlay(
  canvas: HTMLCanvasElement,
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  modelOrEngine: FireZoneChartModel | FireZoneEngineResult,
  toggles: ChartLayerToggles,
  _pulsePhase: number,
  candles: Candle[] = [],
  livePriceOverride?: number
) {
  const model = resolveModel(modelOrEngine);
  const livePrice =
    typeof livePriceOverride === 'number' && livePriceOverride > 0
      ? livePriceOverride
      : model.currentPrice;

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const priceScaleWidth = series.priceScale().width() || 62;
  const totalWidth = canvas.clientWidth || 340;
  const totalHeight = canvas.clientHeight || 430;
  const plotWidth = Math.max(50, totalWidth - priceScaleWidth);
  const plotHeight = Math.max(50, totalHeight - 26);

  const targetCanvasW = Math.floor(totalWidth * dpr);
  const targetCanvasH = Math.floor(totalHeight * dpr);
  if (canvas.width !== targetCanvasW || canvas.height !== targetCanvasH) {
    canvas.width = targetCanvasW;
    canvas.height = targetCanvasH;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, totalWidth, totalHeight);

  // Clip plot drawing to the candlestick plot area (0..plotWidth, 0..plotHeight)
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, plotWidth, plotHeight);
  ctx.clip();

  // 1. Subtle BOS / CHoCH structure (SWING only by default, max last 4 breaks, 60% opacity, 9px labels)
  if (toggles.showInternal) {
    const internalBreaks = model.structureBreaks.internal.slice(-4);
    for (const brk of internalBreaks) {
      drawStructureBreakSegment(ctx, chart, series, brk, plotWidth, plotHeight, candles);
    }
  }

  if (toggles.showSwing) {
    const swingBreaks = model.structureBreaks.swing.slice(-4);
    for (const brk of swingBreaks) {
      drawStructureBreakSegment(ctx, chart, series, brk, plotWidth, plotHeight, candles);
    }
  }

  // 2. Collect visible zones from model.zones (sorted high price to low price -> top of screen to bottom)
  interface VisibleZoneRenderItem {
    zone: ChartModelZone;
    rawTop: number;
    rawBot: number;
    yTop: number;
    yBot: number;
    boxH: number;
    borderColor: string;
    fillColor: string;
    labelText: string;
  }

  const sortedZones = [...model.zones].sort((a, b) => b.anchor - a.anchor);
  const visibleZones: VisibleZoneRenderItem[] = [];

  for (const z of sortedZones) {
    const yHi = series.priceToCoordinate(z.HI);
    const yLo = series.priceToCoordinate(z.LO);
    if (yHi === null || yLo === null) continue;

    const rawTop = Math.min(yHi, yLo);
    const rawBot = Math.max(yHi, yLo);

    // Zones outside the visible price range are simply not drawn (they come back when the scale reaches them)
    if (rawBot < 0 || rawTop > plotHeight) continue;

    const yTop = Math.max(0, rawTop);
    const yBot = Math.min(plotHeight, rawBot);
    const boxH = Math.max(2, yBot - yTop);

    const isSell = z.side === 'SELL';
    const borderColor = isSell ? '#ff4d66' : '#2fe08a';
    const fillColor = isSell ? 'rgba(255, 77, 102, 0.07)' : 'rgba(47, 224, 138, 0.07)';
    const slotTag = z.type === 'NEAREST' ? 'near' : 'deep';
    const labelText = `FIRE ZONE ${z.side} ${z.anchor.toFixed(2)} - ${z.strength} - ${slotTag}`;

    visibleZones.push({
      zone: z,
      rawTop,
      rawBot,
      yTop,
      yBot,
      boxH,
      borderColor,
      fillColor,
      labelText,
    });
  }

  // Diagnostic log of plot size, devicePixelRatio, and y coordinates of one zone
  const sampleZone =
    model.zones.find((z) => z.type === 'NEAREST' && z.side === 'BUY') || model.zones[0];
  if (sampleZone) {
    const sampleYHi = series.priceToCoordinate(sampleZone.HI);
    const sampleYLo = series.priceToCoordinate(sampleZone.LO);
    const debugKey = `${plotWidth}x${plotHeight}|dpr=${dpr}|vis=${visibleZones.length}|${sampleZone.id}|${
      sampleYHi !== null ? Math.round(sampleYHi) : 'null'
    }-${sampleYLo !== null ? Math.round(sampleYLo) : 'null'}`;
    if (debugKey !== lastDebugLogKey) {
      lastDebugLogKey = debugKey;
      console.debug('[FireZoneOverlay]', {
        plotArea: { plotWidth, plotHeight, totalWidth, totalHeight },
        devicePixelRatio: dpr,
        visibleZonesCount: visibleZones.length,
        sampleZone: {
          id: sampleZone.id,
          HI: sampleZone.HI,
          LO: sampleZone.LO,
          yHi: sampleYHi,
          yLo: sampleYLo,
        },
      });
    }
  }

  // First pass: draw all visible zone boxes (full plot width 0..plotWidth, 1.3px solid border, 7% fill)
  for (const item of visibleZones) {
    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.setLineDash([]);

    // 7% opacity fill across full plot width
    ctx.fillStyle = item.fillColor;
    ctx.fillRect(0, item.yTop, plotWidth, item.boxH);

    // 1.3px solid outline around [LO, HI] across full plot width
    ctx.strokeStyle = item.borderColor;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(0.65, item.rawTop, Math.max(1, plotWidth - 1.3), Math.max(2, item.rawBot - item.rawTop));
    ctx.restore();
  }

  // Second pass: draw non-overlapping 10px bold mono labels above top-left of each box
  // If two labels are closer than 14px vertically, shift the lower one down inside its own box.
  let prevLabelY: number | null = null;
  for (const item of visibleZones) {
    ctx.save();
    ctx.font = `bold 10px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    const labelX = 8;
    // Default position: just above the top edge of the box
    let labelY = Math.max(12, item.yTop - 3);

    if (prevLabelY !== null && labelY - prevLabelY < 14) {
      // Shift the lower label down inside its own box (at least 14px below the upper label)
      const shiftedInsideBox = item.yTop + 11;
      labelY = Math.min(plotHeight - 3, Math.max(prevLabelY + 14, shiftedInsideBox));
    }
    prevLabelY = labelY;

    // Text shadow + outline in chart background color (#08080b) for high readability over candles
    ctx.shadowColor = '#08080b';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = '#08080b';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(item.labelText, labelX, labelY);

    ctx.fillStyle = item.borderColor;
    ctx.fillText(item.labelText, labelX, labelY);
    ctx.restore();
  }

  // 3. Gold #f2b94b 1px solid horizontal line at the live price
  let yLive: number | null = null;
  if (livePrice > 0) {
    const coord = series.priceToCoordinate(livePrice);
    if (coord !== null && coord >= 0 && coord <= plotHeight) {
      yLive = coord;
      ctx.save();
      ctx.strokeStyle = '#f2b94b';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(0, yLive);
      ctx.lineTo(plotWidth, yLive);
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.restore(); // End plot-area clip

  // 4. Live price tag on the right axis
  if (yLive !== null && livePrice > 0) {
    drawLivePriceScaleTag(
      ctx,
      livePrice.toFixed(2),
      yLive,
      plotWidth,
      totalWidth,
      plotHeight
    );
  }
}
