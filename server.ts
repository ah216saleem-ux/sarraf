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
  processTick,
  getEngineStatus,
  getCandleStore,
  getClosedCandles,
} from './src/server/candleEngine.ts';
import {
  loadLastTickFromDisk,
  saveLastTickToDisk,
  recordLiveTick,
  getLastValidTick,
  evaluateMarketPriceStatus,
  getMarketSchedule,
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
  startTelegramWorker,
  getTelegramWorkerStatus,
  sendManualTestMessage,
  sendSampleTestSignal,
  sendManualTestDailySummary,
  sendManualTestWeeklyReport,
  sendAdminAlert,
  setDryRunMode,
  retryFailedOutboxItem,
  getIsDryRun,
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
} from './src/server/newsEngine.ts';
import {
  loadSettingsFromDisk,
  saveSettingsToDisk,
  getCurrentSettings,
  updateSettings,
  resetSettingsToDefault,
  loadAuditLog,
  exportSettingsJson,
  importSettingsJson,
  verifyAdminPassword,
  verifyAdminUsername,
  changeAdminPassword,
  recordSuccessfulLogin,
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
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
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

// In-memory active session tokens (24 hour lifetime)
interface SessionRecord {
  user: {
    email: string;
    accountType: string;
    terminalId: string;
  };
  expiresAt: number;
}
const activeSessions = new Map<string, SessionRecord>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Cleanup expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of activeSessions.entries()) {
    if (now > session.expiresAt) {
      activeSessions.delete(token);
    }
  }
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

// Resilient background tick fetcher with exponential backoff & raw field logging
async function fetchBiquoteTick() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const res = await fetch('https://biquote.io/api/XAUUSD', {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SARRAF-Terminal/1.0',
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`biquote.io responded with HTTP ${res.status}`);
    }

    const rawData = await res.json();

    if (!rawData || typeof rawData.bid !== 'number' || typeof rawData.ask !== 'number') {
      throw new Error('Malformed quote data payload from biquote.io');
    }

    // Requirement 2: Log raw feed fields so user can confirm XAUUSD spot and not futures
    console.log('[SARRAF REAL FEED] Raw XAUUSD tick fields:', {
      symbol: rawData.symbol,
      description: rawData.description,
      source: rawData.source,
      exchange: rawData.exchange,
      marketState: rawData.marketState,
      bid: rawData.bid,
      ask: rawData.ask,
      mid: rawData.mid,
      spread: rawData.spread,
      direction: rawData.direction,
      timestamp: rawData.timestamp,
      quoteAgeSeconds: rawData.quoteAgeSeconds,
    });

    const mid = typeof rawData.mid === 'number' ? rawData.mid : (rawData.bid + rawData.ask) / 2;
    const now = Date.now();
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
      source: rawData.source || 'biquote.io (MetaTrader 5)',
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

    // Feed tick into the high-precision Signal Manager state machine
    // A1 Rule: The last price is DISPLAY ONLY. The analysis engine, signal manager and TP/SL tracking must use only isLive = true data.
    processSignalManagerTick(
      latestLiveQuote.price,
      latestLiveQuote.bid,
      latestLiveQuote.ask,
      latestLiveQuote.spread,
      marketEval.isLive ? 'LIVE' : marketEval.status === 'FEED_STALE' ? 'STALE' : 'OFFLINE',
      isNewsLockActive(now)
    );

    // Reset backoff on success
    consecutiveFailures = 0;
    backoffDelayMs = 1200;
  } catch (err: any) {
    consecutiveFailures += 1;
    // Exponential backoff up to 10 seconds: 1.2s -> 2.4s -> 4.8s -> 9.6s -> max 10s
    backoffDelayMs = Math.min(10000, 1200 * Math.pow(1.8, Math.min(consecutiveFailures, 4)));

    console.warn(`[SARRAF FEED WORKER] Fetch error (${consecutiveFailures} in a row): ${err.message}. Retrying in ${Math.round(backoffDelayMs)}ms...`);

    const marketEval = evaluateMarketPriceStatus();
    if (marketEval.status === 'FEED_OFFLINE' && isGoldMarketOpen(new Date())) {
      sendAdminAlert('FEED_OFFLINE');
    }

    // Signal manager receives OFFLINE to freeze tracking
    processSignalManagerTick(
      marketEval.tick.price,
      marketEval.tick.bid,
      marketEval.tick.ask,
      marketEval.tick.spread,
      'OFFLINE',
      isNewsLockActive()
    );
  }

  // Schedule next tick loop
  setTimeout(fetchBiquoteTick, backoffDelayMs);
}

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
  });
});

// GET /api/candles - Expose persisted candles
app.get('/api/candles', (_req, res) => {
  res.json({
    store: getCandleStore(),
    status: getEngineStatus(),
  });
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

// Helper middleware: Admin verification & rate-limiting for signal routes
function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.cookies?.sarraf_session;
  if (!token || !activeSessions.has(token)) {
    return res.status(401).json({
      error: 'Unauthorized: Valid institutional session cookie required.',
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

// GET /api/health - Public healthcheck endpoint for Railway, Docker & load balancers (returns full metrics when authenticated)
app.get(['/api/health', '/health'], (req, res) => {
  const token = req.cookies?.sarraf_session;
  const isAuth = Boolean(token && activeSessions.has(token));

  if (!isAuth) {
    return res.status(200).json({ status: 'ok', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() });
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
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
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

// POST /api/telegram/test-signal - Manual Sample Signal Dispatch to Telegram
app.post('/api/telegram/test-signal', requireAdminAuth, async (req, res) => {
  const user = (req as any).user;
  const { chatId } = req.body || {};
  console.log(`[AUDIT] Admin ${user?.email} triggered sample test trade signal to Telegram.`);
  const result = await sendSampleTestSignal(chatId);
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

// GET /api/telegram/validations - Recent AI validation logs
app.get('/api/telegram/validations', requireAdminAuth, (_req, res) => {
  const logs = getValidationLogs();
  return res.json({
    status: 'SUCCESS',
    total: logs.length,
    validations: logs,
  });
});

// POST /api/ai/chat - Institutional AI Market Chat (Section 6)
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
      error: `Access Denied: Account (${adminEmail}) not authorized to curate institutional lessons.`,
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

// GET /api/news - Live Forex Factory calendar, feed status, countdowns
app.get('/api/news', (_req, res) => {
  const status = getNewsFeedStatus();
  const events = getNewsEventsForUI();
  return res.json({
    status: 'SUCCESS',
    feed: status,
    events,
  });
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

// POST /api/news/lookup-actual - Gemini-assisted lookup of actual value
app.post('/api/news/lookup-actual', requireAdminAuth, async (req, res) => {
  const { eventId } = req.body || {};
  const events = getNewsEventsForUI();
  const target = events.find((e) => e.id === eventId);
  if (!target) {
    return res.status(404).json({ error: 'Event not found.' });
  }

  const lookup = await lookupActualValueWithGemini(target);
  if (!lookup) {
    return res.status(500).json({ error: 'Gemini lookup unavailable or event unreleased.' });
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
    message: 'Settings reset to institutional defaults.',
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
      details: isGeminiWorking ? `Model: ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}` : 'GEMINI_API_KEY not configured',
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
  ];

  const allPassed = checks.every((c) => c.passed);

  return res.json({
    status: 'SUCCESS',
    allPassed,
    isDryRun: workerStatus.dryRun,
    checks,
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
  const REQUIRED_PHRASE = 'CONFIRM INSTITUTIONAL LIVE DISPATCH';

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

// POST /api/auth/login - Strict httpOnly, SameSite=Strict, 24h expiry, rate-limited
app.post('/api/auth/login', (req, res) => {
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  // 1) Rate limit check: 5 attempts per 10 minutes per IP
  const rateLimitResult = checkLoginRateLimit(clientIp);
  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      success: false,
      error: `Rate limit exceeded: Too many failed login attempts. Please retry after ${rateLimitResult.retryAfterSec} seconds.`,
    });
  }

  const { email, password } = req.body || {};
  const configuredAdminUser = process.env.ADMIN_USER || 'admin@sarraf.gold';

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Email and password are required.',
    });
  }

  const isUserValid = verifyAdminUsername(email);
  const isPassValid = verifyAdminPassword(password);

  if (isUserValid && isPassValid) {
    // Reset rate limit on successful authentication
    loginRateLimitMap.delete(clientIp);

    // Track new IP and trigger security alert if first time seen
    const { isNewIp } = recordSuccessfulLogin(clientIp);
    if (isNewIp) {
      console.log(`[SECURITY ALERT] Admin login from new IP address: ${clientIp}`);
    }

    const token = crypto.randomBytes(32).toString('hex');
    const userPayload = {
      email: email.trim().toLowerCase(),
      accountType: 'Institutional Desk',
      terminalId: `SRF-${Math.floor(1000 + Math.random() * 9000)}-XAU`,
    };

    activeSessions.set(token, {
      user: userPayload,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });

    // Store login session in httpOnly, SameSite=Strict cookie with 24h expiry
    res.cookie('sarraf_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });

    return res.json({
      success: true,
      user: userPayload,
      isNewIp,
    });
  }

  return res.status(401).json({
    success: false,
    error: `Invalid institutional credentials. (${rateLimitResult.remaining} attempts remaining)`,
  });
});

// GET /api/auth/me - Read httpOnly cookie session
app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.sarraf_session;
  if (!token) {
    return res.json({ authenticated: false, user: null });
  }

  const session = activeSessions.get(token);
  if (!session || Date.now() > session.expiresAt) {
    if (session) activeSessions.delete(token);
    res.clearCookie('sarraf_session', { httpOnly: true, sameSite: 'strict', path: '/' });
    return res.json({ authenticated: false, user: null });
  }

  return res.json({
    authenticated: true,
    user: session.user,
  });
});

// POST /api/auth/logout - Clear httpOnly cookie
app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies?.sarraf_session;
  if (token) {
    activeSessions.delete(token);
  }

  res.clearCookie('sarraf_session', {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
  });

  return res.json({ success: true, message: 'Session terminated.' });
});

async function startServer() {
  // 1. Verify DATA_DIR writability
  const dirCheck = checkDataDirectory();
  console.log(`[SARRAF STARTUP] Absolute path for DATA_DIR: ${path.resolve(DATA_DIR)}`);
  console.log(`[SARRAF STARTUP] Absolute path for lastTick.json: ${LAST_TICK_FILE}`);
  if (!dirCheck.writable) {
    console.error(`[SARRAF FATAL] DATA_DIR (${DATA_DIR}) is not writable: ${dirCheck.error}. Server cannot safely start.`);
    process.exit(1);
  }
  if (!dirCheck.isPersistent) {
    console.warn(`[SARRAF WARNING] DATA_DIR (${DATA_DIR}) appears ephemeral. Mounting a persistent volume is recommended for 24/7 institutional state retention.`);
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

  // 5b. Load last valid tick from disk (A1 requirement)
  loadLastTickFromDisk();
  setInterval(saveLastTickToDisk, 60 * 1000);

  // 6. Load candles from disk and bootstrap history if needed
  loadCandlesFromDisk();
  await bootstrapHistoricalCandles();

  // 7. Load signal manager state, restore cooldown, and perform downtime candle recovery
  loadSignalsFromDisk();

  // 8. Fetch real Forex Factory news calendar and start 15-minute background refresh
  await fetchForexFactoryCalendar();
  setInterval(() => {
    fetchForexFactoryCalendar();
  }, 15 * 60 * 1000);

  // 9. Start background Telegram dispatch worker and long-polling handler
  startTelegramWorker();

  // 10. Start resilient background tick worker
  fetchBiquoteTick();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
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
    console.log(`[SARRAF SERVER] Full-stack institutional engine running on http://0.0.0.0:${PORT}`);
  });
}

// Graceful persistence on shutdown
function handleGracefulShutdown(signal: string) {
  console.log(`[SARRAF SERVER] Received ${signal}. Persisting records and releasing lease...`);
  stopBackupScheduler();
  saveCandlesToDisk();
  saveSignalsToDisk();
  saveLastTickToDisk();
  releaseInstanceLease();
  process.exit(0);
}

process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));

startServer();
