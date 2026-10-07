import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { runSarrafAnalysis, SignalPlan, Zone } from './sarrafEngine.ts';
import { Candle, getClosedCandles } from './candleEngine.ts';
import {
  loadGoogleChatSettings,
  recordSetupForReview,
  revalidateSetupForApproval,
  updateSetupReviewStatus,
} from './googleChatService.ts';
import {
  DATA_DIR,
  writeJsonAtomic,
  recoverCorruptedFileFromLatestBackup,
} from './deploymentSafety.ts';
import { getCurrentSettings } from './settingsEngine.ts';

const SIGNALS_FILE = path.resolve(DATA_DIR, 'signals.json');
const OUTBOX_FILE = path.resolve(DATA_DIR, 'outbox.json');

export type ManagerState =
  | 'SCANNING'
  | 'PENDING_REVIEW'
  | 'PENDING'
  | 'ACTIVE'
  | 'CLOSED'
  | 'COOLDOWN'
  | 'PAUSED'
  | 'HALTED_FEED';

export type ResultClass =
  | 'WIN'
  | 'LOSS'
  | 'BREAKEVEN'
  | 'EXPIRED'
  | 'TIMEOUT'
  | 'MARKET_CLOSE'
  | 'REVIEW_TIMEOUT'
  | 'STALE_AFTER_REVIEW'
  | 'REJECTED';

export interface SignalEvent {
  id: string;
  signalId: string;
  type:
    | 'ENTRY_HIT'
    | 'TP1'
    | 'TP2'
    | 'TP3'
    | 'TP4'
    | 'SL'
    | 'BE_STOP'
    | 'EXPIRED'
    | 'MANUAL_CLOSE'
    | 'MARKET_CLOSE'
    | 'TIMEOUT'
    | 'RECOVERED'
    | 'REVIEW_TIMEOUT'
    | 'STALE_AFTER_REVIEW'
    | 'REJECTED';
  timestamp: string; // UTC ISO
  price: number;
  bid: number;
  ask: number;
  spread: number;
  slippageDollars: number;
  ambiguous?: boolean;
  notes?: string;
}

export interface OutboxItem {
  eventId: string;
  signalId: string;
  type: string;
  payload: Record<string, any>;
  createdAt: string;
  status: 'PENDING_DELIVERY';
}

export interface SignalRecord {
  id: string; // e.g. SRF-20261007-001
  version: number;
  direction: 'BUY' | 'SELL';
  entryTarget: number;
  slTarget: number;
  tp1Target: number;
  tp2Target: number;
  tp3Target: number;
  tp4Target: number;
  score: number;
  timeframe: string;
  zone: {
    id: string;
    type: string;
    high: number;
    low: number;
    mid50: number;
  };
  createdAt: string; // UTC ISO
  pendingExpiresAt: string; // UTC ISO (45 min)
  reviewExpiresAt?: string; // UTC ISO (when in PENDING_REVIEW)
  activatedAt?: string;
  closedAt?: string;
  status: 'PENDING_REVIEW' | 'PENDING' | 'ACTIVE' | 'CLOSED';
  closeReason?:
    | 'TP4'
    | 'SL'
    | 'BE_STOP'
    | 'EXPIRED'
    | 'TIMEOUT'
    | 'MANUAL_CLOSE'
    | 'MARKET_CLOSE'
    | 'REVIEW_TIMEOUT'
    | 'STALE_AFTER_REVIEW'
    | 'REJECTED';
  resultClass?: ResultClass;
  highestTPReached: 'NONE' | 'TP1' | 'TP2' | 'TP3' | 'TP4';
  entryFillPrice?: number;
  entryFillTime?: string;
  exitFillPrice?: number;
  exitFillTime?: string;
  currentSL: number;
  isBreakevenActive: boolean;
  mfeDollars: number; // Max Favorable Excursion
  maeDollars: number; // Max Adverse Excursion
  realizedDollars: number;
  realizedR: number;
  durationSeconds: number;
  newsLockActive: boolean;
  events: SignalEvent[];
}

export interface SignalManagerState {
  state: ManagerState;
  previousStateBeforeHalt?: ManagerState;
  isPaused: boolean;
  cooldownEndsAt: string | null; // UTC ISO
  currentSignal: SignalRecord | null;
  history: SignalRecord[];
  todayDateStr: string;
  dailySignalsCount: number;
  consecutiveLossesToday: number;
  dailyLossLimitReached: boolean;
  lastUpdated: string;
  lastTickTimestamp: number;
}

// In-memory manager singleton state
let managerState: SignalManagerState = {
  state: 'SCANNING',
  isPaused: false,
  cooldownEndsAt: null,
  currentSignal: null,
  history: [],
  todayDateStr: new Date().toISOString().slice(0, 10),
  dailySignalsCount: 0,
  consecutiveLossesToday: 0,
  dailyLossLimitReached: false,
  lastUpdated: new Date().toISOString(),
  lastTickTimestamp: Date.now(),
};

// Global single lock to prevent concurrent signal creations
let signalCreationLock = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Append event to ./data/outbox.json atomically
export function queueOutboxEvent(
  signalId: string,
  type: string,
  payload: Record<string, any>
): OutboxItem {
  ensureDataDir();
  const eventId = `EVT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const outboxItem: OutboxItem = {
    eventId,
    signalId,
    type,
    payload,
    createdAt: new Date().toISOString(),
    status: 'PENDING_DELIVERY',
  };

  let outbox: OutboxItem[] = [];
  if (fs.existsSync(OUTBOX_FILE)) {
    try {
      const content = fs.readFileSync(OUTBOX_FILE, 'utf-8');
      outbox = JSON.parse(content);
      if (!Array.isArray(outbox)) outbox = [];
    } catch {
      outbox = [];
    }
  }

  // Prevent duplicate event IDs
  if (!outbox.some((item) => item.eventId === eventId)) {
    outbox.push(outboxItem);
    writeJsonAtomic(OUTBOX_FILE, outbox);
  }

  return outboxItem;
}

// Persist signals state and create daily backup copy
export function saveSignalsToDisk() {
  try {
    ensureDataDir();
    managerState.lastUpdated = new Date().toISOString();
    writeJsonAtomic(SIGNALS_FILE, managerState);

    // Save daily backup
    const today = managerState.todayDateStr;
    const backupFile = path.resolve(DATA_DIR, `signals_backup_${today}.json`);
    writeJsonAtomic(backupFile, managerState);
  } catch (err: any) {
    console.error('[SIGNAL MANAGER] Failed to persist signals state:', err.message);
  }
}

// Load signals from disk and recover
export function loadSignalsFromDisk() {
  ensureDataDir();
  if (fs.existsSync(SIGNALS_FILE)) {
    try {
      const content = fs.readFileSync(SIGNALS_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed) {
        managerState = {
          state: parsed.state || 'SCANNING',
          previousStateBeforeHalt: parsed.previousStateBeforeHalt,
          isPaused: !!parsed.isPaused,
          cooldownEndsAt: parsed.cooldownEndsAt || null,
          currentSignal: parsed.currentSignal || null,
          history: Array.isArray(parsed.history) ? parsed.history : [],
          todayDateStr: parsed.todayDateStr || new Date().toISOString().slice(0, 10),
          dailySignalsCount: parsed.dailySignalsCount || 0,
          consecutiveLossesToday: parsed.consecutiveLossesToday || 0,
          dailyLossLimitReached: !!parsed.dailyLossLimitReached,
          lastUpdated: parsed.lastUpdated || new Date().toISOString(),
          lastTickTimestamp: parsed.lastTickTimestamp || Date.now(),
        };

        // Check if daily counters should be reset (new UTC day)
        checkDailyReset();

        // Perform downtime candle replay & recovery
        recoverDowntimeState();

        console.log(
          `[SIGNAL MANAGER] Restored state from disk: State=${managerState.state}, ActiveSignal=${managerState.currentSignal?.id || 'none'}, HistoryCount=${managerState.history.length}`
        );
        return;
      }
    } catch (err: any) {
      console.error('[SIGNAL MANAGER] Corrupted signals.json detected:', err.message);
      const recovered = recoverCorruptedFileFromLatestBackup('signals.json');
      if (recovered) {
        return loadSignalsFromDisk();
      }
    }
  }

  // If no disk file, save initial clean state
  saveSignalsToDisk();
}

// Reset daily limit counters at 00:00 UTC
function checkDailyReset() {
  const currentUtcDate = new Date().toISOString().slice(0, 10);
  if (managerState.todayDateStr !== currentUtcDate) {
    console.log(`[SIGNAL MANAGER] UTC Day boundary crossed (${managerState.todayDateStr} -> ${currentUtcDate}). Resetting daily limits.`);
    managerState.todayDateStr = currentUtcDate;
    managerState.dailySignalsCount = 0;
    managerState.consecutiveLossesToday = 0;
    managerState.dailyLossLimitReached = false;
  }
}

// Helper to generate unique signal ID in format SRF-YYYYMMDD-001
export function generateSignalId(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;

  // Count signals created today
  const nextSeq = managerState.dailySignalsCount + 1;
  const seqStr = String(nextSeq).padStart(3, '0');
  return `SRF-${dateStr}-${seqStr}`;
}

// Enter cooldown state (30 - 45 min random or custom mins)
export function enterCooldown(durationMinutes?: number) {
  const mins = durationMinutes ?? Math.floor(30 + Math.random() * 16); // 30-45 min
  const endsAt = new Date(Date.now() + mins * 60 * 1000).toISOString();
  managerState.state = 'COOLDOWN';
  managerState.cooldownEndsAt = endsAt;
  managerState.currentSignal = null;
  saveSignalsToDisk();
  console.log(`[SIGNAL MANAGER] Entered COOLDOWN for ${mins} minutes (until ${endsAt})`);
}

// Downtime recovery on restart
function recoverDowntimeState() {
  const now = Date.now();

  // 1. Recover COOLDOWN
  if (managerState.state === 'COOLDOWN') {
    if (managerState.cooldownEndsAt && now >= new Date(managerState.cooldownEndsAt).getTime()) {
      console.log('[SIGNAL MANAGER] Cooldown expired during downtime. Transitioning to SCANNING.');
      managerState.state = managerState.isPaused ? 'PAUSED' : 'SCANNING';
      managerState.cooldownEndsAt = null;
      saveSignalsToDisk();
    }
  }

  // 2. Recover PENDING or ACTIVE signals by replaying closed candles since last save
  if (managerState.currentSignal) {
    const sig = managerState.currentSignal;

    if (sig.status === 'PENDING_REVIEW') {
      const gChatSettings = loadGoogleChatSettings();
      if (sig.reviewExpiresAt && now > new Date(sig.reviewExpiresAt).getTime()) {
        if (!gChatSettings.autoSendOnReviewTimeout) {
          closePendingReview(sig, 'REVIEW_TIMEOUT', 'Review window expired during downtime.');
          return;
        }
      }
      managerState.state = 'PENDING_REVIEW';
      return;
    }

    if (sig.status === 'PENDING') {
      // Check if 45m pending window expired
      if (now > new Date(sig.pendingExpiresAt).getTime()) {
        closePendingExpired(sig, 'Pending limit expired during downtime.');
        return;
      }
    }

    if (sig.status === 'ACTIVE') {
      // Check 8-hour timeout
      if (sig.activatedAt && now - new Date(sig.activatedAt).getTime() > 8 * 3600 * 1000) {
        closeActiveSignal(sig, 'TIMEOUT', 'TIMEOUT', sig.currentSL, 0, false, '8h max duration reached during downtime.');
        return;
      }

      // Replay closed M15/M30 candles generated during downtime
      const m15Candles = getClosedCandles('M15', true);
      const lastSaveTimeMs = new Date(managerState.lastUpdated).getTime();
      const missedCandles = m15Candles.filter((c) => new Date(c.openTime).getTime() >= lastSaveTimeMs);

      for (const candle of missedCandles) {
        if (sig.status !== 'ACTIVE') break;

        const isBull = sig.direction === 'BUY';
        const hitSL = isBull ? candle.low <= sig.currentSL : candle.high >= sig.currentSL;
        const hitTP4 = isBull ? candle.high >= sig.tp4Target : candle.low <= sig.tp4Target;
        const hitTP1 = isBull ? candle.high >= sig.tp1Target : candle.low <= sig.tp1Target;

        // Conservative SL first rule for ambiguity
        if (hitSL && (hitTP4 || hitTP1)) {
          const exitPrice = sig.currentSL;
          const isBE = sig.isBreakevenActive && Math.abs(sig.currentSL - (sig.entryFillPrice || sig.entryTarget)) < 0.1;
          closeActiveSignal(
            sig,
            isBE ? 'BE_STOP' : 'SL',
            isBE ? 'BREAKEVEN' : 'LOSS',
            exitPrice,
            0,
            true, // ambiguous flag
            'Recovered from downtime candle: Ambiguous dual breach (SL executed first).'
          );
          return;
        } else if (hitSL) {
          const isBE = sig.isBreakevenActive && Math.abs(sig.currentSL - (sig.entryFillPrice || sig.entryTarget)) < 0.1;
          closeActiveSignal(
            sig,
            isBE ? 'BE_STOP' : 'SL',
            isBE ? 'BREAKEVEN' : 'LOSS',
            sig.currentSL,
            0,
            false,
            'Recovered from downtime candle: SL breach.'
          );
          return;
        } else if (hitTP4) {
          closeActiveSignal(sig, 'TP4', 'WIN', sig.tp4Target, 0, false, 'Recovered from downtime candle: TP4 reached.');
          return;
        } else if (hitTP1 && !sig.isBreakevenActive) {
          recordEvent(sig, 'TP1', sig.tp1Target, sig.tp1Target, sig.tp1Target, 0.3, 0, false, 'Recovered from downtime candle: TP1 hit.');
          sig.highestTPReached = 'TP1';
          sig.currentSL = sig.entryFillPrice || sig.entryTarget;
          sig.isBreakevenActive = true;
        }
      }
    }
  }
}

// Record an event inside a signal and queue it into the Outbox
function recordEvent(
  signal: SignalRecord,
  type: SignalEvent['type'],
  price: number,
  bid: number,
  ask: number,
  spread: number,
  slippageDollars: number,
  ambiguous: boolean = false,
  notes?: string
): SignalEvent {
  const event: SignalEvent = {
    id: `EVT-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    signalId: signal.id,
    type,
    timestamp: new Date().toISOString(),
    price: Number(price.toFixed(2)),
    bid: Number(bid.toFixed(2)),
    ask: Number(ask.toFixed(2)),
    spread: Number(spread.toFixed(2)),
    slippageDollars: Number(slippageDollars.toFixed(2)),
    ambiguous: ambiguous || undefined,
    notes,
  };

  signal.events.push(event);

  // Queue to append-only outbox for Phase 4 Telegram delivery
  queueOutboxEvent(signal.id, type, {
    signalId: signal.id,
    direction: signal.direction,
    eventPrice: event.price,
    bid,
    ask,
    spread,
    slippageDollars,
    ambiguous,
    notes,
  });

  return event;
}

// Close a setup pending Google Chat review (timeout, stale revalidation, or rejection)
// NOTE: Does NOT count toward the 3 signals per day.
export function closePendingReview(
  signal: SignalRecord,
  reason: 'REVIEW_TIMEOUT' | 'STALE_AFTER_REVIEW' | 'REJECTED',
  notes: string
) {
  signal.status = 'CLOSED';
  signal.closeReason = reason;
  signal.resultClass = reason;
  signal.closedAt = new Date().toISOString();
  signal.durationSeconds = Math.round(
    (new Date(signal.closedAt).getTime() - new Date(signal.createdAt).getTime()) / 1000
  );

  recordEvent(signal, reason, signal.entryTarget, signal.entryTarget, signal.entryTarget, 0.3, 0, false, notes);
  updateSetupReviewStatus(signal.id, reason, 'SYSTEM', notes);

  managerState.history.unshift({ ...signal });
  managerState.currentSignal = null;

  // Release lock and enter 5-minute cooldown before resuming SCANNING
  enterCooldown(5);
  saveSignalsToDisk();
}

// Transition approved signal to PENDING and queue Telegram dispatch
export function activateApprovedSignal(sig: SignalRecord, approvedBy: string) {
  sig.status = 'PENDING';
  managerState.state = 'PENDING';
  managerState.dailySignalsCount += 1; // Counts toward daily limit only once approved/active

  queueOutboxEvent(sig.id, 'SIGNAL_CREATED', {
    signalId: sig.id,
    direction: sig.direction,
    entryTarget: sig.entryTarget,
    slTarget: sig.slTarget,
    tp1Target: sig.tp1Target,
    tp2Target: sig.tp2Target,
    tp3Target: sig.tp3Target,
    tp4Target: sig.tp4Target,
    score: sig.score,
    pendingExpiresAt: sig.pendingExpiresAt,
    approvedBy,
  });

  saveSignalsToDisk();
  console.log(`[SIGNAL MANAGER] Signal ${sig.id} APPROVED by ${approvedBy} -> Transitioned to PENDING (Limit active)`);
}

// Human or automated review approval with strict safety revalidation
export function approveSignalFromReview(
  signalId: string,
  reviewerEmail: string,
  livePrice: number,
  feedStatus: 'LIVE' | 'STALE' | 'OFFLINE',
  newsLockActive: boolean
): { success: boolean; error?: string; signal?: SignalRecord } {
  if (managerState.state !== 'PENDING_REVIEW' || !managerState.currentSignal) {
    return { success: false, error: 'No signal currently pending review in SARRAF engine.' };
  }
  const sig = managerState.currentSignal;
  if (sig.id !== signalId) {
    return { success: false, error: `Signal ID mismatch (currently pending: ${sig.id}, received: ${signalId}).` };
  }

  // Check zone invalidation by recent closed candles
  const m30Closed = getClosedCandles('M30');
  let zoneBroken = false;
  if (m30Closed.length > 0) {
    const lastClosed = m30Closed[m30Closed.length - 1];
    zoneBroken =
      sig.direction === 'BUY'
        ? lastClosed.close < sig.zone.low
        : lastClosed.close > sig.zone.high;
  }

  const reval = revalidateSetupForApproval(
    {
      id: `REV-${sig.id}`,
      signalId: sig.id,
      direction: sig.direction,
      entry: sig.entryTarget,
      sl: sig.slTarget,
      tp1: sig.tp1Target,
      tp2: sig.tp2Target,
      tp3: sig.tp3Target,
      tp4: sig.tp4Target,
      score: sig.score,
      status: 'PENDING_REVIEW',
      createdAt: sig.createdAt,
      reviewExpiresAt: sig.reviewExpiresAt || new Date().toISOString(),
      bias: { d1: 'NEUTRAL', h4: 'NEUTRAL', h1: 'NEUTRAL' },
      zone: sig.zone,
    },
    livePrice,
    feedStatus,
    newsLockActive,
    zoneBroken
  );

  if (!reval.ok) {
    console.warn(`[SIGNAL MANAGER] Setup ${sig.id} approved by ${reviewerEmail} but re-validation FAILED: ${reval.reason}`);
    closePendingReview(sig, 'STALE_AFTER_REVIEW', `Re-validation failed upon approval: ${reval.reason}`);
    updateSetupReviewStatus(sig.id, 'STALE_AFTER_REVIEW', reviewerEmail, reval.reason, reval);
    return { success: false, error: `Signal cancelled as STALE_AFTER_REVIEW: ${reval.reason}` };
  }

  // Levels are IMMUTABLE: Keep exact same entry, SL, and TPs
  activateApprovedSignal(sig, reviewerEmail);
  updateSetupReviewStatus(sig.id, 'APPROVED', reviewerEmail, 'Setup approved and validated.');
  return { success: true, signal: sig };
}

// Review rejection
export function rejectSignalFromReview(
  signalId: string,
  reviewerEmail: string,
  notes?: string
): { success: boolean; error?: string } {
  if (managerState.state !== 'PENDING_REVIEW' || !managerState.currentSignal) {
    return { success: false, error: 'No signal currently pending review in SARRAF engine.' };
  }
  const sig = managerState.currentSignal;
  if (sig.id !== signalId) {
    return { success: false, error: `Signal ID mismatch (currently pending: ${sig.id}, received: ${signalId}).` };
  }

  closePendingReview(sig, 'REJECTED', notes || `Rejected by reviewer ${reviewerEmail}`);
  updateSetupReviewStatus(sig.id, 'REJECTED', reviewerEmail, notes);
  return { success: true };
}

// Close a pending signal as expired (e.g. 45m limit or zone invalidation)
export function closePendingExpired(signal: SignalRecord, reasonNotes: string) {
  signal.status = 'CLOSED';
  signal.closeReason = 'EXPIRED';
  signal.resultClass = 'EXPIRED';
  signal.closedAt = new Date().toISOString();
  signal.durationSeconds = Math.round((new Date(signal.closedAt).getTime() - new Date(signal.createdAt).getTime()) / 1000);

  recordEvent(signal, 'EXPIRED', signal.entryTarget, signal.entryTarget, signal.entryTarget, 0.3, 0, false, reasonNotes);

  managerState.history.unshift({ ...signal });
  managerState.currentSignal = null;

  // 5 minute short pause on pending expiry (no long 30-45m cooldown)
  enterCooldown(5);
}

// Close active signal with detailed metrics
export function closeActiveSignal(
  signal: SignalRecord,
  reason: SignalRecord['closeReason'],
  resultClass: ResultClass,
  exitPrice: number,
  slippageDollars: number = 0,
  ambiguous: boolean = false,
  notes?: string
) {
  signal.status = 'CLOSED';
  signal.closeReason = reason;
  signal.resultClass = resultClass;
  signal.exitFillPrice = Number(exitPrice.toFixed(2));
  signal.exitFillTime = new Date().toISOString();
  signal.closedAt = signal.exitFillTime;

  const entry = signal.entryFillPrice || signal.entryTarget;
  const isBull = signal.direction === 'BUY';
  const diff = isBull ? exitPrice - entry : entry - exitPrice;

  signal.realizedDollars = Number(diff.toFixed(2));
  // Risk is $10.00: 1R = $10
  signal.realizedR = Number((diff / 10.0).toFixed(2));

  if (signal.activatedAt) {
    signal.durationSeconds = Math.round((new Date(signal.closedAt).getTime() - new Date(signal.activatedAt).getTime()) / 1000);
  }

  const eventType: SignalEvent['type'] =
    reason === 'TP4'
      ? 'TP4'
      : reason === 'BE_STOP'
      ? 'BE_STOP'
      : reason === 'SL'
      ? 'SL'
      : reason === 'TIMEOUT'
      ? 'TIMEOUT'
      : reason === 'MANUAL_CLOSE'
      ? 'MANUAL_CLOSE'
      : reason === 'MARKET_CLOSE'
      ? 'MARKET_CLOSE'
      : 'SL';

  recordEvent(
    signal,
    eventType,
    exitPrice,
    exitPrice,
    exitPrice,
    0.3,
    slippageDollars,
    ambiguous,
    notes || `Closed via ${reason} (${resultClass})`
  );

  // Push to persistent history
  managerState.history.unshift({ ...signal });
  managerState.currentSignal = null;

  // Enter random 30-45 min cooldown after trade closes (Losses do NOT stop trading; standard cooldown runs then next setup executes automatically)
  enterCooldown();
}

// Master tick processing function called every second on real biquote.io tick
export function processSignalManagerTick(
  livePrice: number,
  bid: number,
  ask: number,
  spread: number,
  feedStatus: 'LIVE' | 'STALE' | 'OFFLINE',
  newsLockActive: boolean = false
) {
  checkDailyReset();

  managerState.lastTickTimestamp = Date.now();

  // 1. FEED SAFETY (Section 6)
  if (feedStatus === 'OFFLINE' || feedStatus === 'STALE') {
    if (managerState.state !== 'HALTED_FEED') {
      managerState.previousStateBeforeHalt = managerState.state;
      managerState.state = 'HALTED_FEED';
      saveSignalsToDisk();
      console.warn(`[SIGNAL MANAGER] Feed ${feedStatus}. State HALTED_FEED active. Freezing tracking.`);
    }
    return;
  }

  // Feed is LIVE -> If previously halted, resume cleanly
  if (managerState.state === 'HALTED_FEED') {
    console.log('[SIGNAL MANAGER] Fresh tick received. Feed recovered from halt.');
    managerState.state = managerState.previousStateBeforeHalt || 'SCANNING';
    managerState.previousStateBeforeHalt = undefined;
    recoverDowntimeState();
  }

  // If manually paused, maintain PAUSED state
  if (managerState.isPaused) {
    managerState.state = 'PAUSED';
    return;
  }

  // 2. COOLDOWN STATE
  if (managerState.state === 'COOLDOWN') {
    if (managerState.cooldownEndsAt && Date.now() >= new Date(managerState.cooldownEndsAt).getTime()) {
      console.log('[SIGNAL MANAGER] Cooldown finished. Resuming SCANNING.');
      managerState.state = 'SCANNING';
      managerState.cooldownEndsAt = null;
      saveSignalsToDisk();
    } else {
      return;
    }
  }

  // 3. SCANNING STATE: Look for new setup if no pending/active signal exists
  if (managerState.state === 'SCANNING') {
    const maxSignals = getCurrentSettings().maxSignalsPerDay ?? 3;
    if (managerState.dailySignalsCount >= maxSignals) {
      return;
    }

    if (signalCreationLock) return;

    try {
      signalCreationLock = true;

      // Run analysis engine
      const analysis = runSarrafAnalysis(livePrice, spread);

      if (
        analysis.latestScanDecision.action === 'SIGNAL_GENERATED' &&
        analysis.latestScanDecision.details
      ) {
        const setup: SignalPlan = analysis.latestScanDecision.details;

        const signalId = generateSignalId();
        const nowIso = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 45 * 60 * 1000).toISOString();

        const gChatSettings = loadGoogleChatSettings();

        if (gChatSettings.preReviewRequired) {
          const timeoutMins = gChatSettings.reviewTimeoutMinutes || 3;
          const reviewExpiresAt = new Date(Date.now() + timeoutMins * 60 * 1000).toISOString();

          const newRecord: SignalRecord = {
            id: signalId,
            version: 1,
            direction: setup.direction,
            entryTarget: setup.entry,
            slTarget: setup.sl,
            tp1Target: setup.tp1,
            tp2Target: setup.tp2,
            tp3Target: setup.tp3,
            tp4Target: setup.tp4,
            score: setup.score,
            timeframe: setup.timeframe,
            zone: {
              id: setup.zone.id,
              type: setup.zone.type,
              high: setup.zone.high,
              low: setup.zone.low,
              mid50: setup.zone.mid50,
            },
            createdAt: nowIso,
            pendingExpiresAt: expiresAt,
            reviewExpiresAt,
            status: 'PENDING_REVIEW',
            highestTPReached: 'NONE',
            currentSL: setup.sl,
            isBreakevenActive: false,
            mfeDollars: 0,
            maeDollars: 0,
            realizedDollars: 0,
            realizedR: 0,
            durationSeconds: 0,
            newsLockActive: false,
            events: [],
          };

          managerState.currentSignal = newRecord;
          managerState.state = 'PENDING_REVIEW';
          // NOTE: Do not increment dailySignalsCount yet. Only approved setups count.

          recordSetupForReview({
            signalId: newRecord.id,
            direction: newRecord.direction,
            entry: newRecord.entryTarget,
            sl: newRecord.slTarget,
            tp1: newRecord.tp1Target,
            tp2: newRecord.tp2Target,
            tp3: newRecord.tp3Target,
            tp4: newRecord.tp4Target,
            score: newRecord.score,
            bias: {
              d1: (setup as any).bias?.d1 || 'BULLISH',
              h4: (setup as any).bias?.h4 || 'BULLISH',
              h1: (setup as any).bias?.h1 || 'BULLISH',
            },
            zone: newRecord.zone,
            timeoutMinutes: timeoutMins,
          });

          saveSignalsToDisk();
          console.log(`[SIGNAL MANAGER] Setup ${signalId} entered PENDING_REVIEW (holds lock, expires in ${timeoutMins}m).`);
        } else {
          const newRecord: SignalRecord = {
            id: signalId,
            version: 1,
            direction: setup.direction,
            entryTarget: setup.entry,
            slTarget: setup.sl,
            tp1Target: setup.tp1,
            tp2Target: setup.tp2,
            tp3Target: setup.tp3,
            tp4Target: setup.tp4,
            score: setup.score,
            timeframe: setup.timeframe,
            zone: {
              id: setup.zone.id,
              type: setup.zone.type,
              high: setup.zone.high,
              low: setup.zone.low,
              mid50: setup.zone.mid50,
            },
            createdAt: nowIso,
            pendingExpiresAt: expiresAt,
            status: 'PENDING',
            highestTPReached: 'NONE',
            currentSL: setup.sl,
            isBreakevenActive: false,
            mfeDollars: 0,
            maeDollars: 0,
            realizedDollars: 0,
            realizedR: 0,
            durationSeconds: 0,
            newsLockActive: false,
            events: [],
          };

          managerState.currentSignal = newRecord;
          managerState.state = 'PENDING';
          managerState.dailySignalsCount += 1;

          queueOutboxEvent(newRecord.id, 'SIGNAL_CREATED', {
            signalId: newRecord.id,
            direction: newRecord.direction,
            entryTarget: newRecord.entryTarget,
            slTarget: newRecord.slTarget,
            tp1Target: newRecord.tp1Target,
            tp2Target: newRecord.tp2Target,
            tp3Target: newRecord.tp3Target,
            tp4Target: newRecord.tp4Target,
            score: newRecord.score,
            pendingExpiresAt: newRecord.pendingExpiresAt,
          });

          saveSignalsToDisk();
          console.log(`[SIGNAL MANAGER] Generated new signal ${signalId} (${newRecord.direction} @ ${newRecord.entryTarget})`);
        }
      }
    } finally {
      signalCreationLock = false;
    }

    return;
  }

  // 3.5 PENDING_REVIEW STATE: Wait for Google Chat human review or timeout
  if (managerState.state === 'PENDING_REVIEW' && managerState.currentSignal) {
    const sig = managerState.currentSignal;
    const now = Date.now();
    const gChatSettings = loadGoogleChatSettings();

    // Check zone invalidation by recent closed candles
    const m30Closed = getClosedCandles('M30');
    let zoneBroken = false;
    if (m30Closed.length > 0) {
      const lastClosed = m30Closed[m30Closed.length - 1];
      zoneBroken =
        sig.direction === 'BUY'
          ? lastClosed.close < sig.zone.low
          : lastClosed.close > sig.zone.high;
    }

    if (zoneBroken) {
      console.warn(`[SIGNAL MANAGER] Zone invalidated during PENDING_REVIEW for ${sig.id}. Cancelling.`);
      closePendingReview(sig, 'STALE_AFTER_REVIEW', 'M30 zone breached during review window.');
      return;
    }

    // Check review timeout
    if (sig.reviewExpiresAt && now > new Date(sig.reviewExpiresAt).getTime()) {
      if (gChatSettings.autoSendOnReviewTimeout) {
        const reval = revalidateSetupForApproval(
          {
            id: `REV-${sig.id}`,
            signalId: sig.id,
            direction: sig.direction,
            entry: sig.entryTarget,
            sl: sig.slTarget,
            tp1: sig.tp1Target,
            tp2: sig.tp2Target,
            tp3: sig.tp3Target,
            tp4: sig.tp4Target,
            score: sig.score,
            status: 'PENDING_REVIEW',
            createdAt: sig.createdAt,
            reviewExpiresAt: sig.reviewExpiresAt,
            bias: { d1: 'NEUTRAL', h4: 'NEUTRAL', h1: 'NEUTRAL' },
            zone: sig.zone,
          },
          livePrice,
          feedStatus,
          newsLockActive,
          zoneBroken
        );
        if (reval.ok) {
          console.log(`[SIGNAL MANAGER] Review timed out with auto-send ON. Revalidation passed. Activating ${sig.id}.`);
          activateApprovedSignal(sig, 'AUTO_SEND_ON_TIMEOUT');
          return;
        } else {
          console.warn(`[SIGNAL MANAGER] Auto-send on timeout failed revalidation: ${reval.reason}`);
          closePendingReview(sig, 'STALE_AFTER_REVIEW', `Auto-send timeout cancelled: ${reval.reason}`);
          return;
        }
      } else {
        console.log(`[SIGNAL MANAGER] Review timed out for ${sig.id}. Cancelling as REVIEW_TIMEOUT.`);
        closePendingReview(sig, 'REVIEW_TIMEOUT', `Review timed out after ${gChatSettings.reviewTimeoutMinutes}m without approval.`);
        return;
      }
    }

    return;
  }

  // 4. PENDING STATE: Wait for live limit touch
  if (managerState.state === 'PENDING' && managerState.currentSignal) {
    const sig = managerState.currentSignal;

    // Check 45 minute expiry
    if (Date.now() > new Date(sig.pendingExpiresAt).getTime()) {
      closePendingExpired(sig, 'Limit entry expired (45 minutes without fill).');
      return;
    }

    // Check zone invalidation by recent closed candles
    const m30Closed = getClosedCandles('M30');
    if (m30Closed.length > 0) {
      const lastClosed = m30Closed[m30Closed.length - 1];
      const invalidated =
        sig.direction === 'BUY'
          ? lastClosed.close < sig.zone.low
          : lastClosed.close > sig.zone.high;

      if (invalidated) {
        closePendingExpired(sig, `Zone invalidated by closed M30 candle (${lastClosed.close}).`);
        return;
      }
    }

    // Check entry touch: BUY uses ASK touch, SELL uses BID touch
    const isBull = sig.direction === 'BUY';
    const entryFilled = isBull ? ask <= sig.entryTarget : bid >= sig.entryTarget;

    if (entryFilled) {
      const actualFill = isBull ? ask : bid;
      const slippage = isBull ? Math.max(0, ask - sig.entryTarget) : Math.max(0, sig.entryTarget - bid);

      sig.status = 'ACTIVE';
      sig.activatedAt = new Date().toISOString();
      sig.entryFillPrice = Number(actualFill.toFixed(2));
      sig.entryFillTime = sig.activatedAt;

      managerState.state = 'ACTIVE';

      recordEvent(
        sig,
        'ENTRY_HIT',
        actualFill,
        bid,
        ask,
        spread,
        slippage,
        false,
        `Limit filled at ${actualFill} (Slippage: $${slippage.toFixed(2)})`
      );

      saveSignalsToDisk();
      console.log(`[SIGNAL MANAGER] Signal ${sig.id} FILLED at ${actualFill} -> State ACTIVE`);
    }

    return;
  }

  // 5. ACTIVE STATE: High-precision tick tracking every second
  if (managerState.state === 'ACTIVE' && managerState.currentSignal) {
    const sig = managerState.currentSignal;
    sig.newsLockActive = newsLockActive;

    const isBull = sig.direction === 'BUY';
    const entry = sig.entryFillPrice || sig.entryTarget;

    // MFE / MAE Excursions tracking
    const curFavorable = isBull ? bid - entry : entry - ask;
    const curAdverse = isBull ? entry - ask : bid - entry;

    if (curFavorable > sig.mfeDollars) sig.mfeDollars = Number(curFavorable.toFixed(2));
    if (curAdverse > sig.maeDollars) sig.maeDollars = Number(curAdverse.toFixed(2));

    // Check 8-Hour Maximum Open Timeout
    if (sig.activatedAt && Date.now() - new Date(sig.activatedAt).getTime() > 8 * 3600 * 1000) {
      const exitPrice = isBull ? bid : ask;
      closeActiveSignal(sig, 'TIMEOUT', 'TIMEOUT', exitPrice, 0, false, '8-Hour maximum duration timeout reached.');
      return;
    }

    // BUY exits use BID; SELL exits use ASK
    const exitPriceToEvaluate = isBull ? bid : ask;

    // Evaluate Stop Loss Breach
    const slBreached = isBull ? bid <= sig.currentSL : ask >= sig.currentSL;

    // Evaluate Take Profit Levels
    const tp1Breached = isBull ? bid >= sig.tp1Target : ask <= sig.tp1Target;
    const tp2Breached = isBull ? bid >= sig.tp2Target : ask <= sig.tp2Target;
    const tp3Breached = isBull ? bid >= sig.tp3Target : ask <= sig.tp3Target;
    const tp4Breached = isBull ? bid >= sig.tp4Target : ask <= sig.tp4Target;

    // Conservative check: if SL and any TP are both breached in the exact same tick
    if (slBreached && (tp1Breached || tp4Breached)) {
      const slippage = isBull ? Math.max(0, sig.currentSL - bid) : Math.max(0, ask - sig.currentSL);
      const isBE = sig.isBreakevenActive && Math.abs(sig.currentSL - entry) < 0.1;
      closeActiveSignal(
        sig,
        isBE ? 'BE_STOP' : 'SL',
        isBE ? 'BREAKEVEN' : 'LOSS',
        exitPriceToEvaluate,
        slippage,
        true,
        'Dual level breach in single tick. Conservative SL-first rule applied.'
      );
      return;
    }

    // Handle Stop Loss / Breakeven Hit
    if (slBreached) {
      const slippage = isBull ? Math.max(0, sig.currentSL - bid) : Math.max(0, ask - sig.currentSL);
      const isBE = sig.isBreakevenActive && Math.abs(sig.currentSL - entry) < 0.1;

      closeActiveSignal(
        sig,
        isBE ? 'BE_STOP' : 'SL',
        isBE ? 'BREAKEVEN' : 'LOSS',
        exitPriceToEvaluate,
        slippage,
        false,
        isBE
          ? `Breakeven stop hit at ${exitPriceToEvaluate} (Slippage: $${slippage.toFixed(2)})`
          : `Stop loss hit at ${exitPriceToEvaluate} (Slippage: $${slippage.toFixed(2)})`
      );
      return;
    }

    // Handle TP4 Hit -> Trade Completes (Closed WIN)
    if (tp4Breached) {
      const slippage = isBull ? Math.max(0, bid - sig.tp4Target) : Math.max(0, sig.tp4Target - ask);
      sig.highestTPReached = 'TP4';
      closeActiveSignal(sig, 'TP4', 'WIN', exitPriceToEvaluate, slippage, false, `TP4 hit at ${exitPriceToEvaluate}`);
      return;
    }

    // Handle TP3 Hit
    if (tp3Breached && sig.highestTPReached !== 'TP3' && sig.highestTPReached !== 'TP4') {
      const slippage = isBull ? Math.max(0, bid - sig.tp3Target) : Math.max(0, sig.tp3Target - ask);
      sig.highestTPReached = 'TP3';
      recordEvent(sig, 'TP3', exitPriceToEvaluate, bid, ask, spread, slippage, false, `TP3 reached at ${exitPriceToEvaluate}`);
      saveSignalsToDisk();
    }

    // Handle TP2 Hit
    if (tp2Breached && sig.highestTPReached === 'TP1') {
      const slippage = isBull ? Math.max(0, bid - sig.tp2Target) : Math.max(0, sig.tp2Target - ask);
      sig.highestTPReached = 'TP2';
      recordEvent(sig, 'TP2', exitPriceToEvaluate, bid, ask, spread, slippage, false, `TP2 reached at ${exitPriceToEvaluate}`);
      saveSignalsToDisk();
    }

    // Handle TP1 Hit -> Move SL to Breakeven
    if (tp1Breached && sig.highestTPReached === 'NONE') {
      const slippage = isBull ? Math.max(0, bid - sig.tp1Target) : Math.max(0, sig.tp1Target - ask);
      sig.highestTPReached = 'TP1';
      sig.currentSL = entry; // Move SL to Breakeven
      sig.isBreakevenActive = true;

      recordEvent(
        sig,
        'TP1',
        exitPriceToEvaluate,
        bid,
        ask,
        spread,
        slippage,
        false,
        `TP1 reached at ${exitPriceToEvaluate}. Stop Loss shifted to BREAKEVEN ($${entry.toFixed(2)}).`
      );

      saveSignalsToDisk();
      console.log(`[SIGNAL MANAGER] Signal ${sig.id} reached TP1 -> SL moved to Breakeven (${entry})`);
    }
  }
}

// Admin Operations
export function pauseSignalManager(): { success: boolean; state: ManagerState } {
  managerState.isPaused = true;
  managerState.state = 'PAUSED';
  saveSignalsToDisk();
  console.log('[SIGNAL MANAGER] Admin PAUSED signal manager.');
  return { success: true, state: managerState.state };
}

export function resumeSignalManager(): { success: boolean; state: ManagerState } {
  managerState.isPaused = false;
  if (managerState.currentSignal) {
    managerState.state = managerState.currentSignal.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING';
  } else if (managerState.cooldownEndsAt && Date.now() < new Date(managerState.cooldownEndsAt).getTime()) {
    managerState.state = 'COOLDOWN';
  } else {
    managerState.state = 'SCANNING';
  }
  saveSignalsToDisk();
  console.log(`[SIGNAL MANAGER] Admin RESUMED signal manager -> State ${managerState.state}`);
  return { success: true, state: managerState.state };
}

export function manualCloseActiveSignal(adminEmail: string, currentLivePrice: number): { success: boolean; message: string } {
  if (!managerState.currentSignal) {
    return { success: false, message: 'No active or pending signal to close.' };
  }

  const sig = managerState.currentSignal;
  if (sig.status === 'PENDING') {
    closePendingExpired(sig, `Manual cancel by admin (${adminEmail})`);
    return { success: true, message: `Pending signal ${sig.id} cancelled.` };
  }

  if (sig.status === 'ACTIVE') {
    const exitPrice = currentLivePrice || sig.entryFillPrice || sig.entryTarget;
    const isBull = sig.direction === 'BUY';
    const entry = sig.entryFillPrice || sig.entryTarget;
    const diff = isBull ? exitPrice - entry : entry - exitPrice;
    const resultClass: ResultClass = diff > 0 ? 'WIN' : diff === 0 ? 'BREAKEVEN' : 'LOSS';

    closeActiveSignal(sig, 'MANUAL_CLOSE', resultClass, exitPrice, 0, false, `Manual close at market price by admin (${adminEmail})`);
    return { success: true, message: `Active signal ${sig.id} manually closed at $${exitPrice.toFixed(2)}.` };
  }

  return { success: false, message: 'Signal is already closed.' };
}

export function skipCooldown(adminEmail: string): { success: boolean; message: string } {
  if (managerState.state !== 'COOLDOWN' && !managerState.cooldownEndsAt) {
    return { success: false, message: 'Manager is not in cooldown.' };
  }

  managerState.cooldownEndsAt = null;
  managerState.state = managerState.isPaused ? 'PAUSED' : 'SCANNING';
  saveSignalsToDisk();
  console.log(`[SIGNAL MANAGER] Admin (${adminEmail}) SKIPPED COOLDOWN -> State ${managerState.state}`);
  return { success: true, message: 'Cooldown skipped successfully.' };
}

export function getSignalStats() {
  const history = managerState.history;
  const total = history.length;
  const wins = history.filter((s) => s.resultClass === 'WIN').length;
  const losses = history.filter((s) => s.resultClass === 'LOSS').length;
  const breakevens = history.filter((s) => s.resultClass === 'BREAKEVEN').length;
  const expired = history.filter((s) => s.resultClass === 'EXPIRED').length;
  const timeouts = history.filter((s) => s.resultClass === 'TIMEOUT').length;
  const marketClosed = history.filter((s) => s.resultClass === 'MARKET_CLOSE').length;

  const completed = history.filter((s) => s.resultClass === 'WIN' || s.resultClass === 'LOSS' || s.resultClass === 'BREAKEVEN');
  const winRate = completed.length > 0 ? Number(((wins / completed.length) * 100).toFixed(1)) : 0;
  const totalR = Number(history.reduce((sum, s) => sum + s.realizedR, 0).toFixed(2));
  const totalDollars = Number(history.reduce((sum, s) => sum + s.realizedDollars, 0).toFixed(2));

  const durations = completed.map((s) => s.durationSeconds).filter((d) => d > 0);
  const avgDurationSec = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  // Best & worst days by R
  const daysMap = new Map<string, number>();
  for (const s of history) {
    const day = s.createdAt.slice(0, 10);
    daysMap.set(day, (daysMap.get(day) || 0) + s.realizedR);
  }

  let bestDay = { date: 'N/A', r: 0 };
  let worstDay = { date: 'N/A', r: 0 };

  for (const [date, r] of daysMap.entries()) {
    if (bestDay.date === 'N/A' || r > bestDay.r) bestDay = { date, r: Number(r.toFixed(2)) };
    if (worstDay.date === 'N/A' || r < worstDay.r) worstDay = { date, r: Number(r.toFixed(2)) };
  }

  return {
    total,
    wins,
    losses,
    breakevens,
    expired,
    timeouts,
    marketClosed,
    winRatePercent: winRate,
    totalR,
    totalDollars,
    averageDurationSeconds: avgDurationSec,
    averageDurationFormatted: `${Math.floor(avgDurationSec / 60)}m ${avgDurationSec % 60}s`,
    bestDay,
    worstDay,
    consecutiveLossesToday: managerState.consecutiveLossesToday,
    dailyLossLimitReached: managerState.dailyLossLimitReached,
  };
}

export function getSignalManagerPublicState(livePrice: number | null) {
  const current = managerState.currentSignal;

  let livePnLDollars = 0;
  let livePnLR = 0;
  let timeOpenSeconds = 0;
  let nextTarget = 0;
  let targetProgressPercent = 0;

  if (current && current.status === 'ACTIVE' && livePrice !== null) {
    const isBull = current.direction === 'BUY';
    const entry = current.entryFillPrice || current.entryTarget;
    livePnLDollars = isBull ? Number((livePrice - entry).toFixed(2)) : Number((entry - livePrice).toFixed(2));
    livePnLR = Number((livePnLDollars / 10.0).toFixed(2));

    if (current.activatedAt) {
      timeOpenSeconds = Math.round((Date.now() - new Date(current.activatedAt).getTime()) / 1000);
    }

    // Determine next target for progress bar
    if (current.highestTPReached === 'NONE') nextTarget = current.tp1Target;
    else if (current.highestTPReached === 'TP1') nextTarget = current.tp2Target;
    else if (current.highestTPReached === 'TP2') nextTarget = current.tp3Target;
    else if (current.highestTPReached === 'TP3') nextTarget = current.tp4Target;
    else nextTarget = current.tp4Target;

    const totalDist = Math.abs(nextTarget - entry) || 1;
    const curDist = Math.abs(livePrice - entry);
    targetProgressPercent = Math.min(100, Math.max(0, Math.round((curDist / totalDist) * 100)));
  }

  let cooldownRemainingSeconds = 0;
  if (managerState.state === 'COOLDOWN' && managerState.cooldownEndsAt) {
    cooldownRemainingSeconds = Math.max(0, Math.round((new Date(managerState.cooldownEndsAt).getTime() - Date.now()) / 1000));
  }

  return {
    state: managerState.state,
    isPaused: managerState.isPaused,
    todaySignalsCount: managerState.dailySignalsCount,
    maxDailySignals: getCurrentSettings().maxSignalsPerDay ?? 3,
    dailyLossLimitReached: false,
    cooldownEndsAt: managerState.cooldownEndsAt,
    cooldownRemainingSeconds,
    activeSignal: current
      ? {
          id: current.id,
          direction: current.direction,
          status: current.status,
          entry: current.entryFillPrice || current.entryTarget,
          sl: current.currentSL,
          initialSL: current.slTarget,
          tp1: current.tp1Target,
          tp2: current.tp2Target,
          tp3: current.tp3Target,
          tp4: current.tp4Target,
          score: current.score,
          highestTP: current.highestTPReached,
          isBreakeven: current.isBreakevenActive,
          createdAt: current.createdAt,
          activatedAt: current.activatedAt,
          pendingExpiresAt: current.pendingExpiresAt,
          newsLockActive: current.newsLockActive,
          livePnLDollars,
          livePnLR,
          timeOpenSeconds,
          nextTarget,
          targetProgressPercent,
          mfeDollars: current.mfeDollars,
          maeDollars: current.maeDollars,
          events: current.events,
        }
      : null,
  };
}

export function getSignalHistory() {
  return managerState.history;
}

export function getFullManagerState() {
  return managerState;
}
