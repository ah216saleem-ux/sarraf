import {
  SecondBin,
  OrderBookDepth,
  PerpPositioning,
  BtcFeedStatus,
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
  baseWeight: number;
  weight: number; // Re-normalised weight (0 if excluded)
  rawScore: number; // Unnormalised score in [-baseWeight, +baseWeight]
  score: number; // Re-normalised score in [-weight, +weight]
  side: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  rawMetric: string;
  explanation: string;
  excluded?: boolean;
  excludeReason?: string;
}

export interface ExcludedSignalComponent {
  id: SignalComponentScore['id'];
  name: string;
  baseWeight: number;
  reason: string;
}

export interface DecisionEngineResult {
  isSilent: boolean;
  isSpotDotGreen?: boolean;
  spotAgeMs?: number;
  secondsCollected: number;
  silenceRemainingSec: number;
  totalScore: number; // -100 to +100
  bullishScore: number; // 0 to 100
  bearishScore: number; // 0 to 100
  confidence: number; // 0 to 100
  lead: number; // confidence lead over opposite side
  favoredSide: 'LONG' | 'SHORT' | 'NEUTRAL';
  components: SignalComponentScore[];
  excludedComponents?: ExcludedSignalComponent[];
  excludedWeightSum?: number;
  activeComponentsCount?: number;
  isLimitedData?: boolean;
  renormalisedFactor?: number;
  absorbDriveScore: number;
  absorbDriveAgrees: boolean;
  canFire: boolean;
  cooldownRemainingSec: number;
  waitReason: string;
}

const REQUIRED_SILENCE_SECONDS = 180; // 3 minutes of live data
const SPOT_GREEN_MAX_AGE_MS = 3000; // SPOT dot is green only when fresh (<3s)
export const COOLDOWN_DURATION_MS = 90 * 60 * 1000; // 1.5 hours (1h-2h BTC setup cooldown)
export const TRADE_EXPIRY_MS = 4 * 60 * 60 * 1000; // 4 hours expiry for 1H ATR targets

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Computes 1H ATR (Average True Range) for BTC/USD.
 * Uses real 1H kline ATR when provided by the backend poller, or estimates 1H ATR from live bins and price.
 */
export function computeAtr1h(
  bins: SecondBin[],
  currentPrice: number,
  explicitAtr1h?: number | null
): number {
  if (explicitAtr1h && Number.isFinite(explicitAtr1h) && explicitAtr1h > 0) {
    return Number(clamp(explicitAtr1h, 300, 3000).toFixed(2));
  }

  const baseline1hAtr = Math.max(350, currentPrice * 0.00625); // e.g. $500 at $80,000 BTC
  if (bins.length < 5) return Number(baseline1hAtr.toFixed(2));

  const latestSec = bins[bins.length - 1].sec;
  const startWindow = latestSec - 179;
  let trSum = 0;
  let count = 0;
  let prevClose = bins[0].openPrice;

  for (let i = 0; i < bins.length; i++) {
    const b = bins[i];
    if (b.sec >= startWindow) {
      const tr = Math.max(
        b.highPrice - b.lowPrice,
        Math.abs(b.highPrice - prevClose),
        Math.abs(b.lowPrice - prevClose)
      );
      trSum += tr;
      count++;
    }
    prevClose = b.lastPrice;
  }

  const avgTr1s = count > 0 ? trSum / count : 8;
  // Scale 1s volatility to 1H horizon (sqrt(3600) = 60) and clamp to realistic 1H BTC ATR bounds
  const scaled1h = avgTr1s * 60;
  const min1hAtr = Math.max(350, currentPrice * 0.0045);
  const max1hAtr = Math.max(1200, currentPrice * 0.018);

  return Number(clamp(Math.max(baseline1hAtr * 0.85, scaled1h), min1hAtr, max1hAtr).toFixed(2));
}

export function computeAtr90s(
  bins: SecondBin[],
  currentPrice: number,
  explicitAtr1h?: number | null
): number {
  return computeAtr1h(bins, currentPrice, explicitAtr1h);
}

/**
 * Evaluates the 8 weighted components scoring from -100 to +100.
 * - Silent for the first 3 minutes (180s) of live data AND whenever the SPOT dot is not green (spotAgeMs >= 3000 or status !== 'LIVE').
 * - When a PERPS field is unavailable (null, not zero), its component is excluded and the remaining weights are re-normalised to 100.
 */
export function evaluateDecisionEngine(
  secondBins: SecondBin[],
  depth: OrderBookDepth,
  perp: PerpPositioning,
  currentPrice: number | null,
  status: BtcFeedStatus,
  lastSignalTime: number | null,
  hasActiveTrade: boolean,
  spotAgeMs: number = 0,
  spotReconcileMismatch: boolean = false
): DecisionEngineResult {
  const secondsCollected = secondBins.length;
  const isWarmupSilent = secondsCollected < REQUIRED_SILENCE_SECONDS;
  const isSpotDotGreen =
    status === 'LIVE' && spotAgeMs < SPOT_GREEN_MAX_AGE_MS && !spotReconcileMismatch;
  const isSilent = isWarmupSilent || !isSpotDotGreen || currentPrice === null;
  const silenceRemainingSec = Math.max(0, REQUIRED_SILENCE_SECONDS - secondsCollected);

  const now = Date.now();
  const cooldownRemainingSec = lastSignalTime
    ? Math.max(0, Math.ceil((lastSignalTime + COOLDOWN_DURATION_MS - now) / 1000))
    : 0;

  const latestSec = secondBins.length > 0 ? secondBins[secondBins.length - 1].sec : Math.floor(now / 1000);
  const continuous = secondBins.length > 0 ? buildContinuousSecondSeries(secondBins, 180) : [];
  const { events: waveEvents } = continuous.length >= 6 ? detectWaveformEvents(continuous) : { events: [] };

  // -------------------------------------------------------------
  // 1. Delta Flow (Base Weight: 20) - 60s Net Delta Flow
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
  const deltaRawScore = Number(clamp(deltaRatio * 20, -20, 20).toFixed(1));

  const compDelta: SignalComponentScore = {
    id: 'delta_flow',
    name: 'Delta Flow (60s)',
    baseWeight: 20,
    weight: 20,
    rawScore: deltaRawScore,
    score: deltaRawScore,
    side: deltaRawScore > 0 ? 'BULLISH' : deltaRawScore < 0 ? 'BEARISH' : 'NEUTRAL',
    rawMetric:
      total60 > 0
        ? `${netDelta60 >= 0 ? '+' : ''}${netDelta60.toFixed(2)} BTC (${(
            (buy60 / Math.max(0.001, total60)) *
            100
          ).toFixed(0)}% Buy)`
        : '0.00 BTC',
    explanation: 'Aggressive taker market buy vs market sell delta over the last 60 seconds',
    excluded: false,
  };

  // -------------------------------------------------------------
  // 2. CVD vs Price Divergence (Base Weight: 20) - 3m Window
  // -------------------------------------------------------------
  let cvdRawScore = 0;
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

    if (pDelta <= 1.0 && cvdDelta > 0.6) {
      cvdRawScore = 20;
      cvdMetric = 'Bullish Absorption Divergence';
      cvdExpl = 'Buyers aggressively absorbing ask liquidity without price breaking down';
    } else if (pDelta >= -1.0 && cvdDelta < -0.6) {
      cvdRawScore = -20;
      cvdMetric = 'Bearish Distribution Divergence';
      cvdExpl = 'Sellers aggressively absorbing bids without price breaking up';
    } else if (pDelta > 5.0 && cvdDelta > 0.4) {
      cvdRawScore = 15;
      cvdMetric = 'Strong Bullish CVD Alignment';
      cvdExpl = 'Both price and cumulative volume delta driving upward together';
    } else if (pDelta < -5.0 && cvdDelta < -0.4) {
      cvdRawScore = -15;
      cvdMetric = 'Strong Bearish CVD Alignment';
      cvdExpl = 'Both price and cumulative volume delta driving downward together';
    } else {
      const normRatio = clamp(cvdDelta / 1.5, -1, 1);
      cvdRawScore = Number((normRatio * 10).toFixed(1));
      cvdMetric = `CVD Delta: ${cvdDelta >= 0 ? '+' : ''}${cvdDelta.toFixed(2)} BTC`;
    }
  }

  const compCvd: SignalComponentScore = {
    id: 'cvd_divergence',
    name: 'CVD Divergence (3m)',
    baseWeight: 20,
    weight: 20,
    rawScore: cvdRawScore,
    score: cvdRawScore,
    side: cvdRawScore > 0 ? 'BULLISH' : cvdRawScore < 0 ? 'BEARISH' : 'NEUTRAL',
    rawMetric: cvdMetric,
    explanation: cvdExpl,
    excluded: false,
  };

  // -------------------------------------------------------------
  // 3. Absorb / Drive Waveform Events (Base Weight: 25)
  // -------------------------------------------------------------
  let absorbDriveRawScore = 0;
  let adMetric = 'No Recent Events';
  let adExpl = 'No heavy 6-second absorption or drive cluster in the last 60s';

  const recentEvents = waveEvents.filter((e) => latestSec - e.sec <= 60);
  if (recentEvents.length > 0) {
    const lastEvent = recentEvents[recentEvents.length - 1];
    if (lastEvent.type === 'DRIVE') {
      if (lastEvent.side === 'BUY') {
        absorbDriveRawScore = 25;
        adMetric = `BUY DRIVE (${lastEvent.netVolBtc.toFixed(2)} BTC)`;
        adExpl = 'Aggressive buyers driving price forcefully upward through liquidity';
      } else {
        absorbDriveRawScore = -25;
        adMetric = `SELL DRIVE (${lastEvent.netVolBtc.toFixed(2)} BTC)`;
        adExpl = 'Aggressive sellers driving price forcefully downward through liquidity';
      }
    } else if (lastEvent.type === 'ABSORB') {
      if (lastEvent.side === 'SELL') {
        absorbDriveRawScore = 20;
        adMetric = `SELL ABSORB (${lastEvent.netVolBtc.toFixed(2)} BTC)`;
        adExpl = 'Heavy market sell orders swallowed by passive limit buy wall';
      } else {
        absorbDriveRawScore = -20;
        adMetric = `BUY ABSORB (${lastEvent.netVolBtc.toFixed(2)} BTC)`;
        adExpl = 'Heavy market buy orders blocked by passive limit sell wall';
      }
    }
  }

  const compAbsorbDrive: SignalComponentScore = {
    id: 'absorb_drive',
    name: 'Absorb / Drive (60s)',
    baseWeight: 25,
    weight: 25,
    rawScore: absorbDriveRawScore,
    score: absorbDriveRawScore,
    side: absorbDriveRawScore > 0 ? 'BULLISH' : absorbDriveRawScore < 0 ? 'BEARISH' : 'NEUTRAL',
    rawMetric: adMetric,
    explanation: adExpl,
    excluded: false,
  };

  // -------------------------------------------------------------
  // 4. Order Book Imbalance (Base Weight: 10) - Top 10 USD Notional
  // -------------------------------------------------------------
  const rawImbalance = depth.imbalancePct ?? 0;
  const obRawScore = Number(clamp((rawImbalance / 100) * 10, -10, 10).toFixed(1));

  const compOb: SignalComponentScore = {
    id: 'order_book_imbalance',
    name: 'Order Book Depth (L2)',
    baseWeight: 10,
    weight: 10,
    rawScore: obRawScore,
    score: obRawScore,
    side: obRawScore > 0 ? 'BULLISH' : obRawScore < 0 ? 'BEARISH' : 'NEUTRAL',
    rawMetric:
      depth.imbalancePct !== null
        ? `${rawImbalance >= 0 ? '+' : ''}${rawImbalance.toFixed(1)}% ${
            rawImbalance >= 0 ? 'Bid Skew' : 'Ask Skew'
          }`
        : '--',
    explanation: 'Bid vs Ask USD notional imbalance across top 10 book levels',
    excluded: false,
  };

  // -------------------------------------------------------------
  // 5. OI + Price Direction (Base Weight: 10) [PERPS Component]
  // Excluded when perp.openInterest === null OR perp.oiChange1h === null (unavailable, not zero)
  // -------------------------------------------------------------
  const isOiUnavailable =
    perp.openInterest === null ||
    perp.openInterest === undefined ||
    perp.oiChange1h === null ||
    perp.oiChange1h === undefined;

  let oiRawScore = 0;
  let oiMetric = '--';
  let oiExpl = 'Open interest and price relationship';
  let oiExcludeReason: string | undefined;

  if (isOiUnavailable) {
    oiExcludeReason = perp.oiHistoryStatus
      ? `OI 1h change unavailable (${perp.oiHistoryStatus})`
      : 'Open interest 1h change unavailable';
    oiMetric = perp.oiHistoryStatus || 'Unavailable (Excluded)';
    oiExpl = `${oiExcludeReason} — component excluded and weights re-normalised`;
  } else {
    const oiChange = perp.oiChange1h!;
    const priceMove1h =
      secondBins.length > 0 && secondBins[0].lastPrice > 0 && currentPrice !== null
        ? currentPrice - secondBins[0].lastPrice
        : 0;

    if (Math.abs(oiChange) >= 0.1) {
      if (priceMove1h >= 0 && oiChange > 0) {
        oiRawScore = 10;
        oiMetric = `+${oiChange.toFixed(1)} BTC (Price Up)`;
        oiExpl = 'New long positions opening with rising price';
      } else if (priceMove1h < 0 && oiChange > 0) {
        oiRawScore = -10;
        oiMetric = `+${oiChange.toFixed(1)} BTC (Price Down)`;
        oiExpl = 'New short positions opening with falling price';
      } else if (priceMove1h >= 0 && oiChange < 0) {
        oiRawScore = 5;
        oiMetric = `${oiChange.toFixed(1)} BTC (Short Covering)`;
        oiExpl = 'Open interest closing on rally (short covering)';
      } else {
        oiRawScore = -5;
        oiMetric = `${oiChange.toFixed(1)} BTC (Long Unwinding)`;
        oiExpl = 'Open interest closing on drop (long unwinding)';
      }
    } else {
      oiMetric = `${oiChange >= 0 ? '+' : ''}${oiChange.toFixed(1)} BTC (Neutral)`;
    }
  }

  const compOi: SignalComponentScore = {
    id: 'oi_price_direction',
    name: 'Open Interest & Price (1h)',
    baseWeight: 10,
    weight: isOiUnavailable ? 0 : 10,
    rawScore: oiRawScore,
    score: oiRawScore,
    side: oiRawScore > 0 ? 'BULLISH' : oiRawScore < 0 ? 'BEARISH' : 'NEUTRAL',
    rawMetric: oiMetric,
    explanation: oiExpl,
    excluded: isOiUnavailable,
    excludeReason: oiExcludeReason,
  };

  // -------------------------------------------------------------
  // 6. Funding Rate (Base Weight: 5) [PERPS Component]
  // Excluded when perp.fundingRate === null (unavailable, not zero)
  // -------------------------------------------------------------
  const isFundingUnavailable = perp.fundingRate === null || perp.fundingRate === undefined;
  let fundingRawScore = 0;
  let fundingMetric = '--';
  let fundingExpl = 'Perpetual swap funding rate sentiment bias';
  let fundingExcludeReason: string | undefined;

  if (isFundingUnavailable) {
    fundingExcludeReason = 'Funding rate unavailable';
    fundingMetric = 'Unavailable (Excluded)';
    fundingExpl = 'Funding rate unavailable — component excluded and weights re-normalised';
  } else {
    const fr = perp.fundingRate!;
    if (fr < -0.00005) {
      fundingRawScore = 5;
    } else if (fr > 0.0003) {
      fundingRawScore = -5;
    } else {
      fundingRawScore = Number(clamp(-((fr - 0.0001) / 0.0002) * 5, -5, 5).toFixed(1));
    }
    fundingMetric = `${(fr * 100).toFixed(4)}%`;
  }

  const compFunding: SignalComponentScore = {
    id: 'funding_rate',
    name: 'Funding Rate (8h)',
    baseWeight: 5,
    weight: isFundingUnavailable ? 0 : 5,
    rawScore: fundingRawScore,
    score: fundingRawScore,
    side: fundingRawScore > 0 ? 'BULLISH' : fundingRawScore < 0 ? 'BEARISH' : 'NEUTRAL',
    rawMetric: fundingMetric,
    explanation: fundingExpl,
    excluded: isFundingUnavailable,
    excludeReason: fundingExcludeReason,
  };

  // -------------------------------------------------------------
  // 7. Liquidations (Base Weight: 5) - 5m Force Orders [PERPS Component]
  // Excluded only when liquidation feed is unavailable (not when 5m total is 0)
  // -------------------------------------------------------------
  const isLiqUnavailable =
    perp.longLiq5mUsd === null ||
    perp.longLiq5mUsd === undefined ||
    perp.shortLiq5mUsd === null ||
    perp.shortLiq5mUsd === undefined ||
    perp.sources?.liquidations === '--' ||
    (perp.status === 'CONNECTING' && perp.updatedAt === 0);

  let liqRawScore = 0;
  let liqMetric = '--';
  let liqExpl = 'Force liquidation volume asymmetry fueling directional momentum';
  let liqExcludeReason: string | undefined;

  if (isLiqUnavailable) {
    liqExcludeReason = 'Liquidation feed unavailable';
    liqMetric = 'Unavailable (Excluded)';
    liqExpl = 'Liquidation feed unavailable — component excluded and weights re-normalised';
  } else {
    const shortLiq = perp.shortLiq5mUsd;
    const longLiq = perp.longLiq5mUsd;
    const totalLiq = shortLiq + longLiq;

    if (totalLiq > 1000) {
      const netLiq = (shortLiq - longLiq) / totalLiq;
      liqRawScore = Number(clamp(netLiq * 5, -5, 5).toFixed(1));
    }
    liqMetric = `L: $${(longLiq / 1000).toFixed(0)}K / S: $${(shortLiq / 1000).toFixed(0)}K`;
  }

  const compLiq: SignalComponentScore = {
    id: 'liquidations',
    name: 'Liquidations (5m)',
    baseWeight: 5,
    weight: isLiqUnavailable ? 0 : 5,
    rawScore: liqRawScore,
    score: liqRawScore,
    side: liqRawScore > 0 ? 'BULLISH' : liqRawScore < 0 ? 'BEARISH' : 'NEUTRAL',
    rawMetric: liqMetric,
    explanation: liqExpl,
    excluded: isLiqUnavailable,
    excludeReason: liqExcludeReason,
  };

  // -------------------------------------------------------------
  // 8. Perp Basis (Base Weight: 5) [PERPS Component]
  // Excluded when perp.basisBps === null or perp.markPrice === null (unavailable, not zero)
  // -------------------------------------------------------------
  const isBasisUnavailable =
    perp.basisBps === null ||
    perp.basisBps === undefined ||
    perp.markPrice === null ||
    perp.markPrice === undefined;

  let basisRawScore = 0;
  let basisMetric = '--';
  let basisExpl = 'Perpetual mark price premium or discount against spot';
  let basisExcludeReason: string | undefined;

  if (isBasisUnavailable) {
    basisExcludeReason = 'Perp basis / mark price unavailable';
    basisMetric = 'Unavailable (Excluded)';
    basisExpl = 'Perp basis unavailable — component excluded and weights re-normalised';
  } else {
    const basisBps = perp.basisBps!;
    basisRawScore = Number(clamp((basisBps / 2.5) * 5, -5, 5).toFixed(1));
    basisMetric = `${basisBps >= 0 ? '+' : ''}${basisBps.toFixed(1)} bps`;
  }

  const compBasis: SignalComponentScore = {
    id: 'perp_basis',
    name: 'Perp vs Spot Basis',
    baseWeight: 5,
    weight: isBasisUnavailable ? 0 : 5,
    rawScore: basisRawScore,
    score: basisRawScore,
    side: basisRawScore > 0 ? 'BULLISH' : basisRawScore < 0 ? 'BEARISH' : 'NEUTRAL',
    rawMetric: basisMetric,
    explanation: basisExpl,
    excluded: isBasisUnavailable,
    excludeReason: basisExcludeReason,
  };

  // -------------------------------------------------------------
  // Weight Re-Normalisation for Excluded PERPS Components
  // -------------------------------------------------------------
  const rawComponents: SignalComponentScore[] = [
    compDelta,
    compCvd,
    compAbsorbDrive,
    compOb,
    compOi,
    compFunding,
    compLiq,
    compBasis,
  ];

  const excludedComponents: ExcludedSignalComponent[] = [];
  let activeBaseWeightSum = 0;
  let excludedWeightSum = 0;

  for (const c of rawComponents) {
    if (c.excluded) {
      excludedComponents.push({
        id: c.id,
        name: c.name,
        baseWeight: c.baseWeight,
        reason: c.excludeReason || 'Field unavailable',
      });
      excludedWeightSum += c.baseWeight;
    } else {
      activeBaseWeightSum += c.baseWeight;
    }
  }

  const activeComponentsCount = rawComponents.length - excludedComponents.length;
  // Rule 5: If excluded component weight is more than 20, or fewer than 6 components are active,
  // do NOT fire and show "LIMITED DATA" instead of re-normalising.
  const isLimitedData = excludedWeightSum > 20 || activeComponentsCount < 6;
  const renormalisedFactor =
    !isLimitedData && activeBaseWeightSum > 0 ? 100 / activeBaseWeightSum : 1;

  const components: SignalComponentScore[] = rawComponents.map((c) => {
    if (c.excluded) {
      return {
        ...c,
        weight: 0,
        score: 0,
        side: 'NEUTRAL',
      };
    }
    const normWeight = Number((c.baseWeight * renormalisedFactor).toFixed(1));
    const normScore = Number(
      clamp(c.rawScore * renormalisedFactor, -normWeight, normWeight).toFixed(1)
    );
    return {
      ...c,
      weight: normWeight,
      score: normScore,
      side: normScore > 0 ? 'BULLISH' : normScore < 0 ? 'BEARISH' : 'NEUTRAL',
    };
  });

  // If engine is silent (first 3 min of live data OR SPOT dot is not green), keep scores silent & canFire = false
  if (isSilent) {
    let waitMsg = `Silent: Collecting live data (${secondsCollected}/${REQUIRED_SILENCE_SECONDS}s)`;
    if (spotReconcileMismatch) {
      waitMsg = `SPOT dot red (Reconcile mismatch > 0.1%) · Engine silent`;
    } else if (status !== 'LIVE') {
      waitMsg = `SPOT dot not green (Feed ${status}) · Engine silent`;
    } else if (!isSpotDotGreen) {
      waitMsg = `SPOT dot not green (age ${(spotAgeMs / 1000).toFixed(1)}s >= 3.0s) · Engine silent`;
    }

    return {
      isSilent: true,
      isSpotDotGreen,
      spotAgeMs,
      secondsCollected,
      silenceRemainingSec,
      totalScore: 0,
      bullishScore: 0,
      bearishScore: 0,
      confidence: 0,
      lead: 0,
      favoredSide: 'NEUTRAL',
      components,
      excludedComponents,
      excludedWeightSum,
      activeComponentsCount,
      isLimitedData,
      renormalisedFactor: Number(renormalisedFactor.toFixed(3)),
      absorbDriveScore: 0,
      absorbDriveAgrees: false,
      canFire: false,
      cooldownRemainingSec,
      waitReason: waitMsg,
    };
  }

  let bullishScore = 0;
  let bearishScore = 0;
  let totalScore = 0;

  for (const c of components) {
    if (c.excluded) continue;
    totalScore += c.score;
    if (c.score > 0) bullishScore += c.score;
    else if (c.score < 0) bearishScore += Math.abs(c.score);
  }

  totalScore = Number(clamp(totalScore, -100, 100).toFixed(1));
  bullishScore = Number(Math.min(100, bullishScore).toFixed(1));
  bearishScore = Number(Math.min(100, bearishScore).toFixed(1));

  const favoredSide: 'LONG' | 'SHORT' | 'NEUTRAL' =
    totalScore > 0 ? 'LONG' : totalScore < 0 ? 'SHORT' : 'NEUTRAL';

  const confidence =
    favoredSide === 'LONG' ? bullishScore : favoredSide === 'SHORT' ? bearishScore : 0;
  const lead =
    favoredSide === 'LONG'
      ? Math.max(0, Number((bullishScore - bearishScore).toFixed(1)))
      : favoredSide === 'SHORT'
      ? Math.max(0, Number((bearishScore - bullishScore).toFixed(1)))
      : 0;

  const absorbDriveComp = components.find((c) => c.id === 'absorb_drive');
  const absorbDriveScore = absorbDriveComp ? absorbDriveComp.score : 0;

  // Absorb / Drive component MUST agree with the side:
  const absorbDriveAgrees =
    (favoredSide === 'LONG' && absorbDriveScore > 0) ||
    (favoredSide === 'SHORT' && absorbDriveScore < 0);

  // Firing rule:
  // !isLimitedData AND confidence >= 68 AND lead >= 22 AND absorbDriveAgrees AND cooldown expired AND no active trade AND SPOT dot green
  const meetsCriteria = !isLimitedData && confidence >= 68 && lead >= 22 && absorbDriveAgrees;
  const canFire =
    meetsCriteria && cooldownRemainingSec === 0 && !hasActiveTrade && isSpotDotGreen;

  let waitReason = 'Awaiting high-probability setup';
  if (isLimitedData) {
    waitReason = `LIMITED DATA (${activeComponentsCount}/8 active, excluded weight ${excludedWeightSum})`;
  } else if (hasActiveTrade) {
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
    isSpotDotGreen,
    spotAgeMs,
    secondsCollected,
    silenceRemainingSec: 0,
    totalScore,
    bullishScore,
    bearishScore,
    confidence,
    lead,
    favoredSide,
    components,
    excludedComponents,
    excludedWeightSum,
    activeComponentsCount,
    isLimitedData,
    renormalisedFactor: Number(renormalisedFactor.toFixed(3)),
    absorbDriveScore,
    absorbDriveAgrees,
    canFire,
    cooldownRemainingSec,
    waitReason,
  };
}

/**
 * Creates a new Trade Plan computed strictly from real prices and 1H ATR:
 * - SL: 1.5 × ATR
 * - TP1: 1 × ATR
 * - TP2: 2 × ATR
 * - TP3: 3 × ATR
 * - SL moves to breakeven after TP1.
 */
export function createTradePlan(
  side: 'LONG' | 'SHORT',
  entryPrice: number,
  secondBins: SecondBin[],
  confidence: number,
  lead: number,
  triggerReason: string,
  explicitAtr1h?: number | null
): BtcTideTradeRecord {
  const atr = computeAtr1h(secondBins, entryPrice, explicitAtr1h);
  const oneR = Number(atr.toFixed(2)); // 1 × 1H ATR
  const slDist = Number((1.5 * atr).toFixed(2)); // 1.5 × 1H ATR
  const tp1Dist = Number((1.0 * atr).toFixed(2)); // 1.0 × 1H ATR
  const tp2Dist = Number((2.0 * atr).toFixed(2)); // 2.0 × 1H ATR
  const tp3Dist = Number((3.0 * atr).toFixed(2)); // 3.0 × 1H ATR

  let slPrice = 0;
  let tp1Price = 0;
  let tp2Price = 0;
  let tp3Price = 0;

  if (side === 'LONG') {
    slPrice = Number((entryPrice - slDist).toFixed(2));
    tp1Price = Number((entryPrice + tp1Dist).toFixed(2));
    tp2Price = Number((entryPrice + tp2Dist).toFixed(2));
    tp3Price = Number((entryPrice + tp3Dist).toFixed(2));
  } else {
    slPrice = Number((entryPrice + slDist).toFixed(2));
    tp1Price = Number((entryPrice - tp1Dist).toFixed(2));
    tp2Price = Number((entryPrice - tp2Dist).toFixed(2));
    tp3Price = Number((entryPrice - tp3Dist).toFixed(2));
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
    (
      (isLong
        ? (currentPrice - trade.entryPrice) / trade.entryPrice
        : (trade.entryPrice - currentPrice) / trade.entryPrice) * 100
    ).toFixed(2)
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

    if (!trade.tp2Hit && currentPrice >= trade.tp2Price) {
      updated.tp1Hit = true;
      updated.tp2Hit = true;
      updated.status = 'TP2_HIT';
    }

    if (!trade.tp1Hit && currentPrice >= trade.tp1Price) {
      updated.tp1Hit = true;
      updated.beMoved = true;
      updated.slPrice = trade.entryPrice;
      updated.status = 'TP1_HIT_BE_ACTIVE';
    }

    if (currentPrice <= updated.slPrice) {
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
  } else {
    // 3. Check SHORT targets and stops
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

    if (!trade.tp2Hit && currentPrice <= trade.tp2Price) {
      updated.tp1Hit = true;
      updated.tp2Hit = true;
      updated.status = 'TP2_HIT';
    }

    if (!trade.tp1Hit && currentPrice <= trade.tp1Price) {
      updated.tp1Hit = true;
      updated.beMoved = true;
      updated.slPrice = trade.entryPrice;
      updated.status = 'TP1_HIT_BE_ACTIVE';
    }

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
