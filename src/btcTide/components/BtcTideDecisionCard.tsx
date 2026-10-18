import React, { useState } from 'react';
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
  Layers,
  Flame,
  Scale,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Sliders,
} from 'lucide-react';

interface BtcTideDecisionCardProps {
  decision: DecisionEngineResult;
  status: BtcFeedStatus;
  currentPrice: number | null;
  defaultCollapsed?: boolean;
  isSpotStale?: boolean;
  spotAgeMs?: number;
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
  ({
    decision,
    status,
    defaultCollapsed = true,
    isSpotStale = false,
    spotAgeMs = 0,
  }) => {
    const [isBreakdownOpen, setIsBreakdownOpen] = useState(!defaultCollapsed);
    const isStaleOrOffline = isSpotStale || status === 'STALE' || status === 'OFFLINE';

    const {
      isSilent,
      isSpotDotGreen = status === 'LIVE' && spotAgeMs < 3000,
      secondsCollected,
      silenceRemainingSec,
      totalScore,
      bullishScore,
      bearishScore,
      confidence,
      lead,
      favoredSide,
      components,
      excludedComponents = [],
      excludedWeightSum = 0,
      activeComponentsCount = components.filter((c) => !c.excluded).length,
      isLimitedData = false,
      renormalisedFactor = 1,
      absorbDriveScore,
      absorbDriveAgrees,
      canFire,
      cooldownRemainingSec,
      waitReason,
    } = decision;

    const isLongFavored = totalScore > 0;
    const isShortFavored = totalScore < 0;
    const isWarmupSilent = secondsCollected < 180;
    const ageLabel =
      spotAgeMs > 0 && spotAgeMs < 999999
        ? `${(spotAgeMs / 1000).toFixed(1)}s`
        : '--';

    return (
      <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-3.5 sm:p-5 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)] space-y-3.5">
        {/* Header & Overall Decision Status */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pb-3 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#E8B84A]/10 border border-[#E8B84A]/30 flex items-center justify-center text-[#FFD97A] shrink-0">
              <Brain className="w-4 h-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                  8-COMPONENT DECISION ENGINE
                </span>
                <span className="font-mono text-[10px] text-[#FFD97A]">
                  · Backend Only
                </span>
                {isStaleOrOffline && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300">
                    STALE · {ageLabel}
                  </span>
                )}
              </div>
              <div className="font-mono text-[10px] text-neutral-400">
                Silent first 3m &amp; when SPOT dot not green (&lt;3s) · Score -100 to +100
              </div>
            </div>
          </div>

          {/* Engine Lifecycle Status */}
          {isWarmupSilent ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-yellow-950/70 border border-yellow-500/40 text-yellow-300 font-mono text-[11px] font-semibold">
              <Clock className="w-3.5 h-3.5 text-yellow-400 animate-spin shrink-0" />
              <span>
                SILENT WARMUP: {secondsCollected}/180s ({silenceRemainingSec}s left)
              </span>
            </div>
          ) : !isSpotDotGreen || isStaleOrOffline ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-950/70 border border-amber-500/40 text-amber-300 font-mono text-[11px] font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>SPOT DOT NOT GREEN ({ageLabel}) · SILENT</span>
            </div>
          ) : isLimitedData ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-950/80 border border-rose-500/50 text-rose-300 font-mono text-[11px] font-bold">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span>
                LIMITED DATA ({activeComponentsCount}/8 active · excluded wt {excludedWeightSum})
              </span>
            </div>
          ) : canFire ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 font-mono text-[11px] font-bold animate-pulse">
              <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>FIRING QUALIFIED: {favoredSide}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 border border-white/10 text-neutral-300 font-mono text-[11px] max-w-full">
              <ShieldCheck className="w-3.5 h-3.5 text-[#FFD97A] shrink-0" />
              <span className="truncate">{waitReason}</span>
            </div>
          )}
        </div>

        {/* Excluded PERPS Components & Re-Normalised / LIMITED DATA Notice */}
        {excludedComponents.length > 0 && (
          <div
            className={`rounded-lg px-3 py-2 font-mono text-[11px] flex flex-wrap items-center justify-between gap-2 ${
              isLimitedData
                ? 'bg-rose-950/35 border border-rose-500/40'
                : 'bg-amber-950/25 border border-amber-500/30'
            }`}
          >
            <div className="flex flex-wrap items-center gap-1.5 text-amber-200">
              <Sliders className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="font-bold uppercase text-amber-300">
                Excluded Unavailable PERPS ({excludedComponents.length}):
              </span>
              {excludedComponents.map((exc) => (
                <span
                  key={exc.id}
                  className="px-1.5 py-0.5 rounded bg-black/60 border border-amber-500/30 text-amber-200 text-[10px]"
                >
                  {exc.name} (wt {exc.baseWeight}→0: {exc.reason})
                </span>
              ))}
            </div>
            {isLimitedData ? (
              <span className="text-[10px] text-rose-300 font-bold uppercase">
                LIMITED DATA (Excluded wt {excludedWeightSum} &gt; 20 or &lt;6 active · Firing Blocked, Not Re-normalised)
              </span>
            ) : (
              <span className="text-[10px] text-[#FFD97A] font-semibold">
                Active weights re-normalised ×{renormalisedFactor.toFixed(2)} (Sum = 100)
              </span>
            )}
          </div>
        )}

        {/* Summary Metrics Row */}
        <div
          className={`grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono transition-opacity ${
            isStaleOrOffline ? 'opacity-60' : ''
          }`}
        >
          {/* Net Score */}
          <div className="bg-black/50 border border-white/5 rounded-lg p-2.5">
            <div className="text-[10px] text-neutral-400 uppercase flex items-center justify-between">
              <span>NET SCORE</span>
              <span className="text-neutral-500">
                {isStaleOrOffline ? `age ${ageLabel}` : '±100'}
              </span>
            </div>
            <div
              className={`text-xl font-black mt-0.5 flex items-baseline gap-1.5 ${
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
                <span className="text-[10px] font-bold uppercase text-neutral-400">
                  {isLongFavored ? 'BULL' : isShortFavored ? 'BEAR' : 'FLAT'}
                </span>
              )}
            </div>
            <div className="h-1.5 bg-neutral-900 rounded-full overflow-hidden flex mt-1.5 border border-white/5">
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

          {/* Confidence */}
          <div className="bg-black/50 border border-white/5 rounded-lg p-2.5">
            <div className="text-[10px] text-neutral-400 uppercase flex items-center justify-between">
              <span>CONFIDENCE</span>
              <span className={confidence >= 68 && !isStaleOrOffline ? 'text-teal-400' : 'text-neutral-500'}>
                {isStaleOrOffline ? `age ${ageLabel}` : '≥68%'}
              </span>
            </div>
            <div
              className={`text-xl font-black mt-0.5 flex items-baseline gap-1.5 ${
                isSilent || isStaleOrOffline ? 'text-neutral-500' : 'text-white'
              }`}
            >
              <span>{isSilent ? '--' : `${confidence.toFixed(0)}%`}</span>
              <span className="text-[10px] font-normal text-neutral-400">
                {favoredSide !== 'NEUTRAL' ? favoredSide : ''}
              </span>
            </div>
            <div className="h-1.5 bg-neutral-900 rounded-full overflow-hidden mt-1.5 border border-white/5">
              <div
                className={`h-full transition-all duration-300 ${
                  confidence >= 68 && !isStaleOrOffline ? 'bg-[#FFD97A]' : 'bg-neutral-600'
                }`}
                style={{ width: `${Math.min(100, confidence)}%` }}
              />
            </div>
          </div>

          {/* Lead */}
          <div className="bg-black/50 border border-white/5 rounded-lg p-2.5">
            <div className="text-[10px] text-neutral-400 uppercase flex items-center justify-between">
              <span>SIDE LEAD</span>
              <span className={lead >= 22 && !isStaleOrOffline ? 'text-teal-400' : 'text-neutral-500'}>
                {isStaleOrOffline ? `age ${ageLabel}` : '≥22%'}
              </span>
            </div>
            <div
              className={`text-xl font-black mt-0.5 flex items-baseline gap-1.5 ${
                isSilent || isStaleOrOffline ? 'text-neutral-500' : 'text-white'
              }`}
            >
              <span>{isSilent ? '--' : `+${lead.toFixed(0)}%`}</span>
              <span className="text-[10px] font-normal text-neutral-400">MARGIN</span>
            </div>
            <div className="h-1.5 bg-neutral-900 rounded-full overflow-hidden mt-1.5 border border-white/5">
              <div
                className={`h-full transition-all duration-300 ${
                  lead >= 22 && !isStaleOrOffline ? 'bg-teal-400' : 'bg-neutral-600'
                }`}
                style={{ width: `${Math.min(100, (lead / 50) * 100)}%` }}
              />
            </div>
          </div>

          {/* Cooldown */}
          <div className="bg-black/50 border border-white/5 rounded-lg p-2.5">
            <div className="text-[10px] text-neutral-400 uppercase flex items-center justify-between">
              <span>COOLDOWN</span>
              <Clock className="w-3 h-3 text-[#FFD97A]" />
            </div>
            <div className="text-xs sm:text-sm font-bold text-white mt-1.5">
              {cooldownRemainingSec > 0 ? (
                <span className="text-amber-400">
                  {Math.floor(cooldownRemainingSec / 60)}m {cooldownRemainingSec % 60}s
                </span>
              ) : (
                <span className={isStaleOrOffline ? 'text-neutral-500' : 'text-teal-400'}>
                  Ready (Clear)
                </span>
              )}
            </div>
            <div className="text-[10px] text-neutral-400 mt-1">
              1H ATR Setup · 1.5h Cooldown
            </div>
          </div>
        </div>

        {/* Collapsible Toggle for 8-Component Breakdown & Firing Gates */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setIsBreakdownOpen((prev) => !prev)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 font-mono text-xs text-neutral-200 transition-colors cursor-pointer"
          >
            <span className="font-bold uppercase tracking-wider text-[11px] flex flex-wrap items-center gap-2">
              <span>8-Component Breakdown &amp; Firing Gates</span>
              <span className="text-[10px] font-normal text-neutral-400">
                ({components.filter((c) => !c.excluded).length}/8 included
                {excludedComponents.length > 0
                  ? isLimitedData
                    ? ` · ${excludedComponents.length} excluded · LIMITED DATA`
                    : ` · ${excludedComponents.length} excluded & re-normalised`
                  : ''}
                )
              </span>
            </span>
            <span className="flex items-center gap-1 text-[11px] text-[#FFD97A] font-semibold shrink-0">
              <span>{isBreakdownOpen ? 'Hide' : 'Expand'}</span>
              {isBreakdownOpen ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </span>
          </button>

          {isBreakdownOpen && (
            <div className="mt-3 space-y-3 animate-fadeIn">
              {/* Firing Gate Conditions Checklist */}
              <div className="bg-black/30 border border-white/5 rounded-lg p-3 font-mono text-xs">
                <div className="text-[10px] text-neutral-400 uppercase tracking-wider mb-2 font-bold">
                  SIGNAL FIRING GATES (ALL REQUIRED)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    {isSpotDotGreen ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    )}
                    <span className={isSpotDotGreen ? 'text-neutral-200' : 'text-amber-300'}>
                      SPOT Green (&lt;3s)
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {!isWarmupSilent ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    )}
                    <span className={!isWarmupSilent ? 'text-neutral-200' : 'text-neutral-400'}>
                      3m Data ({secondsCollected}/180s)
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {confidence >= 68 && !isSilent ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                    )}
                    <span className={confidence >= 68 && !isSilent ? 'text-teal-300 font-semibold' : 'text-neutral-400'}>
                      Conf &ge; 68 ({confidence.toFixed(0)}%)
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {lead >= 22 && !isSilent ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                    )}
                    <span className={lead >= 22 && !isSilent ? 'text-teal-300 font-semibold' : 'text-neutral-400'}>
                      Lead &ge; 22 (+{lead.toFixed(0)}%)
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {absorbDriveAgrees && !isSilent ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                    )}
                    <span className={absorbDriveAgrees && !isSilent ? 'text-teal-300 font-semibold' : 'text-neutral-400'}>
                      Absorb/Drive ({absorbDriveScore > 0 ? '+BUY' : absorbDriveScore < 0 ? '-SELL' : '0'})
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {cooldownRemainingSec === 0 ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    )}
                    <span className={cooldownRemainingSec === 0 ? 'text-neutral-200' : 'text-amber-400'}>
                      Cooldown {cooldownRemainingSec === 0 ? 'Clear' : `(${cooldownRemainingSec}s)`}
                    </span>
                  </div>
                </div>
              </div>

              {/* 8 Components Detailed Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 font-mono text-xs">
                {components.map((comp) => {
                  const isExcluded = Boolean(comp.excluded);
                  const isBull = !isExcluded && comp.score > 0;
                  const isBear = !isExcluded && comp.score < 0;
                  const absScore = Math.abs(comp.score);
                  const pct =
                    !isExcluded && comp.weight > 0
                      ? Math.min(100, (absScore / comp.weight) * 100)
                      : 0;
                  const baseWt = comp.baseWeight ?? comp.weight;
                  const isRenorm = !isExcluded && Math.abs(comp.weight - baseWt) >= 0.1;

                  return (
                    <div
                      key={comp.id}
                      className={`rounded-lg p-2.5 border transition-colors flex flex-col justify-between space-y-2 ${
                        isExcluded
                          ? 'bg-neutral-950/60 border-neutral-800/80 opacity-60'
                          : 'bg-black/40 border-white/5 hover:border-white/10'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1 text-[11px]">
                          <div className="flex items-center gap-1.5 font-bold text-white truncate">
                            {componentIcons[comp.id]}
                            <span className={isExcluded ? 'text-neutral-500 line-through' : ' truncate'}>
                              {comp.name}
                            </span>
                          </div>
                          {isExcluded ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-500/30 text-amber-300 font-bold shrink-0">
                              EXCLUDED ({baseWt}→0)
                            </span>
                          ) : (
                            <span className="text-[10px] text-neutral-400 font-semibold shrink-0">
                              WT: {isRenorm ? `${baseWt}→${comp.weight}` : comp.weight}
                            </span>
                          )}
                        </div>

                        <div className="flex items-baseline justify-between mt-1">
                          <span className="text-[11px] text-neutral-300 truncate max-w-[165px]">
                            {comp.rawMetric}
                          </span>
                          <span
                            className={`text-sm font-black ${
                              isExcluded || isStaleOrOffline
                                ? 'text-neutral-500'
                                : isBull
                                ? 'text-teal-400'
                                : isBear
                                ? 'text-rose-400'
                                : 'text-neutral-500'
                            }`}
                          >
                            {isExcluded ? 'EXCL' : isBull ? `+${comp.score}` : comp.score}
                          </span>
                        </div>
                      </div>

                      <div>
                        <div className="h-1 bg-neutral-900 rounded-full overflow-hidden flex">
                          <div
                            className={`h-full transition-all duration-300 ${
                              isExcluded || isStaleOrOffline
                                ? 'bg-neutral-700'
                                : isBull
                                ? 'bg-teal-500'
                                : isBear
                                ? 'bg-rose-500'
                                : 'bg-neutral-700'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="text-[9px] text-neutral-500 mt-1 truncate">
                          {isExcluded ? comp.excludeReason || 'Unavailable — excluded' : comp.explanation}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);

BtcTideDecisionCard.displayName = 'BtcTideDecisionCard';
