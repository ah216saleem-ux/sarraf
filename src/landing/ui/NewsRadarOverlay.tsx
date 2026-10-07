import React from 'react';
import { useMarket } from '../../context/MarketContext';
import { Radio, AlertCircle } from 'lucide-react';

interface NewsRadarOverlayProps {
  opacity: number;
}

export const NewsRadarOverlay: React.FC<NewsRadarOverlayProps> = ({ opacity }) => {
  const { macroEvents } = useMarket();

  if (opacity <= 0.01) return null;

  return (
    <div
      className="min-h-screen w-full flex items-center px-4 sm:px-8 py-20 pointer-events-auto"
      style={{ opacity }}
    >
      <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        {/* Left column text */}
        <div className="lg:col-span-5 space-y-6">
          <div className="flex items-center gap-3 text-xs font-mono tracking-[0.25em] text-[#FFD97A]/80 uppercase">
            <Radio className="w-4 h-4 text-[#E8B84A] animate-pulse" />
            <span>GLOBAL RADAR // MACRO HARVEST</span>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 tracking-wider">
              DEMO
            </span>
          </div>

          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
            Anticipate volatility before it{' '}
            <span className="font-serif italic text-[#FFD97A] gold-glow-text">
              hits the tape.
            </span>
          </h2>

          <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
            SARRAF scans tier-one macroeconomic catalysts 24/7. Central bank balance sheet shifts, real interest rate differentials, and institutional bullion reserves mapped directly onto our execution orbit.
          </p>

          <div className="p-4 rounded-xl bg-black/50 border border-[#E8B84A]/30 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[#FFD97A] shrink-0 mt-0.5" />
            <p className="text-xs font-mono text-neutral-300 leading-relaxed">
              Algorithmic blackouts are automatically triggered 15 minutes before critical CPI and FOMC releases to shield active orders.
            </p>
          </div>
        </div>

        {/* Right column: High-Impact Event Cards matching 3D globe coordinates */}
        <div className="lg:col-span-7 space-y-3.5">
          {macroEvents.map((event) => {
            const isBullish = event.bias === 'BULLISH';
            const isBearish = event.bias === 'BEARISH';
            const badgeClass = isBullish
              ? 'text-emerald-400 bg-emerald-950/60 border-emerald-700/50'
              : isBearish
              ? 'text-rose-400 bg-rose-950/60 border-rose-700/50'
              : 'text-[#FFD97A] bg-amber-950/60 border-amber-700/50';

            return (
              <div
                key={event.id}
                className="glass-panel p-4 sm:p-5 rounded-xl border border-white/10 hover:border-[#FFD97A]/50 transition-all duration-300 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[10px] font-mono tracking-widest text-[#E8B84A] px-1.5 py-0.5 rounded bg-[#E8B84A]/10 border border-[#E8B84A]/30">
                      {event.currency}
                    </span>
                    <span className="text-[9px] font-mono font-bold tracking-wider px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      DEMO
                    </span>
                    <h4 className="text-base font-semibold text-white">
                      {event.title}
                    </h4>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono text-neutral-400">
                    <span>Forecast: <strong className="text-neutral-200">{event.forecast}</strong></span>
                    <span>·</span>
                    <span>Prev: <strong className="text-neutral-200">{event.previous}</strong></span>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center font-mono">
                  {/* Bias Badge */}
                  <span className={`px-2.5 py-1 rounded text-[11px] font-bold border tracking-wider ${badgeClass}`}>
                    {event.bias}
                  </span>
                  {/* Countdown */}
                  <div className="text-right">
                    <span className="text-[10px] block text-neutral-500 uppercase tracking-widest">T-MINUS</span>
                    <span className="text-xs font-bold text-white tracking-widest">
                      {event.timeRemaining}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
