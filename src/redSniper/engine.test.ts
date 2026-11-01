import assert from 'node:assert/strict';
import {
  Candle,
  RedSniperBarsMap,
  RedSniperHistoryDiagnosticsMap,
  RedSniperTimeframe,
  build3mFrom1m,
  buildHigherTimeframeFrom1m,
  doesM1CoverTimeframeRange,
  fetchBrokerOhlc,
  fetchBrokerOhlcWithDiagnostics,
  normalizeRedSniperCandle,
  sortAndDedupeCandles,
} from './feed';
import {
  DEFAULT_RED_SNIPER_SETTINGS,
  RED_SNIPER_ZONE_ENGINE_VERSION,
  RedSniperDemoState,
  RedSniperZone,
  analyzeAllTimeframes,
  analyzeTimeframe,
  buildZoneTradeParameters,
  computeBaseAndLegRelativeTickVolume,
  computeBotStatusLine,
  computeDeadAtrComparison,
  computePerformanceMetrics,
  computePowerCalibration,
  computeSameSideOverlapRatio,
  computeZonePowerAndBreakdown,
  detectNewZoneBotLogs,
  findZones,
  findZonesWithAudit,
  formatBotLogForClipboard,
  formatReplayWindowLabel,
  isZoneNear,
  mergeBotLogEntries,
  mergeOverlappingMultiTfZones,
  resolveDefaultRetestModeForTf,
  resolveZoneStatus,
  runReplay24hToCompletion,
  sanitizeRedSniperSettings,
  stepAutoTraderOnTick,
} from './engine';
import {
  buildHigherTfFromStoredM1,
  dedupeAndMergeRedSniperCandles,
  doesStoredM1CoverRange,
} from '../server/candleEngine';
import { runAllStorageTests } from './storage.test';

function makeScaledTimeframeBars(
  count: number,
  atrScale: number,
  stepSec: number,
  withVolume: boolean = true
): Candle[] {
  const bars: Candle[] = [];
  const startSec = 1711929600;
  let price = 3880;

  for (let i = 0; i < count; i++) {
    // Create periodic base + impulsive rally/drop patterns scaled by atrScale
    const cycle = i % 28;
    let open = price;
    let close = price;
    let high = price + 0.4 * atrScale;
    let low = price - 0.4 * atrScale;

    if (cycle === 6) {
      // Base candle before strong rally (demand)
      open = price;
      close = price + 0.15 * atrScale;
      high = Math.max(open, close) + 0.25 * atrScale;
      low = Math.min(open, close) - 0.25 * atrScale;
    } else if (cycle === 7) {
      // Strong bullish leg-out candle (body >= 0.6 ATR, body/range >= 0.5)
      open = price;
      close = price + 1.4 * atrScale;
      high = close + 0.15 * atrScale;
      low = open - 0.1 * atrScale;
    } else if (cycle === 8 || cycle === 9) {
      // Follow-through to exceed 1.5x ATR departure
      open = price;
      close = price + 0.9 * atrScale;
      high = close + 0.2 * atrScale;
      low = open - 0.15 * atrScale;
    } else if (cycle === 18) {
      // Base candle before strong drop (supply)
      open = price;
      close = price - 0.15 * atrScale;
      high = Math.max(open, close) + 0.25 * atrScale;
      low = Math.min(open, close) - 0.25 * atrScale;
    } else if (cycle === 19) {
      // Strong bearish leg-out candle
      open = price;
      close = price - 1.4 * atrScale;
      high = open + 0.1 * atrScale;
      low = close - 0.15 * atrScale;
    } else if (cycle === 20 || cycle === 21) {
      // Follow-through drop
      open = price;
      close = price - 0.9 * atrScale;
      high = open + 0.15 * atrScale;
      low = close - 0.2 * atrScale;
    } else {
      // Normal oscillation
      const drift = Math.sin(i * 0.35) * 0.35 * atrScale;
      open = price;
      close = price + drift;
      high = Math.max(open, close) + 0.35 * atrScale;
      low = Math.min(open, close) - 0.35 * atrScale;
    }

    price = close;
    const tickVolume = withVolume ? 120 + ((i * 41) % 160) : 0;
    bars.push({
      time: startSec + i * stepSec,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      tickVolume,
      buyVol: withVolume ? Math.round(tickVolume * 0.54) : 0,
      sellVol: withVolume ? Math.round(tickVolume * 0.46) : 0,
    });
  }

  return bars;
}

// ============================================================================
// TEST 1: Zones per timeframe differ & heights scale with timeframe
// ============================================================================
function testZonesPerTimeframeDifferAndScale(): void {
  const m1Bars = makeScaledTimeframeBars(200, 1.5, 60);
  const m5Bars = makeScaledTimeframeBars(200, 3.8, 300);
  const h1Bars = makeScaledTimeframeBars(200, 9.0, 3600);
  const h4Bars = makeScaledTimeframeBars(200, 20.0, 14400);

  const m1Res = analyzeTimeframe('1m', m1Bars, 'BULL', 'BULL');
  const m5Res = analyzeTimeframe('5m', m5Bars, 'BULL', 'BULL');
  const h1Res = analyzeTimeframe('1h', h1Bars, 'BULL', 'BULL');
  const h4Res = analyzeTimeframe('4h', h4Bars, 'BULL', 'BULL');

  assert.ok(m1Res.zones.length > 0, 'Expected M1 zones');
  assert.ok(m5Res.zones.length > 0, 'Expected M5 zones');
  assert.ok(h1Res.zones.length > 0, 'Expected H1 zones');
  assert.ok(h4Res.zones.length > 0, 'Expected H4 zones');

  const avgHeight = (zs: Array<{ width: number }>) =>
    zs.reduce((s, z) => s + z.width, 0) / zs.length;

  const hM1 = avgHeight(m1Res.zones);
  const hM5 = avgHeight(m5Res.zones);
  const hH1 = avgHeight(h1Res.zones);
  const hH4 = avgHeight(h4Res.zones);

  assert.ok(
    hM1 < hM5 && hM5 < hH1 && hH1 < hH4,
    `Expected average zone heights to scale with timeframe: M1(${hM1.toFixed(
      2
    )}) < M5(${hM5.toFixed(2)}) < H1(${hH1.toFixed(2)}) < H4(${hH4.toFixed(2)})`
  );

  const m1Ids = new Set(m1Res.zones.map((z) => `${z.bottom}-${z.top}`));
  const h1Ids = new Set(h1Res.zones.map((z) => `${z.bottom}-${z.top}`));
  assert.notDeepEqual(m1Ids, h1Ids, 'M1 and H1 must have distinct zone sets');

  console.log(
    `✓ Test 1 passed: Zones per timeframe differ & heights scale (M1 avg $${hM1.toFixed(
      2
    )}, M5 $${hM5.toFixed(2)}, H1 $${hH1.toFixed(2)}, H4 $${hH4.toFixed(2)})`
  );
}

// ============================================================================
// TEST 2: Dead rule uses closes only; wicks beyond far edge flag "sweep"
// ============================================================================
function testDeadRuleUsesClosesOnlyAndFlagsSweep(): void {
  const bars: Candle[] = [];
  for (let i = 0; i < 5; i++) {
    bars.push({
      time: 1000 + i * 60,
      open: 3899,
      high: 3901,
      low: 3897,
      close: 3900,
      tickVolume: 100,
      buyVol: 50,
      sellVol: 50,
    });
  }
  bars.push({
    time: 1000 + 5 * 60,
    open: 3901.5,
    high: 3902.0,
    low: 3900.0,
    close: 3901.2,
    tickVolume: 120,
    buyVol: 60,
    sellVol: 60,
  });
  bars.push({
    time: 1000 + 6 * 60,
    open: 3901.0,
    high: 3901.5,
    low: 3894.5,
    close: 3895.0,
    tickVolume: 200,
    buyVol: 60,
    sellVol: 140,
  });
  bars.push({
    time: 1000 + 7 * 60,
    open: 3895.0,
    high: 3895.5,
    low: 3890.0,
    close: 3891.0,
    tickVolume: 150,
    buyVol: 50,
    sellVol: 100,
  });
  bars.push({
    time: 1000 + 8 * 60,
    open: 3891.0,
    high: 3891.5,
    low: 3888.0,
    close: 3889.0,
    tickVolume: 140,
    buyVol: 50,
    sellVol: 90,
  });

  const barsWithSweep = [
    ...bars,
    {
      time: 1000 + 9 * 60,
      open: 3899.5,
      high: 3905.0,
      low: 3899.0,
      close: 3901.5,
      tickVolume: 180,
      buyVol: 90,
      sellVol: 90,
    },
    {
      time: 1000 + 10 * 60,
      open: 3894.0,
      high: 3894.5,
      low: 3892.5,
      close: 3893.0,
      tickVolume: 130,
      buyVol: 50,
      sellVol: 80,
    },
  ];

  const zonesSweep = findZones(barsWithSweep, '1m');
  const supplySweep = zonesSweep.find((z) => z.supply && z.endIdx === 5);
  assert.ok(supplySweep, 'Supply zone with huge wick that closed inside must survive');
  assert.equal(supplySweep.sweep, true, 'Wick beyond far edge closing back inside must flag sweep=true');
  assert.equal(supplySweep.tests, 1, 'Sweep excursion counts as 1 retest');

  const barsWithCloseBreak = [
    ...bars,
    {
      time: 1000 + 9 * 60,
      open: 3899.5,
      high: 3907.0,
      low: 3899.0,
      close: 3906.0,
      tickVolume: 180,
      buyVol: 120,
      sellVol: 60,
    },
    {
      time: 1000 + 10 * 60,
      open: 3894.0,
      high: 3894.5,
      low: 3892.5,
      close: 3893.0,
      tickVolume: 130,
      buyVol: 50,
      sellVol: 80,
    },
  ];

  const zonesDead = findZones(barsWithCloseBreak, '1m');
  const supplyDead = zonesDead.find((z) => z.supply && z.endIdx === 5);
  assert.equal(
    supplyDead,
    undefined,
    'Supply zone where a candle closed > top + 0.25*ATR must be dead'
  );

  console.log('✓ Test 2 passed: Dead rule uses closes only (> 0.25*ATR) & wick sweep detection verified');
}

// ============================================================================
// TEST 3: Retest tolerance (0.1x ATR14) + retestGapAtr + TESTED 1x state parity
// ============================================================================
function testRetestToleranceAndStateParity(): void {
  const baseBars: Candle[] = [];
  for (let i = 0; i < 5; i++) {
    baseBars.push({
      time: 1000 + i * 60,
      open: 3899.5,
      high: 3900.5,
      low: 3898.5,
      close: 3900.0,
      tickVolume: 100,
      buyVol: 50,
      sellVol: 50,
    });
  }
  // i = 5: Base candle [low=3900, high=3902]
  baseBars.push({
    time: 1000 + 5 * 60,
    open: 3901.5,
    high: 3902.0,
    low: 3900.0,
    close: 3901.2,
    tickVolume: 120,
    buyVol: 60,
    sellVol: 60,
  });
  // i = 6..8: Bearish departure down to 3889 (zone bottom is 3900, or ~3898.5 after height cap)
  baseBars.push({
    time: 1000 + 6 * 60,
    open: 3901.0,
    high: 3901.5,
    low: 3894.5,
    close: 3895.0,
    tickVolume: 200,
    buyVol: 60,
    sellVol: 140,
  });
  baseBars.push({
    time: 1000 + 7 * 60,
    open: 3895.0,
    high: 3895.5,
    low: 3890.0,
    close: 3891.0,
    tickVolume: 150,
    buyVol: 50,
    sellVol: 100,
  });
  baseBars.push({
    time: 1000 + 8 * 60,
    open: 3891.0,
    high: 3891.5,
    low: 3888.0,
    close: 3889.0,
    tickVolume: 140,
    buyVol: 50,
    sellVol: 90,
  });

  // First find the exact zone bottom with heightCapAtr=3.0 so zone is [3898.5, 3902.0]
  const initialZones = findZones(
    [
      ...baseBars,
      { time: 1540, open: 3889, high: 3890, low: 3888, close: 3889, tickVolume: 100, buyVol: 50, sellVol: 50 },
    ],
    '1m',
    { heightCapAtr: 3.0, retestGapAtr: 0.25 }
  );
  const baseSupply = initialZones.find((z) => z.supply && z.endIdx === 5);
  assert.ok(baseSupply, 'Expected base supply zone at endIdx=5');
  assert.equal(baseSupply.tests, 0);
  assert.equal(baseSupply.state, 'FRESH');

  // Now add a candle that wicks within 0.1 * ATR14 BELOW the proximal edge (baseSupply.bottom - 0.05)
  // Without tolerance it wouldn't touch baseSupply.bottom, but WITH 0.1*ATR14 tolerance it counts as a retest!
  const nearTouchHigh = Number((baseSupply.bottom - 0.05).toFixed(2));
  const seqWithToleranceTouch = [
    ...baseBars,
    // k=9: away candle (closed well outside & moved >= retestGapAtr * ATR14 from bottom)
    { time: 1540, open: 3890.0, high: 3891.0, low: 3888.5, close: 3890.5, tickVolume: 110, buyVol: 55, sellVol: 55 },
    // k=10: wick reaches baseSupply.bottom - 0.05 (within 0.1 * ATR14 tolerance of proximal edge!)
    { time: 1600, open: 3895.0, high: nearTouchHigh, low: 3894.5, close: 3895.2, tickVolume: 110, buyVol: 55, sellVol: 55 },
    // k=11: step away gradually
    { time: 1660, open: 3895.0, high: 3895.4, low: 3893.5, close: 3894.0, tickVolume: 110, buyVol: 55, sellVol: 55 },
  ];

  const tolZones = findZones(seqWithToleranceTouch, '1m', {
    heightCapAtr: 3.0,
    retestGapAtr: 0.25,
  });
  const touchedSupply = tolZones.find((z) => z.supply && z.endIdx === 5);
  assert.ok(touchedSupply, 'Expected supply zone to survive tolerance touch');
  assert.equal(
    touchedSupply.tests,
    1,
    'Wick within 0.1*ATR14 of proximal edge after being away must count as 1 retest'
  );
  assert.equal(
    touchedSupply.state,
    'TESTED',
    'Zone touched once must show state TESTED (never FRESH)'
  );

  console.log('✓ Test 3 passed: Retest tolerance (0.1*ATR14), away gap (retestGapAtr), and TESTED 1x state parity verified');
}

// ============================================================================
// TEST 4: Selection keeps all nearby zones (<= 4 * ATR14) even if > maxZones
// ============================================================================
function testNearbyZonesNeverDroppedBySelection(): void {
  // Generate a long bar series with multiple zones near livePrice
  const bars = makeScaledTimeframeBars(320, 2.0, 60);
  const lastClose = bars[bars.length - 1].close;

  // Run with maxZones=3, and verify that every non-overlapping alive zone within 4 * ATR14 of livePrice is kept
  const audit = findZonesWithAudit(bars, '1m', {
    maxZones: 3,
    livePrice: lastClose,
  });

  const nearbyDroppedByCap = audit.allAliveBeforeSelection.filter(
    (d) =>
      d.droppedReason === 'cap' &&
      Math.max(0, d.bottom - lastClose, livePriceOrRef(lastClose) - d.top) <= 4 * audit.atr14
  );
  assert.equal(
    nearbyDroppedByCap.length,
    0,
    'No alive zone within 4 * ATR14 of livePrice may ever be dropped by maxZones cap'
  );

  console.log('✓ Test 4 passed: Nearby zones (<= 4 * ATR14) are never dropped by selection cap');
}

function livePriceOrRef(p: number): number {
  return p;
}

// ============================================================================
// TEST 5: Height cap trims the FAR (distal) side and keeps the proximal edge;
//         default heightCapAtr = 2.0 preserves natural height variety on normal bases
// ============================================================================
function testHeightCapTrimsDistalSideAndPreservesNaturalVariety(): void {
  assert.equal(
    DEFAULT_RED_SNIPER_SETTINGS.heightCapAtr,
    2.0,
    'Default heightCapAtr must be 2.0'
  );

  const bars = makeScaledTimeframeBars(200, 12.0, 3600);
  // Compare heightCapAtr = 3.0 (uncapped) vs heightCapAtr = 0.8 (strict cap)
  const uncapped = findZonesWithAudit(bars, '1h', { heightCapAtr: 3.0 });
  const capped = findZonesWithAudit(bars, '1h', { heightCapAtr: 0.8 });
  const defaultCap = findZonesWithAudit(bars, '1h', { heightCapAtr: 2.0 });

  assert.ok(capped.selected.length > 0, 'Expected capped H1 zones');
  const maxAllowed = 0.8 * capped.atr14 + 0.5;
  for (const z of capped.selected) {
    const h = z.top - z.bottom;
    assert.ok(
      h <= maxAllowed,
      `Zone height ${h.toFixed(2)} exceeded heightCapAtr * ATR14 (${maxAllowed.toFixed(2)})`
    );
  }

  // Verify that at default heightCapAtr = 2.0, un-trimmed zones keep their exact natural base high-low
  const unTrimmedDefault = defaultCap.selected.filter((z) => !z.trimmed);
  assert.ok(
    unTrimmedDefault.length > 0,
    'At default heightCapAtr=2.0, normal bases must remain un-trimmed and keep their real base high-low'
  );
  for (const uz of unTrimmedDefault) {
    const orig = uncapped.selected.find(
      (u) => u.supply === uz.supply && u.startIdx === uz.startIdx && u.endIdx === uz.endIdx
    );
    if (orig) {
      assert.equal(uz.top, orig.top, 'Un-trimmed zone top must match natural base high');
      assert.equal(uz.bottom, orig.bottom, 'Un-trimmed zone bottom must match natural base low');
    }
  }

  // Verify that for any trimmed zone, the proximal edge matches the uncapped zone's proximal edge
  const trimmedZones = capped.selected.filter((z) => z.trimmed);
  assert.ok(trimmedZones.length > 0, 'Expected at least one zone to be marked trimmed=true at heightCapAtr=0.8');

  for (const tz of trimmedZones) {
    const orig = uncapped.selected.find(
      (u) => u.supply === tz.supply && u.startIdx === tz.startIdx && u.endIdx === tz.endIdx
    );
    if (orig) {
      if (tz.supply) {
        assert.equal(
          tz.bottom,
          orig.bottom,
          'Supply zone height cap must keep proximal (bottom) edge and trim distal (top) edge'
        );
        assert.ok(tz.top < orig.top, 'Supply zone distal (top) edge must be trimmed down');
      } else {
        assert.equal(
          tz.top,
          orig.top,
          'Demand zone height cap must keep proximal (top) edge and trim distal (bottom) edge'
        );
        assert.ok(tz.bottom > orig.bottom, 'Demand zone distal (bottom) edge must be trimmed up');
      }
    }
  }

  console.log('✓ Test 5 passed: Default heightCapAtr=2.0 keeps natural base high-low on un-trimmed zones & trims distal side when > cap');
}

// ============================================================================
// TEST 6: Weak-zone retry (depMult 1.2 when < 4 alive zones, tagged "weak")
// ============================================================================
function testWeakZoneRetryWhenUnderFourZones(): void {
  const bars: Candle[] = [];
  for (let i = 0; i < 20; i++) {
    bars.push({
      time: 1000 + i * 180,
      open: 3880.0,
      high: 3881.0,
      low: 3879.0,
      close: 3880.2,
      tickVolume: 100,
      buyVol: 50,
      sellVol: 50,
    });
  }
  bars.push({
    time: 1000 + 20 * 180,
    open: 3880.1,
    high: 3880.6,
    low: 3880.0,
    close: 3880.4,
    tickVolume: 110,
    buyVol: 55,
    sellVol: 55,
  });
  bars.push({
    time: 1000 + 21 * 180,
    open: 3880.4,
    high: 3882.0,
    low: 3880.3,
    close: 3881.9,
    tickVolume: 180,
    buyVol: 120,
    sellVol: 60,
  });
  for (let i = 22; i < 36; i++) {
    bars.push({
      time: 1000 + i * 180,
      open: 3882.3,
      high: 3882.7,
      low: 3881.8,
      close: 3882.5,
      tickVolume: 100,
      buyVol: 50,
      sellVol: 50,
    });
  }

  const strictOnly = findZonesWithAudit(bars, '3m', { enableWeakRetry: false });
  assert.equal(strictOnly.selected.length, 0, 'With enableWeakRetry=false, 1.3x ATR departure does not qualify under 1.5x ATR');

  const audit = findZonesWithAudit(bars, '3m', { enableWeakRetry: true });
  const weakZones = audit.selected.filter((z) => z.weak);
  assert.ok(
    weakZones.length > 0,
    'When timeframe has < 4 strict zones, engine must rerun with depMult=1.2 and tag extra zones weak=true'
  );

  console.log(`✓ Test 6 passed: Low-zone timeframe retry (depMult=1.2) merged ${weakZones.length} weak-tagged zones`);
}

// ============================================================================
// TEST 7: Duplicate merge (>70% overlap across timeframes merges badges & keeps strongest power)
// ============================================================================
function testDuplicateMergeAcrossTimeframes(): void {
  const sampleBase: RedSniperZone = {
    id: '5m-BUY-3880.00-3884.00',
    tf: '5m',
    side: 'BUY',
    supply: false,
    top: 3884.0,
    bottom: 3880.0,
    proximal: 3884.0,
    distal: 3880.0,
    anchor: 3882.0,
    width: 4.0,
    time: 1000,
    startIdx: 10,
    endIdx: 11,
    baseN: 2,
    status: 'FRESH',
    retests: 0,
    independentRetests: 0,
    touchCandles: 0,
    touches: 0,
    pctLeft: 100,
    consumed: false,
    sweep: false,
    trimmed: false,
    weak: false,
    isFar: false,
    distancePts: 2.0,
    score: 8,
    departureAtr: 2.1,
    volMult: 1.8,
    htfOk: true,
    htfLabel: 'HTF ok',
    power: 78,
    breakdown: 'score 8 · retests 0 · vol 1.8x · dep 2.1 ATR · HTF ok',
    chartLabel: 'BUY · FRESH · PWR 78 · 100% left · 0x',
    atr14: 3.5,
  };

  const overlapping15m: RedSniperZone = {
    ...sampleBase,
    id: '15m-BUY-3880.20-3884.00',
    tf: '15m',
    top: 3884.0,
    bottom: 3880.2,
    power: 89,
  };

  const distinct1h: RedSniperZone = {
    ...sampleBase,
    id: '1h-BUY-3865.00-3870.00',
    tf: '1h',
    top: 3870.0,
    bottom: 3865.0,
    power: 82,
  };

  const merged = mergeOverlappingMultiTfZones([sampleBase, overlapping15m, distinct1h]);
  assert.equal(merged.length, 2, 'Overlapping 5m and 15m zones (>70% overlap) must merge into 1 row');

  const mergedRow = merged.find((m) => m.mergedTfs.length === 2);
  assert.ok(mergedRow, 'Expected merged row with 2 timeframes');
  assert.deepEqual(mergedRow.mergedTfs, ['5m', '15m'], 'Merged row must carry ["5m", "15m"] badges');
  assert.equal(mergedRow.power, 89, 'Merged row must keep the strongest power (89)');

  console.log('✓ Test 7 passed: Multi-timeframe duplicate merge (>70% overlap) verified');
}

// ============================================================================
// TEST 8: Missing tickVolume & POWER 0-99 formula & maxRiskPoints
// ============================================================================
function testMissingTickVolumeAndPowerFormula(): void {
  const pWithVol = computeZonePowerAndBreakdown({
    side: 'SELL',
    score: 9,
    retests: 0,
    pctLeft: 100,
    departureAtr: 2.4,
    volMult: 2.0,
    bias1h: 'BEAR',
    bias4h: 'BEAR',
  });
  assert.equal(pWithVol.power, 91);
  assert.equal(
    pWithVol.breakdown,
    'score 9 · retests 0 · vol 2.0x · dep 2.4 ATR · HTF ok'
  );

  const pNoVol = computeZonePowerAndBreakdown({
    side: 'SELL',
    score: 9,
    retests: 0,
    pctLeft: 100,
    departureAtr: 2.4,
    volMult: null,
    bias1h: 'BEAR',
    bias4h: 'BEAR',
  });
  assert.equal(pNoVol.power, 95);
  assert.equal(
    pNoVol.breakdown,
    'score 9 · retests 0 · vol -- · dep 2.4 ATR · HTF ok'
  );

  const barsNoVol = makeScaledTimeframeBars(60, 2.0, 60, false);
  assert.equal(
    computeBaseAndLegRelativeTickVolume(barsNoVol, 20, 21),
    null,
    'Missing tickVolume must return null, never a fake number'
  );

  const tallZoneRes = analyzeTimeframe('4h', makeScaledTimeframeBars(200, 22.0, 14400), 'BULL', 'BULL');
  const sampleTallZone = tallZoneRes.zones[0];
  assert.ok(sampleTallZone, 'Expected H4 zone');

  const tallPlan = buildZoneTradeParameters(
    {
      ...sampleTallZone,
      side: 'BUY',
      top: 3900,
      bottom: 3875,
      proximal: 3900,
      distal: 3875,
    },
    3900,
    1000,
    [],
    'BULL',
    'BULL',
    { ...DEFAULT_RED_SNIPER_SETTINGS, maxRiskPoints: 15, slBuffer: 1.5 }
  );
  assert.equal(tallPlan.riskPoints, 26.5);
  assert.equal(tallPlan.maxRiskSkipped, true);

  const demoState: RedSniperDemoState = {
    balance: 1000,
    autoEnabled: true,
    openTrades: [],
    closedTrades: [],
    usedZoneIds: [],
  };
  const stepTall = stepAutoTraderOnTick(
    demoState,
    3899,
    [
      {
        ...sampleTallZone,
        side: 'BUY',
        status: 'FRESH',
        retests: 0,
        power: 85,
        top: 3900,
        bottom: 3875,
        proximal: 3900,
        distal: 3875,
      },
    ],
    'BULL',
    'BULL',
    'LONDON',
    1000,
    { ...DEFAULT_RED_SNIPER_SETTINGS, maxRiskPoints: 15 }
  );
  assert.equal(stepTall.nextState.openTrades.length, 0);

  console.log('✓ Test 8 passed: Missing tickVolume power re-normalization & maxRiskPoints filter verified');
}

// ============================================================================
// TEST 9: STATE LABEL rule everywhere (FRESH / TESTED / DEEP) + deadAtr + dead:closeBeyond
// ============================================================================
function testStateLabelRuleAndDeadCloseBeyondDebug(): void {
  // A.2: FRESH = 0 retests, TESTED = retests >= 1 and pctLeft >= 60 (and retests < 3), DEEP = pctLeft < 60 or retests >= 3
  assert.equal(resolveZoneStatus(0, 100), 'FRESH');
  assert.equal(resolveZoneStatus(1, 80), 'TESTED');
  assert.equal(resolveZoneStatus(2, 60), 'TESTED');
  assert.equal(
    resolveZoneStatus(1, 0),
    'DEEP',
    'A zone with 0% left must be DEEP, never TESTED'
  );
  assert.equal(
    resolveZoneStatus(2, 45),
    'DEEP',
    'A zone with pctLeft < 60 must be DEEP, never TESTED'
  );
  assert.equal(
    resolveZoneStatus(3, 85),
    'DEEP',
    'A zone with 3 retests must be DEEP, never TESTED'
  );
  assert.equal(
    resolveZoneStatus(13, 0),
    'DEEP',
    'A zone with 13 retests and 0% left must be DEEP, never TESTED'
  );

  // A.3: Verify deadAtr setting & reasonDropped = "dead:closeBeyond" with deadCandleTime and deadBeyondAtr
  const bars: Candle[] = [];
  for (let i = 0; i < 6; i++) {
    bars.push({
      time: 2000 + i * 3600,
      open: 4300,
      high: 4304,
      low: 4296,
      close: 4300,
      tickVolume: 120,
      buyVol: 60,
      sellVol: 60,
    });
  }
  // i = 6: Supply base [4300, 4310]
  bars.push({
    time: 2000 + 6 * 3600,
    open: 4305,
    high: 4310,
    low: 4300,
    close: 4304,
    tickVolume: 150,
    buyVol: 70,
    sellVol: 80,
  });
  // i = 7..9: Strong drop down to 4265
  bars.push({
    time: 2000 + 7 * 3600,
    open: 4304,
    high: 4305,
    low: 4280,
    close: 4282,
    tickVolume: 260,
    buyVol: 60,
    sellVol: 200,
  });
  bars.push({
    time: 2000 + 8 * 3600,
    open: 4282,
    high: 4283,
    low: 4270,
    close: 4272,
    tickVolume: 200,
    buyVol: 50,
    sellVol: 150,
  });
  bars.push({
    time: 2000 + 9 * 3600,
    open: 4272,
    high: 4274,
    low: 4264,
    close: 4266,
    tickVolume: 180,
    buyVol: 50,
    sellVol: 130,
  });
  // Multiple deep retests (wicking above 4310 so pctLeft = 0%, but closing at 4310.5 which is only ~0.04 ATR beyond 4310)
  for (let r = 0; r < 4; r++) {
    // Away candle
    bars.push({
      time: 2000 + (10 + r * 2) * 3600,
      open: 4280,
      high: 4285,
      low: 4275,
      close: 4278,
      tickVolume: 140,
      buyVol: 70,
      sellVol: 70,
    });
    // Deep retest candle: wick to 4312 (0% left), close at 4309.5 (inside [4300, 4310])
    bars.push({
      time: 2000 + (11 + r * 2) * 3600,
      open: 4298,
      high: 4312,
      low: 4296,
      close: 4309.5,
      tickVolume: 190,
      buyVol: 95,
      sellVol: 95,
    });
  }
  // Final away candle
  bars.push({
    time: 2000 + 18 * 3600,
    open: 4290,
    high: 4292,
    low: 4280,
    close: 4284,
    tickVolume: 150,
    buyVol: 70,
    sellVol: 80,
  });

  const aliveWithManyRetests = findZones(bars, '4h', {
    deadAtr: 0.25,
    heightCapAtr: 3.0,
  });
  const deepSupply = aliveWithManyRetests.find((z) => z.supply && z.endIdx === 6);
  assert.ok(
    deepSupply,
    'Zone with 4 retests and 0% left that never closed beyond distal + deadAtr*ATR must stay ALIVE'
  );
  assert.equal(deepSupply.pctLeft, 0);
  assert.ok(deepSupply.tests >= 3);
  assert.equal(
    deepSupply.state,
    'DEEP',
    'Zone with 0% left and 4 retests must have state DEEP, never TESTED'
  );

  // Now add a candle that closes well beyond 4310 + 0.25*ATR (e.g. close at 4325)
  const breakCandleTime = 2000 + 19 * 3600;
  const barsKilled = [
    ...bars,
    {
      time: breakCandleTime,
      open: 4305,
      high: 4328,
      low: 4304,
      close: 4325,
      tickVolume: 240,
      buyVol: 180,
      sellVol: 60,
    },
    {
      time: 2000 + 20 * 3600,
      open: 4325,
      high: 4326,
      low: 4318,
      close: 4320,
      tickVolume: 140,
      buyVol: 70,
      sellVol: 70,
    },
  ];

  const tfAuditKilled = analyzeTimeframe('4h', barsKilled, 'BULL', 'BULL', 4320, {
    ...DEFAULT_RED_SNIPER_SETTINGS,
    deadAtr: 0.25,
    heightCapAtr: 3.0,
  });
  const droppedDeadEntry = tfAuditKilled.debugAliveZones.find(
    (d) => d.reasonDropped === 'dead:closeBeyond'
  );
  assert.ok(
    droppedDeadEntry,
    'Debug JSON zonesBeforeSelection must include reasonDropped="dead:closeBeyond" for closed-through zones'
  );
  assert.equal(droppedDeadEntry.deadCandleTime, breakCandleTime);
  assert.ok(
    typeof droppedDeadEntry.deadBeyondAtr === 'number' &&
      droppedDeadEntry.deadBeyondAtr > 0.25,
    'deadBeyondAtr must record how far beyond distal the candle closed in ATR units'
  );

  console.log(
    `✓ Test 9 passed: STATE LABEL rule (FRESH/TESTED/DEEP) & dead:closeBeyond debug audit (candleTime=${droppedDeadEntry.deadCandleTime}, beyond=${droppedDeadEntry.deadBeyondAtr} ATR) verified`
  );
}

// ============================================================================
// TEST 10: Retest mode CANDLE (1m-5m default) vs ATR (15m+ default)
// ============================================================================
function testRetestModeCandleVsAtr(): void {
  // AUTO defaults: independent retests for 1m-30m (CANDLE for 1m-5m, ATR for 15m-30m) and TOUCH_CANDLES for 1H, 4H, 1D
  assert.equal(resolveDefaultRetestModeForTf('1m'), 'CANDLE');
  assert.equal(resolveDefaultRetestModeForTf('3m'), 'CANDLE');
  assert.equal(resolveDefaultRetestModeForTf('5m'), 'CANDLE');
  assert.equal(resolveDefaultRetestModeForTf('15m'), 'ATR');
  assert.equal(resolveDefaultRetestModeForTf('30m'), 'ATR');
  assert.equal(resolveDefaultRetestModeForTf('1h'), 'TOUCH_CANDLES');
  assert.equal(resolveDefaultRetestModeForTf('4h'), 'TOUCH_CANDLES');
  assert.equal(resolveDefaultRetestModeForTf('1d'), 'TOUCH_CANDLES');

  // Build a sequence where price closes just 0.05 pts outside the box (less than 0.5*ATR) and then re-touches
  // In CANDLE mode, closing outside for 1 candle is enough to arm the next touch as a retest.
  // In ATR mode with retestGapAtr=0.6, it does NOT move far enough away to count as a second retest.
  const bars: Candle[] = [];
  for (let i = 0; i < 6; i++) {
    bars.push({
      time: 1000 + i * 60,
      open: 3894,
      high: 3898,
      low: 3894,
      close: 3898,
      tickVolume: 100,
      buyVol: 50,
      sellVol: 50,
    });
  }
  // i = 6: Supply base [3900, 3902]
  bars.push({
    time: 1000 + 6 * 60,
    open: 3901.5,
    high: 3902.0,
    low: 3900.0,
    close: 3901.2,
    tickVolume: 120,
    buyVol: 60,
    sellVol: 60,
  });
  // i = 7..8: Bearish departure
  bars.push({
    time: 1000 + 7 * 60,
    open: 3901.0,
    high: 3901.5,
    low: 3894.0,
    close: 3894.5,
    tickVolume: 200,
    buyVol: 50,
    sellVol: 150,
  });
  bars.push({
    time: 1000 + 8 * 60,
    open: 3894.5,
    high: 3895.0,
    low: 3891.0,
    close: 3892.0,
    tickVolume: 160,
    buyVol: 50,
    sellVol: 110,
  });
  // i = 9: First touch into [3900, 3902]
  bars.push({
    time: 1000 + 9 * 60,
    open: 3898.0,
    high: 3900.5,
    low: 3897.5,
    close: 3899.5,
    tickVolume: 130,
    buyVol: 65,
    sellVol: 65,
  });
  // i = 10: Candle closes fully outside the box [3900, 3902], but its low is 3899.6 (only 0.4 pts below 3900, < 0.6*ATR)
  bars.push({
    time: 1000 + 10 * 60,
    open: 3899.7,
    high: 3899.8,
    low: 3899.6,
    close: 3899.7,
    tickVolume: 110,
    buyVol: 55,
    sellVol: 55,
  });
  // i = 11: Second touch into [3900, 3902]
  bars.push({
    time: 1000 + 11 * 60,
    open: 3899.7,
    high: 3900.8,
    low: 3899.6,
    close: 3899.4,
    tickVolume: 140,
    buyVol: 70,
    sellVol: 70,
  });
  // i = 12: Final candle
  bars.push({
    time: 1000 + 12 * 60,
    open: 3895.0,
    high: 3896.0,
    low: 3893.0,
    close: 3894.0,
    tickVolume: 120,
    buyVol: 60,
    sellVol: 60,
  });

  const candleModeZones = findZones(bars, '1m', {
    retestMode: 'CANDLE',
    heightCapAtr: 3.0,
  });
  const atrModeZones = findZones(bars, '15m', {
    retestMode: 'ATR',
    retestGapAtr: 0.6,
    heightCapAtr: 3.0,
  });

  const zCandle = candleModeZones.find((z) => z.supply && z.endIdx === 6);
  const zAtr = atrModeZones.find((z) => z.supply && z.endIdx === 6);
  assert.ok(zCandle && zAtr, 'Expected supply zone in both modes');
  assert.ok(
    zCandle.tests > zAtr.tests,
    `Expected CANDLE mode (${zCandle.tests}x) to count retest after 1 candle closed outside without requiring ATR gap (${zAtr.tests}x)`
  );

  console.log(
    `✓ Test 10 passed: Retest mode CANDLE (${zCandle.tests}x) vs ATR (${zAtr.tests}x) verified`
  );
}

// ============================================================================
// TEST 11: Market Closed bot pause & auto-resume + Power Calibration + 24h Replay
// ============================================================================
function testMarketClosedCalibrationAndReplay(): void {
  const m1Bars = makeScaledTimeframeBars(260, 1.8, 60);
  const h1Bars = makeScaledTimeframeBars(160, 8.5, 3600);
  const barsMap: RedSniperBarsMap = {
    '1m': m1Bars,
    '3m': build3mFrom1m(m1Bars),
    '5m': makeScaledTimeframeBars(160, 3.5, 300),
    '15m': makeScaledTimeframeBars(160, 5.5, 900),
    '30m': makeScaledTimeframeBars(160, 7.0, 1800),
    '1h': h1Bars,
    '4h': makeScaledTimeframeBars(160, 16.0, 14400),
    '1d': makeScaledTimeframeBars(160, 30.0, 86400),
  };

  const tf1m = analyzeTimeframe('1m', m1Bars, 'BULL', 'BULL');
  assert.ok(tf1m.zones.length > 0, 'Expected zones for market closed test');
  const testZone: RedSniperZone = {
    ...tf1m.zones[0],
    side: 'BUY',
    status: 'FRESH',
    retests: 0,
    power: 88,
    bottom: 3880,
    top: 3885,
    proximal: 3885,
    distal: 3880,
  };

  const initialDemo: RedSniperDemoState = {
    balance: 1000,
    autoEnabled: true,
    openTrades: [],
    closedTrades: [],
    usedZoneIds: [],
  };

  // C) Market Closed: status line shows "Bot paused: market closed" and blocks new trades
  const pausedLine = computeBotStatusLine(
    initialDemo,
    3882,
    [testZone],
    'BULL',
    'BULL',
    null,
    DEFAULT_RED_SNIPER_SETTINGS,
    true
  );
  assert.equal(pausedLine, 'Bot paused: market closed');

  const stepClosed = stepAutoTraderOnTick(
    initialDemo,
    3882,
    [testZone],
    'BULL',
    'BULL',
    'LONDON',
    Date.now(),
    DEFAULT_RED_SNIPER_SETTINGS,
    true
  );
  assert.equal(
    stepClosed.nextState.openTrades.length,
    0,
    'When isMarketClosed=true, new demo trades must be blocked'
  );

  // Resume on first fresh tick (isMarketClosed = false)
  const stepOpen = stepAutoTraderOnTick(
    initialDemo,
    3882,
    [testZone],
    'BULL',
    'BULL',
    'LONDON',
    Date.now(),
    DEFAULT_RED_SNIPER_SETTINGS,
    false
  );
  assert.equal(
    stepOpen.nextState.openTrades.length,
    1,
    'On first fresh tick when market opens (isMarketClosed=false), bot must resume and enter qualifying trade'
  );

  // D.1) Power Calibration across loaded candles
  const cal = computePowerCalibration(barsMap, DEFAULT_RED_SNIPER_SETTINGS);
  assert.equal(cal.buckets.length, 4, 'Expected 4 power calibration buckets (<40, 40-59, 60-79, 80+)');
  assert.deepEqual(
    cal.buckets.map((b) => b.bucket),
    ['<40', '40-59', '60-79', '80+']
  );
  for (const b of cal.buckets) {
    assert.equal(
      b.reliable,
      b.n >= 10 && cal.windowSeconds >= 12 * 3600,
      'Bucket reliability flag must require both n >= 10 and >= 12h M1 window'
    );
  }

  // Verify editable power weights re-normalization
  const customWeightsPower = computeZonePowerAndBreakdown({
    side: 'BUY',
    score: 10,
    retests: 0,
    pctLeft: 100,
    departureAtr: 2.5,
    volMult: 2.0,
    bias1h: 'BULL',
    bias4h: 'BULL',
    weights: {
      score: 0.8,
      volume: 0.4,
      freshness: 0.4,
      htf: 0.4,
    },
  });
  assert.ok(
    customWeightsPower.power >= 80 && customWeightsPower.power <= 99,
    'Custom weights must re-normalize cleanly into 0..99 power'
  );

  // D.2) Replay Mode: isolated 24h M1 replay
  const liveBalanceBefore = initialDemo.balance;
  const replaySummary = runReplay24hToCompletion(barsMap, DEFAULT_RED_SNIPER_SETTINGS);
  assert.equal(
    initialDemo.balance,
    liveBalanceBefore,
    'Replay mode must use a separate demo account and never mutate live demo state'
  );
  const replayMetrics = computePerformanceMetrics(replaySummary.demoState.closedTrades);
  assert.ok(
    replayMetrics.totalTrades ===
      replayMetrics.wins + replayMetrics.beCount + replayMetrics.losses,
    'Replay summary trades must equal wins + BE + losses'
  );
  assert.ok(
    Number.isFinite(replayMetrics.expectancyR) &&
      Number.isFinite(replaySummary.maxDrawdownDollars) &&
      Array.isArray(replaySummary.trailingMoves),
    'Replay summary must report expectancyR, maxDrawdown, and trailingMoves array'
  );

  console.log(
    `✓ Test 11 passed: Market-closed bot pause/resume, Power Calibration (${cal.totalResolved} resolved zones), and isolated 24h M1 Replay verified`
  );
}

// ============================================================================
// TEST 12: Remaining Parity Fixes 1–5 (70% Smaller-Height Overlap, farAtr,
//          TOUCH_CANDLES vs independentRetests, and deadAtr Comparison)
// ============================================================================
function testRemainingParityFixes1To5() {
  // 1) OVERLAP RULE: >= 70% of the SMALLER zone's height
  assert.ok(
    Math.abs(
      computeSameSideOverlapRatio(
        { bottom: 4000, top: 4010 },
        { bottom: 4006, top: 4016 }
      ) - 0.4
    ) < 1e-6,
    'Two 10pt zones overlapping by 4pt must have overlapRatio = 0.40 (< 0.70)'
  );
  assert.ok(
    Math.abs(
      computeSameSideOverlapRatio(
        { bottom: 4000, top: 4010 },
        { bottom: 4003, top: 4013 }
      ) - 0.7
    ) < 1e-6,
    'Two 10pt zones overlapping by 7pt must have overlapRatio = 0.70 (>= 0.70)'
  );

  // Build synthetic bars with:
  // - Two partially overlapping SUPPLY zones (40% overlap: [3900, 3905] and [3897, 3902]) -> BOTH must stay!
  // - One heavily overlapping SUPPLY zone (90% overlap: [3900.5, 3905] with [3900, 3905]) -> DROPPED with reasonDropped = 'overlap'
  const bars: Candle[] = [];
  const t0 = 1711929600;
  for (let i = 0; i < 45; i++) {
    bars.push({
      time: t0 + i * 300,
      open: 3890,
      high: 3894,
      low: 3890,
      close: 3893.5, // body = 3.5 (> 0.6 * ATR so background bars never merge into bases)
      tickVolume: 100,
      buyVol: 50,
      sellVol: 50,
    });
  }
  // Supply Zone C at i = 6: [3900.5, 3905] (height = 4.5, older & weaker drop -> lower score, dropped for 100% >= 70% overlap with Zone A)
  bars[6] = {
    time: t0 + 6 * 300,
    open: 3902.5,
    high: 3905,
    low: 3900.5,
    close: 3901.5,
    tickVolume: 100,
    buyVol: 50,
    sellVol: 50,
  };
  bars[7] = {
    time: t0 + 7 * 300,
    open: 3901.5,
    high: 3902,
    low: 3891,
    close: 3892,
    tickVolume: 140,
    buyVol: 40,
    sellVol: 100,
  };
  bars[8] = {
    time: t0 + 8 * 300,
    open: 3892,
    high: 3892.5,
    low: 3889,
    close: 3890,
    tickVolume: 120,
    buyVol: 40,
    sellVol: 80,
  };

  // Supply Zone A at i = 16: [3900, 3905] (height = 5, fresher & strong drop -> higher score, kept!)
  bars[16] = {
    time: t0 + 16 * 300,
    open: 3903,
    high: 3905,
    low: 3900,
    close: 3902,
    tickVolume: 120,
    buyVol: 50,
    sellVol: 70,
  };
  bars[17] = {
    time: t0 + 17 * 300,
    open: 3902,
    high: 3902.5,
    low: 3882,
    close: 3883,
    tickVolume: 350,
    buyVol: 40,
    sellVol: 310,
  };
  bars[18] = {
    time: t0 + 18 * 300,
    open: 3883,
    high: 3884,
    low: 3878,
    close: 3879,
    tickVolume: 200,
    buyVol: 40,
    sellVol: 160,
  };

  // Supply Zone B at i = 26: [3897, 3902] (height = 5, overlaps Zone A [3900, 3905] on [3900, 3902] = 2pt / 5pt = 40% < 70%)
  // Both Zone A [3900, 3905] and Zone B [3897, 3902] must stay!
  bars[26] = {
    time: t0 + 26 * 300,
    open: 3899.5,
    high: 3902,
    low: 3897,
    close: 3898.5,
    tickVolume: 110,
    buyVol: 45,
    sellVol: 65,
  };
  bars[27] = {
    time: t0 + 27 * 300,
    open: 3898.5,
    high: 3899,
    low: 3885,
    close: 3886,
    tickVolume: 300,
    buyVol: 40,
    sellVol: 260,
  };
  bars[28] = {
    time: t0 + 28 * 300,
    open: 3886,
    high: 3887,
    low: 3882,
    close: 3883,
    tickVolume: 180,
    buyVol: 40,
    sellVol: 140,
  };

  // Add two consecutive touch candles into Zone B [3897, 3902] at i = 32 and i = 33 without moving away in between
  // (Notice high = 3898.5 touches Zone B [3897, 3902] without touching Zone A [3900, 3905])
  bars[32] = {
    time: t0 + 32 * 300,
    open: 3894,
    high: 3898.2,
    low: 3893,
    close: 3896.5,
    tickVolume: 110,
    buyVol: 55,
    sellVol: 55,
  };
  bars[33] = {
    time: t0 + 33 * 300,
    open: 3896.5,
    high: 3898.5,
    low: 3895,
    close: 3892,
    tickVolume: 110,
    buyVol: 55,
    sellVol: 55,
  };

  const auditCandle = analyzeTimeframe('5m', bars, 'NEUT', 'NEUT', 3870, {
    ...DEFAULT_RED_SNIPER_SETTINGS,
    heightCapAtr: 3.0,
    retestMode: 'CANDLE',
    retestModeOverride: true,
    farAtr: 25,
  });

  const keptSupplies = auditCandle.zones.filter((z) => z.side === 'SELL');
  assert.ok(
    keptSupplies.some(
      (z) => Math.abs(z.bottom - 3900) < 0.01 && Math.abs(z.top - 3905) < 0.01
    ) &&
      keptSupplies.some(
        (z) => Math.abs(z.bottom - 3897) < 0.01 && Math.abs(z.top - 3902) < 0.01
      ),
    'Partially overlapping same-side zones (40% < 70%) must BOTH stay'
  );

  const droppedOverlapEntry = auditCandle.debugAliveZones.find(
    (d) =>
      Math.abs(d.bottom - 3900.5) < 0.01 &&
      Math.abs(d.top - 3905) < 0.01
  );
  assert.ok(
    droppedOverlapEntry &&
      droppedOverlapEntry.reasonDropped === 'overlap' &&
      droppedOverlapEntry.overlapPct >= 70 &&
      droppedOverlapEntry.overlapDecision.startsWith('dropped:overlap>=70%'),
    'Same-side zone overlapping >= 70% of smaller height must be dropped with reasonDropped = "overlap"'
  );

  // 2) RETEST COUNT COMPARISON: independentRetests vs touchCandles + TOUCH_CANDLES mode
  const zoneBCandle = keptSupplies.find(
    (z) => Math.abs(z.bottom - 3897) < 0.01 && Math.abs(z.top - 3902) < 0.01
  );
  assert.ok(zoneBCandle, 'Zone B [3897, 3902] must exist');
  assert.equal(
    zoneBCandle.independentRetests,
    1,
    'Consecutive touch candles without moving away count as 1 independentRetest'
  );
  assert.equal(
    zoneBCandle.touchCandles,
    2,
    'touchCandles must count every candle touching the box after leg-out (2 candles)'
  );
  assert.equal(
    zoneBCandle.retests,
    1,
    'In CANDLE mode, zone.retests equals independentRetests (1)'
  );

  const auditTouchMode = analyzeTimeframe('5m', bars, 'NEUT', 'NEUT', 3870, {
    ...DEFAULT_RED_SNIPER_SETTINGS,
    heightCapAtr: 3.0,
    retestMode: 'TOUCH_CANDLES',
    retestModeOverride: true,
    farAtr: 25,
  });
  const zoneBTouchMode = auditTouchMode.zones.find(
    (z) => Math.abs(z.bottom - 3897) < 0.01 && Math.abs(z.top - 3902) < 0.01
  );
  assert.ok(zoneBTouchMode, 'Zone B must exist in TOUCH_CANDLES mode');
  assert.equal(
    zoneBTouchMode.retests,
    2,
    'In TOUCH_CANDLES mode, zone.retests must equal touchCandles (2)'
  );

  // 3) FAR RULE: farAtr setting (default 25, range 10-60)
  assert.equal(
    DEFAULT_RED_SNIPER_SETTINGS.farAtr,
    25,
    'Default farAtr must be 25'
  );
  assert.equal(
    sanitizeRedSniperSettings({ farAtr: 5 }).farAtr,
    10,
    'farAtr must clamp to minimum 10'
  );
  assert.equal(
    sanitizeRedSniperSettings({ farAtr: 90 }).farAtr,
    60,
    'farAtr must clamp to maximum 60'
  );

  // Check a zone 20 ATR away from live price: NEAR at farAtr=25, FAR at farAtr=15
  const zone20AtrAway = {
    ...zoneBCandle,
    atr14: 5,
    bottom: 4000,
    top: 4005,
  };
  assert.equal(
    isZoneNear(zone20AtrAway, 3900, 25),
    true,
    'A zone 20 ATR away must be NEAR when farAtr = 25'
  );
  assert.equal(
    isZoneNear(zone20AtrAway, 3900, 15),
    false,
    'A zone 20 ATR away must be FAR when farAtr = 15'
  );

  // 4) DEAD-RULE COMPARISON TOOL: deadAtr in [0.25, 0.5, 0.75, 1.0]
  // Add a candle that closes +0.40 ATR beyond Zone A's top (3905) so Zone A is dead at 0.25 but alive at 0.50, 0.75, 1.0
  const barsWithCloseBeyond = bars.map((b) => ({ ...b }));
  const atr5m = auditCandle.atr14;
  barsWithCloseBeyond[38] = {
    time: t0 + 38 * 300,
    open: 3902,
    high: 3905 + 0.45 * atr5m,
    low: 3901,
    close: 3905 + 0.38 * atr5m, // +0.38 ATR above 3905 (dead at 0.25, alive at 0.50+)
    tickVolume: 130,
    buyVol: 80,
    sellVol: 50,
  };
  const deadComp = computeDeadAtrComparison(
    barsWithCloseBeyond,
    '5m',
    3900,
    DEFAULT_RED_SNIPER_SETTINGS
  );
  assert.deepEqual(
    deadComp.map((c) => c.deadAtr),
    [0.25, 0.5, 0.75, 1.0],
    'computeDeadAtrComparison must evaluate [0.25, 0.5, 0.75, 1.0]'
  );
  const comp025 = deadComp.find((c) => c.deadAtr === 0.25)!;
  const comp050 = deadComp.find((c) => c.deadAtr === 0.5)!;
  assert.ok(
    comp050.aliveCount > comp025.aliveCount &&
      comp050.aliveAtThisValueButDeadAt025.some(
        (z) => z.range === '3900.00-3905.00'
      ),
    'deadAtr = 0.5 must keep Zone A (3900.00-3905.00) alive and list it in aliveAtThisValueButDeadAt025'
  );

  console.log(
    '✓ Test 12 passed: 70% smaller-height overlap rule, farAtr (default 25, 10–60), independentRetests vs touchCandles (TOUCH_CANDLES mode), and deadAtr [0.25, 0.5, 0.75, 1.0] comparison verified'
  );
}

// ============================================================================
// TEST 13: Freeze "zones-v3" Snapshot, Server Candle Store Dedupe/Merge,
//          Consumed Zones Filter, Replay Window Label & "SMALL SAMPLE - NOT RELIABLE",
//          and Persistent BOT LOG Events
// ============================================================================
function testZonesV3FreezeStoreConsumedReplayAndBotLog(): void {
  // 1) Freeze "zones-v3" version tag & deterministic zone snapshot across timeframes
  assert.equal(
    RED_SNIPER_ZONE_ENGINE_VERSION,
    'zones-v3',
    'Zone engine version tag must be frozen at "zones-v3"'
  );
  assert.equal(
    DEFAULT_RED_SNIPER_SETTINGS.deadAtr,
    0.25,
    'Default deadAtr must remain 0.25'
  );
  assert.equal(
    DEFAULT_RED_SNIPER_SETTINGS.showConsumedZones,
    false,
    'Default showConsumedZones must be false'
  );

  const m1Det = makeScaledTimeframeBars(200, 1.8, 60);
  const m5Det = makeScaledTimeframeBars(200, 3.6, 300);
  const h1Det = makeScaledTimeframeBars(200, 8.5, 3600);
  const h4Det = makeScaledTimeframeBars(200, 22.0, 14400);

  const snap1m = analyzeTimeframe('1m', m1Det, 'BULL', 'BULL', 3922);
  const snap5m = analyzeTimeframe('5m', m5Det, 'BULL', 'BULL', 3964);
  const snap1h = analyzeTimeframe('1h', h1Det, 'BULL', 'BULL', 4080);
  const snap4h = analyzeTimeframe('4h', h4Det, 'BULL', 'BULL', 4399);

  // Verify AUTO retest mode used per timeframe
  assert.equal(snap1m.retestModeUsed, 'CANDLE');
  assert.equal(snap5m.retestModeUsed, 'CANDLE');
  assert.equal(snap1h.retestModeUsed, 'TOUCH_CANDLES');
  assert.equal(snap4h.retestModeUsed, 'TOUCH_CANDLES');

  // Verify both independentRetests and touchCandles are populated in debug JSON on 1H/4H even when TOUCH_CANDLES is active
  assert.ok(snap1h.debugAliveZones.length > 0 && snap4h.debugAliveZones.length > 0);
  for (const d of [...snap1h.debugAliveZones, ...snap4h.debugAliveZones]) {
    assert.equal(typeof d.independentRetests, 'number');
    assert.equal(typeof d.touchCandles, 'number');
    assert.ok(
      d.touchCandles >= d.independentRetests,
      'touchCandles must always be >= independentRetests'
    );
  }

  // Exact frozen snapshot of zones-v3 on deterministic 1m, 5m, 1h, 4h candles
  const serializeSnapshot = (zones: RedSniperZone[]) =>
    zones.map((z) => ({
      id: z.id,
      side: z.side,
      bottom: z.bottom,
      top: z.top,
      width: z.width,
      status: z.status,
      retests: z.retests,
      independentRetests: z.independentRetests,
      touchCandles: z.touchCandles,
      pctLeft: z.pctLeft,
      consumed: z.consumed,
      score: z.score,
      power: z.power,
    }));

  const expected1mSnapshot = [
    {
      id: '1m-BUY-1711941360-3879.09-3880.76',
      side: 'BUY',
      bottom: 3879.09,
      top: 3880.76,
      width: 1.67,
      status: 'FRESH',
      retests: 0,
      independentRetests: 0,
      touchCandles: 0,
      pctLeft: 100,
      consumed: false,
      score: 8,
      power: 78,
    },
    {
      id: '1m-BUY-1711938240-3878.32-3880.05',
      side: 'BUY',
      bottom: 3878.32,
      top: 3880.05,
      width: 1.73,
      status: 'DEEP',
      retests: 2,
      independentRetests: 2,
      touchCandles: 14,
      pctLeft: 0,
      consumed: true,
      score: 5,
      power: 46,
    },
    {
      id: '1m-BUY-1711934880-3877.47-3879.26',
      side: 'BUY',
      bottom: 3877.47,
      top: 3879.26,
      width: 1.79,
      status: 'DEEP',
      retests: 4,
      independentRetests: 4,
      touchCandles: 25,
      pctLeft: 6,
      consumed: false,
      score: 4,
      power: 42,
    },
  ];
  assert.deepEqual(
    serializeSnapshot(snap1m.zones),
    expected1mSnapshot,
    'zones-v3 snapshot for 1m must remain identical'
  );
  assert.ok(snap5m.zones[0].id.startsWith('5m-BUY-'));
  assert.ok(snap1h.zones[0].id.startsWith('1h-BUY-'));
  assert.ok(snap4h.zones[0].id.startsWith('4h-BUY-'));

  // 2) Server Candle Store dedupe/merge & building 3m/5m/15m/30m from stored M1
  const storedM1: Candle[] = [
    {
      time: 1711929600,
      open: 3880,
      high: 3882,
      low: 3879,
      close: 3881,
      tickVolume: 100,
      buyVol: 60,
      sellVol: 40,
    },
    {
      time: 1711929660,
      open: 3881,
      high: 3883,
      low: 3880,
      close: 3882,
      tickVolume: 110,
      buyVol: 70,
      sellVol: 40,
    },
  ];
  const brokerM1: Candle[] = [
    // Duplicate timestamp 1711929660 with updated volume/close + new bar 1711929720
    {
      time: 1711929660,
      open: 3881,
      high: 3884,
      low: 3880,
      close: 3883.5,
      tickVolume: 145,
      buyVol: 95,
      sellVol: 50,
    },
    {
      time: 1711929720,
      open: 3883.5,
      high: 3885,
      low: 3882.5,
      close: 3884,
      tickVolume: 120,
      buyVol: 80,
      sellVol: 40,
    },
  ];
  const mergedStoreM1 = dedupeAndMergeRedSniperCandles(storedM1, brokerM1, 5000);
  assert.equal(mergedStoreM1.length, 3, 'Dedupe/merge must produce 3 unique M1 bars');
  assert.equal(
    mergedStoreM1[1].close,
    3883.5,
    'Latest broker bar for same timestamp must win in merge'
  );
  assert.equal(mergedStoreM1[1].tickVolume, 145);

  // Build higher timeframes (3m, 5m, 15m, 30m) from 1800 stored M1 candles (30 hours)
  const longM1 = makeScaledTimeframeBars(1800, 1.8, 60);
  const shortBroker5m = makeScaledTimeframeBars(50, 3.6, 300);
  assert.equal(
    doesStoredM1CoverRange(longM1, shortBroker5m, '5m', 2000),
    true,
    '1800 M1 bars must cover a 50-bar M5 broker range'
  );
  assert.equal(
    doesM1CoverTimeframeRange(longM1, shortBroker5m, '5m'),
    true,
    'Client doesM1CoverTimeframeRange must agree'
  );
  const built5mServer = buildHigherTfFromStoredM1(longM1, '5m', 2000);
  const built5mClient = buildHigherTimeframeFrom1m(longM1, '5m', [], 2000);
  assert.equal(built5mServer.length, 360, '1800 M1 bars must build 360 M5 bars');
  assert.equal(built5mClient.length, 360);
  assert.deepEqual(normalizeRedSniperCandle(built5mServer[0], '5m'), built5mClient[0]);

  // 3) Consumed-zone filter: zones with pctLeft = 0 are tagged consumed=true, hidden from chartZones and bot by default, kept in list & debug JSON
  const consumedTestBars = makeScaledTimeframeBars(90, 2.5, 300);
  const baseAnal = analyzeTimeframe('5m', consumedTestBars, 'BEAR', 'BEAR', 3900);
  const targetTemplate = baseAnal.zones[0];
  assert.ok(targetTemplate, 'Expected a zone template for consumed filter test');

  const consumedZone: RedSniperZone = {
    ...targetTemplate,
    id: '5m-SELL-3900.00-3905.00',
    side: 'SELL',
    bottom: 3900,
    top: 3905,
    proximal: 3900,
    distal: 3905,
    status: 'DEEP',
    retests: 2,
    pctLeft: 0,
    consumed: true,
    isFar: false,
    power: 85,
  };
  const freshZone: RedSniperZone = {
    ...targetTemplate,
    id: '5m-SELL-3910.00-3915.00',
    side: 'SELL',
    bottom: 3910,
    top: 3915,
    proximal: 3910,
    distal: 3915,
    status: 'FRESH',
    retests: 0,
    pctLeft: 100,
    consumed: false,
    isFar: false,
    power: 82,
  };

  const demoForConsumed: RedSniperDemoState = {
    balance: 1000,
    autoEnabled: true,
    openTrades: [],
    closedTrades: [],
    usedZoneIds: [],
  };
  // Live price is inside consumedZone [3900, 3905] at 3902: with showConsumedZones=false, bot must NOT enter
  const stepConsumedHidden = stepAutoTraderOnTick(
    demoForConsumed,
    3902,
    [consumedZone, freshZone],
    'BEAR',
    'BEAR',
    'LONDON',
    Date.now(),
    { ...DEFAULT_RED_SNIPER_SETTINGS, showConsumedZones: false },
    false
  );
  assert.equal(
    stepConsumedHidden.nextState.openTrades.length,
    0,
    'Bot must ignore consumed zones (pctLeft=0) when showConsumedZones is false'
  );

  // Also check chartZones, zones list, and debugAliveZones filtering when a zone has pctLeft = 0 on real bars
  const analHideConsumed = analyzeTimeframe('1m', m1Det, 'BULL', 'BULL', 3880, {
    ...DEFAULT_RED_SNIPER_SETTINGS,
    showConsumedZones: false,
  });
  const analShowConsumed = analyzeTimeframe('1m', m1Det, 'BULL', 'BULL', 3880, {
    ...DEFAULT_RED_SNIPER_SETTINGS,
    showConsumedZones: true,
  });
  const consumedInList = analHideConsumed.zones.find(
    (z) => z.id === '1m-BUY-1711938240-3878.32-3880.05'
  );
  assert.ok(
    consumedInList && consumedInList.consumed && consumedInList.pctLeft === 0,
    'Consumed zone must remain in zones list with consumed=true and pctLeft=0'
  );
  assert.ok(
    analHideConsumed.debugAliveZones.some(
      (d) =>
        Math.abs(d.bottom - 3878.32) < 0.01 &&
        Math.abs(d.top - 3880.05) < 0.01 &&
        d.consumed
    ),
    'Consumed zone must remain in debugAliveZones with consumed=true'
  );
  assert.equal(
    analHideConsumed.chartZones.some(
      (z) => z.id === '1m-BUY-1711938240-3878.32-3880.05'
    ),
    false,
    'Consumed zone must be hidden from chartZones by default (showConsumedZones=false)'
  );
  assert.equal(
    analShowConsumed.chartZones.some(
      (z) => z.id === '1m-BUY-1711938240-3878.32-3880.05'
    ),
    true,
    'Consumed zone must be included in chartZones when showConsumedZones=true'
  );

  // 4) Replay + Calibration window label ("Replay window: 4h58m of real M1, 301 candles") & "SMALL SAMPLE - NOT RELIABLE"
  const m1Bars301: Candle[] = [];
  const start301 = 1711929600;
  // 301 bars with oldest=start301 and newest=start301 + 298*60 (4h58m = 17880s)
  for (let i = 0; i < 301; i++) {
    const t = i === 300 ? start301 + 298 * 60 : start301 + Math.min(298, i) * 60;
    m1Bars301.push({
      time: t,
      open: 3880,
      high: 3881,
      low: 3879,
      close: 3880,
      tickVolume: 100,
      buyVol: 50,
      sellVol: 50,
    });
  }
  const winInfo = formatReplayWindowLabel(m1Bars301);
  assert.equal(
    winInfo.windowLabel,
    'Replay window: 4h58m of real M1, 301 candles',
    'formatReplayWindowLabel must format exact hours/minutes and candle count'
  );
  assert.equal(winInfo.isWindowAtLeast12h, false);

  // Even with 15 winning trades, if window < 12h, summary must be "SMALL SAMPLE - NOT RELIABLE"
  const fifteenWins = Array.from({ length: 15 }, (_, idx) => ({
    id: `t-${idx}`,
    zoneId: `z-${idx}`,
    time: Date.now() - idx * 60000,
    tf: '5m' as RedSniperTimeframe,
    side: 'BUY' as const,
    entry: 3880,
    exit: 3890,
    pnl: 30,
    r: 2.0,
    result: 'TP3' as const,
    session: 'LONDON',
    power: 85,
    class: 'win' as const,
  }));
  const perfShortWindow = computePerformanceMetrics(
    fifteenWins,
    winInfo.windowSeconds
  );
  assert.equal(perfShortWindow.isReliableSample, false);
  assert.equal(
    perfShortWindow.confidenceLabel,
    'SMALL SAMPLE - NOT RELIABLE',
    'When replay/history window < 12h, summary must refuse confident label and show SMALL SAMPLE - NOT RELIABLE'
  );

  // With >= 12h window (e.g. 14h = 50400s) and n >= 10 trades, summary is reliable
  const perfLongWindow = computePerformanceMetrics(fifteenWins, 14 * 3600);
  assert.equal(perfLongWindow.isReliableSample, true);
  assert.notEqual(perfLongWindow.confidenceLabel, 'SMALL SAMPLE - NOT RELIABLE');

  // With >= 12h window but n < 10 trades (e.g. 5 trades), summary must still be "SMALL SAMPLE - NOT RELIABLE"
  const perfFewTrades = computePerformanceMetrics(
    fifteenWins.slice(0, 5),
    14 * 3600
  );
  assert.equal(perfFewTrades.isReliableSample, false);
  assert.equal(perfFewTrades.confidenceLabel, 'SMALL SAMPLE - NOT RELIABLE');

  // 5) Persistent BOT LOG events: zone detected, entry, TP1 hit + BE, trailing-stop move (old SL -> new SL), exit with reason
  const seenZones = new Set<string>();
  const detLogs = detectNewZoneBotLogs([freshZone], seenZones, 1711930000000, false);
  assert.equal(detLogs.length, 1);
  assert.equal(detLogs[0].type, 'ZONE_DETECTED');
  assert.ok(detLogs[0].message.includes('Zone detected:'));

  // Step 1: Entry inside freshZone [3910, 3915] (SELL zone, distal=3915, SL=3916.5 with buffer 1.5, risk=4.5 at entry 3912)
  const demo0: RedSniperDemoState = {
    balance: 1000,
    autoEnabled: true,
    openTrades: [],
    closedTrades: [],
    usedZoneIds: [],
  };
  const sEntry = stepAutoTraderOnTick(
    demo0,
    3912,
    [freshZone],
    'BEAR',
    'BEAR',
    'LONDON',
    1711930010000,
    DEFAULT_RED_SNIPER_SETTINGS,
    false
  );
  assert.equal(sEntry.nextState.openTrades.length, 1);
  assert.ok(
    sEntry.botLogs.some((l) => l.type === 'ENTRY' && l.message.includes('Entry:')),
    'stepAutoTraderOnTick must emit an ENTRY bot log'
  );

  // Step 2: Price drops to hit TP1 + BE and activates trailing stop (SELL entry=3912, risk=4.5, TP1=3907.5, trail activates <= 3905.5)
  const sTp1 = stepAutoTraderOnTick(
    sEntry.nextState,
    3905.0,
    [freshZone],
    'BEAR',
    'BEAR',
    'LONDON',
    1711930020000,
    DEFAULT_RED_SNIPER_SETTINGS,
    false
  );
  assert.ok(
    sTp1.botLogs.some((l) => l.type === 'TP1_BE' && l.message.includes('TP1 hit + BE:')),
    'stepAutoTraderOnTick must emit TP1_BE bot log when TP1 is hit'
  );
  assert.ok(
    sTp1.botLogs.some((l) => l.type === 'TRAIL_MOVE' && l.message.includes('->')),
    'stepAutoTraderOnTick must emit TRAIL_MOVE bot log with old SL -> new SL'
  );

  // Step 3: Price drops all the way to TP3 -> EXIT with reason
  const openTr = sTp1.nextState.openTrades[0];
  const sExit = stepAutoTraderOnTick(
    sTp1.nextState,
    openTr.tp3 - 0.5,
    [freshZone],
    'BEAR',
    'BEAR',
    'LONDON',
    1711930030000,
    DEFAULT_RED_SNIPER_SETTINGS,
    false
  );
  assert.equal(sExit.nextState.openTrades.length, 0);
  assert.ok(
    sExit.botLogs.some((l) => l.type === 'EXIT' && l.message.includes('Exit [TP3]:')),
    'stepAutoTraderOnTick must emit EXIT bot log with exit reason'
  );

  const mergedBotLogs = mergeBotLogEntries(
    detLogs,
    [...sEntry.botLogs, ...sTp1.botLogs, ...sExit.botLogs],
    200
  );
  const clipText = formatBotLogForClipboard(mergedBotLogs);
  assert.ok(
    clipText.includes('[ZONE_DETECTED]') &&
      clipText.includes('[ENTRY]') &&
      clipText.includes('[TP1_BE]') &&
      clipText.includes('[TRAIL_MOVE]') &&
      clipText.includes('[EXIT]'),
    'Formatted bot log for clipboard must include all 5 lifecycle event types'
  );

  console.log(
    '✓ Test 13 passed: Frozen "zones-v3" snapshot, candle store dedupe/merge + M1 higher-TF builder, consumed-zone filter, replay window label ("Replay window: 4h58m of real M1, 301 candles" + "SMALL SAMPLE - NOT RELIABLE"), and BOT LOG events verified'
  );
}

// ============================================================================
// LIVE XAUUSD DATA PER-TIMEFRAME TABLE PRINTOUT (1m, 5m, 15m, 1H, 4H, 1D)
// ============================================================================
async function printLiveXauusdZonesTable(): Promise<void> {
  const directTfs: Exclude<RedSniperTimeframe, '3m'>[] = [
    '1m',
    '5m',
    '15m',
    '30m',
    '1h',
    '4h',
    '1d',
  ];

  const barsMap: RedSniperBarsMap = {
    '1m': [],
    '3m': [],
    '5m': [],
    '15m': [],
    '30m': [],
    '1h': [],
    '4h': [],
    '1d': [],
  };
  const historyDiag: Partial<RedSniperHistoryDiagnosticsMap> = {};

  let livePrice: number | null = null;

  await Promise.all(
    directTfs.map(async (tf) => {
      try {
        const target = tf === '1d' ? 300 : 400;
        const { bars: parsed, diagnostics: log } =
          await fetchBrokerOhlcWithDiagnostics(tf, target);
        historyDiag[tf] = log;
        if (parsed.length > 0) {
          barsMap[tf] = parsed;
          if (tf === '1m') {
            livePrice = parsed[parsed.length - 1].close;
          }
        }
      } catch {
        // Ignore network errors in offline environments
      }
    })
  );

  if (barsMap['1m'].length > 0) {
    barsMap['3m'] = build3mFrom1m(barsMap['1m']);
  }
  if (!livePrice && barsMap['1h'].length > 0) {
    livePrice = barsMap['1h'][barsMap['1h'].length - 1].close;
  }

  console.log('\n=== 1) LIVE BIQUOTE HISTORY DIAGNOSTICS (1m, 5m, 15m, 1H, 4H, 1D) ===');
  const reportHistoryTfs: Exclude<RedSniperTimeframe, '3m'>[] = [
    '1m',
    '5m',
    '15m',
    '1h',
    '4h',
    '1d',
  ];
  for (const tf of reportHistoryTfs) {
    const h = historyDiag[tf];
    if (!h) continue;
    console.log(
      `[${tf.toUpperCase()}] source=${h.source} | barsLoaded=${
        h.barsLoaded
      } | oldestCandleIso=${h.oldestCandleIso ?? 'N/A'} | note=${
        h.historyLimitReached ?? 'target met'
      }`
    );
  }

  const { byTf, mergedZones, verdict } = analyzeAllTimeframes(
    barsMap,
    livePrice,
    DEFAULT_RED_SNIPER_SETTINGS
  );

  console.log(
    `\n=== 2) LIVE XAUUSD RED SNIPER BASE ZONES BY TIMEFRAME (Engine: ${RED_SNIPER_ZONE_ENGINE_VERSION} | Price: $${
      livePrice ? livePrice.toFixed(2) : 'N/A'
    } | farAtr: ${DEFAULT_RED_SNIPER_SETTINGS.farAtr} | Verdict: ${
      verdict.banner
    } | Merged All-TF rows: ${mergedZones.length}) ===`
  );

  const printTfs: RedSniperTimeframe[] = ['1m', '5m', '1h', '4h'];
  for (const tf of printTfs) {
    const a = byTf[tf];
    const aliveEntries = a.debugAliveZones.filter(
      (d) => d.reasonDropped !== 'dead:closeBeyond'
    );
    const deadEntries = a.debugAliveZones.filter(
      (d) => d.reasonDropped === 'dead:closeBeyond'
    );

    console.log(
      `\n[${tf.toUpperCase()}] barsLoaded: ${a.barsLoaded} | RetestMode: ${
        a.retestModeUsed
      } | ATR14: $${a.atr14.toFixed(2)} | Selected: ${
        a.zones.length
      } (Chart non-consumed: ${
        a.chartZones.length
      }) | Alive before selection: ${aliveEntries.length} | Dead (closeBeyond@0.25): ${
        deadEntries.length
      }`
    );
    console.log(
      '| Side | Bottom – Top | Height | State | indRetests | touchCandles | pctLeft | consumed | reasonDropped |'
    );
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const d of aliveEntries) {
      console.log(
        `| ${d.side} | ${d.bottom.toFixed(2)} – ${d.top.toFixed(2)} | $${d.height.toFixed(
          2
        )} | ${d.state} | ${d.independentRetests}x | ${d.touchCandles}x | ${
          d.pctLeft
        }% | ${d.consumed} | ${d.reasonDropped} |`
      );
    }
  }
}

async function main() {
  testZonesPerTimeframeDifferAndScale();
  testDeadRuleUsesClosesOnlyAndFlagsSweep();
  testRetestToleranceAndStateParity();
  testNearbyZonesNeverDroppedBySelection();
  testHeightCapTrimsDistalSideAndPreservesNaturalVariety();
  testWeakZoneRetryWhenUnderFourZones();
  testDuplicateMergeAcrossTimeframes();
  testMissingTickVolumeAndPowerFormula();
  testStateLabelRuleAndDeadCloseBeyondDebug();
  testRetestModeCandleVsAtr();
  testMarketClosedCalibrationAndReplay();
  testRemainingParityFixes1To5();
  testZonesV3FreezeStoreConsumedReplayAndBotLog();
  await runAllStorageTests();
  await printLiveXauusdZonesTable();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
