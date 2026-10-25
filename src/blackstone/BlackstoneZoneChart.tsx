import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { BlackstoneEvaluatedZone, BlackstoneZoneId } from '../server/blackstoneEngine';
import type { LivePlanTrade } from '../server/blackstonePlanEngine';

export interface BlackstoneCandle {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
}

export type BlackstoneChartTimeframe = 'M5' | 'M15' | 'H1';

interface BlackstoneZoneChartProps {
  candles: BlackstoneCandle[];
  zones: BlackstoneEvaluatedZone[];
  selectedZoneId: BlackstoneZoneId | null;
  onSelectZone: (id: BlackstoneZoneId) => void;
  timeframe: BlackstoneChartTimeframe;
  onChangeTimeframe: (tf: BlackstoneChartTimeframe) => void;
  lockTimeIso: string;
  openTimeIso: string;
  livePrice: number | null;
  isFeedLive: boolean;
  isMarketClosed: boolean;
  activeTrade?: LivePlanTrade | null;
  newsPauseNotice?: string | null;
}

const TIMEFRAMES: BlackstoneChartTimeframe[] = ['M5', 'M15', 'H1'];

function formatDubaiTime(iso: string): string {
  const ms = new Date(iso).getTime();
  if (isNaN(ms)) return '';
  const d = new Date(ms + 4 * 60 * 60 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

interface GutterBadge {
  id: string;
  desiredY: number;
  y: number;
  height: number;
  color: string;
  bgColor: string;
  borderColor: string;
  render: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;
}

interface DistantZoneHint {
  zone: BlackstoneEvaluatedZone;
  direction: 'ABOVE' | 'BELOW';
  distanceDollars: number;
  label: string;
  rect?: { x: number; y: number; w: number; h: number };
}

export const BlackstoneZoneChart: React.FC<BlackstoneZoneChartProps> = ({
  candles,
  zones,
  selectedZoneId,
  onSelectZone,
  timeframe,
  onChangeTimeframe,
  lockTimeIso,
  livePrice,
  isFeedLive,
  isMarketClosed,
  activeTrade,
  newsPauseNotice,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zoneHitRectsRef = useRef<Array<{ id: BlackstoneZoneId; yTop: number; yBottom: number }>>([]);
  const hintHitRectsRef = useRef<Array<{ id: BlackstoneZoneId; x: number; y: number; w: number; h: number }>>([]);

  // Merge live price tick into local real-time candle state
  const [liveCandles, setLiveCandles] = useState<BlackstoneCandle[]>(candles);

  useEffect(() => {
    setLiveCandles(candles);
  }, [candles]);

  // Real-time tick update on the latest candle in the active timeframe
  useEffect(() => {
    if (!isFeedLive || livePrice === null || livePrice <= 0) return;

    setLiveCandles((prev) => {
      if (!prev || prev.length === 0) return prev;
      const periodMinutes = timeframe === 'M5' ? 5 : timeframe === 'M15' ? 15 : 60;
      const periodMs = periodMinutes * 60 * 1000;
      const nowMs = Date.now();
      const currentBucketMs = Math.floor(nowMs / periodMs) * periodMs;
      const currentBucketIso = new Date(currentBucketMs).toISOString();

      const copy = [...prev];
      const last = copy[copy.length - 1];
      const lastBarTime = new Date(last.openTime).getTime();

      if (last.openTime === currentBucketIso || lastBarTime === currentBucketMs) {
        copy[copy.length - 1] = {
          ...last,
          high: Math.max(last.high, livePrice),
          low: Math.min(last.low, livePrice),
          close: livePrice,
          isClosed: false,
        };
        return copy;
      } else if (currentBucketMs > lastBarTime) {
        // Real period ended: mark previous candle closed, start fresh candle
        copy[copy.length - 1] = { ...last, isClosed: true };
        copy.push({
          openTime: currentBucketIso,
          open: livePrice,
          high: livePrice,
          low: livePrice,
          close: livePrice,
          volume: 1,
          isClosed: false,
        });
        return copy.slice(-160);
      }
      return prev;
    });
  }, [livePrice, isFeedLive, timeframe]);

  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(300, container.clientWidth || 740);
    const plotHeight = 500;
    const timeAxisHeight = 28;
    const totalHeight = plotHeight + timeAxisHeight;

    // Responsive right gutter width so chart stays readable on 400px phones
    const rightAxisWidth = width < 480 ? 116 : 146;
    const plotWidth = Math.max(150, width - rightAxisWidth);

    if (canvas.width !== width * dpr || canvas.height !== totalHeight * dpr) {
      canvas.width = width * dpr;
      canvas.height = totalHeight * dpr;
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // Canvas background (#07090f Nova deep space)
    ctx.fillStyle = '#07090f';
    ctx.fillRect(0, 0, width, totalHeight);

    // Plot area background
    ctx.fillStyle = '#07090f';
    ctx.fillRect(0, 0, plotWidth, plotHeight);

    // Right gutter background
    ctx.fillStyle = '#0b0e18';
    ctx.fillRect(plotWidth, 0, rightAxisWidth, plotHeight);

    // Visible candles count: large, clear candles
    const maxBars = width < 480 ? 28 : 42;
    const visibleCandles = liveCandles.slice(-maxBars);
    const refPrice =
      isFeedLive && livePrice && livePrice > 0
        ? livePrice
        : visibleCandles.length > 0
          ? visibleCandles[visibleCandles.length - 1].close
          : null;

    if (!refPrice || visibleCandles.length === 0) {
      ctx.fillStyle = '#8d97b8';
      ctx.font = '12px "Sora", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        'Waiting for stored candle history from Ahmad server...',
        plotWidth / 2,
        plotHeight / 2
      );
      ctx.restore();
      return;
    }

    // 1. PRICE SCALE: About $28 around live price, widened ONLY to include nearest zone above and below
    let minPrice = refPrice - 14.0;
    let maxPrice = refPrice + 14.0;

    // Nearest zone above live price
    const aboveZones = zones
      .filter((z) => z.level >= refPrice)
      .sort((a, b) => a.level - b.level);
    const nearestAbove = aboveZones[0] || null;

    // Nearest zone below live price
    const belowZones = zones
      .filter((z) => z.level < refPrice)
      .sort((a, b) => b.level - a.level);
    const nearestBelow = belowZones[0] || null;

    // Widened ONLY to include the nearest zone above and below
    if (nearestAbove && nearestAbove.high > maxPrice) {
      maxPrice = nearestAbove.high + 1.5;
    }
    if (nearestBelow && nearestBelow.low < minPrice) {
      minPrice = nearestBelow.low - 1.5;
    }

    // Include active trade boundaries if live
    if (activeTrade && activeTrade.status === 'ACTIVE') {
      const tradePrices = [
        activeTrade.entryPrice,
        activeTrade.currentStopLoss,
        activeTrade.tp1.price,
        activeTrade.tp2.price,
        activeTrade.tp3.price,
      ].filter((p) => typeof p === 'number' && p > 0);
      for (const p of tradePrices) {
        if (p < minPrice) minPrice = p - 1.0;
        if (p > maxPrice) maxPrice = p + 1.0;
      }
    }

    const priceSpan = Math.max(20.0, maxPrice - minPrice);
    const yMin = minPrice;
    const yMax = minPrice + priceSpan;

    const priceToY = (p: number): number => {
      const ratio = (yMax - p) / (yMax - yMin);
      return Math.max(12, Math.min(plotHeight - 12, ratio * plotHeight));
    };

    // 2. Subtle horizontal price grid lines across plot
    const gridSteps = 6;
    ctx.strokeStyle = 'rgba(140, 160, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < gridSteps; i++) {
      const p = yMin + ((yMax - yMin) * i) / gridSteps;
      const y = Math.round(priceToY(p)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotWidth, y);
      ctx.stroke();

      ctx.fillStyle = '#8d97b8';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(p.toFixed(1), plotWidth + 6, y + 3.5);
    }

    // 3. ZONE BANDS: sell side coral (#ff6b7f), buy side mint (#4df0b4), light fill, thin edges
    // Zones further away are NOT drawn as bands.
    const drawnZones: BlackstoneEvaluatedZone[] = [];
    const distantAboveHints: DistantZoneHint[] = [];
    const distantBelowHints: DistantZoneHint[] = [];

    for (const z of zones) {
      const inVisibleRange = z.low <= yMax && z.high >= yMin;
      if (inVisibleRange) {
        drawnZones.push(z);
      } else if (z.level > yMax) {
        const diff = Math.round(z.level - refPrice);
        const nameText = z.isSarrafCore ? 'Sarraf Core' : z.name;
        distantAboveHints.push({
          zone: z,
          direction: 'ABOVE',
          distanceDollars: diff,
          label: `${nameText} ${z.level.toFixed(2)} +$${diff}`,
        });
      } else if (z.level < yMin) {
        const diff = Math.round(refPrice - z.level);
        const nameText = z.isSarrafCore ? 'Sarraf Core' : z.name;
        distantBelowHints.push({
          zone: z,
          direction: 'BELOW',
          distanceDollars: diff,
          label: `${nameText} ${z.level.toFixed(2)} -$${diff}`,
        });
      }
    }

    const hitRects: Array<{ id: BlackstoneZoneId; yTop: number; yBottom: number }> = [];

    // Draw visible zone bands across plot
    for (const z of drawnZones) {
      const rawTop = priceToY(z.high);
      const rawBottom = priceToY(z.low);
      const yCenter = priceToY(z.level);

      const minBandHeight = 14;
      const naturalHeight = Math.abs(rawBottom - rawTop);
      const bandHeight = Math.max(minBandHeight, naturalHeight);
      const yTop =
        naturalHeight < minBandHeight
          ? yCenter - minBandHeight / 2
          : Math.min(rawTop, rawBottom);
      const yBottom = yTop + bandHeight;

      hitRects.push({ id: z.id, yTop: yTop - 3, yBottom: yBottom + 3 });

      const isSelected = selectedZoneId === z.id;
      const isBuy = z.side === 'buy side';
      const isCore = z.isSarrafCore;

      // Sell side coral (#ff6b7f), Buy side mint (#4df0b4), light fill
      const fillRgba = isBuy
        ? isSelected
          ? 'rgba(77, 240, 180, 0.18)'
          : 'rgba(77, 240, 180, 0.08)'
        : isSelected
          ? 'rgba(255, 107, 127, 0.18)'
          : 'rgba(255, 107, 127, 0.08)';

      // Thin hairline boundary strokes
      const strokeColor = isBuy
        ? isSelected
          ? '#4df0b4'
          : 'rgba(77, 240, 180, 0.55)'
        : isSelected
          ? '#ff6b7f'
          : 'rgba(255, 107, 127, 0.55)';

      // Band fill across plot width
      ctx.fillStyle = fillRgba;
      ctx.fillRect(0, yTop, plotWidth, bandHeight);

      // Top and bottom thin edges
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = isSelected ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(0, yTop);
      ctx.lineTo(plotWidth, yTop);
      ctx.moveTo(0, yBottom);
      ctx.lineTo(plotWidth, yBottom);
      ctx.stroke();

      // Core accent indicator line on left edge if Sarraf Core
      if (isCore) {
        ctx.fillStyle = '#52e3ff';
        ctx.fillRect(0, yTop, 3.5, bandHeight);
      }
    }

    zoneHitRectsRef.current = hitRects;

    // 4. DRAW CANDLES: large and clear
    const leftPad = 12;
    const rightPad = 12;
    const usablePlotW = Math.max(60, plotWidth - leftPad - rightPad);
    const stepX = usablePlotW / visibleCandles.length;
    const bodyWidth = Math.max(5.5, Math.min(13, stepX * 0.70));

    const lockMs = new Date(lockTimeIso).getTime();
    let lockMarkerX: number | null = null;

    for (let i = 0; i < visibleCandles.length; i++) {
      const c = visibleCandles[i];
      const barMs = new Date(c.openTime).getTime();
      const prevMs = i > 0 ? new Date(visibleCandles[i - 1].openTime).getTime() : -Infinity;
      const cx = leftPad + i * stepX + stepX / 2;

      if (!isNaN(lockMs) && lockMarkerX === null) {
        if (barMs === lockMs || (prevMs < lockMs && barMs >= lockMs)) {
          lockMarkerX = cx;
        }
      }

      const yHigh = priceToY(c.high);
      const yLow = priceToY(c.low);
      const yOpen = priceToY(c.open);
      const yClose = priceToY(c.close);

      const isBull = c.close >= c.open;
      const candleColor = isBull ? '#4df0b4' : '#ff6b7f';

      // Wick
      ctx.strokeStyle = candleColor;
      ctx.lineWidth = 1.35;
      ctx.beginPath();
      ctx.moveTo(cx, yHigh);
      ctx.lineTo(cx, yLow);
      ctx.stroke();

      // Body (large and clear)
      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(2, Math.abs(yClose - yOpen));
      ctx.fillStyle = candleColor;
      ctx.fillRect(cx - bodyWidth / 2, bodyTop, bodyWidth, bodyH);

      // Time axis ticks at bottom in Dubai time
      const tickEvery = Math.max(5, Math.floor(visibleCandles.length / 5));
      if (i % tickEvery === 0 || i === visibleCandles.length - 1) {
        ctx.fillStyle = '#8d97b8';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(formatDubaiTime(c.openTime), cx, plotHeight + 17);
      }
    }

    // 04:00 Lock Marker pip at bottom
    if (lockMarkerX !== null) {
      ctx.save();
      ctx.fillStyle = '#52e3ff';
      ctx.beginPath();
      ctx.moveTo(lockMarkerX - 3.5, plotHeight);
      ctx.lineTo(lockMarkerX + 3.5, plotHeight);
      ctx.lineTo(lockMarkerX, plotHeight - 5);
      ctx.closePath();
      ctx.fill();

      const chipW = 64;
      const chipX = Math.max(4, Math.min(plotWidth - chipW - 4, lockMarkerX - chipW / 2));
      ctx.fillStyle = 'rgba(82, 227, 255, 0.16)';
      ctx.fillRect(chipX, plotHeight + 4, chipW, 16);
      ctx.strokeStyle = 'rgba(82, 227, 255, 0.65)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(chipX, plotHeight + 4, chipW, 16);

      ctx.fillStyle = '#52e3ff';
      ctx.font = '700 8.5px "Sora", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('04:00 LOCK', chipX + chipW / 2, plotHeight + 15);
      ctx.restore();
    }

    // 5. DISTANT ZONE HINTS: Small text hints inside the chart at the top or bottom edge
    // e.g. "Sarraf Core 4057.04 +$61"
    const hintRects: Array<{ id: BlackstoneZoneId; x: number; y: number; w: number; h: number }> = [];

    // Top edge distant hints
    if (distantAboveHints.length > 0) {
      let hintX = 10;
      const hintY = 10;
      const sortedAbove = [...distantAboveHints].sort((a, b) => a.zone.level - b.zone.level);

      for (const hint of sortedAbove.slice(0, 3)) {
        ctx.font = '600 10px "JetBrains Mono", monospace';
        const textWidth = ctx.measureText(hint.label).width;
        const pillW = textWidth + 18;
        const pillH = 20;

        if (hintX + pillW > plotWidth - 8) break;

        const isCore = hint.zone.isSarrafCore;
        ctx.fillStyle = 'rgba(18, 22, 34, 0.92)';
        ctx.fillRect(hintX, hintY, pillW, pillH);
        ctx.strokeStyle = isCore ? 'rgba(82, 227, 255, 0.65)' : 'rgba(255, 107, 127, 0.55)';
        ctx.lineWidth = 0.85;
        ctx.strokeRect(hintX, hintY, pillW, pillH);

        if (isCore) {
          ctx.fillStyle = '#52e3ff';
          ctx.beginPath();
          ctx.arc(hintX + 7, hintY + pillH / 2, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = isCore ? '#52e3ff' : '#ff6b7f';
        ctx.textAlign = 'left';
        ctx.fillText(hint.label, hintX + (isCore ? 14 : 9), hintY + 14);

        hintRects.push({
          id: hint.zone.id,
          x: hintX,
          y: hintY,
          w: pillW,
          h: pillH,
        });

        hintX += pillW + 8;
      }
    }

    // Bottom edge distant hints
    if (distantBelowHints.length > 0) {
      let hintX = 10;
      const hintY = plotHeight - 30;
      const sortedBelow = [...distantBelowHints].sort((a, b) => b.zone.level - a.zone.level);

      for (const hint of sortedBelow.slice(0, 3)) {
        ctx.font = '600 10px "JetBrains Mono", monospace';
        const textWidth = ctx.measureText(hint.label).width;
        const pillW = textWidth + 18;
        const pillH = 20;

        if (hintX + pillW > plotWidth - 8) break;

        const isCore = hint.zone.isSarrafCore;
        ctx.fillStyle = 'rgba(18, 22, 34, 0.92)';
        ctx.fillRect(hintX, hintY, pillW, pillH);
        ctx.strokeStyle = isCore ? 'rgba(82, 227, 255, 0.65)' : 'rgba(77, 240, 180, 0.55)';
        ctx.lineWidth = 0.85;
        ctx.strokeRect(hintX, hintY, pillW, pillH);

        if (isCore) {
          ctx.fillStyle = '#52e3ff';
          ctx.beginPath();
          ctx.arc(hintX + 7, hintY + pillH / 2, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = isCore ? '#52e3ff' : '#4df0b4';
        ctx.textAlign = 'left';
        ctx.fillText(hint.label, hintX + (isCore ? 14 : 9), hintY + 14);

        hintRects.push({
          id: hint.zone.id,
          x: hintX,
          y: hintY,
          w: pillW,
          h: pillH,
        });

        hintX += pillW + 8;
      }
    }

    hintHitRectsRef.current = hintRects;

    // 6. LIVE PRICE TAG IN ACCENT COLOUR (#52e3ff) WITH DOTTED LINE
    const yLive = priceToY(refPrice);
    ctx.save();
    ctx.strokeStyle = isFeedLive ? 'rgba(82, 227, 255, 0.65)' : 'rgba(141, 151, 184, 0.45)';
    ctx.lineWidth = 1.1;
    ctx.setLineDash([2, 3]); // dotted line across plot
    ctx.beginPath();
    ctx.moveTo(0, yLive);
    ctx.lineTo(plotWidth, yLive);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 7. ACTIVE TRADE LINES (Entry, SL, TP1, TP2, TP3 as dashed lines)
    if (activeTrade && activeTrade.status === 'ACTIVE') {
      const drawDashedTradeLine = (price: number, color: string) => {
        const y = priceToY(price);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.35;
        ctx.setLineDash([4, 3]); // dashed line
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotWidth, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      };

      drawDashedTradeLine(activeTrade.entryPrice, '#52e3ff');
      drawDashedTradeLine(activeTrade.currentStopLoss, '#ff6b7f');
      drawDashedTradeLine(activeTrade.tp1.price, '#4df0b4');
      drawDashedTradeLine(activeTrade.tp2.price, '#4df0b4');
      drawDashedTradeLine(activeTrade.tp3.price, '#52e3ff');
    }

    // 8. RIGHT GUTTER BADGES WITH NO-OVERLAP COLLISION AVOIDANCE
    const gutterBadges: GutterBadge[] = [];

    // Live price badge in accent cyan (#52e3ff)
    gutterBadges.push({
      id: 'LIVE_PRICE',
      desiredY: yLive,
      y: yLive,
      height: 22,
      color: '#07090f',
      bgColor: isFeedLive ? '#52e3ff' : '#1e2436',
      borderColor: '#52e3ff',
      render: (c, x, y, w, h) => {
        c.fillStyle = isFeedLive ? '#52e3ff' : '#1e2436';
        c.fillRect(x, y, w, h);
        c.strokeStyle = '#52e3ff';
        c.lineWidth = 1;
        c.strokeRect(x, y, w, h);

        c.fillStyle = isFeedLive ? '#07090f' : '#e9edff';
        c.font = isFeedLive
          ? '700 11px "JetBrains Mono", monospace'
          : '600 9.5px "Sora", sans-serif';
        c.textAlign = 'center';
        const tagText = isMarketClosed
          ? 'Market Closed'
          : !isFeedLive
            ? 'Feed Stale'
            : refPrice.toFixed(2);
        c.fillText(tagText, x + w / 2, y + 15);
      },
    });

    // Visible zone badges
    for (const z of drawnZones) {
      const isSelected = selectedZoneId === z.id;
      const isBuy = z.side === 'buy side';
      const isCore = z.isSarrafCore;
      const yCenter = priceToY(z.level);
      const accent = isBuy ? '#4df0b4' : '#ff6b7f';

      gutterBadges.push({
        id: z.id,
        desiredY: yCenter,
        y: yCenter,
        height: 28,
        color: accent,
        bgColor: isSelected ? 'rgba(26, 32, 48, 0.98)' : 'rgba(18, 22, 34, 0.92)',
        borderColor: isSelected
          ? '#52e3ff'
          : isBuy
            ? 'rgba(77, 240, 180, 0.55)'
            : 'rgba(255, 107, 127, 0.55)',
        render: (c, x, y, w, h) => {
          c.fillStyle = isSelected ? 'rgba(26, 32, 48, 0.98)' : 'rgba(18, 22, 34, 0.92)';
          c.fillRect(x, y, w, h);
          c.strokeStyle = isSelected
            ? '#52e3ff'
            : isBuy
              ? 'rgba(77, 240, 180, 0.55)'
              : 'rgba(255, 107, 127, 0.55)';
          c.lineWidth = isSelected ? 1.5 : 0.9;
          c.strokeRect(x, y, w, h);

          // Line 1: [Grade] Name [Core tag]
          const isGradeA = z.grade === 'A';
          c.fillStyle = isGradeA ? '#52e3ff' : 'rgba(140, 160, 255, 0.2)';
          c.fillRect(x + 4, y + 3.5, 13, 10.5);
          c.fillStyle = isGradeA ? '#07090f' : '#e9edff';
          c.font = '700 8px "Sora", sans-serif';
          c.textAlign = 'center';
          c.fillText(z.grade, x + 4 + 6.5, y + 11.5);

          c.fillStyle = isSelected ? '#e9edff' : accent;
          c.font = '600 9px "Sora", sans-serif';
          c.textAlign = 'left';
          const displayName = isCore ? `${z.name} ★` : z.name;
          c.fillText(displayName, x + 20, y + 12);

          // Line 2: Price level
          c.fillStyle = '#e9edff';
          c.font = '600 10px "JetBrains Mono", monospace';
          c.textAlign = 'left';
          c.fillText(z.level.toFixed(2), x + 4, y + 23);

          // Status label
          c.fillStyle = z.touches > 0 ? '#52e3ff' : '#4df0b4';
          c.font = '600 8px "Sora", sans-serif';
          c.textAlign = 'right';
          c.fillText(z.touches > 0 ? 'TESTED' : 'FRESH', x + w - 4, y + 23);
        },
      });
    }

    // Active trade badges
    if (activeTrade && activeTrade.status === 'ACTIVE') {
      const addTradeBadge = (id: string, price: number, label: string, color: string) => {
        const y = priceToY(price);
        gutterBadges.push({
          id,
          desiredY: y,
          y,
          height: 18,
          color,
          bgColor: 'rgba(18, 22, 34, 0.96)',
          borderColor: color,
          render: (c, x, yBadge, w, h) => {
            c.fillStyle = 'rgba(18, 22, 34, 0.96)';
            c.fillRect(x, yBadge, w, h);
            c.strokeStyle = color;
            c.lineWidth = 1;
            c.strokeRect(x, yBadge, w, h);

            c.fillStyle = color;
            c.font = '700 8.5px "JetBrains Mono", monospace';
            c.textAlign = 'center';
            c.fillText(`${label} ${price.toFixed(1)}`, x + w / 2, yBadge + 12.5);
          },
        });
      };

      addTradeBadge('TRADE_ENTRY', activeTrade.entryPrice, `ENTRY (${activeTrade.side})`, '#52e3ff');
      addTradeBadge(
        'TRADE_SL',
        activeTrade.currentStopLoss,
        activeTrade.beMoved ? 'BE STOP' : 'SL (-1R)',
        '#ff6b7f'
      );
      addTradeBadge('TRADE_TP1', activeTrade.tp1.price, activeTrade.tp1.hit ? 'TP1 HIT' : 'TP1 (+10)', '#4df0b4');
      addTradeBadge('TRADE_TP2', activeTrade.tp2.price, activeTrade.tp2.hit ? 'TP2 HIT' : 'TP2 (+17)', '#4df0b4');
      addTradeBadge('TRADE_TP3', activeTrade.tp3.price, activeTrade.tp3.capped ? 'TP3 (CAP)' : 'TP3 (+25)', '#52e3ff');
    }

    // RESOLVE OVERLAPS: Sort badges by desiredY and enforce minimum spacing
    gutterBadges.sort((a, b) => a.desiredY - b.desiredY);
    for (let i = 0; i < gutterBadges.length; i++) {
      gutterBadges[i].y = gutterBadges[i].desiredY - gutterBadges[i].height / 2;
    }

    const minGap = 3;
    // Forward pass
    for (let i = 1; i < gutterBadges.length; i++) {
      const prevBottom = gutterBadges[i - 1].y + gutterBadges[i - 1].height;
      if (gutterBadges[i].y < prevBottom + minGap) {
        gutterBadges[i].y = prevBottom + minGap;
      }
    }

    // Backward pass (ensure within plotHeight bounds)
    const maxBottom = plotHeight - 4;
    if (
      gutterBadges.length > 0 &&
      gutterBadges[gutterBadges.length - 1].y + gutterBadges[gutterBadges.length - 1].height > maxBottom
    ) {
      gutterBadges[gutterBadges.length - 1].y =
        maxBottom - gutterBadges[gutterBadges.length - 1].height;
      for (let i = gutterBadges.length - 2; i >= 0; i--) {
        const nextTop = gutterBadges[i + 1].y;
        if (gutterBadges[i].y + gutterBadges[i].height > nextTop - minGap) {
          gutterBadges[i].y = nextTop - minGap - gutterBadges[i].height;
        }
      }
    }

    // Top clamp
    if (gutterBadges.length > 0 && gutterBadges[0].y < 4) {
      gutterBadges[0].y = 4;
      for (let i = 1; i < gutterBadges.length; i++) {
        const prevBottom = gutterBadges[i - 1].y + gutterBadges[i - 1].height;
        if (gutterBadges[i].y < prevBottom + minGap) {
          gutterBadges[i].y = prevBottom + minGap;
        }
      }
    }

    // Draw non-overlapping gutter badges
    const badgeX = plotWidth + 4;
    const badgeW = rightAxisWidth - 8;
    for (const badge of gutterBadges) {
      badge.render(ctx, badgeX, badge.y, badgeW, badge.height);
    }

    // 9. NEWS PAUSE STRIP ON CHART
    if (newsPauseNotice) {
      ctx.save();
      const stripH = 22;
      const stripY = 8;
      ctx.fillStyle = 'rgba(255, 107, 127, 0.92)';
      ctx.fillRect(8, stripY, plotWidth - 16, stripH);
      ctx.strokeStyle = '#ff6b7f';
      ctx.lineWidth = 1;
      ctx.strokeRect(8, stripY, plotWidth - 16, stripH);

      ctx.fillStyle = '#07090f';
      ctx.font = '700 10px "Sora", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`News pause: ${newsPauseNotice}`, plotWidth / 2, stripY + 15);
      ctx.restore();
    }

    // Axis boundary divider lines
    ctx.strokeStyle = 'rgba(140, 160, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotWidth, 0);
    ctx.lineTo(plotWidth, totalHeight);
    ctx.moveTo(0, plotHeight);
    ctx.lineTo(width, plotHeight);
    ctx.stroke();

    ctx.restore();
  }, [
    liveCandles,
    zones,
    selectedZoneId,
    lockTimeIso,
    livePrice,
    isFeedLive,
    isMarketClosed,
    activeTrade,
    newsPauseNotice,
  ]);

  useEffect(() => {
    drawChart();
    const handleResize = () => drawChart();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [drawChart]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 1. Check distant zone hints clicked
    for (const hint of hintHitRectsRef.current) {
      if (x >= hint.x && x <= hint.x + hint.w && y >= hint.y && y <= hint.y + hint.h) {
        onSelectZone(hint.id);
        return;
      }
    }

    // 2. Check zone bands / badges clicked
    for (const hit of zoneHitRectsRef.current) {
      if (y >= hit.yTop && y <= hit.yBottom) {
        onSelectZone(hit.id);
        return;
      }
    }
  };

  return (
    <div
      className="rounded-[18px] p-4 space-y-3 backdrop-blur-md"
      style={{
        backgroundColor: 'rgba(18, 22, 34, 0.72)',
        border: '1px solid rgba(140, 160, 255, 0.14)',
        fontFamily: "'Sora', sans-serif",
      }}
    >
      {/* Header + Timeframe Buttons: M5, M15, H1 */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 pb-3"
        style={{ borderBottom: '1px solid rgba(140, 160, 255, 0.14)' }}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#52e3ff]">
            ZONES CHART
          </h2>
          <span className="text-xs text-[#8d97b8]">
            Real OHLC · Dubai time axis · Live price scale
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Timeframe Buttons: M5, M15, H1 */}
          <div
            className="flex items-center gap-1 rounded-[10px] p-1"
            style={{
              backgroundColor: 'rgba(7, 9, 15, 0.65)',
              border: '1px solid rgba(140, 160, 255, 0.14)',
            }}
          >
            {TIMEFRAMES.map((tf) => {
              const active = timeframe === tf;
              return (
                <button
                  key={tf}
                  type="button"
                  onClick={() => onChangeTimeframe(tf)}
                  className={`px-3 py-1 rounded-[7px] text-xs font-semibold transition-all cursor-pointer ${
                    active
                      ? 'bg-[#52e3ff] text-[#07090f] font-bold shadow-[0_0_12px_rgba(82,227,255,0.35)]'
                      : 'text-[#8d97b8] hover:text-[#e9edff]'
                  }`}
                >
                  {tf}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tall Canvas Chart */}
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-[12px]"
        style={{
          backgroundColor: '#07090f',
          border: '1px solid rgba(140, 160, 255, 0.14)',
        }}
      >
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="w-full h-[528px] block cursor-pointer"
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#8d97b8] pt-0.5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-[3px] bg-[#ff6b7f] inline-block" />
            <span>Sell side</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-[3px] bg-[#4df0b4] inline-block" />
            <span>Buy side</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-[3px] bg-[#52e3ff] inline-block" />
            <span>Sarraf Core / Live</span>
          </span>
        </div>
        <span className="text-[11px] text-[#8d97b8]">
          Tap a zone band or hint to highlight
        </span>
      </div>
    </div>
  );
};
