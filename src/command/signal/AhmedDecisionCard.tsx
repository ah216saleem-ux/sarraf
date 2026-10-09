import React from 'react';
import { SignalEnginePublicState } from './types';
import { Shield, Clock, XCircle, ArrowUpRight, ArrowDownRight, Zap } from 'lucide-react';

interface AhmedDecisionCardProps {
  state: SignalEnginePublicState;
  livePnL: number;
  currentPrice: number;
  isFeedDimmed: boolean;
  onManualClose: () => Promise<void>;
  onTogglePaper: () => Promise<void>;
  onTriggerTest?: () => Promise<void>;
  isLoading: boolean;
}

export const AhmedDecisionCard: React.FC<AhmedDecisionCardProps> = ({
  state,
  livePnL,
  currentPrice,
  isFeedDimmed,
  onManualClose,
  onTogglePaper,
  isLoading,
}) => {
  const { lifecycle, activeSignal, cooldownRemainingSeconds, paperMode, waitReason } = state;

  // Format cooldown time MM:SS
  const formatCooldown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Determine primary display status
  let statusBadge = 'WAIT';
  let statusBg = 'bg-[#f5a524]/10 text-[#f5a524] border-[#f5a524]/30';
  let dotColor = 'bg-[#f5a524]';

  if (isFeedDimmed) {
    statusBadge = 'WAIT';
    statusBg = 'bg-[#ff3b6b]/10 text-[#ff3b6b] border-[#ff3b6b]/30';
    dotColor = 'bg-[#ff3b6b]';
  } else if (lifecycle === 'ACTIVE' && activeSignal) {
    if (activeSignal.side === 'BUY') {
      statusBadge = 'BUY';
      statusBg = 'bg-[#22e08a]/10 text-[#22e08a] border-[#22e08a]/30';
      dotColor = 'bg-[#22e08a]';
    } else {
      statusBadge = 'SELL';
      statusBg = 'bg-[#ff3b6b]/10 text-[#ff3b6b] border-[#ff3b6b]/30';
      dotColor = 'bg-[#ff3b6b]';
    }
  } else if (lifecycle === 'COOLDOWN') {
    statusBadge = 'COOLDOWN';
    statusBg = 'bg-[#38bdf8]/10 text-[#38bdf8] border-[#38bdf8]/30';
    dotColor = 'bg-[#38bdf8]';
  }

  const effectivePnL = activeSignal ? livePnL : 0;
  const pnlColor = effectivePnL >= 0 ? 'text-[#22e08a]' : 'text-[#ff3b6b]';

  return (
    <div className="relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3.5 py-3 flex flex-col justify-between overflow-hidden shadow-lg select-none font-mono">
      {/* Top subtle glow bar */}
      <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#38bdf8]/50 to-transparent" />

      {/* Header Row */}
      <div className="flex items-center justify-between pb-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold tracking-[0.14em] text-[#38bdf8] uppercase">
              DECISION
            </span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/5 text-[#8a96a8] border border-white/5">
              AHMED SNIPER
            </span>
          </div>
        </div>

        {/* Paper Mode Toggle & Badge */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onTogglePaper}
            disabled={isLoading}
            title="Click to toggle Paper Mode"
            className={`text-[9px] font-bold px-2 py-0.5 rounded border transition-colors cursor-pointer ${
              paperMode
                ? 'bg-[#E8B84A]/10 text-[#E8B84A] border-[#E8B84A]/30 hover:bg-[#E8B84A]/20'
                : 'bg-[#22e08a]/10 text-[#22e08a] border-[#22e08a]/30 hover:bg-[#22e08a]/20'
            }`}
          >
            {paperMode ? 'PAPER MODE [ON]' : 'LIVE EXEC [ON]'}
          </button>
        </div>
      </div>

      {/* Main Status & One-Line Reason Row */}
      <div className="my-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {/* Status Badge */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border font-bold text-sm tracking-wider ${statusBg}`}>
            <span className={`w-2 h-2 rounded-full ${dotColor} animate-pulse`} />
            <span>{statusBadge}</span>
            {activeSignal && (
              <span className="text-[10px] text-white/70 ml-1">
                {activeSignal.side === 'BUY' ? <ArrowUpRight className="inline w-3 h-3" /> : <ArrowDownRight className="inline w-3 h-3" />}
              </span>
            )}
          </div>

          {/* Live PnL in dollars if ACTIVE */}
          {lifecycle === 'ACTIVE' && activeSignal && (
            <div className="flex items-baseline gap-1.5 pl-2 border-l border-white/10">
              <span className="text-[10px] text-[#8a96a8]">PNL:</span>
              <span className={`text-base sm:text-lg font-bold tracking-tight ${pnlColor}`}>
                {effectivePnL >= 0 ? `+$${effectivePnL.toFixed(2)}` : `-$${Math.abs(effectivePnL).toFixed(2)}`}
              </span>
              <span className="text-[9px] text-[#8a96a8]">USD</span>
            </div>
          )}

          {/* Cooldown Timer if in COOLDOWN */}
          {lifecycle === 'COOLDOWN' && (
            <div className="flex items-center gap-1.5 text-xs text-[#38bdf8] bg-[#38bdf8]/5 px-2.5 py-1 rounded border border-[#38bdf8]/20">
              <Clock className="w-3.5 h-3.5 animate-spin text-[#38bdf8]" style={{ animationDuration: '4s' }} />
              <span className="font-bold">{formatCooldown(cooldownRemainingSeconds)}</span>
              <span className="text-[9px] text-[#8a96a8]">COOLDOWN</span>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {lifecycle === 'ACTIVE' && activeSignal && (
            <button
              onClick={onManualClose}
              disabled={isLoading}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#ff3b6b]/10 hover:bg-[#ff3b6b]/20 border border-[#ff3b6b]/30 text-[#ff3b6b] text-[10px] font-bold tracking-wide transition-colors cursor-pointer"
            >
              <XCircle className="w-3 h-3" />
              <span>CLOSE TRADE</span>
            </button>
          )}
        </div>
      </div>

      {/* One-Line Reason Bar */}
      <div className="px-2.5 py-1.5 rounded bg-[#04060b] border border-white/5 mb-3">
        <p className="text-[10px] text-[#8a96a8] truncate">
          <span className="text-white/60 font-semibold">REASON: </span>
          {isFeedDimmed
            ? 'Feed offline or reconnecting · Real-time signal generation paused.'
            : activeSignal
            ? activeSignal.entryReason
            : waitReason}
        </p>
      </div>

      {/* Target Levels Grid: Entry, SL, TP1, TP2, TP3 */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 pt-1">
        {/* Entry */}
        <div className="p-1.5 rounded bg-[#04060b] border border-white/5 flex flex-col">
          <span className="text-[8px] text-[#8a96a8] uppercase font-bold tracking-wider">ENTRY</span>
          <span className="text-xs font-bold text-white mt-0.5">
            {activeSignal ? `$${activeSignal.entry.toFixed(2)}` : currentPrice > 0 ? `$${currentPrice.toFixed(2)}` : 'N/A'}
          </span>
          <span className="text-[7.5px] text-[#8a96a8]">
            {activeSignal ? 'FILLED' : 'MARKET SPOT'}
          </span>
        </div>

        {/* SL (-$10) */}
        <div className={`p-1.5 rounded bg-[#04060b] border flex flex-col ${activeSignal?.slHit ? 'border-[#ff3b6b] bg-[#ff3b6b]/5' : 'border-white/5'}`}>
          <div className="flex items-center justify-between">
            <span className="text-[8px] text-[#ff3b6b] uppercase font-bold tracking-wider">SL (-$10)</span>
            {activeSignal?.slHit && <span className="text-[7px] text-[#ff3b6b] font-bold">HIT</span>}
          </div>
          <span className="text-xs font-bold text-[#ff3b6b] mt-0.5">
            {activeSignal ? `$${activeSignal.sl.toFixed(2)}` : currentPrice > 0 ? `$${(currentPrice - 10.0).toFixed(2)}` : 'N/A'}
          </span>
          <span className="text-[7.5px] text-[#8a96a8]">1.0R RISK</span>
        </div>

        {/* TP1 (+$5) */}
        <div className={`p-1.5 rounded bg-[#04060b] border flex flex-col ${activeSignal?.tp1Hit ? 'border-[#22e08a] bg-[#22e08a]/5' : 'border-white/5'}`}>
          <div className="flex items-center justify-between">
            <span className="text-[8px] text-[#22e08a] uppercase font-bold tracking-wider">TP1 (+$5)</span>
            {activeSignal?.tp1Hit && <span className="text-[7px] text-[#22e08a] font-bold">HIT ✓</span>}
          </div>
          <span className="text-xs font-bold text-[#22e08a] mt-0.5">
            {activeSignal ? `$${activeSignal.tp1.toFixed(2)}` : currentPrice > 0 ? `$${(currentPrice + 5.0).toFixed(2)}` : 'N/A'}
          </span>
          <span className="text-[7.5px] text-[#8a96a8]">0.5R PROFIT</span>
        </div>

        {/* TP2 (+$8) */}
        <div className={`p-1.5 rounded bg-[#04060b] border flex flex-col ${activeSignal?.tp2Hit ? 'border-[#22e08a] bg-[#22e08a]/5' : 'border-white/5'}`}>
          <div className="flex items-center justify-between">
            <span className="text-[8px] text-[#22e08a] uppercase font-bold tracking-wider">TP2 (+$8)</span>
            {activeSignal?.tp2Hit && <span className="text-[7px] text-[#22e08a] font-bold">HIT ✓</span>}
          </div>
          <span className="text-xs font-bold text-[#22e08a] mt-0.5">
            {activeSignal ? `$${activeSignal.tp2.toFixed(2)}` : currentPrice > 0 ? `$${(currentPrice + 8.0).toFixed(2)}` : 'N/A'}
          </span>
          <span className="text-[7.5px] text-[#8a96a8]">0.8R PROFIT</span>
        </div>

        {/* TP3 (+$12) */}
        <div className={`p-1.5 rounded bg-[#04060b] border flex flex-col col-span-2 sm:col-span-1 ${activeSignal?.tp3Hit ? 'border-[#E8B84A] bg-[#E8B84A]/5' : 'border-white/5'}`}>
          <div className="flex items-center justify-between">
            <span className="text-[8px] text-[#E8B84A] uppercase font-bold tracking-wider">TP3 (+$12)</span>
            {activeSignal?.tp3Hit && <span className="text-[7px] text-[#E8B84A] font-bold">HIT ✓</span>}
          </div>
          <span className="text-xs font-bold text-[#E8B84A] mt-0.5">
            {activeSignal ? `$${activeSignal.tp3.toFixed(2)}` : currentPrice > 0 ? `$${(currentPrice + 12.0).toFixed(2)}` : 'N/A'}
          </span>
          <span className="text-[7.5px] text-[#8a96a8]">1.2R RUNNER</span>
        </div>
      </div>
    </div>
  );
};
