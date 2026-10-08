export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';

export type TickDirection = 'BUY' | 'SELL' | 'FLAT';

export interface CommandTick {
  id: string;
  price: number;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number; // epoch ms
  isoTime: string;
  direction: TickDirection;
  delta: number;
  volume: number; // estimated tick volume
}

export interface Candle {
  time: number; // epoch ms start of candle
  openTimeStr: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed?: boolean;
}

export interface MinuteFlowBucket {
  minuteTimestamp: number;
  label: string; // HH:MM
  netTicks: number; // buyTicks - sellTicks
  buyTicks: number;
  sellTicks: number;
  dollarVolume: number; // sum of price * volume
  impactDollarsPerTick: number;
}

export interface ZoneItem {
  id: string;
  type: 'BUY_ZONE' | 'SELL_ZONE' | 'SUPPORT' | 'RESISTANCE' | 'EQL' | 'EQH' | 'MAJOR';
  label: string;
  low: number;
  high: number;
  mid: number;
  status: 'tested' | 'fresh';
  touchCount: number;
  strength: number; // 0 - 100
}

export interface OriginDisplacement {
  id: string;
  originPrice: number;
  targetPrice: number;
  displacementPips: number;
  timeAgo: string;
  powerScore: number; // 0 - 100
  direction: 'BULLISH' | 'BEARISH';
}

export interface OriginLevel {
  priceLevel: number;
  volumeWeight: number; // 0 - 100 relative
  displacementsCount: number;
}

export interface MarketRegimeData {
  trend: 'STRONG BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG BEARISH' | 'N/A' | 'collecting data';
  structure: 'BOS (BREAK OF STRUCTURE)' | 'CHOCH (CHANGE OF CHARACTER)' | 'CONSOLIDATION RANGE' | 'N/A' | 'collecting data';
  volatility: 'LOW' | 'NORMAL' | 'EXPANSION' | 'N/A';
  session: 'ASIAN' | 'LONDON' | 'NEW YORK' | 'LONDON/NY OVERLAP' | 'SESSION CLOSE';
  newsImpact: 'CALM' | 'MODERATE' | 'HIGH USD IMMINENT' | 'POST-RELEASE VOLATILITY' | 'N/A' | 'collecting data';
  htfBias: 'BULLISH CONTINUATION' | 'BEARISH RETRACEMENT' | 'NEUTRAL RANGE' | 'N/A' | 'collecting data';
}

export interface ConfidenceBreakdown {
  flow: number; // 0 - 100
  structure: number;
  liquidity: number;
  momentum: number;
  sentiment: number;
  overall: number;
}

export interface FeedConnectionState {
  status: 'LIVE' | 'RECONNECTING' | 'MARKET_CLOSED' | 'OFFLINE';
  isLive: boolean;
  lastTickTime: number;
  quoteAgeSeconds: number;
  reconnectAttempts: number;
  source: string;
}
