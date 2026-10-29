// src/fireZone/engineLevelsAndPlans.ts
import {
  Candle,
  Pivot,
  FireZone,
  LevelWall,
  TradePlan,
} from './types';
import {
  ZONE_HALF,
  ZONE_WIDTH,
  buildRankedLevels,
  selectZonesFromLevels,
  filterAndRankKeptLevels,
  build007TradePlan,
} from './levels';

export {
  ZONE_HALF,
  ZONE_WIDTH,
  buildRankedLevels,
  selectZonesFromLevels,
  filterAndRankKeptLevels,
  build007TradePlan,
};

/**
 * Legacy-compatible helper that selects 2-3 zones per side with fixed $4 width (anchor +/- $2).
 */
export function selectZonesPerSide(
  allLiveZones: FireZone[],
  candles: Candle[],
  currentPrice: number,
  _zh: number = ZONE_WIDTH,
  atr: number = 10
): { buyZones: FireZone[]; sellZones: FireZone[] } {
  const minPivotIndex = Math.max(0, candles.length - 150);
  const effectiveAtr = Math.max(1.5, atr);
  const maxNearestDist = 8 * effectiveAtr;
  const maxDeepDist = 20 * effectiveAtr;
  const maxSwingDist = 25 * effectiveAtr;

  const normalized = allLiveZones
    .filter((z) => z.pivotIndex >= minPivotIndex && z.distance <= maxSwingDist)
    .map((z) => {
      const anchor = Number(z.anchor.toFixed(2));
      const top = Number((anchor + ZONE_HALF).toFixed(2));
      const bottom = Number((anchor - ZONE_HALF).toFixed(2));
      const distance =
        currentPrice > top
          ? Number((currentPrice - top).toFixed(2))
          : currentPrice < bottom
          ? Number((bottom - currentPrice).toFixed(2))
          : 0;
      return { ...z, anchor, top, bottom, distance };
    });

  const buyCandidates = normalized
    .filter((z) => z.side === 'BUY' && z.anchor < currentPrice)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.distance - b.distance));

  const sellCandidates = normalized
    .filter((z) => z.side === 'SELL' && z.anchor > currentPrice)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.distance - b.distance));

  const pickSide = (list: FireZone[]): FireZone[] => {
    const out: FireZone[] = [];
    const nearest =
      list.find((z) => Math.abs(z.anchor - currentPrice) <= maxNearestDist) || list[0];
    if (!nearest) return out;
    out.push({ ...nearest, type: 'NEAREST' });

    const swing = list.find(
      (z) =>
        z.id !== nearest.id &&
        (z.pivotLevel === 15 || z.pivotLevel === 20) &&
        Math.abs(z.anchor - nearest.anchor) >= 12
    );
    if (swing) out.push({ ...swing, type: 'SWING' });

    const deep = list.find((z) => {
      const d = Math.abs(z.anchor - currentPrice);
      if (d <= maxNearestDist || d > maxDeepDist) return false;
      return out.every((s) => Math.abs(z.anchor - s.anchor) >= 12);
    });
    if (deep) out.push({ ...deep, type: 'DEEP' });

    return out;
  };

  const buyZones = pickSide(buyCandidates);
  const sellZones = pickSide(sellCandidates);

  const buyNearest = buyZones.find((z) => z.type === 'NEAREST');
  const sellNearest = sellZones.find((z) => z.type === 'NEAREST');
  if (buyNearest && sellNearest) {
    if (buyNearest.score >= sellNearest.score) buyNearest.isStar = true;
    else sellNearest.isStar = true;
  } else if (buyNearest) buyNearest.isStar = true;
  else if (sellNearest) sellNearest.isStar = true;

  return { buyZones, sellZones };
}

export function computeLevelWalls(
  candles: Candle[],
  _pivots: Pivot[],
  atr: number,
  currentPrice: number,
  _plans: TradePlan[],
  h4Candles: Candle[] = [],
  d1Candles: Candle[] = []
): LevelWall[] {
  const ranked = buildRankedLevels(candles, h4Candles, d1Candles, currentPrice);
  return filterAndRankKeptLevels(ranked, [], currentPrice, atr);
}

export function buildTradePlan(
  zone: FireZone,
  allLevels: LevelWall[],
  atr: number,
  currentPrice: number,
  isActive: boolean
): TradePlan {
  return build007TradePlan(zone, allLevels, atr, currentPrice, isActive);
}
