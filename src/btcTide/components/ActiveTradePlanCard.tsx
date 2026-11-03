import React, { useState, useEffect } from 'react';
import { BtcTideTradeRecord } from '../../server/btcTideSignalDatabase';
import { BtcFeedStatus } from '../types';
import {
  Crosshair,
  ShieldCheck,
  Target,
  Clock,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  Lock,
  AlertTriangle,
} from 'lucide-react';

interface ActiveTradePlanCardProps {
  trade: BtcTideTradeRecord | null;
  lastClosedTrade?: BtcTideTradeRecord | null;
  currentPrice: number | null;
  status: BtcFeedStatus;
  isSpotStale?: boolean;
  spotAgeMs?: number;
}

function formatPrice(val: number | null): string {
  if (val === null || val <= 0) return '--';
  return `$${val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCountdown(targetMs: number): string {
  const diffSec = Math.max(0, Math.floor((targetMs - Date.now()) / 1000));
  const hh = Math.floor(diffSec / 3600);
  const mm = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
  const ss = String(diffSec % 60).padStart(2, '0');
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

const MAX_TRADE_LIFETIME_MS = 3 * 60 * 60 * 1000;

export const ActiveTradePlanCard: React.FC<ActiveTradePlanCardProps> = React.memo(
  ({ trade, lastClosedTrade = null, currentPrice, status, isSpotStale = false, spotAgeMs = 0 }) => {
    const isStaleOrOffline = isSpotStale || status === 'STALE' || status === 'OFFLINE';
    const ageLabel =
      spotAgeMs > 0 && spotAgeMs < 999999 ? `${(spotAgeMs / 1000).toFixed(1)}s` : '--';
    const [expiryCountdown, setExpiryCountdown] = useState<string>('--:--');

    useEffect(() => {
      if (!trade) return;
      const update = () => {
        const target = trade.tp1Hit
          ? trade.entryTime + MAX_TRADE_LIFETIME_MS
          : trade.expiryTime;
        setExpiryCountdown(formatCountdown(target));
      };
      update();
      const interval = setInterval(update, 1000);
      return () => clearInterval(interval);
    }, [trade?.expiryTime, trade?.entryTime, trade?.tp1Hit]);

    const expiredAlertTrade =
      lastClosedTrade &&
      (lastClosedTrade.outcome === 'EXPIRED' || lastClosedTrade.outcome === 'EXPIRED_AFTER_TP1')
        ? lastClosedTrade
        : null;

    if (!trade) {
      return (
        <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 sm:p-5 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)] flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-[#FFD97A]" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                LIVE TRADE PLAN &amp; OUTCOME TRACKER
              </span>
              {isStaleOrOffline && (
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300">
                  STALE · {ageLabel}
                </span>
              )}
            </div>
            <span className="font-mono text-[10px] text-neutral-400 px-2 py-0.5 rounded bg-white/5 border border-white/10">
              ONE TRADE AT A TIME
            </span>
          </div>

          {expiredAlertTrade && (
            <div className="rounded-lg bg-amber-950/50 border border-amber-500/50 px-3.5 py-2.5 font-mono text-xs flex flex-wrap items-center justify-between gap-2 text-amber-200">
              <div className="flex items-center gap-2 font-bold text-amber-300">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  {expiredAlertTrade.outcome === 'EXPIRED_AFTER_TP1'
                    ? 'MAX 3H LIFETIME AFTER TP1 - CLOSE AT MARKET'
                    : 'SIGNAL EXPIRED - CLOSE AT MARKET'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px]">
                <span>
                  Entry: <strong className="text-white">{formatPrice(expiredAlertTrade.entryPrice)}</strong>
                </span>
                <span>
                  Close: <strong className="text-white">{formatPrice(expiredAlertTrade.closePrice)}</strong>
                </span>
                <span>
                  Real Locked R:{' '}
                  <strong
                    className={
                      (expiredAlertTrade.realizedR ?? 0) >= 0 ? 'text-teal-300' : 'text-rose-300'
                    }
                  >
                    {(expiredAlertTrade.realizedR ?? 0) >= 0 ? '+' : ''}
                    {(expiredAlertTrade.realizedR ?? 0).toFixed(2)}R
                  </strong>
                </span>
              </div>
            </div>
          )}

          <div className="py-8 flex flex-col items-center justify-center text-center font-mono space-y-2">
            <div className="w-12 h-12 rounded-full border border-dashed border-[#E8B84A]/40 flex items-center justify-center text-[#FFD97A] animate-pulse">
              <Crosshair className="w-6 h-6" />
            </div>
            <div className="text-white text-xs font-bold uppercase tracking-wide">
              NO ACTIVE TRADE IN PROGRESS
            </div>
            <div className="text-neutral-400 text-[11px] max-w-md">
              Live signal engine running on 1-sec real ticks. Awaiting setup meeting &ge; 68% confidence
              (65% in Adaptive Quiet Mode), &ge; 22% lead (18% Adaptive), HTF 1H/4H filter, SL 0.50%&ndash;1.00%
              of entry (2.5x ATR15m floor), and 45s confirmation.
            </div>
          </div>
        </div>
      );
    }

    const isLong = trade.side === 'LONG';
    const isProfitable = trade.currentR >= 0;
    const slDistDollars = Number(
      (
        typeof trade.slDist === 'number' && trade.slDist > 0
          ? trade.slDist
          : Math.abs(trade.entryPrice - trade.initialSlPrice) || trade.oneR
      ).toFixed(2)
    );
    const oneR = slDistDollars > 0 ? slDistDollars : trade.oneR;
    const slPctVal = Number(
      (
        typeof trade.slPct === 'number' && trade.slPct > 0
          ? trade.slPct
          : trade.entryPrice > 0
          ? (slDistDollars / trade.entryPrice) * 100
          : 0
      ).toFixed(2)
    );
    const tp1Dist = Number(Math.abs(trade.tp1Price - trade.entryPrice).toFixed(2));
    const tp2Dist = Number(Math.abs(trade.tp2Price - trade.entryPrice).toFixed(2));
    const tp3Dist = Number(Math.abs(trade.tp3Price - trade.entryPrice).toFixed(2));
    const tpBaseVal = Number(
      (typeof trade.tpBase === 'number' && trade.tpBase > 0 ? trade.tpBase : tp1Dist).toFixed(2)
    );
    const tp1RVal = Number(
      (typeof trade.tp1R === 'number' && trade.tp1R > 0
        ? trade.tp1R
        : oneR > 0
        ? tp1Dist / oneR
        : 1.0
      ).toFixed(2)
    );
    const tp2RVal = Number(
      (typeof trade.tp2R === 'number' && trade.tp2R > 0
        ? trade.tp2R
        : oneR > 0
        ? tp2Dist / oneR
        : 2.0
      ).toFixed(2)
    );
    const tp3RVal = Number(
      (typeof trade.tp3R === 'number' && trade.tp3R > 0
        ? trade.tp3R
        : oneR > 0
        ? tp3Dist / oneR
        : 3.0
      ).toFixed(2)
    );
    const beLockDist = Number((0.1 * tpBaseVal).toFixed(2));
    const beLockRVal = oneR > 0 ? Number((beLockDist / oneR).toFixed(2)) : 0.06;
    const lockedTp1BeR = Number((0.5 * tp1RVal + 0.5 * beLockRVal).toFixed(2));
    const showLowRWarning = tp1RVal < 0.7;

    const tradeGrade = trade.grade || (trade.confidence >= 75 ? 'A+' : trade.confidence >= 70 ? 'A' : 'B');
    const atr5mVal = typeof trade.atr5m === 'number' ? trade.atr5m : null;
    const atr15mVal = typeof trade.atr15m === 'number' ? trade.atr15m : null;

    // Progress through R targets
    const maxScaleR = Math.max(2.0, tp3RVal + 0.3);
    const progressR = Math.max(-1.2, Math.min(maxScaleR, trade.currentR));
    const progressPct = Math.max(0, Math.min(100, ((progressR + 1) / (maxScaleR + 1)) * 100));

    return (
      <div className="bg-[#08080a] border border-[#E8B84A]/30 rounded-xl p-4 sm:p-5 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)] space-y-4">
        {/* Active Trade Header & Lock-On Animation */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/5">
          <div className="flex items-center gap-3">
            {/* Radar / Reticle Lock-On Animation */}
            <div className="relative w-9 h-9 rounded-xl bg-black/60 border border-[#E8B84A]/40 flex items-center justify-center overflow-hidden">
              <span className="absolute inset-0 border border-[#FFD97A] rounded-xl animate-ping opacity-35" />
              <Crosshair className="w-5 h-5 text-[#FFD97A] animate-spin-slow" />
              <div className="absolute w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2 font-mono">
                <span
                  className={`px-2 py-0.5 rounded text-xs font-black uppercase ${
                    isLong
                      ? 'bg-teal-950/80 text-teal-300 border border-teal-500/50 shadow-[0_0_10px_rgba(20,184,166,0.3)]'
                      : 'bg-rose-950/80 text-rose-300 border border-rose-500/50 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                  }`}
                >
                  ACTIVE {trade.side} · GRADE {tradeGrade}
                </span>

                {tradeGrade === 'B' && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/80 border border-amber-500/50 text-amber-300">
                    HALF SIZE SUGGESTED
                  </span>
                )}

                {trade.isCounterTrend && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950/80 border border-purple-500/50 text-purple-300">
                    COUNTER-TREND
                  </span>
                )}

                {trade.adaptiveMode && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950/80 border border-cyan-500/50 text-cyan-300">
                    ADAPTIVE MODE ON
                  </span>
                )}

                {showLowRWarning && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/80 border border-amber-500/50 text-amber-300">
                    ⚠ TP1 smaller than SL - needs high win rate
                  </span>
                )}

                {trade.beMoved && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-[#FFD97A] px-2 py-0.5 rounded bg-[#FFD97A]/10 border border-[#FFD97A]/30">
                    <Lock className="w-3 h-3" />
                    <span>
                      STOP @ ENTRY {isLong ? '+' : '-'} 0.1x tpBase (+{lockedTp1BeR.toFixed(2)}R LOCKED)
                    </span>
                  </span>
                )}

                {isStaleOrOffline && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300">
                    STALE · {ageLabel}
                  </span>
                )}

                <span className="text-[10px] text-neutral-400">
                  TRIGGERED: {new Date(trade.entryTime).toISOString().slice(11, 19)} UTC
                </span>
              </div>

              <div className="font-mono text-[11px] text-neutral-400 mt-0.5">
                {trade.triggerReason} (Conf: {trade.confidence.toFixed(0)}%, Lead: +
                {trade.lead.toFixed(0)}%)
              </div>
            </div>
          </div>

          {/* Right Status & Expiry Countdown */}
          <div className="flex items-center gap-3 font-mono text-xs">
            {/* Live P&L in R */}
            <div className="text-right">
              <div className="text-[10px] text-neutral-400 uppercase">
                LIVE P&amp;L IN TRUE R {isStaleOrOffline ? `(${ageLabel})` : ''}
              </div>
              <div
                className={`text-xl font-black ${
                  isStaleOrOffline
                    ? 'text-neutral-500'
                    : isProfitable
                    ? 'text-teal-400 drop-shadow-[0_0_8px_rgba(20,184,166,0.5)]'
                    : 'text-rose-400'
                }`}
              >
                {isProfitable ? '+' : ''}
                {trade.currentR.toFixed(2)} R
                <span className="text-xs font-normal ml-1">
                  ({isProfitable ? '+' : ''}
                  {trade.pnlPercent.toFixed(2)}%)
                </span>
              </div>
            </div>

            {/* 60m Expiry Countdown (or 3h Max Lifetime Countdown after TP1) */}
            <div className="px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/10 text-neutral-300 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#FFD97A]" />
              <span>{trade.tp1Hit ? `BE STOP (MAX 3H: ${expiryCountdown})` : `EXP: ${expiryCountdown}`}</span>
            </div>
          </div>
        </div>

        {/* Trade Plan Levels & Scaling Out Map */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 font-mono text-xs">
          {/* SL Level */}
          <div
            className={`border rounded-lg p-2.5 ${
              trade.beMoved
                ? 'bg-amber-950/20 border-amber-500/30'
                : 'bg-rose-950/20 border-rose-500/30'
            }`}
          >
            <div className="text-[10px] text-neutral-400 uppercase flex items-center justify-between">
              <span>
                {trade.beMoved
                  ? `STOP (+0.1x tpBase · +${beLockRVal.toFixed(2)}R)`
                  : `STOP LOSS (-1.00R · ${slPctVal.toFixed(2)}%)`}
              </span>
              {trade.beMoved && <Lock className="w-3 h-3 text-amber-400" />}
            </div>
            <div className="text-sm font-bold text-rose-300 mt-1">
              {formatPrice(trade.slPrice)}
            </div>
            <div className="text-[10px] text-neutral-400 mt-0.5">
              {trade.beMoved
                ? `Moved to Entry ${isLong ? '+' : '-'} $${beLockDist.toFixed(2)} (+${beLockRVal.toFixed(2)}R)`
                : `-$${slDistDollars.toFixed(2)} (${slPctVal.toFixed(2)}% · -1.00R)`}
            </div>
          </div>

          {/* Entry Level */}
          <div className="bg-black/50 border border-white/10 rounded-lg p-2.5">
            <div className="text-[10px] text-neutral-400 uppercase">ENTRY PRICE</div>
            <div className="text-sm font-bold text-white mt-1">
              {formatPrice(trade.entryPrice)}
            </div>
            <div className="text-[10px] text-neutral-400 mt-0.5">
              1R = ${oneR.toFixed(2)} · TP1 R:R = {tp1RVal.toFixed(2)}:1
            </div>
          </div>

          {/* TP1 (True R · 50%) */}
          <div
            className={`border rounded-lg p-2.5 ${
              trade.tp1Hit
                ? 'bg-teal-950/40 border-teal-500/50'
                : 'bg-black/50 border-white/10'
            }`}
          >
            <div className="text-[10px] text-teal-400 uppercase flex items-center justify-between">
              <span>TP1 (+{tp1RVal.toFixed(2)}R · 50%)</span>
              {trade.tp1Hit && <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />}
            </div>
            <div className="text-sm font-bold text-teal-300 mt-1">
              {formatPrice(trade.tp1Price)}
            </div>
            <div className="text-[10px] text-neutral-400 mt-0.5">
              +${tp1Dist.toFixed(2)} (+{tp1RVal.toFixed(2)}R)
            </div>
          </div>

          {/* TP2 (True R · 25%) */}
          <div
            className={`border rounded-lg p-2.5 ${
              trade.tp2Hit
                ? 'bg-teal-950/40 border-teal-500/50'
                : 'bg-black/50 border-white/10'
            }`}
          >
            <div className="text-[10px] text-teal-400 uppercase flex items-center justify-between">
              <span>TP2 (+{tp2RVal.toFixed(2)}R · 25%)</span>
              {trade.tp2Hit && <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />}
            </div>
            <div className="text-sm font-bold text-teal-300 mt-1">
              {formatPrice(trade.tp2Price)}
            </div>
            <div className="text-[10px] text-neutral-400 mt-0.5">
              +${tp2Dist.toFixed(2)} (+{tp2RVal.toFixed(2)}R)
            </div>
          </div>

          {/* TP3 (True R · 25%) */}
          <div
            className={`border rounded-lg p-2.5 ${
              trade.tp3Hit
                ? 'bg-teal-950/40 border-teal-500/50'
                : 'bg-black/50 border-white/10'
            }`}
          >
            <div className="text-[10px] text-teal-400 uppercase flex items-center justify-between">
              <span>TP3 (+{tp3RVal.toFixed(2)}R · 25%)</span>
              {trade.tp3Hit && <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />}
            </div>
            <div className="text-sm font-bold text-teal-300 mt-1">
              {formatPrice(trade.tp3Price)}
            </div>
            <div className="text-[10px] text-neutral-400 mt-0.5">
              +${tp3Dist.toFixed(2)} (+{tp3RVal.toFixed(2)}R)
            </div>
          </div>
        </div>

        {/* SL/TP Rework Telemetry & Position Sizing Bar */}
        <div className="bg-black/50 border border-white/10 rounded-lg px-3 py-2 font-mono text-[11px] flex flex-wrap items-center justify-between gap-2 text-neutral-300">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              SL: <strong className="text-rose-300">${slDistDollars.toFixed(2)} ({slPctVal.toFixed(2)}% · -1.00R)</strong>
            </span>
            <span>
              TP Base: <strong className="text-teal-300">${tpBaseVal.toFixed(2)}</strong>
            </span>
            <span>
              TP1 R:R: <strong className="text-[#FFD97A]">{tp1RVal.toFixed(2)}:1</strong>
            </span>
            <span>
              ATR(5m):{' '}
              <strong className="text-teal-300">
                {atr5mVal !== null ? `$${atr5mVal.toFixed(2)}` : '--'}
              </strong>
            </span>
            <span>
              ATR(15m):{' '}
              <strong className="text-teal-300">
                {atr15mVal !== null ? `$${atr15mVal.toFixed(2)}` : '--'}
              </strong>
            </span>
            {showLowRWarning && (
              <span className="text-amber-300 font-bold">
                ⚠ TP1 smaller than SL - needs high win rate
              </span>
            )}
          </div>
          <div className="text-[#FFD97A] font-semibold">
            Risk 1% account: size = account x 1% / SL distance (${slDistDollars.toFixed(2)})
            {tradeGrade === 'B' ? ' · Grade B: half size suggested (0.5% risk)' : ''}
          </div>
        </div>

        {/* Live R Progress Track Bar */}
        <div className="bg-black/40 border border-white/5 rounded-lg p-3 font-mono text-xs">
          <div className="flex items-center justify-between text-[11px] mb-1.5">
            <span className="text-rose-400 font-semibold">
              {trade.beMoved
                ? `PROFIT-LOCK STOP (+0.1x tpBase / +${beLockRVal.toFixed(2)}R)`
                : `STOP LOSS -$${slDistDollars.toFixed(0)} (${slPctVal.toFixed(2)}%) = -1.00R`}
            </span>
            <span className="text-neutral-400">ENTRY</span>
            <span className="text-teal-400 font-semibold">TP1 (+{tp1RVal.toFixed(2)}R · 50%)</span>
            <span className="text-teal-300 font-semibold">TP2 (+{tp2RVal.toFixed(2)}R · 25%)</span>
            <span className="text-[#FFD97A] font-bold">TP3 (+{tp3RVal.toFixed(2)}R · 25%)</span>
          </div>

          <div className="relative h-2.5 bg-neutral-900 rounded-full overflow-hidden border border-white/10">
            {/* Zero point marker */}
            <div className="absolute top-0 bottom-0 left-[25%] w-0.5 bg-white/30 z-10" />

            <div
              className={`h-full transition-all duration-300 ${
                isProfitable
                  ? 'bg-gradient-to-r from-teal-500 to-[#FFD97A]'
                  : 'bg-gradient-to-r from-rose-600 to-rose-400'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>
    );
  }
);

ActiveTradePlanCard.displayName = 'ActiveTradePlanCard';
