import { execSync } from 'child_process';
import { auditNewsDecision, runWalkForwardBacktest, calcWilsonCI } from '../src/server/newsDecision.ts';
import { fetchLiveMacroData } from '../src/server/macroFeedEngine.ts';
import {
  matchUpcomingEventByIdAndTime,
  validateUpcomingEventAgainstLiveFeed,
  transformRawEvent,
} from '../src/server/newsEngine.ts';

async function main() {
  const auditStartMs = Date.now();
  console.log('=== SARRAF ROUND 5 LIVE AUDIT EXECUTION ===');
  console.log('Start Time:', new Date(auditStartMs).toISOString());

  // 1. Fetch live ForexFactory feed
  const ffUrl = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
  const curlCmd = `curl -s "${ffUrl}" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"`;
  const ffRaw = execSync(curlCmd, { encoding: 'utf-8', timeout: 15000 });
  if (!ffRaw.trim().startsWith('[')) {
    throw new Error('ForexFactory feed failed: did not return JSON array');
  }
  const ffEvents: any[] = JSON.parse(ffRaw);
  console.log(`Live ForexFactory Feed: ${ffEvents.length} total events fetched.`);

  // 2. Fetch live Macro Data
  const macro = await fetchLiveMacroData(true);
  const macroFetchTs = new Date(macro.timestamp).toISOString();
  console.log(`Live Macro Data fetched at: ${macroFetchTs}`);

  // Fetch individual live market quotes for raw display
  const bqGoldRaw = execSync(`curl -s "https://biquote.io/api/XAUUSD"`, { encoding: 'utf-8', timeout: 8000 });
  const bqEurRaw = execSync(`curl -s "https://biquote.io/api/EURUSD"`, { encoding: 'utf-8', timeout: 8000 });
  const bqJpyRaw = execSync(`curl -s "https://biquote.io/api/USDJPY"`, { encoding: 'utf-8', timeout: 8000 });
  const bqGbpRaw = execSync(`curl -s "https://biquote.io/api/GBPUSD"`, { encoding: 'utf-8', timeout: 8000 });

  // Kalshi API checks
  let kalshiJoblessRaw = 'N/A';
  try {
    kalshiJoblessRaw = execSync(`curl -s "https://api.elections.kalshi.com/trade-api/v2/series/KXJOBLESS"`, { encoding: 'utf-8', timeout: 8000 });
  } catch (e: any) {
    kalshiJoblessRaw = `Error: ${e.message}`;
  }

  let kalshiMacroRaw = 'N/A';
  try {
    kalshiMacroRaw = execSync(`curl -s "https://api.elections.kalshi.com/trade-api/v2/series/KXMACRO"`, { encoding: 'utf-8', timeout: 8000 });
  } catch (e: any) {
    kalshiMacroRaw = `Error: ${e.message}`;
  }

  console.log('\n--- LIVE RAW QUOTES (Age <= 60s) ---');
  console.log(`BiQuote XAUUSD (Gold): ${bqGoldRaw.trim()}`);
  console.log(`BiQuote EURUSD: ${bqEurRaw.trim()}`);
  console.log(`BiQuote USDJPY: ${bqJpyRaw.trim()}`);
  console.log(`BiQuote GBPUSD: ${bqGbpRaw.trim()}`);
  console.log(`CNBC US10Y: Yield=${macro.us10y?.yield}%, ChangeBp=${macro.us10y?.changeBp}bp, AgeMs=${macro.us10y?.ageMs}ms, Direction=${macro.us10y?.direction}`);
  console.log(`Kalshi Series KXJOBLESS: ${kalshiJoblessRaw.slice(0, 150)}...`);
  console.log(`Kalshi Series KXMACRO: ${kalshiMacroRaw.slice(0, 150)}...`);

  // 3. Find next 3 USD upcoming events
  const usdUpcoming = ffEvents
    .filter((e) => e.country === 'USD' && new Date(e.date).getTime() >= auditStartMs)
    .slice(0, 3);

  console.log(`\nNext 3 USD Upcoming Events Count: ${usdUpcoming.length}`);

  // 4. Validate and Run Audits
  for (let i = 0; i < usdUpcoming.length; i++) {
    const raw = usdUpcoming[i];
    console.log(`\n================================================================================`);
    console.log(`EVENT ${i + 1}: ${raw.title}`);
    console.log(`Raw FF JSON: ${JSON.stringify(raw)}`);

    // Validation test: must match by exact id and release time, and forecast/previous must equal live feed
    const transformed = transformRawEvent(raw, []);
    const matched = matchUpcomingEventByIdAndTime(transformed.id, transformed.timeUtc, [raw]);
    if (!matched) {
      throw new Error(`Event lookup failed: could not match ${transformed.id} at ${transformed.timeUtc}`);
    }
    // Validate values equal feed
    validateUpcomingEventAgainstLiveFeed(transformed, raw);
    console.log(`✓ Validation Passed: Forecast ("${transformed.forecastStr}") and Previous ("${transformed.previousStr}") strictly equal live feed.`);

    // Run decision audit
    const auditRes = auditNewsDecision(transformed, { macro });
    console.log(`Decision Word: ${auditRes.decision.word} | Confidence: ${auditRes.decision.confidenceDisplay} | Lean: ${auditRes.decision.confidenceLean} | Score: ${auditRes.decision.score} | Bucket: ${auditRes.decision.calibrationBucket ?? 'null (preview)'}`);
    console.log(`Reason: ${auditRes.decision.reason}`);
    console.log(`Audited Inputs (${auditRes.auditTable.length} total):`);
    for (const row of auditRes.auditTable) {
      console.log(`  - [${row.input}] Raw: "${row.rawValue}" | Dir: ${row.direction} | OrigWt: ${row.originalWeight}% | RenormWt: ${row.renormalizedWeight}% | WtScore: ${row.weightedScore} | Dropped: ${row.dropped} | Reason: ${row.reason}`);
    }
  }

  // 5. Run Walk-Forward Backtests
  console.log(`\n================================================================================`);
  console.log(`WALK-FORWARD BACKTEST RESULTS`);
  console.log(`================================================================================`);
  const bt = runWalkForwardBacktest();

  console.log(`\nPRE-RELEASE (148 Total Releases):`);
  console.log(`Total Evaluated: ${bt.totalReleases} | Directional Calls: ${bt.directionalCalls} | WAITs: ${bt.totalReleases - bt.directionalCalls}`);
  console.log(`Combined 148 ($0.50 threshold): ${bt.combinedSummary.threshold50Cents.hits}/${bt.combinedSummary.directionalCalls} (${bt.combinedSummary.threshold50Cents.hitRatePct}%) 95% Wilson CI: ${bt.combinedSummary.threshold50Cents.ci95Pct}`);
  console.log(`Combined 148 (0.03% threshold): ${bt.combinedSummary.threshold03Percent.hits}/${bt.combinedSummary.directionalCalls} (${bt.combinedSummary.threshold03Percent.hitRatePct}%) 95% Wilson CI: ${bt.combinedSummary.threshold03Percent.ci95Pct}`);
  console.log(`Baselines (0.03% threshold):`);
  console.log(`  Always BULLISH: ${bt.combinedSummary.threshold03Percent.baselineAlwaysBullish.hits}/${bt.directionalCalls} (${bt.combinedSummary.threshold03Percent.baselineAlwaysBullish.hitRatePct}%) 95% Wilson CI: ${bt.combinedSummary.threshold03Percent.baselineAlwaysBullish.ci95Pct}`);
  console.log(`  Always BEARISH: ${bt.combinedSummary.threshold03Percent.baselineAlwaysBearish.hits}/${bt.directionalCalls} (${bt.combinedSummary.threshold03Percent.baselineAlwaysBearish.hitRatePct}%) 95% Wilson CI: ${bt.combinedSummary.threshold03Percent.baselineAlwaysBearish.ci95Pct}`);
  console.log(`  Random Call: ${bt.combinedSummary.threshold03Percent.baselineRandom.hitRatePct}% 95% Wilson CI: ${bt.combinedSummary.threshold03Percent.baselineRandom.ci95Pct}`);

  console.log(`\nIn-Sample vs Holdout Split (0.03% threshold):`);
  console.log(`  In-Sample (118): ${bt.trainingSummary.threshold03Percent.hits}/${bt.trainingSummary.directionalCalls} (${bt.trainingSummary.threshold03Percent.hitRatePct}%) 95% Wilson CI: ${bt.trainingSummary.threshold03Percent.ci95Pct}`);
  console.log(`  Untouched Holdout (30): ${bt.holdoutSummary.threshold03Percent.hits}/${bt.holdoutSummary.directionalCalls} (${bt.holdoutSummary.threshold03Percent.hitRatePct}%) 95% Wilson CI: ${bt.holdoutSummary.threshold03Percent.ci95Pct}`);

  console.log(`\nConfidence Buckets (0.03% threshold):`);
  for (const b of bt.combinedSummary.buckets) {
    console.log(`  Bucket ${b.bucket}: ${b.hits03Percent}/${b.total} (${b.hitRate03PercentPct ?? '--'}%) 95% Wilson CI: ${b.ci95_03Percent}`);
  }

  console.log(`\nPOST-RELEASE WALK-FORWARD (T+5m to T+15m return):`);
  const pr = bt.postReleaseReport;
  console.log(`Total Evaluated: ${pr.totalEvaluated}`);
  console.log(`CONFIRMED Regime (N=${pr.confirmedRegime.total}):`);
  console.log(`  $0.50 Threshold: ${pr.confirmedRegime.hits50Cents}/${pr.confirmedRegime.total} (${pr.confirmedRegime.hitRate50CentsPct}%) 95% Wilson CI: ${pr.confirmedRegime.ci95_50Cents}`);
  console.log(`  0.03% Threshold: ${pr.confirmedRegime.hits03Percent}/${pr.confirmedRegime.total} (${pr.confirmedRegime.hitRate03PercentPct}%) 95% Wilson CI: ${pr.confirmedRegime.ci95_03Percent}`);
  console.log(`MIXED Regime (N=${pr.mixedRegime.total}):`);
  console.log(`  $0.50 Threshold: ${pr.mixedRegime.hits50Cents}/${pr.mixedRegime.total} (${pr.mixedRegime.hitRate50CentsPct}%) 95% Wilson CI: ${pr.mixedRegime.ci95_50Cents}`);
  console.log(`  0.03% Threshold: ${pr.mixedRegime.hits03Percent}/${pr.mixedRegime.total} (${pr.mixedRegime.hitRate03PercentPct}%) 95% Wilson CI: ${pr.mixedRegime.ci95_03Percent}`);

  if (pr.baselines) {
    console.log(`\nPost-Release Baselines across all evaluated releases (0.03% threshold):`);
    console.log(`  Baseline 1 (Always trade surprise direction): ${pr.baselines.baselineTradeWithSurprise.hits03}/${pr.baselines.baselineTradeWithSurprise.total} (${pr.baselines.baselineTradeWithSurprise.hitRatePct}%) 95% Wilson CI: ${pr.baselines.baselineTradeWithSurprise.ci95}`);
    console.log(`  Baseline 2 (Always continue 5m move): ${pr.baselines.baselineContinue5mMove.hits03}/${pr.baselines.baselineContinue5mMove.total} (${pr.baselines.baselineContinue5mMove.hitRatePct}%) 95% Wilson CI: ${pr.baselines.baselineContinue5mMove.ci95}`);
  }

  if (pr.surpriseBands) {
    console.log(`\nSurprise Size Bands (CONFIRMED Calls at 0.03% threshold):`);
    for (const sb of pr.surpriseBands) {
      console.log(`  ${sb.band} Band (Threshold: ${sb.threshold}): Total Releases ${sb.total}, Confirmed ${sb.confirmedTotal}, Hits ${sb.confirmedHits03}/${sb.confirmedTotal} (${sb.confirmedHitRatePct}%) 95% Wilson CI: ${sb.ci95}`);
    }
  }
}

main().catch((err) => {
  console.error('LIVE AUDIT RUN FAILED:', err);
  process.exit(1);
});
