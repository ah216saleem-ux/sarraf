// src/fireZone/FireZoneLadderRow.tsx
import React from 'react';
import { LadderRow } from './types';

const monoStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
};

const sansStyle: React.CSSProperties = {
  fontFamily: "'Bricolage Grotesque', sans-serif",
};

function formatDiff(diff: number): string {
  if (Math.abs(diff) < 0.005) return '$0.00';
  return diff > 0 ? `+$${diff.toFixed(2)}` : `-$${Math.abs(diff).toFixed(2)}`;
}

export interface FireZoneLadderRowProps {
  row: LadderRow;
  livePrice?: number;
  nowRowRef?: React.Ref<HTMLDivElement>;
}

const FireZoneLadderRowInner: React.FC<FireZoneLadderRowProps> = ({
  row,
  livePrice,
  nowRowRef,
}) => {
  // 1. NOW Row: ▶ NOW $price with gold border 1.5px, pulsing glow 2s, LIVE tag on right
  if (row.kind === 'NOW') {
    const displayPrice =
      typeof livePrice === 'number' && livePrice > 0 ? livePrice : row.price;

    return (
      <div
        ref={nowRowRef}
        className="min-h-[38px] px-3 py-1.5 rounded-[12px] flex items-center justify-between gap-2 fz-now-pulse"
        style={{
          backgroundColor: 'rgba(245, 184, 66, 0.14)',
          border: '1.5px solid #f5b842',
          borderLeft: '3px solid #f5b842',
          ...sansStyle,
        }}
      >
        <div className="flex items-center gap-2 leading-tight">
          <span className="text-[12px] text-[#f5b842] select-none shrink-0">▶</span>
          <span
            className="text-[12px] sm:text-[12.5px] font-extrabold text-[#ffd987] tracking-wide"
            style={monoStyle}
          >
            NOW ${displayPrice.toFixed(2)}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0" style={monoStyle}>
          <span className="text-[12px] font-bold text-[#f4efe6] tabular-nums">
            ${displayPrice.toFixed(2)}
          </span>
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider"
            style={{
              background: 'linear-gradient(135deg, #ffd987 0%, #f5b842 55%, #ff7a2f 100%)',
              color: '#060608',
            }}
          >
            LIVE
          </span>
        </div>
      </div>
    );
  }

  // 2. RETEST Rows: 🔴 for SELL, 🟢 for BUY. Strong red/green gradient glow rows.
  // Format: "SELL retest ⭐ NEAREST CRITICAL" or "BUY retest NEAREST CRITICAL"
  if (row.kind === 'RETEST') {
    const isBuy = row.side === 'BUY';
    const emoji = isBuy ? '🟢' : '🔴';
    const hex = isBuy ? '#2ee6a0' : '#ff5d6c';
    const rgb = isBuy ? '46, 230, 160' : '255, 93, 108';
    const isStrongest = Boolean(row.isStar);

    return (
      <div
        className="min-h-[38px] px-3 py-1.5 rounded-[12px] flex items-center justify-between gap-2"
        style={{
          background: isStrongest
            ? `linear-gradient(90deg, rgba(${rgb}, 0.28), rgba(${rgb}, 0.06))`
            : `linear-gradient(90deg, rgba(${rgb}, 0.18), rgba(${rgb}, 0.04))`,
          border: `1px solid rgba(${rgb}, ${isStrongest ? 0.45 : 0.26})`,
          borderLeft: `3px solid ${hex}`,
          boxShadow: isStrongest ? `0 0 14px rgba(${rgb}, 0.25)` : undefined,
          ...sansStyle,
        }}
      >
        <div className="flex items-center gap-2 leading-tight">
          <span className="text-[12px] shrink-0 select-none">{emoji}</span>
          <span
            className={`${
              isStrongest ? 'text-[12px] sm:text-[12.5px]' : 'text-[11.5px] sm:text-[12px]'
            } font-bold text-[#f4efe6] whitespace-normal break-words leading-snug`}
          >
            {row.label}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0" style={monoStyle}>
          <span
            className={`${
              isStrongest ? 'text-[12px] sm:text-[12.5px]' : 'text-[12px]'
            } font-bold text-[#f4efe6] tabular-nums`}
          >
            ${row.price.toFixed(2)}
          </span>
          <span className="text-[10.5px] text-white/45 w-14 text-right tabular-nums">
            {formatDiff(row.distanceDiff)}
          </span>
        </div>
      </div>
    );
  }

  // 3. ENTRY Rows: ○ SELL entry HI, ○ SELL entry LO, ○ BUY entry HI, ○ BUY entry LO
  // Exactly $4 apart. Rows on far side of NOW dimmed to opacity .45
  if (row.kind === 'ENTRY_HI' || row.kind === 'ENTRY_LO') {
    const isBuy = row.side === 'BUY';
    const hex = isBuy ? '#2ee6a0' : '#ff5d6c';
    const rgb = isBuy ? '46, 230, 160' : '255, 93, 108';

    return (
      <div
        className="min-h-[38px] px-3 py-1.5 rounded-[12px] flex items-center justify-between gap-2"
        style={{
          backgroundColor: `rgba(${rgb}, 0.08)`,
          border: `1px solid rgba(${rgb}, 0.18)`,
          borderLeft: `3px solid ${hex}`,
          opacity: row.isDimmed ? 0.45 : 1,
          ...sansStyle,
        }}
      >
        <div className="flex items-center gap-2 leading-tight">
          <span
            className="text-[13px] font-bold leading-none shrink-0 select-none"
            style={{ color: hex }}
          >
            ○
          </span>
          <span className="text-[12px] font-bold text-[#e6e1d6] whitespace-normal break-words leading-snug">
            {row.label}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0" style={monoStyle}>
          <span className="text-[12px] font-bold text-[#f4efe6] tabular-nums">
            ${row.price.toFixed(2)}
          </span>
          <span className="text-[10.5px] text-white/45 w-14 text-right tabular-nums">
            {formatDiff(row.distanceDiff)}
          </span>
        </div>
      </div>
    );
  }

  // 4. SL Rows: 🔴 SELL SL / ⛔ style red small row, 🟢 BUY SL
  if (row.kind === 'SL') {
    const isBuy = row.side === 'BUY';
    const hex = isBuy ? '#2ee6a0' : '#ff5d6c';
    const rgb = isBuy ? '46, 230, 160' : '255, 93, 108';
    const emoji = isBuy ? '🟢' : '🔴';

    return (
      <div
        className="min-h-[38px] px-3 py-1.5 rounded-[12px] flex items-center justify-between gap-2"
        style={{
          backgroundColor: `rgba(${rgb}, 0.08)`,
          border: `1px solid rgba(${rgb}, 0.22)`,
          borderLeft: `3px solid ${hex}`,
          ...sansStyle,
        }}
      >
        <div className="flex items-center gap-2 leading-tight">
          <span className="text-[12px] shrink-0 select-none">{emoji}</span>
          <span
            className="text-[11.5px] sm:text-[12px] font-bold whitespace-normal break-words leading-snug"
            style={{ color: hex }}
          >
            {row.label}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0" style={monoStyle}>
          <span
            className="text-[11.5px] sm:text-[12px] font-bold tabular-nums"
            style={{ color: hex }}
          >
            ${row.price.toFixed(2)}
          </span>
          <span className="text-[10.5px] text-white/45 w-14 text-right tabular-nums">
            {formatDiff(row.distanceDiff)}
          </span>
        </div>
      </div>
    );
  }

  // 5. TP Rows: 🟢 BUY TP1/TP2/TP3 and 🟢 SELL TP1/TP2/TP3 for the two NEAREST plans (snapped to levels)
  if (row.kind === 'TP1' || row.kind === 'TP2' || row.kind === 'TP3') {
    return (
      <div
        className="min-h-[38px] px-3 py-1.5 rounded-[12px] flex items-center justify-between gap-2"
        style={{
          backgroundColor: 'rgba(46, 230, 160, 0.06)',
          border: '1px solid rgba(46, 230, 160, 0.22)',
          borderLeft: '3px solid #2ee6a0',
          ...sansStyle,
        }}
      >
        <div className="flex items-center gap-2 leading-tight">
          <span className="text-[12px] shrink-0 select-none">🟢</span>
          <span className="text-[11.5px] sm:text-[12px] font-bold text-[#2ee6a0] whitespace-normal break-words leading-snug">
            {row.label}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0" style={monoStyle}>
          <span className="text-[12px] font-bold text-[#2ee6a0] tabular-nums">
            ${row.price.toFixed(2)}
          </span>
          <span className="text-[10.5px] text-white/45 w-14 text-right tabular-nums">
            {formatDiff(row.distanceDiff)}
          </span>
        </div>
      </div>
    );
  }

  // 6. LEVEL Rows: 🐋 LEVEL n (n = importance rank) with name in grey (PDH, PWL, EQL, $4050)
  // Rank 1-2 yellow glow border, rank 3-5 purple border, rest grey dim
  const imp = row.levelImportance || 'MINOR';
  const borderColor =
    imp === 'KEY' ? '#f5b842' : imp === 'MAJOR' ? '#a371f7' : '#5b5b66';
  const labelColor =
    imp === 'KEY' ? '#ffe599' : imp === 'MAJOR' ? '#e2d4f0' : '#9ca3af';

  return (
    <div
      className="min-h-[38px] px-3 py-1.5 rounded-[12px] flex items-center justify-between gap-2"
      style={{
        backgroundColor:
          imp === 'KEY'
            ? 'rgba(245, 184, 66, 0.08)'
            : imp === 'MAJOR'
            ? 'rgba(163, 113, 247, 0.08)'
            : 'rgba(255, 255, 255, 0.02)',
        border:
          imp === 'KEY'
            ? '1px solid rgba(245, 184, 66, 0.3)'
            : imp === 'MAJOR'
            ? '1px solid rgba(163, 113, 247, 0.28)'
            : '1px solid rgba(255, 255, 255, 0.06)',
        borderLeft: `3px solid ${borderColor}`,
        boxShadow: imp === 'KEY' ? '0 0 12px rgba(245, 184, 66, 0.2)' : undefined,
        opacity: imp === 'MINOR' ? 0.72 : 1,
        ...sansStyle,
      }}
    >
      <div className="flex items-center gap-2 leading-tight">
        <span className="text-[12px] shrink-0 select-none">🐋</span>
        <span
          className="text-[12px] font-bold whitespace-normal break-words leading-snug"
          style={{ color: labelColor }}
        >
          {row.label}
          {row.subLabel ? (
            <span className="ml-1.5 font-semibold text-[#8e8779]">{row.subLabel}</span>
          ) : null}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0" style={monoStyle}>
        <span className="text-[12px] font-bold text-[#e6e1d6] tabular-nums">
          ${row.price.toFixed(2)}
        </span>
        <span className="text-[10.5px] text-white/45 w-14 text-right tabular-nums">
          {formatDiff(row.distanceDiff)}
        </span>
      </div>
    </div>
  );
};

export const FireZoneLadderRow = React.memo(
  FireZoneLadderRowInner,
  (prev, next) => {
    if (prev.row.kind === 'NOW' || next.row.kind === 'NOW') {
      return prev.row.kind === next.row.kind && prev.livePrice === next.livePrice;
    }
    return (
      prev.row.id === next.row.id &&
      prev.row.price === next.row.price &&
      prev.row.label === next.row.label &&
      prev.row.subLabel === next.row.subLabel &&
      prev.row.isDimmed === next.row.isDimmed &&
      prev.row.isStar === next.row.isStar &&
      prev.row.levelImportance === next.row.levelImportance &&
      Math.round(prev.row.distanceDiff) === Math.round(next.row.distanceDiff)
    );
  }
);
