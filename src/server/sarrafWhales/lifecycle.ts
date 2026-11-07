/**
 * SARRAF WHALES — trade lifecycle (pure state machine).
 *
 * WAITING  -> price must reach the entry zone AND an M5 candle must confirm (rejection close).
 * ACTIVE   -> SL = loss. TP1 = close 50%, SL to breakeven.
 * TP1      -> TP2 = close 30%, SL to TP1.
 * TP2      -> TP3 = close the rest.
 * Max lifetime 3h after entry -> EXPIRED at market.
 * Plan not triggered before armedUntil -> CANCELLED.
 * Price runs through the SL level before entry -> CANCELLED, zone FAILED.
 */
import type { TradePlan, WCandle, WhaleTrade } from './types.ts';
import { round2 } from './candidates.ts';

export const MAX_TRADE_LIFETIME_MS = 3 * 60 * 60 * 1000;

export interface StepEvent {
  type:
    | 'ENTRY'
    | 'TP1'
    | 'TP2'
    | 'TP3'
    | 'SL'
    | 'BE'
    | 'EXPIRED'
    | 'CANCELLED'
    | 'ZONE_FAILED';
  price: number;
  note: string;
}

export function tradeFromPlan(plan: TradePlan, now = new Date()): WhaleTrade | null {
  if (
    plan.side === 'NONE' ||
    plan.sl == null ||
    plan.tp1 == null ||
    plan.tp2 == null ||
    plan.tp3 == null ||
    plan.entryLow == null ||
    plan.entryHigh == null
  ) {
    return null;
  }
  return {
    id: `T${now.getTime()}`,
    planId: plan.id,
    side: plan.side,
    zoneId: plan.zoneId,
    entryLow: plan.entryLow,
    entryHigh: plan.entryHigh,
    state: 'WAITING',
    entry: null,
    sl: plan.sl,
    initialSl: plan.sl,
    tp1: plan.tp1,
    tp2: plan.tp2,
    tp3: plan.tp3,
    openedAt: null,
    closedAt: null,
    result: null,
    pnl: null,
    r: null,
    createdAt: now.toISOString(),
    armedUntil: plan.expiresAt,
  };
}

/** M5 rejection confirmation inside / at the zone. */
export function confirmsEntry(side: 'BUY' | 'SELL', zoneLow: number, zoneHigh: number, c: WCandle): boolean {
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low || 1e-9;
  if (side === 'BUY') {
    const touched = c.low <= zoneHigh;
    const rejected = c.close > c.open && c.close >= zoneLow && (c.close - c.low) / range >= 0.55;
    return touched && rejected && body > 0;
  }
  const touched = c.high >= zoneLow;
  const rejected = c.close < c.open && c.close <= zoneHigh && (c.high - c.close) / range >= 0.55;
  return touched && rejected && body > 0;
}

/**
 * Advance one trade by the latest price (and the latest closed M5 candle for entry confirmation).
 * Returns the updated trade + events. Never mutates the input.
 */
export function stepTrade(
  input: WhaleTrade,
  price: number,
  nowMs: number,
  lastClosedM5: WCandle | null,
  slWindow: { min: number; max: number } = {
    min: Number(process.env.WHALES_SL_MIN || 10),
    max: Number(process.env.WHALES_SL_MAX || 12),
  },
): { trade: WhaleTrade; events: StepEvent[] } {
  const t: WhaleTrade = { ...input };
  const ev: StepEvent[] = [];
  const dir = t.side === 'BUY' ? 1 : -1;
  const hit = (level: number) => (price - level) * dir >= 0; // target reached
  const stopped = (level: number) => (price - level) * dir <= 0; // stop reached
  const nowIso = new Date(nowMs).toISOString();

  const close = (result: WhaleTrade['result'], exitPrice: number, realizedBefore: number, remaining: number) => {
    const entry = t.entry ?? exitPrice;
    const pnl = realizedBefore + remaining * (exitPrice - entry) * dir;
    const risk = Math.abs(entry - t.initialSl) || 1;
    t.state = 'CLOSED';
    t.closedAt = nowIso;
    t.result = result;
    t.pnl = round2(pnl);
    t.r = round2(pnl / risk);
  };

  if (t.state === 'CLOSED') return { trade: t, events: ev };

  if (t.state === 'WAITING') {
    if (stopped(t.initialSl)) {
      t.state = 'CLOSED';
      t.closedAt = nowIso;
      t.result = 'CANCELLED';
      ev.push({ type: 'ZONE_FAILED', price, note: 'Price broke through the zone before entry' });
      return { trade: t, events: ev };
    }
    if (nowMs > Date.parse(t.armedUntil)) {
      t.state = 'CLOSED';
      t.closedAt = nowIso;
      t.result = 'CANCELLED';
      ev.push({ type: 'CANCELLED', price, note: 'Plan expired without entry' });
      return { trade: t, events: ev };
    }
    if (
      lastClosedM5 &&
      lastClosedM5.time * 1000 >= Date.parse(t.createdAt) - 5 * 60 * 1000 &&
      confirmsEntry(t.side, t.entryLow, t.entryHigh, lastClosedM5) &&
      !stopped(t.initialSl) &&
      !hit(t.tp1)
    ) {
      // Keep the real risk inside the $min..$max stop window measured from the actual fill.
      const risk = Math.abs(price - t.initialSl);
      if (risk > slWindow.max) {
        // Filled too far from the stop (top of a BUY zone / bottom of a SELL zone): wait for a better price.
        return { trade: t, events: ev };
      }
      if (risk < slWindow.min) {
        t.sl = round2(price - dir * slWindow.min);
        t.initialSl = t.sl;
      }
      t.state = 'ACTIVE';
      t.entry = round2(price);
      t.openedAt = nowIso;
      ev.push({ type: 'ENTRY', price, note: `M5 rejection confirmed inside zone · risk $${Math.abs(price - t.initialSl).toFixed(1)}` });
    }
    return { trade: t, events: ev };
  }

  const entry = t.entry as number;
  const tp1Realized = 0.5 * (t.tp1 - entry) * dir;
  const tp2Realized = tp1Realized + 0.3 * (t.tp2 - entry) * dir;

  if (t.openedAt && nowMs - Date.parse(t.openedAt) > MAX_TRADE_LIFETIME_MS) {
    const realized = t.state === 'TP1' ? tp1Realized : t.state === 'TP2' ? tp2Realized : 0;
    const remaining = t.state === 'TP1' ? 0.5 : t.state === 'TP2' ? 0.2 : 1;
    close('EXPIRED', price, realized, remaining);
    ev.push({ type: 'EXPIRED', price, note: 'Max 3h lifetime reached' });
    return { trade: t, events: ev };
  }

  if (t.state === 'ACTIVE') {
    if (stopped(t.sl)) {
      close('SL', t.sl, 0, 1);
      ev.push({ type: 'SL', price: t.sl, note: 'Stop loss hit' });
      ev.push({ type: 'ZONE_FAILED', price: t.sl, note: 'Zone failed' });
    } else if (hit(t.tp1)) {
      t.state = 'TP1';
      t.sl = entry;
      ev.push({ type: 'TP1', price: t.tp1, note: 'TP1 hit — 50% closed, SL to breakeven' });
    }
  }
  if (t.state === 'TP1') {
    if (stopped(t.sl)) {
      close('TP1_BE', t.sl, tp1Realized, 0.5);
      ev.push({ type: 'BE', price: t.sl, note: 'Breakeven stop after TP1' });
    } else if (hit(t.tp2)) {
      t.state = 'TP2';
      t.sl = t.tp1;
      ev.push({ type: 'TP2', price: t.tp2, note: 'TP2 hit — 30% closed, SL to TP1' });
    }
  }
  if (t.state === 'TP2') {
    if (stopped(t.sl)) {
      close('TP2_BE', t.sl, tp2Realized, 0.2);
      ev.push({ type: 'BE', price: t.sl, note: 'Trailing stop at TP1 after TP2' });
    } else if (hit(t.tp3)) {
      close('TP3', t.tp3, tp2Realized, 0.2);
      ev.push({ type: 'TP3', price: t.tp3, note: 'TP3 hit — trade complete' });
    }
  }
  return { trade: t, events: ev };
}

export function tradeStats(trades: WhaleTrade[]) {
  const done = trades.filter((t) => t.state === 'CLOSED' && t.result && t.result !== 'CANCELLED');
  const wins = done.filter((t) => (t.pnl ?? 0) > 0);
  const net = done.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const avgR = done.length ? done.reduce((s, t) => s + (t.r ?? 0), 0) / done.length : 0;
  return {
    total: done.length,
    wins: wins.length,
    losses: done.filter((t) => (t.pnl ?? 0) < 0).length,
    winRate: done.length ? Math.round((wins.length / done.length) * 100) : 0,
    avgR: round2(avgR),
    net: round2(net),
  };
}
