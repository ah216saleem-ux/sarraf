// src/fireZone/backtest.ts
import { Candle, FireZone, FireZoneTimeframe, LevelWall, Pivot, ZoneSide } from './types';
import { findPivots } from './engineCore';
import {
  PIVOT_ORIGIN_WEIGHTS,
  ZoneOriginCandidate,
  build007TradePlan,
  clusterAndBonusZoneCandidates,
  evaluateOriginCandidate,
} from './levels';

export interface BacktestTradeRecord {
  side: ZoneSide;
  entryBar: number;
  exitBar: number;
  entryPrice: number;
  exitPrice: number;
  sl: number;
  tp1: number;
  rMultiple: number;
  zoneScore: number;
  outcome: 'TP1' | 'SL' | 'TIME_STOP';
}

export interface FireZoneBacktestSummary {
  timeframe: FireZoneTimeframe;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  profitFactor: number;
  strongTrades: number;
  strongWinRate: number;
  strongAvgR: number;
  maxDrawdownR: number;
  verdict: 'sample too small' | 'positive edge shown' | 'no edge on this timeframe';
  disclaimer: string;
  tradeList: BacktestTradeRecord[];
}

function computeRollingAtr(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const atrs = new Array<number>(n).fill(2.0);
  if (n < 2) return atrs;

  const trs = new Array<number>(n).fill(0);
  trs[0] = Math.max(0.5, candles[0].high - candles[0].low);
  for (let i = 1; i < n; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    trs[i] = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
  }

  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (i < period) {
      sum += trs[i];
      atrs[i] = Math.max(0.5, Number((sum / (i + 1)).toFixed(2)));
    } else {
      atrs[i] = Math.max(
        0.5,
        Number(((atrs[i - 1] * (period - 1) + trs[i]) / period).toFixed(2))
      );
    }
  }
  return atrs;
}

function computeRollingTrend(candles: Candle[], pivotsL5: Pivot[]): Array<1 | -1 | 0> {
  const n = candles.length;
  const trends = new Array<1 | -1 | 0>(n).fill(0);
  let trend: 1 | -1 | 0 = 0;
  let lastHigh: Pivot | null = null;
  let lastLow: Pivot | null = null;
  let cursor = 0;

  for (let k = 0; k < n; k++) {
    while (cursor < pivotsL5.length && pivotsL5[cursor].index + pivotsL5[cursor].level <= k) {
      const p = pivotsL5[cursor++];
      if (p.type === 'HIGH') lastHigh = p;
      else lastLow = p;
    }
    const close = candles[k].close;
    if (lastHigh && close > lastHigh.price) {
      trend = 1;
      lastHigh = null;
    }
    if (lastLow && close < lastLow.price) {
      trend = -1;
      lastLow = null;
    }
    trends[k] = trend;
  }
  return trends;
}

/**
 * Backtest using the exact same H1 candidate scoring, freshness rule (0->+4, 1->+2, 2->0, >=3 discarded),
 * closed-candle break buffer (> 0.25*ATR beyond far edge), $3 same-side clustering + bonuses,
 * and 007 Trade Plan (SL = outer edge -/+ max($12, 1.2*ATR) and snapped TP1).
 * Verdict: < 20 trades = 'sample too small'.
 */
export function runFireZoneBacktest(
  candles: Candle[],
  timeframe: FireZoneTimeframe = '1H'
): FireZoneBacktestSummary {
  const emptyResult: FireZoneBacktestSummary = {
    timeframe,
    trades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    avgR: 0,
    profitFactor: 0,
    strongTrades: 0,
    strongWinRate: 0,
    strongAvgR: 0,
    maxDrawdownR: 0,
    verdict: 'sample too small',
    disclaimer: 'past performance, not a guarantee',
    tradeList: [],
  };
  if (!candles || candles.length < 30) return emptyResult;

  const n = candles.length;
  const atrs = computeRollingAtr(candles, 14);
  const pivotsL5 = findPivots(candles, 5);
  const pivotsL20 = findPivots(candles, 20);
  const pivotsL50 = findPivots(candles, 50);
  const trends = computeRollingTrend(candles, pivotsL5);

  // Deduplicate exact same (type, index) by keeping the largest pivot length L (highest weight)
  const pivotByKey = new Map<string, Pivot>();
  for (const p of [...pivotsL5, ...pivotsL20, ...pivotsL50]) {
    const key = `${p.type}:${p.index}`;
    const existing = pivotByKey.get(key);
    if (!existing || p.level > existing.level) {
      pivotByKey.set(key, p);
    }
  }
  const allPivots = Array.from(pivotByKey.values()).sort((a, b) => a.index - b.index);

  const tradeList: BacktestTradeRecord[] = [];

  let i = 15;
  while (i < n - 1) {
    const trend = trends[i];
    if (trend === 0) {
      i++;
      continue;
    }
    const side: ZoneSide = trend > 0 ? 'BUY' : 'SELL';
    const c = candles[i];
    const body = Math.abs(c.close - c.open);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    const isRejection =
      side === 'BUY'
        ? c.close > c.open && lowerWick > 0.6 * body
        : c.close < c.open && upperWick > 0.6 * body;
    if (!isRejection) {
      i++;
      continue;
    }

    const atr = atrs[i];
    const minPivotIndex = Math.max(0, i - 150);
    const historySlice = candles.slice(0, i);

    // Evaluate all confirmed pivots before bar i using the exact same candidate scoring,
    // freshness rule (0->+4, 1->+2, 2->0, >=3 discarded) and break buffer (0.25*ATR on closes).
    const rawCandidatesAtI: ZoneOriginCandidate[] = [];
    for (let pIdx = 0; pIdx < allPivots.length; pIdx++) {
      const p = allPivots[pIdx];
      if (p.index < minPivotIndex) continue;
      if (p.index + p.level > i) continue;
      const weight = PIVOT_ORIGIN_WEIGHTS[p.level as 5 | 20 | 50] ?? 1;
      const evaluated = evaluateOriginCandidate(p, historySlice, atr, weight);
      if (evaluated) {
        rawCandidatesAtI.push(evaluated);
      }
    }

    if (rawCandidatesAtI.length === 0) {
      i++;
      continue;
    }

    const clusteredAtI = clusterAndBonusZoneCandidates(rawCandidatesAtI, historySlice);

    // Find the most recent / highest-priority valid zone on `side` that candle `c` touched and rejected
    // without breaking the 0.25*ATR closed-candle buffer on bar i
    const sideZones = clusteredAtI
      .filter((cl) => cl.side === side)
      .sort((a, b) => (b.pivotIndex !== a.pivotIndex ? b.pivotIndex - a.pivotIndex : b.score - a.score));

    const matchedZone = sideZones.find((z) => {
      if (side === 'BUY') {
        if (c.close < z.LO - 0.25 * atr) return false;
        return c.low <= z.HI && c.low >= z.LO - 2.0 && c.close > z.HI;
      } else {
        if (c.close > z.HI + 0.25 * atr) return false;
        return c.high >= z.LO && c.high <= z.HI + 2.0 && c.close < z.LO;
      }
    });

    if (!matchedZone) {
      i++;
      continue;
    }

    // Build LevelWall targets from all valid clustered candidates at bar i for 007 TP1 snapping
    const levelWallsAtI: LevelWall[] = clusteredAtI
      .filter((cl) => cl.id !== matchedZone.id)
      .map((cl, idx) => ({
        id: cl.id,
        price: cl.anchor,
        kind: 'PIVOT',
        label: `L${cl.pivotLevel}`,
        sources: [cl.pivotLevel === 50 ? 'D1' : cl.pivotLevel === 20 ? 'H4' : 'H1'],
        touches: cl.retests,
        score: cl.score,
        rank: idx + 1,
        importance: 'MINOR',
        distance: Number(Math.abs(cl.anchor - c.close).toFixed(2)),
        anchorBarIndex: cl.pivotIndex,
        anchorTime: cl.pivotTime,
        allowedSide: cl.side,
      }));

    const fireZoneObj: FireZone = {
      id: matchedZone.id,
      side: matchedZone.side,
      top: matchedZone.HI,
      bottom: matchedZone.LO,
      anchor: matchedZone.anchor,
      pivotIndex: matchedZone.pivotIndex,
      pivotTime: matchedZone.pivotTime,
      pivotPrice: matchedZone.anchor,
      pivotLevel: matchedZone.pivotLevel,
      isLive: true,
      isDead: false,
      touches: matchedZone.retests,
      score: matchedZone.score,
      label: matchedZone.label,
      type: 'NEAREST',
      distance: 0,
    };

    const plan = build007TradePlan(fireZoneObj, levelWallsAtI, atr, c.close, true);
    const entryPrice = c.close;
    const sl = plan.sl;
    const tp1 = plan.tp1;

    const risk = Math.abs(entryPrice - sl);
    if (
      risk <= 0.05 ||
      (side === 'BUY' && (sl >= entryPrice || tp1 <= entryPrice)) ||
      (side === 'SELL' && (sl <= entryPrice || tp1 >= entryPrice))
    ) {
      i++;
      continue;
    }

    const maxExitBar = Math.min(n - 1, i + 80);
    let exitBar = maxExitBar;
    let exitPrice = candles[maxExitBar].close;
    let outcome: 'TP1' | 'SL' | 'TIME_STOP' = 'TIME_STOP';
    let rMultiple = 0;

    for (let k = i + 1; k <= maxExitBar; k++) {
      const bk = candles[k];
      const slHit = side === 'BUY' ? bk.low <= sl : bk.high >= sl;
      const tpHit = side === 'BUY' ? bk.high >= tp1 : bk.low <= tp1;
      if (slHit) {
        exitBar = k;
        exitPrice = sl;
        outcome = 'SL';
        rMultiple = -1.0;
        break;
      }
      if (tpHit) {
        exitBar = k;
        exitPrice = tp1;
        outcome = 'TP1';
        rMultiple = Number((Math.abs(tp1 - entryPrice) / risk).toFixed(2));
        break;
      }
    }

    if (outcome === 'TIME_STOP') {
      const rawPnl = side === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;
      rMultiple = Number((rawPnl / risk).toFixed(2));
    }

    tradeList.push({
      side,
      entryBar: i,
      exitBar,
      entryPrice,
      exitPrice,
      sl,
      tp1,
      rMultiple,
      zoneScore: matchedZone.score,
      outcome,
    });
    i = exitBar + 1;
  }

  const trades = tradeList.length;
  if (trades === 0) return emptyResult;

  const wins = tradeList.filter((t) => t.rMultiple > 0).length;
  const winRate = Number(((wins / trades) * 100).toFixed(1));
  const avgR = Number((tradeList.reduce((a, t) => a + t.rMultiple, 0) / trades).toFixed(2));
  const grossWinR = tradeList.filter((t) => t.rMultiple > 0).reduce((a, t) => a + t.rMultiple, 0);
  const grossLossR = Math.abs(
    tradeList.filter((t) => t.rMultiple < 0).reduce((a, t) => a + t.rMultiple, 0)
  );
  const profitFactor =
    grossLossR > 0 ? Number((grossWinR / grossLossR).toFixed(2)) : grossWinR > 0 ? 9.99 : 0;

  let peakR = 0,
    cumR = 0,
    maxDd = 0;
  for (const t of tradeList) {
    cumR += t.rMultiple;
    if (cumR > peakR) peakR = cumR;
    if (peakR - cumR > maxDd) maxDd = peakR - cumR;
  }

  // STRONG+ on the new score scale corresponds to score >= 8 (STRONG / CRITICAL)
  const strongList = tradeList.filter((t) => t.zoneScore >= 8);
  const strongTrades = strongList.length;
  const strongWins = strongList.filter((t) => t.rMultiple > 0).length;
  const strongWinRate =
    strongTrades > 0 ? Number(((strongWins / strongTrades) * 100).toFixed(1)) : 0;
  const strongAvgR =
    strongTrades > 0
      ? Number((strongList.reduce((a, t) => a + t.rMultiple, 0) / strongTrades).toFixed(2))
      : 0;

  const verdict: FireZoneBacktestSummary['verdict'] =
    trades < 20
      ? 'sample too small'
      : avgR > 0.1
      ? 'positive edge shown'
      : 'no edge on this timeframe';

  return {
    timeframe,
    trades,
    wins,
    losses: trades - wins,
    winRate,
    avgR,
    profitFactor,
    strongTrades,
    strongWinRate,
    strongAvgR,
    maxDrawdownR: Number(maxDd.toFixed(2)),
    verdict,
    disclaimer: 'past performance, not a guarantee',
    tradeList,
  };
}
