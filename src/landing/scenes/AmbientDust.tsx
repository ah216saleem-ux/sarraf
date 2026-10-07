import React, { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export const AmbientDust: React.FC = () => {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const count = isMobile ? 280 : 650;

  const [positions, speeds] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const spd = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      pos[i3] = (Math.random() - 0.5) * 24;
      pos[i3 + 1] = (Math.random() - 0.5) * 16;
      pos[i3 + 2] = 12 - Math.random() * 48; // Spans all 6 scenes from +12 to -36
      spd[i] = 0.2 + Math.random() * 0.4;
    }

    return [pos, spd];
  }, [count]);

  const pointsRef = React.useRef<THREE.Points>(null);

  useFrame((state) => {
    if (!pointsRef.current) return;
    const posAttr = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const array = posAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      // Subtle floating harmonic oscillation
      array[i3 + 1] += Math.sin(state.clock.elapsedTime * speeds[i] + i) * 0.003;
      array[i3] += Math.cos(state.clock.elapsedTime * 0.2 + i) * 0.002;
    }

    posAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.04}
        color="#FFD97A"
        transparent
        opacity={0.5}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
};
