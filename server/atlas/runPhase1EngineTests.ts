// server/atlas/runPhase1EngineTests.ts
import { evaluateLiveZoneStatus, computeAtlasZonesAndScenarios, getAtlasState } from './atlasEngine';
import { countZoneTouches } from './indicators';
import { AtlasZone } from './atlasTypes';
import { Candle, getCandleStore } from '../../src/server/candleEngine';

console.log('=== SARRAF ATLAS PHASE 1 ENGINE VERIFICATION TESTS ===\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✓ PASS [Test ${totalTests}]: ${testName}`);
  } else {
    console.error(`✕ FAIL [Test ${totalTests}]: ${testName}`);
    if (detail) console.error(`   Detail: ${detail}`);
  }
}

// -----------------------------------------------------------------------------
// TEST 1: Price 4164.27 with R1 zone 4182-4189 produces NO TOUCH
// -----------------------------------------------------------------------------
const sampleR1: AtlasZone = {
  id: 'R1',
  name: 'R1 Supply',
  level: 4185.50,
  top: 4189.00,
  bottom: 4182.00,
  halfWidth: 3.50,
  side: 'SELL',
  type: 'SUPPLY',
  tier: 'T1 PRIMARY',
  grade: 'A',
  touchesCount: 2,
  reason: 'Historical Test',
  status: 'FRESH',
  touchesToday: 0,
  isFlipped: false,
  breakInfo: null,
};

const result1 = evaluateLiveZoneStatus([sampleR1], [], '2026-10-16T12:00:00.000Z', 4164.27);
assert(
  result1[0].status === 'FRESH' && result1[0].touchesToday === 0,
  'Price 4164.27 with R1 zone 4182-4189 produces no TOUCH',
  `Expected FRESH & touchesToday 0, got status=${result1[0].status}, touchesToday=${result1[0].touchesToday}`
);

// -----------------------------------------------------------------------------
// TEST 2: Candles before publishTime NEVER break or touch a zone
// -----------------------------------------------------------------------------
const prePublishBar: Candle = {
  openTime: '2026-10-16T11:00:00.000Z', // 1 hour BEFORE publishTime
  open: 4190.00,
  high: 4205.00,
  low: 4188.00,
  close: 4202.00, // Closed above top (4189.00) before publishTime
  volume: 1500,
  isClosed: true,
};

const result2 = evaluateLiveZoneStatus([sampleR1], [prePublishBar], '2026-10-16T12:00:00.000Z', 4164.27);
assert(
  result2[0].status === 'FRESH' && !result2[0].breakInfo,
  'Candles before publishTime NEVER break or touch a zone',
  `Expected FRESH (pre-publish candle ignored), got status=${result2[0].status}`
);

// -----------------------------------------------------------------------------
// TEST 3: PP (SARRAF ZONE) NEVER shows BROKEN
// -----------------------------------------------------------------------------
const samplePP: AtlasZone = {
  id: 'PP',
  name: 'SARRAF ZONE',
  level: 4150.00,
  top: 4153.50,
  bottom: 4146.50,
  halfWidth: 3.50,
  side: 'NEUTRAL',
  type: 'SARRAF_ZONE',
  tier: 'SARRAF ZONE',
  grade: 'A',
  touchesCount: 5,
  reason: 'Central Pivot',
  status: 'FRESH',
  touchesToday: 0,
  isFlipped: false,
  breakInfo: null,
};

const postPublishBreakBarPP: Candle = {
  openTime: '2026-10-16T13:00:00.000Z', // After publishTime
  open: 4180.00,
  high: 4210.00,
  low: 4175.00,
  close: 4205.00, // Far above PP corridor
  volume: 2000,
  isClosed: true,
};

const result3 = evaluateLiveZoneStatus([samplePP], [postPublishBreakBarPP], '2026-10-16T12:00:00.000Z', 4205.00);
assert(
  result3[0].status !== 'BROKEN' && result3[0].isFlipped === false,
  'PP (SARRAF ZONE) NEVER shows BROKEN or FLIPPED',
  `Expected status != BROKEN & isFlipped false, got status=${result3[0].status}, isFlipped=${result3[0].isFlipped}`
);

// -----------------------------------------------------------------------------
// TEST 4: Touch counts are sane (distinct event counts over 20-day H1 feed)
// -----------------------------------------------------------------------------
const mock20DaysBars: Candle[] = [];
const baseTs = new Date('2026-10-01T00:00:00Z').getTime();
for (let i = 0; i < 480; i++) {
  const barTs = new Date(baseTs + i * 3600 * 1000).toISOString();
  // Simulate 3 visits into range 4182-4189 with >= 3 candles outside in between
  let high = 4160;
  let low = 4150;
  if ((i >= 10 && i <= 12) || (i >= 50 && i <= 52) || (i >= 200 && i <= 201)) {
    high = 4185;
    low = 4180;
  }
  mock20DaysBars.push({
    openTime: barTs,
    open: low,
    high,
    low,
    close: high,
    volume: 1000,
    isClosed: true,
  });
}

const touchCount = countZoneTouches(mock20DaysBars, 4189, 4182, 20);
assert(
  touchCount === 3,
  'Touch counts sane (3 distinct events counted across 480 H1 bars)',
  `Expected 3 distinct touch events, got ${touchCount}`
);

// -----------------------------------------------------------------------------
// TEST 5: Full Atlas state API includes required summary, bias, zones, and liquidity
// -----------------------------------------------------------------------------
const store = getCandleStore();
store.D1 = [
  { openTime: '2026-10-14T00:00:00Z', open: 4150, high: 4180, low: 4140, close: 4170, volume: 10000, isClosed: true },
  { openTime: '2026-10-15T00:00:00Z', open: 4170, high: 4195, low: 4160, close: 4185, volume: 12000, isClosed: true },
  { openTime: '2026-10-16T00:00:00Z', open: 4185, high: 4200, low: 4175, close: 4190, volume: 8000, isClosed: false },
];
store.H1 = mock20DaysBars;

computeAtlasZonesAndScenarios();

const state = getAtlasState();
assert(
  Boolean(state && state.date && state.zones.length === 7 && state.summary && state.liquidityLevels),
  'API state returns unified single object with date, 7 zones, summary, and liquidity',
  `Got state keys: ${Object.keys(state || {}).join(', ')}`
);

console.log(`\n=== SUMMARY: ${passedTests}/${totalTests} TESTS PASSED ===\n`);

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
