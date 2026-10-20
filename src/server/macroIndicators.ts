import { getCandleStore } from './candleEngine.ts';
import { evaluateStructureBias } from './sarrafEngine.ts';

export interface MacroIndicatorQuote {
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  isBullishForGold: boolean | null;
}

export interface MacroSnapshot {
  dxy: MacroIndicatorQuote | null;
  us10y: MacroIndicatorQuote | null;
  gold4h: {
    bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    isChop: boolean;
    lastClose: number;
  } | null;
  timestamp: number;
}

let cachedSnapshot: MacroSnapshot | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 60s cache for high efficiency

async function fetchQuote(symbol: string): Promise<MacroIndicatorQuote | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') return null;

    const price = Number(meta.regularMarketPrice.toFixed(3));
    const prevClose = typeof meta.chartPreviousClose === 'number'
      ? Number(meta.chartPreviousClose.toFixed(3))
      : price;
    const change = Number((price - prevClose).toFixed(3));
    const changePct = prevClose > 0 ? Number(((change / prevClose) * 100).toFixed(2)) : 0;

    // For Dollar & US10Y: Falling dollar/yields is BULLISH for Gold; Rising is BEARISH
    const isBullishForGold = change < -0.01 ? true : change > 0.01 ? false : null;

    return {
      price,
      prevClose,
      change,
      changePct,
      isBullishForGold,
    };
  } catch {
    return null;
  }
}

export async function getLiveMacroSnapshot(): Promise<MacroSnapshot> {
  const now = Date.now();
  if (cachedSnapshot && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedSnapshot;
  }

  // Real live quotes (strictly real or null, zero synthetic fallbacks)
  const [dxyQuote, us10yQuote] = await Promise.all([
    fetchQuote('DX-Y.NYB'),
    fetchQuote('^TNX'),
  ]);

  // Real Gold 4h structure from authentic candle store
  let gold4hInfo: MacroSnapshot['gold4h'] = null;
  try {
    const store = getCandleStore();
    if (store && Array.isArray(store.H4) && store.H4.length >= 5) {
      const struct = evaluateStructureBias(store.H4);
      const lastBar = store.H4[store.H4.length - 1];
      gold4hInfo = {
        bias: struct.bias,
        isChop: struct.isChop,
        lastClose: lastBar ? Number(lastBar.close.toFixed(2)) : 0,
      };
    }
  } catch {
    gold4hInfo = null;
  }

  cachedSnapshot = {
    dxy: dxyQuote,
    us10y: us10yQuote,
    gold4h: gold4hInfo,
    timestamp: now,
  };
  lastFetchTime = now;

  return cachedSnapshot;
}
