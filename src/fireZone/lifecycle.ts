// src/fireZone/lifecycle.ts
import {
  Candle,
  FireZone,
  FireZonePersistedState,
  FireZonePersistedStateV2,
  FlipWatch,
  FlippedLevelCandidate,
  RetiredZoneHistoryItem,
  ZoneLifecycleState,
  ZoneSide,
  ZoneType,
} from './types';
import { computeFreshnessPoints } from './levels';

export const FIRE_ZONE_STORAGE_KEY = 'fireZone.v2';
export const MAX_RETIRED_HISTORY = 10;
export const MAX_LEVEL_EVENTS = 4;
export const MAX_ZONE_AGE_BARS = 150;
export const ZONE_HALF_WIDTH = 2.0; // $4 wide = anchor +/- $2

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

// Fallback in-memory storage when window.localStorage is unavailable (e.g. Node unit tests)
const memoryStorageMap = new Map<string, string>();
export const memoryStorage: StorageLike = {
  getItem: (k) => memoryStorageMap.get(k) ?? null,
  setItem: (k, v) => {
    memoryStorageMap.set(k, v);
  },
  removeItem: (k) => {
    memoryStorageMap.delete(k);
  },
};

export function getDefaultStorage(): StorageLike {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // ignore iframe storage errors
  }
  return memoryStorage;
}

export function formatEventPrice(price: number): string {
  return price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * 1) BREAK RULES
 * - Closed-candle break: a closed H1 candle closes beyond the far edge by more than 0.25*ATR.
 *   (SELL: close > HI + 0.25*ATR, BUY: close < LO - 0.25*ATR)
 * - Live break (provisional): the LIVE price is beyond the far edge by more than 0.5*ATR.
 *   (SELL: price > HI + 0.5*ATR, BUY: price < LO - 0.5*ATR)
 * - Wicks never break a zone.
 */
export function isZoneBrokenByClosedCandle(
  side: ZoneSide,
  lo: number,
  hi: number,
  candle: Pick<Candle, 'close'>,
  atr: number
): { broken: boolean; excessDollar: number } {
  const effectiveAtr = Math.max(0.5, atr);
  if (side === 'SELL') {
    const threshold = hi + 0.25 * effectiveAtr;
    if (candle.close > threshold) {
      return {
        broken: true,
        excessDollar: Number((candle.close - hi).toFixed(2)),
      };
    }
  } else {
    const threshold = lo - 0.25 * effectiveAtr;
    if (candle.close < threshold) {
      return {
        broken: true,
        excessDollar: Number((lo - candle.close).toFixed(2)),
      };
    }
  }
  return { broken: false, excessDollar: 0 };
}

export function isZoneBrokenByLivePrice(
  side: ZoneSide,
  lo: number,
  hi: number,
  livePrice: number,
  atr: number
): { broken: boolean; excessDollar: number } {
  if (!(livePrice > 0)) return { broken: false, excessDollar: 0 };
  const effectiveAtr = Math.max(0.5, atr);
  if (side === 'SELL') {
    const threshold = hi + 0.5 * effectiveAtr;
    if (livePrice > threshold) {
      return {
        broken: true,
        excessDollar: Number((livePrice - hi).toFixed(2)),
      };
    }
  } else {
    const threshold = lo - 0.5 * effectiveAtr;
    if (livePrice < threshold) {
      return {
        broken: true,
        excessDollar: Number((lo - livePrice).toFixed(2)),
      };
    }
  }
  return { broken: false, excessDollar: 0 };
}

/**
 * 3) FLIP (only after retest)
 * - When a zone breaks, create a flip watch:
 *   { id: "F<price>", side: opposite side, anchor, score, armed: false, confirmed: false }
 * - ARMED: price moves at least 1*ATR beyond the broken anchor in the break direction.
 *   - Broken SELL (new side = BUY, break direction = UP): price >= anchor + 1*ATR
 *   - Broken BUY (new side = SELL, break direction = DOWN): price <= anchor - 1*ATR
 * - CONFIRMED: after being armed, price comes back to within 0.5*ATR of the anchor
 *   (retest from the new side, not beyond it by more than $1).
 *   - New side = BUY (retesting from above): price <= anchor + 0.5*ATR AND price >= anchor - 1.0
 *   - New side = SELL (retesting from below): price >= anchor - 0.5*ATR AND price <= anchor + 1.0
 * - Only a CONFIRMED flip becomes a normal candidate (id: "F<price>") in the selection,
 *   with the old score. An unconfirmed flip is never shown.
 */
export function createFlipWatch(
  brokenZone: { id?: string; side: ZoneSide; anchor: number; score: number },
  brokenAtTime?: number,
  brokenBarIndex?: number
): FlipWatch {
  const newSide: ZoneSide = brokenZone.side === 'SELL' ? 'BUY' : 'SELL';
  const anchor = Number(brokenZone.anchor.toFixed(2));
  return {
    id: `F${Math.round(anchor)}`,
    fromZoneId: brokenZone.id,
    side: newSide,
    anchor,
    score: brokenZone.score,
    armed: false,
    confirmed: false,
    brokenAtTime,
    brokenBarIndex,
  };
}

export function stepFlipWatchWithPrice(
  watch: FlipWatch,
  price: number,
  atr: number
): { watch: FlipWatch; newlyConfirmed: boolean } {
  if (!(price > 0)) return { watch, newlyConfirmed: false };
  const effectiveAtr = Math.max(0.5, atr);
  let armed = watch.armed;
  let confirmed = watch.confirmed;
  let newlyConfirmed = false;

  if (!armed) {
    // Break direction is UP when new side is BUY (broken SELL), DOWN when new side is SELL (broken BUY)
    const armDist = 1.0 * effectiveAtr;
    if (watch.side === 'BUY') {
      if (price >= watch.anchor + armDist) {
        armed = true;
      }
    } else {
      if (price <= watch.anchor - armDist) {
        armed = true;
      }
    }
    return {
      watch: armed !== watch.armed ? { ...watch, armed } : watch,
      newlyConfirmed: false,
    };
  }

  if (armed && !confirmed) {
    // Retest from the new side within 0.5*ATR of anchor, and not beyond anchor by more than $1
    if (watch.side === 'BUY') {
      if (price <= watch.anchor + 0.5 * effectiveAtr && price >= watch.anchor - 1.0) {
        confirmed = true;
        newlyConfirmed = true;
      }
    } else {
      if (price >= watch.anchor - 0.5 * effectiveAtr && price <= watch.anchor + 1.0) {
        confirmed = true;
        newlyConfirmed = true;
      }
    }
  }

  if (armed !== watch.armed || confirmed !== watch.confirmed) {
    return {
      watch: { ...watch, armed, confirmed },
      newlyConfirmed,
    };
  }
  return { watch, newlyConfirmed: false };
}

export function stepFlipWatchWithCandle(
  watch: FlipWatch,
  candle: Candle,
  atr: number
): { watch: FlipWatch; newlyConfirmed: boolean } {
  const effectiveAtr = Math.max(0.5, atr);
  let current = watch;

  // Step 1: Check if this candle arms the watch (must be armed BEFORE a subsequent retest confirms it,
  // or if already armed on an earlier bar, check confirmation on this bar)
  if (!current.armed) {
    const armThreshold =
      current.side === 'BUY'
        ? current.anchor + 1.0 * effectiveAtr
        : current.anchor - 1.0 * effectiveAtr;
    const reachedArm =
      current.side === 'BUY' ? candle.high >= armThreshold : candle.low <= armThreshold;
    if (reachedArm) {
      current = { ...current, armed: true };
    }
    return { watch: current, newlyConfirmed: false };
  }

  if (current.armed && !current.confirmed) {
    if (current.side === 'BUY') {
      const withinHalfAtr = candle.low <= current.anchor + 0.5 * effectiveAtr;
      const notBeyond1Dollar =
        candle.close >= current.anchor - 1.0 && candle.low >= current.anchor - 1.0;
      if (withinHalfAtr && notBeyond1Dollar) {
        return {
          watch: { ...current, confirmed: true },
          newlyConfirmed: true,
        };
      }
    } else {
      const withinHalfAtr = candle.high >= current.anchor - 0.5 * effectiveAtr;
      const notBeyond1Dollar =
        candle.close <= current.anchor + 1.0 && candle.high <= current.anchor + 1.0;
      if (withinHalfAtr && notBeyond1Dollar) {
        return {
          watch: { ...current, confirmed: true },
          newlyConfirmed: true,
        };
      }
    }
  }

  return { watch: current, newlyConfirmed: false };
}

/**
 * 4) HELD / PLAYED
 * If a candle wicked into the zone and then closed at least 1*ATR away on the correct side,
 * or 3 closes in a row away, mark it HELD:
 * - show it as an event ("BUY zone 4,015.47 HELD: price bounced +$32.")
 * - keep it in the list, but count one more retest (freshness drops: 0->+4, 1->+2, 2->0)
 * - if it reaches 3 retests it is retired.
 */
export interface HeldZoneEvaluation {
  heldCount: number;
  updatedRetests: number;
  updatedScore: number;
  retiredByMaxRetests: boolean;
  lastBounceDollar: number;
  lastHeldCandleTime?: number;
}

export function evaluateZoneHeldOnCandles(
  zone: {
    side: ZoneSide;
    anchor: number;
    score: number;
    retests: number;
    pivotIndex: number;
  },
  closedCandles: Candle[],
  atr: number
): HeldZoneEvaluation {
  const effectiveAtr = Math.max(0.5, atr);
  const lo = Number((zone.anchor - ZONE_HALF_WIDTH).toFixed(2));
  const hi = Number((zone.anchor + ZONE_HALF_WIDTH).toFixed(2));

  let hasLeftZone = false;
  let activeTouchWaitingReaction = false;
  let consecutiveAwayCloses = 0;
  let heldCount = 0;
  let lastBounceDollar = 0;
  let lastHeldCandleTime: number | undefined;

  const startIdx = Math.max(0, zone.pivotIndex + 1);
  for (let i = startIdx; i < closedCandles.length; i++) {
    const c = closedCandles[i];

    // Check if candle is completely outside on the correct side so a subsequent touch is a true retest
    const outsideCorrectSide = zone.side === 'BUY' ? c.low > hi : c.high < lo;
    if (outsideCorrectSide && !activeTouchWaitingReaction) {
      hasLeftZone = true;
    }

    const wickedIntoZone =
      zone.side === 'BUY'
        ? c.low <= hi && c.close >= lo - 0.25 * effectiveAtr
        : c.high >= lo && c.close <= hi + 0.25 * effectiveAtr;

    if (hasLeftZone && wickedIntoZone) {
      activeTouchWaitingReaction = true;
      consecutiveAwayCloses = 0;
    }

    if (activeTouchWaitingReaction) {
      if (zone.side === 'BUY') {
        if (c.close > hi) {
          consecutiveAwayCloses++;
        } else {
          consecutiveAwayCloses = 0;
        }
        const closed1AtrAway = c.close >= hi + effectiveAtr;
        if (closed1AtrAway || consecutiveAwayCloses >= 3) {
          heldCount++;
          lastBounceDollar = Math.max(
            1,
            Math.round(Math.max(c.high - zone.anchor, c.close - zone.anchor))
          );
          lastHeldCandleTime = c.time;
          activeTouchWaitingReaction = false;
          consecutiveAwayCloses = 0;
          hasLeftZone = true;
        }
      } else {
        if (c.close < lo) {
          consecutiveAwayCloses++;
        } else {
          consecutiveAwayCloses = 0;
        }
        const closed1AtrAway = c.close <= lo - effectiveAtr;
        if (closed1AtrAway || consecutiveAwayCloses >= 3) {
          heldCount++;
          lastBounceDollar = Math.max(
            1,
            Math.round(Math.max(zone.anchor - c.low, zone.anchor - c.close))
          );
          lastHeldCandleTime = c.time;
          activeTouchWaitingReaction = false;
          consecutiveAwayCloses = 0;
          hasLeftZone = true;
        }
      }
    }
  }

  // Apply one more retest per HELD reaction on top of base retests if not already counted
  const baseRetests = zone.retests;
  const updatedRetests = Math.max(baseRetests, heldCount);
  const oldFreshness = computeFreshnessPoints(baseRetests) ?? 0;
  const newFreshness = computeFreshnessPoints(updatedRetests);
  const retiredByMaxRetests = newFreshness === null || updatedRetests >= 3;
  const freshnessDelta = (newFreshness ?? 0) - oldFreshness;
  const updatedScore = Math.max(1, zone.score + freshnessDelta);

  return {
    heldCount,
    updatedRetests,
    updatedScore,
    retiredByMaxRetests,
    lastBounceDollar,
    lastHeldCandleTime,
  };
}

/**
 * Helper to apply a single HELD reaction to a zone/candidate:
 * increments retests by 1, recalculates freshness points (0->+4, 1->+2, 2->0),
 * and retires if retests >= 3.
 */
export function applyHeldReactionToCandidate<
  T extends { side: ZoneSide; anchor: number; retests: number; score: number }
>(
  candidate: T,
  bounceDollar = 32
): {
  updated: T | null;
  retired: boolean;
  eventSentence: string;
} {
  const prevFreshness = computeFreshnessPoints(candidate.retests) ?? 0;
  const nextRetests = candidate.retests + 1;
  const nextFreshness = computeFreshnessPoints(nextRetests);
  const eventSentence = formatHeldEventSentence(
    candidate.side,
    candidate.anchor,
    bounceDollar
  );

  if (nextFreshness === null || nextRetests >= 3) {
    return {
      updated: null,
      retired: true,
      eventSentence,
    };
  }

  const nextScore = Math.max(1, candidate.score - prevFreshness + nextFreshness);
  return {
    updated: {
      ...candidate,
      retests: nextRetests,
      score: nextScore,
      ...('freshnessPoints' in candidate ? { freshnessPoints: nextFreshness } : {}),
    },
    retired: false,
    eventSentence,
  };
}

/**
 * 5) EVENTS (keep the last 4 events)
 * Sentences:
 * - "SELL zone 4,102.99 BROKE ($5.52 beyond the far edge). Removed, next SELL zone selected. Flip watch started."
 * - "FLIP confirmed: 4,102.99 retested and is now a BUY zone."
 * - "BUY zone 4,015.47 HELD: price bounced +$32."
 */
export function formatBreakEventSentence(
  side: ZoneSide,
  anchor: number,
  excessDollar: number
): string {
  const priceStr = formatEventPrice(anchor);
  const excessStr = Math.max(0.01, excessDollar).toFixed(2);
  return `${side} zone ${priceStr} BROKE ($${excessStr} beyond the far edge). Removed, next ${side} zone selected. Flip watch started.`;
}

export function formatFlipConfirmedEventSentence(
  anchor: number,
  newSide: ZoneSide
): string {
  const priceStr = formatEventPrice(anchor);
  return `FLIP confirmed: ${priceStr} retested and is now a ${newSide} zone.`;
}

export function formatHeldEventSentence(
  side: ZoneSide,
  anchor: number,
  moveDollar: number
): string {
  const priceStr = formatEventPrice(anchor);
  const roundedMove = Math.max(1, Math.round(Math.abs(moveDollar)));
  const action =
    side === 'BUY' ? `bounced +$${roundedMove}` : `dropped -$${roundedMove}`;
  return `${side} zone ${priceStr} HELD: price ${action}.`;
}

export function appendLifecycleEvent(
  events: string[],
  newEvent: string
): string[] {
  if (!newEvent) return events.slice(0, MAX_LEVEL_EVENTS);
  const deduped = events.filter((e) => e !== newEvent);
  return [newEvent, ...deduped].slice(0, MAX_LEVEL_EVENTS);
}

export interface ZoneEvaluationOutcome {
  state: 'FRESH' | 'PLAYED_HELD' | 'BROKEN' | 'EXPIRED';
  eventBarIndex?: number;
  eventCandleTime?: number;
  moveAfter: number;
  retests?: number;
  flippedCandidate?: FlippedLevelCandidate;
}

/**
 * Evaluate the closed-candle lifecycle state of a single zone over CLOSED H1 candles.
 * Supports both Phase 2 (0.25*ATR close break, HELD retest counting) and legacy callers.
 */
export function evaluateZoneClosedLifecycle(
  side: ZoneSide,
  anchor: number,
  anchorBarIndex: number,
  closedCandles: Candle[],
  atr: number,
  useQuarterAtrBreak = false
): ZoneEvaluationOutcome {
  const n = closedCandles.length;
  if (n === 0) {
    return { state: 'FRESH', moveAfter: 0, retests: 0 };
  }

  const lo = Number((anchor - ZONE_HALF_WIDTH).toFixed(2));
  const hi = Number((anchor + ZONE_HALF_WIDTH).toFixed(2));
  const effectiveAtr = Math.max(1.5, atr);
  const breakMargin = useQuarterAtrBreak ? 0.25 * effectiveAtr : 1.0;

  let hasTouched = false;
  let consecutiveRightSideCloses = 0;
  let peakMove = 0;

  const startIdx = Math.max(0, anchorBarIndex + 1);
  for (let i = startIdx; i < n; i++) {
    const c = closedCandles[i];

    // 1. Check BROKEN on candle CLOSE beyond far edge (wicks never break)
    if (side === 'BUY') {
      if (c.close < lo - breakMargin) {
        const moveAfter = Number(Math.abs(anchor - c.close).toFixed(2));
        return {
          state: 'BROKEN',
          eventBarIndex: i,
          eventCandleTime: c.time,
          moveAfter,
          flippedCandidate: {
            anchor,
            fromSide: 'BUY',
            toSide: 'SELL',
            brokenCandleTime: c.time,
            brokenBarIndex: i,
            bonusScore: 2,
          },
        };
      }
    } else {
      if (c.close > hi + breakMargin) {
        const moveAfter = Number(Math.abs(c.close - anchor).toFixed(2));
        return {
          state: 'BROKEN',
          eventBarIndex: i,
          eventCandleTime: c.time,
          moveAfter,
          flippedCandidate: {
            anchor,
            fromSide: 'SELL',
            toSide: 'BUY',
            brokenCandleTime: c.time,
            brokenBarIndex: i,
            bonusScore: 2,
          },
        };
      }
    }

    // 2. Check touch (wick into zone: BUY low <= HI, SELL high >= LO)
    const wickedIntoZone = side === 'BUY' ? c.low <= hi : c.high >= lo;
    if (wickedIntoZone) {
      hasTouched = true;
    }

    // 3. Once touched, check PLAYED_HELD conditions on this or subsequent closed candles
    if (hasTouched) {
      if (side === 'BUY') {
        const moveFromAnchor = Math.max(0, c.high - anchor, c.close - lo);
        if (moveFromAnchor > peakMove) peakMove = moveFromAnchor;

        if (c.close > hi) {
          consecutiveRightSideCloses++;
        } else {
          consecutiveRightSideCloses = 0;
        }

        const closed1AtrAway = c.close >= hi + effectiveAtr;
        const closed3Consecutive = consecutiveRightSideCloses >= 3;

        if (closed1AtrAway || closed3Consecutive) {
          return {
            state: 'PLAYED_HELD',
            eventBarIndex: i,
            eventCandleTime: c.time,
            moveAfter: Number(Math.max(peakMove, c.close - anchor).toFixed(2)),
            retests: 1,
          };
        }
      } else {
        const moveFromAnchor = Math.max(0, anchor - c.low, hi - c.close);
        if (moveFromAnchor > peakMove) peakMove = moveFromAnchor;

        if (c.close < lo) {
          consecutiveRightSideCloses++;
        } else {
          consecutiveRightSideCloses = 0;
        }

        const closed1AtrAway = c.close <= lo - effectiveAtr;
        const closed3Consecutive = consecutiveRightSideCloses >= 3;

        if (closed1AtrAway || closed3Consecutive) {
          return {
            state: 'PLAYED_HELD',
            eventBarIndex: i,
            eventCandleTime: c.time,
            moveAfter: Number(Math.max(peakMove, anchor - c.close).toFixed(2)),
            retests: 1,
          };
        }
      }
    }
  }

  // 4. Check EXPIRED (> 150 H1 candles old)
  const ageBars = n - 1 - anchorBarIndex;
  if (ageBars > MAX_ZONE_AGE_BARS) {
    const lastBar = closedCandles[n - 1];
    return {
      state: 'EXPIRED',
      eventBarIndex: n - 1,
      eventCandleTime: lastBar.time,
      moveAfter: Number(Math.abs(lastBar.close - anchor).toFixed(2)),
    };
  }

  return { state: 'FRESH', moveAfter: 0, retests: 0 };
}

/**
 * Compute live display state for an active (non-retired) zone.
 * TESTING is shown live only when currentPrice is inside [LO, HI] and is never persisted.
 */
export function getLiveZoneDisplayState(
  zone: Pick<FireZone, 'bottom' | 'top'>,
  livePrice: number
): ZoneLifecycleState {
  if (livePrice > 0 && livePrice >= zone.bottom && livePrice <= zone.top) {
    return 'TESTING';
  }
  return 'FRESH';
}

/**
 * Format a retired zone history item as a sentence.
 */
export function formatLevelEventSentence(item: RetiredZoneHistoryItem | undefined): string | null {
  if (!item) return null;
  const anchorStr = item.anchor.toFixed(2);

  if (item.result === 'HELD') {
    const moveDollar = Math.max(1, Math.round(item.moveAfter));
    const dirVerb = item.side === 'BUY' ? `bounced +$${moveDollar}` : `dropped -$${moveDollar}`;
    const nextPart =
      typeof item.nextZoneAnchor === 'number'
        ? ` Next ${item.side} zone is ${item.nextZoneAnchor.toFixed(2)}`
        : '';
    return `${item.side} zone ${anchorStr} held: price ${dirVerb}.${nextPart}`;
  }

  if (item.result === 'BROKEN') {
    const flippedSide: ZoneSide = item.side === 'BUY' ? 'SELL' : 'BUY';
    return `${item.side} zone ${anchorStr} broke on candle close. It now acts as a ${flippedSide} candidate`;
  }

  const nextPart =
    typeof item.nextZoneAnchor === 'number'
      ? ` Next ${item.side} zone is ${item.nextZoneAnchor.toFixed(2)}`
      : '';
  return `${item.side} zone ${anchorStr} expired (>150 H1 candles).${nextPart}`;
}

export function appendRetiredHistory(
  history: RetiredZoneHistoryItem[],
  newItem: RetiredZoneHistoryItem
): RetiredZoneHistoryItem[] {
  const filtered = history.filter((h) => h.id !== newItem.id);
  return [newItem, ...filtered].slice(0, MAX_RETIRED_HISTORY);
}

/**
 * 6) PERSISTENCE ("fireZone.v2")
 * Save active zone ids, activeZones, brokenIds, flip watches and events in localStorage under key "fireZone.v2".
 * On load, restore, then re-validate against the loaded candles (drop anything broken since the save).
 */
export function saveFireZoneV2State(
  state: {
    activeZones: FireZone[];
    brokenIds: Iterable<string>;
    flipWatches: FlipWatch[];
    events: string[];
    history?: RetiredZoneHistoryItem[];
  },
  storage: StorageLike = getDefaultStorage()
): void {
  const activeZonesPayload = state.activeZones.map((z) => ({
    id: z.id,
    side: z.side,
    anchor: Number(z.anchor.toFixed(2)),
    type: (z.type || 'NEAREST') as ZoneType,
    state: 'FRESH' as const, // TESTING is live-only, never saved
    createdBarTime: z.pivotTime,
    score: z.score,
    retests: z.touches,
  }));

  const payload: FireZonePersistedStateV2 = {
    version: 2,
    activeZoneIds: activeZonesPayload.map((z) => z.id),
    activeZones: activeZonesPayload,
    brokenIds: Array.from(new Set(state.brokenIds)),
    flipWatches: state.flipWatches.slice(-30),
    events: state.events.slice(0, MAX_LEVEL_EVENTS),
    history: (state.history || []).slice(0, MAX_RETIRED_HISTORY),
  };

  try {
    storage.setItem(FIRE_ZONE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage quota errors
  }
}

export function loadFireZoneV2State(
  storage: StorageLike = getDefaultStorage()
): FireZonePersistedStateV2 | null {
  try {
    const raw = storage.getItem(FIRE_ZONE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Omit<FireZonePersistedStateV2, 'version'>> & {
      version?: number;
      flippedLevels?: FlippedLevelCandidate[];
    };
    if (!parsed || !Array.isArray(parsed.activeZones)) {
      return null;
    }


    if (parsed.version === 2) {
      return {
        version: 2,
        activeZoneIds: Array.isArray(parsed.activeZoneIds)
          ? parsed.activeZoneIds
          : parsed.activeZones.map((z) => z.id),
        activeZones: parsed.activeZones.map((z) => ({
          ...z,
          state: 'FRESH' as const,
        })),
        brokenIds: Array.isArray(parsed.brokenIds) ? parsed.brokenIds : [],
        flipWatches: Array.isArray(parsed.flipWatches) ? parsed.flipWatches : [],
        events: Array.isArray(parsed.events) ? parsed.events.slice(0, MAX_LEVEL_EVENTS) : [],
        history: Array.isArray(parsed.history) ? parsed.history.slice(0, MAX_RETIRED_HISTORY) : [],
      };
    }

    // Upgrade v1 payload if encountered
    if (parsed.version === 1) {
      return {
        version: 2,
        activeZoneIds: parsed.activeZones.map((z) => z.id),
        activeZones: parsed.activeZones.map((z) => ({
          ...z,
          state: 'FRESH' as const,
        })),
        brokenIds: [],
        flipWatches: [],
        events: [],
        history: Array.isArray(parsed.history) ? parsed.history.slice(0, MAX_RETIRED_HISTORY) : [],
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Restore "fireZone.v2" state and re-validate saved active zones & flip watches against loaded closed H1 candles.
 * Any saved zone that broke on a closed candle (close beyond far edge by > 0.25*ATR) since the save:
 * - is dropped from validSavedZones
 * - has its ID added to brokenIds
 * - starts a FlipWatch (which is also stepped forward through subsequent candles)
 * - records a BROKE event sentence in events (capped at 4).
 */
export function restoreAndRevalidateV2State(
  closedCandles: Candle[],
  atr: number,
  storage: StorageLike = getDefaultStorage()
): {
  validSavedZones: FireZonePersistedStateV2['activeZones'];
  activeZoneIds: string[];
  brokenIds: Set<string>;
  flipWatches: FlipWatch[];
  events: string[];
  history: RetiredZoneHistoryItem[];
} {
  const loaded = loadFireZoneV2State(storage);
  if (!loaded) {
    return {
      validSavedZones: [],
      activeZoneIds: [],
      brokenIds: new Set<string>(),
      flipWatches: [],
      events: [],
      history: [],
    };
  }

  const effectiveAtr = Math.max(0.5, atr);
  const brokenIds = new Set<string>(loaded.brokenIds);
  let events = [...loaded.events];
  let history = [...(loaded.history || [])];
  const flipMap = new Map<string, FlipWatch>();
  for (const fw of loaded.flipWatches) {
    flipMap.set(`${fw.side}:${Math.round(fw.anchor)}`, { ...fw });
  }

  const validSavedZones: FireZonePersistedStateV2['activeZones'] = [];

  if (closedCandles.length === 0) {
    return {
      validSavedZones: loaded.activeZones.filter((z) => !brokenIds.has(z.id)),
      activeZoneIds: loaded.activeZoneIds.filter((id) => !brokenIds.has(id)),
      brokenIds,
      flipWatches: Array.from(flipMap.values()),
      events: events.slice(0, MAX_LEVEL_EVENTS),
      history,
    };
  }

  for (const saved of loaded.activeZones) {
    if (brokenIds.has(saved.id)) {
      continue;
    }

    const lo = Number((saved.anchor - ZONE_HALF_WIDTH).toFixed(2));
    const hi = Number((saved.anchor + ZONE_HALF_WIDTH).toFixed(2));

    let startIdx = closedCandles.findIndex((c) => c.time > saved.createdBarTime);
    if (startIdx < 0) {
      const exactIdx = closedCandles.findIndex((c) => c.time >= saved.createdBarTime);
      startIdx = exactIdx >= 0 ? exactIdx + 1 : Math.max(0, closedCandles.length - 10);
    }

    let brokeAtIdx = -1;
    let excessDollar = 0;

    for (let i = startIdx; i < closedCandles.length; i++) {
      const c = closedCandles[i];
      const check = isZoneBrokenByClosedCandle(saved.side, lo, hi, c, effectiveAtr);
      if (check.broken) {
        brokeAtIdx = i;
        excessDollar = check.excessDollar;
        break;
      }
    }

    if (brokeAtIdx >= 0) {
      // Zone broke since the save -> drop it, add to brokenIds, create flip watch, emit event
      brokenIds.add(saved.id);
      const defaultId = `${saved.side === 'SELL' ? 'S' : 'B'}${Math.round(saved.anchor)}`;
      brokenIds.add(defaultId);

      const breakBar = closedCandles[brokeAtIdx];
      events = appendLifecycleEvent(
        events,
        formatBreakEventSentence(saved.side, saved.anchor, excessDollar)
      );

      history = appendRetiredHistory(history, {
        id: `ret-${saved.side}-${saved.anchor.toFixed(2)}-${breakBar.time}`,
        side: saved.side,
        anchor: saved.anchor,
        type: saved.type,
        result: 'BROKEN',
        candleTime: breakBar.time,
        moveAfter: Number(Math.abs(breakBar.close - saved.anchor).toFixed(2)),
      });

      const fw = createFlipWatch(saved, breakBar.time, brokeAtIdx);
      const fwKey = `${fw.side}:${Math.round(fw.anchor)}`;
      if (!flipMap.has(fwKey)) {
        flipMap.set(fwKey, fw);
      }
    } else {
      validSavedZones.push({ ...saved, state: 'FRESH' });
    }
  }

  // Advance all flip watches across closed candles after their break time
  const updatedWatches: FlipWatch[] = [];
  for (const fw of flipMap.values()) {
    let currentFw = { ...fw };
    const startIdx =
      typeof currentFw.brokenBarIndex === 'number'
        ? currentFw.brokenBarIndex + 1
        : currentFw.brokenAtTime
        ? Math.max(
            0,
            closedCandles.findIndex((c) => c.time > currentFw.brokenAtTime!)
          )
        : 0;

    if (startIdx >= 0) {
      for (let i = startIdx; i < closedCandles.length; i++) {
        const c = closedCandles[i];
        if (!currentFw.confirmed) {
          const stepped = stepFlipWatchWithCandle(currentFw, c, effectiveAtr);
          currentFw = stepped.watch;
          if (stepped.newlyConfirmed) {
            events = appendLifecycleEvent(
              events,
              formatFlipConfirmedEventSentence(currentFw.anchor, currentFw.side)
            );
          }
        } else {
          // Once confirmed, check if a later closed candle broke the flipped zone itself
          const fLo = Number((currentFw.anchor - ZONE_HALF_WIDTH).toFixed(2));
          const fHi = Number((currentFw.anchor + ZONE_HALF_WIDTH).toFixed(2));
          const fBreak = isZoneBrokenByClosedCandle(
            currentFw.side,
            fLo,
            fHi,
            c,
            effectiveAtr
          );
          if (fBreak.broken) {
            brokenIds.add(currentFw.id);
            break;
          }
        }
      }
    }

    updatedWatches.push(currentFw);
  }

  return {
    validSavedZones,
    activeZoneIds: validSavedZones.map((z) => z.id),
    brokenIds,
    flipWatches: updatedWatches,
    events: events.slice(0, MAX_LEVEL_EVENTS),
    history,
  };
}

/**
 * Backwards-compatible wrappers for existing tests calling save/load/restoreFireZoneLifecycleState.
 */
export function saveFireZoneLifecycleState(
  activeZones: FireZone[],
  history: RetiredZoneHistoryItem[],
  flippedLevels: FlippedLevelCandidate[],
  storage: StorageLike = getDefaultStorage(),
  brokenIds: Iterable<string> = [],
  flipWatches: FlipWatch[] = [],
  events: string[] = []
): void {
  const watches: FlipWatch[] = [...flipWatches];
  for (const fl of flippedLevels) {
    if (!watches.some((w) => Math.abs(w.anchor - fl.anchor) < 0.5 && w.side === fl.toSide)) {
      watches.push({
        id: `F${Math.round(fl.anchor)}`,
        side: fl.toSide,
        anchor: fl.anchor,
        score: 8 + fl.bonusScore,
        armed: false,
        confirmed: false,
        brokenAtTime: fl.brokenCandleTime,
        brokenBarIndex: fl.brokenBarIndex,
      });
    }
  }
  saveFireZoneV2State(
    {
      activeZones,
      brokenIds,
      flipWatches: watches,
      events,
      history,
    },
    storage
  );
}

export function loadFireZoneLifecycleState(
  storage: StorageLike = getDefaultStorage()
): FireZonePersistedState | null {
  const v2 = loadFireZoneV2State(storage);
  if (!v2) return null;
  return {
    version: 1,
    activeZones: v2.activeZones,
    history: v2.history || [],
    flippedLevels: v2.flipWatches.map((w) => ({
      anchor: w.anchor,
      fromSide: w.side === 'BUY' ? 'SELL' : 'BUY',
      toSide: w.side,
      brokenCandleTime: w.brokenAtTime ?? 0,
      brokenBarIndex: w.brokenBarIndex ?? 0,
      bonusScore: 2,
    })),
  };
}

export function restoreAndRevalidateLifecycleState(
  closedCandles: Candle[],
  atr: number,
  storage: StorageLike = getDefaultStorage()
): {
  validSavedZones: FireZonePersistedState['activeZones'];
  history: RetiredZoneHistoryItem[];
  flippedLevels: FlippedLevelCandidate[];
  brokenIds: Set<string>;
  flipWatches: FlipWatch[];
  events: string[];
} {
  const res = restoreAndRevalidateV2State(closedCandles, atr, storage);
  return {
    validSavedZones: res.validSavedZones,
    history: res.history,
    flippedLevels: res.flipWatches.map((w) => ({
      anchor: w.anchor,
      fromSide: w.side === 'BUY' ? 'SELL' : 'BUY',
      toSide: w.side,
      brokenCandleTime: w.brokenAtTime ?? 0,
      brokenBarIndex: w.brokenBarIndex ?? 0,
      bonusScore: 2,
    })),
    brokenIds: res.brokenIds,
    flipWatches: res.flipWatches,
    events: res.events,
  };
}
