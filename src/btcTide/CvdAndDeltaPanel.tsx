import React, { useRef, useEffect, useMemo, useState } from 'react';
import { BtcFeedStatus, SecondBin } from './types';
import {
  buildContinuousSecondSeries,
  computeTenSecDeltaBars,
  computePercentile,
} from './useBtcTideStore';
import { TrendingUp, BarChart2 } from 'lucide-react';

interface CvdAndDeltaPanelProps {
  secondBins: SecondBin[];
  status: BtcFeedStatus;
  isSpotStale?: boolean;
  spotAgeMs?: number;
}

function formatUtcShort(sec: number): string {
  const d = new Date(sec * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatBtcLabel(val: number): string {
  const abs = Math.abs(val);
  const sign = val > 0 ? '+' : val < 0 ? '-' : '';
  if (abs >= 10) return `${sign}${abs.toFixed(1)} BTC`;
  if (abs >= 1) return `${sign}${abs.toFixed(2)} BTC`;
  return `${sign}${abs.toFixed(3)} BTC`;
}

export const CvdAndDeltaPanel: React.FC<CvdAndDeltaPanelProps> = React.memo(
  ({ secondBins, status, isSpotStale = false, spotAgeMs = 0 }) => {
    const [cvdWindow, setCvdWindow] = useState<'3m' | '30m'>('3m');

    const cvdCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const cvdContainerRef = useRef<HTMLDivElement | null>(null);
    const deltaCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const deltaContainerRef = useRef<HTMLDivElement | null>(null);

    const isStaleOrOffline = isSpotStale || status === 'STALE' || status === 'OFFLINE';
    const ageLabel =
      spotAgeMs > 0 && spotAgeMs < 999999 ? `${(spotAgeMs / 1000).toFixed(1)}s` : '--';

    // 1. 3-Min (180s) or 30-Min (1800s) CVD + Price Series
    const maxCvdSec = cvdWindow === '3m' ? 180 : 1800;
    const cvdSeries = useMemo(
      () => buildContinuousSecondSeries(secondBins, maxCvdSec),
      [secondBins, maxCvdSec]
    );

    const cvdPoints = useMemo(() => {
      let cum = 0;
      return cvdSeries.map((b) => {
        cum += b.buyVol - b.sellVol;
        return {
          sec: b.sec,
          cvd: cum,
          price: b.lastPrice,
        };
      });
    }, [cvdSeries]);

    // 2. Last 5 Min (300s) Delta per 10 Seconds Bars (up to 30 bars)
    const tenSecBars = useMemo(
      () => computeTenSecDeltaBars(secondBins),
      [secondBins]
    );

    // Draw CVD (3m / 30m) with Separate Scales for CVD (Left Axis) & Price (Right Axis) + Zero Line
    useEffect(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const canvas = cvdCanvasRef.current;
      const container = cvdContainerRef.current;
      if (!canvas || !container) return;

      const drawCvd = () => {
        if (typeof document !== 'undefined' && document.hidden) return;
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(260, Math.floor(rect.width));
        const height = 230;

        if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
          canvas.width = width * dpr;
          canvas.height = height * dpr;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        const padLeft = 66; // Left axis for CVD (BTC)
        const padRight = 58; // Right axis for Price ($)
        const topPad = 16;
        const botPad = 24;
        const plotW = Math.max(80, width - padLeft - padRight);
        const plotH = height - topPad - botPad;

        // Subtle horizontal grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        for (const frac of [0.2, 0.5, 0.8]) {
          const gy = topPad + plotH * frac;
          ctx.beginPath();
          ctx.moveTo(padLeft, gy);
          ctx.lineTo(padLeft + plotW, gy);
          ctx.stroke();
        }

        if (cvdPoints.length < 5) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(
            `collecting live data... (${cvdPoints.length}s / 5s min)`,
            width / 2,
            topPad + plotH / 2
          );
          ctx.restore();
          return;
        }

        const n = cvdPoints.length;

        // Separate Scale 1: CVD (always includes 0 so the zero line is inside the plot)
        let rawMinCvd = 0;
        let rawMaxCvd = 0;
        let rawMinPrice = cvdPoints[0].price;
        let rawMaxPrice = cvdPoints[0].price;

        for (let i = 0; i < n; i++) {
          const pt = cvdPoints[i];
          if (pt.cvd < rawMinCvd) rawMinCvd = pt.cvd;
          if (pt.cvd > rawMaxCvd) rawMaxCvd = pt.cvd;
          if (pt.price < rawMinPrice) rawMinPrice = pt.price;
          if (pt.price > rawMaxPrice) rawMaxPrice = pt.price;
        }

        const cvdRange = Math.max(0.02, rawMaxCvd - rawMinCvd);
        const minCvd = rawMinCvd - cvdRange * 0.08;
        const maxCvd = rawMaxCvd + cvdRange * 0.08;
        const cvdSpan = maxCvd - minCvd;

        // Separate Scale 2: Price with 5% padding
        const rawPriceSpan = Math.max(1.0, rawMaxPrice - rawMinPrice);
        const pricePad = rawPriceSpan * 0.05;
        const minPrice = rawMinPrice - pricePad;
        const maxPrice = rawMaxPrice + pricePad;
        const priceSpan = maxPrice - minPrice;

        const getX = (i: number) => padLeft + (i / (n - 1)) * plotW;
        const getCvdY = (val: number) =>
          topPad + plotH - ((val - minCvd) / cvdSpan) * plotH;
        const getPriceY = (p: number) =>
          topPad + plotH - ((p - minPrice) / priceSpan) * plotH;

        const zeroY = getCvdY(0);

        // Zero Line Drawn Clearly
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, zeroY);
        ctx.lineTo(padLeft + plotW, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);

        const lastCvd = cvdPoints[n - 1].cvd;
        const isPos = lastCvd >= 0;

        // CVD Shaded Area to Zero Line
        ctx.beginPath();
        ctx.moveTo(getX(0), zeroY);
        for (let i = 0; i < n; i++) {
          ctx.lineTo(getX(i), getCvdY(cvdPoints[i].cvd));
        }
        ctx.lineTo(getX(n - 1), zeroY);
        ctx.closePath();

        const grad = ctx.createLinearGradient(0, topPad, 0, topPad + plotH);
        if (isStaleOrOffline) {
          grad.addColorStop(0, 'rgba(120, 120, 120, 0.16)');
          grad.addColorStop(1, 'rgba(120, 120, 120, 0.03)');
        } else if (isPos) {
          grad.addColorStop(0, 'rgba(20, 184, 166, 0.26)');
          grad.addColorStop(1, 'rgba(20, 184, 166, 0.02)');
        } else {
          grad.addColorStop(0, 'rgba(244, 63, 94, 0.02)');
          grad.addColorStop(1, 'rgba(244, 63, 94, 0.26)');
        }
        ctx.fillStyle = grad;
        ctx.fill();

        // CVD Line
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = getX(i);
          const y = getCvdY(cvdPoints[i].cvd);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = isStaleOrOffline
          ? 'rgba(150, 150, 150, 0.5)'
          : isPos
          ? '#2dd4bf'
          : '#fb7185';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Price Line (Separate Scale)
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = getX(i);
          const py = getPriceY(cvdPoints[i].price);
          if (i === 0) ctx.moveTo(x, py);
          else ctx.lineTo(x, py);
        }
        ctx.strokeStyle = isStaleOrOffline
          ? 'rgba(180, 180, 180, 0.4)'
          : '#FFD97A';
        ctx.lineWidth = 1.6;
        ctx.stroke();

        // Left Y-Axis Labels: CVD Scale (BTC)
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.fillText(formatBtcLabel(rawMaxCvd), padLeft - 6, topPad + 9);
        ctx.fillText(formatBtcLabel(rawMinCvd), padLeft - 6, topPad + plotH - 3);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fillText(
          '0 BTC',
          padLeft - 6,
          Math.max(topPad + 20, Math.min(topPad + plotH - 14, zeroY + 3))
        );

        // Right Y-Axis Labels: Price Scale ($)
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.fillText(`$${rawMaxPrice.toFixed(0)}`, padLeft + plotW + 6, topPad + 9);
        ctx.fillText(`$${rawMinPrice.toFixed(0)}`, padLeft + plotW + 6, topPad + plotH - 3);

        const lastPrice = cvdPoints[n - 1].price;
        const lastPY = getPriceY(lastPrice);
        ctx.fillStyle = isStaleOrOffline ? '#9ca3af' : '#FFD97A';
        ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(
          `$${lastPrice.toFixed(0)}`,
          padLeft + plotW + 6,
          Math.max(topPad + 20, Math.min(topPad + plotH - 14, lastPY + 3))
        );

        // X-axis timestamps
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.textAlign = 'left';
        ctx.fillText(formatUtcShort(cvdPoints[0].sec), padLeft, height - 6);
        ctx.textAlign = 'right';
        ctx.fillText(
          formatUtcShort(cvdPoints[n - 1].sec),
          padLeft + plotW,
          height - 6
        );

        ctx.restore();
      };

      drawCvd();
      const handleResize = () => drawCvd();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, [cvdPoints, isStaleOrOffline]);

    // Draw Delta per 10 Seconds (Last 5 Min, Scaled to p95, Current Partial Bucket Drawn Lighter)
    useEffect(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const canvas = deltaCanvasRef.current;
      const container = deltaContainerRef.current;
      if (!canvas || !container) return;

      const drawDelta = () => {
        if (typeof document !== 'undefined' && document.hidden) return;
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(260, Math.floor(rect.width));
        const height = 230;

        if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
          canvas.width = width * dpr;
          canvas.height = height * dpr;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        const padLeft = 12;
        const padRight = 76;
        const topPad = 16;
        const botPad = 24;
        const plotW = Math.max(80, width - padLeft - padRight);
        const plotH = height - topPad - botPad;
        const midY = topPad + plotH * 0.5;
        const halfH = plotH * 0.44;

        // Grid & Zero Line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        for (const frac of [0.2, 0.8]) {
          const gy = topPad + plotH * frac;
          ctx.beginPath();
          ctx.moveTo(padLeft, gy);
          ctx.lineTo(padLeft + plotW, gy);
          ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(232, 184, 74, 0.28)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, midY);
        ctx.lineTo(padLeft + plotW, midY);
        ctx.stroke();
        ctx.setLineDash([]);

        if (tenSecBars.length < 1 || secondBins.length < 3) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.textAlign = 'center';
          ctx.fillText('collecting live data...', width / 2, midY);
          ctx.restore();
          return;
        }

        const n = tenSecBars.length;
        const slotCount = Math.max(n, 30);
        const stepX = plotW / slotCount;
        const barW = Math.max(4, Math.min(16, stepX * 0.72));

        // Scale bars to the 95th percentile (p95) of |deltaBtc|
        const nonZeroAbsDeltas = tenSecBars
          .map((b) => Math.abs(b.deltaBtc))
          .filter((v) => v > 0);
        const p95Delta = Math.max(
          0.01,
          computePercentile(
            nonZeroAbsDeltas.length > 0 ? nonZeroAbsDeltas : [0.01],
            0.95
          )
        );

        for (let i = 0; i < n; i++) {
          const b = tenSecBars[i];
          const isPartial = Boolean(b.isPartial || i === n - 1);
          const x = padLeft + (i + (slotCount - n)) * stepX + stepX * 0.5;
          const d = b.deltaBtc;
          if (Math.abs(d) === 0 && !isPartial) continue;

          const norm = Math.min(1.12, Math.abs(d) / p95Delta);
          const bh = Math.max(2, norm * halfH);

          if (d >= 0) {
            ctx.fillStyle = isStaleOrOffline
              ? 'rgba(115, 115, 115, 0.45)'
              : isPartial
              ? 'rgba(45, 212, 191, 0.35)'
              : 'rgba(20, 184, 166, 0.9)';
            ctx.fillRect(x - barW / 2, midY - bh, barW, bh);

            if (isPartial && !isStaleOrOffline) {
              ctx.strokeStyle = 'rgba(94, 234, 212, 0.85)';
              ctx.lineWidth = 1;
              ctx.strokeRect(x - barW / 2, midY - bh, barW, bh);
            }
          } else {
            ctx.fillStyle = isStaleOrOffline
              ? 'rgba(95, 95, 95, 0.45)'
              : isPartial
              ? 'rgba(251, 113, 133, 0.35)'
              : 'rgba(244, 63, 94, 0.9)';
            ctx.fillRect(x - barW / 2, midY, barW, bh);

            if (isPartial && !isStaleOrOffline) {
              ctx.strokeStyle = 'rgba(253, 164, 175, 0.85)';
              ctx.lineWidth = 1;
              ctx.strokeRect(x - barW / 2, midY, barW, bh);
            }
          }
        }

        // Right Y-Axis Labels (p95 BTC scale)
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(45, 212, 191, 0.85)';
        ctx.fillText(formatBtcLabel(p95Delta), padLeft + plotW + 6, topPad + 10);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.fillText('0 BTC', padLeft + plotW + 6, midY + 3);
        ctx.fillStyle = 'rgba(251, 113, 133, 0.85)';
        ctx.fillText(
          formatBtcLabel(-p95Delta),
          padLeft + plotW + 6,
          topPad + plotH - 4
        );

        // X-Axis Time Labels
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.textAlign = 'left';
        ctx.fillText(formatUtcShort(tenSecBars[0].bucketSec), padLeft, height - 6);
        ctx.textAlign = 'right';
        ctx.fillText(
          formatUtcShort(tenSecBars[n - 1].bucketSec),
          padLeft + plotW,
          height - 6
        );

        ctx.restore();
      };

      drawDelta();
      const handleResize = () => drawDelta();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, [tenSecBars, secondBins.length, isStaleOrOffline]);

    const currentCvdBtc =
      cvdPoints.length > 0 ? cvdPoints[cvdPoints.length - 1].cvd : null;

    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* CVD (3-Min & 30-Min Toggle, Separate CVD & Price Scales, Zero Line) */}
        <div
          ref={cvdContainerRef}
          className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#FFD97A]" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                CVD &amp; PRICE ({cvdWindow.toUpperCase()})
              </span>
              {currentCvdBtc !== null && (
                <span
                  className={`font-mono text-xs font-bold ${
                    isStaleOrOffline
                      ? 'text-neutral-500'
                      : currentCvdBtc >= 0
                      ? 'text-teal-400'
                      : 'text-rose-400'
                  }`}
                >
                  {formatBtcLabel(currentCvdBtc)}
                </span>
              )}
              {isStaleOrOffline && (
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300">
                  STALE · {ageLabel}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2.5 font-mono text-[10px]">
              <div className="flex items-center gap-2 text-neutral-400">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-0.5 bg-teal-400 inline-block" /> CVD (L)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-0.5 bg-[#FFD97A] inline-block" /> PRICE (R)
                </span>
              </div>

              {/* 3m | 30m Toggle */}
              <div className="flex items-center p-0.5 rounded-lg bg-black/70 border border-white/10">
                {(['3m', '30m'] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setCvdWindow(w)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all cursor-pointer ${
                      cvdWindow === w
                        ? 'bg-[#E8B84A] text-black font-bold'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="w-full h-[230px] mt-2">
            <canvas
              ref={cvdCanvasRef}
              className="w-full h-full block"
              style={{ width: '100%', height: '230px' }}
            />
          </div>
        </div>

        {/* Delta per 10 Seconds (Last 5 Min · p95 Scale · Partial Bucket Lighter) */}
        <div
          ref={deltaContainerRef}
          className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-[#FFD97A]" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                DELTA PER 10S (LAST 5 MIN · P95 SCALE)
              </span>
              {isStaleOrOffline && (
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300">
                  STALE · {ageLabel}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2.5 font-mono text-[10px] text-neutral-400">
              <span className="text-teal-400">+BUY</span>
              <span>/</span>
              <span className="text-rose-400">-SELL</span>
              <span>·</span>
              <span className="text-neutral-300">LIVE 10S LIGHTER</span>
            </div>
          </div>
          <div className="w-full h-[230px] mt-2">
            <canvas
              ref={deltaCanvasRef}
              className="w-full h-full block"
              style={{ width: '100%', height: '230px' }}
            />
          </div>
        </div>
      </div>
    );
  }
);

CvdAndDeltaPanel.displayName = 'CvdAndDeltaPanel';
