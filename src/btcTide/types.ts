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
}

export interface OrderBookDepth {
  bids: DepthLevel[]; // Top 8 levels
  asks: DepthLevel[]; // Top 8 levels
  bidTotal: number;
  askTotal: number;
  imbalancePct: number | null; // ((bidTotal - askTotal) / (bidTotal + askTotal)) * 100
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
}

export interface PerpPositioning {
  markPrice: number | null;
  fundingRate: number | null;
  nextFundingTime: number | null;
  openInterest: number | null;
  oiChange1h: number | null;
  oiChange1hPct: number | null;
  basis: number | null; // markPrice - spotPrice
  basisBps: number | null;
  longShortRatio: number | null;
  longAccountPct: number | null;
  shortAccountPct: number | null;
  liquidations5m: LiquidationItem[];
  totalLiq5mUsd: number;
  longLiq5mUsd: number;
  shortLiq5mUsd: number;
  status: BtcFeedStatus;
  updatedAt: number;
}

export interface VenueItem {
  venue: string;
  price: number | null;
  volume24h: number | null;
  volSharePct: number | null;
  diffVsMedian: number | null;
  diffVsMedianBps: number | null;
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

export interface BtcTideStoreState {
  activeSource: 'BINANCE' | 'BYBIT';
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
  // Rolling store: last 30 minutes in per-second bins (1800 bins max)
  secondBins: SecondBin[];
  // Recent trades for the order tape (newest first)
  recentTrades: AggTrade[];
  // Large prints >= $50,000 USD (newest first, last 30 min)
  largePrints: AggTrade[];
}
