/**
 * SARRAF WHALES — free external "whale" data.
 *
 * 1. CFTC Commitments of Traders (weekly, free, no key) — COMEX gold 088691.
 *    Managed-money net position vs its own 52-week range => weekly bias.
 * 2. OANDA v20 order book (optional, free practice token in OANDA_API_TOKEN).
 *    Where retail/broker orders cluster => extra intraday levels.
 *
 * Field names are parsed defensively because they were not verifiable at build time.
 * Everything is cached on disk so a restart never needs a re-download.
 */
import fs from 'fs';
import path from 'path';
import { DATA_DIR, writeJsonAtomic } from '../deploymentSafety.ts';
import type { CotSnapshot, OrderBookSnapshot } from './types.ts';

const COT_CACHE = path.resolve(DATA_DIR, 'sarraf_whales_cot.json');
const COT_REFRESH_MS = 12 * 60 * 60 * 1000;
const GOLD_CODE = '088691';
const COT_DATASETS = [
  { id: '72hh-3qpy', kind: 'disaggregated' }, // Disaggregated futures-only
  { id: '6dca-aqww', kind: 'legacy' }, // Legacy futures-only (fallback)
];

let cotCache: CotSnapshot | null = null;
let cotLastError: string | null = null;
let obCache: OrderBookSnapshot | null = null;
let obLastError: string | null = null;
let obFetchedAtMs = 0;

function readJson<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function findKey(row: Record<string, unknown>, patterns: RegExp[]): string | null {
  const keys = Object.keys(row);
  for (const p of patterns) {
    const k = keys.find((key) => p.test(key));
    if (k) return k;
  }
  return null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
  return res.json();
}

/** Parse Socrata COT rows (newest first) into a snapshot. Exported for tests. */
export function parseCotRows(rows: Record<string, unknown>[], source: string): CotSnapshot | null {
  if (!rows.length) return null;
  const sample = rows[0];
  const dateKey = findKey(sample, [/^report_date_as_yyyy_mm_dd$/, /report_date/i]);
  const longKey = findKey(sample, [/^m_money_positions_long_all$/, /^m_money_positions_long/, /^noncomm_positions_long_all$/, /^noncomm_positions_long/]);
  const shortKey = findKey(sample, [/^m_money_positions_short_all$/, /^m_money_positions_short/, /^noncomm_positions_short_all$/, /^noncomm_positions_short/]);
  const oiKey = findKey(sample, [/^open_interest_all$/, /^open_interest/]);
  if (!longKey || !shortKey) return null;

  const sorted = dateKey
    ? [...rows].sort((a, b) => String(b[dateKey]).localeCompare(String(a[dateKey])))
    : rows;
  const nets = sorted
    .map((r) => {
      const l = num(r[longKey]);
      const s = num(r[shortKey]);
      return l != null && s != null ? l - s : null;
    })
    .filter((n): n is number => n != null);
  if (!nets.length) return null;

  const latest = sorted[0];
  const net = nets[0];
  const prev = nets[1] ?? null;
  const window = nets.slice(0, 52);
  const min = Math.min(...window);
  const max = Math.max(...window);
  const pct = max > min ? Math.round(((net - min) / (max - min)) * 100) : 50;
  const change = prev != null ? net - prev : null;

  // Bias: positioning trend + where it sits in its yearly range.
  // Very stretched long (>90th pct) is treated as crowded -> neutral, not bullish.
  let bias: CotSnapshot['bias'] = 'NEUTRAL';
  if (change != null) {
    if (change > 0 && pct < 90) bias = 'BULLISH';
    else if (change < 0 && pct > 10) bias = 'BEARISH';
  }

  return {
    reportDate: dateKey ? String(latest[dateKey]).slice(0, 10) : 'unknown',
    managedMoneyLong: num(latest[longKey]),
    managedMoneyShort: num(latest[shortKey]),
    managedMoneyNet: net,
    netChangeWeek: change,
    openInterest: oiKey ? num(latest[oiKey]) : null,
    netPercentile52w: pct,
    bias,
    source,
    fetchedAt: new Date().toISOString(),
  };
}

export async function refreshCot(force = false): Promise<CotSnapshot | null> {
  if (!cotCache) cotCache = readJson<CotSnapshot>(COT_CACHE);
  if (!force && cotCache && Date.now() - Date.parse(cotCache.fetchedAt) < COT_REFRESH_MS) return cotCache;

  for (const ds of COT_DATASETS) {
    const base = `https://publicreporting.cftc.gov/resource/${ds.id}.json`;
    const attempts = [
      `${base}?cftc_contract_market_code=${GOLD_CODE}&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=60`,
      `${base}?cftc_contract_market_code=${GOLD_CODE}&$limit=1000`,
    ];
    for (const url of attempts) {
      try {
        const rows = await fetchJson(url);
        if (!Array.isArray(rows) || !rows.length) continue;
        const snap = parseCotRows(rows, `CFTC ${ds.kind} (${ds.id})`);
        if (snap) {
          cotCache = snap;
          cotLastError = null;
          writeJsonAtomic(COT_CACHE, snap);
          return snap;
        }
      } catch (err: any) {
        cotLastError = err?.message || String(err);
      }
    }
  }
  if (cotLastError) console.warn('[SARRAF WHALES] COT refresh failed:', cotLastError);
  return cotCache;
}

export function getCot(): CotSnapshot | null {
  if (!cotCache) cotCache = readJson<CotSnapshot>(COT_CACHE);
  return cotCache;
}

/** Parse an OANDA v20 orderBook / positionBook payload. Exported for tests. */
export function parseOandaBook(payload: any, kind: 'ORDERS' | 'POSITIONS'): OrderBookSnapshot | null {
  const book = payload?.orderBook || payload?.positionBook;
  if (!book || !Array.isArray(book.buckets)) return null;
  const price = num(book.price);
  if (price == null) return null;
  const near = book.buckets
    .map((b: any) => ({
      price: num(b.price) ?? 0,
      longPct: num(b.longCountPercent) ?? 0,
      shortPct: num(b.shortCountPercent) ?? 0,
      kind,
    }))
    .filter((b: any) => b.price > 0 && Math.abs(b.price - price) / price <= 0.02);
  const clusters = near
    .sort((a: any, b: any) => b.longPct + b.shortPct - (a.longPct + a.shortPct))
    .slice(0, 8);
  return {
    time: String(book.time || ''),
    price,
    clusters,
    fetchedAt: new Date().toISOString(),
  };
}

export async function refreshOrderBook(): Promise<OrderBookSnapshot | null> {
  const token = process.env.OANDA_API_TOKEN?.trim();
  if (!token) return null;
  if (obCache && Date.now() - obFetchedAtMs < 10 * 60 * 1000) return obCache;
  const host =
    (process.env.OANDA_ENV || 'practice') === 'live'
      ? 'https://api-fxtrade.oanda.com'
      : 'https://api-fxpractice.oanda.com';
  try {
    const payload = await fetchJson(`${host}/v3/instruments/XAU_USD/orderBook`, {
      Authorization: `Bearer ${token}`,
    });
    const snap = parseOandaBook(payload, 'ORDERS');
    if (snap) {
      obCache = snap;
      obFetchedAtMs = Date.now();
      obLastError = null;
    }
  } catch (err: any) {
    obLastError = err?.message || String(err);
    console.warn('[SARRAF WHALES] OANDA order book failed:', obLastError);
  }
  return obCache;
}

export function getOrderBook(): OrderBookSnapshot | null {
  return obCache;
}

export function getDataSourceStatus() {
  return {
    cot: { ok: Boolean(cotCache), reportDate: cotCache?.reportDate ?? null, error: cotLastError },
    orderBook: {
      enabled: Boolean(process.env.OANDA_API_TOKEN?.trim()),
      ok: Boolean(obCache),
      time: obCache?.time ?? null,
      error: obLastError,
    },
  };
}
