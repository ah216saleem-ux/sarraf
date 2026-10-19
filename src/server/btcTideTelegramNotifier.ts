import {
  sendTelegramMessageWithRetry,
  enqueueCommandOutbox,
} from "./commandTelegramService.ts";
import { BtcTideTradeRecord } from "./btcTideSignalDatabase.ts";
import { DecisionEngineResult } from "../btcTide/signalEngine.ts";

export interface TelegramNotifyOptions {
  dryRun?: boolean;
  simulateFailure?: boolean;
}

function formatPrice(p: number): string {
  return `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function dispatchNonBlocking(
  msg: string,
  key: string,
  label: string,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    if (options?.simulateFailure) {
      await Promise.reject(new Error(`Simulated Telegram network failure for ${label}`));
      return;
    }
    if (options?.dryRun) {
      return;
    }
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
      `⚡ Confidence: ${Math.round(trade.confidence)}% | Mode: LIVE`,
    ].join("\n");

    if (!options?.dryRun) {
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
    const msg =
      tpLevel === 1
        ? `✅ BTC/USD TP1 HIT (${formatPrice(price)}) — Stop Loss moved to Breakeven (${formatPrice(trade.entryPrice)})`
        : tpLevel === 2
        ? `✅ BTC/USD TP2 HIT (${formatPrice(price)}) — +2.0R Locked`
        : `🏆 BTC/USD TP3 HIT (${formatPrice(price)}) — +3.0R Full Target Completed!`;

    if (!options?.dryRun) {
      console.log(`[BTC TIDE TELEGRAM] Dispatching TP${tpLevel} HIT for ${trade.id}`);
    }

    const key = `tide_tp${tpLevel}_${trade.id}`;
    await dispatchNonBlocking(msg, key, `tp${tpLevel}_hit`, options);
  } catch (err: any) {
    console.warn(`[BTC TIDE TELEGRAM] Non-blocking notifier error (TP${tpLevel}):`, err?.message || err);
  }
}

export async function notifyBtcTideBreakevenMove(
  trade: BtcTideTradeRecord,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    if (options?.simulateFailure || options?.dryRun) {
      const msg = `🛡️ BTC/USD Stop Loss Moved to Breakeven (${formatPrice(trade.entryPrice)})`;
      await dispatchNonBlocking(msg, `tide_be_${trade.id}`, "breakeven_move", options);
    }
  } catch (err: any) {
    console.warn("[BTC TIDE TELEGRAM] Non-blocking notifier error (BE):", err?.message || err);
  }
}

export async function notifyBtcTideSlHit(
  trade: BtcTideTradeRecord,
  price: number,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    const isBe = trade.beMoved && Math.abs(trade.slPrice - trade.entryPrice) < 1;
    const msg = isBe
      ? `🛡️ BTC/USD CLOSED AT BREAKEVEN (${formatPrice(price)}) — +0.50R Preserved after TP1`
      : `🛑 BTC/USD STOP LOSS HIT (${formatPrice(price)}) — Trade Closed (-1.00R)`;
    if (!options?.dryRun) {
      console.log(`[BTC TIDE TELEGRAM] Dispatching SL HIT for ${trade.id}`);
    }
    const key = `tide_sl_${trade.id}`;
    await dispatchNonBlocking(msg, key, "sl_hit", options);
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
    const r = typeof trade.realizedR === "number" ? `${trade.realizedR >= 0 ? "+" : ""}${trade.realizedR.toFixed(2)}R` : "0.00R";
    const msg = `⏱️ BTC/USD TRADE CLOSED (Expiry @ ${formatPrice(price)} | Result: ${r})`;
    if (!options?.dryRun) {
      console.log(`[BTC TIDE TELEGRAM] Dispatching EXPIRY for ${trade.id}`);
    }
    const key = `tide_exp_${trade.id}`;
    await dispatchNonBlocking(msg, key, "expiry", options);
  } catch (err: any) {
    console.warn("[BTC TIDE TELEGRAM] Non-blocking notifier error (Expiry):", err?.message || err);
  }
}
