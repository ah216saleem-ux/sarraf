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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const OUTBOX_FILE = path.resolve(DATA_DIR, 'outbox.json');
const THREAD_MAP_FILE = path.resolve(DATA_DIR, 'telegram_threads.json');
const DYNAMIC_CHAT_FILE = path.resolve(DATA_DIR, 'telegram_chat.json');

let dynamicChatId: string | null = null;

export function getDynamicTelegramChatId(): string | null {
  if (dynamicChatId) return dynamicChatId;
  if (fs.existsSync(DYNAMIC_CHAT_FILE)) {
    try {
      const data = fs.readFileSync(DYNAMIC_CHAT_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed.chatId === 'string') {
        dynamicChatId = parsed.chatId;
        return dynamicChatId;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export function setDynamicTelegramChatId(id: string) {
  dynamicChatId = id;
  try {
    ensureDataDir();
    fs.writeFileSync(DYNAMIC_CHAT_FILE, JSON.stringify({ chatId: id }, null, 2), 'utf-8');
    console.log(`[TELEGRAM WORKER] Dynamic target chat ID updated to: ${id}`);
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

// Send HTTP message to Telegram API with backoff & 429 handling, supporting inline keyboards and parse modes
export async function sendTelegramHttpRequest(
  text: string,
  replyToMessageId?: number,
  targetChatId?: string | number,
  replyMarkup?: any,
  parseMode?: 'HTML' | 'Markdown'
): Promise<{ success: boolean; messageId?: number; error?: string; retryAfterSec?: number }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = targetChatId || getDynamicTelegramChatId() || process.env.TELEGRAM_CHAT_ID;

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

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  if (parseMode) {
    body.parse_mode = parseMode;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

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
    if (isSignalLifecycle && ['TP4', 'SL', 'BE_STOP', 'TIMEOUT', 'MARKET_CLOSE'].includes(item.type)) {
      const cdLine = formatCooldownLine(35);
      await sendTelegramHttpRequest(cdLine, signalThreadMap[item.signalId]);
    }

    console.log(`[TELEGRAM WORKER - LIVE] Delivered ${item.type} for ${item.signalId} (msg_id: ${result.messageId})`);
  } else {
    item.retryCount = (item.retryCount || 0) + 1;
    item.lastError = result.error || 'Failed to dispatch';

    const isFatalError = result.error && (
      result.error.includes('Forbidden:') ||
      result.error.includes('chat not found') ||
      result.error.includes('deactivated')
    );

    if (isFatalError) {
      item.status = 'FAILED';
      console.error(`[TELEGRAM WORKER] Fatal delivery error for event ${item.eventId}: ${item.lastError}. Retries aborted.`);
      console.error(`[TELEGRAM WORKER] ADVICE: If the error is 'Forbidden: the bot can't send messages to the bot', this means TELEGRAM_CHAT_ID is set incorrectly (it might be set to the bot's own ID/username). Please run the '/setchat <username> <password>' command in your target Telegram chat or group to register it dynamically!`);
      
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

// Generate interactive inline keyboard for Telegram Admin Dashboard
export function getMainControlKeyboard() {
  const dryRun = getIsDryRun();
  const managerState = getFullManagerState();
  const isPaused = managerState.isPaused;

  return {
    inline_keyboard: [
      [
        { text: '📊 Live Status', callback_data: 'cmd_status' },
        { text: '⚡ Send Test Signal', callback_data: 'cmd_test' },
      ],
      [
        { text: dryRun ? '🔴 Switch to LIVE Mode' : '🟡 Switch to DRY RUN', callback_data: 'cmd_toggle_dryrun' },
        { text: isPaused ? '▶️ Resume Engine' : '⏸️ Pause Engine', callback_data: 'cmd_toggle_pause' },
      ],
      [
        { text: '📈 Active & History', callback_data: 'cmd_signals' },
        { text: '💰 Gold Price & Bias', callback_data: 'cmd_price' },
      ],
      [
        { text: '📰 News & Locks', callback_data: 'cmd_news' },
        { text: '🏆 Performance Stats', callback_data: 'cmd_stats' },
      ],
      [
        { text: '⚙️ Risk Parameters', callback_data: 'cmd_risk' },
        { text: '👥 Channels & Users', callback_data: 'cmd_users' },
      ],
    ],
  };
}

// Register Telegram Bot Command Menu with Telegram API for native client menu button
export async function registerBotCommands(token: string) {
  try {
    const url = `https://api.telegram.org/bot${token}/setMyCommands`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
          { command: 'start', description: '🚀 Main Control Terminal & Interactive Dashboard' },
          { command: 'menu', description: '📱 Open Interactive Control Buttons' },
          { command: 'status', description: '📊 Live Engine, Price, Cooldown & Outbox Status' },
          { command: 'testsignal', description: '⚡ Send Live Sample Gold Trade Signal' },
          { command: 'signals', description: '📈 Active Trade & Last Executed Signals' },
          { command: 'dryrun', description: '🔄 Toggle DRY RUN / LIVE Dispatch Mode' },
          { command: 'price', description: '💰 Live Gold XAU/USD Quote & Structure Biases' },
          { command: 'news', description: '📰 Upcoming USD High Impact Events & Lock Windows' },
          { command: 'stats', description: '🏆 Performance Win Rate & Net R Gains' },
          { command: 'risk', description: '⚙️ Stop Loss & Take Profit Target Parameters' },
          { command: 'users', description: '👥 Connected Channels, Admin & Webhook Status' },
          { command: 'pause', description: '⏸️ Pause Automated Signal Manager' },
          { command: 'resume', description: '▶️ Resume Automated Signal Manager' },
          { command: 'help', description: '❓ Complete Command Manual & Remote Guide' },
        ],
      }),
    });
    if (res.ok) {
      console.log('[TELEGRAM WORKER] Bot commands menu registered successfully with Telegram API.');
    }
  } catch (err: any) {
    console.warn('[TELEGRAM WORKER] Failed to register bot commands menu:', err.message);
  }
}

// Universal handler for commands and inline buttons
async function executeTelegramAction(
  action: string,
  chatId: string | number,
  replyToMessageId?: number,
  fromUser?: string,
  rawArgs?: string[]
): Promise<void> {
  const normAction = action.toLowerCase().replace(/^\//, '').replace(/^cmd_/, '');
  const managerState = getFullManagerState();
  const settings = getCurrentSettings();
  const dryRun = getIsDryRun();

  console.log(`[TELEGRAM ADMIN] Executing action "${normAction}" for Chat ID ${chatId} (${fromUser || 'admin'})`);

  if (normAction === 'start' || normAction === 'menu') {
    const text = [
      '🔱 <b>SARRAF INSTITUTIONAL COMMAND TERMINAL</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `📡 <b>Target Chat ID:</b> <code>${chatId}</code>`,
      `⚙️ <b>Execution Mode:</b> ${dryRun ? '🟡 DRY RUN (SIMULATION)' : '🟢 LIVE DISPATCH'}`,
      `⚡ <b>Scanner State:</b> ${managerState.isPaused ? '⏸️ PAUSED' : managerState.state}`,
      `📊 <b>Daily Signals:</b> ${managerState.dailySignalsCount} sent today | <b>Max:</b> Unlimited`,
      `⏱️ <b>Cooldown:</b> ${managerState.cooldownEndsAt ? '⏳ Active Cooldown' : '✅ Active Scanning'}`,
      '',
      '👇 <b>Quick Control Panel (Tap any button below):</b>',
    ].join('\n');

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), 'HTML');
    return;
  }

  if (normAction === 'status') {
    const engineStatus = getEngineStatus();
    const newsStatus = getNewsFeedStatus();
    const workerStatus = getTelegramWorkerStatus();
    const candleStore = getCandleStore();
    const latestM15 = candleStore.M15[candleStore.M15.length - 1];
    const currentPrice = latestM15 ? latestM15.close.toFixed(2) : 'N/A';

    const cdMins = managerState.cooldownEndsAt
      ? Math.max(0, Math.round((new Date(managerState.cooldownEndsAt).getTime() - Date.now()) / 60000))
      : 0;

    const text = [
      '📊 <b>SARRAF REAL-TIME TERMINAL AUDIT</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `💰 <b>XAU/USD Gold:</b> $${currentPrice}`,
      `⚡ <b>Engine Health:</b> ${engineStatus.engineState} (${engineStatus.usable.h1} H1 / ${engineStatus.usable.m15} M15 bars)`,
      `🎯 <b>Scanner State:</b> ${managerState.isPaused ? '⏸️ PAUSED' : managerState.state}`,
      `🚀 <b>Mode:</b> ${dryRun ? '🟡 DRY RUN (Simulation)' : '🟢 LIVE DISPATCH'}`,
      `📈 <b>Daily Signals Sent:</b> ${managerState.dailySignalsCount}`,
      `⏱️ <b>Cooldown:</b> ${cdMins > 0 ? `⏳ ${cdMins} min remaining` : '✅ Inactive (Scanning)'}`,
      `📰 <b>News Lock:</b> ${newsStatus.isLockActive ? `🔴 LOCKED (${newsStatus.activeLockEvent?.title})` : '🟢 Unlocked'}`,
      `📡 <b>Outbox Deliveries:</b> Sent: ${workerStatus.sentCount} | Pending: ${workerStatus.pendingCount} | Failed: ${workerStatus.failedCount}`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
    ].join('\n');

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), 'HTML');
    return;
  }

  if (normAction === 'test' || normAction === 'testsignal' || normAction === 'signal_test') {
    const candleStore = getCandleStore();
    const latest = candleStore.M15[candleStore.M15.length - 1];
    const basePrice = latest ? latest.close : 2650.50;
    const entry = Number(basePrice.toFixed(2));
    const sl = Number((entry - (settings.slDollars || 10.0)).toFixed(2));
    const tp1 = Number((entry + (settings.tp1Dollars || 5.0)).toFixed(2));
    const tp2 = Number((entry + (settings.tp2Dollars || 8.0)).toFixed(2));
    const tp3 = Number((entry + (settings.tp3Dollars || 10.0)).toFixed(2));
    const tp4 = Number((entry + (settings.tp4Dollars || 12.0)).toFixed(2));

    const sampleSignalMsg = [
      '🔱 <b>SARRAF INSTITUTIONAL TRADE ALERT</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      '<b>Instrument:</b> XAUUSD (Gold)',
      '<b>Action:</b> BUY 🟢',
      `<b>Entry:</b> $${entry.toFixed(2)}`,
      `<b>SL:</b> $${sl.toFixed(2)} ($${settings.slDollars.toFixed(2)} risk)`,
      '',
      '<b>🎯 Targets:</b>',
      `• TP1: $${tp1.toFixed(2)} (+0.5R)`,
      `• TP2: $${tp2.toFixed(2)} (+0.8R)`,
      `• TP3: $${tp3.toFixed(2)} (+1.0R)`,
      `• TP4: $${tp4.toFixed(2)} (+1.2R)`,
      '',
      '<b>📊 Institutional Confluence:</b>',
      '• Confluence Score: <b>94/100</b>',
      '• Structure: M15 Order Block + H1 Liquidity Sweep',
      '• Risk/Reward: 1:1.20',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `⚡ [LIVE TEST SIGNAL] Delivered at ${new Date().toLocaleTimeString()} UTC. Telegram live alerts verified ✅`,
    ].join('\n');

    await sendTelegramHttpRequest(sampleSignalMsg, replyToMessageId, chatId, getMainControlKeyboard(), 'HTML');
    return;
  }

  if (normAction === 'toggle_dryrun' || normAction === 'dryrun') {
    let nextMode = !dryRun;
    if (rawArgs && rawArgs.length > 0) {
      const arg = rawArgs[0].toLowerCase();
      if (arg === 'on' || arg === 'true' || arg === 'simulate') nextMode = true;
      if (arg === 'off' || arg === 'false' || arg === 'live') nextMode = false;
    }

    updateSettings({ dryRun: nextMode }, `telegram_${fromUser || chatId}`);
    const statusEmoji = nextMode ? '🟡 DRY RUN (SIMULATION)' : '🟢 LIVE DISPATCH';
    const text = [
      '⚙️ <b>SARRAF EXECUTION MODE UPDATED</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `New Mode: <b>${statusEmoji}</b>`,
      '',
      nextMode
        ? 'Signals will now be safely simulated and logged without broadcasting live trade executions.'
        : '⚠️ <b>LIVE DISPATCH ACTIVATED:</b> New high-confluence setups will be dispatched live to Telegram and connected desks immediately!',
    ].join('\n');

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), 'HTML');
    return;
  }

  if (normAction === 'toggle_pause' || normAction === 'pause' || normAction === 'resume') {
    if (normAction === 'pause' || (!managerState.isPaused && normAction === 'toggle_pause')) {
      pauseSignalManager();
      const text = [
        '⏸️ <b>SARRAF SCANNER PAUSED</b>',
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        'Automated signal generation has been halted by administrative desk command.',
        'Tap <b>Resume Engine</b> or run <code>/resume</code> to re-activate.',
      ].join('\n');
      await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), 'HTML');
    } else {
      resumeSignalManager();
      const text = [
        '▶️ <b>SARRAF SCANNER RESUMED</b>',
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        'Automated multi-timeframe liquidity scanning is now active.',
        'High-probability institutional setups will be evaluated in real-time.',
      ].join('\n');
      await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), 'HTML');
    }
    return;
  }

  if (normAction === 'signals' || normAction === 'last') {
    const store = getCandleStore();
    const latestBar = store.M15[store.M15.length - 1];
    const livePrice = latestBar ? latestBar.close : null;
    const dash = getSignalManagerPublicState(livePrice);
    const history = managerState.history || [];

    const lines = [
      '📈 <b>SARRAF ACTIVE & RECENT TRADE SIGNALS</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
    ];

    if (dash.activeSignal) {
      const s = dash.activeSignal;
      lines.push(
        '🔥 <b>CURRENT ACTIVE TRADE:</b>',
        `• ID: <code>${s.id}</code> (${s.direction} ${s.direction === 'BUY' ? '🟢' : '🔴'})`,
        `• Entry: $${s.entry.toFixed(2)} | Live SL: $${s.sl.toFixed(2)}`,
        `• Floating PnL: ${s.livePnLDollars >= 0 ? '+' : ''}$${s.livePnLDollars.toFixed(2)} (${s.livePnLR >= 0 ? '+' : ''}${s.livePnLR}R)`,
        `• Highest TP Hit: <b>${s.highestTP}</b> | BE Active: ${s.isBreakeven ? 'YES ✅' : 'NO ❌'}`,
        `• Next Target: $${s.nextTarget.toFixed(2)} (${s.targetProgressPercent}% progress)`,
        ''
      );
    } else {
      lines.push('🎯 <b>Active Trade:</b> No setup currently in progress (Scanning desk active).', '');
    }

    lines.push('📜 <b>Recent Signal History:</b>');
    if (history.length === 0) {
      lines.push('• No closed signals recorded in current session.');
    } else {
      history.slice(0, 5).forEach((h, idx) => {
        const icon = h.resultClass === 'WIN' ? '✅' : h.resultClass === 'LOSS' ? '❌' : '⚪';
        const sign = h.realizedR >= 0 ? '+' : '';
        lines.push(`${idx + 1}. <code>${h.id}</code> (${h.direction}) → ${icon} <b>${h.resultClass}</b> (${sign}${h.realizedR.toFixed(2)}R) [${h.closeReason || 'CLOSED'}]`);
      });
    }

    await sendTelegramHttpRequest(lines.join('\n'), replyToMessageId, chatId, getMainControlKeyboard(), 'HTML');
    return;
  }

  if (normAction === 'price' || normAction === 'gold') {
    const store = getCandleStore();
    const latest = store.M15[store.M15.length - 1];
    const m15 = getClosedCandles('M15');
    const h1 = getClosedCandles('H1');
    const h4 = getClosedCandles('H4');
    const d1 = getClosedCandles('D1');

    const h1Bias = evaluateStructureBias(h1);
    const h4Bias = evaluateStructureBias(h4);
    const d1Bias = evaluateStructureBias(d1);

    const text = [
      '💰 <b>XAU/USD GOLD REAL-TIME QUOTE & BIAS</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `💲 <b>Live Price:</b> $${latest ? latest.close.toFixed(2) : 'N/A'}`,
      `📊 <b>Bar Range:</b> Low: $${latest ? latest.low.toFixed(2) : 'N/A'} | High: $${latest ? latest.high.toFixed(2) : 'N/A'}`,
      '',
      '🧠 <b>Multi-Timeframe Structure Biases:</b>',
      `• <b>H1 Bias:</b> ${h1Bias.bias} (${h1Bias.lastBOS})`,
      `• <b>H4 Bias:</b> ${h4Bias.bias} (${h4Bias.lastBOS})`,
      `• <b>D1 Bias:</b> ${d1Bias.bias} (${d1Bias.lastBOS})`,
      '',
      `📦 <b>Candle Accumulation:</b> M15: ${store.M15.length} | M30: ${store.M30.length} | H1: ${store.H1.length} | H4: ${store.H4.length} | D1: ${store.D1.length}`,
    ].join('\n');

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), 'HTML');
    return;
  }

  if (normAction === 'news') {
    const feed = getNewsFeedStatus();
    const lines = [
      '📰 <b>SARRAF MACROECONOMIC & NEWS LOCK AUDIT</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `🔒 <b>News Lock State:</b> ${feed.isLockActive ? `🔴 <b>LOCKED</b> (${feed.activeLockEvent?.title})` : '🟢 <b>UNLOCKED (Trading Allowed)</b>'}`,
      `⏱️ <b>Tier 1 Window:</b> -${settings.tier1PreMinutes}m pre / +${settings.tier1PostMinutes}m post`,
      `⏱️ <b>Tier 2 Window:</b> -${settings.tier2PreMinutes}m pre / +${settings.tier2PostMinutes}m post`,
      '',
      '📅 <b>Upcoming High-Impact USD Events:</b>',
    ];

    if (feed.nextEvent) {
      lines.push(
        `• <b>${feed.nextEvent.title}</b>`,
        `  Time: ${feed.nextEvent.displayTime || feed.nextEvent.timeUtc} (${feed.nextEvent.minutesUntil >= 0 ? `in ${feed.nextEvent.minutesUntil}m` : `${Math.abs(feed.nextEvent.minutesUntil)}m ago`})`,
        `  Forecast: ${feed.nextEvent.forecastStr || 'N/A'} | Previous: ${feed.nextEvent.previousStr || 'N/A'}`
      );
    } else {
      lines.push('• No impending high-impact USD events within immediate radar.');
    }

    await sendTelegramHttpRequest(lines.join('\n'), replyToMessageId, chatId, getMainControlKeyboard(), 'HTML');
    return;
  }

  if (normAction === 'stats') {
    const stats = getSignalStats();
    const total = stats.wins + stats.losses + stats.breakevens;
    const winRate = total > 0 ? Math.round((stats.wins / total) * 100) : 0;

    const text = [
      '🏆 <b>SARRAF PERFORMANCE & WIN RATE AUDIT</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `📊 <b>Total Completed Trades:</b> ${total}`,
      `🎯 <b>Record:</b> ${stats.wins} Wins | ${stats.losses} Losses | ${stats.breakevens} Breakevens`,
      `📈 <b>Win Rate:</b> <b>${winRate}%</b>`,
      `💰 <b>Net Accumulated Gain:</b> <b>${stats.totalR >= 0 ? '+' : ''}${stats.totalR.toFixed(2)}R</b>`,
      `🛑 <b>Consecutive Losses Today:</b> ${managerState.consecutiveLossesToday} (Limit: 2)`,
      `⚡ <b>Daily Limit Reached:</b> ${managerState.dailyLossLimitReached ? 'YES ⛔' : 'NO ✅'}`,
    ].join('\n');

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), 'HTML');
    return;
  }

  if (normAction === 'risk') {
    const text = [
      '⚙️ <b>SARRAF RISK & TARGET CONFIGURATION</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `🛑 <b>Stop Loss (SL):</b> $${settings.slDollars.toFixed(2)}`,
      '🎯 <b>Take Profit Targets:</b>',
      `• TP1: $${settings.tp1Dollars.toFixed(2)} (+${(settings.tp1Dollars / settings.slDollars).toFixed(2)}R)`,
      `• TP2: $${settings.tp2Dollars.toFixed(2)} (+${(settings.tp2Dollars / settings.slDollars).toFixed(2)}R)`,
      `• TP3: $${settings.tp3Dollars.toFixed(2)} (+${(settings.tp3Dollars / settings.slDollars).toFixed(2)}R)`,
      `• TP4: $${settings.tp4Dollars.toFixed(2)} (+${(settings.tp4Dollars / settings.slDollars).toFixed(2)}R)`,
      '',
      `⏱️ <b>Post-Trade Cooldown:</b> ${settings.cooldownMinMinutes}m - ${settings.cooldownMaxMinutes}m`,
      `💯 <b>Minimum Confluence Score:</b> ${settings.minScore}/100`,
      `📊 <b>Max Signals Per Day:</b> Unlimited (Sequential)`,
      `🛡️ <b>Spread Limit:</b> $${settings.spreadLimit.toFixed(2)}`,
    ].join('\n');

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), 'HTML');
    return;
  }

  if (normAction === 'users') {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const targetChat = process.env.TELEGRAM_CHAT_ID;
    const googleChatWebhook = process.env.GOOGLE_CHAT_WEBHOOK_URL;

    const text = [
      '👥 <b>CONNECTED CHANNELS & SUBSCRIBER STATUS</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `🤖 <b>Telegram Bot Status:</b> ${token ? 'Connected & Polling ✅' : 'Disconnected ❌'}`,
      `📡 <b>Default Target Chat ID:</b> <code>${targetChat || 'Not configured'}</code>`,
      `💬 <b>Current Chat ID:</b> <code>${chatId}</code>`,
      `🔗 <b>Google Chat Space:</b> ${googleChatWebhook ? 'Active Webhook Configured ✅' : 'Not Connected'}`,
      `👤 <b>Admin Authentication:</b> Protected & Verified`,
    ].join('\n');

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), 'HTML');
    return;
  }

  if (normAction === 'setchat' || normAction === 'register' || normAction === 'setchannel') {
    if (!rawArgs || rawArgs.length < 2) {
      const usageText = [
        '⚠️ <b>INVALID CREDENTIALS FOR CHAT REGISTRATION</b>',
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        'Please provide your administrative credentials to register this chat:',
        '',
        '<code>/setchat [admin_username] [admin_password]</code>',
        '',
        '💡 <i>Example:</i> <code>/setchat gmcf7 MySecretPassword123</code>',
        '',
        'This secures the terminal and prevents unauthorized configuration.',
      ].join('\n');
      await sendTelegramHttpRequest(usageText, replyToMessageId, chatId, undefined, 'HTML');
      return;
    }

    const usernameInput = rawArgs[0];
    const passwordInput = rawArgs[1];

    const userValid = verifyAdminUsername(usernameInput);
    const passValid = verifyAdminPassword(passwordInput);

    if (!userValid || !passValid) {
      const failText = [
        '❌ <b>AUTHENTICATION FAILED</b>',
        '━━━━━━━━━━━━━━━━━━━━━━━━━',
        'The admin username or password provided is incorrect.',
        'Please verify your credentials and try again.',
      ].join('\n');
      await sendTelegramHttpRequest(failText, replyToMessageId, chatId, undefined, 'HTML');
      return;
    }

    // Dynamic Chat ID registration
    setDynamicTelegramChatId(String(chatId));

    const successText = [
      '✅ <b>TELEGRAM CHAT REGISTERED SUCCESSFULLY</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `This chat (ID: <code>${chatId}</code>) is now registered as the active target for all institutional setups, market summaries, and system notifications.`,
      '',
      '⚙️ <b>Live automatic trades will start dispatching here immediately!</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      '<i>Ab is chat par automatic signals, summaries, aur alerts send kiye jayein ge!</i> 🚀',
    ].join('\n');

    await sendTelegramHttpRequest(successText, replyToMessageId, chatId, getMainControlKeyboard(), 'HTML');
    return;
  }

  if (normAction === 'help') {
    const text = [
      '❓ <b>SARRAF TELEGRAM REMOTE CONTROL GUIDE</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      'You can control all operations entirely within Telegram:',
      '',
      '• <code>/start</code> or <code>/menu</code> — Open interactive button dashboard',
      '• <code>/status</code> — Live engine, price, cooldown & outbox status',
      '• <code>/testsignal</code> — Dispatch live realistic test gold signal',
      '• <code>/signals</code> — View active trade progress & recent history',
      '• <code>/dryrun</code> — Toggle simulation (Dry Run) vs live dispatch',
      '• <code>/price</code> — Real-time XAU/USD price & MTF biases',
      '• <code>/news</code> — High-impact USD news & lock windows',
      '• <code>/stats</code> — Win rate & R-multiple gains',
      '• <code>/risk</code> — Stop loss & take profit target rules',
      '• <code>/pause</code> — Pause signal manager',
      '• <code>/resume</code> — Resume signal manager',
      '• <code>/users</code> — Connected channel and chat status',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      '⚡ All changes persist safely across server reboots.',
    ].join('\n');

    await sendTelegramHttpRequest(text, replyToMessageId, chatId, getMainControlKeyboard(), 'HTML');
    return;
  }

  // Fallback for unrecognized action
  const fallback = `Unrecognized command. Use /menu or /help for the complete control center.`;
  await sendTelegramHttpRequest(fallback, replyToMessageId, chatId, getMainControlKeyboard());
}

// Poll Telegram Commands and Interactive Buttons via getUpdates
async function pollTelegramCommands() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === '123456789:ABCdefGhIJKlmNoPQRstuVWXyz') return;

  try {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${updatePollingOffset}&timeout=2`;
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
        const fromUser = cq.from?.username || cq.from?.first_name || 'admin';

        console.log(`[TELEGRAM BUTTON] Pressed "${callbackData}" by @${fromUser} (Chat: ${chatId})`);

        // Acknowledge tap immediately
        await answerTelegramCallbackQuery(callbackId, 'Processing request...');

        if (chatId && callbackData) {
          await executeTelegramAction(callbackData, chatId, cq.message?.message_id, fromUser);
        }
        continue;
      }

      // 2. Handle Text Commands
      const msg = update.message;
      if (!msg || !msg.text) continue;

      const incomingChatId = msg.chat?.id;
      const text = msg.text.trim();
      if (!text.startsWith('/')) continue;

      const parts = text.split(' ');
      const rawCmd = parts[0].replace(/@\w+$/, ''); // Remove bot username mention if any (e.g. /status@SarrafBot)
      const args = parts.slice(1);
      const fromUser = msg.from?.username || msg.from?.first_name || 'admin';

      console.log(`[TELEGRAM COMMAND] "${text}" from Chat ID: ${incomingChatId} (@${fromUser})`);

      if (incomingChatId) {
        await executeTelegramAction(rawCmd, incomingChatId, msg.message_id, fromUser, args);
      }
    }
  } catch (err: any) {
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
  const testText = `[SARRAF TEST] Institutional dispatch test triggered by ${adminEmail} at ${new Date().toUTCString()}.`;

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

// Manual Sample Signal Dispatcher to verify live Telegram trade alerts
export async function sendSampleTestSignal(targetChatId?: string): Promise<{ success: boolean; message: string; messageId?: number }> {
  const sampleSignalText = [
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

  const result = await sendTelegramHttpRequest(sampleSignalText, undefined, targetChatId);
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

// Get comprehensive worker status
export function getTelegramWorkerStatus(): TelegramWorkerStatus {
  const outbox = readOutbox();
  const pending = outbox.filter((o) => o.status === 'PENDING_DELIVERY').length;
  const sent = outbox.filter((o) => o.status === 'SENT').length;
  const failed = outbox.filter((o) => o.status === 'FAILED').length;

  const lastSent = outbox.filter((o) => o.status === 'SENT').pop();

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = getDynamicTelegramChatId() || process.env.TELEGRAM_CHAT_ID;
  const configured = Boolean(token && chatId && token !== '123456789:ABCdefGhIJKlmNoPQRstuVWXyz');

  return {
    botConnected: configured,
    dryRun: getIsDryRun(),
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
