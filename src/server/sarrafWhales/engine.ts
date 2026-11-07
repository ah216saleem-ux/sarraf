/**
 * SARRAF WHALES — 24/7 engine.
 *
 * - Fast watcher (every 30s, pure code): moves the active trade through its lifecycle.
 * - AI agent re-plan: every 60 min, plus immediately on events
 *   (zone failed, trade closed, London/NY open, news released), min 10 min apart.
 * - COT refresh every 6h (data is weekly), OANDA order book every 10 min (if token set).
 * - Daily self-review at 22:00 UTC -> lessons saved and fed to the next AI runs.
 * - All state persisted in DATA_DIR/sarraf_whales_state.json (survives restarts).
 */
import fs from 'fs';
import path from 'path';
import type { Express, Request, Response } from 'express';
import { DATA_DIR, writeJsonAtomic } from '../deploymentSafety.ts';
import { getCandleStore, getClosedCandles, type Candle } from '../candleEngine.ts';
import { getLastValidTick, getMarketSchedule } from '../marketPriceEngine.ts';
import { getNewsEventsForUI } from '../newsEngine.ts';
import { atr, buildCandidates, round2, sessionOf, trendOf, zoneKey } from './candidates.ts';
import { getCot, getDataSourceStatus, getOrderBook, refreshCot, refreshOrderBook } from './dataSources.ts';
import { aiHealth, decidePlan, reviewDay } from './agent.ts';
import { stepTrade, tradeFromPlan, tradeStats } from './lifecycle.ts';
import type {
  AgentRun,
  MarketSnapshot,
  NewsGate,
  WCandle,
  WhaleEvent,
  WhaleTrade,
  WhalesState,
} from './types.ts';

const STATE_FILE = path.resolve(DATA_DIR, 'sarraf_whales_state.json');
const WATCH_MS = 30 * 1000;
const REPLAN_EVERY_MS = Number(process.env.WHALES_REPLAN_MINUTES || 60) * 60 * 1000;
const MIN_GAP_MS = 10 * 60 * 1000;
const COOLDOWN_AFTER_LOSS_MS = 30 * 60 * 1000;
const MAX_TRADES_PER_DAY = 4;
const FAILED_ZONE_TTL_MS = 24 * 60 * 60 * 1000;

let state: WhalesState = loadState();
let lastSnapshot: MarketSnapshot | null = null;
let running = false;
let started = false;
let lastRunAtMs = state.runs[0] ? Date.parse(state.runs[0].time) : 0;
let pendingTrigger: string | null = null;
let lastWatchAtMs = 0;
let lastWatchError: string | null = null;
const firedOnce = new Set<string>();
const startedAtMs = Date.now();

function emptyState(): WhalesState {
  return {
    version: 1,
    plan: null,
    trades: [],
    runs: [],
    memory: [],
    zoneStatus: {},
    cooldownUntil: null,
    lastReviewDate: null,
  };
}

function loadState(): WhalesState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      if (s && s.version === 1) return { ...emptyState(), ...s };
    }
  } catch (err: any) {
    console.warn('[SARRAF WHALES] state load failed, starting fresh:', err?.message || err);
  }
  return emptyState();
}

function saveState() {
  state.trades = state.trades.slice(0, 200);
  state.runs = state.runs.slice(0, 100);
  state.memory = state.memory.slice(-30);
  try {
    writeJsonAtomic(STATE_FILE, state);
  } catch (err: any) {
    console.warn('[SARRAF WHALES] state save failed:', err?.message || err);
  }
}

function toW(c: Candle): WCandle {
  return {
    time: Math.floor(Date.parse(c.openTime) / 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume || 0,
  };
}

type Tf = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';
export function candles(tf: Tf, limit = 500): WCandle[] {
  return getClosedCandles(tf, true).slice(-limit).map(toW);
}

function newsGate(nowMs: number): NewsGate {
  try {
    const events = getNewsEventsForUI()
      .filter((e) => e.isHighImpactUsd && !e.isCancelledOrRemoved && !e.isAllDay)
      .map((e) => ({ e, min: (Date.parse(e.timeUtc) - nowMs) / 60000 }));
    const upcoming = events.filter((x) => x.min > -15).sort((a, b) => a.min - b.min)[0];
    const blocking = events.find((x) => x.min <= 30 && x.min >= -15);
    return {
      blocked: Boolean(blocking),
      reason: blocking
        ? `${blocking.e.title} ${blocking.min >= 0 ? `in ${Math.round(blocking.min)} min` : 'just released'} — no new trades`
        : null,
      nextHighImpact: upcoming
        ? { title: upcoming.e.title, timeUtc: upcoming.e.timeUtc, minutesUntil: Math.round(upcoming.min) }
        : null,
    };
  } catch {
    return { blocked: false, reason: null, nextHighImpact: null };
  }
}

/** Whale-style events estimated from our own M1 tick-volume (NOT exchange order flow). */
export function detectWhales(m1: WCandle[], zones: { id: string; low: number; high: number }[]): WhaleEvent[] {
  if (m1.length < 30) return [];
  const window = m1.slice(-120);
  const avgVol = window.reduce((s, c) => s + (c.volume || 0), 0) / window.length || 1;
  const avgRange = window.reduce((s, c) => s + (c.high - c.low), 0) / window.length || 1;
  const out: WhaleEvent[] = [];
  for (const c of m1.slice(-60)) {
    const vx = (c.volume || 0) / avgVol;
    if (vx < 2.5) continue;
    const range = c.high - c.low;
    const mid = (c.high + c.low) / 2;
    const atZone = zones.find((z) => mid >= z.low - 1 && mid <= z.high + 1)?.id ?? null;
    if (range > 1.5 * avgRange) {
      out.push({
        time: new Date(c.time * 1000).toISOString(),
        side: c.close >= c.open ? 'BUYER' : 'SELLER',
        price: round2(c.close),
        kind: 'BURST',
        size: round2(vx),
        atZone,
      });
    } else if (range < 0.6 * avgRange) {
      // Heavy activity, little movement => someone absorbing. Wick shows who.
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const upperWick = c.high - Math.max(c.open, c.close);
      out.push({
        time: new Date(c.time * 1000).toISOString(),
        side: lowerWick >= upperWick ? 'BUYER' : 'SELLER',
        price: round2(mid),
        kind: 'ABSORPTION',
        size: round2(vx),
        atZone,
      });
    }
  }
  return out.reverse().slice(0, 12);
}

export function buildSnapshot(nowMs = Date.now()): MarketSnapshot | null {
  const tick = getLastValidTick();
  const price = tick?.price;
  if (!price || !Number.isFinite(price)) return null;
  const m1 = candles('M1', 300);
  const m5 = candles('M5', 600);
  const m15 = candles('M15', 400);
  const h1 = candles('H1', 300);
  const h4 = candles('H4', 200);
  const d1 = candles('D1', 60);
  if (m15.length < 30 || h1.length < 20) return null;

  const ob = getOrderBook();
  const extra = (ob?.clusters || [])
    .filter((c) => c.longPct + c.shortPct >= 1.0)
    .map((c) => ({ price: c.price, source: 'ORDER_BOOK' as const, weight: Math.min(15, Math.round((c.longPct + c.shortPct) * 5)) }));

  const candidates = buildCandidates({ price, nowSec: Math.floor(nowMs / 1000), m5, m15, h1, h4, d1, extraLevels: extra });
  // Re-apply remembered statuses (FAILED / SWEPT) across rebuilds.
  for (const z of candidates) {
    const st = state.zoneStatus[zoneKey(z)];
    if (st && nowMs - Date.parse(st.at) < FAILED_ZONE_TTL_MS) z.status = st.status;
  }

  const avgDayRange = d1.length ? d1.slice(-14).reduce((s, c) => s + (c.high - c.low), 0) / Math.min(14, d1.length) : 0;
  const todayRange = tick.high && tick.low ? tick.high - tick.low : 0;
  const atrs = { m5: atr(m5), m15: atr(m15), h1: atr(h1), d1: atr(d1) };

  return {
    price,
    spread: tick.spread || Math.abs((tick.ask || price) - (tick.bid || price)),
    time: new Date(nowMs).toISOString(),
    marketOpen: getMarketSchedule(new Date(nowMs)).isOpen,
    atr: { m5: round2(atrs.m5), m15: round2(atrs.m15), h1: round2(atrs.h1), d1: round2(atrs.d1) },
    dayRangeUsed: avgDayRange ? round2(todayRange / avgDayRange) : 0,
    session: sessionOf(Math.floor(nowMs / 1000)),
    trendH1: trendOf(h1),
    trendH4: trendOf(h4),
    candidates,
    cot: getCot(),
    orderBook: ob,
    news: newsGate(nowMs),
    whales: detectWhales(m1, candidates),
  };
}

function activeTrade(): WhaleTrade | null {
  return state.trades.find((t) => t.state !== 'CLOSED') || null;
}

function tradesToday(nowMs: number): number {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return state.trades.filter((t) => t.openedAt && t.openedAt.slice(0, 10) === day).length;
}

function markZone(trade: WhaleTrade, status: 'FAILED' | 'SWEPT', nowMs: number) {
  const key = zoneKey({ side: trade.side, mid: (trade.entryLow + trade.entryHigh) / 2 });
  state.zoneStatus[key] = { status, at: new Date(nowMs).toISOString() };
  // prune
  for (const [k, v] of Object.entries(state.zoneStatus)) {
    if (nowMs - Date.parse(v.at) > FAILED_ZONE_TTL_MS) delete state.zoneStatus[k];
  }
}

export async function runAgent(trigger: string, nowMs = Date.now()): Promise<AgentRun | null> {
  if (running) return null;
  running = true;
  const t0 = Date.now();
  try {
    const snap = buildSnapshot(nowMs);
    lastSnapshot = snap;
    if (!snap) {
      return null;
    }
    const recent = state.trades.filter((t) => t.state === 'CLOSED' && t.result !== 'CANCELLED');
    let { plan, lesson, error } = await decidePlan(snap, state.memory, recent, undefined, new Date(nowMs));

    // Account-level gates that the planner does not know about.
    const cooldown = Boolean(state.cooldownUntil && nowMs < Date.parse(state.cooldownUntil));
    const current = activeTrade();
    const tradeRunning = Boolean(current && current.state !== 'WAITING');
    if (plan.side !== 'NONE' && (cooldown || tradesToday(nowMs) >= MAX_TRADES_PER_DAY || tradeRunning)) {
      const why = cooldown
        ? 'Cooldown after a loss — plan shown, no new entry'
        : tradesToday(nowMs) >= MAX_TRADES_PER_DAY
        ? `Max ${MAX_TRADES_PER_DAY} trades today reached`
        : 'A trade is already running';
      plan = { ...plan, reasoning: [...plan.reasoning.slice(0, 4), why] };
    } else {
      // Replace a waiting (not yet entered) trade with the new plan.
      const waiting = current;
      if (waiting && waiting.state === 'WAITING') {
        waiting.state = 'CLOSED';
        waiting.result = 'CANCELLED';
        waiting.closedAt = new Date(nowMs).toISOString();
      }
      const trade = tradeFromPlan(plan, new Date(nowMs));
      if (trade) state.trades.unshift(trade);
    }

    state.plan = plan;
    if (lesson) state.memory.push(`${new Date(nowMs).toISOString().slice(0, 10)}: ${lesson}`);
    const run: AgentRun = {
      id: `R${nowMs}`,
      time: new Date(nowMs).toISOString(),
      trigger,
      decidedBy: plan.decidedBy,
      planSide: plan.side,
      zoneId: plan.zoneId,
      confidence: plan.confidence,
      candidateCount: snap.candidates.length,
      latencyMs: Date.now() - t0,
      error,
      summary:
        plan.side === 'NONE'
          ? `NO TRADE — ${plan.reasoning[0] || ''}`.slice(0, 140)
          : `${plan.side} ${plan.zoneId} ${plan.entryLow}-${plan.entryHigh} SL ${plan.sl} TP1 ${plan.tp1}`,
    };
    state.runs.unshift(run);
    lastRunAtMs = nowMs;
    saveState();
    console.log(`[SARRAF WHALES] agent run (${trigger}): ${run.summary}${error ? ` [AI error: ${error}]` : ''}`);
    return run;
  } catch (err: any) {
    console.warn('[SARRAF WHALES] agent run failed:', err?.message || err);
    return null;
  } finally {
    running = false;
  }
}

function requestRun(trigger: string) {
  if (!pendingTrigger) pendingTrigger = trigger;
}

async function watch() {
  const nowMs = Date.now();
  lastWatchAtMs = nowMs;
  const tick = getLastValidTick();
  const price = tick?.price;
  const schedule = getMarketSchedule(new Date(nowMs));
  const feedAgeMs = tick?.lastReceivedAt ? nowMs - tick.lastReceivedAt : Infinity;

  // 1) Advance the trade.
  const trade = activeTrade();
  if (trade && price && feedAgeMs < 5 * 60 * 1000) {
    const m5 = candles('M5', 3);
    const { trade: next, events } = stepTrade(trade, price, nowMs, m5[m5.length - 1] || null);
    if (events.length) {
      Object.assign(trade, next);
      for (const e of events) console.log(`[SARRAF WHALES] ${e.type} @ ${e.price} — ${e.note}`);
      if (events.some((e) => e.type === 'ZONE_FAILED')) {
        markZone(trade, 'FAILED', nowMs);
        requestRun('zone failed');
      }
      if (next.result === 'SL') state.cooldownUntil = new Date(nowMs + COOLDOWN_AFTER_LOSS_MS).toISOString();
      if (next.state === 'CLOSED' && next.result !== 'CANCELLED') requestRun('trade closed');
      if (next.result === 'CANCELLED' && !events.some((e) => e.type === 'ZONE_FAILED')) requestRun('plan expired');
      saveState();
    }
  }

  if (!schedule.isOpen) return;

  // 2) Event triggers.
  const d = new Date(nowMs);
  const hm = d.getUTCHours() * 60 + d.getUTCMinutes();
  const dayKey = d.toISOString().slice(0, 10);
  const fire = (key: string, label: string) => {
    if (!firedOnce.has(`${dayKey}:${key}`)) {
      firedOnce.add(`${dayKey}:${key}`);
      requestRun(label);
    }
  };
  if (hm >= 7 * 60 && hm < 7 * 60 + 5) fire('london', 'London open');
  if (hm >= 13 * 60 + 30 && hm < 13 * 60 + 35) fire('ny', 'New York open');
  const gate = newsGate(nowMs);
  if (gate.nextHighImpact && gate.nextHighImpact.minutesUntil <= -15 && gate.nextHighImpact.minutesUntil > -20) {
    fire(`news:${gate.nextHighImpact.timeUtc}`, `after news: ${gate.nextHighImpact.title}`);
  }
  if (!state.plan || nowMs - lastRunAtMs >= REPLAN_EVERY_MS) requestRun('hourly');
  if (state.plan && nowMs > Date.parse(state.plan.expiresAt) && !activeTrade()) requestRun('plan expired');

  // 3) Run if due (respect minimum gap).
  if (pendingTrigger && nowMs - lastRunAtMs >= MIN_GAP_MS && feedAgeMs < 5 * 60 * 1000) {
    const trig = pendingTrigger;
    pendingTrigger = null;
    await runAgent(trig, nowMs);
  }

  // 4) Daily self-review at 22:00 UTC.
  if (hm >= 22 * 60 && state.lastReviewDate !== dayKey) {
    state.lastReviewDate = dayKey;
    const today = state.trades.filter((t) => t.closedAt?.slice(0, 10) === dayKey && t.result !== 'CANCELLED');
    const lessons = await reviewDay(today, state.plan ? [state.plan] : []);
    for (const l of lessons) state.memory.push(`${dayKey}: ${l}`);
    saveState();
  }
}

export function startSarrafWhalesEngine() {
  if (started) return;
  started = true;
  const safe = (fn: () => Promise<unknown> | unknown, label: string) => async () => {
    try {
      await fn();
      if (label === 'watch') lastWatchError = null;
    } catch (err: any) {
      if (label === 'watch') lastWatchError = err?.message || String(err);
      console.warn(`[SARRAF WHALES] ${label} error:`, err?.message || err);
    }
  };
  setInterval(safe(watch, 'watch'), WATCH_MS);
  setInterval(safe(() => refreshCot(), 'cot'), 6 * 60 * 60 * 1000);
  setInterval(safe(() => refreshOrderBook(), 'orderbook'), 10 * 60 * 1000);
  setTimeout(safe(() => refreshCot(), 'cot'), 20 * 1000);
  setTimeout(safe(() => refreshOrderBook(), 'orderbook'), 25 * 1000);
  console.log('[SARRAF WHALES] engine started (watch 30s, AI re-plan 60m + events)');
}

function publicState() {
  const nowMs = Date.now();
  const snap = buildSnapshot(nowMs) || lastSnapshot;
  if (snap) lastSnapshot = snap;
  const trade = activeTrade();
  const closed = state.trades.filter((t) => t.state === 'CLOSED');
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return {
    now: new Date(nowMs).toISOString(),
    snapshot: snap,
    plan: state.plan,
    activeTrade: trade,
    recentTrades: closed.slice(0, 20),
    stats: { today: tradeStats(closed.filter((t) => t.closedAt?.slice(0, 10) === day)), all: tradeStats(closed) },
    runs: state.runs.slice(0, 20),
    memory: state.memory.slice(-10),
    nextRunAt: new Date(Math.max(lastRunAtMs + REPLAN_EVERY_MS, nowMs)).toISOString(),
    cooldownUntil: state.cooldownUntil,
    health: health(),
  };
}

export function health() {
  const tick = getLastValidTick();
  const nowMs = Date.now();
  return {
    uptimeSec: Math.round((nowMs - startedAtMs) / 1000),
    engineStarted: started,
    lastWatchAgeSec: lastWatchAtMs ? Math.round((nowMs - lastWatchAtMs) / 1000) : null,
    lastWatchError,
    lastTickAgeSec: tick?.lastReceivedAt ? Math.round((nowMs - tick.lastReceivedAt) / 1000) : null,
    feed: tick?.lastReceivedAt && nowMs - tick.lastReceivedAt < 5 * 60 * 1000 ? 'OK' : 'FEED DOWN',
    lastAgentRun: state.runs[0]?.time ?? null,
    ai: aiHealth(),
    data: getDataSourceStatus(),
    activeTrade: activeTrade()?.state ?? null,
  };
}

function adminOk(req: Request): boolean {
  const token = (process.env.ADMIN_TOKEN || '').trim();
  return Boolean(token) && req.header('x-admin-token') === token;
}

export function registerSarrafWhalesRoutes(app: Express) {
  app.get('/api/sarraf-whales/state', (_req: Request, res: Response) => {
    try {
      res.json(publicState());
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'state error' });
    }
  });

  app.get('/api/sarraf-whales/candles', (req: Request, res: Response) => {
    const tf = String(req.query.tf || 'M15').toUpperCase() as Tf;
    const allowed: Tf[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
    if (!allowed.includes(tf)) return res.status(400).json({ error: 'bad tf' });
    const limit = Math.min(1000, Math.max(50, Number(req.query.limit) || 300));
    // include the forming candle so the chart looks live
    const all = getCandleStore()[tf] || [];
    res.json({ tf, candles: all.slice(-limit).map(toW) });
  });

  app.get('/api/sarraf-whales/health', (_req: Request, res: Response) => res.json(health()));

  app.post('/api/sarraf-whales/replan', async (req: Request, res: Response) => {
    if (!adminOk(req)) return res.status(403).json({ error: 'admin token required' });
    const run = await runAgent('manual');
    res.json({ ok: Boolean(run), run });
  });

  app.post('/api/sarraf-whales/refresh-data', async (req: Request, res: Response) => {
    if (!adminOk(req)) return res.status(403).json({ error: 'admin token required' });
    const [cot, ob] = await Promise.all([refreshCot(true), refreshOrderBook()]);
    res.json({ cot, orderBook: ob, status: getDataSourceStatus() });
  });
}
