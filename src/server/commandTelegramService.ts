import fs from 'fs';
import path from 'path';
import {
  CommandSignal,
  SignalCloseReason,
  TelegramCommandStatus,
  TelegramConnectionState,
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
 * Never logs credentials. Never exposes them to the client.
 */
function getCredentials(): { token: string | null; chatId: string | null } {
  const token = process.env.TELEGRAM_BOT_TOKEN ? process.env.TELEGRAM_BOT_TOKEN.trim() : null;
  let chatId = process.env.TELEGRAM_CHAT_ID ? process.env.TELEGRAM_CHAT_ID.trim() : null;

  // Fallback if env chatId is bot self-username and dynamic registered chat ID exists
  if (chatId && chatId.startsWith('@') && chatId.toLowerCase().includes('bot')) {
    if (fs.existsSync(DYNAMIC_CHAT_FILE)) {
      try {
        const raw = fs.readFileSync(DYNAMIC_CHAT_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.chatId && !String(parsed.chatId).startsWith('@')) {
          chatId = String(parsed.chatId);
        }
      } catch {
        // Ignore file read error
      }
    }
  }

  return { token, chatId };
}

export function isTelegramConfigured(): boolean {
  const { token, chatId } = getCredentials();
  return Boolean(token && chatId);
}

/**
 * Sends a message to Telegram with 3 retries, exponential backoff, and rate limiting.
 * Tokens are NEVER logged.
 */
export async function sendTelegramMessageWithRetry(
  text: string,
  maxRetries = 3
): Promise<{ success: boolean; error?: string }> {
  const { token, chatId } = getCredentials();

  if (!token || !chatId) {
    settings.lastMessageStatus = 'FAILED';
    settings.lastErrorMessage = 'Telegram not configured (missing env vars)';
    saveTelegramSettings();
    return { success: false, error: 'Telegram not configured' };
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
        settings.lastMessageTime = Date.now();
        settings.lastMessageStatus = 'OK';
        settings.lastErrorMessage = null;
        saveTelegramSettings();
        console.log(`[SARRAF TELEGRAM] Message dispatched successfully on attempt ${attempt}`);
        return { success: true };
      }

      // Safe error extraction (no token)
      const desc = data.description || `HTTP ${res.status}`;
      lastSafeError = `Telegram API response: ${desc}`;
      console.warn(`[SARRAF TELEGRAM SAFE] Attempt ${attempt}/${maxRetries} failed: ${desc}`);
    } catch (err: any) {
      lastSafeError = err.message || 'Network fetch error';
      console.warn(`[SARRAF TELEGRAM SAFE] Attempt ${attempt}/${maxRetries} network error: ${lastSafeError}`);
    }

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

  lines.push(`XAUUSD | ${signal.side}`);
  lines.push(`Entry: ${signal.entry.toFixed(2)}`);
  lines.push(`SL: ${signal.sl.toFixed(2)}`);
  lines.push(`TP1: ${signal.tp1.toFixed(2)}`);
  lines.push(`TP2: ${signal.tp2.toFixed(2)}`);
  lines.push(`TP3: ${signal.tp3.toFixed(2)}`);
  lines.push(`Time: ${timeStr}`);

  return lines.join('\n');
}

export function formatTargetHitMessage(target: 'TP1' | 'TP2', isPaper: boolean): string {
  const reward = target === 'TP1' ? '+$5' : '+$8';
  const prefix = isPaper ? 'PAPER\n' : '';
  return `${prefix}XAUUSD | ${target} hit (${reward})`;
}

export function formatFinalResultMessage(
  reason: SignalCloseReason,
  realizedDollars: number,
  closePrice: number,
  isPaper: boolean
): string {
  const prefix = isPaper ? 'PAPER\n' : '';
  if (reason === 'TP3') {
    return `${prefix}XAUUSD | TP3 hit (+$12)`;
  }
  if (reason === 'SL') {
    return `${prefix}XAUUSD | SL hit (-$10)`;
  }
  const sign = realizedDollars >= 0 ? '+' : '-';
  const absVal = Math.abs(realizedDollars).toFixed(2);
  return `${prefix}XAUUSD | Closed manually at ${closePrice.toFixed(2)} (${sign}$${absVal})`;
}

export function formatCooldownMessage(isPaper: boolean): string {
  const prefix = isPaper ? 'PAPER\n' : '';
  return `${prefix}Cooldown 30 min. Next setup after analysis.`;
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

export async function sendTestMessage(): Promise<{ success: boolean; message: string }> {
  if (!isTelegramConfigured()) {
    return { success: false, message: 'Telegram not configured (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)' };
  }
  const res = await sendTelegramMessageWithRetry('SARRAF test message OK');
  if (res.success) {
    return { success: true, message: 'SARRAF test message OK sent successfully.' };
  }
  return { success: false, message: res.error || 'Failed to dispatch test message' };
}

/**
 * Status Getter for UI
 */
export function getCommandTelegramStatus(isAdmin: boolean = true): TelegramCommandStatus {
  const configured = isTelegramConfigured();

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
  return getCommandTelegramStatus();
}

// Initialize on module load
loadTelegramSettings();
