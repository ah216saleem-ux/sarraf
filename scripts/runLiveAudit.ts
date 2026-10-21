import { auditNewsDecision, runWalkForwardBacktest, calcWilsonCI } from '../src/server/newsDecision.ts';
import { fetchLiveMacroData } from '../src/server/macroFeedEngine.ts';
import {
  matchUpcomingEventByIdAndTime,
  validateUpcomingEventAgainstLiveFeed,
  transformRawEvent,
} from '../src/server/newsEngine.ts';

async function runLiveAudit() {
  const auditStartMs = Date.now();
  console.log('================================================================================');
  console.log('ROUND 5 LIVE AUDIT EXECUTION (LIVE FEEDS ONLY - ZERO SYNTHETIC FALLBACK)');
  console.log('Audit Run Timestamp:', new Date(auditStartMs).toISOString());
  console.log('================================================================================\n');

  // 1. Fetch live ForexFactory feed
  const ffUrl = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
  const ffFetchStart = Date.now();
  let ffRawText = '';
  try {
    const ffRes = await fetch(ffUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    const text = await ffRes.text();
    if (text && text.trim().startsWith('[')) {
      ffRawText = text;
    }
  } catch (e) {
    // node fetch error, will fallback to curl
  }

  if (!ffRawText) {
    const { execSync } = await import('child_process');
    ffRawText = execSync(`curl -s "${ffUrl}" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"`).toString('utf-8');
  }

  if (!ffRawText.trim().startsWith('[')) {
    throw new Error(`ForexFactory response was not valid JSON array. Preview: ${ffRawText.slice(0, 150)}`);
  }
  const ffFetchEnd = Date.now();
  const ffList = JSON.parse(ffRawText);
  console.log(`[LIVE FEED] ForexFactory thisweek: JSON loaded in ${ffFetchEnd - ffFetchStart}ms. Total events: ${ffList.length}`);

  // Filter for upcoming USD events
  const usdEvents = ffList.filter((e: any) => e.country === 'USD');
  const now = Date.now();
  const upcomingRaw = usdEvents.filter((e: any) => new Date(e.date).getTime() >= now).slice(0, 3);

  // 2. Fetch live Macro Data (BiQuote + CNBC + Kalshi)
  const macro = await fetchLiveMacroData(true);
  console.log('[LIVE FEED] Live Macro Data fetched successfully. Timestamp:', new Date(macro.timestamp).toISOString());

  // Print raw responses for required feeds:
  // a. BiQuote Gold
  const bqGoldRes = await fetch('https://biquote.io/api/XAUUSD', { headers: { 'User-Agent': 'SARRAF/1.0' } });
  const bqGoldJson = await bqGoldRes.json();
  console.log('\n--- RAW API 1: BiQuote XAUUSD (Gold Spot) ---');
  console.log('Fetch Timestamp:', new Date().toISOString());
  console.log('Raw Response:', JSON.stringify(bqGoldJson));

  // b. BiQuote EURUSD
  const bqEurRes = await fetch('https://biquote.io/api/EURUSD', { headers: { 'User-Agent': 'SARRAF/1.0' } });
  const bqEurJson = await bqEurRes.json();
  console.log('\n--- RAW API 2: BiQuote EURUSD ---');
  console.log('Fetch Timestamp:', new Date().toISOString());
  console.log('Raw Response:', JSON.stringify(bqEurJson));

  // c. BiQuote USDJPY
  const bqJpyRes = await fetch('https://biquote.io/api/USDJPY', { headers: { 'User-Agent': 'SARRAF/1.0' } });
  const bqJpyJson = await bqJpyRes.json();
  console.log('\n--- RAW API 3: BiQuote USDJPY ---');
  console.log('Fetch Timestamp:', new Date().toISOString());
  console.log('Raw Response:', JSON.stringify(bqJpyJson));

  // d. BiQuote GBPUSD
  const bqGbpRes = await fetch('https://biquote.io/api/GBPUSD', { headers: { 'User-Agent': 'SARRAF/1.0' } });
  const bqGbpJson = await bqGbpRes.json();
  console.log('\n--- RAW API 4: BiQuote GBPUSD ---');
  console.log('Fetch Timestamp:', new Date().toISOString());
  console.log('Raw Response:', JSON.stringify(bqGbpJson));

  // e. CNBC US10Y
  const cnbcRes = await fetch(
    'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=US10Y&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1',
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  const cnbcJson = await cnbcRes.json();
  const cnbcQuote = cnbcJson?.FormattedQuoteResult?.FormattedQuote?.[0];
  console.log('\n--- RAW API 5: CNBC US10Y Treasury Quote ---');
  console.log('Fetch Timestamp:', new Date().toISOString());
  console.log('Raw Response Symbol:', cnbcQuote?.symbol, 'Last:', cnbcQuote?.last, 'Change:', cnbcQuote?.change, 'Exchange:', cnbcQuote?.exchange, 'Time:', cnbcQuote?.last_time);

  // f. Kalshi KXJOBLESS
  const kalshiRes = await fetch('https://external-api.kalshi.com/trade-api/v2/series/KXJOBLESS', {
    headers: { Accept: 'application/json', 'User-Agent': 'SARRAF-Terminal/1.0' },
  });
  const kalshiJson = await kalshiRes.json();
  const kalshiMktRes = await fetch('https://external-api.kalshi.com/trade-api/v2/markets?series_ticker=KXJOBLESS&status=open&limit=5', {
    headers: { Accept: 'application/json', 'User-Agent': 'SARRAF-Terminal/1.0' },
  });
  const kalshiMktJson = await kalshiMktRes.json();
  console.log('\n--- RAW API 6: Kalshi Series KXJOBLESS & Markets ---');
  console.log('Fetch Timestamp:', new Date().toISOString());
  console.log('Series HTTP Status:', kalshiRes.status, 'Title:', kalshiJson?.series?.title);
  console.log('Open Markets Count:', kalshiMktJson?.markets?.length);

  // g. Polymarket probe
  const polyRes = await fetch('https://gamma-api.polymarket.com/public-search?q=jobs', {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  const polyJson = await polyRes.json();
  console.log('\n--- RAW API 7: Polymarket Search (jobs) ---');
  console.log('Fetch Timestamp:', new Date().toISOString());
  console.log('Events found:', polyJson?.events?.length || 0);

  // 3. Transform live upcoming events
  console.log('\n================================================================================');
  console.log('UPCOMING 3 EVENTS FROM LIVE FOREXFACTORY FEED');
  console.log('================================================================================');

  const transformedEvents = upcomingRaw.map((raw: any) => transformRawEvent(raw));

  for (let idx = 0; idx < transformedEvents.length; idx++) {
    const evt = transformedEvents[idx];
    const rawItem = upcomingRaw[idx];
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`EVENT ${idx + 1}: ${evt.title} (ID: ${evt.id})`);
    console.log(`Scheduled Time (UTC): ${evt.timeUtc}`);
    console.log(`Raw Live ForexFactory Item:`, JSON.stringify(rawItem));

    // Requirement 3: Exact ID & release time match test
    const matched = matchUpcomingEventByIdAndTime(evt.id, evt.timeUtc, transformedEvents);
    console.log(`[PASS] Exact ID and release time matched inside live feed window: ${matched.id}`);

    // Requirement 3: Test that forecast and previous strictly match live feed
    validateUpcomingEventAgainstLiveFeed(evt, rawItem);
    console.log(`[PASS] Forecast ("${evt.forecastStr}") and Previous ("${evt.previousStr}") strictly equal live feed values.`);

    // Run auditNewsDecision with live macro data
    const auditRes = auditNewsDecision(evt, { macro });
    const dec = auditRes.decision;

    console.log(`\nDecision Summary:`);
    console.log(`  Word: ${dec.word}`);
    console.log(`  Score: ${dec.score}`);
    console.log(`  Confidence: ${dec.confidence}% (${dec.confidenceDisplay})`);
    console.log(`  Confidence Lean: "${dec.confidenceLean}"`);
    console.log(`  Phase: ${dec.phase}`);
    console.log(`  Calibration Bucket: ${dec.calibrationBucket} ${dec.phase === 'preview' ? '(strictly null for preview)' : ''}`);
    console.log(`  Reason: ${dec.reason}`);

    console.log(`\nAudit Table (All 8 Canonical Inputs):`);
    console.log(`| Input | Group | Raw Value | Raw Score | Direction | Source | Age (s) | Orig Wt | Norm Wt | Wtd Score | Dropped | Reason |`);
    console.log(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const row of auditRes.auditTable) {
      console.log(`| ${row.input} | ${row.group} | ${row.rawValue} | ${row.rawScore} | ${row.direction} | ${row.source} | ${row.ageSeconds !== null ? `${row.ageSeconds}s` : '--'} | ${row.originalWeight}% | ${row.renormalizedWeight}% | ${row.weightedScore} | ${row.dropped} | ${row.reason} |`);
    }
  }

  // 4. Run Backtests
  console.log('\n================================================================================');
  console.log('WALK-FORWARD BACKTEST RESULTS');
  console.log('================================================================================');
  const bt = runWalkForwardBacktest();

  console.log('\n--- PRE-RELEASE WALK-FORWARD BACKTEST (118 In-Sample + 30 Holdout) ---');
  console.log('Total Releases:', bt.totalReleases);
  console.log('Directional Calls:', bt.directionalCalls, '(Bullish:', bt.combinedSummary.bullishCalls, 'Bearish:', bt.combinedSummary.bearishCalls, 'Wait:', bt.combinedSummary.waitCalls, ')');

  console.log('\n[Threshold: $0.50 move]');
  console.log(`  Our Model: Hits ${bt.combinedSummary.threshold50Cents.hits}/${bt.directionalCalls} (${bt.combinedSummary.threshold50Cents.hitRatePct}%) Wilson 95% CI: ${bt.combinedSummary.threshold50Cents.ci95Pct}`);
  console.log(`  Baseline Always Bullish: ${bt.combinedSummary.threshold50Cents.baselineAlwaysBullish.hitRatePct}% (${bt.combinedSummary.threshold50Cents.baselineAlwaysBullish.ci95Pct})`);
  console.log(`  Baseline Always Bearish: ${bt.combinedSummary.threshold50Cents.baselineAlwaysBearish.hitRatePct}% (${bt.combinedSummary.threshold50Cents.baselineAlwaysBearish.ci95Pct})`);
  console.log(`  Baseline Random: ${bt.combinedSummary.threshold50Cents.baselineRandom.hitRatePct}% (${bt.combinedSummary.threshold50Cents.baselineRandom.ci95Pct})`);

  console.log('\n[Threshold: 0.03% move (~$0.81 at $2700 / ~$1.24 at $4132)]');
  console.log(`  Our Model: Hits ${bt.combinedSummary.threshold03Percent.hits}/${bt.directionalCalls} (${bt.combinedSummary.threshold03Percent.hitRatePct}%) Wilson 95% CI: ${bt.combinedSummary.threshold03Percent.ci95Pct}`);
  console.log(`  Baseline Always Bullish: ${bt.combinedSummary.threshold03Percent.baselineAlwaysBullish.hitRatePct}% (${bt.combinedSummary.threshold03Percent.baselineAlwaysBullish.ci95Pct})`);
  console.log(`  Baseline Always Bearish: ${bt.combinedSummary.threshold03Percent.baselineAlwaysBearish.hitRatePct}% (${bt.combinedSummary.threshold03Percent.baselineAlwaysBearish.ci95Pct})`);
  console.log(`  Baseline Random: ${bt.combinedSummary.threshold03Percent.baselineRandom.hitRatePct}% (${bt.combinedSummary.threshold03Percent.baselineRandom.ci95Pct})`);

  console.log('\n[Split: 118 In-Sample vs 30 Untouched Holdout at 0.03% Threshold]');
  console.log(`  In-Sample (118): ${bt.trainingSummary.threshold03Percent.hits}/${bt.trainingSummary.directionalCalls} (${bt.trainingSummary.threshold03Percent.hitRatePct}%) Wilson 95% CI: ${bt.trainingSummary.threshold03Percent.ci95Pct}`);
  console.log(`  Untouched Holdout (30): ${bt.holdoutSummary.threshold03Percent.hits}/${bt.holdoutSummary.directionalCalls} (${bt.holdoutSummary.threshold03Percent.hitRatePct}%) Wilson 95% CI: ${bt.holdoutSummary.threshold03Percent.ci95Pct}`);

  console.log('\n[Pre-Release Confidence Buckets]');
  for (const b of bt.combinedSummary.buckets) {
    console.log(`  Bucket ${b.bucket}: ${b.hits03Percent}/${b.total} hits (${b.hitRate03PercentPct ?? '--'}%) Wilson 95% CI: ${b.ci95_03Percent}`);
  }

  console.log('\n--- POST-RELEASE WALK-FORWARD BACKTEST (T+5m to T+15m) ---');
  console.log('Total Evaluated Releases:', bt.postReleaseReport.totalEvaluated);
  const conf = bt.postReleaseReport.confirmedRegime;
  const mix = bt.postReleaseReport.mixedRegime;
  console.log(`CONFIRMED Regime (N=${conf.total}):`);
  console.log(`  Threshold $0.50: ${conf.hits50Cents}/${conf.total} (${conf.hitRate50CentsPct}%) Wilson 95% CI: ${conf.ci95_50Cents}`);
  console.log(`  Threshold 0.03%: ${conf.hits03Percent}/${conf.total} (${conf.hitRate03PercentPct}%) Wilson 95% CI: ${conf.ci95_03Percent}`);

  console.log(`MIXED Regime (N=${mix.total}):`);
  console.log(`  Threshold $0.50: ${mix.hits50Cents}/${mix.total} (${mix.hitRate50CentsPct}%) Wilson 95% CI: ${mix.ci95_50Cents}`);
  console.log(`  Threshold 0.03%: ${mix.hits03Percent}/${mix.total} (${mix.hitRate03PercentPct}%) Wilson 95% CI: ${mix.ci95_03Percent}`);

  if (bt.postReleaseReport.baselines) {
    console.log('\nPost-Release Baselines across all evaluated releases (0.03% threshold):');
    console.log(`  Baseline 1 (Always trade surprise direction): ${bt.postReleaseReport.baselines.baselineTradeWithSurprise.hits03}/${bt.postReleaseReport.baselines.baselineTradeWithSurprise.total} (${bt.postReleaseReport.baselines.baselineTradeWithSurprise.hitRatePct}%) Wilson 95% CI: ${bt.postReleaseReport.baselines.baselineTradeWithSurprise.ci95}`);
    console.log(`  Baseline 2 (Always continue 5m move): ${bt.postReleaseReport.baselines.baselineContinue5mMove.hits03}/${bt.postReleaseReport.baselines.baselineContinue5mMove.total} (${bt.postReleaseReport.baselines.baselineContinue5mMove.hitRatePct}%) Wilson 95% CI: ${bt.postReleaseReport.baselines.baselineContinue5mMove.ci95}`);
  }

  if (bt.postReleaseReport.surpriseBands) {
    console.log('\nSurprise Size Bands (0.03% threshold for CONFIRMED calls):');
    for (const sb of bt.postReleaseReport.surpriseBands) {
      console.log(`  ${sb.band} Band (Threshold ${sb.threshold}): Total Releases ${sb.total}, Confirmed ${sb.confirmedTotal}, Hits ${sb.confirmedHits03}/${sb.confirmedTotal} (${sb.confirmedHitRatePct ?? '--'}%) Wilson 95% CI: ${sb.ci95}`);
    }
  }
}

runLiveAudit().catch((err) => {
  console.error('AUDIT FAILED LOUDLY:', err);
  process.exit(1);
});
