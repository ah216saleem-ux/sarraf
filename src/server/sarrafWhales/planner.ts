/**
 * SARRAF WHALES — plan builder + validator (pure).
 * Turns a chosen candidate zone into entry / SL / TP using code only.
 */
import type { CandidateZone, MarketSnapshot, TradePlan } from './types.ts';
import { round2 } from './candidates.ts';

export interface PlanSettings {
  slMin: number; // $ (default 10)
  slMax: number; // $ (default 12)
  minRR: number; // reward:risk for TP1 (default 1.5)
  maxDayRangeUsed: number; // skip if today's range already > x * avg
  planValidityMin: number; // how long the plan stays armed
}

export const DEFAULT_SETTINGS: PlanSettings = {
  slMin: Number(process.env.WHALES_SL_MIN || 10),
  slMax: Number(process.env.WHALES_SL_MAX || 12),
  minRR: 1.5,
  maxDayRangeUsed: 1.3,
  planValidityMin: 120,
};

export interface PlanDraft {
  side: 'BUY' | 'SELL';
  zone: CandidateZone;
  entryLow: number;
  entryHigh: number;
  entryRef: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  slDistance: number;
  rr1: number;
}

/**
 * Build a plan from one zone. Returns either a draft or a list of reasons it was rejected.
 */
export function draftFromZone(
  zone: CandidateZone,
  snap: Pick<MarketSnapshot, 'price' | 'spread' | 'atr' | 'candidates'>,
  s: PlanSettings = DEFAULT_SETTINGS,
): { draft: PlanDraft | null; reasons: string[] } {
  const reasons: string[] = [];
  const side = zone.side;
  const dir = side === 'BUY' ? 1 : -1;
  const spread = Math.max(snap.spread || 0, 0.1);
  const buffer = Math.max(1, spread * 2);

  if (zone.status === 'FAILED') reasons.push(`${zone.id} already failed`);
  if (Math.abs(zone.mid - snap.price) / snap.price > 0.05) reasons.push(`${zone.id} is >5% from price`);
  if (side === 'BUY' && zone.low >= snap.price) reasons.push(`${zone.id} BUY zone is not below price`);
  if (side === 'SELL' && zone.high <= snap.price) reasons.push(`${zone.id} SELL zone is not above price`);
  const atrH1 = snap.atr.h1 || snap.atr.m15 * 2 || 20;
  if (zone.distance > 3 * atrH1) reasons.push(`${zone.id} too far (${zone.distance.toFixed(1)} > 3x H1 ATR)`);

  const entryLow = zone.low;
  const entryHigh = zone.high;
  const entryRef = round2((entryLow + entryHigh) / 2);

  // Structural stop just beyond the zone, then fit it into the $slMin..$slMax window.
  let sl = side === 'BUY' ? entryLow - buffer : entryHigh + buffer;
  let dist = Math.abs(entryRef - sl);
  if (dist < s.slMin) {
    sl = entryRef - dir * s.slMin;
    dist = s.slMin;
  }
  if (dist > s.slMax) {
    reasons.push(`${zone.id} needs ${dist.toFixed(1)}$ stop (> ${s.slMax}$ cap) — NO TRADE`);
  }
  if (spread > 0.25 * s.slMin) reasons.push(`spread ${spread.toFixed(2)} too wide for a ${s.slMin}$ stop`);

  // Targets: nearest opposite zones, but never below minRR.
  const opposite = snap.candidates
    .filter((z) => z.side !== side)
    .map((z) => (side === 'BUY' ? z.low : z.high))
    .filter((p) => (p - entryRef) * dir > 0)
    .sort((a, b) => (a - b) * dir);
  const atR = (r: number) => entryRef + dir * dist * r;
  // Each target is the next opposite zone beyond the previous target (at least +0.5R further),
  // otherwise a fixed R multiple — always strictly increasing in trade direction.
  const further = (a: number, b: number) => ((a - b) * dir > 0 ? a : b);
  const pick = (minR: number, prev: number | null) => {
    const floor = prev == null ? atR(minR) : further(atR(minR), prev + dir * dist);
    const t = opposite.find(
      (p) => (p - entryRef) * dir >= dist * minR && (prev == null || (p - prev) * dir >= dist * 0.5),
    );
    return t ?? floor;
  };
  const tp1 = pick(s.minRR, null);
  const tp2 = pick(2.5, tp1);
  const tp3 = pick(4, tp2);
  const rr1 = Math.abs(tp1 - entryRef) / dist;
  if (rr1 < s.minRR - 1e-9) reasons.push(`R:R ${rr1.toFixed(2)} below ${s.minRR}`);

  if (reasons.length) {
    return { draft: null, reasons };
  }

  return {
    draft: {
      side,
      zone,
      entryLow: round2(entryLow),
      entryHigh: round2(entryHigh),
      entryRef,
      sl: round2(sl),
      tp1: round2(tp1),
      tp2: round2(tp2),
      tp3: round2(tp3),
      slDistance: round2(dist),
      rr1: round2(rr1),
    },
    reasons,
  };
}

/** Market-level gates that block any new plan. */
export function marketGates(
  snap: Pick<MarketSnapshot, 'marketOpen' | 'news' | 'dayRangeUsed'>,
  s: PlanSettings = DEFAULT_SETTINGS,
): string[] {
  const out: string[] = [];
  if (!snap.marketOpen) out.push('Market closed');
  if (snap.news.blocked) out.push(snap.news.reason || 'High-impact news window');
  if (snap.dayRangeUsed > s.maxDayRangeUsed) {
    out.push(`Daily range already ${Math.round(snap.dayRangeUsed * 100)}% of average`);
  }
  return out;
}

export function emptyPlan(reason: string[], bias: TradePlan['bias'], now = new Date()): TradePlan {
  return {
    id: `P${now.getTime()}`,
    createdAt: now.toISOString(),
    side: 'NONE',
    zoneId: null,
    entryLow: null,
    entryHigh: null,
    sl: null,
    tp1: null,
    tp2: null,
    tp3: null,
    slDistance: null,
    rr1: null,
    confidence: 0,
    bias,
    reasoning: reason,
    rankedZoneIds: [],
    decidedBy: 'RULES',
    model: null,
    rejected: [],
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
  };
}

/**
 * Rule-only choice (also the fallback when AI is offline).
 * Picks the highest-scoring zone in the direction of the H1/H4 trend that passes validation.
 */
export function ruleChoice(
  snap: MarketSnapshot,
  s: PlanSettings = DEFAULT_SETTINGS,
): { draft: PlanDraft | null; ranked: string[]; rejected: string[]; bias: TradePlan['bias'] } {
  const bias = biasFrom(snap);
  const ranked = [...snap.candidates]
    .sort((a, b) => b.score - a.score - (a.distance - b.distance) * 0.05)
    .map((z) => z.id);
  const rejected: string[] = [];
  const preferSide = bias === 'NEUTRAL' ? null : bias;
  const ordered = [...snap.candidates].sort((a, b) => {
    const pa = preferSide && a.side === preferSide ? 1 : 0;
    const pb = preferSide && b.side === preferSide ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return b.score - a.score;
  });
  for (const z of ordered) {
    if (preferSide && z.side !== preferSide) continue;
    if (z.score < 35) continue;
    const { draft, reasons } = draftFromZone(z, snap, s);
    if (draft) return { draft, ranked, rejected, bias };
    rejected.push(...reasons);
  }
  return { draft: null, ranked, rejected, bias };
}

export function biasFrom(snap: Pick<MarketSnapshot, 'trendH1' | 'trendH4' | 'cot'>): TradePlan['bias'] {
  let score = 0;
  score += snap.trendH1 === 'UP' ? 1 : snap.trendH1 === 'DOWN' ? -1 : 0;
  score += snap.trendH4 === 'UP' ? 1.5 : snap.trendH4 === 'DOWN' ? -1.5 : 0;
  if (snap.cot) score += snap.cot.bias === 'BULLISH' ? 0.5 : snap.cot.bias === 'BEARISH' ? -0.5 : 0;
  if (score >= 1.5) return 'BUY';
  if (score <= -1.5) return 'SELL';
  return 'NEUTRAL';
}
