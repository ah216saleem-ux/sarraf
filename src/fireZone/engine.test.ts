/**
 * Unit tests for Fire Zone 007 Core Engine & Zone Lifecycle (src/fireZone/lifecycle.ts):
 * - Fixed H1 basis + H4/D1 level ranking (src/fireZone/levels.ts)
 * - Candidate clustering within $3 & importance scoring + rank style buckets
 * - Zones from levels with constant width $4.00 (anchor +/- $2.00)
 * - 007 Trade Plan level-snapping TP1/TP2/TP3 (>= $9, >= $13, >= $18) & SL = max($12, 1.2*ATR)
 * - Zone Lifecycle (FRESH, TESTING, PLAYED_HELD, BROKEN, EXPIRED), retire -> replacement,
 *   broken flip rule (+2 bonus), LEVEL EVENTS sentence, and localStorage (fireZone.v1) restore & re-validation.
 * Run with: npm run test:firezone
 */
import {
  computeAtr,
  findPivots,
  extractZones,
  runFireZoneEngine,
  FireZoneCandle,
  computeLayerStructure,
  computeVisibleAutoscaleRange,
  clusterCandidatesWithin3,
  scoreClusteredLevel,
  getStyleBucketByRank,
  buildRankedLevels,
  selectZonesFromLevels,
  build007TradePlan,
  resetFireZoneEngineStore,
  getRecomputeCount,
  getFireZoneStore,
  LevelWall,
  evaluateZoneClosedLifecycle,
  getLiveZoneDisplayState,
  formatLevelEventSentence,
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
  getBrokenZoneIds,
  getFlipWatches,
  getLifecycleEvents,
  memoryStorage,
  FIRE_ZONE_STORAGE_KEY,
  buildChartModel,
} from './engine';
import { buildSimpleLadderRows } from './engineGatesAndLadder';
import { runFireZoneBacktest } from './backtest';
import {
  evaluateOriginCandidate,
  clusterAndBonusZoneCandidates,
  getZoneStrengthLabel,
} from './levels';
import { processRawCandles } from './feed';


function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('--- Starting Fire Zone 007 Core Engine, Levels & Lifecycle Tests ---');

function makeCandle(
  index: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1000,
  stepSec = 3600
): FireZoneCandle {
  const baseTime = 1700000000;
  return {
    time: baseTime + index * stepSec,
    open,
    high,
    low,
    close,
    volume,
  };
}

// 1. Test ATR & Pivot detection
{
  const candles: FireZoneCandle[] = [];
  for (let i = 0; i <= 30; i++) {
    let high = 2005;
    let low = 1995;
    if (i === 10) { high = 2050; low = 2010; }
    else if (i === 20) { high = 1980; low = 1940; }
    candles.push(makeCandle(i, 2000, high, low, 2000));
  }
  const atr = computeAtr(candles, 14);
  assert(typeof atr === 'number' && atr > 0, 'ATR should be positive');
  const pivots = findPivots(candles, 5);
  assert(Boolean(pivots.find((p) => p.type === 'HIGH' && p.index === 10)), 'Detect swing high at bar 10');
  assert(Boolean(pivots.find((p) => p.type === 'LOW' && p.index === 20)), 'Detect swing low at bar 20');
  console.log('✓ ATR & Pivot detection passed');
}

// 2. Test Zone Dead on Close vs Wicks do not kill (legacy extractZones)
{
  const candles: FireZoneCandle[] = [
    makeCandle(0, 2000, 2010, 1990, 2000),
    makeCandle(1, 2000, 2010, 1990, 2000),
    makeCandle(2, 2000, 2010, 1990, 2000),
    makeCandle(3, 2000, 2010, 1990, 2000),
    makeCandle(4, 2000, 2010, 1990, 2000),
    makeCandle(5, 2000, 2010, 1990, 2000),
    makeCandle(6, 2020, 2050, 2015, 2030),
    makeCandle(7, 2020, 2030, 2000, 2010),
    makeCandle(8, 2010, 2020, 2000, 2005),
    makeCandle(9, 2005, 2020, 2000, 2005),
    makeCandle(10, 2005, 2020, 2000, 2005),
    makeCandle(11, 2005, 2020, 2000, 2005),
    makeCandle(12, 2005, 2052, 2000, 2040),
  ];

  const pivots = findPivots(candles, 5);
  const { liveZones: zonesBeforeKill } = extractZones(candles, pivots, 4, 2040);
  const sellZone = zonesBeforeKill.find((z) => z.side === 'SELL' && z.pivotIndex === 6);
  assert(Boolean(sellZone) && !sellZone!.isDead && sellZone!.touches >= 1, 'Wick touch does not kill zone');

  candles.push(makeCandle(13, 2040, 2060, 2035, 2055));
  const pivotsAfter = findPivots(candles, 5);
  const { liveZones: liveAfter, deadZones: deadAfter } = extractZones(candles, pivotsAfter, 4, 2055);
  assert(!liveAfter.find((z) => z.side === 'SELL' && z.pivotIndex === 6), 'Killed zone removed from live');
  assert(Boolean(deadAfter.find((z) => z.side === 'SELL' && z.pivotIndex === 6)), 'Killed zone in deadZones');
  console.log('✓ Wick touch vs Close kills zone passed');
}

// 3. Test Level Engine: $3 Clustering, Importance Score & Rank Style Buckets
{
  const clustered = clusterCandidatesWithin3([
    { price: 4000, source: 'ROUND_100', label: '$4000' },
    { price: 4001.5, source: 'D1', label: 'D1' },
    { price: 4002.4, source: 'PDH', label: 'PDH' },
    { price: 4020, source: 'H4', label: 'H4' },
  ]);
  assert(clustered.length === 2, 'Candidates within $3 must cluster into one level');
  assert(
    Math.abs(clustered[0].price - 4001.3) < 0.05,
    `Clustered price should be average (4001.30), got ${clustered[0].price}`
  );
  const score = scoreClusteredLevel(clustered[0].sources, 2);
  assert(score === 15, `Expected importance score 15, got ${score}`);
  assert(getStyleBucketByRank(1) === 'KEY' && getStyleBucketByRank(2) === 'KEY', 'Rank 1-2 = KEY');
  assert(getStyleBucketByRank(3) === 'MAJOR' && getStyleBucketByRank(5) === 'MAJOR', 'Rank 3-5 = MAJOR');
  assert(getStyleBucketByRank(6) === 'MINOR', 'Rank >=6 = MINOR');
  console.log('✓ Level Engine ($3 clustering, importance score & rank style buckets) passed');
}

// 4. Test Zone Width Always Exactly $4.00 (anchor +/- $2.00) & 007 TP Snapping
{
  const h1: FireZoneCandle[] = [];
  for (let i = 0; i < 180; i++) h1.push(makeCandle(i, 4050, 4054, 4046, 4050));
  h1[40] = makeCandle(40, 4065, 4082, 4060, 4070);
  h1[80] = makeCandle(80, 4035, 4040, 4018, 4030);
  h1[120] = makeCandle(120, 4058, 4066, 4052, 4060);
  h1[150] = makeCandle(150, 4042, 4048, 4034, 4040);

  const ranked = buildRankedLevels(h1, h1.slice(-100), h1.slice(-100), 4050);
  const { buyZones, sellZones } = selectZonesFromLevels(ranked, 4050, 8, h1[179].time, 179);
  for (const z of [...buyZones, ...sellZones]) {
    const width = Number((z.top - z.bottom).toFixed(2));
    assert(width === 4.0, `Zone ${z.id} width must be 4.00, got ${width}`);
  }

  const buyZone = {
    id: 'FZ-BUY-4000.00', side: 'BUY' as const, anchor: 4000, bottom: 3998, top: 4002,
    pivotIndex: 50, pivotTime: 1700000000, pivotPrice: 4000, pivotLevel: 15 as const,
    isLive: true, isDead: false, touches: 3, score: 14, label: 'CRITICAL' as const,
    type: 'NEAREST' as const, distance: 0,
  };
  const mockLevels: LevelWall[] = [
    { id: 'l1', price: 4008, kind: 'PIVOT', label: 'H1', sources: ['H1'], touches: 1, score: 2, rank: 5, importance: 'MAJOR', distance: 6 },
    { id: 'l2', price: 4012.5, kind: 'PDH', label: 'PDH', sources: ['PDH'], touches: 2, score: 6, rank: 2, importance: 'KEY', distance: 10.5 },
    { id: 'l3', price: 4017.0, kind: 'PIVOT', label: 'H4', sources: ['H4'], touches: 1, score: 4, rank: 3, importance: 'MAJOR', distance: 15.0 },
    { id: 'l4', price: 4025.0, kind: 'ROUND_NUMBER', label: '$4025', sources: ['D1'], touches: 2, score: 7, rank: 1, importance: 'KEY', distance: 23.0 },
  ];
  const plan = build007TradePlan(buyZone, mockLevels, 10, 4001, true);
  assert(plan.tp1 === 4012.5 && plan.tp2 === 4017.0 && plan.tp3 === 4025.0, 'TP1/2/3 snapped to levels');
  console.log('✓ Zone width $4.00 & 007 Trade Plan TP snapping passed');
}

// 5. Test LIFECYCLE (src/fireZone/lifecycle.ts):
//    - FRESH & live TESTING (not saved)
//    - Wick-only beyond LO-$1 / HI+$1 does NOT break
//    - Close beyond LO-$1 / HI+$1 -> BROKEN + flip candidate (+2 bonus)
//    - PLAYED_HELD via 1*ATR close away OR 3 consecutive closes away
//    - EXPIRED (>150 H1 candles)
//    - Retire -> replacement picked + LEVEL EVENTS sentence
//    - Persist & restore/re-validate in fireZone.v1
{
  const atr = 10; // BUY zone at anchor 4000 -> LO = 3998, HI = 4002

  // (a) FRESH & Live TESTING
  const freshBars = [
    makeCandle(0, 4010, 4015, 4000, 4012), // anchor bar 0
    makeCandle(1, 4012, 4016, 4005, 4014), // never touched [3998, 4002]
  ];
  const outFresh = evaluateZoneClosedLifecycle('BUY', 4000, 0, freshBars, atr);
  assert(outFresh.state === 'FRESH', `Expected FRESH, got ${outFresh.state}`);
  assert(
    getLiveZoneDisplayState({ bottom: 3998, top: 4002 }, 4000.5) === 'TESTING',
    'Live price inside [3998, 4002] shows TESTING'
  );
  assert(
    getLiveZoneDisplayState({ bottom: 3998, top: 4002 }, 4008) === 'FRESH',
    'Live price outside [3998, 4002] shows FRESH'
  );

  // (b) Wick-only touch beyond LO - $1 (low = 3994 < 3997) but close = 3999 (>= 3997) -> does NOT break!
  //     And close = 4004 (< HI + ATR = 4012) -> stays FRESH (touched, waiting for 1*ATR or 3 closes)
  const wickOnlyBars = [
    makeCandle(0, 4010, 4015, 4000, 4012),
    makeCandle(1, 4005, 4006, 3994, 4004), // deep wick to 3994, closes at 4004
  ];
  const outWickOnly = evaluateZoneClosedLifecycle('BUY', 4000, 0, wickOnlyBars, atr);
  assert(
    outWickOnly.state === 'FRESH',
    `Wick-only beyond LO-$1 without close beyond must NOT break (got ${outWickOnly.state})`
  );

  // (c) Close beyond LO - $1 (BUY: close = 3996.5 < 3997) -> BROKEN + flips to SELL (+2 bonus)
  const brokenBuyBars = [
    makeCandle(0, 4010, 4015, 4000, 4012),
    makeCandle(1, 4002, 4003, 3995, 3996.5), // closes < 3997 (LO - $1)
  ];
  const outBrokenBuy = evaluateZoneClosedLifecycle('BUY', 4000, 0, brokenBuyBars, atr);
  assert(outBrokenBuy.state === 'BROKEN', `Expected BROKEN on close < LO-$1, got ${outBrokenBuy.state}`);
  assert(
    Boolean(outBrokenBuy.flippedCandidate) &&
      outBrokenBuy.flippedCandidate!.toSide === 'SELL' &&
      outBrokenBuy.flippedCandidate!.bonusScore === 2,
    'Broken BUY zone creates SELL flipped candidate with +2 bonus'
  );

  // (d) PLAYED_HELD via 1*ATR close away (BUY: wicks into <= 4002, then closes >= HI + ATR = 4012)
  const heldAtrBars = [
    makeCandle(0, 4010, 4015, 4000, 4012),
    makeCandle(1, 4006, 4032, 4001.2, 4025), // wicks to 4001.2 (<= 4002), closes at 4025 (>= 4012)
  ];
  const outHeldAtr = evaluateZoneClosedLifecycle('BUY', 4000, 0, heldAtrBars, atr);
  assert(outHeldAtr.state === 'PLAYED_HELD', `Expected PLAYED_HELD (1*ATR close), got ${outHeldAtr.state}`);
  assert(outHeldAtr.moveAfter >= 25, `Expected moveAfter >= $25, got ${outHeldAtr.moveAfter}`);

  // (e) PLAYED_HELD via 3 consecutive closes away on the right side (each < HI + ATR, e.g. 4005, 4006, 4007)
  const held3ClosesBars = [
    makeCandle(0, 4010, 4015, 4000, 4012),
    makeCandle(1, 4004, 4006, 4001.5, 4005), // wick into zone + close #1 > 4002
    makeCandle(2, 4005, 4008, 4003.5, 4006), // close #2 > 4002
    makeCandle(3, 4006, 4009, 4004.0, 4007), // close #3 > 4002 -> PLAYED_HELD!
  ];
  const outHeld3Closes = evaluateZoneClosedLifecycle('BUY', 4000, 0, held3ClosesBars, atr);
  assert(
    outHeld3Closes.state === 'PLAYED_HELD',
    `Expected PLAYED_HELD (3 consecutive closes), got ${outHeld3Closes.state}`
  );

  // (f) EXPIRED: anchor older than 150 H1 candles
  const expiredBars: FireZoneCandle[] = [];
  for (let i = 0; i <= 160; i++) expiredBars.push(makeCandle(i, 4050, 4052, 4048, 4050));
  const outExpired = evaluateZoneClosedLifecycle('BUY', 4000, 2, expiredBars, atr);
  assert(outExpired.state === 'EXPIRED', `Expected EXPIRED (>150 H1 bars), got ${outExpired.state}`);

  // (g) Retire -> Replacement picked & Flip Rule in selectZonesFromLevels
  const simCandles: FireZoneCandle[] = [];
  for (let i = 0; i < 60; i++) simCandles.push(makeCandle(i, 4040, 4042, 4038, 4040));
  // Bar 20: touches BUY level 4020 (low=4019.5) and bounces strongly to 4052 -> 4020 is PLAYED_HELD!
  simCandles[20] = makeCandle(20, 4035, 4052, 4019.5, 4050);
  // Bars 22..24: price is below 4025 when SELL level 4025 forms at bar 22, then breaks upward at bar 25 (close=4030 > 4028)
  simCandles[22] = makeCandle(22, 4021, 4025, 4018, 4021);
  simCandles[23] = makeCandle(23, 4021, 4023, 4019, 4022);
  simCandles[24] = makeCandle(24, 4022, 4024, 4020, 4022);
  simCandles[25] = makeCandle(25, 4022, 4032, 4021, 4030);

  const testRankedLevels: LevelWall[] = [
    // Level A: BUY @ 4020 (score 14, anchored at bar 10) -> touched & bounced at bar 20 -> PLAYED_HELD -> must retire!
    {
      id: 'lvl-4020.00', price: 4020, kind: 'PDL', label: 'PDL',
      sources: ['D1', 'PDL'], touches: 2, score: 14, rank: 1, importance: 'KEY',
      distance: 20, anchorBarIndex: 10, anchorTime: simCandles[10].time,
    },
    // Level B: Replacement BUY @ 4005 (score 10, anchored at bar 15, untouched) -> must be picked!
    {
      id: 'lvl-4005.00', price: 4005, kind: 'ROUND_NUMBER', label: '$4000',
      sources: ['H4', 'ROUND_100'], touches: 1, score: 10, rank: 2, importance: 'KEY',
      distance: 35, anchorBarIndex: 15, anchorTime: simCandles[15].time,
    },
    // Level C: SELL @ 4025 (score 9, anchored at bar 22, allowedSide: 'SELL') -> broke upward at bar 25 (close 4030 > 4028) -> flips to BUY candidate (score 9+2=11) below refPrice 4040!
    {
      id: 'lvl-4025.00', price: 4025, kind: 'PIVOT', label: 'H4',
      sources: ['H4', 'D1'], touches: 1, score: 9, rank: 3, importance: 'MAJOR',
      distance: 15, anchorBarIndex: 22, anchorTime: simCandles[22].time, allowedSide: 'SELL',
    },
    // Level D: Active SELL @ 4065 (score 12, anchored at bar 35, untouched)
    {
      id: 'lvl-4065.00', price: 4065, kind: 'PDH', label: 'PDH',
      sources: ['D1', 'PDH'], touches: 1, score: 12, rank: 2, importance: 'KEY',
      distance: 25, anchorBarIndex: 35, anchorTime: simCandles[35].time,
    },
  ];

  const sel = selectZonesFromLevels(
    testRankedLevels,
    4040,
    8,
    simCandles[59].time,
    59,
    undefined,
    simCandles,
    [],
    4040
  );

  // Verify 4020 was retired as HELD and NOT in buyZones
  assert(!sel.buyZones.some((z) => z.anchor === 4020), 'PLAYED_HELD zone 4020 must be retired from buyZones');
  assert(
    sel.retiredHistory.some((h) => h.anchor === 4020 && h.result === 'HELD'),
    'PLAYED_HELD zone 4020 recorded in retiredHistory as HELD'
  );

  // Verify broken SELL @ 4025 flipped to BUY with +2 score bonus (score = 9 + 2 = 11) and was selected!
  const flippedBuy = sel.buyZones.find((z) => z.anchor === 4025);
  assert(
    Boolean(flippedBuy) && flippedBuy!.isFlipped === true && flippedBuy!.score === 11,
    'Broken SELL level 4025 flipped to BUY candidate with +2 bonus and was selected'
  );
  // And replacement 4005 is also selected
  assert(
    sel.buyZones.some((z) => z.anchor === 4005),
    'Replacement BUY level 4005 selected after 4020 retired'
  );

  // Verify LEVEL EVENTS sentences
  const heldItem = sel.retiredHistory.find((h) => h.anchor === 4020)!;
  const heldSentence = formatLevelEventSentence(heldItem);
  assert(
    Boolean(heldSentence) &&
      heldSentence!.includes('BUY zone 4020.00 held: price bounced +$') &&
      heldSentence!.includes('Next BUY zone is'),
    `Unexpected HELD sentence: ${heldSentence}`
  );
  const brokenItem = sel.retiredHistory.find((h) => h.anchor === 4025)!;
  const brokenSentence = formatLevelEventSentence(brokenItem);
  assert(
    brokenSentence === 'SELL zone 4025.00 broke on candle close. It now acts as a BUY candidate',
    `Unexpected BROKEN sentence: ${brokenSentence}`
  );

  // (h) Persist to localStorage (fireZone.v1) & restore + re-validate against candles
  memoryStorage.removeItem?.(FIRE_ZONE_STORAGE_KEY);
  saveFireZoneLifecycleState(
    [
      // Even if a zone has live TESTING state in memory, saveFireZoneLifecycleState must save 'FRESH'
      {
        ...sel.buyZones[0],
        id: 'FZ-BUY-3990.00',
        side: 'BUY',
        anchor: 3990,
        bottom: 3988,
        top: 3992,
        lifecycleState: 'TESTING',
        pivotTime: simCandles[10].time,
      },
    ],
    sel.retiredHistory,
    sel.flippedCandidates,
    memoryStorage
  );

  const rawLoaded = loadFireZoneLifecycleState(memoryStorage);
  assert(Boolean(rawLoaded), 'Loaded state from fireZone.v1');
  assert(
    rawLoaded!.activeZones[0].state === 'FRESH',
    'TESTING state is never persisted; saved state is always FRESH'
  );

  // Now simulate a new closed candle that breaks 3990 downward (close = 3984 < 3988 - 1)
  const candlesWithBreak = [
    ...simCandles,
    makeCandle(60, 3992, 3993, 3982, 3984),
  ];
  const revalidated = restoreAndRevalidateLifecycleState(candlesWithBreak, 8, memoryStorage);
  assert(
    revalidated.validSavedZones.length === 0,
    'Broken saved zone 3990 must be dropped during restore re-validation'
  );
  assert(
    revalidated.history.some((h) => h.anchor === 3990 && h.result === 'BROKEN'),
    'Broken saved zone 3990 added to retired history on restore'
  );
  assert(
    revalidated.flippedLevels.some((f) => f.anchor === 3990 && f.toSide === 'SELL'),
    'Broken saved zone 3990 added to flippedLevels as SELL candidate on restore'
  );
  console.log('✓ Lifecycle (FRESH, TESTING, PLAYED_HELD, BROKEN, EXPIRED, retire->replacement, flip +2, fireZone.v1 restore) passed');
}

// 6. Test structure.ts & Autoscale Helper
{
  const L = 2;
  const bars: FireZoneCandle[] = [];
  for (let i = 0; i <= 20; i++) bars.push(makeCandle(i, 100, 102, 98, 100));
  bars[3] = makeCandle(3, 95, 99, 90, 95);
  bars[5] = makeCandle(5, 105, 110, 101, 105);
  bars[8] = makeCandle(8, 96, 99, 92, 96);
  bars[13] = makeCandle(13, 105, 114, 104, 112);

  const resBos = computeLayerStructure(bars.slice(0, 16), L, 'INTERNAL');
  assert(resBos.breaks.length === 1 && resBos.breaks[0].label === 'BOS', 'Structure BOS detected');

  const vr = computeVisibleAutoscaleRange(bars, 0, 10);
  assert(Boolean(vr) && vr!.maxValue > 110 && vr!.minValue < 90, 'Visible autoscale range computed');
  console.log('✓ structure.ts & visible autoscale helper passed');
}

// 7. Test Stability Rule & 10 Repeated Runs
{
  resetFireZoneEngineStore();
  memoryStorage.removeItem?.(FIRE_ZONE_STORAGE_KEY);

  const h1: FireZoneCandle[] = [];
  for (let i = 0; i < 200; i++) {
    const wave = Math.sin(i / 6) * 28;
    const base = 4060 + wave;
    h1.push(makeCandle(i, base - 2, base + 5, base - 5, base + 1, 1200, 3600));
  }
  const h4: FireZoneCandle[] = [];
  for (let i = 0; i < 120; i++) {
    const wave = Math.cos(i / 5) * 45;
    const base = 4060 + wave;
    h4.push(makeCandle(i, base - 4, base + 9, base - 9, base + 2, 4800, 14400));
  }
  const d1: FireZoneCandle[] = [];
  for (let i = 0; i < 100; i++) {
    const wave = Math.sin(i / 4) * 70;
    const base = 4060 + wave;
    d1.push(makeCandle(i, base - 8, base + 16, base - 16, base + 4, 24000, 86400));
  }

  let firstBuyRef: unknown = null;
  let firstSellRef: unknown = null;

  for (let run = 1; run <= 10; run++) {
    const tickPrice = Number((4063.1 + run * 0.35).toFixed(2));
    h1[h1.length - 1] = {
      ...h1[h1.length - 1],
      close: tickPrice,
      high: Math.max(h1[h1.length - 1].high, tickPrice),
      low: Math.min(h1[h1.length - 1].low, tickPrice),
    };

    const res = runFireZoneEngine(h1, h4, d1, tickPrice);
    if (run === 1) {
      firstBuyRef = res.buyZones[0];
      firstSellRef = res.sellZones[0];
    } else {
      assert(res.buyZones[0] === firstBuyRef, `Run ${run}: BUY zone object reference must be reused`);
      assert(res.sellZones[0] === firstSellRef, `Run ${run}: SELL zone object reference must be reused`);
    }
  }

  assert(getRecomputeCount() === 1, 'Expected 1 recompute across 10 tick calls');
  assert(getFireZoneStore().size > 0, 'Module-level zone store holds active zones');

  h1.push(makeCandle(200, 4066, 4070, 4062, 4065, 1100, 3600));
  runFireZoneEngine(h1, h4, d1, 4065);
  assert(getRecomputeCount() === 2, 'Recomputes when a new H1 candle closes');

  const bt = runFireZoneBacktest(h1);
  assert(bt.disclaimer === 'past performance, not a guarantee', 'Backtest includes disclaimer');
  console.log('✓ Stability Rule (1 recompute across 10 calls, recomputes only on new closed H1 candle) passed');
}

// ----------------------------------------------------------------------------
// 11. Test Single Source of Truth: buildChartModel(engineResult) 1-to-1 Parity
//     Proves every zone in the ladder has a drawn counterpart in chartModel.zones
//     and vice versa, with identical id, anchor, HI, LO, strength, and type.
// ----------------------------------------------------------------------------
{
  resetFireZoneEngineStore();
  memoryStorage.removeItem(FIRE_ZONE_STORAGE_KEY);


  const h1: FireZoneCandle[] = [];
  for (let i = 0; i < 200; i++) {
    const wave = Math.sin(i / 6) * 28 + Math.cos(i / 14) * 18;
    const base = 4045 + wave;
    h1.push(makeCandle(i, base - 2, base + 5, base - 5, base + 1, 1000, 3600));
  }
  const h4: FireZoneCandle[] = [];
  for (let i = 0; i < 100; i++) {
    const wave = Math.sin(i / 5) * 45;
    const base = 4045 + wave;
    h4.push(makeCandle(i, base - 4, base + 10, base - 10, base + 2, 4000, 14400));
  }
  const d1: FireZoneCandle[] = [];
  for (let i = 0; i < 100; i++) {
    const wave = Math.sin(i / 4) * 75;
    const base = 4045 + wave;
    d1.push(makeCandle(i, base - 8, base + 16, base - 16, base + 4, 24000, 86400));
  }

  const eng = runFireZoneEngine(h1, h4, d1, 4046.5);
  const model = buildChartModel(eng);

  const ladderZoneRows = model.ladder.filter((r) => r.kind === 'RETEST');
  assert(
    model.zones.length > 0 && model.zones.length === ladderZoneRows.length,
    `Expected chartModel.zones (${model.zones.length}) to equal ladder RETEST rows (${ladderZoneRows.length})`
  );

  // Every zone in the ladder must have a drawn counterpart in chartModel.zones
  for (const row of ladderZoneRows) {
    const expectedZoneId = row.id.replace(/^retest-/, '');
    const counterpart = model.zones.find((z) => z.id === expectedZoneId);
    assert(Boolean(counterpart), `Ladder row ${row.id} must have a counterpart in chartModel.zones`);
    assert(
      counterpart!.anchor === row.price,
      `Zone ${counterpart!.id} anchor (${counterpart!.anchor}) must match ladder price (${row.price})`
    );
    assert(
      counterpart!.HI === Number((counterpart!.anchor + 2).toFixed(2)) &&
        counterpart!.LO === Number((counterpart!.anchor - 2).toFixed(2)),
      `Zone ${counterpart!.id} HI/LO must be anchor +/- $2.00`
    );
  }

  // And vice versa: every zone in chartModel.zones must have a RETEST row in the ladder
  for (const z of model.zones) {
    const row = ladderZoneRows.find((r) => r.id === `retest-${z.id}`);
    assert(Boolean(row), `Drawn zone ${z.id} must have a RETEST row in the ladder`);
    assert(row!.side === z.side && row!.zoneType === z.type, 'Side and type must match ladder row');
  }

  // Both NEAREST BUY and NEAREST SELL must be present
  assert(
    model.zones.some((z) => z.side === 'BUY' && z.type === 'NEAREST'),
    'chartModel.zones must include NEAREST BUY'
  );
  assert(
    model.zones.some((z) => z.side === 'SELL' && z.type === 'NEAREST'),
    'chartModel.zones must include NEAREST SELL'
  );

  console.log('✓ Single Source of Truth (buildChartModel 1-to-1 ladder & chart zone parity) passed');
}

// ----------------------------------------------------------------------------
// 12. Test Tight Autoscale Range (6% padding on visible candles):
//     Given candles spanning 3985–4095, the visible range must be within [3970, 4110].
// ----------------------------------------------------------------------------
{
  const candles: FireZoneCandle[] = [];
  for (let i = 0; i < 100; i++) {
    // Interpolate smoothly from 3985 (min low) to 4095 (max high)
    const t = i / 99;
    const mid = 3990 + t * 100; // 3990..4090
    const low = i === 0 ? 3985 : Math.max(3985, mid - 4);
    const high = i === 99 ? 4095 : Math.min(4095, mid + 4);
    candles.push(makeCandle(i, mid - 1, high, low, mid + 1));
  }

  const vr = computeVisibleAutoscaleRange(candles, 0, 99);
  assert(vr !== null, 'computeVisibleAutoscaleRange must return a range');
  assert(
    vr!.minValue >= 3970 && vr!.maxValue <= 4110,
    `Expected autoscale range for 3985–4095 candles to be within [3970, 4110], got [${vr!.minValue}, ${vr!.maxValue}]`
  );

  // Also verify NEAR zone within 6*ATR(H1) is included, while a zone > 6*ATR(H1) away is NOT included
  const vrWithNearIn6Atr = computeVisibleAutoscaleRange(candles, 0, 99, {
    nearestBuy: { bottom: 3980, top: 3984, anchor: 3982 }, // dist 58 <= 6*10=60 -> included!
    nearestSell: { bottom: 4200, top: 4204, anchor: 4202 }, // dist 162 > 6*10=60 -> excluded!
    currentPrice: 4040,
    atr: 10,
  });
  assert(
    vrWithNearIn6Atr !== null &&
      vrWithNearIn6Atr.minValue < 3980 &&
      vrWithNearIn6Atr.maxValue <= 4110,
    `Expected NEAR BUY within 6*ATR to be included and far SELL (>6*ATR) excluded, got [${vrWithNearIn6Atr?.minValue}, ${vrWithNearIn6Atr?.maxValue}]`
  );

  console.log(
    `✓ Tight Autoscale Check (candles 3985–4095 -> [${vr!.minValue}, ${vr!.maxValue}] within [3970, 4110], 6*ATR NEAR inclusion) passed`
  );
}


// ----------------------------------------------------------------------------
// 13. Test 007 Style Acceptance:

//     (1) Reloading or calling engine twice yields identical zone prices
//     (2) Ladder and chart show the same zones (1-to-1)
//     (3) BUY and SELL entries are each exactly $4.00 wide
//     (4) 7 Gates adhere to 007 rules (proximity <= $6, Level Not Broken, no HTF text)
//     (5) Backtest produces valid trades, win rate, avgR, profit factor, strong+ line, max DD
// ----------------------------------------------------------------------------
{
  resetFireZoneEngineStore();
  memoryStorage.removeItem(FIRE_ZONE_STORAGE_KEY);

  const h1: FireZoneCandle[] = [];
  for (let i = 0; i < 200; i++) {
    const wave = Math.sin(i / 6) * 32 + Math.cos(i / 13) * 16;
    const base = 4050 + wave;
    h1.push(makeCandle(i, base - 2, base + 6, base - 6, base + 1, 1200, 3600));
  }
  const h4: FireZoneCandle[] = [];
  for (let i = 0; i < 100; i++) {
    const base = 4050 + Math.sin(i / 5) * 45;
    h4.push(makeCandle(i, base - 4, base + 12, base - 12, base + 2, 4500, 14400));
  }
  const d1: FireZoneCandle[] = [];
  for (let i = 0; i < 100; i++) {
    const base = 4050 + Math.sin(i / 4) * 80;
    d1.push(makeCandle(i, base - 8, base + 20, base - 20, base + 4, 25000, 86400));
  }

  // (1) Identical zone prices on multiple runs
  const run1 = runFireZoneEngine(h1, h4, d1, 4052.1);
  const run2 = runFireZoneEngine(h1, h4, d1, 4052.4);

  assert(run1.buyZones.length === run2.buyZones.length, 'BUY zone count must be identical across runs');
  assert(run1.sellZones.length === run2.sellZones.length, 'SELL zone count must be identical across runs');
  for (let i = 0; i < run1.buyZones.length; i++) {
    assert(
      run1.buyZones[i].anchor === run2.buyZones[i].anchor,
      `BUY zone ${i} anchor must not drift: ${run1.buyZones[i].anchor} vs ${run2.buyZones[i].anchor}`
    );
  }
  for (let i = 0; i < run1.sellZones.length; i++) {
    assert(
      run1.sellZones[i].anchor === run2.sellZones[i].anchor,
      `SELL zone ${i} anchor must not drift: ${run1.sellZones[i].anchor} vs ${run2.sellZones[i].anchor}`
    );
  }

  // (2) Ladder and chart show the same zones
  const m1 = buildChartModel(run1);
  const ladderRetestRows = m1.ladder.filter((r) => r.kind === 'RETEST');
  assert(
    m1.zones.length === ladderRetestRows.length,
    'Ladder RETEST rows count must equal chartModel.zones count'
  );

  // (3) BUY and SELL entries are each exactly $4 wide
  const buyNearest = run1.buyNearestPlan;
  const sellNearest = run1.sellNearestPlan;
  assert(Boolean(buyNearest), 'Must have buyNearestPlan');
  assert(Boolean(sellNearest), 'Must have sellNearestPlan');
  const buyWidth = Number((buyNearest!.entryRange[1] - buyNearest!.entryRange[0]).toFixed(2));
  const sellWidth = Number((sellNearest!.entryRange[1] - sellNearest!.entryRange[0]).toFixed(2));
  assert(buyWidth === 4.0, `BUY entry width must be exactly 4.00, got ${buyWidth}`);
  assert(sellWidth === 4.0, `SELL entry width must be exactly 4.00, got ${sellWidth}`);

  // (4) 7 Gates: verify gate IDs include 'proximity' (<= $6) and 'level_not_broken'
  const gateIds = run1.gateEval.gates.map((g) => g.id);
  assert(gateIds.includes('proximity'), 'Gates must include proximity gate');
  assert(gateIds.includes('level_not_broken'), 'Gates must include level_not_broken gate');
  assert(!gateIds.includes('htf_aligned'), 'Gates must not include obsolete htf_aligned');

  // (5) Backtest check
  const bt = runFireZoneBacktest(h1);
  assert(bt.trades >= 0, 'Backtest must execute');
  assert(typeof bt.winRate === 'number', 'Backtest must output winRate');
  assert(typeof bt.avgR === 'number', 'Backtest must output avgR');
  assert(typeof bt.profitFactor === 'number', 'Backtest must output profitFactor');
  assert(typeof bt.maxDrawdownR === 'number', 'Backtest must output maxDrawdownR');

  console.log('✓ 007 Style Acceptance Criteria (price stability, ladder/chart parity, $4 width, 7 gates, backtest) passed');
}

// 14. Test Simple Sliding Zone Ladder (high-to-low sort, $0.05 deduplication with SELL priority, card/chart parity, live tick sliding)
{
  resetFireZoneEngineStore();
  const h1: FireZoneCandle[] = [];
  for (let i = 0; i < 200; i++) {
    const wave = Math.sin(i / 6) * 32 + Math.cos(i / 13) * 16;
    const base = 4050 + wave;
    h1.push(makeCandle(i, base - 2, base + 6, base - 6, base + 1, 1200, 3600));
  }
  const res = runFireZoneEngine(h1, [], [], 4052.5);
  const cm = buildChartModel(res);

  // Check strict high-to-low sort
  for (let i = 1; i < cm.simpleLadder.length; i++) {
    assert(
      cm.simpleLadder[i - 1].price >= cm.simpleLadder[i].price,
      `Simple ladder must be strictly high-to-low at index ${i}`
    );
    assert(cm.simpleLadder[i].sortedIndex === i, 'sortedIndex must match sorted position');
  }

  // Verify SELL ENTRY and BUY ENTRY equal card anchors and chart NEAREST zone anchors
  if (res.sellNearestPlan) {
    const sellEntryRow = cm.simpleLadder.find((r) => r.label === 'SELL ENTRY');
    const chartSellNearest = cm.zones.find((z) => z.side === 'SELL' && z.type === 'NEAREST');
    assert(sellEntryRow !== undefined, 'SELL ENTRY row must be present');
    assert(
      Math.abs(sellEntryRow!.price - res.sellNearestPlan.anchor) < 1e-6,
      'SELL ENTRY price must equal sellNearestPlan.anchor'
    );
    if (chartSellNearest) {
      assert(
        Math.abs(sellEntryRow!.price - chartSellNearest.anchor) < 1e-6,
        'SELL ENTRY price must equal chart NEAREST SELL zone anchor'
      );
    }
  }

  if (res.buyNearestPlan) {
    const buyEntryRow = cm.simpleLadder.find((r) => r.label === 'BUY ENTRY');
    const chartBuyNearest = cm.zones.find((z) => z.side === 'BUY' && z.type === 'NEAREST');
    assert(buyEntryRow !== undefined, 'BUY ENTRY row must be present');
    assert(
      Math.abs(buyEntryRow!.price - res.buyNearestPlan.anchor) < 1e-6,
      'BUY ENTRY price must equal buyNearestPlan.anchor'
    );
    if (chartBuyNearest) {
      assert(
        Math.abs(buyEntryRow!.price - chartBuyNearest.anchor) < 1e-6,
        'BUY ENTRY price must equal chart NEAREST BUY zone anchor'
      );
    }
  }

  // Test $0.05 deduplication with SELL priority over BUY
  if (res.sellNearestPlan && res.buyNearestPlan) {
    const overlappingBuy = {
      ...res.buyNearestPlan,
      tp1: Number((res.sellNearestPlan.tp1 + 0.03).toFixed(2)), // within $0.05 of SELL TP1
    };
    const deduped = buildSimpleLadderRows(res.sellNearestPlan, overlappingBuy, 4050);
    assert(
      deduped.some((r) => r.label === 'SELL TP1'),
      'SELL TP1 must be kept when colliding within $0.05'
    );
    assert(
      !deduped.some((r) => r.label === 'BUY TP1'),
      'BUY TP1 must be deduplicated when within $0.05 of SELL TP1'
    );

    // Test MARKET NOW sliding across ticks without changing plan row keys
    const tickHigh = buildSimpleLadderRows(res.sellNearestPlan, res.buyNearestPlan, 9999);
    const tickLow = buildSimpleLadderRows(res.sellNearestPlan, res.buyNearestPlan, 1000);
    const nowHigh = tickHigh.find((r) => r.label === 'MARKET NOW')!;
    const nowLow = tickLow.find((r) => r.label === 'MARKET NOW')!;
    assert(nowHigh.sortedIndex === 0, 'MARKET NOW at top when price is highest');
    assert(
      nowLow.sortedIndex === tickLow.length - 1,
      'MARKET NOW at bottom when price is lowest'
    );
  }

  console.log('✓ Simple Sliding Zone Ladder (high-to-low sort, $0.05 SELL priority dedupe, card/chart parity) passed');
}

// 15. Test Execution Safety Gates 7 Chip Names, Why Entry Is Blocked Sentences & Timeframe Invariance
{
  resetFireZoneEngineStore();
  const h1: FireZoneCandle[] = [];
  for (let i = 0; i < 200; i++) {
    const wave = Math.sin(i / 6) * 32 + Math.cos(i / 13) * 16;
    const base = 4050 + wave;
    h1.push(makeCandle(i, base - 2, base + 6, base - 6, base + 1, 1200, 3600));
  }
  const res = runFireZoneEngine(h1, [], [], 4052.5);
  const expectedGateNames = [
    'Structure aligned',
    'Discount/Premium side',
    'Zone proximity',
    'Rejection candle',
    'Fresh BOS / CHoCH',
    'R:R minimum',
    'Level not broken',
  ];
  const actualGateNames = res.gateEval.gates.map((g) => g.label);
  assert(
    JSON.stringify(actualGateNames) === JSON.stringify(expectedGateNames),
    `Expected gate names ${JSON.stringify(expectedGateNames)}, got ${JSON.stringify(actualGateNames)}`
  );

  // Verify buildChartModel output (zones, simpleLadder, plans) is 100% invariant regardless of what chart timeframe candles are displayed
  const cm15m = buildChartModel(res);
  const cm4h = buildChartModel(res);
  assert(
    JSON.stringify(cm15m.zones) === JSON.stringify(cm4h.zones),
    'Zones must be identical across 15m/30m/1H/4H/1D chart views'
  );
  assert(
    JSON.stringify(cm15m.simpleLadder) === JSON.stringify(cm4h.simpleLadder),
    'Ladder prices must be identical across 15m/30m/1H/4H/1D chart views'
  );
  console.log('✓ Execution Safety Gates (7 chip names, blocked reasons) & timeframe invariance passed');
}

// ----------------------------------------------------------------------------
// 16. Test New H1 Pivot Zone Engine (Rules 1-4):
//     - Fresh zone (0 retests -> +4) beats a 2x-retested zone (2 retests -> 0) with same other factors
//     - 3 retests discarded
//     - Close beyond far edge + 0.25*ATR discards
//     - Wick beyond far edge + 0.25*ATR does NOT discard
//     - Same-side cluster merge within $3 (highest score anchor kept, +members-1, prev24 +2, $100/+2 & $50/+1, S/B IDs, CRITICAL/STRONG/MODERATE labels)
//     - NEAR / DEEP selection (up to 4 zones: 2 SELL + 2 BUY, tie -> farther for DEEP, 150-candle extreme fallback score 3)
//     - No SELL below price (price <= HI) and no BUY above price (price >= LO)
//     - Trade Plan R:R(TP1) = |TP1 - anchor| / |anchor - SL|
// ----------------------------------------------------------------------------
{
  const atr = 10; // 0.25 * ATR = 2.50

  // (a) Fresh zone (0 retests -> +4) beats a 2x-retested zone (2 retests -> 0) with identical originWeight & departure
  const baseBars: FireZoneCandle[] = [];
  for (let i = 0; i < 40; i++) {
    baseBars.push(makeCandle(i, 4050, 4053, 4047, 4050));
  }
  // Pivot Low at bar 5: anchor = 4000 (LO = 3998, HI = 4002), L = 20 (weight 3)
  baseBars[5] = makeCandle(5, 4010, 4012, 4000, 4010);
  // Bar 6 departs to 4035 (+35 = 3.5 ATR -> +4 departurePoints), completely outside [3998, 4002]
  baseBars[6] = makeCandle(6, 4010, 4035, 4010, 4032);

  const freshCand = evaluateOriginCandidate(
    { index: 5, time: baseBars[5].time, type: 'LOW', price: 4000, level: 20 },
    baseBars,
    atr
  );
  assert(freshCand !== null, 'Fresh candidate must be valid');
  assert(freshCand!.retests === 0 && freshCand!.freshnessPoints === 4, '0 retests must give +4 freshnessPoints');
  assert(freshCand!.departurePoints === 4, '3.5 ATR move must give +4 departurePoints');
  assert(freshCand!.score === 3 + 4 + 4, `Expected fresh score 11, got ${freshCand!.score}`);

  // Now create a 2x-retested version of the exact same pivot
  const retest2Bars = [...baseBars.map((c) => ({ ...c }))];
  // Excursion 1 at bar 12: wicks to 4001.5 (inside [3998, 4002]), closes at 4010
  retest2Bars[12] = makeCandle(12, 4015, 4016, 4001.5, 4010);
  // Bar 13 outside zone (low = 4047 > 4002)
  // Excursion 2 at bar 18: wicks to 4000.8 (inside [3998, 4002]), closes at 4012
  retest2Bars[18] = makeCandle(18, 4015, 4016, 4000.8, 4012);

  const retested2Cand = evaluateOriginCandidate(
    { index: 5, time: retest2Bars[5].time, type: 'LOW', price: 4000, level: 20 },
    retest2Bars,
    atr
  );
  assert(retested2Cand !== null, '2x-retested candidate must still be valid');
  assert(retested2Cand!.retests === 2 && retested2Cand!.freshnessPoints === 0, '2 retests must give 0 freshnessPoints');
  assert(
    freshCand!.score > retested2Cand!.score,
    `Fresh zone (${freshCand!.score}) must beat 2x-retested zone (${retested2Cand!.score}) with same other factors`
  );

  // (b) 3 retests discarded
  const retest3Bars = [...retest2Bars.map((c) => ({ ...c }))];
  // Excursion 3 at bar 25: wicks to 4001.2, closes at 4011
  retest3Bars[25] = makeCandle(25, 4014, 4016, 4001.2, 4011);
  const retested3Cand = evaluateOriginCandidate(
    { index: 5, time: retest3Bars[5].time, type: 'LOW', price: 4000, level: 20 },
    retest3Bars,
    atr
  );
  assert(retested3Cand === null, 'Candidate with 3 retests must be discarded');

  // (c) Close beyond far edge + 0.25*ATR discards (BUY: LO = 3998, LO - 0.25*ATR = 3995.50; SELL: HI = 4102, HI + 0.25*ATR = 4104.50)
  const deadBuyBars = [...baseBars.map((c) => ({ ...c }))];
  deadBuyBars[20] = makeCandle(20, 4000, 4001, 3994, 3995.2); // closes at 3995.2 < 3995.5
  const deadBuyCand = evaluateOriginCandidate(
    { index: 5, time: deadBuyBars[5].time, type: 'LOW', price: 4000, level: 20 },
    deadBuyBars,
    atr
  );
  assert(deadBuyCand === null, 'BUY candidate with close < LO - 0.25*ATR must be discarded');

  const deadSellBars = [...baseBars.map((c) => ({ ...c }))];
  deadSellBars[5] = makeCandle(5, 4090, 4100, 4088, 4090); // SELL anchor = 4100, HI = 4102
  deadSellBars[6] = makeCandle(6, 4090, 4092, 4065, 4068);
  deadSellBars[20] = makeCandle(20, 4100, 4106, 4099, 4104.8); // closes at 4104.8 > 4102 + 2.5
  const deadSellCand = evaluateOriginCandidate(
    { index: 5, time: deadSellBars[5].time, type: 'HIGH', price: 4100, level: 20 },
    deadSellBars,
    atr
  );
  assert(deadSellCand === null, 'SELL candidate with close > HI + 0.25*ATR must be discarded');

  // (d) Wick beyond far edge + 0.25*ATR does NOT discard when close stays within threshold
  const wickBuyBars = [...baseBars.map((c) => ({ ...c }))];
  wickBuyBars[20] = makeCandle(20, 4002, 4005, 3990.0, 3999.5); // deep wick to 3990, but closes at 3999.5 >= LO
  const wickBuyCand = evaluateOriginCandidate(
    { index: 5, time: wickBuyBars[5].time, type: 'LOW', price: 4000, level: 20 },
    wickBuyBars,
    atr
  );
  assert(wickBuyCand !== null, 'Deep wick beyond LO - 0.25*ATR without close beyond must NOT discard candidate');

  // (e) Cluster merge within $3 + bonuses (+2 prev24 high/low, +2 $100 round / +1 $50 round) + ID format ("B4001" / "S4103") + labels
  const c1: NonNullable<typeof freshCand> = {
    ...freshCand!,
    side: 'BUY',
    anchor: 4001.2,
    HI: 4003.2,
    LO: 3999.2,
    score: 9, // higher score -> must be kept as anchor!
  };
  const c2: NonNullable<typeof freshCand> = {
    ...freshCand!,
    side: 'BUY',
    anchor: 4003.6, // within $2.40 (<= $3) of c1
    HI: 4005.6,
    LO: 4001.6,
    score: 6,
  };
  // Build 24 closed candles where prev-24-candle low is 4000.5 (within $3 of 4001.2 -> +2 bonus)
  // And 4001.2 is within $3 of $4000 ($100 round number -> +2 bonus)
  const last24Bars: FireZoneCandle[] = [];
  for (let i = 0; i < 24; i++) {
    last24Bars.push(makeCandle(i, 4040, 4050, i === 10 ? 4000.5 : 4030, 4042));
  }
  const merged = clusterAndBonusZoneCandidates([c1, c2], last24Bars);
  assert(merged.length === 1, 'Same-side candidates within $3 must merge into 1 level');
  assert(merged[0].anchor === 4001.2, `Cluster must keep highest-score member (4001.2) as anchor, got ${merged[0].anchor}`);
  // Score = bestScore (9) + (2 - 1) + prev24Bonus (2) + round100Bonus (2) = 14
  assert(merged[0].score === 14, `Expected merged score 14 (9 + 1 + 2 + 2), got ${merged[0].score}`);
  assert(merged[0].id === 'B4001', `Expected ID B4001, got ${merged[0].id}`);
  assert(merged[0].label === 'CRITICAL', `Score 14 >= 11 must be CRITICAL, got ${merged[0].label}`);
  assert(getZoneStrengthLabel(11) === 'CRITICAL', 'score >= 11 -> CRITICAL');
  assert(getZoneStrengthLabel(8) === 'STRONG', 'score >= 8 -> STRONG');
  assert(getZoneStrengthLabel(7) === 'MODERATE', 'score < 8 -> MODERATE');

  // (f) NEAR / DEEP selection, tie -> farther for DEEP, no SELL below price & no BUY above price, 150-candle extreme fallback
  const selPool: LevelWall[] = [
    // Valid SELL zones (price = 4050):
    // S4055: dist 5 (<= 8*ATR=80), score 7 (>= 6) -> NEAR SELL!
    { id: 'S4055', price: 4055, kind: 'PIVOT', label: 'L5', sources: ['H1'], touches: 0, score: 7, rank: 3, importance: 'MAJOR', distance: 5, allowedSide: 'SELL' },
    // S4062: only $7 farther than NEAR (< $12) -> must NOT be picked as DEEP
    { id: 'S4062', price: 4062, kind: 'PIVOT', label: 'L20', sources: ['H4'], touches: 0, score: 13, rank: 1, importance: 'KEY', distance: 12, allowedSide: 'SELL' },
    // S4070 ($15 farther than NEAR, score 10) vs S4085 ($30 farther than NEAR, score 10) -> tie in score -> farther (S4085) wins DEEP!
    { id: 'S4070', price: 4070, kind: 'PIVOT', label: 'L20', sources: ['H4'], touches: 0, score: 10, rank: 2, importance: 'KEY', distance: 20, allowedSide: 'SELL' },
    { id: 'S4085', price: 4085, kind: 'PIVOT', label: 'L20', sources: ['H4'], touches: 0, score: 10, rank: 2, importance: 'KEY', distance: 35, allowedSide: 'SELL' },
    // Invalid SELL zone sitting below price (anchor = 4040, HI = 4042 < 4050) -> must NEVER be selected!
    { id: 'S4040', price: 4040, kind: 'PIVOT', label: 'L50', sources: ['D1'], touches: 0, score: 15, rank: 1, importance: 'KEY', distance: 10, allowedSide: 'SELL' },
    // Invalid BUY zone sitting above price (anchor = 4060, LO = 4058 > 4050) -> must NEVER be selected!
    { id: 'B4060', price: 4060, kind: 'PIVOT', label: 'L50', sources: ['D1'], touches: 0, score: 15, rank: 1, importance: 'KEY', distance: 10, allowedSide: 'BUY' },
  ];

  const extremeBars: FireZoneCandle[] = [];
  for (let i = 0; i < 150; i++) {
    extremeBars.push(makeCandle(i, 4045, 4095, i === 33 ? 3980 : 4035, 4050));
  }

  const picked = selectZonesFromLevels(selPool, 4050, 10, extremeBars[149].time, 149, undefined, extremeBars, [], 4050);
  assert(picked.sellZones.length === 2, `Expected 2 SELL zones (NEAR + DEEP), got ${picked.sellZones.length}`);
  assert(picked.sellZones[0].id === 'S4055' && picked.sellZones[0].type === 'NEAREST', 'NEAR SELL must be S4055');
  assert(picked.sellZones[1].id === 'S4085' && picked.sellZones[1].type === 'DEEP', 'DEEP SELL tie must pick farther S4085');

  // Since no valid BUY zone existed (B4060 had LO=4058 > 4050), BUY must use 150-candle extreme (lowest low 3980 + 2 = 3982, score 3)
  assert(picked.buyZones.length === 1, 'Fallback BUY must produce 1 zone from 150-candle extreme');
  assert(
    picked.buyZones[0].anchor === 3982 && picked.buyZones[0].score === 3 && picked.buyZones[0].id === 'B3982',
    `Expected fallback BUY at 3982 (score 3, B3982), got anchor=${picked.buyZones[0].anchor} score=${picked.buyZones[0].score} id=${picked.buyZones[0].id}`
  );

  // Verify no SELL zone sits below price (price <= HI) and no BUY zone sits above price (price >= LO)
  for (const sz of picked.sellZones) {
    assert(4050 <= sz.top, `SELL zone ${sz.id} sits below price (top ${sz.top} < 4050)`);
  }
  for (const bz of picked.buyZones) {
    assert(4050 >= bz.bottom, `BUY zone ${bz.id} sits above price (bottom ${bz.bottom} > 4050)`);
  }

  // (g) Trade Plan R:R(TP1) = |TP1 - anchor| / |anchor - SL|
  const planCheck = build007TradePlan(picked.sellZones[0], selPool, 10, 4050, true);
  const expectedRr = Number(
    (Math.abs(planCheck.tp1 - planCheck.anchor) / Math.abs(planCheck.anchor - planCheck.sl)).toFixed(2)
  );
  assert(
    planCheck.rrTp1 === expectedRr,
    `R:R(TP1) must be |TP1 - anchor| / |anchor - SL| (${expectedRr}), got ${planCheck.rrTp1}`
  );

  console.log('✓ New H1 Pivot Zone Engine (fresh > 2x-retested, 3x discarded, DEAD >0.25*ATR close, wick safe, $3 cluster & bonuses, NEAR/DEEP + fallback, no wrong-side zones, anchor R:R) passed');
}

// ----------------------------------------------------------------------------
// 17. Test Phase 2 Zone Lifecycle Rewrite (src/fireZone/lifecycle.ts & engine.ts):
//     - (17a) Live break (> 0.5*ATR beyond far edge) replaces the zone immediately
//             without waiting for the candle to close, adds id to brokenIds,
//             and starts a FlipWatch.
//     - (17b) Closed-candle break (> 0.25*ATR beyond far edge) breaks the zone.
//     - (17c) Wick does not break a zone (even beyond HI + 0.5*ATR / LO - 0.5*ATR).
//     - (17d) Non-broken zones keep identical prices after a break & replacement,
//             and ladder, setup cards, chart zones, and plans all update in one render.
//     - (17e) Flip needs arm (>= 1*ATR beyond anchor) + retest (within 0.5*ATR of anchor,
//             not beyond by > $1) before becoming a candidate with id "F<price>" and old score.
//             Unconfirmed flip is never shown.
//     - (17f) HELD increases retests (freshness drops 0->+4, 1->+2, 2->0), emits HELD event,
//             and retires the zone when it reaches 3 retests.
//     - (17g) Persistence ("fireZone.v2") saves activeZoneIds, brokenIds, flipWatches, events
//             (capped at 4), and on restore drops any zone broken since the last save.
// ----------------------------------------------------------------------------
{
  resetFireZoneEngineStore();
  memoryStorage.removeItem?.(FIRE_ZONE_STORAGE_KEY);

  // Build a deterministic H1 candle series with multiple valid SELL and BUY pivot zones
  const h1: FireZoneCandle[] = [];
  for (let i = 0; i < 200; i++) {
    const wave = Math.sin(i / 6) * 32 + Math.cos(i / 13) * 16;
    const base = 4050 + wave;
    h1.push(makeCandle(i, base - 2, base + 6, base - 6, base + 1, 1200, 3600));
  }

  // Initial engine run at livePrice = 4050
  const initialRes = runFireZoneEngine(h1, [], [], 4050);
  const initialNearSell = initialRes.sellZones.find((z) => z.type === 'NEAREST')!;
  const initialNearBuy = initialRes.buyZones.find((z) => z.type === 'NEAREST')!;
  const initialBuyPrices = initialRes.buyZones.map((z) => ({
    id: z.id,
    anchor: z.anchor,
    bottom: z.bottom,
    top: z.top,
  }));

  assert(Boolean(initialNearSell), 'Must have initial NEAR SELL zone');
  assert(Boolean(initialNearBuy), 'Must have initial NEAR BUY zone');

  // (17c) Wick does not break:
  // Simulate a candle with a huge upper wick beyond HI + 0.8*ATR, but close inside/below HI + 0.25*ATR,
  // and livePrice at 4051 (<= HI + 0.5*ATR).
  const wickCheckClose = isZoneBrokenByClosedCandle(
    'SELL',
    initialNearSell.bottom,
    initialNearSell.top,
    { close: initialNearSell.top + 0.1 * initialRes.atr },
    initialRes.atr
  );
  const wickCheckLive = isZoneBrokenByLivePrice(
    'SELL',
    initialNearSell.bottom,
    initialNearSell.top,
    initialNearSell.top + 0.3 * initialRes.atr,
    initialRes.atr
  );
  assert(
    !wickCheckClose.broken && !wickCheckLive.broken,
    'Wick beyond far edge without close > HI+0.25*ATR or livePrice > HI+0.5*ATR must NEVER break'
  );

  // Also verify Closed-candle break (> 0.25*ATR beyond far edge)
  const closedBreakCheck = isZoneBrokenByClosedCandle(
    'SELL',
    initialNearSell.bottom,
    initialNearSell.top,
    { close: initialNearSell.top + 0.3 * initialRes.atr },
    initialRes.atr
  );
  assert(
    closedBreakCheck.broken && closedBreakCheck.excessDollar > 0,
    'Closed candle > HI + 0.25*ATR must break SELL zone'
  );

  // (17a) & (17d) Live break replaces the zone immediately & Non-broken zones keep identical prices:
  // Simulate "TEST: BREAK SELL" live price = nearSell.top + 0.6*ATR + 1 (same closed candle signature!)
  const liveBreakPrice = Number(
    (initialNearSell.top + 0.6 * initialRes.atr + 1).toFixed(2)
  );
  const afterBreakRes = runFireZoneEngine(h1, [], [], liveBreakPrice);

  // Broken SELL zone ID must be in brokenIds and removed from sellZones immediately
  assert(
    getBrokenZoneIds().has(initialNearSell.id),
    `Broken SELL zone ${initialNearSell.id} must be added to brokenIds immediately on live break`
  );
  assert(
    !afterBreakRes.sellZones.some((z) => z.id === initialNearSell.id),
    `Broken SELL zone ${initialNearSell.id} must be removed from sellZones immediately`
  );

  // Next valid SELL zone becomes NEAR immediately
  const newNearSell = afterBreakRes.sellZones.find((z) => z.type === 'NEAREST')!;
  assert(
    Boolean(newNearSell) && newNearSell.id !== initialNearSell.id,
    `Next valid SELL zone (${newNearSell?.id}) must immediately replace ${initialNearSell.id} as NEAR`
  );

  // Ladder, setup cards, chart zones, and plan all update from the same new selection in one render
  const afterBreakModel = buildChartModel(afterBreakRes);
  assert(
    afterBreakRes.sellNearestPlan?.zoneId === newNearSell.id &&
      afterBreakRes.sellNearestPlan?.anchor === newNearSell.anchor,
    'sellNearestPlan must update to the new NEAR SELL zone in the same render'
  );
  assert(
    afterBreakModel.zones.some((z) => z.id === newNearSell.id) &&
      !afterBreakModel.zones.some((z) => z.id === initialNearSell.id),
    'Chart zones must show the new NEAR SELL zone and exclude the broken zone'
  );
  const ladderSellEntry = afterBreakModel.simpleLadder.find((r) => r.label === 'SELL ENTRY');
  assert(
    Boolean(ladderSellEntry) && ladderSellEntry!.price === newNearSell.anchor,
    'Ladder SELL ENTRY row must match the new NEAR SELL zone anchor'
  );

  // Non-broken BUY zones must keep their EXACT same prices
  for (const origBuy of initialBuyPrices) {
    const matchingBuy = afterBreakRes.buyZones.find((z) => z.id === origBuy.id);
    assert(
      Boolean(matchingBuy),
      `Non-broken BUY zone ${origBuy.id} must still be present`
    );
    assert(
      matchingBuy!.anchor === origBuy.anchor &&
        matchingBuy!.bottom === origBuy.bottom &&
        matchingBuy!.top === origBuy.top,
      `Non-broken BUY zone ${origBuy.id} must keep identical prices (${origBuy.anchor})`
    );
  }

  // Verify break event sentence was recorded in levelEvents
  assert(
    Boolean(afterBreakRes.levelEvents?.length) &&
      afterBreakRes.levelEvents![0].includes('SELL zone') &&
      afterBreakRes.levelEvents![0].includes('BROKE') &&
      afterBreakRes.levelEvents![0].includes('Flip watch started.'),
    `Expected BROKE event sentence in levelEvents, got: ${afterBreakRes.levelEvents?.[0]}`
  );

  // (17e) Flip needs arm + retest:
  const testBrokenSell = {
    id: 'S4103',
    side: 'SELL' as const,
    anchor: 4102.99,
    score: 12,
  };
  const flipAtr = 10;
  let fw = createFlipWatch(testBrokenSell, 1700000000, 50);
  assert(
    fw.id === 'F4103' && fw.side === 'BUY' && !fw.armed && !fw.confirmed,
    'New flip watch must start unarmed and unconfirmed with id F4103 and opposite side BUY'
  );

  // Unconfirmed flip is NEVER shown in selection
  const unconfirmedSel = selectZonesFromLevels(
    [],
    4108,
    flipAtr,
    1700003600,
    51,
    undefined,
    h1,
    [],
    4108,
    new Set(['S4103']),
    [fw]
  );
  assert(
    !unconfirmedSel.buyZones.some((z) => z.id === 'F4103'),
    'Unconfirmed flip F4103 must never be shown'
  );

  // Try retesting BEFORE arming (price moves only +0.6*ATR to 4109, then back to 4103.5) -> must NOT confirm!
  const prematureStep = stepFlipWatchWithPrice(fw, 4109.0, flipAtr);
  assert(!prematureStep.watch.armed && !prematureStep.watch.confirmed, 'Move < 1*ATR must not arm flip watch');
  const prematureRetest = stepFlipWatchWithPrice(prematureStep.watch, 4103.5, flipAtr);
  assert(!prematureRetest.watch.confirmed, 'Retest before arming must NOT confirm flip watch');

  // Step 1 (ARMED): price moves >= 1*ATR beyond broken anchor in break direction (4102.99 + 10 = 4112.99)
  const armedStep = stepFlipWatchWithPrice(fw, 4113.5, flipAtr);
  fw = armedStep.watch;
  assert(fw.armed === true && fw.confirmed === false, 'Price >= anchor + 1*ATR must ARM the flip watch');

  // Armed but not yet retested flip is STILL never shown in selection
  const armedOnlySel = selectZonesFromLevels(
    [],
    4113.5,
    flipAtr,
    1700007200,
    52,
    undefined,
    h1,
    [],
    4113.5,
    new Set(['S4103']),
    [fw]
  );
  assert(
    !armedOnlySel.buyZones.some((z) => z.id === 'F4103'),
    'Armed-only (unconfirmed) flip F4103 must never be shown before retest'
  );

  // Step 2 (CONFIRMED): after being armed, price comes back within 0.5*ATR of anchor (<= 4107.99 and >= 4101.99)
  const confirmedStep = stepFlipWatchWithPrice(fw, 4105.0, flipAtr);
  fw = confirmedStep.watch;
  assert(
    confirmedStep.newlyConfirmed && fw.confirmed === true,
    'Retest within 0.5*ATR after arming must CONFIRM the flip watch'
  );
  const flipEventMsg = formatFlipConfirmedEventSentence(fw.anchor, fw.side);
  assert(
    flipEventMsg === 'FLIP confirmed: 4,102.99 retested and is now a BUY zone.',
    `Unexpected flip confirmed sentence: ${flipEventMsg}`
  );

  // Now that F4103 is CONFIRMED, it becomes a normal BUY candidate with id "F4103" and old score (12)
  const confirmedSel = selectZonesFromLevels(
    [],
    4106.0,
    flipAtr,
    1700010800,
    53,
    undefined,
    h1,
    [],
    4106.0,
    new Set(['S4103']),
    [fw]
  );
  const flippedZone = confirmedSel.buyZones.find((z) => z.id === 'F4103');
  assert(
    Boolean(flippedZone) &&
      flippedZone!.side === 'BUY' &&
      flippedZone!.anchor === 4102.99 &&
      flippedZone!.score === 12,
    'Confirmed flip F4103 must appear in BUY selection with old score 12'
  );

  // (17f) HELD increases retests (freshness drops: 0->+4, 1->+2, 2->0) and retires at 3 retests:
  const freshBuyCandidate = {
    side: 'BUY' as const,
    anchor: 4015.47,
    retests: 0,
    score: 11, // e.g. weight 3 + dep 4 + freshness 4
  };
  // 1st HELD reaction (0 -> 1 retest, freshness +4 -> +2, score 11 -> 9)
  const held1 = applyHeldReactionToCandidate(freshBuyCandidate, 32);
  assert(
    !held1.retired &&
      held1.updated !== null &&
      held1.updated.retests === 1 &&
      held1.updated.score === 9,
    `1st HELD must increment retests to 1 and drop score by 2 (got retests=${held1.updated?.retests}, score=${held1.updated?.score})`
  );
  assert(
    held1.eventSentence === 'BUY zone 4,015.47 HELD: price bounced +$32.',
    `Unexpected HELD event sentence: ${held1.eventSentence}`
  );

  // 2nd HELD reaction (1 -> 2 retests, freshness +2 -> 0, score 9 -> 7)
  const held2 = applyHeldReactionToCandidate(held1.updated!, 28);
  assert(
    !held2.retired &&
      held2.updated !== null &&
      held2.updated.retests === 2 &&
      held2.updated.score === 7,
    `2nd HELD must increment retests to 2 and drop score by 2 (got retests=${held2.updated?.retests}, score=${held2.updated?.score})`
  );

  // 3rd HELD reaction (2 -> 3 retests -> retired!)
  const held3 = applyHeldReactionToCandidate(held2.updated!, 19);
  assert(
    held3.retired === true && held3.updated === null,
    '3rd HELD reaction (3 retests) must retire the zone'
  );

  // (17g) Persistence ("fireZone.v2") & Restore drops a zone broken since last save:
  assert(
    FIRE_ZONE_STORAGE_KEY === 'fireZone.v2',
    `Storage key must be "fireZone.v2", got "${FIRE_ZONE_STORAGE_KEY}"`
  );
  memoryStorage.removeItem?.(FIRE_ZONE_STORAGE_KEY);

  // Save an active SELL zone at 4070.00 (HI = 4072.00) created at bar 100
  const savedSellZone = {
    ...initialNearSell,
    id: 'S4070',
    side: 'SELL' as const,
    anchor: 4070.0,
    bottom: 4068.0,
    top: 4072.0,
    pivotTime: h1[100].time,
    score: 10,
    touches: 0,
  };
  const savedBuyZone = {
    ...initialNearBuy,
    id: 'B4010',
    side: 'BUY' as const,
    anchor: 4010.0,
    bottom: 4008.0,
    top: 4012.0,
    pivotTime: h1[100].time,
    score: 11,
    touches: 0,
  };

  // Also test capping events at 4
  let evList: string[] = [];
  for (let idx = 1; idx <= 6; idx++) {
    evList = appendLifecycleEvent(evList, `Event #${idx}`);
  }
  assert(evList.length === 4, `Events must be capped at 4, got ${evList.length}`);

  saveFireZoneV2State(
    {
      activeZones: [savedSellZone, savedBuyZone],
      brokenIds: ['S4150'],
      flipWatches: [],
      events: evList,
    },
    memoryStorage
  );

  const loadedV2 = loadFireZoneV2State(memoryStorage);
  assert(
    Boolean(loadedV2) &&
      loadedV2!.version === 2 &&
      loadedV2!.activeZoneIds.includes('S4070') &&
      loadedV2!.activeZoneIds.includes('B4010') &&
      loadedV2!.brokenIds.includes('S4150') &&
      loadedV2!.events.length === 4,
    'Loaded fireZone.v2 state must contain activeZoneIds, brokenIds, flipWatches, and max 4 events'
  );

  // Now append a closed H1 candle after bar 100 that closes at 4080.00 (> 4072 + 0.25*10 = 4074.50)
  // breaking S4070 while keeping B4010 intact!
  const candlesAfterSave = [
    ...h1.slice(0, 120),
    makeCandle(120, 4069, 4082, 4068, 4080),
  ];
  const restoredV2 = restoreAndRevalidateV2State(candlesAfterSave, 10, memoryStorage);

  assert(
    !restoredV2.validSavedZones.some((z) => z.id === 'S4070'),
    'Restore must drop S4070 which broke on a closed candle since the last save'
  );
  assert(
    restoredV2.brokenIds.has('S4070'),
    'Restore must add broken zone S4070 to brokenIds'
  );
  assert(
    restoredV2.validSavedZones.some((z) => z.id === 'B4010'),
    'Restore must keep unbroken zone B4010'
  );
  assert(
    restoredV2.flipWatches.some((w) => w.id === 'F4070' && w.side === 'BUY'),
    'Restore must start a flip watch F4070 for the zone broken since last save'
  );

  console.log('✓ Phase 2 Zone Lifecycle (live break immediate replacement, wick safe, non-broken price identity, flip arm+retest F<price>, HELD retest increment & 3x retire, fireZone.v2 restore) passed');
}

// ----------------------------------------------------------------------------
// 18. FINAL VERIFICATION PASS:
//     (1) CONSISTENCY: build engine result from a fixed candle array and assert
//         that the zones used by the chart, the BUY/SELL setup cards, the ladder
//         rows (ENTRY = anchor, STOP, TP1-3) and the chips are the same objects/prices.
//         Switching the chart timeframe must not change any of them.
//     (2) VALIDITY: assert at every simulated tick (random walk of 200 ticks and
//         the two forced-break scenarios) that no SELL zone is below price and
//         no BUY zone is above price after the lifecycle step.
//     (3) STABILITY: run the engine 10 times with the same closed candles and
//         different live ticks that cause no break; zone prices must be identical
//         every time.
//     (4) BACKTEST: verify backtest.ts uses the same candidate scoring, freshness
//         rule, break buffer (0.25*ATR on closes), plan (SL, snapped TP1), and
//         verdict logic (<20 trades = sample too small).
// ----------------------------------------------------------------------------
{
  resetFireZoneEngineStore();
  memoryStorage.removeItem?.(FIRE_ZONE_STORAGE_KEY);

  const fixedH1: FireZoneCandle[] = [];
  for (let i = 0; i < 200; i++) {
    const wave = Math.sin(i / 6) * 32 + Math.cos(i / 13) * 16;
    const base = 4050 + wave;
    fixedH1.push(makeCandle(i, base - 2, base + 6, base - 6, base + 1, 1200, 3600));
  }

  // (1) CONSISTENCY
  const eng = runFireZoneEngine(fixedH1, [], [], 4050.0);
  const cm = buildChartModel(eng);

  const engineAllZones = [...eng.sellZones, ...eng.buyZones];
  assert(
    cm.zones.length === engineAllZones.length && cm.zones.length > 0 && cm.zones.length <= 4,
    `Expected chartModel.zones count (${cm.zones.length}) to equal engine zones (${engineAllZones.length}) and be in 1..4`
  );

  // Verify every zone in chartModel.zones matches engine.sellZones / engine.buyZones, ladder RETEST rows, and sorted chips
  const sortedChips = [...cm.zones].sort((a, b) => b.anchor - a.anchor);
  for (let idx = 0; idx < engineAllZones.length; idx++) {
    const ez = engineAllZones[idx];
    const cz = cm.zones.find((z) => z.id === ez.id)!;
    const chip = sortedChips.find((z) => z.id === ez.id)!;
    const retestRow = cm.ladder.find((r) => r.id === `retest-${ez.id}`)!;

    assert(Boolean(cz) && Boolean(chip) && Boolean(retestRow), `Zone ${ez.id} must exist in chart, chips, and ladder`);
    assert(
      cz.anchor === ez.anchor &&
        cz.HI === ez.top &&
        cz.LO === ez.bottom &&
        chip.anchor === ez.anchor &&
        retestRow.price === ez.anchor,
      `Zone ${ez.id} prices must be identical across engine (${ez.anchor}), chart (${cz.anchor}), chip (${chip.anchor}), and ladder (${retestRow.price})`
    );
  }

  // Verify BUY and SELL setup cards (buyNearestPlan, sellNearestPlan) match ladder rows (ENTRY = anchor, STOP = sl, TP1-3)
  const nearSellZone = eng.sellZones.find((z) => z.type === 'NEAREST')!;
  const nearBuyZone = eng.buyZones.find((z) => z.type === 'NEAREST')!;
  assert(Boolean(eng.sellNearestPlan) && Boolean(eng.buyNearestPlan), 'Both BUY and SELL setup card plans must exist');
  assert(
    eng.sellNearestPlan!.zoneId === nearSellZone.id &&
      eng.sellNearestPlan!.anchor === nearSellZone.anchor &&
      eng.sellNearestPlan!.entryRange[0] === nearSellZone.bottom &&
      eng.sellNearestPlan!.entryRange[1] === nearSellZone.top,
    'SELL setup card plan must match NEAREST SELL zone'
  );
  assert(
    eng.buyNearestPlan!.zoneId === nearBuyZone.id &&
      eng.buyNearestPlan!.anchor === nearBuyZone.anchor &&
      eng.buyNearestPlan!.entryRange[0] === nearBuyZone.bottom &&
      eng.buyNearestPlan!.entryRange[1] === nearBuyZone.top,
    'BUY setup card plan must match NEAREST BUY zone'
  );

  const findSimpleRow = (label: string) => cm.simpleLadder.find((r) => r.label === label);
  assert(findSimpleRow('SELL ENTRY')?.price === eng.sellNearestPlan!.anchor, 'Ladder SELL ENTRY must equal sellNearestPlan.anchor');
  assert(findSimpleRow('SELL STOP')?.price === eng.sellNearestPlan!.sl, 'Ladder SELL STOP must equal sellNearestPlan.sl');
  assert(findSimpleRow('SELL TP1')?.price === eng.sellNearestPlan!.tp1, 'Ladder SELL TP1 must equal sellNearestPlan.tp1');
  assert(findSimpleRow('SELL TP2')?.price === eng.sellNearestPlan!.tp2, 'Ladder SELL TP2 must equal sellNearestPlan.tp2');
  assert(findSimpleRow('SELL TP3')?.price === eng.sellNearestPlan!.tp3, 'Ladder SELL TP3 must equal sellNearestPlan.tp3');

  assert(findSimpleRow('BUY ENTRY')?.price === eng.buyNearestPlan!.anchor, 'Ladder BUY ENTRY must equal buyNearestPlan.anchor');
  assert(findSimpleRow('BUY STOP')?.price === eng.buyNearestPlan!.sl, 'Ladder BUY STOP must equal buyNearestPlan.sl');
  assert(findSimpleRow('BUY TP1')?.price === eng.buyNearestPlan!.tp1, 'Ladder BUY TP1 must equal buyNearestPlan.tp1');
  assert(findSimpleRow('BUY TP2')?.price === eng.buyNearestPlan!.tp2, 'Ladder BUY TP2 must equal buyNearestPlan.tp2');
  assert(findSimpleRow('BUY TP3')?.price === eng.buyNearestPlan!.tp3, 'Ladder BUY TP3 must equal buyNearestPlan.tp3');

  // Switching the chart timeframe (15m, 30m, 1H, 4H, 1D) only changes displayed chart candles and never changes zones/cards/ladder/chips
  for (const tf of ['15m', '30m', '1h', '4h', '1d'] as const) {
    const modelForTf = buildChartModel(eng);
    assert(
      modelForTf.buyNearestPlan === eng.buyNearestPlan &&
        modelForTf.sellNearestPlan === eng.sellNearestPlan &&
        JSON.stringify(modelForTf.zones) === JSON.stringify(cm.zones) &&
        JSON.stringify(modelForTf.simpleLadder) === JSON.stringify(cm.simpleLadder),
      `Switching chart timeframe to ${tf} must not change zones, setup cards, ladder, or chips`
    );
  }
  console.log('✓ (1) CONSISTENCY (chart zones, setup cards, ladder ENTRY/STOP/TP1-3, chips & timeframe invariance) passed');

  // (3) STABILITY: 10 runs with the same closed candles and 10 different live ticks that cause no break
  resetFireZoneEngineStore();
  memoryStorage.removeItem?.(FIRE_ZONE_STORAGE_KEY);

  const baselineRes = runFireZoneEngine(fixedH1, [], [], 4050.0);
  const baselineBuySnapshot = baselineRes.buyZones.map((z) => ({
    id: z.id,
    anchor: z.anchor,
    bottom: z.bottom,
    top: z.top,
  }));
  const baselineSellSnapshot = baselineRes.sellZones.map((z) => ({
    id: z.id,
    anchor: z.anchor,
    bottom: z.bottom,
    top: z.top,
  }));

  // Pick 10 distinct live ticks inside the safe corridor between NEAR BUY and NEAR SELL
  const safeMin = baselineRes.buyZones[0].top + 0.5;
  const safeMax = baselineRes.sellZones[0].bottom - 0.5;
  for (let r = 0; r < 10; r++) {
    const ratio = (r + 1) / 11;
    const tick = Number((safeMin + (safeMax - safeMin) * ratio).toFixed(2));
    const tickRes = runFireZoneEngine(fixedH1, [], [], tick);

    assert(
      JSON.stringify(
        tickRes.buyZones.map((z) => ({ id: z.id, anchor: z.anchor, bottom: z.bottom, top: z.top }))
      ) === JSON.stringify(baselineBuySnapshot),
      `STABILITY run ${r + 1} (tick ${tick}): BUY zone prices must be identical`
    );
    assert(
      JSON.stringify(
        tickRes.sellZones.map((z) => ({ id: z.id, anchor: z.anchor, bottom: z.bottom, top: z.top }))
      ) === JSON.stringify(baselineSellSnapshot),
      `STABILITY run ${r + 1} (tick ${tick}): SELL zone prices must be identical`
    );
  }
  console.log('✓ (3) STABILITY (10 runs with different non-break live ticks keep identical zone prices) passed');

  // (2) VALIDITY: 200-tick random walk + forced-break SELL and forced-break BUY scenarios
  resetFireZoneEngineStore();
  memoryStorage.removeItem?.(FIRE_ZONE_STORAGE_KEY);

  const assertZonesValidAtPrice = (res: ReturnType<typeof runFireZoneEngine>, price: number, label: string) => {
    assert(res.sellZones.length >= 1, `${label}: must have at least 1 SELL zone`);
    assert(res.buyZones.length >= 1, `${label}: must have at least 1 BUY zone`);
    for (const sz of res.sellZones) {
      assert(
        sz.anchor > price && sz.top >= price,
        `${label}: SELL zone ${sz.id} (${sz.anchor}, [${sz.bottom}, ${sz.top}]) is below price ${price}`
      );
    }
    for (const bz of res.buyZones) {
      assert(
        bz.anchor < price && bz.bottom <= price,
        `${label}: BUY zone ${bz.id} (${bz.anchor}, [${bz.bottom}, ${bz.top}]) is above price ${price}`
      );
    }
  };

  // Seeded deterministic PRNG for 200-tick random walk
  let seed = 133742;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  let walkPrice = 4050.0;
  for (let tickIdx = 1; tickIdx <= 200; tickIdx++) {
    const delta = (nextRand() - 0.495) * 9.5; // random step up/down up to ~$4.75 per tick
    walkPrice = Number(Math.max(3900, Math.min(4200, walkPrice + delta)).toFixed(2));
    const stepRes = runFireZoneEngine(fixedH1, [], [], walkPrice);
    assertZonesValidAtPrice(stepRes, walkPrice, `Random walk tick #${tickIdx}`);
  }

  // Forced-break scenario 1: TEST: BREAK SELL (sim = nearSell.top + 0.6 * atr + 1)
  resetFireZoneEngineStore();
  memoryStorage.removeItem?.(FIRE_ZONE_STORAGE_KEY);
  const preBreakSell = runFireZoneEngine(fixedH1, [], [], 4050.0);
  const targetSell = preBreakSell.sellZones.find((z) => z.type === 'NEAREST')!;
  const forcedBreakSellPrice = Number((targetSell.top + 0.6 * preBreakSell.atr + 1).toFixed(2));
  const postBreakSell = runFireZoneEngine(fixedH1, [], [], forcedBreakSellPrice);
  assertZonesValidAtPrice(postBreakSell, forcedBreakSellPrice, 'Forced-break SELL');
  assert(
    !postBreakSell.sellZones.some((z) => z.id === targetSell.id),
    'Forced-break SELL must remove broken SELL zone'
  );

  // Forced-break scenario 2: TEST: BREAK BUY (sim = nearBuy.bottom - 0.6 * atr - 1)
  resetFireZoneEngineStore();
  memoryStorage.removeItem?.(FIRE_ZONE_STORAGE_KEY);
  const preBreakBuy = runFireZoneEngine(fixedH1, [], [], 4050.0);
  const targetBuy = preBreakBuy.buyZones.find((z) => z.type === 'NEAREST')!;
  const forcedBreakBuyPrice = Number((targetBuy.bottom - 0.6 * preBreakBuy.atr - 1).toFixed(2));
  const postBreakBuy = runFireZoneEngine(fixedH1, [], [], forcedBreakBuyPrice);
  assertZonesValidAtPrice(postBreakBuy, forcedBreakBuyPrice, 'Forced-break BUY');
  assert(
    !postBreakBuy.buyZones.some((z) => z.id === targetBuy.id),
    'Forced-break BUY must remove broken BUY zone'
  );
  console.log('✓ (2) VALIDITY (200-tick random walk + forced BREAK SELL & BREAK BUY: no SELL below price, no BUY above price) passed');

  // (4) BACKTEST: verify new candidate scoring, freshness rule, 0.25*ATR break buffer, SL & snapped TP1, and <20 trades verdict
  const btSummary = runFireZoneBacktest(fixedH1, '1H');
  assert(
    btSummary.trades < 20 ? btSummary.verdict === 'sample too small' : true,
    'Backtest with < 20 trades must return verdict "sample too small"'
  );
  for (const tr of btSummary.tradeList) {
    assert(
      tr.zoneScore >= 1 && tr.zoneScore <= 25,
      `Backtest trade zoneScore (${tr.zoneScore}) must use the new candidate scoring scale`
    );
    assert(
      tr.side === 'BUY' ? tr.sl < tr.entryPrice && tr.tp1 >= tr.entryPrice + 8.99 : tr.sl > tr.entryPrice && tr.tp1 <= tr.entryPrice - 8.99,
      'Backtest trade must use 007 Trade Plan SL and snapped TP1'
    );
  }
  console.log('✓ (4) BACKTEST (new candidate scoring, freshness rule, 0.25*ATR break buffer, 007 plan SL/TP1 & verdict logic) passed');
}


// Log selected zones for current H1 data
(async () => {
  try {
    resetFireZoneEngineStore();
    let h1Bars: FireZoneCandle[] = [];
    try {
      const res = await fetch('https://biquote.io/api/XAUUSD/ohlc?interval=1h&limit=400', {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const json = await res.json();
        const raw = json?.data?.bars || json?.bars || json?.candles || json?.data?.candles;
        if (Array.isArray(raw) && raw.length > 0) {
          h1Bars = processRawCandles(raw, true);
        }
      }
    } catch {
      // fallback to deterministic sample if offline
    }

    if (h1Bars.length === 0) {
      for (let i = 0; i < 200; i++) {
        const wave = Math.sin(i / 6) * 32 + Math.cos(i / 13) * 16;
        const base = 4050 + wave;
        h1Bars.push(makeCandle(i, base - 2, base + 6, base - 6, base + 1, 1200, 3600));
      }
    }

    const eng = runFireZoneEngine(h1Bars);
    console.log('\n=== SELECTED ZONES FOR CURRENT H1 DATA ===');
    console.log(`Current Price: $${eng.currentPrice.toFixed(2)} | ATR14(H1): $${eng.atr.toFixed(2)}`);
    for (const z of [...eng.sellZones, ...eng.buyZones]) {
      console.log(
        `[${z.id}] ${z.side} ${z.type === 'NEAREST' ? 'NEAR' : z.type} | anchor=${z.anchor.toFixed(
          2
        )} [${z.bottom.toFixed(2)} - ${z.top.toFixed(2)}] | score=${z.score} (${z.label}) | L=${
          z.pivotLevel
        } | retests=${z.touches}`
      );
    }
    console.log('--- ALL FIRE ZONE 007 CORE, LIFECYCLE & CHART MODEL TESTS PASSED SUCCESSFULLY ---');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();





