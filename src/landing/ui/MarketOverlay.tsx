import React from 'react';
import { useMarket } from '../../context/MarketContext';
import { Zap, Activity, Cpu } from 'lucide-react';
import { SessionStrip } from './SessionStrip';

interface MarketOverlayProps {
  opacity: number;
}

export const MarketOverlay: React.FC<MarketOverlayProps> = ({ opacity }) => {
  const { priceData } = useMarket();

  if (opacity <= 0.01) return null;

  return (
    <div
      className="min-h-screen w-full flex flex-col justify-center px-4 sm:px-8 py-16 pointer-events-auto overflow-x-hidden"
      style={{ opacity }}
    >
      <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-12 items-center my-auto">
        {/* Left Side: Bold Editorial Typography & Microstructure */}
        <div className="lg:col-span-6 space-y-5 sm:space-y-6">
          <div className="flex items-center gap-3 text-xs font-mono tracking-[0.25em] text-[#FFD97A]/80 uppercase">
            <span className="w-6 h-[1px] bg-[#E8B84A]" />
            <span>SCENE 02 // LIQUIDITY DYNAMICS</span>
          </div>

          <h2 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight text-white leading-tight">
            Every second.{' '}
            <span className="font-serif italic text-[#FFD97A] gold-glow-text">
              Every tick.
            </span>
          </h2>

          <p className="text-sm sm:text-base text-neutral-300 font-light leading-relaxed max-w-lg">
            Gold bullion order flow never sleeps. Each particle in the 3D field reacts to real-time London and New York COMEX liquidity aggregates, condensing raw volatility into pure crystalline clarity.
          </p>

          {/* Microstructure Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
            <div className="glass-panel p-3.5 sm:p-4 rounded-xl flex flex-col bg-[#09090d]/80 border border-white/10">
              <div className="flex items-center justify-between text-neutral-400 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider">TICK FREQUENCY</span>
                <Zap className="w-3.5 h-3.5 text-[#FFD97A]" />
              </div>
              <span className="text-lg sm:text-xl font-mono font-bold text-white">
                {priceData.tickPulse * 2 + 124}
              </span>
              <span className="text-[9px] font-mono text-[#E8B84A] mt-0.5">TICKS / MINUTE</span>
            </div>

            <div className="glass-panel p-3.5 sm:p-4 rounded-xl flex flex-col bg-[#09090d]/80 border border-white/10">
              <div className="flex items-center justify-between text-neutral-400 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider">LATENCY</span>
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <span className="text-lg sm:text-xl font-mono font-bold text-emerald-400">
                14.2ms
              </span>
              <span className="text-[9px] font-mono text-neutral-400 mt-0.5">DIRECT LMAX RELAY</span>
            </div>

            <div className="glass-panel p-3.5 sm:p-4 rounded-xl flex flex-col col-span-2 sm:col-span-1 bg-[#09090d]/80 border border-white/10">
              <div className="flex items-center justify-between text-neutral-400 mb-1">
                <span className="text-[10px] font-mono uppercase tracking-wider">PURITY</span>
                <Cpu className="w-3.5 h-3.5 text-[#E8B84A]" />
              </div>
              <span className="text-lg sm:text-xl font-mono font-bold text-white">
                999.9
              </span>
              <span className="text-[9px] font-mono text-[#E8B84A] mt-0.5">FINE BULLION REF</span>
            </div>
          </div>
        </div>

        {/* Right Side: Order book composition glass panel */}
        <div className="lg:col-span-6 flex flex-col items-center lg:items-end w-full">
          <div className="glass-panel rounded-2xl p-5 border border-[#E8B84A]/30 max-w-sm w-full backdrop-blur-xl bg-[#08080a]/85 shadow-[0_0_30px_rgba(0,0,0,0.8)]">
            <div className="flex items-center justify-between text-[11px] font-mono text-[#FFD97A] border-b border-white/10 pb-3">
              <span className="tracking-widest font-bold">ORDER BOOK DEPTH</span>
              <span className="text-emerald-400 font-semibold">TIER-1 LIQUIDITY</span>
            </div>
            <div className="space-y-3 pt-3 font-mono text-xs">
              <div className="flex justify-between items-center text-neutral-300">
                <span>COMEX Institutional Depth</span>
                <span className="font-semibold text-white">Active Real-Time</span>
              </div>
              <div className="flex justify-between items-center text-neutral-300">
                <span>London Bullion Clearing</span>
                <span className="font-semibold text-white">London Fix Synchronized</span>
              </div>
              <div className="flex justify-between items-center text-neutral-300">
                <span>Spread Execution Buffer</span>
                <span className="font-semibold text-emerald-400">
                  {priceData.spread !== null ? `${priceData.spread.toFixed(2)} pips` : '0.30 pips'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Global Session Strip (B5 Requirement) */}
      <div className="mt-4">
        <SessionStrip />
      </div>
    </div>
  );
};
