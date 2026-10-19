import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  SecondBin,
  BtcFeedStatus,
  ActiveTideSignal,
  AggTrade,
  LiquidationItem,
  BookTicker,
  SessionStats,
  TapeTimeframe,
  HeatmapColumn,
  HeatmapBucket,
} from './types';
import { DecisionEngineResult, computeAtr90s } from './signalEngine';
import { BtcTideTradeRecord } from '../server/btcTideSignalDatabase';
import {
  subscribeLiveTrades,
  subscribeLiveLiquidations,
  detectWaveformEvents,
} from './useBtcTideStore';
import { Clock, ShieldAlert } from 'lucide-react';

interface LiquidityTapeCanvasProps {
  currentPrice: number | null;
  priceFlash?: 'up' | 'down' | 'none';
  status: BtcFeedStatus;
  messageAgeMs: number;
  secondBins: SecondBin[];
  activeSignal: ActiveTideSignal | null;
  activeTrade?: BtcTideTradeRecord | null;
  decision?: DecisionEngineResult;
  bookTicker?: BookTicker;
  session?: SessionStats;
  isSpotStale?: boolean;
  spotAgeMs?: number;
  isBookStale?: boolean;
  bookAgeMs?: number;
  heatmapHistory?: HeatmapColumn[];
  recentTrades?: AggTrade[];
}

interface MergedTrade {
  id: string;
  time: number;
  price: number;
  qty: number;
  usdValue: number;
  aggressorSide: 'BUY' | 'SELL';
  radius: number;
}

interface HoverState {
  x: number;
  y: number;
  active: boolean;
  trade?: MergedTrade | null;
  liq?: LiquidationItem | null;
  price?: number;
  time?: number;
  depthAtPrice?: { bid: number; ask: number };
}

function formatPrice(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '--';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatUsdShort(val: number): string {
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

export const LiquidityTapeCanvas: React.FC<LiquidityTapeCanvasProps> = React.memo(
  ({
    currentPrice,
    priceFlash = 'none',
    status,
    messageAgeMs,
    secondBins,
    activeSignal,
    activeTrade = null,
    decision,
    bookTicker,
    session,
    isSpotStale = false,
    spotAgeMs = 0,
    isBookStale = false,
    bookAgeMs = 0,
    heatmapHistory = [],
    recentTrades = [],
  }) => {
    const [timeframe, setTimeframe] = useState<TapeTimeframe>('3m');
    const [hover, setHover] = useState<HoverState>({ x: 0, y: 0, active: false });

    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const offscreenHeatmapRef = useRef<HTMLCanvasElement | null>(null);

    // Trade buffer: keep real trades in a rolling buffer (last 12 minutes = 720s)
    const tradesBufferRef = useRef<AggTrade[]>([]);
    const liqsBufferRef = useRef<LiquidationItem[]>([]);

    // Last known real frame so the tape never clears during brief re-syncs
    const lastRealPriceRef = useRef<number | null>(currentPrice);
    if (currentPrice && currentPrice > 0) {
      lastRealPriceRef.current = currentPrice;
    }

    // Rolling smooth price bounds for stable Y-axis scaling
    const priceScaleBoundsRef = useRef<{ min: number; max: number }>({ min: 0, max: 0 });

    // Seed recent trades into tradesBufferRef
    useEffect(() => {
      if (recentTrades && recentTrades.length > 0) {
        const existingIds = new Set(tradesBufferRef.current.map((t) => t.id));
        const newOnes = recentTrades.filter((t) => !existingIds.has(t.id));
        if (newOnes.length > 0) {
          const merged = [...newOnes, ...tradesBufferRef.current]
            .sort((a, b) => b.time - a.time)
            .slice(0, 1500);
          tradesBufferRef.current = merged;
        }
      }
    }, [recentTrades]);

    // Subscribe to live trades and liquidations
    useEffect(() => {
      const unsubTrades = subscribeLiveTrades((trade) => {
        if (!trade || !trade.price) return;
        tradesBufferRef.current.unshift(trade);
        if (tradesBufferRef.current.length > 1500) {
          tradesBufferRef.current.length = 1500;
        }
      });

      const unsubLiqs = subscribeLiveLiquidations((liq) => {
        if (!liq || !liq.price) return;
        liqsBufferRef.current.unshift(liq);
        if (liqsBufferRef.current.length > 300) {
          liqsBufferRef.current.length = 300;
        }
      });

      return () => {
        unsubTrades();
        unsubLiqs();
      };
    }, []);

    // Merge fills within 100ms on same aggressor side according to spec
    const mergedTrades = useMemo<MergedTrade[]>(() => {
      const raw = tradesBufferRef.current;
      if (raw.length === 0) return [];

      // Sort chronological
      const chronological = [...raw].sort((a, b) => a.time - b.time);
      const result: MergedTrade[] = [];

      let currentGroup: AggTrade[] = [];
      let groupSide: 'BUY' | 'SELL' | null = null;
      let groupStartTime = 0;

      for (const t of chronological) {
        if (
          currentGroup.length > 0 &&
          t.aggressorSide === groupSide &&
          t.time - groupStartTime <= 100
        ) {
          currentGroup.push(t);
        } else {
          if (currentGroup.length > 0 && groupSide) {
            let totalUsd = 0;
            let totalQty = 0;
            let weightedPriceSum = 0;
            for (const item of currentGroup) {
              totalUsd += item.usdValue;
              totalQty += item.qty;
              weightedPriceSum += item.price * item.qty;
            }
            const avgPrice = totalQty > 0 ? weightedPriceSum / totalQty : currentGroup[0].price;
            const radius = Math.min(22, Math.max(2.5, Math.sqrt(totalUsd) * 0.04));
            result.push({
              id: currentGroup[0].id,
              time: currentGroup[currentGroup.length - 1].time,
              price: avgPrice,
              qty: totalQty,
              usdValue: totalUsd,
              aggressorSide: groupSide,
              radius,
            });
          }
          currentGroup = [t];
          groupSide = t.aggressorSide;
          groupStartTime = t.time;
        }
      }

      if (currentGroup.length > 0 && groupSide) {
        let totalUsd = 0;
        let totalQty = 0;
        let weightedPriceSum = 0;
        for (const item of currentGroup) {
          totalUsd += item.usdValue;
          totalQty += item.qty;
          weightedPriceSum += item.price * item.qty;
        }
        const avgPrice = totalQty > 0 ? weightedPriceSum / totalQty : currentGroup[0].price;
        const radius = Math.min(22, Math.max(2.5, Math.sqrt(totalUsd) * 0.04));
        result.push({
          id: currentGroup[0].id,
          time: currentGroup[currentGroup.length - 1].time,
          price: avgPrice,
          qty: totalQty,
          usdValue: totalUsd,
          aggressorSide: groupSide,
          radius,
        });
      }

      return result;
    }, [secondBins.length, recentTrades.length]);

    // Window duration in seconds
    const windowSec = timeframe === '1m' ? 60 : timeframe === '3m' ? 180 : 600;

    // Detect Absorb and Drive waveform events from real continuous bins
    const waveformResult = useMemo(() => {
      if (!secondBins || secondBins.length === 0) return { events: [] };
      return detectWaveformEvents(secondBins);
    }, [secondBins]);

    // Staleness rule: when stale or offline, freeze scrolling
    const effectiveAgeMs = Math.max(messageAgeMs, spotAgeMs, bookAgeMs);
    const isStale = isSpotStale || status === 'STALE' || effectiveAgeMs >= 5000;
    const isOffline = status === 'OFFLINE' || status === 'CONNECTING';
    const isFrozen = isStale || isOffline;

    // Fixed timestamp when frozen to stop scrolling
    const frozenTimeRef = useRef<number>(Date.now());
    useEffect(() => {
      if (!isFrozen) {
        frozenTimeRef.current = Date.now();
      }
    }, [isFrozen]);

    // Main Canvas Render Loop (30 fps cap, High-DPI crisp, pause on tab hidden)
    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      let animationFrameId: number;
      let lastFrameTime = 0;
      const TARGET_FRAME_MS = 1000 / 30; // 30 FPS cap for high performance

      // Ensure offscreen heatmap canvas exists
      if (!offscreenHeatmapRef.current) {
        offscreenHeatmapRef.current = document.createElement('canvas');
      }

      const render = (timestamp: number) => {
        // Cap at 30 fps
        if (timestamp - lastFrameTime < TARGET_FRAME_MS) {
          animationFrameId = requestAnimationFrame(render);
          return;
        }
        lastFrameTime = timestamp;

        // Skip render when tab is hidden
        if (document.hidden) {
          animationFrameId = requestAnimationFrame(render);
          return;
        }

        const rect = container.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          animationFrameId = requestAnimationFrame(render);
          return;
        }

        const dpr = window.devicePixelRatio || 1;
        const width = Math.floor(rect.width);
        const height = Math.floor(rect.height);

        if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
          canvas.width = width * dpr;
          canvas.height = height * dpr;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          animationFrameId = requestAnimationFrame(render);
          return;
        }

        ctx.save();
        ctx.scale(dpr, dpr);

        // Core Layout Dimensions
        const rightProfileWidth = 58; // Profile horizontal bars
        const rightPriceAxisWidth = 68; // Price labels
        const totalRightMargin = rightProfileWidth + rightPriceAxisWidth;
        const bottomStripHeight = 52; // CVD & 10s Delta bars
        const chartWidth = Math.max(10, width - totalRightMargin);
        const chartHeight = Math.max(10, height - bottomStripHeight);

        // Time domain: present at right edge of chartWidth, past on the left
        const now = isFrozen ? frozenTimeRef.current : Date.now();
        const startTime = now - windowSec * 1000;

        const timeToX = (t: number): number => {
          const frac = (t - startTime) / (windowSec * 1000);
          return frac * chartWidth;
        };

        const xToTime = (x: number): number => {
          const frac = x / chartWidth;
          return startTime + frac * (windowSec * 1000);
        };

        // Price domain: Y axis auto-scaled to max(2x ATR, 0.1% price) around current price
        const midPrice = lastRealPriceRef.current || currentPrice || 82500;
        const atr = computeAtr90s(secondBins, midPrice);
        const targetHalfSpan = Math.max(2.0 * atr, midPrice * 0.001); // max(2x ATR, 0.1%)

        let targetMin = midPrice - targetHalfSpan;
        let targetMax = midPrice + targetHalfSpan;

        // Clamp to visible trades in window so outliers don't get cut off abruptly
        const visibleTrades = mergedTrades.filter((t) => t.time >= startTime && t.time <= now);
        if (visibleTrades.length > 0) {
          let vMin = Infinity;
          let vMax = -Infinity;
          for (const t of visibleTrades) {
            if (t.price < vMin) vMin = t.price;
            if (t.price > vMax) vMax = t.price;
          }
          if (vMin < targetMin) targetMin = vMin - targetHalfSpan * 0.15;
          if (vMax > targetMax) targetMax = vMax + targetHalfSpan * 0.15;
        }

        // Smooth price bounds damping (prevents jittery jumps)
        if (priceScaleBoundsRef.current.min === 0) {
          priceScaleBoundsRef.current = { min: targetMin, max: targetMax };
        } else {
          priceScaleBoundsRef.current.min += (targetMin - priceScaleBoundsRef.current.min) * 0.1;
          priceScaleBoundsRef.current.max += (targetMax - priceScaleBoundsRef.current.max) * 0.1;
        }

        const priceMin = priceScaleBoundsRef.current.min;
        const priceMax = priceScaleBoundsRef.current.max;
        const priceSpan = Math.max(1, priceMax - priceMin);

        const priceToY = (p: number): number => {
          const frac = (p - priceMin) / priceSpan;
          return chartHeight - frac * chartHeight;
        };

        const yToPrice = (y: number): number => {
          const frac = (chartHeight - y) / chartHeight;
          return priceMin + frac * priceSpan;
        };

        // -------------------------------------------------------------
        // 1. Background Fill & Grid
        // -------------------------------------------------------------
        ctx.fillStyle = '#07090e';
        ctx.fillRect(0, 0, width, height);

        // Price grid lines
        const numPriceSteps = Math.min(8, Math.max(4, Math.floor(chartHeight / 48)));
        const priceStep = priceSpan / numPriceSteps;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        for (let i = 0; i <= numPriceSteps; i++) {
          const p = priceMin + i * priceStep;
          const y = priceToY(p);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(chartWidth, y);
          ctx.stroke();

          // Price label on right margin
          ctx.fillStyle = 'rgba(163, 163, 163, 0.55)';
          ctx.fillText(`$${p.toFixed(2)}`, width - 6, y);
        }

        // Time vertical grid lines
        const timeIntervalSec = windowSec <= 60 ? 10 : windowSec <= 180 ? 30 : 60;
        const startSecAligned = Math.ceil(startTime / 1000 / timeIntervalSec) * timeIntervalSec;
        for (let s = startSecAligned; s * 1000 <= now; s += timeIntervalSec) {
          const x = timeToX(s * 1000);
          if (x >= 0 && x <= chartWidth) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, chartHeight);
            ctx.stroke();
          }
        }

        // -------------------------------------------------------------
        // 2. Background Heatmap (Offscreen Canvas Blit)
        // -------------------------------------------------------------
        const offscreen = offscreenHeatmapRef.current;
        if (offscreen && heatmapHistory.length > 0) {
          // Size offscreen canvas to chart dimensions
          if (offscreen.width !== chartWidth || offscreen.height !== chartHeight) {
            offscreen.width = chartWidth;
            offscreen.height = chartHeight;
          }
          const oCtx = offscreen.getContext('2d');
          if (oCtx) {
            oCtx.clearRect(0, 0, chartWidth, chartHeight);

            // Find maximum size in visible range to normalize brightness
            let maxBucketBtc = 0.5;
            for (const col of heatmapHistory) {
              if (col.sec * 1000 < startTime - 5000 || col.sec * 1000 > now + 2000) continue;
              for (const b of col.buckets) {
                const total = b.b + b.a;
                if (total > maxBucketBtc) maxBucketBtc = total;
              }
            }

            const colWidth = Math.max(1.5, chartWidth / windowSec);

            for (const col of heatmapHistory) {
              const colTimeMs = col.sec * 1000;
              if (colTimeMs < startTime - 2000 || colTimeMs > now + 1000) continue;
              const x = timeToX(colTimeMs);
              if (x < -colWidth || x > chartWidth) continue;

              const bSize = col.bSize || 2;
              const bucketH = Math.max(1, (bSize / priceSpan) * chartHeight);

              for (const b of col.buckets) {
                if (b.p < priceMin - bSize || b.p > priceMax + bSize) continue;
                const y = priceToY(b.p);

                // Resting Bids: Cyan/Teal luminance
                if (b.b > 0) {
                  const norm = Math.min(1, Math.log10(1 + (b.b / maxBucketBtc) * 9));
                  const alpha = 0.08 + norm * 0.45;
                  oCtx.fillStyle = `rgba(20, 184, 166, ${alpha})`;
                  oCtx.fillRect(x - colWidth * 0.5, y - bucketH, colWidth + 0.5, bucketH + 0.5);
                }

                // Resting Asks: Rose/Amber luminance
                if (b.a > 0) {
                  const norm = Math.min(1, Math.log10(1 + (b.a / maxBucketBtc) * 9));
                  const alpha = 0.08 + norm * 0.45;
                  oCtx.fillStyle = `rgba(244, 63, 94, ${alpha})`;
                  oCtx.fillRect(x - colWidth * 0.5, y - bucketH, colWidth + 0.5, bucketH + 0.5);
                }
              }
            }
          }

          // Blit offscreen heatmap onto main canvas
          ctx.drawImage(offscreen, 0, 0);
        }

        // -------------------------------------------------------------
        // 3. Active Signal Horizontal Zones & Target Lines
        // -------------------------------------------------------------
        if (activeSignal && activeSignal.entryPrice) {
          const entryY = priceToY(activeSignal.entryPrice);
          const slY = priceToY(activeSignal.slPrice);
          const tp1Y = activeTrade ? priceToY(activeTrade.tp1Price) : entryY;
          const tp2Y = activeTrade ? priceToY(activeTrade.tp2Price) : entryY;
          const tp3Y = priceToY(activeSignal.tpPrice);
          const sigStartX = Math.max(0, timeToX(activeSignal.triggeredAt));

          // Profit shading (Teal)
          const isLong = activeSignal.direction === 'LONG';
          const topProfitY = isLong ? tp3Y : entryY;
          const bottomProfitY = isLong ? entryY : tp3Y;
          ctx.fillStyle = 'rgba(20, 184, 166, 0.07)';
          ctx.fillRect(sigStartX, topProfitY, chartWidth - sigStartX, bottomProfitY - topProfitY);

          // Loss shading (Rose)
          const topLossY = isLong ? entryY : slY;
          const bottomLossY = isLong ? slY : entryY;
          ctx.fillStyle = 'rgba(244, 63, 94, 0.07)';
          ctx.fillRect(sigStartX, topLossY, chartWidth - sigStartX, bottomLossY - topLossY);

          // Horizontal ENTRY line
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(sigStartX, entryY);
          ctx.lineTo(chartWidth, entryY);
          ctx.stroke();

          // Horizontal SL line
          ctx.strokeStyle = '#f43f5e';
          ctx.beginPath();
          ctx.moveTo(sigStartX, slY);
          ctx.lineTo(chartWidth, slY);
          ctx.stroke();

          // Horizontal TP lines
          ctx.strokeStyle = '#2dd4bf';
          ctx.beginPath();
          ctx.moveTo(sigStartX, tp1Y);
          ctx.lineTo(chartWidth, tp1Y);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(sigStartX, tp2Y);
          ctx.lineTo(chartWidth, tp2Y);
          ctx.stroke();

          ctx.strokeStyle = '#E8B84A';
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(sigStartX, tp3Y);
          ctx.lineTo(chartWidth, tp3Y);
          ctx.stroke();

          // Signal Text Labels
          ctx.font = '9px JetBrains Mono, monospace';
          ctx.textAlign = 'left';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fillText(`ENTRY $${activeSignal.entryPrice.toFixed(1)}`, sigStartX + 6, entryY - 4);
          ctx.fillStyle = '#f43f5e';
          ctx.fillText(`SL $${activeSignal.slPrice.toFixed(1)} (-1.0R)`, sigStartX + 6, slY - 4);
          ctx.fillStyle = '#2dd4bf';
          ctx.fillText(
            `TP1 $${(activeTrade?.tp1Price || 0).toFixed(1)} (+1.0R)`,
            sigStartX + 6,
            tp1Y - 4
          );
          ctx.fillStyle = '#E8B84A';
          ctx.fillText(
            `TP3 $${activeSignal.tpPrice.toFixed(1)} (+3.0R)`,
            sigStartX + 6,
            tp3Y - 4
          );
        }

        // -------------------------------------------------------------
        // 4. Waveform Markers: ABSORB (Gold Bracket) & DRIVE (Arrow)
        // -------------------------------------------------------------
        const events = waveformResult.events;
        for (const ev of events) {
          const evTimeMs = ev.sec * 1000;
          if (evTimeMs < startTime || evTimeMs > now) continue;
          const x = timeToX(evTimeMs);
          const y = priceToY(ev.price);

          if (ev.type === 'ABSORB') {
            // Gold bracket [ ] around the absorption zone
            const zoneHeight = Math.max(16, (Math.abs(ev.atr6s * 1.5) / priceSpan) * chartHeight);
            const topY = y - zoneHeight * 0.5;
            const btmY = y + zoneHeight * 0.5;

            ctx.strokeStyle = '#E8B84A';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);

            // Left bracket [
            ctx.beginPath();
            ctx.moveTo(x - 12, topY);
            ctx.lineTo(x - 18, topY);
            ctx.lineTo(x - 18, btmY);
            ctx.lineTo(x - 12, btmY);
            ctx.stroke();

            // Right bracket ]
            ctx.beginPath();
            ctx.moveTo(x + 12, topY);
            ctx.lineTo(x + 18, topY);
            ctx.lineTo(x + 18, btmY);
            ctx.lineTo(x + 12, btmY);
            ctx.stroke();

            // Tag label
            ctx.font = 'bold 9px JetBrains Mono, monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#FFD97A';
            ctx.fillText(
              `ABSORB ${ev.side === 'BUY' ? 'BUY' : 'SELL'} (${ev.netVolBtc.toFixed(1)}₿)`,
              x,
              topY - 4
            );
          } else if (ev.type === 'DRIVE') {
            // Arrow along the move
            const isUp = ev.side === 'BUY';
            const arrowLen = 22;
            const arrowEndX = x + 16;
            const arrowEndY = isUp ? y - arrowLen : y + arrowLen;

            ctx.strokeStyle = isUp ? '#2dd4bf' : '#fb7185';
            ctx.fillStyle = isUp ? '#2dd4bf' : '#fb7185';
            ctx.lineWidth = 2;
            ctx.setLineDash([]);

            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(arrowEndX, arrowEndY);
            ctx.stroke();

            // Arrow head
            const angle = Math.atan2(arrowEndY - y, arrowEndX - x);
            ctx.beginPath();
            ctx.moveTo(arrowEndX, arrowEndY);
            ctx.lineTo(
              arrowEndX - 7 * Math.cos(angle - Math.PI / 6),
              arrowEndY - 7 * Math.sin(angle - Math.PI / 6)
            );
            ctx.lineTo(
              arrowEndX - 7 * Math.cos(angle + Math.PI / 6),
              arrowEndY - 7 * Math.sin(angle + Math.PI / 6)
            );
            ctx.closePath();
            ctx.fill();

            ctx.font = 'bold 9px JetBrains Mono, monospace';
            ctx.textAlign = 'center';
            ctx.fillText('DRIVE', arrowEndX, isUp ? arrowEndY - 4 : arrowEndY + 11);
          }
        }

        // -------------------------------------------------------------
        // 5. Liquidation X Markers
        // -------------------------------------------------------------
        const recentLiqs = liqsBufferRef.current;
        for (const liq of recentLiqs) {
          if (liq.time < startTime || liq.time > now) continue;
          const x = timeToX(liq.time);
          const y = priceToY(liq.price);
          const isLongLiq = liq.side === 'SELL'; // Sell liquidation = Long liquidated

          ctx.strokeStyle = isLongLiq ? '#f43f5e' : '#2dd4bf';
          ctx.lineWidth = 2;
          ctx.setLineDash([]);

          // Draw X
          const s = 6;
          ctx.beginPath();
          ctx.moveTo(x - s, y - s);
          ctx.lineTo(x + s, y + s);
          ctx.moveTo(x + s, y - s);
          ctx.lineTo(x - s, y + s);
          ctx.stroke();

          // Size label
          ctx.font = 'bold 9px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = isLongLiq ? '#fda4af' : '#5eead4';
          ctx.fillText(`✕ ${formatUsdShort(liq.usdValue)}`, x, y - 9);
        }

        // -------------------------------------------------------------
        // 6. Thin White Price Line Through Bubbles
        // -------------------------------------------------------------
        if (visibleTrades.length > 1) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.lineWidth = 1.25;
          ctx.setLineDash([]);
          ctx.beginPath();
          let started = false;

          for (const t of visibleTrades) {
            const x = timeToX(t.time);
            const y = priceToY(t.price);
            if (!started) {
              ctx.moveTo(x, y);
              started = true;
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
        }

        // -------------------------------------------------------------
        // 7. Trade Bubbles
        // -------------------------------------------------------------
        for (const t of visibleTrades) {
          const x = timeToX(t.time);
          const y = priceToY(t.price);
          const isBuy = t.aggressorSide === 'BUY';
          const r = t.radius;

          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);

          if (isBuy) {
            ctx.fillStyle = 'rgba(20, 184, 166, 0.45)';
            ctx.strokeStyle = '#2dd4bf';
          } else {
            ctx.fillStyle = 'rgba(244, 63, 94, 0.45)';
            ctx.strokeStyle = '#fb7185';
          }

          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();

          // Label only for trades >= $50K according to spec
          if (t.usdValue >= 50000) {
            ctx.font = 'bold 9px JetBrains Mono, monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(formatUsdShort(t.usdValue), x, y - r - 3);
          }
        }

        // -------------------------------------------------------------
        // 8. Right Edge: Live Order Book Depth Profile & Price Tag
        // -------------------------------------------------------------
        // Vertical divider separating tape from order book profile
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(chartWidth, 0);
        ctx.lineTo(chartWidth, chartHeight);
        ctx.stroke();

        // Latest heatmap column provides full wide depth profile for right edge
        const latestCol = heatmapHistory.length > 0 ? heatmapHistory[heatmapHistory.length - 1] : null;
        if (latestCol && latestCol.buckets.length > 0) {
          let maxEdgeSize = 1.0;
          for (const b of latestCol.buckets) {
            if (b.b > maxEdgeSize) maxEdgeSize = b.b;
            if (b.a > maxEdgeSize) maxEdgeSize = b.a;
          }

          const bSize = latestCol.bSize || 2;
          const bucketH = Math.max(1, (bSize / priceSpan) * chartHeight);

          for (const b of latestCol.buckets) {
            if (b.p < priceMin - bSize || b.p > priceMax + bSize) continue;
            const y = priceToY(b.p);

            // Resting Bids extending rightwards
            if (b.b > 0) {
              const barLen = (b.b / maxEdgeSize) * (rightProfileWidth - 4);
              ctx.fillStyle = 'rgba(20, 184, 166, 0.35)';
              ctx.fillRect(chartWidth + 1, y - bucketH, barLen, bucketH);
            }

            // Resting Asks extending rightwards
            if (b.a > 0) {
              const barLen = (b.a / maxEdgeSize) * (rightProfileWidth - 4);
              ctx.fillStyle = 'rgba(244, 63, 94, 0.35)';
              ctx.fillRect(chartWidth + 1, y - bucketH, barLen, bucketH);
            }
          }
        }

        // Live Current-Price Horizontal Pointer & Tag
        if (currentPrice !== null && currentPrice > 0) {
          const curY = priceToY(currentPrice);

          // Horizontal dashed pointer to right price axis
          ctx.strokeStyle =
            priceFlash === 'up'
              ? '#2dd4bf'
              : priceFlash === 'down'
              ? '#fb7185'
              : 'rgba(232, 184, 74, 0.8)';
          ctx.lineWidth = 1.2;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(0, curY);
          ctx.lineTo(width, curY);
          ctx.stroke();
          ctx.setLineDash([]);

          // Right Price Tag Pill
          const tagW = rightPriceAxisWidth - 4;
          const tagH = 18;
          const tagX = width - tagW - 2;
          const tagY = curY - tagH * 0.5;

          ctx.fillStyle =
            priceFlash === 'up'
              ? '#0d9488'
              : priceFlash === 'down'
              ? '#e11d48'
              : '#E8B84A';
          ctx.fillRect(tagX, tagY, tagW, tagH);

          ctx.font = 'bold 10px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = priceFlash === 'none' ? '#000000' : '#ffffff';
          ctx.fillText(`$${currentPrice.toFixed(2)}`, tagX + tagW * 0.5, curY);
        }

        // -------------------------------------------------------------
        // 9. Bottom Strip: CVD Line & 10-Second Delta Bars
        // -------------------------------------------------------------
        const stripY = chartHeight;
        ctx.fillStyle = '#05070a';
        ctx.fillRect(0, stripY, width, bottomStripHeight);

        // Divider
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, stripY);
        ctx.lineTo(width, stripY);
        ctx.stroke();

        // Strip Label
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(163, 163, 163, 0.6)';
        ctx.fillText('CVD (₿) · 10s DELTA', 6, stripY + 12);

        // Compute 10s delta bars and continuous CVD from secondBins
        const visibleBins = secondBins.filter(
          (b) => b.sec * 1000 >= startTime - 5000 && b.sec * 1000 <= now
        );

        if (visibleBins.length > 0) {
          // Group into 10s buckets
          const tenSecDeltas = new Map<number, number>();
          for (const b of visibleBins) {
            const bucketSec = Math.floor(b.sec / 10) * 10;
            const delta = b.buyVol - b.sellVol;
            tenSecDeltas.set(bucketSec, (tenSecDeltas.get(bucketSec) || 0) + delta);
          }

          let maxDeltaBtc = 0.5;
          for (const d of tenSecDeltas.values()) {
            if (Math.abs(d) > maxDeltaBtc) maxDeltaBtc = Math.abs(d);
          }

          const baselineY = stripY + 34;
          const maxBarH = 14;

          // Render 10s Delta Bars
          for (const [sec10, delta] of tenSecDeltas.entries()) {
            const x = timeToX(sec10 * 1000);
            if (x < 0 || x > chartWidth) continue;
            const barW = Math.max(3, (10 / windowSec) * chartWidth - 1);
            const barH = Math.min(maxBarH, (Math.abs(delta) / maxDeltaBtc) * maxBarH);

            if (delta >= 0) {
              ctx.fillStyle = 'rgba(20, 184, 166, 0.6)';
              ctx.fillRect(x, baselineY - barH, barW, barH);
            } else {
              ctx.fillStyle = 'rgba(244, 63, 94, 0.6)';
              ctx.fillRect(x, baselineY, barW, barH);
            }
          }

          // Render continuous CVD Line
          let runningCvd = 0;
          const cvdPoints: { x: number; cvd: number }[] = [];
          for (const b of visibleBins) {
            runningCvd += b.buyVol - b.sellVol;
            cvdPoints.push({ x: timeToX(b.sec * 1000), cvd: runningCvd });
          }

          if (cvdPoints.length > 1) {
            let maxCvd = -Infinity;
            let minCvd = Infinity;
            for (const pt of cvdPoints) {
              if (pt.cvd > maxCvd) maxCvd = pt.cvd;
              if (pt.cvd < minCvd) minCvd = pt.cvd;
            }
            const cvdRange = Math.max(0.5, maxCvd - minCvd);

            ctx.strokeStyle = runningCvd >= 0 ? '#2dd4bf' : '#fb7185';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            let started = false;
            for (const pt of cvdPoints) {
              if (pt.x < 0 || pt.x > chartWidth) continue;
              const y = baselineY - ((pt.cvd - minCvd) / cvdRange - 0.5) * 22;
              if (!started) {
                ctx.moveTo(pt.x, y);
                started = true;
              } else {
                ctx.lineTo(pt.x, y);
              }
            }
            ctx.stroke();

            // CVD Value Tag on right margin
            ctx.font = 'bold 9px JetBrains Mono, monospace';
            ctx.textAlign = 'right';
            ctx.fillStyle = runningCvd >= 0 ? '#2dd4bf' : '#fb7185';
            ctx.fillText(
              `${runningCvd >= 0 ? '+' : ''}${runningCvd.toFixed(2)} ₿`,
              width - 6,
              baselineY
            );
          }
        }

        // -------------------------------------------------------------
        // 10. Interactive Crosshair & Tooltip Hover Point
        // -------------------------------------------------------------
        if (hover.active && hover.x >= 0 && hover.x <= chartWidth && hover.y >= 0 && hover.y <= chartHeight) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);

          ctx.beginPath();
          ctx.moveTo(hover.x, 0);
          ctx.lineTo(hover.x, chartHeight);
          ctx.moveTo(0, hover.y);
          ctx.lineTo(chartWidth, hover.y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Pointer Dot
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(hover.x, hover.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
        animationFrameId = requestAnimationFrame(render);
      };

      animationFrameId = requestAnimationFrame(render);

      return () => {
        cancelAnimationFrame(animationFrameId);
      };
    }, [
      timeframe,
      windowSec,
      isFrozen,
      mergedTrades,
      secondBins,
      heatmapHistory,
      activeSignal,
      activeTrade,
      decision,
      hover,
      priceFlash,
    ]);

    // Handle mouse/pointer hover over canvas
    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const totalRightMargin = 126;
        const chartWidth = Math.max(10, rect.width - totalRightMargin);
        const chartHeight = Math.max(10, rect.height - 52);

        if (x < 0 || x > chartWidth || y < 0 || y > chartHeight) {
          setHover((prev) => ({ ...prev, active: false }));
          return;
        }

        const now = isFrozen ? frozenTimeRef.current : Date.now();
        const startTime = now - windowSec * 1000;
        const hoveredTime = startTime + (x / chartWidth) * (windowSec * 1000);

        const priceMin = priceScaleBoundsRef.current.min;
        const priceMax = priceScaleBoundsRef.current.max;
        const priceSpan = Math.max(1, priceMax - priceMin);
        const hoveredPrice = priceMin + ((chartHeight - y) / chartHeight) * priceSpan;

        // Find nearest trade bubble within 16px radius
        let nearestTrade: MergedTrade | null = null;
        let minTradeDist = 16;
        for (const t of mergedTrades) {
          const tx = ((t.time - startTime) / (windowSec * 1000)) * chartWidth;
          const ty = chartHeight - ((t.price - priceMin) / priceSpan) * chartHeight;
          const dist = Math.hypot(x - tx, y - ty);
          if (dist < minTradeDist) {
            minTradeDist = dist;
            nearestTrade = t;
          }
        }

        // Find resting depth at hovered price bucket
        let depthAtPrice: { bid: number; ask: number } | undefined;
        const latestCol =
          heatmapHistory.length > 0 ? heatmapHistory[heatmapHistory.length - 1] : null;
        if (latestCol) {
          const bSize = latestCol.bSize || 2;
          const targetBucket = Math.floor(hoveredPrice / bSize) * bSize;
          const match = latestCol.buckets.find((b) => Math.abs(b.p - targetBucket) < bSize);
          if (match) {
            depthAtPrice = { bid: match.b, ask: match.a };
          }
        }

        setHover({
          x,
          y,
          active: true,
          trade: nearestTrade,
          price: hoveredPrice,
          time: hoveredTime,
          depthAtPrice,
        });
      },
      [isFrozen, windowSec, mergedTrades, heatmapHistory]
    );

    const handlePointerLeave = useCallback(() => {
      setHover((prev) => ({ ...prev, active: false }));
    }, []);

    // Summary calculations for the literal HUD corner gauge
    const hudGauge = useMemo(() => {
      if (!secondBins || secondBins.length === 0) {
        return { buyPct: 50, sellPct: 50, cvdBtc: 0, totalBtc: 0 };
      }
      const cutoffSec = Math.floor(Date.now() / 1000) - windowSec;
      const recent = secondBins.filter((b) => b.sec >= cutoffSec);
      let buyBtc = 0;
      let sellBtc = 0;
      for (const b of recent) {
        buyBtc += b.buyVol;
        sellBtc += b.sellVol;
      }
      const total = buyBtc + sellBtc;
      const buyPct = total > 0 ? Math.round((buyBtc / total) * 100) : 50;
      const sellPct = 100 - buyPct;
      const cvdBtc = buyBtc - sellBtc;
      return { buyPct, sellPct, cvdBtc, totalBtc: total };
    }, [secondBins, windowSec]);

    return (
      <div className="relative w-full rounded-2xl bg-[#090b10] border border-white/10 overflow-hidden shadow-2xl">
        {/* Header HUD: Title, Timeframe Toggle, Literal HUD Corner Gauge */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-white/10 bg-black/60 backdrop-blur-md">
          {/* Left Title & Live Stats */}
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs font-bold tracking-wider text-[#FFD97A]">
              LIQUIDITY TAPE
            </span>
            <span aria-hidden="true" className="text-neutral-600">
              ·
            </span>
            <span className="font-mono text-[11px] text-neutral-300">
              {formatPrice(currentPrice)}
            </span>
            {bookTicker && bookTicker.spread !== null && (
              <span className="hidden md:inline font-mono text-[10px] text-neutral-400">
                (Spread: ${bookTicker.spread.toFixed(2)})
              </span>
            )}
          </div>

          {/* Right Controls: Timeframe Toggles & Corner Literal Gauge */}
          <div className="flex items-center gap-3">
            {/* Literal Gauge in HUD Corner (Replaces previous orb) */}
            <div className="flex items-center gap-2 px-2 py-0.5 rounded-lg bg-neutral-900/80 border border-white/10 font-mono text-[10px]">
              <div className="flex items-center gap-1">
                <span className="text-teal-400 font-bold">{hudGauge.buyPct}%</span>
                <div className="w-10 h-1.5 rounded-full bg-rose-500/80 overflow-hidden flex">
                  <div
                    className="h-full bg-teal-400 transition-all duration-300"
                    style={{ width: `${hudGauge.buyPct}%` }}
                  />
                </div>
                <span className="text-rose-400 font-bold">{hudGauge.sellPct}%</span>
              </div>
              <span aria-hidden="true" className="text-neutral-600">
                ·
              </span>
              <div className="flex items-center gap-0.5">
                <span className="text-neutral-400">CVD:</span>
                <span
                  className={`font-bold ${
                    hudGauge.cvdBtc >= 0 ? 'text-teal-300' : 'text-rose-300'
                  }`}
                >
                  {hudGauge.cvdBtc >= 0 ? '+' : ''}
                  {hudGauge.cvdBtc.toFixed(2)} ₿
                </span>
              </div>
            </div>

            {/* Timeframe Toggles: 1m / 3m / 10m */}
            <div className="flex items-center p-0.5 rounded-lg bg-black/80 border border-white/10">
              {(['1m', '3m', '10m'] as TapeTimeframe[]).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setTimeframe(tf)}
                  className={`px-2 py-1 rounded-md text-[10px] sm:text-[11px] font-mono transition-all cursor-pointer ${
                    timeframe === tf
                      ? 'bg-[#E8B84A] text-black font-bold shadow-[0_0_8px_rgba(232,184,74,0.3)]'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Canvas Stage: 260px on mobile, 340px on desktop */}
        <div ref={containerRef} className="relative w-full h-[260px] sm:h-[340px]">
          <canvas
            ref={canvasRef}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            className={`block w-full h-full transition-opacity duration-300 cursor-crosshair ${
              isFrozen ? 'opacity-50' : 'opacity-100'
            }`}
          />

          {/* Frozen / Stale Badge: "A frozen honest frame is better than fake motion" */}
          {isFrozen && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-md bg-amber-950/95 border border-amber-500/60 text-amber-200 font-mono text-[11px] font-bold flex items-center gap-1.5 pointer-events-none shadow-xl z-20">
              {isOffline ? (
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              ) : (
                <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
              <span>
                {isOffline ? 'FEED OFFLINE' : 'FEED STALE'} (
                {(effectiveAgeMs / 1000).toFixed(1)}s) · TAPING PAUSED
              </span>
            </div>
          )}

          {/* Interactive Hover Tooltip */}
          {hover.active && (
            <div
              className="absolute pointer-events-none z-30 px-2.5 py-1.5 rounded-lg bg-black/90 border border-white/20 shadow-2xl text-[10px] font-mono space-y-0.5"
              style={{
                left: Math.min(hover.x + 14, (containerRef.current?.clientWidth || 300) - 170),
                top: Math.max(8, hover.y - 40),
              }}
            >
              {hover.trade ? (
                <>
                  <div className="text-white font-bold flex items-center gap-1.5">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        hover.trade.aggressorSide === 'BUY' ? 'bg-teal-400' : 'bg-rose-400'
                      }`}
                    />
                    <span>
                      {hover.trade.aggressorSide} ${hover.trade.price.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-neutral-300">
                    Size: {formatUsdShort(hover.trade.usdValue)} ({hover.trade.qty.toFixed(3)} ₿)
                  </div>
                  <div className="text-neutral-500">
                    {new Date(hover.trade.time).toISOString().slice(11, 19)} UTC
                  </div>
                </>
              ) : (
                <>
                  <div className="text-white font-bold">
                    ${(hover.price || 0).toFixed(2)}
                  </div>
                  {hover.depthAtPrice && (
                    <div className="text-neutral-300">
                      Resting: {hover.depthAtPrice.bid > 0 ? `${hover.depthAtPrice.bid.toFixed(2)}₿ BID ` : ''}
                      {hover.depthAtPrice.ask > 0 ? `${hover.depthAtPrice.ask.toFixed(2)}₿ ASK` : ''}
                    </div>
                  )}
                  {hover.time && (
                    <div className="text-neutral-500">
                      {new Date(hover.time).toISOString().slice(11, 19)} UTC
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);

LiquidityTapeCanvas.displayName = 'LiquidityTapeCanvas';
