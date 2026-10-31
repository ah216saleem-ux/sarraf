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
import {
  DualStructureResult,
  computeVisibleAutoscaleRange,
} from '../fireZone/structure';
import {
  ChartLayerToggles,
  ChartModelZone,
  ChartOverlayTradeLine,
  FireZoneChartModel,
  drawFireZoneCanvasOverlay,
} from '../fireZone/chartOverlay';

interface RedSniperChartProps {
  tf: RedSniperTimeframe;
  candles: Candle[];
  atr14: number;
  zones: RedSniperZone[];
  structures: StructureEvent[];
  dualStructure?: DualStructureResult;
  showBosChoch: boolean;
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
  dualStructure,
  showBosChoch,
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
    dualStructure,
    showBosChoch,
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
    dualStructure,
    showBosChoch,
    openTrades,
    pendingPlan,
    livePrice,
  };

  const redrawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!canvas || !chart || !series) return;

    const {
      tf: curTf,
      candles: curCandles,
      atr14: curAtr,
      zones: curZones,
      dualStructure: curDual,
      showBosChoch: curShowBosChoch,
      openTrades: curOpenTrades,
      livePrice: curLivePrice,
    } = propsRef.current;

    const effectiveLivePrice =
      typeof curLivePrice === 'number' && curLivePrice > 0
        ? curLivePrice
        : curCandles.length > 0
        ? curCandles[curCandles.length - 1].close
        : 0;

    const mappedZones: ChartModelZone[] = curZones.map((z) => {
      const state: 'FRESH' | 'TESTING' =
        effectiveLivePrice > 0 &&
        effectiveLivePrice >= z.bottom &&
        effectiveLivePrice <= z.top
          ? 'TESTING'
          : 'FRESH';

      return {
        id: z.id,
        side: z.side,
        anchor: z.anchor,
        HI: z.top,
        LO: z.bottom,
        top: z.top,
        bottom: z.bottom,
        strength: z.strengthLabel,
        score: z.score,
        type: z.slotType,
        state,
        isStar: z.slotType === 'NEAREST',
        isActive: z.slotType === 'NEAREST',
        pivotTime: z.pivotTime,
        pivotIndex: z.pivotIdx,
        distance:
          effectiveLivePrice > z.top
            ? Number((effectiveLivePrice - z.top).toFixed(2))
            : effectiveLivePrice < z.bottom
            ? Number((z.bottom - effectiveLivePrice).toFixed(2))
            : 0,
        power: z.power,
        statusLabel: z.status,
        pctLeft: z.pctLeft,
        retests: z.retests,
        customLabel: `${z.side} · ${z.status} · PWR ${z.power} · ${z.pctLeft}% left · ${z.retests}x`,
      };
    });

    const tradeLines: ChartOverlayTradeLine[] = [];
    for (const tr of curOpenTrades) {
      if (tr.tf !== curTf) continue;
      tradeLines.push({
        price: tr.entry,
        label: tr.beMoved ? `${tr.side} ENTRY (BE)` : `${tr.side} ENTRY`,
        color: '#00e5ff',
        dashed: false,
      });

      // Before TP1 is hit, draw STOP line.
      // At break-even (after TP1 before trailing past entry), HIDE the SL line.
      // Once SL has trailed past entry in the profit direction, show it again labelled "TRAIL".
      if (!tr.beMoved) {
        tradeLines.push({
          price: tr.sl,
          label: 'STOP',
          color: '#ff4d66',
          dashed: true,
        });
      } else if (tr.isTrailing) {
        tradeLines.push({
          price: tr.sl,
          label: 'TRAIL',
          color: '#2ee6a0',
          dashed: true,
        });
      }

      if (!tr.tp1Hit) {
        tradeLines.push({
          price: tr.tp1,
          label: 'T1 (1R)',
          color: '#2ee6a0',
          dashed: true,
        });
      }
      if (!tr.tp2Hit) {
        tradeLines.push({
          price: tr.tp2,
          label: 'T2 (2R)',
          color: '#2ee6a0',
          dashed: true,
        });
      }
      tradeLines.push({
        price: tr.tp3,
        label: tr.tp3IsLiquidity ? 'T3 (LIQ)' : 'T3 (3R)',
        color: '#f2b94b',
        dashed: false,
      });
    }

    const model: FireZoneChartModel = {
      currentPrice: effectiveLivePrice,
      atr: curAtr,
      activeSide: 'BUY',
      zones: mappedZones,
      levels: [],
      planLines: [],
      buyNearestPlan: null,
      sellNearestPlan: null,
      simpleLadder: [],
      structureBreaks: {
        internal: curDual?.internal.breaks ?? [],
        swing: curDual?.swing.breaks ?? [],
        confirmedSwingPivots: curDual?.swing.confirmedPivots ?? [],
      },
      ladder: [],
    };

    const toggles: ChartLayerToggles = {
      showInternal: curShowBosChoch,
      showSwing: curShowBosChoch,
      showLabels: true,
      mode: 'RED_SNIPER',
      showEdgeMarkers: true,
      tradeLines,
    };

    drawFireZoneCanvasOverlay(
      canvas,
      chart,
      series,
      model,
      toggles,
      0,
      curCandles,
      effectiveLivePrice
    );
  }, []);

  // Initialize chart once using the exact Fire Zone chart setup (up #2ee6a0, down #ff5d6c, height 430)
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
          zones: curZones,
          openTrades: curOpenTrades,
          pendingPlan: curPending,
          livePrice: curLive,
        } = propsRef.current;

        if (!bars || bars.length === 0) return null;
        const range = chart.timeScale().getVisibleLogicalRange();
        const from = range ? range.from : Math.max(0, bars.length - 100);
        const to = range ? range.to : bars.length - 1;

        const refPrice =
          typeof curLive === 'number' && curLive > 0
            ? curLive
            : bars[bars.length - 1].close;
        const safeAtr = Math.max(0.5, curAtr || 2.5);

        const nearestBuy = curZones.find(
          (z) => z.side === 'BUY' && z.slotType === 'NEAREST'
        );
        const nearestSell = curZones.find(
          (z) => z.side === 'SELL' && z.slotType === 'NEAREST'
        );

        const extraPrices: number[] = [];
        for (const tr of curOpenTrades) {
          if (tr.tf !== curTf) continue;
          extraPrices.push(tr.entry, tr.tp3);
          if (!tr.beMoved || tr.isTrailing) extraPrices.push(tr.sl);
          if (!tr.tp1Hit) extraPrices.push(tr.tp1);
          if (!tr.tp2Hit) extraPrices.push(tr.tp2);
        }

        if (
          curPending &&
          refPrice > 0 &&
          Math.abs(curPending.entry - refPrice) <= 1.5 * safeAtr
        ) {
          extraPrices.push(curPending.entry);
        }

        const vr = computeVisibleAutoscaleRange(bars, from, to, {
          nearestBuy: nearestBuy
            ? {
                bottom: nearestBuy.bottom,
                top: nearestBuy.top,
                anchor: nearestBuy.anchor,
              }
            : null,
          nearestSell: nearestSell
            ? {
                bottom: nearestSell.bottom,
                top: nearestSell.top,
                anchor: nearestSell.anchor,
              }
            : null,
          currentPrice: refPrice,
          atr: safeAtr,
          includeNearestZones: true,
          extraPricesToInclude: extraPrices,
        });

        if (!vr) return null;
        return {
          priceRange: {
            minValue: vr.minValue,
            maxValue: vr.maxValue,
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

  // Update candle & tick-volume data and redraw overlay
  useEffect(() => {
    const cs = candleSeriesRef.current;
    const vs = volumeSeriesRef.current;
    const chart = chartRef.current;
    if (!cs || !vs || !chart) return;

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

    const tfChanged = prevTfRef.current !== tf;
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
        chart.timeScale().applyOptions({ rightOffset: 6 });
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, len - 100),
          to: len - 1 + 6,
        });
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
    dualStructure,
    showBosChoch,
    openTrades,
    pendingPlan,
    livePrice,
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
