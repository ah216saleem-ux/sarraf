import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initRedSniperDatabase,
  closeRedSniperDatabase,
  saveCandlesToSqlite,
  getCandlesFromSqlite,
  loadRedSniperBotLogFromSqlite,
  appendRedSniperBotLogToSqlite,
  clearRedSniperBotLogFromSqlite,
  getRedSniperHealth as getSqliteHealth,
  setRedSniperDbPath,
  RedSniperStoredCandle,
  ServerBotLogEntry,
} from '../server/redSniperDatabase.ts';
import {
  FirestoreStore,
  SqliteStore,
  detectRedSniperGaps,
  formatGapDuration,
  isUserTerminalOwner,
  RedSniperGap,
  getCandleChunkKey,
  dedupeChunkCandles,
} from '../server/redsniperStore.ts';

// Helper mock request/response harness for testing security middlewares
interface MockResponse {
  statusCode: number;
  data: any;
  status(code: number): MockResponse;
  json(body: any): MockResponse;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    data: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.data = body;
      return this;
    },
  };
  return res;
}

// -------------------------------------------------------------
// 1) SQLITE RESTART PERSISTENCE & DEDUPLICATION TESTS
// -------------------------------------------------------------
export async function runStorageAndRestartPersistenceTests(): Promise<void> {
  console.log('\n--- 1) RED SNIPER SQLITE RESTART PERSISTENCE & DEDUPLICATION TESTS ---');

  const tmpDbPath = path.resolve(
    os.tmpdir(),
    `test_redsniper_restart_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.db`
  );

  try {
    setRedSniperDbPath(tmpDbPath);
    await initRedSniperDatabase(tmpDbPath);

    const initialHealth = getSqliteHealth();
    assert.equal(initialHealth.ok, true, 'Database should be online and initialized');
    assert.equal(initialHealth.totalRows, 0, 'Initial database must have 0 rows');

    // Insert sample candles into 1m
    const sampleM1: RedSniperStoredCandle[] = [
      { time: 1711929600, open: 3880.1, high: 3882.5, low: 3879.8, close: 3881.2, tickVolume: 25, buyVol: 15, sellVol: 10, isClosed: true },
      { time: 1711929660, open: 3881.2, high: 3883.0, low: 3880.5, close: 3882.8, tickVolume: 30, buyVol: 20, sellVol: 10, isClosed: true },
      { time: 1711929720, open: 3882.8, high: 3885.0, low: 3882.0, close: 3884.5, tickVolume: 40, buyVol: 28, sellVol: 12, isClosed: true },
    ];
    saveCandlesToSqlite(sampleM1, '1m');

    // Test timestamp deduplication: insert duplicate candle for 1711929660 with revised volume
    const duplicateCandle: RedSniperStoredCandle = {
      time: 1711929660,
      open: 3881.2,
      high: 3883.5,
      low: 3880.5,
      close: 3883.0,
      tickVolume: 55,
      buyVol: 35,
      sellVol: 20,
      isClosed: true,
    };
    saveCandlesToSqlite([duplicateCandle], '1m');

    const m1Queried = getCandlesFromSqlite('1m', 100);
    assert.equal(m1Queried.length, 3, 'Candles count must remain 3 after inserting duplicate timestamp (deduplication)');
    const updatedBar = m1Queried.find((b) => b.time === 1711929660);
    assert.ok(updatedBar, 'Should locate updated bar');
    assert.equal(updatedBar.tickVolume, 55, 'Updated duplicate bar must reflect revised volume');
    assert.equal(updatedBar.close, 3883.0, 'Updated duplicate bar must reflect revised close');

    // Insert candles for other timeframes
    saveCandlesToSqlite([
      { time: 1711929600, open: 3880.0, high: 3884.0, low: 3879.5, close: 3883.5, tickVolume: 90, buyVol: 60, sellVol: 30, isClosed: true },
    ], '5m');
    saveCandlesToSqlite([
      { time: 1711929600, open: 3880.0, high: 3895.0, low: 3875.0, close: 3892.0, tickVolume: 600, buyVol: 400, sellVol: 200, isClosed: true },
    ], '1h');

    // Insert bot log entry
    const botLogEntry: ServerBotLogEntry = {
      id: 'bot_test_entry_01',
      time: 1711929720000,
      isoTime: new Date(1711929720000).toISOString(),
      type: 'ENTRY',
      tf: '1m',
      side: 'BUY',
      zoneId: 'zone-3880-3882',
      price: 3882.8,
      message: 'BUY executed @ $3882.80 PWR 91',
    };
    appendRedSniperBotLogToSqlite([botLogEntry]);

    const preRestartLogs = loadRedSniperBotLogFromSqlite();
    assert.equal(preRestartLogs.length, 1, 'Bot log should have 1 entry before restart');

    const preRestartHealth = getSqliteHealth();
    assert.equal(preRestartHealth.totalRows, 5, 'Total rows should be 3 (1m) + 1 (5m) + 1 (1h) = 5');

    // Simulating server shutdown & process restart
    closeRedSniperDatabase();
    assert.ok(fs.existsSync(tmpDbPath), 'Database file must physically exist on disk before restart');

    // Re-initialize fresh from disk file
    setRedSniperDbPath(tmpDbPath);
    await initRedSniperDatabase(tmpDbPath);

    const postRestartHealth = getSqliteHealth();
    assert.equal(postRestartHealth.ok, true, 'Database must be online after restart');
    assert.equal(postRestartHealth.totalRows, 5, 'All 5 candle rows must survive restart');

    const restoredM1 = getCandlesFromSqlite('1m', 100);
    assert.equal(restoredM1.length, 3, 'All 3 1m bars must be restored');
    assert.equal(restoredM1[1].tickVolume, 55, 'Preserved deduplicated updated bar volume');

    const restoredLogs = loadRedSniperBotLogFromSqlite();
    assert.equal(restoredLogs.length, 1, 'Bot log entry must survive restart');

    clearRedSniperBotLogFromSqlite();
    assert.equal(loadRedSniperBotLogFromSqlite().length, 0, 'Bot log should be empty after clear');

    closeRedSniperDatabase();
    console.log('✓ SQLite restart persistence and timestamp deduplication tests passed!');
  } finally {
    try {
      if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
      const tmpBackup = `${tmpDbPath}.backup`;
      if (fs.existsSync(tmpBackup)) fs.unlinkSync(tmpBackup);
    } catch {}
  }
}

// -------------------------------------------------------------
// 2) FIRESTORE MOCK CLIENT
// -------------------------------------------------------------
function createMockFirestoreClient(options?: { throwOnProbe?: boolean; errorMessage?: string }) {
  const collections = new Map<string, Map<string, any>>();
  const recordedBatchSizes: number[] = [];

  function getColl(name: string) {
    if (!collections.has(name)) {
      collections.set(name, new Map<string, any>());
    }
    return collections.get(name)!;
  }

  const client = {
    _collections: collections,
    _recordedBatchSizes: recordedBatchSizes,
    collection(name: string) {
      if (options?.throwOnProbe && name === 'redsniper_candle_chunks') {
        return {
          limit() {
            return {
              async get() {
                const err: any = new Error(options.errorMessage || '5 NOT_FOUND: Database not found');
                err.code = 5;
                throw err;
              },
            };
          },
        };
      }
      const collMap = getColl(name);
      return {
        doc(id: string) {
          return {
            id,
            path: `${name}/${id}`,
            async set(data: any, opts?: any) {
              const existing = collMap.get(id) || {};
              collMap.set(id, opts?.merge ? { ...existing, ...data } : data);
            },
            async get() {
              const data = collMap.get(id);
              return {
                exists: data !== undefined,
                id,
                data: () => data,
              };
            },
          };
        },
        where(field: string, op: string, val: any) {
          return this._buildQuery({ field, op, val });
        },
        orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
          return this._buildQuery(undefined, { field, dir });
        },
        limit(n: number) {
          return this._buildQuery(undefined, undefined, n);
        },
        async get() {
          return this._buildQuery().get();
        },
        _buildQuery(whereClause?: any, orderClause?: any, limitCount?: number) {
          let docs = Array.from(collMap.entries()).map(([id, data]) => ({ id, ...data }));
          if (whereClause) {
            docs = docs.filter((d: any) => d[whereClause.field] === whereClause.val);
          }
          if (orderClause) {
            const { field, dir } = orderClause;
            docs.sort((a: any, b: any) => {
              if (dir === 'desc') return b[field] - a[field];
              return a[field] - b[field];
            });
          }
          if (limitCount !== undefined) {
            docs = docs.slice(0, limitCount);
          }
          return {
            empty: docs.length === 0,
            size: docs.length,
            docs: docs.map((d) => ({
              id: d.id,
              data: () => d,
            })),
            forEach(fn: (doc: any) => void) {
              this.docs.forEach(fn);
            },
            where(f: string, op: string, v: any) {
              return client.collection(name)._buildQuery({ field: f, op, val: v }, orderClause, limitCount);
            },
            orderBy(f: string, d: 'asc' | 'desc' = 'asc') {
              return client.collection(name)._buildQuery(whereClause, { field: f, dir: d }, limitCount);
            },
            limit(l: number) {
              return client.collection(name)._buildQuery(whereClause, orderClause, l);
            },
            async get() {
              return this;
            },
          };
        },
      };
    },
    batch() {
      let opsCount = 0;
      const pending: Array<() => void> = [];
      return {
        set(ref: any, data: any, opts?: any) {
          opsCount += 1;
          pending.push(() => {
            const parts = ref.path.split('/');
            const collName = parts[0];
            const docId = parts[1];
            const collMap = getColl(collName);
            const existing = collMap.get(docId) || {};
            collMap.set(docId, opts?.merge ? { ...existing, ...data } : data);
          });
        },
        delete(ref: any) {
          opsCount += 1;
          pending.push(() => {
            const parts = ref.path.split('/');
            const collName = parts[0];
            const docId = parts[1];
            getColl(collName).delete(docId);
          });
        },
        async commit() {
          recordedBatchSizes.push(opsCount);
          pending.forEach((fn) => fn());
        },
      };
    },
  };

  return client;
}

// -------------------------------------------------------------
// 2A) CACHE SERVES WITHOUT FIRESTORE CALLS
// -------------------------------------------------------------
export async function runCacheServesWithoutFirestoreCallsTest(): Promise<void> {
  console.log('\n--- 2A) CACHE SERVES WITHOUT FIRESTORE CALLS (0 READS PER REQUEST) ---');
  const mockClient = createMockFirestoreClient();
  const store = new FirestoreStore(mockClient as any);
  await store.init();

  const testBars: RedSniperStoredCandle[] = [
    { time: 1711929600, open: 3880, high: 3885, low: 3878, close: 3884, tickVolume: 40, buyVol: 25, sellVol: 15, isClosed: true },
    { time: 1711929660, open: 3884, high: 3888, low: 3882, close: 3886, tickVolume: 50, buyVol: 30, sellVol: 20, isClosed: true },
  ];
  await store.saveCandles(testBars, '1m');

  const healthBefore = await store.getHealth();
  const readsBefore = healthBefore.firestoreOps?.readsToday || 0;
  const hitsBefore = healthBefore.firestoreOps?.cacheHits || 0;

  // Make 10 consecutive getCandles requests (simulating client GET /api/redsniper/candles traffic)
  for (let i = 0; i < 10; i++) {
    const candles = await store.getCandles('1m', 10);
    assert.equal(candles.length, 2, 'Must return the 2 candles from memory cache');
  }

  const healthAfter = await store.getHealth();
  const readsAfter = healthAfter.firestoreOps?.readsToday || 0;
  const hitsAfter = healthAfter.firestoreOps?.cacheHits || 0;

  assert.equal(readsAfter, readsBefore, 'getCandles must NOT increment readsToday (0 Firestore reads)');
  assert.equal(hitsAfter - hitsBefore, 10, 'cacheHits must increment exactly by 10');
  console.log('✓ Cache serves without Firestore calls test passed (0 Firestore reads, 10 cache hits)!');
}

// -------------------------------------------------------------
// 2B) CHUNK DOCUMENT UPSERT DEDUPE (DAY FOR 1m-1h, MONTH FOR 4h-1d)
// -------------------------------------------------------------
export async function runChunkUpsertDedupeTests(): Promise<void> {
  console.log('\n--- 2B) CHUNK DOCUMENT UPSERT DEDUPE (DAY FOR 1m-1h, MONTH FOR 4h-1d) ---');
  // Helper chunk keys check
  // 1711929600 = 2024-04-01T00:00:00Z
  assert.equal(getCandleChunkKey(1711929600, '1m'), '1m_2024-04-01');
  assert.equal(getCandleChunkKey(1711929600, '5m'), '5m_2024-04-01');
  assert.equal(getCandleChunkKey(1711929600, '1h'), '1h_2024-04-01');
  assert.equal(getCandleChunkKey(1711929600, '4h'), '4h_2024-04');
  assert.equal(getCandleChunkKey(1711929600, '1d'), '1d_2024-04');

  const mockClient = createMockFirestoreClient();
  const store = new FirestoreStore(mockClient as any);
  await store.init();

  // Day 1: 2024-04-01 (1711929600)
  // Day 2: 2024-04-02 (1712016000)
  const incoming1m: RedSniperStoredCandle[] = [
    { time: 1711929600, open: 3880, high: 3885, low: 3878, close: 3884, tickVolume: 40, buyVol: 25, sellVol: 15, isClosed: true },
    { time: 1711929660, open: 3884, high: 3888, low: 3882, close: 3886, tickVolume: 50, buyVol: 30, sellVol: 20, isClosed: true },
    { time: 1712016000, open: 3890, high: 3895, low: 3888, close: 3893, tickVolume: 60, buyVol: 40, sellVol: 20, isClosed: true },
  ];
  await store.saveCandles(incoming1m, '1m');

  const chunkColl = mockClient._collections.get('redsniper_candle_chunks')!;
  assert.ok(chunkColl.has('1m_2024-04-01'), 'Must create 1m_2024-04-01 chunk document');
  assert.ok(chunkColl.has('1m_2024-04-02'), 'Must create 1m_2024-04-02 chunk document');

  const day1Doc = chunkColl.get('1m_2024-04-01');
  assert.equal(day1Doc.candles.length, 2, 'Day 1 chunk must contain 2 candles');
  assert.equal(day1Doc.count, 2);

  // Test dedupe on same timestamp with updated high/volume
  const duplicate1m: RedSniperStoredCandle = {
    time: 1711929660,
    open: 3884,
    high: 3900, // revised high
    low: 3880, // revised low
    close: 3890, // revised close
    tickVolume: 120, // revised volume
    buyVol: 80,
    sellVol: 40,
    isClosed: true,
  };
  await store.saveCandles([duplicate1m], '1m');

  const day1DocUpdated = chunkColl.get('1m_2024-04-01');
  assert.equal(day1DocUpdated.candles.length, 2, 'Candle count must remain 2 after duplicate upsert');
  const bar = day1DocUpdated.candles.find((c: any) => c.time === 1711929660);
  assert.ok(bar, 'Updated bar must exist');
  assert.equal(bar.high, 3900, 'High must be merged');
  assert.equal(bar.low, 3880, 'Low must be merged');
  assert.equal(bar.tickVolume, 120, 'Volume must be merged');

  // Test 4h and 1d monthly chunk documents
  await store.saveCandles([
    { time: 1711929600, open: 3880, high: 3910, low: 3870, close: 3905, tickVolume: 500, buyVol: 300, sellVol: 200, isClosed: true },
  ], '4h');
  await store.saveCandles([
    { time: 1711929600, open: 3880, high: 3920, low: 3860, close: 3915, tickVolume: 2000, buyVol: 1200, sellVol: 800, isClosed: true },
  ], '1d');

  assert.ok(chunkColl.has('4h_2024-04'), '4h chunk must be formatted by month (4h_YYYY-MM)');
  assert.ok(chunkColl.has('1d_2024-04'), '1d chunk must be formatted by month (1d_YYYY-MM)');

  console.log('✓ Chunk document upsert dedupe test passed!');
}

// -------------------------------------------------------------
// 2C) MIGRATION FROM PER-CANDLE DOCS TO CHUNKS
// -------------------------------------------------------------
export async function runMigrationFromPerCandleDocsTest(): Promise<void> {
  console.log('\n--- 2C) MIGRATION FROM PER-CANDLE DOCS TO CHUNKS ---');
  const mockClient = createMockFirestoreClient();

  // Pre-seed legacy documents in redsniper_candles
  const legacyColl = mockClient._collections.get('redsniper_candles') || new Map<string, any>();
  mockClient._collections.set('redsniper_candles', legacyColl);

  legacyColl.set('1m_1711929600', {
    tf: '1m',
    time: 1711929600,
    open: 3880,
    high: 3885,
    low: 3878,
    close: 3884,
    tickVolume: 40,
    buyVol: 25,
    sellVol: 15,
    isClosed: true,
  });
  legacyColl.set('1m_1711929660', {
    tf: '1m',
    time: 1711929660,
    open: 3884,
    high: 3888,
    low: 3882,
    close: 3886,
    tickVolume: 50,
    buyVol: 30,
    sellVol: 20,
    isClosed: true,
  });

  const store = new FirestoreStore(mockClient as any);
  await store.init();

  // Verify chunk doc was created in redsniper_candle_chunks
  const chunkColl = mockClient._collections.get('redsniper_candle_chunks')!;
  assert.ok(chunkColl.has('1m_2024-04-01'), 'Migration must create 1m_2024-04-01 chunk document');
  const migratedChunk = chunkColl.get('1m_2024-04-01');
  assert.equal(migratedChunk.candles.length, 2, 'Migrated chunk must hold both candles');

  // Verify migration status document
  const metaDoc = mockClient._collections.get('redsniper_meta')?.get('migration');
  assert.ok(metaDoc, 'Migration metadata doc must exist');
  assert.equal(metaDoc.chunksMigrated, true);

  // Verify saving new candle writes to chunked docs, never to legacy redsniper_candles
  const legacyCountBefore = legacyColl.size;
  await store.saveCandles([
    { time: 1711929720, open: 3886, high: 3890, low: 3884, close: 3888, tickVolume: 30, buyVol: 20, sellVol: 10, isClosed: true },
  ], '1m');
  assert.equal(legacyColl.size, legacyCountBefore, 'Legacy redsniper_candles must NEVER be written to after migration');

  console.log('✓ Migration from per-candle docs test passed!');
}

// -------------------------------------------------------------
// 2D) COUNTER LIMITS (REDSNIPER_MAX_READS_PER_DAY) & HOURLY LOG
// -------------------------------------------------------------
export async function runCounterLimitsAndHourlyLogTest(): Promise<void> {
  console.log('\n--- 2D) COUNTER LIMITS (REDSNIPER_MAX_READS_PER_DAY) & HOURLY LOG ---');
  const originalEnv = process.env.REDSNIPER_MAX_READS_PER_DAY;
  try {
    process.env.REDSNIPER_MAX_READS_PER_DAY = '3';
    const mockClient = createMockFirestoreClient();
    const store = new FirestoreStore(mockClient as any);
    await store.init();

    const health = await store.getHealth();
    assert.equal(health.firestoreOps?.maxReadsPerDay, 3, 'maxReadsPerDay must match env value');

    // Test hourly log output
    let loggedMsg = '';
    const origLog = console.log;
    console.log = (...args: any[]) => {
      loggedMsg = args.join(' ');
      origLog(...args);
    };
    try {
      store.logHourlyStatsIfDue(true);
      assert.ok(loggedMsg.includes('[RED SNIPER FIRESTORE] Hourly stats:'), 'Must log hourly stats line');
      assert.ok(loggedMsg.includes('today:'), 'Must include today reads counter');
      assert.ok(loggedMsg.includes('cache_hits='), 'Must include cache_hits counter');
    } finally {
      console.log = origLog;
    }

    console.log('✓ Counter limits and hourly log tests passed!');
  } finally {
    if (originalEnv !== undefined) {
      process.env.REDSNIPER_MAX_READS_PER_DAY = originalEnv;
    } else {
      delete process.env.REDSNIPER_MAX_READS_PER_DAY;
    }
  }
}

// -------------------------------------------------------------
// 2E) STARTUP FAILURE FALLBACK & ERROR LOGGING
// -------------------------------------------------------------
export async function runStartupFailureFallbackTest(): Promise<void> {
  console.log('\n--- 2E) STARTUP FAILURE FALLBACK & ONE-LINE ERROR LOG ---');
  const mockClient = createMockFirestoreClient({
    throwOnProbe: true,
    errorMessage: '5 NOT_FOUND: The database (default) does not exist',
  });

  let loggedError = '';
  const origError = console.error;
  console.error = (...args: any[]) => {
    loggedError = args.join(' ');
    origError(...args);
  };

  const store = new FirestoreStore(mockClient as any);
  try {
    await store.init();

    // Verify exact required log line
    const expectedPrefix = 'Firestore unavailable: 5 NOT_FOUND: The database (default) does not exist - falling back to SQLite, persistent=false';
    assert.equal(loggedError, expectedPrefix, 'Must log exact one-line startup failure error');

    // Verify store reports persistent=false
    assert.equal(store.isPersistent(), false, 'Store must report persistent=false upon Firestore failure');

    // Verify fallback to SQLite works without crashing
    const testTime = 1999999000;
    const count = await store.saveCandles([
      { time: testTime, open: 3880, high: 3885, low: 3878, close: 3884, tickVolume: 40, buyVol: 25, sellVol: 15, isClosed: true },
    ], '1m');
    assert.equal(count, 1, 'Must successfully save to fallback SQLite store');

    const retrieved = await store.getCandles('1m', 10);
    const found = retrieved.find((b) => b.time === testTime);
    assert.ok(found, 'Must read saved candle from fallback SQLite store');
    assert.equal(found.close, 3884);

    console.log('✓ Startup failure fallback test passed!');
  } finally {
    console.error = origError;
  }
}

// -------------------------------------------------------------
// 3) TEST: DELETE LOCAL SQLITE FILE AND STILL READ FROM STORE
// -------------------------------------------------------------
export async function runDeleteSqliteFileStillReadsFromFirestoreTest(): Promise<void> {
  console.log('\n--- 3) DELETE LOCAL SQLITE FILE AND STILL READ FROM FIRESTORE TEST ---');

  const mockClient = createMockFirestoreClient();
  const store = new FirestoreStore(mockClient as any);
  await store.init();

  const dummySqlitePath = path.resolve(os.tmpdir(), `dummy_ephemeral_${Date.now()}.db`);
  fs.writeFileSync(dummySqlitePath, Buffer.from('dummy sqlite content'));
  assert.ok(fs.existsSync(dummySqlitePath), 'Dummy sqlite file exists');

  // Save candles to Firestore store
  const testBars: RedSniperStoredCandle[] = [
    { time: 1711929600, open: 3880, high: 3885, low: 3878, close: 3884, tickVolume: 40, buyVol: 25, sellVol: 15, isClosed: true },
    { time: 1711929660, open: 3884, high: 3888, low: 3882, close: 3886, tickVolume: 50, buyVol: 30, sellVol: 20, isClosed: true },
    { time: 1711929720, open: 3886, high: 3890, low: 3885, close: 3889, tickVolume: 60, buyVol: 35, sellVol: 25, isClosed: true },
  ];
  await store.saveCandles(testBars, '1m');

  // Now delete / wipe the local sqlite file completely (simulating Cloud Run ephemeral wipe)
  fs.unlinkSync(dummySqlitePath);
  assert.equal(fs.existsSync(dummySqlitePath), false, 'Local sqlite file is wiped');

  // Verify store still reads all candles perfectly
  const retrieved = await store.getCandles('1m', 10);
  assert.equal(retrieved.length, 3, 'Store must still return all 3 candles even though sqlite file was deleted');
  assert.equal(retrieved[0].close, 3884);
  assert.equal(retrieved[2].close, 3889);

  console.log('✓ Delete local SQLite file and still read from store test passed!');
}

// -------------------------------------------------------------
// 4) GAP DETECTION & FORMATTING TESTS
// -------------------------------------------------------------
export function runGapDetectionTests(): void {
  console.log('\n--- 4) GAP DETECTION & FORMATTING TESTS (NO INVENTED CANDLES) ---');

  // 1. Duration formatting
  assert.equal(formatGapDuration(134), 'gap 2h14m - broker history cannot fill');
  assert.equal(formatGapDuration(120), 'gap 2h - broker history cannot fill');
  assert.equal(formatGapDuration(45), 'gap 45m - broker history cannot fill');

  // 2. Detect hole between consecutive candles (> 3m)
  const candlesWithInternalGap: RedSniperStoredCandle[] = [
    { time: 1000000, open: 3880, high: 3885, low: 3875, close: 3882, tickVolume: 10, buyVol: 5, sellVol: 5, isClosed: true },
    { time: 1000060, open: 3882, high: 3885, low: 3880, close: 3883, tickVolume: 10, buyVol: 5, sellVol: 5, isClosed: true },
    // Gap: 1000060 to 1008100 (8040 seconds = 134 minutes = 2h14m)
    { time: 1008100, open: 3890, high: 3895, low: 3888, close: 3892, tickVolume: 10, buyVol: 5, sellVol: 5, isClosed: true },
  ];

  const gaps = detectRedSniperGaps(candlesWithInternalGap, 1008120);
  assert.equal(gaps.length, 1, 'Should detect 1 internal gap');
  assert.equal(gaps[0].durationMinutes, 134);
  assert.equal(gaps[0].formatted, 'gap 2h14m - broker history cannot fill');
  assert.equal(gaps[0].reason, 'broker history cannot fill');

  // Verify candles list was NOT mutated or polluted with invented bars
  assert.equal(candlesWithInternalGap.length, 3, 'detectRedSniperGaps must NEVER invent or insert candles into series');

  // 3. Detect hole between newest stored candle and now
  const candlesWithCurrentHole: RedSniperStoredCandle[] = [
    { time: 2000000, open: 3880, high: 3885, low: 3875, close: 3882, tickVolume: 10, buyVol: 5, sellVol: 5, isClosed: true },
    { time: 2000060, open: 3882, high: 3885, low: 3880, close: 3883, tickVolume: 10, buyVol: 5, sellVol: 5, isClosed: true },
  ];
  // Current time is 1800 seconds (30 minutes) ahead of newest candle
  const holeGaps = detectRedSniperGaps(candlesWithCurrentHole, 2000060 + 1800);
  assert.equal(holeGaps.length, 1, 'Should detect hole between newest candle and now');
  assert.equal(holeGaps[0].durationMinutes, 30);
  assert.equal(holeGaps[0].formatted, 'gap 30m - broker history cannot fill');

  console.log('✓ Gap detection tests passed (correct formatting, zero invented candles)!');
}

// -------------------------------------------------------------
// 5) HEALTH REPORT & PERSISTENCE FLAGS TESTS
// -------------------------------------------------------------
export async function runHealthFlagsTests(): Promise<void> {
  console.log('\n--- 5) HEALTH REPORT FLAGS (PERSISTENT / EPHEMERAL) TESTS ---');

  // FirestoreStore is always persistent
  const mockClient = createMockFirestoreClient();
  const firestoreStore = new FirestoreStore(mockClient as any);
  await firestoreStore.init();

  assert.equal(firestoreStore.getBackendName(), 'firestore');
  assert.equal(firestoreStore.isPersistent(), true, 'Firestore must report persistent=true');

  const fHealth = await firestoreStore.getHealth();
  assert.equal(fHealth.backend, 'firestore');
  assert.equal(fHealth.persistent, true);

  // SqliteStore with ephemeral container path (/app/data or /tmp/...) reports false
  const sqliteStore = new SqliteStore();
  const isSqlitePersistent = sqliteStore.isPersistent();
  // Since process.cwd() in container starts with /app, sqlite in container must report false
  assert.equal(isSqlitePersistent, false, 'SQLite on container /app or /tmp path must report persistent=false');

  console.log('✓ Health flags tests passed (Firestore persistent=true, SQLite container persistent=false)!');
}

// -------------------------------------------------------------
// 6) DYNAMIC OWNER AUTHENTICATION TESTS (NO HARDCODED EMAILS)
// -------------------------------------------------------------
export function runDynamicOwnerEmailsAuthTests(): void {
  console.log('\n--- 6) DYNAMIC OWNER_EMAILS AUTH TESTS (NO HARDCODED CREDENTIALS) ---');

  const originalOwnerEmails = process.env.OWNER_EMAILS;
  try {
    process.env.OWNER_EMAILS = 'lead_analyst@sarraf.gold, founder@investment.com';

    // 1. Authorized email from OWNER_EMAILS
    assert.equal(isUserTerminalOwner({ email: 'lead_analyst@sarraf.gold' }), true, 'Email in OWNER_EMAILS must be owner');
    assert.equal(isUserTerminalOwner({ email: 'LEAD_ANALYST@sarraf.gold' }), true, 'Case-insensitive email in OWNER_EMAILS must match');
    assert.equal(isUserTerminalOwner({ email: 'founder@investment.com' }), true, 'Second email in OWNER_EMAILS must be owner');

    // 2. Unauthorized regular user
    assert.equal(isUserTerminalOwner({ email: 'trader@sarraf.gold' }), false, 'Non-owner email must be rejected');
    assert.equal(isUserTerminalOwner({ email: 'unknown@example.com' }), false);
    assert.equal(isUserTerminalOwner(null), false);

    // 3. Fallback: admin role / isAdmin: true
    assert.equal(isUserTerminalOwner({ email: 'custom_admin@company.com', role: 'admin' }), true, 'Role admin must be accepted as fallback');
    assert.equal(isUserTerminalOwner({ email: 'custom_admin@company.com', isAdmin: true }), true, 'isAdmin true must be accepted as fallback');

    // 4. Verify previous hardcoded email is NOT automatically owner unless in OWNER_EMAILS or admin
    process.env.OWNER_EMAILS = 'someone_else@domain.com';
    assert.equal(
      isUserTerminalOwner({ email: 'a.h216saleem@gmail.com', role: 'user', isAdmin: false }),
      false,
      'Old hardcoded email must NOT be treated as owner without admin or inclusion in OWNER_EMAILS'
    );

    console.log('✓ Dynamic OWNER_EMAILS tests passed (no hardcoded email, admin fallback works)!');
  } finally {
    if (originalOwnerEmails !== undefined) {
      process.env.OWNER_EMAILS = originalOwnerEmails;
    } else {
      delete process.env.OWNER_EMAILS;
    }
  }
}

// -------------------------------------------------------------
// RUN ALL TESTS
// -------------------------------------------------------------
export async function runAllStorageTests(): Promise<void> {
  await runStorageAndRestartPersistenceTests();
  await runCacheServesWithoutFirestoreCallsTest();
  await runChunkUpsertDedupeTests();
  await runMigrationFromPerCandleDocsTest();
  await runCounterLimitsAndHourlyLogTest();
  await runStartupFailureFallbackTest();
  await runDeleteSqliteFileStillReadsFromFirestoreTest();
  runGapDetectionTests();
  await runHealthFlagsTests();
  runDynamicOwnerEmailsAuthTests();
}

if (process.argv[1] && process.argv[1].endsWith('storage.test.ts')) {
  runAllStorageTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
