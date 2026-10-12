import React from 'react';
import { WhereCandidate } from '../data/commandTypes';
import { Compass, Eye, ShieldCheck, ArrowUpRight, ArrowDownRight, Info } from 'lucide-react';

interface WhereSellBuyCanComeFromProps {
  candidates: WhereCandidate[];
  watchingCandidate: WhereCandidate | null;
  currentPrice: number;
  timeframe: string;
}

export const WhereSellBuyCanComeFrom: React.FC<WhereSellBuyCanComeFromProps> = ({
  candidates,
  watchingCandidate,
  currentPrice,
  timeframe,
}) => {
  // Sort: SELL candidates (descending from price upwards), then BUY candidates (ascending towards price)
  const sellCandidates = candidates
    .filter((c) => c.side === 'SELL')
    .sort((a, b) => a.mid - b.mid);

  const buyCandidates = candidates
    .filter((c) => c.side === 'BUY')
    .sort((a, b) => b.mid - a.mid);

  const rows = [...sellCandidates, ...buyCandidates];

  return (
    <div className="relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3 py-2.5 overflow-hidden shadow-lg select-none font-mono">
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent" />

      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-white/5">
        <div className="flex items-center gap-1.5">
          <Compass className="w-3.5 h-3.5 text-[#38bdf8]" />
          <span className="text-[10px] font-bold text-[#38bdf8] uppercase tracking-[0.12em]">
            WHERE SELL/BUY CAN COME FROM ({timeframe})
          </span>
        </div>

        <div className="flex items-center gap-1 text-[8.5px] text-[#8a96a8]">
          <span className="px-1 py-0.2 rounded bg-white/5 uppercase">RATING ≥ 40</span>
          <span
            title="Rule-based rating (0-100) = Freshness (0-25) + Confluence (0-30) + HTF Alignment (0-25) + Absorption Match (0-20)"
            className="cursor-help text-white/50 hover:text-white"
          >
            <Info className="w-2.5 h-2.5" />
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="py-4 text-center text-[10px] text-[#8a96a8]">
          Scanning order flow for rated confluence candidates (rating ≥ 40)...
        </div>
      ) : (
        <div className="space-y-1.5 mt-2">
          {rows.map((item, idx) => {
            const isBuy = item.side === 'BUY';
            const isWatching = watchingCandidate && watchingCandidate.id === item.id;
            const sideColor = isBuy ? 'text-[#22e08a]' : 'text-[#ff3b6b]';
            const sideBg = isBuy ? 'bg-[#22e08a]/10 border-[#22e08a]/30' : 'bg-[#ff3b6b]/10 border-[#ff3b6b]/30';

            return (
              <div
                key={`${item.id}-${idx}`}
                className={`p-2 rounded border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 ${
                  isWatching
                    ? 'bg-[#38bdf8]/10 border-[#38bdf8]/50 ring-1 ring-[#38bdf8]/30 shadow-[0_0_10px_rgba(56,189,248,0.15)]'
                    : 'bg-[#04060b] border-white/5'
                }`}
              >
                {/* Left Side: Badge + Price Range + Distance */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Side Badge */}
                  <span
                    className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded border ${sideBg} ${sideColor}`}
                  >
                    {isBuy ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                    <span>{item.side}</span>
                  </span>

                  {/* Watching Highlight Badge */}
                  {isWatching && (
                    <span className="inline-flex items-center gap-1 text-[8.5px] font-extrabold px-1.5 py-0.5 rounded bg-[#38bdf8] text-black tracking-wider animate-pulse">
                      <Eye className="w-2.5 h-2.5" />
                      <span>WATCHING</span>
                    </span>
                  )}

                  {/* Price Range */}
                  <span className="text-[11px] font-bold text-white tracking-wide">
                    {item.priceRange}
                  </span>

                  {/* Distance in Dollars */}
                  <span className="text-[9px] text-[#8a96a8]">
                    ({isBuy ? '-' : '+'}${item.distanceDollars.toFixed(2)})
                  </span>
                </div>

                {/* Right Side: Rating + Confluence Tags + Status */}
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {/* Rating Score with info tooltip */}
                  <span
                    className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded border cursor-help ${
                      item.rating >= 70
                        ? 'bg-[#22e08a]/10 border-[#22e08a]/30 text-[#22e08a]'
                        : item.rating >= 50
                        ? 'bg-[#E8B84A]/10 border-[#E8B84A]/30 text-[#E8B84A]'
                        : 'bg-white/5 border-white/10 text-[#8a96a8]'
                    }`}
                    title="Formula: Freshness (0-25) + Confluence (0-30) + HTF Alignment (0-25) + Absorption (0-20)"
                  >
                    rating p{item.rating}
                  </span>

                  {/* Confluence Tags */}
                  <div className="flex items-center gap-1">
                    {item.confluenceTags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[8px] font-bold px-1 py-0.2 rounded bg-white/5 border border-white/10 text-white/80 uppercase"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Status */}
                  <span className="text-[8.5px] text-[#8a96a8] uppercase px-1 py-0.2 rounded bg-white/5">
                    {item.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
