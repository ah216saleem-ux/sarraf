import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useMarket } from '../context/MarketContext';

/* ---------- API types (mirror src/server/sarrafWhales/types.ts) ---------- */
interface WCandle { time: number; open: number; high: number; low: number; close: number; volume: number }
interface Zone {
  id: string; side: 'BUY' | 'SELL'; low: number; high: number; mid: number; score: number;
  sources: string[]; timeframe: string; status: string; distance: number; note: string;
}
interface Plan {
  id: string; createdAt: string; side: 'BUY' | 'SELL' | 'NONE'; zoneId: string | null;
  entryLow: number | null; entryHigh: number | null; sl: number | null; tp1: number | null; tp2: number | null; tp3: number | null;
  slDistance: number | null; rr1: number | null; confidence: number; bias: 'BUY' | 'SELL' | 'NEUTRAL';
  reasoning: string[]; decidedBy: 'AI' | 'RULES'; model: string | null; expiresAt: string;
}
interface Trade {
  id: string; side: 'BUY' | 'SELL'; zoneId: string | null; state: string; entry: number | null; sl: number;
  tp1: number; tp2: number; tp3: number; result: string | null; pnl: number | null; r: number | null;
  openedAt: string | null; closedAt: string | null; createdAt: string;
}
interface Whale { time: string; side: 'BUYER' | 'SELLER'; price: number; kind: string; size: number; atZone: string | null }
interface Stats { total: number; wins: number; losses: number; winRate: number; avgR: number; net: number }
interface Run { id: string; time: string; trigger: string; decidedBy: string; planSide: string; summary: string; error: string | null }
interface WhalesState {
  now: string;
  snapshot: null | {
    price: number; spread: number; marketOpen: boolean; session: string;
    atr: { m5: number; m15: number; h1: number; d1: number };
    trendH1: string; trendH4: string; dayRangeUsed: number;
    candidates: Zone[]; whales: Whale[];
    cot: null | { reportDate: string; managedMoneyNet: number | null; netChangeWeek: number | null; netPercentile52w: number | null; bias: string };
    orderBook: null | { clusters: { price: number; longPct: number; shortPct: number }[] };
    news: { blocked: boolean; reason: string | null; nextHighImpact: null | { title: string; minutesUntil: number } };
  };
  plan: Plan | null;
  activeTrade: Trade | null;
  recentTrades: Trade[];
  stats: { today: Stats; all: Stats };
  runs: Run[];
  memory: string[];
  nextRunAt: string;
  cooldownUntil: string | null;
  health: { feed: string; ai: { configured: boolean; model: string; offline: boolean }; data: { cot: { ok: boolean }; orderBook: { enabled: boolean; ok: boolean } } };
}

type Tf = 'M5' | 'M15' | 'H1' | 'H4';
const TF_SECONDS: Record<Tf, number> = { M5: 300, M15: 900, H1: 3600, H4: 14400 };

const GREEN = '#35d48a';
const RED = '#ff5468';
const AMBER = '#e8b339';

const fmt = (n: number | null | undefined, d = 2) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(d));
const hhmm = (iso: string) => {
  try {
    return new Date(iso).toISOString().slice(11, 16);
  } catch {
    return '';
  }
};

/* ---------------------------------- view ---------------------------------- */
export const SarrafWhalesView: React.FC = () => {
  const { priceData } = useMarket();
  const [tf, setTf] = useState<Tf>('M15');
  const [state, setState] = useState<WhalesState | null>(null);
  const [candles, setCandles] = useState<WCandle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  const loadState = useCallback(async () => {
    try {
      const res = await fetch('/api/sarraf-whales/state', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json());
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    }
  }, []);

  const loadCandles = useCallback(async (which: Tf) => {
    try {
      const res = await fetch(`/api/sarraf-whales/candles?tf=${which}&limit=400`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      setCandles(Array.isArray(data.candles) ? data.candles : []);
    } catch {
      /* keep previous candles */
    }
  }, []);

  useEffect(() => {
    loadState();
    const id = setInterval(loadState, 15000);
    return () => clearInterval(id);
  }, [loadState]);

  useEffect(() => {
    loadCandles(tf);
    const id = setInterval(() => loadCandles(tf), 20000);
    return () => clearInterval(id);
  }, [tf, loadCandles]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const snap = state?.snapshot ?? null;
  const livePrice = priceData?.price && Number.isFinite(priceData.price) ? priceData.price : snap?.price ?? null;
  const zones = snap?.candidates ?? [];
  const sells = zones.filter((z) => z.side === 'SELL').sort((a, b) => a.low - b.low);
  const buys = zones.filter((z) => z.side === 'BUY').sort((a, b) => b.high - a.high);
  const plan = state?.plan ?? null;
  const trade = state?.activeTrade ?? null;

  const biasLine = useMemo(() => {
    if (!snap) return '';
    if (snap.trendH4 === 'UP' && snap.trendH1 !== 'DOWN') return 'Buyers in control';
    if (snap.trendH4 === 'DOWN' && snap.trendH1 !== 'UP') return 'Sellers in control';
    return 'Two-way market';
  }, [snap]);

  const nextRunIn = state ? Math.max(0, Math.round((Date.parse(state.nextRunAt) - nowMs) / 60000)) : null;

  const alerts: { tone: 'amber' | 'red'; text: string }[] = [];
  if (snap?.news.blocked && snap.news.reason) alerts.push({ tone: 'amber', text: snap.news.reason });
  if (state?.cooldownUntil && Date.parse(state.cooldownUntil) > nowMs)
    alerts.push({ tone: 'amber', text: `Cooldown after a loss until ${hhmm(state.cooldownUntil)} UTC — no new entries` });
  if (state?.health.ai.offline) alerts.push({ tone: 'red', text: 'AI OFFLINE — rules engine is planning until AI recovers' });
  if (state?.health.feed !== 'OK' && state) alerts.push({ tone: 'red', text: 'FEED DOWN — new entries paused' });
  for (const z of zones.filter((z) => z.status === 'FAILED').slice(0, 2))
    alerts.push({ tone: 'amber', text: `${z.side} ZONE ${fmt(z.low, 1)}–${fmt(z.high, 1)} FAILED — ignored for 24h` });

  return (
    <div className="space-y-3 text-[#d7e6df] font-mono">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[#0a100e] border border-[#152019]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-sans font-bold tracking-wide text-[#f0f5f2]">SARRAF WHALES</span>
          <span className="flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border" style={{ color: GREEN, borderColor: 'rgba(53,212,138,.35)', background: 'rgba(53,212,138,.08)' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: GREEN }} /> {snap?.marketOpen === false ? 'CLOSED' : 'LIVE'}
          </span>
          <span className="text-2xl font-bold text-[#f0f5f2]">{fmt(livePrice)}</span>
          <span className="text-[11px] text-[#6b7d75]">XAUUSD spot</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <Chip label={state?.health.ai.configured ? (state.health.ai.offline ? 'AI OFFLINE' : `AI ${state.health.ai.model}`) : 'RULES MODE'} tone={state?.health.ai.configured && !state.health.ai.offline ? 'green' : 'amber'} />
          <Chip label={state?.health.data.cot.ok ? 'COT OK' : 'COT —'} tone={state?.health.data.cot.ok ? 'green' : 'gray'} />
          <Chip label={state?.health.data.orderBook.enabled ? (state.health.data.orderBook.ok ? 'ORDER BOOK OK' : 'ORDER BOOK —') : 'ORDER BOOK OFF'} tone={state?.health.data.orderBook.ok ? 'green' : 'gray'} />
          {nextRunIn != null && <span className="text-[#6b7d75]">next AI run ~{nextRunIn}m</span>}
        </div>
      </div>

      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {sells[0] && (
          <span className="px-2.5 py-1 rounded-md border font-semibold" style={{ color: RED, borderColor: 'rgba(255,84,104,.3)', background: 'rgba(255,84,104,.08)' }}>
            SELL ZONE {fmt(sells[0].low, 1)}–{fmt(sells[0].high, 1)}{sells[1] ? ` · next ${fmt(sells[1].low, 1)}` : ''}
          </span>
        )}
        {buys[0] && (
          <span className="px-2.5 py-1 rounded-md border font-semibold" style={{ color: GREEN, borderColor: 'rgba(53,212,138,.3)', background: 'rgba(53,212,138,.08)' }}>
            BUY ZONE {fmt(buys[0].low, 1)}–{fmt(buys[0].high, 1)}{buys[1] ? ` · next ${fmt(buys[1].high, 1)}` : ''}
          </span>
        )}
        {biasLine && <span className="font-semibold" style={{ color: biasLine.startsWith('Buy') ? GREEN : biasLine.startsWith('Sell') ? RED : AMBER }}>{biasLine}</span>}
      </div>

      {alerts.map((a, i) => (
        <div key={i} className="px-3 py-2 rounded-lg border text-[11px]" style={{ color: a.tone === 'red' ? '#ffc2ca' : '#e8d9b0', borderColor: a.tone === 'red' ? 'rgba(255,84,104,.4)' : 'rgba(232,179,57,.35)', background: a.tone === 'red' ? 'rgba(255,84,104,.08)' : 'rgba(232,179,57,.08)' }}>
          ⚠ {a.text}
        </div>
      ))}
      {error && <div className="text-[11px] text-red-300">Connection issue: {error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Chart */}
        <div className="lg:col-span-8 rounded-xl bg-[#0a100e] border border-[#152019] p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex gap-1">
              {(Object.keys(TF_SECONDS) as Tf[]).map((t) => (
                <button key={t} type="button" onClick={() => setTf(t)} className="px-3 py-1 text-[11px] rounded-md border cursor-pointer" style={t === tf ? { color: GREEN, borderColor: GREEN, background: 'rgba(53,212,138,.1)' } : { color: '#9ab5aa', borderColor: '#1c2a24' }}>
                  {t}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-[#56685f]">{zones.length} zones · ATR M15 {fmt(snap?.atr.m15, 1)}</span>
          </div>
          <WhalesChart tf={tf} candles={candles} livePrice={livePrice} zones={zones} plan={plan} trade={trade} />
        </div>

        {/* Right column */}
        <div className="lg:col-span-4 space-y-3">
          <Panel title="NEXT MOVE">
            {snap ? (
              <div className="space-y-1.5 text-[11px] leading-relaxed">
                <p className="text-[#c7d6cf]">Price {fmt(livePrice)} · {snap.session} session · H1 {snap.trendH1} / H4 {snap.trendH4}</p>
                {sells.length > 0 && <p style={{ color: RED }}>▲ Going up, sellers at {sells.slice(0, 3).map((z) => `${fmt(z.low, 0)} (+${fmt(z.low - (livePrice ?? z.low), 0)})`).join(' → ')}</p>}
                {buys.length > 0 && <p style={{ color: GREEN }}>▼ Going down, buyers at {buys.slice(0, 3).map((z) => `${fmt(z.high, 0)} (${fmt(z.high - (livePrice ?? z.high), 0)})`).join(' → ')}</p>}
                {snap.cot && (
                  <p className="text-[#9ab5aa]">
                    Weekly whales (CFTC {snap.cot.reportDate}): funds net {snap.cot.managedMoneyNet?.toLocaleString() ?? '—'}
                    {snap.cot.netChangeWeek != null ? ` (${snap.cot.netChangeWeek > 0 ? '+' : ''}${snap.cot.netChangeWeek.toLocaleString()} w/w)` : ''} · {snap.cot.bias}
                  </p>
                )}
                {snap.news.nextHighImpact && <p className="text-[#e8d9b0]">News: {snap.news.nextHighImpact.title} in {snap.news.nextHighImpact.minutesUntil} min</p>}
              </div>
            ) : (
              <p className="text-[11px] text-[#6b7d75]">Waiting for live data…</p>
            )}
          </Panel>

          <Panel title="LIVE WHALES · last 60 min" scroll>
            {snap?.whales?.length ? (
              snap.whales.map((w, i) => (
                <div key={i} className="flex gap-2 py-1.5 border-t border-[#121b17] text-[11px]">
                  <span className="text-[#56685f] w-10 shrink-0">{hhmm(w.time)}</span>
                  <span style={{ color: w.side === 'BUYER' ? GREEN : RED }}>
                    {w.kind === 'ABSORPTION' ? 'Absorption' : 'Big burst'} {w.side.toLowerCase()} @ {fmt(w.price)} · {fmt(w.size, 1)}x
                    {w.atZone ? ` · at ${w.atZone}` : ''}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-[11px] text-[#6b7d75]">No unusual activity in the last hour.</p>
            )}
          </Panel>

          <Panel title="AI AGENT LOG" scroll>
            {state?.runs?.length ? (
              state.runs.slice(0, 10).map((r) => (
                <div key={r.id} className="py-1.5 border-t border-[#121b17] text-[11px]">
                  <span className="text-[#56685f]">{hhmm(r.time)} · {r.trigger} · {r.decidedBy}</span>
                  <p className="text-[#c7d6cf]">{r.summary}</p>
                  {r.error && <p className="text-[10px] text-red-300">AI error: {r.error}</p>}
                </div>
              ))
            ) : (
              <p className="text-[11px] text-[#6b7d75]">First AI run starts when the market is open.</p>
            )}
          </Panel>
        </div>
      </div>

      {/* AI trade plan */}
      <div className="rounded-xl bg-[#0a100e] border border-[#152019] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold tracking-widest text-[#6b7d75]">AI TRADE PLAN</div>
            <div className="text-[10px] text-[#56685f]">
              {plan ? `${plan.decidedBy === 'AI' ? `AI (${plan.model})` : 'Rules engine'} · ${hhmm(plan.createdAt)} UTC · valid until ${hhmm(plan.expiresAt)} UTC` : 'No plan yet'}
            </div>
          </div>
          {trade && <TradeBadge trade={trade} />}
        </div>
        {plan && plan.side !== 'NONE' ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <Stat label="SIDE" value={plan.side} color={plan.side === 'BUY' ? GREEN : RED} />
            <Stat label="ENTRY ZONE" value={`${fmt(plan.entryLow)} – ${fmt(plan.entryHigh)}`} />
            <Stat label="STOP" value={`${fmt(plan.sl)} ($${fmt(plan.slDistance, 1)})`} color={RED} />
            <Stat label="TP1" value={`${fmt(plan.tp1)} (${fmt(plan.rr1, 1)}R)`} />
            <Stat label="TP2" value={fmt(plan.tp2)} />
            <Stat label="TP3" value={fmt(plan.tp3)} />
            <div>
              <div className="text-[10px] text-[#6b7d75]">CONFIDENCE</div>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-16 h-1.5 rounded bg-[#1c2a24] overflow-hidden">
                  <div className="h-full" style={{ width: `${plan.confidence}%`, background: GREEN }} />
                </div>
                <span className="text-[12px] font-bold text-[#f0f5f2]">{plan.confidence}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[13px] font-bold" style={{ color: AMBER }}>NO TRADE right now</div>
        )}
        {plan?.reasoning?.length ? (
          <ul className="text-[11px] text-[#c7d6cf] space-y-0.5 list-disc pl-4">
            {plan.reasoning.slice(0, 5).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : null}
        <p className="text-[10px] text-[#56685f]">
          Entry only after an M5 rejection candle inside the zone · TP1 closes 50% and moves SL to breakeven · TP2 closes 30% · max 3h per trade · 30 min cooldown after a loss.
        </p>
      </div>

      {/* Results */}
      {state && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat box label="TODAY" value={`${state.stats.today.wins}W / ${state.stats.today.losses}L`} />
          <Stat box label="WIN RATE (ALL)" value={`${state.stats.all.winRate}% of ${state.stats.all.total}`} />
          <Stat box label="AVG R" value={fmt(state.stats.all.avgR)} color={state.stats.all.avgR >= 0 ? GREEN : RED} />
          <Stat box label="NET $ / OZ" value={fmt(state.stats.all.net)} color={state.stats.all.net >= 0 ? GREEN : RED} />
        </div>
      )}

      <p className="text-[10px] text-[#44544c] leading-relaxed">
        Live price via biquote.io. Zones are computed from real candles; the AI only chooses between them. Whale log is estimated from tick
        activity and weekly CFTC data — not a live exchange order book. For information only, not financial advice.
      </p>
    </div>
  );
};

/* ------------------------------- sub-components ------------------------------ */
const Panel: React.FC<{ title: string; scroll?: boolean; children: React.ReactNode }> = ({ title, scroll, children }) => (
  <div className={`rounded-xl bg-[#0a100e] border border-[#152019] p-3 ${scroll ? 'max-h-56 overflow-auto' : ''}`}>
    <div className="text-[10px] font-bold tracking-widest text-[#6b7d75] mb-2">{title}</div>
    {children}
  </div>
);

const Stat: React.FC<{ label: string; value: string; color?: string; box?: boolean }> = ({ label, value, color, box }) => (
  <div className={box ? 'rounded-xl bg-[#0a100e] border border-[#152019] p-3' : ''}>
    <div className="text-[10px] text-[#6b7d75]">{label}</div>
    <div className="text-[13px] font-bold mt-0.5" style={{ color: color || '#f0f5f2' }}>{value}</div>
  </div>
);

const Chip: React.FC<{ label: string; tone: 'green' | 'amber' | 'gray' }> = ({ label, tone }) => {
  const c = tone === 'green' ? GREEN : tone === 'amber' ? AMBER : '#6b7d75';
  return (
    <span className="px-2 py-0.5 rounded border" style={{ color: c, borderColor: `${c}55` }}>
      {label}
    </span>
  );
};

const TradeBadge: React.FC<{ trade: Trade }> = ({ trade }) => {
  const label =
    trade.state === 'WAITING'
      ? 'WAITING FOR ENTRY'
      : trade.state === 'ACTIVE'
      ? `ACTIVE @ ${fmt(trade.entry)}`
      : trade.state === 'TP1'
      ? 'TP1 HIT · SL AT BE'
      : trade.state === 'TP2'
      ? 'TP2 HIT · TRAILING'
      : trade.state;
  const color = trade.state === 'WAITING' ? AMBER : GREEN;
  return (
    <span className="text-[11px] font-bold px-2.5 py-1 rounded-md border" style={{ color, borderColor: `${color}66`, background: `${color}14` }}>
      {trade.side} · {label}
    </span>
  );
};

/* ---------------------------------- chart ---------------------------------- */
const WhalesChart: React.FC<{
  tf: Tf;
  candles: WCandle[];
  livePrice: number | null;
  zones: Zone[];
  plan: Plan | null;
  trade: Trade | null;
}> = ({ tf, candles, livePrice, zones, plan, trade }) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const lastBarRef = useRef<WCandle | null>(null);

  useEffect(() => {
    if (!boxRef.current) return;
    const chart = createChart(boxRef.current, {
      height: 420,
      layout: { background: { type: ColorType.Solid, color: '#0a100e' }, textColor: '#6b7d75', fontSize: 11 },
      grid: { vertLines: { color: '#111a16' }, horzLines: { color: '#111a16' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1c2a24' },
      timeScale: { borderColor: '#1c2a24', timeVisible: true, secondsVisible: false },
    });
    const series = chart.addCandlestickSeries({
      upColor: GREEN,
      downColor: RED,
      borderUpColor: GREEN,
      borderDownColor: RED,
      wickUpColor: GREEN,
      wickDownColor: RED,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) chart.applyOptions({ width: Math.floor(w) });
    });
    ro.observe(boxRef.current);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
    };
  }, []);

  // Full data load
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    const data = candles
      .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close))
      .sort((a, b) => a.time - b.time)
      .map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }));
    const dedup = data.filter((c, i) => i === 0 || c.time !== data[i - 1].time);
    s.setData(dedup);
    lastBarRef.current = candles.length ? { ...candles[candles.length - 1] } : null;
  }, [candles]);

  useEffect(() => {
    chartRef.current?.timeScale().scrollToRealTime();
  }, [tf]);

  // Live tick -> update forming candle so the chart moves like the live market
  useEffect(() => {
    const s = seriesRef.current;
    const last = lastBarRef.current;
    if (!s || !last || livePrice == null) return;
    const period = TF_SECONDS[tf];
    const nowSec = Math.floor(Date.now() / 1000);
    const bucket = Math.floor(nowSec / period) * period;
    let bar: WCandle;
    if (bucket > last.time) {
      bar = { time: bucket, open: last.close, high: Math.max(last.close, livePrice), low: Math.min(last.close, livePrice), close: livePrice, volume: 0 };
    } else {
      bar = { ...last, high: Math.max(last.high, livePrice), low: Math.min(last.low, livePrice), close: livePrice };
    }
    lastBarRef.current = bar;
    try {
      s.update({ time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
    } catch {
      /* out-of-order update after data reload — ignore */
    }
  }, [livePrice, tf]);

  // Zones + plan lines
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    for (const l of linesRef.current) s.removePriceLine(l);
    linesRef.current = [];
    const add = (price: number | null, color: string, title: string, style = LineStyle.Solid, width: 1 | 2 = 1, label = true) => {
      if (price == null || !Number.isFinite(price)) return;
      linesRef.current.push(s.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: label, title }));
    };
    const shown = [
      ...zones.filter((z) => z.side === 'SELL').sort((a, b) => a.low - b.low).slice(0, 4),
      ...zones.filter((z) => z.side === 'BUY').sort((a, b) => b.high - a.high).slice(0, 4),
    ];
    for (const z of shown) {
      const c = z.status === 'FAILED' ? '#5b5b5b' : z.side === 'SELL' ? RED : GREEN;
      const edge = z.side === 'SELL' ? z.low : z.high;
      const far = z.side === 'SELL' ? z.high : z.low;
      add(edge, c, `${z.side} ${z.id} · STR ${z.score}${z.status !== 'FRESH' ? ` · ${z.status}` : ''}`, LineStyle.Solid, z.score >= 60 ? 2 : 1);
      add(far, `${c}88`, '', LineStyle.Dotted, 1, false);
    }
    const p = trade && trade.state !== 'WAITING' ? { side: trade.side, sl: trade.sl, tp1: trade.tp1, tp2: trade.tp2, tp3: trade.tp3, entry: trade.entry } : plan && plan.side !== 'NONE' ? { side: plan.side, sl: plan.sl, tp1: plan.tp1, tp2: plan.tp2, tp3: plan.tp3, entry: null as number | null } : null;
    if (p) {
      add(p.entry, '#f0f5f2', 'ENTRY', LineStyle.Solid, 1);
      add(p.sl, RED, 'SL', LineStyle.Dashed, 1);
      add(p.tp1, AMBER, 'TP1', LineStyle.Dashed, 1);
      add(p.tp2, AMBER, 'TP2', LineStyle.Dashed, 1);
      add(p.tp3, AMBER, 'TP3', LineStyle.Dashed, 1);
    }
  }, [zones, plan, trade]);

  return <div ref={boxRef} className="w-full" style={{ height: 420 }} />;
};

export default SarrafWhalesView;
