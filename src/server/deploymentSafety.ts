import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../../data');

const LEASE_FILE = path.resolve(DATA_DIR, 'instance_lease.json');
const BACKUPS_DIR = path.resolve(DATA_DIR, 'backups');
const RESTART_LOG_FILE = path.resolve(DATA_DIR, 'restarts.json');
const PERSISTENCE_MARKER_FILE = path.resolve(DATA_DIR, '.sarraf_persisted');

export interface InstanceLease {
  instanceId: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
  heartbeatAt: string;
  version: string;
}

export interface BackupItemInfo {
  filename: string;
  filepath: string;
  createdAt: string;
  sizeBytes: number;
  version: string;
  filesCount: number;
}

export interface SystemHealthReport {
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  uptimeSeconds: number;
  instanceId: string;
  isLeaseHolder: boolean;
  dataDir: string;
  isPersistentVolume: boolean;
  persistenceWarning?: string;
  lastBackupAt: string | null;
  backupsCount: number;
  nodeVersion: string;
  clockDriftMs: number;
  clockDriftWarning: boolean;
  memoryUsageMb: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
  serverStartTime: string;
}

const CURRENT_INSTANCE_ID = `SRF-NODE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const SERVER_START_TIME = new Date().toISOString();
let isLeaseHeld = false;
let leaseHeartbeatTimer: NodeJS.Timeout | null = null;
let dailyBackupTimer: NodeJS.Timeout | null = null;
let latestCalculatedClockDriftMs = 0;

// -------------------------------------------------------------
// 1. ATOMIC JSON WRITE UTILITY (Guarantees zero corrupt files on SIGTERM/Crash)
// -------------------------------------------------------------
export function writeJsonAtomic(filePath: string, data: any): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tempFile = `${filePath}.tmp.${crypto.randomBytes(4).toString('hex')}`;
  const serialized = JSON.stringify(data, null, 2);

  try {
    fs.writeFileSync(tempFile, serialized, 'utf-8');
    fs.renameSync(tempFile, filePath);
  } catch (err: any) {
    if (fs.existsSync(tempFile)) {
      try {
        fs.unlinkSync(tempFile);
      } catch {
        // ignore
      }
    }
    throw new Error(`[ATOMIC WRITE FAILED] Could not write ${filePath}: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 2. DATA_DIR PERSISTENCE & EPHEMERAL VOLUME WARNING
// -------------------------------------------------------------
export function checkDataDirectory(): {
  writable: boolean;
  isPersistent: boolean;
  warning?: string;
  error?: string;
} {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Write probe test
    const probeFile = path.resolve(DATA_DIR, `.probe_${Date.now()}`);
    fs.writeFileSync(probeFile, `probe_${CURRENT_INSTANCE_ID}`, 'utf-8');
    fs.unlinkSync(probeFile);

    // Persistence marker test:
    // If running in production and marker was absent on initial boot or explicitly ephemeral
    const explicitEphemeral = process.env.EPHEMERAL_FILESYSTEM === 'true';
    const hasVolumeEnv = Boolean(
      process.env.RAILWAY_VOLUME_MOUNT_PATH ||
      process.env.PERSISTENT_VOLUME ||
      process.env.DATA_DIR
    );

    let isPersistent = true;
    let warning: string | undefined;

    if (explicitEphemeral) {
      isPersistent = false;
      warning = 'EPHEMERAL_FILESYSTEM environment flag is set to true.';
    } else if (!fs.existsSync(PERSISTENCE_MARKER_FILE)) {
      // First boot on this volume: create marker
      try {
        fs.writeFileSync(
          PERSISTENCE_MARKER_FILE,
          JSON.stringify({ created: new Date().toISOString(), instance: CURRENT_INSTANCE_ID }),
          'utf-8'
        );
      } catch {
        // ignore
      }
      if (!hasVolumeEnv && process.env.NODE_ENV === 'production') {
        isPersistent = false;
        warning = 'No persistent volume detected (DATA_DIR is newly created on startup). State may be lost on container restart.';
      }
    }

    return {
      writable: true,
      isPersistent,
      warning,
    };
  } catch (err: any) {
    console.error('[DEPLOYMENT SAFETY] FATAL: DATA_DIR is not writable:', err.message);
    return {
      writable: false,
      isPersistent: false,
      error: err.message,
    };
  }
}

// -------------------------------------------------------------
// 3. SINGLE-INSTANCE LEASE LOCK
// -------------------------------------------------------------
export function acquireInstanceLease(): boolean {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const now = Date.now();
    const LEASE_TTL_MS = 25000; // 25s expiration

    let existingLease: InstanceLease | null = null;
    if (fs.existsSync(LEASE_FILE)) {
      try {
        existingLease = JSON.parse(fs.readFileSync(LEASE_FILE, 'utf-8'));
      } catch {
        existingLease = null;
      }
    }

    if (existingLease) {
      const lastHb = new Date(existingLease.heartbeatAt).getTime();
      const isAlive = now - lastHb < LEASE_TTL_MS;

      if (isAlive && existingLease.instanceId !== CURRENT_INSTANCE_ID) {
        console.warn(
          `[DEPLOYMENT SAFETY] Another active instance is holding the lease (Instance: ${existingLease.instanceId}, PID: ${existingLease.pid}, Last HB: ${existingLease.heartbeatAt}). Running in passive STANDBY mode.`
        );
        isLeaseHeld = false;
        return false;
      }
    }

    // Acquire lease
    const newLease: InstanceLease = {
      instanceId: CURRENT_INSTANCE_ID,
      pid: process.pid,
      hostname: os.hostname(),
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      version: '5.0.0-PROD',
    };

    writeJsonAtomic(LEASE_FILE, newLease);
    isLeaseHeld = true;

    // Start heartbeat timer
    if (leaseHeartbeatTimer) clearInterval(leaseHeartbeatTimer);
    leaseHeartbeatTimer = setInterval(() => {
      renewLeaseHeartbeat();
    }, 8000);

    return true;
  } catch (err: any) {
    console.error('[DEPLOYMENT SAFETY] Error acquiring instance lease:', err.message);
    return false;
  }
}

export function renewLeaseHeartbeat() {
  if (!isLeaseHeld) return;
  try {
    if (fs.existsSync(LEASE_FILE)) {
      const leaseData: InstanceLease = JSON.parse(fs.readFileSync(LEASE_FILE, 'utf-8'));
      if (leaseData.instanceId === CURRENT_INSTANCE_ID) {
        leaseData.heartbeatAt = new Date().toISOString();
        writeJsonAtomic(LEASE_FILE, leaseData);
      }
    }
  } catch (err: any) {
    console.warn('[DEPLOYMENT SAFETY] Lease heartbeat renewal failed:', err.message);
  }
}

export function releaseInstanceLease() {
  try {
    if (leaseHeartbeatTimer) {
      clearInterval(leaseHeartbeatTimer);
      leaseHeartbeatTimer = null;
    }
    if (fs.existsSync(LEASE_FILE)) {
      const leaseData: InstanceLease = JSON.parse(fs.readFileSync(LEASE_FILE, 'utf-8'));
      if (leaseData.instanceId === CURRENT_INSTANCE_ID) {
        fs.unlinkSync(LEASE_FILE);
        console.log('[DEPLOYMENT SAFETY] Released single-instance lease lock cleanly.');
      }
    }
  } catch {
    // ignore
  } finally {
    isLeaseHeld = false;
  }
}

export function isCurrentLeaseHolder(): boolean {
  return isLeaseHeld;
}

// -------------------------------------------------------------
// 4. CLOCK DRIFT CHECK (Warns if server vs feed > 3 seconds)
// -------------------------------------------------------------
export function checkClockDrift(feedTimestampMs: number): {
  driftMs: number;
  exceeded: boolean;
  message: string;
} {
  const now = Date.now();
  const driftMs = Math.abs(now - feedTimestampMs);
  latestCalculatedClockDriftMs = driftMs;
  const exceeded = driftMs > 3000;

  let message = `Clock drift is within nominal tolerance (${driftMs}ms).`;
  if (exceeded) {
    message = `⚠️ CLOCK DRIFT EXCEEDED: Server clock is ${driftMs}ms offset from price feed. System clock synchronization recommended.`;
    console.warn(`[DEPLOYMENT SAFETY] ${message}`);
  }

  return { driftMs, exceeded, message };
}

export function getLatestClockDriftMs(): number {
  return latestCalculatedClockDriftMs;
}

// -------------------------------------------------------------
// 5. DAILY AUTOMATED ROLLING BACKUPS & RESTORATION
// -------------------------------------------------------------
const TARGET_BACKUP_FILES = [
  'candles.json',
  'signals.json',
  'outbox.json',
  'settings.json',
  'settings_audit.json',
  'google_chat_learning.json',
  'news_manual.json',
  'restarts.json',
];

export function createRollingBackup(): string | null {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `backup_${timestamp}.json`;
    const backupPath = path.resolve(BACKUPS_DIR, backupFileName);

    const snapshot: Record<string, any> = {
      createdAt: new Date().toISOString(),
      instanceId: CURRENT_INSTANCE_ID,
      version: '5.0.0',
      files: {},
    };

    for (const f of TARGET_BACKUP_FILES) {
      const filePath = path.resolve(DATA_DIR, f);
      if (fs.existsSync(filePath)) {
        try {
          snapshot.files[f] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch {
          snapshot.files[f] = null;
        }
      }
    }

    writeJsonAtomic(backupPath, snapshot);
    console.log(`[DEPLOYMENT SAFETY] Created daily backup snapshot: ${backupFileName}`);

    // Prune backups beyond last 7
    pruneOldBackups();
    return backupPath;
  } catch (err: any) {
    console.error('[DEPLOYMENT SAFETY] Failed to create rolling backup:', err.message);
    triggerAdminTelegramAlert('BACKUP_FAILED', `Automated backup failed: ${err.message}`);
    return null;
  }
}

function pruneOldBackups() {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) return;
    const files = fs
      .readdirSync(BACKUPS_DIR)
      .filter((f) => f.startsWith('backup_') && f.endsWith('.json'))
      .map((f) => ({
        name: f,
        time: fs.statSync(path.resolve(BACKUPS_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.time - a.time);

    // Keep top 7
    if (files.length > 7) {
      for (const old of files.slice(7)) {
        try {
          fs.unlinkSync(path.resolve(BACKUPS_DIR, old.name));
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
}

export function listBackups(): BackupItemInfo[] {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  try {
    return fs
      .readdirSync(BACKUPS_DIR)
      .filter((f) => f.startsWith('backup_') && f.endsWith('.json'))
      .map((filename) => {
        const filepath = path.resolve(BACKUPS_DIR, filename);
        const stats = fs.statSync(filepath);
        let version = '5.0.0';
        let filesCount = 0;
        let createdAt = stats.mtime.toISOString();

        try {
          const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
          if (content.version) version = content.version;
          if (content.createdAt) createdAt = content.createdAt;
          if (content.files) filesCount = Object.keys(content.files).length;
        } catch {
          // ignore
        }

        return {
          filename,
          filepath,
          createdAt,
          sizeBytes: stats.size,
          version,
          filesCount,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

export function restoreBackupSnapshot(payloadOrFile: string | Record<string, any>): {
  success: boolean;
  restoredFiles: string[];
  error?: string;
} {
  try {
    let snapshot: any;
    if (typeof payloadOrFile === 'string') {
      const fullPath = path.isAbsolute(payloadOrFile)
        ? payloadOrFile
        : path.resolve(BACKUPS_DIR, payloadOrFile);
      if (!fs.existsSync(fullPath)) {
        return { success: false, restoredFiles: [], error: `Backup file ${payloadOrFile} not found.` };
      }
      snapshot = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    } else {
      snapshot = payloadOrFile;
    }

    if (!snapshot || !snapshot.files || typeof snapshot.files !== 'object') {
      return { success: false, restoredFiles: [], error: 'Invalid backup structure: missing "files" object.' };
    }

    const restored: string[] = [];
    for (const [filename, fileData] of Object.entries(snapshot.files)) {
      if (fileData !== null && fileData !== undefined) {
        const targetPath = path.resolve(DATA_DIR, filename);
        writeJsonAtomic(targetPath, fileData);
        restored.push(filename);
      }
    }

    console.log(`[DEPLOYMENT SAFETY] Restored ${restored.length} files from backup snapshot (${snapshot.createdAt || 'N/A'}).`);
    return { success: true, restoredFiles: restored };
  } catch (err: any) {
    console.error('[DEPLOYMENT SAFETY] Restore from backup failed:', err.message);
    return { success: false, restoredFiles: [], error: err.message };
  }
}

// Startup corrupt file recovery helper
export function recoverCorruptedFileFromLatestBackup(filename: string): boolean {
  const backups = listBackups();
  if (backups.length === 0) return false;

  for (const b of backups) {
    try {
      const content = JSON.parse(fs.readFileSync(b.filepath, 'utf-8'));
      if (content.files && content.files[filename]) {
        writeJsonAtomic(path.resolve(DATA_DIR, filename), content.files[filename]);
        console.warn(`[DEPLOYMENT SAFETY] Recovered corrupted file "${filename}" from backup snapshot "${b.filename}".`);
        triggerAdminTelegramAlert('DATA_DIR_PROBLEM', `Corrupted data file (${filename}) recovered from backup snapshot.`);
        return true;
      }
    } catch {
      // try next
    }
  }
  return false;
}

export function startBackupScheduler() {
  createRollingBackup();
  dailyBackupTimer = setInterval(() => {
    createRollingBackup();
  }, 24 * 60 * 60 * 1000);
}

export function stopBackupScheduler() {
  if (dailyBackupTimer) {
    clearInterval(dailyBackupTimer);
    dailyBackupTimer = null;
  }
}

// -------------------------------------------------------------
// 6. SERVER RESTART TRACKING & UPTIME
// -------------------------------------------------------------
export function recordServerRestart(reason: string = 'SCHEDULED_RESTART') {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    let logs: any[] = [];
    if (fs.existsSync(RESTART_LOG_FILE)) {
      try {
        logs = JSON.parse(fs.readFileSync(RESTART_LOG_FILE, 'utf-8')) || [];
      } catch {
        logs = [];
      }
    }
    logs.unshift({
      timestamp: new Date().toISOString(),
      instanceId: CURRENT_INSTANCE_ID,
      reason,
      nodeVersion: process.version,
    });
    writeJsonAtomic(RESTART_LOG_FILE, logs.slice(0, 30));
  } catch {
    // ignore
  }
}

export function getLastRestartInfo(): { timestamp: string; reason: string } | null {
  try {
    if (fs.existsSync(RESTART_LOG_FILE)) {
      const logs = JSON.parse(fs.readFileSync(RESTART_LOG_FILE, 'utf-8'));
      return logs[0] || null;
    }
  } catch {
    // ignore
  }
  return null;
}

// -------------------------------------------------------------
// 7. ADMIN TELEGRAM ALERTS (Max 1 per 30 minutes per alert type)
// -------------------------------------------------------------
const lastAlertTimestampMap = new Map<string, number>();
const ALERT_DEBOUNCE_MS = 30 * 60 * 1000; // 30 minutes

export function triggerAdminTelegramAlert(alertType: string, message: string): boolean {
  const now = Date.now();
  const lastSent = lastAlertTimestampMap.get(alertType) || 0;

  if (now - lastSent < ALERT_DEBOUNCE_MS) {
    return false; // Debounced
  }

  lastAlertTimestampMap.set(alertType, now);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  let chatId = process.env.TELEGRAM_CHAT_ID;

  // Fallback to dynamic chat ID from file to avoid circular imports
  try {
    const DYNAMIC_CHAT_FILE = path.resolve(DATA_DIR, 'telegram_chat.json');
    if (fs.existsSync(DYNAMIC_CHAT_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DYNAMIC_CHAT_FILE, 'utf-8'));
      if (parsed && typeof parsed.chatId === 'string') {
        chatId = parsed.chatId;
      }
    }
  } catch {
    // ignore
  }

  if (!token || !chatId || token === 'MY_TELEGRAM_BOT_TOKEN') {
    console.log(`[ADMIN TELEGRAM ALERT] (${alertType}) [DRY RUN / NO BOT]: ${message}`);
    return false;
  }

  const alertPayload = `🚨 *SARRAF SYSTEM ALERT*\n\n*Type:* \`${alertType}\`\n*Node:* \`${CURRENT_INSTANCE_ID}\`\n*Time:* \`${new Date().toISOString()}\`\n\n${message}`;

  fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: alertPayload,
      parse_mode: 'Markdown',
    }),
  }).catch((err) => {
    console.warn(`[ADMIN ALERT] Telegram delivery failed: ${err.message}`);
  });

  return true;
}

// -------------------------------------------------------------
// 8. ADMIN LOG VIEWER RING BUFFER (200 Lines, Secrets Masked)
// -------------------------------------------------------------
export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

const MAX_LOG_LINES = 200;
const logRingBuffer: LogEntry[] = [];

export function maskSecrets(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return String(rawText);

  return rawText
    // Telegram bot token (e.g. 123456789:ABCdefGHI...)
    .replace(/\b\d{8,11}:[A-Za-z0-9_-]{20,50}\b/g, '[REDACTED_TELEGRAM_TOKEN]')
    // Gemini / Google API Key (e.g. AIzaSy...)
    .replace(/\bAIza[0-9A-Za-z-_]{20,50}\b/g, '[REDACTED_API_KEY]')
    // Bearer / OAuth Tokens
    .replace(/(Bearer\s+)[A-Za-z0-9_.-]+/gi, '$1[REDACTED_BEARER_TOKEN]')
    .replace(/("?(?:password|token|apiKey|secret|adminPass)"?\s*[:=]\s*)"[^"]+"/gi, '$1"[REDACTED]"')
    // Chat IDs
    .replace(/(-100\d{10})/g, '-100***[REDACTED_CHAT_ID]');
}

export function appendServerLog(level: 'INFO' | 'WARN' | 'ERROR', message: string) {
  const cleanMessage = maskSecrets(message);
  logRingBuffer.unshift({
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    timestamp: new Date().toISOString(),
    level,
    message: cleanMessage,
  });

  if (logRingBuffer.length > MAX_LOG_LINES) {
    logRingBuffer.pop();
  }
}

export function getAdminLogs(): {
  total: number;
  uptimeSeconds: number;
  lastRestart: { timestamp: string; reason: string } | null;
  logs: LogEntry[];
} {
  return {
    total: logRingBuffer.length,
    uptimeSeconds: Math.floor(process.uptime()),
    lastRestart: getLastRestartInfo(),
    logs: [...logRingBuffer],
  };
}

// Attach console interceptor
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = function (...args: any[]) {
  const line = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  appendServerLog('INFO', line);
  originalLog.apply(console, args);
};

console.warn = function (...args: any[]) {
  const line = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  appendServerLog('WARN', line);
  originalWarn.apply(console, args);
};

console.error = function (...args: any[]) {
  const line = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  appendServerLog('ERROR', line);
  originalError.apply(console, args);
};

// -------------------------------------------------------------
// 9. SYSTEM HEALTH INSPECTION
// -------------------------------------------------------------
export function getSystemHealth(): SystemHealthReport {
  const mem = process.memoryUsage();
  const backups = listBackups();
  const dirStatus = checkDataDirectory();
  const uptime = Math.floor(process.uptime());

  let overallStatus: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' = 'HEALTHY';
  if (!dirStatus.writable || !isLeaseHeld) {
    overallStatus = 'UNHEALTHY';
  } else if (!dirStatus.isPersistent || latestCalculatedClockDriftMs > 3000) {
    overallStatus = 'DEGRADED';
  }

  return {
    status: overallStatus,
    uptimeSeconds: uptime,
    instanceId: CURRENT_INSTANCE_ID,
    isLeaseHolder: isLeaseHeld,
    dataDir: DATA_DIR,
    isPersistentVolume: dirStatus.isPersistent,
    persistenceWarning: dirStatus.warning,
    lastBackupAt: backups[0]?.createdAt || null,
    backupsCount: backups.length,
    nodeVersion: process.version,
    clockDriftMs: latestCalculatedClockDriftMs,
    clockDriftWarning: latestCalculatedClockDriftMs > 3000,
    memoryUsageMb: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    },
    serverStartTime: SERVER_START_TIME,
  };
}
