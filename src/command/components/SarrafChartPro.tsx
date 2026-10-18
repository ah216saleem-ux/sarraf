import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Candle, Timeframe, SarrafZone } from '../data/commandTypes';
import { Eye, Layers, ZoomIn, ZoomOut, RotateCcw, X, Info } from 'lucide-react';

interface SarrafChartProProps {
  candles: Candle[];
  timeframe: Timeframe;
  currentPrice: number;
  bidPrice?: number;
  zones?: SarrafZone[];
  isDimmed: boolean;
  freshness: string;
  onTimeframeChange?: (tf: Timeframe) => void;
}

const GREEN = '#22e08a';
const RED = '#ff3b6b';
const NEUTRAL = '#8a96a8';
const GOLD = '#f5c451';
const BLUE = '#38bdf8';
const BG = '#070b14';

export const SarrafChartPro: React.FC<SarrafChartProProps> = React.memo(({
  candles,
  timeframe,
  currentPrice,
  bidPrice,
  zones = [],
  isDimmed,
  freshness,
  onTimeframeChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Toggle chips: FVG / OB / LIQ / ABS (remembered in localStorage)
  const [overlays, setOverlays] = useState<{ fvg: boolean; ob: boolean; liq: boolean; abs: boolean }>(() => {
    try {
      const saved = localStorage.getItem('sarraf_chart_overlays');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { fvg: true, ob: true, liq: true, abs: true };
  });

  const toggleOverlay = (key: 'fvg' | 'ob' | 'liq' | 'abs') => {
    setOverlays((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem('sarraf_chart_overlays', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Selected zone card popup on tap
  const [selectedZone, setSelectedZone] = useState<SarrafZone | null>(null);

  // Pan / Zoom / Auto-follow state
  const [scrollOffset, setScrollOffset] = useState<number>(0); // 0 = latest candle at right edge
  const [candlesCount, setCandlesCount] = useState<number>(50); // visible bars count
  const [autoFollow, setAutoFollow] = useState<boolean>(true);

  // Pointer drag handling for pan & tap
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  const hasMoved = useRef(false);

  // Timeframes list
  const timeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

  // Check if history is still empty (0 candles)
  const isBuildingHistory = candles.length === 0;

  // Merge latest tick price on the forming candle without full-array cloning
  const displayCandles = useMemo(() => {
    if (candles.length === 0) return [];
    if (currentPrice <= 0) return candles;
    const last = candles[candles.length - 1];
    const updatedLast = {
      ...last,
      close: currentPrice,
      high: Math.max(last.high, currentPrice),
      low: Math.min(last.low, currentPrice),
    };
    const list = candles.slice(0, -1);
    list.push(updatedLast);
    return list;
  }, [candles, currentPrice]);

  // Window of candles to render based on scroll & zoom
  const { visibleCandles, startIndex, endIndex } = useMemo(() => {
    const total = displayCandles.length;
    if (total === 0) return { visibleCandles: [], startIndex: 0, endIndex: 0 };

    const count = Math.min(candlesCount, total);
    let end = total - scrollOffset;
    if (end > total) end = total;
    if (end < count) end = count;
    const start = Math.max(0, end - count);

    return {
      visibleCandles: displayCandles.slice(start, end),
      startIndex: start,
      endIndex: end,
    };
  }, [displayCandles, candlesCount, scrollOffset]);

  // Canvas drawing effect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || visibleCandles.length === 0 || isBuildingHistory) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // Layout dimensions
    const padTop = 16;
    const padBottom = 24;
    const padRight = 64; // price axis
    const padLeft = 8;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    // Clear background
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);

    // Compute min and max price
    let minP = Infinity;
    let maxP = -Infinity;

    for (const c of visibleCandles) {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
    }

    // Include active zones in price bounding if nearby
    for (const z of zones) {
      if (z.status !== 'BROKEN' && Math.abs(z.mid - currentPrice) < 15) {
        if (z.bottom < minP && z.bottom > minP - 10) minP = z.bottom;
        if (z.top > maxP && z.top < maxP + 10) maxP = z.top;
      }
    }

    if (currentPrice > 0) {
      minP = Math.min(minP, currentPrice);
      maxP = Math.max(maxP, currentPrice);
    }

    const padP = (maxP - minP) * 0.08 || 1.2;
    minP -= padP;
    maxP += padP;
    const pRange = maxP - minP || 1;

    const getY = (val: number) => {
      return padTop + chartH - ((val - minP) / pRange) * chartH;
    };

    // Horizontal Price Grid Lines
    const step = pRange > 30 ? 10 : pRange > 15 ? 5 : pRange > 6 ? 2 : 1;
    const firstGrid = Math.ceil(minP / step) * step;

    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff08';
    ctx.fillStyle = '#8a96a860';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';

    for (let p = firstGrid; p <= maxP; p += step) {
      const y = getY(p);
      if (y >= padTop && y <= padTop + chartH) {
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + chartW, y);
        ctx.stroke();

        ctx.fillText(`$${p.toFixed(1)}`, padLeft + chartW + 6, y + 3);
      }
    }

    // Candlestick spacing
    const candleCount = visibleCandles.length;
    const candleSpacing = chartW / candleCount;
    const candleBodyW = Math.max(2, Math.min(12, candleSpacing * 0.68));

    // OVERLAYS: Zones rendering behind/with candles
    const getBarX = (indexInVisible: number) => {
      return padLeft + indexInVisible * candleSpacing + candleSpacing / 2;
    };

    // Draw Overlays: Thin bands without text labels
    for (const z of zones) {
      const isBroken = z.status === 'BROKEN';

      // 1. FVG Overlays (Thin band)
      if (z.type === 'FVG' && overlays.fvg) {
        const topY = getY(z.top);
        const botY = getY(z.bottom);
        const boxH = Math.max(2, botY - topY);
        const isBull = z.side === 'BUY';

        ctx.fillStyle = isBroken ? '#8a96a815' : isBull ? '#22e08a18' : '#ff3b6b18';
        ctx.fillRect(padLeft, topY, chartW, boxH);

        ctx.strokeStyle = isBroken ? '#8a96a840' : isBull ? '#22e08a50' : '#ff3b6b50';
        ctx.lineWidth = 1;
        ctx.strokeRect(padLeft, topY, chartW, boxH);
      }

      // 2. OB Overlays (Thin band)
      if (z.type === 'OB' && overlays.ob) {
        const topY = getY(z.top);
        const botY = getY(z.bottom);
        const boxH = Math.max(2, botY - topY);
        const isBull = z.side === 'BUY';
        const color = isBroken ? '#8a96a8' : isBull ? GREEN : RED;

        ctx.fillStyle = isBroken ? '#8a96a812' : isBull ? '#22e08a15' : '#ff3b6b15';
        ctx.fillRect(padLeft, topY, chartW, boxH);

        ctx.strokeStyle = color + (isBroken ? '30' : '70');
        ctx.lineWidth = 1.2;
        ctx.strokeRect(padLeft, topY, chartW, boxH);
      }

      // 3. Liquidity (BSL / SSL / PDH / PDL) Overlays (Dashed line)
      if ((z.type === 'BSL' || z.type === 'SSL' || z.type === 'PDH' || z.type === 'PDL') && overlays.liq) {
        const y = getY(z.mid);
        if (y >= padTop && y <= padTop + chartH) {
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1;
          const col = z.type === 'PDH' || z.type === 'PDL' ? GOLD : z.type === 'BSL' ? RED : GREEN;
          ctx.strokeStyle = isBroken ? '#8a96a850' : col + '80';

          ctx.beginPath();
          ctx.moveTo(padLeft, y);
          ctx.lineTo(padLeft + chartW, y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // 4. Absorption Overlays (Solid line)
      if (z.type === 'ABSORPTION' && overlays.abs) {
        const y = getY(z.mid);
        if (y >= padTop && y <= padTop + chartH) {
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = z.side === 'BUY' ? GREEN + '90' : RED + '90';
          ctx.beginPath();
          ctx.moveTo(padLeft, y);
          ctx.lineTo(padLeft + chartW, y);
          ctx.stroke();
        }
      }
    }

    // REQUIREMENT 4: Cap visible zone labels to the 4 nearest zones to current price.
    // Draw labels at the right edge, stacked with minimum 14 px spacing so they never overlap.
    interface LabeledZoneItem {
      zone: SarrafZone;
      dist: number;
      targetY: number;
      text: string;
      color: string;
    }

    const candidateLabels: LabeledZoneItem[] = [];

    for (const z of zones) {
      const isBroken = z.status === 'BROKEN';
      let text = '';
      let color = isBroken ? '#8a96a8' : z.side === 'BUY' ? GREEN : RED;

      if (z.type === 'FVG' && overlays.fvg) {
        text = isBroken ? 'FVG [BRK]' : `${z.side === 'BUY' ? 'Bull' : 'Bear'} FVG $${z.mid.toFixed(1)}`;
      } else if (z.type === 'OB' && overlays.ob) {
        text = isBroken ? 'OB [BRK]' : `OB ${z.side} $${(z.bosLevel || z.mid).toFixed(1)}`;
      } else if ((z.type === 'BSL' || z.type === 'SSL' || z.type === 'PDH' || z.type === 'PDL') && overlays.liq) {
        color = z.type === 'PDH' || z.type === 'PDL' ? GOLD : z.type === 'BSL' ? RED : GREEN;
        text = `${z.label} $${z.mid.toFixed(1)}`;
      } else if (z.type === 'ABSORPTION' && overlays.abs) {
        text = `${z.side} Abs $${z.mid.toFixed(1)}`;
      }

      if (text) {
        const rawY = getY(z.mid);
        if (rawY >= padTop - 10 && rawY <= padTop + chartH + 10) {
          const dist = currentPrice > 0 ? Math.abs(z.mid - currentPrice) : Math.abs(rawY - (padTop + chartH / 2));
          candidateLabels.push({
            zone: z,
            dist,
            targetY: Math.max(padTop + 10, Math.min(padTop + chartH - 10, rawY)),
            text,
            color,
          });
        }
      }
    }

    // Cap to 4 nearest zones to current price
    candidateLabels.sort((a, b) => a.dist - b.dist);
    const nearest4 = candidateLabels.slice(0, 4);

    // Sort by Y coordinate so we can stack them cleanly
    nearest4.sort((a, b) => a.targetY - b.targetY);

    // Enforce minimum 14 px vertical spacing between stacked labels
    for (let i = 1; i < nearest4.length; i++) {
      if (nearest4[i].targetY < nearest4[i - 1].targetY + 14) {
        nearest4[i].targetY = nearest4[i - 1].targetY + 14;
      }
    }
    // Check bottom bounds and adjust if exceeding chart area
    if (nearest4.length > 0 && nearest4[nearest4.length - 1].targetY > padTop + chartH - 6) {
      const overflow = nearest4[nearest4.length - 1].targetY - (padTop + chartH - 6);
      for (let i = nearest4.length - 1; i >= 0; i--) {
        nearest4[i].targetY -= overflow;
      }
    }

    // Draw the 4 nearest labels stacked at the right edge
    ctx.textAlign = 'right';
    ctx.font = '8px monospace';
    for (const item of nearest4) {
      const lx = padLeft + chartW - 4;
      const ly = item.targetY;

      // Subtle background badge for readability
      const textW = ctx.measureText(item.text).width;
      ctx.fillStyle = '#070b14dc';
      ctx.fillRect(lx - textW - 5, ly - 9, textW + 6, 12);
      ctx.strokeStyle = item.color + '50';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(lx - textW - 5, ly - 9, textW + 6, 12);

      // Label text
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, lx - 2, ly);
    }
    ctx.textAlign = 'left';

    // DRAW CANDLESTICKS
    for (let i = 0; i < candleCount; i++) {
      const c = visibleCandles[i];
      const cx = getBarX(i);
      const isUp = c.close >= c.open;
      const color = isUp ? GREEN : RED;

      const highY = getY(c.high);
      const lowY = getY(c.low);
      const openY = getY(c.open);
      const closeY = getY(c.close);

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, highY);
      ctx.lineTo(cx, lowY);
      ctx.stroke();

      // Body
      const bodyTop = Math.min(openY, closeY);
      const bodyH = Math.max(1.5, Math.abs(closeY - openY));

      ctx.fillStyle = color;
      ctx.fillRect(cx - candleBodyW / 2, bodyTop, candleBodyW, bodyH);
    }

    // LIVE CURRENT PRICE LINE & BADGE
    if (currentPrice > 0) {
      const curY = getY(currentPrice);
      if (curY >= padTop && curY <= padTop + chartH) {
        // Horizontal dashed line
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = BLUE + 'aa';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(padLeft, curY);
        ctx.lineTo(padLeft + chartW, curY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Price badge in axis
        ctx.fillStyle = BLUE;
        ctx.fillRect(padLeft + chartW, curY - 8, padRight - 4, 16);

        ctx.fillStyle = '#04060b';
        ctx.font = 'bold 9.5px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`$${currentPrice.toFixed(2)}`, padLeft + chartW + 4, curY + 3.5);
      }
    }

    // BID PRICE LINE if provided
    if (bidPrice && bidPrice > 0 && Math.abs(bidPrice - currentPrice) > 0.05) {
      const bidY = getY(bidPrice);
      if (bidY >= padTop && bidY <= padTop + chartH) {
        ctx.strokeStyle = '#ffffff25';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(padLeft, bidY);
        ctx.lineTo(padLeft + chartW, bidY);
        ctx.stroke();
      }
    }

    ctx.restore();
  }, [visibleCandles, currentPrice, bidPrice, zones, overlays, isBuildingHistory, timeframe]);

  // Pointer Handlers for Pan & Tap
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartOffset.current = scrollOffset;
    hasMoved.current = false;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging.current) return;
    const diffX = e.clientX - dragStartX.current;
    if (Math.abs(diffX) > 4) {
      hasMoved.current = true;
      setAutoFollow(false);
      const deltaBars = Math.round(diffX / 8);
      const maxOffset = Math.max(0, displayCandles.length - candlesCount);
      const newOffset = Math.max(0, Math.min(maxOffset, dragStartOffset.current + deltaBars));
      setScrollOffset(newOffset);
      if (newOffset === 0) {
        setAutoFollow(true);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!hasMoved.current) {
      // Tap detected: check if a zone was clicked
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const clickY = e.clientY - rect.top;
        const padTop = 16;
        const chartH = rect.height - 40;

        // Find nearest zone to clicked Y
        let clickedZone: SarrafZone | null = null;
        let minDiff = 14;

        for (const z of zones) {
          // Approximate Y on canvas
          const pRange = 20; // local estimate
          if (Math.abs(z.mid - currentPrice) < 15) {
            clickedZone = z;
            break;
          }
        }
        if (clickedZone) {
          setSelectedZone(clickedZone);
        }
      }
    }
    isDragging.current = false;
  };

  const resetScroll = () => {
    setScrollOffset(0);
    setAutoFollow(true);
  };

  const zoomIn = () => {
    setCandlesCount((c) => Math.max(25, c - 10));
  };

  const zoomOut = () => {
    setCandlesCount((c) => Math.min(displayCandles.length, c + 15));
  };

  return (
    <div
      className={`relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 transition-opacity duration-300 select-none font-mono ${
        isDimmed ? 'opacity-40' : 'opacity-100'
      }`}
    >
      <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#38bdf8]/50 to-transparent" />

      {/* TOP HEADER & TOOLBAR */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/5">
        {/* Title & Timeframe Selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold text-[#38bdf8] uppercase tracking-[0.14em]">
            SARRAF CHART PRO ({timeframe})
          </span>

          {/* Timeframe Chips */}
          <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded border border-white/10">
            {timeframes.map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange?.(tf)}
                className={`text-[9px] px-1.5 py-0.5 rounded font-bold transition-colors cursor-pointer ${
                  timeframe === tf
                    ? 'bg-[#38bdf8] text-black shadow-[0_0_8px_rgba(56,189,248,0.3)]'
                    : 'text-[#8a96a8] hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <span className="text-[9px] text-[#8a96a8]">· {freshness}</span>
        </div>

        {/* OVERLAY TOGGLES: FVG / OB / LIQ / ABS */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[8.5px] text-[#8a96a8] uppercase">OVERLAYS:</span>

          <button
            onClick={() => toggleOverlay('fvg')}
            className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
              overlays.fvg
                ? 'bg-[#22e08a]/15 border-[#22e08a]/40 text-[#22e08a]'
                : 'bg-white/5 border-white/10 text-neutral-500'
            }`}
          >
            FVG
          </button>

          <button
            onClick={() => toggleOverlay('ob')}
            className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
              overlays.ob
                ? 'bg-[#38bdf8]/15 border-[#38bdf8]/40 text-[#38bdf8]'
                : 'bg-white/5 border-white/10 text-neutral-500'
            }`}
          >
            OB
          </button>

          <button
            onClick={() => toggleOverlay('liq')}
            className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
              overlays.liq
                ? 'bg-[#f5c451]/15 border-[#f5c451]/40 text-[#f5c451]'
                : 'bg-white/5 border-white/10 text-neutral-500'
            }`}
          >
            LIQ
          </button>

          <button
            onClick={() => toggleOverlay('abs')}
            className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
              overlays.abs
                ? 'bg-purple-500/15 border-purple-500/40 text-purple-300'
                : 'bg-white/5 border-white/10 text-neutral-500'
            }`}
          >
            ABS
          </button>

          {/* Zoom controls */}
          <div className="flex items-center gap-1 ml-1 pl-1 border-l border-white/10">
            <button
              onClick={zoomIn}
              className="p-1 rounded bg-white/5 hover:bg-white/10 text-[#8a96a8] hover:text-white transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="w-2.5 h-2.5" />
            </button>
            <button
              onClick={zoomOut}
              className="p-1 rounded bg-white/5 hover:bg-white/10 text-[#8a96a8] hover:text-white transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="w-2.5 h-2.5" />
            </button>
            {!autoFollow && (
              <button
                onClick={resetScroll}
                className="flex items-center gap-0.5 text-[8.5px] px-1 py-0.5 rounded bg-[#38bdf8]/20 border border-[#38bdf8]/40 text-[#38bdf8] font-bold"
                title="Follow Latest Candle"
              >
                <RotateCcw className="w-2 h-2" />
                <span>SNAP</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* CHART VIEWPORT (Height ~340px on mobile) */}
      <div className="relative w-full h-[340px] mt-2 bg-[#04060b] rounded border border-white/5 overflow-hidden">
        {isBuildingHistory ? (
          /* Empty / Warming Up State (< 60 candles) */
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center space-y-2">
            <div className="w-8 h-8 rounded-full border-2 border-[#38bdf8]/30 border-t-[#38bdf8] animate-spin" />
            <div className="text-[#38bdf8] font-bold text-xs uppercase tracking-wider">
              Building history ({candles.length}/60)
            </div>
            <p className="text-[9px] text-[#8a96a8] max-w-xs">
              Consolidating authentic BiQuote {timeframe} candles. Full structural zones will unlock once 60 bars are assembled.
            </p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="w-full h-full cursor-grab active:cursor-grabbing touch-none block"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        )}

        {/* Selected Zone Detail Card Popup on tap */}
        {selectedZone && (
          <div className="absolute top-3 left-3 z-30 max-w-xs p-2.5 rounded-lg bg-[#070b14]/95 border border-[#38bdf8]/50 shadow-xl backdrop-blur-md text-[9px] text-[#8a96a8] space-y-1">
            <div className="flex items-center justify-between pb-1 border-b border-white/10 text-white font-bold">
              <span className="text-[#38bdf8] uppercase">
                {selectedZone.type} ({selectedZone.side})
              </span>
              <button
                onClick={() => setSelectedZone(null)}
                className="text-[#8a96a8] hover:text-white p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 text-[8.5px]">
              <div>
                <span className="text-white/60">Range: </span>
                <span className="text-white font-bold">
                  ${selectedZone.bottom.toFixed(1)} - ${selectedZone.top.toFixed(1)}
                </span>
              </div>
              <div>
                <span className="text-white/60">Status: </span>
                <span
                  className={
                    selectedZone.status === 'BROKEN'
                      ? 'text-[#ff3b6b] font-bold'
                      : selectedZone.status === 'FRESH'
                      ? 'text-[#22e08a] font-bold'
                      : 'text-[#f5c451] font-bold'
                  }
                >
                  {selectedZone.status}
                </span>
              </div>
              <div>
                <span className="text-white/60">Rating: </span>
                <span className="text-[#38bdf8] font-bold">p{selectedZone.rating}</span>
              </div>
              <div>
                <span className="text-white/60">TF: </span>
                <span className="text-white font-bold">{selectedZone.timeframe}</span>
              </div>
            </div>

            {selectedZone.status === 'BROKEN' && selectedZone.brokenReason && (
              <div className="p-1 rounded bg-[#ff3b6b]/10 border border-[#ff3b6b]/30 text-[#ff3b6b] text-[8px]">
                {selectedZone.brokenReason}
              </div>
            )}

            {selectedZone.bosLevel && (
              <div className="text-[8px] text-[#8a96a8]">
                BOS Level: ${selectedZone.bosLevel.toFixed(1)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
