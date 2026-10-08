import React, { useState, useEffect } from 'react';
import { Timeframe, FeedConnectionState } from '../data/commandTypes';
import { Coins, AlertTriangle } from 'lucide-react';

interface CommandHeaderProps {
  connection: FeedConnectionState;
  selectedTimeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
}

export const CommandHeader: React.FC<CommandHeaderProps> = ({
  connection,
  selectedTimeframe,
  onTimeframeChange,
}) => {
  const [clock, setClock] = useState('');

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

  const timeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
  const isDrop = connection.status === 'RECONNECTING' || connection.status === 'OFFLINE';

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

          {/* Connection dot / badge */}
          {isDrop ? (
            <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold text-[#ff3b6b] bg-[#ff3b6b]/10 border border-[#ff3b6b]/30 px-1.5 py-0.5 rounded animate-pulse">
              <AlertTriangle className="w-2.5 h-2.5" />
              RECONNECTING
            </span>
          ) : connection.status === 'MARKET_CLOSED' ? (
            <span className="inline-flex items-center gap-1 text-[9px] font-mono text-[#f5a524] bg-[#f5a524]/10 border border-[#f5a524]/30 px-1.5 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-[#f5a524]" />
              CLOSED
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[9px] font-mono text-[#22e08a] bg-[#22e08a]/10 border border-[#22e08a]/30 px-1.5 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22e08a] animate-ping" />
              LIVE
            </span>
          )}

          <span className="font-mono text-[9px] text-[#8a96a8] tabular-nums hidden xs:inline">
            {clock}
          </span>
        </div>

        {/* Right: XAUUSD Gold Chip */}
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#04060b] border border-[#38bdf8]/20 text-[10px] font-mono text-[#e8edf5]">
          <Coins className="w-3 h-3 text-[#E8B84A]" />
          <span className="font-bold tracking-wider text-[#E8B84A]">XAU/USD</span>
          <span className="text-[8px] text-[#8a96a8] border-l border-[#38bdf8]/20 pl-1">SPOT</span>
        </div>
      </div>

      {/* Timeframe switch row */}
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

        <span className="text-[9px] font-mono text-[#8a96a8] tabular-nums hidden sm:inline">
          BIQUOTE XAUUSD · 10Hz RAF
        </span>
      </div>
    </header>
  );
};
