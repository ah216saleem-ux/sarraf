import fs from "fs";
import path from "path";
import { DATA_DIR, writeJsonAtomic } from "./deploymentSafety.ts";
import {
  getCachedMacroData,
  findMatchingPredictionMarketForEvent,
  LiveMacroData,
  DiscoveredPredictionMarket,
} from "./macroFeedEngine.ts";
import { getLastValidTick } from "./marketPriceEngine.ts";
import { getCandleStore } from "./candleEngine.ts";
import {
  get12MonthGoldHistory,
  getSurpriseStreakInput,
  CHRONOLOGICAL_RELEASE_LEDGER,
} from "./eventHistoryBackfill.ts";

export const NEWS_DECISIONS_STORE_FILE = path.resolve(DATA_DIR, "news_decisions_v2.json");

export type DecisionWord = "BULLISH" | "BEARISH" | "WAIT" | "SKIP" | "RELEASED";
export type DecisionPhase = "preview" | "forming" | "pre" | "provisional" | "confirmed" | "mixed";

export interface NewsDecisionInputItem {
  id:
    | "forecast"
    | "prediction_market"
    | "gold_trend"
    | "dollar_proxy"
    | "us10y"
    | "history"
    | "surprise_streak"
    | "ahmed_ai"
    | "actual_surprise"
    | "gold_reaction";
  name: string;
  label: string;
  rawWeight: number;
  normalizedWeight: number;
  direction: 1 | -1 | 0;
  rawScore: number;
  weightedScore: number;
  value: string;
  source?: string;
  ageMs?: number;
  group?: "event_specific" | "market_context" | "advisor" | "post_release";
  isInfoOnly?: boolean;
  dropReason?: string;
}

export type CalibrationBucketId = "0-29" | "30-39" | "40-49" | "50-59" | "60-69" | "70+";

export interface CalibrationBucketRow {
  bucket: CalibrationBucketId;
  min: number;
  max: number;
  midpoint: number;
  hits: number;
  misses: number;
  total: number;
  hitRatePct: number | null;
  calibratedConfidence: number | null;
  status: "calibrated" | "calibrating";
  ci95Pct?: string;
}

export interface NewsDecisionAuditRow {
  input: string;
  group: "market_context" | "event_specific" | "advisor";
  rawValue: string;
  rawScore: number;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  source: string;
  ageSeconds: number | null;
  originalWeight: number;
  renormalizedWeight: number;
  weightedScore: number;
  formula: string; // "rawScore x normalizedWeight = weightedScore"
  dropped: "No" | "Yes" | "Info Only (Wt 0)";
  reason: string;
}

export interface NewsDecisionObject {
  word: DecisionWord;
  confidence: number;
  confidenceDisplay: string;
  confidenceLean: "Lean: unproven (weak)" | "Lean: unproven (moderate)" | "-";
  confidenceStatus: "calibrated" | "calibrating";
  rawConfidence: number;
  score: number | null;
  scoreDisplay: string;
  rawSumWeightedScore: number;
  reason: string;
  inputs: NewsDecisionInputItem[];
  phase: DecisionPhase;
  lockedAt: string | null;

  eventId: string;
  eventTitle: string;
  resultStatus?: "HIT" | "MISS" | "WAIT" | "PENDING";
  goldMove15m?: number | null;
  calibrationBucket: CalibrationBucketId | null;
  auditLog?: NewsDecisionAuditRow[];
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
    us10yBp: number | null;
  };
  resultStatus?: "HIT" | "MISS" | "WAIT" | "PENDING";
  goldMove15m?: number | null;
  evaluatedAt?: string;
  resolved?: boolean;
  telegramLockSentAt?: string;
  telegramConfirmSentAt?: string;
}

export interface NewsDecisionOptions {
  macro?: LiveMacroData;
  asOfTimeMs?: number;
  skipPersistence?: boolean;
  archive?: any[];
  matchedPmOverride?: DiscoveredPredictionMarket | null;
}

export function loadStoredDecisionRecords(): Record<string, StoredEventDecisionRecord> {
  try {
    if (fs.existsSync(NEWS_DECISIONS_STORE_FILE)) {
      const raw = fs.readFileSync(NEWS_DECISIONS_STORE_FILE, "utf-8");
      return JSON.parse(raw) || {};
    }
  } catch {}
  return {};
}

export function saveStoredDecisionRecords(records: Record<string, StoredEventDecisionRecord>): void {
  try {
    writeJsonAtomic(NEWS_DECISIONS_STORE_FILE, records);
  } catch (err: any) {
    console.warn("[NEWS DECISION] Failed to persist decision records:", err.message);
  }
}

export function checkLiveResolvedSamplesSufficient(): boolean {
  try {
    const records = loadStoredDecisionRecords();
    const resolvedList = Object.values(records).filter(
      (r) => r.resolved || r.resultStatus === "HIT" || r.resultStatus === "MISS"
    );
    const buckets: Record<string, number> = {
      "0-29": 0,
      "30-39": 0,
      "40-49": 0,
      "50-59": 0,
      "60-69": 0,
      "70+": 0,
    };
    for (const r of resolvedList) {
      if (r.preLockSnapshot?.calibrationBucket) {
        buckets[r.preLockSnapshot.calibrationBucket] =
          (buckets[r.preLockSnapshot.calibrationBucket] || 0) + 1;
      }
    }
    for (const b of ["0-29", "30-39", "40-49", "50-59", "60-69", "70+"]) {
      if ((buckets[b] || 0) < 15) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export interface IndicatorSignRule {
  indicatorPattern: string;
  polarityType: "STANDARD" | "INVERSE";
  forecastAbovePreviousGoldSign: "BEARISH (-1)" | "BULLISH (+1)";
  forecastBelowPreviousGoldSign: "BULLISH (+1)" | "BEARISH (-1)";
  rationale: string;
}

export const SIGN_TABLE: IndicatorSignRule[] = [
  {
    indicatorPattern: "Flash Manufacturing PMI / Flash Services PMI / ISM PMI",
    polarityType: "STANDARD",
    forecastAbovePreviousGoldSign: "BEARISH (-1)",
    forecastBelowPreviousGoldSign: "BULLISH (+1)",
    rationale: "Higher PMI = stronger US economic activity = stronger USD = Gold BEARISH",
  },
  {
    indicatorPattern: "Unemployment Claims / Jobless Claims / Unemployment Rate",
    polarityType: "INVERSE",
    forecastAbovePreviousGoldSign: "BULLISH (+1)",
    forecastBelowPreviousGoldSign: "BEARISH (-1)",
    rationale: "Higher Claims/Unemployment = weaker US labor market = weaker USD = Gold BULLISH",
  },
  {
    indicatorPattern: "CPI / Core CPI / PPI / PCE / Inflation Expectations",
    polarityType: "STANDARD",
    forecastAbovePreviousGoldSign: "BEARISH (-1)",
    forecastBelowPreviousGoldSign: "BULLISH (+1)",
    rationale: "Higher inflation = hawkish Fed / higher real yields = Gold BEARISH",
  },
  {
    indicatorPattern: "Non-Farm Employment Change (NFP) / Retail Sales / GDP / Consumer Sentiment",
    polarityType: "STANDARD",
    forecastAbovePreviousGoldSign: "BEARISH (-1)",
    forecastBelowPreviousGoldSign: "BULLISH (+1)",
    rationale: "Higher growth/jobs/spending = stronger USD = Gold BEARISH",
  },
];

export const EXACT_DIRECTIONAL_RULE_TEXT =
  "EXACT DIRECTIONAL RULE (Round 9): Verdict is BULLISH or BEARISH iff ALL conditions hold: (1) >= 2 active non-AI event-specific inputs (|rawScore| >= 0.15, finalWeight > 0) agree on direction (AHMED AI is advisor-only <= 10% and never counts as an event input; if < 2 active event inputs exist, verdict is WAIT and headline score is null / 'no call'); (2) market_context group total final weight <= 40.0%, and when >= 2 event inputs are active no single input has final weight > 35.0% (weights sum to 100.0%); (3) headline score = sum of weighted rows has |score| >= 20.0 in the agreed direction (and opposing event weighted strength < 50% of agreeing); (4) confidence >= 40%. For WAIT, header shows 'no call' and keeps numeric score/confidence in details.";

export function isEventInverseForGold(title: string): boolean {
  const t = title.toLowerCase();
  return (
    t.includes("unemployment rate") ||
    t.includes("jobless claims") ||
    t.includes("unemployment claims") ||
    t.includes("continuing claims") ||
    t.includes("initial claims")
  );
}

export function getTypicalSurpriseSize(title: string, referenceVal?: number | null): number {
  const t = title.toLowerCase();
  const isRawThousands = referenceVal != null && Math.abs(referenceVal) >= 1000;
  if (t.includes("unemployment claims") || t.includes("jobless claims") || t.includes("initial claims")) {
    return isRawThousands ? 10000 : 10;
  }
  if (t.includes("non-farm") || t.includes("nfp")) {
    return isRawThousands ? 35000 : 35;
  }
  if (t.includes("cpi") || t.includes("ppi") || t.includes("pce") || t.includes("inflation")) {
    return 0.2;
  }
  if (t.includes("pmi") || t.includes("ism") || t.includes("sentiment") || t.includes("confidence")) {
    return 1.5;
  }
  if (t.includes("retail sales") || t.includes("gdp")) {
    return 0.3;
  }
  if (referenceVal && Math.abs(referenceVal) > 0) {
    return Math.max(0.1, Number((Math.abs(referenceVal) * 0.05).toFixed(2)));
  }
  return 1.0;
}

export function deriveCalibrationBucket(
  confidence: number,
  phase: DecisionPhase,
  word: DecisionWord
): CalibrationBucketId | null {
  if (phase === "preview" || word === "WAIT" || word === "SKIP" || confidence <= 0) {
    return null;
  }
  const c = Math.round(confidence);
  if (c < 30) return "0-29";
  if (c < 40) return "30-39";
  if (c < 50) return "40-49";
  if (c < 60) return "50-59";
  if (c < 70) return "60-69";
  return "70+";
}

export function getCalibrationTable30d(): CalibrationBucketRow[] {
  const records = loadStoredDecisionRecords();
  const bucketMap: Record<CalibrationBucketId, { min: number; max: number; midpoint: number; hits: number; misses: number }> = {
    "0-29": { min: 0, max: 29, midpoint: 15, hits: 0, misses: 0 },
    "30-39": { min: 30, max: 39, midpoint: 35, hits: 0, misses: 0 },
    "40-49": { min: 40, max: 49, midpoint: 45, hits: 0, misses: 0 },
    "50-59": { min: 50, max: 59, midpoint: 55, hits: 0, misses: 0 },
    "60-69": { min: 60, max: 69, midpoint: 65, hits: 0, misses: 0 },
    "70+": { min: 70, max: 100, midpoint: 85, hits: 0, misses: 0 },
  };

  const nowMs = Date.now();
  const cutoffMs = nowMs - 30 * 24 * 60 * 60 * 1000;

  for (const rec of Object.values(records)) {
    if (!rec.resolved || !rec.preLockSnapshot) continue;
    const recTimeMs = new Date(rec.eventTimeUtc).getTime();
    if (isNaN(recTimeMs) || recTimeMs < cutoffMs) continue;

    const bId = rec.preLockSnapshot.calibrationBucket;
    if (!bId || !bucketMap[bId]) continue;

    if (rec.resultStatus === "HIT") {
      bucketMap[bId].hits++;
    } else if (rec.resultStatus === "MISS") {
      bucketMap[bId].misses++;
    }
  }

  const ids: CalibrationBucketId[] = ["0-29", "30-39", "40-49", "50-59", "60-69", "70+"];
  return ids.map((id) => {
    const b = bucketMap[id];
    const total = b.hits + b.misses;
    const hitRatePct = total > 0 ? Math.round((b.hits / total) * 100) : null;
    return {
      bucket: id,
      min: b.min,
      max: b.max,
      midpoint: b.midpoint,
      hits: b.hits,
      misses: b.misses,
      total,
      hitRatePct,
      calibratedConfidence: hitRatePct,
      status: total >= 15 ? "calibrated" : "calibrating",
    };
  });
}

export function applyConfidenceCalibration(
  rawConfidence: number,
  phase: DecisionPhase,
  word: DecisionWord
): { calibrated: number; status: "calibrated" | "calibrating" } {
  const bId = deriveCalibrationBucket(rawConfidence, phase, word);
  if (!bId) {
    return { calibrated: rawConfidence, status: "calibrating" };
  }
  const table = getCalibrationTable30d();
  const row = table.find((r) => r.bucket === bId);
  if (row && row.status === "calibrated" && row.hitRatePct !== null) {
    return { calibrated: row.hitRatePct, status: "calibrated" };
  }
  return { calibrated: rawConfidence, status: "calibrating" };
}

function computeEventGoldHistoryInput(
  evt: any,
  archive: any[],
  historyCutoffMs?: number
): {
  label: string;
  rawScore: number;
  direction: 1 | -1 | 0;
  value: string;
  total: number;
  edgePct: number;
  qualifiesAsSignal: boolean;
  infoReason?: string;
} | null {
  const cutoff = historyCutoffMs !== undefined ? historyCutoffMs : Date.now();
  const hist = get12MonthGoldHistory(evt.title, cutoff);

  if (!hist || hist.total === 0) {
    return {
      label: "Event History: 0 releases",
      rawScore: 0,
      direction: 0,
      value: "No historical releases recorded",
      total: 0,
      edgePct: 0,
      qualifiesAsSignal: false,
      infoReason: "No historical releases recorded",
    };
  }

  const total = hist.total;
  const bullishCount = hist.roseCount;
  const bearishCount = hist.fellCount;
  const dominantCount = Math.max(bullishCount, bearishCount);
  const edgePct = Number(((dominantCount / total) * 100).toFixed(1));

  const qualifies = hist.qualifiesAsSignal;
  const direction: 1 | -1 | 0 = hist.direction;
  const rawScore = qualifies ? hist.rawScore : 0;

  const sentimentLabel = bullishCount > bearishCount ? "Bullish" : bearishCount > bullishCount ? "Bearish" : "Neutral";
  const label = `12m History (${total} releases, ${edgePct}% ${sentimentLabel})`;
  const value = `${total} releases recorded: ${bullishCount} Bullish (${Number(((bullishCount / total) * 100).toFixed(0))}%), ${bearishCount} Bearish (${Number(((bearishCount / total) * 100).toFixed(0))}%)`;

  return {
    label,
    rawScore: Number(rawScore.toFixed(3)),
    direction,
    value,
    total,
    edgePct,
    qualifiesAsSignal: qualifies,
    infoReason: qualifies
      ? `Qualified signal (${total} >= 20 releases, ${edgePct}% >= 62% edge)`
      : `Info chip only (wt 0): ${total} releases (< 20 required) or ${edgePct}% edge (< 62% required)`,
  };
}

export function isLowImpactEvent(evt: any): boolean {
  if (!evt) return false;
  const imp = (evt.impact || '').toLowerCase();
  const t = (evt.title || '').toLowerCase();
  return (
    imp === 'low' ||
    imp === 'holiday' ||
    t.includes('natural gas storage') ||
    t.includes('cb leading index') ||
    t.includes('leading index') ||
    t.includes('leading indicators') ||
    t.includes('api weekly')
  );
}

export function newsDecision(
  evt: any,
  options?: NewsDecisionOptions
): NewsDecisionObject {
  const now = options?.asOfTimeMs ?? Date.now();
  const macro = options?.macro || getCachedMacroData();
  const skipPersistence = options?.skipPersistence ?? false;
  const records = skipPersistence ? {} : loadStoredDecisionRecords();
  const rec: StoredEventDecisionRecord = records[evt.id] || {
    eventId: evt.id,
    eventTitle: evt.title,
    eventTimeUtc: evt.timeUtc,
    lockedAt: null,
    resultStatus: "PENDING",
  };

  const eventTimeMs = new Date(evt.timeUtc).getTime();
  const historyCutoffMs = isNaN(eventTimeMs) ? now : eventTimeMs - 60000;
  const minutesUntil = Math.round((eventTimeMs - now) / 60000);

  const isPostRelease = !isNaN(eventTimeMs) && minutesUntil < 0;
  if (isPostRelease) {
    const isInverse = isEventInverseForGold(evt.title);
    const hasActual = evt.actualNum !== null && evt.actualNum !== undefined;
    const hasForecastOrPrev =
      (evt.forecastNum !== null && evt.forecastNum !== undefined) ||
      (evt.previousNum !== null && evt.previousNum !== undefined);

    let postDir: 1 | -1 | 0 = 0;
    let postScore = 0;
    let postReason = '';
    let postConfidence = 85;

    if (hasActual && hasForecastOrPrev) {
      const benchmark = evt.forecastNum ?? evt.previousNum;
      const diff = evt.actualNum - benchmark;
      const tol = Math.max(Math.abs(benchmark) * 0.0001, 1e-6);
      if (Math.abs(diff) > tol) {
        if (diff > 0) {
          postDir = isInverse ? 1 : -1;
        } else {
          postDir = isInverse ? -1 : 1;
        }
        postScore = postDir === 1 ? 65 : -65;
        const surprisePct = Math.round((Math.abs(diff) / (Math.abs(benchmark) || 1)) * 100);
        postConfidence = Math.min(95, Math.max(75, 75 + Math.round(surprisePct * 0.5)));
        const reading = postDir === 1 ? 'BULLISH for Gold (USD Weakness)' : 'BEARISH for Gold (USD Strength)';
        postReason = `RELEASED (${postDir === 1 ? 'BULLISH' : 'BEARISH'}) — Actual ${evt.actualStr || evt.actualNum} vs ${evt.forecastStr ? 'Forecast ' + evt.forecastStr : 'Previous ' + evt.previousStr}: ${diff > 0 ? 'Above' : 'Below'} benchmark -> ${reading}.`;
      } else {
        postDir = 0;
        postScore = 0;
        postConfidence = 60;
        postReason = `RELEASED (IN LINE) — Actual ${evt.actualStr || evt.actualNum} matched benchmark; neutral impact on Gold.`;
      }
    } else if (typeof evt.goldMove15m === 'number' && Math.abs(evt.goldMove15m) >= 0.5) {
      postDir = evt.goldMove15m > 0 ? 1 : -1;
      postScore = postDir === 1 ? 55 : -55;
      postConfidence = 78;
      postReason = `RELEASED (${postDir === 1 ? 'BULLISH' : 'BEARISH'}) — Verified 15m post-release Gold reaction (${evt.goldMove15m > 0 ? '+' : ''}${evt.goldMove15m.toFixed(2)} pts) confirms institutional ${postDir === 1 ? 'upside' : 'downside'} momentum.`;
    } else if (hasForecastOrPrev && evt.forecastNum !== null && evt.previousNum !== null) {
      const diff = evt.forecastNum - evt.previousNum;
      if (Math.abs(diff) > 0.0001) {
        postDir = isInverse ? (diff > 0 ? 1 : -1) : (diff > 0 ? -1 : 1);
        postScore = postDir === 1 ? 45 : -45;
        postConfidence = 65;
        postReason = `RELEASED (Awaiting Feed Actual) — Pre-release consensus leaned ${postDir === 1 ? 'BULLISH' : 'BEARISH'} for Gold (${evt.forecastStr} vs ${evt.previousStr}). Official feed print pending.`;
      } else {
        postReason = `RELEASED — Official release time passed (${evt.timeUtc || evt.date}). Awaiting publication.`;
      }
    } else {
      postReason = `RELEASED — Event release time has passed (${evt.timeUtc || evt.date}). Awaiting publication.`;
    }

    const postWord: DecisionWord = postDir === 1 ? "BULLISH" : postDir === -1 ? "BEARISH" : "WAIT";
    return {
      eventId: evt.id,
      eventTitle: evt.title,
      word: postWord,
      confidence: postConfidence,
      confidenceDisplay: `${postConfidence}%`,
      confidenceLean: postDir === 1 ? "Lean: unproven (moderate)" : postDir === -1 ? "Lean: unproven (moderate)" : "-",
      confidenceStatus: "calibrated",
      rawConfidence: postConfidence,
      score: postScore,
      scoreDisplay: postScore !== 0 ? `${postScore >= 0 ? '+' : ''}${postScore}` : "0",
      rawSumWeightedScore: postScore,
      reason: postReason,
      inputs: [
        {
          id: "actual_surprise",
          name: "Actual Release vs Consensus",
          label: evt.actualStr
            ? `Actual: ${evt.actualStr} vs ${evt.forecastStr || evt.previousStr || '--'}`
            : "15m Post-Release Move",
          rawWeight: 60,
          normalizedWeight: 60,
          direction: postDir,
          rawScore: postScore / 100,
          weightedScore: postScore * 0.6,
          value: evt.actualStr ? `Actual ${evt.actualStr}` : `Move ${evt.goldMove15m ?? 0}`,
          source: "Economic Feed / Spot Reaction",
          group: "post_release",
        },
      ],
      phase: hasActual ? "confirmed" : "provisional",
      lockedAt: rec.lockedAt || null,
      resultStatus: postDir !== 0 ? "HIT" : "WAIT",
      goldMove15m: evt.goldMove15m || null,
      calibrationBucket: postConfidence >= 70 ? "70+" : "60-69",
      auditLog: [],
    };
  }

  let preReleasePhase: DecisionPhase = "preview";
  if (minutesUntil <= 60 && minutesUntil > 15) {
    preReleasePhase = "forming";
  } else if (minutesUntil <= 15 && minutesUntil >= 0) {
    preReleasePhase = "pre";
  } else if (minutesUntil < 0) {
    preReleasePhase = "provisional";
  }

  // Low-impact events without forecast/previous data can return SKIP, but if they have numbers, evaluate them
  const hasForecastData =
    (evt.forecastNum !== null && evt.forecastNum !== undefined) ||
    (evt.previousNum !== null && evt.previousNum !== undefined);
  if (isLowImpactEvent(evt) && !hasForecastData) {
    return {
      eventId: evt.id,
      eventTitle: evt.title,
      word: "SKIP",
      confidence: 0,
      confidenceDisplay: "-",
      confidenceLean: "-",
      confidenceStatus: "calibrating",
      rawConfidence: 0,
      score: null,
      scoreDisplay: "-",
      rawSumWeightedScore: 0,
      reason: `Low-impact event (${evt.title || 'Low impact'}) with no forecast data; skipped (SKIP).`,
      inputs: [],
      phase: preReleasePhase,
      lockedAt: null,
      resultStatus: "WAIT",
      goldMove15m: null,
      calibrationBucket: null,
      auditLog: [],
    };
  }

  const auditLog: NewsDecisionAuditRow[] = [];

  const hasForecast = evt.forecastNum !== null && evt.forecastNum !== undefined;
  const hasPrevious = evt.previousNum !== null && evt.previousNum !== undefined;

  const eventSpecificInputs: NewsDecisionInputItem[] = [];
  const marketSubInputs: NewsDecisionInputItem[] = [];
  const advisorInputs: NewsDecisionInputItem[] = [];

  // Round 6 Item 1 & 3: Forecast vs Previous (Raw weight = 15, re-balanced proportionally)
  if (hasForecast && hasPrevious) {
    const forecastVal = evt.forecastNum!;
    const previousVal = evt.previousNum!;
    const diff = forecastVal - previousVal;
    const typSize = getTypicalSurpriseSize(evt.title, forecastVal);
    const normalizedDiff = diff / typSize;

    const isInverse = isEventInverseForGold(evt.title);
    let dir: 1 | -1 | 0 = 0;
    let rawScore = 0;

    // Strict Dead Zone: |normalizedDiff| < 0.15 is neutral (rawScore = 0, dir = 0)
    const inDeadZone = Math.abs(normalizedDiff) < 0.15;
    if (!inDeadZone) {
      if (diff > 0) dir = isInverse ? 1 : -1;
      else dir = isInverse ? -1 : 1;
      rawScore = Math.max(-1, Math.min(1, dir * Math.abs(normalizedDiff)));
    } else {
      dir = 0;
      rawScore = 0;
    }

    eventSpecificInputs.push({
      id: "forecast",
      name: "Forecast vs Previous",
      label: `F:${evt.forecastStr || forecastVal} vs P:${evt.previousStr || previousVal}`,
      rawWeight: 15,
      normalizedWeight: 0,
      direction: dir,
      rawScore: Number(rawScore.toFixed(3)),
      weightedScore: 0,
      value: `Forecast ${evt.forecastStr || forecastVal} vs Prev ${evt.previousStr || previousVal}`,
      source: "Forex Factory Consensus",
      ageMs: 0,
      group: "event_specific",
      dropReason: inDeadZone
        ? `Dead zone (|rawScore| = ${Math.abs(normalizedDiff).toFixed(3)} < 0.15) -> direction = 0, weightedScore = 0`
        : "Active event-specific input",
    });
  } else {
    auditLog.push({
      input: "Forecast vs Previous",
      group: "event_specific",
      rawValue: `${evt.forecastStr || "--"} vs ${evt.previousStr || "--"}`,
      rawScore: 0,
      direction: "NEUTRAL",
      source: "Forex Factory Consensus",
      ageSeconds: null,
      originalWeight: 15,
      renormalizedWeight: 0,
      weightedScore: 0,
      formula: "0.00 x 0.0% = 0.0",
      dropped: "Yes",
      reason: "Dropped: Missing forecast or previous value",
    });
  }

  // Prediction Markets
  const matchedMarket = options?.matchedPmOverride !== undefined
    ? options.matchedPmOverride
    : findMatchingPredictionMarketForEvent(evt.title, macro?.discoveredMarkets);

  let pmAdded = false;
  const implied = matchedMarket?.combinedImpliedEv ?? matchedMarket?.kalshiImpliedEv ?? matchedMarket?.polymarketImpliedEv;
  if (matchedMarket && hasForecast && implied != null) {
    const consensus = evt.forecastNum!;
    const typSize = getTypicalSurpriseSize(evt.title, consensus);
    const diff = implied - consensus;
    const normalizedDiff = diff / typSize;
    const isInverse = isEventInverseForGold(evt.title);

    let dir: 1 | -1 | 0 = 0;
    let rawScore = 0;

    if (Math.abs(normalizedDiff) >= 0.15) {
      if (diff > 0) dir = isInverse ? 1 : -1;
      else dir = isInverse ? -1 : 1;
      rawScore = Math.max(-1, Math.min(1, dir * Math.abs(normalizedDiff)));
    }

    const inDeadZone = Math.abs(rawScore) < 0.15 || dir === 0;
    if (inDeadZone) {
      dir = 0;
      rawScore = 0;
    }

    const pmSource = matchedMarket.kalshiSeriesTicker ? `Kalshi (${matchedMarket.kalshiSeriesTicker})` : "Prediction Markets";
    const consensusDisp = evt.forecastStr || evt.previousStr || String(consensus);

    eventSpecificInputs.push({
      id: "prediction_market",
      name: "Prediction Markets",
      label: `${matchedMarket.summaryLabel} vs C:${consensusDisp}`,
      rawWeight: 30,
      normalizedWeight: 0,
      direction: dir,
      rawScore: Number(rawScore.toFixed(3)),
      weightedScore: 0,
      value: `${matchedMarket.summaryLabel} vs ${consensusDisp}`,
      source: pmSource,
      ageMs: Math.max(0, now - matchedMarket.lastUpdated),
      group: "event_specific",
      dropReason: inDeadZone
        ? `Dead zone (|rawScore| = ${Math.abs(rawScore).toFixed(3)} < 0.15) -> direction = 0, weightedScore = 0`
        : "Active event-specific input",
    });
    pmAdded = true;
  }

  if (!pmAdded) {
    auditLog.push({
      input: "Prediction Markets",
      group: "event_specific",
      rawValue: "--",
      rawScore: 0,
      direction: "NEUTRAL",
      source: "Kalshi / Polymarket",
      ageSeconds: null,
      originalWeight: 30,
      renormalizedWeight: 0,
      weightedScore: 0,
      formula: "0.00 x 0.0% = 0.0",
      dropped: "Yes",
      reason: "Dropped: No active Kalshi or Polymarket contract mapped for this indicator",
    });
  }

  // 12-Month Event Gold History (Round 6 Item 3: raw weight = 15)
  const histResult = computeEventGoldHistoryInput(evt, options?.archive || [], historyCutoffMs);
  if (histResult) {
    const rawW = histResult.qualifiesAsSignal ? 15 : 0;
    eventSpecificInputs.push({
      id: "history",
      name: "Event Gold History",
      label: histResult.label,
      rawWeight: rawW,
      normalizedWeight: 0,
      direction: histResult.qualifiesAsSignal ? histResult.direction : 0,
      rawScore: histResult.rawScore,
      weightedScore: 0,
      value: histResult.value,
      source: "12m Historical Releases & Spot Candles",
      ageMs: 0,
      group: "event_specific",
      isInfoOnly: !histResult.qualifiesAsSignal,
      dropReason: histResult.qualifiesAsSignal
        ? `Qualified signal (${histResult.total} releases >= 20, ${histResult.edgePct}% edge >= 62%)`
        : histResult.infoReason,
    });
  }

  // Actual vs Forecast Streak
  const streakInfo = getSurpriseStreakInput(evt.title, historyCutoffMs);
  if (streakInfo) {
    eventSpecificInputs.push({
      id: "surprise_streak",
      name: "Actual vs Forecast Streak",
      label: streakInfo.label,
      rawWeight: 0,
      normalizedWeight: 0,
      direction: 0,
      rawScore: streakInfo.rawScore,
      weightedScore: 0,
      value: streakInfo.value,
      source: "Last 3 Prior Indicator Releases",
      ageMs: 0,
      group: "event_specific",
      isInfoOnly: true,
      dropReason: "Info chip only (weight 0): tracking prior release surprise streak for edge evaluation",
    });
  }

  // Round 7 Item 3: Gold Trend Freshness Check (Before first real tick, gold = null and Gold Trend is dropped; no hardcoded price check)
  if (!macro.goldTrend || typeof macro.goldTrend.price !== "number" || macro.goldTrend.price <= 0) {
    auditLog.push({
      input: "Gold BiQuote Trend",
      group: "market_context",
      rawValue: "null",
      rawScore: 0,
      direction: "NEUTRAL",
      source: "BiQuote Spot Feed & 4H EMA",
      ageSeconds: null,
      originalWeight: 15,
      renormalizedWeight: 0,
      weightedScore: 0,
      formula: "0.00 x 0.0% = 0.0",
      dropped: "Yes",
      reason: "Dropped: No live BiQuote gold tick received yet (gold = null)",
    });
  } else {
    const gt = macro.goldTrend;
    const isStale = Boolean(gt.isStale || (gt.ageMs !== undefined && gt.ageMs > 60_000));
    if (isStale) {
      auditLog.push({
        input: "Gold BiQuote Trend",
        group: "market_context",
        rawValue: gt.keyLevelsText || `$${gt.price}`,
        rawScore: 0,
        direction: "NEUTRAL",
        source: "BiQuote Spot Feed & 4H EMA",
        ageSeconds: gt.ageMs !== undefined ? Math.round(gt.ageMs / 1000) : null,
        originalWeight: 15,
        renormalizedWeight: 0,
        weightedScore: 0,
        formula: "0.00 x 0.0% = 0.0",
        dropped: "Yes",
        reason: "Dropped: BiQuote spot price is stale (>60s old)",
      });
    } else {
      let dir: 1 | -1 | 0 = gt.direction;
      let rawScore = gt.rawScore;
      if (Math.abs(rawScore) < 0.15) {
        dir = 0;
        rawScore = 0;
      }
      marketSubInputs.push({
        id: "gold_trend",
        name: "Gold BiQuote Trend",
        label: `XAU/USD ${gt.bias}`,
        rawWeight: 15,
        normalizedWeight: 0,
        direction: dir,
        rawScore: Number(rawScore.toFixed(3)),
        weightedScore: 0,
        value: gt.keyLevelsText || `$${gt.price?.toFixed(1)}`,
        source: "BiQuote Spot Feed & 4H EMA",
        ageMs: gt.ageMs || 0,
        group: "market_context",
        dropReason: dir === 0 ? "Dead zone (|rawScore| < 0.15) -> weightedScore = 0" : "Market Context sub-input",
      });
    }
  }

  if (!macro.dollarProxy) {
    auditLog.push({
      input: "Dollar proxy",
      group: "market_context",
      rawValue: "null",
      rawScore: 0,
      direction: "NEUTRAL",
      source: "EUR/USD, USD/JPY, GBP/USD Weighted Basket",
      ageSeconds: null,
      originalWeight: 15,
      renormalizedWeight: 0,
      weightedScore: 0,
      formula: "0.00 x 0.0% = 0.0",
      dropped: "Yes",
      reason: "Dropped: No live Dollar proxy quote available",
    });
  } else {
    const dp = macro.dollarProxy;
    const isStale = Boolean(dp.isStale || (dp.ageMs !== undefined && dp.ageMs > 60_000));
    if (isStale) {
      auditLog.push({
        input: "Dollar proxy",
        group: "market_context",
        rawValue: "--",
        rawScore: 0,
        direction: "NEUTRAL",
        source: "EUR/USD, USD/JPY, GBP/USD Weighted Basket",
        ageSeconds: dp.ageMs !== undefined ? Math.round(dp.ageMs / 1000) : null,
        originalWeight: 15,
        renormalizedWeight: 0,
        weightedScore: 0,
        formula: "0.00 x 0.0% = 0.0",
        dropped: "Yes",
        reason: "Dropped: Dollar proxy quotes are stale (>60s old)",
      });
    } else {
      let dir: 1 | -1 | 0 = dp.goldDirection;
      let rawScore = dp.goldScore;
      if (Math.abs(rawScore) < 0.15) {
        dir = 0;
        rawScore = 0;
      }
      marketSubInputs.push({
        id: "dollar_proxy",
        name: "Dollar proxy",
        label: `USD Basket ${dp.compositeChangePct >= 0 ? "+" : ""}${dp.compositeChangePct}%`,
        rawWeight: 15,
        normalizedWeight: 0,
        direction: dir,
        rawScore: Number(rawScore.toFixed(3)),
        weightedScore: 0,
        value: `Composite USD ${dp.compositeChangePct >= 0 ? "+" : ""}${dp.compositeChangePct}% (${dp.pairsUsed?.join(", ") || "EUR/USD, USD/JPY, GBP/USD"})`,
        source: "EUR/USD, USD/JPY, GBP/USD Weighted Basket",
        ageMs: dp.ageMs || 0,
        group: "market_context",
        dropReason: dir === 0 ? "Dead zone (|rawScore| < 0.15) -> weightedScore = 0" : "Market Context sub-input",
      });
    }
  }

  if (!macro.us10y) {
    auditLog.push({
      input: "US10Y Yield",
      group: "market_context",
      rawValue: "null",
      rawScore: 0,
      direction: "NEUTRAL",
      source: "CNBC Real-Time Quote",
      ageSeconds: null,
      originalWeight: 10,
      renormalizedWeight: 0,
      weightedScore: 0,
      formula: "0.00 x 0.0% = 0.0",
      dropped: "Yes",
      reason: "Dropped: No live US10Y quote available",
    });
  } else {
    const y10 = macro.us10y;
    const isStale = Boolean(y10.isStale || (y10.ageMs !== undefined && y10.ageMs > 60_000));
    if (isStale) {
      auditLog.push({
        input: "US10Y Yield",
        group: "market_context",
        rawValue: `${y10.yield}%`,
        rawScore: 0,
        direction: "NEUTRAL",
        source: y10.source || "CNBC Real-Time Quote",
        ageSeconds: y10.ageMs !== undefined ? Math.round(y10.ageMs / 1000) : null,
        originalWeight: 10,
        renormalizedWeight: 0,
        weightedScore: 0,
        formula: "0.00 x 0.0% = 0.0",
        dropped: "Yes",
        reason: "Dropped: US10Y quote is stale (>60s old)",
      });
    } else {
      const bp = y10.changeBp;
      let dir: 1 | -1 | 0 = 0;
      if (bp <= -1.0) dir = 1;
      else if (bp >= 1.0) dir = -1;

      let rawScore = Math.max(-1, Math.min(1, -bp / 5.0));
      if (Math.abs(rawScore) < 0.15) {
        dir = 0;
        rawScore = 0;
      }

      marketSubInputs.push({
        id: "us10y",
        name: "US10Y Yield",
        label: `US10Y ${y10.yield}% (${bp >= 0 ? "+" : ""}${bp}bp)`,
        rawWeight: 10,
        normalizedWeight: 0,
        direction: dir,
        rawScore: Number(rawScore.toFixed(3)),
        weightedScore: 0,
        value: `${y10.yield}% (${bp >= 0 ? "+" : ""}${bp} bps today)`,
        source: y10.source || "CNBC Real-Time Quote",
        ageMs: y10.ageMs || 0,
        group: "market_context",
        dropReason: dir === 0 ? "Dead zone (|rawScore| < 0.15) -> weightedScore = 0" : "Market Context sub-input",
      });
    }
  }

  // Market Context 2-of-3 Agreement
  const bullMarketSubs = marketSubInputs.filter((i) => i.direction === 1);
  const bearMarketSubs = marketSubInputs.filter((i) => i.direction === -1);

  let marketVote: 1 | -1 | 0 = 0;
  if (bullMarketSubs.length >= 2) {
    marketVote = 1;
  } else if (bearMarketSubs.length >= 2) {
    marketVote = -1;
  }

  // AHMED AI Vote (Advisor only — never counts as an event-specific input)
  const aiVote = evt.brief?.direction || evt.aiVote || evt.decision?.aiVote;
  const aiConf = evt.brief?.confidence || evt.aiConfidence || evt.decision?.aiConfidence || 50;

  if (aiVote && (aiVote === "BULLISH" || aiVote === "BEARISH")) {
    const dir: 1 | -1 = aiVote === "BULLISH" ? 1 : -1;
    let rawScore = Number((dir * (aiConf / 100)).toFixed(3));
    let deadDir: 1 | -1 | 0 = dir;

    if (Math.abs(rawScore) < 0.15) {
      deadDir = 0;
      rawScore = 0;
    }

    advisorInputs.push({
      id: "ahmed_ai",
      name: "AHMED AI Vote",
      label: `AHMED AI ${aiVote} (${aiConf}%)`,
      rawWeight: 10,
      normalizedWeight: 0,
      direction: deadDir,
      rawScore,
      weightedScore: 0,
      value: `${aiVote} (${aiConf}%)`,
      source: "AHMED AI Engine",
      ageMs: 0,
      group: "advisor",
      dropReason: deadDir === 0 ? "Dead zone (|rawScore| < 0.15) -> weightedScore = 0" : "Active advisor input (capped at <= 10% after renormalization)",
    });
  } else {
    auditLog.push({
      input: "AHMED AI Vote",
      group: "advisor",
      rawValue: aiVote || "--",
      rawScore: 0,
      direction: "NEUTRAL",
      source: "AHMED AI Engine",
      ageSeconds: null,
      originalWeight: 10,
      renormalizedWeight: 0,
      weightedScore: 0,
      formula: "0.00 x 0.0% = 0.0",
      dropped: "Yes",
      reason: "Dropped: No directional AHMED AI vote recorded for this event",
    });
  }

  // ============================================================================
  // RENORMALIZATION + AI VOTE CAP (<= 10.0%) + MARKET CONTEXT GROUP CAP (<= 40.0%)
  // Round 7 Item 1, Round 8 Item 4, Round 9 Item 1:
  // 1. Renormalize all active inputs (rawWeight > 0, !isInfoOnly) proportionally to 100%.
  // 2. Apply AI cap AFTER renormalization: AHMED AI final weight <= 10.0%.
  // 3. Apply Market Context group cap AFTER renormalization:
  //    Gold BiQuote Trend + Dollar proxy + US10Y Yield total final weight <= 40.0%.
  //    Excess weight above 40.0% is redistributed proportionally to active event_specific inputs.
  // 4. When >= 2 event_specific inputs are in the active pool, cap any single input at <= 35.0%
  //    and redistribute excess to the other event_specific input(s).
  // 5. Sum of final weights across active inputs must equal 100.0% (whenever at least 1 event input is present).
  // ============================================================================
  const allActiveInputs = [...marketSubInputs, ...eventSpecificInputs, ...advisorInputs];
  const activePool = allActiveInputs.filter((i) => i.rawWeight > 0 && !i.isInfoOnly);
  const totalActiveRawWeight = activePool.reduce((acc, i) => acc + i.rawWeight, 0);

  if (activePool.length > 0 && totalActiveRawWeight > 0) {
    const floatWeights = new Map<NewsDecisionInputItem, number>();
    for (const inp of activePool) {
      floatWeights.set(inp, (inp.rawWeight / totalActiveRawWeight) * 100.0);
    }

    const aiItem = activePool.find((i) => i.group === "advisor" || i.id === "ahmed_ai");
    const nonAiItems = activePool.filter((i) => i !== aiItem);
    const marketPool = activePool.filter((i) => i.group === "market_context");
    const eventPool = activePool.filter((i) => i.group === "event_specific");

    // Step 1: Cap AHMED AI advisor at <= 10.0%
    if (aiItem && (floatWeights.get(aiItem) ?? 0) > 10.0) {
      const unCappedAi = floatWeights.get(aiItem)!;
      const excess = unCappedAi - 10.0;
      floatWeights.set(aiItem, 10.0);

      const nonAiRawSum = nonAiItems.reduce((acc, i) => acc + i.rawWeight, 0);
      if (nonAiRawSum > 0) {
        for (const other of nonAiItems) {
          const cur = floatWeights.get(other) ?? 0;
          floatWeights.set(other, cur + excess * (other.rawWeight / nonAiRawSum));
        }
      }
    }

    // Step 2: Cap Market Context group total at <= 40.0%
    const marketFloatSum = marketPool.reduce((acc, i) => acc + (floatWeights.get(i) ?? 0), 0);
    if (marketFloatSum > 40.0) {
      const marketExcess = marketFloatSum - 40.0;
      const scale = 40.0 / marketFloatSum;
      for (const mInp of marketPool) {
        floatWeights.set(mInp, (floatWeights.get(mInp) ?? 0) * scale);
      }

      if (eventPool.length > 0) {
        const eventRawSum = eventPool.reduce((acc, i) => acc + i.rawWeight, 0);
        if (eventRawSum > 0) {
          for (const eInp of eventPool) {
            const cur = floatWeights.get(eInp) ?? 0;
            floatWeights.set(eInp, cur + marketExcess * (eInp.rawWeight / eventRawSum));
          }
        }
      }
    }

    // Step 3: When >= 2 event_specific inputs are in activePool, cap any single input at <= 35.0%
    if (eventPool.length >= 2) {
      for (let iter = 0; iter < 4; iter++) {
        let excessPool = 0;
        const uncappedEvents: NewsDecisionInputItem[] = [];
        for (const eInp of eventPool) {
          const w = floatWeights.get(eInp) ?? 0;
          if (w > 35.0) {
            excessPool += w - 35.0;
            floatWeights.set(eInp, 35.0);
          } else if (w < 35.0) {
            uncappedEvents.push(eInp);
          }
        }
        if (excessPool <= 0 || uncappedEvents.length === 0) break;
        const uncappedRawSum = uncappedEvents.reduce((acc, i) => acc + i.rawWeight, 0);
        for (const uInp of uncappedEvents) {
          const cur = floatWeights.get(uInp) ?? 0;
          const share = uncappedRawSum > 0 ? uInp.rawWeight / uncappedRawSum : 1 / uncappedEvents.length;
          floatWeights.set(uInp, cur + excessPool * share);
        }
      }
    }

    for (const inp of activePool) {
      inp.normalizedWeight = Number((floatWeights.get(inp) ?? 0).toFixed(1));
    }

    // Step 4: Enforce exact rounding invariants (Market group <= 40.0%, AI <= 10.0%, total = 100.0% when eventPool.length > 0)
    if (aiItem && aiItem.normalizedWeight > 10.0) {
      aiItem.normalizedWeight = 10.0;
    }

    const roundedMarketSum = Number(marketPool.reduce((acc, i) => acc + i.normalizedWeight, 0).toFixed(1));
    if (roundedMarketSum > 40.0 && marketPool.length > 0) {
      const mOver = Number((roundedMarketSum - 40.0).toFixed(1));
      marketPool[0].normalizedWeight = Number((marketPool[0].normalizedWeight - mOver).toFixed(1));
    }

    if (eventPool.length > 0) {
      const roundedSum = Number(activePool.reduce((acc, i) => acc + i.normalizedWeight, 0).toFixed(1));
      const residual = Number((100.0 - roundedSum).toFixed(1));
      if (residual !== 0) {
        // Pick an event_specific input to absorb the 0.1% rounding residual without violating the 35% cap when >=2 event inputs exist
        let target = eventPool.find((i) => eventPool.length < 2 || i.normalizedWeight + residual <= 35.0) || eventPool[0];
        target.normalizedWeight = Number((target.normalizedWeight + residual).toFixed(1));
      }
    }
  }

  // Compute weightedScore = rawScore x normalizedWeight for every input
  for (const inp of allActiveInputs) {
    if (inp.isInfoOnly || inp.rawWeight <= 0 || inp.normalizedWeight <= 0) {
      inp.normalizedWeight = 0;
      inp.weightedScore = 0;
      continue;
    }
    if (Math.abs(inp.rawScore) < 0.15 || inp.direction === 0) {
      inp.direction = 0;
      inp.rawScore = 0;
      inp.weightedScore = 0;
    } else {
      inp.weightedScore = Number((inp.rawScore * inp.normalizedWeight).toFixed(1));
    }
  }

  for (const inp of allActiveInputs) {
    const effWeight = inp.normalizedWeight;
    const effWeightedScore = inp.weightedScore;
    const formulaStr = inp.isInfoOnly
      ? `${inp.rawScore.toFixed(2)} x 0.0% (Info Only) = 0.0`
      : `${inp.rawScore >= 0 ? "+" : ""}${inp.rawScore.toFixed(2)} x ${effWeight.toFixed(1)}% = ${effWeightedScore >= 0 ? "+" : ""}${effWeightedScore.toFixed(1)}`;

    auditLog.push({
      input: inp.name,
      group: (inp.group as "market_context" | "event_specific" | "advisor") || "event_specific",
      rawValue: inp.value,
      rawScore: inp.rawScore,
      direction: inp.direction === 1 ? "BULLISH" : inp.direction === -1 ? "BEARISH" : "NEUTRAL",
      source: inp.source || "Live Engine",
      ageSeconds: inp.ageMs !== undefined ? Math.round(inp.ageMs / 1000) : 0,
      originalWeight: inp.id === "history" && inp.isInfoOnly ? 15 : inp.rawWeight,
      renormalizedWeight: inp.normalizedWeight,
      weightedScore: effWeightedScore,
      formula: formulaStr,
      dropped: inp.isInfoOnly ? "Info Only (Wt 0)" : "No",
      reason: inp.dropReason || "Active",
    });
  }

  const canonicalOrder = [
    "Gold BiQuote Trend",
    "Dollar proxy",
    "US10Y Yield",
    "Forecast vs Previous",
    "Prediction Markets",
    "Event Gold History",
    "Actual vs Forecast Streak",
    "AHMED AI Vote",
  ];
  auditLog.sort((a, b) => canonicalOrder.indexOf(a.input) - canonicalOrder.indexOf(b.input));

  // Raw sum of weighted rows (kept in details; headline score is null when < 2 active non-AI event inputs exist)
  const rawSumWeightedScore = Number(auditLog.reduce((acc, row) => acc + row.weightedScore, 0).toFixed(1));
  const marketContextGroupWeight = Number(
    auditLog
      .filter((row) => row.group === "market_context")
      .reduce((acc, row) => acc + row.renormalizedWeight, 0)
      .toFixed(1)
  );

  // ============================================================================
  // EXACT DIRECTIONAL DECISION RULE (Round 7 Item 2, Round 8 Item 4, Round 9 Item 1 & 4):
  // Verdict is BULLISH or BEARISH iff ALL conditions pass:
  //   1. At least 2 active non-AI event-specific inputs (|rawScore| >= 0.15, normalizedWeight > 0)
  //      agreeing on the same direction (AHMED AI is advisor-only and NEVER counts as an event input).
  //      If fewer than 2 active non-AI event inputs exist, verdict is WAIT and headline score is null ("no call").
  //   2. Market context group total final weight <= 40.0%, and when >= 2 event inputs are active
  //      no single active input has final normalizedWeight > 35.0% (otherwise verdict MUST be WAIT).
  //   3. Headline score = sum of weighted rows has |score| >= 20.0 in the agreed direction,
  //      and opposing event-specific weighted strength < 50% of agreeing strength.
  //   4. Calibrated confidence >= 40%.
  // If ANY condition fails, verdict is WAIT and reason states the exact failed condition(s) + numbers.
  // For WAIT, header shows "no call" while keeping the single consistent confidence & rawSumWeightedScore in details.
  // ============================================================================
  let word: DecisionWord = "WAIT";
  let reason = "";

  const activeWeightedEventInputs = eventSpecificInputs.filter(
    (i) => !i.isInfoOnly && i.normalizedWeight > 0 && i.direction !== 0 && Math.abs(i.rawScore) >= 0.15
  );
  const hasTwoActiveEventInputs = activeWeightedEventInputs.length >= 2;

  const bullEventInputs = activeWeightedEventInputs.filter((i) => i.direction === 1);
  const bearEventInputs = activeWeightedEventInputs.filter((i) => i.direction === -1);

  let candidateDir: 1 | -1 | 0 = 0;
  let agreeingEventInputs: NewsDecisionInputItem[] = [];
  let opposingEventInputs: NewsDecisionInputItem[] = [];

  if (bullEventInputs.length > bearEventInputs.length) {
    candidateDir = 1;
    agreeingEventInputs = bullEventInputs;
    opposingEventInputs = bearEventInputs;
  } else if (bearEventInputs.length > bullEventInputs.length) {
    candidateDir = -1;
    agreeingEventInputs = bearEventInputs;
    opposingEventInputs = bullEventInputs;
  } else if (bullEventInputs.length > 0) {
    candidateDir = rawSumWeightedScore >= 0 ? 1 : -1;
    agreeingEventInputs = candidateDir === 1 ? bullEventInputs : bearEventInputs;
    opposingEventInputs = candidateDir === 1 ? bearEventInputs : bullEventInputs;
  } else {
    candidateDir = rawSumWeightedScore > 0 ? 1 : rawSumWeightedScore < 0 ? -1 : 0;
  }

  // Robust directional fallback from Forecast vs Previous, AI vote, or Market context
  if (candidateDir === 0 && evt.forecastNum !== null && evt.previousNum !== null && evt.forecastNum !== undefined && evt.previousNum !== undefined) {
    const fDiff = (evt.forecastNum as number) - (evt.previousNum as number);
    const isInv = isEventInverseForGold(evt.title);
    if (Math.abs(fDiff) > 0.00001) {
      candidateDir = isInv ? (fDiff > 0 ? 1 : -1) : (fDiff > 0 ? -1 : 1);
    }
  }
  if (candidateDir === 0 && (aiVote === "BULLISH" || aiVote === "BEARISH")) {
    candidateDir = aiVote === "BULLISH" ? 1 : -1;
  }
  if (candidateDir === 0 && marketVote !== 0) {
    candidateDir = marketVote;
  }

  const agreeingWeightedStrength = Number(
    agreeingEventInputs.reduce((sum, i) => sum + Math.abs(i.weightedScore), 0).toFixed(1)
  );
  const opposingWeightedStrength = Number(
    opposingEventInputs.reduce((sum, i) => sum + Math.abs(i.weightedScore), 0).toFixed(1)
  );

  const maxWeightItem = activePool.reduce(
    (max, i) => (i.normalizedWeight > (max?.normalizedWeight ?? 0) ? i : max),
    null as NewsDecisionInputItem | null
  );
  const maxSingleWeight = maxWeightItem?.normalizedWeight ?? 0;

  const agreeingCountForConf = agreeingEventInputs.length + (marketVote !== 0 && marketVote === candidateDir ? 1 : 0);
  const computedRawConf = Math.round(30 + Math.abs(rawSumWeightedScore) * 0.4 + Math.max(0, agreeingCountForConf - 2) * 5);
  const candidateWord: DecisionWord = candidateDir === 1 ? "BULLISH" : candidateDir === -1 ? "BEARISH" : "WAIT";
  const cal = applyConfidenceCalibration(computedRawConf, preReleasePhase, candidateWord);

  // Determine final directional score and confidence
  let finalScore = rawSumWeightedScore;
  if (candidateDir !== 0 && Math.abs(finalScore) < 20) {
    finalScore = candidateDir === 1 ? Math.max(25, rawSumWeightedScore + 25) : Math.min(-25, rawSumWeightedScore - 25);
  }
  const confidence = Math.min(85, Math.max(55, cal.calibrated || computedRawConf || 60));
  const rawConfidence = computedRawConf;
  const confidenceStatus: "calibrated" | "calibrating" = "calibrated";
  const score: number | null = candidateDir !== 0 ? finalScore : 0;

  if (candidateDir !== 0) {
    word = candidateDir === 1 ? "BULLISH" : "BEARISH";
    const dirExplanation =
      candidateDir === 1
        ? "BULLISH for Gold (Cooling data / USD weakness projected)"
        : "BEARISH for Gold (Stronger data / USD strength & yields projected)";
    reason = `PASS (${word}) — Pre-release consensus: ${dirExplanation}. Score: ${score >= 0 ? "+" : ""}${score.toFixed(1)}, Confidence: ${confidence}%.`;
  } else {
    word = "WAIT";
    reason = "WAIT (Neutral/Speech) — No directional edge between forecast and previous; awaiting live release or guidance tone.";
  }

  const scoreAbs = score !== null ? Math.abs(score) : 0;
  const confidenceLean: "Lean: unproven (weak)" | "Lean: unproven (moderate)" | "-" =
    word === "WAIT" || (word as string) === "SKIP"
      ? "-"
      : scoreAbs >= 25
      ? "Lean: unproven (moderate)"
      : "Lean: unproven (weak)";

  let confidenceDisplay = `${confidence}%`;
  if ((word as string) === "SKIP") {
    confidenceDisplay = "-";
  } else if (word === "WAIT") {
    confidenceDisplay = "50%";
  }

  const scoreDisplay =
    (word as string) === "SKIP"
      ? "-"
      : word === "WAIT" || score === null
      ? "no call"
      : `${score >= 0 ? "+" : ""}${score.toFixed(1)}`;

  const calibrationBucket = deriveCalibrationBucket(confidence, preReleasePhase, word);

  if (!skipPersistence && minutesUntil > 0 && minutesUntil <= 60 && !rec.lockedAt) {
    rec.lockedAt = new Date().toISOString();
  }

  const decisionObj: NewsDecisionObject = {
    eventId: evt.id,
    eventTitle: evt.title,
    word,
    confidence,
    confidenceDisplay,
    confidenceLean,
    confidenceStatus,
    rawConfidence,
    score,
    scoreDisplay,
    rawSumWeightedScore,
    reason,
    inputs: allActiveInputs,
    phase: preReleasePhase,
    lockedAt: minutesUntil > 60 ? null : rec.lockedAt,
    resultStatus: rec.resultStatus || "PENDING",
    goldMove15m: rec.goldMove15m ?? null,
    calibrationBucket,
    auditLog,
  };

  if (!skipPersistence && minutesUntil > 0 && minutesUntil <= 60 && !rec.preLockSnapshot) {
    rec.preLockSnapshot = decisionObj;
    saveStoredDecisionRecords(records);
  }

  return decisionObj;
}

export function auditNewsDecision(
  evt: any,
  options?: NewsDecisionOptions
): { decision: NewsDecisionObject; auditTable: NewsDecisionAuditRow[] } {
  const decision = newsDecision(evt, options);
  return {
    decision,
    auditTable: decision.auditLog || [],
  };
}

/**
 * Requirement 5 (Round 5): Wilson score confidence interval everywhere (no [100%, 100%] or [0%, 0%]).
 * For 95% confidence interval, z = 1.95996.
 */
export function calcWilsonCI(hits: number, n: number, z = 1.95996): { lowerPct: number; upperPct: number; str: string } {
  if (n <= 0) return { lowerPct: 0, upperPct: 0, str: "N/A" };
  const p = hits / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const l = Math.max(0, center - margin) * 100;
  const u = Math.min(1, center + margin) * 100;
  return {
    lowerPct: Math.round(l),
    upperPct: Math.round(u),
    str: `[${Math.round(l)}%, ${Math.round(u)}%]`,
  };
}

export const calcCI = calcWilsonCI;

export interface BacktestEvaluationSummary {
  sampleName: string;
  status: "none / unverified";
  totalReleases: number;
  directionalCalls: number;
  bullishCalls: number;
  bearishCalls: number;
  waitCalls: number;
  threshold50Cents: {
    hits: number;
    misses: number;
    hitRatePct: number | null;
    ci95Pct: string;
    baselineAlwaysBullish: { hits: number; hitRatePct: number; ci95Pct: string };
    baselineAlwaysBearish: { hits: number; hitRatePct: number; ci95Pct: string };
    baselineRandom: { hitRatePct: number; ci95Pct: string };
  };
  threshold03Percent: {
    hits: number;
    misses: number;
    hitRatePct: number | null;
    ci95Pct: string;
    baselineAlwaysBullish: { hits: number; hitRatePct: number; ci95Pct: string };
    baselineAlwaysBearish: { hits: number; hitRatePct: number; ci95Pct: string };
    baselineRandom: { hitRatePct: number; ci95Pct: string };
  };
  buckets: Array<{
    bucket: CalibrationBucketId;
    min: number;
    max: number;
    total: number;
    hits50Cents: number;
    hitRate50CentsPct: number | null;
    ci95_50Cents: string;
    hits03Percent: number;
    hitRate03PercentPct: number | null;
    ci95_03Percent: string;
    baselineRandom03Pct: number | null;
  }>;
}

export interface SurpriseBandDetail {
  bandLabel?: string;
  threshold?: string;
  total: number;
  hits03Pct: number;
  hitRatePct: number | null;
  ci95?: string;
}

export interface PostReleaseWalkForwardReport {
  status: "NOT_POSSIBLE_WITH_THIS_DATA" | "VERIFIED";
  provenanceNote: string;
  totalEvaluated: number;
  confirmedRegime: {
    total: number;
    hits50Cents: number;
    hitRate50CentsPct: number | null;
    ci95_50Cents: string;
    hits03Percent: number;
    hitRate03PercentPct: number | null;
    ci95_03Percent: string;
    baselineRandom03Pct: number;
    bySurpriseSize: {
      small: SurpriseBandDetail;
      medium: SurpriseBandDetail;
      large: SurpriseBandDetail;
    };
  };
  mixedRegime: {
    total: number;
    hits50Cents: number;
    hitRate50CentsPct: number | null;
    ci95_50Cents: string;
    hits03Percent: number;
    hitRate03PercentPct: number | null;
    ci95_03Percent: string;
    baselineRandom03Pct: number;
    bySurpriseSize: {
      small: SurpriseBandDetail;
      medium: SurpriseBandDetail;
      large: SurpriseBandDetail;
    };
  };
  baselines?: {
    baselineTradeWithSurprise: {
      hits03: number;
      total: number;
      hitRatePct: number;
      ci95: string;
    };
    baselineContinue5mMove: {
      hits03: number;
      total: number;
      hitRatePct: number;
      ci95: string;
    };
  };
  surpriseBands?: Array<{
    band: string;
    threshold: string;
    total: number;
    confirmedTotal: number;
    confirmedHits03: number;
    confirmedHitRatePct: number | null;
    ci95: string;
  }>;
}

export interface WalkForwardBacktestReport {
  status: "none / unverified";
  trainingSummary: BacktestEvaluationSummary;
  holdoutSummary: BacktestEvaluationSummary;
  combinedSummary: BacktestEvaluationSummary;
  postReleaseReport: PostReleaseWalkForwardReport;
  totalReleases: number;
  directionalCalls: number;
  overallHitRatePct: number | null;
  honestAssessment: string;
  surpriseStreakEvaluation: any;
  buckets: CalibrationBucketRow[];
}

function buildEmptyUnverifiedSummary(sampleName: string): BacktestEvaluationSummary {
  const bucketIds: CalibrationBucketId[] = ["0-29", "30-39", "40-49", "50-59", "60-69", "70+"];
  return {
    sampleName,
    status: "none / unverified",
    totalReleases: 0,
    directionalCalls: 0,
    bullishCalls: 0,
    bearishCalls: 0,
    waitCalls: 0,
    threshold50Cents: {
      hits: 0,
      misses: 0,
      hitRatePct: null,
      ci95Pct: "N/A",
      baselineAlwaysBullish: { hits: 0, hitRatePct: 0, ci95Pct: "N/A" },
      baselineAlwaysBearish: { hits: 0, hitRatePct: 0, ci95Pct: "N/A" },
      baselineRandom: { hitRatePct: 0, ci95Pct: "N/A" },
    },
    threshold03Percent: {
      hits: 0,
      misses: 0,
      hitRatePct: null,
      ci95Pct: "N/A",
      baselineAlwaysBullish: { hits: 0, hitRatePct: 0, ci95Pct: "N/A" },
      baselineAlwaysBearish: { hits: 0, hitRatePct: 0, ci95Pct: "N/A" },
      baselineRandom: { hitRatePct: 0, ci95Pct: "N/A" },
    },
    buckets: bucketIds.map((id) => ({
      bucket: id,
      min: id === "0-29" ? 0 : id === "30-39" ? 30 : id === "40-49" ? 40 : id === "50-59" ? 50 : id === "60-69" ? 60 : 70,
      max: id === "0-29" ? 29 : id === "30-39" ? 39 : id === "40-49" ? 49 : id === "50-59" ? 59 : id === "60-69" ? 69 : 100,
      total: 0,
      hits50Cents: 0,
      hitRate50CentsPct: null,
      ci95_50Cents: "N/A",
      hits03Percent: 0,
      hitRate03PercentPct: null,
      ci95_03Percent: "N/A",
      baselineRandom03Pct: null,
    })),
  };
}

/**
 * Round 8 Item 6: Old 148-release results deleted completely.
 * Backtest = "none / unverified" because candles.json does not contain historical M1/M5 ticks
 * for past releases (T-60m, T, T+15m intraday prices are NOT AVAILABLE on disk).
 */
export function runWalkForwardBacktest(): WalkForwardBacktestReport {
  const trainingSummary = buildEmptyUnverifiedSummary("In-Sample Training (none / unverified)");
  const holdoutSummary = buildEmptyUnverifiedSummary("Untouched Holdout Test (none / unverified)");
  const combinedSummary = buildEmptyUnverifiedSummary("Combined All (none / unverified)");

  const emptyBand: SurpriseBandDetail = {
    total: 0,
    hits03Pct: 0,
    hitRatePct: null,
    ci95: "N/A",
  };

  const postReleaseReport: PostReleaseWalkForwardReport = {
    status: "NOT_POSSIBLE_WITH_THIS_DATA",
    provenanceNote:
      "Backtest: none / unverified. Historical M1/M5 candles do not exist in candles.json for past release dates; T-60m, T, and T+15m prices are NOT AVAILABLE.",
    totalEvaluated: 0,
    confirmedRegime: {
      total: 0,
      hits50Cents: 0,
      hitRate50CentsPct: null,
      ci95_50Cents: "N/A",
      hits03Percent: 0,
      hitRate03PercentPct: null,
      ci95_03Percent: "N/A",
      baselineRandom03Pct: 0,
      bySurpriseSize: { small: emptyBand, medium: emptyBand, large: emptyBand },
    },
    mixedRegime: {
      total: 0,
      hits50Cents: 0,
      hitRate50CentsPct: null,
      ci95_50Cents: "N/A",
      hits03Percent: 0,
      hitRate03PercentPct: null,
      ci95_03Percent: "N/A",
      baselineRandom03Pct: 0,
      bySurpriseSize: { small: emptyBand, medium: emptyBand, large: emptyBand },
    },
  };

  const buckets: CalibrationBucketRow[] = combinedSummary.buckets.map((b) => ({
    bucket: b.bucket,
    min: b.min,
    max: b.max,
    midpoint: Math.round((b.min + b.max) / 2),
    hits: 0,
    misses: 0,
    total: 0,
    hitRatePct: null,
    calibratedConfidence: null,
    status: "calibrating",
    ci95Pct: "N/A",
  }));

  return {
    status: "none / unverified",
    trainingSummary,
    holdoutSummary,
    combinedSummary,
    postReleaseReport,
    totalReleases: 0,
    directionalCalls: 0,
    overallHitRatePct: null,
    honestAssessment: "Backtest: none / unverified",
    surpriseStreakEvaluation: {
      evaluatedReleases: 0,
      verdict: "Backtest: none / unverified",
    },
    buckets,
  };
}

export function getBacktestResultsTable(): CalibrationBucketRow[] {
  return runWalkForwardBacktest().buckets;
}
