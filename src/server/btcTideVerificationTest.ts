import { initBtcTideSqlite, saveTradeToSqlite, getActiveTradeFromSqlite, getClosedTradesFromSqlite, computeSqliteStats } from './btcTideSqliteDatabase.ts';
import { evaluateDecisionEngine, createTradePlan, evaluateActiveTradeTick } from '../btcTide/signalEngine.ts';
import { BtcTideTradeRecord } from './btcTideSignalDatabase.ts';
import { SecondBin, OrderBookDepth, PerpPositioning } from '../btcTide/types.ts';

export async function runBtcTideVerificationTests() {
  console.log('--- Starting BTC Tide Verification Test Suite ---');
  let passed = 0;
  let total = 0;

  function assert(cond: boolean, name: string) {
    total++;
    if (cond) {
      passed++;
      console.log(`[PASS] ${name}`);
    } else {
      console.error(`[FAIL] ${name}`);
      throw new Error(`Assertion failed: ${name}`);
    }
  }

  // Test 1: SQLite DB init & stats
  await initBtcTideSqlite();
  const initialStats = computeSqliteStats();
  assert(typeof initialStats.totalClosed === 'number', 'SQLite initialized and returned stats');

  // Test 2: Trade Plan Creation (SL clamp, 1R/2R/3R scaling)
  const mockBins: SecondBin[] = [];
  const basePrice = 68000;
  for (let i = 0; i < 90; i++) {
    mockBins.push({
      sec: 1700000000 + i,
      buyVol: 2.5,
      sellVol: 0.5,
      buyUsd: 170000,
      sellUsd: 34000,
      count: 12,
      openPrice: basePrice + i * 2,
      highPrice: basePrice + i * 2 + 10,
      lowPrice: basePrice + i * 2 - 10,
      lastPrice: basePrice + i * 2 + 5,
      largePrintMaxUsd: 0,
      largePrintSide: null,
    });
  }

  const trade = createTradePlan('LONG', basePrice + 185, mockBins, 75, 30, 'Strong buyer flow');
  assert(trade.side === 'LONG', 'Trade side is LONG');
  assert(trade.entryPrice === basePrice + 185, 'Trade entry price matches current real price');
  assert(trade.slPrice < trade.entryPrice, 'Long SL is below entry');
  assert(trade.tp1Price > trade.entryPrice && trade.tp2Price > trade.tp1Price && trade.tp3Price > trade.tp2Price, 'TP targets are ascending');
  assert(Math.abs((trade.tp1Price - trade.entryPrice) - trade.oneR) < 0.01, 'TP1 is exactly +1.0R');
  assert(Math.abs((trade.tp2Price - trade.entryPrice) - 2 * trade.oneR) < 0.01, 'TP2 is exactly +2.0R');
  assert(Math.abs((trade.tp3Price - trade.entryPrice) - 3 * trade.oneR) < 0.01, 'TP3 is exactly +3.0R');

  // Test 3: TP1 Hit moves stop to breakeven
  const tick1 = evaluateActiveTradeTick(trade, trade.tp1Price, Date.now());
  assert(tick1.updatedTrade.tp1Hit === true, 'TP1 was recorded as hit');
  assert(tick1.updatedTrade.beMoved === true, 'Stop was moved to breakeven');
  assert(tick1.updatedTrade.slPrice === trade.entryPrice, 'SL is now at breakeven entry price');
  assert(tick1.closed === false, 'Trade remains open after TP1');

  // Test 4: Retrace to breakeven closes trade with +0.5R
  const tickBe = evaluateActiveTradeTick(tick1.updatedTrade, trade.entryPrice - 1, Date.now());
  assert(tickBe.closed === true, 'Trade closed on breakeven stop trigger');
  assert(tickBe.updatedTrade.outcome === 'TP1+BE', 'Outcome is TP1+BE');
  assert(tickBe.updatedTrade.realizedR === 0.5, 'Realized R is +0.50R preserved profit');

  // Test 5: Persist trade to SQLite and verify round-trip
  saveTradeToSqlite(tickBe.updatedTrade);
  const closedTrades = getClosedTradesFromSqlite(10);
  const found = closedTrades.find((t) => t.id === tickBe.updatedTrade.id);
  assert(Boolean(found), 'Trade successfully retrieved from SQLite database');
  assert(found?.outcome === 'TP1+BE', 'Persisted trade outcome matches in SQLite');

  // Test 6: Decision Engine Silence Requirement (<180s)
  const emptyBins: SecondBin[] = [];
  const dummyDepth: OrderBookDepth = { bids: [], asks: [], bidTotal: 0, askTotal: 0, imbalancePct: null, spread: null, spreadBps: null, updatedAt: 0 };
  const dummyPerp: PerpPositioning = { markPrice: null, fundingRate: null, nextFundingTime: null, openInterest: null, oiChange1h: null, oiChange1hPct: null, basis: null, basisBps: null, longShortRatio: null, longAccountPct: null, shortAccountPct: null, liquidations5m: [], totalLiq5mUsd: 0, longLiq5mUsd: 0, shortLiq5mUsd: 0, status: 'CONNECTING', updatedAt: 0 };

  const silentDecision = evaluateDecisionEngine(emptyBins, dummyDepth, dummyPerp, basePrice, 'LIVE', null, false);
  assert(silentDecision.isSilent === true, 'Engine stays silent with <3 minutes of data');
  assert(silentDecision.canFire === false, 'Engine does not fire while silent');

  console.log(`\nALL TESTS PASSED: ${passed}/${total}`);
  return { passed, total, allPassed: passed === total };
}
