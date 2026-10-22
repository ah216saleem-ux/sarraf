import React, { useState } from 'react';
import { UnifiedNewsDecision, ReasonChipItem } from './decisionTypes';

export interface DecisionCardProps {
  decision: UnifiedNewsDecision;
  theme?: 'dark' | 'light';
  completedReleasesCount?: number;
  backtestLabel?: string;
  hasForecast?: boolean;
  forecastLean?: 'BULLISH' | 'BEARISH' | 'FLAT' | null;
  hasActual?: boolean;
  actualDisplayLine?: string | null;
}

const ALLOWED_CHIP_IDS = new Set([
  'forecast',
  'gold_trend',
  'gold4h',
  'dollar_proxy',
  'dollar',
  'us10y',
  'prediction_market',
  'prediction',
  'actual_surprise',
  'gold_reaction',
]);

function formatChipShortLabel(chip: ReasonChipItem): string {
  // Strip verbose " weight XX%" suffix for clean compact chips while preserving engine numbers
  const raw = chip.label.replace(/\s+weight\s+\d+%$/i, '').trim();
  if (chip.id === 'forecast' && !raw.toLowerCase().startsWith('forecast')) {
    return `Forecast · ${raw}`;
  }
  if ((chip.id === 'gold_trend' || chip.id === 'gold4h') && !raw.toLowerCase().startsWith('gold')) {
    return `Gold · ${raw}`;
  }
  if ((chip.id === 'dollar_proxy' || chip.id === 'dollar') && !raw.toLowerCase().startsWith('dollar')) {
    return `Dollar · ${raw}`;
  }
  if (chip.id === 'us10y' && !raw.toLowerCase().startsWith('us10y')) {
    return `US10Y · ${raw}`;
  }
  if (
    (chip.id === 'prediction_market' || chip.id === 'prediction') &&
    !raw.toLowerCase().startsWith('prediction')
  ) {
    return `Prediction market · ${raw}`;
  }
  return raw;
}

function buildPlainEnglishReason(
  decision: UnifiedNewsDecision,
  hasForecast: boolean,
  forecastLean: 'BULLISH' | 'BEARISH' | 'FLAT' | null,
  hasActual: boolean
): string {
  const v = decision.verdict;
  const raw = (decision.headlineReason || '').toLowerCase();

  if (v === 'SKIP') {
    return 'Low impact. Skipped.';
  }

  if (v === 'RELEASED') {
    if (hasActual) {
      return 'Result is in. See reading below.';
    }
    return 'Official print not published in feed yet.';
  }

  if (v === 'BULLISH') {
    return '2+ signals agree: BULLISH for gold.';
  }

  if (v === 'BEARISH') {
    return '2+ signals agree: BEARISH for gold.';
  }

  // WAIT cases
  if (raw.includes('speech') || raw.includes('press conference') || raw.includes('testimony')) {
    return 'Central bank speech. Guidance-dependent.';
  }
  if (!hasForecast || raw.includes('0 active non-ai event inputs')) {
    return 'No forecast yet. Need 2 signals to call.';
  }
  if (raw.includes('disagree') || raw.includes('gate 3') || raw.includes('|score| <')) {
    return 'Signals disagree.';
  }
  if (
    raw.includes('only 1 active non-ai event input') ||
    forecastLean === 'BULLISH' ||
    forecastLean === 'BEARISH'
  ) {
    return 'Only 1 signal (forecast). Need 2 to call.';
  }
  if (forecastLean === 'FLAT') {
    return 'Forecast matches previous. Need 2 signals to call.';
  }
  return 'Only 1 signal (forecast). Need 2 to call.';
}

export const DecisionCard: React.FC<DecisionCardProps> = ({
  decision,
  theme = 'dark',
  completedReleasesCount = 0,
  backtestLabel,
  hasForecast = false,
  forecastLean = null,
  hasActual = false,
  actualDisplayLine = null,
}) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isDark = theme === 'dark';

  // Colors per theme specification
  const colors = isDark
    ? {
        surface: '#0e1218',
        line: '#1a212b',
        text: '#e9eef4',
        muted: '#7d8996',
        gold: '#e6b84a',
        up: '#34d399',
        down: '#f4727c',
        track: '#1a212b',
      }
    : {
        surface: '#ffffff',
        line: '#dfe4ea',
        text: '#11171e',
        muted: '#5d6874',
        gold: '#9a6a00',
        up: '#0c8a5d',
        down: '#c23a46',
        track: '#dfe4ea',
      };

  const verdict = decision.verdict;
  const isBull = verdict === 'BULLISH';
  const isBear = verdict === 'BEARISH';
  const isWait = verdict === 'WAIT';
  const isReleased = verdict === 'RELEASED';
  const isSkipOrReleased = verdict === 'SKIP' || verdict === 'RELEASED';

  const verdictColor = isBull
    ? colors.up
    : isBear
    ? colors.down
    : isWait
    ? colors.gold
    : colors.muted;

  // Needle angle: -72deg (left/bearish) to +72deg (right/bullish), 0deg (center) for WAIT / SKIP / RELEASED
  const needleAngle =
    decision.dialScore === null || isWait || isSkipOrReleased
      ? 0
      : Math.max(-72, Math.min(72, (decision.dialScore / 100) * 72));

  // Engine confidence text exactly as the engine gives it ("Lean: unproven", or "no call")
  const rawConfText =
    verdict === 'WAIT' || verdict === 'SKIP' || verdict === 'RELEASED'
      ? 'no call'
      : decision.confidenceDisplay || decision.confidenceLean || 'Lean: unproven';

  const ariaConfSuffix = rawConfText.toLowerCase().replace(/[()]/g, '').trim();
  const dialAriaLabel = `Decision: ${verdict}, ${ariaConfSuffix}`;

  // Select up to 4 small reason chips (Forecast, Gold, Dollar, US10Y, Prediction market)
  const filteredChips = (decision.chips || [])
    .filter((c) => ALLOWED_CHIP_IDS.has(c.id))
    .slice(0, 4);
  const displayChips =
    filteredChips.length > 0 ? filteredChips : (decision.chips || []).slice(0, 4);

  const isBacktestVerified = completedReleasesCount >= 30;
  const effectiveBacktestLabel = isBacktestVerified
    ? backtestLabel || `Backtest: ${completedReleasesCount} releases`
    : 'Backtest: unverified';

  const plainEnglishReason = buildPlainEnglishReason(
    decision,
    hasForecast,
    forecastLean,
    hasActual
  );

  // Tick marks along the 180-degree semicircle (radius 48, center 62, 58)
  const tickAngles = [-75, -50, -25, 0, 25, 50, 75];

  return (
    <section
      id="news-decision-card"
      className="w-full rounded-2xl border p-4 sm:p-5 transition-colors"
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.line,
      }}
      aria-label="Single News Decision Card"
    >
      {/* Top Eyebrow & Backtest Status */}
      <div
        className="flex items-center justify-between gap-2 pb-3 border-b"
        style={{ borderColor: colors.line }}
      >
        <span
          className="font-mono text-[10px] uppercase tracking-[0.14em] min-w-0 truncate"
          style={{ color: colors.muted }}
        >
          DECISION ENGINE · {decision.eventTitle}
        </span>

        <span
          className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded border"
          style={{
            color: colors.muted,
            borderColor: colors.line,
            backgroundColor: isDark ? '#07090c' : '#f3f5f7',
          }}
        >
          {effectiveBacktestLabel}
        </span>
      </div>

      {/* Center Stage: ONE 124px Half-Circle Dial + Single Verdict Word + Confidence */}
      <div className="py-4 flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
        {/* 124px Half-Circle Dial */}
        <div className="shrink-0 flex flex-col items-center">
          <svg
            width="124"
            height="68"
            viewBox="0 0 124 68"
            role="img"
            aria-label={dialAriaLabel}
            className="overflow-visible select-none"
          >
            {/* Outer semicircle track */}
            <path
              d="M 14 58 A 48 48 0 0 1 110 58"
              fill="none"
              stroke={colors.track}
              strokeWidth="6"
              strokeLinecap="round"
            />

            {/* Left Bearish segment */}
            <path
              d="M 14 58 A 48 48 0 0 1 45 13"
              fill="none"
              stroke={colors.down}
              strokeWidth="4"
              strokeLinecap="round"
              opacity={isBear ? 0.95 : 0.35}
            />

            {/* Center Wait segment */}
            <path
              d="M 49 12 A 48 48 0 0 1 75 12"
              fill="none"
              stroke={isWait ? colors.gold : colors.muted}
              strokeWidth="4"
              strokeLinecap="round"
              opacity={isWait ? 0.95 : 0.35}
            />

            {/* Right Bullish segment */}
            <path
              d="M 79 13 A 48 48 0 0 1 110 58"
              fill="none"
              stroke={colors.up}
              strokeWidth="4"
              strokeLinecap="round"
              opacity={isBull ? 0.95 : 0.35}
            />

            {/* Radial ticks */}
            {tickAngles.map((deg) => {
              const rad = ((deg - 90) * Math.PI) / 180;
              const r1 = 38;
              const r2 = deg === 0 ? 43 : 41;
              const x1 = 62 + Math.cos(rad) * r1;
              const y1 = 58 + Math.sin(rad) * r1;
              const x2 = 62 + Math.cos(rad) * r2;
              const y2 = 58 + Math.sin(rad) * r2;
              return (
                <line
                  key={deg}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={colors.muted}
                  strokeWidth={deg === 0 ? '1.5' : '1'}
                  opacity="0.6"
                />
              );
            })}

            {/* Needle */}
            <g
              style={{
                transformOrigin: '62px 58px',
                transform: `rotate(${needleAngle}deg)`,
                transition: 'transform 500ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <line
                x1="62"
                y1="58"
                x2="62"
                y2="18"
                stroke={verdictColor}
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              <circle cx="62" cy="18" r="2.2" fill={verdictColor} />
            </g>

            {/* Pivot */}
            <circle
              cx="62"
              cy="58"
              r="4.5"
              fill={verdictColor}
              stroke={colors.surface}
              strokeWidth="1.5"
            />
          </svg>
        </div>

        {/* Verdict Word + Engine Confidence Text + Thin Confidence Bar + Forecast Lean + Plain-English Reason */}
        <div className="flex-1 w-full text-center sm:text-left space-y-2 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 justify-center sm:justify-start">
            <span
              className="text-2xl sm:text-[26px] font-bold font-mono tracking-tight leading-none"
              style={{ color: verdictColor }}
            >
              {verdict}
            </span>
            <span
              className="font-mono text-xs font-medium"
              style={{ color: colors.muted }}
            >
              {rawConfText}
            </span>
          </div>

          {/* Thin confidence bar */}
          <div
            className="w-full max-w-[220px] mx-auto sm:mx-0 h-[3px] rounded-full overflow-hidden"
            style={{ backgroundColor: colors.line }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${
                  isWait || isSkipOrReleased
                    ? 0
                    : Math.min(100, Math.max(8, decision.confidence || 0))
                }%`,
                backgroundColor: verdictColor,
              }}
            />
          </div>

          {/* Item 1: FORECAST LEAN (separate from the decision, muted colour, small arrow) */}
          {isWait && (
            <div
              id="forecast-lean-line"
              className="font-mono text-[11px] leading-snug flex items-center justify-center sm:justify-start gap-1.5"
              style={{ color: colors.muted }}
            >
              {!hasForecast ? (
                <span>No forecast yet</span>
              ) : forecastLean === 'BULLISH' ? (
                <>
                  <span aria-hidden="true">↑</span>
                  <span>Forecast lean: BULLISH for gold (weak, 1 signal)</span>
                </>
              ) : forecastLean === 'BEARISH' ? (
                <>
                  <span aria-hidden="true">↓</span>
                  <span>Forecast lean: BEARISH for gold (weak, 1 signal)</span>
                </>
              ) : (
                <span>Forecast flat vs previous (weak, 1 signal)</span>
              )}
            </div>
          )}

          {/* Item 2d: Released status line under dial */}
          {isReleased && (
            <div
              className="font-mono text-[11px] leading-snug"
              style={{ color: colors.muted }}
            >
              {hasActual && actualDisplayLine ? actualDisplayLine : 'Actual not available'}
            </div>
          )}

          {/* Item 3: Plain-English Reason + Collapsible Technical Details (no ellipsis cut) */}
          <div className="pt-0.5 space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-center sm:justify-start gap-x-2.5 gap-y-1">
              <p
                className="text-xs font-['Sora'] leading-relaxed"
                style={{ color: colors.text }}
              >
                {plainEnglishReason}
              </p>

              {decision.headlineReason && (
                <button
                  type="button"
                  onClick={() => setDetailsOpen((prev) => !prev)}
                  aria-expanded={detailsOpen}
                  className="font-mono text-[10px] uppercase tracking-[0.14em] underline cursor-pointer shrink-0"
                  style={{ color: colors.muted }}
                >
                  {detailsOpen ? 'Hide details [-]' : 'Details [+]'}
                </button>
              )}
            </div>

            {detailsOpen && decision.headlineReason && (
              <div
                className="p-2.5 rounded-lg border font-mono text-[11px] leading-relaxed text-left whitespace-normal break-words"
                style={{
                  backgroundColor: isDark ? '#07090c' : '#f3f5f7',
                  borderColor: colors.line,
                  color: colors.muted,
                }}
              >
                {decision.headlineReason}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Up to 4 small reason chips (Forecast, Gold, Dollar, US10Y, Prediction market) coloured up/down/flat */}
      {displayChips.length > 0 && (
        <div
          className="pt-3 border-t flex flex-wrap items-center gap-1.5"
          style={{ borderColor: colors.line }}
        >
          {displayChips.map((chip) => {
            const isUp = chip.sentiment === 'BULLISH';
            const isDown = chip.sentiment === 'BEARISH';
            const chipColor = isUp ? colors.up : isDown ? colors.down : colors.muted;
            const chipBg = isUp
              ? isDark
                ? 'rgba(52, 211, 153, 0.08)'
                : 'rgba(12, 138, 93, 0.08)'
              : isDown
              ? isDark
                ? 'rgba(244, 114, 124, 0.08)'
                : 'rgba(194, 58, 70, 0.08)'
              : isDark
              ? '#07090c'
              : '#f3f5f7';
            const chipBorder = isUp
              ? isDark
                ? 'rgba(52, 211, 153, 0.28)'
                : 'rgba(12, 138, 93, 0.28)'
              : isDown
              ? isDark
                ? 'rgba(244, 114, 124, 0.28)'
                : 'rgba(194, 58, 70, 0.28)'
              : colors.line;

            return (
              <span
                key={chip.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[11px] border"
                style={{
                  color: chipColor,
                  backgroundColor: chipBg,
                  borderColor: chipBorder,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: chipColor }}
                />
                <span>{formatChipShortLabel(chip)}</span>
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
};

