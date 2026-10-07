import React, { useMemo } from 'react';
import { Globe, Clock } from 'lucide-react';

interface MarketSession {
  city: string;
  country: string;
  openUtc: number; // UTC hour
  closeUtc: number; // UTC hour
  tzName: string;
}

const SESSIONS: MarketSession[] = [
  { city: 'Sydney', country: 'AUS', openUtc: 22, closeUtc: 7, tzName: 'AEST' },
  { city: 'Tokyo', country: 'JPN', openUtc: 0, closeUtc: 9, tzName: 'JST' },
  { city: 'London', country: 'UK', openUtc: 8, closeUtc: 17, tzName: 'GMT' },
  { city: 'New York', country: 'USA', openUtc: 13, closeUtc: 22, tzName: 'EST' },
];

export const SessionStrip: React.FC = () => {
  const sessionStates = useMemo(() => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMin = now.getUTCMinutes();
    const currentDec = utcHour + utcMin / 60;

    return SESSIONS.map((sess) => {
      let isOpen = false;
      if (sess.openUtc > sess.closeUtc) {
        // Crosses midnight (e.g. Sydney 22:00 to 07:00)
        isOpen = currentDec >= sess.openUtc || currentDec < sess.closeUtc;
      } else {
        isOpen = currentDec >= sess.openUtc && currentDec < sess.closeUtc;
      }

      return {
        ...sess,
        isOpen,
      };
    });
  }, []);

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-6">
      <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-[#E8B84A]/20 bg-[#08080a]/80 backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#FFD97A]" />
            <span className="font-mono text-xs font-bold text-white tracking-widest uppercase">
              GLOBAL GOLD TRADING SESSIONS
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-neutral-400">
            <Clock className="w-3 h-3 text-[#E8B84A]" />
            <span>UTC SYNCHRONIZED</span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 font-mono">
          {sessionStates.map((sess) => (
            <div
              key={sess.city}
              className={`p-3 rounded-xl border transition-all duration-300 ${
                sess.isOpen
                  ? 'bg-emerald-950/20 border-emerald-500/35 shadow-[0_0_15px_rgba(52,211,153,0.1)]'
                  : 'bg-black/40 border-white/5 text-neutral-500'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-xs font-bold ${sess.isOpen ? 'text-white' : 'text-neutral-400'}`}>
                  {sess.city}
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                    sess.isOpen
                      ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/40'
                      : 'bg-neutral-900 text-neutral-500 border border-neutral-800'
                  }`}
                >
                  {sess.isOpen && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />}
                  {sess.isOpen ? 'OPEN' : 'CLOSED'}
                </span>
              </div>
              <div className="text-[10px] text-neutral-400 flex justify-between">
                <span>{sess.openUtc.toString().padStart(2, '0')}:00 - {sess.closeUtc.toString().padStart(2, '0')}:00 UTC</span>
                <span className="text-[#E8B84A]/70">{sess.tzName}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
