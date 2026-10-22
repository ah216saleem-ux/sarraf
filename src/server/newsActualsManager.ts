import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './deploymentSafety.ts';
import {
  computeGoldImpact,
  isReversedGoldEvent,
  loadManualActuals,
  setManualActualValue,
} from './newsEngine.ts';

export interface ActualMetaRecord {
  eventId: string;
  eventTitle?: string;
  actualValue: string;
  numberValue: number;
  unit: string;
  source: 'manual' | 'FRED';
  savedAt: string;
  savedBy?: string;
  fredNote?: string;
}

export interface ManualActualAuditEntry {
  id: string;
  eventId: string;
  eventTitle: string;
  action: 'SET' | 'CORRECT' | 'DELETE' | 'FRED_AUTO';
  who: string;
  when: string;
  oldValue: string | null;
  newValue: string | null;
  source: 'manual' | 'FRED';
}

export const ALLOWED_ACTUAL_UNITS = ['', '%', 'K', 'M', 'B', 'T'] as const;
export type AllowedActualUnit = (typeof ALLOWED_ACTUAL_UNITS)[number];

export interface IndicatorValidationRule {
  name: string;
  min: number;
  max: number;
  allowedUnits: AllowedActualUnit[];
}

export function getIndicatorValidationRule(title: string): IndicatorValidationRule {
  const t = (title || '').toLowerCase();

  if (
    t.includes('unemployment claims') ||
    t.includes('initial claims') ||
    t.includes('jobless claims')
  ) {
    return {
      name: 'Unemployment Claims',
      min: 50,
      max: 1500,
      allowedUnits: ['K'],
    };
  }
  if (t.includes('continuing claims')) {
    return {
      name: 'Continuing Claims',
      min: 500,
      max: 10000,
      allowedUnits: ['K', 'M'],
    };
  }
  if (t.includes('unemployment rate')) {
    return {
      name: 'Unemployment Rate',
      min: 1.0,
      max: 25.0,
      allowedUnits: ['%'],
    };
  }
  if (t.includes('non-farm') || t.includes('nonfarm') || t === 'nfp') {
    return {
      name: 'Non-Farm Payrolls',
      min: -2000,
      max: 2000,
      allowedUnits: ['K'],
    };
  }
  if (t.includes('cpi') && t.includes('m/m')) {
    return {
      name: 'CPI m/m',
      min: -5.0,
      max: 10.0,
      allowedUnits: ['%'],
    };
  }
  if (t.includes('cpi') && t.includes('y/y')) {
    return {
      name: 'CPI y/y',
      min: -5.0,
      max: 20.0,
      allowedUnits: ['%'],
    };
  }
  if (
    t.includes('ppi') ||
    t.includes('pce') ||
    t.includes('retail sales') ||
    t.includes('gdp') ||
    t.includes('federal funds rate')
  ) {
    return {
      name: 'Macro Rate / Growth (%)',
      min: -15.0,
      max: 25.0,
      allowedUnits: ['%'],
    };
  }
  if (t.includes('pmi') || t.includes('ism')) {
    return {
      name: 'PMI / ISM Index',
      min: 20.0,
      max: 85.0,
      allowedUnits: [''],
    };
  }
  if (t.includes('consumer sentiment') || t.includes('consumer confidence')) {
    return {
      name: 'Consumer Sentiment / Confidence',
      min: 20.0,
      max: 150.0,
      allowedUnits: [''],
    };
  }

  return {
    name: 'General Indicator',
    min: -10000,
    max: 10000,
    allowedUnits: ['', '%', 'K', 'M', 'B', 'T'],
  };
}

export function validateManualActualInput(
  eventTitle: string,
  rawNumberInput: unknown,
  rawUnitInput: unknown
): {
  valid: boolean;
  error?: string;
  numericValue?: number;
  unit?: AllowedActualUnit;
  formattedActual?: string;
} {
  if (rawNumberInput === undefined || rawNumberInput === null) {
    return { valid: false, error: 'Numeric actual value is required.' };
  }

  const numStr = String(rawNumberInput).trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(numStr)) {
    return {
      valid: false,
      error: `Invalid number "${numStr}": must be a plain numeric value (digits and optional decimal only).`,
    };
  }

  const numericValue = Number(numStr);
  if (!Number.isFinite(numericValue)) {
    return { valid: false, error: 'Actual value must be a finite number.' };
  }

  const rawUnit =
    rawUnitInput === undefined || rawUnitInput === null ? '' : String(rawUnitInput).trim();
  if (!(ALLOWED_ACTUAL_UNITS as readonly string[]).includes(rawUnit)) {
    return {
      valid: false,
      error: `Invalid unit "${rawUnit}": must be one of [${ALLOWED_ACTUAL_UNITS.map((u) => `"${u}"`).join(', ')}].`,
    };
  }
  const unit = rawUnit as AllowedActualUnit;

  const rule = getIndicatorValidationRule(eventTitle);
  if (!rule.allowedUnits.includes(unit)) {
    return {
      valid: false,
      error: `Invalid unit "${unit}" for ${rule.name}: expected [${rule.allowedUnits.map((u) => `"${u}"`).join(', ')}].`,
    };
  }

  if (numericValue < rule.min || numericValue > rule.max) {
    return {
      valid: false,
      error: `Value ${numericValue}${unit} out of sane range for ${rule.name} ([${rule.min}, ${rule.max}]).`,
    };
  }

  return {
    valid: true,
    numericValue,
    unit,
    formattedActual: `${numStr}${unit}`,
  };
}

// -------------------------------------------------------------
// RATE LIMITER FOR MANUAL ACTUAL ENDPOINT
// -------------------------------------------------------------
const rateLimitBuckets = new Map<string, number[]>();

export function checkManualActualRateLimit(
  clientKey: string,
  nowMs: number = Date.now(),
  maxRequests: number = 10,
  windowMs: number = 60_000
): { allowed: boolean; remaining: number } {
  const history = (rateLimitBuckets.get(clientKey) || []).filter((ts) => nowMs - ts < windowMs);
  if (history.length >= maxRequests) {
    rateLimitBuckets.set(clientKey, history);
    return { allowed: false, remaining: 0 };
  }
  history.push(nowMs);
  rateLimitBuckets.set(clientKey, history);
  return { allowed: true, remaining: maxRequests - history.length };
}

export function resetManualActualRateLimit(): void {
  rateLimitBuckets.clear();
}

// -------------------------------------------------------------
// STORAGE HELPERS (Supports isolated dataDir for tests)
// -------------------------------------------------------------
function getMetaFilePath(customDataDir?: string): string {
  const baseDir = customDataDir || path.join(process.cwd(), 'data');
  return path.join(baseDir, 'news_actuals_meta.json');
}

function getAuditFilePath(customDataDir?: string): string {
  const baseDir = customDataDir || path.join(process.cwd(), 'data');
  return path.join(baseDir, 'news_actuals_audit.json');
}

export function loadActualsMeta(customDataDir?: string): Record<string, ActualMetaRecord> {
  const file = getMetaFilePath(customDataDir);
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) || {};
    }
  } catch {
    // ignore read error
  }
  return {};
}

export function saveActualsMeta(
  metaMap: Record<string, ActualMetaRecord>,
  customDataDir?: string
): void {
  const file = getMetaFilePath(customDataDir);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(metaMap, null, 2), 'utf-8');
}

export function loadManualActualAuditLog(customDataDir?: string): ManualActualAuditEntry[] {
  const file = getAuditFilePath(customDataDir);
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) || [];
    }
  } catch {
    // ignore
  }
  return [];
}

export function appendManualActualAudit(
  entry: Omit<ManualActualAuditEntry, 'id'>,
  customDataDir?: string
): ManualActualAuditEntry {
  const list = loadManualActualAuditLog(customDataDir);
  const fullEntry: ManualActualAuditEntry = {
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ...entry,
  };
  list.push(fullEntry);
  const file = getAuditFilePath(customDataDir);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf-8');
  return fullEntry;
}

// Sync deletion or update into newsEngine's NEWS_MANUAL_FILE when operating on live store
function syncLiveNewsManualStore(
  eventId: string,
  actualValue: string | null,
  source: 'MANUAL' | 'FEED',
  note: string
): void {
  const liveManualFile = path.resolve(DATA_DIR, 'news_manual.json');
  if (actualValue === null) {
    try {
      if (fs.existsSync(liveManualFile)) {
        const current = JSON.parse(fs.readFileSync(liveManualFile, 'utf-8')) || {};
        delete current[eventId];
        fs.writeFileSync(liveManualFile, JSON.stringify(current, null, 2), 'utf-8');
      }
      loadManualActuals();
    } catch {
      // ignore
    }
  } else {
    setManualActualValue(eventId, actualValue, source, note);
  }
}

// -------------------------------------------------------------
// SECURE ADMIN ACTUAL CONTROLLER (Auth + Role + Validation + Audit + Delete/Correct)
// -------------------------------------------------------------
export interface AdminSessionContext {
  authenticated: boolean;
  user?: {
    email: string;
    role: 'admin' | 'viewer' | string;
  } | null;
  clientIp?: string;
}

export interface ManualActualRequestPayload {
  eventId: string;
  eventTitle?: string;
  action?: 'set' | 'correct' | 'delete';
  numberValue?: unknown;
  unit?: unknown;
  actualValue?: unknown;
  note?: string;
}

export interface ManualActualResponse {
  statusCode: number;
  body: {
    status: 'SUCCESS' | 'ERROR';
    error?: string;
    message?: string;
    action?: 'SET' | 'CORRECT' | 'DELETE';
    record?: ActualMetaRecord | null;
    auditEntry?: ManualActualAuditEntry;
  };
}

export function processManualActualRequest(
  session: AdminSessionContext,
  payload: ManualActualRequestPayload,
  options?: {
    customDataDir?: string;
    nowIso?: string;
    nowMs?: number;
  }
): ManualActualResponse {
  // 1. Authentication check -> 401
  if (!session || !session.authenticated || !session.user) {
    return {
      statusCode: 401,
      body: {
        status: 'ERROR',
        error: 'Unauthorized: Valid admin session required.',
      },
    };
  }

  // 2. Authorization check (admin role required) -> 403
  if (String(session.user.role || '').toLowerCase() !== 'admin') {
    return {
      statusCode: 403,
      body: {
        status: 'ERROR',
        error: 'Forbidden: Admin role required to enter, correct, or delete actual values.',
      },
    };
  }

  // 3. Rate limit check -> 429
  const rateKey = `${session.user.email || 'admin'}:${session.clientIp || 'local'}`;
  const rateStatus = checkManualActualRateLimit(rateKey, options?.nowMs ?? Date.now());
  if (!rateStatus.allowed) {
    return {
      statusCode: 429,
      body: {
        status: 'ERROR',
        error: 'Rate limit exceeded for manual actual modifications. Try again in a minute.',
      },
    };
  }

  const eventId = String(payload?.eventId || '').trim();
  const eventTitle = String(payload?.eventTitle || payload?.eventId || '').trim();
  if (!eventId) {
    return {
      statusCode: 400,
      body: {
        status: 'ERROR',
        error: 'eventId is required.',
      },
    };
  }

  const customDataDir = options?.customDataDir;
  const nowIso = options?.nowIso || new Date().toISOString();
  const metaMap = loadActualsMeta(customDataDir);
  const existing = metaMap[eventId] || null;

  const requestedAction = String(payload?.action || '').toLowerCase();

  // 4. Handle DELETE action
  if (requestedAction === 'delete') {
    const oldVal = existing ? existing.actualValue : null;
    delete metaMap[eventId];
    saveActualsMeta(metaMap, customDataDir);

    if (!customDataDir) {
      syncLiveNewsManualStore(eventId, null, 'MANUAL', `Deleted by ${session.user.email}`);
    }

    const auditEntry = appendManualActualAudit(
      {
        eventId,
        eventTitle,
        action: 'DELETE',
        who: session.user.email,
        when: nowIso,
        oldValue: oldVal,
        newValue: null,
        source: 'manual',
      },
      customDataDir
    );

    return {
      statusCode: 200,
      body: {
        status: 'SUCCESS',
        action: 'DELETE',
        message: `Actual value for "${eventTitle}" deleted.`,
        record: null,
        auditEntry,
      },
    };
  }

  // 5. Parse & Validate Number + Unit -> 400 on bad value
  let rawNum = payload.numberValue;
  let rawUnit = payload.unit;
  if ((rawNum === undefined || rawNum === null || rawNum === '') && payload.actualValue !== undefined) {
    const str = String(payload.actualValue).trim();
    const match = str.match(/^([+-]?\d+(?:\.\d+)?)\s*(.*)$/);
    if (match) {
      rawNum = match[1];
      rawUnit = match[2];
    } else {
      rawNum = str;
    }
  }

  const validation = validateManualActualInput(eventTitle, rawNum, rawUnit);
  if (!validation.valid || validation.numericValue === undefined || !validation.formattedActual) {
    return {
      statusCode: 400,
      body: {
        status: 'ERROR',
        error: validation.error || 'Invalid manual actual value.',
      },
    };
  }

  const auditAction: 'SET' | 'CORRECT' =
    existing || requestedAction === 'correct' ? 'CORRECT' : 'SET';
  const oldVal = existing ? existing.actualValue : null;

  const newRecord: ActualMetaRecord = {
    eventId,
    eventTitle,
    actualValue: validation.formattedActual,
    numberValue: validation.numericValue,
    unit: validation.unit || '',
    source: 'manual',
    savedAt: nowIso,
    savedBy: session.user.email,
  };

  metaMap[eventId] = newRecord;
  saveActualsMeta(metaMap, customDataDir);

  if (!customDataDir) {
    syncLiveNewsManualStore(
      eventId,
      validation.formattedActual,
      'MANUAL',
      `manual (${nowIso}) by ${session.user.email}`
    );
  }

  const auditEntry = appendManualActualAudit(
    {
      eventId,
      eventTitle,
      action: auditAction,
      who: session.user.email,
      when: nowIso,
      oldValue: oldVal,
      newValue: validation.formattedActual,
      source: 'manual',
    },
    customDataDir
  );

  return {
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      action: auditAction,
      message: `Manual actual "${validation.formattedActual}" recorded (${auditAction}).`,
      record: newRecord,
      auditEntry,
    },
  };
}

// -------------------------------------------------------------
// ITEM 3: WORDING (ABOVE FORECAST / BELOW FORECAST / IN LINE + Gold Reading Separately)
// -------------------------------------------------------------
export interface ReactionReadingOutput {
  comparisonTag: 'ABOVE FORECAST' | 'BELOW FORECAST' | 'IN LINE';
  goldDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  goldReading: string; // e.g. "textbook gold BULLISH"
  combinedLabel: string; // e.g. "ABOVE FORECAST · textbook gold BULLISH"
  fullReadingLine: string; // e.g. "Actual 235K vs Forecast 220K: ABOVE FORECAST · textbook gold BULLISH"
  goldArrow: '↑' | '↓' | '→';
}

export function computeActualReactionReading(
  title: string,
  forecastStr: string,
  forecastNum: number | null,
  actualStr: string,
  actualNum: number | null
): ReactionReadingOutput | null {
  if (actualNum === null || actualNum === undefined || !actualStr || actualStr === '--') {
    return null;
  }

  if (forecastNum === null || forecastNum === undefined || !forecastStr || forecastStr === '--') {
    return {
      comparisonTag: 'IN LINE',
      goldDirection: 'NEUTRAL',
      goldReading: 'textbook gold NEUTRAL',
      combinedLabel: 'IN LINE · textbook gold NEUTRAL',
      fullReadingLine: `Actual ${actualStr} (no forecast): IN LINE · textbook gold NEUTRAL`,
      goldArrow: '→',
    };
  }

  const diff = actualNum - forecastNum;
  const tol = Math.max(Math.abs(forecastNum) * 0.0001, 1e-6);

  if (Math.abs(diff) <= tol) {
    return {
      comparisonTag: 'IN LINE',
      goldDirection: 'NEUTRAL',
      goldReading: 'textbook gold NEUTRAL',
      combinedLabel: 'IN LINE · textbook gold NEUTRAL',
      fullReadingLine: `Actual ${actualStr} vs Forecast ${forecastStr}: IN LINE · textbook gold NEUTRAL`,
      goldArrow: '→',
    };
  }

  const comparisonTag: 'ABOVE FORECAST' | 'BELOW FORECAST' =
    diff > 0 ? 'ABOVE FORECAST' : 'BELOW FORECAST';

  // Use existing sign table via computeGoldImpact / isReversedGoldEvent
  const impact = computeGoldImpact(title, forecastNum, actualNum, true);
  const goldDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    impact === 'BULLISH' || impact === 'BEARISH'
      ? impact
      : diff > 0
      ? isReversedGoldEvent(title)
        ? 'BULLISH'
        : 'BEARISH'
      : isReversedGoldEvent(title)
      ? 'BEARISH'
      : 'BULLISH';

  const goldReading = `textbook gold ${goldDirection}`;
  const combinedLabel = `${comparisonTag} · ${goldReading}`;
  const goldArrow: '↑' | '↓' | '→' =
    goldDirection === 'BULLISH' ? '↑' : goldDirection === 'BEARISH' ? '↓' : '→';

  return {
    comparisonTag,
    goldDirection,
    goldReading,
    combinedLabel,
    fullReadingLine: `Actual ${actualStr} vs Forecast ${forecastStr}: ${combinedLabel}`,
    goldArrow,
  };
}

// -------------------------------------------------------------
// ITEM 4: FRED CORRECTNESS (Reference Period + Series Conversions)
// -------------------------------------------------------------
export type SupportedFredSeries = 'ICSA' | 'UNRATE' | 'CPIAUCSL' | 'PAYEMS';

export interface FredEventSpec {
  seriesId: SupportedFredSeries;
  mode: 'CLAIMS_LEVEL_TO_K' | 'UNRATE_PCT' | 'CPI_MOM_PCT' | 'CPI_YOY_PCT' | 'PAYEMS_DIFF_K';
  unit: 'K' | '%';
  expectedObservationDate: string; // YYYY-MM-DD (Saturday before release for ICSA; YYYY-MM-01 for monthly)
  referencePeriodLabel: string;
}

export function getExpectedFredSpecForEvent(
  title: string,
  releaseTimeUtc: string
): FredEventSpec | null {
  const d = new Date(releaseTimeUtc);
  if (isNaN(d.getTime())) return null;

  const t = (title || '').toLowerCase();

  // 1. Unemployment Claims (ICSA): week ending the Saturday immediately before the release
  if (
    t.includes('unemployment claims') ||
    t.includes('initial claims') ||
    t.includes('jobless claims')
  ) {
    const utcDay = d.getUTCDay(); // 0=Sun .. 4=Thu .. 6=Sat
    const daysSinceSaturday = (utcDay + 1) % 7 || 7;
    const satMs = Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate() - daysSinceSaturday
    );
    const satDateStr = new Date(satMs).toISOString().slice(0, 10);
    return {
      seriesId: 'ICSA',
      mode: 'CLAIMS_LEVEL_TO_K',
      unit: 'K',
      expectedObservationDate: satDateStr,
      referencePeriodLabel: `Week ending Saturday ${satDateStr}`,
    };
  }

  // Monthly indicators: reference month is the month preceding the release date
  const relYear = d.getUTCFullYear();
  const relMonth0 = d.getUTCMonth(); // 0..11
  const refDate = new Date(Date.UTC(relYear, relMonth0 - 1, 1));
  const refYear = refDate.getUTCFullYear();
  const refMonthStr = String(refDate.getUTCMonth() + 1).padStart(2, '0');
  const expectedMonthlyDate = `${refYear}-${refMonthStr}-01`;
  const refMonthLabel = `${refYear}-${refMonthStr}`;

  // 2. Unemployment Rate (UNRATE)
  if (t.includes('unemployment rate')) {
    return {
      seriesId: 'UNRATE',
      mode: 'UNRATE_PCT',
      unit: '%',
      expectedObservationDate: expectedMonthlyDate,
      referencePeriodLabel: `Reference month ${refMonthLabel}`,
    };
  }

  // 3. Non-Farm Payrolls / Non-Farm Employment Change (PAYEMS)
  if (t.includes('non-farm') || t.includes('nonfarm') || t === 'nfp') {
    return {
      seriesId: 'PAYEMS',
      mode: 'PAYEMS_DIFF_K',
      unit: 'K',
      expectedObservationDate: expectedMonthlyDate,
      referencePeriodLabel: `Reference month ${refMonthLabel}`,
    };
  }

  // 4. Headline CPI m/m or CPI y/y (CPIAUCSL)
  if (t === 'cpi m/m' || (t.includes('cpi') && t.includes('m/m') && !t.includes('core'))) {
    return {
      seriesId: 'CPIAUCSL',
      mode: 'CPI_MOM_PCT',
      unit: '%',
      expectedObservationDate: expectedMonthlyDate,
      referencePeriodLabel: `Reference month ${refMonthLabel}`,
    };
  }

  if (t === 'cpi y/y' || (t.includes('cpi') && t.includes('y/y') && !t.includes('core'))) {
    return {
      seriesId: 'CPIAUCSL',
      mode: 'CPI_YOY_PCT',
      unit: '%',
      expectedObservationDate: expectedMonthlyDate,
      referencePeriodLabel: `Reference month ${refMonthLabel}`,
    };
  }

  return null;
}

export interface FredObservationRaw {
  realtime_start?: string;
  realtime_end?: string;
  date: string;
  value: string;
}

export interface FredConversionResult {
  accepted: boolean;
  seriesId: SupportedFredSeries;
  expectedObservationDate: string;
  latestObservationDate: string | null;
  numericValue: number | null;
  formattedActual: string | null;
  unit: 'K' | '%';
  formulaSteps: string;
  note?: string;
  rejectionReason?: string;
}

function getPreviousMonthObservationDate(yyyyMm01: string, monthsBack: number): string {
  const year = Number(yyyyMm01.slice(0, 4));
  const month0 = Number(yyyyMm01.slice(5, 7)) - 1;
  const d = new Date(Date.UTC(year, month0 - monthsBack, 1));
  return d.toISOString().slice(0, 10);
}

export function convertFredObservationsForEvent(
  title: string,
  releaseTimeUtc: string,
  rawResponse: { observations?: FredObservationRaw[] }
): FredConversionResult | null {
  const spec = getExpectedFredSpecForEvent(title, releaseTimeUtc);
  if (!spec) return null;

  const observations = Array.isArray(rawResponse?.observations)
    ? rawResponse.observations.filter((o) => o && o.value && o.value !== '.')
    : [];

  const latestObs = observations[0] || null;
  const latestObservationDate = latestObs?.date || null;

  // Strict reference period match check:
  // Accept ONLY if the observation exists for the release's exact reference period
  const targetObs = observations.find((o) => o.date === spec.expectedObservationDate);
  if (!targetObs) {
    return {
      accepted: false,
      seriesId: spec.seriesId,
      expectedObservationDate: spec.expectedObservationDate,
      latestObservationDate,
      numericValue: null,
      formattedActual: null,
      unit: spec.unit,
      formulaSteps: `Expected observation date ${spec.expectedObservationDate} (${spec.referencePeriodLabel}), but latest published observation is ${latestObservationDate || 'none'}. Left actual empty.`,
      rejectionReason: `Stale or unpublished observation: latest date ${latestObservationDate || 'none'} != expected reference period ${spec.expectedObservationDate}.`,
    };
  }

  const targetVal = Number(targetObs.value);
  if (!Number.isFinite(targetVal)) {
    return {
      accepted: false,
      seriesId: spec.seriesId,
      expectedObservationDate: spec.expectedObservationDate,
      latestObservationDate,
      numericValue: null,
      formattedActual: null,
      unit: spec.unit,
      formulaSteps: 'Invalid numeric observation in FRED payload.',
      rejectionReason: 'Invalid numeric value.',
    };
  }

  // Case 1: ICSA (persons -> K)
  if (spec.mode === 'CLAIMS_LEVEL_TO_K') {
    const inThousands = Number((targetVal / 1000).toFixed(1));
    const formattedNum = Number.isInteger(inThousands)
      ? String(inThousands)
      : inThousands.toFixed(1);
    return {
      accepted: true,
      seriesId: 'ICSA',
      expectedObservationDate: spec.expectedObservationDate,
      latestObservationDate,
      numericValue: inThousands,
      formattedActual: `${formattedNum}K`,
      unit: 'K',
      formulaSteps: `ICSA(${targetObs.date}) = ${targetVal} persons / 1000 = ${formattedNum}K`,
    };
  }

  // Case 2: UNRATE (%)
  if (spec.mode === 'UNRATE_PCT') {
    const pct = Number(targetVal.toFixed(1));
    return {
      accepted: true,
      seriesId: 'UNRATE',
      expectedObservationDate: spec.expectedObservationDate,
      latestObservationDate,
      numericValue: pct,
      formattedActual: `${pct.toFixed(1)}%`,
      unit: '%',
      formulaSteps: `UNRATE(${targetObs.date}) = ${pct.toFixed(1)}%`,
    };
  }

  // Case 3: CPIAUCSL m/m %
  if (spec.mode === 'CPI_MOM_PCT') {
    const prevMonthDate = getPreviousMonthObservationDate(spec.expectedObservationDate, 1);
    const prevObs = observations.find((o) => o.date === prevMonthDate);
    if (!prevObs || !Number.isFinite(Number(prevObs.value)) || Number(prevObs.value) <= 0) {
      return {
        accepted: false,
        seriesId: 'CPIAUCSL',
        expectedObservationDate: spec.expectedObservationDate,
        latestObservationDate,
        numericValue: null,
        formattedActual: null,
        unit: '%',
        formulaSteps: `Missing prior-month index (${prevMonthDate}) required to compute CPI m/m %.`,
        rejectionReason: `Missing prior-month CPIAUCSL observation (${prevMonthDate}).`,
      };
    }
    const prevVal = Number(prevObs.value);
    const rawMom = ((targetVal - prevVal) / prevVal) * 100;
    const momPct = Number(rawMom.toFixed(1));
    return {
      accepted: true,
      seriesId: 'CPIAUCSL',
      expectedObservationDate: spec.expectedObservationDate,
      latestObservationDate,
      numericValue: momPct,
      formattedActual: `${momPct.toFixed(1)}%`,
      unit: '%',
      formulaSteps: `CPI m/m % = ((${targetVal} [${targetObs.date}] - ${prevVal} [${prevObs.date}]) / ${prevVal}) * 100 = ${rawMom.toFixed(3)}% -> ${momPct.toFixed(1)}%`,
    };
  }

  // Case 4: CPIAUCSL y/y %
  if (spec.mode === 'CPI_YOY_PCT') {
    const prevYearDate = getPreviousMonthObservationDate(spec.expectedObservationDate, 12);
    const prevYearObs = observations.find((o) => o.date === prevYearDate);
    if (
      !prevYearObs ||
      !Number.isFinite(Number(prevYearObs.value)) ||
      Number(prevYearObs.value) <= 0
    ) {
      return {
        accepted: false,
        seriesId: 'CPIAUCSL',
        expectedObservationDate: spec.expectedObservationDate,
        latestObservationDate,
        numericValue: null,
        formattedActual: null,
        unit: '%',
        formulaSteps: `Missing 12-month-prior index (${prevYearDate}) required to compute CPI y/y %.`,
        rejectionReason: `Missing 12-month-prior CPIAUCSL observation (${prevYearDate}).`,
      };
    }
    const prevYearVal = Number(prevYearObs.value);
    const rawYoy = ((targetVal - prevYearVal) / prevYearVal) * 100;
    const yoyPct = Number(rawYoy.toFixed(1));
    return {
      accepted: true,
      seriesId: 'CPIAUCSL',
      expectedObservationDate: spec.expectedObservationDate,
      latestObservationDate,
      numericValue: yoyPct,
      formattedActual: `${yoyPct.toFixed(1)}%`,
      unit: '%',
      formulaSteps: `CPI y/y % = ((${targetVal} [${targetObs.date}] - ${prevYearVal} [${prevYearObs.date}]) / ${prevYearVal}) * 100 = ${rawYoy.toFixed(3)}% -> ${yoyPct.toFixed(1)}%`,
    };
  }

  // Case 5: PAYEMS (level in thousands -> NFP = this month minus previous month in K)
  if (spec.mode === 'PAYEMS_DIFF_K') {
    const prevMonthDate = getPreviousMonthObservationDate(spec.expectedObservationDate, 1);
    const prevObs = observations.find((o) => o.date === prevMonthDate);
    if (!prevObs || !Number.isFinite(Number(prevObs.value))) {
      return {
        accepted: false,
        seriesId: 'PAYEMS',
        expectedObservationDate: spec.expectedObservationDate,
        latestObservationDate,
        numericValue: null,
        formattedActual: null,
        unit: 'K',
        formulaSteps: `Missing prior-month PAYEMS level (${prevMonthDate}) required to compute NFP change.`,
        rejectionReason: `Missing prior-month PAYEMS observation (${prevMonthDate}).`,
      };
    }
    const prevVal = Number(prevObs.value);
    const diffK = Math.round(targetVal - prevVal);
    const note =
      'FRED PAYEMS is a cumulative level in thousands; NFP = this month minus previous month (in K). Note: FRED values already include prior-month revisions.';
    return {
      accepted: true,
      seriesId: 'PAYEMS',
      expectedObservationDate: spec.expectedObservationDate,
      latestObservationDate,
      numericValue: diffK,
      formattedActual: `${diffK}K`,
      unit: 'K',
      formulaSteps: `NFP = PAYEMS(${targetObs.date}: ${targetVal}K) - PAYEMS(${prevObs.date}: ${prevVal}K) = ${diffK}K (FRED values already include revisions)`,
      note,
    };
  }

  return null;
}
