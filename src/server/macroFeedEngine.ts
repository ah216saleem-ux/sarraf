import { getCandleStore } from './candleEngine.ts';
import { getLastValidTick } from './marketPriceEngine.ts';

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

export interface DiscoveredPredictionMarket {
  category: 'CPI_MOM' | 'CORE_CPI_MOM' | 'CPI_YOY' | 'CORE_CPI_YOY' | 'NFP' | 'UNEMPLOYMENT' | 'FED_RATE';
  kalshiSeriesTicker?: string;
  kalshiEventTicker?: string;
  kalshiImpliedEv?: number | null;
  kalshiNetCutBps?: number | null;
  kalshiSampleTitle?: string;
  polymarketSlug?: string;
  polymarketTitle?: string;
  polymarketImpliedEv?: number | null;
  polymarketNetCutBps?: number | null;
  combinedImpliedEv?: number | null;
  combinedNetCutBps?: number | null;
  holdProb?: number;
  cutProb?: number;
  hikeProb?: number;
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
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    label: string;
  } | null;
  discoveredMarkets: Record<string, DiscoveredPredictionMarket>;
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
  timestamp: 0,
};

let isFetchingLiveMacro = false;
let isFetchingPredictions = false;
let lastPredictionFetchAt = 0;
let hasLoggedVerification = false;
let backgroundTimerStarted = false;

/**
 * Computes Expected Value E[X] from a Kalshi binary "greater than floor_strike" ladder:
 * E[X] = s_min + sum_i P(X > s_i) * (s_{i+1} - s_i)
 */
function computeKalshiStrikeLadderEv(markets: any[]): { ev: number | null; eventTicker: string; sampleTitle: string } {
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

  if (ladder.length < 2) return { ev: null, eventTicker: nearestEvent || '', sampleTitle: sortedByClose[0].title || '' };

  let ev = ladder[0].floor_strike;
  for (let i = 0; i < ladder.length; i++) {
    const m = ladder[i];
    const bid = parseFloat(m.yes_bid_dollars ?? m.last_price_dollars ?? '0');
    const ask = parseFloat(m.yes_ask_dollars ?? m.last_price_dollars ?? '0');
    const prob = bid > 0 && ask > 0 ? (bid + ask) / 2 : parseFloat(m.last_price_dollars || '0');
    const step =
      i < ladder.length - 1
        ? ladder[i + 1].floor_strike - m.floor_strike
        : ladder[i].floor_strike - ladder[i - 1].floor_strike;
    ev += Math.max(0, Math.min(1, prob)) * Math.max(0, step);
  }

  return {
    ev: Number(ev.toFixed(4)),
    eventTicker: nearestEvent,
    sampleTitle: ladder[0].title || '',
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
 * Logs verification results on first execution as required.
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
  const discovered: Record<string, DiscoveredPredictionMarket> = { ...cachedMacro.discoveredMarkets };

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

        let holdProb = 0;
        let cutProb = 0;
        let hikeProb = 0;
        let netCutBps = 0; // positive = dovish cut (bullish gold), negative = hawkish hike (bearish gold)

        for (const m of eventMarkets) {
          const bid = parseFloat(m.yes_bid_dollars ?? m.last_price_dollars ?? '0');
          const ask = parseFloat(m.yes_ask_dollars ?? m.last_price_dollars ?? '0');
          const p = bid > 0 && ask > 0 ? (bid + ask) / 2 : parseFloat(m.last_price_dollars || '0');
          const sub = String(m.subtitle || m.title || '').toLowerCase();
          if (sub.includes('hike 0') || sub.includes('maintain') || sub.includes('no change')) {
            holdProb += p;
          } else if (sub.includes('cut >25') || sub.includes('cut 50')) {
            cutProb += p;
            netCutBps += p * 50;
          } else if (sub.includes('cut 25')) {
            cutProb += p;
            netCutBps += p * 25;
          } else if (sub.includes('hike >25') || sub.includes('hike 50')) {
            hikeProb += p;
            netCutBps -= p * 50;
          } else if (sub.includes('hike 25')) {
            hikeProb += p;
            netCutBps -= p * 25;
          }
        }

        if (eventMarkets.length > 0) {
          discovered.FED_RATE = {
            category: 'FED_RATE',
            kalshiSeriesTicker: ticker,
            kalshiEventTicker: nearestEvent,
            kalshiNetCutBps: Number(netCutBps.toFixed(2)),
            combinedNetCutBps: Number(netCutBps.toFixed(2)),
            holdProb: Math.round(holdProb * 100),
            cutProb: Math.round(cutProb * 100),
            hikeProb: Math.round(hikeProb * 100),
            summaryLabel: `Kalshi ${nearestEvent}: ${Math.round(holdProb * 100)}% Hold, ${Math.round(cutProb * 100)}% Cut, ${Math.round(hikeProb * 100)}% Hike`,
            lastUpdated: now,
          };
        }
      } else {
        const { ev, eventTicker, sampleTitle } = computeKalshiStrikeLadderEv(markets);
        if (ev !== null) {
          const unit = category === 'NFP' ? '' : '%';
          const displayEv = category === 'NFP' ? `${Math.round(ev / 1000)}K` : `${ev.toFixed(2)}${unit}`;
          discovered[category] = {
            category,
            kalshiSeriesTicker: ticker,
            kalshiEventTicker: eventTicker,
            kalshiImpliedEv: ev,
            combinedImpliedEv: ev,
            kalshiSampleTitle: sampleTitle,
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
        const titleLower = String(ev.title || '').toLowerCase();
        if (kw === 'Fed' && titleLower.includes('fed decision')) {
          let holdP = 0;
          let cutP = 0;
          let hikeP = 0;
          let netCutBps = 0;
          for (const m of ev.markets || []) {
            const label = String(m.groupItemTitle || m.question || '').toLowerCase();
            let p = 0;
            try {
              const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
              p = parseFloat(prices?.[0] ?? '0');
            } catch {}
            if (label.includes('no change')) holdP += p;
            else if (label.includes('50+ bps decrease')) {
              cutP += p;
              netCutBps += p * 50;
            } else if (label.includes('25 bps decrease')) {
              cutP += p;
              netCutBps += p * 25;
            } else if (label.includes('50+ bps increase')) {
              hikeP += p;
              netCutBps -= p * 50;
            } else if (label.includes('25 bps increase')) {
              hikeP += p;
              netCutBps -= p * 25;
            }
          }
          const existing = discovered.FED_RATE;
          const combinedBps =
            existing?.kalshiNetCutBps !== undefined && existing.kalshiNetCutBps !== null
              ? Number(((existing.kalshiNetCutBps + netCutBps) / 2).toFixed(2))
              : Number(netCutBps.toFixed(2));
          const holdPct = Math.round(((existing?.holdProb ?? holdP * 100) + holdP * 100) / (existing ? 2 : 1));
          const cutPct = Math.round(((existing?.cutProb ?? cutP * 100) + cutP * 100) / (existing ? 2 : 1));
          const hikePct = Math.round(((existing?.hikeProb ?? hikeP * 100) + hikeP * 100) / (existing ? 2 : 1));

          discovered.FED_RATE = {
            ...existing,
            category: 'FED_RATE',
            polymarketSlug: ev.slug,
            polymarketTitle: ev.title,
            polymarketNetCutBps: Number(netCutBps.toFixed(2)),
            combinedNetCutBps: combinedBps,
            holdProb: holdPct,
            cutProb: cutPct,
            hikeProb: hikePct,
            summaryLabel: `Kalshi+Poly Fed: ${holdPct}% Hold, ${cutPct}% Cut, ${hikePct}% Hike`,
            lastUpdated: now,
          };
          break; // Take nearest open Fed decision
        }

        if (kw === 'CPI' && !titleLower.includes('japan') && !titleLower.includes('uk')) {
          const polyEv = computePolymarketBucketEv(ev.markets || []);
          if (polyEv !== null) {
            if (titleLower.includes('core cpi mom') || titleLower.includes('core cpi m/m')) {
              const existing = discovered.CORE_CPI_MOM;
              const combined =
                existing?.kalshiImpliedEv !== undefined && existing.kalshiImpliedEv !== null
                  ? Number(((existing.kalshiImpliedEv + polyEv) / 2).toFixed(3))
                  : polyEv;
              discovered.CORE_CPI_MOM = {
                ...existing,
                category: 'CORE_CPI_MOM',
                polymarketSlug: ev.slug,
                polymarketTitle: ev.title,
                polymarketImpliedEv: polyEv,
                combinedImpliedEv: combined,
                summaryLabel: existing
                  ? `Kalshi+Poly Core CPI EV: ${combined.toFixed(2)}%`
                  : `Polymarket Core CPI EV: ${polyEv.toFixed(2)}%`,
                lastUpdated: now,
              };
            } else if (titleLower.includes('core cpi yoy') || titleLower.includes('cpi yoy')) {
              const existing = discovered.CPI_YOY;
              const combined =
                existing?.kalshiImpliedEv !== undefined && existing.kalshiImpliedEv !== null
                  ? Number(((existing.kalshiImpliedEv + polyEv) / 2).toFixed(3))
                  : polyEv;
              discovered.CORE_CPI_YOY = {
                category: 'CORE_CPI_YOY',
                polymarketSlug: ev.slug,
                polymarketTitle: ev.title,
                polymarketImpliedEv: polyEv,
                combinedImpliedEv: polyEv,
                summaryLabel: `Polymarket Core CPI YoY EV: ${polyEv.toFixed(2)}%`,
                lastUpdated: now,
              };
              if (existing) {
                existing.polymarketSlug = ev.slug;
                existing.polymarketImpliedEv = polyEv;
              }
            }
          }
        }
      }
    }

    hasLoggedVerification = true;
    lastPredictionFetchAt = now;
    cachedMacro.discoveredMarkets = discovered;

    // Also populate legacy predictionMarket summary field for UI compatibility
    if (discovered.FED_RATE) {
      const f = discovered.FED_RATE;
      const netBps = f.combinedNetCutBps ?? 0;
      cachedMacro.predictionMarket = {
        question: f.polymarketTitle || 'Fed Rate Decision',
        holdProb: f.holdProb,
        cutProb: f.cutProb,
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

/**
 * Matches a calendar event title to a discovered Kalshi/Polymarket market if one exists.
 * Returns null if no matching prediction market exists (so the caller drops Input 2).
 */
export function findMatchingPredictionMarketForEvent(
  eventTitle: string
): DiscoveredPredictionMarket | null {
  const t = eventTitle.toLowerCase();
  const markets = cachedMacro.discoveredMarkets;

  if (t.includes('core cpi') && (t.includes('m/m') || t.includes('mom') || !t.includes('y/y'))) {
    return markets.CORE_CPI_MOM || markets.CPI_MOM || null;
  }
  if (t.includes('core cpi') && (t.includes('y/y') || t.includes('yoy'))) {
    return markets.CORE_CPI_YOY || markets.CPI_YOY || null;
  }
  if (t.includes('cpi') && (t.includes('y/y') || t.includes('yoy'))) {
    return markets.CPI_YOY || null;
  }
  if (t.includes('cpi')) {
    return markets.CPI_MOM || markets.CORE_CPI_MOM || null;
  }
  if (t.includes('non-farm') || t.includes('nfp') || t.includes('payrolls') || t.includes('adp')) {
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
    // Trigger prediction markets discovery if needed (non-blocking if already cached)
    if (lastPredictionFetchAt === 0 || now - lastPredictionFetchAt >= PREDICTION_CACHE_TTL_MS) {
      discoverAndRefreshPredictionMarkets().catch(() => {});
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
