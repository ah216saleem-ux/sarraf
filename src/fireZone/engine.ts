// src/fireZone/engine.ts
import {
  Candle,
  Pivot,
  ZoneSide,
  TradePlan,
  FireZone,
  LevelWall,
  FireZoneEngineResult,
} from './types';
import {
  computeAtr,
  findPivots,
  computeStructureAndTrend,
  calculateStrengthScore,
  extractZones,
} from './engineCore';
import {
  ZONE_HALF,
  ZONE_WIDTH,
  buildRankedLevels,
  selectZonesFromLevels,
  filterAndRankKeptLevels,
  build007TradePlan,
} from './levels';
import {
  selectZonesPerSide,
  computeLevelWalls,
  buildTradePlan,
} from './engineLevelsAndPlans';
import {
  evaluateGates,
  buildZoneLadder,
  buildZoneItemsForModel,
  buildChartModel,
  ChartModelZone,
  ChartModelPlanLine,
  FireZoneChartModel,
} from './engineGatesAndLadder';
import {
  INTERNAL_PIVOT_LEN,
  SWING_PIVOT_LEN,
  computeLayerStructure,
  computeDualStructure,
  computeVisibleAutoscaleRange,
} from './structure';
import {
  FIRE_ZONE_STORAGE_KEY,
  evaluateZoneClosedLifecycle,
  getLiveZoneDisplayState,
  formatLevelEventSentence,
  appendRetiredHistory,
  saveFireZoneLifecycleState,
  loadFireZoneLifecycleState,
  restoreAndRevalidateLifecycleState,
  memoryStorage,
} from './lifecycle';

export * from './types';
export * from './structure';
export * from './levels';
export * from './lifecycle';
export type {
  ChartModelZone,
  ChartModelPlanLine,
  FireZoneChartModel,
};
export {
  computeAtr,
  findPivots,
  computeStructureAndTrend,
  calculateStrengthScore,
  extractZones,
  selectZonesPerSide,
  computeLevelWalls,
  buildTradePlan,
  evaluateGates,
  buildZoneLadder,
  buildZoneItemsForModel,
  buildChartModel,
  INTERNAL_PIVOT_LEN,
  SWING_PIVOT_LEN,
  computeLayerStructure,
  computeDualStructure,
  computeVisibleAutoscaleRange,
  ZONE_HALF,
  ZONE_WIDTH,
  buildRankedLevels,
  selectZonesFromLevels,
  filterAndRankKeptLevels,
  build007TradePlan,
  FIRE_ZONE_STORAGE_KEY,
  evaluateZoneClosedLifecycle,
  getLiveZoneDisplayState,
  formatLevelEventSentence,
  appendRetiredHistory,
  saveFireZoneLifecycleState,
  loadFireZoneLifecycleState,
  restoreAndRevalidateLifecycleState,
  memoryStorage,
};


const moduleZoneStore = new Map<string, FireZone>();
const moduleLevelStore = new Map<string, LevelWall>();

interface CachedEngineSnapshot {
  closedCandleSignature: string;
  lastClosedH1Time: number;
  result: FireZoneEngineResult;
}

let cachedSnapshot: CachedEngineSnapshot | null = null;
let recomputeCounter = 0;

export function getFireZoneStore(): ReadonlyMap<string, FireZone> {
  return moduleZoneStore;
}

export function getRecomputeCount(): number {
  return recomputeCounter;
}

export function resetFireZoneEngineStore(): void {
  moduleZoneStore.clear();
  moduleLevelStore.clear();
  cachedSnapshot = null;
  recomputeCounter = 0;
}

export function getClosedH1Signature(
  h1Candles: Candle[],
  h4Candles: Candle[] = [],
  d1Candles: Candle[] = []
): { lastClosedH1Time: number; signature: string } {
  if (!h1Candles || h1Candles.length === 0) {
    return { lastClosedH1Time: 0, signature: 'empty' };
  }
  const closedIdx = h1Candles.length >= 2 ? h1Candles.length - 2 : 0;
  const closedBar = h1Candles[closedIdx];
  const firstBar = h1Candles[0];
  const lastClosedH1Time = closedBar.time;
  const signature = [
    h1Candles.length,
    firstBar.time,
    closedBar.time,
    closedBar.open.toFixed(2),
    closedBar.high.toFixed(2),
    closedBar.low.toFixed(2),
    closedBar.close.toFixed(2),
    h4Candles.length,
    d1Candles.length,
  ].join('|');

  return { lastClosedH1Time, signature };
}

/**
 * Main Pure 007 Fire Zone Engine Pipeline (Fixed H1 basis + H4/D1 level ranking + Zone Lifecycle).
 * Stability Rule: Zones, levels, and lifecycle transitions are recomputed ONLY when a new H1 candle CLOSES
 * (or on first load), never on a live tick or UI change.
 */
export function runFireZoneEngine(
  h1Candles: Candle[],
  h4Candles: Candle[] = [],
  d1Candles: Candle[] = [],
  overrideCurrentPrice?: number
): FireZoneEngineResult {
  if (!h1Candles || h1Candles.length === 0) {
    const emptyPrice = overrideCurrentPrice ?? 0;
    const emptyGates = evaluateGates([], [], [], 0, 0, 'BUY', null, ZONE_WIDTH, emptyPrice);
    return {
      timeframe: '1H',
      lastClosedH1Time: 0,
      currentPrice: emptyPrice,
      atr: 2.0,
      zoneHeight: ZONE_WIDTH,
      trend: 0,
      internalTrend: 0,
      htfTrend: 0,
      activeSide: 'BUY',
      buyZones: [],
      sellZones: [],
      allZones: [],
      deadZones: [],
      recentlyBroken: [],
      retiredHistory: [],
      latestLevelEvent: null,
      structureEvents: [],
      dualStructure: computeDualStructure([]),
      levels: [],
      allRankedLevels: [],
      activePlan: null,
      buyNearestPlan: null,
      sellNearestPlan: null,
      plans: [],
      gateEval: emptyGates,
      ladder: [],
    };
  }

  const { lastClosedH1Time, signature } = getClosedH1Signature(
    h1Candles,
    h4Candles,
    d1Candles
  );

  // If the last closed H1 candle has NOT changed, reuse the exact cached zones, levels, and plans!
  if (cachedSnapshot && cachedSnapshot.closedCandleSignature === signature) {
    const prev = cachedSnapshot.result;
    const livePrice =
      typeof overrideCurrentPrice === 'number' && overrideCurrentPrice > 0
        ? overrideCurrentPrice
        : prev.currentPrice;

    if (livePrice === prev.currentPrice) {
      return prev;
    }

    const updatedLadder = prev.ladder.map((r) =>
      r.kind === 'NOW'
        ? {
            ...r,
            label: `NOW $${livePrice.toFixed(2)}`,
            price: livePrice,
            distanceDiff: 0,
          }
        : r
    );
    return {
      ...prev,
      currentPrice: livePrice,
      ladder: updatedLadder,
    };
  }

  recomputeCounter++;

  const closedRefBar =
    h1Candles.length >= 2 ? h1Candles[h1Candles.length - 2] : h1Candles[h1Candles.length - 1];
  const refPrice = closedRefBar.close;
  const currentPrice =
    typeof overrideCurrentPrice === 'number' && overrideCurrentPrice > 0
      ? overrideCurrentPrice
      : h1Candles[h1Candles.length - 1].close;

  const closedH1 = h1Candles.length >= 2 ? h1Candles.slice(0, -1) : h1Candles;

  // 1. Compute ATR(14) on H1; zone width is constant $4.00 (anchor +/- $2.00)
  const atr = computeAtr(closedH1, 14);
  const zoneHeight = ZONE_WIDTH;

  // 2. Restore & re-validate persisted lifecycle state (fireZone.v1) against closed H1 candles
  const restored = restoreAndRevalidateLifecycleState(closedH1, atr);

  // 3. Detect pivots on H1: L=5 (internal) and L=15 (swing)
  const pivotsL5 = findPivots(closedH1, 5);
  const pivotsL15 = findPivots(closedH1, 15);

  // 4. Indicator-style Dual Market Structure on H1 (INTERNAL L=5 & SWING L=20)
  const dualStructure = computeDualStructure(closedH1);
  const { trend: legacyL5Trend, events: eventsL5 } = computeStructureAndTrend(closedH1, pivotsL5);
  const { trend: htfTrend } = computeStructureAndTrend(closedH1, pivotsL15);

  const internalTrend =
    dualStructure.internal.breaks.length > 0 ? dualStructure.internal.trend : legacyL5Trend;
  const trend: 1 | -1 | 0 =
    dualStructure.swing.breaks.length > 0 ? dualStructure.swing.trend : internalTrend;

  // 5. Build all ranked levels from H1 (150), H4 (100), D1 (100), PDH/PDL, PWH/PWL, EQH/EQL, $50/$100, + flipped levels
  const allRankedLevels = buildRankedLevels(
    closedH1,
    h4Candles,
    d1Candles,
    refPrice,
    restored.flippedLevels
  );
  for (const lvl of allRankedLevels) {
    moduleLevelStore.set(lvl.id, lvl);
  }

  // 6. Select 2 to 3 zones per side with Lifecycle evaluation (retiring PLAYED_HELD, BROKEN, EXPIRED)
  const latestBar = closedH1[closedH1.length - 1];
  const {
    buyZones,
    sellZones,
    retiredHistory,
    flippedCandidates,
  } = selectZonesFromLevels(
    allRankedLevels,
    refPrice,
    atr,
    latestBar.time,
    closedH1.length - 1,
    moduleZoneStore,
    closedH1,
    restored.history,
    currentPrice
  );

  // Save active zones (always as 'FRESH'), retired history, and flipped levels to localStorage (fireZone.v1)
  const combinedFlipped = [
    ...restored.flippedLevels,
    ...flippedCandidates.filter(
      (fc) =>
        !restored.flippedLevels.some(
          (rf) => Math.abs(rf.anchor - fc.anchor) < 0.5 && rf.toSide === fc.toSide
        )
    ),
  ];
  saveFireZoneLifecycleState([...buyZones, ...sellZones], retiredHistory, combinedFlipped);

  const pivotMap = new Map<number, Pivot>();
  for (const p of pivotsL5) pivotMap.set(p.index, p);
  for (const p of pivotsL15) pivotMap.set(p.index, p);
  const combinedPivots = Array.from(pivotMap.values()).sort((a, b) => a.index - b.index);
  const { deadZones, recentlyBroken } = extractZones(
    closedH1,
    combinedPivots,
    ZONE_WIDTH,
    refPrice
  );

  // 7. Active side = side of the swing (L=20 H1) market-structure trend
  let activeSide: ZoneSide = 'BUY';
  if (trend > 0) {
    activeSide = 'BUY';
  } else if (trend < 0) {
    activeSide = 'SELL';
  } else {
    const buyNearestDist = buyZones.find((z) => z.type === 'NEAREST')?.distance ?? 99999;
    const sellNearestDist = sellZones.find((z) => z.type === 'NEAREST')?.distance ?? 99999;
    activeSide = buyNearestDist <= sellNearestDist ? 'BUY' : 'SELL';
  }

  // 8. Keep levels within +/-12*ATR(H1) of price plus the active zones' own anchors (excluding retired)
  const chosenZones = [...buyZones, ...sellZones];
  const levels = filterAndRankKeptLevels(
    allRankedLevels,
    chosenZones,
    refPrice,
    atr,
    retiredHistory
  );

  // 9. Build 007 Trade Plans
  const plans: TradePlan[] = chosenZones.map((z) => {
    const isPlanActive = z.side === activeSide && z.type === 'NEAREST';
    return build007TradePlan(z, allRankedLevels, atr, refPrice, isPlanActive);
  });

  const buyNearestPlan =
    plans.find((p) => p.side === 'BUY' && p.zoneType === 'NEAREST') || null;
  const sellNearestPlan =
    plans.find((p) => p.side === 'SELL' && p.zoneType === 'NEAREST') || null;
  const activePlan = plans.find((p) => p.isActive) || plans[0] || null;

  // 10. Evaluate 7 Confluence Gates
  const combinedBreakEvents = [
    ...eventsL5,
    ...dualStructure.internal.breaks.map((b) => ({
      barIndex: b.breakIndex,
      time: b.breakTime,
      direction: b.direction,
      type: (b.label === 'BOS' ? 'BOS' : 'CHoCH') as 'BOS' | 'CHoCH',
      brokenPivotPrice: b.pivotPrice,
      brokenPivotIndex: b.pivotIndex,
      closePrice: closedH1[b.breakIndex]?.close ?? b.pivotPrice,
    })),
    ...dualStructure.swing.breaks.map((b) => ({
      barIndex: b.breakIndex,
      time: b.breakTime,
      direction: b.direction,
      type: (b.label === 'BOS' ? 'BOS' : 'CHoCH') as 'BOS' | 'CHoCH',
      brokenPivotPrice: b.pivotPrice,
      brokenPivotIndex: b.pivotIndex,
      closePrice: closedH1[b.breakIndex]?.close ?? b.pivotPrice,
    })),
  ];

  const activeZone =
    chosenZones.find((z) => z.side === activeSide && z.type === 'NEAREST') || null;

  const gateEval = evaluateGates(
    closedH1,
    pivotsL15,
    combinedBreakEvents,
    trend,
    htfTrend,
    activeSide,
    activePlan,
    activeZone,
    refPrice
  );


  // 11. Build Sorted Zone Ladder
  const ladder = buildZoneLadder(
    buyZones,
    sellZones,
    buyNearestPlan,
    sellNearestPlan,
    levels,
    currentPrice,
    activeSide,
    atr
  );

  const latestLevelEvent = formatLevelEventSentence(retiredHistory[0]);

  const result: FireZoneEngineResult = {
    timeframe: '1H',
    lastClosedH1Time,
    currentPrice,
    atr,
    zoneHeight,
    trend,
    internalTrend,
    htfTrend,
    activeSide,
    buyZones,
    sellZones,
    allZones: chosenZones,
    deadZones,
    recentlyBroken,
    retiredHistory,
    latestLevelEvent,
    structureEvents: eventsL5,
    dualStructure,
    levels,
    allRankedLevels,
    activePlan,
    buyNearestPlan,
    sellNearestPlan,
    plans,
    gateEval,
    ladder,
  };

  cachedSnapshot = {
    closedCandleSignature: signature,
    lastClosedH1Time,
    result,
  };

  return result;
}
