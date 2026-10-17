// src/atlas/components/AtlasIndicatorsSection.tsx
import React, { useMemo } from 'react';
import { AtlasIndicators } from '../atlasTypes';
import { AtlasCandle } from './AtlasCandleChart';
import { Activity, BarChart2, Layers } from 'lucide-react';

interface AtlasIndicatorsSectionProps {
  indicators: AtlasIndicators | null;
  h1Candles?: AtlasCandle[];
  livePrice: number;
}

export const AtlasIndicatorsSection: React.FC<AtlasIndicatorsSectionProps> = ({
  indicators,
  h1Candles = [],
  livePrice,
}) => {
  // Volume participation calculation
  const volumeData = useMemo(() => {
    if (!h1Candles || h1Candles.length === 0) return { bars: [], avg: 0 };
    const recent = h1Candles.slice(-20);
    const sum = recent.reduce((acc, c) => acc + (c.volume || 0), 0);
    const avg = sum / recent.length || 1;
    return { bars: recent, avg };
  }, [h1Candles]);

  // Participation status text
  const ratio = indicators?.participationRatio ?? (volumeData.bars.length > 0 ? (volumeData.bars[volumeData.bars.length - 1].volume / volumeData.avg) : 1);
  const partStatus =
    ratio > 1.2
      ? 'HIGH · EXPANSION'
      : ratio < 0.7
      ? 'LOW · COMPRESSION'
      : 'NORMAL · STEADY';

  // EMA Cluster dynamic text
  const ema50 = indicators?.ema50 || 0;
  const ema100 = indicators?.ema100 || 0;
  const ema200 = indicators?.ema200 || 0;

  const emaClusterStatus = useMemo(() => {
    if (livePrice <= 0 || !ema50 || !ema100) return 'NO DATA';
    if (livePrice > ema50 && ema50 > ema100) {
      return 'Price above EMA cluster (Bullish Alignment)';
    }
    if (livePrice < ema50 && ema50 < ema100) {
      return 'Price below EMA cluster (Bearish Alignment)';
    }
    return 'Price inside EMA cluster (Mixed / Compression)';
  }, [livePrice, ema50, ema100]);

  return (
    <div className="space-y-4 font-mono">
      {/* 6. VOLUME / PARTICIPATION BARS */}
      <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-white/10 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-[#FFD97A]" />
            <span className="text-xs font-bold text-white tracking-wider">
              VOLUME / PARTICIPATION BARS
            </span>
            <span className="text-[10px] text-neutral-400">
              (PARTICIPATION PROXY · TICK VOLUME)
            </span>
          </div>

          <div className="text-right">
            <span
              className={`text-[10px] font-extrabold px-2 py-0.5 rounded border ${
                ratio > 1.2
                  ? 'text-emerald-400 bg-emerald-950/60 border-emerald-800/40'
                  : ratio < 0.7
                  ? 'text-amber-400 bg-amber-950/60 border-amber-800/40'
                  : 'text-neutral-200 bg-black/60 border-white/10'
              }`}
            >
              {partStatus} ({ratio.toFixed(2)}x avg)
            </span>
          </div>
        </div>

        {/* Volume Bars SVG */}
        <div className="h-14 w-full flex items-end gap-1 pt-2 pb-1 px-1 bg-black/40 rounded-lg border border-white/5">
          {volumeData.bars.map((b, i) => {
            const maxVol = Math.max(...volumeData.bars.map((x) => x.volume), 1);
            const heightPct = Math.max(8, (b.volume / maxVol) * 100);
            const isLast = i === volumeData.bars.length - 1;
            const isBull = b.close >= b.open;

            return (
              <div
                key={i}
                className="flex-1 flex flex-col justify-end items-center h-full group relative cursor-pointer"
              >
                <div
                  style={{ height: `${heightPct}%` }}
                  className={`w-full rounded-t transition-all ${
                    isLast
                      ? 'bg-[#E8B84A] shadow-[0_0_8px_rgba(232,184,74,0.4)]'
                      : isBull
                      ? 'bg-emerald-500/50 hover:bg-emerald-400'
                      : 'bg-rose-500/50 hover:bg-rose-400'
                  }`}
                />
              </div>
            );
          })}
        </div>

        <div className="flex justify-between text-[10px] text-neutral-500">
          <span>20-BAR H1 ROLLING VOLUME</span>
          <span>AVG PARTICIPATION: {volumeData.avg.toFixed(0)} TICKS/H1</span>
        </div>
      </div>

      {/* Grid: 7. ATR(14) LINE & 8. TREND EMA CLUSTER */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 7. ATR(14) LINE WITH CURRENT VALUE */}
        <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-white/10 space-y-2">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#FFD97A]" />
              <span className="text-xs font-bold text-white tracking-wider">
                ATR (14, H1) EXPANSION
              </span>
            </div>
            <span className="text-[10px] text-neutral-400 uppercase">VOLATILITY RANGE</span>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div>
              <span className="text-[10px] text-neutral-400 block uppercase">CURRENT BAR ATR</span>
              <span className="text-xl font-extrabold text-[#FFD97A] tracking-wider">
                {indicators?.atr14 ? `${indicators.atr14.toFixed(2)} pts` : 'NO DATA'}
              </span>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-neutral-400 block uppercase">ZONE HALF-WIDTH</span>
              <span className="text-sm font-bold text-white">
                ±{indicators?.atr14 ? Math.max(2.0, Number((0.2 * indicators.atr14).toFixed(2))) : '2.00'} pts
              </span>
            </div>
          </div>

          <p className="text-[11px] text-neutral-400 leading-snug">
            Each daily pivot zone box expands by ±0.2×ATR(14, H1) to account for institutional liquidity wicks.
          </p>
        </div>

        {/* 8. TREND · EMA CLUSTER CHART (EMA 50/100/200) */}
        <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-white/10 space-y-2">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#FFD97A]" />
              <span className="text-xs font-bold text-white tracking-wider">
                TREND · EMA CLUSTER (H1)
              </span>
            </div>
          </div>

          {/* Dynamic Status Text */}
          <div className="p-2 rounded-lg bg-black/50 border border-white/10 flex items-center justify-between">
            <span className="text-xs font-bold text-white truncate">{emaClusterStatus}</span>
          </div>

          {/* 3 EMA badges */}
          <div className="grid grid-cols-3 gap-2 pt-1 text-center">
            <div className="p-2 rounded-lg bg-sky-950/30 border border-sky-800/40">
              <span className="text-[9px] text-sky-400 block font-bold">EMA 50</span>
              <span className="text-xs font-bold text-white">
                {ema50 ? `$${ema50.toFixed(2)}` : 'NO DATA'}
              </span>
            </div>
            <div className="p-2 rounded-lg bg-amber-950/30 border border-amber-800/40">
              <span className="text-[9px] text-amber-400 block font-bold">EMA 100</span>
              <span className="text-xs font-bold text-white">
                {ema100 ? `$${ema100.toFixed(2)}` : 'NO DATA'}
              </span>
            </div>
            <div className="p-2 rounded-lg bg-purple-950/30 border border-purple-800/40">
              <span className="text-[9px] text-purple-400 block font-bold">EMA 200</span>
              <span className="text-xs font-bold text-white">
                {ema200 ? `$${ema200.toFixed(2)}` : 'NO DATA'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
