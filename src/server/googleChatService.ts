import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR, writeJsonAtomic } from './deploymentSafety.ts';

const LEARNING_FILE = path.resolve(DATA_DIR, 'google_chat_learning.json');
const CHANGELOG_FILE = path.resolve(DATA_DIR, 'google_chat_changelog.json');
const SETTINGS_FILE = path.resolve(DATA_DIR, 'google_chat_settings.json');
const REVIEWS_FILE = path.resolve(DATA_DIR, 'setup_reviews.json');
const TOKEN_ENC_FILE = path.resolve(DATA_DIR, 'google_chat_token.enc');

export type ReviewStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'REVIEW_TIMEOUT'
  | 'STALE_AFTER_REVIEW'
  | 'DISMISSED';

export interface CuratedLesson {
  id: string; // e.g. LRN-001
  insight: string; // max 200 characters, strictly sanitized
  category: 'LIQUIDITY_DYNAMICS' | 'SESSION_TIMING' | 'NEWS_IMPACT' | 'RR_DISCIPLINE' | 'STRUCTURE_BIAS';
  author: string;
  active: boolean; // toggleable
  confidence: number; // 1-100
  createdAt: string;
  updatedAt: string;
}

export interface LessonChangeLogItem {
  id: string;
  timestamp: string; // UTC ISO
  adminEmail: string;
  action: 'CREATE' | 'UPDATE' | 'TOGGLE' | 'DELETE';
  lessonId: string;
  details: string;
}

export interface SetupReviewRecord {
  id: string; // e.g. REV-SRF-20261007-001
  signalId: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp4: number;
  score: number;
  status: ReviewStatus;
  createdAt: string;
  reviewExpiresAt: string; // UTC ISO
  reviewedAt?: string;
  reviewerName?: string;
  feedbackNotes?: string;
  spaceName?: string;
  googleChatMessageName?: string;
  bias: { d1: string; h4: string; h1: string };
  zone: { high: number; low: number; mid50: number };
  aiVerdict?: string;
  aiReason?: string;
  revalidationResult?: { ok: boolean; reason?: string };
}

export interface GoogleChatSettings {
  preReviewRequired: boolean; // default: false (OFF)
  reviewTimeoutMinutes: number; // 1-10 min, default: 3
  autoSendOnReviewTimeout: boolean; // default: false (OFF)
  autoPostUpdates: boolean; // default: false
  activeSpaceName: string;
  activeSpaceDisplayName: string;
  lastConnectedUser?: string;
  lastTokenSavedAt?: string;
  lastErrorAlert?: string;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// -------------------------------------------------------------
// 1. TOKEN ENCRYPTION AT REST (AES-256-GCM)
// -------------------------------------------------------------
function getEncryptionKey(): Buffer {
  const seed = process.env.ADMIN_PASS || 'SARRAF_SECURE_TOKEN_ENC_SEED_2026';
  return crypto.scryptSync(seed, 'SARRAF_GCHAT_SALT_v1', 32);
}

export function storeEncryptedGoogleToken(token: string, userEmail: string): boolean {
  if (!token || typeof token !== 'string') return false;
  ensureDataDir();
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const payload = JSON.stringify({
      token,
      userEmail,
      storedAt: new Date().toISOString(),
    });

    let encrypted = cipher.update(payload, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    const envelope = {
      iv: iv.toString('hex'),
      authTag,
      data: encrypted,
    };

    fs.writeFileSync(TOKEN_ENC_FILE, JSON.stringify(envelope), 'utf-8');

    // Update settings metadata without token
    const settings = loadGoogleChatSettings();
    settings.lastConnectedUser = userEmail;
    settings.lastTokenSavedAt = new Date().toISOString();
    saveGoogleChatSettings(settings);

    return true;
  } catch (err: any) {
    console.error('[GOOGLE CHAT SECURITY] Failed to encrypt token at rest:', err.message);
    return false;
  }
}

export function getDecryptedGoogleToken(): string | null {
  if (!fs.existsSync(TOKEN_ENC_FILE)) return null;
  try {
    const raw = fs.readFileSync(TOKEN_ENC_FILE, 'utf-8');
    const envelope = JSON.parse(raw);
    if (!envelope.iv || !envelope.authTag || !envelope.data) return null;

    const key = getEncryptionKey();
    const iv = Buffer.from(envelope.iv, 'hex');
    const authTag = Buffer.from(envelope.authTag, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(envelope.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    const parsed = JSON.parse(decrypted);
    return parsed.token || null;
  } catch (err: any) {
    console.error('[GOOGLE CHAT SECURITY] Failed to decrypt token:', err.message);
    return null;
  }
}

export async function revokeAndRemoveGoogleToken(): Promise<{ success: boolean; error?: string }> {
  const token = getDecryptedGoogleToken();
  if (token) {
    try {
      // Attempt revoke with Google OAuth endpoint
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch (e: any) {
      console.warn('[GOOGLE CHAT SECURITY] Remote token revocation ping failed (token may already be expired):', e.message);
    }
  }

  // Always delete encrypted token file locally
  if (fs.existsSync(TOKEN_ENC_FILE)) {
    try {
      fs.unlinkSync(TOKEN_ENC_FILE);
    } catch {}
  }

  const settings = loadGoogleChatSettings();
  settings.lastConnectedUser = undefined;
  settings.lastTokenSavedAt = undefined;
  saveGoogleChatSettings(settings);

  return { success: true };
}

export function getGoogleAuthStatus(): {
  connected: boolean;
  userEmail?: string;
  scopes: string[];
  connectedAt?: string;
} {
  const settings = loadGoogleChatSettings();
  const tokenExists = fs.existsSync(TOKEN_ENC_FILE);
  return {
    connected: tokenExists && !!settings.lastConnectedUser,
    userEmail: settings.lastConnectedUser,
    scopes: [
      'https://www.googleapis.com/auth/chat.spaces.readonly',
      'https://www.googleapis.com/auth/chat.messages.create',
      'https://www.googleapis.com/auth/chat.messages.readonly',
    ],
    connectedAt: settings.lastTokenSavedAt,
  };
}

// -------------------------------------------------------------
// 2. WHITELIST SECURITY (GOOGLE_ALLOWED_EMAILS)
// -------------------------------------------------------------
export function getWhitelistedEmails(): string[] {
  const envVar = process.env.GOOGLE_ALLOWED_EMAILS;
  if (!envVar) {
    const defaultAdmin = process.env.ADMIN_USER || 'admin@sarraf.gold';
    return [defaultAdmin.toLowerCase()];
  }
  return envVar
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailWhitelisted(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();
  const whitelist = getWhitelistedEmails();
  return whitelist.includes(normalized);
}

// -------------------------------------------------------------
// 3. SETTINGS MANAGEMENT (OFF BY DEFAULT)
// -------------------------------------------------------------
export function loadGoogleChatSettings(): GoogleChatSettings {
  ensureDataDir();
  const defaults: GoogleChatSettings = {
    preReviewRequired: false, // OFF by default
    reviewTimeoutMinutes: 3, // 1-10 range, default 3
    autoSendOnReviewTimeout: false, // OFF by default
    autoPostUpdates: false,
    activeSpaceName: '',
    activeSpaceDisplayName: 'SARRAF Gold Desk & War Room',
  };

  if (!fs.existsSync(SETTINGS_FILE)) {
    saveGoogleChatSettings(defaults);
    return defaults;
  }

  try {
    const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    return {
      preReviewRequired: !!parsed.preReviewRequired,
      reviewTimeoutMinutes: Math.min(10, Math.max(1, Number(parsed.reviewTimeoutMinutes) || 3)),
      autoSendOnReviewTimeout: !!parsed.autoSendOnReviewTimeout,
      autoPostUpdates: !!parsed.autoPostUpdates,
      activeSpaceName: parsed.activeSpaceName || '',
      activeSpaceDisplayName: parsed.activeSpaceDisplayName || 'SARRAF Gold Desk & War Room',
      lastConnectedUser: parsed.lastConnectedUser,
      lastTokenSavedAt: parsed.lastTokenSavedAt,
      lastErrorAlert: parsed.lastErrorAlert,
    };
  } catch {
    return defaults;
  }
}

export function saveGoogleChatSettings(settings: GoogleChatSettings) {
  ensureDataDir();
  try {
    writeJsonAtomic(SETTINGS_FILE, settings);
  } catch (err: any) {
    console.error('[GOOGLE CHAT SERVICE] Failed to save settings:', err.message);
  }
}

export async function turnGoogleChatFullyOff(): Promise<GoogleChatSettings> {
  const settings = loadGoogleChatSettings();
  settings.preReviewRequired = false;
  settings.autoSendOnReviewTimeout = false;
  settings.autoPostUpdates = false;
  settings.activeSpaceName = '';
  settings.lastErrorAlert = undefined;
  saveGoogleChatSettings(settings);

  await revokeAndRemoveGoogleToken();
  return settings;
}

// -------------------------------------------------------------
// 4. LESSON CURATION & SANITIZATION (Max 20, Max 200 chars)
// -------------------------------------------------------------
export function sanitizeLessonInsight(input: string): string {
  if (!input) return '';
  let cleaned = input;

  // 1. Strip HTML and script tags
  cleaned = cleaned.replace(/<[^>]*>?/gm, ' ');

  // 2. Strip URLs and protocols
  cleaned = cleaned.replace(/https?:\/\/\S+/gi, '[URL_REMOVED]');
  cleaned = cleaned.replace(/ftp:\/\/\S+/gi, '[URL_REMOVED]');

  // 3. Strip code fences, backticks, and markdown formatting
  cleaned = cleaned.replace(/```[\s\S]*?```/g, ' ');
  cleaned = cleaned.replace(/`[^`]*`/g, ' ');

  // 4. Strip prompt injection patterns
  const injectionPatterns = [
    /ignore (all )?(previous |prior )?(rules|instructions|directives|guidelines)/gi,
    /disregard (all )?(previous |prior )?(rules|instructions|directives)/gi,
    /system (prompt|instruction|role|message)/gi,
    /override (rules|score|levels|tp|sl|entry)/gi,
    /bypass (filter|checks|engine|risk)/gi,
    /approve regardless/gi,
    /reject regardless/gi,
    /new instructions?:/gi,
    /you are now a/gi,
  ];

  for (const pattern of injectionPatterns) {
    cleaned = cleaned.replace(pattern, '[REDACTED]');
  }

  // 5. Normalize whitespace and enforce max 200 chars
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 200);
}

export function loadLearningItems(): CuratedLesson[] {
  ensureDataDir();
  if (!fs.existsSync(LEARNING_FILE)) {
    const seed: CuratedLesson[] = [
      {
        id: 'LRN-001',
        insight: 'Asian session liquidity sweeps during London open require 15m candle close confirmation before entering.',
        category: 'LIQUIDITY_DYNAMICS',
        author: 'SARRAF Lead Desk',
        active: true,
        confidence: 95,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'LRN-002',
        insight: 'When H4 and H1 structure agree with displacement > 1.5x ATR, TP1 hit rate exceeds 85%.',
        category: 'STRUCTURE_BIAS',
        author: 'SARRAF Lead Desk',
        active: true,
        confidence: 92,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'LRN-003',
        insight: 'Reject limit orders within 30 min of FOMC or Core CPI; slippage expands live spread over $1.50.',
        category: 'NEWS_IMPACT',
        author: 'SARRAF Lead Desk',
        active: true,
        confidence: 98,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    saveLearningItems(seed);
    return seed;
  }

  try {
    const raw = fs.readFileSync(LEARNING_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLearningItems(items: CuratedLesson[]) {
  ensureDataDir();
  try {
    writeJsonAtomic(LEARNING_FILE, items);
  } catch (err: any) {
    console.error('[GOOGLE CHAT SERVICE] Failed to save learning items:', err.message);
  }
}

export function loadLessonChangeLog(): LessonChangeLogItem[] {
  ensureDataDir();
  if (!fs.existsSync(CHANGELOG_FILE)) return [];
  try {
    const raw = fs.readFileSync(CHANGELOG_FILE, 'utf-8');
    return JSON.parse(raw) || [];
  } catch {
    return [];
  }
}

function recordChangeLog(item: Omit<LessonChangeLogItem, 'id' | 'timestamp'>) {
  ensureDataDir();
  const log: LessonChangeLogItem = {
    id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...item,
  };
  const current = loadLessonChangeLog();
  current.unshift(log);
  if (current.length > 100) current.pop();
  try {
    writeJsonAtomic(CHANGELOG_FILE, current);
  } catch {}
}

export function addCuratedLesson(
  lesson: {
    insight: string;
    category: CuratedLesson['category'];
    author: string;
    confidence?: number;
  },
  adminEmail: string
): { success: boolean; lesson?: CuratedLesson; error?: string } {
  const all = loadLearningItems();
  const activeCount = all.filter((l) => l.active).length;

  if (activeCount >= 20) {
    return {
      success: false,
      error: 'Maximum active lessons limit reached (20). Please disable or delete an existing lesson first.',
    };
  }

  const sanitized = sanitizeLessonInsight(lesson.insight);
  if (!sanitized) {
    return { success: false, error: 'Insight text cannot be empty.' };
  }

  const newLesson: CuratedLesson = {
    id: `LRN-${Date.now().toString(36).toUpperCase()}`,
    insight: sanitized,
    category: lesson.category,
    author: lesson.author || adminEmail,
    active: true,
    confidence: Math.min(100, Math.max(1, lesson.confidence || 90)),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  all.unshift(newLesson);
  saveLearningItems(all);

  recordChangeLog({
    adminEmail,
    action: 'CREATE',
    lessonId: newLesson.id,
    details: `Created lesson in category ${newLesson.category}: "${newLesson.insight}"`,
  });

  return { success: true, lesson: newLesson };
}

export function updateCuratedLesson(
  id: string,
  updates: { insight?: string; category?: CuratedLesson['category']; active?: boolean; confidence?: number },
  adminEmail: string
): { success: boolean; lesson?: CuratedLesson; error?: string } {
  const all = loadLearningItems();
  const target = all.find((l) => l.id === id);
  if (!target) return { success: false, error: 'Lesson not found.' };

  const oldText = target.insight;
  if (updates.insight !== undefined) {
    const sanitized = sanitizeLessonInsight(updates.insight);
    if (!sanitized) return { success: false, error: 'Insight cannot be empty.' };
    target.insight = sanitized;
  }
  if (updates.category) target.category = updates.category;
  if (updates.confidence !== undefined) target.confidence = Math.min(100, Math.max(1, updates.confidence));
  if (updates.active !== undefined) {
    if (updates.active && !target.active) {
      const activeCount = all.filter((l) => l.active).length;
      if (activeCount >= 20) {
        return { success: false, error: 'Cannot activate lesson: maximum 20 active lessons reached.' };
      }
    }
    target.active = updates.active;
  }

  target.updatedAt = new Date().toISOString();
  saveLearningItems(all);

  recordChangeLog({
    adminEmail,
    action: updates.active !== undefined && Object.keys(updates).length === 1 ? 'TOGGLE' : 'UPDATE',
    lessonId: target.id,
    details: `Updated lesson ${target.id} (was: "${oldText}", now: "${target.insight}", active: ${target.active})`,
  });

  return { success: true, lesson: target };
}

export function deleteCuratedLesson(id: string, adminEmail: string): { success: boolean; error?: string } {
  const all = loadLearningItems();
  const idx = all.findIndex((l) => l.id === id);
  if (idx === -1) return { success: false, error: 'Lesson not found.' };

  const removed = all.splice(idx, 1)[0];
  saveLearningItems(all);

  recordChangeLog({
    adminEmail,
    action: 'DELETE',
    lessonId: removed.id,
    details: `Deleted lesson ${removed.id}: "${removed.insight}"`,
  });

  return { success: true };
}

/**
 * Format lessons for injection into Gemini prompt as context hints only.
 * Guaranteed to be sanitized, max 20, and strictly informative.
 */
export function formatLearningsForAI(): { text: string; count: number } {
  const all = loadLearningItems();
  const activeLessons = all.filter((l) => l.active).slice(0, 20);

  if (activeLessons.length === 0) {
    return {
      text: 'No active curated lessons recorded in institutional memory.',
      count: 0,
    };
  }

  const formatted = activeLessons
    .map(
      (l, idx) =>
        `${idx + 1}. [${l.category}] (Confidence ${l.confidence}%): ${sanitizeLessonInsight(l.insight)}`
    )
    .join('\n');

  return { text: formatted, count: activeLessons.length };
}

// -------------------------------------------------------------
// 5. SETUP REVIEWS & RE-VALIDATION SAFETY
// -------------------------------------------------------------
export function loadSetupReviews(): SetupReviewRecord[] {
  ensureDataDir();
  if (!fs.existsSync(REVIEWS_FILE)) return [];
  try {
    const raw = fs.readFileSync(REVIEWS_FILE, 'utf-8');
    return JSON.parse(raw) || [];
  } catch {
    return [];
  }
}

export function saveSetupReviews(reviews: SetupReviewRecord[]) {
  ensureDataDir();
  try {
    writeJsonAtomic(REVIEWS_FILE, reviews);
  } catch (err: any) {
    console.error('[GOOGLE CHAT SERVICE] Failed to save reviews:', err.message);
  }
}

export function recordSetupForReview(setup: {
  signalId: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp4: number;
  score: number;
  bias: { d1: string; h4: string; h1: string };
  zone: { high: number; low: number; mid50: number };
  timeoutMinutes?: number;
  aiVerdict?: string;
  aiReason?: string;
}): SetupReviewRecord {
  const reviews = loadSetupReviews();
  const existing = reviews.find((r) => r.signalId === setup.signalId);
  if (existing) return existing;

  const timeoutMins = setup.timeoutMinutes || loadGoogleChatSettings().reviewTimeoutMinutes || 3;
  const now = Date.now();

  const newRecord: SetupReviewRecord = {
    id: `REV-${setup.signalId}`,
    signalId: setup.signalId,
    direction: setup.direction,
    entry: Number(setup.entry.toFixed(2)),
    sl: Number(setup.sl.toFixed(2)),
    tp1: Number(setup.tp1.toFixed(2)),
    tp2: Number(setup.tp2.toFixed(2)),
    tp3: Number(setup.tp3.toFixed(2)),
    tp4: Number(setup.tp4.toFixed(2)),
    score: setup.score,
    status: 'PENDING_REVIEW',
    createdAt: new Date(now).toISOString(),
    reviewExpiresAt: new Date(now + timeoutMins * 60 * 1000).toISOString(),
    bias: setup.bias,
    zone: setup.zone,
    aiVerdict: setup.aiVerdict,
    aiReason: setup.aiReason,
  };

  reviews.unshift(newRecord);
  if (reviews.length > 50) reviews.pop();
  saveSetupReviews(reviews);
  return newRecord;
}

/**
 * Re-validates an approved setup against real-time market state before activation:
 * 1. Feed must be LIVE.
 * 2. News lock must be clear.
 * 3. Price must not be more than $3.00 beyond entry.
 * 4. Zone must not be broken.
 */
export function revalidateSetupForApproval(
  setup: SetupReviewRecord,
  livePrice: number,
  feedStatus: 'LIVE' | 'STALE' | 'OFFLINE',
  newsLockActive: boolean,
  isZoneBroken: boolean
): { ok: boolean; reason?: string } {
  if (feedStatus !== 'LIVE') {
    return { ok: false, reason: `Data feed is ${feedStatus}. Orders cannot be activated.` };
  }

  if (newsLockActive) {
    return { ok: false, reason: 'High-impact USD news window is active (±15-30m lock).' };
  }

  if (isZoneBroken) {
    return { ok: false, reason: 'M30 institutional zone was breached and invalidated during review window.' };
  }

  // Price distance check: max $3 beyond entry limit
  const isBull = setup.direction === 'BUY';
  const diff = isBull ? livePrice - setup.entry : setup.entry - livePrice;

  if (diff > 3.0) {
    return {
      ok: false,
      reason: `Live price ($${livePrice.toFixed(2)}) drifted $${diff.toFixed(2)} beyond entry limit ($${setup.entry.toFixed(2)}). Max tolerance is $3.00.`,
    };
  }

  return { ok: true };
}

export function updateSetupReviewStatus(
  signalId: string,
  status: ReviewStatus,
  reviewerName: string,
  feedbackNotes?: string,
  revalidationResult?: { ok: boolean; reason?: string }
): SetupReviewRecord | null {
  const reviews = loadSetupReviews();
  const target = reviews.find((r) => r.signalId === signalId || r.id === signalId);
  if (!target) return null;

  target.status = status;
  target.reviewedAt = new Date().toISOString();
  target.reviewerName = reviewerName;
  if (feedbackNotes) target.feedbackNotes = feedbackNotes;
  if (revalidationResult) target.revalidationResult = revalidationResult;

  saveSetupReviews(reviews);
  return target;
}
