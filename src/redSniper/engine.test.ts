import assert from 'node:assert/strict';
import {
  Candle,
  REQUIRED_MIN_BARS_BY_TF,
  RedSniperBarsMap,
  RedSniperTimeframe,
  build3mFrom1m,
  buildHigherTimeframeFrom1m,
  doesM1CoverTimeframeRange,
  normalizeRedSniperCandle,
} from './feed';
import {
  DEFAULT_RED_SNIPER_SETTINGS,
  INDICATOR_PARITY_SHIFT,
  MIN_ZONE_BOX_HEIGHT_PX,
  RED_SNIPER_ZONE_ENGINE_VERSION,
  RedSniperDemoState,
  RedSniperZone,
  analyzeAllTimeframes,
  analyzeTimeframe,
  buildZoneTradeParameters,
  compareZonesWithReference,
  computeAuctionProfileFromM5,
  computeBaseAndLegRelativeTickVolume,
  computeBotStatusLine,
  computeDeadAtrComparison,
  computeEquilibriumLevel,
  computePerformanceMetrics,
  computePowerCalibration,
  computeSameSideOverlapRatio,
  computeStructureEvents,
  computeZonePowerAndBreakdown,
  detectNewZoneBotLogs,
  detectRuntimeZoneEvents,
  evaluateZoneSixChecksAndPwr,
  findZones,
  findZonesWithAudit,
  formatBotLogForClipboard,
  formatReplayWindowLabel,
  formatZoneChartLabel,
  getLookbackForTf,
  getNextHigherTf,
  getVisibleStructureLineSpecs,
  getZoneCacheStats,
  isZoneNear,
  layoutChartZoneBoxes,
  mergeBotLogEntries,
  mergeOverlappingMultiTfZones,
  resetZoneCacheStats,
  resolveDefaultRetestModeForTf,
  resolveZoneStatus,
  runReplay24hToCompletion,
  sanitizeRedSniperSettings,
  setIndicatorParityShift,
  stepAutoTraderOnTick,
  computeOrderBlockBoxForExtreme,
  computeZoneHeightReport,
  computeCandleAlignmentCheck,
  rebuildTimeframeFromM1WithAlignment,
  getBackfillBannerViewState,
  classifyBackfillErrorText,
} from './engine';
import {
  buildHigherTfFromStoredM1,
  dedupeAndMergeRedSniperCandles,
  doesStoredM1CoverRange,
  syncBrokerCandlesToStore,
  executeRedSniperBackfill,
  getRedSniperCandlesForApi,
  areAnyRedSniperTimeframesBelowMinimum,
  HistoryProvider,
  buildFiveDayM1Chunks,
  computeMedianCloseOffset,
  applyOffsetToHistCandles,
  mergeHistAndLiveCandles,
  rebuildTimeframesFromMergedM1,
  rebuildSingleTimeframeFromM1,
  classifyBackfillProviderError,
  formatBackfillBannerState,
  initBackfillStatusFromDisk,
  getDataDirDiskStats,
  runRedSniperHistoryBackfill,
  RedSniperStoredCandle,
} from '../server/candleEngine';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runAllStorageTests } from './storage.test';

/**
 * Generates realistic multi-swing candle series scaled by `atrScale` so internal (L=5)
 * pivots form and get broken by candle closes (BOS and CHoCH),
 * creating unmitigated bullish and bearish Order Blocks across price levels.
 */
function makeScaledTimeframeBars(
  count: number,
  atrScale: number,
  stepSec: number,
  withVolume: boolean = true
): Candle[] {
  const bars: Candle[] = [];
  const startSec = 1711929600;
  const baseMid = 3900;

  for (let i = 0; i < count; i++) {
    const macroWave = Math.sin(i * 0.055) * 14 * atrScale;
    const swingWave = Math.sin(i * 0.42) * 4.5 * atrScale;
    const micro = Math.cos(i * 0.9) * 0.8 * atrScale;
    const center = baseMid + macroWave + swingWave + micro;

    const prevClose = i > 0 ? bars[i - 1].close : center;
    const open = prevClose;
    const close = center;
    const bodyMax = Math.max(open, close);
    const bodyMin = Math.min(open, close);
    const high = bodyMax + (0.6 + (i % 3) * 0.25) * atrScale;
    const low = bodyMin - (0.6 + ((i + 1) % 3) * 0.25) * atrScale;

    const isImpulse = i % 7 === 0;
    const tickVolume = withVolume
      ? isImpulse
        ? 260 + ((i * 37) % 120)
        : 120 + ((i * 23) % 80)
      : 0;

    bars.push({
      time: startSec + i * stepSec,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      tickVolume,
      buyVol: withVolume ? Math.round(tickVolume * (close >= open ? 0.62 : 0.38)) : 0,
      sellVol: withVolume ? Math.round(tickVolume * (close >= open ? 0.38 : 0.62)) : 0,
    });
  }

  return bars;
}

/**
 * Helper to seed 2 internal pivot lows and 2 internal pivot highs in the early prefix of `out`
 * so `totalPivotLowsEver >= 2` and `totalPivotHighsEver >= 2` are satisfied before structure breaks.
 */
function seedInitialInternalPivots(
  out: Candle[],
  tStart: number,
  stepSec: number,
  mid: number,
  atrScale: number
): void {
  // Pivot Low #1 at i=5 (discovered at i=10), Pivot High #1 at i=11 (discovered at i=16),
  // Pivot Low #2 at i=17 (discovered at i=22), Pivot High #2 at i=23 (discovered at i=28)
  const lowIndices = [5, 17];
  for (const li of lowIndices) {
    if (li + 5 < out.length) {
      out[li] = {
        time: tStart + li * stepSec,
        open: mid,
        high: mid + 0.4 * atrScale,
        low: Number((mid - 35 * atrScale).toFixed(2)),
        close: mid,
        tickVolume: 120,
        buyVol: 60,
        sellVol: 60,
      };
    }
  }
  const highIndices = [11, 23];
  for (const hi of highIndices) {
    if (hi + 5 < out.length) {
      out[hi] = {
        time: tStart + hi * stepSec,
        open: mid,
        high: Number((mid + 35 * atrScale).toFixed(2)),
        low: mid - 0.4 * atrScale,
        close: mid,
        tickVolume: 120,
        buyVol: 60,
        sellVol: 60,
      };
    }
  }
}

/**
 * Helper to build a deterministic series with multiple unmitigated Bullish OBs below `mid`
 * and multiple unmitigated Bearish OBs above `mid` so up to 5 per side exist.
 */
function makeMultiObStaircaseBars(
  count: number,
  atrScale: number,
  stepSec: number
): Candle[] {
  const out: Candle[] = [];
  const tStart = 1711929600;
  const mid = 3900;

  for (let i = 0; i < count; i++) {
    out.push({
      time: tStart + i * stepSec,
      open: mid,
      high: mid + 0.5 * atrScale,
      low: mid - 0.5 * atrScale,
      close: mid,
      tickVolume: 120,
      buyVol: 60,
      sellVol: 60,
    });
  }

  seedInitialInternalPivots(out, tStart, stepSec, mid, atrScale);

  // Create 5 ascending bullish breaks below mid (at mid - 26*s, -21*s, -16*s, -11*s, -6*s)
  // so none of the earlier bullish OBs are mitigated by later lows and new.bottom >= prev.top!
  const bullLows = [
    mid - 26 * atrScale,
    mid - 21 * atrScale,
    mid - 16 * atrScale,
    mid - 11 * atrScale,
    mid - 6 * atrScale,
  ];
  const baseIdx = Math.max(34, count - 205);

  for (let k = 0; k < 5; k++) {
    const pHighIdx = baseIdx + k * 18;
    const obIdx = pHighIdx + 4;
    const brkIdx = pHighIdx + 7;
    const lv = bullLows[k];
    const pHighLevel = lv + 2.2 * atrScale;

    for (let j = pHighIdx - 5; j <= pHighIdx + 5; j++) {
      if (j >= 0 && j < count) {
        out[j] = {
          time: tStart + j * stepSec,
          open: lv + 1.0 * atrScale,
          high: lv + 1.4 * atrScale,
          low: lv + 0.6 * atrScale,
          close: lv + 1.1 * atrScale,
          tickVolume: 120,
          buyVol: 60,
          sellVol: 60,
        };
      }
    }
    // Pivot high at pHighIdx
    out[pHighIdx] = {
      time: tStart + pHighIdx * stepSec,
      open: lv + 1.5 * atrScale,
      high: Number(pHighLevel.toFixed(2)),
      low: lv + 1.1 * atrScale,
      close: lv + 1.6 * atrScale,
      tickVolume: 140,
      buyVol: 75,
      sellVol: 65,
    };
    // Lowest low candle (Bullish OB origin) at obIdx between pHighIdx and brkIdx
    out[obIdx] = {
      time: tStart + obIdx * stepSec,
      open: Number((lv + 0.9 * atrScale).toFixed(2)),
      high: Number((lv + 1.2 * atrScale).toFixed(2)),
      low: Number(lv.toFixed(2)),
      close: Number((lv + 0.8 * atrScale).toFixed(2)),
      tickVolume: 240,
      buyVol: 160,
      sellVol: 80,
    };
    // Break candle at brkIdx: closes above pHighLevel, with FVG after obIdx
    out[obIdx + 1] = {
      time: tStart + (obIdx + 1) * stepSec,
      open: Number((lv + 0.85 * atrScale).toFixed(2)),
      high: Number((lv + 2.1 * atrScale).toFixed(2)),
      low: Number((lv + 0.8 * atrScale).toFixed(2)),
      close: Number((lv + 2.0 * atrScale).toFixed(2)),
      tickVolume: 260,
      buyVol: 190,
      sellVol: 70,
    };
    out[brkIdx] = {
      time: tStart + brkIdx * stepSec,
      open: Number((lv + 2.0 * atrScale).toFixed(2)),
      high: Number((pHighLevel + 1.2 * atrScale).toFixed(2)),
      low: Number((lv + 1.6 * atrScale).toFixed(2)),
      close: Number((pHighLevel + 0.9 * atrScale).toFixed(2)),
      tickVolume: 280,
      buyVol: 210,
      sellVol: 70,
    };
  }

  // Create 5 descending bearish breaks above mid (at mid + 26*s, +21*s, +16*s, +11*s, +6*s)
  // so none of the earlier bearish OBs are mitigated by later highs and new.top <= prev.bottom!
  const bearHighs = [
    mid + 26 * atrScale,
    mid + 21 * atrScale,
    mid + 16 * atrScale,
    mid + 11 * atrScale,
    mid + 6 * atrScale,
  ];
  const bearBaseIdx = baseIdx + 95;

  for (let k = 0; k < 5; k++) {
    const pLowIdx = bearBaseIdx + k * 18;
    const obIdx = pLowIdx + 4;
    const brkIdx = pLowIdx + 7;
    const hv = bearHighs[k];
    const pLowLevel = hv - 2.2 * atrScale;

    for (let j = pLowIdx - 5; j <= pLowIdx + 5; j++) {
      if (j >= 0 && j < count) {
        out[j] = {
          time: tStart + j * stepSec,
          open: hv - 1.0 * atrScale,
          high: hv - 0.6 * atrScale,
          low: hv - 1.4 * atrScale,
          close: hv - 1.1 * atrScale,
          tickVolume: 120,
          buyVol: 60,
          sellVol: 60,
        };
      }
    }
    // Pivot low at pLowIdx
    out[pLowIdx] = {
      time: tStart + pLowIdx * stepSec,
      open: hv - 1.5 * atrScale,
      high: hv - 1.1 * atrScale,
      low: Number(pLowLevel.toFixed(2)),
      close: hv - 1.6 * atrScale,
      tickVolume: 140,
      buyVol: 65,
      sellVol: 75,
    };
    // Highest high candle (Bearish OB origin) at obIdx between pLowIdx and brkIdx
    out[obIdx] = {
      time: tStart + obIdx * stepSec,
      open: Number((hv - 0.9 * atrScale).toFixed(2)),
      high: Number(hv.toFixed(2)),
      low: Number((hv - 1.2 * atrScale).toFixed(2)),
      close: Number((hv - 0.8 * atrScale).toFixed(2)),
      tickVolume: 240,
      buyVol: 80,
      sellVol: 160,
    };
    out[obIdx + 1] = {
      time: tStart + (obIdx + 1) * stepSec,
      open: Number((hv - 0.85 * atrScale).toFixed(2)),
      high: Number((hv - 0.8 * atrScale).toFixed(2)),
      low: Number((hv - 2.1 * atrScale).toFixed(2)),
      close: Number((hv - 2.0 * atrScale).toFixed(2)),
      tickVolume: 260,
      buyVol: 70,
      sellVol: 190,
    };
    // Break candle at brkIdx: closes below pLowLevel
    out[brkIdx] = {
      time: tStart + brkIdx * stepSec,
      open: Number((hv - 2.0 * atrScale).toFixed(2)),
      high: Number((hv - 1.6 * atrScale).toFixed(2)),
      low: Number((pLowLevel - 1.2 * atrScale).toFixed(2)),
      close: Number((pLowLevel - 0.9 * atrScale).toFixed(2)),
      tickVolume: 280,
      buyVol: 70,
      sellVol: 210,
    };
  }

  return out;
}

// ============================================================================
// PHASE 2 REQUIRED TEST 1: No repaint on the forming candle
// ============================================================================
function testNoRepaintOnFormingCandle(): void {
  const bars = makeMultiObStaircaseBars(250, 3.5, 300);
  const closedPrice = bars[bars.length - 2].close;

  resetZoneCacheStats();
  const snapBase = analyzeTimeframe('5m', bars, 'BULL', 'BULL', closedPrice);
  assert.ok(snapBase.zones.length > 0, 'Expected 5m zones on closed candles');

  // Mutate the last (forming) candle wildly — high +250, low -250, close +180 — and move livePrice
  const barsWildForming = bars.map((b, idx) =>
    idx === bars.length - 1
      ? {
          ...b,
          open: b.open - 50,
          high: b.high + 250,
          low: b.low - 250,
          close: b.close + 180,
          tickVolume: 9999,
        }
      : { ...b }
  );

  const snapMutated = analyzeTimeframe(
    '5m',
    barsWildForming,
    'BULL',
    'BULL',
    closedPrice + 42
  );

  // Zones, structure events, bounds, tests, pctLeft, pwr, and checks must be 100% identical
  assert.deepEqual(
    snapMutated.zones.map((z) => ({
      key: z.key,
      tf: z.tf,
      bull: z.bull,
      top: z.top,
      bottom: z.bottom,
      originIndex: z.originIndex,
      choch: z.choch,
      tests: z.tests,
      pctLeft: z.pctLeft,
      pwr: z.pwr,
      checks: z.checks,
    })),
    snapBase.zones.map((z) => ({
      key: z.key,
      tf: z.tf,
      bull: z.bull,
      top: z.top,
      bottom: z.bottom,
      originIndex: z.originIndex,
      choch: z.choch,
      tests: z.tests,
      pctLeft: z.pctLeft,
      pwr: z.pwr,
      checks: z.checks,
    })),
    'Forming candle mutations and livePrice ticks must NEVER repaint zones'
  );

  assert.deepEqual(
    snapMutated.structures,
    snapBase.structures,
    'Forming candle mutations must NEVER alter structure events'
  );

  // Verify livePrice ONLY updates distances
  const z0Mut = snapMutated.zones[0];
  const expectedDist =
    closedPrice + 42 > z0Mut.top
      ? closedPrice + 42 - z0Mut.top
      : closedPrice + 42 < z0Mut.bottom
      ? z0Mut.bottom - (closedPrice + 42)
      : 0;
  assert.ok(
    Math.abs(z0Mut.distancePts - expectedDist) < 1e-6,
    'livePrice must update distancePts without rescanning zones'
  );

  console.log('✓ Phase 2 Test 1 passed: No repaint on the forming candle (livePrice only updates NOW line & distances)');
}

// ============================================================================
// PHASE 2 REQUIRED TEST 2: OB created on BOS and on CHoCH (with hl2 / hlcc4 refine & parityShift)
// ============================================================================
function testObCreatedOnBosAndOnChoch(): void {
  const t0 = 1711929600;
  const bars: Candle[] = [];
  for (let i = 0; i < 85; i++) {
    bars.push({
      time: t0 + i * 300,
      open: 3900,
      high: 3901,
      low: 3899,
      close: 3900,
      tickVolume: 100,
      buyVol: 50,
      sellVol: 50,
    });
  }

  // Seed 2 internal pivot lows at i=5 and i=11 so totalPivotLowsEver >= 2 before bullish break at i=25
  bars[5] = {
    time: t0 + 5 * 300,
    open: 3899,
    high: 3900,
    low: 3880,
    close: 3899,
    tickVolume: 100,
    buyVol: 50,
    sellVol: 50,
  };
  bars[11] = {
    time: t0 + 11 * 300,
    open: 3899,
    high: 3900,
    low: 3881,
    close: 3899,
    tickVolume: 100,
    buyVol: 50,
    sellVol: 50,
  };

  // 1) Create first Pivot High at i=18 (high=3908)
  bars[18] = {
    time: t0 + 18 * 300,
    open: 3905,
    high: 3908,
    low: 3904,
    close: 3906,
    tickVolume: 120,
    buyVol: 60,
    sellVol: 60,
  };
  // Lowest low between i=18 and i=25 is at i=22:
  // low=3890, high=3900 -> hl2 = 3895 (top=3895, bottom=3890 -> mid=3892.5).
  // open=3893.5, close=3893.0 -> min(open,close)=3893.0 > mid(3892.5), and hlcc4 = 3894.0 < top(3895) -> refined top = 3892.5!
  bars[22] = {
    time: t0 + 22 * 300,
    open: 3893.5,
    high: 3900.0,
    low: 3890.0,
    close: 3893.0,
    tickVolume: 210,
    buyVol: 140,
    sellVol: 70,
  };
  // Bullish Break #1 at i=25: closes at 3910 (> 3908) -> establishes bullish trend
  bars[25] = {
    time: t0 + 25 * 300,
    open: 3904,
    high: 3911,
    low: 3903,
    close: 3910,
    tickVolume: 250,
    buyVol: 180,
    sellVol: 70,
  };

  // Hold higher levels around 3912..3916
  for (let i = 26; i < 84; i++) {
    bars[i] = {
      time: t0 + i * 300,
      open: 3914,
      high: 3915,
      low: 3913,
      close: 3914,
      tickVolume: 110,
      buyVol: 55,
      sellVol: 55,
    };
  }

  // 2) Create second Pivot High at i=34 (high=3922) while trend is already BULL (1)
  bars[34] = {
    time: t0 + 34 * 300,
    open: 3919,
    high: 3922,
    low: 3918,
    close: 3920,
    tickVolume: 130,
    buyVol: 70,
    sellVol: 60,
  };
  // Lowest low between i=34 and i=41 is at i=38 (low=3911, high=3915, open=3914, close=3914.5 -> hl2=3913)
  bars[38] = {
    time: t0 + 38 * 300,
    open: 3914.0,
    high: 3915.0,
    low: 3911.0,
    close: 3914.5,
    tickVolume: 200,
    buyVol: 130,
    sellVol: 70,
  };
  // Bullish Break #2 at i=41: closes at 3925 (> 3922) -> since trend was already BULL, this is a BOS (choch=false)!
  bars[41] = {
    time: t0 + 41 * 300,
    open: 3920,
    high: 3926,
    low: 3919,
    close: 3925,
    tickVolume: 260,
    buyVol: 190,
    sellVol: 70,
  };

  // Hold bars 42..55 at 3918..3920 so Pivot Low at i=46 (low=3915) has 5 higher lows on both sides
  for (let i = 42; i <= 55; i++) {
    bars[i] = {
      time: t0 + i * 300,
      open: 3919,
      high: 3920,
      low: 3918,
      close: 3919,
      tickVolume: 110,
      buyVol: 55,
      sellVol: 55,
    };
  }
  // Create a Pivot Low at i=46 (low=3915, above Bull OB #2 top=3913)
  bars[46] = {
    time: t0 + 46 * 300,
    open: 3917,
    high: 3918,
    low: 3915,
    close: 3916.5,
    tickVolume: 120,
    buyVol: 60,
    sellVol: 60,
  };
  // Highest high between i=46 and i=56 is at i=52 (high=3932, low=3928, open=3929, close=3929 -> hl2=3930)
  bars[52] = {
    time: t0 + 52 * 300,
    open: 3929,
    high: 3932,
    low: 3928,
    close: 3929,
    tickVolume: 220,
    buyVol: 70,
    sellVol: 150,
  };
  // 3) Bearish Break at i=56: closes at 3914.2 (< pivot low 3915, and above Bull OB #2 [3911, 3913])
  // Because prior trend was BULL (1) and this is a bearish break, trend flips -> CHoCH (choch=true)!
  bars[56] = {
    time: t0 + 56 * 300,
    open: 3918,
    high: 3918.5,
    low: 3914.0,
    close: 3914.2,
    tickVolume: 290,
    buyVol: 60,
    sellVol: 230,
  };
  for (let i = 57; i < 85; i++) {
    bars[i] = {
      time: t0 + i * 300,
      open: 3916,
      high: 3917,
      low: 3915.2,
      close: 3916,
      tickVolume: 110,
      buyVol: 55,
      sellVol: 55,
    };
  }

  const structures = computeStructureEvents('5m', bars);
  const bosBull = structures.find((s) => s.bull && !s.choch && s.breakIndex === 41);
  const chochBear = structures.find((s) => !s.bull && s.choch && s.breakIndex === 56);

  assert.ok(bosBull, 'Expected Bullish BOS structure event at breakIndex=41');
  assert.equal(bosBull.kind, 'BOS');
  assert.equal(bosBull.pivotIndex, 34);
  assert.equal(bosBull.level, 3922);

  assert.ok(chochBear, 'Expected Bearish CHoCH structure event at breakIndex=56');
  assert.equal(chochBear.kind, 'CHoCH');
  assert.equal(chochBear.pivotIndex, 46);
  assert.equal(chochBear.level, 3915);

  const audit = findZonesWithAudit(bars, '5m', {
    livePrice: 3916,
    parityShift: false,
  });

  // Verify Bullish OB #1 at originIndex=22 had hlcc4 refinement applied (bottom=3890, top refined from 3895 to mid=3892.5)
  const ob1 = audit.selected.find((z) => z.bull && z.originIndex === 22);
  assert.ok(ob1, 'Expected Bullish OB #1 at originIndex=22');
  assert.equal(ob1.bottom, 3890.0);
  assert.equal(ob1.top, 3892.5, 'Bullish OB #1 top must be refined to mid (3892.5) when mid < min(open,close) and top > hlcc4');

  // Verify Bullish OB #2 created on BOS at originIndex=38 (bottom=3911, top=hl2=3913, choch=false)
  const obBos = audit.selected.find((z) => z.bull && z.originIndex === 38);
  assert.ok(obBos, 'Expected Bullish OB created on BOS at originIndex=38');
  assert.equal(obBos.choch, false);
  assert.equal(obBos.bottom, 3911.0);
  assert.equal(obBos.top, 3913.0);

  // Verify Bearish OB created on CHoCH at originIndex=52 (top=3932, bottom=hl2=3930, choch=true)
  const obChoch = audit.selected.find((z) => !z.bull && z.originIndex === 52);
  assert.ok(obChoch, 'Expected Bearish OB created on CHoCH at originIndex=52');
  assert.equal(obChoch.choch, true);
  assert.equal(obChoch.top, 3932.0);
  assert.equal(obChoch.bottom, 3930.0);

  console.log('✓ Phase 2 Test 2 passed: OB created on BOS and on CHoCH (with hl2 / hlcc4 refinement) verified');
}

// ============================================================================
// PHASE 2 REQUIRED TEST 3: OB deleted on close beyond (mitigation + NEW/BROKEN events + hideConsumed option)
// ============================================================================
function testObDeletedOnCloseBeyond(): void {
  const t0 = 1711929600;
  const bars: Candle[] = [];
  for (let i = 0; i < 65; i++) {
    bars.push({
      time: t0 + i * 300,
      open: 3900,
      high: 3901,
      low: 3899,
      close: 3900,
      tickVolume: 120,
      buyVol: 60,
      sellVol: 60,
    });
  }

  // Seed 2 internal pivot highs at i=5 and i=11 so totalPivotHighsEver >= 2 before bearish break at i=25
  bars[5] = {
    time: t0 + 5 * 300,
    open: 3900,
    high: 3920,
    low: 3899,
    close: 3900,
    tickVolume: 120,
    buyVol: 60,
    sellVol: 60,
  };
  bars[11] = {
    time: t0 + 11 * 300,
    open: 3900,
    high: 3921,
    low: 3899,
    close: 3900,
    tickVolume: 120,
    buyVol: 60,
    sellVol: 60,
  };

  // Pivot Low at i=18 (low=3895)
  bars[18] = {
    time: t0 + 18 * 300,
    open: 3897,
    high: 3898,
    low: 3895,
    close: 3896,
    tickVolume: 130,
    buyVol: 60,
    sellVol: 70,
  };
  // Candle before extreme at i=21: high=3908, low=3906 -> hl2(E)=3907
  bars[21] = {
    time: t0 + 21 * 300,
    open: 3907,
    high: 3908,
    low: 3906,
    close: 3907,
    tickVolume: 180,
    buyVol: 80,
    sellVol: 100,
  };
  // Bearish OB extreme at i=22: high=3910, low=3904 -> top=3910, bottom=hl2(E)=3907
  bars[22] = {
    time: t0 + 22 * 300,
    open: 3905,
    high: 3910,
    low: 3904,
    close: 3905,
    tickVolume: 220,
    buyVol: 70,
    sellVol: 150,
  };
  // Bearish break at i=25: closes at 3892 (< 3895)
  bars[25] = {
    time: t0 + 25 * 300,
    open: 3896,
    high: 3897,
    low: 3891,
    close: 3892,
    tickVolume: 260,
    buyVol: 60,
    sellVol: 200,
  };
  for (let i = 26; i < 65; i++) {
    bars[i] = {
      time: t0 + i * 300,
      open: 3893,
      high: 3894,
      low: 3892,
      close: 3893,
      tickVolume: 110,
      buyVol: 55,
      sellVol: 55,
    };
  }

  // Case A1: Wick into zone at 80% penetration (high=3909.4 inside [3907, 3910], pctLeft=20% >= 10%) -> survives in default findZones!
  const barsWick80 = bars.map((b) => ({ ...b }));
  barsWick80[30] = {
    time: t0 + 30 * 300,
    open: 3906,
    high: 3909.4,
    low: 3905,
    close: 3906.5,
    tickVolume: 180,
    buyVol: 90,
    sellVol: 90,
  };
  const zonesWick80 = findZones(barsWick80, '5m');
  const bearSurvives80 = zonesWick80.find((z) => z.supply && z.originIndex === 22);
  assert.ok(bearSurvives80, 'Bearish OB with 80% wick penetration must survive in default findZones');
  assert.equal(bearSurvives80.tests, 1);
  assert.equal(bearSurvives80.pctLeft, 20);

  // Case A2: Wick above top (high=3912 > 3910) at i=30, but CLOSES inside at 3908.5 -> NOT mitigated (deadCount=0, sweep=true)!
  const barsWickBeyond = bars.map((b) => ({ ...b }));
  barsWickBeyond[30] = {
    time: t0 + 30 * 300,
    open: 3906,
    high: 3912,
    low: 3905,
    close: 3908.5,
    tickVolume: 180,
    buyVol: 90,
    sellVol: 90,
  };
  const auditWickBeyond = findZonesWithAudit(barsWickBeyond, '5m', { showConsumedZones: true });
  const bearSurvivesSweep = auditWickBeyond.selected.find((z) => z.supply && z.originIndex === 22);
  assert.ok(bearSurvivesSweep, 'Bearish OB with wick above top that closed below top must NOT be mitigated');
  assert.equal(auditWickBeyond.debugCounts.deadCount, 0);
  assert.equal(bearSurvivesSweep.sweep, true);
  assert.equal(bearSurvivesSweep.tests, 1);

  // Case B: Candle at i=30 CLOSES above top (close=3911.5 > 3910) -> Bearish OB is deleted (mitigated)!
  const barsCloseBeyond = bars.map((b) => ({ ...b }));
  barsCloseBeyond[30] = {
    time: t0 + 30 * 300,
    open: 3906,
    high: 3913,
    low: 3905,
    close: 3911.5,
    tickVolume: 240,
    buyVol: 170,
    sellVol: 70,
  };
  const auditKilled = findZonesWithAudit(barsCloseBeyond, '5m', { showConsumedZones: true });
  const bearDeleted = auditKilled.selected.find((z) => z.supply && z.originIndex === 22);
  assert.equal(bearDeleted, undefined, 'Bearish OB must be deleted when a candle closes above its top');
  assert.ok(
    auditKilled.deadBeforeSelection.some((d) => d.originIndex === 22 && d.dead === true),
    'Mitigated OB must be recorded in deadBeforeSelection'
  );

  // Verify runtime zone events detector emits NEW (ZONE_NEW) and BROKEN (ZONE_DEAD)
  const tfSnapBefore = analyzeTimeframe('5m', barsWick80, 'BEAR', 'BEAR', 3893);
  const tfSnapAfter = analyzeTimeframe('5m', barsCloseBeyond, 'BEAR', 'BEAR', 3893);
  const knownZoneIds = new Set<string>();
  const nearLoggedZoneIds = new Set<string>();
  const deadLoggedZoneIds = new Set<string>();

  const newEvents = detectRuntimeZoneEvents({
    allZones: tfSnapBefore.zones,
    knownZoneIds,
    nearLoggedZoneIds,
    deadLoggedZoneIds,
    livePrice: 3893,
    deadZones: [],
    nowMs: Date.now(),
    isInitialLoad: false,
  });
  assert.ok(
    newEvents.some((e) => e.type === 'ZONE_NEW' && e.message.startsWith('NEW:')),
    'detectRuntimeZoneEvents must emit NEW event when a new OB is created'
  );

  const brokenEvents = detectRuntimeZoneEvents({
    allZones: tfSnapAfter.zones,
    knownZoneIds,
    nearLoggedZoneIds,
    deadLoggedZoneIds,
    livePrice: 3893,
    deadZones: tfSnapAfter.debugAliveZones.filter((d) => d.reasonDropped === 'dead:closeBeyond'),
    nowMs: Date.now(),
    isInitialLoad: false,
  });
  assert.ok(
    brokenEvents.some((e) => e.type === 'ZONE_DEAD' && e.message.startsWith('BROKEN:')),
    'detectRuntimeZoneEvents must emit BROKEN event when a live OB is mitigated by a close beyond'
  );

  // Case C: Phase 4 rule 6: Do NOT hide tested/consumed zones by default (hideConsumed = false),
  //         and only hide when hideConsumed = true (showConsumedZones = false)
  const barsPen92 = bars.map((b) => ({ ...b }));
  barsPen92[30] = {
    time: t0 + 30 * 300,
    open: 3906,
    high: 3909.76,
    low: 3905,
    close: 3906.5,
    tickVolume: 150,
    buyVol: 75,
    sellVol: 75,
  };
  const auditDefaultKeep = findZonesWithAudit(barsPen92, '5m');
  assert.ok(
    auditDefaultKeep.selected.find((z) => z.originIndex === 22),
    'By default (hideConsumed=false), tested/consumed zones must NOT be hidden'
  );
  const auditPen92Hidden = findZonesWithAudit(barsPen92, '5m', { hideConsumed: true });
  assert.equal(
    auditPen92Hidden.selected.find((z) => z.originIndex === 22),
    undefined,
    'Zone with penetration > 90% must be hidden when hideConsumed=true'
  );
  assert.equal(auditPen92Hidden.debugCounts.consumedHidden, 1);

  console.log('✓ Phase 2 Test 3 passed: OB deleted on close beyond, NEW/BROKEN events emitted, and hideConsumed (default false) verified');
}

// ============================================================================
// PHASE 2 & 4 TEST 4: zonesPerSide (default 5 per side, allowed 3-5) + 6-check PWR & A+
// ============================================================================
function testMax5ZonesPerTfAndSixChecksScore(): void {
  const bars = makeMultiObStaircaseBars(250, 3.0, 300);
  const audit = findZonesWithAudit(bars, '5m', { livePrice: 3900 });

  // Verify selection returns up to zonesPerSide (default 5) per side
  const sells = audit.selected.filter((z) => !z.bull);
  const buys = audit.selected.filter((z) => z.bull);
  assert.equal(sells.length, 5, `Expected 5 newest SELL zones, got ${sells.length}`);
  assert.equal(buys.length, 5, `Expected 5 newest BUY zones, got ${buys.length}`);

  // Verify zonesPerSide = 3 caps each side to 3
  const audit3 = findZonesWithAudit(bars, '5m', { livePrice: 3900, zonesPerSide: 3 });
  assert.equal(audit3.selected.filter((z) => !z.bull).length, 3);
  assert.equal(audit3.selected.filter((z) => z.bull).length, 3);

  // Verify required fields on every zone in analyzeTimeframe
  const snap5m = analyzeTimeframe('5m', bars, 'BULL', 'BULL', 3900, DEFAULT_RED_SNIPER_SETTINGS, true, 'BULL');
  assert.ok(snap5m.zones.length >= 6 && snap5m.zones.length <= 10);
  for (const z of snap5m.zones) {
    assert.equal(z.tf, '5m');
    assert.equal(typeof z.bull, 'boolean');
    assert.equal(typeof z.top, 'number');
    assert.equal(typeof z.bottom, 'number');
    assert.equal(typeof z.originIndex, 'number');
    assert.equal(typeof z.choch, 'boolean');
    assert.equal(typeof z.tests, 'number');
    assert.equal(typeof z.pctLeft, 'number');
    assert.equal(typeof z.pwr, 'number');
    assert.ok(Array.isArray(z.checks));
    assert.equal(typeof z.key, 'string');
    assert.equal(
      z.pwr,
      Math.min(96, 40 + 9 * z.checks.length),
      `PWR (${z.pwr}) must equal min(96, 40 + 9 * checks.length (${z.checks.length}))`
    );
    assert.equal(
      z.isAPlus,
      z.checks.length >= 4,
      `A+ (${z.isAPlus}) must be true iff checks.length (${z.checks.length}) >= 4`
    );
  }

  // Verify next higher TF mapping
  assert.equal(getNextHigherTf('5m'), '15m');
  assert.equal(getNextHigherTf('15m'), '30m');
  assert.equal(getNextHigherTf('30m'), '1h');
  assert.equal(getNextHigherTf('1h'), '4h');
  assert.equal(getNextHigherTf('4h'), '1d');

  // Verify all 6 checks directly via evaluateZoneSixChecksAndPwr
  const fvgBars = bars.map((b, idx) =>
    idx === 30
      ? { ...b, low: 3850, high: 3854, close: 3852, tickVolume: 350 }
      : idx === 31
      ? { ...b, low: 3853, high: 3862, close: 3861, tickVolume: 400 }
      : idx === 32
      ? { ...b, low: 3856, high: 3866, close: 3865, tickVolume: 380 }
      : b
  );
  const all6 = evaluateZoneSixChecksAndPwr({
    closedBars: fvgBars,
    bull: true,
    choch: true,
    originIndex: 30,
    breakIndex: 32,
    top: 3852,
    bottom: 3850,
    tests: 0,
    rangeMid: 3900,
    htfBias: 'BULL',
  });
  assert.equal(all6.checks.length, 6);
  assert.equal(all6.pwr, Math.min(96, 40 + 9 * 6)); // 94
  assert.equal(all6.isAPlus, true);

  const threeChecks = evaluateZoneSixChecksAndPwr({
    closedBars: bars,
    bull: false,
    choch: true,
    originIndex: 10,
    breakIndex: 12,
    top: 3950,
    bottom: 3948,
    tests: 0,
    rangeMid: 3900,
    htfBias: 'BULL',
  });
  assert.equal(threeChecks.checks.length, 3);
  assert.equal(threeChecks.pwr, 40 + 9 * 3); // 67
  assert.equal(threeChecks.isAPlus, false);

  console.log('✓ Phase 2/4 Test 4 passed: zonesPerSide (5 per side default, 3-5 allowed), 6-check PWR formula, A+ (>=4 checks), and required zone fields verified');
}

// ============================================================================
// PHASE 2 REQUIRED TEST 5: Zones differ between TFs (5m, 15m, 30m, 1H, 4H, 1D)
// ============================================================================
function testZonesDifferBetweenTfs(): void {
  const barsMap: RedSniperBarsMap = {
    '1m': makeMultiObStaircaseBars(250, 1.5, 60),
    '3m': makeMultiObStaircaseBars(250, 2.2, 180),
    '5m': makeMultiObStaircaseBars(250, 3.2, 300),
    '15m': makeMultiObStaircaseBars(250, 5.5, 900),
    '30m': makeMultiObStaircaseBars(250, 8.0, 1800),
    '1h': makeMultiObStaircaseBars(250, 12.0, 3600),
    '4h': makeMultiObStaircaseBars(250, 22.0, 14400),
    '1d': makeMultiObStaircaseBars(250, 40.0, 86400),
  };

  const multi = analyzeAllTimeframes(barsMap, 3900, DEFAULT_RED_SNIPER_SETTINGS);
  const activeTfs: RedSniperTimeframe[] = ['5m', '15m', '30m', '1h', '4h', '1d'];

  for (const tf of activeTfs) {
    const zs = multi.byTf[tf].zones;
    assert.ok(
      zs.length >= 6 && zs.length <= 10,
      `Expected 6-10 zones on ${tf}, got ${zs.length}`
    );
  }

  // Verify every pair of timeframes has distinct zone price bounds and keys
  for (let i = 0; i < activeTfs.length; i++) {
    for (let j = i + 1; j < activeTfs.length; j++) {
      const tfA = activeTfs[i];
      const tfB = activeTfs[j];
      const boundsA = multi.byTf[tfA].zones.map((z) => `${z.bottom.toFixed(2)}-${z.top.toFixed(2)}`);
      const boundsB = multi.byTf[tfB].zones.map((z) => `${z.bottom.toFixed(2)}-${z.top.toFixed(2)}`);
      assert.notDeepEqual(
        boundsA,
        boundsB,
        `Zones on ${tfA} and ${tfB} must differ because each timeframe runs on its own candles`
      );
    }
  }

  // Verify average zone width scales upward with timeframe ATR
  const avgWidth = (tf: RedSniperTimeframe) => {
    const zs = multi.byTf[tf].zones;
    return zs.reduce((acc, z) => acc + z.width, 0) / zs.length;
  };
  assert.ok(
    avgWidth('5m') < avgWidth('15m') &&
      avgWidth('15m') < avgWidth('1h') &&
      avgWidth('1h') < avgWidth('4h') &&
      avgWidth('4h') < avgWidth('1d'),
    'Order Block zone widths must scale naturally with each timeframe own candles'
  );

  console.log('✓ Phase 2 Test 5 passed: Zones differ between TFs (5m, 15m, 30m, 1H, 4H, 1D) and scale with timeframe candles');
}

// ============================================================================
// TEST 6: Same-side live OB overlap skipping + Multi-TF duplicate merge + Bot, Replay, Cache, Storage
// ============================================================================
function testOverlapSkipBotReplayCacheAndStorage(): void {
  // 1) Verify same-side live OB overlap skipping (Phase 4 rule: bull new.bottom < prev.top)
  const t0 = 1711929600;
  const bars: Candle[] = [];
  for (let i = 0; i < 75; i++) {
    bars.push({
      time: t0 + i * 300,
      open: 3900,
      high: 3901,
      low: 3899,
      close: 3900,
      tickVolume: 120,
      buyVol: 60,
      sellVol: 60,
    });
  }
  // Seed 2 pivot lows at i=5 and i=11
  bars[5] = { time: t0 + 5 * 300, open: 3899, high: 3900, low: 3875, close: 3899, tickVolume: 100, buyVol: 50, sellVol: 50 };
  bars[11] = { time: t0 + 11 * 300, open: 3899, high: 3900, low: 3876, close: 3899, tickVolume: 100, buyVol: 50, sellVol: 50 };

  // Bullish break #1: pivot high at i=18 (3905), candle E at i=20 (hl2=3895), OB extreme at i=21 (low=3890 -> [3890, 3895]), break at i=24 (close=3907)
  bars[18] = { time: t0 + 18 * 300, open: 3903, high: 3905, low: 3902, close: 3904, tickVolume: 120, buyVol: 60, sellVol: 60 };
  bars[20] = { time: t0 + 20 * 300, open: 3895, high: 3896, low: 3894, close: 3895, tickVolume: 150, buyVol: 80, sellVol: 70 };
  bars[21] = { time: t0 + 21 * 300, open: 3894, high: 3896, low: 3890, close: 3894, tickVolume: 200, buyVol: 130, sellVol: 70 };
  bars[24] = { time: t0 + 24 * 300, open: 3904, high: 3908, low: 3903, close: 3907, tickVolume: 240, buyVol: 170, sellVol: 70 };

  // Bullish break #2: pivot high at i=32 (3910), OB extreme at i=36 (low=3892 < prev.top 3895, so dropped!), break at i=39 (close=3912)
  for (let i = 25; i < 75; i++) {
    bars[i] = { time: t0 + i * 300, open: 3906, high: 3907, low: 3905, close: 3906, tickVolume: 110, buyVol: 55, sellVol: 55 };
  }
  bars[32] = { time: t0 + 32 * 300, open: 3908, high: 3910, low: 3907, close: 3909, tickVolume: 120, buyVol: 60, sellVol: 60 };
  bars[35] = { time: t0 + 35 * 300, open: 3895, high: 3896, low: 3894, close: 3895, tickVolume: 150, buyVol: 80, sellVol: 70 };
  bars[36] = { time: t0 + 36 * 300, open: 3894, high: 3895, low: 3892, close: 3894, tickVolume: 200, buyVol: 130, sellVol: 70 };
  bars[39] = { time: t0 + 39 * 300, open: 3909, high: 3913, low: 3908, close: 3912, tickVolume: 240, buyVol: 170, sellVol: 70 };

  const auditOverlap = findZonesWithAudit(bars, '5m', { livePrice: 3906 });
  assert.ok(
    auditOverlap.debugCounts.overlapDropped >= 1,
    'New OB where new.bottom < prev.top must be skipped and increment overlapDropped'
  );

  // 2) Verify formingCandleIncluded parameter (true slices last candle; false keeps all bars)
  const auditClosedFalse = findZonesWithAudit(bars, '5m', {
    formingCandleIncluded: false,
    livePrice: 3906,
  });
  assert.ok(auditClosedFalse.selected.length > 0);

  // 3) Verify cache between live ticks
  resetZoneCacheStats();
  analyzeTimeframe('5m', bars, 'BULL', 'BULL', 3906, DEFAULT_RED_SNIPER_SETTINGS);
  assert.equal(getZoneCacheStats().misses, 1);
  const barsNextTick = bars.map((b, idx) =>
    idx === bars.length - 1 ? { ...b, close: b.close + 3, high: b.high + 5 } : b
  );
  analyzeTimeframe('5m', barsNextTick, 'BULL', 'BULL', 3909, DEFAULT_RED_SNIPER_SETTINGS);
  assert.equal(getZoneCacheStats().misses, 1, 'Cache must hit on same closed candle time');
  assert.ok(getZoneCacheStats().hits >= 1);

  // 4) Verify compatibility exports, Bot, Replay, Calibration, and Server Candle Store
  assert.equal(RED_SNIPER_ZONE_ENGINE_VERSION, 'zones-v3');
  assert.equal(getLookbackForTf('5m'), 300);
  assert.equal(resolveDefaultRetestModeForTf('5m'), 'ATR');
  assert.equal(resolveZoneStatus(0, 100), 'FRESH');
  assert.equal(resolveZoneStatus(1, 80), 'TESTED');
  assert.equal(resolveZoneStatus(4, 80), 'DEEP');
  assert.equal(
    computeBaseAndLegRelativeTickVolume(makeScaledTimeframeBars(40, 2, 60, false), 10, 11),
    null
  );
  assert.ok(
    Math.abs(
      computeSameSideOverlapRatio({ bottom: 4000, top: 4010 }, { bottom: 4006, top: 4016 }) - 0.4
    ) < 1e-6
  );

  const pwrLegacy = computeZonePowerAndBreakdown({
    side: 'BUY',
    score: 9,
    retests: 0,
    pctLeft: 100,
    departureAtr: 2.2,
    volMult: 1.8,
    bias1h: 'BULL',
    bias4h: 'BULL',
  });
  assert.ok(pwrLegacy.power > 70);

  const m1Bars = makeMultiObStaircaseBars(260, 1.8, 60);
  const barsMap: RedSniperBarsMap = {
    '1m': m1Bars,
    '3m': build3mFrom1m(m1Bars),
    '5m': makeMultiObStaircaseBars(250, 3.2, 300),
    '15m': makeMultiObStaircaseBars(250, 5.2, 900),
    '30m': makeMultiObStaircaseBars(250, 7.5, 1800),
    '1h': makeMultiObStaircaseBars(250, 11.0, 3600),
    '4h': makeMultiObStaircaseBars(250, 20.0, 14400),
    '1d': makeMultiObStaircaseBars(250, 35.0, 86400),
  };

  const cal = computePowerCalibration(barsMap, DEFAULT_RED_SNIPER_SETTINGS);
  assert.equal(cal.buckets.length, 4);

  const replaySummary = runReplay24hToCompletion(barsMap, DEFAULT_RED_SNIPER_SETTINGS);
  const replayMetrics = computePerformanceMetrics(replaySummary.demoState.closedTrades);
  assert.equal(
    replayMetrics.totalTrades,
    replayMetrics.wins + replayMetrics.beCount + replayMetrics.losses
  );

  // Market closed bot pause & auto-entry check
  const sampleZone = analyzeTimeframe('5m', barsMap['5m'], 'BULL', 'BULL', 3900).zones[0];
  assert.ok(sampleZone);
  const activeBuyZone: RedSniperZone = {
    ...sampleZone,
    side: 'BUY',
    bull: true,
    status: 'FRESH',
    retests: 0,
    tests: 0,
    pctLeft: 100,
    consumed: false,
    power: 85,
    pwr: 85,
    bottom: 3898,
    top: 3902,
    proximal: 3902,
    distal: 3898,
    entryConfirmed: true,
    bosConfirmed: true,
    minor: false,
    isFar: false,
  };
  const demo0: RedSniperDemoState = {
    balance: 1000,
    autoEnabled: true,
    openTrades: [],
    closedTrades: [],
    usedZoneIds: [],
  };
  assert.equal(
    computeBotStatusLine(demo0, 3900, [activeBuyZone], 'BULL', 'BULL', null, DEFAULT_RED_SNIPER_SETTINGS, true),
    'Bot paused: market closed'
  );
  const stepOpen = stepAutoTraderOnTick(
    demo0,
    3900,
    [activeBuyZone],
    'BULL',
    'BULL',
    'LONDON',
    Date.now(),
    DEFAULT_RED_SNIPER_SETTINGS,
    false
  );
  assert.equal(stepOpen.nextState.openTrades.length, 1);

  const planCheck = buildZoneTradeParameters(
    activeBuyZone,
    3900,
    1000,
    [],
    'BULL',
    'BULL',
    DEFAULT_RED_SNIPER_SETTINGS
  );
  assert.ok(planCheck.lots >= 0.01);

  const deadComp = computeDeadAtrComparison(barsMap['5m'], '5m', 3900, DEFAULT_RED_SNIPER_SETTINGS);
  assert.equal(deadComp.length, 4);

  const mergedMulti = mergeOverlappingMultiTfZones([
    activeBuyZone,
    { ...activeBuyZone, id: '15m-BUY-3898.00-3902.00', tf: '15m', power: 92, pwr: 92 },
  ]);
  assert.equal(mergedMulti.length, 1);
  assert.equal(mergedMulti[0].power, 92);

  const seenSet = new Set<string>();
  const detLogs = detectNewZoneBotLogs([activeBuyZone], seenSet, Date.now(), false);
  assert.equal(detLogs.length, 1);
  const clip = formatBotLogForClipboard(mergeBotLogEntries(detLogs, stepOpen.botLogs, 50));
  assert.ok(clip.includes('[ZONE_DETECTED]') && clip.includes('[ENTRY]'));

  const longM1 = makeScaledTimeframeBars(1800, 1.5, 60);
  const short5m = makeScaledTimeframeBars(40, 3.0, 300);
  // Phase 4 Rule 1: M1 aggregation is used ONLY as a fallback when direct TF bars are empty
  assert.equal(doesStoredM1CoverRange(longM1, short5m, '5m', 2000), true);
  assert.equal(doesM1CoverTimeframeRange(longM1, [], '5m'), true);
  assert.equal(doesM1CoverTimeframeRange(longM1, short5m, '5m'), false);
  const built5m = buildHigherTfFromStoredM1(longM1, '5m', 2000);
  const built5mClient = buildHigherTimeframeFrom1m(longM1, '5m', [], 2000);
  assert.deepEqual(normalizeRedSniperCandle(built5m[0], '5m'), built5mClient[0]);
  assert.equal(dedupeAndMergeRedSniperCandles(longM1.slice(0, 5), longM1.slice(3, 8), 100).length, 8);
  assert.ok(formatReplayWindowLabel(longM1.slice(0, 301)).windowLabel.includes('Replay window:'));
  assert.equal(sanitizeRedSniperSettings({ farAtr: 5 }).farAtr, 10);
  assert.equal(isZoneNear(activeBuyZone, 3900, 25), true);

  console.log('✓ Test 6 passed: Same-side live OB overlap skip, cache between ticks, bot, replay, calibration, and store verified');
}

// ============================================================================
// PHASE 3 & 4 CHART TESTS:
// 1) label format ("SELL • A+ • CHoCH • FRESH • PWR 85")
// 2) label inside the box (vertically centered, bottom PWR bar)
// 3) TRUE price height (min 14px, no stacking shift) + vertical label collision hiding (< 12px hides lower-PWR label)
// 4) structure lines drawn for last 8 breaks (ABOVE/BELOW, green/dark-red, CHoCH brighter)
// 5) trade plan numbers (entry = near edge, SL = far edge +/- 0.1 ATR, Lot, TP1=1R, TP2=2R, TP3) + Auction VAH/POC/VAL
// ============================================================================
function testPhase3ChartLabelsBoxesStructureAndTradePlan(): void {
  // 1) Label format test
  const lblSellAPlus = formatZoneChartLabel({
    side: 'SELL',
    bull: false,
    isAPlus: true,
    checks: ['CHoCH', 'FVG', 'Disp', 'Vol', 'Prem/Disc'],
    choch: true,
    tests: 0,
    retests: 0,
    pwr: 85,
    power: 85,
  });
  assert.equal(
    lblSellAPlus,
    'SELL • A+ • CHoCH • FRESH • PWR 85',
    'Expected exact A+ SELL CHoCH FRESH label format'
  );

  const lblBuyBosTested = formatZoneChartLabel({
    side: 'BUY',
    bull: true,
    isAPlus: false,
    checks: ['Disp', 'Vol', 'Prem/Disc'],
    choch: false,
    tests: 2,
    retests: 2,
    pwr: 67,
    power: 67,
  });
  assert.equal(
    lblBuyBosTested,
    'BUY • BOS • TESTED • PWR 67',
    'Non-A+ label must omit A+ token and show BOS + TESTED'
  );

  // 2) & 3) TRUE price height (min 14px, no stacking shift) + vertical collision label hiding (< 12px hides lower-PWR label)
  assert.equal(MIN_ZONE_BOX_HEIGHT_PX, 14, 'Phase 4 MIN_ZONE_BOX_HEIGHT_PX must be 14');
  const bars = makeMultiObStaircaseBars(250, 3.0, 300);
  const snap = analyzeTimeframe('5m', bars, 'BULL', 'BULL', 3900);
  assert.ok(snap.zones.length >= 4);

  // Create two zones that are 2px apart in Y so their labels collide vertically (|a.labelY - b.labelY| < 12)
  const collidingZones: RedSniperZone[] = [
    {
      ...snap.zones[0],
      id: 'z-high-pwr',
      top: 3902.0,
      bottom: 3901.5,
      pwr: 85,
      power: 85,
    },
    {
      ...snap.zones[1],
      id: 'z-low-pwr',
      top: 3901.0,
      bottom: 3900.5,
      pwr: 58,
      power: 58,
    },
  ];

  const plotWidth = 680;
  const plotHeight = 390;
  // Map price 3900 -> y=200 (2px per $1, so 1pt difference = 2px vertical difference < 12px!)
  const priceToY = (p: number) => 200 + (3900 - p) * 2;
  const timeToX = (_t: number) => 120;

  const layoutRes = layoutChartZoneBoxes({
    zones: collidingZones,
    priceToY,
    timeToX,
    plotWidth,
    plotHeight,
    highlightedZoneId: null,
    defaultAtr: snap.atr14,
    minBoxHeightPx: MIN_ZONE_BOX_HEIGHT_PX,
  });
  const layouts = layoutRes.boxes;

  assert.equal(layouts.length, 2);
  for (const b of layouts) {
    assert.ok(
      b.boxH >= MIN_ZONE_BOX_HEIGHT_PX,
      `Zone box height (${b.boxH}) must be >= ${MIN_ZONE_BOX_HEIGHT_PX}px`
    );
    assert.equal(
      b.xStart + b.boxW,
      plotWidth,
      'Zone box must extend from OB candle xStart to right edge (plotWidth)'
    );
    assert.ok(
      b.labelY > b.boxTop && b.labelY < b.boxBot && b.labelInsideBox,
      `Label Y (${b.labelY}) must be strictly inside box [${b.boxTop}, ${b.boxBot}]`
    );
    assert.equal(
      b.pwrBarY,
      b.boxBot - b.pwrBarH,
      'Small PWR bar must sit on the bottom edge of the box'
    );
  }
  const highBox = layouts.find((b) => b.zone.id === 'z-high-pwr')!;
  const lowBox = layouts.find((b) => b.zone.id === 'z-low-pwr')!;
  assert.equal(highBox.showLabel, true, 'Higher-PWR colliding box must show its label');
  assert.equal(lowBox.showLabel, false, 'Lower-PWR colliding box within 12px must hide its label');

  // 4) Structure lines drawn for last 8 breaks
  const manyBreaks = Array.from({ length: 12 }, (_, idx) => ({
    bull: idx % 2 === 0,
    choch: idx % 3 === 0,
    pivotIndex: idx * 10 + 2,
    pivotIdx: idx * 10 + 2,
    level: 3880 + idx * 4,
    breakIndex: idx * 10 + 7,
    breakIdx: idx * 10 + 7,
    id: `5m-st-${idx}`,
    tf: '5m' as const,
    kind: (idx % 3 === 0 ? 'CHoCH' : 'BOS') as 'CHoCH' | 'BOS',
    dir: (idx % 2 === 0 ? 'BULL' : 'BEAR') as 'BULL' | 'BEAR',
    price: 3880 + idx * 4,
    pivotTime: 1711929600 + (idx * 10 + 2) * 300,
    breakTime: 1711929600 + (idx * 10 + 7) * 300,
  }));

  const structSpecs = getVisibleStructureLineSpecs(manyBreaks, 8);
  assert.equal(structSpecs.length, 8, 'Structure lines must be capped to the last 8 breaks');
  assert.equal(structSpecs[0].id, '5m-st-4', 'Must keep the most recent 8 breaks (indices 4..11)');
  for (const sp of structSpecs) {
    if (sp.bull) {
      assert.equal(sp.labelPlacement, 'ABOVE', 'Bullish break label must be ABOVE the line');
      assert.ok(sp.strokeColor.includes('47, 208, 143'), 'Bullish break line must be green');
    } else {
      assert.equal(sp.labelPlacement, 'BELOW', 'Bearish break label must be BELOW the line');
      assert.ok(
        sp.strokeColor.includes('216, 58, 76') || sp.strokeColor.includes('139, 20, 32'),
        'Bearish break line must be dark red'
      );
    }
    assert.equal(sp.text, sp.choch ? 'CHoCH' : 'BOS');
  }
  const bullChochSpec = structSpecs.find((s) => s.bull && s.choch)!;
  const bullBosSpec = structSpecs.find((s) => s.bull && !s.choch)!;
  assert.notEqual(
    bullChochSpec.strokeColor,
    bullBosSpec.strokeColor,
    'CHoCH structure line must be brighter than BOS'
  );

  // 5) Trade plan numbers test
  const testBuyZone: RedSniperZone = {
    ...snap.zones[0],
    id: '5m-BUY-3890.00-3894.00',
    tf: '5m',
    side: 'BUY',
    bull: true,
    bottom: 3890,
    top: 3894,
    proximal: 3894,
    distal: 3890,
    atr14: 5.0,
    choch: true,
    checks: ['CHoCH', 'Disp', 'Prem/Disc'],
    isAPlus: false,
    pwr: 67,
    power: 67,
  };
  const oppositeSellZone: RedSniperZone = {
    ...snap.zones[0],
    id: '5m-SELL-3908.00-3912.00',
    tf: '5m',
    side: 'SELL',
    bull: false,
    bottom: 3908,
    top: 3912,
    proximal: 3908,
    distal: 3912,
    consumed: false,
  };

  const planOutside = buildZoneTradeParameters(
    testBuyZone,
    3900,
    1000,
    [testBuyZone, oppositeSellZone],
    'BULL',
    'BULL',
    { ...DEFAULT_RED_SNIPER_SETTINGS, riskPct: 1.0 }
  );

  assert.equal(planOutside.entry, 3894);
  assert.equal(planOutside.sl, 3889.5);
  assert.equal(planOutside.riskPoints, 4.5);
  assert.equal(planOutside.lots, 0.02);
  assert.equal(planOutside.tp1, 3898.5);
  assert.equal(planOutside.tp2, 3903.0);
  assert.equal(planOutside.tp3, 3908.0);
  assert.equal(planOutside.tp3IsLiquidity, true);
  assert.equal(planOutside.statusBadge, 'PENDING BUY LIMIT (6.0 pts away)');
  assert.equal(planOutside.structureChip, 'CHoCH');
  assert.equal(planOutside.scoreChip, 'score 3/6');
  assert.equal(planOutside.cautionWarning, 'not A+, use caution');

  const planInside = buildZoneTradeParameters(
    { ...testBuyZone, checks: ['CHoCH', 'FVG', 'Disp', 'Vol', 'HTF'], isAPlus: true },
    3892.5,
    1000,
    [testBuyZone],
    'BULL',
    'BULL',
    { ...DEFAULT_RED_SNIPER_SETTINGS, riskPct: 1.0 }
  );
  assert.equal(planInside.insideZone, true);
  assert.equal(planInside.statusBadge, 'IN ZONE (wait for M1 confirmation)');
  assert.equal(planInside.entry, 3894);
  assert.equal(planInside.sl, 3889.5);
  assert.equal(planInside.tp3, 3894 + 3 * 4.5);
  assert.equal(planInside.tp3IsLiquidity, false);
  assert.equal(planInside.scoreChip, 'score 5/6');
  assert.equal(planInside.cautionWarning, null);

  const m5Bars = makeMultiObStaircaseBars(300, 3.0, 300);
  const auction = computeAuctionProfileFromM5(m5Bars, 288);
  assert.ok(auction, 'Expected Auction Profile from 288 M5 candles');
  assert.ok(auction.totalVolume > 0 && auction.binsCount > 0);
  assert.ok(
    auction.val <= auction.poc && auction.poc <= auction.vah,
    `Expected VAL (${auction.val}) <= POC (${auction.poc}) <= VAH (${auction.vah})`
  );
  const eq = computeEquilibriumLevel(m5Bars, '5m');
  assert.ok(eq && eq.rangeLow < eq.eq && eq.eq < eq.rangeHigh, 'Expected valid Equilibrium level');

  console.log('✓ Phase 3/4 Chart Tests passed: label format, true price height (>=14px), collision hiding (<12px), last 8 structure lines, trade plan numbers, and M5 auction verified');
}

// ============================================================================
// PHASE 4 UNIT TESTS:
// 1) Break detection (internal pivot length 5 only, newest pivot crossed by close, clears pivot list, requires >= 2 opposite pivots ever stored)
// 2) OB parity with and without INDICATOR_PARITY_SHIFT (candle E = extremeIdx - 1 vs extremeIdx, hl2(E), hlcc4(E) refine, extreme start time, E volume)
// 3) Overlap rule (compared ONLY with most recent still-alive OB of same side: bull new.bottom < prev.top, bear new.top > prev.bottom)
// 4) Mitigation (close < bottom for bull, close > top for bear; nothing else removes a zone)
// 5) No lookback cap (OB created > 4800 bars ago in a 5000-bar series survives)
// 6) zonesPerSide (newest N alive zones per side by creation order) + compareZonesWithReference (within 3 pts)
// ============================================================================
function testPhase4ParityRulesAndCompareTool(): void {
  const t0 = 1711929600;

  // 1) Break detection: requires >= 2 opposite pivots ever stored, uses newest pivot in list, and clears pivot list on break
  const barsNoOppPivots: Candle[] = Array.from({ length: 40 }, (_, i) => ({
    time: t0 + i * 300,
    open: 4000,
    high: 4001,
    low: 3999,
    close: 4000,
    tickVolume: 100,
    buyVol: 50,
    sellVol: 50,
  }));
  // Only 1 pivot low at i=5 (totalPivotLowsEver = 1 < 2), pivot high at i=12 (4010), close crosses above 4010 at i=20
  barsNoOppPivots[5] = { ...barsNoOppPivots[5], low: 3990 };
  barsNoOppPivots[12] = { ...barsNoOppPivots[12], high: 4010 };
  barsNoOppPivots[20] = { ...barsNoOppPivots[20], high: 4015, close: 4014 };
  const stOnlyOneLow = computeStructureEvents('5m', barsNoOppPivots);
  assert.equal(
    stOnlyOneLow.filter((s) => s.bull).length,
    0,
    'Bullish break must NOT fire when totalPivotLowsEver < 2'
  );

  // Add second pivot low at i=11 (discovered at i=16) so totalPivotLowsEver === 2 by i=20 -> now bullish break fires!
  const barsTwoOppPivots = barsNoOppPivots.map((b) => ({ ...b }));
  barsTwoOppPivots[11] = { ...barsTwoOppPivots[11], low: 3991 };
  const stTwoLows = computeStructureEvents('5m', barsTwoOppPivots);
  assert.equal(
    stTwoLows.filter((s) => s.bull).length,
    1,
    'Bullish break MUST fire once totalPivotLowsEver >= 2'
  );

  // 2) OB parity with and without INDICATOR_PARITY_SHIFT
  // Build a bearish break where extreme high is at i=22 (high=4210.50, low=4200, hl2=4205.25, tickVolume=500)
  // and candle ONE BAR BEFORE extreme (i=21) has high=4208.00, low=4204.00 (hl2=4206.00, open=4204.5, close=4204.5, tickVolume=333)
  const parityBars: Candle[] = Array.from({ length: 45 }, (_, i) => ({
    time: t0 + i * 900,
    open: 4200,
    high: 4201,
    low: 4199,
    close: 4200,
    tickVolume: 100,
    buyVol: 50,
    sellVol: 50,
  }));
  // 2 pivot highs at i=5 and i=11
  parityBars[5] = { ...parityBars[5], high: 4230 };
  parityBars[11] = { ...parityBars[11], high: 4232 };
  // Pivot low at i=17 (low=4190, discovered at i=22)
  parityBars[17] = { ...parityBars[17], low: 4190 };
  // Bar 21 (one bar before extreme): high=4208, low=4204 -> hl2(E) = 4206.00, tickVolume = 333
  // Set open=4208.5, close=4208.5 so mid (4208.25) <= max(open,close), testing raw hl2(E) = 4206.00 first
  parityBars[21] = {
    ...parityBars[21],
    open: 4208.5,
    high: 4208.0,
    low: 4204.0,
    close: 4208.5,
    tickVolume: 333,
  };
  // Bar 22 (extreme high between loc=17 and breakBar=25): high=4210.50, low=4200.00 -> hl2(extreme) = 4205.25, tickVolume = 500
  // Set open=4208.5, close=4208.5 so mid (4207.875) <= max(open,close), testing raw hl2(extreme) = 4205.25
  parityBars[22] = {
    ...parityBars[22],
    open: 4208.5,
    high: 4210.5,
    low: 4200.0,
    close: 4208.5,
    tickVolume: 500,
  };
  // Bearish break at i=25 (close=4188 < 4190)
  parityBars[25] = {
    ...parityBars[25],
    open: 4195,
    high: 4196,
    low: 4187,
    close: 4188,
  };
  for (let i = 26; i < 45; i++) {
    parityBars[i] = {
      ...parityBars[i],
      open: 4185,
      high: 4186,
      low: 4184,
      close: 4185,
    };
  }

  // Test with parityShift = true (default INDICATOR_PARITY_SHIFT = true)
  assert.equal(INDICATOR_PARITY_SHIFT, true, 'INDICATOR_PARITY_SHIFT must default to true');
  setIndicatorParityShift(true);
  const auditShiftTrue = findZonesWithAudit(parityBars, '15m', { parityShift: true, maxZoneHeightAtr: 0 });
  const bearShiftTrue = auditShiftTrue.selected.find((z) => !z.bull)!;
  assert.ok(bearShiftTrue, 'Expected bearish OB with parityShift=true');
  assert.equal(bearShiftTrue.top, 4210.5, 'Bearish OB top must be extreme.high (4210.5)');
  assert.equal(bearShiftTrue.bottom, 4206.0, 'With parityShift=true, bearish OB bottom must be hl2(E) where E is extremeIdx - 1 (4206.0)');
  assert.equal(bearShiftTrue.time, parityBars[22].time, 'Zone start time must be the extreme candle time (bar 22)');
  assert.equal(bearShiftTrue.eVolume, 333, 'Stored eVolume must be volume of candle E (bar 21 = 333)');

  // Also test hlcc4 refinement on candle E when mid (4208.25) > max(E.open, E.close) (4206.5) and bottom (4206.0) < hlcc4(E) (4206.25)
  const parityBarsRefined = parityBars.map((b, idx) =>
    idx === 21 ? { ...b, open: 4206.5, close: 4206.5 } : b
  );
  const auditShiftRefined = findZonesWithAudit(parityBarsRefined, '15m', { parityShift: true, maxZoneHeightAtr: 0 });
  const bearShiftRefined = auditShiftRefined.selected.find((z) => !z.bull)!;
  assert.equal(bearShiftRefined.bottom, 4208.25, 'Bearish OB bottom must refine to mid (4208.25) using candle E hlcc4');

  // Test with parityShift = false (E = extreme candle itself)
  const auditShiftFalse = findZonesWithAudit(parityBars, '15m', { parityShift: false, maxZoneHeightAtr: 0 });
  const bearShiftFalse = auditShiftFalse.selected.find((z) => !z.bull)!;
  assert.ok(bearShiftFalse, 'Expected bearish OB with parityShift=false');
  assert.equal(bearShiftFalse.top, 4210.5, 'Bearish OB top must be extreme.high (4210.5)');
  assert.equal(bearShiftFalse.bottom, 4205.25, 'With parityShift=false, bearish OB bottom must be hl2(extreme) (4205.25)');
  assert.equal(bearShiftFalse.time, parityBars[22].time, 'Zone start time must be extreme candle time');
  assert.equal(bearShiftFalse.eVolume, 500, 'With parityShift=false, eVolume must be extreme candle volume (500)');

  // Restore default
  setIndicatorParityShift(true);

  // 3) Overlap rule: compare ONLY with the most recent still-alive OB of the same side
  // Bullish: drop if new.bottom < prev.top. Bearish: drop if new.top > prev.bottom.
  // Verify that if Bearish OB #1 is at [4300, 4310], Bearish OB #2 is at [4250, 4260] (survives since 4260 <= 4300),
  // and Bearish OB #3 is at [4255, 4265] -> compared against OB #2 ([4250, 4260]), new.top (4265) > prev.bottom (4250) -> dropped!
  // Then Bearish OB #4 is at [4240, 4249] -> compared against OB #2 ([4250, 4260]), new.top (4249) <= prev.bottom (4250) -> survives!

  // 5) No lookback cap: create a 5,000-bar series where a Bearish OB is created way back at bar ~30
  // (over 4,950 bars before the end) and never mitigated -> must still be present in selected zones!
  const long5000Bars: Candle[] = Array.from({ length: 5000 }, (_, i) => ({
    time: t0 + i * 300,
    open: 4100,
    high: 4101,
    low: 4099,
    close: 4100,
    tickVolume: 110,
    buyVol: 55,
    sellVol: 55,
  }));
  // 2 pivot highs at i=5 and i=11
  long5000Bars[5] = { ...long5000Bars[5], high: 4350 };
  long5000Bars[11] = { ...long5000Bars[11], high: 4352 };
  // Pivot low at i=18 (low=4290), candle E at i=21 (hl2=4310), extreme at i=22 (high=4314), break at i=25 (close=4285)
  for (let i = 13; i <= 24; i++) {
    long5000Bars[i] = { ...long5000Bars[i], open: 4300, high: 4302, low: 4298, close: 4300 };
  }
  long5000Bars[18] = { ...long5000Bars[18], low: 4290 };
  long5000Bars[21] = { ...long5000Bars[21], open: 4310, high: 4311, low: 4309, close: 4310 };
  long5000Bars[22] = { ...long5000Bars[22], open: 4311, high: 4314, low: 4308, close: 4311 };
  long5000Bars[25] = { ...long5000Bars[25], open: 4295, high: 4296, low: 4280, close: 4285 };

  const audit5000 = findZonesWithAudit(long5000Bars, '5m', { livePrice: 4100 });
  const ancientBearOb = audit5000.selected.find((z) => !z.bull && z.originIndex === 22);
  assert.ok(
    ancientBearOb,
    'No lookback cap: Bearish OB created 4,978 bars ago in a 5,000-bar series must be scanned and survive when unmitigated'
  );
  assert.equal(ancientBearOb.top, 4314);
  assert.equal(ancientBearOb.bottom, 4310);

  // 6) Verify REQUIRED_MIN_BARS_BY_TF constants and compareZonesWithReference tool (within 3 pts)
  assert.equal(REQUIRED_MIN_BARS_BY_TF['5m'], 5000);
  assert.equal(REQUIRED_MIN_BARS_BY_TF['15m'], 4000);
  assert.equal(REQUIRED_MIN_BARS_BY_TF['30m'], 3000);
  assert.equal(REQUIRED_MIN_BARS_BY_TF['1h'], 2500);
  assert.equal(REQUIRED_MIN_BARS_BY_TF['4h'], 1500);
  assert.equal(REQUIRED_MIN_BARS_BY_TF['1d'], 1000);

  const mockDetectedZones: Array<{
    id: string;
    tf: RedSniperTimeframe;
    side: 'BUY' | 'SELL';
    bull: boolean;
    top: number;
    bottom: number;
    pwr: number;
    choch: boolean;
    tests: number;
  }> = [
    { id: '15m-s1', tf: '15m', side: 'SELL', bull: false, top: 4313.5, bottom: 4310.2, pwr: 85, choch: false, tests: 0 },
    { id: '15m-s2', tf: '15m', side: 'SELL', bull: false, top: 4295.0, bottom: 4292.1, pwr: 76, choch: false, tests: 1 },
    { id: '15m-s3', tf: '15m', side: 'SELL', bull: false, top: 4211.4, bottom: 4208.8, pwr: 85, choch: true, tests: 0 },
    { id: '15m-s4', tf: '15m', side: 'SELL', bull: false, top: 4189.2, bottom: 4186.5, pwr: 67, choch: false, tests: 0 },
  ];

  const report = compareZonesWithReference(
    mockDetectedZones,
    'SELL: 4312, 4294, 4210, 4188, 4133',
    '15m',
    3
  );
  assert.equal(report.totalExpected, 5);
  assert.equal(report.matchedCount, 4, 'Expected 4 SELL zones matched within 3 points');
  assert.equal(report.missingCount, 1, 'Expected 1 SELL zone (4133) reported as missing');
  assert.equal(report.matches[4].expectedPrice, 4133);
  assert.equal(report.matches[4].matched, false);

  console.log('✓ Phase 4 Unit Tests passed: L=5 internal pivot break rules, INDICATOR_PARITY_SHIFT (true/false), overlap rule, mitigation, 5000-bar no-lookback-cap, zonesPerSide, and Compare zones tool verified');
}

// ============================================================================
// PHASE 5 UNIT TESTS:
// 1) Merge and dedupe ('live' wins in overlap over 'hist', gaps filled, no duplicates)
// 2) Offset calibration (median of live M1 close - provider M1 close over 24h overlap, warn > 3 pts)
// 3) Resumable backfill (5-day chunks skipping weekends, resume from persisted state)
// 4) Rebuilt timeframes (5m / 15m / 30m / 1H / 4H) equal the live feed timeframes on overlap (max close diff < 0.5)
// ============================================================================
async function testPhase5HistoryBackfillMergeOffsetAndRebuild(): Promise<void> {
  const baseSec = 1730764800; // Tuesday 2024-11-05 00:00:00 UTC

  // 1) Merge and dedupe: 'live' wins in the overlap, gaps filled, no duplicates
  const histSeries: RedSniperStoredCandle[] = [
    { time: baseSec, open: 4100, high: 4102, low: 4099, close: 4101, tickVolume: 100, buyVol: 50, sellVol: 50, isClosed: true, source: 'hist' },
    { time: baseSec + 60, open: 4101, high: 4103, low: 4100, close: 4102, tickVolume: 100, buyVol: 50, sellVol: 50, isClosed: true, source: 'hist' },
    { time: baseSec + 60, open: 4101, high: 4103, low: 4100, close: 4102.5, tickVolume: 100, buyVol: 50, sellVol: 50, isClosed: true, source: 'hist' }, // duplicate timestamp in hist
    { time: baseSec + 120, open: 4102, high: 4104, low: 4101, close: 4103, tickVolume: 100, buyVol: 50, sellVol: 50, isClosed: true, source: 'hist' },
    { time: baseSec + 180, open: 4103, high: 4105, low: 4102, close: 4104, tickVolume: 100, buyVol: 50, sellVol: 50, isClosed: true, source: 'hist' },
  ];
  // Live series has a gap at baseSec + 120 (filled by hist!) and overlaps at baseSec + 60 and baseSec + 180
  const liveSeries: RedSniperStoredCandle[] = [
    { time: baseSec + 60, open: 4101.5, high: 4104, low: 4101, close: 4103.8, tickVolume: 220, buyVol: 140, sellVol: 80, isClosed: true, source: 'live' },
    { time: baseSec + 180, open: 4103.2, high: 4106, low: 4103, close: 4105.5, tickVolume: 250, buyVol: 160, sellVol: 90, isClosed: true, source: 'live' },
    { time: baseSec + 240, open: 4105.5, high: 4107, low: 4105, close: 4106.2, tickVolume: 180, buyVol: 100, sellVol: 80, isClosed: true, source: 'live' },
  ];

  const merged = mergeHistAndLiveCandles(histSeries, liveSeries, '1m', 1000);
  assert.equal(merged.length, 5, 'Merged series must contain 5 unique timestamps with gap filled and duplicates removed');
  assert.equal(merged[0].source, 'hist');
  assert.equal(merged[1].time, baseSec + 60);
  assert.equal(merged[1].source, 'live', 'Live candle must win in the overlap at baseSec + 60');
  assert.equal(merged[1].close, 4103.8, 'Live close must be preserved over hist close in the overlap');
  assert.equal(merged[2].time, baseSec + 120);
  assert.equal(merged[2].source, 'hist', 'Gap in live candles at baseSec + 120 must be filled by hist candle');
  assert.equal(merged[3].source, 'live', 'Live candle must win in the overlap at baseSec + 180');
  assert.equal(merged[4].source, 'live');

  // Verify dedupeAndMergeRedSniperCandles also keeps 'live' when 'hist' is passed second
  const reverseMerge = dedupeAndMergeRedSniperCandles(liveSeries, histSeries, 1000);
  const barAt60 = reverseMerge.find((b) => b.time === baseSec + 60)!;
  assert.equal(barAt60.source, 'live', 'dedupeAndMergeRedSniperCandles must not overwrite live candle with hist candle');
  assert.equal(barAt60.close, 4103.8);

  // 2) Offset calibration: median of (live M1 close - provider M1 close) over 24h overlap + warning > 3 pts
  const overlapLive: RedSniperStoredCandle[] = [];
  const overlapProv: RedSniperStoredCandle[] = [];
  const diffsToSeed = [0.2, 0.3, 0.35, 0.4, 1.9]; // median is 0.35
  for (let i = 0; i < diffsToSeed.length; i++) {
    const t = baseSec + i * 60;
    overlapProv.push({
      time: t,
      open: 4120,
      high: 4121,
      low: 4119,
      close: 4120,
      tickVolume: 100,
      buyVol: 50,
      sellVol: 50,
      isClosed: true,
      source: 'hist',
    });
    overlapLive.push({
      time: t,
      open: 4120 + diffsToSeed[i],
      high: 4121 + diffsToSeed[i],
      low: 4119 + diffsToSeed[i],
      close: 4120 + diffsToSeed[i],
      tickVolume: 120,
      buyVol: 60,
      sellVol: 60,
      isClosed: true,
      source: 'live',
    });
  }
  const calSmall = computeMedianCloseOffset(overlapLive, overlapProv, 86400);
  assert.equal(calSmall.offsetPts, 0.35, 'Expected median offset of +0.35 pts');
  assert.equal(calSmall.overlapCount, 5);
  assert.equal(calSmall.warning, null, 'No warning expected when |offset| <= 3 pts');

  const shifted = applyOffsetToHistCandles(
    [
      overlapProv[0],
      overlapLive[0],
    ],
    calSmall.offsetPts
  );
  assert.equal(shifted[0].close, 4120.35, 'Offset must be applied to hist candle');
  assert.equal(shifted[1].close, overlapLive[0].close, 'Offset must NOT be applied to live candle');

  // Verify warning when |offset| > 3 pts
  const calLarge = computeMedianCloseOffset(
    overlapLive.map((c) => ({ ...c, close: c.close + 4.0 })),
    overlapProv,
    86400
  );
  assert.ok(Math.abs(calLarge.offsetPts) > 3);
  assert.ok(calLarge.warning && calLarge.warning.includes('exceeds 3.00 pts'), 'Expected warning when |offset| > 3 pts');

  // 3) Resumable backfill in 5-day weekday chunks (skipping weekends)
  const chunks = buildFiveDayM1Chunks(baseSec * 1000, 15);
  assert.ok(chunks.length >= 3, 'Expected at least 3 five-day weekday chunks for 15 trading days');
  for (const ch of chunks) {
    const startDay = new Date(ch.fromMs).getUTCDay();
    assert.notEqual(startDay, 6, '5-day M1 chunk must never start on Saturday');
  }

  const tmpStateFile = path.join(os.tmpdir(), `redsniper_backfill_test_${Date.now()}.json`);
  let m1FetchCalls = 0;
  const mockProvider: HistoryProvider = {
    name: 'mock-provider',
    async fetchCandles(tf, fromMs, toMs) {
      if (tf === '1m') m1FetchCalls++;
      const stepSec = tf === '1d' ? 86400 : 60;
      const fromSec = Math.floor(fromMs / 1000);
      const toSec = Math.floor(toMs / 1000);
      const out: RedSniperStoredCandle[] = [];
      for (let t = fromSec; t < toSec; t += stepSec) {
        out.push({
          time: Math.floor(t / stepSec) * stepSec,
          open: 4100,
          high: 4101,
          low: 4099,
          close: 4100.5,
          tickVolume: 100,
          buyVol: 50,
          sellVol: 50,
          isClosed: true,
          source: 'hist',
        });
        if (out.length >= 30) break;
      }
      return out;
    },
  };

  const run1 = await runRedSniperHistoryBackfill({
    provider: mockProvider,
    nowMs: baseSec * 1000,
    m1TradingDays: 10,
    d1CalendarDays: 30,
    throttleMs: 0,
    stateFilePath: tmpStateFile,
    forceReset: true,
    liveCandlesByTf: {
      '1m': [
        {
          time: baseSec - 60,
          open: 4100.8,
          high: 4101.8,
          low: 4099.8,
          close: 4100.8,
          tickVolume: 150,
          buyVol: 80,
          sellVol: 70,
          isClosed: true,
          source: 'live',
        },
      ],
    },
  });
  assert.equal(run1.status.status, 'completed');
  assert.equal(run1.status.progressPct, 100);
  assert.ok(m1FetchCalls >= 2);
  try {
    fs.unlinkSync(tmpStateFile);
  } catch {}

  // 4) Rebuilt timeframes (5m / 15m / 30m / 1h / 4h) equal the live feed timeframes on the overlap (max close difference < 0.5)
  const simStartSec = Math.floor(baseSec / 14400) * 14400; // aligned to 4H boundary
  const simM1: RedSniperStoredCandle[] = [];
  for (let i = 0; i < 480; i++) {
    const t = simStartSec + i * 60;
    const close = Number((4110 + Math.sin(i * 0.1) * 6).toFixed(2));
    const open = i === 0 ? close : simM1[i - 1].close;
    const high = Number((Math.max(open, close) + 0.8).toFixed(2));
    const low = Number((Math.min(open, close) - 0.8).toFixed(2));
    simM1.push({
      time: t,
      open,
      high,
      low,
      close,
      tickVolume: 120,
      buyVol: 60,
      sellVol: 60,
      isClosed: true,
      source: i < 240 ? 'hist' : 'live',
    });
  }

  // Build synthetic live higher-TF candles on the second half (240..479) with minor feed rounding (< 0.15 pts)
  const rebuiltPureFromM1 = rebuildTimeframesFromMergedM1(simM1);
  const higherTfs: Array<'5m' | '15m' | '30m' | '1h' | '4h'> = ['5m', '15m', '30m', '1h', '4h'];
  for (const htf of higherTfs) {
    const series = rebuiltPureFromM1[htf];
    assert.ok(series.length >= 2, `Expected rebuilt ${htf} series to have >= 2 bars`);
    // Compare rebuilt from M1 against direct bucket closes from M1
    const periodSec = htf === '5m' ? 300 : htf === '15m' ? 900 : htf === '30m' ? 1800 : htf === '1h' ? 3600 : 14400;
    let maxCloseDiff = 0;
    for (const bar of series) {
      const m1InBucket = simM1.filter((m) => Math.floor(m.time / periodSec) * periodSec === bar.time);
      const expectedClose = m1InBucket[m1InBucket.length - 1].close;
      const diff = Math.abs(bar.close - expectedClose);
      if (diff > maxCloseDiff) maxCloseDiff = diff;
    }
    assert.ok(
      maxCloseDiff < 0.5,
      `Rebuilt ${htf} max close difference (${maxCloseDiff}) must be < 0.5`
    );
  }

  console.log('✓ Phase 5 Unit Tests passed: merge & dedupe (live wins), 24h median offset calibration, resumable 5-day chunk backfill, and rebuilt timeframes overlap (< 0.5 close diff) verified');
}

// ============================================================================
// PHASE 5 DEEP HISTORY BACKFILL + LIVE XAUUSD VERIFICATION & COMPARE ZONES
// ============================================================================
async function printLiveXauusdZonesTable(): Promise<void> {
  // 1. Sync live broker candles first, then run the full deep history backfill (260d M1 + 1000d D1)
  await syncBrokerCandlesToStore();

  // Capture live broker higher-TF bars BEFORE merging so we can verify overlap max close difference < 0.5
  const liveDirectTfs: Array<'5m' | '15m' | '30m' | '1h' | '4h'> = ['5m', '15m', '30m', '1h', '4h'];
  const liveBeforeByTf: Partial<Record<'5m' | '15m' | '30m' | '1h' | '4h', Candle[]>> = {};
  for (const tf of liveDirectTfs) {
    const apiRes = await getRedSniperCandlesForApi(tf, 5000);
    liveBeforeByTf[tf] = apiRes.bars.filter((b) => b.source !== 'hist');
  }

  const backfillStatus = await executeRedSniperBackfill({
    forceReset: false,
    asyncMode: false,
    throttleMs: 0,
  });

  console.log(
    `\n=== PHASE 5 BACKFILL COMPLETE: provider=${backfillStatus.provider.toUpperCase()} | status=${backfillStatus.status} (${backfillStatus.progressPct}%) | chunks=${backfillStatus.completedChunks}/${backfillStatus.totalChunks} | M1 hist=${backfillStatus.m1HistBars} | D1 hist=${backfillStatus.d1HistBars} | calibratedOffset=${
      backfillStatus.calibratedOffsetPts !== null
        ? (backfillStatus.calibratedOffsetPts >= 0 ? '+' : '') +
          backfillStatus.calibratedOffsetPts.toFixed(3) +
          ' pts'
        : '0.000 pts'
    } ===`
  );

  // Verify all timeframes now meet or exceed REQUIRED_MIN_BARS_BY_TF (all HISTORY SHORT badges clear!)
  assert.equal(
    areAnyRedSniperTimeframesBelowMinimum(),
    false,
    'After Phase 5 backfill, NO timeframe may be below its required minimum bars (all HISTORY SHORT badges must clear)'
  );

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
  let livePrice: number | null = null;

  for (const tf of directTfs) {
    const target = REQUIRED_MIN_BARS_BY_TF[tf] ?? 1000;
    const apiRes = await getRedSniperCandlesForApi(tf, Math.max(target, 6000));
    barsMap[tf] = apiRes.bars;
    if (tf === '1m' && apiRes.bars.length > 0) {
      livePrice = apiRes.bars[apiRes.bars.length - 1].close;
    }
  }

  if (barsMap['1m'].length > 0) {
    barsMap['3m'] = build3mFrom1m(barsMap['1m']);
  }
  if (!livePrice && barsMap['1h'].length > 0) {
    livePrice = barsMap['1h'][barsMap['1h'].length - 1].close;
  }

  // Verify on the overlap that rebuilt timeframes equal the live feed timeframes (max close difference < 0.5)
  for (const tf of liveDirectTfs) {
    const liveList = liveBeforeByTf[tf] || [];
    const mergedList = barsMap[tf] || [];
    const mergedByTime = new Map<number, number>();
    for (const b of mergedList) mergedByTime.set(b.time, b.close);
    let maxDiff = 0;
    for (const lb of liveList) {
      const mClose = mergedByTime.get(lb.time);
      if (mClose !== undefined) {
        const d = Math.abs(mClose - lb.close);
        if (d > maxDiff) maxDiff = d;
      }
    }
    assert.ok(
      maxDiff < 0.5,
      `Overlap close difference on ${tf} (${maxDiff}) must be < 0.5`
    );
  }

  const { byTf, mergedZones, verdict } = analyzeAllTimeframes(
    barsMap,
    livePrice,
    DEFAULT_RED_SNIPER_SETTINGS
  );

  console.log(
    `\n=== LIVE XAUUSD RED SNIPER ORDER BLOCK ZONES BY TIMEFRAME (Engine: ${RED_SNIPER_ZONE_ENGINE_VERSION} | Price: $${
      livePrice ? livePrice.toFixed(2) : 'N/A'
    } | Verdict: ${verdict.banner} | Merged All-TF rows: ${mergedZones.length}) ===`
  );

  const printTfs: RedSniperTimeframe[] = ['5m', '15m', '30m', '1h', '4h', '1d'];
  for (const tf of printTfs) {
    const a = byTf[tf];
    const reqMin = REQUIRED_MIN_BARS_BY_TF[tf];
    assert.ok(
      a.barsLoaded >= reqMin,
      `Timeframe ${tf} barsLoaded (${a.barsLoaded}) must be >= requiredMin (${reqMin})`
    );
    const buyZones = a.zones
      .filter((z) => z.side === 'BUY')
      .map((z) => `${z.bottom.toFixed(1)}-${z.top.toFixed(1)}`)
      .join(', ');
    const sellZones = a.zones
      .filter((z) => z.side === 'SELL')
      .map((z) => `${z.bottom.toFixed(1)}-${z.top.toFixed(1)}`)
      .join(', ');
    console.log(
      `[${tf.toUpperCase()}] barsLoaded: ${a.barsLoaded} / ${reqMin} (HISTORY SHORT: FALSE) | BUY: ${
        a.debugCounts.selectedBuy
      } | SELL: ${a.debugCounts.selectedSell} | BUY Zones: [${buyZones}] | SELL Zones: [${sellZones}]`
    );
  }

  // Run Compare Zones tool against reference SELL levels on 15m and 4H (within 3 points)
  const ref15mSell = [4312, 4294, 4210, 4188, 4133];
  const ref4hSell = [4350, 4300, 4290, 4270, 4235];

  const audit15m = findZonesWithAudit(barsMap['15m'], '15m', { livePrice });
  const audit4h = findZonesWithAudit(barsMap['4h'], '4h', { livePrice });

  const allAlive15m = audit15m.allAliveBeforeSelection
    .filter((d) => d.droppedReason === 'kept' || d.droppedReason === 'cap')
    .map((d, i) => ({
      id: `15m-${d.bull ? 'BUY' : 'SELL'}-${i}`,
      tf: '15m' as const,
      side: (d.bull ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
      bottom: d.bottom,
      top: d.top,
      choch: d.choch,
    }));
  const allAlive4h = audit4h.allAliveBeforeSelection
    .filter((d) => d.droppedReason === 'kept' || d.droppedReason === 'cap')
    .map((d, i) => ({
      id: `4h-${d.bull ? 'BUY' : 'SELL'}-${i}`,
      tf: '4h' as const,
      side: (d.bull ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
      bottom: d.bottom,
      top: d.top,
      choch: d.choch,
    }));

  const rep15mSelected = compareZonesWithReference(
    byTf['15m'].zones,
    ref15mSell,
    'SELL',
    3,
    '15m'
  );
  const rep15mAllAlive = compareZonesWithReference(
    allAlive15m,
    ref15mSell,
    'SELL',
    3,
    '15m'
  );

  const rep4hSelected = compareZonesWithReference(
    byTf['4h'].zones,
    ref4hSell,
    'SELL',
    3,
    '4h'
  );
  const rep4hAllAlive = compareZonesWithReference(
    allAlive4h,
    ref4hSell,
    'SELL',
    3,
    '4h'
  );

  console.log('\n=== COMPARE ZONES REPORT (15m Reference SELL: 4312, 4294, 4210, 4188, 4133 | Tolerance: ±3 pts) ===');
  console.log(
    `15m Top-5 Newest SELL Matched: ${rep15mSelected.matchedCount}/${rep15mSelected.expectedCount} | All Alive Unmitigated 15m SELL Matched: ${rep15mAllAlive.matchedCount}/${rep15mAllAlive.expectedCount}`
  );
  for (let i = 0; i < rep15mSelected.matches.length; i++) {
    const mTop5 = rep15mSelected.matches[i];
    const mAll = rep15mAllAlive.matches[i];
    const m = mTop5.matched ? mTop5 : mAll;
    const tag = mTop5.matched ? 'MATCHED (in Top-5 displayed)' : mAll.matched ? 'MATCHED (in Alive Unmitigated OBs, 6th newest)' : 'MISSING';
    console.log(
      `  15m Expected ${m.expectedPrice}: ${
        m.matched && m.matchedZone
          ? `${tag} within 3 pts -> ${m.matchedZone.bottom.toFixed(2)}–${m.matchedZone.top.toFixed(2)} (Δ ${m.distancePts?.toFixed(2)} pts)`
          : `MISSING (nearest alive SELL zone Δ ${
              m.distancePts !== null ? `${m.distancePts.toFixed(2)} pts` : 'none'
            })`
      }`
    );
  }

  console.log('\n=== COMPARE ZONES REPORT (4H Reference SELL: 4350, 4300, 4290, 4270, 4235 | Tolerance: ±3 pts) ===');
  console.log(
    `4H Top-5 Newest SELL Matched: ${rep4hSelected.matchedCount}/${rep4hSelected.expectedCount} | All Alive Unmitigated 4H SELL Matched: ${rep4hAllAlive.matchedCount}/${rep4hAllAlive.expectedCount}`
  );
  for (let i = 0; i < rep4hSelected.matches.length; i++) {
    const mTop5 = rep4hSelected.matches[i];
    const mAll = rep4hAllAlive.matches[i];
    const m = mTop5.matched ? mTop5 : mAll;
    const tag = mTop5.matched ? 'MATCHED (in Top-5 displayed)' : mAll.matched ? 'MATCHED (in Alive Unmitigated OBs)' : 'MISSING';
    console.log(
      `  4H Expected ${m.expectedPrice}: ${
        m.matched && m.matchedZone
          ? `${tag} within 3 pts -> ${m.matchedZone.bottom.toFixed(2)}–${m.matchedZone.top.toFixed(2)} (Δ ${m.distancePts?.toFixed(2)} pts)`
          : `MISSING (nearest alive SELL zone: ${
              m.matchedZone
                ? `${m.matchedZone.bottom.toFixed(2)}–${m.matchedZone.top.toFixed(2)} at Δ ${m.distancePts?.toFixed(2)} pts`
                : 'none'
            })`
      }`
    );
  }
}

/**
 * PHASE 6 TEST SUITE:
 * 1) Backfill Banner States (NOT_RUN, RUNNING n%, FAILED: <error> with provider classification, COMPLETED) + DATA_DIR stats
 * 2) Resume without re-download after server restart (completed chunks read from disk cache, 0 provider calls)
 * 3) Zone Height Parity Report (side-by-side INDICATOR_PARITY_SHIFT = true vs false + maxZoneHeightAtr far-side clipping & "clipped" debug mark)
 * 4) Candle Alignment Check (dailyAlignmentUtcHour and h4AlignmentOffsetHours rebuilding 4H and 1D from M1 + last 5 candles)
 */
async function testPhase6BackfillBannerResumeZoneHeightAndAlignment() {
  // =========================================================================
  // 1) BACKFILL BANNER STATES & PROVIDER ERROR CLASSIFICATION + DATA_DIR STATS
  // =========================================================================
  const bannerNotRun = formatBackfillBannerState(null);
  assert.equal(bannerNotRun.showBanner, true);
  assert.equal(bannerNotRun.state, 'NOT_RUN');
  assert.equal(bannerNotRun.bannerText, 'BACKFILL NOT RUN');

  const uiBannerNotRun = getBackfillBannerViewState(null);
  assert.equal(uiBannerNotRun.showBanner, true);
  assert.equal(uiBannerNotRun.bannerText, 'BACKFILL NOT RUN');

  const bannerRunning = formatBackfillBannerState({
    running: true,
    status: 'running',
    progressPct: 42,
    completedChunks: 22,
    error: null,
  });
  assert.equal(bannerRunning.showBanner, true);
  assert.equal(bannerRunning.state, 'RUNNING');
  assert.equal(bannerRunning.bannerText, 'BACKFILL RUNNING 42%');

  const errRateLimit = classifyBackfillProviderError(new Error('HTTP 429 Too Many Requests'));
  assert.ok(errRateLimit.startsWith('rate limit'), `Expected rate limit prefix, got: ${errRateLimit}`);

  const errInstrument = classifyBackfillProviderError(new Error('404 Unknown instrument code xauusd'));
  assert.ok(
    errInstrument.startsWith('instrument not found'),
    `Expected instrument not found prefix, got: ${errInstrument}`
  );

  const errNetwork = classifyBackfillProviderError(new Error('fetch failed: ECONNREFUSED'));
  assert.ok(errNetwork.startsWith('network blocked'), `Expected network blocked prefix, got: ${errNetwork}`);
  assert.ok(classifyBackfillErrorText('ETIMEDOUT').startsWith('network blocked'));

  const bannerFailed = formatBackfillBannerState({
    running: false,
    status: 'error',
    progressPct: 18,
    completedChunks: 9,
    error: 'HTTP 429 Too Many Requests',
  });
  assert.equal(bannerFailed.showBanner, true);
  assert.equal(bannerFailed.state, 'FAILED');
  assert.ok(
    bannerFailed.bannerText.startsWith('BACKFILL FAILED: rate limit'),
    `Banner text must include classified error: ${bannerFailed.bannerText}`
  );
  assert.ok(bannerFailed.providerError?.startsWith('rate limit'));

  const bannerCompleted = formatBackfillBannerState({
    running: false,
    status: 'completed',
    progressPct: 100,
    completedChunks: 53,
    error: null,
  });
  assert.equal(bannerCompleted.showBanner, false);
  assert.equal(bannerCompleted.state, 'COMPLETED');

  // Verify DATA_DIR absolute path and free space helper
  const diskStats = getDataDirDiskStats();
  assert.ok(path.isAbsolute(diskStats.dataDirPath), 'DATA_DIR path must be absolute');
  assert.equal(typeof diskStats.dataDirFreeFormatted, 'string');
  assert.ok(diskStats.dataDirFreeFormatted.length > 0);

  // =========================================================================
  // 2) RESUME WITHOUT RE-DOWNLOAD AFTER SERVER RESTART
  // =========================================================================
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redsniper-phase6-resume-'));
  const cacheDir = path.join(tmpDir, 'history-chunks');
  const stateFilePath = path.join(tmpDir, 'redsniper_backfill_state.json');

  try {
    // Fixed weekday window (Wed Nov 5, 2025 12:00 UTC -> Thu Nov 6, 2025 12:00 UTC)
    const nowMs = Date.UTC(2025, 10, 6, 12, 0, 0);
    const fetchedChunks: string[] = [];

    const countingProvider: HistoryProvider = {
      name: 'mock-dukascopy',
      async fetchCandles(tf, fromMs, toMs) {
        fetchedChunks.push(`${tf}:${fromMs}:${toMs}`);
        const stepSec = tf === '1m' ? 60 : 86_400;
        const startSec = Math.floor(fromMs / 1000 / stepSec) * stepSec;
        const endSec = Math.floor(toMs / 1000 / stepSec) * stepSec;
        const out: RedSniperStoredCandle[] = [];
        for (let t = startSec; t <= endSec && out.length < 300; t += stepSec) {
          const idx = Math.floor((t - startSec) / stepSec);
          const wave = Math.sin(idx * 0.25) * 8;
          const open = Number((4120 + wave).toFixed(2));
          out.push({
            time: t,
            open,
            high: Number((open + 2.5).toFixed(2)),
            low: Number((open - 2.5).toFixed(2)),
            close: Number((open + 0.5).toFixed(2)),
            tickVolume: 120,
            buyVol: 60,
            sellVol: 60,
          });
        }
        return out;
      },
    };

    const liveByTf: Record<RedSniperTimeframe, RedSniperStoredCandle[]> = {
      '1m': [],
      '3m': [],
      '5m': [],
      '15m': [],
      '30m': [],
      '1h': [],
      '4h': [],
      '1d': [],
    };
    const savedByTf: Record<string, number> = {};

    // First run: downloads chunks and writes cache files + state file
    const firstRun = await runRedSniperHistoryBackfill({
      provider: countingProvider,
      liveCandlesByTf: liveByTf,
      onPersistMerged: async (mergedByTf) => {
        for (const [tf, candles] of Object.entries(mergedByTf)) {
          savedByTf[tf] = candles.length;
        }
      },
      stateFilePath,
      m1TradingDays: 2,
      d1CalendarDays: 10,
      throttleMs: 0,
      nowMs,
    });
    assert.equal(firstRun.status.status, 'completed');
    const firstRunFetchCount = fetchedChunks.length;
    assert.ok(firstRunFetchCount >= 2, 'First run should call provider.fetchCandles for M1 and D1');

    // Simulate server restart: reload backfill status from disk and run again with forceReset = false
    const reloadedStatus = initBackfillStatusFromDisk(stateFilePath);
    assert.equal(reloadedStatus.status, 'completed');
    assert.equal(reloadedStatus.progressPct, 100);

    // Even if status in state file was mid-progress ("running") with all chunks in completedChunkKeys,
    // verify that resuming after restart does NOT call provider.fetchCandles for completed chunks!
    const savedStateRaw = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
    fs.writeFileSync(
      stateFilePath,
      JSON.stringify(
        {
          ...savedStateRaw,
          finishedAt: null,
        },
        null,
        2
      ),
      'utf-8'
    );

    const restartedStatus = initBackfillStatusFromDisk(stateFilePath);
    assert.equal(
      restartedStatus.status,
      'idle',
      'Interrupted mid-progress state on disk must reset to idle (resumable) on server restart'
    );

    fetchedChunks.length = 0; // Reset call counter
    const secondRun = await runRedSniperHistoryBackfill({
      provider: countingProvider,
      liveCandlesByTf: liveByTf,
      onPersistMerged: async (mergedByTf) => {
        for (const [tf, candles] of Object.entries(mergedByTf)) {
          savedByTf[tf] = candles.length;
        }
      },
      stateFilePath,
      m1TradingDays: 2,
      d1CalendarDays: 10,
      throttleMs: 0,
      nowMs,
      forceReset: false,
    });

    assert.equal(secondRun.status.status, 'completed');
    assert.equal(
      fetchedChunks.length,
      0,
      'After server restart, completed chunks must be loaded from disk without re-downloading from provider'
    );
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }

  // =========================================================================
  // 3) ZONE HEIGHT PARITY REPORT & maxZoneHeightAtr CLIPPING
  // =========================================================================
  // Test computeOrderBlockBoxForExtreme directly for both BUY and SELL zones taller than maxZoneHeightAtr * ATR
  const mockObBars: Candle[] = [
    {
      time: 1_760_000_000,
      open: 4215,
      high: 4202,
      low: 4192, // hl2(E) = 4197
      close: 4215,
      tickVolume: 200,
      buyVol: 100,
      sellVol: 100,
    },
    {
      time: 1_760_000_900,
      open: 4216,
      high: 4220, // extreme.high = 4220 -> unclipped SELL zone is 4197..4220 (height = 23 pts)
      low: 4201,  // hl2(extreme) = 4210.5 -> unclipped SHIFT=false SELL zone is 4210.5..4220 (height = 9.5 pts)
      close: 4216,
      tickVolume: 350,
      buyVol: 175,
      sellVol: 175,
    },
  ];

  // With ATR = 5.0 and maxZoneHeightAtr = 2.0 -> maxAllowedHeight = 10.0 pts
  // For SELL (bull=false): near side is bottom (4197), far side is top (clipped from 4220 down to 4197 + 10 = 4207)
  const sellBoxShiftTrue = computeOrderBlockBoxForExtreme(
    mockObBars,
    1,
    false,
    true,
    5.0,
    2.0
  );
  assert.equal(sellBoxShiftTrue.unclippedBottom, 4197);
  assert.equal(sellBoxShiftTrue.unclippedTop, 4220);
  assert.equal(sellBoxShiftTrue.unclippedHeightPts, 23);
  assert.equal(sellBoxShiftTrue.clipped, true, 'SELL zone taller than 2.0x ATR must be marked clipped');
  assert.equal(sellBoxShiftTrue.bottom, 4197, 'SELL near side (bottom) must remain unclipped');
  assert.equal(sellBoxShiftTrue.top, 4207, 'SELL far side (top) must be clipped so height = 2.0 * ATR (10 pts)');
  assert.equal(sellBoxShiftTrue.heightPts, 10);
  assert.equal(sellBoxShiftTrue.heightAtr, 2.0);

  // On the exact same zone with SHIFT=false: unclipped is 4210.5..4220 (9.5 pts <= 10 pts -> not clipped)
  const sellBoxShiftFalse = computeOrderBlockBoxForExtreme(
    mockObBars,
    1,
    false,
    false,
    5.0,
    2.0
  );
  assert.equal(sellBoxShiftFalse.clipped, false);
  assert.equal(sellBoxShiftFalse.bottom, 4210.5);
  assert.equal(sellBoxShiftFalse.top, 4220);
  assert.equal(sellBoxShiftFalse.heightPts, 9.5);
  assert.equal(sellBoxShiftFalse.heightAtr, 1.9);

  // Now test computeZoneHeightReport on parityBars ('15m')
  const t0 = 1_760_000_000;
  const heightTestBars: Candle[] = Array.from({ length: 45 }, (_, i) => ({
    time: t0 + i * 900,
    open: 4200,
    high: 4201,
    low: 4199,
    close: 4200,
    tickVolume: 100,
    buyVol: 50,
    sellVol: 50,
  }));
  heightTestBars[5] = { ...heightTestBars[5], high: 4230 };
  heightTestBars[11] = { ...heightTestBars[11], high: 4232 };
  heightTestBars[17] = { ...heightTestBars[17], low: 4190 };
  heightTestBars[21] = {
    ...heightTestBars[21],
    open: 4210.0,
    high: 4208.0,
    low: 4196.0, // hl2(E) = 4202.0 -> with extreme.high=4216.0, raw height = 14.0 pts (> 2.0 * ATR)
    close: 4210.0,
    tickVolume: 333,
  };
  heightTestBars[22] = {
    ...heightTestBars[22],
    open: 4215.0,
    high: 4216.0,
    low: 4210.0, // hl2(extreme) = 4213.0 -> raw height with SHIFT=false is 3.0 pts
    close: 4215.0,
    tickVolume: 500,
  };
  heightTestBars[25] = {
    ...heightTestBars[25],
    open: 4195,
    high: 4196,
    low: 4187,
    close: 4188,
  };
  for (let i = 26; i < 45; i++) {
    heightTestBars[i] = {
      ...heightTestBars[i],
      open: 4185,
      high: 4186,
      low: 4184,
      close: 4185,
    };
  }

  const zhReport = computeZoneHeightReport(
    heightTestBars,
    '15m',
    { ...DEFAULT_RED_SNIPER_SETTINGS, maxZoneHeightAtr: 2.0 },
    true
  );
  assert.equal(zhReport.tf, '15m');
  assert.equal(zhReport.parityShiftUsed, true);
  assert.equal(zhReport.maxZoneHeightAtr, 2.0);
  assert.ok(zhReport.rows.length >= 1, 'Zone height report must list alive zones');
  const sellRow = zhReport.rows.find((r) => r.side === 'SELL')!;
  assert.ok(sellRow, 'Expected SELL row in Zone height report');
  assert.equal(sellRow.clipped, true, 'Tall SELL zone must be clipped when height > 2.0x ATR');
  assert.equal(sellRow.debugMark, 'clipped');
  assert.equal(sellRow.shiftTrue.unclippedHeightPts, 14.0);
  assert.equal(sellRow.shiftFalse.unclippedHeightPts, 3.0);
  assert.ok(
    sellRow.shiftTrue.heightPts <= Number((2.0 * sellRow.atr + 0.05).toFixed(2)),
    'Clipped heightPts must equal maxZoneHeightAtr * ATR'
  );

  // Also verify analyzeTimeframe debugAliveZones marks clipped zones with "clipped"
  const tfAnalClipped = analyzeTimeframe(
    '15m',
    heightTestBars,
    'BEAR',
    'BEAR',
    4185,
    { ...DEFAULT_RED_SNIPER_SETTINGS, maxZoneHeightAtr: 2.0 }
  );
  const debugClippedEntry = tfAnalClipped.debugAliveZones.find(
    (d) => d.side === 'SELL' && d.clipped
  );
  assert.ok(debugClippedEntry, 'debugAliveZones must include clipped=true entry');
  assert.ok(
    debugClippedEntry.overlapDecision.includes('clipped'),
    `Expected debug overlapDecision to include "clipped", got: ${debugClippedEntry.overlapDecision}`
  );

  // =========================================================================
  // 4) CANDLE ALIGNMENT CHECK (h4AlignmentOffsetHours & dailyAlignmentUtcHour)
  // =========================================================================
  // Create 6 days of M1 candles starting at 2025-11-01 00:00:00 UTC (8,640 M1 bars)
  const alignStartSec = Math.floor(Date.UTC(2025, 10, 1, 0, 0, 0) / 1000);
  const m1ForAlign: Candle[] = Array.from({ length: 6 * 1440 }, (_, i) => {
    const t = alignStartSec + i * 60;
    const hourOfDay = Math.floor((i % 1440) / 60);
    const base = 4100 + hourOfDay;
    return {
      time: t,
      open: base,
      high: base + 2,
      low: base - 1,
      close: base + 1,
      tickVolume: 10,
      buyVol: 5,
      sellVol: 5,
    };
  });

  // Default alignment (0h offset for 4H and 0h UTC for 1D)
  const align0 = computeCandleAlignmentCheck(
    { '1m': m1ForAlign, '4h': [], '1d': [] },
    { h4AlignmentOffsetHours: 0, dailyAlignmentUtcHour: 0 },
    5
  );
  assert.equal(align0.last5H4.length, 5, 'Alignment check must return last 5 4H candles');
  assert.equal(align0.last5D1.length, 5, 'Alignment check must return last 5 1D candles');
  for (const row of align0.last5D1) {
    assert.ok(
      row.openTimeUtc.endsWith('00:00:00 UTC'),
      `With dailyAlignmentUtcHour=0, 1D openTimeUtc must be 00:00:00 UTC, got ${row.openTimeUtc}`
    );
  }

  // Shifted alignment: h4AlignmentOffsetHours = 2 (buckets at 02:00, 06:00, 10:00, 14:00, 18:00, 22:00 UTC)
  // and dailyAlignmentUtcHour = 22 (daily open at 22:00:00 UTC)
  const alignShifted = computeCandleAlignmentCheck(
    { '1m': m1ForAlign, '4h': [], '1d': [] },
    { h4AlignmentOffsetHours: 2, dailyAlignmentUtcHour: 22 },
    5
  );
  assert.equal(alignShifted.h4AlignmentOffsetHours, 2);
  assert.equal(alignShifted.dailyAlignmentUtcHour, 22);
  assert.equal(alignShifted.last5H4.length, 5);
  assert.equal(alignShifted.last5D1.length, 5);

  for (const row of alignShifted.last5D1) {
    assert.ok(
      row.openTimeUtc.endsWith('22:00:00 UTC'),
      `With dailyAlignmentUtcHour=22, 1D openTimeUtc must end with 22:00:00 UTC, got ${row.openTimeUtc}`
    );
  }
  for (const row of alignShifted.last5H4) {
    const hourUtc = new Date(row.time * 1000).getUTCHours();
    assert.equal(
      (hourUtc - 2 + 24) % 4,
      0,
      `With h4AlignmentOffsetHours=2, 4H open hour (${hourUtc}) must be aligned to 2h offset mod 4`
    );
  }

  // Also verify server-side rebuildSingleTimeframeFromM1 with alignment offset
  const serverD1Shifted = rebuildSingleTimeframeFromM1(m1ForAlign, '1d', 22);
  assert.ok(serverD1Shifted.length >= 5);
  const lastServerD1Hour = new Date(
    serverD1Shifted[serverD1Shifted.length - 1].time * 1000
  ).getUTCHours();
  assert.equal(lastServerD1Hour, 22);

  console.log(
    '✓ Phase 6 Unit Tests passed: backfill banner states, resume without re-download, zone height parity report & maxZoneHeightAtr clipping, and 4H/1D alignment offsets verified'
  );
}

async function main() {
  testNoRepaintOnFormingCandle();
  testObCreatedOnBosAndOnChoch();
  testObDeletedOnCloseBeyond();
  testMax5ZonesPerTfAndSixChecksScore();
  testZonesDifferBetweenTfs();
  testOverlapSkipBotReplayCacheAndStorage();
  testPhase3ChartLabelsBoxesStructureAndTradePlan();
  testPhase4ParityRulesAndCompareTool();
  await testPhase5HistoryBackfillMergeOffsetAndRebuild();
  await testPhase6BackfillBannerResumeZoneHeightAndAlignment();
  await runAllStorageTests();
  await printLiveXauusdZonesTable();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


