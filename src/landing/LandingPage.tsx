import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { initSmoothScroll, useScrollProgress } from './scrollTimeline';
import { WorldCanvas } from './scenes/WorldCanvas';
import { Navbar } from './ui/Navbar';
import { HeroOverlay } from './ui/HeroOverlay';
import { MarketOverlay } from './ui/MarketOverlay';
import { PrecisionOverlay } from './ui/PrecisionOverlay';
import { NewsRadarOverlay } from './ui/NewsRadarOverlay';
import { TelegramOverlay } from './ui/TelegramOverlay';
import { FinaleOverlay } from './ui/FinaleOverlay';
import { CustomCursor } from './ui/CustomCursor';
import { Preloader } from './ui/Preloader';
import { StickyPriceBar } from './ui/StickyPriceBar';
import { SideProgressRail } from './ui/SideProgressRail';
import { LiteModeToggle } from './ui/LiteModeToggle';
import { FpsDebugOverlay } from './ui/FpsDebugOverlay';

export const LandingPage: React.FC = () => {
  // Check if preloader was already seen during this session
  const [isLoaded, setIsLoaded] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        return sessionStorage.getItem('sarraf_preloader_seen') === 'true';
      } catch {
        return false;
      }
    }
    return false;
  });

  const [isCanvasReady, setIsCanvasReady] = useState(false);
  const [isLiteMode, setIsLiteMode] = useState(false);
  const [fps, setFps] = useState<number>(60);
  const [particleCount, setParticleCount] = useState<number>(1650);
  const [dpr, setDpr] = useState<number>(1);
  const { progress } = useScrollProgress();

  useEffect(() => {
    // Respect prefers-reduced-motion: default to Lite mode if active
    if (typeof window !== 'undefined') {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotion) {
        setIsLiteMode(true);
      }
    }

    const cleanup = initSmoothScroll();

    // Lazy load heavy 3D canvas after first paint so hero is immediately interactive
    const timer = setTimeout(() => {
      setIsCanvasReady(true);
    }, 120);

    return () => {
      cleanup();
      clearTimeout(timer);
    };
  }, []);

  const handleScrollTo = useCallback((sceneIndex: number) => {
    // 5 main scenes mapped along the 600vh scroll space
    const targetProgress = sceneIndex / 4;
    const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
    const targetY = targetProgress * totalHeight;

    window.scrollTo({
      top: targetY,
      behavior: 'smooth',
    });
  }, []);

  // Compute smooth opacity crossfades for each scene overlay with cubic-bezier-like curves
  const calcOpacity = (center: number, width: number) => {
    const dist = Math.abs(progress - center);
    if (dist > width) return 0;
    const raw = 1 - dist / width;
    // Smooth cosine bell
    return 0.5 - 0.5 * Math.cos(raw * Math.PI);
  };

  const heroOpacity = progress < 0.16 ? 1 - progress / 0.16 : 0;
  const marketOpacity = calcOpacity(0.28, 0.14);
  const precisionOpacity = calcOpacity(0.48, 0.13);
  const newsOpacity = calcOpacity(0.68, 0.13);
  const telegramOpacity = calcOpacity(0.83, 0.10);
  const finaleOpacity = progress > 0.88 ? Math.min(1, (progress - 0.88) / 0.08) : 0;

  // Gold light wipe / depth blur between scene transitions
  const sceneTransitionWipe = useMemo(() => {
    const boundaries = [0.18, 0.38, 0.58, 0.78, 0.88];
    for (const b of boundaries) {
      const diff = Math.abs(progress - b);
      if (diff < 0.035) {
        return Math.sin((1 - diff / 0.035) * Math.PI * 0.5) * 0.18;
      }
    }
    return 0;
  }, [progress]);

  return (
    <div className="relative bg-[#050505] text-white select-none overflow-x-hidden max-w-full w-full">
      {/* Preloader with Vault opening effect (first visit of session only, tap-to-skip) */}
      {!isLoaded && <Preloader onLoaded={() => setIsLoaded(true)} />}

      {/* Desktop Custom Glowing Cursor & Mobile Touch Gold Dust Trail */}
      <CustomCursor />

      {/* Optional FPS overlay at ?debug=1 (FPS, quality level, particle count, DPR) */}
      <FpsDebugOverlay
        fps={fps}
        isLiteMode={isLiteMode}
        particleCount={particleCount}
        dpr={dpr}
      />

      {/* Fixed Navigation Bar */}
      <Navbar onScrollTo={handleScrollTo} />

      {/* Sticky mini price bar after hero */}
      <StickyPriceBar progress={progress} />

      {/* Slim Side Progress Rail with Scene Names */}
      <SideProgressRail progress={progress} onScrollTo={handleScrollTo} />

      {/* Lite Mode Toggle with runtime FPS meter */}
      <LiteModeToggle
        isLiteMode={isLiteMode}
        onToggle={() => setIsLiteMode((prev) => !prev)}
        fps={fps}
      />

      {/* 3D World Canvas (lazily mounted after first paint for fast TTI) */}
      {isCanvasReady && (
        <WorldCanvas
          progress={progress}
          isLiteMode={isLiteMode}
          onFpsUpdate={setFps}
          onParticleCountUpdate={setParticleCount}
          onDprUpdate={setDpr}
        />
      )}

      {/* Cinematic Gold Light Wipe / Depth Blur Layer on Scene Change */}
      {sceneTransitionWipe > 0.005 && (
        <div
          className="fixed inset-0 pointer-events-none z-15 bg-radial from-[#FFD97A]/20 via-[#E8B84A]/10 to-transparent transition-opacity duration-200"
          style={{ opacity: sceneTransitionWipe }}
        />
      )}

      {/* Fixed Overlay Container for Text and Interactive Cards */}
      <div className="fixed inset-0 pointer-events-none z-10 overflow-hidden flex flex-col justify-center">
        <HeroOverlay
          opacity={heroOpacity}
          onWatchLive={() => handleScrollTo(1)}
        />
        <MarketOverlay opacity={marketOpacity} />
        <PrecisionOverlay opacity={precisionOpacity} />
        <NewsRadarOverlay opacity={newsOpacity} />
        <TelegramOverlay opacity={telegramOpacity} />
        <FinaleOverlay opacity={finaleOpacity} />
      </div>

      {/* Scrollable Document Spacer (6 scenes of 100vh each = 600vh total height) */}
      <div className="relative z-0 h-[600vh] w-full pointer-events-none" />

      {/* Subtle Film Grain Texture Overlay */}
      <div className="film-grain" />
    </div>
  );
};
