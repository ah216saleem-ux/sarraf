// src/atlas/components/AtlasIndicatorPanels.tsx
import React, { useMemo } from 'react';
import { AtlasCandle } from './AtlasCandleChart';

interface AtlasIndicatorPanelsProps {
  candles?: AtlasCandle[];
  livePrice: number;
  atr14?: number;
}

// Catmull-Rom to Cubic Bezier smooth path generator
function buildSmoothSvgPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

// Compute Wilder's ATR(14) series across candles
function computeAtrSeries(candles: AtlasCandle[], period = 14): number[] {
  if (!candles || candles.length === 0) return [];
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      trs.push(Math.max(0.1, c.high - c.low));
    } else {
      const prev = candles[i - 1];
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close)
      );
      trs.push(Math.max(0.1, tr));
    }
  }

  const atrs: number[] = [];
  const initLen = Math.min(period, trs.length);
  let sum = 0;
  for (let i = 0; i < initLen; i++) sum += trs[i];
  let currAtr = sum / initLen;
  atrs.push(currAtr);

  for (let i = 1; i < trs.length; i++) {
    currAtr = (currAtr * (period - 1) + trs[i]) / period;
    atrs.push(currAtr);
  }
  return atrs;
}

// Compute EMA series across price array
function computeEmaSeries(prices: number[], period: number): number[] {
  if (!prices || prices.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  const initLen = Math.min(period, prices.length);
  let sum = 0;
  for (let i = 0; i < initLen; i++) sum += prices[i];
  let ema = sum / initLen;
  result.push(ema);

  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

// -------------------------------------------------------------
// 1. VOLUME / PARTICIPATION PANEL
// -------------------------------------------------------------
export const AtlasVolumePanel: React.FC<{ candles?: AtlasCandle[] }> = ({ candles = [] }) => {
  const { bars, stateLevel, stateTrend, ratioStr } = useMemo(() => {
    if (!candles || candles.length === 0) {
      return { bars: [], stateLevel: 'NORMAL', stateTrend: 'STEADY', ratioStr: '1.00' };
    }

    const recent = candles.slice(-80);
    const ranges = recent.map((c) => Math.max(0.05, c.high - c.low));
    const maxRange = Math.max(...ranges, 1);

    // 20-bar average calculation
    const last20 = ranges.slice(-20);
    const avg20 = last20.reduce((sum, r) => sum + r, 0) / Math.max(1, last20.length);
    const currentRange = ranges[ranges.length - 1] ?? avg20;
    const ratio = avg20 > 0 ? currentRange / avg20 : 1;
    const ratioFormatted = ratio.toFixed(2);

    // State level: LOW / NORMAL / HIGH
    const level = ratio >= 1.3 ? 'HIGH' : ratio <= 0.7 ? 'LOW' : 'NORMAL';

    // State trend: STEADY / RISING / FALLING from last bars
    let trend = 'STEADY';
    if (ranges.length >= 4) {
      const r1 = ranges[ranges.length - 1];
      const r2 = ranges[ranges.length - 2];
      const r3 = ranges[ranges.length - 3];
      if (r1 > r2 && r2 > r3) {
        trend = 'RISING';
      } else if (r1 < r2 && r2 < r3) {
        trend = 'FALLING';
      }
    }

    const renderedBars = recent.map((c, i) => {
      const r = ranges[i];
      const isUp = c.close >= c.open;
      const height = Math.max(2, Math.round((r / maxRange) * 54));
      const color = isUp ? 'rgba(46, 230, 107, 0.85)' : 'rgba(255, 77, 79, 0.85)';
      return { height, color };
    });

    return {
      bars: renderedBars,
      stateLevel: level,
      stateTrend: trend,
      ratioStr: ratioFormatted,
    };
  }, [candles]);

  return (
    <div className="atlas-pn" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="atlas-lb">Volume / participation</span>
        <span className="atlas-dim" style={{ fontSize: '10px' }}>
          State <b style={{ color: '#e8eaed' }}>{stateLevel} · {stateTrend}</b> {ratioStr}x avg
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          height: '54px',
          gap: '1px',
          width: '100%',
          overflow: 'hidden',
        }}
      >
        {bars.length > 0 ? (
          bars.map((b, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                minWidth: '1px',
                height: `${b.height}px`,
                background: b.color,
                borderRadius: '1px 1px 0 0',
              }}
            />
          ))
        ) : (
          <div style={{ width: '100%', textAlign: 'center', color: '#8a93a0', fontSize: '10px' }}>
            NO DATA
          </div>
        )}
      </div>

      <div className="atlas-dim" style={{ fontSize: '9px' }}>
        bar = H1 range (participation proxy)
      </div>
    </div>
  );
};

// -------------------------------------------------------------
// 2. ATR(14) PANEL
// -------------------------------------------------------------
export const AtlasAtrPanel: React.FC<{ candles?: AtlasCandle[]; fallbackAtr?: number }> = ({
  candles = [],
  fallbackAtr,
}) => {
  const { pathD, liveAtr } = useMemo(() => {
    if (!candles || candles.length === 0) {
      return { pathD: '', liveAtr: fallbackAtr ?? 0 };
    }

    const allAtrs = computeAtrSeries(candles, 14);
    const recentAtrs = allAtrs.slice(-80);
    const curr = recentAtrs.length > 0 ? recentAtrs[recentAtrs.length - 1] : (fallbackAtr ?? 0);

    if (recentAtrs.length < 2) {
      return { pathD: '', liveAtr: curr };
    }

    const minVal = Math.min(...recentAtrs);
    const maxVal = Math.max(...recentAtrs);
    const span = Math.max(0.5, maxVal - minVal);
    const yMin = minVal - span * 0.05;
    const yMax = maxVal + span * 0.05;

    const points = recentAtrs.map((val, idx) => {
      const x = (idx / (recentAtrs.length - 1)) * 100;
      const y = 64 - ((val - yMin) / (yMax - yMin)) * 64;
      return { x, y: Math.max(2, Math.min(62, y)) };
    });

    const path = buildSmoothSvgPath(points);
    return { pathD: path, liveAtr: curr };
  }, [candles, fallbackAtr]);

  return (
    <div className="atlas-pn" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="atlas-lb">ATR(14)</span>
        <span className="atlas-dim" style={{ fontSize: '10px' }}>
          ATR 14 = <b style={{ color: '#e8eaed' }}>{liveAtr > 0 ? liveAtr.toFixed(2) : '--'}</b>
        </span>
      </div>

      <div style={{ height: '64px', width: '100%', overflow: 'hidden' }}>
        {pathD ? (
          <svg
            width="100%"
            height="64"
            viewBox="0 0 100 64"
            preserveAspectRatio="none"
            style={{ display: 'block', overflow: 'visible' }}
          >
            <path
              d={pathD}
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a93a0', fontSize: '10px' }}>
            NO DATA
          </div>
        )}
      </div>
    </div>
  );
};

// -------------------------------------------------------------
// 3. TREND · EMA CLUSTER PANEL
// -------------------------------------------------------------
export const AtlasEmaClusterPanel: React.FC<{
  candles?: AtlasCandle[];
  livePrice: number;
}> = ({ candles = [], livePrice }) => {
  const { path50, path100, path200, clusterLabel } = useMemo(() => {
    if (!candles || candles.length === 0) {
      return { path50: '', path100: '', path200: '', clusterLabel: 'NO DATA' };
    }

    const prices = candles.map((c) => c.close);
    // Update latest price with live tick if provided
    if (livePrice > 0 && prices.length > 0) {
      prices[prices.length - 1] = livePrice;
    }

    const ema50Series = computeEmaSeries(prices, 50);
    const ema100Series = computeEmaSeries(prices, 100);
    const ema200Series = computeEmaSeries(prices, 200);

    const recent50 = ema50Series.slice(-100);
    const recent100 = ema100Series.slice(-100);
    const recent200 = ema200Series.slice(-100);

    if (recent50.length < 2) {
      return { path50: '', path100: '', path200: '', clusterLabel: 'NO DATA' };
    }

    const allValues = [...recent50, ...recent100, ...recent200];
    const minVal = Math.min(...allValues);
    const maxVal = Math.max(...allValues);
    const span = Math.max(1, maxVal - minVal);
    const yMin = minVal - span * 0.05;
    const yMax = maxVal + span * 0.05;

    const mapToPoints = (series: number[]) =>
      series.map((val, idx) => {
        const x = (idx / (series.length - 1)) * 100;
        const y = 100 - ((val - yMin) / (yMax - yMin)) * 100;
        return { x, y: Math.max(2, Math.min(98, y)) };
      });

    const p50 = buildSmoothSvgPath(mapToPoints(recent50));
    const p100 = buildSmoothSvgPath(mapToPoints(recent100));
    const p200 = buildSmoothSvgPath(mapToPoints(recent200));

    // Determine cluster label: Price above / below / inside EMA cluster
    const l50 = recent50[recent50.length - 1];
    const l100 = recent100[recent100.length - 1];
    const l200 = recent200[recent200.length - 1];
    const cHigh = Math.max(l50, l100, l200);
    const cLow = Math.min(l50, l100, l200);

    let label = 'Price inside EMA cluster';
    if (livePrice > 0) {
      if (livePrice > cHigh) {
        label = 'Price above EMA cluster';
      } else if (livePrice < cLow) {
        label = 'Price below EMA cluster';
      }
    }

    return { path50: p50, path100: p100, path200: p200, clusterLabel: label };
  }, [candles, livePrice]);

  return (
    <div className="atlas-pn" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="atlas-lb">Trend · EMA cluster</span>
        <span className="atlas-dim" style={{ fontSize: '10px' }}>
          {clusterLabel}
        </span>
      </div>

      <div style={{ height: '100px', width: '100%', overflow: 'hidden' }}>
        {path50 ? (
          <svg
            width="100%"
            height="100"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ display: 'block', overflow: 'visible' }}
          >
            <path
              d={path50}
              fill="none"
              stroke="#f5a623"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={path100}
              fill="none"
              stroke="#2fd4c4"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={path200}
              fill="none"
              stroke="#ff4d4f"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a93a0', fontSize: '10px' }}>
            NO DATA
          </div>
        )}
      </div>

      <div
        className="atlas-dim"
        style={{
          fontSize: '9px',
          display: 'flex',
          gap: '14px',
          alignItems: 'center',
        }}
      >
        <span>
          <span style={{ color: '#f5a623', fontWeight: 700 }}>━</span> EMA 50
        </span>
        <span>
          <span style={{ color: '#2fd4c4', fontWeight: 700 }}>━</span> EMA 100
        </span>
        <span>
          <span style={{ color: '#ff4d4f', fontWeight: 700 }}>━</span> EMA 200
        </span>
      </div>
    </div>
  );
};
