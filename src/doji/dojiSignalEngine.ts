// src/doji/dojiSignalEngine.ts
import {
  RawBar,
  DojiTimeframe,
  computeEma,
  computeAtr14,
  checkIsDoji,
  calculateZoneStrength,
  formatDubaiShortTime,
  formatOpenedTime,
  formatHeldDuration,
  deduplicateBars,
} from './dojiEngine';

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
  tp1: number;
  tp2: number;
  tp3: number;
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
  result: 'SL' | 'TP1' | 'TP2' | 'TP3' | 'OPEN'
): number {
  if (result === 'OPEN') return 0;
  if (result === 'SL') {
    const risk = Math.abs(entry - initialSl);
    return Number((-risk).toFixed(2));
  }

  let pnl = 0;
  if (result === 'TP1') {
    pnl = 6 * (1 / 3);
  } else if (result === 'TP2') {
    pnl = 6 * (1 / 3) + 11 * (1 / 3);
  } else if (result === 'TP3') {
    pnl = 6 * (1 / 3) + 11 * (1 / 3) + 15 * (1 / 3);
  }

  return Number(pnl.toFixed(2));
}

/**
 * Compute live P/L for an open trade based on current/last price
 */
export function computeLivePnl(trade: DojiTrade, currentPrice: number): number {
  if (trade.status === 'CLOSED') {
    return trade.pnlDollars;
  }

  const refPrice = currentPrice > 0 ? currentPrice : trade.entryPrice;
  const { side, entryPrice, tp1Hit, tp2Hit } = trade;
  const isBuy = side === 'BUY';
  const priceDiff = isBuy ? refPrice - entryPrice : entryPrice - refPrice;

  if (!tp1Hit) {
    return Number(priceDiff.toFixed(2));
  }

  let pnl = 6 * (1 / 3);

  if (tp2Hit) {
    pnl += 11 * (1 / 3);
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
  currentPrice?: number
): {
  trades: DojiTrade[];
  activeTrade: DojiTrade | null;
  consumedOpenTimes: Set<string>;
} {
  const consumedOpenTimes = new Set<string>();
  if (!bars || bars.length < 20) {
    return { trades: [], activeTrade: null, consumedOpenTimes };
  }

  const uniqueBars = deduplicateBars(bars);
  const closedBars = uniqueBars.filter((b) => !b.isOpen);
  if (closedBars.length < 20) {
    return { trades: [], activeTrade: null, consumedOpenTimes };
  }

  const latestAtr = computeAtr14(closedBars);
  const atr = latestAtr;
  const emaList = computeEma(closedBars, 9);
  const emaMap = new Map<number, number>();
  for (const item of emaList) {
    emaMap.set(item.time, item.value);
  }

  interface CandidateZone {
    id: string;
    dojiIndex: number;
    high: number;
    low: number;
    range: number;
    body: number;
    wickDiff: number;
    openTime: string;
    breakDirection: 'UP' | 'DOWN' | null;
    breakBarIndex: number | null;
    breakTime: string | null;
    isConsumed: boolean;
    isCancelled: boolean;
  }

  const zones: CandidateZone[] = [];
  const seenZoneOpenTimes = new Set<string>();

  for (let i = 0; i < closedBars.length; i++) {
    const b = closedBars[i];
    if (seenZoneOpenTimes.has(b.openTime)) continue;

    const atrAtBar = computeAtr14(closedBars.slice(0, Math.max(2, i + 1)));
    const check = checkIsDoji(b, Math.min(latestAtr, atrAtBar), redOnly);
    if (check.isDoji) {
      seenZoneOpenTimes.add(b.openTime);
      zones.push({
        id: `zone-${timeframe}-${b.openTime}`,
        dojiIndex: i,
        high: Number(b.high.toFixed(2)),
        low: Number(b.low.toFixed(2)),
        range: check.range,
        body: check.body,
        wickDiff: check.wickDiff,
        openTime: b.openTime,
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

  for (let i = 1; i < closedBars.length; i++) {
    const currentBar = closedBars[i];
    const barDubaiSec = Math.floor(new Date(currentBar.openTime).getTime() / 1000) + 4 * 3600;
    const currentEma = emaMap.get(barDubaiSec) ?? currentBar.close;

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
          t.pnlDollars = computeClosedPnl(t.side, t.entryPrice, t.initialSl, 'SL');
          trades.push({ ...t });
          currentActiveTrade = null;
        } else if (slHit) {
          t.status = 'CLOSED';
          t.result = 'SL';
          t.slHit = true;
          t.exitTime = currentBar.openTime;
          t.exitTimeDisplay = formatDubaiTime(currentBar.openTime);
          t.pnlDollars = computeClosedPnl(t.side, t.entryPrice, t.initialSl, 'SL');
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
            t.pnlDollars = computeClosedPnl(t.side, t.entryPrice, t.initialSl, 'TP3');
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
          t.pnlDollars = computeClosedPnl(t.side, t.entryPrice, t.initialSl, 'TP3');
          trades.push({ ...t });
          currentActiveTrade = null;
        } else if (tp2Hit) {
          t.tp2Hit = true;
          t.result = 'TP2';
          if (breakevenHit) {
            t.status = 'CLOSED';
            t.exitTime = currentBar.openTime;
            t.exitTimeDisplay = formatDubaiTime(currentBar.openTime);
            t.pnlDollars = computeClosedPnl(t.side, t.entryPrice, t.initialSl, 'TP2');
            trades.push({ ...t });
            currentActiveTrade = null;
          }
        } else if (breakevenHit) {
          t.status = 'CLOSED';
          t.exitTime = currentBar.openTime;
          t.exitTimeDisplay = formatDubaiTime(currentBar.openTime);
          t.pnlDollars = computeClosedPnl(t.side, t.entryPrice, t.initialSl, t.result);
          trades.push({ ...t });
          currentActiveTrade = null;
        }
      }
    }

    // B. Update zone breakouts & check for retest entry on subsequent bars
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
        } else if (currentBar.close < z.low) {
          z.breakDirection = 'DOWN';
          z.breakBarIndex = i;
          z.breakTime = currentBar.openTime;
        }
        continue;
      }

      // 2) Zone was already broken on an earlier bar (z.breakBarIndex < i).
      // First check if currentBar closes on the opposite side of the zone (invalidation).
      if (z.breakDirection === 'UP' && currentBar.close < z.low) {
        z.isCancelled = true;
        continue;
      }
      if (z.breakDirection === 'DOWN' && currentBar.close > z.high) {
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
          const initialSl = Number((z.low - 2.50).toFixed(2));
          const tp1 = Number((entryPrice + 6.0).toFixed(2));
          const tp2 = Number((entryPrice + 11.0).toFixed(2));
          const tp3 = Number((entryPrice + 15.0).toFixed(2));
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
            },
            entryPrice,
            currentEma,
            atr,
            i + 1
          );

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
            tp1,
            tp2,
            tp3,
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
          consumedOpenTimes.add(z.openTime);
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
          const initialSl = Number((z.high + 2.50).toFixed(2));
          const tp1 = Number((entryPrice - 6.0).toFixed(2));
          const tp2 = Number((entryPrice - 11.0).toFixed(2));
          const tp3 = Number((entryPrice - 15.0).toFixed(2));
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
            },
            entryPrice,
            currentEma,
            atr,
            i + 1
          );

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
            tp1,
            tp2,
            tp3,
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
          consumedOpenTimes.add(z.openTime);
          currentActiveTrade = trade;
          continue;
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
  }
  if (currentActiveTrade) {
    verifiedConsumedOpenTimes.add(currentActiveTrade.zoneOpenTime);
  }

  return { trades, activeTrade: currentActiveTrade, consumedOpenTimes: verifiedConsumedOpenTimes };
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
