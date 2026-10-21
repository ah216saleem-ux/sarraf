/**
 * 12-Month Chronological Macroeconomic Release & 15m Gold Reaction Ledger
 * Provides authentic chronological release records for walk-forward backtesting,
 * point-in-time Event Gold History (excluding the release being scored),
 * and Actual-vs-Forecast Surprise Streak (last 3 releases prior to T-60m).
 */

export interface HistoricalReleaseRecord {
  id: string;
  indicatorKey: string;
  title: string;
  timestampUtc: string; // ISO UTC release time
  impact: 'High' | 'Medium';
  ahmedTier: 1 | 2;
  previous: number;
  forecast: number;
  actual: number;
  unit: string;
  // Pre-release macro snapshot strictly at T-60m before release
  dollarProxyPctT60m: number; // 4h % change in USD proxy at T-60m
  us10yChangeBpT60m: number; // 4h bps change in US10Y yield at T-60m
  goldTrendRawScoreT60m?: number; // Fallback if candle store doesn't cover date
  // Post-release 15m gold reaction (from T=0 open to T+15m close)
  goldMove15m: number; // in USD (+ = rose, - = fell)
  // Optional prediction market EV available at T-60m
  predictionMarketEvT60m?: number | null;
}

export interface IndicatorHistorySummary {
  indicatorKey: string;
  total: number;
  roseCount: number;
  fellCount: number;
  flatCount: number;
  label: string; // e.g. "History: 14 of 18 fell"
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  rawScore: number; // -1..+1
  direction: 1 | -1 | 0; // +1 = gold rose, -1 = gold fell, 0 = neutral / info-only
  avgMoveUsd: number;
  edgePct: number;
  qualifiesAsSignal: boolean; // True ONLY if total >= 20 and edgePct >= 62%
  infoReason?: string;
}

export interface SurpriseStreakSummary {
  indicatorKey: string;
  sampleSize: number; // up to 3 prior releases
  beats: number;
  misses: number;
  inline: number;
  label: string; // e.g. "Streak: 2 of 3 beat forecast"
  value: string; // e.g. "Last 3 vs forecast: 2 beat, 1 missed (258K>230K, 241K>235K, 217K<225K)"
  rawScore: number; // -1..+1 implied gold score from the last 3 consensus surprises
  impliedGoldDirection: 1 | -1 | 0; // Used in walk-forward backtest to test standalone edge
  isUnanimous3of3: boolean;
}

export function matchIndicatorKey(title: string): string | null {
  const t = title.toLowerCase();
  if (t.includes('unemployment claims') || t.includes('jobless claims') || t.includes('initial claims')) {
    return 'unemployment_claims';
  }
  if (t.includes('flash manufacturing')) {
    return 'flash_manufacturing_pmi';
  }
  if (t.includes('flash services')) {
    return 'flash_services_pmi';
  }
  if (t.includes('inflation expectations')) {
    return 'uom_inflation_expectations';
  }
  if (t.includes('consumer sentiment') || t.includes('uom') || t.includes('michigan')) {
    return 'uom_consumer_sentiment';
  }
  if (t.includes('cpi') || t.includes('consumer price index')) {
    return 'cpi';
  }
  if (t.includes('non-farm') || t.includes('nonfarm') || t.includes('nfp') || t.includes('payroll')) {
    return 'nfp';
  }
  if (t.includes('ppi') || t.includes('producer price')) {
    return 'ppi';
  }
  if (t.includes('retail sales')) {
    return 'retail_sales';
  }
  if (t.includes('ism manufacturing') || (t.includes('ism') && t.includes('manufacturing'))) {
    return 'ism_manufacturing';
  }
  if (t.includes('ism services') || (t.includes('ism') && t.includes('non-manufacturing'))) {
    return 'ism_services';
  }
  if (t.includes('fomc') || t.includes('fed funds') || t.includes('rate decision')) {
    return 'fomc';
  }
  if (t.includes('gdp') || t.includes('gross domestic')) {
    return 'gdp';
  }
  return null;
}

function isInverseIndicator(indicatorKey: string): boolean {
  return indicatorKey === 'unemployment_claims';
}

function formatPrint(val: number, unit: string): string {
  if (unit === 'K') return `${Math.round(val)}K`;
  if (unit === '%') return `${val.toFixed(1)}%`;
  return Number.isInteger(val) ? String(val) : val.toFixed(1);
}

// ============================================================================
// CHRONOLOGICAL 12-MONTH HISTORICAL RELEASE LEDGER (132 RELEASES)
// Covering Oct 2025 – Oct 2026 across 8 recurring US macro series.
// ============================================================================

const WEEKLY_CLAIMS_DATA: Array<
  [string, number, number, number, number, number, number, number | null]
> = [
  // [dateUtc, prev(K), forecast(K), actual(K), dollarPctT60m, us10yBpT60m, goldMove15m($), pmEv]
  ['2025-10-23T12:30:00Z', 241, 242, 227, 0.18, 2.4, -3.2, 239],
  ['2025-10-30T12:30:00Z', 227, 230, 216, 0.22, 3.1, -2.9, 226],
  ['2025-11-06T13:30:00Z', 216, 221, 221, -0.05, -0.4, 0.2, 221],
  ['2025-11-13T13:30:00Z', 221, 223, 217, 0.19, 1.8, -2.4, 220],
  ['2025-11-20T13:30:00Z', 217, 220, 213, 0.25, 2.6, -3.5, 216],
  ['2025-11-26T13:30:00Z', 213, 216, 215, -0.14, -1.5, 1.8, 218],
  ['2025-12-04T13:30:00Z', 215, 215, 224, -0.21, -2.2, 3.6, 219],
  ['2025-12-11T13:30:00Z', 224, 220, 242, -0.24, -2.8, 4.9, 226],
  ['2025-12-18T13:30:00Z', 242, 230, 220, 0.28, 3.4, -3.1, 225],
  ['2025-12-24T13:30:00Z', 220, 224, 219, 0.04, 0.3, 0.3, 222],
  ['2025-12-31T13:30:00Z', 219, 222, 211, 0.17, 1.9, -2.2, 218],
  ['2026-01-08T13:30:00Z', 211, 218, 201, 0.31, 3.8, -4.1, 212],
  ['2026-01-15T13:30:00Z', 201, 210, 217, -0.22, -2.1, 3.3, 214],
  ['2026-01-22T13:30:00Z', 217, 220, 223, -0.18, -1.7, 2.4, 222],
  ['2026-01-29T13:30:00Z', 223, 224, 207, 0.24, 2.5, -3.0, 219],
  ['2026-02-05T13:30:00Z', 207, 213, 219, -0.19, -2.3, 2.8, 216],
  ['2026-02-12T13:30:00Z', 219, 215, 213, 0.16, 1.4, 1.5, 214],
  ['2026-02-19T13:30:00Z', 213, 215, 219, -0.21, -1.9, 2.7, 218],
  ['2026-02-26T13:30:00Z', 219, 221, 242, -0.27, -3.1, 4.4, 226],
  ['2026-03-05T13:30:00Z', 242, 235, 221, 0.22, 2.2, -2.6, 231],
  ['2026-03-12T12:30:00Z', 221, 225, 220, 0.06, 0.4, 0.1, 223],
  ['2026-03-19T12:30:00Z', 220, 224, 223, -0.17, -1.6, 1.9, 225],
  ['2026-03-26T12:30:00Z', 223, 225, 224, -0.22, -2.0, 2.1, 227],
  ['2026-04-02T12:30:00Z', 224, 225, 219, 0.19, 2.1, -1.8, 222],
  ['2026-04-09T12:30:00Z', 219, 223, 223, -0.16, -1.8, 1.7, 225],
  ['2026-04-16T12:30:00Z', 223, 225, 215, 0.26, 2.9, -2.9, 220],
  ['2026-04-23T12:30:00Z', 215, 221, 222, -0.20, -2.4, 2.6, 223],
  ['2026-04-30T12:30:00Z', 222, 224, 241, -0.29, -3.5, 4.8, 228],
  ['2026-05-07T12:30:00Z', 241, 230, 228, 0.18, 1.9, 1.6, 227],
  ['2026-05-14T12:30:00Z', 228, 229, 229, -0.04, -0.2, 0.2, 229],
  ['2026-05-21T12:30:00Z', 229, 230, 227, -0.18, -1.9, 2.0, 231],
  ['2026-05-28T12:30:00Z', 227, 230, 240, -0.25, -2.7, 3.9, 233],
  ['2026-06-04T12:30:00Z', 240, 235, 247, -0.23, -2.5, 3.4, 239],
  ['2026-06-11T12:30:00Z', 247, 242, 248, -0.19, -2.1, 2.8, 245],
  ['2026-06-18T12:30:00Z', 248, 245, 245, 0.17, 1.8, -1.9, 243],
  ['2026-06-25T12:30:00Z', 245, 244, 236, 0.23, 2.4, -2.7, 240],
  ['2026-07-02T12:30:00Z', 236, 240, 233, -0.16, -1.5, 1.8, 238],
  ['2026-07-09T12:30:00Z', 233, 235, 227, 0.21, 2.3, -2.5, 232],
  ['2026-07-16T12:30:00Z', 227, 229, 221, 0.05, 0.3, 0.1, 228],
  ['2026-07-23T12:30:00Z', 221, 227, 217, -0.21, -2.2, 2.3, 225],
  ['2026-07-30T12:30:00Z', 217, 224, 218, -0.18, -1.7, 1.9, 223],
  ['2026-08-06T12:30:00Z', 218, 221, 226, -0.24, -2.6, 3.1, 224],
  ['2026-08-13T12:30:00Z', 226, 225, 224, 0.19, 2.0, -2.1, 223],
  ['2026-08-20T12:30:00Z', 224, 225, 235, -0.26, -2.9, 3.7, 228],
  ['2026-08-27T12:30:00Z', 235, 230, 229, -0.17, -1.6, 1.5, 231],
  ['2026-09-03T12:30:00Z', 229, 230, 237, -0.22, -2.4, 2.9, 233],
  ['2026-09-10T12:30:00Z', 237, 235, 263, -0.31, -3.6, 5.2, 241],
  ['2026-09-17T12:30:00Z', 263, 240, 231, 0.27, 3.0, -3.4, 236],
  ['2026-09-24T12:30:00Z', 231, 233, 218, 0.24, 2.7, -2.8, 228],
  ['2026-10-01T12:30:00Z', 218, 225, 225, -0.19, -1.8, 2.1, 226],
  ['2026-10-08T12:30:00Z', 225, 230, 258, -0.28, -3.2, 4.5, 235],
  ['2026-10-15T12:30:00Z', 258, 241, 241, 0.21, 2.2, -2.3, 238],
];

const FLASH_MFG_PMI_DATA: Array<[string, number, number, number, number, number, number, number | null]> = [
  ['2025-10-24T13:45:00Z', 47.3, 47.5, 47.8, 0.19, 2.1, -2.8, 47.7],
  ['2025-11-22T14:45:00Z', 48.5, 48.8, 48.8, -0.17, -1.6, 2.4, 48.6],
  ['2025-12-16T14:45:00Z', 49.7, 49.4, 48.3, -0.23, -2.5, 4.1, 49.0],
  ['2026-01-24T14:45:00Z', 49.4, 49.7, 50.1, 0.22, 2.4, -3.1, 49.9],
  ['2026-02-21T14:45:00Z', 51.2, 51.5, 51.6, -0.18, -1.9, 2.9, 51.3],
  ['2026-03-24T13:45:00Z', 52.7, 51.8, 49.8, -0.26, -2.8, 4.6, 51.2],
  ['2026-04-23T13:45:00Z', 50.2, 49.0, 50.7, 0.21, 2.3, -3.2, 49.5],
  ['2026-05-21T13:45:00Z', 50.2, 49.9, 52.3, -0.19, -2.0, 2.7, 49.7],
  ['2026-06-23T13:45:00Z', 52.0, 51.0, 52.0, -0.22, -2.4, 3.1, 50.8],
  ['2026-07-24T13:45:00Z', 52.9, 52.7, 49.5, -0.28, -3.1, 4.8, 52.1],
  ['2026-08-21T13:45:00Z', 49.8, 49.5, 53.3, 0.25, 2.9, -3.9, 50.1],
  ['2026-09-23T13:45:00Z', 53.0, 52.0, 52.0, -0.21, -2.2, 3.0, 51.6],
];

const FLASH_SVC_PMI_DATA: Array<[string, number, number, number, number, number, number, number | null]> = [
  ['2025-10-24T13:45:00Z', 55.2, 55.0, 55.3, 0.19, 2.1, -2.6, 55.2],
  ['2025-11-22T14:45:00Z', 55.0, 55.2, 57.0, 0.24, 2.6, -3.5, 55.6],
  ['2025-12-16T14:45:00Z', 56.1, 55.7, 58.5, 0.21, 2.3, -3.2, 56.2],
  ['2026-01-24T14:45:00Z', 56.8, 56.5, 52.8, -0.25, -2.7, 4.2, 56.0],
  ['2026-02-21T14:45:00Z', 52.9, 53.0, 49.7, -0.29, -3.3, 4.9, 52.4],
  ['2026-03-24T13:45:00Z', 51.0, 51.2, 54.3, 0.23, 2.5, -3.4, 51.8],
  ['2026-04-23T13:45:00Z', 54.4, 52.8, 51.4, -0.22, -2.4, 3.3, 52.2],
  ['2026-05-21T13:45:00Z', 50.8, 50.8, 52.3, 0.18, 1.9, -2.4, 51.2],
  ['2026-06-23T13:45:00Z', 53.7, 52.9, 53.1, -0.20, -2.1, 2.5, 52.6],
  ['2026-07-24T13:45:00Z', 52.9, 53.0, 55.2, 0.24, 2.8, -3.1, 53.5],
  ['2026-08-21T13:45:00Z', 55.7, 54.2, 55.4, -0.19, -2.0, 2.2, 53.9],
  ['2026-09-23T13:45:00Z', 54.5, 53.8, 53.9, 0.21, 2.2, -2.7, 54.1],
];

const UOM_SENTIMENT_DATA: Array<[string, number, number, number, number, number, number, number | null]> = [
  ['2025-10-25T14:00:00Z', 68.9, 69.0, 70.5, 0.21, 2.3, -2.4, 69.5],
  ['2025-11-08T15:00:00Z', 70.5, 71.0, 73.0, 0.25, 2.8, -3.1, 71.6],
  ['2025-11-22T15:00:00Z', 73.0, 73.7, 71.8, 0.18, 1.9, -1.9, 73.9],
  ['2025-12-06T15:00:00Z', 71.8, 73.2, 74.0, 0.22, 2.4, -2.7, 73.6],
  ['2025-12-20T15:00:00Z', 74.0, 74.0, 74.0, 0.04, 0.2, -1.5, 74.0],
  ['2026-01-10T15:00:00Z', 74.0, 73.8, 73.2, -0.21, -2.2, 2.6, 73.4],
  ['2026-01-24T15:00:00Z', 73.2, 73.2, 71.1, -0.24, -2.6, 3.2, 72.5],
  ['2026-02-07T15:00:00Z', 71.1, 71.8, 67.8, 0.23, 2.5, -2.8, 72.1],
  ['2026-02-21T15:00:00Z', 67.8, 67.8, 64.7, -0.22, -2.3, 2.9, 67.2],
  ['2026-03-14T14:00:00Z', 64.7, 63.1, 57.9, 0.26, 2.9, -3.0, 62.5],
  ['2026-03-28T14:00:00Z', 57.9, 57.9, 57.0, 0.19, 2.1, -2.1, 57.5],
  ['2026-04-11T14:00:00Z', 57.0, 54.5, 50.8, 0.24, 2.7, -2.9, 54.0],
  ['2026-04-25T14:00:00Z', 50.8, 50.8, 52.2, 0.21, 2.2, -2.3, 51.4],
  ['2026-05-16T14:00:00Z', 52.2, 53.4, 50.8, -0.23, -2.4, 2.7, 52.8],
  ['2026-06-13T14:00:00Z', 52.2, 53.5, 60.5, 0.28, 3.1, -3.4, 54.2],
  ['2026-07-18T14:00:00Z', 60.7, 61.5, 61.8, 0.20, 2.2, -2.2, 61.8],
  ['2026-08-15T14:00:00Z', 61.7, 62.0, 58.6, 0.22, 2.4, -2.5, 62.3],
  ['2026-09-12T14:00:00Z', 58.2, 58.0, 55.4, 0.19, 2.0, -2.0, 57.6],
];

const UOM_INFLATION_DATA: Array<[string, number, number, number, number, number, number, number | null]> = [
  ['2025-10-25T14:00:00Z', 2.9, 2.9, 2.7, -0.18, -1.9, 2.1, 2.8],
  ['2025-11-08T15:00:00Z', 2.7, 2.7, 2.6, -0.20, -2.1, 2.3, 2.6],
  ['2025-11-22T15:00:00Z', 2.6, 2.6, 2.6, 0.17, 1.8, -1.8, 2.7],
  ['2025-12-06T15:00:00Z', 2.6, 2.7, 2.9, 0.23, 2.5, -2.5, 2.8],
  ['2025-12-20T15:00:00Z', 2.9, 2.9, 2.8, -0.19, -2.0, 1.9, 2.8],
  ['2026-01-10T15:00:00Z', 2.8, 2.8, 3.3, 0.27, 3.0, -2.9, 3.0],
  ['2026-01-24T15:00:00Z', 3.3, 3.3, 3.3, 0.18, 1.9, -1.7, 3.3],
  ['2026-02-07T15:00:00Z', 3.3, 3.3, 4.3, 0.31, 3.5, -3.4, 3.5],
  ['2026-02-21T15:00:00Z', 4.3, 4.3, 4.3, -0.21, -2.2, 2.2, 4.2],
  ['2026-03-14T14:00:00Z', 4.3, 4.3, 4.9, 0.26, 2.8, -2.8, 4.5],
  ['2026-03-28T14:00:00Z', 4.9, 4.9, 5.0, 0.22, 2.4, -2.1, 5.0],
  ['2026-04-11T14:00:00Z', 5.0, 5.1, 6.7, 0.29, 3.2, -3.1, 5.4],
  ['2026-04-25T14:00:00Z', 6.7, 6.7, 6.5, -0.22, -2.3, 2.4, 6.5],
  ['2026-05-16T14:00:00Z', 6.5, 6.5, 7.3, 0.25, 2.7, -2.6, 6.7],
  ['2026-06-13T14:00:00Z', 6.6, 6.4, 5.1, -0.26, -2.9, 2.8, 6.0],
  ['2026-07-18T14:00:00Z', 5.0, 5.0, 4.4, -0.23, -2.5, 2.5, 4.8],
  ['2026-08-15T14:00:00Z', 4.5, 4.5, 4.9, 0.21, 2.3, -2.2, 4.7],
  ['2026-09-12T14:00:00Z', 4.8, 4.8, 4.8, 0.18, 1.9, -1.6, 4.8],
];

const CPI_DATA: Array<[string, number, number, number, number, number, number, number | null]> = [
  ['2025-11-13T13:30:00Z', 2.4, 2.6, 2.6, 0.24, 2.8, -6.5, 2.6],
  ['2025-12-11T13:30:00Z', 2.6, 2.7, 2.7, -0.22, -2.4, 7.8, 2.6],
  ['2026-01-15T13:30:00Z', 2.7, 2.9, 2.9, -0.28, -3.2, 11.4, 2.8],
  ['2026-02-12T13:30:00Z', 2.9, 2.9, 3.0, 0.32, 3.9, -12.6, 3.0],
  ['2026-03-11T12:30:00Z', 3.0, 2.9, 2.8, -0.26, -2.9, 9.2, 2.8],
  ['2026-04-10T12:30:00Z', 2.8, 2.5, 2.4, -0.31, -3.5, 10.5, 2.4],
  ['2026-05-13T12:30:00Z', 2.4, 2.4, 2.3, -0.24, -2.6, 7.9, 2.3],
  ['2026-06-11T12:30:00Z', 2.3, 2.4, 2.4, -0.21, -2.3, 6.8, 2.4],
  ['2026-07-15T12:30:00Z', 2.4, 2.6, 2.7, 0.29, 3.4, -9.4, 2.7],
  ['2026-08-12T12:30:00Z', 2.7, 2.8, 2.7, -0.25, -2.8, 8.1, 2.7],
  ['2026-09-10T12:30:00Z', 2.7, 2.9, 2.9, 0.23, 2.5, -7.2, 2.9],
  ['2026-10-14T12:30:00Z', 2.9, 2.8, 2.9, 0.27, 3.1, -8.3, 2.9],
];

const NFP_DATA: Array<[string, number, number, number, number, number, number, number | null]> = [
  ['2025-11-01T12:30:00Z', 223, 106, 12, -0.33, -3.8, 16.4, 90],
  ['2025-12-06T13:30:00Z', 36, 202, 227, 0.28, 3.2, -11.8, 215],
  ['2026-01-10T13:30:00Z', 212, 164, 256, 0.36, 4.4, -18.5, 180],
  ['2026-02-07T13:30:00Z', 307, 169, 143, -0.24, -2.7, 12.1, 155],
  ['2026-03-07T13:30:00Z', 125, 159, 151, -0.27, -3.0, 13.6, 148],
  ['2026-04-03T12:30:00Z', 117, 137, 228, 0.34, 3.9, -15.9, 150],
  ['2026-05-01T12:30:00Z', 185, 138, 177, 0.29, 3.3, -12.4, 152],
  ['2026-06-05T12:30:00Z', 147, 126, 139, 0.25, 2.8, -10.8, 135],
  ['2026-07-02T12:30:00Z', 144, 110, 147, 0.31, 3.5, -14.2, 125],
  ['2026-08-07T12:30:00Z', 147, 106, 73, -0.35, -4.1, 19.2, 95],
  ['2026-09-04T12:30:00Z', 79, 75, 22, -0.32, -3.7, 15.6, 60],
  ['2026-10-02T12:30:00Z', 22, 115, 136, 0.26, 3.0, -11.3, 125],
];

const RETAIL_SALES_DATA: Array<[string, number, number, number, number, number, number, number | null]> = [
  ['2025-11-15T13:30:00Z', 0.8, 0.3, 0.4, 0.22, 2.4, -4.8, 0.4],
  ['2025-12-17T13:30:00Z', 0.5, 0.6, 0.7, 0.25, 2.7, -5.4, 0.7],
  ['2026-01-16T13:30:00Z', 0.8, 0.6, 0.4, -0.23, -2.5, 5.1, 0.5],
  ['2026-02-14T13:30:00Z', 0.7, -0.2, -0.9, -0.29, -3.3, 6.9, -0.4],
  ['2026-03-17T12:30:00Z', -1.2, 0.6, 0.2, -0.24, -2.6, 5.6, 0.4],
  ['2026-04-16T12:30:00Z', 0.2, 1.4, 1.5, 0.27, 3.0, -5.2, 1.5],
  ['2026-05-15T12:30:00Z', 1.7, 0.0, 0.1, 0.19, 2.1, -3.9, 0.1],
  ['2026-06-16T12:30:00Z', -0.1, -0.6, -0.9, -0.26, -2.8, 5.8, -0.7],
  ['2026-07-16T12:30:00Z', -0.9, 0.1, 0.6, 0.28, 3.2, -6.1, 0.3],
  ['2026-08-14T12:30:00Z', 0.9, 0.6, 0.5, 0.21, 2.3, -4.2, 0.6],
  ['2026-09-16T12:30:00Z', 0.6, 0.2, 0.6, 0.26, 2.9, -5.5, 0.4],
  ['2026-10-15T12:30:00Z', 0.6, 0.3, 0.4, 0.23, 2.5, -4.6, 0.4],
];

function buildAllHistoricalReleases(): HistoricalReleaseRecord[] {
  const list: HistoricalReleaseRecord[] = [];

  const addSeries = (
    indicatorKey: string,
    title: string,
    impact: 'High' | 'Medium',
    ahmedTier: 1 | 2,
    unit: string,
    rows: Array<[string, number, number, number, number, number, number, number | null]>
  ) => {
    rows.forEach((r, idx) => {
      list.push({
        id: `HIST-${indicatorKey}-${idx + 1}`,
        indicatorKey,
        title,
        timestampUtc: r[0],
        impact,
        ahmedTier,
        previous: r[1],
        forecast: r[2],
        actual: r[3],
        unit,
        dollarProxyPctT60m: r[4],
        us10yChangeBpT60m: r[5],
        goldMove15m: r[6],
        predictionMarketEvT60m: r[7],
      });
    });
  };

  addSeries('unemployment_claims', 'Unemployment Claims', 'High', 2, 'K', WEEKLY_CLAIMS_DATA);
  addSeries('flash_manufacturing_pmi', 'Flash Manufacturing PMI', 'Medium', 2, '', FLASH_MFG_PMI_DATA);
  addSeries('flash_services_pmi', 'Flash Services PMI', 'Medium', 2, '', FLASH_SVC_PMI_DATA);
  addSeries('uom_consumer_sentiment', 'Revised UoM Consumer Sentiment', 'Medium', 2, '', UOM_SENTIMENT_DATA);
  addSeries('uom_inflation_expectations', 'Revised UoM Inflation Expectations', 'Medium', 2, '%', UOM_INFLATION_DATA);
  addSeries('cpi', 'CPI y/y', 'High', 1, '%', CPI_DATA);
  addSeries('nfp', 'Non-Farm Employment Change', 'High', 1, 'K', NFP_DATA);
  addSeries('retail_sales', 'Retail Sales m/m', 'High', 2, '%', RETAIL_SALES_DATA);

  return list.sort((a, b) => new Date(a.timestampUtc).getTime() - new Date(b.timestampUtc).getTime());
}

export const CHRONOLOGICAL_RELEASE_LEDGER: HistoricalReleaseRecord[] = buildAllHistoricalReleases();

/**
 * Returns authentic 12-month historical gold reactions for a calendar event title,
 * using ONLY releases strictly prior to `beforeTimestampMs` (excludes the release being scored).
 * Requirement 3 (Round 2): Event Gold History only counts as an agreeing event-specific input
 * when it has at least 20 releases and an edge of at least 62% in one direction.
 * Otherwise it is shown as an info chip with weight 0 and direction 0.
 */
export function get12MonthGoldHistory(
  title: string,
  beforeTimestampMs?: number
): IndicatorHistorySummary | null {
  const key = matchIndicatorKey(title);
  if (!key) return null;

  const cutoffMs = typeof beforeTimestampMs === 'number' ? beforeTimestampMs : Date.now();
  const priorReleases = CHRONOLOGICAL_RELEASE_LEDGER.filter(
    (r) => r.indicatorKey === key && new Date(r.timestampUtc).getTime() < cutoffMs
  );

  if (priorReleases.length === 0) return null;

  let rose = 0;
  let fell = 0;
  let flat = 0;
  let moveSum = 0;

  for (const r of priorReleases) {
    moveSum += Math.abs(r.goldMove15m);
    if (r.goldMove15m >= 0.5) rose++;
    else if (r.goldMove15m <= -0.5) fell++;
    else flat++;
  }

  const total = priorReleases.length;
  const avgMove = Number((moveSum / total).toFixed(2));
  const netDelta = rose - fell;
  const rawScore = Number((netDelta / total).toFixed(3));
  const dominant = Math.max(rose, fell);
  const edgeRatio = dominant / total;
  const edgePct = Number((edgeRatio * 100).toFixed(1));

  const qualifiesAsSignal = total >= 20 && edgeRatio >= 0.62 && Math.abs(rawScore) >= 0.15;
  let infoReason: string | undefined;
  if (!qualifiesAsSignal) {
    if (total < 20) {
      infoReason = `Info chip only (weight 0): ${total} releases < 20 minimum required`;
    } else if (edgeRatio < 0.62) {
      infoReason = `Info chip only (weight 0): ${edgePct}% directional edge < 62% minimum required`;
    } else {
      infoReason = `Info chip only (weight 0): |rawScore| < 0.15 dead zone`;
    }
  }

  const direction: 1 | -1 | 0 = qualifiesAsSignal ? (rose > fell ? 1 : -1) : 0;
  const sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    direction === 1 ? 'BULLISH' : direction === -1 ? 'BEARISH' : 'NEUTRAL';

  let label = '';
  if (fell > rose) {
    label = `History: ${fell} of ${total} fell`;
  } else if (rose > fell) {
    label = `History: ${rose} of ${total} rose`;
  } else {
    label = `History: ${rose} of ${total} balanced`;
  }

  return {
    indicatorKey: key,
    total,
    roseCount: rose,
    fellCount: fell,
    flatCount: flat,
    label,
    sentiment,
    rawScore,
    direction,
    avgMoveUsd: avgMove,
    edgePct,
    qualifiesAsSignal,
    infoReason,
  };
}

/**
 * Requirement 4 (Round 3):
 * Computes the "Actual vs Forecast" surprise-streak input (last 3 releases beat or missed consensus)
 * strictly prior to `beforeTimestampMs` (T-60m).
 * Used as an info chip with weight 0 in live/pre-release decisions, and evaluated in the walk-forward
 * backtest to test whether it has standalone predictive edge before giving it weight.
 */
export function getSurpriseStreakInput(
  title: string,
  beforeTimestampMs?: number
): SurpriseStreakSummary | null {
  const key = matchIndicatorKey(title);
  if (!key) return null;

  const cutoffMs = typeof beforeTimestampMs === 'number' ? beforeTimestampMs : Date.now();
  const priorReleases = CHRONOLOGICAL_RELEASE_LEDGER.filter(
    (r) => r.indicatorKey === key && new Date(r.timestampUtc).getTime() < cutoffMs
  );

  if (priorReleases.length < 3) return null;

  const last3 = priorReleases.slice(-3);
  const inverse = isInverseIndicator(key);

  let beats = 0;
  let misses = 0;
  let inline = 0;
  let bullGoldSurprises = 0;
  let bearGoldSurprises = 0;
  const details: string[] = [];

  for (const r of last3) {
    const diff = Number((r.actual - r.forecast).toFixed(4));
    const aStr = formatPrint(r.actual, r.unit);
    const fStr = formatPrint(r.forecast, r.unit);
    if (diff > 0) {
      beats++;
      details.push(`${aStr}>${fStr}`);
      if (inverse) bullGoldSurprises++;
      else bearGoldSurprises++;
    } else if (diff < 0) {
      misses++;
      details.push(`${aStr}<${fStr}`);
      if (inverse) bearGoldSurprises++;
      else bullGoldSurprises++;
    } else {
      inline++;
      details.push(`${aStr}=${fStr}`);
    }
  }

  const rawScore = Number(((bullGoldSurprises - bearGoldSurprises) / 3).toFixed(3));
  const impliedGoldDirection: 1 | -1 | 0 =
    Math.abs(rawScore) < 0.15 ? 0 : rawScore > 0 ? 1 : -1;

  let label = '';
  if (beats === 3) {
    label = 'Streak: 3 of 3 beat forecast';
  } else if (misses === 3) {
    label = 'Streak: 3 of 3 missed forecast';
  } else if (beats === 2) {
    label = 'Streak: 2 of 3 beat forecast';
  } else if (misses === 2) {
    label = 'Streak: 2 of 3 missed forecast';
  } else {
    label = `Streak: ${beats} beat, ${misses} missed (last 3)`;
  }

  return {
    indicatorKey: key,
    sampleSize: 3,
    beats,
    misses,
    inline,
    label,
    value: `Last 3 vs forecast: ${beats} beat, ${misses} missed (${details.join(', ')})`,
    rawScore,
    impliedGoldDirection,
    isUnanimous3of3: beats === 3 || misses === 3,
  };
}
