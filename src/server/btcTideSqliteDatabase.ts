import fs from 'fs';
import path from 'path';
import initSqlJs, { Database } from 'sql.js';
import { DATA_DIR } from './deploymentSafety.ts';
import {
  BtcTideTradeRecord,
  BtcTideStats,
  computeWorstLosingComponent,
  resolveClosedTradePnlUsdPerBtc,
} from './btcTideSignalDatabase.ts';

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

import {
  BTC_TIDE_ENGINE_VERSION,
  TRADE_EXPIRY_MS,
  MAX_TRADE_LIFETIME_MS,
  ADAPTIVE_MIN_CONFIDENCE_FLOOR,
  ADAPTIVE_MIN_LEAD_FLOOR,
  FunnelGateId,
} from '../btcTide/signalEngine.ts';

const REPO_SQLITE_DB_PATH = path.resolve(process.cwd(), 'data', 'btc_tide.db');

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
      created_at INTEGER NOT NULL,
      engine_version TEXT DEFAULT 'v6.5',
      component_scores_json TEXT,
      trend_state TEXT,
      flow_buy_pct REAL,
      atr_short REAL,
      atr_1h REAL,
      atr_5m REAL,
      atr_15m REAL,
      sl_dist REAL,
      sl_pct REAL,
      tp_base REAL,
      tp_mode TEXT,
      tp1_r REAL,
      tp2_r REAL,
      tp3_r REAL,
      pnl_usd_per_btc REAL,
      grade TEXT,
      is_counter_trend INTEGER,
      adaptive_mode INTEGER
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

    CREATE TABLE IF NOT EXISTS btc_tide_funnel_buckets (
      bucket_ts INTEGER NOT NULL,
      gate TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (bucket_ts, gate)
    );

    CREATE TABLE IF NOT EXISTS btc_tide_score_peaks (
      bucket_ts INTEGER PRIMARY KEY,
      confidence REAL NOT NULL,
      lead REAL NOT NULL,
      side TEXT NOT NULL,
      price REAL,
      wait_reason TEXT,
      recorded_at INTEGER NOT NULL
    );
  `);

  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN engine_version TEXT DEFAULT 'v6.0';"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN component_scores_json TEXT;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN trend_state TEXT;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN flow_buy_pct REAL;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN atr_short REAL;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN atr_1h REAL;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN atr_5m REAL;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN atr_15m REAL;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN sl_dist REAL;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN sl_pct REAL;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN tp_base REAL;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN tp_mode TEXT;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN tp1_r REAL;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN tp2_r REAL;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN tp3_r REAL;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN pnl_usd_per_btc REAL;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN grade TEXT;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN is_counter_trend INTEGER;"); } catch {}
  try { db.run("ALTER TABLE btc_tide_signals ADD COLUMN adaptive_mode INTEGER;"); } catch {}

  dbInstance = db;
  isDbInitialized = true;

  // Enforce production DB hygiene & void any invalid/legacy active trades on startup
  if (targetPath === SQLITE_DB_PATH) {
    enforceSqliteTodayHygiene();
    voidInvalidActiveTradesInSqlite(Date.now());
    await voidLegacyRepoSqliteActiveTrades(SQL);
  }

  persistSqliteToDisk();
  return db;
}

export function validateActiveTradeAgainstCurrentRules(
  trade: BtcTideTradeRecord,
  nowMs: number = Date.now()
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (trade.engine_version !== BTC_TIDE_ENGINE_VERSION) {
    reasons.push(
      `old engine_version (${trade.engine_version || 'v6.0'} !== ${BTC_TIDE_ENGINE_VERSION})`
    );
  }
  if (!Number.isFinite(trade.entryTime) || trade.entryTime > nowMs + 60_000) {
    reasons.push(`entryTime in the future (${trade.entryTime} > ${nowMs})`);
  }
  if (!Number.isFinite(trade.confidence) || trade.confidence < ADAPTIVE_MIN_CONFIDENCE_FLOOR) {
    reasons.push(`confidence ${trade.confidence} < ${ADAPTIVE_MIN_CONFIDENCE_FLOOR} threshold`);
  }
  if (!Number.isFinite(trade.lead) || trade.lead < ADAPTIVE_MIN_LEAD_FLOOR) {
    reasons.push(`lead ${trade.lead} < ${ADAPTIVE_MIN_LEAD_FLOOR} threshold`);
  }
  const expirySpanMs = trade.expiryTime - trade.entryTime;
  if (
    !Number.isFinite(expirySpanMs) ||
    expirySpanMs <= 0 ||
    expirySpanMs > TRADE_EXPIRY_MS + 60_000
  ) {
    reasons.push(
      `expiry span ${Math.round(expirySpanMs / 60000)}m violates 260m pre-TP1 rule`
    );
  }
  if (nowMs - trade.entryTime > MAX_TRADE_LIFETIME_MS) {
    reasons.push(`age exceeds 260m max trade lifetime`);
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

const SELECT_TRADE_COLUMNS = `
  id, side, entry_time, entry_price, initial_sl_price, sl_price,
  tp1_price, tp2_price, tp3_price, one_r, current_r, pnl_percent,
  tp1_hit, tp2_hit, tp3_hit, be_moved, status, outcome, realized_r,
  closed_at, close_price, expiry_time, confidence, lead, trigger_reason,
  engine_version, component_scores_json, trend_state, flow_buy_pct, atr_short, atr_1h,
  atr_5m, atr_15m, sl_dist, sl_pct, grade, is_counter_trend, adaptive_mode,
  tp_base, tp_mode, tp1_r, tp2_r, tp3_r, pnl_usd_per_btc
`;

export function voidInvalidActiveTradesInSqlite(nowMs: number = Date.now()): number {
  if (!dbInstance) return 0;
  let voidedCount = 0;
  let updatedExpiryCount = 0;
  try {
    const res = dbInstance.exec(`
      SELECT ${SELECT_TRADE_COLUMNS}
      FROM btc_tide_signals
      WHERE status != 'CLOSED';
    `);

    if (res.length > 0 && res[0].values.length > 0) {
      for (const row of res[0].values) {
        const trade = rowToTradeRecord(row);
        const check = validateActiveTradeAgainstCurrentRules(trade, nowMs);
        if (!check.valid) {
          console.warn(
            `[BTC TIDE RULE AUDIT] Closing invalid active trade ${trade.id} (${trade.side} @ $${trade.entryPrice}) as VOID on startup: ${check.reasons.join('; ')}`
          );
          dbInstance.run(
            `UPDATE btc_tide_signals
             SET status = 'CLOSED',
                 outcome = 'VOID',
                 realized_r = 0,
                 closed_at = ?,
                 close_price = entry_price
             WHERE id = ?;`,
            [nowMs, trade.id]
          );
          voidedCount++;
        } else if (trade.expiryTime - trade.entryTime < TRADE_EXPIRY_MS) {
          const newExpiryTime = trade.entryTime + TRADE_EXPIRY_MS;
          dbInstance.run(
            `UPDATE btc_tide_signals
             SET expiry_time = ?
             WHERE id = ?;`,
            [newExpiryTime, trade.id]
          );
          updatedExpiryCount++;
        }
      }
    }
    if (voidedCount > 0 || updatedExpiryCount > 0) {
      persistSqliteToDisk();
    }
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] Error auditing active trades:', err.message);
  }
  return voidedCount;
}

async function voidLegacyRepoSqliteActiveTrades(SQL: any): Promise<void> {
  if (REPO_SQLITE_DB_PATH === currentSqliteDbPath || !fs.existsSync(REPO_SQLITE_DB_PATH)) {
    return;
  }
  try {
    const buf = fs.readFileSync(REPO_SQLITE_DB_PATH);
    const repoDb = new SQL.Database(buf);
    repoDb.run(
      `UPDATE btc_tide_signals
       SET status = 'CLOSED',
           outcome = 'VOID',
           realized_r = 0,
           closed_at = ?,
           close_price = entry_price
       WHERE status != 'CLOSED';`,
      [Date.now()]
    );
    repoDb.run(
      `DELETE FROM btc_tide_meta WHERE key IN ('btc_tide_paused', 'btc_tide_pause_reason', 'btc_tide_auto_pause_utc_day');`
    );
    const outBuf = Buffer.from(repoDb.export());
    fs.writeFileSync(REPO_SQLITE_DB_PATH, outBuf);
    repoDb.close();
  } catch {}
}

export function enforceSqliteTodayHygiene(): void {
  if (!dbInstance) return;
  try {
    // ONLY delete rows explicitly flagged test/mock, and remove deprecated pause metadata keys.
    dbInstance.run(
      `DELETE FROM btc_tide_signals
       WHERE id LIKE 'mock_%'
          OR id LIKE 'test_%'
          OR trigger_reason LIKE '%Mock%';`
    );
    dbInstance.run(
      `DELETE FROM btc_tide_meta
       WHERE key IN ('btc_tide_paused', 'btc_tide_pause_reason', 'btc_tide_auto_pause_utc_day');`
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
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, targetPath);
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] Failed to persist SQLite db to disk:', err.message);
  }
}

export function rowToTradeRecord(row: any[]): BtcTideTradeRecord {
  let parsedScores: Record<string, number> | null = null;
  if (row[26] && typeof row[26] === 'string') {
    try {
      const obj = JSON.parse(row[26]);
      if (obj && typeof obj === 'object') parsedScores = obj;
    } catch {}
  }

  const entryPrice = Number(row[3]);
  const oneR = Number(row[9]);
  const rawSlDist = row[33] !== null && row[33] !== undefined ? Number(row[33]) : oneR;
  const rawSlPct =
    row[34] !== null && row[34] !== undefined
      ? Number(row[34])
      : entryPrice > 0 && rawSlDist > 0
      ? Number(((rawSlDist / entryPrice) * 100).toFixed(2))
      : null;

  const tp1Price = Number(row[6]);
  const tp2Price = Number(row[7]);
  const tp3Price = Number(row[8]);
  const slDistNum = Number.isFinite(rawSlDist) && rawSlDist > 0 ? rawSlDist : oneR;
  const fallbackTp1R =
    slDistNum > 0 ? Number((Math.abs(tp1Price - entryPrice) / slDistNum).toFixed(2)) : 1.0;
  const fallbackTp2R =
    slDistNum > 0 ? Number((Math.abs(tp2Price - entryPrice) / slDistNum).toFixed(2)) : 2.0;
  const fallbackTp3R =
    slDistNum > 0 ? Number((Math.abs(tp3Price - entryPrice) / slDistNum).toFixed(2)) : 3.0;
  const realizedRVal = row[18] !== null && row[18] !== undefined ? Number(row[18]) : null;
  const pnlUsdVal =
    row[43] !== null && row[43] !== undefined
      ? Number(row[43])
      : realizedRVal !== null && slDistNum > 0
      ? Number((realizedRVal * slDistNum).toFixed(2))
      : null;

  return {
    id: String(row[0]),
    side: row[1] as 'LONG' | 'SHORT',
    entryTime: Number(row[2]),
    entryPrice,
    initialSlPrice: Number(row[4]),
    slPrice: Number(row[5]),
    tp1Price,
    tp2Price,
    tp3Price,
    oneR,
    currentR: Number(row[10]),
    pnlPercent: Number(row[11]),
    tp1Hit: Boolean(row[12]),
    tp2Hit: Boolean(row[13]),
    tp3Hit: Boolean(row[14]),
    beMoved: Boolean(row[15]),
    status: row[16] as any,
    outcome: row[17] ? (row[17] as any) : null,
    realizedR: realizedRVal,
    pnlUsdPerBtc: pnlUsdVal,
    closedAt: row[19] ? Number(row[19]) : null,
    closePrice: row[20] !== null && row[20] !== undefined ? Number(row[20]) : null,
    expiryTime: Number(row[21]),
    confidence: Number(row[22]),
    lead: Number(row[23]),
    triggerReason: String(row[24] || ''),
    engine_version: row[25] ? String(row[25]) : 'v6.0',
    componentScores: parsedScores,
    trendState: row[27] ? String(row[27]) : null,
    flowBuyPct: row[28] !== null && row[28] !== undefined ? Number(row[28]) : null,
    atrShort: row[29] !== null && row[29] !== undefined ? Number(row[29]) : null,
    atr1h: row[30] !== null && row[30] !== undefined ? Number(row[30]) : null,
    atr5m: row[31] !== null && row[31] !== undefined ? Number(row[31]) : null,
    atr15m: row[32] !== null && row[32] !== undefined ? Number(row[32]) : null,
    slDist: Number.isFinite(rawSlDist) ? rawSlDist : null,
    slPct: rawSlPct,
    grade: row[35] ? (String(row[35]) as 'A+' | 'A' | 'B') : null,
    isCounterTrend:
      row[36] !== null && row[36] !== undefined ? Boolean(Number(row[36])) : null,
    adaptiveMode:
      row[37] !== null && row[37] !== undefined ? Boolean(Number(row[37])) : null,
    tpBase:
      row[38] !== null && row[38] !== undefined
        ? Number(row[38])
        : Number(Math.abs(tp1Price - entryPrice).toFixed(2)),
    tpMode: row[39] ? (String(row[39]) as 'FIXED_BASE' | 'R_MULTIPLE') : 'FIXED_BASE',
    tp1R: row[40] !== null && row[40] !== undefined ? Number(row[40]) : fallbackTp1R,
    tp2R: row[41] !== null && row[41] !== undefined ? Number(row[41]) : fallbackTp2R,
    tp3R: row[42] !== null && row[42] !== undefined ? Number(row[42]) : fallbackTp3R,
  };
}

export function getActiveTradeFromSqlite(): BtcTideTradeRecord | null {
  if (!dbInstance) return null;
  try {
    const res = dbInstance.exec(`
      SELECT ${SELECT_TRADE_COLUMNS}
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
      SELECT ${SELECT_TRADE_COLUMNS}
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
  const emptyStats: BtcTideStats = {
    totalClosed: 0,
    winsCount: 0,
    lossesCount: 0,
    winRate: null,
    avgR: null,
    expectancy: null,
    expectancyUsdPerBtc: null,
    avgPnlUsdPerBtc: null,
    tp1HitRate: null,
    slRate: null,
    avgSlPct: null,
    expiredRate: null,
    worstLosingComponent: null,
    tp1BeCount: 0,
    tp2Count: 0,
    tp3Count: 0,
    slCount: 0,
    expiredCount: 0,
  };

  if (!dbInstance) {
    return emptyStats;
  }

  try {
    const closedRows = getClosedTradesFromSqlite(500).filter(
      (t) => t.outcome !== 'VOID' && (!t.engine_version || t.engine_version >= 'v6.0')
    );

    const totalClosed = closedRows.length;
    if (totalClosed === 0) {
      return emptyStats;
    }

    let winsCount = 0;
    let lossesCount = 0;
    let sumR = 0;
    let sumWinR = 0;
    let sumLossAbsR = 0;
    let sumPnlUsd = 0;
    let sumWinUsd = 0;
    let sumLossAbsUsd = 0;
    let sumSlPct = 0;
    let slPctCount = 0;
    let tp1ReachedCount = 0;
    let tp1BeCount = 0;
    let tp2Count = 0;
    let tp3Count = 0;
    let slCount = 0;
    let expiredCount = 0;

    for (const t of closedRows) {
      const r = typeof t.realizedR === 'number' ? t.realizedR : 0;
      const pnlUsd = resolveClosedTradePnlUsdPerBtc(t);
      sumR += r;
      sumPnlUsd += pnlUsd;

      const pct =
        typeof t.slPct === 'number' && Number.isFinite(t.slPct) && t.slPct > 0
          ? t.slPct
          : t.entryPrice > 0 && t.oneR > 0
          ? (t.oneR / t.entryPrice) * 100
          : null;
      if (pct !== null && Number.isFinite(pct) && pct > 0) {
        sumSlPct += pct;
        slPctCount++;
      }

      const reachedTp1 =
        Boolean(t.tp1Hit) ||
        t.outcome === 'TP1+BE' ||
        t.outcome === 'TP2' ||
        t.outcome === 'TP3' ||
        t.outcome === 'EXPIRED_AFTER_TP1';
      if (reachedTp1) {
        tp1ReachedCount++;
      }

      if (
        t.outcome === 'TP1+BE' ||
        t.outcome === 'TP2' ||
        t.outcome === 'TP3' ||
        (t.outcome === 'EXPIRED_AFTER_TP1' && r > 0)
      ) {
        winsCount++;
        sumWinR += Math.max(0, r);
        sumWinUsd += Math.max(0, pnlUsd);
      } else if (t.outcome === 'SL') {
        lossesCount++;
        sumLossAbsR += Math.abs(r);
        sumLossAbsUsd += Math.abs(pnlUsd);
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

    const winRate = Number(((winsCount / totalClosed) * 100).toFixed(1));
    const avgR = Number((sumR / totalClosed).toFixed(2));
    const avgPnlUsdPerBtc = Number((sumPnlUsd / totalClosed).toFixed(2));
    const winProb = winsCount / totalClosed;
    const lossProb = lossesCount / totalClosed;
    const avgWinR = winsCount > 0 ? sumWinR / winsCount : 0;
    const avgLossAbsR = lossesCount > 0 ? sumLossAbsR / lossesCount : 0;
    const avgWinUsd = winsCount > 0 ? sumWinUsd / winsCount : 0;
    const avgLossAbsUsd = lossesCount > 0 ? sumLossAbsUsd / lossesCount : 0;

    const expectancy = Number((winProb * avgWinR - lossProb * avgLossAbsR).toFixed(2));
    const expectancyUsdPerBtc = Number(
      (winProb * avgWinUsd - lossProb * avgLossAbsUsd).toFixed(2)
    );
    const tp1HitRate = Number(((tp1ReachedCount / totalClosed) * 100).toFixed(1));
    const slRate = Number(((slCount / totalClosed) * 100).toFixed(1));
    const avgSlPct = slPctCount > 0 ? Number((sumSlPct / slPctCount).toFixed(2)) : null;
    const expiredRate = Number(((expiredCount / totalClosed) * 100).toFixed(1));
    const worstLosingComponent = computeWorstLosingComponent(closedRows);

    return {
      totalClosed,
      winsCount,
      lossesCount,
      winRate,
      avgR,
      expectancy,
      expectancyUsdPerBtc,
      avgPnlUsdPerBtc,
      tp1HitRate,
      slRate,
      avgSlPct,
      expiredRate,
      worstLosingComponent,
      tp1BeCount,
      tp2Count,
      tp3Count,
      slCount,
      expiredCount,
    };
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] Error computing stats:', err.message);
  }

  return emptyStats;
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

  // SAFETY CHECK: Reject creating a NEW ACTIVE signal whose entry price deviates > 2% from live price,
  // but NEVER block closing, voiding, or updating an existing trade.
  if (
    trade.status === 'ACTIVE' &&
    typeof livePrice === 'number' &&
    Number.isFinite(livePrice) &&
    livePrice > 0
  ) {
    const safety = validateSignalPriceSafety(trade.entryPrice, livePrice);
    if (!safety.valid) {
      console.warn(`[BTC TIDE SAFETY] REJECTED new signal ${trade.id}: ${safety.reason}`);
      return false;
    }
  }

  try {
    const stmt = `
      INSERT OR REPLACE INTO btc_tide_signals (
        id, side, entry_time, entry_price, initial_sl_price, sl_price,
        tp1_price, tp2_price, tp3_price, one_r, current_r, pnl_percent,
        tp1_hit, tp2_hit, tp3_hit, be_moved, status, outcome, realized_r,
        closed_at, close_price, expiry_time, confidence, lead, trigger_reason, created_at,
        engine_version, component_scores_json, trend_state, flow_buy_pct, atr_short, atr_1h,
        atr_5m, atr_15m, sl_dist, sl_pct, grade, is_counter_trend, adaptive_mode,
        tp_base, tp_mode, tp1_r, tp2_r, tp3_r, pnl_usd_per_btc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    const scoresJson =
      trade.componentScores && typeof trade.componentScores === 'object'
        ? JSON.stringify(trade.componentScores)
        : null;

    const slDistVal =
      typeof trade.slDist === 'number' && Number.isFinite(trade.slDist)
        ? trade.slDist
        : trade.oneR;
    const slPctVal =
      typeof trade.slPct === 'number' && Number.isFinite(trade.slPct)
        ? trade.slPct
        : trade.entryPrice > 0 && slDistVal > 0
        ? Number(((slDistVal / trade.entryPrice) * 100).toFixed(2))
        : null;
    const tpBaseVal =
      typeof trade.tpBase === 'number' && Number.isFinite(trade.tpBase)
        ? trade.tpBase
        : Number(Math.abs(trade.tp1Price - trade.entryPrice).toFixed(2));
    const tp1RVal =
      typeof trade.tp1R === 'number' && Number.isFinite(trade.tp1R)
        ? trade.tp1R
        : slDistVal > 0
        ? Number((Math.abs(trade.tp1Price - trade.entryPrice) / slDistVal).toFixed(2))
        : 1.0;
    const tp2RVal =
      typeof trade.tp2R === 'number' && Number.isFinite(trade.tp2R)
        ? trade.tp2R
        : slDistVal > 0
        ? Number((Math.abs(trade.tp2Price - trade.entryPrice) / slDistVal).toFixed(2))
        : 2.0;
    const tp3RVal =
      typeof trade.tp3R === 'number' && Number.isFinite(trade.tp3R)
        ? trade.tp3R
        : slDistVal > 0
        ? Number((Math.abs(trade.tp3Price - trade.entryPrice) / slDistVal).toFixed(2))
        : 3.0;
    const pnlUsdVal =
      typeof trade.pnlUsdPerBtc === 'number' && Number.isFinite(trade.pnlUsdPerBtc)
        ? trade.pnlUsdPerBtc
        : typeof trade.realizedR === 'number' && Number.isFinite(trade.realizedR) && slDistVal > 0
        ? Number((trade.realizedR * slDistVal).toFixed(2))
        : null;

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
      trade.engine_version || BTC_TIDE_ENGINE_VERSION,
      scoresJson,
      trade.trendState || null,
      typeof trade.flowBuyPct === 'number' ? trade.flowBuyPct : null,
      typeof trade.atrShort === 'number' ? trade.atrShort : null,
      typeof trade.atr1h === 'number' ? trade.atr1h : null,
      typeof trade.atr5m === 'number' ? trade.atr5m : null,
      typeof trade.atr15m === 'number' ? trade.atr15m : null,
      slDistVal,
      slPctVal,
      trade.grade || null,
      trade.isCounterTrend ? 1 : 0,
      trade.adaptiveMode ? 1 : 0,
      tpBaseVal,
      trade.tpMode || 'FIXED_BASE',
      tp1RVal,
      tp2RVal,
      tp3RVal,
      pnlUsdVal,
    ]);

    // Cooldown starts when a real trade fully closes (never on VOID cleanup)
    if (trade.status === 'CLOSED' && trade.outcome !== 'VOID') {
      const closeTs = trade.closedAt || Date.now();
      dbInstance.run(
        `INSERT OR REPLACE INTO btc_tide_meta (key, value) VALUES ('last_signal_time', ?);`,
        [String(closeTs)]
      );
    }

    persistSqliteToDisk();
    return true;
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] Error saving trade to SQLite:', err.message);
    return false;
  }
}

export function pruneSqliteDatabase(maxClosedRows = 1000): void {
  if (!dbInstance) return;
  try {
    dbInstance.run(
      `DELETE FROM btc_tide_signals
       WHERE status = 'CLOSED'
         AND id NOT IN (
           SELECT id FROM btc_tide_signals
           WHERE status = 'CLOSED'
           ORDER BY entry_time DESC
           LIMIT ?
         );`,
      [maxClosedRows]
    );
    const cutoff = Date.now() - 6 * 3600 * 1000;
    dbInstance.run(`DELETE FROM btc_tide_oi_history WHERE timestamp < ?;`, [cutoff]);
  } catch {}
}

export function setLastSignalTimeInSqlite(ts: number | null): void {
  if (!dbInstance) return;
  try {
    if (ts === null) {
      dbInstance.run(`DELETE FROM btc_tide_meta WHERE key = 'last_signal_time';`);
    } else {
      dbInstance.run(
        `INSERT OR REPLACE INTO btc_tide_meta (key, value) VALUES ('last_signal_time', ?);`,
        [String(ts)]
      );
    }
    persistSqliteToDisk();
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] Error setting last_signal_time:', err.message);
  }
}

export function getLastSignalTimeFromSqlite(): number | null {
  if (!dbInstance) return null;
  try {
    const res = dbInstance.exec(`SELECT value FROM btc_tide_meta WHERE key = 'last_signal_time';`);
    if (res.length > 0 && res[0].values.length > 0) {
      const val = Number(res[0].values[0][0]);
      return Number.isFinite(val) && val > 0 ? val : null;
    }
  } catch {}
  return null;
}

export function getUtcDayKey(nowMs: number = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function getDailyTradesCountFromSqlite(nowMs: number = Date.now()): number {
  if (!dbInstance) return 0;
  const todayUtc = getUtcDayKey(nowMs);
  try {
    const dateRes = dbInstance.exec(
      `SELECT value FROM btc_tide_meta WHERE key = 'daily_trades_utc_date';`
    );
    const countRes = dbInstance.exec(
      `SELECT value FROM btc_tide_meta WHERE key = 'daily_trades_count';`
    );

    const storedDate =
      dateRes.length > 0 && dateRes[0].values.length > 0
        ? String(dateRes[0].values[0][0])
        : null;
    const storedCount =
      countRes.length > 0 && countRes[0].values.length > 0
        ? Number(countRes[0].values[0][0])
        : 0;

    if (storedDate === todayUtc && Number.isFinite(storedCount) && storedCount >= 0) {
      return storedCount;
    }

    // Either 00:00 UTC crossed (storedDate !== todayUtc) or first initialization
    let initialTodayCount = 0;
    if (storedDate === null) {
      const startOfUtcDayMs = Date.parse(`${todayUtc}T00:00:00.000Z`);
      const sigRes = dbInstance.exec(
        `SELECT COUNT(*) FROM btc_tide_signals WHERE entry_time >= ?;`,
        [startOfUtcDayMs]
      );
      if (sigRes.length > 0 && sigRes[0].values.length > 0) {
        initialTodayCount = Number(sigRes[0].values[0][0] || 0);
      }
    }

    dbInstance.run(
      `INSERT OR REPLACE INTO btc_tide_meta (key, value) VALUES ('daily_trades_utc_date', ?);`,
      [todayUtc]
    );
    dbInstance.run(
      `INSERT OR REPLACE INTO btc_tide_meta (key, value) VALUES ('daily_trades_count', ?);`,
      [String(initialTodayCount)]
    );
    persistSqliteToDisk();
    return initialTodayCount;
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] Error getting daily trades count:', err.message);
    return 0;
  }
}

export function incrementDailyTradesCountInSqlite(nowMs: number = Date.now()): number {
  if (!dbInstance) return 0;
  const todayUtc = getUtcDayKey(nowMs);
  const current = getDailyTradesCountFromSqlite(nowMs);
  const nextCount = current + 1;
  try {
    dbInstance.run(
      `INSERT OR REPLACE INTO btc_tide_meta (key, value) VALUES ('daily_trades_utc_date', ?);`,
      [todayUtc]
    );
    dbInstance.run(
      `INSERT OR REPLACE INTO btc_tide_meta (key, value) VALUES ('daily_trades_count', ?);`,
      [String(nextCount)]
    );
    persistSqliteToDisk();
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] Error incrementing daily trades count:', err.message);
  }
  return nextCount;
}

export function getTotalSignalsCountFromSqlite(): number {
  if (!dbInstance) return 0;
  try {
    const res = dbInstance.exec(`SELECT COUNT(*) FROM btc_tide_signals;`);
    if (res.length > 0 && res[0].values.length > 0) {
      return Number(res[0].values[0][0] || 0);
    }
  } catch {}
  return 0;
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
    // Check if the most recent OI sample came from a different source (source switch detection)
    const latestRes = dbInstance.exec(
      `SELECT source FROM btc_tide_oi_history ORDER BY timestamp DESC LIMIT 1;`
    );
    const prevSource =
      latestRes.length > 0 && latestRes[0].values.length > 0 && latestRes[0].values[0][0] !== null
        ? String(latestRes[0].values[0][0])
        : null;

    if (prevSource !== null && prevSource !== source) {
      // Source switched: restart "building Xm/60m" for the new source by clearing prior streak samples
      console.log(
        `[BTC TIDE SQLITE] OI source switched (${prevSource} -> ${source}). Restarting 60m OI history window.`
      );
      dbInstance.run(`DELETE FROM btc_tide_oi_history;`);
    }

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

    // Check oldest timestamp strictly for this source
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

    // We have >= 60m of history from the SAME source: find the sample closest to (nowMs - 3600_000)
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

export function getBtcTideMetaValue(key: string): string | null {
  if (!dbInstance) return null;
  try {
    const res = dbInstance.exec(`SELECT value FROM btc_tide_meta WHERE key = ?;`, [key]);
    if (res.length > 0 && res[0].values.length > 0 && res[0].values[0][0] !== null) {
      return String(res[0].values[0][0]);
    }
  } catch (err: any) {
    console.error(`[BTC TIDE SQLITE] Error reading meta key ${key}:`, err.message);
  }
  return null;
}

export function setBtcTideMetaValue(key: string, value: string, persistNow = true): void {
  if (!dbInstance) return;
  try {
    dbInstance.run(
      `INSERT OR REPLACE INTO btc_tide_meta (key, value) VALUES (?, ?);`,
      [key, value]
    );
    if (persistNow) {
      persistSqliteToDisk();
    }
  } catch (err: any) {
    console.error(`[BTC TIDE SQLITE] Error setting meta key ${key}:`, err.message);
  }
}

export function isBtcTideSqliteWritable(): boolean {
  if (!dbInstance || !isDbInitialized) return false;
  try {
    dbInstance.run(
      `INSERT OR REPLACE INTO btc_tide_meta (key, value) VALUES ('last_self_check_ts', ?);`,
      [String(Date.now())]
    );
    const dir = path.dirname(currentSqliteDbPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const DISPATCHED_KEYS_META_KEY = 'dispatched_telegram_keys_json';

export function hasDispatchedEventKeyInSqlite(idempotencyKey: string): boolean {
  if (!idempotencyKey) return false;
  const raw = getBtcTideMetaValue(DISPATCHED_KEYS_META_KEY);
  if (!raw) return false;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.includes(idempotencyKey);
  } catch {
    return false;
  }
}

export function recordDispatchedEventKeyInSqlite(idempotencyKey: string): void {
  if (!idempotencyKey) return;
  let arr: string[] = [];
  const raw = getBtcTideMetaValue(DISPATCHED_KEYS_META_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {}
  }
  if (!arr.includes(idempotencyKey)) {
    arr.push(idempotencyKey);
    const trimmed = arr.slice(-500);
    setBtcTideMetaValue(DISPATCHED_KEYS_META_KEY, JSON.stringify(trimmed), true);
  }
}

export function getTodayClosedTradesChronological(nowMs: number = Date.now()): BtcTideTradeRecord[] {
  const todayUtc = new Date(nowMs).toISOString().slice(0, 10);
  const allClosed = getClosedTradesFromSqlite(300);
  return allClosed
    .filter((t) => {
      const ts = t.closedAt || t.entryTime;
      const dateStr = new Date(ts).toISOString().slice(0, 10);
      return dateStr === todayUtc;
    })
    .sort((a, b) => (a.closedAt || a.entryTime) - (b.closedAt || b.entryTime));
}

export function getLatestTradeEntryTimeFromSqlite(): number | null {
  if (!dbInstance) return null;
  try {
    const res = dbInstance.exec(
      `SELECT MAX(entry_time) FROM btc_tide_signals WHERE outcome IS NULL OR outcome != 'VOID';`
    );
    if (res.length > 0 && res[0].values.length > 0 && res[0].values[0][0] !== null) {
      const ts = Number(res[0].values[0][0]);
      return Number.isFinite(ts) && ts > 0 ? ts : null;
    }
  } catch {}
  return null;
}

export interface BtcTideFunnelGateStat {
  gate: FunnelGateId;
  label: string;
  count: number;
  pct: number;
  pctOfBlockedTicks: number;
}

export interface BtcTideBestScore6h {
  confidence: number;
  lead: number;
  side: 'LONG' | 'SHORT' | 'NEUTRAL';
  price: number | null;
  waitReason: string;
  recordedAt: number;
}

export interface BtcTideFunnelDiagnostics {
  windowHours: number;
  totalEvaluatedTicks24h: number;
  totalBlockedTicks24h: number;
  totalGateBlocks24h: number;
  rankedGates: BtcTideFunnelGateStat[];
  summaryLine: string;
  bestScore6h: BtcTideBestScore6h | null;
  updatedAt: number;
}

const FUNNEL_GATE_LABELS: Record<FunnelGateId, string> = {
  confidence: 'Confidence (< threshold)',
  lead: 'Directional Lead (< threshold)',
  absorb_drive: 'Absorb / Drive',
  volume_spike: 'Volume Spike',
  htf_trend: 'HTF Trend (1H & 4H against)',
  flow_conflict: 'Flow Conflict (>75% opposite)',
  key_level: 'Key Level Proximity',
  news: 'USD News Window (15m)',
  liquidity: 'Low Liquidity (1m Vol)',
  cooldown: '60m Post-Trade Cooldown',
  daily_limit: 'Daily Limit (5/5)',
  pending_cancelled: 'Pending Confirmation Cancelled',
  sl_too_wide: 'SL Cap Inside Nearest Swing (>0.2x ATR15m)',
};

const ALL_FUNNEL_GATES: FunnelGateId[] = [
  'confidence',
  'lead',
  'absorb_drive',
  'volume_spike',
  'htf_trend',
  'flow_conflict',
  'key_level',
  'news',
  'liquidity',
  'cooldown',
  'daily_limit',
  'pending_cancelled',
  'sl_too_wide',
];

let lastFunnelPersistTime = 0;

function incrementFunnelBucketCount(bucketTs: number, gateKey: string): void {
  if (!dbInstance) return;
  dbInstance.run(
    `INSERT INTO btc_tide_funnel_buckets (bucket_ts, gate, count)
     VALUES (?, ?, 1)
     ON CONFLICT(bucket_ts, gate) DO UPDATE SET count = count + 1;`,
    [bucketTs, gateKey]
  );
}

export function recordFunnelTickInSqlite(params: {
  nowMs?: number;
  isSilent: boolean;
  canFire: boolean;
  hasActiveTrade: boolean;
  blockingGates: FunnelGateId[];
  confidence: number;
  lead: number;
  favoredSide: 'LONG' | 'SHORT' | 'NEUTRAL';
  price: number | null;
  waitReason: string;
}): void {
  if (!dbInstance) return;
  const nowMs = params.nowMs ?? Date.now();
  const bucketTs = Math.floor(nowMs / 300_000) * 300_000; // 5-minute bucket

  try {
    if (!params.isSilent) {
      incrementFunnelBucketCount(bucketTs, '__evaluated_ticks__');

      if (!params.canFire && !params.hasActiveTrade && params.blockingGates.length > 0) {
        incrementFunnelBucketCount(bucketTs, '__blocked_ticks__');
        for (const gate of params.blockingGates) {
          incrementFunnelBucketCount(bucketTs, gate);
        }
      }

      // Update 6h best score peak in current 5-minute bucket
      if (params.confidence > 0) {
        const existingRes = dbInstance.exec(
          `SELECT confidence, lead FROM btc_tide_score_peaks WHERE bucket_ts = ?;`,
          [bucketTs]
        );
        const prevConf =
          existingRes.length > 0 && existingRes[0].values.length > 0
            ? Number(existingRes[0].values[0][0] || 0)
            : -1;
        const prevLead =
          existingRes.length > 0 && existingRes[0].values.length > 0
            ? Number(existingRes[0].values[0][1] || 0)
            : -1;

        if (
          params.confidence > prevConf ||
          (params.confidence === prevConf && params.lead > prevLead)
        ) {
          dbInstance.run(
            `INSERT OR REPLACE INTO btc_tide_score_peaks
             (bucket_ts, confidence, lead, side, price, wait_reason, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?);`,
            [
              bucketTs,
              params.confidence,
              params.lead,
              params.favoredSide,
              params.price,
              params.waitReason,
              nowMs,
            ]
          );
        }
      }
    }

    // Prune older than 24h and persist every 30s
    if (nowMs - lastFunnelPersistTime >= 30_000) {
      lastFunnelPersistTime = nowMs;
      const cutoff24h = nowMs - 24 * 3600 * 1000;
      const cutoff6h = nowMs - 6 * 3600 * 1000;
      dbInstance.run(`DELETE FROM btc_tide_funnel_buckets WHERE bucket_ts < ?;`, [cutoff24h]);
      dbInstance.run(`DELETE FROM btc_tide_score_peaks WHERE bucket_ts < ?;`, [cutoff6h]);
      persistSqliteToDisk();
    }
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] Funnel tick record error:', err.message);
  }
}

export function recordFunnelPendingCancelledInSqlite(nowMs: number = Date.now()): void {
  if (!dbInstance) return;
  try {
    const bucketTs = Math.floor(nowMs / 300_000) * 300_000;
    incrementFunnelBucketCount(bucketTs, 'pending_cancelled');
    persistSqliteToDisk();
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] Error recording pending_cancelled:', err.message);
  }
}

export function getFunnelDiagnosticsFromSqlite(
  nowMs: number = Date.now()
): BtcTideFunnelDiagnostics {
  const emptyResult: BtcTideFunnelDiagnostics = {
    windowHours: 24,
    totalEvaluatedTicks24h: 0,
    totalBlockedTicks24h: 0,
    totalGateBlocks24h: 0,
    rankedGates: ALL_FUNNEL_GATES.map((gate) => ({
      gate,
      label: FUNNEL_GATE_LABELS[gate],
      count: 0,
      pct: 0,
      pctOfBlockedTicks: 0,
    })),
    summaryLine: 'Collecting live engine ticks...',
    bestScore6h: null,
    updatedAt: nowMs,
  };

  if (!dbInstance) return emptyResult;

  try {
    const cutoff24h = nowMs - 24 * 3600 * 1000;
    const cutoff6h = nowMs - 6 * 3600 * 1000;

    const bucketRes = dbInstance.exec(
      `SELECT gate, SUM(count) as total_count
       FROM btc_tide_funnel_buckets
       WHERE bucket_ts >= ?
       GROUP BY gate;`,
      [cutoff24h]
    );

    const countsMap: Record<string, number> = {};
    if (bucketRes.length > 0 && bucketRes[0].values.length > 0) {
      for (const row of bucketRes[0].values) {
        countsMap[String(row[0])] = Number(row[1] || 0);
      }
    }

    const totalEvaluatedTicks24h = countsMap['__evaluated_ticks__'] || 0;
    const totalBlockedTicks24h = countsMap['__blocked_ticks__'] || 0;

    let totalGateBlocks24h = 0;
    for (const gate of ALL_FUNNEL_GATES) {
      totalGateBlocks24h += countsMap[gate] || 0;
    }

    const rankedGates: BtcTideFunnelGateStat[] = ALL_FUNNEL_GATES.map((gate) => {
      const count = countsMap[gate] || 0;
      const pct =
        totalGateBlocks24h > 0 ? Number(((count / totalGateBlocks24h) * 100).toFixed(1)) : 0;
      const pctOfBlockedTicks =
        totalBlockedTicks24h > 0
          ? Number(((count / totalBlockedTicks24h) * 100).toFixed(1))
          : 0;
      return {
        gate,
        label: FUNNEL_GATE_LABELS[gate],
        count,
        pct,
        pctOfBlockedTicks,
      };
    }).sort((a, b) => b.count - a.count);

    const nonZeroGates = rankedGates.filter((g) => g.count > 0);
    const summaryLine =
      nonZeroGates.length > 0
        ? `Blocked by ${nonZeroGates
            .slice(0, 4)
            .map((g) => `${g.label}: ${g.pct.toFixed(0)}%`)
            .join(', ')}`
        : 'No blocked ticks recorded yet in 24h window';

    const peakRes = dbInstance.exec(
      `SELECT confidence, lead, side, price, wait_reason, recorded_at
       FROM btc_tide_score_peaks
       WHERE bucket_ts >= ?
       ORDER BY confidence DESC, lead DESC, recorded_at DESC
       LIMIT 1;`,
      [cutoff6h]
    );

    let bestScore6h: BtcTideBestScore6h | null = null;
    if (peakRes.length > 0 && peakRes[0].values.length > 0) {
      const r = peakRes[0].values[0];
      bestScore6h = {
        confidence: Number(r[0] || 0),
        lead: Number(r[1] || 0),
        side: (String(r[2] || 'NEUTRAL') as 'LONG' | 'SHORT' | 'NEUTRAL'),
        price: r[3] !== null && r[3] !== undefined ? Number(r[3]) : null,
        waitReason: String(r[4] || ''),
        recordedAt: Number(r[5] || nowMs),
      };
    }

    return {
      windowHours: 24,
      totalEvaluatedTicks24h,
      totalBlockedTicks24h,
      totalGateBlocks24h,
      rankedGates,
      summaryLine,
      bestScore6h,
      updatedAt: nowMs,
    };
  } catch (err: any) {
    console.error('[BTC TIDE SQLITE] Funnel query error:', err.message);
    return emptyResult;
  }
}

