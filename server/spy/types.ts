/**
 * SPY Options-Signal Module - Server Types
 * Deterministic types for Market Data, Market Hours, Smart Money Gates, and History.
 */

export type SpyExpiryOption = '15m' | '30m' | '45m' | '1H' | '4H' | 'CLOSE';

export type SpySignalDecision = 'CALL' | 'PUT' | 'NO TRADE';

export interface SpyCandle {
  openTime: string; // ISO string
  timestamp: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
}

export interface SpyQuote {
  bidPrice: number;
  bidSize: number;
  askPrice: number;
  askSize: number;
  timestamp: number;
}

export interface SpyTrade {
  price: number;
  size: number;
  timestamp: number;
}

export interface SpyMarketHours {
  marketOpen: boolean;
  session: 'REGULAR' | 'PRE_MARKET' | 'AFTER_HOURS' | 'CLOSED' | 'WEEKEND' | 'HOLIDAY';
  minutesToClose: number;
  nextOpen: string;
  currentTimeET: string;
  isHoliday: boolean;
  holidayName?: string;
}

export interface SpyExpiryStatus {
  expiry: SpyExpiryOption;
  label: string;
  durationMinutes: number;
  enabled: boolean;
  disabledReason?: string;
  isLocked?: boolean;
  isCooldown?: boolean;
  cooldownSecondsLeft?: number;
  lockReason?: string;
}

export interface SpyGateEvaluation {
  id: string;
  letter: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
  name: string;
  passed: boolean;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  weight: number; // percentage weight out of 100
  score: number; // points earned
  detail: string;
  metric: string;
  threshold: string;
}

export interface SpyAnalysisResult {
  id: string;
  symbol: 'SPY';
  expiry: SpyExpiryOption;
  decision: SpySignalDecision;
  approxAtmStrike: number | null;
  confidence: number; // 0 - 100
  currentPrice: number;
  entryPrice: number | null;
  slPrice: number | null;
  tpPrice: number | null;
  riskReward: number | null;
  atr: number;
  expectedMove: number;
  distanceToTp: number | null;
  atrFeasible: boolean;
  gates: SpyGateEvaluation[];
  totalScore: number;
  reasons: string[];
  biasTimeframe: string;
  entryTimeframe: string;
  marketOpen: boolean;
  computedAt: string;
  expiresAt: string;
}

export interface SpyHistoryRecord {
  id: string;
  time: string;
  timestamp: number;
  expiry: SpyExpiryOption;
  direction: SpySignalDecision;
  approxAtmStrike: number | null;
  entry: number | null;
  sl: number | null;
  tp: number | null;
  riskReward: number | null;
  confidence: number;
  status: 'ACTIVE' | 'RESOLVED';
  outcome?: 'WIN' | 'LOSS';
  resolvedPrice?: number;
  resolvedAt?: string;
  resolutionReason?: string;
  maxFavorableMove: number;
  maxAdverseMove: number;
  gateResults: SpyGateEvaluation[];
  reasons: string[];
  expiresAt: string;
  expiresAtTimestamp: number;
}

export interface SpyExpiryStatItem {
  total: number;
  wins: number;
  losses: number;
  winRate: number | null; // null if total < 10 (collecting data)
  active: number;
}

export interface SpyHistoryStats {
  perExpiry: Record<SpyExpiryOption, SpyExpiryStatItem>;
  total: SpyExpiryStatItem;
  noTradeCount: number;
}

export interface SpyFeedState {
  symbol: 'SPY';
  status: 'LIVE' | 'MARKET CLOSED' | 'NO DATA' | 'CONNECTING' | 'STALE';
  currentPrice: number | null;
  changeDollar: number | null;
  changePercent: number | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayVolume: number | null;
  lastQuote: SpyQuote | null;
  lastTrade: SpyTrade | null;
  marketHours: SpyMarketHours;
  dataFreshnessMs: number;
  isFresh: boolean;
  source: 'ALPACA_IEX' | 'TWELVEDATA' | 'STORED_CACHE' | 'NONE';
  lastUpdated: string;
}
