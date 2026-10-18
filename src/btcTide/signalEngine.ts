import {
  SecondBin,
  OrderBookDepth,
  PerpPositioning,
  BtcFeedStatus,
  WaveformEventLabel,
} from './types';
import { buildContinuousSecondSeries, detectWaveformEvents } from './useBtcTideStore';
import { BtcTideTradeRecord } from '../server/btcTideSignalDatabase';

export interface SignalComponentScore {
  id:
    | 'delta_flow'
    | 'cvd_divergence'
    | 'absorb_drive'
    | 'order_book_imbalance'
    | 'oi_price_direction'
    | 'funding_rate'
    | 'liquidations'
    | 'perp_basis';
  name: string;
  weight: number;
  score: number; // between -weight and +weight
  side: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  rawMetric: string;
  explanation: string;
}

export interface DecisionEngineResult {
  isSilent: boolean;
  secondsCollected: number;
  silenceRemainingSec: number;
  totalScore: number; // -100 to +100
  bullishScore: number; // 0 to 100
  bearishScore: number; // 0 to 100
  confidence: number; // 0 to 100
  lead: number; // confidence lead over opposite side
  favoredSide: 'LONG' | 'SHORT' | 'NEUTRAL';
  components: SignalComponentScore[];
  absorbDriveScore: number;
  absorbDriveAgrees: boolean;
  canFire: boolean;
  cooldownRemainingSec: number;
  waitReason: string;
}

const REQUIRED_SILENCE_SECONDS = 180; // 3 minutes of live data
const COOLDOWN_DURATION_MS = 30 * 60 * 1000; // 30 minutes cooldown
const TRADE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes expiry

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Computes 90-second True Range (ATR) from real per-second bins.
 */
export function computeAtr90s(bins: SecondBin[], currentPrice: number): number {
  if (bins.length < 5) return Math.max(15, currentPrice * 0.0003);

  const latestSec = bins[bins.length - 1].sec;
  const start90 = latestSec - 89;
  let trSum = 0;
  let count = 0;
  let prevClose = bins[0].openPrice;

  let swingHigh = currentPrice;
  let swingLow = currentPrice;

  for (let i = 0; i < bins.length; i++) {
    const b = bins[i];
    if (b.sec >= start90) {
      const tr = Math.max(
        b.highPrice - b.lowPrice,
        Math.abs(b.highPrice - prevClose),
        Math.abs(b.lowPrice - prevClose)
      );
      trSum += tr;
      count++;
      if (b.highPrice > swingHigh) swingHigh = b.highPrice;
      if (b.lowPrice < swingLow) swingLow = b.lowPrice;
    }
    prevClose = b.lastPrice;
  }

  const avgTr = count > 0 ? trSum / count : 1;
  const swingSpan = swingHigh - swingLow;

  // Real dollar volatility measure scaled for BTC/USDT (minimum $12, clamped realistically)
  return Math.max(12, avgTr * 4.2, swingSpan * 0.32, currentPrice * 0.00025);
}

/**
 * Evaluates the 8 weighted components scoring from -100 to +100
 */
export function evaluateDecisionEngine(
  secondBins: SecondBin[],
  depth: OrderBookDepth,
  perp: PerpPositioning,
  currentPrice: number | null,
  status: BtcFeedStatus,
  lastSignalTime: number | null,
  hasActiveTrade: boolean
): DecisionEngineResult {
  const secondsCollected = secondBins.length;
  const isSilent = secondsCollected < REQUIRED_SILENCE_SECONDS;
  const silenceRemainingSec = Math.max(0, REQUIRED_SILENCE_SECONDS - secondsCollected);

  const now = Date.now();
  const cooldownRemainingSec = lastSignalTime
    ? Math.max(0, Math.ceil((lastSignalTime + COOLDOWN_DURATION_MS - now) / 1000))
    : 0;

  if (isSilent || currentPrice === null || status !== 'LIVE') {
    const waitMsg =
      status !== 'LIVE'
        ? `Feed ${status} · Engine paused`
        : `Silent: Collecting live data (${secondsCollected}/${REQUIRED_SILENCE_SECONDS}s)`;

    return {
      isSilent,
      secondsCollected,
      silenceRemainingSec,
      totalScore: 0,
      bullishScore: 0,
      bearishScore: 0,
      confidence: 0,
      lead: 0,
      favoredSide: 'NEUTRAL',
      components: [],
      absorbDriveScore: 0,
      absorbDriveAgrees: false,
      canFire: false,
      cooldownRemainingSec,
      waitReason: waitMsg,
    };
  }

  const latestSec = secondBins[secondBins.length - 1].sec;
  const continuous = buildContinuousSecondSeries(secondBins, 180);
  const { events: waveEvents } = detectWaveformEvents(continuous);

  // -------------------------------------------------------------
  // 1. Delta Flow (Weight: 20) - 60s Net Delta Flow
  // -------------------------------------------------------------
  const start60s = latestSec - 59;
  let buy60 = 0;
  let sell60 = 0;
  for (let i = secondBins.length - 1; i >= 0; i--) {
    const b = secondBins[i];
    if (b.sec < start60s) break;
    buy60 += b.buyVol;
    sell60 += b.sellVol;
  }
  const total60 = buy60 + sell60;
  const netDelta60 = buy60 - sell60;
  const deltaRatio = total60 > 0 ? netDelta60 / total60 : 0;
  const deltaScore = Number(clamp(deltaRatio * 20, -20, 20).toFixed(1));

  const compDelta: SignalComponentScore = {
    id: 'delta_flow',
    name: 'Delta Flow (60s)',
    weight: 20,
    score: deltaScore,
    side: deltaScore > 0 ? 'BULLISH' : deltaScore < 0 ? 'BEARISH' : 'NEUTRAL',
    rawMetric: `${netDelta60 >= 0 ? '+' : ''}${netDelta60.toFixed(2)} ₿ (${(
      (buy60 / Math.max(0.001, total60)) *
      100
    ).toFixed(0)}% Buy)`,
    explanation: 'Aggressive taker market buy vs market sell delta over the last 60 seconds',
  };

  // -------------------------------------------------------------
  // 2. CVD vs Price Divergence (Weight: 20) - 3m Window
  // -------------------------------------------------------------
  let cvdScore = 0;
  let cvdMetric = 'Balanced';
  let cvdExpl = 'Price and CVD moving in harmony';

  if (continuous.length >= 30) {
    const pStart = continuous[0].lastPrice;
    const pEnd = continuous[continuous.length - 1].lastPrice;
    const pDelta = pEnd - pStart;

    let cvdStart = 0;
    let cvdEnd = 0;
    let running = 0;
    for (let i = 0; i < continuous.length; i++) {
      running += continuous[i].buyVol - continuous[i].sellVol;
      if (i === 10) cvdStart = running;
      if (i === continuous.length - 1) cvdEnd = running;
    }
    const cvdDelta = cvdEnd - cvdStart;

    // Bullish Divergence: Price flat or dropping while CVD is surging up
    if (pDelta <= 1.0 && cvdDelta > 0.6) {
      cvdScore = 20;
      cvdMetric = 'Bullish Absorption Divergence';
      cvdExpl = 'Buyers aggressively absorbing ask liquidity without price breaking down';
    } else if (pDelta >= -1.0 && cvdDelta < -0.6) {
      cvdScore = -20;
      cvdMetric = 'Bearish Distribution Divergence';
      cvdExpl = 'Sellers aggressively absorbing bids without price breaking up';
    } else if (pDelta > 5.0 && cvdDelta > 0.4) {
      cvdScore = 15;
      cvdMetric = 'Strong Bullish CVD Alignment';
      cvdExpl = 'Both price and cumulative volume delta driving upward together';
    } else if (pDelta < -5.0 && cvdDelta < -0.4) {
      cvdScore = -15;
      cvdMetric = 'Strong Bearish CVD Alignment';
      cvdExpl = 'Both price and cumulative volume delta driving downward together';
    } else {
      const normRatio = clamp(cvdDelta / 1.5, -1, 1);
      cvdScore = Number((normRatio * 10).toFixed(1));
      cvdMetric = `CVD Delta: ${cvdDelta >= 0 ? '+' : ''}${cvdDelta.toFixed(2)} ₿`;
    }
  }

  const compCvd: SignalComponentScore = {
    id: 'cvd_divergence',
    name: 'CVD Divergence (3m)',
    weight: 20,
    score: cvdScore,
    side: cvdScore > 0 ? 'BULLISH' : cvdScore < 0 ? 'BEARISH' : 'NEUTRAL',
    rawMetric: cvdMetric,
    explanation: cvdExpl,
  };

  // -------------------------------------------------------------
  // 3. Absorb / Drive Waveform Events (Weight: 25)
  // -------------------------------------------------------------
  let absorbDriveScore = 0;
  let adMetric = 'No Recent Events';
  let adExpl = 'No heavy 6-second absorption or drive cluster in the last 60s';

  const recentEvents = waveEvents.filter((e) => latestSec - e.sec <= 60);
  if (recentEvents.length > 0) {
    const lastEvent = recentEvents[recentEvents.length - 1];
    if (lastEvent.type === 'DRIVE') {
      if (lastEvent.side === 'BUY') {
        absorbDriveScore = 25;
        adMetric = `BUY DRIVE (${lastEvent.netVolBtc.toFixed(2)} ₿)`;
        adExpl = 'Aggressive buyers driving price forcefully upward through liquidity';
      } else {
        absorbDriveScore = -25;
        adMetric = `SELL DRIVE (${lastEvent.netVolBtc.toFixed(2)} ₿)`;
        adExpl = 'Aggressive sellers driving price forcefully downward through liquidity';
      }
    } else if (lastEvent.type === 'ABSORB') {
      if (lastEvent.side === 'SELL') {
        // Heavy selling absorbed -> Bullish wall
        absorbDriveScore = 20;
        adMetric = `SELL ABSORB (${lastEvent.netVolBtc.toFixed(2)} ₿)`;
        adExpl = 'Heavy market sell orders swallowed by passive limit buy wall';
      } else {
        // Heavy buying absorbed -> Bearish wall
        absorbDriveScore = -20;
        adMetric = `BUY ABSORB (${lastEvent.netVolBtc.toFixed(2)} ₿)`;
        adExpl = 'Heavy market buy orders blocked by passive limit sell wall';
      }
    }
  }

  const compAbsorbDrive: SignalComponentScore = {
    id: 'absorb_drive',
    name: 'Absorb / Drive (60s)',
    weight: 25,
    score: absorbDriveScore,
    side: absorbDriveScore > 0 ? 'BULLISH' : absorbDriveScore < 0 ? 'BEARISH' : 'NEUTRAL',
    rawMetric: adMetric,
    explanation: adExpl,
  };

  // -------------------------------------------------------------
  // 4. Order Book Imbalance (Weight: 10) - Top 8 Levels
  // -------------------------------------------------------------
  const rawImbalance = depth.imbalancePct ?? 0;
  const obScore = Number(clamp((rawImbalance / 100) * 10, -10, 10).toFixed(1));

  const compOb: SignalComponentScore = {
    id: 'order_book_imbalance',
    name: 'Order Book Depth (L2)',
    weight: 10,
    score: obScore,
    side: obScore > 0 ? 'BULLISH' : obScore < 0 ? 'BEARISH' : 'NEUTRAL',
    rawMetric: `${rawImbalance >= 0 ? '+' : ''}${rawImbalance.toFixed(1)}% ${
      rawImbalance >= 0 ? 'Bid Skew' : 'Ask Skew'
    }`,
    explanation: 'Bid vs Ask liquidity distribution across the top 8 book levels',
  };

  // -------------------------------------------------------------
  // 5. OI + Price Direction (Weight: 10)
  // -------------------------------------------------------------
  let oiScore = 0;
  let oiMetric = '--';
  let oiExpl = 'Open interest and price relationship';

  const oiChange = perp.oiChange1h ?? 0;
  const priceMove1h =
    secondBins.length > 0 && secondBins[0].lastPrice > 0
      ? currentPrice - secondBins[0].lastPrice
      : 0;

  if (Math.abs(oiChange) >= 0.1) {
    if (priceMove1h >= 0 && oiChange > 0) {
      oiScore = 10;
      oiMetric = `+${oiChange.toFixed(1)} ₿ (Price Up)`;
      oiExpl = 'New long positions opening with rising price';
    } else if (priceMove1h < 0 && oiChange > 0) {
      oiScore = -10;
      oiMetric = `+${oiChange.toFixed(1)} ₿ (Price Down)`;
      oiExpl = 'New short positions opening with falling price';
    } else if (priceMove1h >= 0 && oiChange < 0) {
      oiScore = 5;
      oiMetric = `${oiChange.toFixed(1)} ₿ (Short Covering)`;
      oiExpl = 'Open interest closing on rally (short covering)';
    } else {
      oiScore = -5;
      oiMetric = `${oiChange.toFixed(1)} ₿ (Long Unwinding)`;
      oiExpl = 'Open interest closing on drop (long unwinding)';
    }
  } else {
    oiMetric = `${oiChange >= 0 ? '+' : ''}${oiChange.toFixed(1)} ₿ (Neutral)`;
  }

  const compOi: SignalComponentScore = {
    id: 'oi_price_direction',
    name: 'Open Interest & Price (1h)',
    weight: 10,
    score: oiScore,
    side: oiScore > 0 ? 'BULLISH' : oiScore < 0 ? 'BEARISH' : 'NEUTRAL',
    rawMetric: oiMetric,
    explanation: oiExpl,
  };

  // -------------------------------------------------------------
  // 6. Funding Rate (Weight: 5)
  // -------------------------------------------------------------
  let fundingScore = 0;
  const fr = perp.fundingRate ?? 0;
  if (fr < -0.00005) {
    // Negative funding: shorts pay longs (contrarian bullish)
    fundingScore = 5;
  } else if (fr > 0.0003) {
    // Highly positive: overcrowded longs
    fundingScore = -5;
  } else {
    // Linear clamp between -5 and +5
    fundingScore = Number(clamp(-((fr - 0.0001) / 0.0002) * 5, -5, 5).toFixed(1));
  }

  const compFunding: SignalComponentScore = {
    id: 'funding_rate',
    name: 'Funding Rate (8h)',
    weight: 5,
    score: fundingScore,
    side: fundingScore > 0 ? 'BULLISH' : fundingScore < 0 ? 'BEARISH' : 'NEUTRAL',
    rawMetric: `${(fr * 100).toFixed(4)}%`,
    explanation: 'Perpetual swap funding rate sentiment bias',
  };

  // -------------------------------------------------------------
  // 7. Liquidations (Weight: 5) - 5m Force Orders
  // -------------------------------------------------------------
  let liqScore = 0;
  const shortLiq = perp.shortLiq5mUsd;
  const longLiq = perp.longLiq5mUsd;
  const totalLiq = shortLiq + longLiq;

  if (totalLiq > 1000) {
    const netLiq = (shortLiq - longLiq) / totalLiq;
    liqScore = Number(clamp(netLiq * 5, -5, 5).toFixed(1));
  }

  const compLiq: SignalComponentScore = {
    id: 'liquidations',
    name: 'Liquidations (5m)',
    weight: 5,
    score: liqScore,
    side: liqScore > 0 ? 'BULLISH' : liqScore < 0 ? 'BEARISH' : 'NEUTRAL',
    rawMetric: `L: $${(longLiq / 1000).toFixed(0)}K / S: $${(shortLiq / 1000).toFixed(0)}K`,
    explanation: 'Force liquidation volume asymmetry fueling directional momentum',
  };

  // -------------------------------------------------------------
  // 8. Perp Basis (Weight: 5)
  // -------------------------------------------------------------
  const basisBps = perp.basisBps ?? 0;
  const basisScore = Number(clamp((basisBps / 2.5) * 5, -5, 5).toFixed(1));

  const compBasis: SignalComponentScore = {
    id: 'perp_basis',
    name: 'Perp vs Spot Basis',
    weight: 5,
    score: basisScore,
    side: basisScore > 0 ? 'BULLISH' : basisScore < 0 ? 'BEARISH' : 'NEUTRAL',
    rawMetric: `${basisBps >= 0 ? '+' : ''}${basisBps.toFixed(1)} bps`,
    explanation: 'Binance futures mark price premium or discount against spot',
  };

  // Sum all components
  const components: SignalComponentScore[] = [
    compDelta,
    compCvd,
    compAbsorbDrive,
    compOb,
    compOi,
    compFunding,
    compLiq,
    compBasis,
  ];

  let bullishScore = 0;
  let bearishScore = 0;
  let totalScore = 0;

  for (const c of components) {
    totalScore += c.score;
    if (c.score > 0) bullishScore += c.score;
    else if (c.score < 0) bearishScore += Math.abs(c.score);
  }

  totalScore = Number(clamp(totalScore, -100, 100).toFixed(1));
  bullishScore = Number(Math.min(100, bullishScore).toFixed(1));
  bearishScore = Number(Math.min(100, bearishScore).toFixed(1));

  const favoredSide: 'LONG' | 'SHORT' | 'NEUTRAL' =
    totalScore > 0 ? 'LONG' : totalScore < 0 ? 'SHORT' : 'NEUTRAL';

  const confidence = favoredSide === 'LONG' ? bullishScore : favoredSide === 'SHORT' ? bearishScore : 0;
  const lead =
    favoredSide === 'LONG'
      ? Math.max(0, bullishScore - bearishScore)
      : favoredSide === 'SHORT'
      ? Math.max(0, bearishScore - bullishScore)
      : 0;

  // Absorb / Drive component MUST agree with the side:
  // For LONG: absorbDriveScore > 0
  // For SHORT: absorbDriveScore < 0
  const absorbDriveAgrees =
    (favoredSide === 'LONG' && absorbDriveScore > 0) ||
    (favoredSide === 'SHORT' && absorbDriveScore < 0);

  // Firing rule:
  // confidence >= 68 AND lead >= 22 AND absorbDriveAgrees AND cooldown expired AND no active trade
  const meetsCriteria = confidence >= 68 && lead >= 22 && absorbDriveAgrees;
  const canFire = meetsCriteria && cooldownRemainingSec === 0 && !hasActiveTrade;

  let waitReason = 'Awaiting high-probability setup';
  if (hasActiveTrade) {
    waitReason = 'Active trade in progress (One trade at a time)';
  } else if (cooldownRemainingSec > 0) {
    waitReason = `Cooldown active (${Math.floor(cooldownRemainingSec / 60)}m ${
      cooldownRemainingSec % 60
    }s remaining)`;
  } else if (!meetsCriteria) {
    if (confidence < 68) waitReason = `Confidence ${confidence.toFixed(0)} < 68 required`;
    else if (lead < 22) waitReason = `Lead ${lead.toFixed(0)} < 22 required`;
    else if (!absorbDriveAgrees) waitReason = 'Absorb/Drive component must agree with side';
  } else {
    waitReason = `READY TO FIRE ${favoredSide} (Confidence: ${confidence.toFixed(0)}%, Lead: ${lead.toFixed(0)}%)`;
  }

  return {
    isSilent: false,
    secondsCollected,
    silenceRemainingSec: 0,
    totalScore,
    bullishScore,
    bearishScore,
    confidence,
    lead,
    favoredSide,
    components,
    absorbDriveScore,
    absorbDriveAgrees,
    canFire,
    cooldownRemainingSec,
    waitReason,
  };
}

/**
 * Creates a new Trade Plan computed strictly from real prices.
 */
export function createTradePlan(
  side: 'LONG' | 'SHORT',
  entryPrice: number,
  secondBins: SecondBin[],
  confidence: number,
  lead: number,
  triggerReason: string
): BtcTideTradeRecord {
  const atr = computeAtr90s(secondBins, entryPrice);
  const latestSec = secondBins[secondBins.length - 1].sec;
  const start90 = latestSec - 89;

  let swingHigh90s = entryPrice;
  let swingLow90s = entryPrice;

  for (let i = 0; i < secondBins.length; i++) {
    const b = secondBins[i];
    if (b.sec >= start90) {
      if (b.highPrice > swingHigh90s) swingHigh90s = b.highPrice;
      if (b.lowPrice < swingLow90s) swingLow90s = b.lowPrice;
    }
  }

  let slPrice = 0;
  let oneR = 0;
  let tp1Price = 0;
  let tp2Price = 0;
  let tp3Price = 0;

  if (side === 'LONG') {
    // SL = beyond last 90s swing low - 0.4 ATR, clamped to [1.2, 3.2] ATR
    const rawSL = swingLow90s - 0.4 * atr;
    const rawDist = entryPrice - rawSL;
    const clampedDist = clamp(rawDist, 1.2 * atr, 3.2 * atr);
    slPrice = Number((entryPrice - clampedDist).toFixed(2));
    oneR = Number((entryPrice - slPrice).toFixed(2));

    // TP1 = 1R (50%), TP2 = 2R (25%), TP3 = 3R (25%)
    tp1Price = Number((entryPrice + 1.0 * oneR).toFixed(2));
    tp2Price = Number((entryPrice + 2.0 * oneR).toFixed(2));
    tp3Price = Number((entryPrice + 3.0 * oneR).toFixed(2));
  } else {
    // SL = beyond last 90s swing high + 0.4 ATR, clamped to [1.2, 3.2] ATR
    const rawSL = swingHigh90s + 0.4 * atr;
    const rawDist = rawSL - entryPrice;
    const clampedDist = clamp(rawDist, 1.2 * atr, 3.2 * atr);
    slPrice = Number((entryPrice + clampedDist).toFixed(2));
    oneR = Number((slPrice - entryPrice).toFixed(2));

    // TP1 = 1R (50%), TP2 = 2R (25%), TP3 = 3R (25%)
    tp1Price = Number((entryPrice - 1.0 * oneR).toFixed(2));
    tp2Price = Number((entryPrice - 2.0 * oneR).toFixed(2));
    tp3Price = Number((entryPrice - 3.0 * oneR).toFixed(2));
  }

  const now = Date.now();
  const trade: BtcTideTradeRecord = {
    id: `btctide_${now}_${side.toLowerCase()}`,
    side,
    entryTime: now,
    entryPrice,
    initialSlPrice: slPrice,
    slPrice,
    tp1Price,
    tp2Price,
    tp3Price,
    oneR,
    currentR: 0,
    pnlPercent: 0,
    tp1Hit: false,
    tp2Hit: false,
    tp3Hit: false,
    beMoved: false,
    status: 'ACTIVE',
    outcome: null,
    realizedR: null,
    closedAt: null,
    closePrice: null,
    expiryTime: now + TRADE_EXPIRY_MS,
    confidence,
    lead,
    triggerReason,
  };

  return trade;
}

/**
 * Evaluates an active trade against current real price on every tick.
 * Handles SL, TP1 (+ BE stop move), TP2, TP3, Expiry.
 */
export function evaluateActiveTradeTick(
  trade: BtcTideTradeRecord,
  currentPrice: number,
  now: number = Date.now()
): { updatedTrade: BtcTideTradeRecord; closed: boolean } {
  const isLong = trade.side === 'LONG';
  const oneR = trade.oneR;

  // Live P&L in R
  const currentR = Number(
    ((isLong ? currentPrice - trade.entryPrice : trade.entryPrice - currentPrice) / oneR).toFixed(2)
  );
  const pnlPercent = Number(
    ((isLong ? (currentPrice - trade.entryPrice) / trade.entryPrice : (trade.entryPrice - currentPrice) / trade.entryPrice) * 100).toFixed(2)
  );

  const updated: BtcTideTradeRecord = {
    ...trade,
    currentR,
    pnlPercent,
  };

  // 1. Check Expiry (15 minutes)
  if (now >= trade.expiryTime) {
    let realizedR = currentR;
    if (trade.tp2Hit) {
      realizedR = Number((0.5 * 1.0 + 0.25 * 2.0 + 0.25 * currentR).toFixed(2));
    } else if (trade.tp1Hit) {
      realizedR = Number((0.5 * 1.0 + 0.5 * Math.max(0, currentR)).toFixed(2));
    }
    updated.status = 'CLOSED';
    updated.outcome = 'EXPIRED';
    updated.realizedR = realizedR;
    updated.closedAt = now;
    updated.closePrice = currentPrice;
    return { updatedTrade: updated, closed: true };
  }

  // 2. Check LONG targets and stops
  if (isLong) {
    // Check TP3 (all 3 targets hit: 50% @ 1R, 25% @ 2R, 25% @ 3R -> +1.75R)
    if (currentPrice >= trade.tp3Price) {
      updated.tp1Hit = true;
      updated.tp2Hit = true;
      updated.tp3Hit = true;
      updated.status = 'CLOSED';
      updated.outcome = 'TP3';
      updated.realizedR = 1.75; // 0.50*1 + 0.25*2 + 0.25*3
      updated.closedAt = now;
      updated.closePrice = currentPrice;
      return { updatedTrade: updated, closed: true };
    }

    // Check TP2 (25% scaled out at 2R)
    if (!trade.tp2Hit && currentPrice >= trade.tp2Price) {
      updated.tp1Hit = true;
      updated.tp2Hit = true;
      updated.status = 'TP2_HIT';
    }

    // Check TP1 (50% scaled out at 1R, move stop to breakeven)
    if (!trade.tp1Hit && currentPrice >= trade.tp1Price) {
      updated.tp1Hit = true;
      updated.beMoved = true;
      updated.slPrice = trade.entryPrice; // Stop moved to breakeven!
      updated.status = 'TP1_HIT_BE_ACTIVE';
    }

    // Check Stop Loss
    if (currentPrice <= updated.slPrice) {
      updated.status = 'CLOSED';
      updated.closedAt = now;
      updated.closePrice = currentPrice;

      if (updated.beMoved) {
        if (updated.tp2Hit) {
          // Hit TP1 & TP2, then stopped out at BE
          updated.outcome = 'TP2';
          updated.realizedR = 1.0; // 0.50*1 + 0.25*2 + 0.25*0
        } else {
          // Hit TP1, stopped out at BE
          updated.outcome = 'TP1+BE';
          updated.realizedR = 0.5; // 0.50*1 + 0.50*0
        }
      } else {
        // Hit initial SL before TP1
        updated.outcome = 'SL';
        updated.realizedR = -1.0;
      }
      return { updatedTrade: updated, closed: true };
    }
  } else {
    // 3. Check SHORT targets and stops
    // Check TP3 (all 3 targets hit)
    if (currentPrice <= trade.tp3Price) {
      updated.tp1Hit = true;
      updated.tp2Hit = true;
      updated.tp3Hit = true;
      updated.status = 'CLOSED';
      updated.outcome = 'TP3';
      updated.realizedR = 1.75;
      updated.closedAt = now;
      updated.closePrice = currentPrice;
      return { updatedTrade: updated, closed: true };
    }

    // Check TP2
    if (!trade.tp2Hit && currentPrice <= trade.tp2Price) {
      updated.tp1Hit = true;
      updated.tp2Hit = true;
      updated.status = 'TP2_HIT';
    }

    // Check TP1 (move stop to breakeven)
    if (!trade.tp1Hit && currentPrice <= trade.tp1Price) {
      updated.tp1Hit = true;
      updated.beMoved = true;
      updated.slPrice = trade.entryPrice;
      updated.status = 'TP1_HIT_BE_ACTIVE';
    }

    // Check Stop Loss
    if (currentPrice >= updated.slPrice) {
      updated.status = 'CLOSED';
      updated.closedAt = now;
      updated.closePrice = currentPrice;

      if (updated.beMoved) {
        if (updated.tp2Hit) {
          updated.outcome = 'TP2';
          updated.realizedR = 1.0;
        } else {
          updated.outcome = 'TP1+BE';
          updated.realizedR = 0.5;
        }
      } else {
        updated.outcome = 'SL';
        updated.realizedR = -1.0;
      }
      return { updatedTrade: updated, closed: true };
    }
  }

  return { updatedTrade: updated, closed: false };
}
