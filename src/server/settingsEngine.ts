import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import {
  DATA_DIR,
  writeJsonAtomic,
  recoverCorruptedFileFromLatestBackup,
} from './deploymentSafety.ts';

const SETTINGS_FILE = path.resolve(DATA_DIR, 'settings.json');
const AUDIT_FILE = path.resolve(DATA_DIR, 'settings_audit.json');
const AUTH_FILE = path.resolve(DATA_DIR, 'admin_auth.json');
const KNOWN_IPS_FILE = path.resolve(DATA_DIR, 'known_ips.json');

export interface EngineSettings {
  slDollars: number; // 5.0 to 20.0
  tp1Dollars: number;
  tp2Dollars: number;
  tp3Dollars: number;
  tp4Dollars: number;
  cooldownMinMinutes: number; // >= 20
  cooldownMaxMinutes: number; // >= cooldownMinMinutes
  minScore: number; // >= 80, <= 100
  maxSignalsPerDay: number; // 1 to 5
  tier1PreMinutes: number; // 1 to 120 (default: 45)
  tier1PostMinutes: number; // 1 to 60 (default: 30)
  tier2PreMinutes: number; // 1 to 60 (default: 30)
  tier2PostMinutes: number; // 1 to 60 (default: 15)
  volatilitySettleEnabled: boolean; // default: true
  spreadLimit: number; // 0.20 to 1.50
  dryRun: boolean;
  displayTz: string;
  geminiValidatorEnabled: boolean;
  newsHeadsUpTelegram: boolean;
  dailySummaryEnabled: boolean;
  dailySummaryTimeUtc: string; // "22:30"
  weeklyReportEnabled: boolean;
  weeklyReportTimeUtc: string; // "23:00"
  oneSignalAtATime: true; // Hardcoded immutable safety invariant
}

export interface SettingsAuditItem {
  id: string;
  timestamp: string;
  adminEmail: string;
  field: string;
  oldValue: any;
  newValue: any;
}

export const DEFAULT_SETTINGS: EngineSettings = {
  slDollars: 10.0,
  tp1Dollars: 5.0,
  tp2Dollars: 8.0,
  tp3Dollars: 10.0,
  tp4Dollars: 12.0,
  cooldownMinMinutes: 30,
  cooldownMaxMinutes: 45,
  minScore: 80,
  maxSignalsPerDay: 3,
  tier1PreMinutes: 45,
  tier1PostMinutes: 30,
  tier2PreMinutes: 30,
  tier2PostMinutes: 15,
  volatilitySettleEnabled: true,
  spreadLimit: 0.6,
  dryRun: process.env.DRY_RUN === 'true',
  displayTz: process.env.DISPLAY_TZ || 'UTC',
  geminiValidatorEnabled: true,
  newsHeadsUpTelegram: false,
  dailySummaryEnabled: true,
  dailySummaryTimeUtc: '22:30',
  weeklyReportEnabled: true,
  weeklyReportTimeUtc: '23:00',
  oneSignalAtATime: true,
};

let currentSettings: EngineSettings = { ...DEFAULT_SETTINGS };

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// -------------------------------------------------------------
// 1. SETTINGS STORAGE & AUDIT LOGGING
// -------------------------------------------------------------

export function loadSettingsFromDisk(): EngineSettings {
  ensureDataDir();
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      currentSettings = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        oneSignalAtATime: true, // immutable
      };
      return currentSettings;
    } catch {
      console.error('[SETTINGS ENGINE] Corrupted settings.json detected. Attempting recovery from latest backup...');
      const recovered = recoverCorruptedFileFromLatestBackup('settings.json');
      if (recovered) {
        return loadSettingsFromDisk();
      }
      currentSettings = { ...DEFAULT_SETTINGS };
      return currentSettings;
    }
  }

  saveSettingsToDisk(DEFAULT_SETTINGS);
  return currentSettings;
}

export function saveSettingsToDisk(settings: EngineSettings) {
  ensureDataDir();
  try {
    writeJsonAtomic(SETTINGS_FILE, settings);
  } catch (err: any) {
    console.error('[SETTINGS ENGINE] Failed to save settings to disk:', err.message);
  }
}

export function loadAuditLog(): SettingsAuditItem[] {
  ensureDataDir();
  if (fs.existsSync(AUDIT_FILE)) {
    try {
      const data = fs.readFileSync(AUDIT_FILE, 'utf-8');
      return JSON.parse(data) || [];
    } catch {
      return [];
    }
  }
  return [];
}

export function logAuditEntry(entry: Omit<SettingsAuditItem, 'id' | 'timestamp'>) {
  ensureDataDir();
  const all = loadAuditLog();
  const item: SettingsAuditItem = {
    ...entry,
    id: `AUD-${Date.now().toString(36).toUpperCase()}`,
    timestamp: new Date().toISOString(),
  };
  all.unshift(item);
  try {
    writeJsonAtomic(AUDIT_FILE, all.slice(0, 100));
  } catch (err: any) {
    console.error('[SETTINGS ENGINE] Failed to save audit log:', err.message);
  }
}

// -------------------------------------------------------------
// 2. SETTINGS VALIDATION
// -------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateSettings(candidate: Partial<EngineSettings>): ValidationResult {
  const errors: string[] = [];

  // SL validation: $5.00 to $20.00
  if (candidate.slDollars !== undefined) {
    if (candidate.slDollars < 5.0 || candidate.slDollars > 20.0) {
      errors.push('Stop Loss (SL) must be between $5.00 and $20.00.');
    }
  }

  // TP validation: strictly ascending TP1 < TP2 < TP3 < TP4
  const tp1 = candidate.tp1Dollars ?? currentSettings.tp1Dollars;
  const tp2 = candidate.tp2Dollars ?? currentSettings.tp2Dollars;
  const tp3 = candidate.tp3Dollars ?? currentSettings.tp3Dollars;
  const tp4 = candidate.tp4Dollars ?? currentSettings.tp4Dollars;

  if (tp1 <= 0 || tp2 <= tp1 || tp3 <= tp2 || tp4 <= tp3) {
    errors.push('Take profit targets must strictly ascend: TP1 < TP2 < TP3 < TP4.');
  }
  if (tp4 > 50.0) {
    errors.push('Maximum Take Profit target (TP4) cannot exceed $50.00.');
  }

  // Cooldown validation: min >= 20, max >= min
  if (candidate.cooldownMinMinutes !== undefined) {
    if (candidate.cooldownMinMinutes < 20) {
      errors.push('Minimum cooldown duration cannot be lower than 20 minutes.');
    }
  }
  const cMin = candidate.cooldownMinMinutes ?? currentSettings.cooldownMinMinutes;
  const cMax = candidate.cooldownMaxMinutes ?? currentSettings.cooldownMaxMinutes;
  if (cMax < cMin) {
    errors.push('Maximum cooldown must be greater than or equal to minimum cooldown.');
  }

  // Score validation: minScore >= 80, <= 100 (NEVER below 80)
  if (candidate.minScore !== undefined) {
    if (candidate.minScore < 80 || candidate.minScore > 100) {
      errors.push('Minimum score threshold cannot be lower than 80/100.');
    }
  }

  // Max signals per day: 1 to 5
  if (candidate.maxSignalsPerDay !== undefined) {
    if (candidate.maxSignalsPerDay < 1 || candidate.maxSignalsPerDay > 5) {
      errors.push('Maximum signals per UTC day must be between 1 and 5.');
    }
  }

  // Spread limit: $0.20 to $1.50
  if (candidate.spreadLimit !== undefined) {
    if (candidate.spreadLimit < 0.2 || candidate.spreadLimit > 1.5) {
      errors.push('Spread filter limit must be between $0.20 and $1.50.');
    }
  }

  // Tier 1 news lock windows: 1-120 min pre, 1-60 min post
  if (candidate.tier1PreMinutes !== undefined) {
    if (candidate.tier1PreMinutes < 1 || candidate.tier1PreMinutes > 120) {
      errors.push('Tier 1 news lock pre-release window must be between 1 and 120 minutes.');
    }
  }
  if (candidate.tier1PostMinutes !== undefined) {
    if (candidate.tier1PostMinutes < 1 || candidate.tier1PostMinutes > 60) {
      errors.push('Tier 1 news lock post-release window must be between 1 and 60 minutes.');
    }
  }

  // Tier 2 news lock windows: 1-60 min pre, 1-60 min post
  if (candidate.tier2PreMinutes !== undefined) {
    if (candidate.tier2PreMinutes < 1 || candidate.tier2PreMinutes > 60) {
      errors.push('Tier 2 news lock pre-release window must be between 1 and 60 minutes.');
    }
  }
  if (candidate.tier2PostMinutes !== undefined) {
    if (candidate.tier2PostMinutes < 1 || candidate.tier2PostMinutes > 60) {
      errors.push('Tier 2 news lock post-release window must be between 1 and 60 minutes.');
    }
  }

  // Summary time format validation (HH:MM UTC)
  if (candidate.dailySummaryTimeUtc !== undefined) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate.dailySummaryTimeUtc)) {
      errors.push('Daily summary time must be in HH:MM format (24-hour UTC).');
    }
  }
  if (candidate.weeklyReportTimeUtc !== undefined) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate.weeklyReportTimeUtc)) {
      errors.push('Weekly report time must be in HH:MM format (24-hour UTC).');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function updateSettings(
  patch: Partial<EngineSettings>,
  adminEmail: string
): { success: boolean; settings: EngineSettings; errors?: string[] } {
  const validation = validateSettings(patch);
  if (!validation.valid) {
    return { success: false, settings: currentSettings, errors: validation.errors };
  }

  const old = { ...currentSettings };
  const updated: EngineSettings = {
    ...currentSettings,
    ...patch,
    oneSignalAtATime: true, // immutable
  };

  for (const [key, val] of Object.entries(patch)) {
    const k = key as keyof EngineSettings;
    if (val !== undefined && old[k] !== val) {
      logAuditEntry({
        adminEmail,
        field: k,
        oldValue: old[k],
        newValue: val,
      });
    }
  }

  currentSettings = updated;
  saveSettingsToDisk(updated);

  return { success: true, settings: currentSettings };
}

export function resetSettingsToDefault(adminEmail: string): EngineSettings {
  logAuditEntry({
    adminEmail,
    field: 'ALL_SETTINGS',
    oldValue: 'CUSTOM',
    newValue: 'DEFAULT_SETTINGS',
  });
  currentSettings = { ...DEFAULT_SETTINGS };
  saveSettingsToDisk(currentSettings);
  return currentSettings;
}

export function getCurrentSettings(): EngineSettings {
  return currentSettings;
}

// -------------------------------------------------------------
// 3. EXPORT & IMPORT SETTINGS
// -------------------------------------------------------------

export function exportSettingsJson(): string {
  const settings = getCurrentSettings();
  return JSON.stringify(
    {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      settings,
    },
    null,
    2
  );
}

export function importSettingsJson(
  jsonStr: string,
  adminEmail: string
): { success: boolean; settings?: EngineSettings; errors?: string[] } {
  try {
    const parsed = JSON.parse(jsonStr);
    const candidate = parsed.settings || parsed;

    const validation = validateSettings(candidate);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    return updateSettings(candidate, adminEmail);
  } catch (err: any) {
    return { success: false, errors: [`Invalid JSON formatting: ${err.message}`] };
  }
}

// -------------------------------------------------------------
// 4. ADMIN PASSWORD MANAGEMENT & IP TRACKING
// -------------------------------------------------------------

// -------------------------------------------------------------
// 4. ADMIN AUTHENTICATION (ENVIRONMENT VARIABLES WITH PERSISTENT BACKUP)
// -------------------------------------------------------------
// 4. ADMIN AUTHENTICATION (ENVIRONMENT VARIABLES ONLY)
// -------------------------------------------------------------

function getEnvAdmin(): { username: string; hash: string } | null {
  let envUser = process.env.ADMIN_USERNAME?.trim();
  let envHash = process.env.ADMIN_PASSWORD_HASH?.trim();

  if (!envUser || !envHash) {
    // Try reading .env files
    const envPaths = [
      path.resolve(process.cwd(), '.env'),
      path.resolve('/app/applet', '.env'),
      path.resolve('/', '.env')
    ];
    for (const envPath of envPaths) {
      try {
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf8');
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('ADMIN_USERNAME=')) {
              envUser = trimmed.slice('ADMIN_USERNAME='.length).trim();
            }
            if (trimmed.startsWith('ADMIN_PASSWORD_HASH=')) {
              envHash = trimmed.slice('ADMIN_PASSWORD_HASH='.length).trim();
            }
          }
        }
      } catch {}
      if (envUser && envHash) break;
    }
  }

  if (!envUser || !envHash) {
    try {
      const fallbackPath = path.resolve(DATA_DIR, 'admin_credentials.json');
      if (fs.existsSync(fallbackPath)) {
        const data = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
        if (data.username && data.hash) {
          envUser = String(data.username).trim();
          envHash = String(data.hash).trim();
        }
      }
    } catch {}
  }

  if (envUser && envHash) {
    process.env.ADMIN_USERNAME = envUser;
    process.env.ADMIN_PASSWORD_HASH = envHash;

    // Auto-heal missing .env and admin_credentials.json
    try {
      const envPath = path.resolve(process.cwd(), '.env');
      if (!fs.existsSync(envPath)) {
        fs.writeFileSync(envPath, `PORT=3000\nNODE_ENV=production\nDATA_DIR=./data\nADMIN_USERNAME=${envUser}\nADMIN_PASSWORD_HASH=${envHash}\n`);
      }
      const credPath = path.resolve(DATA_DIR, 'admin_credentials.json');
      if (!fs.existsSync(credPath)) {
        fs.writeFileSync(credPath, JSON.stringify({ username: envUser, hash: envHash }, null, 2));
      }
    } catch {}

    return { username: envUser, hash: envHash };
  }

  return null;
}

/**
 * Checks if admin authentication is configured via environment variables.
 * Returns false when ADMIN_USERNAME or ADMIN_PASSWORD_HASH are missing.
 */
export function isAdminConfigured(): boolean {
  const admin = getEnvAdmin();
  return Boolean(admin && admin.username && admin.hash);
}

/**
 * Returns the configured admin username from environment variables.
 */
export function getAdminUsername(): string | null {
  const admin = getEnvAdmin();
  return admin?.username || null;
}

/**
 * Constant-time username comparison against configured admin.
 */
export function verifyAdminUsername(username: string): boolean {
  const admin = getEnvAdmin();
  if (!admin || !admin.username || !username) return false;

  const inputBuf = Buffer.from(username.trim().toLowerCase());
  const envBuf = Buffer.from(admin.username.toLowerCase());

  if (inputBuf.length !== envBuf.length) {
    // Constant-time dummy compare to prevent timing side-channels
    crypto.timingSafeEqual(inputBuf, inputBuf);
    return false;
  }
  return crypto.timingSafeEqual(inputBuf, envBuf);
}

/**
 * Constant-time credential verification using configured environment variables.
 * Supports:
 *  - bcrypt ($2a$, $2b$, $2y$)
 *  - scrypt (scrypt:salt:hash or salt:hash)
 * Strictly matches env ADMIN_USERNAME and ADMIN_PASSWORD_HASH.
 * Never prints or leaks credentials to logs.
 */
export function verifyAdminCredentials(username: string, password: string): boolean {
  const admin = getEnvAdmin();

  if (!admin || !admin.username || !admin.hash || !username || !password) {
    return false;
  }

  const cleanInputUser = username.trim().toLowerCase();
  const cleanConfUser = admin.username.toLowerCase();

  const isMatchUser = cleanInputUser === cleanConfUser;

  // Constant-time comparison
  const inputUserBuf = Buffer.from(cleanInputUser);
  const confUserBuf = Buffer.from(isMatchUser ? cleanInputUser : cleanConfUser);
  crypto.timingSafeEqual(inputUserBuf, confUserBuf);

  if (!isMatchUser) {
    // Constant-time dummy verify to mitigate username enumeration timing
    try {
      crypto.scryptSync(password, 'dummy-salt', 64);
    } catch {}
    return false;
  }

  const configuredHash = admin.hash;

  // Password Hash verification
  try {
    if (configuredHash.startsWith('$2a$') || configuredHash.startsWith('$2b$') || configuredHash.startsWith('$2y$')) {
      return bcrypt.compareSync(password, configuredHash);
    }

    if (configuredHash.startsWith('scrypt:')) {
      const parts = configuredHash.split(':');
      if (parts.length === 3) {
        const salt = parts[1];
        const expectedHex = parts[2];
        const computed = crypto.scryptSync(password, salt, 64).toString('hex');
        const compBuf = Buffer.from(computed);
        const expBuf = Buffer.from(expectedHex);
        if (compBuf.length === expBuf.length) {
          return crypto.timingSafeEqual(compBuf, expBuf);
        }
      }
    } else if (configuredHash.includes(':')) {
      const [salt, expectedHex] = configuredHash.split(':');
      if (salt && expectedHex) {
        const computed = crypto.scryptSync(password, salt, 64).toString('hex');
        const compBuf = Buffer.from(computed);
        const expBuf = Buffer.from(expectedHex);
        if (compBuf.length === expBuf.length) {
          return crypto.timingSafeEqual(compBuf, expBuf);
        }
      }
    }
  } catch {
    // Ignore error safely, return false
  }

  return false;
}

export function verifyAdminPassword(password: string): boolean {
  const envUser = process.env.ADMIN_USERNAME?.trim();
  if (!envUser) return false;
  return verifyAdminCredentials(envUser, password);
}

export function recordSuccessfulLogin(ip: string): { isNewIp: boolean } {
  ensureDataDir();
  let knownIps: string[] = [];

  if (fs.existsSync(KNOWN_IPS_FILE)) {
    try {
      knownIps = JSON.parse(fs.readFileSync(KNOWN_IPS_FILE, 'utf-8')) || [];
    } catch {
      knownIps = [];
    }
  }

  const isNew = !knownIps.includes(ip);
  if (isNew) {
    knownIps.push(ip);
    try {
      fs.writeFileSync(KNOWN_IPS_FILE, JSON.stringify(knownIps, null, 2), 'utf-8');
    } catch {}
  }

  return { isNewIp: isNew };
}

export function changeAdminPassword(oldPassword: string, newPassword: string, email: string): { success: boolean; error?: string } {
  return {
    success: false,
    error: 'Password management is disabled in environment mode. Update ADMIN_PASSWORD_HASH in environment variables.',
  };
}
