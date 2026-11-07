/**
 * SARRAF WHALES — AI agent (Gemini).
 *
 * The agent RESEARCHES the full market snapshot (zones, trend, COT, order book,
 * news, whale bursts, its own lessons and recent results) and then CHOOSES one
 * candidate zone ID or NO_TRADE. It can only answer with IDs that exist
 * (enum in the response schema), so it cannot invent price levels.
 * Code then builds entry / SL / TP and validates them.
 */
import { GoogleGenAI, Type } from '@google/genai';
import { resolveGeminiModel } from '../geminiValidator.ts';
import type { MarketSnapshot, TradePlan, WhaleTrade } from './types.ts';
import { DEFAULT_SETTINGS, biasFrom, draftFromZone, emptyPlan, marketGates, ruleChoice, type PlanSettings } from './planner.ts';

export interface AgentDecision {
  choice: string; // zone id or NO_TRADE
  ranking: string[];
  bias: 'BUY' | 'SELL' | 'NEUTRAL';
  confidence: number;
  reasoning: string[];
  lesson?: string;
}

let client: GoogleGenAI | null = null;
let consecutiveFailures = 0;

export function aiConfigured(): boolean {
  const key = (process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '').trim();
  return Boolean(key && key !== 'MY_GEMINI_API_KEY');
}

function getClient(): GoogleGenAI | null {
  if (!aiConfigured()) return null;
  if (!client) {
    client = new GoogleGenAI({
      apiKey: (process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '').trim(),
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
  }
  return client;
}

export function agentModel(): string {
  return (process.env.WHALES_GEMINI_MODEL || '').trim() || resolveGeminiModel();
}

export function aiHealth() {
  return { configured: aiConfigured(), model: agentModel(), consecutiveFailures, offline: consecutiveFailures >= 3 };
}

const SYSTEM = `You are SARRAF WHALES, a disciplined XAUUSD (spot gold) intraday trade planner.
You receive a research snapshot with a numbered list of CANDIDATE ZONES computed from real candles.
Your job:
1. Study everything: price, ATR, H1/H4 trend, session, weekly CFTC managed-money positioning,
   broker order-book clusters, upcoming news, recent whale bursts, your saved lessons and recent trade results.
2. Pick the ONE candidate zone that gives the best trade right now, or NO_TRADE.
3. Rank all candidates from best to worst.
Rules:
- You may ONLY answer with candidate IDs from the list. Never write prices of your own.
- Code will set entry inside the zone, a stop of about $10-12 beyond it, and targets at opposite zones.
- Prefer zones aligned with the H4 and H1 trend, with several confluent sources and high score.
- BUY zones are below price, SELL zones are above price.
- Avoid zones that are far away (more than ~2x H1 ATR) or marked FAILED.
- Choose NO_TRADE when trends conflict, near high-impact news, when the day range is exhausted,
  or when no zone is clearly good. NO_TRADE is a good answer.
- reasoning: max 5 short English lines a trader can read on a phone.
- lesson: one short reusable lesson if you notice something from recent results, else empty.`;

export function buildPrompt(snap: MarketSnapshot, memory: string[], recentTrades: WhaleTrade[]): string {
  const z = snap.candidates
    .map(
      (c) =>
        `${c.id} | ${c.side} | ${c.low.toFixed(2)}-${c.high.toFixed(2)} | score ${c.score} | ${c.note} | tf ${c.timeframe} | dist $${c.distance.toFixed(1)} | ${c.status}`,
    )
    .join('\n');
  const cot = snap.cot
    ? `report ${snap.cot.reportDate}: managed-money net ${snap.cot.managedMoneyNet}, weekly change ${snap.cot.netChangeWeek}, 52w percentile ${snap.cot.netPercentile52w}, bias ${snap.cot.bias}`
    : 'unavailable';
  const ob = snap.orderBook?.clusters?.length
    ? snap.orderBook.clusters
        .slice(0, 6)
        .map((c) => `${c.price.toFixed(1)} long ${c.longPct.toFixed(2)}% short ${c.shortPct.toFixed(2)}%`)
        .join('; ')
    : 'unavailable';
  const whales = snap.whales.length
    ? snap.whales.slice(0, 6).map((w) => `${w.time.slice(11, 16)} ${w.side} ${w.kind} @${w.price} x${w.size}`).join('; ')
    : 'none';
  const trades = recentTrades.length
    ? recentTrades
        .slice(0, 10)
        .map((t) => `${t.side} ${t.zoneId ?? ''} ${t.result} ${t.r != null ? t.r + 'R' : ''}`)
        .join('; ')
    : 'none yet';
  return `TIME ${snap.time} | SESSION ${snap.session}
PRICE ${snap.price.toFixed(2)} | spread ${snap.spread.toFixed(2)}
ATR m5 ${snap.atr.m5.toFixed(1)} m15 ${snap.atr.m15.toFixed(1)} h1 ${snap.atr.h1.toFixed(1)} d1 ${snap.atr.d1.toFixed(1)}
DAY RANGE USED ${Math.round(snap.dayRangeUsed * 100)}% of average
TREND H1 ${snap.trendH1} | H4 ${snap.trendH4}
COT (weekly whales) ${cot}
ORDER BOOK clusters ${ob}
NEWS ${snap.news.nextHighImpact ? `${snap.news.nextHighImpact.title} in ${snap.news.nextHighImpact.minutesUntil} min` : 'no high-impact USD news soon'}${snap.news.blocked ? ' (BLOCKED)' : ''}
WHALE BURSTS (estimated from tick flow) ${whales}
RECENT RESULTS ${trades}
LESSONS ${memory.length ? memory.slice(-10).join(' | ') : 'none yet'}

CANDIDATE ZONES (id | side | range | score | sources | timeframe | distance | status)
${z || 'none'}`;
}

async function askOnce(ai: GoogleGenAI, prompt: string, ids: string[]): Promise<AgentDecision> {
  const response = await ai.models.generateContent({
    model: agentModel(),
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          choice: { type: Type.STRING, enum: [...ids, 'NO_TRADE'] },
          ranking: { type: Type.ARRAY, items: { type: Type.STRING, enum: ids.length ? ids : ['NONE'] } },
          bias: { type: Type.STRING, enum: ['BUY', 'SELL', 'NEUTRAL'] },
          confidence: { type: Type.INTEGER },
          reasoning: { type: Type.ARRAY, items: { type: Type.STRING } },
          lesson: { type: Type.STRING },
        },
        required: ['choice', 'ranking', 'bias', 'confidence', 'reasoning'],
      },
    },
  });
  const parsed = JSON.parse(response.text || '{}');
  const choice = String(parsed.choice || 'NO_TRADE');
  if (choice !== 'NO_TRADE' && !ids.includes(choice)) throw new Error(`AI returned unknown zone ${choice}`);
  return {
    choice,
    ranking: Array.isArray(parsed.ranking) ? parsed.ranking.filter((x: string) => ids.includes(x)) : [],
    bias: ['BUY', 'SELL', 'NEUTRAL'].includes(parsed.bias) ? parsed.bias : 'NEUTRAL',
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    reasoning: (Array.isArray(parsed.reasoning) ? parsed.reasoning : []).map(String).slice(0, 5),
    lesson: parsed.lesson ? String(parsed.lesson).slice(0, 200) : undefined,
  };
}

/** Majority vote across N calls (WHALES_AI_VOTES, default 1 to keep cost low). */
export async function askAgent(prompt: string, ids: string[]): Promise<AgentDecision> {
  const ai = getClient();
  if (!ai) throw new Error('GEMINI_API_KEY not configured');
  const votes = Math.max(1, Math.min(3, Number(process.env.WHALES_AI_VOTES || 1)));
  const results: AgentDecision[] = [];
  let lastErr: unknown = null;
  for (let i = 0; i < votes; i++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        results.push(await askOnce(ai, prompt, ids));
        break;
      } catch (err) {
        lastErr = err;
      }
    }
  }
  if (!results.length) {
    consecutiveFailures++;
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
  consecutiveFailures = 0;
  const counts = new Map<string, number>();
  for (const r of results) counts.set(r.choice, (counts.get(r.choice) || 0) + 1);
  const [winner] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const best = results.find((r) => r.choice === winner)!;
  // Disagreement between votes lowers confidence.
  const agreement = (counts.get(winner) || 1) / results.length;
  return { ...best, confidence: Math.round(best.confidence * agreement) };
}

/**
 * Full decision: gates -> AI choice -> code validation -> plan.
 * Falls back to deterministic rules when AI is unavailable.
 */
export async function decidePlan(
  snap: MarketSnapshot,
  memory: string[],
  recentTrades: WhaleTrade[],
  settings: PlanSettings = DEFAULT_SETTINGS,
  now = new Date(),
): Promise<{ plan: TradePlan; lesson?: string; error: string | null }> {
  const gates = marketGates(snap, settings);
  if (gates.length) {
    return { plan: emptyPlan(gates, biasFrom(snap), now), error: null };
  }

  const ids = snap.candidates.map((c) => c.id);
  const validFor = (id: string) => {
    const z = snap.candidates.find((c) => c.id === id);
    return z ? draftFromZone(z, snap, settings) : { draft: null, reasons: [`${id} not found`] };
  };
  const expiresAt = new Date(now.getTime() + settings.planValidityMin * 60 * 1000).toISOString();

  let error: string | null = null;
  if (aiConfigured() && ids.length) {
    try {
      const d = await askAgent(buildPrompt(snap, memory, recentTrades), ids);
      const rejected: string[] = [];
      if (d.choice !== 'NO_TRADE') {
        const order = [d.choice, ...d.ranking.filter((id) => id !== d.choice)];
        const chosenSide = snap.candidates.find((c) => c.id === d.choice)?.side;
        for (const id of order) {
          const z = snap.candidates.find((c) => c.id === id);
          if (!z || z.side !== chosenSide) continue;
          const { draft, reasons } = validFor(id);
          if (draft) {
            return {
              plan: {
                id: `P${now.getTime()}`,
                createdAt: now.toISOString(),
                side: draft.side,
                zoneId: draft.zone.id,
                entryLow: draft.entryLow,
                entryHigh: draft.entryHigh,
                sl: draft.sl,
                tp1: draft.tp1,
                tp2: draft.tp2,
                tp3: draft.tp3,
                slDistance: draft.slDistance,
                rr1: draft.rr1,
                confidence: id === d.choice ? d.confidence : Math.round(d.confidence * 0.8),
                bias: d.bias,
                reasoning: id === d.choice ? d.reasoning : [...d.reasoning.slice(0, 4), `${d.choice} failed checks, used ${id}`],
                rankedZoneIds: d.ranking,
                decidedBy: 'AI',
                model: agentModel(),
                rejected,
                expiresAt,
              },
              lesson: d.lesson,
              error: null,
            };
          }
          rejected.push(...reasons);
          if (rejected.length >= 6) break;
        }
      }
      const plan = emptyPlan(
        d.choice === 'NO_TRADE' ? d.reasoning : [...d.reasoning.slice(0, 3), 'Chosen zone failed safety checks — NO TRADE'],
        d.bias,
        now,
      );
      return {
        plan: { ...plan, decidedBy: 'AI', model: agentModel(), rankedZoneIds: d.ranking, rejected, confidence: d.confidence },
        lesson: d.lesson,
        error: null,
      };
    } catch (err: any) {
      error = err?.message || String(err);
    }
  }

  // Rules fallback (AI offline or not configured).
  const r = ruleChoice(snap, settings);
  if (r.draft) {
    const d = r.draft;
    return {
      plan: {
        id: `P${now.getTime()}`,
        createdAt: now.toISOString(),
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
        confidence: Math.min(70, d.zone.score),
        bias: r.bias,
        reasoning: [
          aiConfigured() ? 'AI offline — rules engine picked this zone' : 'Rules engine (add GEMINI_API_KEY for AI)',
          `${d.zone.id} ${d.zone.note} • score ${d.zone.score}`,
          `Trend H1 ${snap.trendH1} / H4 ${snap.trendH4}`,
        ],
        rankedZoneIds: r.ranked,
        decidedBy: 'RULES',
        model: null,
        rejected: r.rejected.slice(0, 6),
        expiresAt,
      },
      error,
    };
  }
  const plan = emptyPlan(['No zone passed the safety checks', ...r.rejected.slice(0, 3)], r.bias, now);
  return { plan: { ...plan, rankedZoneIds: r.ranked }, error };
}

/** Daily self-review: returns up to 3 short lessons from the day's trades. */
export async function reviewDay(trades: WhaleTrade[], plans: TradePlan[]): Promise<string[]> {
  const ai = getClient();
  if (!ai || !trades.length) return [];
  const text = `Today's SARRAF WHALES trades:\n${trades
    .map((t) => `${t.side} zone ${t.zoneId} entry ${t.entry} SL ${t.initialSl} TP1 ${t.tp1} -> ${t.result} ${t.r}R`)
    .join('\n')}\nPlans today: ${plans.length}. Give max 3 short, specific, reusable lessons for tomorrow (no generic advice).`;
  try {
    const res = await ai.models.generateContent({
      model: agentModel(),
      contents: [{ role: 'user', parts: [{ text }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: { type: Type.OBJECT, properties: { lessons: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ['lessons'] },
      },
    });
    const parsed = JSON.parse(res.text || '{}');
    return (parsed.lessons || []).map(String).slice(0, 3);
  } catch (err: any) {
    console.warn('[SARRAF WHALES] daily review failed:', err?.message || err);
    return [];
  }
}
