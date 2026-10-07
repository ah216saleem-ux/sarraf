import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useMarket } from '../../context/MarketContext';

interface GoldBarAssemblyProps {
  progress: number; // 0 to 1 overall progress
}

export const GoldBarAssembly: React.FC<GoldBarAssemblyProps> = ({ progress }) => {
  const { priceData } = useMarket();
  const groupRef = useRef<THREE.Group>(null);
  const barMeshRef = useRef<THREE.Mesh>(null);
  const wireframeRef = useRef<THREE.LineSegments>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const pulseFactorRef = useRef(1);

  // Scene 2 is active around progress 0.18 -> 0.38
  const sceneProgress = THREE.MathUtils.smoothstep(progress, 0.18, 0.38);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const PARTICLE_COUNT = isMobile ? 450 : 1000;

  // Precompute initial random cloud positions and target positions on gold bar surface
  const [positions, targets, initialData] = useMemo(() => {
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const trg = new Float32Array(PARTICLE_COUNT * 3);
    const data = new Float32Array(PARTICLE_COUNT * 3); // initial positions preserved

    // Dimensions of gold bullion bar
    const width = 3.6;
    const height = 1.2;
    const depth = 1.8;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      // Dispersed cloud
      const radius = 6.0 + Math.random() * 5.0;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);

      pos[i3] = radius * Math.sin(phi) * Math.cos(theta);
      pos[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      pos[i3 + 2] = radius * Math.cos(phi);

      data[i3] = pos[i3];
      data[i3 + 1] = pos[i3 + 1];
      data[i3 + 2] = pos[i3 + 2];

      // Target surface point on box
      const face = Math.floor(Math.random() * 6);
      let tx = (Math.random() - 0.5) * width;
      let ty = (Math.random() - 0.5) * height;
      let tz = (Math.random() - 0.5) * depth;

      if (face === 0) tx = width / 2;
      else if (face === 1) tx = -width / 2;
      else if (face === 2) ty = height / 2;
      else if (face === 3) ty = -height / 2;
      else if (face === 4) tz = depth / 2;
      else if (face === 5) tz = -depth / 2;

      trg[i3] = tx;
      trg[i3 + 1] = ty;
      trg[i3 + 2] = tz;
    }

    return [pos, trg, data];
  }, []);

  const barGeometry = useMemo(() => {
    return new THREE.BoxGeometry(3.6, 1.2, 1.8);
  }, []);

  const edgesGeometry = useMemo(() => {
    return new THREE.EdgesGeometry(barGeometry);
  }, [barGeometry]);

  // Trigger pulse on price tick
  React.useEffect(() => {
    pulseFactorRef.current = 2.4;
  }, [priceData.tickPulse]);

  useFrame((state, delta) => {
    // Decay pulse factor smoothly
    pulseFactorRef.current = THREE.MathUtils.damp(pulseFactorRef.current, 1.0, 4.0, delta);

    if (groupRef.current) {
      // Rotation driven by continuous time + scroll
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.35 + sceneProgress * 2.0;
      groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.2) * 0.2 + 0.15;
      groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.8) * 0.15;
    }

    // Morph particles between initial dispersed cloud and target bar coordinates
    if (particlesRef.current) {
      const posAttr = particlesRef.current.geometry.attributes.position as THREE.BufferAttribute;
      const array = posAttr.array as Float32Array;

      // Convergence factor increases with scene progress
      const factor = sceneProgress;
      const pulse = pulseFactorRef.current;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        const ix = initialData[i3];
        const iy = initialData[i3 + 1];
        const iz = initialData[i3 + 2];

        const tx = targets[i3] * pulse;
        const ty = targets[i3 + 1] * pulse;
        const tz = targets[i3 + 2] * pulse;

        // Linear interpolation
        array[i3] = ix + (tx - ix) * factor;
        array[i3 + 1] = iy + (ty - iy) * factor;
        array[i3 + 2] = iz + (tz - iz) * factor;
      }

      posAttr.needsUpdate = true;
    }

    // Materialize solid bar as assembly progresses
    if (barMeshRef.current) {
      const mat = barMeshRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = Math.max(0, (sceneProgress - 0.4) * 1.6);
      mat.roughness = 0.25 - sceneProgress * 0.1;
      mat.metalness = 0.95;
    }

    if (wireframeRef.current) {
      const lineMat = wireframeRef.current.material as THREE.LineBasicMaterial;
      lineMat.opacity = Math.min(1, sceneProgress * 1.5) * 0.85 * (pulseFactorRef.current > 1.2 ? 1.3 : 1.0);
    }
  });

  // Position bar in scene 2 space (around z = -2, y = 0)
  return (
    <group ref={groupRef} position={[1.5, 0, -2]}>
      {/* Assembling particle cloud */}
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[positions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.06}
          color="#FFD97A"
          transparent
          opacity={0.8}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Wireframe glowing edges of gold bar */}
      <lineSegments ref={wireframeRef} geometry={edgesGeometry}>
        <lineBasicMaterial
          color="#FFD97A"
          transparent
          opacity={0.1}
          linewidth={2}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      {/* Solid gold bullion bar */}
      <mesh ref={barMeshRef} geometry={barGeometry}>
        <meshStandardMaterial
          color="#D4A338"
          roughness={0.2}
          metalness={0.95}
          transparent
          opacity={0}
        />
      </mesh>

      {/* Inner ambient golden core */}
      <pointLight
        color="#FFD97A"
        intensity={2.5 * pulseFactorRef.current}
        distance={8}
      />
    </group>
  );
};
