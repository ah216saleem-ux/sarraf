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
  computeBtcTideSlTpPlan,
  SL_ATR15_MULT,
  SL_MIN_PCT,
  SL_MAX_PCT,
  TP_MODE,
  TP1_LOW_R_WARNING_TEXT,
  TRADE_EXPIRY_MS,
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
    assert(initialStats.winRate === null, 'Win rate is null when 0 closed trades');
    assert(initialStats.avgR === null, 'Avg R is null when 0 closed trades');
    assert(
      SL_ATR15_MULT === 2.5 && SL_MIN_PCT === 0.5 && SL_MAX_PCT === 1.0 && TP_MODE === 'FIXED_BASE',
      'Phase 6 constants configured: SL_ATR15_MULT=2.5, SL_MIN_PCT=0.5, SL_MAX_PCT=1.0, TP_MODE=FIXED_BASE'
    );

    // Test 2: Phase 6 SL/TP Plan (slDist = max(swing-based, 2.5 x atr15m, 0.50% of entry), cap 1.00%; tpBase = max(1.5 x atr5m, 0.30% of entry); true R)
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
    // With atr5m = 180, atr15m = 200, swingLow15m12 = 80830, swingLow5m12 = 81020:
    // swing-based = 81280 - (80830 - 0.3*200) = 81280 - 80770 = 510
    // 2.5 * atr15m = 500; 0.50% of 81280 = 406.40 => slDist = 510 (0.63%)
    // tpBase = max(1.5 * 180 = 270, 0.30% * 81280 = 243.84) = 270
    // tp1R = 270 / 510 = 0.53R (< 0.7R -> triggers tp1LowRWarning)
    const trade = createTradePlan('LONG', firePrice, mockBins, 76, 30, 'Strong buyer flow', 100, {
      atr5m: 180,
      atr15m: 200,
      klineSlTp: {
        atr5m: 180,
        atr15m: 200,
        swingLow5m12: 81020,
        swingHigh5m12: 81400,
        swingLow15m12: 80830,
        swingHigh15m12: 81550,
      },
      grade: 'A+',
      isCounterTrend: false,
      adaptiveMode: false,
    });
    assert(trade.side === 'LONG', 'Trade side is LONG');
    assert(trade.entryPrice === firePrice, 'Trade entry price matches live price at fire time');
    assert(trade.slPrice < trade.entryPrice, 'Long SL is below entry');
    assert(
      Math.abs((trade.entryPrice - trade.slPrice) - 510) < 0.05,
      `SL distance is $510 (got $${(trade.entryPrice - trade.slPrice).toFixed(2)})`
    );
    assert(
      typeof trade.slPct === 'number' && trade.slPct >= 0.5 && trade.slPct <= 1.0,
      `SL % (${trade.slPct}%) is between 0.50% and 1.00% of entry`
    );
    assert(trade.tpBase === 270, `tpBase is max(1.5*atr5m, 0.30% of entry) = $270 (got $${trade.tpBase})`);
    assert(
      Math.abs((trade.tp1Price - trade.entryPrice) - 270) < 0.05 &&
        Math.abs((trade.tp2Price - trade.entryPrice) - 540) < 0.05 &&
        Math.abs((trade.tp3Price - trade.entryPrice) - 810) < 0.05,
      'FIXED_BASE TPs are 1x/2x/3x tpBase ($270/$540/$810), NOT scaled with wider SL'
    );
    assert(
      trade.tp1R === 0.53 && trade.tp2R === 1.06 && trade.tp3R === 1.59,
      `True R values are tpDist/slDist: +${trade.tp1R}R / +${trade.tp2R}R / +${trade.tp3R}R`
    );
    assert(
      TRADE_EXPIRY_MS === 260 * 60 * 1000 && trade.expiryTime - trade.entryTime === 260 * 60 * 1000,
      'Trade expiry window is 260 minutes (15,600,000 ms)'
    );
    const tickAt60m = evaluateActiveTradeTick(trade, trade.entryPrice, trade.entryTime + 60 * 60 * 1000);
    assert(
      tickAt60m.closed === false && tickAt60m.updatedTrade.status === 'ACTIVE',
      'Trade remains ACTIVE at 60 minutes (does not expire early before 260 minutes)'
    );
    const tickAt260m = evaluateActiveTradeTick(trade, trade.entryPrice, trade.entryTime + 260 * 60 * 1000);
    assert(
      tickAt260m.closed === true && tickAt260m.updatedTrade.outcome === 'EXPIRED',
      'Trade expires only after 260 minutes if neither SL nor TP was hit'
    );

    // Verify cap-instead-of-block vs >0.2x atr15m inside-swing block:
    // Case A: Swing low is 80460 (820 below entry = 1.01%). With atr15m=200, swing+buffer = 80400 (880 dist > 812.80 cap).
    // Capped SL is 81280 - 812.80 = 80467.20. Swing low is 80460, so capped SL is only 7.20 inside swing (<= 0.2*200 = 40) -> NOT blocked!
    const cappedNotBlockedPlan = computeBtcTideSlTpPlan('LONG', firePrice, mockBins, {
      atr5m: 180,
      atr15m: 200,
      swingLow5m12: 80460,
      swingHigh5m12: 81400,
      swingLow15m12: 80460,
      swingHigh15m12: 81550,
    });
    assert(
      cappedNotBlockedPlan.slCapped === true &&
        cappedNotBlockedPlan.slPct === 1.0 &&
        cappedNotBlockedPlan.slTooWide === false,
      'Swing slightly exceeding 1.00% cap uses 1.00% cap without blocking when within 0.2x atr15m of swing'
    );
    assert(
      cappedNotBlockedPlan.tp1LowRWarning === TP1_LOW_R_WARNING_TEXT,
      'Shows warning when TP1 < 0.7R ("TP1 smaller than SL - needs high win rate")'
    );

    // Case B: Swing low is 80300 (980 below entry). Capped SL at 80467.20 sits 167.20 inside swing (> 0.2*200 = 40) -> BLOCKED!
    const insideSwingBlockedPlan = computeBtcTideSlTpPlan('LONG', firePrice, mockBins, {
      atr5m: 180,
      atr15m: 200,
      swingLow5m12: 80300,
      swingHigh5m12: 81400,
      swingLow15m12: 80300,
      swingHigh15m12: 81550,
    });
    assert(
      insideSwingBlockedPlan.slTooWide === true,
      'Blocks trade when 1.00% capped SL sits inside nearest swing by > 0.2x atr15m'
    );

    // Case C: R_MULTIPLE mode scales TPs to 1R/2R/3R of slDist
    const rMultPlan = computeBtcTideSlTpPlan(
      'LONG',
      firePrice,
      mockBins,
      {
        atr5m: 180,
        atr15m: 200,
        swingLow5m12: 81020,
        swingHigh5m12: 81400,
        swingLow15m12: 80830,
        swingHigh15m12: 81550,
      },
      null,
      100,
      'R_MULTIPLE'
    );
    assert(
      rMultPlan.tp1R === 1.0 && rMultPlan.tp2R === 2.0 && rMultPlan.tp3R === 3.0,
      'TP_MODE = R_MULTIPLE sets TP1/2/3 to 1R/2R/3R of new SL'
    );

    // Test 3: TP1 Hit moves stop to Entry + 0.1 x tpBase (profit-lock, not exact entry)
    const tick1 = evaluateActiveTradeTick(trade, trade.tp1Price, Date.now());
    assert(tick1.updatedTrade.tp1Hit === true, 'TP1 was recorded as hit');
    assert(tick1.updatedTrade.beMoved === true, 'Stop was moved to Entry + 0.1x tpBase profit-lock');
    const expectedBeStop = Number((trade.entryPrice + 0.1 * 270).toFixed(2));
    assert(
      Math.abs(tick1.updatedTrade.slPrice - expectedBeStop) < 0.05,
      `SL is now at Entry + 0.1x tpBase ($${expectedBeStop}, got $${tick1.updatedTrade.slPrice})`
    );
    assert(tick1.closed === false, 'Trade remains open after TP1');

    // Test 4: Retrace to Entry + 0.1x tpBase stop closes trade with true R and dollar PnL per 1 BTC
    const tickBe = evaluateActiveTradeTick(tick1.updatedTrade, expectedBeStop - 1, Date.now());
    assert(tickBe.closed === true, 'Trade closed on Entry + 0.1x tpBase stop trigger');
    assert(tickBe.updatedTrade.outcome === 'TP1+BE', 'Outcome is TP1+BE');
    // 50% @ +270 + 50% @ +27 = +$148.50 per 1 BTC; in R: 148.50 / 510 = +0.29R
    assert(
      tickBe.updatedTrade.realizedR === 0.29 && tickBe.updatedTrade.pnlUsdPerBtc === 148.5,
      `True realizedR is +0.29R (got ${tickBe.updatedTrade.realizedR}) and pnlUsdPerBtc is +$148.50 (got $${tickBe.updatedTrade.pnlUsdPerBtc})`
    );

    // Test 5: Persist trade to SQLite and verify round-trip (including tpBase, tp1R/2R/3R, pnlUsdPerBtc)
    saveTradeToSqlite(tickBe.updatedTrade, tickBe.updatedTrade.entryPrice);
    const closedTrades = getClosedTradesFromSqlite(10);
    const found = closedTrades.find((t) => t.id === tickBe.updatedTrade.id);
    assert(Boolean(found), 'Trade successfully retrieved from temp SQLite database');
    assert(found?.outcome === 'TP1+BE', 'Persisted trade outcome matches in temp SQLite');
    assert(
      found?.tpBase === 270 && found?.tp1R === 0.53 && found?.pnlUsdPerBtc === 148.5,
      'Persisted trade stores tpBase, tp1R, and pnlUsdPerBtc in SQLite'
    );

    // Test 6: Safety Check - 2% deviation reject on ACTIVE trade
    const badDevSave = saveTradeToSqlite(trade, 95000);
    assert(badDevSave === false, 'Safety check rejected trade save with > 2% price deviation');
    const safetyCheck = validateSignalPriceSafety(81270, 95000);
    assert(safetyCheck.valid === false, 'validateSignalPriceSafety returns false for >2% deviation');
    const goodSafetyCheck = validateSignalPriceSafety(81270, 81300);
    assert(goodSafetyCheck.valid === true, 'validateSignalPriceSafety returns true for <2% deviation');

    // Test 7: Stats Panel - avgSlPct, slRate, tp1HitRate, avgR, expectancy, and expectancyUsdPerBtc
    const statsWith1 = computeSqliteStats();
    assert(statsWith1.totalClosed === 1, 'Total closed is 1');
    assert(typeof statsWith1.avgSlPct === 'number', 'avgSlPct is computed for closed trades');
    assert(typeof statsWith1.tp1HitRate === 'number' && statsWith1.tp1HitRate === 100, 'tp1HitRate is 100% after 1 TP1+BE trade');
    assert(typeof statsWith1.avgR === 'number', 'avgR is computed for closed trades');
    assert(typeof statsWith1.expectancy === 'number', 'expectancy in R is computed for closed trades');
    assert(typeof statsWith1.expectancyUsdPerBtc === 'number', 'expectancyUsdPerBtc is computed for closed trades');

    // Insert 9 more closed trades to reach 10
    for (let i = 2; i <= 10; i++) {
      const isSl = i % 3 === 0;
      const mockClosed: BtcTideTradeRecord = {
        id: `btctide_closed_${i}`,
        side: i % 2 === 0 ? 'LONG' : 'SHORT',
        entryTime: Date.now() - (10 - i) * 60000,
        entryPrice: 81270,
        initialSlPrice: 80760,
        slPrice: 80760,
        tp1Price: 81540,
        tp2Price: 81810,
        tp3Price: 82080,
        oneR: 510,
        currentR: isSl ? -1.0 : 0.29,
        pnlPercent: 0.2,
        tp1Hit: !isSl,
        tp2Hit: false,
        tp3Hit: false,
        beMoved: !isSl,
        status: 'CLOSED',
        outcome: isSl ? 'SL' : 'TP1+BE',
        realizedR: isSl ? -1.0 : 0.29,
        pnlUsdPerBtc: isSl ? -510 : 148.5,
        closedAt: Date.now(),
        closePrice: 81270,
        expiryTime: Date.now() + 3600000,
        confidence: 72,
        lead: 25,
        triggerReason: 'Verified closed record',
        atr5m: 180,
        atr15m: 200,
        slDist: 510,
        slPct: 0.63,
        tpBase: 270,
        tpMode: 'FIXED_BASE',
        tp1R: 0.53,
        tp2R: 1.06,
        tp3R: 1.59,
        grade: 'A',
      };
      saveTradeToSqlite(mockClosed, 81270);
    }

    const statsWith10 = computeSqliteStats();
    assert(statsWith10.totalClosed === 10, 'Total closed reached 10');
    assert(typeof statsWith10.winRate === 'number', 'Win rate is computed across 10 trades');
    assert(typeof statsWith10.tp1HitRate === 'number', 'tp1HitRate is computed across 10 trades');
    assert(typeof statsWith10.avgR === 'number', 'Avg R is computed across 10 trades');
    assert(typeof statsWith10.expectancy === 'number', 'Expectancy (R) is computed across 10 trades');
    assert(typeof statsWith10.expectancyUsdPerBtc === 'number', 'Expectancy ($/1 BTC) is computed across 10 trades');
    assert(typeof statsWith10.avgSlPct === 'number', 'avgSlPct is computed across 10 trades');
    assert(typeof statsWith10.slRate === 'number', 'slRate is computed across 10 trades');

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
