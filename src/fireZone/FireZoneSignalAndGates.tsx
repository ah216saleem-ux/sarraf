// src/fireZone/FireZoneSignalAndGates.tsx
import React, { useEffect, useRef, useState } from 'react';
import { GateEvaluation } from './types';

const radarCardStyle: React.CSSProperties = {
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

function formatUtcSnapshot(date: Date): string {
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export interface FireZoneSignalCardProps {
  gateEval: GateEvaluation;
  currentPrice?: number;
  snapshotUtc?: string;
}

export const FireZoneSignalCard: React.FC<FireZoneSignalCardProps> = React.memo(
  ({ gateEval, currentPrice = 0, snapshotUtc }) => {
    const {
      signal,
      biasLabel,
      passedCount,
      totalGates,
      htfLabel,
      tradeAllowed,
      buyPct,
      waitPct,
      sellPct,
    } = gateEval;

    // Track last price to flash slightly pink when the last tick went down
    const prevPriceRef = useRef<number>(currentPrice);
    const [tickDownFlash, setTickDownFlash] = useState<boolean>(false);
    const [utcTimeStr, setUtcTimeStr] = useState<string>(
      () => snapshotUtc || formatUtcSnapshot(new Date())
    );

    useEffect(() => {
      if (snapshotUtc) {
        setUtcTimeStr(snapshotUtc);
      } else {
        setUtcTimeStr(formatUtcSnapshot(new Date()));
      }
    }, [currentPrice, snapshotUtc]);

    useEffect(() => {
      if (
        currentPrice > 0 &&
        prevPriceRef.current > 0 &&
        currentPrice < prevPriceRef.current
      ) {
        setTickDownFlash(true);
        const timer = setTimeout(() => setTickDownFlash(false), 450);
        prevPriceRef.current = currentPrice;
        return () => clearTimeout(timer);
      }
      if (currentPrice > 0) {
        prevPriceRef.current = currentPrice;
      }
    }, [currentPrice]);

    // Decision Engine state & color
    const displayState = tradeAllowed && (signal === 'BUY' || signal === 'SELL') ? signal : 'WAIT';
    const stateColor =
      displayState === 'BUY'
        ? 'var(--up, #2fe08a)'
        : displayState === 'SELL'
        ? 'var(--dn, #ff4d66)'
        : 'var(--gold, #f2b94b)';

    // Fusion confidence % (dominant directional confidence)
    const fusionPct =
      biasLabel === 'BUY'
        ? buyPct
        : biasLabel === 'SELL'
        ? sellPct
        : Math.max(buyPct, sellPct, waitPct);

    // Engine Health % (gates passed / 7)
    const safeTotal = totalGates > 0 ? totalGates : 7;
    const healthPct = Math.round((passedCount / safeTotal) * 100);
    const failedCount = Math.max(0, safeTotal - passedCount);
    const isNormalMode = healthPct >= 70;

    return (
      <div className="w-full" style={{ fontFamily: "'Manrope', sans-serif" }}>
        {/* 2. Hero Live Price Block */}
        <section style={radarCardStyle} className="fz-fade-up">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              style={{
                fontSize: '10px',
                letterSpacing: '0.2em',
                fontWeight: 800,
                color: 'var(--cy, #5ee2ea)',
                textTransform: 'uppercase',
              }}
            >
              FIRE ZONE
            </span>
            <span style={sectionLabelStyle}>SWING TRADE RADAR</span>
          </div>

          <div
            className="mt-1.5 transition-colors duration-300"
            style={{
              ...monoStyle,
              fontSize: '38px',
              lineHeight: 1.1,
              fontWeight: 700,
              color: tickDownFlash ? '#ff8da1' : 'var(--cy, #5ee2ea)',
            }}
          >
            ${currentPrice > 0 ? currentPrice.toFixed(2) : '---.--'}
          </div>

          <div
            className="mt-1.5"
            style={{
              ...monoStyle,
              fontSize: '10.5px',
              fontWeight: 500,
              letterSpacing: '0.14em',
              color: 'var(--mu, #7e8794)',
              textTransform: 'uppercase',
            }}
          >
            XAU/USD - SNAPSHOT {utcTimeStr} UTC
          </div>
        </section>

        {/* 3. DECISION ENGINE card */}
        <section style={radarCardStyle} className="fz-fade-up">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                backgroundColor: 'var(--up, #2fe08a)',
                boxShadow: '0 0 8px rgba(47, 224, 138, 0.6)',
              }}
            />
            <span style={sectionLabelStyle}>DECISION ENGINE - CURRENT STATE</span>
          </div>

          <div className="mt-2 flex items-baseline gap-3">
            <span
              style={{
                fontSize: '38px',
                lineHeight: 1.05,
                fontWeight: 800,
                color: stateColor,
                letterSpacing: '0.04em',
                whiteSpace: 'nowrap',
              }}
            >
              {displayState}
            </span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.16em',
                color: 'var(--mu, #7e8794)',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {tradeAllowed ? 'ENTRY OPEN' : 'NO ENTRY'}
            </span>
          </div>

          <div
            className="mt-2 text-xs font-semibold"
            style={{ color: 'var(--tx, #eef1f6)' }}
          >
            Directional bias{' '}
            <span
              className="font-extrabold"
              style={{
                color:
                  biasLabel === 'BUY'
                    ? 'var(--up, #2fe08a)'
                    : biasLabel === 'SELL'
                    ? 'var(--dn, #ff4d66)'
                    : 'var(--gold, #f2b94b)',
              }}
            >
              {biasLabel}
            </span>
            {' - structure '}
            <span
              className="font-extrabold"
              style={{
                color: htfLabel === 'UP' ? 'var(--up, #2fe08a)' : 'var(--dn, #ff4d66)',
              }}
            >
              {htfLabel}
            </span>
            {' - gates '}
            <span style={{ ...monoStyle, fontWeight: 700 }}>
              {passedCount}/{safeTotal}
            </span>
          </div>
        </section>

        {/* 4. FUSION CONFIDENCE card */}
        <section style={radarCardStyle} className="fz-fade-up">
          <div style={sectionLabelStyle}>FUSION CONFIDENCE</div>

          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span
              style={{
                ...monoStyle,
                fontSize: '34px',
                lineHeight: 1.1,
                fontWeight: 700,
                color: 'var(--gold, #f2b94b)',
              }}
            >
              {fusionPct}%
            </span>
            <span
              style={{
                ...monoStyle,
                fontSize: '11px',
                fontWeight: 500,
                color: 'var(--mu, #7e8794)',
              }}
            >
              65% needed
            </span>
          </div>

          {/* ONE 7px bar split into green (BUY%), grey (WAIT%), red (SELL%) with a .6s width transition */}
          <div
            className="mt-2.5 w-full h-[7px] rounded-full overflow-hidden flex"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.06)' }}
          >
            <div
              style={{
                width: `${buyPct}%`,
                backgroundColor: 'var(--up, #2fe08a)',
                transition: 'width 0.6s ease',
              }}
            />
            <div
              style={{
                width: `${waitPct}%`,
                backgroundColor: 'var(--mu, #7e8794)',
                transition: 'width 0.6s ease',
              }}
            />
            <div
              style={{
                width: `${sellPct}%`,
                backgroundColor: 'var(--dn, #ff4d66)',
                transition: 'width 0.6s ease',
              }}
            />
          </div>

          {/* Three labels under bar: "▲ BUY 79%", "● WAIT 0%", "▼ SELL 21%" */}
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <span
              style={{
                ...monoStyle,
                fontSize: '11.5px',
                fontWeight: 800,
                color: 'var(--up, #2fe08a)',
              }}
            >
              ▲ BUY {buyPct}%
            </span>
            <span
              style={{
                ...monoStyle,
                fontSize: '11.5px',
                fontWeight: 800,
                color: 'var(--mu, #7e8794)',
              }}
            >
              ● WAIT {waitPct}%
            </span>
            <span
              style={{
                ...monoStyle,
                fontSize: '11.5px',
                fontWeight: 800,
                color: 'var(--dn, #ff4d66)',
              }}
            >
              ▼ SELL {sellPct}%
            </span>
          </div>
        </section>

        {/* 5. ENGINE HEALTH card */}
        <section style={radarCardStyle} className="fz-fade-up">
          <div style={sectionLabelStyle}>ENGINE HEALTH</div>

          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span
              style={{
                ...monoStyle,
                fontSize: '34px',
                lineHeight: 1.1,
                fontWeight: 700,
                color: 'var(--gold, #f2b94b)',
              }}
            >
              {healthPct}%
            </span>

            <span
              className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider"
              style={
                tradeAllowed
                  ? {
                      ...monoStyle,
                      backgroundColor: 'rgba(47, 224, 138, 0.14)',
                      border: '1px solid var(--up, #2fe08a)',
                      color: 'var(--up, #2fe08a)',
                    }
                  : {
                      ...monoStyle,
                      backgroundColor: 'rgba(255, 77, 102, 0.12)',
                      border: '1px solid var(--dn, #ff4d66)',
                      color: 'var(--dn, #ff4d66)',
                    }
              }
            >
              {tradeAllowed ? 'TRADE ALLOWED' : 'TRADE BLOCKED'}
            </span>
          </div>

          {/* 6px gradient bar (red -> gold -> green) */}
          <div
            className="mt-2.5 w-full h-[6px] rounded-full overflow-hidden relative"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.08)' }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(6, healthPct)}%`,
                background:
                  'linear-gradient(90deg, var(--dn, #ff4d66) 0%, var(--gold, #f2b94b) 50%, var(--up, #2fe08a) 100%)',
                transition: 'width 0.6s ease',
              }}
            />
          </div>

          <div
            className="mt-2.5 text-xs font-bold"
            style={{
              color: isNormalMode ? 'var(--up, #2fe08a)' : 'var(--gold, #f2b94b)',
            }}
          >
            {isNormalMode ? 'NORMAL MODE' : 'WARNING MODE'} -{' '}
            <span style={{ ...monoStyle, color: 'var(--tx, #eef1f6)' }}>
              {failedCount} / {safeTotal}
            </span>{' '}
            <span style={{ color: 'var(--mu, #7e8794)', fontWeight: 600 }}>
              gates failed
            </span>
          </div>
        </section>
      </div>
    );
  }
);

export const FireZoneGatesSection: React.FC<{ gateEval: GateEvaluation }> = React.memo(
  ({ gateEval }) => {
    const failedGates = gateEval.gates.filter((g) => !g.passed);
    const safeTotal = gateEval.totalGates > 0 ? gateEval.totalGates : 7;
    const failedCount = Math.max(0, safeTotal - gateEval.passedCount);

    return (
      <div>
        {/* B) WHY ENTRY IS BLOCKED card */}
        <section className="space-y-2.5 fz-fade-up" style={radarCardStyle}>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 800,
              color: 'var(--tx, #eef1f6)',
              letterSpacing: '0.02em',
            }}
          >
            Why entry is blocked
          </div>

          {failedGates.length === 0 ? (
            <div
              className="text-xs font-bold"
              style={{ color: 'var(--up, #2fe08a)' }}
            >
              All gates pass.
            </div>
          ) : (
            <ul className="space-y-1.5 text-xs" style={{ color: 'var(--tx, #eef1f6)' }}>
              {failedGates.map((fg) => (
                <li key={fg.id} className="flex items-start gap-2 leading-snug">
                  <span
                    className="font-extrabold select-none shrink-0"
                    style={{ color: 'var(--dn, #ff4d66)' }}
                  >
                    ×
                  </span>
                  <span>{fg.reasonIfFailed}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* C) EXECUTION SAFETY GATES card */}
        <section className="space-y-2.5 fz-fade-up" style={radarCardStyle}>
          <div className="flex items-center justify-between gap-2">
            <span style={sectionLabelStyle}>EXECUTION SAFETY GATES</span>
            <span
              style={{
                ...monoStyle,
                fontSize: '11px',
                fontWeight: 700,
                color: failedCount > 0 ? 'var(--dn, #ff4d66)' : 'var(--up, #2fe08a)',
              }}
            >
              {failedCount} failed / {safeTotal}
            </span>
          </div>

          {/* 3-column grid of 7 chips */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: '6px',
            }}
          >
            {gateEval.gates.map((g) => (
              <div
                key={g.id}
                style={{
                  padding: '9px 6px',
                  borderRadius: '9px',
                  border: g.passed ? '1px solid #16553a' : '1px solid #6b2a35',
                  backgroundColor: g.passed ? '#0b1f17' : '#1f0d12',
                  color: g.passed ? 'var(--up, #2fe08a)' : 'var(--dn, #ff4d66)',
                  fontSize: '10.5px',
                  fontWeight: 800,
                  textAlign: 'center',
                  lineHeight: 1.25,
                }}
              >
                {g.passed ? `✓ ${g.label}` : `✕ ${g.label}`}
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }
);

