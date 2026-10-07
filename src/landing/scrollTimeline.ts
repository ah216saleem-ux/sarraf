import { useEffect, useState } from 'react';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export interface ScrollState {
  progress: number; // 0 to 1
  sceneIndex: number; // 0 to 5
  sceneProgress: number; // 0 to 1 within the current scene
  velocity: number;
}

// Global observable scroll state for high frequency Three.js animation frames
export const globalScrollState = {
  progress: 0,
  velocity: 0,
  pointer: { x: 0, y: 0, targetX: 0, targetY: 0 },
};

let lenisInstance: Lenis | null = null;

export function initSmoothScroll(): () => void {
  if (typeof window === 'undefined') return () => {};

  // Check prefers-reduced-motion
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const lenis = new Lenis({
    lerp: prefersReducedMotion ? 0.9 : 0.07,
    smoothWheel: !prefersReducedMotion,
    wheelMultiplier: 0.9,
    touchMultiplier: 1.2,
  });

  lenisInstance = lenis;

  lenis.on('scroll', (e: { progress: number; velocity: number }) => {
    globalScrollState.progress = e.progress;
    globalScrollState.velocity = e.velocity;
    ScrollTrigger.update();
  });

  const tickerCallback = (time: number) => {
    lenis.raf(time * 1000);
  };

  gsap.ticker.add(tickerCallback);
  gsap.ticker.lagSmoothing(0);

  // Mouse & Touch parallax tracking
  const handlePointerMove = (e: MouseEvent | TouchEvent) => {
    let clientX = 0;
    let clientY = 0;

    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = (e as MouseEvent).clientX;
      clientY = (e as MouseEvent).clientY;
    }

    const normX = (clientX / window.innerWidth) * 2 - 1;
    const normY = -(clientY / window.innerHeight) * 2 + 1;

    globalScrollState.pointer.targetX = normX;
    globalScrollState.pointer.targetY = normY;
  };

  window.addEventListener('mousemove', handlePointerMove, { passive: true });
  window.addEventListener('touchmove', handlePointerMove, { passive: true });

  return () => {
    gsap.ticker.remove(tickerCallback);
    lenis.destroy();
    lenisInstance = null;
    window.removeEventListener('mousemove', handlePointerMove);
    window.removeEventListener('touchmove', handlePointerMove);
  };
}

export function getLenis() {
  return lenisInstance;
}

export function useScrollProgress(): ScrollState {
  const [scrollState, setScrollState] = useState<ScrollState>({
    progress: 0,
    sceneIndex: 0,
    sceneProgress: 0,
    velocity: 0,
  });

  useEffect(() => {
    const handleScroll = () => {
      const totalScroll = document.documentElement.scrollHeight - window.innerHeight;
      const currentScroll = window.scrollY || window.pageYOffset;
      const progress = totalScroll > 0 ? Math.min(Math.max(currentScroll / totalScroll, 0), 1) : 0;

      // 6 scenes (0 to 5)
      const sceneFloat = progress * 5;
      const sceneIndex = Math.min(Math.floor(sceneFloat), 5);
      const sceneProgress = sceneIndex === 5 ? 1 : sceneFloat - sceneIndex;

      setScrollState({
        progress,
        sceneIndex,
        sceneProgress,
        velocity: globalScrollState.velocity,
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return scrollState;
}
