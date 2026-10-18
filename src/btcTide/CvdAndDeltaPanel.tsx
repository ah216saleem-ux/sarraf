import React, { useRef, useEffect, useMemo } from 'react';
import { BtcFeedStatus, SecondBin } from './types';
import {
  buildContinuousSecondSeries,
  computeTenSecDeltaBars,
} from './useBtcTideStore';
import { TrendingUp, BarChart2 } from 'lucide-react';

interface CvdAndDeltaPanelProps {
  secondBins: SecondBin[];
  status: BtcFeedStatus;
}

function formatUtcShort(sec: number): string {
  const d = new Date(sec * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export const CvdAndDeltaPanel: React.FC<CvdAndDeltaPanelProps> = React.memo(
  ({ secondBins, status }) => {
    const cvdCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const cvdContainerRef = useRef<HTMLDivElement | null>(null);
    const deltaCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const deltaContainerRef = useRef<HTMLDivElement | null>(null);

    const isStaleOrOffline = status === 'STALE' || status === 'OFFLINE';

    // 1. 3-Min (180s) CVD + Price Series
    const series3m = useMemo(
      () => buildContinuousSecondSeries(secondBins, 180),
      [secondBins]
    );

    const cvdPoints = useMemo(() => {
      let cum = 0;
      return series3m.map((b) => {
        cum += b.buyVol - b.sellVol;
        return {
          sec: b.sec,
          cvd: cum,
          price: b.lastPrice,
        };
      });
    }, [series3m]);

    // 2. Last 5 Min (300s) Delta per 10 Seconds Bars (up to 30 bars)
    const tenSecBars = useMemo(
      () => computeTenSecDeltaBars(secondBins),
      [secondBins]
    );

    // Draw 3-Min CVD with Price Overlay
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
        const height = 220;

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
        const padRight = 64;
        const topPad = 16;
        const botPad = 24;
        const plotW = Math.max(80, width - padLeft - padRight);
        const plotH = height - topPad - botPad;

        // Grid lines
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
          ctx.font = '12px JetBrains Mono, monospace';
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
        let minCvd = Math.min(0, ...cvdPoints.map((p) => p.cvd));
        let maxCvd = Math.max(0, ...cvdPoints.map((p) => p.cvd));
        if (maxCvd - minCvd < 0.001) {
          maxCvd += 0.01;
          minCvd -= 0.01;
        }
        const cvdSpan = maxCvd - minCvd;

        let minPrice = cvdPoints[0].price;
        let maxPrice = cvdPoints[0].price;
        for (let i = 1; i < n; i++) {
          if (cvdPoints[i].price < minPrice) minPrice = cvdPoints[i].price;
          if (cvdPoints[i].price > maxPrice) maxPrice = cvdPoints[i].price;
        }
        const priceSpan = Math.max(0.5, maxPrice - minPrice);

        const getX = (i: number) => padLeft + (i / (n - 1)) * plotW;
        const getCvdY = (val: number) =>
          topPad + plotH - ((val - minCvd) / cvdSpan) * plotH;
        const zeroY = getCvdY(0);

        // Zero baseline
        ctx.strokeStyle = 'rgba(232, 184, 74, 0.25)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, zeroY);
        ctx.lineTo(padLeft + plotW, zeroY);
        ctx.stroke();
        ctx.setLineDash([]);

        const lastCvd = cvdPoints[n - 1].cvd;
        const isPos = lastCvd >= 0;

        // CVD Shaded Area
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
          grad.addColorStop(0, 'rgba(20, 184, 166, 0.28)');
          grad.addColorStop(1, 'rgba(20, 184, 166, 0.02)');
        } else {
          grad.addColorStop(0, 'rgba(244, 63, 94, 0.02)');
          grad.addColorStop(1, 'rgba(244, 63, 94, 0.28)');
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

        // Price Overlay Line (White / Gold)
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = getX(i);
          const pNorm = (cvdPoints[i].price - minPrice) / priceSpan;
          const py = topPad + plotH - 8 - pNorm * (plotH - 16);
          if (i === 0) ctx.moveTo(x, py);
          else ctx.lineTo(x, py);
        }
        ctx.strokeStyle = isStaleOrOffline
          ? 'rgba(180, 180, 180, 0.4)'
          : '#FFD97A';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Right Axis Labels
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = isStaleOrOffline
          ? '#9ca3af'
          : isPos
          ? '#2dd4bf'
          : '#fb7185';
        const lastCvdY = getCvdY(lastCvd);
        ctx.fillText(
          `${lastCvd >= 0 ? '+' : ''}${lastCvd.toFixed(3)}₿`,
          padLeft + plotW + 6,
          Math.max(topPad + 10, Math.min(topPad + plotH - 6, lastCvdY))
        );

        const lastPrice = cvdPoints[n - 1].price;
        const lastPY =
          topPad + plotH - 8 - ((lastPrice - minPrice) / priceSpan) * (plotH - 16);
        ctx.fillStyle = isStaleOrOffline ? '#9ca3af' : '#FFD97A';
        ctx.fillText(
          `$${lastPrice.toFixed(0)}`,
          padLeft + plotW + 6,
          Math.max(topPad + 22, Math.min(topPad + plotH - 18, lastPY))
        );

        // X-axis timestamps
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

    // Draw Delta per 10 Seconds (Last 5 Min) Bars
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
        const height = 220;

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
        const padRight = 64;
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

        ctx.strokeStyle = 'rgba(232, 184, 74, 0.25)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, midY);
        ctx.lineTo(padLeft + plotW, midY);
        ctx.stroke();
        ctx.setLineDash([]);

        if (tenSecBars.length < 1 || secondBins.length < 3) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.font = '12px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillText('collecting live data...', width / 2, midY);
          ctx.restore();
          return;
        }

        const n = tenSecBars.length;
        const slotCount = Math.max(n, 15);
        const stepX = plotW / slotCount;
        const barW = Math.max(4, Math.min(16, stepX * 0.72));

        let maxAbsDelta = 0.001;
        for (let i = 0; i < n; i++) {
          const a = Math.abs(tenSecBars[i].deltaBtc);
          if (a > maxAbsDelta) maxAbsDelta = a;
        }

        for (let i = 0; i < n; i++) {
          const b = tenSecBars[i];
          const x = padLeft + (i + (slotCount - n)) * stepX + stepX * 0.5;
          const d = b.deltaBtc;
          const bh = Math.max(1.5, (Math.abs(d) / maxAbsDelta) * halfH);

          if (d >= 0) {
            ctx.fillStyle = isStaleOrOffline
              ? 'rgba(115, 115, 115, 0.5)'
              : 'rgba(20, 184, 166, 0.9)';
            ctx.fillRect(x - barW / 2, midY - bh, barW, bh);
          } else {
            ctx.fillStyle = isStaleOrOffline
              ? 'rgba(95, 95, 95, 0.5)'
              : 'rgba(244, 63, 94, 0.9)';
            ctx.fillRect(x - barW / 2, midY, barW, bh);
          }
        }

        // Right Y-Axis Labels
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`+${maxAbsDelta.toFixed(2)}₿`, padLeft + plotW + 6, topPad + 10);
        ctx.fillText('0.00₿', padLeft + plotW + 6, midY + 3);
        ctx.fillText(
          `-${maxAbsDelta.toFixed(2)}₿`,
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

    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 3-Min CVD with Price Overlay */}
        <div
          ref={cvdContainerRef}
          className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#FFD97A]" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                3-MIN CVD &amp; PRICE OVERLAY
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono text-[10px] text-neutral-400">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-0.5 bg-teal-400 inline-block" /> CVD
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-0.5 bg-[#FFD97A] inline-block" /> PRICE
              </span>
            </div>
          </div>
          <div className="w-full h-[220px] mt-2">
            <canvas
              ref={cvdCanvasRef}
              className="w-full h-full block"
              style={{ width: '100%', height: '220px' }}
            />
          </div>
        </div>

        {/* Delta per 10 Seconds (Last 5 Min) Bars */}
        <div
          ref={deltaContainerRef}
          className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-[#FFD97A]" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                DELTA PER 10 SECONDS (LAST 5 MIN)
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono text-[10px] text-neutral-400">
              <span className="text-teal-400">+BUY DELTA</span>
              <span>/</span>
              <span className="text-rose-400">-SELL DELTA</span>
            </div>
          </div>
          <div className="w-full h-[220px] mt-2">
            <canvas
              ref={deltaCanvasRef}
              className="w-full h-full block"
              style={{ width: '100%', height: '220px' }}
            />
          </div>
        </div>
      </div>
    );
  }
);

CvdAndDeltaPanel.displayName = 'CvdAndDeltaPanel';
