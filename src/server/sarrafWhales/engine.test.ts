/**
 * SARRAF WHALES unit tests — run with: npm run test:whales
 */
import assert from 'node:assert/strict';
import { atr, buildCandidates, fairValueGaps, orderBlocks, swingPoints } from './candidates.ts';
import { DEFAULT_SETTINGS, draftFromZone, marketGates, ruleChoice } from './planner.ts';
import { confirmsEntry, stepTrade, tradeFromPlan, tradeStats } from './lifecycle.ts';
import { parseCotRows, parseOandaBook } from './dataSources.ts';
import type { CandidateZone, MarketSnapshot, TradePlan, WCandle } from './types.ts';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

// Deterministic synthetic gold series: wave + trend, ~$4000.
function series(n: number, stepSec: number, start = 4000, amp = 25, seed = 1): WCandle[] {
  let x = seed;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const out: WCandle[] = [];
  let prev = start;
  for (let i = 0; i < n; i++) {
    const base = start + Math.sin(i / 9) * amp + Math.sin(i / 31) * amp * 1.6 + (rnd() - 0.5) * 3;
    const open = prev;
    const close = base;
    const high = Math.max(open, close) + rnd() * 2.5;
    const low = Math.min(open, close) - rnd() * 2.5;
    out.push({ time: 1_790_000_000 + i * stepSec, open, high, low, close, volume: 50 + Math.round(rnd() * 100) });
    prev = close;
  }
  return out;
}

console.log('SARRAF WHALES tests');

const m5 = series(600, 300, 4000, 8, 2);
const m15 = series(400, 900, 4000, 14, 3);
const h1 = series(300, 3600, 4000, 30, 4);
const h4 = series(200, 14400, 4000, 60, 5);
const d1 = series(60, 86400, 4000, 90, 6);
const price = m15[m15.length - 1].close;

test('ATR is positive and sane', () => {
  const a = atr(m15);
  assert.ok(a > 0 && a < 50, `atr=${a}`);
});

test('swing points found', () => {
  const s = swingPoints(h1);
  assert.ok(s.highs.length > 3 && s.lows.length > 3);
});

test('order blocks / FVG detectors return valid ranges', () => {
  for (const l of [...orderBlocks(h1, 'H1', 10), ...fairValueGaps(m15, 'M15', 5)]) {
    assert.ok(l.high > l.low);
  }
});

const candidates = buildCandidates({ price, nowSec: m15[m15.length - 1].time, m5, m15, h1, h4, d1 });

test('candidates on correct side of price with unique ids', () => {
  assert.ok(candidates.length > 0);
  const ids = new Set(candidates.map((c) => c.id));
  assert.equal(ids.size, candidates.length);
  for (const z of candidates) {
    if (z.side === 'BUY') assert.ok(z.high < price, `${z.id} high ${z.high} >= price ${price}`);
    else assert.ok(z.low > price, `${z.id} low ${z.low} <= price ${price}`);
    assert.ok(z.score >= 1 && z.score <= 100);
    assert.ok(/^[BS]\d+$/.test(z.id));
  }
});

const snap: MarketSnapshot = {
  price,
  spread: 0.3,
  time: new Date().toISOString(),
  marketOpen: true,
  atr: { m5: atr(m5), m15: atr(m15), h1: atr(h1), d1: atr(d1) },
  dayRangeUsed: 0.5,
  session: 'LONDON',
  trendH1: 'UP',
  trendH4: 'UP',
  candidates,
  cot: null,
  orderBook: null,
  news: { blocked: false, reason: null, nextHighImpact: null },
  whales: [],
};

const zone = (over: Partial<CandidateZone>): CandidateZone => ({
  id: 'B1',
  side: 'BUY',
  low: 3990,
  high: 3994,
  mid: 3992,
  score: 70,
  sources: ['ORDER_BLOCK'],
  timeframe: 'H1',
  touches: 2,
  status: 'FRESH',
  distance: 6,
  note: 'OB',
  ...over,
});

test('stop is always between $10 and $12', () => {
  const s = { ...snap, price: 4000, candidates: [zone({}), zone({ id: 'S1', side: 'SELL', low: 4040, high: 4044, mid: 4042, distance: 40 })] };
  const { draft, reasons } = draftFromZone(s.candidates[0], s);
  assert.ok(draft, reasons.join('; '));
  assert.ok(draft!.slDistance >= DEFAULT_SETTINGS.slMin && draft!.slDistance <= DEFAULT_SETTINGS.slMax, `sl=${draft!.slDistance}`);
  assert.ok(draft!.sl < draft!.entryLow, 'BUY stop below zone');
  assert.ok(draft!.tp1 > draft!.entryRef && draft!.tp2 >= draft!.tp1 && draft!.tp3 >= draft!.tp2);
  assert.ok(draft!.rr1 >= 1.5);
});

test('wide zone that needs > $12 stop becomes NO TRADE', () => {
  const s = { ...snap, price: 4000, candidates: [] };
  const { draft } = draftFromZone(zone({ low: 3970, high: 3994, mid: 3982 }), s);
  assert.equal(draft, null);
});

test('zone on wrong side is rejected', () => {
  const s = { ...snap, price: 4000, candidates: [] };
  const { draft } = draftFromZone(zone({ low: 4001, high: 4004 }), s);
  assert.equal(draft, null);
});

test('news / closed market / exhausted range gates block plans', () => {
  assert.ok(marketGates({ ...snap, news: { blocked: true, reason: 'NFP', nextHighImpact: null } }).length);
  assert.ok(marketGates({ ...snap, marketOpen: false }).length);
  assert.ok(marketGates({ ...snap, dayRangeUsed: 2 }).length);
  assert.equal(marketGates(snap).length, 0);
});

test('rules fallback returns a valid plan or explains why not', () => {
  const r = ruleChoice(snap);
  if (r.draft) {
    assert.ok(r.draft.slDistance >= 10 && r.draft.slDistance <= 12);
  } else {
    assert.ok(Array.isArray(r.rejected));
  }
});

// ---- lifecycle ----
const plan: TradePlan = {
  id: 'P1',
  createdAt: new Date(0).toISOString(),
  side: 'BUY',
  zoneId: 'B1',
  entryLow: 3990,
  entryHigh: 3994,
  sl: 3981,
  tp1: 4008,
  tp2: 4020,
  tp3: 4040,
  slDistance: 11,
  rr1: 1.6,
  confidence: 70,
  bias: 'BUY',
  reasoning: [],
  rankedZoneIds: [],
  decidedBy: 'RULES',
  model: null,
  rejected: [],
  expiresAt: new Date(2 * 3600 * 1000).toISOString(),
};
const confirmCandle: WCandle = { time: 60, open: 3991, high: 3995, low: 3989.5, close: 3994.5, volume: 100 };

test('M5 rejection candle confirms BUY entry', () => {
  assert.ok(confirmsEntry('BUY', 3990, 3994, confirmCandle));
  assert.ok(!confirmsEntry('BUY', 3990, 3994, { ...confirmCandle, close: 3990.2, open: 3994 }));
});

test('full winning path: entry -> TP1 (BE) -> TP2 -> TP3', () => {
  let t = tradeFromPlan(plan, new Date(0))!;
  let r = stepTrade(t, 3992, 120_000, confirmCandle);
  assert.equal(r.trade.state, 'ACTIVE');
  r = stepTrade(r.trade, 4008.5, 200_000, null);
  assert.equal(r.trade.state, 'TP1');
  assert.equal(r.trade.sl, r.trade.entry);
  r = stepTrade(r.trade, 4021, 300_000, null);
  assert.equal(r.trade.state, 'TP2');
  r = stepTrade(r.trade, 4041, 400_000, null);
  assert.equal(r.trade.result, 'TP3');
  assert.ok((r.trade.pnl ?? 0) > 0);
});

test('losing path: SL hit marks zone failed', () => {
  let t = tradeFromPlan(plan, new Date(0))!;
  let r = stepTrade(t, 3992, 120_000, confirmCandle);
  r = stepTrade(r.trade, 3980, 200_000, null);
  assert.equal(r.trade.result, 'SL');
  assert.ok(r.events.some((e) => e.type === 'ZONE_FAILED'));
  assert.ok((r.trade.r ?? 0) <= -0.99 && (r.trade.r ?? 0) >= -1.01, `r=${r.trade.r}`);
});

test('TP1 then back to entry = breakeven exit, positive pnl', () => {
  let t = tradeFromPlan(plan, new Date(0))!;
  let r = stepTrade(t, 3992, 120_000, confirmCandle);
  r = stepTrade(r.trade, 4009, 200_000, null);
  r = stepTrade(r.trade, 3991.5, 300_000, null);
  assert.equal(r.trade.result, 'TP1_BE');
  assert.ok((r.trade.pnl ?? 0) > 0);
});

test('price breaks zone before entry -> cancelled + zone failed', () => {
  const t = tradeFromPlan(plan, new Date(0))!;
  const r = stepTrade(t, 3979, 100_000, null);
  assert.equal(r.trade.result, 'CANCELLED');
  assert.ok(r.events.some((e) => e.type === 'ZONE_FAILED'));
});

test('entry keeps real risk inside the $10-12 window', () => {
  const t = tradeFromPlan(plan, new Date(0))!;
  // fill at 3994.5 with SL 3981 => 13.5 risk > 12 -> must wait
  const tooFar = stepTrade(t, 3994.5, 120_000, confirmCandle);
  assert.equal(tooFar.trade.state, 'WAITING');
  // fill at 3992 => 11 risk -> enter
  const ok = stepTrade(t, 3992, 120_000, { ...confirmCandle, close: 3993 });
  assert.equal(ok.trade.state, 'ACTIVE');
  // fill at 3990.5 => 9.5 risk -> SL widened to exactly $10
  const tight = stepTrade(t, 3990.5, 120_000, { ...confirmCandle, close: 3993 });
  assert.equal(tight.trade.state, 'ACTIVE');
  assert.equal(Math.round((tight.trade.entry! - tight.trade.sl) * 100) / 100, 10);
});

test('trade expires after 3h', () => {
  let t = tradeFromPlan(plan, new Date(0))!;
  let r = stepTrade(t, 3992, 120_000, confirmCandle);
  r = stepTrade(r.trade, 3998, 120_000 + 3 * 3600 * 1000 + 1000, null);
  assert.equal(r.trade.result, 'EXPIRED');
});

test('stats ignore cancelled trades', () => {
  const s = tradeStats([
    { ...tradeFromPlan(plan)!, state: 'CLOSED', result: 'SL', pnl: -11, r: -1 },
    { ...tradeFromPlan(plan)!, state: 'CLOSED', result: 'TP3', pnl: 25, r: 2.3 },
    { ...tradeFromPlan(plan)!, state: 'CLOSED', result: 'CANCELLED', pnl: null, r: null },
  ]);
  assert.equal(s.total, 2);
  assert.equal(s.winRate, 50);
});

// ---- data parsers ----
test('COT parser handles disaggregated rows (newest first after sort)', () => {
  const rows = [
    { report_date_as_yyyy_mm_dd: '2026-10-20T00:00:00.000', m_money_positions_long_all: '150000', m_money_positions_short_all: '40000', open_interest_all: '400000' },
    { report_date_as_yyyy_mm_dd: '2026-10-27T00:00:00.000', m_money_positions_long_all: '160000', m_money_positions_short_all: '40000', open_interest_all: '410000' },
  ];
  const c = parseCotRows(rows, 'test')!;
  assert.equal(c.reportDate, '2026-10-27');
  assert.equal(c.managedMoneyNet, 120000);
  assert.equal(c.netChangeWeek, 10000);
  assert.equal(c.bias, 'NEUTRAL'); // net at top of its (tiny) range = crowded -> neutral
});

test('COT parser falls back to legacy non-commercial fields', () => {
  const rows = [
    { report_date_as_yyyy_mm_dd: '2026-10-27', noncomm_positions_long_all: '200', noncomm_positions_short_all: '100' },
    { report_date_as_yyyy_mm_dd: '2026-10-20', noncomm_positions_long_all: '300', noncomm_positions_short_all: '100' },
    { report_date_as_yyyy_mm_dd: '2026-10-13', noncomm_positions_long_all: '50', noncomm_positions_short_all: '100' },
  ];
  const c = parseCotRows(rows, 'legacy')!;
  assert.equal(c.managedMoneyNet, 100);
  assert.equal(c.bias, 'BEARISH');
});

test('OANDA order book parser keeps buckets near price', () => {
  const ob = parseOandaBook(
    {
      orderBook: {
        time: '2026-11-07T12:00:00Z',
        price: '4000.0',
        bucketWidth: '5',
        buckets: [
          { price: '3995', longCountPercent: '0.8', shortCountPercent: '0.2' },
          { price: '4005', longCountPercent: '0.1', shortCountPercent: '1.2' },
          { price: '3500', longCountPercent: '5', shortCountPercent: '5' },
        ],
      },
    },
    'ORDERS',
  )!;
  assert.equal(ob.clusters.length, 2);
  assert.equal(ob.clusters[0].price, 4005);
});

console.log(`\n${passed} tests passed`);
