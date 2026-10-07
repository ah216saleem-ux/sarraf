import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { globalScrollState } from '../scrollTimeline';

interface AuroraRibbonsProps {
  intensity?: number;
}

export const AuroraRibbons: React.FC<AuroraRibbonsProps> = ({ intensity = 1 }) => {
  const ribbonCount = 5;
  const groupsRef = useRef<THREE.Group>(null);

  // Generate 5 ribbon geometry strips with varying frequency
  const ribbonsData = useMemo(() => {
    return Array.from({ length: ribbonCount }).map((_, idx) => {
      const segments = 64;
      const width = 1.2 + idx * 0.3;
      const geometry = new THREE.PlaneGeometry(36, width, segments, 4);
      return {
        id: idx,
        geometry,
        baseY: (idx - 2) * 1.8,
        baseZ: -2 - idx * 2.5,
        speed: 0.6 + idx * 0.15,
        freq: 0.2 + idx * 0.08,
        color: idx % 2 === 0 ? '#FFD97A' : '#E8B84A',
        opacity: 0.22 + (idx % 3) * 0.08,
      };
    });
  }, []);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    const px = globalScrollState.pointer.targetX;
    const py = globalScrollState.pointer.targetY;

    if (!groupsRef.current) return;

    groupsRef.current.children.forEach((mesh, i) => {
      const m = mesh as THREE.Mesh;
      const data = ribbonsData[i];
      if (!m || !data) return;

      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      const v = new THREE.Vector3();

      for (let j = 0; j < pos.count; j++) {
        v.fromBufferAttribute(pos, j);

        // Sinusoidal wave propagation influenced by time, pointer, and scroll
        const wave1 = Math.sin(v.x * data.freq + time * data.speed) * 1.5;
        const wave2 = Math.cos(v.x * 0.15 - time * 0.4) * 0.8;
        const pointerInfluence = (px * 1.2) * Math.sin(v.x * 0.1);

        v.z = wave1 + wave2 + pointerInfluence;
        v.y = data.baseY + Math.sin(v.x * 0.25 + time * 0.3) * 0.6 + py * 0.5;

        pos.setXYZ(j, v.x, v.y, v.z);
      }

      pos.needsUpdate = true;
      m.rotation.y = px * 0.08;
      m.rotation.x = -py * 0.05;
    });
  });

  return (
    <group ref={groupsRef} position={[0, 0, 0]}>
      {ribbonsData.map((data) => (
        <mesh key={data.id} geometry={data.geometry}>
          <meshBasicMaterial
            color={data.color}
            transparent
            opacity={data.opacity * intensity}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
};
