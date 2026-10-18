import fs from 'fs';
import path from 'path';
import { DATA_DIR, writeJsonAtomic } from './deploymentSafety.ts';

const SIGNALS_FILE = path.resolve(DATA_DIR, 'btc_tide_signals.json');

export interface BtcTideTradeRecord {
  id: string;
  side: 'LONG' | 'SHORT';
  entryTime: number;
  entryPrice: number;
  initialSlPrice: number;
  slPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp3Price: number;
  oneR: number;
  currentR: number;
  pnlPercent: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
  beMoved: boolean;
  status: 'ACTIVE' | 'TP1_HIT_BE_ACTIVE' | 'TP2_HIT' | 'CLOSED';
  outcome: 'SL' | 'TP1+BE' | 'TP2' | 'TP3' | 'EXPIRED' | null;
  realizedR: number | null;
  closedAt: number | null;
  closePrice: number | null;
  expiryTime: number;
  confidence: number;
  lead: number;
  triggerReason: string;
}

export interface BtcTideDatabaseState {
  activeTrade: BtcTideTradeRecord | null;
  closedTrades: BtcTideTradeRecord[];
  lastSignalTime: number | null;
  updatedAt: number;
}

export interface BtcTideStats {
  totalClosed: number;
  winsCount: number;
  lossesCount: number;
  winRate: number | null; // null if 0 closed trades
  avgR: number | null; // null if 0 closed trades
  tp1BeCount: number;
  tp2Count: number;
  tp3Count: number;
  slCount: number;
  expiredCount: number;
}

let dbState: BtcTideDatabaseState = {
  activeTrade: null,
  closedTrades: [],
  lastSignalTime: null,
  updatedAt: Date.now(),
};

export function loadBtcTideDatabase(): BtcTideDatabaseState {
  try {
    if (fs.existsSync(SIGNALS_FILE)) {
      const raw = fs.readFileSync(SIGNALS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.closedTrades)) {
        dbState = {
          activeTrade: parsed.activeTrade || null,
          closedTrades: parsed.closedTrades,
          lastSignalTime: typeof parsed.lastSignalTime === 'number' ? parsed.lastSignalTime : null,
          updatedAt: parsed.updatedAt || Date.now(),
        };
      }
    }
  } catch (err: any) {
    console.error('[BTC TIDE DB] Error loading database, using default state:', err.message);
  }
  return dbState;
}

export function saveBtcTideDatabase(): void {
  try {
    dbState.updatedAt = Date.now();
    writeJsonAtomic(SIGNALS_FILE, dbState);
  } catch (err: any) {
    console.error('[BTC TIDE DB] Failed to save signals to disk:', err.message);
  }
}

export function computeBtcTideStats(closedTrades: BtcTideTradeRecord[]): BtcTideStats {
  if (closedTrades.length === 0) {
    return {
      totalClosed: 0,
      winsCount: 0,
      lossesCount: 0,
      winRate: null,
      avgR: null,
      tp1BeCount: 0,
      tp2Count: 0,
      tp3Count: 0,
      slCount: 0,
      expiredCount: 0,
    };
  }

  let winsCount = 0;
  let lossesCount = 0;
  let sumR = 0;
  let tp1BeCount = 0;
  let tp2Count = 0;
  let tp3Count = 0;
  let slCount = 0;
  let expiredCount = 0;

  for (const t of closedTrades) {
    const r = typeof t.realizedR === 'number' ? t.realizedR : 0;
    sumR += r;
    if (r > 0) winsCount++;
    else if (r < 0) lossesCount++;

    if (t.outcome === 'TP1+BE') tp1BeCount++;
    else if (t.outcome === 'TP2') tp2Count++;
    else if (t.outcome === 'TP3') tp3Count++;
    else if (t.outcome === 'SL') slCount++;
    else if (t.outcome === 'EXPIRED') expiredCount++;
  }

  const totalClosed = closedTrades.length;
  // Win rate and average R show "--" (null) until at least 10 real closed trades exist
  const winRate = totalClosed >= 10 ? Number(((winsCount / totalClosed) * 100).toFixed(1)) : null;
  const avgR = totalClosed >= 10 ? Number((sumR / totalClosed).toFixed(2)) : null;

  return {
    totalClosed,
    winsCount,
    lossesCount,
    winRate,
    avgR,
    tp1BeCount,
    tp2Count,
    tp3Count,
    slCount,
    expiredCount,
  };
}

export function getBtcTideDatabase(): {
  activeTrade: BtcTideTradeRecord | null;
  closedTrades: BtcTideTradeRecord[];
  stats: BtcTideStats;
  lastSignalTime: number | null;
} {
  loadBtcTideDatabase();
  return {
    activeTrade: dbState.activeTrade,
    closedTrades: dbState.closedTrades,
    stats: computeBtcTideStats(dbState.closedTrades),
    lastSignalTime: dbState.lastSignalTime,
  };
}

export function saveActiveTradeToDatabase(trade: BtcTideTradeRecord | null): void {
  loadBtcTideDatabase();
  dbState.activeTrade = trade;
  if (trade) {
    dbState.lastSignalTime = trade.entryTime;
  }
  saveBtcTideDatabase();
}

export function recordClosedTradeToDatabase(trade: BtcTideTradeRecord): BtcTideStats {
  loadBtcTideDatabase();
  // Clear active trade if matching
  if (dbState.activeTrade && dbState.activeTrade.id === trade.id) {
    dbState.activeTrade = null;
  }

  // Prevent duplicate insertion
  const existingIdx = dbState.closedTrades.findIndex((t) => t.id === trade.id);
  if (existingIdx >= 0) {
    dbState.closedTrades[existingIdx] = trade;
  } else {
    dbState.closedTrades.unshift(trade);
  }

  // Keep last 300 trades in database
  dbState.closedTrades = dbState.closedTrades.slice(0, 300);
  saveBtcTideDatabase();

  return computeBtcTideStats(dbState.closedTrades);
}

// Initial load on server boot
loadBtcTideDatabase();
