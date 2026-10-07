import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { getClosedCandles } from './candleEngine.ts';
import { getCurrentSettings } from './settingsEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, '../../data');
const NEWS_CACHE_FILE = path.resolve(DATA_DIR, 'news_cache.json');
const NEWS_30DAYS_FILE = path.resolve(DATA_DIR, 'news_30days.json');
const NEWS_MANUAL_FILE = path.resolve(DATA_DIR, 'news_manual.json');
const HEADS_UP_LOG_FILE = path.resolve(DATA_DIR, 'news_heads_up_log.json');

export type NewsImpact = 'High' | 'Medium' | 'Low' | 'Holiday';
export type NewsTier = 'TIER_1' | 'TIER_2' | 'NONE';
export type GoldImpact =
  | 'BULLISH'
  | 'BEARISH'
  | 'NEUTRAL'
  | 'UPCOMING'
  | 'NO_FORECAST'
  | 'ACTUAL_NOT_AVAILABLE';

export interface RawForexFactoryEvent {
  title: string;
  country: string;
  date: string; // e.g. "2026-10-07T08:30:00-04:00"
  impact: string;
  forecast: string;
  previous: string;
}

export interface NewsEvent {
  id: string;
  title: string;
  country: string;
  impact: NewsImpact;
  tier: NewsTier;
  timeUtc: string; // UTC ISO string
  displayTime: string; // e.g., formatted in UTC or DISPLAY_TZ
  rawDate: string;
  forecastStr: string;
  previousStr: string;
  actualStr: string | null;
  forecastNum: number | null;
  previousNum: number | null;
  actualNum: number | null;
  actualSource: 'FEED' | 'MANUAL' | 'UNVERIFIED' | null;
  goldImpact: GoldImpact;
  goldImpactExplanation?: string;
  isHighImpactUsd: boolean;
  isTentative: boolean;
  isAllDay: boolean;
  isCancelledOrRemoved: boolean;
  changeNote?: string;
  minutesUntil: number;
  isReleased: boolean;
  isInsideLockWindow: boolean;
  lockType?: 'PRE_RELEASE' | 'POST_RELEASE' | 'VOLATILITY_SETTLE' | null;
}

export interface NewsFeedStatus {
  status: 'LIVE' | 'STALE' | 'OFFLINE' | 'NEWS_UNKNOWN';
  lastSuccessfulFetchAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  eventsCount: number;
  usdHighImpactCount: number;
  nextEvent: NewsEvent | null;
  isLockActive: boolean;
  activeLockEvent: NewsEvent | null;
  cautionFlag?: string;
}

// In-memory news store
let cachedEvents: NewsEvent[] = [];
let manualActuals: Record<
  string,
  { actual: string; source: 'MANUAL' | 'UNVERIFIED'; verified: boolean; note?: string; explanation?: string }
> = {};
let sentHeadsUpEvents: Record<string, boolean> = {};
let lastFetchTimeMs = 0;
let lastSuccessfulFetchTimeMs = 0;
let lastFetchError: string | null = null;
let consecutiveFailures = 0;

const FETCH_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const UNKNOWN_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// -------------------------------------------------------------
// 1. DATA RULES & PARSING
// -------------------------------------------------------------

// Safe financial number parser: "3.1%", "250K", "1.2M", "-0.3%", "-100.8B", etc.
export function parseFinancialNumber(val: string | null | undefined): number | null {
  if (!val || typeof val !== 'string') return null;
  const clean = val.trim();
  if (!clean || clean === '-' || clean === 'N/A' || clean === 'Tentative') return null;

  let multiplier = 1;
  let numStr = clean;

  if (numStr.endsWith('%')) {
    numStr = numStr.slice(0, -1);
  } else if (numStr.endsWith('K') || numStr.endsWith('k')) {
    multiplier = 1000;
    numStr = numStr.slice(0, -1);
  } else if (numStr.endsWith('M') || numStr.endsWith('m')) {
    multiplier = 1000000;
    numStr = numStr.slice(0, -1);
  } else if (numStr.endsWith('B') || numStr.endsWith('b')) {
    multiplier = 1000000000;
    numStr = numStr.slice(0, -1);
  } else if (numStr.endsWith('T') || numStr.endsWith('t')) {
    multiplier = 1000000000000;
    numStr = numStr.slice(0, -1);
  }

  if (numStr.includes('|')) {
    numStr = numStr.split('|')[0];
  }

  const parsed = parseFloat(numStr.replace(/,/g, '').trim());
  if (isNaN(parsed)) return null;
  return parsed * multiplier;
}

// Check if event is reversed (where higher number = weaker USD = bullish for Gold)
export function isReversedGoldEvent(title: string): boolean {
  const t = title.toLowerCase();
  return (
    t.includes('unemployment rate') ||
    t.includes('jobless claims') ||
    t.includes('unemployment claims') ||
    t.includes('continuing claims') ||
    t.includes('initial claims')
  );
}

// Categorize event tier for news lock
export function categorizeEventTier(country: string, impact: string, title: string): NewsTier {
  if (country !== 'USD') return 'NONE';

  const t = title.toLowerCase();

  // Tier 1: FOMC, CPI, NFP, Fed chair speeches
  if (
    t.includes('fomc') ||
    t.includes('fed funds rate') ||
    t.includes('rate decision') ||
    t.includes('fed chair') ||
    t.includes('powell speaks') ||
    t.includes('non-farm employment') ||
    t.includes('nfp') ||
    t.includes('cpi') ||
    t.includes('consumer price index')
  ) {
    return 'TIER_1';
  }

  // Tier 2: PPI, Retail Sales, ISM/PMI, GDP, Unemployment Rate, Jobless Claims, PCE
  if (
    impact === 'High' ||
    t.includes('ppi') ||
    t.includes('retail sales') ||
    t.includes('ism') ||
    t.includes('pmi') ||
    t.includes('gdp') ||
    t.includes('unemployment rate') ||
    t.includes('jobless claims') ||
    t.includes('unemployment claims') ||
    t.includes('pce')
  ) {
    return 'TIER_2';
  }

  return 'NONE';
}

export function isHighImpactUsdEvent(country: string, impact: string, title: string): boolean {
  if (country !== 'USD') return false;
  if (impact === 'High') return true;
  return categorizeEventTier(country, impact, title) !== 'NONE';
}

// Compute gold impact from forecast and actual values
export function computeGoldImpact(
  title: string,
  forecast: number | null,
  actual: number | null,
  isReleased: boolean
): GoldImpact {
  if (!isReleased && actual === null) {
    return 'UPCOMING';
  }
  if (actual === null) {
    return 'ACTUAL_NOT_AVAILABLE';
  }
  if (forecast === null) {
    return 'NO_FORECAST';
  }

  const diff = actual - forecast;
  const tolerance = Math.abs(forecast) * 0.0001 || 0.0001;

  if (Math.abs(diff) <= tolerance) {
    return 'NEUTRAL';
  }

  const reversed = isReversedGoldEvent(title);

  if (diff > 0) {
    // Actual stronger than forecast:
    // Standard: Stronger USD => BEARISH for Gold
    // Reversed (Unemployment): Higher unemployment => Weaker USD => BULLISH for Gold
    return reversed ? 'BULLISH' : 'BEARISH';
  } else {
    // Actual weaker than forecast:
    return reversed ? 'BEARISH' : 'BULLISH';
  }
}

// -------------------------------------------------------------
// 2. 30-DAY ARCHIVE & MANUAL ACTUALS PERSISTENCE
// -------------------------------------------------------------

export function loadManualActuals() {
  ensureDataDir();
  if (fs.existsSync(NEWS_MANUAL_FILE)) {
    try {
      const data = fs.readFileSync(NEWS_MANUAL_FILE, 'utf-8');
      manualActuals = JSON.parse(data) || {};
    } catch {
      manualActuals = {};
    }
  }
}

export function saveManualActuals() {
  ensureDataDir();
  try {
    fs.writeFileSync(NEWS_MANUAL_FILE, JSON.stringify(manualActuals, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[NEWS ENGINE] Failed to save manual actuals:', err.message);
  }
}

export function load30DayArchive(): NewsEvent[] {
  ensureDataDir();
  if (fs.existsSync(NEWS_30DAYS_FILE)) {
    try {
      const data = fs.readFileSync(NEWS_30DAYS_FILE, 'utf-8');
      return JSON.parse(data) || [];
    } catch {
      return [];
    }
  }
  return [];
}

export function save30DayArchive(events: NewsEvent[]) {
  ensureDataDir();
  try {
    // Keep 30 days of past events
    const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const filtered = events.filter((e) => new Date(e.timeUtc).getTime() >= cutoffMs);
    fs.writeFileSync(NEWS_30DAYS_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[NEWS ENGINE] Failed to save 30-day archive:', err.message);
  }
}

function loadSentHeadsUp() {
  ensureDataDir();
  if (fs.existsSync(HEADS_UP_LOG_FILE)) {
    try {
      const data = fs.readFileSync(HEADS_UP_LOG_FILE, 'utf-8');
      sentHeadsUpEvents = JSON.parse(data) || {};
    } catch {
      sentHeadsUpEvents = {};
    }
  }
}

function saveSentHeadsUp() {
  ensureDataDir();
  try {
    fs.writeFileSync(HEADS_UP_LOG_FILE, JSON.stringify(sentHeadsUpEvents, null, 2), 'utf-8');
  } catch {}
}

// -------------------------------------------------------------
// 3. TRANSFORM & RECONCILE CALENDAR EVENTS
// -------------------------------------------------------------

export function generateEventId(raw: RawForexFactoryEvent): string {
  const dateIso = new Date(raw.date).toISOString().slice(0, 10);
  const cleanTitle = raw.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().slice(0, 30);
  return `EVT-${dateIso}-${raw.country}-${cleanTitle}`;
}

export function transformRawEvent(raw: RawForexFactoryEvent, existingArchive?: NewsEvent[]): NewsEvent {
  const dateObj = new Date(raw.date);
  const timeUtc = isNaN(dateObj.getTime()) ? new Date().toISOString() : dateObj.toISOString();
  const eventTimeMs = new Date(timeUtc).getTime();
  const nowMs = Date.now();
  const minutesUntil = Math.round((eventTimeMs - nowMs) / 60000);
  const isReleased = nowMs >= eventTimeMs;

  const id = generateEventId(raw);
  const isTentative = raw.date.toLowerCase().includes('tentative') || raw.title.toLowerCase().includes('tentative');
  const isAllDay = raw.date.toLowerCase().includes('all day') || raw.title.toLowerCase().includes('all day');

  const forecastNum = parseFinancialNumber(raw.forecast);
  const previousNum = parseFinancialNumber(raw.previous);

  // Check manual actual
  const manualEntry = manualActuals[id] || manualActuals[raw.title + '_' + timeUtc.slice(0, 10)];
  let actualStr: string | null = null;
  let actualNum: number | null = null;
  let actualSource: 'FEED' | 'MANUAL' | 'UNVERIFIED' | null = null;
  let goldImpactExplanation: string | undefined = undefined;

  if (manualEntry) {
    actualStr = manualEntry.actual;
    actualNum = parseFinancialNumber(manualEntry.actual);
    actualSource = manualEntry.source;
    goldImpactExplanation = manualEntry.explanation;
  }

  const isHigh = isHighImpactUsdEvent(raw.country, raw.impact, raw.title);
  const tier = categorizeEventTier(raw.country, raw.impact, raw.title);
  const goldImpact = computeGoldImpact(raw.title, forecastNum, actualNum, isReleased);

  // Check change notes against archive
  let changeNote: string | undefined = undefined;
  if (existingArchive) {
    const existing = existingArchive.find((e) => e.id === id || e.title === raw.title);
    if (existing && existing.timeUtc !== timeUtc) {
      changeNote = `Rescheduled from ${new Date(existing.timeUtc).toUTCString()}`;
    }
  }

  return {
    id,
    title: raw.title,
    country: raw.country,
    impact: (raw.impact as NewsImpact) || 'Low',
    tier,
    timeUtc,
    displayTime: new Date(timeUtc).toUTCString(),
    rawDate: raw.date,
    forecastStr: raw.forecast || '',
    previousStr: raw.previous || '',
    actualStr,
    forecastNum,
    previousNum,
    actualNum,
    actualSource,
    goldImpact,
    goldImpactExplanation,
    isHighImpactUsd: isHigh,
    isTentative,
    isAllDay,
    isCancelledOrRemoved: false,
    changeNote,
    minutesUntil,
    isReleased,
    isInsideLockWindow: false,
  };
}

// -------------------------------------------------------------
// 4. FOREX FACTORY DUAL-WEEK FETCHER & RECONCILIATION
// -------------------------------------------------------------

export async function fetchForexFactoryCalendar(): Promise<boolean> {
  const now = Date.now();
  if (now - lastFetchTimeMs < FETCH_COOLDOWN_MS && cachedEvents.length > 0) {
    return true; // respect 15m cooldown
  }

  lastFetchTimeMs = now;
  loadManualActuals();
  loadSentHeadsUp();

  const archive = load30DayArchive();

  try {
    const urls = [
      'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
      'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
    ];

    const allRaw: RawForexFactoryEvent[] = [];

    for (const url of urls) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SARRAF/1.0',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.status === 429) {
        console.warn(`[NEWS ENGINE] Forex Factory rate limited (429) on ${url}. Backing off.`);
        lastFetchError = 'Rate limited (HTTP 429). Backing off.';
        return false;
      }

      if (res.ok) {
        const data: RawForexFactoryEvent[] = await res.json();
        if (Array.isArray(data)) {
          allRaw.push(...data);
        }
      }
    }

    if (allRaw.length === 0) {
      throw new Error('No events returned from Forex Factory calendar endpoints.');
    }

    // Filter for USD events only
    const usdEvents = allRaw.filter((e) => e.country === 'USD');

    // Transform and de-duplicate
    const seenIds = new Set<string>();
    const newTransformed: NewsEvent[] = [];

    for (const raw of usdEvents) {
      const transformed = transformRawEvent(raw, archive);
      if (!seenIds.has(transformed.id)) {
        seenIds.add(transformed.id);
        newTransformed.push(transformed);
      }
    }

    // Reconcile with 30-day archive
    const mergedArchiveMap = new Map<string, NewsEvent>();
    archive.forEach((e) => mergedArchiveMap.set(e.id, e));

    newTransformed.forEach((e) => {
      mergedArchiveMap.set(e.id, e);
    });

    const reconciledAll = Array.from(mergedArchiveMap.values()).sort(
      (a, b) => new Date(a.timeUtc).getTime() - new Date(b.timeUtc).getTime()
    );

    cachedEvents = reconciledAll;
    save30DayArchive(reconciledAll);

    lastSuccessfulFetchTimeMs = now;
    lastFetchError = null;
    consecutiveFailures = 0;

    // Cache copy to disk
    ensureDataDir();
    fs.writeFileSync(
      NEWS_CACHE_FILE,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          eventsCount: cachedEvents.length,
          events: cachedEvents,
        },
        null,
        2
      ),
      'utf-8'
    );

    return true;
  } catch (err: any) {
    consecutiveFailures += 1;
    lastFetchError = err.message || 'Network error';
    console.warn(`[NEWS ENGINE] News fetch failed (${consecutiveFailures} attempts):`, err.message);

    // Fallback to disk archive
    if (cachedEvents.length === 0) {
      cachedEvents = load30DayArchive();
    }
    return false;
  }
}

// -------------------------------------------------------------
// 5. TIERED NEWS LOCK ENGINE WITH VOLATILITY SETTLE
// -------------------------------------------------------------

export function evaluateTieredLock(
  event: NewsEvent,
  settings = getCurrentSettings()
): { isLocked: boolean; lockType: NewsEvent['lockType'] } {
  // Tentative and All-Day events never lock
  if (event.isTentative || event.isAllDay || event.isCancelledOrRemoved) {
    return { isLocked: false, lockType: null };
  }

  const mins = event.minutesUntil;

  if (event.tier === 'TIER_1') {
    const preMins = settings.tier1PreMinutes ?? 45;
    const postMins = settings.tier1PostMinutes ?? 30;

    // 1. Pre-release lock window
    if (mins >= 0 && mins <= preMins) {
      return { isLocked: true, lockType: 'PRE_RELEASE' };
    }

    // 2. Post-release window
    if (mins < 0 && mins >= -postMins) {
      return { isLocked: true, lockType: 'POST_RELEASE' };
    }

    // 3. Volatility Settle check (between postMins and postMins + 60)
    if (mins < -postMins && mins >= -(postMins + 60)) {
      const m15Candles = getClosedCandles('M15');
      if (m15Candles.length >= 20) {
        // Compute last 20-bar average range and recent bar range
        const last20 = m15Candles.slice(-20);
        const avgRange = last20.reduce((acc, c) => acc + (c.high - c.low), 0) / 20;
        const currentBar = m15Candles[m15Candles.length - 1];
        const currentRange = currentBar.high - currentBar.low;

        if (currentRange > 1.5 * avgRange) {
          return { isLocked: true, lockType: 'VOLATILITY_SETTLE' };
        }
      }
    }
  } else if (event.tier === 'TIER_2') {
    const preMins = settings.tier2PreMinutes ?? 30;
    const postMins = settings.tier2PostMinutes ?? 15;

    if (mins >= 0 && mins <= preMins) {
      return { isLocked: true, lockType: 'PRE_RELEASE' };
    }
    if (mins < 0 && mins >= -postMins) {
      return { isLocked: true, lockType: 'POST_RELEASE' };
    }
  }

  return { isLocked: false, lockType: null };
}

// -------------------------------------------------------------
// 6. STATUS & UI RETRIEVAL
// -------------------------------------------------------------

export function getNewsFeedStatus(displayTz: string = 'UTC'): NewsFeedStatus {
  const now = Date.now();
  const timeSinceSuccess = now - lastSuccessfulFetchTimeMs;
  const settings = getCurrentSettings();

  let status: 'LIVE' | 'STALE' | 'OFFLINE' | 'NEWS_UNKNOWN' = 'LIVE';
  let cautionFlag: string | undefined = undefined;

  if (lastSuccessfulFetchTimeMs === 0) {
    status = 'OFFLINE';
    cautionFlag = 'News calendar feed not yet connected.';
  } else if (timeSinceSuccess > UNKNOWN_THRESHOLD_MS) {
    status = 'NEWS_UNKNOWN';
    cautionFlag = 'News feed offline > 6 hours. High-impact radar uncertain (Trading permitted with caution).';
  } else if (timeSinceSuccess > STALE_THRESHOLD_MS) {
    status = 'STALE';
    cautionFlag = 'News feed stale (> 30m since last sync). Serving cached calendar.';
  }

  // Evaluate dynamic lock states
  const updatedEvents = cachedEvents.map((evt) => {
    const eventTimeMs = new Date(evt.timeUtc).getTime();
    const minutesUntil = Math.round((eventTimeMs - now) / 60000);
    const isReleased = now >= eventTimeMs;

    // Check manual actual
    const manualEntry = manualActuals[evt.id] || manualActuals[evt.title + '_' + evt.timeUtc.slice(0, 10)];
    let actualStr = evt.actualStr;
    let actualNum = evt.actualNum;
    let actualSource = evt.actualSource;
    let goldImpactExplanation = evt.goldImpactExplanation;

    if (manualEntry) {
      actualStr = manualEntry.actual;
      actualNum = parseFinancialNumber(manualEntry.actual);
      actualSource = manualEntry.source;
      goldImpactExplanation = manualEntry.explanation;
    }

    const goldImpact = computeGoldImpact(evt.title, evt.forecastNum, actualNum, isReleased);
    const lockEval = evaluateTieredLock({ ...evt, minutesUntil, isReleased }, settings);

    return {
      ...evt,
      minutesUntil,
      isReleased,
      isInsideLockWindow: lockEval.isLocked,
      lockType: lockEval.lockType,
      actualStr,
      actualNum,
      actualSource,
      goldImpact,
      goldImpactExplanation,
    };
  });

  const highImpactUsd = updatedEvents.filter((e) => e.isHighImpactUsd && !e.isCancelledOrRemoved);
  const futureHighImpact = highImpactUsd
    .filter((e) => e.minutesUntil > -120)
    .sort((a, b) => a.minutesUntil - b.minutesUntil);

  const nextEvent = futureHighImpact.find((e) => e.minutesUntil >= 0) || futureHighImpact[0] || null;
  const activeLockEvent = highImpactUsd.find((e) => e.isInsideLockWindow) || null;

  return {
    status,
    lastSuccessfulFetchAt: lastSuccessfulFetchTimeMs ? new Date(lastSuccessfulFetchTimeMs).toISOString() : null,
    lastAttemptAt: lastFetchTimeMs ? new Date(lastFetchTimeMs).toISOString() : null,
    lastError: lastFetchError,
    eventsCount: updatedEvents.length,
    usdHighImpactCount: highImpactUsd.length,
    nextEvent,
    isLockActive: !!activeLockEvent,
    activeLockEvent,
    cautionFlag,
  };
}

export function getNewsEventsForUI(): NewsEvent[] {
  // Returns formatted and refreshed events
  getNewsFeedStatus();
  return cachedEvents.map((evt) => {
    const eventTimeMs = new Date(evt.timeUtc).getTime();
    const now = Date.now();
    const minutesUntil = Math.round((eventTimeMs - now) / 60000);
    const isReleased = now >= eventTimeMs;

    const manualEntry = manualActuals[evt.id] || manualActuals[evt.title + '_' + evt.timeUtc.slice(0, 10)];
    let actualStr = evt.actualStr;
    let actualNum = evt.actualNum;
    let actualSource = evt.actualSource;
    let goldImpactExplanation = evt.goldImpactExplanation;

    if (manualEntry) {
      actualStr = manualEntry.actual;
      actualNum = parseFinancialNumber(manualEntry.actual);
      actualSource = manualEntry.source;
      goldImpactExplanation = manualEntry.explanation;
    }

    const goldImpact = computeGoldImpact(evt.title, evt.forecastNum, actualNum, isReleased);
    const lockEval = evaluateTieredLock({ ...evt, minutesUntil, isReleased });

    return {
      ...evt,
      minutesUntil,
      isReleased,
      isInsideLockWindow: lockEval.isLocked,
      lockType: lockEval.lockType,
      actualStr,
      actualNum,
      actualSource,
      goldImpact,
      goldImpactExplanation,
    };
  });
}

// -------------------------------------------------------------
// 7. ADMIN MANUAL ACTUAL ENTRY & GEMINI LOOKUP
// -------------------------------------------------------------

export function setManualActualValue(
  eventId: string,
  actualValue: string,
  source: 'MANUAL' | 'UNVERIFIED' = 'MANUAL',
  note?: string,
  explanation?: string
) {
  loadManualActuals();
  manualActuals[eventId] = {
    actual: actualValue.trim(),
    source,
    verified: source === 'MANUAL',
    note,
    explanation,
  };
  saveManualActuals();
}

export async function lookupActualValueWithGemini(
  event: NewsEvent
): Promise<{ actual: string; explanation: string } | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    const prompt = `You are SARRAF News Intelligence Assistant.
Lookup and report the actual figure for this macroeconomic release:
Event: ${event.title} (${event.country})
Release UTC Time: ${event.timeUtc}
Forecast: ${event.forecastStr || 'N/A'}
Previous: ${event.previousStr || 'N/A'}

Provide the reported actual economic figure if already released, and a concise 1-line explanation (max 20 words) on gold impact.
Return ONLY valid JSON:
{"actual":"e.g. 3.2% or 210K","explanation":"max 20 words rationale"}`;

    const res = await ai.models.generateContent({
      model,
      contents: prompt,
    });

    const text = res.text?.trim() || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return {
      actual: parsed.actual || '',
      explanation: (parsed.explanation || '').slice(0, 140),
    };
  } catch (err: any) {
    console.warn('[NEWS ENGINE] Gemini lookup error:', err.message);
    return null;
  }
}

// -------------------------------------------------------------
// 8. ENGINE NEWS LOCK QUERY
// -------------------------------------------------------------

export function checkNewsLockState(): {
  isLocked: boolean;
  activeEventTitle?: string;
  minutesUntil?: number;
  lockType?: NewsEvent['lockType'];
} {
  const status = getNewsFeedStatus();
  if (status.isLockActive && status.activeLockEvent) {
    return {
      isLocked: true,
      activeEventTitle: status.activeLockEvent.title,
      minutesUntil: status.activeLockEvent.minutesUntil,
      lockType: status.activeLockEvent.lockType,
    };
  }
  return { isLocked: false };
}
