import {
  sendTelegramMessageWithRetry,
  enqueueCommandOutbox,
  readCommandOutbox,
} from "./commandTelegramService.ts";
import { BtcTideTradeRecord } from "./btcTideSignalDatabase.ts";
import {
  hasDispatchedEventKeyInSqlite,
  recordDispatchedEventKeyInSqlite,
} from "./btcTideSqliteDatabase.ts";
import { DecisionEngineResult } from "../btcTide/signalEngine.ts";

// ============================================================================
// PHASE 3 LIVE DISPATCH & SAFETY CONFIGURATION
// Confirmed: BTC Tide ONLY sends Telegram signal messages and NEVER places
// any real exchange orders anywhere.
// ============================================================================
export const BTC_TIDE_PLACES_EXCHANGE_ORDERS = false as const;
export const BTC_TIDE_DRY_RUN = process.env.BTC_TIDE_DRY_RUN === "true"; // Default false: REAL LIVE Telegram dispatch
export const MANDATORY_RISK_DISCLAIMER =
  "Not financial advice. High risk. Use your own risk management.";

export interface TelegramNotifyOptions {
  dryRun?: boolean;
  simulateFailure?: boolean;
  bypassSelfCheckGate?: boolean;
}

export type LiveDispatchGateEvaluator = () => {
  allowed: boolean;
  reason: string | null;
};

let liveDispatchGateEvaluator: LiveDispatchGateEvaluator | null = null;

export function setBtcTideLiveDispatchGate(evaluator: LiveDispatchGateEvaluator | null): void {
  liveDispatchGateEvaluator = evaluator;
}

// Double-dispatch protection: in-memory set backed by SQLite meta + command_outbox.json idempotency keys
const dispatchedEventKeysMemory = new Set<string>();

export function hasDispatchedBtcTideEventKey(key: string): boolean {
  if (!key) return false;
  if (dispatchedEventKeysMemory.has(key)) return true;
  if (hasDispatchedEventKeyInSqlite(key)) {
    dispatchedEventKeysMemory.add(key);
    return true;
  }
  try {
    const outbox = readCommandOutbox();
    const existing = outbox.find(
      (item) =>
        item.idempotencyKey === key &&
        (item.status === "SENT" || item.status === "PENDING_DELIVERY")
    );
    if (existing) {
      dispatchedEventKeysMemory.add(key);
      return true;
    }
  } catch {}
  return false;
}

function markBtcTideEventKeyDispatched(key: string): void {
  if (!key) return;
  dispatchedEventKeysMemory.add(key);
  recordDispatchedEventKeyInSqlite(key);
}

function ensureMandatoryDisclaimer(msg: string): string {
  const trimmed = msg.trimEnd();
  if (trimmed.endsWith(MANDATORY_RISK_DISCLAIMER)) {
    return trimmed;
  }
  return `${trimmed}\n\n${MANDATORY_RISK_DISCLAIMER}`;
}

function formatPrice(p: number): string {
  return `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function dispatchNonBlocking(
  rawMsg: string,
  key: string,
  label: string,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    const msg = ensureMandatoryDisclaimer(rawMsg);

    if (options?.simulateFailure) {
      await Promise.reject(new Error(`Simulated Telegram network failure for ${label}`));
      return;
    }

    const effectiveDryRun =
      options?.dryRun !== undefined ? options.dryRun : BTC_TIDE_DRY_RUN;
    if (effectiveDryRun) {
      console.log(`[BTC TIDE TELEGRAM - DRY RUN] (${key}): ${msg.replace(/\n/g, " | ")}`);
      return;
    }

    // 1. Double-Dispatch Idempotency Guard (trade.id + event_type)
    if (hasDispatchedBtcTideEventKey(key)) {
      console.log(`[BTC TIDE DEDUPE] Blocked duplicate Telegram dispatch for key: ${key} (${label})`);
      return;
    }

    // 2. Startup / Live Self-Check Notice: NEVER drop or block the signal message.
    // If Telegram is temporarily unreachable, enqueue into command_outbox.json so it retries automatically with backoff.
    if (!options?.bypassSelfCheckGate && liveDispatchGateEvaluator) {
      const gate = liveDispatchGateEvaluator();
      if (!gate.allowed) {
        console.warn(
          `[BTC TIDE OUTBOX QUEUE] Self-check notice (${gate.reason || 'degraded'}) — queuing ${key} (${label}) in command_outbox.json for automatic retry.`
        );
      }
    }

    // Mark key dispatched immediately to prevent duplicate queueing across ticks
    markBtcTideEventKeyDispatched(key);

    enqueueCommandOutbox(msg, key);
    sendTelegramMessageWithRetry(msg, 3, key).catch((err) => {
      console.warn(`[BTC TIDE TELEGRAM] Non-blocking send error (${label}):`, err?.message || err);
    });
  } catch (err: any) {
    console.warn(`[BTC TIDE TELEGRAM] Non-blocking dispatch error (${label}):`, err?.message || err);
  }
}

export async function notifyNewBtcTideSignal(
  trade: BtcTideTradeRecord,
  _decision?: DecisionEngineResult,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    const dirIcon = trade.side === "LONG" ? "🟢" : "🔴";
    const msg = [
      `${dirIcon} BTC/USD LIVE TRADE SIGNAL — ${trade.side}`,
      `━━━━━━━━━━━━━━`,
      `📍 Entry: ${formatPrice(trade.entryPrice)}`,
      `🛑 Stop Loss: ${formatPrice(trade.initialSlPrice)} (1R = $${trade.oneR.toFixed(2)})`,
      ``,
      `🎯 Take Profit 1 (1R): ${formatPrice(trade.tp1Price)}`,
      `🎯 Take Profit 2 (2R): ${formatPrice(trade.tp2Price)}`,
      `🏆 Take Profit 3 (3R): ${formatPrice(trade.tp3Price)}`,
      `━━━━━━━━━━━━━━`,
      `⚡ Confidence: ${Math.round(trade.confidence)}% | Lead: +${Math.round(trade.lead)}% | Mode: LIVE`,
      MANDATORY_RISK_DISCLAIMER,
    ].join("\n");

    const effectiveDryRun =
      options?.dryRun !== undefined ? options.dryRun : BTC_TIDE_DRY_RUN;
    if (!effectiveDryRun) {
      console.log(`[BTC TIDE TELEGRAM] Dispatching LIVE SIGNAL: ${trade.side} @ ${trade.entryPrice}`);
    }

    const key = `tide_new_${trade.id}`;
    await dispatchNonBlocking(msg, key, "new_signal", options);
  } catch (err: any) {
    console.warn("[BTC TIDE TELEGRAM] Non-blocking notifier error (new signal):", err?.message || err);
  }
}

export async function notifyBtcTideTpHit(
  trade: BtcTideTradeRecord,
  tpLevel: 1 | 2 | 3,
  price: number,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    const headline =
      tpLevel === 1
        ? `✅ BTC/USD TP1 HIT (${formatPrice(price)}) — Stop Loss moved to Breakeven (${formatPrice(trade.entryPrice)})`
        : tpLevel === 2
        ? `✅ BTC/USD TP2 HIT (${formatPrice(price)}) — +2.0R Locked`
        : `🏆 BTC/USD TP3 HIT (${formatPrice(price)}) — +3.0R Full Target Completed!`;

    const msg = [headline, MANDATORY_RISK_DISCLAIMER].join("\n\n");

    const effectiveDryRun =
      options?.dryRun !== undefined ? options.dryRun : BTC_TIDE_DRY_RUN;
    if (!effectiveDryRun) {
      console.log(`[BTC TIDE TELEGRAM] Dispatching TP${tpLevel} HIT for ${trade.id}`);
    }

    const key = `tide_tp${tpLevel}_${trade.id}`;
    await dispatchNonBlocking(msg, key, `tp${tpLevel}`, options);
  } catch (err: any) {
    console.warn(`[BTC TIDE TELEGRAM] Non-blocking notifier error (TP${tpLevel}):`, err?.message || err);
  }
}

export async function notifyBtcTideBreakevenMove(
  trade: BtcTideTradeRecord,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    const msg = [
      `🛡️ BTC/USD Stop Loss Moved to Breakeven (${formatPrice(trade.entryPrice)})`,
      MANDATORY_RISK_DISCLAIMER,
    ].join("\n\n");
    const key = `tide_be_${trade.id}`;
    await dispatchNonBlocking(msg, key, "be", options);
  } catch (err: any) {
    console.warn("[BTC TIDE TELEGRAM] Non-blocking notifier error (BE):", err?.message || err);
  }
}

export async function notifyBtcTideBreakevenClose(
  trade: BtcTideTradeRecord,
  price: number,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    const msg = [
      `🛡️ BTC/USD (${formatPrice(price)}) — Closed at breakeven after TP1 (+0.5R)`,
      MANDATORY_RISK_DISCLAIMER,
    ].join("\n\n");
    const effectiveDryRun =
      options?.dryRun !== undefined ? options.dryRun : BTC_TIDE_DRY_RUN;
    if (!effectiveDryRun) {
      console.log(
        `[BTC TIDE TELEGRAM] Dispatching BREAKEVEN CLOSE for ${trade.id}: Closed at breakeven after TP1 (+0.5R)`
      );
    }
    const key = `tide_be_close_${trade.id}`;
    await dispatchNonBlocking(msg, key, "be", options);
  } catch (err: any) {
    console.warn("[BTC TIDE TELEGRAM] Non-blocking notifier error (BE close):", err?.message || err);
  }
}

export async function notifyBtcTideSlHit(
  trade: BtcTideTradeRecord,
  price: number,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    const isBe =
      trade.outcome === "TP1+BE" ||
      (trade.beMoved && Math.abs(trade.slPrice - trade.entryPrice) < 1);
    if (isBe) {
      await notifyBtcTideBreakevenClose(trade, price, options);
      return;
    }
    const msg = [
      `🛑 BTC/USD STOP LOSS HIT (${formatPrice(price)}) — Trade Closed (-1.00R)`,
      MANDATORY_RISK_DISCLAIMER,
    ].join("\n\n");
    const effectiveDryRun =
      options?.dryRun !== undefined ? options.dryRun : BTC_TIDE_DRY_RUN;
    if (!effectiveDryRun) {
      console.log(`[BTC TIDE TELEGRAM] Dispatching SL HIT for ${trade.id}`);
    }
    const key = `tide_sl_${trade.id}`;
    await dispatchNonBlocking(msg, key, "sl", options);
  } catch (err: any) {
    console.warn("[BTC TIDE TELEGRAM] Non-blocking notifier error (SL):", err?.message || err);
  }
}

export async function notifyBtcTideExpiry(
  trade: BtcTideTradeRecord,
  price: number,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    const realRVal = typeof trade.realizedR === "number" ? trade.realizedR : trade.currentR;
    const r = `${realRVal >= 0 ? "+" : ""}${realRVal.toFixed(2)}R`;
    const isAfterTp1 = trade.outcome === "EXPIRED_AFTER_TP1";
    const headerLine = isAfterTp1
      ? `⏱️ MAX 3H LIFETIME AFTER TP1 - CLOSE AT MARKET`
      : `⏱️ SIGNAL EXPIRED - CLOSE AT MARKET`;
    const msg = [
      headerLine,
      `Direction: BTC/USD ${trade.side}`,
      `Outcome: ${trade.outcome || "EXPIRED"}`,
      `Entry: ${formatPrice(trade.entryPrice)}`,
      `Close Price: ${formatPrice(price)}`,
      `Real Locked R: ${r}${isAfterTp1 ? " (includes +0.50R banked at TP1)" : ""}`,
      ``,
      MANDATORY_RISK_DISCLAIMER,
    ].join("\n");
    const effectiveDryRun =
      options?.dryRun !== undefined ? options.dryRun : BTC_TIDE_DRY_RUN;
    if (!effectiveDryRun) {
      console.log(
        `[BTC TIDE TELEGRAM] Dispatching ${headerLine} for ${trade.id} | Entry: ${formatPrice(trade.entryPrice)} | Close: ${formatPrice(price)} | Real R: ${r}`
      );
    }
    const key = isAfterTp1 ? `tide_exp_tp1_${trade.id}` : `tide_exp_${trade.id}`;
    await dispatchNonBlocking(msg, key, isAfterTp1 ? "expired_after_tp1" : "expiry", options);
  } catch (err: any) {
    console.warn("[BTC TIDE TELEGRAM] Non-blocking notifier error (Expiry):", err?.message || err);
  }
}


