import React, { useRef, useEffect, useMemo } from 'react';
import { BtcFeedStatus, SecondBin } from './types';
import {
  buildContinuousSecondSeries,
  detectWaveformEvents,
} from './useBtcTideStore';
import { Waves } from 'lucide-react';

interface AggressionWaveformCanvasProps {
  secondBins: SecondBin[];
  status: BtcFeedStatus;
}

function formatSecLabel(sec: number): string {
  const d = new Date(sec * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export const AggressionWaveformCanvas: React.FC<AggressionWaveformCanvasProps> =
  React.memo(({ secondBins, status }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const isStaleOrOffline = status === 'STALE' || status === 'OFFLINE';

    // Build continuous 3-minute (180 seconds) series from real store bins
    const series = useMemo(
      () => buildContinuousSecondSeries(secondBins, 180),
      [secondBins]
    );

    const { events, rollingNet6s, atr6s } = useMemo(
      () => detectWaveformEvents(series),
      [series]
    );

    const hasEnoughData = series.length >= 6;

    useEffect(() => {
      // Pause drawing when tab is hidden
      if (typeof document !== 'undefined' && document.hidden) return;

      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const draw = () => {
        if (typeof document !== 'undefined' && document.hidden) return;
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(300, Math.floor(rect.width));
        const height = 310;

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
        const topPad = 56; // Reserved for non-overlapping stacked ABSORB / DRIVE labels
        const botPad = 24;
        const plotW = Math.max(100, width - padLeft - padRight);
        const plotH = height - topPad - botPad;
        const midY = topPad + plotH * 0.5;
        const halfH = plotH * 0.45;

        // Subtle horizontal grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        for (const frac of [0.15, 0.5, 0.85]) {
          const gy = topPad + plotH * frac;
          ctx.beginPath();
          ctx.moveTo(padLeft, gy);
          ctx.lineTo(padLeft + plotW, gy);
          ctx.stroke();
        }

        // Zero centerline
        ctx.strokeStyle = 'rgba(232, 184, 74, 0.25)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padLeft, midY);
        ctx.lineTo(padLeft + plotW, midY);
        ctx.stroke();
        ctx.setLineDash([]);

        if (!hasEnoughData) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.font = '12px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(
            `collecting live data... (${series.length}s / 6s min)`,
            width / 2,
            midY
          );
          ctx.restore();
          return;
        }

        const n = series.length;
        // Map index [0 .. n-1] across plotW (up to 180 bars)
        const slotCount = Math.max(n, 30);
        const stepX = plotW / slotCount;
        const barW = Math.max(1.5, Math.min(7, stepX * 0.72));

        // Compute scale maxima
        let maxBarVol = 0.001;
        let maxAbsNet6 = 0.001;
        let minPrice = series[0].lastPrice;
        let maxPrice = series[0].lastPrice;

        for (let i = 0; i < n; i++) {
          const b = series[i];
          if (b.buyVol > maxBarVol) maxBarVol = b.buyVol;
          if (b.sellVol > maxBarVol) maxBarVol = b.sellVol;
          const absNet = Math.abs(rollingNet6s[i] || 0);
          if (absNet > maxAbsNet6) maxAbsNet6 = absNet;
          if (b.lastPrice < minPrice) minPrice = b.lastPrice;
          if (b.lastPrice > maxPrice) maxPrice = b.lastPrice;
        }
        const priceSpan = Math.max(0.5, maxPrice - minPrice);

        const getX = (idx: number) =>
          padLeft + (idx + (slotCount - n)) * stepX + stepX * 0.5;

        // 1. Shaded Rolling Net (rollingNet6s)
        ctx.beginPath();
        ctx.moveTo(getX(0), midY);
        for (let i = 0; i < n; i++) {
          const x = getX(i);
          const netNorm = (rollingNet6s[i] || 0) / maxAbsNet6;
          const y = midY - netNorm * (halfH * 0.85);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(getX(n - 1), midY);
        ctx.closePath();

        const netGrad = ctx.createLinearGradient(0, topPad, 0, topPad + plotH);
        if (isStaleOrOffline) {
          netGrad.addColorStop(0, 'rgba(120, 120, 120, 0.14)');
          netGrad.addColorStop(0.5, 'rgba(120, 120, 120, 0.03)');
          netGrad.addColorStop(1, 'rgba(120, 120, 120, 0.14)');
        } else {
          netGrad.addColorStop(0, 'rgba(20, 184, 166, 0.22)');
          netGrad.addColorStop(0.5, 'rgba(20, 184, 166, 0.02)');
          netGrad.addColorStop(0.501, 'rgba(244, 63, 94, 0.02)');
          netGrad.addColorStop(1, 'rgba(244, 63, 94, 0.22)');
        }
        ctx.fillStyle = netGrad;
        ctx.fill();

        // Stroke Rolling Net outline
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = getX(i);
          const netNorm = (rollingNet6s[i] || 0) / maxAbsNet6;
          const y = midY - netNorm * (halfH * 0.85);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = isStaleOrOffline
          ? 'rgba(140, 140, 140, 0.35)'
          : 'rgba(232, 184, 74, 0.38)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // 2. Per-Second Aggression Bars: Buy Up (Teal), Sell Down (Rose)
        for (let i = 0; i < n; i++) {
          const b = series[i];
          const x = getX(i);

          if (b.buyVol > 0) {
            const bh = Math.max(1.5, (b.buyVol / maxBarVol) * halfH);
            ctx.fillStyle = isStaleOrOffline
              ? 'rgba(115, 115, 115, 0.5)'
              : 'rgba(20, 184, 166, 0.88)';
            ctx.fillRect(x - barW / 2, midY - bh, barW, bh);
          }

          if (b.sellVol > 0) {
            const sh = Math.max(1.5, (b.sellVol / maxBarVol) * halfH);
            ctx.fillStyle = isStaleOrOffline
              ? 'rgba(95, 95, 95, 0.5)'
              : 'rgba(244, 63, 94, 0.88)';
            ctx.fillRect(x - barW / 2, midY, barW, sh);
          }
        }

        // 3. White Price Line
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = getX(i);
          const pNorm = (series[i].lastPrice - minPrice) / priceSpan;
          const py = topPad + plotH - 12 - pNorm * (plotH - 24);
          if (i === 0) ctx.moveTo(x, py);
          else ctx.lineTo(x, py);
        }
        ctx.strokeStyle = isStaleOrOffline
          ? 'rgba(160, 160, 160, 0.5)'
          : '#ffffff';
        ctx.lineWidth = 1.75;
        ctx.stroke();

        // 4. Glowing Dots on Large Prints (>= $50K)
        for (let i = 0; i < n; i++) {
          const b = series[i];
          if (b.largePrintMaxUsd >= 50000) {
            const x = getX(i);
            const isBuyPrint = b.largePrintSide === 'BUY';
            const dotY = isBuyPrint
              ? midY - Math.max(6, (b.buyVol / maxBarVol) * halfH)
              : midY + Math.max(6, (b.sellVol / maxBarVol) * halfH);

            ctx.save();
            if (!prefersReducedMotion && !isStaleOrOffline) {
              ctx.shadowColor = isBuyPrint ? '#2dd4bf' : '#fb7185';
              ctx.shadowBlur = 12;
            }
            ctx.fillStyle = isStaleOrOffline
              ? '#a3a3a3'
              : isBuyPrint
              ? '#5eead4'
              : '#fda4af';
            ctx.beginPath();
            ctx.arc(x, dotY, 4.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#FFD97A';
            ctx.lineWidth = 1.25;
            ctx.stroke();
            ctx.restore();
          }
        }

        // 5. Non-Overlapping Stacked ABSORB and DRIVE Labels
        if (events.length > 0) {
          const secToIndex = new Map<number, number>();
          for (let i = 0; i < n; i++) {
            secToIndex.set(series[i].sec, i);
          }

          ctx.font = 'bold 9px JetBrains Mono, monospace';
          const occupiedRows: Array<Array<{ x1: number; x2: number }>> = [];
          const maxRows = 3;

          for (const ev of events) {
            const idx = secToIndex.get(ev.sec);
            if (idx === undefined) continue;
            const rawX = getX(idx);
            const arrow = ev.side === 'BUY' ? '↑' : '↓';
            const labelText = `${ev.type} ${arrow}`;
            const textW = ctx.measureText(labelText).width;
            const boxW = textW + 10;
            const boxH = 14;

            const clampedX = Math.max(
              padLeft + boxW / 2,
              Math.min(padLeft + plotW - boxW / 2, rawX)
            );
            const x1 = clampedX - boxW / 2;
            const x2 = clampedX + boxW / 2;

            // Find lowest row without horizontal overlap (min 4px gap)
            let assignedRow = -1;
            for (let r = 0; r < maxRows; r++) {
              if (!occupiedRows[r]) occupiedRows[r] = [];
              const overlaps = occupiedRows[r].some(
                (interval) => !(x2 + 4 < interval.x1 || x1 - 4 > interval.x2)
              );
              if (!overlaps) {
                assignedRow = r;
                occupiedRows[r].push({ x1, x2 });
                break;
              }
            }
            if (assignedRow === -1) continue;

            const boxY = 6 + assignedRow * (boxH + 3);

            // Leader line down to the bar
            ctx.save();
            ctx.strokeStyle =
              ev.type === 'DRIVE'
                ? ev.side === 'BUY'
                  ? 'rgba(45, 212, 191, 0.55)'
                  : 'rgba(251, 113, 133, 0.55)'
                : 'rgba(232, 184, 74, 0.55)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(rawX, boxY + boxH);
            ctx.lineTo(rawX, midY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Badge background
            ctx.fillStyle = 'rgba(8, 8, 10, 0.92)';
            ctx.fillRect(x1, boxY, boxW, boxH);

            ctx.strokeStyle =
              ev.type === 'DRIVE'
                ? ev.side === 'BUY'
                  ? '#14b8a6'
                  : '#f43f5e'
                : '#E8B84A';
            ctx.lineWidth = 1;
            ctx.strokeRect(x1, boxY, boxW, boxH);

            // Badge text
            ctx.fillStyle =
              ev.type === 'DRIVE'
                ? ev.side === 'BUY'
                  ? '#5eead4'
                  : '#fda4af'
                : '#FFD97A';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(labelText, clampedX, boxY + boxH / 2 + 0.5);
            ctx.restore();
          }
        }

        // Right Y-Axis Labels (Max Vol, Price, Min Vol)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`+${maxBarVol.toFixed(2)}₿`, padLeft + plotW + 6, topPad + 10);
        ctx.fillText('0.00₿', padLeft + plotW + 6, midY + 3);
        ctx.fillText(
          `-${maxBarVol.toFixed(2)}₿`,
          padLeft + plotW + 6,
          topPad + plotH - 4
        );

        // Current white price tag on right axis
        const lastP = series[n - 1].lastPrice;
        const lastPNorm = (lastP - minPrice) / priceSpan;
        const lastPY = topPad + plotH - 12 - lastPNorm * (plotH - 24);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(
          `$${lastP.toFixed(0)}`,
          padLeft + plotW + 6,
          Math.max(topPad + 22, Math.min(topPad + plotH - 16, lastPY))
        );

        // Bottom X-axis time labels
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.textAlign = 'left';
        ctx.fillText(formatSecLabel(series[0].sec), padLeft, height - 6);
        ctx.textAlign = 'right';
        ctx.fillText(formatSecLabel(series[n - 1].sec), padLeft + plotW, height - 6);

        ctx.restore();
      };

      draw();

      const handleResize = () => draw();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, [series, events, rollingNet6s, hasEnoughData, isStaleOrOffline]);

    return (
      <div
        ref={containerRef}
        className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)]"
      >
        {/* Header & Legend */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Waves className="w-4 h-4 text-[#FFD97A]" />
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
              AGGRESSION WAVEFORM (LAST 3 MIN · 1S BARS)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-neutral-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-teal-400 inline-block" /> BUY UP
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-rose-400 inline-block" /> SELL DOWN
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-0.5 bg-white inline-block" /> PRICE
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-teal-300 border border-[#FFD97A] inline-block" />{' '}
              &gt;=$50K PRINT
            </span>
            <span className="text-[#FFD97A]">
              6s ATR: {atr6s > 0 ? `$${atr6s.toFixed(2)}` : '--'}
            </span>
          </div>
        </div>

        <div className="w-full h-[310px] mt-2 relative">
          <canvas
            ref={canvasRef}
            className="w-full h-full block"
            style={{ width: '100%', height: '310px' }}
          />
        </div>
      </div>
    );
  });

AggressionWaveformCanvas.displayName = 'AggressionWaveformCanvas';
