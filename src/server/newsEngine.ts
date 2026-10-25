import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { getClosedCandles } from './candleEngine.ts';
import { getCurrentSettings } from './settingsEngine.ts';

import { DATA_DIR } from './deploymentSafety.ts';
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
import {
  newsDecision,
  NewsDecisionObject,
  loadStoredDecisionRecords,
  saveStoredDecisionRecords,
  getCalibrationTable30d,
  CalibrationBucketRow,
} from './newsDecision.ts';
import { getCachedMacroData } from './macroFeedEngine.ts';
import { sendTelegramHttpRequest } from './telegramWorker.ts';

export { isNoConsensusEvent, newsDecision, getCalibrationTable30d };

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
  history?: {
    label: string;
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    sampleSize: number;
  } | null;
  newsDecision?: NewsDecisionObject | null;
  calendarOrigin?: 'FEED' | 'STATIC CALENDAR';
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

// Static calendar releases not from Forex Factory feed (Round 15 Item 3)
// CPI Nov 12, NFP Nov 6, FOMC Oct 28
export const STATIC_CALENDAR_EVENTS: Array<RawForexFactoryEvent & { calendarOrigin: 'STATIC CALENDAR' }> = [
  {
    title: 'FOMC Statement & Rate Decision',
    country: 'USD',
    date: '2026-10-28T18:00:00.000Z',
    impact: 'High',
    forecast: '4.75%',
    previous: '5.00%',
    calendarOrigin: 'STATIC CALENDAR',
  },
  {
    title: 'Non-Farm Employment Change',
    country: 'USD',
    date: '2026-11-06T13:30:00.000Z',
    impact: 'High',
    forecast: '165K',
    previous: '142K',
    calendarOrigin: 'STATIC CALENDAR',
  },
  {
    title: 'CPI m/m & y/y',
    country: 'USD',
    date: '2026-11-12T13:30:00.000Z',
    impact: 'High',
    forecast: '0.2%',
    previous: '0.2%',
    calendarOrigin: 'STATIC CALENDAR',
  },
];

export function transformRawEvent(
  raw: RawForexFactoryEvent,
  existingArchive?: NewsEvent[],
  origin: 'FEED' | 'STATIC CALENDAR' = 'FEED'
): NewsEvent {
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

  const ahmedTier = getAhmedEventTier(raw.title);
  const tier: NewsTier = ahmedTier === 1 ? 'TIER_1' : ahmedTier === 2 ? 'TIER_2' : 'NONE';
  const unifiedImpact: NewsImpact =
    raw.impact === 'Holiday' || raw.impact === 'High' || raw.impact === 'Medium' || raw.impact === 'Low'
      ? (raw.impact as NewsImpact)
      : ahmedTier === 1
      ? 'High'
      : ahmedTier === 2
      ? 'Medium'
      : 'Low';
  const isHigh = unifiedImpact === 'High' || ahmedTier === 1 || ahmedTier === 2;
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
    impact: unifiedImpact,
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
    calendarOrigin: origin,
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

    // Transform and de-duplicate feed events (marked as 'FEED')
    const seenIds = new Set<string>();
    const newTransformed: NewsEvent[] = [];

    for (const raw of usdEvents) {
      const transformed = transformRawEvent(raw, archive, 'FEED');
      if (!seenIds.has(transformed.id)) {
        seenIds.add(transformed.id);
        newTransformed.push(transformed);
      }
    }

    // Merge static calendar events when not present in feed ("Prefer the feed when it has the event")
    // Static calendar: CPI Nov 12, NFP Nov 6 and FOMC Oct 28
    for (const staticRaw of STATIC_CALENDAR_EVENTS) {
      const staticDateStr = staticRaw.date.slice(0, 10);
      const isFomc = staticRaw.title.toLowerCase().includes('fomc');
      const isNfp = staticRaw.title.toLowerCase().includes('non-farm') || staticRaw.title.toLowerCase().includes('nfp');
      const isCpi = staticRaw.title.toLowerCase().includes('cpi');

      const feedHasEvent = newTransformed.some((feedEvt) => {
        const feedDateStr = feedEvt.timeUtc.slice(0, 10);
        if (feedDateStr !== staticDateStr) return false;
        const feedT = feedEvt.title.toLowerCase();
        if (isFomc && (feedT.includes('fomc') || feedT.includes('rate decision') || feedT.includes('fed funds'))) return true;
        if (isNfp && (feedT.includes('non-farm') || feedT.includes('nfp') || feedT.includes('payroll'))) return true;
        if (isCpi && feedT.includes('cpi')) return true;
        return false;
      });

      if (!feedHasEvent) {
        const transformedStatic = transformRawEvent(staticRaw, archive, 'STATIC CALENDAR');
        if (!seenIds.has(transformedStatic.id)) {
          seenIds.add(transformedStatic.id);
          newTransformed.push(transformedStatic);
        }
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
  const isCatalystTier =
    event.tier === 'TIER_1' ||
    event.tier === 'TIER_2' ||
    event.ahmedTier === 1 ||
    event.ahmedTier === 2;

  // Timeline Rule: pause signals -30m to +15m around high/medium catalyst releases
  if (isCatalystTier) {
    const preMins = event.tier === 'TIER_1' ? Math.max(30, settings.tier1PreMinutes ?? 30) : 30;
    const postMins = event.tier === 'TIER_1' ? Math.max(15, settings.tier1PostMinutes ?? 15) : 15;

    if (mins >= 0 && mins <= preMins) {
      return { isLocked: true, lockType: 'PRE_RELEASE' };
    }
    if (mins < 0 && mins >= -postMins) {
      return { isLocked: true, lockType: 'POST_RELEASE' };
    }

    if (event.tier === 'TIER_1' && mins < -postMins && mins >= -(postMins + 60)) {
      const m15Candles = getClosedCandles('M15');
      if (m15Candles.length >= 20) {
        const last20 = m15Candles.slice(-20);
        const avgRange = last20.reduce((acc, c) => acc + (c.high - c.low), 0) / 20;
        const currentBar = m15Candles[m15Candles.length - 1];
        const currentRange = currentBar.high - currentBar.low;
        if (currentRange > 1.5 * avgRange) {
          return { isLocked: true, lockType: 'VOLATILITY_SETTLE' };
        }
      }
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
      if (manualEntry.source === 'UNVERIFIED' || !manualEntry.verified) {
        actualStr = 'PENDING';
        actualNum = null;
        actualSource = 'UNVERIFIED';
      } else {
        actualStr = manualEntry.actual;
        actualNum = parseFinancialNumber(manualEntry.actual);
        actualSource = manualEntry.source;
      }
      goldImpactExplanation = manualEntry.explanation;
    } else if (actualSource === 'UNVERIFIED') {
      actualStr = 'PENDING';
      actualNum = null;
    }

    const goldImpact = computeGoldImpact(evt.title, evt.forecastNum, actualNum, isReleased);
    const ahmedTier = getAhmedEventTier(evt.title);
    const tier: NewsTier = ahmedTier === 1 ? 'TIER_1' : ahmedTier === 2 ? 'TIER_2' : 'NONE';
    const unifiedImpact: NewsImpact =
      evt.impact === 'Holiday' || evt.impact === 'High' || evt.impact === 'Medium' || evt.impact === 'Low'
        ? evt.impact
        : ahmedTier === 1
        ? 'High'
        : ahmedTier === 2
        ? 'Medium'
        : 'Low';
    const isHighImpactUsd = unifiedImpact === 'High' || ahmedTier === 1 || ahmedTier === 2;
    const lockEval = evaluateTieredLock({ ...evt, tier, impact: unifiedImpact, isHighImpactUsd, minutesUntil, isReleased }, settings);
    const isSpeech = evt.isSpeech ?? isSpeechEvent(evt.title);
    const scenarios = buildGoldDirectionScenarios(evt.title, evt.forecastNum, evt.previousNum, actualNum, isReleased);

    return {
      ...evt,
      impact: unifiedImpact,
      tier,
      ahmedTier,
      isHighImpactUsd,
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

export function getNewsEventsForUI(): NewsEvent[] {
  getNewsFeedStatus();

  // Ensure static calendar events are present if not in feed (prefer feed when present)
  for (const staticRaw of STATIC_CALENDAR_EVENTS) {
    const staticDateStr = staticRaw.date.slice(0, 10);
    const isFomc = staticRaw.title.toLowerCase().includes('fomc');
    const isNfp = staticRaw.title.toLowerCase().includes('non-farm') || staticRaw.title.toLowerCase().includes('nfp');
    const isCpi = staticRaw.title.toLowerCase().includes('cpi');

    const feedHasEvent = cachedEvents.some((feedEvt) => {
      const feedDateStr = feedEvt.timeUtc.slice(0, 10);
      if (feedDateStr !== staticDateStr) return false;
      const feedT = feedEvt.title.toLowerCase();
      if (isFomc && (feedT.includes('fomc') || feedT.includes('rate decision') || feedT.includes('fed funds'))) return true;
      if (isNfp && (feedT.includes('non-farm') || feedT.includes('nfp') || feedT.includes('payroll'))) return true;
      if (isCpi && feedT.includes('cpi')) return true;
      return false;
    });

    if (!feedHasEvent && !cachedEvents.some((e) => e.id === generateEventId(staticRaw))) {
      cachedEvents.push(transformRawEvent(staticRaw, undefined, 'STATIC CALENDAR'));
    }
  }

  const rawList = cachedEvents;
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
      if (manualEntry.source === 'UNVERIFIED' || !manualEntry.verified) {
        actualStr = 'PENDING';
        actualNum = null;
        actualSource = 'UNVERIFIED';
      } else {
        actualStr = manualEntry.actual;
        actualNum = parseFinancialNumber(manualEntry.actual);
        actualSource = manualEntry.source;
      }
      goldImpactExplanation = manualEntry.explanation;
    } else if (actualSource === 'UNVERIFIED') {
      actualStr = 'PENDING';
      actualNum = null;
    }

    const goldImpact = computeGoldImpact(evt.title, evt.forecastNum, actualNum, isReleased);
    const ahmedTier = getAhmedEventTier(evt.title);
    const tier: NewsTier = ahmedTier === 1 ? 'TIER_1' : ahmedTier === 2 ? 'TIER_2' : 'NONE';
    const unifiedImpact: NewsImpact =
      evt.impact === 'Holiday' || evt.impact === 'High' || evt.impact === 'Medium' || evt.impact === 'Low'
        ? evt.impact
        : ahmedTier === 1
        ? 'High'
        : ahmedTier === 2
        ? 'Medium'
        : 'Low';
    const isHighImpactUsd = unifiedImpact === 'High' || ahmedTier === 1 || ahmedTier === 2;
    const lockEval = evaluateTieredLock({ ...evt, tier, impact: unifiedImpact, isHighImpactUsd, minutesUntil, isReleased });
    const isSpeech = evt.isSpeech ?? isSpeechEvent(evt.title);
    const scenarios = buildGoldDirectionScenarios(evt.title, evt.forecastNum, evt.previousNum, actualNum, isReleased);
    const preNewsLean = computePreNewsLean(evt.title, evt.forecastNum, evt.previousNum, isSpeech);
    const decisionsStore = loadNewsDecisions();
    const decision = decisionsStore[evt.id] || null;

    // Calculate authentic historical performance for same-type releases
    const archive = load30DayArchive();
    const cleanTitle = evt.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const sameTypePastEvents = archive.filter((past) => {
      if (!past.isReleased || past.actualNum === null || past.forecastNum === null) return false;
      const pastClean = past.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      return pastClean.includes(cleanTitle.slice(0, 10)) || cleanTitle.includes(pastClean.slice(0, 10));
    });

    let history: NewsEvent['history'] = null;
    if (sameTypePastEvents.length > 0) {
      let bullCount = 0;
      let bearCount = 0;
      const isReversed =
        evt.title.toLowerCase().includes('unemployment') ||
        evt.title.toLowerCase().includes('jobless claims');
      for (const p of sameTypePastEvents) {
        const diff = p.actualNum! - p.forecastNum!;
        if (Math.abs(diff) > 0.0001) {
          if (isReversed) {
            if (diff > 0) bullCount++;
            else bearCount++;
          } else {
            if (diff < 0) bullCount++;
            else bearCount++;
          }
        }
      }
      const total = bullCount + bearCount;
      if (total > 0) {
        const sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
          bullCount > bearCount ? 'BULLISH' : bearCount > bullCount ? 'BEARISH' : 'NEUTRAL';
        const favored = sentiment === 'BULLISH' ? bullCount : sentiment === 'BEARISH' ? bearCount : bullCount;
        const pct = Math.round((favored / total) * 100);
        history = {
          label: `History: ${pct}% ${sentiment === 'BULLISH' ? 'Bull' : sentiment === 'BEARISH' ? 'Bear' : 'Mixed'} (${total}p)`,
          sentiment,
          sampleSize: total,
        };
      }
    }

    const playbook = getEventPlaybook(evt.title, isSpeech);
    const enrichedEventBase = {
      ...evt,
      impact: unifiedImpact,
      tier,
      ahmedTier,
      isHighImpactUsd,
      isSpeech,
      scenarios,
      preNewsLean,
      playbook,
      decision,
      history,
      minutesUntil,
      isReleased,
      isInsideLockWindow: lockEval.isLocked,
      lockType: lockEval.lockType,
      actualStr,
      actualNum,
      actualSource,
      goldImpact,
      goldImpactExplanation,
      calendarOrigin: evt.calendarOrigin || 'FEED',
    };

    const nd = newsDecision(enrichedEventBase, {
      macro: getCachedMacroData(),
      archive,
    });

    return {
      ...enrichedEventBase,
      newsDecision: nd,
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
  const isVerified = source === 'MANUAL' && actualValue.trim().toUpperCase() !== 'PENDING';
  manualActuals[eventId] = {
    actual: isVerified ? actualValue.trim() : 'PENDING',
    source: isVerified ? 'MANUAL' : 'UNVERIFIED',
    verified: isVerified,
    note,
    explanation,
  };
  saveManualActuals();
}

export async function lookupActualValueWithGemini(
  event: NewsEvent
): Promise<{ actual: string; explanation: string; verified?: boolean }> {
  const hasVerifiedFeedActual =
    event.isReleased &&
    Boolean(event.actualStr) &&
    event.actualStr !== 'PENDING' &&
    event.actualStr !== '--' &&
    (event.actualSource === 'FEED' || event.actualSource === 'MANUAL');

  // Strict rule: Never guess an unverified actual value with Gemini. Always return PENDING when unverified.
  if (!hasVerifiedFeedActual) {
    return {
      actual: 'PENDING',
      explanation: 'Official actual figure is not yet verified in the live feed — showing PENDING (guessing disabled).',
      verified: false,
    };
  }

  const verifiedActual = event.actualStr!;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return {
      actual: verifiedActual,
      explanation: `Verified actual print ${verifiedActual} vs forecast ${event.forecastStr || 'N/A'}.`,
      verified: true,
    };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });
    const rawModel = (process.env.GEMINI_MODEL || "").trim();
    const model = (!rawModel || rawModel.includes("gemini-2.5-flash") || rawModel.includes("gemini-2.0") || rawModel.includes("gemini-1.5")) ? "gemini-3.8-flash" : rawModel;

    const prompt = `You are SARRAF News Intelligence Assistant.
Explain in 1 short sentence (max 20 words) the gold (XAU/USD) impact of this verified macroeconomic release.
DO NOT invent or alter any numbers.
Event: ${event.title} (${event.country})
Verified Actual: ${verifiedActual}
Forecast: ${event.forecastStr || 'N/A'}
Previous: ${event.previousStr || 'N/A'}

Return ONLY valid JSON:
{"explanation":"max 20 words rationale"}`;

    const res = await ai.models.generateContent({
      model,
      contents: prompt,
    });

    const text = res.text?.trim() || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return {
        actual: verifiedActual,
        explanation: `Verified actual print ${verifiedActual} vs forecast ${event.forecastStr || 'N/A'}.`,
        verified: true,
      };
    }
    const parsed = JSON.parse(match[0]);
    return {
      actual: verifiedActual,
      explanation: (parsed.explanation || `Verified actual print ${verifiedActual}.`).slice(0, 140),
      verified: true,
    };
  } catch (err: any) {
    console.warn('[NEWS ENGINE] Gemini lookup error:', err.message);
    return {
      actual: verifiedActual,
      explanation: `Verified actual print ${verifiedActual} vs forecast ${event.forecastStr || 'N/A'}.`,
      verified: true,
    };
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

// Evaluate decisions for all events, locking at T-60m, confirming at +5m, and evaluating HIT/MISS at +15m
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
    const macro = getCachedMacroData();

    for (const evt of events) {
      const isUsd = evt.country === 'USD';
      const tier = evt.ahmedTier || 3;
      const isHighOrMed = tier === 1 || tier === 2;
      if (!isUsd || !isHighOrMed) continue;

      const eventTimeMs = new Date(evt.timeUtc).getTime();
      const minutesUntil = Math.round((eventTimeMs - now) / 60000);

      // 1. Obtain or reuse AHMED AI vote if within 24h pre-news
      const isWithin24h = minutesUntil >= 0 && minutesUntil <= 1440;
      let aiVote: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNAVAILABLE' =
        store[evt.id]?.aiVote || 'UNAVAILABLE';
      let aiConfidence = store[evt.id]?.aiConfidence || 0;
      let aiReason = store[evt.id]?.aiReason || '';

      const preLean = computePreNewsLean(evt.title, evt.forecastNum, evt.previousNum, evt.isSpeech ?? false);
      const systemVote: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
        preLean.lean === 'BULLISH'
          ? 'BULLISH'
          : preLean.lean === 'BEARISH'
          ? 'BEARISH'
          : 'NEUTRAL';

      if (
        aiVote === 'UNAVAILABLE' &&
        isWithin24h &&
        (process.env.AI_API_KEY ||
          (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'))
      ) {
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

      // 2. Evaluate unified server-side newsDecision(event)
      const nd = newsDecision(
        {
          ...evt,
          minutesUntil,
          isReleased: now >= eventTimeMs,
          decision: {
            ...(store[evt.id] || {}),
            systemVote,
            aiVote,
            aiConfidence,
            aiReason,
          },
        },
        { macro, archive }
      );

      // 3. Dispatch ONE Telegram message at T-60m lock and ONE at +5m confirm
      const v2Records = loadStoredDecisionRecords();
      const v2Rec = v2Records[evt.id];

      if (
        v2Rec &&
        minutesUntil > 0 &&
        minutesUntil <= 60 &&
        nd.lockedAt &&
        (nd.word as string) !== 'SKIP' &&
        !v2Rec.telegramLockSentAt
      ) {
        v2Rec.telegramLockSentAt = new Date().toISOString();
        saveStoredDecisionRecords(v2Records);

        // Requirement 8: Telegram sends a neutral heads-up at T-60m without a direction
        const lockMsg = [
          `🔔 <b>UPCOMING MACRO EVENT (T-60m HEADS-UP)</b>`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `📌 <b>Event:</b> ${evt.title} (${evt.displayTime || evt.timeUtc})`,
          `📊 <b>Consensus:</b> Forecast ${evt.forecastStr || '--'} | Previous ${evt.previousStr || '--'}`,
          `ℹ️ <i>Pre-news directional call suppressed (unproven). Post-release CONFIRMED signal will be issued at T+5m upon reaction verification.</i>`,
        ]
          .filter(Boolean)
          .join('\n');

        sendTelegramHttpRequest(
          lockMsg,
          undefined,
          undefined,
          undefined,
          'HTML',
          `news_lock_${evt.id}`
        ).catch(() => {});
      }

      // Round 6 Item 8: Suspend post-release Telegram decisions until Item 5 is verified with real tick data.
      // The neutral T-60m heads-up above remains active.
      if (false) {
        if (
          v2Rec &&
          now >= eventTimeMs &&
          minutesUntil <= -5 &&
          nd.phase === 'confirmed' &&
          nd.word !== 'WAIT' &&
          (nd.word as string) !== 'SKIP' &&
          !v2Rec.telegramConfirmSentAt &&
          evt.actualStr &&
          evt.actualStr !== 'PENDING'
        ) {
          v2Rec.telegramConfirmSentAt = new Date().toISOString();
          saveStoredDecisionRecords(v2Records);

          const inputsLine = nd.inputs
            .map((i) => `${i.label} (${i.normalizedWeight}%)`)
            .join(' | ');
          const confDisp = nd.word === 'WAIT' ? 'no call' : `${nd.confidence}% confidence`;
          const scoreStr = nd.score === null ? 'no call' : `${nd.score >= 0 ? '+' : ''}${nd.score}`;
          const confirmMsg = [
            `✅ <b>NEWS DECISION CONFIRMED (+5m WINDOW)</b>`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `📌 <b>Event:</b> ${evt.title} (Actual: <b>${evt.actualStr}</b> vs Forecast: ${evt.forecastStr || '--'})`,
            `🎯 <b>Verdict:</b> <b>${nd.word}</b> · <b>${confDisp}</b> (score ${scoreStr})`,
            `💬 <b>Reason:</b> ${nd.reason}`,
            inputsLine ? `🧩 <b>5m Breakdown:</b> ${inputsLine}` : '',
          ]
            .filter(Boolean)
            .join('\n');

          sendTelegramHttpRequest(
            confirmMsg,
            undefined,
            undefined,
            undefined,
            'HTML',
            `news_confirm_${evt.id}`
          ).catch(() => {});
        }
      }

      // 4. Sync legacy LockedDecision store with newsDecision output
      const mappedFinal: 'BULLISH' | 'BEARISH' | 'WAIT' | 'WAITING' =
        nd.word === 'BULLISH' ? 'BULLISH' : nd.word === 'BEARISH' ? 'BEARISH' : 'WAIT';
      const mappedStatus: 'HIT' | 'MISS' | 'NEUTRAL' | 'PENDING' =
        nd.resultStatus === 'HIT'
          ? 'HIT'
          : nd.resultStatus === 'MISS'
          ? 'MISS'
          : nd.resultStatus === 'WAIT'
          ? 'NEUTRAL'
          : 'PENDING';

      const prevRecord = store[evt.id];
      const nextRecord: LockedDecision = {
        eventId: evt.id,
        systemVote,
        aiVote,
        aiConfidence,
        aiReason,
        final: mappedFinal,
        label: nd.phase === 'confirmed' ? 'CONFIRMED' : nd.phase === 'mixed' ? 'CONFLICT' : 'RULES ONLY',
        lockedAt: nd.lockedAt || prevRecord?.lockedAt || new Date().toISOString(),
        isLocked: Boolean(nd.lockedAt || minutesUntil <= 60),
        resultStatus: mappedStatus,
        goldMove15m: nd.goldMove15m ?? prevRecord?.goldMove15m,
      };

      if (
        !prevRecord ||
        prevRecord.final !== nextRecord.final ||
        prevRecord.isLocked !== nextRecord.isLocked ||
        prevRecord.resultStatus !== nextRecord.resultStatus ||
        prevRecord.aiVote !== nextRecord.aiVote
      ) {
        store[evt.id] = nextRecord;
        modified = true;
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

// Calculate 30-day accuracy statistics and calibration table from locked calls (WAIT is not a miss)
export function getNewsDecisionAccuracy(): {
  hits: number;
  total: number;
  accuracyPct: number;
  display: string;
  calibrationTable: CalibrationBucketRow[];
} {
  const v2Records = loadStoredDecisionRecords();
  const store = loadNewsDecisions();
  const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;

  let hits = 0;
  let total = 0;
  const countedIds = new Set<string>();

  for (const rec of Object.values(v2Records)) {
    const evtMs = new Date(rec.eventTimeUtc).getTime();
    if (isNaN(evtMs) || evtMs < thirtyDaysAgoMs) continue;
    if (rec.resultStatus === 'HIT') {
      hits += 1;
      total += 1;
      countedIds.add(rec.eventId);
    } else if (rec.resultStatus === 'MISS') {
      total += 1;
      countedIds.add(rec.eventId);
    }
  }

  for (const dec of Object.values(store)) {
    if (countedIds.has(dec.eventId) || !dec.isLocked) continue;
    const lockMs = new Date(dec.lockedAt).getTime();
    if (lockMs < thirtyDaysAgoMs) continue;

    if (dec.resultStatus === 'HIT') {
      hits += 1;
      total += 1;
    } else if (dec.resultStatus === 'MISS') {
      total += 1;
    }
  }

  const calibrationTable = getCalibrationTable30d();

  if (total === 0) {
    return { hits: 0, total: 0, accuracyPct: 0, display: 'Backtest: unverified', calibrationTable };
  }

  const accuracyPct = Math.round((hits / total) * 100);
  return {
    hits,
    total,
    accuracyPct,
    display: `30d Calibrated Hit Rate: ${hits}/${total} (${accuracyPct}%) · WAIT excluded`,
    calibrationTable,
  };
}

/**
 * Requirement 3 (Round 5): Event lookup must match the upcoming event by exact id
 * and release time inside the live feed window, never by title against historical records.
 */
export function matchUpcomingEventByIdAndTime(
  targetId: string,
  releaseTimeUtc: string,
  liveRawEvents: RawForexFactoryEvent[]
): RawForexFactoryEvent | null {
  for (const raw of liveRawEvents) {
    const rawId = generateEventId(raw);
    const rawTimeUtc = new Date(raw.date).toISOString();
    if (rawId === targetId && Math.abs(new Date(releaseTimeUtc).getTime() - new Date(rawTimeUtc).getTime()) < 60_000) {
      return raw;
    }
  }
  return null;
}

/**
 * Requirement 3 (Round 5): Test that the forecast and previous of every upcoming event
 * strictly equal the live feed values, and make the audit fail loudly if they do not.
 */
export function validateUpcomingEventAgainstLiveFeed(
  event: NewsEvent,
  rawLiveEvent: RawForexFactoryEvent
): void {
  const feedForecast = (rawLiveEvent.forecast || '').trim();
  const feedPrevious = (rawLiveEvent.previous || '').trim();
  const evtForecast = (event.forecastStr || '').trim();
  const evtPrevious = (event.previousStr || '').trim();

  if (evtForecast !== feedForecast) {
    throw new Error(
      `[AUDIT INTEGRITY VIOLATION] Event "${event.title}" forecast mismatch! Engine has "${evtForecast}", live feed has "${feedForecast}". Audit aborted.`
    );
  }

  if (evtPrevious !== feedPrevious) {
    throw new Error(
      `[AUDIT INTEGRITY VIOLATION] Event "${event.title}" previous mismatch! Engine has "${evtPrevious}", live feed has "${feedPrevious}". Audit aborted.`
    );
  }
}

/**
 * Requirement 5 (Round 5): Check that flags an event whose previous value changes
 * by more than 2% between fetches (distinguishing cross-country mapping bugs vs revisions).
 */
export function checkPreviousRevisionAnomaly(
  previousVal1: number | null,
  previousVal2: number | null,
  eventTitle: string
): { isAnomaly: boolean; pctChange: number; warning?: string } {
  if (previousVal1 == null || previousVal2 == null || previousVal1 === 0) {
    return { isAnomaly: false, pctChange: 0 };
  }
  const pctChange = Number((Math.abs((previousVal2 - previousVal1) / previousVal1) * 100).toFixed(2));
  if (pctChange > 2.0) {
    return {
      isAnomaly: true,
      pctChange,
      warning: `[DATA INTEGRITY ANOMALY] "${eventTitle}" previous value shifted by ${pctChange}% (> 2% threshold) between fetches (${previousVal1} vs ${previousVal2}). Possible feed revision or cross-country title collision.`,
    };
  }
  return { isAnomaly: false, pctChange };
}


