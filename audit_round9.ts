import fs from 'fs';
import path from 'path';
import {
  recordLiveTick,
  getLastValidTick,
} from './src/server/marketPriceEngine.ts';
import {
  loadCandlesFromDisk,
  processTick,
} from './src/server/candleEngine.ts';
import {
  fetchLiveMacroData,
  getPredictionMarketMappingTable,
} from './src/server/macroFeedEngine.ts';
import {
  newsDecision,
} from './src/server/newsDecision.ts';
import {
  transformRawEvent,
  RawForexFactoryEvent,
  computeGoldImpact,
} from './src/server/newsEngine.ts';
import {
  sampleLiveReleaseTicks,
  getReleaseLoggerSummary,
} from './src/server/releaseLogger.ts';
import {
  runPhase5TestSuite,
} from './src/server/phase5Tests.ts';

function assertCond(condition: boolean, label: string, details: string) {
  if (!condition) {
    console.error(`ASSERT FAILED: ${label} — ${details}`);
    process.exit(1);
  }
  console.log(`ASSERT OK: ${label} (${details})`);
}

async function runAuditRound9() {
  const runStartedAt = new Date().toISOString();
  console.log('================================================================================');
  console.log('SARRAF ROUND 9 RAW CODE EXECUTION AUDIT (audit_round9.ts)');
  console.log('================================================================================');
  console.log(`runStartedAt      : ${runStartedAt}`);

  // Load candles from disk so Gold BiQuote Trend has real H1/H4 anchors
  loadCandlesFromDisk();

  // ---------------------------------------------------------------------------
  // 1. LIVE BIQUOTE GOLD FETCH & 0.03% THRESHOLD
  // ---------------------------------------------------------------------------
  const biquoteUrl = 'https://biquote.io/api/XAUUSD';
  let biquoteRaw: any = null;
  let serverReceiveTime = '';
  try {
    const res = await fetch(biquoteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    serverReceiveTime = new Date().toISOString();
    if (!res.ok) {
      console.error(`FATAL: BiQuote HTTP ${res.status}`);
      process.exit(1);
    }
    biquoteRaw = await res.json();
  } catch (err: any) {
    console.error(`FATAL: BiQuote fetch failed: ${err.message}`);
    process.exit(1);
  }

  const q = biquoteRaw?.quote ? biquoteRaw.quote : biquoteRaw;
  const liveGoldPrice = Number(q?.mid ?? q?.price ?? q?.bid);
  if (!Number.isFinite(liveGoldPrice) || liveGoldPrice <= 0) {
    console.error(`FATAL: Invalid BiQuote mid price: ${JSON.stringify(biquoteRaw)}`);
    process.exit(1);
  }

  const receiveMs = new Date(serverReceiveTime).getTime();
  const tickTs = q.lastQuoteAt ? new Date(q.lastQuoteAt).getTime() : receiveMs;
  recordLiveTick({
    symbol: q.symbol || 'XAUUSD',
    price: liveGoldPrice,
    bid: Number(q.bid) || liveGoldPrice,
    ask: Number(q.ask) || liveGoldPrice,
    high: Number(q.high ?? q.dayHigh) || liveGoldPrice,
    low: Number(q.low ?? q.dayLow) || liveGoldPrice,
    spread: Number(q.spread) || 0,
    dayDiffPercent: Number(q.dayDiffPercent) || 0,
    direction: q.direction || 'FLAT',
    timestamp: q.lastQuoteAt || q.timestamp || serverReceiveTime,
    source: q.source || 'BiQuote Live',
    marketState: q.marketState || 'open',
    lastReceivedAt: receiveMs,
  });
  processTick(liveGoldPrice, tickTs);

  const liveTick = getLastValidTick();
  const threshold003PctDollars = Number(((liveTick!.price * 0.03) / 100).toFixed(4));
  console.log(`serverReceiveTime : ${serverReceiveTime}`);
  console.log(`lastQuoteAt       : ${q.lastQuoteAt || q.timestamp}`);
  console.log(`BiQuote Raw Tick  : ${JSON.stringify(biquoteRaw)}`);
  console.log(`Live Gold Mid     : $${liveTick!.price.toFixed(2)} (Bid: $${liveTick!.bid.toFixed(2)}, Ask: $${liveTick!.ask.toFixed(2)})`);
  console.log(`0.03% Threshold   : $${threshold003PctDollars.toFixed(4)} ($${threshold003PctDollars.toFixed(2)} move required on $${liveTick!.price.toFixed(2)} gold)`);
  assertCond(
    serverReceiveTime >= runStartedAt,
    'Fresh BiQuote Gold tick fetched at runtime',
    `serverReceiveTime=${serverReceiveTime} >= runStartedAt=${runStartedAt}`
  );

  // ---------------------------------------------------------------------------
  // 2. SINGLE FROZEN LIVE MACRO SNAPSHOT
  // ---------------------------------------------------------------------------
  console.log('\n--------------------------------------------------------------------------------');
  console.log('FROZEN LIVE MACRO SNAPSHOT (computed ONCE per run and reused for every event)');
  console.log('--------------------------------------------------------------------------------');
  const frozenMacroSnapshot = await fetchLiveMacroData(true);
  console.log('Gold BiQuote Trend :', JSON.stringify(frozenMacroSnapshot.goldTrend));
  console.log('Dollar Proxy       :', JSON.stringify(frozenMacroSnapshot.dollarProxy));
  console.log('US10Y Yield        :', JSON.stringify(frozenMacroSnapshot.us10y));

  // ---------------------------------------------------------------------------
  // 3. ITEM 2: PREDICTION MARKET FIXES (FED_RATE 100% NORMALIZATION & MAPPING TABLE)
  // ---------------------------------------------------------------------------
  console.log('\n--------------------------------------------------------------------------------');
  console.log('ITEM 2A: FED_RATE RAW CONTRACT PRICES & 100% NORMALIZATION');
  console.log('--------------------------------------------------------------------------------');
  const fedMarket = frozenMacroSnapshot.discoveredMarkets?.FED_RATE;
  if (!fedMarket) {
    console.error('FATAL: FED_RATE market missing from discoveredMarkets');
    process.exit(1);
  }
  console.log(`Kalshi Event Ticker : ${fedMarket.kalshiEventTicker}`);
  console.log(`Release Month       : ${fedMarket.releaseMonth}`);
  console.log('Raw Contract Prices :');
  console.log('Contract Ticker             | Bucket | Title / Subtitle                     | Mid Price ($/%)  | Yes Bid / Yes Ask');
  console.log('----------------------------+--------+--------------------------------------+------------------+------------------');
  for (const c of fedMarket.rawContracts || []) {
    console.log(
      `${String(c.tickerOrId).padEnd(27)} | ${String(c.bucket).padEnd(6)} | ${String(c.title).padEnd(36)} | $${c.rawPrice.toFixed(4)} (${c.rawPct.toFixed(1).padStart(4)}%) | ${c.yesBid !== undefined ? `$${c.yesBid.toFixed(2)}` : 'N/A'} / ${c.yesAsk !== undefined ? `$${c.yesAsk.toFixed(2)}` : 'N/A'}`
    );
  }
  console.log(`Raw Probabilities   : hold=${fedMarket.rawHoldPct}% + cut=${fedMarket.rawCutPct}% + hike=${fedMarket.rawHikePct}% = ${fedMarket.rawProbSumPct}%`);
  console.log(`Normalized (100%)   : hold=${fedMarket.holdProb}% + cut=${fedMarket.cutProb}% + hike=${fedMarket.hikeProb}% = ${(fedMarket.holdProb ?? 0) + (fedMarket.cutProb ?? 0) + (fedMarket.hikeProb ?? 0)}%`);
  console.log(`Resulting Label     : ${fedMarket.summaryLabel}`);

  const fedNormSum = (fedMarket.holdProb ?? 0) + (fedMarket.cutProb ?? 0) + (fedMarket.hikeProb ?? 0);
  assertCond(
    fedNormSum === 100,
    'FED_RATE probabilities normalized to exactly 100%',
    `raw=${fedMarket.rawHoldPct}+${fedMarket.rawCutPct}+${fedMarket.rawHikePct}=${fedMarket.rawProbSumPct}% -> normalized=${fedMarket.holdProb}+${fedMarket.cutProb}+${fedMarket.hikeProb}=${fedNormSum}%`
  );

  console.log('\n--------------------------------------------------------------------------------');
  console.log('ITEM 2B: PREDICTION MARKET MAPPING TABLE (SAME INDICATOR + SAME RELEASE MONTH)');
  console.log('--------------------------------------------------------------------------------');
  const mappingTable = getPredictionMarketMappingTable();
  console.log('Indicator      | Release Month | Kalshi Ticker       | Polymarket Slug                     | Match / Drop Status');
  console.log('---------------+---------------+---------------------+-------------------------------------+------------------------------------------------------------');
  for (const row of mappingTable) {
    console.log(
      `${String(row.indicator).padEnd(14)} | ${String(row.releaseMonth).padEnd(13)} | ${String(row.kalshiTicker || 'none').padEnd(19)} | ${String(row.polymarketSlug || 'none').padEnd(35)} | ${row.matchedStatus}`
    );
  }

  const cpiYoyMarket = frozenMacroSnapshot.discoveredMarkets?.CPI_YOY;
  const cpiYoyMapRow = mappingTable.find((r) => r.indicator === 'CPI_YOY');
  assertCond(
    Boolean(cpiYoyMarket && !cpiYoyMarket.polymarketSlug && !cpiYoyMarket.summaryLabel.includes('core-cpi-yoy-october-2026')),
    'Mismatched Polymarket "core-cpi-yoy-october-2026" dropped from November Headline CPI_YOY',
    `CPI_YOY Kalshi=${cpiYoyMarket?.kalshiEventTicker} (month=${cpiYoyMarket?.releaseMonth}), attached polymarketSlug=${cpiYoyMarket?.polymarketSlug ?? 'null'}, label="${cpiYoyMarket?.summaryLabel}", mapStatus="${cpiYoyMapRow?.matchedStatus}"`
  );

  // ---------------------------------------------------------------------------
  // 4. ITEM 3: TEST c SIGN CHECK SIDE-BY-SIDE WITH SIGN TABLE
  // ---------------------------------------------------------------------------
  console.log('\n--------------------------------------------------------------------------------');
  console.log('ITEM 3: SIGN TABLE vs POST-RELEASE TEST INPUTS & RESULTING GOLD DIRECTION');
  console.log('--------------------------------------------------------------------------------');
  console.log('Why Round 8 Test c printed "Claims=BEARISH":');
  console.log('  In Round 8, phase5Tests.ts line 182 called computeGoldImpact("Jobless Claims", 220000, 200000, true).');
  console.log('  The function signature is computeGoldImpact(title, forecastNum, actualNum, isReleased).');
  console.log('  Passing forecastNum=220,000 and actualNum=200,000 tested Actual (200K) BELOW Forecast (220K) => BEARISH Gold,');
  console.log('  while the Sign Table row states Forecast ABOVE Previous => BULLISH Gold (and Forecast/Actual BELOW => BEARISH Gold).');
  console.log('  Test c in phase5Tests.ts now explicitly prints (actual, forecast, previous) and tests both Claims Above => BULLISH and Claims Below => BEARISH.');
  console.log('');

  interface SignVerificationCase {
    indicator: string;
    signTablePolarity: 'STANDARD' | 'INVERSE';
    signTableAbove: 'BEARISH (-1)' | 'BULLISH (+1)';
    signTableBelow: 'BULLISH (+1)' | 'BEARISH (-1)';
    actual: number;
    forecast: number;
    previous: number;
    preFcast: number;
    prePrev: number;
    comparison: string;
    expectedGoldDir: 'BULLISH' | 'BEARISH';
  }

  const signCases: SignVerificationCase[] = [
    {
      indicator: 'CPI m/m',
      signTablePolarity: 'STANDARD',
      signTableAbove: 'BEARISH (-1)',
      signTableBelow: 'BULLISH (+1)',
      actual: 0.4,
      forecast: 0.2,
      previous: 0.2,
      preFcast: 0.4,
      prePrev: 0.2,
      comparison: 'Above (0.4 > 0.2)',
      expectedGoldDir: 'BEARISH',
    },
    {
      indicator: 'GDP q/q',
      signTablePolarity: 'STANDARD',
      signTableAbove: 'BEARISH (-1)',
      signTableBelow: 'BULLISH (+1)',
      actual: 1.8,
      forecast: 2.5,
      previous: 2.5,
      preFcast: 1.8,
      prePrev: 2.5,
      comparison: 'Below (1.8 < 2.5)',
      expectedGoldDir: 'BULLISH',
    },
    {
      indicator: 'Unemployment Rate',
      signTablePolarity: 'INVERSE',
      signTableAbove: 'BULLISH (+1)',
      signTableBelow: 'BEARISH (-1)',
      actual: 4.1,
      forecast: 3.8,
      previous: 3.8,
      preFcast: 4.1,
      prePrev: 3.8,
      comparison: 'Above (4.1 > 3.8)',
      expectedGoldDir: 'BULLISH',
    },
    {
      indicator: 'Unemployment Claims (Above)',
      signTablePolarity: 'INVERSE',
      signTableAbove: 'BULLISH (+1)',
      signTableBelow: 'BEARISH (-1)',
      actual: 235000,
      forecast: 220000,
      previous: 210000,
      preFcast: 235000,
      prePrev: 210000,
      comparison: 'Above (235K > 220K)',
      expectedGoldDir: 'BULLISH',
    },
    {
      indicator: 'Unemployment Claims (Below)',
      signTablePolarity: 'INVERSE',
      signTableAbove: 'BULLISH (+1)',
      signTableBelow: 'BEARISH (-1)',
      actual: 200000,
      forecast: 220000,
      previous: 220000,
      preFcast: 200000,
      prePrev: 220000,
      comparison: 'Below (200K < 220K)',
      expectedGoldDir: 'BEARISH',
    },
  ];

  console.log('Indicator                    | Polarity | SignTable Above | SignTable Below | Actual | Forecast | Previous | Test Case           | Post-Release Dir | Pre-Release FcastRaw     | Consistent?');
  console.log('-----------------------------+----------+-----------------+-----------------+--------+----------+----------+---------------------+------------------+--------------------------+------------');

  for (const sc of signCases) {
    const cleanTitle = sc.indicator.replace(/\s*\(.*\)$/, '');
    const postReleaseDir = computeGoldImpact(cleanTitle, sc.forecast, sc.actual, true);
    const preReleaseDec = newsDecision(
      {
        id: `SIGN-TEST-${sc.indicator}`,
        title: cleanTitle,
        country: 'USD',
        impact: 'High',
        timeUtc: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        forecastNum: sc.preFcast,
        previousNum: sc.prePrev,
      },
      { macro: frozenMacroSnapshot, skipPersistence: true }
    );
    const fcastRow = (preReleaseDec.auditLog || []).find((r) => r.input === 'Forecast vs Previous');
    const fcastRaw = fcastRow?.rawScore ?? 0;
    const fcastDir = fcastRaw > 0 ? 'BULLISH' : fcastRaw < 0 ? 'BEARISH' : 'NEUTRAL';
    const isConsistent = postReleaseDir === sc.expectedGoldDir && fcastDir === sc.expectedGoldDir;

    console.log(
      `${sc.indicator.padEnd(28)} | ${sc.signTablePolarity.padEnd(8)} | ${sc.signTableAbove.padEnd(15)} | ${sc.signTableBelow.padEnd(15)} | ${String(sc.actual).padEnd(6)} | ${String(sc.forecast).padEnd(8)} | ${String(sc.previous).padEnd(8)} | ${sc.comparison.padEnd(19)} | ${postReleaseDir.padEnd(16)} | ${`${fcastRaw >= 0 ? '+' : ''}${fcastRaw.toFixed(2)} (${fcastDir})`.padEnd(24)} | ${isConsistent ? 'YES' : 'NO'}`
    );

    assertCond(
      isConsistent,
      `Sign Check consistency for ${sc.indicator}`,
      `actual=${sc.actual}, forecast=${sc.forecast}, previous=${sc.previous} -> postRelease=${postReleaseDir}, preReleaseFcast=${fcastRaw} (${fcastDir}), expected=${sc.expectedGoldDir}`
    );
  }

  // ---------------------------------------------------------------------------
  // 5. ITEM 1 & ITEM 4: REAL FOREX FACTORY FEED + newsDecision() AUDIT TABLES
  // ---------------------------------------------------------------------------
  console.log('\n--------------------------------------------------------------------------------');
  console.log('ITEM 1 & ITEM 4: LIVE FOREX FACTORY USD FEED & newsDecision() WEIGHTED TABLES');
  console.log('--------------------------------------------------------------------------------');

  const ffUrl = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
  let rawFfEvents: RawForexFactoryEvent[] = [];
  const ffCachePath = '/app/data/news_cache.json';

  try {
    const ffRes = await fetch(ffUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (ffRes.ok) {
      rawFfEvents = await ffRes.json();
    }
  } catch {}

  if (!Array.isArray(rawFfEvents) || rawFfEvents.length === 0) {
    if (fs.existsSync(ffCachePath)) {
      const cached = JSON.parse(fs.readFileSync(ffCachePath, 'utf-8'));
      rawFfEvents = cached.rawEvents || cached.events || [];
    }
  }

  const usdRaw = rawFfEvents.filter((e: any) => (e.country || e.currency) === 'USD');
  const rawClaims = usdRaw.find((e) => e.title === 'Unemployment Claims');
  const rawPmi = usdRaw.find((e) => e.title === 'Flash Manufacturing PMI');

  if (!rawClaims || !rawPmi) {
    console.error('FATAL: Unemployment Claims or Flash Manufacturing PMI not found in Forex Factory feed.');
    process.exit(1);
  }

  console.log('Raw Forex Factory Entry 1 (Unemployment Claims):');
  console.log(
    JSON.stringify({
      title: rawClaims.title,
      country: rawClaims.country,
      impact: rawClaims.impact,
      forecast: rawClaims.forecast,
      previous: rawClaims.previous,
      date: rawClaims.date,
    })
  );
  console.log('Raw Forex Factory Entry 2 (Flash Manufacturing PMI):');
  console.log(
    JSON.stringify({
      title: rawPmi.title,
      country: rawPmi.country,
      impact: rawPmi.impact,
      forecast: rawPmi.forecast,
      previous: rawPmi.previous,
      date: rawPmi.date,
    })
  );

  const nowMs = Date.now();
  const evtClaims = transformRawEvent(rawClaims);
  const evtPmi = transformRawEvent(rawPmi);

  function printAndAssertAuditTable(
    caseTitle: string,
    evtInput: any,
    dec: ReturnType<typeof newsDecision>
  ) {
    console.log(`\n=== ${caseTitle} ===`);
    console.log(`Event             : ${evtInput.title} (impact=${evtInput.impact}, forecast=${evtInput.forecastStr ?? evtInput.forecastNum ?? ''}, previous=${evtInput.previousStr ?? evtInput.previousNum ?? ''})`);
    console.log(`Verdict           : ${dec.word}`);
    console.log(`Headline Score    : ${dec.score === null ? 'null' : (dec.score >= 0 ? `+${dec.score}` : `${dec.score}`)} (UI scoreDisplay="${dec.scoreDisplay}", rawSumWeightedScore=${dec.rawSumWeightedScore >= 0 ? '+' : ''}${dec.rawSumWeightedScore})`);
    console.log(`Header Confidence : UI confidenceDisplay="${dec.confidenceDisplay}" | Internal confidence=${dec.confidence}% (status=${dec.confidenceStatus})`);
    console.log(`Exact Reason      : ${dec.reason}`);
    console.log('--------------------------------------------------------------------------------------------------------------------------------');
    console.log('Input                       | Group          | Base W | Final W (%) | Raw Score | Weighted Score | Dropped | Reason');
    console.log('----------------------------+----------------+--------+-------------+-----------+----------------+---------+------------------------------------');

    const audit = dec.auditLog || [];
    for (const row of audit) {
      const grp = row.group;
      console.log(
        `${row.input.padEnd(27)} | ${grp.padEnd(14)} | ${String(row.originalWeight).padStart(5)}% | ${row.renormalizedWeight.toFixed(1).padStart(10)}% | ${(row.rawScore >= 0 ? `+${row.rawScore.toFixed(2)}` : row.rawScore.toFixed(2)).padStart(9)} | ${(row.weightedScore >= 0 ? `+${row.weightedScore.toFixed(1)}` : row.weightedScore.toFixed(1)).padStart(14)} | ${row.dropped.padEnd(16)} | ${row.reason}`
      );
    }

    const sumFinalWeights = Number(audit.reduce((acc, r) => acc + r.renormalizedWeight, 0).toFixed(1));
    const sumWeightedRows = Number(audit.reduce((acc, r) => acc + r.weightedScore, 0).toFixed(1));
    const aiRow = audit.find((r) => r.group === 'advisor' || r.input.includes('AHMED AI'));
    const aiFinalWeight = aiRow ? aiRow.renormalizedWeight : 0;
    const marketRows = audit.filter((r) => r.group === 'market_context');
    const marketGroupWeight = Number(
      marketRows.reduce((acc, r) => acc + r.renormalizedWeight, 0).toFixed(1)
    );
    const activeEventRows = audit.filter(
      (r) =>
        r.group === 'event_specific' &&
        r.dropped === 'No' &&
        r.renormalizedWeight > 0 &&
        r.direction !== 'NEUTRAL' &&
        Math.abs(r.rawScore) >= 0.15
    );
    const maxSingleWeight = audit.reduce((max, r) => Math.max(max, r.renormalizedWeight), 0);

    console.log('--------------------------------------------------------------------------------------------------------------------------------');
    console.log(
      `Totals            : sumFinalWeights=${sumFinalWeights.toFixed(1)}% | marketGroupWeight=${marketGroupWeight.toFixed(1)}% | aiFinalWeight=${aiFinalWeight.toFixed(1)}% | activeNonAiEventInputs=${activeEventRows.length} | maxSingleWeight=${maxSingleWeight.toFixed(1)}% | sumWeightedRows=${sumWeightedRows >= 0 ? '+' : ''}${sumWeightedRows.toFixed(1)}`
    );

    // Programmatic assertions
    assertCond(
      Math.abs(sumFinalWeights - 100.0) < 0.05,
      `[${caseTitle}] sum of final weights = 100`,
      `sumFinalWeights=${sumFinalWeights}%`
    );
    assertCond(
      marketGroupWeight <= 40.0 + 1e-6,
      `[${caseTitle}] market context group total final weight <= 40%`,
      `marketGroupWeight=${marketGroupWeight}% <= 40.0%`
    );
    assertCond(
      aiFinalWeight <= 10.0 + 1e-6,
      `[${caseTitle}] AI final weight <= 10%`,
      `aiFinalWeight=${aiFinalWeight}% <= 10.0%`
    );

    if (activeEventRows.length < 2) {
      assertCond(
        dec.word === 'WAIT' && dec.score === null && dec.scoreDisplay === 'no call',
        `[${caseTitle}] < 2 active non-AI event inputs -> verdict=WAIT, score=null, scoreDisplay="no call"`,
        `activeEventInputs=${activeEventRows.length}, word=${dec.word}, score=${dec.score}, scoreDisplay="${dec.scoreDisplay}"`
      );
    } else {
      assertCond(
        marketGroupWeight <= 40.0 + 1e-6 && maxSingleWeight <= 35.0 + 1e-6,
        `[${caseTitle}] >= 2 active non-AI event inputs -> marketGroupWeight <= 40% and maxSingleWeight <= 35%`,
        `marketGroupWeight=${marketGroupWeight}%, maxSingleWeight=${maxSingleWeight}%`
      );
      if (dec.word !== 'WAIT') {
        assertCond(
          dec.score !== null && Math.abs(dec.score - sumWeightedRows) < 0.05,
          `[${caseTitle}] directional call headline score = sum of weighted rows`,
          `score=${dec.score}, sumWeightedRows=${sumWeightedRows}`
        );
      }
    }

    if (dec.word === 'WAIT') {
      assertCond(
        dec.confidenceDisplay === 'no call' &&
          !dec.confidenceDisplay.includes('0%') &&
          dec.confidence > 0 &&
          dec.reason.includes(`confidence=${dec.confidence}%`),
        `[${caseTitle}] WAIT display shows "no call" in header and uses single consistent confidence value (${dec.confidence}%) in details`,
        `confidenceDisplay="${dec.confidenceDisplay}", confidence=${dec.confidence}%, reasonContains="confidence=${dec.confidence}%"`
      );
    }
  }

  // Case 1: Live Unemployment Claims
  const decClaims = newsDecision(evtClaims, {
    macro: frozenMacroSnapshot,
    skipPersistence: true,
  });
  printAndAssertAuditTable('AUDIT TABLE 1: Unemployment Claims (Live Feed)', evtClaims, decClaims);

  // Case 2: Live Flash Manufacturing PMI (Rules / AI Inactive)
  const decPmi = newsDecision(evtPmi, {
    macro: frozenMacroSnapshot,
    skipPersistence: true,
  });
  printAndAssertAuditTable('AUDIT TABLE 2: Flash Manufacturing PMI (Live Feed)', evtPmi, decPmi);

  // Case 3: Live Flash Manufacturing PMI with active AHMED AI vote
  const evtPmiWithAi = {
    ...evtPmi,
    aiVote: 'BULLISH' as const,
    aiConfidence: 85,
  };
  const decPmiWithAi = newsDecision(evtPmiWithAi, {
    macro: frozenMacroSnapshot,
    skipPersistence: true,
  });
  printAndAssertAuditTable(
    'AUDIT TABLE 3: Flash Manufacturing PMI (With Active AHMED AI Vote — Proving AI <= 10% & Market <= 40%)',
    evtPmiWithAi,
    decPmiWithAi
  );

  // Case 4: Directional Call Possible (>= 2 active non-AI event inputs: Forecast + Kalshi CPI_YOY)
  const evtCpiDirectional = {
    id: 'AUDIT-CPI-YOY-2EV',
    title: 'CPI y/y',
    country: 'USD',
    impact: 'High',
    timeUtc: new Date(nowMs + 2 * 3600_000).toISOString(),
    forecastStr: '2.9%',
    previousStr: '2.6%',
    forecastNum: 2.9,
    previousNum: 2.6,
    aiVote: 'BEARISH' as const,
    aiConfidence: 80,
  };
  const decCpiDirectional = newsDecision(evtCpiDirectional, {
    macro: frozenMacroSnapshot,
    skipPersistence: true,
  });
  printAndAssertAuditTable(
    'AUDIT TABLE 4: CPI y/y (>= 2 Active Event Inputs: Forecast + Live Kalshi KXCPIYOY-26NOV + Live Market Context)',
    evtCpiDirectional,
    decCpiDirectional
  );

  // ---------------------------------------------------------------------------
  // 6. ITEM 5: PERSISTENT LIVE RELEASE LOGGER (DATA_DIR/release_live_log.json)
  // ---------------------------------------------------------------------------
  console.log('\n--------------------------------------------------------------------------------');
  console.log('ITEM 5: LIVE USD RELEASE LOGGER (DATA_DIR/release_live_log.json)');
  console.log('--------------------------------------------------------------------------------');
  const allUsdTransformed = usdRaw.map((r) => transformRawEvent(r));
  const loggerSummary = sampleLiveReleaseTicks({
    nowMs,
    events: allUsdTransformed.map((e) => ({
      id: e.id,
      title: e.title,
      country: e.country,
      impact: e.impact,
      date: e.timeUtc,
      timestamp: new Date(e.timeUtc).getTime(),
      actual: e.actualNum,
      forecast: e.forecastNum,
      previous: e.previousNum,
    })),
    liveGoldMid: liveTick ? liveTick.price : null,
    liveGoldLastQuoteAtMs: liveTick ? liveTick.timestamp : null,
    liveDxy: frozenMacroSnapshot.dxy && !frozenMacroSnapshot.dxy.isStale ? frozenMacroSnapshot.dxy.price : null,
    liveUs10y: frozenMacroSnapshot.us10y && !frozenMacroSnapshot.us10y.isStale ? frozenMacroSnapshot.us10y.yield : null,
  });

  console.log(`Persistent Storage Path  : ${loggerSummary.storagePath}`);
  console.log(`Logged Releases Count    : ${loggerSummary.loggedReleasesCount} (Completed: ${loggerSummary.completedReleasesCount}, Pending: ${loggerSummary.pendingReleasesCount}, Incomplete/Missing Ticks: ${loggerSummary.incompleteReleasesCount})`);
  console.log(`Min Required For HitRate : ${loggerSummary.minRequiredForHitRate}`);
  console.log(`Computed Hit Rate        : ${loggerSummary.hitRatePct === null ? 'null' : `${loggerSummary.hitRatePct}%`}`);
  console.log(`Hit Rate Status          : ${loggerSummary.hitRateStatus}`);
  if (loggerSummary.entries.length > 0) {
    console.log('Currently Tracked Live Release Entries (within tracking horizon):');
    for (const entry of loggerSummary.entries) {
      console.log(
        `  - ${entry.title} (${entry.impact}, release=${entry.releaseTimeIso}, status=${entry.outcomeStatus}): T-60m gold=${entry.ticks.tMinus60m.goldMid ?? 'null'}, T-5m gold=${entry.ticks.tMinus5m.goldMid ?? 'null'}, T0 gold=${entry.ticks.t0.goldMid ?? 'null'}, T+5m gold=${entry.ticks.tPlus5m.goldMid ?? 'null'}, T+15m gold=${entry.ticks.tPlus15m.goldMid ?? 'null'}`
      );
    }
  }

  assertCond(
    loggerSummary.storagePath === '/app/data/release_live_log.json' &&
      (loggerSummary.completedReleasesCount < 30 ? loggerSummary.hitRatePct === null : true),
    'Release Logger stores in DATA_DIR (/app/data/release_live_log.json) and does not compute hit rate before 30 completed releases',
    `path=${loggerSummary.storagePath}, completed=${loggerSummary.completedReleasesCount}/30, hitRatePct=${loggerSummary.hitRatePct}`
  );

  // ---------------------------------------------------------------------------
  // 7. ITEM 6: HISTORICAL 1-MINUTE XAUUSD DATA REACHABILITY CHECK ONLY
  // ---------------------------------------------------------------------------
  console.log('\n--------------------------------------------------------------------------------');
  console.log('ITEM 6: HISTORICAL 1-MINUTE XAUUSD DATA REACHABILITY CHECK');
  console.log('--------------------------------------------------------------------------------');
  // Check 1: Dukascopy 1-minute bi5/candlestick feed for a real historical date (2025-11-05 13:00 UTC)
  // Note: Dukascopy uses 0-indexed months (November = 10)
  const dukascopyUrl =
    'https://datafeed.dukascopy.com/datafeed/XAUUSD/2025/10/05/13h_ticks.bi5';
  const histDataUrl =
    'https://www.histdata.com/download-free-forex-historical-data/?/ascii/1-minute-bar-quotes/xauusd';

  for (const probe of [
    { name: 'Dukascopy (datafeed.dukascopy.com)', url: dukascopyUrl },
    { name: 'HistData (www.histdata.com)', url: histDataUrl },
  ]) {
    try {
      const res = await fetch(probe.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(8000),
      });
      const buf = await res.arrayBuffer();
      const reachable = res.ok && buf.byteLength > 0;
      console.log(
        `Source: ${probe.name.padEnd(36)} | Reachable: ${reachable ? 'YES' : 'NO '} | HTTP Status: ${res.status} ${res.statusText} | Bytes: ${buf.byteLength} | URL: ${probe.url}`
      );
    } catch (err: any) {
      console.log(
        `Source: ${probe.name.padEnd(36)} | Reachable: NO  | HTTP Status: ERROR (${err.message}) | URL: ${probe.url}`
      );
    }
  }
  console.log('Note (Round 9 Item 6): Check only. No historical backtest fabricated or built from daily candles.');

  // ---------------------------------------------------------------------------
  // 8. PHASE 5 TEST SUITE VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('\n--------------------------------------------------------------------------------');
  console.log('PHASE 5 AUTOMATED TEST SUITE EXECUTION');
  console.log('--------------------------------------------------------------------------------');
  const testReport = runPhase5TestSuite();
  for (const r of testReport.results) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] Test ${r.id}: ${r.name}`);
    console.log(`       Actual: ${r.actual}`);
  }
  console.log(`\nTest Suite Summary: ${testReport.passedCount}/${testReport.totalTests} passed (failed=${testReport.failedCount})`);
  assertCond(
    testReport.allPassed,
    'All Phase 5 unit tests pass',
    `${testReport.passedCount}/${testReport.totalTests} passed`
  );
  console.log('================================================================================');
}

runAuditRound9().catch((err) => {
  console.error('Unhandled error in audit_round9.ts:', err);
  process.exit(1);
});
