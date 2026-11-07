/**
 * SARRAF WHALES — deterministic candidate zone builder.
 * Pure functions only (no I/O) so they can be unit-tested and backtested.
 */
import type { CandidateZone, WCandle, ZoneSide, ZoneSource } from './types.ts';

export function atr(candles: WCandle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function trendOf(candles: WCandle[], lookback = 50): 'UP' | 'DOWN' | 'RANGE' {
  if (candles.length < 20) return 'RANGE';
  const s = candles.slice(-lookback);
  const ema = (period: number) => {
    const k = 2 / (period + 1);
    let v = s[0].close;
    for (const c of s) v = c.close * k + v * (1 - k);
    return v;
  };
  const fast = ema(9);
  const slow = ema(21);
  const a = atr(s, 14) || 1;
  if (fast - slow > 0.25 * a) return 'UP';
  if (slow - fast > 0.25 * a) return 'DOWN';
  return 'RANGE';
}

interface RawLevel {
  low: number;
  high: number;
  source: ZoneSource;
  tf: string;
  weight: number;
  bornIndex?: number; // index in its own series, for mitigation checks
  series?: WCandle[];
}

export function swingPoints(candles: WCandle[], left = 3, right = 3) {
  const highs: { i: number; price: number }[] = [];
  const lows: { i: number; price: number }[] = [];
  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ i, price: candles[i].high });
    if (isLow) lows.push({ i, price: candles[i].low });
  }
  return { highs, lows };
}

/** Order blocks: last opposite-colour candle before a displacement move. */
export function orderBlocks(candles: WCandle[], tf: string, weight: number): RawLevel[] {
  const out: RawLevel[] = [];
  const a = atr(candles, 14);
  if (!a) return out;
  for (let i = 1; i < candles.length - 3; i++) {
    const c = candles[i];
    const after = candles.slice(i + 1, i + 4);
    const maxUp = Math.max(...after.map((x) => x.high)) - c.high;
    const maxDown = c.low - Math.min(...after.map((x) => x.low));
    const bearish = c.close < c.open;
    const bullish = c.close > c.open;
    if (bearish && maxUp > 1.5 * a && after[after.length - 1].close > c.high) {
      out.push({ low: c.low, high: Math.max(c.open, c.close), source: 'ORDER_BLOCK', tf, weight, bornIndex: i, series: candles });
    }
    if (bullish && maxDown > 1.5 * a && after[after.length - 1].close < c.low) {
      out.push({ low: Math.min(c.open, c.close), high: c.high, source: 'ORDER_BLOCK', tf, weight, bornIndex: i, series: candles });
    }
  }
  return out;
}

/** Fair value gaps (3-candle imbalance). */
export function fairValueGaps(candles: WCandle[], tf: string, weight: number): RawLevel[] {
  const out: RawLevel[] = [];
  const a = atr(candles, 14);
  for (let i = 2; i < candles.length; i++) {
    const c0 = candles[i - 2];
    const c2 = candles[i];
    if (c2.low > c0.high && c2.low - c0.high >= 0.3 * a) {
      out.push({ low: c0.high, high: c2.low, source: 'FVG', tf, weight, bornIndex: i, series: candles });
    }
    if (c2.high < c0.low && c0.low - c2.high >= 0.3 * a) {
      out.push({ low: c2.high, high: c0.low, source: 'FVG', tf, weight, bornIndex: i, series: candles });
    }
  }
  return out;
}

/** Simple tick-volume profile: top nodes in fixed $ bins. */
export function volumeNodes(candles: WCandle[], binSize = 2, top = 3): number[] {
  const bins = new Map<number, number>();
  for (const c of candles) {
    const lo = Math.floor(c.low / binSize);
    const hi = Math.floor(c.high / binSize);
    const n = Math.max(1, hi - lo + 1);
    for (let b = lo; b <= hi; b++) bins.set(b, (bins.get(b) || 0) + (c.volume || 1) / n);
  }
  return [...bins.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, top)
    .map(([b]) => b * binSize + binSize / 2);
}

function utcHour(t: number) {
  return new Date(t * 1000).getUTCHours() + new Date(t * 1000).getUTCMinutes() / 60;
}

export function sessionOf(nowSec: number): 'ASIA' | 'LONDON' | 'NEW_YORK' | 'OFF' {
  const h = utcHour(nowSec);
  if (h >= 0 && h < 7) return 'ASIA';
  if (h >= 7 && h < 12.5) return 'LONDON';
  if (h >= 12.5 && h < 21) return 'NEW_YORK';
  return 'OFF';
}

/** Session highs/lows for the last ~24h from M15 candles. */
export function sessionLevels(m15: WCandle[]): { name: string; high: number; low: number }[] {
  if (!m15.length) return [];
  const last = m15[m15.length - 1].time;
  const dayAgo = last - 24 * 3600;
  const groups: Record<string, WCandle[]> = { ASIA: [], LONDON: [], NEW_YORK: [] };
  for (const c of m15) {
    if (c.time < dayAgo) continue;
    const s = sessionOf(c.time);
    if (s !== 'OFF') groups[s].push(c);
  }
  return Object.entries(groups)
    .filter(([, list]) => list.length >= 4)
    .map(([name, list]) => ({
      name,
      high: Math.max(...list.map((c) => c.high)),
      low: Math.min(...list.map((c) => c.low)),
    }));
}

/** True if any candle after bornIndex closed through the level (zone already used up). */
function isMitigated(l: RawLevel, side: ZoneSide): boolean {
  if (!l.series || l.bornIndex === undefined) return false;
  const after = l.series.slice(l.bornIndex + 1);
  if (side === 'BUY') return after.some((c) => c.close < l.low);
  return after.some((c) => c.close > l.high);
}

export interface BuildInput {
  price: number;
  nowSec: number;
  m5: WCandle[];
  m15: WCandle[];
  h1: WCandle[];
  h4: WCandle[];
  d1: WCandle[];
  extraLevels?: { price: number; source: ZoneSource; weight: number; note?: string }[];
  maxPerSide?: number;
}

const SOURCE_LABEL: Record<ZoneSource, string> = {
  ORDER_BLOCK: 'OB',
  FVG: 'FVG',
  SWING: 'Swing',
  PREV_DAY: 'PDH/PDL',
  SESSION: 'Session',
  ROUND: 'Round',
  VOLUME_NODE: 'Vol node',
  ORDER_BOOK: 'Order book',
};

/**
 * Build ranked candidate zones on both sides of price.
 * Output IDs: B1..Bn (below price, nearest first) and S1..Sn (above price).
 */
export function buildCandidates(input: BuildInput): CandidateZone[] {
  const { price, m5, m15, h1, h4, d1 } = input;
  const maxPerSide = input.maxPerSide ?? 8;
  const atrM15 = atr(m15, 14) || 3;
  const atrD1 = atr(d1, 14) || atrM15 * 10;
  const band = Math.max(0.15 * atrM15, 1);
  const raw: RawLevel[] = [];

  // Structure from higher timeframes counts more.
  raw.push(...orderBlocks(m15.slice(-200), 'M15', 14));
  raw.push(...orderBlocks(h1.slice(-200), 'H1', 20));
  raw.push(...orderBlocks(h4.slice(-150), 'H4', 26));
  raw.push(...fairValueGaps(m15.slice(-120), 'M15', 8));
  raw.push(...fairValueGaps(h1.slice(-120), 'H1', 12));

  for (const [series, tf, w] of [
    [m15.slice(-200), 'M15', 8],
    [h1.slice(-200), 'H1', 12],
    [h4.slice(-150), 'H4', 16],
  ] as const) {
    const { highs, lows } = swingPoints(series as WCandle[], 3, 3);
    for (const s of [...highs, ...lows]) {
      raw.push({ low: s.price - band, high: s.price + band, source: 'SWING', tf, weight: w });
    }
  }

  const prevDay = d1.length ? d1[d1.length - 1] : null;
  if (prevDay) {
    raw.push({ low: prevDay.high - band, high: prevDay.high + band, source: 'PREV_DAY', tf: 'D1', weight: 18 });
    raw.push({ low: prevDay.low - band, high: prevDay.low + band, source: 'PREV_DAY', tf: 'D1', weight: 18 });
  }

  for (const s of sessionLevels(m15)) {
    raw.push({ low: s.high - band, high: s.high + band, source: 'SESSION', tf: s.name, weight: 10 });
    raw.push({ low: s.low - band, high: s.low + band, source: 'SESSION', tf: s.name, weight: 10 });
  }

  const range = 2.5 * atrD1;
  for (let r = Math.ceil((price - range) / 25) * 25; r <= price + range; r += 25) {
    raw.push({ low: r - band, high: r + band, source: 'ROUND', tf: 'ALL', weight: r % 100 === 0 ? 10 : 6 });
  }

  for (const v of volumeNodes(m5.slice(-576), 2, 3)) {
    raw.push({ low: v - 1, high: v + 1, source: 'VOLUME_NODE', tf: 'M5', weight: 9 });
  }

  for (const e of input.extraLevels || []) {
    raw.push({ low: e.price - band, high: e.price + band, source: e.source, tf: 'EXT', weight: e.weight });
  }

  // Assign side, drop levels too far or already mitigated.
  type Sided = RawLevel & { side: ZoneSide };
  const sided: Sided[] = [];
  for (const l of raw) {
    if (!(l.high > l.low)) continue;
    if (l.high - l.low > 1.5 * atrM15 + band * 2) {
      // keep zones tradeable: trim very wide blocks to the edge nearest price
      if (l.low > price) l.high = l.low + 1.5 * atrM15;
      else l.low = l.high - 1.5 * atrM15;
    }
    let side: ZoneSide;
    if (l.high < price) side = 'BUY';
    else if (l.low > price) side = 'SELL';
    else continue; // price inside the level right now: not a fresh candidate
    if (Math.abs((l.low + l.high) / 2 - price) > range) continue;
    if (isMitigated(l, side)) continue;
    sided.push({ ...l, side });
  }

  // Cluster overlapping levels of the same side into zones.
  const zones: CandidateZone[] = [];
  for (const side of ['BUY', 'SELL'] as ZoneSide[]) {
    const list = sided
      .filter((l) => l.side === side)
      .sort((a, b) => a.low - b.low);
    const clusters: Sided[][] = [];
    for (const l of list) {
      const last = clusters[clusters.length - 1];
      if (last) {
        const cHigh = Math.max(...last.map((x) => x.high));
        if (l.low <= cHigh + band * 0.5) {
          last.push(l);
          continue;
        }
      }
      clusters.push([l]);
    }
    for (const cl of clusters) {
      let low = Math.min(...cl.map((x) => x.low));
      let high = Math.max(...cl.map((x) => x.high));
      // Cap zone width so a single zone can still fit inside a $10-12 stop plan.
      const maxWidth = Math.max(4, 0.8 * atrM15);
      if (high - low > maxWidth) {
        if (side === 'BUY') low = high - maxWidth;
        else high = low + maxWidth;
      }
      const sources = [...new Set(cl.map((x) => x.source))];
      const tfs = [...new Set(cl.map((x) => x.tf))];
      const base = cl.reduce((s, x) => s + x.weight, 0);
      const confluenceBonus = (sources.length - 1) * 8;
      const distance = side === 'BUY' ? price - high : low - price;
      const distPenalty = Math.min(20, (distance / (atrD1 || 1)) * 10);
      const score = Math.max(1, Math.min(100, Math.round(base + confluenceBonus - distPenalty)));
      zones.push({
        id: '',
        side,
        low: round2(low),
        high: round2(high),
        mid: round2((low + high) / 2),
        score,
        sources,
        timeframe: tfs.join('+'),
        touches: cl.length,
        status: 'FRESH',
        distance: round2(Math.max(0, distance)),
        note: sources.map((s) => SOURCE_LABEL[s]).join(' + '),
      });
    }
  }

  const buys = zones
    .filter((z) => z.side === 'BUY')
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPerSide)
    .sort((a, b) => a.distance - b.distance);
  const sells = zones
    .filter((z) => z.side === 'SELL')
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPerSide)
    .sort((a, b) => a.distance - b.distance);
  buys.forEach((z, i) => (z.id = `B${i + 1}`));
  sells.forEach((z, i) => (z.id = `S${i + 1}`));
  return [...sells.reverse(), ...buys];
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Stable key so zone status (FAILED/SWEPT) survives re-builds where IDs change. */
export function zoneKey(z: { side: ZoneSide; mid: number }): string {
  return `${z.side}:${Math.round(z.mid)}`;
}
