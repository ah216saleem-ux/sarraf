import React from 'react';
import { SignalEnginePublicState } from './types';
import { WhereCandidate } from '../data/commandTypes';
import { Clock, XCircle, ArrowUpRight, ArrowDownRight, Eye, ShieldAlert } from 'lucide-react';

interface AhmedDecisionCardProps {
  state: SignalEnginePublicState;
  livePnL: number;
  currentPrice: number;
  isFeedDimmed: boolean;
  isMarketClosed?: boolean;
  watchingCandidate?: WhereCandidate | null;
  onManualClose: () => Promise<void>;
  onTriggerTest?: () => Promise<void>;
  isLoading: boolean;
}

export const AhmedDecisionCard: React.FC<AhmedDecisionCardProps> = ({
  state,
  livePnL,
  currentPrice,
  isFeedDimmed,
  isMarketClosed = false,
  watchingCandidate = null,
  onManualClose,
  isLoading,
}) => {
  const { lifecycle, activeSignal, cooldownRemainingSeconds, waitReason, gates = [], pathClearR = 0 } = state;

  // Format cooldown time MM:SS
  const formatCooldown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Determine primary display status: MUST ONLY SAY WAIT, BUY, OR SELL
  const isActive = lifecycle === 'ACTIVE' && !!activeSignal;
  let statusBadge = 'WAIT';
  let statusBg = 'bg-[#f5a524]/10 text-[#f5a524] border-[#f5a524]/30';
  let dotColor = 'bg-[#f5a524]';

  if (isFeedDimmed) {
    statusBadge = 'WAIT';
    statusBg = 'bg-[#ff3b6b]/10 text-[#ff3b6b] border-[#ff3b6b]/30';
    dotColor = 'bg-[#ff3b6b]';
  } else if (isActive) {
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
    statusBadge = 'WAIT';
    statusBg = 'bg-[#38bdf8]/10 text-[#38bdf8] border-[#38bdf8]/30';
    dotColor = 'bg-[#38bdf8]';
  }

  const effectivePnL = activeSignal ? livePnL : 0;
  const pnlColor = effectivePnL >= 0 ? 'text-[#22e08a]' : 'text-[#ff3b6b]';

  // Compute Blocking Reason in plain words
  let blockingReason = waitReason || 'Awaiting institutional gate convergence';
  const missingGate = gates.find((g) => g.status === 'FAIL' || g.status === 'LOCKED');

  if (pathClearR > 0 && pathClearR < 10 && gates.filter((g) => g.status === 'PASS').length >= 6) {
    const opposingPrice = activeSignal?.side === 'BUY' ? currentPrice + pathClearR : currentPrice - pathClearR;
    blockingReason = `only ${(pathClearR / 10).toFixed(2)}R clear to the opposing zone ${opposingPrice.toFixed(2)}`;
  } else if (missingGate) {
    if ((isMarketClosed || isFeedDimmed) && (missingGate.id === 'g1' || missingGate.name.includes('W1/D1') || missingGate.reason.includes('History loading'))) {
      blockingReason = 'History loading (upstream down)';
    } else {
      blockingReason = `${missingGate.name} missing: ${missingGate.reason}`;
    }
  }

  if (blockingReason.includes('W1/D1 Context missing') && (isMarketClosed || isFeedDimmed)) {
    blockingReason = 'History loading (upstream down)';
  }

  // Compute WATCHING line from real candidate and real missing gate
  let watchingLine = '';
  if (watchingCandidate) {
    const gateLabel = missingGate ? missingGate.shortName || missingGate.name : 'M15 close';
    const targetPrice =
      watchingCandidate.side === 'SELL'
        ? (watchingCandidate.bottom - 0.5).toFixed(1)
        : (watchingCandidate.top + 0.5).toFixed(1);
    const action = watchingCandidate.side === 'SELL' ? 'close below' : 'close above';
    watchingLine = `${watchingCandidate.side} zone ${watchingCandidate.mid.toFixed(1)} - needs ${gateLabel} ${action} ${targetPrice}`;
  } else if (missingGate) {
    if ((isMarketClosed || isFeedDimmed) && (missingGate.id === 'g1' || missingGate.name.includes('W1/D1'))) {
      watchingLine = 'History loading (upstream down) - awaiting live stream reconnect';
    } else {
      watchingLine = `Monitoring liquidity - awaiting ${missingGate.name} (${missingGate.timeframe}) confirmation`;
    }
  } else {
    watchingLine = `Monitoring liquidity structures across M15 & H1`;
  }

  return (
    <div className="relative rounded-lg bg-[#070b14] border border-[#38bdf8]/20 px-3.5 py-3 flex flex-col justify-between overflow-hidden shadow-lg select-none font-mono">
      {/* Top subtle glow bar */}
      <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#38bdf8]/50 to-transparent" />

      {/* Header Row */}
      <div className="flex items-center justify-between pb-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold tracking-[0.14em] text-[#38bdf8] uppercase">
            DECISION
          </span>
          <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/5 text-[#8a96a8] border border-white/5">
            AHMED SNIPER
          </span>
        </div>

        {/* Status Tag: LIVE or CLOSED */}
        <div className="flex items-center gap-1.5">
          <span
            className={`text-[9px] font-bold px-2 py-0.5 rounded border ${
              isMarketClosed || isFeedDimmed
                ? 'bg-neutral-800/40 text-[#8a9ba8] border-[#8a9ba8]/30'
                : 'bg-[#22e08a]/10 text-[#22e08a] border-[#22e08a]/30'
            }`}
          >
            {isMarketClosed || isFeedDimmed ? 'CLOSED' : 'LIVE'}
          </span>
        </div>
      </div>

      {/* Main Status & One-Line Reason Row */}
      <div className="my-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {/* Status Badge: WAIT / BUY / SELL */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border font-bold text-sm tracking-wider ${statusBg}`}>
            <span className={`w-2 h-2 rounded-full ${dotColor} animate-pulse`} />
            <span>{statusBadge}</span>
            {isActive && (
              <span className="text-[10px] text-white/70 ml-1">
                {activeSignal.side === 'BUY' ? (
                  <ArrowUpRight className="inline w-3 h-3" />
                ) : (
                  <ArrowDownRight className="inline w-3 h-3" />
                )}
              </span>
            )}
          </div>

          {/* Live PnL in dollars ONLY if ACTIVE */}
          {isActive && (
            <div className="flex items-baseline gap-1.5 pl-2 border-l border-white/10">
              <span className="text-[10px] text-[#8a96a8]">
                {isMarketClosed ? 'LAST PRICE:' : 'PNL:'}
              </span>
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

        {/* Action Controls for active signal */}
        {isActive && (
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

      {/* STATE = WAIT: Blocking reason in plain words + WATCHING line (NO Entry/SL/TP boxes) */}
      {!isActive ? (
        <div className="space-y-1.5 pt-1">
          {/* Blocking Reason Bar */}
          <div className="px-2.5 py-1.5 rounded bg-[#04060b] border border-white/5 flex items-start gap-1.5">
            <ShieldAlert className="w-3 h-3 text-[#f5a524] mt-0.5 shrink-0" />
            <p className="text-[10px] text-[#8a96a8] leading-tight">
              <span className="text-white/60 font-semibold uppercase">BLOCKING REASON: </span>
              <span className="text-[#e8edf5]/90">{blockingReason}</span>
            </p>
          </div>

          {/* WATCHING Line */}
          <div className="px-2.5 py-1.5 rounded bg-[#38bdf8]/5 border border-[#38bdf8]/20 flex items-start gap-1.5">
            <Eye className="w-3 h-3 text-[#38bdf8] mt-0.5 shrink-0" />
            <p className="text-[10px] text-[#38bdf8] leading-tight font-medium">
              <span className="font-bold uppercase tracking-wider text-[#38bdf8]/80">WATCHING: </span>
              <span className="text-white">{watchingLine}</span>
            </p>
          </div>
        </div>
      ) : (
        /* STATE = ACTIVE: Show Entry, SL, TP1, TP2, TP3 */
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 pt-1">
          {/* Entry */}
          <div className="p-1.5 rounded bg-[#04060b] border border-white/5 flex flex-col">
            <span className="text-[8px] text-[#8a96a8] uppercase font-bold tracking-wider">ENTRY</span>
            <span className="text-xs font-bold text-white mt-0.5">
              ${activeSignal.entry.toFixed(2)}
            </span>
            <span className="text-[7.5px] text-[#8a96a8]">FILLED</span>
          </div>

          {/* SL (-$10) */}
          <div className={`p-1.5 rounded bg-[#04060b] border flex flex-col ${activeSignal.slHit ? 'border-[#ff3b6b] bg-[#ff3b6b]/5' : 'border-white/5'}`}>
            <div className="flex items-center justify-between">
              <span className="text-[8px] text-[#ff3b6b] uppercase font-bold tracking-wider">SL (-$10)</span>
              {activeSignal.slHit && <span className="text-[7px] text-[#ff3b6b] font-bold">HIT</span>}
            </div>
            <span className="text-xs font-bold text-[#ff3b6b] mt-0.5">
              ${activeSignal.sl.toFixed(2)}
            </span>
            <span className="text-[7.5px] text-[#8a96a8]">1.0R RISK</span>
          </div>

          {/* TP1 (+$5) */}
          <div className={`p-1.5 rounded bg-[#04060b] border flex flex-col ${activeSignal.tp1Hit ? 'border-[#22e08a] bg-[#22e08a]/5' : 'border-white/5'}`}>
            <div className="flex items-center justify-between">
              <span className="text-[8px] text-[#22e08a] uppercase font-bold tracking-wider">TP1 (+$5)</span>
              {activeSignal.tp1Hit && <span className="text-[7px] text-[#22e08a] font-bold">HIT ✓</span>}
            </div>
            <span className="text-xs font-bold text-[#22e08a] mt-0.5">
              ${activeSignal.tp1.toFixed(2)}
            </span>
            <span className="text-[7.5px] text-[#8a96a8]">0.5R PROFIT</span>
          </div>

          {/* TP2 (+$8) */}
          <div className={`p-1.5 rounded bg-[#04060b] border flex flex-col ${activeSignal.tp2Hit ? 'border-[#22e08a] bg-[#22e08a]/5' : 'border-white/5'}`}>
            <div className="flex items-center justify-between">
              <span className="text-[8px] text-[#22e08a] uppercase font-bold tracking-wider">TP2 (+$8)</span>
              {activeSignal.tp2Hit && <span className="text-[7px] text-[#22e08a] font-bold">HIT ✓</span>}
            </div>
            <span className="text-xs font-bold text-[#22e08a] mt-0.5">
              ${activeSignal.tp2.toFixed(2)}
            </span>
            <span className="text-[7.5px] text-[#8a96a8]">0.8R PROFIT</span>
          </div>

          {/* TP3 (+$12) */}
          <div className={`p-1.5 rounded bg-[#04060b] border flex flex-col col-span-2 sm:col-span-1 ${activeSignal.tp3Hit ? 'border-[#E8B84A] bg-[#E8B84A]/5' : 'border-white/5'}`}>
            <div className="flex items-center justify-between">
              <span className="text-[8px] text-[#E8B84A] uppercase font-bold tracking-wider">TP3 (+$12)</span>
              {activeSignal.tp3Hit && <span className="text-[7px] text-[#E8B84A] font-bold">HIT ✓</span>}
            </div>
            <span className="text-xs font-bold text-[#E8B84A] mt-0.5">
              ${activeSignal.tp3.toFixed(2)}
            </span>
            <span className="text-[7.5px] text-[#8a96a8]">1.2R RUNNER</span>
          </div>
        </div>
      )}
    </div>
  );
};
