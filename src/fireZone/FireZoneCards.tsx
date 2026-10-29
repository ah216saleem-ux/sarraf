// src/fireZone/FireZoneCards.tsx
import React, { useState } from 'react';
import { Flame, Layers, ChevronDown } from 'lucide-react';
import {
  FireZone,
  RetiredZoneHistoryItem,
  TradePlan,
  ZoneSide,
} from './types';

const glassCardStyle: React.CSSProperties = {
  background: 'var(--card, #0d1117)',
  border: '1px solid var(--bd, #1a212b)',
  borderRadius: '14px',
  padding: '15px',
  marginTop: '11px',
  fontFamily: "'Manrope', sans-serif",
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '10px',
  letterSpacing: '0.2em',
  fontWeight: 800,
  color: 'var(--mu, #7e8794)',
  textTransform: 'uppercase',
  fontFamily: "'Manrope', sans-serif",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

function formatPrice(val: number): string {
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface NearestZoneCardProps {
  side: ZoneSide;
  plan: TradePlan | null;
  isActive: boolean;
  currentPrice?: number;
}

export const FireZoneNearestCard: React.FC<NearestZoneCardProps> = React.memo(
  ({ side, plan, currentPrice = 0 }) => {
    const isBuy = side === 'BUY';
    const accentColor = isBuy ? 'var(--up, #2fe08a)' : 'var(--dn, #ff4d66)';
    const headerTitle = isBuy ? '▲ BUY SETUP' : '▼ SELL SETUP';
    const hintText = isBuy
      ? 'DOWN-FIRST → buy from LAST demand (deepest STRONG)'
      : 'UP-FIRST → sell from LAST supply (deepest STRONG)';

    const strengthLabel = plan?.zoneLabel || 'STRONG';
    const tagPrefix = isBuy ? 'DEMAND' : 'SUPPLY';
    const tagText = `${tagPrefix} - ${strengthLabel}`;

    // Live distance from currentPrice to [entryRange[0], entryRange[1]]
    const lo = plan ? plan.entryRange[0] : 0;
    const hi = plan ? plan.entryRange[1] : 0;
    const liveDist =
      !plan
        ? 0
        : currentPrice <= 0
        ? plan.distance
        : currentPrice < lo
        ? lo - currentPrice
        : currentPrice > hi
        ? currentPrice - hi
        : 0;
    const isInsideZone = liveDist <= 0.005;
    const distanceDisplay = isInsideZone
      ? 'inside zone'
      : `$${liveDist.toFixed(2)} away`;

    // R:R from anchor to TP1 divided by anchor to SL
    const rrFromAnchor = plan
      ? Math.abs(plan.tp1 - plan.anchor) / Math.max(0.01, Math.abs(plan.anchor - plan.sl))
      : 0;

    return (
      <section
        className="relative overflow-hidden fz-fade-up"
        style={{
          ...glassCardStyle,
          borderLeft: `3px solid ${accentColor}`,
        }}
      >
        {/* Header row: left "▲ BUY SETUP" / "▼ SELL SETUP", right tag "DEMAND - STRONG" / "SUPPLY - CRITICAL" */}
        <div className="flex items-center justify-between gap-2">
          <span
            style={{
              fontSize: '13.5px',
              fontWeight: 800,
              letterSpacing: '0.06em',
              color: accentColor,
              whiteSpace: 'nowrap',
            }}
          >
            {headerTitle}
          </span>

          <span
            style={{
              fontSize: '10px',
              fontWeight: 800,
              letterSpacing: '0.08em',
              borderRadius: '6px',
              padding: '3px 8px',
              border: `1px solid ${
                isBuy ? 'rgba(47, 224, 138, 0.4)' : 'rgba(255, 77, 102, 0.4)'
              }`,
              backgroundColor: isBuy
                ? 'rgba(47, 224, 138, 0.10)'
                : 'rgba(255, 77, 102, 0.10)',
              color: accentColor,
              whiteSpace: 'nowrap',
            }}
          >
            {tagText}
          </span>
        </div>

        {/* Hint line (10.5px muted) */}
        <div
          className="mt-1"
          style={{
            fontSize: '10.5px',
            fontWeight: 500,
            color: 'var(--mu, #7e8794)',
          }}
        >
          {hintText}
        </div>

        {!plan ? (
          <div
            className="py-4 text-xs text-center italic"
            style={{ color: 'var(--mu, #7e8794)' }}
          >
            No {side.toLowerCase()} zone available.
          </div>
        ) : (
          <>
            {/* Small label "ENTRY ZONE", then range in JetBrains Mono 26px weight 700 */}
            <div className="mt-3">
              <div style={sectionLabelStyle}>ENTRY ZONE</div>
              <div
                className="mt-1"
                style={{
                  ...monoStyle,
                  fontSize: '26px',
                  lineHeight: 1.15,
                  fontWeight: 700,
                  color: 'var(--tx, #eef1f6)',
                }}
              >
                {formatPrice(plan.entryRange[0])} - {formatPrice(plan.entryRange[1])}
              </div>
            </div>

            {/* Rows (space-between, 13px) */}
            <div className="mt-3.5 space-y-2 text-[13px]">
              {/* Row 1: Anchor */}
              <div className="flex items-center justify-between gap-2">
                <span style={{ color: 'var(--mu, #7e8794)', fontWeight: 600 }}>
                  Anchor
                </span>
                <span
                  style={{
                    ...monoStyle,
                    fontWeight: 700,
                    color: 'var(--tx, #eef1f6)',
                  }}
                >
                  {formatPrice(plan.anchor)} ({plan.zoneLabel})
                </span>
              </div>

              {/* Row 2: Stop loss (red) */}
              <div className="flex items-center justify-between gap-2">
                <span style={{ color: 'var(--mu, #7e8794)', fontWeight: 600 }}>
                  Stop loss
                </span>
                <span
                  style={{
                    ...monoStyle,
                    fontWeight: 700,
                    color: 'var(--dn, #ff4d66)',
                  }}
                >
                  {formatPrice(plan.sl)}
                </span>
              </div>

              {/* Row 3: Distance (cyan, "$24.99 away" or "inside zone", live) */}
              <div className="flex items-center justify-between gap-2">
                <span style={{ color: 'var(--mu, #7e8794)', fontWeight: 600 }}>
                  Distance
                </span>
                <span
                  style={{
                    ...monoStyle,
                    fontWeight: 700,
                    color: 'var(--cy, #5ee2ea)',
                  }}
                >
                  {distanceDisplay}
                </span>
              </div>

              {/* Row 4: TP 1 / 2 / 3 (green for BUY, red for SELL, "a / b / c") */}
              <div className="flex items-center justify-between gap-2">
                <span
                  className="shrink-0"
                  style={{ color: 'var(--mu, #7e8794)', fontWeight: 600 }}
                >
                  TP 1 / 2 / 3
                </span>
                <span
                  style={{
                    ...monoStyle,
                    fontSize: '12.5px',
                    fontWeight: 700,
                    color: accentColor,
                  }}
                >
                  {formatPrice(plan.tp1)} / {formatPrice(plan.tp2)} / {formatPrice(plan.tp3)}
                </span>
              </div>
            </div>

            {/* Footer with top border */}
            <div
              className="mt-3.5 pt-2.5 flex items-center justify-between gap-2"
              style={{ borderTop: '1px solid var(--bd, #1a212b)' }}
            >
              <span
                style={{
                  ...monoStyle,
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: 'var(--gold, #f2b94b)',
                }}
              >
                RISK : REWARD 1 : {rrFromAnchor.toFixed(2)}
              </span>

              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  color: accentColor,
                  whiteSpace: 'nowrap',
                }}
              >
                {isBuy ? '▲ BUY BIAS' : '▼ SELL ZONE'}
              </span>
            </div>
          </>
        )}
      </section>
    );
  }
);

export const FireZoneOtherZonesList: React.FC<{
  buyZones: FireZone[];
  sellZones: FireZone[];
}> = React.memo(({ buyZones, sellZones }) => {
  const otherZones = [...sellZones, ...buyZones].filter(
    (z) => z.type === 'DEEP' || z.type === 'SWING'
  );

  return (
    <section className="space-y-3 fz-fade-up" style={glassCardStyle}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#f2b94b]" />
          <span style={sectionLabelStyle}>OTHER ZONES (SWING &amp; DEEP)</span>
        </div>
        <span
          className="text-[11px]"
          style={{ ...monoStyle, color: 'var(--mu, #7e8794)' }}
        >
          {otherZones.length} active
        </span>
      </div>

      {otherZones.length === 0 ? (
        <div
          className="text-xs py-2 italic"
          style={{ color: 'var(--mu, #7e8794)' }}
        >
          No secondary SWING or DEEP zones currently outside nearest boundaries.
        </div>
      ) : (
        <div className="space-y-2">
          {otherZones.map((z) => {
            const isBuy = z.side === 'BUY';
            const sideColor = isBuy ? 'var(--up, #2fe08a)' : 'var(--dn, #ff4d66)';
            return (
              <div
                key={z.id}
                className="px-3 py-2.5 rounded-[10px] flex flex-wrap items-center justify-between gap-2 text-xs"
                style={{
                  backgroundColor: '#0a0e13',
                  border: '1px solid var(--bd, #1a212b)',
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="font-bold uppercase"
                    style={{ color: sideColor, ...monoStyle }}
                  >
                    {z.side}
                  </span>
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
                    style={{
                      backgroundColor: 'rgba(242, 185, 75, 0.14)',
                      color: 'var(--gold, #f2b94b)',
                      ...monoStyle,
                    }}
                  >
                    {z.type}
                  </span>
                  {z.isFlipped && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase"
                      style={{
                        backgroundColor: 'rgba(163, 113, 247, 0.16)',
                        color: '#a371f7',
                        ...monoStyle,
                      }}
                    >
                      FLIP +2
                    </span>
                  )}
                  <span
                    className="font-bold tabular-nums"
                    style={{ ...monoStyle, color: 'var(--tx, #eef1f6)' }}
                  >
                    {formatPrice(z.bottom)} - {formatPrice(z.top)}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-[11px]" style={monoStyle}>
                  <span style={{ color: 'var(--gold, #f2b94b)', fontWeight: 600 }}>
                    {z.label} ({z.score} pts)
                  </span>
                  <span style={{ color: 'var(--mu, #7e8794)' }}>
                    {z.distance <= 0.01 ? 'inside zone' : `$${Math.round(z.distance)} away`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
});

/**
 * LEVEL EVENTS Card on DESK:
 * - Shows latest lifecycle event as a sentence (HELD / BROKEN / EXPIRED)
 * - Plus a collapsible list of the last 10 retired zones history
 */
export const FireZoneEventCard: React.FC<{
  latestLevelEvent: string | null;
  retiredHistory: RetiredZoneHistoryItem[];
}> = React.memo(({ latestLevelEvent, retiredHistory }) => {
  const [showHistory, setShowHistory] = useState<boolean>(false);

  if (!latestLevelEvent && retiredHistory.length === 0) {
    return (
      <section className="space-y-2 fz-fade-up" style={glassCardStyle}>
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-[#f2b94b]" />
          <span style={sectionLabelStyle}>LEVEL EVENTS</span>
        </div>
        <p className="text-xs italic" style={{ color: 'var(--mu, #7e8794)' }}>
          All active levels are FRESH. No zones have held, broken, or expired in the current window yet.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 fz-fade-up" style={glassCardStyle}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-[#f2b94b] shrink-0" />
          <span style={{ ...sectionLabelStyle, color: 'var(--gold, #f2b94b)' }}>
            LEVEL EVENTS
          </span>
        </div>

        {retiredHistory.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] font-bold uppercase cursor-pointer transition-colors"
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid var(--bd, #1a212b)',
              color: 'var(--gold, #f2b94b)',
              ...monoStyle,
            }}
          >
            <span>History ({retiredHistory.length})</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                showHistory ? 'rotate-180' : ''
              }`}
            />
          </button>
        )}
      </div>

      {latestLevelEvent && (
        <p
          className="text-xs sm:text-sm font-semibold leading-relaxed"
          style={{ color: 'var(--tx, #eef1f6)' }}
        >
          {latestLevelEvent}
        </p>
      )}

      {showHistory && retiredHistory.length > 0 && (
        <div
          className="pt-2 space-y-1.5"
          style={{ borderTop: '1px solid var(--bd, #1a212b)' }}
        >
          {retiredHistory.map((item) => {
            const isHeld = item.result === 'HELD';
            const isBroken = item.result === 'BROKEN';
            const badgeColor = isHeld
              ? '#2fe08a'
              : isBroken
              ? '#ff4d66'
              : '#7e8794';

            return (
              <div
                key={item.id}
                className="px-3 py-2 rounded-[10px] flex flex-wrap items-center justify-between gap-2 text-xs"
                style={{
                  backgroundColor: '#0a0e13',
                  border: '1px solid var(--bd, #1a212b)',
                  ...monoStyle,
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="font-bold"
                    style={{
                      color: item.side === 'BUY' ? 'var(--up, #2fe08a)' : 'var(--dn, #ff4d66)',
                    }}
                  >
                    {item.side}
                  </span>
                  <span
                    className="font-bold"
                    style={{ color: 'var(--tx, #eef1f6)' }}
                  >
                    {formatPrice(item.anchor)}
                  </span>
                  <span
                    className="text-[10px] uppercase"
                    style={{ color: 'var(--mu, #7e8794)' }}
                  >
                    {item.type}
                  </span>
                </div>

                <div className="flex items-center gap-2.5 text-[11px]">
                  <span
                    className="px-2 py-0.5 rounded text-[10px] font-bold uppercase"
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.04)',
                      color: badgeColor,
                      border: `1px solid ${badgeColor}44`,
                    }}
                  >
                    {item.result}
                  </span>
                  <span style={{ color: 'var(--tx, #eef1f6)' }}>
                    {isHeld
                      ? item.side === 'BUY'
                        ? `+$${item.moveAfter.toFixed(1)}`
                        : `-$${item.moveAfter.toFixed(1)}`
                      : `$${item.moveAfter.toFixed(1)}`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
});
