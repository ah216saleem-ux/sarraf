import React, { useEffect, useState, useRef } from 'react';

interface HeroOdometerProps {
  price: number;
  isLive: boolean;
  direction?: 'up' | 'down' | 'flat';
  status: 'LIVE' | 'MARKET_CLOSED' | 'FEED_STALE' | 'FEED_OFFLINE';
}

export const HeroOdometer: React.FC<HeroOdometerProps> = ({
  price,
  isLive,
  status,
}) => {
  const [displayedPrice, setDisplayedPrice] = useState(price);
  const [glowColor, setGlowColor] = useState<'emerald' | 'rose' | null>(null);
  const lastUpdateRef = useRef(0);
  const prevPriceRef = useRef(price);

  useEffect(() => {
    const now = performance.now();
    // Throttle UI price updates to once per second (1000ms) to eliminate per-tick React re-renders
    if (now - lastUpdateRef.current < 1000 && lastUpdateRef.current !== 0) {
      return;
    }
    lastUpdateRef.current = now;

    if (isLive && status === 'LIVE' && prevPriceRef.current !== price) {
      if (price > prevPriceRef.current) {
        setGlowColor('emerald');
      } else if (price < prevPriceRef.current) {
        setGlowColor('rose');
      }
      setDisplayedPrice(price);
      prevPriceRef.current = price;

      const timer = setTimeout(() => {
        setGlowColor(null);
      }, 700);
      return () => clearTimeout(timer);
    } else {
      setDisplayedPrice(price);
      prevPriceRef.current = price;
    }
  }, [price, isLive, status]);

  const formattedPrice = (displayedPrice || 4165.5).toFixed(2);
  const chars = formattedPrice.split('');

  const glowClass =
    glowColor === 'emerald'
      ? 'text-emerald-300 drop-shadow-[0_0_16px_rgba(52,211,153,0.9)]'
      : glowColor === 'rose'
      ? 'text-rose-300 drop-shadow-[0_0_16px_rgba(244,63,94,0.9)]'
      : status === 'MARKET_CLOSED'
      ? 'text-amber-200 drop-shadow-[0_0_12px_rgba(245,158,11,0.4)]'
      : 'text-white drop-shadow-[0_0_12px_rgba(255,217,122,0.4)]';

  return (
    <div className={`flex items-baseline font-mono font-bold tracking-tight transition-colors duration-300 ${glowClass}`}>
      <span className="text-xl sm:text-2xl md:text-3xl text-[#E8B84A] mr-1">$</span>
      <div className="flex items-center text-3xl sm:text-4xl md:text-5xl lg:text-6xl overflow-hidden py-1 leading-none">
        {chars.map((char, index) => {
          if (char === '.') {
            return (
              <span key={`dot-${index}`} className="text-2xl sm:text-3xl md:text-4xl text-[#E8B84A] px-0.5">
                .
              </span>
            );
          }

          const digit = parseInt(char, 10);
          if (isNaN(digit)) {
            return <span key={index}>{char}</span>;
          }

          // If not live or market closed, render static digit
          if (!isLive || status === 'MARKET_CLOSED') {
            return (
              <span key={index} className="inline-block w-[0.62em] text-center">
                {char}
              </span>
            );
          }

          // Live odometer roll column with GPU transform and consistent cubic-bezier easing
          return (
            <div
              key={index}
              className="relative inline-block w-[0.62em] h-[1.12em] overflow-hidden leading-none text-center"
            >
              <div
                className="transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] flex flex-col items-center will-change-transform"
                style={{
                  transform: `translate3d(0, -${digit * 10}%, 0)`,
                }}
              >
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <span
                    key={n}
                    className="h-[1.12em] flex items-center justify-center select-none"
                  >
                    {n}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <span className="text-xs sm:text-sm font-mono text-neutral-400 ml-2">USD</span>
    </div>
  );
};
