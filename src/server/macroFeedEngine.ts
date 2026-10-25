import fs from 'fs';
import path from 'path';
import { DATA_DIR, writeJsonAtomic } from './deploymentSafety.ts';
import { getCandleStore } from './candleEngine.ts';
import { getLastValidTick } from './marketPriceEngine.ts';

const MACRO_CACHE_FILE = path.resolve(DATA_DIR, 'macro_live_cache.json');

export interface UsdPairQuote {
  symbol: 'EURUSD' | 'USDJPY' | 'GBPUSD' | 'DXY';
  bid: number;
  ask: number;
  mid: number;
  high: number;
  low: number;
  dayDiffPercent: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  quoteAgeSeconds: number;
  stale: boolean;
  lastUpdated: number;
}

export interface DollarStrengthProxy {
  compositeChangePct: number; // positive = USD stronger, negative = USD weaker
  goldScore: number; // -1..+1 (positive = bullish for gold / weaker USD)
  goldDirection: 1 | -1 | 0;
  pairsUsed: string[];
  eurusd?: UsdPairQuote;
  usdjpy?: UsdPairQuote;
  gbpusd?: UsdPairQuote;
  dxy?: UsdPairQuote;
  lastUpdated: number;
  ageMs: number;
  isStale: boolean;
}

export interface Us10yLiveQuote {
  yield: number;
  change: number;
  changeBp: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  source: 'FRED+CNBC' | 'CNBC_LIVE' | 'YAHOO_TNX' | 'FRED';
  lastUpdated: number;
  ageMs: number;
  isStale: boolean;
}

export interface GoldLiveTrend {
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  pivot: number;
  h4Open: number;
  h4Close: number;
  h4ChangePct: number;
  h4Ema10: number;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  rawScore: number; // -1..+1
  direction: 1 | -1 | 0;
  keyLevelsText: string;
  lastUpdated: number;
  ageMs: number;
  isStale: boolean;
}

export type PredictionMarketImplied = DiscoveredPredictionMarket;

export interface RawPredictionContractPrice {
  venue: 'Kalshi' | 'Polymarket';
  tickerOrId: string;
  title: string;
  bucket: 'HOLD' | 'CUT' | 'HIKE';
  yesBid?: number;
  yesAsk?: number;
  rawPrice: number; // 0..1
  rawPct: number;   // 0..100
}

export interface PredictionMarketMappingRow {
  indicator: string;
  releaseMonth: string; // YYYY-MM or 'UNKNOWN'
  kalshiTicker: string | null;
  polymarketSlug: string | null;
  matchedStatus: string;
}

export interface DiscoveredPredictionMarket {
  category: 'CPI_MOM' | 'CORE_CPI_MOM' | 'CPI_YOY' | 'CORE_CPI_YOY' | 'NFP' | 'UNEMPLOYMENT' | 'FED_RATE';
  releaseMonth?: string;
  kalshiSeriesTicker?: string;
  kalshiEventTicker?: string;
  kalshiReleaseMonth?: string;
  kalshiImpliedEv?: number | null;
  kalshiNetCutBps?: number | null;
  kalshiSampleTitle?: string;
  polymarketSlug?: string | null;
  polymarketTitle?: string | null;
  polymarketReleaseMonth?: string | null;
  polymarketImpliedEv?: number | null;
  polymarketNetCutBps?: number | null;
  combinedImpliedEv?: number | null;
  combinedNetCutBps?: number | null;
  holdProb?: number;
  cutProb?: number;
  hikeProb?: number;
  rawHoldPct?: number;
  rawCutPct?: number;
  rawHikePct?: number;
  rawProbSumPct?: number;
  rawContracts?: RawPredictionContractPrice[];
  summaryLabel: string;
  lastUpdated: number;
}

export interface LiveMacroData {
  dxy: {
    price: number;
    change: number;
    changePct: number;
    direction: 'UP' | 'DOWN' | 'FLAT';
    lastUpdated: number;
    isStale?: boolean;
  } | null;
  dollarProxy: DollarStrengthProxy | null;
  us10y: Us10yLiveQuote | null;
  gold4h: {
    open: number;
    close: number;
    high: number;
    low: number;
    changePct: number;
    bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  } | null;
  goldTrend: GoldLiveTrend | null;
  predictionMarket: {
    question: string;
    holdProb?: number;
    cutProb?: number;
    hikeProb?: number;
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    label: string;
  } | null;
  discoveredMarkets: Record<string, DiscoveredPredictionMarket>;
  predictionMarketMappingTable?: PredictionMarketMappingRow[];
  timestamp: number;
}

const LIVE_STALE_MS = 60_000; // Strict 60s freshness limit for live inputs
const MACRO_POLL_INTERVAL_MS = 20_000; // Refresh FX & US10Y every 20s so age is always <60s
const PREDICTION_CACHE_TTL_MS = 180_000; // Refresh Kalshi & Polymarket every 3m

let cachedMacro: LiveMacroData = {
  dxy: null,
  dollarProxy: null,
  us10y: null,
  gold4h: null,
  goldTrend: null,
  predictionMarket: null,
  discoveredMarkets: {},
  predictionMarketMappingTable: [],
  timestamp: 0,
};

try {
  if (fs.existsSync(MACRO_CACHE_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(MACRO_CACHE_FILE, 'utf-8'));
    if (parsed && typeof parsed === 'object') {
      cachedMacro = { ...cachedMacro, ...parsed };
    }
  }
} catch {}

let isFetchingLiveMacro = false;
let isFetchingPredictions = false;
let lastPredictionFetchAt = 0;
let hasLoggedVerification = false;
let backgroundTimerStarted = false;

const MONTH_ABBR_TO_NUM: Record<string, string> = {
  JAN: '01', JANUARY: '01',
  FEB: '02', FEBRUARY: '02',
  MAR: '03', MARCH: '03',
  APR: '04', APRIL: '04',
  MAY: '05',
  JUN: '06', JUNE: '06',
  JUL: '07', JULY: '07',
  AUG: '08', AUGUST: '08',
  SEP: '09', SEPT: '09', SEPTEMBER: '09',
  OCT: '10', OCTOBER: '10',
  NOV: '11', NOVEMBER: '11',
  DEC: '12', DECEMBER: '12',
};

/**
 * Extracts canonical YYYY-MM release/reference month from Kalshi event_ticker (e.g. "KXCPIYOY-26NOV" -> "2026-11")
 * or from text/slug (e.g. "core-cpi-yoy-october-2026" -> "2026-10").
 */
export function extractReleaseMonth(tickerOrText: string | undefined | null): string {
  if (!tickerOrText) return 'UNKNOWN';
  const upper = tickerOrText.toUpperCase();

  // Pattern 1: Kalshi ticker suffix like -26NOV or -26OCT15 or -25DEC
  const kalshiMatch = upper.match(/-(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/);
  if (kalshiMatch) {
    const yr = `20${kalshiMatch[1]}`;
    const mo = MONTH_ABBR_TO_NUM[kalshiMatch[2]];
    if (mo) return `${yr}-${mo}`;
  }

  // Pattern 2: Full or abbreviated month name + 4-digit year in title/slug (e.g., "october-2026" or "November 2026")
  const textMatch = upper.match(
    /\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|SEPT|OCTOBER|NOVEMBER|DECEMBER|JAN|FEB|MAR|APR|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[\s\-_/,]+(20\d{2})\b/
  );
  if (textMatch) {
    const mo = MONTH_ABBR_TO_NUM[textMatch[1]];
    const yr = textMatch[2];
    if (mo && yr) return `${yr}-${mo}`;
  }

  // Pattern 3: month name without year -> infer year from current UTC date if present
  const monthOnlyMatch = upper.match(
    /\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\b/
  );
  if (monthOnlyMatch) {
    const mo = MONTH_ABBR_TO_NUM[monthOnlyMatch[1]];
    if (mo) {
      const currentYear = new Date().getUTCFullYear();
      return `${currentYear}-${mo}`;
    }
  }

  return 'UNKNOWN';
}

/**
 * Strictly classifies a Polymarket event title/slug into the exact indicator category.
 * Headline vs Core and MoM vs YoY must NEVER be mixed.
 */
export function classifyPolymarketIndicator(
  title: string,
  slug: string
): DiscoveredPredictionMarket['category'] | null {
  const combined = `${title} ${slug}`.toLowerCase();
  if (combined.includes('japan') || combined.includes('uk') || combined.includes('euro') || combined.includes('canada')) {
    return null;
  }

  if (combined.includes('fed decision') || combined.includes('fomc') || combined.includes('federal reserve interest rate')) {
    return 'FED_RATE';
  }

  const isCore = combined.includes('core');
  const isYoy = combined.includes('yoy') || combined.includes('y/y') || combined.includes('year-over-year') || combined.includes('annual');
  const isMom = combined.includes('mom') || combined.includes('m/m') || combined.includes('month-over-month') || combined.includes('monthly');

  if (combined.includes('cpi') || combined.includes('inflation')) {
    if (isCore && isYoy) return 'CORE_CPI_YOY';
    if (isCore && isMom) return 'CORE_CPI_MOM';
    if (!isCore && isYoy) return 'CPI_YOY';
    if (!isCore && isMom) return 'CPI_MOM';
    return null;
  }

  if (combined.includes('unemployment rate') || combined.includes('u-3') || combined.includes('u3')) {
    return 'UNEMPLOYMENT';
  }

  if (combined.includes('nonfarm') || combined.includes('non-farm') || combined.includes('payrolls') || combined.includes('jobs added')) {
    return 'NFP';
  }

  return null;
}

/**
 * Normalizes 3 mutually exclusive probabilities (hold, cut, hike in 0..100 scale)
 * so that their integer percentages sum to 100%.
 */
export function normalizeThreeWayProbabilities(
  rawHoldPct: number,
  rawCutPct: number,
  rawHikePct: number
): { holdProb: number; cutProb: number; hikeProb: number; rawSumPct: number } {
  const rawSumPct = Number((rawHoldPct + rawCutPct + rawHikePct).toFixed(2));
  if (rawSumPct <= 0) {
    return { holdProb: 0, cutProb: 0, hikeProb: 0, rawSumPct: 0 };
  }
  const scaledHold = (rawHoldPct / rawSumPct) * 100;
  const scaledCut = (rawCutPct / rawSumPct) * 100;
  const scaledHike = (rawHikePct / rawSumPct) * 100;

  let holdProb = Math.round(scaledHold);
  let cutProb = Math.round(scaledCut);
  let hikeProb = Math.round(scaledHike);

  const diff = 100 - (holdProb + cutProb + hikeProb);
  if (diff !== 0) {
    // Adjust the largest probability component so holdProb + cutProb + hikeProb === 100
    if (holdProb >= cutProb && holdProb >= hikeProb) {
      holdProb += diff;
    } else if (cutProb >= holdProb && cutProb >= hikeProb) {
      cutProb += diff;
    } else {
      hikeProb += diff;
    }
  }

  return { holdProb, cutProb, hikeProb, rawSumPct };
}

export interface RawKalshiStrikeEntry {
  ticker: string;
  strike: number;
  yes_bid: number;
  yes_ask: number;
}

export interface KalshiBucketRow {
  rangeLabel: string;
  midpoint: number;
  prob: number;
  weightedContribution: number;
}

export interface KalshiBucketEvCalculation {
  accepted: boolean;
  ev: number | null;
  strikesCount: number;
  isMonotonic: boolean;
  dropReason?: string;
  buckets: KalshiBucketRow[];
  probSum: number;
  rawJsonSample?: RawKalshiStrikeEntry[];
}

export const KXCPI_26OCT_RECORDED_SAMPLE: RawKalshiStrikeEntry[] = [
  { ticker: 'KXCPI-26OCT-2.6', strike: 2.6, yes_bid: 0.92, yes_ask: 0.94 },
  { ticker: 'KXCPI-26OCT-2.8', strike: 2.8, yes_bid: 0.70, yes_ask: 0.74 },
  { ticker: 'KXCPI-26OCT-3.0', strike: 3.0, yes_bid: 0.44, yes_ask: 0.48 },
  { ticker: 'KXCPI-26OCT-3.2', strike: 3.2, yes_bid: 0.22, yes_ask: 0.26 },
  { ticker: 'KXCPI-26OCT-3.4', strike: 3.4, yes_bid: 0.06, yes_ask: 0.10 },
];

/**
 * Round 15 Item 4: Kalshi EV Bucket Calculation
 * "above X" contracts have cumulative yes prices that must not increase with strike.
 * P(>x_i) >= P(>x_{i+1}).
 * Bucket probabilities: P(>x_i) - P(>x_{i+1}) with both left & right tails.
 * Ladder must have >= 5 strikes and non-increasing prices, otherwise drop input (ev: null).
 */
export function computeKalshiBucketLadderEv(
  strikesInput: RawKalshiStrikeEntry[] | any[]
): KalshiBucketEvCalculation {
  if (!Array.isArray(strikesInput) || strikesInput.length === 0) {
    return {
      accepted: false,
      ev: null,
      strikesCount: 0,
      isMonotonic: false,
      dropReason: 'Empty ladder input',
      buckets: [],
      probSum: 0,
    };
  }

  const parsed = strikesInput
    .map((item) => {
      const strike =
        typeof item.strike === 'number'
          ? item.strike
          : typeof item.floor_strike === 'number'
          ? item.floor_strike
          : parseFloat(item.strike ?? item.floor_strike ?? 'NaN');
      const bid =
        typeof item.yes_bid === 'number'
          ? item.yes_bid
          : parseFloat(item.yes_bid_dollars ?? item.yes_bid ?? '0');
      const ask =
        typeof item.yes_ask === 'number'
          ? item.yes_ask
          : parseFloat(item.yes_ask_dollars ?? item.yes_ask ?? '0');
      const ticker = String(item.ticker || item.event_ticker || '');
      let prob = 0;
      if (bid > 0 && ask > 0) {
        prob = (bid + ask) / 2;
      } else if (item.yes_price !== undefined) {
        prob = Number(item.yes_price);
      } else if (item.last_price_dollars) {
        prob = parseFloat(item.last_price_dollars);
      } else {
        prob = Math.max(bid, ask);
      }
      return {
        ticker,
        strike,
        yes_bid: bid,
        yes_ask: ask,
        prob: Math.max(0, Math.min(1, prob)),
      };
    })
    .filter((p) => Number.isFinite(p.strike))
    .sort((a, b) => a.strike - b.strike);

  // Assertion 1: Ladder must have at least 5 strikes
  if (parsed.length < 5) {
    return {
      accepted: false,
      ev: null,
      strikesCount: parsed.length,
      isMonotonic: true,
      dropReason: `Fewer than 5 strikes on ladder (${parsed.length} < 5): input dropped.`,
      buckets: [],
      probSum: 0,
      rawJsonSample: parsed.map((p) => ({
        ticker: p.ticker,
        strike: p.strike,
        yes_bid: p.yes_bid,
        yes_ask: p.yes_ask,
      })),
    };
  }

  // Assertion 2: "above X" contracts have cumulative yes prices that must not increase with strike
  for (let i = 0; i < parsed.length - 1; i++) {
    if (parsed[i + 1].prob > parsed[i].prob + 0.0001) {
      return {
        accepted: false,
        ev: null,
        strikesCount: parsed.length,
        isMonotonic: false,
        dropReason: `Price monotonicity violated at strike ${parsed[i].strike} (${parsed[i].prob}) -> ${parsed[i + 1].strike} (${parsed[i + 1].prob}): cumulative yes prices must be non-increasing. Input dropped.`,
        buckets: [],
        probSum: 0,
        rawJsonSample: parsed.map((p) => ({
          ticker: p.ticker,
          strike: p.strike,
          yes_bid: p.yes_bid,
          yes_ask: p.yes_ask,
        })),
      };
    }
  }

  // Compute bucket probabilities as P(>x_i) - P(>x_{i+1}) with both tails:
  const n = parsed.length;
  const leftStep = parsed[1].strike - parsed[0].strike;
  const rightStep = parsed[n - 1].strike - parsed[n - 2].strike;
  const buckets: KalshiBucketRow[] = [];

  // Left tail: X <= x_0. Probability = 1 - P(>x_0)
  const leftProb = Number((1 - parsed[0].prob).toFixed(4));
  const leftMidpoint = Number((parsed[0].strike - leftStep / 2).toFixed(4));
  buckets.push({
    rangeLabel: `X <= ${parsed[0].strike}`,
    midpoint: leftMidpoint,
    prob: leftProb,
    weightedContribution: Number((leftMidpoint * leftProb).toFixed(4)),
  });

  // Interior buckets: x_i < X <= x_{i+1}. Probability = P(>x_i) - P(>x_{i+1})
  for (let i = 0; i < n - 1; i++) {
    const p1 = parsed[i].prob;
    const p2 = parsed[i + 1].prob;
    const bucketProb = Number((p1 - p2).toFixed(4));
    const midpoint = Number(((parsed[i].strike + parsed[i + 1].strike) / 2).toFixed(4));
    buckets.push({
      rangeLabel: `${parsed[i].strike} < X <= ${parsed[i + 1].strike}`,
      midpoint,
      prob: bucketProb,
      weightedContribution: Number((midpoint * bucketProb).toFixed(4)),
    });
  }

  // Right tail: X > x_{n-1}. Probability = P(>x_{n-1})
  const rightProb = Number(parsed[n - 1].prob.toFixed(4));
  const rightMidpoint = Number((parsed[n - 1].strike + rightStep / 2).toFixed(4));
  buckets.push({
    rangeLabel: `X > ${parsed[n - 1].strike}`,
    midpoint: rightMidpoint,
    prob: rightProb,
    weightedContribution: Number((rightMidpoint * rightProb).toFixed(4)),
  });

  const probSum = Number(buckets.reduce((acc, b) => acc + b.prob, 0).toFixed(4));
  const ev = Number(buckets.reduce((acc, b) => acc + b.weightedContribution, 0).toFixed(4));

  return {
    accepted: true,
    ev,
    strikesCount: n,
    isMonotonic: true,
    buckets,
    probSum,
    rawJsonSample: parsed.map((p) => ({
      ticker: p.ticker,
      strike: p.strike,
      yes_bid: p.yes_bid,
      yes_ask: p.yes_ask,
    })),
  };
}

export function computeKalshiStrikeLadderEv(
  markets: any[]
): { ev: number | null; eventTicker: string; sampleTitle: string; dropReason?: string } {
  if (!Array.isArray(markets) || markets.length === 0) {
    return { ev: null, eventTicker: '', sampleTitle: '' };
  }
  const sortedByClose = markets
    .filter((m) => m && m.close_time)
    .sort((a, b) => new Date(a.close_time).getTime() - new Date(b.close_time).getTime());
  if (sortedByClose.length === 0) return { ev: null, eventTicker: '', sampleTitle: '' };

  const nearestEvent = sortedByClose[0].event_ticker;
  const ladder = sortedByClose
    .filter((m) => m.event_ticker === nearestEvent && typeof m.floor_strike === 'number')
    .sort((a, b) => a.floor_strike - b.floor_strike);

  const bucketRes = computeKalshiBucketLadderEv(ladder);
  if (!bucketRes.accepted || bucketRes.ev === null) {
    return {
      ev: null,
      eventTicker: nearestEvent || '',
      sampleTitle: sortedByClose[0].title || '',
      dropReason: bucketRes.dropReason,
    };
  }

  return {
    ev: bucketRes.ev,
    eventTicker: nearestEvent,
    sampleTitle: ladder[0]?.title || sortedByClose[0]?.title || '',
  };
}

/**
 * Computes implied expected value from Polymarket bucket markets (e.g. "0.1%", "0.2%", "0.3%")
 */
function computePolymarketBucketEv(markets: any[]): number | null {
  if (!Array.isArray(markets) || markets.length === 0) return null;
  let weightedSum = 0;
  let probSum = 0;

  for (const m of markets) {
    const label = String(m.groupItemTitle || m.question || '');
    const match = label.match(/(-?\d+(?:\.\d+)?)/);
    if (!match) continue;
    const val = parseFloat(match[1]);
    if (isNaN(val)) continue;

    let yesProb = 0;
    try {
      const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
      yesProb = parseFloat(prices?.[0] ?? '0');
    } catch {
      yesProb = 0;
    }
    if (yesProb > 0) {
      weightedSum += val * yesProb;
      probSum += yesProb;
    }
  }

  if (probSum < 0.25) return null;
  return Number((weightedSum / probSum).toFixed(4));
}

/**
 * Discovers and caches Kalshi & Polymarket economic series/markets for CPI, Jobs, and Fed.
 * Enforces Round 9 Item 2 rules:
 * 1) FED_RATE probabilities are normalized to 100% and raw contract prices are stored.
 * 2) Polymarket markets are mapped to an indicator ONLY if the SAME indicator (headline vs core, MoM vs YoY)
 *    AND SAME release month (YYYY-MM) match; otherwise dropped.
 */
export async function discoverAndRefreshPredictionMarkets(force = false): Promise<Record<string, DiscoveredPredictionMarket>> {
  const now = Date.now();
  if (!force && lastPredictionFetchAt > 0 && now - lastPredictionFetchAt < PREDICTION_CACHE_TTL_MS) {
    return cachedMacro.discoveredMarkets;
  }
  if (isFetchingPredictions) return cachedMacro.discoveredMarkets;
  isFetchingPredictions = true;

  const kalshiBase = 'https://external-api.kalshi.com/trade-api/v2';
  const polyBase = 'https://gamma-api.polymarket.com';
  const discovered: Record<string, DiscoveredPredictionMarket> = {};
  const mappingTable: PredictionMarketMappingRow[] = [];

  try {
    // 1. Verify Kalshi /series/{ticker} and /markets?series_ticker=...&status=open
    const kalshiSeriesList: Array<{
      ticker: string;
      category: DiscoveredPredictionMarket['category'];
    }> = [
      { ticker: 'KXCPI', category: 'CPI_MOM' },
      { ticker: 'KXCPICORE', category: 'CORE_CPI_MOM' },
      { ticker: 'KXCPIYOY', category: 'CPI_YOY' },
      { ticker: 'KXPAYROLLS', category: 'NFP' },
      { ticker: 'KXU3', category: 'UNEMPLOYMENT' },
      { ticker: 'KXFEDDECISION', category: 'FED_RATE' },
    ];

    const kalshiResults = await Promise.allSettled(
      kalshiSeriesList.map(async (item) => {
        const [seriesRes, marketsRes] = await Promise.all([
          fetch(`${kalshiBase}/series/${item.ticker}`, {
            headers: { Accept: 'application/json', 'User-Agent': 'SARRAF-Terminal/1.0' },
            signal: AbortSignal.timeout(6000),
          }),
          fetch(`${kalshiBase}/markets?series_ticker=${item.ticker}&status=open&limit=100`, {
            headers: { Accept: 'application/json', 'User-Agent': 'SARRAF-Terminal/1.0' },
            signal: AbortSignal.timeout(6000),
          }),
        ]);
        const seriesJson = seriesRes.ok ? await seriesRes.json() : null;
        const marketsJson = marketsRes.ok ? await marketsRes.json() : null;
        return {
          ...item,
          seriesStatus: seriesRes.status,
          marketsStatus: marketsRes.status,
          seriesTitle: seriesJson?.series?.title || item.ticker,
          markets: marketsJson?.markets || [],
        };
      })
    );

    for (const res of kalshiResults) {
      if (res.status !== 'fulfilled') continue;
      const { ticker, category, seriesStatus, marketsStatus, seriesTitle, markets } = res.value;

      if (!hasLoggedVerification) {
        console.log(
          `[PREDICTION VERIFY] Kalshi GET /series/${ticker} (${seriesStatus}) & /markets?series_ticker=${ticker}&status=open (${marketsStatus}) -> ${markets.length} open markets (${seriesTitle})`
        );
      }

      if (category === 'FED_RATE') {
        const sorted = markets
          .filter((m: any) => m && m.close_time)
          .sort((a: any, b: any) => new Date(a.close_time).getTime() - new Date(b.close_time).getTime());
        const nearestEvent = sorted[0]?.event_ticker;
        const eventMarkets = sorted.filter((m: any) => m.event_ticker === nearestEvent);

        let rawHold = 0;
        let rawCut = 0;
        let rawHike = 0;
        let netCutBps = 0; // positive = dovish cut (bullish gold), negative = hawkish hike (bearish gold)
        const rawContracts: RawPredictionContractPrice[] = [];

        for (const m of eventMarkets) {
          const bid = parseFloat(m.yes_bid_dollars ?? m.last_price_dollars ?? '0');
          const ask = parseFloat(m.yes_ask_dollars ?? m.last_price_dollars ?? '0');
          const p = bid > 0 && ask > 0 ? (bid + ask) / 2 : parseFloat(m.last_price_dollars || '0');
          const sub = String(m.subtitle || m.title || '').toLowerCase();
          let bucket: 'HOLD' | 'CUT' | 'HIKE' | null = null;

          if (sub.includes('hike 0') || sub.includes('maintain') || sub.includes('no change')) {
            rawHold += p;
            bucket = 'HOLD';
          } else if (sub.includes('cut >25') || sub.includes('cut 50')) {
            rawCut += p;
            netCutBps += p * 50;
            bucket = 'CUT';
          } else if (sub.includes('cut 25')) {
            rawCut += p;
            netCutBps += p * 25;
            bucket = 'CUT';
          } else if (sub.includes('hike >25') || sub.includes('hike 50')) {
            rawHike += p;
            netCutBps -= p * 50;
            bucket = 'HIKE';
          } else if (sub.includes('hike 25')) {
            rawHike += p;
            netCutBps -= p * 25;
            bucket = 'HIKE';
          }

          if (bucket) {
            rawContracts.push({
              venue: 'Kalshi',
              tickerOrId: m.ticker || nearestEvent,
              title: String(m.subtitle || m.title || ''),
              bucket,
              yesBid: Number(bid.toFixed(4)),
              yesAsk: Number(ask.toFixed(4)),
              rawPrice: Number(p.toFixed(4)),
              rawPct: Number((p * 100).toFixed(2)),
            });
          }
        }

        if (eventMarkets.length > 0) {
          const rawHoldPct = Number((rawHold * 100).toFixed(2));
          const rawCutPct = Number((rawCut * 100).toFixed(2));
          const rawHikePct = Number((rawHike * 100).toFixed(2));
          const norm = normalizeThreeWayProbabilities(rawHoldPct, rawCutPct, rawHikePct);
          const kalshiMonth = extractReleaseMonth(nearestEvent) !== 'UNKNOWN'
            ? extractReleaseMonth(nearestEvent)
            : extractReleaseMonth(sorted[0]?.title);

          discovered.FED_RATE = {
            category: 'FED_RATE',
            releaseMonth: kalshiMonth,
            kalshiSeriesTicker: ticker,
            kalshiEventTicker: nearestEvent,
            kalshiReleaseMonth: kalshiMonth,
            kalshiNetCutBps: Number(netCutBps.toFixed(2)),
            combinedNetCutBps: Number(netCutBps.toFixed(2)),
            polymarketSlug: null,
            holdProb: norm.holdProb,
            cutProb: norm.cutProb,
            hikeProb: norm.hikeProb,
            rawHoldPct,
            rawCutPct,
            rawHikePct,
            rawProbSumPct: norm.rawSumPct,
            rawContracts,
            summaryLabel: `Kalshi ${nearestEvent}: ${norm.holdProb}% Hold, ${norm.cutProb}% Cut, ${norm.hikeProb}% Hike`,
            lastUpdated: now,
          };
        }
      } else {
        const { ev, eventTicker, sampleTitle } = computeKalshiStrikeLadderEv(markets);
        if (ev !== null) {
          const unit = category === 'NFP' ? '' : '%';
          const displayEv = category === 'NFP' ? `${Math.round(ev / 1000)}K` : `${ev.toFixed(2)}${unit}`;
          const kalshiMonth = extractReleaseMonth(eventTicker) !== 'UNKNOWN'
            ? extractReleaseMonth(eventTicker)
            : extractReleaseMonth(sampleTitle);

          discovered[category] = {
            category,
            releaseMonth: kalshiMonth,
            kalshiSeriesTicker: ticker,
            kalshiEventTicker: eventTicker,
            kalshiReleaseMonth: kalshiMonth,
            kalshiImpliedEv: ev,
            combinedImpliedEv: ev,
            kalshiSampleTitle: sampleTitle,
            polymarketSlug: null,
            summaryLabel: `Kalshi ${eventTicker} EV: ${displayEv}`,
            lastUpdated: now,
          };
        }
      }
    }

    // 2. Verify Polymarket keyword searches ("Fed", "CPI", "jobs")
    const polyKeywords = ['Fed', 'CPI', 'jobs'];
    const polyResults = await Promise.allSettled(
      polyKeywords.map(async (kw) => {
        const r = await fetch(`${polyBase}/public-search?q=${encodeURIComponent(kw)}`, {
          headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(6000),
        });
        const j = r.ok ? await r.json() : null;
        return { kw, status: r.status, events: j?.events || [] };
      })
    );

    const droppedPolymarketCandidates: PredictionMarketMappingRow[] = [];

    for (const res of polyResults) {
      if (res.status !== 'fulfilled') continue;
      const { kw, status, events } = res.value;
      const openEvents = events.filter((e: any) => !e.closed && e.active);

      if (!hasLoggedVerification) {
        console.log(
          `[PREDICTION VERIFY] Polymarket GET /public-search?q=${kw} (${status}) -> ${openEvents.length} active open events`
        );
      }

      for (const ev of openEvents) {
        const slug = String(ev.slug || '');
        const title = String(ev.title || '');
        const polyCategory = classifyPolymarketIndicator(title, slug);
        if (!polyCategory) continue;

        const polyMonth = extractReleaseMonth(`${slug} ${title}`);
        const existing = discovered[polyCategory];

        if (polyCategory === 'FED_RATE') {
          // Only merge Polymarket Fed decision if existing Kalshi FED_RATE is for the same month (or if no Kalshi exists)
          if (existing && existing.kalshiReleaseMonth && polyMonth !== 'UNKNOWN' && existing.kalshiReleaseMonth !== polyMonth) {
            droppedPolymarketCandidates.push({
              indicator: `FED_RATE (Polymarket candidate)`,
              releaseMonth: polyMonth,
              kalshiTicker: existing.kalshiEventTicker || null,
              polymarketSlug: null,
              matchedStatus: `DROPPED: Polymarket "${slug}" month (${polyMonth}) != Kalshi ${existing.kalshiEventTicker} month (${existing.kalshiReleaseMonth})`,
            });
            continue;
          }

          let holdP = 0;
          let cutP = 0;
          let hikeP = 0;
          let netCutBps = 0;
          const polyRawContracts: RawPredictionContractPrice[] = [];

          for (const m of ev.markets || []) {
            const label = String(m.groupItemTitle || m.question || '').toLowerCase();
            let p = 0;
            try {
              const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
              p = parseFloat(prices?.[0] ?? '0');
            } catch {}
            let bucket: 'HOLD' | 'CUT' | 'HIKE' | null = null;
            if (label.includes('no change')) {
              holdP += p;
              bucket = 'HOLD';
            } else if (label.includes('50+ bps decrease')) {
              cutP += p;
              netCutBps += p * 50;
              bucket = 'CUT';
            } else if (label.includes('25 bps decrease')) {
              cutP += p;
              netCutBps += p * 25;
              bucket = 'CUT';
            } else if (label.includes('50+ bps increase')) {
              hikeP += p;
              netCutBps -= p * 50;
              bucket = 'HIKE';
            } else if (label.includes('25 bps increase')) {
              hikeP += p;
              netCutBps -= p * 25;
              bucket = 'HIKE';
            }
            if (bucket && p > 0) {
              polyRawContracts.push({
                venue: 'Polymarket',
                tickerOrId: String(m.id || slug),
                title: String(m.groupItemTitle || m.question || ''),
                bucket,
                rawPrice: Number(p.toFixed(4)),
                rawPct: Number((p * 100).toFixed(2)),
              });
            }
          }

          if (holdP + cutP + hikeP <= 0) continue;

          const combinedBps =
            existing?.kalshiNetCutBps !== undefined && existing.kalshiNetCutBps !== null
              ? Number(((existing.kalshiNetCutBps + netCutBps) / 2).toFixed(2))
              : Number(netCutBps.toFixed(2));

          // Average raw percentages across Kalshi and Polymarket, then normalize strictly to 100%
          const avgRawHoldPct = existing?.rawHoldPct !== undefined
            ? Number(((existing.rawHoldPct + holdP * 100) / 2).toFixed(2))
            : Number((holdP * 100).toFixed(2));
          const avgRawCutPct = existing?.rawCutPct !== undefined
            ? Number(((existing.rawCutPct + cutP * 100) / 2).toFixed(2))
            : Number((cutP * 100).toFixed(2));
          const avgRawHikePct = existing?.rawHikePct !== undefined
            ? Number(((existing.rawHikePct + hikeP * 100) / 2).toFixed(2))
            : Number((hikeP * 100).toFixed(2));

          const norm = normalizeThreeWayProbabilities(avgRawHoldPct, avgRawCutPct, avgRawHikePct);

          discovered.FED_RATE = {
            ...existing,
            category: 'FED_RATE',
            releaseMonth: existing?.kalshiReleaseMonth || polyMonth,
            polymarketSlug: slug,
            polymarketTitle: title,
            polymarketReleaseMonth: polyMonth,
            polymarketNetCutBps: Number(netCutBps.toFixed(2)),
            combinedNetCutBps: combinedBps,
            holdProb: norm.holdProb,
            cutProb: norm.cutProb,
            hikeProb: norm.hikeProb,
            rawHoldPct: avgRawHoldPct,
            rawCutPct: avgRawCutPct,
            rawHikePct: avgRawHikePct,
            rawProbSumPct: norm.rawSumPct,
            rawContracts: [...(existing?.rawContracts || []), ...polyRawContracts],
            summaryLabel: `Kalshi+Poly Fed: ${norm.holdProb}% Hold, ${norm.cutProb}% Cut, ${norm.hikeProb}% Hike`,
            lastUpdated: now,
          };
          break; // Take nearest matching open Fed decision
        } else {
          // Non-Fed indicator (CPI_MOM, CORE_CPI_MOM, CPI_YOY, CORE_CPI_YOY, NFP, UNEMPLOYMENT)
          const polyEv = computePolymarketBucketEv(ev.markets || []);
          if (polyEv === null) continue;

          // Round 9 Item 2 Rule: Map a Polymarket market to an event ONLY if the SAME indicator
          // (headline vs core, MoM vs YoY) AND SAME release month match. Otherwise drop it.
          if (existing && existing.kalshiEventTicker) {
            const kalshiMonth = existing.kalshiReleaseMonth || 'UNKNOWN';
            if (polyMonth === 'UNKNOWN' || kalshiMonth === 'UNKNOWN' || polyMonth !== kalshiMonth) {
              droppedPolymarketCandidates.push({
                indicator: polyCategory,
                releaseMonth: `${kalshiMonth} (Kalshi) vs ${polyMonth} (Poly)`,
                kalshiTicker: existing.kalshiEventTicker,
                polymarketSlug: null,
                matchedStatus: `DROPPED Polymarket "${slug}" (${polyCategory}, ${polyMonth}): does not match Kalshi ${existing.kalshiEventTicker} (${existing.category}, ${kalshiMonth})`,
              });
              continue;
            }

            const combined =
              existing.kalshiImpliedEv !== undefined && existing.kalshiImpliedEv !== null
                ? Number(((existing.kalshiImpliedEv + polyEv) / 2).toFixed(3))
                : polyEv;

            discovered[polyCategory] = {
              ...existing,
              category: polyCategory,
              releaseMonth: kalshiMonth,
              polymarketSlug: slug,
              polymarketTitle: title,
              polymarketReleaseMonth: polyMonth,
              polymarketImpliedEv: polyEv,
              combinedImpliedEv: combined,
              summaryLabel: `Kalshi+Poly ${polyCategory} (${kalshiMonth}) EV: ${combined.toFixed(2)}%`,
              lastUpdated: now,
            };
          } else {
            // No Kalshi series exists for this indicator category (e.g., CORE_CPI_YOY when Kalshi only has headline KXCPIYOY)
            // Check if any Kalshi CPI release month is active so we don't keep stale prior-month Polymarket contracts
            const activeCpiMonth = discovered.CPI_YOY?.kalshiReleaseMonth || discovered.CORE_CPI_MOM?.kalshiReleaseMonth || discovered.CPI_MOM?.kalshiReleaseMonth;
            if (activeCpiMonth && polyMonth !== 'UNKNOWN' && polyMonth !== activeCpiMonth) {
              droppedPolymarketCandidates.push({
                indicator: polyCategory,
                releaseMonth: polyMonth,
                kalshiTicker: null,
                polymarketSlug: null,
                matchedStatus: `DROPPED Polymarket "${slug}" (${polyCategory}, ${polyMonth}): release month ${polyMonth} does not match current active CPI release month (${activeCpiMonth})`,
              });
              continue;
            }
          }
        }
      }
    }

    // Build canonical mapping table for all discovered indicators + any dropped mismatches
    const canonicalCategories: DiscoveredPredictionMarket['category'][] = [
      'CPI_MOM',
      'CORE_CPI_MOM',
      'CPI_YOY',
      'CORE_CPI_YOY',
      'NFP',
      'UNEMPLOYMENT',
      'FED_RATE',
    ];

    for (const cat of canonicalCategories) {
      const m = discovered[cat];
      if (m) {
        mappingTable.push({
          indicator: cat,
          releaseMonth: m.releaseMonth || m.kalshiReleaseMonth || m.polymarketReleaseMonth || 'UNKNOWN',
          kalshiTicker: m.kalshiEventTicker || m.kalshiSeriesTicker || null,
          polymarketSlug: m.polymarketSlug || null,
          matchedStatus: m.polymarketSlug
            ? 'MATCHED (Same indicator & same release month)'
            : 'KALSHI ONLY (No Polymarket contract with matching indicator + release month)',
        });
      } else {
        const droppedForCat = droppedPolymarketCandidates.find((d) => d.indicator === cat);
        mappingTable.push({
          indicator: cat,
          releaseMonth: droppedForCat ? droppedForCat.releaseMonth : 'NONE',
          kalshiTicker: null,
          polymarketSlug: null,
          matchedStatus: droppedForCat
            ? droppedForCat.matchedStatus
            : 'DROPPED / NONE (No active contract for current release month)',
        });
      }
    }

    for (const d of droppedPolymarketCandidates) {
      if (!canonicalCategories.includes(d.indicator as any) || discovered[d.indicator]) {
        mappingTable.push(d);
      }
    }

    hasLoggedVerification = true;
    lastPredictionFetchAt = now;
    cachedMacro.discoveredMarkets = discovered;
    cachedMacro.predictionMarketMappingTable = mappingTable;

    // Also populate legacy predictionMarket summary field for UI compatibility
    if (discovered.FED_RATE) {
      const f = discovered.FED_RATE;
      const netBps = f.combinedNetCutBps ?? 0;
      cachedMacro.predictionMarket = {
        question: f.polymarketTitle || 'Fed Rate Decision',
        holdProb: f.holdProb,
        cutProb: f.cutProb,
        hikeProb: f.hikeProb,
        sentiment: netBps > 1.5 ? 'BULLISH' : netBps < -1.5 ? 'BEARISH' : 'NEUTRAL',
        label: f.summaryLabel,
      };
    }
  } catch (err: any) {
    console.warn('[PREDICTION MARKETS] Discovery refresh warning:', err.message);
  } finally {
    isFetchingPredictions = false;
  }

  return cachedMacro.discoveredMarkets;
}

export function getPredictionMarketMappingTable(): PredictionMarketMappingRow[] {
  return cachedMacro.predictionMarketMappingTable || [];
}

/**
 * Matches a calendar event title (and optional event date) to a discovered Kalshi/Polymarket market
 * ONLY if the exact indicator category (headline vs core, MoM vs YoY) matches.
 * Never falls back from Headline CPI to Core CPI or vice versa.
 */
export function findMatchingPredictionMarketForEvent(
  eventTitle: string,
  overrideMarkets?: Record<string, DiscoveredPredictionMarket>
): DiscoveredPredictionMarket | null {
  const t = eventTitle.toLowerCase();
  const markets =
    overrideMarkets && Object.keys(overrideMarkets).length > 0
      ? overrideMarkets
      : cachedMacro.discoveredMarkets;

  if (t.includes('core cpi') && (t.includes('m/m') || t.includes('mom') || !t.includes('y/y'))) {
    return markets.CORE_CPI_MOM || null;
  }
  if (t.includes('core cpi') && (t.includes('y/y') || t.includes('yoy'))) {
    return markets.CORE_CPI_YOY || null;
  }
  if (!t.includes('core') && t.includes('cpi') && (t.includes('y/y') || t.includes('yoy'))) {
    return markets.CPI_YOY || null;
  }
  if (!t.includes('core') && t.includes('cpi')) {
    return markets.CPI_MOM || null;
  }
  if (t.includes('non-farm') || t.includes('nfp') || t.includes('payrolls')) {
    return markets.NFP || null;
  }
  if (t.includes('unemployment rate')) {
    return markets.UNEMPLOYMENT || null;
  }
  if (
    t.includes('federal funds rate') ||
    t.includes('fomc statement') ||
    t.includes('fomc meeting') ||
    t.includes('fomc press') ||
    t.includes('fed chair')
  ) {
    return markets.FED_RATE || null;
  }
  return null;
}

/**
 * Polls live USD pairs (EURUSD, USDJPY, GBPUSD, DXY) from BiQuote and US10Y from FRED/CNBC/Yahoo.
 */
export async function fetchLiveMacroData(forceRefresh = false): Promise<LiveMacroData> {
  const now = Date.now();
  if (!forceRefresh && cachedMacro.timestamp > 0 && now - cachedMacro.timestamp < 10_000) {
    updateGoldTrendAndLevels();
    return cachedMacro;
  }
  if (isFetchingLiveMacro) {
    updateGoldTrendAndLevels();
    return cachedMacro;
  }
  isFetchingLiveMacro = true;

  try {
    // Trigger prediction markets discovery if needed
    if (lastPredictionFetchAt === 0 || now - lastPredictionFetchAt >= PREDICTION_CACHE_TTL_MS) {
      if (forceRefresh && lastPredictionFetchAt === 0) {
        await discoverAndRefreshPredictionMarkets(true).catch(() => {});
      } else {
        discoverAndRefreshPredictionMarkets().catch(() => {});
      }
    }

    const fetchBiquotePair = async (symbol: 'EURUSD' | 'USDJPY' | 'GBPUSD' | 'DXY'): Promise<UsdPairQuote | null> => {
      const r = await fetch(`https://biquote.io/api/${symbol}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'SARRAF-Terminal/1.0' },
        signal: AbortSignal.timeout(4500),
      });
      if (!r.ok) return null;
      const d = await r.json();
      if (!d || typeof d.bid !== 'number' || typeof d.ask !== 'number') return null;
      const mid = typeof d.mid === 'number' && d.mid > 0 ? d.mid : (d.bid + d.ask) / 2;
      const ageSec = typeof d.quoteAgeSeconds === 'number' ? d.quoteAgeSeconds : 0;
      return {
        symbol,
        bid: d.bid,
        ask: d.ask,
        mid,
        high: typeof d.high === 'number' ? d.high : mid,
        low: typeof d.low === 'number' ? d.low : mid,
        dayDiffPercent: typeof d.dayDiffPercent === 'number' ? d.dayDiffPercent : 0,
        direction: d.direction === 'UP' || d.direction === 'DOWN' ? d.direction : 'FLAT',
        quoteAgeSeconds: ageSec,
        stale: Boolean(d.stale) || ageSec > 60,
        lastUpdated: Date.now(),
      };
    };

    const fredKey = process.env.FRED_API_KEY?.trim();

    const [eurRes, jpyRes, gbpRes, dxyRes, cnbc10yRes, fred10yRes, yahoo10yRes] = await Promise.allSettled([
      fetchBiquotePair('EURUSD'),
      fetchBiquotePair('USDJPY'),
      fetchBiquotePair('GBPUSD'),
      fetchBiquotePair('DXY'),
      fetch(
        'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=US10Y&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1',
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4500) }
      ).then((r) => (r.ok ? r.json() : null)),
      fredKey
        ? fetch(
            `https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=${encodeURIComponent(
              fredKey
            )}&file_type=json&sort_order=desc&limit=5`,
            { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4500) }
          ).then((r) => (r.ok ? r.json() : null))
        : Promise.resolve(null),
      fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=5d', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(4500),
      }).then((r) => (r.ok ? r.json() : null)),
    ]);

    const fetchDoneMs = Date.now();
    const eurusd = eurRes.status === 'fulfilled' ? eurRes.value : null;
    const usdjpy = jpyRes.status === 'fulfilled' ? jpyRes.value : null;
    const gbpusd = gbpRes.status === 'fulfilled' ? gbpRes.value : null;
    const dxyPair = dxyRes.status === 'fulfilled' ? dxyRes.value : null;

    // Build Dollar Strength Proxy from live EURUSD, USDJPY, GBPUSD
    const pairsUsed: string[] = [];
    let weightedUsdPctSum = 0;
    let weightTotal = 0;

    if (eurusd && !eurusd.stale) {
      // EURUSD up = USD weaker -> invert
      weightedUsdPctSum += -eurusd.dayDiffPercent * 0.576;
      weightTotal += 0.576;
      pairsUsed.push(`EURUSD ${eurusd.mid.toFixed(4)} (${eurusd.dayDiffPercent >= 0 ? '+' : ''}${eurusd.dayDiffPercent.toFixed(2)}%)`);
    }
    if (usdjpy && !usdjpy.stale) {
      // USDJPY up = USD stronger -> same sign
      weightedUsdPctSum += usdjpy.dayDiffPercent * 0.136;
      weightTotal += 0.136;
      pairsUsed.push(`USDJPY ${usdjpy.mid.toFixed(2)} (${usdjpy.dayDiffPercent >= 0 ? '+' : ''}${usdjpy.dayDiffPercent.toFixed(2)}%)`);
    }
    if (gbpusd && !gbpusd.stale) {
      // GBPUSD up = USD weaker -> invert
      weightedUsdPctSum += -gbpusd.dayDiffPercent * 0.119;
      weightTotal += 0.119;
      pairsUsed.push(`GBPUSD ${gbpusd.mid.toFixed(4)} (${gbpusd.dayDiffPercent >= 0 ? '+' : ''}${gbpusd.dayDiffPercent.toFixed(2)}%)`);
    }

    if (weightTotal > 0) {
      const compositeChangePct = Number((weightedUsdPctSum / weightTotal).toFixed(3));
      // Invert for Gold: USD weaker (compositeChangePct < 0) = POSITIVE (bullish) for Gold
      const goldScore = Math.max(-1, Math.min(1, Number((-compositeChangePct / 0.30).toFixed(3))));
      const goldDirection: 1 | -1 | 0 = goldScore > 0.05 ? 1 : goldScore < -0.05 ? -1 : 0;

      cachedMacro.dollarProxy = {
        compositeChangePct,
        goldScore,
        goldDirection,
        pairsUsed,
        eurusd: eurusd || undefined,
        usdjpy: usdjpy || undefined,
        gbpusd: gbpusd || undefined,
        dxy: dxyPair || undefined,
        lastUpdated: fetchDoneMs,
        ageMs: 0,
        isStale: false,
      };
    }

    if (dxyPair && !dxyPair.stale) {
      const change = Number(((dxyPair.mid * dxyPair.dayDiffPercent) / 100).toFixed(3));
      cachedMacro.dxy = {
        price: Number(dxyPair.mid.toFixed(3)),
        change,
        changePct: Number(dxyPair.dayDiffPercent.toFixed(2)),
        direction: change > 0.01 ? 'UP' : change < -0.01 ? 'DOWN' : 'FLAT',
        lastUpdated: fetchDoneMs,
        isStale: false,
      };
    } else {
      cachedMacro.dxy = null;
    }

    // Parse US10Y Yield (Priority: FRED + CNBC real-time quote -> Yahoo ^TNX)
    let parsedUs10y: Us10yLiveQuote | null = null;

    if (cnbc10yRes.status === 'fulfilled' && cnbc10yRes.value?.FormattedQuoteResult?.FormattedQuote?.[0]) {
      const q = cnbc10yRes.value.FormattedQuoteResult.FormattedQuote[0];
      const yieldVal = parseFloat(String(q.last || '').replace('%', ''));
      const changeVal = parseFloat(String(q.change || '0'));
      if (!isNaN(yieldVal) && yieldVal > 0) {
        const changeBp = Number((changeVal * 100).toFixed(1));
        parsedUs10y = {
          yield: Number(yieldVal.toFixed(3)),
          change: Number(changeVal.toFixed(3)),
          changeBp,
          direction: changeBp > 0.5 ? 'UP' : changeBp < -0.5 ? 'DOWN' : 'FLAT',
          source: fredKey ? 'FRED+CNBC' : 'CNBC_LIVE',
          lastUpdated: fetchDoneMs,
          ageMs: 0,
          isStale: false,
        };
      }
    }

    if (!parsedUs10y && fred10yRes.status === 'fulfilled' && Array.isArray(fred10yRes.value?.observations)) {
      const validObs = fred10yRes.value.observations
        .map((o: any) => ({ date: o.date, val: parseFloat(o.value) }))
        .filter((o: any) => !isNaN(o.val) && o.val > 0);
      if (validObs.length >= 2) {
        const curr = validObs[0].val;
        const prev = validObs[1].val;
        const diff = Number((curr - prev).toFixed(3));
        const bp = Number((diff * 100).toFixed(1));
        parsedUs10y = {
          yield: curr,
          change: diff,
          changeBp: bp,
          direction: bp > 0.5 ? 'UP' : bp < -0.5 ? 'DOWN' : 'FLAT',
          source: 'FRED',
          lastUpdated: fetchDoneMs,
          ageMs: 0,
          isStale: false,
        };
      }
    }

    if (!parsedUs10y && yahoo10yRes.status === 'fulfilled' && yahoo10yRes.value?.chart?.result?.[0]?.meta) {
      const meta = yahoo10yRes.value.chart.result[0].meta;
      const currentYield = Number(meta.regularMarketPrice);
      const prevClose = Number(meta.chartPreviousClose || currentYield);
      if (!isNaN(currentYield) && currentYield > 0) {
        const diff = Number((currentYield - prevClose).toFixed(3));
        const bp = Number((diff * 100).toFixed(1));
        parsedUs10y = {
          yield: currentYield,
          change: diff,
          changeBp: bp,
          direction: bp > 0.5 ? 'UP' : bp < -0.5 ? 'DOWN' : 'FLAT',
          source: 'YAHOO_TNX',
          lastUpdated: fetchDoneMs,
          ageMs: 0,
          isStale: false,
        };
      }
    }

    if (parsedUs10y) {
      cachedMacro.us10y = parsedUs10y;
    }

    updateGoldTrendAndLevels();
    cachedMacro.timestamp = fetchDoneMs;
    try {
      writeJsonAtomic(MACRO_CACHE_FILE, cachedMacro);
    } catch {}
  } catch (err: any) {
    console.warn('[MACRO FEED] Macro refresh error:', err.message);
  } finally {
    isFetchingLiveMacro = false;
  }

  return getCachedMacroData();
}

function updateGoldTrendAndLevels() {
  try {
    const now = Date.now();
    const tick = getLastValidTick();
    if (!tick || typeof tick.price !== 'number' || tick.price <= 0 || tick.source === 'UNINITIALIZED') {
      cachedMacro.gold4h = null;
      cachedMacro.goldTrend = null;
      return;
    }
    const store = getCandleStore();
    const h4Candles = store.H4 || [];
    const h1Candles = store.H1 || [];

    const tickAgeMs = Math.max(0, now - (tick.lastReceivedAt || 0));
    const isStale = tickAgeMs > LIVE_STALE_MS;

    const price = tick.price;
    const high24h = tick.high || price;
    const low24h = tick.low || price;
    const prevClose = tick.previousClose || tick.open || price;
    const pivot = Number(((high24h + low24h + prevClose) / 3).toFixed(2));

    let h4Open = tick.open || price;
    let h4Close = price;
    let h4High = high24h;
    let h4Low = low24h;
    let h4Ema10 = price;

    if (h4Candles.length > 0) {
      const lastH4 = h4Candles[h4Candles.length - 1];
      // Use rolling 4h lookback from H1 if current H4 candle just opened (<0.02% move)
      h4Open = lastH4.open;
      h4Close = price || lastH4.close;
      h4High = Math.max(lastH4.high, price);
      h4Low = Math.min(lastH4.low, price);

      if (Math.abs(h4Close - h4Open) < 0.5 && h1Candles.length >= 4) {
        const fourHoursAgoCandle = h1Candles[h1Candles.length - 4];
        if (fourHoursAgoCandle && fourHoursAgoCandle.open > 0) {
          h4Open = fourHoursAgoCandle.open;
        }
      }

      const slice = h4Candles.slice(-10);
      const k = 2 / (slice.length + 1);
      let ema = slice[0].close;
      for (let i = 1; i < slice.length; i++) {
        ema = slice[i].close * k + ema * (1 - k);
      }
      h4Ema10 = Number(ema.toFixed(2));
    }

    const diff4h = h4Close - h4Open;
    const h4ChangePct = h4Open > 0 ? Number(((diff4h / h4Open) * 100).toFixed(2)) : 0;

    // Combine H4 change, distance from 24h Pivot, and distance from H4 EMA10
    const range24h = Math.max(8, high24h - low24h);
    const pivotScore = (price - pivot) / (range24h * 0.5);
    const emaScore = (price - h4Ema10) / (range24h * 0.5);
    const h4MomentumScore = h4ChangePct / 0.35;

    const rawScore = Math.max(
      -1,
      Math.min(1, Number((0.45 * pivotScore + 0.35 * h4MomentumScore + 0.20 * emaScore).toFixed(3)))
    );
    const direction: 1 | -1 | 0 = rawScore > 0.06 ? 1 : rawScore < -0.06 ? -1 : 0;
    const bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
      direction === 1 ? 'BULLISH' : direction === -1 ? 'BEARISH' : 'NEUTRAL';

    cachedMacro.gold4h = {
      open: h4Open,
      close: h4Close,
      high: h4High,
      low: h4Low,
      changePct: h4ChangePct,
      bias,
    };

    cachedMacro.goldTrend = {
      price,
      open24h: tick.open || prevClose,
      high24h,
      low24h,
      pivot,
      h4Open,
      h4Close,
      h4ChangePct,
      h4Ema10,
      bias,
      rawScore,
      direction,
      keyLevelsText: `$${price.toFixed(1)} vs Pivot $${pivot.toFixed(1)} (H4 ${h4ChangePct >= 0 ? '+' : ''}${h4ChangePct}%)`,
      lastUpdated: tick.lastReceivedAt || now,
      ageMs: tickAgeMs,
      isStale,
    };
  } catch {
    // ignore
  }
}

export function getCachedMacroData(): LiveMacroData {
  const now = Date.now();
  updateGoldTrendAndLevels();

  if (cachedMacro.dollarProxy) {
    const ageMs = Math.max(0, now - cachedMacro.dollarProxy.lastUpdated);
    cachedMacro.dollarProxy.ageMs = ageMs;
    cachedMacro.dollarProxy.isStale = ageMs > LIVE_STALE_MS;
  }
  if (cachedMacro.dxy) {
    cachedMacro.dxy.isStale = now - cachedMacro.dxy.lastUpdated > LIVE_STALE_MS;
  }
  if (cachedMacro.us10y) {
    const ageMs = Math.max(0, now - cachedMacro.us10y.lastUpdated);
    cachedMacro.us10y.ageMs = ageMs;
    cachedMacro.us10y.isStale = ageMs > LIVE_STALE_MS;
  }

  return cachedMacro;
}

export function startMacroFeedLoop(): void {
  if (backgroundTimerStarted) return;
  backgroundTimerStarted = true;

  // Initial immediate discovery & live fetch
  discoverAndRefreshPredictionMarkets(true).catch(() => {});
  fetchLiveMacroData(true).catch(() => {});

  setInterval(() => {
    fetchLiveMacroData(true).catch(() => {});
  }, MACRO_POLL_INTERVAL_MS);
}
