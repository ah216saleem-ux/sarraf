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
 * Compute out-of-range zone badges when a zone in chartModel.zones is above or below the visible price range.
 * Format: "SELL zone 4193.15 (+$105)" or "BUY zone 3950.20 (-$106)"
 */
export function computeOutOfRangeZoneBadges(
  series: ISeriesApi<'Candlestick'>,
  modelOrEngine: FireZoneChartModel | FireZoneEngineResult,
  plotHeight: number
): EdgeZoneBadge[] {
  const model = resolveModel(modelOrEngine);
  const badges: EdgeZoneBadge[] = [];

  for (const z of model.zones) {
    const yHi = series.priceToCoordinate(z.HI);
    const yLo = series.priceToCoordinate(z.LO);
    if (yHi === null || yLo === null) continue;

    const minY = Math.min(yHi, yLo);
    const maxY = Math.max(yHi, yLo);
    const diff = z.anchor - model.currentPrice;
    const signStr = diff >= 0 ? `+$${Math.round(diff)}` : `-$${Math.round(Math.abs(diff))}`;
    const text = `${z.side} ${z.type} ${z.anchor.toFixed(2)} (${signStr})`;

    if (maxY < 0) {
      badges.push({ id: z.id, position: 'TOP', side: z.side, text });
    } else if (minY > plotHeight) {
      badges.push({ id: z.id, position: 'BOTTOM', side: z.side, text });
    }
  }

  return badges;
}

function drawPriceScaleTag(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  plotWidth: number,
  totalWidth: number,
  plotHeight: number,
  borderColor: string,
  textColor: string,
  bgColor = 'rgba(8, 8, 11, 0.92)'
) {
  if (y < 7 || y > plotHeight - 7) return;
  const tagW = Math.max(46, totalWidth - plotWidth - 4);
  const tagH = 14;
  const tagX = totalWidth - tagW - 2;
  const tagY = Math.max(1, Math.min(plotHeight - tagH - 1, Math.round(y - tagH / 2)));

  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = bgColor;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(tagX, tagY, tagW, tagH);
  ctx.fill();
  ctx.stroke();

  ctx.font = `bold 9px 'JetBrains Mono', monospace`;
  ctx.fillStyle = textColor;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, totalWidth - 5, tagY + tagH / 2);
  ctx.restore();
}

function resolveZoneAnchorX(
  chart: IChartApi,
  z: ChartModelZone,
  candles: Candle[],
  plotWidth: number
): number {
  if (!candles || candles.length === 0) return 0;

  // If H1 pivot time is before the first loaded candle of the active timeframe, start at left edge (0)
  if (z.pivotTime < candles[0].time) {
    return 0;
  }

  const ts = chart.timeScale();
  const xCoord = ts.timeToCoordinate(z.pivotTime as UTCTimestamp);

  // If H1 pivot time is before the first visible candle (xCoord <= 0) or not on the time scale (xCoord === null), start at left edge (0)
  if (xCoord === null || xCoord <= 0) {
    return 0;
  }

  // Ensure the zone spans across a clear horizontal width to the right edge
  return Math.max(0, Math.min(xCoord, Math.floor(plotWidth * 0.38)));
}

function drawStructureBreakSegment(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  brk: StructureBreakLine,
  plotWidth: number,
  plotHeight: number
) {
  const y = series.priceToCoordinate(brk.pivotPrice);
  if (y === null || y < 10 || y > plotHeight - 10) return;

  const ts = chart.timeScale();
  const x1Raw = ts.timeToCoordinate(brk.pivotTime as UTCTimestamp);
  const x2Raw = ts.timeToCoordinate(brk.breakTime as UTCTimestamp);
  if (x1Raw === null || x2Raw === null) return;

  if (x2Raw < 0 || x1Raw > plotWidth) return;

  const x1 = Math.max(0, x1Raw);
  const x2 = Math.min(plotWidth, x2Raw);
  if (x2 - x1 < 4) return;

  const isSwing = brk.layer === 'SWING';
  const isBull = brk.direction === 1;
  const isChoch = brk.label === 'CHoCH' || brk.label === 'CHoCH+';

  const color = isBull
    ? isChoch
      ? '#22ad78'
      : '#2ee6a0'
    : isChoch
    ? '#bf4651'
    : '#ff5d6c';

  ctx.save();
  ctx.globalAlpha = isSwing ? 1.0 : 0.7;
  ctx.strokeStyle = color;
  ctx.lineWidth = isSwing ? 1.5 : 1.0;
  ctx.setLineDash(isSwing ? [] : [4, 3]);

  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();

  const midRaw = ts.timeToCoordinate(brk.midTime as UTCTimestamp);
  const midX =
    midRaw !== null && midRaw >= x1 && midRaw <= x2 ? midRaw : (x1 + x2) / 2;

  const fontSize = isSwing ? 11 : 9;
  ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = isBull ? 'bottom' : 'top';

  const labelY = isBull ? y - 3 : y + 3;
  ctx.fillText(brk.label, midX, labelY);

  if (isChoch) {
    const metrics = ctx.measureText(brk.label);
    const halfW = metrics.width / 2;
    const underlineY = isBull ? y - 1.5 : y + fontSize + 4;
    ctx.setLineDash([]);
    ctx.strokeStyle = '#e0b95c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(midX - halfW, underlineY);
    ctx.lineTo(midX + halfW, underlineY);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draw all zones from buildChartModel(engineResult), level walls (KEY & MAJOR only),
 * structure breaks, active plan short lines, and the 1px gold current-price line
 * on a single Retina-scaled HTML5 Canvas overlay.
 */
export function drawFireZoneCanvasOverlay(
  canvas: HTMLCanvasElement,
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  modelOrEngine: FireZoneChartModel | FireZoneEngineResult,
  toggles: ChartLayerToggles,
  pulsePhase: number,
  candles: Candle[] = []
) {
  const model = resolveModel(modelOrEngine);
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

  // Reset transform matrix to exact Retina dpr (prevents compounding scale across frames)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, totalWidth, totalHeight);

  // Diagnostic log of plot area size, devicePixelRatio, and computed y coordinates for one zone
  const sampleZone =
    model.zones.find((z) => z.type === 'NEAREST' && z.side === 'BUY') || model.zones[0];
  if (sampleZone) {
    const sampleYHi = series.priceToCoordinate(sampleZone.HI);
    const sampleYLo = series.priceToCoordinate(sampleZone.LO);
    const debugKey = `${plotWidth}x${plotHeight}|dpr=${dpr}|${sampleZone.id}|${
      sampleYHi !== null ? Math.round(sampleYHi) : 'null'
    }-${sampleYLo !== null ? Math.round(sampleYLo) : 'null'}`;
    if (debugKey !== lastDebugLogKey) {
      lastDebugLogKey = debugKey;
      console.debug('[FireZoneOverlay]', {
        plotArea: { plotWidth, plotHeight, totalWidth, totalHeight },
        devicePixelRatio: dpr,
        zoneCount: model.zones.length,
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

  const priceScaleTags: Array<{
    text: string;
    y: number;
    borderColor: string;
    textColor: string;
    bgColor?: string;
  }> = [];

  // Clip plot drawing to the candlestick plot area (0..plotWidth, 0..plotHeight)
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, plotWidth, plotHeight);
  ctx.clip();

  const ts = chart.timeScale();

  // 1. Draw LEVEL walls as thin dashed lines (1px): KEY yellow, MAJOR purple, MINOR hidden on chart
  for (const lvl of model.levels) {
    if (lvl.importance === 'MINOR') continue; // MINOR hidden on chart, kept in ladder

    const y = series.priceToCoordinate(lvl.price);
    if (y === null || y < 6 || y > plotHeight - 6) continue;
    const color = lvl.importance === 'KEY' ? '#f5b842' : '#a855f7';

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotWidth, y);
    ctx.stroke();

    ctx.font = `bold 9px 'JetBrains Mono', monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`LEVEL ${lvl.rank}`, plotWidth - 5, y - 2);
    ctx.restore();
  }

  // 2. Draw EVERY zone from model.zones (faint fill + TWO dotted horizontal border lines HI & LO)
  for (const z of model.zones) {
    const yHi = series.priceToCoordinate(z.HI);
    const yLo = series.priceToCoordinate(z.LO);
    if (yHi === null || yLo === null) continue;

    const rawTop = Math.min(yHi, yLo);
    const rawBot = Math.max(yHi, yLo);

    // Zones outside the visible price range are not drawn on the canvas (shown as edge badges)
    if (rawBot < 0 || rawTop > plotHeight) continue;

    const yTop = Math.max(0, rawTop);
    const yBot = Math.min(plotHeight, rawBot);
    const boxH = Math.max(3, yBot - yTop);

    const xStart = resolveZoneAnchorX(chart, z, candles, plotWidth);
    const boxW = Math.max(12, plotWidth - xStart);

    const isSell = z.side === 'SELL';
    const borderColor = isSell ? '#ff5d6c' : '#2ee6a0';
    const fillColor = isSell ? 'rgba(255,93,108,0.06)' : 'rgba(46,230,160,0.06)';
    const zoneAlpha = z.type === 'DEEP' ? 0.55 : 1.0;

    ctx.save();
    ctx.globalAlpha = zoneAlpha;

    // Very faint fill
    ctx.fillStyle = fillColor;
    ctx.fillRect(xStart, yTop, boxW, boxH);

    // Pulsing gold outline for the ACTIVE nearest zone
    if (z.isActive) {
      ctx.save();
      const glowBlur = 6 + Math.sin(pulsePhase) * 4;
      ctx.shadowColor = 'rgba(245, 184, 66, 0.78)';
      ctx.shadowBlur = glowBlur;
      ctx.strokeStyle = '#f5b842';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.strokeRect(xStart + 0.5, yTop, Math.max(2, boxW - 1), boxH);
      ctx.restore();
    }

    // TWO dotted horizontal border lines (HI and LO), 1.5px, from anchor candle to right edge
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 3]);

    if (rawTop >= 0 && rawTop <= plotHeight) {
      ctx.beginPath();
      ctx.moveTo(xStart, rawTop);
      ctx.lineTo(plotWidth, rawTop);
      ctx.stroke();
    }

    if (rawBot >= 0 && rawBot <= plotHeight) {
      ctx.beginPath();
      ctx.moveTo(xStart, rawBot);
      ctx.lineTo(plotWidth, rawBot);
      ctx.stroke();
    }

    // Label above the top line, bold 11px mono, left side of the visible area:
    // "FIRE ZONE BUY 4003.91 - CRITICAL - NEAREST" (add ⭐ for the star zone)
    const starText = z.isStar ? ' ⭐' : '';
    const labelText = `FIRE ZONE ${z.side} ${z.anchor.toFixed(2)} - ${z.strength} - ${z.type}${starText}`;
    ctx.font = `bold 11px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    const labelX = 8;
    const labelY = Math.max(14, yTop - 3);
    const textMetrics = ctx.measureText(labelText);

    // Subtle dark backing pill behind label so candles never obscure the zone title
    ctx.fillStyle = 'rgba(8, 8, 11, 0.78)';
    ctx.fillRect(labelX - 3, labelY - 12, textMetrics.width + 6, 14);

    ctx.fillStyle = z.isActive ? '#f5b842' : borderColor;
    ctx.fillText(labelText, labelX, labelY);
    ctx.restore();

    // Queue right-aligned price scale tags for HI and LO
    priceScaleTags.push(
      {
        text: z.HI.toFixed(2),
        y: rawTop,
        borderColor,
        textColor: borderColor,
      },
      {
        text: z.LO.toFixed(2),
        y: rawBot,
        borderColor,
        textColor: borderColor,
      }
    );
  }

  // 3. Draw MARKET STRUCTURE (last 8 internal breaks, last 6 swing breaks)
  if (toggles.showInternal) {
    const internalBreaks = model.structureBreaks.internal.slice(-8);
    for (const brk of internalBreaks) {
      drawStructureBreakSegment(ctx, chart, series, brk, plotWidth, plotHeight);
    }
  }

  if (toggles.showSwing) {
    const swingBreaks = model.structureBreaks.swing.slice(-6);
    for (const brk of swingBreaks) {
      drawStructureBreakSegment(ctx, chart, series, brk, plotWidth, plotHeight);
    }
  }

  // Optional HH / HL / LH / LL swing point labels (8px, muted)
  if (toggles.showLabels) {
    const swingPts = model.structureBreaks.confirmedSwingPivots.slice(-20);
    ctx.save();
    ctx.font = `bold 8px 'JetBrains Mono', monospace`;
    ctx.fillStyle = 'rgba(214, 208, 196, 0.65)';
    ctx.textAlign = 'center';

    for (const pt of swingPts) {
      if (!pt.swingTag) continue;
      const x = ts.timeToCoordinate(pt.time as UTCTimestamp);
      const y = series.priceToCoordinate(pt.price);
      if (x === null || y === null || x < 8 || x > plotWidth - 8 || y < 10 || y > plotHeight - 10) {
        continue;
      }
      ctx.textBaseline = pt.type === 'HIGH' ? 'bottom' : 'top';
      ctx.fillText(pt.swingTag, x, pt.type === 'HIGH' ? y - 4 : y + 4);
    }
    ctx.restore();
  }

  // 4. Draw Active Plan (ENTRY, SL, TP1-TP3) as short lines with price tags at the right edge, inside the canvas
  for (const item of model.planLines) {
    const y = series.priceToCoordinate(item.price);
    if (y === null || y < 8 || y > plotHeight - 8) continue;

    const lineStartX = Math.max(0, plotWidth - 96);
    ctx.save();
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 1.25;
    ctx.setLineDash(item.dashed ? [3, 3] : []);
    ctx.beginPath();
    ctx.moveTo(lineStartX, y);
    ctx.lineTo(plotWidth, y);
    ctx.stroke();

    ctx.font = `bold 9px 'JetBrains Mono', monospace`;
    const tagMetrics = ctx.measureText(item.label);
    ctx.fillStyle = 'rgba(8, 8, 11, 0.84)';
    ctx.fillRect(plotWidth - tagMetrics.width - 10, y - 12, tagMetrics.width + 6, 11);

    ctx.fillStyle = item.color;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(item.label, plotWidth - 6, y - 2);
    ctx.restore();
  }

  // 5. Visible dev test / live anchor: 1px solid gold line at currentPrice across plot area
  if (model.currentPrice > 0) {
    const yNow = series.priceToCoordinate(model.currentPrice);
    if (yNow !== null && yNow >= 0 && yNow <= plotHeight) {
      ctx.save();
      ctx.strokeStyle = '#f5b842';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(0, yNow);
      ctx.lineTo(plotWidth, yNow);
      ctx.stroke();
      ctx.restore();

      priceScaleTags.push({
        text: model.currentPrice.toFixed(2),
        y: yNow,
        borderColor: '#f5b842',
        textColor: '#060608',
        bgColor: '#f5b842',
      });
    }
  }

  ctx.restore(); // End plot-area clip

  // 6. Draw right-aligned HI / LO / NOW price tags on the right price scale column
  for (const tag of priceScaleTags) {
    drawPriceScaleTag(
      ctx,
      tag.text,
      tag.y,
      plotWidth,
      totalWidth,
      plotHeight,
      tag.borderColor,
      tag.textColor,
      tag.bgColor
    );
  }
}
