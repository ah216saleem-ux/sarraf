// src/server/ahmedAiNews.ts
// AHMED AI - Gold Macro Intelligence Brief Generator
// Pure server-side OpenAI-compatible chat client with Google GenAI fallback & strict rule-based fallback.
// NO API keys, provider URLs, model IDs or provider names ever exposed to browser or client bundle.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

import { DATA_DIR } from './deploymentSafety.ts';
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

export interface EventPlaybook {
  what_it_is: string;
  why_gold_cares: string;
  watch_for: string;
}

export function getEventPlaybook(title: string, isSpeech: boolean): EventPlaybook {
  const t = title.toLowerCase();

  // Powell / Fed Chair
  if (t.includes('powell') || t.includes('fed chair')) {
    return {
      what_it_is: 'Public press conference or policy remarks by the Federal Reserve Chair.',
      why_gold_cares: 'Hawkish comments on interest rates lift the US dollar and depress gold; dovish comments propel gold higher.',
      watch_for: 'Listen for signals on the interest rate trajectory, balance sheet policy, and inflation tolerance.',
    };
  }

  // FOMC decision / statement / minutes
  if (t.includes('fomc') || t.includes('rate decision') || t.includes('fed funds rate')) {
    return {
      what_it_is: 'Federal Reserve benchmark rate announcement and policy statement.',
      why_gold_cares: 'Higher interest rates elevate holding costs of non-yielding physical gold, while rate cuts fuel bullion surges.',
      watch_for: 'Hawkish guidance pushes gold down; dovish guidance or rate pauses spark gold rallies.',
    };
  }

  // Core CPI
  if (t.includes('core cpi')) {
    return {
      what_it_is: 'Core consumer price index excluding volatile food and energy components.',
      why_gold_cares: 'Hotter inflation raises rate-hike fears, which lifts the US dollar and usually pushes gold down.',
      watch_for: 'Watch core monthly momentum for signs of entrenched service-sector price pressures.',
    };
  }

  // CPI (Headline)
  if (t.includes('cpi') || t.includes('consumer price')) {
    return {
      what_it_is: 'Consumer price index measuring headline cost of living.',
      why_gold_cares: 'Hotter inflation raises rate-hike fears, which lifts the US dollar and usually pushes gold down.',
      watch_for: 'Hotter prints lift yields and pressure gold; cooler prints spark rapid gold rallies.',
    };
  }

  // PCE / Core PCE (Fed's favourite gauge)
  if (t.includes('pce')) {
    return {
      what_it_is: 'Personal consumption expenditures — the Fed\'s favourite inflation gauge.',
      why_gold_cares: 'Above-target PCE reinforces higher-for-longer policy rates, boosting USD and weighing on gold.',
      watch_for: 'Core PCE is the primary metric steering the Federal Reserve\'s benchmark rate path.',
    };
  }

  // NFP / Non-Farm Payrolls
  if (t.includes('non-farm') || t.includes('nonfarm') || t.includes('nfp')) {
    return {
      what_it_is: 'Total US non-farm payroll jobs added across the economy.',
      why_gold_cares: 'Strong job additions signal economic resilience, bolstering the USD and softening gold appeal.',
      watch_for: 'Compare headline payroll numbers alongside hourly earnings wage inflation.',
    };
  }

  // Unemployment Rate
  if (t.includes('unemployment rate')) {
    return {
      what_it_is: 'Percentage of the total US labor force actively seeking employment.',
      why_gold_cares: 'Higher unemployment flags labor market distress, raising Fed rate-cut odds which rallies gold.',
      watch_for: 'Higher readings are bullish for gold; lower readings reinforce dollar strength and pressure gold.',
    };
  }

  // Jobless Claims
  if (t.includes('jobless claims') || t.includes('unemployment claims') || t.includes('initial claims')) {
    return {
      what_it_is: 'Weekly tally of Americans filing initial unemployment compensation claims.',
      why_gold_cares: 'A surge in claims hints at slowing labor demand, weighing on Treasury yields and supporting gold.',
      watch_for: 'Higher claims numbers typically provide immediate gold upside.',
    };
  }

  // PPI (Producer Price Index)
  if (t.includes('ppi') || t.includes('producer price')) {
    return {
      what_it_is: 'Producer price index measuring wholesale factory-gate price changes.',
      why_gold_cares: 'Higher wholesale pipeline pressures foreshadow consumer inflation, pushing yields up and gold down.',
      watch_for: 'Upstream price increases signal future consumer inflation and pressure gold.',
    };
  }

  // Retail Sales
  if (t.includes('retail sales')) {
    return {
      what_it_is: 'Monthly estimate of total consumer spending across retail stores and online commerce.',
      why_gold_cares: 'Strong retail activity demonstrates robust consumer demand, lifting the dollar and dampening gold.',
      watch_for: 'Divergence between control group core spending and headline figures.',
    };
  }

  // GDP
  if (t.includes('gdp') || t.includes('gross domestic')) {
    return {
      what_it_is: 'Gross domestic product measuring total US economic output and expansion.',
      why_gold_cares: 'Faster economic expansion boosts the US dollar and decreases bullion safe-haven allocation.',
      watch_for: 'Compare annualized growth rates against consensus expectations.',
    };
  }

  // ISM (Manufacturing / Services)
  if (t.includes('ism')) {
    return {
      what_it_is: 'Purchasing managers index evaluating business activity and factory orders.',
      why_gold_cares: 'Expansive readings (>50) reinforce US economic strength, firming yields and dragging gold.',
      watch_for: 'Monitor the prices paid sub-component for underlying inflation cues.',
    };
  }

  // ADP
  if (t.includes('adp')) {
    return {
      what_it_is: 'Private-sector employment change report published ahead of government payrolls.',
      why_gold_cares: 'Private payroll growth suggests firm hiring, supporting USD strength and limiting gold upside.',
      watch_for: 'Check whether private payrolls validate expectations for the upcoming official jobs report.',
    };
  }

  // Speeches
  if (isSpeech || t.includes('speaks') || t.includes('speech') || t.includes('testifies')) {
    return {
      what_it_is: 'Public remarks and economic commentary by a Federal Reserve official.',
      why_gold_cares: 'Hawkish comments about persistent inflation pressure gold, while dovish remarks support bullion.',
      watch_for: 'Tone-dependent guidance; individual speeches carry low lasting duration.',
    };
  }

  // Consumer Confidence / Sentiment
  if (t.includes('consumer confidence') || t.includes('consumer sentiment') || t.includes('michigan')) {
    return {
      what_it_is: 'Survey tracking household sentiment regarding economic conditions and personal finances.',
      why_gold_cares: 'Elevated consumer confidence supports economic spending and dollar strength, weighing on gold.',
      watch_for: 'Long-term inflation expectations embedded within consumer sentiment.',
    };
  }

  // Default Macro Event
  return {
    what_it_is: 'Key macroeconomic release tracking US economic performance.',
    why_gold_cares: 'Stronger US data lifts Treasury yields and the dollar, weighing on non-yielding gold.',
    watch_for: 'Higher prints favour the dollar and pressure gold; lower prints support gold.',
  };
}

export function isNoConsensusEvent(title: string, isSpeech?: boolean): boolean {
  if (isSpeech) return true;
  const t = title.toLowerCase();
  return (
    t.includes('adp weekly') ||
    t.includes('api ') ||
    t.includes('eia') ||
    t.includes('inventor') ||
    t.includes('beige book') ||
    t.includes('speaks') ||
    t.includes('speech') ||
    t.includes('testifies') ||
    t.includes('fomc press conference') ||
    t.includes('fomc minutes')
  );
}

// Pre-News Lean Computation Rule
export interface PreNewsLeanResult {
  lean: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'TONE-DEPENDENT' | 'WAITING' | 'WAITING_FORECAST' | 'NO_CONSENSUS';
  label: string;
  explanation: string;
}

export function computePreNewsLean(
  title: string,
  forecastNum: number | null,
  previousNum: number | null,
  isSpeech: boolean
): PreNewsLeanResult {
  const t = title.toLowerCase();
  const noConsensus = isNoConsensusEvent(title, isSpeech);

  if (forecastNum === null || previousNum === null || noConsensus) {
    if (noConsensus) {
      return {
        lean: 'NO_CONSENSUS',
        label: 'NO LEAN · see playbook',
        explanation: 'No consensus for this event',
      };
    }
    return {
      lean: 'WAITING_FORECAST',
      label: 'WAITING FORECAST',
      explanation: 'Forecast due ~24h before',
    };
  }

  const isReversed =
    t.includes('unemployment rate') ||
    t.includes('jobless claims') ||
    t.includes('unemployment claims') ||
    t.includes('initial claims');

  const diff = forecastNum - previousNum;
  const tolerance = Math.abs(previousNum) * 0.0001 || 0.0001;

  if (Math.abs(diff) <= tolerance) {
    return {
      lean: 'NEUTRAL',
      label: 'LEAN (if as forecast)',
      explanation: 'Forecast equals previous release',
    };
  }

  if (isReversed) {
    // If forecast > previous -> labor cooling -> BULLISH for gold
    if (diff > 0) {
      return {
        lean: 'BULLISH',
        label: 'LEAN (if as forecast)',
        explanation: 'Forecast shows cooling labor (bullish for gold if met)',
      };
    } else {
      return {
        lean: 'BEARISH',
        label: 'LEAN (if as forecast)',
        explanation: 'Forecast shows tightening labor (bearish for gold if met)',
      };
    }
  } else {
    // Standard: CPI, PPI, PCE, GDP, Retail Sales, ISM, etc.
    // If forecast < previous -> cooling inflation/growth -> BULLISH for gold
    if (diff < 0) {
      return {
        lean: 'BULLISH',
        label: 'LEAN (if as forecast)',
        explanation: 'Forecast shows cooling data/inflation (bullish for gold if met)',
      };
    } else {
      return {
        lean: 'BEARISH',
        label: 'LEAN (if as forecast)',
        explanation: 'Forecast shows hotter data/inflation (bearish for gold if met)',
      };
    }
  }
}

// -------------------------------------------------------------
// 3. RULE-BASED FALLBACK (when AI missing/times out/invalid)
// -------------------------------------------------------------
export function buildRuleBasedBrief(event: StructuredEventPayload): AhmedAiBriefOutput {
  const playbook = getEventPlaybook(event.title, event.isSpeech);
  const headline = `${event.title.slice(0, 40)} Playbook`;

  return {
    headline: headline.slice(0, 50),
    what_it_is: playbook.what_it_is,
    why_gold_cares: playbook.why_gold_cares,
    watch_for: playbook.watch_for,
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
let lastAiSuccessTimestamp: number | null = null;
let lastAiCallFailed = false;

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
      const now = Date.now();
      for (const entry of Object.values(briefsCache)) {
        if (entry?.brief?.source === 'AHMED_AI' && entry.generatedAt && (now - entry.generatedAt < 24 * 60 * 60 * 1000)) {
          if (!lastAiSuccessTimestamp || entry.generatedAt > lastAiSuccessTimestamp) {
            lastAiSuccessTimestamp = entry.generatedAt;
          }
        }
      }
    } catch {
      briefsCache = {};
    }
  }
}

export type AhmedAiServerStatus = 'ON' | 'RETRYING' | 'OFF_RULES_MODE';

export function getAhmedAiServerStatus(): AhmedAiServerStatus {
  const hasKey = Boolean(process.env.AI_API_KEY || (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'));
  if (!hasKey) {
    return 'OFF_RULES_MODE';
  }

  if (hasAiSessionSuccess) {
    return 'ON';
  }

  return 'RETRYING';
}

export function isAhmedAiOnline(): boolean {
  return getAhmedAiServerStatus() === 'ON';
}

function markAiSuccess() {
  hasAiSessionSuccess = true;
  lastAiSuccessTimestamp = Date.now();
  lastAiCallFailed = false;
}

function markAiFailure() {
  lastAiCallFailed = true;
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
let hasAiSessionSuccess = false;

function logAiFailureDiagnostic(reason: 'timeout' | 'http 401' | 'http 404' | 'http 429' | 'bad json' | 'network') {
  console.log(`[AHMED AI] Diagnostic failure: ${reason}`);
}

async function callOpenAiCompatible(inputPrompt: string): Promise<string | null> {
  const baseUrl = process.env.AI_BASE_URL || 'https://api.mistral.ai/v1';
  const apiKey = process.env.AI_API_KEY;
  const primaryModel = process.env.AI_MODEL || 'mistral-small-latest';

  if (!apiKey) {
    return null;
  }

  const endpoint = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
  const modelsToTry = [primaryModel];
  if (primaryModel.includes('mistral') && primaryModel !== 'open-mistral-7b') {
    modelsToTry.push('open-mistral-7b', 'mistral-tiny');
  }

  for (const model of modelsToTry) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 12000); // 12s timeout

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
                'You are AHMED AI, a macro briefing assistant for gold (XAU/USD). Output ONLY a strict JSON object with four string keys: headline (max 12 words), what_it_is (1 short sentence), why_gold_cares (1 short sentence), watch_for (1 short sentence). DO NOT invent or mention any numbers not provided in the input. Never predict the release.',
            },
            {
              role: 'user',
              content: inputPrompt,
            },
          ],
          temperature: 0.2,
          max_tokens: 250,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data: any = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (content) {
          markAiSuccess();
          return content;
        } else {
          logAiFailureDiagnostic('bad json');
        }
      } else {
        if (res.status === 401) logAiFailureDiagnostic('http 401');
        else if (res.status === 404) logAiFailureDiagnostic('http 404');
        else if (res.status === 429) logAiFailureDiagnostic('http 429');
        else logAiFailureDiagnostic('network');
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (timedOut || err?.name === 'AbortError') {
        logAiFailureDiagnostic('timeout');
      } else {
        logAiFailureDiagnostic('network');
      }
    }
  }

  return null;
}

async function callGoogleGenAiFallback(inputPrompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    const systemInstruction =
      'You are AHMED AI, an sarraf gold macro briefing engine. Output ONLY a strict JSON object with four keys: headline, what_it_is, why_gold_cares, watch_for. Each must be 1 short sentence (headline under 12 words). DO NOT introduce any numbers not found in the input. Never predict actual values.';

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 12000);

    const res = await ai.models.generateContent({
      model,
      contents: `${systemInstruction}\n\n${inputPrompt}`,
    });
    clearTimeout(timeoutId);

    const text = res.text?.trim() || null;
    if (text) {
      markAiSuccess();
      return text;
    } else {
      logAiFailureDiagnostic('bad json');
    }
    return null;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      logAiFailureDiagnostic('timeout');
    } else {
      logAiFailureDiagnostic('network');
    }
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

  // If AI key is configured but call or validation failed, mark failure for retrying status
  if (process.env.AI_API_KEY || (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY')) {
    markAiFailure();
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

let isPregenerating = false;
let lastPregenerateTime = 0;

// Pre-generate for Tier 1 and 2 events in next 72 hours (max once every 5 minutes)
export async function pregenerateUpcomingBriefs(events: StructuredEventPayload[]) {
  const now = Date.now();
  if (isPregenerating || now - lastPregenerateTime < 5 * 60 * 1000) return;
  isPregenerating = true;
  lastPregenerateTime = now;

  try {
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
  } finally {
    isPregenerating = false;
  }
}

// -------------------------------------------------------------
// 8. AHMED AI STRUCTURED DECISION VOTE
// -------------------------------------------------------------
export interface AhmedAiVoteResult {
  vote: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNAVAILABLE';
  confidence: number;
  reason: string;
}

export async function getAhmedAiVoteForEvent(payload: {
  eventName: string;
  tier: number;
  forecast: string;
  previous: string;
  recentHistory: Array<{
    title: string;
    actual: string;
    forecast: string;
    diff: string;
    move15m?: string;
  }>;
  systemVote: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  otherHighEvents24h: string[];
}): Promise<AhmedAiVoteResult> {
  if (!canMakeAiCall()) {
    return { vote: 'UNAVAILABLE', confidence: 0, reason: 'AI rate limit active' };
  }

  const prompt = `You are evaluating a macro catalyst for Gold (XAU/USD).
Structured facts:
Event: ${payload.eventName} (Tier ${payload.tier})
Forecast: ${payload.forecast} | Previous: ${payload.previous}
System Vote: ${payload.systemVote}
Recent same-metric history:
${JSON.stringify(payload.recentHistory)}
Other High-impact USD events in next 24h:
${payload.otherHighEvents24h.length > 0 ? payload.otherHighEvents24h.join(', ') : 'None'}

Return ONLY a strict JSON object with exactly:
{
  "vote": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": <integer 0 to 100>,
  "reason": "<max 18 words explaining vote based only on provided facts>"
}`;

  recordAiCall();

  let raw = await callOpenAiCompatible(prompt);
  if (!raw) {
    raw = await callGoogleGenAiFallback(prompt);
  }

  if (!raw) {
    return { vote: 'UNAVAILABLE', confidence: 0, reason: 'AI call unavailable' };
  }

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      logAiFailureDiagnostic('bad json');
      return { vote: 'UNAVAILABLE', confidence: 0, reason: 'Invalid JSON response' };
    }
    const parsed = JSON.parse(match[0]);
    const validVote = parsed.vote === 'BULLISH' || parsed.vote === 'BEARISH' || parsed.vote === 'NEUTRAL';
    const conf = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(100, Math.round(parsed.confidence))) : 50;
    const words = typeof parsed.reason === 'string' ? parsed.reason.trim().split(/\s+/).slice(0, 18).join(' ') : 'Structured macro bias.';

    if (!validVote) {
      return { vote: 'UNAVAILABLE', confidence: 0, reason: 'Invalid vote classification' };
    }

    markAiSuccess();
    return {
      vote: parsed.vote,
      confidence: conf,
      reason: words,
    };
  } catch {
    logAiFailureDiagnostic('bad json');
    return { vote: 'UNAVAILABLE', confidence: 0, reason: 'Error parsing decision vote' };
  }
}
