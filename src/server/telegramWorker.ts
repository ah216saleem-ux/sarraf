import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  formatNewSignalMessage,
  formatUpdateMessage,
  formatCooldownLine,
  formatAdminAlert,
  formatCommandResponse,
} from './messageTemplates.ts';
import { validateSignalWithGemini } from './geminiValidator.ts';
import {
  getFullManagerState,
  saveSignalsToDisk,
  enterCooldown,
  getSignalStats,
  pauseSignalManager,
  resumeSignalManager,
} from './signalManager.ts';
import { getClosedCandles, getEngineStatus } from './candleEngine.ts';
import { evaluateStructureBias } from './sarrafEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const OUTBOX_FILE = path.resolve(DATA_DIR, 'outbox.json');
const THREAD_MAP_FILE = path.resolve(DATA_DIR, 'telegram_threads.json');

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
let isDryRunActive = process.env.DRY_RUN !== 'false';
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

// Send HTTP message to Telegram API with backoff & 429 handling
async function sendTelegramHttpRequest(
  text: string,
  replyToMessageId?: number
): Promise<{ success: boolean; messageId?: number; error?: string; retryAfterSec?: number }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId || token === '123456789:ABCdefGhIJKlmNoPQRstuVWXyz') {
    return { success: false, error: 'Telegram bot token or target chat ID unconfigured.' };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body: Record<string, any> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };

  if (replyToMessageId) {
    body.reply_to_message_id = replyToMessageId;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

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
      return { success: false, error: data.description || `HTTP ${res.status}` };
    }

    return { success: true, messageId: data.result?.message_id };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network fetch error' };
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
  } else {
    messageText = formatUpdateMessage({
      type: item.type as any,
      realizedDollars: p.realizedDollars,
      slippageDollars: p.slippageDollars,
    });
  }

  item.messageText = messageText;
  item.lastAttemptAt = new Date().toISOString();

  // Check Threading
  const replyToId = item.type !== 'SIGNAL_CREATED' ? signalThreadMap[item.signalId] : undefined;

  // If in DRY RUN mode: log text, do not make real HTTP call
  if (isDryRunActive) {
    console.log(`[TELEGRAM WORKER - DRY RUN] Dispatch for ${item.signalId} (${item.type}):\n${messageText}`);
    item.status = 'SENT';
    item.deliveryMode = 'DRY_RUN';
    item.telegramMessageId = Math.floor(100000 + Math.random() * 900000);

    if (item.type === 'SIGNAL_CREATED') {
      signalThreadMap[item.signalId] = item.telegramMessageId;
      saveThreadMap();
    }

    // Append cooldown line if trade closed
    if (['TP4', 'SL', 'BE_STOP', 'TIMEOUT', 'MARKET_CLOSE'].includes(item.type)) {
      const cdLine = formatCooldownLine(35);
      console.log(`[TELEGRAM WORKER - DRY RUN] Follow-up Cooldown Line:\n${cdLine}`);
    }

    return;
  }

  // LIVE DISPATCH
  const result = await sendTelegramHttpRequest(messageText, replyToId);

  if (result.success && result.messageId) {
    item.status = 'SENT';
    item.deliveryMode = 'LIVE';
    item.telegramMessageId = result.messageId;

    if (item.type === 'SIGNAL_CREATED') {
      signalThreadMap[item.signalId] = result.messageId;
      saveThreadMap();
    }

    // Send cooldown line as reply if trade closed
    if (['TP4', 'SL', 'BE_STOP', 'TIMEOUT', 'MARKET_CLOSE'].includes(item.type)) {
      const cdLine = formatCooldownLine(35);
      await sendTelegramHttpRequest(cdLine, signalThreadMap[item.signalId]);
    }

    console.log(`[TELEGRAM WORKER - LIVE] Delivered ${item.type} for ${item.signalId} (msg_id: ${result.messageId})`);
  } else {
    item.retryCount = (item.retryCount || 0) + 1;
    item.lastError = result.error || 'Failed to dispatch';

    if (item.retryCount >= 5) {
      item.status = 'FAILED';
      console.error(`[TELEGRAM WORKER] Permanently failed event ${item.eventId} after 5 attempts: ${item.lastError}`);
      sendAdminAlert('TELEGRAM_FAILING');
    } else {
      console.warn(`[TELEGRAM WORKER] Event ${item.eventId} attempt ${item.retryCount}/5 failed: ${item.lastError}`);
    }
  }
}

// Background Worker Loop (reads outbox and polls incoming bot commands)
export function startTelegramWorker() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;

  loadThreadMap();
  console.log(`[TELEGRAM WORKER] Background dispatch worker started (DRY_RUN=${isDryRunActive}).`);

  // 1. Outbox Queue Processor (Runs every 1.5s)
  setInterval(async () => {
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
  }, 1500);

  // 2. Incoming Command Long-Polling Loop (Runs every 4s)
  setInterval(async () => {
    if (isDryRunActive) return;
    await pollTelegramCommands();
  }, 4000);
}

// Poll Telegram Commands via getUpdates
async function pollTelegramCommands() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const allowedChatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !allowedChatId || token === '123456789:ABCdefGhIJKlmNoPQRstuVWXyz') return;

  try {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${updatePollingOffset}&timeout=2`;
    const res = await fetch(url);
    if (!res.ok) return;

    const data = await res.json();
    if (!data.ok || !Array.isArray(data.result)) return;

    for (const update of data.result) {
      updatePollingOffset = update.update_id + 1;

      const msg = update.message;
      if (!msg || !msg.text) continue;

      const incomingChatId = msg.chat?.id?.toString();
      // SILENTLY IGNORE any chat that does NOT match TELEGRAM_CHAT_ID exactly
      if (incomingChatId !== allowedChatId.toString()) {
        continue;
      }

      const text = msg.text.trim();
      if (!text.startsWith('/')) continue;

      const command = text.split(' ')[0].toLowerCase();
      const managerState = getFullManagerState();
      const stats = getSignalStats();

      let replyText = '';

      if (command === '/pause') {
        pauseSignalManager();
        replyText = formatCommandResponse('/pause', {});
      } else if (command === '/resume') {
        resumeSignalManager();
        replyText = formatCommandResponse('/resume', {});
      } else if (command === '/status') {
        const cdMins = managerState.cooldownEndsAt
          ? Math.max(0, Math.round((new Date(managerState.cooldownEndsAt).getTime() - Date.now()) / 60000))
          : undefined;
        replyText = formatCommandResponse('/status', {
          state: managerState.state,
          todayCount: managerState.dailySignalsCount,
          cooldownMinutes: cdMins,
        });
      } else if (command === '/stats') {
        replyText = formatCommandResponse('/stats', {
          wins: stats.wins,
          losses: stats.losses,
          breakevens: stats.breakevens,
          totalR: stats.totalR,
        });
      } else if (command === '/last') {
        const lastSig = managerState.history[0];
        const lastSigText = lastSig
          ? `Last Signal: ${lastSig.id} (${lastSig.direction})\nOutcome: ${lastSig.resultClass} (${lastSig.realizedR >= 0 ? '+' : ''}${lastSig.realizedR}R)`
          : 'No signals executed yet.';
        replyText = formatCommandResponse('/last', { lastSignalText: lastSigText });
      } else if (command === '/help') {
        replyText = formatCommandResponse('/help', {});
      }

      if (replyText) {
        await sendTelegramHttpRequest(replyText, msg.message_id);
      }
    }
  } catch (err: any) {
    // Silently continue
  }
}

// Send Admin Alerts with 30-minute throttling per type
export async function sendAdminAlert(type: 'FEED_OFFLINE' | 'FEED_BACK' | 'ENGINE_PAUSED' | 'ENGINE_RESUMED' | 'TELEGRAM_FAILING') {
  const now = Date.now();
  const lastTime = lastAdminAlertTimes[type] || 0;

  // Max once per 30 min per type
  if (now - lastTime < 30 * 60 * 1000) {
    return;
  }

  lastAdminAlertTimes[type] = now;
  const alertText = formatAdminAlert(type);

  if (isDryRunActive) {
    console.log(`[TELEGRAM ADMIN ALERT - DRY RUN] ${alertText}`);
    return;
  }

  await sendTelegramHttpRequest(alertText);
}

// Manual Test Message sender
export async function sendManualTestMessage(adminEmail: string): Promise<{ success: boolean; message: string }> {
  const testText = `[SARRAF TEST] Institutional dispatch test triggered by ${adminEmail} at ${new Date().toUTCString()}.`;

  if (isDryRunActive) {
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

// Dynamic DRY RUN toggle with confirmation
export function setDryRunMode(dryRun: boolean, adminEmail: string): { success: boolean; mode: boolean } {
  isDryRunActive = dryRun;
  console.log(`[TELEGRAM WORKER] Admin ${adminEmail} set DRY_RUN=${isDryRunActive}`);
  return { success: true, mode: isDryRunActive };
}

export function getIsDryRun(): boolean {
  return isDryRunActive;
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

// Get comprehensive worker status
export function getTelegramWorkerStatus(): TelegramWorkerStatus {
  const outbox = readOutbox();
  const pending = outbox.filter((o) => o.status === 'PENDING_DELIVERY').length;
  const sent = outbox.filter((o) => o.status === 'SENT').length;
  const failed = outbox.filter((o) => o.status === 'FAILED').length;

  const lastSent = outbox.filter((o) => o.status === 'SENT').pop();

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const configured = Boolean(token && chatId && token !== '123456789:ABCdefGhIJKlmNoPQRstuVWXyz');

  return {
    botConnected: configured,
    dryRun: isDryRunActive,
    targetChatIdMasked: maskIdentifier(chatId),
    lastMessageSentAt: lastSent?.lastAttemptAt || lastSent?.createdAt,
    lastError: outbox.find((o) => o.status === 'FAILED')?.lastError,
    pendingCount: pending,
    sentCount: sent,
    failedCount: failed,
    totalDelivered: sent,
    recentMessages: outbox.slice(-12).reverse(),
  };
}
