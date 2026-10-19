import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  setBtcTideSqlitePath,
  closeBtcTideSqlite,
  initBtcTideSqlite,
  saveTradeToSqlite,
  getActiveTradeFromSqlite,
  getClosedTradesFromSqlite,
  computeSqliteStats,
  validateSignalPriceSafety,
} from './btcTideSqliteDatabase.ts';
import {
  evaluateDecisionEngine,
  createTradePlan,
  evaluateActiveTradeTick,
  computeAtr90s,
} from '../btcTide/signalEngine.ts';
import {
  notifyNewBtcTideSignal,
  notifyBtcTideTpHit,
  notifyBtcTideBreakevenMove,
  notifyBtcTideSlHit,
  notifyBtcTideExpiry,
} from './btcTideTelegramNotifier.ts';
import { BtcTideTradeRecord } from './btcTideSignalDatabase.ts';
import { SecondBin, OrderBookDepth, PerpPositioning } from '../btcTide/types.ts';

export async function runBtcTideVerificationTests() {
  console.log('--- Starting BTC Tide Verification Test Suite (Isolated Temp DB) ---');
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

  // Use isolated temp database in os.tmpdir() - NEVER touches production data/btc_tide.db
  const tempDbPath = path.resolve(
    os.tmpdir(),
    `test_btc_tide_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.db`
  );
  setBtcTideSqlitePath(tempDbPath);
  console.log(`[TEST ISOLATION] Using isolated temp DB: ${tempDbPath}`);

  try {
    // Test 1: SQLite DB init & clean empty stats
    await initBtcTideSqlite();
    const initialStats = computeSqliteStats();
    assert(initialStats.totalClosed === 0, 'SQLite initialized with 0 closed trades');
    assert(initialStats.winRate === null, 'Win rate is null (shows --) when < 10 closed trades');
    assert(initialStats.avgR === null, 'Avg R is null (shows --) when < 10 closed trades');

    // Test 2: Trade Plan Creation (Short-term ATR 90s swing +/- 0.4 ATR clamped 1.2-3.2 ATR; TP1/2/3 = 1R/2R/3R)
    const mockBins: SecondBin[] = [];
    const basePrice = 81000;
    for (let i = 0; i < 185; i++) {
      mockBins.push({
        sec: 1700000000 + i,
        buyVol: 2.8,
        sellVol: 0.3,
        buyUsd: 226800,
        sellUsd: 24300,
        count: 15,
        openPrice: basePrice + i * 1.5,
        highPrice: basePrice + i * 1.5 + 8,
        lowPrice: basePrice + i * 1.5 - 8,
        lastPrice: basePrice + i * 1.5 + 4,
        largePrintMaxUsd: i === 180 ? 85000 : 0,
        largePrintSide: i === 180 ? 'BUY' : null,
      });
    }

    const firePrice = mockBins[mockBins.length - 1].lastPrice; // 81280.00
    // Test with short-term 90s ATR = $100; 90s swing low = 81134.50
    const trade = createTradePlan('LONG', firePrice, mockBins, 75, 30, 'Strong buyer flow', 100);
    assert(trade.side === 'LONG', 'Trade side is LONG');
    assert(trade.entryPrice === firePrice, 'Trade entry price matches live price at fire time');
    assert(trade.slPrice < trade.entryPrice, 'Long SL is below entry');
    assert(
      Math.abs((trade.entryPrice - trade.slPrice) - 185.5) < 0.05,
      'SL is beyond 90s swing - 0.4 ATR (short-term ATR), clamped 1.2-3.2 ATR'
    );
    assert(
      trade.tp1Price > trade.entryPrice &&
        trade.tp2Price > trade.tp1Price &&
        trade.tp3Price > trade.tp2Price,
      'TP targets are ascending'
    );
    assert(
      Math.abs((trade.tp1Price - trade.entryPrice) - trade.oneR) < 0.05,
      'TP1 distance is exactly 1R of SL distance'
    );
    assert(
      Math.abs((trade.tp2Price - trade.entryPrice) - 2 * trade.oneR) < 0.05,
      'TP2 distance is exactly 2R of SL distance'
    );
    assert(
      Math.abs((trade.tp3Price - trade.entryPrice) - 3 * trade.oneR) < 0.05,
      'TP3 distance is exactly 3R of SL distance'
    );

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
    saveTradeToSqlite(tickBe.updatedTrade, tickBe.updatedTrade.entryPrice);
    const closedTrades = getClosedTradesFromSqlite(10);
    const found = closedTrades.find((t) => t.id === tickBe.updatedTrade.id);
    assert(Boolean(found), 'Trade successfully retrieved from temp SQLite database');
    assert(found?.outcome === 'TP1+BE', 'Persisted trade outcome matches in temp SQLite');

    // Test 6: Safety Check - 2% deviation reject
    const badDevSave = saveTradeToSqlite(tickBe.updatedTrade, 95000);
    assert(badDevSave === false, 'Safety check rejected trade save with > 2% price deviation');
    const safetyCheck = validateSignalPriceSafety(81270, 95000);
    assert(safetyCheck.valid === false, 'validateSignalPriceSafety returns false for >2% deviation');
    const goodSafetyCheck = validateSignalPriceSafety(81270, 81300);
    assert(goodSafetyCheck.valid === true, 'validateSignalPriceSafety returns true for <2% deviation');

    // Test 7: Stats requirement - win rate and avgR are null until >= 10 closed trades
    const statsWith1 = computeSqliteStats();
    assert(statsWith1.totalClosed === 1, 'Total closed is 1');
    assert(statsWith1.winRate === null, 'Win rate is null when totalClosed = 1 (< 10)');
    assert(statsWith1.avgR === null, 'Avg R is null when totalClosed = 1 (< 10)');

    // Insert 9 more mock closed trades to reach 10
    for (let i = 2; i <= 10; i++) {
      const mockClosed: BtcTideTradeRecord = {
        id: `mock_closed_${i}`,
        side: i % 2 === 0 ? 'LONG' : 'SHORT',
        entryTime: Date.now() - (10 - i) * 60000,
        entryPrice: 81270,
        initialSlPrice: 81170,
        slPrice: 81170,
        tp1Price: 81370,
        tp2Price: 81470,
        tp3Price: 81570,
        oneR: 100,
        currentR: 0.5,
        pnlPercent: 0.2,
        tp1Hit: true,
        tp2Hit: false,
        tp3Hit: false,
        beMoved: true,
        status: 'CLOSED',
        outcome: i % 3 === 0 ? 'SL' : 'TP1+BE',
        realizedR: i % 3 === 0 ? -1.0 : 0.5,
        closedAt: Date.now(),
        closePrice: 81270,
        expiryTime: Date.now() + 600000,
        confidence: 72,
        lead: 25,
        triggerReason: 'Mock test record',
      };
      saveTradeToSqlite(mockClosed, 81270);
    }

    const statsWith10 = computeSqliteStats();
    assert(statsWith10.totalClosed === 10, 'Total closed reached 10');
    assert(typeof statsWith10.winRate === 'number', 'Win rate is computed once >= 10 closed trades exist');
    assert(typeof statsWith10.avgR === 'number', 'Avg R is computed once >= 10 closed trades exist');

    // Test 8: Decision Engine Silence Requirement (<180s OR SPOT dot not green)
    const emptyBins: SecondBin[] = [];
    const dummyDepth: OrderBookDepth = {
      bids: [],
      asks: [],
      bidTotal: 10,
      askTotal: 5,
      imbalancePct: 33.3,
      spread: 0.01,
      spreadBps: 0.01,
      updatedAt: Date.now(),
    };
    const partialPerp: PerpPositioning = {
      markPrice: 81280,
      fundingRate: 0, // Zero (available, NOT excluded!)
      nextFundingTime: Date.now() + 3600000,
      openInterest: 85000,
      oiChange1h: null, // Unavailable (building history -> MUST be excluded!)
      oiChange1hPct: null,
      oiHistoryMinutes: 14,
      oiHistoryStatus: 'building 14m/60m',
      basis: 10,
      basisBps: 1.2,
      longShortRatio: 1.1,
      longAccountPct: 52,
      shortAccountPct: 48,
      liquidations5m: [],
      totalLiq5mUsd: 0,
      longLiq5mUsd: 0,
      shortLiq5mUsd: 0,
      sources: {
        markPrice: 'OKX SWAP',
        funding: 'OKX SWAP',
        openInterest: 'OKX SWAP',
        basis: 'Bybit Spot vs Perp',
        longShort: 'OKX',
        liquidations: 'Bybit allLiquidation',
      },
      status: 'LIVE',
      updatedAt: Date.now(),
    };

    const silentDecision = evaluateDecisionEngine(
      emptyBins,
      dummyDepth,
      partialPerp,
      basePrice,
      'LIVE',
      null,
      false,
      500
    );
    assert(silentDecision.isSilent === true, 'Engine stays silent with <3 minutes of data');
    assert(silentDecision.canFire === false, 'Engine does not fire while silent');

    // Test 9: SPOT dot not green (spotAgeMs >= 3000) keeps engine silent even with >= 180s bins
    const amberSpotDecision = evaluateDecisionEngine(
      mockBins,
      dummyDepth,
      partialPerp,
      firePrice,
      'LIVE',
      null,
      false,
      4200 // 4.2s age -> SPOT dot is amber, not green
    );
    assert(
      amberSpotDecision.isSilent === true && amberSpotDecision.canFire === false,
      'Engine stays silent and cannot fire when SPOT dot is not green (spotAgeMs >= 3000ms)'
    );

    // Test 10: Unavailable PERPS component exclusion & weight re-normalisation
    const liveGreenDecision = evaluateDecisionEngine(
      mockBins,
      dummyDepth,
      partialPerp,
      firePrice,
      'LIVE',
      null,
      false,
      400 // 0.4s age -> SPOT dot is green
    );
    assert(liveGreenDecision.isSilent === false, 'Engine is active when >=180s data and SPOT dot green');
    const excludedIds = (liveGreenDecision.excludedComponents || []).map((e) => e.id);
    assert(
      excludedIds.includes('oi_price_direction') && !excludedIds.includes('funding_rate'),
      'Unavailable oiChange1h (null) is excluded while zero fundingRate (0) is kept active'
    );
    const activeWeightSum = liveGreenDecision.components
      .filter((c) => !c.excluded)
      .reduce((acc, c) => acc + c.weight, 0);
    assert(
      Math.abs(activeWeightSum - 100) < 0.5,
      `Remaining active component weights re-normalised to ~100 (actual: ${activeWeightSum.toFixed(1)})`
    );

    // Test 11: Non-blocking Telegram lifecycle dispatch (including simulated send failure)
    await notifyNewBtcTideSignal(trade, liveGreenDecision, { dryRun: true, simulateFailure: true });
    await notifyBtcTideTpHit(trade, 1, trade.tp1Price, { dryRun: true, simulateFailure: true });
    await notifyBtcTideBreakevenMove(tick1.updatedTrade, { dryRun: true, simulateFailure: true });
    await notifyBtcTideSlHit(tickBe.updatedTrade, trade.entryPrice, { dryRun: true, simulateFailure: true });
    await notifyBtcTideExpiry(tickBe.updatedTrade, trade.entryPrice, { dryRun: true, simulateFailure: true });
    assert(true, 'All 5 Telegram lifecycle functions survived simulated send failure without blocking engine');

    console.log(`\nALL TESTS PASSED: ${passed}/${total}`);
    return { passed, total, allPassed: passed === total, tempDbPath };
  } finally {
    // Clean up temporary database and reset path back to default
    closeBtcTideSqlite();
    setBtcTideSqlitePath(null);
    try {
      if (fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
        console.log(`[TEST ISOLATION] Cleaned up temporary test DB: ${tempDbPath}`);
      }
    } catch {}
  }
}
