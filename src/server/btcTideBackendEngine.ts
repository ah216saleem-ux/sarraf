import WebSocket from 'ws';
import {
  SecondBin,
  AggTrade,
  OrderBookDepth,
  OrderBookWall,
  PerpPositioning,
  PerpFieldSources,
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
  recordAndComputeOiHistory,
} from './btcTideSqliteDatabase.ts';
import {
  notifyNewBtcTideSignal,
  notifyBtcTideTpHit,
  notifyBtcTideBreakevenMove,
  notifyBtcTideSlHit,
  notifyBtcTideExpiry,
} from './btcTideTelegramNotifier.ts';
import type { Response } from 'express';

// ---------------------------------------------------------------------------
// 4-Tier Spot Trades Ingestion Hierarchy
// Order Book uses ONLY partial-book snapshot stream btcusdt@depth20@100ms
// ---------------------------------------------------------------------------
export type SpotSourceId = 'binance_primary' | 'binance_vision' | 'bybit' | 'okx';

interface SpotSourceConfig {
  id: SpotSourceId;
  name: string;
  label: string;
  priority: number;
  wsUrl: string;
}

const SPOT_SOURCES: SpotSourceConfig[] = [
  {
    id: 'binance_primary',
    name: 'Binance Primary',
    label: 'Binance',
    priority: 1,
    wsUrl: 'wss://stream.binance.com:9443/stream?streams=btcusdt@aggTrade/btcusdt@depth20@100ms',
  },
  {
    id: 'binance_vision',
    name: 'Binance Vision (Mirror)',
    label: 'Binance (Mirror)',
    priority: 2,
    wsUrl: 'wss://data-stream.binance.vision/stream?streams=btcusdt@aggTrade/btcusdt@depth20@100ms',
  },
  {
    id: 'bybit',
    name: 'Bybit v5 Spot',
    label: 'Bybit',
    priority: 3,
    wsUrl: 'wss://stream.bybit.com/v5/public/spot',
  },
  {
    id: 'okx',
    name: 'OKX Spot',
    label: 'OKX',
    priority: 4,
    wsUrl: 'wss://ws.okx.com:8443/ws/v5/public',
  },
];

const BINANCE_FUTURES_WS =
  'wss://fstream.binance.com/stream?streams=btcusdt@markPrice@1s/btcusdt@forceOrder';
const BYBIT_LINEAR_WS = 'wss://stream.bybit.com/v5/public/linear';

export interface UpstreamHealthItem {
  id: string;
  name: string;
  type: 'WEBSOCKET' | 'REST';
  endpoint: string;
  status: 'ONLINE' | 'ERROR' | 'DISCONNECTED' | 'CONNECTING';
  lastHttpStatusOrWsCloseCode: number | null;
  lastSuccessTime: number | null;
  lastSuccessIso: string | null;
  lastErrorTime: number | null;
  lastErrorText: string | null;
  latencyMs: number | null;
}

export interface FieldDiagnosticItem {
  section: 'ORDER_BOOK' | 'PERPS' | 'VENUES';
  field: string;
  activeSource: string;
  status: 'OK' | 'BUILDING' | 'UNAVAILABLE';
  reason: string | null;
}

export interface ServerRegionInfo {
  ip: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  org: string;
  timezone: string;
  detectedAt: number;
}

export interface BtcTideBackendState {
  activeSource: string;
  status: BtcFeedStatus;
  statusText: string;
  currentPrice: number | null;
  priceFlash: 'up' | 'down' | 'none';
  lastMessageTime: number | null;
  messageAgeMs: number;
  feedAges: {
    spot: number;
    book: number;
    perps: number;
    venues: number;
  };
  feedSources: {
    spot: string;
    book: string;
    perps: string;
    venues: string;
  };
  feedStale: {
    spot: boolean;
    book: boolean;
    perps: boolean;
    venues: boolean;
  };
  geoBlockedNotice: string | null;
  bookTicker: {
    bid: number | null;
    ask: number | null;
    spread: number | null;
    spreadBps: number | null;
  };
  depth: OrderBookDepth;
  perp: PerpPositioning;
  venues: VenuesTableData;
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
let allLiquidationsList: LiquidationItem[] = [];

let activeSourceId: SpotSourceId = 'binance_primary';
let activeSourceLabel = 'Binance';
let activeBookSourceLabel = 'Binance depth20@100ms';
let feedStatus: BtcFeedStatus = 'CONNECTING';

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
  bestBid: null,
  bestAsk: null,
  midPrice: null,
  bidTotal: 0,
  askTotal: 0,
  bidUsd10: 0,
  askUsd10: 0,
  imbalancePct: null,
  avgLevelSizeBtc: 0,
  walls: [],
  spread: null,
  spreadBps: null,
  updatedAt: 0,
};

let perpSources: PerpFieldSources = {
  markPrice: 'Binance FAPI',
  funding: 'Binance FAPI',
  basis: 'Binance FAPI',
  openInterest: 'Binance FAPI',
  longShort: 'Binance FAPI',
  liquidations: 'OKX SWAP',
};

let perp: PerpPositioning = {
  markPrice: null,
  fundingRate: null,
  nextFundingTime: null,
  openInterest: null,
  oiChange1h: null,
  oiChange1hPct: null,
  oiHistoryStatus: 'building 0m/60m',
  oiHistoryMinutes: 0,
  basis: null,
  basisBps: null,
  longShortRatio: null,
  longAccountPct: null,
  shortAccountPct: null,
  liquidations5m: [],
  recentLiquidations: [],
  totalLiq5mUsd: 0,
  longLiq5mUsd: 0,
  shortLiq5mUsd: 0,
  sources: perpSources,
  status: 'CONNECTING',
  updatedAt: 0,
};

let venues: VenuesTableData = {
  venues: [],
  medianPrice: null,
  spread: null,
  highestVenue: null,
  lowestVenue: null,
  totalVolumeBtc: 0,
  updatedAt: 0,
};

const fieldReasons = new Map<string, string>();

// Feed Timestamps for Staleness
let lastTradesTime: number | null = null;
let lastBookTime: number | null = null;
let lastPerpsTime: number | null = null;
let lastVenuesTime: number | null = null;
let geoBlockedNotice: string | null = null;
let isBinanceGeoBlocked = false;

interface SourceRuntimeState {
  ws: WebSocket | null;
  lastMessageTime: number | null;
  lastTradeTime: number | null;
  lastBookTime: number | null;
  healthySince: number | null;
  isGeoBlocked: boolean;
  reconnectTimer: NodeJS.Timeout | null;
}

const sourceStates = new Map<SpotSourceId, SourceRuntimeState>([
  ['binance_primary', { ws: null, lastMessageTime: null, lastTradeTime: null, lastBookTime: null, healthySince: null, isGeoBlocked: false, reconnectTimer: null }],
  ['binance_vision', { ws: null, lastMessageTime: null, lastTradeTime: null, lastBookTime: null, healthySince: null, isGeoBlocked: false, reconnectTimer: null }],
  ['bybit', { ws: null, lastMessageTime: null, lastTradeTime: null, lastBookTime: null, healthySince: null, isGeoBlocked: false, reconnectTimer: null }],
  ['okx', { ws: null, lastMessageTime: null, lastTradeTime: null, lastBookTime: null, healthySince: null, isGeoBlocked: false, reconnectTimer: null }],
]);

let binanceFuturesWs: WebSocket | null = null;
let bybitLinearWs: WebSocket | null = null;

// Server Region & Upstreams Health Telemetry
let serverRegion: ServerRegionInfo = {
  ip: '--',
  country: '--',
  countryCode: '--',
  region: '--',
  city: '--',
  org: '--',
  timezone: '--',
  detectedAt: 0,
};

const upstreamsMap = new Map<string, UpstreamHealthItem>([
  [
    'binance_spot_ws',
    {
      id: 'binance_spot_ws',
      name: 'Binance Spot WS (aggTrade + depth20@100ms)',
      type: 'WEBSOCKET',
      endpoint: 'wss://stream.binance.com:9443/stream?streams=btcusdt@aggTrade/btcusdt@depth20@100ms',
      status: 'CONNECTING',
      lastHttpStatusOrWsCloseCode: null,
      lastSuccessTime: null,
      lastSuccessIso: null,
      lastErrorTime: null,
      lastErrorText: null,
      latencyMs: null,
    },
  ],
  [
    'binance_vision_ws',
    {
      id: 'binance_vision_ws',
      name: 'Binance Vision WS (Mirror aggTrade + depth20@100ms)',
      type: 'WEBSOCKET',
      endpoint: 'wss://data-stream.binance.vision/stream?streams=btcusdt@aggTrade/btcusdt@depth20@100ms',
      status: 'ONLINE',
      lastHttpStatusOrWsCloseCode: null,
      lastSuccessTime: null,
      lastSuccessIso: null,
      lastErrorTime: null,
      lastErrorText: null,
      latencyMs: null,
    },
  ],
  [
    'bybit_ws',
    {
      id: 'bybit_ws',
      name: 'Bybit v5 Spot WS (Trades Fallback 1)',
      type: 'WEBSOCKET',
      endpoint: 'wss://stream.bybit.com/v5/public/spot',
      status: 'CONNECTING',
      lastHttpStatusOrWsCloseCode: null,
      lastSuccessTime: null,
      lastSuccessIso: null,
      lastErrorTime: null,
      lastErrorText: null,
      latencyMs: null,
    },
  ],
  [
    'okx_ws',
    {
      id: 'okx_ws',
      name: 'OKX Spot WS (Trades Fallback 2)',
      type: 'WEBSOCKET',
      endpoint: 'wss://ws.okx.com:8443/ws/v5/public',
      status: 'CONNECTING',
      lastHttpStatusOrWsCloseCode: null,
      lastSuccessTime: null,
      lastSuccessIso: null,
      lastErrorTime: null,
      lastErrorText: null,
      latencyMs: null,
    },
  ],
  [
    'binance_futures_ws',
    {
      id: 'binance_futures_ws',
      name: 'Binance Futures WS (markPrice@1s / forceOrder)',
      type: 'WEBSOCKET',
      endpoint: 'wss://fstream.binance.com/stream?streams=btcusdt@markPrice@1s/forceOrder',
      status: 'CONNECTING',
      lastHttpStatusOrWsCloseCode: null,
      lastSuccessTime: null,
      lastSuccessIso: null,
      lastErrorTime: null,
      lastErrorText: null,
      latencyMs: null,
    },
  ],
  [
    'bybit_linear_ws',
    {
      id: 'bybit_linear_ws',
      name: 'Bybit Linear WS (allLiquidation.BTCUSDT)',
      type: 'WEBSOCKET',
      endpoint: 'wss://stream.bybit.com/v5/public/linear',
      status: 'CONNECTING',
      lastHttpStatusOrWsCloseCode: null,
      lastSuccessTime: null,
      lastSuccessIso: null,
      lastErrorTime: null,
      lastErrorText: null,
      latencyMs: null,
    },
  ],
  [
    'binance_fapi_rest',
    {
      id: 'binance_fapi_rest',
      name: 'Binance FAPI REST (Mark / Funding / OI / L-S)',
      type: 'REST',
      endpoint: 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT',
      status: 'CONNECTING',
      lastHttpStatusOrWsCloseCode: null,
      lastSuccessTime: null,
      lastSuccessIso: null,
      lastErrorTime: null,
      lastErrorText: null,
      latencyMs: null,
    },
  ],
  [
    'okx_rest',
    {
      id: 'okx_rest',
      name: 'OKX Perp & Spot REST (Mark / Funding / OI / L-S / Liq)',
      type: 'REST',
      endpoint: 'https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=BTC-USDT-SWAP',
      status: 'CONNECTING',
      lastHttpStatusOrWsCloseCode: null,
      lastSuccessTime: null,
      lastSuccessIso: null,
      lastErrorTime: null,
      lastErrorText: null,
      latencyMs: null,
    },
  ],
  [
    'bybit_rest',
    {
      id: 'bybit_rest',
      name: 'Bybit Spot & Linear REST',
      type: 'REST',
      endpoint: 'https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT',
      status: 'CONNECTING',
      lastHttpStatusOrWsCloseCode: null,
      lastSuccessTime: null,
      lastSuccessIso: null,
      lastErrorTime: null,
      lastErrorText: null,
      latencyMs: null,
    },
  ],
  [
    'hyperliquid',
    {
      id: 'hyperliquid',
      name: 'Hyperliquid metaAndAssetCtxs REST',
      type: 'REST',
      endpoint: 'https://api.hyperliquid.xyz/info',
      status: 'CONNECTING',
      lastHttpStatusOrWsCloseCode: null,
      lastSuccessTime: null,
      lastSuccessIso: null,
      lastErrorTime: null,
      lastErrorText: null,
      latencyMs: null,
    },
  ],
  [
    'coinbase_rest',
    {
      id: 'coinbase_rest',
      name: 'Coinbase Exchange BTC-USD REST',
      type: 'REST',
      endpoint: 'https://api.exchange.coinbase.com/products/BTC-USD/stats',
      status: 'CONNECTING',
      lastHttpStatusOrWsCloseCode: null,
      lastSuccessTime: null,
      lastSuccessIso: null,
      lastErrorTime: null,
      lastErrorText: null,
      latencyMs: null,
    },
  ],
  [
    'deribit',
    {
      id: 'deribit',
      name: 'Deribit Index REST',
      type: 'REST',
      endpoint: 'https://www.deribit.com/api/v2/public/get_index_price?index_name=btc_usd',
      status: 'CONNECTING',
      lastHttpStatusOrWsCloseCode: null,
      lastSuccessTime: null,
      lastSuccessIso: null,
      lastErrorTime: null,
      lastErrorText: null,
      latencyMs: null,
    },
  ],
  [
    'venue_tickers',
    {
      id: 'venue_tickers',
      name: 'Venue Tickers (9 Exchanges Aggregator)',
      type: 'REST',
      endpoint: 'https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BTC_USDT',
      status: 'CONNECTING',
      lastHttpStatusOrWsCloseCode: null,
      lastSuccessTime: null,
      lastSuccessIso: null,
      lastErrorTime: null,
      lastErrorText: null,
      latencyMs: null,
    },
  ],
]);

export function recordUpstreamSuccess(id: string, code = 200, latencyMs: number | null = null) {
  const item = upstreamsMap.get(id);
  if (!item) return;
  const now = Date.now();
  item.status = 'ONLINE';
  item.lastHttpStatusOrWsCloseCode = code;
  item.lastSuccessTime = now;
  item.lastSuccessIso = new Date(now).toISOString();
  item.lastErrorText = null;
  if (latencyMs !== null) item.latencyMs = latencyMs;
}

export function recordUpstreamError(id: string, code: number | null, errorText: string) {
  const item = upstreamsMap.get(id);
  if (!item) return;
  item.status = 'ERROR';
  if (code !== null) item.lastHttpStatusOrWsCloseCode = code;
  item.lastErrorTime = Date.now();
  item.lastErrorText = errorText;

  if (
    (id === 'binance_spot_ws' || id === 'binance_vision_ws' || id === 'binance_futures_ws' || id === 'binance_fapi_rest') &&
    (code === 451 || code === 403 || errorText.includes('451') || errorText.includes('403'))
  ) {
    handleBinanceGeoBlock(code || 451, errorText);
  }
}

export function recordUpstreamClose(id: string, closeCode: number, reason: string) {
  const item = upstreamsMap.get(id);
  if (!item) return;
  item.status = 'DISCONNECTED';
  item.lastHttpStatusOrWsCloseCode = closeCode;
  item.lastErrorTime = Date.now();
  item.lastErrorText = reason || `WebSocket closed with code ${closeCode}`;

  if (closeCode === 451 || closeCode === 403 || reason.includes('451') || reason.includes('403')) {
    handleBinanceGeoBlock(closeCode, reason);
  }
}

function handleBinanceGeoBlock(code: number, detail: string) {
  if (isBinanceGeoBlocked) return;
  isBinanceGeoBlocked = true;
  geoBlockedNotice = `Server region (${serverRegion.country || 'Restricted'}) returned HTTP ${code} from Binance (Legal/Jurisdiction Restriction). Ingestion automatically routed to fallback.`;
  console.warn(`[BTC TIDE GEO-BLOCK] ${geoBlockedNotice} (Detail: ${detail})`);

  const pState = sourceStates.get('binance_primary');
  if (pState) pState.isGeoBlocked = true;

  switchActiveSource('binance_vision', `Binance Primary returned HTTP ${code}`);
}

export async function detectServerRegion(): Promise<ServerRegionInfo> {
  const sources = [
    'https://ipwho.is/',
    'https://ipapi.co/json/',
    'http://ip-api.com/json',
  ];
  for (const src of sources) {
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const d = await res.json();
        const ip = d.ip || d.query || '--';
        const country = d.country || d.country_name || '--';
        const countryCode = d.country_code || d.countryCode || '--';
        const region = d.region || d.region_name || d.regionName || '--';
        const city = d.city || '--';
        const org = d.connection?.org || d.org || d.isp || '--';
        const timezone = d.timezone?.id || d.timezone || '--';

        serverRegion = {
          ip,
          country,
          countryCode,
          region,
          city,
          org,
          timezone,
          detectedAt: Date.now(),
        };

        console.log(
          `[BTC TIDE SERVER REGION] Public IP: ${ip}, Country: ${country} (${countryCode}), Region: ${region}, Org: ${org}`
        );
        return serverRegion;
      }
    } catch {}
  }
  return serverRegion;
}

// ---------------------------------------------------------------------------
// SSE Clients & Broadcasting
// ---------------------------------------------------------------------------
const sseClients = new Set<Response>();
let broadcastTimer: NodeJS.Timeout | null = null;
let isBackendEngineStarted = false;
let engineWatchdogTimer: NodeJS.Timeout | null = null;
let perpsFastPollTimer: NodeJS.Timeout | null = null;
let perpsOiPollTimer: NodeJS.Timeout | null = null;
let venuesPollTimer: NodeJS.Timeout | null = null;

export function registerSseClient(res: Response): () => void {
  sseClients.add(res);
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

function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastSse();
  }, 120);
}

// ---------------------------------------------------------------------------
// 1. Trade & Partial-Book Snapshot Processing (btcusdt@depth20@100ms ONLY)
// ---------------------------------------------------------------------------
function handleTradeTick(
  sourceId: SpotSourceId,
  tradeId: string,
  price: number,
  qty: number,
  usdValue: number,
  aggressorSide: 'BUY' | 'SELL',
  tradeTime: number
) {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) return;

  const now = Date.now();
  const sState = sourceStates.get(sourceId);
  if (sState) {
    sState.lastMessageTime = now;
    sState.lastTradeTime = now;
    if (!sState.healthySince) sState.healthySince = now;
  }

  if (sourceId !== activeSourceId) {
    return;
  }

  lastTradesTime = now;
  feedStatus = 'LIVE';
  ticksSeen += 1;
  if (!firstTickTime) firstTickTime = now;

  if (sessionHigh === null || price > sessionHigh) sessionHigh = price;
  if (sessionLow === null || price < sessionLow) sessionLow = price;

  if (prevPrice !== null && price !== prevPrice) {
    priceFlash = price > prevPrice ? 'up' : 'down';
  }
  prevPrice = price;
  currentPrice = price;

  // Keep perp basis updated in real time as spot moves
  if (perp.markPrice && perp.markPrice > 0) {
    const basis = Number((perp.markPrice - price).toFixed(2));
    const basisBps = Number(((basis / price) * 10000).toFixed(2));
    perp = { ...perp, basis, basisBps };
  }

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

  const oldestAllowed = sec - MAX_BINS_RETENTION_SEC;
  for (const k of binsMap.keys()) {
    if (k < oldestAllowed) binsMap.delete(k);
  }

  if (currentActiveTrade) {
    const deviation = Math.abs(currentActiveTrade.entryPrice - price) / price;
    if (deviation > 0.02) {
      console.warn(
        `[BTC TIDE SAFETY] Active trade ${currentActiveTrade.id} entry price $${currentActiveTrade.entryPrice} deviates ${(deviation * 100).toFixed(2)}% from live price $${price.toFixed(2)} (> 2%). Voiding trade.`
      );
      currentActiveTrade = null;
      return;
    }

    const prevTp1 = currentActiveTrade.tp1Hit;
    const prevTp2 = currentActiveTrade.tp2Hit;

    const { updatedTrade, closed } = evaluateActiveTradeTick(currentActiveTrade, price, now);
    currentActiveTrade = updatedTrade;

    if (!prevTp1 && updatedTrade.tp1Hit) {
      lastSignalTime = now; // Start 1-2h BTC cooldown from TP1 hit
      notifyBtcTideTpHit(updatedTrade, 1, price);
      notifyBtcTideBreakevenMove(updatedTrade);
    } else if (!prevTp2 && updatedTrade.tp2Hit) {
      notifyBtcTideTpHit(updatedTrade, 2, price);
    }

    if (closed) {
      lastSignalTime = now; // Ensure 1-2h BTC cooldown runs after trade completion
      currentActiveTrade = null;
      currentClosedTrades = [
        updatedTrade,
        ...currentClosedTrades.filter((t) => t.id !== updatedTrade.id),
      ].slice(0, 300);
      saveTradeToSqlite(updatedTrade, price);

      if (updatedTrade.outcome === 'TP3') {
        notifyBtcTideTpHit(updatedTrade, 3, price);
      } else if (updatedTrade.outcome === 'SL' || updatedTrade.outcome === 'TP1+BE') {
        notifyBtcTideSlHit(updatedTrade, price);
      } else if (updatedTrade.outcome === 'EXPIRED') {
        notifyBtcTideExpiry(updatedTrade, price);
      }
    } else {
      saveTradeToSqlite(updatedTrade, price);
    }
  }

  scheduleBroadcast();
}

/**
 * Replaces the entire order book atomically from a btcusdt@depth20@100ms partial-book snapshot.
 * Never merges with bookTicker and never applies diff/delta streams without a full snapshot.
 */
function replaceOrderBookFromDepth20Snapshot(
  sourceId: 'binance_primary' | 'binance_vision' | 'binance_rest',
  rawBids: any[],
  rawAsks: any[]
) {
  const now = Date.now();
  if (sourceId === 'binance_primary' || sourceId === 'binance_vision') {
    const sState = sourceStates.get(sourceId);
    if (sState) {
      sState.lastMessageTime = now;
      sState.lastBookTime = now;
    }
    // Prefer primary if active, otherwise accept mirror if primary book is silent > 2s
    const primaryBookTime = sourceStates.get('binance_primary')?.lastBookTime || 0;
    if (sourceId === 'binance_vision' && now - primaryBookTime < 2000) {
      return;
    }
  }

  const parsedBids: { price: number; qty: number; usd: number }[] = [];
  const parsedAsks: { price: number; qty: number; usd: number }[] = [];

  for (const row of rawBids) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const p = parseFloat(row[0]);
    const q = parseFloat(row[1]);
    if (Number.isFinite(p) && p > 0 && Number.isFinite(q) && q > 0) {
      parsedBids.push({ price: p, qty: q, usd: p * q });
    }
  }

  for (const row of rawAsks) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const p = parseFloat(row[0]);
    const q = parseFloat(row[1]);
    if (Number.isFinite(p) && p > 0 && Number.isFinite(q) && q > 0) {
      parsedAsks.push({ price: p, qty: q, usd: p * q });
    }
  }

  // Require at least 8 valid rows per side for a valid depth20 snapshot
  if (parsedBids.length < 8 || parsedAsks.length < 8) {
    return;
  }

  // Sort bids descending (highest price first) and asks ascending (lowest price first)
  parsedBids.sort((a, b) => b.price - a.price);
  parsedAsks.sort((a, b) => a.price - b.price);

  // 1. Compute average level size across the snapshot (up to 20 bids + 20 asks)
  const top20Bids = parsedBids.slice(0, 20);
  const top20Asks = parsedAsks.slice(0, 20);
  const allLevelsCount = top20Bids.length + top20Asks.length;
  const totalSnapshotBtc =
    top20Bids.reduce((s, l) => s + l.qty, 0) + top20Asks.reduce((s, l) => s + l.qty, 0);
  const avgLevelSizeBtc = allLevelsCount > 0 ? totalSnapshotBtc / allLevelsCount : 0;
  const wallThresholdBtc = avgLevelSizeBtc * 5;

  // 2. Detect walls (> 5x average level size)
  const walls: OrderBookWall[] = [];
  for (const b of top20Bids) {
    if (avgLevelSizeBtc > 0 && b.qty > wallThresholdBtc) {
      walls.push({
        side: 'BID',
        price: b.price,
        qty: Number(b.qty.toFixed(4)),
        usdValue: Math.round(b.usd),
        multipleOfAvg: Number((b.qty / avgLevelSizeBtc).toFixed(1)),
      });
    }
  }
  for (const a of top20Asks) {
    if (avgLevelSizeBtc > 0 && a.qty > wallThresholdBtc) {
      walls.push({
        side: 'ASK',
        price: a.price,
        qty: Number(a.qty.toFixed(4)),
        usdValue: Math.round(a.usd),
        multipleOfAvg: Number((a.qty / avgLevelSizeBtc).toFixed(1)),
      });
    }
  }
  walls.sort((a, b) => b.qty - a.qty);

  // 3. Compute Top 10 levels USD notional imbalance: (bidUSD - askUSD) / (bidUSD + askUSD)
  const top10Bids = parsedBids.slice(0, 10);
  const top10Asks = parsedAsks.slice(0, 10);
  const bidUsd10 = top10Bids.reduce((s, l) => s + l.usd, 0);
  const askUsd10 = top10Asks.reduce((s, l) => s + l.usd, 0);
  const totalUsd10 = bidUsd10 + askUsd10;
  const imbalancePct =
    totalUsd10 > 0 ? Number((((bidUsd10 - askUsd10) / totalUsd10) * 100).toFixed(1)) : 0;

  // 4. Build Top 8 rows per side with cumulative BTC size and depth bar %
  let bidCum = 0;
  let askCum = 0;
  const topBids: DepthLevel[] = [];
  const topAsks: DepthLevel[] = [];

  for (let i = 0; i < 8; i++) {
    const b = parsedBids[i];
    bidCum += b.qty;
    const mult = avgLevelSizeBtc > 0 ? b.qty / avgLevelSizeBtc : 0;
    topBids.push({
      price: b.price,
      qty: Number(b.qty.toFixed(4)),
      total: Number(bidCum.toFixed(4)),
      depthPct: 0,
      usdValue: Math.round(b.usd),
      isWall: mult > 5,
      multipleOfAvg: Number(mult.toFixed(1)),
    });

    const a = parsedAsks[i];
    askCum += a.qty;
    const askMult = avgLevelSizeBtc > 0 ? a.qty / avgLevelSizeBtc : 0;
    topAsks.push({
      price: a.price,
      qty: Number(a.qty.toFixed(4)),
      total: Number(askCum.toFixed(4)),
      depthPct: 0,
      usdValue: Math.round(a.usd),
      isWall: askMult > 5,
      multipleOfAvg: Number(askMult.toFixed(1)),
    });
  }

  const maxCum = Math.max(bidCum, askCum, 0.0001);
  topBids.forEach((b) => {
    b.depthPct = Number(Math.min(100, Math.max(4, (b.total / maxCum) * 100)).toFixed(1));
  });
  topAsks.forEach((a) => {
    a.depthPct = Number(Math.min(100, Math.max(4, (a.total / maxCum) * 100)).toFixed(1));
  });

  const bestBid = topBids[0].price;
  const bestAsk = topAsks[0].price;
  const midPrice = Number(((bestBid + bestAsk) / 2).toFixed(2));
  const spread = Number((bestAsk - bestBid).toFixed(2));
  const spreadBps = Number(((spread / midPrice) * 10000).toFixed(2));

  lastBookTime = now;
  activeBookSourceLabel =
    sourceId === 'binance_primary'
      ? 'Binance btcusdt@depth20@100ms'
      : sourceId === 'binance_vision'
      ? 'Binance Vision btcusdt@depth20@100ms'
      : 'Binance Depth20 Snapshot';

  bookTicker = {
    bid: bestBid,
    ask: bestAsk,
    spread,
    spreadBps,
  };

  depth = {
    bids: topBids,
    asks: topAsks,
    bestBid,
    bestAsk,
    midPrice,
    bidTotal: Number(bidCum.toFixed(4)),
    askTotal: Number(askCum.toFixed(4)),
    bidUsd10: Math.round(bidUsd10),
    askUsd10: Math.round(askUsd10),
    imbalancePct,
    avgLevelSizeBtc: Number(avgLevelSizeBtc.toFixed(4)),
    walls: walls.slice(0, 6),
    spread,
    spreadBps,
    updatedAt: now,
  };

  fieldReasons.delete('ORDER_BOOK:depth20');
  scheduleBroadcast();
}

// ---------------------------------------------------------------------------
// 2. WebSocket Connections
// ---------------------------------------------------------------------------

// A. Binance Spot (Primary & Vision Mirror): aggTrade + depth20@100ms ONLY
function connectBinanceWs(sourceId: 'binance_primary' | 'binance_vision') {
  const conf = SPOT_SOURCES.find((s) => s.id === sourceId)!;
  const sState = sourceStates.get(sourceId)!;

  if (sState.ws) {
    try {
      sState.ws.close();
    } catch {}
    sState.ws = null;
  }

  const upstreamKey = sourceId === 'binance_primary' ? 'binance_spot_ws' : 'binance_vision_ws';

  try {
    const ws = new WebSocket(conf.wsUrl);
    sState.ws = ws;

    ws.on('open', () => {
      console.log(`[BTC TIDE BACKEND] Connected to ${conf.name}`);
      sState.healthySince = Date.now();
    });

    ws.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        const stream = payload.stream;
        const data = payload.data;
        recordUpstreamSuccess(upstreamKey, 1000);

        if (stream === 'btcusdt@aggTrade') {
          const tradeTime = Number(data.T || data.E || Date.now());
          const price = parseFloat(data.p);
          const qty = parseFloat(data.q);
          const usdValue = price * qty;
          const aggressorSide = data.m ? 'SELL' : 'BUY';
          const tradeId = String(data.a || `${tradeTime}_${ticksSeen}`);
          handleTradeTick(sourceId, tradeId, price, qty, usdValue, aggressorSide, tradeTime);
        } else if (stream === 'btcusdt@depth20@100ms') {
          const rawBids = Array.isArray(data.bids) ? data.bids : [];
          const rawAsks = Array.isArray(data.asks) ? data.asks : [];
          replaceOrderBookFromDepth20Snapshot(sourceId, rawBids, rawAsks);
        }
      } catch {}
    });

    ws.on('error', (err) => {
      console.warn(`[BTC TIDE BACKEND] ${conf.name} error:`, err.message);
      recordUpstreamError(upstreamKey, null, err.message);
      sState.healthySince = null;
    });

    ws.on('close', (code, reason) => {
      const reasonStr = reason?.toString() || `${conf.name} closed`;
      recordUpstreamClose(upstreamKey, code, reasonStr);
      sState.healthySince = null;
      if (!sState.reconnectTimer) {
        sState.reconnectTimer = setTimeout(() => {
          sState.reconnectTimer = null;
          connectBinanceWs(sourceId);
        }, 3000);
      }
    });
  } catch (err: any) {
    recordUpstreamError(upstreamKey, null, err.message);
    sState.healthySince = null;
  }
}

// B. Bybit v5 Spot WS (Trades Fallback 1 — no delta book stream!)
function connectBybitWs() {
  const sState = sourceStates.get('bybit')!;
  if (sState.ws) {
    try {
      sState.ws.close();
    } catch {}
    sState.ws = null;
  }

  try {
    const ws = new WebSocket(SPOT_SOURCES.find((s) => s.id === 'bybit')!.wsUrl);
    sState.ws = ws;

    ws.on('open', () => {
      console.log('[BTC TIDE BACKEND] Connected to Bybit v5 Spot WS');
      sState.healthySince = Date.now();
      ws.send(
        JSON.stringify({
          op: 'subscribe',
          args: ['publicTrade.BTCUSDT'],
        })
      );
    });

    ws.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        const topic = payload.topic;
        const data = payload.data;
        if (topic === 'publicTrade.BTCUSDT' && Array.isArray(data)) {
          recordUpstreamSuccess('bybit_ws', 1000);
          for (const t of data) {
            const price = parseFloat(t.p);
            const qty = parseFloat(t.v);
            const usdValue = price * qty;
            const aggressorSide = t.S === 'Buy' ? 'BUY' : 'SELL';
            const tradeTime = Number(t.T || Date.now());
            const tradeId = `bybit_${t.i || tradeTime}_${ticksSeen}`;
            handleTradeTick('bybit', tradeId, price, qty, usdValue, aggressorSide, tradeTime);
          }
        }
      } catch {}
    });

    ws.on('error', (err) => {
      recordUpstreamError('bybit_ws', null, err.message);
      sState.healthySince = null;
    });

    ws.on('close', (code, reason) => {
      recordUpstreamClose('bybit_ws', code, reason?.toString() || 'Bybit WS closed');
      sState.healthySince = null;
      if (!sState.reconnectTimer) {
        sState.reconnectTimer = setTimeout(() => {
          sState.reconnectTimer = null;
          connectBybitWs();
        }, 3500);
      }
    });
  } catch (err: any) {
    recordUpstreamError('bybit_ws', null, err.message);
    sState.healthySince = null;
  }
}

// C. OKX Spot WS (Trades Fallback 2)
function connectOkxWs() {
  const sState = sourceStates.get('okx')!;
  if (sState.ws) {
    try {
      sState.ws.close();
    } catch {}
    sState.ws = null;
  }

  try {
    const ws = new WebSocket(SPOT_SOURCES.find((s) => s.id === 'okx')!.wsUrl);
    sState.ws = ws;

    ws.on('open', () => {
      console.log('[BTC TIDE BACKEND] Connected to OKX Spot WS');
      sState.healthySince = Date.now();
      ws.send(
        JSON.stringify({
          op: 'subscribe',
          args: [{ channel: 'trades', instId: 'BTC-USDT' }],
        })
      );
    });

    ws.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        const channel = payload.arg?.channel;
        const data = payload.data;
        if (channel === 'trades' && Array.isArray(data)) {
          recordUpstreamSuccess('okx_ws', 1000);
          for (const t of data) {
            const price = parseFloat(t.px);
            const qty = parseFloat(t.sz);
            const usdValue = price * qty;
            const aggressorSide = t.side === 'buy' ? 'BUY' : 'SELL';
            const tradeTime = Number(t.ts || Date.now());
            const tradeId = `okx_${t.tradeId || tradeTime}_${ticksSeen}`;
            handleTradeTick('okx', tradeId, price, qty, usdValue, aggressorSide, tradeTime);
          }
        }
      } catch {}
    });

    ws.on('error', (err) => {
      recordUpstreamError('okx_ws', null, err.message);
      sState.healthySince = null;
    });

    ws.on('close', (code, reason) => {
      recordUpstreamClose('okx_ws', code, reason?.toString() || 'OKX WS closed');
      sState.healthySince = null;
      if (!sState.reconnectTimer) {
        sState.reconnectTimer = setTimeout(() => {
          sState.reconnectTimer = null;
          connectOkxWs();
        }, 4000);
      }
    });
  } catch (err: any) {
    recordUpstreamError('okx_ws', null, err.message);
    sState.healthySince = null;
  }
}

// Helper to ingest a liquidation event (deduplicated) and recompute 5m totals + last 10 events
function recordLiquidationEvent(
  id: string,
  time: number,
  side: 'BUY' | 'SELL',
  qty: number,
  price: number,
  source: string
) {
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) return;
  if (allLiquidationsList.some((x) => x.id === id)) return;

  const usdValue = price * qty;
  const item: LiquidationItem = {
    id,
    time,
    side,
    qty: Number(qty.toFixed(4)),
    price: Number(price.toFixed(2)),
    usdValue: Math.round(usdValue),
    source,
  };

  allLiquidationsList = [item, ...allLiquidationsList]
    .sort((a, b) => b.time - a.time)
    .slice(0, 60);

  perpSources.liquidations = source;
  recomputeLiquidationWindowStats();
}

function recomputeLiquidationWindowStats() {
  const cutoff5m = Date.now() - 5 * 60 * 1000;
  const liq5m = allLiquidationsList.filter((l) => l.time >= cutoff5m);

  let total5m = 0;
  let long5m = 0;
  let short5m = 0;
  for (const l of liq5m) {
    total5m += l.usdValue;
    if (l.side === 'SELL') long5m += l.usdValue;
    else short5m += l.usdValue;
  }

  perp = {
    ...perp,
    liquidations5m: liq5m.slice(0, 10),
    recentLiquidations: allLiquidationsList.slice(0, 10),
    totalLiq5mUsd: Math.round(total5m),
    longLiq5mUsd: Math.round(long5m),
    shortLiq5mUsd: Math.round(short5m),
    sources: { ...perpSources },
  };
}

// D. Binance Futures WebSocket (markPrice@1s & forceOrder)
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
    let receivedFrame = false;

    ws.on('open', () => {
      console.log('[BTC TIDE BACKEND] Connected to Binance Futures WebSocket (awaiting frames)');
      setTimeout(() => {
        if (!receivedFrame && binanceFuturesWs === ws) {
          recordUpstreamError(
            'binance_futures_ws',
            1006,
            'WS handshake opened but 0 stream frames received (using REST FAPI / OKX / Bybit fallbacks)'
          );
        }
      }, 6000);
    });

    ws.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        const stream = payload.stream;
        const data = payload.data;
        receivedFrame = true;
        recordUpstreamSuccess('binance_futures_ws', 1000);

        if (stream === 'btcusdt@markPrice@1s') {
          const markPrice = parseFloat(data.p);
          const fundingRate = parseFloat(data.r);
          const nextFundingTime = Number(data.T);
          const spotP = currentPrice || depth.midPrice;

          let basis = perp.basis;
          let basisBps = perp.basisBps;
          if (spotP && spotP > 0 && markPrice > 0) {
            basis = Number((markPrice - spotP).toFixed(2));
            basisBps = Number(((basis / spotP) * 10000).toFixed(2));
          }

          lastPerpsTime = Date.now();
          perpSources.markPrice = 'Binance FAPI';
          perpSources.funding = 'Binance FAPI';
          perpSources.basis = 'Binance FAPI';

          perp = {
            ...perp,
            markPrice,
            fundingRate,
            nextFundingTime,
            basis,
            basisBps,
            sources: { ...perpSources },
            status: 'LIVE',
            updatedAt: Date.now(),
          };
        } else if (stream === 'btcusdt@forceOrder') {
          const order = data.o || data;
          const liqTime = Number(order.T || Date.now());
          const side = order.S === 'BUY' ? 'BUY' : 'SELL';
          const qty = parseFloat(order.q);
          const price = parseFloat(order.p);
          liqSeqCounter += 1;
          recordLiquidationEvent(
            `bn_liq_${liqTime}_${price}_${qty}`,
            liqTime,
            side,
            qty,
            price,
            'Binance forceOrder'
          );
          lastPerpsTime = Date.now();
        }
      } catch {}
    });

    ws.on('error', (err) => {
      recordUpstreamError('binance_futures_ws', null, err.message);
    });

    ws.on('close', (code, reason) => {
      recordUpstreamClose('binance_futures_ws', code, reason?.toString() || 'Binance futures WS closed');
      setTimeout(connectBinanceFutures, 5000);
    });
  } catch (err: any) {
    recordUpstreamError('binance_futures_ws', null, err.message);
  }
}

// E. Bybit Linear WebSocket (allLiquidation.BTCUSDT fallback stream)
function connectBybitLinearWs() {
  if (bybitLinearWs) {
    try {
      bybitLinearWs.close();
    } catch {}
    bybitLinearWs = null;
  }

  try {
    const ws = new WebSocket(BYBIT_LINEAR_WS);
    bybitLinearWs = ws;

    ws.on('open', () => {
      console.log('[BTC TIDE BACKEND] Connected to Bybit Linear WS (allLiquidation.BTCUSDT)');
      recordUpstreamSuccess('bybit_linear_ws', 1000);
      ws.send(
        JSON.stringify({
          op: 'subscribe',
          args: ['allLiquidation.BTCUSDT'],
        })
      );
    });

    ws.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        if (payload.topic === 'allLiquidation.BTCUSDT' && payload.data) {
          recordUpstreamSuccess('bybit_linear_ws', 1000);
          const items = Array.isArray(payload.data) ? payload.data : [payload.data];
          for (const it of items) {
            const liqTime = Number(it.T || it.updatedTime || Date.now());
            const price = parseFloat(it.p || it.price);
            const qty = parseFloat(it.v || it.size);
            // In Bybit allLiquidation: S='Buy' means a long position was liquidated (or buy-to-close short)
            // Standardize: SELL = Long Rekt, BUY = Short Rekt
            const side: 'BUY' | 'SELL' = it.S === 'Buy' || it.side === 'Buy' ? 'SELL' : 'BUY';
            recordLiquidationEvent(
              `bybit_liq_${liqTime}_${price}_${qty}`,
              liqTime,
              side,
              qty,
              price,
              'Bybit allLiquidation'
            );
          }
        }
      } catch {}
    });

    ws.on('error', (err) => {
      recordUpstreamError('bybit_linear_ws', null, err.message);
    });

    ws.on('close', (code, reason) => {
      recordUpstreamClose('bybit_linear_ws', code, reason?.toString() || 'Bybit Linear WS closed');
      setTimeout(connectBybitLinearWs, 5000);
    });
  } catch (err: any) {
    recordUpstreamError('bybit_linear_ws', null, err.message);
  }
}

// ---------------------------------------------------------------------------
// 3. Failover with Hysteresis (Spot Trades)
// ---------------------------------------------------------------------------
function switchActiveSource(newSourceId: SpotSourceId, reason: string) {
  if (activeSourceId === newSourceId) return;
  const oldConfig = SPOT_SOURCES.find((s) => s.id === activeSourceId)!;
  const newConfig = SPOT_SOURCES.find((s) => s.id === newSourceId)!;

  console.log(
    `[BTC TIDE FAILOVER] Switching active spot source: ${oldConfig.name} -> ${newConfig.name}. Reason: ${reason}`
  );
  activeSourceId = newSourceId;
  activeSourceLabel = newConfig.label;
  scheduleBroadcast();
}

function evaluateFailoverHysteresis() {
  const now = Date.now();
  const currentConfig = SPOT_SOURCES.find((s) => s.id === activeSourceId)!;
  const currentState = sourceStates.get(activeSourceId)!;

  const currentSilenceMs = currentState.lastTradeTime ? now - currentState.lastTradeTime : 999999;

  if (currentSilenceMs >= 8000 || currentState.isGeoBlocked) {
    const candidate = SPOT_SOURCES.find((s) => {
      if (s.id === activeSourceId) return false;
      const st = sourceStates.get(s.id)!;
      if (st.isGeoBlocked) return false;
      const silence = st.lastTradeTime ? now - st.lastTradeTime : 999999;
      return silence < 8000;
    });

    if (candidate) {
      switchActiveSource(
        candidate.id,
        currentState.isGeoBlocked
          ? 'Current source is geo-blocked'
          : `Silence >= 8s (${(currentSilenceMs / 1000).toFixed(1)}s)`
      );
      return;
    }
  }

  const higherPrioritySources = SPOT_SOURCES.filter((s) => s.priority < currentConfig.priority);
  for (const hp of higherPrioritySources) {
    const st = sourceStates.get(hp.id)!;
    if (st.isGeoBlocked) continue;
    if (st.healthySince && now - st.healthySince >= 30000 && st.lastTradeTime && now - st.lastTradeTime < 3000) {
      switchActiveSource(
        hp.id,
        `Higher-priority ${hp.name} has had >= 30s of stable continuous data`
      );
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// 4. PERPS Multi-Source Fallback Chains
//    - Mark, Funding, Next Funding, Basis: Binance fapi -> OKX SWAP -> Bybit linear -> Hyperliquid
//    - Open Interest (every 10s + SQLite 1h history): Binance fapi -> OKX SWAP -> Bybit linear -> Hyperliquid
//    - Long/Short Ratio: Binance globalLongShortAccountRatio -> OKX -> Bybit account-ratio
//    - Liquidations: Binance forceOrder -> OKX liquidation-orders -> Bybit allLiquidation
// ---------------------------------------------------------------------------
async function fetchJsonWithStatus(url: string, options: any = {}, timeoutMs = 3200) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latency = Date.now() - t0;
    if (!res.ok) {
      return { ok: false, status: res.status, data: null, error: `HTTP ${res.status}`, latency };
    }
    const data = await res.json();
    return { ok: true, status: res.status, data, error: null, latency };
  } catch (err: any) {
    return { ok: false, status: null, data: null, error: err.message || 'Timeout', latency: Date.now() - t0 };
  }
}

export async function pollPerpsMarkFundingAndLiqs(): Promise<void> {
  const now = Date.now();
  const spotRef = currentPrice || depth.midPrice || venues.medianPrice;

  // --- A. Mark Price, Funding Rate, Next Funding Time, Basis ---
  let markResolved = false;

  // 1. Try Binance FAPI premiumIndex
  const bnPrem = await fetchJsonWithStatus('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT');
  if (bnPrem.ok && bnPrem.data && parseFloat(bnPrem.data.markPrice) > 0) {
    recordUpstreamSuccess('binance_fapi_rest', bnPrem.status!, bnPrem.latency);
    const markPrice = parseFloat(bnPrem.data.markPrice);
    const fundingRate = parseFloat(bnPrem.data.lastFundingRate);
    const nextFundingTime = Number(bnPrem.data.nextFundingTime);
    const basis = spotRef ? Number((markPrice - spotRef).toFixed(2)) : null;
    const basisBps = spotRef && basis !== null ? Number(((basis / spotRef) * 10000).toFixed(2)) : null;

    perpSources.markPrice = 'Binance FAPI';
    perpSources.funding = 'Binance FAPI';
    perpSources.basis = 'Binance FAPI';

    perp = {
      ...perp,
      markPrice,
      fundingRate,
      nextFundingTime,
      basis,
      basisBps,
      sources: { ...perpSources },
      status: 'LIVE',
      updatedAt: now,
    };
    lastPerpsTime = now;
    markResolved = true;
    fieldReasons.delete('PERPS:mark_funding');
  } else {
    recordUpstreamError('binance_fapi_rest', bnPrem.status, bnPrem.error || 'Binance FAPI premiumIndex failed');
  }

  // 2. Fallback: OKX BTC-USDT-SWAP
  if (!markResolved) {
    const [okxMark, okxFund] = await Promise.all([
      fetchJsonWithStatus('https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=BTC-USDT-SWAP'),
      fetchJsonWithStatus('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP'),
    ]);
    if (
      okxMark.ok &&
      okxMark.data?.data?.[0]?.markPx &&
      okxFund.ok &&
      okxFund.data?.data?.[0]?.fundingRate
    ) {
      recordUpstreamSuccess('okx_rest', 200, okxMark.latency);
      const markPrice = parseFloat(okxMark.data.data[0].markPx);
      const fundingRate = parseFloat(okxFund.data.data[0].fundingRate);
      const nextFundingTime = Number(okxFund.data.data[0].fundingTime);
      const basis = spotRef ? Number((markPrice - spotRef).toFixed(2)) : null;
      const basisBps = spotRef && basis !== null ? Number(((basis / spotRef) * 10000).toFixed(2)) : null;

      perpSources.markPrice = 'OKX SWAP';
      perpSources.funding = 'OKX SWAP';
      perpSources.basis = 'OKX SWAP';

      perp = {
        ...perp,
        markPrice,
        fundingRate,
        nextFundingTime,
        basis,
        basisBps,
        sources: { ...perpSources },
        status: 'LIVE',
        updatedAt: now,
      };
      lastPerpsTime = now;
      markResolved = true;
      fieldReasons.delete('PERPS:mark_funding');
    }
  }

  // 3. Fallback: Bybit Linear
  if (!markResolved) {
    const bybitLin = await fetchJsonWithStatus(
      'https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT'
    );
    const item = bybitLin.data?.result?.list?.[0];
    if (bybitLin.ok && item && parseFloat(item.markPrice) > 0) {
      recordUpstreamSuccess('bybit_rest', 200, bybitLin.latency);
      const markPrice = parseFloat(item.markPrice);
      const fundingRate = parseFloat(item.fundingRate);
      const nextFundingTime = Number(item.nextFundingTime);
      const basis = spotRef ? Number((markPrice - spotRef).toFixed(2)) : null;
      const basisBps = spotRef && basis !== null ? Number(((basis / spotRef) * 10000).toFixed(2)) : null;

      perpSources.markPrice = 'Bybit Linear';
      perpSources.funding = 'Bybit Linear';
      perpSources.basis = 'Bybit Linear';

      perp = {
        ...perp,
        markPrice,
        fundingRate,
        nextFundingTime,
        basis,
        basisBps,
        sources: { ...perpSources },
        status: 'LIVE',
        updatedAt: now,
      };
      lastPerpsTime = now;
      markResolved = true;
      fieldReasons.delete('PERPS:mark_funding');
    }
  }

  // 4. Fallback: Hyperliquid
  if (!markResolved) {
    const hl = await fetchJsonWithStatus('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });
    if (hl.ok && Array.isArray(hl.data) && hl.data.length >= 2) {
      recordUpstreamSuccess('hyperliquid', 200, hl.latency);
      const btcIdx = hl.data[0]?.universe?.findIndex((u: any) => u.name === 'BTC');
      const ctx = btcIdx >= 0 ? hl.data[1]?.[btcIdx] : null;
      if (ctx && parseFloat(ctx.markPx) > 0) {
        const markPrice = parseFloat(ctx.markPx);
        const fundingRate = parseFloat(ctx.funding);
        const nextFundingTime = Math.ceil(now / 3600000) * 3600000;
        const basis = spotRef ? Number((markPrice - spotRef).toFixed(2)) : null;
        const basisBps = spotRef && basis !== null ? Number(((basis / spotRef) * 10000).toFixed(2)) : null;

        perpSources.markPrice = 'Hyperliquid';
        perpSources.funding = 'Hyperliquid';
        perpSources.basis = 'Hyperliquid';

        perp = {
          ...perp,
          markPrice,
          fundingRate,
          nextFundingTime,
          basis,
          basisBps,
          sources: { ...perpSources },
          status: 'LIVE',
          updatedAt: now,
        };
        lastPerpsTime = now;
        markResolved = true;
        fieldReasons.delete('PERPS:mark_funding');
      }
    }
  }

  if (!markResolved) {
    fieldReasons.set(
      'PERPS:mark_funding',
      'All 4 upstreams failed (Binance FAPI, OKX SWAP, Bybit Linear, Hyperliquid)'
    );
  }

  // --- B. Liquidations Fallback: OKX liquidation-orders REST poll ---
  const okxLiq = await fetchJsonWithStatus(
    'https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&uly=BTC-USDT&state=filled&limit=10'
  );
  if (okxLiq.ok && Array.isArray(okxLiq.data?.data)) {
    recordUpstreamSuccess('okx_rest', 200, okxLiq.latency);
    const details = okxLiq.data.data[0]?.details;
    if (Array.isArray(details)) {
      for (const d of details) {
        const liqTime = Number(d.ts || d.time || now);
        const price = parseFloat(d.bkPx);
        // OKX BTC-USDT-SWAP contract size = 0.01 BTC per contract
        const contracts = parseFloat(d.sz);
        const qtyBtc = contracts * 0.01;
        // posSide='long' or side='sell' means a LONG position was liquidated
        const side: 'BUY' | 'SELL' =
          d.posSide === 'long' || d.side === 'sell' ? 'SELL' : 'BUY';
        recordLiquidationEvent(
          `okx_liq_${liqTime}_${price}_${contracts}`,
          liqTime,
          side,
          qtyBtc,
          price,
          'OKX liquidation-orders'
        );
      }
    }
  }

  recomputeLiquidationWindowStats();

  // --- C. Fallback Order Book Snapshot if both Binance WS depth20 streams are silent > 3s ---
  if (!lastBookTime || now - lastBookTime > 3000) {
    const depthRes = await fetchJsonWithStatus(
      'https://data-api.binance.vision/api/v3/depth?symbol=BTCUSDT&limit=20'
    );
    if (depthRes.ok && depthRes.data?.bids && depthRes.data?.asks) {
      replaceOrderBookFromDepth20Snapshot('binance_rest', depthRes.data.bids, depthRes.data.asks);
    }
  }

  scheduleBroadcast();
}

export async function pollPerpsOiAndLongShort(): Promise<void> {
  const now = Date.now();

  // --- 1. Open Interest (poll every 10s, store in SQLite, compute 1h change) ---
  // Chain: Binance FAPI -> OKX BTC-USDT-SWAP -> Bybit Linear -> Hyperliquid
  let oiBtc: number | null = null;
  let oiSource = 'Binance FAPI';

  const bnOi = await fetchJsonWithStatus('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT');
  if (bnOi.ok && bnOi.data && parseFloat(bnOi.data.openInterest) > 0) {
    oiBtc = parseFloat(bnOi.data.openInterest);
    oiSource = 'Binance FAPI';
    recordUpstreamSuccess('binance_fapi_rest', 200, bnOi.latency);
  } else {
    const okxOi = await fetchJsonWithStatus(
      'https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP'
    );
    if (okxOi.ok && okxOi.data?.data?.[0]?.oiCcy && parseFloat(okxOi.data.data[0].oiCcy) > 0) {
      oiBtc = parseFloat(okxOi.data.data[0].oiCcy);
      oiSource = 'OKX SWAP';
      recordUpstreamSuccess('okx_rest', 200, okxOi.latency);
    } else {
      const bybitOi = await fetchJsonWithStatus(
        'https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT'
      );
      const bItem = bybitOi.data?.result?.list?.[0];
      if (bybitOi.ok && bItem && parseFloat(bItem.openInterest) > 0) {
        oiBtc = parseFloat(bItem.openInterest);
        oiSource = 'Bybit Linear';
        recordUpstreamSuccess('bybit_rest', 200, bybitOi.latency);
      } else {
        const hlOi = await fetchJsonWithStatus('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
        });
        if (hlOi.ok && Array.isArray(hlOi.data) && hlOi.data.length >= 2) {
          const btcIdx = hlOi.data[0]?.universe?.findIndex((u: any) => u.name === 'BTC');
          const ctx = btcIdx >= 0 ? hlOi.data[1]?.[btcIdx] : null;
          if (ctx && parseFloat(ctx.openInterest) > 0) {
            oiBtc = parseFloat(ctx.openInterest);
            oiSource = 'Hyperliquid';
            recordUpstreamSuccess('hyperliquid', 200, hlOi.latency);
          }
        }
      }
    }
  }

  if (oiBtc !== null && oiBtc > 0) {
    const oiHist = recordAndComputeOiHistory(oiBtc, oiSource, now);
    perpSources.openInterest = oiSource;
    perp = {
      ...perp,
      openInterest: Number(oiBtc.toFixed(2)),
      oiChange1h: oiHist.oiChange1h,
      oiChange1hPct: oiHist.oiChange1hPct,
      oiHistoryStatus: oiHist.oiHistoryStatus,
      oiHistoryMinutes: oiHist.oiHistoryMinutes,
      sources: { ...perpSources },
      updatedAt: now,
    };
    lastPerpsTime = now;
    fieldReasons.delete('PERPS:open_interest');
  } else {
    fieldReasons.set('PERPS:open_interest', 'Failed to fetch OI from Binance, OKX, Bybit, and Hyperliquid');
  }

  // --- 2. Long/Short Ratio ---
  // Chain: Binance globalLongShortAccountRatio -> OKX long-short-account-ratio -> Bybit account-ratio
  let lsResolved = false;

  const bnLs = await fetchJsonWithStatus(
    'https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1'
  );
  if (bnLs.ok && Array.isArray(bnLs.data) && bnLs.data[0] && parseFloat(bnLs.data[0].longShortRatio) > 0) {
    const item = bnLs.data[0];
    const ratio = parseFloat(item.longShortRatio);
    const longPct = Number((parseFloat(item.longAccount) * 100).toFixed(1));
    const shortPct = Number((parseFloat(item.shortAccount) * 100).toFixed(1));
    perpSources.longShort = 'Binance FAPI';
    perp = {
      ...perp,
      longShortRatio: Number(ratio.toFixed(2)),
      longAccountPct: longPct,
      shortAccountPct: shortPct,
      sources: { ...perpSources },
      updatedAt: now,
    };
    lsResolved = true;
    fieldReasons.delete('PERPS:long_short');
  }

  if (!lsResolved) {
    const okxLs = await fetchJsonWithStatus(
      'https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=5m'
    );
    const first = okxLs.data?.data?.[0];
    if (okxLs.ok && Array.isArray(first) && parseFloat(first[1]) > 0) {
      const ratio = parseFloat(first[1]);
      const longPct = Number(((ratio / (1 + ratio)) * 100).toFixed(1));
      const shortPct = Number((100 - longPct).toFixed(1));
      perpSources.longShort = 'OKX';
      perp = {
        ...perp,
        longShortRatio: Number(ratio.toFixed(2)),
        longAccountPct: longPct,
        shortAccountPct: shortPct,
        sources: { ...perpSources },
        updatedAt: now,
      };
      lsResolved = true;
      fieldReasons.delete('PERPS:long_short');
    }
  }

  if (!lsResolved) {
    const bybitLs = await fetchJsonWithStatus(
      'https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=5min&limit=1'
    );
    const item = bybitLs.data?.result?.list?.[0];
    if (bybitLs.ok && item && parseFloat(item.buyRatio) > 0) {
      const buyR = parseFloat(item.buyRatio);
      const sellR = parseFloat(item.sellRatio);
      const ratio = sellR > 0 ? Number((buyR / sellR).toFixed(2)) : 1.0;
      const longPct = Number((buyR * 100).toFixed(1));
      const shortPct = Number((sellR * 100).toFixed(1));
      perpSources.longShort = 'Bybit';
      perp = {
        ...perp,
        longShortRatio: ratio,
        longAccountPct: longPct,
        shortAccountPct: shortPct,
        sources: { ...perpSources },
        updatedAt: now,
      };
      lsResolved = true;
      fieldReasons.delete('PERPS:long_short');
    }
  }

  if (!lsResolved) {
    fieldReasons.set('PERPS:long_short', 'Failed to fetch L/S ratio from Binance, OKX, and Bybit');
  }

  // Probe Deribit for upstream health telemetry
  const deribitRes = await fetchJsonWithStatus(
    'https://www.deribit.com/api/v2/public/get_index_price?index_name=btc_usd'
  );
  if (deribitRes.ok) {
    recordUpstreamSuccess('deribit', 200, deribitRes.latency);
  } else {
    recordUpstreamError('deribit', deribitRes.status, deribitRes.error || 'Deribit failed');
  }

  scheduleBroadcast();
}

// ---------------------------------------------------------------------------
// 5. Cross-Venue Aggregator (9 Venues · Poll every 3s · Outlier Detection > 0.5%)
//    Venues: Binance, OKX, Bybit, Gate, MEXC, Bitget, KuCoin, Hyperliquid, Coinbase
// ---------------------------------------------------------------------------
async function pollBackendVenues() {
  const t0 = Date.now();
  try {
    const [
      binancePrimary,
      okxRes,
      bybitRes,
      gateRes,
      mexcRes,
      bitgetRes,
      kucoinRes,
      hlRes,
      coinbaseRes,
    ] = await Promise.all([
      fetchJsonWithStatus('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', {}, 2500),
      fetchJsonWithStatus('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT', {}, 2500),
      fetchJsonWithStatus('https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT', {}, 2500),
      fetchJsonWithStatus('https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BTC_USDT', {}, 2500),
      fetchJsonWithStatus('https://api.mexc.com/api/v3/ticker/24hr?symbol=BTCUSDT', {}, 2500),
      fetchJsonWithStatus('https://api.bitget.com/api/v2/spot/market/tickers?symbol=BTCUSDT', {}, 2500),
      fetchJsonWithStatus('https://api.kucoin.com/api/v1/market/stats?symbol=BTC-USDT', {}, 2500),
      fetchJsonWithStatus(
        'https://api.hyperliquid.xyz/info',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
        },
        2500
      ),
      fetchJsonWithStatus('https://api.exchange.coinbase.com/products/BTC-USD/stats', {}, 2500),
    ]);

    // If api.binance.com failed (e.g. 451), fallback to data-api.binance.vision
    let binanceData = binancePrimary.ok ? binancePrimary.data : null;
    let binanceErr = binancePrimary.error;
    if (!binanceData) {
      const visionFallback = await fetchJsonWithStatus(
        'https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT',
        {},
        2500
      );
      if (visionFallback.ok) {
        binanceData = visionFallback.data;
        binanceErr = null;
      } else {
        binanceErr = visionFallback.error || binancePrimary.error;
      }
    }

    if (coinbaseRes.ok) {
      recordUpstreamSuccess('coinbase_rest', 200, coinbaseRes.latency);
    } else {
      recordUpstreamError('coinbase_rest', coinbaseRes.status, coinbaseRes.error || 'Coinbase failed');
    }

    if (bybitRes.ok) {
      recordUpstreamSuccess('bybit_rest', 200, bybitRes.latency);
    } else {
      recordUpstreamError('bybit_rest', bybitRes.status, bybitRes.error || 'Bybit failed');
    }

    if (hlRes.ok) {
      recordUpstreamSuccess('hyperliquid', 200, hlRes.latency);
    } else {
      recordUpstreamError('hyperliquid', hlRes.status, hlRes.error || 'Hyperliquid failed');
    }

    // Parse Hyperliquid BTC price & 24h base volume
    let hlPrice: number | null = null;
    let hlVolBtc: number | null = null;
    if (hlRes.ok && Array.isArray(hlRes.data) && hlRes.data.length >= 2) {
      const btcIdx = hlRes.data[0]?.universe?.findIndex((u: any) => u.name === 'BTC');
      const ctx = btcIdx >= 0 ? hlRes.data[1]?.[btcIdx] : null;
      if (ctx) {
        hlPrice = parseFloat(ctx.midPx || ctx.markPx);
        hlVolBtc = parseFloat(ctx.dayBaseVlm);
      }
    }

    const rawVenues: Array<{
      venue: string;
      price: number | null;
      volume24h: number | null;
      errorReason: string | null;
    }> = [
      {
        venue: 'Binance',
        price: binanceData?.lastPrice ? parseFloat(binanceData.lastPrice) : null,
        volume24h: binanceData?.volume ? parseFloat(binanceData.volume) : null,
        errorReason: binanceErr,
      },
      {
        venue: 'OKX',
        price: okxRes.data?.data?.[0]?.last ? parseFloat(okxRes.data.data[0].last) : null,
        volume24h: okxRes.data?.data?.[0]?.vol24h ? parseFloat(okxRes.data.data[0].vol24h) : null,
        errorReason: okxRes.error,
      },
      {
        venue: 'Bybit',
        price: bybitRes.data?.result?.list?.[0]?.lastPrice
          ? parseFloat(bybitRes.data.result.list[0].lastPrice)
          : null,
        volume24h: bybitRes.data?.result?.list?.[0]?.volume24h
          ? parseFloat(bybitRes.data.result.list[0].volume24h)
          : null,
        errorReason: bybitRes.error,
      },
      {
        venue: 'Gate',
        price: gateRes.data?.[0]?.last ? parseFloat(gateRes.data[0].last) : null,
        volume24h: gateRes.data?.[0]?.base_volume ? parseFloat(gateRes.data[0].base_volume) : null,
        errorReason: gateRes.error,
      },
      {
        venue: 'MEXC',
        price: mexcRes.data?.lastPrice ? parseFloat(mexcRes.data.lastPrice) : null,
        volume24h: mexcRes.data?.volume ? parseFloat(mexcRes.data.volume) : null,
        errorReason: mexcRes.error,
      },
      {
        venue: 'Bitget',
        price: bitgetRes.data?.data?.[0]?.lastPr ? parseFloat(bitgetRes.data.data[0].lastPr) : null,
        volume24h: bitgetRes.data?.data?.[0]?.baseVolume
          ? parseFloat(bitgetRes.data.data[0].baseVolume)
          : null,
        errorReason: bitgetRes.error,
      },
      {
        venue: 'KuCoin',
        price: kucoinRes.data?.data?.last ? parseFloat(kucoinRes.data.data.last) : null,
        volume24h: kucoinRes.data?.data?.vol ? parseFloat(kucoinRes.data.data.vol) : null,
        errorReason: kucoinRes.error,
      },
      {
        venue: 'Hyperliquid',
        price: hlPrice && Number.isFinite(hlPrice) ? hlPrice : null,
        volume24h: hlVolBtc && Number.isFinite(hlVolBtc) ? hlVolBtc : null,
        errorReason: hlRes.error,
      },
      {
        venue: 'Coinbase',
        price: coinbaseRes.data?.last ? parseFloat(coinbaseRes.data.last) : null,
        volume24h: coinbaseRes.data?.volume ? parseFloat(coinbaseRes.data.volume) : null,
        errorReason: coinbaseRes.error,
      },
    ];

    // Record per-venue errors in fieldReasons for the Debug Drawer
    for (const rv of rawVenues) {
      if (rv.price === null || !Number.isFinite(rv.price) || rv.price <= 0) {
        fieldReasons.set(`VENUES:${rv.venue}`, rv.errorReason || 'Ticker returned null/empty price');
      } else {
        fieldReasons.delete(`VENUES:${rv.venue}`);
      }
    }

    const computeMedian = (arr: number[]): number | null => {
      if (arr.length === 0) return null;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2))
        : Number(sorted[mid].toFixed(2));
    };

    // Pass 1: Initial median across all online venues
    const allValidPrices = rawVenues
      .map((v) => v.price)
      .filter((p): p is number => p !== null && Number.isFinite(p) && p > 0);
    const initialMedian = computeMedian(allValidPrices);

    // Flag any venue more than 0.5% (50 bps) from median as "outlier" and exclude it from the final median
    const nonOutlierPrices =
      initialMedian !== null
        ? allValidPrices.filter((p) => Math.abs(p - initialMedian) / initialMedian <= 0.005)
        : allValidPrices;

    const cleanMedian = computeMedian(nonOutlierPrices.length > 0 ? nonOutlierPrices : allValidPrices);

    let spread: number | null = null;
    let highestVenue: string | null = null;
    let lowestVenue: string | null = null;

    const cleanVenuesForRange = rawVenues.filter(
      (v) =>
        v.price !== null &&
        v.price > 0 &&
        cleanMedian !== null &&
        Math.abs(v.price - cleanMedian) / cleanMedian <= 0.005
    );

    if (cleanVenuesForRange.length > 0) {
      const sortedRange = [...cleanVenuesForRange].sort((a, b) => a.price! - b.price!);
      const minV = sortedRange[0];
      const maxV = sortedRange[sortedRange.length - 1];
      spread = Number((maxV.price! - minV.price!).toFixed(2));
      highestVenue = `${maxV.venue} ($${maxV.price!.toFixed(2)})`;
      lowestVenue = `${minV.venue} ($${minV.price!.toFixed(2)})`;
    }

    const totalVolumeBtc = rawVenues.reduce(
      (acc, v) => acc + (v.volume24h && Number.isFinite(v.volume24h) ? v.volume24h : 0),
      0
    );

    const processedVenues = rawVenues.map((v) => {
      const hasPrice = v.price !== null && Number.isFinite(v.price) && v.price > 0;
      let diffVsMedian: number | null = null;
      let diffVsMedianBps: number | null = null;
      let isOutlier = false;

      if (hasPrice && cleanMedian !== null && cleanMedian > 0) {
        diffVsMedian = Number((v.price! - cleanMedian).toFixed(2));
        diffVsMedianBps = Number(((diffVsMedian / cleanMedian) * 10000).toFixed(1));
        isOutlier = Math.abs(v.price! - cleanMedian) / cleanMedian > 0.005;
      }

      let volSharePct: number | null = null;
      if (v.volume24h !== null && Number.isFinite(v.volume24h) && totalVolumeBtc > 0) {
        volSharePct = Number(((v.volume24h / totalVolumeBtc) * 100).toFixed(1));
      }

      return {
        venue: v.venue,
        price: hasPrice ? Number(v.price!.toFixed(2)) : null,
        volume24h: v.volume24h && Number.isFinite(v.volume24h) ? Number(v.volume24h.toFixed(1)) : null,
        volSharePct,
        diffVsMedian,
        diffVsMedianBps,
        isOutlier,
        errorReason: v.errorReason,
        status: (hasPrice ? 'ONLINE' : 'OFFLINE') as 'ONLINE' | 'OFFLINE',
      };
    });

    lastVenuesTime = Date.now();
    venues = {
      venues: processedVenues,
      medianPrice: cleanMedian,
      spread,
      highestVenue,
      lowestVenue,
      totalVolumeBtc: Number(totalVolumeBtc.toFixed(1)),
      updatedAt: lastVenuesTime,
    };

    recordUpstreamSuccess('venue_tickers', 200, Date.now() - t0);
    scheduleBroadcast();
  } catch (err: any) {
    recordUpstreamError('venue_tickers', null, err.message);
  }
}

let currentAtr1h: number | null = null;
let atr1hPollTimer: NodeJS.Timeout | null = null;

async function pollBtc1hAtr() {
  const parseKlinesAtr = (candles: Array<{ high: number; low: number; close: number }>): number | null => {
    if (candles.length < 5) return null;
    let trSum = 0;
    let count = 0;
    for (let i = 1; i < candles.length; i++) {
      const c = candles[i];
      const prevClose = candles[i - 1].close;
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose)
      );
      if (Number.isFinite(tr) && tr > 0) {
        trSum += tr;
        count++;
      }
    }
    return count > 0 ? Number((trSum / count).toFixed(2)) : null;
  };

  // Fallback chain: Binance Spot -> Binance Vision -> OKX -> Bybit
  const endpoints: Array<{
    name: string;
    url: string;
    extract: (d: any) => Array<{ high: number; low: number; close: number }>;
  }> = [
    {
      name: 'Binance 1H Klines',
      url: 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=16',
      extract: (d) =>
        Array.isArray(d)
          ? d.map((r: any) => ({
              high: parseFloat(r[2]),
              low: parseFloat(r[3]),
              close: parseFloat(r[4]),
            }))
          : [],
    },
    {
      name: 'Binance Vision 1H Klines',
      url: 'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=16',
      extract: (d) =>
        Array.isArray(d)
          ? d.map((r: any) => ({
              high: parseFloat(r[2]),
              low: parseFloat(r[3]),
              close: parseFloat(r[4]),
            }))
          : [],
    },
    {
      name: 'OKX 1H Candles',
      url: 'https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1H&limit=16',
      extract: (d) =>
        Array.isArray(d?.data)
          ? [...d.data]
              .reverse()
              .map((r: any) => ({
                high: parseFloat(r[2]),
                low: parseFloat(r[3]),
                close: parseFloat(r[4]),
              }))
          : [],
    },
    {
      name: 'Bybit 1H Klines',
      url: 'https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=60&limit=16',
      extract: (d) =>
        Array.isArray(d?.result?.list)
          ? [...d.result.list]
              .reverse()
              .map((r: any) => ({
                high: parseFloat(r[2]),
                low: parseFloat(r[3]),
                close: parseFloat(r[4]),
              }))
          : [],
    },
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetchWithTimeout(ep.url, 4000);
      if (res.ok && res.data) {
        const candles = ep.extract(res.data);
        const atr = parseKlinesAtr(candles);
        if (atr !== null && atr > 50) {
          currentAtr1h = atr;
          return;
        }
      }
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// 6. Signal Engine Evaluation Loop (1 Hz)
// ---------------------------------------------------------------------------
function runBackendSignalEngineStep() {
  const now = Date.now();
  const tradeAge = lastTradesTime ? now - lastTradesTime : 999999;
  const sortedBins = Array.from(binsMap.values()).sort((a, b) => a.sec - b.sec);

  currentDecision = evaluateDecisionEngine(
    sortedBins,
    depth,
    perp,
    currentPrice,
    feedStatus,
    lastSignalTime,
    Boolean(currentActiveTrade),
    tradeAge
  );

  if (currentActiveTrade && currentPrice !== null) {
    const deviation = Math.abs(currentActiveTrade.entryPrice - currentPrice) / currentPrice;
    if (deviation > 0.02) {
      console.warn(
        `[BTC TIDE SAFETY] Active trade ${currentActiveTrade.id} entry price $${currentActiveTrade.entryPrice} deviates ${(deviation * 100).toFixed(2)}% from live price $${currentPrice.toFixed(2)} (> 2%). Voiding trade.`
      );
      currentActiveTrade = null;
      return;
    }

    const prevTp1 = currentActiveTrade.tp1Hit;
    const prevTp2 = currentActiveTrade.tp2Hit;

    const { updatedTrade, closed } = evaluateActiveTradeTick(currentActiveTrade, currentPrice, now);
    currentActiveTrade = updatedTrade;

    if (!prevTp1 && updatedTrade.tp1Hit) {
      lastSignalTime = now; // Start 1-2h BTC cooldown from TP1 hit
      notifyBtcTideTpHit(updatedTrade, 1, currentPrice);
      notifyBtcTideBreakevenMove(updatedTrade);
    } else if (!prevTp2 && updatedTrade.tp2Hit) {
      notifyBtcTideTpHit(updatedTrade, 2, currentPrice);
    }

    if (closed) {
      lastSignalTime = now; // Ensure 1-2h BTC cooldown runs after trade completion
      currentActiveTrade = null;
      currentClosedTrades = [
        updatedTrade,
        ...currentClosedTrades.filter((t) => t.id !== updatedTrade.id),
      ].slice(0, 300);
      saveTradeToSqlite(updatedTrade, currentPrice);

      if (updatedTrade.outcome === 'TP3') {
        notifyBtcTideTpHit(updatedTrade, 3, currentPrice);
      } else if (updatedTrade.outcome === 'SL' || updatedTrade.outcome === 'TP1+BE') {
        notifyBtcTideSlHit(updatedTrade, currentPrice);
      } else if (updatedTrade.outcome === 'EXPIRED') {
        notifyBtcTideExpiry(updatedTrade, currentPrice);
      }
    } else {
      saveTradeToSqlite(updatedTrade, currentPrice);
    }
  } else if (!currentActiveTrade && currentDecision.canFire && currentPrice !== null) {
    const newTrade = createTradePlan(
      currentDecision.favoredSide as 'LONG' | 'SHORT',
      currentPrice,
      sortedBins,
      currentDecision.confidence,
      currentDecision.lead,
      currentDecision.waitReason,
      currentAtr1h
    );
    currentActiveTrade = newTrade;
    lastSignalTime = newTrade.entryTime;
    saveTradeToSqlite(newTrade, currentPrice);
    notifyNewBtcTideSignal(newTrade, currentDecision);
  }

  scheduleBroadcast();
}

// ---------------------------------------------------------------------------
// 7. Watchdog Loop (1 Hz)
// ---------------------------------------------------------------------------
function startBackendWatchdog() {
  if (engineWatchdogTimer) clearInterval(engineWatchdogTimer);
  engineWatchdogTimer = setInterval(() => {
    const now = Date.now();
    const tradeAge = lastTradesTime ? now - lastTradesTime : 999999;

    if (tradeAge > 15000) {
      feedStatus = 'OFFLINE';
    } else if (tradeAge > 5000) {
      feedStatus = 'STALE';
    } else {
      feedStatus = 'LIVE';
    }

    evaluateFailoverHysteresis();
    runBackendSignalEngineStep();
  }, 1000);
}

/**
 * QA helper: Kills the primary Binance connection, advances its silence timer past 8s,
 * triggers failover hysteresis without blanking UI state, and restores primary reconnection after durationMs.
 */
export function simulateBinanceSpotDisconnectForQa(durationMs = 10000): {
  beforeSource: string;
  afterSource: string;
  pricePreserved: number | null;
  binsPreservedCount: number;
  tradesPreservedCount: number;
  depthPreservedCount: number;
} {
  const beforeSource = activeSourceLabel;
  const pState = sourceStates.get('binance_primary')!;

  if (pState.reconnectTimer) {
    clearTimeout(pState.reconnectTimer);
    pState.reconnectTimer = null;
  }

  // Hold reconnect timer for durationMs so binance_primary stays disconnected during QA test
  pState.reconnectTimer = setTimeout(() => {
    pState.reconnectTimer = null;
    connectBinanceWs('binance_primary');
  }, durationMs);

  if (pState.ws) {
    try {
      pState.ws.close(4000, 'QA simulated Binance primary kill');
    } catch {}
    pState.ws = null;
  }

  pState.healthySince = null;
  pState.lastTradeTime = Date.now() - 9000; // >= 8s silence threshold

  evaluateFailoverHysteresis();
  runBackendSignalEngineStep();

  return {
    beforeSource,
    afterSource: activeSourceLabel,
    pricePreserved: currentPrice,
    binsPreservedCount: binsMap.size,
    tradesPreservedCount: recentTradesList.length,
    depthPreservedCount: depth.bids.length + depth.asks.length,
  };
}

// ---------------------------------------------------------------------------
// 8. Public Snapshots & Health
// ---------------------------------------------------------------------------
export function getBackendSnapshot(): BtcTideBackendState {
  const sortedBins = Array.from(binsMap.values()).sort((a, b) => a.sec - b.sec);
  const now = Date.now();
  const tradeAge = lastTradesTime ? now - lastTradesTime : 999999;
  const bookAge = lastBookTime ? now - lastBookTime : 999999;
  const perpsAge = lastPerpsTime ? now - lastPerpsTime : 999999;
  const venuesAge = lastVenuesTime ? now - lastVenuesTime : 999999;

  // Staleness thresholds: trades 5s, book 3s, perps 20s, venues 10s
  const isSpotStale = tradeAge > 5000;
  const isBookStale = bookAge > 3000;
  const isPerpsStale = perpsAge > 20000;
  const isVenuesStale = venuesAge > 10000;

  const statusText =
    feedStatus === 'LIVE'
      ? `LIVE (${activeSourceLabel})`
      : feedStatus === 'STALE'
      ? `STALE (${activeSourceLabel} · ${(tradeAge / 1000).toFixed(1)}s)`
      : feedStatus === 'OFFLINE'
      ? 'OFFLINE'
      : 'CONNECTING';

  return {
    activeSource: activeSourceLabel,
    status: feedStatus,
    statusText,
    currentPrice,
    priceFlash,
    lastMessageTime: lastTradesTime,
    messageAgeMs: tradeAge < 999999 ? tradeAge : 0,
    feedAges: {
      spot: tradeAge < 999999 ? tradeAge : 999999,
      book: bookAge < 999999 ? bookAge : 999999,
      perps: perpsAge < 999999 ? perpsAge : 999999,
      venues: venuesAge < 999999 ? venuesAge : 999999,
    },
    feedSources: {
      spot: activeSourceLabel,
      book: activeBookSourceLabel,
      perps: `${perpSources.markPrice} / ${perpSources.openInterest}`,
      venues: 'Cross-Venue (9 Exchanges)',
    },
    feedStale: {
      spot: isSpotStale,
      book: isBookStale,
      perps: isPerpsStale,
      venues: isVenuesStale,
    },
    geoBlockedNotice,
    bookTicker,
    depth,
    perp,
    venues,
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

export function getServerRegionInfo(): ServerRegionInfo {
  return serverRegion;
}

export function getUpstreamHealthReports(): UpstreamHealthItem[] {
  return Array.from(upstreamsMap.values());
}

export function getBackendHealthReport() {
  const snap = getBackendSnapshot();
  const stats = computeSqliteStats();
  const mem = process.memoryUsage();
  const upstreamsList = Array.from(upstreamsMap.values());
  const anyError = upstreamsList.some((u) => u.status === 'ERROR');

  const fieldDiagnostics: FieldDiagnosticItem[] = [
    {
      section: 'ORDER_BOOK',
      field: 'Partial-Book Snapshot (btcusdt@depth20@100ms)',
      activeSource: activeBookSourceLabel,
      status: snap.depth.bids.length >= 8 ? 'OK' : 'UNAVAILABLE',
      reason: fieldReasons.get('ORDER_BOOK:depth20') || null,
    },
    {
      section: 'PERPS',
      field: 'Mark Price / Funding / Basis',
      activeSource: perpSources.markPrice,
      status: snap.perp.markPrice !== null ? 'OK' : 'UNAVAILABLE',
      reason: fieldReasons.get('PERPS:mark_funding') || null,
    },
    {
      section: 'PERPS',
      field: 'Open Interest & 1h Change (SQLite)',
      activeSource: perpSources.openInterest,
      status:
        snap.perp.openInterest === null
          ? 'UNAVAILABLE'
          : snap.perp.oiChange1h !== null
          ? 'OK'
          : 'BUILDING',
      reason:
        fieldReasons.get('PERPS:open_interest') ||
        (snap.perp.oiChange1h === null
          ? `SQLite OI history ${snap.perp.oiHistoryStatus || 'building 0m/60m'} (needs 60m for 1h delta)`
          : null),
    },
    {
      section: 'PERPS',
      field: 'Global Long/Short Account Ratio',
      activeSource: perpSources.longShort,
      status: snap.perp.longShortRatio !== null ? 'OK' : 'UNAVAILABLE',
      reason: fieldReasons.get('PERPS:long_short') || null,
    },
    {
      section: 'PERPS',
      field: 'Liquidations (5m Total & Last 10 Events)',
      activeSource: perpSources.liquidations,
      status: 'OK',
      reason:
        (snap.perp.recentLiquidations?.length || 0) === 0
          ? 'Listening on Binance forceOrder, OKX liquidation-orders, and Bybit allLiquidation'
          : null,
    },
    ...snap.venues.venues.map((v) => ({
      section: 'VENUES' as const,
      field: `Venue: ${v.venue}`,
      activeSource: v.venue,
      status: (v.status === 'ONLINE' ? 'OK' : 'UNAVAILABLE') as 'OK' | 'UNAVAILABLE',
      reason: v.errorReason || fieldReasons.get(`VENUES:${v.venue}`) || null,
    })),
  ];

  return {
    status: snap.status === 'LIVE' ? (anyError ? 'DEGRADED' : 'HEALTHY') : snap.status === 'STALE' ? 'DEGRADED' : 'DOWN',
    activeSource: snap.activeSource,
    feedStatus: snap.status,
    messageAgeMs: snap.messageAgeMs,
    currentPrice: snap.currentPrice,
    serverRegion,
    geoBlockedNotice,
    feedAges: snap.feedAges,
    feedSources: snap.feedSources,
    feedStale: snap.feedStale,
    fieldDiagnostics,
    upstreams: upstreamsList,
    sqliteStats: stats,
    activeTrade: snap.activeTrade
      ? {
          id: snap.activeTrade.id,
          side: snap.activeTrade.side,
          entryPrice: snap.activeTrade.entryPrice,
          currentR: snap.activeTrade.currentR,
          status: snap.activeTrade.status,
        }
      : null,
    ticksSeen: snap.session.ticksSeen,
    uptimeSeconds: Math.floor(process.uptime()),
    memoryMb: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    },
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// 9. Boot & Shutdown Lifecycle
// ---------------------------------------------------------------------------
export async function initBtcTideBackend(): Promise<void> {
  if (isBackendEngineStarted) return;
  isBackendEngineStarted = true;

  console.log('[BTC TIDE BACKEND] Booting 24/7 Node.js BTC Tide Signal Engine...');

  // 1. Detect server region & IP country
  await detectServerRegion();

  // 2. Initialize SQLite Database
  await initBtcTideSqlite();
  currentActiveTrade = getActiveTradeFromSqlite();
  currentClosedTrades = getClosedTradesFromSqlite(300);
  lastSignalTime = getLastSignalTimeFromSqlite();
  console.log(
    `[BTC TIDE BACKEND] SQLite loaded: ${currentClosedTrades.length} closed trades, active: ${
      currentActiveTrade?.id || 'none'
    }`
  );

  // 3. Connect to Spot & Order Book streams
  connectBinanceWs('binance_primary');
  connectBinanceWs('binance_vision');
  connectBybitWs();
  connectOkxWs();

  // 4. Connect to Futures / Liquidations WebSockets
  connectBinanceFutures();
  connectBybitLinearWs();

  // 5. Initial Perps, Venues & 1H ATR polling + recurring timers
  await Promise.all([
    pollBackendVenues(),
    pollPerpsMarkFundingAndLiqs(),
    pollPerpsOiAndLongShort(),
    pollBtc1hAtr(),
  ]);

  if (venuesPollTimer) clearInterval(venuesPollTimer);
  venuesPollTimer = setInterval(pollBackendVenues, 3000);

  if (perpsFastPollTimer) clearInterval(perpsFastPollTimer);
  perpsFastPollTimer = setInterval(pollPerpsMarkFundingAndLiqs, 4000);

  // Open Interest & Long/Short polled every 10s and stored in SQLite
  if (perpsOiPollTimer) clearInterval(perpsOiPollTimer);
  perpsOiPollTimer = setInterval(pollPerpsOiAndLongShort, 10000);

  if (atr1hPollTimer) clearInterval(atr1hPollTimer);
  atr1hPollTimer = setInterval(pollBtc1hAtr, 60000);

  // 6. Start 1-sec Engine Watchdog
  startBackendWatchdog();

  console.log('[BTC TIDE BACKEND] 24/7 Engine is active with real depth20, multi-source perps, 1H ATR, and 9 venues.');
}

export function shutdownBtcTideBackend(): void {
  console.log('[BTC TIDE BACKEND] Gracefully shutting down...');
  if (engineWatchdogTimer) clearInterval(engineWatchdogTimer);
  if (broadcastTimer) clearTimeout(broadcastTimer);
  if (perpsFastPollTimer) clearInterval(perpsFastPollTimer);
  if (perpsOiPollTimer) clearInterval(perpsOiPollTimer);
  if (venuesPollTimer) clearInterval(venuesPollTimer);
  if (atr1hPollTimer) clearInterval(atr1hPollTimer);

  for (const s of sourceStates.values()) {
    if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
    if (s.ws) {
      try {
        s.ws.close();
      } catch {}
    }
  }

  try {
    if (binanceFuturesWs) binanceFuturesWs.close();
    if (bybitLinearWs) bybitLinearWs.close();
  } catch {}

  persistSqliteToDisk();
  console.log('[BTC TIDE BACKEND] Shutdown complete. Database persisted.');
}
