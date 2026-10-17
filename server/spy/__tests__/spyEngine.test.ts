/**
 * SPY SARRAF Engine Unit Tests
 * Tests market hours / DST calculations and Smart Money evaluation gates.
 * Run with: tsx server/spy/__tests__/spyEngine.test.ts
 */

import {
  getNewYorkTime,
  evaluateSpyMarketHours,
  calculateNextMarketOpen,
  getExpiryOptionsStatus,
} from '../marketHours.ts';
import {
  findOrderBlocks,
  detectLiquiditySweep,
  detectFairValueGaps,
  detectMarketStructureShift,
  calculateEMA,
  calculateATR,
  calculateVWAP,
  evaluateSpySignal,
} from '../signalEngine.ts';
import { SpyCandle, SpyExpiryOption } from '../types.ts';

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` (${detail})` : ''}`);
    failedCount++;
  }
}

console.log('====================================================');
console.log('🧪 SUITE 1: MARKET HOURS, DST & EXPIRY STATUS');
console.log('====================================================');

// 1. Regular market hours test: Wednesday at 11:15 AM ET
const wednesdayRegularET = new Date('2026-10-14T15:15:00.000Z'); // 15:15 UTC = 11:15 EDT (UTC-4)
const regularMH = evaluateSpyMarketHours(wednesdayRegularET);
assert(regularMH.marketOpen === true, 'Regular session opens at 11:15 AM ET on a weekday');
assert(regularMH.session === 'REGULAR', 'Session type is REGULAR');
assert(regularMH.minutesToClose === 285, 'Minutes to close is 285 (11:15 to 16:00 ET)', `got ${regularMH.minutesToClose}`);

// 2. Weekend market hours test: Saturday at 14:00 ET
const saturdayUTC = new Date('2026-10-17T18:00:00.000Z');
const weekendMH = evaluateSpyMarketHours(saturdayUTC);
assert(weekendMH.marketOpen === false, 'Market closed on weekend');
assert(weekendMH.session === 'WEEKEND', 'Session type is WEEKEND');

// 3. Pre-market hours test: Weekday at 08:30 AM ET
const preMarketET = new Date('2026-10-14T12:30:00.000Z'); // 08:30 EDT
const preMH = evaluateSpyMarketHours(preMarketET);
assert(preMH.marketOpen === false, 'Market closed during pre-market');
assert(preMH.session === 'PRE_MARKET', 'Session type is PRE_MARKET');

// 4. After-hours test: Weekday at 17:30 ET
const afterHoursET = new Date('2026-10-14T21:30:00.000Z'); // 17:30 EDT
const afterMH = evaluateSpyMarketHours(afterHoursET);
assert(afterMH.marketOpen === false, 'Market closed during after-hours');
assert(afterMH.session === 'AFTER_HOURS', 'Session type is AFTER_HOURS');

// 5. Holiday calendar test: Independence Day (Observed) 2026-07-03
const holidayDate = new Date('2026-07-03T16:00:00.000Z');
const holidayMH = evaluateSpyMarketHours(holidayDate);
assert(holidayMH.isHoliday === true, 'July 3, 2026 recognized as US market holiday');
assert(holidayMH.session === 'HOLIDAY', 'Holiday session flagged as HOLIDAY');

// 6. Daylight Saving Time (DST) transitions
// Summer time EDT (UTC-4) in July
const summerDate = new Date('2026-07-15T16:00:00.000Z');
const nySummer = getNewYorkTime(summerDate);
assert(nySummer.hour === 12, 'Summer time (EDT) parses UTC 16:00 as 12:00 ET (-4h)');

// Winter time EST (UTC-5) in December
const winterDate = new Date('2026-12-15T17:00:00.000Z');
const nyWinter = getNewYorkTime(winterDate);
assert(nyWinter.hour === 12, 'Winter time (EST) parses UTC 17:00 as 12:00 ET (-5h)');

// 7. Expiry Options Status: Disable when exceeding remaining minutes to close
const lateRegularSession = evaluateSpyMarketHours(new Date('2026-10-14T19:40:00.000Z')); // 15:40 ET -> 20m to close
const lateOptions = getExpiryOptionsStatus(lateRegularSession);
const opt15m = lateOptions.find((o) => o.expiry === '15m');
const opt30m = lateOptions.find((o) => o.expiry === '30m');
const opt1h = lateOptions.find((o) => o.expiry === '1H');
assert(opt15m?.enabled === true, '15m option enabled with 20m remaining');
assert(opt30m?.enabled === false, '30m option disabled with only 20m remaining');
assert(opt1h?.enabled === false, '1H option disabled with only 20m remaining');

// 8. Lock & Cooldown check
const lockedOptions = getExpiryOptionsStatus(regularMH, (exp: SpyExpiryOption) => {
  if (exp === '15m') return { isLocked: true, isCooldown: true, cooldownSecondsLeft: 600, lockReason: '10m cooldown active' };
  return { isLocked: false, isCooldown: false, cooldownSecondsLeft: 0 };
});
const locked15m = lockedOptions.find((o) => o.expiry === '15m');
assert(locked15m?.enabled === false, 'Locked expiry is disabled');
assert(locked15m?.isCooldown === true, 'Cooldown status attached to expiry');

console.log('\n====================================================');
console.log('🧪 SUITE 2: SMART MONEY CONFLUENCE GATES');
console.log('====================================================');

// Test helper to create deterministic candles
function createCandles(specs: Array<{ open: number; high: number; low: number; close: number; volume?: number }>): SpyCandle[] {
  const baseTime = Date.now() - specs.length * 60000;
  return specs.map((s, idx) => ({
    openTime: new Date(baseTime + idx * 60000).toISOString(),
    timestamp: baseTime + idx * 60000,
    open: s.open,
    high: s.high,
    low: s.low,
    close: s.close,
    volume: s.volume || 1000,
    isClosed: true,
  }));
}

// 1. Gate A: Order Block (Demand Zone) detection
const obCandles = createCandles([
  { open: 585.0, high: 585.5, low: 584.8, close: 585.2 },
  { open: 585.2, high: 585.3, low: 583.5, close: 583.8 }, // Down candle before violent move (OB)
  { open: 583.8, high: 587.0, low: 583.7, close: 586.8 }, // Violent expansion up
  { open: 586.8, high: 587.5, low: 586.2, close: 587.2 },
  { open: 587.2, high: 588.0, low: 587.0, close: 587.8 },
]);
const obs = findOrderBlocks(obCandles);
assert(obs.some((o) => o.type === 'DEMAND'), 'Gate A: Identifies unmitigated Bullish Demand Order Block');

// 2. Gate B: Liquidity Sweep (SSL Sweep with lower wick rejection)
const sweepCandles = createCandles([
  { open: 586.0, high: 586.5, low: 585.5, close: 586.2 },
  { open: 586.2, high: 586.3, low: 584.0, close: 584.2 }, // Swing low established at 584.0
  { open: 584.2, high: 585.5, low: 584.2, close: 585.0 },
  { open: 585.0, high: 585.8, low: 584.8, close: 585.4 },
  { open: 585.4, high: 585.5, low: 583.7, close: 584.6 }, // Swept below 584.0 to 583.7, closed above 584.0!
  { open: 584.6, high: 586.0, low: 584.5, close: 585.8 },
]);
const sweepResult = detectLiquiditySweep(sweepCandles);
assert(sweepResult.swept === true && sweepResult.type === 'SSL_SWEEP', 'Gate B: Detects Sell-Side Liquidity (SSL) sweep with bullish wick rejection');

// 3. Gate C: Fair Value Gap (FVG)
const fvgCandles = createCandles([
  { open: 580.0, high: 580.8, low: 579.5, close: 580.5 }, // Bar 1 high = 580.8
  { open: 580.5, high: 583.5, low: 580.4, close: 583.2 }, // Bar 2 displacement
  { open: 583.2, high: 584.5, low: 581.6, close: 584.0 }, // Bar 3 low = 581.6 -> FVG [580.8 - 581.6]
  { open: 584.0, high: 584.2, low: 581.2, close: 582.0 }, // Pulls back into gap without closing below 580.8
]);
const fvgs = detectFairValueGaps(fvgCandles, 581.4);
assert(fvgs.some((f) => f.type === 'BULLISH_FVG' && f.retested), 'Gate C: Detects Bullish FVG and verifies retest');

// 4. Gate D: CHoCH / Break of Structure (BOS)
const bosCandles = createCandles([
  { open: 580.0, high: 582.0, low: 579.5, close: 581.5 }, // Swing high at 582.0
  { open: 581.5, high: 581.8, low: 580.0, close: 580.5 },
  { open: 580.5, high: 581.0, low: 579.8, close: 580.2 },
  { open: 580.2, high: 583.0, low: 580.0, close: 582.8 }, // Closes above 582.0! (BOS)
]);
const shiftResult = detectMarketStructureShift(bosCandles);
assert(shiftResult.shift === true && shiftResult.type === 'BULLISH_BOS', 'Gate D: Detects clean Break of Structure (BOS)');

// 5. Gate E: Trend Alignment (VWAP + EMAs)
const trendCandles = createCandles([
  { open: 575.0, high: 576.0, low: 574.5, close: 575.8, volume: 1000 },
  { open: 575.8, high: 577.2, low: 575.5, close: 577.0, volume: 1200 },
  { open: 577.0, high: 578.5, low: 576.8, close: 578.2, volume: 1400 },
  { open: 578.2, high: 580.0, low: 578.0, close: 579.5, volume: 1600 },
]);
const vwap = calculateVWAP(trendCandles);
assert(vwap > 575 && vwap < 580, `VWAP calculated within intraday range ($${vwap.toFixed(2)})`);

// 6. Full Deterministic Evaluator: High Selectivity / NO TRADE behavior
const emptyStore = {
  '1m': [],
  '5m': [],
  '15m': [],
  '1h': [],
  '4h': [],
  '1d': [],
};
const evalNoData = evaluateSpySignal({
  expiry: '15m',
  currentPrice: 586.5,
  candleStore: emptyStore,
  marketOpen: true,
});
assert(evalNoData.decision === 'NO TRADE', 'Evaluator yields NO TRADE when candles are missing');
assert(evalNoData.approxAtmStrike === 587, 'Computes correct ATM strike (586.50 -> 587)');

console.log('\n====================================================');
console.log(`TOTAL: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log('====================================================');

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log('✨ All SPY Market Hours & Smart Money Gate unit tests passed successfully!');
  process.exit(0);
}
