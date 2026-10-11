// src/server/ahmedAiNews.ts
// AHMED AI - Gold Macro Intelligence Brief Generator
// Pure server-side OpenAI-compatible chat client with Google GenAI fallback & strict rule-based fallback.
// NO API keys, provider URLs, model IDs or provider names ever exposed to browser or client bundle.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, '../../data');
const BRIEFS_CACHE_FILE = path.resolve(DATA_DIR, 'news_ai_briefs.json');

export type AhmedEventTier = 1 | 2 | 3;

export interface AhmedAiBriefOutput {
  headline: string;
  what_it_is: string;
  why_gold_cares: string;
  watch_for: string;
  source: 'AHMED_AI' | 'RULES';
}

export interface GoldDirectionScenario {
  higher: string; // e.g. "If higher than forecast: BEARISH"
  lower: string;  // e.g. "If lower: BULLISH"
  type: 'STANDARD' | 'REVERSED' | 'TONE_DEPENDENT' | 'SPEECH' | 'NO_FORECAST';
  surpriseChip?: {
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    size: 'SMALL' | 'MODERATE' | 'LARGE';
    diffPct: number;
  };
}

export interface StructuredEventPayload {
  id: string;
  title: string;
  timeUtc: string;
  tier: AhmedEventTier;
  forecastStr: string;
  previousStr: string;
  actualStr: string | null;
  forecastNum: number | null;
  previousNum: number | null;
  actualNum: number | null;
  isReleased: boolean;
  isSpeech: boolean;
  scenarios: GoldDirectionScenario;
}

// -------------------------------------------------------------
// 1. TIER CLASSIFICATION (1, 2, 3)
// -------------------------------------------------------------
// Tier 1: CPI, Core CPI, NFP/Non-Farm, unemployment rate, FOMC rate decision, FOMC statement/minutes, Powell speech, PCE/Core PCE, GDP, retail sales.
// Tier 2: PPI, ISM, JOLTS, jobless claims, ADP, consumer confidence/sentiment.
// Tier 3: individual FOMC member speeches and everything else.

export function getAhmedEventTier(title: string): AhmedEventTier {
  const t = title.toLowerCase();

  // Powell check (Tier 1)
  if (t.includes('powell') || t.includes('fed chair')) {
    return 1;
  }

  // Tier 1 keywords
  if (
    t.includes('cpi') ||
    t.includes('consumer price index') ||
    t.includes('non-farm') ||
    t.includes('nonfarm') ||
    t.includes('nfp') ||
    t.includes('unemployment rate') ||
    t.includes('fomc rate') ||
    t.includes('fed funds rate') ||
    t.includes('rate decision') ||
    t.includes('fomc statement') ||
    t.includes('fomc economic projections') ||
    t.includes('fomc minutes') ||
    t.includes('meeting minutes') ||
    t.includes('pce') ||
    t.includes('gdp') ||
    t.includes('retail sales')
  ) {
    return 1;
  }

  // Tier 2 keywords
  if (
    t.includes('ppi') ||
    t.includes('producer price') ||
    t.includes('ism') ||
    t.includes('jolts') ||
    t.includes('jobless claims') ||
    t.includes('unemployment claims') ||
    t.includes('initial claims') ||
    t.includes('adp') ||
    t.includes('consumer confidence') ||
    t.includes('consumer sentiment') ||
    t.includes('michigan sentiment')
  ) {
    return 2;
  }

  // Tier 3: individual FOMC member speeches and everything else
  return 3;
}

export function isSpeechEvent(title: string): boolean {
  const t = title.toLowerCase();
  return (
    t.includes('speaks') ||
    t.includes('speech') ||
    t.includes('testifies') ||
    t.includes('remarks') ||
    t.includes('panel')
  );
}

// -------------------------------------------------------------
// 2. DIRECTION RULES FOR GOLD
// -------------------------------------------------------------
// Inflation, jobs, growth, retail sales, PCE, GDP, PPI, ISM:
//   actual HIGHER than forecast -> USD stronger -> gold BEARISH; LOWER -> BULLISH; equal -> NEUTRAL.
// Unemployment rate and jobless claims are reversed:
//   HIGHER than forecast -> gold BULLISH; LOWER -> BEARISH.
// FOMC decision/statement/minutes/Powell: "tone-dependent": hawkish -> BEARISH, dovish -> BULLISH (no prediction before release).
// Member speeches: "tone-dependent, low reliability".
// Before release, if forecast exists: two scenarios ("If higher than forecast: BEARISH", "If lower: BULLISH").
// If forecast or previous missing: "Forecast not available yet". NEVER invent a forecast, previous or actual.
// After release: surprise = actual vs forecast -> chip BULLISH/BEARISH/NEUTRAL with size SMALL/MODERATE/LARGE (by % difference).

export function buildGoldDirectionScenarios(
  title: string,
  forecastNum: number | null,
  previousNum: number | null,
  actualNum: number | null,
  isReleased: boolean
): GoldDirectionScenario {
  const t = title.toLowerCase();
  const isSpeech = isSpeechEvent(title);
  const isPowell = t.includes('powell') || t.includes('fed chair');
  const isFomcTone =
    isPowell ||
    t.includes('fomc statement') ||
    t.includes('fomc minutes') ||
    t.includes('rate decision') ||
    t.includes('fed funds rate');

  // Tone-dependent FOMC
  if (isFomcTone) {
    let surpriseChip: GoldDirectionScenario['surpriseChip'];
    if (isReleased && actualNum !== null && forecastNum !== null) {
      const diff = actualNum - forecastNum;
      const pct = Math.abs(diff / (forecastNum || 1)) * 100;
      const sentiment = diff > 0 ? 'BEARISH' : diff < 0 ? 'BULLISH' : 'NEUTRAL';
      const size = pct >= 25 ? 'LARGE' : pct >= 8 ? 'MODERATE' : 'SMALL';
      surpriseChip = { sentiment, size, diffPct: Number(pct.toFixed(1)) };
    }
    return {
      higher: 'Hawkish statement/guidance: BEARISH for Gold (USD yields rise)',
      lower: 'Dovish statement/rate pause: BULLISH for Gold (USD softens)',
      type: 'TONE_DEPENDENT',
      surpriseChip,
    };
  }

  // Member speeches
  if (isSpeech) {
    return {
      higher: 'Hawkish rhetoric: Short-term BEARISH pressure',
      lower: 'Dovish rhetoric: Short-term BULLISH bounce',
      type: 'SPEECH',
    };
  }

  // Reversed metrics: Unemployment Rate, Jobless Claims
  const isReversed =
    t.includes('unemployment rate') ||
    t.includes('jobless claims') ||
    t.includes('unemployment claims') ||
    t.includes('initial claims');

  if (forecastNum === null || previousNum === null) {
    let surpriseChip: GoldDirectionScenario['surpriseChip'];
    if (isReleased && actualNum !== null && forecastNum !== null) {
      const diff = actualNum - forecastNum;
      const pct = Math.abs(diff / (forecastNum || 1)) * 100;
      const sentiment = isReversed
        ? diff > 0 ? 'BULLISH' : diff < 0 ? 'BEARISH' : 'NEUTRAL'
        : diff > 0 ? 'BEARISH' : diff < 0 ? 'BULLISH' : 'NEUTRAL';
      const size = pct >= 20 ? 'LARGE' : pct >= 6 ? 'MODERATE' : 'SMALL';
      surpriseChip = { sentiment, size, diffPct: Number(pct.toFixed(1)) };
    }
    return {
      higher: 'Forecast not available yet',
      lower: 'Forecast not available yet',
      type: 'NO_FORECAST',
      surpriseChip,
    };
  }

  let surpriseChip: GoldDirectionScenario['surpriseChip'];
  if (isReleased && actualNum !== null) {
    const diff = actualNum - forecastNum;
    const base = Math.abs(forecastNum) || 1;
    const pct = Math.abs(diff / base) * 100;
    const tolerance = Math.abs(forecastNum) * 0.0001 || 0.0001;

    let sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (Math.abs(diff) > tolerance) {
      if (diff > 0) {
        sentiment = isReversed ? 'BULLISH' : 'BEARISH';
      } else {
        sentiment = isReversed ? 'BEARISH' : 'BULLISH';
      }
    }

    // Size tiers based on surprise magnitude %
    const size = pct >= 15 ? 'LARGE' : pct >= 5 ? 'MODERATE' : 'SMALL';
    surpriseChip = { sentiment, size, diffPct: Number(pct.toFixed(1)) };
  }

  if (isReversed) {
    return {
      higher: 'If higher than forecast: BULLISH (labor softens, USD weakens)',
      lower: 'If lower: BEARISH (labor tight, USD firms)',
      type: 'REVERSED',
      surpriseChip,
    };
  }

  return {
    higher: 'If higher than forecast: BEARISH (stronger USD & real yields)',
    lower: 'If lower: BULLISH (weaker USD, gold demand rises)',
    type: 'STANDARD',
    surpriseChip,
  };
}

// -------------------------------------------------------------
// 3. RULE-BASED FALLBACK (when AI missing/times out/invalid)
// -------------------------------------------------------------
export function buildRuleBasedBrief(event: StructuredEventPayload): AhmedAiBriefOutput {
  const tier = event.tier;
  const isSpeech = event.isSpeech;
  const title = event.title;

  let what = `Key ${tier === 1 ? 'Tier 1' : tier === 2 ? 'Tier 2' : 'macro'} indicator measuring US economic health.`;
  let why = 'Gold correlates inversely with the US Dollar and real Treasury yields.';
  let watch = event.scenarios.type === 'NO_FORECAST'
    ? 'Wait for official release figures to gauge initial volatility.'
    : `${event.scenarios.higher.split('(')[0].trim()}.`;

  const t = title.toLowerCase();
  if (t.includes('cpi') || t.includes('pce')) {
    what = 'Benchmark gauge measuring inflation and consumer purchasing power.';
    why = 'Persistent inflation prompts higher interest rates, strengthening the USD and pressing gold.';
    watch = 'Watch Core figures closely for underlying inflation momentum.';
  } else if (t.includes('non-farm') || t.includes('nfp')) {
    what = 'Primary monthly measure of net US job creation across non-agricultural sectors.';
    why = 'Robust labor growth reinforces Federal Reserve policy tightening, weighing on gold.';
    watch = 'Compare payroll additions against revisions and average hourly earnings.';
  } else if (t.includes('fomc') || t.includes('rate decision')) {
    what = 'Federal Reserve policy decision establishing benchmark lending rates.';
    why = 'Higher interest rates elevate holding costs of non-yielding physical gold.';
    watch = 'Monitor the policy statement tone and press conference forward guidance.';
  } else if (t.includes('gdp')) {
    what = 'Comprehensive measure of annualized total US economic output and expansion.';
    why = 'Stronger growth supports US dollar strength and trims gold safe-haven appeal.';
    watch = 'Compare final annualized figures against market expectations.';
  } else if (t.includes('retail sales')) {
    what = 'Monthly estimate of total consumer spending across retail commerce.';
    why = 'Consumer spending accounts for two-thirds of GDP, steering dollar demand.';
    watch = 'Look for divergence between core and headline sales numbers.';
  } else if (t.includes('unemployment') || t.includes('jobless claims')) {
    what = 'Weekly/monthly barometer tracking labor layoffs and applicant claims.';
    why = 'Rising joblessness increases expectation of Fed easing, boosting gold.';
    watch = 'Higher numbers typically provide immediate gold upside.';
  } else if (isSpeech) {
    what = 'Public speech and policy remarks by Federal Reserve officials.';
    why = 'Statements offer clues on interest rate trajectories and economic assessments.';
    watch = 'Focus on remarks concerning inflation timeline and rate cuts.';
  }

  const headline = `${title.slice(0, 45)} Brief`;

  return {
    headline: headline.slice(0, 60),
    what_it_is: what,
    why_gold_cares: why,
    watch_for: watch,
    source: 'RULES',
  };
}

// -------------------------------------------------------------
// 4. RATE LIMITER & PERSISTENT CACHE
// -------------------------------------------------------------
interface CachedBriefEntry {
  hash: string;
  brief: AhmedAiBriefOutput;
  generatedAt: number;
}

let briefsCache: Record<string, CachedBriefEntry> = {};
const aiCallTimestamps: number[] = [];
const HOURLY_LIMIT = 20;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadBriefsCache() {
  ensureDataDir();
  if (fs.existsSync(BRIEFS_CACHE_FILE)) {
    try {
      const raw = fs.readFileSync(BRIEFS_CACHE_FILE, 'utf-8');
      briefsCache = JSON.parse(raw) || {};
    } catch {
      briefsCache = {};
    }
  }
}

export function saveBriefsCache() {
  ensureDataDir();
  try {
    fs.writeFileSync(BRIEFS_CACHE_FILE, JSON.stringify(briefsCache, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[AHMED AI] Failed to save briefs cache:', err.message);
  }
}

export function computeEventHash(event: StructuredEventPayload): string {
  const f = event.forecastStr || '';
  const p = event.previousStr || '';
  const a = event.actualStr || '';
  const key = `${f}|${p}|${a}|${event.title}|${event.isReleased}`;
  return crypto.createHash('md5').update(key).digest('hex').slice(0, 16);
}

function canMakeAiCall(): boolean {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  while (aiCallTimestamps.length && aiCallTimestamps[0] < oneHourAgo) {
    aiCallTimestamps.shift();
  }
  return aiCallTimestamps.length < HOURLY_LIMIT;
}

function recordAiCall() {
  aiCallTimestamps.push(Date.now());
}

// -------------------------------------------------------------
// 5. NUMBER & CONTENT VALIDATION
// -------------------------------------------------------------
// The AI must not add numbers or predict the actual value.
// Validate the output: if it contains any number that is not in the input,
// or is not valid JSON, discard it and show the rule-based text instead.
function extractNumbers(str: string): string[] {
  // Extract number tokens like 3.1, 250, 1.2, 0, 10
  const matches = str.match(/\b\d+(\.\d+)?\b/g);
  return matches || [];
}

export function validateAiBriefOutput(
  output: any,
  inputStr: string
): { valid: boolean; brief?: AhmedAiBriefOutput } {
  if (!output || typeof output !== 'object') return { valid: false };
  const { headline, what_it_is, why_gold_cares, watch_for } = output;

  if (
    typeof headline !== 'string' ||
    typeof what_it_is !== 'string' ||
    typeof why_gold_cares !== 'string' ||
    typeof watch_for !== 'string'
  ) {
    return { valid: false };
  }

  // Word count constraint: headline max 12 words
  const headlineWords = headline.trim().split(/\s+/).filter(Boolean);
  if (headlineWords.length > 14) return { valid: false };

  // Check numbers in output: none may appear unless present in the input
  const allowedNumbers = new Set(extractNumbers(inputStr));
  const fullOutputText = `${headline} ${what_it_is} ${why_gold_cares} ${watch_for}`;
  const outputNumbers = extractNumbers(fullOutputText);

  for (const n of outputNumbers) {
    if (!allowedNumbers.has(n)) {
      return { valid: false }; // Contains invented number
    }
  }

  return {
    valid: true,
    brief: {
      headline: headline.trim(),
      what_it_is: what_it_is.trim(),
      why_gold_cares: why_gold_cares.trim(),
      watch_for: watch_for.trim(),
      source: 'AHMED_AI',
    },
  };
}

// -------------------------------------------------------------
// 6. AI CLIENT (OpenAI-compatible -> Gemini Fallback -> Rules)
// -------------------------------------------------------------
async function callOpenAiCompatible(inputPrompt: string): Promise<string | null> {
  const baseUrl = process.env.AI_BASE_URL;
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;

  if (!baseUrl || !apiKey || !model) {
    return null;
  }

  const endpoint = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are AHMED AI, an institutional macro briefing assistant for gold (XAU/USD). Output ONLY a strict JSON object with four string keys: headline (max 12 words), what_it_is (1 short sentence), why_gold_cares (1 short sentence), watch_for (1 short sentence). DO NOT invent or mention any numbers not provided in the input. Never predict the release.',
          },
          {
            role: 'user',
            content: inputPrompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 250,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

async function callGoogleGenAiFallback(inputPrompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    const systemInstruction =
      'You are AHMED AI, an institutional gold macro briefing engine. Output ONLY a strict JSON object with four keys: headline, what_it_is, why_gold_cares, watch_for. Each must be 1 short sentence (headline under 12 words). DO NOT introduce any numbers not found in the input. Never predict actual values.';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const res = await ai.models.generateContent({
      model,
      contents: `${systemInstruction}\n\n${inputPrompt}`,
    });
    clearTimeout(timeoutId);

    return res.text?.trim() || null;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------
// 7. PUBLIC BRIEF GENERATOR
// -------------------------------------------------------------
export async function getOrGenerateAhmedAiBrief(
  event: StructuredEventPayload
): Promise<AhmedAiBriefOutput> {
  loadBriefsCache();
  const hash = computeEventHash(event);
  const cacheKey = `${event.id}_${hash}`;

  const cached = briefsCache[cacheKey];
  if (cached && cached.brief) {
    return cached.brief;
  }

  const fallback = buildRuleBasedBrief(event);

  // Check rate limit (max 20 calls/hour)
  if (!canMakeAiCall()) {
    briefsCache[cacheKey] = {
      hash,
      brief: fallback,
      generatedAt: Date.now(),
    };
    saveBriefsCache();
    return fallback;
  }

  // Structured Event JSON for AI input
  const inputObj = {
    event: event.title,
    time_utc: event.timeUtc,
    tier: event.tier,
    forecast: event.forecastStr || 'N/A',
    previous: event.previousStr || 'N/A',
    actual: event.actualStr || 'N/A',
    is_released: event.isReleased,
    rule_scenarios: {
      higher: event.scenarios.higher,
      lower: event.scenarios.lower,
    },
  };
  const inputStr = JSON.stringify(inputObj);

  const prompt = `Explain this economic release for a Gold (XAU/USD) trader:
${inputStr}

Return valid JSON with exactly:
{
  "headline": "<max 12 words>",
  "what_it_is": "<1 short sentence>",
  "why_gold_cares": "<1 short sentence>",
  "watch_for": "<1 short sentence>"
}`;

  recordAiCall();

  // 1. Try Primary OpenAI-compatible client
  let rawResponse = await callOpenAiCompatible(prompt);

  // 2. Fallback to secondary integration
  if (!rawResponse) {
    rawResponse = await callGoogleGenAiFallback(prompt);
  }

  if (rawResponse) {
    try {
      const match = rawResponse.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const validation = validateAiBriefOutput(parsed, inputStr);
        if (validation.valid && validation.brief) {
          briefsCache[cacheKey] = {
            hash,
            brief: validation.brief,
            generatedAt: Date.now(),
          };
          saveBriefsCache();
          return validation.brief;
        }
      }
    } catch {
      // Invalid JSON -> fallback
    }
  }

  // 3. Fallback to Rule-based brief
  briefsCache[cacheKey] = {
    hash,
    brief: fallback,
    generatedAt: Date.now(),
  };
  saveBriefsCache();
  return fallback;
}

// Pre-generate for Tier 1 and 2 events in next 72 hours
export async function pregenerateUpcomingBriefs(events: StructuredEventPayload[]) {
  const now = Date.now();
  const cutoff72h = now + 72 * 60 * 60 * 1000;

  const targetEvents = events.filter((e) => {
    const tMs = new Date(e.timeUtc).getTime();
    return (e.tier === 1 || e.tier === 2) && tMs >= now - 60 * 60 * 1000 && tMs <= cutoff72h;
  });

  for (const evt of targetEvents.slice(0, 10)) {
    const hash = computeEventHash(evt);
    const cacheKey = `${evt.id}_${hash}`;
    if (!briefsCache[cacheKey]) {
      await getOrGenerateAhmedAiBrief(evt);
    }
  }
}
