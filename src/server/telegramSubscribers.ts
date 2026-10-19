import fs from 'fs';
import path from 'path';
import { DATA_DIR, writeJsonAtomic } from './deploymentSafety.ts';

const SUBSCRIBERS_FILE = path.resolve(DATA_DIR, 'telegram_subscribers.json');

export type SubscriberRole = 'ADMIN' | 'USER';
export type SubscriberStatus = 'APPROVED' | 'PENDING' | 'BLOCKED';
export type SubscriberMarketAccess = 'XAU' | 'BTC' | 'BOTH';

export interface TelegramSubscriber {
  chatId: string;
  username?: string;
  firstName?: string;
  role: SubscriberRole;
  status: SubscriberStatus;
  markets: SubscriberMarketAccess; // 'XAU' | 'BTC' | 'BOTH'
  createdAt: string;
  updatedAt: string;
}

interface SubscribersState {
  subscribers: Record<string, TelegramSubscriber>;
}

let state: SubscribersState = {
  subscribers: {},
};

function ensureLoaded() {
  try {
    if (fs.existsSync(SUBSCRIBERS_FILE)) {
      const raw = fs.readFileSync(SUBSCRIBERS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.subscribers === 'object') {
        state = parsed;
        for (const k of Object.keys(state.subscribers)) {
          if (!state.subscribers[k].markets) {
            state.subscribers[k].markets = 'BOTH';
          }
        }
      }
    }
  } catch (err: any) {
    console.error('[TELEGRAM SUBSCRIBERS] Failed to load subscribers file:', err.message);
  }
}

function saveState() {
  try {
    writeJsonAtomic(SUBSCRIBERS_FILE, state);
  } catch (err: any) {
    console.error('[TELEGRAM SUBSCRIBERS] Failed to save subscribers file:', err.message);
  }
}

ensureLoaded();

export function getSubscriber(chatId: string | number): TelegramSubscriber | null {
  ensureLoaded();
  const id = String(chatId).trim();
  return state.subscribers[id] || null;
}

export function isChatAdmin(chatId: string | number): boolean {
  ensureLoaded();
  const id = String(chatId).trim();
  const sub = state.subscribers[id];
  if (sub && sub.role === 'ADMIN' && sub.status === 'APPROVED') {
    return true;
  }
  const envAdmin = (process.env.TELEGRAM_ADMIN_CHAT_ID || '').trim();
  if (envAdmin && envAdmin === id) {
    return true;
  }
  return false;
}

export function isChatApproved(chatId: string | number): boolean {
  ensureLoaded();
  const id = String(chatId).trim();
  if (isChatAdmin(id)) return true;
  const sub = state.subscribers[id];
  return Boolean(sub && sub.status === 'APPROVED');
}

export function getAllAdmins(): TelegramSubscriber[] {
  ensureLoaded();
  return Object.values(state.subscribers).filter(
    (s) => s.role === 'ADMIN' && s.status === 'APPROVED'
  );
}

/**
 * Returns all approved chat IDs (Admin + Approved Subscribers) filtered by market:
 * - market = 'XAU': Admin + subscribers with markets === 'XAU' or 'BOTH'
 * - market = 'BTC': Admin + subscribers with markets === 'BTC' or 'BOTH'
 * - market = 'ALL': Admin + all approved subscribers
 */
export function getAllApprovedRecipients(
  fallbackAdminChatId?: string | null,
  market: 'XAU' | 'BTC' | 'ALL' = 'ALL'
): string[] {
  ensureLoaded();
  const set = new Set<string>();
  if (fallbackAdminChatId && !fallbackAdminChatId.startsWith('@')) {
    set.add(String(fallbackAdminChatId).trim());
  }
  for (const sub of Object.values(state.subscribers)) {
    if (sub.status !== 'APPROVED' || !sub.chatId || sub.chatId.startsWith('@')) {
      continue;
    }
    if (sub.role === 'ADMIN') {
      set.add(sub.chatId);
      continue;
    }
    const m = sub.markets || 'BOTH';
    if (market === 'ALL' || m === 'BOTH' || m === market) {
      set.add(sub.chatId);
    }
  }
  return Array.from(set);
}

export function getAllSubscribersList(): TelegramSubscriber[] {
  ensureLoaded();
  return Object.values(state.subscribers).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function registerAdminChat(
  chatId: string | number,
  username?: string,
  firstName?: string
): TelegramSubscriber {
  ensureLoaded();
  const id = String(chatId).trim();
  const now = new Date().toISOString();
  const existing = state.subscribers[id];
  const record: TelegramSubscriber = {
    chatId: id,
    username: username || existing?.username || 'admin',
    firstName: firstName || existing?.firstName || 'Admin',
    role: 'ADMIN',
    status: 'APPROVED',
    markets: 'BOTH',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  state.subscribers[id] = record;
  saveState();
  return record;
}

export function upsertUserRequest(
  chatId: string | number,
  username?: string,
  firstName?: string
): { subscriber: TelegramSubscriber; isNewPending: boolean } {
  ensureLoaded();
  const id = String(chatId).trim();
  const now = new Date().toISOString();
  const existing = state.subscribers[id];

  if (existing) {
    if (username) existing.username = username;
    if (firstName) existing.firstName = firstName;
    if (!existing.markets) existing.markets = 'BOTH';
    existing.updatedAt = now;
    saveState();
    return { subscriber: existing, isNewPending: false };
  }

  const record: TelegramSubscriber = {
    chatId: id,
    username: username || 'user',
    firstName: firstName || 'Trader',
    role: 'USER',
    status: 'PENDING',
    markets: 'BOTH',
    createdAt: now,
    updatedAt: now,
  };
  state.subscribers[id] = record;
  saveState();
  return { subscriber: record, isNewPending: true };
}

export function setSubscriberStatus(
  chatId: string | number,
  status: SubscriberStatus,
  markets?: SubscriberMarketAccess
): TelegramSubscriber | null {
  ensureLoaded();
  const id = String(chatId).trim();
  const now = new Date().toISOString();
  let sub = state.subscribers[id];
  if (!sub) {
    sub = {
      chatId: id,
      username: 'user',
      firstName: 'Subscriber',
      role: 'USER',
      status,
      markets: markets || 'BOTH',
      createdAt: now,
      updatedAt: now,
    };
    state.subscribers[id] = sub;
  } else {
    sub.status = status;
    if (markets) {
      sub.markets = markets;
    }
    sub.updatedAt = now;
  }
  saveState();
  return sub;
}

export function removeSubscriber(chatId: string | number): boolean {
  ensureLoaded();
  const id = String(chatId).trim();
  if (state.subscribers[id]) {
    delete state.subscribers[id];
    saveState();
    return true;
  }
  return false;
}
