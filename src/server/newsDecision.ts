import fs from 'fs';
import path from 'path';
import { DATA_DIR, writeJsonAtomic } from './deploymentSafety.ts';
import {
  getCachedMacroData,
  findMatchingPredictionMarketForEvent,
  LiveMacroData,
} from './macroFeedEngine.ts';
import { getLastValidTick } from './marketPriceEngine.ts';
import { getCandleStore } from './candleEngine.ts';

export const NEWS_DECISIONS_STORE_FILE = path.resolve(DATA_DIR, 'news_decisions_v2.json');

export type DecisionWord = 'BULLISH' | 'BEARISH' | 'WAIT' | 'SKIP';
export type DecisionPhase = 'pre' | 'provisional' | 'confirmed' | 'mixed';

export interface NewsDecisionInputItem {
  id:
    | 'forecast'
    | 'prediction_market'
    | 'gold_trend'
    | 'dollar_proxy'
    | 'us10y'
    | 'history'
    | 'ahmed_ai'
    | 'actual_surprise'
    | 'gold_reaction';
  name: string;
  label: string;
  rawWeight: number;
  normalizedWeight: number;
  direction: 1 | -1 | 0; // +1 = bullish for gold, -1 = bearish for gold, 0 = neutral
  rawScore: number; // -1..+1
  weightedScore: number; // -100..+100 contribution
  value: string;
  source?: string;
  ageMs?: number;
}

export interface CalibrationBucketRow {
  bucket: '50-59' | '60-69' | '70-79' | '80-89' | '90-100';
  min: number;
  max: number;
  midpoint: number;
  hits: number;
  misses: number;
  total: number;
  hitRatePct: number | null;
  calibratedConfidence: number | null;
  status: 'calibrated' | 'calibrating';
}

export interface NewsDecisionObject {
  word: DecisionWord;
  confidence: number; // 0..100 confidence (raw when bucket < 15 results, calibrated when >= 15)
  confidenceStatus: 'calibrated' | 'calibrating';
  rawConfidence: number; // 0..100 raw confidence
  score: number; // -100..100
  reason: string;
  inputs: NewsDecisionInputItem[];
  phase: DecisionPhase;
  lockedAt: string | null;
  // Extended fields for UI & audit
  eventId: string;
  eventTitle: string;
  resultStatus?: 'HIT' | 'MISS' | 'WAIT' | 'PENDING';
  goldMove15m?: number | null;
  calibrationBucket?: string;
}

export interface StoredEventDecisionRecord {
  eventId: string;
  eventTitle: string;
  eventTimeUtc: string;
  lockedAt: string | null;
  preLockSnapshot?: NewsDecisionObject;
  confirmedSnapshot?: NewsDecisionObject;
  releaseBaseline?: {
    capturedAt: number;
    goldPrice: number;
    usdProxyPct: number | null;
    us10yYield: number | null;
  };
  goldPriceAt15m?: number;
  goldMove15m?: number | null;
  resultStatus?: 'HIT' | 'MISS' | 'WAIT' | 'PENDING';
  resolvedAt?: string;
  telegramLockSentAt?: string;
  telegramConfirmSentAt?: string;
}

let decisionsMapCache: Record<string, StoredEventDecisionRecord> | null = null;

export function loadStoredDecisionRecords(): Record<string, StoredEventDecisionRecord> {
  if (decisionsMapCache !== null) return decisionsMapCache;
  try {
    if (fs.existsSync(NEWS_DECISIONS_STORE_FILE)) {
      const raw = fs.readFileSync(NEWS_DECISIONS_STORE_FILE, 'utf-8');
      decisionsMapCache = JSON.parse(raw) || {};
      return decisionsMapCache!;
    }
  } catch (err: any) {
    console.warn('[NEWS DECISION] Failed to read news_decisions_v2.json:', err.message);
  }
  decisionsMapCache = {};
  return decisionsMapCache;
}

export function saveStoredDecisionRecords(records: Record<string, StoredEventDecisionRecord>): void {
  decisionsMapCache = records;
  try {
    writeJsonAtomic(NEWS_DECISIONS_STORE_FILE, records);
  } catch (err: any) {
    console.warn('[NEWS DECISION] Failed to save news_decisions_v2.json:', err.message);
  }
}

/**
 * Determines if higher prints for this indicator are BULLISH for gold (inverse to CPI/NFP/ADP).
 * Jobless Claims & Unemployment Rate: higher number = weaker labor = weaker USD = BULLISH for Gold (+1).
 * CPI, Core CPI, PPI, NFP, ADP, Retail Sales, GDP, ISM, Fed Rate: higher number = stronger USD = BEARISH for Gold (-1).
 */
export function isEventInverseForGold(title: string): boolean {
  const t = title.toLowerCase();
  return (
    t.includes('unemployment claims') ||
    t.includes('jobless claims') ||
    t.includes('initial claims') ||
    t.includes('continuing claims') ||
    t.includes('unemployment rate')
  );
}

/**
 * Returns the typical surprise magnitude for a given economic indicator (in the same numeric scale as parseFinancialNumber).
 * Note: parseFinancialNumber converts 'K' -> *1000, 'M' -> *1e6, '%' -> raw number.
 */
export function getTypicalSurpriseSize(title: string, referenceVal?: number | null): number {
  const t = title.toLowerCase();
  if (t.includes('cpi') && (t.includes('m/m') || t.includes('mom'))) return 0.1;
  if (t.includes('cpi') && (t.includes('y/y') || t.includes('yoy'))) return 0.2;
  if (t.includes('ppi') && (t.includes('m/m') || t.includes('mom'))) return 0.15;
  if (t.includes('ppi') && (t.includes('y/y') || t.includes('yoy'))) return 0.25;
  if (t.includes('pce')) return 0.1;
  if (t.includes('non-farm') || t.includes('nfp') || t.includes('adp')) {
    // If parsed in thousands (e.g. 150000), typical surprise is 35,000; if raw 150, 35
    return referenceVal && Math.abs(referenceVal) >= 1000 ? 35_000 : 35;
  }
  if (t.includes('unemployment claims') || t.includes('jobless claims') || t.includes('initial claims')) {
    return referenceVal && Math.abs(referenceVal) >= 1000 ? 10_000 : 10;
  }
  if (t.includes('unemployment rate')) return 0.1;
  if (t.includes('retail sales')) return 0.3;
  if (t.includes('gdp')) return 0.3;
  if (t.includes('federal funds rate') || t.includes('interest rate')) return 0.25;
  if (t.includes('ism') || t.includes('pmi') || t.includes('nfib') || t.includes('confidence') || t.includes('sentiment')) {
    return 1.5;
  }
  if (t.includes('empire state') || t.includes('philly fed')) return 6.0;
  if (referenceVal !== null && referenceVal !== undefined && Math.abs(referenceVal) > 0) {
    return Math.max(0.1, Math.abs(referenceVal) * 0.05);
  }
  return 0.2;
}

/**
 * Computes the 30-day calibration table mapping confidence buckets to real hit rates.
 */
export function getCalibrationTable30d(): CalibrationBucketRow[] {
  const records = loadStoredDecisionRecords();
  const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const buckets: CalibrationBucketRow[] = [
    { bucket: '50-59', min: 50, max: 59, midpoint: 55, hits: 0, misses: 0, total: 0, hitRatePct: null, calibratedConfidence: null, status: 'calibrating' },
    { bucket: '60-69', min: 60, max: 69, midpoint: 65, hits: 0, misses: 0, total: 0, hitRatePct: null, calibratedConfidence: null, status: 'calibrating' },
    { bucket: '70-79', min: 70, max: 79, midpoint: 75, hits: 0, misses: 0, total: 0, hitRatePct: null, calibratedConfidence: null, status: 'calibrating' },
    { bucket: '80-89', min: 80, max: 89, midpoint: 85, hits: 0, misses: 0, total: 0, hitRatePct: null, calibratedConfidence: null, status: 'calibrating' },
    { bucket: '90-100', min: 90, max: 100, midpoint: 95, hits: 0, misses: 0, total: 0, hitRatePct: null, calibratedConfidence: null, status: 'calibrating' },
  ];

  for (const rec of Object.values(records)) {
    const evtMs = new Date(rec.eventTimeUtc).getTime();
    if (isNaN(evtMs) || evtMs < thirtyDaysAgoMs) continue;
    // WAIT is not a miss — only count resolved directional HIT or MISS
    if (rec.resultStatus !== 'HIT' && rec.resultStatus !== 'MISS') continue;

    const snap = rec.confirmedSnapshot || rec.preLockSnapshot;
    const rawConf = snap?.rawConfidence ?? snap?.confidence ?? 65;
    const b =
      buckets.find((row) => rawConf >= row.min && rawConf <= row.max) ||
      (rawConf < 50 ? buckets[0] : buckets[buckets.length - 1]);

    b.total += 1;
    if (rec.resultStatus === 'HIT') b.hits += 1;
    else b.misses += 1;
  }

  for (const b of buckets) {
    if (b.total > 0) {
      b.hitRatePct = Math.round((b.hits / b.total) * 100);
    } else {
      b.hitRatePct = null;
    }

    if (b.total >= 15 && b.hitRatePct !== null) {
      b.calibratedConfidence = b.hitRatePct;
      b.status = 'calibrated';
    } else {
      b.calibratedConfidence = null;
      b.status = 'calibrating';
    }
  }

  return buckets;
}

export function applyConfidenceCalibration(
  rawConfidence: number,
  phase: DecisionPhase
): { calibrated: number; bucket: string; status: 'calibrated' | 'calibrating' } {
  const clampedRaw = Math.max(0, Math.min(100, Math.round(rawConfidence)));
  if (clampedRaw === 0) return { calibrated: 0, bucket: '50-59', status: 'calibrating' };

  // Rule: Pre-news confidence capped at 70
  const cappedRaw =
    phase === 'pre'
      ? Math.min(70, Math.max(50, clampedRaw))
      : Math.min(98, Math.max(50, clampedRaw));

  const table = getCalibrationTable30d();
  const row =
    table.find((r) => cappedRaw >= r.min && cappedRaw <= r.max) ||
    (cappedRaw < 50 ? table[0] : table[table.length - 1]);

  // Rule: Use the raw confidence (labelled "calibrating") for any bucket with fewer than 15 results
  if (row.total < 15 || row.hitRatePct === null) {
    return { calibrated: cappedRaw, bucket: row.bucket, status: 'calibrating' };
  }

  let calibrated = row.hitRatePct;
  if (phase === 'pre') {
    calibrated = Math.min(70, Math.max(50, calibrated));
  } else {
    calibrated = Math.min(98, Math.max(50, calibrated));
  }

  return { calibrated, bucket: row.bucket, status: 'calibrated' };
}

/**
 * Finds historical gold reaction for an event from the 15m candle store or 30-day archive.
 */
function computeEventGoldHistoryInput(
  evt: any,
  archive: any[]
): { rawScore: number; direction: 1 | -1 | 0; value: string } | null {
  const cleanTitle = String(evt.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!cleanTitle) return null;

  const isInverse = isEventInverseForGold(evt.title);
  const records = loadStoredDecisionRecords();

  let bullReactions = 0;
  let bearReactions = 0;
  let totalMoveUsd = 0;
  let count = 0;

  // 1. Check stored 15m gold reaction records for this indicator
  for (const rec of Object.values(records)) {
    if (rec.eventId === evt.id) continue;
    const recClean = String(rec.eventTitle || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    if (!recClean.includes(cleanTitle.slice(0, 10)) && !cleanTitle.includes(recClean.slice(0, 10))) continue;
    if (typeof rec.goldMove15m === 'number' && Math.abs(rec.goldMove15m) >= 0.3) {
      count++;
      totalMoveUsd += rec.goldMove15m;
      if (rec.goldMove15m > 0) bullReactions++;
      else bearReactions++;
    }
  }

  // 2. Also check 30-day archive released prints
  if (Array.isArray(archive)) {
    for (const past of archive) {
      if (past.id === evt.id || !past.isReleased) continue;
      const pastClean = String(past.title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      if (!pastClean.includes(cleanTitle.slice(0, 10)) && !cleanTitle.includes(pastClean.slice(0, 10))) continue;
      if (past.actualNum !== null && past.actualNum !== undefined && past.forecastNum !== null && past.forecastNum !== undefined) {
        const diff = past.actualNum - past.forecastNum;
        if (Math.abs(diff) > 0.0001) {
          count++;
          const goldBull = isInverse ? diff > 0 : diff < 0;
          if (goldBull) bullReactions++;
          else bearReactions++;
        }
      }
    }
  }

  // 3. Also check if pre-computed evt.history was attached
  if (count === 0 && evt.history && evt.history.sampleSize > 0) {
    const dir: 1 | -1 | 0 =
      evt.history.sentiment === 'BULLISH' ? 1 : evt.history.sentiment === 'BEARISH' ? -1 : 0;
    return {
      rawScore: dir * 0.65,
      direction: dir,
      value: evt.history.label.replace(/^History:\s*/i, ''),
    };
  }

  if (count === 0) return null;

  const net = (bullReactions - bearReactions) / count;
  const direction: 1 | -1 | 0 = net > 0.15 ? 1 : net < -0.15 ? -1 : 0;
  const favored = direction >= 0 ? bullReactions : bearReactions;
  const pct = Math.round((favored / count) * 100);
  const avgMoveSuffix = totalMoveUsd !== 0 ? ` (avg ${totalMoveUsd > 0 ? '+' : ''}${(totalMoveUsd / count).toFixed(1)}$)` : '';

  return {
    rawScore: Number(Math.max(-1, Math.min(1, net)).toFixed(3)),
    direction,
    value: `${pct}% ${direction === 1 ? 'Bullish' : direction === -1 ? 'Bearish' : 'Mixed'} (${count}x)${avgMoveSuffix}`,
  };
}

/**
 * Core Server-Side Module: newsDecision(event)
 * Returns ONE unified decision object:
 * { word: BULLISH|BEARISH|WAIT|SKIP, confidence: 0-100, score: -100..100, reason, inputs[], phase: pre|provisional|confirmed|mixed, lockedAt }
 */
export function newsDecision(
  evt: any,
  options?: { macro?: LiveMacroData; archive?: any[] }
): NewsDecisionObject {
  const now = Date.now();
  const eventTimeMs = new Date(evt.timeUtc).getTime();
  const minutesUntil =
    typeof evt.minutesUntil === 'number'
      ? evt.minutesUntil
      : Math.round((eventTimeMs - now) / 60000);
  const isReleased = Boolean(evt.isReleased || now >= eventTimeMs);

  const isTier1Or2 =
    evt.ahmedTier === 1 ||
    evt.ahmedTier === 2 ||
    evt.impact === 'High' ||
    evt.impact === 'Medium';
  const isLowImpact =
    !isTier1Or2 &&
    (evt.impact === 'Holiday' ||
      ((evt.ahmedTier === 3 || evt.impact === 'Low') &&
        !evt.isSpeech &&
        !String(evt.title || '').toLowerCase().includes('fed')));

  // Gate: Low impact -> SKIP
  if (isLowImpact) {
    return {
      eventId: evt.id,
      eventTitle: evt.title,
      word: 'SKIP',
      confidence: 0,
      confidenceStatus: 'calibrating',
      rawConfidence: 0,
      score: 0,
      reason: 'Low-impact calendar release; skipped by macro filter.',
      inputs: [],
      phase: 'pre',
      lockedAt: null,
      resultStatus: 'WAIT',
    };
  }

  const records = loadStoredDecisionRecords();
  let rec = records[evt.id];
  if (!rec) {
    rec = {
      eventId: evt.id,
      eventTitle: evt.title,
      eventTimeUtc: evt.timeUtc,
      lockedAt: null,
    };
    records[evt.id] = rec;
  }

  const macro = options?.macro || getCachedMacroData();
  const isInverse = isEventInverseForGold(evt.title);

  // ============================================================================
  // POST-RELEASE EVALUATION (provisional 0..5m, confirmed/mixed after +5m)
  // ============================================================================
  if (isReleased) {
    const elapsedMs = Math.max(0, now - eventTimeMs);
    const elapsedMin = elapsedMs / 60_000;
    const liveTick = getLastValidTick();
    const tickFresh = now - (liveTick.lastReceivedAt || 0) <= 60_000;

    // Capture release baseline at T=0 if not yet stored
    if (!rec.releaseBaseline) {
      // Try to find candle open at eventTimeMs if release happened earlier
      let baseGold = liveTick.price;
      try {
        const store = getCandleStore();
        const m15 = store.M15 || [];
        const matchingCandle = m15.find(
          (c) => Math.abs(c.time * 1000 - eventTimeMs) <= 15 * 60_000
        );
        if (matchingCandle && matchingCandle.open > 0) {
          baseGold = matchingCandle.open;
        }
      } catch {}

      rec.releaseBaseline = {
        capturedAt: now,
        goldPrice: baseGold,
        usdProxyPct: macro.dollarProxy && !macro.dollarProxy.isStale ? macro.dollarProxy.compositeChangePct : null,
        us10yYield: macro.us10y && !macro.us10y.isStale ? macro.us10y.yield : null,
      };
      saveStoredDecisionRecords(records);
    }

    // At +15m, measure the gold move and store HIT or MISS (WAIT is not a miss)
    if (elapsedMin >= 15 && rec.resultStatus === undefined) {
      let move15m = liveTick.price - rec.releaseBaseline.goldPrice;
      try {
        const store = getCandleStore();
        const m15 = store.M15 || [];
        const releaseCandle = m15.find(
          (c) => Math.abs(c.time * 1000 - eventTimeMs) <= 15 * 60_000
        );
        if (releaseCandle) {
          move15m = releaseCandle.close - releaseCandle.open;
        }
      } catch {}

      rec.goldMove15m = Number(move15m.toFixed(2));
      const targetWord =
        rec.confirmedSnapshot?.word || rec.preLockSnapshot?.word || 'WAIT';

      if (targetWord === 'WAIT' || targetWord === 'SKIP') {
        rec.resultStatus = 'WAIT'; // WAIT is not a miss
      } else if (targetWord === 'BULLISH') {
        rec.resultStatus = rec.goldMove15m >= 0.5 ? 'HIT' : 'MISS';
      } else if (targetWord === 'BEARISH') {
        rec.resultStatus = rec.goldMove15m <= -0.5 ? 'HIT' : 'MISS';
      }
      rec.resolvedAt = new Date().toISOString();
      saveStoredDecisionRecords(records);
    }

    // If already confirmed/mixed after +5m and actual was present, return the locked post-release confirmation
    if (elapsedMin >= 5 && rec.confirmedSnapshot && evt.actualNum !== null && evt.actualNum !== undefined) {
      return {
        ...rec.confirmedSnapshot,
        resultStatus: rec.resultStatus || 'PENDING',
        goldMove15m: rec.goldMove15m ?? null,
      };
    }

    // Build the 4 post-release inputs:
    // 1. Actual vs Forecast (weight 50)
    // 2. Gold reaction (weight 25)
    // 3. Dollar (weight 15)
    // 4. Yield (weight 10)
    const postInputs: NewsDecisionInputItem[] = [];

    // Post Input 1: Actual vs Forecast (50)
    const refForecast = evt.forecastNum ?? evt.previousNum ?? null;
    if (
      evt.actualNum !== null &&
      evt.actualNum !== undefined &&
      refForecast !== null &&
      evt.actualStr &&
      evt.actualStr !== 'PENDING'
    ) {
      const surprise = evt.actualNum - refForecast;
      const typ = getTypicalSurpriseSize(evt.title, refForecast);
      const scaled = Math.max(-1, Math.min(1, surprise / typ));
      const goldScore = isInverse ? scaled : -scaled;
      const dir: 1 | -1 | 0 = goldScore > 0.05 ? 1 : goldScore < -0.05 ? -1 : 0;
      postInputs.push({
        id: 'actual_surprise',
        name: 'Actual vs Forecast',
        label: `Actual: ${evt.actualStr} vs F:${evt.forecastStr || evt.previousStr || '--'}`,
        rawWeight: 50,
        normalizedWeight: 0,
        direction: dir,
        rawScore: Number(goldScore.toFixed(3)),
        weightedScore: 0,
        value: `${evt.actualStr} vs ${evt.forecastStr || '--'}`,
        ageMs: 0,
      });
    }

    // Post Input 2: Gold reaction over 5m window (25)
    if (tickFresh && rec.releaseBaseline) {
      const goldDelta = Number((liveTick.price - rec.releaseBaseline.goldPrice).toFixed(2));
      const goldScore = Math.max(-1, Math.min(1, goldDelta / 6.0));
      const dir: 1 | -1 | 0 = goldDelta > 0.6 ? 1 : goldDelta < -0.6 ? -1 : 0;
      postInputs.push({
        id: 'gold_reaction',
        name: 'Gold 5m Reaction',
        label: `Gold Reaction: ${goldDelta >= 0 ? '+' : ''}$${goldDelta.toFixed(2)}`,
        rawWeight: 25,
        normalizedWeight: 0,
        direction: dir,
        rawScore: Number(goldScore.toFixed(3)),
        weightedScore: 0,
        value: `${goldDelta >= 0 ? '+' : ''}$${goldDelta.toFixed(2)}`,
        ageMs: now - liveTick.lastReceivedAt,
      });
    }

    // Post Input 3: Dollar strength proxy (15)
    if (macro.dollarProxy && !macro.dollarProxy.isStale) {
      const dp = macro.dollarProxy;
      postInputs.push({
        id: 'dollar_proxy',
        name: 'Dollar proxy',
        label: `Dollar proxy: ${dp.compositeChangePct >= 0 ? '+' : ''}${dp.compositeChangePct.toFixed(2)}%`,
        rawWeight: 15,
        normalizedWeight: 0,
        direction: dp.goldDirection,
        rawScore: dp.goldScore,
        weightedScore: 0,
        value: `${dp.compositeChangePct >= 0 ? '+' : ''}${dp.compositeChangePct.toFixed(2)}%`,
        source: 'BiQuote EURUSD/USDJPY/GBPUSD',
        ageMs: dp.ageMs,
      });
    }

    // Post Input 4: US10Y yield change (10)
    if (macro.us10y && !macro.us10y.isStale) {
      const y = macro.us10y;
      const goldScore = Math.max(-1, Math.min(1, Number((-y.changeBp / 5).toFixed(3))));
      const dir: 1 | -1 | 0 = y.changeBp <= -1 ? 1 : y.changeBp >= 1 ? -1 : 0;
      postInputs.push({
        id: 'us10y',
        name: 'US10Y Yield',
        label: `US10Y: ${y.yield.toFixed(3)}% (${y.changeBp >= 0 ? '+' : ''}${y.changeBp}bp)`,
        rawWeight: 10,
        normalizedWeight: 0,
        direction: dir,
        rawScore: goldScore,
        weightedScore: 0,
        value: `${y.yield.toFixed(3)}% (${y.changeBp >= 0 ? '+' : ''}${y.changeBp}bp)`,
        source: y.source,
        ageMs: y.ageMs,
      });
    }

    // Renormalize post-release weights
    const sumPostW = postInputs.reduce((acc, i) => acc + i.rawWeight, 0);
    let postScore = 0;
    for (const inp of postInputs) {
      inp.normalizedWeight = sumPostW > 0 ? Number(((inp.rawWeight / sumPostW) * 100).toFixed(1)) : 0;
      inp.weightedScore = Number((inp.rawScore * inp.normalizedWeight).toFixed(1));
      postScore += inp.weightedScore;
    }
    postScore = Math.max(-100, Math.min(100, Math.round(postScore)));

    const actualInp = postInputs.find((i) => i.id === 'actual_surprise');
    const goldInp = postInputs.find((i) => i.id === 'gold_reaction');
    const bullPost = postInputs.filter((i) => i.direction === 1).length;
    const bearPost = postInputs.filter((i) => i.direction === -1).length;

    // Check if Actual vs Forecast and market reaction are in the same direction
    const sameDirection =
      actualInp &&
      actualInp.direction !== 0 &&
      ((goldInp && goldInp.direction === actualInp.direction) ||
        (actualInp.direction === 1 && bullPost >= 2 && bearPost === 0) ||
        (actualInp.direction === -1 && bearPost >= 2 && bullPost === 0));

    const phase: DecisionPhase =
      elapsedMin < 5 ? 'provisional' : sameDirection ? 'confirmed' : 'mixed';

    let word: DecisionWord = 'WAIT';
    if (phase === 'provisional') {
      if (actualInp && actualInp.direction !== 0 && Math.abs(postScore) >= 15) {
        word = postScore > 0 ? 'BULLISH' : 'BEARISH';
      } else {
        word = 'WAIT';
      }
    } else if (phase === 'confirmed') {
      word = postScore > 0 ? 'BULLISH' : 'BEARISH';
    } else {
      // MIXED means WAIT
      word = 'WAIT';
    }

    const rawConf =
      word === 'WAIT'
        ? 50
        : Math.min(95, Math.max(60, Math.round(55 + Math.abs(postScore) * 0.4)));
    const { calibrated, bucket, status: confStatus } = applyConfidenceCalibration(rawConf, phase);

    const reason =
      phase === 'provisional'
        ? actualInp
          ? `Provisional 5m window: ${actualInp.label}; monitoring gold & dollar follow-through.`
          : 'Release window active (0-5m); awaiting verified actual print and initial order flow.'
        : phase === 'confirmed'
        ? `Confirmed after 5m window: ${actualInp?.label || 'Release'} aligned with gold & macro reaction (${word}).`
        : 'Post-release 5m reaction was mixed across actual print, gold price, and USD/yields — standing aside (WAIT).';

    const postDecision: NewsDecisionObject = {
      eventId: evt.id,
      eventTitle: evt.title,
      word,
      confidence: word === 'WAIT' ? 50 : calibrated,
      confidenceStatus: confStatus,
      rawConfidence: word === 'WAIT' ? 50 : rawConf,
      score: word === 'WAIT' ? Math.max(-15, Math.min(15, postScore)) : postScore,
      reason,
      inputs: postInputs,
      phase,
      lockedAt: rec.lockedAt || new Date(eventTimeMs - 60 * 60_000).toISOString(),
      resultStatus: rec.resultStatus || 'PENDING',
      goldMove15m: rec.goldMove15m ?? null,
      calibrationBucket: bucket,
    };

    if (elapsedMin >= 5 && !rec.confirmedSnapshot && actualInp) {
      rec.confirmedSnapshot = postDecision;
      saveStoredDecisionRecords(records);
    }

    return postDecision;
  }

  // ============================================================================
  // PRE-RELEASE EVALUATION (7 Real Inputs, 60s Freshness Gate, T-60m Lock)
  // ============================================================================
  // If within T-60m and already locked, return the locked decision snapshot
  if (minutesUntil > 0 && minutesUntil <= 60 && rec.preLockSnapshot && rec.lockedAt) {
    return rec.preLockSnapshot;
  }

  const rawInputs: NewsDecisionInputItem[] = [];

  // Input 1: Forecast vs previous, scaled by typical surprise size (weight 20)
  if (
    !evt.isSpeech &&
    evt.forecastNum !== null &&
    evt.forecastNum !== undefined &&
    evt.previousNum !== null &&
    evt.previousNum !== undefined &&
    evt.forecastStr &&
    evt.forecastStr !== '--' &&
    evt.forecastStr !== 'N/A'
  ) {
    const diff = evt.forecastNum - evt.previousNum;
    const typical = getTypicalSurpriseSize(evt.title, evt.previousNum);
    const scaled = Math.max(-1, Math.min(1, diff / typical));
    // Invert per event: positive = bullish for gold
    const goldScore = isInverse ? scaled : -scaled;
    const dir: 1 | -1 | 0 = goldScore > 0.05 ? 1 : goldScore < -0.05 ? -1 : 0;

    rawInputs.push({
      id: 'forecast',
      name: 'Forecast vs Previous',
      label: `Forecast: ${evt.forecastStr} vs Prev ${evt.previousStr}`,
      rawWeight: 20,
      normalizedWeight: 0,
      direction: dir,
      rawScore: Number(goldScore.toFixed(3)),
      weightedScore: 0,
      value: `${evt.forecastStr} vs ${evt.previousStr}`,
      source: 'ForexFactory Calendar',
      ageMs: 0,
    });
  }

  // Input 2: Prediction markets — Kalshi & Polymarket (weight 20)
  const matchedMarket = findMatchingPredictionMarketForEvent(evt.title);
  if (matchedMarket) {
    const pmSource =
      matchedMarket.kalshiSeriesTicker && matchedMarket.polymarketSlug
        ? `Kalshi (${matchedMarket.kalshiSeriesTicker}) + Polymarket (${matchedMarket.polymarketSlug})`
        : matchedMarket.kalshiSeriesTicker
        ? `Kalshi (${matchedMarket.kalshiSeriesTicker})`
        : `Polymarket (${matchedMarket.polymarketSlug || 'Gamma API'})`;

    if (matchedMarket.category === 'FED_RATE' && matchedMarket.combinedNetCutBps !== undefined && matchedMarket.combinedNetCutBps !== null) {
      const netCutBps = matchedMarket.combinedNetCutBps;
      let goldScore = Math.max(-1, Math.min(1, netCutBps / 12.5));
      if (Math.abs(goldScore) < 0.08 && (matchedMarket.hikeProb ?? 0) > (matchedMarket.cutProb ?? 0)) {
        goldScore = -0.35;
      } else if (Math.abs(goldScore) < 0.08 && (matchedMarket.cutProb ?? 0) > (matchedMarket.hikeProb ?? 0)) {
        goldScore = 0.35;
      }
      const dir: 1 | -1 | 0 = goldScore > 0.05 ? 1 : goldScore < -0.05 ? -1 : 0;
      rawInputs.push({
        id: 'prediction_market',
        name: 'Prediction Markets',
        label: matchedMarket.summaryLabel,
        rawWeight: 20,
        normalizedWeight: 0,
        direction: dir,
        rawScore: Number(goldScore.toFixed(3)),
        weightedScore: 0,
        value: matchedMarket.summaryLabel,
        source: pmSource,
        ageMs: Math.max(0, now - matchedMarket.lastUpdated),
      });
    } else if (matchedMarket.combinedImpliedEv !== undefined && matchedMarket.combinedImpliedEv !== null) {
      const consensus = evt.forecastNum ?? evt.previousNum ?? null;
      if (consensus !== null) {
        const ev = matchedMarket.combinedImpliedEv;
        const diff = ev - consensus;
        const typical = getTypicalSurpriseSize(evt.title, consensus);
        const scaled = Math.max(-1, Math.min(1, diff / typical));
        // Hotter than consensus = bearish for gold (unless inverse event like Unemployment Rate)
        const goldScore = isInverse ? scaled : -scaled;
        const dir: 1 | -1 | 0 = goldScore > 0.05 ? 1 : goldScore < -0.05 ? -1 : 0;
        const consensusDisp = evt.forecastStr || evt.previousStr || String(consensus);
        rawInputs.push({
          id: 'prediction_market',
          name: 'Prediction Markets',
          label: `${matchedMarket.summaryLabel} vs C:${consensusDisp}`,
          rawWeight: 20,
          normalizedWeight: 0,
          direction: dir,
          rawScore: Number(goldScore.toFixed(3)),
          weightedScore: 0,
          value: `${matchedMarket.summaryLabel} vs ${consensusDisp}`,
          source: pmSource,
          ageMs: Math.max(0, now - matchedMarket.lastUpdated),
        });
      }
    }
  }

  // Input 3: Gold trend and key levels from live BiQuote feed (weight 20) — drop if older than 60s
  if (macro.goldTrend && !macro.goldTrend.isStale && macro.goldTrend.ageMs <= 60_000) {
    const gt = macro.goldTrend;
    rawInputs.push({
      id: 'gold_trend',
      name: 'Gold BiQuote Trend',
      label: `Gold: ${gt.keyLevelsText}`,
      rawWeight: 20,
      normalizedWeight: 0,
      direction: gt.direction,
      rawScore: gt.rawScore,
      weightedScore: 0,
      value: gt.keyLevelsText,
      source: 'BiQuote XAUUSD + H4 Candles',
      ageMs: gt.ageMs,
    });
  }

  // Input 4: Dollar strength proxy from live USD pairs (EURUSD, USDJPY, GBPUSD) (weight 15) — drop if older than 60s
  if (macro.dollarProxy && !macro.dollarProxy.isStale && macro.dollarProxy.ageMs <= 60_000) {
    const dp = macro.dollarProxy;
    rawInputs.push({
      id: 'dollar_proxy',
      name: 'Dollar proxy',
      label: `Dollar proxy: ${dp.compositeChangePct >= 0 ? '+' : ''}${dp.compositeChangePct.toFixed(2)}% (EUR/JPY/GBP)`,
      rawWeight: 15,
      normalizedWeight: 0,
      direction: dp.goldDirection,
      rawScore: dp.goldScore,
      weightedScore: 0,
      value: `${dp.compositeChangePct >= 0 ? '+' : ''}${dp.compositeChangePct.toFixed(2)}% (${dp.pairsUsed.join(', ')})`,
      source: 'BiQuote EURUSD, USDJPY, GBPUSD',
      ageMs: dp.ageMs,
    });
  }

  // Input 5: US10Y yield change (weight 10) — drop if older than 60s
  if (macro.us10y && !macro.us10y.isStale && macro.us10y.ageMs <= 60_000) {
    const y = macro.us10y;
    // Invert for gold: falling yield (changeBp < 0) = bullish for gold (+1)
    const goldScore = Math.max(-1, Math.min(1, Number((-y.changeBp / 6.0).toFixed(3))));
    const dir: 1 | -1 | 0 = y.changeBp <= -0.5 ? 1 : y.changeBp >= 0.5 ? -1 : 0;
    rawInputs.push({
      id: 'us10y',
      name: 'US10Y Yield',
      label: `US10Y: ${y.yield.toFixed(3)}% (${y.changeBp >= 0 ? '+' : ''}${y.changeBp}bp)`,
      rawWeight: 10,
      normalizedWeight: 0,
      direction: dir,
      rawScore: goldScore,
      weightedScore: 0,
      value: `${y.yield.toFixed(3)}% (${y.changeBp >= 0 ? '+' : ''}${y.changeBp}bp)`,
      source: y.source,
      ageMs: y.ageMs,
    });
  }

  // Input 6: History of this event's gold reaction (weight 10) — drop if no history
  const histResult = computeEventGoldHistoryInput(evt, options?.archive || []);
  if (histResult) {
    rawInputs.push({
      id: 'history',
      name: 'Event Gold History',
      label: `History: ${histResult.value}`,
      rawWeight: 10,
      normalizedWeight: 0,
      direction: histResult.direction,
      rawScore: histResult.rawScore,
      weightedScore: 0,
      value: histResult.value,
      source: '30d Archive & 15m Gold Reaction Store',
      ageMs: 0,
    });
  }

  // Input 7: AHMED AI vote (max weight 10, cannot flip the decision on its own)
  const aiVote = evt.decision?.aiVote;
  if (aiVote === 'BULLISH' || aiVote === 'BEARISH') {
    const aiConf = Math.max(50, Math.min(100, evt.decision?.aiConfidence || 65));
    const dir: 1 | -1 = aiVote === 'BULLISH' ? 1 : -1;
    const rawScore = Number((dir * (aiConf / 100)).toFixed(3));
    rawInputs.push({
      id: 'ahmed_ai',
      name: 'AHMED AI Vote',
      label: `AHMED AI: ${aiVote === 'BULLISH' ? 'Bullish' : 'Bearish'} (${aiConf}%)`,
      rawWeight: 10, // max 10
      normalizedWeight: 0,
      direction: dir,
      rawScore,
      weightedScore: 0,
      value: `${aiVote} (${aiConf}%)`,
      source: 'AHMED AI Engine',
      ageMs: 0,
    });
  }

  // ============================================================================
  // GATES & RENORMALISATION
  // ============================================================================
  // Gate 1: If fewer than 3 inputs remain -> WAIT
  if (rawInputs.length < 3) {
    return {
      eventId: evt.id,
      eventTitle: evt.title,
      word: 'WAIT',
      confidence: 50,
      confidenceStatus: 'calibrating',
      rawConfidence: 50,
      score: 0,
      reason: `Only ${rawInputs.length} live input(s) available (minimum 3 required); standing aside.`,
      inputs: rawInputs,
      phase: 'pre',
      lockedAt: rec.lockedAt,
      resultStatus: rec.resultStatus || 'PENDING',
    };
  }

  // Renormalize weights of active inputs to sum to 100
  const totalRawWeight = rawInputs.reduce((sum, inp) => sum + inp.rawWeight, 0);
  let totalScoreFloat = 0;

  for (const inp of rawInputs) {
    inp.normalizedWeight = Number(((inp.rawWeight / totalRawWeight) * 100).toFixed(1));
    inp.weightedScore = Number((inp.rawScore * inp.normalizedWeight).toFixed(1));
    totalScoreFloat += inp.weightedScore;
  }

  // Also compute non-AI score & counts to enforce "AHMED AI vote cannot flip the decision on its own"
  const nonAiInputs = rawInputs.filter((i) => i.id !== 'ahmed_ai');
  const nonAiWeightSum = nonAiInputs.reduce((s, i) => s + i.rawWeight, 0);
  const nonAiScore =
    nonAiWeightSum > 0
      ? nonAiInputs.reduce((s, i) => s + i.rawScore * ((i.rawWeight / nonAiWeightSum) * 100), 0)
      : 0;
  const nonAiBullCount = nonAiInputs.filter((i) => i.direction === 1).length;
  const nonAiBearCount = nonAiInputs.filter((i) => i.direction === -1).length;

  const bullCount = rawInputs.filter((i) => i.direction === 1).length;
  const bearCount = rawInputs.filter((i) => i.direction === -1).length;

  let score = Math.max(-100, Math.min(100, Math.round(totalScoreFloat)));
  let word: DecisionWord = 'WAIT';

  // Gate 2: Need at least 3 agreeing inputs and no more than 1 against, otherwise WAIT.
  // Gate 3: AHMED AI cannot flip the decision on its own (nonAiScore must not oppose and nonAi agreeing must be predominant).
  if (
    bullCount >= 3 &&
    bearCount <= 1 &&
    score > 0 &&
    nonAiScore > 0 &&
    nonAiBullCount > nonAiBearCount
  ) {
    word = 'BULLISH';
  } else if (
    bearCount >= 3 &&
    bullCount <= 1 &&
    score < 0 &&
    nonAiScore < 0 &&
    nonAiBearCount > nonAiBullCount
  ) {
    word = 'BEARISH';
  } else {
    word = 'WAIT';
  }

  // Compute raw confidence & apply 30-day calibration table (capped at 70 pre-news)
  const agreeingCount = word === 'BULLISH' ? bullCount : word === 'BEARISH' ? bearCount : 0;
  const directionalTotal = Math.max(1, bullCount + bearCount);
  const agreementRatio = agreeingCount / directionalTotal;

  const rawConfidence =
    word === 'WAIT'
      ? 50
      : Math.min(70, Math.round(52 + agreementRatio * 12 + Math.min(18, Math.abs(score) * 0.22)));
  const { calibrated: calibratedConfidence, bucket, status: confStatus } = applyConfidenceCalibration(
    rawConfidence,
    'pre'
  );

  // Build concise one-sentence reason
  let reason = '';
  if (word === 'BULLISH') {
    const topBull = rawInputs
      .filter((i) => i.direction === 1)
      .slice(0, 3)
      .map((i) => i.name)
      .join(', ');
    reason = `${bullCount} inputs align bullish for Gold (${topBull}) with ${bearCount} opposing.`;
  } else if (word === 'BEARISH') {
    const topBear = rawInputs
      .filter((i) => i.direction === -1)
      .slice(0, 3)
      .map((i) => i.name)
      .join(', ');
    reason = `${bearCount} inputs align bearish for Gold (${topBear}) with ${bullCount} opposing.`;
  } else {
    reason = `Gate held at WAIT (${bullCount} bullish vs ${bearCount} bearish inputs; requires ≥3 agreeing and ≤1 against).`;
  }

  // Timeline: Lock the pre-news decision at T-60m
  if (minutesUntil > 0 && minutesUntil <= 60 && !rec.lockedAt) {
    rec.lockedAt = new Date().toISOString();
  }

  const decisionObj: NewsDecisionObject = {
    eventId: evt.id,
    eventTitle: evt.title,
    word,
    confidence: word === 'WAIT' ? 50 : calibratedConfidence,
    confidenceStatus: confStatus,
    rawConfidence,
    score: word === 'WAIT' ? Math.max(-15, Math.min(15, score)) : score,
    reason,
    inputs: rawInputs,
    phase: 'pre',
    lockedAt: rec.lockedAt,
    resultStatus: rec.resultStatus || 'PENDING',
    goldMove15m: rec.goldMove15m ?? null,
    calibrationBucket: bucket,
  };

  if (minutesUntil > 0 && minutesUntil <= 60 && !rec.preLockSnapshot) {
    rec.preLockSnapshot = decisionObj;
    saveStoredDecisionRecords(records);
  }

  return decisionObj;
}

