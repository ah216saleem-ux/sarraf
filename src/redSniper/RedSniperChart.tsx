import React, { useEffect, useRef, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ColorType,
  CrosshairMode,
  UTCTimestamp,
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
  showBosChoch: boolean;
  showFarZones?: boolean;
  showConsumedZones?: boolean;
  maxZones?: number;
  highlightedZoneId?: string | null;
  openTrades: OpenSniperTrade[];
  pendingPlan: PendingTradePlan | null;
  livePrice: number | null;
  isConnected: boolean;
}

const CHART_HEIGHT = 430;

function resolveTimeToX(
  chart: IChartApi,
  candles: Candle[],
  targetTime: number,
  plotWidth: number
): number {
  const timeScale = chart.timeScale();
  const direct = timeScale.timeToCoordinate(targetTime as UTCTimestamp);
  if (direct !== null && Number.isFinite(direct)) {
    return Math.max(0, Math.min(plotWidth - 28, direct));
  }
  if (!candles || candles.length === 0) return 0;
  if (targetTime <= candles[0].time) return 0;
  if (targetTime >= candles[candles.length - 1].time) {
    const lastCoord = timeScale.logicalToCoordinate(
      (candles.length - 1) as unknown as import('lightweight-charts').Logical
    );
    return lastCoord !== null && Number.isFinite(lastCoord)
      ? Math.max(0, Math.min(plotWidth - 28, lastCoord))
      : Math.max(0, plotWidth - 40);
  }
  // Binary search nearest candle index
  let lo = 0;
  let hi = candles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time < targetTime) lo = mid + 1;
    else hi = mid;
  }
  const logCoord = timeScale.logicalToCoordinate(
    lo as unknown as import('lightweight-charts').Logical
  );
  if (logCoord !== null && Number.isFinite(logCoord)) {
    return Math.max(0, Math.min(plotWidth - 28, logCoord));
  }
  return 0;
}

export const RedSniperChart: React.FC<RedSniperChartProps> = ({
  tf,
  candles,
  atr14,
  zones,
  structures,
  showBosChoch,
  showFarZones = false,
  showConsumedZones = false,
  maxZones = 6,
  highlightedZoneId = null,
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
  const loadedBarCountRef = useRef<number>(0);
  const prevTfRef = useRef<RedSniperTimeframe>(tf);

  const propsRef = useRef({
    tf,
    candles,
    atr14,
    zones,
    structures,
    showBosChoch,
    showFarZones,
    showConsumedZones,
    maxZones,
    highlightedZoneId,
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
    showBosChoch,
    showFarZones,
    showConsumedZones,
    maxZones,
    highlightedZoneId,
    openTrades,
    pendingPlan,
    livePrice,
  };

  const clearOverlayCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const redrawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!canvas || !chart || !series) return;

    const {
      tf: curTf,
      candles: curCandles,
      zones: curZones,
      structures: curStructures,
      showBosChoch: curShowBosChoch,
      showFarZones: curShowFarZones,
      showConsumedZones: curShowConsumedZones,
      maxZones: curMaxZones,
      highlightedZoneId: curHighlightedId,
      openTrades: curOpenTrades,
      livePrice: curLivePrice,
    } = propsRef.current;

    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const fullW = parent.clientWidth || 340;
    const fullH = parent.clientHeight || CHART_HEIGHT;
    if (canvas.width !== Math.floor(fullW * dpr) || canvas.height !== Math.floor(fullH * dpr)) {
      canvas.width = Math.floor(fullW * dpr);
      canvas.height = Math.floor(fullH * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, fullW, fullH);

    const priceScaleWidth = chart.priceScale('right').width() || 58;
    const timeScaleHeight = chart.timeScale().height() || 26;
    const plotWidth = Math.max(60, fullW - priceScaleWidth);
    const plotHeight = Math.max(60, fullH - timeScaleHeight);

    ctx.beginPath();
    ctx.rect(0, 0, plotWidth, plotHeight);
    ctx.clip();

    const effectiveLivePrice =
      typeof curLivePrice === 'number' && curLivePrice > 0
        ? curLivePrice
        : curCandles.length > 0
        ? curCandles[curCandles.length - 1].close
        : 0;

    // 1) Optional BOS / CHoCH structure lines
    if (curShowBosChoch && curStructures.length > 0) {
      ctx.save();
      ctx.font = "700 9px 'JetBrains Mono', monospace";
      for (const st of curStructures) {
        const y = series.priceToCoordinate(st.price);
        if (y === null || y < 2 || y > plotHeight - 2) continue;
        const x1 = resolveTimeToX(chart, curCandles, st.pivotTime, plotWidth);
        const x2 = resolveTimeToX(chart, curCandles, st.breakTime, plotWidth);
        if (x2 <= x1 + 4) continue;

        const color =
          st.dir === 'BULL'
            ? 'rgba(46, 230, 160, 0.45)'
            : 'rgba(255, 93, 108, 0.45)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.fillStyle = color;
        const midX = (x1 + x2) / 2;
        ctx.fillText(st.kind, midX - 10, y - 3);
      }
      ctx.restore();
    }

    // 2) Supply/Demand Base Zones (starting at base candle time and extending to right edge)
    // Cap boxes drawn per timeframe at maxZones (chosen AFTER >=70% overlap rule); hide FAR zones (>farAtr*ATR) and CONSUMED zones (pctLeft=0) from chart boxes by default
    const nonConsumedZones = curZones.filter(
      (z) => curShowConsumedZones || !z.consumed || z.id === curHighlightedId
    );
    const eligibleForBox = nonConsumedZones
      .filter((z) => curShowFarZones || !z.isFar || z.id === curHighlightedId)
      .sort((a, b) => a.distancePts - b.distancePts || b.power - a.power)
      .slice(0, Math.max(3, Math.min(8, curMaxZones || 6)));
    const boxIds = new Set(eligibleForBox.map((z) => z.id));
    if (curHighlightedId) {
      boxIds.add(curHighlightedId);
    }

    interface VisibleZoneDraw {
      zone: RedSniperZone;
      xStart: number;
      boxTop: number;
      boxBot: number;
      boxH: number;
      labelY: number;
      showFullLabel: boolean;
      isHighlighted: boolean;
    }

    const visibleZones: VisibleZoneDraw[] = [];
    const clippedTopZones: RedSniperZone[] = [];
    const clippedBottomZones: RedSniperZone[] = [];

    for (const z of nonConsumedZones) {
      if (!boxIds.has(z.id)) {
        if (z.bottom >= effectiveLivePrice) {
          clippedTopZones.push(z);
        } else {
          clippedBottomZones.push(z);
        }
        continue;
      }

      const yTopRaw = series.priceToCoordinate(z.top);
      const yBotRaw = series.priceToCoordinate(z.bottom);
      if (yTopRaw === null || yBotRaw === null) continue;

      const yMin = Math.min(yTopRaw, yBotRaw);
      const yMax = Math.max(yTopRaw, yBotRaw);

      if (yMax < 0) {
        clippedTopZones.push(z);
        continue;
      }
      if (yMin > plotHeight) {
        clippedBottomZones.push(z);
        continue;
      }

      const boxTop = Math.max(0, yMin);
      const boxBot = Math.min(plotHeight, yMax);
      const boxH = Math.max(3, boxBot - boxTop);
      const xStart = resolveTimeToX(chart, curCandles, z.time, plotWidth);

      visibleZones.push({
        zone: z,
        xStart,
        boxTop,
        boxBot,
        boxH,
        labelY: Math.max(11, Math.min(plotHeight - 4, boxTop + 11)),
        showFullLabel: false,
        isHighlighted: z.id === curHighlightedId,
      });
    }

    // B.1) Draw a full label ("SELL · FRESH · PWR 82 · 100% left · 0x") ONLY for the 3 highest-power zones
    // whose labels do not overlap (14px min vertical gap). Other zones: thin box + power bar without text.
    // Tapping a chip highlights that zone on the chart for 3 seconds with a full label.
    const byPowerDesc = [...visibleZones].sort((a, b) => {
      if (a.isHighlighted !== b.isHighlighted) return a.isHighlighted ? -1 : 1;
      return b.zone.power - a.zone.power;
    });
    const occupiedYs: number[] = [];
    let fullLabelsAssigned = 0;
    for (const vz of byPowerDesc) {
      if (vz.isHighlighted) {
        vz.showFullLabel = true;
        occupiedYs.push(vz.labelY);
        fullLabelsAssigned += 1;
        continue;
      }
      if (fullLabelsAssigned >= 3) {
        vz.showFullLabel = false;
        continue;
      }
      const collides = occupiedYs.some((oy) => Math.abs(oy - vz.labelY) < 14);
      if (!collides) {
        vz.showFullLabel = true;
        occupiedYs.push(vz.labelY);
        fullLabelsAssigned += 1;
      } else {
        vz.showFullLabel = false;
      }
    }

    for (const vz of visibleZones) {
      const { zone: z, xStart, boxTop, boxH, labelY, showFullLabel, isHighlighted } = vz;
      const isSell = z.side === 'SELL';
      const strokeColor = isSell ? '#ff4d66' : '#2fe08a';
      const fillColor = isHighlighted
        ? isSell
          ? 'rgba(255, 77, 102, 0.22)'
          : 'rgba(47, 224, 138, 0.22)'
        : isSell
        ? 'rgba(255, 77, 102, 0.09)'
        : 'rgba(47, 224, 138, 0.09)';

      const boxW = Math.max(24, plotWidth - xStart);

      ctx.save();
      ctx.fillStyle = fillColor;
      ctx.fillRect(xStart, boxTop, boxW, boxH);

      ctx.strokeStyle = isHighlighted ? '#ffffff' : strokeColor;
      ctx.lineWidth = isHighlighted ? 2.0 : 1.3;
      ctx.setLineDash([]);
      ctx.strokeRect(xStart + 0.5, boxTop + 0.5, Math.max(1, boxW - 1), Math.max(1, boxH - 1));

      // Power bar on the right of the box
      const barW = 34;
      const barH = 4;
      const barX = plotWidth - barW - 6;
      const barY = Math.max(2, Math.min(plotHeight - barH - 2, boxTop + 4));
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = strokeColor;
      ctx.fillRect(barX, barY, Math.round((barW * Math.min(100, z.power)) / 100), barH);

      // Full zone label only for the top-3 non-overlapping zones (or highlighted chip zone)
      if (showFullLabel) {
        const text = z.chartLabel;
        ctx.font = "700 9.5px 'JetBrains Mono', monospace";
        ctx.shadowColor = '#08080b';
        ctx.shadowBlur = 3;
        ctx.fillStyle = isHighlighted ? '#ffffff' : strokeColor;
        const labelX = Math.min(barX - 42, xStart + 6);
        ctx.fillText(text, Math.max(4, labelX), labelY);
      }
      ctx.restore();
    }

    // 3) Off-screen clipped zone edge markers at top / bottom of plot
    if (clippedTopZones.length > 0) {
      const topZ = [...clippedTopZones].sort((a, b) => a.bottom - b.bottom)[0];
      const tag = `▲ ${topZ.side} ${topZ.bottom.toFixed(0)}-${topZ.top.toFixed(0)} · PWR ${topZ.power}`;
      ctx.save();
      ctx.font = "700 9.5px 'JetBrains Mono', monospace";
      const tw = ctx.measureText(tag).width + 12;
      const tx = plotWidth - tw - 8;
      ctx.fillStyle = 'rgba(8, 8, 11, 0.88)';
      ctx.fillRect(tx, 4, tw, 16);
      ctx.strokeStyle = topZ.side === 'SELL' ? '#ff4d66' : '#2fe08a';
      ctx.lineWidth = 1;
      ctx.strokeRect(tx, 4, tw, 16);
      ctx.fillStyle = topZ.side === 'SELL' ? '#ff4d66' : '#2fe08a';
      ctx.fillText(tag, tx + 6, 15);
      ctx.restore();
    }

    if (clippedBottomZones.length > 0) {
      const botZ = [...clippedBottomZones].sort((a, b) => b.top - a.top)[0];
      const tag = `▼ ${botZ.side} ${botZ.bottom.toFixed(0)}-${botZ.top.toFixed(0)} · PWR ${botZ.power}`;
      ctx.save();
      ctx.font = "700 9.5px 'JetBrains Mono', monospace";
      const tw = ctx.measureText(tag).width + 12;
      const tx = plotWidth - tw - 8;
      const ty = plotHeight - 20;
      ctx.fillStyle = 'rgba(8, 8, 11, 0.88)';
      ctx.fillRect(tx, ty, tw, 16);
      ctx.strokeStyle = botZ.side === 'SELL' ? '#ff4d66' : '#2fe08a';
      ctx.lineWidth = 1;
      ctx.strokeRect(tx, ty, tw, 16);
      ctx.fillStyle = botZ.side === 'SELL' ? '#ff4d66' : '#2fe08a';
      ctx.fillText(tag, tx + 6, ty + 11);
      ctx.restore();
    }

    // 4) Open trade lines (ENTRY, STOP before BE, hidden at BE, TRAIL when trailed past entry, T1, T2, T3)
    for (const tr of curOpenTrades) {
      if (tr.tf !== curTf) continue;
      const lines: Array<{
        price: number;
        label: string;
        color: string;
        dashed: boolean;
      }> = [
        {
          price: tr.entry,
          label: tr.beMoved ? `${tr.side} ENTRY (BE)` : `${tr.side} ENTRY`,
          color: '#00e5ff',
          dashed: false,
        },
      ];

      if (!tr.beMoved) {
        lines.push({
          price: tr.sl,
          label: 'STOP',
          color: '#ff4d66',
          dashed: true,
        });
      } else if (tr.isTrailing) {
        lines.push({
          price: tr.sl,
          label: 'TRAIL',
          color: '#2ee6a0',
          dashed: true,
        });
      }

      if (!tr.tp1Hit) {
        lines.push({
          price: tr.tp1,
          label: 'T1 (1R)',
          color: '#2ee6a0',
          dashed: true,
        });
      }
      if (!tr.tp2Hit) {
        lines.push({
          price: tr.tp2,
          label: 'T2 (2R)',
          color: '#2ee6a0',
          dashed: true,
        });
      }
      lines.push({
        price: tr.tp3,
        label: tr.tp3IsLiquidity ? 'T3 (LIQ)' : 'T3 (3R)',
        color: '#f2b94b',
        dashed: false,
      });

      for (const ln of lines) {
        const y = series.priceToCoordinate(ln.price);
        if (y === null || y < 0 || y > plotHeight) continue;
        ctx.save();
        ctx.strokeStyle = ln.color;
        ctx.lineWidth = 1;
        ctx.setLineDash(ln.dashed ? [4, 4] : []);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotWidth, y);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.font = "700 9px 'JetBrains Mono', monospace";
        ctx.fillStyle = ln.color;
        ctx.shadowColor = '#08080b';
        ctx.shadowBlur = 3;
        ctx.fillText(`${ln.label} ${ln.price.toFixed(2)}`, 8, Math.max(10, y - 3));
        ctx.restore();
      }
    }

    // 5) Gold live price line
    if (effectiveLivePrice > 0) {
      const yNow = series.priceToCoordinate(effectiveLivePrice);
      if (yNow !== null && yNow >= 0 && yNow <= plotHeight) {
        ctx.save();
        ctx.strokeStyle = '#f2b94b';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(0, yNow);
        ctx.lineTo(plotWidth, yNow);
        ctx.stroke();

        const tagText = `NOW ${effectiveLivePrice.toFixed(2)}`;
        ctx.font = "700 9.5px 'JetBrains Mono', monospace";
        const tw = ctx.measureText(tagText).width + 10;
        const tx = Math.max(4, plotWidth - tw - 4);
        const ty = Math.max(2, Math.min(plotHeight - 16, yNow - 8));
        ctx.fillStyle = '#f2b94b';
        ctx.fillRect(tx, ty, tw, 15);
        ctx.fillStyle = '#08080b';
        ctx.fillText(tagText, tx + 5, ty + 11);
        ctx.restore();
      }
    }

    ctx.restore();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth || 340,
      height: CHART_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: '#08080b' },
        textColor: '#8e8779',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: '#1f1d18',
        autoScale: true,
        scaleMargins: { top: 0.04, bottom: 0.14 },
      },
      timeScale: {
        borderColor: '#1f1d18',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 8,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#2ee6a0',
      downColor: '#ff5d6c',
      borderUpColor: '#2ee6a0',
      borderDownColor: '#ff5d6c',
      wickUpColor: '#2ee6a0',
      wickDownColor: '#ff5d6c',
      priceLineVisible: false,
      lastValueVisible: false,
      autoscaleInfoProvider: () => {
        const {
          tf: curTf,
          candles: bars,
          atr14: curAtr,
          openTrades: curOpenTrades,
          pendingPlan: curPending,
          livePrice: curLive,
        } = propsRef.current;

        if (!bars || bars.length === 0) return null;
        const range = chart.timeScale().getVisibleLogicalRange();
        const startIdx = Math.max(
          0,
          Math.floor(range ? range.from : bars.length - 100)
        );
        const endIdx = Math.min(
          bars.length - 1,
          Math.ceil(range ? range.to : bars.length - 1)
        );

        let minPrice = Infinity;
        let maxPrice = -Infinity;
        for (let i = startIdx; i <= endIdx; i++) {
          const b = bars[i];
          if (!b) continue;
          if (b.low < minPrice) minPrice = b.low;
          if (b.high > maxPrice) maxPrice = b.high;
        }

        if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) {
          return null;
        }

        const refPrice =
          typeof curLive === 'number' && curLive > 0
            ? curLive
            : bars[bars.length - 1].close;
        const safeAtr = Math.max(0.5, curAtr || 2.5);

        // Include open-trade levels for the active timeframe
        for (const tr of curOpenTrades) {
          if (tr.tf !== curTf) continue;
          const pts = [tr.entry, tr.tp3];
          if (!tr.beMoved || tr.isTrailing) pts.push(tr.sl);
          if (!tr.tp1Hit) pts.push(tr.tp1);
          if (!tr.tp2Hit) pts.push(tr.tp2);
          for (const p of pts) {
            if (Number.isFinite(p) && p > 0) {
              minPrice = Math.min(minPrice, p);
              maxPrice = Math.max(maxPrice, p);
            }
          }
        }

        // Include pending-plan entry if within 1.5x ATR14
        if (
          curPending &&
          refPrice > 0 &&
          Math.abs(curPending.entry - refPrice) <= 1.5 * safeAtr
        ) {
          minPrice = Math.min(minPrice, curPending.entry);
          maxPrice = Math.max(maxPrice, curPending.entry);
        }

        const pad = Math.max(0.3, (maxPrice - minPrice) * 0.06);
        return {
          priceRange: {
            minValue: minPrice - pad,
            maxValue: maxPrice + pad,
          },
        };
      },
    });

    // Tick-volume histogram under the candles
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volScale',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale('volScale').applyOptions({
      scaleMargins: { top: 0.86, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    loadedBarCountRef.current = 0;

    const onRangeOrCrosshair = () => requestAnimationFrame(redrawOverlay);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeOrCrosshair);
    chart.subscribeCrosshairMove(onRangeOrCrosshair);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0 && chartRef.current) {
          chartRef.current.applyOptions({ width: w });
          requestAnimationFrame(redrawOverlay);
        }
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeOrCrosshair);
      chart.unsubscribeCrosshairMove(onRangeOrCrosshair);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      loadedBarCountRef.current = 0;
    };
  }, [redrawOverlay]);

  useEffect(() => {
    const cs = candleSeriesRef.current;
    const vs = volumeSeriesRef.current;
    const chart = chartRef.current;
    if (!cs || !vs || !chart) return;

    const tfChanged = prevTfRef.current !== tf;
    if (tfChanged) {
      // B.2) On timeframe change, clear overlay + trade lines immediately
      clearOverlayCanvas();
      cs.setData([]);
      vs.setData([]);
    }

    if (!candles || candles.length === 0) {
      cs.setData([]);
      vs.setData([]);
      requestAnimationFrame(redrawOverlay);
      return;
    }

    const validBars = candles.filter(
      (c) =>
        Number.isFinite(c.time) &&
        c.time > 0 &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close)
    );
    if (validBars.length === 0) return;

    const barCountChanged = loadedBarCountRef.current !== validBars.length;

    if (tfChanged || barCountChanged || loadedBarCountRef.current === 0) {
      cs.setData(
        validBars.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );

      vs.setData(
        validBars.map((c) => {
          const isBuyDominant =
            c.buyVol + c.sellVol > 0 ? c.buyVol > c.sellVol : c.close >= c.open;
          return {
            time: c.time as UTCTimestamp,
            value: Number.isFinite(c.tickVolume) ? c.tickVolume : 0,
            color: isBuyDominant
              ? 'rgba(46, 230, 160, 0.32)'
              : 'rgba(255, 93, 108, 0.32)',
          };
        })
      );

      loadedBarCountRef.current = validBars.length;

      if (tfChanged || loadedBarCountRef.current > 0) {
        prevTfRef.current = tf;
        const len = validBars.length;
        // Reset price scale autoScale and visible range so previous timeframe candles never appear under the new scale
        chart.priceScale('right').applyOptions({ autoScale: true });
        chart.timeScale().applyOptions({ rightOffset: 6 });
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, len - 100),
          to: len - 1 + 6,
        });
      }

      if (tfChanged) {
        // Redraw overlay only on the next animation frame after data/scale are applied
        const raf1 = requestAnimationFrame(() => {
          requestAnimationFrame(redrawOverlay);
        });
        return () => cancelAnimationFrame(raf1);
      }
    } else {
      const last = validBars[validBars.length - 1];
      try {
        cs.update({
          time: last.time as UTCTimestamp,
          open: last.open,
          high: last.high,
          low: last.low,
          close: last.close,
        });
        const isBuyDominant =
          last.buyVol + last.sellVol > 0
            ? last.buyVol > last.sellVol
            : last.close >= last.open;
        vs.update({
          time: last.time as UTCTimestamp,
          value: Number.isFinite(last.tickVolume) ? last.tickVolume : 0,
          color: isBuyDominant
            ? 'rgba(46, 230, 160, 0.32)'
            : 'rgba(255, 93, 108, 0.32)',
        });
      } catch {
        // ignore transient ordering edge case
      }
    }

    requestAnimationFrame(redrawOverlay);
  }, [
    candles,
    tf,
    atr14,
    zones,
    structures,
    showBosChoch,
    showFarZones,
    maxZones,
    highlightedZoneId,
    openTrades,
    pendingPlan,
    livePrice,
    clearOverlayCanvas,
    redrawOverlay,
  ]);

  return (
    <div className="relative w-full h-[430px] overflow-hidden bg-[#08080b]">
      <div ref={containerRef} className="w-full h-full" />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 w-full h-full z-10"
        style={{ zIndex: 10 }}
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
