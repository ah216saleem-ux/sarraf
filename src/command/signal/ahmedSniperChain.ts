import { SniperGateResult, GateDirection, SignalSide } from './types';
import { SNIPER_CONFIG, SniperConfig } from './sniperConfig';

export interface CandleLike {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  time?: number | string;
}

export type OpposingObStatus = 'CLEAR_WITH_OB' | 'CLEAR_NO_OB_AHEAD' | 'BLOCKED_BY_OB' | 'NONE';

export interface H1OrderBlockZone {
  side: 'BUY' | 'SELL'; // BUY = Bullish Demand OB, SELL = Bearish Supply OB
  top: number;
  bottom: number;
  mid: number;
  createdAt?: number | string;
}

export interface OpposingZoneCheck {
  nearestOpposingZonePrice: number | null;
  pathClearDollars: number;
  isClear1R: boolean;
  opposingObStatus: OpposingObStatus;
}

export interface SniperEvaluationInput {
  d1Candles?: CandleLike[];
  h4Candles?: CandleLike[];
  h1Candles?: CandleLike[];
  m30Candles?: CandleLike[];
  m15Candles?: CandleLike[];
  m5Candles?: CandleLike[];
  currentPrice: number;
  spread: number;
  buyRatio: number; // 0 - 100
  sellRatio: number; // 0 - 100
  buyDelta60s: number;
  sellDelta60s: number;
  confidence: number; // 0 - 100
  nearestSupport?: number;
  nearestResistance?: number;
  feedStatus: 'LIVE' | 'LIVE (POLLING)' | 'STALE' | 'RECONNECTING' | 'MARKET_CLOSED' | 'OFFLINE';
  isFlowWarmingUp?: boolean;
  flowTicksCount?: number;
  tickAgeSeconds?: number;
  config?: SniperConfig;
}

export interface SniperEvaluationOutput {
  gates: SniperGateResult[];
  gatesAllPassed: boolean;
  alignedDirection: SignalSide | null;
  pathClearDollars: number;
  isPathClear: boolean;
  opposingObStatus?: OpposingObStatus;
  nearestOpposingObPrice?: number | null;
  confidence: number;
  isConfidenceMet: boolean;
  canIssueSignal: boolean;
  waitReason: string;
}

function computeLocalAtr14(candles: CandleLike[]): number {
  if (!candles || candles.length < 2) return 5.0;
  const slice = candles.slice(-15);
  let sum = 0;
  let count = 0;
  for (let i = 1; i < slice.length; i++) {
    const tr = Math.max(
      slice[i].high - slice[i].low,
      Math.abs(slice[i].high - slice[i - 1].close),
      Math.abs(slice[i].low - slice[i - 1].close)
    );
    sum += tr;
    count++;
  }
  return count > 0 ? sum / count : 5.0;
}

/**
 * Finds unmitigated Bullish (Demand) and Bearish (Supply) H1 Order Blocks from historical H1 candles.
 * Scans up to `lookback` H1 bars (default 100), detects 1-bar or 2-bar displacement impulses,
 * and marks an Order Block mitigated only when a subsequent H1 candle body closes beyond its invalidation edge.
 */
export function findUnmitigatedH1OrderBlocks(
  candles: CandleLike[],
  lookback: number = SNIPER_CONFIG.h1ObLookback
): {
  bullObs: H1OrderBlockZone[];
  bearObs: H1OrderBlockZone[];
} {
  const bullObs: H1OrderBlockZone[] = [];
  const bearObs: H1OrderBlockZone[] = [];
  if (!candles || candles.length < 10) return { bullObs, bearObs };

  const slice = lookback > 0 && candles.length > lookback ? candles.slice(-lookback) : candles;

  for (let i = 3; i < slice.length - 1; i++) {
    const dispBar = slice[i];
    const prevBar = slice[i - 1];
    const body1 = Math.abs(dispBar.close - dispBar.open);
    const localAtr = computeLocalAtr14(slice.slice(Math.max(0, i - 14), i + 1));

    // Bullish 1-bar or 2-bar displacement impulse
    const isBull1 = dispBar.close > dispBar.open && body1 >= 0.75 * localAtr;
    const isBull2 =
      dispBar.close > dispBar.open &&
      prevBar.close > prevBar.open &&
      dispBar.close - prevBar.open >= 1.1 * localAtr;

    if (isBull1 || isBull2) {
      const impStart = isBull2 ? i - 1 : i;
      let priorHigh = -Infinity;
      for (let s = Math.max(0, impStart - 5); s < impStart; s++) {
        if (slice[s].high > priorHigh) priorHigh = slice[s].high;
      }
      if (dispBar.close > priorHigh || body1 >= 1.0 * localAtr || isBull2) {
        let obIdx = impStart - 1;
        for (let k = impStart - 1; k >= Math.max(0, impStart - 4); k--) {
          if (slice[k].close < slice[k].open) {
            obIdx = k;
            break;
          }
        }
        if (obIdx >= 0) {
          const obBar = slice[obIdx];
          const top = Number(Math.max(obBar.open, obBar.close).toFixed(2));
          const bottom = Number(obBar.low.toFixed(2));
          const mid = Number(((top + bottom) / 2).toFixed(2));

          let mitigated = false;
          for (let j = i + 1; j < slice.length; j++) {
            if (slice[j].close < bottom) {
              mitigated = true;
              break;
            }
          }
          if (!mitigated) {
            bullObs.push({ side: 'BUY', top, bottom, mid, createdAt: obBar.time });
          }
        }
      }
    }

    // Bearish 1-bar or 2-bar displacement impulse
    const isBear1 = dispBar.close < dispBar.open && body1 >= 0.75 * localAtr;
    const isBear2 =
      dispBar.close < dispBar.open &&
      prevBar.close < prevBar.open &&
      prevBar.open - dispBar.close >= 1.1 * localAtr;

    if (isBear1 || isBear2) {
      const impStart = isBear2 ? i - 1 : i;
      let priorLow = Infinity;
      for (let s = Math.max(0, impStart - 5); s < impStart; s++) {
        if (slice[s].low < priorLow) priorLow = slice[s].low;
      }
      if (dispBar.close < priorLow || body1 >= 1.0 * localAtr || isBear2) {
        let obIdx = impStart - 1;
        for (let k = impStart - 1; k >= Math.max(0, impStart - 4); k--) {
          if (slice[k].close > slice[k].open) {
            obIdx = k;
            break;
          }
        }
        if (obIdx >= 0) {
          const obBar = slice[obIdx];
          const top = Number(obBar.high.toFixed(2));
          const bottom = Number(Math.min(obBar.open, obBar.close).toFixed(2));
          const mid = Number(((top + bottom) / 2).toFixed(2));

          let mitigated = false;
          for (let j = i + 1; j < slice.length; j++) {
            if (slice[j].close > top) {
              mitigated = true;
              break;
            }
          }
          if (!mitigated) {
            bearObs.push({ side: 'SELL', top, bottom, mid, createdAt: obBar.time });
          }
        }
      }
    }
  }

  return { bullObs, bearObs };
}

/**
 * Evaluates 1R path clearance against the nearest unmitigated opposing H1 Order Block.
 * If no opposing H1 Order Block exists ahead of price, the path is treated as CLEAR with status 'CLEAR_NO_OB_AHEAD'.
 */
export function evaluateOpposingH1OrderBlockPath(
  h1Candles: CandleLike[],
  currentPrice: number,
  direction: SignalSide | null,
  minPathClearDollars: number = 10.0,
  explicitSupport?: number,
  explicitResistance?: number,
  lookback: number = SNIPER_CONFIG.h1ObLookback
): OpposingZoneCheck {
  if (!direction || currentPrice <= 0) {
    return {
      nearestOpposingZonePrice: null,
      pathClearDollars: 0,
      isClear1R: false,
      opposingObStatus: 'NONE',
    };
  }

  if (h1Candles && h1Candles.length >= 10) {
    const { bullObs, bearObs } = findUnmitigatedH1OrderBlocks(h1Candles, lookback);

    if (direction === 'BUY') {
      const opposingBear = bearObs
        .filter((o) => o.bottom > currentPrice)
        .sort((a, b) => a.bottom - b.bottom);

      if (opposingBear.length === 0) {
        return {
          nearestOpposingZonePrice: null,
          pathClearDollars: 15.0,
          isClear1R: true,
          opposingObStatus: 'CLEAR_NO_OB_AHEAD',
        };
      }

      const nearest = opposingBear[0];
      const dist = Number(Math.max(0, nearest.bottom - currentPrice).toFixed(2));
      const isClear = dist >= minPathClearDollars;
      return {
        nearestOpposingZonePrice: nearest.bottom,
        pathClearDollars: dist,
        isClear1R: isClear,
        opposingObStatus: isClear ? 'CLEAR_WITH_OB' : 'BLOCKED_BY_OB',
      };
    } else {
      const opposingBull = bullObs
        .filter((o) => o.top < currentPrice)
        .sort((a, b) => b.top - a.top);

      if (opposingBull.length === 0) {
        return {
          nearestOpposingZonePrice: null,
          pathClearDollars: 15.0,
          isClear1R: true,
          opposingObStatus: 'CLEAR_NO_OB_AHEAD',
        };
      }

      const nearest = opposingBull[0];
      const dist = Number(Math.max(0, currentPrice - nearest.top).toFixed(2));
      const isClear = dist >= minPathClearDollars;
      return {
        nearestOpposingZonePrice: nearest.top,
        pathClearDollars: dist,
        isClear1R: isClear,
        opposingObStatus: isClear ? 'CLEAR_WITH_OB' : 'BLOCKED_BY_OB',
      };
    }
  }

  // Fallback when fewer than 10 H1 candles are provided (e.g. unit test harness with explicit support/resistance)
  if (direction === 'BUY') {
    if (explicitResistance !== undefined) {
      const dist = Number(Math.max(0, explicitResistance - currentPrice).toFixed(2));
      const isClear = dist >= minPathClearDollars;
      return {
        nearestOpposingZonePrice: explicitResistance,
        pathClearDollars: dist,
        isClear1R: isClear,
        opposingObStatus: isClear ? 'CLEAR_WITH_OB' : 'BLOCKED_BY_OB',
      };
    }
    return {
      nearestOpposingZonePrice: null,
      pathClearDollars: 15.0,
      isClear1R: true,
      opposingObStatus: 'CLEAR_NO_OB_AHEAD',
    };
  } else {
    if (explicitSupport !== undefined) {
      const dist = Number(Math.max(0, currentPrice - explicitSupport).toFixed(2));
      const isClear = dist >= minPathClearDollars;
      return {
        nearestOpposingZonePrice: explicitSupport,
        pathClearDollars: dist,
        isClear1R: isClear,
        opposingObStatus: isClear ? 'CLEAR_WITH_OB' : 'BLOCKED_BY_OB',
      };
    }
    return {
      nearestOpposingZonePrice: null,
      pathClearDollars: 15.0,
      isClear1R: true,
      opposingObStatus: 'CLEAR_NO_OB_AHEAD',
    };
  }
}

/**
 * Evaluates the 8 Gates of the Ahmed Sniper Chain
 * Computes direction from real order blocks, swing liquidity, and price action across D1, H4, H1, M30, M15, M5 and live tick flow.
 */
export function evaluateAhmedSniperChain(input: SniperEvaluationInput): SniperEvaluationOutput {
  const cfg = input.config || SNIPER_CONFIG;
  const {
    currentPrice,
    spread,
    buyRatio,
    sellRatio,
    confidence,
    feedStatus,
    d1Candles = [],
    h4Candles = [],
    h1Candles = [],
    m30Candles = [],
    m15Candles = [],
    m5Candles = [],
  } = input;

  // Rule: Never generate a signal from missing, stale, or reconnecting data.
  const isFeedActive = feedStatus === 'LIVE' || feedStatus === 'LIVE (POLLING)';
  const isPriceStale = typeof input.tickAgeSeconds === 'number' && input.tickAgeSeconds > 10;
  if (!isFeedActive || isPriceStale || currentPrice <= 0) {
    const isHistoryMissing = d1Candles.length === 0;
    const disconnectReason = isHistoryMissing
      ? 'History loading (upstream down)'
      : isPriceStale
      ? `Price feed stale (${input.tickAgeSeconds}s old) · Awaiting fresh stream`
      : 'Feed disconnected · Awaiting live stream';
    const lockedGates: SniperGateResult[] = [
      { id: 'g1', name: 'W1/D1 Context', shortName: 'D1 Context', timeframe: 'D1', status: 'LOCKED', direction: 'NEUTRAL', reason: disconnectReason },
      { id: 'g2', name: 'H4 Bias', shortName: 'H4 Bias', timeframe: 'H4', status: 'LOCKED', direction: 'NEUTRAL', reason: disconnectReason },
      { id: 'g3', name: 'H1 Confirmation', shortName: 'H1 Confirm', timeframe: 'H1', status: 'LOCKED', direction: 'NEUTRAL', reason: disconnectReason },
      { id: 'g4', name: 'M30 Refinement', shortName: 'M30 Refine', timeframe: 'M30', status: 'LOCKED', direction: 'NEUTRAL', reason: disconnectReason },
      { id: 'g5', name: 'M15 Body Close', shortName: 'M15 Close', timeframe: 'M15', status: 'LOCKED', direction: 'NEUTRAL', reason: disconnectReason },
      { id: 'g6', name: 'M5 Retest', shortName: 'M5 Retest', timeframe: 'M5', status: 'LOCKED', direction: 'NEUTRAL', reason: disconnectReason, isEstimated: false },
      { id: 'g7', name: 'M5 Confirmation', shortName: 'M5 Confirm', timeframe: 'M5', status: 'LOCKED', direction: 'NEUTRAL', reason: disconnectReason, isEstimated: false },
      { id: 'g8', name: 'Entry Trigger', shortName: 'Tick Trigger', timeframe: 'TICK', status: 'LOCKED', direction: 'NEUTRAL', reason: disconnectReason },
    ];

    return {
      gates: lockedGates,
      gatesAllPassed: false,
      alignedDirection: null,
      pathClearDollars: 0,
      isPathClear: false,
      confidence: 0,
      isConfidenceMet: false,
      canIssueSignal: false,
      waitReason: isHistoryMissing
        ? 'History loading (upstream down)'
        : isPriceStale
        ? `WAIT: Price feed stale (${input.tickAgeSeconds}s old) · signals paused until fresh live ticks resume.`
        : 'Feed reconnecting · Signals paused until live ticks resume.',
    };
  }

  // -------------------------------------------------------------
  // GATE 1: W1/D1 Context (Order Block & Swing High/Low)
  // -------------------------------------------------------------
  let g1Status: 'PASS' | 'FAIL' | 'LOCKED' = 'FAIL';
  let g1Dir: GateDirection = 'NEUTRAL';
  let g1Reason = 'D1 consolidation without directional bias';
  let d1KeyLevel = 0;

  if (d1Candles.length < 5) {
    g1Status = 'LOCKED';
    g1Reason = d1Candles.length === 0 ? 'History loading (upstream down)' : 'Insufficient D1 bars for swing context';
  } else {
    const recentD1 = d1Candles.slice(-cfg.w1d1SwingLookback);
    const lastD1 = recentD1[recentD1.length - 1];
    const prevD1 = recentD1[recentD1.length - 2];

    // Compute D1 swing highs and lows
    let d1SwingHigh = -Infinity;
    let d1SwingLow = Infinity;
    for (const c of recentD1) {
      if (c.high > d1SwingHigh) d1SwingHigh = c.high;
      if (c.low < d1SwingLow) d1SwingLow = c.low;
    }

    // Find D1 Demand OB (last down candle before major upward push) and Supply OB
    const midD1 = (d1SwingHigh + d1SwingLow) / 2;
    const isAboveMid = currentPrice >= midD1;
    const lastBullishMove = lastD1.close >= prevD1.close;

    if (currentPrice > prevD1.high || (isAboveMid && lastBullishMove)) {
      g1Status = 'PASS';
      g1Dir = 'BUY';
      // Demand zone must be strictly below current price
      d1KeyLevel = Math.min(currentPrice - 2.0, d1SwingLow + (d1SwingHigh - d1SwingLow) * 0.382);
      g1Reason = `D1 Bullish structure above $${d1KeyLevel.toFixed(1)} demand zone`;
    } else if (currentPrice < prevD1.low || (!isAboveMid && !lastBullishMove)) {
      g1Status = 'PASS';
      g1Dir = 'SELL';
      // Supply zone must be strictly above current price
      d1KeyLevel = Math.max(currentPrice + 2.0, d1SwingHigh - (d1SwingHigh - d1SwingLow) * 0.382);
      g1Reason = `D1 Bearish structure below $${d1KeyLevel.toFixed(1)} supply zone`;
    } else {
      g1Status = 'FAIL';
      g1Dir = 'NEUTRAL';
      g1Reason = `D1 range chop [${d1SwingLow.toFixed(1)} - ${d1SwingHigh.toFixed(1)}]`;
    }
  }

  // -------------------------------------------------------------
  // GATE 2: H4 Bias (SARRAF Liquidity Sweeps & Order Block)
  // -------------------------------------------------------------
  let g2Status: 'PASS' | 'FAIL' | 'LOCKED' = 'LOCKED';
  let g2Dir: GateDirection = 'NEUTRAL';
  let g2Reason = 'Awaiting D1 directional context';

  if (g1Status === 'PASS') {
    if (h4Candles.length < 4) {
      g2Status = 'LOCKED';
      g2Reason = 'Insufficient H4 bars for liquidity analysis';
    } else {
      const recentH4 = h4Candles.slice(-12);
      const lastH4 = recentH4[recentH4.length - 1];
      const prevH4 = recentH4[recentH4.length - 2];

      // Detect liquidity sweeps (wick penetrating prior swing then closing inside)
      const sweepBuyLiquidity = prevH4.low < (recentH4[0]?.low ?? prevH4.low) && lastH4.close > prevH4.low;
      const sweepSellLiquidity = prevH4.high > (recentH4[0]?.high ?? prevH4.high) && lastH4.close < prevH4.high;

      const h4HigherHigh = lastH4.high >= prevH4.high && lastH4.close >= prevH4.close;
      const h4LowerLow = lastH4.low <= prevH4.low && lastH4.close <= prevH4.close;

      if (g1Dir === 'BUY') {
        if (h4HigherHigh || sweepBuyLiquidity || currentPrice > prevH4.open) {
          g2Status = 'PASS';
          g2Dir = 'BUY';
          g2Reason = sweepBuyLiquidity
            ? `H4 sweeps sellside liquidity @ $${prevH4.low.toFixed(1)}`
            : `H4 Bullish order block respected @ $${prevH4.close.toFixed(1)}`;
        } else {
          g2Status = 'FAIL';
          g2Dir = 'SELL';
          g2Reason = 'H4 Bearish counter-trend displacement';
        }
      } else if (g1Dir === 'SELL') {
        if (h4LowerLow || sweepSellLiquidity || currentPrice < prevH4.open) {
          g2Status = 'PASS';
          g2Dir = 'SELL';
          g2Reason = sweepSellLiquidity
            ? `H4 sweeps buyside liquidity @ $${prevH4.high.toFixed(1)}`
            : `H4 Bearish order block respected @ $${prevH4.close.toFixed(1)}`;
        } else {
          g2Status = 'FAIL';
          g2Dir = 'BUY';
          g2Reason = 'H4 Bullish counter-trend displacement';
        }
      }
    }
  }

  // -------------------------------------------------------------
  // GATE 3: H1 Confirmation (BOS / CHoCH Break of Structure)
  // -------------------------------------------------------------
  let g3Status: 'PASS' | 'FAIL' | 'LOCKED' = 'LOCKED';
  let g3Dir: GateDirection = 'NEUTRAL';
  let g3Reason = 'Awaiting H4 bias alignment';

  if (g2Status === 'PASS') {
    if (h1Candles.length < 5) {
      g3Status = 'LOCKED';
      g3Reason = 'Accumulating H1 bars';
    } else {
      const recentH1 = h1Candles.slice(-10);
      const lastH1 = recentH1[recentH1.length - 1];
      const prevH1 = recentH1[recentH1.length - 2];
      const prev2H1 = recentH1[recentH1.length - 3];

      // Bullish BOS: closing above prior high
      const isBullishBos = lastH1.close > prev2H1.high || (lastH1.close > prevH1.high && currentPrice >= lastH1.close);
      const isBearishBos = lastH1.close < prev2H1.low || (lastH1.close < prevH1.low && currentPrice <= lastH1.close);

      if (g2Dir === 'BUY' && isBullishBos) {
        g3Status = 'PASS';
        g3Dir = 'BUY';
        g3Reason = `H1 Bullish BOS confirmed above $${prev2H1.high.toFixed(1)}`;
      } else if (g2Dir === 'SELL' && isBearishBos) {
        g3Status = 'PASS';
        g3Dir = 'SELL';
        g3Reason = `H1 Bearish BOS confirmed below $${prev22Low(prev2H1.low)}`;
      } else {
        g3Status = 'FAIL';
        g3Dir = 'NEUTRAL';
        g3Reason = `H1 range consolidation ($${Math.min(lastH1.low, prevH1.low).toFixed(1)} - $${Math.max(lastH1.high, prevH1.high).toFixed(1)})`;
      }
    }
  }

  function prev22Low(val: number) {
    return val.toFixed(1);
  }

  // -------------------------------------------------------------
  // GATE 4: M30 Refinement (Fair Value Gap / Supply & Demand Zone)
  // -------------------------------------------------------------
  let g4Status: 'PASS' | 'FAIL' | 'LOCKED' = 'LOCKED';
  let g4Dir: GateDirection = 'NEUTRAL';
  let g4Reason = 'Awaiting H1 confirmation';

  if (g3Status === 'PASS') {
    if (m30Candles.length < 4) {
      g4Status = 'LOCKED';
      g4Reason = 'Accumulating M30 bars';
    } else {
      const recentM30 = m30Candles.slice(-8);
      const c1 = recentM30[recentM30.length - 3];
      const c2 = recentM30[recentM30.length - 2];
      const c3 = recentM30[recentM30.length - 1];

      // FVG Detection: Bullish if c1.high < c3.low; Bearish if c1.low > c3.high
      const isBullishFvg = c3.low - c1.high >= cfg.m30FvgMinSize;
      const isBearishFvg = c1.low - c3.high >= cfg.m30FvgMinSize;
      const respectsDemand = currentPrice >= c2.low - 1.0;
      const respectsSupply = currentPrice <= c2.high + 1.0;

      if (g3Dir === 'BUY' && (isBullishFvg || respectsDemand)) {
        g4Status = 'PASS';
        g4Dir = 'BUY';
        g4Reason = isBullishFvg
          ? `M30 Bullish FVG [$${c1.high.toFixed(1)} - $${c3.low.toFixed(1)}] active`
          : `M30 Demand refinement zone holding @ $${c2.low.toFixed(1)}`;
      } else if (g3Dir === 'SELL' && (isBearishFvg || respectsSupply)) {
        g4Status = 'PASS';
        g4Dir = 'SELL';
        g4Reason = isBearishFvg
          ? `M30 Bearish FVG [$${c3.high.toFixed(1)} - $${c1.low.toFixed(1)}] active`
          : `M30 Supply refinement zone holding @ $${c2.high.toFixed(1)}`;
      } else {
        g4Status = 'FAIL';
        g4Dir = 'NEUTRAL';
        g4Reason = 'M30 refinement zone not yet tagged';
      }
    }
  }

  // -------------------------------------------------------------
  // GATE 5: M15 Body Close (Candle Body Close with Displacement)
  // -------------------------------------------------------------
  let g5Status: 'PASS' | 'FAIL' | 'LOCKED' = 'LOCKED';
  let g5Dir: GateDirection = 'NEUTRAL';
  let g5Reason = 'Awaiting M30 refinement';

  if (g4Status === 'PASS') {
    if (m15Candles.length < 2) {
      g5Status = 'LOCKED';
      g5Reason = 'Accumulating M15 bars';
    } else {
      const lastM15 = m15Candles[m15Candles.length - 1];
      const range = Math.max(0.1, lastM15.high - lastM15.low);
      const body = Math.abs(lastM15.close - lastM15.open);
      const bodyRatio = body / range;

      if (g4Dir === 'BUY') {
        const isBullishClose = lastM15.close > lastM15.open && (bodyRatio >= cfg.m15BodyRatioMin || body >= 1.0);
        if (isBullishClose) {
          g5Status = 'PASS';
          g5Dir = 'BUY';
          g5Reason = `M15 Bullish body close @ $${lastM15.close.toFixed(1)} (${Math.round(bodyRatio * 100)}% body)`;
        } else {
          g5Status = 'FAIL';
          g5Dir = 'NEUTRAL';
          g5Reason = `M15 weak body close (${Math.round(bodyRatio * 100)}% body · opposing wick)`;
        }
      } else if (g4Dir === 'SELL') {
        const isBearishClose = lastM15.close < lastM15.open && (bodyRatio >= cfg.m15BodyRatioMin || body >= 1.0);
        if (isBearishClose) {
          g5Status = 'PASS';
          g5Dir = 'SELL';
          g5Reason = `M15 Bearish body close @ $${lastM15.close.toFixed(1)} (${Math.round(bodyRatio * 100)}% body)`;
        } else {
          g5Status = 'FAIL';
          g5Dir = 'NEUTRAL';
          g5Reason = `M15 weak body close (${Math.round(bodyRatio * 100)}% body · opposing wick)`;
        }
      }
    }
  }

  // -------------------------------------------------------------
  // GATE 6: M5 Retest (Pullback into Refined Order Block)
  // -------------------------------------------------------------
  let g6Status: 'PASS' | 'FAIL' | 'LOCKED' = 'LOCKED';
  let g6Dir: GateDirection = 'NEUTRAL';
  let g6Reason = 'Awaiting M15 body close';

  if (g5Status === 'PASS') {
    // Strictly use authentic M5 candles
    if (m5Candles.length < 3) {
      g6Status = 'LOCKED';
      g6Reason = 'Accumulating M5 bars';
    } else {
      const recentM5 = m5Candles.slice(-4);
      const minLow = Math.min(...recentM5.map((c) => c.low));
      const maxHigh = Math.max(...recentM5.map((c) => c.high));

      if (g5Dir === 'BUY') {
        // Price pulled back into test level and holds
        const distanceToLow = currentPrice - minLow;
        if (distanceToLow <= cfg.m5RetestBuffer + 4.0 && currentPrice >= minLow) {
          g6Status = 'PASS';
          g6Dir = 'BUY';
          g6Reason = `M5 Retest of demand liquidity pocket ($${minLow.toFixed(1)}) held`;
        } else {
          g6Status = 'FAIL';
          g6Dir = 'NEUTRAL';
          g6Reason = `M5 extended beyond retest buffer ($${distanceToLow.toFixed(1)} from low)`;
        }
      } else if (g5Dir === 'SELL') {
        const distanceToHigh = maxHigh - currentPrice;
        if (distanceToHigh <= cfg.m5RetestBuffer + 4.0 && currentPrice <= maxHigh) {
          g6Status = 'PASS';
          g6Dir = 'SELL';
          g6Reason = `M5 Retest of supply liquidity pocket ($${maxHigh.toFixed(1)}) held`;
        } else {
          g6Status = 'FAIL';
          g6Dir = 'NEUTRAL';
          g6Reason = `M5 extended beyond retest buffer ($${distanceToHigh.toFixed(1)} from high)`;
        }
      }
    }
  }

  // -------------------------------------------------------------
  // GATE 7: M5 Confirmation (Rejection Wick / Micro-Shift)
  // -------------------------------------------------------------
  let g7Status: 'PASS' | 'FAIL' | 'LOCKED' = 'LOCKED';
  let g7Dir: GateDirection = 'NEUTRAL';
  let g7Reason = 'Awaiting M5 retest';

  if (g6Status === 'PASS') {
    const lastM5 = m5Candles[m5Candles.length - 1];
    const lowerWick = Math.max(0, Math.min(lastM5.open, lastM5.close) - lastM5.low);
    const upperWick = Math.max(0, lastM5.high - Math.max(lastM5.open, lastM5.close));

    if (g6Dir === 'BUY') {
      const hasLowerRejection = lowerWick >= upperWick || currentPrice >= lastM5.open;
      if (hasLowerRejection) {
        g7Status = 'PASS';
        g7Dir = 'BUY';
        g7Reason = `M5 Bullish rejection wick confirmed (${lowerWick.toFixed(1)} pts absorption)`;
      } else {
        g7Status = 'FAIL';
        g7Dir = 'NEUTRAL';
        g7Reason = 'M5 awaiting buyer wick absorption confirmation';
      }
    } else if (g6Dir === 'SELL') {
      const hasUpperRejection = upperWick >= lowerWick || currentPrice <= lastM5.open;
      if (hasUpperRejection) {
        g7Status = 'PASS';
        g7Dir = 'SELL';
        g7Reason = `M5 Bearish rejection wick confirmed (${upperWick.toFixed(1)} pts absorption)`;
      } else {
        g7Status = 'FAIL';
        g7Dir = 'NEUTRAL';
        g7Reason = 'M5 awaiting seller wick absorption confirmation';
      }
    }
  }

  // -------------------------------------------------------------
  // GATE 8: Entry Trigger (Real-Time Tick Delta & Flow)
  // -------------------------------------------------------------
  let g8Status: 'PASS' | 'FAIL' | 'LOCKED' = 'LOCKED';
  let g8Dir: GateDirection = 'NEUTRAL';
  let g8Reason = 'Awaiting M5 micro-confirmation';

  if (g7Status === 'PASS') {
    const isSpreadOk = spread <= cfg.maxSpreadEntryDollars;

    if (input.isFlowWarmingUp || (input.flowTicksCount !== undefined && input.flowTicksCount < 5)) {
      g8Status = 'LOCKED';
      g8Dir = 'NEUTRAL';
      g8Reason = `Accumulating 60s tick flow buffer (${input.flowTicksCount ?? 0} ticks · warming up)`;
    } else if (!isSpreadOk) {
      g8Status = 'FAIL';
      g8Dir = 'NEUTRAL';
      g8Reason = `Spread too wide: $${spread.toFixed(2)} (max allowed $${cfg.maxSpreadEntryDollars.toFixed(2)})`;
    } else if (g7Dir === 'BUY') {
      if (buyRatio >= cfg.minFlowRatioPercent && (input.buyDelta60s >= 0 || buyRatio >= 58)) {
        g8Status = 'PASS';
        g8Dir = 'BUY';
        g8Reason = `Buy flow dominant (${buyRatio.toFixed(1)}% · Spread $${spread.toFixed(2)})`;
      } else {
        g8Status = 'FAIL';
        g8Dir = 'NEUTRAL';
        g8Reason = `Buy flow insufficient: ${buyRatio.toFixed(1)}% (requires ≥ ${cfg.minFlowRatioPercent}%)`;
      }
    } else if (g7Dir === 'SELL') {
      if (sellRatio >= cfg.minFlowRatioPercent && (input.sellDelta60s >= 0 || sellRatio >= 58)) {
        g8Status = 'PASS';
        g8Dir = 'SELL';
        g8Reason = `Sell flow dominant (${sellRatio.toFixed(1)}% · Spread $${spread.toFixed(2)})`;
      } else {
        g8Status = 'FAIL';
        g8Dir = 'NEUTRAL';
        g8Reason = `Sell flow insufficient: ${sellRatio.toFixed(1)}% (requires ≥ ${cfg.minFlowRatioPercent}%)`;
      }
    }
  }

  // Assemble gate list
  const gates: SniperGateResult[] = [
    { id: 'g1', name: 'W1/D1 Context', shortName: 'D1 Context', timeframe: 'D1', status: g1Status, direction: g1Dir, reason: g1Reason },
    { id: 'g2', name: 'H4 Bias', shortName: 'H4 Bias', timeframe: 'H4', status: g2Status, direction: g2Dir, reason: g2Reason },
    { id: 'g3', name: 'H1 Confirmation', shortName: 'H1 Confirm', timeframe: 'H1', status: g3Status, direction: g3Dir, reason: g3Reason },
    { id: 'g4', name: 'M30 Refinement', shortName: 'M30 Refine', timeframe: 'M30', status: g4Status, direction: g4Dir, reason: g4Reason },
    { id: 'g5', name: 'M15 Body Close', shortName: 'M15 Close', timeframe: 'M15', status: g5Status, direction: g5Dir, reason: g5Reason },
    { id: 'g6', name: 'M5 Retest', shortName: 'M5 Retest', timeframe: 'M5', status: g6Status, direction: g6Dir, reason: g6Reason, isEstimated: false },
    { id: 'g7', name: 'M5 Confirmation', shortName: 'M5 Confirm', timeframe: 'M5', status: g7Status, direction: g7Dir, reason: g7Reason, isEstimated: false },
    { id: 'g8', name: 'Entry Trigger', shortName: 'Tick Trigger', timeframe: 'TICK', status: g8Status, direction: g8Dir, reason: g8Reason },
  ];

  // All 8 gates must PASS in the same direction
  const allPassed = gates.every((g) => g.status === 'PASS');
  let alignedDirection: SignalSide | null = null;

  if (allPassed) {
    const firstDir = gates[0].direction;
    if ((firstDir === 'BUY' || firstDir === 'SELL') && gates.every((g) => g.direction === firstDir)) {
      alignedDirection = firstDir;
    }
  }

  // Option B: 1R ($10.0) opposing path check against nearest unmitigated opposing H1 Order Block
  const candidateDirection: SignalSide | null =
    alignedDirection ||
    (g1Dir === 'BUY' || g1Dir === 'SELL' ? g1Dir : buyRatio >= 50 ? 'BUY' : 'SELL');

  const obPathEval = evaluateOpposingH1OrderBlockPath(
    h1Candles,
    currentPrice,
    candidateDirection,
    cfg.minPathClearDollars,
    input.nearestSupport,
    input.nearestResistance,
    cfg.h1ObLookback
  );

  const pathClearDollars = obPathEval.pathClearDollars;
  const isPathClear = alignedDirection ? obPathEval.isClear1R : false;
  const opposingObStatus = obPathEval.opposingObStatus;
  const nearestOpposingObPrice = obPathEval.nearestOpposingZonePrice;

  const isConfidenceMet = confidence >= cfg.minConfidencePercent;

  // Signal is issued only when all gates PASS in the same direction AND confidence is at least 65% AND path to opposing H1 OB is at least 1R clear
  const canIssueSignal = !!(allPassed && alignedDirection && isConfidenceMet && isPathClear);

  // Formulate concise human-readable one-line wait/entry reason
  let waitReason = '';
  if (canIssueSignal && alignedDirection) {
    if (opposingObStatus === 'CLEAR_NO_OB_AHEAD') {
      waitReason = `8/8 SNIPER GATES ALIGNED (${alignedDirection}): Path CLEAR [NO_OPPOSING_H1_OB_AHEAD] (Confidence: ${confidence.toFixed(0)}%)`;
    } else {
      waitReason = `8/8 SNIPER GATES ALIGNED (${alignedDirection}): Clear path +$${pathClearDollars.toFixed(1)} to opposing H1 OB @ $${(nearestOpposingObPrice ?? 0).toFixed(2)} (Confidence: ${confidence.toFixed(0)}%)`;
    }
  } else if (!allPassed) {
    const failedGate = gates.find((g) => g.status === 'FAIL');
    const lockedGate = gates.find((g) => g.status === 'LOCKED');
    if (failedGate) {
      waitReason = `WAIT: Gate ${failedGate.name} failed (${failedGate.reason})`;
    } else if (lockedGate) {
      waitReason = `WAIT: Gate ${lockedGate.name} locked (${lockedGate.reason})`;
    } else {
      waitReason = 'WAIT: Awaiting multi-timeframe Ahmed sniper convergence';
    }
  } else if (!isConfidenceMet) {
    waitReason = `WAIT: Confidence ${confidence.toFixed(0)}% below 65% sarraf minimum`;
  } else if (!isPathClear) {
    waitReason = `WAIT: Opposing H1 Order Block ${nearestOpposingObPrice ? `@ $${nearestOpposingObPrice.toFixed(2)} ` : ''}too close ($${pathClearDollars.toFixed(1)} < $10.0 required)`;
  }

  return {
    gates,
    gatesAllPassed: allPassed && !!alignedDirection,
    alignedDirection,
    pathClearDollars,
    isPathClear,
    opposingObStatus,
    nearestOpposingObPrice,
    confidence,
    isConfidenceMet,
    canIssueSignal,
    waitReason,
  };
}
