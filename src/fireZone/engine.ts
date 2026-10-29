// src/fireZone/engine.ts
import {
  Candle,
  Pivot,
  ZoneSide,
  TradePlan,
  FireZone,
  FlipWatch,
  LevelWall,
  RetiredZoneHistoryItem,
  FireZoneEngineResult,
} from './types';
import {
  computeAtr,
  findPivots,
  computeStructureAndTrend,
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
  MAX_LEVEL_EVENTS,
  evaluateZoneClosedLifecycle,
  getLiveZoneDisplayState,
  formatLevelEventSentence,
  appendRetiredHistory,
  saveFireZoneLifecycleState,
  loadFireZoneLifecycleState,
  restoreAndRevalidateLifecycleState,
  saveFireZoneV2State,
  loadFireZoneV2State,
  restoreAndRevalidateV2State,
  isZoneBrokenByClosedCandle,
  isZoneBrokenByLivePrice,
  createFlipWatch,
  stepFlipWatchWithPrice,
  stepFlipWatchWithCandle,
  evaluateZoneHeldOnCandles,
  applyHeldReactionToCandidate,
  formatBreakEventSentence,
  formatFlipConfirmedEventSentence,
  formatHeldEventSentence,
  appendLifecycleEvent,
  memoryStorage,
  getDefaultStorage,
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
  extractZones,
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
  MAX_LEVEL_EVENTS,
  evaluateZoneClosedLifecycle,
  getLiveZoneDisplayState,
  formatLevelEventSentence,
  appendRetiredHistory,
  saveFireZoneLifecycleState,
  loadFireZoneLifecycleState,
  restoreAndRevalidateLifecycleState,
  saveFireZoneV2State,
  loadFireZoneV2State,
  restoreAndRevalidateV2State,
  isZoneBrokenByClosedCandle,
  isZoneBrokenByLivePrice,
  createFlipWatch,
  stepFlipWatchWithPrice,
  stepFlipWatchWithCandle,
  evaluateZoneHeldOnCandles,
  applyHeldReactionToCandidate,
  formatBreakEventSentence,
  formatFlipConfirmedEventSentence,
  formatHeldEventSentence,
  appendLifecycleEvent,
  memoryStorage,
};

const moduleZoneStore = new Map<string, FireZone>();
const moduleLevelStore = new Map<string, LevelWall>();
const moduleBrokenIds = new Set<string>();
let moduleFlipWatches: FlipWatch[] = [];
let moduleEvents: string[] = [];
let moduleHistory: RetiredZoneHistoryItem[] = [];

interface CachedEngineSnapshot {
  closedCandleSignature: string;
  lastClosedH1Time: number;
  closedH1: Candle[];
  h4Candles: Candle[];
  d1Candles: Candle[];
  pivotsL15: Pivot[];
  combinedBreakEvents: Array<{
    barIndex: number;
    time: number;
    direction: 1 | -1;
    type: 'BOS' | 'CHoCH';
    brokenPivotPrice: number;
    brokenPivotIndex: number;
    closePrice: number;
  }>;
  result: FireZoneEngineResult;
}

let cachedSnapshot: CachedEngineSnapshot | null = null;
let recomputeCounter = 0;

export function getFireZoneStore(): ReadonlyMap<string, FireZone> {
  return moduleZoneStore;
}

export function getBrokenZoneIds(): ReadonlySet<string> {
  return moduleBrokenIds;
}

export function getFlipWatches(): ReadonlyArray<FlipWatch> {
  return moduleFlipWatches;
}

export function getLifecycleEvents(): ReadonlyArray<string> {
  return moduleEvents;
}

export function getRecomputeCount(): number {
  return recomputeCounter;
}

export function resetFireZoneEngineStore(): void {
  moduleZoneStore.clear();
  moduleLevelStore.clear();
  moduleBrokenIds.clear();
  moduleFlipWatches = [];
  moduleEvents = [];
  moduleHistory = [];
  cachedSnapshot = null;
  recomputeCounter = 0;
  try {
    getDefaultStorage().removeItem?.(FIRE_ZONE_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
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

function upsertFlipWatch(list: FlipWatch[], newWatch: FlipWatch): FlipWatch[] {
  const idx = list.findIndex(
    (w) => w.id === newWatch.id || (Math.abs(w.anchor - newWatch.anchor) < 0.5 && w.side === newWatch.side)
  );
  if (idx >= 0) {
    const next = [...list];
    next[idx] = newWatch;
    return next;
  }
  return [...list, newWatch];
}

/**
 * Rebuild plans, levels, gates, and ladder from a new zone selection (used both on closed-candle
 * runs and after a live break / flip confirmation replacement).
 */
function buildEngineResultFromSelection(params: {
  lastClosedH1Time: number;
  currentPrice: number;
  refPrice: number;
  atr: number;
  trend: 1 | -1 | 0;
  internalTrend: 1 | -1 | 0;
  htfTrend: 1 | -1 | 0;
  buyZones: FireZone[];
  sellZones: FireZone[];
  allRankedLevels: LevelWall[];
  deadZones: FireZone[];
  recentlyBroken: FireZone[];
  retiredHistory: RetiredZoneHistoryItem[];
  levelEvents: string[];
  brokenIds: Set<string>;
  flipWatches: FlipWatch[];
  structureEvents: FireZoneEngineResult['structureEvents'];
  dualStructure: FireZoneEngineResult['dualStructure'];
  closedH1: Candle[];
  pivotsL15: Pivot[];
  combinedBreakEvents: CachedEngineSnapshot['combinedBreakEvents'];
}): FireZoneEngineResult {
  const {
    lastClosedH1Time,
    currentPrice,
    refPrice,
    atr,
    trend,
    internalTrend,
    htfTrend,
    buyZones,
    sellZones,
    allRankedLevels,
    deadZones,
    recentlyBroken,
    retiredHistory,
    levelEvents,
    brokenIds,
    flipWatches,
    structureEvents,
    dualStructure,
    closedH1,
    pivotsL15,
    combinedBreakEvents,
  } = params;

  // Active side = side of the swing (L=20 H1) market-structure trend
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

  const chosenZones = [...buyZones, ...sellZones];
  const levels = filterAndRankKeptLevels(
    allRankedLevels,
    chosenZones,
    currentPrice > 0 ? currentPrice : refPrice,
    atr,
    retiredHistory
  );

  // Build 007 Trade Plans
  const nearestAnchors = chosenZones
    .filter((z) => z.type === 'NEAREST')
    .map((z) => z.anchor);
  const tpTargetLevels = allRankedLevels.filter(
    (lvl) =>
      !brokenIds.has(lvl.id) &&
      !nearestAnchors.some((a) => Math.abs(lvl.price - a) <= 0.05)
  );
  const planRefPrice = currentPrice > 0 ? currentPrice : refPrice;
  const plans: TradePlan[] = chosenZones.map((z) => {
    const isPlanActive = z.side === activeSide && z.type === 'NEAREST';
    return build007TradePlan(z, tpTargetLevels, atr, planRefPrice, isPlanActive);
  });

  const buyNearestPlan =
    plans.find((p) => p.side === 'BUY' && p.zoneType === 'NEAREST') || null;
  const sellNearestPlan =
    plans.find((p) => p.side === 'SELL' && p.zoneType === 'NEAREST') || null;
  const activePlan = plans.find((p) => p.isActive) || plans[0] || null;

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
    planRefPrice
  );

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

  const latestLevelEvent =
    levelEvents[0] ?? formatLevelEventSentence(retiredHistory[0]);

  return {
    timeframe: '1H',
    lastClosedH1Time,
    currentPrice,
    atr,
    zoneHeight: ZONE_WIDTH,
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
    levelEvents: levelEvents.slice(0, MAX_LEVEL_EVENTS),
    brokenIds: Array.from(brokenIds),
    flipWatches: [...flipWatches],
    structureEvents,
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
}

/**
 * Main Pure 007 Fire Zone Engine Pipeline (Fixed H1 basis + Phase 1 Selection + Phase 2 Lifecycle).
 * - Recomputes on a new closed H1 candle OR immediately when a live break (> 0.5*ATR beyond far edge)
 *   or flip confirmation occurs.
 * - Normal ticks within range never recompute or drift zone prices.
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
      levelEvents: [],
      brokenIds: [],
      flipWatches: [],
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

  // If the last closed H1 candle has NOT changed, check for a Live Break (> 0.5*ATR) or Flip Confirmation!
  if (cachedSnapshot && cachedSnapshot.closedCandleSignature === signature) {
    const prev = cachedSnapshot.result;
    const livePrice =
      typeof overrideCurrentPrice === 'number' && overrideCurrentPrice > 0
        ? overrideCurrentPrice
        : h1Candles[h1Candles.length - 1].close;

    // 1. Check if livePrice causes a provisional live break on any currently active zone
    let anyLiveBreak = false;
    for (const z of prev.allZones) {
      const check = isZoneBrokenByLivePrice(z.side, z.bottom, z.top, livePrice, prev.atr);
      if (check.broken && !moduleBrokenIds.has(z.id)) {
        anyLiveBreak = true;
        moduleBrokenIds.add(z.id);
        moduleZoneStore.delete(z.id);

        const eventMsg = formatBreakEventSentence(z.side, z.anchor, check.excessDollar);
        moduleEvents = appendLifecycleEvent(moduleEvents, eventMsg);

        moduleHistory = appendRetiredHistory(moduleHistory, {
          id: `ret-${z.side}-${z.anchor.toFixed(2)}-${lastClosedH1Time}`,
          side: z.side,
          anchor: z.anchor,
          type: z.type || 'NEAREST',
          result: 'BROKEN',
          candleTime: lastClosedH1Time,
          moveAfter: Number(Math.abs(livePrice - z.anchor).toFixed(2)),
        });

        const fw = createFlipWatch(
          z,
          lastClosedH1Time,
          Math.max(0, cachedSnapshot.closedH1.length - 1)
        );
        moduleFlipWatches = upsertFlipWatch(moduleFlipWatches, fw);
      }
    }

    // 2. Step all flip watches with livePrice
    let anyFlipConfirmed = false;
    moduleFlipWatches = moduleFlipWatches.map((fw) => {
      if (fw.confirmed) return fw;
      const stepped = stepFlipWatchWithPrice(fw, livePrice, prev.atr);
      if (stepped.newlyConfirmed) {
        anyFlipConfirmed = true;
        moduleEvents = appendLifecycleEvent(
          moduleEvents,
          formatFlipConfirmedEventSentence(stepped.watch.anchor, stepped.watch.side)
        );
      }
      return stepped.watch;
    });

    const anyZoneWrongSide =
      prev.sellZones.some((z) => z.anchor <= livePrice || z.top < livePrice) ||
      prev.buyZones.some((z) => z.anchor >= livePrice || z.bottom > livePrice);

    // If a live break, flip confirmation, or wrong-side zone occurred, immediately re-run selection with brokenIds excluded
    // and livePrice as reference (non-broken zones keep their exact same prices from moduleZoneStore!)
    if (anyLiveBreak || anyFlipConfirmed || anyZoneWrongSide) {
      const closedH1 = cachedSnapshot.closedH1;
      const latestBar = closedH1[closedH1.length - 1];
      const allRankedLevels = buildRankedLevels(
        closedH1,
        cachedSnapshot.h4Candles,
        cachedSnapshot.d1Candles,
        livePrice,
        [],
        prev.atr,
        moduleFlipWatches,
        moduleBrokenIds
      );

      const { buyZones, sellZones, retiredHistory } = selectZonesFromLevels(
        allRankedLevels,
        livePrice,
        prev.atr,
        latestBar.time,
        closedH1.length - 1,
        moduleZoneStore,
        closedH1,
        moduleHistory,
        livePrice,
        moduleBrokenIds,
        moduleFlipWatches
      );
      moduleHistory = retiredHistory;

      saveFireZoneV2State({
        activeZones: [...buyZones, ...sellZones],
        brokenIds: moduleBrokenIds,
        flipWatches: moduleFlipWatches,
        events: moduleEvents,
        history: moduleHistory,
      });

      const updatedResult = buildEngineResultFromSelection({
        lastClosedH1Time,
        currentPrice: livePrice,
        refPrice: livePrice,
        atr: prev.atr,
        trend: prev.trend,
        internalTrend: prev.internalTrend,
        htfTrend: prev.htfTrend,
        buyZones,
        sellZones,
        allRankedLevels,
        deadZones: prev.deadZones,
        recentlyBroken: prev.recentlyBroken,
        retiredHistory: moduleHistory,
        levelEvents: moduleEvents,
        brokenIds: moduleBrokenIds,
        flipWatches: moduleFlipWatches,
        structureEvents: prev.structureEvents,
        dualStructure: prev.dualStructure,
        closedH1,
        pivotsL15: cachedSnapshot.pivotsL15,
        combinedBreakEvents: cachedSnapshot.combinedBreakEvents,
      });

      cachedSnapshot = {
        ...cachedSnapshot,
        result: updatedResult,
      };
      return updatedResult;
    }

    // Normal tick without break or flip confirmation -> reuse exact cached zones & plans
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
      flipWatches: [...moduleFlipWatches],
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

  // 2. Restore & re-validate persisted lifecycle state (fireZone.v2) against closed H1 candles
  const restored = restoreAndRevalidateV2State(closedH1, atr);
  for (const id of restored.brokenIds) {
    moduleBrokenIds.add(id);
  }
  for (const fw of restored.flipWatches) {
    moduleFlipWatches = upsertFlipWatch(moduleFlipWatches, fw);
  }
  for (const ev of [...restored.events].reverse()) {
    moduleEvents = appendLifecycleEvent(moduleEvents, ev);
  }
  for (const h of [...restored.history].reverse()) {
    moduleHistory = appendRetiredHistory(moduleHistory, h);
  }

  // Also check if any previously active zone in cachedSnapshot broke on the newly closed H1 candle
  if (cachedSnapshot) {
    for (const prevZone of cachedSnapshot.result.allZones) {
      if (moduleBrokenIds.has(prevZone.id)) continue;
      const closedBreak = isZoneBrokenByClosedCandle(
        prevZone.side,
        prevZone.bottom,
        prevZone.top,
        closedRefBar,
        atr
      );
      if (closedBreak.broken) {
        moduleBrokenIds.add(prevZone.id);
        moduleZoneStore.delete(prevZone.id);
        moduleEvents = appendLifecycleEvent(
          moduleEvents,
          formatBreakEventSentence(prevZone.side, prevZone.anchor, closedBreak.excessDollar)
        );
        moduleHistory = appendRetiredHistory(moduleHistory, {
          id: `ret-${prevZone.side}-${prevZone.anchor.toFixed(2)}-${closedRefBar.time}`,
          side: prevZone.side,
          anchor: prevZone.anchor,
          type: prevZone.type || 'NEAREST',
          result: 'BROKEN',
          candleTime: closedRefBar.time,
          moveAfter: Number(Math.abs(closedRefBar.close - prevZone.anchor).toFixed(2)),
        });
        const fw = createFlipWatch(prevZone, closedRefBar.time, closedH1.length - 1);
        moduleFlipWatches = upsertFlipWatch(moduleFlipWatches, fw);
      }
    }

    // Step existing flip watches with the newly closed H1 candle
    moduleFlipWatches = moduleFlipWatches.map((fw) => {
      if (fw.confirmed) return fw;
      const stepped = stepFlipWatchWithCandle(fw, closedRefBar, atr);
      if (stepped.newlyConfirmed) {
        moduleEvents = appendLifecycleEvent(
          moduleEvents,
          formatFlipConfirmedEventSentence(stepped.watch.anchor, stepped.watch.side)
        );
      }
      return stepped.watch;
    });
  }

  // Step flip watches with currentPrice if applicable
  moduleFlipWatches = moduleFlipWatches.map((fw) => {
    if (fw.confirmed) return fw;
    const stepped = stepFlipWatchWithPrice(fw, currentPrice, atr);
    if (stepped.newlyConfirmed) {
      moduleEvents = appendLifecycleEvent(
        moduleEvents,
        formatFlipConfirmedEventSentence(stepped.watch.anchor, stepped.watch.side)
      );
    }
    return stepped.watch;
  });

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

  // 5. Build all ranked levels from closed H1 pivots (L=5, 20, 50), departure + freshness, $3 clustering & bonuses
  let allRankedLevels = buildRankedLevels(
    closedH1,
    h4Candles,
    d1Candles,
    refPrice,
    [],
    atr,
    moduleFlipWatches,
    moduleBrokenIds
  );
  for (const lvl of allRankedLevels) {
    moduleLevelStore.set(lvl.id, lvl);
  }

  // 6. Select up to 4 zones (2 SELL + 2 BUY) with brokenIds excluded and confirmed flips included
  const latestBar = closedH1[closedH1.length - 1];
  let selection = selectZonesFromLevels(
    allRankedLevels,
    refPrice,
    atr,
    latestBar.time,
    closedH1.length - 1,
    moduleZoneStore,
    closedH1,
    moduleHistory,
    currentPrice,
    moduleBrokenIds,
    moduleFlipWatches
  );

  // Check if currentPrice immediately breaks any selected zone on initial/candle evaluation
  let liveBreakOnInit = false;
  for (const z of [...selection.buyZones, ...selection.sellZones]) {
    const check = isZoneBrokenByLivePrice(z.side, z.bottom, z.top, currentPrice, atr);
    if (check.broken && !moduleBrokenIds.has(z.id)) {
      liveBreakOnInit = true;
      moduleBrokenIds.add(z.id);
      moduleZoneStore.delete(z.id);
      moduleEvents = appendLifecycleEvent(
        moduleEvents,
        formatBreakEventSentence(z.side, z.anchor, check.excessDollar)
      );
      const fw = createFlipWatch(z, latestBar.time, closedH1.length - 1);
      moduleFlipWatches = upsertFlipWatch(moduleFlipWatches, fw);
    }
  }

  if (liveBreakOnInit) {
    allRankedLevels = buildRankedLevels(
      closedH1,
      h4Candles,
      d1Candles,
      currentPrice,
      [],
      atr,
      moduleFlipWatches,
      moduleBrokenIds
    );
    selection = selectZonesFromLevels(
      allRankedLevels,
      currentPrice,
      atr,
      latestBar.time,
      closedH1.length - 1,
      moduleZoneStore,
      closedH1,
      moduleHistory,
      currentPrice,
      moduleBrokenIds,
      moduleFlipWatches
    );
  }

  const { buyZones, sellZones, retiredHistory } = selection;
  moduleHistory = retiredHistory;

  // Check HELD reactions on active zones to populate HELD events if any occurred recently
  for (const z of [...buyZones, ...sellZones]) {
    if (z.touches > 0) {
      const heldEval = evaluateZoneHeldOnCandles(
        {
          side: z.side,
          anchor: z.anchor,
          score: z.score,
          retests: z.touches,
          pivotIndex: z.pivotIndex,
        },
        closedH1,
        atr
      );
      if (heldEval.heldCount > 0 && heldEval.lastBounceDollar > 0) {
        const heldSentence = formatHeldEventSentence(
          z.side,
          z.anchor,
          heldEval.lastBounceDollar
        );
        if (moduleEvents.length < MAX_LEVEL_EVENTS && !moduleEvents.includes(heldSentence)) {
          moduleEvents = [...moduleEvents, heldSentence].slice(0, MAX_LEVEL_EVENTS);
        }
      }
    }
  }

  // Save active zones, brokenIds, flipWatches, and events to localStorage ("fireZone.v2")
  saveFireZoneV2State({
    activeZones: [...buyZones, ...sellZones],
    brokenIds: moduleBrokenIds,
    flipWatches: moduleFlipWatches,
    events: moduleEvents,
    history: moduleHistory,
  });

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

  const result = buildEngineResultFromSelection({
    lastClosedH1Time,
    currentPrice,
    refPrice,
    atr,
    trend,
    internalTrend,
    htfTrend,
    buyZones,
    sellZones,
    allRankedLevels,
    deadZones,
    recentlyBroken,
    retiredHistory: moduleHistory,
    levelEvents: moduleEvents,
    brokenIds: moduleBrokenIds,
    flipWatches: moduleFlipWatches,
    structureEvents: eventsL5,
    dualStructure,
    closedH1,
    pivotsL15,
    combinedBreakEvents,
  });

  cachedSnapshot = {
    closedCandleSignature: signature,
    lastClosedH1Time,
    closedH1,
    h4Candles,
    d1Candles,
    pivotsL15,
    combinedBreakEvents,
    result,
  };

  return result;
}
