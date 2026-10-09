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

export interface OpposingZoneCheck {
  nearestOpposingZonePrice: number | null;
  pathClearDollars: number;
  isClear1R: boolean;
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
  feedStatus: 'LIVE' | 'RECONNECTING' | 'OFFLINE';
  config?: SniperConfig;
}

export interface SniperEvaluationOutput {
  gates: SniperGateResult[];
  gatesAllPassed: boolean;
  alignedDirection: SignalSide | null;
  pathClearDollars: number;
  isPathClear: boolean;
  confidence: number;
  isConfidenceMet: boolean;
  canIssueSignal: boolean;
  waitReason: string;
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
  if (feedStatus !== 'LIVE' || currentPrice <= 0) {
    const lockedGates: SniperGateResult[] = [
      { id: 'g1', name: 'W1/D1 Context', shortName: 'D1 Context', timeframe: 'D1', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Feed disconnected · Awaiting live stream' },
      { id: 'g2', name: 'H4 Bias', shortName: 'H4 Bias', timeframe: 'H4', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Feed disconnected · Awaiting live stream' },
      { id: 'g3', name: 'H1 Confirmation', shortName: 'H1 Confirm', timeframe: 'H1', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Feed disconnected · Awaiting live stream' },
      { id: 'g4', name: 'M30 Refinement', shortName: 'M30 Refine', timeframe: 'M30', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Feed disconnected · Awaiting live stream' },
      { id: 'g5', name: 'M15 Body Close', shortName: 'M15 Close', timeframe: 'M15', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Feed disconnected · Awaiting live stream' },
      { id: 'g6', name: 'M5 Retest', shortName: 'M5 Retest', timeframe: 'M5', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Feed disconnected · Awaiting live stream', isEstimated: true },
      { id: 'g7', name: 'M5 Confirmation', shortName: 'M5 Confirm', timeframe: 'M5', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Feed disconnected · Awaiting live stream', isEstimated: true },
      { id: 'g8', name: 'Entry Trigger', shortName: 'Tick Trigger', timeframe: 'TICK', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Feed disconnected · Awaiting live stream' },
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
      waitReason: 'BiQuote feed disconnected or reconnecting · Signals paused until live ticks resume.',
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
    g1Reason = 'Insufficient D1 bars for swing context';
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
  // GATE 2: H4 Bias (Institutional Liquidity Sweeps & Order Block)
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
    // If M5 candles available (or derived M5)
    const candlesToUse = m5Candles.length > 0 ? m5Candles : m15Candles;
    if (candlesToUse.length < 3) {
      g6Status = 'LOCKED';
      g6Reason = 'Accumulating M5 bars';
    } else {
      const recentM5 = candlesToUse.slice(-4);
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
    const candlesToUse = m5Candles.length > 0 ? m5Candles : m15Candles;
    const lastM5 = candlesToUse[candlesToUse.length - 1];
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

    if (!isSpreadOk) {
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
    { id: 'g6', name: 'M5 Retest', shortName: 'M5 Retest', timeframe: 'M5', status: g6Status, direction: g6Dir, reason: g6Reason, isEstimated: true },
    { id: 'g7', name: 'M5 Confirmation', shortName: 'M5 Confirm', timeframe: 'M5', status: g7Status, direction: g7Dir, reason: g7Reason, isEstimated: true },
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

  // 1R (10 dollars) opposing path check
  let pathClearDollars = 0;
  let isPathClear = false;

  if (alignedDirection === 'BUY') {
    const res = input.nearestResistance ?? (currentPrice + 15.0);
    pathClearDollars = Math.max(0, res - currentPrice);
    isPathClear = pathClearDollars >= cfg.minPathClearDollars;
  } else if (alignedDirection === 'SELL') {
    const sup = input.nearestSupport ?? (currentPrice - 15.0);
    pathClearDollars = Math.max(0, currentPrice - sup);
    isPathClear = pathClearDollars >= cfg.minPathClearDollars;
  }

  const isConfidenceMet = confidence >= cfg.minConfidencePercent;

  // Signal is issued only when all gates PASS in the same direction AND confidence is at least 65% AND path to opposing zone is at least 1R clear
  const canIssueSignal = !!(allPassed && alignedDirection && isConfidenceMet && isPathClear);

  // Formulate concise human-readable one-line wait/entry reason
  let waitReason = '';
  if (canIssueSignal && alignedDirection) {
    waitReason = `8/8 SNIPER GATES ALIGNED (${alignedDirection}): Clear path +$${pathClearDollars.toFixed(1)} (Confidence: ${confidence.toFixed(0)}%)`;
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
    waitReason = `WAIT: Confidence ${confidence.toFixed(0)}% below 65% institutional minimum`;
  } else if (!isPathClear) {
    waitReason = `WAIT: Opposing liquidity zone too close ($${pathClearDollars.toFixed(1)} < $10.0 required)`;
  }

  return {
    gates,
    gatesAllPassed: allPassed && !!alignedDirection,
    alignedDirection,
    pathClearDollars,
    isPathClear,
    confidence,
    isConfidenceMet,
    canIssueSignal,
    waitReason,
  };
}
