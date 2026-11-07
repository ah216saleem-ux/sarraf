/**
 * SARRAF WHALES — shared types.
 *
 * Design rule (from research): the AI never invents a price.
 * Code builds candidate zones from real candles; Gemini only picks
 * candidate IDs (or NO_TRADE). Code then derives entry / SL / TP.
 */

export interface WCandle {
  time: number; // unix seconds (candle open)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type ZoneSide = 'BUY' | 'SELL';

export type ZoneSource =
  | 'ORDER_BLOCK'
  | 'FVG'
  | 'SWING'
  | 'PREV_DAY'
  | 'SESSION'
  | 'ROUND'
  | 'VOLUME_NODE'
  | 'ORDER_BOOK';

export type ZoneStatus = 'FRESH' | 'TESTED' | 'SWEPT' | 'FAILED' | 'RECLAIMED';

export interface CandidateZone {
  id: string; // e.g. "B3" / "S1"
  side: ZoneSide;
  low: number;
  high: number;
  mid: number;
  score: number; // 0-100, deterministic
  sources: ZoneSource[];
  timeframe: string; // origin timeframe(s)
  touches: number;
  status: ZoneStatus;
  distance: number; // $ from current price to nearest edge
  note: string;
}

export interface CotSnapshot {
  reportDate: string;
  managedMoneyLong: number | null;
  managedMoneyShort: number | null;
  managedMoneyNet: number | null;
  netChangeWeek: number | null;
  openInterest: number | null;
  netPercentile52w: number | null; // 0-100 vs last 52 weeks
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  source: string;
  fetchedAt: string;
}

export interface OrderBookCluster {
  price: number;
  longPct: number;
  shortPct: number;
  kind: 'ORDERS' | 'POSITIONS';
}

export interface OrderBookSnapshot {
  time: string;
  price: number;
  clusters: OrderBookCluster[]; // top clusters near price
  fetchedAt: string;
}

export interface NewsGate {
  blocked: boolean;
  reason: string | null;
  nextHighImpact: { title: string; timeUtc: string; minutesUntil: number } | null;
}

export interface MarketSnapshot {
  price: number;
  spread: number;
  time: string;
  marketOpen: boolean;
  atr: { m5: number; m15: number; h1: number; d1: number };
  dayRangeUsed: number; // today's range / avg daily range (0..)
  session: 'ASIA' | 'LONDON' | 'NEW_YORK' | 'OFF';
  trendH1: 'UP' | 'DOWN' | 'RANGE';
  trendH4: 'UP' | 'DOWN' | 'RANGE';
  candidates: CandidateZone[];
  cot: CotSnapshot | null;
  orderBook: OrderBookSnapshot | null;
  news: NewsGate;
  whales: WhaleEvent[];
}

export interface WhaleEvent {
  time: string;
  side: 'BUYER' | 'SELLER';
  price: number;
  kind: 'BURST' | 'ABSORPTION';
  size: number; // relative size vs normal (x)
  atZone: string | null;
}

export type PlanSide = 'BUY' | 'SELL' | 'NONE';

export interface TradePlan {
  id: string;
  createdAt: string;
  side: PlanSide;
  zoneId: string | null;
  entryLow: number | null;
  entryHigh: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  slDistance: number | null;
  rr1: number | null;
  confidence: number; // 0-100
  bias: 'BUY' | 'SELL' | 'NEUTRAL';
  reasoning: string[];
  rankedZoneIds: string[]; // AI ranking of the candidate list
  decidedBy: 'AI' | 'RULES';
  model: string | null;
  rejected: string[]; // validator notes
  expiresAt: string;
}

export type TradeState = 'WAITING' | 'ACTIVE' | 'TP1' | 'TP2' | 'CLOSED';

export type TradeResult = 'TP3' | 'TP2_BE' | 'TP1_BE' | 'SL' | 'EXPIRED' | 'CANCELLED';

export interface WhaleTrade {
  id: string;
  planId: string;
  side: 'BUY' | 'SELL';
  zoneId: string | null;
  entryLow: number;
  entryHigh: number;
  state: TradeState;
  entry: number | null;
  sl: number;
  initialSl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  openedAt: string | null;
  closedAt: string | null;
  result: TradeResult | null;
  pnl: number | null; // $ per 1 oz, weighted by partial closes
  r: number | null;
  createdAt: string;
  armedUntil: string; // plan validity for entry
}

export interface AgentRun {
  id: string;
  time: string;
  trigger: string;
  decidedBy: 'AI' | 'RULES';
  planSide: PlanSide;
  zoneId: string | null;
  confidence: number;
  candidateCount: number;
  latencyMs: number;
  error: string | null;
  summary: string;
}

export interface WhalesState {
  version: 1;
  plan: TradePlan | null;
  trades: WhaleTrade[];
  runs: AgentRun[];
  memory: string[]; // short lessons from daily self-review
  zoneStatus: Record<string, { status: ZoneStatus; at: string }>; // key: side:roundedMid
  cooldownUntil: string | null;
  lastReviewDate: string | null;
}
