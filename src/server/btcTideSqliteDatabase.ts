import fs from 'fs';
import path from 'path';
import initSqlJs, { Database } from 'sql.js';
import { DATA_DIR } from './deploymentSafety.ts';
import { BtcTideTradeRecord, BtcTideStats } from './btcTideSignalDatabase.ts';

const SQLITE_DB_PATH = path.resolve(DATA_DIR, 'btc_tide.db');

let currentSqliteDbPath = SQLITE_DB_PATH;
let dbInstance: Database | null = null;
let isDbInitialized = false;

export function setBtcTideSqlitePath(customPath: string | null) {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {}
    dbInstance = null;
    isDbInitialized = false;
  }
  currentSqliteDbPath = customPath || SQLITE_DB_PATH;
}

export function getBtcTideSqlitePath(): string {
  return currentSqliteDbPath;
}

export function closeBtcTideSqlite(): void {
  if (dbInstance) {
    try {
      persistSqliteToDisk();
      dbInstance.close();
    } catch {}
    dbInstance = null;
    isDbInitialized = false;
  }
}

export async function initBtcTideSqlite(): Promise<Database> {
  if (dbInstance && isDbInitialized) return dbInstance;

  const SQL = await initSqlJs();
  let db: Database;
  const targetPath = currentSqliteDbPath;

  if (fs.existsSync(targetPath)) {
    try {
      const fileBuffer = fs.readFileSync(targetPath);
      db = new SQL.Database(fileBuffer);
      console.log(`[BTC TIDE SQLITE] Loaded existing SQLite database from ${targetPath} (${fileBuffer.length} bytes)`);
    } catch (err: any) {
      console.error('[BTC TIDE SQLITE] Error reading existing db file, creating fresh:', err.message);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
    console.log(`[BTC TIDE SQLITE] Initialized new SQLite database at ${targetPath}`);
  }

  // Schema creation
  db.run(`
    CREATE TABLE IF NOT EXISTS btc_tide_signals (
      id TEXT PRIMARY KEY,
      side TEXT NOT NULL,
      entry_time INTEGER NOT NULL,
      entry_price REAL NOT NULL,
      initial_sl_price REAL NOT NULL,
      sl_price REAL NOT NULL,
      tp1_price REAL NOT NULL,
      tp2_price REAL NOT NULL,
      tp3_price REAL NOT NULL,
      one_r REAL NOT NULL,
      current_r REAL NOT NULL,
      pnl_percent REAL NOT NULL,
      tp1_hit INTEGER NOT NULL,
      tp2_hit INTEGER NOT NULL,
      tp3_hit INTEGER NOT NULL,
      be_moved INTEGER NOT NULL,
      status TEXT NOT NULL,
      outcome TEXT,
      realized_r REAL,
      closed_at INTEGER,
      close_price REAL,
      expiry_time INTEGER NOT NULL,
      confidence REAL NOT NULL,
      lead REAL NOT NULL,
      trigger_reason TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS btc_tide_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS btc_tide_oi_history (
      timestamp INTEGER PRIMARY KEY,
      open_interest REAL NOT NULL,
      source TEXT NOT NULL
    );
  `);

  dbInstance = db;
  isDbInitialized = true;

  // Enforce production DB hygiene: no row older than today unless it was a real closed trade
  if (targetPath === SQLITE_DB_PATH) {
    enforceSqliteTodayHygiene();
  }

  persistSqliteToDisk();
  return db;
}

export function enforceSqliteTodayHygiene(): void {
  if (!dbInstance) return;
  try {
    const now = new Date();
    const startOfTodayUtcMs = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0
    );

    // 1. Remove any synthetic/test rows or non-closed rows older than today
    dbInstance.run(
      `DELETE FROM btc_tide_signals
       WHERE id LIKE 'mock_%'
          OR id LIKE 'test_%'
          OR trigger_reason LIKE '%Mock%'
          OR (entry_time < ? AND (status != 'CLOSED' OR outcome IS NULL));`,
      [startOfTodayUtcMs]
    );

    // 2. Remove any OI history rows older than today
    dbInstance.run(
      `DELETE FROM btc_tide_oi_history WHERE timestamp < ?;`,
      [startOfTodayUtcMs]
    );
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] Hygiene check error:', err.message);
  }
}

export function persistSqliteToDisk(): void {
  if (!dbInstance) return;
  try {
    const binaryArray = dbInstance.export();
    const buffer = Buffer.from(binaryArray);
    const targetPath = currentSqliteDbPath;
    // Atomic write to avoid partial writes
    const tempPath = `${targetPath}.tmp_${Date.now()}`;
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, targetPath);
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] Failed to persist SQLite db to disk:', err.message);
  }
}

export function rowToTradeRecord(row: any[]): BtcTideTradeRecord {
  return {
    id: String(row[0]),
    side: row[1] as 'LONG' | 'SHORT',
    entryTime: Number(row[2]),
    entryPrice: Number(row[3]),
    initialSlPrice: Number(row[4]),
    slPrice: Number(row[5]),
    tp1Price: Number(row[6]),
    tp2Price: Number(row[7]),
    tp3Price: Number(row[8]),
    oneR: Number(row[9]),
    currentR: Number(row[10]),
    pnlPercent: Number(row[11]),
    tp1Hit: Boolean(row[12]),
    tp2Hit: Boolean(row[13]),
    tp3Hit: Boolean(row[14]),
    beMoved: Boolean(row[15]),
    status: row[16] as any,
    outcome: row[17] ? (row[17] as any) : null,
    realizedR: row[18] !== null && row[18] !== undefined ? Number(row[18]) : null,
    closedAt: row[19] ? Number(row[19]) : null,
    closePrice: row[20] !== null && row[20] !== undefined ? Number(row[20]) : null,
    expiryTime: Number(row[21]),
    confidence: Number(row[22]),
    lead: Number(row[23]),
    triggerReason: String(row[24] || ''),
  };
}

export function getActiveTradeFromSqlite(): BtcTideTradeRecord | null {
  if (!dbInstance) return null;
  try {
    const res = dbInstance.exec(`
      SELECT id, side, entry_time, entry_price, initial_sl_price, sl_price,
             tp1_price, tp2_price, tp3_price, one_r, current_r, pnl_percent,
             tp1_hit, tp2_hit, tp3_hit, be_moved, status, outcome, realized_r,
             closed_at, close_price, expiry_time, confidence, lead, trigger_reason
      FROM btc_tide_signals
      WHERE status != 'CLOSED'
      ORDER BY entry_time DESC
      LIMIT 1;
    `);

    if (res.length > 0 && res[0].values.length > 0) {
      return rowToTradeRecord(res[0].values[0]);
    }
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] Error querying active trade:', err.message);
  }
  return null;
}

export function getClosedTradesFromSqlite(limit = 300): BtcTideTradeRecord[] {
  if (!dbInstance) return [];
  try {
    const res = dbInstance.exec(`
      SELECT id, side, entry_time, entry_price, initial_sl_price, sl_price,
             tp1_price, tp2_price, tp3_price, one_r, current_r, pnl_percent,
             tp1_hit, tp2_hit, tp3_hit, be_moved, status, outcome, realized_r,
             closed_at, close_price, expiry_time, confidence, lead, trigger_reason
      FROM btc_tide_signals
      WHERE status = 'CLOSED'
      ORDER BY entry_time DESC
      LIMIT ${limit};
    `);

    if (res.length > 0 && res[0].values.length > 0) {
      return res[0].values.map((row) => rowToTradeRecord(row));
    }
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] Error querying closed trades:', err.message);
  }
  return [];
}

export function computeSqliteStats(): BtcTideStats {
  if (!dbInstance) {
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

  try {
    const res = dbInstance.exec(`
      SELECT
        COUNT(*) as total_closed,
        SUM(CASE WHEN realized_r > 0 THEN 1 ELSE 0 END) as wins_count,
        SUM(CASE WHEN realized_r < 0 THEN 1 ELSE 0 END) as losses_count,
        AVG(realized_r) as avg_r,
        SUM(CASE WHEN outcome = 'TP1+BE' THEN 1 ELSE 0 END) as tp1_be_count,
        SUM(CASE WHEN outcome = 'TP2' THEN 1 ELSE 0 END) as tp2_count,
        SUM(CASE WHEN outcome = 'TP3' THEN 1 ELSE 0 END) as tp3_count,
        SUM(CASE WHEN outcome = 'SL' THEN 1 ELSE 0 END) as sl_count,
        SUM(CASE WHEN outcome = 'EXPIRED' THEN 1 ELSE 0 END) as expired_count
      FROM btc_tide_signals
      WHERE status = 'CLOSED';
    `);

    if (res.length > 0 && res[0].values.length > 0) {
      const row = res[0].values[0];
      const totalClosed = Number(row[0] || 0);
      const winsCount = Number(row[1] || 0);
      const lossesCount = Number(row[2] || 0);
      // Win rate and average R show "--" (null) until at least 10 real closed trades exist
      const avgR = totalClosed >= 10 && row[3] !== null ? Number(Number(row[3]).toFixed(2)) : null;
      const winRate = totalClosed >= 10 ? Number(((winsCount / totalClosed) * 100).toFixed(1)) : null;

      return {
        totalClosed,
        winsCount,
        lossesCount,
        winRate,
        avgR,
        tp1BeCount: Number(row[4] || 0),
        tp2Count: Number(row[5] || 0),
        tp3Count: Number(row[6] || 0),
        slCount: Number(row[7] || 0),
        expiredCount: Number(row[8] || 0),
      };
    }
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] Error computing stats:', err.message);
  }

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

export function validateSignalPriceSafety(
  entryPrice: number,
  livePrice: number | null
): { valid: boolean; deviationPct: number; reason?: string } {
  if (livePrice === null || !Number.isFinite(livePrice) || livePrice <= 0) {
    return { valid: false, deviationPct: 100, reason: 'No valid live price available for safety check' };
  }
  const deviation = Math.abs(entryPrice - livePrice) / livePrice;
  const deviationPct = Number((deviation * 100).toFixed(2));
  if (deviation > 0.02) {
    return {
      valid: false,
      deviationPct,
      reason: `Entry price $${entryPrice.toFixed(2)} deviates ${deviationPct}% from live price $${livePrice.toFixed(2)} (> 2% tolerance)`,
    };
  }
  return { valid: true, deviationPct };
}

export function saveTradeToSqlite(trade: BtcTideTradeRecord, livePrice?: number | null): boolean {
  if (!dbInstance) return false;

  // SAFETY CHECK: Reject saving or closing any signal whose entry price deviates > 2% from the live price
  if (typeof livePrice === 'number' && Number.isFinite(livePrice) && livePrice > 0) {
    const safety = validateSignalPriceSafety(trade.entryPrice, livePrice);
    if (!safety.valid) {
      console.warn(`[BTC TIDE SAFETY] REJECTED signal operation on ${trade.id}: ${safety.reason}`);
      return false;
    }
  }

  try {
    const stmt = `
      INSERT OR REPLACE INTO btc_tide_signals (
        id, side, entry_time, entry_price, initial_sl_price, sl_price,
        tp1_price, tp2_price, tp3_price, one_r, current_r, pnl_percent,
        tp1_hit, tp2_hit, tp3_hit, be_moved, status, outcome, realized_r,
        closed_at, close_price, expiry_time, confidence, lead, trigger_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    dbInstance.run(stmt, [
      trade.id,
      trade.side,
      trade.entryTime,
      trade.entryPrice,
      trade.initialSlPrice,
      trade.slPrice,
      trade.tp1Price,
      trade.tp2Price,
      trade.tp3Price,
      trade.oneR,
      trade.currentR,
      trade.pnlPercent,
      trade.tp1Hit ? 1 : 0,
      trade.tp2Hit ? 1 : 0,
      trade.tp3Hit ? 1 : 0,
      trade.beMoved ? 1 : 0,
      trade.status,
      trade.outcome || null,
      trade.realizedR !== null && trade.realizedR !== undefined ? trade.realizedR : null,
      trade.closedAt || null,
      trade.closePrice !== null && trade.closePrice !== undefined ? trade.closePrice : null,
      trade.expiryTime,
      trade.confidence,
      trade.lead,
      trade.triggerReason,
      Date.now(),
    ]);

    // Update meta last signal time
    dbInstance.run(`
      INSERT OR REPLACE INTO btc_tide_meta (key, value) VALUES ('last_signal_time', ?);
    `, [String(trade.entryTime)]);

    persistSqliteToDisk();
    return true;
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] Error saving trade to SQLite:', err.message);
    return false;
  }
}

export function getLastSignalTimeFromSqlite(): number | null {
  if (!dbInstance) return null;
  try {
    const res = dbInstance.exec(`SELECT value FROM btc_tide_meta WHERE key = 'last_signal_time';`);
    if (res.length > 0 && res[0].values.length > 0) {
      return Number(res[0].values[0][0]);
    }
  } catch {}
  return null;
}

export interface OiHistoryResult {
  oiChange1h: number | null;
  oiChange1hPct: number | null;
  oiHistoryMinutes: number;
  oiHistoryStatus: string;
}

let lastOiPersistTime = 0;

export function recordAndComputeOiHistory(
  openInterest: number,
  source: string,
  nowMs = Date.now()
): OiHistoryResult {
  if (!dbInstance || !Number.isFinite(openInterest) || openInterest <= 0) {
    return {
      oiChange1h: null,
      oiChange1hPct: null,
      oiHistoryMinutes: 0,
      oiHistoryStatus: 'building 0m/60m',
    };
  }

  try {
    dbInstance.run(
      `INSERT OR REPLACE INTO btc_tide_oi_history (timestamp, open_interest, source) VALUES (?, ?, ?);`,
      [nowMs, openInterest, source]
    );

    // Prune samples older than 6 hours
    const cutoff = nowMs - 6 * 3600 * 1000;
    dbInstance.run(`DELETE FROM btc_tide_oi_history WHERE timestamp < ?;`, [cutoff]);

    // Persist to disk every 60s to keep disk writes gentle
    if (nowMs - lastOiPersistTime >= 60000) {
      lastOiPersistTime = nowMs;
      persistSqliteToDisk();
    }

    // Check oldest timestamp for this source
    const oldestRes = dbInstance.exec(
      `SELECT MIN(timestamp) FROM btc_tide_oi_history WHERE source = ?;`,
      [source]
    );
    const oldestTs =
      oldestRes.length > 0 && oldestRes[0].values.length > 0 && oldestRes[0].values[0][0] !== null
        ? Number(oldestRes[0].values[0][0])
        : nowMs;

    const elapsedMs = Math.max(0, nowMs - oldestTs);
    const minutesCollected = Math.floor(elapsedMs / 60000);

    if (elapsedMs < 3600 * 1000) {
      return {
        oiChange1h: null,
        oiChange1hPct: null,
        oiHistoryMinutes: minutesCollected,
        oiHistoryStatus: `building ${minutesCollected}m/60m`,
      };
    }

    // We have >= 60m of history: find the sample closest to (nowMs - 3600_000)
    const targetTs = nowMs - 3600 * 1000;
    const sampleRes = dbInstance.exec(
      `SELECT open_interest FROM btc_tide_oi_history WHERE source = ? ORDER BY ABS(timestamp - ?) ASC LIMIT 1;`,
      [source, targetTs]
    );

    if (sampleRes.length > 0 && sampleRes[0].values.length > 0) {
      const oi1hAgo = Number(sampleRes[0].values[0][0]);
      if (oi1hAgo > 0) {
        const oiChange1h = Number((openInterest - oi1hAgo).toFixed(2));
        const oiChange1hPct = Number((((openInterest - oi1hAgo) / oi1hAgo) * 100).toFixed(2));
        return {
          oiChange1h,
          oiChange1hPct,
          oiHistoryMinutes: Math.min(360, minutesCollected),
          oiHistoryStatus: 'READY',
        };
      }
    }

    return {
      oiChange1h: null,
      oiChange1hPct: null,
      oiHistoryMinutes: minutesCollected,
      oiHistoryStatus: `building ${Math.min(59, minutesCollected)}m/60m`,
    };
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] OI history error:', err.message);
    return {
      oiChange1h: null,
      oiChange1hPct: null,
      oiHistoryMinutes: 0,
      oiHistoryStatus: 'building 0m/60m',
    };
  }
}

