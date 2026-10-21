import React from 'react';
import { RotateCcw, TrendingUp, TrendingDown, Minus, Clock, ShieldAlert } from 'lucide-react';
import { UnifiedDecision } from '../server/unifiedNewsDecision';

interface NewsDecisionCardProps {
  decision: UnifiedDecision;
  eventTitle: string;
  eventCountry: string;
  eventTimeUtc: string;
  minutesUntil: number;
  isInsideLockWindow?: boolean;
  isCustomSelected: boolean;
  onResetToNext?: () => void;
}

export const NewsDecisionCard: React.FC<NewsDecisionCardProps> = ({
  decision,
  eventTitle,
  eventCountry,
  eventTimeUtc,
  minutesUntil,
  isInsideLockWindow = false,
  isCustomSelected,
  onResetToNext,
}) => {
  const { verdict, confidence, stageLabel, reasonSentence, chips, dialAngle } = decision;

  // Format event time concisely in UTC
  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        hour12: false,
      }) + ' UTC';
    } catch {
      return iso;
    }
  };

  // Format countdown string
  const formatCountdown = (mins: number) => {
    if (mins < -60) return `${Math.abs(Math.round(mins / 60))}h ago`;
    if (mins < 0) return `${Math.abs(mins)}m ago`;
    if (mins === 0) return 'NOW';
    if (mins < 60) return `in ${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h < 24) return `in ${h}h ${m}m`;
    const d = Math.floor(h / 24);
    return `in ${d}d ${h % 24}h`;
  };

  const isBull = verdict === 'BULLISH';
  const isBear = verdict === 'BEARISH';
  const isWait = verdict === 'WAIT';
  const isSkip = verdict === 'SKIP';

  const verdictColor = isBull
    ? 'text-emerald-400'
    : isBear
    ? 'text-rose-400'
    : isWait
    ? 'text-zinc-200'
    : 'text-neutral-500';

  const barColor = isBull
    ? 'bg-emerald-500'
    : isBear
    ? 'bg-rose-500'
    : isWait
    ? 'bg-zinc-400'
    : 'bg-neutral-600';

  const stageTagStyle =
    stageLabel === 'CONFIRMED'
      ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
      : stageLabel === 'PROVISIONAL'
      ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
      : stageLabel === 'MIXED'
      ? 'text-zinc-300 border-zinc-500/40 bg-zinc-800'
      : 'text-[#FFD97A] border-[#E8B84A]/30 bg-[#E8B84A]/10';

  return (
    <div
      id="news-decision-card"
      className="p-3.5 sm:p-4 rounded-xl border border-white/10 bg-[#0A0D12]/90 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)] space-y-3 transition-all"
    >
      {/* Top Bar: Event Name, Countdown & NEXT NEWS Button */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/5 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-[#E8B84A] shrink-0" />
          <h3 className="text-xs sm:text-sm font-bold text-white font-['Sora'] truncate tracking-tight">
            {eventTitle}
          </h3>
          <span className="text-[10px] text-neutral-400 font-mono shrink-0">
            • {eventCountry}
          </span>
          {isInsideLockWindow && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/15 border border-amber-500/30 text-amber-300 shrink-0">
              <ShieldAlert className="w-2.5 h-2.5" />
              PAUSE
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 text-[11px] font-mono text-neutral-400">
            <Clock className="w-3 h-3 text-neutral-500" />
            <span>{formatTime(eventTimeUtc)}</span>
            <span className="text-[#FFD97A] font-semibold">({formatCountdown(minutesUntil)})</span>
          </div>

          {/* NEXT NEWS Button: Returns view to upcoming next event if user tapped a timeline row */}
          {isCustomSelected && onResetToNext && (
            <button
              onClick={onResetToNext}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#E8B84A]/15 hover:bg-[#E8B84A]/25 border border-[#E8B84A]/40 text-[#FFD97A] text-[10px] font-bold font-mono transition-colors cursor-pointer"
              title="Return to Next Upcoming Catalyst"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              <span>NEXT NEWS</span>
            </button>
          )}
        </div>
      </div>

      {/* Middle Row: Compact Dial (max 124px wide semicircle) + Verdict & Confidence */}
      <div className="flex items-center gap-3 sm:gap-6 flex-wrap sm:flex-nowrap">
        {/* COMPACT DIAL (Max 124px wide) */}
        <div className="shrink-0 flex flex-col items-center select-none">
          <svg
            width="120"
            height="64"
            viewBox="0 0 120 64"
            className="overflow-visible"
            aria-label={`Decision dial indicating ${verdict}`}
          >
            <defs>
              <linearGradient id="decisionDialGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#EF4444" />
                <stop offset="25%" stopColor="#F87171" />
                <stop offset="50%" stopColor="#71717A" />
                <stop offset="75%" stopColor="#34D399" />
                <stop offset="100%" stopColor="#10B981" />
              </linearGradient>
            </defs>

            {/* Background Arc Track */}
            <path
              d="M 14 58 A 46 46 0 0 1 106 58"
              fill="none"
              stroke="#27272A"
              strokeWidth="7"
              strokeLinecap="round"
            />

            {/* Gradient Colored Arc */}
            <path
              d="M 14 58 A 46 46 0 0 1 106 58"
              fill="none"
              stroke="url(#decisionDialGradient)"
              strokeWidth="5"
              strokeLinecap="round"
              opacity={isSkip ? 0.35 : 0.95}
            />

            {/* Dial Labels */}
            <text x="14" y="62" textAnchor="middle" className="text-[7.5px] fill-rose-400 font-mono font-bold">
              BEAR
            </text>
            <text x="60" y="10" textAnchor="middle" className="text-[7.5px] fill-neutral-400 font-mono font-semibold">
              WAIT
            </text>
            <text x="106" y="62" textAnchor="middle" className="text-[7.5px] fill-emerald-400 font-mono font-bold">
              BULL
            </text>

            {/* Sleek Animated Needle */}
            <g
              style={{
                transform: `rotate(${dialAngle}deg)`,
                transformOrigin: '60px 58px',
                transition: 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              {/* Tapered needle */}
              <polygon
                points="58.8,58 59.6,18 60.4,18 61.2,58"
                fill="#FAFAFA"
                opacity={isSkip ? 0.4 : 1}
              />
              <polygon points="59.7,18 60,14 60.3,18" fill="#E8B84A" />
            </g>

            {/* Center Pivot Dot */}
            <circle cx="60" cy="58" r="4.5" fill="#E8B84A" stroke="#0A0D12" strokeWidth="1.5" />
            <circle cx="60" cy="58" r="1.5" fill="#0A0D12" />
          </svg>
        </div>

        {/* VERDICT, CONFIDENCE & STAGE */}
        <div className="flex-1 min-w-[160px] space-y-1">
          <div className="flex items-center gap-2">
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border uppercase tracking-wider ${stageTagStyle}`}
            >
              {stageLabel}
            </span>
          </div>

          <div className="flex items-baseline gap-2.5">
            <h2 className={`text-[22px] font-bold font-['Sora'] tracking-tight leading-none ${verdictColor}`}>
              {verdict}
            </h2>
            <span className="text-xs font-mono text-neutral-300">
              {isSkip ? 'No Lean' : isWait ? '-' : ((decision as any)?.confidenceDisplay ? (decision as any).confidenceDisplay : `${confidence}% confidence`)}
            </span>
          </div>

          {/* Thin Confidence Bar */}
          {!isSkip && (
            <div className="w-full max-w-[160px] h-[3px] bg-white/10 rounded-full overflow-hidden mt-1.5">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                style={{ width: `${isWait ? 0 : confidence}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Bottom: One short sentence of reason */}
      <div className="space-y-2 pt-1 border-t border-white/5">
        <p className="text-xs text-neutral-200 font-['Sora'] leading-relaxed">
          {reasonSentence}
        </p>

        {/* 4-5 Small Reason Chips: Forecast, Gold 4h, Dollar, US10Y, History, Prediction Market, AHMED AI */}
        {chips.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {chips.map((chip) => {
              const isChipBull = chip.sentiment === 'BULLISH';
              const isChipBear = chip.sentiment === 'BEARISH';
              const chipStyle = isChipBull
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : isChipBear
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-white/5 border-white/10 text-neutral-400';

              return (
                <span
                  key={chip.id}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-mono font-medium border ${chipStyle}`}
                >
                  {isChipBull ? (
                    <TrendingUp className="w-2.5 h-2.5 shrink-0" />
                  ) : isChipBear ? (
                    <TrendingDown className="w-2.5 h-2.5 shrink-0" />
                  ) : (
                    <Minus className="w-2.5 h-2.5 shrink-0" />
                  )}
                  <span>{chip.label}</span>
                </span>
              );
            })}
          </div>
        ) : (
          <div className="text-[10px] text-neutral-500 font-mono italic">
            no data
          </div>
        )}
      </div>
    </div>
  );
};
