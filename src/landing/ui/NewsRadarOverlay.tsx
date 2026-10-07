import React, { useEffect, useState } from 'react';
import { Radio, AlertCircle, Clock } from 'lucide-react';

interface RealNewsEvent {
  id: string;
  title: string;
  country: string;
  impact: string;
  timeUtc: string;
  displayTime: string;
  forecastStr: string;
  previousStr: string;
  minutesUntil: number;
  goldImpact: string;
  isHighImpactUsd: boolean;
}

export const NewsRadarOverlay: React.FC<{ opacity: number }> = ({ opacity }) => {
  const [realEvents, setRealEvents] = useState<RealNewsEvent[]>([]);
  const [nextHighImpact, setNextHighImpact] = useState<RealNewsEvent | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchNews = async () => {
      try {
        const res = await fetch('/api/news');
        if (!res.ok) return;
        const data = await res.json();
        if (data && Array.isArray(data.events)) {
          const events: RealNewsEvent[] = data.events;
          if (isMounted) {
            // Find high impact USD events
            const usdHigh = events.filter(
              (e) => (e.isHighImpactUsd || e.impact === 'High') && e.minutesUntil > -120
            );
            setRealEvents(usdHigh.slice(0, 4));

            // Find next upcoming high impact USD event
            const upcoming = usdHigh.find((e) => e.minutesUntil >= 0);
            setNextHighImpact(upcoming || usdHigh[0] || null);
          }
        }
      } catch {
        // Hide if unavailable
      }
    };

    fetchNews();
    const interval = setInterval(fetchNews, 60000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  if (opacity <= 0.01) return null;

  // Format countdown string
  const formatCountdown = (mins: number) => {
    if (mins < 0) return 'RELEASED';
    const hours = Math.floor(mins / 60);
    const m = mins % 60;
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d : ${(hours % 24).toString().padStart(2, '0')}h`;
    }
    return `${hours.toString().padStart(2, '0')}h : ${m.toString().padStart(2, '0')}m`;
  };

  return (
    <div
      className="min-h-screen w-full flex items-center px-4 sm:px-8 py-20 pointer-events-auto overflow-x-hidden"
      style={{ opacity }}
    >
      <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-12 items-center">
        {/* Left column: Editorial text & Next Event Live Countdown */}
        <div className="lg:col-span-5 space-y-6">
          <div className="flex items-center gap-3 text-xs font-mono tracking-[0.25em] text-[#FFD97A]/80 uppercase">
            <Radio className="w-4 h-4 text-[#E8B84A] animate-pulse" />
            <span>GLOBAL RADAR // MACRO HARVEST</span>
          </div>

          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
            Anticipate volatility before it{' '}
            <span className="font-serif italic text-[#FFD97A] gold-glow-text">
              hits the tape.
            </span>
          </h2>

          <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
            SARRAF scans tier-one macroeconomic catalysts 24/7. Real-time Forex Factory calendar feeds monitor CPI, Non-Farm Payrolls, and FOMC interest rate meetings to protect institutional bullion execution.
          </p>

          {/* Next Real High-Impact USD Event Live Countdown Box (B4 requirement) */}
          {nextHighImpact && (
            <div className="p-4 sm:p-5 rounded-2xl bg-amber-950/30 border border-[#E8B84A]/40 backdrop-blur-md shadow-[0_0_25px_rgba(232,184,74,0.15)]">
              <div className="flex items-center justify-between text-[10px] font-mono uppercase text-[#FFD97A] mb-1.5">
                <span className="flex items-center gap-1.5 font-bold">
                  <Clock className="w-3.5 h-3.5 text-[#E8B84A]" />
                  NEXT HIGH-IMPACT CATALYST
                </span>
                <span className="px-1.5 py-0.5 rounded bg-[#E8B84A]/20 border border-[#E8B84A]/30 font-bold">
                  {nextHighImpact.country || 'USD'}
                </span>
              </div>
              <h4 className="text-sm sm:text-base font-bold text-white mb-2">
                {nextHighImpact.title}
              </h4>
              <div className="flex items-center justify-between pt-2 border-t border-white/10 font-mono text-xs">
                <span className="text-neutral-400">
                  Forecast: <strong className="text-neutral-200">{nextHighImpact.forecastStr || 'TBD'}</strong>
                </span>
                <div className="text-right">
                  <span className="text-[9px] block text-neutral-400 uppercase">T-MINUS</span>
                  <span className="text-sm font-bold text-[#FFD97A]">
                    {formatCountdown(nextHighImpact.minutesUntil)}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="p-4 rounded-xl bg-black/60 border border-white/10 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[#FFD97A] shrink-0 mt-0.5" />
            <p className="text-xs font-mono text-neutral-300 leading-relaxed">
              Algorithmic blackouts are automatically triggered 15 minutes before critical CPI and FOMC releases to shield active orders.
            </p>
          </div>
        </div>

        {/* Right column: High-Impact Real Event Cards */}
        <div className="lg:col-span-7 space-y-3.5">
          {realEvents.length > 0 ? (
            realEvents.map((event) => (
              <div
                key={event.id}
                className="glass-panel p-4 sm:p-5 rounded-xl border border-white/10 hover:border-[#FFD97A]/50 transition-all duration-300 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#09090c]/80 backdrop-blur-xl"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[10px] font-mono font-bold tracking-widest text-[#E8B84A] px-1.5 py-0.5 rounded bg-[#E8B84A]/10 border border-[#E8B84A]/30">
                      {event.country || 'USD'}
                    </span>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-700/50">
                      HIGH IMPACT
                    </span>
                    <h4 className="text-sm sm:text-base font-semibold text-white">
                      {event.title}
                    </h4>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono text-neutral-400">
                    <span>
                      Forecast: <strong className="text-neutral-200">{event.forecastStr || '—'}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Prev: <strong className="text-neutral-200">{event.previousStr || '—'}</strong>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center font-mono shrink-0">
                  <div className="text-right">
                    <span className="text-[9px] block text-neutral-400 uppercase tracking-widest">
                      T-MINUS
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-white tracking-widest">
                      {formatCountdown(event.minutesUntil)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="p-6 rounded-2xl bg-black/40 border border-white/5 text-center font-mono text-xs text-neutral-400">
              Syncing live macro calendar feed...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
