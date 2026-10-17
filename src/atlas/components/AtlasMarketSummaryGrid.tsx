// src/atlas/components/AtlasMarketSummaryGrid.tsx
import React, { useMemo } from 'react';
import { AtlasState } from '../atlasTypes';
import { Compass, Zap, Target, BarChart2, Activity, ShieldAlert } from 'lucide-react';

interface AtlasMarketSummaryGridProps {
  state: AtlasState;
}

export const AtlasMarketSummaryGrid: React.FC<AtlasMarketSummaryGridProps> = ({ state }) => {
  const { bias, indicators, livePrice, zones, tradeState } = state;

  // Price Action calculation: AT SUPPLY / AT DEMAND / MID
  const priceActionStatus = useMemo(() => {
    if (livePrice <= 0 || !zones || zones.length === 0) return 'MID';
    if (tradeState.status === 'IN_ZONE' && tradeState.activeZone) {
      if (tradeState.activeZone.side === 'SELL') return 'AT SUPPLY';
      if (tradeState.activeZone.side === 'BUY') return 'AT DEMAND';
      return 'AT SARRAF ZONE';
    }
    for (const z of zones) {
      if (livePrice >= z.bottom && livePrice <= z.top) {
        if (z.side === 'SELL') return 'AT SUPPLY';
        if (z.side === 'BUY') return 'AT DEMAND';
        return 'AT SARRAF ZONE';
      }
    }
    return 'MID (BETWEEN ZONES)';
  }, [livePrice, zones, tradeState]);

  // Momentum determination
  const momentum = useMemo(() => {
    if (!indicators) return 'STABLE';
    if (livePrice > indicators.ema50 && indicators.ema50 > indicators.ema100) return 'BULLISH IMPULSE';
    if (livePrice < indicators.ema50 && indicators.ema50 < indicators.ema100) return 'BEARISH IMPULSE';
    return 'CONSOLIDATION';
  }, [livePrice, indicators]);

  // Volatility determination
  const volatility = useMemo(() => {
    if (!indicators?.atr14) return 'NORMAL';
    if (indicators.atr14 > 18) return `HIGH (${indicators.atr14.toFixed(1)}p)`;
    if (indicators.atr14 < 10) return `LOW (${indicators.atr14.toFixed(1)}p)`;
    return `NORMAL (${indicators.atr14.toFixed(1)}p)`;
  }, [indicators]);

  // Risk assessment
  const risk = useMemo(() => {
    if (priceActionStatus === 'AT SUPPLY' || priceActionStatus === 'AT DEMAND') {
      return { level: 'OPTIMAL', desc: 'Tight edge invalidation' };
    }
    if (priceActionStatus === 'MID (BETWEEN ZONES)') {
      return { level: 'MODERATE', desc: 'Wait for zone test' };
    }
    return { level: 'BALANCED', desc: 'Pivot equilibrium' };
  }, [priceActionStatus]);

  return (
    <div className="glass-panel p-3.5 sm:p-5 rounded-xl border border-white/10 space-y-3 font-mono">
      <div className="flex items-center justify-between pb-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#FFD97A]" />
          <h3 className="text-xs sm:text-sm font-bold text-white tracking-wider">
            12. MARKET SUMMARY MATRIX
          </h3>
        </div>
        <span className="text-[10px] text-neutral-400">REAL-TIME INSTITUTIONAL STATUS</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {/* 1. TREND */}
        <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-1">
          <div className="flex items-center gap-1.5 text-neutral-400 text-[10px] uppercase">
            <Compass className="w-3 h-3 text-[#FFD97A]" />
            <span>TREND</span>
          </div>
          <div
            className={`text-xs font-extrabold ${
              bias?.overall === 'BULLISH'
                ? 'text-emerald-400'
                : bias?.overall === 'BEARISH'
                ? 'text-rose-400'
                : 'text-[#FFD97A]'
            }`}
          >
            {bias?.overall || 'NO DATA'}
          </div>
          <div className="text-[9px] text-neutral-500">
            Score: {bias?.score !== undefined ? (bias.score > 0 ? `+${bias.score}` : bias.score) : '--'}
          </div>
        </div>

        {/* 2. MOMENTUM */}
        <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-1">
          <div className="flex items-center gap-1.5 text-neutral-400 text-[10px] uppercase">
            <Activity className="w-3 h-3 text-sky-400" />
            <span>MOMENTUM</span>
          </div>
          <div className="text-xs font-extrabold text-white">{momentum}</div>
          <div className="text-[9px] text-neutral-500">EMA Alignment</div>
        </div>

        {/* 3. PRICE ACTION */}
        <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-1">
          <div className="flex items-center gap-1.5 text-neutral-400 text-[10px] uppercase">
            <Target className="w-3 h-3 text-amber-400" />
            <span>PRICE ACTION</span>
          </div>
          <div
            className={`text-xs font-extrabold ${
              priceActionStatus === 'AT SUPPLY'
                ? 'text-rose-400'
                : priceActionStatus === 'AT DEMAND'
                ? 'text-emerald-400'
                : 'text-[#FFD97A]'
            }`}
          >
            {priceActionStatus}
          </div>
          <div className="text-[9px] text-neutral-500">Structural Location</div>
        </div>

        {/* 4. VOLUME */}
        <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-1">
          <div className="flex items-center gap-1.5 text-neutral-400 text-[10px] uppercase">
            <BarChart2 className="w-3 h-3 text-emerald-400" />
            <span>VOLUME</span>
          </div>
          <div className="text-xs font-extrabold text-white">
            {indicators?.participationStatus || 'NORMAL'}
          </div>
          <div className="text-[9px] text-neutral-500">
            {indicators?.participationRatio ? `${indicators.participationRatio.toFixed(2)}x avg` : 'proxy'}
          </div>
        </div>

        {/* 5. VOLATILITY */}
        <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-1">
          <div className="flex items-center gap-1.5 text-neutral-400 text-[10px] uppercase">
            <Activity className="w-3 h-3 text-purple-400" />
            <span>VOLATILITY</span>
          </div>
          <div className="text-xs font-extrabold text-white">{volatility}</div>
          <div className="text-[9px] text-neutral-500">ATR(14, H1)</div>
        </div>

        {/* 6. RISK */}
        <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 space-y-1">
          <div className="flex items-center gap-1.5 text-neutral-400 text-[10px] uppercase">
            <ShieldAlert className="w-3 h-3 text-rose-400" />
            <span>RISK</span>
          </div>
          <div
            className={`text-xs font-extrabold ${
              risk.level === 'OPTIMAL' ? 'text-emerald-400' : 'text-[#FFD97A]'
            }`}
          >
            {risk.level}
          </div>
          <div className="text-[9px] text-neutral-500 truncate">{risk.desc}</div>
        </div>
      </div>
    </div>
  );
};
