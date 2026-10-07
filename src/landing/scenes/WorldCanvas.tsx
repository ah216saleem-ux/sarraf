import React, { Suspense, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
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
}

export const WorldCanvas: React.FC<WorldCanvasProps> = ({ progress }) => {
  const [dpr, setDpr] = useState(1);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Adaptive DPR: max 1.25 on mobile to guarantee smooth 60fps on mid-range devices
    const mobile = window.innerWidth < 768;
    setIsMobile(mobile);
    const pixelRatio = window.devicePixelRatio || 1;
    setDpr(Math.min(pixelRatio, mobile ? 1.25 : 1.75));
  }, []);

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

          {/* Cinematic Bloom Postprocessing */}
          <EffectComposer multisampling={0}>
            <Bloom
              luminanceThreshold={0.55}
              luminanceSmoothing={0.3}
              intensity={isMobile ? 0.5 : 0.85}
              radius={isMobile ? 0.4 : 0.7}
            />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </div>
  );
};
