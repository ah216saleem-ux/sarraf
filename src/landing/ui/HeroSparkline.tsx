import React, { useEffect, useState } from 'react';

interface CandleItem {
  openTime: string;
  close: number;
}

export const HeroSparkline: React.FC = () => {
  const [points, setPoints] = useState<number[]>([]);
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const fetchCandles = async () => {
      try {
        const res = await fetch('/api/candles');
        if (!res.ok) return;
        const data = await res.json();
        const m15 = data?.store?.M15;
        if (Array.isArray(m15) && m15.length >= 4) {
          // Last 24 hours of M15 candles is up to 96 candles
          const recent = m15.slice(-48);
          const closes = recent.map((c: CandleItem) => c.close).filter((v) => typeof v === 'number');
          if (isMounted && closes.length >= 4) {
            setPoints(closes);
            setIsAvailable(true);
          }
        }
      } catch {
        // Hide if unavailable
      }
    };

    fetchCandles();
    const interval = setInterval(fetchCandles, 30000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  if (!isAvailable || points.length < 4) {
    return null; // Prompt rule: "Hide any value that is unavailable instead of faking it."
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const width = 160;
  const height = 40;

  const coords = points.map((val, idx) => {
    const x = (idx / (points.length - 1)) * width;
    const y = height - ((val - min) / range) * (height - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = `M ${coords.join(' L ')}`;
  const areaD = `${pathD} L ${width},${height} L 0,${height} Z`;
  const isUp = points[points.length - 1] >= points[0];

  return (
    <div className="flex flex-col items-end">
      <div className="text-[9px] font-mono uppercase tracking-wider text-neutral-400 mb-1">
        24H M15 SPARKLINE
      </div>
      <div className="w-[160px] h-[40px] relative overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id="sparklineGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isUp ? '#E8B84A' : '#f43f5e'} stopOpacity="0.3" />
              <stop offset="100%" stopColor={isUp ? '#E8B84A' : '#f43f5e'} stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <path d={areaD} fill="url(#sparklineGrad)" />
          <path
            d={pathD}
            fill="none"
            stroke={isUp ? '#FFD97A' : '#fb7185'}
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
};
