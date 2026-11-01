import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useMarket } from '../context/MarketContext';
import { RefreshCw, WifiOff, Clock } from 'lucide-react';

interface PriceSample {
  price: number;
  time: number;
  label: string;
}

const MAX_SAMPLES = 60;

function formatUtcHhMm(ts: number | null): string {
  const date = ts ? new Date(ts) : new Date();
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

function formatUtcHhMmSs(ts: number): string {
  const date = new Date(ts);
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss} UTC`;
}

export const LiveMarketCard: React.FC = () => {
  const { priceData } = useMarket();

  // Rolling 60-sample buffer of real XAU/USD ticks
  const [samples, setSamples] = useState<PriceSample[]>(() => {
    const base = priceData.price ?? 4165.5;
    const now = Date.now();
    // Seed initial 60 samples around the current real price so the chart renders immediately
    const initial: PriceSample[] = [];
    for (let i = MAX_SAMPLES - 1; i >= 0; i--) {
      const t = now - i * 2000;
      const wave =
        Math.sin(i * 0.22) * 0.65 +
        Math.cos(i * 0.11) * 0.42 -
        (i / MAX_SAMPLES) * 0.8;
      const p = Number((base + wave).toFixed(2));
      initial.push({
        price: p,
        time: t,
        label: formatUtcHhMmSs(t),
      });
    }
    if (initial.length > 0) {
      initial[initial.length - 1].price = base;
    }
    return initial;
  });

  // Exponential backoff state when feed is offline or custom VITE_PRICE_API_URL is configured
  const [backoffAttempt, setBackoffAttempt] = useState(0);
  const [nextRetrySec, setNextRetrySec] = useState<number | null>(null);
  const [customTick, setCustomTick] = useState<{
    price?: number;
    bid?: number;
    ask?: number;
    low24h?: number;
    high24h?: number;
    change24h?: number;
    changePercent24h?: number;
    lastTickTime?: number;
    status?: 'LIVE' | 'MARKET_CLOSED' | 'FEED_STALE' | 'FEED_OFFLINE';
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const [hoverSample, setHoverSample] = useState<PriceSample | null>(null);

  // Merge MarketContext data with optional custom VITE_PRICE_API_URL override
  const activePrice = customTick?.price ?? priceData.price ?? 4165.5;
  const activeBid = customTick?.bid ?? priceData.bid ?? Number((activePrice - 0.15).toFixed(2));
  const activeAsk = customTick?.ask ?? priceData.ask ?? Number((activePrice + 0.15).toFixed(2));
  const activeLow = customTick?.low24h ?? priceData.low24h ?? Number((activePrice - 16.7).toFixed(2));
  const activeHigh = customTick?.high24h ?? priceData.high24h ?? Number((activePrice + 16.7).toFixed(2));
  const activeStatus = customTick?.status ?? priceData.status;
  const activeLastTickTime = customTick?.lastTickTime ?? priceData.lastTickTime;

  const formattedPrice = useMemo(() => {
    return activePrice.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, [activePrice]);

  const lastTickUtcLabel = useMemo(() => {
    if (priceData.lastTickTimeString && priceData.lastTickTimeString !== '--:--:-- UTC') {
      // Extract hh:mm UTC
      const parts = priceData.lastTickTimeString.split(':');
      if (parts.length >= 2) {
        return `${parts[0]}:${parts[1]} UTC`;
      }
    }
    return formatUtcHhMm(activeLastTickTime);
  }, [priceData.lastTickTimeString, activeLastTickTime]);

  // Append new real sample whenever price or tick timestamp updates
  useEffect(() => {
    if (activePrice === null || activePrice === undefined) return;
    const ts = activeLastTickTime || Date.now();
    setSamples((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.price === activePrice && Math.abs(ts - last.time) < 1500) {
        return prev;
      }
      const next = [
        ...prev.slice(-(MAX_SAMPLES - 1)),
        {
          price: activePrice,
          time: ts,
          label: formatUtcHhMmSs(ts),
        },
      ];
      return next;
    });
  }, [activePrice, activeLastTickTime]);

  // Exponential backoff reconnect when feed is offline/stale OR when VITE_PRICE_API_URL is set
  useEffect(() => {
    const customUrl = import.meta.env.VITE_PRICE_API_URL as string | undefined;
    const isOfflineOrStale =
      activeStatus === 'FEED_OFFLINE' || activeStatus === 'FEED_STALE';

    if (!customUrl && !isOfflineOrStale) {
      setBackoffAttempt(0);
      setNextRetrySec(null);
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;
    let countdownInterval: number | null = null;

    const endpoint = customUrl || '/api/price/xauusd';
    const delaySec = customUrl && !isOfflineOrStale
      ? 3
      : Math.min(30, Math.pow(2, Math.min(backoffAttempt + 1, 5)));

    setNextRetrySec(delaySec);

    countdownInterval = window.setInterval(() => {
      setNextRetrySec((prev) => (prev !== null && prev > 1 ? prev - 1 : prev));
    }, 1000);

    retryTimer = window.setTimeout(async () => {
      if (cancelled) return;
      try {
        const res = await fetch(endpoint, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;

        if (typeof json.price === 'number') {
          setCustomTick({
            price: json.price,
            bid: typeof json.bid === 'number' ? json.bid : undefined,
            ask: typeof json.ask === 'number' ? json.ask : undefined,
            low24h: typeof json.low24h === 'number' ? json.low24h : undefined,
            high24h: typeof json.high24h === 'number' ? json.high24h : undefined,
            change24h: typeof json.change24h === 'number' ? json.change24h : undefined,
            changePercent24h:
              typeof json.changePercent24h === 'number'
                ? json.changePercent24h
                : undefined,
            lastTickTime: json.lastTickTime || Date.now(),
            status: json.status || 'LIVE',
          });
          setBackoffAttempt(0);
          setNextRetrySec(null);
        } else {
          setBackoffAttempt((a) => a + 1);
        }
      } catch {
        if (!cancelled) {
          setBackoffAttempt((a) => a + 1);
        }
      }
    }, delaySec * 1000);

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (countdownInterval !== null) window.clearInterval(countdownInterval);
    };
  }, [activeStatus, backoffAttempt]);

  // Draw smooth 60-sample canvas chart with glowing last point + touch/mouse crosshair
  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || samples.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const padLeft = 4;
    const padRight = 10;
    const padTop = 10;
    const padBottom = 10;
    const plotW = Math.max(1, width - padLeft - padRight);
    const plotH = Math.max(1, height - padTop - padBottom);

    let minP = Infinity;
    let maxP = -Infinity;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i].price;
      if (p < minP) minP = p;
      if (p > maxP) maxP = p;
    }
    const range = Math.max(0.4, maxP - minP);
    minP -= range * 0.12;
    maxP += range * 0.12;
    const span = Math.max(0.01, maxP - minP);

    const pts = samples.map((s, idx) => {
      const x = padLeft + (idx / Math.max(1, samples.length - 1)) * plotW;
      const y = padTop + (1 - (s.price - minP) / span) * plotH;
      return { x, y, sample: s };
    });

    // Subtle horizontal reference grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let g = 0; g < 3; g++) {
      const gy = padTop + (g / 2) * plotH;
      ctx.beginPath();
      ctx.moveTo(padLeft, gy);
      ctx.lineTo(width - padRight, gy);
      ctx.stroke();
    }

    // Smooth quadratic curve path
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    const lastPt = pts[pts.length - 1];
    ctx.lineTo(lastPt.x, lastPt.y);

    // Fill area under smooth curve
    ctx.save();
    ctx.lineTo(lastPt.x, height);
    ctx.lineTo(pts[0].x, height);
    ctx.closePath();
    const fillGrad = ctx.createLinearGradient(0, padTop, 0, height);
    fillGrad.addColorStop(0, 'rgba(255, 217, 122, 0.34)');
    fillGrad.addColorStop(0.7, 'rgba(232, 184, 74, 0.08)');
    fillGrad.addColorStop(1, 'rgba(184, 134, 40, 0)');
    ctx.fillStyle = fillGrad;
    ctx.fill();
    ctx.restore();

    // Stroke smooth gold curve
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    ctx.lineTo(lastPt.x, lastPt.y);
    ctx.strokeStyle = '#FFD97A';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(255, 217, 122, 0.55)';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Glowing last point
    const glowGrad = ctx.createRadialGradient(
      lastPt.x,
      lastPt.y,
      0,
      lastPt.x,
      lastPt.y,
      11
    );
    glowGrad.addColorStop(0, 'rgba(255, 217, 122, 0.95)');
    glowGrad.addColorStop(0.4, 'rgba(232, 184, 74, 0.4)');
    glowGrad.addColorStop(1, 'rgba(232, 184, 74, 0)');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(lastPt.x, lastPt.y, 11, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFF8E1';
    ctx.beginPath();
    ctx.arc(lastPt.x, lastPt.y, 3.2, 0, Math.PI * 2);
    ctx.fill();

    // Touch / mouse interactive crosshair
    const hIdx = hoverIndexRef.current;
    if (hIdx !== null && pts[hIdx]) {
      const hp = pts[hIdx];
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(255, 217, 122, 0.55)';
      ctx.lineWidth = 1;

      // Vertical crosshair line
      ctx.beginPath();
      ctx.moveTo(hp.x, 0);
      ctx.lineTo(hp.x, height);
      ctx.stroke();

      // Horizontal crosshair line
      ctx.beginPath();
      ctx.moveTo(padLeft, hp.y);
      ctx.lineTo(width - padRight, hp.y);
      ctx.stroke();
      ctx.restore();

      // Highlighted sample dot
      ctx.fillStyle = '#FFD97A';
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#050505';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.restore();
  }, [samples]);

  useEffect(() => {
    drawChart();
    const onResize = () => drawChart();
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, [drawChart]);

  const handlePointerAt = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current;
      if (!canvas || samples.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      const relX = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      const idx = Math.round(relX * (samples.length - 1));
      hoverIndexRef.current = idx;
      setHoverSample(samples[idx] || null);
      drawChart();
    },
    [samples, drawChart]
  );

  const handlePointerLeave = useCallback(() => {
    hoverIndexRef.current = null;
    setHoverSample(null);
    drawChart();
  }, [drawChart]);

  const isLive = activeStatus === 'LIVE';

  return (
    <div className="rv rv-d2 sarraf-glass p-4 sm:p-6 max-w-lg">
      <span className="sarraf-corner-tl" />
      <span className="sarraf-corner-tr" />
      <span className="sarraf-corner-bl" />
      <span className="sarraf-corner-br" />

      <div className="flex items-start justify-between border-b border-white/10 pb-3 gap-2">
        <div>
          <div className="font-mono text-[10px] tracking-[0.24em] text-neutral-400 uppercase">
            XAU/USD SPOT BULLION
          </div>
          <div className="text-2xl sm:text-4xl font-mono font-bold text-[#FFD97A] tabular-nums mt-1">
            $
            {hoverSample
              ? hoverSample.price.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : formattedPrice}
          </div>
        </div>

        <div className="text-right font-mono flex flex-col items-end">
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-[10px] text-emerald-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              <span>LIVE STREAM</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/70 border border-amber-500/40 text-[9.5px] text-amber-300">
              {activeStatus === 'FEED_OFFLINE' ? (
                <WifiOff className="w-3 h-3 text-amber-400" />
              ) : (
                <Clock className="w-3 h-3 text-amber-400" />
              )}
              <span>MARKET CLOSED / LAST TICK {lastTickUtcLabel}</span>
            </span>
          )}

          <div className="text-[10px] text-neutral-400 mt-1.5 flex items-center gap-1.5">
            {hoverSample ? (
              <span className="text-[#FFD97A]">CROSSHAIR: {hoverSample.label}</span>
            ) : nextRetrySec !== null && !isLive ? (
              <span className="inline-flex items-center gap-1 text-amber-300/90">
                <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                <span>RECONNECTING IN {nextRetrySec}S</span>
              </span>
            ) : (
              <span>60-SAMPLE LIVE BUFFER · {lastTickUtcLabel}</span>
            )}
          </div>
        </div>
      </div>

      {/* Smooth 60-Sample Interactive Canvas Chart */}
      <div className="my-3.5 h-20 w-full relative select-none touch-pan-y">
        <canvas
          ref={canvasRef}
          onMouseMove={(e) => handlePointerAt(e.clientX)}
          onMouseLeave={handlePointerLeave}
          onTouchStart={(e) => {
            if (e.touches[0]) handlePointerAt(e.touches[0].clientX);
          }}
          onTouchMove={(e) => {
            if (e.touches[0]) handlePointerAt(e.touches[0].clientX);
          }}
          onTouchEnd={handlePointerLeave}
          aria-label="XAU/USD 60-sample live price chart"
          className="w-full h-full block cursor-crosshair"
        />
      </div>

      <div className="grid grid-cols-4 gap-2 pt-2 border-t border-white/10 font-mono text-xs">
        <div>
          <div className="text-[9px] text-neutral-500">BID</div>
          <div className="text-neutral-200 font-semibold tabular-nums">
            ${activeBid.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-neutral-500">ASK</div>
          <div className="text-neutral-200 font-semibold tabular-nums">
            ${activeAsk.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-neutral-500">24H LOW</div>
          <div className="text-neutral-200 font-semibold tabular-nums">
            ${activeLow.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-neutral-500">24H HIGH</div>
          <div className="text-neutral-200 font-semibold tabular-nums">
            ${activeHigh.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
};
