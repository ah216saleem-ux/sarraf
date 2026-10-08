import React from 'react';
import { useMarket } from '../../context/MarketContext';
import { Zap, Activity, Clock } from 'lucide-react';
import { SessionStrip } from './SessionStrip';

interface MarketOverlayProps {
  opacity: number;
}

export const MarketOverlay: React.FC<MarketOverlayProps> = ({ opacity }) => {
  const { priceData } = useMarket();

  if (opacity <= 0.01) return null;

  return (
    <div
      className="min-h-screen w-full flex flex-col justify-center px-4 sm:px-8 py-16 pointer-events-auto overflow-x-hidden transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{ opacity }}
    >
      <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-12 items-center my-auto">
        {/* Left Side: Bold Editorial Typography */}
        <div className="lg:col-span-6 space-y-4 sm:space-y-6">
          <div className="flex items-center gap-3 text-xs font-mono tracking-[0.25em] text-[#FFD97A]/80 uppercase">
            <span className="w-6 h-[1px] bg-[#E8B84A]" />
            <span>LIVE XAU/USD DYNAMICS</span>
          </div>

          <h2 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight text-white leading-tight">
            Every second.{' '}
            <span className="font-serif italic text-[#FFD97A] gold-glow-text">
              Every tick.
            </span>
          </h2>

          <p className="text-sm sm:text-base text-neutral-300 font-light leading-relaxed max-w-lg">
            Gold trades continuously across global market hours. Track live XAU/USD movements with streaming price updates, real-time spread tracking, and active session timing.
          </p>

          {/* Real Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
            <div className="p-3.5 sm:p-4 rounded-xl flex flex-col bg-[#09090d]/85 border border-white/10 backdrop-blur-md">
              <div className="flex items-center justify-between text-neutral-400 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider">TICK PULSE</span>
                <Zap className="w-3.5 h-3.5 text-[#FFD97A]" />
              </div>
              <span className="text-lg sm:text-xl font-mono font-bold text-white">
                {priceData.tickPulse * 2 + 120}
              </span>
              <span className="text-[9px] font-mono text-[#E8B84A] mt-0.5">TICKS / MINUTE</span>
            </div>

            <div className="p-3.5 sm:p-4 rounded-xl flex flex-col bg-[#09090d]/85 border border-white/10 backdrop-blur-md">
              <div className="flex items-center justify-between text-neutral-400 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider">STATUS</span>
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <span className="text-lg sm:text-xl font-mono font-bold text-emerald-400">
                {priceData.status === 'LIVE' ? 'ACTIVE' : 'STANDBY'}
              </span>
              <span className="text-[9px] font-mono text-neutral-400 mt-0.5">MARKET STREAM</span>
            </div>

            <div className="p-3.5 sm:p-4 rounded-xl flex flex-col col-span-2 sm:col-span-1 bg-[#09090d]/85 border border-white/10 backdrop-blur-md">
              <div className="flex items-center justify-between text-neutral-400 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider">ASSET</span>
                <Clock className="w-3.5 h-3.5 text-[#E8B84A]" />
              </div>
              <span className="text-lg sm:text-xl font-mono font-bold text-white">
                SPOT GOLD
              </span>
              <span className="text-[9px] font-mono text-[#E8B84A] mt-0.5">XAU/USD TROY OZ</span>
            </div>
          </div>
        </div>

        {/* Right Side: Market composition glass panel */}
        <div className="lg:col-span-6 flex flex-col items-center lg:items-end w-full">
          <div className="rounded-2xl p-5 sm:p-6 border border-[#E8B84A]/30 max-w-sm w-full backdrop-blur-xl bg-[#08080a]/90 shadow-[0_0_30px_rgba(0,0,0,0.8)]">
            <div className="flex items-center justify-between text-[11px] font-mono text-[#FFD97A] border-b border-white/10 pb-3">
              <span className="tracking-widest font-bold">MARKET SPECIFICATION</span>
              <span className="text-emerald-400 font-semibold">LIVE FEED</span>
            </div>
            <div className="space-y-3 pt-3 font-mono text-xs">
              <div className="flex justify-between items-center text-neutral-300">
                <span>Contract Type</span>
                <span className="font-semibold text-white">Spot Gold (XAU/USD)</span>
              </div>
              <div className="flex justify-between items-center text-neutral-300">
                <span>Active Sessions</span>
                <span className="font-semibold text-white">Asian · London · New York</span>
              </div>
              <div className="flex justify-between items-center text-neutral-300">
                <span>Spread Indicator</span>
                <span className="font-semibold text-emerald-400">
                  {priceData.spread !== null ? `${priceData.spread.toFixed(2)} pips` : '0.30 pips'}
                </span>
              </div>
              <div className="flex justify-between items-center text-neutral-300">
                <span>Signal Cadence</span>
                <span className="font-semibold text-[#FFD97A]">One Signal At A Time</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Global Session Strip */}
      <div className="mt-4">
        <SessionStrip />
      </div>
    </div>
  );
};
