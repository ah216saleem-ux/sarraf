import fs from 'fs';
import path from 'path';
import initSqlJs, { Database } from 'sql.js';
import { Firestore, WriteBatch } from '@google-cloud/firestore';
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
  source?: 'hist' | 'live';
}

export interface RedSniperBackfillStatus {
  running: boolean;
  status: 'idle' | 'running' | 'completed' | 'error';
  provider: string;
  progressPct: number;
  completedChunks: number;
  totalChunks: number;
  calibratedOffsetPts: number | null;
  offsetWarning: string | null;
  m1HistBars: number;
  d1HistBars: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface ServerBotLogEntry {
  id: string;
  time: number;
  isoTime: string;
  type: 'ZONE_DETECTED' | 'ENTRY' | 'TP1_BE' | 'TP2_PARTIAL' | 'TRAIL_MOVE' | 'EXIT';
  tf: string;
  side: 'BUY' | 'SELL';
  zoneId?: string;
  tradeId?: string;
  price?: number;
  oldSl?: number;
  newSl?: number;
  exitReason?: string;
  pnl?: number;
  r?: number;
  message: string;
  createdAt?: number;
}

export interface RedSniperGap {
  from: number; // seconds
  to: number; // seconds
  fromIso: string;
  toIso: string;
  durationMinutes: number;
  formatted: string; // e.g. "gap 2h14m - broker history cannot fill"
  reason: string;
}

export interface FirestoreOpsReport {
  readsToday: number;
  writesToday: number;
  totalReads: number;
  totalWrites: number;
  maxReadsPerDay: number;
  readLimitExceeded: boolean;
  cacheHits: number;
  lastHourlyLogIso: string | null;
}

export interface RedSniperHealthReport {
  ok: boolean;
  backend: 'firestore' | 'sqlite';
  persistent: boolean;
  isKService: boolean;
  instanceUptimeSeconds: number;
  gaps: RedSniperGap[];
  storedRowsPerTf: Record<string, number>;
  totalRows: number;
  oldestCandleTime: number | null;
  oldestCandleIso: string | null;
  newestCandleTime: number | null;
  newestCandleIso: string | null;
  lastWriteTime: number | null;
  lastWriteIso: string | null;
  dbSource: string;
  dataDirPath?: string;
  dataDirFreeBytes?: number | null;
  dataDirFreeFormatted?: string;
  botLogCount: number;
  firestoreOps?: FirestoreOpsReport;
  readLimitExceeded?: boolean;
  backfill?: RedSniperBackfillStatus;
}

export interface CandleStore {
  saveCandles(candles: RedSniperStoredCandle[], tf: string): Promise<number>;
  getCandles(tf: string, limit?: number): Promise<RedSniperStoredCandle[]>;
  getHealth(): Promise<Omit<RedSniperHealthReport, 'instanceUptimeSeconds' | 'gaps'>>;
}

export interface BotLogStore {
  loadLogs(): Promise<ServerBotLogEntry[]>;
  appendLogs(entries: ServerBotLogEntry[]): Promise<ServerBotLogEntry[]>;
  clearLogs(): Promise<ServerBotLogEntry[]>;
}

export interface RedSniperCombinedStore extends CandleStore, BotLogStore {
  init(): Promise<void>;
  close(): Promise<void>;
  getBackendName(): 'firestore' | 'sqlite';
  isPersistent(): boolean;
  getDbSource(): string;
}

export const RED_SNIPER_DIRECT_TFS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const;

// -------------------------------------------------------------
// HELPER: Dynamic Owner Email Check (No hardcoded emails)
// -------------------------------------------------------------
export function isUserTerminalOwner(user: any): boolean {
  if (!user) return false;
  if (user.isAdmin === true || user.role === 'admin') return true;

  const envOwnerEmails = (process.env.OWNER_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (envOwnerEmails.length > 0) {
    const userEmail = String(user.email || '').trim().toLowerCase();
    if (userEmail && envOwnerEmails.includes(userEmail)) {
      return true;
    }
  }

  return false;
}

// -------------------------------------------------------------
// HELPER: Gap Detection & Formatting
// -------------------------------------------------------------
export function formatGapDuration(durationMinutes: number): string {
  const hours = Math.floor(durationMinutes / 60);
  const mins = durationMinutes % 60;
  if (hours > 0 && mins > 0) {
    return `gap ${hours}h${mins}m - broker history cannot fill`;
  }
  if (hours > 0) {
    return `gap ${hours}h - broker history cannot fill`;
  }
  return `gap ${mins}m - broker history cannot fill`;
}

export function detectRedSniperGaps(
  candles: RedSniperStoredCandle[],
  nowSec: number = Math.floor(Date.now() / 1000)
): RedSniperGap[] {
  if (!candles || candles.length === 0) return [];
  const gaps: RedSniperGap[] = [];

  // Sort ascending by time
  const sorted = [...candles].sort((a, b) => a.time - b.time);

  // 1. Check gaps between consecutive candles (> 1.4x 1 minute, minimum 3 minutes to avoid false ticks)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].time;
    const curr = sorted[i].time;
    const diffSec = curr - prev;
    if (diffSec > 180) { // > 3 minutes gap in 1m bars
      const durationMinutes = Math.round(diffSec / 60);
      gaps.push({
        from: prev,
        to: curr,
        fromIso: new Date(prev * 1000).toISOString(),
        toIso: new Date(curr * 1000).toISOString(),
        durationMinutes,
        formatted: formatGapDuration(durationMinutes),
        reason: 'broker history cannot fill',
      });
    }
  }

  // 2. Check remaining hole between newest stored candle and current time (now)
  const newestTime = sorted[sorted.length - 1].time;
  const elapsedSinceNewestSec = nowSec - newestTime;
  // If more than 3 minutes have elapsed and broker could not fill it
  if (elapsedSinceNewestSec > 180) {
    const durationMinutes = Math.round(elapsedSinceNewestSec / 60);
    gaps.push({
      from: newestTime,
      to: nowSec,
      fromIso: new Date(newestTime * 1000).toISOString(),
      toIso: new Date(nowSec * 1000).toISOString(),
      durationMinutes,
      formatted: formatGapDuration(durationMinutes),
      reason: 'broker history cannot fill',
    });
  }

  return gaps;
}

// -------------------------------------------------------------
// BACKEND 1: SqliteStore (Local Dev & Unit Tests)
// -------------------------------------------------------------
export class SqliteStore implements RedSniperCombinedStore {
  private currentDbPath: string;
  private dbInstance: Database | null = null;
  private isInitialized = false;
  private lastWriteTimeMs: number | null = null;

  constructor(customPath?: string) {
    this.currentDbPath = customPath || path.resolve(DATA_DIR, 'redsniper.db');
  }

  public getBackendName(): 'sqlite' {
    return 'sqlite';
  }

  public getDbSource(): string {
    return this.currentDbPath;
  }

  /**
   * Persistent only if the file path is NOT in the ephemeral container directories (/app, /tmp)
   */
  public isPersistent(): boolean {
    const p = path.resolve(this.currentDbPath);
    if (!path.isAbsolute(p)) return false;
    if (p.startsWith('/app') || p.startsWith('/tmp')) {
      return false;
    }
    return true;
  }

  public setCustomPath(newPath: string): void {
    if (this.dbInstance) {
      try {
        this.persist();
        this.dbInstance.close();
      } catch {}
      this.dbInstance = null;
      this.isInitialized = false;
    }
    this.currentDbPath = newPath;
  }

  public async init(): Promise<void> {
    if (this.dbInstance && this.isInitialized) return;

    const SQL = await initSqlJs();
    let db: Database;
    const targetPath = this.currentDbPath;

    if (fs.existsSync(targetPath)) {
      try {
        const fileBuffer = fs.readFileSync(targetPath);
        db = new SQL.Database(fileBuffer);
        this.lastWriteTimeMs = fs.statSync(targetPath).mtimeMs;
      } catch (err: any) {
        console.error('[RED SNIPER SQLITE] Error reading existing database, starting fresh:', err?.message);
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }

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
        source TEXT NOT NULL DEFAULT 'live',
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
    `);

    try {
      db.run(`ALTER TABLE redsniper_candles ADD COLUMN source TEXT NOT NULL DEFAULT 'live';`);
    } catch {
      // Column already exists
    }

    this.dbInstance = db;
    this.isInitialized = true;

    // Log startup line
    const health = await this.getHealth();
    const oldestStr = health.oldestCandleIso || 'none';
    console.log(`candle store: ${health.totalRows} rows, oldest ${oldestStr}, source: ${targetPath}`);
    this.persist();
  }

  public async close(): Promise<void> {
    if (this.dbInstance) {
      try {
        this.persist();
        this.dbInstance.close();
      } catch {}
      this.dbInstance = null;
      this.isInitialized = false;
    }
  }

  public persist(): void {
    if (!this.dbInstance) return;
    try {
      const binary = this.dbInstance.export();
      const buffer = Buffer.from(binary);
      const targetPath = this.currentDbPath;
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const tempPath = `${targetPath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      fs.writeFileSync(tempPath, buffer);
      fs.renameSync(tempPath, targetPath);
      this.lastWriteTimeMs = Date.now();
    } catch (err: any) {
      console.error('[RED SNIPER SQLITE] Failed to persist database to disk:', err?.message);
    }
  }

  public async saveCandles(candles: RedSniperStoredCandle[], tf: string): Promise<number> {
    if (!this.dbInstance || !candles || candles.length === 0) return 0;
    let saved = 0;
    try {
      this.dbInstance.run('BEGIN TRANSACTION;');
      const stmt = this.dbInstance.prepare(
        `INSERT INTO redsniper_candles (tf, time, open, high, low, close, tick_volume, buy_vol, sell_vol, is_closed, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tf, time) DO UPDATE SET
           open = CASE WHEN redsniper_candles.source = 'live' AND excluded.source = 'hist' THEN redsniper_candles.open ELSE excluded.open END,
           high = CASE WHEN redsniper_candles.source = 'live' AND excluded.source = 'hist' THEN redsniper_candles.high ELSE excluded.high END,
           low = CASE WHEN redsniper_candles.source = 'live' AND excluded.source = 'hist' THEN redsniper_candles.low ELSE excluded.low END,
           close = CASE WHEN redsniper_candles.source = 'live' AND excluded.source = 'hist' THEN redsniper_candles.close ELSE excluded.close END,
           tick_volume = CASE WHEN redsniper_candles.source = 'live' AND excluded.source = 'hist' THEN redsniper_candles.tick_volume ELSE excluded.tick_volume END,
           buy_vol = CASE WHEN redsniper_candles.source = 'live' AND excluded.source = 'hist' THEN redsniper_candles.buy_vol ELSE excluded.buy_vol END,
           sell_vol = CASE WHEN redsniper_candles.source = 'live' AND excluded.source = 'hist' THEN redsniper_candles.sell_vol ELSE excluded.sell_vol END,
           is_closed = CASE WHEN redsniper_candles.source = 'live' AND excluded.source = 'hist' THEN redsniper_candles.is_closed ELSE excluded.is_closed END,
           source = CASE WHEN redsniper_candles.source = 'live' OR excluded.source = 'live' THEN 'live' ELSE 'hist' END;`
      );
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
            stmt.run([
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
              c.source === 'hist' ? 'hist' : 'live',
            ]);
            saved++;
          }
        }
      } finally {
        stmt.free();
      }
      this.dbInstance.run('COMMIT;');
      if (saved > 0) {
        this.persist();
      }
    } catch (err: any) {
      try {
        this.dbInstance.run('ROLLBACK;');
      } catch {}
      console.error(`[RED SNIPER SQLITE] Error saving candles for ${tf}:`, err?.message);
    }
    return saved;
  }

  public async getCandles(tf: string, limit: number = 5000): Promise<RedSniperStoredCandle[]> {
    if (!this.dbInstance) return [];
    try {
      const maxCap = tf === '1m' ? 400000 : 15000;
      const safeLimit = Math.max(1, Math.min(maxCap, Number(limit) || 5000));
      const res = this.dbInstance.exec(`
        SELECT time, open, high, low, close, tick_volume, buy_vol, sell_vol, is_closed, source
        FROM (
          SELECT time, open, high, low, close, tick_volume, buy_vol, sell_vol, is_closed, source
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
          source: row[9] === 'hist' ? 'hist' : 'live',
        }));
      }
    } catch (err: any) {
      console.error(`[RED SNIPER SQLITE] Error querying candles for ${tf}:`, err?.message);
    }
    return [];
  }

  public async loadLogs(): Promise<ServerBotLogEntry[]> {
    if (!this.dbInstance) return [];
    try {
      const res = this.dbInstance.exec(`
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

  public async appendLogs(incoming: ServerBotLogEntry[]): Promise<ServerBotLogEntry[]> {
    if (!this.dbInstance) return [];
    try {
      for (const item of incoming || []) {
        if (item && item.id && item.message) {
          this.dbInstance.run(
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
      this.dbInstance.run(`
        DELETE FROM redsniper_bot_log
        WHERE id NOT IN (
          SELECT id FROM redsniper_bot_log ORDER BY time DESC LIMIT 200
        );
      `);
      this.persist();
    } catch (err: any) {
      console.error('[RED SNIPER SQLITE] Error appending to bot log:', err?.message);
    }
    return this.loadLogs();
  }

  public async clearLogs(): Promise<ServerBotLogEntry[]> {
    if (!this.dbInstance) return [];
    try {
      this.dbInstance.run('DELETE FROM redsniper_bot_log;');
      this.persist();
    } catch (err: any) {
      console.error('[RED SNIPER SQLITE] Error clearing bot log:', err?.message);
    }
    return [];
  }

  public async getHealth(): Promise<Omit<RedSniperHealthReport, 'instanceUptimeSeconds' | 'gaps'>> {
    const allTfs = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];
    const storedRowsPerTf: Record<string, number> = {};
    for (const tf of allTfs) {
      storedRowsPerTf[tf] = 0;
    }

    let totalRows = 0;
    let oldestCandleTime: number | null = null;
    let newestCandleTime: number | null = null;
    let botLogCount = 0;

    if (this.dbInstance) {
      try {
        const groupRes = this.dbInstance.exec('SELECT tf, count(*) FROM redsniper_candles GROUP BY tf;');
        if (groupRes.length > 0 && groupRes[0].values.length > 0) {
          for (const [tfVal, countVal] of groupRes[0].values) {
            const tfStr = String(tfVal);
            const c = Number(countVal) || 0;
            storedRowsPerTf[tfStr] = c;
            totalRows += c;
          }
        }

        const minMaxRes = this.dbInstance.exec('SELECT min(time), max(time) FROM redsniper_candles;');
        if (minMaxRes.length > 0 && minMaxRes[0].values.length > 0) {
          const [minV, maxV] = minMaxRes[0].values[0];
          if (minV !== null && minV !== undefined) oldestCandleTime = Number(minV);
          if (maxV !== null && maxV !== undefined) newestCandleTime = Number(maxV);
        }

        const botRes = this.dbInstance.exec('SELECT count(*) FROM redsniper_bot_log;');
        if (botRes.length > 0 && botRes[0].values.length > 0) {
          botLogCount = Number(botRes[0].values[0][0]) || 0;
        }
      } catch (err: any) {
        console.warn('[RED SNIPER SQLITE] Health check query error:', err?.message);
      }
    }

    return {
      ok: Boolean(this.dbInstance && this.isInitialized),
      backend: 'sqlite',
      persistent: this.isPersistent(),
      isKService: Boolean(process.env.K_SERVICE),
      storedRowsPerTf,
      totalRows,
      oldestCandleTime,
      oldestCandleIso: oldestCandleTime ? new Date(oldestCandleTime * 1000).toISOString() : null,
      newestCandleTime,
      newestCandleIso: newestCandleTime ? new Date(newestCandleTime * 1000).toISOString() : null,
      lastWriteTime: this.lastWriteTimeMs,
      lastWriteIso: this.lastWriteTimeMs ? new Date(this.lastWriteTimeMs).toISOString() : null,
      dbSource: this.currentDbPath,
      botLogCount,
    };
  }
}

// -------------------------------------------------------------
// CHUNKED CANDLE STORAGE HELPERS (One doc/day for 1m-1h, one doc/month for 4h-1d)
// -------------------------------------------------------------
export function getCandleChunkKey(timeSec: number, tf: string): string {
  const d = new Date(timeSec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  if (tf === '4h' || tf === '1d') {
    return `${tf}_${y}-${m}`;
  }
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${tf}_${y}-${m}-${day}`;
}

export function dedupeChunkCandles(
  existing: RedSniperStoredCandle[],
  incoming: RedSniperStoredCandle[]
): RedSniperStoredCandle[] {
  const map = new Map<number, RedSniperStoredCandle>();
  for (const c of existing || []) {
    if (c && typeof c.time === 'number' && Number.isFinite(c.time) && c.time > 0) {
      map.set(c.time, { ...c, source: c.source === 'hist' ? 'hist' : 'live' });
    }
  }
  for (const c of incoming || []) {
    if (c && typeof c.time === 'number' && Number.isFinite(c.time) && c.time > 0) {
      const prev = map.get(c.time);
      const inSource = c.source === 'hist' ? 'hist' : 'live';
      if (!prev) {
        map.set(c.time, { ...c, source: inSource });
      } else {
        const prevSource = prev.source === 'hist' ? 'hist' : 'live';
        if (prevSource === 'live' && inSource === 'hist') {
          continue;
        }
        const tickVolume = c.tickVolume > 0 ? c.tickVolume : prev.tickVolume;
        const inFlow = (c.buyVol || 0) + (c.sellVol || 0);
        const prevFlow = (prev.buyVol || 0) + (prev.sellVol || 0);
        let buyVol = c.buyVol || 0;
        let sellVol = c.sellVol || 0;
        if (inFlow === 0 && prevFlow > 0 && tickVolume > 0) {
          const ratio = prev.buyVol / prevFlow;
          buyVol = Math.round(tickVolume * ratio);
          sellVol = Math.max(0, tickVolume - buyVol);
        }
        map.set(c.time, {
          time: c.time,
          open: c.open,
          high: prevSource === inSource ? Math.max(c.high, prev.high) : c.high,
          low: prevSource === inSource ? Math.min(c.low, prev.low) : c.low,
          close: c.close,
          tickVolume,
          buyVol,
          sellVol,
          isClosed: c.isClosed ?? prev.isClosed,
          source: inSource,
        });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

// -------------------------------------------------------------
// BACKEND 2: FirestoreStore (Production, Persistent, Chunked)
// -------------------------------------------------------------
export interface FirestoreLikeClient {
  collection(name: string): any;
  batch(): any;
}

export class FirestoreStore implements RedSniperCombinedStore {
  private firestore: FirestoreLikeClient | null = null;
  private isInitialized = false;
  private lastWriteTimeMs: number | null = null;
  private projectId: string = '';
  private fallbackStore: SqliteStore = new SqliteStore();
  private firestoreAvailable: boolean | null = null;
  private firestoreError: string | null = null;

  // In-memory candle cache per timeframe (serves all GET requests, 0 Firestore reads)
  private memoryCache: Record<string, RedSniperStoredCandle[]> = {
    '1m': [],
    '3m': [],
    '5m': [],
    '15m': [],
    '30m': [],
    '1h': [],
    '4h': [],
    '1d': [],
  };
  private botLogCache: ServerBotLogEntry[] = [];

  // Operation counters
  private readsToday: number = 0;
  private writesToday: number = 0;
  private totalReads: number = 0;
  private totalWrites: number = 0;
  private cacheHits: number = 0;
  private currentDayUtc: string = new Date().toISOString().slice(0, 10);
  private lastHourlyLogTimeMs: number = Date.now();
  private migrationDone: boolean = false;
  private hourlyIntervalId: any = null;

  constructor(customClient?: FirestoreLikeClient) {
    if (customClient) {
      this.firestore = customClient;
    }
  }

  public getBackendName(): 'firestore' {
    return 'firestore';
  }

  public getDbSource(): string {
    if (this.firestoreAvailable === false) {
      return `sqlite fallback (firestore unavailable: ${this.firestoreError || 'not found'})`;
    }
    return `firestore://${this.projectId || 'adc'}/redsniper_candle_chunks`;
  }

  public isPersistent(): boolean {
    if (this.firestoreAvailable === false) {
      return this.fallbackStore.isPersistent();
    }
    return true; // Cloud Firestore is fully persistent across all restarts/redeploys
  }

  public getMaxReadsPerDay(): number {
    const raw = process.env.REDSNIPER_MAX_READS_PER_DAY;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 20000;
  }

  private checkDailyReset(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDayUtc) {
      this.readsToday = 0;
      this.writesToday = 0;
      this.currentDayUtc = today;
    }
  }

  public logHourlyStatsIfDue(force: boolean = false): void {
    const now = Date.now();
    if (force || now - this.lastHourlyLogTimeMs >= 3600 * 1000) {
      this.lastHourlyLogTimeMs = now;
      const maxR = this.getMaxReadsPerDay();
      console.log(
        `[RED SNIPER FIRESTORE] Hourly stats: reads=${this.totalReads} (today: ${this.readsToday}/${maxR}), writes=${this.totalWrites} (today: ${this.writesToday}), cache_hits=${this.cacheHits}`
      );
    }
  }

  public async init(): Promise<void> {
    if (this.isInitialized) return;

    // Always ensure the fallback SQLite store is ready
    await this.fallbackStore.init().catch(() => {});

    if (!this.firestore) {
      let resolvedProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
      if (!resolvedProjectId) {
        try {
          const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
          if (fs.existsSync(configPath)) {
            const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (raw?.projectId) resolvedProjectId = raw.projectId;
          }
        } catch {}
      }
      this.projectId = resolvedProjectId || '';
      try {
        this.firestore = new Firestore({
          projectId: resolvedProjectId || undefined,
        });
      } catch (err: any) {
        this.firestoreAvailable = false;
        const reason = err?.message || 'Firestore client initialization failed';
        this.firestoreError = reason;
        console.error(`Firestore unavailable: ${reason} - falling back to SQLite, persistent=false`);
      }
    }

    if (this.firestore && this.firestoreAvailable === null) {
      try {
        // Probe firestore connectivity at startup
        await this.firestore.collection('redsniper_candle_chunks').limit(1).get();
        this.firestoreAvailable = true;
        this.firestoreError = null;
        this.readsToday += 1;
        this.totalReads += 1;
      } catch (err: any) {
        this.firestoreAvailable = false;
        const codeStr = err?.code ? String(err.code) : '';
        const msg = err?.message || 'Access denied';
        const reason = (codeStr && !msg.startsWith(codeStr) ? `${codeStr} ${msg}` : msg).trim();
        this.firestoreError = reason;
        console.error(`Firestore unavailable: ${reason} - falling back to SQLite, persistent=false`);
      }
    }

    if (this.firestoreAvailable) {
      // 1. Run one-time migration from legacy per-candle docs if present
      await this.migrateLegacyDocsIfPresent();

      // 2. Load historical chunks once into in-memory cache
      await this.loadAllChunksIntoMemoryCache();

      // 3. Load bot log cache once
      await this.loadBotLogsIntoMemoryCache();
    } else {
      // If Firestore is unavailable, seed in-memory cache from fallback SQLite
      for (const tf of RED_SNIPER_DIRECT_TFS) {
        const fromSqlite = await this.fallbackStore.getCandles(tf, 5000);
        this.memoryCache[tf] = fromSqlite;
      }
      this.botLogCache = await this.fallbackStore.loadLogs();
    }

    this.isInitialized = true;

    // Start hourly stats logging interval
    if (!this.hourlyIntervalId) {
      this.hourlyIntervalId = setInterval(() => {
        this.logHourlyStatsIfDue(true);
      }, 3600 * 1000);
      if (typeof this.hourlyIntervalId?.unref === 'function') {
        this.hourlyIntervalId.unref();
      }
    }

    // Log startup line
    try {
      const health = await this.getHealth();
      const oldestStr = health.oldestCandleIso || 'none';
      console.log(`candle store: ${health.totalRows} rows, oldest ${oldestStr}, source: ${this.getDbSource()}`);
    } catch {
      console.log(`candle store: initialized, source: ${this.getDbSource()}`);
    }
  }

  public async close(): Promise<void> {
    this.isInitialized = false;
    if (this.hourlyIntervalId) {
      clearInterval(this.hourlyIntervalId);
      this.hourlyIntervalId = null;
    }
    await this.fallbackStore.close().catch(() => {});
  }

  /**
   * Migrate legacy per-candle documents from redsniper_candles into chunked format on first start.
   */
  public async migrateLegacyDocsIfPresent(): Promise<void> {
    if (!this.firestore || this.migrationDone) return;
    try {
      // Check migration status metadata document
      let metaDoc: any = null;
      try {
        metaDoc = await this.firestore.collection('redsniper_meta').doc('migration').get();
        this.readsToday += 1;
        this.totalReads += 1;
      } catch {}

      if (metaDoc && metaDoc.exists && metaDoc.data()?.chunksMigrated) {
        this.migrationDone = true;
        return;
      }

      // Probe if legacy documents exist in redsniper_candles
      let legacySnap: any = null;
      try {
        legacySnap = await this.firestore.collection('redsniper_candles').limit(1).get();
        this.readsToday += 1;
        this.totalReads += 1;
      } catch {}

      if (!legacySnap || legacySnap.empty) {
        this.migrationDone = true;
        try {
          await this.firestore.collection('redsniper_meta').doc('migration').set(
            { chunksMigrated: true, migratedAt: Date.now(), migratedCount: 0 },
            { merge: true }
          );
          this.writesToday += 1;
          this.totalWrites += 1;
        } catch {}
        return;
      }

      console.log('[RED SNIPER FIRESTORE] Migrating legacy per-candle docs to chunked format...');
      let totalMigrated = 0;

      for (const tf of RED_SNIPER_DIRECT_TFS) {
        const snap = await this.firestore.collection('redsniper_candles').where('tf', '==', tf).limit(5000).get();
        this.readsToday += snap.size || 1;
        this.totalReads += snap.size || 1;

        if (snap && !snap.empty) {
          const candles: RedSniperStoredCandle[] = [];
          snap.forEach((doc: any) => {
            const d = doc.data();
            if (d && typeof d.time === 'number') {
              candles.push({
                time: Number(d.time),
                open: Number(d.open),
                high: Number(d.high),
                low: Number(d.low),
                close: Number(d.close),
                tickVolume: Number(d.tickVolume ?? 0),
                buyVol: Number(d.buyVol ?? 0),
                sellVol: Number(d.sellVol ?? 0),
                isClosed: Boolean(d.isClosed),
              });
            }
          });

          // Group by chunkKey
          const byChunk = new Map<string, RedSniperStoredCandle[]>();
          for (const c of candles) {
            const k = getCandleChunkKey(c.time, tf);
            if (!byChunk.has(k)) byChunk.set(k, []);
            byChunk.get(k)!.push(c);
          }

          const batch = this.firestore.batch();
          for (const [chunkKey, cList] of byChunk.entries()) {
            const sorted = dedupeChunkCandles([], cList);
            const ref = this.firestore.collection('redsniper_candle_chunks').doc(chunkKey);
            batch.set(
              ref,
              {
                chunkKey,
                tf,
                period: tf === '4h' || tf === '1d' ? 'month' : 'day',
                date: chunkKey.slice(tf.length + 1),
                candles: sorted,
                count: sorted.length,
                firstTime: sorted[0]?.time ?? 0,
                lastTime: sorted[sorted.length - 1]?.time ?? 0,
                updatedAt: Date.now(),
              },
              { merge: true }
            );
            this.writesToday += 1;
            this.totalWrites += 1;
          }
          await batch.commit();
          totalMigrated += candles.length;
        }
      }

      await this.firestore.collection('redsniper_meta').doc('migration').set(
        { chunksMigrated: true, migratedAt: Date.now(), migratedCount: totalMigrated },
        { merge: true }
      );
      this.writesToday += 1;
      this.totalWrites += 1;
      this.migrationDone = true;
      console.log(`[RED SNIPER FIRESTORE] Migration finished: ${totalMigrated} candles converted into chunked documents.`);
    } catch (err: any) {
      console.warn('[RED SNIPER FIRESTORE] Migration note:', err?.message);
    }
  }

  /**
   * Load historical chunks once into in-memory cache on startup.
   */
  private async loadAllChunksIntoMemoryCache(): Promise<void> {
    if (!this.firestore) return;
    this.checkDailyReset();
    const maxReads = this.getMaxReadsPerDay();

    try {
      for (const tf of RED_SNIPER_DIRECT_TFS) {
        if (this.readsToday >= maxReads) {
          console.warn(`[RED SNIPER FIRESTORE] Read cap reached during startup cache loading (${this.readsToday}/${maxReads}).`);
          break;
        }

        const snap = await this.firestore
          .collection('redsniper_candle_chunks')
          .where('tf', '==', tf)
          .limit(100)
          .get();

        this.readsToday += snap.size || 1;
        this.totalReads += snap.size || 1;

        if (snap && !snap.empty) {
          let allTfCandles: RedSniperStoredCandle[] = [];
          snap.forEach((doc: any) => {
            const data = doc.data();
            if (data && Array.isArray(data.candles)) {
              allTfCandles = allTfCandles.concat(data.candles);
            }
          });
          this.memoryCache[tf] = dedupeChunkCandles([], allTfCandles);
        }
      }
    } catch (err: any) {
      console.warn('[RED SNIPER FIRESTORE] Cache preload warning:', err?.message);
    }
  }

  private async loadBotLogsIntoMemoryCache(): Promise<void> {
    if (!this.firestore) return;
    try {
      const snapshot = await this.firestore
        .collection('redsniper_botlog')
        .orderBy('time', 'desc')
        .limit(200)
        .get();

      this.readsToday += snapshot.size || 1;
      this.totalReads += snapshot.size || 1;

      if (snapshot && !snapshot.empty) {
        const logs: ServerBotLogEntry[] = [];
        snapshot.forEach((doc: any) => {
          const d = doc.data();
          if (d && d.id) {
            logs.push({
              id: String(d.id),
              time: Number(d.time),
              isoTime: String(d.isoTime || new Date(d.time).toISOString()),
              type: d.type || 'ZONE_DETECTED',
              tf: String(d.tf || '1m'),
              side: d.side || 'BUY',
              zoneId: d.zoneId || undefined,
              tradeId: d.tradeId || undefined,
              price: d.price !== undefined && d.price !== null ? Number(d.price) : undefined,
              oldSl: d.oldSl !== undefined && d.oldSl !== null ? Number(d.oldSl) : undefined,
              newSl: d.newSl !== undefined && d.newSl !== null ? Number(d.newSl) : undefined,
              exitReason: d.exitReason || undefined,
              pnl: d.pnl !== undefined && d.pnl !== null ? Number(d.pnl) : undefined,
              r: d.r !== undefined && d.r !== null ? Number(d.r) : undefined,
              message: String(d.message || ''),
              createdAt: d.createdAt ? Number(d.createdAt) : undefined,
            });
          }
        });
        this.botLogCache = logs;
      }
    } catch {}
  }

  /**
   * Serve from in-memory cache (NEVER queries Firestore per request).
   */
  public async getCandles(tf: string, limit: number = 5000): Promise<RedSniperStoredCandle[]> {
    this.cacheHits += 1;
    this.logHourlyStatsIfDue();

    const list = this.memoryCache[tf] || [];
    const maxCap = tf === '1m' ? 400000 : 15000;
    const safeLimit = Math.max(1, Math.min(maxCap, Number(limit) || 5000));
    return list.slice(-safeLimit);
  }

  /**
   * Save candles: updates in-memory cache and writes chunked documents to Firestore.
   */
  public async saveCandles(candles: RedSniperStoredCandle[], tf: string): Promise<number> {
    if (this.firestoreAvailable === false || !this.firestore) {
      const saved = await this.fallbackStore.saveCandles(candles, tf);
      this.memoryCache[tf] = dedupeChunkCandles(this.memoryCache[tf] || [], candles);
      return saved;
    }

    const validCandles = candles.filter(
      (c) =>
        c &&
        typeof c.time === 'number' &&
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close)
    );

    if (validCandles.length === 0) return 0;

    // 1. Update in-memory cache immediately
    this.memoryCache[tf] = dedupeChunkCandles(this.memoryCache[tf] || [], validCandles);

    // 2. Group incoming candles by chunk key (one doc per UTC day, or per month for 4h/1d)
    const chunksMap = new Map<string, RedSniperStoredCandle[]>();
    for (const c of validCandles) {
      const k = getCandleChunkKey(c.time, tf);
      if (!chunksMap.has(k)) chunksMap.set(k, []);
      chunksMap.get(k)!.push(c);
    }

    try {
      const batch = this.firestore.batch();
      for (const [chunkKey] of chunksMap.entries()) {
        const chunkCandles = this.memoryCache[tf].filter((c) => getCandleChunkKey(c.time, tf) === chunkKey);
        const ref = this.firestore.collection('redsniper_candle_chunks').doc(chunkKey);
        batch.set(
          ref,
          {
            chunkKey,
            tf,
            period: tf === '4h' || tf === '1d' ? 'month' : 'day',
            date: chunkKey.slice(tf.length + 1),
            candles: chunkCandles,
            count: chunkCandles.length,
            firstTime: chunkCandles[0]?.time ?? 0,
            lastTime: chunkCandles[chunkCandles.length - 1]?.time ?? 0,
            updatedAt: Date.now(),
          },
          { merge: true }
        );
      }

      await batch.commit();
      this.writesToday += chunksMap.size;
      this.totalWrites += chunksMap.size;
      this.lastWriteTimeMs = Date.now();
      this.firestoreAvailable = true;
      return validCandles.length;
    } catch (err: any) {
      this.firestoreAvailable = false;
      const codeStr = err?.code ? String(err.code) : '';
      const msg = err?.message || 'Save error';
      const reason = (codeStr && !msg.startsWith(codeStr) ? `${codeStr} ${msg}` : msg).trim();
      this.firestoreError = reason;
      console.error(`Firestore unavailable: ${reason} - falling back to SQLite, persistent=false`);
      return await this.fallbackStore.saveCandles(candles, tf);
    }
  }

  public async loadLogs(): Promise<ServerBotLogEntry[]> {
    if (this.firestoreAvailable === false || !this.firestore) {
      return await this.fallbackStore.loadLogs();
    }
    return this.botLogCache;
  }

  public async appendLogs(incoming: ServerBotLogEntry[]): Promise<ServerBotLogEntry[]> {
    if (this.firestoreAvailable === false || !this.firestore) {
      return await this.fallbackStore.appendLogs(incoming);
    }

    if (!incoming || incoming.length === 0) {
      return this.loadLogs();
    }

    // Update in-memory log cache
    const merged = [...incoming, ...this.botLogCache];
    const map = new Map<string, ServerBotLogEntry>();
    for (const log of merged) {
      if (log && log.id && !map.has(log.id)) {
        map.set(log.id, log);
      }
    }
    this.botLogCache = Array.from(map.values()).sort((a, b) => b.time - a.time).slice(0, 200);

    try {
      const batch: WriteBatch = this.firestore.batch();
      for (const item of incoming.slice(0, 200)) {
        if (item && item.id) {
          const docRef = this.firestore.collection('redsniper_botlog').doc(item.id);
          batch.set(
            docRef,
            {
              id: item.id,
              time: Number(item.time || Date.now()),
              isoTime: item.isoTime || new Date(item.time || Date.now()).toISOString(),
              type: item.type || 'ZONE_DETECTED',
              tf: item.tf || '1m',
              side: item.side || 'BUY',
              zoneId: item.zoneId || null,
              tradeId: item.tradeId || null,
              price: item.price !== undefined ? Number(item.price) : null,
              oldSl: item.oldSl !== undefined ? Number(item.oldSl) : null,
              newSl: item.newSl !== undefined ? Number(item.newSl) : null,
              exitReason: item.exitReason || null,
              pnl: item.pnl !== undefined ? Number(item.pnl) : null,
              r: item.r !== undefined ? Number(item.r) : null,
              message: String(item.message || ''),
              createdAt: item.createdAt || Date.now(),
            },
            { merge: true }
          );
        }
      }
      await batch.commit();
      this.writesToday += incoming.length;
      this.totalWrites += incoming.length;
      this.lastWriteTimeMs = Date.now();
      return this.botLogCache;
    } catch (err: any) {
      this.firestoreAvailable = false;
      return await this.fallbackStore.appendLogs(incoming);
    }
  }

  public async clearLogs(): Promise<ServerBotLogEntry[]> {
    this.botLogCache = [];
    if (this.firestoreAvailable === false || !this.firestore) {
      return await this.fallbackStore.clearLogs();
    }
    try {
      const snapshot = await this.firestore.collection('redsniper_botlog').get();
      if (!snapshot.empty) {
        const batch = this.firestore.batch();
        snapshot.forEach((doc: any) => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        this.writesToday += snapshot.size;
        this.totalWrites += snapshot.size;
        this.lastWriteTimeMs = Date.now();
      }
      return [];
    } catch (err: any) {
      this.firestoreAvailable = false;
      return await this.fallbackStore.clearLogs();
    }
  }

  public async getHealth(): Promise<Omit<RedSniperHealthReport, 'instanceUptimeSeconds' | 'gaps'>> {
    this.checkDailyReset();
    this.logHourlyStatsIfDue();

    const maxReads = this.getMaxReadsPerDay();
    const readLimitExceeded = this.readsToday >= maxReads;

    const firestoreOps: FirestoreOpsReport = {
      readsToday: this.readsToday,
      writesToday: this.writesToday,
      totalReads: this.totalReads,
      totalWrites: this.totalWrites,
      maxReadsPerDay: maxReads,
      readLimitExceeded,
      cacheHits: this.cacheHits,
      lastHourlyLogIso: new Date(this.lastHourlyLogTimeMs).toISOString(),
    };

    if (this.firestoreAvailable === false || !this.firestore) {
      const fallbackHealth = await this.fallbackStore.getHealth();
      return {
        ...fallbackHealth,
        backend: 'firestore',
        persistent: this.fallbackStore.isPersistent(),
        isKService: Boolean(process.env.K_SERVICE),
        dbSource: this.getDbSource(),
        firestoreOps,
        readLimitExceeded,
      };
    }

    const allTfs = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];
    const storedRowsPerTf: Record<string, number> = {};
    for (const tf of allTfs) {
      storedRowsPerTf[tf] = (this.memoryCache[tf] || []).length;
    }

    let totalRows = 0;
    let oldestCandleTime: number | null = null;
    let newestCandleTime: number | null = null;

    for (const tf of allTfs) {
      const list = this.memoryCache[tf] || [];
      totalRows += list.length;
      if (list.length > 0) {
        const oldT = list[0].time;
        const newT = list[list.length - 1].time;
        if (oldestCandleTime === null || oldT < oldestCandleTime) oldestCandleTime = oldT;
        if (newestCandleTime === null || newT > newestCandleTime) newestCandleTime = newT;
      }
    }

    return {
      ok: Boolean(this.firestore && this.isInitialized && this.firestoreAvailable),
      backend: 'firestore',
      persistent: true,
      isKService: Boolean(process.env.K_SERVICE),
      storedRowsPerTf,
      totalRows,
      oldestCandleTime,
      oldestCandleIso: oldestCandleTime ? new Date(oldestCandleTime * 1000).toISOString() : null,
      newestCandleTime,
      newestCandleIso: newestCandleTime ? new Date(newestCandleTime * 1000).toISOString() : null,
      lastWriteTime: this.lastWriteTimeMs,
      lastWriteIso: this.lastWriteTimeMs ? new Date(this.lastWriteTimeMs).toISOString() : null,
      dbSource: this.getDbSource(),
      botLogCount: this.botLogCache.length,
      firestoreOps,
      readLimitExceeded,
    };
  }
}

// -------------------------------------------------------------
// STORE FACTORY & SINGLETON MANAGEMENT
// -------------------------------------------------------------
export function resolveStoreBackend(): 'firestore' | 'sqlite' {
  const envVal = process.env.REDSNIPER_STORE?.trim().toLowerCase();
  if (envVal === 'firestore' || envVal === 'sqlite') {
    return envVal;
  }
  // Default: firestore when K_SERVICE is set (Cloud Run), else sqlite
  return process.env.K_SERVICE ? 'firestore' : 'sqlite';
}

let activeStore: RedSniperCombinedStore | null = null;

export function getRedSniperStore(): RedSniperCombinedStore {
  if (activeStore) return activeStore;

  const backend = resolveStoreBackend();
  if (backend === 'firestore') {
    activeStore = new FirestoreStore();
  } else {
    activeStore = new SqliteStore();
  }
  return activeStore;
}

export function setRedSniperStore(store: RedSniperCombinedStore | null): void {
  activeStore = store;
}

export async function initActiveStore(): Promise<RedSniperCombinedStore> {
  const store = getRedSniperStore();
  await store.init();
  return store;
}
