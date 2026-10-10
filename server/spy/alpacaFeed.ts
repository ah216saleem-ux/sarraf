/**
 * SPY Data Layer: Shared Alpaca WebSocket Feed (IEX only) + Twelve Data Fallback + SSE Fan-out
 * Single shared connection to respect Alpaca Free Tier concurrency limits.
 */

import { WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import type { Response } from 'express';
import {
  SpyCandle,
  SpyQuote,
  SpyTrade,
  SpyFeedState,
  SpyMarketHours,
} from './types.ts';
import { evaluateSpyMarketHours } from './marketHours.ts';
import {
  updateActiveSignalsOnPriceTick,
  loadSpySignalsFromDisk,
  saveSpySignalsToDisk,
} from './signalEngine.ts';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const CANDLES_FILE = path.resolve(DATA_DIR, 'spy_candles.json');

// Alpaca API configuration
const ALPACA_WS_URL = 'wss://stream.data.alpaca.markets/v2/iex';
const ALPACA_REST_BASE = 'https://data.alpaca.markets/v2';

function getAlpacaCredentials(): { apiKey: string; apiSecret: string } {
  const apiKey =
    process.env.ALPACA_KEY_ID ||
    process.env.ALPACA_API_KEY ||
    process.env.APCA_API_KEY_ID ||
    '';
  const apiSecret =
    process.env.ALPACA_SECRET ||
    process.env.ALPACA_SECRET_KEY ||
    process.env.APCA_API_SECRET_KEY ||
    '';
  return { apiKey, apiSecret };
}

// Twelve Data rate-limiting tracker (max 8 credits/min, 800/day)
let twelveDataMinuteCalls = 0;
let twelveDataDayCalls = 0;
let lastMinuteReset = Date.now();
let lastDayReset = Date.now();
let lastTwelveDataPoll = 0;

// Internal Candle Store
export interface SpyCandleStore {
  '1m': SpyCandle[];
  '5m': SpyCandle[];
  '15m': SpyCandle[];
  '1h': SpyCandle[];
  '4h': SpyCandle[];
  '1d': SpyCandle[];
  [key: string]: SpyCandle[];
}

let candleStore: SpyCandleStore = {
  '1m': [],
  '5m': [],
  '15m': [],
  '1h': [],
  '4h': [],
  '1d': [],
};

// Feed state
let feedState: SpyFeedState = {
  symbol: 'SPY',
  status: 'CONNECTING',
  currentPrice: null,
  changeDollar: null,
  changePercent: null,
  previousClose: null,
  dayHigh: null,
  dayLow: null,
  dayVolume: null,
  lastQuote: null,
  lastTrade: null,
  marketHours: evaluateSpyMarketHours(),
  dataFreshnessMs: 0,
  isFresh: false,
  source: 'NONE',
  lastUpdated: new Date().toISOString(),
};

let lastDataReceivedTimestamp = 0;
let wsInstance: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
let isShuttingDown = false;
let sseClients: Response[] = [];

// Helper: load stored candles from disk
export function loadStoredCandles(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(CANDLES_FILE)) {
      const raw = fs.readFileSync(CANDLES_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed['1m']) {
        candleStore = parsed;
        console.log(
          `[SPY Feed] Loaded cached candles: 1m=${candleStore['1m'].length}, 5m=${candleStore['5m'].length}, 15m=${candleStore['15m'].length}, 1h=${candleStore['1h'].length}`
        );

        // Seed current price from last closed candle if available
        const last1m = candleStore['1m'][candleStore['1m'].length - 1];
        if (last1m) {
          feedState.currentPrice = last1m.close;
          feedState.previousClose = last1m.open;
          feedState.source = 'STORED_CACHE';
        }
      }
    }
  } catch (err) {
    console.error('[SPY Feed] Error loading candle cache:', err);
  }
}

// Helper: save candles to disk atomically
export function saveCandlesToDisk(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tempFile = `${CANDLES_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(candleStore, null, 2), 'utf-8');
    fs.renameSync(tempFile, CANDLES_FILE);
  } catch (err) {
    console.error('[SPY Feed] Error saving candles to disk:', err);
  }
}

export function getSpyCandleStore(): SpyCandleStore {
  return candleStore;
}

export function getSpyFeedState(): SpyFeedState {
  const mh = evaluateSpyMarketHours();
  feedState.marketHours = mh;

  const now = Date.now();
  feedState.dataFreshnessMs = lastDataReceivedTimestamp > 0 ? now - lastDataReceivedTimestamp : 999999;
  // Guard: > 10s old is stale
  feedState.isFresh = lastDataReceivedTimestamp > 0 && feedState.dataFreshnessMs <= 10000;

  if (!mh.marketOpen) {
    feedState.status = 'MARKET CLOSED';
  } else if (feedState.currentPrice !== null && feedState.isFresh) {
    feedState.status = 'LIVE';
  } else if (feedState.currentPrice !== null && !feedState.isFresh) {
    feedState.status = 'STALE';
  } else {
    feedState.status = 'NO DATA';
  }

  feedState.lastUpdated = new Date().toISOString();
  return feedState;
}

/**
 * Aggregates smaller timeframe candles into larger timeframes
 */
export function aggregateCandles(
  sourceCandles: SpyCandle[],
  targetDurationMinutes: number
): SpyCandle[] {
  if (sourceCandles.length === 0) return [];

  const intervalMs = targetDurationMinutes * 60 * 1000;
  const groups = new Map<number, SpyCandle[]>();

  for (const c of sourceCandles) {
    const bucketTime = Math.floor(c.timestamp / intervalMs) * intervalMs;
    const list = groups.get(bucketTime) || [];
    list.push(c);
    groups.set(bucketTime, list);
  }

  const result: SpyCandle[] = [];
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => a - b);

  for (const key of sortedKeys) {
    const group = groups.get(key)!;
    if (group.length === 0) continue;

    const open = group[0].open;
    const close = group[group.length - 1].close;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;

    for (const item of group) {
      if (item.high > high) high = item.high;
      if (item.low < low) low = item.low;
      volume += item.volume;
    }

    result.push({
      openTime: new Date(key).toISOString(),
      timestamp: key,
      open,
      high,
      low,
      close,
      volume,
      isClosed: true,
    });
  }

  return result;
}

/**
 * Broadcast updated feed state to all connected SSE clients
 */
export function broadcastToSseClients(): void {
  const state = getSpyFeedState();
  const payload = `data: ${JSON.stringify(state)}\n\n`;

  for (let i = sseClients.length - 1; i >= 0; i--) {
    const client = sseClients[i];
    try {
      client.write(payload);
    } catch {
      sseClients.splice(i, 1);
    }
  }
}

/**
 * Adds an Express response to the SSE fanout list
 */
export function addSpySseClient(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Immediately send initial state
  const state = getSpyFeedState();
  res.write(`data: ${JSON.stringify(state)}\n\n`);

  sseClients.push(res);

  res.on('close', () => {
    sseClients = sseClients.filter((c) => c !== res);
  });
}

/**
 * REST Backfill from Alpaca Market Data (feed=iex)
 */
export async function backfillAlpacaHistory(): Promise<boolean> {
  const { apiKey, apiSecret } = getAlpacaCredentials();

  if (!apiKey || !apiSecret) {
    console.log('[SPY Feed] No Alpaca API credentials configured in environment.');
    return false;
  }

  try {
    console.log('[SPY Feed] Fetching historical SPY 1-minute bars from Alpaca (feed=iex)...');
    // Fetch last 1000 bars
    const url = `${ALPACA_REST_BASE}/stocks/SPY/bars?timeframe=1Min&limit=1000&feed=iex&sort=asc`;
    const resp = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
      },
    });

    if (!resp.ok) {
      console.warn(`[SPY Feed] Alpaca history REST returned HTTP ${resp.status}`);
      return false;
    }

    const data = (await resp.json()) as any;
    if (!data || !Array.isArray(data.bars) || data.bars.length === 0) {
      console.warn('[SPY Feed] No bars returned in Alpaca history response.');
      return false;
    }

    const parsed1m: SpyCandle[] = data.bars.map((b: any) => ({
      openTime: b.t,
      timestamp: new Date(b.t).getTime(),
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: b.v,
      isClosed: true,
    }));

    candleStore['1m'] = parsed1m;
    candleStore['5m'] = aggregateCandles(parsed1m, 5);
    candleStore['15m'] = aggregateCandles(parsed1m, 15);
    candleStore['1h'] = aggregateCandles(parsed1m, 60);
    candleStore['4h'] = aggregateCandles(parsed1m, 240);
    candleStore['1d'] = aggregateCandles(parsed1m, 1440);

    const latest = parsed1m[parsed1m.length - 1];
    feedState.currentPrice = latest.close;
    feedState.source = 'ALPACA_IEX';
    lastDataReceivedTimestamp = Date.now();

    // Check active signals against live price
    updateActiveSignalsOnPriceTick(latest.close);

    saveCandlesToDisk();
    console.log(`[SPY Feed] Successfully backfilled ${parsed1m.length} SPY bars from Alpaca! Latest: $${latest.close}`);
    broadcastToSseClients();
    return true;
  } catch (err) {
    console.error('[SPY Feed] Error backfilling from Alpaca:', err);
    return false;
  }
}

/**
 * Fallback REST Polling via Twelve Data (Strictly rate-limited: max 8 calls/min, 800/day)
 */
export async function pollTwelveDataFallback(): Promise<boolean> {
  const twelveKey = process.env.TWELVEDATA_KEY || process.env.TWELVE_DATA_API_KEY || '';
  if (!twelveKey) return false;

  const now = Date.now();

  // Reset rate limit counters
  if (now - lastMinuteReset >= 60000) {
    twelveDataMinuteCalls = 0;
    lastMinuteReset = now;
  }
  if (now - lastDayReset >= 86400000) {
    twelveDataDayCalls = 0;
    lastDayReset = now;
  }

  // Enforce at most once per minute and rate limits
  if (now - lastTwelveDataPoll < 60000) return false;
  if (twelveDataMinuteCalls >= 7 || twelveDataDayCalls >= 780) {
    console.warn('[SPY Feed] Twelve Data rate limit throttle reached.');
    return false;
  }

  try {
    lastTwelveDataPoll = now;
    twelveDataMinuteCalls++;
    twelveDataDayCalls++;

    console.log('[SPY Feed] Polling Twelve Data fallback for SPY quote...');
    const url = `https://api.twelvedata.com/quote?symbol=SPY&apikey=${twelveKey}`;
    const resp = await fetch(url);
    if (!resp.ok) return false;

    const data = (await resp.json()) as any;
    if (data && data.close) {
      const price = parseFloat(data.close);
      if (!isNaN(price) && price > 0) {
        feedState.currentPrice = price;
        feedState.previousClose = parseFloat(data.previous_close) || feedState.previousClose;
        feedState.changeDollar = parseFloat(data.change) || null;
        feedState.changePercent = parseFloat(data.percent_change) || null;
        feedState.dayHigh = parseFloat(data.high) || null;
        feedState.dayLow = parseFloat(data.low) || null;
        feedState.dayVolume = parseInt(data.volume, 10) || null;
        feedState.source = 'TWELVEDATA';
        lastDataReceivedTimestamp = Date.now();

        // Update active signals
        updateActiveSignalsOnPriceTick(price);

        broadcastToSseClients();
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error('[SPY Feed] Twelve Data fallback error:', err);
    return false;
  }
}

/**
 * Connect to Alpaca WebSocket (wss://stream.data.alpaca.markets/v2/iex)
 */
export function connectAlpacaWebSocket(): void {
  const { apiKey, apiSecret } = getAlpacaCredentials();

  if (!apiKey || !apiSecret) {
    console.log('[SPY Feed] Alpaca API keys not set. WebSocket skipped; using fallback/cache.');
    feedState.status = 'NO DATA';
    return;
  }

  if (wsInstance && (wsInstance.readyState === WebSocket.OPEN || wsInstance.readyState === WebSocket.CONNECTING)) {
    return;
  }

  console.log(`[SPY Feed] Connecting to Alpaca IEX stream: ${ALPACA_WS_URL}`);
  try {
    wsInstance = new WebSocket(ALPACA_WS_URL);

    wsInstance.on('open', () => {
      console.log('[SPY Feed] WebSocket connected. Sending authentication...');
      reconnectAttempts = 0;
      wsInstance?.send(
        JSON.stringify({
          action: 'auth',
          key: apiKey,
          secret: apiSecret,
        })
      );
    });

    wsInstance.on('message', (data: any) => {
      try {
        const messages = JSON.parse(data.toString());
        if (!Array.isArray(messages)) return;

        for (const msg of messages) {
          // Authentication confirmation
          if (msg.T === 'success' && msg.msg === 'authenticated') {
            console.log('[SPY Feed] Authenticated with Alpaca! Subscribing to SPY trades, quotes, bars...');
            wsInstance?.send(
              JSON.stringify({
                action: 'subscribe',
                trades: ['SPY'],
                quotes: ['SPY'],
                bars: ['SPY'],
              })
            );
          }

          // Trade
          if (msg.T === 't' && msg.S === 'SPY') {
            feedState.currentPrice = msg.p;
            feedState.lastTrade = {
              price: msg.p,
              size: msg.s,
              timestamp: new Date(msg.t).getTime(),
            };
            lastDataReceivedTimestamp = Date.now();
            feedState.source = 'ALPACA_IEX';
            updateActiveSignalsOnPriceTick(msg.p);
            broadcastToSseClients();
          }

          // Quote
          if (msg.T === 'q' && msg.S === 'SPY') {
            feedState.lastQuote = {
              bidPrice: msg.bp,
              bidSize: msg.bs,
              askPrice: msg.ap,
              askSize: msg.as,
              timestamp: new Date(msg.t).getTime(),
            };
            if (feedState.currentPrice === null && msg.bp && msg.ap) {
              feedState.currentPrice = Number(((msg.bp + msg.ap) / 2).toFixed(2));
              updateActiveSignalsOnPriceTick(feedState.currentPrice);
            }
            lastDataReceivedTimestamp = Date.now();
            feedState.source = 'ALPACA_IEX';
            broadcastToSseClients();
          }

          // Minute Bar
          if (msg.T === 'b' && msg.S === 'SPY') {
            const bar: SpyCandle = {
              openTime: msg.t,
              timestamp: new Date(msg.t).getTime(),
              open: msg.o,
              high: msg.h,
              low: msg.l,
              close: msg.c,
              volume: msg.v,
              isClosed: true,
            };

            candleStore['1m'].push(bar);
            if (candleStore['1m'].length > 1200) {
              candleStore['1m'] = candleStore['1m'].slice(-1200);
            }

            // Re-aggregate higher timeframes
            candleStore['5m'] = aggregateCandles(candleStore['1m'], 5);
            candleStore['15m'] = aggregateCandles(candleStore['1m'], 15);
            candleStore['1h'] = aggregateCandles(candleStore['1m'], 60);
            candleStore['4h'] = aggregateCandles(candleStore['1m'], 240);
            candleStore['1d'] = aggregateCandles(candleStore['1m'], 1440);

            feedState.currentPrice = bar.close;
            lastDataReceivedTimestamp = Date.now();
            feedState.source = 'ALPACA_IEX';
            updateActiveSignalsOnPriceTick(bar.close);
            saveCandlesToDisk();
            broadcastToSseClients();
          }
        }
      } catch (err) {
        console.error('[SPY Feed] Error processing WebSocket message:', err);
      }
    });

    wsInstance.on('error', (err) => {
      console.warn('[SPY Feed] WebSocket error:', err.message);
    });

    wsInstance.on('close', (code, reason) => {
      console.warn(`[SPY Feed] WebSocket closed (code ${code}): ${reason}`);
      wsInstance = null;
      if (!isShuttingDown) {
        scheduleReconnect();
      }
    });
  } catch (err) {
    console.error('[SPY Feed] WebSocket creation error:', err);
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectAttempts++;
  const delay = Math.min(30000, 1000 * Math.pow(1.8, Math.min(reconnectAttempts, 6)));
  console.log(`[SPY Feed] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttempts})...`);
  reconnectTimer = setTimeout(() => {
    connectAlpacaWebSocket();
  }, delay);
}

/**
 * Initializes the entire SPY feed subsystem
 */
export async function initSpyFeed(): Promise<void> {
  console.log('[SPY Feed] Initializing SPY Options data layer...');
  loadStoredCandles();

  // Load signals and recover active signals
  loadSpySignalsFromDisk(feedState.currentPrice || undefined);

  // Try Alpaca backfill
  const alpacaSuccess = await backfillAlpacaHistory();
  if (alpacaSuccess) {
    connectAlpacaWebSocket();
  } else {
    // If Alpaca failed or no keys, attempt Twelve Data fallback
    await pollTwelveDataFallback();
  }

  // Set up periodic heartbeat, fallback check, and active signal resolution timer
  setInterval(() => {
    const mh = evaluateSpyMarketHours();
    feedState.marketHours = mh;

    // Check active signals on clock tick
    if (feedState.currentPrice) {
      updateActiveSignalsOnPriceTick(feedState.currentPrice);
    }

    // Send SSE keep-alive ping
    for (let i = sseClients.length - 1; i >= 0; i--) {
      try {
        sseClients[i].write(': ping\n\n');
      } catch {
        sseClients.splice(i, 1);
      }
    }

    // If market is open but we haven't received data for 60s, try Twelve Data fallback
    if (mh.marketOpen && Date.now() - lastDataReceivedTimestamp > 60000) {
      pollTwelveDataFallback();
    }
  }, 10000);
}

export function shutdownSpyFeed(): void {
  isShuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (wsInstance) {
    try {
      wsInstance.close();
    } catch {
      // Ignore
    }
  }
  saveCandlesToDisk();
  saveSpySignalsToDisk();
}
