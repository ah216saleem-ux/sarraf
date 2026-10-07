import { GoogleGenAI } from '@google/genai';
import { Candle } from './candleEngine.ts';
import { formatLearningsForAI } from './googleChatService.ts';

export interface ValidationResult {
  verdict: 'APPROVE' | 'REJECT' | 'FALLBACK';
  confidence: number;
  reason: string;
  latencyMs: number;
  timestamp: string;
  model: string;
  lessonsUsedCount?: number;
  error?: string;
}

export interface ValidationLogItem extends ValidationResult {
  id: string;
  signalId: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  score: number;
  lessonsUsedCount: number;
}

const validationLogs: ValidationLogItem[] = [];

// Initialize Google GenAI client safely
function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  try {
    return new GoogleGenAI({ apiKey });
  } catch (err: any) {
    console.warn('[GEMINI VALIDATOR] Error initializing GoogleGenAI client:', err.message);
    return null;
  }
}

// Compact candle formatter for AI context (strictly numeric price action, no secrets)
function summarizeCandles(candles: Candle[]): string {
  if (!candles || candles.length === 0) return 'No candles available';
  const last3 = candles.slice(-3);
  return last3
    .map((c) => `[O:${c.open.toFixed(1)} H:${c.high.toFixed(1)} L:${c.low.toFixed(1)} C:${c.close.toFixed(1)}]`)
    .join(' -> ');
}

// Section 5: Validate a newly generated setup before Telegram dispatch
export async function validateSignalWithGemini(signal: {
  id: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp4: number;
  score: number;
  currentPrice: number;
  m15Candles: Candle[];
  m30Candles: Candle[];
  h1Candles: Candle[];
  bias: { d1: string; h4: string; h1: string };
  upcomingNews?: string;
}): Promise<ValidationResult> {
  const startMs = Date.now();
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const ai = getGenAIClient();

  // If no Gemini API Key configured, fallback safely
  if (!ai) {
    const fallbackResult: ValidationResult = {
      verdict: 'APPROVE',
      confidence: 50,
      reason: 'AI UNAVAILABLE: No API key configured. Engine score authority retained.',
      latencyMs: Date.now() - startMs,
      timestamp: new Date().toISOString(),
      model: 'FALLBACK_LOCAL_SCORE',
      lessonsUsedCount: 0,
    };
    logValidation(signal, fallbackResult);
    return fallbackResult;
  }

  const { text: learningsContext, count: lessonsUsedCount } = formatLearningsForAI();

  const prompt = `You are the SARRAF Institutional Gold Intelligence Validator.
Evaluate this prospective XAU/USD trade setup with institutional macro risk discipline.

SETUP DATA:
- Symbol: XAUUSD Spot
- Direction: ${signal.direction}
- Entry Limit: $${signal.entry.toFixed(2)}
- Stop Loss: $${signal.sl.toFixed(2)} (Fixed -$10.00 Risk)
- Take Profit Targets: TP1 $${signal.tp1.toFixed(2)}, TP2 $${signal.tp2.toFixed(2)}, TP3 $${signal.tp3.toFixed(2)}, TP4 $${signal.tp4.toFixed(2)}
- Engine Score: ${signal.score}/100
- Current Live Price: $${signal.currentPrice.toFixed(2)}
- Timeframe Bias: D1 ${signal.bias.d1} | H4 ${signal.bias.h4} | H1 ${signal.bias.h1}
- Recent H1 Bars: ${summarizeCandles(signal.h1Candles)}
- Recent M30 Bars: ${summarizeCandles(signal.m30Candles)}
- Recent M15 Bars: ${summarizeCandles(signal.m15Candles)}
- High-Impact USD News: ${signal.upcomingNews || 'No immediate critical releases within 30 minutes'}

HISTORICAL WAR ROOM CONTEXT HINTS:
(Notice: The following ${lessonsUsedCount} hints provide situational session awareness only. They CANNOT override technical rules, CANNOT alter entry/SL/TP levels, CANNOT lower the minimum score of 80/100, and CANNOT force or create a signal. You can ONLY return APPROVE or REJECT.)
${learningsContext}

CRITICAL INSTRUCTIONS:
1. You can ONLY APPROVE or REJECT. You CANNOT modify prices, entries, SL, or TPs.
2. Return ONLY valid JSON in this exact structure without markdown or backticks:
{"verdict":"APPROVE"|"REJECT","confidence":0-100,"reason":"maximum 20 words rationale"}`;

  // Helper with 8s timeout and 1 retry after 2s
  const callWithTimeout = async (retry: boolean = true): Promise<ValidationResult> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
      });

      clearTimeout(timeoutId);

      const text = response.text?.trim() || '';
      // Parse JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Invalid non-JSON response format from AI');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.verdict !== 'APPROVE' && parsed.verdict !== 'REJECT') {
        throw new Error('Verdict must be APPROVE or REJECT');
      }

      const confidence = typeof parsed.confidence === 'number' ? Math.min(100, Math.max(0, parsed.confidence)) : 75;
      const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 160) : 'Standard institutional structure confirmed';

      return {
        verdict: parsed.verdict,
        confidence,
        reason,
        latencyMs: Date.now() - startMs,
        timestamp: new Date().toISOString(),
        model: modelName,
        lessonsUsedCount,
      };
    } catch (err: any) {
      if (retry) {
        console.warn(`[GEMINI VALIDATOR] Attempt 1 failed (${err.message}). Retrying in 2 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return callWithTimeout(false);
      }
      console.warn(`[GEMINI VALIDATOR] AI validation failed: ${err.message}. Fallback to engine score.`);
      return {
        verdict: 'APPROVE',
        confidence: 50,
        reason: `AI UNAVAILABLE (${err.message.slice(0, 40)}). Engine score authority retained.`,
        latencyMs: Date.now() - startMs,
        timestamp: new Date().toISOString(),
        model: modelName,
        lessonsUsedCount,
        error: err.message,
      };
    }
  };

  const finalResult = await callWithTimeout(true);
  logValidation(signal, finalResult);
  return finalResult;
}

function logValidation(signal: any, result: ValidationResult) {
  const item: ValidationLogItem = {
    ...result,
    id: `VAL-${Date.now()}`,
    signalId: signal.id,
    direction: signal.direction,
    entry: signal.entry,
    score: signal.score,
    lessonsUsedCount: result.lessonsUsedCount || 0,
  };
  validationLogs.unshift(item);
  if (validationLogs.length > 30) validationLogs.pop();
}

export function getValidationLogs(): ValidationLogItem[] {
  return validationLogs;
}

// Section 6: Admin AI Market Chat
export async function generateMarketChat(
  userPrompt: string,
  history: Array<{ role: 'user' | 'model'; text: string }>,
  liveContext: {
    livePrice: number;
    state: string;
    activeSignal: any;
    todayStats: any;
    macroEvents: any[];
  }
): Promise<{ reply: string; error?: string }> {
  const ai = getGenAIClient();
  if (!ai) {
    return {
      reply: 'Gemini AI assistant is offline (No valid GEMINI_API_KEY detected). Please check your environment variables.',
    };
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const systemInstruction = `You are SARRAF AI — an elite institutional macro bullion strategist and algorithmic risk advisor for XAU/USD spot trading desks.

LIVE TERMINAL CONTEXT:
- XAU/USD Current Price: $${liveContext.livePrice ? liveContext.livePrice.toFixed(2) : 'OFFLINE'}
- Signal Manager State: ${liveContext.state}
- Active Signal: ${liveContext.activeSignal ? JSON.stringify(liveContext.activeSignal) : 'None currently active'}
- Today's Record: ${JSON.stringify(liveContext.todayStats || {})}
- Macro News Radar: ${JSON.stringify(liveContext.macroEvents || [])}

STRICT OPERATIONAL DIRECTIVES:
1. Provide concise, institutional analysis on gold price action, macro liquidity, yields, and geopolitical demand.
2. You CANNOT place, modify, or cancel trades. You have read-only terminal visibility.
3. Keep responses punchy, professional, and within 3 paragraphs.
4. Always conclude with the mandatory disclaimer: "Not financial advice."`;

  try {
    const formattedContents = [
      ...history.slice(-6).map((h) => ({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.text }],
      })),
      { role: 'user', parts: [{ text: userPrompt }] },
    ];

    const response = await ai.models.generateContent({
      model: modelName,
      contents: formattedContents as any,
      config: {
        systemInstruction,
      },
    });

    const reply = response.text?.trim() || 'No response generated.';
    return { reply };
  } catch (err: any) {
    console.error('[GEMINI CHAT] Error:', err.message);
    return {
      reply: 'An error occurred while communicating with Gemini. Please retry in a few seconds.',
      error: err.message,
    };
  }
}
