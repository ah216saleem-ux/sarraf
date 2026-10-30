import React, { useEffect, useRef, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ColorType,
  CrosshairMode,
  UTCTimestamp,
  AutoscaleInfo,
} from 'lightweight-charts';
import { Candle, RedSniperTimeframe } from './feed';
import {
  OpenSniperTrade,
  PendingTradePlan,
  RedSniperZone,
  StructureEvent,
} from './engine';

interface RedSniperChartProps {
  tf: RedSniperTimeframe;
  candles: Candle[];
  atr14: number;
  zones: RedSniperZone[];
  structures: StructureEvent[];
  openTrades: OpenSniperTrade[];
  pendingPlan: PendingTradePlan | null;
  livePrice: number | null;
  isConnected: boolean;
}

const CHART_HEIGHT = 430;

export const RedSniperChart: React.FC<RedSniperChartProps> = ({
  tf,
  candles,
  atr14,
  zones,
  structures,
  openTrades,
  pendingPlan,
  livePrice,
  isConnected,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const prevTfRef = useRef<RedSniperTimeframe>(tf);

  const propsRef = useRef({
    tf,
    candles,
    atr14,
    zones,
    structures,
    openTrades,
    pendingPlan,
    livePrice,
  });
  propsRef.current = {
    tf,
    candles,
    atr14,
    zones,
    structures,
    openTrades,
    pendingPlan,
    livePrice,
  };

  const drawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    const container = containerRef.current;
    if (!canvas || !chart || !series || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = CHART_HEIGHT;

    if (
      canvas.width !== Math.floor(width * dpr) ||
      canvas.height !== Math.floor(height * dpr)
    ) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const priceScaleWidth = chart.priceScale('right').width() || 62;
    const plotRight = Math.max(40, width - priceScaleWidth);
    const plotTop = 4;
    const plotBottom = Math.round(height * 0.8); // Above the volume histogram area

    const {
      candles: curCandles,
      zones: curZones,
      structures: curStructures,
      openTrades: curOpenTrades,
      tf: curTf,
    } = propsRef.current;

    if (!curCandles || curCandles.length === 0) {
      ctx.restore();
      return;
    }

    const timeScale = chart.timeScale();

    const timeToX = (timeSec: number, fallbackIdx?: number): number => {
      const coord = timeScale.timeToCoordinate(timeSec as UTCTimestamp);
      if (coord !== null && Number.isFinite(coord)) return coord;
      if (typeof fallbackIdx === 'number') {
        const logicalCoord = timeScale.logicalToCoordinate(fallbackIdx as any);
        if (logicalCoord !== null && Number.isFinite(logicalCoord)) return logicalCoord;
      }
      return 0;
    };

    // 1. Draw BOS / CHoCH dashed lines from pivot to break bar (clipped to visible price area)
    ctx.lineWidth = 1.2;
    ctx.font = '700 10px "JetBrains Mono", monospace';
    ctx.textBaseline = 'bottom';

    for (const s of curStructures) {
      const y = series.priceToCoordinate(s.price);
      if (y === null || y < plotTop + 8 || y > plotBottom - 8) continue;

      const x1 = timeToX(s.pivotTime, s.pivotIdx);
      const x2 = timeToX(s.breakTime, s.breakIdx);
      if (x2 < 0 || x1 > plotRight) continue;

      const startX = Math.max(0, Math.min(x1, x2));
      const endX = Math.min(plotRight, Math.max(x1, x2));
      if (endX - startX < 4) continue;

      const isBull = s.dir === 'BULL';
      const strokeColor = isBull
        ? s.kind === 'CHoCH'
          ? 'rgba(0, 230, 118, 0.92)'
          : 'rgba(0, 230, 118, 0.65)'
        : s.kind === 'CHoCH'
        ? 'rgba(255, 45, 69, 0.92)'
        : 'rgba(255, 45, 69, 0.65)';

      ctx.strokeStyle = strokeColor;
      ctx.setLineDash(s.kind === 'CHoCH' ? [5, 3] : [3, 3]);
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();

      const midX = (startX + endX) / 2;
      if (midX > 20 && midX < plotRight - 20) {
        ctx.fillStyle = strokeColor;
        ctx.textAlign = 'center';
        ctx.fillText(s.kind, midX, isBull ? y - 2 : y + 11);
      }
    }
    ctx.setLineDash([]);

    // 2. Separate zones into visible (clipped) vs off-screen top / bottom
    const offscreenTop: RedSniperZone[] = [];
    const offscreenBottom: RedSniperZone[] = [];
    const visibleZoneBoxes: Array<{
      zone: RedSniperZone;
      xStart: number;
      boxW: number;
      boxTop: number;
      boxBot: number;
      boxH: number;
    }> = [];

    // Sort by power descending so higher-power zones claim full label first
    const zonesByPower = [...curZones].sort((a, b) => b.power - a.power);

    for (const z of zonesByPower) {
      const yTopRaw = series.priceToCoordinate(z.top);
      const yBotRaw = series.priceToCoordinate(z.bottom);
      if (yTopRaw === null || yBotRaw === null) continue;

      const rawTop = Math.min(yTopRaw, yBotRaw);
      const rawBot = Math.max(yTopRaw, yBotRaw);

      if (rawBot < plotTop + 2) {
        offscreenTop.push(z);
        continue;
      }
      if (rawTop > plotBottom - 2) {
        offscreenBottom.push(z);
        continue;
      }

      // Clip zone box to visible plot vertical bounds
      const boxTop = Math.max(plotTop, rawTop);
      const boxBot = Math.min(plotBottom, rawBot);
      const boxH = Math.max(14, boxBot - boxTop);

      const rawX = timeToX(z.obTime, z.obIdx);
      const xStart = Math.max(0, Math.min(plotRight - 95, rawX));
      const boxW = Math.max(60, plotRight - xStart);

      visibleZoneBoxes.push({
        zone: z,
        xStart,
        boxW,
        boxTop,
        boxBot,
        boxH,
      });
    }

    // Draw visible zone boxes first, then non-overlapping inside labels + right power bar
    const claimedLabelYs: number[] = [];

    for (const item of visibleZoneBoxes) {
      const { zone: z, xStart, boxW, boxTop, boxH } = item;
      const isBull = z.side === 'BULL';
      const fillRgba = isBull ? 'rgba(0, 230, 118, 0.11)' : 'rgba(255, 45, 69, 0.13)';
      const borderHex = isBull ? '#00e676' : '#ff2d45';

      ctx.fillStyle = fillRgba;
      ctx.fillRect(xStart, boxTop, boxW, boxH);

      ctx.strokeStyle = borderHex;
      ctx.lineWidth = 1.25;
      ctx.strokeRect(xStart, boxTop, boxW, boxH);

      // Place label inside the zone box at top-left
      const labelY = Math.min(plotBottom - 4, boxTop + 11);
      const conflictsWithHigherPower = claimedLabelYs.some(
        (existingY) => Math.abs(existingY - labelY) < 14
      );
      claimedLabelYs.push(labelY);

      const labelText = conflictsWithHigherPower
        ? `PWR ${z.power}`
        : `${z.side} · ${z.status} · PWR ${z.power}`;

      const pwrBarW = 28;
      const pwrBarX = plotRight - pwrBarW - 6;
      const pwrBarY = labelY - 7;

      ctx.font = '700 9.5px "JetBrains Mono", monospace';
      const textW = ctx.measureText(labelText).width;
      const labelX = conflictsWithHigherPower
        ? Math.max(xStart + 5, pwrBarX - textW - 6)
        : xStart + 5;

      // Subtle dark backing inside the zone box so text is crisp over candle wicks
      ctx.fillStyle = 'rgba(4, 4, 7, 0.82)';
      ctx.fillRect(labelX - 2, labelY - 9, textW + 4, 11);

      ctx.fillStyle = borderHex;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(labelText, labelX, labelY);

      // Power bar on the right inside the zone box
      if (pwrBarX > xStart + 24) {
        ctx.fillStyle = 'rgba(4, 4, 7, 0.82)';
        ctx.fillRect(pwrBarX - 1, pwrBarY - 1, pwrBarW + 2, 7);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.fillRect(pwrBarX, pwrBarY, pwrBarW, 5);
        ctx.fillStyle = borderHex;
        ctx.fillRect(pwrBarX, pwrBarY, Math.round((z.power / 100) * pwrBarW), 5);
      }
    }

    // Draw small edge markers at top / bottom of chart for off-screen zones
    // e.g. "▲ BEAR 4082-4086 · PWR 92"
    const drawEdgeMarkers = (list: RedSniperZone[], isTop: boolean) => {
      if (list.length === 0) return;
      const topTwo = list.slice(0, 2);
      let cursorX = 8;
      const markerY = isTop ? 15 : plotBottom - 6;

      for (const z of topTwo) {
        const arrow = isTop ? '▲' : '▼';
        const text = `${arrow} ${z.side} ${Math.round(z.bottom)}-${Math.round(z.top)} · PWR ${z.power}`;
        ctx.font = '700 9.5px "JetBrains Mono", monospace';
        const tw = ctx.measureText(text).width + 10;
        if (cursorX + tw > plotRight - 4) break;

        const color = z.side === 'BULL' ? '#00e676' : '#ff2d45';
        ctx.fillStyle = 'rgba(5, 5, 9, 0.92)';
        ctx.fillRect(cursorX, markerY - 10, tw, 13);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(cursorX, markerY - 10, tw, 13);

        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(text, cursorX + 5, markerY);

        cursorX += tw + 6;
      }
    };

    drawEdgeMarkers(offscreenTop, true);
    drawEdgeMarkers(offscreenBottom, false);

    // 3. Draw ENTRY / STOP / T1 / T2 / T3 lines for open trades on this timeframe
    const tradesToDraw = curOpenTrades.filter((t) => t.tf === curTf);

    const drawLevelLine = (
      price: number,
      label: string,
      color: string,
      dashed: boolean = false
    ) => {
      const y = series.priceToCoordinate(price);
      if (y === null || y < plotTop + 4 || y > plotBottom - 4) return;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      if (dashed) ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotRight, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '700 9.5px "JetBrains Mono", monospace';
      const tag = `${label} ${price.toFixed(2)}`;
      const tw = ctx.measureText(tag).width + 8;
      const tx = Math.max(6, plotRight - tw - 4);
      ctx.fillStyle = 'rgba(5, 5, 8, 0.9)';
      ctx.fillRect(tx, y - 11, tw, 12);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.8;
      ctx.strokeRect(tx, y - 11, tw, 12);
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(tag, tx + 4, y - 2);
      ctx.restore();
    };

    for (const tr of tradesToDraw) {
      drawLevelLine(
        tr.entry,
        tr.beMoved ? `${tr.side} ENTRY (BE)` : `${tr.side} ENTRY`,
        '#00e5ff',
        false
      );
      // HIDE the SL line once TP1 is hit and SL is moved to entry (break-even)
      if (!tr.beMoved) {
        drawLevelLine(tr.sl, 'STOP', '#ff2d45', true);
      }
      if (!tr.tp1Hit) {
        drawLevelLine(tr.tp1, 'T1 (1R)', '#00e676', true);
      }
      if (!tr.tp2Hit) {
        drawLevelLine(tr.tp2, 'T2 (2R)', '#00e676', true);
      }
      drawLevelLine(
        tr.tp3,
        tr.tp3IsLiquidity ? 'T3 (LIQ)' : 'T3 (3R)',
        '#ffab00',
        false
      );
    }

    ctx.restore();
  }, []);

  // Initialize chart once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth || 360,
      height: CHART_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: '#030305' },
        textColor: '#8a8f9e',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(255, 45, 69, 0.05)' },
        horzLines: { color: 'rgba(255, 45, 69, 0.05)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(255, 45, 69, 0.45)',
          labelBackgroundColor: '#ff2d45',
        },
        horzLine: {
          color: 'rgba(255, 45, 69, 0.45)',
          labelBackgroundColor: '#ff2d45',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 45, 69, 0.22)',
        scaleMargins: {
          top: 0.08,
          bottom: 0.22,
        },
      },
      timeScale: {
        borderColor: 'rgba(255, 45, 69, 0.22)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#00e676',
      downColor: '#ff2d45',
      borderUpColor: '#00e676',
      borderDownColor: '#ff2d45',
      wickUpColor: '#00e676',
      wickDownColor: '#ff2d45',
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const res = original();
        if (!res || !res.priceRange) return res;

        let minVal = res.priceRange.minValue;
        let maxVal = res.priceRange.maxValue;

        const {
          tf: curTf,
          atr14: curAtr,
          openTrades: curOpenTrades,
          pendingPlan: curPending,
          livePrice: curLive,
          candles: curCandles,
        } = propsRef.current;

        const refPrice =
          curLive ??
          (curCandles.length > 0 ? curCandles[curCandles.length - 1].close : null);
        const safeAtr = Math.max(0.5, curAtr || 2.5);

        // Include open-trade levels (entry / SL / TP) for open trades on this timeframe
        for (const tr of curOpenTrades) {
          if (tr.tf !== curTf) continue;
          const levels: number[] = [tr.entry, tr.tp3];
          if (!tr.beMoved) levels.push(tr.sl);
          if (!tr.tp1Hit) levels.push(tr.tp1);
          if (!tr.tp2Hit) levels.push(tr.tp2);
          for (const lv of levels) {
            if (Number.isFinite(lv) && lv > 0) {
              if (lv < minVal) minVal = lv;
              if (lv > maxVal) maxVal = lv;
            }
          }
        }

        // Include pending-plan entry ONLY if it is within 1.5x ATR14
        if (
          curPending &&
          refPrice !== null &&
          Math.abs(curPending.entry - refPrice) <= 1.5 * safeAtr
        ) {
          if (curPending.entry < minVal) minVal = curPending.entry;
          if (curPending.entry > maxVal) maxVal = curPending.entry;
        }

        return {
          priceRange: {
            minValue: minVal,
            maxValue: maxVal,
          },
        };
      },
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'tickvol',
    });

    chart.priceScale('tickvol').applyOptions({
      scaleMargins: {
        top: 0.82,
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const handleRangeChange = () => {
      drawOverlay();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);

    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && chartRef.current) {
        chartRef.current.applyOptions({ width: Math.floor(rect.width) });
        drawOverlay();
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [drawOverlay]);

  // Update candle & volume data whenever candles or timeframe change
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const chart = chartRef.current;
    if (!candleSeries || !volumeSeries || !chart) return;

    if (!candles || candles.length === 0) {
      candleSeries.setData([]);
      volumeSeries.setData([]);
      drawOverlay();
      return;
    }

    const candleData = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volData = candles.map((c) => {
      const isBuyDominant =
        c.buyVol + c.sellVol > 0 ? c.buyVol > c.sellVol : c.close >= c.open;
      return {
        time: c.time as UTCTimestamp,
        value: c.tickVolume,
        color: isBuyDominant ? 'rgba(0, 230, 118, 0.52)' : 'rgba(255, 45, 69, 0.52)',
      };
    });

    candleSeries.setData(candleData);
    volumeSeries.setData(volData);

    if (prevTfRef.current !== tf) {
      prevTfRef.current = tf;
      chart.timeScale().fitContent();
    }

    drawOverlay();
  }, [candles, tf, atr14, zones, structures, openTrades, pendingPlan, livePrice, drawOverlay]);

  return (
    <div className="relative w-full overflow-hidden bg-[#030305]">
      <div ref={containerRef} className="w-full" style={{ height: `${CHART_HEIGHT}px` }} />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 z-10"
        style={{ width: '100%', height: `${CHART_HEIGHT}px` }}
      />
      {(!candles || candles.length === 0) && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/80">
          <span
            className="text-xs font-bold tracking-[0.2em] text-[#ff2d45]"
            style={{ fontFamily: "'Orbitron', sans-serif" }}
          >
            {isConnected ? 'NO DATA' : 'WAITING FOR LIVE FEED'}
          </span>
        </div>
      )}
    </div>
  );
};
