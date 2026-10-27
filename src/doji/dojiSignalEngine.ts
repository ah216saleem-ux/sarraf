// src/doji/dojiSignalEngine.ts
import {
  RawBar,
  DojiTimeframe,
  DojiMode,
  computeEma,
  computeAtr14,
  checkIsDoji,
  calculateZoneStrength,
  calculateRealRiskReward,
  formatDubaiShortTime,
  formatOpenedTime,
  formatHeldDuration,
  deduplicateBars,
  buildHtfEma21Series,
  checkHtfTrendAtTime,
  checkRetestConfirmation,
} from './dojiEngine';

export interface DojiSimulationFilterStats {
  blockedByTrend: number;
  blockedByConfirm: number;
  mergedDojis: number;
}

export interface DojiTrade {
  id: string;
  timeframe: DojiTimeframe;
  zoneId: string;
  zoneOpenTime: string;
  zoneTimeDisplay?: string;
  breakTime?: string;
  breakTimeDisplay?: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  initialSl: number;
  currentSl: number;
  risk?: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp1Rr?: string;
  tp2Rr?: string;
  tp3Rr?: string;
  riskReward?: string;
  zoneStrength: number;
  zoneStrengthLabel: 'Strong' | 'Medium' | 'Weak';
  zoneStrengthColor: string;
  entryTime: string; // ISO
  entryTimeDisplay: string; // Dubai format "23 Oct 18:45"
  openedDisplay: string; // "Opened Fri 23 Oct 19:00"
  exitTime?: string;
  exitTimeDisplay?: string;
  barsHeld: number;
  heldDisplay: string; // "2h 15m"
  isBreakeven: boolean; // true after TP1 is hit
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
  slHit: boolean;
  status: 'OPEN' | 'CLOSED';
  result: 'OPEN' | 'SL' | 'TP1' | 'TP2' | 'TP3';
  pnlDollars: number; // calculated with 3 equal parts
  livePnlDollars?: number;
}

const LOCAL_STORAGE_KEY = 'sarraf_doji_trades_v3';

export function formatDubaiTime(isoOrDate: string | Date): string {
  return formatDubaiShortTime(isoOrDate);
}

/**
 * Calculate trade P/L based on 3 equal parts (1/3 each):
 * TP1 = +$6, TP2 = +$11, TP3 = +$15 from entry.
 * After TP1, stop is at breakeven (entry).
 */
export function computeClosedPnl(
  side: 'BUY' | 'SELL',
  entry: number,
  initialSl: number,
  result: 'SL' | 'TP1' | 'TP2' | 'TP3' | 'OPEN',
  tp1R: number = 1.0,
  tp2R: number = 2.0,
  tp3R: number = 3.0
): number {
  if (result === 'OPEN') return 0;
  const risk = Math.abs(entry - initialSl);
  if (result === 'SL') {
    return Number((-risk).toFixed(2));
  }

  let pnl = 0;
  if (result === 'TP1') {
    pnl = tp1R * risk * (1 / 3);
  } else if (result === 'TP2') {
    pnl = tp1R * risk * (1 / 3) + tp2R * risk * (1 / 3);
  } else if (result === 'TP3') {
    pnl = tp1R * risk * (1 / 3) + tp2R * risk * (1 / 3) + tp3R * risk * (1 / 3);
  }

  return Number(pnl.toFixed(2));
}

/**
 * Compute live P/L for an open trade based on current/last price
 */
export function computeLivePnl(
  trade: DojiTrade,
  currentPrice: number,
  tp1R: number = 1.0,
  tp2R: number = 2.0
): number {
  if (trade.status === 'CLOSED') {
    return trade.pnlDollars;
  }

  const refPrice = currentPrice > 0 ? currentPrice : trade.entryPrice;
  const { side, entryPrice, tp1Hit, tp2Hit } = trade;
  const isBuy = side === 'BUY';
  const priceDiff = isBuy ? refPrice - entryPrice : entryPrice - refPrice;
  const risk = trade.risk && trade.risk > 0 ? trade.risk : Math.abs(entryPrice - trade.initialSl);

  if (!tp1Hit) {
    return Number(priceDiff.toFixed(2));
  }

  let pnl = tp1R * risk * (1 / 3);

  if (tp2Hit) {
    pnl += tp2R * risk * (1 / 3);
    const part3 = Math.max(0, priceDiff) * (1 / 3);
    pnl += part3;
  } else {
    const openParts = Math.max(0, priceDiff) * (2 / 3);
    pnl += openParts;
  }

  return Number(pnl.toFixed(2));
}

/**
 * Replay historical closed bars to detect signals and execute trades per timeframe.
 * Rules:
 * 1) Break and retest MUST be on separate bars (retestBarIndex > breakBarIndex).
 * 2) Never enter on the break bar itself.
 * 3) Retest can only form at least 2 bars after the Doji bar (retestBarIndex >= dojiIndex + 2).
 * 4) SELL retest: high >= zone.low && close < zone.low (and close < EMA9).
 * 5) BUY retest: low <= zone.high && close > zone.high (and close > EMA9).
 * 6) Strictly 1 trade per zone; zone is only marked "used" when a retest trade is opened.
 */
export function simulateTradesForTimeframe(
  bars: RawBar[],
  timeframe: DojiTimeframe,
  redOnly: boolean,
  currentPrice?: number,
  mode: DojiMode = 'indicator',
  bodyPct: number = mode === 'loose' ? 0.10 : 0.20,
  wickDiffPct: number = 0.15,
  minRangeAtr: number = mode === 'strict' ? 0.5 : 0.2,
  minZoneStrength: number = 5,
  slAtrMultiplier: number = 0.25,
  trendFilter: boolean = true,
  zoneMerge: boolean = true,
  retestConfirm: boolean = true,
  htfBars?: RawBar[],
  tp1R: number = 1.0,
  tp2R: number = 2.0,
  tp3R: number = 3.0
): {
  trades: DojiTrade[];
  activeTrade: DojiTrade | null;
  consumedOpenTimes: Set<string>;
  filterStats: DojiSimulationFilterStats;
} {
  const consumedOpenTimes = new Set<string>();
  const filterStats: DojiSimulationFilterStats = {
    blockedByTrend: 0,
    blockedByConfirm: 0,
    mergedDojis: 0,
  };

  if (!bars || bars.length < 20) {
    return { trades: [], activeTrade: null, consumedOpenTimes, filterStats };
  }

  const uniqueBars = deduplicateBars(bars);
  const closedBars = uniqueBars.filter((b) => !b.isOpen);
  if (closedBars.length < 20) {
    return { trades: [], activeTrade: null, consumedOpenTimes, filterStats };
  }

  const latestAtr = computeAtr14(closedBars);
  const atr = latestAtr;
  const emaList = computeEma(closedBars, 9);
  const emaMap = new Map<number, number>();
  for (const item of emaList) {
    emaMap.set(item.time, item.value);
  }

  const htfEma21Series =
    trendFilter && timeframe !== '4h' ? buildHtfEma21Series(htfBars) : [];

  interface CandidateZone {
    id: string;
    dojiIndex: number;
    high: number;
    low: number;
    range: number;
    body: number;
    wickDiff: number;
    openTime: string;
    mergedCount: number;
    mergedOpenTimes: string[];
    breakDirection: 'UP' | 'DOWN' | null;
    breakBarIndex: number | null;
    breakTime: string | null;
    isConsumed: boolean;
    isCancelled: boolean;
  }

  const zones: CandidateZone[] = [];
  const seenZoneOpenTimes = new Set<string>();

  const mergeActiveCandidateZones = (maxGap: number) => {
    if (!zoneMerge) return;
    let didMerge = true;
    while (didMerge) {
      didMerge = false;
      for (let aIdx = 0; aIdx < zones.length; aIdx++) {
        const a = zones[aIdx];
        if (a.isConsumed || a.isCancelled) continue;

        for (let bIdx = aIdx + 1; bIdx < zones.length; bIdx++) {
          const b = zones[bIdx];
          if (b.isConsumed || b.isCancelled) continue;
          if (a.breakDirection !== b.breakDirection) continue;

          const gap = Math.max(a.low, b.low) - Math.min(a.high, b.high);
          if (gap <= maxGap) {
            a.low = Number(Math.min(a.low, b.low).toFixed(2));
            a.high = Number(Math.max(a.high, b.high).toFixed(2));
            a.dojiIndex = Math.max(a.dojiIndex, b.dojiIndex);
            a.mergedCount += b.mergedCount;
            a.mergedOpenTimes = Array.from(
              new Set([...a.mergedOpenTimes, ...b.mergedOpenTimes])
            );
            if (b.breakBarIndex !== null) {
              if (a.breakBarIndex === null || b.breakBarIndex > a.breakBarIndex) {
                a.breakBarIndex = b.breakBarIndex;
                a.breakTime = b.breakTime;
              }
            }
            b.isCancelled = true;
            filterStats.mergedDojis += 1;
            didMerge = true;
            break;
          }
        }
        if (didMerge) break;
      }
    }
  };

  // Check bar 0 for Doji
  {
    const b0 = closedBars[0];
    const check0 = checkIsDoji(
      b0,
      latestAtr,
      redOnly,
      mode,
      bodyPct,
      wickDiffPct,
      minRangeAtr
    );
    if (check0.isDoji) {
      seenZoneOpenTimes.add(b0.openTime);
      zones.push({
        id: `zone-${timeframe}-${b0.openTime}`,
        dojiIndex: 0,
        high: Number(b0.high.toFixed(2)),
        low: Number(b0.low.toFixed(2)),
        range: check0.range,
        body: check0.body,
        wickDiff: check0.wickDiff,
        openTime: b0.openTime,
        mergedCount: 1,
        mergedOpenTimes: [b0.openTime],
        breakDirection: null,
        breakBarIndex: null,
        breakTime: null,
        isConsumed: false,
        isCancelled: false,
      });
    }
  }

  const trades: DojiTrade[] = [];
  let currentActiveTrade: DojiTrade | null = null;
  const openTimesByTradeId = new Map<string, string[]>();

  for (let i = 1; i < closedBars.length; i++) {
    const currentBar = closedBars[i];
    const barTimeMs = new Date(currentBar.openTime).getTime();
    const barDubaiSec = Math.floor(barTimeMs / 1000) + 4 * 3600;
    const currentEma = emaMap.get(barDubaiSec) ?? currentBar.close;
    const atrAtBar = computeAtr14(closedBars.slice(0, Math.max(2, i + 1))) || atr;
    const mergeGap = 0.3 * (atrAtBar > 0 ? atrAtBar : 3.5);

    // A. Advance running trade
    if (currentActiveTrade) {
      currentActiveTrade.barsHeld += 1;
      currentActiveTrade.heldDisplay = formatHeldDuration(currentActiveTrade.barsHeld, timeframe);
      const t = currentActiveTrade;
      const isBuy = t.side === 'BUY';

      let slHit = false;
      let tp1Hit = false;
      let tp2Hit = false;
      let tp3Hit = false;

      if (isBuy) {
        slHit = currentBar.low <= t.currentSl;
        tp1Hit = currentBar.high >= t.tp1;
        tp2Hit = currentBar.high >= t.tp2;
        tp3Hit = currentBar.high >= t.tp3;
      } else {
        slHit = currentBar.high >= t.currentSl;
        tp1Hit = currentBar.low <= t.tp1;
        tp2Hit = currentBar.low <= t.tp2;
        tp3Hit = currentBar.low <= t.tp3;
      }

      if (!t.tp1Hit) {
        if (slHit && tp1Hit) {
          t.status = 'CLOSED';
          t.result = 'SL';
          t.slHit = true;
          t.exitTime = currentBar.openTime;
          t.exitTimeDisplay = formatDubaiTime(currentBar.openTime);
          t.pnlDollars = computeClosedPnl(t.side, t.entryPrice, t.initialSl, 'SL', tp1R, tp2R, tp3R);
          trades.push({ ...t });
          currentActiveTrade = null;
        } else if (slHit) {
          t.status = 'CLOSED';
          t.result = 'SL';
          t.slHit = true;
          t.exitTime = currentBar.openTime;
          t.exitTimeDisplay = formatDubaiTime(currentBar.openTime);
          t.pnlDollars = computeClosedPnl(t.side, t.entryPrice, t.initialSl, 'SL', tp1R, tp2R, tp3R);
          trades.push({ ...t });
          currentActiveTrade = null;
        } else if (tp1Hit) {
          t.tp1Hit = true;
          t.isBreakeven = true;
          t.currentSl = t.entryPrice;
          t.result = 'TP1';

          if (tp2Hit) {
            t.tp2Hit = true;
            t.result = 'TP2';
          }
          if (tp3Hit) {
            t.tp3Hit = true;
            t.result = 'TP3';
            t.status = 'CLOSED';
            t.exitTime = currentBar.openTime;
            t.exitTimeDisplay = formatDubaiTime(currentBar.openTime);
            t.pnlDollars = computeClosedPnl(t.side, t.entryPrice, t.initialSl, 'TP3', tp1R, tp2R, tp3R);
            trades.push({ ...t });
            currentActiveTrade = null;
          }
        }
      } else {
        const breakevenHit = isBuy
          ? currentBar.low <= t.entryPrice
          : currentBar.high >= t.entryPrice;

        if (tp3Hit) {
          t.tp3Hit = true;
          t.result = 'TP3';
          t.status = 'CLOSED';
          t.exitTime = currentBar.openTime;
          t.exitTimeDisplay = formatDubaiTime(currentBar.openTime);
          t.pnlDollars = computeClosedPnl(t.side, t.entryPrice, t.initialSl, 'TP3', tp1R, tp2R, tp3R);
          trades.push({ ...t });
          currentActiveTrade = null;
        } else if (tp2Hit) {
          t.tp2Hit = true;
          t.result = 'TP2';
          if (breakevenHit) {
            t.status = 'CLOSED';
            t.exitTime = currentBar.openTime;
            t.exitTimeDisplay = formatDubaiTime(currentBar.openTime);
            t.pnlDollars = computeClosedPnl(t.side, t.entryPrice, t.initialSl, 'TP2', tp1R, tp2R, tp3R);
            trades.push({ ...t });
            currentActiveTrade = null;
          }
        } else if (breakevenHit) {
          t.status = 'CLOSED';
          t.exitTime = currentBar.openTime;
          t.exitTimeDisplay = formatDubaiTime(currentBar.openTime);
          t.pnlDollars = computeClosedPnl(t.side, t.entryPrice, t.initialSl, t.result, tp1R, tp2R, tp3R);
          trades.push({ ...t });
          currentActiveTrade = null;
        }
      }
    }

    // B. Update zone breakouts & check for retest entry on subsequent bars
    let anyBreakOnBar = false;
    for (const z of zones) {
      if (z.dojiIndex >= i) continue;
      if (z.isConsumed || z.isCancelled || consumedOpenTimes.has(z.openTime)) continue;

      // 1) If zone has NOT broken yet: check if currentBar is the BREAK bar.
      // Never enter on the break bar itself!
      if (z.breakDirection === null) {
        if (currentBar.close > z.high) {
          z.breakDirection = 'UP';
          z.breakBarIndex = i;
          z.breakTime = currentBar.openTime;
          anyBreakOnBar = true;
        } else if (currentBar.close < z.low) {
          z.breakDirection = 'DOWN';
          z.breakBarIndex = i;
          z.breakTime = currentBar.openTime;
          anyBreakOnBar = true;
        }
        continue;
      }

      // 2) Zone was already broken on an earlier bar (z.breakBarIndex < i).
      // If price closed back through it after the break -> zone failed / cancelled!
      if (
        (z.breakDirection === 'UP' && currentBar.close < z.low) ||
        (z.breakDirection === 'DOWN' && currentBar.close > z.high)
      ) {
        z.isCancelled = true;
        continue;
      }

      // 3) Check for retest entry (strictly on bars after breakBarIndex, and at least 2 bars after dojiIndex)
      if (
        !currentActiveTrade &&
        z.breakBarIndex !== null &&
        i > z.breakBarIndex &&
        i >= z.dojiIndex + 2
      ) {
        // BUY retest: low <= zone.high && close > zone.high
        if (
          z.breakDirection === 'UP' &&
          currentBar.low <= z.high &&
          currentBar.close > z.high &&
          currentBar.close > currentEma
        ) {
          const entryPrice = Number(currentBar.close.toFixed(2));
          const atrAtRetest = atrAtBar || atr;
          const strengthInfo = calculateZoneStrength(
            {
              high: z.high,
              low: z.low,
              range: z.range,
              body: z.body,
              wickDiff: z.wickDiff,
              barIndex: z.dojiIndex,
              isBroken: true,
              breakDirection: 'UP',
              mergedCount: z.mergedCount,
            },
            entryPrice,
            currentEma,
            atrAtRetest,
            i + 1
          );

          if (strengthInfo.strength < minZoneStrength) {
            continue;
          }

          const trendOk =
            !trendFilter ||
            checkHtfTrendAtTime('BUY', timeframe, barTimeMs, entryPrice, htfEma21Series);
          const confirmOk =
            !retestConfirm ||
            checkRetestConfirmation('BUY', currentBar, closedBars[i - 1]);

          if (!trendOk) {
            filterStats.blockedByTrend += 1;
          }
          if (!confirmOk) {
            filterStats.blockedByConfirm += 1;
          }
          if (!trendOk || !confirmOk) {
            continue;
          }

          const slBuffer = slAtrMultiplier * (atrAtRetest > 0 ? atrAtRetest : 3.5);
          const initialSl = Number((z.low - slBuffer).toFixed(2));
          const risk = Number(Math.abs(entryPrice - initialSl).toFixed(2));

          // Skip any setup whose risk is larger than 2.5 * ATR
          const maxAllowedRisk = 2.5 * (atrAtRetest > 0 ? atrAtRetest : 3.5);
          if (risk > maxAllowedRisk) {
            continue;
          }

          const tp1 = Number((entryPrice + tp1R * risk).toFixed(2));
          const tp2 = Number((entryPrice + tp2R * risk).toFixed(2));
          const tp3 = Number((entryPrice + tp3R * risk).toFixed(2));
          const tp1Rr = calculateRealRiskReward(entryPrice, initialSl, tp1);
          const tp2Rr = calculateRealRiskReward(entryPrice, initialSl, tp2);
          const tp3Rr = calculateRealRiskReward(entryPrice, initialSl, tp3);

          const trade: DojiTrade = {
            id: `trade-${timeframe}-${z.openTime}`,
            timeframe,
            zoneId: `doji-zone-${timeframe}-${z.openTime}`,
            zoneOpenTime: z.openTime,
            zoneTimeDisplay: formatDubaiTime(z.openTime),
            breakTime: z.breakTime || undefined,
            breakTimeDisplay: z.breakTime ? formatDubaiTime(z.breakTime) : undefined,
            side: 'BUY',
            entryPrice,
            initialSl,
            currentSl: initialSl,
            risk,
            tp1,
            tp2,
            tp3,
            tp1Rr,
            tp2Rr,
            tp3Rr,
            riskReward: tp3Rr,
            zoneStrength: strengthInfo.strength,
            zoneStrengthLabel: strengthInfo.strengthLabel,
            zoneStrengthColor: strengthInfo.strengthColor,
            entryTime: currentBar.openTime,
            entryTimeDisplay: formatDubaiTime(currentBar.openTime),
            openedDisplay: formatOpenedTime(currentBar.openTime),
            barsHeld: 1,
            heldDisplay: formatHeldDuration(1, timeframe),
            isBreakeven: false,
            tp1Hit: false,
            tp2Hit: false,
            tp3Hit: false,
            slHit: false,
            status: 'OPEN',
            result: 'OPEN',
            pnlDollars: 0,
          };

          z.isConsumed = true;
          openTimesByTradeId.set(trade.id, z.mergedOpenTimes);
          for (const ot of z.mergedOpenTimes) {
            consumedOpenTimes.add(ot);
          }
          currentActiveTrade = trade;
          continue;
        }

        // SELL retest: high >= zone.low && close < zone.low
        if (
          z.breakDirection === 'DOWN' &&
          currentBar.high >= z.low &&
          currentBar.close < z.low &&
          currentBar.close < currentEma
        ) {
          const entryPrice = Number(currentBar.close.toFixed(2));
          const atrAtRetest = atrAtBar || atr;
          const strengthInfo = calculateZoneStrength(
            {
              high: z.high,
              low: z.low,
              range: z.range,
              body: z.body,
              wickDiff: z.wickDiff,
              barIndex: z.dojiIndex,
              isBroken: true,
              breakDirection: 'DOWN',
              mergedCount: z.mergedCount,
            },
            entryPrice,
            currentEma,
            atrAtRetest,
            i + 1
          );

          if (strengthInfo.strength < minZoneStrength) {
            continue;
          }

          const trendOk =
            !trendFilter ||
            checkHtfTrendAtTime('SELL', timeframe, barTimeMs, entryPrice, htfEma21Series);
          const confirmOk =
            !retestConfirm ||
            checkRetestConfirmation('SELL', currentBar, closedBars[i - 1]);

          if (!trendOk) {
            filterStats.blockedByTrend += 1;
          }
          if (!confirmOk) {
            filterStats.blockedByConfirm += 1;
          }
          if (!trendOk || !confirmOk) {
            continue;
          }

          const slBuffer = slAtrMultiplier * (atrAtRetest > 0 ? atrAtRetest : 3.5);
          const initialSl = Number((z.high + slBuffer).toFixed(2));
          const risk = Number(Math.abs(entryPrice - initialSl).toFixed(2));

          // Skip any setup whose risk is larger than 2.5 * ATR
          const maxAllowedRisk = 2.5 * (atrAtRetest > 0 ? atrAtRetest : 3.5);
          if (risk > maxAllowedRisk) {
            continue;
          }

          const tp1 = Number((entryPrice - tp1R * risk).toFixed(2));
          const tp2 = Number((entryPrice - tp2R * risk).toFixed(2));
          const tp3 = Number((entryPrice - tp3R * risk).toFixed(2));
          const tp1Rr = calculateRealRiskReward(entryPrice, initialSl, tp1);
          const tp2Rr = calculateRealRiskReward(entryPrice, initialSl, tp2);
          const tp3Rr = calculateRealRiskReward(entryPrice, initialSl, tp3);

          const trade: DojiTrade = {
            id: `trade-${timeframe}-${z.openTime}`,
            timeframe,
            zoneId: `doji-zone-${timeframe}-${z.openTime}`,
            zoneOpenTime: z.openTime,
            zoneTimeDisplay: formatDubaiTime(z.openTime),
            breakTime: z.breakTime || undefined,
            breakTimeDisplay: z.breakTime ? formatDubaiTime(z.breakTime) : undefined,
            side: 'SELL',
            entryPrice,
            initialSl,
            currentSl: initialSl,
            risk,
            tp1,
            tp2,
            tp3,
            tp1Rr,
            tp2Rr,
            tp3Rr,
            riskReward: tp3Rr,
            zoneStrength: strengthInfo.strength,
            zoneStrengthLabel: strengthInfo.strengthLabel,
            zoneStrengthColor: strengthInfo.strengthColor,
            entryTime: currentBar.openTime,
            entryTimeDisplay: formatDubaiTime(currentBar.openTime),
            openedDisplay: formatOpenedTime(currentBar.openTime),
            barsHeld: 1,
            heldDisplay: formatHeldDuration(1, timeframe),
            isBreakeven: false,
            tp1Hit: false,
            tp2Hit: false,
            tp3Hit: false,
            slHit: false,
            status: 'OPEN',
            result: 'OPEN',
            pnlDollars: 0,
          };

          z.isConsumed = true;
          openTimesByTradeId.set(trade.id, z.mergedOpenTimes);
          for (const ot of z.mergedOpenTimes) {
            consumedOpenTimes.add(ot);
          }
          currentActiveTrade = trade;
          continue;
        }
      }
    }

    if (anyBreakOnBar && zoneMerge) {
      mergeActiveCandidateZones(mergeGap);
    }

    // C. Check if currentBar itself is a new Doji candle
    if (!seenZoneOpenTimes.has(currentBar.openTime)) {
      const check = checkIsDoji(
        currentBar,
        Math.min(latestAtr, atrAtBar),
        redOnly,
        mode,
        bodyPct,
        wickDiffPct,
        minRangeAtr
      );
      if (check.isDoji) {
        seenZoneOpenTimes.add(currentBar.openTime);
        zones.push({
          id: `zone-${timeframe}-${currentBar.openTime}`,
          dojiIndex: i,
          high: Number(currentBar.high.toFixed(2)),
          low: Number(currentBar.low.toFixed(2)),
          range: check.range,
          body: check.body,
          wickDiff: check.wickDiff,
          openTime: currentBar.openTime,
          mergedCount: 1,
          mergedOpenTimes: [currentBar.openTime],
          breakDirection: null,
          breakBarIndex: null,
          breakTime: null,
          isConsumed: false,
          isCancelled: false,
        });
        if (zoneMerge) {
          mergeActiveCandidateZones(mergeGap);
        }
      }
    }
  }

  // If an open trade exists, compute its live P/L against current/last price immediately
  if (currentActiveTrade) {
    const lastBar = uniqueBars[uniqueBars.length - 1];
    const refPrice =
      typeof currentPrice === 'number' && currentPrice > 0
        ? currentPrice
        : lastBar
        ? lastBar.close
        : currentActiveTrade.entryPrice;

    const livePnl = computeLivePnl(currentActiveTrade, refPrice);
    currentActiveTrade.livePnlDollars = livePnl;
    currentActiveTrade.pnlDollars = livePnl;
    currentActiveTrade.heldDisplay = formatHeldDuration(currentActiveTrade.barsHeld, timeframe);
  }

  // Strictly build consumedOpenTimes from actual trades in the trade log
  const verifiedConsumedOpenTimes = new Set<string>();
  for (const t of trades) {
    verifiedConsumedOpenTimes.add(t.zoneOpenTime);
    const mergedOts = openTimesByTradeId.get(t.id);
    if (mergedOts) {
      for (const ot of mergedOts) verifiedConsumedOpenTimes.add(ot);
    }
  }
  if (currentActiveTrade) {
    verifiedConsumedOpenTimes.add(currentActiveTrade.zoneOpenTime);
    const mergedOts = openTimesByTradeId.get(currentActiveTrade.id);
    if (mergedOts) {
      for (const ot of mergedOts) verifiedConsumedOpenTimes.add(ot);
    }
  }

  return {
    trades,
    activeTrade: currentActiveTrade,
    consumedOpenTimes: verifiedConsumedOpenTimes,
    filterStats,
  };
}

export function saveTradesToStorage(trades: DojiTrade[]): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('sarraf_doji_trades');
      localStorage.removeItem('sarraf_doji_trades_v2');
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(trades));
    }
  } catch {}
}
