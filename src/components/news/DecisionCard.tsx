import React from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { UnifiedNewsDecision, ChipSentiment } from './decisionTypes';

interface DecisionCardProps {
  decision: UnifiedNewsDecision;
  isNextEvent?: boolean;
  onSelectNextNews?: () => void;
  countdownText?: string;
}

export const DecisionCard: React.FC<DecisionCardProps> = ({
  decision,
  isNextEvent = true,
  onSelectNextNews,
  countdownText,
}) => {
  // Map dialScore (-100 to +100) to needle rotation angle [-75deg to +75deg]
  const needleAngle = Math.max(-75, Math.min(75, (decision.dialScore / 100) * 75));

  const verdictColorClass =
    decision.verdict === 'BULLISH'
      ? 'text-emerald-400'
      : decision.verdict === 'BEARISH'
      ? 'text-rose-400'
      : decision.verdict === 'WAIT'
      ? 'text-amber-400'
      : 'text-neutral-400';

  const confidenceBarColor =
    decision.verdict === 'BULLISH'
      ? 'bg-emerald-400'
      : decision.verdict === 'BEARISH'
      ? 'bg-rose-400'
      : decision.verdict === 'WAIT'
      ? 'bg-amber-400'
      : 'bg-neutral-500';

  const renderChipStyle = (sentiment: ChipSentiment) => {
    switch (sentiment) {
      case 'BULLISH':
        return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300';
      case 'BEARISH':
        return 'bg-rose-500/10 border-rose-500/30 text-rose-300';
      case 'NEUTRAL':
        return 'bg-white/5 border-white/10 text-neutral-300';
      case 'NO_DATA':
      default:
        return 'bg-white/[0.03] border-white/5 text-neutral-500 italic';
    }
  };

  const stageBadgeStyle = () => {
    switch (decision.stage) {
      case 'CONFIRMED':
        return 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300';
      case 'PROVISIONAL':
        return 'bg-amber-500/15 border-amber-500/40 text-amber-300';
      case 'MIXED':
        return 'bg-rose-500/15 border-rose-500/40 text-rose-300';
      case 'PRE-NEWS LEAN':
      default:
        return 'bg-white/5 border-white/10 text-neutral-400';
    }
  };

  return (
    <div className="w-full p-4 sm:p-5 rounded-2xl border border-white/10 bg-gradient-to-b from-black/80 to-black/60 shadow-[0_4px_24px_rgba(0,0,0,0.4)] backdrop-blur-md space-y-3.5 transition-all">
      {/* Top Header: Title, Stage & Next News Button */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[11px] font-bold text-[#FFD97A] uppercase tracking-wider flex items-center gap-1.5 shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-[#FFD97A]" />
            DECISION
          </span>
          <span className="text-neutral-500 text-xs shrink-0">·</span>
          <h3 className="text-xs sm:text-sm font-bold text-white truncate" title={decision.eventTitle}>
            {decision.eventTitle}
          </h3>
          {isNextEvent ? (
            <span className="hidden sm:inline-flex px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-[#E8B84A]/15 text-[#FFD97A] border border-[#E8B84A]/30">
              NEXT KEY CATALYST
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {countdownText && (
            <span className="text-[11px] font-mono font-bold text-neutral-400">
              {countdownText}
            </span>
          )}

          {!isNextEvent && onSelectNextNews && (
            <button
              onClick={onSelectNextNews}
              className="px-2 py-1 rounded-lg bg-[#E8B84A]/15 hover:bg-[#E8B84A]/25 border border-[#E8B84A]/40 text-[#FFD97A] text-[10px] font-mono font-bold tracking-wider transition-colors flex items-center gap-1 cursor-pointer active:scale-95"
              title="Return to Next Upcoming News"
            >
              <RotateCcw className="w-3 h-3 text-[#FFD97A]" />
              <span>NEXT NEWS</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Core: Dial (max 124px wide) + Verdict + Confidence */}
      <div className="flex items-center gap-4 sm:gap-6 flex-wrap sm:flex-nowrap">
        {/* Compact Dial: Max 124px wide semicircle */}
        <div className="shrink-0 flex flex-col items-center justify-center relative w-[120px] select-none">
          <svg
            viewBox="0 0 120 66"
            className="w-[120px] h-[66px] overflow-visible"
            aria-label={`Decision dial indicating ${decision.verdict}`}
          >
            <defs>
              <linearGradient id="decisionDialGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ef4444" />
                <stop offset="35%" stopColor="#ef4444" />
                <stop offset="50%" stopColor="#71717a" />
                <stop offset="65%" stopColor="#22c55e" />
                <stop offset="100%" stopColor="#22c55e" />
              </linearGradient>
              <filter id="dialGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Background Arc */}
            <path
              d="M 12 58 A 48 48 0 0 1 108 58"
              fill="none"
              stroke="rgba(255, 255, 255, 0.08)"
              strokeWidth="8"
              strokeLinecap="round"
            />

            {/* Colored Dial Arc: Red -> Grey -> Green */}
            <path
              d="M 12 58 A 48 48 0 0 1 108 58"
              fill="none"
              stroke="url(#decisionDialGradient)"
              strokeWidth="8"
              strokeLinecap="round"
              filter="url(#dialGlow)"
            />

            {/* Center tick indicator */}
            <line x1="60" y1="10" x2="60" y2="15" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />

            {/* Animated Needle */}
            <g
              style={{
                transformOrigin: '60px 58px',
                transform: `rotate(${needleAngle}deg)`,
                transition: 'transform 600ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              <line
                x1="60"
                y1="58"
                x2="60"
                y2="16"
                stroke="#FFD97A"
                strokeWidth="2.5"
                strokeLinecap="round"
                filter="url(#dialGlow)"
              />
              <circle cx="60" cy="16" r="2.5" fill="#FFFFFF" />
            </g>

            {/* Center Pivot Pin */}
            <circle cx="60" cy="58" r="4.5" fill="#FFD97A" />
            <circle cx="60" cy="58" r="2" fill="#0A0A0A" />
          </svg>

          {/* Sub-label for dial bounds */}
          <div className="w-full flex justify-between text-[9px] font-mono text-neutral-500 px-1 -mt-1">
            <span>BEAR</span>
            <span>WAIT</span>
            <span>BULL</span>
          </div>
        </div>

        {/* Verdict & Confidence Column */}
        <div className="flex-1 min-w-[160px] space-y-1.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className={`text-[22px] font-bold font-sans tracking-wide leading-none ${verdictColorClass}`}>
              {decision.verdict}
            </span>

            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider border ${stageBadgeStyle()}`}
            >
              {decision.stage}
            </span>
          </div>

          {/* Confidence row and thin bar */}
          <div className="space-y-1 pt-0.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-neutral-400">
                Confidence{decision.confidenceStatus === 'calibrating' ? ' (calibrating)' : ''}
              </span>
              <span className="text-white font-bold">{decision.confidence}%</span>
            </div>

            <div className="w-full max-w-[200px] h-[3px] bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${confidenceBarColor}`}
                style={{ width: `${Math.min(100, Math.max(0, decision.confidence))}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Short Sentence of Reason */}
      {decision.headlineReason && (
        <p className="text-xs text-neutral-300 leading-relaxed font-sans pt-0.5">
          {decision.headlineReason}
        </p>
      )}

      {/* Reason Chips (Forecast, Gold 4h, Dollar, US10Y, History, Prediction market, AHMED AI) */}
      {decision.chips && decision.chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {decision.chips.map((chip) => (
            <span
              key={chip.id}
              className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-mono font-medium border transition-colors ${renderChipStyle(
                chip.sentiment
              )}`}
              title={`${chip.label} (${chip.sentiment})`}
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
