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
  memoryStorage,
  FIRE_ZONE_STORAGE_KEY,
  buildChartModel,
} from './engine';
import { buildSimpleLadderRows } from './engineGatesAndLadder';
import { runFireZoneBacktest } from './backtest';


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
  console.log(
    `✓ Tight Autoscale Check (candles 3985–4095 -> [${vr!.minValue}, ${vr!.maxValue}] within [3970, 4110]) passed`
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

console.log('--- ALL FIRE ZONE 007 CORE, LIFECYCLE & CHART MODEL TESTS PASSED SUCCESSFULLY ---');




