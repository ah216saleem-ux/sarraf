// server/atlas/atlasTypes.ts

export type AtlasZoneSide = 'SELL' | 'BUY' | 'NEUTRAL';
export type AtlasZoneType = 'SUPPLY' | 'DEMAND' | 'SARRAF_ZONE';
export type AtlasTier = 'T1 PRIMARY' | 'T2 STRONG' | 'T3 EXTREME' | 'SARRAF ZONE';
export type AtlasGrade = 'A' | 'B';
export type AtlasZoneStatus = 'FRESH' | 'TESTED' | 'BROKEN';

export type LiquidityStatus = 'INTACT' | 'SWEPT';
export type LiquidityType =
  | 'PDH'
  | 'PDL'
  | 'ASIA_HIGH'
  | 'ASIA_LOW'
  | 'LONDON_HIGH'
  | 'LONDON_LOW'
  | 'PREV_WEEK_HIGH'
  | 'PREV_WEEK_LOW';

export interface AtlasLiquidityLevel {
  id: LiquidityType;
  label: string;
  price: number;
  type: 'HIGH' | 'LOW';
  status: LiquidityStatus;
  sessionTime?: string;
  sweptTime?: string;
  sweptPrice?: number;
  distanceToLive: number;
  nearestZoneId?: string;
  nearestZoneDist?: number;
}

export interface AtlasAlertLogItem {
  id: string;
  timestamp: string;
  eventType: 'APPROACH' | 'TOUCH' | 'BROKEN' | 'PUBLISH';
  zoneId?: string;
  zoneName?: string;
  tier?: string;
  grade?: string;
  price: number;
  message: string;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  telegramChatId?: string;
}

export interface AtlasBreakInfo {
  breakTime: string;
  breakCandleClose: number;
  participationRatio?: number;
  reason: string;
}

export interface AtlasPivotLevels {
  H: number;
  L: number;
  C: number;
  PP: number;
  R1: number;
  S1: number;
  R2: number;
  S2: number;
  R3: number;
  S3: number;
}

export interface AtlasZone {
  id: 'R3' | 'R2' | 'R1' | 'PP' | 'S1' | 'S2' | 'S3';
  name: string;
  level: number;
  top: number;
  bottom: number;
  halfWidth: number;
  side: AtlasZoneSide;
  type: AtlasZoneType;
  tier: AtlasTier;
  grade: AtlasGrade;
  touchesCount: number;
  reason: string;
  confluenceList?: string[];
  isCurrentPriceInside?: boolean;
  status: AtlasZoneStatus;
  touchesToday: number;
  isFlipped?: boolean;
  flippedRole?: string;
  breakInfo?: AtlasBreakInfo | null;
  hasLiquidityBadge?: boolean;
  liquidityReason?: string;
  ppRelation?: 'ABOVE' | 'BELOW';
  ppLastCrossTime?: string;
}

export interface AtlasZoneReportItem {
  zoneId: string;
  name: string;
  level: number;
  side: AtlasZoneSide;
  outcome: 'RESPECTED' | 'BROKEN' | 'IGNORED';
  reversalPoints?: number;
  notes: string;
}

export interface AtlasReportCard {
  date: string;
  evaluatedAt: string;
  zones: AtlasZoneReportItem[];
  totalEvaluated: number;
  respectedCount: number;
  brokenCount: number;
  ignoredCount: number;
  accuracyPercent: number;
}

export interface AtlasHistoryEntry {
  date: string;
  publishedAt: string;
  nextPublishAt?: string;
  prevDayCandle: {
    date: string;
    high: number;
    low: number;
    close: number;
  };
  pivots: AtlasPivotLevels;
  zones: AtlasZone[];
  bias: AtlasBias;
  scenarios?: {
    main: AtlasScenario;
    alternate: AtlasScenario;
  };
  targets?: {
    sell: { label: string; price: number }[];
    buy: { label: string; price: number }[];
  };
  invalidation?: {
    sell: string;
    buy: string;
  };
  reportCard?: AtlasReportCard | null;
  liquidityLevels?: AtlasLiquidityLevel[];
  alertLogs?: AtlasAlertLogItem[];
}

export interface TimeframeTrend {
  timeframe: 'MN' | 'W1' | 'D1' | 'H4' | 'H1';
  trend: 'BULLISH' | 'BEARISH' | 'RANGE' | 'NO DATA';
  ema50: number | null;
  ema100: number | null;
  ema200: number | null;
  structure: string;
  weight: number;
}

export interface AtlasBias {
  overall: 'BULLISH' | 'BEARISH' | 'RANGE';
  strategy: 'BUY_DIP' | 'SELL_RALLY' | 'RANGE_PLAY';
  strategyLabel: string;
  score: number;
  timeframes: TimeframeTrend[];
}

export interface AtlasScenario {
  type: 'MAIN' | 'ALTERNATE';
  title: string;
  bias: string;
  description: string;
  triggerZone: string;
  invalidation: string;
  targets: { label: string; price: number }[];
}

export interface AtlasIndicators {
  atr14: number;
  ema50: number;
  ema100: number;
  ema200: number;
  participationRatio: number;
  participationLabel: string;
  participationStatus: 'HIGH' | 'NORMAL' | 'LOW';
}

export interface AtlasSummary {
  trend: string;
  momentum: string;
  priceAction: 'AT SUPPLY' | 'AT DEMAND' | 'MID-RANGE';
  volume: string;
  volatility: string;
  risk: 'LOW' | 'MODERATE' | 'HIGH';
}

export interface AtlasLiveTradeState {
  status: 'STANDBY' | 'IN_ZONE';
  activeZone: AtlasZone | null;
  entrySide: 'SELL' | 'BUY' | null;
  entryPrice: number | null;
  distanceToEntry: number;
  livePnLPoints: number;
  nearestZone: {
    id: string;
    name: string;
    distance: number;
    side: AtlasZoneSide;
  } | null;
}

export interface AtlasState {
  date: string;
  status: 'PUBLISHED' | 'ANALYZING';
  marketStatus: 'LIVE' | 'MARKET_CLOSED' | 'OFFLINE';
  publishedAt: string | null;
  nextPublishAt: string;
  countdownSeconds: number;
  countdownText: string;
  prevDayCandle: {
    date: string;
    high: number;
    low: number;
    close: number;
  } | null;
  pivots: AtlasPivotLevels | null;
  zones: AtlasZone[];
  bias: AtlasBias | null;
  summary?: AtlasSummary | null;
  targets: {
    sell: { label: string; price: number }[];
    buy: { label: string; price: number }[];
  };
  invalidation: {
    sell: string;
    buy: string;
  };
  scenarios: {
    main: AtlasScenario;
    alternate: AtlasScenario;
  } | null;
  indicators: AtlasIndicators | null;
  livePrice: number;
  lastTickTime: number;
  tradeState: AtlasLiveTradeState;
  yesterdayReportCard: AtlasReportCard | null;
  rollingAccuracy7d: number | null | string;
  historyList: AtlasHistoryEntry[];
  liquidityLevels: AtlasLiquidityLevel[];
  alertsEnabled: boolean;
  alertLogs: AtlasAlertLogItem[];
  h1Candles?: {
    openTime: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];
}
