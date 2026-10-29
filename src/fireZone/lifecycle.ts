// src/fireZone/lifecycle.ts
import {
  Candle,
  FireZone,
  FireZonePersistedState,
  FlippedLevelCandidate,
  RetiredZoneHistoryItem,
  ZoneLifecycleState,
  ZoneSide,
  ZoneType,
} from './types';

export const FIRE_ZONE_STORAGE_KEY = 'fireZone.v1';
export const MAX_RETIRED_HISTORY = 10;
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

function getDefaultStorage(): StorageLike {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // ignore iframe storage errors
  }
  return memoryStorage;
}

export interface ZoneEvaluationOutcome {
  state: 'FRESH' | 'PLAYED_HELD' | 'BROKEN' | 'EXPIRED';
  eventBarIndex?: number;
  eventCandleTime?: number;
  moveAfter: number;
  flippedCandidate?: FlippedLevelCandidate;
}

/**
 * Evaluate the closed-candle lifecycle state of a single zone over CLOSED H1 candles.
 * Rules:
 * - EXPIRED: pivot/anchor is older than 150 H1 candles (closedCandles.length - 1 - anchorBarIndex > 150).
 * - BROKEN: a closed candle closes beyond the far edge (BUY: close < LO - $1, SELL: close > HI + $1).
 *   Wick-only beyond LO - $1 or HI + $1 does NOT break.
 * - PLAYED_HELD: a closed candle wicked into the zone (BUY: low <= HI, SELL: high >= LO)
 *   and then price closed at least 1*ATR(H1) away on the right side, OR 3 consecutive closes away.
 * - FRESH: otherwise.
 */
export function evaluateZoneClosedLifecycle(
  side: ZoneSide,
  anchor: number,
  anchorBarIndex: number,
  closedCandles: Candle[],
  atr: number
): ZoneEvaluationOutcome {
  const n = closedCandles.length;
  if (n === 0) {
    return { state: 'FRESH', moveAfter: 0 };
  }

  const lo = Number((anchor - ZONE_HALF_WIDTH).toFixed(2));
  const hi = Number((anchor + ZONE_HALF_WIDTH).toFixed(2));
  const effectiveAtr = Math.max(1.5, atr);

  let hasTouched = false;
  let consecutiveRightSideCloses = 0;
  let peakMove = 0;

  const startIdx = Math.max(0, anchorBarIndex + 1);
  for (let i = startIdx; i < n; i++) {
    const c = closedCandles[i];

    // 1. Check BROKEN on candle CLOSE beyond far edge ($1 buffer)
    if (side === 'BUY') {
      if (c.close < lo - 1.0) {
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
      if (c.close > hi + 1.0) {
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

  return { state: 'FRESH', moveAfter: 0 };
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
 * Format the latest retired zone event as a clear sentence for the LEVEL EVENTS card on DESK.
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

/**
 * Append a retired zone event to the history list (deduplicated by id, capped at last 10).
 */
export function appendRetiredHistory(
  history: RetiredZoneHistoryItem[],
  newItem: RetiredZoneHistoryItem
): RetiredZoneHistoryItem[] {
  const filtered = history.filter((h) => h.id !== newItem.id);
  return [newItem, ...filtered].slice(0, MAX_RETIRED_HISTORY);
}

/**
 * Save active zones (always saved as 'FRESH', never 'TESTING'), retired history,
 * and flipped levels to localStorage under key 'fireZone.v1'.
 */
export function saveFireZoneLifecycleState(
  activeZones: FireZone[],
  history: RetiredZoneHistoryItem[],
  flippedLevels: FlippedLevelCandidate[],
  storage: StorageLike = getDefaultStorage()
): void {
  const payload: FireZonePersistedState = {
    version: 1,
    activeZones: activeZones.map((z) => ({
      id: z.id,
      side: z.side,
      anchor: Number(z.anchor.toFixed(2)),
      type: (z.type || 'NEAREST') as ZoneType,
      state: 'FRESH', // TESTING is live-only, never saved
      createdBarTime: z.pivotTime,
      score: z.score,
    })),
    history: history.slice(0, MAX_RETIRED_HISTORY),
    flippedLevels: flippedLevels.slice(-20),
  };

  try {
    storage.setItem(FIRE_ZONE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage quota errors
  }
}

/**
 * Load persisted FireZone state from localStorage (key 'fireZone.v1').
 */
export function loadFireZoneLifecycleState(
  storage: StorageLike = getDefaultStorage()
): FireZonePersistedState | null {
  try {
    const raw = storage.getItem(FIRE_ZONE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FireZonePersistedState>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.activeZones)) {
      return null;
    }
    return {
      version: 1,
      activeZones: parsed.activeZones,
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, MAX_RETIRED_HISTORY) : [],
      flippedLevels: Array.isArray(parsed.flippedLevels) ? parsed.flippedLevels : [],
    };
  } catch {
    return null;
  }
}

/**
 * Restore persisted state and re-validate all saved active zones against the loaded closed H1 candles.
 * Any saved zone that has since PLAYED_HELD, BROKEN, or EXPIRED in the loaded candles is retired,
 * recorded into history (and flipped if BROKEN), and dropped from active zones so the engine
 * selects the next best replacement level.
 */
export function restoreAndRevalidateLifecycleState(
  closedCandles: Candle[],
  atr: number,
  storage: StorageLike = getDefaultStorage()
): {
  validSavedZones: FireZonePersistedState['activeZones'];
  history: RetiredZoneHistoryItem[];
  flippedLevels: FlippedLevelCandidate[];
} {
  const loaded = loadFireZoneLifecycleState(storage);
  if (!loaded) {
    return { validSavedZones: [], history: [], flippedLevels: [] };
  }

  let history = [...loaded.history];
  const flippedLevels = [...loaded.flippedLevels];
  const validSavedZones: FireZonePersistedState['activeZones'] = [];

  if (closedCandles.length === 0) {
    return { validSavedZones: loaded.activeZones, history, flippedLevels };
  }

  for (const saved of loaded.activeZones) {
    // Find bar index corresponding to createdBarTime
    let barIdx = closedCandles.findIndex((c) => c.time >= saved.createdBarTime);
    if (barIdx < 0) barIdx = Math.max(0, closedCandles.length - 20);

    const outcome = evaluateZoneClosedLifecycle(
      saved.side,
      saved.anchor,
      barIdx,
      closedCandles,
      atr
    );

    if (outcome.state === 'FRESH') {
      validSavedZones.push({ ...saved, state: 'FRESH' });
    } else {
      const resultKind =
        outcome.state === 'PLAYED_HELD'
          ? 'HELD'
          : outcome.state === 'BROKEN'
          ? 'BROKEN'
          : 'EXPIRED';

      history = appendRetiredHistory(history, {
        id: `ret-${saved.side}-${saved.anchor.toFixed(2)}-${outcome.eventCandleTime ?? 0}`,
        side: saved.side,
        anchor: saved.anchor,
        type: saved.type,
        result: resultKind,
        candleTime: outcome.eventCandleTime ?? closedCandles[closedCandles.length - 1].time,
        moveAfter: outcome.moveAfter,
      });

      if (
        outcome.flippedCandidate &&
        !flippedLevels.some(
          (f) =>
            Math.abs(f.anchor - outcome.flippedCandidate!.anchor) < 0.5 &&
            f.toSide === outcome.flippedCandidate!.toSide
        )
      ) {
        flippedLevels.push(outcome.flippedCandidate);
      }
    }
  }

  return { validSavedZones, history, flippedLevels };
}
