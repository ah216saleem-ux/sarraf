// src/fireZone/FireZoneChart.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ColorType,
  CrosshairMode,
  UTCTimestamp,
} from 'lightweight-charts';
import { Candle, FireZoneEngineResult } from './types';
import { ChartTimeframe, fetchChartCandlesByTimeframe } from './feed';
import { computeVisibleAutoscaleRange } from './structure';
import {
  EdgeZoneBadge,
  ChartLayerToggles,
  FireZoneChartModel,
  buildChartModel,
  computeOutOfRangeZoneBadges,
  drawFireZoneCanvasOverlay,
} from './chartOverlay';

const CHART_HEIGHT = 430;

const TIMEFRAME_BUTTONS: Array<{ id: ChartTimeframe; label: string }> = [
  { id: '15m', label: '15m' },
  { id: '30m', label: '30m' },
  { id: '1h', label: '1H' },
  { id: '4h', label: '4H' },
  { id: '1d', label: '1D' },
];

// In-memory cache of chart-only timeframe candles
const chartTimeframeCache = new Map<ChartTimeframe, Candle[]>();

const cardStyle: React.CSSProperties = {
  background: 'var(--card, #0d1117)',
  border: '1px solid var(--bd, #1a212b)',
  borderRadius: '14px',
  padding: '15px',
  marginTop: '11px',
  fontFamily: "'Manrope', sans-serif",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

interface Props {
  candles: Candle[];
  dataReloadSeq: number;
  engineResult: FireZoneEngineResult;
  chartModel?: FireZoneChartModel;
  currentPrice?: number;
  isLoading: boolean;
}

export const FireZoneChart: React.FC<Props> = ({
  candles,
  dataReloadSeq,
  engineResult,
  chartModel: propChartModel,
  currentPrice: propCurrentPrice,
  isLoading,
}) => {
  const resolvedModel = useMemo(
    () => propChartModel ?? buildChartModel(engineResult),
    [propChartModel, engineResult]
  );

  const livePrice = propCurrentPrice ?? resolvedModel.currentPrice;

  const [activeTf, setActiveTf] = useState<ChartTimeframe>('1h');
  const [tfCandles, setTfCandles] = useState<Candle[]>(candles);
  const [tfLoading, setTfLoading] = useState<boolean>(false);
  const [tfDatasetVersion, setTfDatasetVersion] = useState<number>(0);

  const activeTfRef = useRef<ChartTimeframe>(activeTf);
  activeTfRef.current = activeTf;

  // Keep 1h cache synced with the main H1 candles
  useEffect(() => {
    if (candles.length > 0) {
      chartTimeframeCache.set('1h', candles);
      if (activeTfRef.current === '1h') {
        setTfCandles(candles);
      }
    }
  }, [candles]);

  // Reload full series when H1 closed snapshot reloads while on 1H
  useEffect(() => {
    if (activeTfRef.current === '1h' && candles.length > 0) {
      setTfDatasetVersion((v) => v + 1);
    }
  }, [dataReloadSeq, candles.length]);

  // Fetch and cache non-1H timeframe candles on switch, and refresh active non-1H timeframe every 45s
  const fetchActiveTimeframe = useCallback(
    async (tf: ChartTimeframe, isInitialSwitch: boolean) => {
      if (tf === '1h') {
        const cachedH1 = candles.length > 0 ? candles : chartTimeframeCache.get('1h') || [];
        setTfCandles(cachedH1);
        if (isInitialSwitch) {
          setTfDatasetVersion((v) => v + 1);
        }
        return;
      }

      const cached = chartTimeframeCache.get(tf);
      if (cached && cached.length > 0 && isInitialSwitch) {
        setTfCandles(cached);
        setTfDatasetVersion((v) => v + 1);
      } else if (isInitialSwitch) {
        setTfLoading(true);
      }

      try {
        const bars = await fetchChartCandlesByTimeframe(tf, 400);
        if (bars.length > 0) {
          const prevCached = chartTimeframeCache.get(tf);
          const prevLastClosedTime =
            prevCached && prevCached.length >= 2 ? prevCached[prevCached.length - 2].time : 0;
          const nextLastClosedTime = bars.length >= 2 ? bars[bars.length - 2].time : 0;

          chartTimeframeCache.set(tf, bars);
          if (activeTfRef.current === tf) {
            setTfCandles(bars);
            if (isInitialSwitch || !prevCached || prevLastClosedTime !== nextLastClosedTime) {
              setTfDatasetVersion((v) => v + 1);
            }
          }
        }
      } finally {
        if (activeTfRef.current === tf) {
          setTfLoading(false);
        }
      }
    },
    [candles]
  );

  const handleSelectTimeframe = useCallback(
    (tf: ChartTimeframe) => {
      if (tf === activeTfRef.current) return;
      activeTfRef.current = tf;
      setActiveTf(tf);
      fetchActiveTimeframe(tf, true);
    },
    [fetchActiveTimeframe]
  );

  // Refresh the active timeframe every 45 seconds (1H is already refreshed by useFireZoneFeed)
  useEffect(() => {
    if (activeTf === '1h') return;
    const timer = setInterval(() => {
      fetchActiveTimeframe(activeTf, false);
    }, 45000);
    return () => clearInterval(timer);
  }, [activeTf, fetchActiveTimeframe]);

  // Live tick updates ONLY the last candle of the active timeframe
  useEffect(() => {
    if (!Number.isFinite(livePrice) || livePrice <= 0) return;
    setTfCandles((prev) => {
      if (!prev || prev.length === 0) return prev;
      const lastIdx = prev.length - 1;
      const last = prev[lastIdx];
      if (last.close === livePrice && last.high >= livePrice && last.low <= livePrice) {
        return prev;
      }
      const next = [...prev];
      next[lastIdx] = {
        ...last,
        close: livePrice,
        high: Math.max(last.high, livePrice),
        low: Math.min(last.low, livePrice),
      };
      chartTimeframeCache.set(activeTfRef.current, next);
      return next;
    });
  }, [livePrice]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const loadedBarCountRef = useRef<number>(0);

  const candlesRef = useRef<Candle[]>(tfCandles);
  candlesRef.current = tfCandles;
  const modelRef = useRef<FireZoneChartModel>(resolvedModel);
  modelRef.current = resolvedModel;

  const [showInternal] = useState<boolean>(true);
  const [showSwing] = useState<boolean>(true);
  const [showLabels] = useState<boolean>(false);
  const [edgeBadges, setEdgeBadges] = useState<EdgeZoneBadge[]>([]);

  const togglesRef = useRef<ChartLayerToggles>({
    showInternal: true,
    showSwing: true,
    showLabels: false,
  });
  togglesRef.current = { showInternal, showSwing, showLabels };

  const pulseRef = useRef<number>(0);

  const redrawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!canvas || !chart || !series) return;

    pulseRef.current += 0.18;
    drawFireZoneCanvasOverlay(
      canvas,
      chart,
      series,
      modelRef.current,
      togglesRef.current,
      pulseRef.current,
      candlesRef.current
    );

    const badges = computeOutOfRangeZoneBadges(
      series,
      modelRef.current,
      CHART_HEIGHT - 26
    );
    setEdgeBadges((prev) => {
      const prevKey = prev.map((b) => `${b.id}:${b.position}:${b.text}`).join('|');
      const nextKey = badges.map((b) => `${b.id}:${b.position}:${b.text}`).join('|');
      return prevKey === nextKey ? prev : badges;
    });
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
        scaleMargins: { top: 0.03, bottom: 0.14 },
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
        const bars = candlesRef.current;
        if (!bars || bars.length === 0) return null;
        const range = chart.timeScale().getVisibleLogicalRange();
        const from = range ? range.from : Math.max(0, bars.length - 90);
        const to = range ? range.to : bars.length - 1;

        const m = modelRef.current;
        const nearestBuy = m.zones.find((z) => z.side === 'BUY' && z.type === 'NEAREST');
        const nearestSell = m.zones.find((z) => z.side === 'SELL' && z.type === 'NEAREST');

        const vr = computeVisibleAutoscaleRange(bars, from, to, {
          nearestBuy: nearestBuy
            ? { bottom: nearestBuy.LO, top: nearestBuy.HI, anchor: nearestBuy.anchor }
            : null,
          nearestSell: nearestSell
            ? { bottom: nearestSell.LO, top: nearestSell.HI, anchor: nearestSell.anchor }
            : null,
          currentPrice: m.currentPrice,
          atr: m.atr,
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

    // Volume histogram uses its own dedicated priceScaleId ('volScale'), never attached to candle scale
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

  // Populate active timeframe candle dataset & set visible range to last 90 candles (rightOffset: 6) on timeframe switch or closed-candle reload
  useEffect(() => {
    const chart = chartRef.current;
    const cs = candleSeriesRef.current;
    const vs = volumeSeriesRef.current;
    const currentBars = candlesRef.current;
    if (!chart || !cs || !vs || currentBars.length === 0) return;

    const validBars = currentBars.filter(
      (c) =>
        Number.isFinite(c.time) &&
        c.time > 0 &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close)
    );
    if (validBars.length === 0) return;
    candlesRef.current = validBars;

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
      validBars.map((c) => ({
        time: c.time as UTCTimestamp,
        value: Number.isFinite(c.volume) ? c.volume : 0,
        color: c.close >= c.open ? 'rgba(46, 230, 160, 0.24)' : 'rgba(255, 93, 108, 0.24)',
      }))
    );

    loadedBarCountRef.current = validBars.length;

    // Set visible range to the last 90 candles (rightOffset: 6) on timeframe change or full reload
    const len = validBars.length;
    chart.timeScale().applyOptions({ rightOffset: 6 });
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, len - 90),
      to: len - 1 + 6,
    });

    requestAnimationFrame(redrawOverlay);
    const t = setTimeout(() => requestAnimationFrame(redrawOverlay), 60);
    return () => clearTimeout(t);
  }, [tfDatasetVersion, activeTf, redrawOverlay]);

  // Update last forming candle of the active timeframe on live ticks (keeps zoom stable) & redraw canvas
  useEffect(() => {
    const cs = candleSeriesRef.current;
    const vs = volumeSeriesRef.current;
    if (!cs || !vs || tfCandles.length === 0 || loadedBarCountRef.current === 0) return;
    const last = tfCandles[tfCandles.length - 1];
    if (!last || !Number.isFinite(last.time) || last.time <= 0 || !Number.isFinite(last.close)) return;

    try {
      cs.update({
        time: last.time as UTCTimestamp,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
      });
      vs.update({
        time: last.time as UTCTimestamp,
        value: Number.isFinite(last.volume) ? last.volume : 0,
        color: last.close >= last.open ? 'rgba(46, 230, 160, 0.24)' : 'rgba(255, 93, 108, 0.24)',
      });
      requestAnimationFrame(redrawOverlay);
    } catch {
      // ignore transient ordering edge case
    }
  }, [tfCandles, resolvedModel, redrawOverlay]);

  const topBadges = edgeBadges.filter((b) => b.position === 'TOP');
  const bottomBadges = edgeBadges.filter((b) => b.position === 'BOTTOM');

  return (
    <section className="space-y-2.5 fz-fade-up" style={cardStyle}>
      {/* Card Header: "◆ Price action / zone map" (gold, 13px) + tiny legend "SELL / BUY / NOW" */}
      <div className="flex items-center justify-between gap-2">
        <div
          style={{
            fontSize: '13px',
            fontWeight: 800,
            color: 'var(--gold, #f2b94b)',
            letterSpacing: '0.02em',
          }}
        >
          ◆ Price action / zone map
        </div>

        <div
          className="flex items-center gap-2.5 text-[10px] font-bold uppercase"
          style={{ ...monoStyle, color: 'var(--mu, #7e8794)' }}
        >
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-[3px] rounded-full"
              style={{ backgroundColor: 'var(--dn, #ff4d66)' }}
            />
            <span>SELL</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-[3px] rounded-full"
              style={{ backgroundColor: 'var(--up, #2fe08a)' }}
            />
            <span>BUY</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-[3px] rounded-full"
              style={{ backgroundColor: 'var(--gold, #f2b94b)' }}
            />
            <span>NOW</span>
          </span>
        </div>
      </div>

      {/* Row of 5 timeframe buttons: 15m, 30m, 1H, 4H, 1D */}
      <div style={{ display: 'flex', gap: '6px' }}>
        {TIMEFRAME_BUTTONS.map((btn) => {
          const isActive = activeTf === btn.id;
          return (
            <button
              key={btn.id}
              type="button"
              onClick={() => handleSelectTimeframe(btn.id)}
              className="cursor-pointer transition-colors"
              style={{
                flex: 1,
                padding: '8px 0',
                borderRadius: '9px',
                border: isActive
                  ? '1px solid var(--gold, #f2b94b)'
                  : '1px solid var(--bd, #1a212b)',
                background: isActive ? 'var(--gold, #f2b94b)' : '#0f141b',
                color: isActive ? '#07090d' : 'var(--mu, #7e8794)',
                fontSize: '11.5px',
                fontWeight: 800,
                ...monoStyle,
              }}
            >
              {btn.label}
            </button>
          );
        })}
      </div>

      {/* Chart Container (430px height) + Single Retina Canvas Overlay (z-10) + Edge Badges */}
      <div className="relative w-full h-[430px] rounded-xl overflow-hidden border border-[#1a212b] bg-[#08080b]">
        <div ref={containerRef} className="w-full h-full" />

        {/* Single Clipped Custom Canvas Overlay positioned above lightweight-charts */}
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 w-full h-full z-10"
          style={{ zIndex: 10 }}
        />

        {/* Top Out-of-Range Zone Edge Badges */}
        {topBadges.length > 0 && (
          <div
            className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5 pr-16 z-20"
            style={{ zIndex: 20 }}
          >
            {topBadges.map((b) => (
              <span
                key={b.id}
                className="px-2 py-0.5 rounded text-[10px] font-bold bg-black/85 border"
                style={{
                  borderColor:
                    b.side === 'SELL' ? 'rgba(255, 93, 108, 0.55)' : 'rgba(46, 230, 160, 0.55)',
                  color: b.side === 'SELL' ? '#ff5d6c' : '#2ee6a0',
                  ...monoStyle,
                }}
              >
                &uarr; {b.text}
              </span>
            ))}
          </div>
        )}

        {/* Bottom Out-of-Range Zone Edge Badges */}
        {bottomBadges.length > 0 && (
          <div
            className="pointer-events-none absolute bottom-8 left-2 flex flex-wrap gap-1.5 pr-16 z-20"
            style={{ zIndex: 20 }}
          >
            {bottomBadges.map((b) => (
              <span
                key={b.id}
                className="px-2 py-0.5 rounded text-[10px] font-bold bg-black/85 border"
                style={{
                  borderColor:
                    b.side === 'BUY' ? 'rgba(46, 230, 160, 0.55)' : 'rgba(255, 93, 108, 0.55)',
                  color: b.side === 'BUY' ? '#2ee6a0' : '#ff5d6c',
                  ...monoStyle,
                }}
              >
                &darr; {b.text}
              </span>
            ))}
          </div>
        )}

        {((isLoading && tfCandles.length === 0) || tfLoading) && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/70 text-xs text-[#f2b94b] z-30"
            style={monoStyle}
          >
            LOADING CANDLES...
          </div>
        )}
      </div>

      {/* Note under the chart */}
      <div
        className="text-[11px] leading-snug pt-0.5"
        style={{ color: 'var(--mu, #7e8794)' }}
      >
        Timeframe sirf candles badalta hai. Zones aur ladder levels same rehte hain.
      </div>
    </section>
  );
};

