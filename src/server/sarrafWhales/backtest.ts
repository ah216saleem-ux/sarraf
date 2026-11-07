/**
 * SARRAF WHALES — rules-engine backtest on stored candles.
 *
 *   npm run backtest:whales            (uses DATA_DIR/candles.json)
 *
 * Every H1 close: build candidate zones from data available at that moment,
 * let the rules engine pick a plan, then replay M5 bars through the same
 * lifecycle used live (entry confirmation, $10-12 stop, TP1/TP2/TP3, 3h max).
 * This is the baseline the AI must beat before trusting it with real money.
 */
import { atr, buildCandidates, trendOf } from './candidates.ts';
import { ruleChoice } from './planner.ts';
import { stepTrade, tradeFromPlan, tradeStats } from './lifecycle.ts';
import type { MarketSnapshot, TradePlan, WCandle, WhaleTrade } from './types.ts';

export interface BacktestInput {
  m5: WCandle[];
  m15: WCandle[];
  h1: WCandle[];
  h4: WCandle[];
  d1: WCandle[];
  spread?: number;
}

const upTo = (list: WCandle[], tSec: number, periodSec: number) => list.filter((c) => c.time + periodSec <= tSec);

export function runBacktest(input: BacktestInput) {
  const { m5, m15, h1, h4, d1 } = input;
  const trades: WhaleTrade[] = [];
  let busyUntil = 0;

  for (let i = 60; i < h1.length; i++) {
    const T = h1[i].time + 3600;
    if (T < busyUntil) continue;
    const s5 = upTo(m5, T, 300);
    if (s5.length < 50) continue;
    const s15 = upTo(m15, T, 900);
    const sH1 = h1.slice(0, i + 1);
    const sH4 = upTo(h4, T, 14400);
    const sD1 = upTo(d1, T, 86400);
    const price = s5[s5.length - 1].close;
    const candidates = buildCandidates({ price, nowSec: T, m5: s5, m15: s15, h1: sH1, h4: sH4, d1: sD1 });
    const snap: MarketSnapshot = {
      price,
      spread: input.spread ?? 0.3,
      time: new Date(T * 1000).toISOString(),
      marketOpen: true,
      atr: { m5: atr(s5), m15: atr(s15), h1: atr(sH1), d1: atr(sD1) },
      dayRangeUsed: 0.5,
      session: 'LONDON',
      trendH1: trendOf(sH1),
      trendH4: trendOf(sH4),
      candidates,
      cot: null,
      orderBook: null,
      news: { blocked: false, reason: null, nextHighImpact: null },
      whales: [],
    };
    const r = ruleChoice(snap);
    if (!r.draft) continue;
    const d = r.draft;
    const plan: TradePlan = {
      id: `BT${T}`,
      createdAt: new Date(T * 1000).toISOString(),
      side: d.side,
      zoneId: d.zone.id,
      entryLow: d.entryLow,
      entryHigh: d.entryHigh,
      sl: d.sl,
      tp1: d.tp1,
      tp2: d.tp2,
      tp3: d.tp3,
      slDistance: d.slDistance,
      rr1: d.rr1,
      confidence: d.zone.score,
      bias: r.bias,
      reasoning: [],
      rankedZoneIds: [],
      decidedBy: 'RULES',
      model: null,
      rejected: [],
      expiresAt: new Date((T + 2 * 3600) * 1000).toISOString(),
    };
    let t = tradeFromPlan(plan, new Date(T * 1000));
    if (!t) continue;
    const future = m5.filter((c) => c.time >= T).slice(0, 12 * 6);
    let prevBar: WCandle | null = s5[s5.length - 1];
    for (const bar of future) {
      // Conservative intrabar order: adverse extreme first, then favourable, then close.
      const adverse = t.side === 'BUY' ? bar.low : bar.high;
      const favour = t.side === 'BUY' ? bar.high : bar.low;
      const path = [bar.open, adverse, favour, bar.close];
      for (let k = 0; k < path.length; k++) {
        const nowMs = (bar.time + (k * 300) / 4) * 1000;
        // the confirmation candle is only known once the bar has closed
        const res = stepTrade(t, path[k], nowMs, k === path.length - 1 ? bar : prevBar);
        t = res.trade;
        if (t.state === 'CLOSED') break;
      }
      prevBar = bar;
      if (t.state === 'CLOSED') break;
    }
    if (t.state !== 'CLOSED') continue; // still open at end of data
    if (t.result !== 'CANCELLED') trades.push(t);
    busyUntil = Math.floor(Date.parse(t.closedAt || plan.expiresAt) / 1000);
  }

  return { stats: tradeStats(trades), trades };
}

// CLI
const isMain = (() => {
  try {
    return process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() || '');
  } catch {
    return false;
  }
})();

if (isMain) {
  const { loadCandlesFromDisk, getClosedCandles } = await import('../candleEngine.ts');
  loadCandlesFromDisk();
  const toW = (c: any): WCandle => ({ time: Math.floor(Date.parse(c.openTime) / 1000), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 });
  const get = (tf: 'M5' | 'M15' | 'H1' | 'H4' | 'D1') => getClosedCandles(tf, true).map(toW);
  const input = { m5: get('M5'), m15: get('M15'), h1: get('H1'), h4: get('H4'), d1: get('D1') };
  console.log(`Candles: M5 ${input.m5.length}, M15 ${input.m15.length}, H1 ${input.h1.length}, H4 ${input.h4.length}, D1 ${input.d1.length}`);
  const { stats, trades } = runBacktest(input);
  console.log('Rules-engine baseline:', stats);
  for (const t of trades.slice(-15)) {
    console.log(`${t.openedAt?.slice(0, 16)} ${t.side} entry ${t.entry} SL ${t.initialSl} -> ${t.result} ${t.r}R`);
  }
  process.exit(0);
}
