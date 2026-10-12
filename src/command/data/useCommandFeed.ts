import { useSyncExternalStore } from 'react';
import { commandStore } from './commandFeedStore';
import {
  CommandTick,
  Candle,
  Timeframe,
  MinuteFlowBucket,
  ZoneItem,
  OriginDisplacement,
  OriginLevel,
  MarketRegimeData,
  ConfidenceBreakdown,
  FeedConnectionState,
} from './commandTypes';

export interface NearestZoneData {
  label: string;
  price: number;
  distance: number;
}

export interface UseCommandFeedResult {
  hasReceivedTick: boolean;
  currentPrice: number;
  previousPrice: number;
  bid: number;
  ask: number;
  spread: number;
  open24h: number;
  previousClose: number;
  high24h: number;
  low24h: number;
  change24h: number;
  changePercent24h: number;
  tickDirection: 'BUY' | 'SELL' | 'FLAT';
  connection: FeedConnectionState;
  sparkline: number[];
  tickTape: CommandTick[];
  tickHistory: CommandTick[];
  candles: Candle[];
  selectedTimeframe: Timeframe;
  setTimeframe: (tf: Timeframe) => void;
  minuteFlows: MinuteFlowBucket[];
  spreadHistory: number[];
  volumeHistory: number[];
  absorptionBuyZones: ZoneItem[];
  absorptionSellZones: ZoneItem[];
  liquidityZones: ZoneItem[];
  originLevels: OriginLevel[];
  originDisplacements: OriginDisplacement[];
  regime: MarketRegimeData;
  confidence: ConfidenceBreakdown;
  buyTicks60s: number;
  sellTicks60s: number;
  flatTicks60s: number;
  buyVolumeDollar60s: number;
  sellVolumeDollar60s: number;
  buyDeltaSum60s: number;
  sellDeltaSum60s: number;
  buyRatio: number;
  sellRatio: number;
  liquidityGrade: 'HIGH' | 'MED' | 'LOW';
  nearestZone: NearestZoneData | null;
  nearestFvgOrOb: string;
  lastTickTimestamp: number;
  lastCandleTimestamp: number;
  lastNewsTimestamp: number;
  lastDerivedTimestamp: number;
}

export function formatFreshness(timestamp: number): string {
  if (!timestamp || timestamp <= 0) return 'collecting data';
  const ageSec = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (ageSec <= 1) return 'live';
  return `updated ${ageSec}s ago`;
}

// Window: 60-second rolling tick tape window
export function compute60sFlowRatios(buyTicks: number, sellTicks: number): { buyRatio: number; sellRatio: number; totalTicks: number } {
  const total = buyTicks + sellTicks;
  if (total <= 0) {
    return { buyRatio: 50, sellRatio: 50, totalTicks: 0 };
  }
  const buyRatio = Number(((buyTicks / total) * 100).toFixed(1));
  const sellRatio = Number((100 - buyRatio).toFixed(1));
  return { buyRatio, sellRatio, totalTicks: total };
}

export function useCommandFeed(): UseCommandFeedResult {
  // Synchronous subscription to single commandStore state so all components re-render in the exact same tick
  useSyncExternalStore(
    (onStoreChange) => commandStore.subscribe(onStoreChange),
    () => commandStore.version
  );

  // Window: 60-second rolling tick tape window
  const buyRatio = commandStore.buyRatio;
  const sellRatio = commandStore.sellRatio;
  const total60 = commandStore.buyTicks60s + commandStore.sellTicks60s;

  // Liquidity grade derived from live spread & tick rate
  let liquidityGrade: 'HIGH' | 'MED' | 'LOW' = 'HIGH';
  if (commandStore.spread > 0.45 || total60 < 10) {
    liquidityGrade = 'LOW';
  } else if (commandStore.spread > 0.32 || total60 < 25) {
    liquidityGrade = 'MED';
  }

  // Nearest key zone from real liquidity zones (null if still collecting data)
  const p = commandStore.currentPrice;
  let nearestZone: NearestZoneData | null = null;
  if (commandStore.liquidityZones.length > 0 && p > 0) {
    let minDiff = Infinity;
    for (const z of commandStore.liquidityZones) {
      const diff = Math.abs(z.mid - p);
      if (diff < minDiff) {
        minDiff = diff;
        nearestZone = {
          label: z.label,
          price: Number(z.mid.toFixed(2)),
          distance: Number(diff.toFixed(2)),
        };
      }
    }
  }

  const activeCandles = commandStore.candles[commandStore.selectedTimeframe] || [];

  return {
    hasReceivedTick: commandStore.hasReceivedTick,
    currentPrice: commandStore.currentPrice,
    previousPrice: commandStore.previousPrice,
    bid: commandStore.bid,
    ask: commandStore.ask,
    spread: commandStore.spread,
    open24h: commandStore.open24h,
    previousClose: commandStore.previousClose,
    high24h: commandStore.high24h,
    low24h: commandStore.low24h,
    change24h: commandStore.change24h,
    changePercent24h: commandStore.changePercent24h,
    tickDirection: commandStore.tickDirection,
    connection: commandStore.connection,
    sparkline: commandStore.sparkline,
    tickTape: commandStore.tickTape,
    tickHistory: commandStore.tickHistory,
    candles: activeCandles,
    selectedTimeframe: commandStore.selectedTimeframe,
    setTimeframe: (tf: Timeframe) => commandStore.setTimeframe(tf),
    minuteFlows: commandStore.minuteFlows,
    spreadHistory: commandStore.spreadHistory,
    volumeHistory: commandStore.volumeHistory,
    absorptionBuyZones: commandStore.absorptionBuyZones,
    absorptionSellZones: commandStore.absorptionSellZones,
    liquidityZones: commandStore.liquidityZones,
    originLevels: commandStore.originLevels,
    originDisplacements: commandStore.originDisplacements,
    regime: commandStore.regime,
    confidence: commandStore.confidence,
    buyTicks60s: commandStore.buyTicks60s,
    sellTicks60s: commandStore.sellTicks60s,
    flatTicks60s: commandStore.flatTicks60s,
    buyVolumeDollar60s: commandStore.buyVolumeDollar60s,
    sellVolumeDollar60s: commandStore.sellVolumeDollar60s,
    buyDeltaSum60s: commandStore.buyDeltaSum60s,
    sellDeltaSum60s: commandStore.sellDeltaSum60s,
    buyRatio,
    sellRatio,
    liquidityGrade,
    nearestZone,
    nearestFvgOrOb: commandStore.getNearestFvgOrOrderBlock(),
    lastTickTimestamp: commandStore.lastTickTimestamp,
    lastCandleTimestamp: commandStore.lastCandleTimestamp,
    lastNewsTimestamp: commandStore.lastNewsTimestamp,
    lastDerivedTimestamp: commandStore.lastDerivedTimestamp,
  };
}
