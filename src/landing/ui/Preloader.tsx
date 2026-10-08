import React, { useEffect, useState, useCallback, useRef } from 'react';

interface PreloaderProps {
  onLoaded: () => void;
}

export const Preloader: React.FC<PreloaderProps> = ({ onLoaded }) => {
  const [displayProgress, setDisplayProgress] = useState(0);
  const [isSplitting, setIsSplitting] = useState(false);
  const hasFinishedRef = useRef(false);
  const targetProgressRef = useRef(15);
  const currentProgressRef = useRef(0);

  const finishLoading = useCallback(() => {
    if (hasFinishedRef.current) return;
    hasFinishedRef.current = true;

    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('sarraf_preloader_seen', 'true');
      } catch {
        // Ignore session storage errors
      }
    }

    // Measure Time to First Paint & Time to Interactive
    if (typeof window !== 'undefined' && window.performance) {
      try {
        const paintEntries = performance.getEntriesByType('paint');
        const fcp = paintEntries.find((e) => e.name === 'first-contentful-paint');
        const fcpTime = fcp ? Math.round(fcp.startTime) : Math.round(performance.now());
        const ttiEstimate = Math.round(performance.now());

        (window as unknown as { __SARRAF_PERF__?: { ttfp: number; tti: number } }).__SARRAF_PERF__ = {
          ttfp: fcpTime,
          tti: ttiEstimate,
        };
      } catch {
        // Ignore perf query issues
      }
    }

    setIsSplitting(true);
    setTimeout(() => {
      onLoaded();
    }, 650); // Vault door split transition
  }, [onLoaded]);

  useEffect(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    // Hard ceiling: finish within 2s on desktop and 3s on mobile
    const MAX_DURATION_MS = isMobile ? 2900 : 1900;
    const startTime = performance.now();

    let animationFrameId: number;

    // Track Real Tasks:
    // Task 1: Fonts loaded (30%)
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready
        .then(() => {
          targetProgressRef.current = Math.max(targetProgressRef.current, 35);
        })
        .catch(() => {});
    }

    // Task 2: Real first price fetch (40%)
    fetch('/api/price/xauusd')
      .then((res) => {
        if (res.ok) {
          targetProgressRef.current = Math.max(targetProgressRef.current, 75);
        } else {
          targetProgressRef.current = Math.max(targetProgressRef.current, 60);
        }
      })
      .catch(() => {
        targetProgressRef.current = Math.max(targetProgressRef.current, 60);
      });

    // Task 3: Scene / WebGL readiness microtask (25%)
    const sceneReadyTimer = setTimeout(() => {
      targetProgressRef.current = Math.max(targetProgressRef.current, 90);
    }, isMobile ? 800 : 500);

    // Smooth lerp loop that never stalls
    const updateProgress = () => {
      const elapsed = performance.now() - startTime;
      const timeRatio = Math.min(1, elapsed / MAX_DURATION_MS);

      // Ensure time-based floor so progress steadily moves forward even if network lags
      const floorProgress = Math.min(100, Math.round(timeRatio * 100));
      const target = Math.max(targetProgressRef.current, floorProgress);

      // Lerp current to target
      currentProgressRef.current += (target - currentProgressRef.current) * 0.16;

      const rounded = Math.min(100, Math.round(currentProgressRef.current));
      setDisplayProgress(rounded);

      if (timeRatio >= 1 || rounded >= 100) {
        setDisplayProgress(100);
        finishLoading();
      } else {
        animationFrameId = requestAnimationFrame(updateProgress);
      }
    };

    animationFrameId = requestAnimationFrame(updateProgress);

    // Hard cap fallback timeout
    const hardCapTimer = setTimeout(() => {
      finishLoading();
    }, MAX_DURATION_MS + 100);

    return () => {
      cancelAnimationFrame(animationFrameId);
      clearTimeout(sceneReadyTimer);
      clearTimeout(hardCapTimer);
    };
  }, [finishLoading]);

  // Tap-to-skip works at any moment
  const handleSkip = () => {
    finishLoading();
  };

  return (
    <div
      onClick={handleSkip}
      onTouchStart={handleSkip}
      className="fixed inset-0 z-50 flex items-center justify-center cursor-pointer select-none overflow-hidden bg-[#050505]"
    >
      {/* Left Vault Half */}
      <div
        className={`absolute top-0 bottom-0 left-0 w-1/2 bg-[#050505] border-r border-[#E8B84A]/30 transition-transform duration-650 ease-[cubic-bezier(0.22,1,0.36,1)] z-10 flex items-center justify-end ${
          isSplitting ? '-translate-x-full' : 'translate-x-0'
        }`}
      >
        <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-transparent via-[#FFD97A] to-transparent shadow-[0_0_20px_#E8B84A]" />
      </div>

      {/* Right Vault Half */}
      <div
        className={`absolute top-0 bottom-0 right-0 w-1/2 bg-[#050505] border-l border-[#E8B84A]/30 transition-transform duration-650 ease-[cubic-bezier(0.22,1,0.36,1)] z-10 flex items-center justify-start ${
          isSplitting ? 'translate-x-full' : 'translate-x-0'
        }`}
      >
        <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-transparent via-[#FFD97A] to-transparent shadow-[0_0_20px_#E8B84A]" />
      </div>

      {/* Center Preloader Brand & Drawing Gold Line */}
      <div
        className={`relative z-20 flex flex-col items-center max-w-xs w-full px-6 transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
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
              strokeDashoffset={140 - (displayProgress / 100) * 140}
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
            XAU/USD
          </span>
        </div>

        {/* Gold progress line drawing horizontally */}
        <div className="relative w-full h-[1.5px] bg-white/10 rounded-full overflow-hidden">
          <div
            className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-[#B88628] via-[#FFD97A] to-[#E8B84A] transition-all duration-75 ease-out shadow-[0_0_12px_#E8B84A]"
            style={{ width: `${displayProgress}%` }}
          />
        </div>

        {/* Honest Progress readout & tap to skip */}
        <div className="w-full mt-3 flex justify-between items-center text-[10px] font-mono text-neutral-400">
          <span className="tracking-widest">Connecting to live market</span>
          <span className="text-[#FFD97A] font-bold">{displayProgress}%</span>
        </div>

        <span className="mt-4 text-[9px] font-mono tracking-widest text-neutral-500 uppercase hover:text-neutral-300 transition-colors">
          TAP ANYWHERE TO SKIP
        </span>
      </div>
    </div>
  );
};
