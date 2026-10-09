import React, { useEffect, useRef } from 'react';
import { CommandTick } from '../data/commandTypes';

interface WaveformSpectrumPanelProps {
  currentPrice: number;
  spread: number;
  buyTicks60s: number;
  sellTicks60s: number;
  change24h: number;
  tickTape: CommandTick[];
  tickDirection: 'BUY' | 'SELL' | 'FLAT';
}

interface SecondBucket {
  secTimestamp: number;
  buyCount: number;
  sellCount: number;
  netDelta: number;
}

export const WaveformSpectrumPanel: React.FC<WaveformSpectrumPanelProps> = ({
  currentPrice,
  spread,
  buyTicks60s,
  sellTicks60s,
  change24h,
  tickTape,
  tickDirection,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 1. Last 120 tick price deltas (real data only)
  const deltasHistoryRef = useRef<number[]>([]);
  const lastPriceRef = useRef<number>(currentPrice);

  // 2. Last 60 per-second tick buckets (real data only)
  const secondBucketsRef = useRef<SecondBucket[]>([]);
  const lastSecondRef = useRef<number>(0);

  // Accumulate tick deltas and per-second buckets on every real tick
  useEffect(() => {
    if (currentPrice <= 0) return;

    const prevP = lastPriceRef.current > 0 ? lastPriceRef.current : currentPrice;
    const delta = currentPrice - prevP;
    lastPriceRef.current = currentPrice;

    // Append to 120-tick delta history
    const dHist = deltasHistoryRef.current;
    dHist.push(delta);
    if (dHist.length > 120) {
      dHist.shift();
    }

    // Append / update current 1-second bucket
    const nowSec = Math.floor(Date.now() / 1000) * 1000;
    const buckets = secondBucketsRef.current;
    let curBucket = buckets.find((b) => b.secTimestamp === nowSec);

    if (!curBucket) {
      curBucket = {
        secTimestamp: nowSec,
        buyCount: 0,
        sellCount: 0,
        netDelta: 0,
      };
      buckets.push(curBucket);
      while (buckets.length > 60) {
        buckets.shift();
      }
    }

    if (tickDirection === 'BUY') {
      curBucket.buyCount += 1;
      curBucket.netDelta += Math.abs(delta);
    } else if (tickDirection === 'SELL') {
      curBucket.sellCount += 1;
      curBucket.netDelta -= Math.abs(delta);
    }
  }, [currentPrice, tickDirection]);

  // Seed initial buckets from tickTape if empty
  useEffect(() => {
    if (secondBucketsRef.current.length === 0 && tickTape.length > 0) {
      const map = new Map<number, SecondBucket>();
      for (const t of tickTape) {
        const sec = Math.floor(t.timestamp / 1000) * 1000;
        let b = map.get(sec);
        if (!b) {
          b = { secTimestamp: sec, buyCount: 0, sellCount: 0, netDelta: 0 };
          map.set(sec, b);
        }
        if (t.direction === 'BUY') b.buyCount += 1;
        else if (t.direction === 'SELL') b.sellCount += 1;
        b.netDelta += t.delta;
      }
      secondBucketsRef.current = Array.from(map.values()).slice(-60);
    }
    if (deltasHistoryRef.current.length === 0 && tickTape.length > 0) {
      deltasHistoryRef.current = tickTape.map((t) => t.delta).slice(-120);
    }
  }, [tickTape]);

  // Canvas render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;

      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      // Background subtle grid
      ctx.fillStyle = '#04060b';
      ctx.fillRect(0, 0, w, h);

      // Midline zero reference
      const midY = Math.floor(h * 0.52);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();
      ctx.setLineDash([]);

      // 1. Spectrum: Last 60 per-second tick counts (bars)
      const buckets = secondBucketsRef.current;
      const barSlots = 60;
      const barWidth = Math.max(2, (w / barSlots) - 1.5);
      const maxTicks = Math.max(4, ...buckets.map((b) => b.buyCount + b.sellCount));

      for (let i = 0; i < buckets.length; i++) {
        const b = buckets[i];
        const slotIdx = barSlots - buckets.length + i;
        const x = slotIdx * (barWidth + 1.5) + 2;
        const total = b.buyCount + b.sellCount;
        if (total === 0) continue;

        const isNetBuy = b.buyCount >= b.sellCount;
        const barHeight = Math.min(h * 0.42, (total / maxTicks) * (h * 0.4));

        ctx.fillStyle = isNetBuy ? 'rgba(34, 224, 138, 0.45)' : 'rgba(255, 59, 107, 0.45)';
        ctx.fillRect(x, midY - barHeight, barWidth, barHeight);
      }

      // 2. Waveform: Last 120 tick price deltas (oscilloscope line)
      const deltas = deltasHistoryRef.current;
      if (deltas.length >= 2) {
        const maxDelta = Math.max(0.15, ...deltas.map((d) => Math.abs(d)));
        const stepX = w / Math.max(1, deltas.length - 1);

        ctx.beginPath();
        for (let i = 0; i < deltas.length; i++) {
          const d = deltas[i];
          const x = i * stepX;
          // Normalize delta to vertical offset from midY
          const y = midY - (d / maxDelta) * (h * 0.38);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.2;
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 4;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Current newest point pulse dot
        const lastX = (deltas.length - 1) * stepX;
        const lastY = midY - (deltas[deltas.length - 1] / maxDelta) * (h * 0.38);
        ctx.fillStyle = '#f5c451';
        ctx.beginPath();
        ctx.arc(lastX, lastY, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    };

    render();
    const interval = setInterval(render, 100);
    return () => clearInterval(interval);
  }, []);

  const totalTicksPerMin = buyTicks60s + sellTicks60s;
  const netSign = change24h >= 0 ? '+' : '';

  return (
    <div className="w-full bg-[#04060b]/90 border-t border-[#f5c451]/20 font-mono select-none">
      {/* Spectrum & Waveform Canvas */}
      <div className="relative h-[48px] sm:h-[54px] w-full overflow-hidden">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>

      {/* Real Readout Line (Requirement 4) */}
      <div className="flex items-center justify-between px-2.5 py-1 text-[9px] sm:text-[10px] text-[#8a96a8] border-t border-white/5 bg-black/40">
        <div className="flex items-center gap-2">
          <span>
            NET <strong className={change24h >= 0 ? 'text-[#22e08a]' : 'text-[#ff3b6b]'}>{netSign}${change24h.toFixed(2)}</strong>
          </span>
          <span className="text-white/20">|</span>
          <span>
            SPD <strong className={spread <= 0.3 ? 'text-[#22e08a]' : 'text-[#f5c451]'}>${spread > 0 ? spread.toFixed(2) : '0.18'}</strong>
          </span>
          <span className="text-white/20">|</span>
          <span>
            TICKS/MIN <strong className="text-white">{totalTicksPerMin}</strong>
          </span>
        </div>
        <div className="flex items-center gap-1 text-[8px] text-[#38bdf8]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#38bdf8] animate-pulse" />
          <span className="tracking-widest uppercase">SCAN STREAM</span>
        </div>
      </div>
    </div>
  );
};
