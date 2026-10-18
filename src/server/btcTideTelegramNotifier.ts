import {
  sendTelegramMessageWithRetry,
  enqueueCommandOutbox,
} from './commandTelegramService.ts';
import { BtcTideTradeRecord } from './btcTideSignalDatabase.ts';
import { DecisionEngineResult } from '../btcTide/signalEngine.ts';

function formatPrice(p: number): string {
  return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function notifyNewBtcTideSignal(
  trade: BtcTideTradeRecord,
  decision?: DecisionEngineResult
): Promise<void> {
  const isLong = trade.side === 'LONG';
  const icon = isLong ? '🟢' : '🔴';

  // Highlight top 3 bullish/bearish reasons
  let reasonsSummary = trade.triggerReason;
  if (decision && decision.components.length > 0) {
    const sorted = [...decision.components].sort((a, b) =>
      isLong ? b.score - a.score : a.score - b.score
    );
    const top3 = sorted.slice(0, 3).map((c) => `${c.name}: ${c.rawMetric}`);
    reasonsSummary = top3.join(' · ');
  }

  const msg = [
    `🌊 <b>BTC TIDE | NEW SIGNAL</b>`,
    `<b>Side:</b> ${icon} <b>${trade.side}</b>`,
    `<b>Entry:</b> <code>${formatPrice(trade.entryPrice)}</code>`,
    `<b>Stop Loss:</b> <code>${formatPrice(trade.initialSlPrice)}</code> (-1.0R = $${trade.oneR.toFixed(2)})`,
    `<b>TP1 (50% &amp; BE):</b> <code>${formatPrice(trade.tp1Price)}</code> (+1.0R)`,
    `<b>TP2 (25%):</b> <code>${formatPrice(trade.tp2Price)}</code> (+2.0R)`,
    `<b>TP3 (25%):</b> <code>${formatPrice(trade.tp3Price)}</code> (+3.0R)`,
    `<b>Confidence:</b> <b>${trade.confidence.toFixed(0)}%</b> (Lead: +${trade.lead.toFixed(0)}%)`,
    `<b>Drivers:</b> ${reasonsSummary}`,
    `<b>Expiry:</b> 15 minutes · One active trade at a time`,
  ].join('\n');

  console.log(`[BTC TIDE TELEGRAM] Dispatching NEW SIGNAL: ${trade.side} @ ${trade.entryPrice}`);
  const key = `tide_new_${trade.id}`;
  enqueueCommandOutbox(msg, key);
  sendTelegramMessageWithRetry(msg, 3, key).catch(() => {});
}

export async function notifyBtcTideTpHit(
  trade: BtcTideTradeRecord,
  tpLevel: 1 | 2 | 3,
  price: number
): Promise<void> {
  const isLong = trade.side === 'LONG';
  const tpPrice = tpLevel === 1 ? trade.tp1Price : tpLevel === 2 ? trade.tp2Price : trade.tp3Price;
  const scaledOut = tpLevel === 1 ? '50% scaled out' : tpLevel === 2 ? '25% scaled out' : 'Final 25% runner closed';

  const msg = [
    `🎯 <b>BTC TIDE | TARGET ${tpLevel} HIT!</b>`,
    `<b>Side:</b> ${isLong ? '🟢 LONG' : '🔴 SHORT'}`,
    `<b>Target:</b> <code>${formatPrice(tpPrice)}</code> (+${tpLevel}.0R)`,
    `<b>Market Fill:</b> <code>${formatPrice(price)}</code>`,
    `<b>Scaling:</b> ${scaledOut}`,
    tpLevel === 1
      ? `🛡️ <b>Stop Loss automatically moved to Breakeven at <code>${formatPrice(trade.entryPrice)}</code> (Risk is now zero)</b>`
      : `🔥 <b>Realized cumulative profit: +${tpLevel === 2 ? '1.0' : '1.75'}R</b>`,
  ].join('\n');

  console.log(`[BTC TIDE TELEGRAM] Dispatching TP${tpLevel} HIT for ${trade.id}`);
  const key = `tide_tp${tpLevel}_${trade.id}`;
  enqueueCommandOutbox(msg, key);
  sendTelegramMessageWithRetry(msg, 3, key).catch(() => {});
}

export async function notifyBtcTideBreakevenMove(trade: BtcTideTradeRecord): Promise<void> {
  const msg = [
    `🛡️ <b>BTC TIDE | STOP MOVED TO BREAKEVEN</b>`,
    `<b>Side:</b> ${trade.side === 'LONG' ? '🟢 LONG' : '🔴 SHORT'}`,
    `TP1 reached (+0.50R secured). Stop Loss updated to Entry: <code>${formatPrice(trade.entryPrice)}</code>.`,
    `Remaining 50% position is free-rolling toward TP2 &amp; TP3 with zero downside risk.`,
  ].join('\n');

  console.log(`[BTC TIDE TELEGRAM] Dispatching BREAKEVEN MOVE for ${trade.id}`);
  const key = `tide_be_${trade.id}`;
  enqueueCommandOutbox(msg, key);
  sendTelegramMessageWithRetry(msg, 3, key).catch(() => {});
}

export async function notifyBtcTideSlHit(
  trade: BtcTideTradeRecord,
  price: number
): Promise<void> {
  const wasBreakeven = trade.beMoved;
  const msg = wasBreakeven
    ? [
        `🛡️ <b>BTC TIDE | BREAKEVEN STOP TRIGGERED</b>`,
        `<b>Side:</b> ${trade.side === 'LONG' ? '🟢 LONG' : '🔴 SHORT'}`,
        `Price retraced to entry <code>${formatPrice(trade.entryPrice)}</code> after TP1.`,
        `<b>Final Realized Outcome:</b> <b>+0.50R</b> (TP1 profit preserved)`,
        `Status: Trade Closed and logged to SQLite`,
      ].join('\n')
    : [
        `🛑 <b>BTC TIDE | STOP LOSS HIT</b>`,
        `<b>Side:</b> ${trade.side === 'LONG' ? '🟢 LONG' : '🔴 SHORT'}`,
        `Exit: <code>${formatPrice(price)}</code>`,
        `<b>Realized:</b> <b>-1.0R</b> ($${trade.oneR.toFixed(2)})`,
        `Status: Trade Closed and logged to SQLite`,
      ].join('\n');

  console.log(`[BTC TIDE TELEGRAM] Dispatching SL/BE HIT for ${trade.id}`);
  const key = `tide_sl_${trade.id}`;
  enqueueCommandOutbox(msg, key);
  sendTelegramMessageWithRetry(msg, 3, key).catch(() => {});
}

export async function notifyBtcTideExpiry(
  trade: BtcTideTradeRecord,
  price: number
): Promise<void> {
  const msg = [
    `⏱️ <b>BTC TIDE | SIGNAL EXPIRED (15 MIN TIMEOUT)</b>`,
    `<b>Side:</b> ${trade.side === 'LONG' ? '🟢 LONG' : '🔴 SHORT'}`,
    `Entry: <code>${formatPrice(trade.entryPrice)}</code>`,
    `Exit: <code>${formatPrice(price)}</code>`,
    `<b>Realized Result:</b> <b>${(trade.realizedR ?? 0) >= 0 ? '+' : ''}${trade.realizedR ?? 0} R</b>`,
    `Status: Expired and logged to SQLite Database`,
  ].join('\n');

  console.log(`[BTC TIDE TELEGRAM] Dispatching EXPIRY for ${trade.id}`);
  const key = `tide_exp_${trade.id}`;
  enqueueCommandOutbox(msg, key);
  sendTelegramMessageWithRetry(msg, 3, key).catch(() => {});
}
