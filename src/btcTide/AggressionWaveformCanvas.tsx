import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { BtcFeedStatus, SecondBin } from './types';
import {
  buildContinuousSecondSeries,
  detectWaveformEvents,
  computePercentile,
} from './useBtcTideStore';
import { Waves } from 'lucide-react';

interface AggressionWaveformCanvasProps {
  secondBins: SecondBin[];
  status: BtcFeedStatus;
  isSpotStale?: boolean;
  spotAgeMs?: number;
}

function formatSecLabel(sec: number): string {
  const d = new Date(sec * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatBtcAxis(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 10) return `${val >= 0 ? '+' : '-'}${abs.toFixed(1)} BTC`;
  if (abs >= 1) return `${val >= 0 ? '+' : '-'}${abs.toFixed(2)} BTC`;
  return `${val >= 0 ? '+' : '-'}${abs.toFixed(3)} BTC`;
}

export const AggressionWaveformCanvas: React.FC<AggressionWaveformCanvasProps> =
  React.memo(({ secondBins, status, isSpotStale = false, spotAgeMs = 0 }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

    const isStaleOrOffline = isSpotStale || status === 'STALE' || status === 'OFFLINE';
    const ageLabel =
      spotAgeMs > 0 && spotAgeMs < 999999 ? `${(spotAgeMs / 1000).toFixed(1)}s` : '--';

    // Build continuous 3-minute (180 seconds) series from real store bins
    const series = useMemo(
      () => buildContinuousSecondSeries(secondBins, 180),
      [secondBins]
    );

    const { events, atr6s } = useMemo(
      () => detectWaveformEvents(series),
      [series]
    );

    const hasEnoughData = series.length >= 6;

    const handlePointer = useCallback(
      (clientX: number) => {
        const canvas = canvasRef.current;
        if (!canvas || series.length === 0) return;
        const rect = canvas.getBoundingClientRect();
        const padLeft = 12;
        const padRight = 76;
        const plotW = Math.max(100, rect.width - padLeft - padRight);
        const relX = clientX - rect.left - padLeft;
        const n = series.length;
        const slotCount = Math.max(n, 30);
        const stepX = plotW / slotCount;
        const rawSlot = Math.floor(relX / stepX);
        const idx = rawSlot - (slotCount - n);
        if (idx >= 0 && idx < n) {
          setSelectedIdx(idx);
        } else {
          setSelectedIdx(null);
        }
      },
      [series.length]
    );

    useEffect(() => {
      if (typeof document !== 'undefined' && document.hidden) return;

      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const draw = () => {
        if (typeof document !== 'undefined' && document.hidden) return;
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(300, Math.floor(rect.width));
        const height = 300;

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
        const plotW = Math.max(100, width - padLeft - padRight);

        // Two-Lane Geometry:
        // Top Lane: Price Line (y = 28 .. 130)
        // Bottom Lane: Net Delta Bars in BTC (y = 146 .. 272)
        const priceTop = 28;
        const priceBot = 130;
        const priceH = priceBot - priceTop;

        const dividerY = 138;

        const deltaTop = 146;
        const deltaBot = 272;
        const deltaH = deltaBot - deltaTop;
        const deltaMidY = deltaTop + deltaH * 0.5;
        const deltaHalfH = deltaH * 0.45;

        // Lane Divider
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, dividerY);
        ctx.lineTo(width - 8, dividerY);
        ctx.stroke();

        // Subtle Lane Labels (Top-Left of each lane)
        ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.textAlign = 'left';
        ctx.fillText('PRICE LANE (5% PAD)', padLeft + 2, priceTop + 10);
        ctx.fillText('NET DELTA (BTC · P95 SCALE)', padLeft + 2, deltaTop + 10);

        // Zero Line in Bottom Lane
        ctx.strokeStyle = 'rgba(232, 184, 74, 0.28)';
        ctx.beginPath();
        ctx.moveTo(padLeft, deltaMidY);
        ctx.lineTo(padLeft + plotW, deltaMidY);
        ctx.stroke();

        if (!hasEnoughData) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(
            `collecting live data... (${series.length}s / 6s min)`,
            width / 2,
            dividerY
          );
          ctx.restore();
          return;
        }

        const n = series.length;
        const slotCount = Math.max(n, 30);
        const stepX = plotW / slotCount;
        const barW = Math.max(2, Math.min(7, stepX * 0.74));

        const getX = (idx: number) =>
          padLeft + (idx + (slotCount - n)) * stepX + stepX * 0.5;

        // --- TOP LANE: Price Min/Max with 5% Padding ---
        let rawMinP = series[0].lastPrice;
        let rawMaxP = series[0].lastPrice;
        const absNets: number[] = [];

        for (let i = 0; i < n; i++) {
          const b = series[i];
          if (b.lastPrice < rawMinP) rawMinP = b.lastPrice;
          if (b.lastPrice > rawMaxP) rawMaxP = b.lastPrice;
          const net = b.buyVol - b.sellVol;
          if (Math.abs(net) > 0) absNets.push(Math.abs(net));
        }

        const rawPriceSpan = Math.max(1.0, rawMaxP - rawMinP);
        const pad5Pct = rawPriceSpan * 0.05;
        const minPrice = rawMinP - pad5Pct;
        const maxPrice = rawMaxP + pad5Pct;
        const priceSpan = maxPrice - minPrice;

        const getPriceY = (p: number) =>
          priceBot - ((p - minPrice) / priceSpan) * priceH;

        // Price subtle fill & line
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = getX(i);
          const py = getPriceY(series[i].lastPrice);
          if (i === 0) ctx.moveTo(x, py);
          else ctx.lineTo(x, py);
        }
        ctx.strokeStyle = isStaleOrOffline ? 'rgba(160, 160, 160, 0.5)' : '#FFD97A';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Top Lane Right Y-Axis Labels
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.fillText(`$${rawMaxP.toFixed(0)}`, padLeft + plotW + 6, priceTop + 9);
        ctx.fillText(`$${rawMinP.toFixed(0)}`, padLeft + plotW + 6, priceBot - 2);

        const lastP = series[n - 1].lastPrice;
        const lastPY = Math.max(priceTop + 20, Math.min(priceBot - 14, getPriceY(lastP)));
        ctx.fillStyle = isStaleOrOffline ? '#9ca3af' : '#FFD97A';
        ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(`$${lastP.toFixed(0)}`, padLeft + plotW + 6, lastPY + 3);

        // --- ABSORB / DRIVE Labels (Max 3, >=10s apart, NO dotted vertical lines) ---
        if (events.length > 0) {
          const secToIndex = new Map<number, number>();
          for (let i = 0; i < n; i++) {
            secToIndex.set(series[i].sec, i);
          }

          ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, monospace';
          let lastRightEdge = -999;

          for (const ev of events.slice(0, 3)) {
            const idx = secToIndex.get(ev.sec);
            if (idx === undefined) continue;
            const rawX = getX(idx);
            const arrow = ev.side === 'BUY' ? '↑' : '↓';
            const labelText = `${ev.type} ${arrow}`;
            const textW = ctx.measureText(labelText).width;
            const boxW = textW + 10;
            const boxH = 15;

            let clampedX = Math.max(
              padLeft + boxW / 2,
              Math.min(padLeft + plotW - boxW / 2, rawX)
            );
            if (clampedX - boxW / 2 < lastRightEdge + 6) {
              clampedX = Math.min(padLeft + plotW - boxW / 2, lastRightEdge + 6 + boxW / 2);
            }
            const x1 = clampedX - boxW / 2;
            lastRightEdge = clampedX + boxW / 2;
            const boxY = 6;

            ctx.save();
            ctx.fillStyle = 'rgba(10, 11, 14, 0.94)';
            ctx.fillRect(x1, boxY, boxW, boxH);

            ctx.strokeStyle =
              ev.type === 'DRIVE'
                ? ev.side === 'BUY'
                  ? '#14b8a6'
                  : '#f43f5e'
                : '#E8B84A';
            ctx.lineWidth = 1;
            ctx.strokeRect(x1, boxY, boxW, boxH);

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

        // --- BOTTOM LANE: Net Delta Bars Scaled to 95th Percentile of |net| ---
        const p95Net = Math.max(0.01, computePercentile(absNets, 0.95));

        for (let i = 0; i < n; i++) {
          const b = series[i];
          const net = b.buyVol - b.sellVol;
          const x = getX(i);

          let barTipY = deltaMidY;
          if (Math.abs(net) > 0) {
            const norm = Math.min(1.15, Math.abs(net) / p95Net);
            const bh = Math.max(2, norm * deltaHalfH);

            if (net > 0) {
              barTipY = deltaMidY - bh;
              ctx.fillStyle = isStaleOrOffline
                ? 'rgba(115, 115, 115, 0.5)'
                : 'rgba(20, 184, 166, 0.9)';
              ctx.fillRect(x - barW / 2, barTipY, barW, bh);
            } else {
              barTipY = deltaMidY + bh;
              ctx.fillStyle = isStaleOrOffline
                ? 'rgba(95, 95, 95, 0.5)'
                : 'rgba(244, 63, 94, 0.9)';
              ctx.fillRect(x - barW / 2, deltaMidY, barW, bh);
            }
          }

          // Mark large prints (>= $50K) as dots on the bars
          if (b.largePrintMaxUsd >= 50000) {
            const isBuyPrint = b.largePrintSide === 'BUY';
            const dotY =
              Math.abs(net) > 0
                ? barTipY
                : isBuyPrint
                ? deltaMidY - 6
                : deltaMidY + 6;

            ctx.save();
            ctx.fillStyle = isStaleOrOffline
              ? '#a3a3a3'
              : isBuyPrint
              ? '#5eead4'
              : '#fda4af';
            ctx.beginPath();
            ctx.arc(x, dotY, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#FFD97A';
            ctx.lineWidth = 1.2;
            ctx.stroke();
            ctx.restore();
          }
        }

        // Selected / Tapped Bar Highlight Line
        if (selectedIdx !== null && selectedIdx >= 0 && selectedIdx < n) {
          const sx = getX(selectedIdx);
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 217, 122, 0.65)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx, priceTop);
          ctx.lineTo(sx, deltaBot);
          ctx.stroke();

          const spY = getPriceY(series[selectedIdx].lastPrice);
          ctx.fillStyle = '#FFD97A';
          ctx.beginPath();
          ctx.arc(sx, spY, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Bottom Lane Right Y-Axis Labels (Sensible BTC units, e.g. +0.50 BTC, 0 BTC, -0.50 BTC)
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(45, 212, 191, 0.85)';
        ctx.fillText(formatBtcAxis(p95Net), padLeft + plotW + 6, deltaTop + 10);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.fillText('0 BTC', padLeft + plotW + 6, deltaMidY + 3);
        ctx.fillStyle = 'rgba(251, 113, 133, 0.85)';
        ctx.fillText(formatBtcAxis(-p95Net), padLeft + plotW + 6, deltaBot - 4);

        // X-axis time labels
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
    }, [series, events, hasEnoughData, isStaleOrOffline, selectedIdx]);

    const selectedBin =
      selectedIdx !== null && selectedIdx >= 0 && selectedIdx < series.length
        ? series[selectedIdx]
        : null;

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
            {isStaleOrOffline && (
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300">
                STALE · {ageLabel}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-neutral-400">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-0.5 bg-[#FFD97A] inline-block" /> PRICE (TOP)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-teal-400 inline-block" /> +NET BTC
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-rose-400 inline-block" /> -NET BTC
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-teal-300 border border-[#FFD97A] inline-block" />{' '}
              &gt;=$50K PRINT
            </span>
            <span className={isStaleOrOffline ? 'text-neutral-500' : 'text-[#FFD97A]'}>
              6s ATR: {atr6s > 0 ? `$${atr6s.toFixed(2)}` : '--'}
            </span>
          </div>
        </div>

        {/* Tap / Hover Tooltip Bar */}
        <div className="mt-2 min-h-[26px] px-2.5 py-1 rounded-lg bg-black/50 border border-white/10 font-mono text-[11px] flex flex-wrap items-center justify-between gap-2">
          {selectedBin ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-neutral-400">
                  TIME: <strong className="text-white">{formatSecLabel(selectedBin.sec)} UTC</strong>
                </span>
                <span className="text-neutral-400">
                  PRICE: <strong className="text-[#FFD97A]">${selectedBin.lastPrice.toFixed(2)}</strong>
                </span>
                <span className="text-neutral-400">
                  BUY: <strong className="text-teal-400">{selectedBin.buyVol.toFixed(4)} BTC</strong>
                </span>
                <span className="text-neutral-400">
                  SELL: <strong className="text-rose-400">{selectedBin.sellVol.toFixed(4)} BTC</strong>
                </span>
                <span className="text-neutral-400">
                  NET:{' '}
                  <strong
                    className={
                      selectedBin.buyVol - selectedBin.sellVol >= 0
                        ? 'text-teal-300'
                        : 'text-rose-300'
                    }
                  >
                    {selectedBin.buyVol - selectedBin.sellVol >= 0 ? '+' : ''}
                    {(selectedBin.buyVol - selectedBin.sellVol).toFixed(4)} BTC
                  </strong>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedIdx(null)}
                className="text-[10px] text-neutral-400 hover:text-white cursor-pointer"
              >
                Clear
              </button>
            </>
          ) : (
            <span className="text-neutral-500 text-[10px]">
              Tap or hover any 1-second bar to inspect UTC time, price, buy BTC, and sell BTC
            </span>
          )}
        </div>

        <div className="w-full h-[300px] mt-2 relative">
          <canvas
            ref={canvasRef}
            onMouseMove={(e) => handlePointer(e.clientX)}
            onMouseLeave={() => setSelectedIdx(null)}
            onClick={(e) => handlePointer(e.clientX)}
            onTouchStart={(e) => {
              if (e.touches[0]) handlePointer(e.touches[0].clientX);
            }}
            onTouchMove={(e) => {
              if (e.touches[0]) handlePointer(e.touches[0].clientX);
            }}
            className="w-full h-full block cursor-crosshair"
            style={{ width: '100%', height: '300px' }}
          />
        </div>
      </div>
    );
  });

AggressionWaveformCanvas.displayName = 'AggressionWaveformCanvas';
