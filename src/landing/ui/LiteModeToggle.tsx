import React from 'react';
import { Gauge, Sparkles } from 'lucide-react';

interface LiteModeToggleProps {
  isLiteMode: boolean;
  onToggle: () => void;
  fps?: number;
}

export const LiteModeToggle: React.FC<LiteModeToggleProps> = ({
  isLiteMode,
  onToggle,
  fps,
}) => {
  return (
    <div className="fixed bottom-4 left-4 z-40 hidden sm:flex items-center gap-2">
      <button
        onClick={onToggle}
        className={`group flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-mono tracking-wider transition-all duration-300 backdrop-blur-md cursor-pointer ${
          isLiteMode
            ? 'bg-amber-950/60 border-amber-500/40 text-amber-300'
            : 'bg-black/60 border-white/10 hover:border-[#E8B84A]/40 text-neutral-400 hover:text-white'
        }`}
        title={isLiteMode ? 'Switch to Full 3D Cinematic Mode' : 'Switch to Lightweight Performance Mode'}
      >
        {isLiteMode ? (
          <Gauge className="w-3 h-3 text-amber-400" />
        ) : (
          <Sparkles className="w-3 h-3 text-[#FFD97A]" />
        )}
        <span>{isLiteMode ? 'LITE MODE: ON' : '3D MODE'}</span>
        {typeof fps === 'number' && fps > 0 && !isLiteMode && (
          <span className="text-[9px] text-[#E8B84A]/70 border-l border-white/10 pl-1.5">
            {fps} FPS
          </span>
        )}
      </button>
    </div>
  );
};
