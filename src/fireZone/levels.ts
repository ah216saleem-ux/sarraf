// src/fireZone/levels.ts
import {
  Candle,
  FireZone,
  FlippedLevelCandidate,
  LevelImportance,
  LevelKind,
  LevelSourceKind,
  LevelWall,
  Pivot,
  RetiredZoneHistoryItem,
  TradePlan,
  ZoneSide,
  ZoneStrengthLabel,
  ZoneType,
} from './types';
import { findPivots } from './engineCore';
import {
  appendRetiredHistory,
  evaluateZoneClosedLifecycle,
  getLiveZoneDisplayState,
} from './lifecycle';

export const ZONE_HALF = 2.0; // Zone = anchor +/- $2 -> exact $4.00 width
export const ZONE_WIDTH = 4.0;
export const CLUSTER_RADIUS = 3.0; // Cluster candidates within $3 of each other

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
  FLIP: 2, // +2 rank/score bonus for flipped broken level
};

/**
 * Extract Previous Day High/Low (PDH/PDL) and Previous Week High/Low (PWH/PWL).
 */
export function extractCalendarCandidates(
  h1Candles: Candle[],
  h4Candles: Candle[],
  d1Candles: Candle[]
): LevelCandidate[] {
  const out: LevelCandidate[] = [];

  if (d1Candles.length >= 2) {
    const prevD = d1Candles[d1Candles.length - 2];
    out.push(
      { price: Number(prevD.high.toFixed(2)), source: 'PDH', label: 'PDH', time: prevD.time },
      { price: Number(prevD.low.toFixed(2)), source: 'PDL', label: 'PDL', time: prevD.time }
    );
  } else if (h1Candles.length > 0) {
    const dayBuckets = new Map<string, { high: number; low: number; time: number }>();
    for (const c of h1Candles) {
      const dStr = new Date(c.time * 1000).toISOString().slice(0, 10);
      const ex = dayBuckets.get(dStr);
      if (ex) {
        ex.high = Math.max(ex.high, c.high);
        ex.low = Math.min(ex.low, c.low);
      } else {
        dayBuckets.set(dStr, { high: c.high, low: c.low, time: c.time });
      }
    }
    const sortedDays = Array.from(dayBuckets.keys()).sort();
    if (sortedDays.length >= 2) {
      const prevDay = dayBuckets.get(sortedDays[sortedDays.length - 2])!;
      out.push(
        { price: Number(prevDay.high.toFixed(2)), source: 'PDH', label: 'PDH', time: prevDay.time },
        { price: Number(prevDay.low.toFixed(2)), source: 'PDL', label: 'PDL', time: prevDay.time }
      );
    }
  }

  const weekSource =
    d1Candles.length >= 10 ? d1Candles : h4Candles.length >= 20 ? h4Candles : h1Candles;
  if (weekSource.length > 0) {
    const weekBuckets = new Map<string, { high: number; low: number; time: number }>();
    for (const c of weekSource) {
      const d = new Date(c.time * 1000);
      const year = d.getUTCFullYear();
      const oneJan = new Date(Date.UTC(year, 0, 1));
      const dayOfYear = Math.floor((d.getTime() - oneJan.getTime()) / 86400000);
      const week = Math.ceil((dayOfYear + oneJan.getUTCDay() + 1) / 7);
      const weekKey = `${year}-W${String(week).padStart(2, '0')}`;
      const ex = weekBuckets.get(weekKey);
      if (ex) {
        ex.high = Math.max(ex.high, c.high);
        ex.low = Math.min(ex.low, c.low);
      } else {
        weekBuckets.set(weekKey, { high: c.high, low: c.low, time: c.time });
      }
    }
    const sortedWeeks = Array.from(weekBuckets.keys()).sort();
    if (sortedWeeks.length >= 2) {
      const prevWeek = weekBuckets.get(sortedWeeks[sortedWeeks.length - 2])!;
      out.push(
        { price: Number(prevWeek.high.toFixed(2)), source: 'PWH', label: 'PWH', time: prevWeek.time },
        { price: Number(prevWeek.low.toFixed(2)), source: 'PWL', label: 'PWL', time: prevWeek.time }
      );
    }
  }

  return out;
}

/**
 * Find Equal Highs / Equal Lows (two pivots of same type within $2).
 */
export function extractEqualHighsLows(pivots: Pivot[]): LevelCandidate[] {
  const out: LevelCandidate[] = [];
  const highs = pivots.filter((p) => p.type === 'HIGH');
  const lows = pivots.filter((p) => p.type === 'LOW');

  const usedHighPairs = new Set<number>();
  for (let i = 0; i < highs.length; i++) {
    if (usedHighPairs.has(i)) continue;
    for (let j = i + 1; j < highs.length; j++) {
      if (Math.abs(highs[i].price - highs[j].price) <= 2.0) {
        const avg = Number(((highs[i].price + highs[j].price) / 2).toFixed(2));
        out.push({ price: avg, source: 'EQH', label: 'EQH', time: highs[j].time });
        usedHighPairs.add(i);
        usedHighPairs.add(j);
        break;
      }
    }
  }

  const usedLowPairs = new Set<number>();
  for (let i = 0; i < lows.length; i++) {
    if (usedLowPairs.has(i)) continue;
    for (let j = i + 1; j < lows.length; j++) {
      if (Math.abs(lows[i].price - lows[j].price) <= 2.0) {
        const avg = Number(((lows[i].price + lows[j].price) / 2).toFixed(2));
        out.push({ price: avg, source: 'EQL', label: 'EQL', time: lows[j].time });
        usedLowPairs.add(i);
        usedLowPairs.add(j);
        break;
      }
    }
  }

  return out;
}

/**
 * Cluster level candidates within $3 of each other into one level (price = average, keep list of sources).
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

/**
 * Count candle wick touches within $1.5 of levelPrice that did NOT close beyond it.
 */
export function countLevelTouches(h1Candles: Candle[], levelPrice: number): number {
  const sample = h1Candles.slice(-150);
  let touches = 0;

  for (const c of sample) {
    const upperTouch =
      Math.abs(c.high - levelPrice) <= 1.5 && c.close < levelPrice && c.open <= levelPrice;
    const lowerTouch =
      Math.abs(c.low - levelPrice) <= 1.5 && c.close > levelPrice && c.open >= levelPrice;

    if (upperTouch || lowerTouch) {
      touches++;
    }
  }

  return touches;
}

/**
 * Compute importance score from sources and touches:
 * H1 pivot 1 + H4 pivot 3 + D1 pivot 5 + PDH/PDL 4 + PWH/PWL 6 + EQH/EQL 3 + round $100 4 + round $50 2 + FLIP 2 + 1 per touch.
 */
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

export function getZoneStrengthLabel(score: number): ZoneStrengthLabel {
  if (score >= 12) return 'CRITICAL';
  if (score >= 8) return 'STRONG';
  return 'MEDIUM';
}

function buildClusterDisplayLabel(sources: LevelSourceKind[], price: number): {
  kind: LevelKind;
  label: string;
} {
  const unique = Array.from(new Set(sources));
  if (unique.includes('FLIP')) return { kind: 'FLIP', label: 'FLIP' };
  if (unique.includes('PWH')) return { kind: 'PWH', label: 'PWH' };
  if (unique.includes('PWL')) return { kind: 'PWL', label: 'PWL' };
  if (unique.includes('PDH')) return { kind: 'PDH', label: 'PDH' };
  if (unique.includes('PDL')) return { kind: 'PDL', label: 'PDL' };
  if (unique.includes('EQH')) return { kind: 'EQH', label: 'EQH' };
  if (unique.includes('EQL')) return { kind: 'EQL', label: 'EQL' };
  if (unique.includes('ROUND_100') || unique.includes('ROUND_50')) {
    const r = Math.round(price / 50) * 50;
    return { kind: 'ROUND_NUMBER', label: `$${r}` };
  }
  if (unique.includes('D1')) return { kind: 'PIVOT', label: 'D1' };
  if (unique.includes('H4')) return { kind: 'PIVOT', label: 'H4' };
  return { kind: 'PIVOT', label: 'H1' };
}

/**
 * Build all candidate levels from H1 (last 150), H4 (last 100), D1 (last 100),
 * PDH/PDL, PWH/PWL, EQH/EQL, and $50/$100 round numbers, cluster within $3,
 * score and rank descending by score.
 */
export function buildRankedLevels(
  h1Candles: Candle[],
  h4Candles: Candle[],
  d1Candles: Candle[],
  refPrice: number,
  extraFlippedCandidates: FlippedLevelCandidate[] = []
): LevelWall[] {
  const candidates: LevelCandidate[] = [];

  const h1Offset = Math.max(0, h1Candles.length - 150);
  const h1Slice = h1Candles.slice(-150);
  const h4Slice = h4Candles.slice(-100);
  const d1Slice = d1Candles.slice(-100);

  const pivotsH1 = findPivots(h1Slice, 5);
  const pivotsH4 = findPivots(h4Slice, 5);
  const pivotsD1 = findPivots(d1Slice, 5);

  for (const p of pivotsH1) {
    candidates.push({
      price: Number(p.price.toFixed(2)),
      source: 'H1',
      label: 'H1',
      time: p.time,
      h1BarIndex: h1Offset + p.index,
    });
  }
  for (const p of pivotsH4) {
    candidates.push({ price: Number(p.price.toFixed(2)), source: 'H4', label: 'H4', time: p.time });
  }
  for (const p of pivotsD1) {
    candidates.push({ price: Number(p.price.toFixed(2)), source: 'D1', label: 'D1', time: p.time });
  }

  candidates.push(...extractCalendarCandidates(h1Candles, h4Candles, d1Candles));

  candidates.push(
    ...extractEqualHighsLows(pivotsH1),
    ...extractEqualHighsLows(pivotsH4),
    ...extractEqualHighsLows(pivotsD1)
  );

  if (refPrice > 0) {
    const minRound = Math.max(50, Math.floor((refPrice - 300) / 50) * 50);
    const maxRound = Math.ceil((refPrice + 300) / 50) * 50;
    for (let rp = minRound; rp <= maxRound; rp += 50) {
      const is100 = rp % 100 === 0;
      candidates.push({
        price: rp,
        source: is100 ? 'ROUND_100' : 'ROUND_50',
        label: `$${rp}`,
      });
    }
  }

  for (const fl of extraFlippedCandidates) {
    candidates.push({
      price: Number(fl.anchor.toFixed(2)),
      source: 'FLIP',
      label: 'FLIP',
      time: fl.brokenCandleTime,
      h1BarIndex: fl.brokenBarIndex,
    });
  }

  const clustered = clusterCandidatesWithin3(candidates);
  const defaultAnchorBar = Math.max(0, h1Candles.length - 45);

  const scored: LevelWall[] = clustered.map((cl) => {
    const touches = countLevelTouches(h1Candles, cl.price);
    const score = scoreClusteredLevel(cl.sources, touches);
    const { kind, label } = buildClusterDisplayLabel(cl.sources, cl.price);
    const distance = refPrice > 0 ? Number(Math.abs(cl.price - refPrice).toFixed(2)) : 0;

    return {
      id: `lvl-${cl.price.toFixed(2)}`,
      price: cl.price,
      kind,
      label,
      sources: cl.sources,
      touches,
      score,
      rank: 0,
      importance: 'MINOR',
      distance,
      anchorBarIndex: cl.h1BarIndex ?? defaultAnchorBar,
      anchorTime: cl.latestTime || (h1Candles[defaultAnchorBar]?.time ?? 0),
    };
  });

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
 * Select 2 to 3 zones per side from ranked levels while enforcing the Zone Lifecycle:
 * - Evaluates each candidate level against CLOSED H1 candles (FRESH, PLAYED_HELD, BROKEN, EXPIRED).
 * - PLAYED_HELD, BROKEN, and EXPIRED zones are RETIRED: removed from chart/ladder, recorded in history,
 *   and the engine selects the next best level for that slot (NEAREST/SWING/DEEP) on the same closed candle.
 * - A BROKEN level flips: BUY -> SELL candidate (+2 score bonus) or SELL -> BUY candidate (+2 score bonus).
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
  livePrice?: number
): {
  buyZones: FireZone[];
  sellZones: FireZone[];
  retiredHistory: RetiredZoneHistoryItem[];
  flippedCandidates: FlippedLevelCandidate[];
} {
  const effectiveAtr = Math.max(1.5, atr);
  const maxNearestDist = 8 * effectiveAtr;
  const maxDeepDist = 20 * effectiveAtr;

  let history = [...existingHistory];
  const flippedCandidates: FlippedLevelCandidate[] = [];
  const activePool: LevelWall[] = [];

  // 1. Evaluate lifecycle of candidate levels on closed H1 candles
  if (closedH1Candles.length > 0) {
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

        // Flip rule: a BROKEN zone becomes a candidate on the opposite side with rank bonus +2
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

  const displayPrice = typeof livePrice === 'number' && livePrice > 0 ? livePrice : refPrice;

  const toFireZone = (lvl: LevelWall, side: ZoneSide, zType: ZoneType): FireZone => {
    const zoneId = `FZ-${side}-${lvl.price.toFixed(2)}`;
    const existing = zoneStore?.get(zoneId);
    const anchor = existing ? existing.anchor : Number(lvl.price.toFixed(2));
    const top = existing ? existing.top : Number((anchor + ZONE_HALF).toFixed(2));
    const bottom = existing ? existing.bottom : Number((anchor - ZONE_HALF).toFixed(2));

    let distance = 0;
    if (refPrice > top) distance = Number((refPrice - top).toFixed(2));
    else if (refPrice < bottom) distance = Number((bottom - refPrice).toFixed(2));

    const label = getZoneStrengthLabel(lvl.score);
    const isHtf = lvl.sources.includes('D1') || lvl.sources.includes('H4');
    const lifecycleState = getLiveZoneDisplayState({ bottom, top }, displayPrice);

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
      pivotLevel: isHtf ? 15 : 5,
      isLive: true,
      isDead: false,
      lifecycleState,
      isFlipped: lvl.sources.includes('FLIP'),
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
    const sideLevels = activePool.filter((lvl) => {
      if (lvl.allowedSide && lvl.allowedSide !== side) return false;
      return isBuy ? lvl.price < refPrice : lvl.price > refPrice;
    });

    const sortByScoreThenClosest = (a: LevelWall, b: LevelWall) => {
      if (b.score !== a.score) return b.score - a.score;
      const distA = Math.abs(a.price - refPrice);
      const distB = Math.abs(b.price - refPrice);
      return distA - distB;
    };

    const chosenLevels: Array<{ level: LevelWall; type: ZoneType }> = [];

    // 1. NEAREST: highest scoring FRESH level within 8*ATR of price on that side, tie -> closest
    const nearestCandidates = sideLevels
      .filter((lvl) => Math.abs(lvl.price - refPrice) <= maxNearestDist)
      .sort(sortByScoreThenClosest);

    const nearestLvl =
      nearestCandidates[0] ||
      [...sideLevels].sort((a, b) => Math.abs(a.price - refPrice) - Math.abs(b.price - refPrice))[0];

    if (nearestLvl) {
      chosenLevels.push({ level: nearestLvl, type: 'NEAREST' });
    }

    // 2. SWING: highest scoring D1/H4-sourced level on that side at least $12 away from NEAREST
    const swingCandidates = sideLevels
      .filter((lvl) => {
        const hasD1OrH4 = lvl.sources.includes('D1') || lvl.sources.includes('H4');
        if (!hasD1OrH4) return false;
        if (nearestLvl && Math.abs(lvl.price - nearestLvl.price) < 12.0) return false;
        return Math.abs(lvl.price - refPrice) <= 25 * effectiveAtr;
      })
      .sort(sortByScoreThenClosest);

    if (swingCandidates.length > 0) {
      chosenLevels.push({ level: swingCandidates[0], type: 'SWING' });
    }

    // 3. DEEP: highest scoring level on that side between 8*ATR and 20*ATR, at least $12 from the others
    const deepCandidates = sideLevels
      .filter((lvl) => {
        const dist = Math.abs(lvl.price - refPrice);
        if (dist <= maxNearestDist || dist > maxDeepDist) return false;
        return chosenLevels.every((c) => Math.abs(lvl.price - c.level.price) >= 12.0);
      })
      .sort(sortByScoreThenClosest);

    if (deepCandidates.length > 0) {
      chosenLevels.push({ level: deepCandidates[0], type: 'DEEP' });
    }

    return chosenLevels.map((c) => toFireZone(c.level, side, c.type));
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

  // Attach nextZoneAnchor to retired history items for the LEVEL EVENTS sentence
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

  const risk = Number(Math.max(0.1, Math.abs(entryPrice - sl)).toFixed(2));
  const rrTp1 = Number((Math.abs(tp1 - entryPrice) / risk).toFixed(2));

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
    anchor: zone.anchor,
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
