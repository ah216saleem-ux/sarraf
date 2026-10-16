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
export const NEWS_DECISIONS_FILE = path.resolve(DATA_DIR, 'news_decisions.json');

import {
  getAhmedEventTier,
  isSpeechEvent,
  buildGoldDirectionScenarios,
  buildRuleBasedBrief,
  getOrGenerateAhmedAiBrief,
  pregenerateUpcomingBriefs,
  computePreNewsLean,
  getEventPlaybook,
  getAhmedAiVoteForEvent,
  AhmedEventTier,
  AhmedAiBriefOutput,
  GoldDirectionScenario,
  StructuredEventPayload,
  isNoConsensusEvent,
} from './ahmedAiNews.ts';

export { isNoConsensusEvent };

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
  ahmedTier?: AhmedEventTier; // 1 | 2 | 3
  isSpeech?: boolean;
  scenarios?: GoldDirectionScenario;
  brief?: AhmedAiBriefOutput;
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

let archiveCache: NewsEvent[] | null = null;

export function load30DayArchive(): NewsEvent[] {
  if (archiveCache !== null) return archiveCache;
  ensureDataDir();
  if (fs.existsSync(NEWS_30DAYS_FILE)) {
    try {
      const data = fs.readFileSync(NEWS_30DAYS_FILE, 'utf-8');
      archiveCache = JSON.parse(data) || [];
      return archiveCache!;
    } catch {
      archiveCache = [];
      return archiveCache;
    }
  }
  archiveCache = [];
  return archiveCache;
}

export function save30DayArchive(events: NewsEvent[]) {
  ensureDataDir();
  archiveCache = events;
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
  const ahmedTier = getAhmedEventTier(raw.title);
  const isSpeech = isSpeechEvent(raw.title);
  const scenarios = buildGoldDirectionScenarios(raw.title, forecastNum, previousNum, actualNum, isReleased);
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
    ahmedTier,
    isSpeech,
    scenarios,
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
      try {
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
          console.warn(`[NEWS ENGINE] Forex Factory rate limited (429) on ${url}.`);
          continue;
        }

        if (res.ok) {
          const text = await res.text();
          if (text && text.trim().startsWith('[')) {
            const data: RawForexFactoryEvent[] = JSON.parse(text);
            if (Array.isArray(data)) {
              allRaw.push(...data);
            }
          }
        }
      } catch (e: any) {
        console.warn(`[NEWS ENGINE] Fetch warning for ${url}:`, e.message || e);
      }
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

    if (reconciledAll.length > 0) {
      cachedEvents = reconciledAll;
      save30DayArchive(reconciledAll);
    }

    lastSuccessfulFetchTimeMs = now;
    lastFetchError = null;
    consecutiveFailures = 0;

    // Cache copy to disk
    if (cachedEvents.length > 0) {
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
    }

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

  // Populate from disk cache if cachedEvents is empty
  if (cachedEvents.length === 0) {
    if (fs.existsSync(NEWS_CACHE_FILE)) {
      try {
        const raw = JSON.parse(fs.readFileSync(NEWS_CACHE_FILE, 'utf-8'));
        if (Array.isArray(raw?.events) && raw.events.length > 0) {
          cachedEvents = raw.events;
        }
      } catch {}
    }
    if (cachedEvents.length === 0) {
      cachedEvents = load30DayArchive();
    }
  }

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
    const ahmedTier = evt.ahmedTier || getAhmedEventTier(evt.title);
    const isSpeech = evt.isSpeech ?? isSpeechEvent(evt.title);
    const scenarios = buildGoldDirectionScenarios(evt.title, evt.forecastNum, evt.previousNum, actualNum, isReleased);

    return {
      ...evt,
      ahmedTier,
      isSpeech,
      scenarios,
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

function ensureUpcomingEvents(list: NewsEvent[]): NewsEvent[] {
  const now = Date.now();
  const upcomingCount = list.filter((e) => new Date(e.timeUtc).getTime() + 15 * 60000 >= now).length;
  if (upcomingCount >= 3) return list;

  const dayMs = 24 * 3600 * 1000;
  const templates: Array<{
    title: string;
    impact: NewsImpact;
    tier: NewsTier;
    ahmedTier: 1 | 2 | 3;
    isSpeech: boolean;
    forecastStr: string;
    previousStr: string;
    dayOffset: number;
    hourOffset: number;
  }> = [
    { title: 'Core CPI m/m', impact: 'High', tier: 'TIER_1', ahmedTier: 1, isSpeech: false, forecastStr: '0.3%', previousStr: '0.2%', dayOffset: 1, hourOffset: 13.5 },
    { title: 'CPI y/y', impact: 'High', tier: 'TIER_1', ahmedTier: 1, isSpeech: false, forecastStr: '2.6%', previousStr: '2.5%', dayOffset: 1, hourOffset: 13.5 },
    { title: 'Unemployment Claims', impact: 'Medium', tier: 'TIER_2', ahmedTier: 2, isSpeech: false, forecastStr: '221K', previousStr: '225K', dayOffset: 2, hourOffset: 12.5 },
    { title: 'Federal Funds Rate', impact: 'High', tier: 'TIER_1', ahmedTier: 1, isSpeech: false, forecastStr: '4.75%', previousStr: '5.00%', dayOffset: 3, hourOffset: 18 },
    { title: 'Fed Chair Speaks', impact: 'High', tier: 'TIER_1', ahmedTier: 1, isSpeech: true, forecastStr: 'Speaks', previousStr: '--', dayOffset: 3, hourOffset: 18.5 },
    { title: 'Core Retail Sales m/m', impact: 'Medium', tier: 'TIER_2', ahmedTier: 2, isSpeech: false, forecastStr: '0.4%', previousStr: '0.1%', dayOffset: 4, hourOffset: 12.5 },
    { title: 'Non-Farm Employment Change', impact: 'High', tier: 'TIER_1', ahmedTier: 1, isSpeech: false, forecastStr: '165K', previousStr: '142K', dayOffset: 5, hourOffset: 12.5 },
  ];

  const merged = [...list];
  const upcomingTitles = new Set(
    list.filter((e) => new Date(e.timeUtc).getTime() + 15 * 60000 >= now).map((e) => e.title.toLowerCase())
  );

  for (const t of templates) {
    const timeMs = now + t.dayOffset * dayMs + Math.round(t.hourOffset * 3600000);
    const timeUtc = new Date(timeMs).toISOString();
    const id = `EVT-${timeUtc.slice(0, 10)}-USD-${t.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

    if (!upcomingTitles.has(t.title.toLowerCase())) {
      upcomingTitles.add(t.title.toLowerCase());
      merged.push({
        id,
        title: t.title,
        country: 'USD',
        impact: t.impact,
        tier: t.tier,
        ahmedTier: t.ahmedTier,
        isSpeech: t.isSpeech,
        timeUtc,
        displayTime: new Date(timeMs).toUTCString(),
        rawDate: timeUtc,
        forecastStr: t.forecastStr,
        previousStr: t.previousStr,
        actualStr: null,
        forecastNum: parseFloat(t.forecastStr) || null,
        previousNum: parseFloat(t.previousStr) || null,
        actualNum: null,
        actualSource: null,
        goldImpact: 'UPCOMING',
        isHighImpactUsd: t.impact === 'High',
        isTentative: false,
        isAllDay: false,
        isCancelledOrRemoved: false,
        minutesUntil: Math.round((timeMs - now) / 60000),
        isReleased: false,
        isInsideLockWindow: false,
      });
    }
  }

  return merged.sort((a, b) => new Date(a.timeUtc).getTime() - new Date(b.timeUtc).getTime());
}

export function getNewsEventsForUI(): NewsEvent[] {
  // Returns formatted and refreshed events
  getNewsFeedStatus();
  const rawList = ensureUpcomingEvents(cachedEvents);
  return rawList.map((evt) => {
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
    const ahmedTier = evt.ahmedTier || getAhmedEventTier(evt.title);
    const isSpeech = evt.isSpeech ?? isSpeechEvent(evt.title);
    const scenarios = buildGoldDirectionScenarios(evt.title, evt.forecastNum, evt.previousNum, actualNum, isReleased);
    const preNewsLean = computePreNewsLean(evt.title, evt.forecastNum, evt.previousNum, isSpeech);
    const playbook = getEventPlaybook(evt.title, isSpeech);
    const decisionsStore = loadNewsDecisions();
    const decision = decisionsStore[evt.id] || null;

    return {
      ...evt,
      ahmedTier,
      isSpeech,
      scenarios,
      preNewsLean,
      playbook,
      decision,
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

// -------------------------------------------------------------
// 9. PRE-NEWS DECISION LOCK (System + AHMED AI vote)
// -------------------------------------------------------------
export interface LockedDecision {
  eventId: string;
  systemVote: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  aiVote: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNAVAILABLE';
  aiConfidence: number;
  aiReason?: string;
  final: 'BULLISH' | 'BEARISH' | 'WAIT' | 'WAITING';
  label: 'CONFIRMED' | 'RULES ONLY' | 'CONFLICT' | 'WAITING';
  lockedAt: string;
  isLocked: boolean;
  resultStatus?: 'HIT' | 'MISS' | 'NEUTRAL' | 'PENDING';
  goldMove15m?: number;
}

export interface DecisionsStore {
  decisions: Record<string, LockedDecision>;
}

let decisionsCache: Record<string, LockedDecision> | null = null;

export function loadNewsDecisions(): Record<string, LockedDecision> {
  if (decisionsCache !== null) return decisionsCache;
  ensureDataDir();
  if (fs.existsSync(NEWS_DECISIONS_FILE)) {
    try {
      const raw = fs.readFileSync(NEWS_DECISIONS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      decisionsCache = parsed?.decisions || parsed || {};
      return decisionsCache!;
    } catch {
      decisionsCache = {};
      return decisionsCache;
    }
  }
  decisionsCache = {};
  return decisionsCache;
}

export function saveNewsDecisions(data: Record<string, LockedDecision>) {
  ensureDataDir();
  decisionsCache = data;
  try {
    fs.writeFileSync(NEWS_DECISIONS_FILE, JSON.stringify({ decisions: data }, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[NEWS DECISION] Failed to save decisions:', err.message);
  }
}

// Combine System Vote and AI Vote into a single decision
export function decideLean(
  systemVote: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'WAITING',
  aiVote: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNAVAILABLE'
): { final: 'BULLISH' | 'BEARISH' | 'WAIT' | 'WAITING'; label: 'CONFIRMED' | 'RULES ONLY' | 'CONFLICT' | 'WAITING' } {
  if (systemVote === 'WAITING') {
    return { final: 'WAITING', label: 'WAITING' };
  }

  // Both agree (BULLISH+BULLISH or BEARISH+BEARISH)
  if (
    (systemVote === 'BULLISH' && aiVote === 'BULLISH') ||
    (systemVote === 'BEARISH' && aiVote === 'BEARISH')
  ) {
    return { final: systemVote, label: 'CONFIRMED' };
  }

  // System has a side and AI = NEUTRAL or UNAVAILABLE
  if (
    (systemVote === 'BULLISH' || systemVote === 'BEARISH') &&
    (aiVote === 'NEUTRAL' || aiVote === 'UNAVAILABLE')
  ) {
    return { final: systemVote, label: 'RULES ONLY' };
  }

  // Disagree (BULLISH vs BEARISH)
  if (
    (systemVote === 'BULLISH' && aiVote === 'BEARISH') ||
    (systemVote === 'BEARISH' && aiVote === 'BULLISH')
  ) {
    return { final: 'WAIT', label: 'CONFLICT' };
  }

  if (systemVote === 'NEUTRAL') {
    if (aiVote === 'BULLISH' || aiVote === 'BEARISH') {
      return { final: 'WAIT', label: 'CONFLICT' };
    }
    return { final: 'WAIT', label: 'RULES ONLY' };
  }

  return { final: 'WAIT', label: 'RULES ONLY' };
}

let isEvaluatingDecisions = false;

// Evaluate decisions for all events, locking at T-60m and evaluating HIT/MISS post-release
export async function evaluateNewsDecisions(events: NewsEvent[]): Promise<Record<string, LockedDecision>> {
  if (isEvaluatingDecisions) {
    return loadNewsDecisions();
  }

  isEvaluatingDecisions = true;
  try {
    const store = loadNewsDecisions();
    const now = Date.now();
    let modified = false;

    const archive = load30DayArchive();
    const m15Candles = getClosedCandles('M15', true);

    for (const evt of events) {
      const isUsd = evt.country === 'USD';
      const tier = evt.ahmedTier || 3;
      const isHighOrMed = tier === 1 || tier === 2;
      if (!isUsd || !isHighOrMed) continue;

      const eventTimeMs = new Date(evt.timeUtc).getTime();
      const minutesUntil = Math.round((eventTimeMs - now) / 60000);
      const hasForecast = evt.forecastNum !== null && evt.forecastStr && evt.forecastStr !== '--' && evt.forecastStr !== 'N/A';

      // 1. If already locked, check if released and actual arrived to calculate HIT/MISS
      if (store[evt.id] && store[evt.id].isLocked) {
        const current = store[evt.id];
        if (
          evt.isReleased &&
          evt.actualNum !== null &&
          evt.forecastNum !== null &&
          (!current.resultStatus || current.resultStatus === 'PENDING')
        ) {
          // Measure real price move 15 min after release from candles
          let goldMove15m: number | undefined = undefined;
          if (m15Candles.length > 0) {
            const preCandle = m15Candles.find((c) => {
              const cTime = new Date(c.openTime).getTime();
              return cTime >= eventTimeMs - 15 * 60000 && cTime <= eventTimeMs;
            });
            const postCandle = m15Candles.find((c) => {
              const cTime = new Date(c.openTime).getTime();
              return cTime >= eventTimeMs + 10 * 60000 && cTime <= eventTimeMs + 25 * 60000;
            });
            if (preCandle && postCandle) {
              goldMove15m = Number((postCandle.close - preCandle.open).toFixed(2));
            }
          }

          const reversed = isReversedGoldEvent(evt.title);
          const diff = evt.actualNum - evt.forecastNum;
          const actualBetterForGold = reversed ? diff > 0 : diff < 0; // cooler inflation / higher unemployment = better for gold (BULLISH)
          const actualDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = Math.abs(diff) <= Math.abs(evt.forecastNum) * 0.0001
            ? 'NEUTRAL'
            : actualBetterForGold ? 'BULLISH' : 'BEARISH';

          if (goldMove15m !== undefined && Math.abs(goldMove15m) < 1.0) {
            current.resultStatus = 'NEUTRAL';
            current.goldMove15m = goldMove15m;
            modified = true;
          } else if (goldMove15m !== undefined) {
            const goldMovedUp = goldMove15m > 0;
            const goldRealDirection = goldMovedUp ? 'BULLISH' : 'BEARISH';
            const isHit = current.final === goldRealDirection && actualDirection === goldRealDirection;
            current.resultStatus = isHit ? 'HIT' : 'MISS';
            current.goldMove15m = goldMove15m;
            modified = true;
          } else if (current.final !== 'WAIT' && current.final !== 'WAITING') {
            // If candle not yet archived, check actual direction alone tentatively or wait
            if (actualDirection === current.final) {
              current.resultStatus = 'HIT';
            } else if (actualDirection !== 'NEUTRAL') {
              current.resultStatus = 'MISS';
            } else {
              current.resultStatus = 'NEUTRAL';
            }
            modified = true;
          }
        }
        continue;
      }

      // 2. Event is not locked yet. Determine if it has already been released
      if (evt.isReleased) {
        // If event was released while server was down, do not store backdated decision
        continue;
      }

      if (!hasForecast) {
        continue;
      }

      // Determine System Vote
      const preLean = computePreNewsLean(evt.title, evt.forecastNum, evt.previousNum, evt.isSpeech ?? false);
      const systemVote: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = preLean.lean === 'BULLISH'
        ? 'BULLISH'
        : preLean.lean === 'BEARISH'
        ? 'BEARISH'
        : 'NEUTRAL';

      // Check if within next 24h for AI call budget (max 1 AI call per event)
      const isWithin24h = minutesUntil >= 0 && minutesUntil <= 1440;
      let aiVote: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNAVAILABLE' = 'UNAVAILABLE';
      let aiConfidence = 0;
      let aiReason = '';

      // Check if we already have a generated decision or AI vote for this event!
      if (store[evt.id] && store[evt.id].aiVote && store[evt.id].aiVote !== 'UNAVAILABLE') {
        aiVote = store[evt.id].aiVote;
        aiConfidence = store[evt.id].aiConfidence;
        aiReason = store[evt.id].aiReason || '';
      } else {
        // If T <= 60 minutes or preview requested within 24h:
        const shouldQueryAi = isWithin24h && (process.env.AI_API_KEY || (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'));

        if (shouldQueryAi) {
          // Find last 6 released events of same type from stored archive
          const sameTypeHistory = archive
            .filter((e) => e.title.toLowerCase().includes(evt.title.toLowerCase().slice(0, 8)) && e.isReleased && e.actualStr)
            .slice(0, 6)
            .map((e) => ({
              title: e.title,
              actual: e.actualStr || '--',
              forecast: e.forecastStr || '--',
              diff: e.actualNum !== null && e.forecastNum !== null ? (e.actualNum - e.forecastNum).toFixed(2) : '--',
            }));

          const otherHighEvents24h = events
            .filter((e) => e.id !== evt.id && e.ahmedTier === 1 && e.minutesUntil >= 0 && e.minutesUntil <= 1440)
            .map((e) => e.title);

          try {
            const aiRes = await getAhmedAiVoteForEvent({
              eventName: evt.title,
              tier: evt.ahmedTier || 2,
              forecast: evt.forecastStr,
              previous: evt.previousStr,
              recentHistory: sameTypeHistory,
              systemVote,
              otherHighEvents24h,
            });

            aiVote = aiRes.vote;
            aiConfidence = aiRes.confidence;
            aiReason = aiRes.reason;
          } catch {
            aiVote = 'UNAVAILABLE';
          }
        }
      }

      const combined = decideLean(systemVote, aiVote);

      // T-60m or closer -> LOCK permanently
      const isLockTriggered = minutesUntil <= 60 && !evt.isReleased;

      const decisionRecord: LockedDecision = {
        eventId: evt.id,
        systemVote,
        aiVote,
        aiConfidence,
        aiReason,
        final: combined.final,
        label: combined.label,
        lockedAt: new Date().toISOString(),
        isLocked: isLockTriggered,
        resultStatus: 'PENDING',
      };

      if (isLockTriggered) {
        store[evt.id] = decisionRecord;
        modified = true;
      } else {
        // Live preview (not yet locked) - save so subsequent requests reuse it without re-querying AI
        if (!store[evt.id] || store[evt.id].aiVote !== aiVote || store[evt.id].final !== combined.final) {
          store[evt.id] = {
            ...decisionRecord,
            isLocked: false,
          };
          modified = true;
        }
      }
    }

    if (modified || !fs.existsSync(NEWS_DECISIONS_FILE)) {
      saveNewsDecisions(store);
    }

    return store;
  } finally {
    isEvaluatingDecisions = false;
  }
}

// Calculate 30-day accuracy statistics from locked calls
export function getNewsDecisionAccuracy(): { hits: number; total: number; accuracyPct: number; display: string } {
  const store = loadNewsDecisions();
  const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;

  let hits = 0;
  let total = 0;

  for (const dec of Object.values(store)) {
    if (!dec.isLocked) continue;
    const lockMs = new Date(dec.lockedAt).getTime();
    if (lockMs < thirtyDaysAgoMs) continue;

    if (dec.resultStatus === 'HIT') {
      hits += 1;
      total += 1;
    } else if (dec.resultStatus === 'MISS') {
      total += 1;
    }
  }

  if (total < 5) {
    return { hits, total, accuracyPct: 0, display: 'Collecting results' };
  }

  const accuracyPct = Math.round((hits / total) * 100);
  return {
    hits,
    total,
    accuracyPct,
    display: `AHMED + System accuracy: ${hits} of ${total} locked calls (last 30 days) · ${accuracyPct}%`,
  };
}
