// src/fireZone/levels.ts
import {
  Candle,
  FireZone,
  FlipWatch,
  FlippedLevelCandidate,
  LevelImportance,
  LevelKind,
  LevelSourceKind,
  LevelWall,
  Pivot,
  PivotLevel,
  RetiredZoneHistoryItem,
  TradePlan,
  ZoneSide,
  ZoneStrengthLabel,
  ZoneType,
} from './types';
import { computeAtr, findPivots } from './engineCore';
import {
  appendRetiredHistory,
  evaluateZoneClosedLifecycle,
  getLiveZoneDisplayState,
} from './lifecycle';


export const ZONE_HALF = 2.0; // Zone = anchor +/- $2 -> exact $4.00 width
export const ZONE_WIDTH = 4.0;
export const CLUSTER_RADIUS = 3.0; // Cluster candidates within $3 of each other

export const PIVOT_ORIGIN_WEIGHTS: Record<5 | 20 | 50, number> = {
  5: 1,
  20: 3,
  50: 5,
};

export interface ZoneOriginCandidate {
  side: ZoneSide;
  anchor: number;
  HI: number;
  LO: number;
  pivotIndex: number;
  pivotTime: number;
  pivotLevel: PivotLevel;
  originWeight: number;
  departureAtr: number;
  departurePoints: number;
  retests: number;
  freshnessPoints: number;
  score: number;
}

export interface ClusteredZoneCandidate extends ZoneOriginCandidate {
  id: string;
  memberCount: number;
  prev24Bonus: number;
  roundBonus: number;
  label: ZoneStrengthLabel;
}

export interface LevelCandidate {
  price: number;
  source: LevelSourceKind;
  label: string;
  time?: number;
  h1BarIndex?: number;
}

const SOURCE_WEIGHTS: Record<LevelSourceKind, number> = {
  H1: 1,
  H4: 3,
  D1: 5,
  PDH: 4,
  PDL: 4,
  PWH: 6,
  PWL: 6,
  EQH: 3,
  EQL: 3,
  ROUND_100: 4,
  ROUND_50: 2,
  FLIP: 2,
};

/**
 * Compute departure points from max distance price moved away from the pivot
 * within the next 12 candles, divided by ATR:
 * >= 3 ATR -> +4, >= 2 -> +3, >= 1.5 -> +2, else 0.
 */
export function computeDeparturePoints(departureAtr: number): number {
  if (departureAtr >= 3.0) return 4;
  if (departureAtr >= 2.0) return 3;
  if (departureAtr >= 1.5) return 2;
  return 0;
}

/**
 * Compute freshness points from number of retest excursions:
 * 0 retests -> +4 (fresh), 1 -> +2, 2 -> 0, 3 or more -> null (discard).
 */
export function computeFreshnessPoints(retests: number): number | null {
  if (retests <= 0) return 4;
  if (retests === 1) return 2;
  if (retests === 2) return 0;
  return null;
}

/**
 * Evaluate a single pivot candidate against subsequent closed H1 candles:
 * - anchor = pivot price, HI = anchor + 2, LO = anchor - 2 (always $4 wide)
 * - departure = max distance price moved away within next 12 candles / ATR
 * - DEAD: if any later candle CLOSES beyond the far edge by > 0.25*ATR
 *   (SELL: close > HI + 0.25*ATR, BUY: close < LO - 0.25*ATR) -> discard (return null).
 *   Wicks beyond the far edge do NOT discard.
 * - retests (freshness) = number of separate excursions after the pivot where a candle
 *   wicked into [LO, HI] without closing beyond the far edge.
 *   0 -> +4, 1 -> +2, 2 -> 0, >= 3 -> discard (return null).
 * - score = originWeight + departurePoints + freshnessPoints.
 */
export function evaluateOriginCandidate(
  pivot: Pick<Pivot, 'index' | 'time' | 'type' | 'price' | 'level'>,
  closedH1Candles: Candle[],
  atr: number,
  explicitOriginWeight?: number
): ZoneOriginCandidate | null {
  const effectiveAtr = Math.max(0.5, atr);
  const side: ZoneSide = pivot.type === 'HIGH' ? 'SELL' : 'BUY';
  const anchor = Number(pivot.price.toFixed(2));
  const HI = Number((anchor + ZONE_HALF).toFixed(2));
  const LO = Number((anchor - ZONE_HALF).toFixed(2));

  const originWeight =
    explicitOriginWeight ??
    (pivot.level === 50 ? 5 : pivot.level === 20 ? 3 : 1);

  const n = closedH1Candles.length;

  // 1. Departure within next 12 candles
  let maxMove = 0;
  const maxDepIdx = Math.min(n - 1, pivot.index + 12);
  for (let k = pivot.index + 1; k <= maxDepIdx; k++) {
    const c = closedH1Candles[k];
    const dist = side === 'SELL' ? anchor - c.low : c.high - anchor;
    if (dist > maxMove) maxMove = dist;
  }
  const departureAtr = maxMove / effectiveAtr;
  const departurePoints = computeDeparturePoints(departureAtr);

  // 2. DEAD check and Retests (freshness) across all candles after the pivot
  let hasLeftZone = false;
  let inExcursion = false;
  let retests = 0;

  for (let k = pivot.index + 1; k < n; k++) {
    const c = closedH1Candles[k];

    // DEAD: close beyond far edge by more than 0.25 * ATR
    if (side === 'SELL') {
      if (c.close > HI + 0.25 * effectiveAtr) {
        return null;
      }
    } else {
      if (c.close < LO - 0.25 * effectiveAtr) {
        return null;
      }
    }

    // Check if candle is completely outside [LO, HI] on the trade side
    const outsideOnTradeSide = side === 'SELL' ? c.high < LO : c.low > HI;
    if (outsideOnTradeSide) {
      hasLeftZone = true;
      inExcursion = false;
      continue;
    }

    // Candle wicked into [LO, HI]
    const wickedIntoZone = side === 'SELL' ? c.high >= LO : c.low <= HI;
    const closedBeyondFarEdge = side === 'SELL' ? c.close > HI : c.close < LO;

    if (hasLeftZone && wickedIntoZone && !closedBeyondFarEdge) {
      if (!inExcursion) {
        retests++;
        if (retests >= 3) {
          return null; // 3 or more retests -> discard candidate
        }
        inExcursion = true;
      }
    }
  }

  const freshnessPoints = computeFreshnessPoints(retests);
  if (freshnessPoints === null) return null;

  const score = originWeight + departurePoints + freshnessPoints;

  return {
    side,
    anchor,
    HI,
    LO,
    pivotIndex: pivot.index,
    pivotTime: pivot.time,
    pivotLevel: pivot.level,
    originWeight,
    departureAtr: Number(departureAtr.toFixed(2)),
    departurePoints,
    retests,
    freshnessPoints,
    score,
  };
}

/**
 * 1) Extract all valid zone origin candidates from the last 150 closed H1 candles
 * using pivot lengths L=5 (weight 1), L=20 (weight 3), L=50 (weight 5).
 */
export function extractZoneOriginCandidates(
  closedH1Candles: Candle[],
  atr?: number
): ZoneOriginCandidate[] {
  if (!closedH1Candles || closedH1Candles.length === 0) return [];
  const effectiveAtr = atr && atr > 0 ? atr : computeAtr(closedH1Candles, 14);
  const minIndex = Math.max(0, closedH1Candles.length - 150);

  const pivotsL5 = findPivots(closedH1Candles, 5);
  const pivotsL20 = findPivots(closedH1Candles, 20);
  const pivotsL50 = findPivots(closedH1Candles, 50);

  // Deduplicate exact same (type, index) by keeping the largest pivot length L (highest weight)
  const pivotByKey = new Map<string, Pivot>();
  for (const p of [...pivotsL5, ...pivotsL20, ...pivotsL50]) {
    if (p.index < minIndex) continue;
    const key = `${p.type}:${p.index}`;
    const existing = pivotByKey.get(key);
    if (!existing || p.level > existing.level) {
      pivotByKey.set(key, p);
    }
  }

  const candidates: ZoneOriginCandidate[] = [];
  for (const p of pivotByKey.values()) {
    const weight = PIVOT_ORIGIN_WEIGHTS[p.level as 5 | 20 | 50] ?? 1;
    const evaluated = evaluateOriginCandidate(p, closedH1Candles, effectiveAtr, weight);
    if (evaluated) {
      candidates.push(evaluated);
    }
  }

  return candidates;
}

/**
 * Labels: score >= 11 CRITICAL, >= 8 STRONG, else MODERATE.
 */
export function getZoneStrengthLabel(score: number): ZoneStrengthLabel {
  if (score >= 11) return 'CRITICAL';
  if (score >= 8) return 'STRONG';
  return 'MODERATE';
}

/**
 * 2) CLUSTER AND BONUS:
 * - Merge same-side candidates within $3 of each other:
 *   keep the member with the highest score as the anchor,
 *   score = best score + (number of members - 1).
 * - Add bonuses:
 *   +2 if within $3 of the previous-24-candle high/low,
 *   +2 if within $3 of a $100 round number (else +1 for a $50 round number).
 * - Give each level an id like "S4103" / "B4015".
 * - Labels: score >= 11 CRITICAL, >= 8 STRONG, else MODERATE.
 */
export function clusterAndBonusZoneCandidates(
  candidates: ZoneOriginCandidate[],
  closedH1Candles: Candle[] = []
): ClusteredZoneCandidate[] {
  if (candidates.length === 0) return [];

  const last24 = closedH1Candles.slice(-24);
  const prev24High =
    last24.length > 0 ? Math.max(...last24.map((c) => c.high)) : Number.NaN;
  const prev24Low =
    last24.length > 0 ? Math.min(...last24.map((c) => c.low)) : Number.NaN;

  const result: ClusteredZoneCandidate[] = [];
  const usedIds = new Set<string>();

  for (const side of ['SELL', 'BUY'] as ZoneSide[]) {
    const sideCands = candidates
      .filter((c) => c.side === side)
      .sort((a, b) => a.anchor - b.anchor);

    const clusters: ZoneOriginCandidate[][] = [];
    for (const cand of sideCands) {
      if (clusters.length === 0) {
        clusters.push([cand]);
        continue;
      }
      const currentCluster = clusters[clusters.length - 1];
      const bestSoFar = currentCluster.reduce((best, item) =>
        item.score > best.score ||
        (item.score === best.score && item.originWeight > best.originWeight)
          ? item
          : best
      );
      const lastItem = currentCluster[currentCluster.length - 1];

      if (
        Math.abs(cand.anchor - bestSoFar.anchor) <= CLUSTER_RADIUS ||
        Math.abs(cand.anchor - lastItem.anchor) <= CLUSTER_RADIUS
      ) {
        currentCluster.push(cand);
      } else {
        clusters.push([cand]);
      }
    }

    for (const members of clusters) {
      // Keep the member with the highest score as the anchor
      const bestMember = members.reduce((best, item) => {
        if (item.score !== best.score) return item.score > best.score ? item : best;
        if (item.originWeight !== best.originWeight) {
          return item.originWeight > best.originWeight ? item : best;
        }
        if (item.retests !== best.retests) {
          return item.retests < best.retests ? item : best;
        }
        return item.pivotIndex >= best.pivotIndex ? item : best;
      });

      const anchor = Number(bestMember.anchor.toFixed(2));
      const HI = Number((anchor + ZONE_HALF).toFixed(2));
      const LO = Number((anchor - ZONE_HALF).toFixed(2));
      const memberCount = members.length;

      const clusterScore = bestMember.score + (memberCount - 1);

      let prev24Bonus = 0;
      if (
        (Number.isFinite(prev24High) && Math.abs(anchor - prev24High) <= 3.0) ||
        (Number.isFinite(prev24Low) && Math.abs(anchor - prev24Low) <= 3.0)
      ) {
        prev24Bonus = 2;
      }

      let roundBonus = 0;
      const nearest100 = Math.round(anchor / 100) * 100;
      const nearest50 = Math.round(anchor / 50) * 50;
      if (Math.abs(anchor - nearest100) <= 3.0) {
        roundBonus = 2;
      } else if (Math.abs(anchor - nearest50) <= 3.0) {
        roundBonus = 1;
      }

      const finalScore = clusterScore + prev24Bonus + roundBonus;
      const label = getZoneStrengthLabel(finalScore);

      const baseId = `${side === 'SELL' ? 'S' : 'B'}${Math.round(anchor)}`;
      let id = baseId;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${baseId}-${suffix++}`;
      }
      usedIds.add(id);

      result.push({
        ...bestMember,
        anchor,
        HI,
        LO,
        id,
        memberCount,
        prev24Bonus,
        roundBonus,
        score: finalScore,
        label,
      });
    }
  }

  return result;
}

/**
 * Legacy helper preserved for backwards-compatible unit tests.
 */
export function clusterCandidatesWithin3(
  candidates: LevelCandidate[]
): Array<{
  price: number;
  sources: LevelSourceKind[];
  labels: string[];
  latestTime: number;
  h1BarIndex?: number;
}> {
  if (candidates.length === 0) return [];

  const sorted = [...candidates].sort((a, b) => a.price - b.price);
  const clusters: Array<{
    items: LevelCandidate[];
    sum: number;
  }> = [];

  for (const cand of sorted) {
    if (clusters.length === 0) {
      clusters.push({ items: [cand], sum: cand.price });
      continue;
    }
    const current = clusters[clusters.length - 1];
    const currentAvg = current.sum / current.items.length;
    if (Math.abs(cand.price - currentAvg) <= CLUSTER_RADIUS) {
      current.items.push(cand);
      current.sum += cand.price;
    } else {
      clusters.push({ items: [cand], sum: cand.price });
    }
  }

  return clusters.map((cl) => {
    const avgPrice = Number((cl.sum / cl.items.length).toFixed(2));
    const sources = cl.items.map((i) => i.source);
    const labels = Array.from(new Set(cl.items.map((i) => i.label)));
    const latestTime = cl.items.reduce((maxT, i) => Math.max(maxT, i.time ?? 0), 0);
    const barIndices = cl.items
      .map((i) => i.h1BarIndex)
      .filter((idx): idx is number => typeof idx === 'number');
    const h1BarIndex = barIndices.length > 0 ? Math.max(...barIndices) : undefined;
    return {
      price: avgPrice,
      sources,
      labels,
      latestTime,
      h1BarIndex,
    };
  });
}

export function scoreClusteredLevel(sources: LevelSourceKind[], touches: number): number {
  let score = touches;
  const seenSingleton = new Set<LevelSourceKind>();
  for (const src of sources) {
    if (
      src === 'PDH' ||
      src === 'PDL' ||
      src === 'PWH' ||
      src === 'PWL' ||
      src === 'ROUND_100' ||
      src === 'ROUND_50' ||
      src === 'EQH' ||
      src === 'EQL' ||
      src === 'FLIP'
    ) {
      if (seenSingleton.has(src)) continue;
      seenSingleton.add(src);
    }
    score += SOURCE_WEIGHTS[src] || 0;
  }
  return score;
}

export function getStyleBucketByRank(rank: number): LevelImportance {
  if (rank <= 2) return 'KEY';
  if (rank <= 5) return 'MAJOR';
  return 'MINOR';
}

/**
 * Build ranked levels from closed H1 candles using the new H1 pivot origin (L=5, 20, 50),
 * departure + freshness scoring, DEAD filtering, same-side $3 clustering, and bonuses.
 */
export function buildRankedLevels(
  h1Candles: Candle[],
  _h4Candles: Candle[] = [],
  _d1Candles: Candle[] = [],
  refPrice = 0,
  _extraFlippedCandidates: FlippedLevelCandidate[] = [],
  atrOverride?: number,
  confirmedFlips: FlipWatch[] = [],
  brokenIds?: ReadonlySet<string>
): LevelWall[] {
  if (!h1Candles || h1Candles.length === 0) return [];

  const atr = atrOverride && atrOverride > 0 ? atrOverride : computeAtr(h1Candles, 14);
  const rawCandidates = extractZoneOriginCandidates(h1Candles, atr);
  const clustered = clusterAndBonusZoneCandidates(rawCandidates, h1Candles);

  const scored: LevelWall[] = clustered
    .filter((cl) => !brokenIds?.has(cl.id))
    .map((cl) => {
      const distance = refPrice > 0 ? Number(Math.abs(cl.anchor - refPrice).toFixed(2)) : 0;
      const sources: LevelSourceKind[] = [
        cl.pivotLevel === 50 ? 'D1' : cl.pivotLevel === 20 ? 'H4' : 'H1',
      ];
      if (cl.prev24Bonus > 0) {
        sources.push(cl.side === 'SELL' ? 'PDH' : 'PDL');
      }
      if (cl.roundBonus === 2) {
        sources.push('ROUND_100');
      } else if (cl.roundBonus === 1) {
        sources.push('ROUND_50');
      }

      const kind: LevelKind =
        cl.prev24Bonus > 0
          ? cl.side === 'SELL'
            ? 'PDH'
            : 'PDL'
          : cl.roundBonus > 0
          ? 'ROUND_NUMBER'
          : 'PIVOT';

      return {
        id: cl.id,
        price: cl.anchor,
        kind,
        label: `L${cl.pivotLevel}`,
        sources,
        touches: cl.retests,
        score: cl.score,
        rank: 0,
        importance: 'MINOR',
        distance,
        anchorBarIndex: cl.pivotIndex,
        anchorTime: cl.pivotTime,
        allowedSide: cl.side,
      };
    });

  // Include CONFIRMED flips as normal candidates with id: "F<price>" and their old score
  for (const fw of confirmedFlips) {
    if (!fw.confirmed) continue;
    const flipId = fw.id || `F${Math.round(fw.anchor)}`;
    if (brokenIds?.has(flipId)) continue;
    if (scored.some((s) => s.id === flipId)) continue;

    const anchor = Number(fw.anchor.toFixed(2));
    const distance = refPrice > 0 ? Number(Math.abs(anchor - refPrice).toFixed(2)) : 0;
    scored.push({
      id: flipId,
      price: anchor,
      kind: 'FLIP',
      label: 'FLIP',
      sources: ['H1', 'FLIP'],
      touches: 1,
      score: fw.score,
      rank: 0,
      importance: 'MINOR',
      distance,
      anchorBarIndex: fw.brokenBarIndex,
      anchorTime: fw.brokenAtTime,
      allowedSide: fw.side,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.distance !== b.distance) return a.distance - b.distance;
    return b.price - a.price;
  });

  scored.forEach((lvl, idx) => {
    const rank = idx + 1;
    lvl.rank = rank;
    lvl.importance = getStyleBucketByRank(rank);
  });

  return scored;
}

/**
 * 3) SELECTION (exactly up to 4 zones: 2 SELL + 2 BUY)
 * - Valid at the live price:
 *   a SELL zone is valid while price <= HI (price below or inside it);
 *   a BUY zone is valid while price >= LO.
 * - Per side:
 *   - NEAR = the closest valid zone with score >= 6 within 8*ATR of price;
 *     if none, the closest valid zone.
 *   - DEEP = among valid zones farther than NEAR by at least $12 and within 25*ATR,
 *     the highest score (tie -> farther). Skip if none.
 *   - If a side has no valid zone at all, use the 150-candle extreme
 *     (lowest low + 2 for BUY, highest high - 2 for SELL) with score 3.
 * - Never show a SELL zone that sits below price or a BUY zone above price.
 */
export function selectZonesFromLevels(
  allRankedLevels: LevelWall[],
  refPrice: number,
  atr: number,
  latestTime: number,
  latestIndex: number,
  zoneStore?: Map<string, FireZone>,
  closedH1Candles: Candle[] = [],
  existingHistory: RetiredZoneHistoryItem[] = [],
  livePrice?: number,
  brokenIds?: ReadonlySet<string>,
  confirmedFlips: FlipWatch[] = []
): {
  buyZones: FireZone[];
  sellZones: FireZone[];
  retiredHistory: RetiredZoneHistoryItem[];
  flippedCandidates: FlippedLevelCandidate[];
} {
  const effectiveAtr = Math.max(1.5, atr);
  const maxNearDist = 8 * effectiveAtr;
  const maxDeepDist = 25 * effectiveAtr;

  let history = [...existingHistory];
  const flippedCandidates: FlippedLevelCandidate[] = [];
  const activePool: LevelWall[] = [];

  // Only run legacy closed-candle lifecycle evaluation when legacy 'lvl-*' test levels are passed directly
  const isLegacyLevelPool =
    closedH1Candles.length > 0 &&
    allRankedLevels.some((l) => l.id.startsWith('lvl-'));

  if (isLegacyLevelPool) {
    for (const lvl of allRankedLevels) {
      const naturalSide: ZoneSide =
        lvl.allowedSide ?? (lvl.price < refPrice ? 'BUY' : 'SELL');
      const anchorBar =
        typeof lvl.anchorBarIndex === 'number'
          ? lvl.anchorBarIndex
          : Math.max(0, closedH1Candles.length - 45);

      const outcome = evaluateZoneClosedLifecycle(
        naturalSide,
        lvl.price,
        anchorBar,
        closedH1Candles,
        effectiveAtr
      );

      if (outcome.state === 'FRESH') {
        activePool.push({ ...lvl, allowedSide: naturalSide });
      } else {
        const resultKind =
          outcome.state === 'PLAYED_HELD'
            ? 'HELD'
            : outcome.state === 'BROKEN'
            ? 'BROKEN'
            : 'EXPIRED';

        history = appendRetiredHistory(history, {
          id: `ret-${naturalSide}-${lvl.price.toFixed(2)}-${outcome.eventCandleTime ?? latestTime}`,
          side: naturalSide,
          anchor: lvl.price,
          type: lvl.sources.includes('D1') || lvl.sources.includes('H4') ? 'SWING' : 'NEAREST',
          result: resultKind,
          candleTime: outcome.eventCandleTime ?? latestTime,
          moveAfter: outcome.moveAfter,
        });

        if (outcome.state === 'BROKEN' && outcome.flippedCandidate) {
          flippedCandidates.push(outcome.flippedCandidate);
          const flippedSide = outcome.flippedCandidate.toSide;
          const postBreakOutcome = evaluateZoneClosedLifecycle(
            flippedSide,
            lvl.price,
            outcome.flippedCandidate.brokenBarIndex,
            closedH1Candles,
            effectiveAtr
          );
          if (postBreakOutcome.state === 'FRESH') {
            activePool.push({
              ...lvl,
              id: `${lvl.id}-flip-${flippedSide}`,
              sources: [...lvl.sources, 'FLIP'],
              score: lvl.score + 2,
              anchorBarIndex: outcome.flippedCandidate.brokenBarIndex,
              anchorTime: outcome.flippedCandidate.brokenCandleTime,
              allowedSide: flippedSide,
            });
          }
        }
      }
    }
  } else {
    activePool.push(...allRankedLevels);
  }

  // Add any CONFIRMED FlipWatch candidates (unconfirmed flips are NEVER shown)
  for (const fw of confirmedFlips) {
    if (!fw.confirmed) continue;
    const flipId = fw.id || `F${Math.round(fw.anchor)}`;
    if (brokenIds?.has(flipId)) continue;
    if (activePool.some((lvl) => lvl.id === flipId)) continue;
    const anchor = Number(fw.anchor.toFixed(2));
    activePool.push({
      id: flipId,
      price: anchor,
      kind: 'FLIP',
      label: 'FLIP',
      sources: ['H1', 'FLIP'],
      touches: 1,
      score: fw.score,
      rank: activePool.length + 1,
      importance: 'MAJOR',
      distance: Number(Math.abs(anchor - refPrice).toFixed(2)),
      anchorBarIndex: fw.brokenBarIndex ?? latestIndex,
      anchorTime: fw.brokenAtTime ?? latestTime,
      allowedSide: fw.side,
    });
  }

  const price = typeof livePrice === 'number' && livePrice > 0 ? livePrice : refPrice;

  const resolveZoneId = (lvl: LevelWall, side: ZoneSide): string => {
    const defaultId = `${side === 'SELL' ? 'S' : 'B'}${Math.round(lvl.price)}`;
    return lvl.id.startsWith('S') || lvl.id.startsWith('B') || lvl.id.startsWith('F')
      ? lvl.id
      : defaultId;
  };

  const toFireZone = (lvl: LevelWall, side: ZoneSide, zType: ZoneType): FireZone => {
    const zoneId = resolveZoneId(lvl, side);
    const existing = zoneStore?.get(zoneId);
    const anchor = existing ? existing.anchor : Number(lvl.price.toFixed(2));
    const top = existing ? existing.top : Number((anchor + ZONE_HALF).toFixed(2));
    const bottom = existing ? existing.bottom : Number((anchor - ZONE_HALF).toFixed(2));

    let distance = 0;
    if (price > top) distance = Number((price - top).toFixed(2));
    else if (price < bottom) distance = Number((bottom - price).toFixed(2));

    const label = getZoneStrengthLabel(lvl.score);
    const pivotLevel: PivotLevel = lvl.sources.includes('D1')
      ? 50
      : lvl.sources.includes('H4')
      ? 20
      : 5;
    const lifecycleState = getLiveZoneDisplayState({ bottom, top }, price);

    const zone: FireZone = {
      id: zoneId,
      side,
      top,
      bottom,
      anchor,
      levelId: lvl.id,
      sources: lvl.sources,
      pivotIndex: lvl.anchorBarIndex ?? latestIndex,
      pivotTime: lvl.anchorTime ?? latestTime,
      pivotPrice: anchor,
      pivotLevel,
      isLive: true,
      isDead: false,
      lifecycleState,
      isFlipped: lvl.sources.includes('FLIP') || zoneId.startsWith('F'),
      touches: lvl.touches,
      score: lvl.score,
      label,
      type: zType,
      distance,
    };

    if (zoneStore) {
      zoneStore.set(zoneId, zone);
    }
    return zone;
  };

  const buildSideZones = (side: ZoneSide): FireZone[] => {
    const isBuy = side === 'BUY';

    // Valid at live price:
    // - Exclude any zone in brokenIds
    // - SELL zone is valid while price <= HI (HI = anchor + 2)
    // - BUY zone is valid while price >= LO (LO = anchor - 2)
    // Never show a SELL zone that sits below price (HI < price) or a BUY zone above price (LO > price).
    const validLevels = activePool.filter((lvl) => {
      const lvlSide = lvl.allowedSide ?? (lvl.price <= price ? 'BUY' : 'SELL');
      if (lvlSide !== side) return false;
      const zId = resolveZoneId(lvl, side);
      if (brokenIds && (brokenIds.has(lvl.id) || brokenIds.has(zId))) {
        return false;
      }
      const hi = Number((lvl.price + ZONE_HALF).toFixed(2));
      const lo = Number((lvl.price - ZONE_HALF).toFixed(2));
      return isBuy
        ? lvl.price < price && price >= lo
        : lvl.price > price && price <= hi;
    });


    // If a side has no valid zone at all, use the 150-candle extreme
    // (lowest low + 2 for BUY, highest high - 2 for SELL) with score 3.
    if (validLevels.length === 0) {
      const sample150 = closedH1Candles.slice(-150);
      let extremeAnchor: number;
      if (isBuy) {
        const rawLowest =
          sample150.length > 0
            ? Math.min(...sample150.map((c) => c.low))
            : price - 12;
        const clampedLow = Math.min(rawLowest, price - 4.0);
        extremeAnchor = Number((clampedLow + 2.0).toFixed(2));
      } else {
        const rawHighest =
          sample150.length > 0
            ? Math.max(...sample150.map((c) => c.high))
            : price + 12;
        const clampedHigh = Math.max(rawHighest, price + 4.0);
        extremeAnchor = Number((clampedHigh - 2.0).toFixed(2));
      }

      const fallbackId = `${isBuy ? 'B' : 'S'}${Math.round(extremeAnchor)}`;
      const fallbackLevel: LevelWall = {
        id: fallbackId,
        price: extremeAnchor,
        kind: 'PIVOT',
        label: 'EXT150',
        sources: ['H1'],
        touches: 0,
        score: 3,
        rank: 99,
        importance: 'MINOR',
        distance: Number(Math.abs(extremeAnchor - price).toFixed(2)),
        anchorBarIndex: Math.max(0, latestIndex - 20),
        anchorTime: latestTime,
        allowedSide: side,
      };
      return [toFireZone(fallbackLevel, side, 'NEAREST')];
    }

    const distFromPrice = (lvl: LevelWall) => Math.abs(lvl.price - price);

    const sortByClosestThenScore = (a: LevelWall, b: LevelWall) => {
      const dDiff = distFromPrice(a) - distFromPrice(b);
      if (Math.abs(dDiff) > 1e-6) return dDiff;
      return b.score - a.score;
    };

    // NEAR = the closest valid zone with score >= 6 within 8*ATR of price; if none, the closest valid zone.
    const nearQualified = validLevels
      .filter((lvl) => lvl.score >= 6 && distFromPrice(lvl) <= maxNearDist)
      .sort(sortByClosestThenScore);

    const nearLvl =
      nearQualified.length > 0
        ? nearQualified[0]
        : [...validLevels].sort(sortByClosestThenScore)[0];

    const chosen: FireZone[] = [toFireZone(nearLvl, side, 'NEAREST')];

    // DEEP = among valid zones farther than NEAR by at least $12 and within 25*ATR,
    // the highest score (tie -> farther). Skip if none.
    const deepCandidates = validLevels
      .filter((lvl) => {
        if (lvl.id === nearLvl.id) return false;
        const fartherDelta = isBuy
          ? nearLvl.price - lvl.price
          : lvl.price - nearLvl.price;
        if (fartherDelta < 12.0 - 1e-6) return false;
        return distFromPrice(lvl) <= maxDeepDist;
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return distFromPrice(b) - distFromPrice(a); // tie -> farther
      });

    if (deepCandidates.length > 0) {
      chosen.push(toFireZone(deepCandidates[0], side, 'DEEP'));
    }

    return chosen;
  };

  const buyZones = buildSideZones('BUY');
  const sellZones = buildSideZones('SELL');

  const buyNearest = buyZones.find((z) => z.type === 'NEAREST');
  const sellNearest = sellZones.find((z) => z.type === 'NEAREST');
  if (buyNearest && sellNearest) {
    if (buyNearest.score >= sellNearest.score) buyNearest.isStar = true;
    else sellNearest.isStar = true;
  } else if (buyNearest) {
    buyNearest.isStar = true;
  } else if (sellNearest) {
    sellNearest.isStar = true;
  }

  history = history.map((h) => {
    if (h.nextZoneAnchor !== undefined) return h;
    const replacement =
      h.side === 'BUY' ? buyNearest?.anchor : sellNearest?.anchor;
    return replacement !== undefined ? { ...h, nextZoneAnchor: replacement } : h;
  });

  return {
    buyZones,
    sellZones,
    retiredHistory: history.slice(0, 10),
    flippedCandidates,
  };
}

/**
 * Filter ranked levels to keep those within +/-12*ATR(H1) of price plus the active zones' own anchors,
 * excluding retired anchors unless they are active flipped zones.
 */
export function filterAndRankKeptLevels(
  allRankedLevels: LevelWall[],
  zones: FireZone[],
  refPrice: number,
  atr: number,
  retiredHistory: RetiredZoneHistoryItem[] = []
): LevelWall[] {
  const maxDist = 12 * Math.max(1.5, atr);
  const anchorSet = new Set<number>(zones.map((z) => Number(z.anchor.toFixed(2))));
  const retiredSet = new Set<number>(
    retiredHistory.map((r) => Number(r.anchor.toFixed(2)))
  );

  const kept = allRankedLevels.filter((lvl) => {
    const p = Number(lvl.price.toFixed(2));
    if (anchorSet.has(p)) return true;
    if (retiredSet.has(p)) return false;
    return refPrice <= 0 || Math.abs(lvl.price - refPrice) <= maxDist;
  });

  // Ensure fallback zones (e.g. 150-candle extreme) are included in kept levels
  for (const z of zones) {
    const p = Number(z.anchor.toFixed(2));
    if (!kept.some((lvl) => Math.abs(lvl.price - p) < 0.01)) {
      kept.push({
        id: z.id,
        price: p,
        kind: 'PIVOT',
        label: `L${z.pivotLevel}`,
        sources: z.sources || ['H1'],
        touches: z.touches,
        score: z.score,
        rank: 0,
        importance: 'MINOR',
        distance: z.distance,
        anchorBarIndex: z.pivotIndex,
        anchorTime: z.pivotTime,
        allowedSide: z.side,
      });
    }
  }

  kept.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.distance !== b.distance) return a.distance - b.distance;
    return b.price - a.price;
  });

  return kept.map((lvl, idx) => {
    const rank = idx + 1;
    return {
      ...lvl,
      rank,
      importance: getStyleBucketByRank(rank),
    };
  });
}

/**
 * 4) TRADE PLAN:
 * - Entry price = HI for BUY, LO for SELL.
 * - SL = zone outer edge -/+ max($12, 1.2*ATR14).
 * - TP1/2/3 = the first three distinct levels beyond entry in the trade direction
 *   with distance >= $9 / $13 / $18 (fallback entry +/- $9/$13/$18).
 * - R:R(TP1) = |TP1 - anchor| / |anchor - SL|.
 */
export function build007TradePlan(
  zone: FireZone,
  allLevels: LevelWall[],
  atr14H1: number,
  currentPrice: number,
  isActive: boolean
): TradePlan {
  const isBuy = zone.side === 'BUY';
  const lo = Number(zone.bottom.toFixed(2));
  const hi = Number(zone.top.toFixed(2));
  const anchor = Number(zone.anchor.toFixed(2));
  const entryRange: [number, number] = [lo, hi];
  const entryPrice = isBuy ? hi : lo;

  const slOffset = Math.max(12.0, Number((1.2 * atr14H1).toFixed(2)));
  const sl = isBuy
    ? Number((lo - slOffset).toFixed(2))
    : Number((hi + slOffset).toFixed(2));

  const directionalLevels = allLevels
    .filter((lvl) => (isBuy ? lvl.price > entryPrice : lvl.price < entryPrice))
    .sort((a, b) => (isBuy ? a.price - b.price : b.price - a.price));

  const usedPrices = new Set<number>();

  const pickTpLevel = (minDist: number, minAfterPrice?: number): number | null => {
    for (const lvl of directionalLevels) {
      const p = Number(lvl.price.toFixed(2));
      if (usedPrices.has(p)) continue;
      if (Math.abs(p - entryPrice) < minDist - 1e-6) continue;
      if (minAfterPrice !== undefined) {
        if (isBuy && p <= minAfterPrice) continue;
        if (!isBuy && p >= minAfterPrice) continue;
      }
      usedPrices.add(p);
      return p;
    }
    return null;
  };

  const fallbackTp1 = isBuy
    ? Number((entryPrice + 9.0).toFixed(2))
    : Number((entryPrice - 9.0).toFixed(2));
  const tp1 = pickTpLevel(9.0) ?? fallbackTp1;
  usedPrices.add(tp1);

  const fallbackTp2 = isBuy
    ? Number(Math.max(entryPrice + 13.0, tp1 + 4.0).toFixed(2))
    : Number(Math.min(entryPrice - 13.0, tp1 - 4.0).toFixed(2));
  const tp2 = pickTpLevel(13.0, tp1) ?? fallbackTp2;
  usedPrices.add(tp2);

  const fallbackTp3 = isBuy
    ? Number(Math.max(entryPrice + 18.0, tp2 + 5.0).toFixed(2))
    : Number(Math.min(entryPrice - 18.0, tp2 - 5.0).toFixed(2));
  const tp3 = pickTpLevel(18.0, tp2) ?? fallbackTp3;

  // R:R(TP1) = |TP1 - anchor| / |anchor - SL|
  const risk = Number(Math.max(0.1, Math.abs(anchor - sl)).toFixed(2));
  const rrTp1 = Number((Math.abs(tp1 - anchor) / Math.max(0.01, Math.abs(anchor - sl))).toFixed(2));

  let distance = 0;
  if (currentPrice > hi) distance = Number((currentPrice - hi).toFixed(2));
  else if (currentPrice < lo) distance = Number((lo - currentPrice).toFixed(2));

  return {
    side: zone.side,
    zoneType: zone.type || 'NEAREST',
    zoneId: zone.id,
    isActive,
    entryRange,
    entryPrice,
    anchor,
    zoneLabel: zone.label,
    zoneScore: zone.score,
    sl,
    tp1,
    tp2,
    tp3,
    risk,
    rrTp1,
    distance,
    isStar: zone.isStar,
  };
}

