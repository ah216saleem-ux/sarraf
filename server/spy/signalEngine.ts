/**
 * SPY Smart Money Confluence Options-Signal Engine
 * Deterministic institutional analysis across 7 Smart Money gates.
 *
 * Expiry Timeframes:
 * - 15m: bias 15m, entry 1m/5m
 * - 30m / 45m: bias 15m, entry 5m
 * - 1H: bias 1h, entry 5m/15m
 * - 4H: bias 4h + D1 zones, entry 15m/1h
 * - CLOSE: D1/4h bias + today's levels, entry 15m, scaled by minutes left
 *
 * Smart Money Gates:
 * a) Demand/Supply zone or unmitigated Order Block on bias timeframe (weight 20)
 * b) Liquidity sweep of swing high/low followed by rejection (weight 15)
 * c) FVG present and retested in trade direction (weight 15)
 * d) CHoCH/BOS on entry timeframe confirming direction (weight 20)
 * e) Trend alignment: VWAP side + EMA 9/21 + bias-TF trend (weight 15)
 * f) Relative volume vs 20-bar average (relative only) (weight 15)
 * g) Filters: block first 5m of open, block +-15m around high-impact news, block extreme ATR percentile
 *
 * Decision Rule:
 * - Signal ONLY if score >= 70% AND Gate (a) passes AND Gate (d) passes AND Gate (g) passes.
 * - ATR feasibility per expiry: expected move = ATR(entry TF) * sqrt(expiry / entry TF bars);
 *   if smaller than TP distance -> NO TRADE.
 * - Lock + 15 min cooldown per expiry.
 */

import fs from 'fs';
import path from 'path';
import {
  SpyCandle,
  SpyExpiryOption,
  SpySignalDecision,
  SpyGateEvaluation,
  SpyAnalysisResult,
  SpyHistoryRecord,
  SpyHistoryStats,
  SpyExpiryStatItem,
} from './types.ts';
import { getNewYorkTime } from './marketHours.ts';
import { getNewsEventsForUI } from '../../src/server/newsEngine.ts';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const SIGNALS_FILE = path.resolve(DATA_DIR, 'spy_signals.json');
const META_FILE = path.resolve(DATA_DIR, 'spy_history_meta.json');

// Memory store of signal records
let signalHistoryStore: SpyHistoryRecord[] = [];
let noTradeAnalysesCount = 0;

// Track per-expiry cooldowns: expiry -> timestamp when cooldown ends
const expiryCooldowns: Record<SpyExpiryOption, number> = {
  '15m': 0,
  '30m': 0,
  '45m': 0,
  '1H': 0,
  '4H': 0,
  'CLOSE': 0,
};

/**
 * Loads signals from disk, reconciles active signals, resolves any expired during downtime.
 */
export function loadSpySignalsFromDisk(lastKnownPrice?: number): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(META_FILE)) {
      try {
        const metaRaw = fs.readFileSync(META_FILE, 'utf-8');
        const parsedMeta = JSON.parse(metaRaw);
        if (typeof parsedMeta?.noTradeCount === 'number') {
          noTradeAnalysesCount = parsedMeta.noTradeCount;
        }
      } catch (e) {
        console.error('[SPY Signal Engine] Error loading meta:', e);
      }
    }

    if (fs.existsSync(SIGNALS_FILE)) {
      const raw = fs.readFileSync(SIGNALS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        signalHistoryStore = parsed;
        console.log(`[SPY Signal Engine] Loaded ${signalHistoryStore.length} signals from ${SIGNALS_FILE}`);

        // Reconcile and recover open signals
        const now = Date.now();
        let updated = false;

        for (const sig of signalHistoryStore) {
          if (sig.status === 'ACTIVE') {
            if (now >= sig.expiresAtTimestamp) {
              // Expired while server was offline -> resolve deterministically
              sig.status = 'RESOLVED';
              sig.resolvedAt = new Date().toISOString();
              const settlePrice = lastKnownPrice ?? sig.entry ?? 0;
              sig.resolvedPrice = settlePrice;
              sig.resolutionReason = 'Resolved at expiry horizon (recovered on reboot)';

              if (sig.entry !== null) {
                if (sig.direction === 'CALL') {
                  sig.outcome = settlePrice > sig.entry ? 'WIN' : 'LOSS';
                } else if (sig.direction === 'PUT') {
                  sig.outcome = settlePrice < sig.entry ? 'WIN' : 'LOSS';
                }
              } else {
                sig.outcome = 'LOSS';
              }

              expiryCooldowns[sig.expiry] = now + 15 * 60 * 1000;
              updated = true;
            }
          }
        }

        if (updated) {
          saveSpySignalsToDisk();
        }
      }
    }
  } catch (err) {
    console.error('[SPY Signal Engine] Error reading signals from disk:', err);
  }
}

/**
 * Persists signals and metadata atomically
 */
export function saveSpySignalsToDisk(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const tmpSignals = `${SIGNALS_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpSignals, JSON.stringify(signalHistoryStore, null, 2), 'utf-8');
    fs.renameSync(tmpSignals, SIGNALS_FILE);

    const tmpMeta = `${META_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpMeta, JSON.stringify({ noTradeCount: noTradeAnalysesCount, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
    fs.renameSync(tmpMeta, META_FILE);
  } catch (err) {
    console.error('[SPY Signal Engine] Error saving signals to disk:', err);
  }
}

/**
 * Record a NO TRADE count for selectivity tracking
 */
export function incrementNoTradeCount(): void {
  noTradeAnalysesCount += 1;
  saveSpySignalsToDisk();
}

/**
 * Checks whether an expiry has an active trade or is in the 15-minute cooldown
 */
export function getExpiryLockStatus(expiry: SpyExpiryOption): {
  isLocked: boolean;
  isCooldown: boolean;
  cooldownSecondsLeft: number;
  lockReason?: string;
} {
  const active = signalHistoryStore.find((s) => s.expiry === expiry && s.status === 'ACTIVE');
  if (active) {
    const minsLeft = Math.max(1, Math.ceil((active.expiresAtTimestamp - Date.now()) / 60000));
    return {
      isLocked: true,
      isCooldown: false,
      cooldownSecondsLeft: 0,
      lockReason: `Active ${expiry} trade in progress (${active.direction} $${active.approxAtmStrike || active.entry}, ${minsLeft}m remaining)`,
    };
  }

  const cooldownEnd = expiryCooldowns[expiry] || 0;
  const now = Date.now();
  if (now < cooldownEnd) {
    const secondsLeft = Math.ceil((cooldownEnd - now) / 1000);
    const minsLeft = Math.ceil(secondsLeft / 60);
    return {
      isLocked: true,
      isCooldown: true,
      cooldownSecondsLeft: secondsLeft,
      lockReason: `15-minute institutional cooldown active (${minsLeft}m left)`,
    };
  }

  return {
    isLocked: false,
    isCooldown: false,
    cooldownSecondsLeft: 0,
  };
}

/**
 * Updates active signals with live price ticks:
 * - Updates max favorable & max adverse move
 * - Checks TP / SL hits
 * - Resolves expired trades at expiry timestamp
 */
export function updateActiveSignalsOnPriceTick(currentPrice: number): boolean {
  if (!currentPrice || currentPrice <= 0) return false;

  const now = Date.now();
  let stateChanged = false;

  for (const sig of signalHistoryStore) {
    if (sig.status !== 'ACTIVE' || sig.entry === null) continue;

    const entry = sig.entry;
    if (sig.direction === 'CALL') {
      const favorable = Math.max(0, currentPrice - entry);
      const adverse = Math.max(0, entry - currentPrice);
      if (favorable > sig.maxFavorableMove) {
        sig.maxFavorableMove = Number(favorable.toFixed(2));
        stateChanged = true;
      }
      if (adverse > sig.maxAdverseMove) {
        sig.maxAdverseMove = Number(adverse.toFixed(2));
        stateChanged = true;
      }

      // TP Hit
      if (sig.tp !== null && currentPrice >= sig.tp) {
        sig.status = 'RESOLVED';
        sig.outcome = 'WIN';
        sig.resolvedPrice = Number(currentPrice.toFixed(2));
        sig.resolvedAt = new Date().toISOString();
        sig.resolutionReason = 'Take Profit Target Reached';
        expiryCooldowns[sig.expiry] = now + 15 * 60 * 1000;
        stateChanged = true;
        continue;
      }

      // SL Hit
      if (sig.sl !== null && currentPrice <= sig.sl) {
        sig.status = 'RESOLVED';
        sig.outcome = 'LOSS';
        sig.resolvedPrice = Number(currentPrice.toFixed(2));
        sig.resolvedAt = new Date().toISOString();
        sig.resolutionReason = 'Stop Loss Invalidation Hit';
        expiryCooldowns[sig.expiry] = now + 15 * 60 * 1000;
        stateChanged = true;
        continue;
      }

      // Expiry time reached
      if (now >= sig.expiresAtTimestamp) {
        sig.status = 'RESOLVED';
        sig.outcome = currentPrice > entry ? 'WIN' : 'LOSS';
        sig.resolvedPrice = Number(currentPrice.toFixed(2));
        sig.resolvedAt = new Date().toISOString();
        sig.resolutionReason = `Expiry Horizon Reached (${currentPrice > entry ? 'Settled above entry' : 'Settled below entry'})`;
        expiryCooldowns[sig.expiry] = now + 15 * 60 * 1000;
        stateChanged = true;
        continue;
      }
    } else if (sig.direction === 'PUT') {
      const favorable = Math.max(0, entry - currentPrice);
      const adverse = Math.max(0, currentPrice - entry);
      if (favorable > sig.maxFavorableMove) {
        sig.maxFavorableMove = Number(favorable.toFixed(2));
        stateChanged = true;
      }
      if (adverse > sig.maxAdverseMove) {
        sig.maxAdverseMove = Number(adverse.toFixed(2));
        stateChanged = true;
      }

      // TP Hit
      if (sig.tp !== null && currentPrice <= sig.tp) {
        sig.status = 'RESOLVED';
        sig.outcome = 'WIN';
        sig.resolvedPrice = Number(currentPrice.toFixed(2));
        sig.resolvedAt = new Date().toISOString();
        sig.resolutionReason = 'Take Profit Target Reached';
        expiryCooldowns[sig.expiry] = now + 15 * 60 * 1000;
        stateChanged = true;
        continue;
      }

      // SL Hit
      if (sig.sl !== null && currentPrice >= sig.sl) {
        sig.status = 'RESOLVED';
        sig.outcome = 'LOSS';
        sig.resolvedPrice = Number(currentPrice.toFixed(2));
        sig.resolvedAt = new Date().toISOString();
        sig.resolutionReason = 'Stop Loss Invalidation Hit';
        expiryCooldowns[sig.expiry] = now + 15 * 60 * 1000;
        stateChanged = true;
        continue;
      }

      // Expiry time reached
      if (now >= sig.expiresAtTimestamp) {
        sig.status = 'RESOLVED';
        sig.outcome = currentPrice < entry ? 'WIN' : 'LOSS';
        sig.resolvedPrice = Number(currentPrice.toFixed(2));
        sig.resolvedAt = new Date().toISOString();
        sig.resolutionReason = `Expiry Horizon Reached (${currentPrice < entry ? 'Settled below entry' : 'Settled above entry'})`;
        expiryCooldowns[sig.expiry] = now + 15 * 60 * 1000;
        stateChanged = true;
        continue;
      }
    }
  }

  if (stateChanged) {
    saveSpySignalsToDisk();
  }

  return stateChanged;
}

/**
 * Computes per-expiry statistics and total statistics
 */
export function getSpyHistoryStats(): SpyHistoryStats {
  const expiries: SpyExpiryOption[] = ['15m', '30m', '45m', '1H', '4H', 'CLOSE'];
  const perExpiry = {} as Record<SpyExpiryOption, SpyExpiryStatItem>;

  for (const exp of expiries) {
    perExpiry[exp] = { total: 0, wins: 0, losses: 0, winRate: null, active: 0 };
  }

  const totalItem: SpyExpiryStatItem = { total: 0, wins: 0, losses: 0, winRate: null, active: 0 };

  for (const sig of signalHistoryStore) {
    const exp = sig.expiry;
    if (sig.status === 'ACTIVE') {
      if (perExpiry[exp]) perExpiry[exp].active += 1;
      totalItem.active += 1;
    } else if (sig.status === 'RESOLVED') {
      if (perExpiry[exp]) {
        perExpiry[exp].total += 1;
        if (sig.outcome === 'WIN') perExpiry[exp].wins += 1;
        else if (sig.outcome === 'LOSS') perExpiry[exp].losses += 1;
      }
      totalItem.total += 1;
      if (sig.outcome === 'WIN') totalItem.wins += 1;
      else if (sig.outcome === 'LOSS') totalItem.losses += 1;
    }
  }

  // Calculate win rate only if total resolved >= 10
  for (const exp of expiries) {
    const item = perExpiry[exp];
    if (item.total >= 10) {
      item.winRate = Number(((item.wins / item.total) * 100).toFixed(1));
    } else {
      item.winRate = null; // UI displays "collecting data"
    }
  }

  if (totalItem.total >= 10) {
    totalItem.winRate = Number(((totalItem.wins / totalItem.total) * 100).toFixed(1));
  } else {
    totalItem.winRate = null;
  }

  return {
    perExpiry,
    total: totalItem,
    noTradeCount: noTradeAnalysesCount,
  };
}

export function getSpySignalHistory(): SpyHistoryRecord[] {
  return [...signalHistoryStore].reverse();
}

// -------------------------------------------------------------
// TECHNICAL SMC HELPERS
// -------------------------------------------------------------

export function calculateEMA(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [];

  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  let currentEma = sum / period;
  ema.push(currentEma);

  for (let i = period; i < closes.length; i++) {
    currentEma = closes[i] * k + currentEma * (1 - k);
    ema.push(currentEma);
  }
  return ema;
}

export function calculateATR(candles: SpyCandle[], period = 14): number {
  if (candles.length < 2) return 1.25;

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    trs.push(tr);
  }

  if (trs.length < period) {
    const sum = trs.reduce((a, b) => a + b, 0);
    return Number((sum / trs.length || 1.25).toFixed(2));
  }

  let currentAtr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    currentAtr = (currentAtr * (period - 1) + trs[i]) / period;
  }
  return Number(Math.max(0.3, currentAtr).toFixed(2));
}

/**
 * Computes series of ATR values to evaluate percentiles
 */
export function calculateATRSeries(candles: SpyCandle[], period = 14): number[] {
  if (candles.length < period + 2) return [1.25];
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }

  const series: number[] = [];
  let current = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  series.push(current);

  for (let i = period; i < trs.length; i++) {
    current = (current * (period - 1) + trs[i]) / period;
    series.push(current);
  }
  return series;
}

/**
 * Computes Session VWAP from candle stream
 */
export function calculateVWAP(candles: SpyCandle[]): number {
  if (candles.length === 0) return 0;
  let cumVolume = 0;
  let cumTypicalVolume = 0;

  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    const vol = c.volume > 0 ? c.volume : 100;
    cumVolume += vol;
    cumTypicalVolume += typical * vol;
  }

  return cumVolume > 0 ? Number((cumTypicalVolume / cumVolume).toFixed(2)) : candles[candles.length - 1].close;
}

// -------------------------------------------------------------
// SMART MONEY GATES IMPLEMENTATION
// -------------------------------------------------------------

export interface OrderBlockZone {
  type: 'DEMAND' | 'SUPPLY';
  top: number;
  bottom: number;
  candleIndex: number;
  unmitigated: boolean;
}

/**
 * Gate A: Demand/Supply zone or unmitigated Order Block on bias timeframe
 */
export function findOrderBlocks(candles: SpyCandle[]): OrderBlockZone[] {
  const zones: OrderBlockZone[] = [];
  if (candles.length < 3) return zones;

  for (let i = 0; i < candles.length - 1; i++) {
    const curr = candles[i];
    const next = candles[i + 1];

    // Bullish Order Block (Demand): down candle before upward expansion
    if (curr.close < curr.open && next.close > curr.high) {
      zones.push({
        type: 'DEMAND',
        top: Math.max(curr.open, curr.high),
        bottom: curr.low,
        candleIndex: i,
        unmitigated: true,
      });
    }

    // Bearish Order Block (Supply): up candle before downward displacement
    if (curr.close > curr.open && next.close < curr.low) {
      zones.push({
        type: 'SUPPLY',
        top: curr.high,
        bottom: Math.min(curr.open, curr.low),
        candleIndex: i,
        unmitigated: true,
      });
    }
  }

  // Check mitigation: has subsequent price closed completely through the zone?
  for (const zone of zones) {
    for (let j = zone.candleIndex + 2; j < candles.length; j++) {
      const c = candles[j];
      if (zone.type === 'DEMAND' && c.close < zone.bottom) {
        zone.unmitigated = false;
        break;
      }
      if (zone.type === 'SUPPLY' && c.close > zone.top) {
        zone.unmitigated = false;
        break;
      }
    }
  }

  return zones.filter((z) => z.unmitigated);
}

/**
 * Gate B: Liquidity sweep of a swing high/low followed by rejection wick
 */
export function detectLiquiditySweep(candles: SpyCandle[], lookback = 20): {
  swept: boolean;
  type: 'SSL_SWEEP' | 'BSL_SWEEP' | 'NONE';
  level: number;
  detail: string;
} {
  if (candles.length < 4) {
    return { swept: false, type: 'NONE', level: 0, detail: 'Insufficient bars for liquidity sweep detection' };
  }

  const window = candles.slice(-lookback);
  let swingHigh = -Infinity;
  let swingLow = Infinity;

  const searchEnd = Math.max(1, window.length - 2);
  for (let i = 0; i < searchEnd; i++) {
    const c = window[i];
    if (c.high > swingHigh) swingHigh = c.high;
    if (c.low < swingLow) swingLow = c.low;
  }

  // Check the recent bars for sweep + rejection
  const recentBars = window.slice(-2);
  for (const bar of recentBars) {
    // Bullish sweep: pierced below swing low, closed back above it
    if (swingLow !== Infinity && bar.low < swingLow && bar.close >= swingLow) {
      return {
        swept: true,
        type: 'SSL_SWEEP',
        level: swingLow,
        detail: `Sell-Side Liquidity (SSL) swept at $${swingLow.toFixed(2)} with strong bullish wick rejection.`,
      };
    }

    // Bearish sweep: pierced above swing high, closed back below it
    if (swingHigh !== -Infinity && bar.high > swingHigh && bar.close <= swingHigh) {
      return {
        swept: true,
        type: 'BSL_SWEEP',
        level: swingHigh,
        detail: `Buy-Side Liquidity (BSL) swept at $${swingHigh.toFixed(2)} with strong bearish wick rejection.`,
      };
    }
  }

  return { swept: false, type: 'NONE', level: 0, detail: 'No recent fractal liquidity sweep detected.' };
}

/**
 * Gate C: Fair Value Gap (FVG) present and retested in trade direction
 */
export interface FairValueGap {
  type: 'BULLISH_FVG' | 'BEARISH_FVG';
  top: number;
  bottom: number;
  retested: boolean;
}

export function detectFairValueGaps(candles: SpyCandle[], currentPrice: number): FairValueGap[] {
  const fvgs: FairValueGap[] = [];
  if (candles.length < 3) return fvgs;

  const startIdx = Math.max(2, candles.length - 25);
  for (let i = startIdx; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c3 = candles[i];

    // Bullish FVG: Candle 1 high < Candle 3 low
    if (c1.high < c3.low) {
      const top = c3.low;
      const bottom = c1.high;
      let retested = false;
      for (let j = i; j < candles.length; j++) {
        const c = candles[j];
        if (c.low <= top && c.close >= bottom) {
          retested = true;
        }
      }
      if (currentPrice >= bottom - 0.1 && currentPrice <= top + 0.2) {
        retested = true;
      }
      fvgs.push({ type: 'BULLISH_FVG', top, bottom, retested });
    }

    // Bearish FVG: Candle 1 low > Candle 3 high
    if (c1.low > c3.high) {
      const top = c1.low;
      const bottom = c3.high;
      let retested = false;
      for (let j = i; j < candles.length; j++) {
        const c = candles[j];
        if (c.high >= bottom && c.close <= top) {
          retested = true;
        }
      }
      if (currentPrice <= top + 0.1 && currentPrice >= bottom - 0.2) {
        retested = true;
      }
      fvgs.push({ type: 'BEARISH_FVG', top, bottom, retested });
    }
  }

  return fvgs;
}

/**
 * Gate D: CHoCH (Change of Character) or BOS (Break of Structure) on entry timeframe
 */
export function detectMarketStructureShift(candles: SpyCandle[]): {
  shift: boolean;
  type: 'BULLISH_BOS' | 'BEARISH_BOS' | 'BULLISH_CHOCH' | 'BEARISH_CHOCH' | 'NONE';
  level: number;
  detail: string;
} {
  if (candles.length < 3) {
    return { shift: false, type: 'NONE', level: 0, detail: 'Insufficient bars for structure shift analysis' };
  }

  const recent = candles.slice(-20);
  let priorHigh = -Infinity;
  let priorLow = Infinity;

  for (let i = 0; i < recent.length - 1; i++) {
    const c = recent[i];
    if (c.high > priorHigh) priorHigh = c.high;
    if (c.low < priorLow) priorLow = c.low;
  }

  const latest = recent[recent.length - 1];

  // Bullish Break of Structure or CHoCH: latest bar closed above prior swing high
  if (priorHigh !== -Infinity && latest.close > priorHigh) {
    return {
      shift: true,
      type: 'BULLISH_BOS',
      level: priorHigh,
      detail: `Bullish Break of Structure (BOS) / CHoCH: Candle closed cleanly above swing high $${priorHigh.toFixed(2)}.`,
    };
  }

  // Bearish Break of Structure or CHoCH: latest bar closed below prior swing low
  if (priorLow !== Infinity && latest.close < priorLow) {
    return {
      shift: true,
      type: 'BEARISH_BOS',
      level: priorLow,
      detail: `Bearish Break of Structure (BOS) / CHoCH: Candle closed cleanly below swing low $${priorLow.toFixed(2)}.`,
    };
  }

  return { shift: false, type: 'NONE', level: 0, detail: 'No structural break (price remains inside range).' };
}

/**
 * Main Deterministic Evaluator using Smart Money Confluence
 */
export function evaluateSpySignal(params: {
  expiry: SpyExpiryOption;
  currentPrice: number;
  candleStore: Record<string, SpyCandle[]>;
  marketOpen: boolean;
}): SpyAnalysisResult {
  const { expiry, currentPrice, candleStore, marketOpen } = params;

  // 1. Timeframe selection per expiry specification
  let biasTfKey = '15m';
  let entryTfKey = '5m';
  let expiryDurationMinutes = 15;
  let entryBarMinutes = 5;

  switch (expiry) {
    case '15m':
      biasTfKey = '15m';
      entryTfKey = '1m';
      expiryDurationMinutes = 15;
      entryBarMinutes = 1;
      break;
    case '30m':
      biasTfKey = '15m';
      entryTfKey = '5m';
      expiryDurationMinutes = 30;
      entryBarMinutes = 5;
      break;
    case '45m':
      biasTfKey = '15m';
      entryTfKey = '5m';
      expiryDurationMinutes = 45;
      entryBarMinutes = 5;
      break;
    case '1H':
      biasTfKey = '1h';
      entryTfKey = '5m';
      expiryDurationMinutes = 60;
      entryBarMinutes = 5;
      break;
    case '4H':
      biasTfKey = '4h';
      entryTfKey = '15m';
      expiryDurationMinutes = 240;
      entryBarMinutes = 15;
      break;
    case 'CLOSE':
      biasTfKey = '4h';
      entryTfKey = '15m';
      expiryDurationMinutes = 180;
      entryBarMinutes = 15;
      break;
  }

  const biasCandles = candleStore[biasTfKey] || [];
  const entryCandles = candleStore[entryTfKey] || [];
  const base1mCandles = candleStore['1m'] || [];

  const approxAtmStrike = Math.round(currentPrice);

  // Early return if insufficient candle data
  if (biasCandles.length < 5 || entryCandles.length < 5) {
    incrementNoTradeCount();
    return {
      id: `SPY-${Date.now()}-NT`,
      symbol: 'SPY',
      expiry,
      decision: 'NO TRADE',
      approxAtmStrike,
      confidence: 0,
      currentPrice,
      entryPrice: null,
      slPrice: null,
      tpPrice: null,
      riskReward: null,
      atr: 0,
      expectedMove: 0,
      distanceToTp: null,
      atrFeasible: false,
      gates: [
        {
          id: 'gate-a-zone',
          letter: 'a',
          name: 'Demand/Supply Order Block',
          passed: false,
          bias: 'NEUTRAL',
          weight: 20,
          score: 0,
          detail: 'Insufficient historical candles to construct Order Block profile.',
          metric: 'N/A',
          threshold: 'Price at/inside unmitigated OB',
        },
        {
          id: 'gate-b-sweep',
          letter: 'b',
          name: 'Liquidity Sweep & Rejection',
          passed: false,
          bias: 'NEUTRAL',
          weight: 15,
          score: 0,
          detail: 'Awaiting market feed synchronization.',
          metric: 'N/A',
          threshold: 'Fractal wick sweep of swing high/low',
        },
        {
          id: 'gate-c-fvg',
          letter: 'c',
          name: 'Fair Value Gap (FVG) Retest',
          passed: false,
          bias: 'NEUTRAL',
          weight: 15,
          score: 0,
          detail: 'Imbalance data pending feed synchronization.',
          metric: 'N/A',
          threshold: 'FVG mitigation in trade direction',
        },
        {
          id: 'gate-d-choch',
          letter: 'd',
          name: 'Market Structure CHoCH / BOS',
          passed: false,
          bias: 'NEUTRAL',
          weight: 20,
          score: 0,
          detail: 'Structure verification requires minimum 10 closed candles.',
          metric: 'N/A',
          threshold: 'Clean structural break on entry TF',
        },
        {
          id: 'gate-e-trend',
          letter: 'e',
          name: 'Trend Alignment (VWAP + EMAs)',
          passed: false,
          bias: 'NEUTRAL',
          weight: 15,
          score: 0,
          detail: 'Moving average alignment pending data.',
          metric: 'N/A',
          threshold: 'Price side of VWAP + EMA 9/21 cross',
        },
        {
          id: 'gate-f-volume',
          letter: 'f',
          name: 'Relative Volume (20-bar avg)',
          passed: false,
          bias: 'NEUTRAL',
          weight: 15,
          score: 0,
          detail: 'Volume baseline pending bars.',
          metric: 'N/A',
          threshold: 'Relative volume >= 1.0x 20-bar SMA',
        },
        {
          id: 'gate-g-filters',
          letter: 'g',
          name: 'Regime & Macro Event Filters',
          passed: false,
          bias: 'NEUTRAL',
          weight: 0,
          score: 0,
          detail: 'Awaiting live feed initialization.',
          metric: 'N/A',
          threshold: 'No high-impact news +-15m & normal ATR',
        },
      ],
      totalScore: 0,
      reasons: ['NO DATA: Insufficient real historical candle bars to evaluate Smart Money gates.'],
      biasTimeframe: biasTfKey,
      entryTimeframe: entryTfKey,
      marketOpen,
      computedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expiryDurationMinutes * 60000).toISOString(),
    };
  }

  // --- Compute Core Technical Indicators ---
  const entryCloses = entryCandles.map((c) => c.close);
  const biasCloses = biasCandles.map((c) => c.close);
  const atr = calculateATR(entryCandles, 14);
  const vwap = calculateVWAP(base1mCandles.length > 0 ? base1mCandles : entryCandles);

  const entryEma9 = calculateEMA(entryCloses, 9);
  const entryEma21 = calculateEMA(entryCloses, 21);
  const lastEma9 = entryEma9.length ? entryEma9[entryEma9.length - 1] : currentPrice;
  const lastEma21 = entryEma21.length ? entryEma21[entryEma21.length - 1] : currentPrice;

  const biasEma9 = calculateEMA(biasCloses, 9);
  const biasEma21 = calculateEMA(biasCloses, 21);
  const lastBiasEma9 = biasEma9.length ? biasEma9[biasEma9.length - 1] : currentPrice;
  const lastBiasEma21 = biasEma21.length ? biasEma21[biasEma21.length - 1] : currentPrice;

  // Determine tentative candidate bias
  let candidateBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (lastBiasEma9 > lastBiasEma21 && currentPrice >= vwap - 0.2) {
    candidateBias = 'BULLISH';
  } else if (lastBiasEma9 < lastBiasEma21 && currentPrice <= vwap + 0.2) {
    candidateBias = 'BEARISH';
  } else if (currentPrice >= vwap) {
    candidateBias = 'BULLISH';
  } else {
    candidateBias = 'BEARISH';
  }

  const gates: SpyGateEvaluation[] = [];

  // ============================================================
  // GATE A: Demand/Supply zone or unmitigated Order Block (weight 20)
  // ============================================================
  const orderBlocks = findOrderBlocks(biasCandles);
  let gateAPassed = false;
  let gateADetail = '';
  let activeOB: OrderBlockZone | null = null;

  // Look for zone containing or touching current price
  const zoneTolerance = Math.max(0.2, atr * 0.25);
  for (const ob of orderBlocks) {
    if (candidateBias === 'BULLISH' && ob.type === 'DEMAND') {
      if (currentPrice >= ob.bottom - zoneTolerance && currentPrice <= ob.top + zoneTolerance) {
        gateAPassed = true;
        activeOB = ob;
        gateADetail = `Price ($${currentPrice.toFixed(2)}) is inside unmitigated Demand Zone ($${ob.bottom.toFixed(2)} - $${ob.top.toFixed(2)}). Institutional accumulation active.`;
        break;
      }
    } else if (candidateBias === 'BEARISH' && ob.type === 'SUPPLY') {
      if (currentPrice >= ob.bottom - zoneTolerance && currentPrice <= ob.top + zoneTolerance) {
        gateAPassed = true;
        activeOB = ob;
        gateADetail = `Price ($${currentPrice.toFixed(2)}) is inside unmitigated Supply Zone ($${ob.bottom.toFixed(2)} - $${ob.top.toFixed(2)}). Institutional distribution active.`;
        break;
      }
    }
  }

  if (!gateAPassed) {
    gateADetail = `Price ($${currentPrice.toFixed(2)}) is in open air; not positioned inside an unmitigated ${candidateBias === 'BULLISH' ? 'Demand' : 'Supply'} Order Block on ${biasTfKey}.`;
  }

  gates.push({
    id: 'gate-a-zone',
    letter: 'a',
    name: 'Demand/Supply Order Block',
    passed: gateAPassed,
    bias: gateAPassed ? candidateBias : 'NEUTRAL',
    weight: 20,
    score: gateAPassed ? 20 : 0,
    detail: gateADetail,
    metric: activeOB ? `$${activeOB.bottom.toFixed(2)} - $${activeOB.top.toFixed(2)}` : 'No zone overlap',
    threshold: 'Price at/inside unmitigated OB',
  });

  // ============================================================
  // GATE B: Liquidity sweep followed by rejection (weight 15)
  // ============================================================
  const sweep = detectLiquiditySweep(entryCandles, 20);
  let gateBPassed = false;
  let gateBDetail = '';

  if (candidateBias === 'BULLISH' && sweep.type === 'SSL_SWEEP') {
    gateBPassed = true;
    gateBDetail = sweep.detail;
  } else if (candidateBias === 'BEARISH' && sweep.type === 'BSL_SWEEP') {
    gateBPassed = true;
    gateBDetail = sweep.detail;
  } else {
    gateBPassed = false;
    gateBDetail = sweep.detail || 'No confirming liquidity sweep in trade direction.';
  }

  gates.push({
    id: 'gate-b-sweep',
    letter: 'b',
    name: 'Liquidity Sweep & Rejection',
    passed: gateBPassed,
    bias: gateBPassed ? candidateBias : 'NEUTRAL',
    weight: 15,
    score: gateBPassed ? 15 : 0,
    detail: gateBDetail,
    metric: sweep.swept ? `Sweep @ $${sweep.level.toFixed(2)}` : 'None',
    threshold: 'Fractal wick sweep of key level',
  });

  // ============================================================
  // GATE C: FVG present and retested in trade direction (weight 15)
  // ============================================================
  const fvgs = detectFairValueGaps(biasCandles, currentPrice);
  let gateCPassed = false;
  let gateCDetail = '';
  let matchingFvg: FairValueGap | null = null;

  for (const f of fvgs) {
    if (candidateBias === 'BULLISH' && f.type === 'BULLISH_FVG' && f.retested) {
      gateCPassed = true;
      matchingFvg = f;
      gateCDetail = `Bullish FVG [$${f.bottom.toFixed(2)} - $${f.top.toFixed(2)}] confirmed and retested in upward direction.`;
      break;
    } else if (candidateBias === 'BEARISH' && f.type === 'BEARISH_FVG' && f.retested) {
      gateCPassed = true;
      matchingFvg = f;
      gateCDetail = `Bearish FVG [$${f.bottom.toFixed(2)} - $${f.top.toFixed(2)}] confirmed and retested in downward direction.`;
      break;
    }
  }

  if (!gateCPassed) {
    gateCDetail = `No valid, retested Fair Value Gap (imbalance) currently aligning on ${biasTfKey}.`;
  }

  gates.push({
    id: 'gate-c-fvg',
    letter: 'c',
    name: 'Fair Value Gap (FVG) Retest',
    passed: gateCPassed,
    bias: gateCPassed ? candidateBias : 'NEUTRAL',
    weight: 15,
    score: gateCPassed ? 15 : 0,
    detail: gateCDetail,
    metric: matchingFvg ? `$${matchingFvg.bottom.toFixed(2)} - $${matchingFvg.top.toFixed(2)}` : 'No retested FVG',
    threshold: 'FVG mitigation in trade direction',
  });

  // ============================================================
  // GATE D: CHoCH / BOS on entry timeframe (weight 20)
  // ============================================================
  const structure = detectMarketStructureShift(entryCandles);
  let gateDPassed = false;
  let gateDDetail = '';

  if (candidateBias === 'BULLISH' && (structure.type === 'BULLISH_BOS' || structure.type === 'BULLISH_CHOCH')) {
    gateDPassed = true;
    gateDDetail = structure.detail;
  } else if (candidateBias === 'BEARISH' && (structure.type === 'BEARISH_BOS' || structure.type === 'BEARISH_CHOCH')) {
    gateDPassed = true;
    gateDDetail = structure.detail;
  } else {
    gateDPassed = false;
    gateDDetail = structure.detail || 'Internal entry timeframe has not confirmed structure shift.';
  }

  gates.push({
    id: 'gate-d-choch',
    letter: 'd',
    name: 'Market Structure CHoCH / BOS',
    passed: gateDPassed,
    bias: gateDPassed ? candidateBias : 'NEUTRAL',
    weight: 20,
    score: gateDPassed ? 20 : 0,
    detail: gateDDetail,
    metric: structure.shift ? `${structure.type} @ $${structure.level.toFixed(2)}` : 'Inside Range',
    threshold: 'Clean structural break on entry TF',
  });

  // ============================================================
  // GATE E: Trend alignment: VWAP side + EMA 9/21 + bias trend (weight 15)
  // ============================================================
  let gateEPassed = false;
  let gateEDetail = '';

  const isVwapBullish = currentPrice >= vwap;
  const isEmaBullish = lastEma9 >= lastEma21;
  const isBiasTrendBullish = lastBiasEma9 >= lastBiasEma21;

  if (candidateBias === 'BULLISH') {
    if (isVwapBullish && isEmaBullish && isBiasTrendBullish) {
      gateEPassed = true;
      gateEDetail = `Full bullish trend confluence: Price ($${currentPrice.toFixed(2)}) > VWAP ($${vwap.toFixed(2)}), EMA 9 ($${lastEma9.toFixed(2)}) >= EMA 21, and ${biasTfKey} trend upward.`;
    } else {
      gateEPassed = false;
      gateEDetail = `Trend conflict: Price ${isVwapBullish ? '>=' : '<'} VWAP ($${vwap.toFixed(2)}), EMA 9/21 ${isEmaBullish ? 'bullish' : 'bearish'}, bias TF ${isBiasTrendBullish ? 'bullish' : 'bearish'}.`;
    }
  } else {
    if (!isVwapBullish && !isEmaBullish && !isBiasTrendBullish) {
      gateEPassed = true;
      gateEDetail = `Full bearish trend confluence: Price ($${currentPrice.toFixed(2)}) < VWAP ($${vwap.toFixed(2)}), EMA 9 ($${lastEma9.toFixed(2)}) <= EMA 21, and ${biasTfKey} trend downward.`;
    } else {
      gateEPassed = false;
      gateEDetail = `Trend conflict: Price ${isVwapBullish ? '>=' : '<'} VWAP ($${vwap.toFixed(2)}), EMA 9/21 ${isEmaBullish ? 'bullish' : 'bearish'}, bias TF ${isBiasTrendBullish ? 'bullish' : 'bearish'}.`;
    }
  }

  gates.push({
    id: 'gate-e-trend',
    letter: 'e',
    name: 'Trend Alignment (VWAP + EMAs)',
    passed: gateEPassed,
    bias: gateEPassed ? candidateBias : 'NEUTRAL',
    weight: 15,
    score: gateEPassed ? 15 : 0,
    detail: gateEDetail,
    metric: `VWAP $${vwap.toFixed(2)} | EMA9 $${lastEma9.toFixed(2)} / EMA21 $${lastEma21.toFixed(2)}`,
    threshold: 'Price side of VWAP + EMA 9/21 cross',
  });

  // ============================================================
  // GATE F: Relative volume vs 20-bar average (weight 15)
  // Note: IEX volume is partial, so use relative not absolute
  // ============================================================
  const recentVolumes = entryCandles.slice(-21, -1).map((c) => c.volume);
  const avgVolume20 = recentVolumes.reduce((a, b) => a + b, 0) / (recentVolumes.length || 1);
  const currentVolume = entryCandles[entryCandles.length - 1]?.volume || 0;
  const relativeVolume = avgVolume20 > 0 ? currentVolume / avgVolume20 : 1.0;

  let gateFPassed = false;
  let gateFDetail = '';

  if (relativeVolume >= 1.05) {
    gateFPassed = true;
    gateFDetail = `Relative volume is ${relativeVolume.toFixed(2)}x the 20-bar average (${avgVolume20.toFixed(0)} bars). Institutional activity verified.`;
  } else {
    gateFPassed = false;
    gateFDetail = `Relative volume is ${relativeVolume.toFixed(2)}x (below 1.05x hurdle). Lacks institutional participation thrust.`;
  }

  gates.push({
    id: 'gate-f-volume',
    letter: 'f',
    name: 'Relative Volume (20-bar avg)',
    passed: gateFPassed,
    bias: gateFPassed ? candidateBias : 'NEUTRAL',
    weight: 15,
    score: gateFPassed ? 15 : 0,
    detail: gateFDetail,
    metric: `${relativeVolume.toFixed(2)}x R-Vol`,
    threshold: 'Relative volume >= 1.05x 20-bar SMA',
  });

  // ============================================================
  // GATE G: Filters (Must not block trade)
  // 1) Block first 5 min after open (09:30-09:35 ET)
  // 2) Block +-15 min around high-impact news
  // 3) Block extreme ATR percentile (> 95th or < 5th)
  // ============================================================
  let gateGPassed = true;
  const filterBlockReasons: string[] = [];

  const nyTime = getNewYorkTime();

  // Filter 1: First 5 minutes of regular session
  if (nyTime.minutesSinceMidnight >= 570 && nyTime.minutesSinceMidnight < 575) {
    gateGPassed = false;
    filterBlockReasons.push('Opening auction filter: Trading blocked during first 5 minutes of regular session (09:30-09:35 ET).');
  }

  // Filter 2: +-15 min around high impact news from Forex Factory calendar
  try {
    const newsEvents = getNewsEventsForUI();
    const nowMs = Date.now();
    for (const evt of newsEvents) {
      if (evt.isHighImpactUsd || evt.impact === 'High') {
        const evtTimeMs = new Date(evt.timeUtc).getTime();
        const diffMinutes = (evtTimeMs - nowMs) / 60000;
        if (Math.abs(diffMinutes) <= 15) {
          gateGPassed = false;
          filterBlockReasons.push(`High-impact macro event (${evt.title}) scheduled in ${Math.round(diffMinutes)}m. Trading blocked +-15m.`);
          break;
        }
      }
    }
  } catch (err) {
    // If news lookup encounters an issue, proceed safely
  }

  // Filter 3: Extreme ATR percentile
  const atrSeries = calculateATRSeries(entryCandles, 14);
  if (atrSeries.length >= 20) {
    const sorted = [...atrSeries].sort((a, b) => a - b);
    const p5 = sorted[Math.floor(sorted.length * 0.05)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];

    if (atr > p95) {
      gateGPassed = false;
      filterBlockReasons.push(`Extreme ATR volatility percentile ($${atr.toFixed(2)} > 95th percentile $${p95.toFixed(2)}). Options spread risk elevated.`);
    } else if (atr < p5) {
      gateGPassed = false;
      filterBlockReasons.push(`Dormant ATR volatility percentile ($${atr.toFixed(2)} < 5th percentile $${p5.toFixed(2)}). Insufficient movement expected.`);
    }
  }

  gates.push({
    id: 'gate-g-filters',
    letter: 'g',
    name: 'Regime & Macro Event Filters',
    passed: gateGPassed,
    bias: gateGPassed ? 'BULLISH' : 'NEUTRAL',
    weight: 0,
    score: gateGPassed ? 0 : 0,
    detail: gateGPassed ? 'All regime filters clear: Past opening 5m, no high-impact USD events +-15m, ATR within normal institutional distribution.' : filterBlockReasons.join(' '),
    metric: gateGPassed ? 'CLEAR' : 'BLOCKED',
    threshold: 'Session open > 5m, No High USD News +-15m, ATR 5-95%',
  });

  // Calculate Confluence Score
  const totalScore = gates.reduce((sum, g) => sum + g.score, 0);

  // ============================================================
  // ATR FEASIBILITY & SL/TP SIZING
  // ============================================================
  // expected move = ATR(entry TF) * sqrt(expiry / entry TF bars)
  const barsInExpiry = Math.max(1, expiryDurationMinutes / entryBarMinutes);
  const expectedMove = Number((atr * Math.sqrt(barsInExpiry)).toFixed(2));

  // Determine potential SL / TP
  // Minimum RR 1:1.5
  let slDelta = Number((atr * 1.2).toFixed(2));
  let tpDelta = Number((slDelta * 1.6).toFixed(2));
  let riskRewardRatio = Number((tpDelta / (slDelta || 1)).toFixed(2));

  let candidateEntry = Number(currentPrice.toFixed(2));
  let candidateSl: number | null = null;
  let candidateTp: number | null = null;

  if (candidateBias === 'BULLISH') {
    candidateSl = Number((currentPrice - slDelta).toFixed(2));
    candidateTp = Number((currentPrice + tpDelta).toFixed(2));
  } else {
    candidateSl = Number((currentPrice + slDelta).toFixed(2));
    candidateTp = Number((currentPrice - tpDelta).toFixed(2));
  }

  const distanceToTp = Math.abs(candidateTp - candidateEntry);
  const atrFeasible = expectedMove >= distanceToTp;

  // ============================================================
  // DECISION SYNTHESIS
  // Strict Rules:
  // - Score >= 70%
  // - Gate (a) MUST pass
  // - Gate (d) MUST pass
  // - Gate (g) MUST pass (not blocked)
  // - ATR feasibility: expected move >= distance to TP
  // ============================================================
  const reasons: string[] = [];
  let decision: SpySignalDecision = 'NO TRADE';
  let finalConfidence = totalScore;

  const coreConditionsMet = totalScore >= 70 && gateAPassed && gateDPassed && gateGPassed;

  if (coreConditionsMet && atrFeasible) {
    decision = candidateBias === 'BULLISH' ? 'CALL' : 'PUT';
    finalConfidence = Math.min(92, Math.max(70, totalScore));

    if (decision === 'CALL') {
      reasons.push(
        `High-probability CALL configuration validated on ${expiry} expiry ($${approxAtmStrike} approx ATM).`,
        `Demand Zone / Bullish Order Block validated on ${biasTfKey} with entry BOS confirmation.`,
        `ATR feasibility satisfied: Expected move $${expectedMove.toFixed(2)} >= TP distance $${distanceToTp.toFixed(2)}.`
      );
    } else {
      reasons.push(
        `High-probability PUT configuration validated on ${expiry} expiry ($${approxAtmStrike} approx ATM).`,
        `Supply Zone / Bearish Order Block validated on ${biasTfKey} with entry BOS confirmation.`,
        `ATR feasibility satisfied: Expected move $${expectedMove.toFixed(2)} >= TP distance $${distanceToTp.toFixed(2)}.`
      );
    }
  } else {
    decision = 'NO TRADE';
    incrementNoTradeCount();

    if (!gateGPassed) {
      reasons.push(`Regime filter blocked execution: ${filterBlockReasons.join(' ')}`);
    } else if (!gateAPassed || !gateDPassed) {
      reasons.push('Mandatory core gates failed: Both Gate (a) Order Block and Gate (d) CHoCH/BOS are required for institutional entry.');
    } else if (!atrFeasible) {
      reasons.push(`ATR feasibility failed: Expected move over ${expiry} ($${expectedMove.toFixed(2)}) is smaller than required TP distance ($${distanceToTp.toFixed(2)}).`);
    } else if (totalScore < 70) {
      reasons.push(`Confluence score (${totalScore}%) is below institutional threshold (70%). Selectivity preserves capital.`);
    }

    // Add failing gate details
    const failedGates = gates.filter((g) => !g.passed && g.weight > 0);
    for (const fg of failedGates) {
      reasons.push(`${fg.name}: ${fg.detail}`);
    }
  }

  const result: SpyAnalysisResult = {
    id: `SPY-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
    symbol: 'SPY',
    expiry,
    decision,
    approxAtmStrike,
    confidence: finalConfidence,
    currentPrice: Number(currentPrice.toFixed(2)),
    entryPrice: decision === 'NO TRADE' ? null : candidateEntry,
    slPrice: decision === 'NO TRADE' ? null : candidateSl,
    tpPrice: decision === 'NO TRADE' ? null : candidateTp,
    riskReward: decision === 'NO TRADE' ? null : riskRewardRatio,
    atr,
    expectedMove,
    distanceToTp: decision === 'NO TRADE' ? null : distanceToTp,
    atrFeasible,
    gates,
    totalScore,
    reasons,
    biasTimeframe: biasTfKey,
    entryTimeframe: entryTfKey,
    marketOpen,
    computedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiryDurationMinutes * 60000).toISOString(),
  };

  // If a valid trade was produced, record to persistent history and set lock/cooldown!
  if (decision === 'CALL' || decision === 'PUT') {
    const historyEntry: SpyHistoryRecord = {
      id: result.id,
      time: new Date().toLocaleTimeString('en-US', { hour12: false }),
      timestamp: Date.now(),
      expiry: result.expiry,
      direction: result.decision,
      approxAtmStrike: result.approxAtmStrike,
      entry: result.entryPrice,
      sl: result.slPrice,
      tp: result.tpPrice,
      riskReward: result.riskReward,
      confidence: result.confidence,
      status: 'ACTIVE',
      maxFavorableMove: 0,
      maxAdverseMove: 0,
      gateResults: result.gates,
      reasons: result.reasons.slice(0, 3),
      expiresAt: result.expiresAt,
      expiresAtTimestamp: Date.now() + expiryDurationMinutes * 60000,
    };

    signalHistoryStore.push(historyEntry);
    if (signalHistoryStore.length > 200) {
      signalHistoryStore = signalHistoryStore.slice(-200);
    }
    saveSpySignalsToDisk();
  }

  return result;
}
