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
} from 'lucide-react';

interface ActiveTradePlanCardProps {
  trade: BtcTideTradeRecord | null;
  currentPrice: number | null;
  status: BtcFeedStatus;
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
  const mm = String(Math.floor(diffSec / 60)).padStart(2, '0');
  const ss = String(diffSec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export const ActiveTradePlanCard: React.FC<ActiveTradePlanCardProps> = React.memo(
  ({ trade, currentPrice, status }) => {
    const isStaleOrOffline = status === 'STALE' || status === 'OFFLINE';
    const [expiryCountdown, setExpiryCountdown] = useState<string>('--:--');

    useEffect(() => {
      if (!trade) return;
      const update = () => {
        setExpiryCountdown(formatCountdown(trade.expiryTime));
      };
      update();
      const interval = setInterval(update, 1000);
      return () => clearInterval(interval);
    }, [trade?.expiryTime]);

    if (!trade) {
      return (
        <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 sm:p-5 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.5)] flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-[#FFD97A]" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                LIVE TRADE PLAN &amp; OUTCOME TRACKER
              </span>
            </div>
            <span className="font-mono text-[10px] text-neutral-400 px-2 py-0.5 rounded bg-white/5 border border-white/10">
              ONE TRADE AT A TIME
            </span>
          </div>

          <div className="py-8 flex flex-col items-center justify-center text-center font-mono space-y-2">
            <div className="w-12 h-12 rounded-full border border-dashed border-[#E8B84A]/40 flex items-center justify-center text-[#FFD97A] animate-pulse">
              <Crosshair className="w-6 h-6" />
            </div>
            <div className="text-white text-xs font-bold uppercase tracking-wide">
              NO ACTIVE TRADE IN PROGRESS
            </div>
            <div className="text-neutral-400 text-[11px] max-w-sm">
              Live signal engine running on 1-sec real ticks. Awaiting setup meeting &ge; 68% confidence,
              &ge; 22% lead, and agreed Absorb/Drive flow.
            </div>
          </div>
        </div>
      );
    }

    const isLong = trade.side === 'LONG';
    const isProfitable = trade.currentR >= 0;

    // Progress through R targets
    const progressR = Math.max(-1.5, Math.min(3.5, trade.currentR));
    const progressPct = Math.max(0, Math.min(100, ((progressR + 1) / 4) * 100));

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
              <div className="flex items-center gap-2 font-mono">
                <span
                  className={`px-2 py-0.5 rounded text-xs font-black uppercase ${
                    isLong
                      ? 'bg-teal-950/80 text-teal-300 border border-teal-500/50 shadow-[0_0_10px_rgba(20,184,166,0.3)]'
                      : 'bg-rose-950/80 text-rose-300 border border-rose-500/50 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                  }`}
                >
                  ACTIVE {trade.side}
                </span>

                {trade.beMoved && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-[#FFD97A] px-2 py-0.5 rounded bg-[#FFD97A]/10 border border-[#FFD97A]/30">
                    <Lock className="w-3 h-3" />
                    <span>BREAKEVEN ACTIVE</span>
                  </span>
                )}

                <span className="text-[10px] text-neutral-400">
                  TRIGGERED: {new Date(trade.entryTime).toTimeString().split(' ')[0]} UTC
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
              <div className="text-[10px] text-neutral-400 uppercase">LIVE P&amp;L IN R</div>
              <div
                className={`text-xl font-black ${
                  isProfitable ? 'text-teal-400 drop-shadow-[0_0_8px_rgba(20,184,166,0.5)]' : 'text-rose-400'
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

            {/* 15m Expiry Countdown */}
            <div className="px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/10 text-neutral-300 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#FFD97A]" />
              <span>EXP: {expiryCountdown}</span>
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
              <span>{trade.beMoved ? 'BE STOP (100%)' : 'STOP LOSS'}</span>
              {trade.beMoved && <Lock className="w-3 h-3 text-amber-400" />}
            </div>
            <div className="text-sm font-bold text-rose-300 mt-1">
              {formatPrice(trade.slPrice)}
            </div>
            <div className="text-[10px] text-neutral-400 mt-0.5">
              1R = ${trade.oneR.toFixed(2)}
            </div>
          </div>

          {/* Entry Level */}
          <div className="bg-black/50 border border-white/10 rounded-lg p-2.5">
            <div className="text-[10px] text-neutral-400 uppercase">ENTRY PRICE</div>
            <div className="text-sm font-bold text-white mt-1">
              {formatPrice(trade.entryPrice)}
            </div>
            <div className="text-[10px] text-neutral-400 mt-0.5">REAL TAKER FILL</div>
          </div>

          {/* TP1 (+1R, 50% scale out) */}
          <div
            className={`border rounded-lg p-2.5 ${
              trade.tp1Hit
                ? 'bg-teal-950/40 border-teal-500/50'
                : 'bg-black/50 border-white/10'
            }`}
          >
            <div className="text-[10px] text-teal-400 uppercase flex items-center justify-between">
              <span>TP1 (+1.0R · 50%)</span>
              {trade.tp1Hit && <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />}
            </div>
            <div className="text-sm font-bold text-teal-300 mt-1">
              {formatPrice(trade.tp1Price)}
            </div>
            <div className="text-[10px] text-neutral-400 mt-0.5">
              {trade.tp1Hit ? 'SECURED +0.50R' : 'Scale 50% & Move BE'}
            </div>
          </div>

          {/* TP2 (+2R, 25% scale out) */}
          <div
            className={`border rounded-lg p-2.5 ${
              trade.tp2Hit
                ? 'bg-teal-950/40 border-teal-500/50'
                : 'bg-black/50 border-white/10'
            }`}
          >
            <div className="text-[10px] text-teal-400 uppercase flex items-center justify-between">
              <span>TP2 (+2.0R · 25%)</span>
              {trade.tp2Hit && <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />}
            </div>
            <div className="text-sm font-bold text-teal-300 mt-1">
              {formatPrice(trade.tp2Price)}
            </div>
            <div className="text-[10px] text-neutral-400 mt-0.5">
              {trade.tp2Hit ? 'SECURED +0.50R' : 'Scale 25%'}
            </div>
          </div>

          {/* TP3 (+3R, 25% scale out / runner) */}
          <div
            className={`border rounded-lg p-2.5 ${
              trade.tp3Hit
                ? 'bg-teal-950/40 border-teal-500/50'
                : 'bg-black/50 border-white/10'
            }`}
          >
            <div className="text-[10px] text-teal-400 uppercase flex items-center justify-between">
              <span>TP3 (+3.0R · 25%)</span>
              {trade.tp3Hit && <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />}
            </div>
            <div className="text-sm font-bold text-teal-300 mt-1">
              {formatPrice(trade.tp3Price)}
            </div>
            <div className="text-[10px] text-neutral-400 mt-0.5">
              {trade.tp3Hit ? 'RUNNER SECURED' : 'Final 25% Close'}
            </div>
          </div>
        </div>

        {/* Live R Progress Track Bar */}
        <div className="bg-black/40 border border-white/5 rounded-lg p-3 font-mono text-xs">
          <div className="flex items-center justify-between text-[11px] mb-1.5">
            <span className="text-rose-400 font-semibold">SL (-1.0R)</span>
            <span className="text-neutral-400">ENTRY (0.0R)</span>
            <span className="text-teal-400 font-semibold">TP1 (+1.0R)</span>
            <span className="text-teal-300 font-semibold">TP2 (+2.0R)</span>
            <span className="text-[#FFD97A] font-bold">TP3 (+3.0R)</span>
          </div>

          <div className="relative h-2.5 bg-neutral-900 rounded-full overflow-hidden border border-white/10">
            {/* Zero point marker at 25% */}
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
