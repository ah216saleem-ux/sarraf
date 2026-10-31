import assert from 'node:assert/strict';
import { Candle, normalizeRedSniperCandle, sortAndDedupeCandles } from './feed';
import {
  DEFAULT_RED_SNIPER_SETTINGS,
  OpenSniperTrade,
  RedSniperDemoState,
  RedSniperSettings,
  analyzeTimeframe,
  advanceTrailingStopAfterTp1,
  buildZoneTradeParameters,
  computePivotRelativeTickVolume,
  computeZonePowerAndBreakdown,
  evaluateOriginCandidate,
  isZoneBrokenByClosedCandle,
  isZoneBrokenByLivePrice,
  stepAutoTraderOnTick,
  toFireZoneCandles,
} from './engine';
import { runFireZoneEngine, resetFireZoneEngineStore } from '../fireZone/engine';

function makeRealisticBars(count: number, withVolume: boolean = true): Candle[] {
  const bars: Candle[] = [];
  const startSec = 1711929600;
  for (let i = 0; i < count; i++) {
    // Multi-wave deterministic trajectory with clear L=5, L=20, L=50 swings
    const macroWave = Math.sin(i * 0.08) * 32;
    const medWave = Math.cos(i * 0.23) * 14;
    const microWave = Math.sin(i * 0.65) * 5;
    const base = 3000 + macroWave + medWave + microWave;

    const open = Number((base - 1.2).toFixed(2));
    const close = Number((base + 1.2).toFixed(2));
    const high = Number((Math.max(open, close) + 3.2).toFixed(2));
    const low = Number((Math.min(open, close) - 3.2).toFixed(2));
    const tickVolume = withVolume ? 100 + ((i * 37) % 180) : 0;

    bars.push({
      time: startSec + i * 3600,
      open,
      high,
      low,
      close,
      tickVolume,
      buyVol: withVolume ? Math.round(tickVolume * 0.55) : 0,
      sellVol: withVolume ? Math.round(tickVolume * 0.45) : 0,
    });
  }
  return bars;
}

// ============================================================================
// TEST 1: Zone selection count (<= maxZonesPerTf setting, 3..8, default 5)
// ============================================================================
function testZoneSelectionCount(): void {
  const bars = makeRealisticBars(220, true);
  const livePrice = bars[bars.length - 1].close;

  for (const maxZ of [3, 4, 5, 6, 8]) {
    const settings: RedSniperSettings = {
      ...DEFAULT_RED_SNIPER_SETTINGS,
      maxZonesPerTf: maxZ,
    };
    const res = analyzeTimeframe('15m', bars, 'BULL', 'BULL', livePrice, settings);
    assert.ok(
      res.zones.length <= maxZ,
      `Expected zones.length (${res.zones.length}) <= maxZonesPerTf (${maxZ})`
    );
    assert.ok(res.zones.length >= 2, 'Expected at least 1 BUY and 1 SELL zone');
  }

  // Verify zoneWidthMode: FIXED_4 vs ATR on non-H1 timeframe
  const fixedRes = analyzeTimeframe('15m', bars, 'BULL', 'BULL', livePrice, {
    ...DEFAULT_RED_SNIPER_SETTINGS,
    zoneWidthMode: 'FIXED_4',
  });
  assert.equal(fixedRes.halfWidth, 2.0, 'FIXED_4 mode must use halfWidth = 2.0 ($4 wide)');
  for (const z of fixedRes.zones) {
    assert.equal(
      Number((z.top - z.bottom).toFixed(2)),
      4.0,
      'FIXED_4 zone width must be $4.00'
    );
  }

  // H1 always uses 2.0 ($4 wide) even when zoneWidthMode is 'ATR'
  const h1Res = analyzeTimeframe('1h', bars, 'BULL', 'BULL', livePrice, {
    ...DEFAULT_RED_SNIPER_SETTINGS,
    zoneWidthMode: 'ATR',
  });
  assert.equal(h1Res.halfWidth, 2.0, 'H1 must always keep ZONE_HALF = 2.0 ($4 wide)');

  console.log('✓ Test 1 passed: Zone selection count (<= setting) & zoneWidthMode verified');
}

// ============================================================================
// TEST 2: SELL zones never below price & BUY zones never above price
//         (200-tick random walk + forced live break scenarios)
// ============================================================================
function testValidSideAndNoSellBelowPrice(): void {
  const bars = makeRealisticBars(220, true);
  let price = bars[bars.length - 2].close;

  // Deterministic PRNG for 200-tick walk
  let seed = 987654321;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let tick = 0; tick < 200; tick++) {
    const step = (nextRand() - 0.495) * 4.5;
    price = Number((price + step).toFixed(2));

    const res = analyzeTimeframe(
      '1h',
      bars,
      'NEUT',
      'NEUT',
      price,
      DEFAULT_RED_SNIPER_SETTINGS
    );

    for (const z of res.zones) {
      if (z.side === 'SELL') {
        assert.ok(
          z.anchor > price && z.top >= price,
          `Tick ${tick} @ ${price}: SELL zone ${z.id} (anchor=${z.anchor}, LO=${z.bottom}, HI=${z.top}) must not be below price`
        );
      } else {
        assert.ok(
          z.anchor < price && z.bottom <= price,
          `Tick ${tick} @ ${price}: BUY zone ${z.id} (anchor=${z.anchor}, LO=${z.bottom}, HI=${z.top}) must not be above price`
        );
      }
    }
  }

  // Forced live break above SELL NEAR (> HI + 0.5*ATR) and below BUY NEAR (< LO - 0.5*ATR)
  const baseRes = analyzeTimeframe('1h', bars, 'NEUT', 'NEUT', bars[bars.length - 2].close);
  const sellNear = baseRes.zones.find((z) => z.side === 'SELL' && z.slotType === 'NEAREST');
  const buyNear = baseRes.zones.find((z) => z.side === 'BUY' && z.slotType === 'NEAREST');
  assert.ok(sellNear && buyNear, 'Expected initial SELL NEAR and BUY NEAR zones');

  const breakAbovePrice = Number((sellNear.top + 0.65 * baseRes.atr14).toFixed(2));
  const afterSellBreak = analyzeTimeframe('1h', bars, 'NEUT', 'NEUT', breakAbovePrice);
  assert.ok(
    !afterSellBreak.zones.some((z) => z.id === sellNear.id),
    'Broken SELL NEAR zone must be excluded on live break > 0.5*ATR'
  );
  for (const z of afterSellBreak.zones.filter((z) => z.side === 'SELL')) {
    assert.ok(z.anchor > breakAbovePrice, 'Replacement SELL zones must be above broken price');
  }

  const breakBelowPrice = Number((buyNear.bottom - 0.65 * baseRes.atr14).toFixed(2));
  const afterBuyBreak = analyzeTimeframe('1h', bars, 'NEUT', 'NEUT', breakBelowPrice);
  assert.ok(
    !afterBuyBreak.zones.some((z) => z.id === buyNear.id),
    'Broken BUY NEAR zone must be excluded on live break > 0.5*ATR'
  );
  for (const z of afterBuyBreak.zones.filter((z) => z.side === 'BUY')) {
    assert.ok(z.anchor < breakBelowPrice, 'Replacement BUY zones must be below broken price');
  }

  console.log('✓ Test 2 passed: SELL zones never below price & BUY zones never above price (200 ticks + forced breaks)');
}

// ============================================================================
// TEST 3: DEAD rule (closed candle > 0.25*ATR beyond far edge kills; wicks never kill)
// ============================================================================
function testDeadRule(): void {
  const atr = 10.0; // 0.25*ATR = 2.5, 0.5*ATR = 5.0
  const anchor = 3000;
  const halfWidth = 2.0; // LO = 2998, HI = 3002

  const pivotObj = {
    index: 0,
    time: 1000,
    type: 'HIGH' as const,
    price: anchor,
    level: 20 as const,
  };

  // Case A: Wick goes far beyond HI (e.g. 3025), but close is 3004 (<= 3002 + 2.5 = 3004.5) -> NOT dead
  const candlesWickOnly = [
    { time: 1000, open: 2995, high: 3000, low: 2990, close: 2995, volume: 100 }, // pivot
    { time: 2000, open: 2995, high: 2996, low: 2965, close: 2970, volume: 120 }, // departure >= 3 ATR
    { time: 3000, open: 2996, high: 3025, low: 2995, close: 3004.0, volume: 110 }, // huge wick, close within 0.25*ATR
  ];
  const evalWick = evaluateOriginCandidate(
    pivotObj,
    candlesWickOnly,
    atr,
    3,
    halfWidth
  );
  assert.ok(evalWick !== null, 'Wicks beyond far edge must NEVER kill a zone');

  // Case B: Closed candle closes at 3004.6 (> 3002 + 0.25*10 = 3004.5) -> DEAD (discarded)
  const candlesClosedBreak = [
    { time: 1000, open: 2995, high: 3000, low: 2990, close: 2995, volume: 100 },
    { time: 2000, open: 2995, high: 2996, low: 2965, close: 2970, volume: 120 },
    { time: 3000, open: 2996, high: 3008, low: 2995, close: 3004.6, volume: 110 }, // close > HI + 0.25*ATR
  ];
  const evalDead = evaluateOriginCandidate(
    pivotObj,
    candlesClosedBreak,
    atr,
    3,
    halfWidth
  );
  assert.equal(
    evalDead,
    null,
    'Closed candle closing > 0.25*ATR beyond far edge must mark zone DEAD (null)'
  );

  // Also check helper functions directly
  assert.equal(
    isZoneBrokenByClosedCandle('SELL', 2998, 3002, { close: 3004.4 }, 10).broken,
    false
  );
  assert.equal(
    isZoneBrokenByClosedCandle('SELL', 2998, 3002, { close: 3004.6 }, 10).broken,
    true
  );
  assert.equal(isZoneBrokenByLivePrice('SELL', 2998, 3002, 3006.9, 10).broken, false);
  assert.equal(isZoneBrokenByLivePrice('SELL', 2998, 3002, 3007.1, 10).broken, true);

  console.log('✓ Test 3 passed: DEAD rule (> 0.25*ATR close kills, wicks never kill, > 0.5*ATR live break)');
}

// ============================================================================
// TEST 4: POWER 0-99 formula & missing tickVolume weight re-normalization
// ============================================================================
function testPowerWithAndWithoutVolume(): void {
  // 1) With valid volume (volMult = 1.8x, cap 2.5x -> volNorm = 1.8/2.5 = 0.72)
  // score = 9 -> scoreNorm = 9/14 = 0.642857...
  // retests = 0 -> freshness = 1.0
  // HTF: bias1h = BEAR, bias4h = BEAR for SELL -> htfNorm = 1.0
  // expected = round(100 * (0.45*(9/14) + 0.25*(1.8/2.5) + 0.15*1 + 0.15*1))
  //          = round(100 * (0.2892857 + 0.18 + 0.15 + 0.15)) = round(76.92857) = 77
  const withVol = computeZonePowerAndBreakdown({
    side: 'SELL',
    score: 9,
    strengthLabel: 'STRONG',
    retests: 0,
    departureAtr: 2.4,
    volMult: 1.8,
    bias1h: 'BEAR',
    bias4h: 'BEAR',
  });
  assert.equal(withVol.power, 77);
  assert.equal(
    withVol.breakdown,
    'score 9 STRONG · retests 0 · vol 1.8x · dep 2.4 ATR · HTF ok'
  );

  // 2) With missing volume (volMult = null):
  // Drop 0.25 term and re-normalize remaining weights by 0.75 (0.45 + 0.15 + 0.15 = 0.75)
  // expected = round(100 * ((0.45*(9/14) + 0.15*1 + 0.15*1) / 0.75))
  //          = round(100 * (0.5892857 / 0.75)) = round(78.5714) = 79
  const missingVol = computeZonePowerAndBreakdown({
    side: 'SELL',
    score: 9,
    strengthLabel: 'STRONG',
    retests: 0,
    departureAtr: 2.4,
    volMult: null,
    bias1h: 'BEAR',
    bias4h: 'BEAR',
  });
  assert.equal(missingVol.power, 79);
  assert.equal(
    missingVol.breakdown,
    'score 9 STRONG · retests 0 · vol -- · dep 2.4 ATR · HTF ok'
  );

  // Verify computePivotRelativeTickVolume returns null when any bar in pivot..pivot+3 has tickVolume <= 0
  const barsNoVol = makeRealisticBars(40, false);
  assert.equal(
    computePivotRelativeTickVolume(barsNoVol, 25),
    null,
    'Missing tickVolume must return null, never a faked number'
  );

  console.log('✓ Test 4 passed: Power 0-99 formula & missing tickVolume weight re-normalization ("vol --")');
}

// ============================================================================
// TEST 5: SL / TP / Trailing Stop after TP1 math
// ============================================================================
function testSlTpAndTrailingStopMath(): void {
  const buyZone = {
    id: '15m-FZ-BUY-2995',
    tf: '15m' as const,
    side: 'BUY' as const,
    slotType: 'NEAREST' as const,
    strengthLabel: 'STRONG' as const,
    score: 9,
    anchor: 3000,
    top: 3002,
    bottom: 2998,
    width: 4,
    pivotIdx: 50,
    pivotTime: 1711929600,
    pivotLevel: 20 as const,
    retests: 0,
    touches: 0,
    maxPenetration: 0,
    pctLeft: 100,
    status: 'FRESH' as const,
    power: 82,
    departureAtr: 2.4,
    volMult: 1.8,
    htfOk: true,
    htfLabel: 'HTF ok' as const,
    breakdown: 'score 9 STRONG · retests 0 · vol 1.8x · dep 2.4 ATR · HTF ok',
    atr14: 4.0,
  };

  // Opposite SELL zone with bottom at 3015 (3.4R away when entry=3000, risk=4.4 -> 3.4*4.4 = 14.96)
  // Let's test entry = 3000.5, slBuffer = 1.5 -> SL = 2998 - 1.5 = 2996.5 -> riskPoints = 4.0
  // Opposite SELL zone with bottom = 3014.0 (dist = 13.5 = 3.375R, within [2.5R=10, 6R=24])
  const oppSellZone = {
    ...buyZone,
    id: '15m-FZ-SELL-3016',
    side: 'SELL' as const,
    anchor: 3016,
    top: 3018,
    bottom: 3014,
  };

  const settings: RedSniperSettings = {
    ...DEFAULT_RED_SNIPER_SETTINGS,
    slBuffer: 1.5,
    trailTrigger: 2.0,
    trailStep: 1.5,
  };

  const plan = buildZoneTradeParameters(
    buyZone,
    3000.5,
    1000,
    [buyZone, oppSellZone],
    'BULL',
    'BULL',
    settings
  );

  // SL = bottom (2998) - slBuffer (1.5) = 2996.50 (NOT Fire Zone $12 stop!)
  assert.equal(plan.sl, 2996.5);
  assert.equal(plan.riskPoints, 4.0);
  assert.equal(plan.tp1, 3004.5); // 1R
  assert.equal(plan.tp2, 3008.5); // 2R
  assert.equal(plan.tp3, 3014.0); // snapped to opposite Fire Zone bottom (3.375R)
  assert.equal(plan.tp3IsLiquidity, true);

  // Step through AutoTrader lifecycle:
  let state: RedSniperDemoState = {
    balance: 1000,
    autoEnabled: true,
    openTrades: [],
    closedTrades: [],
    usedZoneIds: [],
  };

  // 1) Price enters BUY zone at 3000.5 -> opens trade
  const step1 = stepAutoTraderOnTick(
    state,
    3000.5,
    [buyZone, oppSellZone],
    'BULL',
    'BULL',
    'LONDON',
    1000,
    settings
  );
  assert.equal(step1.changed, true);
  assert.equal(step1.nextState.openTrades.length, 1);
  state = step1.nextState;

  // 2) Price reaches TP1 (3004.5) -> closes 50%, moves SL to entry (3000.5 = BE), isTrailing = false
  const step2 = stepAutoTraderOnTick(
    state,
    3004.5,
    [buyZone, oppSellZone],
    'BULL',
    'BULL',
    'LONDON',
    2000,
    settings
  );
  state = step2.nextState;
  const tAfterTp1: OpenSniperTrade = state.openTrades[0];
  assert.equal(tAfterTp1.tp1Hit, true);
  assert.equal(tAfterTp1.remPct, 0.5);
  assert.equal(tAfterTp1.sl, 3000.5, 'At TP1, SL must move to entry (break-even)');
  assert.equal(tAfterTp1.isTrailing, false, 'At BE, isTrailing is false (SL line hidden)');

  // 3) Price moves +$2.0 beyond TP1 to 3006.5 (trailTrigger = $2.0) -> SL moves forward by trailStep ($1.5) to 3002.0
  const step3 = stepAutoTraderOnTick(
    state,
    3006.5,
    [buyZone, oppSellZone],
    'BULL',
    'BULL',
    'LONDON',
    3000,
    settings
  );
  state = step3.nextState;
  const tAfterTrail1 = state.openTrades[0];
  assert.equal(tAfterTrail1.sl, 3002.0, 'First trail trigger (+2$) moves SL from 3000.5 to 3002.0 (+1.5$)');
  assert.equal(tAfterTrail1.trailRef, 3006.5);
  assert.equal(tAfterTrail1.isTrailing, true, 'Once SL > entry, isTrailing must be true (show TRAIL line)');
  assert.ok(
    step3.enteredText?.includes('TRAIL BUY 15m: SL → $3002.00'),
    `Expected trail log in bot status, got: ${step3.enteredText}`
  );

  // 4) Price dips slightly to 3005.0 -> SL must NEVER move backward
  const dipRes = advanceTrailingStopAfterTp1(tAfterTrail1, 3005.0, 2.0, 1.5);
  assert.equal(dipRes.moved, false);
  assert.equal(dipRes.updatedTrade.sl, 3002.0, 'SL must never move backward');

  // 5) Price advances another +$2.0 to 3008.5 (hits TP2 and second trail step -> SL = 3003.5)
  const step4 = stepAutoTraderOnTick(
    state,
    3008.5,
    [buyZone, oppSellZone],
    'BULL',
    'BULL',
    'LONDON',
    4000,
    settings
  );
  state = step4.nextState;
  const tAfterTrail2 = state.openTrades[0];
  assert.equal(tAfterTrail2.tp2Hit, true);
  assert.equal(tAfterTrail2.remPct, 0.2);
  assert.equal(tAfterTrail2.sl, 3003.5, 'Second trail trigger moves SL to 3003.5');

  // 6) Verify $1 minimum distance cap to live price: if SL is already near livePrice, it caps at livePrice - 1.0
  const tightTrade: OpenSniperTrade = {
    ...tAfterTrail2,
    sl: 3009.2,
    trailRef: 3008.5,
  };
  const cappedRes = advanceTrailingStopAfterTp1(tightTrade, 3010.5, 2.0, 1.5);
  assert.equal(
    cappedRes.updatedTrade.sl,
    3009.5,
    'SL must never move closer than $1.00 to livePrice (3010.5 - 1.0 = 3009.5)'
  );

  console.log('✓ Test 5 passed: SL/TP & Trailing Stop after TP1 math verified');
}

// ============================================================================
// TEST 6: H1 Parity between Fire Zone and Red Sniper
// ============================================================================
async function testH1ParityAndPrintTable(): Promise<void> {
  resetFireZoneEngineStore();
  let h1Bars: Candle[] = makeRealisticBars(220, true);
  let sourceLabel = 'Deterministic 220-bar H1 series';

  try {
    const res = await fetch('https://biquote.io/api/XAUUSD/ohlc?interval=1h&limit=400', {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      const raw =
        json?.data?.bars || json?.bars || json?.candles || json?.data?.candles || json?.data;
      if (Array.isArray(raw) && raw.length >= 160) {
        const parsed = sortAndDedupeCandles(
          raw
            .map((r: unknown) => normalizeRedSniperCandle(r, '1h'))
            .filter((c): c is Candle => c !== null)
        );
        if (parsed.length >= 160) {
          h1Bars = parsed;
          sourceLabel = `Live Biquote XAUUSD H1 (${parsed.length} bars)`;
        }
      }
    }
  } catch {
    // Fallback to deterministic H1 bars if offline
  }

  const livePrice = h1Bars[h1Bars.length - 1].close;
  const fzCandles = toFireZoneCandles(h1Bars);
  const fzResult = runFireZoneEngine(fzCandles, [], [], livePrice);

  // Run Red Sniper on H1 with maxZonesPerTf = 4 (2 per side: NEAREST + DEEP) and default settings (5)
  const rsResult4 = analyzeTimeframe('1h', h1Bars, 'NEUT', 'NEUT', livePrice, {
    ...DEFAULT_RED_SNIPER_SETTINGS,
    maxZonesPerTf: 4,
  });
  const rsResult5 = analyzeTimeframe('1h', h1Bars, 'NEUT', 'NEUT', livePrice, {
    ...DEFAULT_RED_SNIPER_SETTINGS,
    maxZonesPerTf: 5,
  });

  const fzZones = [...fzResult.sellZones, ...fzResult.buyZones].sort(
    (a, b) => b.anchor - a.anchor
  );
  const rsZones = [...rsResult4.zones].sort((a, b) => b.anchor - a.anchor);
  assert.ok(rsResult5.zones.length <= 5, 'Default maxZonesPerTf=5 respected on H1');

  assert.equal(
    rsZones.length,
    fzZones.length,
    `Red Sniper H1 zone count (${rsZones.length}) must match Fire Zone H1 zone count (${fzZones.length})`
  );

  console.log(`\n=== H1 PARITY TABLE (${sourceLabel}, Live Price: ${livePrice.toFixed(2)}) ===`);
  console.log(
    '| Slot | Fire Zone (Anchor / LO–HI / Score) | Red Sniper H1 (Anchor / LO–HI / Score / PWR) | Match |'
  );
  console.log('|---|---|---|---|');

  for (let i = 0; i < fzZones.length; i++) {
    const fz = fzZones[i];
    const rs = rsZones[i];
    assert.equal(rs.side, fz.side, `Side mismatch at index ${i}`);
    assert.equal(rs.slotType, fz.type, `Slot type mismatch at index ${i}`);
    assert.equal(rs.anchor, fz.anchor, `Anchor price mismatch at index ${i}`);
    assert.equal(rs.bottom, fz.bottom, `LO price mismatch at index ${i}`);
    assert.equal(rs.top, fz.top, `HI price mismatch at index ${i}`);
    assert.equal(rs.score, fz.score, `Score mismatch at index ${i}`);
    assert.equal(rs.strengthLabel, fz.label, `Label mismatch at index ${i}`);

    const slotName = `${fz.side} ${fz.type === 'NEAREST' ? 'NEAR' : 'DEEP'}`;
    const fzCol = `${fz.anchor.toFixed(2)} (${fz.bottom.toFixed(2)}–${fz.top.toFixed(2)}) · ${fz.score} ${fz.label}`;
    const rsCol = `${rs.anchor.toFixed(2)} (${rs.bottom.toFixed(2)}–${rs.top.toFixed(2)}) · ${rs.score} ${rs.strengthLabel} · PWR ${rs.power}`;
    console.log(`| ${slotName} | ${fzCol} | ${rsCol} | EXACT |`);
  }

  console.log('✓ Test 6 passed: 100% H1 Parity between Fire Zone and Red Sniper verified\n');
}

async function main() {
  testZoneSelectionCount();
  testValidSideAndNoSellBelowPrice();
  testDeadRule();
  testPowerWithAndWithoutVolume();
  testSlTpAndTrailingStopMath();
  await testH1ParityAndPrintTable();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
