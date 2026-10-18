export type BtcFeedStatus = 'CONNECTING' | 'LIVE' | 'STALE' | 'OFFLINE';

export type WindowOption = '1m' | '5m' | '15m';

export type TapeSizeFilter = 'ALL' | '1K' | '10K' | '25K';

export interface AggTrade {
  id: string;
  time: number; // ms unix timestamp
  price: number;
  qty: number; // BTC qty
  usdValue: number; // price * qty
  aggressorSide: 'BUY' | 'SELL'; // m=true means SELLER, m=false means BUYER
}

export interface BookTicker {
  bid: number | null;
  ask: number | null;
  spread: number | null;
  spreadBps: number | null;
  updatedAt: number;
}

export interface DepthLevel {
  price: number;
  qty: number;
  total: number;
  depthPct: number;
  usdValue?: number;
  isWall?: boolean;
  multipleOfAvg?: number;
}

export interface OrderBookWall {
  side: 'BID' | 'ASK';
  price: number;
  qty: number;
  usdValue: number;
  multipleOfAvg: number;
}

export interface OrderBookDepth {
  bids: DepthLevel[]; // Top 8 levels
  asks: DepthLevel[]; // Top 8 levels
  bestBid?: number | null;
  bestAsk?: number | null;
  midPrice?: number | null;
  bidTotal: number;
  askTotal: number;
  bidUsd10?: number;
  askUsd10?: number;
  imbalancePct: number | null; // ((bidUSD - askUSD) / (bidUSD + askUSD)) * 100 over top 10 levels
  avgLevelSizeBtc?: number;
  walls?: OrderBookWall[];
  spread: number | null;
  spreadBps: number | null;
  updatedAt: number;
}

export interface LiquidationItem {
  id: string;
  time: number;
  side: 'BUY' | 'SELL'; // SELL = Long Liquidated, BUY = Short Liquidated
  qty: number;
  price: number;
  usdValue: number;
  source?: string;
}

export interface PerpFieldSources {
  markPrice: string;
  funding: string;
  basis: string;
  openInterest: string;
  longShort: string;
  liquidations: string;
}

export interface PerpPositioning {
  markPrice: number | null;
  fundingRate: number | null; // Always 8h-equivalent
  fundingRateNative?: number | null; // Native rate before 8h normalisation
  fundingIntervalHours?: number; // 1 for Hyperliquid, 8 for Binance/OKX/Bybit
  nextFundingTime: number | null;
  openInterest: number | null; // Always in BTC
  oiChange1h: number | null;
  oiChange1hPct: number | null;
  oiHistoryStatus?: string;
  oiHistoryMinutes?: number;
  basis: number | null; // markPrice - spotPrice
  basisBps: number | null;
  longShortRatio: number | null;
  longAccountPct: number | null;
  shortAccountPct: number | null;
  longShortMeasure?: 'Accounts' | 'Positions';
  liquidations5m: LiquidationItem[];
  recentLiquidations?: LiquidationItem[];
  totalLiq5mUsd: number;
  longLiq5mUsd: number;
  shortLiq5mUsd: number;
  sources?: PerpFieldSources;
  status: BtcFeedStatus;
  updatedAt: number;
}

export interface ReconcileResult {
  timestamp: number;
  isoTime: string;
  spotExchange: string;
  wsSpotPrice: number | null;
  restSpotPrice: number | null;
  spotDiffPct: number | null;
  spotMismatch: boolean;
  bookExchange: string;
  wsBookMid: number | null;
  restBookMid: number | null;
  bookDiffPct: number | null;
  bookMismatch: boolean;
  status: 'PASS' | 'FAIL' | 'PENDING';
  detail: string;
}

export interface VenueItem {
  venue: string;
  price: number | null;
  volume24h: number | null;
  volSharePct: number | null;
  diffVsMedian: number | null;
  diffVsMedianBps: number | null;
  isOutlier?: boolean;
  errorReason?: string | null;
  status: 'ONLINE' | 'OFFLINE';
}

export interface VenuesTableData {
  venues: VenueItem[];
  medianPrice: number | null;
  spread: number | null;
  highestVenue: string | null;
  lowestVenue: string | null;
  totalVolumeBtc: number;
  updatedAt: number;
}

export interface SecondBin {
  sec: number; // Unix timestamp in seconds (Math.floor(time / 1000))
  buyVol: number; // BTC
  sellVol: number; // BTC
  buyUsd: number; // USD
  sellUsd: number; // USD
  count: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  lastPrice: number;
  largePrintMaxUsd: number; // Highest single trade USD >= $50k in this second (0 if none)
  largePrintSide: 'BUY' | 'SELL' | null;
}

export interface SessionStats {
  sessionHigh: number | null;
  sessionLow: number | null;
  ticksSeen: number;
  firstTickTime: number | null;
}

export interface WindowFlowStats {
  buyVolBtc: number;
  sellVolBtc: number;
  buyVolUsd: number;
  sellVolUsd: number;
  deltaBtc: number;
  deltaUsd: number;
  totalVolBtc: number;
  totalVolUsd: number;
  tradeCount: number;
  buyFlowPct: number | null;
  sellFlowPct: number | null;
  secondsCollected: number;
  windowSeconds: number;
  isFullWindow?: boolean;
}

export interface WaveformEventLabel {
  sec: number;
  type: 'ABSORB' | 'DRIVE';
  side: 'BUY' | 'SELL';
  price: number;
  netVolBtc: number;
  priceChange: number;
  atr6s: number;
}

export interface TenSecDeltaBar {
  bucketSec: number; // start of 10s bucket (Math.floor(sec / 10) * 10)
  buyVol: number;
  sellVol: number;
  deltaBtc: number;
  deltaUsd: number;
  count: number;
  lastPrice: number;
  isPartial?: boolean;
}

export type HeroSceneMode = 'TUG_OF_WAR' | 'FLOW_REACTOR';

export type HeroFxLevel = 'HIGH' | 'LITE' | 'OFF';

export interface ActiveTideSignal {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
  triggeredAt: number;
  reason: string;
}

import type { BtcTideTradeRecord, BtcTideStats } from '../server/btcTideSignalDatabase';
import type { DecisionEngineResult } from './signalEngine';

export interface FeedDotItem {
  id: 'SPOT' | 'BOOK' | 'PERPS' | 'VENUES';
  label: string;
  ageMs: number;
  source: string;
  isStale: boolean;
}

export interface BtcTideStoreState {
  activeSource: string;
  status: BtcFeedStatus;
  statusText: string;
  lastMessageTime: number | null;
  messageAgeMs: number;
  reconnectAttempts: number;
  currentPrice: number | null;
  priceFlash: 'up' | 'down' | 'none';
  bookTicker: BookTicker;
  depth: OrderBookDepth;
  perp: PerpPositioning;
  venues: VenuesTableData;
  session: SessionStats;
  selectedWindow: WindowOption;
  activeSignal: ActiveTideSignal | null;
  decision: DecisionEngineResult;
  activeTrade: BtcTideTradeRecord | null;
  closedTrades: BtcTideTradeRecord[];
  signalStats: BtcTideStats;
  feedAges: {
    spot: number;
    book: number;
    perps: number;
    venues: number;
  };
  feedSources: {
    spot: string;
    book: string;
    perps: string;
    venues: string;
  };
  feedStale: {
    spot: boolean;
    book: boolean;
    perps: boolean;
    venues: boolean;
  };
  reconcile?: ReconcileResult;
  geoBlockedNotice: string | null;
  // Rolling store: last 30 minutes in per-second bins (1800 bins max)
  secondBins: SecondBin[];
  // Recent trades for the order tape (newest first)
  recentTrades: AggTrade[];
  // Large prints >= $50,000 USD (newest first, last 30 min)
  largePrints: AggTrade[];
}
