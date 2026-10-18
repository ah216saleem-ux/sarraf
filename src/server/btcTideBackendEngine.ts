import WebSocket from 'ws';
import {
  SecondBin,
  AggTrade,
  OrderBookDepth,
  PerpPositioning,
  VenuesTableData,
  BtcFeedStatus,
  DepthLevel,
  LiquidationItem,
} from '../btcTide/types.ts';
import {
  evaluateDecisionEngine,
  createTradePlan,
  evaluateActiveTradeTick,
  DecisionEngineResult,
} from '../btcTide/signalEngine.ts';
import {
  initBtcTideSqlite,
  getActiveTradeFromSqlite,
  getClosedTradesFromSqlite,
  computeSqliteStats,
  saveTradeToSqlite,
  getLastSignalTimeFromSqlite,
  persistSqliteToDisk,
} from './btcTideSqliteDatabase.ts';
import {
  notifyNewBtcTideSignal,
  notifyBtcTideTpHit,
  notifyBtcTideBreakevenMove,
  notifyBtcTideSlHit,
  notifyBtcTideExpiry,
} from './btcTideTelegramNotifier.ts';
import type { Response } from 'express';

const BINANCE_SPOT_WS =
  'wss://stream.binance.com:9443/stream?streams=btcusdt@aggTrade/btcusdt@bookTicker/btcusdt@depth20@100ms';
const BINANCE_FUTURES_WS =
  'wss://fstream.binance.com/stream?streams=btcusdt@markPrice@1s/btcusdt@forceOrder';
const BYBIT_PUBLIC_WS = 'wss://stream.bybit.com/v5/public/spot';

export type ActiveFeedSource = 'BINANCE' | 'BYBIT';

export interface BtcTideBackendState {
  activeSource: ActiveFeedSource;
  status: BtcFeedStatus;
  statusText: string;
  currentPrice: number | null;
  priceFlash: 'up' | 'down' | 'none';
  lastMessageTime: number | null;
  messageAgeMs: number;
  bookTicker: {
    bid: number | null;
    ask: number | null;
    spread: number | null;
    spreadBps: number | null;
  };
  depth: OrderBookDepth;
  perp: PerpPositioning;
  session: {
    sessionHigh: number | null;
    sessionLow: number | null;
    ticksSeen: number;
    firstTickTime: number | null;
  };
  secondBins: SecondBin[];
  recentTrades: AggTrade[];
  largePrints: AggTrade[];
  decision: DecisionEngineResult;
  activeTrade: any | null;
  closedTrades: any[];
  signalStats: any;
}

const MAX_BINS_RETENTION_SEC = 1800; // 30 min
const MAX_RECENT_TRADES = 400;
const LARGE_PRINT_USD = 50000;

// Central Backend Singleton State
const binsMap = new Map<number, SecondBin>();
let recentTradesList: AggTrade[] = [];
let largePrintsList: AggTrade[] = [];
let liquidationsList: LiquidationItem[] = [];

let activeSource: ActiveFeedSource = 'BINANCE';
let feedStatus: BtcFeedStatus = 'CONNECTING';
let lastMessageTime: number | null = null;
let currentPrice: number | null = null;
let prevPrice: number | null = null;
let priceFlash: 'up' | 'down' | 'none' = 'none';

let sessionHigh: number | null = null;
let sessionLow: number | null = null;
let ticksSeen = 0;
let firstTickTime: number | null = null;
let liqSeqCounter = 0;

let currentActiveTrade: any | null = null;
let currentClosedTrades: any[] = [];
let lastSignalTime: number | null = null;
let currentDecision: DecisionEngineResult = {
  isSilent: true,
  secondsCollected: 0,
  silenceRemainingSec: 180,
  totalScore: 0,
  bullishScore: 0,
  bearishScore: 0,
  confidence: 0,
  lead: 0,
  favoredSide: 'NEUTRAL',
  components: [],
  absorbDriveScore: 0,
  absorbDriveAgrees: false,
  canFire: false,
  cooldownRemainingSec: 0,
  waitReason: 'Silent: Collecting live data (0/180s)',
};

let bookTicker = {
  bid: null as number | null,
  ask: null as number | null,
  spread: null as number | null,
  spreadBps: null as number | null,
};

let depth: OrderBookDepth = {
  bids: [],
  asks: [],
  bidTotal: 0,
  askTotal: 0,
  imbalancePct: null,
  spread: null,
  spreadBps: null,
  updatedAt: 0,
};

let perp: PerpPositioning = {
  markPrice: null,
  fundingRate: null,
  nextFundingTime: null,
  openInterest: null,
  oiChange1h: null,
  oiChange1hPct: null,
  basis: null,
  basisBps: null,
  longShortRatio: null,
  longAccountPct: null,
  shortAccountPct: null,
  liquidations5m: [],
  totalLiq5mUsd: 0,
  longLiq5mUsd: 0,
  shortLiq5mUsd: 0,
  status: 'CONNECTING',
  updatedAt: 0,
};

// WebSocket Instances & Timers
let binanceSpotWs: WebSocket | null = null;
let binanceFuturesWs: WebSocket | null = null;
let bybitWs: WebSocket | null = null;

let engineWatchdogTimer: NodeJS.Timeout | null = null;
let futuresPollTimer: NodeJS.Timeout | null = null;
let isBackendEngineStarted = false;
let startTimeMs = Date.now();

// SSE Subscribers
const sseClients = new Set<Response>();

export function registerSseClient(res: Response): () => void {
  sseClients.add(res);
  // Send current snapshot immediately
  try {
    const payload = JSON.stringify(getBackendSnapshot());
    res.write(`data: ${payload}\n\n`);
  } catch {}

  return () => {
    sseClients.delete(res);
  };
}

function broadcastSse(): void {
  if (sseClients.size === 0) return;
  const snapshot = getBackendSnapshot();
  const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Throttled SSE broadcast (max 8 times per second for smooth charts)
let broadcastTimer: NodeJS.Timeout | null = null;
function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastSse();
  }, 120);
}

// ---------------------------------------------------------------------------
// 1. Trade & Tick Ingestion
// ---------------------------------------------------------------------------
function handleTradeTick(
  tradeId: string,
  price: number,
  qty: number,
  usdValue: number,
  aggressorSide: 'BUY' | 'SELL',
  tradeTime: number
) {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) return;

  const now = Date.now();
  lastMessageTime = now;
  ticksSeen += 1;
  if (!firstTickTime) firstTickTime = now;

  if (sessionHigh === null || price > sessionHigh) sessionHigh = price;
  if (sessionLow === null || price < sessionLow) sessionLow = price;

  if (prevPrice !== null && price !== prevPrice) {
    priceFlash = price > prevPrice ? 'up' : 'down';
  }
  prevPrice = price;
  currentPrice = price;

  const tradeRecord: AggTrade = {
    id: tradeId,
    time: tradeTime,
    price,
    qty,
    usdValue,
    aggressorSide,
  };

  recentTradesList = [tradeRecord, ...recentTradesList.slice(0, MAX_RECENT_TRADES - 1)];

  if (usdValue >= LARGE_PRINT_USD) {
    const cutoff = tradeTime - MAX_BINS_RETENTION_SEC * 1000;
    largePrintsList = [
      tradeRecord,
      ...largePrintsList.filter((p) => p.time >= cutoff).slice(0, 199),
    ];
  }

  // 1-second bin aggregation
  const sec = Math.floor(tradeTime / 1000);
  const existing = binsMap.get(sec);
  if (existing) {
    existing.count += 1;
    existing.highPrice = Math.max(existing.highPrice, price);
    existing.lowPrice = Math.min(existing.lowPrice, price);
    existing.lastPrice = price;
    if (aggressorSide === 'BUY') {
      existing.buyVol += qty;
      existing.buyUsd += usdValue;
    } else {
      existing.sellVol += qty;
      existing.sellUsd += usdValue;
    }
    if (usdValue >= LARGE_PRINT_USD && usdValue > existing.largePrintMaxUsd) {
      existing.largePrintMaxUsd = usdValue;
      existing.largePrintSide = aggressorSide;
    }
  } else {
    binsMap.set(sec, {
      sec,
      buyVol: aggressorSide === 'BUY' ? qty : 0,
      sellVol: aggressorSide === 'SELL' ? qty : 0,
      buyUsd: aggressorSide === 'BUY' ? usdValue : 0,
      sellUsd: aggressorSide === 'SELL' ? usdValue : 0,
      count: 1,
      openPrice: price,
      highPrice: price,
      lowPrice: price,
      lastPrice: price,
      largePrintMaxUsd: usdValue >= LARGE_PRINT_USD ? usdValue : 0,
      largePrintSide: usdValue >= LARGE_PRINT_USD ? aggressorSide : null,
    });
  }

  // Prune bins older than 30 min
  const oldestAllowed = sec - MAX_BINS_RETENTION_SEC;
  for (const k of binsMap.keys()) {
    if (k < oldestAllowed) binsMap.delete(k);
  }

  // Sub-second active trade tracking
  if (currentActiveTrade) {
    const prevTp1 = currentActiveTrade.tp1Hit;
    const prevTp2 = currentActiveTrade.tp2Hit;
    const prevBe = currentActiveTrade.beMoved;

    const { updatedTrade, closed } = evaluateActiveTradeTick(currentActiveTrade, price, now);
    currentActiveTrade = updatedTrade;

    // Check Telegram triggers on milestones
    if (!prevTp1 && updatedTrade.tp1Hit) {
      notifyBtcTideTpHit(updatedTrade, 1, price);
      notifyBtcTideBreakevenMove(updatedTrade);
    } else if (!prevTp2 && updatedTrade.tp2Hit) {
      notifyBtcTideTpHit(updatedTrade, 2, price);
    }

    if (closed) {
      currentActiveTrade = null;
      currentClosedTrades = [
        updatedTrade,
        ...currentClosedTrades.filter((t) => t.id !== updatedTrade.id),
      ].slice(0, 300);
      saveTradeToSqlite(updatedTrade);

      if (updatedTrade.outcome === 'TP3') {
        notifyBtcTideTpHit(updatedTrade, 3, price);
      } else if (updatedTrade.outcome === 'SL' || updatedTrade.outcome === 'TP1+BE') {
        notifyBtcTideSlHit(updatedTrade, price);
      } else if (updatedTrade.outcome === 'EXPIRED') {
        notifyBtcTideExpiry(updatedTrade, price);
      }
    } else {
      saveTradeToSqlite(updatedTrade);
    }
  }

  scheduleBroadcast();
}

// ---------------------------------------------------------------------------
// 2. Binance Spot & Futures WebSockets
// ---------------------------------------------------------------------------
function connectBinanceSpot() {
  if (binanceSpotWs) {
    try {
      binanceSpotWs.close();
    } catch {}
    binanceSpotWs = null;
  }

  try {
    const ws = new WebSocket(BINANCE_SPOT_WS);
    binanceSpotWs = ws;

    ws.on('open', () => {
      console.log('[BTC TIDE BACKEND] Connected to Binance Spot WebSocket');
      if (activeSource === 'BINANCE') {
        feedStatus = 'LIVE';
      }
    });

    ws.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        const stream = payload.stream;
        const data = payload.data;

        if (stream === 'btcusdt@aggTrade') {
          // If Binance is healthy, mark activeSource as BINANCE
          activeSource = 'BINANCE';
          feedStatus = 'LIVE';

          const tradeTime = Number(data.T || data.E || Date.now());
          const price = parseFloat(data.p);
          const qty = parseFloat(data.q);
          const usdValue = price * qty;
          const aggressorSide = data.m ? 'SELL' : 'BUY';
          const tradeId = String(data.a || `${tradeTime}_${ticksSeen}`);

          handleTradeTick(tradeId, price, qty, usdValue, aggressorSide, tradeTime);
        } else if (stream === 'btcusdt@bookTicker') {
          const bid = parseFloat(data.b);
          const ask = parseFloat(data.a);
          if (bid > 0 && ask > 0) {
            const spread = Number((ask - bid).toFixed(2));
            const mid = (ask + bid) / 2;
            const spreadBps = Number(((spread / mid) * 10000).toFixed(2));
            bookTicker = { bid, ask, spread, spreadBps };
          }
        } else if (stream === 'btcusdt@depth20@100ms') {
          const rawBids = Array.isArray(data.bids) ? data.bids : [];
          const rawAsks = Array.isArray(data.asks) ? data.asks : [];

          let bidTotal = 0;
          let askTotal = 0;
          const topBids: DepthLevel[] = [];
          const topAsks: DepthLevel[] = [];

          for (let i = 0; i < Math.min(8, rawBids.length); i++) {
            const p = parseFloat(rawBids[i][0]);
            const q = parseFloat(rawBids[i][1]);
            bidTotal += q;
            topBids.push({ price: p, qty: q, total: bidTotal, depthPct: 0 });
          }
          for (let i = 0; i < Math.min(8, rawAsks.length); i++) {
            const p = parseFloat(rawAsks[i][0]);
            const q = parseFloat(rawAsks[i][1]);
            askTotal += q;
            topAsks.push({ price: p, qty: q, total: askTotal, depthPct: 0 });
          }

          const maxBid = bidTotal > 0 ? bidTotal : 1;
          const maxAsk = askTotal > 0 ? askTotal : 1;
          topBids.forEach((b) => (b.depthPct = Number(((b.total / maxBid) * 100).toFixed(1))));
          topAsks.forEach((a) => (a.depthPct = Number(((a.total / maxAsk) * 100).toFixed(1))));

          const totalDepth = bidTotal + askTotal;
          const imbalancePct = totalDepth > 0 ? Number((((bidTotal - askTotal) / totalDepth) * 100).toFixed(1)) : null;

          depth = {
            bids: topBids,
            asks: topAsks,
            bidTotal: Number(bidTotal.toFixed(3)),
            askTotal: Number(askTotal.toFixed(3)),
            imbalancePct,
            spread: bookTicker.spread,
            spreadBps: bookTicker.spreadBps,
            updatedAt: Date.now(),
          };
        }
      } catch {}
    });

    ws.on('error', (err) => {
      console.warn('[BTC TIDE BACKEND] Binance spot WS error:', err.message);
      triggerBybitFallback('Binance spot WS error');
    });

    ws.on('close', () => {
      console.warn('[BTC TIDE BACKEND] Binance spot WS closed. Will reconnect...');
      triggerBybitFallback('Binance spot WS closed');
      setTimeout(connectBinanceSpot, 3000);
    });
  } catch (err: any) {
    console.error('[BTC TIDE BACKEND] Failed to initiate Binance spot WS:', err.message);
    triggerBybitFallback('Failed to initiate Binance WS');
  }
}

function connectBinanceFutures() {
  if (binanceFuturesWs) {
    try {
      binanceFuturesWs.close();
    } catch {}
    binanceFuturesWs = null;
  }

  try {
    const ws = new WebSocket(BINANCE_FUTURES_WS);
    binanceFuturesWs = ws;

    ws.on('open', () => {
      console.log('[BTC TIDE BACKEND] Connected to Binance Futures WebSocket');
    });

    ws.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        const stream = payload.stream;
        const data = payload.data;

        if (stream === 'btcusdt@markPrice@1s') {
          const markPrice = parseFloat(data.p);
          const fundingRate = parseFloat(data.r);
          const nextFundingTime = Number(data.T);
          const spotP = currentPrice;

          let basis = perp.basis;
          let basisBps = perp.basisBps;
          if (spotP && spotP > 0 && markPrice > 0) {
            basis = Number((markPrice - spotP).toFixed(2));
            basisBps = Number(((basis / spotP) * 10000).toFixed(1));
          }

          perp = {
            ...perp,
            markPrice,
            fundingRate,
            nextFundingTime,
            basis,
            basisBps,
            updatedAt: Date.now(),
          };
        } else if (stream === 'btcusdt@forceOrder') {
          const order = data.o || data;
          const liqTime = Number(order.T || Date.now());
          const side = order.S === 'BUY' ? 'BUY' : 'SELL';
          const qty = parseFloat(order.q);
          const price = parseFloat(order.p);
          const usdValue = price * qty;

          liqSeqCounter += 1;
          const liqItem: LiquidationItem = {
            id: `liq_${liqTime}_${liqSeqCounter}`,
            time: liqTime,
            side,
            qty,
            price,
            usdValue,
          };

          const cutoff = Date.now() - 5 * 60 * 1000;
          liquidationsList = [liqItem, ...liquidationsList.filter((l) => l.time >= cutoff).slice(0, 99)];

          let total = 0;
          let longTotal = 0;
          let shortTotal = 0;
          for (const l of liquidationsList) {
            total += l.usdValue;
            if (l.side === 'SELL') longTotal += l.usdValue;
            else shortTotal += l.usdValue;
          }

          perp = {
            ...perp,
            liquidations5m: liquidationsList,
            totalLiq5mUsd: Number(total.toFixed(0)),
            longLiq5mUsd: Number(longTotal.toFixed(0)),
            shortLiq5mUsd: Number(shortTotal.toFixed(0)),
            updatedAt: Date.now(),
          };
        }
      } catch {}
    });

    ws.on('close', () => {
      setTimeout(connectBinanceFutures, 4000);
    });
  } catch {}
}

// ---------------------------------------------------------------------------
// 3. Fallback Source: Bybit v5 Public WebSocket
// ---------------------------------------------------------------------------
function connectBybitFallback() {
  if (bybitWs) {
    try {
      bybitWs.close();
    } catch {}
    bybitWs = null;
  }

  try {
    const ws = new WebSocket(BYBIT_PUBLIC_WS);
    bybitWs = ws;

    ws.on('open', () => {
      console.log('[BTC TIDE BACKEND] Connected to Bybit v5 Public WS');
      ws.send(
        JSON.stringify({
          op: 'subscribe',
          args: ['publicTrade.BTCUSDT', 'orderbook.50.BTCUSDT'],
        })
      );
    });

    ws.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        const topic = payload.topic;
        const data = payload.data;

        // Only process Bybit data if activeSource is BYBIT (or Binance is silent)
        if (activeSource !== 'BYBIT' && lastMessageTime && Date.now() - lastMessageTime < 5000) {
          return;
        }

        if (topic === 'publicTrade.BTCUSDT' && Array.isArray(data)) {
          activeSource = 'BYBIT';
          feedStatus = 'LIVE';

          for (const t of data) {
            const price = parseFloat(t.p);
            const qty = parseFloat(t.v);
            const usdValue = price * qty;
            const aggressorSide = t.S === 'Buy' ? 'BUY' : 'SELL';
            const tradeTime = Number(t.T || Date.now());
            const tradeId = `bybit_${t.i || tradeTime}_${ticksSeen}`;

            handleTradeTick(tradeId, price, qty, usdValue, aggressorSide, tradeTime);
          }
        } else if (topic === 'orderbook.50.BTCUSDT' && data) {
          if (activeSource !== 'BYBIT') return;

          const rawBids = Array.isArray(data.b) ? data.b : [];
          const rawAsks = Array.isArray(data.a) ? data.a : [];

          if (rawBids.length > 0 && rawAsks.length > 0) {
            const bestBid = parseFloat(rawBids[0][0]);
            const bestAsk = parseFloat(rawAsks[0][0]);
            const spread = Number((bestAsk - bestBid).toFixed(2));
            const spreadBps = Number(((spread / ((bestAsk + bestBid) / 2)) * 10000).toFixed(2));
            bookTicker = { bid: bestBid, ask: bestAsk, spread, spreadBps };

            let bidTotal = 0;
            let askTotal = 0;
            const topBids: DepthLevel[] = [];
            const topAsks: DepthLevel[] = [];

            for (let i = 0; i < Math.min(8, rawBids.length); i++) {
              const p = parseFloat(rawBids[i][0]);
              const q = parseFloat(rawBids[i][1]);
              bidTotal += q;
              topBids.push({ price: p, qty: q, total: bidTotal, depthPct: 0 });
            }
            for (let i = 0; i < Math.min(8, rawAsks.length); i++) {
              const p = parseFloat(rawAsks[i][0]);
              const q = parseFloat(rawAsks[i][1]);
              askTotal += q;
              topAsks.push({ price: p, qty: q, total: askTotal, depthPct: 0 });
            }

            const maxBid = bidTotal > 0 ? bidTotal : 1;
            const maxAsk = askTotal > 0 ? askTotal : 1;
            topBids.forEach((b) => (b.depthPct = Number(((b.total / maxBid) * 100).toFixed(1))));
            topAsks.forEach((a) => (a.depthPct = Number(((a.total / maxAsk) * 100).toFixed(1))));

            const totalDepth = bidTotal + askTotal;
            const imbalancePct = totalDepth > 0 ? Number((((bidTotal - askTotal) / totalDepth) * 100).toFixed(1)) : null;

            depth = {
              bids: topBids,
              asks: topAsks,
              bidTotal: Number(bidTotal.toFixed(3)),
              askTotal: Number(askTotal.toFixed(3)),
              imbalancePct,
              spread,
              spreadBps,
              updatedAt: Date.now(),
            };
          }
        }
      } catch {}
    });

    ws.on('close', () => {
      setTimeout(connectBybitFallback, 5000);
    });
  } catch {}
}

function triggerBybitFallback(reason: string) {
  if (activeSource !== 'BYBIT') {
    console.warn(`[BTC TIDE BACKEND] Switching to Bybit v5 fallback. Reason: ${reason}`);
    activeSource = 'BYBIT';
  }
}

// ---------------------------------------------------------------------------
// 4. 1-Second Signal Engine Evaluation Loop
// ---------------------------------------------------------------------------
function runBackendSignalEngineStep() {
  const now = Date.now();
  const sortedBins = Array.from(binsMap.values()).sort((a, b) => a.sec - b.sec);

  // 1. Evaluate Decision Engine
  currentDecision = evaluateDecisionEngine(
    sortedBins,
    depth,
    perp,
    currentPrice,
    feedStatus,
    lastSignalTime,
    Boolean(currentActiveTrade)
  );

  // 2. Track Active Trade if running
  if (currentActiveTrade && currentPrice !== null) {
    const prevTp1 = currentActiveTrade.tp1Hit;
    const prevTp2 = currentActiveTrade.tp2Hit;

    const { updatedTrade, closed } = evaluateActiveTradeTick(currentActiveTrade, currentPrice, now);
    currentActiveTrade = updatedTrade;

    if (!prevTp1 && updatedTrade.tp1Hit) {
      notifyBtcTideTpHit(updatedTrade, 1, currentPrice);
      notifyBtcTideBreakevenMove(updatedTrade);
    } else if (!prevTp2 && updatedTrade.tp2Hit) {
      notifyBtcTideTpHit(updatedTrade, 2, currentPrice);
    }

    if (closed) {
      currentActiveTrade = null;
      currentClosedTrades = [
        updatedTrade,
        ...currentClosedTrades.filter((t) => t.id !== updatedTrade.id),
      ].slice(0, 300);
      saveTradeToSqlite(updatedTrade);

      if (updatedTrade.outcome === 'TP3') {
        notifyBtcTideTpHit(updatedTrade, 3, currentPrice);
      } else if (updatedTrade.outcome === 'SL' || updatedTrade.outcome === 'TP1+BE') {
        notifyBtcTideSlHit(updatedTrade, currentPrice);
      } else if (updatedTrade.outcome === 'EXPIRED') {
        notifyBtcTideExpiry(updatedTrade, currentPrice);
      }
    } else {
      saveTradeToSqlite(updatedTrade);
    }
  } else if (!currentActiveTrade && currentDecision.canFire && currentPrice !== null) {
    // 3. Fire New Signal
    const newTrade = createTradePlan(
      currentDecision.favoredSide as 'LONG' | 'SHORT',
      currentPrice,
      sortedBins,
      currentDecision.confidence,
      currentDecision.lead,
      currentDecision.waitReason
    );
    currentActiveTrade = newTrade;
    lastSignalTime = newTrade.entryTime;
    saveTradeToSqlite(newTrade);

    // Telegram Notification
    notifyNewBtcTideSignal(newTrade, currentDecision);
  }

  scheduleBroadcast();
}

// ---------------------------------------------------------------------------
// 5. Watchdog & Staleness Watcher
// ---------------------------------------------------------------------------
function startBackendWatchdog() {
  if (engineWatchdogTimer) clearInterval(engineWatchdogTimer);
  engineWatchdogTimer = setInterval(() => {
    runBackendSignalEngineStep();

    if (!lastMessageTime) {
      feedStatus = 'CONNECTING';
      return;
    }

    const ageMs = Date.now() - lastMessageTime;
    if (ageMs > 15000) {
      feedStatus = 'OFFLINE';
      triggerBybitFallback(`Feed stale > 15s (${(ageMs / 1000).toFixed(1)}s)`);
    } else if (ageMs > 5000) {
      feedStatus = 'STALE';
      triggerBybitFallback(`Feed stale > 5s (${(ageMs / 1000).toFixed(1)}s)`);
    } else {
      feedStatus = 'LIVE';
    }
  }, 1000);
}

// ---------------------------------------------------------------------------
// 6. Public Snapshot & Lifecycle
// ---------------------------------------------------------------------------
export function getBackendSnapshot(): BtcTideBackendState {
  const sortedBins = Array.from(binsMap.values()).sort((a, b) => a.sec - b.sec);
  const ageMs = lastMessageTime ? Date.now() - lastMessageTime : 0;
  const statusText =
    feedStatus === 'LIVE'
      ? `LIVE (${activeSource})`
      : feedStatus === 'STALE'
      ? `STALE (${activeSource} · ${(ageMs / 1000).toFixed(1)}s)`
      : feedStatus === 'OFFLINE'
      ? 'OFFLINE'
      : 'CONNECTING';

  return {
    activeSource,
    status: feedStatus,
    statusText,
    currentPrice,
    priceFlash,
    lastMessageTime,
    messageAgeMs: ageMs,
    bookTicker,
    depth,
    perp,
    session: {
      sessionHigh,
      sessionLow,
      ticksSeen,
      firstTickTime,
    },
    secondBins: sortedBins,
    recentTrades: recentTradesList,
    largePrints: largePrintsList,
    decision: currentDecision,
    activeTrade: currentActiveTrade,
    closedTrades: currentClosedTrades,
    signalStats: computeSqliteStats(),
  };
}

export async function initBtcTideBackend(): Promise<void> {
  if (isBackendEngineStarted) return;
  isBackendEngineStarted = true;

  console.log('[BTC TIDE BACKEND] Booting 24/7 Node.js BTC Tide Signal Engine...');

  // 1. Initialize SQLite Database
  await initBtcTideSqlite();
  currentActiveTrade = getActiveTradeFromSqlite();
  currentClosedTrades = getClosedTradesFromSqlite(300);
  lastSignalTime = getLastSignalTimeFromSqlite();
  console.log(
    `[BTC TIDE BACKEND] SQLite loaded: ${currentClosedTrades.length} closed trades, active: ${
      currentActiveTrade?.id || 'none'
    }`
  );

  // 2. Start WebSocket Feeds
  connectBinanceSpot();
  connectBinanceFutures();
  connectBybitFallback();

  // 3. Start 1-sec Engine Watchdog
  startBackendWatchdog();

  console.log('[BTC TIDE BACKEND] 24/7 Engine is active and serving signals.');
}

// Graceful Shutdown
export function shutdownBtcTideBackend(): void {
  console.log('[BTC TIDE BACKEND] Gracefully shutting down...');
  if (engineWatchdogTimer) clearInterval(engineWatchdogTimer);
  if (broadcastTimer) clearTimeout(broadcastTimer);

  try {
    if (binanceSpotWs) binanceSpotWs.close();
    if (binanceFuturesWs) binanceFuturesWs.close();
    if (bybitWs) bybitWs.close();
  } catch {}

  persistSqliteToDisk();
  console.log('[BTC TIDE BACKEND] Shutdown complete. Database persisted.');
}
