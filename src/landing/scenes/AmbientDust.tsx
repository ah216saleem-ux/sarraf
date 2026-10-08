import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { globalScrollState } from '../scrollTimeline';

export const AmbientDust: React.FC = () => {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const count = isMobile ? 320 : 750;

  const [positions, speeds, baseSizes] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const spd = new Float32Array(count);
    const sz = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      pos[i3] = (Math.random() - 0.5) * 26;
      pos[i3 + 1] = (Math.random() - 0.5) * 18;
      pos[i3 + 2] = 12 - Math.random() * 50; // Spans across all 6 scenes from +12 to -38
      spd[i] = 0.2 + Math.random() * 0.4;
      sz[i] = 0.03 + Math.random() * 0.04;
    }

    return [pos, spd, sz];
  }, [count]);

  const pointsRef = useRef<THREE.Points>(null);
  const currentStretch = useRef(1);

  useFrame((state, delta) => {
    if (!pointsRef.current) return;
    const posAttr = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const array = posAttr.array as Float32Array;

    // Scroll-velocity reactive visuals: dust stretches with scroll speed and relaxes when stopped
    const absVel = Math.abs(globalScrollState.velocity || 0);
    const targetStretch = 1.0 + Math.min(absVel * 0.12, 0.8);
    currentStretch.current = THREE.MathUtils.damp(currentStretch.current, targetStretch, 6.0, delta);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      // Idle ambient motion: slow drifting harmonic oscillation
      array[i3 + 1] += Math.sin(state.clock.elapsedTime * speeds[i] + i) * 0.003;
      array[i3] += Math.cos(state.clock.elapsedTime * 0.2 + i) * 0.002;

      // Velocity drift
      if (absVel > 0.1) {
        array[i3 + 2] += (globalScrollState.velocity > 0 ? -0.015 : 0.015) * (currentStretch.current - 1);
        if (array[i3 + 2] < -38) array[i3 + 2] = 12;
        if (array[i3 + 2] > 12) array[i3 + 2] = -38;
      }
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
        size={isMobile ? 0.035 : 0.045}
        color="#FFD97A"
        transparent
        opacity={0.45}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
};
