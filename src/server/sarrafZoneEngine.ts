import { Candle, getCandleStore, getClosedCandles } from './candleEngine.ts';

export type ZoneType =
  | 'FVG'
  | 'OB'
  | 'BSL'
  | 'SSL'
  | 'PDH'
  | 'PDL'
  | 'SESSION_HIGH'
  | 'SESSION_LOW'
  | 'ABSORPTION';

export type ZoneSide = 'SELL' | 'BUY';
export type ZoneStatus = 'FRESH' | 'TOUCHED' | 'TESTED' | 'SWEPT' | 'BROKEN';

export interface SarrafZone {
  id: string;
  type: ZoneType;
  side: ZoneSide; // SELL candidate (above price) | BUY candidate (below price)
  top: number;
  bottom: number;
  mid: number;
  status: ZoneStatus;
  timeframe: string; // 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1'
  createdAt: string;
  createdBarIndex: number;
  rating: number; // 0 - 100 (rule-based score)
  ratingBreakdown: {
    freshness: number; // 0 - 25
    confluence: number; // 0 - 30
    htfAlignment: number; // 0 - 25
    absorption: number; // 0 - 20
  };
  bosLevel?: number; // for OB
  brokenAt?: string;
  brokenReason?: string; // e.g. "M15 body closed above 4186.3 at 10:42"
  label: string;
  confluenceTags: string[]; // e.g. ['FVG', 'OB', 'ABS']
  touchesCount?: number;
}

export interface WhereCandidate {
  id: string;
  side: ZoneSide;
  priceRange: string;
  top: number;
  bottom: number;
  mid: number;
  distanceDollars: number;
  rating: number;
  confluenceTags: string[];
  status: ZoneStatus;
  timeframe: string;
  type: ZoneType;
  isWatching: boolean;
}

// Memory persistence for broken zones (retained for 24h, never deleted silently)
const brokenZonesStore = new Map<string, SarrafZone>();

// Cache structure
interface TimeframeZoneCache {
  candleCount: number;
  lastCandleTime: string;
  computedAt: number;
  zones: SarrafZone[];
}

const zoneCache = new Map<string, TimeframeZoneCache>();

// Calculate Average True Range (14 period)
export function computeAtr14(candles: Candle[]): number {
  if (!candles || candles.length < 2) return 1.5;
  const period = Math.min(14, candles.length - 1);
  const trs: number[] = [];

  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
    trs.push(tr);
  }

  const avg = trs.reduce((a, b) => a + b, 0) / trs.length;
  return Math.max(0.2, avg);
}

// Format UTC time as HH:MM
function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
  } catch {
    return 'recent';
  }
}

// 1. Fair Value Gaps (FVG)
function computeFvgs(candles: Candle[], timeframe: string, atr: number): SarrafZone[] {
  const fvgs: SarrafZone[] = [];
  if (candles.length < 3) return fvgs;

  const minGapSize = 0.25 * atr;

  for (let i = 2; i < candles.length; i++) {
    const c0 = candles[i - 2];
    const c2 = candles[i];

    // Bullish FVG: low[i] > high[i-2]
    if (c2.low > c0.high) {
      const gap = c2.low - c0.high;
      if (gap >= minGapSize) {
        const top = c2.low;
        const bottom = c0.high;
        const mid = (top + bottom) / 2;
        const createdAt = candles[i - 1].openTime;
        const id = `fvg-bull-${timeframe}-${createdAt}-${bottom.toFixed(1)}`;

        // Evaluate status from candle i+1 to end
        let status: ZoneStatus = 'FRESH';
        let filled = false;

        for (let j = i + 1; j < candles.length; j++) {
          const testBar = candles[j];
          // Check fill: candle closed fully through the far side
          if (testBar.close < bottom) {
            filled = true;
            break;
          }
          // Check touch: price entered the gap
          if (testBar.low <= top && testBar.high >= bottom) {
            status = 'TOUCHED';
          }
        }

        if (!filled) {
          fvgs.push({
            id,
            type: 'FVG',
            side: 'BUY',
            top,
            bottom,
            mid,
            status,
            timeframe,
            createdAt,
            createdBarIndex: i - 1,
            rating: 0,
            ratingBreakdown: { freshness: 0, confluence: 0, htfAlignment: 0, absorption: 0 },
            label: `FVG bull ${status === 'TOUCHED' ? 'touched' : ''}`.trim(),
            confluenceTags: ['FVG'],
          });
        }
      }
    }

    // Bearish FVG: high[i] < low[i-2]
    if (c2.high < c0.low) {
      const gap = c0.low - c2.high;
      if (gap >= minGapSize) {
        const top = c0.low;
        const bottom = c2.high;
        const mid = (top + bottom) / 2;
        const createdAt = candles[i - 1].openTime;
        const id = `fvg-bear-${timeframe}-${createdAt}-${top.toFixed(1)}`;

        let status: ZoneStatus = 'FRESH';
        let filled = false;

        for (let j = i + 1; j < candles.length; j++) {
          const testBar = candles[j];
          if (testBar.close > top) {
            filled = true;
            break;
          }
          if (testBar.high >= bottom && testBar.low <= top) {
            status = 'TOUCHED';
          }
        }

        if (!filled) {
          fvgs.push({
            id,
            type: 'FVG',
            side: 'SELL',
            top,
            bottom,
            mid,
            status,
            timeframe,
            createdAt,
            createdBarIndex: i - 1,
            rating: 0,
            ratingBreakdown: { freshness: 0, confluence: 0, htfAlignment: 0, absorption: 0 },
            label: `FVG bear ${status === 'TOUCHED' ? 'touched' : ''}`.trim(),
            confluenceTags: ['FVG'],
          });
        }
      }
    }
  }

  // Keep latest 6 per side
  const bullFvgs = fvgs.filter((z) => z.side === 'BUY').slice(-6);
  const bearFvgs = fvgs.filter((z) => z.side === 'SELL').slice(-6);
  return [...bullFvgs, ...bearFvgs];
}

// 2. Order Blocks (OB)
function computeOrderBlocks(candles: Candle[], timeframe: string, atr: number): SarrafZone[] {
  const obs: SarrafZone[] = [];
  if (candles.length < 10) return obs;

  for (let i = 5; i < candles.length - 1; i++) {
    const dispBar = candles[i];
    const body = Math.abs(dispBar.close - dispBar.open);

    const localWindow = candles.slice(Math.max(0, i - 14), i + 1);
    const localAtr = computeAtr14(localWindow);
    const minDisplacement = 1.5 * localAtr;

    if (body < minDisplacement) continue;

    const isBullDisp = dispBar.close > dispBar.open;
    const isBearDisp = dispBar.close < dispBar.open;

    // Check if it broke swing high / swing low (BOS)
    if (isBullDisp) {
      // Find prior swing high in past 6 to 10 bars
      let priorSwingHigh = -Infinity;
      for (let s = Math.max(0, i - 8); s < i; s++) {
        if (candles[s].high > priorSwingHigh) {
          priorSwingHigh = candles[s].high;
        }
      }

      if (dispBar.close > priorSwingHigh && priorSwingHigh > 0) {
        // Bullish OB: last down candle before displacement
        let obIndex = -1;
        for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
          if (candles[k].close < candles[k].open) {
            obIndex = k;
            break;
          }
        }
        if (obIndex === -1) obIndex = i - 1;

        const obBar = candles[obIndex];
        const top = Math.max(obBar.high, obBar.open);
        const bottom = obBar.low;
        const mid = (top + bottom) / 2;
        const createdAt = obBar.openTime;
        const id = `ob-bull-${timeframe}-${createdAt}-${bottom.toFixed(1)}`;

        let status: ZoneStatus = 'FRESH';
        let broken = false;
        let brokenReason = '';
        let brokenAt = '';

        for (let j = i + 1; j < candles.length; j++) {
          const testBar = candles[j];
          // Broken: candle BODY closes through the far side (below bottom for bull OB)
          const testBodyLow = Math.min(testBar.open, testBar.close);
          if (testBar.close < bottom || testBodyLow < bottom) {
            broken = true;
            brokenAt = testBar.openTime;
            brokenReason = `${timeframe} body closed below ${bottom.toFixed(1)} at ${formatTime(testBar.openTime)}`;
            break;
          }
          if (testBar.low <= top && testBar.high >= bottom) {
            status = 'TESTED';
          }
        }

        const zone: SarrafZone = {
          id,
          type: 'OB',
          side: 'BUY',
          top,
          bottom,
          mid,
          status: broken ? 'BROKEN' : status,
          timeframe,
          createdAt,
          createdBarIndex: obIndex,
          rating: 0,
          ratingBreakdown: { freshness: 0, confluence: 0, htfAlignment: 0, absorption: 0 },
          bosLevel: priorSwingHigh,
          brokenAt: broken ? brokenAt : undefined,
          brokenReason: broken ? brokenReason : undefined,
          label: `OB Bull (${timeframe})`,
          confluenceTags: ['OB'],
        };

        if (broken) {
          brokenZonesStore.set(id, zone);
        } else {
          obs.push(zone);
        }
      }
    } else if (isBearDisp) {
      // Find prior swing low in past 6 to 10 bars
      let priorSwingLow = Infinity;
      for (let s = Math.max(0, i - 8); s < i; s++) {
        if (candles[s].low < priorSwingLow) {
          priorSwingLow = candles[s].low;
        }
      }

      if (dispBar.close < priorSwingLow && priorSwingLow < Infinity) {
        // Bearish OB: last up candle before displacement
        let obIndex = -1;
        for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
          if (candles[k].close > candles[k].open) {
            obIndex = k;
            break;
          }
        }
        if (obIndex === -1) obIndex = i - 1;

        const obBar = candles[obIndex];
        const top = obBar.high;
        const bottom = Math.min(obBar.low, obBar.open);
        const mid = (top + bottom) / 2;
        const createdAt = obBar.openTime;
        const id = `ob-bear-${timeframe}-${createdAt}-${top.toFixed(1)}`;

        let status: ZoneStatus = 'FRESH';
        let broken = false;
        let brokenReason = '';
        let brokenAt = '';

        for (let j = i + 1; j < candles.length; j++) {
          const testBar = candles[j];
          const testBodyHigh = Math.max(testBar.open, testBar.close);
          if (testBar.close > top || testBodyHigh > top) {
            broken = true;
            brokenAt = testBar.openTime;
            brokenReason = `${timeframe} body closed above ${top.toFixed(1)} at ${formatTime(testBar.openTime)}`;
            break;
          }
          if (testBar.high >= bottom && testBar.low <= top) {
            status = 'TESTED';
          }
        }

        const zone: SarrafZone = {
          id,
          type: 'OB',
          side: 'SELL',
          top,
          bottom,
          mid,
          status: broken ? 'BROKEN' : status,
          timeframe,
          createdAt,
          createdBarIndex: obIndex,
          rating: 0,
          ratingBreakdown: { freshness: 0, confluence: 0, htfAlignment: 0, absorption: 0 },
          bosLevel: priorSwingLow,
          brokenAt: broken ? brokenAt : undefined,
          brokenReason: broken ? brokenReason : undefined,
          label: `OB Bear (${timeframe})`,
          confluenceTags: ['OB'],
        };

        if (broken) {
          brokenZonesStore.set(id, zone);
        } else {
          obs.push(zone);
        }
      }
    }
  }

  const bullObs = obs.filter((z) => z.side === 'BUY').slice(-4);
  const bearObs = obs.filter((z) => z.side === 'SELL').slice(-4);
  return [...bullObs, ...bearObs];
}

// 3. Liquidity: Equal Highs / Lows (BSL / SSL), PDH / PDL, Session Highs/Lows
function computeLiquidityZones(
  candles: Candle[],
  d1Candles: Candle[],
  timeframe: string,
  atr: number
): SarrafZone[] {
  const liqs: SarrafZone[] = [];
  if (candles.length < 8) return liqs;

  const eqTolerance = 0.1 * atr;

  // Find swing highs / lows
  const swingHighs: { price: number; time: string; index: number }[] = [];
  const swingLows: { price: number; time: string; index: number }[] = [];

  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i];
    if (
      c.high > candles[i - 1].high &&
      c.high > candles[i - 2].high &&
      c.high >= candles[i + 1].high &&
      c.high >= candles[i + 2].high
    ) {
      swingHighs.push({ price: c.high, time: c.openTime, index: i });
    }
    if (
      c.low < candles[i - 1].low &&
      c.low < candles[i - 2].low &&
      c.low <= candles[i + 1].low &&
      c.low <= candles[i + 2].low
    ) {
      swingLows.push({ price: c.low, time: c.openTime, index: i });
    }
  }

  // Check Equal Highs (BSL)
  for (let i = 0; i < swingHighs.length; i++) {
    for (let j = i + 1; j < swingHighs.length; j++) {
      if (Math.abs(swingHighs[i].price - swingHighs[j].price) <= eqTolerance) {
        const top = Math.max(swingHighs[i].price, swingHighs[j].price) + 0.2;
        const bottom = Math.min(swingHighs[i].price, swingHighs[j].price);
        const mid = (top + bottom) / 2;
        const createdAt = swingHighs[j].time;
        const id = `liq-eqh-${timeframe}-${bottom.toFixed(1)}`;

        // Check if swept: price traded through and closed back below
        let swept = false;
        for (let k = swingHighs[j].index + 1; k < candles.length; k++) {
          if (candles[k].high > top && candles[k].close <= top) {
            swept = true;
            break;
          }
        }

        liqs.push({
          id,
          type: 'BSL',
          side: 'SELL',
          top,
          bottom,
          mid,
          status: swept ? 'SWEPT' : 'FRESH',
          timeframe,
          createdAt,
          createdBarIndex: swingHighs[j].index,
          rating: 0,
          ratingBreakdown: { freshness: 0, confluence: 0, htfAlignment: 0, absorption: 0 },
          label: swept ? `BSL (Swept) ${mid.toFixed(1)}` : `Equal Highs (BSL) ${mid.toFixed(1)}`,
          confluenceTags: ['BSL'],
          touchesCount: 2,
        });
      }
    }
  }

  // Check Equal Lows (SSL)
  for (let i = 0; i < swingLows.length; i++) {
    for (let j = i + 1; j < swingLows.length; j++) {
      if (Math.abs(swingLows[i].price - swingLows[j].price) <= eqTolerance) {
        const top = Math.max(swingLows[i].price, swingLows[j].price);
        const bottom = Math.min(swingLows[i].price, swingLows[j].price) - 0.2;
        const mid = (top + bottom) / 2;
        const createdAt = swingLows[j].time;
        const id = `liq-eql-${timeframe}-${top.toFixed(1)}`;

        let swept = false;
        for (let k = swingLows[j].index + 1; k < candles.length; k++) {
          if (candles[k].low < bottom && candles[k].close >= bottom) {
            swept = true;
            break;
          }
        }

        liqs.push({
          id,
          type: 'SSL',
          side: 'BUY',
          top,
          bottom,
          mid,
          status: swept ? 'SWEPT' : 'FRESH',
          timeframe,
          createdAt,
          createdBarIndex: swingLows[j].index,
          rating: 0,
          ratingBreakdown: { freshness: 0, confluence: 0, htfAlignment: 0, absorption: 0 },
          label: swept ? `SSL (Swept) ${mid.toFixed(1)}` : `Equal Lows (SSL) ${mid.toFixed(1)}`,
          confluenceTags: ['SSL'],
          touchesCount: 2,
        });
      }
    }
  }

  // PDH / PDL from D1 candles
  if (d1Candles && d1Candles.length >= 2) {
    const prevD1 = d1Candles[d1Candles.length - 2];
    if (prevD1) {
      // PDH
      liqs.push({
        id: `liq-pdh-${prevD1.high.toFixed(1)}`,
        type: 'PDH',
        side: 'SELL',
        top: prevD1.high + 0.3,
        bottom: prevD1.high,
        mid: prevD1.high,
        status: 'FRESH',
        timeframe: 'D1',
        createdAt: prevD1.openTime,
        createdBarIndex: d1Candles.length - 2,
        rating: 0,
        ratingBreakdown: { freshness: 0, confluence: 0, htfAlignment: 0, absorption: 0 },
        label: `PDH ${prevD1.high.toFixed(1)}`,
        confluenceTags: ['PDH'],
      });

      // PDL
      liqs.push({
        id: `liq-pdl-${prevD1.low.toFixed(1)}`,
        type: 'PDL',
        side: 'BUY',
        top: prevD1.low,
        bottom: prevD1.low - 0.3,
        mid: prevD1.low,
        status: 'FRESH',
        timeframe: 'D1',
        createdAt: prevD1.openTime,
        createdBarIndex: d1Candles.length - 2,
        rating: 0,
        ratingBreakdown: { freshness: 0, confluence: 0, htfAlignment: 0, absorption: 0 },
        label: `PDL ${prevD1.low.toFixed(1)}`,
        confluenceTags: ['PDL'],
      });
    }
  }

  return liqs;
}

// 4. Rate Zones Deterministically
export function scoreZones(
  zones: SarrafZone[],
  htfBias: 'BUY' | 'SELL' | 'NEUTRAL',
  absorptionZones: { price: number; side: 'BUY' | 'SELL'; strength: number }[]
): SarrafZone[] {
  return zones.map((z) => {
    // Freshness (0-25)
    let freshnessScore = 25;
    if (z.status === 'TOUCHED' || z.status === 'TESTED') {
      freshnessScore = 15;
    } else if (z.status === 'SWEPT') {
      freshnessScore = 10;
    } else if (z.status === 'BROKEN') {
      freshnessScore = 0;
    }

    // Confluence with another zone type overlapping (0-30)
    let confluenceScore = 0;
    const overlappingTypes = new Set<string>();
    for (const other of zones) {
      if (other.id === z.id) continue;
      // Overlap condition
      const overlap = Math.max(0, Math.min(z.top, other.top) - Math.max(z.bottom, other.bottom));
      const dist = Math.abs(z.mid - other.mid);
      if (overlap > 0 || dist <= 1.2) {
        overlappingTypes.add(other.type);
      }
    }
    confluenceScore = Math.min(30, overlappingTypes.size * 15);
    const confluenceTags = [z.type, ...Array.from(overlappingTypes)];

    // HTF Alignment with H1/H4/D1 bias (0-25)
    let htfScore = 12; // Neutral
    if (htfBias !== 'NEUTRAL') {
      htfScore = z.side === htfBias ? 25 : 0;
    }

    // Absorption match (0-20)
    let absScore = 0;
    for (const abs of absorptionZones) {
      if (abs.side === z.side && Math.abs(z.mid - abs.price) <= 2.0) {
        absScore = Math.min(20, Math.round(20 * (abs.strength / 100)));
        if (!confluenceTags.includes('ABS')) {
          confluenceTags.push('ABS');
        }
        break;
      }
    }

    const rating = Math.min(100, freshnessScore + confluenceScore + htfScore + absScore);

    return {
      ...z,
      rating,
      ratingBreakdown: {
        freshness: freshnessScore,
        confluence: confluenceScore,
        htfAlignment: htfScore,
        absorption: absScore,
      },
      confluenceTags: Array.from(new Set(confluenceTags)),
    };
  });
}

// Retain broken zones for 24h
function purgeOldBrokenZones() {
  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;
  for (const [id, zone] of brokenZonesStore.entries()) {
    if (zone.brokenAt) {
      const age = now - new Date(zone.brokenAt).getTime();
      if (age > dayMs) {
        brokenZonesStore.delete(id);
      }
    }
  }
}

// Main Engine Evaluation per timeframe
export function computeZonesForTimeframe(
  timeframe: 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1',
  currentPrice: number = 0,
  absorptionZones: { price: number; side: 'BUY' | 'SELL'; strength: number }[] = []
): SarrafZone[] {
  const store = getCandleStore();
  const candles = store[timeframe] || [];
  const d1Candles = store.D1 || [];

  if (candles.length < 3) {
    return [];
  }

  // Check cache
  const lastBar = candles[candles.length - 1];
  const cacheKey = `${timeframe}-${candles.length}-${lastBar?.openTime || ''}`;
  const cached = zoneCache.get(timeframe);

  if (
    cached &&
    cached.candleCount === candles.length &&
    cached.lastCandleTime === lastBar?.openTime &&
    Date.now() - cached.computedAt < 3000
  ) {
    return cached.zones;
  }

  purgeOldBrokenZones();

  const atr = computeAtr14(candles);

  // Determine HTF bias from H1/H4
  let htfBias: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  if (store.H1.length >= 2) {
    const lastH1 = store.H1[store.H1.length - 1];
    const prevH1 = store.H1[store.H1.length - 2];
    if (lastH1.close > prevH1.high) htfBias = 'BUY';
    else if (lastH1.close < prevH1.low) htfBias = 'SELL';
  }

  const fvgs = computeFvgs(candles, timeframe, atr);
  const obs = computeOrderBlocks(candles, timeframe, atr);
  const liqs = computeLiquidityZones(candles, d1Candles, timeframe, atr);

  // Collect broken zones for this timeframe
  const brokenForTf: SarrafZone[] = [];
  for (const bz of brokenZonesStore.values()) {
    if (bz.timeframe === timeframe) {
      brokenForTf.push(bz);
    }
  }

  const rawZones = [...fvgs, ...obs, ...liqs, ...brokenForTf];
  const scored = scoreZones(rawZones, htfBias, absorptionZones);

  // Sort: active zones nearest to price first, broken zones placed by distance
  const sorted = scored.sort((a, b) => {
    if (currentPrice > 0) {
      return Math.abs(a.mid - currentPrice) - Math.abs(b.mid - currentPrice);
    }
    return b.rating - a.rating;
  });

  zoneCache.set(timeframe, {
    candleCount: candles.length,
    lastCandleTime: lastBar?.openTime || '',
    computedAt: Date.now(),
    zones: sorted,
  });

  return sorted;
}

// Helper: Get candidate zones for "WHERE SELL/BUY CAN COME FROM"
export function getWhereSellBuyCanComeFrom(
  currentPrice: number,
  timeframe: 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' = 'M15'
): {
  candidates: WhereCandidate[];
  watchingCandidate: WhereCandidate | null;
} {
  if (currentPrice <= 0) {
    return { candidates: [], watchingCandidate: null };
  }

  const zones = computeZonesForTimeframe(timeframe, currentPrice);

  // Filter: non-broken, rating >= 40
  const eligible = zones.filter((z) => z.status !== 'BROKEN' && z.rating >= 40);

  // 2 nearest SELL candidates above price
  const sellCandidates = eligible
    .filter((z) => z.side === 'SELL' && z.bottom >= currentPrice - 0.5)
    .sort((a, b) => a.mid - b.mid)
    .slice(0, 2);

  // 2 nearest BUY candidates below price
  const buyCandidates = eligible
    .filter((z) => z.side === 'BUY' && z.top <= currentPrice + 0.5)
    .sort((a, b) => b.mid - a.mid)
    .slice(0, 2);

  const combined = [...sellCandidates, ...buyCandidates];

  // Pick single best candidate as "WATCHING" (highest rating; tiebreak closest distance)
  let bestCandidateZone: SarrafZone | null = null;
  let bestScore = -1;

  for (const z of combined) {
    const dist = Math.abs(z.mid - currentPrice);
    const priority = z.rating - dist * 0.5;
    if (priority > bestScore) {
      bestScore = priority;
      bestCandidateZone = z;
    }
  }

  const result: WhereCandidate[] = combined.map((z) => {
    const dist = Math.abs(z.mid - currentPrice);
    const isWatching = bestCandidateZone ? z.id === bestCandidateZone.id : false;
    return {
      id: z.id,
      side: z.side,
      priceRange: `$${z.bottom.toFixed(1)} - $${z.top.toFixed(1)}`,
      top: z.top,
      bottom: z.bottom,
      mid: z.mid,
      distanceDollars: Number(dist.toFixed(2)),
      rating: z.rating,
      confluenceTags: z.confluenceTags,
      status: z.status,
      timeframe: z.timeframe,
      type: z.type,
      isWatching,
    };
  });

  const watchingCandidate = result.find((c) => c.isWatching) || null;

  return { candidates: result, watchingCandidate };
}

// Helper: Format for Panel 9 LIQUIDITY ZONES
export function getLiquidityZonesListForPanel(
  currentPrice: number,
  timeframe: 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' = 'M15'
): {
  id: string;
  label: string;
  mid: number;
  type: string;
  side: ZoneSide;
  rating: number;
  status: ZoneStatus;
  sourcesCount: number;
}[] {
  const zones = computeZonesForTimeframe(timeframe, currentPrice);

  return zones
    .filter((z) => {
      if (currentPrice <= 0) return true;
      return Math.abs(z.mid - currentPrice) <= 25.0;
    })
    .map((z) => {
      const sourcesCount = Math.max(1, z.confluenceTags.length + (z.touchesCount ? z.touchesCount - 1 : 0));
      let displayLabel = z.label;

      if (z.type === 'OB') {
        displayLabel = `${z.side === 'SELL' ? 'Resistance' : 'Support'} (${sourcesCount} src)`;
      } else if (z.type === 'FVG') {
        displayLabel = `${z.side === 'SELL' ? 'Supply FVG' : 'Demand FVG'} (${sourcesCount} src)`;
      } else if (z.type === 'BSL') {
        displayLabel = `Equal highs (BSL)`;
      } else if (z.type === 'SSL') {
        displayLabel = `Equal lows (SSL)`;
      } else if (z.type === 'PDH') {
        displayLabel = `Liquidity PDH`;
      } else if (z.type === 'PDL') {
        displayLabel = `Liquidity PDL`;
      } else if (sourcesCount >= 3) {
        displayLabel = `Major Zone (${sourcesCount} src)`;
      }

      return {
        id: z.id,
        label: displayLabel,
        mid: z.mid,
        type: z.type,
        side: z.side,
        rating: z.rating,
        status: z.status,
        sourcesCount,
      };
    })
    .sort((a, b) => (currentPrice > 0 ? Math.abs(a.mid - currentPrice) - Math.abs(b.mid - currentPrice) : b.rating - a.rating))
    .slice(0, 10);
}
