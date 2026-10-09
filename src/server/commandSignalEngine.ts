import fs from 'fs';
import path from 'path';
import {
  CommandSignal,
  CommandSignalLogEntry,
  SignalEnginePublicState,
  SignalLifecycle,
  SignalSide,
  SignalCloseReason,
  SignalEngineStats,
  SniperGateResult,
} from '../command/signal/types.ts';
import { SNIPER_CONFIG } from '../command/signal/sniperConfig.ts';
import { evaluateAhmedSniperChain, CandleLike } from '../command/signal/ahmedSniperChain.ts';
import { getCandleStore } from './candleEngine.ts';
import { DATA_DIR, writeJsonAtomic } from './deploymentSafety.ts';
import {
  notifyNewSignal,
  notifyTargetHit,
  notifySignalClosed,
} from './commandTelegramService.ts';

const SIGNALS_FILE = path.resolve(DATA_DIR, 'command_sniper_signals.json');

interface PersistedState {
  lifecycle: SignalLifecycle;
  activeSignal: CommandSignal | null;
  cooldownEndsAt: number | null;
  paperMode: boolean;
  history: CommandSignalLogEntry[];
  lastEvaluatedAt: number;
}

// In-Memory state
let lifecycle: SignalLifecycle = 'WAIT';
let activeSignal: CommandSignal | null = null;
let cooldownEndsAt: number | null = null;
let paperMode: boolean = true; // Default ON as required
let history: CommandSignalLogEntry[] = [];
let lastEvaluatedAt: number = Date.now();
let lastGates: SniperGateResult[] = [];
let lastAlignedDirection: SignalSide | null = null;
let lastWaitReason: string = 'Initializing Ahmed Sniper Engine...';
let lastPathClearDollars: number = 0;
let lastConfidence: number = 0;
let lastFeedStatus: 'LIVE' | 'RECONNECTING' | 'OFFLINE' = 'OFFLINE';

function computeStats(hist: CommandSignalLogEntry[]): SignalEngineStats {
  const total = hist.length;
  if (total === 0) {
    return {
      totalSignals: 0,
      winRate: 0,
      avgResultDollars: 0,
      totalPnLDollars: 0,
      winsCount: 0,
      lossesCount: 0,
      tp1Hits: 0,
      tp2Hits: 0,
      tp3Hits: 0,
      slHits: 0,
      manualCloses: 0,
    };
  }

  let tpWins = 0;
  let slLosses = 0;
  let totalPnL = 0;
  let tp1 = 0;
  let tp2 = 0;
  let tp3 = 0;
  let sl = 0;
  let manual = 0;
  let nonTestTotal = 0;

  for (const s of hist) {
    if (s.isTest) continue;
    nonTestTotal++;
    totalPnL += s.pnlDollars;

    if (s.result === 'TP1') {
      tp1++;
      tpWins++;
    } else if (s.result === 'TP2') {
      tp2++;
      tpWins++;
    } else if (s.result === 'TP3') {
      tp3++;
      tpWins++;
    } else if (s.result === 'SL') {
      sl++;
      slLosses++;
    } else if (s.result === 'MANUAL') {
      manual++;
    }
  }

  // Win rate: Exclude MANUAL exits; win rate only from TP / SL
  const tpSlTotal = tpWins + slLosses;
  const winRate = tpSlTotal > 0 ? Number(((tpWins / tpSlTotal) * 100).toFixed(1)) : 0;
  const avgResult = nonTestTotal > 0 ? Number((totalPnL / nonTestTotal).toFixed(2)) : 0;

  return {
    totalSignals: nonTestTotal,
    winRate,
    avgResultDollars: avgResult,
    totalPnLDollars: Number(totalPnL.toFixed(2)),
    winsCount: tpWins,
    lossesCount: slLosses,
    tp1Hits: tp1,
    tp2Hits: tp2,
    tp3Hits: tp3,
    slHits: sl,
    manualCloses: manual,
  };
}

export function saveCommandSignalsToDisk() {
  try {
    const payload: PersistedState = {
      lifecycle,
      activeSignal,
      cooldownEndsAt,
      paperMode,
      history: history.filter((h) => !h.isTest).slice(0, SNIPER_CONFIG.maxHistoryEntries),
      lastEvaluatedAt,
    };
    writeJsonAtomic(SIGNALS_FILE, payload);
  } catch (err) {
    console.error('[COMMAND SIGNAL ENGINE] Failed to persist signals to disk:', err);
  }
}

export function loadCommandSignalsFromDisk() {
  try {
    if (!fs.existsSync(SIGNALS_FILE)) {
      console.log('[COMMAND SIGNAL ENGINE] No existing persisted command signals file. Initializing fresh state.');
      return;
    }

    const raw = fs.readFileSync(SIGNALS_FILE, 'utf8');
    const data: Partial<PersistedState> = JSON.parse(raw);

    if (data.paperMode !== undefined) paperMode = Boolean(data.paperMode);

    // Data Migration & Integrity Verification
    if (Array.isArray(data.history)) {
      history = data.history.filter((rec) => {
        if (!rec || typeof rec.entry !== 'number' || typeof rec.closePrice !== 'number') return false;
        if (rec.isTest) return false;

        const isBuy = rec.side === 'BUY';
        const expectedPnL = isBuy
          ? Number((rec.closePrice - rec.entry).toFixed(2))
          : Number((rec.entry - rec.closePrice).toFixed(2));

        // Result integrity: Reject records where exit and entry disagree with pnlDollars
        if (Math.abs(rec.pnlDollars - expectedPnL) > 0.05) {
          console.warn(`[DATA INTEGRITY] Removed corrupted record ${rec.id}: recorded pnl=${rec.pnlDollars}, computed=${expectedPnL}`);
          return false;
        }

        // Result integrity: Reject records where TP/SL label disagrees with exit price
        if (rec.result === 'TP1' && Math.abs(expectedPnL - 5.0) > 1.0) return false;
        if (rec.result === 'TP2' && Math.abs(expectedPnL - 8.0) > 1.0) return false;
        if (rec.result === 'TP3' && Math.abs(expectedPnL - 12.0) > 1.0) return false;
        if (rec.result === 'SL' && Math.abs(expectedPnL - (-10.0)) > 1.0) return false;

        return true;
      }).slice(0, SNIPER_CONFIG.maxHistoryEntries);
    }

    if (data.activeSignal && !data.activeSignal.isTest) {
      activeSignal = data.activeSignal;
      lifecycle = 'ACTIVE';
    } else if (data.cooldownEndsAt && Date.now() < data.cooldownEndsAt) {
      cooldownEndsAt = data.cooldownEndsAt;
      lifecycle = 'COOLDOWN';
    } else {
      lifecycle = 'WAIT';
      cooldownEndsAt = null;
    }

    console.log(`[COMMAND SIGNAL ENGINE] Loaded successfully: Lifecycle=${lifecycle}, History=${history.length}, PaperMode=${paperMode}`);
  } catch (err) {
    console.error('[COMMAND SIGNAL ENGINE] Error loading command signals from disk:', err);
    lifecycle = 'WAIT';
    activeSignal = null;
  }
}

/**
 * Main real-tick processor invoked by server.ts on every valid tick
 */
export function processCommandSignalTick(
  price: number,
  bid: number,
  ask: number,
  spread: number,
  isLive: boolean,
  feedStatus: 'LIVE' | 'RECONNECTING' | 'OFFLINE' = isLive ? 'LIVE' : 'OFFLINE',
  buyRatio: number = 50,
  sellRatio: number = 50,
  buyDelta: number = 0,
  sellDelta: number = 0
) {
  lastEvaluatedAt = Date.now();
  lastFeedStatus = feedStatus;

  if (price <= 0) return;

  // 1. Handle Cooldown Expiration
  if (lifecycle === 'COOLDOWN') {
    if (cooldownEndsAt && Date.now() >= cooldownEndsAt) {
      lifecycle = 'WAIT';
      cooldownEndsAt = null;
      saveCommandSignalsToDisk();
      console.log('[COMMAND SIGNAL ENGINE] 30-minute cooldown expired. Engine returned to WAIT.');
    }
  }

  // 2. Handle ACTIVE signal tracking against real live tick
  if (lifecycle === 'ACTIVE' && activeSignal) {
    const isBuy = activeSignal.side === 'BUY';
    const entry = activeSignal.entry;
    const livePnL = isBuy ? Number((price - entry).toFixed(2)) : Number((entry - price).toFixed(2));
    activeSignal.livePnL = livePnL;

    // Check TP1
    if (!activeSignal.tp1Hit) {
      const hit = isBuy ? price >= activeSignal.tp1 : price <= activeSignal.tp1;
      if (hit) {
        activeSignal.tp1Hit = true;
        if (!activeSignal.hitTargets.includes('TP1')) activeSignal.hitTargets.push('TP1');
        console.log(`[COMMAND SIGNAL ENGINE] Signal ${activeSignal.id} hit TP1 @ $${price} (+$${SNIPER_CONFIG.tp1OffsetDollars})`);

        // Telegram notification (send exactly once per event)
        if (!activeSignal.sentMessageFlags) activeSignal.sentMessageFlags = {};
        if (!activeSignal.sentMessageFlags.tp1) {
          activeSignal.sentMessageFlags.tp1 = true;
          notifyTargetHit('TP1', activeSignal).catch(() => {});
        }

        saveCommandSignalsToDisk();
      }
    }

    // Check TP2
    if (!activeSignal.tp2Hit) {
      const hit = isBuy ? price >= activeSignal.tp2 : price <= activeSignal.tp2;
      if (hit) {
        activeSignal.tp2Hit = true;
        if (!activeSignal.hitTargets.includes('TP2')) activeSignal.hitTargets.push('TP2');
        console.log(`[COMMAND SIGNAL ENGINE] Signal ${activeSignal.id} hit TP2 @ $${price} (+$${SNIPER_CONFIG.tp2OffsetDollars})`);

        // Telegram notification (send exactly once per event)
        if (!activeSignal.sentMessageFlags) activeSignal.sentMessageFlags = {};
        if (!activeSignal.sentMessageFlags.tp2) {
          activeSignal.sentMessageFlags.tp2 = true;
          notifyTargetHit('TP2', activeSignal).catch(() => {});
        }

        saveCommandSignalsToDisk();
      }
    }

    // Check TP3 (Full win closure)
    let shouldClose = false;
    let closeReason: SignalCloseReason = 'TP3';
    let closeTargetPrice = price;

    const hitTP3 = isBuy ? price >= activeSignal.tp3 : price <= activeSignal.tp3;
    if (hitTP3) {
      activeSignal.tp3Hit = true;
      if (!activeSignal.hitTargets.includes('TP3')) activeSignal.hitTargets.push('TP3');
      shouldClose = true;
      closeReason = 'TP3';
      closeTargetPrice = activeSignal.tp3; // Exit price equals TP level
    }

    // Check Stop Loss
    const hitSL = isBuy ? price <= activeSignal.sl : price >= activeSignal.sl;
    if (!shouldClose && hitSL) {
      activeSignal.slHit = true;
      if (!activeSignal.hitTargets.includes('SL')) activeSignal.hitTargets.push('SL');
      shouldClose = true;
      closeReason = 'SL';
      closeTargetPrice = activeSignal.sl; // Exit price equals SL level
    }

    if (shouldClose) {
      finalizeClosedSignal(closeReason, closeTargetPrice);
      return;
    }
  }

  // 3. In WAIT or COOLDOWN: Evaluate Ahmed Sniper Chain Gates
  // Analysis continues even during ACTIVE or COOLDOWN (per requirements: "While one is active, analysis continues but no new signal is issued.")
  evaluateGatesWithCurrentMarket(price, spread, buyRatio, sellRatio, buyDelta, sellDelta, feedStatus);

  // 4. Issue Signal if conditions met, in WAIT, and feed is LIVE
  if (lifecycle === 'WAIT' && isLive && feedStatus === 'LIVE') {
    // Check if gates allow issuing a signal
    if (lastGates.length === 8 && lastGates.every((g) => g.status === 'PASS') && lastAlignedDirection) {
      if (lastConfidence >= SNIPER_CONFIG.minConfidencePercent && lastPathClearDollars >= SNIPER_CONFIG.minPathClearDollars) {
        issueNewSignal(lastAlignedDirection, price);
      }
    }
  }
}

function evaluateGatesWithCurrentMarket(
  price: number,
  spread: number,
  buyRatio: number,
  sellRatio: number,
  buyDelta: number,
  sellDelta: number,
  feedStatus: 'LIVE' | 'RECONNECTING' | 'OFFLINE'
) {
  try {
    const store = getCandleStore();

    // Map store candles to CandleLike
    const mapCandles = (arr: any[]): CandleLike[] => {
      if (!arr || !Array.isArray(arr)) return [];
      return arr.map((c) => ({
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 1,
        time: c.openTime,
      }));
    };

    const d1Candles = mapCandles(store.D1);
    const h4Candles = mapCandles(store.H4);
    const h1Candles = mapCandles(store.H1);
    const m30Candles = mapCandles(store.M30);
    const m15Candles = mapCandles(store.M15);

    // Build derived M5 candles from recent M15
    const m5Candles: CandleLike[] = [];
    if (m15Candles.length > 0) {
      const recentM15 = m15Candles.slice(-8);
      for (const m of recentM15) {
        for (let i = 0; i < 3; i++) {
          const prog = (i + 1) / 3;
          const subOpen = i === 0 ? m.open : m.open + (m.close - m.open) * (i / 3);
          const subClose = m.open + (m.close - m.open) * prog;
          m5Candles.push({
            open: Number(subOpen.toFixed(2)),
            high: Number(Math.max(subOpen, subClose, m.high - (1 - prog) * 0.4).toFixed(2)),
            low: Number(Math.min(subOpen, subClose, m.low + (1 - prog) * 0.4).toFixed(2)),
            close: Number(subClose.toFixed(2)),
            volume: Math.max(1, Math.round((m.volume || 10) / 3)),
          });
        }
      }
    }

    // Dynamic nearest support and resistance
    let sup = price - 12.0;
    let res = price + 12.0;
    if (h1Candles.length > 0) {
      const recentH1 = h1Candles.slice(-10);
      const lows = recentH1.map((c) => c.low).filter((l) => l < price);
      const highs = recentH1.map((c) => c.high).filter((h) => h > price);
      if (lows.length > 0) sup = Math.max(...lows);
      if (highs.length > 0) res = Math.min(...highs);
    }

    // Estimated composite confidence
    const confidenceScore = Math.min(
      95,
      Math.max(
        45,
        Math.round(
          (buyRatio >= 50 ? buyRatio : sellRatio) * 0.4 +
            (spread <= 0.4 ? 30 : spread <= 0.8 ? 20 : 10) +
            (feedStatus === 'LIVE' ? 25 : 0)
        )
      )
    );

    const result = evaluateAhmedSniperChain({
      d1Candles,
      h4Candles,
      h1Candles,
      m30Candles,
      m15Candles,
      m5Candles,
      currentPrice: price,
      spread,
      buyRatio,
      sellRatio,
      buyDelta60s: buyDelta,
      sellDelta60s: sellDelta,
      confidence: confidenceScore,
      nearestSupport: sup,
      nearestResistance: res,
      feedStatus,
    });

    lastGates = result.gates;
    lastAlignedDirection = result.alignedDirection;
    lastPathClearDollars = result.pathClearDollars;
    lastConfidence = confidenceScore;
    lastWaitReason = result.waitReason;
  } catch (err) {
    console.error('[COMMAND SIGNAL ENGINE] Error during gate evaluation:', err);
  }
}

function issueNewSignal(side: SignalSide, entryPrice: number, isTest = false) {
  const entry = Number(entryPrice.toFixed(2));
  const isBuy = side === 'BUY';

  // Rules: Entry = price at issue, SL = $10 away, TP1 = $5, TP2 = $8, TP3 = $12
  const sl = Number((isBuy ? entry - SNIPER_CONFIG.slOffsetDollars : entry + SNIPER_CONFIG.slOffsetDollars).toFixed(2));
  const tp1 = Number((isBuy ? entry + SNIPER_CONFIG.tp1OffsetDollars : entry - SNIPER_CONFIG.tp1OffsetDollars).toFixed(2));
  const tp2 = Number((isBuy ? entry + SNIPER_CONFIG.tp2OffsetDollars : entry - SNIPER_CONFIG.tp2OffsetDollars).toFixed(2));
  const tp3 = Number((isBuy ? entry + SNIPER_CONFIG.tp3OffsetDollars : entry - SNIPER_CONFIG.tp3OffsetDollars).toFixed(2));

  const newSignal: CommandSignal = {
    id: `SIG-${Date.now()}`,
    side,
    entry,
    sl,
    tp1,
    tp2,
    tp3,
    tp1Hit: false,
    tp2Hit: false,
    tp3Hit: false,
    slHit: false,
    hitTargets: [],
    createdAt: Date.now(),
    livePnL: 0,
    isPaper: paperMode,
    isTest,
    confidence: lastConfidence,
    gatesPassedCount: 8,
    entryReason: `8/8 Ahmed Sniper Chain alignment (${side}) · Entry $${entry} · Path +$${lastPathClearDollars.toFixed(1)} clear`,
    sentMessageFlags: {
      issued: true,
      tp1: false,
      tp2: false,
      tp3: false,
      sl: false,
      manual: false,
      cooldown: false,
    },
  };

  activeSignal = newSignal;
  lifecycle = 'ACTIVE';

  console.log(`[COMMAND SIGNAL ENGINE] Issued NEW ${side} Signal: Entry=$${entry}, SL=$${sl}, TP1=$${tp1}, TP2=$${tp2}, TP3=$${tp3} (Paper=${paperMode}, isTest=${isTest})`);
  saveCommandSignalsToDisk();

  // Telegram notification for real signals only (never send test signals to public Telegram chat)
  if (!isTest && lastFeedStatus === 'LIVE') {
    notifyNewSignal(newSignal).catch(() => {});
  }
}

function finalizeClosedSignal(reason: SignalCloseReason, closePrice: number) {
  if (!activeSignal) return;

  const closedSignal = activeSignal;
  const isBuy = closedSignal.side === 'BUY';

  // Result integrity: Always dynamically compute PnL = (exit - entry) for BUY, (entry - exit) for SELL
  const computedPnL = isBuy
    ? Number((closePrice - closedSignal.entry).toFixed(2))
    : Number((closedSignal.entry - closePrice).toFixed(2));

  closedSignal.closedAt = Date.now();
  closedSignal.closePrice = Number(closePrice.toFixed(2));
  closedSignal.closeReason = reason;
  closedSignal.realizedPnL = computedPnL;
  closedSignal.livePnL = computedPnL;

  // Test signals NEVER enter the log or the stats
  if (!closedSignal.isTest) {
    const logEntry: CommandSignalLogEntry = {
      id: closedSignal.id,
      timestamp: closedSignal.closedAt,
      timeStr: new Date(closedSignal.closedAt).toLocaleTimeString('en-US', { hour12: false }),
      side: closedSignal.side,
      entry: closedSignal.entry,
      closePrice: closedSignal.closePrice,
      result: reason,
      pnlDollars: computedPnL,
      isPaper: closedSignal.isPaper,
      isTest: false,
    };

    // Add to beginning of history, keep last 20
    history.unshift(logEntry);
    if (history.length > SNIPER_CONFIG.maxHistoryEntries) {
      history = history.slice(0, SNIPER_CONFIG.maxHistoryEntries);
    }
  }

  // 30-minute cooldown
  lifecycle = 'COOLDOWN';
  cooldownEndsAt = Date.now() + SNIPER_CONFIG.cooldownDurationSeconds * 1000;
  activeSignal = null;

  console.log(`[COMMAND SIGNAL ENGINE] Signal ${closedSignal.id} CLOSED (${reason}): PnL=$${computedPnL} (isTest=${Boolean(closedSignal.isTest)}). Entering 30-minute cooldown.`);
  saveCommandSignalsToDisk();

  // Telegram notification for real trades only (send exactly once per event)
  if (!closedSignal.isTest) {
    if (!closedSignal.sentMessageFlags) closedSignal.sentMessageFlags = {};
    const alreadyNotified =
      (reason === 'TP3' && closedSignal.sentMessageFlags.tp3) ||
      (reason === 'SL' && closedSignal.sentMessageFlags.sl) ||
      (reason === 'MANUAL' && closedSignal.sentMessageFlags.manual);

    if (!alreadyNotified) {
      if (reason === 'TP3') closedSignal.sentMessageFlags.tp3 = true;
      else if (reason === 'SL') closedSignal.sentMessageFlags.sl = true;
      else if (reason === 'MANUAL') closedSignal.sentMessageFlags.manual = true;
      closedSignal.sentMessageFlags.cooldown = true;
      saveCommandSignalsToDisk();

      notifySignalClosed(reason, computedPnL, closePrice, closedSignal).catch(() => {});
    }
  }
}

/**
 * Manual Close active signal at current market price
 */
export function manualCloseCommandSignal(marketPrice: number): { success: boolean; message: string } {
  if (lifecycle !== 'ACTIVE' || !activeSignal) {
    return { success: false, message: 'No active signal to close.' };
  }

  const isBuy = activeSignal.side === 'BUY';
  const pnl = isBuy ? marketPrice - activeSignal.entry : activeSignal.entry - marketPrice;
  const reason: SignalCloseReason = 'MANUAL';

  finalizeClosedSignal(reason, marketPrice);
  return {
    success: true,
    message: `Active signal manually closed @ $${marketPrice.toFixed(2)} (PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}). 30-min cooldown started.`,
  };
}

/**
 * Toggle Paper Mode
 */
export function toggleCommandSignalPaperMode(): { paperMode: boolean } {
  paperMode = !paperMode;
  if (activeSignal) {
    activeSignal.isPaper = paperMode;
  }
  saveCommandSignalsToDisk();
  console.log(`[COMMAND SIGNAL ENGINE] Paper mode toggled to: ${paperMode}`);
  return { paperMode };
}

/**
 * Reset cooldown (e.g. for testing / debugging)
 */
export function resetCommandSignalCooldown(): { success: boolean; message: string } {
  lifecycle = 'WAIT';
  cooldownEndsAt = null;
  saveCommandSignalsToDisk();
  return { success: true, message: 'Cooldown reset to 0. Engine returned to WAIT.' };
}

/**
 * Trigger simulated test signal (e.g. for user inspection)
 * Marked with isTest = true so test signals never enter the signal log or stats!
 */
export function triggerSimulatedCommandSignal(side: SignalSide = 'BUY', customPrice?: number): { success: boolean; signal?: CommandSignal; message: string } {
  if (lifecycle === 'ACTIVE') {
    return { success: false, message: 'Cannot trigger: An active signal already exists. Only ONE active signal allowed at a time.' };
  }

  const price = customPrice && customPrice > 0 ? customPrice : 4118.50;
  issueNewSignal(side, price, true); // isTest = true
  return { success: true, signal: activeSignal || undefined, message: `Issued ${side} test signal @ $${price} (Paper Mode: ${paperMode}).` };
}

/**
 * Returns public snapshot of engine state
 */
export function getCommandSignalState(currentTickPrice?: number): SignalEnginePublicState {
  // Compute remaining cooldown seconds
  let cooldownRemainingSeconds = 0;
  if (lifecycle === 'COOLDOWN' && cooldownEndsAt) {
    const msLeft = cooldownEndsAt - Date.now();
    cooldownRemainingSeconds = Math.max(0, Math.ceil(msLeft / 1000));
    if (cooldownRemainingSeconds === 0) {
      lifecycle = 'WAIT';
      cooldownEndsAt = null;
    }
  }

  // Live PnL update if live price provided
  if (lifecycle === 'ACTIVE' && activeSignal && currentTickPrice && currentTickPrice > 0) {
    const isBuy = activeSignal.side === 'BUY';
    activeSignal.livePnL = isBuy
      ? Number((currentTickPrice - activeSignal.entry).toFixed(2))
      : Number((activeSignal.entry - currentTickPrice).toFixed(2));
  }

  // Strict sanitize history: remove test signals and any inconsistent records (e.g. exit - entry != pnlDollars)
  history = history.filter((rec) => {
    if (!rec || typeof rec.entry !== 'number' || typeof rec.closePrice !== 'number') return false;
    if (rec.isTest) return false;
    const isBuy = rec.side === 'BUY';
    const expectedPnL = isBuy
      ? Number((rec.closePrice - rec.entry).toFixed(2))
      : Number((rec.entry - rec.closePrice).toFixed(2));
    if (Math.abs(rec.pnlDollars - expectedPnL) > 0.05) return false;
    if (rec.result === 'TP1' && Math.abs(expectedPnL - 5.0) > 1.0) return false;
    if (rec.result === 'TP2' && Math.abs(expectedPnL - 8.0) > 1.0) return false;
    if (rec.result === 'TP3' && Math.abs(expectedPnL - 12.0) > 1.0) return false;
    if (rec.result === 'SL' && Math.abs(expectedPnL - (-10.0)) > 1.0) return false;
    return true;
  });

  const stats = computeStats(history);

  // If gates not evaluated yet, provide initialized gates
  const gates: SniperGateResult[] = lastGates.length === 8 ? lastGates : [
    { id: 'g1', name: 'W1/D1 Context', shortName: 'D1 Context', timeframe: 'D1', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Scanning multi-timeframe context...' },
    { id: 'g2', name: 'H4 Bias', shortName: 'H4 Bias', timeframe: 'H4', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Scanning multi-timeframe context...' },
    { id: 'g3', name: 'H1 Confirmation', shortName: 'H1 Confirm', timeframe: 'H1', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Scanning multi-timeframe context...' },
    { id: 'g4', name: 'M30 Refinement', shortName: 'M30 Refine', timeframe: 'M30', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Scanning multi-timeframe context...' },
    { id: 'g5', name: 'M15 Body Close', shortName: 'M15 Close', timeframe: 'M15', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Scanning multi-timeframe context...' },
    { id: 'g6', name: 'M5 Retest', shortName: 'M5 Retest', timeframe: 'M5', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Scanning multi-timeframe context...', isEstimated: true },
    { id: 'g7', name: 'M5 Confirmation', shortName: 'M5 Confirm', timeframe: 'M5', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Scanning multi-timeframe context...', isEstimated: true },
    { id: 'g8', name: 'Entry Trigger', shortName: 'Tick Trigger', timeframe: 'TICK', status: 'LOCKED', direction: 'NEUTRAL', reason: 'Scanning multi-timeframe context...' },
  ];

  return {
    lifecycle,
    activeSignal,
    cooldownRemainingSeconds,
    cooldownEndsAt,
    paperMode,
    gates,
    gatesAllPassed: gates.every((g) => g.status === 'PASS'),
    alignedDirection: lastAlignedDirection,
    waitReason: lastWaitReason,
    stats,
    history,
    lastEvaluatedAt,
    feedStatus: lastFeedStatus,
    pathClearR: Number(lastPathClearDollars.toFixed(1)),
    confidence: lastConfidence,
  };
}
