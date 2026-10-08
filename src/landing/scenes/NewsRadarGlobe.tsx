import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useMarket } from '../../context/MarketContext';

interface NewsRadarGlobeProps {
  progress: number;
}

export const NewsRadarGlobe: React.FC<NewsRadarGlobeProps> = ({ progress }) => {
  const { macroEvents } = useMarket();
  const globeGroupRef = useRef<THREE.Group>(null);
  const sweepBeamRef = useRef<THREE.Mesh>(null);
  const sweepTrailRef = useRef<THREE.Mesh>(null);
  const ringsRef = useRef<THREE.Group>(null);

  // Scene 4 is active around 0.52 -> 0.80
  const sceneActive = THREE.MathUtils.smoothstep(progress, 0.50, 0.65) * (1 - THREE.MathUtils.smoothstep(progress, 0.74, 0.84));

  useFrame((state) => {
    const time = state.clock.elapsedTime;

    if (globeGroupRef.current) {
      globeGroupRef.current.rotation.y = time * 0.25 + progress * 2.5;
      globeGroupRef.current.rotation.x = Math.sin(time * 0.15) * 0.15 + 0.1;
    }

    if (sweepBeamRef.current) {
      sweepBeamRef.current.rotation.y = time * 1.4;
    }

    if (sweepTrailRef.current) {
      // Trailing glow slightly behind the main radar beam
      sweepTrailRef.current.rotation.y = time * 1.4 - 0.22;
    }

    if (ringsRef.current) {
      // Pulsing sonar rings expanding outward
      ringsRef.current.children.forEach((ring, idx) => {
        const m = ring as THREE.Mesh;
        const phase = (time * 0.7 + idx * 0.4) % 1.5;
        const scale = 1.0 + phase * 0.8;
        m.scale.set(scale, scale, scale);
        const mat = m.material as THREE.MeshBasicMaterial;
        if (mat) {
          mat.opacity = Math.max(0, (1 - phase / 1.5) * 0.45 * sceneActive);
        }
      });
    }
  });

  return (
    <group position={[0, 0, -22]}>
      {/* Globe & Nodes Group */}
      <group ref={globeGroupRef}>
        {/* Wireframe globe sphere */}
        <mesh>
          <sphereGeometry args={[2.4, 28, 20]} />
          <meshBasicMaterial
            color="#E8B84A"
            wireframe
            transparent
            opacity={0.16 * (sceneActive > 0 ? 1 : 0.05)}
          />
        </mesh>

        {/* Inner dark core with golden rim */}
        <mesh>
          <sphereGeometry args={[2.3, 32, 32]} />
          <meshStandardMaterial
            color="#08080a"
            roughness={0.4}
            metalness={0.9}
          />
        </mesh>

        {/* Equatorial and Meridian highlight rings */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.38, 2.42, 64]} />
          <meshBasicMaterial color="#FFD97A" side={THREE.DoubleSide} transparent opacity={0.6} />
        </mesh>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <ringGeometry args={[2.38, 2.42, 64]} />
          <meshBasicMaterial color="#FFD97A" side={THREE.DoubleSide} transparent opacity={0.3} />
        </mesh>

        {/* Radar sweeping scan fan */}
        <mesh ref={sweepBeamRef} position={[0, 0, 0]}>
          <coneGeometry args={[2.8, 0.05, 32, 1, false, 0, Math.PI / 3]} />
          <meshBasicMaterial
            color="#FFD97A"
            transparent
            opacity={0.3}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>

        {/* Radar trailing glow beam with softer attenuation */}
        <mesh ref={sweepTrailRef} position={[0, 0, 0]}>
          <coneGeometry args={[2.8, 0.05, 32, 1, false, 0, Math.PI / 2.2]} />
          <meshBasicMaterial
            color="#E8B84A"
            transparent
            opacity={0.14}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>

        {/* High impact event glowing nodes */}
        {macroEvents.map((evt) => {
          const isBullish = evt.bias === 'BULLISH';
          const nodeColor = isBullish ? '#34D399' : evt.bias === 'BEARISH' ? '#F43F5E' : '#FFD97A';
          return (
            <group key={evt.id} position={evt.coordinates}>
              <mesh>
                <sphereGeometry args={[0.09, 16, 16]} />
                <meshBasicMaterial color={nodeColor} />
              </mesh>
              {/* Outer pulsing beacon ring */}
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.12, 0.16, 16]} />
                <meshBasicMaterial
                  color={nodeColor}
                  side={THREE.DoubleSide}
                  transparent
                  opacity={0.7}
                  blending={THREE.AdditiveBlending}
                />
              </mesh>
              <pointLight color={nodeColor} intensity={1.2} distance={2.5} />
            </group>
          );
        })}
      </group>

      {/* Concentric pulsing sonar rings in horizontal plane */}
      <group ref={ringsRef} rotation={[Math.PI / 2, 0, 0]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i}>
            <ringGeometry args={[2.4, 2.44, 48]} />
            <meshBasicMaterial
              color="#FFD97A"
              side={THREE.DoubleSide}
              transparent
              opacity={0.3}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        ))}
      </group>

      {/* Center radar ambient glow */}
      <pointLight color="#E8B84A" intensity={3} distance={10} />
    </group>
  );
};
