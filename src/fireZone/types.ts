// src/fireZone/types.ts
import type { DualStructureResult } from './structure';

export type FireZoneTimeframe = '1H';

export interface Candle {
  time: number; // unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type FireZoneCandle = Candle;

export type PivotType = 'HIGH' | 'LOW';
export type PivotLevel = 5 | 15 | 20 | 50;

export interface Pivot {
  index: number;
  time: number;
  type: PivotType;
  price: number;
  level: PivotLevel;
  volume: number;
}

export type StructureEventType = 'BOS' | 'CHoCH';

export interface StructureEvent {
  barIndex: number;
  time: number;
  direction: 1 | -1; // 1 = bullish break, -1 = bearish break
  type: StructureEventType;
  brokenPivotPrice: number;
  brokenPivotIndex: number;
  closePrice: number;
}

export type ZoneSide = 'BUY' | 'SELL';
export type ZoneType = 'NEAREST' | 'DEEP' | 'SWING';
export type ZoneStrengthLabel = 'CRITICAL' | 'STRONG' | 'MODERATE' | 'MEDIUM';

export type ZoneLifecycleState =
  | 'FRESH'
  | 'TESTING'
  | 'PLAYED_HELD'
  | 'BROKEN'
  | 'EXPIRED';

export type RetiredZoneResult = 'HELD' | 'BROKEN' | 'EXPIRED';

export interface RetiredZoneHistoryItem {
  id: string;
  side: ZoneSide;
  anchor: number;
  type: ZoneType;
  result: RetiredZoneResult;
  candleTime: number;
  moveAfter: number; // in $
  nextZoneAnchor?: number;
}

export interface FlippedLevelCandidate {
  anchor: number;
  fromSide: ZoneSide;
  toSide: ZoneSide;
  brokenCandleTime: number;
  brokenBarIndex: number;
  bonusScore: number; // +2 rank bonus
}

export interface FlipWatch {
  id: string; // "F" + Math.round(anchor), e.g. "F4103"
  fromZoneId?: string;
  side: ZoneSide; // opposite side of the broken zone (new target side once confirmed)
  anchor: number;
  score: number;
  armed: boolean;
  confirmed: boolean;
  brokenAtTime?: number;
  brokenBarIndex?: number;
}

export interface FireZonePersistedState {
  version: 1;
  activeZones: Array<{
    id: string;
    side: ZoneSide;
    anchor: number;
    type: ZoneType;
    state: 'FRESH'; // TESTING is transient and never saved
    createdBarTime: number;
    score: number;
  }>;
  history: RetiredZoneHistoryItem[];
  flippedLevels: FlippedLevelCandidate[];
}

export interface FireZonePersistedStateV2 {
  version: 2;
  activeZoneIds: string[];
  activeZones: Array<{
    id: string;
    side: ZoneSide;
    anchor: number;
    type: ZoneType;
    state: 'FRESH';
    createdBarTime: number;
    score: number;
    retests?: number;
  }>;
  brokenIds: string[];
  flipWatches: FlipWatch[];
  events: string[];
  history?: RetiredZoneHistoryItem[];
}


export type LevelSourceKind =
  | 'H1'
  | 'H4'
  | 'D1'
  | 'PDH'
  | 'PDL'
  | 'PWH'
  | 'PWL'
  | 'EQH'
  | 'EQL'
  | 'ROUND_100'
  | 'ROUND_50'
  | 'FLIP';

export type LevelImportance = 'KEY' | 'MAJOR' | 'MINOR';
export type LevelKind =
  | 'PDH'
  | 'PDL'
  | 'PWH'
  | 'PWL'
  | 'EQH'
  | 'EQL'
  | 'ROUND_NUMBER'
  | 'PIVOT'
  | 'FLIP';

export interface LevelWall {
  id: string;
  price: number;
  kind: LevelKind;
  label: string;
  sources: LevelSourceKind[];
  touches: number;
  score: number;
  rank: number; // 1 = highest score (importance rank, NOT vertical position)
  importance: LevelImportance; // rank 1-2 = KEY, rank 3-5 = MAJOR, rest = MINOR
  distance: number;
  anchorBarIndex?: number;
  anchorTime?: number;
  allowedSide?: ZoneSide; // set when created from a flipped broken zone
}

export interface FireZone {
  id: string;
  side: ZoneSide;
  top: number; // anchor + 2
  bottom: number; // anchor - 2
  anchor: number; // level price
  levelId?: string;
  sources?: LevelSourceKind[];
  pivotIndex: number;
  pivotTime: number;
  pivotPrice: number;
  pivotLevel: PivotLevel;
  isLive: boolean;
  isDead: boolean;
  lifecycleState?: ZoneLifecycleState; // FRESH or TESTING (live)
  isFlipped?: boolean;
  deathBarIndex?: number;
  deathTime?: number;
  barsAgoBroken?: number;
  touches: number;
  score: number; // 007 level importance score (>=12 CRITICAL, >=8 STRONG, else MEDIUM)
  label: ZoneStrengthLabel;
  type?: ZoneType; // NEAREST, SWING, DEEP
  isStar?: boolean;
  distance: number; // distance from current price (0 if inside zone)
}

export interface TradePlan {
  side: ZoneSide;
  zoneType: ZoneType;
  zoneId: string;
  isActive: boolean;
  entryRange: [number, number]; // [LO, HI] = [anchor-2, anchor+2]
  entryPrice: number; // HI for BUY, LO for SELL
  anchor: number; // midpoint (level price)
  zoneLabel: ZoneStrengthLabel;
  zoneScore: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  risk: number; // |entry - sl|
  rrTp1: number; // |tp1 - entry| / risk
  distance: number;
  isStar?: boolean;
}

export interface GateItem {
  id: string;
  label: string;
  passed: boolean;
  reasonIfFailed: string;
}

export interface GateEvaluation {
  gates: GateItem[];
  passedCount: number;
  totalGates: number;
  tradeAllowed: boolean;
  signal: 'BUY' | 'SELL' | 'WAIT';
  biasLabel: 'BUY' | 'SELL' | 'RANGE';
  htfLabel: 'UP' | 'DOWN';
  buyPct: number;
  waitPct: number;
  sellPct: number;
  whatToDoNow: string;
}

export type LadderRowKind =
  | 'RETEST'
  | 'ENTRY_HI'
  | 'ENTRY_LO'
  | 'SL'
  | 'TP1'
  | 'TP2'
  | 'TP3'
  | 'LEVEL'
  | 'NOW';

export interface LadderRow {
  id: string;
  kind: LadderRowKind;
  label: string;
  subLabel?: string;
  price: number;
  distanceDiff: number; // row.price - currentPrice
  side?: ZoneSide;
  zoneType?: ZoneType;
  strengthLabel?: ZoneStrengthLabel;
  isStar?: boolean;
  isDimmed?: boolean;
  levelImportance?: LevelImportance;
  levelNumber?: number;
}

export interface FireZoneEngineResult {
  timeframe: FireZoneTimeframe;
  lastClosedH1Time: number;
  currentPrice: number;
  atr: number;
  zoneHeight: number; // Always 4.00 ($4 wide = anchor +/- $2)
  trend: 1 | -1 | 0; // SWING (L=20 H1) structure trend feeding signal bias
  internalTrend: 1 | -1 | 0; // INTERNAL (L=5 H1) structure trend
  htfTrend: 1 | -1 | 0; // L=15 / H4 structure trend
  activeSide: ZoneSide; // trend > 0 -> BUY, trend < 0 -> SELL, trend === 0 -> closer
  buyZones: FireZone[];
  sellZones: FireZone[];
  allZones: FireZone[];
  deadZones: FireZone[];
  recentlyBroken: FireZone[];
  retiredHistory: RetiredZoneHistoryItem[]; // Last 10 retired zones (HELD / BROKEN / EXPIRED)
  latestLevelEvent: string | null; // Formatted sentence for LEVEL EVENTS card
  levelEvents?: string[]; // Last 4 lifecycle events (BROKE / FLIP / HELD)
  brokenIds?: string[];
  flipWatches?: FlipWatch[];
  structureEvents: StructureEvent[];
  dualStructure: DualStructureResult;
  levels: LevelWall[]; // Kept levels within +/-12*ATR(H1) + zone anchors
  allRankedLevels: LevelWall[]; // Full ranked level table
  activePlan: TradePlan | null;
  buyNearestPlan: TradePlan | null;
  sellNearestPlan: TradePlan | null;
  plans: TradePlan[];
  gateEval: GateEvaluation;
  ladder: LadderRow[];
}

