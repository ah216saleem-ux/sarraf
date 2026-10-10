import React, { useRef, useEffect } from 'react';
import { SpyCandle } from '../types';

interface SpyCandleMiniChartProps {
  candles: SpyCandle[];
  currentPrice: number | null;
  timeframe: '1m' | '5m' | '15m' | '1h';
  onTimeframeChange: (tf: '1m' | '5m' | '15m' | '1h') => void;
  entryPrice?: number | null;
  slPrice?: number | null;
  tpPrice?: number | null;
}

export const SpyCandleMiniChart: React.FC<SpyCandleMiniChartProps> = ({
  candles,
  currentPrice,
  timeframe,
  onTimeframeChange,
  entryPrice,
  slPrice,
  tpPrice,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * (window.devicePixelRatio || 1);
    canvas.height = height * (window.devicePixelRatio || 1);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    ctx.clearRect(0, 0, width, height);

    if (!candles || candles.length < 2) {
      ctx.fillStyle = '#64748b';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Awaiting SPY candle backfill...', width / 2, height / 2);
      return;
    }

    const displayCandles = candles.slice(-48);
    const count = displayCandles.length;

    let minPrice = Math.min(...displayCandles.map((c) => c.low));
    let maxPrice = Math.max(...displayCandles.map((c) => c.high));

    if (entryPrice) {
      minPrice = Math.min(minPrice, entryPrice);
      maxPrice = Math.max(maxPrice, entryPrice);
    }
    if (slPrice) {
      minPrice = Math.min(minPrice, slPrice);
      maxPrice = Math.max(maxPrice, slPrice);
    }
    if (tpPrice) {
      minPrice = Math.min(minPrice, tpPrice);
      maxPrice = Math.max(maxPrice, tpPrice);
    }

    const padding = (maxPrice - minPrice) * 0.1 || 1.0;
    minPrice -= padding;
    maxPrice += padding;
    const priceRange = maxPrice - minPrice;

    const candleWidth = Math.max(3, (width - 60) / count - 2);
    const chartHeight = height - 30;

    const getY = (p: number) => {
      return chartHeight - ((p - minPrice) / priceRange) * chartHeight;
    };

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const y = (chartHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width - 55, y);
      ctx.stroke();

      const priceVal = maxPrice - (priceRange / 5) * i;
      ctx.fillStyle = '#64748b';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`$${priceVal.toFixed(2)}`, width - 5, y + 3);
    }

    // Draw Candlesticks
    displayCandles.forEach((c, i) => {
      const x = i * (candleWidth + 2) + 10;
      const isUp = c.close >= c.open;
      const color = isUp ? '#22e08a' : '#ff3b6b';

      const openY = getY(c.open);
      const closeY = getY(c.close);
      const highY = getY(c.high);
      const lowY = getY(c.low);

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + candleWidth / 2, highY);
      ctx.lineTo(x + candleWidth / 2, lowY);
      ctx.stroke();

      // Body
      ctx.fillStyle = color;
      const bodyY = Math.min(openY, closeY);
      const bodyH = Math.max(1.5, Math.abs(closeY - openY));
      ctx.fillRect(x, bodyY, candleWidth, bodyH);
    });

    // Draw active signal levels if present
    if (entryPrice) {
      const y = getY(entryPrice);
      ctx.strokeStyle = '#e8b84a';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width - 55, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#e8b84a';
      ctx.fillText(`ENTRY $${entryPrice.toFixed(2)}`, width - 5, y + 3);
    }

    if (slPrice) {
      const y = getY(slPrice);
      ctx.strokeStyle = '#ff3b6b';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width - 55, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff3b6b';
      ctx.fillText(`SL $${slPrice.toFixed(2)}`, width - 5, y + 3);
    }

    if (tpPrice) {
      const y = getY(tpPrice);
      ctx.strokeStyle = '#22e08a';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width - 55, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#22e08a';
      ctx.fillText(`TP $${tpPrice.toFixed(2)}`, width - 5, y + 3);
    }

    // Current Price Line
    if (currentPrice) {
      const y = getY(currentPrice);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width - 55, y);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(`$${currentPrice.toFixed(2)}`, width - 5, y + 3);
    }
  }, [candles, currentPrice, entryPrice, slPrice, tpPrice]);

  return (
    <div className="glass-panel p-4 rounded-2xl border border-white/10 bg-black/50">
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-white tracking-wider">
            SPY TAPE & MULTI-TIMEFRAME CANDLES
          </span>
          <span className="text-[10px] font-mono text-neutral-500">IEX AGGREGATED</span>
        </div>

        {/* Timeframe Chips */}
        <div className="flex items-center gap-1 font-mono text-xs">
          {(['1m', '5m', '15m', '1h'] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => onTimeframeChange(tf)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold border transition-colors cursor-pointer ${
                timeframe === tf
                  ? 'bg-[#E8B84A] text-black border-[#E8B84A]'
                  : 'bg-white/5 text-neutral-400 border-white/10 hover:text-white'
              }`}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="relative w-full h-52 mt-3">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    </div>
  );
};
