import React, { useEffect, useState, useRef, useMemo } from 'react';

interface PriceMarketPanelProps {
  currentPrice: number;
  previousPrice: number;
  bid: number;
  ask: number;
  spread: number;
  high24h: number;
  low24h: number;
  change24h: number;
  changePercent24h: number;
  tickDirection: 'BUY' | 'SELL' | 'FLAT';
  sparkline: number[];
  isDimmed: boolean;
  freshness: string;
}

export const PriceMarketPanel: React.FC<PriceMarketPanelProps> = ({
  currentPrice,
  previousPrice: _previousPrice,
  bid,
  ask,
  spread,
  high24h,
  low24h,
  change24h,
  changePercent24h,
  sparkline,
  isDimmed,
  freshness,
}) => {
  const [flash, setFlash] = useState<'green' | 'red' | null>(null);
  const prevPriceRef = useRef(currentPrice);

  useEffect(() => {
    if (currentPrice > prevPriceRef.current && prevPriceRef.current > 0) {
      setFlash('green');
      const timer = setTimeout(() => setFlash(null), 150); // 150ms flash
      prevPriceRef.current = currentPrice;
      return () => clearTimeout(timer);
    } else if (currentPrice < prevPriceRef.current && prevPriceRef.current > 0) {
      setFlash('red');
      const timer = setTimeout(() => setFlash(null), 150); // 150ms flash
      prevPriceRef.current = currentPrice;
      return () => clearTimeout(timer);
    }
    prevPriceRef.current = currentPrice;
  }, [currentPrice]);

  // Mini Sparkline SVG
  const sparkPoints = useMemo(() => {
    if (!sparkline || sparkline.length < 2) return '';
    const min = Math.min(...sparkline);
    const max = Math.max(...sparkline);
    const range = max - min || 1;
    const width = 80;
    const height = 24;

    return sparkline
      .map((val, idx) => {
        const x = (idx / (sparkline.length - 1)) * width;
        const y = height - ((val - min) / range) * (height - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [sparkline]);

  const isPositive = change24h >= 0;

  return (
    <div
      className={`relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 transition-opacity duration-300 overflow-hidden ${
        isDimmed ? 'opacity-40' : 'opacity-100'
      }`}
    >
      {/* Subtle top glow line */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent" />

      {/* Header */}
      <div className="flex items-center justify-between font-mono mb-2">
        <span className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-[0.12em]">
          1. PRICE & MARKET DATA
        </span>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8a96a8]">
          <span className="px-1 py-0.2 rounded bg-white/5 uppercase">BIQUOTE TICK</span>
          <span>·</span>
          <span>{freshness}</span>
        </div>
      </div>

      {currentPrice <= 0 ? (
        <div className="h-[60px] flex items-center justify-center font-mono text-[11px] text-[#8a96a8]">
          collecting data...
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
          {/* Left: Big Live Price + Delta & Sparkline */}
          <div className="sm:col-span-6 flex flex-col items-start font-mono">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs text-[#E8B84A] font-bold">$</span>
              <span
                className={`text-2xl sm:text-3xl font-black tabular-nums transition-colors duration-150 ${
                  flash === 'green'
                    ? 'text-[#22e08a]'
                    : flash === 'red'
                    ? 'text-[#ff3b6b]'
                    : 'text-[#e8edf5]'
                }`}
              >
                {currentPrice.toFixed(2)}
              </span>
              <span className="text-[10px] text-[#8a96a8]">USD</span>
            </div>

            <div className="flex items-center gap-2.5 mt-1">
              <span
                className={`text-[11px] font-bold tabular-nums ${
                  isPositive ? 'text-[#22e08a]' : 'text-[#ff3b6b]'
                }`}
              >
                {isPositive ? '+' : ''}
                {change24h.toFixed(2)} ({isPositive ? '+' : ''}
                {changePercent24h.toFixed(2)}%)
              </span>

              {sparkPoints && (
                <svg width="80" height="24" className="overflow-visible">
                  <polyline
                    fill="none"
                    stroke={isPositive ? '#22e08a' : '#ff3b6b'}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={sparkPoints}
                  />
                </svg>
              )}
            </div>
          </div>

          {/* Right: Data Rows (22px row height, label left, value right, no row boxes) */}
          <div className="sm:col-span-6 grid grid-cols-2 gap-x-4 font-mono text-[11px]">
            <div className="flex items-center justify-between h-[22px]">
              <span className="text-[#8a96a8]">Bid</span>
              <span className="text-[#e8edf5] tabular-nums">${bid.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between h-[22px]">
              <span className="text-[#8a96a8]">Ask</span>
              <span className="text-[#e8edf5] tabular-nums">${ask.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between h-[22px]">
              <span className="text-[#8a96a8]">Spread</span>
              <span className="text-[#38bdf8] tabular-nums font-bold">${spread.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between h-[22px]">
              <span className="text-[#8a96a8]">High</span>
              <span className="text-[#22e08a] tabular-nums">${high24h.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between h-[22px]">
              <span className="text-[#8a96a8]">Low</span>
              <span className="text-[#ff3b6b] tabular-nums">${low24h.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between h-[22px]">
              <span className="text-[#8a96a8]">Prev Close</span>
              <span className="text-[#e8edf5] tabular-nums">
                {high24h > 0 ? (currentPrice - change24h).toFixed(2) : '—'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
