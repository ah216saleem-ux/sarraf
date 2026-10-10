import React, { useState, useEffect } from 'react';
import { SpyAnalysisResult } from '../types';
import {
  ArrowUpRight,
  ArrowDownRight,
  Shield,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Layers,
  Percent,
  Target,
  Zap,
} from 'lucide-react';

interface SpyResultCardProps {
  result: SpyAnalysisResult;
}

export const SpyResultCard: React.FC<SpyResultCardProps> = ({ result }) => {
  const {
    decision,
    approxAtmStrike,
    entryPrice,
    slPrice,
    tpPrice,
    riskReward,
    confidence,
    expiry,
    gates,
    reasons,
    expiresAt,
    expectedMove,
    distanceToTp,
    atrFeasible,
    totalScore,
  } = result;

  // Live ticking countdown
  const [timeLeftStr, setTimeLeftStr] = useState<string>('');

  useEffect(() => {
    const updateTimer = () => {
      const remainingMs = new Date(expiresAt).getTime() - Date.now();
      if (remainingMs <= 0) {
        setTimeLeftStr('EXPIRY REACHED');
        return;
      }
      const totalSec = Math.floor(remainingMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      setTimeLeftStr(`${mins}m ${String(secs).padStart(2, '0')}s`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const isCall = decision === 'CALL';
  const isPut = decision === 'PUT';
  const isNoTrade = decision === 'NO TRADE';

  return (
    <div
      className={`glass-panel p-5 sm:p-6 rounded-2xl border transition-all duration-300 shadow-[0_8px_32px_rgba(0,0,0,0.6)] ${
        isCall
          ? 'border-[#22e08a]/40 bg-gradient-to-b from-[#22e08a]/5 via-black/80 to-black/90'
          : isPut
          ? 'border-[#ff3b6b]/40 bg-gradient-to-b from-[#ff3b6b]/5 via-black/80 to-black/90'
          : 'border-white/10 bg-gradient-to-b from-white/5 via-black/80 to-black/90'
      }`}
    >
      {/* Header: Decision Badge, Strike, & Expiry Countdown */}
      <div className="flex flex-wrap items-center justify-between pb-4 border-b border-white/10 gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div
            className={`px-4 py-2 rounded-xl font-mono text-sm sm:text-base font-black tracking-wider flex items-center gap-2 border shadow-lg ${
              isCall
                ? 'bg-[#22e08a] text-black border-[#22e08a] shadow-[0_0_20px_rgba(34,224,138,0.4)]'
                : isPut
                ? 'bg-[#ff3b6b] text-white border-[#ff3b6b] shadow-[0_0_20px_rgba(255,59,107,0.4)]'
                : 'bg-neutral-800 text-neutral-300 border-neutral-700'
            }`}
          >
            {isCall ? (
              <>
                <ArrowUpRight className="w-5 h-5 stroke-[2.5]" />
                <span>CALL SIGNAL</span>
              </>
            ) : isPut ? (
              <>
                <ArrowDownRight className="w-5 h-5 stroke-[2.5]" />
                <span>PUT SIGNAL</span>
              </>
            ) : (
              <>
                <Shield className="w-5 h-5" />
                <span>NO TRADE</span>
              </>
            )}
          </div>

          {approxAtmStrike && !isNoTrade && (
            <span className="font-mono text-xs px-3 py-1.5 rounded-lg bg-[#E8B84A]/15 border border-[#E8B84A]/30 text-[#FFD97A] font-bold">
              ${approxAtmStrike} {decision} (approx ATM)
            </span>
          )}

          <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-neutral-300">
            EXPIRY: <strong className="text-white">{expiry}</strong>
          </span>
        </div>

        {/* Right: Confidence Score & Countdown */}
        <div className="flex items-center gap-4 font-mono">
          <div className="flex flex-col items-end text-xs">
            <span className="text-neutral-400">SCORE / CONFIDENCE</span>
            <div className="flex items-center gap-1.5 font-bold">
              <span
                className={
                  confidence >= 70
                    ? 'text-[#22e08a]'
                    : confidence >= 50
                    ? 'text-[#E8B84A]'
                    : 'text-neutral-400'
                }
              >
                {confidence}%
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end text-xs pl-3 border-l border-white/10">
            <span className="text-neutral-400">EXPIRY TIMER</span>
            <div className="flex items-center gap-1 text-[#E8B84A] font-bold">
              <Clock className="w-3.5 h-3.5" />
              <span>{timeLeftStr}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Target Levels Grid (Only when CALL or PUT) */}
      {!isNoTrade && entryPrice && slPrice && tpPrice ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 py-4 border-b border-white/10 font-mono">
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <div className="text-[10px] text-neutral-400">APPROX ATM STRIKE</div>
            <div className="text-lg font-black text-[#FFD97A] mt-0.5">
              ${approxAtmStrike}
            </div>
            <div className="text-[10px] text-neutral-500">Nearest Dollar ATM</div>
          </div>

          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <div className="text-[10px] text-neutral-400">ENTRY BENCHMARK</div>
            <div className="text-lg font-black text-white mt-0.5">${entryPrice.toFixed(2)}</div>
            <div className="text-[10px] text-neutral-500">Live Spot Execution</div>
          </div>

          <div className="p-3 rounded-xl bg-rose-950/20 border border-rose-500/30">
            <div className="text-[10px] text-rose-400 font-bold">STOP LOSS (SL)</div>
            <div className="text-lg font-black text-rose-300 mt-0.5">${slPrice.toFixed(2)}</div>
            <div className="text-[10px] text-rose-400/80">
              {isCall ? `-$${(entryPrice - slPrice).toFixed(2)}` : `+$${(slPrice - entryPrice).toFixed(2)}`} (Strict)
            </div>
          </div>

          <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/30">
            <div className="text-[10px] text-emerald-400 font-bold">TAKE PROFIT (TP)</div>
            <div className="text-lg font-black text-emerald-300 mt-0.5">${tpPrice.toFixed(2)}</div>
            <div className="text-[10px] text-emerald-400/80">
              {isCall ? `+$${(tpPrice - entryPrice).toFixed(2)}` : `-$${(entryPrice - tpPrice).toFixed(2)}`} (Target)
            </div>
          </div>

          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <div className="text-[10px] text-neutral-400">ASYMMETRIC R:R</div>
            <div className="text-lg font-black text-[#E8B84A] mt-0.5">{riskReward}:1</div>
            <div className="text-[10px] text-neutral-500">
              Exp Move: ${expectedMove?.toFixed(2) || '—'}
            </div>
          </div>
        </div>
      ) : (
        <div className="py-4 border-b border-white/10 font-mono text-xs text-neutral-400 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <strong className="text-neutral-200">NO TRADE (Selective Discipline):</strong> Smart Money confluence score was {totalScore}% (threshold 70%). Institutional rules require Gate (a) Order Block and Gate (d) CHoCH/BOS to both pass before deploying capital.
          </div>
        </div>
      )}

      {/* 7 Smart Money Gates Checklist */}
      <div className="py-4 border-b border-white/10 space-y-2.5">
        <div className="flex items-center justify-between font-mono text-xs text-neutral-400 pb-1">
          <span className="font-bold text-neutral-200">SMART MONEY GATES AUDIT (7 INSTITUTIONAL GATES)</span>
          <span>{gates.filter((g) => g.passed).length} OF {gates.length} PASSED</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {gates.map((gate) => (
            <div
              key={gate.id}
              className={`p-3 rounded-xl border font-mono text-xs flex items-start gap-3 transition-colors ${
                gate.passed
                  ? 'bg-emerald-950/20 border-emerald-500/20 text-neutral-200'
                  : 'bg-neutral-900/40 border-neutral-800 text-neutral-400'
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {gate.passed ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-white text-[11px] truncate">
                    Gate {gate.letter.toUpperCase()}: {gate.name}
                  </span>
                  <span
                    className={`text-[9px] px-1.5 py-0.2 rounded uppercase font-extrabold ${
                      gate.passed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {gate.passed ? 'PASS' : 'FAIL'} {gate.weight > 0 ? `(${gate.weight}%)` : ''}
                  </span>
                </div>
                <p className="text-[10px] text-neutral-400 mt-1 leading-relaxed">{gate.detail}</p>
                <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-white/5 text-[9px] text-neutral-500">
                  <span>METRIC: {gate.metric}</span>
                  <span>REQ: {gate.threshold}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reasons Summary */}
      <div className="pt-3 pb-2 font-mono text-xs space-y-1">
        <span className="text-[10px] text-neutral-500 uppercase tracking-wider block">SYNTHESIS & RATIONALE:</span>
        <ul className="space-y-1">
          {reasons.map((r, i) => (
            <li key={i} className="text-neutral-300 text-[11px] flex items-start gap-2">
              <span className="text-[#E8B84A] mt-0.5">•</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Compliance / Disclaimer Footer */}
      <div className="pt-3 border-t border-white/5 flex items-center justify-between font-mono text-[10px] text-neutral-500">
        <span>Signals only, not financial advice.</span>
        <span>ID: {result.id}</span>
      </div>
    </div>
  );
};
