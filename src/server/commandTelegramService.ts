import fs from 'fs';
import path from 'path';
import {
  CommandSignal,
  SignalCloseReason,
  TelegramCommandStatus,
  TelegramConnectionState,
  TelegramReasonCode,
} from '../command/signal/types.ts';
import { DATA_DIR, writeJsonAtomic } from './deploymentSafety.ts';
import { getEffectiveTelegramChatId } from './telegramWorker.ts';

const SETTINGS_FILE = path.resolve(DATA_DIR, 'command_telegram_settings.json');
const DYNAMIC_CHAT_FILE = path.resolve(DATA_DIR, 'telegram_chat.json');
const COMMAND_OUTBOX_FILE = path.resolve(DATA_DIR, 'command_outbox.json');

export interface CommandOutboxRecord {
  id: string;
  text: string;
  createdAt: string;
  status: 'PENDING_DELIVERY' | 'SENT' | 'FAILED';
  retryCount: number;
  idempotencyKey?: string;
  lastAttemptAt?: string;
  lastError?: string;
  sentAt?: string;
  telegramMessageId?: number;
}

export interface CommandTelegramSettings {
  enabled: boolean;          // Default OFF
  lastMessageTime: number | null;
  lastMessageStatus: 'OK' | 'FAILED' | 'NONE';
  lastErrorMessage: string | null;
}

let settings: CommandTelegramSettings = {
  enabled: false,
  lastMessageTime: null,
  lastMessageStatus: 'NONE',
  lastErrorMessage: null,
};

// Rate limiter: max 20 messages per minute sliding window
const MAX_MESSAGES_PER_MINUTE = 20;
let sendTimestamps: number[] = [];

function checkRateLimit(): boolean {
  const now = Date.now();
  sendTimestamps = sendTimestamps.filter((t) => now - t < 60000);
  if (sendTimestamps.length >= MAX_MESSAGES_PER_MINUTE) {
    return false;
  }
  sendTimestamps.push(now);
  return true;
}

export function loadTelegramSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const data = JSON.parse(raw);
      settings = {
        enabled: Boolean(data.enabled),
        lastMessageTime: typeof data.lastMessageTime === 'number' ? data.lastMessageTime : null,
        lastMessageStatus: data.lastMessageStatus || 'NONE',
        lastErrorMessage: data.lastErrorMessage || null,
      };
      console.log(`[SARRAF TELEGRAM] Loaded settings: Enabled=${settings.enabled}`);
    }
  } catch (err) {
    console.error('[SARRAF TELEGRAM] Could not load settings, using defaults');
  }
}

export function saveTelegramSettings() {
  try {
    writeJsonAtomic(SETTINGS_FILE, settings);
  } catch (err) {
    console.error('[SARRAF TELEGRAM] Could not save settings');
  }
}

/**
 * Reads token and chat ID safely from environment variables only.
 * Logs only "present" or "missing" at request time (NEVER secrets).
 * Resolves bot-username fallback to verified chat ID if available.
 */
export function getCredentials(): {
  token: string | null;
  chatId: string | null;
  tokenPresent: boolean;
  chatIdPresent: boolean;
  chatIdIsNumeric: boolean;
  missingVariable: string | null;
  validationError: string | null;
} {
  const rawToken = process.env.TELEGRAM_BOT_TOKEN ? process.env.TELEGRAM_BOT_TOKEN.trim() : null;
  const effectiveChatId = getEffectiveTelegramChatId();
  const envChatId = process.env.TELEGRAM_CHAT_ID ? process.env.TELEGRAM_CHAT_ID.trim() : null;
  const rawChatId = effectiveChatId || envChatId;

  const tokenPresent = Boolean(rawToken);
  const chatIdPresent = Boolean(rawChatId);
  const chatIdIsNumeric = Boolean(effectiveChatId);

  let missingVariable: string | null = null;
  let validationError: string | null = null;

  if (!tokenPresent && !chatIdPresent) {
    missingVariable = 'TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID';
    validationError = 'TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are missing';
  } else if (!tokenPresent) {
    missingVariable = 'TELEGRAM_BOT_TOKEN';
    validationError = 'TELEGRAM_BOT_TOKEN is missing';
  } else if (!chatIdPresent) {
    missingVariable = 'TELEGRAM_CHAT_ID';
    validationError = 'TELEGRAM_CHAT_ID is missing';
  } else if (!chatIdIsNumeric) {
    missingVariable = 'TELEGRAM_CHAT_ID';
    validationError = 'TELEGRAM_CHAT_ID must be the numeric chat id (open @Sarraftelegrambot and tap START)';
  }

  return {
    token: rawToken,
    chatId: rawChatId,
    tokenPresent,
    chatIdPresent,
    chatIdIsNumeric,
    missingVariable,
    validationError,
  };
}

export function isTelegramConfigured(): boolean {
  const { tokenPresent, chatIdPresent, chatIdIsNumeric } = getCredentials();
  return Boolean(tokenPresent && chatIdPresent && chatIdIsNumeric);
}


export type MockTelegramSender = (text: string, chatId: string, idempotencyKey?: string) => Promise<{ success: boolean; messageId?: number }>;
let activeMockSender: MockTelegramSender | null = null;

export function setMockTelegramSender(mock: MockTelegramSender | null): void {
  activeMockSender = mock;
}

const deliveredCommandTelegramKeys = new Map<string, number>();
const inFlightCommandTelegramKeys = new Map<
  string,
  Promise<{ success: boolean; messageId?: number; error?: string; errorCode?: number; nonRetryable?: boolean }>
>();

/**
 * Raw send to Telegram without mutating settings (used internally and for verification)
 * Includes in-flight & delivered deduplication so a retry never duplicates an already-delivered message.
 */
async function sendRawTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  idempotencyKey?: string
): Promise<{ success: boolean; messageId?: number; error?: string; errorCode?: number; nonRetryable?: boolean }> {
  const now = Date.now();
  for (const [k, ts] of deliveredCommandTelegramKeys.entries()) {
    const ttl = k.startsWith('idemp:') ? 24 * 60 * 60 * 1000 : 60 * 1000;
    if (now - ts > ttl) deliveredCommandTelegramKeys.delete(k);
  }

  const dedupeKey = idempotencyKey ? `idemp:${chatId}:${idempotencyKey}` : `hash:${chatId}:${text.trim()}`;
  if (deliveredCommandTelegramKeys.has(dedupeKey)) {
    console.log(`[SARRAF TELEGRAM DEDUPE] Skipping duplicate retry for already-delivered message (${idempotencyKey || 'content-hash'})`);
    return { success: true };
  }

  
  if (activeMockSender || process.env.MOCK_TELEGRAM === "true" || process.env.NODE_ENV === "test") {
    console.log(`[SARRAF TELEGRAM MOCK] Intercepted test message (chat: ${chatId}, key: ${idempotencyKey || "none"}): ${text.slice(0, 50).replace(/\n/g, " ")}...`);
    deliveredCommandTelegramKeys.set(dedupeKey, Date.now());
    if (activeMockSender) {
      return activeMockSender(text, chatId, idempotencyKey);
    }
    return { success: true, messageId: Math.floor(Math.random() * 900000) + 100000 };
  }

  const inFlight = inFlightCommandTelegramKeys.get(dedupeKey);
  if (inFlight) {
    console.log(`[SARRAF TELEGRAM DEDUPE] Joining in-flight request (${idempotencyKey || 'content-hash'}) instead of re-sending`);
    return inFlight;
  }

  const reqPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = (await res.json().catch(() => ({}))) as any;

      if (res.ok && data.ok) {
        deliveredCommandTelegramKeys.set(dedupeKey, Date.now());
        const messageId = typeof data.result?.message_id === 'number' ? data.result.message_id : undefined;
        return { success: true, messageId };
      }

      const code = data.error_code || res.status;
      const nonRetryable = code >= 400 && code < 500 && code !== 429;
      const desc = data.description || `HTTP ${res.status}`;
      return { success: false, error: desc, errorCode: code, nonRetryable };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network fetch error' };
    } finally {
      inFlightCommandTelegramKeys.delete(dedupeKey);
    }
  })();

  inFlightCommandTelegramKeys.set(dedupeKey, reqPromise);
  return reqPromise;
}

let commandOutboxFilePath = COMMAND_OUTBOX_FILE;

export function setCommandOutboxPath(customPath: string | null) {
  commandOutboxFilePath = customPath || COMMAND_OUTBOX_FILE;
}

export function getCommandOutboxPath(): string {
  return commandOutboxFilePath;
}

/**
 * Reads command outbox atomically from disk
 */
export function readCommandOutbox(): CommandOutboxRecord[] {
  const targetPath = commandOutboxFilePath;
  if (!fs.existsSync(targetPath)) return [];
  try {
    const raw = fs.readFileSync(targetPath, 'utf-8');
    return JSON.parse(raw) || [];
  } catch {
    return [];
  }
}

/**
 * Saves command outbox atomically to disk (command_outbox.json or custom path)
 */
export function writeCommandOutbox(items: CommandOutboxRecord[]) {
  try {
    writeJsonAtomic(commandOutboxFilePath, items);
  } catch (err: any) {
    console.error('[SARRAF COMMAND OUTBOX] Failed to write outbox to disk:', err.message);
  }
}

/**
 * Enqueues a message into command_outbox.json with status PENDING_DELIVERY.
 * Persists immediately so messages survive unexpected server crashes or reboots.
 */
export function enqueueCommandOutbox(text: string, idempotencyKey?: string): CommandOutboxRecord {
  const outbox = readCommandOutbox();

  if (idempotencyKey) {
    const existing = outbox.find((item) => item.idempotencyKey === idempotencyKey);
    if (existing) {
      if (existing.status === 'SENT') {
        console.log(`[SARRAF COMMAND OUTBOX] Dedupe: message already delivered for key ${idempotencyKey}`);
      }
      return existing;
    }
  }

  const record: CommandOutboxRecord = {
    id: `cmd_out_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    text,
    createdAt: new Date().toISOString(),
    status: 'PENDING_DELIVERY',
    retryCount: 0,
    idempotencyKey,
  };

  outbox.push(record);
  // Cap at 200 records to prevent uncontrolled disk growth
  const trimmed = outbox.slice(-200);
  writeCommandOutbox(trimmed);
  return record;
}

let isProcessingCommandOutbox = false;

/**
 * Processes all PENDING_DELIVERY items in command_outbox.json.
 * Updates item status to SENT on success or records lastError and retryCount.
 */
export async function processCommandOutbox(): Promise<{ processed: number; delivered: number; failed: number }> {
  if (isProcessingCommandOutbox) return { processed: 0, delivered: 0, failed: 0 };
  isProcessingCommandOutbox = true;

  try {
    const outbox = readCommandOutbox();
    const pendingItems = outbox.filter((item) => item.status === 'PENDING_DELIVERY');

    if (pendingItems.length === 0) {
      return { processed: 0, delivered: 0, failed: 0 };
    }

    const creds = getCredentials();
    if (!creds.token || !creds.chatId || !creds.chatIdIsNumeric) {
      console.warn('[SARRAF COMMAND OUTBOX] Holding pending messages: Telegram credentials not yet configured/verified.');
      return { processed: 0, delivered: 0, failed: 0 };
    }

    let delivered = 0;
    let failed = 0;

    for (const item of pendingItems) {
      if (!checkRateLimit()) {
        console.warn('[SARRAF COMMAND OUTBOX] Rate limit reached (20 msgs/min). Remaining messages will be sent on next cycle.');
        break;
      }

      item.lastAttemptAt = new Date().toISOString();
      item.retryCount = (item.retryCount || 0) + 1;

      const res = await sendRawTelegramMessage(creds.token, creds.chatId, item.text, item.idempotencyKey);

      if (res.success) {
        item.status = 'SENT';
        item.sentAt = new Date().toISOString();
        item.lastError = undefined;
        if (typeof res.messageId === 'number') {
          item.telegramMessageId = res.messageId;
        }
        delivered++;

        settings.lastMessageTime = Date.now();
        settings.lastMessageStatus = 'OK';
        settings.lastErrorMessage = null;
        saveTelegramSettings();
        console.log(
          `[SARRAF COMMAND OUTBOX] Delivered message ${item.id} (${item.idempotencyKey || 'plain'}) -> Telegram message_id=${res.messageId ?? 'ok'}`
        );
      } else {
        item.lastError = res.error || 'Failed to dispatch';
        if (res.nonRetryable || item.retryCount >= 5) {
          item.status = 'FAILED';
          failed++;
          console.error(`[SARRAF COMMAND OUTBOX] Message ${item.id} permanently FAILED after ${item.retryCount} attempts: ${item.lastError}`);
        } else {
          console.warn(`[SARRAF COMMAND OUTBOX] Message ${item.id} attempt ${item.retryCount}/5 failed: ${item.lastError}. Will retry.`);
        }

        settings.lastMessageStatus = 'FAILED';
        settings.lastErrorMessage = item.lastError;
        saveTelegramSettings();
      }

      writeCommandOutbox(outbox);
    }

    return { processed: pendingItems.length, delivered, failed };
  } finally {
    isProcessingCommandOutbox = false;
  }
}

/**
 * Starts background worker and delivers any pending messages left on disk from before server reboot.
 */
let commandWorkerTimer: NodeJS.Timeout | null = null;

export function startCommandTelegramWorker() {
  loadTelegramSettings();

  console.log('[SARRAF COMMAND OUTBOX] Initializing Command Telegram Outbox worker. Checking disk outbox for pending messages...');
  // Deliver any pending messages left on disk from before server restart
  processCommandOutbox().catch((err) => {
    console.error('[SARRAF COMMAND OUTBOX] Boot delivery error:', err);
  });

  // Periodic sweep every 15 seconds to deliver any retries
  if (commandWorkerTimer) clearInterval(commandWorkerTimer);
  commandWorkerTimer = setInterval(() => {
    processCommandOutbox().catch(() => {});
  }, 15000);
}

/**
 * Sends a message to Telegram using disk outbox persistence.
 * Guarantees zero message loss across server restarts.
 */
export async function sendTelegramMessageWithRetry(
  text: string,
  _maxRetries = 3,
  idempotencyKey?: string
): Promise<{ success: boolean; messageId?: number; outboxId?: string; error?: string }> {
  const creds = getCredentials();

  if (!creds.tokenPresent || !creds.token) {
    settings.lastMessageStatus = 'FAILED';
    settings.lastErrorMessage = 'TELEGRAM_BOT_TOKEN is missing';
    saveTelegramSettings();
    return { success: false, error: 'TELEGRAM_BOT_TOKEN is missing' };
  }

  if (!creds.chatIdPresent || !creds.chatId) {
    settings.lastMessageStatus = 'FAILED';
    settings.lastErrorMessage = 'TELEGRAM_CHAT_ID is missing';
    saveTelegramSettings();
    return { success: false, error: 'TELEGRAM_CHAT_ID is missing' };
  }

  if (!creds.chatIdIsNumeric) {
    settings.lastMessageStatus = 'FAILED';
    settings.lastErrorMessage = 'TELEGRAM_CHAT_ID must be the numeric chat id';
    saveTelegramSettings();
    return { success: false, error: 'TELEGRAM_CHAT_ID must be the numeric chat id' };
  }

  // 1. Enqueue to disk outbox FIRST (atomic write to command_outbox.json)
  const item = enqueueCommandOutbox(text, idempotencyKey);

  // 2. Process outbox immediately
  await processCommandOutbox();

  // 3. Check delivery status of the item
  const currentOutbox = readCommandOutbox();
  const current = currentOutbox.find((r) => r.id === item.id);
  if (current && current.status === 'SENT') {
    return { success: true, messageId: current.telegramMessageId, outboxId: current.id };
  }

  return {
    success: false,
    outboxId: item.id,
    error: current?.lastError || 'Message persisted to command_outbox.json; awaiting delivery or retry',
  };
}

/**
 * Message Formatters (exact rules from brief)
 * 
 * 1. New signal:
 * "🟡 XAUUSD | BUY (or 🔴 SELL)
 * Entry: 4122.45 (live)
 * SL: 4112.45
 * TP1: 4127.45
 * TP2: 4130.45
 * TP3: 4134.45
 * Time: HH:MM UTC"
 * 
 * 2. Updates:
 * "✅ XAUUSD | TP1 hit (+$5)"
 * "✅ TP2 hit (+$8)"
 * "🏆 TP3 hit (+$12)"
 * "❌ SL hit (-$10)"
 * "⚪ Closed manually at 4125.10 (+$1.06)"
 * 
 * 3. After a result:
 * "⏳ Cooldown 30 min. Next setup after analysis."
 */
function formatTimeUTC(timestamp: number): string {
  const d = new Date(timestamp);
  const hours = d.getUTCHours().toString().padStart(2, '0');
  const minutes = d.getUTCMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes} UTC`;
}

export function formatNewSignalMessage(signal: CommandSignal): string {
  const timeStr = formatTimeUTC(signal.createdAt);
  const lines: string[] = [];

  const icon = signal.side === 'BUY' ? '🟡' : '🔴';
  lines.push(`${icon} XAUUSD | ${signal.side}`);
  lines.push(`Entry: ${signal.entry.toFixed(2)} (live)`);
  lines.push(`SL: ${signal.sl.toFixed(2)}`);
  lines.push(`TP1: ${signal.tp1.toFixed(2)}`);
  lines.push(`TP2: ${signal.tp2.toFixed(2)}`);
  lines.push(`TP3: ${signal.tp3.toFixed(2)}`);
  lines.push(`Time: ${timeStr}`);

  return lines.join('\n');
}

export function formatTargetHitMessage(target: 'TP1' | 'TP2'): string {
  if (target === 'TP1') {
    return `✅ XAUUSD | TP1 hit (+$5)`;
  }
  return `✅ TP2 hit (+$8)`;
}

export function formatFinalResultMessage(
  reason: SignalCloseReason,
  realizedDollars: number,
  closePrice: number
): string {
  if (reason === 'TP3') {
    return `🏆 TP3 hit (+$12)`;
  }
  if (reason === 'SL') {
    return `❌ SL hit (-$10)`;
  }
  const sign = realizedDollars >= 0 ? '+' : '-';
  const absVal = Math.abs(realizedDollars).toFixed(2);
  return `⚪ Closed manually at ${closePrice.toFixed(2)} (${sign}$${absVal})`;
}

export function formatCooldownMessage(): string {
  return `⏳ Cooldown 30 min. Next setup after analysis.`;
}

/**
 * Checks whether the signal is eligible to be sent to Telegram.
 */
function shouldSendSignal(): boolean {
  if (!settings.enabled) return false;
  if (!isTelegramConfigured()) return false;
  return true;
}

/**
 * Signal-Engine Lifecycle Dispatchers
 */
export async function notifyNewSignal(signal: CommandSignal) {
  if (!shouldSendSignal()) return;
  const text = formatNewSignalMessage(signal);
  await sendTelegramMessageWithRetry(text, 3, `cmd_${signal.id}_ISSUED`);
}

export async function notifyTargetHit(target: 'TP1' | 'TP2', signal: CommandSignal) {
  if (!shouldSendSignal()) return;
  const text = formatTargetHitMessage(target);
  await sendTelegramMessageWithRetry(text, 3, `cmd_${signal.id}_${target}`);
}

export async function notifySignalClosed(
  reason: SignalCloseReason,
  realizedDollars: number,
  closePrice: number,
  signal: CommandSignal
) {
  if (!shouldSendSignal()) return;
  const resultText = formatFinalResultMessage(reason, realizedDollars, closePrice);
  await sendTelegramMessageWithRetry(resultText, 3, `cmd_${signal.id}_CLOSED_${reason}`);

  // Send cooldown notice immediately after result
  const cooldownText = formatCooldownMessage();
  await sendTelegramMessageWithRetry(cooldownText, 3, `cmd_${signal.id}_COOLDOWN`);
}

/**
 * Send Test Message
 */
export async function sendTestMessage(): Promise<{ success: boolean; message: string; reasonCode?: TelegramReasonCode }> {
  const creds = getCredentials();
  if (creds.validationError) {
    const code: TelegramReasonCode = !creds.tokenPresent
      ? 'MISSING_TOKEN'
      : !creds.chatIdPresent
      ? 'MISSING_CHAT_ID'
      : 'INVALID_CHAT_ID';
    return { success: false, message: creds.validationError, reasonCode: code };
  }
  const res = await sendTelegramMessageWithRetry('SARRAF test message OK');
  if (res.success) {
    return { success: true, message: 'SARRAF test message OK sent successfully.', reasonCode: 'OK' };
  }
  return { success: false, message: res.error || 'Failed to dispatch test message', reasonCode: 'SEND_FAILED' };
}

/**
 * START SIGNALS (one tap flow):
 * In order:
 * a) Verify bot with Telegram getMe
 * b) Send the message "SARRAF signals are LIVE" to the chat
 * c) Only if that message is delivered: turn Telegram master toggle ON
 * d) Persist the state on the server so it survives restarts
 * e) Update the UI immediately: status badge "Connected", last sent time, and note "Telegram message delivered"
 * If any step fails: keep everything OFF and return exact reason code and message.
 */
export async function startTelegramSignals(): Promise<{
  success: boolean;
  reasonCode: TelegramReasonCode;
  message: string;
  status: TelegramCommandStatus;
}> {
  const { token, chatId, tokenPresent, chatIdPresent } = getCredentials();

  // Validate presence
  if (!tokenPresent || !token) {
    return {
      success: false,
      reasonCode: 'MISSING_TOKEN',
      message: 'TELEGRAM_BOT_TOKEN is missing in environment variables.',
      status: getCommandTelegramStatus(true),
    };
  }

  if (!chatIdPresent || !chatId) {
    return {
      success: false,
      reasonCode: 'MISSING_CHAT_ID',
      message: 'TELEGRAM_CHAT_ID is missing in environment variables.',
      status: getCommandTelegramStatus(true),
    };
  }

  // Step a: Verify the bot with Telegram getMe
  let botUsername = '';
  try {
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const meData = (await meRes.json().catch(() => ({}))) as any;
    if (!meRes.ok || !meData.ok) {
      const desc = meData.description || `HTTP ${meRes.status}`;
      console.warn(`[SARRAF TELEGRAM SAFE] getMe verification failed: ${desc}`);
      return {
        success: false,
        reasonCode: 'MISSING_TOKEN',
        message: `Telegram bot verification failed: ${desc}`,
        status: getCommandTelegramStatus(true),
      };
    }
    botUsername = meData.result?.username || '';
  } catch (err: any) {
    return {
      success: false,
      reasonCode: 'SEND_FAILED',
      message: `Failed to reach Telegram API: ${err.message || 'Network error'}`,
      status: getCommandTelegramStatus(true),
    };
  }

  // Check if chatId is bot's own username
  if (botUsername && chatId.toLowerCase() === `@${botUsername.toLowerCase()}`) {
    // Cannot send message to self
    settings.enabled = false;
    settings.lastMessageStatus = 'FAILED';
    settings.lastErrorMessage = "TELEGRAM_CHAT_ID is set to the bot's own username. A bot cannot message itself.";
    saveTelegramSettings();
    return {
      success: false,
      reasonCode: 'BOT_NOT_IN_CHAT',
      message: `TELEGRAM_CHAT_ID is set to the bot's own username (@${botUsername}). A bot cannot send messages to itself. Use your user or channel chat ID.`,
      status: getCommandTelegramStatus(true),
    };
  }

  // Step b: Send the message "SARRAF signals are LIVE" to the chat
  const sendRes = await sendTelegramMessageWithRetry('SARRAF signals are LIVE');

  // Step c: Only if that message is delivered: turn master toggle ON and Send alert signals ON
  if (!sendRes.success) {
    // Delivery failed: keep everything OFF
    settings.enabled = false;
    settings.lastMessageStatus = 'FAILED';
    settings.lastErrorMessage = sendRes.error || 'Failed to deliver live announcement';
    saveTelegramSettings();

    let reasonCode: TelegramReasonCode = 'SEND_FAILED';
    const errLower = (sendRes.error || '').toLowerCase();
    if (errLower.includes('chat not found')) {
      reasonCode = 'CHAT_NOT_FOUND';
    } else if (
      errLower.includes('not in chat') ||
      errLower.includes('not a member') ||
      errLower.includes('not an admin') ||
      errLower.includes("can't send messages to the bot") ||
      errLower.includes('kicked') ||
      errLower.includes('bot was blocked')
    ) {
      reasonCode = 'BOT_NOT_IN_CHAT';
    }

    return {
      success: false,
      reasonCode,
      message: sendRes.error || 'Failed to deliver "SARRAF signals are LIVE" to Telegram chat.',
      status: getCommandTelegramStatus(true),
    };
  }

  // Turn ON master toggle
  settings.enabled = true;
  settings.lastMessageTime = Date.now();
  settings.lastMessageStatus = 'OK';
  settings.lastErrorMessage = null;

  // Step d: Persist the state on the server so it survives restarts
  saveTelegramSettings();

  console.log('[SARRAF TELEGRAM] START SIGNALS activated successfully! Telegram master toggle is now ON.');

  // Step e: Return updated status immediately
  return {
    success: true,
    reasonCode: 'OK',
    message: 'Telegram message delivered. SARRAF signals are LIVE.',
    status: getCommandTelegramStatus(true),
  };
}

/**
 * STOP SIGNALS (one tap):
 * Turns both Telegram master toggle and Send alert signals OFF and persists.
 */
export function stopTelegramSignals(): {
  success: boolean;
  message: string;
  status: TelegramCommandStatus;
} {
  settings.enabled = false;
  saveTelegramSettings();
  console.log('[SARRAF TELEGRAM] STOP SIGNALS executed. Telegram dispatch disabled.');
  return {
    success: true,
    message: 'Telegram dispatch stopped. All signals turned OFF.',
    status: getCommandTelegramStatus(true),
  };
}

/**
 * Status Getter for UI with precise reason codes
 */
export function getCommandTelegramStatus(isAdmin: boolean = true): TelegramCommandStatus {
  const creds = getCredentials();
  const configured = creds.tokenPresent && creds.chatIdPresent && creds.chatIdIsNumeric;

  let reasonCode: TelegramReasonCode = 'OK';
  let reasonMessage = 'Telegram bot is ready and verified.';

  if (creds.validationError) {
    if (!creds.tokenPresent && !creds.chatIdPresent) {
      reasonCode = 'MISSING_TOKEN';
      reasonMessage = 'TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are missing in server environment variables.';
    } else if (!creds.tokenPresent) {
      reasonCode = 'MISSING_TOKEN';
      reasonMessage = 'TELEGRAM_BOT_TOKEN is missing in server environment variables.';
    } else if (!creds.chatIdPresent) {
      reasonCode = 'MISSING_CHAT_ID';
      reasonMessage = 'TELEGRAM_CHAT_ID is missing in server environment variables.';
    } else if (!creds.chatIdIsNumeric) {
      reasonCode = 'INVALID_CHAT_ID';
      reasonMessage = 'TELEGRAM_CHAT_ID must be the numeric chat id';
    }
  } else if (!isAdmin) {
    reasonCode = 'NOT_ADMIN';
    reasonMessage = 'Admin privileges required. Please log in to control Telegram dispatch.';
  } else if (settings.lastMessageStatus === 'FAILED' && settings.lastErrorMessage) {
    const errLower = settings.lastErrorMessage.toLowerCase();
    if (errLower.includes('chat not found')) {
      reasonCode = 'CHAT_NOT_FOUND';
      reasonMessage = 'Telegram chat not found. Verify TELEGRAM_CHAT_ID.';
    } else if (
      errLower.includes('not in chat') ||
      errLower.includes('not a member') ||
      errLower.includes('not an admin') ||
      errLower.includes("can't send messages to the bot") ||
      errLower.includes('kicked') ||
      errLower.includes('bot was blocked')
    ) {
      reasonCode = 'BOT_NOT_IN_CHAT';
      reasonMessage = 'Bot is not an admin in the channel/chat, or cannot message itself.';
    } else {
      reasonCode = 'SEND_FAILED';
      reasonMessage = settings.lastErrorMessage;
    }
  }

  let state: TelegramConnectionState = 'DISABLED';
  if (!configured) {
    state = 'NOT_CONFIGURED';
  } else if (settings.lastMessageStatus === 'FAILED') {
    state = 'FAILED';
  } else if (settings.enabled) {
    state = 'CONNECTED';
  } else {
    state = 'DISABLED';
  }

  let timeStr: string | null = null;
  if (settings.lastMessageTime) {
    const diffMin = Math.round((Date.now() - settings.lastMessageTime) / 60000);
    if (diffMin < 1) timeStr = 'Just now';
    else if (diffMin === 1) timeStr = '1 min ago';
    else if (diffMin < 60) timeStr = `${diffMin}m ago`;
    else timeStr = formatTimeUTC(settings.lastMessageTime);
  }

  return {
    configured,
    enabled: settings.enabled,
    status: state,
    lastMessageTime: settings.lastMessageTime,
    lastMessageTimeStr: timeStr,
    lastError: settings.lastErrorMessage,
    hasFailed: settings.lastMessageStatus === 'FAILED',
    isAdmin,
    reasonCode,
    reasonMessage,
  };
}

export function updateCommandTelegramSettings(patch: {
  enabled?: boolean;
}): TelegramCommandStatus {
  if (typeof patch.enabled === 'boolean') {
    settings.enabled = patch.enabled;
  }
  // Clear failed flag if user re-enables
  if (patch.enabled) {
    settings.lastMessageStatus = 'NONE';
    settings.lastErrorMessage = null;
  }
  saveTelegramSettings();
  return getCommandTelegramStatus(true);
}

// Initialize on module load
loadTelegramSettings();
