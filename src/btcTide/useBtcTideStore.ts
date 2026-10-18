import { useState, useEffect, useCallback } from 'react';
import {
  BtcFeedStatus,
  BtcTideStoreState,
  WindowOption,
  AggTrade,
  BookTicker,
  SecondBin,
  WindowFlowStats,
  WaveformEventLabel,
  TenSecDeltaBar,
  OrderBookDepth,
  PerpPositioning,
  VenuesTableData,
  DepthLevel,
  LiquidationItem,
  ActiveTideSignal,
} from './types';
import { DecisionEngineResult } from './signalEngine';
import type { BtcTideTradeRecord, BtcTideStats } from '../server/btcTideSignalDatabase';

// ---------------------------------------------------------------------------
// Central Singleton Live Store - Served by 24/7 Node.js Backend & SSE
// ---------------------------------------------------------------------------
const initialDecision: DecisionEngineResult = {
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

const initialStats: BtcTideStats = {
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

let currentState: BtcTideStoreState = {
  activeSource: 'BINANCE',
  status: 'CONNECTING',
  statusText: 'Connecting to 24/7 backend feed stream...',
  lastMessageTime: null,
  messageAgeMs: 0,
  reconnectAttempts: 0,
  currentPrice: null,
  priceFlash: 'none',
  bookTicker: {
    bid: null,
    ask: null,
    spread: null,
    spreadBps: null,
    updatedAt: 0,
  },
  depth: {
    bids: [],
    asks: [],
    bidTotal: 0,
    askTotal: 0,
    imbalancePct: null,
    spread: null,
    spreadBps: null,
    updatedAt: 0,
  },
  perp: {
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
  },
  venues: {
    venues: [],
    medianPrice: null,
    spread: null,
    highestVenue: null,
    lowestVenue: null,
    totalVolumeBtc: 0,
    updatedAt: 0,
  },
  session: {
    sessionHigh: null,
    sessionLow: null,
    ticksSeen: 0,
    firstTickTime: null,
  },
  selectedWindow: '1m',
  activeSignal: null,
  decision: initialDecision,
  activeTrade: null,
  closedTrades: [],
  signalStats: initialStats,
  secondBins: [],
  recentTrades: [],
  largePrints: [],
};

type Listener = (state: BtcTideStoreState) => void;
const listeners = new Set<Listener>();

type TradeListener = (trade: AggTrade) => void;
const tradeListeners = new Set<TradeListener>();

type LiqListener = (liq: LiquidationItem) => void;
const liqListeners = new Set<LiqListener>();

export function subscribeLiveTrades(cb: TradeListener): () => void {
  tradeListeners.add(cb);
  return () => {
    tradeListeners.delete(cb);
  };
}

export function subscribeLiveLiquidations(cb: LiqListener): () => void {
  liqListeners.add(cb);
  return () => {
    liqListeners.delete(cb);
  };
}

let sseEventSource: EventSource | null = null;
let venuesPollTimer: NodeJS.Timeout | null = null;
let watchdogTimer: NodeJS.Timeout | null = null;
let isStoreStarted = false;
let lastSeenTradeId: string | null = null;
let lastSeenLiqId: string | null = null;
let notifyTimer: NodeJS.Timeout | null = null;

function emitNow() {
  if (notifyTimer) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  listeners.forEach((l) => l(currentState));
}

function scheduleEmit() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    emitNow();
  }, 80);
}

// ---------------------------------------------------------------------------
// 1. Backend SSE Stream Connection
// ---------------------------------------------------------------------------
function connectBackendSse() {
  if (typeof window === 'undefined') return;

  if (sseEventSource) {
    try {
      sseEventSource.close();
    } catch {}
    sseEventSource = null;
  }

  try {
    const es = new EventSource('/api/btc-tide/live-stream');
    sseEventSource = es;

    es.onopen = () => {
      currentState = {
        ...currentState,
        status: 'LIVE',
        statusText: `LIVE (${currentState.activeSource})`,
        reconnectAttempts: 0,
      };
      scheduleEmit();
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data) return;

        // Trade particle notifications for HeroTideCanvas
        if (Array.isArray(data.recentTrades) && data.recentTrades.length > 0) {
          const newest = data.recentTrades[0];
          if (!lastSeenTradeId || newest.id !== lastSeenTradeId) {
            lastSeenTradeId = newest.id;
            tradeListeners.forEach((cb) => cb(newest));
          }
        }

        // Liquidation sparks for HeroTideCanvas
        if (
          data.perp?.liquidations5m &&
          Array.isArray(data.perp.liquidations5m) &&
          data.perp.liquidations5m.length > 0
        ) {
          const newestLiq = data.perp.liquidations5m[0];
          if (!lastSeenLiqId || newestLiq.id !== lastSeenLiqId) {
            lastSeenLiqId = newestLiq.id;
            liqListeners.forEach((cb) => cb(newestLiq));
          }
        }

        // Active signal mapping for HeroTideCanvas (SL/TP zones)
        let activeSignal: ActiveTideSignal | null = null;
        if (data.activeTrade && data.status === 'LIVE') {
          activeSignal = {
            direction: data.activeTrade.side,
            entryPrice: data.activeTrade.entryPrice,
            slPrice: data.activeTrade.slPrice,
            tpPrice: data.activeTrade.tp3Price,
            triggeredAt: data.activeTrade.entryTime,
            reason: data.activeTrade.triggerReason,
          };
        }

        currentState = {
          ...currentState,
          activeSource: data.activeSource || 'BINANCE',
          status: data.status || 'LIVE',
          statusText: data.statusText || 'LIVE',
          currentPrice: data.currentPrice,
          priceFlash: data.priceFlash || 'none',
          lastMessageTime: data.lastMessageTime,
          messageAgeMs: data.messageAgeMs || 0,
          bookTicker: data.bookTicker || currentState.bookTicker,
          depth: data.depth || currentState.depth,
          perp: data.perp || currentState.perp,
          session: data.session || currentState.session,
          secondBins: data.secondBins || [],
          recentTrades: data.recentTrades || [],
          largePrints: data.largePrints || [],
          decision: data.decision || currentState.decision,
          activeTrade: data.activeTrade || null,
          closedTrades: data.closedTrades || [],
          signalStats: data.signalStats || currentState.signalStats,
          activeSignal,
        };

        scheduleEmit();
      } catch {}
    };

    es.onerror = () => {
      currentState = {
        ...currentState,
        status: 'OFFLINE',
        statusText: 'Reconnecting to 24/7 backend feed...',
      };
      scheduleEmit();
    };
  } catch {}
}

// ---------------------------------------------------------------------------
// 2. Initial State Fetch & Venues Polling
// ---------------------------------------------------------------------------
async function fetchInitialBackendState() {
  try {
    const res = await fetch('/api/btc-tide/state');
    if (!res.ok) return;
    const json = await res.json();
    if (json.success) {
      let activeSignal: ActiveTideSignal | null = null;
      if (json.activeTrade && json.status === 'LIVE') {
        activeSignal = {
          direction: json.activeTrade.side,
          entryPrice: json.activeTrade.entryPrice,
          slPrice: json.activeTrade.slPrice,
          tpPrice: json.activeTrade.tp3Price,
          triggeredAt: json.activeTrade.entryTime,
          reason: json.activeTrade.triggerReason,
        };
      }

      currentState = {
        ...currentState,
        activeSource: json.activeSource || 'BINANCE',
        status: json.status || 'LIVE',
        statusText: json.statusText || 'LIVE',
        currentPrice: json.currentPrice,
        priceFlash: json.priceFlash || 'none',
        lastMessageTime: json.lastMessageTime,
        messageAgeMs: json.messageAgeMs || 0,
        bookTicker: json.bookTicker || currentState.bookTicker,
        depth: json.depth || currentState.depth,
        perp: json.perp || currentState.perp,
        session: json.session || currentState.session,
        secondBins: json.secondBins || [],
        recentTrades: json.recentTrades || [],
        largePrints: json.largePrints || [],
        decision: json.decision || currentState.decision,
        activeTrade: json.activeTrade || null,
        closedTrades: json.closedTrades || [],
        signalStats: json.signalStats || currentState.signalStats,
        activeSignal,
      };
      scheduleEmit();
    }
  } catch {}
}

async function pollVenuesData() {
  try {
    const res = await fetch('/api/venues');
    if (!res.ok) return;
    const json = await res.json();
    if (json.success && Array.isArray(json.venues)) {
      currentState = {
        ...currentState,
        venues: {
          venues: json.venues,
          medianPrice: json.summary?.medianPrice ?? null,
          spread: json.summary?.spread ?? null,
          highestVenue: json.summary?.highestVenue ?? null,
          lowestVenue: json.summary?.lowestVenue ?? null,
          totalVolumeBtc: json.summary?.totalVolumeBtc ?? 0,
          updatedAt: Date.now(),
        },
      };
      scheduleEmit();
    }
  } catch {}
}

function ensureStoreStarted() {
  if (isStoreStarted) return;
  isStoreStarted = true;

  // 1. Initial snapshot fetch
  fetchInitialBackendState();

  // 2. Connect to SSE
  connectBackendSse();

  // 3. Poll venues every 3 seconds
  pollVenuesData();
  if (venuesPollTimer) clearInterval(venuesPollTimer);
  venuesPollTimer = setInterval(pollVenuesData, 3000);

  // 4. Watchdog every 1s for browser staleness
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(() => {
    if (!currentState.lastMessageTime) return;
    const ageMs = Date.now() - currentState.lastMessageTime;
    if (ageMs > 15000 && currentState.status !== 'OFFLINE') {
      currentState = {
        ...currentState,
        status: 'OFFLINE',
        messageAgeMs: ageMs,
      };
      scheduleEmit();
    } else if (ageMs > 5000 && currentState.status !== 'STALE' && currentState.status !== 'OFFLINE') {
      currentState = {
        ...currentState,
        status: 'STALE',
        messageAgeMs: ageMs,
      };
      scheduleEmit();
    }
  }, 1000);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        fetchInitialBackendState();
        connectBackendSse();
        pollVenuesData();
      }
    });
  }
}

export function useBtcTideStore() {
  const [store, setStore] = useState<BtcTideStoreState>(currentState);

  useEffect(() => {
    ensureStoreStarted();
    const listener: Listener = (nextState) => {
      setStore(nextState);
    };
    listeners.add(listener);
    setStore(currentState);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const setWindow = useCallback((win: WindowOption) => {
    currentState = { ...currentState, selectedWindow: win };
    emitNow();
  }, []);

  const reconnect = useCallback(() => {
    fetchInitialBackendState();
    connectBackendSse();
    pollVenuesData();
  }, []);

  return {
    store,
    setWindow,
    reconnect,
  };
}

// ---------------------------------------------------------------------------
// Pure Selectors (Window Flow, Continuous Series, Waveform Events, Delta Bars)
// ---------------------------------------------------------------------------
export function computeWindowFlowStats(
  secondBins: SecondBin[],
  selectedWindow: WindowOption
): WindowFlowStats {
  const windowSeconds =
    selectedWindow === '1m' ? 60 : selectedWindow === '5m' ? 300 : 900;

  if (secondBins.length === 0) {
    return {
      buyVolBtc: 0,
      sellVolBtc: 0,
      buyVolUsd: 0,
      sellVolUsd: 0,
      deltaBtc: 0,
      deltaUsd: 0,
      totalVolBtc: 0,
      totalVolUsd: 0,
      tradeCount: 0,
      buyFlowPct: null,
      sellFlowPct: null,
      secondsCollected: 0,
      windowSeconds,
    };
  }

  const latestSec = secondBins[secondBins.length - 1].sec;
  const startSec = latestSec - windowSeconds + 1;

  let buyVolBtc = 0;
  let sellVolBtc = 0;
  let buyVolUsd = 0;
  let sellVolUsd = 0;
  let tradeCount = 0;
  let secondsCollected = 0;

  for (let i = 0; i < secondBins.length; i++) {
    const bin = secondBins[i];
    if (bin.sec >= startSec && bin.sec <= latestSec) {
      buyVolBtc += bin.buyVol;
      sellVolBtc += bin.sellVol;
      buyVolUsd += bin.buyUsd;
      sellVolUsd += bin.sellUsd;
      tradeCount += bin.count;
      secondsCollected += 1;
    }
  }

  const totalVolBtc = buyVolBtc + sellVolBtc;
  const totalVolUsd = buyVolUsd + sellVolUsd;
  const deltaBtc = buyVolBtc - sellVolBtc;
  const deltaUsd = buyVolUsd - sellVolUsd;

  let buyFlowPct: number | null = null;
  let sellFlowPct: number | null = null;
  if (totalVolBtc > 0) {
    buyFlowPct = Number(((buyVolBtc / totalVolBtc) * 100).toFixed(1));
    sellFlowPct = Number((100 - buyFlowPct).toFixed(1));
  }

  return {
    buyVolBtc: Number(buyVolBtc.toFixed(4)),
    sellVolBtc: Number(sellVolBtc.toFixed(4)),
    buyVolUsd: Number(buyVolUsd.toFixed(2)),
    sellVolUsd: Number(sellVolUsd.toFixed(2)),
    deltaBtc: Number(deltaBtc.toFixed(4)),
    deltaUsd: Number(deltaUsd.toFixed(2)),
    totalVolBtc: Number(totalVolBtc.toFixed(4)),
    totalVolUsd: Number(totalVolUsd.toFixed(2)),
    tradeCount,
    buyFlowPct,
    sellFlowPct,
    secondsCollected,
    windowSeconds,
  };
}

export function buildContinuousSecondSeries(
  secondBins: SecondBin[],
  maxSeconds: number
): SecondBin[] {
  if (secondBins.length === 0) return [];
  const latestSec = secondBins[secondBins.length - 1].sec;
  const earliestSec = secondBins[0].sec;
  const startSec = Math.max(earliestSec, latestSec - maxSeconds + 1);

  const lookup = new Map<number, SecondBin>();
  for (const b of secondBins) {
    lookup.set(b.sec, b);
  }

  let carryPrice = secondBins[0].lastPrice;
  for (let i = 0; i < secondBins.length; i++) {
    if (secondBins[i].sec <= startSec) {
      carryPrice = secondBins[i].lastPrice;
    } else {
      break;
    }
  }

  const result: SecondBin[] = [];
  for (let s = startSec; s <= latestSec; s++) {
    const existing = lookup.get(s);
    if (existing) {
      carryPrice = existing.lastPrice;
      result.push(existing);
    } else {
      result.push({
        sec: s,
        buyVol: 0,
        sellVol: 0,
        buyUsd: 0,
        sellUsd: 0,
        count: 0,
        openPrice: carryPrice,
        highPrice: carryPrice,
        lowPrice: carryPrice,
        lastPrice: carryPrice,
        largePrintMaxUsd: 0,
        largePrintSide: null,
      });
    }
  }

  return result;
}

export function detectWaveformEvents(series: SecondBin[]): {
  events: WaveformEventLabel[];
  rollingNet6s: number[];
  atr6s: number;
} {
  const n = series.length;
  const rollingNet6s: number[] = new Array(n).fill(0);
  if (n === 0) return { events: [], rollingNet6s, atr6s: 0 };

  const windowVols: number[] = [];
  const windowTrs: number[] = [];

  for (let i = 0; i < n; i++) {
    let buy6 = 0;
    let sell6 = 0;
    const windowStart = Math.max(0, i - 5);

    let high6 = series[windowStart].highPrice;
    let low6 = series[windowStart].lowPrice;

    for (let j = windowStart; j <= i; j++) {
      buy6 += series[j].buyVol;
      sell6 += series[j].sellVol;
      if (series[j].highPrice > high6) high6 = series[j].highPrice;
      if (series[j].lowPrice < low6) low6 = series[j].lowPrice;
    }

    rollingNet6s[i] = buy6 - sell6;
    windowVols.push(buy6 + sell6);
    windowTrs.push(high6 - low6);
  }

  const meanVol6s = windowVols.reduce((a, b) => a + b, 0) / windowVols.length;
  const rawAtr6s = windowTrs.reduce((a, b) => a + b, 0) / windowTrs.length;
  const atr6s = Math.max(rawAtr6s, 0.5);

  const heavyVolThreshold = Math.max(meanVol6s * 1.5, 0.02);
  const candidates: Array<WaveformEventLabel & { totalVol6: number; idx: number }> = [];

  for (let i = 5; i < n; i++) {
    const windowStart = i - 5;
    let buy6 = 0;
    let sell6 = 0;
    for (let j = windowStart; j <= i; j++) {
      buy6 += series[j].buyVol;
      sell6 += series[j].sellVol;
    }
    const total6 = buy6 + sell6;
    if (total6 < heavyVolThreshold) continue;

    const buyShare = buy6 / total6;
    const sellShare = sell6 / total6;
    if (buyShare < 0.7 && sellShare < 0.7) continue;

    const side: 'BUY' | 'SELL' = buyShare >= 0.7 ? 'BUY' : 'SELL';
    const flowSign = side === 'BUY' ? 1 : -1;
    const priceStart = series[windowStart].openPrice;
    const priceEnd = series[i].lastPrice;
    const priceChange = priceEnd - priceStart;

    const sameWayMove = priceChange * flowSign;
    const againstMove = -sameWayMove;

    if (sameWayMove >= 0.5 * atr6s) {
      candidates.push({
        sec: series[i].sec,
        type: 'DRIVE',
        side,
        price: series[i].lastPrice,
        netVolBtc: Number(rollingNet6s[i].toFixed(4)),
        priceChange,
        atr6s,
        totalVol6: total6,
        idx: i,
      });
    } else if (againstMove < 0.5 * atr6s) {
      candidates.push({
        sec: series[i].sec,
        type: 'ABSORB',
        side,
        price: series[i].lastPrice,
        netVolBtc: Number(rollingNet6s[i].toFixed(4)),
        priceChange,
        atr6s,
        totalVol6: total6,
        idx: i,
      });
    }
  }

  const filtered: WaveformEventLabel[] = [];
  let i = 0;
  while (i < candidates.length) {
    let best = candidates[i];
    let j = i + 1;
    while (j < candidates.length && candidates[j].sec - best.sec <= 5) {
      if (candidates[j].totalVol6 > best.totalVol6) best = candidates[j];
      j++;
    }
    filtered.push({
      sec: best.sec,
      type: best.type,
      side: best.side,
      price: best.price,
      netVolBtc: best.netVolBtc,
      priceChange: best.priceChange,
      atr6s: best.atr6s,
    });
    i = j;
  }

  return { events: filtered, rollingNet6s, atr6s };
}

export function computeTenSecDeltaBars(secondBins: SecondBin[]): TenSecDeltaBar[] {
  if (secondBins.length === 0) return [];
  const latestSec = secondBins[secondBins.length - 1].sec;
  const earliestSec = secondBins[0].sec;
  const latestBucket = Math.floor(latestSec / 10) * 10;
  const earliestBucket = Math.floor(earliestSec / 10) * 10;
  const startBucket = Math.max(earliestBucket, latestBucket - 290);

  const bucketMap = new Map<number, TenSecDeltaBar>();
  for (let i = 0; i < secondBins.length; i++) {
    const b = secondBins[i];
    if (b.sec < startBucket) continue;
    const bucket = Math.floor(b.sec / 10) * 10;
    const existing = bucketMap.get(bucket);
    if (existing) {
      existing.buyVol += b.buyVol;
      existing.sellVol += b.sellVol;
      existing.deltaBtc += b.buyVol - b.sellVol;
      existing.deltaUsd += b.buyUsd - b.sellUsd;
      existing.count += b.count;
      existing.lastPrice = b.lastPrice;
    } else {
      bucketMap.set(bucket, {
        bucketSec: bucket,
        buyVol: b.buyVol,
        sellVol: b.sellVol,
        deltaBtc: b.buyVol - b.sellVol,
        deltaUsd: b.buyUsd - b.sellUsd,
        count: b.count,
        lastPrice: b.lastPrice,
      });
    }
  }

  const result: TenSecDeltaBar[] = [];
  for (let b = startBucket; b <= latestBucket; b += 10) {
    const item = bucketMap.get(b);
    if (item) {
      result.push({
        ...item,
        buyVol: Number(item.buyVol.toFixed(4)),
        sellVol: Number(item.sellVol.toFixed(4)),
        deltaBtc: Number(item.deltaBtc.toFixed(4)),
        deltaUsd: Number(item.deltaUsd.toFixed(2)),
      });
    }
  }

  return result;
}
