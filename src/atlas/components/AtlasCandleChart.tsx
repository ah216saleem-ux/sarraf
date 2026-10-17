// src/atlas/components/AtlasCandleChart.tsx
import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { AtlasZone, AtlasPivotLevels, AtlasLiquidityLevel } from '../atlasTypes';

export interface AtlasCandle {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface AtlasCandleChartProps {
  candles?: AtlasCandle[];
  livePrice: number;
  zones: AtlasZone[];
  pivots: AtlasPivotLevels | null;
  liquidityLevels?: AtlasLiquidityLevel[];
  lastTickTime?: number;
  marketStatus?: 'LIVE' | 'MARKET_CLOSED' | 'OFFLINE';
  tickDirection?: 'up' | 'down' | 'flat';
}

const GREEN = '#2ee66b';
const RED = '#ff4d4f';
const AMBER = '#f5a623';
const BG = '#05070a';
const PANEL_BG = '#07090d';
const DIM = '#8a93a0';
const BORDER = 'rgba(255, 255, 255, 0.09)';
const AXIS_BORDER = 'rgba(255, 255, 255, 0.06)';

export const AtlasCandleChart: React.FC<AtlasCandleChartProps> = ({
  candles = [],
  livePrice,
  zones = [],
  pivots,
  liquidityLevels = [],
  lastTickTime,
  marketStatus,
  tickDirection = 'flat',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Timeframe selector state
  const [activeTf, setActiveTf] = useState<'M15' | 'H1' | 'H4'>('H1');
  const [tfCandles, setTfCandles] = useState<AtlasCandle[]>([]);
  const [showLiq, setShowLiq] = useState<boolean>(false);

  // Track live tick direction locally if flat
  const prevPriceRef = useRef<number>(livePrice);
  const [localDirection, setLocalDirection] = useState<'up' | 'down'>('down');

  useEffect(() => {
    if (livePrice > 0 && prevPriceRef.current > 0) {
      if (livePrice > prevPriceRef.current) {
        setLocalDirection('up');
      } else if (livePrice < prevPriceRef.current) {
        setLocalDirection('down');
      }
    }
    if (livePrice > 0) {
      prevPriceRef.current = livePrice;
    }
  }, [livePrice]);

  const effectiveDirection = tickDirection !== 'flat' ? tickDirection : localDirection;
  const liveColor = effectiveDirection === 'up' ? GREEN : RED;

  // Fetch or select candles based on active timeframe
  useEffect(() => {
    let isCancelled = false;

    if (activeTf === 'H1' && candles && candles.length > 0) {
      setTfCandles(candles);
      return;
    }

    // Fetch from /api/atlas/candles?tf=...
    const fetchTfCandles = async () => {
      try {
        const res = await fetch(`/api/atlas/candles?tf=${activeTf}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!isCancelled && data.candles && Array.isArray(data.candles)) {
          setTfCandles(data.candles);
        }
      } catch (err) {
        console.warn(`[ATLAS CHART] Error fetching ${activeTf} candles:`, err);
        if (!isCancelled && candles && candles.length > 0) {
          setTfCandles(candles);
        }
      }
    };

    fetchTfCandles();

    // Poll every 15s for candle updates
    const interval = setInterval(fetchTfCandles, 15000);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [activeTf, candles]);

  // Merge live price into forming candle
  const displayCandles = useMemo(() => {
    const base = tfCandles.length > 0 ? tfCandles : candles;
    if (!base || base.length === 0) return [];
    if (livePrice <= 0 || marketStatus === 'MARKET_CLOSED') return base.slice(-100);

    const last = base[base.length - 1];
    const updated = {
      ...last,
      high: Math.max(last.high, livePrice),
      low: Math.min(last.low, livePrice),
      close: livePrice,
    };
    return [...base.slice(0, -1), updated].slice(-100);
  }, [tfCandles, candles, livePrice, marketStatus]);

  // Formatted last update line: "LAST UPDATE dd MMM HH:mm UTC"
  const lastUpdateText = useMemo(() => {
    const ts = lastTickTime && lastTickTime > 0 ? lastTickTime : Date.now();
    const d = new Date(ts);
    const day = d.getUTCDate().toString().padStart(2, '0');
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const month = months[d.getUTCMonth()];
    const hh = d.getUTCHours().toString().padStart(2, '0');
    const mm = d.getUTCMinutes().toString().padStart(2, '0');
    return `LAST UPDATE ${day} ${month} ${hh}:${mm} UTC`;
  }, [lastTickTime]);

  // Canvas drawing routine
  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const containerWidth = container.clientWidth || 366;
    const plotHeight = 340;
    const timeAxisHeight = 18;
    const totalHeight = plotHeight + timeAxisHeight;
    const axisWidth = 52;
    const plotWidth = Math.max(100, containerWidth - axisWidth);

    // Set canvas dimensions
    if (canvas.width !== containerWidth * dpr || canvas.height !== totalHeight * dpr) {
      canvas.width = containerWidth * dpr;
      canvas.height = totalHeight * dpr;
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // Clear background
    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(0, 0, containerWidth, totalHeight);

    // Plot background
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, plotWidth, plotHeight);

    if (displayCandles.length === 0) {
      ctx.fillStyle = DIM;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SYNCHRONIZING BIQUOTE CANDLES…', plotWidth / 2, plotHeight / 2);
      ctx.restore();
      return;
    }

    // -------------------------------------------------------------
    // 1. AUTO Y-SCALE CALCULATION
    // Include nearest T1 & T2 zones on BOTH sides of live price, PP, and candles
    // -------------------------------------------------------------
    const r1 = zones.find((z) => z.id === 'R1');
    const r2 = zones.find((z) => z.id === 'R2');
    const s1 = zones.find((z) => z.id === 'S1');
    const s2 = zones.find((z) => z.id === 'S2');
    const pp = pivots?.PP ?? 0;

    let minPrice = Infinity;
    let maxPrice = -Infinity;

    for (const c of displayCandles) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    }

    if (livePrice > 0) {
      minPrice = Math.min(minPrice, livePrice);
      maxPrice = Math.max(maxPrice, livePrice);
    }

    if (pp > 0) {
      minPrice = Math.min(minPrice, pp);
      maxPrice = Math.max(maxPrice, pp);
    }

    // Include T1 and T2 on both sides
    if (r1) maxPrice = Math.max(maxPrice, r1.top);
    if (r2) maxPrice = Math.max(maxPrice, r2.top);
    if (s1) minPrice = Math.min(minPrice, s1.bottom);
    if (s2) minPrice = Math.min(minPrice, s2.bottom);

    // Add 5% padding
    const span = Math.max(10, maxPrice - minPrice);
    const yMin = minPrice - span * 0.05;
    const yMax = maxPrice + span * 0.05;

    const getY = (price: number) => {
      if (yMax <= yMin) return plotHeight / 2;
      return plotHeight - ((price - yMin) / (yMax - yMin)) * plotHeight;
    };

    // -------------------------------------------------------------
    // 2. DRAW ZONES (R1, R2, S1, S2, and R3/S3 when inside range)
    // -------------------------------------------------------------
    const edgeChips: { text: string; side: 'SELL' | 'BUY'; position: 'top-left' | 'bottom-left' }[] = [];

    for (const z of zones) {
      if (z.id === 'PP') continue; // SARRAF ZONE is drawn separately

      const isBroken = z.status === 'BROKEN';
      const isSell = z.side === 'SELL';
      const isInside = z.top >= yMin && z.bottom <= yMax;

      if (isInside) {
        const topY = getY(z.top);
        const bottomY = getY(z.bottom);
        const rawHeight = Math.abs(bottomY - topY);
        const visualHeight = Math.max(12, rawHeight);
        const centerY = (topY + bottomY) / 2;
        const boxY = Math.max(0, centerY - visualHeight / 2);

        // Zone rectangle colors
        let fillColor: string;
        let strokeColor: string;
        let labelColor: string;

        if (isBroken) {
          fillColor = 'rgba(138, 147, 160, 0.12)';
          strokeColor = 'rgba(138, 147, 160, 0.45)';
          labelColor = DIM;
        } else if (isSell) {
          fillColor = 'rgba(255, 77, 79, 0.12)';
          strokeColor = 'rgba(255, 77, 79, 0.55)';
          labelColor = RED;
        } else {
          fillColor = 'rgba(46, 230, 107, 0.12)';
          strokeColor = 'rgba(46, 230, 107, 0.55)';
          labelColor = GREEN;
        }

        // Fill & Border
        ctx.fillStyle = fillColor;
        ctx.fillRect(0, boxY, plotWidth, visualHeight);

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, boxY + 0.5, plotWidth - 1, visualHeight - 1);

        // Label inside left: zone identifier and rounded price
        const tierNum = z.id.includes('1') ? 'T1' : z.id.includes('2') ? 'T2' : 'T3';
        const tierText = `${tierNum} ${z.side} ${Math.round(z.level)}`;
        ctx.font = '700 9px "JetBrains Mono", monospace';
        ctx.fillStyle = labelColor;
        ctx.textAlign = 'left';
        ctx.fillText(tierText, 6, boxY + visualHeight / 2 + 3);

        // Status inside right: FRESH / TESTED n / BROKEN
        if (isBroken) {
          // Red "BROKEN" tag at right edge, never clipped
          const tagW = 42;
          const tagH = 11;
          const tagX = plotWidth - tagW - 4;
          const tagY = boxY + (visualHeight - tagH) / 2;

          ctx.fillStyle = 'rgba(255, 77, 79, 0.25)';
          ctx.fillRect(tagX, tagY, tagW, tagH);
          ctx.strokeStyle = 'rgba(255, 77, 79, 0.8)';
          ctx.lineWidth = 1;
          ctx.strokeRect(tagX + 0.5, tagY + 0.5, tagW - 1, tagH - 1);

          ctx.font = '700 8px "JetBrains Mono", monospace';
          ctx.fillStyle = RED;
          ctx.textAlign = 'center';
          ctx.fillText('BROKEN', tagX + tagW / 2, tagY + 8.5);
        } else if (z.touchesToday > 0) {
          ctx.font = '8px "JetBrains Mono", monospace';
          ctx.fillStyle = AMBER;
          ctx.textAlign = 'right';
          ctx.fillText(`TESTED ${z.touchesToday}`, plotWidth - 6, boxY + visualHeight / 2 + 3);
        } else {
          ctx.font = '8px "JetBrains Mono", monospace';
          ctx.fillStyle = DIM;
          ctx.textAlign = 'right';
          ctx.fillText('FRESH', plotWidth - 6, boxY + visualHeight / 2 + 3);
        }
      } else {
        // Zone outside range -> collect for edge chips
        if (z.level > yMax && isSell) {
          const tierNum = z.id.includes('3') ? 'T3' : z.id.includes('2') ? 'T2' : 'T1';
          edgeChips.push({
            text: `${tierNum} SELL ${Math.round(z.level)} ↑`,
            side: 'SELL',
            position: 'top-left',
          });
        } else if (z.level < yMin && !isSell) {
          const tierNum = z.id.includes('3') ? 'T3' : z.id.includes('2') ? 'T2' : 'T1';
          edgeChips.push({
            text: `${tierNum} BUY ${Math.round(z.level)} ↓`,
            side: 'BUY',
            position: 'bottom-left',
          });
        }
      }
    }

    // -------------------------------------------------------------
    // 3. LIQ TOGGLE: SHOW ONLY PDH / PDL WHEN ACTIVE
    // -------------------------------------------------------------
    if (showLiq && liquidityLevels.length > 0) {
      for (const lvl of liquidityLevels) {
        if (lvl.id === 'PDH' || lvl.id === 'PDL') {
          const y = getY(lvl.price);
          if (y >= 0 && y <= plotHeight) {
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(245, 166, 35, 0.55)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(plotWidth, y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Tiny right-edge label, never on top of zone labels
            const labelText = `${lvl.id} ${Math.round(lvl.price)}`;
            const tagW = 46;
            const tagH = 10;
            const tagX = plotWidth - tagW - 4;
            const tagY = Math.max(2, y - 11);

            ctx.fillStyle = BG;
            ctx.fillRect(tagX, tagY, tagW, tagH);
            ctx.strokeStyle = 'rgba(245, 166, 35, 0.4)';
            ctx.strokeRect(tagX + 0.5, tagY + 0.5, tagW - 1, tagH - 1);

            ctx.font = '8px "JetBrains Mono", monospace';
            ctx.fillStyle = AMBER;
            ctx.textAlign = 'center';
            ctx.fillText(labelText, tagX + tagW / 2, tagY + 7.5);
          }
        }
      }
    }

    // -------------------------------------------------------------
    // 4. SARRAF ZONE (PP): SOLID 2PX AMBER LINE + LABEL ABOVE RIGHT END
    // -------------------------------------------------------------
    if (pp > 0) {
      const ppY = getY(pp);
      if (ppY >= 0 && ppY <= plotHeight) {
        ctx.strokeStyle = AMBER;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, ppY);
        ctx.lineTo(plotWidth, ppY);
        ctx.stroke();

        ctx.font = '700 9px "JetBrains Mono", monospace';
        ctx.fillStyle = AMBER;
        ctx.textAlign = 'right';
        ctx.fillText(`SARRAF ZONE ${Math.round(pp)}`, plotWidth - 6, Math.max(10, ppY - 4));
      }
    }

    // -------------------------------------------------------------
    // 5. CANDLESTICKS: WICK 1PX, BODY 2PX (MIN HEIGHT 1PX)
    // -------------------------------------------------------------
    const count = displayCandles.length;
    const barWidth = 2;
    const spacing = plotWidth / count;

    for (let i = 0; i < count; i++) {
      const c = displayCandles[i];
      const cx = Math.floor(i * spacing + spacing / 2);
      const isUp = c.close >= c.open;
      const col = isUp ? GREEN : RED;

      const oY = getY(c.open);
      const cY = getY(c.close);
      const hY = getY(c.high);
      const lY = getY(c.low);

      // 1px wick
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 0.5, hY);
      ctx.lineTo(cx + 0.5, lY);
      ctx.stroke();

      // 2px body (min height 1px)
      const bodyTop = Math.min(oY, cY);
      const bodyHeight = Math.max(1, Math.abs(cY - oY));

      ctx.fillStyle = col;
      ctx.fillRect(cx - Math.floor(barWidth / 2), bodyTop, barWidth, bodyHeight);
    }

    // -------------------------------------------------------------
    // 6. LIVE PRICE: DOTTED 1PX LINE + 46x18 PRICE TAG ON AXIS
    // -------------------------------------------------------------
    let liveY = -1;
    if (livePrice > 0) {
      liveY = getY(livePrice);
      if (liveY >= 0 && liveY <= plotHeight) {
        // Dotted 1px line across plot
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = liveColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, liveY);
        ctx.lineTo(plotWidth, liveY);
        ctx.stroke();
        ctx.setLineDash([]);

        // 46x18 price tag on right axis
        const tagW = 46;
        const tagH = 18;
        const tagX = plotWidth + 3;
        const tagY = Math.max(0, Math.min(plotHeight - tagH, liveY - tagH / 2));

        ctx.fillStyle = liveColor;
        ctx.fillRect(tagX, tagY, tagW, tagH);

        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(livePrice.toFixed(2), tagX + tagW / 2, tagY + 12.5);
      }
    }

    // -------------------------------------------------------------
    // 7. EDGE CHIPS FOR OUTSIDE-OF-RANGE ZONES
    // -------------------------------------------------------------
    // Top-left chip
    const topChip = edgeChips.find((c) => c.position === 'top-left');
    if (topChip) {
      const chipW = 84;
      const chipH = 15;
      const chipX = 6;
      const chipY = 6;

      ctx.fillStyle = BG;
      ctx.fillRect(chipX, chipY, chipW, chipH);
      ctx.strokeStyle = 'rgba(255, 77, 79, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(chipX + 0.5, chipY + 0.5, chipW - 1, chipH - 1);

      ctx.font = '700 9px "JetBrains Mono", monospace';
      ctx.fillStyle = RED;
      ctx.textAlign = 'center';
      ctx.fillText(topChip.text, chipX + chipW / 2, chipY + 11);
    }

    // Bottom-left chip
    const botChip = edgeChips.find((c) => c.position === 'bottom-left');
    if (botChip) {
      const chipW = 84;
      const chipH = 15;
      const chipX = 6;
      const chipY = plotHeight - chipH - 6;

      ctx.fillStyle = BG;
      ctx.fillRect(chipX, chipY, chipW, chipH);
      ctx.strokeStyle = 'rgba(46, 230, 107, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(chipX + 0.5, chipY + 0.5, chipW - 1, chipH - 1);

      ctx.font = '700 9px "JetBrains Mono", monospace';
      ctx.fillStyle = GREEN;
      ctx.textAlign = 'center';
      ctx.fillText(botChip.text, chipX + chipW / 2, chipY + 11);
    }

    // -------------------------------------------------------------
    // 8. RIGHT PRICE AXIS: 1PX BORDER + TICKS EVERY 20 PTS
    // -------------------------------------------------------------
    // 1px left border rgba(255,255,255,.06)
    ctx.strokeStyle = AXIS_BORDER;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotWidth + 0.5, 0);
    ctx.lineTo(plotWidth + 0.5, plotHeight);
    ctx.stroke();

    // Price ticks every 20 points, skipping collision with live tag
    const startTick = Math.ceil(yMin / 20) * 20;
    const endTick = Math.floor(yMax / 20) * 20;

    for (let t = startTick; t <= endTick; t += 20) {
      const tY = getY(t);
      if (tY < 6 || tY > plotHeight - 6) continue;

      // Skip tick if collision with live tag (within 13px)
      if (liveY >= 0 && Math.abs(tY - liveY) < 13) continue;

      // Small tick mark
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.beginPath();
      ctx.moveTo(plotWidth + 0.5, tY);
      ctx.lineTo(plotWidth + 3.5, tY);
      ctx.stroke();

      // Price label
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillStyle = DIM;
      ctx.textAlign = 'left';
      ctx.fillText(t.toFixed(0), plotWidth + 6, tY + 3);
    }

    // -------------------------------------------------------------
    // 9. TIME AXIS UNDER PLOT: 5 EVENLY SPACED HH:mm LABELS
    // -------------------------------------------------------------
    // Time axis top border
    ctx.strokeStyle = AXIS_BORDER;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, plotHeight + 0.5);
    ctx.lineTo(plotWidth, plotHeight + 0.5);
    ctx.stroke();

    const sampleIndices = [0.08, 0.28, 0.5, 0.72, 0.94];
    let prevDay = '';

    for (const pct of sampleIndices) {
      const idx = Math.min(count - 1, Math.floor(pct * (count - 1)));
      const c = displayCandles[idx];
      if (!c) continue;

      const cx = Math.floor(idx * spacing + spacing / 2);
      const d = new Date(c.openTime);
      const currentDay = `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
      const hh = d.getUTCHours().toString().padStart(2, '0');
      const mm = d.getUTCMinutes().toString().padStart(2, '0');

      let label = `${hh}:${mm}`;
      if (prevDay && prevDay !== currentDay) {
        label = `${d.getUTCDate()}d ${hh}:${mm}`;
      }
      prevDay = currentDay;

      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillStyle = DIM;
      ctx.textAlign = 'center';
      ctx.fillText(label, cx, plotHeight + 13);
    }

    ctx.restore();
  }, [displayCandles, livePrice, zones, pivots, liquidityLevels, showLiq, liveColor]);

  // Redraw whenever inputs change
  useEffect(() => {
    drawChart();
  }, [drawChart]);

  // Window resize observer
  useEffect(() => {
    const handleResize = () => drawChart();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [drawChart]);

  const isClosed = marketStatus === 'MARKET_CLOSED';

  return (
    <div
      ref={containerRef}
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: '4px',
        padding: '12px 12px 10px',
        background: PANEL_BG,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        width: '100%',
        boxSizing: 'border-box',
        touchAction: 'pan-y', // Disable pinch/drag captures so finger-scroll scrolls page
      }}
    >
      {/* 1. HEADER ROW */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {/* Left: XAUUSD bold 13px + dim 10px · TF · BIQUOTE */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#e8eaed' }}>XAUUSD</span>
          <span style={{ fontSize: '10px', color: DIM }}>· {activeTf} · BIQUOTE</span>
          {isClosed && (
            <span
              style={{
                fontSize: '8px',
                fontWeight: 700,
                color: RED,
                border: '1px solid rgba(255, 77, 79, 0.6)',
                padding: '1px 4px',
                borderRadius: '2px',
                marginLeft: '4px',
              }}
            >
              MARKET CLOSED
            </span>
          )}
        </div>

        {/* Right: Small pills M15 | H1 | H4 + LIQ pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {(['M15', 'H1', 'H4'] as const).map((tf) => {
            const isActive = activeTf === tf;
            return (
              <button
                key={tf}
                onClick={() => setActiveTf(tf)}
                style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  fontFamily: 'inherit',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  border: isActive ? `1px solid ${AMBER}` : '1px solid rgba(255, 255, 255, 0.1)',
                  background: isActive ? 'rgba(245, 166, 35, 0.12)' : 'transparent',
                  color: isActive ? AMBER : DIM,
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                {tf}
              </button>
            );
          })}

          {/* LIQ pill (off by default) */}
          <button
            onClick={() => setShowLiq((prev) => !prev)}
            style={{
              fontSize: '9px',
              fontWeight: 700,
              fontFamily: 'inherit',
              padding: '2px 6px',
              borderRadius: '3px',
              marginLeft: '2px',
              border: showLiq ? `1px solid ${AMBER}` : '1px solid rgba(255, 255, 255, 0.1)',
              background: showLiq ? 'rgba(245, 166, 35, 0.18)' : 'transparent',
              color: showLiq ? AMBER : DIM,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            LIQ
          </button>
        </div>
      </div>

      {/* Under header: 9px dim line LAST UPDATE dd MMM HH:mm UTC */}
      <div style={{ fontSize: '9px', color: DIM, letterSpacing: '.04em' }}>
        {lastUpdateText}
      </div>

      {/* 2. PLOT CANVAS: 340px tall plot + 18px time axis */}
      <div
        style={{
          width: '100%',
          height: '358px',
          position: 'relative',
          overflow: 'hidden',
          touchAction: 'pan-y', // Page finger-scroll permitted
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: '100%',
            height: '358px',
            touchAction: 'pan-y',
          }}
        />
      </div>

      {/* 3. LEGEND ROW */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '9px',
          color: DIM,
          letterSpacing: '.06em',
          paddingTop: '4px',
          borderTop: `1px solid ${AXIS_BORDER}`,
          flexWrap: 'wrap',
          gap: '4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span style={{ color: RED, fontWeight: 700 }}>▬</span>
          <span>SELL ZONES</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span style={{ color: GREEN, fontWeight: 700 }}>▬</span>
          <span>BUY ZONES</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span style={{ color: AMBER, fontWeight: 700 }}>▬</span>
          <span>SARRAF ZONE</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span style={{ color: liveColor, fontWeight: 700 }}>┄</span>
          <span>LIVE</span>
        </div>
      </div>
    </div>
  );
};
