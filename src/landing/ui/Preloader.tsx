import React, { useEffect, useState, useCallback, useRef } from 'react';

interface PreloaderProps {
  onLoaded: () => void;
}

export const Preloader: React.FC<PreloaderProps> = ({ onLoaded }) => {
  const [progress, setProgress] = useState(0);
  const [isSplitting, setIsSplitting] = useState(false);
  const hasFinishedRef = useRef(false);

  const finishLoading = useCallback(() => {
    if (hasFinishedRef.current) return;
    hasFinishedRef.current = true;
    setIsSplitting(true);
    setTimeout(() => {
      onLoaded();
    }, 700); // Wait for vault door split animation
  }, [onLoaded]);

  useEffect(() => {
    const startTime = Date.now();
    const MAX_DURATION_MS = 2200; // max 2.5s requirement

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / MAX_DURATION_MS) * 100));

      setProgress(pct);

      if (pct >= 100) {
        clearInterval(interval);
        finishLoading();
      }
    }, 35);

    // Hard ceiling timeout
    const maxTimeout = setTimeout(() => {
      finishLoading();
    }, 2500);

    return () => {
      clearInterval(interval);
      clearTimeout(maxTimeout);
    };
  }, [finishLoading]);

  // Skippable by tap / click
  const handleSkip = () => {
    finishLoading();
  };

  return (
    <div
      onClick={handleSkip}
      className="fixed inset-0 z-50 flex items-center justify-center cursor-pointer select-none overflow-hidden"
    >
      {/* Left Vault Half */}
      <div
        className={`absolute top-0 bottom-0 left-0 w-1/2 bg-[#050505] border-r border-[#E8B84A]/30 transition-transform duration-700 ease-[cubic-bezier(0.77,0,0.175,1)] z-10 flex items-center justify-end ${
          isSplitting ? '-translate-x-full' : 'translate-x-0'
        }`}
      >
        <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-transparent via-[#FFD97A] to-transparent shadow-[0_0_20px_#E8B84A]" />
      </div>

      {/* Right Vault Half */}
      <div
        className={`absolute top-0 bottom-0 right-0 w-1/2 bg-[#050505] border-l border-[#E8B84A]/30 transition-transform duration-700 ease-[cubic-bezier(0.77,0,0.175,1)] z-10 flex items-center justify-start ${
          isSplitting ? 'translate-x-full' : 'translate-x-0'
        }`}
      >
        <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-transparent via-[#FFD97A] to-transparent shadow-[0_0_20px_#E8B84A]" />
      </div>

      {/* Center Preloader Brand & Drawing Gold Line */}
      <div
        className={`relative z-20 flex flex-col items-center max-w-xs w-full px-6 transition-opacity duration-300 ${
          isSplitting ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
        }`}
      >
        {/* Animated Diamond Logo with drawing stroke */}
        <div className="relative w-14 h-14 mb-6 flex items-center justify-center">
          <svg className="w-14 h-14" viewBox="0 0 60 60">
            {/* Background faint path */}
            <polygon
              points="30,6 54,30 30,54 6,30"
              fill="none"
              stroke="#332810"
              strokeWidth="1.5"
            />
            {/* Animated drawing gold path */}
            <polygon
              points="30,6 54,30 30,54 6,30"
              fill="none"
              stroke="#FFD97A"
              strokeWidth="2"
              strokeDasharray="140"
              strokeDashoffset={140 - (progress / 100) * 140}
              className="drop-shadow-[0_0_10px_#E8B84A]"
            />
          </svg>
          <span className="absolute font-mono text-xs font-bold text-[#FFD97A]">S</span>
        </div>

        {/* Brand Name Typography */}
        <div className="flex items-center gap-2 mb-4">
          <span className="font-mono text-sm tracking-[0.35em] font-bold text-white">
            SARRAF
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#E8B84A] animate-pulse" />
          <span className="font-mono text-[10px] tracking-widest text-[#E8B84A]/80">
            VAULT
          </span>
        </div>

        {/* Gold progress line drawing horizontally */}
        <div className="relative w-full h-[1.5px] bg-white/10 rounded-full overflow-hidden">
          <div
            className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-[#B88628] via-[#FFD97A] to-[#E8B84A] transition-all duration-100 ease-out shadow-[0_0_12px_#E8B84A]"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Progress readout & tap to skip */}
        <div className="w-full mt-3 flex justify-between items-center text-[10px] font-mono text-neutral-400">
          <span className="tracking-widest">INITIALIZING REPOSITORY</span>
          <span className="text-[#FFD97A] font-bold">{progress}%</span>
        </div>

        <span className="mt-4 text-[9px] font-mono tracking-widest text-neutral-400 uppercase">
          TAP ANYWHERE TO SKIP
        </span>
      </div>
    </div>
  );
};
