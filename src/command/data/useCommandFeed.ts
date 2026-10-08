import { useEffect, useState, useRef } from 'react';
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

export function useCommandFeed(): UseCommandFeedResult {
  // Snapshot version state
  const [, setTick] = useState(0);

  // requestAnimationFrame throttling to max 10 updates per second (100ms)
  const lastPaintTimeRef = useRef<number>(0);
  const pendingRafRef = useRef<number | null>(null);

  useEffect(() => {
    const handleStoreChange = () => {
      // Pause updates completely when tab is hidden
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      const now = performance.now();
      const elapsed = now - lastPaintTimeRef.current;

      // Throttle UI paint to max 10/sec (100ms window)
      if (elapsed < 100) {
        if (!pendingRafRef.current) {
          pendingRafRef.current = requestAnimationFrame(() => {
            pendingRafRef.current = null;
            lastPaintTimeRef.current = performance.now();
            setTick((t) => (t + 1) % 1000000);
          });
        }
        return;
      }

      lastPaintTimeRef.current = now;
      setTick((t) => (t + 1) % 1000000);
    };

    const unsubscribe = commandStore.subscribe(handleStoreChange);

    // Visibility change handler to resume smoothly when tab becomes visible again
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleStoreChange();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibility);
      if (pendingRafRef.current) {
        cancelAnimationFrame(pendingRafRef.current);
      }
    };
  }, []);

  // Compute derived ratios from real ticks
  const total60 = commandStore.buyTicks60s + commandStore.sellTicks60s;
  const buyRatio = total60 > 0 ? Number(((commandStore.buyTicks60s / total60) * 100).toFixed(1)) : 50;
  const sellRatio = total60 > 0 ? Number((100 - buyRatio).toFixed(1)) : 50;

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
    lastTickTimestamp: commandStore.lastTickTimestamp,
    lastCandleTimestamp: commandStore.lastCandleTimestamp,
    lastNewsTimestamp: commandStore.lastNewsTimestamp,
    lastDerivedTimestamp: commandStore.lastDerivedTimestamp,
  };
}
