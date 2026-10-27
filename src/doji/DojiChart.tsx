// src/doji/DojiChart.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineStyle,
  CrosshairMode,
  ColorType,
  IPriceLine,
} from 'lightweight-charts';
import { RawBar, DojiTimeframe, DojiZone, computeEma, computeAtr14, checkIsDoji } from './dojiEngine';
import { DojiTrade } from './dojiSignalEngine';

interface DojiChartProps {
  bars: RawBar[];
  timeframe: DojiTimeframe;
  livePrice: number;
  showZones: boolean;
  showEma9: boolean;
  zones: DojiZone[];
  minZoneStrength?: number;
  showAllZones?: boolean;
  flaggedOpenTimeSecs?: number[];
  activeTrade?: DojiTrade | null;
  latestTrigger: number;
  resetTrigger: number;
  fitZonesTrigger: number;
  focusedZoneRequest?: { zone: DojiZone; seq: number } | null;
}

interface CandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export const DojiChart: React.FC<DojiChartProps> = ({
  bars,
  timeframe,
  livePrice,
  showZones,
  showEma9,
  zones,
  minZoneStrength = 5,
  showAllZones = false,
  flaggedOpenTimeSecs,
  activeTrade,
  latestTrigger,
  resetTrigger,
  fitZonesTrigger,
  focusedZoneRequest,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const tradeLinesRef = useRef<IPriceLine[]>([]);

  const zonesRef = useRef<DojiZone[]>(zones);
  zonesRef.current = zones;
  const minZoneStrengthRef = useRef<number>(minZoneStrength);
  minZoneStrengthRef.current = minZoneStrength;
  const showAllZonesRef = useRef<boolean>(showAllZones);
  showAllZonesRef.current = showAllZones;
  const flaggedOpenTimeSecsRef = useRef<number[] | undefined>(flaggedOpenTimeSecs);
  flaggedOpenTimeSecsRef.current = flaggedOpenTimeSecs;
  const showZonesRef = useRef<boolean>(showZones);
  showZonesRef.current = showZones;
  const timeframeRef = useRef<DojiTimeframe>(timeframe);
  timeframeRef.current = timeframe;
  const livePriceRef = useRef<number>(livePrice);
  livePriceRef.current = livePrice;
  const activeTradeRef = useRef<DojiTrade | null | undefined>(activeTrade);
  activeTradeRef.current = activeTrade;
  const currentAtrRef = useRef<number>(3.5);
  const uniqueCandlesRef = useRef<CandlePoint[]>([]);
  const initializedTfRef = useRef<DojiTimeframe | null>(null);

  const scaleModeRef = useRef<{
    mode: 'normal' | 'fit_zones' | 'focus_zone';
    targetZone?: DojiZone | null;
  }>({ mode: 'normal', targetZone: null });

  const [offscreenAbove, setOffscreenAbove] = useState<DojiZone[]>([]);
  const [offscreenBelow, setOffscreenBelow] = useState<DojiZone[]>([]);
  const offscreenKeyRef = useRef<string>('');
  const aboveCycleIdxRef = useRef<number>(0);
  const belowCycleIdxRef = useRef<number>(0);

  const findCandleIndexForTime = useCallback((timeSec: number): number => {
    const candles = uniqueCandlesRef.current;
    if (candles.length === 0) return 0;
    for (let i = 0; i < candles.length; i++) {
      if (candles[i].time >= timeSec) {
        return i;
      }
    }
    return candles.length - 1;
  }, []);

  const setLast90CandlesView = useCallback(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const total = uniqueCandlesRef.current.length;
    if (!chart || total === 0) return;

    scaleModeRef.current = { mode: 'normal', targetZone: null };
    aboveCycleIdxRef.current = 0;
    belowCycleIdxRef.current = 0;

    const from = Math.max(0, total - 90);
    const to = Math.max(0, total - 1) + 8;

    chart.timeScale().setVisibleLogicalRange({ from, to });
    chart.priceScale('right').applyOptions({ autoScale: true });
    if (candleSeries) {
      candleSeries.applyOptions({});
    }
  }, []);

  const fitAllZonesView = useCallback(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const total = uniqueCandlesRef.current.length;
    if (!chart || total === 0) return;

    const currentTfZones = zonesRef.current.filter((z) => z.timeframe === timeframeRef.current);
    scaleModeRef.current = { mode: 'fit_zones', targetZone: null };

    let earliestIdx = Math.max(0, total - 90);
    for (const z of currentTfZones) {
      const idx = findCandleIndexForTime(z.openTimeSec);
      earliestIdx = Math.min(earliestIdx, Math.max(0, idx - 4));
    }

    const to = Math.max(0, total - 1) + 8;
    chart.timeScale().setVisibleLogicalRange({ from: earliestIdx, to });
    chart.priceScale('right').applyOptions({ autoScale: true });
    if (candleSeries) {
      candleSeries.applyOptions({});
    }
  }, [findCandleIndexForTime]);

  const scrollToZone = useCallback(
    (zone: DojiZone) => {
      const chart = chartRef.current;
      const candleSeries = candleSeriesRef.current;
      const total = uniqueCandlesRef.current.length;
      if (!chart || total === 0) return;

      scaleModeRef.current = { mode: 'focus_zone', targetZone: zone };

      const zIdx = findCandleIndexForTime(zone.openTimeSec);
      const from = Math.max(0, Math.min(zIdx - 6, total - 60));
      const to = Math.max(zIdx + 20, total - 1 + 8);

      chart.timeScale().setVisibleLogicalRange({ from, to });
      chart.priceScale('right').applyOptions({ autoScale: true });
      if (candleSeries) {
        candleSeries.applyOptions({});
      }
    },
    [findCandleIndexForTime]
  );

  // 1. Initialize Lightweight Chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chartCreator = (window as any).LightweightCharts?.createChart || createChart;
    const initWidth = containerRef.current.clientWidth || 800;
    const initHeight = containerRef.current.clientHeight || 380;

    const chart: IChartApi = chartCreator(containerRef.current, {
      width: initWidth,
      height: initHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#0a0907' },
        textColor: '#9d947e',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1a1711' },
        horzLines: { color: '#1a1711' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#d9b25a',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#1a1711',
        },
        horzLine: {
          color: '#d9b25a',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#d9b25a',
        },
      },
      rightPriceScale: {
        borderColor: '#2b261b',
        textColor: '#f0eadb',
        scaleMargins: { top: 0.12, bottom: 0.12 },
        autoScale: true,
      },
      timeScale: {
        borderColor: '#2b261b',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 8,
        minBarSpacing: 2,
      },
      localization: {
        timeFormatter: (utcTimestamp: number) => {
          if (!Number.isFinite(utcTimestamp)) return '';
          const d = new Date(utcTimestamp * 1000);
          if (isNaN(d.getTime())) return '';
          return new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Dubai',
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: 'short',
          }).format(d);
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        mouseWheel: true,
        pinch: true,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#3fbf8f',
      downColor: '#e5584f',
      borderUpColor: '#3fbf8f',
      borderDownColor: '#e5584f',
      wickUpColor: '#3fbf8f',
      wickDownColor: '#e5584f',
      priceLineColor: '#d9b25a',
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dotted,
      autoscaleInfoProvider: (original: () => any) => {
        const res = original();
        if (!res || !res.priceRange) return res;

        let minVal = Number(res.priceRange.minValue);
        let maxVal = Number(res.priceRange.maxValue);
        if (!Number.isFinite(minVal) || !Number.isFinite(maxVal) || minVal >= maxVal) {
          return res;
        }

        const modeInfo = scaleModeRef.current;
        if (modeInfo.mode === 'normal') {
          return res;
        }

        if (modeInfo.mode === 'fit_zones') {
          const tfZones = zonesRef.current.filter((z) => z.timeframe === timeframeRef.current);
          for (const z of tfZones) {
            if (Number.isFinite(z.low)) minVal = Math.min(minVal, z.low - 2);
            if (Number.isFinite(z.high)) maxVal = Math.max(maxVal, z.high + 2);
          }
        } else if (modeInfo.mode === 'focus_zone' && modeInfo.targetZone) {
          const z = modeInfo.targetZone;
          if (Number.isFinite(z.low)) minVal = Math.min(minVal, z.low - 4);
          if (Number.isFinite(z.high)) maxVal = Math.max(maxVal, z.high + 4);
        }

        if (Number.isFinite(minVal) && Number.isFinite(maxVal) && minVal < maxVal) {
          return {
            ...res,
            priceRange: {
              minValue: minVal,
              maxValue: maxVal,
            },
          };
        }
        return res;
      },
    });

    const emaSeries = chart.addLineSeries({
      color: '#d9b25a',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    emaSeriesRef.current = emaSeries;

    if (canvasRef.current) {
      canvasRef.current.width = initWidth;
      canvasRef.current.height = initHeight;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0 || !containerRef.current) return;
      const { width, height } = entries[0].contentRect;
      const w = Math.floor(width);
      const h = Math.floor(height);
      if (w > 0 && h > 0) {
        chart.applyOptions({ width: w, height: h });
        if (canvasRef.current) {
          canvasRef.current.width = w;
          canvasRef.current.height = h;
        }
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      emaSeriesRef.current = null;
    };
  }, []);

  // 2. Load Candlesticks & EMA 9, set initial 90-candle view on timeframe load
  useEffect(() => {
    if (!candleSeriesRef.current || !emaSeriesRef.current || !bars || bars.length === 0) return;

    const closedBars = bars.filter((b) => !b.isOpen);
    currentAtrRef.current = computeAtr14(closedBars);

    const formattedCandles: CandlePoint[] = [];
    for (const b of bars) {
      if (!b || !b.openTime) continue;
      const ms = new Date(b.openTime).getTime();
      if (!Number.isFinite(ms)) continue;
      const timeSec = Math.floor(ms / 1000) + 4 * 3600;

      const open = Number(b.open);
      const high = Number(b.high);
      const low = Number(b.low);
      const close = Number(b.close);
      if (
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close) ||
        open <= 0 ||
        high <= 0 ||
        low <= 0 ||
        close <= 0
      ) {
        continue;
      }
      formattedCandles.push({
        time: timeSec,
        open,
        high: Math.max(high, open, close),
        low: Math.min(low, open, close),
        close,
      });
    }

    formattedCandles.sort((a, b) => a.time - b.time);

    const uniqueCandles: CandlePoint[] = [];
    const seenTimes = new Set<number>();
    for (const c of formattedCandles) {
      if (!seenTimes.has(c.time)) {
        seenTimes.add(c.time);
        uniqueCandles.push(c);
      }
    }

    uniqueCandlesRef.current = uniqueCandles;
    if (uniqueCandles.length > 0) {
      try {
        candleSeriesRef.current.setData(uniqueCandles as any);
      } catch (err) {
        console.warn('[DojiChart] setData error:', err);
      }
    } else {
      candleSeriesRef.current.setData([]);
    }
    candleSeriesRef.current.setMarkers([]);

    if (showEma9) {
      const emaPoints = computeEma(bars, 9);
      const uniqueEma: { time: any; value: number }[] = [];
      const seenEmaTimes = new Set<number>();
      for (const p of emaPoints) {
        if (p && Number.isFinite(p.time) && Number.isFinite(p.value) && !seenEmaTimes.has(p.time)) {
          seenEmaTimes.add(p.time);
          uniqueEma.push({ time: p.time as any, value: p.value });
        }
      }
      uniqueEma.sort((a, b) => a.time - b.time);
      try {
        emaSeriesRef.current.setData(uniqueEma);
      } catch {
        emaSeriesRef.current.setData([]);
      }
    } else {
      emaSeriesRef.current.setData([]);
    }

    if (initializedTfRef.current !== timeframe) {
      initializedTfRef.current = timeframe;
      setLast90CandlesView();
    }
  }, [bars, timeframe, showEma9, setLast90CandlesView]);

  // 3. Update Latest Candle Real-Time with Live Price
  useEffect(() => {
    if (
      !candleSeriesRef.current ||
      !bars ||
      bars.length === 0 ||
      !livePrice ||
      livePrice <= 0 ||
      !Number.isFinite(livePrice)
    ) {
      return;
    }
    const unique = uniqueCandlesRef.current;
    if (unique.length === 0) return;

    const lastBar = bars[bars.length - 1];
    if (!lastBar || !lastBar.openTime) return;

    const ms = new Date(lastBar.openTime).getTime();
    if (!Number.isFinite(ms)) return;
    const timeSec = Math.floor(ms / 1000) + 4 * 3600;

    const open = Number(lastBar.open);
    if (!Number.isFinite(open) || open <= 0) return;

    const lastCandle = unique[unique.length - 1];
    if (timeSec < lastCandle.time) return;

    const barHigh = Number(lastBar.high);
    const barLow = Number(lastBar.low);
    const high = Math.max(Number.isFinite(barHigh) ? barHigh : open, livePrice, open);
    const low = Math.min(Number.isFinite(barLow) ? barLow : open, livePrice, open);
    const updatedCandle: CandlePoint = {
      time: timeSec,
      open,
      high,
      low,
      close: livePrice,
    };

    if (timeSec === lastCandle.time) {
      unique[unique.length - 1] = updatedCandle;
    } else {
      unique.push(updatedCandle);
    }

    try {
      candleSeriesRef.current.update(updatedCandle as any);
    } catch {
      // ignore transient ordering or timing issue
    }
  }, [livePrice, bars]);

  // 4. Draw Price Lines for Open Trade on Selected Timeframe
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    for (const line of tradeLinesRef.current) {
      try {
        candleSeriesRef.current.removePriceLine(line);
      } catch {}
    }
    tradeLinesRef.current = [];

    if (!activeTrade || activeTrade.status !== 'OPEN' || activeTrade.timeframe !== timeframe) {
      return;
    }

    try {
      const createdLines: IPriceLine[] = [];
      const isAfterTp1 = activeTrade.tp1Hit || activeTrade.isBreakeven;

      if (isAfterTp1) {
        // After TP1: only "BE" line (grey) and remaining TPs
        const beLine = candleSeriesRef.current.createPriceLine({
          price: activeTrade.currentSl,
          color: '#9d947e',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'BE',
        });
        createdLines.push(beLine);

        if (!activeTrade.tp2Hit) {
          const tp2Line = candleSeriesRef.current.createPriceLine({
            price: activeTrade.tp2,
            color: '#3fbf8f',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'TP2',
          });
          createdLines.push(tp2Line);
        }

        if (!activeTrade.tp3Hit) {
          const tp3Line = candleSeriesRef.current.createPriceLine({
            price: activeTrade.tp3,
            color: '#3fbf8f',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'TP3',
          });
          createdLines.push(tp3Line);
        }
      } else {
        // Before TP1: Entry, SL, TP1, TP2, TP3
        const entryLine = candleSeriesRef.current.createPriceLine({
          price: activeTrade.entryPrice,
          color: '#d9b25a',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: 'Entry',
        });

        const slLine = candleSeriesRef.current.createPriceLine({
          price: activeTrade.currentSl,
          color: '#e5584f',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'SL',
        });

        const tp1Line = candleSeriesRef.current.createPriceLine({
          price: activeTrade.tp1,
          color: '#3fbf8f',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'TP1',
        });

        const tp2Line = candleSeriesRef.current.createPriceLine({
          price: activeTrade.tp2,
          color: '#3fbf8f',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'TP2',
        });

        const tp3Line = candleSeriesRef.current.createPriceLine({
          price: activeTrade.tp3,
          color: '#3fbf8f',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'TP3',
        });

        createdLines.push(entryLine, slLine, tp1Line, tp2Line, tp3Line);
      }

      tradeLinesRef.current = createdLines;
    } catch {}
  }, [activeTrade, timeframe]);

  // 5. Render Dotted-Border Red Zone Rectangles (within 5 ATR), Top-Left Strength Labels & Off-Screen Edge Chips
  useEffect(() => {
    let animId: number;

    const getXForTime = (chart: IChartApi, timeSec: number): number | null => {
      const directX = chart.timeScale().timeToCoordinate(timeSec as any);
      if (directX !== null) return directX;

      const candles = uniqueCandlesRef.current;
      if (candles.length === 0) return null;

      let idx = -1;
      for (let i = 0; i < candles.length; i++) {
        if (candles[i].time >= timeSec) {
          idx = i;
          break;
        }
      }
      if (idx === -1) idx = candles.length - 1;
      return chart.timeScale().logicalToCoordinate(idx as any);
    };

    const renderOverlay = () => {
      const canvas = canvasRef.current;
      const chart = chartRef.current;
      const candleSeries = candleSeriesRef.current;

      if (!canvas || !chart || !candleSeries) {
        animId = requestAnimationFrame(renderOverlay);
        return;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        animId = requestAnimationFrame(renderOverlay);
        return;
      }

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const candles = uniqueCandlesRef.current;
      if (candles.length === 0) {
        animId = requestAnimationFrame(renderOverlay);
        return;
      }

      const plotWidth = chart.timeScale().width() || width - 60;
      const plotHeight = Math.max(0, height - 26);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, plotWidth, plotHeight);
      ctx.clip();

      // Draw a small blue X marker under every flagged candle on the Doji chart
      const explicitFlagged = flaggedOpenTimeSecsRef.current;
      const flaggedSet =
        explicitFlagged !== undefined
          ? new Set<number>(explicitFlagged)
          : new Set<number>(
              candles
                .slice(0, -1)
                .filter(
                  (c) =>
                    checkIsDoji(
                      {
                        openTime: new Date((c.time - 4 * 3600) * 1000).toISOString(),
                        open: c.open,
                        high: c.high,
                        low: c.low,
                        close: c.close,
                      },
                      currentAtrRef.current || 3.5,
                      true,
                      'indicator'
                    ).isDoji
                )
                .map((c) => c.time)
            );

      if (flaggedSet.size > 0) {
        ctx.save();
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        const halfSize = 2.5;
        for (const c of candles) {
          if (!flaggedSet.has(c.time)) continue;
          const cx = getXForTime(chart, c.time);
          if (cx === null || cx < -6 || cx > plotWidth + 6) continue;
          const yLow = candleSeries.priceToCoordinate(c.low);
          if (yLow === null) continue;
          const cy = yLow + 8;
          if (cy < -6 || cy > plotHeight + 6) continue;
          ctx.beginPath();
          ctx.moveTo(cx - halfSize, cy - halfSize);
          ctx.lineTo(cx + halfSize, cy + halfSize);
          ctx.moveTo(cx - halfSize, cy + halfSize);
          ctx.lineTo(cx + halfSize, cy - halfSize);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (!showZonesRef.current) {
        ctx.restore();
        if (offscreenKeyRef.current !== '') {
          offscreenKeyRef.current = '';
          setOffscreenAbove([]);
          setOffscreenBelow([]);
        }
        animId = requestAnimationFrame(renderOverlay);
        return;
      }

      const currentTfZones = zonesRef.current.filter((z) => z.timeframe === timeframeRef.current);
      const lastCandle = candles[candles.length - 1];
      const refPrice = livePriceRef.current > 0 ? livePriceRef.current : (lastCandle?.close ?? 0);
      const atr = currentAtrRef.current || 3.5;

      const aboveZones = currentTfZones
        .filter((z) => (z.high + z.low) / 2 >= refPrice)
        .sort((a, b) => (a.high + a.low) / 2 - (b.high + b.low) / 2);

      const belowZones = currentTfZones
        .filter((z) => (z.high + z.low) / 2 < refPrice)
        .sort((a, b) => (b.high + b.low) / 2 - (a.high + a.low) / 2);

      // Reduce clutter: by default show only the 3 nearest zones above and 3 nearest below the price.
      // If showAllZones is true, show all zones.
      const zonesToRender = showAllZonesRef.current
        ? currentTfZones
        : [...aboveZones.slice(0, 3), ...belowZones.slice(0, 3)];

      // Active trade price line Y-coordinates for label collision check
      const tradeLineYs: number[] = [];
      const openTrade = activeTradeRef.current;
      if (openTrade && openTrade.status === 'OPEN' && openTrade.timeframe === timeframeRef.current) {
        const isAfterTp1 = openTrade.tp1Hit || openTrade.isBreakeven;
        const levelPrices: number[] = isAfterTp1
          ? [
              openTrade.currentSl,
              ...(openTrade.tp2Hit ? [] : [openTrade.tp2]),
              ...(openTrade.tp3Hit ? [] : [openTrade.tp3]),
            ]
          : [
              openTrade.entryPrice,
              openTrade.currentSl,
              openTrade.tp1,
              openTrade.tp2,
              openTrade.tp3,
            ];
        for (const p of levelPrices) {
          const yCoord = candleSeries.priceToCoordinate(p);
          if (yCoord !== null) {
            tradeLineYs.push(yCoord);
          }
        }
      }

      interface PendingLabel {
        text: string;
        x: number;
        y: number;
        w: number;
        h: number;
        color: string;
        strength: number;
        isRetestLive: boolean;
        isDimmed: boolean;
      }

      const pendingLabels: PendingLabel[] = [];
      const aboveSet = new Map<string, DojiZone>();
      const belowSet = new Map<string, DojiZone>();

      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textBaseline = 'top';

      for (const zone of zonesToRender) {
        const zoneMid = (zone.high + zone.low) / 2;
        const isSellZone = zoneMid >= refPrice;

        if (isSellZone) {
          aboveSet.set(zone.id, zone);
        } else {
          belowSet.set(zone.id, zone);
        }

        const yHigh = candleSeries.priceToCoordinate(zone.high);
        const yLow = candleSeries.priceToCoordinate(zone.low);

        if (yHigh === null || yLow === null) continue;

        const rectTop = Math.min(yHigh, yLow);
        const rectBottom = Math.max(yHigh, yLow);

        // Check if zone is completely outside the currently visible vertical price range
        if (rectBottom < 2 || rectTop > plotHeight - 2) {
          continue;
        }

        const dojiX = getXForTime(chart, zone.openTimeSec);
        if (dojiX === null) continue;

        // Draw each zone as a clear box from the doji candle to the right edge of the chart (plotWidth)
        const rectStartX = Math.max(0, dojiX);
        const rectEndX = plotWidth;
        const rectWidth = Math.max(0, rectEndX - rectStartX);

        if (rectWidth <= 0 || dojiX > plotWidth) continue;

        const rectY = rectTop;
        const rectHeight = Math.max(2, Math.abs(yLow - yHigh));

        const isArmed = zone.zoneState === 'armed';
        const isBelowMinStrength = zone.strength < minZoneStrengthRef.current;

        // Solid border + visible fill for waiting zones, dashed border for armed zones.
        // Zones with strength below Min strength are drawn lighter but still clearly visible (fill opacity at least 0.12), never nearly invisible.
        const fillColor = isSellZone
          ? isBelowMinStrength
            ? 'rgba(229, 88, 79, 0.13)'
            : isArmed
            ? 'rgba(229, 88, 79, 0.18)'
            : 'rgba(229, 88, 79, 0.22)'
          : isBelowMinStrength
          ? 'rgba(63, 191, 143, 0.13)'
          : isArmed
          ? 'rgba(63, 191, 143, 0.18)'
          : 'rgba(63, 191, 143, 0.22)';

        const strokeColor = isSellZone
          ? isBelowMinStrength
            ? 'rgba(229, 88, 79, 0.55)'
            : '#e5584f'
          : isBelowMinStrength
          ? 'rgba(63, 191, 143, 0.55)'
          : '#3fbf8f';

        // 1) Clear box fill from doji candle to right edge
        ctx.fillStyle = fillColor;
        ctx.fillRect(rectStartX, rectY, rectWidth, rectHeight);

        // 2) Border: solid for waiting zones, dashed for armed zones
        ctx.save();
        if (isArmed) {
          ctx.setLineDash([5, 4]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isBelowMinStrength ? 1 : 1.3;
        ctx.strokeRect(rectStartX, rectY, rectWidth, rectHeight);
        ctx.restore();

        // 3) Hollow marker border on the Doji candle itself
        if (dojiX >= -10 && dojiX <= plotWidth + 10) {
          ctx.save();
          ctx.setLineDash([]);
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 1.5;
          const boxW = 7;
          ctx.strokeRect(dojiX - boxW / 2, rectY - 1, boxW, rectHeight + 2);
          ctx.restore();
        }

        // 4) Label with strength only (e.g. 6.4) in the corner
        const labelText = zone.strength.toFixed(1);
        const textWidth = ctx.measureText(labelText).width;
        const pillText = 'RETEST LIVE';
        const pillW = zone.isRetestLive ? ctx.measureText(pillText).width + 16 : 0;
        const totalW = textWidth + pillW;

        const labelX = Math.max(4, Math.min(rectStartX + 5, Math.max(4, plotWidth - totalW - 6)));
        let rawLabelY = rectHeight < 18 ? rectY - 14 : rectY + 3;
        if (rawLabelY < 2) {
          rawLabelY = Math.min(plotHeight - 14, rectBottom + 3);
        }
        const labelY = Math.max(2, Math.min(rawLabelY, Math.max(2, plotHeight - 14)));

        pendingLabels.push({
          text: labelText,
          x: labelX,
          y: labelY,
          w: textWidth,
          h: 12,
          color: isBelowMinStrength ? 'rgba(240, 234, 219, 0.7)' : zone.strengthColor,
          strength: zone.strength,
          isRetestLive: Boolean(zone.isRetestLive),
          isDimmed: isBelowMinStrength,
        });
      }

      // 5) Draw labels for EVERY zone (only hide if colliding with SL/TP price tags; shift horizontally if two zone labels overlap)
      pendingLabels.sort((a, b) => b.strength - a.strength);
      const placedBoxes: { x1: number; y1: number; x2: number; y2: number }[] = [];

      for (const lbl of pendingLabels) {
        const pillText = 'RETEST LIVE';
        const pillTextW = lbl.isRetestLive ? ctx.measureText(pillText).width : 0;
        const pillTotalW = lbl.isRetestLive ? pillTextW + 16 : 0;

        let curX = lbl.x;
        let curY = lbl.y;

        // Hide zone label ONLY if it collides with any active trade Entry/SL/BE/TP price line
        const collidesWithPriceLine = tradeLineYs.some(
          (lineY) => lineY >= curY - 5 && lineY <= curY + lbl.h + 5
        );
        if (collidesWithPriceLine) {
          continue;
        }

        // If another zone label is at the same position, shift horizontally so both zone labels remain visible
        for (let attempt = 0; attempt < 5; attempt++) {
          const boxW = lbl.w + pillTotalW;
          const overlapping = placedBoxes.find(
            (b) =>
              !(
                curX + boxW + 4 < b.x1 ||
                curX - 4 > b.x2 ||
                curY + lbl.h + 3 < b.y1 ||
                curY - 3 > b.y2
              )
          );
          if (!overlapping) break;
          if (overlapping.x2 + 10 + boxW <= plotWidth - 4) {
            curX = overlapping.x2 + 10;
          } else {
            curY = Math.min(plotHeight - 14, overlapping.y2 + 4);
          }
        }

        // Small dark background patch behind text so candles don't obscure it
        ctx.save();
        ctx.globalAlpha = lbl.isDimmed ? 0.55 : 1.0;
        ctx.fillStyle = 'rgba(10, 9, 7, 0.88)';
        ctx.fillRect(curX - 3, curY - 1, lbl.w + 6, lbl.h + 2);
        ctx.fillStyle = lbl.color;
        ctx.fillText(lbl.text, curX, curY);
        ctx.restore();

        // If live price is touching this armed zone, draw a small "RETEST LIVE" pill on the zone
        if (lbl.isRetestLive) {
          const pillX = curX + lbl.w + 6;
          const pillY = curY - 1;
          const pillW = pillTextW + 10;
          const pillH = lbl.h + 2;

          ctx.save();
          ctx.fillStyle = 'rgba(18, 16, 12, 0.95)';
          ctx.strokeStyle = '#d9b25a';
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(pillX, pillY, pillW, pillH, 4);
          } else {
            ctx.rect(pillX, pillY, pillW, pillH);
          }
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#f2d78f';
          ctx.font = '700 10px "JetBrains Mono", monospace';
          ctx.fillText(pillText, pillX + 5, curY + 0.5);
          ctx.font = '600 11px "JetBrains Mono", monospace';
          ctx.restore();
        }

        placedBoxes.push({
          x1: curX,
          y1: curY,
          x2: curX + lbl.w + pillTotalW,
          y2: curY + lbl.h,
        });
      }

      ctx.restore();

      const getEdgeDist = (z: DojiZone) =>
        refPrice >= z.low && refPrice <= z.high
          ? 0
          : Math.min(Math.abs(refPrice - z.high), Math.abs(refPrice - z.low));

      const aboveList = Array.from(aboveSet.values()).sort(
        (a, b) => getEdgeDist(a) - getEdgeDist(b)
      );
      const belowList = Array.from(belowSet.values()).sort(
        (a, b) => getEdgeDist(a) - getEdgeDist(b)
      );

      // Update off-screen chips state only when changed
      const newKey =
        aboveList.map((z) => `${z.id}:${z.distancePts}:${z.isUsed}`).join('|') +
        '__' +
        belowList.map((z) => `${z.id}:${z.distancePts}:${z.isUsed}`).join('|');

      if (newKey !== offscreenKeyRef.current) {
        offscreenKeyRef.current = newKey;
        setOffscreenAbove(aboveList);
        setOffscreenBelow(belowList);
      }

      animId = requestAnimationFrame(renderOverlay);
    };

    animId = requestAnimationFrame(renderOverlay);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, []);

  // 6. Controls Triggers
  useEffect(() => {
    if (latestTrigger > 0 && chartRef.current) {
      chartRef.current.timeScale().scrollToRealTime();
    }
  }, [latestTrigger]);

  useEffect(() => {
    if (resetTrigger > 0) {
      setLast90CandlesView();
    }
  }, [resetTrigger, setLast90CandlesView]);

  useEffect(() => {
    if (fitZonesTrigger > 0) {
      fitAllZonesView();
    }
  }, [fitZonesTrigger, fitAllZonesView]);

  useEffect(() => {
    if (focusedZoneRequest && focusedZoneRequest.zone.timeframe === timeframe) {
      scrollToZone(focusedZoneRequest.zone);
    }
  }, [focusedZoneRequest, timeframe, scrollToZone]);

  const handleTopChipClick = () => {
    if (offscreenAbove.length === 0) return;
    const idx = aboveCycleIdxRef.current % offscreenAbove.length;
    const target = offscreenAbove[idx];
    aboveCycleIdxRef.current = (idx + 1) % offscreenAbove.length;
    scrollToZone(target);
  };

  const handleBottomChipClick = () => {
    if (offscreenBelow.length === 0) return;
    const idx = belowCycleIdxRef.current % offscreenBelow.length;
    const target = offscreenBelow[idx];
    belowCycleIdxRef.current = (idx + 1) % offscreenBelow.length;
    scrollToZone(target);
  };

  const nearestAbove = offscreenAbove[0];
  const nearestBelow = offscreenBelow[0];

  return (
    <div className="relative w-full bg-[#0a0907] rounded-[8px] border border-[#2b261b] overflow-hidden">
      <div ref={containerRef} className="w-full h-[360px] sm:h-[400px]" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none z-10"
      />

      {/* Pill always showing both sides: "nearest above" (sell/red) and "nearest below" (buy/green) */}
      {showZones && (
        <div className="absolute top-2 left-2 right-[65px] z-20 flex flex-wrap items-center gap-1.5 pointer-events-none">
          <div className="pointer-events-auto px-2.5 py-1 rounded bg-[#12100c]/95 border border-[#d9b25a]/60 text-[11px] font-['JetBrains_Mono',monospace] tabular-nums text-[#f0eadb] flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleTopChipClick}
              disabled={!nearestAbove}
              className={`flex items-center gap-1 transition-colors ${
                nearestAbove ? 'cursor-pointer hover:text-[#f2d78f]' : 'cursor-default opacity-75'
              }`}
              title="Sell zones above current price"
            >
              <span className="text-[#e5584f] font-bold">▲</span>
              <span className="font-semibold">
                {offscreenAbove.length}
              </span>
              <span className="text-[#9d947e]">·</span>
              <span className="text-[#9d947e]">nearest above</span>
              {nearestAbove ? (
                <>
                  <span className="font-semibold text-[#f2d78f]">
                    {nearestAbove.low.toFixed(2)}
                  </span>
                  <span className="text-[#e5584f]">
                    (+${Math.round(Math.abs(nearestAbove.distancePts))})
                  </span>
                </>
              ) : (
                <span className="text-[#9d947e]">none</span>
              )}
            </button>

            <span className="text-[#2b261b]">|</span>

            <button
              type="button"
              onClick={handleBottomChipClick}
              disabled={!nearestBelow}
              className={`flex items-center gap-1 transition-colors ${
                nearestBelow ? 'cursor-pointer hover:text-[#f2d78f]' : 'cursor-default opacity-75'
              }`}
              title="Buy zones below current price"
            >
              <span className="text-[#3fbf8f] font-bold">▼</span>
              <span className="font-semibold">
                {offscreenBelow.length}
              </span>
              <span className="text-[#9d947e]">·</span>
              <span className="text-[#9d947e]">nearest below</span>
              {nearestBelow ? (
                <>
                  <span className="font-semibold text-[#f2d78f]">
                    {nearestBelow.high.toFixed(2)}
                  </span>
                  <span className="text-[#3fbf8f]">
                    (–${Math.round(Math.abs(nearestBelow.distancePts))})
                  </span>
                </>
              ) : (
                <span className="text-[#9d947e]">none</span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

