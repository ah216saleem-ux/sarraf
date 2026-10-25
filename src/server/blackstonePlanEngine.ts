import fs from 'fs';
import path from 'path';
import { DATA_DIR, writeJsonAtomic } from './deploymentSafety.ts';
import { Candle, getCandleStore, buildTimeframeFromM5 } from './candleEngine.ts';
import { getLastValidTick } from './marketPriceEngine.ts';
import {
  BlackstoneEvaluatedZone,
  BlackstoneZoneId,
  BlackstoneZoneName,
  getDubaiSessionTiming,
  formatDubaiClockFull,
  formatDubaiTimeHHMM,
} from './blackstoneEngine.ts';
import { getNewsEventsForUI, getNewsFeedStatus } from './newsEngine.ts';
import { newsDecision } from './newsDecision.ts';
import {
  recordClosedSignalToHistory,
  recordZoneTestOutcome,
} from './blackstoneRecordEngine.ts';

export type BlackstonePlanPhase =
  | 'WATCHING'
  | 'APPROACHING'
  | 'IN ZONE'
  | 'TRADE LIVE'
  | 'PAUSED';

export type BlackstonePlanMode = 'AUTO' | 'MANUAL';

export interface GateState {
  passed: boolean;
  label: string;
  detail: string;
}

export interface Gate1State extends GateState {
  touches: number;
  isRetest: boolean;
}

export interface Gate2State extends GateState {
  wickPct: number;
  minWickPct: number;
}

export interface Gate3State extends GateState {
  closedOutside: boolean;
  priceStillOutside: boolean;
}

export interface Gate4State extends GateState {
  roomDollars: number;
  minRoomDollars: number;
}

export interface BlackstonePlanGates {
  gate1: Gate1State;
  gate2: Gate2State;
  gate3: Gate3State;
  gate4: Gate4State;
  allPassed: boolean;
}

export interface PlannedTradeSetup {
  side: 'BUY' | 'SELL';
  plannedEntry: number;
  stopLoss: number;
  stopDistance: number;
  oneR: number;
  m15Atr: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp3Capped: boolean;
  tp3CapReason?: string;
}

export interface LivePlanTrade {
  id: string;
  sessionDate: string;
  zoneId: BlackstoneZoneId;
  zoneName: BlackstoneZoneName;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  entryTimeIso: string;
  entryTimeDubai: string;
  initialStopLoss: number;
  currentStopLoss: number;
  stopDistance: number;
  oneR: number;
  m15Atr: number;
  tp1: {
    price: number;
    hit: boolean;
    hitTimeIso?: string;
    hitTimeDubai?: string;
    portionPnlDollars: number;
    portionPnlR: number;
  };
  tp2: {
    price: number;
    hit: boolean;
    hitTimeIso?: string;
    hitTimeDubai?: string;
    portionPnlDollars: number;
    portionPnlR: number;
  };
  tp3: {
    price: number;
    capped: boolean;
    originalPrice: number;
    hit: boolean;
    hitTimeIso?: string;
    hitTimeDubai?: string;
    portionPnlDollars: number;
    portionPnlR: number;
  };
  beMoved: boolean;
  status: 'ACTIVE' | 'CLOSED_PROFIT' | 'CLOSED_STOPPED' | 'CLOSED_BREAKEVEN';
  exitPrice?: number;
  exitTimeIso?: string;
  exitTimeDubai?: string;
  exitReason?: string;
  realizedPnlDollars: number;
  realizedPnlR: number;
  unrealizedPnlDollars: number;
  unrealizedPnlR: number;
  totalPnlDollars: number;
  totalPnlR: number;
}

export interface NearestZoneItem {
  id: BlackstoneZoneId;
  name: BlackstoneZoneName;
  side: 'sell side' | 'buy side';
  level: number;
  low: number;
  high: number;
  distance: number;
  distanceFormatted: string;
  grade: string;
  status: string;
  isRetest?: boolean;
  isSarrafCore?: boolean;
  tag?: 'Sarraf Core' | null;
}

export interface RetestZone {
  id: BlackstoneZoneId;
  name: BlackstoneZoneName;
  side: 'sell side' | 'buy side'; // flipped side
  level: number;
  low: number;
  high: number;
  proximal: number;
  distal: number;
  grade: string;
  score: number;
  originalSide: 'sell side' | 'buy side';
  brokenAtIso: string;
  retestCount: number;
}

export interface BlackstoneNewsEventInfo {
  id: string;
  name: string;
  impact: 'HIGH' | 'MED';
  timeUtc: string;
  timeDubai: string;
  minutesUntil: number;
  secondsUntil: number;
  countdownFormatted: string;
  decisionLocked: boolean;
  decisionDirection: 'BULLISH' | 'BEARISH' | null;
  decisionChipText: string;
  confidencePercent: number | null;
  isWithin60Minutes: boolean;
  isPauseWindow: boolean;
}

export interface BlackstoneNewsState {
  available: boolean;
  statusText?: string;
  nextEvent: BlackstoneNewsEventInfo | null;
  isNewsPauseActive: boolean;
  pauseNoticeText: string | null;
}

export interface BlackstonePlanPayload {
  sessionDate: string;
  phase: BlackstonePlanPhase;
  phaseDescription: string;
  mode: BlackstonePlanMode;
  pinnedZoneId: BlackstoneZoneId | null;
  targetZone: {
    id: BlackstoneZoneId;
    name: BlackstoneZoneName;
    side: 'sell side' | 'buy side';
    level: number;
    low: number;
    high: number;
    touches: number;
    isRetest: boolean;
    grade: string;
    isSarrafCore?: boolean;
    tag?: 'Sarraf Core' | null;
  } | null;
  transitionMessage: string | null;
  m15Atr: number;
  stopDistanceDollars: number; // 10 or 12
  plannedTrade: PlannedTradeSetup | null;
  gates: BlackstonePlanGates;
  nearestZones: {
    above: NearestZoneItem | null;
    below: NearestZoneItem | null;
  };
  activeTrade: LivePlanTrade | null;
  todaySignals: LivePlanTrade[];
  tradesToday: number;
  maxTrades: number;
  stopsToday: number;
  maxStops: number;
  stoppedTradesCountToday: number;
  maxStoppedTradesLimit: number;
  levelTradeCounts: Record<string, number>;
  maxTradesPerLevelLimit: number;
  blockedLevels: Array<{
    zoneId: string;
    zoneName: string;
    level: number;
    distanceAway: number;
    needsDistance: number;
  }>;
  isPaused: boolean;
  pauseReason: string | null;
  news: BlackstoneNewsState;
  livePrice: number | null;
  updatedAtDubai: string;
}

const PLAN_FILE_PERSISTENT = path.resolve(DATA_DIR, 'blackstone_live_plan.json');
const PLAN_FILE_LOCAL = path.resolve(process.cwd(), 'data', 'blackstone_live_plan.json');

export const MAX_TRADES_PER_DAY = 4;
export const MAX_TRADES_PER_LEVEL = 2;
export const MAX_STOPS_PER_DAY = 3;

interface PersistedPlanData {
  sessionDate: string;
  mode: BlackstonePlanMode;
  pinnedZoneId: BlackstoneZoneId | null;
  activeTrade: LivePlanTrade | null;
  todaySignals: LivePlanTrade[];
  tradesCountToday: number;
  stoppedTradesCountToday: number;
  levelTradeCounts: Record<string, number>;
  blockedLevels: Record<
    string,
    { zoneId: string; zoneName: string; level: number; exitPrice: number; blockedAtIso: string }
  >;
  retestZones: RetestZone[];
  lastBrokenZoneId: string | null;
  transitionMessage: string | null;
  transitionMessageExpiresMs?: number;
}

let inMemoryPlanData: PersistedPlanData = {
  sessionDate: '',
  mode: 'AUTO',
  pinnedZoneId: null,
  activeTrade: null,
  todaySignals: [],
  tradesCountToday: 0,
  stoppedTradesCountToday: 0,
  levelTradeCounts: {},
  blockedLevels: {},
  retestZones: [],
  lastBrokenZoneId: null,
  transitionMessage: null,
};

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function computeM15ATR14(): number {
  const store = getCandleStore();
  const m5 = store.M5 || [];
  let m15 = store.M15 || [];
  if (m15.length < 15 && m5.length >= 45) {
    m15 = buildTimeframeFromM5(m5, 15);
  }
  const closedM15 = m15.filter((c) => c.isClosed);
  if (closedM15.length < 15) return 4.2;

  const trueRanges: number[] = [];
  for (let i = 1; i < closedM15.length; i++) {
    const cur = closedM15[i];
    const prev = closedM15[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    trueRanges.push(tr);
  }
  const last14 = trueRanges.slice(-14);
  const sum = last14.reduce((acc, v) => acc + v, 0);
  return round2(sum / last14.length);
}

function loadPersistedPlan(): void {
  const tryPaths = [PLAN_FILE_PERSISTENT, PLAN_FILE_LOCAL];
  for (const p of tryPaths) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.sessionDate === 'string') {
          const loadedSignals = Array.isArray(parsed.todaySignals) ? parsed.todaySignals : [];
          const loadedActive = parsed.activeTrade || null;
          inMemoryPlanData = {
            sessionDate: parsed.sessionDate || '',
            mode: parsed.mode === 'MANUAL' ? 'MANUAL' : 'AUTO',
            pinnedZoneId: parsed.pinnedZoneId || null,
            activeTrade: loadedActive,
            todaySignals: loadedSignals,
            tradesCountToday: Math.max(
              Number(parsed.tradesCountToday || 0),
              loadedSignals.length + (loadedActive ? 1 : 0)
            ),
            stoppedTradesCountToday: Number(parsed.stoppedTradesCountToday || 0),
            levelTradeCounts: parsed.levelTradeCounts || {},
            blockedLevels: parsed.blockedLevels || {},
            retestZones: Array.isArray(parsed.retestZones) ? parsed.retestZones : [],
            lastBrokenZoneId: parsed.lastBrokenZoneId || null,
            transitionMessage: parsed.transitionMessage || null,
            transitionMessageExpiresMs: parsed.transitionMessageExpiresMs || 0,
          };
          return;
        }
      }
    } catch {}
  }
}

function savePersistedPlan(): void {
  try {
    writeJsonAtomic(PLAN_FILE_PERSISTENT, inMemoryPlanData);
  } catch {}
  try {
    if (PLAN_FILE_LOCAL !== PLAN_FILE_PERSISTENT) {
      writeJsonAtomic(PLAN_FILE_LOCAL, inMemoryPlanData);
    }
  } catch {}
}

export function initBlackstonePlanEngine(): void {
  loadPersistedPlan();
}

export function setPlanPinMode(mode: BlackstonePlanMode, zoneId?: string | null): void {
  inMemoryPlanData.mode = mode;
  inMemoryPlanData.pinnedZoneId = mode === 'MANUAL' && zoneId ? zoneId : null;
  savePersistedPlan();
}

/**
 * Main evaluation loop called on ticks and state requests.
 */
export function evaluateLivePlanEngine(
  zones: BlackstoneEvaluatedZone[],
  retiredZones: any[] = []
): BlackstonePlanPayload {
  const timing = getDubaiSessionTiming();
  const tick = getLastValidTick();
  const livePrice = tick && tick.price > 0 ? tick.price : null;
  const nowMs = Date.now();

  // Reset daily counters on new Dubai trading session date (02:00 Dubai)
  if (inMemoryPlanData.sessionDate !== timing.sessionDate) {
    inMemoryPlanData.sessionDate = timing.sessionDate;
    inMemoryPlanData.activeTrade = null;
    inMemoryPlanData.todaySignals = [];
    inMemoryPlanData.tradesCountToday = 0;
    inMemoryPlanData.stoppedTradesCountToday = 0;
    inMemoryPlanData.levelTradeCounts = {};
    inMemoryPlanData.blockedLevels = {};
    inMemoryPlanData.retestZones = [];
    inMemoryPlanData.lastBrokenZoneId = null;
    inMemoryPlanData.transitionMessage = null;
    savePersistedPlan();
  }

  // Clear expired transition message (after 45 seconds)
  if (
    inMemoryPlanData.transitionMessage &&
    inMemoryPlanData.transitionMessageExpiresMs &&
    nowMs > inMemoryPlanData.transitionMessageExpiresMs
  ) {
    inMemoryPlanData.transitionMessage = null;
    savePersistedPlan();
  }

  // 1. Detect any newly broken zones from retiredZones list and turn them into Retest Zones on the other side
  const existingRetestKeys = new Set<string>();
  for (const r of inMemoryPlanData.retestZones) {
    existingRetestKeys.add(r.id);
    const rawId = r.id.replace(/^RETEST_/, '');
    existingRetestKeys.add(rawId);
  }

  for (const rz of retiredZones) {
    if (rz && rz.id && !rz.name?.includes('Reaction Zone')) {
      const rawId = rz.id.replace(/^RETEST_/, '');
      if (!existingRetestKeys.has(rz.id) && !existingRetestKeys.has(rawId) && !existingRetestKeys.has(`RETEST_${rawId}`)) {
        const cleanOriginalName = (rz.name || rz.id)
          .replace(/^Retest\s*·?\s*/i, '')
          .replace(/\s*Retest$/i, '')
          .replace(/^(Buy|Sell)\s*Reaction\s*Zone/i, '')
          .trim() || rz.id;
        const retestFormattedName = `Retest · ${cleanOriginalName}`;
        const flippedSide: 'sell side' | 'buy side' =
          rz.side === 'sell side' ? 'buy side' : 'sell side';

        inMemoryPlanData.retestZones.push({
          id: `RETEST_${rawId}`,
          name: retestFormattedName,
          side: flippedSide,
          level: rz.level,
          low: rz.low,
          high: rz.high,
          proximal: rz.proximal,
          distal: rz.distal,
          grade: rz.grade,
          score: rz.score,
          originalSide: rz.side,
          brokenAtIso: rz.retiredAtIso,
          retestCount: 0,
        });

        existingRetestKeys.add(rz.id);
        existingRetestKeys.add(rawId);
        existingRetestKeys.add(`RETEST_${rawId}`);

        try {
          recordZoneTestOutcome(rawId, cleanOriginalName, 'BROKEN');
        } catch {}

        // Determine next zone to report transition
        const activeRest = zones.filter((z) => z.id !== rz.id && z.id !== rawId);
        const nextOne =
          activeRest.length > 0
            ? livePrice
              ? activeRest.sort(
                  (a, b) => Math.abs(a.level - livePrice) - Math.abs(b.level - livePrice)
                )[0]
              : activeRest[0]
            : null;

        inMemoryPlanData.lastBrokenZoneId = rawId;
        inMemoryPlanData.transitionMessage = nextOne
          ? `${cleanOriginalName} broke. Plan moved to ${nextOne.name}.`
          : `${cleanOriginalName} broke.`;
        inMemoryPlanData.transitionMessageExpiresMs = nowMs + 45000;
        savePersistedPlan();
      }
    }
  }

  // 2. Unblock any levels where price has moved >= $8.00 away from the level
  if (livePrice !== null) {
    for (const [key, b] of Object.entries(inMemoryPlanData.blockedLevels)) {
      const distAway = Math.abs(livePrice - b.level);
      if (distAway >= 8.0) {
        delete inMemoryPlanData.blockedLevels[key];
        savePersistedPlan();
      }
    }
  }

  // 3. Compute M15 ATR(14)
  const m15Atr = computeM15ATR14();
  // Fixed plan: stop loss $10, or $12 when M15 ATR(14) is 6 or higher
  const stopDistanceDollars = m15Atr >= 6.0 ? 12.0 : 10.0;

  // 3b. Read news from existing news engine (same calendar events & decisions as News tab)
  let newsState: BlackstoneNewsState = {
    available: false,
    statusText: 'News unavailable',
    nextEvent: null,
    isNewsPauseActive: false,
    pauseNoticeText: null,
  };

  try {
    const rawEvents = getNewsEventsForUI();
    if (Array.isArray(rawEvents) && rawEvents.length > 0) {
      // Find eligible HIGH or MED impact upcoming or currently active events
      const validEvents = rawEvents
        .filter((e) => !e.isCancelledOrRemoved && (e.impact === 'High' || e.impact === 'Medium'))
        .sort((a, b) => new Date(a.timeUtc).getTime() - new Date(b.timeUtc).getTime());

      // Next relevant event: either in future or within recent 15 minutes of release
      const upcoming = validEvents.find((e) => {
        const t = new Date(e.timeUtc).getTime();
        return t + 15 * 60 * 1000 >= nowMs;
      });

      if (upcoming) {
        const eventMs = new Date(upcoming.timeUtc).getTime();
        const diffMs = eventMs - nowMs;
        const secondsUntil = Math.floor(diffMs / 1000);
        const minutesUntil = Math.floor(diffMs / 60000);

        // High impact pause window: from 30 minutes before to 15 minutes after
        const isHighImpact = upcoming.impact === 'High';
        const pauseStartMs = eventMs - 30 * 60 * 1000;
        const pauseEndMs = eventMs + 15 * 60 * 1000;
        const isPauseWindow = isHighImpact && nowMs >= pauseStartMs && nowMs <= pauseEndMs;

        // Pre-news decision from existing news tab decision engine
        const dec = upcoming.newsDecision || newsDecision(upcoming);
        let decisionLocked = false;
        let decisionDirection: 'BULLISH' | 'BEARISH' | null = null;
        let decisionChipText = 'Decision pending';
        let confidencePercent: number | null = null;

        if (dec && (dec.word === 'BULLISH' || dec.word === 'BEARISH')) {
          decisionLocked = true;
          decisionDirection = dec.word;
          confidencePercent = dec.confidence;
          decisionChipText = `${dec.word} FOR GOLD · ${dec.confidence}%`;
        }

        // Live countdown format
        let countdownFormatted = '';
        if (secondsUntil > 86400) {
          const days = Math.floor(secondsUntil / 86400);
          const hours = Math.floor((secondsUntil % 86400) / 3600);
          const mins = Math.floor((secondsUntil % 3600) / 60);
          const secs = Math.max(0, secondsUntil % 60);
          countdownFormatted = `${days}d ${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
        } else if (secondsUntil > 0) {
          const hours = Math.floor(secondsUntil / 3600);
          const mins = Math.floor((secondsUntil % 3600) / 60);
          const secs = Math.max(0, secondsUntil % 60);
          countdownFormatted = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        } else {
          const pastSecs = Math.abs(secondsUntil);
          const pastMins = Math.floor(pastSecs / 60);
          const remSecs = pastSecs % 60;
          countdownFormatted = `+${pastMins}m ${remSecs}s since release`;
        }

        const isWithin60Minutes = minutesUntil <= 60 && minutesUntil >= 0;

        newsState = {
          available: true,
          statusText: 'LIVE',
          nextEvent: {
            id: upcoming.id,
            name: upcoming.title,
            impact: isHighImpact ? 'HIGH' : 'MED',
            timeUtc: upcoming.timeUtc,
            timeDubai: formatDubaiTimeHHMM(upcoming.timeUtc),
            minutesUntil,
            secondsUntil,
            countdownFormatted,
            decisionLocked,
            decisionDirection,
            decisionChipText,
            confidencePercent,
            isWithin60Minutes,
            isPauseWindow,
          },
          isNewsPauseActive: isPauseWindow,
          pauseNoticeText: isPauseWindow ? 'News window: signals paused' : null,
        };
      } else {
        newsState = {
          available: true,
          statusText: 'LIVE',
          nextEvent: null,
          isNewsPauseActive: false,
          pauseNoticeText: null,
        };
      }
    }
  } catch {
    newsState = {
      available: false,
      statusText: 'News unavailable',
      nextEvent: null,
      isNewsPauseActive: false,
      pauseNoticeText: null,
    };
  }

  // 4. Determine Nearest Zones pair (Above: Sell side, Below: Buy side)
  let nearestAbove: NearestZoneItem | null = null;
  let nearestBelow: NearestZoneItem | null = null;

  const candidatePool: Array<{
    id: BlackstoneZoneId;
    name: BlackstoneZoneName;
    side: 'sell side' | 'buy side';
    level: number;
    low: number;
    high: number;
    grade: string;
    touches: number;
    status: string;
    isRetest?: boolean;
    isSarrafCore?: boolean;
    tag?: 'Sarraf Core' | null;
  }> = [];

  for (const z of zones) {
    candidatePool.push({
      id: z.id,
      name: z.name,
      side: z.side,
      level: z.level,
      low: z.low,
      high: z.high,
      grade: z.grade,
      touches: z.touches,
      status: z.statusLabel,
      isRetest: false,
      isSarrafCore: z.isSarrafCore,
      tag: z.tag ?? null,
    });
  }

  for (const rz of inMemoryPlanData.retestZones) {
    candidatePool.push({
      id: rz.id,
      name: rz.name,
      side: rz.side,
      level: rz.level,
      low: rz.low,
      high: rz.high,
      grade: rz.grade,
      touches: rz.retestCount,
      status: rz.retestCount === 0 ? 'FRESH RETEST' : 'TESTED 1',
      isRetest: true,
      isSarrafCore: false,
      tag: null,
    });
  }

  const activeZoneCandidates = candidatePool.filter((c) => !c.isRetest);
  if (livePrice !== null && activeZoneCandidates.length > 0) {
    const aboveCandidates = activeZoneCandidates
      .filter((c) => c.level >= livePrice)
      .sort((a, b) => a.level - b.level);

    if (aboveCandidates.length > 0) {
      const a = aboveCandidates[0];
      const dist = round2(a.level - livePrice);
      nearestAbove = {
        id: a.id,
        name: a.name,
        side: a.side,
        level: a.level,
        low: a.low,
        high: a.high,
        distance: dist,
        distanceFormatted: `+$${dist.toFixed(2)}`,
        grade: a.grade,
        status: a.status,
        isRetest: a.isRetest,
        isSarrafCore: a.isSarrafCore,
        tag: a.tag,
      };
    }

    const belowCandidates = activeZoneCandidates
      .filter((c) => c.level < livePrice)
      .sort((a, b) => b.level - a.level);

    if (belowCandidates.length > 0) {
      const b = belowCandidates[0];
      const dist = round2(livePrice - b.level);
      nearestBelow = {
        id: b.id,
        name: b.name,
        side: b.side,
        level: b.level,
        low: b.low,
        high: b.high,
        distance: dist,
        distanceFormatted: `-$${dist.toFixed(2)}`,
        grade: b.grade,
        status: b.status,
        isRetest: b.isRetest,
        isSarrafCore: b.isSarrafCore,
        tag: b.tag,
      };
    }
  }

  // 5. Pick Target Zone (Auto-Follow vs Manual Pin)
  let targetZoneItem: {
    id: BlackstoneZoneId;
    name: BlackstoneZoneName;
    side: 'sell side' | 'buy side';
    level: number;
    low: number;
    high: number;
    touches: number;
    isRetest: boolean;
    grade: string;
    isSarrafCore?: boolean;
    tag?: 'Sarraf Core' | null;
  } | null = null;

  if (inMemoryPlanData.mode === 'MANUAL' && inMemoryPlanData.pinnedZoneId) {
    const found = candidatePool.find((c) => c.id === inMemoryPlanData.pinnedZoneId);
    if (found) {
      targetZoneItem = {
        id: found.id,
        name: found.name,
        side: found.side,
        level: found.level,
        low: found.low,
        high: found.high,
        touches: found.touches,
        isRetest: Boolean(found.isRetest),
        grade: found.grade,
        isSarrafCore: found.isSarrafCore,
        tag: found.tag,
      };
    }
  }

  // Auto-follow: the plan always sits on the next zone price will reach
  if (!targetZoneItem && candidatePool.length > 0 && livePrice !== null) {
    // Pick the closest eligible zone by distance
    const sorted = [...candidatePool].sort(
      (a, b) => Math.abs(a.level - livePrice) - Math.abs(b.level - livePrice)
    );
    const top = sorted[0];
    targetZoneItem = {
      id: top.id,
      name: top.name,
      side: top.side,
      level: top.level,
      low: top.low,
      high: top.high,
      touches: top.touches,
      isRetest: Boolean(top.isRetest),
      grade: top.grade,
      isSarrafCore: top.isSarrafCore,
      tag: top.tag,
    };
  } else if (!targetZoneItem && candidatePool.length > 0) {
    const top = candidatePool[0];
    targetZoneItem = {
      id: top.id,
      name: top.name,
      side: top.side,
      level: top.level,
      low: top.low,
      high: top.high,
      touches: top.touches,
      isRetest: Boolean(top.isRetest),
      grade: top.grade,
      isSarrafCore: top.isSarrafCore,
      tag: top.tag,
    };
  }

  // 6. Update Active Trade if one is live
  if (inMemoryPlanData.activeTrade && livePrice !== null) {
    const trade = inMemoryPlanData.activeTrade;
    const isBuy = trade.side === 'BUY';

    // Check TP1
    if (!trade.tp1.hit) {
      const tp1Triggered = isBuy ? livePrice >= trade.tp1.price : livePrice <= trade.tp1.price;
      if (tp1Triggered) {
        trade.tp1.hit = true;
        trade.tp1.hitTimeIso = new Date().toISOString();
        trade.tp1.hitTimeDubai = formatDubaiClockFull();
        trade.tp1.portionPnlDollars = 10.0;
        trade.tp1.portionPnlR = round2(10.0 / trade.oneR);
        // After TP1 move the stop to entry
        trade.currentStopLoss = trade.entryPrice;
        trade.beMoved = true;
        savePersistedPlan();
      }
    }

    // Check TP2
    if (!trade.tp2.hit) {
      const tp2Triggered = isBuy ? livePrice >= trade.tp2.price : livePrice <= trade.tp2.price;
      if (tp2Triggered) {
        trade.tp2.hit = true;
        trade.tp2.hitTimeIso = new Date().toISOString();
        trade.tp2.hitTimeDubai = formatDubaiClockFull();
        trade.tp2.portionPnlDollars = 17.0;
        trade.tp2.portionPnlR = round2(17.0 / trade.oneR);
        savePersistedPlan();
      }
    }

    // Check TP3
    if (!trade.tp3.hit) {
      const tp3Triggered = isBuy ? livePrice >= trade.tp3.price : livePrice <= trade.tp3.price;
      if (tp3Triggered) {
        trade.tp3.hit = true;
        trade.tp3.hitTimeIso = new Date().toISOString();
        trade.tp3.hitTimeDubai = formatDubaiClockFull();
        const diff = Math.abs(trade.tp3.price - trade.entryPrice);
        trade.tp3.portionPnlDollars = round2(diff);
        trade.tp3.portionPnlR = round2(diff / trade.oneR);

        // All 3 targets hit: Trade Completed in Profit
        trade.status = 'CLOSED_PROFIT';
        trade.exitPrice = livePrice;
        trade.exitTimeIso = new Date().toISOString();
        trade.exitTimeDubai = formatDubaiClockFull();
        trade.exitReason = 'All targets reached (TP1, TP2, TP3)';
        trade.realizedPnlDollars = round2(
          trade.tp1.portionPnlDollars + trade.tp2.portionPnlDollars + trade.tp3.portionPnlDollars
        );
        trade.realizedPnlR = round2(trade.realizedPnlDollars / trade.oneR);
        trade.totalPnlDollars = trade.realizedPnlDollars;
        trade.totalPnlR = trade.realizedPnlR;

        inMemoryPlanData.todaySignals.unshift({ ...trade });
        try {
          recordClosedSignalToHistory(trade);
          recordZoneTestOutcome(trade.zoneId, trade.zoneName, 'HELD');
        } catch {}

        // Block level until price moves $8 away
        inMemoryPlanData.blockedLevels[trade.zoneId] = {
          zoneId: trade.zoneId,
          zoneName: trade.zoneName,
          level: (targetZoneItem && targetZoneItem.level) || trade.entryPrice,
          exitPrice: livePrice,
          blockedAtIso: trade.exitTimeIso,
        };
        inMemoryPlanData.activeTrade = null;
        savePersistedPlan();
      }
    }

    // Check Stop Loss Trigger
    if (inMemoryPlanData.activeTrade) {
      const stopTriggered = isBuy
        ? livePrice <= trade.currentStopLoss
        : livePrice >= trade.currentStopLoss;

      if (stopTriggered) {
        trade.exitPrice = livePrice;
        trade.exitTimeIso = new Date().toISOString();
        trade.exitTimeDubai = formatDubaiClockFull();

        if (trade.beMoved) {
          // Stopped at Breakeven on remaining portions
          trade.status = 'CLOSED_BREAKEVEN';
          trade.exitReason = 'Stop loss hit at breakeven';
          trade.realizedPnlDollars = round2(
            (trade.tp1.hit ? trade.tp1.portionPnlDollars : 0) +
              (trade.tp2.hit ? trade.tp2.portionPnlDollars : 0)
          );
          trade.realizedPnlR = round2(trade.realizedPnlDollars / trade.oneR);
        } else {
          // Stopped out at initial Stop Loss (-1R)
          trade.status = 'CLOSED_STOPPED';
          trade.exitReason = 'Stop loss hit at -1.0R';
          trade.realizedPnlDollars = -round2(trade.stopDistance);
          trade.realizedPnlR = -1.0;
          inMemoryPlanData.stoppedTradesCountToday += 1;
        }

        trade.totalPnlDollars = trade.realizedPnlDollars;
        trade.totalPnlR = trade.realizedPnlR;
        inMemoryPlanData.todaySignals.unshift({ ...trade });
        try {
          recordClosedSignalToHistory(trade);
          if (trade.beMoved || trade.realizedPnlDollars > 0) {
            recordZoneTestOutcome(trade.zoneId, trade.zoneName, 'HELD');
          } else {
            recordZoneTestOutcome(trade.zoneId, trade.zoneName, 'BROKEN');
          }
        } catch {}

        // Block level until price moves $8 away
        inMemoryPlanData.blockedLevels[trade.zoneId] = {
          zoneId: trade.zoneId,
          zoneName: trade.zoneName,
          level: (targetZoneItem && targetZoneItem.level) || trade.entryPrice,
          exitPrice: livePrice,
          blockedAtIso: trade.exitTimeIso,
        };
        inMemoryPlanData.activeTrade = null;
        savePersistedPlan();
      }
    }

    // Update live unrealized P&L if still active
    if (inMemoryPlanData.activeTrade) {
      const t = inMemoryPlanData.activeTrade;
      const pointsDiff = isBuy ? livePrice - t.entryPrice : t.entryPrice - livePrice;
      let remainingCount = 0;
      if (!t.tp1.hit) remainingCount++;
      if (!t.tp2.hit) remainingCount++;
      if (!t.tp3.hit) remainingCount++;

      // Each remaining portion contributes (1/3) * pointsDiff
      const unrealizedDollars = round2((remainingCount / 3) * pointsDiff);
      const realizedSoFar =
        (t.tp1.hit ? t.tp1.portionPnlDollars : 0) + (t.tp2.hit ? t.tp2.portionPnlDollars : 0);

      t.unrealizedPnlDollars = unrealizedDollars;
      t.unrealizedPnlR = round2(unrealizedDollars / t.oneR);
      t.realizedPnlDollars = round2(realizedSoFar);
      t.realizedPnlR = round2(realizedSoFar / t.oneR);
      t.totalPnlDollars = round2(realizedSoFar + unrealizedDollars);
      t.totalPnlR = round2(t.totalPnlDollars / t.oneR);
    }
  }

  // 7. Check Limits (max 4 trades/day, max 2 trades/level/day, pause after 3 stopped trades/day, level blocked after exit until $8 away, news window)
  const tradesToday = Math.max(
    inMemoryPlanData.tradesCountToday || 0,
    inMemoryPlanData.todaySignals.length + (inMemoryPlanData.activeTrade ? 1 : 0)
  );
  const stopsToday = inMemoryPlanData.stoppedTradesCountToday || 0;

  const isDailyStopLimitReached = stopsToday >= MAX_STOPS_PER_DAY;
  const isDailyTradeLimitReached = tradesToday >= MAX_TRADES_PER_DAY;
  const isLevelBlocked =
    targetZoneItem && inMemoryPlanData.blockedLevels[targetZoneItem.id] !== undefined;
  const targetLevelTradeCount = targetZoneItem
    ? inMemoryPlanData.levelTradeCounts[targetZoneItem.id] || 0
    : 0;
  const isLevelLimitReached = targetLevelTradeCount >= MAX_TRADES_PER_LEVEL;

  let isPaused = false;
  let pauseReason: string | null = null;

  if (newsState.isNewsPauseActive) {
    isPaused = true;
    pauseReason = 'News window: signals paused';
  } else if (isDailyStopLimitReached) {
    isPaused = true;
    pauseReason = '3 stopped trades today. Signals paused until tomorrow 02:00 Dubai.';
  } else if (isDailyTradeLimitReached) {
    isPaused = true;
    pauseReason = 'Max 4 trades reached today. Signals paused until tomorrow 02:00 Dubai.';
  } else if (isLevelLimitReached) {
    isPaused = true;
    pauseReason = `Max 2 trades reached on ${targetZoneItem?.name || 'this level'} today.`;
  } else if (isLevelBlocked) {
    const bl = inMemoryPlanData.blockedLevels[targetZoneItem!.id];
    const distAway = livePrice !== null ? Math.abs(livePrice - bl.level) : 0;
    isPaused = true;
    pauseReason = `${targetZoneItem?.name} is blocked after exit until price moves $8.00 away (currently $${distAway.toFixed(2)} away).`;
  }

  // 8. Determine Planned Trade Setup (Entry, Stop, TP1, TP2, TP3 with capping)
  let plannedTrade: PlannedTradeSetup | null = null;

  if (targetZoneItem && livePrice !== null) {
    const isBuyZone = targetZoneItem.side === 'buy side';
    // When no trade is live, entry is the target zone edge where trade triggers (high for buy zone, low for sell zone)
    const plannedEntry = isBuyZone ? targetZoneItem.high : targetZoneItem.low;
    const initialStop = isBuyZone
      ? round2(plannedEntry - stopDistanceDollars)
      : round2(plannedEntry + stopDistanceDollars);

    const tp1Price = isBuyZone ? round2(plannedEntry + 10.0) : round2(plannedEntry - 10.0);
    const tp2Price = isBuyZone ? round2(plannedEntry + 17.0) : round2(plannedEntry - 17.0);
    let tp3Price = isBuyZone ? round2(plannedEntry + 25.0) : round2(plannedEntry - 25.0);
    let tp3Capped = false;
    let tp3CapReason: string | undefined = undefined;

    // "If the next zone is closer than TP3, cap TP3 just before that zone."
    if (isBuyZone) {
      const opposingAbove = candidatePool
        .filter((c) => c.id !== targetZoneItem!.id && c.low > plannedEntry)
        .sort((a, b) => a.low - b.low)[0];
      if (opposingAbove && opposingAbove.low < tp3Price) {
        tp3Price = round2(opposingAbove.low - 0.5);
        tp3Capped = true;
        tp3CapReason = `Capped $0.50 below ${opposingAbove.name} (${opposingAbove.low.toFixed(2)})`;
      }
    } else {
      const opposingBelow = candidatePool
        .filter((c) => c.id !== targetZoneItem!.id && c.high < plannedEntry)
        .sort((a, b) => b.high - a.high)[0];
      if (opposingBelow && opposingBelow.high > tp3Price) {
        tp3Price = round2(opposingBelow.high + 0.5);
        tp3Capped = true;
        tp3CapReason = `Capped $0.50 above ${opposingBelow.name} (${opposingBelow.high.toFixed(2)})`;
      }
    }

    plannedTrade = {
      side: isBuyZone ? 'BUY' : 'SELL',
      plannedEntry,
      stopLoss: initialStop,
      stopDistance: stopDistanceDollars,
      oneR: stopDistanceDollars,
      m15Atr,
      tp1: tp1Price,
      tp2: tp2Price,
      tp3: tp3Price,
      tp3Capped,
      tp3CapReason,
    };
  }

  // 9. Evaluate the 4 Entry Gates
  // Gate 1: Zone integrity (not broken and at most 3 tests, or the first retest after a break)
  let gate1Passed = false;
  let gate1Detail = 'Zone not selected';
  if (targetZoneItem) {
    if (targetZoneItem.isRetest) {
      gate1Passed = targetZoneItem.touches <= 1;
      gate1Detail = gate1Passed
        ? `First retest after break (${targetZoneItem.touches} prior retest)`
        : `Retest limit reached (${targetZoneItem.touches} tests)`;
    } else {
      gate1Passed = targetZoneItem.touches <= 3;
      gate1Detail = gate1Passed
        ? `Zone intact with ${targetZoneItem.touches}/3 tests`
        : `Zone tested ${targetZoneItem.touches} times (exceeds 3 tests)`;
    }
  }

  // Gate 2: Reaction (the touching candle has a wick of at least 30% of its range against the zone)
  const store = getCandleStore();
  const m5Candles = store.M5 || [];
  const closedM5 = m5Candles.filter((c) => c.isClosed);
  let gate2Passed = false;
  let measuredWickPct = 0;
  let gate2Detail = 'Waiting for closed candle to touch zone';

  // Gate 3: Close confirmation (that candle has closed outside the zone, it is one of the last 2 closed candles, and price is still outside)
  let gate3Passed = false;
  let gate3Detail = 'Waiting for closed candle outside zone';

  if (targetZoneItem && closedM5.length >= 2 && livePrice !== null) {
    const isBuyZone = targetZoneItem.side === 'buy side';
    const last2Closed = closedM5.slice(-2);

    for (let idx = 0; idx < last2Closed.length; idx++) {
      const c = last2Closed[idx];
      const range = c.high - c.low;
      if (range <= 0.05) continue;

      const touchesZone = c.high >= targetZoneItem.low && c.low <= targetZoneItem.high;
      if (!touchesZone) continue;

      if (isBuyZone) {
        // Lower wick rejecting buy zone
        const lowerWick = Math.min(c.open, c.close) - c.low;
        const wickPct = round2((lowerWick / range) * 100);
        if (wickPct > measuredWickPct) measuredWickPct = wickPct;

        if (wickPct >= 30.0) {
          gate2Passed = true;
          gate2Detail = `Lower wick ${wickPct.toFixed(1)}% (>= 30% required)`;

          // Check Gate 3: candle closed outside the zone (above zone.high for buy) and price still outside
          const closedOutside = c.close > targetZoneItem.high;
          const priceStillOutside = livePrice > targetZoneItem.high;

          if (closedOutside && priceStillOutside) {
            gate3Passed = true;
            gate3Detail = `Candle closed at ${c.close.toFixed(2)} outside zone; live price ${livePrice.toFixed(2)} outside`;
          } else if (!closedOutside) {
            gate3Detail = `Candle close ${c.close.toFixed(2)} inside zone`;
          } else {
            gate3Detail = `Live price ${livePrice.toFixed(2)} returned inside zone`;
          }
        } else {
          gate2Detail = `Lower wick ${wickPct.toFixed(1)}% (below 30% requirement)`;
        }
      } else {
        // Upper wick rejecting sell zone
        const upperWick = c.high - Math.max(c.open, c.close);
        const wickPct = round2((upperWick / range) * 100);
        if (wickPct > measuredWickPct) measuredWickPct = wickPct;

        if (wickPct >= 30.0) {
          gate2Passed = true;
          gate2Detail = `Upper wick ${wickPct.toFixed(1)}% (>= 30% required)`;

          // Check Gate 3: candle closed outside the zone (below zone.low for sell) and price still outside
          const closedOutside = c.close < targetZoneItem.low;
          const priceStillOutside = livePrice < targetZoneItem.low;

          if (closedOutside && priceStillOutside) {
            gate3Passed = true;
            gate3Detail = `Candle closed at ${c.close.toFixed(2)} outside zone; live price ${livePrice.toFixed(2)} outside`;
          } else if (!closedOutside) {
            gate3Detail = `Candle close ${c.close.toFixed(2)} inside zone`;
          } else {
            gate3Detail = `Live price ${livePrice.toFixed(2)} returned inside zone`;
          }
        } else {
          gate2Detail = `Upper wick ${wickPct.toFixed(1)}% (below 30% requirement)`;
        }
      }
    }
  }

  // Gate 4: Room to run (the next zone is at least $17 away)
  let gate4Passed = false;
  let roomDollars = 0;
  let gate4Detail = 'Checking room to next zone';

  if (targetZoneItem) {
    const isBuyZone = targetZoneItem.side === 'buy side';
    if (isBuyZone) {
      const opposingAbove = candidatePool
        .filter((c) => c.id !== targetZoneItem!.id && c.low > targetZoneItem!.high)
        .sort((a, b) => a.low - b.low)[0];
      if (opposingAbove) {
        roomDollars = round2(opposingAbove.low - targetZoneItem.high);
        gate4Passed = roomDollars >= 17.0;
        gate4Detail = gate4Passed
          ? `$${roomDollars.toFixed(2)} room to ${opposingAbove.name} (>= $17 required)`
          : `$${roomDollars.toFixed(2)} room to ${opposingAbove.name} (< $17 required)`;
      } else {
        roomDollars = 50.0;
        gate4Passed = true;
        gate4Detail = 'Open air (no opposing zone within $50)';
      }
    } else {
      const opposingBelow = candidatePool
        .filter((c) => c.id !== targetZoneItem!.id && c.high < targetZoneItem!.low)
        .sort((a, b) => b.high - a.high)[0];
      if (opposingBelow) {
        roomDollars = round2(targetZoneItem.low - opposingBelow.high);
        gate4Passed = roomDollars >= 17.0;
        gate4Detail = gate4Passed
          ? `$${roomDollars.toFixed(2)} room to ${opposingBelow.name} (>= $17 required)`
          : `$${roomDollars.toFixed(2)} room to ${opposingBelow.name} (< $17 required)`;
      } else {
        roomDollars = 50.0;
        gate4Passed = true;
        gate4Detail = 'Open air (no opposing zone within $50)';
      }
    }
  }

  const allGatesPassed = gate1Passed && gate2Passed && gate3Passed && gate4Passed;

  // 10. Execute Entry if all 4 gates pass and no trade is currently live and not paused
  if (
    allGatesPassed &&
    !inMemoryPlanData.activeTrade &&
    !isPaused &&
    livePrice !== null &&
    plannedTrade &&
    targetZoneItem
  ) {
    const isBuy = plannedTrade.side === 'BUY';
    const tradeId = `SIG_${timing.sessionDate.replace(/-/g, '')}_${String(
      inMemoryPlanData.todaySignals.length + 1
    ).padStart(3, '0')}`;

    const newTrade: LivePlanTrade = {
      id: tradeId,
      sessionDate: timing.sessionDate,
      zoneId: targetZoneItem.id,
      zoneName: targetZoneItem.name,
      side: plannedTrade.side,
      entryPrice: livePrice,
      entryTimeIso: new Date().toISOString(),
      entryTimeDubai: formatDubaiClockFull(),
      initialStopLoss: plannedTrade.stopLoss,
      currentStopLoss: plannedTrade.stopLoss,
      stopDistance: plannedTrade.stopDistance,
      oneR: plannedTrade.oneR,
      m15Atr: plannedTrade.m15Atr,
      tp1: {
        price: plannedTrade.tp1,
        hit: false,
        portionPnlDollars: 0,
        portionPnlR: 0,
      },
      tp2: {
        price: plannedTrade.tp2,
        hit: false,
        portionPnlDollars: 0,
        portionPnlR: 0,
      },
      tp3: {
        price: plannedTrade.tp3,
        capped: plannedTrade.tp3Capped,
        originalPrice: isBuy ? round2(livePrice + 25.0) : round2(livePrice - 25.0),
        hit: false,
        portionPnlDollars: 0,
        portionPnlR: 0,
      },
      beMoved: false,
      status: 'ACTIVE',
      realizedPnlDollars: 0,
      realizedPnlR: 0,
      unrealizedPnlDollars: 0,
      unrealizedPnlR: 0,
      totalPnlDollars: 0,
      totalPnlR: 0,
    };

    inMemoryPlanData.activeTrade = newTrade;
    inMemoryPlanData.tradesCountToday = tradesToday + 1;
    inMemoryPlanData.levelTradeCounts[targetZoneItem.id] = (targetLevelTradeCount || 0) + 1;
    savePersistedPlan();
  }

  const finalTradesToday = Math.max(
    inMemoryPlanData.tradesCountToday || 0,
    inMemoryPlanData.todaySignals.length + (inMemoryPlanData.activeTrade ? 1 : 0)
  );
  const finalStopsToday = inMemoryPlanData.stoppedTradesCountToday || 0;

  // 11. Determine Phase: WATCHING, APPROACHING (within $15), IN ZONE, TRADE LIVE, PAUSED
  let phase: BlackstonePlanPhase = 'WATCHING';
  let phaseDescription = 'Watching market structure for zone setup';

  if (inMemoryPlanData.activeTrade) {
    phase = 'TRADE LIVE';
    phaseDescription = `Live ${inMemoryPlanData.activeTrade.side} trade running on ${inMemoryPlanData.activeTrade.zoneName}`;
  } else if (isPaused) {
    phase = 'PAUSED';
    phaseDescription = pauseReason || 'Plan paused';
  } else if (targetZoneItem && livePrice !== null) {
    const inZone = livePrice >= targetZoneItem.low && livePrice <= targetZoneItem.high;
    const distToZone =
      livePrice > targetZoneItem.high
        ? livePrice - targetZoneItem.high
        : livePrice < targetZoneItem.low
          ? targetZoneItem.low - livePrice
          : 0;

    if (inZone) {
      phase = 'IN ZONE';
      phaseDescription = `Price inside ${targetZoneItem.name} (${targetZoneItem.low.toFixed(2)}–${targetZoneItem.high.toFixed(2)})`;
    } else if (distToZone <= 15.0) {
      phase = 'APPROACHING';
      phaseDescription = `Price within $${distToZone.toFixed(2)} of ${targetZoneItem.name}`;
    } else {
      phase = 'WATCHING';
      phaseDescription = `Watching ${targetZoneItem.name} ($${distToZone.toFixed(2)} away)`;
    }
  }

  // Format blocked levels list for UI
  const blockedList = Object.values(inMemoryPlanData.blockedLevels).map((bl) => {
    const dist = livePrice !== null ? round2(Math.abs(livePrice - bl.level)) : 0;
    return {
      zoneId: bl.zoneId,
      zoneName: bl.zoneName,
      level: bl.level,
      distanceAway: dist,
      needsDistance: 8.0,
    };
  });

  return {
    sessionDate: timing.sessionDate,
    phase,
    phaseDescription,
    mode: inMemoryPlanData.mode,
    pinnedZoneId: inMemoryPlanData.pinnedZoneId,
    targetZone: targetZoneItem,
    transitionMessage: inMemoryPlanData.transitionMessage,
    m15Atr,
    stopDistanceDollars,
    plannedTrade,
    gates: {
      gate1: {
        passed: gate1Passed,
        label: 'Zone Integrity',
        detail: gate1Detail,
        touches: targetZoneItem ? targetZoneItem.touches : 0,
        isRetest: targetZoneItem ? targetZoneItem.isRetest : false,
      },
      gate2: {
        passed: gate2Passed,
        label: 'Reaction (30% Wick)',
        detail: gate2Detail,
        wickPct: measuredWickPct,
        minWickPct: 30.0,
      },
      gate3: {
        passed: gate3Passed,
        label: 'Close Confirmation',
        detail: gate3Detail,
        closedOutside: gate3Passed,
        priceStillOutside: gate3Passed,
      },
      gate4: {
        passed: gate4Passed,
        label: 'Room to Run (>= $17)',
        detail: gate4Detail,
        roomDollars,
        minRoomDollars: 17.0,
      },
      allPassed: allGatesPassed,
    },
    nearestZones: {
      above: nearestAbove,
      below: nearestBelow,
    },
    activeTrade: inMemoryPlanData.activeTrade,
    todaySignals: inMemoryPlanData.todaySignals,
    tradesToday: finalTradesToday,
    maxTrades: MAX_TRADES_PER_DAY,
    stopsToday: finalStopsToday,
    maxStops: MAX_STOPS_PER_DAY,
    stoppedTradesCountToday: finalStopsToday,
    maxStoppedTradesLimit: MAX_STOPS_PER_DAY,
    levelTradeCounts: inMemoryPlanData.levelTradeCounts,
    maxTradesPerLevelLimit: MAX_TRADES_PER_LEVEL,
    blockedLevels: blockedList,
    isPaused,
    pauseReason,
    news: newsState,
    livePrice,
    updatedAtDubai: formatDubaiClockFull(),
  };
}
