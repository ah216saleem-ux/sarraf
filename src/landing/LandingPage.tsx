import React, { useEffect, useState, useCallback } from 'react';
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

export const LandingPage: React.FC = () => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLiteMode, setIsLiteMode] = useState(false);
  const [fps, setFps] = useState<number>(60);
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
    return cleanup;
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

  // Compute smooth opacity crossfades for each scene overlay
  const calcOpacity = (center: number, width: number) => {
    const dist = Math.abs(progress - center);
    if (dist > width) return 0;
    return Math.max(0, 1 - dist / width);
  };

  const heroOpacity = progress < 0.16 ? 1 - progress / 0.16 : 0;
  const marketOpacity = calcOpacity(0.28, 0.14);
  const precisionOpacity = calcOpacity(0.48, 0.13);
  const newsOpacity = calcOpacity(0.68, 0.13);
  const telegramOpacity = calcOpacity(0.83, 0.10);
  const finaleOpacity = progress > 0.88 ? Math.min(1, (progress - 0.88) / 0.08) : 0;

  return (
    <div className="relative bg-[#050505] text-white select-none overflow-x-hidden max-w-full w-full">
      {/* Preloader with Vault opening effect (max 2.5s, tap to skip) */}
      {!isLoaded && <Preloader onLoaded={() => setIsLoaded(true)} />}

      {/* Desktop Custom Glowing Cursor */}
      <CustomCursor />

      {/* Fixed Navigation Bar */}
      <Navbar onScrollTo={handleScrollTo} />

      {/* Sticky mini price bar after hero (A1/B6 requirement) */}
      <StickyPriceBar progress={progress} />

      {/* Slim Side Progress Rail with Scene Names (B3 requirement) */}
      <SideProgressRail progress={progress} onScrollTo={handleScrollTo} />

      {/* Lite Mode Toggle with runtime FPS meter (Performance & Accessibility requirement) */}
      <LiteModeToggle
        isLiteMode={isLiteMode}
        onToggle={() => setIsLiteMode((prev) => !prev)}
        fps={fps}
      />

      {/* 3D World Canvas (Fixed full-screen behind the HTML overlays) */}
      <WorldCanvas
        progress={progress}
        isLiteMode={isLiteMode}
        onFpsUpdate={setFps}
      />

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
