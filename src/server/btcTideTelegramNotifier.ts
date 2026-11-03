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
import {
  DecisionEngineResult,
  SlTpPlanPreview,
  TP1_PROFIT_LOCK_TPBASE_MULT,
} from "../btcTide/signalEngine.ts";
import { resolveClosedTradePnlUsdPerBtc } from "./btcTideSignalDatabase.ts";

// ============================================================================
// PHASE 3–6 LIVE DISPATCH & SAFETY CONFIGURATION
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

function formatPrice(p: number): string {
  return `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignalPrice(p: number): string {
  return p.toFixed(2);
}

function resolveTradeTrueRMetrics(trade: BtcTideTradeRecord) {
  const slDist =
    typeof trade.slDist === "number" && Number.isFinite(trade.slDist) && trade.slDist > 0
      ? trade.slDist
      : trade.oneR > 0
      ? trade.oneR
      : Math.max(1, Math.abs(trade.entryPrice - trade.initialSlPrice));
  const oneR = slDist;
  const slPct =
    typeof trade.slPct === "number" && Number.isFinite(trade.slPct) && trade.slPct > 0
      ? trade.slPct
      : trade.entryPrice > 0
      ? Number(((slDist / trade.entryPrice) * 100).toFixed(2))
      : 0;
  const tp1Dist = Math.abs(trade.tp1Price - trade.entryPrice);
  const tp2Dist = Math.abs(trade.tp2Price - trade.entryPrice);
  const tp3Dist = Math.abs(trade.tp3Price - trade.entryPrice);
  const tpBase =
    typeof trade.tpBase === "number" && Number.isFinite(trade.tpBase) && trade.tpBase > 0
      ? trade.tpBase
      : tp1Dist;
  const tp1R =
    typeof trade.tp1R === "number" && Number.isFinite(trade.tp1R)
      ? trade.tp1R
      : Number((tp1Dist / oneR).toFixed(2));
  const tp2R =
    typeof trade.tp2R === "number" && Number.isFinite(trade.tp2R)
      ? trade.tp2R
      : Number((tp2Dist / oneR).toFixed(2));
  const tp3R =
    typeof trade.tp3R === "number" && Number.isFinite(trade.tp3R)
      ? trade.tp3R
      : Number((tp3Dist / oneR).toFixed(2));
  const beLockDist = Number((TP1_PROFIT_LOCK_TPBASE_MULT * tpBase).toFixed(2));
  const beLockR = Number((beLockDist / oneR).toFixed(2));
  const bePlusStopPrice =
    trade.side === "LONG"
      ? Number((trade.entryPrice + beLockDist).toFixed(2))
      : Number((trade.entryPrice - beLockDist).toFixed(2));

  return {
    slDist,
    oneR,
    slPct,
    tp1Dist,
    tp2Dist,
    tp3Dist,
    tpBase,
    tp1R,
    tp2R,
    tp3R,
    beLockDist,
    beLockR,
    bePlusStopPrice,
  };
}

export function formatBtcTideNewSignalMessage(params: {
  side: "LONG" | "SHORT";
  entryPrice: number;
  slPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp3Price: number;
}): string {
  const actionLabel = params.side === "LONG" ? "BUY" : "SELL";
  return [
    `BTC/USD SIGNAL — ${actionLabel}`,
    ``,
    `Entry: ${formatSignalPrice(params.entryPrice)}`,
    ``,
    `Stop Loss (SL): ${formatSignalPrice(params.slPrice)}`,
    ``,
    `Take Profit Targets:`,
    ``,
    `* TP1: ${formatSignalPrice(params.tp1Price)}`,
    `* TP2: ${formatSignalPrice(params.tp2Price)}`,
    `* TP3: ${formatSignalPrice(params.tp3Price)}`,
  ].join("\n");
}

export function formatBtcTideTpHitMessage(tpLevel: 1 | 2 | 3): string {
  if (tpLevel === 1) {
    return [
      `BTC/USD — TP1 HIT`,
      ``,
      `First target successfully achieved.`,
      `Trade remains active.`,
    ].join("\n");
  }
  if (tpLevel === 2) {
    return [
      `BTC/USD — TP2 HIT`,
      ``,
      `Second target successfully achieved.`,
      `Trade remains active.`,
    ].join("\n");
  }
  return [
    `BTC/USD — TP3 HIT`,
    ``,
    `Third target successfully achieved.`,
    `Trade closed.`,
  ].join("\n");
}

export function formatBtcTideSlHitMessage(): string {
  return [
    `BTC/USD — STOP LOSS HIT`,
    ``,
    `Stop loss level reached.`,
    `Trade closed.`,
  ].join("\n");
}

async function dispatchNonBlocking(
  rawMsg: string,
  key: string,
  label: string,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    const msg = rawMsg.trim();

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
          `[BTC TIDE OUTBOX QUEUE] Self-check notice (${gate.reason || "degraded"}) — queuing ${key} (${label}) in command_outbox.json for automatic retry.`
        );
      }
    }

    // Mark key dispatched immediately to prevent duplicate queueing across ticks
    markBtcTideEventKeyDispatched(key);

    const startMs = Date.now();
    enqueueCommandOutbox(msg, key);
    sendTelegramMessageWithRetry(msg, 3, key)
      .then((res) => {
        const elapsedMs = Date.now() - startMs;
        console.log(
          `[BTC TIDE TELEGRAM SEND RESULT] key=${key} label=${label} success=${res.success} messageId=${res.messageId || "none"} elapsedMs=${elapsedMs}ms${res.error ? ` detail=${res.error}` : ""}`
        );
      })
      .catch((err) => {
        const elapsedMs = Date.now() - startMs;
        console.warn(
          `[BTC TIDE TELEGRAM SEND RESULT] key=${key} label=${label} success=false elapsedMs=${elapsedMs}ms detail=${err?.message || err}`
        );
      });
  } catch (err: any) {
    console.warn(`[BTC TIDE TELEGRAM] Non-blocking dispatch error (${label}):`, err?.message || err);
  }
}

export async function notifyNewBtcTideSignal(
  trade: BtcTideTradeRecord,
  decision?: DecisionEngineResult,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    const grade = trade.grade || decision?.setupGrade || "A";
    const m = resolveTradeTrueRMetrics(trade);

    const msg = formatBtcTideNewSignalMessage({
      side: trade.side,
      entryPrice: trade.entryPrice,
      slPrice: trade.initialSlPrice,
      tp1Price: trade.tp1Price,
      tp2Price: trade.tp2Price,
      tp3Price: trade.tp3Price,
    });

    const effectiveDryRun =
      options?.dryRun !== undefined ? options.dryRun : BTC_TIDE_DRY_RUN;
    if (!effectiveDryRun) {
      console.log(
        `[BTC TIDE TELEGRAM] Dispatching LIVE SIGNAL: ${trade.side} Grade ${grade} @ ${trade.entryPrice} (SL=$${m.slDist.toFixed(2)} / ${m.slPct.toFixed(2)}%, TP1=+${m.tp1R.toFixed(2)}R)`
      );
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
  _price: number,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    const msg = formatBtcTideTpHitMessage(tpLevel);

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
    const m = resolveTradeTrueRMetrics(trade);
    const msg = `BTC/USD — Stop Loss Moved to ${formatSignalPrice(m.bePlusStopPrice)}`;
    const key = `tide_be_${trade.id}`;
    await dispatchNonBlocking(msg, key, "be", options);
  } catch (err: any) {
    console.warn("[BTC TIDE TELEGRAM] Non-blocking notifier error (BE):", err?.message || err);
  }
}

export async function notifyBtcTideBreakevenClose(
  trade: BtcTideTradeRecord,
  _price: number,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    const m = resolveTradeTrueRMetrics(trade);
    const lockedR =
      typeof trade.realizedR === "number"
        ? trade.realizedR
        : Number((0.5 * m.tp1R + 0.5 * m.beLockR).toFixed(2));
    const msg = [
      `BTC/USD — BREAKEVEN STOP HIT`,
      ``,
      `Protected stop level reached after TP1.`,
      `Trade closed.`,
    ].join("\n");
    const effectiveDryRun =
      options?.dryRun !== undefined ? options.dryRun : BTC_TIDE_DRY_RUN;
    if (!effectiveDryRun) {
      console.log(
        `[BTC TIDE TELEGRAM] Dispatching BREAKEVEN+ CLOSE for ${trade.id}: Closed at protected stop after TP1 (+${lockedR.toFixed(2)}R)`
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
      (trade.beMoved && Math.abs(trade.slPrice - trade.entryPrice) <= 0.25 * trade.oneR);
    if (isBe) {
      await notifyBtcTideBreakevenClose(trade, price, options);
      return;
    }
    const msg = formatBtcTideSlHitMessage();
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
    const m = resolveTradeTrueRMetrics(trade);
    const realRVal = typeof trade.realizedR === "number" ? trade.realizedR : trade.currentR;
    const pnlUsd = resolveClosedTradePnlUsdPerBtc(trade);
    const r = `${realRVal >= 0 ? "+" : ""}${realRVal.toFixed(2)}R`;
    const pnlStr = `${pnlUsd >= 0 ? "+" : "-"}$${Math.abs(pnlUsd).toFixed(2)} per 1 BTC`;
    const isAfterTp1 = trade.outcome === "EXPIRED_AFTER_TP1";
    const headerLine = isAfterTp1
      ? `BTC/USD — MAX 3H LIFETIME AFTER TP1`
      : `BTC/USD — SIGNAL EXPIRED`;
    const msg = [
      headerLine,
      ``,
      `Time limit reached at ${formatSignalPrice(price)}.`,
      `Trade closed.`,
    ].join("\n");
    const effectiveDryRun =
      options?.dryRun !== undefined ? options.dryRun : BTC_TIDE_DRY_RUN;
    if (!effectiveDryRun) {
      console.log(
        `[BTC TIDE TELEGRAM] Dispatching ${headerLine} for ${trade.id} | Entry: ${formatPrice(trade.entryPrice)} | Close: ${formatPrice(price)} | Real R: ${r} (${pnlStr}) | TP1R: ${m.tp1R}`
      );
    }
    const key = isAfterTp1 ? `tide_exp_tp1_${trade.id}` : `tide_exp_${trade.id}`;
    await dispatchNonBlocking(msg, key, isAfterTp1 ? "expired_after_tp1" : "expiry", options);
  } catch (err: any) {
    console.warn("[BTC TIDE TELEGRAM] Non-blocking notifier error (Expiry):", err?.message || err);
  }
}

export interface WatchSetupAlertPayload {
  side: "LONG" | "SHORT";
  confidence: number;
  lead: number;
  price: number;
  missingReason: string;
  trendStateLabel?: string;
  adaptiveModeActive?: boolean;
}

export async function notifyBtcTideWatchSetup(
  payload: WatchSetupAlertPayload,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    const dirIcon = payload.side === "LONG" ? "🟢" : "🔴";
    const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
    const key = `tide_watch_${payload.side.toLowerCase()}_${hourBucket}`;

    const msg = [
      `👀 BTC TIDE SETUP WATCH — ${dirIcon} ${payload.side}`,
      `━━━━━━━━━━━━━━`,
      `⚠️ Not a trade, wait for signal`,
      `📍 Live BTC Price: ${formatPrice(payload.price)}`,
      `⚡ Confidence: ${Math.round(payload.confidence)}% | Lead: +${Math.round(payload.lead)}%${payload.adaptiveModeActive ? " | Adaptive mode ON" : ""}`,
      payload.trendStateLabel ? `📈 HTF Trend: ${payload.trendStateLabel}` : null,
      `🔒 Still Missing / Blocked By: ${payload.missingReason}`,
      `━━━━━━━━━━━━━━`,
      `Not a trade, wait for signal.`,
    ]
      .filter(Boolean)
      .join("\n");

    console.log(
      `[BTC TIDE TELEGRAM] Dispatching WATCH alert (${payload.side}, conf=${Math.round(payload.confidence)}%, lead=${Math.round(payload.lead)}%, missing=${payload.missingReason})`
    );
    await dispatchNonBlocking(msg, key, "watch_setup", options);
  } catch (err: any) {
    console.warn("[BTC TIDE TELEGRAM] Non-blocking notifier error (WATCH):", err?.message || err);
  }
}

export interface TestSetupDispatchResult {
  success: boolean;
  telegram_message_id: number | null;
  outboxId: string;
  sentAt: number;
  elapsedMs: number;
  messagePreview: string;
  plan: SlTpPlanPreview;
  error?: string;
}

export async function sendBtcTideTestSetupMessage(params: {
  plan: SlTpPlanPreview;
  confidence: number;
  lead: number;
  grade: "A+" | "A" | "B";
  isCounterTrend: boolean;
  adaptiveModeActive: boolean;
  trendStateLabel: string;
}): Promise<TestSetupDispatchResult> {
  const { plan } = params;

  const msg = formatBtcTideNewSignalMessage({
    side: plan.side,
    entryPrice: plan.entryPrice,
    slPrice: plan.slPrice,
    tp1Price: plan.tp1Price,
    tp2Price: plan.tp2Price,
    tp3Price: plan.tp3Price,
  });

  const startMs = Date.now();
  const key = `tide_test_setup_${startMs}`;

  const outboxItem = enqueueCommandOutbox(msg, key);
  const sendRes = await sendTelegramMessageWithRetry(msg, 2, key);
  const elapsedMs = Date.now() - startMs;

  console.log(
    `[BTC TIDE TELEGRAM SEND RESULT] key=${key} label=test_setup success=${sendRes.success} messageId=${sendRes.messageId || "none"} elapsedMs=${elapsedMs}ms${sendRes.error ? ` detail=${sendRes.error}` : ""}`
  );

  return {
    success: sendRes.success,
    telegram_message_id: sendRes.messageId ?? null,
    outboxId: outboxItem.id,
    sentAt: Date.now(),
    elapsedMs,
    messagePreview: msg,
    plan,
    error: sendRes.error,
  };
}



