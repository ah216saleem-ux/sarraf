// src/fireZone/backtest.ts
import { Candle, FireZoneTimeframe, Pivot, ZoneSide } from './types';
import { findPivots, calculateStrengthScore } from './engineCore';

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
      atrs[i] = Math.max(0.5, Number(((atrs[i - 1] * (period - 1) + trs[i]) / period).toFixed(2)));
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
  const pivotsL15 = findPivots(candles, 15);
  const trends = computeRollingTrend(candles, pivotsL5);

  const pivotMap = new Map<number, Pivot>();
  for (const p of pivotsL5) pivotMap.set(p.index, p);
  for (const p of pivotsL15) pivotMap.set(p.index, p);
  const allPivots = Array.from(pivotMap.values()).sort((a, b) => a.index - b.index);

  const tradeList: BacktestTradeRecord[] = [];
  const avgVol = candles.reduce((a, c) => a + (c.volume || 0), 0) / (n || 1);

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
    const zh = 4.0;
    let matchedScore: number | null = null;
    let matchedTop = 0;
    let matchedBottom = 0;

    for (let pIdx = allPivots.length - 1; pIdx >= 0; pIdx--) {
      const p = allPivots[pIdx];
      if (p.index + p.level > i) continue;
      if ((side === 'BUY' && p.type !== 'LOW') || (side === 'SELL' && p.type !== 'HIGH')) continue;

      const anchor = Number(p.price.toFixed(2));
      const top = Number((anchor + 2.0).toFixed(2));
      const bottom = Number((anchor - 2.0).toFixed(2));

      let deadBeforeI = false;
      let touches = 0;
      for (let m = p.index + 1; m < i; m++) {
        const bm = candles[m];
        if (side === 'SELL') {
          if (bm.close > top) { deadBeforeI = true; break; }
          if (bm.high >= bottom) touches++;
        } else {
          if (bm.close < bottom) { deadBeforeI = true; break; }
          if (bm.low <= top) touches++;
        }
      }
      if (deadBeforeI) continue;

      const touchedAndRejected =
        side === 'BUY'
          ? c.low <= top && c.low >= bottom - zh / 2 && c.close > top
          : c.high >= bottom && c.high <= top + zh / 2 && c.close < bottom;

      if (touchedAndRejected) {
        matchedScore = calculateStrengthScore(touches + 1, p.volume, avgVol, i - p.index, i + 1).score;
        matchedTop = top;
        matchedBottom = bottom;
        break;
      }
    }

    if (matchedScore === null) {
      i++;
      continue;
    }

    const entryPrice = c.close;
    const slOffset = Math.max(12.0, Number((1.2 * atr).toFixed(2)));
    const sl = side === 'BUY' ? Number((matchedBottom - slOffset).toFixed(2)) : Number((matchedTop + slOffset).toFixed(2));
    const risk = Math.abs(entryPrice - sl);
    if (risk <= 0.05 || (side === 'BUY' && sl >= entryPrice) || (side === 'SELL' && sl <= entryPrice)) {
      i++;
      continue;
    }

    const tp1 = side === 'BUY' ? Number((entryPrice + 9.0).toFixed(2)) : Number((entryPrice - 9.0).toFixed(2));

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
        exitBar = k; exitPrice = sl; outcome = 'SL'; rMultiple = -1.0; break;
      }
      if (tpHit) {
        exitBar = k; exitPrice = tp1; outcome = 'TP1';
        rMultiple = Number((Math.abs(tp1 - entryPrice) / risk).toFixed(2));
        break;
      }
    }

    if (outcome === 'TIME_STOP') {
      const rawPnl = side === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;
      rMultiple = Number((rawPnl / risk).toFixed(2));
    }

    tradeList.push({
      side, entryBar: i, exitBar, entryPrice, exitPrice, sl, tp1, rMultiple, zoneScore: matchedScore, outcome,
    });
    i = exitBar + 1;
  }

  const trades = tradeList.length;
  if (trades === 0) return emptyResult;

  const wins = tradeList.filter((t) => t.rMultiple > 0).length;
  const winRate = Number(((wins / trades) * 100).toFixed(1));
  const avgR = Number((tradeList.reduce((a, t) => a + t.rMultiple, 0) / trades).toFixed(2));
  const grossWinR = tradeList.filter((t) => t.rMultiple > 0).reduce((a, t) => a + t.rMultiple, 0);
  const grossLossR = Math.abs(tradeList.filter((t) => t.rMultiple < 0).reduce((a, t) => a + t.rMultiple, 0));
  const profitFactor = grossLossR > 0 ? Number((grossWinR / grossLossR).toFixed(2)) : grossWinR > 0 ? 9.99 : 0;

  let peakR = 0, cumR = 0, maxDd = 0;
  for (const t of tradeList) {
    cumR += t.rMultiple;
    if (cumR > peakR) peakR = cumR;
    if (peakR - cumR > maxDd) maxDd = peakR - cumR;
  }

  const strongList = tradeList.filter((t) => t.zoneScore >= 55);
  const strongTrades = strongList.length;
  const strongWins = strongList.filter((t) => t.rMultiple > 0).length;
  const strongWinRate = strongTrades > 0 ? Number(((strongWins / strongTrades) * 100).toFixed(1)) : 0;
  const strongAvgR = strongTrades > 0 ? Number((strongList.reduce((a, t) => a + t.rMultiple, 0) / strongTrades).toFixed(2)) : 0;

  const verdict: FireZoneBacktestSummary['verdict'] =
    trades < 20 ? 'sample too small' : avgR > 0.1 ? 'positive edge shown' : 'no edge on this timeframe';

  return {
    timeframe, trades, wins, losses: trades - wins, winRate, avgR, profitFactor,
    strongTrades, strongWinRate, strongAvgR, maxDrawdownR: Number(maxDd.toFixed(2)),
    verdict, disclaimer: 'past performance, not a guarantee', tradeList,
  };
}
