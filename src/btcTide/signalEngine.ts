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

export type FunnelGateId =
  | 'confidence'
  | 'lead'
  | 'absorb_drive'
  | 'volume_spike'
  | 'htf_trend'
  | 'flow_conflict'
  | 'key_level'
  | 'news'
  | 'liquidity'
  | 'cooldown'
  | 'daily_limit'
  | 'pending_cancelled'
  | 'sl_too_wide';

export interface KlineSlTpContext {
  atr5m: number | null;
  atr15m: number | null;
  swingLow5m12: number | null;
  swingHigh5m12: number | null;
  swingLow15m12: number | null;
  swingHigh15m12: number | null;
}

export type TpMode = 'FIXED_BASE' | 'R_MULTIPLE';

export interface SlTpPlanPreview {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  slPrice: number;
  slDist: number;
  slPct: number;
  slR: number; // -1.00R
  oneR: number;
  tpMode: TpMode;
  tpBase: number;
  tp1Dist: number;
  tp2Dist: number;
  tp3Dist: number;
  tp1Price: number;
  tp2Price: number;
  tp3Price: number;
  tp1R: number;
  tp2R: number;
  tp3R: number;
  tp1RewardRiskRatio: number;
  bePlusPrice: number;
  beLockDist: number;
  beLockR: number;
  atr5m: number;
  atr15m: number;
  atrShort: number;
  swingRefPrice: number;
  swingBasedDist: number;
  minAllowedSlDist: number;
  maxAllowedSlDist: number;
  slCapped: boolean;
  slTooWide: boolean;
  pushedBeyondLevelNote: string | null;
  tp1LowRWarning: string | null;
  risk1PctFormula: string;
  risk1PctExample10kBtc: number;
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
  klineSlTp?: KlineSlTpContext;
  adaptiveModeActive?: boolean;
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
  volumeSpikeBonusApplied?: number;
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
  isCounterTrend?: boolean;
  isTrendAligned?: boolean;
  setupGrade?: 'A+' | 'A' | 'B';
  adaptiveModeActive?: boolean;
  keyLevelBonusApplied?: number;
  keyLevelBonusNote?: string | null;
  keyLevelOppositeBlocked?: boolean;
  keyLevelBlockNote?: string | null;
  keyLevelWarningNote?: string | null;
  keyLevels?: KeyLevelsContext;
  pendingConfirmation?: PendingConfirmationInfo | null;
  atrShort?: number;
  atr1h?: number;
  atr5m?: number;
  atr15m?: number;
  slTpPreview?: SlTpPlanPreview | null;
  slTooWideBlocked?: boolean;
  blockingGates?: FunnelGateId[];
  primaryBlockingGate?: FunnelGateId | null;
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
export const TRADE_EXPIRY_MS = 260 * 60 * 1000; // 260 minutes expiry before TP1 is hit
export const MAX_TRADE_LIFETIME_MS = 260 * 60 * 1000; // 260 minutes hard maximum trade lifetime after TP1 is hit
export const MAX_TRADES_PER_DAY = 5; // Max 5 trades per UTC day

// ============================================================================
// PHASE 5 RELAXED SIGNAL-QUALITY CONSTANTS & SL/TP REWORK CONFIG
// Each upgrade is a separate constant/config so it can be turned on or off.
// ============================================================================
export const ENABLE_HTF_TREND_FILTER = true;

export const ENABLE_FLOW_CONFLICT_BLOCK = true;
export const FLOW_CONFLICT_MAX_OPPOSITE_PCT = 75; // Relaxed from 65% to 75%

export const ENABLE_ENTRY_CONFIRMATION = true;
export const ENTRY_CONFIRM_DURATION_MS = 45 * 1000; // Hold signal as PENDING for 45s (was 90s)
export const ENTRY_CONFIRM_MAX_ADVERSE_ATR = 0.5; // Max 0.5 * atrShort move against signal (was 0.3)
export const ENABLE_PULLBACK_EARLY_ENTRY = false; // Optional early entry on small pullback
export const PULLBACK_MIN_ATR_FACTOR = 0.08;
export const PULLBACK_MAX_ATR_FACTOR = 0.25;

export const ENABLE_STRONGER_THRESHOLDS = true;
export const MIN_CONFIDENCE_TO_FIRE = 68; // Restored to 68 for healthy 2-5 setups/day
export const LEGACY_MIN_CONFIDENCE_TO_FIRE = 68;
export const MIN_LEAD_TO_FIRE = 22; // Restored to 22 for healthy 2-5 setups/day
export const LEGACY_MIN_LEAD_TO_FIRE = 22;

export const ENABLE_ADAPTIVE_QUIET_MODE = true;
export const ADAPTIVE_QUIET_HOURS_MS = 6 * 60 * 60 * 1000; // 6 hours with no trade entered
export const ADAPTIVE_CONFIDENCE_DROP = 3;
export const ADAPTIVE_MIN_CONFIDENCE_FLOOR = 65;
export const ADAPTIVE_LEAD_DROP = 3;
export const ADAPTIVE_MIN_LEAD_FLOOR = 18;

export const ENABLE_ABSORB_DRIVE_MAGNITUDE_FILTER = true;
export const MIN_ABSORB_DRIVE_MAGNITUDE = 20;

export const ENABLE_VOLUME_SPIKE_FILTER = true;
export const ENABLE_VOLUME_SPIKE_HARD_BLOCK = false; // Score bonus instead of hard block
export const VOLUME_SPIKE_MULTIPLIER = 1.2; // Relaxed from 1.5x to 1.2x
export const VOLUME_SPIKE_SCORE_BONUS = 4;

export const ENABLE_KEY_LEVELS_FILTER = true;
export const ENABLE_KEY_LEVEL_OPPOSITE_HARD_BLOCK = false; // Warning instead of hard block
export const KEY_LEVEL_SCORE_BONUS = 5;
export const KEY_LEVEL_NEAR_ATR1H_FACTOR = 0.15;
export const KEY_LEVEL_OPPOSITE_BLOCK_R = 0.5;

export const ENABLE_NEWS_FILTER = true;
export const NEWS_BLOCK_WINDOW_MINUTES = 15;

export const ENABLE_LOW_LIQUIDITY_FILTER = true;
export const MIN_1M_VOLUME_BTC = 0.75; // Lowered by half from 1.5 BTC

export const ENABLE_WATCH_ALERTS = true;
export const WATCH_MIN_CONFIDENCE = 60;
export const WATCH_MIN_LEAD = 15;
export const WATCH_COOLDOWN_MS = 60 * 60 * 1000; // At most 1 WATCH alert per hour
export const TELEGRAM_IDLE_WARNING_MS = 12 * 60 * 60 * 1000; // Warn if nothing sent in 12h

// ============================================================================
// PHASE 6 SL/TP CONSTANTS (5m & 15m ATR + 12-candle swing structure)
// ============================================================================
export const SL_SWING_LOOKBACK_CANDLES = 12;
export const SL_ATR15_MULT = 2.5; // slDist = max(swing-based, 2.5 x atr15m, 0.50% of entry)
export const SL_SWING_BUFFER_ATR15_MULT = 0.3; // swing low/high +/- 0.3 x atr15m
export const SL_ATR15M_BUFFER_FACTOR = SL_SWING_BUFFER_ATR15_MULT;
export const SL_MIN_PCT = 0.5; // Floor: 0.50% of entry
export const SL_MAX_PCT = 1.0; // Cap: 1.00% of entry
export const SL_MIN_PCT_OF_PRICE = SL_MIN_PCT / 100; // 0.0050
export const SL_MAX_PCT_OF_PRICE = SL_MAX_PCT / 100; // 0.0100
export const SL_INSIDE_SWING_BLOCK_ATR15_MULT = 0.2; // Only block if capped SL sits inside nearest swing by > 0.2 x atr15m
export const SL_ROUND_LEVEL_STEP_USD = 500;
export const SL_ROUND_PROX_ATR15_MULT = 0.1; // Within 0.1 x atr15m of round $500 or heatmap cluster
export const SL_ROUND_PUSH_ATR15_MULT = 0.15; // Push 0.15 x atr15m beyond that level
export const SL_LEVEL_PROXIMITY_ATR15M_FACTOR = SL_ROUND_PROX_ATR15_MULT;
export const SL_LEVEL_PUSH_ATR15M_FACTOR = SL_ROUND_PUSH_ATR15_MULT;

// Take-Profit Constants (TP_MODE = 'FIXED_BASE' or 'R_MULTIPLE')
export const TP_MODE: TpMode = 'FIXED_BASE';
export const TP_BASE_ATR5_MULT = 1.5; // tpBase = max(1.5 x atr5m, 0.30% of entry)
export const SL_MIN_ATR5M_FACTOR = TP_BASE_ATR5_MULT;
export const TP_BASE_MIN_PCT = 0.3; // 0.30% of entry
export const TP1_PROFIT_LOCK_TPBASE_MULT = 0.1; // After TP1 move stop to entry +/- 0.1 x tpBase
export const TP1_BE_PLUS_OFFSET_R = TP1_PROFIT_LOCK_TPBASE_MULT;
export const TP1_LOW_R_WARNING_THRESHOLD = 0.7; // Warn when TP1 < 0.7R
export const TP1_LOW_R_WARNING_TEXT = 'TP1 smaller than SL - needs high win rate';

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
  ENABLE_ADAPTIVE_QUIET_MODE,
  ADAPTIVE_QUIET_HOURS_MS,
  ADAPTIVE_MIN_CONFIDENCE_FLOOR,
  ADAPTIVE_MIN_LEAD_FLOOR,
  ENABLE_ABSORB_DRIVE_MAGNITUDE_FILTER,
  MIN_ABSORB_DRIVE_MAGNITUDE,
  ENABLE_VOLUME_SPIKE_FILTER,
  ENABLE_VOLUME_SPIKE_HARD_BLOCK,
  VOLUME_SPIKE_MULTIPLIER,
  VOLUME_SPIKE_SCORE_BONUS,
  ENABLE_KEY_LEVELS_FILTER,
  ENABLE_KEY_LEVEL_OPPOSITE_HARD_BLOCK,
  KEY_LEVEL_SCORE_BONUS,
  KEY_LEVEL_NEAR_ATR1H_FACTOR,
  KEY_LEVEL_OPPOSITE_BLOCK_R,
  ENABLE_NEWS_FILTER,
  NEWS_BLOCK_WINDOW_MINUTES,
  ENABLE_LOW_LIQUIDITY_FILTER,
  MIN_1M_VOLUME_BTC,
  SL_SWING_LOOKBACK_CANDLES,
  SL_ATR15_MULT,
  SL_SWING_BUFFER_ATR15_MULT,
  SL_ATR15M_BUFFER_FACTOR,
  SL_MIN_ATR5M_FACTOR,
  SL_MIN_PCT,
  SL_MAX_PCT,
  SL_MIN_PCT_OF_PRICE,
  SL_MAX_PCT_OF_PRICE,
  SL_INSIDE_SWING_BLOCK_ATR15_MULT,
  TP_MODE,
  TP_BASE_ATR5_MULT,
  TP_BASE_MIN_PCT,
  TP1_PROFIT_LOCK_TPBASE_MULT,
  TP1_LOW_R_WARNING_THRESHOLD,
  TP1_BE_PLUS_OFFSET_R,
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

  const adaptiveModeActive = Boolean(
    ENABLE_ADAPTIVE_QUIET_MODE && filterContext?.adaptiveModeActive
  );
  const baseReqConfidence = ENABLE_STRONGER_THRESHOLDS
    ? MIN_CONFIDENCE_TO_FIRE
    : LEGACY_MIN_CONFIDENCE_TO_FIRE;
  const baseReqLead = ENABLE_STRONGER_THRESHOLDS ? MIN_LEAD_TO_FIRE : LEGACY_MIN_LEAD_TO_FIRE;

  const reqConfidence = adaptiveModeActive
    ? Math.max(ADAPTIVE_MIN_CONFIDENCE_FLOOR, baseReqConfidence - ADAPTIVE_CONFIDENCE_DROP)
    : baseReqConfidence;
  const reqLead = adaptiveModeActive
    ? Math.max(ADAPTIVE_MIN_LEAD_FLOOR, baseReqLead - ADAPTIVE_LEAD_DROP)
    : baseReqLead;

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
      volumeSpikeBonusApplied: 0,
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
      isCounterTrend: false,
      isTrendAligned: false,
      setupGrade: 'B',
      adaptiveModeActive,
      keyLevelBonusApplied: 0,
      keyLevelBonusNote: null,
      keyLevelOppositeBlocked: false,
      keyLevelBlockNote: null,
      keyLevelWarningNote: null,
      keyLevels: filterContext?.keyLevels,
      pendingConfirmation: filterContext?.pendingConfirmation || null,
      slTpPreview: null,
      slTooWideBlocked: false,
      blockingGates: [],
      primaryBlockingGate: null,
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
  // Volume Spike Bonus (+4 score bonus instead of hard block)
  // -------------------------------------------------------------
  const prelimFavoredSide: 'LONG' | 'SHORT' | 'NEUTRAL' =
    totalScore > 0 ? 'LONG' : totalScore < 0 ? 'SHORT' : 'NEUTRAL';
  const volumeSpikeInDir =
    (prelimFavoredSide === 'LONG' && buy10s > sell10s) ||
    (prelimFavoredSide === 'SHORT' && sell10s > buy10s);
  const hasVolumeSpike =
    volumeSpikeRatio > VOLUME_SPIKE_MULTIPLIER && volumeSpikeInDir;

  let volumeSpikeBonusApplied = 0;
  if (ENABLE_VOLUME_SPIKE_FILTER && hasVolumeSpike) {
    if (prelimFavoredSide === 'LONG') {
      bullishScore += VOLUME_SPIKE_SCORE_BONUS;
      totalScore += VOLUME_SPIKE_SCORE_BONUS;
      volumeSpikeBonusApplied = VOLUME_SPIKE_SCORE_BONUS;
    } else if (prelimFavoredSide === 'SHORT') {
      bearishScore += VOLUME_SPIKE_SCORE_BONUS;
      totalScore -= VOLUME_SPIKE_SCORE_BONUS;
      volumeSpikeBonusApplied = -VOLUME_SPIKE_SCORE_BONUS;
    }
  }

  // -------------------------------------------------------------
  // Key Levels Bonus (+5 within 0.15 x 1H ATR) & Warning (< 0.5R)
  // -------------------------------------------------------------
  let keyLevelBonusApplied = 0;
  let keyLevelBonusNote: string | null = null;
  let keyLevelOppositeBlocked = false;
  let keyLevelBlockNote: string | null = null;
  let keyLevelWarningNote: string | null = null;

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

  // Compute SL/TP Preview for current favoredSide (or LONG if neutral) using new 5m/15m candle ATR & swing rules
  const previewSide: 'LONG' | 'SHORT' = favoredSide === 'SHORT' ? 'SHORT' : 'LONG';
  const slTpPreview =
    currentPrice !== null
      ? computeBtcTideSlTpPlan(
          previewSide,
          currentPrice,
          secondBins,
          filterContext?.klineSlTp,
          filterContext?.keyLevels,
          atrShort
        )
      : null;

  const atr5m = slTpPreview?.atr5m ?? Number((currentPrice * 0.0018).toFixed(2));
  const atr15m = slTpPreview?.atr15m ?? Number((currentPrice * 0.0030).toFixed(2));

  // Prospective 1R distance to check opposite key level within 0.5R (Warning on card, only hard-blocks if ENABLE_KEY_LEVEL_OPPOSITE_HARD_BLOCK)
  if (ENABLE_KEY_LEVELS_FILTER && currentPrice !== null && favoredSide !== 'NEUTRAL') {
    const prospectiveOneR = slTpPreview?.oneR ?? Math.max(1.5 * atr5m, currentPrice * 0.003);
    const maxOppositeDist = KEY_LEVEL_OPPOSITE_BLOCK_R * prospectiveOneR;

    if (favoredSide === 'LONG') {
      const blockingRes = resistanceLevels.find((lvl) => {
        const distAbove = lvl.price - currentPrice;
        const minGap = lvl.name === 'Session High' ? Math.max(2, 0.05 * prospectiveOneR) : 0.01;
        return distAbove >= minGap && distAbove <= maxOppositeDist;
      });
      if (blockingRes) {
        keyLevelWarningNote = `Warning: opposite ${blockingRes.name} within <0.5R ($${blockingRes.price.toFixed(0)})`;
        if (ENABLE_KEY_LEVEL_OPPOSITE_HARD_BLOCK) {
          keyLevelOppositeBlocked = true;
          keyLevelBlockNote = `Blocked: firing into ${blockingRes.name} ($${blockingRes.price.toFixed(0)}, <0.5R)`;
        }
      }
    } else if (favoredSide === 'SHORT') {
      const blockingSup = supportLevels.find((lvl) => {
        const distBelow = currentPrice - lvl.price;
        const minGap = lvl.name === 'Session Low' ? Math.max(2, 0.05 * prospectiveOneR) : 0.01;
        return distBelow >= minGap && distBelow <= maxOppositeDist;
      });
      if (blockingSup) {
        keyLevelWarningNote = `Warning: opposite ${blockingSup.name} within <0.5R ($${blockingSup.price.toFixed(0)})`;
        if (ENABLE_KEY_LEVEL_OPPOSITE_HARD_BLOCK) {
          keyLevelOppositeBlocked = true;
          keyLevelBlockNote = `Blocked: firing into ${blockingSup.name} ($${blockingSup.price.toFixed(0)}, <0.5R)`;
        }
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

  // Volume spike is now a score bonus by default; only blocks if ENABLE_VOLUME_SPIKE_HARD_BLOCK is true
  const volumeSpikeOk =
    !ENABLE_VOLUME_SPIKE_FILTER || !ENABLE_VOLUME_SPIKE_HARD_BLOCK || hasVolumeSpike;

  // Flow Conflict Block: last 60s taker flow > 75% against signal side
  const flowConflictBlocked =
    ENABLE_FLOW_CONFLICT_BLOCK &&
    ((favoredSide === 'LONG' && flowSell60sPct > FLOW_CONFLICT_MAX_OPPOSITE_PCT) ||
      (favoredSide === 'SHORT' && flowBuy60sPct > FLOW_CONFLICT_MAX_OPPOSITE_PCT));

  // HTF Trend Filter (Phase 5 rule: block ONLY when BOTH 1H and 4H trend are against the signal.
  // If only one disagrees, allow the trade, mark it "counter-trend", and reduce its grade to B.)
  let htfTrendBlocked = false;
  let htfTrendBlockReason: string | null = null;
  let isCounterTrend = false;
  let isTrendAligned = false;

  if (favoredSide === 'LONG') {
    const against1h = trend1h === 'BEAR';
    const against4h = trend4h === 'BEAR';
    isTrendAligned = trend1h === 'BULL' && (trend4h === 'BULL' || trend4h === 'UNKNOWN');
    if (ENABLE_HTF_TREND_FILTER && against1h && against4h) {
      htfTrendBlocked = true;
      htfTrendBlockReason = 'Blocked: against both 1H & 4H trend';
    } else if (against1h || against4h || trend1h === 'NEUTRAL' || trend4h === 'NEUTRAL') {
      if (against1h || against4h) {
        isCounterTrend = true;
      }
    }
  } else if (favoredSide === 'SHORT') {
    const against1h = trend1h === 'BULL';
    const against4h = trend4h === 'BULL';
    isTrendAligned = trend1h === 'BEAR' && (trend4h === 'BEAR' || trend4h === 'UNKNOWN');
    if (ENABLE_HTF_TREND_FILTER && against1h && against4h) {
      htfTrendBlocked = true;
      htfTrendBlockReason = 'Blocked: against both 1H & 4H trend';
    } else if (against1h || against4h || trend1h === 'NEUTRAL' || trend4h === 'NEUTRAL') {
      if (against1h || against4h) {
        isCounterTrend = true;
      }
    }
  }

  const setupGrade = computeSetupGrade(confidence, isTrendAligned, isCounterTrend);

  // News & Session / Low-Liquidity Filters
  const newsBlocked = ENABLE_NEWS_FILTER && Boolean(filterContext?.newsLock?.isBlocked);
  const newsBlockedTitle = filterContext?.newsLock?.eventTitle || null;
  const lowLiquidityBlocked =
    ENABLE_LOW_LIQUIDITY_FILTER && total60 < MIN_1M_VOLUME_BTC;

  // SL Too Wide gate (> 0.80% of entry price)
  const slTooWideBlocked = Boolean(
    favoredSide !== 'NEUTRAL' && slTpPreview && slTpPreview.slTooWide
  );

  const dailyLimitReached = dailyTradesCount >= MAX_TRADES_PER_DAY;
  const meetsCriteria =
    !isLimitedData &&
    favoredSide !== 'NEUTRAL' &&
    confidence >= reqConfidence &&
    lead >= reqLead &&
    absorbDriveAgrees &&
    absorbDriveMagnitudeOk &&
    volumeSpikeOk &&
    !flowConflictBlocked &&
    !htfTrendBlocked &&
    !keyLevelOppositeBlocked &&
    !newsBlocked &&
    !lowLiquidityBlocked &&
    !slTooWideBlocked;

  const canFire =
    meetsCriteria &&
    !dailyLimitReached &&
    cooldownRemainingSec === 0 &&
    !hasActiveTrade &&
    isSpotDotGreen;

  // Collect all blocking gates on this tick for 24h Filter Funnel diagnostics
  const blockingGates: FunnelGateId[] = [];
  if (!hasActiveTrade && !isLimitedData) {
    if (dailyLimitReached) blockingGates.push('daily_limit');
    if (cooldownRemainingSec > 0) blockingGates.push('cooldown');
    if (newsBlocked) blockingGates.push('news');
    if (lowLiquidityBlocked) blockingGates.push('liquidity');
    if (htfTrendBlocked) blockingGates.push('htf_trend');
    if (flowConflictBlocked) blockingGates.push('flow_conflict');
    if (keyLevelOppositeBlocked) blockingGates.push('key_level');
    if (slTooWideBlocked) blockingGates.push('sl_too_wide');
    if (confidence < reqConfidence) blockingGates.push('confidence');
    if (lead < reqLead) blockingGates.push('lead');
    if (!absorbDriveAgrees || !absorbDriveMagnitudeOk) blockingGates.push('absorb_drive');
    if (!volumeSpikeOk) blockingGates.push('volume_spike');
  }
  const primaryBlockingGate: FunnelGateId | null =
    !canFire && blockingGates.length > 0 ? blockingGates[0] : null;

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
  } else if (slTooWideBlocked && slTpPreview) {
    waitReason = `Blocked: SL cap sits >0.2x ATR15m inside nearest swing (${slTpPreview.slPct.toFixed(2)}% cap)`;
  } else if (!meetsCriteria) {
    if (confidence < reqConfidence) {
      waitReason = `Confidence ${confidence.toFixed(0)} < ${reqConfidence} required${adaptiveModeActive ? ' (Adaptive ON)' : ''}`;
    } else if (lead < reqLead) {
      waitReason = `Lead ${lead.toFixed(0)} < ${reqLead} required${adaptiveModeActive ? ' (Adaptive ON)' : ''}`;
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
    waitReason = `READY TO FIRE ${favoredSide} [Grade ${setupGrade}${isCounterTrend ? ' · Counter-Trend' : ''}] (Confidence: ${confidence.toFixed(0)}%, Lead: ${lead.toFixed(0)}%)`;
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
    volumeSpikeBonusApplied,
    flowBuy60sPct,
    flowSell60sPct,
    flowConflictBlocked,
    vol1mBtc: Number(total60.toFixed(2)),
    lowLiquidityBlocked,
    newsBlocked,
    newsBlockedTitle,
    trend1h,
    trend4h,
    trendStateLabel: isCounterTrend ? `${trendStateLabel} (Counter-Trend)` : trendStateLabel,
    htfTrendBlocked,
    isCounterTrend,
    isTrendAligned,
    setupGrade,
    adaptiveModeActive,
    keyLevelBonusApplied,
    keyLevelBonusNote,
    keyLevelOppositeBlocked,
    keyLevelBlockNote,
    keyLevelWarningNote,
    keyLevels: filterContext?.keyLevels,
    pendingConfirmation: filterContext?.pendingConfirmation || null,
    atrShort,
    atr1h,
    atr5m,
    atr15m,
    slTpPreview,
    slTooWideBlocked,
    blockingGates,
    primaryBlockingGate,
    requiredConfidence: reqConfidence,
    requiredLead: reqLead,
    canFire,
    cooldownRemainingSec,
    dailyTradesCount,
    maxDailyTrades: MAX_TRADES_PER_DAY,
    waitReason,
  };
}

/**
 * Computes setup grade:
 * - A+: confidence >= 75 and trend aligned (!isCounterTrend && isTrendAligned)
 * - A:  confidence >= 70 (70-74, or >=75 when HTF neutral) and not counter-trend
 * - B:  confidence 65-69 OR counter-trend
 */
export function computeSetupGrade(
  confidence: number,
  isTrendAligned: boolean,
  isCounterTrend: boolean
): 'A+' | 'A' | 'B' {
  if (isCounterTrend || confidence < 70) {
    return 'B';
  }
  if (confidence >= 75 && isTrendAligned) {
    return 'A+';
  }
  return 'A';
}

/**
 * Computes the Phase 6 SL/TP Plan from 5m & 15m candle ATR(14) and 12-candle swing high/low:
 * 1. NEW SL RULE:
 *    - slDist = max( swing-based distance, 2.5 x atr15m, 0.50% of entry )
 *    - Swing-based:
 *      * LONG  = entry - (min of last 12 candles' lows on 5m and 15m - 0.3 x atr15m)
 *      * SHORT = (max of last 12 candles' highs on 5m and 15m + 0.3 x atr15m) - entry
 *    - Floor: 0.50% of entry (SL_MIN_PCT = 0.5). Cap: 1.00% of entry (SL_MAX_PCT = 1.0).
 *    - If swing-based SL exceeds the cap, use the cap instead of blocking the trade
 *      (only block if the cap would still sit inside the nearest swing by more than 0.2 x atr15m).
 *    - If the SL lies within 0.1 x atr15m of a round level (multiples of 500 USD) or a heatmap cluster,
 *      push it 0.15 x atr15m beyond that level.
 * 2. TAKE-PROFIT KEEP THE SAME:
 *    - tpBase = max(1.5 x atr5m, 0.30% of entry)
 *    - TP_MODE = 'FIXED_BASE' (default: TP1/2/3 = 1x/2x/3x tpBase) or 'R_MULTIPLE' (1R/2R/3R of slDist)
 *    - After TP1 move stop to entry +/- 0.1 x tpBase (profit-lock)
 * 3. R ACCOUNTING:
 *    - oneR = slDist; tp1R = tp1Dist / slDist, tp2R = tp2Dist / slDist, tp3R = tp3Dist / slDist
 */
export function computeBtcTideSlTpPlan(
  side: 'LONG' | 'SHORT',
  entryPrice: number,
  secondBins: SecondBin[],
  klineSlTp?: KlineSlTpContext | null,
  keyLevels?: KeyLevelsContext | null,
  explicitAtrShort?: number | null,
  tpModeOverride?: TpMode
): SlTpPlanPreview {
  const atrShort = computeAtr90s(secondBins, entryPrice, explicitAtrShort);

  // 90s swing fallback when klines are not explicitly provided
  let swingLow90s = entryPrice;
  let swingHigh90s = entryPrice;
  if (secondBins && secondBins.length > 0) {
    const latestSec = secondBins[secondBins.length - 1].sec;
    const startWindow = latestSec - 89;
    const recent = secondBins.filter((b) => b.sec >= startWindow);
    if (recent.length > 0) {
      swingLow90s = Math.min(...recent.map((b) => b.lowPrice));
      swingHigh90s = Math.max(...recent.map((b) => b.highPrice));
    }
  }

  const fallbackAtr5m = Number(
    clamp(
      Math.max(entryPrice * 0.0018, atrShort * 1.8),
      entryPrice * 0.0012,
      entryPrice * 0.005
    ).toFixed(2)
  );
  const atr5m =
    klineSlTp?.atr5m && Number.isFinite(klineSlTp.atr5m) && klineSlTp.atr5m > 0
      ? Number(klineSlTp.atr5m.toFixed(2))
      : fallbackAtr5m;

  const fallbackAtr15m = Number(
    clamp(Math.max(entryPrice * 0.003, atr5m * 1.65), entryPrice * 0.002, entryPrice * 0.0085).toFixed(2)
  );
  const atr15m =
    klineSlTp?.atr15m && Number.isFinite(klineSlTp.atr15m) && klineSlTp.atr15m > 0
      ? Number(klineSlTp.atr15m.toFixed(2))
      : fallbackAtr15m;

  const swingLow5m12 =
    klineSlTp?.swingLow5m12 && Number.isFinite(klineSlTp.swingLow5m12) && klineSlTp.swingLow5m12 > 0
      ? klineSlTp.swingLow5m12
      : swingLow90s;
  const swingLow15m12 =
    klineSlTp?.swingLow15m12 &&
    Number.isFinite(klineSlTp.swingLow15m12) &&
    klineSlTp.swingLow15m12 > 0
      ? klineSlTp.swingLow15m12
      : swingLow5m12;

  const swingHigh5m12 =
    klineSlTp?.swingHigh5m12 &&
    Number.isFinite(klineSlTp.swingHigh5m12) &&
    klineSlTp.swingHigh5m12 > 0
      ? klineSlTp.swingHigh5m12
      : swingHigh90s;
  const swingHigh15m12 =
    klineSlTp?.swingHigh15m12 &&
    Number.isFinite(klineSlTp.swingHigh15m12) &&
    klineSlTp.swingHigh15m12 > 0
      ? klineSlTp.swingHigh15m12
      : swingHigh5m12;

  const minAllowedSlDist = Number(((SL_MIN_PCT / 100) * entryPrice).toFixed(2));
  const maxAllowedSlDist = Number(((SL_MAX_PCT / 100) * entryPrice).toFixed(2));
  const atr15FloorDist = Number((SL_ATR15_MULT * atr15m).toFixed(2));

  let swingRefPrice = entryPrice;
  let swingBasedDist = 0;

  if (side === 'LONG') {
    swingRefPrice = Number(Math.min(swingLow15m12, swingLow5m12, entryPrice).toFixed(2));
    const swingSlPrice = swingRefPrice - SL_SWING_BUFFER_ATR15_MULT * atr15m;
    swingBasedDist = Number(Math.max(0, entryPrice - swingSlPrice).toFixed(2));
  } else {
    swingRefPrice = Number(Math.max(swingHigh15m12, swingHigh5m12, entryPrice).toFixed(2));
    const swingSlPrice = swingRefPrice + SL_SWING_BUFFER_ATR15_MULT * atr15m;
    swingBasedDist = Number(Math.max(0, swingSlPrice - entryPrice).toFixed(2));
  }

  // Initial SL distance before cap: max(swing-based distance, 2.5 x atr15m, 0.50% of entry)
  const initialSlDist = Math.max(swingBasedDist, atr15FloorDist, minAllowedSlDist);
  let rawSlPrice = side === 'LONG' ? entryPrice - initialSlDist : entryPrice + initialSlDist;

  // Check if SL lies within 0.1 x atr15m of a round level (multiples of $500) or heatmap cluster
  const proxDist = SL_ROUND_PROX_ATR15_MULT * atr15m;
  const pushDist = SL_ROUND_PUSH_ATR15_MULT * atr15m;
  const nearestRound500 =
    Math.round(rawSlPrice / SL_ROUND_LEVEL_STEP_USD) * SL_ROUND_LEVEL_STEP_USD;

  const candidateLevels: Array<{ name: string; price: number }> = [
    { name: `Round $${nearestRound500}`, price: nearestRound500 },
  ];
  if (
    keyLevels?.heatmapSupportPrice &&
    Number.isFinite(keyLevels.heatmapSupportPrice) &&
    keyLevels.heatmapSupportPrice > 0
  ) {
    candidateLevels.push({
      name: 'Heatmap Bid Cluster',
      price: keyLevels.heatmapSupportPrice,
    });
  }
  if (
    keyLevels?.heatmapResistancePrice &&
    Number.isFinite(keyLevels.heatmapResistancePrice) &&
    keyLevels.heatmapResistancePrice > 0
  ) {
    candidateLevels.push({
      name: 'Heatmap Ask Cluster',
      price: keyLevels.heatmapResistancePrice,
    });
  }

  let pushedBeyondLevelNote: string | null = null;
  for (const lvl of candidateLevels) {
    if (Math.abs(rawSlPrice - lvl.price) <= proxDist) {
      if (side === 'LONG') {
        const pushed = lvl.price - pushDist;
        if (pushed < rawSlPrice) {
          rawSlPrice = pushed;
          pushedBeyondLevelNote = `Pushed 0.15x ATR15m below ${lvl.name} ($${lvl.price.toFixed(0)})`;
        }
      } else {
        const pushed = lvl.price + pushDist;
        if (pushed > rawSlPrice) {
          rawSlPrice = pushed;
          pushedBeyondLevelNote = `Pushed 0.15x ATR15m above ${lvl.name} ($${lvl.price.toFixed(0)})`;
        }
      }
    }
  }

  let uncappedSlDist = Math.max(minAllowedSlDist, Math.abs(entryPrice - rawSlPrice));
  let slCapped = false;
  let finalSlDist = uncappedSlDist;

  // Cap at 1.00% of entry (use the cap instead of blocking unless cap sits inside nearest swing by > 0.2 x atr15m)
  if (finalSlDist > maxAllowedSlDist) {
    finalSlDist = maxAllowedSlDist;
    slCapped = true;
  }

  const slDist = Number(Math.max(minAllowedSlDist, finalSlDist).toFixed(2));
  const slPrice = Number(
    (side === 'LONG' ? entryPrice - slDist : entryPrice + slDist).toFixed(2)
  );

  // Only block if the capped SL still sits inside the nearest swing by more than 0.2 x atr15m
  const insideSwingAllowance = SL_INSIDE_SWING_BLOCK_ATR15_MULT * atr15m;
  const slTooWide =
    side === 'LONG'
      ? slPrice > swingRefPrice + insideSwingAllowance + 0.01
      : slPrice < swingRefPrice - insideSwingAllowance - 0.01;

  const slPct = Number(((slDist / entryPrice) * 100).toFixed(2));
  const oneR = slDist;
  const slR = -1.0;

  // Take-profit calculation: tpBase = max(1.5 x atr5m, 0.30% of entry)
  const tpMode: TpMode = tpModeOverride || TP_MODE;
  const tpBase = Number(
    Math.max(TP_BASE_ATR5_MULT * atr5m, (TP_BASE_MIN_PCT / 100) * entryPrice).toFixed(2)
  );
  const stepUnit = tpMode === 'R_MULTIPLE' ? oneR : tpBase;

  const tp1Dist = Number((1.0 * stepUnit).toFixed(2));
  const tp2Dist = Number((2.0 * stepUnit).toFixed(2));
  const tp3Dist = Number((3.0 * stepUnit).toFixed(2));

  const tp1Price = Number(
    (side === 'LONG' ? entryPrice + tp1Dist : entryPrice - tp1Dist).toFixed(2)
  );
  const tp2Price = Number(
    (side === 'LONG' ? entryPrice + tp2Dist : entryPrice - tp2Dist).toFixed(2)
  );
  const tp3Price = Number(
    (side === 'LONG' ? entryPrice + tp3Dist : entryPrice - tp3Dist).toFixed(2)
  );

  // True R of each TP measured against real SL distance (slDist = oneR)
  const tp1R = oneR > 0 ? Number((tp1Dist / oneR).toFixed(2)) : 1.0;
  const tp2R = oneR > 0 ? Number((tp2Dist / oneR).toFixed(2)) : 2.0;
  const tp3R = oneR > 0 ? Number((tp3Dist / oneR).toFixed(2)) : 3.0;
  const tp1RewardRiskRatio = tp1R;

  // After TP1 move stop to entry +/- 0.1 x tpBase (profit-lock), not exact entry
  const beLockDist = Number((TP1_PROFIT_LOCK_TPBASE_MULT * tpBase).toFixed(2));
  const bePlusPrice = Number(
    (side === 'LONG' ? entryPrice + beLockDist : entryPrice - beLockDist).toFixed(2)
  );
  const beLockR = oneR > 0 ? Number((beLockDist / oneR).toFixed(2)) : 0.1;

  const tp1LowRWarning =
    tp1R < TP1_LOW_R_WARNING_THRESHOLD ? TP1_LOW_R_WARNING_TEXT : null;

  const risk1PctExample10kBtc = oneR > 0 ? Number((100 / oneR).toFixed(4)) : 0;
  const risk1PctFormula = `Risk 1% account: size = account x 1% / SL distance ($${oneR.toFixed(2)})`;

  return {
    side,
    entryPrice,
    slPrice,
    slDist,
    slPct,
    slR,
    oneR,
    tpMode,
    tpBase,
    tp1Dist,
    tp2Dist,
    tp3Dist,
    tp1Price,
    tp2Price,
    tp3Price,
    tp1R,
    tp2R,
    tp3R,
    tp1RewardRiskRatio,
    bePlusPrice,
    beLockDist,
    beLockR,
    atr5m,
    atr15m,
    atrShort,
    swingRefPrice,
    swingBasedDist,
    minAllowedSlDist,
    maxAllowedSlDist,
    slCapped,
    slTooWide,
    pushedBeyondLevelNote,
    tp1LowRWarning,
    risk1PctFormula,
    risk1PctExample10kBtc,
  };
}

export interface TradeAnalyticsMetadata {
  componentScores?: Record<string, number> | null;
  trendState?: string | null;
  flowBuyPct?: number | null;
  atrShort?: number | null;
  atr1h?: number | null;
  atr5m?: number | null;
  atr15m?: number | null;
  klineSlTp?: KlineSlTpContext | null;
  keyLevels?: KeyLevelsContext | null;
  grade?: 'A+' | 'A' | 'B' | null;
  isCounterTrend?: boolean | null;
  adaptiveMode?: boolean | null;
  tpMode?: TpMode;
}

export const BTC_TIDE_ENGINE_VERSION = 'v6.6';

/**
 * Creates a new Trade Plan strictly according to the Phase 6 SL/TP specification:
 * - slDist = max(swing-based distance, 2.5 x atr15m, 0.50% of entry), capped at 1.00% of entry
 * - tpBase = max(1.5 x atr5m, 0.30% of entry)
 * - TP1/TP2/TP3 = 1x / 2x / 3x tpBase (50% / 25% / 25%) in FIXED_BASE mode, or 1R/2R/3R in R_MULTIPLE mode
 * - After TP1 stop moves to entry +/- 0.1 x tpBase (profit-lock)
 * - R is always measured against real slDist
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
  const plan = computeBtcTideSlTpPlan(
    side,
    entryPrice,
    secondBins,
    analyticsMeta?.klineSlTp,
    analyticsMeta?.keyLevels,
    explicitAtrShort,
    analyticsMeta?.tpMode
  );

  const isCounterTrend = Boolean(analyticsMeta?.isCounterTrend);
  const grade: 'A+' | 'A' | 'B' =
    analyticsMeta?.grade ||
    computeSetupGrade(confidence, !isCounterTrend && confidence >= 75, isCounterTrend);
  const adaptiveMode = Boolean(analyticsMeta?.adaptiveMode);

  console.log(
    `[BTC TIDE TRADE PLAN] Created ${side} [Grade ${grade}${isCounterTrend ? ' CT' : ''}] trade @ $${entryPrice.toFixed(2)} | atr5m=$${plan.atr5m.toFixed(2)}, atr15m=$${plan.atr15m.toFixed(2)}, slDist=$${plan.slDist.toFixed(2)} (${plan.slPct.toFixed(2)}%), tpBase=$${plan.tpBase.toFixed(2)} (TP1=${plan.tp1R.toFixed(2)}R, TP2=${plan.tp2R.toFixed(2)}R, TP3=${plan.tp3R.toFixed(2)}R)`
  );

  const now = Date.now();
  const trade: BtcTideTradeRecord = {
    id: `btctide_${now}_${side.toLowerCase()}`,
    side,
    entryTime: now,
    entryPrice,
    initialSlPrice: plan.slPrice,
    slPrice: plan.slPrice,
    tp1Price: plan.tp1Price,
    tp2Price: plan.tp2Price,
    tp3Price: plan.tp3Price,
    oneR: plan.oneR,
    currentR: 0,
    pnlPercent: 0,
    tp1Hit: false,
    tp2Hit: false,
    tp3Hit: false,
    beMoved: false,
    status: 'ACTIVE',
    outcome: null,
    realizedR: null,
    pnlUsdPerBtc: null,
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
    atrShort: analyticsMeta?.atrShort ?? plan.atrShort,
    atr1h: analyticsMeta?.atr1h ?? null,
    atr5m: analyticsMeta?.atr5m ?? plan.atr5m,
    atr15m: analyticsMeta?.atr15m ?? plan.atr15m,
    slDist: plan.slDist,
    slPct: plan.slPct,
    tpBase: plan.tpBase,
    tpMode: plan.tpMode,
    tp1R: plan.tp1R,
    tp2R: plan.tp2R,
    tp3R: plan.tp3R,
    grade,
    isCounterTrend,
    adaptiveMode,
  };

  return trade;
}

/**
 * Evaluates an active trade against current real price on every tick.
 * - R is always measured against real slDist (oneR).
 * - After TP1, moves stop to entry +/- 0.1 x tpBase (profit-lock).
 * - Computes true realizedR (using true tp1R, tp2R, tp3R, beLockR) and dollar PnL per 1 BTC (pnlUsdPerBtc).
 */
export function evaluateActiveTradeTick(
  trade: BtcTideTradeRecord,
  currentPrice: number,
  now: number = Date.now()
): { updatedTrade: BtcTideTradeRecord; closed: boolean } {
  const isLong = trade.side === 'LONG';
  const oneR =
    trade.oneR > 0
      ? trade.oneR
      : Math.max(1, Math.abs(trade.entryPrice - trade.initialSlPrice));

  const tp1Dist = Math.abs(trade.tp1Price - trade.entryPrice);
  const tp2Dist = Math.abs(trade.tp2Price - trade.entryPrice);
  const tp3Dist = Math.abs(trade.tp3Price - trade.entryPrice);
  const tpBase =
    typeof trade.tpBase === 'number' && Number.isFinite(trade.tpBase) && trade.tpBase > 0
      ? trade.tpBase
      : tp1Dist;

  const rawTp1R = tp1Dist / oneR;
  const rawTp2R = tp2Dist / oneR;
  const rawTp3R = tp3Dist / oneR;

  const beLockDist = Number((TP1_PROFIT_LOCK_TPBASE_MULT * tpBase).toFixed(2));
  const rawBeLockR = beLockDist / oneR;
  const bePlusStopPrice = isLong
    ? Number((trade.entryPrice + beLockDist).toFixed(2))
    : Number((trade.entryPrice - beLockDist).toFixed(2));

  const liveDiffUsd = isLong
    ? currentPrice - trade.entryPrice
    : trade.entryPrice - currentPrice;

  // Live P&L in true R (against real SL distance)
  const currentR = Number((liveDiffUsd / oneR).toFixed(2));
  const pnlPercent = Number(((liveDiffUsd / trade.entryPrice) * 100).toFixed(2));

  const updated: BtcTideTradeRecord = {
    ...trade,
    currentR,
    pnlPercent,
    tpBase,
    tp1R: Number(rawTp1R.toFixed(2)),
    tp2R: Number(rawTp2R.toFixed(2)),
    tp3R: Number(rawTp3R.toFixed(2)),
  };

  // 1. Check Expiry (260 minutes — only applies if TP1 has NOT been hit)
  if (!trade.tp1Hit && now >= trade.expiryTime) {
    updated.status = 'CLOSED';
    updated.outcome = 'EXPIRED';
    updated.realizedR = currentR;
    updated.pnlUsdPerBtc = Number(liveDiffUsd.toFixed(2));
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
      updated.realizedR = Number(
        (0.5 * rawTp1R + 0.25 * rawTp2R + 0.25 * rawTp3R).toFixed(2)
      );
      updated.pnlUsdPerBtc = Number(
        (0.5 * tp1Dist + 0.25 * tp2Dist + 0.25 * tp3Dist).toFixed(2)
      );
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
      updated.slPrice = bePlusStopPrice; // Move stop to entry + 0.1 x tpBase (profit-lock)
      updated.status = 'TP1_HIT_BE_ACTIVE';
    }

    if (currentPrice <= updated.slPrice) {
      updated.status = 'CLOSED';
      updated.closedAt = now;
      updated.closePrice = currentPrice;

      if (updated.beMoved) {
        if (updated.tp2Hit) {
          updated.outcome = 'TP2';
          updated.realizedR = Number(
            (0.5 * rawTp1R + 0.25 * rawTp2R + 0.25 * rawBeLockR).toFixed(2)
          );
          updated.pnlUsdPerBtc = Number(
            (0.5 * tp1Dist + 0.25 * tp2Dist + 0.25 * beLockDist).toFixed(2)
          );
        } else {
          updated.outcome = 'TP1+BE';
          updated.realizedR = Number((0.5 * rawTp1R + 0.5 * rawBeLockR).toFixed(2));
          updated.pnlUsdPerBtc = Number((0.5 * tp1Dist + 0.5 * beLockDist).toFixed(2));
        }
      } else {
        updated.outcome = 'SL';
        updated.realizedR = -1.0;
        updated.pnlUsdPerBtc = Number((-oneR).toFixed(2));
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
      updated.realizedR = Number(
        (0.5 * rawTp1R + 0.25 * rawTp2R + 0.25 * rawTp3R).toFixed(2)
      );
      updated.pnlUsdPerBtc = Number(
        (0.5 * tp1Dist + 0.25 * tp2Dist + 0.25 * tp3Dist).toFixed(2)
      );
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
      updated.slPrice = bePlusStopPrice; // Move stop to entry - 0.1 x tpBase (profit-lock)
      updated.status = 'TP1_HIT_BE_ACTIVE';
    }

    if (currentPrice >= updated.slPrice) {
      updated.status = 'CLOSED';
      updated.closedAt = now;
      updated.closePrice = currentPrice;

      if (updated.beMoved) {
        if (updated.tp2Hit) {
          updated.outcome = 'TP2';
          updated.realizedR = Number(
            (0.5 * rawTp1R + 0.25 * rawTp2R + 0.25 * rawBeLockR).toFixed(2)
          );
          updated.pnlUsdPerBtc = Number(
            (0.5 * tp1Dist + 0.25 * tp2Dist + 0.25 * beLockDist).toFixed(2)
          );
        } else {
          updated.outcome = 'TP1+BE';
          updated.realizedR = Number((0.5 * rawTp1R + 0.5 * rawBeLockR).toFixed(2));
          updated.pnlUsdPerBtc = Number((0.5 * tp1Dist + 0.5 * beLockDist).toFixed(2));
        }
      } else {
        updated.outcome = 'SL';
        updated.realizedR = -1.0;
        updated.pnlUsdPerBtc = Number((-oneR).toFixed(2));
      }
      return { updatedTrade: updated, closed: true };
    }
  }

  // 4. Hard Maximum Trade Lifetime (260 minutes) after TP1 is hit:
  // If reached after TP1 without hitting TP3 or BE stop, close at market with outcome 'EXPIRED_AFTER_TP1'
  // and realizedR = real locked R (50% at tp1R, plus 25% at tp2R if hit, plus runner fraction at market).
  if (updated.tp1Hit && now - trade.entryTime >= MAX_TRADE_LIFETIME_MS) {
    updated.status = 'CLOSED';
    updated.outcome = 'EXPIRED_AFTER_TP1';
    const runnerR = liveDiffUsd / oneR;
    const lockedRunnerR = updated.tp2Hit
      ? 0.5 * rawTp1R + 0.25 * rawTp2R + 0.25 * runnerR
      : 0.5 * rawTp1R + 0.5 * runnerR;
    const lockedRunnerUsd = updated.tp2Hit
      ? 0.5 * tp1Dist + 0.25 * tp2Dist + 0.25 * liveDiffUsd
      : 0.5 * tp1Dist + 0.5 * liveDiffUsd;
    updated.realizedR = Number(lockedRunnerR.toFixed(2));
    updated.pnlUsdPerBtc = Number(lockedRunnerUsd.toFixed(2));
    updated.closedAt = now;
    updated.closePrice = currentPrice;
    return { updatedTrade: updated, closed: true };
  }

  return { updatedTrade: updated, closed: false };
}

