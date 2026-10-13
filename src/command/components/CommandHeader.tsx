import React, { useState, useEffect, useRef } from 'react';
import { Timeframe, FeedConnectionState, UpcomingTierNewsEvent } from '../data/commandTypes';
import { Coins, AlertTriangle, Bell, Eye } from 'lucide-react';

interface CommandHeaderProps {
  connection: FeedConnectionState;
  selectedTimeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  nextTierNews?: UpcomingTierNewsEvent | null;
  currentPrice?: number;
}

export const CommandHeader: React.FC<CommandHeaderProps> = React.memo(({
  connection,
  selectedTimeframe,
  onTimeframeChange,
  nextTierNews,
  currentPrice,
}) => {
  const [clock, setClock] = useState('');
  const [isWakeLock, setIsWakeLock] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sarraf_keep_awake') === 'true';
    }
    return false;
  });
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const h = String(now.getUTCHours()).padStart(2, '0');
      const m = String(now.getUTCMinutes()).padStart(2, '0');
      const s = String(now.getUTCSeconds()).padStart(2, '0');
      setClock(`${h}:${m}:${s} UTC`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Screen Wake Lock Handler
  useEffect(() => {
    if (!isWakeLock || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release(); } catch {}
        wakeLockRef.current = null;
      }
      return;
    }

    const acquireLock = async () => {
      try {
        if (document.visibilityState === 'visible' && !wakeLockRef.current) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
          wakeLockRef.current.addEventListener('release', () => {
            wakeLockRef.current = null;
          });
        }
      } catch {}
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        acquireLock();
      } else if (wakeLockRef.current) {
        try { wakeLockRef.current.release(); } catch {}
        wakeLockRef.current = null;
      }
    };

    acquireLock();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release(); } catch {}
        wakeLockRef.current = null;
      }
    };
  }, [isWakeLock]);

  const toggleWakeLock = () => {
    setIsWakeLock((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('sarraf_keep_awake', String(next));
      }
      return next;
    });
  };

  const timeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
  const isDrop = connection.status === 'RECONNECTING' || connection.status === 'OFFLINE';

  const showNewsChip =
    nextTierNews &&
    typeof nextTierNews.minutesUntil === 'number' &&
    nextTierNews.minutesUntil >= 0 &&
    nextTierNews.minutesUntil <= 60;

  return (
    <header className="relative w-full rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 select-none overflow-hidden">
      {/* Subtle top glow line */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent" />

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Left: Brand + Status + Clock */}
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[#E8B84A]" />
          <h1 className="font-mono text-[11px] font-bold tracking-[0.12em] text-[#38bdf8] uppercase">
            SARRAF COMMAND
          </h1>

          {/* Honest connection badge */}
          {isDrop ? (
            <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold text-[#ff3b6b] bg-[#ff3b6b]/10 border border-[#ff3b6b]/30 px-1.5 py-0.5 rounded animate-pulse">
              <AlertTriangle className="w-2.5 h-2.5" />
              {connection.badgeText || 'RECONNECTING'}
            </span>
          ) : connection.status === 'MARKET_CLOSED' ? (
            <span className="inline-flex items-center gap-1 text-[9px] font-mono text-[#f5a524] bg-[#f5a524]/10 border border-[#f5a524]/30 px-1.5 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-[#f5a524]" />
              {connection.badgeText || 'CLOSED'}
            </span>
          ) : connection.status === 'STALE' ? (
            <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/40 px-1.5 py-0.5 rounded animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              {connection.badgeText || `STALE ${connection.lastTickAgeSeconds || 12}s`}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold text-[#22e08a] bg-[#22e08a]/10 border border-[#22e08a]/30 px-1.5 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22e08a] animate-ping" />
              LIVE
            </span>
          )}

          <span className="font-mono text-[9px] text-[#8a96a8] tabular-nums hidden xs:inline">
            {clock}
          </span>
        </div>

        {/* Right: News In Xm + XAUUSD Gold Chip with live price */}
        <div className="flex items-center gap-2">
          {showNewsChip && (
            <div
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/40 text-[9px] font-mono font-bold text-amber-300 animate-pulse"
              title={`${nextTierNews.title} due in ${nextTierNews.minutesUntil}m`}
            >
              <Bell className="w-2.5 h-2.5 text-amber-400" />
              <span>NEWS IN {nextTierNews.minutesUntil === 0 ? 'NOW' : `${nextTierNews.minutesUntil}m`}</span>
            </div>
          )}

          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#04060b] border border-[#38bdf8]/20 text-[10px] font-mono text-[#e8edf5]">
            <Coins className="w-3 h-3 text-[#E8B84A]" />
            <span className="font-bold tracking-wider text-[#E8B84A]">XAU/USD</span>
            {currentPrice && currentPrice > 0 ? (
              <span className="font-bold text-[#FFD97A] tabular-nums pl-0.5">${currentPrice.toFixed(2)}</span>
            ) : null}
            <span className="text-[8px] text-[#8a96a8] border-l border-[#38bdf8]/20 pl-1">SPOT</span>
          </div>
        </div>
      </div>

      {/* Timeframe switch row + screen awake */}
      <div className="flex items-center justify-between gap-1 mt-2 pt-2 border-t border-[#38bdf8]/10 overflow-x-auto">
        <div className="flex items-center gap-1">
          {timeframes.map((tf) => {
            const isActive = selectedTimeframe === tf;
            return (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#38bdf8] text-[#04060b] font-bold shadow-[0_0_8px_rgba(56,189,248,0.4)]'
                    : 'text-[#8a96a8] hover:text-[#e8edf5] hover:bg-white/5'
                }`}
              >
                {tf}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={toggleWakeLock}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono transition-all cursor-pointer border ${
              isWakeLock
                ? 'bg-[#38bdf8]/15 border-[#38bdf8]/40 text-[#38bdf8]'
                : 'bg-transparent border-white/10 text-[#8a96a8] hover:text-[#e8edf5]'
            }`}
            title="Keep screen awake while Command tab is open"
          >
            <Eye className="w-2.5 h-2.5" />
            <span>Awake {isWakeLock ? 'ON' : 'OFF'}</span>
          </button>

          <span className="text-[9px] font-mono text-[#8a96a8] tabular-nums hidden sm:inline">
            BIQUOTE XAUUSD · 10Hz RAF
          </span>
        </div>
      </div>
    </header>
  );
});
