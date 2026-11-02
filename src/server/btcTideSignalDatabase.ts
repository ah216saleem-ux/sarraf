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
  outcome: 'SL' | 'TP1+BE' | 'TP2' | 'TP3' | 'EXPIRED' | 'EXPIRED_AFTER_TP1' | 'VOID' | null;
  realizedR: number | null;
  closedAt: number | null;
  closePrice: number | null;
  expiryTime: number;
  confidence: number;
  lead: number;
  triggerReason: string;
  engine_version?: string;
  componentScores?: Record<string, number> | null;
  trendState?: string | null;
  flowBuyPct?: number | null;
  atrShort?: number | null;
  atr1h?: number | null;
}

export interface BtcTideDatabaseState {
  activeTrade: BtcTideTradeRecord | null;
  closedTrades: BtcTideTradeRecord[];
  lastSignalTime: number | null;
  updatedAt: number;
}

export interface WorstLosingComponentStat {
  id: string;
  name: string;
  count: number;
  totalLossesWithData: number;
}

export interface BtcTideStats {
  totalClosed: number;
  winsCount: number;
  lossesCount: number;
  winRate: number | null; // null if < 10 closed trades
  avgR: number | null; // null if < 10 closed trades
  expectancy?: number | null;
  slRate?: number | null;
  expiredRate?: number | null;
  worstLosingComponent?: WorstLosingComponentStat | null;
  tp1BeCount: number;
  tp2Count: number;
  tp3Count: number;
  slCount: number;
  expiredCount: number;
}

const COMPONENT_DISPLAY_NAMES: Record<string, string> = {
  delta_flow: 'Delta Flow (60s)',
  cvd_divergence: 'CVD Divergence (3m)',
  absorb_drive: 'Absorb / Drive (60s)',
  order_book_imbalance: 'Order Book Depth (L2)',
  oi_price_direction: 'OI + Price Regime',
  funding_rate: 'Perp Funding Rate',
  liquidations: 'Forced Liquidations',
  perp_basis: 'Perp vs Spot Basis',
};

export function computeWorstLosingComponent(
  closedTrades: BtcTideTradeRecord[]
): WorstLosingComponentStat | null {
  const losingTrades = closedTrades.filter(
    (t) =>
      (t.outcome === 'SL' || (typeof t.realizedR === 'number' && t.realizedR < 0)) &&
      t.componentScores &&
      typeof t.componentScores === 'object'
  );
  if (losingTrades.length === 0) return null;

  const counts: Record<string, { count: number; sumMag: number }> = {};

  for (const t of losingTrades) {
    const scores = t.componentScores!;
    for (const [compId, rawVal] of Object.entries(scores)) {
      const score = Number(rawVal);
      if (!Number.isFinite(score) || score === 0) continue;
      const agreedWithLosingSide =
        (t.side === 'LONG' && score > 0) || (t.side === 'SHORT' && score < 0);
      if (agreedWithLosingSide) {
        if (!counts[compId]) counts[compId] = { count: 0, sumMag: 0 };
        counts[compId].count += 1;
        counts[compId].sumMag += Math.abs(score);
      }
    }
  }

  let bestId: string | null = null;
  let bestCount = 0;
  let bestMag = -1;

  for (const [compId, stat] of Object.entries(counts)) {
    if (stat.count > bestCount || (stat.count === bestCount && stat.sumMag > bestMag)) {
      bestId = compId;
      bestCount = stat.count;
      bestMag = stat.sumMag;
    }
  }

  if (!bestId || bestCount === 0) return null;
  return {
    id: bestId,
    name: COMPONENT_DISPLAY_NAMES[bestId] || bestId,
    count: bestCount,
    totalLossesWithData: losingTrades.length,
  };
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
  // Only consider trades from Phase 6 fixes (engine_version >= 'v6.0' or explicit v6.0), and exclude VOID trades
  const validTrades = closedTrades.filter(
    (t) => t.outcome !== 'VOID' && (!t.engine_version || t.engine_version >= 'v6.0')
  );

  if (validTrades.length === 0) {
    return {
      totalClosed: 0,
      winsCount: 0,
      lossesCount: 0,
      winRate: null,
      avgR: null,
      expectancy: null,
      slRate: null,
      expiredRate: null,
      worstLosingComponent: null,
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
  let sumWinR = 0;
  let sumLossAbsR = 0;
  let tp1BeCount = 0;
  let tp2Count = 0;
  let tp3Count = 0;
  let slCount = 0;
  let expiredCount = 0;

  for (const t of validTrades) {
    const r = typeof t.realizedR === 'number' ? t.realizedR : 0;
    sumR += r;

    // Strict win vs loss vs expired logic (EXPIRED is NOT a win; EXPIRED_AFTER_TP1 locked >= +0.5R at TP1)
    if (
      t.outcome === 'TP1+BE' ||
      t.outcome === 'TP2' ||
      t.outcome === 'TP3' ||
      (t.outcome === 'EXPIRED_AFTER_TP1' && r > 0)
    ) {
      winsCount++;
      sumWinR += Math.max(0, r);
    } else if (t.outcome === 'SL') {
      lossesCount++;
      sumLossAbsR += Math.abs(r);
    } else if (t.outcome === 'EXPIRED') {
      expiredCount++;
    }

    if (t.outcome === 'EXPIRED_AFTER_TP1') {
      expiredCount++;
      tp1BeCount++;
    } else if (t.outcome === 'TP1+BE') tp1BeCount++;
    else if (t.outcome === 'TP2') tp2Count++;
    else if (t.outcome === 'TP3') tp3Count++;
    else if (t.outcome === 'SL') slCount++;
  }

  const totalClosed = validTrades.length;
  const winRate = totalClosed > 0 ? Number(((winsCount / totalClosed) * 100).toFixed(1)) : null;
  const avgR = totalClosed > 0 ? Number((sumR / totalClosed).toFixed(2)) : null;
  const winProb = totalClosed > 0 ? winsCount / totalClosed : 0;
  const lossProb = totalClosed > 0 ? lossesCount / totalClosed : 0;
  const avgWinR = winsCount > 0 ? sumWinR / winsCount : 0;
  const avgLossAbsR = lossesCount > 0 ? sumLossAbsR / lossesCount : 0;
  const expectancy =
    totalClosed > 0
      ? Number((winProb * avgWinR - lossProb * avgLossAbsR).toFixed(2))
      : null;
  const slRate =
    totalClosed > 0 ? Number(((slCount / totalClosed) * 100).toFixed(1)) : null;
  const expiredRate =
    totalClosed > 0 ? Number(((expiredCount / totalClosed) * 100).toFixed(1)) : null;
  const worstLosingComponent = computeWorstLosingComponent(validTrades);

  return {
    totalClosed,
    winsCount,
    lossesCount,
    winRate,
    avgR,
    expectancy,
    slRate,
    expiredRate,
    worstLosingComponent,
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
