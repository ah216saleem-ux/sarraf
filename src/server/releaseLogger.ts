import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './deploymentSafety.ts';
import { newsDecision, NewsDecisionObject } from './newsDecision.ts';

export interface LiveTickPointSnapshot {
  targetTimestampMs: number;
  sampledAtMs: number | null;
  goldMid: number | null;
  dxy: number | null;
  us10y: number | null;
}

export interface LoggedReleaseEntry {
  eventId: string;
  title: string;
  country: string;
  impact: 'High' | 'Medium';
  releaseTimeIso: string;
  releaseTimestampMs: number;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  verdictAtTMinus60m: 'BULLISH' | 'BEARISH' | 'WAIT' | null;
  scoreAtTMinus60m: number | null;
  scoreDisplayAtTMinus60m: string | null;
  confidenceAtTMinus60m: number | null;
  ticks: {
    tMinus60m: LiveTickPointSnapshot;
    tMinus5m: LiveTickPointSnapshot;
    t0: LiveTickPointSnapshot;
    tPlus5m: LiveTickPointSnapshot;
    tPlus15m: LiveTickPointSnapshot;
  };
  outcomeStatus: 'PENDING' | 'COMPLETE' | 'INCOMPLETE_MISSING_TICKS';
  hit003Pct: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseLoggerSummary {
  storagePath: string;
  loggedReleasesCount: number;
  completedReleasesCount: number;
  incompleteReleasesCount: number;
  pendingReleasesCount: number;
  minRequiredForHitRate: number;
  hitRatePct: number | null;
  hitRateStatus: string;
  entries: LoggedReleaseEntry[];
}

const RELEASE_LOG_FILE = path.resolve(DATA_DIR, 'release_live_log.json');
const MIN_RELEASES_FOR_HIT_RATE = 30;
// Maximum allowed distance between target offset and live observation (2.5 minutes)
const SAMPLE_WINDOW_TOLERANCE_MS = 60 * 1000;

function createEmptyPoint(targetTimestampMs: number): LiveTickPointSnapshot {
  return {
    targetTimestampMs,
    sampledAtMs: null,
    goldMid: null,
    dxy: null,
    us10y: null,
  };
}

export function loadLoggedReleases(): LoggedReleaseEntry[] {
  try {
    if (!fs.existsSync(RELEASE_LOG_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(RELEASE_LOG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[ReleaseLogger] Failed to read release_live_log.json:', err);
    return [];
  }
}

export function saveLoggedReleases(entries: LoggedReleaseEntry[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(RELEASE_LOG_FILE, JSON.stringify(entries, null, 2), 'utf-8');
  } catch (err) {
    console.error('[ReleaseLogger] Failed to write release_live_log.json:', err);
  }
}

function parseNumOrNull(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

export interface LiveTickSamplerInput {
  nowMs?: number;
  events: Array<{
    id?: string;
    title: string;
    country?: string;
    currency?: string;
    impact: string;
    date?: string;
    time?: string;
    timestamp?: number;
    actual?: any;
    forecast?: any;
    previous?: any;
  }>;
  liveGoldMid: number | null;
  liveGoldLastQuoteAtMs: number | null;
  liveDxy: number | null;
  liveUs10y: number | null;
  computeDecisionAtTMinus60m?: (ev: any) => NewsDecisionObject;
}

/**
 * Samples LIVE ticks for every USD Medium and High release at:
 *   T-60m, T-5m, T, T+5m, T+15m
 * Rules (Round 9 Item 5 / Round 11 Item 5):
 *   - Store in persistent DATA_DIR (/app/data/release_live_log.json).
 *   - If a tick is missing at a time point, store null, never an estimate.
 *   - Capture allowed only within +/- 60 seconds of target time.
 */
export function sampleLiveReleaseTicks(input: LiveTickSamplerInput): ReleaseLoggerSummary {
  const nowMs = input.nowMs ?? Date.now();
  const entries = loadLoggedReleases();
  const byId = new Map<string, LoggedReleaseEntry>();
  for (const e of entries) {
    byId.set(e.eventId, e);
  }

  const quoteMs =
    typeof input.liveGoldLastQuoteAtMs === 'number'
      ? input.liveGoldLastQuoteAtMs
      : typeof input.liveGoldLastQuoteAtMs === 'string'
      ? new Date(input.liveGoldLastQuoteAtMs).getTime()
      : null;

  const isGoldFresh =
    input.liveGoldMid !== null &&
    Number.isFinite(input.liveGoldMid) &&
    input.liveGoldMid > 0 &&
    (quoteMs === null || !Number.isFinite(quoteMs) || Math.abs(nowMs - quoteMs) <= 5 * 60 * 1000);

  const currentGoldMid: number | null = isGoldFresh ? input.liveGoldMid : null;
  const currentDxy: number | null =
    input.liveDxy !== null && Number.isFinite(input.liveDxy) && input.liveDxy > 0 ? input.liveDxy : null;
  const currentUs10y: number | null =
    input.liveUs10y !== null && Number.isFinite(input.liveUs10y) && input.liveUs10y > 0 ? input.liveUs10y : null;

  let dirty = false;

  for (const ev of input.events || []) {
    const country = String(ev.country || ev.currency || '').toUpperCase();
    if (country !== 'USD' && country !== 'US') continue;

    const impRaw = String(ev.impact || '').toLowerCase();
    const impact: 'High' | 'Medium' | null =
      impRaw === 'high' ? 'High' : impRaw === 'medium' ? 'Medium' : null;
    if (!impact) continue;

    let releaseMs = typeof ev.timestamp === 'number' && ev.timestamp > 0 ? ev.timestamp : NaN;
    if (!Number.isFinite(releaseMs) && ev.date) {
      releaseMs = new Date(ev.date).getTime();
    }
    if (!Number.isFinite(releaseMs) || releaseMs <= 0) continue;

    const releaseIso = new Date(releaseMs).toISOString();
    const safeTitle = String(ev.title || 'Unknown').trim();
    const eventId = ev.id || `${safeTitle.replace(/\s+/g, '_')}_${releaseIso}`;

    const diffFromReleaseMs = nowMs - releaseMs;
    const isWithinTrackingHorizon =
      diffFromReleaseMs >= -70 * 60 * 1000 && diffFromReleaseMs <= 24 * 60 * 60 * 1000;

    let entry = byId.get(eventId);
    if (!entry && isWithinTrackingHorizon) {
      entry = {
        eventId,
        title: safeTitle,
        country: 'USD',
        impact,
        releaseTimeIso: releaseIso,
        releaseTimestampMs: releaseMs,
        actual: parseNumOrNull(ev.actual),
        forecast: parseNumOrNull(ev.forecast),
        previous: parseNumOrNull(ev.previous),
        verdictAtTMinus60m: null,
        scoreAtTMinus60m: null,
        scoreDisplayAtTMinus60m: null,
        confidenceAtTMinus60m: null,
        ticks: {
          tMinus60m: createEmptyPoint(releaseMs - 60 * 60 * 1000),
          tMinus5m: createEmptyPoint(releaseMs - 5 * 60 * 1000),
          t0: createEmptyPoint(releaseMs),
          tPlus5m: createEmptyPoint(releaseMs + 5 * 60 * 1000),
          tPlus15m: createEmptyPoint(releaseMs + 15 * 60 * 1000),
        },
        outcomeStatus: 'PENDING',
        hit003Pct: null,
        createdAt: new Date(nowMs).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
      };
      byId.set(eventId, entry);
      dirty = true;
    }

    if (!entry) continue;

    const parsedActual = parseNumOrNull(ev.actual);
    const parsedForecast = parseNumOrNull(ev.forecast);
    const parsedPrevious = parseNumOrNull(ev.previous);
    if (parsedActual !== null && entry.actual !== parsedActual) {
      entry.actual = parsedActual;
      dirty = true;
    }
    if (parsedForecast !== null && entry.forecast !== parsedForecast) {
      entry.forecast = parsedForecast;
      dirty = true;
    }
    if (parsedPrevious !== null && entry.previous !== parsedPrevious) {
      entry.previous = parsedPrevious;
      dirty = true;
    }

    const sampleKeys: Array<{ key: keyof LoggedReleaseEntry['ticks']; offsetMs: number }> = [
      { key: 'tMinus60m', offsetMs: -60 * 60 * 1000 },
      { key: 'tMinus5m', offsetMs: -5 * 60 * 1000 },
      { key: 't0', offsetMs: 0 },
      { key: 'tPlus5m', offsetMs: 5 * 60 * 1000 },
      { key: 'tPlus15m', offsetMs: 15 * 60 * 1000 },
    ];

    for (const { key, offsetMs } of sampleKeys) {
      const point = entry.ticks[key];
      const targetMs = releaseMs + offsetMs;
      point.targetTimestampMs = targetMs;

      if (
        (point.sampledAtMs === null || (point.goldMid === null && currentGoldMid !== null)) &&
        Math.abs(nowMs - targetMs) <= SAMPLE_WINDOW_TOLERANCE_MS
      ) {
        point.sampledAtMs = nowMs;
        point.goldMid = currentGoldMid;
        point.dxy = currentDxy;
        point.us10y = currentUs10y;
        dirty = true;

        console.log(
          `[LOGGER] ${safeTitle} releaseTime=${releaseIso} targetTime=${new Date(targetMs).toISOString()} captureTime=${new Date(nowMs).toISOString()} goldValue=${point.goldMid !== null ? point.goldMid : 'null'}`
        );

        if (key === 'tMinus60m') {
          const dec = input.computeDecisionAtTMinus60m
            ? input.computeDecisionAtTMinus60m(ev)
            : newsDecision(ev, { skipPersistence: true });
          entry.verdictAtTMinus60m = dec.word;
          entry.scoreAtTMinus60m = dec.score;
          entry.scoreDisplayAtTMinus60m = dec.scoreDisplay;
          entry.confidenceAtTMinus60m = dec.confidence;
        }
      }
    }

    // Update outcomeStatus once T+15m window has passed
    if (nowMs > releaseMs + 15 * 60 * 1000 + SAMPLE_WINDOW_TOLERANCE_MS) {
      const hasAllGoldTicks =
        entry.ticks.tMinus60m.goldMid !== null &&
        entry.ticks.tMinus5m.goldMid !== null &&
        entry.ticks.t0.goldMid !== null &&
        entry.ticks.tPlus5m.goldMid !== null &&
        entry.ticks.tPlus15m.goldMid !== null;

      const nextStatus: LoggedReleaseEntry['outcomeStatus'] = hasAllGoldTicks
        ? 'COMPLETE'
        : 'INCOMPLETE_MISSING_TICKS';

      if (entry.outcomeStatus !== nextStatus) {
        entry.outcomeStatus = nextStatus;
        dirty = true;
      }

      if (
        hasAllGoldTicks &&
        entry.verdictAtTMinus60m &&
        entry.verdictAtTMinus60m !== 'WAIT' &&
        entry.ticks.t0.goldMid !== null &&
        entry.ticks.tPlus15m.goldMid !== null
      ) {
        const t0Gold = entry.ticks.t0.goldMid;
        const t15Gold = entry.ticks.tPlus15m.goldMid;
        const movePct = ((t15Gold - t0Gold) / t0Gold) * 100;
        if (Math.abs(movePct) >= 0.03) {
          const actualDir = movePct > 0 ? 'BULLISH' : 'BEARISH';
          entry.hit003Pct = actualDir === entry.verdictAtTMinus60m;
        } else {
          entry.hit003Pct = false;
        }
      }
    }

    if (dirty) {
      entry.updatedAt = new Date(nowMs).toISOString();
    }
  }

  const finalEntries = Array.from(byId.values()).sort(
    (a, b) => a.releaseTimestampMs - b.releaseTimestampMs
  );

  if (dirty) {
    saveLoggedReleases(finalEntries);
  }

  return buildReleaseLoggerSummary(finalEntries);
}

export function buildReleaseLoggerSummary(entriesInput?: LoggedReleaseEntry[]): ReleaseLoggerSummary {
  const entries = entriesInput ?? loadLoggedReleases();
  const completed = entries.filter((e) => e.outcomeStatus === 'COMPLETE');
  const incomplete = entries.filter((e) => e.outcomeStatus === 'INCOMPLETE_MISSING_TICKS');
  const pending = entries.filter((e) => e.outcomeStatus === 'PENDING');

  // Round 9 Item 5: Do NOT compute any hit rate until at least 30 releases are logged
  let hitRatePct: number | null = null;
  let hitRateStatus = `unverified (${completed.length}/${MIN_RELEASES_FOR_HIT_RATE} completed live releases logged — hit rate disabled until >= ${MIN_RELEASES_FOR_HIT_RATE})`;

  if (completed.length >= MIN_RELEASES_FOR_HIT_RATE) {
    const directional = completed.filter((e) => e.hit003Pct !== null);
    if (directional.length > 0) {
      const hits = directional.filter((e) => e.hit003Pct === true).length;
      hitRatePct = Number(((hits / directional.length) * 100).toFixed(1));
      hitRateStatus = `${hitRatePct}% (${hits}/${directional.length} directional calls across ${completed.length} logged releases)`;
    }
  }

  return {
    storagePath: RELEASE_LOG_FILE,
    loggedReleasesCount: entries.length,
    completedReleasesCount: completed.length,
    incompleteReleasesCount: incomplete.length,
    pendingReleasesCount: pending.length,
    minRequiredForHitRate: MIN_RELEASES_FOR_HIT_RATE,
    hitRatePct,
    hitRateStatus,
    entries,
  };
}

export function getReleaseLoggerSummary(): ReleaseLoggerSummary {
  return buildReleaseLoggerSummary();
}
