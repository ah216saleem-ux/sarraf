import {
  sendTelegramMessageWithRetry,
  enqueueCommandOutbox,
} from './commandTelegramService.ts';
import { BtcTideTradeRecord } from './btcTideSignalDatabase.ts';
import { getTotalSignalsCountFromSqlite } from './btcTideSqliteDatabase.ts';
import { DecisionEngineResult } from '../btcTide/signalEngine.ts';

export interface TelegramNotifyOptions {
  dryRun?: boolean;
  simulateFailure?: boolean;
}

function formatPrice(p: number): string {
  return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDollarAmount(val: number): string {
  const rounded = Math.round(val * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.01;
  return `$${rounded.toLocaleString('en-US', {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
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
    const totalSignals = Math.max(1, getTotalSignalsCountFromSqlite());
    const isPaper = totalSignals <= 20;
    const paperTag = isPaper ? ` [PAPER #${totalSignals}/20]` : '';

    const msg = [
      `📊 BTC/USD TRADE SIGNAL — ${trade.side}${paperTag}`,
      ``,
      `━━━━━━━━━━━━━━`,
      `📍 Entry: ${formatPrice(trade.entryPrice)}`,
      `🛑 Stop Loss: ${formatPrice(trade.initialSlPrice)}`,
      ``,
      `🎯 Take Profit 1: ${formatPrice(trade.tp1Price)}`,
      `🎯 Take Profit 2: ${formatPrice(trade.tp2Price)}`,
      `🏆 Take Profit 3: ${formatPrice(trade.tp3Price)}`,
      `━━━━━━━━━━━━━━`,
    ].join('\n');

    if (!options?.dryRun) {
      console.log(
        `[BTC TIDE TELEGRAM] Dispatching NEW SIGNAL${paperTag}: ${trade.side} @ ${trade.entryPrice}`
      );
    }
    const key = `tide_new_${trade.id}`;
    await dispatchNonBlocking(msg, key, 'new_signal', options);
  } catch (err: any) {
    console.warn('[BTC TIDE TELEGRAM] Non-blocking notifier error (new signal):', err?.message || err);
  }
}

export async function notifyBtcTideTpHit(
  trade: BtcTideTradeRecord,
  tpLevel: 1 | 2 | 3,
  _price: number,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    const msg =
      tpLevel === 1
        ? `✅ BTC TP1 Hit`
        : tpLevel === 2
        ? `✅ BTC TP2 Hit`
        : `🎯 BTC TP3 Hit — Trade Completed`;

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
      const msg = `✅ BTC TP1 Hit`;
      await dispatchNonBlocking(msg, `tide_be_${trade.id}`, 'breakeven_move', options);
    }
  } catch (err: any) {
    console.warn('[BTC TIDE TELEGRAM] Non-blocking notifier error (BE):', err?.message || err);
  }
}

export async function notifyBtcTideSlHit(
  trade: BtcTideTradeRecord,
  _price: number,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    const msg = `❌ BTC Stop Loss Hit — Trade Closed`;

    if (!options?.dryRun) {
      console.log(`[BTC TIDE TELEGRAM] Dispatching SL HIT for ${trade.id}`);
    }
    const key = `tide_sl_${trade.id}`;
    await dispatchNonBlocking(msg, key, 'sl_hit', options);
  } catch (err: any) {
    console.warn('[BTC TIDE TELEGRAM] Non-blocking notifier error (SL):', err?.message || err);
  }
}

export async function notifyBtcTideExpiry(
  trade: BtcTideTradeRecord,
  _price: number,
  options?: TelegramNotifyOptions
): Promise<void> {
  try {
    const msg = `❌ BTC Stop Loss Hit — Trade Closed`;

    if (!options?.dryRun) {
      console.log(`[BTC TIDE TELEGRAM] Dispatching EXPIRY for ${trade.id}`);
    }
    const key = `tide_exp_${trade.id}`;
    await dispatchNonBlocking(msg, key, 'expiry', options);
  } catch (err: any) {
    console.warn('[BTC TIDE TELEGRAM] Non-blocking notifier error (Expiry):', err?.message || err);
  }
}
