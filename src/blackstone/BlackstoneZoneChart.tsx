import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineStyle,
  CrosshairMode,
  ColorType,
  IPriceLine,
} from 'lightweight-charts';
import type {
  BlackstoneEvaluatedZone,
  BlackstoneZoneId,
  BlackstoneReferenceLevelItem,
} from '../server/blackstoneEngine';
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

export interface BlackstoneZoneChartProps {
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
  focusSeq?: number;
  referenceLevels?: BlackstoneReferenceLevelItem[];
}

interface CandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface ZoneHitBox {
  id: BlackstoneZoneId;
  x: number;
  y: number;
  w: number;
  h: number;
}

const TIMEFRAMES: BlackstoneChartTimeframe[] = ['M5', 'M15', 'H1'];
const DUBAI_OFFSET_SEC = 4 * 3600;

function isoToDubaiChartSec(iso: string): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (isNaN(ms)) return null;
  return Math.floor(ms / 1000) + DUBAI_OFFSET_SEC;
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
  focusSeq = 0,
  referenceLevels = [],
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const tradeLinesRef = useRef<IPriceLine[]>([]);
  const zoneHitBoxesRef = useRef<ZoneHitBox[]>([]);

  const [offscreenAbove, setOffscreenAbove] = useState<BlackstoneEvaluatedZone[]>([]);
  const [offscreenBelow, setOffscreenBelow] = useState<BlackstoneEvaluatedZone[]>([]);
  const offscreenSigRef = useRef<string>('');

  const zonesRef = useRef<BlackstoneEvaluatedZone[]>(zones);
  zonesRef.current = zones;
  const referenceLevelsRef = useRef<BlackstoneReferenceLevelItem[]>(referenceLevels);
  referenceLevelsRef.current = referenceLevels;
  const selectedZoneIdRef = useRef<BlackstoneZoneId | null>(selectedZoneId);
  selectedZoneIdRef.current = selectedZoneId;
  const lockTimeIsoRef = useRef<string>(lockTimeIso);
  lockTimeIsoRef.current = lockTimeIso;
  const livePriceRef = useRef<number | null>(livePrice);
  livePriceRef.current = livePrice;
  const isFeedLiveRef = useRef<boolean>(isFeedLive);
  isFeedLiveRef.current = isFeedLive;
  const activeTradeRef = useRef<LivePlanTrade | null | undefined>(activeTrade);
  activeTradeRef.current = activeTrade;

  const uniqueCandlesRef = useRef<CandlePoint[]>([]);
  const initializedTfRef = useRef<BlackstoneChartTimeframe | null>(null);
  const lastFocusKeyRef = useRef<string>('');

  const scaleModeRef = useRef<{
    mode: 'normal' | 'focus_zone';
    targetZone: BlackstoneEvaluatedZone | null;
  }>({
    mode: 'normal',
    targetZone: null,
  });

  const recenterChart = useCallback(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const total = uniqueCandlesRef.current.length;
    if (!chart || total === 0) return;

    scaleModeRef.current = { mode: 'normal', targetZone: null };

    const visibleBars = window.innerWidth < 480 ? 48 : 72;
    const from = Math.max(0, total - visibleBars);
    const to = Math.max(0, total - 1) + 8;

    chart.timeScale().setVisibleLogicalRange({ from, to });
    chart.priceScale('right').applyOptions({ autoScale: true });
    if (candleSeries) {
      candleSeries.applyOptions({});
    }
  }, []);

  const zoomToZone = useCallback((zone: BlackstoneEvaluatedZone) => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const total = uniqueCandlesRef.current.length;
    if (!chart || total === 0) return;

    scaleModeRef.current = { mode: 'focus_zone', targetZone: zone };

    const candlesList = uniqueCandlesRef.current;
    const zoneStartSec =
      isoToDubaiChartSec(zone.baseStartIso || zone.formedAtIso) ?? candlesList[0].time;

    let startIdx = 0;
    for (let i = 0; i < candlesList.length; i++) {
      if (candlesList[i].time >= zoneStartSec) {
        startIdx = i;
        break;
      }
    }

    const defaultBars = window.innerWidth < 480 ? 48 : 72;
    const from =
      startIdx > total - 90
        ? Math.max(0, Math.min(startIdx - 6, total - defaultBars))
        : Math.max(0, total - defaultBars);
    const to = Math.max(0, total - 1) + 8;

    chart.timeScale().setVisibleLogicalRange({ from, to });
    chart.priceScale('right').applyOptions({ autoScale: true });
    if (candleSeries) {
      candleSeries.applyOptions({});
    }
  }, []);

  // 1. Initialize Lightweight Charts instance
  useEffect(() => {
    if (!containerRef.current) return;

    const chartCreator = (window as any).LightweightCharts?.createChart || createChart;
    const initWidth = containerRef.current.clientWidth || 720;
    const initHeight = containerRef.current.clientHeight || 420;

    const chart: IChartApi = chartCreator(containerRef.current, {
      width: initWidth,
      height: initHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#060608' },
        textColor: '#8e8779',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#111114' },
        horzLines: { color: '#111114' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#d9b25a',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#171510',
        },
        horzLine: {
          color: '#d9b25a',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#d9b25a',
        },
      },
      rightPriceScale: {
        borderColor: '#1f1d18',
        textColor: '#f4efe6',
        scaleMargins: { top: 0.12, bottom: 0.12 },
        autoScale: true,
      },
      timeScale: {
        borderColor: '#1f1d18',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 8,
        minBarSpacing: 2,
      },
      localization: {
        timeFormatter: (utcTimestamp: number) => {
          const d = new Date(utcTimestamp * 1000);
          return new Intl.DateTimeFormat('en-GB', {
            timeZone: 'UTC',
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
      priceLineVisible: true,
      lastValueVisible: true,
      priceLineColor: '#d9b25a',
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dotted,
      autoscaleInfoProvider: (original: () => any) => {
        const res = original();
        const modeInfo = scaleModeRef.current;
        const candlesArr = uniqueCandlesRef.current;
        const fallbackRef =
          livePriceRef.current && livePriceRef.current > 0
            ? livePriceRef.current
            : candlesArr.length > 0
              ? candlesArr[candlesArr.length - 1].close
              : null;

        if (modeInfo.mode === 'focus_zone' && modeInfo.targetZone) {
          const z = modeInfo.targetZone;
          const span = Math.max(2.5, z.high - z.low);
          const pad = Math.max(5.5, span * 2.8);
          let minVal = z.low - pad;
          let maxVal = z.high + pad;
          if (fallbackRef !== null && Math.abs(z.level - fallbackRef) <= 32) {
            minVal = Math.min(minVal, fallbackRef - 3.5);
            maxVal = Math.max(maxVal, fallbackRef + 3.5);
          }
          return {
            priceRange: {
              minValue: minVal,
              maxValue: maxVal,
            },
          };
        }

        if (!res || !res.priceRange) return res;

        let minVal = res.priceRange.minValue;
        let maxVal = res.priceRange.maxValue;

        if (fallbackRef !== null) {
          const allZones = zonesRef.current;
          const nearestAbove = allZones
            .filter((z) => z.level >= fallbackRef)
            .sort((a, b) => a.level - b.level)[0];
          const nearestBelow = allZones
            .filter((z) => z.level < fallbackRef)
            .sort((a, b) => b.level - a.level)[0];

          if (nearestAbove && nearestAbove.high - fallbackRef <= 28) {
            maxVal = Math.max(maxVal, nearestAbove.high + 1.8);
          }
          if (nearestBelow && fallbackRef - nearestBelow.low <= 28) {
            minVal = Math.min(minVal, nearestBelow.low - 1.8);
          }
        }

        return {
          ...res,
          priceRange: {
            minValue: minVal,
            maxValue: maxVal,
          },
        };
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

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
    };
  }, []);

  // 2. Populate candle series when candles or timeframe change
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries || !candles || candles.length === 0) return;

    const formatted: CandlePoint[] = [];
    for (const c of candles) {
      const timeSec = isoToDubaiChartSec(c.openTime);
      if (timeSec !== null) {
        formatted.push({
          time: timeSec,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        });
      }
    }

    formatted.sort((a, b) => a.time - b.time);

    const unique: CandlePoint[] = [];
    const seen = new Set<number>();
    for (const item of formatted) {
      if (!seen.has(item.time)) {
        seen.add(item.time);
        unique.push(item);
      }
    }

    // Merge current live price into the latest candle if feed is live
    if (isFeedLive && livePrice && livePrice > 0 && unique.length > 0) {
      const lastIdx = unique.length - 1;
      const last = unique[lastIdx];
      unique[lastIdx] = {
        ...last,
        high: Math.max(last.high, livePrice),
        low: Math.min(last.low, livePrice),
        close: livePrice,
      };
    }

    uniqueCandlesRef.current = unique;
    candleSeries.setData(unique as any);

    if (initializedTfRef.current !== timeframe) {
      initializedTfRef.current = timeframe;
      recenterChart();
    }
  }, [candles, timeframe, isFeedLive, livePrice, recenterChart]);

  // 3. Live price tick update on latest bar
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const unique = uniqueCandlesRef.current;
    if (!candleSeries || !isFeedLive || !livePrice || livePrice <= 0 || unique.length === 0) {
      return;
    }

    const lastIdx = unique.length - 1;
    const last = unique[lastIdx];
    const updated: CandlePoint = {
      ...last,
      high: Math.max(last.high, livePrice),
      low: Math.min(last.low, livePrice),
      close: livePrice,
    };
    unique[lastIdx] = updated;

    try {
      candleSeries.update(updated as any);
    } catch {
      // ignore transient ordering issue
    }
  }, [livePrice, isFeedLive]);

  // 4. Zoom to selected zone when user taps a Level Map row (focusSeq > 0)
  useEffect(() => {
    if (!selectedZoneId || focusSeq <= 0) return;
    const key = `${selectedZoneId}:${focusSeq}`;
    if (lastFocusKeyRef.current === key) return;
    lastFocusKeyRef.current = key;

    const target = zones.find((z) => z.id === selectedZoneId);
    if (target) {
      zoomToZone(target);
    }
  }, [selectedZoneId, focusSeq, zones, zoomToZone]);

  // 5. Active trade price lines on Lightweight Charts
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;

    for (const line of tradeLinesRef.current) {
      try {
        candleSeries.removePriceLine(line);
      } catch {
        // ignore
      }
    }
    tradeLinesRef.current = [];

    if (!activeTrade || activeTrade.status !== 'ACTIVE') return;

    try {
      const created: IPriceLine[] = [];

      created.push(
        candleSeries.createPriceLine({
          price: activeTrade.entryPrice,
          color: '#d9b25a',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `ENTRY ${activeTrade.side}`,
        })
      );

      created.push(
        candleSeries.createPriceLine({
          price: activeTrade.currentStopLoss,
          color: activeTrade.beMoved ? '#8e8779' : '#e5584f',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: activeTrade.beMoved ? 'BE' : 'SL',
        })
      );

      if (!activeTrade.tp1.hit) {
        created.push(
          candleSeries.createPriceLine({
            price: activeTrade.tp1.price,
            color: '#3fbf8f',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'TP1',
          })
        );
      }

      if (!activeTrade.tp2.hit) {
        created.push(
          candleSeries.createPriceLine({
            price: activeTrade.tp2.price,
            color: '#3fbf8f',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'TP2',
          })
        );
      }

      if (!activeTrade.tp3.hit) {
        created.push(
          candleSeries.createPriceLine({
            price: activeTrade.tp3.price,
            color: '#d9b25a',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'TP3',
          })
        );
      }

      tradeLinesRef.current = created;
    } catch {
      // ignore
    }
  }, [activeTrade]);

  // 6. Synchronized Overlay Canvas: Zones (move with candles) + 04:00 Lock Marker
  useEffect(() => {
    let animId: number;

    const getXForTimeSec = (chart: IChartApi, timeSec: number): number | null => {
      const directX = chart.timeScale().timeToCoordinate(timeSec as any);
      if (directX !== null) return directX;

      const candlesList = uniqueCandlesRef.current;
      if (candlesList.length === 0) return null;

      if (timeSec <= candlesList[0].time) {
        return chart.timeScale().logicalToCoordinate(0 as any);
      }

      let idx = candlesList.length - 1;
      for (let i = 0; i < candlesList.length; i++) {
        if (candlesList[i].time >= timeSec) {
          idx = i;
          break;
        }
      }
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

      const candlesList = uniqueCandlesRef.current;
      if (candlesList.length === 0) {
        animId = requestAnimationFrame(renderOverlay);
        return;
      }

      const plotWidth = chart.timeScale().width() || Math.max(180, width - 64);
      const plotHeight = Math.max(0, height - 26);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, plotWidth, plotHeight);
      ctx.clip();

      const lastIdx = candlesList.length - 1;
      const currentBarX =
        chart.timeScale().logicalToCoordinate(lastIdx as any) ??
        getXForTimeSec(chart, candlesList[lastIdx].time);
      const rightEdgeBarX =
        chart.timeScale().logicalToCoordinate((lastIdx + 4) as any) ??
        (currentBarX !== null ? currentBarX + 28 : plotWidth - 8);

      // A. Draw 04:00 Lock Marker vertical line + badge moving with candles
      const lockSec = isoToDubaiChartSec(lockTimeIsoRef.current);
      if (lockSec !== null) {
        const lockX = getXForTimeSec(chart, lockSec);
        if (lockX !== null && lockX >= 2 && lockX <= plotWidth - 2) {
          ctx.save();
          ctx.strokeStyle = 'rgba(217, 178, 90, 0.45)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(lockX, 0);
          ctx.lineTo(lockX, plotHeight);
          ctx.stroke();
          ctx.setLineDash([]);

          const tagText = '04:00 LOCK';
          ctx.font = '700 9.5px "JetBrains Mono", monospace';
          const tw = ctx.measureText(tagText).width;
          const boxW = tw + 12;
          const boxH = 17;
          const boxX = Math.max(4, Math.min(plotWidth - boxW - 4, lockX - boxW / 2));
          const boxY = plotHeight - boxH - 4;

          ctx.fillStyle = 'rgba(14, 13, 10, 0.94)';
          ctx.fillRect(boxX, boxY, boxW, boxH);
          ctx.strokeStyle = 'rgba(217, 178, 90, 0.65)';
          ctx.lineWidth = 1;
          ctx.strokeRect(boxX, boxY, boxW, boxH);

          ctx.fillStyle = '#d9b25a';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(tagText, boxX + boxW / 2, boxY + boxH / 2 + 0.5);
          ctx.restore();
        }
      }

      // B. Draw Zones (rectangles that move with candles horizontally & vertically)
      const hitBoxes: ZoneHitBox[] = [];
      const aboveOff: BlackstoneEvaluatedZone[] = [];
      const belowOff: BlackstoneEvaluatedZone[] = [];

      for (const z of zonesRef.current) {
        const yHigh = candleSeries.priceToCoordinate(z.high);
        const yLow = candleSeries.priceToCoordinate(z.low);
        if (yHigh === null || yLow === null) continue;

        const rawTop = Math.min(yHigh, yLow);
        const rawBottom = Math.max(yHigh, yLow);

        if (rawBottom < 2) {
          aboveOff.push(z);
          continue;
        }
        if (rawTop > plotHeight - 2) {
          belowOff.push(z);
          continue;
        }

        const startSec =
          isoToDubaiChartSec(z.baseStartIso || z.formedAtIso) ?? candlesList[0].time;
        const rawStartX = getXForTimeSec(chart, startSec) ?? 0;
        const rawEndX = Math.max(rawStartX + 28, rightEdgeBarX);

        if (rawEndX < 0 || rawStartX > plotWidth) continue;

        const rectX = Math.max(2, rawStartX);
        const rectEndX = Math.min(plotWidth - 2, rawEndX);
        const rectW = Math.max(16, rectEndX - rectX);

        const minBandH = 14;
        const naturalH = Math.abs(rawBottom - rawTop);
        const rectH = Math.max(minBandH, naturalH);
        const rectY =
          naturalH < minBandH ? (rawTop + rawBottom) / 2 - minBandH / 2 : rawTop;

        hitBoxes.push({ id: z.id, x: rectX, y: rectY, w: rectW, h: rectH });

        const isSelected = selectedZoneIdRef.current === z.id;
        const isBuy = z.side === 'buy side';
        const isCore = Boolean(z.isSarrafCore || z.id === 'SARRAF_CORE');

        // Fill: Sell zone red, Buy zone green
        ctx.fillStyle = isBuy
          ? isSelected
            ? 'rgba(63, 191, 143, 0.19)'
            : 'rgba(63, 191, 143, 0.09)'
          : isSelected
            ? 'rgba(229, 88, 79, 0.19)'
            : 'rgba(229, 88, 79, 0.09)';
        ctx.fillRect(rectX, rectY, rectW, rectH);

        // Dotted border rectangle
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = isBuy
          ? isSelected
            ? '#3fbf8f'
            : 'rgba(63, 191, 143, 0.82)'
          : isSelected
            ? '#e5584f'
            : 'rgba(229, 88, 79, 0.82)';
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.strokeRect(rectX, rectY, rectW, rectH);
        ctx.restore();

        // Cyan strip on the left edge for Sarraf Core zone
        if (isCore) {
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(rectX, rectY, 4, rectH);
        }

        // Label with Name and Grade
        const labelText = `${z.name} · ${z.grade}`;
        ctx.font = '600 10.5px "JetBrains Mono", monospace';
        const textW = ctx.measureText(labelText).width;
        const padX = 5;
        const boxW = textW + padX * 2;
        const boxH = 16;

        const labelX = Math.min(
          Math.max(rectX + (isCore ? 8 : 5), 6),
          Math.max(6, plotWidth - boxW - 6)
        );
        const labelY = rectH >= 20 ? rectY + 3 : Math.max(2, rectY - boxH - 2);

        ctx.fillStyle = 'rgba(10, 10, 12, 0.88)';
        ctx.fillRect(labelX, labelY, boxW, boxH);

        ctx.fillStyle = isCore ? '#38bdf8' : isBuy ? '#3fbf8f' : '#e5584f';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, labelX + padX, labelY + boxH / 2 + 0.5);
      }

      // C. Draw active Reference Levels (Day / Camarilla / Profile / ADR) if within visible plot
      if (referenceLevelsRef.current && referenceLevelsRef.current.length > 0) {
        const usedLabelYs: number[] = [];
        for (const refItem of referenceLevelsRef.current) {
          const yCoord = candleSeries.priceToCoordinate(refItem.price);
          if (yCoord === null || yCoord < 8 || yCoord > plotHeight - 8) continue;

          const color =
            refItem.category === 'DAY'
              ? '#d9b25a'
              : refItem.category === 'CAMARILLA'
                ? '#a78bfa'
                : refItem.category === 'PROFILE'
                  ? '#38bdf8'
                  : '#f59e0b';

          ctx.save();
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.48;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(0, yCoord);
          ctx.lineTo(plotWidth, yCoord);
          ctx.stroke();
          ctx.restore();

          // Avoid colliding reference tags vertically
          if (usedLabelYs.some((uy) => Math.abs(uy - yCoord) < 13)) continue;
          usedLabelYs.push(yCoord);

          const tag = `${refItem.label} ${refItem.price.toFixed(2)}`;
          ctx.font = '600 9.5px "JetBrains Mono", monospace';
          const tw = ctx.measureText(tag).width;
          const bw = tw + 8;
          const bh = 14;
          const bx = Math.max(4, plotWidth - bw - 6);
          const by = Math.max(2, Math.min(plotHeight - bh - 2, yCoord - bh / 2));

          ctx.fillStyle = 'rgba(8, 8, 10, 0.88)';
          ctx.fillRect(bx, by, bw, bh);
          ctx.fillStyle = color;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(tag, bx + 4, by + bh / 2 + 0.5);
        }
      }

      zoneHitBoxesRef.current = hitBoxes;
      ctx.restore();

      const nextSig = `${aboveOff.map((z) => z.id).join(',')}|${belowOff.map((z) => z.id).join(',')}`;
      if (offscreenSigRef.current !== nextSig) {
        offscreenSigRef.current = nextSig;
        setOffscreenAbove(aboveOff.sort((a, b) => a.level - b.level));
        setOffscreenBelow(belowOff.sort((a, b) => b.level - a.level));
      }

      animId = requestAnimationFrame(renderOverlay);
    };

    animId = requestAnimationFrame(renderOverlay);
    return () => cancelAnimationFrame(animId);
  }, []);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    for (const box of zoneHitBoxesRef.current) {
      if (x >= box.x && x <= box.x + box.w && y >= box.y - 4 && y <= box.y + box.h + 4) {
        onSelectZone(box.id);
        return;
      }
    }
  };

  return (
    <div
      className="rounded-[12px] p-3.5 sm:p-4 space-y-3"
      style={{
        backgroundColor: '#0b0b0e',
        border: '1px solid #1f1d18',
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {/* Top Toolbar: Title, Timeframe M5/M15/H1, Re-center */}
      <div
        className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5"
        style={{ borderBottom: '1px solid #1f1d18' }}
      >
        <div className="flex items-center gap-2">
          <h2
            className="text-xs font-bold uppercase tracking-wider text-[#f4efe6]"
            style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
          >
            ZONES CHART
          </h2>
          {isMarketClosed && (
            <span
              className="text-[11px] text-[#d9b25a]"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              · Market closed
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Timeframe Selector: M5 / M15 / H1 */}
          <div
            className="flex items-center gap-1 rounded-[8px] p-0.5"
            style={{
              backgroundColor: '#12110e',
              border: '1px solid #26231c',
            }}
          >
            {TIMEFRAMES.map((tf) => {
              const active = timeframe === tf;
              return (
                <button
                  key={tf}
                  type="button"
                  onClick={() => onChangeTimeframe(tf)}
                  className={`px-2.5 py-1 rounded-[6px] text-xs font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#d9b25a] text-[#090806] font-bold'
                      : 'text-[#8e8779] hover:text-[#f4efe6]'
                  }`}
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {tf}
                </button>
              );
            })}
          </div>

          {/* Re-center Button */}
          <button
            type="button"
            onClick={recenterChart}
            className="px-2.5 py-1 rounded-[8px] text-xs font-semibold text-[#f4efe6] hover:text-[#f2d78f] transition-colors cursor-pointer"
            style={{
              backgroundColor: '#12110e',
              border: '1px solid #26231c',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Re-center
          </button>
        </div>
      </div>

      {/* News Pause Strip if active */}
      {newsPauseNotice && (
        <div
          className="rounded-[8px] px-3 py-1.5 text-xs font-semibold flex items-center justify-between gap-2"
          style={{
            backgroundColor: 'rgba(229, 88, 79, 0.12)',
            border: '1px solid rgba(229, 88, 79, 0.4)',
            color: '#e5584f',
          }}
        >
          <span>News pause: {newsPauseNotice}</span>
        </div>
      )}

      {/* Lightweight Charts Container + Synchronized Zone/Lock Canvas Overlay */}
      <div
        onClick={handleOverlayClick}
        className="relative w-full h-[380px] sm:h-[440px] rounded-[10px] overflow-hidden select-none"
        style={{
          backgroundColor: '#060608',
          border: '1px solid #1f1d18',
        }}
      >
        <div ref={containerRef} className="w-full h-full" />
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 w-full h-full z-10"
        />

        {/* Offscreen Above Zone Chip */}
        {offscreenAbove.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const target = offscreenAbove[0];
              onSelectZone(target.id);
              zoomToZone(target);
            }}
            className="absolute top-2 left-2 z-20 px-2.5 py-1 rounded-[6px] text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
            style={{
              backgroundColor: 'rgba(12, 11, 9, 0.92)',
              border: '1px solid rgba(229, 88, 79, 0.45)',
              color: '#f4efe6',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <span className="text-[#e5584f]">▲</span>
            <span>
              {offscreenAbove[0].name} · {offscreenAbove[0].grade} (
              {offscreenAbove[0].level.toFixed(2)})
            </span>
          </button>
        )}

        {/* Offscreen Below Zone Chip */}
        {offscreenBelow.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const target = offscreenBelow[0];
              onSelectZone(target.id);
              zoomToZone(target);
            }}
            className="absolute bottom-8 left-2 z-20 px-2.5 py-1 rounded-[6px] text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
            style={{
              backgroundColor: 'rgba(12, 11, 9, 0.92)',
              border: '1px solid rgba(63, 191, 143, 0.45)',
              color: '#f4efe6',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <span className="text-[#3fbf8f]">▼</span>
            <span>
              {offscreenBelow[0].name} · {offscreenBelow[0].grade} (
              {offscreenBelow[0].level.toFixed(2)})
            </span>
          </button>
        )}
      </div>

      {/* Compact Legend */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8e8779] pt-0.5"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        <div className="flex flex-wrap items-center gap-3.5">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-[2px] bg-[#e5584f] inline-block" />
            <span>Sell zone</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-[2px] bg-[#3fbf8f] inline-block" />
            <span>Buy zone</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1 h-3 bg-[#38bdf8] inline-block" />
            <span>Sarraf Core</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-[2px] bg-[#d9b25a] inline-block" />
            <span>Live / 04:00 Lock</span>
          </span>
        </div>
      </div>
    </div>
  );
};
