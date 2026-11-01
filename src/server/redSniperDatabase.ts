import fs from 'fs';
import path from 'path';
import initSqlJs, { Database } from 'sql.js';
import { DATA_DIR } from './deploymentSafety.ts';

export interface RedSniperStoredCandle {
  time: number; // UTC seconds
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
  buyVol: number;
  sellVol: number;
  isClosed?: boolean;
}

export type ServerBotLogType =
  | 'ENTRY'
  | 'TP1_BE'
  | 'TP2'
  | 'TP2_PARTIAL'
  | 'TP3'
  | 'TRAIL_MOVE'
  | 'EXIT'
  | 'SKIPPED_TRADE'
  | 'BOT_PAUSED'
  | 'BOT_RESUMED'
  | 'ZONE_NEW'
  | 'ZONE_NEAR'
  | 'ZONE_DEAD'
  | 'ZONE_DETECTED';

export interface ServerBotLogEntry {
  id: string;
  time: number;
  isoTime: string;
  type: ServerBotLogType | string;
  category?: 'trade' | 'zone';
  tf?: string;
  side?: 'BUY' | 'SELL';
  zoneId?: string;
  tradeId?: string;
  price?: number;
  oldSl?: number;
  newSl?: number;
  exitReason?: string;
  skipReason?: string;
  pnl?: number;
  r?: number;
  message: string;
  createdAt?: number;
}

export interface RedSniperHealthReport {
  ok: boolean;
  storedRowsPerTf: Record<string, number>;
  totalRows: number;
  oldestCandleTime: number | null;
  oldestCandleIso: string | null;
  newestCandleTime: number | null;
  newestCandleIso: string | null;
  lastWriteTime: number | null;
  lastWriteIso: string | null;
  dbSource: string;
  botLogCount: number;
}

const DEFAULT_SQLITE_PATH = path.resolve(DATA_DIR, 'redsniper.db');

let currentDbPath: string = DEFAULT_SQLITE_PATH;
let dbInstance: Database | null = null;
let isInitialized = false;
let lastWriteTimeMs: number | null = null;

export function setRedSniperDbPath(customPath: string | null): void {
  if (dbInstance) {
    try {
      persistRedSniperDatabase();
      dbInstance.close();
    } catch {}
    dbInstance = null;
    isInitialized = false;
  }
  currentDbPath = customPath || DEFAULT_SQLITE_PATH;
}

export function getRedSniperDbPath(): string {
  return currentDbPath;
}

export function closeRedSniperDatabase(): void {
  if (dbInstance) {
    try {
      persistRedSniperDatabase();
      dbInstance.close();
    } catch {}
    dbInstance = null;
    isInitialized = false;
  }
}

export function persistRedSniperDatabase(): void {
  if (!dbInstance) return;
  try {
    const binary = dbInstance.export();
    const buffer = Buffer.from(binary);
    const targetPath = currentDbPath;
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const tempPath = `${targetPath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, targetPath);
    lastWriteTimeMs = Date.now();
  } catch (err: any) {
    console.error('[RED SNIPER SQLITE] Failed to persist database to disk:', err?.message);
  }
}

/**
 * Migrate existing JSONL files and bot log JSON into SQLite if database is empty.
 */
function seedFromExistingDiskFilesIfEmpty(db: Database): void {
  if (currentDbPath !== DEFAULT_SQLITE_PATH) return;
  try {
    const res = db.exec('SELECT count(*) FROM redsniper_candles;');
    const candleCount = res.length > 0 && res[0].values.length > 0 ? Number(res[0].values[0][0]) : 0;

    if (candleCount === 0) {
      const directTfs = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
      let importedCandles = 0;

      for (const tf of directTfs) {
        const jsonlPath = path.resolve(DATA_DIR, `redsniper_store_${tf}.jsonl`);
        if (!fs.existsSync(jsonlPath)) continue;

        try {
          const content = fs.readFileSync(jsonlPath, 'utf-8');
          const lines = content.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const obj = JSON.parse(trimmed);
            if (obj && typeof obj.time === 'number' && Number.isFinite(obj.open)) {
              db.run(
                `INSERT OR REPLACE INTO redsniper_candles (tf, time, open, high, low, close, tick_volume, buy_vol, sell_vol, is_closed)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
                [
                  tf,
                  obj.time,
                  Number(obj.open),
                  Number(obj.high),
                  Number(obj.low),
                  Number(obj.close),
                  Math.max(0, Number(obj.tickVolume ?? obj.volume ?? 1)),
                  Math.max(0, Number(obj.buyVol ?? 0)),
                  Math.max(0, Number(obj.sellVol ?? 0)),
                  obj.isClosed === false ? 0 : 1,
                ]
              );
              importedCandles++;
            }
          }
        } catch {}
      }

      if (importedCandles > 0) {
        console.log(`[RED SNIPER SQLITE] Seeded ${importedCandles} candles from existing JSONL files into SQLite.`);
      }
    }

    const logRes = db.exec('SELECT count(*) FROM redsniper_bot_log;');
    const logCount = logRes.length > 0 && logRes[0].values.length > 0 ? Number(logRes[0].values[0][0]) : 0;

    if (logCount === 0) {
      const botLogJsonPath = path.resolve(DATA_DIR, 'redsniper_bot_log.json');
      if (fs.existsSync(botLogJsonPath)) {
        try {
          const raw = fs.readFileSync(botLogJsonPath, 'utf-8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && item.id && item.message) {
                db.run(
                  `INSERT OR REPLACE INTO redsniper_bot_log (id, time, iso_time, type, tf, side, zone_id, trade_id, price, old_sl, new_sl, exit_reason, pnl, r, message, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
                  [
                    item.id,
                    Number(item.time || Date.now()),
                    item.isoTime || new Date(item.time || Date.now()).toISOString(),
                    item.type || 'ZONE_DETECTED',
                    item.tf || '1m',
                    item.side || 'BUY',
                    item.zoneId || null,
                    item.tradeId || null,
                    item.price !== undefined ? Number(item.price) : null,
                    item.oldSl !== undefined ? Number(item.oldSl) : null,
                    item.newSl !== undefined ? Number(item.newSl) : null,
                    item.exitReason || null,
                    item.pnl !== undefined ? Number(item.pnl) : null,
                    item.r !== undefined ? Number(item.r) : null,
                    String(item.message || ''),
                    Date.now(),
                  ]
                );
              }
            }
          }
        } catch {}
      }
    }
  } catch (err: any) {
    console.warn('[RED SNIPER SQLITE] Seeding warning:', err?.message);
  }
}

export async function initRedSniperDatabase(customPath?: string): Promise<Database> {
  if (customPath) {
    setRedSniperDbPath(customPath);
  }

  if (dbInstance && isInitialized) return dbInstance;

  const SQL = await initSqlJs();
  let db: Database;
  const targetPath = currentDbPath;

  if (fs.existsSync(targetPath)) {
    try {
      const fileBuffer = fs.readFileSync(targetPath);
      db = new SQL.Database(fileBuffer);
      lastWriteTimeMs = fs.statSync(targetPath).mtimeMs;
    } catch (err: any) {
      console.error('[RED SNIPER SQLITE] Error reading existing database, starting fresh:', err?.message);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  // Schema creation
  db.run(`
    CREATE TABLE IF NOT EXISTS redsniper_candles (
      tf TEXT NOT NULL,
      time INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      tick_volume REAL NOT NULL DEFAULT 1,
      buy_vol REAL NOT NULL DEFAULT 0,
      sell_vol REAL NOT NULL DEFAULT 0,
      is_closed INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (tf, time)
    );

    CREATE INDEX IF NOT EXISTS idx_redsniper_candles_tf_time ON redsniper_candles(tf, time);

    CREATE TABLE IF NOT EXISTS redsniper_bot_log (
      id TEXT PRIMARY KEY,
      time INTEGER NOT NULL,
      iso_time TEXT NOT NULL,
      type TEXT NOT NULL,
      tf TEXT NOT NULL,
      side TEXT NOT NULL,
      zone_id TEXT,
      trade_id TEXT,
      price REAL,
      old_sl REAL,
      new_sl REAL,
      exit_reason TEXT,
      pnl REAL,
      r REAL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_redsniper_bot_log_time ON redsniper_bot_log(time DESC);

    CREATE TABLE IF NOT EXISTS redsniper_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  seedFromExistingDiskFilesIfEmpty(db);

  dbInstance = db;
  isInitialized = true;

  // Retrieve initial row counts and oldest timestamp for required startup line
  let totalRows = 0;
  let oldestTime: number | null = null;

  try {
    const countRes = db.exec('SELECT count(*), min(time) FROM redsniper_candles;');
    if (countRes.length > 0 && countRes[0].values.length > 0) {
      totalRows = Number(countRes[0].values[0][0]) || 0;
      const minVal = countRes[0].values[0][1];
      if (minVal !== null && minVal !== undefined) {
        oldestTime = Number(minVal);
      }
    }
  } catch {}

  const oldestStr = oldestTime ? new Date(oldestTime * 1000).toISOString() : 'none';
  console.log(`candle store: ${totalRows} rows, oldest ${oldestStr}, source: ${targetPath}`);

  persistRedSniperDatabase();
  return db;
}

export function saveCandlesToSqlite(candles: RedSniperStoredCandle[], tf: string): void {
  if (!dbInstance || !candles || candles.length === 0) return;

  try {
    for (const c of candles) {
      if (
        c &&
        typeof c.time === 'number' &&
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close)
      ) {
        dbInstance.run(
          `INSERT OR REPLACE INTO redsniper_candles (tf, time, open, high, low, close, tick_volume, buy_vol, sell_vol, is_closed)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            tf,
            c.time,
            c.open,
            c.high,
            c.low,
            c.close,
            Math.max(0, c.tickVolume || 0),
            Math.max(0, c.buyVol || 0),
            Math.max(0, c.sellVol || 0),
            c.isClosed === false ? 0 : 1,
          ]
        );
      }
    }
    persistRedSniperDatabase();
  } catch (err: any) {
    console.error(`[RED SNIPER SQLITE] Error saving candles for ${tf}:`, err?.message);
  }
}

export function getCandlesFromSqlite(tf: string, limit: number = 5000): RedSniperStoredCandle[] {
  if (!dbInstance) return [];

  try {
    const safeLimit = Math.max(1, Math.min(10000, Number(limit) || 5000));
    const res = dbInstance.exec(`
      SELECT time, open, high, low, close, tick_volume, buy_vol, sell_vol, is_closed
      FROM (
        SELECT time, open, high, low, close, tick_volume, buy_vol, sell_vol, is_closed
        FROM redsniper_candles
        WHERE tf = '${tf.replace(/'/g, "''")}'
        ORDER BY time DESC
        LIMIT ${safeLimit}
      )
      ORDER BY time ASC;
    `);

    if (res.length > 0 && res[0].values.length > 0) {
      return res[0].values.map((row) => ({
        time: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        tickVolume: Number(row[5]),
        buyVol: Number(row[6]),
        sellVol: Number(row[7]),
        isClosed: Boolean(row[8]),
      }));
    }
  } catch (err: any) {
    console.error(`[RED SNIPER SQLITE] Error querying candles for ${tf}:`, err?.message);
  }
  return [];
}

export function loadRedSniperBotLogFromSqlite(): ServerBotLogEntry[] {
  if (!dbInstance) return [];

  try {
    const res = dbInstance.exec(`
      SELECT id, time, iso_time, type, tf, side, zone_id, trade_id, price, old_sl, new_sl, exit_reason, pnl, r, message
      FROM redsniper_bot_log
      ORDER BY time DESC
      LIMIT 200;
    `);

    if (res.length > 0 && res[0].values.length > 0) {
      return res[0].values.map((row) => ({
        id: String(row[0]),
        time: Number(row[1]),
        isoTime: String(row[2]),
        type: row[3] as any,
        tf: String(row[4]),
        side: row[5] as any,
        zoneId: row[6] ? String(row[6]) : undefined,
        tradeId: row[7] ? String(row[7]) : undefined,
        price: row[8] !== null && row[8] !== undefined ? Number(row[8]) : undefined,
        oldSl: row[9] !== null && row[9] !== undefined ? Number(row[9]) : undefined,
        newSl: row[10] !== null && row[10] !== undefined ? Number(row[10]) : undefined,
        exitReason: row[11] ? String(row[11]) : undefined,
        pnl: row[12] !== null && row[12] !== undefined ? Number(row[12]) : undefined,
        r: row[13] !== null && row[13] !== undefined ? Number(row[13]) : undefined,
        message: String(row[14] || ''),
      }));
    }
  } catch (err: any) {
    console.error('[RED SNIPER SQLITE] Error reading bot log:', err?.message);
  }
  return [];
}

export function appendRedSniperBotLogToSqlite(incoming: ServerBotLogEntry[]): ServerBotLogEntry[] {
  if (!dbInstance) return [];

  try {
    for (const item of incoming || []) {
      if (item && item.id && item.message) {
        dbInstance.run(
          `INSERT OR REPLACE INTO redsniper_bot_log (id, time, iso_time, type, tf, side, zone_id, trade_id, price, old_sl, new_sl, exit_reason, pnl, r, message, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            item.id,
            Number(item.time || Date.now()),
            item.isoTime || new Date(item.time || Date.now()).toISOString(),
            item.type || 'ZONE_DETECTED',
            item.tf || '1m',
            item.side || 'BUY',
            item.zoneId || null,
            item.tradeId || null,
            item.price !== undefined ? Number(item.price) : null,
            item.oldSl !== undefined ? Number(item.oldSl) : null,
            item.newSl !== undefined ? Number(item.newSl) : null,
            item.exitReason || null,
            item.pnl !== undefined ? Number(item.pnl) : null,
            item.r !== undefined ? Number(item.r) : null,
            String(item.message || ''),
            Date.now(),
          ]
        );
      }
    }

    // Prune entries older than top 200
    dbInstance.run(`
      DELETE FROM redsniper_bot_log
      WHERE id NOT IN (
        SELECT id FROM redsniper_bot_log ORDER BY time DESC LIMIT 200
      );
    `);

    persistRedSniperDatabase();
  } catch (err: any) {
    console.error('[RED SNIPER SQLITE] Error appending to bot log:', err?.message);
  }

  return loadRedSniperBotLogFromSqlite();
}

export function clearRedSniperBotLogFromSqlite(): ServerBotLogEntry[] {
  if (!dbInstance) return [];
  try {
    dbInstance.run('DELETE FROM redsniper_bot_log;');
    persistRedSniperDatabase();
  } catch (err: any) {
    console.error('[RED SNIPER SQLITE] Error clearing bot log:', err?.message);
  }
  return [];
}

export function getRedSniperHealth(): RedSniperHealthReport {
  const allTfs = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];
  const storedRowsPerTf: Record<string, number> = {};
  for (const tf of allTfs) {
    storedRowsPerTf[tf] = 0;
  }

  let totalRows = 0;
  let oldestCandleTime: number | null = null;
  let newestCandleTime: number | null = null;
  let botLogCount = 0;

  if (dbInstance) {
    try {
      const groupRes = dbInstance.exec('SELECT tf, count(*) FROM redsniper_candles GROUP BY tf;');
      if (groupRes.length > 0 && groupRes[0].values.length > 0) {
        for (const [tfVal, countVal] of groupRes[0].values) {
          const tfStr = String(tfVal);
          const c = Number(countVal) || 0;
          storedRowsPerTf[tfStr] = c;
          totalRows += c;
        }
      }

      const minMaxRes = dbInstance.exec('SELECT min(time), max(time) FROM redsniper_candles;');
      if (minMaxRes.length > 0 && minMaxRes[0].values.length > 0) {
        const [minV, maxV] = minMaxRes[0].values[0];
        if (minV !== null && minV !== undefined) oldestCandleTime = Number(minV);
        if (maxV !== null && maxV !== undefined) newestCandleTime = Number(maxV);
      }

      const botRes = dbInstance.exec('SELECT count(*) FROM redsniper_bot_log;');
      if (botRes.length > 0 && botRes[0].values.length > 0) {
        botLogCount = Number(botRes[0].values[0][0]) || 0;
      }
    } catch (err: any) {
      console.warn('[RED SNIPER SQLITE] Health check error:', err?.message);
    }
  }

  return {
    ok: Boolean(dbInstance && isInitialized),
    storedRowsPerTf,
    totalRows,
    oldestCandleTime,
    oldestCandleIso: oldestCandleTime ? new Date(oldestCandleTime * 1000).toISOString() : null,
    newestCandleTime,
    newestCandleIso: newestCandleTime ? new Date(newestCandleTime * 1000).toISOString() : null,
    lastWriteTime: lastWriteTimeMs,
    lastWriteIso: lastWriteTimeMs ? new Date(lastWriteTimeMs).toISOString() : null,
    dbSource: currentDbPath,
    botLogCount,
  };
}
