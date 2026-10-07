import React, { useState, useEffect } from 'react';
import { Send, CheckCircle2 } from 'lucide-react';

interface TelegramOverlayProps {
  opacity: number;
}

export const TelegramOverlay: React.FC<TelegramOverlayProps> = ({ opacity }) => {
  const [typedIndex, setTypedIndex] = useState(0);

  const signalText = `⚡ SARRAF INSTITUTIONAL EXECUTION
INSTRUMENT: XAU/USD (SPOT GOLD)
DIRECTION: LONG
ENTRY ZONE: $2,914.50 - $2,916.20
STOP LOSS: $2,904.00 (Risk: -1.0%)

TARGET 1: $2,924.50 (+100 pips) ✅
TARGET 2: $2,933.00 (+185 pips)
TARGET 3: $2,946.00 (+315 pips)
TARGET 4: $2,962.00 (Runner / Trailing SL)

COOLDOWN LOCK: 4 Hours Active
EXECUTION LATENCY: 28ms`;

  useEffect(() => {
    if (opacity < 0.2) {
      setTypedIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setTypedIndex((prev) => {
        if (prev < signalText.length) {
          return prev + 3;
        }
        return prev;
      });
    }, 25);

    return () => clearInterval(interval);
  }, [opacity, signalText.length]);

  if (opacity <= 0.01) return null;

  return (
    <div
      className="min-h-screen w-full flex items-center px-4 sm:px-8 py-20 pointer-events-auto"
      style={{ opacity }}
    >
      <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        {/* Left column: Editorial message */}
        <div className="lg:col-span-6 space-y-6">
          <div className="flex items-center gap-3 text-xs font-mono tracking-[0.25em] text-[#FFD97A]/80 uppercase">
            <Send className="w-4 h-4 text-[#E8B84A]" />
            <span>DISPATCH ARCHITECTURE</span>
          </div>

          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
            Direct to Telegram.{' '}
            <span className="font-serif italic text-[#FFD97A] gold-glow-text">
              Zero friction.
            </span>
          </h2>

          <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
            Every verified institutional setup arrives immediately on your phone via dedicated encrypted Telegram webhook. No noisy chats, no clutter—pure execution coordinates.
          </p>

          <div className="space-y-3 font-mono text-xs text-neutral-300 pt-2">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Sub-40 millisecond push broadcast relay</span>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Layered Take-Profit (TP1 to TP4) trailing triggers</span>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Strict cooldown timer enforcement notification</span>
            </div>
          </div>

          <div className="pt-2">
            <a
              href="https://t.me"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#0088cc]/20 border border-[#0088cc]/50 hover:bg-[#0088cc]/30 text-white text-xs font-mono tracking-widest uppercase transition-all duration-300 shadow-[0_0_20px_rgba(0,136,204,0.2)]"
            >
              <Send className="w-3.5 h-3.5 text-[#29B6F6]" />
              <span>Open SARRAF Telegram Channel</span>
            </a>
          </div>
        </div>

        {/* Right column: Realistic glass telegram message window */}
        <div className="lg:col-span-6 flex justify-center lg:justify-end">
          <div className="w-full max-w-md glass-panel-glow rounded-2xl p-5 border border-[#E8B84A]/30">
            {/* Window header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#B88628] to-[#FFD97A] flex items-center justify-center font-bold text-xs text-black">
                  S
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-mono font-bold text-white tracking-wider">
                      SARRAF GOLD PRIVATE
                    </h4>
                    <span className="text-[9px] font-mono font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      DEMO
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                    DISPATCH BOT ACTIVE
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-mono text-neutral-400">NOW</span>
            </div>

            {/* Signal message display */}
            <div className="mt-4 p-4 rounded-xl bg-black/60 border border-white/5 font-mono text-xs text-neutral-200 leading-relaxed whitespace-pre-wrap min-h-[220px]">
              {signalText.slice(0, typedIndex)}
              {typedIndex < signalText.length && (
                <span className="inline-block w-2 h-4 bg-[#FFD97A] ml-0.5 animate-pulse" />
              )}
            </div>

            <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-neutral-400 px-1">
              <span>LATENCY: 28MS</span>
              <span className="text-[#FFD97A]">ENCRYPTED WEBHOOK</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
