import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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
  dryRun: process.env.DRY_RUN !== 'false',
  displayTz: process.env.DISPLAY_TZ || 'UTC',
  geminiValidatorEnabled: true,
  newsHeadsUpTelegram: false,
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

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
}

export function verifyAdminPassword(password: string): boolean {
  ensureDataDir();
  if (!password) return false;

  if (fs.existsSync(AUTH_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
      if (data.salt && data.hash) {
        const computed = hashPassword(password, data.salt);
        return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(data.hash));
      }
    } catch {}
  }

  // Fallback to initial ENV password
  const envPass = process.env.ADMIN_PASS || 'SarrafAdmin2026!';
  return password === envPass;
}

export function changeAdminPassword(
  oldPassword: string,
  newPassword: string,
  adminEmail: string
): { success: boolean; error?: string } {
  if (!verifyAdminPassword(oldPassword)) {
    return { success: false, error: 'Current password is incorrect.' };
  }

  if (!newPassword || newPassword.length < 12) {
    return { success: false, error: 'New password must be at least 12 characters long.' };
  }

  ensureDataDir();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(newPassword, salt);

  try {
    fs.writeFileSync(
      AUTH_FILE,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          updatedBy: adminEmail,
          salt,
          hash,
        },
        null,
        2
      ),
      'utf-8'
    );

    logAuditEntry({
      adminEmail,
      field: 'ADMIN_PASSWORD',
      oldValue: '[PROTECTED_HASH]',
      newValue: '[UPDATED_HASH]',
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: `Failed to persist password: ${err.message}` };
  }
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
