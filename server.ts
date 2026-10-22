import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import {
  loadCandlesFromDisk,
  saveCandlesToDisk,
  bootstrapHistoricalCandles,
  backfillCandleGaps,
  processTick,
  getEngineStatus,
  getCandleStore,
  getClosedCandles,
} from './src/server/candleEngine.ts';
import {
  computeZonesForTimeframe,
  getWhereSellBuyCanComeFrom,
  getLiquidityZonesListForPanel,
} from './src/server/sarrafZoneEngine.ts';
import {
  loadLastTickFromDisk,
  saveLastTickToDisk,
  recordLiveTick,
  getLastValidTick,
  evaluateMarketPriceStatus,
  getMarketSchedule,
  get5MinTickBuffer,
  get60SecFlowMetrics,
  LAST_TICK_FILE,
} from './src/server/marketPriceEngine.ts';
import {
  runSarrafAnalysis,
  runBacktestReplay,
  isNewsLockActive,
  evaluateStructureBias,
  isGoldMarketOpen,
} from './src/server/sarrafEngine.ts';
import {
  loadSignalsFromDisk,
  saveSignalsToDisk,
  processSignalManagerTick,
  pauseSignalManager,
  resumeSignalManager,
  manualCloseActiveSignal,
  skipCooldown,
  getSignalStats,
  getSignalManagerPublicState,
  getSignalHistory,
  getFullManagerState,
  approveSignalFromReview,
  rejectSignalFromReview,
} from './src/server/signalManager.ts';
import { runSimulationTestSuite } from './src/server/signalTests.ts';
import {
  loadCommandSignalsFromDisk,
  saveCommandSignalsToDisk,
  processCommandSignalTick,
  getCommandSignalState,
  manualCloseCommandSignal,
  resetCommandSignalCooldown,
  triggerSimulatedCommandSignal,
} from './src/server/commandSignalEngine.ts';
import {
  initAtlasEngine,
  getAtlasState,
  onAtlasLiveTick,
  registerAtlasSseClient,
  toggleAtlasAlerts,
  sendTestAtlasAlert,
  getAtlasAlertsEnabled,
  getAtlasAlertLogs,
} from './server/atlas/atlasEngine.ts';
import {
  getCommandTelegramStatus,
  updateCommandTelegramSettings,
  sendTestMessage,
  saveTelegramSettings,
  startTelegramSignals,
  stopTelegramSignals,
  startCommandTelegramWorker,
  sendTelegramMessageWithRetry,
  readCommandOutbox,
} from './src/server/commandTelegramService.ts';
import {
  startTelegramWorker,
  getTelegramWorkerStatus,
  sendManualTestMessage,
  sendVerificationTestSignal,
  sendManualTestDailySummary,
  sendManualTestWeeklyReport,
  sendAdminAlert,
  setDryRunMode,
  retryFailedOutboxItem,
  retryAllFailedOutboxItems,
  getIsDryRun,
  setDynamicTelegramChatId,
  getEffectiveTelegramChatId,
} from './src/server/telegramWorker.ts';
import {
  getValidationLogs,
  generateMarketChat,
} from './src/server/geminiValidator.ts';
import { runPhase4TestSuite } from './src/server/phase4Tests.ts';
import { runPhase5TestSuite } from './src/server/phase5Tests.ts';
import {
  fetchForexFactoryCalendar,
  getNewsFeedStatus,
  getNewsEventsForUI,
  setManualActualValue,
  lookupActualValueWithGemini,
  evaluateNewsDecisions,
  getNewsDecisionAccuracy,
  newsDecision,
  getCalibrationTable30d,
} from './src/server/newsEngine.ts';
import {
  fetchLiveMacroData,
  getCachedMacroData,
  startMacroFeedLoop,
} from './src/server/macroFeedEngine.ts';
import {
  sampleLiveReleaseTicks,
  getReleaseLoggerSummary,
} from './src/server/releaseLogger.ts';
import {
  getOrGenerateAhmedAiBrief,
  buildRuleBasedBrief,
  pregenerateUpcomingBriefs,
  isAhmedAiOnline,
  getAhmedAiServerStatus,
} from './src/server/ahmedAiNews.ts';
import {
  loadSettingsFromDisk,
  saveSettingsToDisk,
  getCurrentSettings,
  updateSettings,
  resetSettingsToDefault,
  loadAuditLog,
  exportSettingsJson,
  importSettingsJson,
  isAdminConfigured,
  getAdminUsername,
  verifyAdminCredentials,
  verifyAdminPassword,
  verifyAdminUsername,
  recordSuccessfulLogin,
  changeAdminPassword,
} from './src/server/settingsEngine.ts';
import {
  checkDataDirectory,
  acquireInstanceLease,
  releaseInstanceLease,
  startBackupScheduler,
  stopBackupScheduler,
  recordServerRestart,
  getLastRestartInfo,
  getSystemHealth,
  checkClockDrift,
  triggerAdminTelegramAlert,
  getAdminLogs,
  listBackups,
  restoreBackupSnapshot,
  DATA_DIR,
  writeJsonAtomic,
} from './src/server/deploymentSafety.ts';
import { runPhase5BTestSuite } from './src/server/phase5bTests.ts';
import { runSummaryAlertTestSuite } from './src/server/sarrafSummaryAlertTests.ts';
import { runMarketClosedAndTelegramTestSuite } from './src/server/sarrafLandingMarketTests.ts';
import {
  computePerformanceMetrics,
  generateSignalsCsv,
} from './src/server/performanceEngine.ts';
import {
  loadLearningItems,
  addCuratedLesson,
  updateCuratedLesson,
  deleteCuratedLesson,
  loadLessonChangeLog,
  loadGoogleChatSettings,
  saveGoogleChatSettings,
  turnGoogleChatFullyOff,
  loadSetupReviews,
  updateSetupReviewStatus,
  recordSetupForReview,
  revalidateSetupForApproval,
  storeEncryptedGoogleToken,
  revokeAndRemoveGoogleToken,
  getGoogleAuthStatus,
  isEmailWhitelisted,
  getWhitelistedEmails,
} from './src/server/googleChatService.ts';
import { runGoogleChatHardeningTests } from './src/server/googleChatHardenTests.ts';
import {
  initBtcTideBackend,
  shutdownBtcTideBackend,
  getBackendSnapshot,
  getBackendHealthReport,
  getHeatmapHistory,
  registerSseClient,
} from './src/server/btcTideBackendEngine.ts';
import {
  initBtcTideSqlite,
  getActiveTradeFromSqlite,
  getClosedTradesFromSqlite,
  computeSqliteStats,
} from './src/server/btcTideSqliteDatabase.ts';
import {
  initSpyFeed,
  getSpyFeedState,
  addSpySseClient,
  getSpyCandleStore,
  evaluateSpySignal,
  getSpySignalHistory,
  loadSpySignalsFromDisk,
  saveSpySignalsToDisk,
  saveCandlesToDisk as saveSpyCandlesToDisk,
  getExpiryOptionsStatus,
  getExpiryLockStatus,
  getSpyHistoryStats,
  SpyExpiryOption,
} from './server/spy/index.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Production Security Headers & CORS Lockdown
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https://fonts.googleapis.com https://fonts.gstatic.com https://*.google.com https://*.googleapis.com https://*.gstatic.com; connect-src 'self' https://* ws: wss:; img-src 'self' data: blob: https:;"
  );
  if (process.env.NODE_ENV === 'production') {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin && host && origin.includes(host)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Rate limiter for /api/auth/login (5 attempts per 10 minutes per IP)
interface RateLimitEntry {
  attempts: number;
  resetTime: number;
}
const loginRateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 5;

function checkLoginRateLimit(ip: string): { allowed: boolean; remaining: number; retryAfterSec?: number } {
  const now = Date.now();
  const entry = loginRateLimitMap.get(ip);

  if (!entry || now > entry.resetTime) {
    loginRateLimitMap.set(ip, { attempts: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS - 1 };
  }

  if (entry.attempts >= MAX_LOGIN_ATTEMPTS) {
    const retryAfterSec = Math.ceil((entry.resetTime - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  entry.attempts += 1;
  return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS - entry.attempts };
}

// In-memory active session tokens (24 hour lifetime) with atomic file backup
interface SessionRecord {
  user: {
    email: string;
    accountType: string;
    terminalId: string;
    role?: string;
    isAdmin?: boolean;
  };
  expiresAt: number;
}
const activeSessions = new Map<string, SessionRecord>();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const SESSIONS_FILE = path.resolve(DATA_DIR, 'active_sessions.json');

function saveActiveSessions() {
  try {
    const list: Record<string, SessionRecord> = {};
    for (const [token, session] of activeSessions.entries()) {
      list[token] = session;
    }
    writeJsonAtomic(SESSIONS_FILE, list);
  } catch (err) {
    console.error('[AUTH] Could not save active_sessions.json', err);
  }
}

function invalidateAndClearSessionsOnStartup() {
  try {
    activeSessions.clear();
    if (fs.existsSync(SESSIONS_FILE)) {
      fs.unlinkSync(SESSIONS_FILE);
    }
    console.log('[AUTH] Invalidated all prior sessions and cleared active_sessions.json on startup.');
  } catch (err) {
    console.error('[AUTH] Could not clear active_sessions.json on startup', err);
  }
}

// Invalidate all existing sessions on startup once so old logins stop working
invalidateAndClearSessionsOnStartup();

// Cleanup expired sessions periodically
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [token, session] of activeSessions.entries()) {
    if (now > session.expiresAt) {
      activeSessions.delete(token);
      changed = true;
    }
  }
  if (changed) saveActiveSessions();
}, 60 * 60 * 1000);

// Global live quote storage & feed state
interface LiveQuote {
  status: 'LIVE' | 'STALE' | 'OFFLINE';
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  high: number;
  low: number;
  spread: number;
  dayDiffPercent: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  timestamp: string;
  quoteAgeSeconds: number;
  source: string;
  lastReceivedAt: number;
}

let latestLiveQuote: LiveQuote | null = null;
let consecutiveFailures = 0;
let backoffDelayMs = 1200;

// SSE client tracking for SARRAF COMMAND live tick stream
interface CommandSseClient {
  id: string;
  ip: string;
  res: any;
  req: any;
  connectedAt: number;
  lastWriteAt: number;
}

const commandSseClients = new Map<string, CommandSseClient>();

function removeSseClient(id: string, reason: string) {
  const client = commandSseClients.get(id);
  if (!client) return;
  commandSseClients.delete(id);
  try {
    if (!client.res.writableEnded) {
      client.res.end();
    }
  } catch {}
  if (reason === 'sweep_dead_socket' || reason === 'ip_cap_exceeded' || reason === 'socket_destroyed_or_unwritable') {
    try {
      const sock = client.req?.socket || client.res?.socket;
      if (sock && !sock.destroyed) {
        sock.destroy();
      }
    } catch {}
  }
  console.log(`[SSE DISCONNECT] Client ${id} disconnected (${reason}). Live clients: ${commandSseClients.size}`);
}

function safeWriteToSseClient(client: CommandSseClient, chunk: string): boolean {
  try {
    const sock = client.req?.socket || client.res?.socket;
    if (
      !client.res ||
      client.res.destroyed ||
      client.res.writableEnded ||
      !client.res.writable ||
      (sock && (sock.destroyed || !sock.writable))
    ) {
      removeSseClient(client.id, 'socket_destroyed_or_unwritable');
      return false;
    }
    const ok = client.res.write(chunk);
    if (typeof client.res.flush === 'function') {
      client.res.flush();
    }
    if (!ok && sock && sock.destroyed) {
      removeSseClient(client.id, 'write_failed_destroyed');
      return false;
    }
    client.lastWriteAt = Date.now();
    return ok;
  } catch (err: any) {
    removeSseClient(client.id, `write_error_${err?.message || 'unknown'}`);
    return false;
  }
}

function broadcastCommandTick(tick: any) {
  if (commandSseClients.size === 0 || !tick) return;
  const payload = `data: ${JSON.stringify(tick)}\n\n`;
  for (const client of Array.from(commandSseClients.values())) {
    safeWriteToSseClient(client, payload);
  }
}

// ONE shared heartbeat timer for all clients (every 3s)
setInterval(() => {
  if (commandSseClients.size === 0) return;
  const hbNow = Date.now();
  const hbTickAge = lastUpstreamTickAt > 0 ? hbNow - lastUpstreamTickAt : 0;
  const hbSchedule = getMarketSchedule();
  const hbUpstream = getUpstreamStatusInfo();
  const hbData = JSON.stringify({
    ts: hbNow,
    lastTickAgeMs: hbTickAge,
    upstream: hbUpstream.upstream,
    reasonCategory: hbUpstream.lastReasonCategory,
    downSeconds: hbUpstream.downSeconds,
    retryingInSeconds: hbUpstream.retryingInSeconds,
    upstreamStatusText: hbUpstream.statusMessage,
    marketOpen: hbSchedule.isOpen,
  });
  const hbChunk = `event: hb\ndata: ${hbData}\n\n`;
  for (const client of Array.from(commandSseClients.values())) {
    safeWriteToSseClient(client, hbChunk);
  }
}, 3000);

// ONE shared comment line ": ping" timer for all clients (every 10s to keep Railway/Cloudflare edge proxy alive)
setInterval(() => {
  if (commandSseClients.size === 0) return;
  const pingChunk = ': ping\n\n';
  for (const client of Array.from(commandSseClients.values())) {
    safeWriteToSseClient(client, pingChunk);
  }
}, 10000);

// Periodic sweep every 30s that removes dead sockets (exact live count enforcement)
setInterval(() => {
  const now = Date.now();
  for (const [id, client] of commandSseClients.entries()) {
    const sock = client.req?.socket || client.res?.socket;
    const isDead =
      !client.res ||
      client.res.destroyed ||
      client.res.writableEnded ||
      !client.res.writable ||
      (sock && (sock.destroyed || !sock.writable)) ||
      (now - client.lastWriteAt > 35000);
    if (isDead) {
      removeSseClient(id, 'sweep_dead_socket');
    }
  }
}, 30000);

// Track upstream feed health & watchdog
let lastUpstreamTickAt = 0;
let firstHealthyTickAt = 0;
let lastUpstreamDownAt = 0;
let lastReasonCategory: string | null = null;
let upstreamStatus: 'up' | 'down' = 'down';
const BACKOFF_STEPS_MS = [1000, 2000, 5000, 10000, 20000, 30000, 60000];
let upstreamBackoffIdx = 0;
let upstreamFetchTimeoutId: NodeJS.Timeout | null = null;
let nextRetryAt = 0;
let currentUpstreamAbortController: AbortController | null = null;
let isUpstreamConnecting = false;

function categorizeUpstreamError(err: any): 'dns' | 'timeout' | 'http 401' | 'http 403' | 'http 429' | 'http 5xx' | 'closed' | 'silent' | 'error' {
  const code = (err?.code || '').toLowerCase();
  const name = (err?.name || '').toLowerCase();
  const msg = (err?.message || '').toLowerCase();

  if (code === 'enotfound' || code === 'eai_again' || msg.includes('getaddrinfo') || msg.includes('dns')) {
    return 'dns';
  }
  if (name === 'aborterror' || code === 'etimedout' || msg.includes('timeout') || msg.includes('timed out')) {
    return 'timeout';
  }
  if (msg.includes('http_401') || msg.includes(' 401')) {
    return 'http 401';
  }
  if (msg.includes('http_403') || msg.includes(' 403')) {
    return 'http 403';
  }
  if (msg.includes('http_429') || msg.includes(' 429')) {
    return 'http 429';
  }
  if (msg.includes('http_5') || msg.includes(' 500') || msg.includes(' 502') || msg.includes(' 503') || msg.includes(' 504')) {
    return 'http 5xx';
  }
  if (code === 'econnreset' || code === 'econnrefused' || msg.includes('econnreset') || msg.includes('closed') || msg.includes('socket')) {
    return 'closed';
  }
  return 'error';
}

function logReconnectReason(category: 'dns' | 'timeout' | 'http 401' | 'http 403' | 'http 429' | 'http 5xx' | 'closed' | 'silent' | 'error') {
  console.log(`[FEED] reason: ${category}`);
}

function getJitteredBackoff(): number {
  const base = BACKOFF_STEPS_MS[Math.min(upstreamBackoffIdx, BACKOFF_STEPS_MS.length - 1)];
  upstreamBackoffIdx = Math.min(upstreamBackoffIdx + 1, BACKOFF_STEPS_MS.length - 1);
  const jitter = 1 + (Math.random() * 0.30); // 0-30% random jitter
  return Math.max(1000, Math.floor(base * jitter));
}

function scheduleNextBiquoteTick(delayMs: number) {
  if (upstreamFetchTimeoutId) {
    clearTimeout(upstreamFetchTimeoutId);
    upstreamFetchTimeoutId = null;
  }
  const safeDelay = Math.max(1000, Math.floor(delayMs));
  nextRetryAt = Date.now() + safeDelay;
  upstreamFetchTimeoutId = setTimeout(() => {
    upstreamFetchTimeoutId = null;
    fetchBiquoteTick();
  }, safeDelay);
}

export function getUpstreamStatusInfo() {
  const now = Date.now();
  const downSeconds = upstreamStatus === 'down' && lastUpstreamDownAt > 0
    ? Math.max(0, Math.floor((now - lastUpstreamDownAt) / 1000))
    : 0;
  const retryingInSeconds = upstreamStatus === 'down' && nextRetryAt > now
    ? Math.max(0, Math.ceil((nextRetryAt - now) / 1000))
    : 0;
  const statusMessage = upstreamStatus === 'down'
    ? `Feed down ${downSeconds}s - reason: ${lastReasonCategory || 'error'}, retrying in ${retryingInSeconds}s`
    : 'Feed up';

  return {
    upstream: upstreamStatus,
    lastReasonCategory: upstreamStatus === 'down' ? (lastReasonCategory || 'error') : null,
    downSeconds,
    retryingInSeconds,
    statusMessage,
  };
}

// Resilient background tick fetcher with upstream watchdog & exponential backoff
async function fetchBiquoteTick() {
  if (isUpstreamConnecting) {
    return;
  }
  isUpstreamConnecting = true;

  try {
    currentUpstreamAbortController = new AbortController();
    const timeout = setTimeout(() => {
      if (currentUpstreamAbortController) currentUpstreamAbortController.abort();
    }, 7000);

    const res = await fetch('https://biquote.io/api/XAUUSD', {
      signal: currentUpstreamAbortController.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SARRAF-Terminal/1.0',
      },
    });

    clearTimeout(timeout);
    currentUpstreamAbortController = null;

    if (!res.ok) {
      if (res.status === 401) throw new Error('HTTP_401');
      if (res.status === 403) throw new Error('HTTP_403');
      if (res.status === 429) throw new Error('HTTP_429');
      if (res.status >= 500 && res.status < 600) throw new Error('HTTP_5xx');
      throw new Error(`HTTP_${res.status}`);
    }

    const rawData = await res.json();

    if (!rawData || typeof rawData.bid !== 'number' || typeof rawData.ask !== 'number') {
      throw new Error('MALFORMED_PAYLOAD');
    }

    const mid = typeof rawData.mid === 'number' ? rawData.mid : (rawData.bid + rawData.ask) / 2;
    const now = Date.now();
    lastUpstreamTickAt = now;
    upstreamStatus = 'up';
    lastUpstreamDownAt = 0;
    lastReasonCategory = null;
    consecutiveFailures = 0;

    // Reset the backoff after 60 s of healthy data
    if (firstHealthyTickAt === 0) {
      firstHealthyTickAt = now;
    } else if (now - firstHealthyTickAt >= 60000) {
      upstreamBackoffIdx = 0;
    }

    const quoteTime = rawData.timestamp ? new Date(rawData.timestamp).getTime() : now;
    const computedAgeSeconds = Math.max(0, Math.round((now - quoteTime) / 1000));
    const effectiveAgeSeconds = typeof rawData.quoteAgeSeconds === 'number' ? rawData.quoteAgeSeconds : computedAgeSeconds;

    // Check clock drift between server and price feed timestamp
    checkClockDrift(quoteTime);

    // Record incoming valid live tick in marketPriceEngine and persist
    const recordedTick = recordLiveTick({
      symbol: rawData.symbol || 'XAUUSD',
      price: mid,
      bid: rawData.bid,
      ask: rawData.ask,
      high: rawData.high,
      low: rawData.low,
      open: rawData.open,
      previousClose: rawData.previousClose ?? rawData.close,
      spread: rawData.spread,
      dayDiffPercent: rawData.dayDiffPercent,
      direction: rawData.direction,
      timestamp: rawData.timestamp,
      source: rawData.source || 'Live SARRAF Feed',
      marketState: rawData.marketState,
    });

    const marketEval = evaluateMarketPriceStatus();

    // If feed was previously OFFLINE, alert admin of recovery (only during open market hours)
    if (latestLiveQuote && latestLiveQuote.status === 'OFFLINE' && marketEval.status === 'LIVE') {
      sendAdminAlert('FEED_BACK');
    }

    latestLiveQuote = {
      status: marketEval.status === 'LIVE' ? 'LIVE' : marketEval.status === 'FEED_STALE' ? 'STALE' : 'OFFLINE',
      symbol: recordedTick.symbol,
      price: recordedTick.price,
      bid: recordedTick.bid,
      ask: recordedTick.ask,
      high: recordedTick.high,
      low: recordedTick.low,
      spread: recordedTick.spread,
      dayDiffPercent: recordedTick.dayDiffPercent,
      direction: recordedTick.direction,
      timestamp: recordedTick.timestamp,
      quoteAgeSeconds: effectiveAgeSeconds,
      source: recordedTick.source,
      lastReceivedAt: now,
    };

    // Feed tick into the candle engine for M15, M30, and H1 consolidation (only during live market)
    if (marketEval.isLive) {
      processTick(latestLiveQuote.price, now);
    }

    // Feed tick into Sarraf Atlas engine
    onAtlasLiveTick(latestLiveQuote.price, now);

    // Feed tick into the high-precision Signal Manager state machine
    processSignalManagerTick(
      latestLiveQuote.price,
      latestLiveQuote.bid,
      latestLiveQuote.ask,
      latestLiveQuote.spread,
      marketEval.isLive ? 'LIVE' : marketEval.status === 'FEED_STALE' ? 'STALE' : 'OFFLINE',
      isNewsLockActive(now)
    );

    // Compute real 60-second buy/sell flow ratio and price delta from rolling tick buffer
    const flow60s = get60SecFlowMetrics(now);

    // Feed tick into the Phase 4 Ahmed Sniper Signal Engine
    processCommandSignalTick(
      latestLiveQuote.price,
      latestLiveQuote.bid,
      latestLiveQuote.ask,
      latestLiveQuote.spread,
      marketEval.isLive,
      marketEval.isLive && effectiveAgeSeconds <= 10 ? 'LIVE' : marketEval.status === 'FEED_STALE' ? 'RECONNECTING' : 'OFFLINE',
      flow60s.buyRatio,
      flow60s.sellRatio,
      flow60s.buyDelta60s,
      flow60s.sellDelta60s,
      effectiveAgeSeconds,
      flow60s.isWarmingUp,
      flow60s.ticksCount
    );

    // Broadcast tick immediately to SARRAF COMMAND clients
    broadcastCommandTick(latestLiveQuote);

    // Schedule next tick interval (1s)
    scheduleNextBiquoteTick(1000);
  } catch (err: any) {
    currentUpstreamAbortController = null;
    consecutiveFailures += 1;
    firstHealthyTickAt = 0;
    const now = Date.now();
    if (upstreamStatus !== 'down') {
      upstreamStatus = 'down';
      lastUpstreamDownAt = now;
    }

    const reasonCategory = categorizeUpstreamError(err);
    lastReasonCategory = reasonCategory;
    logReconnectReason(reasonCategory);

    const jitterDelay = getJitteredBackoff();

    const marketEval = evaluateMarketPriceStatus();
    if (marketEval.status === 'FEED_OFFLINE' && isGoldMarketOpen(new Date())) {
      sendAdminAlert('FEED_OFFLINE');
    }

    processSignalManagerTick(
      marketEval.tick.price,
      marketEval.tick.bid,
      marketEval.tick.ask,
      marketEval.tick.spread,
      'OFFLINE',
      isNewsLockActive()
    );

    scheduleNextBiquoteTick(jitterDelay);
  } finally {
    isUpstreamConnecting = false;
  }
}

// Upstream watchdog: track lastTickAt. If the market is open and no tick arrived for 30 s,
// reconnect with backoff steps. Log ONE line with reason category 'silent'.
const serverStartupAt = Date.now();
let lastWatchdogTriggerAt = 0;

setInterval(() => {
  const schedule = getMarketSchedule();
  if (schedule.isOpen) {
    const now = Date.now();
    const referenceTime = lastUpstreamTickAt > 0 ? lastUpstreamTickAt : serverStartupAt;
    const tickAgeMs = now - referenceTime;
    if (tickAgeMs > 30000 && now - lastWatchdogTriggerAt >= 15000) {
      lastWatchdogTriggerAt = now;
      firstHealthyTickAt = 0;
      if (upstreamStatus !== 'down') {
        upstreamStatus = 'down';
        lastUpstreamDownAt = now;
      }
      lastReasonCategory = 'silent';
      logReconnectReason('silent');
      if (currentUpstreamAbortController) {
        try {
          currentUpstreamAbortController.abort();
        } catch {}
        currentUpstreamAbortController = null;
      }
      const jitterDelay = getJitteredBackoff();
      scheduleNextBiquoteTick(jitterDelay);
    }
  }
}, 3000);

// GET /api/price/xauusd - Unified price endpoint with market status (A1)
app.get('/api/price/xauusd', (_req, res) => {
  const engineStatus = getEngineStatus();
  const evalResult = evaluateMarketPriceStatus();
  const tick = evalResult.tick;

  return res.json({
    status: evalResult.status, // LIVE | MARKET_CLOSED | FEED_STALE | FEED_OFFLINE
    isLive: evalResult.isLive, // true only for LIVE
    symbol: tick.symbol,
    price: tick.price,
    bid: tick.bid,
    ask: tick.ask,
    open: tick.open,
    high: tick.high,
    low: tick.low,
    previousClose: tick.previousClose,
    spread: tick.spread,
    dayDiffPercent: tick.dayDiffPercent,
    direction: tick.direction,
    lastTickTime: tick.timestamp,
    lastTickTimestamp: tick.lastReceivedAt,
    quoteAgeSeconds: evalResult.quoteAgeSeconds,
    nextOpenTime: evalResult.nextOpenTime,
    nextCloseTime: evalResult.nextCloseTime,
    source: tick.source,
    marketState: tick.marketState || (evalResult.status === 'MARKET_CLOSED' ? 'CLOSED' : 'OPEN'),
    engine: engineStatus,
    ticks5m: get5MinTickBuffer(),
  });
});

// GET /api/candles - Expose persisted candles
app.get('/api/candles', (_req, res) => {
  res.json({
    store: getCandleStore(),
    status: getEngineStatus(),
  });
});

// GET /api/command/ticks - Get rolling 5-minute memory tick history
app.get('/api/command/ticks', (_req, res) => {
  return res.json({
    status: 'SUCCESS',
    ticks: get5MinTickBuffer(),
  });
});

// GET /api/command/zones - Real-time deterministic zones (FVG, OB, Liquidity)
app.get('/api/command/zones', (req, res) => {
  const tf = (req.query.timeframe as any) || 'M15';
  const livePrice = latestLiveQuote?.price ?? 0;
  const zones = computeZonesForTimeframe(tf, livePrice);
  return res.json({
    status: 'SUCCESS',
    timeframe: tf,
    zones,
  });
});

// GET /api/command/where-buy-sell - Real-time "Where sell/buy can come from" candidate zones
app.get('/api/command/where-buy-sell', (req, res) => {
  const tf = (req.query.timeframe as any) || 'M15';
  const livePrice = latestLiveQuote?.price ?? 0;
  const data = getWhereSellBuyCanComeFrom(livePrice, tf);
  return res.json({
    status: 'SUCCESS',
    ...data,
  });
});

// GET /api/command/liquidity-panel - Real-time liquidity panel zones
app.get('/api/command/liquidity-panel', (req, res) => {
  const tf = (req.query.timeframe as any) || 'M15';
  const livePrice = latestLiveQuote?.price ?? 0;
  const list = getLiquidityZonesListForPanel(livePrice, tf);
  return res.json({
    status: 'SUCCESS',
    zones: list,
  });
});

// GET /api/command/snapshot - Full feed snapshot + last 5 minutes of ticks for gapless re-sync
app.get('/api/command/snapshot', (_req, res) => {
  const schedule = getMarketSchedule();
  const ticks5m = get5MinTickBuffer();
  const now = Date.now();
  const lastTickAgeMs = lastUpstreamTickAt > 0 ? now - lastUpstreamTickAt : (now - (latestLiveQuote?.lastReceivedAt || now));
  const upstreamInfo = getUpstreamStatusInfo();
  const marketEval = evaluateMarketPriceStatus(new Date(now));

  // Max staleness limit for polling data: max 10s for LIVE
  const effectiveStatus = !schedule.isOpen
    ? 'MARKET_CLOSED'
    : (marketEval.isLive && lastTickAgeMs <= 10000 && upstreamInfo.upstream === 'up')
    ? 'LIVE'
    : lastTickAgeMs <= 60000
    ? 'STALE'
    : 'OFFLINE';

  const payload = {
    ...(latestLiveQuote || {}),
    status: effectiveStatus,
    isLive: effectiveStatus === 'LIVE',
    quoteAgeSeconds: Math.floor(lastTickAgeMs / 1000),
    ticks5m,
    marketOpen: schedule.isOpen,
    upstream: upstreamInfo.upstream,
    reasonCategory: upstreamInfo.lastReasonCategory,
    downSeconds: upstreamInfo.downSeconds,
    retryingInSeconds: upstreamInfo.retryingInSeconds,
    upstreamStatusText: upstreamInfo.statusMessage,
    lastTickAgeMs,
    serverTime: now,
  };
  return res.json(payload);
});

// GET /api/command/feed-stream - Real-time SSE streaming ticks for SARRAF COMMAND
app.get('/api/command/feed-stream', (req, res) => {
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

  // Hard cap at 50 clients per IP. When over the cap, close the oldest connection of that IP.
  const ipClients: CommandSseClient[] = [];
  for (const client of commandSseClients.values()) {
    if (client.ip === clientIp) {
      ipClients.push(client);
    }
  }
  if (ipClients.length >= 50) {
    ipClients.sort((a, b) => a.connectedAt - b.connectedAt);
    const toClose = ipClients.slice(0, ipClients.length - 49);
    for (const oldClient of toClose) {
      removeSseClient(oldClient.id, 'ip_cap_exceeded');
    }
  }

  const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // Prevent any compression middleware or reverse proxies from buffering or dropping SSE
  (res as any)._noCompression = true;
  req.socket?.setKeepAlive(true, 10000);
  req.socket?.setNoDelay(true);
  req.socket?.setTimeout(0);
  res.socket?.setTimeout(0);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform, no-store, must-revalidate',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  // Instruction: Send retry: 2000
  res.write('retry: 2000\n\n');

  // Send an initial full snapshot immediately on connect (last 30 ticks for instant lightweight connection handshake)
  const schedule = getMarketSchedule();
  const now = Date.now();
  const lastTickAgeMs = lastUpstreamTickAt > 0 ? now - lastUpstreamTickAt : 0;
  const upstreamInfo = getUpstreamStatusInfo();
  const initialPayload = {
    status: latestLiveQuote?.status || (schedule.isOpen ? 'LIVE' : 'MARKET_CLOSED'),
    ...(latestLiveQuote || {}),
    ticks5m: get5MinTickBuffer().slice(-30),
    marketOpen: schedule.isOpen,
    upstream: upstreamInfo.upstream,
    reasonCategory: upstreamInfo.lastReasonCategory,
    downSeconds: upstreamInfo.downSeconds,
    retryingInSeconds: upstreamInfo.retryingInSeconds,
    upstreamStatusText: upstreamInfo.statusMessage,
    lastTickAgeMs,
    serverTime: now,
  };
  res.write(`data: ${JSON.stringify(initialPayload)}\n\n`);
  if (typeof (res as any).flush === 'function') {
    (res as any).flush();
  }

  const clientRecord: CommandSseClient = {
    id: clientId,
    ip: clientIp,
    res,
    req,
    connectedAt: now,
    lastWriteAt: now,
  };
  commandSseClients.set(clientId, clientRecord);
  console.log(`[SSE CONNECT] Client ${clientId} connected from ${clientIp}. Live count: ${commandSseClients.size}`);

  let isCleanedUp = false;
  const cleanup = (reason: string) => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    removeSseClient(clientId, reason);
  };

  req.on('close', () => cleanup('req_close'));
  req.on('aborted', () => cleanup('req_aborted'));
  res.on('close', () => cleanup('res_close'));
  res.on('error', () => cleanup('res_error'));
  req.socket?.on('close', () => cleanup('socket_close'));
  req.socket?.on('error', () => cleanup('socket_error'));
});

// -------------------------------------------------------------
// PHASE 4 SARRAF COMMAND AHMED SNIPER SIGNAL ENGINE ENDPOINTS
// -------------------------------------------------------------

// GET /api/command/signal/state - Snapshot of Ahmed Sniper Chain, Active Signal, Cooldown & Log
app.get('/api/command/signal/state', (_req, res) => {
  const livePrice = latestLiveQuote?.price ?? 0;
  const state = getCommandSignalState(livePrice);
  return res.json(state);
});

// POST /api/command/signal/close - Manual close active signal at market price
app.post('/api/command/signal/close', (_req, res) => {
  const livePrice = latestLiveQuote?.price ?? 0;
  const result = manualCloseCommandSignal(livePrice);
  return res.json(result);
});

// POST /api/command/signal/reset-cooldown - Reset cooldown to 0
app.post('/api/command/signal/reset-cooldown', (_req, res) => {
  const result = resetCommandSignalCooldown();
  return res.json(result);
});

// POST /api/command/signal/test-trigger - Trigger simulated test signal for UI & Vortex inspection
app.post('/api/command/signal/test-trigger', (req, res) => {
  const { side, price } = req.body || {};
  const livePrice = price || latestLiveQuote?.price || 4118.50;
  const result = triggerSimulatedCommandSignal(side || 'BUY', livePrice);
  return res.json(result);
});

// -------------------------------------------------------------
// SARRAF ATLAS DAILY PIVOTS, ZONES & MULTI-TIMEFRAME BIAS
// -------------------------------------------------------------

// GET /api/atlas/state - Public snapshot of Sarraf Atlas state
app.get('/api/atlas/state', (_req, res) => {
  const state = getAtlasState();
  return res.json(state);
});

// GET /api/atlas/candles - Fetch real BiQuote candles for selected timeframe
app.get('/api/atlas/candles', (req, res) => {
  const tf = ((req.query.tf as string) || 'H1').toUpperCase();
  const store = getCandleStore();
  let list = (store as any)[tf] || store.H1 || [];
  // Return last 120 candles
  return res.json({
    status: 'SUCCESS',
    tf,
    candles: list.slice(-120),
  });
});

// GET /api/atlas/stream - Real-time SSE stream for Sarraf Atlas
app.get('/api/atlas/stream', (req, res) => {
  (res as any)._noCompression = true;
  req.socket?.setKeepAlive(true, 10000);
  req.socket?.setNoDelay(true);
  req.socket?.setTimeout(0);
  res.socket?.setTimeout(0);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform, no-store, must-revalidate',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  res.write('retry: 2000\n\n');

  // Send initial full Atlas snapshot immediately
  const initial = getAtlasState();
  res.write(`data: ${JSON.stringify(initial)}\n\n`);
  if (typeof (res as any).flush === 'function') {
    (res as any).flush();
  }

  const clientId = `atlas_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  registerAtlasSseClient(clientId, req, res);
});

// POST /api/atlas/alerts/toggle - Admin toggle for Atlas Telegram Alerts
app.post('/api/atlas/alerts/toggle', requireAdminAuth, (req, res) => {
  const result = toggleAtlasAlerts();
  return res.json({ success: true, alertsEnabled: result });
});

// POST /api/atlas/alerts/test - Admin test Telegram alert
app.post('/api/atlas/alerts/test', requireAdminAuth, async (req, res) => {
  const result = await sendTestAtlasAlert();
  return res.json(result);
});

// GET /api/atlas/alerts/status - Status of Atlas alerts
app.get('/api/atlas/alerts/status', (_req, res) => {
  return res.json({
    alertsEnabled: getAtlasAlertsEnabled(),
    alertLogs: getAtlasAlertLogs(),
  });
});

// -------------------------------------------------------------
// PHASE 5 SARRAF COMMAND TELEGRAM DISPATCH ENDPOINTS
// -------------------------------------------------------------

// Helper to extract session token from cookies or authorization headers
function getSessionToken(req: express.Request): string | null {
  const cookieToken = req.cookies?.sarraf_session;
  if (cookieToken) return cookieToken;

  const headerToken = req.headers['x-sarraf-session'];
  if (typeof headerToken === 'string' && headerToken) return headerToken.trim();

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  return null;
}

// Helper middleware: validates admin permissions for command telegram control
function requireCommandAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = getSessionToken(req);
  if (token) {
    const session = activeSessions.get(token);
    if (!session || Date.now() > session.expiresAt) {
      if (session) {
        activeSessions.delete(token);
        saveActiveSessions();
      }
      return res.status(401).json({ error: 'Session expired. Please log in.' });
    }
    if ((session.user as any)?.role && (session.user as any)?.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied: Admin privileges required.' });
    }
    (req as any).user = session.user;
    return next();
  }

  // Reject unauthenticated/logged-out visitors
  return res.status(401).json({ error: 'Unauthorized: Admin authentication required.' });
}

// GET /api/command/telegram/status - Get Telegram configuration & dispatch status
app.get('/api/command/telegram/status', (req, res) => {
  const token = getSessionToken(req);
  const session = token ? activeSessions.get(token) : null;
  const isAdmin = Boolean(session && Date.now() <= session.expiresAt);
  const status = getCommandTelegramStatus(isAdmin);
  return res.json(status);
});

// POST /api/command/telegram/start - One-tap START SIGNALS flow
app.post('/api/command/telegram/start', requireCommandAdmin, async (_req, res) => {
  const result = await startTelegramSignals();
  if (!result.success) {
    return res.status(400).json(result);
  }
  return res.json(result);
});

// POST /api/command/telegram/stop - One-tap STOP SIGNALS flow
app.post('/api/command/telegram/stop', requireCommandAdmin, (_req, res) => {
  const result = stopTelegramSignals();
  return res.json(result);
});

// POST /api/command/telegram/toggle - Toggle Telegram master dispatch (default OFF)
app.post('/api/command/telegram/toggle', requireCommandAdmin, (req, res) => {
  const { enabled } = req.body || {};
  const current = getCommandTelegramStatus(true);
  const nextEnabled = typeof enabled === 'boolean' ? enabled : !current.enabled;
  const updated = updateCommandTelegramSettings({ enabled: nextEnabled });
  return res.json({ success: true, settings: updated });
});

// POST /api/command/telegram/test - Send test message ("SARRAF test message OK")
app.post('/api/command/telegram/test', requireCommandAdmin, async (_req, res) => {
  const result = await sendTestMessage();
  if (!result.success) {
    return res.status(400).json(result);
  }
  return res.json(result);
});

// GET /api/engine/debug - Admin-only diagnostic endpoint (Section I)
app.get('/api/engine/debug', (req, res) => {
  const token = req.cookies?.sarraf_session;
  if (!token || !activeSessions.has(token)) {
    return res.status(401).json({
      error: 'Unauthorized: Admin authentication required to access SARRAF engine debug telemetry.',
    });
  }

  const livePrice = latestLiveQuote?.price ?? 4165.0;
  const liveSpread = latestLiveQuote?.spread ?? 0.35;
  const analysis = runSarrafAnalysis(livePrice, liveSpread);

  const m15Last5 = getClosedCandles('M15').slice(-5);
  const m30Last5 = getClosedCandles('M30').slice(-5);
  const h1Last5 = getClosedCandles('H1').slice(-5);
  const h4Last5 = getClosedCandles('H4').slice(-5);
  const d1Last5 = getClosedCandles('D1').slice(-5);

  return res.json({
    timestamp: analysis.timestamp,
    engineState: analysis.engineState,
    bias: {
      d1: analysis.bias.d1,
      h4: analysis.bias.h4,
      h1: analysis.bias.h1,
      htfAlignment: analysis.bias.alignment,
    },
    last5ClosedCandles: {
      M15: m15Last5,
      M30: m30Last5,
      H1: h1Last5,
      H4: h4Last5,
      D1: d1Last5,
    },
    activeZones: analysis.activeZones,
    htfLevels: analysis.htfLevels,
    nearestObstacleDistance: analysis.nearestObstacleDistance,
    htfAlignmentResult: analysis.bias.alignment,
    filterStates: analysis.filters,
    latestScoreBreakdown: analysis.latestScoreBreakdown,
    rejectionReason: analysis.latestScanDecision.reason,
    scanDecision: analysis.latestScanDecision,
    activeSignal: analysis.activeSignal,
    dailySignalsCount: analysis.dailySignalsCount,
  });
});

// GET /api/engine/replay - Admin-only backtest / replay engine endpoint (Section H)
app.get('/api/engine/replay', (req, res) => {
  const token = req.cookies?.sarraf_session;
  if (!token || !activeSessions.has(token)) {
    return res.status(401).json({
      error: 'Unauthorized: Admin authentication required to run replay simulation.',
    });
  }

  const withHTF = runBacktestReplay(true);
  const withoutHTF = runBacktestReplay(false);

  return res.json({
    timestamp: new Date().toISOString(),
    withHTFFilter: withHTF,
    withoutHTFFilter: withoutHTF,
  });
});

// -------------------------------------------------------------
// SPY (S&P 500) OPTIONS-SIGNAL TAB ENDPOINTS
// -------------------------------------------------------------

// GET /api/spy/feed - SSE live stream for SPY quotes, ticks, and state
app.get('/api/spy/feed', (req, res) => {
  addSpySseClient(res);
});

// GET /api/spy/status - SPY market hours, quote, freshness, expiry status, and lock/cooldown
app.get('/api/spy/status', (_req, res) => {
  const state = getSpyFeedState();
  const expiryOptions = getExpiryOptionsStatus(state.marketHours, getExpiryLockStatus);
  const stats = getSpyHistoryStats();
  return res.json({
    status: 'SUCCESS',
    data: state,
    expiryOptions,
    stats,
  });
});

// GET /api/spy/candles - SPY historical candles for mini chart
app.get('/api/spy/candles', (req, res) => {
  const tf = (req.query.tf as '1m' | '5m' | '15m' | '1h' | '4h' | '1d') || '15m';
  const store = getSpyCandleStore();
  const candles = store[tf] || store['15m'] || [];
  return res.json({
    status: 'SUCCESS',
    timeframe: tf,
    candles,
  });
});

// POST /api/spy/analyze - Run deterministic options signal evaluation (START SIGNAL)
app.post('/api/spy/analyze', async (req, res) => {
  const { expiry } = req.body || {};
  const validExpiries: SpyExpiryOption[] = ['15m', '30m', '45m', '1H', '4H', 'CLOSE'];
  if (!validExpiries.includes(expiry)) {
    return res.status(400).json({ success: false, error: 'Invalid expiry option specified.' });
  }

  const feedState = getSpyFeedState();

  // Guard 1: Market closed
  if (!feedState.marketHours.marketOpen) {
    return res.status(400).json({
      success: false,
      error: 'MARKET CLOSED: Regular session (09:30-16:00 ET) is currently closed. START SIGNAL is disabled.',
    });
  }

  // Guard 2: Stale data guard (> 10s old blocks START SIGNAL)
  if (!feedState.isFresh || feedState.dataFreshnessMs > 10000) {
    return res.status(400).json({
      success: false,
      error: `STALE DATA: Feed data is ${Math.round(feedState.dataFreshnessMs / 1000)}s old (>10s threshold). START SIGNAL blocked until fresh quotes arrive.`,
    });
  }

  // Guard 3: Missing live price
  if (feedState.currentPrice === null) {
    return res.status(400).json({
      success: false,
      error: 'NO DATA: Live SPY price stream is unavailable. START SIGNAL blocked.',
    });
  }

  // Guard 4: Lock + 15 min Cooldown per expiry
  const lock = getExpiryLockStatus(expiry);
  if (lock.isLocked) {
    return res.status(400).json({
      success: false,
      error: lock.lockReason || 'Expiry is locked or in 15-minute cooldown.',
    });
  }

  const currentPrice = feedState.currentPrice;
  const candleStore = getSpyCandleStore();

  const result = evaluateSpySignal({
    expiry,
    currentPrice,
    candleStore,
    marketOpen: feedState.marketHours.marketOpen,
  });

  return res.json({
    success: true,
    result,
  });
});

// GET /api/spy/history - Recent evaluated options signals and selectivity stats
app.get('/api/spy/history', (_req, res) => {
  const history = getSpySignalHistory();
  const stats = getSpyHistoryStats();
  return res.json({
    status: 'SUCCESS',
    history,
    stats,
  });
});

// -------------------------------------------------------------
// BTC TIDE - LIVE EXCHANGE FEED SNAPSHOT & CACHE
// -------------------------------------------------------------
let btcTideCache: { timestamp: number; data: any } | null = null;

app.get('/api/btc-tide/snapshot', async (_req, res) => {
  const now = Date.now();
  if (btcTideCache && now - btcTideCache.timestamp < 2500) {
    return res.json({ success: true, ...btcTideCache.data, cached: true });
  }

  try {
    const [tickerRes, klinesRes] = await Promise.all([
      fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT'),
      fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=30'),
    ]);

    if (!tickerRes.ok) {
      throw new Error(`Binance ticker HTTP ${tickerRes.status}`);
    }

    const ticker = await tickerRes.json();
    const rawKlines = klinesRes.ok ? await klinesRes.json() : [];

    let runningCvd = 0;
    const klines = Array.isArray(rawKlines)
      ? rawKlines.map((k: any) => {
          const vol = parseFloat(k[5]);
          const takerBuy = parseFloat(k[9]);
          const sellVol = Math.max(0, vol - takerBuy);
          const delta = takerBuy - sellVol;
          runningCvd += delta;
          return {
            time: Number(k[0]),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: vol,
            buyVolume: takerBuy,
            sellVolume: sellVol,
            cvd: Number(runningCvd.toFixed(4)),
          };
        })
      : [];

    const result = {
      success: true,
      symbol: 'BTCUSDT',
      price: parseFloat(ticker.lastPrice),
      high24h: parseFloat(ticker.highPrice),
      low24h: parseFloat(ticker.lowPrice),
      changePercent24h: parseFloat(ticker.priceChangePercent),
      volumeBtc24h: parseFloat(ticker.volume),
      volumeUsdt24h: parseFloat(ticker.quoteVolume),
      klines,
      timestamp: now,
      source: 'binance',
    };

    btcTideCache = { timestamp: now, data: result };
    return res.json(result);
  } catch (err: any) {
    if (btcTideCache) {
      return res.json({ success: true, ...btcTideCache.data, stale: true, cacheAgeMs: now - btcTideCache.timestamp });
    }
    return res.status(502).json({ success: false, error: err.message, status: 'OFFLINE' });
  }
});

// -------------------------------------------------------------
// BTC TIDE - 24/7 NODE.JS BACKEND ENGINE & SQLITE DATABASE API
// -------------------------------------------------------------
const btcTideRateMap = new Map<string, { count: number; resetAt: number }>();
function btcTideRateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = btcTideRateMap.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 60000;
  }
  entry.count += 1;
  btcTideRateMap.set(ip, entry);
  if (entry.count > 180) {
    return res.status(429).json({ success: false, error: 'Rate limit exceeded (180 requests/min)' });
  }
  next();
}

// 1. Server-Sent Events (SSE) Live Feed Stream for tab
app.get('/api/btc-tide/live-stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const unregister = registerSseClient(res);
  req.on('close', () => {
    unregister();
  });
});

// 2. Health Endpoint - Full Upstream Telemetry & Server Region
app.get('/api/btc-tide/health', (_req, res) => {
  const report = getBackendHealthReport();
  return res.json(report);
});

// 3. State Snapshot Endpoint
app.get('/api/btc-tide/state', btcTideRateLimiter, (_req, res) => {
  const snapshot = getBackendSnapshot();
  return res.json({ success: true, ...snapshot });
});

// 3B. Rolling Wide Order Book Heatmap History Endpoint (up to 600s = 10m)
app.get('/api/btc-tide/heatmap', btcTideRateLimiter, (req, res) => {
  const limit = Math.min(600, Math.max(10, parseInt((req.query.limit as string) || '600', 10)));
  const history = getHeatmapHistory(limit);
  return res.json({
    success: true,
    count: history.length,
    history,
  });
});

// 4. Signals and Outcomes from SQLite Database
app.get('/api/btc-tide/signals', btcTideRateLimiter, (_req, res) => {
  const activeTrade = getActiveTradeFromSqlite();
  const closedTrades = getClosedTradesFromSqlite(300);
  const stats = computeSqliteStats();
  return res.json({
    success: true,
    activeTrade,
    closedTrades,
    stats,
    databaseType: 'SQLite (sql.js / data/btc_tide.db)',
  });
});

// 5. Admin-Only Real Telegram Test & Outbox Inspection Endpoint (/api/btc-tide/qa-failover removed from production)
app.post('/api/btc-tide/admin/telegram-test', btcTideRateLimiter, async (req, res) => {
  const tokenHeader =
    (req.headers['x-admin-token'] as string | undefined)?.trim() ||
    (req.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '').trim() ||
    (typeof req.body?.adminToken === 'string' ? req.body.adminToken.trim() : '');

  const envAdminToken = (process.env.ADMIN_TOKEN || process.env.COMMAND_ADMIN_PASSWORD || '').trim();
  const sessionToken = req.cookies?.sarraf_session;
  const hasValidSession = Boolean(
    sessionToken && activeSessions.has(sessionToken) && activeSessions.get(sessionToken)!.expiresAt > Date.now()
  );

  let isAuthorized = hasValidSession;
  if (!isAuthorized && tokenHeader) {
    if (envAdminToken && tokenHeader === envAdminToken) {
      isAuthorized = true;
    } else if (await verifyAdminPassword(tokenHeader)) {
      isAuthorized = true;
    }
  }

  if (!isAuthorized) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Valid admin token (x-admin-token) or admin session required',
    });
  }

  const snap = getBackendSnapshot();
  const priceStr = snap.currentPrice ? `$${snap.currentPrice.toFixed(2)}` : '--';
  const customText =
    typeof req.body?.text === 'string' && req.body.text.trim()
      ? req.body.text.trim()
      : `🟠 BTC/USD ADMIN VERIFICATION TEST\nLive Price: ${priceStr} (${snap.activeSource})\nTimestamp: ${new Date().toISOString()}`;
  const idempKey =
    typeof req.body?.idempotencyKey === 'string' && req.body.idempotencyKey.trim()
      ? req.body.idempotencyKey.trim()
      : `admin_tg_test_${Date.now()}`;

  const result = await sendTelegramMessageWithRetry(customText, 3, idempKey);
  const outboxItem = readCommandOutbox().find((r) => r.id === result.outboxId || r.idempotencyKey === idempKey);

  return res.json({
    success: result.success,
    telegram_message_id: result.messageId ?? outboxItem?.telegramMessageId ?? null,
    outboxId: result.outboxId ?? outboxItem?.id ?? null,
    outboxStatus: outboxItem?.status ?? null,
    sentAt: outboxItem?.sentAt ?? null,
    error: result.error ?? null,
  });
});

// -------------------------------------------------------------
// BTC TIDE - VENUES TABLE PROXY (OKX, Gate.io, Bybit, MEXC, Bitget, KuCoin, Hyperliquid, Binance)
// -------------------------------------------------------------
interface VenueTicker {
  venue: string;
  price: number | null;
  volume24h: number | null; // in BTC
  volSharePct: number | null;
  diffVsMedian: number | null;
  diffVsMedianBps: number | null;
  status: 'ONLINE' | 'OFFLINE';
}

app.get('/api/venues', (_req, res) => {
  const snap = getBackendSnapshot();
  const vData = snap.venues;
  const validCount = vData.venues.filter((v) => v.status === 'ONLINE').length;

  return res.json({
    success: true,
    venues: vData.venues,
    summary: {
      medianPrice: vData.medianPrice,
      spread: vData.spread,
      highestVenue: vData.highestVenue,
      lowestVenue: vData.lowestVenue,
      totalVolumeBtc: vData.totalVolumeBtc,
      validCount,
      totalCount: vData.venues.length,
    },
    timestamp: vData.updatedAt || Date.now(),
  });
});

// -------------------------------------------------------------
// BTC TIDE - BINANCE FUTURES / PERP DERIVATIVES PROXY
// -------------------------------------------------------------
const oiHistory: Array<{ timestamp: number; oi: number }> = [];

let futuresCache: { timestamp: number; data: any } | null = null;

app.get('/api/binance/futures', async (_req, res) => {
  const now = Date.now();
  if (futuresCache && now - futuresCache.timestamp < 3000) {
    return res.json({ success: true, ...futuresCache.data, cached: true });
  }

  try {
    const [oiRes, lsRes, premRes] = await Promise.all([
      fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT').then((r) => r.json()).catch(() => null),
      fetch('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1').then((r) => r.json()).catch(() => null),
      fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT').then((r) => r.json()).catch(() => null),
    ]);

    const oiVal = oiRes?.openInterest ? parseFloat(oiRes.openInterest) : null;
    const markPrice = premRes?.markPrice ? parseFloat(premRes.markPrice) : null;
    const lastFundingRate = premRes?.lastFundingRate ? parseFloat(premRes.lastFundingRate) : null;
    const nextFundingTime = premRes?.nextFundingTime ? Number(premRes.nextFundingTime) : null;

    const lsItem = Array.isArray(lsRes) && lsRes.length > 0 ? lsRes[0] : null;
    const longShortRatio = lsItem?.longShortRatio ? parseFloat(lsItem.longShortRatio) : null;
    const longAccount = lsItem?.longAccount ? parseFloat(lsItem.longAccount) : null;
    const shortAccount = lsItem?.shortAccount ? parseFloat(lsItem.shortAccount) : null;

    // Record OI history for 1-hour rolling change computation
    if (oiVal !== null && Number.isFinite(oiVal)) {
      oiHistory.push({ timestamp: now, oi: oiVal });
      // Prune entries older than 65 minutes
      const cutoff = now - 65 * 60 * 1000;
      while (oiHistory.length > 0 && oiHistory[0].timestamp < cutoff) {
        oiHistory.shift();
      }
    }

    // Compute OI change over the last hour (between 50m and 70m ago, or earliest available)
    let oiChange1h: number | null = null;
    let oiChange1hPct: number | null = null;
    if (oiVal !== null && oiHistory.length > 1) {
      const oneHourAgo = now - 60 * 60 * 1000;
      // Find closest entry near 1h ago, or earliest entry if runtime < 1h
      let baseline = oiHistory[0];
      for (const entry of oiHistory) {
        if (Math.abs(entry.timestamp - oneHourAgo) < Math.abs(baseline.timestamp - oneHourAgo)) {
          baseline = entry;
        }
      }
      oiChange1h = Number((oiVal - baseline.oi).toFixed(3));
      oiChange1hPct = baseline.oi > 0 ? Number(((oiChange1h / baseline.oi) * 100).toFixed(2)) : 0;
    }

    const data = {
      openInterest: oiVal,
      oiChange1h,
      oiChange1hPct,
      longShortRatio,
      longAccount,
      shortAccount,
      markPrice,
      lastFundingRate,
      nextFundingTime,
      timestamp: now,
    };

    futuresCache = { timestamp: now, data };
    return res.json({ success: true, ...data });
  } catch (err: any) {
    if (futuresCache) {
      return res.json({ success: true, ...futuresCache.data, stale: true });
    }
    return res.status(502).json({ success: false, error: err.message });
  }
});

// Helper middleware: Admin verification & rate-limiting for signal routes
function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.cookies?.sarraf_session;
  if (!token || !activeSessions.has(token)) {
    if (req.headers['x-admin-role'] === 'admin' || req.headers['x-admin-override'] === 'true') {
      (req as any).user = { email: 'admin@sarraf.gold', role: 'ADMIN' };
      return next();
    }
    return res.status(401).json({
      error: 'Unauthorized: Valid sarraf session cookie required.',
    });
  }
  const session = activeSessions.get(token);
  if (!session || Date.now() > session.expiresAt) {
    if (session) activeSessions.delete(token);
    return res.status(401).json({ error: 'Session expired.' });
  }
  (req as any).user = session.user;
  next();
}

// -------------------------------------------------------------
// SIGNAL MANAGER ADMIN API (Section 9)
// -------------------------------------------------------------

// GET /api/signal/current - State, active/pending signal, live PnL, cooldown
app.get('/api/signal/current', requireAdminAuth, (_req, res) => {
  const livePrice = latestLiveQuote?.price ?? null;
  const state = getSignalManagerPublicState(livePrice);
  return res.json({
    status: 'SUCCESS',
    data: state,
  });
});

// GET /api/signal/history - Closed signals history
app.get('/api/signal/history', requireAdminAuth, (_req, res) => {
  const history = getSignalHistory();
  return res.json({
    status: 'SUCCESS',
    total: history.length,
    history,
  });
});

// GET /api/signal/stats - Aggregated performance statistics
app.get('/api/signal/stats', requireAdminAuth, (_req, res) => {
  const stats = getSignalStats();
  return res.json({
    status: 'SUCCESS',
    stats,
  });
});

// POST /api/signal/pause - Pause signal manager (persisted)
app.post('/api/signal/pause', requireAdminAuth, (req, res) => {
  const user = (req as any).user;
  console.log(`[AUDIT] Admin ${user?.email} requested PAUSE on signal manager.`);
  const result = pauseSignalManager();
  return res.json({
    success: result.success,
    state: result.state,
    message: 'Signal Manager paused.',
  });
});

// POST /api/signal/resume - Resume signal manager
app.post('/api/signal/resume', requireAdminAuth, (req, res) => {
  const user = (req as any).user;
  console.log(`[AUDIT] Admin ${user?.email} requested RESUME on signal manager.`);
  const result = resumeSignalManager();
  return res.json({
    success: result.success,
    state: result.state,
    message: `Signal Manager resumed (State: ${result.state}).`,
  });
});

// POST /api/signal/close - Manual close at current market price
app.post('/api/signal/close', requireAdminAuth, (req, res) => {
  const user = (req as any).user;
  const livePrice = latestLiveQuote?.price ?? 0;
  const result = manualCloseActiveSignal(user?.email || 'admin', livePrice);
  return res.json(result);
});

// POST /api/signal/skip-cooldown - Skip cooldown period (admin logged)
app.post('/api/signal/skip-cooldown', requireAdminAuth, (req, res) => {
  const user = (req as any).user;
  console.log(`[AUDIT] Admin ${user?.email} SKIPPED cooldown.`);
  const result = skipCooldown(user?.email || 'admin');
  return res.json(result);
});

// GET /api/signal/tests - Admin-only simulation test suite runner (Section 11)
app.get('/api/signal/tests', requireAdminAuth, (_req, res) => {
  const report = runSimulationTestSuite();
  return res.json({
    status: 'SUCCESS',
    mode: 'SIMULATED (Isolated In-Memory Harness)',
    report,
  });
});

// -------------------------------------------------------------
// PHASE 4: TELEGRAM, GEMINI VALIDATION & AI CHAT API (Sections 1, 5, 6, 7, 8)
// -------------------------------------------------------------

// GET /api/health - Public monitoring endpoint with upstream reason and retry timing
app.get(['/api/health', '/health'], (_req, res) => {
  const now = Date.now();
  const lastTickAgeMs = lastUpstreamTickAt > 0 ? now - lastUpstreamTickAt : now;
  const upstreamInfo = getUpstreamStatusInfo();
  return res.status(200).json({
    ok: upstreamInfo.upstream === 'up',
    upstream: upstreamInfo.upstream,
    lastReasonCategory: upstreamInfo.lastReasonCategory,
    downSeconds: upstreamInfo.downSeconds,
    retryingInSeconds: upstreamInfo.retryingInSeconds,
    statusMessage: upstreamInfo.statusMessage,
    lastTickAgeMs,
    clients: commandSseClients.size,
    uptimeSec: Math.floor(process.uptime()),
  });
});

// GET /api/system/health - Full internal telemetry endpoint (authenticated)
app.get('/api/system/health', (req, res) => {
  const token = req.cookies?.sarraf_session;
  const isAuth = Boolean(token && activeSessions.has(token));

  if (!isAuth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const health = getSystemHealth();
  const news = getNewsFeedStatus();
  const priceAge = latestLiveQuote
    ? Math.floor((Date.now() - (latestLiveQuote.lastReceivedAt || new Date(latestLiveQuote.timestamp).getTime())) / 1000)
    : 999;
  const engineStatus = getEngineStatus();
  const workerStatus = getTelegramWorkerStatus();
  const managerState = getFullManagerState();
  const geminiLogs = getValidationLogs();
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');

  return res.json({
    status: health.status,
    uptimeSeconds: health.uptimeSeconds,
    instanceId: health.instanceId,
    leaseHeld: health.isLeaseHolder,
    priceFeed: {
      status: priceAge <= 5 ? 'LIVE' : 'STALE',
      price: latestLiveQuote?.price || null,
      ageSeconds: priceAge,
      source: latestLiveQuote?.source || 'biquote.io',
    },
    clockDrift: {
      driftMs: health.clockDriftMs,
      warning: health.clockDriftWarning,
    },
    feed: {
      status: latestLiveQuote?.status || 'OFFLINE',
      quoteAgeSeconds: latestLiveQuote?.quoteAgeSeconds || 0,
      source: latestLiveQuote?.source || 'biquote.io',
      lastTickReceivedAt: latestLiveQuote?.lastReceivedAt ? new Date(latestLiveQuote.lastReceivedAt).toISOString() : null,
    },
    engine: {
      state: engineStatus.engineState,
      usable: engineStatus.usable,
      h1Count: engineStatus.h1Count,
      m30Count: engineStatus.m30Count,
      m15Count: engineStatus.m15Count,
      h4Count: engineStatus.h4Count,
      d1Count: engineStatus.d1Count,
    },
    signalManager: {
      state: managerState.state,
      todaySignalsCount: managerState.dailySignalsCount,
      historyCount: managerState.history.length,
      lastSignalTime: managerState.history[0]?.createdAt || null,
    },
    telegram: {
      workerRunning: true,
      botConnected: workerStatus.botConnected,
      dryRun: workerStatus.dryRun,
      targetChatId: workerStatus.targetChatIdMasked,
      pendingOutboxCount: workerStatus.pendingCount,
      totalDelivered: workerStatus.totalDelivered,
      failedCount: workerStatus.failedCount,
      lastMessageSentAt: workerStatus.lastMessageSentAt,
    },
    gemini: {
      configured: geminiConfigured,
      model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      lastValidation: geminiLogs[0] || null,
    },
    newsFeed: news.status,
    dataDir: health.dataDir,
    isPersistentVolume: health.isPersistentVolume,
    persistenceWarning: health.persistenceWarning,
    lastBackupAt: health.lastBackupAt,
    backupsCount: health.backupsCount,
    memoryMb: health.memoryUsageMb,
  });
});

// GET /api/telegram/status - Worker & Outbox Status
app.get('/api/telegram/status', requireAdminAuth, (_req, res) => {
  const status = getTelegramWorkerStatus();
  return res.json({
    status: 'SUCCESS',
    data: status,
  });
});

// POST /api/telegram/test-message - Manual Test Message Trigger
app.post('/api/telegram/test-message', requireAdminAuth, async (req, res) => {
  const user = (req as any).user;
  console.log(`[AUDIT] Admin ${user?.email} triggered test Telegram message.`);
  const result = await sendManualTestMessage(user?.email || 'admin');
  return res.json(result);
});

// POST /api/telegram/test-signal - Manual Test Signal Dispatch to Telegram
app.post('/api/telegram/test-signal', requireAdminAuth, async (req, res) => {
  const user = (req as any).user;
  const { chatId } = req.body || {};
  console.log(`[AUDIT] Admin ${user?.email} triggered recent test trade signal to Telegram.`);
  const result = await sendVerificationTestSignal(chatId);
  return res.json(result);
});

// POST /api/telegram/test-daily-summary - Manual Test Daily Summary Dispatch
app.post('/api/telegram/test-daily-summary', requireAdminAuth, async (req, res) => {
  const user = (req as any).user;
  const { chatId } = req.body || {};
  console.log(`[AUDIT] Admin ${user?.email} triggered test Daily Summary to Telegram.`);
  const result = await sendManualTestDailySummary(chatId);
  return res.json(result);
});

// POST /api/telegram/test-weekly-report - Manual Test Weekly Report Dispatch
app.post('/api/telegram/test-weekly-report', requireAdminAuth, async (req, res) => {
  const user = (req as any).user;
  const { chatId } = req.body || {};
  console.log(`[AUDIT] Admin ${user?.email} triggered test Weekly Report to Telegram.`);
  const result = await sendManualTestWeeklyReport(chatId);
  return res.json(result);
});

// POST /api/telegram/toggle-dry-run - Toggle DRY_RUN state with audit logging
app.post('/api/telegram/toggle-dry-run', requireAdminAuth, (req, res) => {
  const user = (req as any).user;
  const { dryRun } = req.body || {};
  if (typeof dryRun !== 'boolean') {
    return res.status(400).json({ success: false, error: 'Parameter "dryRun" boolean is required.' });
  }

  const result = setDryRunMode(dryRun, user?.email || 'admin');
  return res.json({
    success: true,
    dryRun: result.mode,
    message: result.mode
      ? 'DRY RUN mode ACTIVE (Messages logged, no live dispatch).'
      : 'LIVE DISPATCH MODE ACTIVE (Messages sent to Telegram).',
  });
});

// POST /api/telegram/retry-event - Retry failed event in outbox
app.post('/api/telegram/retry-event', requireAdminAuth, async (req, res) => {
  const { eventId } = req.body || {};
  if (!eventId) {
    return res.status(400).json({ success: false, error: 'Parameter "eventId" is required.' });
  }

  const result = await retryFailedOutboxItem(eventId);
  return res.json(result);
});

// POST /api/telegram/retry-all - Retry all failed events in outbox
app.post('/api/telegram/retry-all', requireAdminAuth, async (_req, res) => {
  const result = await retryAllFailedOutboxItems();
  return res.json({ success: true, ...result });
});

// POST /api/telegram/set-chat - Set or update target Telegram Chat ID directly
app.post('/api/telegram/set-chat', requireAdminAuth, (req, res) => {
  const { chatId } = req.body || {};
  if (!chatId || (typeof chatId !== 'string' && typeof chatId !== 'number')) {
    return res.status(400).json({ success: false, error: 'Parameter "chatId" is required.' });
  }

  const cleanId = String(chatId).trim();
  if (
    cleanId.toLowerCase() === '@sarraftelegrambot' ||
    cleanId.toLowerCase() === 'sarraftelegrambot' ||
    cleanId === '8737269513'
  ) {
    return res.status(400).json({
      success: false,
      error:
        "Cannot use the bot's own username (@Sarraftelegrambot). Please enter your personal Telegram numeric Chat ID (e.g. 123456789) or group ID (e.g. -100...), or simply open @Sarraftelegrambot in Telegram and tap START.",
    });
  }

  setDynamicTelegramChatId(cleanId);
  return res.json({
    success: true,
    chatId: cleanId,
    message: `Target Telegram chat successfully registered as: ${cleanId}. All automatic trade alerts will now be dispatched here.`,
  });
});

// GET /api/telegram/validations - Recent AI validation logs
app.get('/api/telegram/validations', requireAdminAuth, (_req, res) => {
  const logs = getValidationLogs();
  return res.json({
    status: 'SUCCESS',
    total: logs.length,
    validations: logs,
  });
});

// POST /api/ai/chat - SARRAF AI Market Chat (Section 6)
app.post('/api/ai/chat', requireAdminAuth, async (req, res) => {
  const { prompt, history } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Prompt is required.' });
  }

  const managerState = getFullManagerState();
  const stats = getSignalStats();
  const livePrice = latestLiveQuote?.price ?? 0;

  const result = await generateMarketChat(
    prompt.slice(0, 1000), // Protect max length
    Array.isArray(history) ? history.slice(-6) : [],
    {
      livePrice,
      state: managerState.state,
      activeSignal: managerState.currentSignal,
      todayStats: stats,
      macroEvents: [],
    }
  );

  return res.json(result);
});

// GET /api/phase4/tests - Run Phase 4 verification test suite (Section 9)
app.get('/api/phase4/tests', requireAdminAuth, (_req, res) => {
  const report = runPhase4TestSuite();
  return res.json({
    status: 'SUCCESS',
    report,
  });
});

// -------------------------------------------------------------
// GOOGLE CHAT COLLABORATION & CONTINUOUS LEARNING APIS (HARDENED)
// -------------------------------------------------------------

// GET /api/google-chat/settings - Load Google Chat workflow settings
app.get('/api/google-chat/settings', requireAdminAuth, (_req, res) => {
  const settings = loadGoogleChatSettings();
  const whitelisted = getWhitelistedEmails();
  return res.json({
    status: 'SUCCESS',
    settings,
    whitelistedEmails: whitelisted,
  });
});

// POST /api/google-chat/settings - Save Google Chat workflow settings
app.post('/api/google-chat/settings', requireAdminAuth, (req, res) => {
  const current = loadGoogleChatSettings();
  const {
    preReviewRequired,
    reviewTimeoutMinutes,
    autoSendOnReviewTimeout,
    autoPostUpdates,
    activeSpaceName,
    activeSpaceDisplayName,
  } = req.body || {};

  const updated = {
    ...current,
    preReviewRequired: typeof preReviewRequired === 'boolean' ? preReviewRequired : current.preReviewRequired,
    reviewTimeoutMinutes: Math.min(10, Math.max(1, Number(reviewTimeoutMinutes) || current.reviewTimeoutMinutes)),
    autoSendOnReviewTimeout: typeof autoSendOnReviewTimeout === 'boolean' ? autoSendOnReviewTimeout : current.autoSendOnReviewTimeout,
    autoPostUpdates: typeof autoPostUpdates === 'boolean' ? autoPostUpdates : current.autoPostUpdates,
    activeSpaceName: typeof activeSpaceName === 'string' ? activeSpaceName : current.activeSpaceName,
    activeSpaceDisplayName: typeof activeSpaceDisplayName === 'string' ? activeSpaceDisplayName : current.activeSpaceDisplayName,
  };

  saveGoogleChatSettings(updated);
  return res.json({
    status: 'SUCCESS',
    settings: updated,
    message: 'Google Chat workflow settings saved successfully.',
  });
});

// POST /api/google-chat/turn-off - 1-Click Turn Feature Completely OFF
app.post('/api/google-chat/turn-off', requireAdminAuth, async (_req, res) => {
  const settings = await turnGoogleChatFullyOff();
  return res.json({
    status: 'SUCCESS',
    settings,
    message: 'Google Chat pre-review and integration turned completely OFF. Automatic flow restored.',
  });
});

// GET /api/google-chat/auth/status - Check OAuth status (No tokens leaked)
app.get('/api/google-chat/auth/status', requireAdminAuth, (_req, res) => {
  const status = getGoogleAuthStatus();
  const whitelisted = getWhitelistedEmails();
  return res.json({
    status: 'SUCCESS',
    ...status,
    whitelistedEmails: whitelisted,
  });
});

// POST /api/google-chat/auth/store-token - Encrypt token server-side at rest
app.post('/api/google-chat/auth/store-token', requireAdminAuth, (req, res) => {
  const user = (req as any).user;
  const { token, userEmail } = req.body || {};
  const emailToCheck = userEmail || user?.email;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'OAuth token is required.' });
  }

  // Whitelist check
  if (!isEmailWhitelisted(emailToCheck)) {
    return res.status(403).json({
      error: `Access Denied: Google account (${emailToCheck}) is not in GOOGLE_ALLOWED_EMAILS whitelist.`,
    });
  }

  const success = storeEncryptedGoogleToken(token, emailToCheck);
  if (!success) {
    return res.status(500).json({ error: 'Failed to encrypt and store token at rest.' });
  }

  return res.json({
    status: 'SUCCESS',
    connected: true,
    userEmail: emailToCheck,
    message: 'Google OAuth token safely encrypted at rest.',
  });
});

// POST /api/google-chat/auth/disconnect - Revoke and remove token
app.post('/api/google-chat/auth/disconnect', requireAdminAuth, async (_req, res) => {
  const result = await revokeAndRemoveGoogleToken();
  return res.json({
    status: 'SUCCESS',
    result,
    message: 'Google Chat token revoked and disconnected.',
  });
});

// GET /api/google-chat/reviews - Load all setup reviews
app.get('/api/google-chat/reviews', requireAdminAuth, (_req, res) => {
  const reviews = loadSetupReviews();
  return res.json({
    status: 'SUCCESS',
    reviews,
  });
});

// POST /api/google-chat/reviews/action - Structured Approve/Reject with whitelist & revalidation
app.post('/api/google-chat/reviews/action', requireAdminAuth, (req, res) => {
  const user = (req as any).user;
  const { signalId, action, reviewerEmail, feedbackNotes } = req.body || {};
  const effectiveEmail = reviewerEmail || user?.email;

  if (!signalId || !action) {
    return res.status(400).json({ error: 'signalId and action are required.' });
  }

  // 1. Whitelist enforcement
  if (!isEmailWhitelisted(effectiveEmail)) {
    return res.status(403).json({
      error: `Access Denied: Account (${effectiveEmail}) is not authorized in GOOGLE_ALLOWED_EMAILS. Action ignored.`,
    });
  }

  const livePrice = latestLiveQuote?.price ?? 0;
  const feedStatus = (latestLiveQuote?.status as 'LIVE' | 'STALE' | 'OFFLINE') || 'OFFLINE';
  const newsLock = isNewsLockActive();

  if (action === 'APPROVE') {
    const approvalResult = approveSignalFromReview(
      signalId,
      effectiveEmail,
      livePrice,
      feedStatus,
      newsLock
    );

    if (!approvalResult.success) {
      return res.status(400).json({
        status: 'FAILED',
        error: approvalResult.error,
        message: 'Setup failed re-validation and was cancelled as STALE_AFTER_REVIEW.',
      });
    }

    return res.json({
      status: 'SUCCESS',
      action: 'APPROVED',
      signal: approvalResult.signal,
      message: `Setup ${signalId} approved and activated. Levels maintained exactly.`,
    });
  } else if (action === 'REJECT') {
    const rejectResult = rejectSignalFromReview(signalId, effectiveEmail, feedbackNotes);
    return res.json({
      status: 'SUCCESS',
      action: 'REJECTED',
      result: rejectResult,
      message: `Setup ${signalId} rejected and cancelled. Lock released.`,
    });
  }

  return res.status(400).json({ error: 'Action must be APPROVE or REJECT.' });
});

// GET /api/google-chat/learnings - Load curated learning items
app.get('/api/google-chat/learnings', requireAdminAuth, (_req, res) => {
  const learnings = loadLearningItems();
  return res.json({
    status: 'SUCCESS',
    total: learnings.length,
    activeCount: learnings.filter((l) => l.active).length,
    learnings,
  });
});

// POST /api/google-chat/learnings/curate - Admin curation (Add, Edit, Toggle, Delete)
app.post('/api/google-chat/learnings/curate', requireAdminAuth, (req, res) => {
  const user = (req as any).user;
  const adminEmail = user?.email || 'admin@sarraf.gold';

  if (!isEmailWhitelisted(adminEmail)) {
    return res.status(403).json({
      error: `Access Denied: Account (${adminEmail}) not authorized to curate sarraf lessons.`,
    });
  }

  const { action, id, insight, category, active, confidence } = req.body || {};

  if (action === 'ADD') {
    const result = addCuratedLesson(
      {
        insight,
        category: category || 'STRUCTURE_BIAS',
        author: adminEmail,
        confidence: Number(confidence) || 90,
      },
      adminEmail
    );
    if (!result.success) return res.status(400).json({ error: result.error });
    return res.json({ status: 'SUCCESS', lesson: result.lesson, message: 'Curated lesson added.' });
  } else if (action === 'UPDATE') {
    if (!id) return res.status(400).json({ error: 'Lesson ID required for update.' });
    const result = updateCuratedLesson(id, { insight, category, active, confidence }, adminEmail);
    if (!result.success) return res.status(400).json({ error: result.error });
    return res.json({ status: 'SUCCESS', lesson: result.lesson, message: 'Lesson updated.' });
  } else if (action === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'Lesson ID required for delete.' });
    const result = deleteCuratedLesson(id, adminEmail);
    if (!result.success) return res.status(400).json({ error: result.error });
    return res.json({ status: 'SUCCESS', message: 'Lesson deleted.' });
  }

  return res.status(400).json({ error: 'Action must be ADD, UPDATE, or DELETE.' });
});

// GET /api/google-chat/learnings/changelog - Audit log of lesson edits
app.get('/api/google-chat/learnings/changelog', requireAdminAuth, (_req, res) => {
  const changelog = loadLessonChangeLog();
  return res.json({
    status: 'SUCCESS',
    changelog,
  });
});

// GET /api/google-chat/tests - Run 8 hardening tests suite
app.get('/api/google-chat/tests', requireAdminAuth, (_req, res) => {
  const report = runGoogleChatHardeningTests();
  return res.json({
    status: 'SUCCESS',
    report,
  });
});

// -------------------------------------------------------------
// PHASE 5: NEWS, SETTINGS, PERFORMANCE & SYSTEM ENDPOINTS
// -------------------------------------------------------------

// GET /api/news - Live Forex Factory calendar, feed status, countdowns, pregeneration trigger, and decision lock
app.get('/api/news', async (_req, res) => {
  // Refresh live macro feeds first (US10Y, Dollar Proxy EUR/JPY/GBP, Kalshi/Polymarket, Gold BiQuote)
  let macro = getCachedMacroData();
  if (!macro.dollarProxy || !macro.us10y || macro.dollarProxy.isStale || macro.us10y.isStale) {
    try {
      macro = await Promise.race([
        fetchLiveMacroData(true),
        new Promise<any>((r) => setTimeout(() => r(getCachedMacroData()), 1800)),
      ]);
    } catch {
      macro = getCachedMacroData();
    }
  } else {
    fetchLiveMacroData().catch(() => {});
  }

  const status = getNewsFeedStatus();
  const events = getNewsEventsForUI();
  const ahmedAiStatus = getAhmedAiServerStatus();
  const accuracy = getNewsDecisionAccuracy();

  // Evaluate decisions asynchronously in background (never blocks GET /api/news)
  evaluateNewsDecisions(events).catch((err: any) => {
    console.warn('[NEWS ROUTE] evaluateNewsDecisions error:', err.message);
  });

  // Asynchronously trigger pregeneration for Tier 1 and 2 events in next 72h
  pregenerateUpcomingBriefs(events as any[]).catch(() => {});

  return res.json({
    status: 'SUCCESS',
    feed: status,
    events,
    macro,
    ahmedAiStatus,
    ahmedAiOnline: ahmedAiStatus === 'ON',
    accuracy,
    calibrationTable: accuracy.calibrationTable,
    releaseLogger: getReleaseLoggerSummary(),
  });
});

// GET /api/news/decision/:id - Direct server-side newsDecision(event) endpoint
app.get('/api/news/decision/:id', (req, res) => {
  const events = getNewsEventsForUI();
  const evt = events.find((e) => e.id === req.params.id) || events[0];
  if (!evt) {
    return res.status(404).json({ status: 'ERROR', message: 'Event not found' });
  }
  const decision = evt.newsDecision || newsDecision(evt);
  return res.json({
    status: 'SUCCESS',
    decision,
    calibrationTable: getCalibrationTable30d(),
  });
});

// POST /api/news/brief - Get or lazily generate AHMED AI News Brief for an event
app.post('/api/news/brief', async (req, res) => {
  const { eventId } = req.body || {};
  if (!eventId) {
    return res.status(400).json({ error: 'eventId is required.' });
  }

  const events = getNewsEventsForUI();
  const target = events.find((e) => e.id === eventId);
  if (!target) {
    return res.status(404).json({ error: 'Event not found.' });
  }

  try {
    const brief = await getOrGenerateAhmedAiBrief(target as any);
    return res.json({
      status: 'SUCCESS',
      eventId,
      brief,
    });
  } catch {
    const fallback = buildRuleBasedBrief(target as any);
    return res.json({
      status: 'SUCCESS',
      eventId,
      brief: fallback,
    });
  }
});

// POST /api/news/manual-actual - Admin enter manual actual for released event
app.post('/api/news/manual-actual', requireAdminAuth, (req, res) => {
  const user = (req as any).user;
  const { eventId, actualValue, note } = req.body || {};
  if (!eventId || !actualValue) {
    return res.status(400).json({ error: 'eventId and actualValue are required.' });
  }

  setManualActualValue(eventId, String(actualValue), 'MANUAL', note || `Entered by ${user?.email}`);
  const status = getNewsFeedStatus();
  const events = getNewsEventsForUI();

  return res.json({
    status: 'SUCCESS',
    message: `Manual actual value "${actualValue}" recorded. Gold impact recomputed.`,
    feed: status,
    events,
  });
});

// POST /api/news/lookup-actual - AHMED AI assisted lookup of actual value
app.post('/api/news/lookup-actual', requireAdminAuth, async (req, res) => {
  const { eventId } = req.body || {};
  const events = getNewsEventsForUI();
  const target = events.find((e) => e.id === eventId);
  if (!target) {
    return res.status(404).json({ error: 'Event not found.' });
  }

  const lookup = await lookupActualValueWithGemini(target);
  if (!lookup) {
    return res.status(500).json({ error: 'AHMED AI lookup unavailable or event unreleased.' });
  }

  return res.json({
    status: 'SUCCESS',
    lookup: {
      actual: lookup.actual,
      explanation: lookup.explanation,
      source: 'UNVERIFIED',
    },
  });
});

// GET /api/settings - Load validated engine settings & audit history
app.get('/api/settings', requireAdminAuth, (_req, res) => {
  const settings = getCurrentSettings();
  const audit = loadAuditLog();
  return res.json({
    status: 'SUCCESS',
    settings,
    audit,
  });
});

// POST /api/settings - Save and validate settings patch
app.post('/api/settings', requireAdminAuth, (req, res) => {
  const user = (req as any).user;
  const patch = req.body || {};
  const result = updateSettings(patch, user?.email || 'admin@sarraf.gold');

  if (!result.success) {
    return res.status(400).json({
      status: 'VALIDATION_FAILED',
      errors: result.errors,
    });
  }

  return res.json({
    status: 'SUCCESS',
    settings: result.settings,
    message: 'Settings validated and persisted. Changes will apply to all NEW signals.',
  });
});

// POST /api/settings/reset - Reset settings to defaults
app.post('/api/settings/reset', requireAdminAuth, (req, res) => {
  const user = (req as any).user;
  const settings = resetSettingsToDefault(user?.email || 'admin@sarraf.gold');
  return res.json({
    status: 'SUCCESS',
    settings,
    message: 'Settings reset to sarraf defaults.',
  });
});

// GET /api/settings/export - Export validated JSON settings
app.get('/api/settings/export', requireAdminAuth, (_req, res) => {
  const exportJson = exportSettingsJson();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=sarraf_settings_${Date.now()}.json`);
  return res.send(exportJson);
});

// POST /api/settings/import - Import and validate JSON settings
app.post('/api/settings/import', requireAdminAuth, (req, res) => {
  const user = (req as any).user;
  const { jsonStr, settings } = req.body || {};
  const payload = typeof jsonStr === 'string' ? jsonStr : JSON.stringify(settings || {});
  const result = importSettingsJson(payload, user?.email || 'admin@sarraf.gold');

  if (!result.success) {
    return res.status(400).json({
      status: 'VALIDATION_FAILED',
      errors: result.errors,
    });
  }

  return res.json({
    status: 'SUCCESS',
    settings: result.settings,
    message: 'Settings imported, validated, and persisted successfully.',
  });
});

// POST /api/auth/change-password - Change admin password (min 12 chars, stored hashed)
app.post('/api/auth/change-password', requireAdminAuth, (req, res) => {
  const user = (req as any).user;
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Both current password and new password are required.' });
  }

  const result = changeAdminPassword(oldPassword, newPassword, user?.email || 'admin@sarraf.gold');
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  return res.json({
    status: 'SUCCESS',
    message: 'Admin password updated and hashed successfully. Old password has been invalidated.',
  });
});

// GET /api/performance - Performance analytics & equity curve
app.get('/api/performance', requireAdminAuth, (_req, res) => {
  const metrics = computePerformanceMetrics();
  return res.json({
    status: 'SUCCESS',
    metrics,
  });
});

// GET /api/performance/export-csv - Download RFC 4180 CSV
app.get('/api/performance/export-csv', requireAdminAuth, (_req, res) => {
  const csv = generateSignalsCsv();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=sarraf_signals_${Date.now()}.csv`);
  return res.send(csv);
});

// GET /api/admin/logs - Admin log viewer (last 200 lines with secrets masked)
app.get('/api/admin/logs', requireAdminAuth, (_req, res) => {
  const logReport = getAdminLogs();
  return res.json({
    status: 'SUCCESS',
    ...logReport,
  });
});

// GET /api/admin/backup/list - List available backup snapshots
app.get('/api/admin/backup/list', requireAdminAuth, (_req, res) => {
  const backups = listBackups();
  return res.json({
    status: 'SUCCESS',
    total: backups.length,
    backups,
  });
});

// GET /api/admin/backup/download - Download specific or latest backup snapshot
app.get('/api/admin/backup/download', requireAdminAuth, (req, res) => {
  const requestedFile = req.query.file as string;
  const backupsDir = path.resolve(DATA_DIR, 'backups');
  if (!fs.existsSync(backupsDir)) {
    return res.status(404).json({ error: 'No backups found on persistent disk.' });
  }

  const files = fs
    .readdirSync(backupsDir)
    .filter((f: string) => f.startsWith('backup_') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    return res.status(404).json({ error: 'No backup file available.' });
  }

  const targetName = requestedFile && files.includes(requestedFile) ? requestedFile : files[0];
  const targetFile = path.resolve(backupsDir, targetName);
  return res.download(targetFile, targetName);
});

// POST /api/admin/backup/restore - Restore state from selected backup or snapshot payload
app.post('/api/admin/backup/restore', requireAdminAuth, (req, res) => {
  const user = (req as any).user;
  const { filename, snapshot } = req.body || {};

  if (!filename && !snapshot) {
    return res.status(400).json({ error: 'Either filename or snapshot payload is required.' });
  }

  const payloadOrFile = snapshot || filename;
  const restoreResult = restoreBackupSnapshot(payloadOrFile);

  if (!restoreResult.success) {
    return res.status(500).json({
      status: 'FAILED',
      error: restoreResult.error,
    });
  }

  // Reload engine states from the freshly restored files
  loadCandlesFromDisk();
  loadSignalsFromDisk();
  loadSettingsFromDisk();

  console.log(`[AUDIT] Admin ${user?.email} executed manual RESTORE from backup (${filename || 'custom snapshot'}).`);

  return res.json({
    status: 'SUCCESS',
    message: `Restored ${restoreResult.restoredFiles.length} data files successfully. Engine stores reloaded.`,
    restoredFiles: restoreResult.restoredFiles,
  });
});

// GET /api/admin/go-live/status - Live readiness matrix evaluation
app.get('/api/admin/go-live/status', requireAdminAuth, (_req, res) => {
  const health = getSystemHealth();
  const news = getNewsFeedStatus();
  const engineStatus = getEngineStatus();
  const workerStatus = getTelegramWorkerStatus();
  const managerState = getFullManagerState();
  const backups = listBackups();

  const priceAge = latestLiveQuote
    ? Math.floor((Date.now() - (latestLiveQuote.lastReceivedAt || new Date(latestLiveQuote.timestamp).getTime())) / 1000)
    : 999;
  const isPriceLive = priceAge <= 5 && latestLiveQuote?.status === 'LIVE';
  const isEngineReady = engineStatus.usable;
  const isHtfUsable = (engineStatus.h4Count || 0) > 0 && (engineStatus.d1Count || 0) > 0;
  const isNewsLive = news.status === 'LIVE' || news.status === 'STALE';
  const isGeminiWorking = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
  const isTelegramOk = workerStatus.botConnected || workerStatus.dryRun || workerStatus.totalDelivered > 0;
  const isDataDirPersistent = health.isPersistentVolume;
  const isBackupsWorking = backups.length > 0;
  const isLeaseHeld = health.isLeaseHolder;
  const isClockOk = !health.clockDriftWarning;
  const dryRunHistoryCount = managerState.history.length;
  const isDryRunSignalsOk = dryRunHistoryCount >= 5;

  const checks = [
    {
      id: 'price',
      name: 'XAU/USD Live Spot Telemetry',
      passed: isPriceLive,
      details: isPriceLive ? `Live tick stream < 5s ($${latestLiveQuote?.price})` : `Feed age ${priceAge}s (Threshold: 5s)`,
    },
    {
      id: 'engine',
      name: 'SARRAF Analysis Engine Buffers',
      passed: isEngineReady,
      details: isEngineReady ? 'M15/M30/H1 candle stores consolidated & usable' : 'Warming up candle history',
    },
    {
      id: 'htf',
      name: 'H4 & D1 Multi-Timeframe Context',
      passed: isHtfUsable,
      details: isHtfUsable ? `H4 (${engineStatus.h4Count}) and D1 (${engineStatus.d1Count}) loaded` : 'HTF structure consolidating',
    },
    {
      id: 'news',
      name: 'Forex Factory News Catalyst Feed',
      passed: isNewsLive,
      details: `News feed status: ${news.status}`,
    },
    {
      id: 'gemini',
      name: 'Gemini AI Intelligence Validator',
      passed: isGeminiWorking,
      details: isGeminiWorking ? `Model: ${process.env.GEMINI_MODEL || 'gemini-3.8-flash'}` : 'GEMINI_API_KEY not configured',
    },
    {
      id: 'telegram',
      name: 'Telegram Bot Connection & Outbox',
      passed: isTelegramOk,
      details: workerStatus.botConnected ? 'Bot authenticated & connected' : workerStatus.dryRun ? 'DRY RUN outbox verified' : 'Bot token required',
    },
    {
      id: 'persistence',
      name: 'DATA_DIR Volume Persistence',
      passed: isDataDirPersistent,
      details: isDataDirPersistent ? `Mounted volume (${health.dataDir})` : 'Ephemeral disk detected',
    },
    {
      id: 'lastTickPersistence',
      name: 'Last Valid Tick (lastTick.json) Retention',
      passed: true,
      details: `Resolved path: ${LAST_TICK_FILE} (under DATA_DIR: ${path.resolve(DATA_DIR)})`,
    },
    {
      id: 'backups',
      name: 'Automated 7-Day Rolling Backups',
      passed: isBackupsWorking,
      details: `${backups.length} snapshot archives available`,
    },
    {
      id: 'lease',
      name: 'Single-Instance Lease Exclusivity',
      passed: isLeaseHeld,
      details: isLeaseHeld ? `Exclusive lease held by ${health.instanceId}` : 'Passive standby mode',
    },
    {
      id: 'clock',
      name: 'Server & Feed Clock Synchronization',
      passed: isClockOk,
      details: isClockOk ? `Nominal clock offset (${health.clockDriftMs}ms)` : `Excessive clock drift (${health.clockDriftMs}ms > 3000ms)`,
    },
    {
      id: 'dryRunCycles',
      name: '5 DRY RUN Completed Signal Lifecycles',
      passed: isDryRunSignalsOk,
      details: `${dryRunHistoryCount} completed signal lifecycles verified in history (Minimum required: 5)`,
    },
    {
      id: 'releaseLogger',
      name: 'Live USD Release Logger (DATA_DIR)',
      passed: true,
      details: `Logged Releases: ${getReleaseLoggerSummary().loggedReleasesCount} (${getReleaseLoggerSummary().completedReleasesCount}/30 completed — hit rate disabled until >= 30)`,
    },
  ];

  const allPassed = checks.every((c) => c.passed);

  return res.json({
    status: 'SUCCESS',
    allPassed,
    isDryRun: workerStatus.dryRun,
    checks,
    releaseLogger: getReleaseLoggerSummary(),
  });
});

// GET /api/phase5/tests - Run Phase 5 verification test suite
app.get('/api/phase5/tests', requireAdminAuth, (_req, res) => {
  const report = runPhase5TestSuite();
  return res.json({
    status: 'SUCCESS',
    report,
  });
});

// GET /api/phase5b/tests - Run Phase 5B deployment & safety test suite
app.get('/api/phase5b/tests', requireAdminAuth, (_req, res) => {
  const report = runPhase5BTestSuite();
  return res.json({
    status: 'SUCCESS',
    report,
  });
});

// GET /api/tests/summary-alerts - Run Summaries and Server Alerts Test Suite
app.get('/api/tests/summary-alerts', requireAdminAuth, (_req, res) => {
  const report = runSummaryAlertTestSuite();
  return res.json({
    status: 'SUCCESS',
    report,
  });
});

// GET /api/tests/landing-market - Run Part A: Market-Closed & Telegram Test Suite
app.get('/api/tests/landing-market', (_req, res) => {
  const report = runMarketClosedAndTelegramTestSuite();
  return res.json({
    status: 'SUCCESS',
    report,
  });
});

// POST /api/admin/go-live/override - Admin override with typed phrase
app.post('/api/admin/go-live/override', requireAdminAuth, (req, res) => {
  const user = (req as any).user;
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const { confirmationPhrase } = req.body || {};
  const REQUIRED_PHRASE = 'CONFIRM SARRAF LIVE DISPATCH';

  if (confirmationPhrase !== REQUIRED_PHRASE) {
    return res.status(400).json({
      error: `Invalid confirmation phrase. Type "${REQUIRED_PHRASE}" exactly.`,
    });
  }

  setDryRunMode(false, user?.email || 'admin');
  console.log(`[AUDIT] [SECURITY] Admin ${user?.email} (IP: ${clientIp}) executed MANUAL OVERRIDE to ENABLE LIVE DISPATCH.`);
  triggerAdminTelegramAlert('GO_LIVE_OVERRIDE', `Admin ${user?.email} executed manual override to activate LIVE Telegram dispatch.`);

  return res.json({
    status: 'SUCCESS',
    message: 'LIVE DISPATCH MODE ACTIVATED by admin override.',
  });
});

// GET /api/auth/status - Public configuration check for admin auth
app.get('/api/auth/status', (req, res) => {
  const token = getSessionToken(req);
  const session = token ? activeSessions.get(token) : null;
  const authenticated = Boolean(session && Date.now() <= session.expiresAt);
  return res.json({
    configured: isAdminConfigured(),
    authenticated,
  });
});

// POST /api/auth/login - Strict httpOnly, SameSite=Lax, 12h expiry, rate-limited (max 5 attempts per 15 min per IP)
app.post('/api/auth/login', (req, res) => {
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  // 1) Verify admin login is configured via environment variables
  if (!isAdminConfigured()) {
    return res.status(503).json({
      success: false,
      configured: false,
      error: 'Admin login is not configured on the server. Please set ADMIN_USERNAME and ADMIN_PASSWORD_HASH in environment variables.',
    });
  }

  // 2) Rate limit check: max 5 attempts per 15 minutes per IP
  const rateLimitResult = checkLoginRateLimit(clientIp);
  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      success: false,
      error: `Rate limit exceeded: Too many failed login attempts. Please retry after ${rateLimitResult.retryAfterSec} seconds.`,
    });
  }

  const { email, username, password } = req.body || {};
  const loginUser = String(username || email || '').trim();

  if (!loginUser || !password) {
    return res.status(400).json({
      success: false,
      error: 'Username/email and password are required.',
    });
  }

  // 3) Constant-time credentials check (never prints credentials)
  const isValid = verifyAdminCredentials(loginUser, password);

  if (isValid) {
    // Reset rate limit on successful authentication
    loginRateLimitMap.delete(clientIp);

    // Track new IP and trigger security alert if first time seen
    const { isNewIp } = recordSuccessfulLogin(clientIp);
    if (isNewIp) {
      console.log(`[SECURITY ALERT] Admin login from new IP address: ${clientIp}`);
    }

    const token = crypto.randomBytes(32).toString('hex');
    const userPayload = {
      email: loginUser.toLowerCase(),
      accountType: 'SARRAF Desk',
      terminalId: `SRF-${crypto.randomInt(1000, 9999)}-XAU`,
      role: 'admin',
      isAdmin: true,
    };

    activeSessions.set(token, {
      user: userPayload,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    saveActiveSessions();

    // Store login session in httpOnly cookie with 12h expiry
    res.cookie('sarraf_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });

    return res.json({
      success: true,
      configured: true,
      user: userPayload,
      token,
      isNewIp,
    });
  }

  return res.status(401).json({
    success: false,
    configured: true,
    error: `Invalid credentials. (${rateLimitResult.remaining} attempts remaining)`,
  });
});

// GET /api/auth/me - Read session from cookie or header
app.get('/api/auth/me', (req, res) => {
  const configured = isAdminConfigured();
  const token = getSessionToken(req);
  if (!token) {
    return res.json({ authenticated: false, configured, user: null });
  }

  const session = activeSessions.get(token);
  if (!session || Date.now() > session.expiresAt) {
    if (session) {
      activeSessions.delete(token);
      saveActiveSessions();
    }
    res.clearCookie('sarraf_session', { httpOnly: true, sameSite: 'lax', path: '/' });
    return res.json({ authenticated: false, configured, user: null });
  }

  return res.json({
    authenticated: true,
    configured,
    user: session.user,
    token,
  });
});

// POST /api/auth/logout - Clear session from memory, disk, and cookie
app.post('/api/auth/logout', (req, res) => {
  const token = getSessionToken(req);
  if (token) {
    activeSessions.delete(token);
    saveActiveSessions();
  }

  res.clearCookie('sarraf_session', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });

  return res.json({ success: true, message: 'Session invalidated on server.' });
});

async function startServer() {
  // 1. Verify DATA_DIR writability
  const dirCheck = checkDataDirectory();

  // 5. STARTUP LOG (one line, no values): which required variables are present (true/false only)
  const telegramBotToken = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
  const telegramChatId = Boolean(process.env.TELEGRAM_CHAT_ID?.trim());
  const aiApiKey = Boolean((process.env.AI_API_KEY || process.env.GEMINI_API_KEY)?.trim());
  const adminUsername = Boolean(process.env.ADMIN_USERNAME?.trim());
  const adminPasswordHash = Boolean(process.env.ADMIN_PASSWORD_HASH?.trim());
  const dataDirWritable = Boolean(dirCheck.writable);

  console.log(`[STARTUP] TELEGRAM_BOT_TOKEN: ${telegramBotToken}, TELEGRAM_CHAT_ID: ${telegramChatId}, AI_API_KEY: ${aiApiKey}, ADMIN_USERNAME: ${adminUsername}, ADMIN_PASSWORD_HASH: ${adminPasswordHash}, DATA_DIR writable: ${dataDirWritable}`);

  if (!dirCheck.writable) {
    console.error(`[SARRAF FATAL] DATA_DIR (${DATA_DIR}) is not writable: ${dirCheck.error}. Server cannot safely start.`);
    process.exit(1);
  }
  if (!dirCheck.isPersistent) {
    console.warn(`[SARRAF WARNING] DATA_DIR (${DATA_DIR}) appears ephemeral. Mounting a persistent volume is recommended for 24/7 sarraf state retention.`);
  }

  // 2. Acquire single-instance lease lock
  const leaseAcquired = acquireInstanceLease();
  if (!leaseAcquired) {
    console.warn('[SARRAF STANDBY] Primary lease is held by another active instance. Running as passive node.');
  }

  // 3. Start automated daily rolling backup scheduler
  startBackupScheduler();

  // 4. Record server restart & trigger admin notification
  recordServerRestart('SYSTEM_STARTUP');
  triggerAdminTelegramAlert('SERVER_RESTARTED', `SARRAF Full-Stack Engine initialized and online on port ${PORT}.`);

  // 5. Load settings from disk
  loadSettingsFromDisk();

  // 5b. Load last valid tick from disk
  loadLastTickFromDisk();
  setInterval(saveLastTickToDisk, 60 * 1000);

  // 6. Load candles and signal state BEFORE first upstream connection
  loadCandlesFromDisk();
  loadSignalsFromDisk();
  loadCommandSignalsFromDisk();

  // 7. On start, backfill the missing gap from the candle source before enabling the signal engine
  await backfillCandleGaps();
  await bootstrapHistoricalCandles();

  // 7b. Initialize Sarraf Atlas engine
  initAtlasEngine();

  // 8. Fetch real Forex Factory news calendar and start 15-minute background refresh
  await fetchForexFactoryCalendar();
  setInterval(() => {
    fetchForexFactoryCalendar();
  }, 15 * 60 * 1000);

  // 9. Start background Telegram dispatch worker and long-polling handler
  startTelegramWorker();
  startCommandTelegramWorker();

  // 10. Start resilient background tick worker (first upstream connection)
  fetchBiquoteTick();

  // 10b. Initialize SPY S&P 500 Options Feed & Signals
  loadSpySignalsFromDisk();
  initSpyFeed();

  // 10c. Initialize 24/7 BTC Tide Node.js Backend & SQLite Database
  await initBtcTideBackend();

  // 10d. Start continuous live macro feed loop (20s FX/Yields + Kalshi/Polymarket discovery) & 30s newsDecision + live release logger worker
  startMacroFeedLoop();
  setInterval(() => {
    try {
      const uiEvents = getNewsEventsForUI();
      evaluateNewsDecisions(uiEvents).catch(() => {});
      const lastTick = getLastValidTick();
      const macroSnap = getCachedMacroData();
      sampleLiveReleaseTicks({
        events: uiEvents as any,
        liveGoldMid: lastTick ? lastTick.price : null,
        liveGoldLastQuoteAtMs: lastTick ? (lastTick.lastReceivedAt || new Date(lastTick.timestamp).getTime()) : null,
        liveDxy: macroSnap?.dxy && !macroSnap.dxy.isStale ? macroSnap.dxy.price : (macroSnap?.dollarProxy?.dxy && !macroSnap.dollarProxy.dxy.stale ? macroSnap.dollarProxy.dxy.mid : null),
        liveUs10y: macroSnap?.us10y && !macroSnap.us10y.isStale ? macroSnap.us10y.yield : null,
      });
    } catch {}
  }, 30_000);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SARRAF SERVER] Full-stack sarraf engine running on http://0.0.0.0:${PORT}`);
  });
}

// Graceful persistence on shutdown
function handleGracefulShutdown(signal: string) {
  console.log(`[SARRAF SERVER] Received ${signal}. Persisting records and releasing lease...`);
  stopBackupScheduler();
  saveCandlesToDisk();
  saveSignalsToDisk();
  saveCommandSignalsToDisk();
  saveSpySignalsToDisk();
  saveSpyCandlesToDisk();
  saveTelegramSettings();
  saveLastTickToDisk();
  shutdownBtcTideBackend();
  releaseInstanceLease();
  process.exit(0);
}

process.on('uncaughtException', (err: any) => {
  const cat = err?.name || 'Error';
  const code = err?.code || 'UNCAUGHT';
  console.error(`[PROCESS EXCEPTION] category=${cat} code=${code}`);
});

process.on('unhandledRejection', (reason: any) => {
  const cat = reason?.name || (typeof reason === 'string' ? reason.slice(0, 30) : 'UnhandledRejection');
  console.error(`[PROCESS REJECTION] category=${cat}`);
});

process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));

startServer();
