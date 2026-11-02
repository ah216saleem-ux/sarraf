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

export interface HtfTrendContext {
  ema21_1h: number | null;
  ema50_1h: number | null;
  ema21_4h: number | null;
  ema50_4h: number | null;
  atr1h?: number | null;
}

export interface KeyLevelsContext {
  prevDayHigh: number | null;
  prevDayLow: number | null;
  sessionHigh: number | null;
  sessionLow: number | null;
  heatmapSupportPrice?: number | null;
  heatmapResistancePrice?: number | null;
}

export interface NewsLockContext {
  isBlocked: boolean;
  eventTitle?: string | null;
  minutesFromRelease?: number | null;
}

export interface PendingConfirmationInfo {
  side: 'LONG' | 'SHORT';
  startedAt: number;
  expiresAt: number;
  elapsedSec: number;
  remainingSec: number;
  initialPrice: number;
  atrShort: number;
  adverseMove: number;
  maxAdverseAllowed: number;
}

export interface BtcSignalFilterContext {
  htf?: HtfTrendContext;
  keyLevels?: KeyLevelsContext;
  newsLock?: NewsLockContext;
  pendingConfirmation?: PendingConfirmationInfo | null;
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
  absorbDriveMagnitudeOk?: boolean;
  volumeSpikeRatio?: number;
  hasVolumeSpike?: boolean;
  flowBuy60sPct?: number;
  flowSell60sPct?: number;
  flowConflictBlocked?: boolean;
  vol1mBtc?: number;
  lowLiquidityBlocked?: boolean;
  newsBlocked?: boolean;
  newsBlockedTitle?: string | null;
  trend1h?: 'BULL' | 'BEAR' | 'NEUTRAL' | 'UNKNOWN';
  trend4h?: 'BULL' | 'BEAR' | 'NEUTRAL' | 'UNKNOWN';
  trendStateLabel?: string;
  htfTrendBlocked?: boolean;
  keyLevelBonusApplied?: number;
  keyLevelBonusNote?: string | null;
  keyLevelOppositeBlocked?: boolean;
  keyLevelBlockNote?: string | null;
  keyLevels?: KeyLevelsContext;
  pendingConfirmation?: PendingConfirmationInfo | null;
  atrShort?: number;
  atr1h?: number;
  requiredConfidence?: number;
  requiredLead?: number;
  canFire: boolean;
  cooldownRemainingSec: number;
  dailyTradesCount?: number;
  maxDailyTrades?: number;
  waitReason: string;
}

const REQUIRED_SILENCE_SECONDS = 180; // 3 minutes of live data
const SPOT_GREEN_MAX_AGE_MS = 3000; // SPOT dot is green only when fresh (<3s)
export const COOLDOWN_DURATION_MS = 60 * 60 * 1000; // 60 minutes cooldown after trade fully closes
export const TRADE_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes expiry (only applies if TP1 has NOT been hit)
export const MAX_TRADE_LIFETIME_MS = 3 * 60 * 60 * 1000; // 3 hours hard maximum trade lifetime after TP1 is hit
export const MAX_TRADES_PER_DAY = 5; // Max 5 trades per UTC day

// ============================================================================
// PHASE 2 SIGNAL-QUALITY UPGRADE CONSTANTS & CONFIG TOGGLES
// Each upgrade is a separate constant/config so it can be turned on or off.
// ============================================================================
export const ENABLE_HTF_TREND_FILTER = true;

export const ENABLE_FLOW_CONFLICT_BLOCK = true;
export const FLOW_CONFLICT_MAX_OPPOSITE_PCT = 65;

export const ENABLE_ENTRY_CONFIRMATION = true;
export const ENTRY_CONFIRM_DURATION_MS = 90 * 1000; // Hold signal as PENDING for up to 90s
export const ENTRY_CONFIRM_MAX_ADVERSE_ATR = 0.3; // Max 0.3 * atrShort move against signal
export const ENABLE_PULLBACK_EARLY_ENTRY = false; // Optional early entry on small pullback
export const PULLBACK_MIN_ATR_FACTOR = 0.08;
export const PULLBACK_MAX_ATR_FACTOR = 0.25;

export const ENABLE_STRONGER_THRESHOLDS = true;
export const MIN_CONFIDENCE_TO_FIRE = 75;
export const LEGACY_MIN_CONFIDENCE_TO_FIRE = 68;
export const MIN_LEAD_TO_FIRE = 30;
export const LEGACY_MIN_LEAD_TO_FIRE = 22;
export const ENABLE_ABSORB_DRIVE_MAGNITUDE_FILTER = true;
export const MIN_ABSORB_DRIVE_MAGNITUDE = 20;
export const ENABLE_VOLUME_SPIKE_FILTER = true;
export const VOLUME_SPIKE_MULTIPLIER = 1.5;

export const ENABLE_KEY_LEVELS_FILTER = true;
export const KEY_LEVEL_SCORE_BONUS = 5;
export const KEY_LEVEL_NEAR_ATR1H_FACTOR = 0.15;
export const KEY_LEVEL_OPPOSITE_BLOCK_R = 0.5;

export const ENABLE_NEWS_FILTER = true;
export const NEWS_BLOCK_WINDOW_MINUTES = 15;

export const ENABLE_LOW_LIQUIDITY_FILTER = true;
export const MIN_1M_VOLUME_BTC = 1.5;

export const BTC_TIDE_UPGRADE_CONFIG = {
  ENABLE_HTF_TREND_FILTER,
  ENABLE_FLOW_CONFLICT_BLOCK,
  FLOW_CONFLICT_MAX_OPPOSITE_PCT,
  ENABLE_ENTRY_CONFIRMATION,
  ENTRY_CONFIRM_DURATION_MS,
  ENTRY_CONFIRM_MAX_ADVERSE_ATR,
  ENABLE_PULLBACK_EARLY_ENTRY,
  ENABLE_STRONGER_THRESHOLDS,
  MIN_CONFIDENCE_TO_FIRE,
  MIN_LEAD_TO_FIRE,
  ENABLE_ABSORB_DRIVE_MAGNITUDE_FILTER,
  MIN_ABSORB_DRIVE_MAGNITUDE,
  ENABLE_VOLUME_SPIKE_FILTER,
  VOLUME_SPIKE_MULTIPLIER,
  ENABLE_KEY_LEVELS_FILTER,
  KEY_LEVEL_SCORE_BONUS,
  KEY_LEVEL_NEAR_ATR1H_FACTOR,
  KEY_LEVEL_OPPOSITE_BLOCK_R,
  ENABLE_NEWS_FILTER,
  NEWS_BLOCK_WINDOW_MINUTES,
  ENABLE_LOW_LIQUIDITY_FILTER,
  MIN_1M_VOLUME_BTC,
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Computes standard Exponential Moving Average (EMA) for a series of close prices.
 */
export function computeEma(closes: number[], period: number): number | null {
  if (!Array.isArray(closes) || closes.length < period || period <= 0) return null;
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) {
    ema += closes[i];
  }
  ema /= period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return Number.isFinite(ema) ? Number(ema.toFixed(2)) : null;
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
  _currentPrice: number,
  explicitAtr?: number | null
): number {
  if (explicitAtr && Number.isFinite(explicitAtr) && explicitAtr > 0) {
    return Number(clamp(explicitAtr, 5, 5000).toFixed(2));
  }
  if (!bins || bins.length === 0) return 0;

  const latestSec = bins[bins.length - 1].sec;
  const startWindow = latestSec - 89;
  const recentBins = bins.filter((b) => b.sec >= startWindow);
  const activeBins = recentBins.length >= 2 ? recentBins : bins.slice(-90);

  let trSum = 0;
  let count = 0;
  let prevClose = activeBins[0].openPrice;
  let highest = activeBins[0].highPrice;
  let lowest = activeBins[0].lowPrice;

  for (const b of activeBins) {
    const tr = Math.max(
      b.highPrice - b.lowPrice,
      Math.abs(b.highPrice - prevClose),
      Math.abs(b.lowPrice - prevClose)
    );
    trSum += tr;
    count++;
    prevClose = b.lastPrice;
    if (b.highPrice > highest) highest = b.highPrice;
    if (b.lowPrice < lowest) lowest = b.lowPrice;
  }

  const avgTr1s = count > 0 ? trSum / count : 0;
  const scaled90s = avgTr1s * Math.sqrt(90);
  const realizedRange = highest - lowest;
  const rawAtr = scaled90s > 0 ? scaled90s * 0.65 + realizedRange * 0.35 : realizedRange;
  return Number(Math.max(1, rawAtr).toFixed(2));
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
  spotReconcileMismatch: boolean = false,
  dailyTradesCount: number = 0,
  filterContext?: BtcSignalFilterContext
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
  // 1. Delta Flow (Base Weight: 20) - 60s Net Delta Flow & Volume
  // -------------------------------------------------------------
  const start60s = latestSec - 59;
  const start10s = latestSec - 9;
  const start180s = latestSec - 179;
  let buy60 = 0;
  let sell60 = 0;
  let buy10s = 0;
  let sell10s = 0;
  let total180s = 0;
  for (let i = secondBins.length - 1; i >= 0; i--) {
    const b = secondBins[i];
    if (b.sec < start180s) break;
    total180s += b.buyVol + b.sellVol;
    if (b.sec >= start60s) {
      buy60 += b.buyVol;
      sell60 += b.sellVol;
    }
    if (b.sec >= start10s) {
      buy10s += b.buyVol;
      sell10s += b.sellVol;
    }
  }
  const total60 = buy60 + sell60;
  const netDelta60 = buy60 - sell60;
  const deltaRatio = total60 > 0 ? netDelta60 / total60 : 0;
  const deltaRawScore = Number(clamp(deltaRatio * 20, -20, 20).toFixed(1));
  const flowBuy60sPct = total60 > 0 ? Number(((buy60 / total60) * 100).toFixed(1)) : 50;
  const flowSell60sPct = total60 > 0 ? Number(((sell60 / total60) * 100).toFixed(1)) : 50;
  const total10s = buy10s + sell10s;
  const avg10sVol3m = total180s / 18;
  const volumeSpikeRatio = avg10sVol3m > 0 ? Number((total10s / avg10sVol3m).toFixed(2)) : 0;

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
    explanation: 'Bid vs Ask USD notional depth imbalance within +/-0.1% of mid (5s smoothed)',
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

  // Pre-compute HTF Trend State even if silent so UI can display it
  const htf = filterContext?.htf;
  const ema21_1h = htf?.ema21_1h ?? null;
  const ema50_1h = htf?.ema50_1h ?? null;
  const ema21_4h = htf?.ema21_4h ?? null;
  const ema50_4h = htf?.ema50_4h ?? null;

  let trend1h: 'BULL' | 'BEAR' | 'NEUTRAL' | 'UNKNOWN' = 'UNKNOWN';
  if (currentPrice !== null && ema21_1h !== null && ema50_1h !== null) {
    if (currentPrice > ema21_1h && ema21_1h > ema50_1h) trend1h = 'BULL';
    else if (currentPrice < ema21_1h && ema21_1h < ema50_1h) trend1h = 'BEAR';
    else trend1h = 'NEUTRAL';
  }

  let trend4h: 'BULL' | 'BEAR' | 'NEUTRAL' | 'UNKNOWN' = 'UNKNOWN';
  if (currentPrice !== null && ema21_4h !== null && ema50_4h !== null) {
    if (currentPrice > ema21_4h && ema21_4h > ema50_4h) trend4h = 'BULL';
    else if (currentPrice < ema21_4h && ema21_4h < ema50_4h) trend4h = 'BEAR';
    else if (ema21_4h > ema50_4h) trend4h = 'BULL';
    else if (ema21_4h < ema50_4h) trend4h = 'BEAR';
    else trend4h = 'NEUTRAL';
  }

  const trendStateLabel =
    trend1h === 'UNKNOWN' && trend4h === 'UNKNOWN'
      ? 'HTF Building...'
      : `1H ${trend1h} · 4H ${trend4h}`;

  const reqConfidence = ENABLE_STRONGER_THRESHOLDS
    ? MIN_CONFIDENCE_TO_FIRE
    : LEGACY_MIN_CONFIDENCE_TO_FIRE;
  const reqLead = ENABLE_STRONGER_THRESHOLDS ? MIN_LEAD_TO_FIRE : LEGACY_MIN_LEAD_TO_FIRE;

  // If engine is silent (first 3 min of live data OR SPOT dot is not green), keep scores silent & canFire = false
  if (isSilent) {
    let waitMsg = `Silent: Collecting live data (${secondsCollected}/${REQUIRED_SILENCE_SECONDS}s)`;
    if (dailyTradesCount >= MAX_TRADES_PER_DAY && !hasActiveTrade) {
      waitMsg = `Daily limit reached (${dailyTradesCount}/${MAX_TRADES_PER_DAY})`;
    } else if (spotReconcileMismatch) {
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
      absorbDriveMagnitudeOk: false,
      volumeSpikeRatio,
      hasVolumeSpike: false,
      flowBuy60sPct,
      flowSell60sPct,
      flowConflictBlocked: false,
      vol1mBtc: Number(total60.toFixed(2)),
      lowLiquidityBlocked: false,
      newsBlocked: Boolean(filterContext?.newsLock?.isBlocked),
      newsBlockedTitle: filterContext?.newsLock?.eventTitle || null,
      trend1h,
      trend4h,
      trendStateLabel,
      htfTrendBlocked: false,
      keyLevelBonusApplied: 0,
      keyLevelBonusNote: null,
      keyLevelOppositeBlocked: false,
      keyLevelBlockNote: null,
      keyLevels: filterContext?.keyLevels,
      pendingConfirmation: filterContext?.pendingConfirmation || null,
      requiredConfidence: reqConfidence,
      requiredLead: reqLead,
      canFire: false,
      cooldownRemainingSec,
      dailyTradesCount,
      maxDailyTrades: MAX_TRADES_PER_DAY,
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

  const atrShort = computeAtr90s(secondBins, currentPrice);
  const atr1h = computeAtr1h(secondBins, currentPrice, htf?.atr1h ?? null);

  // -------------------------------------------------------------
  // Key Levels Bonus (+5 within 0.15 x 1H ATR) & Opposite Block (< 0.5R)
  // -------------------------------------------------------------
  let keyLevelBonusApplied = 0;
  let keyLevelBonusNote: string | null = null;
  let keyLevelOppositeBlocked = false;
  let keyLevelBlockNote: string | null = null;

  const kl = filterContext?.keyLevels;
  const supportLevels: Array<{ name: string; price: number }> = [];
  const resistanceLevels: Array<{ name: string; price: number }> = [];

  if (kl) {
    if (kl.prevDayLow && Number.isFinite(kl.prevDayLow) && kl.prevDayLow > 0) {
      supportLevels.push({ name: 'Prev Day Low', price: kl.prevDayLow });
    }
    if (kl.sessionLow && Number.isFinite(kl.sessionLow) && kl.sessionLow > 0) {
      supportLevels.push({ name: 'Session Low', price: kl.sessionLow });
    }
    if (
      kl.heatmapSupportPrice &&
      Number.isFinite(kl.heatmapSupportPrice) &&
      kl.heatmapSupportPrice > 0
    ) {
      supportLevels.push({ name: 'Heatmap Liq/Bid Cluster', price: kl.heatmapSupportPrice });
    }

    if (kl.prevDayHigh && Number.isFinite(kl.prevDayHigh) && kl.prevDayHigh > 0) {
      resistanceLevels.push({ name: 'Prev Day High', price: kl.prevDayHigh });
    }
    if (kl.sessionHigh && Number.isFinite(kl.sessionHigh) && kl.sessionHigh > 0) {
      resistanceLevels.push({ name: 'Session High', price: kl.sessionHigh });
    }
    if (
      kl.heatmapResistancePrice &&
      Number.isFinite(kl.heatmapResistancePrice) &&
      kl.heatmapResistancePrice > 0
    ) {
      resistanceLevels.push({ name: 'Heatmap Liq/Ask Cluster', price: kl.heatmapResistancePrice });
    }
  }

  if (ENABLE_KEY_LEVELS_FILTER && currentPrice !== null) {
    const nearDist = KEY_LEVEL_NEAR_ATR1H_FACTOR * atr1h;
    if (totalScore > 0) {
      const nearSup = supportLevels.find(
        (lvl) => Math.abs(currentPrice - lvl.price) <= nearDist
      );
      if (nearSup) {
        bullishScore += KEY_LEVEL_SCORE_BONUS;
        totalScore += KEY_LEVEL_SCORE_BONUS;
        keyLevelBonusApplied = KEY_LEVEL_SCORE_BONUS;
        keyLevelBonusNote = `+${KEY_LEVEL_SCORE_BONUS} near ${nearSup.name} ($${nearSup.price.toFixed(0)})`;
      }
    } else if (totalScore < 0) {
      const nearRes = resistanceLevels.find(
        (lvl) => Math.abs(currentPrice - lvl.price) <= nearDist
      );
      if (nearRes) {
        bearishScore += KEY_LEVEL_SCORE_BONUS;
        totalScore -= KEY_LEVEL_SCORE_BONUS;
        keyLevelBonusApplied = -KEY_LEVEL_SCORE_BONUS;
        keyLevelBonusNote = `+${KEY_LEVEL_SCORE_BONUS} near ${nearRes.name} ($${nearRes.price.toFixed(0)})`;
      }
    }
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

  // Prospective 1R distance to check opposite key level within 0.5R
  if (ENABLE_KEY_LEVELS_FILTER && currentPrice !== null && favoredSide !== 'NEUTRAL') {
    let swingLow = currentPrice;
    let swingHigh = currentPrice;
    if (secondBins.length > 0) {
      const startWindow = latestSec - 89;
      const recent = secondBins.filter((b) => b.sec >= startWindow);
      if (recent.length > 0) {
        swingLow = Math.min(...recent.map((b) => b.lowPrice));
        swingHigh = Math.max(...recent.map((b) => b.highPrice));
      }
    }
    const minSlFloor = currentPrice * 0.0008;
    const minClamp = Math.max(1.2 * atrShort, minSlFloor);
    const maxClamp = Math.max(minClamp, 3.2 * atrShort);
    const unclampedOneR =
      favoredSide === 'LONG'
        ? currentPrice - swingLow + 0.4 * atrShort
        : swingHigh - currentPrice + 0.4 * atrShort;
    const prospectiveOneR = clamp(unclampedOneR, minClamp, maxClamp);
    const maxOppositeDist = KEY_LEVEL_OPPOSITE_BLOCK_R * prospectiveOneR;

    if (favoredSide === 'LONG') {
      const blockingRes = resistanceLevels.find((lvl) => {
        const distAbove = lvl.price - currentPrice;
        const minGap = lvl.name === 'Session High' ? Math.max(2, 0.05 * prospectiveOneR) : 0.01;
        return distAbove >= minGap && distAbove <= maxOppositeDist;
      });
      if (blockingRes) {
        keyLevelOppositeBlocked = true;
        keyLevelBlockNote = `Blocked: firing into ${blockingRes.name} ($${blockingRes.price.toFixed(0)}, <0.5R)`;
      }
    } else if (favoredSide === 'SHORT') {
      const blockingSup = supportLevels.find((lvl) => {
        const distBelow = currentPrice - lvl.price;
        const minGap = lvl.name === 'Session Low' ? Math.max(2, 0.05 * prospectiveOneR) : 0.01;
        return distBelow >= minGap && distBelow <= maxOppositeDist;
      });
      if (blockingSup) {
        keyLevelOppositeBlocked = true;
        keyLevelBlockNote = `Blocked: firing into ${blockingSup.name} ($${blockingSup.price.toFixed(0)}, <0.5R)`;
      }
    }
  }

  const absorbDriveComp = components.find((c) => c.id === 'absorb_drive');
  const absorbDriveScore = absorbDriveComp ? absorbDriveComp.score : 0;
  const absorbDriveRawMag = Math.abs(absorbDriveComp ? absorbDriveComp.rawScore : 0);

  // Absorb / Drive component MUST agree with the side and meet magnitude >= 20:
  const absorbDriveAgrees =
    (favoredSide === 'LONG' && absorbDriveScore > 0) ||
    (favoredSide === 'SHORT' && absorbDriveScore < 0);
  const absorbDriveMagnitudeOk =
    !ENABLE_ABSORB_DRIVE_MAGNITUDE_FILTER ||
    Math.max(Math.abs(absorbDriveScore), absorbDriveRawMag) >= MIN_ABSORB_DRIVE_MAGNITUDE;

  // Volume spike: last 10s volume > 1.5x 3-minute average 10s volume in signal direction
  const volumeSpikeInDir =
    (favoredSide === 'LONG' && buy10s > sell10s) ||
    (favoredSide === 'SHORT' && sell10s > buy10s);
  const hasVolumeSpike =
    volumeSpikeRatio > VOLUME_SPIKE_MULTIPLIER && volumeSpikeInDir;
  const volumeSpikeOk = !ENABLE_VOLUME_SPIKE_FILTER || hasVolumeSpike;

  // Flow Conflict Block: last 60s taker flow > 65% against signal side
  const flowConflictBlocked =
    ENABLE_FLOW_CONFLICT_BLOCK &&
    ((favoredSide === 'LONG' && flowSell60sPct > FLOW_CONFLICT_MAX_OPPOSITE_PCT) ||
      (favoredSide === 'SHORT' && flowBuy60sPct > FLOW_CONFLICT_MAX_OPPOSITE_PCT));

  // HTF Trend Filter (1H EMA21/EMA50 + 4H agreement)
  let htfTrendBlocked = false;
  let htfTrendBlockReason: string | null = null;
  if (ENABLE_HTF_TREND_FILTER && favoredSide !== 'NEUTRAL' && trend1h !== 'UNKNOWN') {
    if (favoredSide === 'LONG') {
      if (trend1h !== 'BULL') {
        htfTrendBlocked = true;
        htfTrendBlockReason = 'Blocked: against 1H trend';
      } else if (trend4h !== 'UNKNOWN' && trend4h !== 'BULL') {
        htfTrendBlocked = true;
        htfTrendBlockReason = 'Blocked: 1H/4H trend disagree';
      }
    } else if (favoredSide === 'SHORT') {
      if (trend1h !== 'BEAR') {
        htfTrendBlocked = true;
        htfTrendBlockReason = 'Blocked: against 1H trend';
      } else if (trend4h !== 'UNKNOWN' && trend4h !== 'BEAR') {
        htfTrendBlocked = true;
        htfTrendBlockReason = 'Blocked: 1H/4H trend disagree';
      }
    }
  }

  // News & Session / Low-Liquidity Filters
  const newsBlocked = ENABLE_NEWS_FILTER && Boolean(filterContext?.newsLock?.isBlocked);
  const newsBlockedTitle = filterContext?.newsLock?.eventTitle || null;
  const lowLiquidityBlocked =
    ENABLE_LOW_LIQUIDITY_FILTER && total60 < MIN_1M_VOLUME_BTC;

  const dailyLimitReached = dailyTradesCount >= MAX_TRADES_PER_DAY;
  const meetsCriteria =
    !isLimitedData &&
    confidence >= reqConfidence &&
    lead >= reqLead &&
    absorbDriveAgrees &&
    absorbDriveMagnitudeOk &&
    volumeSpikeOk &&
    !flowConflictBlocked &&
    !htfTrendBlocked &&
    !keyLevelOppositeBlocked &&
    !newsBlocked &&
    !lowLiquidityBlocked;

  const canFire =
    meetsCriteria &&
    !dailyLimitReached &&
    cooldownRemainingSec === 0 &&
    !hasActiveTrade &&
    isSpotDotGreen;

  let waitReason = 'Awaiting high-probability setup';
  if (isLimitedData) {
    waitReason = `LIMITED DATA (${activeComponentsCount}/8 active, excluded weight ${excludedWeightSum})`;
  } else if (hasActiveTrade) {
    waitReason = 'Active trade in progress (One trade at a time)';
  } else if (dailyLimitReached) {
    waitReason = `Daily limit reached (${dailyTradesCount}/${MAX_TRADES_PER_DAY})`;
  } else if (cooldownRemainingSec > 0) {
    waitReason = `Cooldown active (${Math.floor(cooldownRemainingSec / 60)}m ${
      cooldownRemainingSec % 60
    }s remaining)`;
  } else if (newsBlocked) {
    waitReason = newsBlockedTitle
      ? `Blocked: USD news window (${newsBlockedTitle})`
      : 'Blocked: high-impact USD news window';
  } else if (lowLiquidityBlocked) {
    waitReason = 'Blocked: low liquidity';
  } else if (htfTrendBlocked && htfTrendBlockReason) {
    waitReason = htfTrendBlockReason;
  } else if (flowConflictBlocked) {
    waitReason = 'Blocked: live flow against signal';
  } else if (keyLevelOppositeBlocked && keyLevelBlockNote) {
    waitReason = keyLevelBlockNote;
  } else if (!meetsCriteria) {
    if (confidence < reqConfidence) {
      waitReason = `Confidence ${confidence.toFixed(0)} < ${reqConfidence} required`;
    } else if (lead < reqLead) {
      waitReason = `Lead ${lead.toFixed(0)} < ${reqLead} required`;
    } else if (!absorbDriveAgrees) {
      waitReason = 'Absorb/Drive component must agree with side';
    } else if (!absorbDriveMagnitudeOk) {
      waitReason = `Absorb/Drive magnitude ${Math.abs(absorbDriveScore).toFixed(0)} < ${MIN_ABSORB_DRIVE_MAGNITUDE} required`;
    } else if (!volumeSpikeOk) {
      waitReason = `Volume spike required (10s vol ${volumeSpikeRatio.toFixed(2)}x <= ${VOLUME_SPIKE_MULTIPLIER}x 3m avg)`;
    }
  } else if (filterContext?.pendingConfirmation) {
    const p = filterContext.pendingConfirmation;
    waitReason = `PENDING CONFIRMATION: ${p.side} (${p.remainingSec}s left · adverse $${p.adverseMove.toFixed(1)}/$${p.maxAdverseAllowed.toFixed(1)})`;
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
    absorbDriveMagnitudeOk,
    volumeSpikeRatio,
    hasVolumeSpike,
    flowBuy60sPct,
    flowSell60sPct,
    flowConflictBlocked,
    vol1mBtc: Number(total60.toFixed(2)),
    lowLiquidityBlocked,
    newsBlocked,
    newsBlockedTitle,
    trend1h,
    trend4h,
    trendStateLabel,
    htfTrendBlocked,
    keyLevelBonusApplied,
    keyLevelBonusNote,
    keyLevelOppositeBlocked,
    keyLevelBlockNote,
    keyLevels: filterContext?.keyLevels,
    pendingConfirmation: filterContext?.pendingConfirmation || null,
    atrShort,
    atr1h,
    requiredConfidence: reqConfidence,
    requiredLead: reqLead,
    canFire,
    cooldownRemainingSec,
    dailyTradesCount,
    maxDailyTrades: MAX_TRADES_PER_DAY,
    waitReason,
  };
}

export interface TradeAnalyticsMetadata {
  componentScores?: Record<string, number> | null;
  trendState?: string | null;
  flowBuyPct?: number | null;
  atrShort?: number | null;
  atr1h?: number | null;
}

export const BTC_TIDE_ENGINE_VERSION = 'v6.4';

/**
 * Creates a new Trade Plan strictly according to the specification:
 * - ATR: 90s short-term ATR (computeAtr90s)
 * - Swing Level: 90s swing low (for LONG) / 90s swing high (for SHORT)
 * - SL: beyond the 90s swing +/- 0.4 ATR (short-term ATR), clamped 1.2 - 3.2 ATR
 * - TP1/2/3: exactly 1R / 2R / 3R of that SL distance
 * - TP1 + breakeven: realizes +0.50R
 */
export function createTradePlan(
  side: 'LONG' | 'SHORT',
  entryPrice: number,
  secondBins: SecondBin[],
  confidence: number,
  lead: number,
  triggerReason: string,
  explicitAtrShort?: number | null,
  analyticsMeta?: TradeAnalyticsMetadata
): BtcTideTradeRecord {
  const atrShort = computeAtr90s(secondBins, entryPrice, explicitAtrShort);

  // 90s swing detection
  let swingLow = entryPrice;
  let swingHigh = entryPrice;
  if (secondBins && secondBins.length > 0) {
    const latestSec = secondBins[secondBins.length - 1].sec;
    const startWindow = latestSec - 89;
    const recent = secondBins.filter((b) => b.sec >= startWindow);
    if (recent.length > 0) {
      swingLow = Math.min(...recent.map((b) => b.lowPrice));
      swingHigh = Math.max(...recent.map((b) => b.highPrice));
    }
  }

  let slDist = 0;
  let slPrice = 0;
  let tp1Price = 0;
  let tp2Price = 0;
  let tp3Price = 0;

  const minSlFloor = entryPrice * 0.0008; // Minimum SL distance of 0.08% of price
  const minClamp = Math.max(1.2 * atrShort, minSlFloor);
  const maxClamp = Math.max(minClamp, 3.2 * atrShort);

  if (side === 'LONG') {
    const unclamped = (entryPrice - swingLow) + 0.4 * atrShort;
    slDist = Number(clamp(unclamped, minClamp, maxClamp).toFixed(2));
    slPrice = Number((entryPrice - slDist).toFixed(2));
    tp1Price = Number((entryPrice + 1.0 * slDist).toFixed(2));
    tp2Price = Number((entryPrice + 2.0 * slDist).toFixed(2));
    tp3Price = Number((entryPrice + 3.0 * slDist).toFixed(2));
  } else {
    const unclamped = (swingHigh - entryPrice) + 0.4 * atrShort;
    slDist = Number(clamp(unclamped, minClamp, maxClamp).toFixed(2));
    slPrice = Number((entryPrice + slDist).toFixed(2));
    tp1Price = Number((entryPrice - 1.0 * slDist).toFixed(2));
    tp2Price = Number((entryPrice - 2.0 * slDist).toFixed(2));
    tp3Price = Number((entryPrice - 3.0 * slDist).toFixed(2));
  }

  const oneR = slDist; // 1R is the exact SL distance

  console.log(
    `[BTC TIDE TRADE PLAN] Created ${side} trade @ $${entryPrice.toFixed(2)} | atrShort=$${atrShort.toFixed(2)}, slDist=$${slDist.toFixed(2)}, oneR=$${oneR.toFixed(2)}`
  );

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
    engine_version: BTC_TIDE_ENGINE_VERSION,
    componentScores: analyticsMeta?.componentScores ?? null,
    trendState: analyticsMeta?.trendState ?? null,
    flowBuyPct: analyticsMeta?.flowBuyPct ?? null,
    atrShort: analyticsMeta?.atrShort ?? atrShort,
    atr1h: analyticsMeta?.atr1h ?? null,
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

  // 1. Check Expiry (30 minutes — only applies if TP1 has NOT been hit)
  if (!trade.tp1Hit && now >= trade.expiryTime) {
    updated.status = 'CLOSED';
    updated.outcome = 'EXPIRED';
    updated.realizedR = currentR;
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

  // 4. Hard Maximum Trade Lifetime (3 hours) after TP1 is hit:
  // If reached after TP1 without hitting TP3 or BE stop, close at market with outcome 'EXPIRED_AFTER_TP1'
  // and realizedR = real locked R (including the 0.5R already taken at TP1, plus 0.5R if TP2 was hit, plus runner fraction * currentR).
  if (updated.tp1Hit && now - trade.entryTime >= MAX_TRADE_LIFETIME_MS) {
    updated.status = 'CLOSED';
    updated.outcome = 'EXPIRED_AFTER_TP1';
    const lockedRunnerR = updated.tp2Hit
      ? 0.5 * 1.0 + 0.25 * 2.0 + 0.25 * currentR
      : 0.5 * 1.0 + 0.5 * currentR;
    updated.realizedR = Number(lockedRunnerR.toFixed(2));
    updated.closedAt = now;
    updated.closePrice = currentPrice;
    return { updatedTrade: updated, closed: true };
  }

  return { updatedTrade: updated, closed: false };
}

