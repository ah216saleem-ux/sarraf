import React from 'react';
import { CommandTick } from '../data/commandTypes';

interface TickTapePanelProps {
  tickTape: CommandTick[];
  buyTicks60s: number;
  sellTicks60s: number;
  buyDeltaSum60s: number;
  sellDeltaSum60s: number;
  isDimmed: boolean;
  freshness: string;
}

export const TickTapePanel: React.FC<TickTapePanelProps> = ({
  tickTape,
  buyTicks60s,
  sellTicks60s,
  buyDeltaSum60s,
  sellDeltaSum60s,
  isDimmed,
  freshness,
}) => {
  const formatTimeWithMs = (epochMs: number) => {
    const d = new Date(epochMs);
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    const s = String(d.getUTCSeconds()).padStart(2, '0');
    const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  };

  return (
    <div
      className={`relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 transition-opacity duration-300 overflow-hidden ${
        isDimmed ? 'opacity-40' : 'opacity-100'
      }`}
    >
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent" />

      {/* Header */}
      <div className="flex items-center justify-between font-mono mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-[0.12em]">
            5. TICK TAPE
          </span>
          <div className="flex items-center gap-1.5 text-[9px] text-[#8a96a8]">
            <span className="px-1 py-0.2 rounded bg-white/5 uppercase">BIQUOTE TICK</span>
            <span>·</span>
            <span>{freshness}</span>
          </div>
        </div>

        {/* Real dollar price-delta sums (Fix 2) */}
        <div className="flex items-center gap-2 text-[9px] font-mono tabular-nums">
          <span className="text-[#22e08a]">
            {buyTicks60s} BUY (+${buyDeltaSum60s.toFixed(2)})
          </span>
          <span className="text-[#8a96a8]">·</span>
          <span className="text-[#ff3b6b]">
            {sellTicks60s} SELL (-${sellDeltaSum60s.toFixed(2)})
          </span>
        </div>
      </div>

      {/* Fixed-height scroll area (about 12 rows, ~240px) */}
      <div className="border border-[#38bdf8]/15 rounded bg-[#04060b] overflow-hidden font-mono text-[10px]">
        {/* Column Headers: time, BUY/SELL/FLAT, delta, price */}
        <div className="grid grid-cols-12 px-2.5 py-1 text-[9px] text-[#8a96a8] uppercase border-b border-white/5 font-semibold">
          <span className="col-span-4">TIME</span>
          <span className="col-span-3 text-center">SIDE</span>
          <span className="col-span-2 text-right">DELTA</span>
          <span className="col-span-3 text-right">PRICE</span>
        </div>

        {/* Scrollable list (about 12 rows ~ 240px) */}
        <div className="h-[240px] overflow-y-auto divide-y divide-white/5 scrollbar-thin">
          {tickTape.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[#8a96a8] text-[10px]">
              collecting data...
            </div>
          ) : (
            tickTape.map((t) => {
              // Fix 1: delta 0 must be FLAT (grey), never DOWN or UP
              const isFlat = t.delta === 0 || t.direction === 'FLAT';
              const sideColor = isFlat
                ? 'text-[#8a96a8] bg-white/5'
                : t.direction === 'BUY'
                ? 'text-[#22e08a] bg-[#22e08a]/10'
                : 'text-[#ff3b6b] bg-[#ff3b6b]/10';

              const deltaColor = isFlat
                ? 'text-[#8a96a8]'
                : t.delta > 0
                ? 'text-[#22e08a]'
                : 'text-[#ff3b6b]';

              return (
                <div
                  key={t.id}
                  className="grid grid-cols-12 px-2.5 h-[20px] items-center hover:bg-white/5 transition-colors tabular-nums"
                >
                  <span className="col-span-4 text-[#8a96a8] text-[9px]">
                    {formatTimeWithMs(t.timestamp)}
                  </span>

                  <div className="col-span-3 flex justify-center">
                    <span
                      className={`text-[8px] font-bold px-1 rounded uppercase ${sideColor}`}
                    >
                      {isFlat ? 'FLAT' : t.direction}
                    </span>
                  </div>

                  <span className={`col-span-2 text-right font-bold ${deltaColor}`}>
                    {isFlat ? '0.00' : t.delta > 0 ? `+${t.delta.toFixed(2)}` : t.delta.toFixed(2)}
                  </span>

                  <span className="col-span-3 text-right text-[#e8edf5] font-bold">
                    ${t.price.toFixed(2)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
