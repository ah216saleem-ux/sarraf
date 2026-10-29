// src/fireZone/FireZoneLadder.tsx
import React, { useMemo } from 'react';
import { LadderRow, TradePlan } from './types';
import {
  FireZoneChartModel,
  SimpleLadderRow,
  buildSimpleLadderRows,
} from './engineGatesAndLadder';

const glassCardStyle: React.CSSProperties = {
  background: 'var(--card, #0d1117)',
  border: '1px solid var(--bd, #1a212b)',
  borderRadius: '14px',
  padding: '15px',
  marginTop: '11px',
  fontFamily: "'Manrope', sans-serif",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

function formatLadderPrice(val: number): string {
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Fixed canonical order so React never reorders DOM children via insertBefore
// (preserving uninterrupted CSS transform transitions when rows swap places on ticks)
const CANONICAL_LABEL_ORDER: Record<SimpleLadderRow['label'], number> = {
  'SELL STOP': 1,
  'SELL ENTRY': 2,
  'SELL TP1': 3,
  'SELL TP2': 4,
  'SELL TP3': 5,
  'BUY STOP': 6,
  'BUY ENTRY': 7,
  'BUY TP1': 8,
  'BUY TP2': 9,
  'BUY TP3': 10,
  'MARKET NOW': 11,
};

interface SimpleLadderRowItemProps {
  label: SimpleLadderRow['label'];
  side: SimpleLadderRow['side'];
  price: number;
  sortedIndex: number;
}

const SimpleLadderRowItem: React.FC<SimpleLadderRowItemProps> = React.memo(
  ({ label, side, price, sortedIndex }) => {
    const isNow = side === 'NOW';
    const isSell = side === 'SELL';

    const dotAndLabelColor = isNow
      ? 'var(--gold, #f2b94b)'
      : isSell
      ? 'var(--dn, #ff4d66)'
      : 'var(--up, #2fe08a)';

    const priceColor = isNow ? 'var(--gold, #f2b94b)' : 'var(--tx, #eef1f6)';

    return (
      <div
        data-row-label={label}
        data-sorted-index={sortedIndex}
        className="w-full h-[44px] px-3.5 rounded-[10px] flex items-center justify-between gap-2"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          transform: `translateY(${sortedIndex * 50}px)`,
          transition: 'transform 0.6s cubic-bezier(.2,.8,.2,1)',
          willChange: 'transform',
          backgroundColor: isNow ? '#1b1708' : '#0a0e13',
          border: isNow ? '1px solid #6b5420' : '1px solid var(--bd, #1a212b)',
          boxShadow: isNow ? '0 0 18px rgba(242, 185, 75, 0.22)' : 'none',
          zIndex: isNow ? 10 : 1,
        }}
      >
        {/* Left: 7px colored dot + label (11.5px weight 800 letter-spacing .1em) */}
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-[7px] h-[7px] rounded-full shrink-0"
            style={{
              backgroundColor: dotAndLabelColor,
              boxShadow: isNow ? '0 0 8px rgba(242, 185, 75, 0.8)' : undefined,
            }}
          />
          <span
            style={{
              fontSize: '11.5px',
              fontWeight: 800,
              letterSpacing: '0.1em',
              color: dotAndLabelColor,
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </span>
        </div>

        {/* Right: price in mono 14px */}
        <span
          style={{
            ...monoStyle,
            fontSize: '14px',
            fontWeight: 700,
            color: priceColor,
          }}
        >
          {formatLadderPrice(price)}
        </span>
      </div>
    );
  },
  (prev, next) =>
    prev.label === next.label &&
    prev.side === next.side &&
    prev.price === next.price &&
    prev.sortedIndex === next.sortedIndex
);

interface Props {
  chartModel?: FireZoneChartModel;
  sellPlan?: TradePlan | null;
  buyPlan?: TradePlan | null;
  ladder?: LadderRow[];
  currentPrice: number;
  dataReloadSeq?: number;
}

export const FireZoneLadder: React.FC<Props> = React.memo(({
  chartModel,
  sellPlan,
  buyPlan,
  currentPrice,
}) => {
  const resolvedSellPlan = sellPlan !== undefined ? sellPlan : chartModel?.sellNearestPlan ?? null;
  const resolvedBuyPlan = buyPlan !== undefined ? buyPlan : chartModel?.buyNearestPlan ?? null;
  const liveNow = currentPrice > 0 ? currentPrice : chartModel?.currentPrice ?? 0;

  // Compute sorted high-to-low simple ladder rows on every tick
  const sortedRows = useMemo(
    () => buildSimpleLadderRows(resolvedSellPlan, resolvedBuyPlan, liveNow),
    [resolvedSellPlan, resolvedBuyPlan, liveNow]
  );

  // Keep DOM elements in fixed canonical order by label so only transform: translateY(index*50px)
  // and price text update on ticks (zero DOM node recreation or transition interruption)
  const canonicalRows = useMemo(() => {
    return [...sortedRows].sort(
      (a, b) => CANONICAL_LABEL_ORDER[a.label] - CANONICAL_LABEL_ORDER[b.label]
    );
  }, [sortedRows]);

  const containerHeight = sortedRows.length * 50;

  return (
    <section className="fz-fade-up" style={glassCardStyle}>
      {/* Title row: "◆ Zone ladder" (gold, 13.5px) and on the right "9 levels" (count of rows) */}
      <div className="flex items-center justify-between gap-2">
        <h3
          style={{
            fontSize: '13.5px',
            fontWeight: 800,
            color: 'var(--gold, #f2b94b)',
            letterSpacing: '0.02em',
          }}
        >
          ◆ Zone ladder
        </h3>
        <span
          style={{
            ...monoStyle,
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--mu, #7e8794)',
          }}
        >
          {sortedRows.length} levels
        </span>
      </div>

      {/* Subtitle */}
      <p
        className="mt-0.5 text-xs"
        style={{ color: 'var(--mu, #7e8794)', fontWeight: 500 }}
      >
        Plan levels around the live price, high to low.
      </p>

      {/* Relative container (height = rows * 50px) with absolutely positioned sliding rows */}
      <div
        className="mt-3 relative w-full"
        style={{ height: `${containerHeight}px` }}
      >
        {canonicalRows.map((row) => (
          <SimpleLadderRowItem
            key={row.label}
            label={row.label}
            side={row.side}
            price={row.price}
            sortedIndex={row.sortedIndex}
          />
        ))}
      </div>
    </section>
  );
});
