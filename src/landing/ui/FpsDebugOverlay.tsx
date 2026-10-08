import React, { useEffect, useState } from 'react';

interface FpsDebugOverlayProps {
  fps: number;
  isLiteMode: boolean;
  particleCount?: number;
  dpr?: number;
}

export const FpsDebugOverlay: React.FC<FpsDebugOverlayProps> = ({
  fps,
  isLiteMode,
  particleCount = 1650,
  dpr = 1,
}) => {
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('debug') === '1') {
        setShowDebug(true);
      }
    }
  }, []);

  if (!showDebug) return null;

  const quality = isLiteMode
    ? 'LITE MODE'
    : fps >= 55
    ? 'HIGH (Bloom ON)'
    : fps >= 45
    ? 'BALANCED (Adaptive)'
    : 'POWER-SAVING (Bloom OFF)';

  const fpsColor =
    fps >= 55
      ? 'text-emerald-400'
      : fps >= 45
      ? 'text-amber-400'
      : 'text-rose-400';

  return (
    <aside
      aria-label="Developer Telemetry"
      className="fixed top-16 left-3 sm:left-6 z-50 p-2.5 sm:p-3 rounded-xl bg-black/85 backdrop-blur-md border border-[#E8B84A]/40 font-mono text-[11px] shadow-[0_4px_20px_rgba(0,0,0,0.8)] pointer-events-auto select-none max-w-[220px]"
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-1.5 mb-1.5 text-[9px] uppercase tracking-widest text-[#FFD97A]">
        <span>SARRAF ENGINE</span>
        <span className="text-[8px] px-1 py-0.2 rounded bg-[#E8B84A]/20 text-[#FFD97A]">?debug=1</span>
      </div>

      <div className="space-y-1 text-neutral-300">
        <div className="flex justify-between items-center">
          <span className="text-neutral-500">FPS:</span>
          <span className={`font-bold text-xs ${fpsColor}`}>{fps} FPS</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-neutral-500">QUALITY:</span>
          <span className="text-white text-[10px] font-semibold">{quality}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-neutral-500">PARTICLES:</span>
          <span className="text-[#FFD97A]">{isLiteMode ? 0 : particleCount}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-neutral-500">DPR:</span>
          <span className="text-neutral-300">{dpr.toFixed(1)}x</span>
        </div>
      </div>
    </aside>
  );
};
