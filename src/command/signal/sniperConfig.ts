/**
 * AHMED SNIPER CHAIN & SIGNAL ENGINE CONFIGURATION
 * All thresholds and institutional strategy parameters are centralized here.
 */

export interface SniperConfig {
  // Risk & Target Parameters ($ offsets from entry)
  slOffsetDollars: number;       // $10 away (1R risk unit)
  tp1OffsetDollars: number;      // $5 away (0.5R)
  tp2OffsetDollars: number;      // $8 away (0.8R)
  tp3OffsetDollars: number;      // $12 away (1.2R)

  // Lifecycle Timings
  cooldownDurationSeconds: number; // 30 minutes (1800s)

  // Entry Filtering Rules
  minConfidencePercent: number;    // At least 65% confidence
  minPathClearDollars: number;     // At least 1R ($10) clear to opposing liquidity/zone
  maxSpreadEntryDollars: number;   // Maximum allowed spread at entry ($1.20)
  minFlowRatioPercent: number;     // Minimum dominant flow ratio (55%)

  // Ahmed Sniper Chain Gate Parameters
  w1d1SwingLookback: number;       // Bars to lookback for daily swing high/low
  h4SweepTolerance: number;        // Tolerance in dollars to confirm H4 liquidity sweep
  h1DisplacementMin: number;       // Minimum H1 move size in dollars for BOS/CHoCH
  m30FvgMinSize: number;           // Minimum M30 FVG pocket in dollars ($0.80)
  m15BodyRatioMin: number;         // Minimum M15 body-to-range ratio (50%)
  m5RetestBuffer: number;          // Retest proximity buffer in dollars ($2.50)
  m5WickRejectionRatio: number;    // Minimum wick-to-body ratio for M5 confirmation (1.2x)

  // History & Logging
  maxHistoryEntries: number;       // Last 20 signals logged
}

export const SNIPER_CONFIG: SniperConfig = {
  // Every setup: Entry = price at issue, SL = $10 away, TP1 = $5, TP2 = $8, TP3 = $12
  slOffsetDollars: 10.0,
  tp1OffsetDollars: 5.0,
  tp2OffsetDollars: 8.0,
  tp3OffsetDollars: 12.0,

  // After TP3 hit or SL hit, or manual close: 30-minute cooldown (1800s)
  cooldownDurationSeconds: 30 * 60,

  // A signal is issued only when all gates PASS in the same direction AND confidence is at least 65% AND path is at least 1R (10 dollars) clear
  minConfidencePercent: 65,
  minPathClearDollars: 10.0,
  maxSpreadEntryDollars: 1.2,
  minFlowRatioPercent: 55.0,

  // Gate Analysis Lookbacks & Tolerances
  w1d1SwingLookback: 20,
  h4SweepTolerance: 3.0,
  h1DisplacementMin: 2.0,
  m30FvgMinSize: 0.8,
  m15BodyRatioMin: 0.5,
  m5RetestBuffer: 2.5,
  m5WickRejectionRatio: 1.2,

  maxHistoryEntries: 20,
};
