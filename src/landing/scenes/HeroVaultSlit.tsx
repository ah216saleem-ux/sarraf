import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface HeroVaultSlitProps {
  progress: number;
}

export const HeroVaultSlit: React.FC<HeroVaultSlitProps> = ({ progress }) => {
  const slitLeftRef = useRef<THREE.Mesh>(null);
  const slitRightRef = useRef<THREE.Mesh>(null);
  const lightBeamRef = useRef<THREE.Mesh>(null);
  const raysRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    // Slit opens as progress advances from 0.0 to 0.15
    const openFactor = THREE.MathUtils.smoothstep(progress, 0.01, 0.16);
    const separation = openFactor * 8.0;

    if (slitLeftRef.current) {
      slitLeftRef.current.position.x = -4.5 - separation;
    }
    if (slitRightRef.current) {
      slitRightRef.current.position.x = 4.5 + separation;
    }

    if (lightBeamRef.current) {
      // Glow intensifies then fades as camera flies inside
      const beamOpacity = Math.max(0, 1 - progress * 4.5);
      const mat = lightBeamRef.current.material as THREE.MeshBasicMaterial;
      if (mat) {
        mat.opacity = (0.7 + Math.sin(state.clock.elapsedTime * 3) * 0.15) * beamOpacity;
      }
    }

    if (raysRef.current) {
      raysRef.current.rotation.z = state.clock.elapsedTime * 0.1;
      const rayOpacity = Math.max(0, 1 - progress * 5.0);
      raysRef.current.children.forEach((child) => {
        const m = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        if (m) m.opacity = rayOpacity * 0.25;
      });
    }
  });

  return (
    <group position={[0, 0, 8]}>
      {/* Central volumetric golden light slit beam */}
      <mesh ref={lightBeamRef} position={[0, 0, 0]}>
        <planeGeometry args={[0.08 + progress * 6, 20]} />
        <meshBasicMaterial
          color="#FFD97A"
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Volumetric light flare planes */}
      <group ref={raysRef}>
        {[0, 45, 90, 135].map((angle, i) => (
          <mesh key={i} rotation={[0, 0, (angle * Math.PI) / 180]}>
            <planeGeometry args={[0.05, 12]} />
            <meshBasicMaterial
              color="#E8B84A"
              transparent
              opacity={0.2}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        ))}
      </group>

      {/* Left monolithic vault plate */}
      <mesh ref={slitLeftRef} position={[-4.5, 0, 0.05]}>
        <boxGeometry args={[9, 18, 0.4]} />
        <meshStandardMaterial
          color="#08080a"
          roughness={0.3}
          metalness={0.9}
        />
      </mesh>

      {/* Right monolithic vault plate */}
      <mesh ref={slitRightRef} position={[4.5, 0, 0.05]}>
        <boxGeometry args={[9, 18, 0.4]} />
        <meshStandardMaterial
          color="#08080a"
          roughness={0.3}
          metalness={0.9}
        />
      </mesh>

      {/* Beveled golden rim trims */}
      <mesh position={[0, 0, 0.1]}>
        <boxGeometry args={[0.04, 18, 0.5]} />
        <meshBasicMaterial color="#FFD97A" />
      </mesh>
    </group>
  );
};
