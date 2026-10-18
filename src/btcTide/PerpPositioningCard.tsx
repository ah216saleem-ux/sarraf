import React, { useState, useEffect } from 'react';
import { PerpPositioning, BtcFeedStatus } from './types';
import { ShieldAlert, Zap, Clock, TrendingUp, TrendingDown, Flame } from 'lucide-react';

interface PerpPositioningCardProps {
  perp: PerpPositioning;
  status: BtcFeedStatus;
}

function formatCountdown(targetMs: number | null): string {
  if (!targetMs) return '--:--:--';
  const diffSec = Math.max(0, Math.floor((targetMs - Date.now()) / 1000));
  const hh = String(Math.floor(diffSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
  const ss = String(diffSec % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatUsdCompact(val: number | null): string {
  if (val === null) return '--';
  const abs = Math.abs(val);
  if (abs >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

export const PerpPositioningCard: React.FC<PerpPositioningCardProps> = React.memo(
  ({ perp, status }) => {
    const isStaleOrOffline = status === 'STALE' || status === 'OFFLINE';
    const [countdown, setCountdown] = useState<string>('--:--:--');

    useEffect(() => {
      const update = () => {
        if (typeof document !== 'undefined' && document.hidden) return;
        setCountdown(formatCountdown(perp.nextFundingTime));
      };
      update();
      const interval = setInterval(update, 1000);
      return () => clearInterval(interval);
    }, [perp.nextFundingTime]);

    const {
      markPrice,
      fundingRate,
      openInterest,
      oiChange1h,
      oiChange1hPct,
      basis,
      basisBps,
      longShortRatio,
      longAccountPct,
      shortAccountPct,
      liquidations5m,
      totalLiq5mUsd,
      longLiq5mUsd,
      shortLiq5mUsd,
    } = perp;

    const isBasisPositive = basis !== null && basis >= 0;
    const isFundingPositive = fundingRate !== null && fundingRate >= 0;
    const isOiChangePositive = oiChange1h !== null && oiChange1h >= 0;

    return (
      <div className="bg-[#08080a] border border-[#E8B84A]/20 rounded-xl p-4 backdrop-blur-md flex flex-col justify-between shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
        <div>
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#FFD97A]" />
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-white">
                BINANCE PERP POSITIONING &amp; DERIVATIVES
              </span>
            </div>
            <div className="font-mono text-[11px] text-neutral-400 flex items-center gap-2">
              <span>MARK:</span>
              <span className="text-white font-bold">
                {markPrice !== null ? `$${markPrice.toFixed(2)}` : '--'}
              </span>
            </div>
          </div>

          {/* Grid of Key Perp Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3 font-mono text-xs">
            {/* 1. Funding Rate & Countdown */}
            <div className="bg-black/40 border border-white/5 rounded-lg p-2.5">
              <div className="text-[10px] text-neutral-400 uppercase flex items-center justify-between">
                <span>FUNDING RATE</span>
                <Clock className="w-3 h-3 text-[#FFD97A]" />
              </div>
              <div
                className={`text-sm sm:text-base font-bold mt-0.5 ${
                  isStaleOrOffline || fundingRate === null
                    ? 'text-neutral-500'
                    : isFundingPositive
                    ? 'text-teal-400'
                    : 'text-rose-400'
                }`}
              >
                {fundingRate !== null
                  ? `${isFundingPositive ? '+' : ''}${(fundingRate * 100).toFixed(4)}%`
                  : '--'}
              </div>
              <div className="text-[10px] text-neutral-400 mt-0.5 flex items-center gap-1">
                <span>NEXT:</span>
                <span className="text-[#FFD97A] font-semibold">{countdown}</span>
              </div>
            </div>

            {/* 2. Open Interest & 1h Change */}
            <div className="bg-black/40 border border-white/5 rounded-lg p-2.5">
              <div className="text-[10px] text-neutral-400 uppercase">OPEN INTEREST</div>
              <div className="text-sm sm:text-base font-bold text-white mt-0.5">
                {openInterest !== null
                  ? `${openInterest.toLocaleString('en-US', { maximumFractionDigits: 0 })} ₿`
                  : '--'}
              </div>
              <div
                className={`text-[10px] mt-0.5 font-semibold flex items-center gap-0.5 ${
                  isStaleOrOffline || oiChange1h === null
                    ? 'text-neutral-500'
                    : isOiChangePositive
                    ? 'text-teal-400'
                    : 'text-rose-400'
                }`}
              >
                {isOiChangePositive ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                <span>
                  {oiChange1h !== null
                    ? `${isOiChangePositive ? '+' : ''}${oiChange1h.toFixed(1)} ₿ (1h)`
                    : '-- (1h)'}
                </span>
              </div>
            </div>

            {/* 3. Perp vs Spot Basis */}
            <div className="bg-black/40 border border-white/5 rounded-lg p-2.5">
              <div className="text-[10px] text-neutral-400 uppercase">PERP VS SPOT BASIS</div>
              <div
                className={`text-sm sm:text-base font-bold mt-0.5 ${
                  isStaleOrOffline || basis === null
                    ? 'text-neutral-500'
                    : isBasisPositive
                    ? 'text-teal-400'
                    : 'text-rose-400'
                }`}
              >
                {basis !== null ? `${isBasisPositive ? '+' : ''}$${basis.toFixed(2)}` : '--'}
              </div>
              <div className="text-[10px] text-neutral-400 mt-0.5">
                {basisBps !== null ? `${basisBps > 0 ? '+' : ''}${basisBps.toFixed(1)} bps` : '--'}
              </div>
            </div>

            {/* 4. Global Long/Short Ratio */}
            <div className="bg-black/40 border border-white/5 rounded-lg p-2.5">
              <div className="text-[10px] text-neutral-400 uppercase">LONG / SHORT RATIO</div>
              <div className="text-sm sm:text-base font-bold text-[#FFD97A] mt-0.5">
                {longShortRatio !== null ? `${longShortRatio.toFixed(2)}x` : '--'}
              </div>
              <div className="text-[10px] mt-0.5 flex items-center justify-between">
                <span className="text-teal-400">
                  {longAccountPct !== null ? `${longAccountPct}% L` : '--'}
                </span>
                <span className="text-rose-400">
                  {shortAccountPct !== null ? `${shortAccountPct}% S` : '--'}
                </span>
              </div>
            </div>
          </div>

          {/* Liquidations in Last 5 Minutes from forceOrder */}
          <div className="mt-3.5 pt-3 border-t border-white/5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 font-mono text-xs">
              <div className="flex items-center gap-1.5 text-neutral-300">
                <Flame className="w-3.5 h-3.5 text-rose-400" />
                <span className="font-bold text-white uppercase text-[11px]">
                  5-MIN LIQUIDATIONS (LIVE FORCE ORDER STREAM)
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-white font-bold">
                  TOTAL: {formatUsdCompact(totalLiq5mUsd)}
                </span>
                <span className="text-rose-400">LONG: {formatUsdCompact(longLiq5mUsd)}</span>
                <span className="text-teal-400">SHORT: {formatUsdCompact(shortLiq5mUsd)}</span>
              </div>
            </div>

            {/* Recent Liquidations Scrollable List */}
            <div className="max-h-24 overflow-y-auto divide-y divide-white/[0.04] font-mono text-[11px] pr-1">
              {liquidations5m.length === 0 ? (
                <div className="py-2 text-center text-neutral-500 text-xs">
                  Zero force liquidations in the last 5 minutes · WebSocket listening...
                </div>
              ) : (
                liquidations5m.slice(0, 15).map((l) => {
                  const isLongLiq = l.side === 'SELL';
                  return (
                    <div
                      key={l.id}
                      className="flex items-center justify-between py-1 px-1 hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-neutral-500 text-[10px]">
                          {new Date(l.time).toTimeString().split(' ')[0]}
                        </span>
                        <span
                          className={`font-bold text-[10px] px-1 py-0.2 rounded ${
                            isLongLiq
                              ? 'bg-rose-950/60 text-rose-300 border border-rose-500/40'
                              : 'bg-teal-950/60 text-teal-300 border border-teal-500/40'
                          }`}
                        >
                          {isLongLiq ? 'LONG REKT' : 'SHORT REKT'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold">
                          ${l.price.toFixed(2)}
                        </span>
                        <span
                          className={`font-bold ${
                            isLongLiq ? 'text-rose-400' : 'text-teal-400'
                          }`}
                        >
                          {formatUsdCompact(l.usdValue)} ({l.qty.toFixed(3)}₿)
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

PerpPositioningCard.displayName = 'PerpPositioningCard';
