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
  getLookbackForTf,
  getMinorPivotLengthForTf,
  getZoneCacheStats,
  isZoneNear,
  mergeBotLogEntries,
  mergeOverlappingMultiTfZones,
  resetZoneCacheStats,
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
// TEST 4: Max 3+3 zones per TF (3 SELL above + 3 BUY below) & NO REPAINT on forming candle
// ============================================================================
function testNearbyZonesNeverDroppedBySelection(): void {
  const bars = makeScaledTimeframeBars(320, 2.0, 60);
  const closedRef = bars[bars.length - 2].close;

  // 1) Verify max 6 zones = at most 3 nearest SELL above price + at most 3 nearest BUY below price
  const audit6 = findZonesWithAudit(bars, '1m', {
    maxZones: 6,
    livePrice: closedRef,
  });
  const sellsAbove = audit6.selected.filter((z) => z.supply);
  const buysBelow = audit6.selected.filter((z) => !z.supply);
  assert.ok(
    audit6.selected.length <= 6,
    `Selected zones (${audit6.selected.length}) must never exceed 6`
  );
  assert.ok(
    sellsAbove.length <= 3,
    `Selected SELL zones (${sellsAbove.length}) must be <= 3`
  );
  assert.ok(
    buysBelow.length <= 3,
    `Selected BUY zones (${buysBelow.length}) must be <= 3`
  );
  for (const s of sellsAbove) {
    assert.ok(s.top >= closedRef, 'Selected SELL zone must be above price');
  }
  for (const b of buysBelow) {
    assert.ok(b.bottom <= closedRef, 'Selected BUY zone must be below price');
  }

  // With maxZones=2 (max 1 SELL + 1 BUY), extra nearby zones ARE capped (no "keep all within 4xATR" clutter)
  const audit2 = findZonesWithAudit(bars, '1m', {
    maxZones: 2,
    livePrice: closedRef,
  });
  assert.ok(
    audit2.selected.length <= 2,
    'Selection must strictly respect maxZones without keeping extra zones within 4xATR'
  );

  // 2) Verify per-TF lookback cap on closed bars (1m-5m: 300, 15m-30m: 250, 1H-4H-1D: 200)
  assert.equal(getLookbackForTf('1m'), 300);
  assert.equal(getLookbackForTf('5m'), 300);
  assert.equal(getLookbackForTf('15m'), 250);
  assert.equal(getLookbackForTf('30m'), 250);
  assert.equal(getLookbackForTf('1h'), 200);
  assert.equal(getLookbackForTf('4h'), 200);
  assert.equal(getLookbackForTf('1d'), 200);
  const minAllowedIdx = Math.max(0, bars.length - 1 - getLookbackForTf('1m'));
  for (const z of audit6.allAliveBeforeSelection) {
    assert.ok(
      z.startIdx >= minAllowedIdx,
      `Zone pivot index ${z.startIdx} must be within the last 300 closed candles (>= ${minAllowedIdx})`
    );
  }

  // 3) NO REPAINT ON FORMING CANDLE: mutating the last (forming) candle or livePrice must NOT change zones
  const mutatedFormingBars = bars.map((b, idx) =>
    idx === bars.length - 1
      ? {
          ...b,
          open: b.open + 45,
          high: b.high + 120,
          low: b.low - 120,
          close: b.close - 60,
        }
      : { ...b }
  );
  const analOriginal = analyzeTimeframe('1m', bars, 'BULL', 'BULL', closedRef);
  const analMutatedForming = analyzeTimeframe(
    '1m',
    mutatedFormingBars,
    'BULL',
    'BULL',
    closedRef + 35
  );
  assert.deepEqual(
    analMutatedForming.zones.map((z) => ({
      id: z.id,
      bottom: z.bottom,
      top: z.top,
      status: z.status,
      retests: z.retests,
      pctLeft: z.pctLeft,
    })),
    analOriginal.zones.map((z) => ({
      id: z.id,
      bottom: z.bottom,
      top: z.top,
      status: z.status,
      retests: z.retests,
      pctLeft: z.pctLeft,
    })),
    'Mutating the forming last candle or livePrice must NEVER repaint zones'
  );

  console.log(
    '✓ Test 4 passed: Max 3+3 selection (3 SELL above + 3 BUY below), per-TF lookback (300/250/200), and zero repaint on forming candle verified'
  );
}

// ============================================================================
// TEST 5: Pivot candle box height clamped to 0.5 - 1.2 x ATR at pivot time & Wilder ATR gap cap
// ============================================================================
function testHeightCapTrimsDistalSideAndPreservesNaturalVariety(): void {
  assert.equal(
    DEFAULT_RED_SNIPER_SETTINGS.heightCapAtr,
    1.2,
    'Default heightCapAtr must be 1.2'
  );

  const bars = makeScaledTimeframeBars(200, 12.0, 3600);
  const audit = findZonesWithAudit(bars, '1h', { heightCapAtr: 1.2 });
  assert.ok(audit.selected.length > 0, 'Expected H1 pivot zones');

  for (const z of audit.selected) {
    const h = z.top - z.bottom;
    const pAtr = z.pivotAtr || audit.atr14;
    const minExpected = 0.5 * pAtr - 0.05;
    const maxExpected = 1.2 * pAtr + 0.05;
    assert.ok(
      h >= minExpected && h <= maxExpected,
      `Zone height ${h.toFixed(2)} must be clamped within [0.5, 1.2] x pivotAtr (${minExpected.toFixed(
        2
      )}..${maxExpected.toFixed(2)})`
    );
  }

  // Verify news spike / session gap > 3xATR on a later candle does NOT change earlier zone's height (uses ATR at pivot time)
  const barsWithLaterSpike = bars.map((b, idx) =>
    idx === bars.length - 3
      ? { ...b, high: b.high + 500, low: b.low - 500 }
      : { ...b }
  );
  const auditSpike = findZonesWithAudit(barsWithLaterSpike, '1h', {
    heightCapAtr: 1.2,
  });
  for (const z of audit.selected) {
    const match = auditSpike.allAliveBeforeSelection.find(
      (s) => s.time === z.time && s.supply === z.supply
    );
    if (match) {
      assert.equal(
        match.top - match.bottom,
        z.top - z.bottom,
        'Zone height must use ATR at pivot creation time, unaffected by later news spikes'
      );
    }
  }

  console.log(
    '✓ Test 5 passed: Pivot candle box height clamped to 0.5–1.2x pivot-time ATR & Wilder 3xATR gap cap verified'
  );
}

// ============================================================================
// TEST 6: Swing pivot requires BOS/CHoCH candle-close confirmation
// ============================================================================
function testWeakZoneRetryWhenUnderFourZones(): void {
  // Build a series with a swing high at i=5, where price pulls back slightly but NEVER closes below the prior swing low
  const unconfirmedBars: Candle[] = [];
  for (let i = 0; i < 15; i++) {
    unconfirmedBars.push({
      time: 1000 + i * 60,
      open: 3880.0,
      high: 3881.0,
      low: 3879.0,
      close: 3880.2,
      tickVolume: 100,
      buyVol: 50,
      sellVol: 50,
    });
  }
  // Pivot high at i=6 (high=3886), prior lows are 3879.0. Subsequent bars stay at 3880..3882 (never close < 3879.0)
  unconfirmedBars[6] = {
    time: 1000 + 6 * 60,
    open: 3884.5,
    high: 3886.0,
    low: 3883.0,
    close: 3885.0,
    tickVolume: 120,
    buyVol: 60,
    sellVol: 60,
  };
  for (let i = 7; i < 14; i++) {
    unconfirmedBars[i] = {
      time: 1000 + i * 60,
      open: 3881.0,
      high: 3882.0,
      low: 3879.5, // never breaks prior low 3879.0
      close: 3880.5,
      tickVolume: 100,
      buyVol: 50,
      sellVol: 50,
    };
  }

  // Pass 1 alone (enableWeakRetry: false) requires BOS confirmation
  const pass1OnlyAudit = findZonesWithAudit(unconfirmedBars, '1m', {
    enableWeakRetry: false,
  });
  assert.equal(
    pass1OnlyAudit.selected.filter((z) => z.supply && z.startIdx === 6).length,
    0,
    'In primary pass, swing high that never broke the previous opposite pivot on a close must be ignored'
  );

  // Fill pass (enableWeakRetry: true, default when < 3 zones on a side) uses unconfirmed pivot and tags it minor=true
  const fillPassAudit = findZonesWithAudit(unconfirmedBars, '1m', {
    enableWeakRetry: true,
  });
  const minorFillZone = fillPassAudit.selected.find((z) => z.supply && z.startIdx === 6);
  assert.ok(
    minorFillZone && minorFillZone.minor === true,
    'When fewer than 3 zones on a side, fill pass may use unconfirmed pivot and tag it minor=true'
  );

  // Now add a candle at i=10 that closes below 3879.0 (confirming BOS/CHoCH in primary pass)
  const confirmedBars = unconfirmedBars.map((b) => ({ ...b }));
  confirmedBars[10] = {
    time: 1000 + 10 * 60,
    open: 3880.0,
    high: 3880.5,
    low: 3876.0,
    close: 3876.5, // breaks opposite low 3879.0 on close!
    tickVolume: 180,
    buyVol: 50,
    sellVol: 130,
  };
  const confirmedAudit = findZonesWithAudit(confirmedBars, '1m', {
    enableWeakRetry: false,
  });
  const primaryZone = confirmedAudit.selected.find((z) => z.supply && z.startIdx === 6);
  assert.ok(
    primaryZone && !primaryZone.minor && primaryZone.bosConfirmed === true,
    'Swing high confirmed by a later candle close breaking the opposite pivot must create a primary (non-minor) SELL zone'
  );

  console.log(
    '✓ Test 6 passed: Primary BOS confirmation rule + minor pivot fill pass verified'
  );
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
  bars.push({
    time: 2000 + 10 * 3600,
    open: 4266,
    high: 4272,
    low: 4262,
    close: 4268,
    tickVolume: 160,
    buyVol: 70,
    sellVol: 90,
  });
  bars.push({
    time: 2000 + 11 * 3600,
    open: 4268,
    high: 4275,
    low: 4265,
    close: 4270,
    tickVolume: 150,
    buyVol: 70,
    sellVol: 80,
  });
  // Multiple deep retests (wicking above 4310 so pctLeft = 0%, but closing at 4309.5 inside [4300, 4310])
  for (let r = 0; r < 4; r++) {
    // Away candle
    bars.push({
      time: 2000 + (12 + r * 2) * 3600,
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
      time: 2000 + (13 + r * 2) * 3600,
      open: 4298,
      high: 4312,
      low: 4296,
      close: 4309.5,
      tickVolume: 190,
      buyVol: 95,
      sellVol: 95,
    });
  }
  // Final away candle + forming candle
  bars.push({
    time: 2000 + 20 * 3600,
    open: 4290,
    high: 4292,
    low: 4280,
    close: 4284,
    tickVolume: 150,
    buyVol: 70,
    sellVol: 80,
  });
  bars.push({
    time: 2000 + 21 * 3600,
    open: 4284,
    high: 4286,
    low: 4280,
    close: 4283,
    tickVolume: 140,
    buyVol: 70,
    sellVol: 70,
  });

  // Verify that by default (showConsumedZones=false), the zone with 4 retests and 0% left is HIDDEN from selected zones
  const hiddenByDefault = findZones(bars, '4h', {
    deadAtr: 0.25,
    heightCapAtr: 1.2,
    showConsumedZones: false,
  });
  assert.equal(
    hiddenByDefault.find((z) => z.supply && z.endIdx === 6),
    undefined,
    'Consumed zone (0% left or 3+ retests) must be hidden from selected zones by default'
  );

  // Verify it is still tracked as ALIVE + consumed in debug audit (and returned when showConsumedZones=true)
  const auditConsumed = findZonesWithAudit(bars, '4h', {
    deadAtr: 0.25,
    heightCapAtr: 1.2,
    showConsumedZones: false,
  });
  const deepSupply = auditConsumed.allAliveBeforeSelection.find(
    (z) => z.supply && z.endIdx === 6
  );
  assert.ok(
    deepSupply,
    'Zone with 4 retests and 0% left that never closed beyond distal + deadAtr*ATR must stay ALIVE in debugAliveZones'
  );
  assert.equal(deepSupply.pctLeft, 0);
  assert.ok(deepSupply.tests >= 3);
  assert.equal(deepSupply.consumed, true);
  assert.equal(deepSupply.droppedReason, 'consumed');
  assert.equal(
    deepSupply.state,
    'DEEP',
    'Zone with 0% left and 4 retests must have state DEEP, never TESTED'
  );

  // Now add a candle that closes well beyond distal + 0.25*ATR (e.g. close at 4325)
  const breakCandleTime = 2000 + 22 * 3600;
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
      time: 2000 + 23 * 3600,
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
  // Rule 4: Count a retest only after price moved away by retestGapAtr x ATR (default 'ATR' mode across all timeframes)
  assert.equal(resolveDefaultRetestModeForTf('1m'), 'ATR');
  assert.equal(resolveDefaultRetestModeForTf('3m'), 'ATR');
  assert.equal(resolveDefaultRetestModeForTf('5m'), 'ATR');
  assert.equal(resolveDefaultRetestModeForTf('15m'), 'ATR');
  assert.equal(resolveDefaultRetestModeForTf('30m'), 'ATR');
  assert.equal(resolveDefaultRetestModeForTf('1h'), 'ATR');
  assert.equal(resolveDefaultRetestModeForTf('4h'), 'ATR');
  assert.equal(resolveDefaultRetestModeForTf('1d'), 'ATR');

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
    minor: false,
    bosConfirmed: true,
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
// TEST 12: No Overlap (Same-Side AND BUY/SELL), farAtr, TOUCH_CANDLES vs independentRetests,
//          and deadAtr Comparison
// ============================================================================
function testRemainingParityFixes1To5() {
  assert.ok(
    Math.abs(
      computeSameSideOverlapRatio(
        { bottom: 4000, top: 4010 },
        { bottom: 4006, top: 4016 }
      ) - 0.4
    ) < 1e-6
  );

  // Build synthetic bars with:
  // - Older SELL pivot at i = 6: [high=3905, bodyTop=3903] -> [3902.5, 3905]
  // - Fresher SELL pivot at i = 16: [high=3904.5, bodyTop=3902] -> overlaps older SELL zone -> older SELL zone is dropped ('overlap')!
  // - BUY pivot at i = 24 whose box overlaps the SELL zone -> dropped ('overlap') so BUY and SELL zones NEVER overlap!
  const bars: Candle[] = [];
  const t0 = 1711929600;
  for (let i = 0; i < 48; i++) {
    bars.push({
      time: t0 + i * 300,
      open: 3890,
      high: 3892,
      low: 3888,
      close: 3890,
      tickVolume: 100,
      buyVol: 50,
      sellVol: 50,
    });
  }

  // Older SELL pivot at i = 11 (with effectiveL=10 on 47 closed bars, let's use '1h' where L=5)
  // On '1h' (L=5):
  // Pivot High #1 at i = 6: high = 3905
  bars[6] = {
    time: t0 + 6 * 300,
    open: 3903,
    high: 3905,
    low: 3901,
    close: 3902.5,
    tickVolume: 120,
    buyVol: 50,
    sellVol: 70,
  };
  bars[7] = {
    time: t0 + 7 * 300,
    open: 3902,
    high: 3902.5,
    low: 3884,
    close: 3885, // breaks prior low 3888
    tickVolume: 200,
    buyVol: 50,
    sellVol: 150,
  };

  // Pivot High #2 at i = 16: high = 3904.2 (overlaps Pivot High #1 [~3902.5, 3905])
  bars[16] = {
    time: t0 + 16 * 300,
    open: 3902.8,
    high: 3904.2,
    low: 3900.5,
    close: 3902.2,
    tickVolume: 140,
    buyVol: 50,
    sellVol: 90,
  };
  bars[17] = {
    time: t0 + 17 * 300,
    open: 3902,
    high: 3902.5,
    low: 3880,
    close: 3881, // breaks prior low 3884
    tickVolume: 280,
    buyVol: 40,
    sellVol: 240,
  };

  // Minor swing low at i = 22 (low = 3886.0) before Pivot High #3 at i = 26
  bars[22] = {
    time: t0 + 22 * 300,
    open: 3889.0,
    high: 3890.0,
    low: 3886.0,
    close: 3887.5,
    tickVolume: 110,
    buyVol: 55,
    sellVol: 55,
  };

  // Distinct non-overlapping SELL Pivot High #3 at i = 26: high = 3898.0
  bars[26] = {
    time: t0 + 26 * 300,
    open: 3896.5,
    high: 3898.0,
    low: 3895.0,
    close: 3896.0,
    tickVolume: 130,
    buyVol: 50,
    sellVol: 80,
  };
  bars[27] = {
    time: t0 + 27 * 300,
    open: 3896.0,
    high: 3896.5,
    low: 3881.5,
    close: 3882.0, // breaks minor swing low 3886.0 on close!
    tickVolume: 250,
    buyVol: 40,
    sellVol: 210,
  };

  // Two consecutive touch candles into Pivot High #3 [~3895.5, 3898.0] at i = 32 and i = 33
  bars[32] = {
    time: t0 + 32 * 300,
    open: 3893.0,
    high: 3896.8,
    low: 3892.0,
    close: 3894.0,
    tickVolume: 110,
    buyVol: 55,
    sellVol: 55,
  };
  bars[33] = {
    time: t0 + 33 * 300,
    open: 3894.0,
    high: 3897.0,
    low: 3893.0,
    close: 3891.0,
    tickVolume: 110,
    buyVol: 55,
    sellVol: 55,
  };

  const auditCandle = analyzeTimeframe('1h', bars, 'NEUT', 'NEUT', 3885, {
    ...DEFAULT_RED_SNIPER_SETTINGS,
    heightCapAtr: 1.2,
    retestMode: 'CANDLE',
    retestModeOverride: true,
    farAtr: 25,
  });

  // 1) Verify NO overlapping zones exist in auditCandle.zones (neither same-side nor BUY/SELL)
  for (let i = 0; i < auditCandle.zones.length; i++) {
    for (let j = i + 1; j < auditCandle.zones.length; j++) {
      const a = auditCandle.zones[i];
      const b = auditCandle.zones[j];
      const overlaps = Math.min(a.top, b.top) >= Math.max(a.bottom, b.bottom) - 1e-6;
      assert.equal(
        overlaps,
        false,
        `Zones ${a.id} [${a.bottom}-${a.top}] and ${b.id} [${b.bottom}-${b.top}] must NEVER overlap`
      );
    }
  }

  const droppedOverlapEntry = auditCandle.debugAliveZones.find(
    (d) => d.reasonDropped === 'overlap'
  );
  assert.ok(
    droppedOverlapEntry &&
      droppedOverlapEntry.overlapDecision.startsWith('dropped:overlap'),
    'Overlapping zone must be dropped with reasonDropped = "overlap"'
  );

  // 2) RETEST COUNT COMPARISON: independentRetests vs touchCandles + TOUCH_CANDLES mode
  const zoneBCandle = auditCandle.zones.find(
    (z) => Math.abs(z.top - 3898.0) < 0.05
  );
  assert.ok(zoneBCandle, 'Pivot High #3 @ 3898.0 must exist');
  assert.equal(
    zoneBCandle.independentRetests,
    1,
    'Consecutive touch candles without moving away count as 1 independentRetest'
  );
  assert.equal(
    zoneBCandle.touchCandles,
    2,
    'touchCandles must count every candle touching the box (2 candles)'
  );
  assert.equal(
    zoneBCandle.retests,
    1,
    'In CANDLE mode, zone.retests equals independentRetests (1)'
  );

  const auditTouchMode = analyzeTimeframe('1h', bars, 'NEUT', 'NEUT', 3885, {
    ...DEFAULT_RED_SNIPER_SETTINGS,
    heightCapAtr: 1.2,
    retestMode: 'TOUCH_CANDLES',
    retestModeOverride: true,
    farAtr: 25,
  });
  const zoneBTouchMode = auditTouchMode.zones.find(
    (z) => Math.abs(z.top - 3898.0) < 0.05
  );
  assert.ok(zoneBTouchMode, 'Zone @ 3898.0 must exist in TOUCH_CANDLES mode');
  assert.equal(
    zoneBTouchMode.retests,
    2,
    'In TOUCH_CANDLES mode, zone.retests must equal touchCandles (2)'
  );

  // 3) FAR RULE: farAtr setting (default 25, range 10-60)
  assert.equal(DEFAULT_RED_SNIPER_SETTINGS.farAtr, 25);
  assert.equal(sanitizeRedSniperSettings({ farAtr: 5 }).farAtr, 10);
  assert.equal(sanitizeRedSniperSettings({ farAtr: 90 }).farAtr, 60);

  const zone20AtrAway = {
    ...zoneBCandle,
    atr14: 5,
    bottom: 4000,
    top: 4005,
  };
  assert.equal(isZoneNear(zone20AtrAway, 3900, 25), true);
  assert.equal(isZoneNear(zone20AtrAway, 3900, 15), false);

  // 4) DEAD-RULE COMPARISON TOOL: deadAtr in [0.25, 0.5, 0.75, 1.0]
  const barsWithCloseBeyond = bars.map((b) => ({ ...b }));
  const atr1h = auditCandle.atr14;
  barsWithCloseBeyond[38] = {
    time: t0 + 38 * 300,
    open: 3902,
    high: 3905 + 0.45 * atr1h,
    low: 3901,
    close: 3905 + 0.38 * atr1h,
    tickVolume: 130,
    buyVol: 80,
    sellVol: 50,
  };
  const deadComp = computeDeadAtrComparison(
    barsWithCloseBeyond,
    '1h',
    3885,
    DEFAULT_RED_SNIPER_SETTINGS
  );
  assert.deepEqual(
    deadComp.map((c) => c.deadAtr),
    [0.25, 0.5, 0.75, 1.0]
  );
  const comp025 = deadComp.find((c) => c.deadAtr === 0.25)!;
  const comp050 = deadComp.find((c) => c.deadAtr === 0.5)!;
  assert.ok(
    comp050.aliveCount >= comp025.aliveCount &&
      comp050.aliveAtThisValueButDeadAt025.length > 0,
    'deadAtr = 0.5 must keep zones alive that died at 0.25'
  );

  console.log(
    '✓ Test 12 passed: Zero overlap (same-side & BUY/SELL), farAtr (25, 10–60), independentRetests vs touchCandles, and deadAtr comparison verified'
  );
}

// ============================================================================
// TEST 13: Consumed Zones Hidden (pctLeft=0 or 3+ retests), Multi-TF A+ Confluence,
//          Server Candle Store Dedupe/Merge, Replay Window Label, and BOT LOG Events
// ============================================================================
function testZonesV3FreezeStoreConsumedReplayAndBotLog(): void {
  assert.equal(RED_SNIPER_ZONE_ENGINE_VERSION, 'zones-v3');
  assert.equal(DEFAULT_RED_SNIPER_SETTINGS.deadAtr, 0.25);
  assert.equal(DEFAULT_RED_SNIPER_SETTINGS.showConsumedZones, false);

  const m1Det = makeScaledTimeframeBars(200, 1.8, 60);
  const m5Det = makeScaledTimeframeBars(200, 3.6, 300);
  const h1Det = makeScaledTimeframeBars(200, 8.5, 3600);
  const h4Det = makeScaledTimeframeBars(200, 22.0, 14400);

  const snap1m = analyzeTimeframe('1m', m1Det, 'BULL', 'BULL', 3922);
  const snap5m = analyzeTimeframe('5m', m5Det, 'BULL', 'BULL', 3964);
  const snap1h = analyzeTimeframe('1h', h1Det, 'BULL', 'BULL', 4080);
  const snap4h = analyzeTimeframe('4h', h4Det, 'BULL', 'BULL', 4399);

  // Verify AUTO retest mode used per timeframe (away-gated by retestGapAtr * ATR)
  assert.equal(snap1m.retestModeUsed, 'ATR');
  assert.equal(snap5m.retestModeUsed, 'ATR');
  assert.equal(snap1h.retestModeUsed, 'ATR');
  assert.equal(snap4h.retestModeUsed, 'ATR');

  // Verify every returned zone in snap1m/5m/1h/4h is non-consumed (pctLeft > 0 and retests < 3) and non-overlapping
  for (const snap of [snap1m, snap5m, snap1h, snap4h]) {
    assert.ok(snap.zones.length > 0 && snap.zones.length <= 6);
    for (const z of snap.zones) {
      assert.equal(z.consumed, false, 'Consumed zones must be hidden from zones list');
      assert.ok(z.pctLeft > 0, 'Zones with pctLeft=0 must be hidden');
      assert.ok(z.retests < 3, 'Zones with 3+ retests must be hidden');
      assert.ok(
        z.chartLabel.includes(`${z.side} ·`) &&
          z.chartLabel.includes(`PWR ${z.power} · ${z.pctLeft}%`),
        `chartLabel "${z.chartLabel}" must match short one-line format`
      );
    }
  }

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
  assert.equal(mergedStoreM1.length, 3);
  assert.equal(mergedStoreM1[1].close, 3883.5);
  assert.equal(mergedStoreM1[1].tickVolume, 145);

  const longM1 = makeScaledTimeframeBars(1800, 1.8, 60);
  const shortBroker5m = makeScaledTimeframeBars(50, 3.6, 300);
  assert.equal(doesStoredM1CoverRange(longM1, shortBroker5m, '5m', 2000), true);
  assert.equal(doesM1CoverTimeframeRange(longM1, shortBroker5m, '5m'), true);
  const built5mServer = buildHigherTfFromStoredM1(longM1, '5m', 2000);
  const built5mClient = buildHigherTimeframeFrom1m(longM1, '5m', [], 2000);
  assert.equal(built5mServer.length, 360);
  assert.equal(built5mClient.length, 360);
  assert.deepEqual(normalizeRedSniperCandle(built5mServer[0], '5m'), built5mClient[0]);

  // 3) Consumed-zone filter (pctLeft = 0 OR 3+ retests): hidden from chartZones, zones, and bot by default, kept in debugAliveZones
  const targetTemplate = snap5m.zones[0];
  assert.ok(targetTemplate, 'Expected a zone template for consumed filter test');

  const consumedZeroPct: RedSniperZone = {
    ...targetTemplate,
    id: '5m-SELL-3900.00-3905.00',
    side: 'SELL',
    bottom: 3900,
    top: 3905,
    proximal: 3900,
    distal: 3905,
    status: 'DEEP',
    retests: 1,
    pctLeft: 0,
    consumed: true,
    isFar: false,
    power: 85,
  };
  const consumedThreeRetests: RedSniperZone = {
    ...targetTemplate,
    id: '5m-SELL-3900.00-3905.00-3x',
    side: 'SELL',
    bottom: 3900,
    top: 3905,
    proximal: 3900,
    distal: 3905,
    status: 'DEEP',
    retests: 3,
    pctLeft: 70,
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
    entryConfirmed: true,
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
  const stepConsumedHidden = stepAutoTraderOnTick(
    demoForConsumed,
    3902,
    [consumedZeroPct, consumedThreeRetests, freshZone],
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
    'Bot must ignore consumed zones (pctLeft=0 or 3+ retests)'
  );

  // Also check that plain boundary touch (livePrice === 3910 === proximal with entryConfirmed=false) does NOT enter
  const unconfirmedTouchZone: RedSniperZone = {
    ...freshZone,
    entryConfirmed: false,
  };
  const stepPlainTouch = stepAutoTraderOnTick(
    demoForConsumed,
    3910.0, // exact proximal boundary touch without sweep inside
    [unconfirmedTouchZone],
    'BEAR',
    'BEAR',
    'LONDON',
    Date.now(),
    DEFAULT_RED_SNIPER_SETTINGS,
    false
  );
  assert.equal(
    stepPlainTouch.nextState.openTrades.length,
    0,
    'Plain touch on proximal edge without sweep/confirmation must NOT trigger trade entry'
  );

  // Verify consumed zones on m1Det are in debugAliveZones as consumed=true, and hidden from zones & chartZones when showConsumedZones=false
  const analHideConsumed = analyzeTimeframe('1m', m1Det, 'BULL', 'BULL', 3880, {
    ...DEFAULT_RED_SNIPER_SETTINGS,
    showConsumedZones: false,
  });
  assert.ok(
    analHideConsumed.debugAliveZones.some((d) => d.consumed && d.reasonDropped === 'consumed'),
    'Consumed zones must remain in debugAliveZones with consumed=true and reasonDropped="consumed"'
  );
  assert.equal(
    analHideConsumed.zones.some((z) => z.consumed || z.pctLeft <= 0 || z.retests >= 3),
    false,
    'Consumed zones must be hidden from zones list when showConsumedZones=false'
  );
  assert.equal(
    analHideConsumed.chartZones.some((z) => z.consumed || z.pctLeft <= 0 || z.retests >= 3),
    false,
    'Consumed zones must be hidden from chartZones when showConsumedZones=false'
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

  // 6) NEW TESTS FOR:
  //    (a) Every TF with enough data returns 3 SELL above + 3 BUY below when candidates exist + debugCounts
  //    (b) pctLeft < 15 hidden from chart, list, and bot (and kept in debugAliveZones as 'consumed')
  //    (c) Strict A+ rules: same-side overlap with HIGHER TF (15m/30m/1H/4H), pctLeft >= 50, retests <= 1, power +6
  function makeThreePlusThreeBars(count: number, atrScale: number, stepSec: number): Candle[] {
    // Construct a staircase that builds 4 distinct non-overlapping swing lows below midPrice (3900)
    // and 4 distinct non-overlapping swing highs above midPrice (3900), then closes at 3900.
    const out: Candle[] = [];
    const tStart = 1711929600;
    const mid = 3900;
    const lowLevels = [
      mid - 16 * atrScale,
      mid - 12 * atrScale,
      mid - 8 * atrScale,
      mid - 4 * atrScale,
    ];
    const highLevels = [
      mid + 16 * atrScale,
      mid + 12 * atrScale,
      mid + 8 * atrScale,
      mid + 4 * atrScale,
    ];
    for (let i = 0; i < count; i++) {
      out.push({
        time: tStart + i * stepSec,
        open: mid,
        high: mid + 0.4 * atrScale,
        low: mid - 0.4 * atrScale,
        close: mid,
        tickVolume: 140,
        buyVol: 70,
        sellVol: 70,
      });
    }
    // Place 4 swing lows and 4 swing highs inside the last 180 closed bars, spaced 18 bars apart
    const baseOffset = Math.max(12, count - 185);
    for (let k = 0; k < 4; k++) {
      const lowIdx = baseOffset + k * 20;
      const lv = lowLevels[k];
      // Prior minor high before lowIdx so BOS is confirmed on bounce
      out[lowIdx - 3] = {
        time: tStart + (lowIdx - 3) * stepSec,
        open: lv + 1.8 * atrScale,
        high: lv + 2.2 * atrScale,
        low: lv + 1.2 * atrScale,
        close: lv + 1.6 * atrScale,
        tickVolume: 150,
        buyVol: 75,
        sellVol: 75,
      };
      out[lowIdx] = {
        time: tStart + lowIdx * stepSec,
        open: lv + 0.6 * atrScale,
        high: lv + 0.9 * atrScale,
        low: lv,
        close: lv + 0.7 * atrScale,
        tickVolume: 220,
        buyVol: 150,
        sellVol: 70,
      };
      out[lowIdx + 1] = {
        time: tStart + (lowIdx + 1) * stepSec,
        open: lv + 0.7 * atrScale,
        high: lv + 3.2 * atrScale,
        low: lv + 0.5 * atrScale,
        close: lv + 2.9 * atrScale, // breaks prior minor high -> BOS confirmed!
        tickVolume: 260,
        buyVol: 190,
        sellVol: 70,
      };

      const highIdx = baseOffset + 90 + k * 20;
      const hv = highLevels[k];
      // Prior minor low before highIdx so BOS is confirmed on drop
      out[highIdx - 3] = {
        time: tStart + (highIdx - 3) * stepSec,
        open: hv - 1.8 * atrScale,
        high: hv - 1.2 * atrScale,
        low: hv - 2.2 * atrScale,
        close: hv - 1.6 * atrScale,
        tickVolume: 150,
        buyVol: 75,
        sellVol: 75,
      };
      out[highIdx] = {
        time: tStart + highIdx * stepSec,
        open: hv - 0.6 * atrScale,
        high: hv,
        low: hv - 0.9 * atrScale,
        close: hv - 0.7 * atrScale,
        tickVolume: 220,
        buyVol: 70,
        sellVol: 150,
      };
      out[highIdx + 1] = {
        time: tStart + (highIdx + 1) * stepSec,
        open: hv - 0.7 * atrScale,
        high: hv - 0.5 * atrScale,
        low: hv - 3.2 * atrScale,
        close: hv - 2.9 * atrScale, // breaks prior minor low -> BOS confirmed!
        tickVolume: 260,
        buyVol: 70,
        sellVol: 190,
      };
    }
    return out;
  }

  // (a) Verify every timeframe (1m, 3m, 5m, 15m, 30m, 1h, 4h, 1d) returns 3 SELL above + 3 BUY below + debugCounts
  const allTfsFor3Plus3: Array<{ tf: RedSniperTimeframe; bars: number; scale: number; step: number }> = [
    { tf: '1m', bars: 320, scale: 1.5, step: 60 },
    { tf: '3m', bars: 320, scale: 2.5, step: 180 },
    { tf: '5m', bars: 320, scale: 3.5, step: 300 },
    { tf: '15m', bars: 270, scale: 5.5, step: 900 },
    { tf: '30m', bars: 270, scale: 7.5, step: 1800 },
    { tf: '1h', bars: 220, scale: 10.0, step: 3600 },
    { tf: '4h', bars: 220, scale: 18.0, step: 14400 },
    { tf: '1d', bars: 220, scale: 32.0, step: 86400 },
  ];
  for (const item of allTfsFor3Plus3) {
    const tfBars = makeThreePlusThreeBars(item.bars, item.scale, item.step);
    const tfRes = analyzeTimeframe(item.tf, tfBars, 'BULL', 'BULL', 3900);
    const sells = tfRes.zones.filter((z) => z.side === 'SELL');
    const buys = tfRes.zones.filter((z) => z.side === 'BUY');
    assert.equal(
      sells.length,
      3,
      `Expected 3 SELL zones on ${item.tf}, got ${sells.length}`
    );
    assert.equal(
      buys.length,
      3,
      `Expected 3 BUY zones on ${item.tf}, got ${buys.length}`
    );
    assert.equal(tfRes.debugCounts.selectedSell, 3);
    assert.equal(tfRes.debugCounts.selectedBuy, 3);
    assert.ok(tfRes.debugCounts.pivotsFound >= 6);
    assert.ok(tfRes.debugCounts.confirmedPivots >= 6);
  }

  // (b) Verify near-consumed zone with pctLeft < 15 (e.g. pctLeft = 10%) is hidden from chart, list, and bot, and kept in debugAliveZones as 'consumed'
  const nearConsumed10Pct: RedSniperZone = {
    ...freshZone,
    id: '5m-SELL-3900.00-3905.00-10pct',
    bottom: 3900,
    top: 3905,
    proximal: 3900,
    distal: 3905,
    status: 'DEEP',
    retests: 1,
    pctLeft: 10,
    consumed: false, // Even if consumed flag was false, pctLeft < 15 must block bot
    entryConfirmed: true,
    power: 88,
  };
  const stepNearConsumed = stepAutoTraderOnTick(
    demo0,
    3902,
    [nearConsumed10Pct],
    'BEAR',
    'BEAR',
    'LONDON',
    Date.now(),
    DEFAULT_RED_SNIPER_SETTINGS,
    false
  );
  assert.equal(
    stepNearConsumed.nextState.openTrades.length,
    0,
    'Zone with pctLeft < 15 must be ignored by the bot'
  );

  // Also build a candle sequence where a supply zone [4300, 4310] is wicked to 4308.8 (pctLeft = 12% < 15%, 1 retest)
  const barsNearConsumed: Candle[] = [];
  for (let i = 0; i < 6; i++) {
    barsNearConsumed.push({
      time: 5000 + i * 3600,
      open: 4295,
      high: 4298,
      low: 4292,
      close: 4295,
      tickVolume: 120,
      buyVol: 60,
      sellVol: 60,
    });
  }
  // i = 6: Supply pivot [bottom=4300, top=4310] (bodyTop=4300, high=4310)
  barsNearConsumed.push({
    time: 5000 + 6 * 3600,
    open: 4300,
    high: 4310,
    low: 4299,
    close: 4299.5,
    tickVolume: 160,
    buyVol: 60,
    sellVol: 100,
  });
  for (let i = 7; i < 12; i++) {
    barsNearConsumed.push({
      time: 5000 + i * 3600,
      open: 4285,
      high: 4288,
      low: 4280,
      close: 4282, // breaks prior low 4292 -> BOS confirmed
      tickVolume: 180,
      buyVol: 60,
      sellVol: 120,
    });
  }
  // i = 12: Wick reaches 4308.8 inside [4300, 4310] -> 88% penetrated -> pctLeft = 12% (< 15%)!
  barsNearConsumed.push({
    time: 5000 + 12 * 3600,
    open: 4295,
    high: 4308.8,
    low: 4294,
    close: 4298,
    tickVolume: 170,
    buyVol: 85,
    sellVol: 85,
  });
  for (let i = 13; i < 19; i++) {
    barsNearConsumed.push({
      time: 5000 + i * 3600,
      open: 4288,
      high: 4290,
      low: 4284,
      close: 4286,
      tickVolume: 130,
      buyVol: 65,
      sellVol: 65,
    });
  }
  const analNearConsumed = analyzeTimeframe('1h', barsNearConsumed, 'BEAR', 'BEAR', 4286, {
    ...DEFAULT_RED_SNIPER_SETTINGS,
    heightCapAtr: 3.0,
    showConsumedZones: false,
  });
  const debugNearConsumed = analNearConsumed.debugAliveZones.find(
    (d) => d.side === 'SELL' && Math.abs(d.top - 4310) < 0.05
  );
  assert.ok(
    debugNearConsumed &&
      debugNearConsumed.pctLeft > 0 &&
      debugNearConsumed.pctLeft < 15 &&
      debugNearConsumed.consumed === true &&
      debugNearConsumed.reasonDropped === 'consumed',
    `Zone with 0 < pctLeft < 15 (got ${debugNearConsumed?.pctLeft}%) must be marked consumed=true and reasonDropped="consumed" in debugAliveZones`
  );
  assert.equal(
    analNearConsumed.zones.some((z) => Math.abs(z.top - 4310) < 0.05),
    false,
    'Zone with pctLeft < 15 must be hidden from zones list'
  );
  assert.equal(
    analNearConsumed.chartZones.some((z) => Math.abs(z.top - 4310) < 0.05),
    false,
    'Zone with pctLeft < 15 must be hidden from chartZones'
  );
  assert.ok(
    analNearConsumed.debugCounts.consumedHidden >= 1,
    'debugCounts.consumedHidden must count near-consumed zones'
  );

  // (c) Verify strict A+ rules:
  //     Give "A+" only when ALL are true:
  //     - same side overlap with a HIGHER timeframe zone (15m/30m/1h/4h, strictly higher than current TF)
  //     - pctLeft >= 50
  //     - retests <= 1
  //     Power +6 only for A+.
  const allTfsBars: RedSniperBarsMap = {
    '1m': makeThreePlusThreeBars(320, 1.5, 60),
    '3m': makeThreePlusThreeBars(320, 1.5, 180),
    '5m': makeThreePlusThreeBars(320, 1.5, 300),
    '15m': makeThreePlusThreeBars(270, 1.5, 900),
    '30m': makeThreePlusThreeBars(270, 1.5, 1800),
    '1h': makeThreePlusThreeBars(220, 1.5, 3600),
    '4h': makeThreePlusThreeBars(220, 1.5, 14400),
    '1d': makeThreePlusThreeBars(220, 1.5, 86400),
  };
  const fullMultiTf = analyzeAllTimeframes(allTfsBars, 3900, DEFAULT_RED_SNIPER_SETTINGS);
  const standalone5m = analyzeTimeframe(
    '5m',
    allTfsBars['5m'],
    fullMultiTf.verdict.bias1h,
    fullMultiTf.verdict.bias4h,
    3900
  );

  const aPlusZones5m = fullMultiTf.byTf['5m'].zones.filter((z) => z.isAPlus);
  assert.ok(
    aPlusZones5m.length > 0,
    '5m zones overlapping same-side 15m/30m/1h/4h zones with pctLeft >= 50 and retests <= 1 must receive A+'
  );
  for (const az of aPlusZones5m) {
    assert.ok(az.pctLeft >= 50, 'A+ zone must have pctLeft >= 50');
    assert.ok(az.retests <= 1, 'A+ zone must have retests <= 1');
    const baseZone = standalone5m.zones.find((bz) => bz.id === az.id);
    if (baseZone) {
      assert.equal(
        az.power,
        Math.min(99, baseZone.power + 6),
        'A+ zone must receive +6 power boost (capped at 99)'
      );
    }
  }
  // 4h has no higher timeframe in (15m/30m/1h/4h), and 1d is higher than 4h, so neither 4h nor 1d can get A+
  assert.equal(
    fullMultiTf.byTf['4h'].zones.some((z) => z.isAPlus),
    false,
    '4h zones cannot get A+ because no higher TF exists in 15m/30m/1H/4H'
  );
  assert.equal(
    fullMultiTf.byTf['1d'].zones.some((z) => z.isAPlus),
    false,
    '1d zones cannot get A+ because 1d is above 15m/30m/1H/4H'
  );

  console.log(
    '✓ Test 13 passed: Frozen "zones-v3" snapshot, 3+3 per TF + debugCounts, pctLeft < 15 hidden, strict A+ rules (+6 power), candle store, replay window, and BOT LOG verified'
  );
}

// ============================================================================
// TEST 14: Minor pass (L=3 for 1m-5m & 15m-30m, L=2 for 1H+) always runs for
//          the nearest slot on each side so swings from the last 10 candles form minor zones (max 3/side)
// ============================================================================
function testMinorPassNearestSlotFromLast10Candles(): void {
  assert.equal(getMinorPivotLengthForTf('1m'), 3);
  assert.equal(getMinorPivotLengthForTf('3m'), 3);
  assert.equal(getMinorPivotLengthForTf('5m'), 3);
  assert.equal(getMinorPivotLengthForTf('15m'), 3);
  assert.equal(getMinorPivotLengthForTf('30m'), 3);
  assert.equal(getMinorPivotLengthForTf('1h'), 2);
  assert.equal(getMinorPivotLengthForTf('4h'), 2);
  assert.equal(getMinorPivotLengthForTf('1d'), 2);

  // Build 120 bars on 1m (primaryL=10, minorL=3) that ALREADY have 3 primary SELL zones
  // and 3 primary BUY zones, plus a recent swing high and swing low inside the last 10 closed candles
  // (where primaryL=10 cannot form a pivot because < 10 bars exist to the right, but minorL=3 can!).
  const bars: Candle[] = [];
  const t0 = 1711929600;
  const mid = 3900;
  for (let i = 0; i < 120; i++) {
    bars.push({
      time: t0 + i * 60,
      open: mid,
      high: mid + 0.5,
      low: mid - 0.5,
      close: mid,
      tickVolume: 140,
      buyVol: 70,
      sellVol: 70,
    });
  }

  // 3 primary BUY zones below 3900 (at 3860, 3870, 3880) and 3 primary SELL zones above 3900 (at 3940, 3930, 3920)
  const primaryBuyLevels = [3860, 3870, 3880];
  const primarySellLevels = [3940, 3930, 3920];
  for (let k = 0; k < 3; k++) {
    const bIdx = 15 + k * 16;
    const bv = primaryBuyLevels[k];
    bars[bIdx - 3] = {
      time: t0 + (bIdx - 3) * 60,
      open: bv + 3,
      high: bv + 4,
      low: bv + 2,
      close: bv + 3,
      tickVolume: 150,
      buyVol: 75,
      sellVol: 75,
    };
    bars[bIdx] = {
      time: t0 + bIdx * 60,
      open: bv + 0.8,
      high: bv + 1.2,
      low: bv,
      close: bv + 0.9,
      tickVolume: 220,
      buyVol: 150,
      sellVol: 70,
    };
    bars[bIdx + 1] = {
      time: t0 + (bIdx + 1) * 60,
      open: bv + 0.9,
      high: bv + 6,
      low: bv + 0.6,
      close: bv + 5.5,
      tickVolume: 250,
      buyVol: 180,
      sellVol: 70,
    };

    const sIdx = 62 + k * 14;
    const sv = primarySellLevels[k];
    bars[sIdx - 3] = {
      time: t0 + (sIdx - 3) * 60,
      open: sv - 3,
      high: sv - 2,
      low: sv - 4,
      close: sv - 3,
      tickVolume: 150,
      buyVol: 75,
      sellVol: 75,
    };
    bars[sIdx] = {
      time: t0 + sIdx * 60,
      open: sv - 0.8,
      high: sv,
      low: sv - 1.2,
      close: sv - 0.9,
      tickVolume: 220,
      buyVol: 70,
      sellVol: 150,
    };
    bars[sIdx + 1] = {
      time: t0 + (sIdx + 1) * 60,
      open: sv - 0.9,
      high: sv - 0.6,
      low: sv - 6,
      close: sv - 5.5,
      tickVolume: 250,
      buyVol: 70,
      sellVol: 180,
    };
  }

  // Closed bars are indices 0..118 (last closed index = 118).
  // Place a swing low at idx = 111 (7 bars before 118 -> inside last 10 candles, low = 3893.0, height = 1.6 >= 0.5*ATR)
  // and a swing high at idx = 115 (3 bars before 118 -> inside last 10 candles, high = 3907.0, height = 1.6 >= 0.5*ATR).
  bars[111] = {
    time: t0 + 111 * 60,
    open: 3894.6,
    high: 3895.2,
    low: 3893.0,
    close: 3894.7,
    tickVolume: 190,
    buyVol: 120,
    sellVol: 70,
  };
  bars[115] = {
    time: t0 + 115 * 60,
    open: 3905.4,
    high: 3907.0,
    low: 3904.8,
    close: 3905.3,
    tickVolume: 190,
    buyVol: 70,
    sellVol: 120,
  };

  const audit = findZonesWithAudit(bars, '1m', { livePrice: 3900 });
  const sells = audit.selected.filter((z) => z.supply);
  const buys = audit.selected.filter((z) => !z.supply);

  assert.equal(sells.length, 3, 'Must keep max 3 SELL zones');
  assert.equal(buys.length, 3, 'Must keep max 3 BUY zones');

  const recentSell = sells.find((z) => z.startIdx === 115);
  const recentBuy = buys.find((z) => z.startIdx === 111);
  assert.ok(
    recentSell && recentSell.minor === true,
    'Swing high in the last 10 candles must be detected by minor pass (L=3), tagged minor=true, and take the nearest SELL slot'
  );
  assert.ok(
    recentBuy && recentBuy.minor === true,
    'Swing low in the last 10 candles must be detected by minor pass (L=3), tagged minor=true, and take the nearest BUY slot'
  );

  console.log(
    '✓ Test 14 passed: Minor pass (L=3 for 1m-30m, L=2 for 1H+) always runs for nearest slot so swings in last 10 candles form minor zones (max 3/side)'
  );
}

// ============================================================================
// TEST 15: deadCount includes dead zones from fill / minor passes
// ============================================================================
function testDeadCountIncludesFillPasses(): void {
  // Build 40 bars on 1m (primaryL=10, minorL=3) where a minor swing high at idx=31 (within last 8 closed bars,
  // so primary pass L=10 cannot detect it, only minor pass L=3 detects it) is broken by a close at idx=36.
  const bars: Candle[] = [];
  const t0 = 1711929600;
  for (let i = 0; i < 40; i++) {
    bars.push({
      time: t0 + i * 60,
      open: 3900,
      high: 3901,
      low: 3899,
      close: 3900,
      tickVolume: 120,
      buyVol: 60,
      sellVol: 60,
    });
  }
  // Minor swing high at idx = 31 (high = 3906, surrounded by 3901 on 28..30 and 32..34)
  bars[31] = {
    time: t0 + 31 * 60,
    open: 3905,
    high: 3906,
    low: 3904,
    close: 3905.2,
    tickVolume: 150,
    buyVol: 70,
    sellVol: 80,
  };
  // At idx = 36, candle closes at 3912 (well above 3906 + 0.25*ATR), killing the minor zone!
  bars[36] = {
    time: t0 + 36 * 60,
    open: 3905,
    high: 3913,
    low: 3904,
    close: 3912,
    tickVolume: 200,
    buyVol: 140,
    sellVol: 60,
  };

  const primaryOnly = findZonesWithAudit(bars, '1m', { enableWeakRetry: false });
  const withMinorFill = findZonesWithAudit(bars, '1m', { enableWeakRetry: true });

  assert.equal(primaryOnly.debugCounts.deadCount, 0, 'Primary pass (L=10) has 0 dead zones at idx=31');
  assert.ok(
    withMinorFill.debugCounts.deadCount >= 1 &&
      withMinorFill.deadBeforeSelection.some((d) => d.startIdx === 31 && d.dead === true),
    'deadCount and deadBeforeSelection must include dead zones from the minor/fill pass'
  );

  console.log(
    `✓ Test 15 passed: deadCount (${withMinorFill.debugCounts.deadCount}) includes dead zones from minor/fill passes`
  );
}

// ============================================================================
// TEST 16: formingCandleIncluded parameter (default true slices last candle; false keeps all closed bars)
// ============================================================================
function testFormingCandleIncludedParameter(): void {
  // Build 20 bars for 1h (minorL = 2).
  // Place a minor swing high at idx = 17 (which is totalBars - 3 = 20 - 3 = 17).
  // For L = 2, a pivot at idx = 17 needs 2 bars to its right: idx = 18 and idx = 19!
  // - When formingCandleIncluded = true (default), idx = 19 is sliced off, so closedBars has indices 0..18
  //   (only 1 bar to the right of idx = 17) -> idx = 17 cannot be a L=2 pivot yet!
  // - When formingCandleIncluded = false, all 20 bars (0..19) are treated as closed -> idx = 17 has 2 bars to its right and IS detected!
  const bars: Candle[] = [];
  const t0 = 1711929600;
  for (let i = 0; i < 20; i++) {
    bars.push({
      time: t0 + i * 3600,
      open: 3900,
      high: 3901,
      low: 3899,
      close: 3900,
      tickVolume: 120,
      buyVol: 60,
      sellVol: 60,
    });
  }
  bars[17] = {
    time: t0 + 17 * 3600,
    open: 3907,
    high: 3909,
    low: 3906,
    close: 3907.5,
    tickVolume: 180,
    buyVol: 70,
    sellVol: 110,
  };

  const defaultIncluded = findZonesWithAudit(bars, '1h'); // formingCandleIncluded defaults to true
  const closedOnlyFalse = findZonesWithAudit(bars, '1h', {
    formingCandleIncluded: false,
  });

  assert.equal(
    defaultIncluded.selected.some((z) => z.startIdx === 17),
    false,
    'With formingCandleIncluded=true (default), last bar (idx=19) is sliced so idx=17 is not yet a 2-bar pivot'
  );
  assert.equal(
    closedOnlyFalse.selected.some((z) => z.startIdx === 17),
    true,
    'With formingCandleIncluded=false, all passed bars are kept without slicing the last candle so idx=17 forms a zone'
  );

  console.log(
    '✓ Test 16 passed: formingCandleIncluded (default true vs false for replay closed-only bars) verified'
  );
}

// ============================================================================
// TEST 17: Noise minor zone loses nearest slot (height < 0.5*ATR, disp < 1.0*ATR,
//          or pctLeft < 50) & auto-trader ignores minor zones unless bosConfirmed=true
// ============================================================================
function testNoiseMinorZoneLosesNearestSlotAndBotRequiresBos(): void {
  const t0 = 1711929600;
  const mid = 3900;
  const bars: Candle[] = [];
  for (let i = 0; i < 120; i++) {
    bars.push({
      time: t0 + i * 60,
      open: mid,
      high: mid + 1.0,
      low: mid - 1.0,
      close: mid,
      tickVolume: 140,
      buyVol: 70,
      sellVol: 70,
    });
  }

  // Place 3 primary BUY zones below 3900 (at 3860, 3870, 3880) and 3 primary SELL zones above 3900 (at 3940, 3930, 3920)
  const primaryBuyLevels = [3860, 3870, 3880];
  const primarySellLevels = [3940, 3930, 3920];
  for (let k = 0; k < 3; k++) {
    const bIdx = 15 + k * 16;
    const bv = primaryBuyLevels[k];
    bars[bIdx - 3] = {
      time: t0 + (bIdx - 3) * 60,
      open: bv + 3,
      high: bv + 4,
      low: bv + 2,
      close: bv + 3,
      tickVolume: 150,
      buyVol: 75,
      sellVol: 75,
    };
    bars[bIdx] = {
      time: t0 + bIdx * 60,
      open: bv + 1.4,
      high: bv + 1.8,
      low: bv,
      close: bv + 1.5,
      tickVolume: 220,
      buyVol: 150,
      sellVol: 70,
    };
    bars[bIdx + 1] = {
      time: t0 + (bIdx + 1) * 60,
      open: bv + 1.5,
      high: bv + 6,
      low: bv + 0.8,
      close: bv + 5.5,
      tickVolume: 250,
      buyVol: 180,
      sellVol: 70,
    };

    const sIdx = 62 + k * 14;
    const sv = primarySellLevels[k];
    bars[sIdx - 3] = {
      time: t0 + (sIdx - 3) * 60,
      open: sv - 3,
      high: sv - 2,
      low: sv - 4,
      close: sv - 3,
      tickVolume: 150,
      buyVol: 75,
      sellVol: 75,
    };
    bars[sIdx] = {
      time: t0 + sIdx * 60,
      open: sv - 1.4,
      high: sv,
      low: sv - 1.8,
      close: sv - 1.5,
      tickVolume: 220,
      buyVol: 70,
      sellVol: 150,
    };
    bars[sIdx + 1] = {
      time: t0 + (sIdx + 1) * 60,
      open: sv - 1.5,
      high: sv - 0.8,
      low: sv - 6,
      close: sv - 5.5,
      tickVolume: 250,
      buyVol: 70,
      sellVol: 180,
    };
  }

  // Case A: Noise minor swing low at idx=111 with tiny height (0.35 < 0.5*ATR)
  // and noise minor swing high at idx=115 with weak displacement (< 1.0*ATR: high=3901.8, subsequent lows only reach 3900.8 -> move = 1.0 < 1.0*ATR ~ 2.0)
  bars[111] = {
    time: t0 + 111 * 60,
    open: 3895.35,
    high: 3895.8,
    low: 3895.0, // rawHeight = 0.35 (< 0.5 * ATR)
    close: 3895.4,
    tickVolume: 150,
    buyVol: 80,
    sellVol: 70,
  };
  bars[115] = {
    time: t0 + 115 * 60,
    open: 3900.4,
    high: 3901.6, // rawHeight = 1.2 (>= 0.5 * ATR), but subsequent bars 116..118 only dip to 3900.7 (displacement = 0.9 < 1.0 * ATR)
    low: 3900.2,
    close: 3900.5,
    tickVolume: 150,
    buyVol: 70,
    sellVol: 80,
  };
  for (let j = 116; j <= 118; j++) {
    bars[j] = {
      time: t0 + j * 60,
      open: 3900.9,
      high: 3901.2,
      low: 3900.7,
      close: 3900.8,
      tickVolume: 130,
      buyVol: 65,
      sellVol: 65,
    };
  }

  const audit = findZonesWithAudit(bars, '1m', { livePrice: 3900 });
  const sells = audit.selected.filter((z) => z.supply);
  const buys = audit.selected.filter((z) => !z.supply);

  assert.equal(sells.length, 3, 'Must still select 3 SELL zones');
  assert.equal(buys.length, 3, 'Must still select 3 BUY zones');
  assert.equal(
    buys.some((z) => z.startIdx === 111),
    false,
    'Noise minor BUY zone (height < 0.5*ATR) must NOT win the nearest slot when 3 primary BUY zones exist'
  );
  assert.equal(
    sells.some((z) => z.startIdx === 115),
    false,
    'Noise minor SELL zone (displacement < 1.0*ATR) must NOT win the nearest slot when 3 primary SELL zones exist'
  );

  // Also verify that if fewer than 3 primary zones exist on a side, a noise minor zone CAN still fill remaining slots
  const sparseBars = bars.map((b, idx) =>
    idx < 105
      ? {
          time: b.time,
          open: mid,
          high: mid + 1.0,
          low: mid - 1.0,
          close: mid,
          tickVolume: 140,
          buyVol: 70,
          sellVol: 70,
        }
      : b
  );
  const sparseAudit = findZonesWithAudit(sparseBars, '1m', { livePrice: 3900 });
  assert.equal(
    sparseAudit.selected.some((z) => z.startIdx === 111 && z.minor === true),
    true,
    'Noise minor zone may still fill remaining slots when < 3 primary zones exist'
  );

  // Verify auto-trader ignores minor zones unless bosConfirmed = true
  const baseDemoState: RedSniperDemoState = {
    balance: 1000,
    autoEnabled: true,
    openTrades: [],
    closedTrades: [],
    usedZoneIds: [],
  };

  const tfSample = analyzeTimeframe('1m', bars, 'BULL', 'BULL', 3900);
  const sampleZone = tfSample.zones[0];
  assert.ok(sampleZone, 'Expected at least one RedSniperZone from analyzeTimeframe');

  const unconfirmedMinorZone: RedSniperZone = {
    ...sampleZone,
    id: 'minor-unconfirmed-buy',
    tf: '5m',
    side: 'BUY',
    status: 'FRESH',
    top: 3901,
    bottom: 3899,
    proximal: 3901,
    distal: 3899,
    width: 2,
    retests: 0,
    independentRetests: 0,
    touchCandles: 0,
    pctLeft: 100,
    consumed: false,
    sweep: false,
    power: 85,
    bosConfirmed: false,
    minor: true,
    distancePts: 0,
    isFar: false,
  };

  const stepUnconfirmed = stepAutoTraderOnTick(
    baseDemoState,
    3900,
    [unconfirmedMinorZone],
    'BULL',
    'BULL',
    'LONDON',
    Date.now(),
    DEFAULT_RED_SNIPER_SETTINGS,
    false
  );
  assert.equal(
    stepUnconfirmed.nextState.openTrades.length,
    0,
    'Auto trader must NEVER enter a minor zone when bosConfirmed is false'
  );

  const confirmedMinorZone: RedSniperZone = {
    ...unconfirmedMinorZone,
    id: 'minor-confirmed-buy',
    bosConfirmed: true,
  };
  const stepConfirmed = stepAutoTraderOnTick(
    baseDemoState,
    3900,
    [confirmedMinorZone],
    'BULL',
    'BULL',
    'LONDON',
    Date.now(),
    DEFAULT_RED_SNIPER_SETTINGS,
    false
  );
  assert.equal(
    stepConfirmed.nextState.openTrades.length,
    1,
    'Auto trader MAY enter a minor zone when bosConfirmed is true'
  );

  console.log(
    '✓ Test 17 passed: Noise minor zone loses nearest slot (fills remaining slots only) & auto-trader requires bosConfirmed=true for minor zones'
  );
}

// ============================================================================
// TEST 18: Zone cache per (tf, lastClosedCandleTime, settingsHash) returns
//          identical result between live ticks without rescanning
// ============================================================================
function testZoneCacheBetweenLiveTicks(): void {
  const t0 = 1711929600;
  const bars: Candle[] = [];
  for (let i = 0; i < 60; i++) {
    const wave = Math.sin(i * 0.35) * 8;
    bars.push({
      time: t0 + i * 300,
      open: 3900 + wave,
      high: 3902 + wave,
      low: 3898 + wave,
      close: 3900.5 + wave,
      tickVolume: 150,
      buyVol: 75,
      sellVol: 75,
    });
  }

  resetZoneCacheStats();

  // First tick on 5m: cache miss -> computes zones
  const tick1 = analyzeTimeframe(
    '5m',
    bars,
    'BULL',
    'BULL',
    3900.0,
    DEFAULT_RED_SNIPER_SETTINGS
  );
  const statsAfterTick1 = getZoneCacheStats();
  assert.equal(
    statsAfterTick1.misses,
    1,
    'First call for (tf, lastClosedCandleTime, settings) must be a cache miss'
  );
  assert.equal(statsAfterTick1.hits, 0, 'Zero cache hits on first call');

  // Second tick: forming candle (last bar) mutates & livePrice moves to 3904.25, but last CLOSED candle (bars[bars.length-2]) is unchanged
  const barsTick2 = bars.slice();
  barsTick2[barsTick2.length - 1] = {
    ...barsTick2[barsTick2.length - 1],
    high: 3910,
    close: 3904.25,
    tickVolume: 290,
  };
  const tick2 = analyzeTimeframe(
    '5m',
    barsTick2,
    'BULL',
    'BULL',
    3904.25,
    DEFAULT_RED_SNIPER_SETTINGS
  );
  const statsAfterTick2 = getZoneCacheStats();
  assert.equal(
    statsAfterTick2.misses,
    1,
    'Must NOT rescan when forming candle/livePrice changes on same closed candle'
  );
  assert.ok(statsAfterTick2.hits >= 1, 'Must hit cache on second tick');

  // Zone IDs, bounds, power, and retests are identical, while distancePts updates for livePrice
  assert.deepEqual(
    tick2.zones.map((z) => ({
      id: z.id,
      top: z.top,
      bottom: z.bottom,
      power: z.power,
      retests: z.retests,
    })),
    tick1.zones.map((z) => ({
      id: z.id,
      top: z.top,
      bottom: z.bottom,
      power: z.power,
      retests: z.retests,
    })),
    'Cached zones between ticks must have identical IDs, bounds, power, and retests'
  );
  if (tick1.zones.length > 0) {
    const z1 = tick1.zones[0];
    const z2 = tick2.zones[0];
    const expectedDist2 =
      3904.25 > z2.top
        ? 3904.25 - z2.top
        : 3904.25 < z2.bottom
        ? z2.bottom - 3904.25
        : 0;
    assert.ok(
      Math.abs(z2.distancePts - expectedDist2) < 1e-6,
      'livePrice must still dynamically update distancePts on cached zones'
    );
    assert.notEqual(
      z1.distancePts,
      z2.distancePts,
      'distancePts must reflect the new livePrice'
    );
  }

  // Direct findZonesWithAudit call with the same closed candle + settings also hits cache and returns identical audit reference
  const auditA = findZonesWithAudit(bars, '5m', { livePrice: 3900.0 });
  const hitsBeforeAuditB = getZoneCacheStats().hits;
  const auditB = findZonesWithAudit(barsTick2, '5m', { livePrice: 3904.25 });
  const statsAfterAuditB = getZoneCacheStats();
  assert.ok(
    statsAfterAuditB.hits > hitsBeforeAuditB,
    'findZonesWithAudit must hit zoneAuditCache between ticks'
  );
  assert.equal(
    auditA.selected,
    auditB.selected,
    'findZonesWithAudit cache hit returns identical selected array'
  );

  // Changing settings (e.g. heightCapAtr) triggers a recompute (cache miss)
  const missesBeforeSettingsChange = getZoneCacheStats().misses;
  analyzeTimeframe('5m', barsTick2, 'BULL', 'BULL', 3904.25, {
    ...DEFAULT_RED_SNIPER_SETTINGS,
    heightCapAtr: 1.5,
  });
  assert.ok(
    getZoneCacheStats().misses > missesBeforeSettingsChange,
    'Changing settings must invalidate cache key and recompute'
  );

  // Closing a new candle triggers a recompute (cache miss)
  const missesBeforeNewCandle = getZoneCacheStats().misses;
  const barsNewCandle = [
    ...barsTick2,
    {
      time: t0 + 60 * 300,
      open: 3904.25,
      high: 3905,
      low: 3903,
      close: 3904.5,
      tickVolume: 110,
      buyVol: 55,
      sellVol: 55,
    },
  ];
  analyzeTimeframe(
    '5m',
    barsNewCandle,
    'BULL',
    'BULL',
    3904.5,
    DEFAULT_RED_SNIPER_SETTINGS
  );
  assert.ok(
    getZoneCacheStats().misses > missesBeforeNewCandle,
    'Closing a new candle must change lastClosedCandleTime key and recompute'
  );

  console.log(
    '✓ Test 18 passed: Zone cache per (tf, lastClosedCandleTime, settingsHash) avoids rescan between ticks and updates distancePts/isFar'
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
  testMinorPassNearestSlotFromLast10Candles();
  testDeadCountIncludesFillPasses();
  testFormingCandleIncludedParameter();
  testNoiseMinorZoneLosesNearestSlotAndBotRequiresBos();
  testZoneCacheBetweenLiveTicks();
  await runAllStorageTests();
  await printLiveXauusdZonesTable();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
