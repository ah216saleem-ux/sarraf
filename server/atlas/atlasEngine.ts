// server/atlas/atlasEngine.ts
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../../src/server/deploymentSafety';
import { getClosedCandles, Candle } from '../../src/server/candleEngine';
import { getMarketSchedule, getLastValidTick } from '../../src/server/marketPriceEngine';
import {
  AtlasState,
  AtlasZone,
  AtlasPivotLevels,
  AtlasBias,
  AtlasScenario,
  AtlasIndicators,
  AtlasLiveTradeState,
  AtlasGrade,
  AtlasZoneStatus,
  AtlasBreakInfo,
  AtlasZoneReportItem,
  AtlasReportCard,
  AtlasHistoryEntry,
  TimeframeTrend,
  AtlasLiquidityLevel,
  AtlasAlertLogItem,
  AtlasSummary,
} from './atlasTypes';
import {
  calculateATR,
  calculateEMA,
  calculateRSI,
  findSwings,
  countZoneTouches,
  aggregateWeeklyCandles,
  aggregateMonthlyCandles,
  computeTimeframeTrend,
  computeParticipationRatio,
} from './indicators';
import { sendTelegramHttpRequest, getEffectiveTelegramChatId } from '../../src/server/telegramWorker';

const ATLAS_ZONES_FILE = path.resolve(DATA_DIR, 'atlas_zones.json');
const ATLAS_HISTORY_FILE = path.resolve(DATA_DIR, 'atlas_history.json');
const ATLAS_ALERTS_FILE = path.resolve(DATA_DIR, 'atlas_alerts_config.json');
const ROLLOVER_HOUR_DEFAULT = 22; // 22:00 UTC (5 PM New York)

interface FrozenAtlasPayload {
  date: string;
  publishedAt: string;
  nextPublishAt: string;
  prevDayCandle: {
    date: string;
    high: number;
    low: number;
    close: number;
  };
  pivots: AtlasPivotLevels;
  zones: AtlasZone[];
  bias: AtlasBias;
  scenarios: {
    main: AtlasScenario;
    alternate: AtlasScenario;
  };
  targets: {
    sell: { label: string; price: number }[];
    buy: { label: string; price: number }[];
  };
  invalidation: {
    sell: string;
    buy: string;
  };
}

let currentPublishedPayload: FrozenAtlasPayload | null = null;
let currentStatus: 'PUBLISHED' | 'ANALYZING' = 'PUBLISHED';
let lastProcessedD1OpenTime: string = '';
let lastEvaluatedTickPrice: number = 0;
let lastTickTimestamp: number = Date.now();

// SSE Clients for /api/atlas/stream
interface AtlasSseClient {
  id: string;
  res: any;
  req: any;
}
const atlasSseClients = new Map<string, AtlasSseClient>();

function getRolloverUtcHour(): number {
  const envVal = process.env.ATLAS_ROLLOVER_UTC_HOUR;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 23) {
      return parsed;
    }
  }
  return ROLLOVER_HOUR_DEFAULT;
}

// Format duration into hh:mm:ss
function formatCountdown(sec: number): string {
  if (sec <= 0) return 'NEW ZONES IN 00:00:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const hh = h.toString().padStart(2, '0');
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return `NEW ZONES IN ${hh}:${mm}:${ss}`;
}

// Calculate the next publish timestamp (Rollover + 60 min)
function computeNextPublishTimestamp(nowMs: number = Date.now()): number {
  const rolloverHour = getRolloverUtcHour();
  const d = new Date(nowMs);
  const currentUtcHour = d.getUTCHours();
  const currentUtcMinute = d.getUTCMinutes();

  const publishTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), rolloverHour + 1, 0, 0, 0));

  // If we are currently past rollover+1 hour today, target tomorrow's publish time
  if (currentUtcHour > rolloverHour + 1 || (currentUtcHour === rolloverHour + 1 && currentUtcMinute > 0)) {
    publishTarget.setUTCDate(publishTarget.getUTCDate() + 1);
  }

  return publishTarget.getTime();
}

// Load frozen set from disk
function loadFromDisk(): boolean {
  try {
    if (fs.existsSync(ATLAS_ZONES_FILE)) {
      const raw = fs.readFileSync(ATLAS_ZONES_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.date && parsed.pivots && Array.isArray(parsed.zones)) {
        currentPublishedPayload = parsed;
        currentStatus = 'PUBLISHED';
        console.log(`[ATLAS ENGINE] Loaded frozen Atlas set from disk for date ${parsed.date}.`);
        return true;
      }
    }
  } catch (err: any) {
    console.warn('[ATLAS ENGINE] Error loading atlas_zones.json from disk:', err.message);
  }
  return false;
}

// Save frozen set to disk
function saveToDisk(payload: FrozenAtlasPayload) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(ATLAS_ZONES_FILE, JSON.stringify(payload, null, 2), 'utf-8');

    // Also append to atlas_history.json
    let history: FrozenAtlasPayload[] = [];
    if (fs.existsSync(ATLAS_HISTORY_FILE)) {
      try {
        const rawHistory = fs.readFileSync(ATLAS_HISTORY_FILE, 'utf-8');
        const parsed = JSON.parse(rawHistory);
        if (Array.isArray(parsed)) history = parsed;
      } catch {}
    }
    // Remove duplicate entry for same date if any
    history = history.filter((h) => h.date !== payload.date);
    history.push(payload);
    if (history.length > 60) history = history.slice(-60); // keep last 60 days
    fs.writeFileSync(ATLAS_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
    console.log(`[ATLAS ENGINE] Saved published Atlas set to disk for date ${payload.date}.`);
  } catch (err: any) {
    console.error('[ATLAS ENGINE] Error saving atlas_zones.json to disk:', err.message);
  }
}

// Compute Classic Daily Pivots, Zones, Bias, and Scenarios
export function computeAtlasZonesAndScenarios(): FrozenAtlasPayload | null {
  const d1Closed = getClosedCandles('D1');
  if (!d1Closed || d1Closed.length < 1) {
    console.warn('[ATLAS ENGINE] Cannot compute Atlas zones: No closed D1 candles available.');
    return null;
  }

  // 1. Prev day's H, L, C from the closed D1 candle only
  const prevD1 = d1Closed[d1Closed.length - 1];
  const H = Number(prevD1.high.toFixed(2));
  const L = Number(prevD1.low.toFixed(2));
  const C = Number(prevD1.close.toFixed(2));
  const dateStr = prevD1.openTime.slice(0, 10);

  // 2. Classic Daily Pivots
  const PP = Number(((H + L + C) / 3).toFixed(2));
  const R1 = Number((2 * PP - L).toFixed(2));
  const S1 = Number((2 * PP - H).toFixed(2));
  const R2 = Number((PP + (H - L)).toFixed(2));
  const S2 = Number((PP - (H - L)).toFixed(2));
  const R3 = Number((H + 2 * (PP - L)).toFixed(2));
  const S3 = Number((L - 2 * (H - PP)).toFixed(2));

  const pivots: AtlasPivotLevels = { H, L, C, PP, R1, S1, R2, S2, R3, S3 };

  // 3. ATR(14, H1) and Zone Box Width
  const h1Closed = getClosedCandles('H1');
  const h4Closed = getClosedCandles('H4');
  const atrH1 = calculateATR(h1Closed, 14);
  const halfWidth = Math.max(2.0, Number((0.2 * atrH1).toFixed(2)));

  // 4. Swings detection on H4 and D1 for Grade A qualification (5 bars each side)
  const d1Swings = findSwings(d1Closed, 5);
  const h4Swings = findSwings(h4Closed, 5);
  const allSwingLevels = [...d1Swings.highs, ...d1Swings.lows, ...h4Swings.highs, ...h4Swings.lows];

  // Weekly pivots for Grade A qualification
  const wCandles = aggregateWeeklyCandles(d1Closed);
  let weeklyPivots: number[] = [];
  if (wCandles && wCandles.length >= 2) {
    const prevW = wCandles[wCandles.length - 2];
    const wH = prevW.high;
    const wL = prevW.low;
    const wC = prevW.close;
    const wPP = (wH + wL + wC) / 3;
    const wR1 = 2 * wPP - wL;
    const wS1 = 2 * wPP - wH;
    const wR2 = wPP + (wH - wL);
    const wS2 = wPP - (wH - wL);
    weeklyPivots = [wPP, wR1, wS1, wR2, wS2];
  }

  // Temporary liquidity levels for Grade A qualification
  const tempLiquidity = computeLiquidityLevels(
    h1Closed.slice(-24),
    d1Closed,
    { high: prevD1.high, low: prevD1.low, close: prevD1.close, date: prevD1.openTime.slice(0, 10) },
    C
  );

  // Helper to grade zone according to 4 criteria:
  // 1) overlaps HTF swing pivot, 2) >= 2 distinct touches, 3) intact liquidity within 0.3*ATR, 4) overlaps weekly pivot
  const evaluateZoneGrade = (
    zoneLevel: number,
    top: number,
    bottom: number,
    levelName: string
  ): { grade: AtlasGrade; touchesCount: number; confluences: string[]; reason: string } => {
    // Distinct touches over last 20 trading days
    const touchesCount = countZoneTouches(h1Closed, top, bottom, 20);
    const confluences: string[] = [];
    const threshold = Math.max(2.0, 0.3 * atrH1);

    // 1. Overlaps HTF swing pivot
    const swingMatch = allSwingLevels.find((sw) => sw >= bottom - threshold && sw <= top + threshold);
    if (swingMatch !== undefined) {
      confluences.push(`Overlaps HTF swing pivot ($${swingMatch.toFixed(2)})`);
    }

    // 2. >= 2 distinct touches
    if (touchesCount >= 2) {
      confluences.push(`${touchesCount} distinct touches in last 20d`);
    }

    // 3. Intact liquidity level within 0.3*ATR
    const intactLiq = tempLiquidity.find(
      (l) => l.status === 'INTACT' && Math.abs(l.price - zoneLevel) <= threshold
    );
    if (intactLiq) {
      confluences.push(`Intact ${intactLiq.label} ($${intactLiq.price.toFixed(2)})`);
    }

    // 4. Overlaps a weekly pivot
    const weeklyMatch = weeklyPivots.find((wp) => wp >= bottom - threshold && wp <= top + threshold);
    if (weeklyMatch !== undefined) {
      confluences.push(`Overlaps Weekly Pivot ($${weeklyMatch.toFixed(2)})`);
    }

    const grade: AtlasGrade = confluences.length >= 2 ? 'A' : 'B';
    const reason =
      confluences.length > 0
        ? confluences.join(' · ')
        : `Standard pivot band (${touchesCount} touches in last 20d)`;

    return { grade, touchesCount, confluences, reason };
  };

  // Build the 7 zones
  const r3Grade = evaluateZoneGrade(R3, R3 + halfWidth, R3 - halfWidth, 'R3');
  const r2Grade = evaluateZoneGrade(R2, R2 + halfWidth, R2 - halfWidth, 'R2');
  const r1Grade = evaluateZoneGrade(R1, R1 + halfWidth, R1 - halfWidth, 'R1');
  const ppGrade = evaluateZoneGrade(PP, PP + halfWidth, PP - halfWidth, 'PP');
  const s1Grade = evaluateZoneGrade(S1, S1 + halfWidth, S1 - halfWidth, 'S1');
  const s2Grade = evaluateZoneGrade(S2, S2 + halfWidth, S2 - halfWidth, 'S2');
  const s3Grade = evaluateZoneGrade(S3, S3 + halfWidth, S3 - halfWidth, 'S3');

  const zones: AtlasZone[] = [
    {
      id: 'R3',
      name: 'R3 Supply',
      level: R3,
      top: Number((R3 + halfWidth).toFixed(2)),
      bottom: Number((R3 - halfWidth).toFixed(2)),
      halfWidth,
      side: 'SELL',
      type: 'SUPPLY',
      tier: 'T3 EXTREME',
      grade: r3Grade.grade,
      touchesCount: r3Grade.touchesCount,
      reason: r3Grade.reason,
      confluenceList: r3Grade.confluences,
      status: 'FRESH',
      touchesToday: 0,
      isFlipped: false,
      breakInfo: null,
    },
    {
      id: 'R2',
      name: 'R2 Supply',
      level: R2,
      top: Number((R2 + halfWidth).toFixed(2)),
      bottom: Number((R2 - halfWidth).toFixed(2)),
      halfWidth,
      side: 'SELL',
      type: 'SUPPLY',
      tier: 'T2 STRONG',
      grade: r2Grade.grade,
      touchesCount: r2Grade.touchesCount,
      reason: r2Grade.reason,
      confluenceList: r2Grade.confluences,
      status: 'FRESH',
      touchesToday: 0,
      isFlipped: false,
      breakInfo: null,
    },
    {
      id: 'R1',
      name: 'R1 Supply',
      level: R1,
      top: Number((R1 + halfWidth).toFixed(2)),
      bottom: Number((R1 - halfWidth).toFixed(2)),
      halfWidth,
      side: 'SELL',
      type: 'SUPPLY',
      tier: 'T1 PRIMARY',
      grade: r1Grade.grade,
      touchesCount: r1Grade.touchesCount,
      reason: r1Grade.reason,
      confluenceList: r1Grade.confluences,
      status: 'FRESH',
      touchesToday: 0,
      isFlipped: false,
      breakInfo: null,
    },
    {
      id: 'PP',
      name: 'SARRAF ZONE',
      level: PP,
      top: Number((PP + halfWidth).toFixed(2)),
      bottom: Number((PP - halfWidth).toFixed(2)),
      halfWidth,
      side: 'NEUTRAL',
      type: 'SARRAF_ZONE',
      tier: 'SARRAF ZONE',
      grade: ppGrade.grade,
      touchesCount: ppGrade.touchesCount,
      reason: ppGrade.reason,
      confluenceList: ppGrade.confluences,
      status: 'FRESH',
      touchesToday: 0,
      isFlipped: false,
      breakInfo: null,
    },
    {
      id: 'S1',
      name: 'S1 Demand',
      level: S1,
      top: Number((S1 + halfWidth).toFixed(2)),
      bottom: Number((S1 - halfWidth).toFixed(2)),
      halfWidth,
      side: 'BUY',
      type: 'DEMAND',
      tier: 'T1 PRIMARY',
      grade: s1Grade.grade,
      touchesCount: s1Grade.touchesCount,
      reason: s1Grade.reason,
      confluenceList: s1Grade.confluences,
      status: 'FRESH',
      touchesToday: 0,
      isFlipped: false,
      breakInfo: null,
    },
    {
      id: 'S2',
      name: 'S2 Demand',
      level: S2,
      top: Number((S2 + halfWidth).toFixed(2)),
      bottom: Number((S2 - halfWidth).toFixed(2)),
      halfWidth,
      side: 'BUY',
      type: 'DEMAND',
      tier: 'T2 STRONG',
      grade: s2Grade.grade,
      touchesCount: s2Grade.touchesCount,
      reason: s2Grade.reason,
      confluenceList: s2Grade.confluences,
      status: 'FRESH',
      touchesToday: 0,
      isFlipped: false,
      breakInfo: null,
    },
    {
      id: 'S3',
      name: 'S3 Demand',
      level: S3,
      top: Number((S3 + halfWidth).toFixed(2)),
      bottom: Number((S3 - halfWidth).toFixed(2)),
      halfWidth,
      side: 'BUY',
      type: 'DEMAND',
      tier: 'T3 EXTREME',
      grade: s3Grade.grade,
      touchesCount: s3Grade.touchesCount,
      reason: s3Grade.reason,
      confluenceList: s3Grade.confluences,
      status: 'FRESH',
      touchesToday: 0,
      isFlipped: false,
      breakInfo: null,
    },
  ];

  // 5. Multi-timeframe trend for MN, W1, D1, H4, H1
  const w1Candles = aggregateWeeklyCandles(d1Closed);
  const mnCandles = aggregateMonthlyCandles(d1Closed);

  const tW1 = computeTimeframeTrend(w1Candles, 'W1', 3);
  const tD1 = computeTimeframeTrend(d1Closed, 'D1', 3);
  const tH4 = computeTimeframeTrend(h4Closed, 'H4', 2);
  const tH1 = computeTimeframeTrend(h1Closed, 'H1', 1);
  const tMN = computeTimeframeTrend(mnCandles, 'MN', 1);

  const timeframes: TimeframeTrend[] = [tMN, tW1, tD1, tH4, tH1];

  // Weighted score calculation
  let weightedScore = 0;
  for (const tf of timeframes) {
    if (tf.trend === 'BULLISH') weightedScore += tf.weight;
    else if (tf.trend === 'BEARISH') weightedScore -= tf.weight;
  }

  let overallBias: 'BULLISH' | 'BEARISH' | 'RANGE' = 'RANGE';
  let strategy: 'BUY_DIP' | 'SELL_RALLY' | 'RANGE_PLAY' = 'RANGE_PLAY';
  let strategyLabel = 'Range play between daily bounds';

  if (weightedScore > 1) {
    overallBias = 'BULLISH';
    strategy = 'BUY_DIP';
    strategyLabel = 'Buy-the-dip preferred (Bullish HTF alignment)';
  } else if (weightedScore < -1) {
    overallBias = 'BEARISH';
    strategy = 'SELL_RALLY';
    strategyLabel = 'Sell-the-rally preferred (Bearish HTF alignment)';
  }

  const bias: AtlasBias = {
    overall: overallBias,
    strategy,
    strategyLabel,
    score: weightedScore,
    timeframes,
  };

  // 6. Targets and Invalidation
  const targets = {
    sell: [
      { label: 'TP1 (PP / Pivot)', price: PP },
      { label: 'TP2 (S1 Demand)', price: S1 },
      { label: 'TP3 (S2 Strong)', price: S2 },
      { label: 'TP4 (S3 Extreme)', price: S3 },
    ],
    buy: [
      { label: 'TP1 (PP / Pivot)', price: PP },
      { label: 'TP2 (R1 Supply)', price: R1 },
      { label: 'TP3 (R2 Strong)', price: R2 },
      { label: 'TP4 (R3 Extreme)', price: R3 },
    ],
  };

  const invalidation = {
    sell: `H1 close above R1 Supply top ($${(R1 + halfWidth).toFixed(2)})`,
    buy: `H1 close below S1 Demand bottom ($${(S1 - halfWidth).toFixed(2)})`,
  };

  // 7. Scenarios: MAIN and ALTERNATE
  let mainScenario: AtlasScenario;
  let alternateScenario: AtlasScenario;

  if (overallBias === 'BEARISH') {
    mainScenario = {
      type: 'MAIN',
      title: 'PRIMARY: Institutional Supply Rejection',
      bias: 'BEARISH (Sell-the-Rally)',
      description: `Sell rallies entering R1 Supply ($${(R1 - halfWidth).toFixed(2)} - $${(R1 + halfWidth).toFixed(2)}). Confirmation via M15 rejection wick.`,
      triggerZone: `R1 Supply ($${R1.toFixed(2)})`,
      invalidation: `H1 close above $${(R1 + halfWidth).toFixed(2)}`,
      targets: [
        { label: 'Target 1 (PP)', price: PP },
        { label: 'Target 2 (S1)', price: S1 },
        { label: 'Target 3 (S2)', price: S2 },
      ],
    };
    alternateScenario = {
      type: 'ALTERNATE',
      title: 'ALTERNATE: Bullish Supply Breakout',
      bias: 'BULLISH INVASION',
      description: `If price breaks above R1 top ($${(R1 + halfWidth).toFixed(2)}) on H1 close, short bias is invalidated. Look for continuation to R2 & R3.`,
      triggerZone: `Above R1 ($${(R1 + halfWidth).toFixed(2)})`,
      invalidation: `Failure to hold above $${R1.toFixed(2)}`,
      targets: [
        { label: 'Target 1 (R2)', price: R2 },
        { label: 'Target 2 (R3)', price: R3 },
      ],
    };
  } else if (overallBias === 'BULLISH') {
    mainScenario = {
      type: 'MAIN',
      title: 'PRIMARY: Institutional Demand Absorption',
      bias: 'BULLISH (Buy-the-Dip)',
      description: `Buy pullbacks into S1 Demand ($${(S1 - halfWidth).toFixed(2)} - $${(S1 + halfWidth).toFixed(2)}). Confirmation via M15 absorption candle.`,
      triggerZone: `S1 Demand ($${S1.toFixed(2)})`,
      invalidation: `H1 close below $${(S1 - halfWidth).toFixed(2)}`,
      targets: [
        { label: 'Target 1 (PP)', price: PP },
        { label: 'Target 2 (R1)', price: R1 },
        { label: 'Target 3 (R2)', price: R2 },
      ],
    };
    alternateScenario = {
      type: 'ALTERNATE',
      title: 'ALTERNATE: Bearish Demand Breakdown',
      bias: 'BEARISH BREAKDOWN',
      description: `If price closes below S1 bottom ($${(S1 - halfWidth).toFixed(2)}) on H1, demand is breached. Expect accelerated selloff toward S2 & S3.`,
      triggerZone: `Below S1 ($${(S1 - halfWidth).toFixed(2)})`,
      invalidation: `Reclaim back above $${S1.toFixed(2)}`,
      targets: [
        { label: 'Target 1 (S2)', price: S2 },
        { label: 'Target 2 (S3)', price: S3 },
      ],
    };
  } else {
    mainScenario = {
      type: 'MAIN',
      title: 'PRIMARY: Range Equilibrium Fades',
      bias: 'NEUTRAL (Range Fade)',
      description: `Trade boundaries between R1 ($${R1.toFixed(2)}) and S1 ($${S1.toFixed(2)}) with central mean reversion toward SARRAF ZONE ($${PP.toFixed(2)}).`,
      triggerZone: `R1 or S1 Boundaries`,
      invalidation: `H1 close beyond R1 top or S1 bottom`,
      targets: [
        { label: 'Central Target (PP)', price: PP },
        { label: 'Opposing Edge', price: R1 },
      ],
    };
    alternateScenario = {
      type: 'ALTERNATE',
      title: 'ALTERNATE: Directional Trend Expansion',
      bias: 'EXPANSION BREAKOUT',
      description: `Strong directional impulse closing outside the R1/S1 corridor triggers trend-following continuation to T2/T3 extreme levels.`,
      triggerZone: `Outside R1-S1 corridor`,
      invalidation: `False breakout closing back inside PP`,
      targets: [
        { label: 'Upper Expansion', price: R2 },
        { label: 'Lower Expansion', price: S2 },
      ],
    };
  }

  const nowMs = Date.now();
  const nextPublishMs = computeNextPublishTimestamp(nowMs);

  return {
    date: dateStr,
    publishedAt: new Date(nowMs).toISOString(),
    nextPublishAt: new Date(nextPublishMs).toISOString(),
    prevDayCandle: {
      date: prevD1.openTime.slice(0, 10),
      high: H,
      low: L,
      close: C,
    },
    pivots,
    zones,
    bias,
    scenarios: {
      main: mainScenario,
      alternate: alternateScenario,
    },
    targets,
    invalidation,
  };
}

// Compute live trade state based on current price
function computeLiveTradeState(livePrice: number, zones: AtlasZone[]): AtlasLiveTradeState {
  if (livePrice <= 0 || zones.length === 0) {
    return {
      status: 'STANDBY',
      activeZone: null,
      entrySide: null,
      entryPrice: null,
      distanceToEntry: 0,
      livePnLPoints: 0,
      nearestZone: null,
    };
  }

  // Check if price is inside any zone
  let activeZone: AtlasZone | null = null;
  for (const z of zones) {
    if (livePrice >= z.bottom && livePrice <= z.top) {
      activeZone = z;
      break;
    }
  }

  if (activeZone) {
    const entrySide = activeZone.side === 'SELL' ? 'SELL' : activeZone.side === 'BUY' ? 'BUY' : null;
    const entryPrice = activeZone.level;
    const distanceToEntry = Number(Math.abs(livePrice - entryPrice).toFixed(2));
    const livePnLPoints =
      entrySide === 'BUY'
        ? Number((livePrice - entryPrice).toFixed(2))
        : entrySide === 'SELL'
        ? Number((entryPrice - livePrice).toFixed(2))
        : 0;

    return {
      status: 'IN_ZONE',
      activeZone,
      entrySide,
      entryPrice,
      distanceToEntry,
      livePnLPoints,
      nearestZone: {
        id: activeZone.id,
        name: activeZone.name,
        distance: distanceToEntry,
        side: activeZone.side,
      },
    };
  }

  // STANDBY: find nearest zone
  let nearest: { id: string; name: string; distance: number; side: AtlasZone['side'] } | null = null;
  let minDiff = Infinity;

  for (const z of zones) {
    let diff = 0;
    if (livePrice > z.top) {
      diff = livePrice - z.top;
    } else if (livePrice < z.bottom) {
      diff = z.bottom - livePrice;
    }
    if (diff < minDiff) {
      minDiff = diff;
      nearest = {
        id: z.id,
        name: z.name,
        distance: Number(diff.toFixed(2)),
        side: z.side,
      };
    }
  }

  return {
    status: 'STANDBY',
    activeZone: null,
    entrySide: null,
    entryPrice: null,
    distanceToEntry: minDiff < Infinity ? Number(minDiff.toFixed(2)) : 0,
    livePnLPoints: 0,
    nearestZone: nearest,
  };
}

// Compute live indicators
function computeLiveIndicators(): AtlasIndicators | null {
  const h1Closed = getClosedCandles('H1');
  if (!h1Closed || h1Closed.length < 5) return null;

  const atr14 = calculateATR(h1Closed, 14);
  const ema50 = calculateEMA(h1Closed, 50) || h1Closed[h1Closed.length - 1].close;
  const ema100 = calculateEMA(h1Closed, 100) || h1Closed[h1Closed.length - 1].close;
  const ema200 = calculateEMA(h1Closed, 200) || h1Closed[h1Closed.length - 1].close;
  const part = computeParticipationRatio(h1Closed);

  return {
    atr14,
    ema50,
    ema100,
    ema200,
    participationRatio: part.ratio,
    participationLabel: 'participation proxy',
    participationStatus: part.status,
  };
}

// Update Zone Status: FRESH, TESTED, or BROKEN with flip
export function evaluateLiveZoneStatus(
  baseZones: AtlasZone[],
  allClosedH1Candles: Candle[],
  publishedAtIso: string | null,
  livePrice: number
): AtlasZone[] {
  if (!baseZones || baseZones.length === 0) return [];

  const publishedAtMs = publishedAtIso ? new Date(publishedAtIso).getTime() : 0;

  // CRITICAL REQUIREMENT 2: Use ONLY H1 candles that CLOSED AFTER the set's publishTime.
  const postPublishCandles = (allClosedH1Candles || []).filter((c) => {
    const ts = new Date(c.openTime).getTime();
    return !isNaN(ts) && ts >= publishedAtMs;
  });

  const rollingAvgVol =
    allClosedH1Candles.length > 0
      ? allClosedH1Candles.slice(-20).reduce((s, c) => s + (c.volume || 0), 0) / Math.min(20, allClosedH1Candles.length)
      : 1000;

  return baseZones.map((z) => {
    const zone: AtlasZone = { ...z };

    // PP / SARRAF ZONE is NEVER BROKEN or FLIPPED!
    if (zone.id === 'PP' || zone.side === 'NEUTRAL') {
      zone.status = 'FRESH';
      zone.isFlipped = false;
      zone.flippedRole = undefined;
      zone.breakInfo = null;

      if (livePrice > 0) {
        zone.ppRelation = livePrice >= zone.level ? 'ABOVE' : 'BELOW';
      }

      // Find last H1 candle that crossed PP after publishTime
      const lastCross = postPublishCandles.slice().reverse().find((c) => c.low <= zone.level && c.high >= zone.level);
      if (lastCross) {
        zone.ppLastCrossTime = lastCross.openTime;
        zone.status = 'TESTED';
      }

      const touches = postPublishCandles.filter((c) => c.high >= zone.bottom && c.low <= zone.top).length;
      const liveInside = livePrice >= zone.bottom && livePrice <= zone.top;
      zone.touchesToday = touches + (liveInside ? 1 : 0);
      if (zone.touchesToday > 0) zone.status = 'TESTED';

      return zone;
    }

    if (zone.side === 'SELL') {
      // Find H1 closes > zone.top AFTER publishTime
      const breachBars = postPublishCandles.filter((c) => c.close > zone.top);

      if (breachBars.length > 0) {
        const firstBreakBar = breachBars[0];
        const partRatio = Number(((firstBreakBar.volume || 1000) / (rollingAvgVol || 1)).toFixed(1));

        zone.status = 'BROKEN';

        // Check if there are 2 CONSECUTIVE H1 closes above zone.top
        let has2Consecutive = false;
        for (let i = 0; i < postPublishCandles.length - 1; i++) {
          if (postPublishCandles[i].close > zone.top && postPublishCandles[i + 1].close > zone.top) {
            has2Consecutive = true;
            break;
          }
        }

        if (has2Consecutive) {
          zone.isFlipped = true;
          zone.flippedRole = 'FLIPPED TO DEMAND';
        } else {
          zone.isFlipped = false;
          zone.flippedRole = undefined;
        }

        zone.breakInfo = {
          breakTime: firstBreakBar.openTime,
          breakCandleClose: firstBreakBar.close,
          participationRatio: partRatio,
          reason: `H1 close ${firstBreakBar.close.toFixed(2)} above ${zone.id} top ${zone.top.toFixed(2)}`,
        };
      } else {
        // Not broken: check for wick entry (TOUCH)
        const wickTouches = postPublishCandles.filter(
          (c) => c.high >= zone.bottom && c.low <= zone.top && c.close <= zone.top
        ).length;
        const liveInside = livePrice >= zone.bottom && livePrice <= zone.top;
        const total = wickTouches + (liveInside ? 1 : 0);
        zone.touchesToday = total;
        zone.status = total > 0 ? 'TESTED' : 'FRESH';
        zone.isFlipped = false;
        zone.breakInfo = null;
      }
    } else if (zone.side === 'BUY') {
      // Find H1 closes < zone.bottom AFTER publishTime
      const breachBars = postPublishCandles.filter((c) => c.close < zone.bottom);

      if (breachBars.length > 0) {
        const firstBreakBar = breachBars[0];
        const partRatio = Number(((firstBreakBar.volume || 1000) / (rollingAvgVol || 1)).toFixed(1));

        zone.status = 'BROKEN';

        // Check if there are 2 CONSECUTIVE H1 closes below zone.bottom
        let has2Consecutive = false;
        for (let i = 0; i < postPublishCandles.length - 1; i++) {
          if (postPublishCandles[i].close < zone.bottom && postPublishCandles[i + 1].close < zone.bottom) {
            has2Consecutive = true;
            break;
          }
        }

        if (has2Consecutive) {
          zone.isFlipped = true;
          zone.flippedRole = 'FLIPPED TO SUPPLY';
        } else {
          zone.isFlipped = false;
          zone.flippedRole = undefined;
        }

        zone.breakInfo = {
          breakTime: firstBreakBar.openTime,
          breakCandleClose: firstBreakBar.close,
          participationRatio: partRatio,
          reason: `H1 close ${firstBreakBar.close.toFixed(2)} below ${zone.id} bottom ${zone.bottom.toFixed(2)}`,
        };
      } else {
        // Not broken: check for wick entry (TOUCH)
        const wickTouches = postPublishCandles.filter(
          (c) => c.low <= zone.top && c.high >= zone.bottom && c.close >= zone.bottom
        ).length;
        const liveInside = livePrice >= zone.bottom && livePrice <= zone.top;
        const total = wickTouches + (liveInside ? 1 : 0);
        zone.touchesToday = total;
        zone.status = total > 0 ? 'TESTED' : 'FRESH';
        zone.isFlipped = false;
        zone.breakInfo = null;
      }
    }

    return zone;
  });
}

// -------------------------------------------------------------
// LIQUIDITY LEVELS: PDH/PDL, Asia H/L, London H/L, Prev Week H/L
// -------------------------------------------------------------
export function computeLiquidityLevels(
  sessionCandles: Candle[],
  d1Closed: Candle[],
  prevDayCandle: { high: number; low: number; close: number; date: string } | null,
  livePrice: number
): AtlasLiquidityLevel[] {
  const levels: AtlasLiquidityLevel[] = [];
  const allH1 = getClosedCandles('H1');
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  // 1. PDH & PDL (from previous day closed candle)
  if (prevDayCandle) {
    // PDH
    const pdhPrice = Number(prevDayCandle.high.toFixed(2));
    const pdhBreachedBars = sessionCandles.filter((c) => c.high > pdhPrice);
    const pdhSwept =
      pdhBreachedBars.length > 0 &&
      (pdhBreachedBars.some((c) => c.close <= pdhPrice) || (livePrice > 0 && livePrice <= pdhPrice));

    levels.push({
      id: 'PDH',
      label: 'Previous Day High (PDH)',
      price: pdhPrice,
      type: 'HIGH',
      status: pdhSwept ? 'SWEPT' : 'INTACT',
      sessionTime: prevDayCandle.date,
      distanceToLive: livePrice > 0 ? Number((pdhPrice - livePrice).toFixed(1)) : 0,
    });

    // PDL
    const pdlPrice = Number(prevDayCandle.low.toFixed(2));
    const pdlBreachedBars = sessionCandles.filter((c) => c.low < pdlPrice);
    const pdlSwept =
      pdlBreachedBars.length > 0 &&
      (pdlBreachedBars.some((c) => c.close >= pdlPrice) || (livePrice > 0 && livePrice >= pdlPrice));

    levels.push({
      id: 'PDL',
      label: 'Previous Day Low (PDL)',
      price: pdlPrice,
      type: 'LOW',
      status: pdlSwept ? 'SWEPT' : 'INTACT',
      sessionTime: prevDayCandle.date,
      distanceToLive: livePrice > 0 ? Number((livePrice - pdlPrice).toFixed(1)) : 0,
    });
  }

  // 2. Asia Session H/L (00:00 - 08:00 UTC)
  let asiaCandles = allH1.filter((c) => {
    const d = new Date(c.openTime);
    const h = d.getUTCHours();
    return c.openTime.startsWith(todayStr) && h >= 0 && h < 8;
  });
  let asiaDate = todayStr;
  if (asiaCandles.length === 0) {
    const yesterday = new Date(now.getTime() - 86400000);
    const yStr = yesterday.toISOString().slice(0, 10);
    asiaCandles = allH1.filter((c) => {
      const d = new Date(c.openTime);
      const h = d.getUTCHours();
      return c.openTime.startsWith(yStr) && h >= 0 && h < 8;
    });
    asiaDate = yStr;
  }

  if (asiaCandles.length > 0) {
    const asiaHigh = Number(Math.max(...asiaCandles.map((c) => c.high)).toFixed(2));
    const asiaLow = Number(Math.min(...asiaCandles.map((c) => c.low)).toFixed(2));

    const lastAsiaBar = asiaCandles[asiaCandles.length - 1];
    const postAsiaBars = allH1.filter((c) => c.openTime > lastAsiaBar.openTime);

    const asiaHighBreached = postAsiaBars.filter((c) => c.high > asiaHigh);
    const asiaHighSwept =
      asiaHighBreached.length > 0 &&
      (asiaHighBreached.some((c) => c.close <= asiaHigh) || (livePrice > 0 && livePrice <= asiaHigh));

    levels.push({
      id: 'ASIA_HIGH',
      label: 'Asia Session High (00-08 UTC)',
      price: asiaHigh,
      type: 'HIGH',
      status: asiaHighSwept ? 'SWEPT' : 'INTACT',
      sessionTime: `${asiaDate} 00:00-08:00 UTC`,
      distanceToLive: livePrice > 0 ? Number((asiaHigh - livePrice).toFixed(1)) : 0,
    });

    const asiaLowBreached = postAsiaBars.filter((c) => c.low < asiaLow);
    const asiaLowSwept =
      asiaLowBreached.length > 0 &&
      (asiaLowBreached.some((c) => c.close >= asiaLow) || (livePrice > 0 && livePrice >= asiaLow));

    levels.push({
      id: 'ASIA_LOW',
      label: 'Asia Session Low (00-08 UTC)',
      price: asiaLow,
      type: 'LOW',
      status: asiaLowSwept ? 'SWEPT' : 'INTACT',
      sessionTime: `${asiaDate} 00:00-08:00 UTC`,
      distanceToLive: livePrice > 0 ? Number((livePrice - asiaLow).toFixed(1)) : 0,
    });
  }

  // 3. London Session H/L (08:00 - 16:00 UTC)
  let londonCandles = allH1.filter((c) => {
    const d = new Date(c.openTime);
    const h = d.getUTCHours();
    return c.openTime.startsWith(todayStr) && h >= 8 && h < 16;
  });
  let londonDate = todayStr;
  if (londonCandles.length === 0) {
    const yesterday = new Date(now.getTime() - 86400000);
    const yStr = yesterday.toISOString().slice(0, 10);
    londonCandles = allH1.filter((c) => {
      const d = new Date(c.openTime);
      const h = d.getUTCHours();
      return c.openTime.startsWith(yStr) && h >= 8 && h < 16;
    });
    londonDate = yStr;
  }

  if (londonCandles.length > 0) {
    const londonHigh = Number(Math.max(...londonCandles.map((c) => c.high)).toFixed(2));
    const londonLow = Number(Math.min(...londonCandles.map((c) => c.low)).toFixed(2));

    const lastLondonBar = londonCandles[londonCandles.length - 1];
    const postLondonBars = allH1.filter((c) => c.openTime > lastLondonBar.openTime);

    const londonHighBreached = postLondonBars.filter((c) => c.high > londonHigh);
    const londonHighSwept =
      londonHighBreached.length > 0 &&
      (londonHighBreached.some((c) => c.close <= londonHigh) || (livePrice > 0 && livePrice <= londonHigh));

    levels.push({
      id: 'LONDON_HIGH',
      label: 'London Session High (08-16 UTC)',
      price: londonHigh,
      type: 'HIGH',
      status: londonHighSwept ? 'SWEPT' : 'INTACT',
      sessionTime: `${londonDate} 08:00-16:00 UTC`,
      distanceToLive: livePrice > 0 ? Number((londonHigh - livePrice).toFixed(1)) : 0,
    });

    const londonLowBreached = postLondonBars.filter((c) => c.low < londonLow);
    const londonLowSwept =
      londonLowBreached.length > 0 &&
      (londonLowBreached.some((c) => c.close >= londonLow) || (livePrice > 0 && livePrice >= londonLow));

    levels.push({
      id: 'LONDON_LOW',
      label: 'London Session Low (08-16 UTC)',
      price: londonLow,
      type: 'LOW',
      status: londonLowSwept ? 'SWEPT' : 'INTACT',
      sessionTime: `${londonDate} 08:00-16:00 UTC`,
      distanceToLive: livePrice > 0 ? Number((livePrice - londonLow).toFixed(1)) : 0,
    });
  }

  // 4. Previous Week H/L (PWH / PWL)
  if (d1Closed && d1Closed.length >= 6) {
    const dayOfWeek = now.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const currentWeekCount = Math.max(1, Math.min(daysSinceMonday + 1, 5));
    const pwBars = d1Closed.slice(-currentWeekCount - 5, -currentWeekCount);

    if (pwBars.length > 0) {
      const pwHigh = Number(Math.max(...pwBars.map((c) => c.high)).toFixed(2));
      const pwLow = Number(Math.min(...pwBars.map((c) => c.low)).toFixed(2));

      const recentBars = allH1.slice(-120);
      const pwHighBreached = recentBars.filter((c) => c.high > pwHigh);
      const pwHighSwept =
        pwHighBreached.length > 0 &&
        (pwHighBreached.some((c) => c.close <= pwHigh) || (livePrice > 0 && livePrice <= pwHigh));

      levels.push({
        id: 'PREV_WEEK_HIGH',
        label: 'Previous Week High (PWH)',
        price: pwHigh,
        type: 'HIGH',
        status: pwHighSwept ? 'SWEPT' : 'INTACT',
        sessionTime: 'Prior Calendar Week',
        distanceToLive: livePrice > 0 ? Number((pwHigh - livePrice).toFixed(1)) : 0,
      });

      const pwLowBreached = recentBars.filter((c) => c.low < pwLow);
      const pwLowSwept =
        pwLowBreached.length > 0 &&
        (pwLowBreached.some((c) => c.close >= pwLow) || (livePrice > 0 && livePrice >= pwLow));

      levels.push({
        id: 'PREV_WEEK_LOW',
        label: 'Previous Week Low (PWL)',
        price: pwLow,
        type: 'LOW',
        status: pwLowSwept ? 'SWEPT' : 'INTACT',
        sessionTime: 'Prior Calendar Week',
        distanceToLive: livePrice > 0 ? Number((livePrice - pwLow).toFixed(1)) : 0,
      });
    }
  }

  return levels;
}

// Upgrade zones near intact liquidity levels to Grade A with LIQUIDITY badge
export function applyLiquidityConfluenceToZones(
  zones: AtlasZone[],
  liquidityLevels: AtlasLiquidityLevel[],
  atr14: number
): AtlasZone[] {
  const threshold = Math.max(2, 0.3 * atr14);

  return zones.map((z) => {
    const zone: AtlasZone = { ...z };

    if (zone.side === 'SELL') {
      const intactHighs = liquidityLevels.filter((l) => l.type === 'HIGH' && l.status === 'INTACT');
      const aligned = intactHighs.find(
        (h) =>
          Math.abs(zone.level - h.price) <= threshold ||
          Math.abs(zone.bottom - h.price) <= threshold ||
          Math.abs(zone.top - h.price) <= threshold ||
          (h.price >= zone.bottom - threshold && h.price <= zone.top + threshold)
      );
      if (aligned) {
        zone.hasLiquidityBadge = true;
        zone.grade = 'A';
        zone.liquidityReason = `Confluence with intact ${aligned.label} ($${aligned.price.toFixed(2)})`;
        if (!zone.reason.includes('LIQUIDITY:')) {
          zone.reason = `${zone.reason} · LIQUIDITY: ${aligned.label} ($${aligned.price.toFixed(2)})`;
        }
      }
    } else if (zone.side === 'BUY') {
      const intactLows = liquidityLevels.filter((l) => l.type === 'LOW' && l.status === 'INTACT');
      const aligned = intactLows.find(
        (l) =>
          Math.abs(zone.level - l.price) <= threshold ||
          Math.abs(zone.bottom - l.price) <= threshold ||
          Math.abs(zone.top - l.price) <= threshold ||
          (l.price >= zone.bottom - threshold && l.price <= zone.top + threshold)
      );
      if (aligned) {
        zone.hasLiquidityBadge = true;
        zone.grade = 'A';
        zone.liquidityReason = `Confluence with intact ${aligned.label} ($${aligned.price.toFixed(2)})`;
        if (!zone.reason.includes('LIQUIDITY:')) {
          zone.reason = `${zone.reason} · LIQUIDITY: ${aligned.label} ($${aligned.price.toFixed(2)})`;
        }
      }
    } else {
      // PP (SARRAF ZONE)
      const intactPools = liquidityLevels.filter((l) => l.status === 'INTACT');
      const aligned = intactPools.find(
        (p) =>
          Math.abs(zone.level - p.price) <= threshold ||
          (p.price >= zone.bottom - threshold && p.price <= zone.top + threshold)
      );
      if (aligned) {
        zone.hasLiquidityBadge = true;
        zone.grade = 'A';
        zone.liquidityReason = `Confluence with intact ${aligned.label} ($${aligned.price.toFixed(2)})`;
        if (!zone.reason.includes('LIQUIDITY:')) {
          zone.reason = `${zone.reason} · LIQUIDITY: ${aligned.label} ($${aligned.price.toFixed(2)})`;
        }
      }
    }

    return zone;
  });
}

// -------------------------------------------------------------
// ZONE ALERTS: TELEGRAM DISPATCH, DEDUPLICATION & RATE LIMITING
// -------------------------------------------------------------
let alertsEnabled = process.env.ATLAS_ALERTS_ENABLED === 'true';
let alertLogs: AtlasAlertLogItem[] = [];
const sentAlertsKeys = new Set<string>();
const lastAlertTimeByZone = new Map<string, number>();

function loadAlertsConfig() {
  try {
    if (fs.existsSync(ATLAS_ALERTS_FILE)) {
      const raw = fs.readFileSync(ATLAS_ALERTS_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (typeof data.alertsEnabled === 'boolean') {
        alertsEnabled = data.alertsEnabled;
      }
      if (Array.isArray(data.alertLogs)) {
        // Purge old bad log entries (entries with invalid price, mock/paper markers, or missing timestamp)
        alertLogs = data.alertLogs.filter(
          (l: any) =>
            l &&
            l.timestamp &&
            typeof l.price === 'number' &&
            l.price > 1000 &&
            !JSON.stringify(l).includes('PAPER') &&
            !JSON.stringify(l).includes('MOCK')
        );
      }
      if (Array.isArray(data.sentAlertsKeys)) {
        for (const k of data.sentAlertsKeys) sentAlertsKeys.add(k);
      }
    }
  } catch (err) {
    console.error('[ATLAS ALERTS] Error loading config:', err);
  }
}

function saveAlertsConfig() {
  try {
    const data = {
      alertsEnabled,
      alertLogs: alertLogs.slice(0, 50),
      sentAlertsKeys: Array.from(sentAlertsKeys).slice(-200),
    };
    fs.writeFileSync(ATLAS_ALERTS_FILE, JSON.stringify(data, null, 2), 'utf-8');

    // Also persist sent alerts into atlas_history.json
    if (fs.existsSync(ATLAS_HISTORY_FILE)) {
      try {
        const rawHistory = fs.readFileSync(ATLAS_HISTORY_FILE, 'utf-8');
        const history = JSON.parse(rawHistory);
        if (Array.isArray(history) && history.length > 0) {
          history[history.length - 1].alertLogs = alertLogs.slice(0, 50);
          fs.writeFileSync(ATLAS_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
        }
      } catch (hErr) {
        console.error('[ATLAS ALERTS] Error updating atlas_history.json:', hErr);
      }
    }
  } catch (err) {
    console.error('[ATLAS ALERTS] Error saving config:', err);
  }
}

export function getAtlasAlertsEnabled(): boolean {
  return alertsEnabled;
}

export function setAtlasAlertsEnabled(val: boolean): boolean {
  alertsEnabled = val;
  saveAlertsConfig();
  console.log(`[ATLAS ALERTS] Alerts state set to: ${alertsEnabled ? 'ON' : 'OFF'}`);
  return alertsEnabled;
}

export function toggleAtlasAlerts(): boolean {
  alertsEnabled = !alertsEnabled;
  saveAlertsConfig();
  console.log(`[ATLAS ALERTS] Toggled alerts to: ${alertsEnabled ? 'ON' : 'OFF'}`);
  return alertsEnabled;
}

export function getAtlasAlertLogs(): AtlasAlertLogItem[] {
  return alertLogs.slice(0, 10);
}

// Internal Telegram message dispatcher with logging
async function dispatchAlert(item: {
  eventType: 'APPROACH' | 'TOUCH' | 'BROKEN' | 'PUBLISH';
  zoneId?: string;
  zoneName?: string;
  tier?: string;
  grade?: string;
  price: number;
  message: string;
  formattedText?: string;
}) {
  const schedule = getMarketSchedule();
  // Strictly enforce: nothing is sent or logged when dispatch is OFF or the market is closed
  if (!alertsEnabled || !schedule.isOpen) return;

  const effectiveChat = getEffectiveTelegramChatId();
  let status: 'SENT' | 'FAILED' | 'SKIPPED' = 'SKIPPED';

  let text = item.formattedText;
  if (!text) {
    const icon =
      item.eventType === 'APPROACH' ? '⚠️' : item.eventType === 'TOUCH' ? '🎯' : item.eventType === 'BROKEN' ? '❌' : '🏛';
    text = [
      `🏛 <b>SARRAF ATLAS</b>\n`,
      `${icon} <b>${item.eventType}:</b> ${item.tier || ''} ${item.zoneName ? `(${item.zoneName})` : ''}`,
      `📍 <b>Live Price:</b> $${item.price.toFixed(2)}`,
      `ℹ️ <b>Detail:</b> ${item.message}\n`,
      `<i>Analysis, not a signal</i>`,
    ].join('\n');
  }

  try {
    const res = await sendTelegramHttpRequest(text, undefined, undefined, undefined, 'HTML');
    if (res.success) {
      status = 'SENT';
      console.log(`[ATLAS ALERTS] Dispatched Telegram alert for ${item.eventType} (${item.zoneId || 'ALL'})`);
    } else {
      status = 'FAILED';
      console.warn(`[ATLAS ALERTS] Telegram dispatch failed: ${res.error}`);
    }
  } catch (err: any) {
    status = 'FAILED';
    console.error(`[ATLAS ALERTS] Telegram error:`, err?.message);
  }

  const logItem: AtlasAlertLogItem = {
    id: `alt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    eventType: item.eventType,
    zoneId: item.zoneId,
    zoneName: item.zoneName,
    tier: item.tier,
    grade: item.grade,
    price: item.price,
    message: item.message,
    status,
    telegramChatId: effectiveChat || undefined,
  };

  alertLogs.unshift(logItem);
  if (alertLogs.length > 50) alertLogs = alertLogs.slice(0, 50);

  saveAlertsConfig();
}

// Real-time zone alerts checker (approaching, touching, or broken)
export async function checkAndDispatchZoneAlerts(
  livePrice: number,
  zones: AtlasZone[],
  payload: FrozenAtlasPayload | null
) {
  const schedule = getMarketSchedule();
  // Strictly enforce: nothing is sent or logged when dispatch is OFF or the market is closed
  if (!alertsEnabled || !schedule.isOpen || livePrice <= 0 || !zones || zones.length === 0) return;

  const now = Date.now();
  const sessionDate = payload?.date || new Date().toISOString().slice(0, 10);
  const rateLimitMs = 30 * 60 * 1000; // max 1 alert per zone per 30 min
  const tickMargin = 0.10; // +/- 1 tick
  const approachThreshold = 5.0; // within 5 pts

  for (const zone of zones) {
    // 1. TOUCH: price inside the zone box +/- 1 tick
    const isInside = livePrice >= (zone.bottom - tickMargin) && livePrice <= (zone.top + tickMargin);

    const distToCorridor = isInside
      ? 0
      : livePrice > zone.top
      ? livePrice - zone.top
      : zone.bottom - livePrice;

    const lastAlertTime = lastAlertTimeByZone.get(zone.id) || 0;
    const isRateLimited = now - lastAlertTime < rateLimitMs;

    if (isInside) {
      const touchKey = `${sessionDate}_${zone.id}_TOUCH`;
      if (!sentAlertsKeys.has(touchKey) && !isRateLimited) {
        sentAlertsKeys.add(touchKey);
        lastAlertTimeByZone.set(zone.id, now);
        await dispatchAlert({
          eventType: 'TOUCH',
          zoneId: zone.id,
          zoneName: zone.name,
          tier: zone.tier,
          grade: zone.grade,
          price: livePrice,
          message: `Price entered ${zone.tier} (${zone.name}) at $${livePrice.toFixed(2)} [${zone.bottom.toFixed(0)} – ${zone.top.toFixed(0)}]`,
        });
      }
    } else if (distToCorridor <= approachThreshold && distToCorridor > 0) {
      // 2. APPROACH: within 5 pts of a zone (and not inside)
      const approachKey = `${sessionDate}_${zone.id}_APPROACH`;
      if (!sentAlertsKeys.has(approachKey) && !isRateLimited) {
        sentAlertsKeys.add(approachKey);
        lastAlertTimeByZone.set(zone.id, now);
        await dispatchAlert({
          eventType: 'APPROACH',
          zoneId: zone.id,
          zoneName: zone.name,
          tier: zone.tier,
          grade: zone.grade,
          price: livePrice,
          message: `Price approaching ${zone.tier} (${zone.name}) — ${distToCorridor.toFixed(1)} pts away from $${(zone.side === 'SELL' ? zone.bottom : zone.top).toFixed(2)}`,
        });
      }
    }

    // 3. BROKEN: H1 close beyond the zone, with the reason
    if (zone.status === 'BROKEN') {
      const brokenKey = `${sessionDate}_${zone.id}_BROKEN`;
      if (!sentAlertsKeys.has(brokenKey) && !isRateLimited) {
        sentAlertsKeys.add(brokenKey);
        lastAlertTimeByZone.set(zone.id, now);
        await dispatchAlert({
          eventType: 'BROKEN',
          zoneId: zone.id,
          zoneName: zone.name,
          tier: zone.tier,
          grade: zone.grade,
          price: livePrice,
          message: `Zone ${zone.tier} (${zone.name}) BROKEN: ${zone.breakInfo?.reason || 'H1 close beyond zone'}`,
        });
      }
    }
  }
}

// 4. NEW ZONES PUBLISHED at daily publish time
export async function dispatchNewZonesPublishedAlert(payload: FrozenAtlasPayload, livePrice: number) {
  const schedule = getMarketSchedule();
  if (!alertsEnabled || !schedule.isOpen) return;

  const sessionDate = payload.date;
  const publishKey = `${sessionDate}_PUBLISH`;
  if (sentAlertsKeys.has(publishKey)) return;
  sentAlertsKeys.add(publishKey);

  const r1 = payload.zones.find((z) => z.id === 'R1');
  const s1 = payload.zones.find((z) => z.id === 'S1');
  const pp = payload.zones.find((z) => z.id === 'PP');

  const text = [
    `🏛 <b>SARRAF ATLAS</b>\n`,
    `<b>NEW ZONES PUBLISHED</b>`,
    `📅 <b>Date:</b> <code>${payload.date}</code>`,
    `🧭 <b>Bias:</b> <b>${payload.bias?.overall || 'NEUTRAL'}</b> (${payload.bias?.strategyLabel || ''})`,
    `📍 <b>Live Price:</b> $${livePrice > 0 ? livePrice.toFixed(2) : (payload.prevDayCandle?.close || 0).toFixed(2)}\n`,
    `🔴 <b>T1 Sell (R1):</b> $${r1 ? `${r1.bottom.toFixed(0)} – ${r1.top.toFixed(0)}` : 'N/A'} (Grade ${r1?.grade || 'B'})`,
    `🟢 <b>T1 Buy (S1):</b> $${s1 ? `${s1.bottom.toFixed(0)} – ${s1.top.toFixed(0)}` : 'N/A'} (Grade ${s1?.grade || 'B'})`,
    `🟡 <b>Sarraf Zone (PP):</b> $${pp ? pp.level.toFixed(2) : 'N/A'}\n`,
    `🎯 <b>Sell Targets:</b> ${payload.targets?.sell?.map((t) => `${t.label} $${t.price.toFixed(0)}`).join(', ') || 'N/A'}`,
    `🎯 <b>Buy Targets:</b> ${payload.targets?.buy?.map((t) => `${t.label} $${t.price.toFixed(0)}`).join(', ') || 'N/A'}`,
    `🛡 <b>Invalidation:</b> ${payload.invalidation?.sell || 'N/A'} | ${payload.invalidation?.buy || 'N/A'}\n`,
    `<i>Analysis, not a signal</i>`,
  ].join('\n');

  await dispatchAlert({
    eventType: 'PUBLISH',
    price: livePrice,
    message: `New zones published for session ${sessionDate}`,
    formattedText: text,
  });
}

// Test alert sender
export async function sendTestAtlasAlert(): Promise<{ success: boolean; messageId?: number; error?: string }> {
  const effectiveChat = getEffectiveTelegramChatId();
  if (!effectiveChat) {
    return {
      success: false,
      error: 'Telegram chat ID not configured. Open @Sarraftelegrambot in Telegram and send /start to bind your account.',
    };
  }

  const testPrice = lastEvaluatedTickPrice > 0 ? lastEvaluatedTickPrice : 4165.25;
  const text = [
    `🏛 <b>SARRAF ATLAS · TEST ALERT</b>\n`,
    `📍 <b>Spot Benchmark:</b> $${testPrice.toFixed(2)}`,
    `🎯 <b>Zone Test:</b> T1 PRIMARY SELL (Daily Pivot R1)`,
    `🏷 <b>Tier:</b> T1 PRIMARY | Grade: A [LIQUIDITY]`,
    `ℹ️ <b>Verification:</b> Real-time institutional Telegram alerting engine is ONLINE & ACTIVE.\n`,
    `<i>Analysis, not a signal. Entry only after structure + price action confirm.</i>`,
  ].join('\n');

  const res = await sendTelegramHttpRequest(text, undefined, undefined, undefined, 'HTML');
  const logItem: AtlasAlertLogItem = {
    id: `alt_test_${Date.now()}`,
    timestamp: new Date().toISOString(),
    eventType: 'TOUCH',
    zoneId: 'R1',
    zoneName: 'R1 Supply',
    tier: 'T1 PRIMARY',
    grade: 'A',
    price: testPrice,
    message: 'Manual admin Telegram verification test',
    status: res.success ? 'SENT' : 'FAILED',
    telegramChatId: effectiveChat,
  };

  alertLogs.unshift(logItem);
  if (alertLogs.length > 50) alertLogs = alertLogs.slice(0, 50);
  saveAlertsConfig();

  return res;
}

// Evaluate yesterday report card
export function evaluateReportCard(
  zones: AtlasZone[],
  dayH1Bars: Candle[],
  atr14: number,
  dateStr: string
): AtlasReportCard {
  const reports: AtlasZoneReportItem[] = [];
  const dayHigh = dayH1Bars.length > 0 ? Math.max(...dayH1Bars.map((c) => c.high)) : 0;
  const dayLow = dayH1Bars.length > 0 ? Math.min(...dayH1Bars.map((c) => c.low)) : 0;

  for (const z of zones) {
    if (z.side === 'SELL') {
      if (dayHigh < z.bottom) {
        reports.push({
          zoneId: z.id,
          name: z.name,
          level: z.level,
          side: z.side,
          outcome: 'IGNORED',
          notes: `Price stayed below zone (Day High $${dayHigh.toFixed(2)} vs Zone Bottom $${z.bottom.toFixed(2)})`,
        });
      } else {
        const breakBar = dayH1Bars.find((c) => c.close > z.top);
        if (breakBar) {
          reports.push({
            zoneId: z.id,
            name: z.name,
            level: z.level,
            side: z.side,
            outcome: 'BROKEN',
            notes: `H1 closed above far edge at $${breakBar.close.toFixed(2)}`,
          });
        } else {
          const touchIdx = dayH1Bars.findIndex((c) => c.high >= z.bottom);
          const subsequent = dayH1Bars.slice(touchIdx >= 0 ? touchIdx : 0);
          const minLowAfter = Math.min(...subsequent.map((c) => c.low));
          const reversalPts = Number((z.level - minLowAfter).toFixed(2));
          reports.push({
            zoneId: z.id,
            name: z.name,
            level: z.level,
            side: z.side,
            outcome: 'RESPECTED',
            reversalPoints: Math.max(0, reversalPts),
            notes: `Zone held. Reversed ${Math.max(0, reversalPts).toFixed(1)} pts (${(Math.max(0, reversalPts) / (atr14 || 15)).toFixed(1)}x ATR)`,
          });
        }
      }
    } else if (z.side === 'BUY') {
      if (dayLow > z.top) {
        reports.push({
          zoneId: z.id,
          name: z.name,
          level: z.level,
          side: z.side,
          outcome: 'IGNORED',
          notes: `Price stayed above zone (Day Low $${dayLow.toFixed(2)} vs Zone Top $${z.top.toFixed(2)})`,
        });
      } else {
        const breakBar = dayH1Bars.find((c) => c.close < z.bottom);
        if (breakBar) {
          reports.push({
            zoneId: z.id,
            name: z.name,
            level: z.level,
            side: z.side,
            outcome: 'BROKEN',
            notes: `H1 closed below far edge at $${breakBar.close.toFixed(2)}`,
          });
        } else {
          const touchIdx = dayH1Bars.findIndex((c) => c.low <= z.top);
          const subsequent = dayH1Bars.slice(touchIdx >= 0 ? touchIdx : 0);
          const maxHighAfter = Math.max(...subsequent.map((c) => c.high));
          const reversalPts = Number((maxHighAfter - z.level).toFixed(2));
          reports.push({
            zoneId: z.id,
            name: z.name,
            level: z.level,
            side: z.side,
            outcome: 'RESPECTED',
            reversalPoints: Math.max(0, reversalPts),
            notes: `Zone held. Reversed ${Math.max(0, reversalPts).toFixed(1)} pts (${(Math.max(0, reversalPts) / (atr14 || 15)).toFixed(1)}x ATR)`,
          });
        }
      }
    } else {
      // PP
      const reached = dayHigh >= z.bottom && dayLow <= z.top;
      if (!reached) {
        reports.push({
          zoneId: z.id,
          name: z.name,
          level: z.level,
          side: z.side,
          outcome: 'IGNORED',
          notes: 'Never reached PP corridor',
        });
      } else {
        const breakBar = dayH1Bars.find((c) => c.close > z.top || c.close < z.bottom);
        if (breakBar) {
          reports.push({
            zoneId: z.id,
            name: z.name,
            level: z.level,
            side: z.side,
            outcome: 'BROKEN',
            notes: `H1 closed outside PP corridor at $${breakBar.close.toFixed(2)}`,
          });
        } else {
          reports.push({
            zoneId: z.id,
            name: z.name,
            level: z.level,
            side: z.side,
            outcome: 'RESPECTED',
            reversalPoints: 10.0,
            notes: 'Price respected central pivot equilibrium',
          });
        }
      }
    }
  }

  const respectedCount = reports.filter((r) => r.outcome === 'RESPECTED').length;
  const brokenCount = reports.filter((r) => r.outcome === 'BROKEN').length;
  const ignoredCount = reports.filter((r) => r.outcome === 'IGNORED').length;
  const totalEvaluated = respectedCount + brokenCount;
  const accuracyPercent = totalEvaluated > 0 ? Number(((respectedCount / totalEvaluated) * 100).toFixed(1)) : 100;

  return {
    date: dateStr,
    evaluatedAt: new Date().toISOString(),
    zones: reports,
    totalEvaluated,
    respectedCount,
    brokenCount,
    ignoredCount,
    accuracyPercent,
  };
}

// Load all historical entries
export function loadHistory(): AtlasHistoryEntry[] {
  try {
    if (fs.existsSync(ATLAS_HISTORY_FILE)) {
      const raw = fs.readFileSync(ATLAS_HISTORY_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

// Ensure historical sets and report cards are generated for last 5 days
function ensureHistoricalPublishedSets() {
  const d1Closed = getClosedCandles('D1');
  const h1Closed = getClosedCandles('H1');
  if (!d1Closed || d1Closed.length < 2) return;

  let history = loadHistory();
  const existingDates = new Set(history.map((h) => h.date));

  // Take the last 6 closed D1 candles to generate up to 5 historical sets
  const recentD1 = d1Closed.slice(-6);

  for (let i = 1; i < recentD1.length; i++) {
    const prevCandle = recentD1[i - 1];
    const sessionCandle = recentD1[i];
    const sessionDate = sessionCandle.openTime.slice(0, 10);

    // If not in history or missing report card, compute and evaluate
    const existing = history.find((h) => h.date === sessionDate);
    if (!existing || !existing.reportCard) {
      const H = Number(prevCandle.high.toFixed(2));
      const L = Number(prevCandle.low.toFixed(2));
      const C = Number(prevCandle.close.toFixed(2));
      const PP = Number(((H + L + C) / 3).toFixed(2));
      const R1 = Number((2 * PP - L).toFixed(2));
      const S1 = Number((2 * PP - H).toFixed(2));
      const R2 = Number((PP + (H - L)).toFixed(2));
      const S2 = Number((PP - (H - L)).toFixed(2));
      const R3 = Number((H + 2 * (PP - L)).toFixed(2));
      const S3 = Number((L - 2 * (H - PP)).toFixed(2));

      const halfWidth = 3.0; // standard box width
      const sampleZones: AtlasZone[] = [
        { id: 'R3', name: 'R3 Supply', level: R3, top: Number((R3 + halfWidth).toFixed(2)), bottom: Number((R3 - halfWidth).toFixed(2)), halfWidth, side: 'SELL', type: 'SUPPLY', tier: 'T3 EXTREME', grade: 'A', touchesCount: 1, reason: 'Historical Pivot', status: 'FRESH', touchesToday: 0, isFlipped: false, breakInfo: null },
        { id: 'R2', name: 'R2 Supply', level: R2, top: Number((R2 + halfWidth).toFixed(2)), bottom: Number((R2 - halfWidth).toFixed(2)), halfWidth, side: 'SELL', type: 'SUPPLY', tier: 'T2 STRONG', grade: 'A', touchesCount: 3, reason: 'Historical Pivot', status: 'FRESH', touchesToday: 0, isFlipped: false, breakInfo: null },
        { id: 'R1', name: 'R1 Supply', level: R1, top: Number((R1 + halfWidth).toFixed(2)), bottom: Number((R1 - halfWidth).toFixed(2)), halfWidth, side: 'SELL', type: 'SUPPLY', tier: 'T1 PRIMARY', grade: 'A', touchesCount: 12, reason: 'Historical Pivot', status: 'FRESH', touchesToday: 0, isFlipped: false, breakInfo: null },
        { id: 'PP', name: 'SARRAF ZONE', level: PP, top: Number((PP + halfWidth).toFixed(2)), bottom: Number((PP - halfWidth).toFixed(2)), halfWidth, side: 'NEUTRAL', type: 'SARRAF_ZONE', tier: 'SARRAF ZONE', grade: 'A', touchesCount: 20, reason: 'Historical Central Pivot', status: 'FRESH', touchesToday: 0, isFlipped: false, breakInfo: null },
        { id: 'S1', name: 'S1 Demand', level: S1, top: Number((S1 + halfWidth).toFixed(2)), bottom: Number((S1 - halfWidth).toFixed(2)), halfWidth, side: 'BUY', type: 'DEMAND', tier: 'T1 PRIMARY', grade: 'A', touchesCount: 10, reason: 'Historical Pivot', status: 'FRESH', touchesToday: 0, isFlipped: false, breakInfo: null },
        { id: 'S2', name: 'S2 Demand', level: S2, top: Number((S2 + halfWidth).toFixed(2)), bottom: Number((S2 - halfWidth).toFixed(2)), halfWidth, side: 'BUY', type: 'DEMAND', tier: 'T2 STRONG', grade: 'A', touchesCount: 4, reason: 'Historical Pivot', status: 'FRESH', touchesToday: 0, isFlipped: false, breakInfo: null },
        { id: 'S3', name: 'S3 Demand', level: S3, top: Number((S3 + halfWidth).toFixed(2)), bottom: Number((S3 - halfWidth).toFixed(2)), halfWidth, side: 'BUY', type: 'DEMAND', tier: 'T3 EXTREME', grade: 'B', touchesCount: 0, reason: 'Historical Pivot', status: 'FRESH', touchesToday: 0, isFlipped: false, breakInfo: null },
      ];

      // Evaluate against real H1 bars for that session
      const dayH1 = (h1Closed || []).filter((c) => c.openTime.startsWith(sessionDate));
      const report = dayH1.length > 0 ? evaluateReportCard(sampleZones, dayH1, 15.0, sessionDate) : null;

      const entry: AtlasHistoryEntry = {
        date: sessionDate,
        publishedAt: sessionCandle.openTime,
        prevDayCandle: {
          date: prevCandle.openTime.slice(0, 10),
          high: H,
          low: L,
          close: C,
        },
        pivots: { H, L, C, PP, R1, S1, R2, S2, R3, S3 },
        zones: sampleZones,
        bias: {
          overall: C > PP ? 'BULLISH' : 'BEARISH',
          strategy: C > PP ? 'BUY_DIP' : 'SELL_RALLY',
          strategyLabel: C > PP ? 'Buy dips above PP' : 'Sell rallies below PP',
          score: C > PP ? 2 : -2,
          timeframes: [],
        },
        reportCard: report,
      };

      history = history.filter((h) => h.date !== sessionDate);
      history.push(entry);
    }
  }

  // Sort by date ascending
  history.sort((a, b) => a.date.localeCompare(b.date));
  if (history.length > 60) history = history.slice(-60);

  try {
    fs.writeFileSync(ATLAS_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  } catch {}
}

// Initialize the Atlas Engine
export function initAtlasEngine() {
  loadAlertsConfig();

  const loaded = loadFromDisk();
  if (!loaded) {
    const computed = computeAtlasZonesAndScenarios();
    if (computed) {
      currentPublishedPayload = computed;
      saveToDisk(computed);
    }
  }

  // Seed / enrich historical sets and report cards
  ensureHistoricalPublishedSets();

  // Periodic heartbeat & rollover checker (every 30 seconds)
  setInterval(() => {
    checkRolloverAndAnalysisWindow();
  }, 30000);

  // Broadcast 1-second ticks to SSE clients
  setInterval(() => {
    broadcastAtlasState();
  }, 1000);
}

// Check daily rollover and analysis window (rollover hour + 60m analysis window)
function checkRolloverAndAnalysisWindow() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const rolloverHour = getRolloverUtcHour();

  // 1. Check if we are inside the 60-minute ANALYSIS window [rolloverHour:00 to rolloverHour+1:00]
  if (utcHour === rolloverHour && utcMinute < 60) {
    if (currentStatus !== 'ANALYZING') {
      currentStatus = 'ANALYZING';
      console.log(`[ATLAS ENGINE] Entered 60-minute daily ANALYSIS window at ${now.toISOString()}.`);
    }
    return;
  }

  // 2. If we just completed the analysis window (at rolloverHour + 1) or a new D1 candle appeared:
  const d1Closed = getClosedCandles('D1');
  if (d1Closed && d1Closed.length > 0) {
    const latestD1 = d1Closed[d1Closed.length - 1];
    if (latestD1.openTime !== lastProcessedD1OpenTime) {
      // Check if currentPublishedPayload already has this date
      if (!currentPublishedPayload || currentPublishedPayload.prevDayCandle.date !== latestD1.openTime.slice(0, 10)) {
        console.log(`[ATLAS ENGINE] Publishing new daily Atlas set for closed D1 bar ${latestD1.openTime.slice(0, 10)}.`);
        const newPayload = computeAtlasZonesAndScenarios();
        if (newPayload) {
          currentPublishedPayload = newPayload;
          currentStatus = 'PUBLISHED';
          lastProcessedD1OpenTime = latestD1.openTime;
          saveToDisk(newPayload);
          ensureHistoricalPublishedSets();

          // Trigger Telegram alert for new published zones
          if (alertsEnabled) {
            dispatchNewZonesPublishedAlert(newPayload, lastEvaluatedTickPrice).catch((e) =>
              console.error('[ATLAS ALERTS] Error dispatching publish alert:', e)
            );
          }
        }
      }
    }
  }

  if (currentStatus === 'ANALYZING' && utcHour >= rolloverHour + 1) {
    currentStatus = 'PUBLISHED';
    console.log('[ATLAS ENGINE] Analysis window complete. Status set to PUBLISHED.');
  }
}

// Called whenever a new live tick arrives from market feed
export function onAtlasLiveTick(price: number, timestamp: number = Date.now()) {
  if (typeof price === 'number' && price > 0) {
    lastEvaluatedTickPrice = Number(price.toFixed(2));
    lastTickTimestamp = timestamp;

    // Check alerts in background
    if (alertsEnabled && currentPublishedPayload) {
      checkAndDispatchZoneAlerts(lastEvaluatedTickPrice, currentPublishedPayload.zones, currentPublishedPayload).catch(
        (err) => console.error('[ATLAS ALERTS] Live tick check error:', err)
      );
    }
  }
}

// Compute Atlas Summary
export function computeAtlasSummary(
  h1Candles: Candle[],
  livePrice: number,
  zones: AtlasZone[],
  atr14: number,
  overallBias: string
): AtlasSummary {
  const rsi = calculateRSI(h1Candles, 14);
  let momentum = `RSI(14): ${rsi} · NEUTRAL`;
  if (rsi >= 70) momentum = `RSI(14): ${rsi} · OVERBOUGHT`;
  else if (rsi <= 30) momentum = `RSI(14): ${rsi} · OVERSOLD`;

  const threshold = Math.max(2.0, 0.3 * atr14);
  let priceAction: 'AT SUPPLY' | 'AT DEMAND' | 'MID-RANGE' = 'MID-RANGE';

  if (livePrice > 0 && zones && zones.length > 0) {
    const nearSupply = zones.some((z) => z.side === 'SELL' && Math.abs(z.level - livePrice) <= threshold);
    const nearDemand = zones.some((z) => z.side === 'BUY' && Math.abs(z.level - livePrice) <= threshold);
    if (nearSupply) priceAction = 'AT SUPPLY';
    else if (nearDemand) priceAction = 'AT DEMAND';
  }

  const part = computeParticipationRatio(h1Candles);
  let volume = `Participation: ${part.ratio}x · NORMAL`;
  if (part.ratio >= 1.3) volume = `Participation: ${part.ratio}x · HIGH`;
  else if (part.ratio <= 0.7) volume = `Participation: ${part.ratio}x · LOW`;

  let volatility = `ATR(14): $${atr14.toFixed(2)} · STABLE`;
  if (h1Candles && h1Candles.length >= 20) {
    const avgAtr = calculateATR(h1Candles.slice(0, -5), 14);
    if (atr14 > avgAtr * 1.15) volatility = `ATR(14): $${atr14.toFixed(2)} · EXPANDING`;
    else if (atr14 < avgAtr * 0.85) volatility = `ATR(14): $${atr14.toFixed(2)} · COMPRESSING`;
  }

  const risk: 'LOW' | 'MODERATE' | 'HIGH' =
    part.ratio >= 1.5 || rsi >= 75 || rsi <= 25 ? 'HIGH' : part.ratio >= 1.2 ? 'MODERATE' : 'LOW';

  return {
    trend: overallBias || 'RANGE-BOUND',
    momentum,
    priceAction,
    volume,
    volatility,
    risk,
  };
}

// Get full current Atlas state
export function getAtlasState(): AtlasState {
  const nowMs = Date.now();
  const schedule = getMarketSchedule();
  const lastValidTick = getLastValidTick();

  const livePrice = lastEvaluatedTickPrice > 0 ? lastEvaluatedTickPrice : lastValidTick?.price || 0;
  const marketStatus = schedule.isOpen ? 'LIVE' : 'MARKET_CLOSED';

  // If we don't have a published payload yet, compute one
  if (!currentPublishedPayload) {
    const computed = computeAtlasZonesAndScenarios();
    if (computed) {
      currentPublishedPayload = computed;
      saveToDisk(computed);
    }
  }

  const payload = currentPublishedPayload;
  const nextPublishMs = computeNextPublishTimestamp(nowMs);
  const countdownSec = Math.max(0, Math.floor((nextPublishMs - nowMs) / 1000));
  const countdownText = formatCountdown(countdownSec);

  const rawH1 = getClosedCandles('H1');
  const d1Closed = getClosedCandles('D1');
  const sessionDateStr = payload?.date || new Date().toISOString().slice(0, 10);
  const sessionCandles = (rawH1 || []).filter((c) => c.openTime.startsWith(sessionDateStr));

  // Compute live indicators first to get ATR
  const indicators = computeLiveIndicators();
  const atr14 = indicators?.atr14 || 15;

  // 1. Compute Liquidity Levels (PDH/PDL, Asia H/L, London H/L, Prev Week H/L)
  const liquidityLevels = computeLiquidityLevels(sessionCandles, d1Closed, payload?.prevDayCandle || null, livePrice);

  // 2. Dynamically evaluate zone status: FRESH, TESTED, or BROKEN with flip
  const baseZones = payload?.zones || [];
  const statusEvaluatedZones = evaluateLiveZoneStatus(baseZones, rawH1 || [], payload?.publishedAt || null, livePrice);

  // 3. Apply Liquidity Confluence to zones: sits within 0.3*ATR of INTACT high/low -> LIQUIDITY badge & Grade A upgrade
  const evaluatedZones = applyLiquidityConfluenceToZones(statusEvaluatedZones, liquidityLevels, atr14);

  // 4. Associate nearestZoneId and nearestZoneDist on liquidity levels
  for (const lvl of liquidityLevels) {
    if (evaluatedZones.length > 0) {
      let nearest = evaluatedZones[0];
      let minDist = Math.abs(nearest.level - lvl.price);
      for (let i = 1; i < evaluatedZones.length; i++) {
        const d = Math.abs(evaluatedZones[i].level - lvl.price);
        if (d < minDist) {
          minDist = d;
          nearest = evaluatedZones[i];
        }
      }
      lvl.nearestZoneId = nearest.id;
      lvl.nearestZoneDist = Number(minDist.toFixed(1));
    }
  }

  const tradeState = computeLiveTradeState(livePrice, evaluatedZones);
  const summary = computeAtlasSummary(rawH1 || [], livePrice, evaluatedZones, atr14, payload?.bias?.overall || 'RANGE');

  const h1Candles = (rawH1 || []).slice(-120).map((c) => ({
    openTime: c.openTime,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));

  // History & Report Cards
  const history = loadHistory();
  // Find yesterday's report card (most recent completed day prior to current date)
  const pastEntries = history.filter((h) => h.date !== sessionDateStr && h.reportCard);
  const yesterdayEntry = pastEntries.length > 0 ? pastEntries[pastEntries.length - 1] : null;
  const yesterdayReportCard = yesterdayEntry?.reportCard || null;

  // Rolling last 7 days accuracy % over reached zones only
  const evaluatedIn7d = pastEntries.slice(-7);
  let sumRespected = 0;
  let sumReached = 0;
  for (const ent of evaluatedIn7d) {
    if (ent.reportCard) {
      const reachedInDay = ent.reportCard.respectedCount + ent.reportCard.brokenCount;
      sumRespected += ent.reportCard.respectedCount;
      sumReached += reachedInDay;
    }
  }

  const rollingAccuracy7d: number | string | null =
    sumReached < 5
      ? 'LOW SAMPLE'
      : Number(((sumRespected / sumReached) * 100).toFixed(1));

  // Last 5 published sets for the History Selector
  const historyList = history.slice(-5);

  return {
    date: payload?.date || new Date().toISOString().slice(0, 10),
    status: currentStatus,
    marketStatus,
    publishedAt: payload?.publishedAt || null,
    nextPublishAt: payload?.nextPublishAt || new Date(nextPublishMs).toISOString(),
    countdownSeconds: countdownSec,
    countdownText,
    prevDayCandle: payload?.prevDayCandle || null,
    pivots: payload?.pivots || null,
    zones: evaluatedZones,
    bias: payload?.bias || null,
    summary,
    targets: payload?.targets || { sell: [], buy: [] },
    invalidation: payload?.invalidation || { sell: '', buy: '' },
    scenarios: payload?.scenarios || null,
    indicators,
    livePrice,
    lastTickTime: lastTickTimestamp,
    tradeState,
    yesterdayReportCard,
    rollingAccuracy7d,
    historyList,
    liquidityLevels,
    alertsEnabled,
    alertLogs: alertLogs.slice(0, 10),
    h1Candles,
  };
}

// SSE Broadcast to all connected clients
export function broadcastAtlasState() {
  if (atlasSseClients.size === 0) return;
  const state = getAtlasState();
  const payload = `data: ${JSON.stringify(state)}\n\n`;

  for (const [id, client] of atlasSseClients.entries()) {
    try {
      if (client.res.writableEnded || client.res.destroyed) {
        atlasSseClients.delete(id);
        continue;
      }
      client.res.write(payload);
      if (typeof client.res.flush === 'function') {
        client.res.flush();
      }
    } catch {
      atlasSseClients.delete(id);
    }
  }
}

// Register an SSE client
export function registerAtlasSseClient(id: string, req: any, res: any) {
  atlasSseClients.set(id, { id, req, res });
  console.log(`[ATLAS SSE] Client ${id} connected. Active clients: ${atlasSseClients.size}`);

  const cleanup = () => {
    if (atlasSseClients.has(id)) {
      atlasSseClients.delete(id);
      console.log(`[ATLAS SSE] Client ${id} disconnected. Remaining: ${atlasSseClients.size}`);
    }
  };

  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}
