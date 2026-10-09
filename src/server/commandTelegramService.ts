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

const SETTINGS_FILE = path.resolve(DATA_DIR, 'command_telegram_settings.json');
const DYNAMIC_CHAT_FILE = path.resolve(DATA_DIR, 'telegram_chat.json');

export interface CommandTelegramSettings {
  enabled: boolean;          // Default OFF
  sendPaperSignals: boolean; // Default OFF
  lastMessageTime: number | null;
  lastMessageStatus: 'OK' | 'FAILED' | 'NONE';
  lastErrorMessage: string | null;
}

let settings: CommandTelegramSettings = {
  enabled: false,
  sendPaperSignals: false,
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
        sendPaperSignals: Boolean(data.sendPaperSignals),
        lastMessageTime: typeof data.lastMessageTime === 'number' ? data.lastMessageTime : null,
        lastMessageStatus: data.lastMessageStatus || 'NONE',
        lastErrorMessage: data.lastErrorMessage || null,
      };
      console.log(`[SARRAF TELEGRAM] Loaded settings: Enabled=${settings.enabled}, SendPaper=${settings.sendPaperSignals}`);
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
} {
  const rawToken = process.env.TELEGRAM_BOT_TOKEN ? process.env.TELEGRAM_BOT_TOKEN.trim() : null;
  let rawChatId = process.env.TELEGRAM_CHAT_ID ? process.env.TELEGRAM_CHAT_ID.trim() : null;

  const tokenPresent = Boolean(rawToken);
  const chatIdPresent = Boolean(rawChatId);

  // Safe environmental check log (NEVER logs values)
  console.log(`[SARRAF TELEGRAM] Env check: TELEGRAM_BOT_TOKEN=${tokenPresent ? 'present' : 'missing'}, TELEGRAM_CHAT_ID=${chatIdPresent ? 'present' : 'missing'}`);

  // Fallback if env chatId is bot's self username (e.g. @Sarraftelegrambot) and dynamic registered chat ID exists
  if (rawChatId && (rawChatId.startsWith('@') && rawChatId.toLowerCase().includes('bot'))) {
    if (fs.existsSync(DYNAMIC_CHAT_FILE)) {
      try {
        const raw = fs.readFileSync(DYNAMIC_CHAT_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.chatId && !String(parsed.chatId).startsWith('@')) {
          console.log('[SARRAF TELEGRAM] Resolved bot username to registered chat ID from telegram_chat.json');
          rawChatId = String(parsed.chatId);
        }
      } catch {
        // Ignore file read error
      }
    }
  }

  return {
    token: rawToken,
    chatId: rawChatId,
    tokenPresent,
    chatIdPresent,
  };
}

export function isTelegramConfigured(): boolean {
  const { token, chatId } = getCredentials();
  return Boolean(token && chatId);
}

/**
 * Raw send to Telegram without mutating settings (used internally and for verification)
 */
async function sendRawTelegramMessage(
  token: string,
  chatId: string,
  text: string
): Promise<{ success: boolean; error?: string; errorCode?: number }> {
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as any;

    if (res.ok && data.ok) {
      return { success: true };
    }

    const desc = data.description || `HTTP ${res.status}`;
    return { success: false, error: desc, errorCode: data.error_code || res.status };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network fetch error' };
  }
}

/**
 * Sends a message to Telegram with 3 retries, exponential backoff, and rate limiting.
 * Tokens are NEVER logged.
 */
export async function sendTelegramMessageWithRetry(
  text: string,
  maxRetries = 3
): Promise<{ success: boolean; error?: string }> {
  const { token, chatId, tokenPresent, chatIdPresent } = getCredentials();

  if (!tokenPresent || !token) {
    settings.lastMessageStatus = 'FAILED';
    settings.lastErrorMessage = 'TELEGRAM_BOT_TOKEN is missing';
    saveTelegramSettings();
    return { success: false, error: 'TELEGRAM_BOT_TOKEN is missing' };
  }

  if (!chatIdPresent || !chatId) {
    settings.lastMessageStatus = 'FAILED';
    settings.lastErrorMessage = 'TELEGRAM_CHAT_ID is missing';
    saveTelegramSettings();
    return { success: false, error: 'TELEGRAM_CHAT_ID is missing' };
  }

  // Enforce 20 msgs/min rate limit
  if (!checkRateLimit()) {
    const errorMsg = 'Rate limit exceeded (max 20 messages per minute)';
    console.warn(`[SARRAF TELEGRAM SAFE] ${errorMsg}`);
    settings.lastMessageStatus = 'FAILED';
    settings.lastErrorMessage = errorMsg;
    saveTelegramSettings();
    return { success: false, error: errorMsg };
  }

  let attempt = 0;
  let lastSafeError = 'Unknown error';

  while (attempt < maxRetries) {
    attempt++;
    const sendRes = await sendRawTelegramMessage(token, chatId, text);

    if (sendRes.success) {
      settings.lastMessageTime = Date.now();
      settings.lastMessageStatus = 'OK';
      settings.lastErrorMessage = null;
      saveTelegramSettings();
      console.log(`[SARRAF TELEGRAM] Message dispatched successfully on attempt ${attempt}`);
      return { success: true };
    }

    lastSafeError = sendRes.error || 'Failed to dispatch message';
    console.warn(`[SARRAF TELEGRAM SAFE] Attempt ${attempt}/${maxRetries} failed: ${lastSafeError}`);

    if (attempt < maxRetries) {
      // Exponential backoff: 1000ms -> 2000ms
      const delayMs = attempt * 1000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // All retries failed
  settings.lastMessageStatus = 'FAILED';
  settings.lastErrorMessage = lastSafeError;
  saveTelegramSettings();
  console.error(`[SARRAF TELEGRAM SAFE] Message dispatch failed after ${maxRetries} attempts`);
  return { success: false, error: lastSafeError };
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
  const isPaper = signal.isPaper;
  const timeStr = formatTimeUTC(signal.createdAt);
  const lines: string[] = [];

  if (isPaper) {
    lines.push('PAPER');
  }

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

export function formatTargetHitMessage(target: 'TP1' | 'TP2', isPaper: boolean): string {
  const prefix = isPaper ? 'PAPER\n' : '';
  if (target === 'TP1') {
    return `${prefix}✅ XAUUSD | TP1 hit (+$5)`;
  }
  return `${prefix}✅ TP2 hit (+$8)`;
}

export function formatFinalResultMessage(
  reason: SignalCloseReason,
  realizedDollars: number,
  closePrice: number,
  isPaper: boolean
): string {
  const prefix = isPaper ? 'PAPER\n' : '';
  if (reason === 'TP3') {
    return `${prefix}🏆 TP3 hit (+$12)`;
  }
  if (reason === 'SL') {
    return `${prefix}❌ SL hit (-$10)`;
  }
  const sign = realizedDollars >= 0 ? '+' : '-';
  const absVal = Math.abs(realizedDollars).toFixed(2);
  return `${prefix}⚪ Closed manually at ${closePrice.toFixed(2)} (${sign}$${absVal})`;
}

export function formatCooldownMessage(isPaper: boolean): string {
  const prefix = isPaper ? 'PAPER\n' : '';
  return `${prefix}⏳ Cooldown 30 min. Next setup after analysis.`;
}

/**
 * Checks whether the signal is eligible to be sent to Telegram.
 */
function shouldSendSignal(isPaper: boolean): boolean {
  if (!settings.enabled) return false;
  if (!isTelegramConfigured()) return false;
  if (isPaper && !settings.sendPaperSignals) return false;
  return true;
}

/**
 * Signal-Engine Lifecycle Dispatchers
 */
export async function notifyNewSignal(signal: CommandSignal) {
  if (!shouldSendSignal(signal.isPaper)) return;
  const text = formatNewSignalMessage(signal);
  await sendTelegramMessageWithRetry(text);
}

export async function notifyTargetHit(target: 'TP1' | 'TP2', signal: CommandSignal) {
  if (!shouldSendSignal(signal.isPaper)) return;
  const text = formatTargetHitMessage(target, signal.isPaper);
  await sendTelegramMessageWithRetry(text);
}

export async function notifySignalClosed(
  reason: SignalCloseReason,
  realizedDollars: number,
  closePrice: number,
  signal: CommandSignal
) {
  if (!shouldSendSignal(signal.isPaper)) return;
  const resultText = formatFinalResultMessage(reason, realizedDollars, closePrice, signal.isPaper);
  await sendTelegramMessageWithRetry(resultText);

  // Send cooldown notice immediately after result
  const cooldownText = formatCooldownMessage(signal.isPaper);
  await sendTelegramMessageWithRetry(cooldownText);
}

/**
 * Send Test Message
 */
export async function sendTestMessage(): Promise<{ success: boolean; message: string; reasonCode?: TelegramReasonCode }> {
  const { tokenPresent, chatIdPresent, token, chatId } = getCredentials();
  if (!tokenPresent || !token) {
    return { success: false, message: 'TELEGRAM_BOT_TOKEN is missing in environment variables', reasonCode: 'MISSING_TOKEN' };
  }
  if (!chatIdPresent || !chatId) {
    return { success: false, message: 'TELEGRAM_CHAT_ID is missing in environment variables', reasonCode: 'MISSING_CHAT_ID' };
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
 * c) Only if that message is delivered: turn Telegram master toggle ON and "Send paper signals" ON
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
    settings.sendPaperSignals = false;
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

  // Step c: Only if that message is delivered: turn master toggle ON and Send paper signals ON
  if (!sendRes.success) {
    // Delivery failed: keep everything OFF
    settings.enabled = false;
    settings.sendPaperSignals = false;
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

  // Turn ON both master toggle and paper signals
  settings.enabled = true;
  settings.sendPaperSignals = true;
  settings.lastMessageTime = Date.now();
  settings.lastMessageStatus = 'OK';
  settings.lastErrorMessage = null;

  // Step d: Persist the state on the server so it survives restarts
  saveTelegramSettings();

  console.log('[SARRAF TELEGRAM] START SIGNALS activated successfully! Telegram master toggle and Paper signals are now ON.');

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
 * Turns both Telegram master toggle and Send paper signals OFF and persists.
 */
export function stopTelegramSignals(): {
  success: boolean;
  message: string;
  status: TelegramCommandStatus;
} {
  settings.enabled = false;
  settings.sendPaperSignals = false;
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
  const { tokenPresent, chatIdPresent } = getCredentials();
  const configured = tokenPresent && chatIdPresent;

  let reasonCode: TelegramReasonCode = 'OK';
  let reasonMessage = 'Telegram bot is ready and verified.';

  if (!tokenPresent) {
    reasonCode = 'MISSING_TOKEN';
    reasonMessage = 'TELEGRAM_BOT_TOKEN is not configured in server environment.';
  } else if (!chatIdPresent) {
    reasonCode = 'MISSING_CHAT_ID';
    reasonMessage = 'TELEGRAM_CHAT_ID is not configured in server environment.';
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
    sendPaperSignals: settings.sendPaperSignals,
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
  sendPaperSignals?: boolean;
}): TelegramCommandStatus {
  if (typeof patch.enabled === 'boolean') {
    settings.enabled = patch.enabled;
  }
  if (typeof patch.sendPaperSignals === 'boolean') {
    settings.sendPaperSignals = patch.sendPaperSignals;
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
