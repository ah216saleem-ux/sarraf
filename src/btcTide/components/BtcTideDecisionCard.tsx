import React from 'react';
import { DecisionEngineResult } from '../signalEngine';
import { BtcFeedStatus } from '../types';
import {
  Brain,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Compass,
  Zap,
  TrendingUp,
  TrendingDown,
  Layers,
  Flame,
  Scale,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

interface BtcTideDecisionCardProps {
  decision: DecisionEngineResult;
  status: BtcFeedStatus;
  currentPrice: number | null;
}

const componentIcons: Record<string, React.ReactNode> = {
  delta_flow: <Zap className="w-3.5 h-3.5 text-teal-400" />,
  cvd_divergence: <TrendingUp className="w-3.5 h-3.5 text-blue-400" />,
  absorb_drive: <Flame className="w-3.5 h-3.5 text-[#FFD97A]" />,
  order_book_imbalance: <Layers className="w-3.5 h-3.5 text-purple-400" />,
  oi_price_direction: <Compass className="w-3.5 h-3.5 text-emerald-400" />,
  funding_rate: <Scale className="w-3.5 h-3.5 text-amber-400" />,
  liquidations: <Flame className="w-3.5 h-3.5 text-rose-400" />,
  perp_basis: <Clock className="w-3.5 h-3.5 text-cyan-400" />,
};

export const BtcTideDecisionCard: React.FC<BtcTideDecisionCardProps> = React.memo(
  ({ decision, status, currentPrice }) => {
    const isStaleOrOffline = status === 'STALE' || status === 'OFFLINE';

    const {
      isSilent,
      secondsCollected,
      silenceRemainingSec,
      totalScore,
      bullishScore,
      bearishScore,
      confidence,
      lead,
      favoredSide,
      components,
      absorbDriveScore,
      absorbDriveAgrees,
      canFire,
      cooldownRemainingSec,
      waitReason,
    } = decision;

    const isLongFavored = totalScore > 0;
    const isShortFavored = totalScore < 0;

    return (
      <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 sm:p-5 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)] space-y-4">
        {/* Header & Overall Decision Gauge */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#E8B84A]/10 border border-[#E8B84A]/30 flex items-center justify-center text-[#FFD97A]">
              <Brain className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                  8-COMPONENT LIVE DECISION ENGINE
                </span>
                <span className="font-mono text-[10px] px-2 py-0.2 rounded bg-white/5 border border-white/10 text-[#FFD97A]">
                  1-SEC REAL TICKS
                </span>
              </div>
              <div className="font-mono text-[11px] text-neutral-400">
                Weighted composite scoring from -100 (Max Bearish) to +100 (Max Bullish)
              </div>
            </div>
          </div>

          {/* Engine Lifecycle Badge */}
          {isSilent ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-950/70 border border-yellow-500/40 text-yellow-300 font-mono text-xs font-semibold">
              <Clock className="w-3.5 h-3.5 text-yellow-400 animate-spin" />
              <span>
                SILENT (3-MIN WARMUP: {secondsCollected}/180s · {silenceRemainingSec}s left)
              </span>
            </div>
          ) : isStaleOrOffline ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/70 border border-rose-500/40 text-rose-300 font-mono text-xs font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              <span>ENGINE PAUSED ({status})</span>
            </div>
          ) : canFire ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 font-mono text-xs font-bold animate-pulse shadow-[0_0_15px_rgba(16,185,129,0.3)]">
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span>FIRING QUALIFIED: {favoredSide}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/60 border border-white/10 text-neutral-300 font-mono text-xs">
              <ShieldCheck className="w-3.5 h-3.5 text-[#FFD97A]" />
              <span className="truncate max-w-[280px] sm:max-w-none">{waitReason}</span>
            </div>
          )}
        </div>

        {/* Primary Scores & Confidence Gauges */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 font-mono">
          {/* Total Net Score (-100 to +100) */}
          <div className="bg-black/50 border border-white/5 rounded-lg p-3">
            <div className="text-[10px] text-neutral-400 uppercase flex items-center justify-between">
              <span>NET COMPOSITE SCORE</span>
              <span className="text-neutral-500">SCALE: &plusmn;100</span>
            </div>
            <div
              className={`text-2xl font-black mt-1 flex items-baseline gap-1.5 ${
                isSilent || isStaleOrOffline
                  ? 'text-neutral-500'
                  : isLongFavored
                  ? 'text-teal-400'
                  : isShortFavored
                  ? 'text-rose-400'
                  : 'text-neutral-300'
              }`}
            >
              <span>{isSilent ? '--' : `${totalScore > 0 ? '+' : ''}${totalScore}`}</span>
              {!isSilent && (
                <span className="text-xs font-bold uppercase text-neutral-400">
                  {isLongFavored ? 'BULL' : isShortFavored ? 'BEAR' : 'NEUTRAL'}
                </span>
              )}
            </div>
            {/* Split Bar */}
            <div className="h-1.5 bg-neutral-900 rounded-full overflow-hidden flex mt-2 border border-white/5">
              <div
                className="h-full bg-teal-500 transition-all duration-300"
                style={{ width: `${Math.max(0, Math.min(100, (bullishScore / 100) * 100))}%` }}
              />
              <div
                className="h-full bg-rose-500 transition-all duration-300"
                style={{ width: `${Math.max(0, Math.min(100, (bearishScore / 100) * 100))}%` }}
              />
            </div>
          </div>

          {/* Confidence (0 to 100, min 68 required) */}
          <div className="bg-black/50 border border-white/5 rounded-lg p-3">
            <div className="text-[10px] text-neutral-400 uppercase flex items-center justify-between">
              <span>CONFIDENCE</span>
              <span className={confidence >= 68 ? 'text-teal-400' : 'text-neutral-500'}>
                REQ &ge; 68
              </span>
            </div>
            <div className="text-2xl font-black text-white mt-1 flex items-baseline gap-1.5">
              <span>{isSilent ? '--' : `${confidence.toFixed(0)}%`}</span>
              <span className="text-xs font-normal text-neutral-400">
                {favoredSide !== 'NEUTRAL' ? favoredSide : ''}
              </span>
            </div>
            <div className="h-1.5 bg-neutral-900 rounded-full overflow-hidden mt-2 border border-white/5">
              <div
                className={`h-full transition-all duration-300 ${
                  confidence >= 68 ? 'bg-[#FFD97A]' : 'bg-neutral-600'
                }`}
                style={{ width: `${Math.min(100, confidence)}%` }}
              />
            </div>
          </div>

          {/* Lead Over Opposite Side (min 22 required) */}
          <div className="bg-black/50 border border-white/5 rounded-lg p-3">
            <div className="text-[10px] text-neutral-400 uppercase flex items-center justify-between">
              <span>LEAD OVER OPPOSITE</span>
              <span className={lead >= 22 ? 'text-teal-400' : 'text-neutral-500'}>
                REQ &ge; 22
              </span>
            </div>
            <div className="text-2xl font-black text-white mt-1 flex items-baseline gap-1.5">
              <span>{isSilent ? '--' : `+${lead.toFixed(0)}%`}</span>
              <span className="text-xs font-normal text-neutral-400">MARGIN</span>
            </div>
            <div className="h-1.5 bg-neutral-900 rounded-full overflow-hidden mt-2 border border-white/5">
              <div
                className={`h-full transition-all duration-300 ${
                  lead >= 22 ? 'bg-teal-400' : 'bg-neutral-600'
                }`}
                style={{ width: `${Math.min(100, (lead / 50) * 100)}%` }}
              />
            </div>
          </div>

          {/* 30-Min Cooldown & 15-Min Expiry */}
          <div className="bg-black/50 border border-white/5 rounded-lg p-3">
            <div className="text-[10px] text-neutral-400 uppercase flex items-center justify-between">
              <span>COOLDOWN &amp; EXPIRY</span>
              <Clock className="w-3 h-3 text-[#FFD97A]" />
            </div>
            <div className="text-sm font-bold text-white mt-1.5">
              {cooldownRemainingSec > 0 ? (
                <span className="text-amber-400">
                  {Math.floor(cooldownRemainingSec / 60)}m {cooldownRemainingSec % 60}s Cooldown
                </span>
              ) : (
                <span className="text-teal-400">Cooldown Clear (Ready)</span>
              )}
            </div>
            <div className="text-[11px] text-neutral-400 mt-1">
              Expiry: 15 min · Cooldown: 30 min
            </div>
          </div>
        </div>

        {/* Firing Gate Conditions Checklist */}
        <div className="bg-black/30 border border-white/5 rounded-lg p-3 font-mono text-xs">
          <div className="text-[10px] text-neutral-400 uppercase tracking-wider mb-2 font-bold">
            SIGNAL FIRING GATES (ALL 5 REQUIRED)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-[11px]">
            {/* Gate 1: Warmup */}
            <div className="flex items-center gap-1.5">
              {!isSilent ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
              <span className={!isSilent ? 'text-neutral-200' : 'text-neutral-400'}>
                3m Live Data ({secondsCollected}/180s)
              </span>
            </div>

            {/* Gate 2: Confidence >= 68 */}
            <div className="flex items-center gap-1.5">
              {confidence >= 68 ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              )}
              <span className={confidence >= 68 ? 'text-teal-300 font-semibold' : 'text-neutral-400'}>
                Confidence &ge; 68 ({confidence.toFixed(0)}%)
              </span>
            </div>

            {/* Gate 3: Lead >= 22 */}
            <div className="flex items-center gap-1.5">
              {lead >= 22 ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              )}
              <span className={lead >= 22 ? 'text-teal-300 font-semibold' : 'text-neutral-400'}>
                Lead &ge; 22 (+{lead.toFixed(0)}%)
              </span>
            </div>

            {/* Gate 4: Absorb/Drive Agrees */}
            <div className="flex items-center gap-1.5">
              {absorbDriveAgrees ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              )}
              <span className={absorbDriveAgrees ? 'text-teal-300 font-semibold' : 'text-neutral-400'}>
                Absorb/Drive Agrees ({absorbDriveScore > 0 ? '+BUY' : absorbDriveScore < 0 ? '-SELL' : '0'})
              </span>
            </div>

            {/* Gate 5: Cooldown Clear */}
            <div className="flex items-center gap-1.5">
              {cooldownRemainingSec === 0 ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
              ) : (
                <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
              <span className={cooldownRemainingSec === 0 ? 'text-neutral-200' : 'text-amber-400'}>
                30m Cooldown {cooldownRemainingSec === 0 ? 'Clear' : `(${cooldownRemainingSec}s)`}
              </span>
            </div>
          </div>
        </div>

        {/* 8 Components Detailed Contributions Grid */}
        <div>
          <div className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider mb-2 font-bold flex items-center justify-between">
            <span>8 WEIGHTED COMPONENTS &amp; REAL CONTRIBUTIONS</span>
            <span>TOTAL WEIGHT: 100 PTS</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 font-mono text-xs">
            {components.map((comp) => {
              const isBull = comp.score > 0;
              const isBear = comp.score < 0;
              const absScore = Math.abs(comp.score);
              const pct = (absScore / comp.weight) * 100;

              return (
                <div
                  key={comp.id}
                  className="bg-black/40 border border-white/5 rounded-lg p-2.5 hover:border-white/10 transition-colors flex flex-col justify-between space-y-2"
                >
                  <div>
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-1.5 font-bold text-white">
                        {componentIcons[comp.id]}
                        <span>{comp.name}</span>
                      </div>
                      <span className="text-[10px] text-neutral-500 font-semibold">
                        WT: {comp.weight}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between mt-1">
                      <span className="text-[11px] text-neutral-300 truncate max-w-[150px]">
                        {comp.rawMetric}
                      </span>
                      <span
                        className={`text-sm font-black ${
                          isBull
                            ? 'text-teal-400'
                            : isBear
                            ? 'text-rose-400'
                            : 'text-neutral-500'
                        }`}
                      >
                        {isBull ? `+${comp.score}` : comp.score}
                      </span>
                    </div>
                  </div>

                  {/* Progress bar showing magnitude toward weight */}
                  <div>
                    <div className="h-1 bg-neutral-900 rounded-full overflow-hidden flex">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isBull ? 'bg-teal-500' : isBear ? 'bg-rose-500' : 'bg-neutral-700'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-[9px] text-neutral-500 mt-1 truncate">
                      {comp.explanation}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
);

BtcTideDecisionCard.displayName = 'BtcTideDecisionCard';
