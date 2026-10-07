import React, { Suspense, useState, useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { WorldCamera } from './WorldCamera';
import { HeroVaultSlit } from './HeroVaultSlit';
import { AuroraRibbons } from './AuroraRibbons';
import { GoldBarAssembly } from './GoldBarAssembly';
import { PrecisionNodes } from './PrecisionNodes';
import { NewsRadarGlobe } from './NewsRadarGlobe';
import { TelegramLightPlane } from './TelegramLightPlane';
import { VaultFinaleDoor } from './VaultFinaleDoor';
import { AmbientDust } from './AmbientDust';

interface WorldCanvasProps {
  progress: number;
  isLiteMode?: boolean;
  onFpsUpdate?: (fps: number) => void;
}

// Inner FPS monitor component running inside Canvas frame loop
function FpsTracker({
  onLowFpsDetected,
  onFpsUpdate,
}: {
  onLowFpsDetected: () => void;
  onFpsUpdate?: (fps: number) => void;
}) {
  const frameCount = useRef(0);
  const lastTime = useRef(performance.now());
  const lowFpsCount = useRef(0);

  useFrame(() => {
    frameCount.current += 1;
    const now = performance.now();
    const delta = now - lastTime.current;

    if (delta >= 1000) {
      const currentFps = Math.round((frameCount.current * 1000) / delta);
      onFpsUpdate?.(currentFps);

      if (currentFps < 45) {
        lowFpsCount.current += 1;
        if (lowFpsCount.current >= 2) {
          // 2 consecutive seconds below 45 FPS -> degrade quality
          onLowFpsDetected();
        }
      } else {
        lowFpsCount.current = 0;
      }

      frameCount.current = 0;
      lastTime.current = now;
    }
  });

  return null;
}

export const WorldCanvas: React.FC<WorldCanvasProps> = ({
  progress,
  isLiteMode = false,
  onFpsUpdate,
}) => {
  const [dpr, setDpr] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const [enableBloom, setEnableBloom] = useState(true);
  const [isTabVisible, setIsTabVisible] = useState(true);

  // Check tab visibility to pause Three.js rendering when hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsTabVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const mobile = window.innerWidth < 768;
    setIsMobile(mobile);
    const pixelRatio = window.devicePixelRatio || 1;
    setDpr(Math.min(pixelRatio, mobile ? 1.0 : 1.5));
  }, []);

  const handleLowFps = () => {
    // Lower quality automatically when below 45 FPS
    setEnableBloom(false);
    setDpr(1.0);
  };

  // Lite mode or Tab hidden calm fallback
  if (isLiteMode) {
    return (
      <div className="fixed inset-0 z-0 pointer-events-none w-full h-full overflow-hidden bg-[#050505]">
        <div className="absolute inset-0 bg-radial from-[#1e1708] via-[#08080a] to-[#040405] opacity-90" />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-[#E8B84A]/10 blur-[120px] rounded-full pointer-events-none" />
      </div>
    );
  }

  if (!isTabVisible) {
    return <div className="fixed inset-0 z-0 bg-[#050505]" />;
  }

  return (
    <div className="fixed inset-0 z-0 pointer-events-none w-full h-full overflow-hidden bg-[#050505]">
      <Canvas
        camera={{ position: [0, 0, 11.2], fov: 45, near: 0.1, far: 80 }}
        dpr={dpr}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          stencil: false,
        }}
      >
        <color attach="background" args={['#050505']} />

        <FpsTracker
          onLowFpsDetected={handleLowFps}
          onFpsUpdate={onFpsUpdate}
        />

        {/* Ambient lighting with subtle warm amber tint */}
        <ambientLight intensity={0.4} color="#382d1c" />
        <directionalLight position={[5, 10, 8]} intensity={1.5} color="#FFE6A3" />
        <directionalLight position={[-6, -4, 2]} intensity={0.6} color="#8F6A24" />
        <pointLight position={[0, 0, 6]} intensity={1.2} color="#FFD97A" distance={18} />

        {/* Dynamic camera navigation along scroll */}
        <WorldCamera progress={progress} />

        <Suspense fallback={null}>
          {/* Universal Ambient Gold Dust Particles */}
          <AmbientDust />

          {/* Scene 1: Vault Slit Opening & Swirling Aurora */}
          <HeroVaultSlit progress={progress} />
          <AuroraRibbons intensity={Math.max(0.2, 1 - progress * 1.5)} />

          {/* Scene 2: Live Market - Particle Gold Bar Assembly */}
          <GoldBarAssembly progress={progress} />

          {/* Scene 3: Precision - Floating 3D Holographic Slabs */}
          <PrecisionNodes progress={progress} />

          {/* Scene 4: News Radar - 3D Wireframe Globe with Nodes */}
          <NewsRadarGlobe progress={progress} />

          {/* Scene 5: Telegram - Origami Paper Light Plane & Phone Mock */}
          <TelegramLightPlane progress={progress} />

          {/* Scene 6: Finale - Massive Rotating Dual-Ring Gold Vault */}
          <VaultFinaleDoor progress={progress} />

          {/* Cinematic Bloom Postprocessing (auto disabled if FPS < 45) */}
          {enableBloom && (
            <EffectComposer multisampling={0}>
              <Bloom
                luminanceThreshold={0.55}
                luminanceSmoothing={0.3}
                intensity={isMobile ? 0.4 : 0.75}
                radius={isMobile ? 0.35 : 0.6}
              />
            </EffectComposer>
          )}
        </Suspense>
      </Canvas>
    </div>
  );
};
