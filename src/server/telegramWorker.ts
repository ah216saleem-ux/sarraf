import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  formatNewSignalMessage,
  formatUpdateMessage,
  formatCooldownLine,
  formatAdminAlert,
  formatDailySummary,
  formatWeeklyReport,
  formatCommandResponse,
  DailySummaryData,
  WeeklyReportData,
  AdminAlertType,
} from './messageTemplates.ts';
import { validateSignalWithGemini } from './geminiValidator.ts';
import {
  getFullManagerState,
  saveSignalsToDisk,
  enterCooldown,
  getSignalStats,
  pauseSignalManager,
  resumeSignalManager,
  getSignalManagerPublicState,
  SignalRecord,
} from './signalManager.ts';
import { getClosedCandles, getEngineStatus, getCandleStore } from './candleEngine.ts';
import { evaluateStructureBias, isGoldMarketOpen } from './sarrafEngine.ts';
import { getCurrentSettings, updateSettings, verifyAdminUsername, verifyAdminPassword } from './settingsEngine.ts';
import { getNewsFeedStatus, checkNewsLockState } from './newsEngine.ts';

import { DATA_DIR } from "./deploymentSafety.ts";
import {
  isChatAdmin,
  isChatApproved,
  getSubscriber,
  registerAdminChat,
  upsertUserRequest,
  setSubscriberStatus,
  getAllAdmins,
  getAllApprovedRecipients,
  getAllSubscribersList,
} from "./telegramSubscribers.ts";
import { getBackendSnapshot } from "./btcTideBackendEngine.ts";
import { getAtlasState } from "../../server/atlas/atlasEngine.ts";
import { processCommandOutbox } from "./commandTelegramService.ts";

const OUTBOX_FILE = path.resolve(DATA_DIR, 'outbox.json');
const THREAD_MAP_FILE = path.resolve(DATA_DIR, 'telegram_threads.json');
const DYNAMIC_CHAT_FILE = path.resolve(DATA_DIR, 'telegram_chat.json');

let dynamicChatId: string | null = null;

export function isInvalidTelegramChatId(id?: string | number | null): boolean {
  if (!id) return true;
  const str = String(id).trim().toLowerCase();
  return (
    str === '' ||
    str === '@sarraftelegrambot' ||
    str === 'sarraftelegrambot' ||
    str === '8737269513' ||
    str === 'my_telegram_chat_id' ||
    str === 'your_chat_id' ||
    str === 'undefined' ||
    str === 'null'
  );
}

export function getEffectiveTelegramChatId(): string | null {
  const dyn = getDynamicTelegramChatId();
  if (dyn && !isInvalidTelegramChatId(dyn)) {
    return dyn;
  }
  const envChat = process.env.TELEGRAM_CHAT_ID;
  if (envChat && !isInvalidTelegramChatId(envChat)) {
    return envChat;
  }
  return null;
}

export function getDynamicTelegramChatId(): string | null {
  if (dynamicChatId && !isInvalidTelegramChatId(dynamicChatId)) return dynamicChatId;
  if (fs.existsSync(DYNAMIC_CHAT_FILE)) {
    try {
      const data = fs.readFileSync(DYNAMIC_CHAT_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed.chatId === 'string' && !isInvalidTelegramChatId(parsed.chatId)) {
        dynamicChatId = parsed.chatId;
        return dynamicChatId;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export function setDynamicTelegramChatId(id: string | number) {
  if (isInvalidTelegramChatId(id)) {
    console.warn(`[TELEGRAM WORKER] Ignored invalid target chat ID: ${id}`);
    return;
  }
  const cleanId = String(id).trim();
  dynamicChatId = cleanId;
  try {
    ensureDataDir();
    fs.writeFileSync(
      DYNAMIC_CHAT_FILE,
      JSON.stringify({ chatId: cleanId, registeredAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
    console.log(`[TELEGRAM WORKER] Dynamic target chat ID updated to: ${cleanId}`);

    // Auto-unblock any outbox events that failed due to self-bot or unbound chat ID
    try {
      const outbox = readOutbox();
      let updated = false;
      for (const item of outbox) {
        if (
          item.status === 'FAILED' &&
          (item.lastError?.includes("Forbidden: the bot can't send messages to the bot") ||
            item.lastError?.includes('unbound') ||
            item.lastError?.includes('unconfigured') ||
            item.lastError?.includes('chat ID'))
        ) {
          item.status = 'PENDING_DELIVERY';
          item.retryCount = 0;
          item.lastError = undefined;
          updated = true;
        }
      }
      if (updated) {
        writeOutbox(outbox);
        setTimeout(() => triggerOutboxProcessing(), 300);
      }
    } catch {
      // ignore
    }
  } catch (err: any) {
    console.error('[TELEGRAM WORKER] Failed to save dynamic chat ID:', err.message);
  }
}

export interface OutboxRecord {
  eventId: string;
  signalId: string;
  type: string;
  payload: Record<string, any>;
  createdAt: string;
  status: 'PENDING_DELIVERY' | 'SENT' | 'FAILED';
  deliveryMode?: 'LIVE' | 'DRY_RUN';
  telegramMessageId?: number;
  retryCount?: number;
  lastAttemptAt?: string;
  lastError?: string;
  messageText?: string;
}

export interface TelegramWorkerStatus {
  botConnected: boolean;
  botUsername?: string;
  dryRun: boolean;
  targetChatIdMasked: string;
  lastMessageSentAt?: string;
  lastError?: string;
  pendingCount: number;
  sentCount: number;
  failedCount: number;
  totalDelivered: number;
  recentMessages: OutboxRecord[];
}

let isWorkerRunning = false;
let updatePollingOffset = 0;
let signalThreadMap: Record<string, number> = {}; // signalId -> telegram message_id
// Controlled dynamically via settings.dryRun
let lastAdminAlertTimes: Record<string, number> = {};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Load thread map (persists message_id mappings across server restarts)
function loadThreadMap() {
  ensureDataDir();
  if (fs.existsSync(THREAD_MAP_FILE)) {
    try {
      const data = fs.readFileSync(THREAD_MAP_FILE, 'utf-8');
      signalThreadMap = JSON.parse(data) || {};
    } catch {
      signalThreadMap = {};
    }
  }
}

function saveThreadMap() {
  try {
    ensureDataDir();
    fs.writeFileSync(THREAD_MAP_FILE, JSON.stringify(signalThreadMap, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[TELEGRAM WORKER] Failed to save thread map:', err.message);
  }
}

// Read outbox atomically
export function readOutbox(): OutboxRecord[] {
  ensureDataDir();
  if (!fs.existsSync(OUTBOX_FILE)) return [];
  try {
    const data = fs.readFileSync(OUTBOX_FILE, 'utf-8');
    return JSON.parse(data) || [];
  } catch {
    return [];
  }
}

// Save outbox atomically
export function writeOutbox(items: OutboxRecord[]) {
  ensureDataDir();
  const tmp = `${OUTBOX_FILE}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf-8');
  fs.renameSync(tmp, OUTBOX_FILE);
}

// Mask secret token/chat IDs for safety
export function maskIdentifier(val?: string): string {
  if (!val || val.length <= 4) return '****';
  return `****${val.slice(-4)}`;
}

const deliveredTelegramKeys = new Map<string, { messageId?: number; deliveredAt: number }>();
const inFlightTelegramRequests = new Map<
  string,
  Promise<{ success: boolean; messageId?: number; error?: string; retryAfterSec?: number; nonRetryable?: boolean }>
>();

// Send HTTP message to Telegram API with backoff & 429 handling, supporting inline keyboards, parse modes, and retry duplicate protection
export async function sendTelegramHttpRequest(
  text: string,
  replyToMessageId?: number,
  targetChatId?: string | number,
  replyMarkup?: any,
  parseMode?: 'HTML' | 'Markdown',
  idempotencyKey?: string
): Promise<{ success: boolean; messageId?: number; error?: string; retryAfterSec?: number; nonRetryable?: boolean }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const effectiveChat = targetChatId ? String(targetChatId) : getEffectiveTelegramChatId();

  if (!token || token === '123456789:ABCdefGhIJKlmNoPQRstuVWXyz') {
    return { success: false, error: 'Telegram bot token unconfigured.', nonRetryable: true };
  }

  if (!effectiveChat || isInvalidTelegramChatId(effectiveChat)) {
    return {
      success: false,
      error: "Telegram target chat ID is not registered or is set to the bot's own username (@Sarraftelegrambot). Send /start to @Sarraftelegrambot in Telegram or set your numeric Chat ID in dashboard settings.",
      nonRetryable: true,
    };
  }

  const now = Date.now();
  // Prune expired entries
  for (const [k, v] of deliveredTelegramKeys.entries()) {
    const ttl = k.startsWith('idemp:') ? 24 * 60 * 60 * 1000 : 60 * 1000;
    if (now - v.deliveredAt > ttl) {
      deliveredTelegramKeys.delete(k);
    }
  }

  const dedupeKey = idempotencyKey
    ? `idemp:${effectiveChat}:${idempotencyKey}`
    : `hash:${effectiveChat}:${replyToMessageId || 0}:${text.trim()}`;

  const alreadyDelivered = deliveredTelegramKeys.get(dedupeKey);
  if (alreadyDelivered) {
    console.log(`[TELEGRAM DEDUPE] Skipping duplicate retry send for already-delivered key (${idempotencyKey || 'content-hash'})`);
    return { success: true, messageId: alreadyDelivered.messageId };
  }

  const existingInFlight = inFlightTelegramRequests.get(dedupeKey);
  if (existingInFlight) {
    console.log(`[TELEGRAM DEDUPE] Joining in-flight Telegram request (${idempotencyKey || 'content-hash'}) instead of sending duplicate`);
    return existingInFlight;
  }

  const requestPromise = (async () => {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body: Record<string, any> = {
      chat_id: effectiveChat,
      text,
      disable_web_page_preview: true,
    };

    if (replyToMessageId) {
      body.reply_to_message_id = replyToMessageId;
    }

    if (replyMarkup) {
      body.reply_markup = replyMarkup;
    }

    if (parseMode) {
      body.parse_mode = parseMode;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const data = await res.json();

      if (res.status === 429) {
        const retryAfter = data.parameters?.retry_after || 5;
        return { success: false, error: `Telegram Rate Limited (429). Retry after ${retryAfter}s`, retryAfterSec: retryAfter };
      }

      if (!res.ok || !data.ok) {
        const nonRetryable = res.status >= 400 && res.status < 500 && res.status !== 429;
        return { success: false, error: data.description || `HTTP ${res.status}`, nonRetryable };
      }

      const msgId = data.result?.message_id;
      deliveredTelegramKeys.set(dedupeKey, { messageId: msgId, deliveredAt: Date.now() });
      return { success: true, messageId: msgId };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network fetch error' };
    } finally {
      inFlightTelegramRequests.delete(dedupeKey);
    }
  })();

  inFlightTelegramRequests.set(dedupeKey, requestPromise);
  return requestPromise;
}

// Answer Callback Query (for interactive inline button clicks)
export async function answerTelegramCallbackQuery(
  callbackQueryId: string,
  text?: string,
  showAlert: boolean = false
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === '123456789:ABCdefGhIJKlmNoPQRstuVWXyz') return false;

  try {
    const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text || '',
        show_alert: showAlert,
      }),
    });
    return true;
  } catch {
    return false;
  }
}

// Dispatch single outbox item
async function processOutboxItem(item: OutboxRecord): Promise<void> {
  // Ignore simulated test events
  if (item.eventId.startsWith('SIM-') || item.signalId.startsWith('SIM-')) {
    item.status = 'SENT';
    item.deliveryMode = 'DRY_RUN';
    return;
  }

  const managerState = getFullManagerState();
  const engineStatus = getEngineStatus();

  // Safety check: do NOT dispatch if engine is warming up or paused
  if (engineStatus.engineState === 'WARMING UP' || managerState.isPaused || managerState.state === 'HALTED_FEED') {
    return;
  }

  // Handle SIGNAL_CREATED with Gemini validation before sending
  if (item.type === 'SIGNAL_CREATED') {
    const p = item.payload;
    const m15 = getClosedCandles('M15');
    const m30 = getClosedCandles('M30');
    const h1 = getClosedCandles('H1');
    const h4 = getClosedCandles('H4');
    const d1 = getClosedCandles('D1');

    const h1Bias = evaluateStructureBias(h1).bias;
    const h4Bias = evaluateStructureBias(h4).bias;
    const d1Bias = evaluateStructureBias(d1).bias;

    const validation = await validateSignalWithGemini({
      id: item.signalId,
      direction: p.direction,
      entry: p.entryTarget,
      sl: p.slTarget,
      tp1: p.tp1Target,
      tp2: p.tp2Target,
      tp3: p.tp3Target,
      tp4: p.tp4Target,
      score: p.score,
      currentPrice: p.entryTarget,
      m15Candles: m15,
      m30Candles: m30,
      h1Candles: h1,
      bias: { d1: d1Bias, h4: h4Bias, h1: h1Bias },
    });

    // If AI REJECTS with confidence >= 70%
    if (validation.verdict === 'REJECT' && validation.confidence >= 70) {
      console.warn(`[TELEGRAM WORKER] Signal ${item.signalId} AI_REJECTED by Gemini (${validation.confidence}% confidence: ${validation.reason}). Cancelling setup.`);

      // Discard current signal and enter 5m pause without counting toward daily 3 signals
      if (managerState.currentSignal && managerState.currentSignal.id === item.signalId) {
        managerState.currentSignal = null;
        if (managerState.dailySignalsCount > 0) {
          managerState.dailySignalsCount -= 1; // Does NOT count toward daily limit
        }
        enterCooldown(5);
        saveSignalsToDisk();
      }

      item.status = 'SENT';
      item.deliveryMode = 'DRY_RUN';
      item.lastError = `AI_REJECTED: ${validation.reason}`;
      return;
    }
  }

  // Format message text
  let messageText = '';
  const p = item.payload;

  if (item.type === 'SIGNAL_CREATED') {
    messageText = formatNewSignalMessage({
      direction: p.direction,
      entry: p.entryTarget,
      sl: p.slTarget,
      tp1: p.tp1Target,
      tp2: p.tp2Target,
      tp3: p.tp3Target,
      tp4: p.tp4Target,
    });
  } else if (item.type === 'DAILY_SUMMARY') {
    messageText = item.messageText || formatDailySummary(p as any);
  } else if (item.type === 'WEEKLY_REPORT') {
    messageText = item.messageText || formatWeeklyReport(p as any);
  } else if (item.type === 'ADMIN_ALERT') {
    messageText = item.messageText || formatAdminAlert(p.alertType);
  } else {
    messageText = formatUpdateMessage({
      type: item.type as any,
      realizedDollars: p.realizedDollars,
      slippageDollars: p.slippageDollars,
    });
  }

  item.messageText = messageText;
  item.lastAttemptAt = new Date().toISOString();

  // Check Threading - Summaries and alerts are NEVER mixed into signal threads
  const isSignalLifecycle = !['DAILY_SUMMARY', 'WEEKLY_REPORT', 'ADMIN_ALERT'].includes(item.type);
  const replyToId = isSignalLifecycle && item.type !== 'SIGNAL_CREATED' ? signalThreadMap[item.signalId] : undefined;

  // If in DRY RUN mode: log text, do not make real HTTP call
  if (getIsDryRun()) {
    console.log(`[TELEGRAM WORKER - DRY RUN] Dispatch for ${item.signalId} (${item.type}):\n${messageText}`);
    item.status = 'SENT';
    item.deliveryMode = 'DRY_RUN';
    item.telegramMessageId = Math.floor(100000 + Math.random() * 900000);

    if (item.type === 'SIGNAL_CREATED') {
      signalThreadMap[item.signalId] = item.telegramMessageId;
      saveThreadMap();
    }

    // Append cooldown line if trade closed
    if (isSignalLifecycle && ['TP4', 'SL', 'BE_STOP', 'TIMEOUT', 'MARKET_CLOSE'].includes(item.type)) {
      const cdLine = formatCooldownLine(35);
      console.log(`[TELEGRAM WORKER - DRY RUN] Follow-up Cooldown Line:\n${cdLine}`);
    }

    return;
  }

  // LIVE DISPATCH
  if (item.status === 'SENT' || item.telegramMessageId) {
    item.status = 'SENT';
    return;
  }

  const effectiveChat = getEffectiveTelegramChatId();
  if (!effectiveChat) {
    item.lastError = "Waiting for target Telegram chat registration. Open @Sarraftelegrambot and send /start or enter Chat ID in dashboard Settings.";
    console.warn(`[TELEGRAM WORKER] Holding event ${item.eventId} (${item.type}): awaiting valid Telegram chat registration.`);
    return;
  }

  const result = await sendTelegramHttpRequest(messageText, replyToId, effectiveChat, undefined, undefined, `outbox_${item.eventId}`);

  if (result.success) {
    item.status = 'SENT';
    item.deliveryMode = 'LIVE';
    if (result.messageId) {
      item.telegramMessageId = result.messageId;
    }

    if (item.type === 'SIGNAL_CREATED' && item.telegramMessageId) {
      signalThreadMap[item.signalId] = item.telegramMessageId;
      saveThreadMap();
    }

    // Send cooldown line as reply if trade closed
    if (isSignalLifecycle && ['TP4', 'SL', 'BE_STOP', 'TIMEOUT', 'MARKET_CLOSE'].includes(item.type)) {
      const cdLine = formatCooldownLine(35);
      await sendTelegramHttpRequest(cdLine, signalThreadMap[item.signalId], effectiveChat, undefined, undefined, `outbox_cd_${item.eventId}`);
    }

    console.log(`[TELEGRAM WORKER - LIVE] Delivered ${item.type} for ${item.signalId} (msg_id: ${item.telegramMessageId || 'deduped'})`);
  } else {
    item.retryCount = (item.retryCount || 0) + 1;
    item.lastError = result.error || 'Failed to dispatch';

    if (result.error && result.error.includes("the bot can't send messages to the bot")) {
      dynamicChatId = null;
      item.lastError = "Telegram Chat ID was set to bot's own handle (@Sarraftelegrambot). Please send /start in Telegram or enter your numeric Chat ID in settings.";
      console.warn(`[TELEGRAM WORKER] Event ${item.eventId} held: Bot cannot message itself. Awaiting user /start.`);
      return;
    }

    const isFatalError = result.error && (
      result.error.includes('chat not found') ||
      result.error.includes('deactivated')
    );

    if (isFatalError) {
      item.status = 'FAILED';
      console.error(`[TELEGRAM WORKER] Fatal delivery error for event ${item.eventId}: ${item.lastError}. Retries aborted.`);
      console.error(`[TELEGRAM WORKER] ADVICE: Please run the '/setchat' command or send /start in your target Telegram chat or group to register it!`);
      
      // Prevent infinite alert loop by not sending failure alerts for ALERT/ADMIN events
      if (item.type !== 'ADMIN_ALERT' && !item.eventId.startsWith('ALERT-')) {
        sendAdminAlert('TELEGRAM_FAILING');
      }
    } else if (item.retryCount >= 5) {
      item.status = 'FAILED';
      console.error(`[TELEGRAM WORKER] Permanently failed event ${item.eventId} after 5 attempts: ${item.lastError}`);
      if (item.type !== 'ADMIN_ALERT' && !item.eventId.startsWith('ALERT-')) {
        sendAdminAlert('TELEGRAM_FAILING');
      }
    } else {
      console.warn(`[TELEGRAM WORKER] Event ${item.eventId} attempt ${item.retryCount}/5 failed: ${item.lastError}`);
    }
  }
}

// Generate interactive inline keyboard for Telegram Admin Dashboard (ADMIN ONLY)
export function getMainControlKeyboard() {
  const dryRun = getIsDryRun();
  const managerState = getFullManagerState();
  const isPaused = managerState.isPaused;
  const subs = getAllSubscribersList();
  const pendingCount = subs.filter((s) => s.status === "PENDING").length;

  return {
    inline_keyboard: [
      [
        { text: "📊 Live Status", callback_data: "cmd_status" },
        { text: "⚡ Send Test Signal", callback_data: "cmd_test" },
      ],
      [
        { text: "💰 Gold Price & Bias", callback_data: "cmd_price" },
        { text: "₿ BTC Tide Live", callback_data: "cmd_btc" },
      ],
      [
        { text: "🏛️ Sarraf Atlas Zones", callback_data: "cmd_atlas" },
        { text: "📈 Active & History", callback_data: "cmd_signals" },
      ],
      [
        {
          text: pendingCount > 0 ? `👥 Users (${pendingCount} Pending 🔔)` : "👥 Manage Users",
          callback_data: "cmd_users",
        },
        { text: "🔄 Flush Pending Signals", callback_data: "cmd_flush" },
      ],
      [
        {
          text: dryRun ? "🔴 Switch to LIVE Mode" : "🟡 Switch to DRY RUN",
          callback_data: "cmd_toggle_dryrun",
        },
        {
          text: isPaused ? "▶️ Resume Engine" : "⏸️ Pause Engine",
          callback_data: "cmd_toggle_pause",
        },
      ],
      [
        { text: "⚙️ Risk & SL/TP", callback_data: "cmd_risk" },
        { text: "🏆 Win Rate & Stats", callback_data: "cmd_stats" },
      ],
      [
        { text: "📰 News & Locks", callback_data: "cmd_news" },
        { text: "❓ Admin Guide", callback_data: "cmd_help" },
      ],
    ],
  };
}

// Register Telegram Bot Command Menu:
// - Normal users (default scope) ONLY see /start
// - Admin chat scope sees full admin control commands
export async function registerBotCommands(token: string, adminChatId?: string | number) {
  try {
    const url = `https://api.telegram.org/bot${token}/setMyCommands`;
    // 1. Default scope for regular subscribers: ONLY /start
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commands: [
          { command: "start", description: "🔱 Start SARRAF VIP Signal Feed" },
        ],
      }),
    });

    // 2. Admin-specific command menu for all registered Admin chats
    const adminIds = new Set<string>();
    if (adminChatId) adminIds.add(String(adminChatId));
    const dyn = getDynamicTelegramChatId();
    if (dyn) adminIds.add(String(dyn));
    for (const a of getAllAdmins()) {
      adminIds.add(a.chatId);
    }

    const adminCommands = [
      { command: "start", description: "👑 Open Master Admin Control Panel" },
      { command: "menu", description: "📱 Open Interactive Admin Buttons" },
      { command: "status", description: "📊 Live Gold, BTC & Outbox Status" },
      { command: "users", description: "👥 Approve / Block Subscribers" },
      { command: "testsignal", description: "⚡ Send Live Test Signal Now" },
      { command: "btc", description: "₿ Live BTC Tide Orderflow & Signal" },
      { command: "atlas", description: "🏛️ Today Sarraf Atlas Zones & Bias" },
      { command: "signals", description: "📈 Active Trade & Recent History" },
      { command: "price", description: "💰 Live Gold XAU/USD Quote & Bias" },
      { command: "risk", description: "⚙️ View / Edit SL, TP & Min Score" },
      { command: "stats", description: "🏆 Win Rate & R-Multiple Performance" },
      { command: "news", description: "📰 USD High-Impact News & Lock Radar" },
      { command: "pause", description: "⏸️ Pause Automated Signal Scanner" },
      { command: "resume", description: "▶️ Resume Automated Signal Scanner" },
      { command: "flush", description: "🔄 Force Deliver Queued Signals" },
      { command: "help", description: "❓ Complete Admin Remote Control Manual" },
    ];

    for (const idStr of adminIds) {
      const numId = Number(idStr);
      if (Number.isFinite(numId)) {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: { type: "chat", chat_id: numId },
            commands: adminCommands,
          }),
        }).catch(() => {});
      }
    }
    console.log("[TELEGRAM WORKER] Role-based bot command menus registered with Telegram API.");
  } catch (err: any) {
    console.warn("[TELEGRAM WORKER] Failed to register bot commands menu:", err.message);
  }
}

// Handle Normal User (Non-Admin) interactions
async function handleRegularUserInteraction(
  chatId: string | number,
  replyToMessageId?: number,
  username?: string,
  firstName?: string,
  callbackData?: string
): Promise<void> {
  const idStr = String(chatId).trim();
  const { subscriber, isNewPending } = upsertUserRequest(idStr, username, firstName);

  // If user is APPROVED: show simple clean VIP Subscriber status card (no admin commands!)
  if (subscriber.status === "APPROVED") {
    const approvedText = [
      "🔱 <b>SARRAF VIP SIGNAL FEED</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      "🟢 <b>Status:</b> Active & Approved Subscriber",
      `👤 <b>Member:</b> ${firstName || username || "VIP Trader"}`,
      "📡 <b>Live Feeds:</b> XAU/USD Gold & BTC/USD Active",
      "",
      "✅ <b>Aapka VIP signal feed active hai!</b>",
      "Jab bhi koi high-probability Gold ya BTC trade trigger hoga, aapko yahan automatic Entry, Stop Loss, aur Take Profit updates milengi.",
    ].join("\n");
    await sendTelegramHttpRequest(approvedText, replyToMessageId, chatId, undefined, "HTML");
    return;
  }

  // If user is BLOCKED
  if (subscriber.status === "BLOCKED") {
    const blockedText = [
      "🚫 <b>ACCESS RESTRICTED</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      "Aapka access Admin ki taraf se disable hai.",
    ].join("\n");
    await sendTelegramHttpRequest(blockedText, replyToMessageId, chatId, undefined, "HTML");
    return;
  }

  // User is PENDING approval
  const hasAnyAdmin = getAllAdmins().length > 0 || Boolean(getDynamicTelegramChatId());
  const userPendingKeyboard: any = {
    inline_keyboard: [
      [{ text: "🔄 Check Approval Status", callback_data: "user_check_status" }],
    ],
  };
  // If no admin has bound the bot yet, show a 1-tap Owner Admin Claim button so the owner can claim Admin without typing
  if (!hasAnyAdmin) {
    userPendingKeyboard.inline_keyboard.push([
      { text: "👑 I am the Admin (Activate Admin Panel)", callback_data: "claim_owner_admin" },
    ]);
  }

  const pendingText = [
    "🔱 <b>SARRAF VIP TRADING BOT</b>",
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    "⏳ <b>Status:</b> Pending Admin Approval",
    `👤 <b>User:</b> ${firstName || ""} ${username ? `(@${username})` : ""}`,
    `🆔 <b>Chat ID:</b> <code>${idStr}</code>`,
    "",
    "Aapki VIP Signal access request Admin ko bhej di gayi hai.",
    "Jaise hi Admin approve karenge, aapko automatic <b>XAU/USD (Gold)</b> aur <b>BTC/USD</b> trade signals milna shuru ho jayenge!",
  ].join("\n");

  await sendTelegramHttpRequest(pendingText, replyToMessageId, chatId, userPendingKeyboard, "HTML");

  // Notify Admin(s) immediately when a new user requests access (or taps Check Status)
  if (isNewPending || callbackData === "user_check_status") {
    const adminTargets = new Set<string>();
    const dynAdmin = getDynamicTelegramChatId();
    if (dynAdmin) adminTargets.add(dynAdmin);
    for (const a of getAllAdmins()) adminTargets.add(a.chatId);

    const adminNotifyText = [
      "🔔 <b>NEW SUBSCRIBER APPROVAL REQUEST</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `👤 <b>Name:</b> ${firstName || "Trader"}`,
      `🔗 <b>Username:</b> ${username ? `@${username}` : "No username"}`,
      `🆔 <b>Chat ID:</b> <code>${idStr}</code>`,
      "",
      "Kya aap is user ko Live Trade Signals ke liye <b>Approve</b> karna chahte hain?",
    ].join("\n");

    const approvalKeyboard = {
      inline_keyboard: [
        [
          { text: `✅ Approve ${firstName || username || idStr}`, callback_data: `adm_approve_${idStr}` },
          { text: "❌ Block / Reject", callback_data: `adm_block_${idStr}` },
        ],
        [{ text: "👥 View All Subscribers", callback_data: "cmd_users" }],
      ],
    };

    for (const adminId of adminTargets) {
      if (adminId !== idStr) {
        await sendTelegramHttpRequest(adminNotifyText, undefined, adminId, approvalKeyboard, "HTML");
      }
    }
  }
}

// Universal handler for ADMIN commands and inline buttons
async function executeTelegramAction(
  action: string,
  chatId: string | number,
  replyToMessageId?: number,
  fromUser?: string,
  rawArgs?: string[],
  firstName?: string
): Promise<void> {
  const idStr = String(chatId).trim();
  const normAction = action.toLowerCase().replace(/^\//, "").replace(/^cmd_/, "");

  // 1. Check if user is trying to authenticate as Admin via /admin or /setchat or claim_owner_admin
  const hasAnyAdmin = getAllAdmins().length > 0 || Boolean(getDynamicTelegramChatId());
  if (normAction === "claim_owner_admin" && !hasAnyAdmin) {
    registerAdminChat(idStr, fromUser, firstName);
    setDynamicTelegramChatId(idStr);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) registerBotCommands(token, idStr).catch(() => {});
    setTimeout(() => {
      triggerOutboxProcessing();
      processCommandOutbox().catch(() => {});
    }, 200);
  } else if (normAction === "admin" || normAction === "setchat" || normAction === "register" || normAction === "setchannel") {
    if (!rawArgs || rawArgs.length < 2) {
      const usageText = [
        "🔐 <b>ADMIN TERMINAL LOGIN</b>",
        "━━━━━━━━━━━━━━━━━━━━━━━━━",
        "Apne Telegram par Master Admin Panel activate karne ke liye yeh command bhejein:",
        "",
        "<code>/admin Gmcf7 9663059aaAA@@</code>",
      ].join("\n");
      await sendTelegramHttpRequest(usageText, replyToMessageId, chatId, undefined, "HTML");
      return;
    }
    const usernameInput = rawArgs[0];
    const passwordInput = rawArgs[1];
    const userValid = verifyAdminUsername(usernameInput);
    const passValid = verifyAdminPassword(passwordInput);
    if (!userValid || !passValid) {
      await sendTelegramHttpRequest(
        "❌ <b>INVALID ADMIN CREDENTIALS</b>\nUsername ya password ghalat hai.",
        replyToMessageId,
        chatId,
        undefined,
        "HTML"
      );
      return;
    }
    registerAdminChat(idStr, fromUser, firstName);
    setDynamicTelegramChatId(idStr);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) registerBotCommands(token, idStr).catch(() => {});
    setTimeout(() => {
      triggerOutboxProcessing();
      processCommandOutbox().catch(() => {});
    }, 200);

    const successText = [
      "👑 <b>MASTER ADMIN REGISTERED SUCCESSFULLY!</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `✅ <b>Admin Chat ID:</b> <code>${idStr}</code> (@${fromUser || "admin"})`,
      "🚀 <b>Tamam pending aur live trades ab aapke Telegram par foran aayengi!</b>",
      "👥 <b>User Approval System:</b> Jab bhi koi naya user bot start karega, aapko Approve/Block ka button milega.",
      "",
      "👇 <b>Master Control Panel (Without Opening Website):</b>",
    ].join("\n");
    await sendTelegramHttpRequest(successText, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  // 2. Enforce strict Admin vs User check!
  const isAdmin = isChatAdmin(idStr) || (getDynamicTelegramChatId() === idStr);
  if (!isAdmin) {
    // If normal user sent a command other than /start, tell them it is Admin-only
    if (normAction !== "start" && normAction !== "user_check_status") {
      const sub = getSubscriber(idStr);
      if (sub && sub.status === "APPROVED") {
        await sendTelegramHttpRequest(
          "🔒 <b>Admin Access Only</b>\nAapka VIP Signal Feed active hai — aapko tamam live signals automatically milenge.",
          replyToMessageId,
          chatId,
          undefined,
          "HTML"
        );
        return;
      }
    }
    await handleRegularUserInteraction(chatId, replyToMessageId, fromUser, firstName, normAction);
    return;
  }

  // Ensure Admin is saved in telegramSubscribers & dynamicChatId
  registerAdminChat(idStr, fromUser, firstName);
  if (!getDynamicTelegramChatId()) {
    setDynamicTelegramChatId(idStr);
  }

  const managerState = getFullManagerState();
  const settings = getCurrentSettings();
  const dryRun = getIsDryRun();

  console.log(`[TELEGRAM ADMIN] Executing action "${normAction}" for Admin Chat ID ${chatId} (${fromUser || "admin"})`);

  // Handle 1-tap User Approval / Block callbacks from Admin
  if (normAction.startsWith("adm_approve_")) {
    const targetUserId = normAction.replace("adm_approve_", "").trim();
    const updated = setSubscriberStatus(targetUserId, "APPROVED");
    // Notify the approved user immediately!
    const userWelcome = [
      "✅ <b>VIP ACCESS APPROVED!</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      "Aapka account Admin ne <b>Approve</b> kar diya hai! 🎉",
      "",
      "📡 <b>Active Feeds:</b> XAU/USD Gold & BTC/USD Live",
      "Ab jab bhi koi trade setup trigger hoga, aapko yahan automatic Live Trade Signal, Entry, Stop Loss, aur TP1–TP4 updates milengi!",
    ].join("\n");
    await sendTelegramHttpRequest(userWelcome, undefined, targetUserId, undefined, "HTML");

    await sendTelegramHttpRequest(
      `✅ <b>USER APPROVED!</b>\nSubscriber <code>${targetUserId}</code> (@${updated?.username || "user"}) ko VIP Signals ke liye approve kar diya gaya hai aur unko confirmation message bhej diya gaya hai.`,
      replyToMessageId,
      chatId,
      getMainControlKeyboard(),
      "HTML"
    );
    return;
  }

  if (normAction.startsWith("adm_block_")) {
    const targetUserId = normAction.replace("adm_block_", "").trim();
    const updated = setSubscriberStatus(targetUserId, "BLOCKED");
    await sendTelegramHttpRequest(
      `🚫 <b>USER BLOCKED / REMOVED</b>\nUser <code>${targetUserId}</code> (@${updated?.username || "user"}) ka signal access disable kar diya gaya hai.`,
      replyToMessageId,
      chatId,
      getMainControlKeyboard(),
      "HTML"
    );
    return;
  }

  if (normAction === "start" || normAction === "menu" || normAction === "bind") {
    setDynamicTelegramChatId(idStr);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) registerBotCommands(token, idStr).catch(() => {});
    setTimeout(() => {
      triggerOutboxProcessing();
      processCommandOutbox().catch(() => {});
    }, 200);

    const allSubs = getAllSubscribersList();
    const approvedCount = allSubs.filter((s) => s.status === "APPROVED").length;
    const pendingCount = allSubs.filter((s) => s.status === "PENDING").length;

    const text = [
      "👑 <b>SARRAF MASTER ADMIN TERMINAL</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `✅ <b>Admin Chat ID:</b> <code>${chatId}</code>`,
      `⚙️ <b>Dispatch Mode:</b> ${dryRun ? "🟡 DRY RUN" : "🟢 LIVE DISPATCH"}`,
      `⚡ <b>Gold Scanner:</b> ${managerState.isPaused ? "⏸️ PAUSED" : managerState.state}`,
      `👥 <b>Subscribers:</b> ${approvedCount} Approved | ${pendingCount} Pending Approval`,
      `📊 <b>Signals Today:</b> ${managerState.dailySignalsCount} sent`,
      "",
      "🚀 <b>Full Remote Control Active (No Website Needed):</b>",
      "<i>Neeche buttons se aap Live Signals, BTC Tide, Atlas Zones, Risk Settings, aur Users ko approve/remove kar sakte hain:</i>",
    ].join("\n");

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "flush") {
    // Re-queue any failed or held items and trigger both outboxes immediately
    const ob = readOutbox();
    let requeued = 0;
    for (const item of ob) {
      if (item.status !== "SENT") {
        item.status = "PENDING_DELIVERY";
        item.retryCount = 0;
        item.lastError = undefined;
        requeued++;
      }
    }
    if (requeued > 0) writeOutbox(ob);
    await triggerOutboxProcessing();
    const cmdRes = await processCommandOutbox();
    const text = [
      "🔄 <b>OUTBOX FLUSH COMPLETE</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `• <b>Gold Outbox Re-triggered:</b> ${requeued} pending items processed`,
      `• <b>BTC / Command Outbox Delivered:</b> ${cmdRes.delivered} messages sent`,
    ].join("\n");
    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "btc" || normAction === "btctide") {
    const btc = getBackendSnapshot();
    const imb = btc.depth.imbalancePct !== null ? `${btc.depth.imbalancePct > 0 ? "+" : ""}${btc.depth.imbalancePct}%` : "--";
    const lines = [
      "₿ <b>BTC TIDE LIVE ORDERFLOW & SIGNAL</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `💲 <b>BTC/USDT Price:</b> $${btc.currentPrice ? btc.currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "N/A"} (${btc.activeSource})`,
      `📊 <b>Feed Status:</b> ${btc.status} (Spot Age: ${btc.feedAges?.spot ?? 0}ms)`,
      `⚖️ <b>Book Imbalance (±0.1% 5s):</b> ${imb}`,
      `📈 <b>Perp Funding Rate:</b> ${btc.perp.fundingRate !== null ? `${(btc.perp.fundingRate * 100).toFixed(4)}%` : "--"}`,
      `🏛️ <b>Open Interest:</b> ${btc.perp.openInterest ? `${Math.round(btc.perp.openInterest).toLocaleString()} BTC` : "--"} (1h Δ: ${btc.perp.oiChange1hPct !== null ? `${btc.perp.oiChange1hPct > 0 ? "+" : ""}${btc.perp.oiChange1hPct}%` : "--"})`,
      `🎯 <b>Decision Score:</b> ${btc.decision.netScore > 0 ? "+" : ""}${btc.decision.netScore} (${btc.decision.dominantSide} — Conf: ${btc.decision.confidence}%)`,
    ];
    if (btc.activeTrade) {
      const t = btc.activeTrade;
      lines.push(
        "",
        `🔥 <b>Active BTC Signal (${t.side}):</b>`,
        `• Entry: $${t.entryPrice.toFixed(2)} | SL: $${t.slPrice.toFixed(2)}`,
        `• TP1: $${t.tp1Price.toFixed(2)} | TP2: $${t.tp2Price.toFixed(2)} | TP3: $${t.tp3Price.toFixed(2)}`,
        `• Current R: ${t.currentR > 0 ? "+" : ""}${t.currentR}R`
      );
    } else {
      lines.push("", `⏳ <b>Active BTC Trade:</b> None (${btc.decision.statusReason})`);
    }
    await sendTelegramHttpRequest(lines.join("\n"), replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "atlas") {
    const atlas = getAtlasState();
    const p = atlas.pivots;
    const lines = [
      "🏛️ <b>SARRAF ATLAS DAILY ZONES & BIAS</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `📅 <b>Session Date:</b> ${atlas.date} (Next Rollover: 22:00 UTC)`,
      `🧭 <b>Overall HTF Bias:</b> <b>${atlas.bias.overall}</b> (${atlas.bias.strategyLabel})`,
      "",
      "🎯 <b>Today Locked Institutional Zones:</b>",
      `• 🔴 <b>R3 Supply:</b> $${p.R3.toFixed(2)}`,
      `• 🔴 <b>R2 Supply:</b> $${p.R2.toFixed(2)}`,
      `• 🔴 <b>R1 Supply:</b> $${p.R1.toFixed(2)}`,
      `• 🟡 <b>SARRAF ZONE (PP):</b> <b>$${p.PP.toFixed(2)}</b>`,
      `• 🟢 <b>S1 Demand:</b> $${p.S1.toFixed(2)}`,
      `• 🟢 <b>S2 Demand:</b> $${p.S2.toFixed(2)}`,
      `• 🟢 <b>S3 Demand:</b> $${p.S3.toFixed(2)}`,
      "",
      `📌 <b>Primary Plan:</b> ${atlas.scenarios.main.title} — ${atlas.scenarios.main.triggerZone}`,
    ];
    await sendTelegramHttpRequest(lines.join("\n"), replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "status") {
    const engineStatus = getEngineStatus();
    const newsStatus = getNewsFeedStatus();
    const workerStatus = getTelegramWorkerStatus();
    const candleStore = getCandleStore();
    const latestM15 = candleStore.M15[candleStore.M15.length - 1];
    const currentPrice = latestM15 ? latestM15.close.toFixed(2) : "N/A";
    const btc = getBackendSnapshot();

    const cdMins = managerState.cooldownEndsAt
      ? Math.max(0, Math.round((new Date(managerState.cooldownEndsAt).getTime() - Date.now()) / 60000))
      : 0;

    const text = [
      "📊 <b>SARRAF REAL-TIME TERMINAL AUDIT</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `💰 <b>XAU/USD Gold:</b> $${currentPrice}`,
      `₿ <b>BTC/USDT Spot:</b> $${btc.currentPrice ? btc.currentPrice.toFixed(2) : "N/A"} (${btc.activeSource})`,
      `⚡ <b>Gold Engine:</b> ${engineStatus.engineState} (${engineStatus.usable.h1} H1 / ${engineStatus.usable.m15} M15 bars)`,
      `🎯 <b>Scanner State:</b> ${managerState.isPaused ? "⏸️ PAUSED" : managerState.state}`,
      `🚀 <b>Mode:</b> ${dryRun ? "🟡 DRY RUN (Simulation)" : "🟢 LIVE DISPATCH"}`,
      `📈 <b>Daily Signals Sent:</b> ${managerState.dailySignalsCount}`,
      `⏱️ <b>Cooldown:</b> ${cdMins > 0 ? `⏳ ${cdMins} min remaining` : "✅ Active Scanning"}`,
      `📰 <b>News Lock:</b> ${newsStatus.isLockActive ? `🔴 LOCKED (${newsStatus.activeLockEvent?.title})` : "🟢 Unlocked"}`,
      `📡 <b>Outbox Deliveries:</b> Sent: ${workerStatus.sentCount} | Pending: ${workerStatus.pendingCount}`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
    ].join("\n");

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "test" || normAction === "testsignal" || normAction === "signal_test") {
    const candleStore = getCandleStore();
    const latest = candleStore.M15[candleStore.M15.length - 1];
    const basePrice = latest ? latest.close : 4185.5;
    const entry = Number(basePrice.toFixed(2));
    const sl = Number((entry - (settings.slDollars || 10.0)).toFixed(2));
    const tp1 = Number((entry + (settings.tp1Dollars || 5.0)).toFixed(2));
    const tp2 = Number((entry + (settings.tp2Dollars || 8.0)).toFixed(2));
    const tp3 = Number((entry + (settings.tp3Dollars || 10.0)).toFixed(2));
    const tp4 = Number((entry + (settings.tp4Dollars || 12.0)).toFixed(2));

    const testSignalMsg = [
      "🔱 <b>SARRAF TRADE ALERT (LIVE TEST)</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      "📊 <b>Asset:</b> XAU/USD (Spot Gold)",
      "🟢 <b>Action:</b> <b>BUY LIMIT / MARKET</b>",
      `🎯 <b>Entry Zone:</b> <b>$${entry.toFixed(2)}</b>`,
      `🛑 <b>Stop Loss:</b> <b>$${sl.toFixed(2)}</b> (-$${(settings.slDollars || 10).toFixed(2)})`,
      "",
      "💰 <b>Take Profit Targets:</b>",
      `• <b>TP1:</b> $${tp1.toFixed(2)} (Move SL to Breakeven)`,
      `• <b>TP2:</b> $${tp2.toFixed(2)}`,
      `• <b>TP3:</b> $${tp3.toFixed(2)}`,
      `• <b>TP4:</b> $${tp4.toFixed(2)} (Final Runner)`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `✅ <b>Verified Delivery to Admin & Approved Subscribers!</b>`,
    ].join("\n");

    const recipients = getAllApprovedRecipients(idStr);
    for (const rChat of recipients) {
      await sendTelegramHttpRequest(
        testSignalMsg,
        rChat === idStr ? replyToMessageId : undefined,
        rChat,
        rChat === idStr ? getMainControlKeyboard() : undefined,
        "HTML"
      );
    }
    return;
  }

  if (normAction === "toggle_dryrun" || normAction === "dryrun" || normAction === "live") {
    const nextMode = normAction === "live" ? false : !dryRun;
    updateSettings({ dryRun: nextMode }, `TelegramAdmin:${fromUser || chatId}`);
    const statusEmoji = nextMode ? "🟡 DRY RUN (SIMULATION)" : "🟢 LIVE DISPATCH";
    const text = [
      "🔄 <b>DISPATCH MODE UPDATED</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `New Mode: <b>${statusEmoji}</b>`,
      "",
      nextMode
        ? "Signals will now be simulated without broadcasting live trade executions."
        : "⚠️ <b>LIVE DISPATCH ACTIVATED:</b> Tamam signals ab Admin aur Approved Subscribers ko live send honge!",
    ].join("\n");
    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "toggle_pause" || normAction === "pause" || normAction === "resume") {
    if (normAction === "pause" || (!managerState.isPaused && normAction === "toggle_pause")) {
      pauseSignalManager();
      const text = [
        "⏸️ <b>SARRAF SCANNER PAUSED</b>",
        "━━━━━━━━━━━━━━━━━━━━━━━━━",
        "Automated signal generation pause kar diya gaya hai.",
        "Dobara start karne ke liye <b>Resume Engine</b> dabayein.",
      ].join("\n");
      await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    } else {
      resumeSignalManager();
      const text = [
        "▶️ <b>SARRAF SCANNER RESUMED</b>",
        "━━━━━━━━━━━━━━━━━━━━━━━━━",
        "Live market scanning wapis active ho chuki hai.",
      ].join("\n");
      await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    }
    return;
  }

  if (normAction === "signals" || normAction === "last") {
    const store = getCandleStore();
    const latestBar = store.M15[store.M15.length - 1];
    const livePrice = latestBar ? latestBar.close : null;
    const dash = getSignalManagerPublicState(livePrice);
    const history = managerState.history || [];

    const lines = [
      "📈 <b>SARRAF ACTIVE & RECENT TRADE SIGNALS</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
    ];

    if (dash.activeSignal) {
      const s = dash.activeSignal;
      lines.push(
        "🔥 <b>CURRENT ACTIVE GOLD TRADE:</b>",
        `• ID: <code>${s.id}</code> (${s.direction} ${s.direction === "BUY" ? "🟢" : "🔴"})`,
        `• Entry: $${s.entry.toFixed(2)} | Live SL: $${s.sl.toFixed(2)}`,
        `• Floating PnL: ${s.livePnLDollars >= 0 ? "+" : ""}$${s.livePnLDollars.toFixed(2)} (${s.livePnLR >= 0 ? "+" : ""}${s.livePnLR}R)`,
        `• Highest TP Hit: <b>${s.highestTP}</b> | BE Active: ${s.isBreakeven ? "YES ✅" : "NO ❌"}`,
        ""
      );
    } else {
      lines.push("🎯 <b>Active Gold Trade:</b> No setup currently in progress (Scanning active).", "");
    }

    lines.push("📜 <b>Recent Signal History:</b>");
    if (history.length === 0) {
      lines.push("• No closed signals recorded in current session.");
    } else {
      history.slice(0, 5).forEach((h, idx) => {
        const icon = h.resultClass === "WIN" ? "✅" : h.resultClass === "LOSS" ? "❌" : "⚪";
        const sign = h.realizedR >= 0 ? "+" : "";
        lines.push(`${idx + 1}. <code>${h.id}</code> (${h.direction}) → ${icon} <b>${h.resultClass}</b> (${sign}${h.realizedR.toFixed(2)}R) [${h.closeReason || "CLOSED"}]`);
      });
    }

    await sendTelegramHttpRequest(lines.join("\n"), replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "price" || normAction === "gold") {
    const store = getCandleStore();
    const latest = store.M15[store.M15.length - 1];
    const h1 = getClosedCandles("H1");
    const h4 = getClosedCandles("H4");
    const d1 = getClosedCandles("D1");

    const h1Bias = evaluateStructureBias(h1);
    const h4Bias = evaluateStructureBias(h4);
    const d1Bias = evaluateStructureBias(d1);

    const text = [
      "💰 <b>XAU/USD GOLD REAL-TIME QUOTE & BIAS</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `💲 <b>Live Price:</b> $${latest ? latest.close.toFixed(2) : "N/A"}`,
      `📊 <b>Bar Range:</b> Low: $${latest ? latest.low.toFixed(2) : "N/A"} | High: $${latest ? latest.high.toFixed(2) : "N/A"}`,
      "",
      "🧠 <b>Multi-Timeframe Structure Biases:</b>",
      `• <b>H1 Bias:</b> ${h1Bias.bias} (${h1Bias.lastBOS})`,
      `• <b>H4 Bias:</b> ${h4Bias.bias} (${h4Bias.lastBOS})`,
      `• <b>D1 Bias:</b> ${d1Bias.bias} (${d1Bias.lastBOS})`,
    ].join("\n");

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "news") {
    const feed = getNewsFeedStatus();
    const lines = [
      "📰 <b>SARRAF MACROECONOMIC & NEWS LOCK AUDIT</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `🔒 <b>News Lock State:</b> ${feed.isLockActive ? `🔴 <b>LOCKED</b> (${feed.activeLockEvent?.title})` : "🟢 <b>UNLOCKED (Trading Allowed)</b>"}`,
      `⏱️ <b>Tier 1 Window:</b> -${settings.tier1PreMinutes}m pre / +${settings.tier1PostMinutes}m post`,
      "",
      "📅 <b>Upcoming High-Impact USD Events:</b>",
    ];

    if (feed.nextEvent) {
      lines.push(
        `• <b>${feed.nextEvent.title}</b>`,
        `  Time: ${feed.nextEvent.displayTime || feed.nextEvent.timeUtc} (${feed.nextEvent.minutesUntil >= 0 ? `in ${feed.nextEvent.minutesUntil}m` : `${Math.abs(feed.nextEvent.minutesUntil)}m ago`})`
      );
    } else {
      lines.push("• No impending high-impact USD events within immediate radar.");
    }

    await sendTelegramHttpRequest(lines.join("\n"), replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "stats") {
    const stats = getSignalStats();
    const total = stats.wins + stats.losses + stats.breakevens;
    const winRate = total > 0 ? Math.round((stats.wins / total) * 100) : 0;

    const text = [
      "🏆 <b>SARRAF PERFORMANCE & WIN RATE AUDIT</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `📊 <b>Total Completed Trades:</b> ${total}`,
      `🎯 <b>Record:</b> ${stats.wins} Wins | ${stats.losses} Losses | ${stats.breakevens} Breakevens`,
      `📈 <b>Win Rate:</b> <b>${winRate}%</b>`,
      `💰 <b>Net Accumulated Gain:</b> <b>${stats.totalR >= 0 ? "+" : ""}${stats.totalR.toFixed(2)}R</b>`,
    ].join("\n");

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "setsl" && rawArgs && rawArgs.length >= 1) {
    const val = parseFloat(rawArgs[0]);
    if (Number.isFinite(val) && val >= 2 && val <= 50) {
      updateSettings({ slDollars: val }, `TelegramAdmin:${fromUser || chatId}`);
      await sendTelegramHttpRequest(`✅ <b>Stop Loss Updated:</b> $${val.toFixed(2)}`, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
      return;
    }
  }

  if (normAction === "setscore" && rawArgs && rawArgs.length >= 1) {
    const val = parseInt(rawArgs[0], 10);
    if (Number.isFinite(val) && val >= 50 && val <= 98) {
      updateSettings({ minScore: val }, `TelegramAdmin:${fromUser || chatId}`);
      await sendTelegramHttpRequest(`✅ <b>Min Confluence Score Updated:</b> ${val}/100`, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
      return;
    }
  }

  if (normAction === "risk") {
    const text = [
      "⚙️ <b>SARRAF RISK & TARGET CONFIGURATION</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `🛑 <b>Stop Loss (SL):</b> $${settings.slDollars.toFixed(2)} (Edit: <code>/setsl 10</code>)`,
      "🎯 <b>Take Profit Targets:</b>",
      `• TP1: $${settings.tp1Dollars.toFixed(2)} (+${(settings.tp1Dollars / settings.slDollars).toFixed(2)}R)`,
      `• TP2: $${settings.tp2Dollars.toFixed(2)} (+${(settings.tp2Dollars / settings.slDollars).toFixed(2)}R)`,
      `• TP3: $${settings.tp3Dollars.toFixed(2)} (+${(settings.tp3Dollars / settings.slDollars).toFixed(2)}R)`,
      `• TP4: $${settings.tp4Dollars.toFixed(2)} (+${(settings.tp4Dollars / settings.slDollars).toFixed(2)}R)`,
      `💯 <b>Minimum Confluence Score:</b> ${settings.minScore}/100 (Edit: <code>/setscore 80</code>)`,
      `🛡️ <b>Spread Limit:</b> $${settings.spreadLimit.toFixed(2)}`,
    ].join("\n");

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "approve" && rawArgs && rawArgs.length >= 1) {
    const targetId = rawArgs[0].trim();
    setSubscriberStatus(targetId, "APPROVED");
    await sendTelegramHttpRequest(
      "✅ <b>VIP ACCESS APPROVED!</b>\nAapka account Admin ne approve kar diya hai. Ab aapko automatic live signals milenge!",
      undefined,
      targetId,
      undefined,
      "HTML"
    );
    await sendTelegramHttpRequest(`✅ Approved user <code>${targetId}</code>`, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "block" && rawArgs && rawArgs.length >= 1) {
    const targetId = rawArgs[0].trim();
    setSubscriberStatus(targetId, "BLOCKED");
    await sendTelegramHttpRequest(`🚫 Blocked user <code>${targetId}</code>`, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "broadcast" && rawArgs && rawArgs.length >= 1) {
    const msgBody = rawArgs.join(" ");
    const recipients = getAllApprovedRecipients(idStr);
    const bcastText = [
      "📢 <b>SARRAF DESK ANNOUNCEMENT</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      msgBody,
    ].join("\n");
    let sent = 0;
    for (const rId of recipients) {
      const r = await sendTelegramHttpRequest(bcastText, undefined, rId, undefined, "HTML");
      if (r.success) sent++;
    }
    await sendTelegramHttpRequest(`✅ <b>Broadcast Sent</b> to ${sent} approved subscriber(s).`, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "users") {
    const subs = getAllSubscribersList();
    const pending = subs.filter((s) => s.status === "PENDING");
    const approved = subs.filter((s) => s.status === "APPROVED");
    const blocked = subs.filter((s) => s.status === "BLOCKED");

    const lines = [
      "👥 <b>SUBSCRIBER & USER APPROVAL MANAGER</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `👑 <b>Admins:</b> ${approved.filter((s) => s.role === "ADMIN").length} | ✅ <b>Approved Users:</b> ${approved.filter((s) => s.role === "USER").length}`,
      `⏳ <b>Pending Requests:</b> ${pending.length} | 🚫 <b>Blocked:</b> ${blocked.length}`,
      "",
    ];

    const inlineButtons: any[][] = [];

    if (pending.length > 0) {
      lines.push("🔔 <b>PENDING APPROVAL REQUESTS:</b>");
      for (const p of pending.slice(0, 8)) {
        const label = p.firstName || p.username || p.chatId;
        lines.push(`• <b>${label}</b> ${p.username ? `(@${p.username})` : ""} — ID: <code>${p.chatId}</code>`);
        inlineButtons.push([
          { text: `✅ Approve ${label}`, callback_data: `adm_approve_${p.chatId}` },
          { text: `❌ Block ${label}`, callback_data: `adm_block_${p.chatId}` },
        ]);
      }
      lines.push("");
    }

    const regularApproved = approved.filter((s) => s.role === "USER");
    if (regularApproved.length > 0) {
      lines.push("✅ <b>APPROVED VIP SUBSCRIBERS:</b>");
      for (const a of regularApproved.slice(0, 10)) {
        const label = a.firstName || a.username || a.chatId;
        lines.push(`• <b>${label}</b> ${a.username ? `(@${a.username})` : ""} — ID: <code>${a.chatId}</code>`);
        inlineButtons.push([
          { text: `🚫 Remove Access: ${label}`, callback_data: `adm_block_${a.chatId}` },
        ]);
      }
      lines.push("");
    } else {
      lines.push("• <i>Abhi koi external user approved list mein nahi hai. Jab koi user bot ko /start karega toh yahan Approve button aa jayega.</i>", "");
    }

    lines.push(
      "💡 <b>Manual Commands:</b>",
      "• <code>/approve [chat_id]</code> — Pre-approve any user or group ID",
      "• <code>/block [chat_id]</code> — Remove user access",
      "• <code>/broadcast [message]</code> — Send message to all approved users"
    );

    inlineButtons.push([{ text: "🔙 Back to Main Admin Panel", callback_data: "cmd_menu" }]);

    await sendTelegramHttpRequest(
      lines.join("\n"),
      replyToMessageId,
      chatId,
      { inline_keyboard: inlineButtons },
      "HTML"
    );
    return;
  }

  if (normAction === "help") {
    const text = [
      "👑 <b>SARRAF ADMIN REMOTE CONTROL MANUAL</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      "Aap website khole baghair Telegram se pura system chala sakte hain:",
      "",
      "<b>1. Core Controls:</b>",
      "• <code>/menu</code> — Open Master Admin Button Dashboard",
      "• <code>/status</code> — Live Gold, BTC, Engine & Outbox status",
      "• <code>/testsignal</code> — Send live verification signal",
      "• <code>/flush</code> — Force send any queued signals in outbox",
      "",
      "<b>2. Markets & Intelligence:</b>",
      "• <code>/btc</code> — Live BTC Tide Orderflow, Imbalance & Signal",
      "• <code>/atlas</code> — Today Sarraf Atlas Zones (PP, R1-R3, S1-S3)",
      "• <code>/price</code> — Live Gold XAU/USD price & MTF bias",
      "• <code>/signals</code> — Active trade & recent history",
      "",
      "<b>3. User Approval & Broadcasts:</b>",
      "• <code>/users</code> — View, Approve (✅) or Block (❌) users",
      "• <code>/approve [chatId]</code> — Approve user/channel by ID",
      "• <code>/block [chatId]</code> — Block/remove user by ID",
      "• <code>/broadcast [msg]</code> — Send announcement to all users",
      "",
      "<b>4. Risk & Scanner Settings:</b>",
      "• <code>/setsl [dollars]</code> — Change Gold SL (e.g. <code>/setsl 10</code>)",
      "• <code>/setscore [50-95]</code> — Change Min Score (e.g. <code>/setscore 80</code>)",
      "• <code>/pause</code> & <code>/resume</code> — Pause or Resume scanner",
    ].join("\n");

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  const fallback = "Unrecognized command. Tap a button below or use /menu.";
  await sendTelegramHttpRequest(fallback, replyToMessageId, chatId, getMainControlKeyboard());
}

// Poll Telegram Commands and Interactive Buttons via getUpdates (Non-blocking timeout=0)
async function pollTelegramCommands() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === "123456789:ABCdefGhIJKlmNoPQRstuVWXyz") return;

  try {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${updatePollingOffset}&timeout=0`;
    const res = await fetch(url);
    if (!res.ok) return;

    const data = await res.json();
    if (!data.ok || !Array.isArray(data.result)) return;

    for (const update of data.result) {
      updatePollingOffset = update.update_id + 1;

      // 1. Handle Inline Button Callback Queries
      if (update.callback_query) {
        const cq = update.callback_query;
        const callbackId = cq.id;
        const callbackData = cq.data;
        const chatId = cq.message?.chat?.id;
        const fromUser = cq.from?.username || "user";
        const firstName = cq.from?.first_name || "Trader";

        console.log(`[TELEGRAM BUTTON] Pressed "${callbackData}" by @${fromUser} (Chat: ${chatId})`);
        await answerTelegramCallbackQuery(callbackId, "Processing...");

        if (chatId && callbackData) {
          await executeTelegramAction(callbackData, chatId, cq.message?.message_id, fromUser, [], firstName);
        }
        continue;
      }

      // 2. Handle Text Commands & Messages
      const msg = update.message;
      if (!msg) continue;

      const incomingChatId = msg.chat?.id;
      const text = (msg.text || "").trim();
      const fromUser = msg.from?.username || "user";
      const firstName = msg.from?.first_name || "Trader";

      if (!incomingChatId) continue;

      if (!text.startsWith("/")) {
        // If Admin sends non-command text, show Admin menu; if regular user, show their subscriber status
        await executeTelegramAction("start", incomingChatId, msg.message_id, fromUser, [], firstName);
        continue;
      }

      const parts = text.split(" ").filter(Boolean);
      const rawCmd = parts[0].replace(/@\w+$/, "");
      const args = parts.slice(1);

      console.log(`[TELEGRAM COMMAND] "${text}" from Chat ID: ${incomingChatId} (@${fromUser})`);
      await executeTelegramAction(rawCmd, incomingChatId, msg.message_id, fromUser, args, firstName);
    }
  } catch {
    // Silently continue polling loop
  }
}

// -------------------------------------------------------------
// SUMMARIES & PERIODIC REPORTS (Daily Summary & Weekly Report)
// -------------------------------------------------------------

export function computeDailySummaryData(history: SignalRecord[], targetDateStr: string): DailySummaryData {
  // Filter only closed trades of that UTC day and exclude simulated trades
  const dayTrades = history.filter((s) => {
    if (s.id.startsWith('SIM-')) return false;
    const closedDate = s.closedAt ? s.closedAt.slice(0, 10) : s.createdAt.slice(0, 10);
    return closedDate === targetDateStr && s.status === 'CLOSED';
  });

  if (dayTrades.length === 0) {
    return {
      signalsCount: 0,
      tpCount: 0,
      slCount: 0,
      beCount: 0,
      totalDollars: 0,
      totalR: 0,
    };
  }

  const tpCount = dayTrades.filter((s) => s.resultClass === 'WIN' || ['TP1', 'TP2', 'TP3', 'TP4'].includes(s.closeReason || '')).length;
  const slCount = dayTrades.filter((s) => s.resultClass === 'LOSS' || s.closeReason === 'SL').length;
  const beCount = dayTrades.filter((s) => s.resultClass === 'BREAKEVEN' || s.closeReason === 'BE_STOP').length;
  const totalDollars = Number(dayTrades.reduce((sum, s) => sum + (s.realizedDollars || 0), 0).toFixed(2));
  const totalR = Number(dayTrades.reduce((sum, s) => sum + (s.realizedR || 0), 0).toFixed(2));

  return {
    signalsCount: dayTrades.length,
    tpCount,
    slCount,
    beCount,
    totalDollars,
    totalR,
  };
}

export function computeWeeklyReportData(history: SignalRecord[], refDate: Date = new Date()): WeeklyReportData {
  // Determine start of ISO week (Monday 00:00:00 UTC) and end of week (Sunday 23:59:59 UTC)
  const d = new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth(), refDate.getUTCDate()));
  const dayOfWeek = d.getUTCDay();
  const distanceToMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(d.getTime() - distanceToMonday * 86400000);
  const mondayStr = monday.toISOString().slice(0, 10);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const sundayStr = sunday.toISOString().slice(0, 10);

  const weekTrades = history.filter((s) => {
    if (s.id.startsWith('SIM-')) return false;
    const closedDate = s.closedAt ? s.closedAt.slice(0, 10) : s.createdAt.slice(0, 10);
    return closedDate >= mondayStr && closedDate <= sundayStr && s.status === 'CLOSED';
  });

  if (weekTrades.length === 0) {
    return {
      signalsCount: 0,
      tpCount: 0,
      slCount: 0,
      beCount: 0,
      winRate: 0,
      totalDollars: 0,
      totalR: 0,
      bestDay: 'N/A',
      worstDay: 'N/A',
    };
  }

  const tpCount = weekTrades.filter((s) => s.resultClass === 'WIN' || ['TP1', 'TP2', 'TP3', 'TP4'].includes(s.closeReason || '')).length;
  const slCount = weekTrades.filter((s) => s.resultClass === 'LOSS' || s.closeReason === 'SL').length;
  const beCount = weekTrades.filter((s) => s.resultClass === 'BREAKEVEN' || s.closeReason === 'BE_STOP').length;

  // Win rate counts WIN / (WIN + LOSS), breakeven excluded
  const decisiveTrades = tpCount + slCount;
  const winRate = decisiveTrades > 0 ? (tpCount / decisiveTrades) * 100 : 0;
  const totalDollars = Number(weekTrades.reduce((sum, s) => sum + (s.realizedDollars || 0), 0).toFixed(2));
  const totalR = Number(weekTrades.reduce((sum, s) => sum + (s.realizedR || 0), 0).toFixed(2));

  // Best & worst day by net R
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayRMap = new Map<string, number>();

  for (const s of weekTrades) {
    const tradeDate = new Date(s.closedAt || s.createdAt);
    const dayName = dayNames[tradeDate.getUTCDay()];
    dayRMap.set(dayName, (dayRMap.get(dayName) || 0) + (s.realizedR || 0));
  }

  let bestDay = 'N/A';
  let bestR = -Infinity;
  let worstDay = 'N/A';
  let worstR = Infinity;

  for (const [day, r] of dayRMap.entries()) {
    if (r > bestR) {
      bestR = r;
      bestDay = day;
    }
    if (r < worstR) {
      worstR = r;
      worstDay = day;
    }
  }

  if (bestDay === 'N/A') bestDay = 'Tue';
  if (worstDay === 'N/A') worstDay = 'Thu';

  return {
    signalsCount: weekTrades.length,
    tpCount,
    slCount,
    beCount,
    winRate,
    totalDollars,
    totalR,
    bestDay,
    worstDay,
  };
}

export function getIsoWeekString(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// Scheduled check to enqueue summaries idempotently
export function checkAndScheduleSummaries() {
  const settings = getCurrentSettings();
  const now = new Date();
  const nowMs = now.getTime();
  const managerState = getFullManagerState();
  const outbox = readOutbox();

  // 1. Daily Summary (default 22:30 UTC)
  if (settings.dailySummaryEnabled) {
    const todayStr = now.toISOString().slice(0, 10);
    const targetTimeStr = settings.dailySummaryTimeUtc || '22:30';
    const scheduledMs = new Date(`${todayStr}T${targetTimeStr}:00Z`).getTime();

    // If scheduled time has passed and is less than 12 hours late
    if (nowMs >= scheduledMs && (nowMs - scheduledMs) <= 12 * 3600 * 1000) {
      const eventId = `SUMMARY-D-${todayStr}`;
      const alreadyQueued = outbox.some((item) => item.eventId === eventId);
      if (!alreadyQueued) {
        const data = computeDailySummaryData(managerState.history, todayStr);
        const text = formatDailySummary(data);
        outbox.push({
          eventId,
          signalId: eventId,
          type: 'DAILY_SUMMARY',
          payload: data as any,
          createdAt: new Date().toISOString(),
          status: 'PENDING_DELIVERY',
          messageText: text,
        });
        writeOutbox(outbox);
        console.log(`[TELEGRAM WORKER] Queued Daily Summary event: ${eventId}`);
      }
    }
  }

  // 2. Weekly Report (default Friday 23:00 UTC)
  if (settings.weeklyReportEnabled) {
    const day = now.getUTCDay(); // 5 = Friday, 6 = Saturday
    const isoWeek = getIsoWeekString(now);
    const targetTimeStr = settings.weeklyReportTimeUtc || '23:00';

    if (day === 5 || day === 6) {
      const fridayDateStr = day === 5 ? now.toISOString().slice(0, 10) : new Date(nowMs - 86400000).toISOString().slice(0, 10);
      const scheduledMs = new Date(`${fridayDateStr}T${targetTimeStr}:00Z`).getTime();

      if (nowMs >= scheduledMs && (nowMs - scheduledMs) <= 12 * 3600 * 1000) {
        const eventId = `SUMMARY-W-${isoWeek}`;
        const alreadyQueued = outbox.some((item) => item.eventId === eventId);
        if (!alreadyQueued) {
          const data = computeWeeklyReportData(managerState.history, now);
          const text = formatWeeklyReport(data);
          outbox.push({
            eventId,
            signalId: eventId,
            type: 'WEEKLY_REPORT',
            payload: data as any,
            createdAt: new Date().toISOString(),
            status: 'PENDING_DELIVERY',
            messageText: text,
          });
          writeOutbox(outbox);
          console.log(`[TELEGRAM WORKER] Queued Weekly Report event: ${eventId}`);
        }
      }
    }
  }
}

// Process all pending items in outbox
export async function triggerOutboxProcessing() {
  try {
    const outbox = readOutbox();
    const pendingItems = outbox.filter((item) => item.status === 'PENDING_DELIVERY');

    if (pendingItems.length === 0) return;

    for (const item of pendingItems) {
      await processOutboxItem(item);
    }

    writeOutbox(outbox);
  } catch (err: any) {
    console.error('[TELEGRAM WORKER] Outbox process loop error:', err.message);
  }
}

// Background Worker Loop (reads outbox, polls commands, checks summaries & alerts)
export function startTelegramWorker() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;

  loadThreadMap();
  console.log(`[TELEGRAM WORKER] Background dispatch worker started (DRY_RUN=${getIsDryRun()}).`);

  // Register commands menu with Telegram API
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (token && token !== '123456789:ABCdefGhIJKlmNoPQRstuVWXyz') {
    registerBotCommands(token);
  }

  // Send Bot Restarted server alert on startup
  sendAdminAlert('BOT_RESTARTED');

  // 1. Outbox Queue Processor (Runs every 1.5s)
  setInterval(async () => {
    await triggerOutboxProcessing();
  }, 1500);

  // 2. Incoming Command & Callback Query Long-Polling Loop (Runs continuously every 2.5s)
  setInterval(async () => {
    await pollTelegramCommands();
  }, 2500);

  // 3. Summaries & Periodic Health Checks Loop (Runs every 15s)
  setInterval(async () => {
    try {
      checkAndScheduleSummaries();
      checkSystemHealthAlerts();
    } catch (err: any) {
      console.error('[TELEGRAM WORKER] Summary & Health loop error:', err.message);
    }
  }, 15000);
}

// System Health & Feed Alert Monitor
export function checkSystemHealthAlerts() {
  const now = new Date();
  const marketOpen = isGoldMarketOpen(now);
  const managerState = getFullManagerState();

  if (marketOpen) {
    // Check Engine Stall: no tick/candle update for > 60 seconds
    const elapsedSinceTick = Date.now() - (managerState.lastTickTimestamp || 0);
    if (elapsedSinceTick > 60000 && managerState.lastTickTimestamp > 0) {
      sendAdminAlert('ENGINE_STALLED');
    }
  }

  // Check News Feed Down: more than 2 hours without successful fetch
  const newsStatus = getNewsFeedStatus();
  if (newsStatus.lastSuccessfulFetchAt) {
    const elapsedNews = Date.now() - new Date(newsStatus.lastSuccessfulFetchAt).getTime();
    if (elapsedNews > 2 * 3600 * 1000) {
      sendAdminAlert('NEWS_FEED_DOWN');
    }
  }
}

// Send Admin Alerts with 30-minute throttling per type, with back to normal support
export async function sendAdminAlert(type: AdminAlertType) {
  const now = Date.now();
  const lastTime = lastAdminAlertTimes[type] || 0;

  // Max once per 30 min per type
  if (now - lastTime < 30 * 60 * 1000) {
    return;
  }

  lastAdminAlertTimes[type] = now;
  const alertText = formatAdminAlert(type);

  if (getIsDryRun()) {
    console.log(`[TELEGRAM ADMIN ALERT - DRY RUN] ${alertText}`);
    return;
  }

  const result = await sendTelegramHttpRequest(alertText);
  if (!result.success) {
    // If delivery failed, queue into outbox so it sends when delivery works again
    const outbox = readOutbox();
    const eventId = `ALERT-${type}-${Date.now()}`;
    outbox.push({
      eventId,
      signalId: eventId,
      type: 'ADMIN_ALERT',
      payload: { alertType: type },
      createdAt: new Date().toISOString(),
      status: 'PENDING_DELIVERY',
      messageText: alertText,
    });
    writeOutbox(outbox);
  }
}

// Manual Test Message sender
export async function sendManualTestMessage(adminEmail: string): Promise<{ success: boolean; message: string }> {
  const testText = `[SARRAF TEST] Dispatch test triggered by ${adminEmail} at ${new Date().toUTCString()}.`;

  if (getIsDryRun()) {
    console.log(`[TELEGRAM TEST - DRY RUN] ${testText}`);
    return { success: true, message: 'Test message simulated in DRY RUN mode (logged to console).' };
  }

  const result = await sendTelegramHttpRequest(testText);
  if (result.success) {
    return { success: true, message: `Live test message dispatched successfully (Message ID: ${result.messageId}).` };
  } else {
    return { success: false, message: `Failed to dispatch test message: ${result.error}` };
  }
}

// Manual Test Daily Summary Dispatcher
export async function sendManualTestDailySummary(targetChatId?: string): Promise<{ success: boolean; message: string; messageId?: number }> {
  const managerState = getFullManagerState();
  const todayStr = new Date().toISOString().slice(0, 10);
  let data = computeDailySummaryData(managerState.history, todayStr);
  if (data.signalsCount === 0) {
    data = {
      signalsCount: 2,
      tpCount: 1,
      slCount: 1,
      beCount: 0,
      totalDollars: 2.0,
      totalR: 0.2,
      isTest: true,
    };
  } else {
    data.isTest = true;
  }

  const text = formatDailySummary(data);
  if (getIsDryRun()) {
    console.log(`[TELEGRAM SUMMARY TEST - DRY RUN] ${text}`);
    return { success: true, message: 'Test Daily Summary simulated in DRY RUN mode (logged to console).' };
  }

  const res = await sendTelegramHttpRequest(text, undefined, targetChatId);
  if (res.success) {
    return { success: true, message: `Test Daily Summary dispatched to Telegram (Msg ID: ${res.messageId})!`, messageId: res.messageId };
  } else {
    return { success: false, message: `Failed to dispatch test Daily Summary: ${res.error}` };
  }
}

// Manual Test Weekly Report Dispatcher
export async function sendManualTestWeeklyReport(targetChatId?: string): Promise<{ success: boolean; message: string; messageId?: number }> {
  const managerState = getFullManagerState();
  let data = computeWeeklyReportData(managerState.history, new Date());
  if (data.signalsCount === 0) {
    data = {
      signalsCount: 8,
      tpCount: 5,
      slCount: 2,
      beCount: 1,
      winRate: 62.5,
      totalDollars: 21.0,
      totalR: 2.1,
      bestDay: 'Tue',
      worstDay: 'Thu',
      isTest: true,
    };
  } else {
    data.isTest = true;
  }

  const text = formatWeeklyReport(data);
  if (getIsDryRun()) {
    console.log(`[TELEGRAM WEEKLY REPORT TEST - DRY RUN] ${text}`);
    return { success: true, message: 'Test Weekly Report simulated in DRY RUN mode (logged to console).' };
  }

  const res = await sendTelegramHttpRequest(text, undefined, targetChatId);
  if (res.success) {
    return { success: true, message: `Test Weekly Report dispatched to Telegram (Msg ID: ${res.messageId})!`, messageId: res.messageId };
  } else {
    return { success: false, message: `Failed to dispatch test Weekly Report: ${res.error}` };
  }
}

// Manual Verification Signal Dispatcher to verify live Telegram trade alerts
export async function sendVerificationTestSignal(targetChatId?: string): Promise<{ success: boolean; message: string; messageId?: number }> {
  const testSignalText = [
    'XAUUSD BUY 🟢',
    'Entry: 4168.50',
    'SL: 4158.50',
    'TP1: 4173.50',
    'TP2: 4176.50',
    'TP3: 4178.50',
    'TP4: 4180.50',
    '',
    `⚡ [LIVE TEST SIGNAL] Sent at ${new Date().toLocaleTimeString()} UTC. Telegram trade alerts verified.`,
  ].join('\n');

  const result = await sendTelegramHttpRequest(testSignalText, undefined, targetChatId);
  if (result.success) {
    return { success: true, message: `Live test signal delivered to Telegram (Msg ID: ${result.messageId})!`, messageId: result.messageId };
  } else {
    return { success: false, message: `Telegram delivery error: ${result.error}` };
  }
}

// Dynamic DRY RUN toggle with confirmation
export function setDryRunMode(dryRun: boolean, adminEmail: string): { success: boolean; mode: boolean } {
  const result = updateSettings({ dryRun }, adminEmail);
  const activeMode = getIsDryRun();
  console.log(`[TELEGRAM WORKER] Admin ${adminEmail} set DRY_RUN=${activeMode}`);
  return { success: result.success, mode: activeMode };
}

export function getIsDryRun(): boolean {
  try {
    return getCurrentSettings().dryRun;
  } catch {
    return process.env.DRY_RUN !== 'false';
  }
}

// Retry a single failed outbox item
export async function retryFailedOutboxItem(eventId: string): Promise<{ success: boolean; message: string }> {
  const outbox = readOutbox();
  const item = outbox.find((o) => o.eventId === eventId);
  if (!item) {
    return { success: false, message: 'Event not found in outbox.' };
  }

  item.status = 'PENDING_DELIVERY';
  item.retryCount = 0;
  writeOutbox(outbox);
  await processOutboxItem(item);
  writeOutbox(outbox);

  return { success: true, message: `Retried event ${eventId}. Status is now ${item.status}.` };
}

// Retry all failed outbox items
export async function retryAllFailedOutboxItems(): Promise<{ count: number; message: string }> {
  const outbox = readOutbox();
  let count = 0;
  for (const item of outbox) {
    if (item.status === 'FAILED') {
      item.status = 'PENDING_DELIVERY';
      item.retryCount = 0;
      item.lastError = undefined;
      count++;
    }
  }
  if (count > 0) {
    writeOutbox(outbox);
    setTimeout(() => triggerOutboxProcessing(), 300);
  }
  return { count, message: `Reset ${count} failed outbox items to PENDING_DELIVERY.` };
}

// Get comprehensive worker status
export function getTelegramWorkerStatus(): TelegramWorkerStatus {
  const outbox = readOutbox();
  const pending = outbox.filter((o) => o.status === 'PENDING_DELIVERY').length;
  const sent = outbox.filter((o) => o.status === 'SENT').length;
  const failed = outbox.filter((o) => o.status === 'FAILED').length;

  const lastSent = outbox.filter((o) => o.status === 'SENT').pop();

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const effectiveChat = getEffectiveTelegramChatId();
  const isRegistered = Boolean(effectiveChat && !isInvalidTelegramChatId(effectiveChat));

  let lastError = outbox.find((o) => o.status === 'FAILED')?.lastError;
  if (!isRegistered) {
    lastError = "Telegram Chat ID is not bound yet. Send /start to @Sarraftelegrambot in Telegram or set Chat ID in dashboard settings.";
  }

  return {
    botConnected: Boolean(token && token !== '123456789:ABCdefGhIJKlmNoPQRstuVWXyz'),
    dryRun: getIsDryRun(),
    targetChatIdMasked: isRegistered ? maskIdentifier(effectiveChat!) : 'NOT BOUND (Send /start in Telegram)',
    lastMessageSentAt: lastSent?.lastAttemptAt || lastSent?.createdAt,
    lastError,
    pendingCount: pending,
    sentCount: sent,
    failedCount: failed,
    totalDelivered: sent,
    recentMessages: outbox.slice(-12).reverse(),
  };
}
