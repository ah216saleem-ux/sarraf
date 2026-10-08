import React from 'react';

interface BuySellRatioPanelProps {
  buyRatio: number;
  sellRatio: number;
  buyTicks60s: number;
  sellTicks60s: number;
  isDimmed: boolean;
  freshness: string;
}

export const BuySellRatioPanel: React.FC<BuySellRatioPanelProps> = ({
  buyRatio,
  sellRatio,
  buyTicks60s,
  sellTicks60s,
  isDimmed,
  freshness,
}) => {
  const totalTicks = buyTicks60s + sellTicks60s;
  const totalRectangles = 40;
  const buyRectangles = Math.round((buyRatio / 100) * totalRectangles);

  return (
    <div
      className={`relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 transition-opacity duration-300 overflow-hidden ${
        isDimmed ? 'opacity-40' : 'opacity-100'
      }`}
    >
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent" />

      {/* Header */}
      <div className="flex items-center justify-between font-mono mb-2">
        <span className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-[0.12em]">
          4. BUY / SELL RATIO
        </span>
        <div className="flex items-center gap-1.5 text-[9px] text-[#8a96a8]">
          <span className="px-1 py-0.2 rounded bg-white/5 uppercase">ESTIMATED</span>
          <span>·</span>
          <span>{freshness}</span>
        </div>
      </div>

      {totalTicks === 0 ? (
        <div className="h-[44px] flex items-center justify-center font-mono text-[11px] text-[#8a96a8]">
          collecting data...
        </div>
      ) : (
        <div className="space-y-2 font-mono">
          {/* Big Green % Left, Big Red % Right */}
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl sm:text-2xl font-black text-[#22e08a] tabular-nums">
                {buyRatio}%
              </span>
              <span className="text-[10px] font-bold text-[#22e08a]/80">BUY (EST.)</span>
            </div>

            <div className="flex items-baseline gap-1.5 text-right">
              <span className="text-[10px] font-bold text-[#ff3b6b]/80">SELL (EST.)</span>
              <span className="text-xl sm:text-2xl font-black text-[#ff3b6b] tabular-nums">
                {sellRatio}%
              </span>
            </div>
          </div>

          {/* Segmented bar of 40 tiny rectangles */}
          <div className="flex items-center gap-[2px] h-2.5 w-full bg-[#04060b] p-0.5 rounded border border-white/5">
            {Array.from({ length: totalRectangles }).map((_, idx) => {
              const isBuy = idx < buyRectangles;
              return (
                <div
                  key={idx}
                  className={`flex-1 h-full rounded-[1px] transition-all duration-150 ${
                    isBuy ? 'bg-[#22e08a]' : 'bg-[#ff3b6b]'
                  }`}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
