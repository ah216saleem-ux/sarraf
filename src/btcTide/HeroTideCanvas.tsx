import React from 'react';
import { LiquidityTapeCanvas } from './LiquidityTapeCanvas';
import {
  SecondBin,
  BtcFeedStatus,
  ActiveTideSignal,
  BookTicker,
  SessionStats,
  HeatmapColumn,
  AggTrade,
} from './types';
import { DecisionEngineResult } from './signalEngine';
import { BtcTideTradeRecord } from '../server/btcTideSignalDatabase';

export interface HeroTideCanvasProps {
  currentPrice: number | null;
  priceFlash?: 'up' | 'down' | 'none';
  status: BtcFeedStatus;
  messageAgeMs: number;
  secondBins: SecondBin[];
  activeSignal: ActiveTideSignal | null;
  activeTrade?: BtcTideTradeRecord | null;
  decision?: DecisionEngineResult;
  bookTicker?: BookTicker;
  session?: SessionStats;
  isSpotStale?: boolean;
  spotAgeMs?: number;
  isBookStale?: boolean;
  bookAgeMs?: number;
  heatmapHistory?: HeatmapColumn[];
  recentTrades?: AggTrade[];
}

/**
 * Replaced both previous hero scenes (Reactor and Tide) with the data-literal LIQUIDITY TAPE.
 */
export const HeroTideCanvas: React.FC<HeroTideCanvasProps> = React.memo((props) => {
  return <LiquidityTapeCanvas {...props} />;
});

HeroTideCanvas.displayName = 'HeroTideCanvas';
export { LiquidityTapeCanvas };
