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
  triggerLiveXauSignalFromTelegram,
  resetXauSignalManagerCooldown,
  SignalRecord,
} from './signalManager.ts';
import { getClosedCandles, getEngineStatus, getCandleStore } from './candleEngine.ts';
import { evaluateStructureBias, isGoldMarketOpen } from './sarrafEngine.ts';
import { evaluateMarketPriceStatus } from './marketPriceEngine.ts';
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
import {
  getBackendSnapshot,
  isBtcTidePaused,
  setBtcTidePaused,
  resetBtcTideCooldown,
  manualCloseBtcTideTrade,
  triggerLiveBtcTideSignalFromTelegram,
} from "./btcTideBackendEngine.ts";
import {
  manualCloseCommandSignal,
  resetCommandSignalCooldown,
  triggerLiveCommandSignalFromTelegram,
} from "./commandSignalEngine.ts";
import { getAtlasState } from "../../server/atlas/atlasEngine.ts";
import { processCommandOutbox } from "./commandTelegramService.ts";

function getLiveXauPrice(): number {
  try {
    const m = evaluateMarketPriceStatus();
    if (m && m.tick && typeof m.tick.price === "number" && m.tick.price > 0) {
      return Number(m.tick.price.toFixed(2));
    }
  } catch {}
  const store = getCandleStore();
  const latest = store.M15[store.M15.length - 1];
  return latest ? Number(latest.close.toFixed(2)) : 4140.77;
}

const OUTBOX_FILE = path.resolve(DATA_DIR, 'outbox.json');
const THREAD_MAP_FILE = path.resolve(DATA_DIR, 'telegram_threads.json');
const DYNAMIC_CHAT_FILE = path.resolve(DATA_DIR, "telegram_chat.json");
const OFFSET_FILE = path.resolve(DATA_DIR, "telegram_offset.json");
function loadPollingOffset(): number {
  try {
    if (fs.existsSync(OFFSET_FILE)) {
      const d = JSON.parse(fs.readFileSync(OFFSET_FILE, "utf8"));
      if (typeof d.offset === "number") return d.offset;
    }
  } catch {}
  return 0;
}
function savePollingOffset(offset: number) {
  try {
    fs.writeFileSync(OFFSET_FILE, JSON.stringify({ offset }), "utf8");
  } catch {}
}

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
let updatePollingOffset = loadPollingOffset();
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
    const liveXau = getLiveXauPrice();

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
      currentPrice: liveXau || p.entryTarget,
      m15Candles: m15,
      m30Candles: m30,
      h1Candles: h1,
      bias: { d1: d1Bias, h4: h4Bias, h1: h1Bias },
    });

    // Only allow AI rejection if entry price severely deviates (> $15) from live market price
    const priceMismatch = Math.abs((p.entryTarget || liveXau) - liveXau) > 15.0;
    if (validation.verdict === 'REJECT' && validation.confidence >= 85 && priceMismatch) {
      console.warn(`[TELEGRAM WORKER] Signal ${item.signalId} AI_REJECTED by Gemini (${validation.confidence}% confidence: ${validation.reason}). Cancelling stale setup.`);

      if (managerState.currentSignal && managerState.currentSignal.id === item.signalId) {
        managerState.currentSignal = null;
        if (managerState.dailySignalsCount > 0) {
          managerState.dailySignalsCount -= 1;
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

  // Determine recipients: ADMIN_ALERT goes only to Admin; XAU signals & summaries go to Admin + all approved XAU/BOTH subscribers
  const recipients =
    item.type === 'ADMIN_ALERT'
      ? [effectiveChat]
      : getAllApprovedRecipients(effectiveChat, 'XAU');
  const primaryChat = recipients[0] || effectiveChat;

  const result = await sendTelegramHttpRequest(messageText, replyToId, primaryChat, undefined, undefined, `outbox_${item.eventId}`);

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
      await sendTelegramHttpRequest(cdLine, signalThreadMap[item.signalId], primaryChat, undefined, undefined, `outbox_cd_${item.eventId}`);
    }

    // Broadcast identical live XAU trade / update to all approved XAU & BOTH subscribers
    if (recipients.length > 1) {
      let threadMapUpdated = false;
      await Promise.all(
        recipients.slice(1).map(async (extraChat) => {
          const threadKey = `${item.signalId}_${extraChat}`;
          const extraReplyTo = isSignalLifecycle && item.type !== 'SIGNAL_CREATED' ? signalThreadMap[threadKey] : undefined;
          const extraRes = await sendTelegramHttpRequest(
            messageText,
            extraReplyTo,
            extraChat,
            undefined,
            undefined,
            `outbox_${item.eventId}_${extraChat}`
          );
          if (extraRes.success && item.type === 'SIGNAL_CREATED' && extraRes.messageId) {
            signalThreadMap[threadKey] = extraRes.messageId;
            threadMapUpdated = true;
          }
          if (extraRes.success && isSignalLifecycle && ['TP4', 'SL', 'BE_STOP', 'TIMEOUT', 'MARKET_CLOSE'].includes(item.type)) {
            const cdLine = formatCooldownLine(35);
            await sendTelegramHttpRequest(
              cdLine,
              signalThreadMap[threadKey],
              extraChat,
              undefined,
              undefined,
              `outbox_cd_${item.eventId}_${extraChat}`
            );
          }
        })
      );
      if (threadMapUpdated) {
        saveThreadMap();
      }
    }

    console.log(`[TELEGRAM WORKER - LIVE] Delivered ${item.type} for ${item.signalId} to ${recipients.length} recipient(s) (msg_id: ${item.telegramMessageId || 'deduped'})`);
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
  const managerState = getFullManagerState();
  const goldPaused = managerState.isPaused;
  const btcPaused = isBtcTidePaused();
  const subs = getAllSubscribersList();
  const pendingCount = subs.filter((s) => s.status === "PENDING").length;

  return {
    inline_keyboard: [
      [
        { text: "📊 Live Status (XAU + BTC)", callback_data: "cmd_status" },
        {
          text: pendingCount > 0 ? `👥 Users (${pendingCount} Pending 🔔)` : "👥 Users (XAU / BTC Access)",
          callback_data: "cmd_users",
        },
      ],
      [
        { text: "🥇 Send Live XAU Signal", callback_data: "cmd_test" },
        { text: "₿ Send Live BTC Signal", callback_data: "cmd_test_btc" },
      ],
      [
        { text: "🟢 XAU BUY (Live)", callback_data: "cmd_xau_buy" },
        { text: "🔴 XAU SELL (Live)", callback_data: "cmd_xau_sell" },
        { text: "🟢 BTC LONG", callback_data: "cmd_btc_long" },
        { text: "🔴 BTC SHORT", callback_data: "cmd_btc_short" },
      ],
      [
        { text: "💰 Gold Price & Bias", callback_data: "cmd_price" },
        { text: "₿ BTC Tide Live", callback_data: "cmd_btc" },
      ],
      [
        { text: "🏛️ Sarraf Atlas Zones", callback_data: "cmd_atlas" },
        { text: "📈 Active Trades & History", callback_data: "cmd_signals" },
      ],
      [
        {
          text: goldPaused ? "▶️ Resume XAU Scanner" : "⏸️ Pause XAU Scanner",
          callback_data: "cmd_toggle_pause",
        },
        {
          text: btcPaused ? "▶️ Resume BTC Scanner" : "⏸️ Pause BTC Scanner",
          callback_data: "cmd_toggle_btc_pause",
        },
      ],
      [
        { text: "🛑 Close XAU / Reset CD", callback_data: "cmd_reset_xau" },
        { text: "🛑 Close BTC / Reset CD", callback_data: "cmd_reset_btc" },
      ],
      [
        { text: "⚙️ Risk & SL/TP", callback_data: "cmd_risk" },
        { text: "🏆 Win Rate & Stats", callback_data: "cmd_stats" },
      ],
      [
        { text: "📰 News & Locks", callback_data: "cmd_news" },
        { text: "🔄 Flush Pending Signals", callback_data: "cmd_flush" },
      ],
    ],
  };
}

// Register Telegram Bot Command Menu:
// - Normal users (default scope) ONLY see /start
// - Admin chat scope sees full XAU + BTC admin control commands
export async function registerBotCommands(token: string, adminChatId?: string | number) {
  try {
    // Ensure no stale webhook blocks getUpdates polling
    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`).catch(() => {});

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

    // 2. Admin-specific command menu
    const adminIds = new Set<string>();
    if (adminChatId) adminIds.add(String(adminChatId));
    const dyn = getDynamicTelegramChatId();
    if (dyn) adminIds.add(String(dyn));
    for (const a of getAllAdmins()) {
      adminIds.add(a.chatId);
    }

    const adminCommands = [
      { command: "start", description: "👑 Open Master Admin Control Panel" },
      { command: "menu", description: "📱 Open XAU + BTC Admin Buttons" },
      { command: "users", description: "👥 Grant XAU / BTC / BOTH User Access" },
      { command: "status", description: "📊 Live Gold + BTC Engine Status" },
      { command: "testsignal", description: "🥇 Dispatch Live XAUUSD Setup Now" },
      { command: "btcsignal", description: "₿ Dispatch Live BTCUSD Setup Now" },
      { command: "btc", description: "₿ Live BTC Tide Orderflow & Trade" },
      { command: "atlas", description: "🏛️ Today Sarraf Atlas Zones & Bias" },
      { command: "signals", description: "📈 Active XAU + BTC Trades & History" },
      { command: "price", description: "💰 Live Gold XAU/USD Quote & Bias" },
      { command: "risk", description: "⚙️ View / Edit SL, TP & Min Score" },
      { command: "stats", description: "🏆 Win Rate & R-Multiple Performance" },
      { command: "pause", description: "⏸️ Pause Gold Scanner" },
      { command: "resume", description: "▶️ Resume Gold Scanner" },
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

function formatMarketLabel(m?: string): string {
  if (m === "XAU") return "🥇 XAU/USD (Gold Only)";
  if (m === "BTC") return "₿ BTC/USD (Bitcoin Only)";
  return "🔥 BOTH (XAU/USD Gold + BTC/USD)";
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

  // If user is APPROVED: show simple clean VIP Subscriber status card (zero admin commands!)
  if (subscriber.status === "APPROVED") {
    const approvedText = [
      "🔱 <b>SARRAF VIP SIGNAL FEED</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      "🟢 <b>Status:</b> Active & Approved Subscriber",
      `👤 <b>Member:</b> ${firstName || username || "VIP Trader"}`,
      `📡 <b>Active Signal Access:</b> <b>${formatMarketLabel(subscriber.markets)}</b>`,
      "",
      "✅ <b>Aapka automatic live signal feed active hai!</b>",
      "Jab bhi koi setup trigger hoga, aapko Admin ke sath bilkul same live trade (Entry, Stop Loss, aur Take Profit updates) automatically yahan milengi.",
    ].join("\n");
    await sendTelegramHttpRequest(approvedText, replyToMessageId, chatId, undefined, "HTML");
    return;
  }

  // If user is BLOCKED
  if (subscriber.status === "BLOCKED") {
    const blockedText = [
      "🚫 <b>ACCESS RESTRICTED</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      "Aapka signal access Admin ki taraf se band hai.",
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
    "Aapki request Admin ko bhej di gayi hai.",
    "Admin jaise hi aapke liye <b>XAU/USD (Gold)</b> ya <b>BTC/USD</b> signals approve karenge, aapko automatic live trades milna shuru ho jayengi!",
  ].join("\n");

  await sendTelegramHttpRequest(pendingText, replyToMessageId, chatId, userPendingKeyboard, "HTML");

  // Notify Admin(s) immediately with 1-tap buttons for XAU Only, BTC Only, BOTH, or Block!
  if (isNewPending || callbackData === "user_check_status") {
    const adminTargets = new Set<string>();
    const dynAdmin = getDynamicTelegramChatId();
    if (dynAdmin) adminTargets.add(dynAdmin);
    for (const a of getAllAdmins()) adminTargets.add(a.chatId);

    const adminNotifyText = [
      "🔔 <b>NEW USER SIGNAL ACCESS REQUEST</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `👤 <b>Name:</b> ${firstName || "Trader"}`,
      `🔗 <b>Username:</b> ${username ? `@${username}` : "No username"}`,
      `🆔 <b>Chat ID:</b> <code>${idStr}</code>`,
      "",
      "👇 <b>Is user ko kaunse signals ka access dena hai? (Tap karein):</b>",
    ].join("\n");

    const approvalKeyboard = {
      inline_keyboard: [
        [
          { text: "🥇 Approve XAUUSD Only", callback_data: `adm_app_xau_${idStr}` },
          { text: "₿ Approve BTC Only", callback_data: `adm_app_btc_${idStr}` },
        ],
        [
          { text: "🔥 Approve BOTH (XAU + BTC)", callback_data: `adm_app_both_${idStr}` },
          { text: "❌ Block / Reject", callback_data: `adm_block_${idStr}` },
        ],
        [{ text: "👥 Open User Manager", callback_data: "cmd_users" }],
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

  // Always ensure LIVE mode is active (dryRun = false) unless Admin explicitly toggles
  if (getCurrentSettings().dryRun) {
    updateSettings({ dryRun: false }, "AutoLiveMode");
  }

  // 1. Admin Login / Owner Claim
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
        "Master Admin Panel activate karne ke liye yeh command bhejein:",
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
      "🟢 <b>LIVE Mode:</b> Always ON (Live Price Execution)",
      "🚀 <b>XAU/USD & BTC/USD automatic trades ab aapke aur approved users ke Telegram par same-to-same jayengi!</b>",
      "",
      "👇 <b>Master Control Panel (Without Opening Website):</b>",
    ].join("\n");
    await sendTelegramHttpRequest(successText, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  // 2. Enforce strict Admin vs User check
  const isAdmin = isChatAdmin(idStr) || (getDynamicTelegramChatId() === idStr);
  if (!isAdmin) {
    if (normAction !== "start" && normAction !== "user_check_status") {
      const sub = getSubscriber(idStr);
      if (sub && sub.status === "APPROVED") {
        await sendTelegramHttpRequest(
          `🔒 <b>Admin Access Only</b>\nAapka VIP Signal Feed (<b>${formatMarketLabel(sub.markets)}</b>) active hai — aapko tamam live signals automatically milenge.`,
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

  registerAdminChat(idStr, fromUser, firstName);
  if (!getDynamicTelegramChatId()) {
    setDynamicTelegramChatId(idStr);
  }

  const managerState = getFullManagerState();
  const settings = getCurrentSettings();

  // 3. Handle 1-tap Market-Specific User Approvals (XAU Only, BTC Only, BOTH, Block)
  if (
    normAction.startsWith("adm_app_xau_") ||
    normAction.startsWith("adm_app_btc_") ||
    normAction.startsWith("adm_app_both_") ||
    normAction.startsWith("adm_approve_")
  ) {
    let marketAccess: "XAU" | "BTC" | "BOTH" = "BOTH";
    let targetUserId = "";
    if (normAction.startsWith("adm_app_xau_")) {
      marketAccess = "XAU";
      targetUserId = normAction.replace("adm_app_xau_", "").trim();
    } else if (normAction.startsWith("adm_app_btc_")) {
      marketAccess = "BTC";
      targetUserId = normAction.replace("adm_app_btc_", "").trim();
    } else if (normAction.startsWith("adm_app_both_")) {
      marketAccess = "BOTH";
      targetUserId = normAction.replace("adm_app_both_", "").trim();
    } else {
      marketAccess = "BOTH";
      targetUserId = normAction.replace("adm_approve_", "").trim();
    }

    const updated = setSubscriberStatus(targetUserId, "APPROVED", marketAccess);
    const labelStr = formatMarketLabel(marketAccess);

    const userWelcome = [
      "✅ <b>VIP SIGNAL ACCESS APPROVED!</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      "Aapka account Admin ne <b>Approve</b> kar diya hai! 🎉",
      `📡 <b>Approved Feed:</b> <b>${labelStr}</b>`,
      "",
      "Ab jab bhi live market setup banega, aapko Admin ke sath bilkul same live trade (Entry, Stop Loss, aur Take Profit updates) automatically is chat mein milengi!",
    ].join("\n");
    await sendTelegramHttpRequest(userWelcome, undefined, targetUserId, undefined, "HTML");

    await sendTelegramHttpRequest(
      `✅ <b>ACCESS UPDATED!</b>\nUser <code>${targetUserId}</code> (@${updated?.username || "user"}) ko <b>${labelStr}</b> ke liye approve kar diya gaya hai.`,
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
      `🚫 <b>USER BLOCKED / REMOVED</b>\nUser <code>${targetUserId}</code> (@${updated?.username || "user"}) ka signal access band kar diya gaya hai.`,
      replyToMessageId,
      chatId,
      getMainControlKeyboard(),
      "HTML"
    );
    return;
  }

  // 4. Master Admin Start / Menu
  if (normAction === "start" || normAction === "menu" || normAction === "bind") {
    setDynamicTelegramChatId(idStr);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) registerBotCommands(token, idStr).catch(() => {});
    setTimeout(() => {
      triggerOutboxProcessing();
      processCommandOutbox().catch(() => {});
    }, 200);

    const allSubs = getAllSubscribersList().filter((s) => s.role === "USER");
    const approvedSubs = allSubs.filter((s) => s.status === "APPROVED");
    const pendingSubs = allSubs.filter((s) => s.status === "PENDING");
    const btc = getBackendSnapshot();

    const text = [
      "👑 <b>SARRAF MASTER ADMIN TERMINAL (XAU + BTC)</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `✅ <b>Admin ID:</b> <code>${chatId}</code> | 🟢 <b>Mode:</b> LIVE AUTO-DISPATCH`,
      `🥇 <b>XAU/USD Scanner:</b> ${managerState.isPaused ? "⏸️ PAUSED" : `🟢 ACTIVE (${managerState.state})`}`,
      `₿ <b>BTC/USD Scanner:</b> ${isBtcTidePaused() ? "⏸️ PAUSED" : `🟢 ACTIVE ($${btc.currentPrice ? btc.currentPrice.toFixed(2) : "--"})`}`,
      `👥 <b>Subscribers:</b> ${approvedSubs.length} Approved | ${pendingSubs.length} Pending`,
      "",
      "🚀 <b>Automatic Live Signal Broadcast:</b>",
      "• Jab bhi XAU/USD ya BTC/USD ka setup banega, woh <b>same trade & same setup</b> Admin aur Approved Users ko foran automatic jayega.",
      "",
      "👇 <b>Complete Remote Control (Without Opening Website):</b>",
    ].join("\n");

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  // 5. Send Live Gold (XAU/USD) Signal at Live Market Price (Same Trade to Admin + XAU/BOTH Users & Tracked in Live Engine)
  if (
    normAction === "test" ||
    normAction === "testsignal" ||
    normAction === "signal_test" ||
    normAction === "xau_buy" ||
    normAction === "xau_sell" ||
    normAction === "buygold" ||
    normAction === "sellgold"
  ) {
    const basePrice = getLiveXauPrice();
    const h1 = getClosedCandles("H1");
    const h1Bias = evaluateStructureBias(h1);
    const forcedDir =
      normAction === "xau_sell" || normAction === "sellgold" || (rawArgs && rawArgs[0]?.toUpperCase() === "SELL")
        ? "SELL"
        : normAction === "xau_buy" || normAction === "buygold" || (rawArgs && rawArgs[0]?.toUpperCase() === "BUY")
        ? "BUY"
        : undefined;
    const direction: "BUY" | "SELL" = forcedDir || (h1Bias.bias === "BEARISH" ? "SELL" : "BUY");

    // Register active live signal in Signal Manager (tracked for automatic TP1-TP4 & SL hits!)
    const liveRec = triggerLiveXauSignalFromTelegram(direction, basePrice);
    // Also sync Command Signal Engine
    triggerLiveCommandSignalFromTelegram(direction, basePrice);

    const xauSignalMsg = formatNewSignalMessage({
      direction: liveRec.direction,
      entry: liveRec.entryTarget,
      sl: liveRec.slTarget,
      tp1: liveRec.tp1Target,
      tp2: liveRec.tp2Target,
      tp3: liveRec.tp3Target,
      tp4: liveRec.tp4Target,
    });

    const recipients = getAllApprovedRecipients(idStr, "XAU");
    let deliveredCount = 0;
    let threadMapUpdated = false;
    for (const rChat of recipients) {
      const r = await sendTelegramHttpRequest(
        xauSignalMsg,
        rChat === idStr ? replyToMessageId : undefined,
        rChat
      );
      if (r.success) {
        deliveredCount++;
        if (r.messageId) {
          if (rChat === idStr) {
            signalThreadMap[liveRec.id] = r.messageId;
          } else {
            signalThreadMap[`${liveRec.id}_${rChat}`] = r.messageId;
          }
          threadMapUpdated = true;
        }
      }
    }
    if (threadMapUpdated) saveThreadMap();

    await sendTelegramHttpRequest(
      `✅ <b>XAU/USD Live Setup (${direction} @ $${liveRec.entryTarget.toFixed(2)}) Dispatched!</b>\nSent to Admin + ${Math.max(0, deliveredCount - 1)} XAU subscriber(s) with identical Entry, SL ($${liveRec.slTarget.toFixed(2)}), and TP1–TP4 targets (Live tracking active).`,
      undefined,
      chatId,
      getMainControlKeyboard(),
      "HTML"
    );
    return;
  }

  // 6. Send Live BTC/USD Signal (Same Trade to Admin + BTC/BOTH Users)
  if (
    normAction === "test_btc" ||
    normAction === "btcsignal" ||
    normAction === "btc_long" ||
    normAction === "btc_short" ||
    normAction === "buybtc" ||
    normAction === "sellbtc"
  ) {
    const forcedSide =
      normAction === "btc_short" || normAction === "sellbtc" || (rawArgs && rawArgs[0]?.toUpperCase() === "SHORT")
        ? "SHORT"
        : normAction === "btc_long" || normAction === "buybtc" || (rawArgs && rawArgs[0]?.toUpperCase() === "LONG")
        ? "LONG"
        : undefined;
    const trade = triggerLiveBtcTideSignalFromTelegram(forcedSide);
    await processCommandOutbox();
    if (trade) {
      const btcRecipients = getAllApprovedRecipients(idStr, "BTC");
      await sendTelegramHttpRequest(
        `✅ <b>BTC/USD Live Setup (${trade.side} @ $${trade.entryPrice.toFixed(2)}) Dispatched!</b>\nSent to Admin + ${Math.max(0, btcRecipients.length - 1)} BTC subscriber(s) with identical Entry, SL ($${trade.slPrice.toFixed(2)}), and TP1–TP3 targets.`,
        replyToMessageId,
        chatId,
        getMainControlKeyboard(),
        "HTML"
      );
    }
    return;
  }

  // 7. Pause / Resume BTC Scanner
  if (normAction === "toggle_btc_pause" || normAction === "pausebtc" || normAction === "resumebtc") {
    const nextPaused =
      normAction === "pausebtc" ? true : normAction === "resumebtc" ? false : !isBtcTidePaused();
    setBtcTidePaused(nextPaused);
    await sendTelegramHttpRequest(
      nextPaused
        ? "⏸️ <b>BTC/USD TIDE SCANNER PAUSED</b>\nAutomatic BTC signal firing is paused. Tap <b>Resume BTC Scanner</b> to re-enable."
        : "▶️ <b>BTC/USD TIDE SCANNER RESUMED</b>\nAutomatic live BTC/USD trade signals are active!",
      replyToMessageId,
      chatId,
      getMainControlKeyboard(),
      "HTML"
    );
    return;
  }

  // 8. Close Active XAU Trade & Reset XAU Cooldown
  if (normAction === "reset_xau" || normAction === "closegold") {
    const liveXau = getLiveXauPrice();
    manualCloseCommandSignal(liveXau);
    resetCommandSignalCooldown();
    resetXauSignalManagerCooldown(liveXau);
    await processCommandOutbox();
    await sendTelegramHttpRequest(
      `✅ <b>XAU/USD Active Trade Closed (@ $${liveXau.toFixed(2)}) & Cooldown Reset!</b>\nGold scanner is now in LIVE SCANNING mode ready for the next setup.`,
      replyToMessageId,
      chatId,
      getMainControlKeyboard(),
      "HTML"
    );
    return;
  }

  // 9. Close Active BTC Trade & Reset BTC Cooldown
  if (normAction === "reset_btc" || normAction === "closebtc") {
    const closed = manualCloseBtcTideTrade();
    resetBtcTideCooldown();
    await processCommandOutbox();
    await sendTelegramHttpRequest(
      closed
        ? `✅ <b>BTC/USD Active Trade (${closed.side}) Closed @ $${closed.closePrice?.toFixed(2)} & Cooldown Reset!</b>`
        : "✅ <b>BTC/USD Cooldown Reset!</b>\nBTC Tide scanner is ready for the next live setup.",
      replyToMessageId,
      chatId,
      getMainControlKeyboard(),
      "HTML"
    );
    return;
  }

  if (normAction === "flush") {
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
      "🔄 <b>OUTBOX FLUSH COMPLETE (LIVE MODE)</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `• <b>XAU/USD Outbox Flushed:</b> ${requeued} items`,
      `• <b>BTC/USD & Command Outbox Delivered:</b> ${cmdRes.delivered} messages`,
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
      `💲 <b>BTC/USDT Live Price:</b> $${btc.currentPrice ? btc.currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "N/A"} (${btc.activeSource})`,
      `📡 <b>Scanner State:</b> ${isBtcTidePaused() ? "⏸️ PAUSED" : "🟢 LIVE AUTO-FIRE"}`,
      `⚖️ <b>Book Imbalance (±0.1% 5s):</b> ${imb}`,
      `📈 <b>Perp Funding Rate:</b> ${btc.perp.fundingRate !== null ? `${(btc.perp.fundingRate * 100).toFixed(4)}%` : "--"}`,
      `🏛️ <b>Open Interest:</b> ${btc.perp.openInterest ? `${Math.round(btc.perp.openInterest).toLocaleString()} BTC` : "--"} (1h Δ: ${btc.perp.oiChange1hPct !== null ? `${btc.perp.oiChange1hPct > 0 ? "+" : ""}${btc.perp.oiChange1hPct}%` : "--"})`,
      `🎯 <b>Decision Score:</b> ${btc.decision.totalScore > 0 ? "+" : ""}${btc.decision.totalScore} (${btc.decision.favoredSide} — Conf: ${btc.decision.confidence}%)`,
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
      lines.push("", `⏳ <b>Active BTC Trade:</b> None (${btc.decision.waitReason || "Monitoring"})`);
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
      `📅 <b>Session Date:</b> ${atlas.date} (Rollover: 22:00 UTC)`,
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
    const newsStatus = getNewsFeedStatus();
    const currentPrice = getLiveXauPrice().toFixed(2);
    const btc = getBackendSnapshot();
    const xauRecipients = getAllApprovedRecipients(idStr, "XAU").length;
    const btcRecipients = getAllApprovedRecipients(idStr, "BTC").length;

    const text = [
      "📊 <b>SARRAF DUAL-ENGINE LIVE STATUS</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      "🟢 <b>Execution Mode:</b> <b>LIVE AUTO-DISPATCH (Always On @ Live Price)</b>",
      `💰 <b>XAU/USD Gold Live:</b> $${currentPrice} (${managerState.isPaused ? "⏸️ PAUSED" : managerState.state})`,
      `₿ <b>BTC/USDT Spot Live:</b> $${btc.currentPrice ? btc.currentPrice.toFixed(2) : "N/A"} (${isBtcTidePaused() ? "⏸️ PAUSED" : "🟢 ACTIVE"})`,
      `🔥 <b>Active BTC Signal:</b> ${btc.activeTrade ? `${btc.activeTrade.side} @ $${btc.activeTrade.entryPrice.toFixed(2)} (${btc.activeTrade.currentR}R)` : "Scanning..."}`,
      `📰 <b>USD News Lock:</b> ${newsStatus.isLockActive ? `🔴 LOCKED (${newsStatus.activeLockEvent?.title})` : "🟢 Unlocked"}`,
      `👥 <b>Active Recipients:</b> ${xauRecipients} on XAU/USD | ${btcRecipients} on BTC/USD`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
    ].join("\n");

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "toggle_pause" || normAction === "pause" || normAction === "resume") {
    if (normAction === "pause" || (!managerState.isPaused && normAction === "toggle_pause")) {
      pauseSignalManager();
      await sendTelegramHttpRequest(
        "⏸️ <b>XAU/USD GOLD SCANNER PAUSED</b>\nTap <b>Resume XAU Scanner</b> to re-enable.",
        replyToMessageId,
        chatId,
        getMainControlKeyboard(),
        "HTML"
      );
    } else {
      resumeSignalManager();
      await sendTelegramHttpRequest(
        "▶️ <b>XAU/USD GOLD SCANNER RESUMED</b>\nLive XAU/USD automatic signal dispatch is active!",
        replyToMessageId,
        chatId,
        getMainControlKeyboard(),
        "HTML"
      );
    }
    return;
  }

  if (normAction === "signals" || normAction === "last") {
    const livePrice = getLiveXauPrice();
    const dash = getSignalManagerPublicState(livePrice);
    const btc = getBackendSnapshot();
    const history = managerState.history || [];

    const lines = [
      "📈 <b>ACTIVE TRADES & RECENT HISTORY (XAU + BTC)</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
    ];

    if (dash.activeSignal) {
      const s = dash.activeSignal;
      lines.push(
        `🥇 <b>Active XAU/USD Trade (${s.direction}):</b>`,
        `• Entry: $${s.entry.toFixed(2)} | SL: $${s.sl.toFixed(2)} | PnL: ${s.livePnLR >= 0 ? "+" : ""}${s.livePnLR}R`,
        ""
      );
    } else {
      lines.push("🥇 <b>Active XAU/USD Trade:</b> Scanning for setup...", "");
    }

    if (btc.activeTrade) {
      const t = btc.activeTrade;
      lines.push(
        `₿ <b>Active BTC/USD Trade (${t.side}):</b>`,
        `• Entry: $${t.entryPrice.toFixed(2)} | SL: $${t.slPrice.toFixed(2)} | TP1: $${t.tp1Price.toFixed(2)} | PnL: ${t.currentR >= 0 ? "+" : ""}${t.currentR}R`,
        ""
      );
    } else {
      lines.push("₿ <b>Active BTC/USD Trade:</b> Scanning for setup...", "");
    }

    lines.push("📜 <b>Recent Closed XAU Signals:</b>");
    if (history.length === 0) {
      lines.push("• No closed XAU signals in current session.");
    } else {
      history.slice(0, 4).forEach((h, idx) => {
        const icon = h.resultClass === "WIN" ? "✅" : h.resultClass === "LOSS" ? "❌" : "⚪";
        lines.push(`${idx + 1}. <code>${h.id}</code> (${h.direction}) → ${icon} <b>${h.resultClass}</b> (${h.realizedR >= 0 ? "+" : ""}${h.realizedR.toFixed(2)}R)`);
      });
    }

    await sendTelegramHttpRequest(lines.join("\n"), replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "price" || normAction === "gold") {
    const livePrice = getLiveXauPrice();
    const h1Bias = evaluateStructureBias(getClosedCandles("H1"));
    const h4Bias = evaluateStructureBias(getClosedCandles("H4"));
    const d1Bias = evaluateStructureBias(getClosedCandles("D1"));

    const text = [
      "💰 <b>XAU/USD GOLD REAL-TIME QUOTE & BIAS</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `💲 <b>Live Price:</b> $${livePrice.toFixed(2)}`,
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
    ];
    if (feed.nextEvent) {
      lines.push(`• Next: <b>${feed.nextEvent.title}</b> (${feed.nextEvent.displayTime || feed.nextEvent.timeUtc})`);
    }
    await sendTelegramHttpRequest(lines.join("\n"), replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "stats") {
    const stats = getSignalStats();
    const btc = getBackendSnapshot();
    const bStats = btc.signalStats || { winsCount: 0, lossesCount: 0, expiredCount: 0, totalClosed: 0 };
    const total = stats.wins + stats.losses + stats.breakevens;
    const winRate = total > 0 ? Math.round((stats.wins / total) * 100) : 0;

    const text = [
      "🏆 <b>SARRAF PERFORMANCE STATS (XAU + BTC)</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `🥇 <b>XAU/USD Record:</b> ${stats.wins}W / ${stats.losses}L / ${stats.breakevens}BE (${winRate}% WR | ${stats.totalR >= 0 ? "+" : ""}${stats.totalR.toFixed(2)}R)`,
      `₿ <b>BTC/USD Phase 6 Record:</b> ${bStats.winsCount}W / ${bStats.lossesCount}L / ${bStats.expiredCount} Exp (Total: ${bStats.totalClosed})`,
    ].join("\n");

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "setsl" && rawArgs && rawArgs.length >= 1) {
    const val = parseFloat(rawArgs[0]);
    if (Number.isFinite(val) && val >= 2 && val <= 50) {
      updateSettings({ slDollars: val }, `TelegramAdmin:${fromUser || chatId}`);
      await sendTelegramHttpRequest(`✅ <b>XAU Stop Loss Updated:</b> $${val.toFixed(2)}`, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
      return;
    }
  }

  if (normAction === "setscore" && rawArgs && rawArgs.length >= 1) {
    const val = parseInt(rawArgs[0], 10);
    if (Number.isFinite(val) && val >= 50 && val <= 98) {
      updateSettings({ minScore: val }, `TelegramAdmin:${fromUser || chatId}`);
      await sendTelegramHttpRequest(`✅ <b>XAU Min Score Updated:</b> ${val}/100`, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
      return;
    }
  }

  if (normAction === "risk") {
    const text = [
      "⚙️ <b>RISK & TARGET CONFIGURATION (XAU + BTC)</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      "🥇 <b>XAU/USD Gold Parameters:</b>",
      `• Stop Loss: $${settings.slDollars.toFixed(2)} (Edit: <code>/setsl 10</code>)`,
      `• TP1–TP4: $${settings.tp1Dollars} / $${settings.tp2Dollars} / $${settings.tp3Dollars} / $${settings.tp4Dollars}`,
      `• Min Confluence Score: ${settings.minScore}/100 (Edit: <code>/setscore 80</code>)`,
      "",
      "₿ <b>BTC/USD Tide Parameters:</b>",
      "• Dynamic 90s Swing + 0.4 ATR Stop (Min 0.08% price floor)",
      "• Targets: TP1 = 1.0R (+BE Move) | TP2 = 2.0R | TP3 = 3.0R",
    ].join("\n");

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  if (normAction === "approve" && rawArgs && rawArgs.length >= 1) {
    const targetId = rawArgs[0].trim();
    const mArg = (rawArgs[1] || "BOTH").toUpperCase();
    const mAccess: "XAU" | "BTC" | "BOTH" = mArg === "XAU" ? "XAU" : mArg === "BTC" ? "BTC" : "BOTH";
    setSubscriberStatus(targetId, "APPROVED", mAccess);
    await sendTelegramHttpRequest(
      `✅ <b>VIP ACCESS APPROVED!</b>\nAapka account Admin ne <b>${formatMarketLabel(mAccess)}</b> signals ke liye approve kar diya hai!`,
      undefined,
      targetId,
      undefined,
      "HTML"
    );
    await sendTelegramHttpRequest(
      `✅ Approved user <code>${targetId}</code> for <b>${formatMarketLabel(mAccess)}</b>`,
      replyToMessageId,
      chatId,
      getMainControlKeyboard(),
      "HTML"
    );
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
    const recipients = getAllApprovedRecipients(idStr, "ALL");
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
    const subs = getAllSubscribersList().filter((s) => s.role === "USER");
    const pending = subs.filter((s) => s.status === "PENDING");
    const approved = subs.filter((s) => s.status === "APPROVED");
    const blocked = subs.filter((s) => s.status === "BLOCKED");

    const lines = [
      "👥 <b>USER ACCESS MANAGER (XAUUSD / BTC / BOTH)</b>",
      "━━━━━━━━━━━━━━━━━━━━━━━━━",
      `✅ <b>Approved Users:</b> ${approved.length} | ⏳ <b>Pending:</b> ${pending.length} | 🚫 <b>Blocked:</b> ${blocked.length}`,
      "",
    ];

    const inlineButtons: any[][] = [];

    if (pending.length > 0) {
      lines.push("🔔 <b>PENDING APPROVAL REQUESTS:</b>");
      for (const p of pending.slice(0, 6)) {
        const label = p.firstName || p.username || p.chatId;
        lines.push(`• <b>${label}</b> ${p.username ? `(@${p.username})` : ""} — ID: <code>${p.chatId}</code>`);
        inlineButtons.push([
          { text: `🥇 ${label}: XAU`, callback_data: `adm_app_xau_${p.chatId}` },
          { text: `₿ ${label}: BTC`, callback_data: `adm_app_btc_${p.chatId}` },
          { text: `🔥 BOTH`, callback_data: `adm_app_both_${p.chatId}` },
          { text: `❌`, callback_data: `adm_block_${p.chatId}` },
        ]);
      }
      lines.push("");
    }

    if (approved.length > 0) {
      lines.push("✅ <b>APPROVED VIP SUBSCRIBERS (Tap to Change Access):</b>");
      for (const a of approved.slice(0, 8)) {
        const label = a.firstName || a.username || a.chatId;
        lines.push(`• <b>${label}</b> [<b>${a.markets || "BOTH"}</b>] — ID: <code>${a.chatId}</code>`);
        inlineButtons.push([
          { text: `🥇 ${label}: XAU`, callback_data: `adm_app_xau_${a.chatId}` },
          { text: `₿ BTC`, callback_data: `adm_app_btc_${a.chatId}` },
          { text: `🔥 BOTH`, callback_data: `adm_app_both_${a.chatId}` },
          { text: `🚫 Block`, callback_data: `adm_block_${a.chatId}` },
        ]);
      }
      lines.push("");
    } else if (pending.length === 0) {
      lines.push("• <i>Abhi koi user list mein nahi hai. Jab koi user bot ko /start karega toh yahan XAU / BTC / BOTH approve buttons aa jayenge.</i>", "");
    }

    lines.push(
      "💡 <b>Direct Commands:</b>",
      "• <code>/approve [id] XAU</code> — Only Gold signals",
      "• <code>/approve [id] BTC</code> — Only BTC signals",
      "• <code>/approve [id] BOTH</code> — Both Gold & BTC signals",
      "• <code>/block [id]</code> — Remove access"
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
      "• <code>/menu</code> — Master Admin Button Panel (XAU + BTC)",
      "• <code>/users</code> — Grant XAU Only, BTC Only, or BOTH access",
      "• <code>/approve [id] [XAU|BTC|BOTH]</code> — Approve user for specific asset",
      "• <code>/testsignal</code> — Send Live Gold (XAU/USD) Signal",
      "• <code>/btcsignal</code> — Send Live Bitcoin (BTC/USD) Signal",
      "• <code>/closegold</code> & <code>/closebtc</code> — Close active trade & reset cooldown",
      "• <code>/broadcast [msg]</code> — Send announcement to all approved users",
    ].join("\n");

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), "HTML");
    return;
  }

  const fallback = "Tap any button below to control XAU/USD & BTC/USD:";
  await sendTelegramHttpRequest(fallback, replyToMessageId, chatId, getMainControlKeyboard());
}

// Poll Telegram Commands and Interactive Buttons via getUpdates (Non-blocking timeout=0, persistent offset)
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
      savePollingOffset(updatePollingOffset);

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

      const msg = update.message;
      if (!msg) continue;

      const incomingChatId = msg.chat?.id;
      const text = (msg.text || "").trim();
      const fromUser = msg.from?.username || "user";
      const firstName = msg.from?.first_name || "Trader";

      if (!incomingChatId) continue;

      if (!text.startsWith("/")) {
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
