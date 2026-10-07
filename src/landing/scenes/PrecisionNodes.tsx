import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface PrecisionNodesProps {
  progress: number;
}

export const PrecisionNodes: React.FC<PrecisionNodesProps> = ({ progress }) => {
  const groupRef = useRef<THREE.Group>(null);
  const card1Ref = useRef<THREE.Group>(null);
  const card2Ref = useRef<THREE.Group>(null);
  const card3Ref = useRef<THREE.Group>(null);

  useFrame((state) => {
    const time = state.clock.elapsedTime;

    // Gentle harmonic floating motion
    if (card1Ref.current) {
      card1Ref.current.position.y = 0.8 + Math.sin(time * 0.9) * 0.15;
      card1Ref.current.rotation.y = -0.15 + Math.sin(time * 0.5) * 0.05;
      card1Ref.current.rotation.x = 0.08 + Math.cos(time * 0.7) * 0.03;
    }
    if (card2Ref.current) {
      card2Ref.current.position.y = -0.4 + Math.sin(time * 0.8 + 1.5) * 0.15;
      card2Ref.current.rotation.y = 0.2 + Math.sin(time * 0.6 + 1.0) * 0.06;
      card2Ref.current.rotation.x = -0.05 + Math.cos(time * 0.8 + 1.0) * 0.03;
    }
    if (card3Ref.current) {
      card3Ref.current.position.y = 1.1 + Math.sin(time * 1.1 + 3.0) * 0.18;
      card3Ref.current.rotation.y = -0.1 + Math.sin(time * 0.7 + 2.0) * 0.05;
      card3Ref.current.rotation.x = 0.1 + Math.cos(time * 0.9 + 2.0) * 0.04;
    }

    if (groupRef.current) {
      // Parallax drift based on overall progress
      const p = THREE.MathUtils.smoothstep(progress, 0.35, 0.6);
      groupRef.current.position.y = (p - 0.5) * 1.5;
    }
  });

  return (
    <group ref={groupRef} position={[0, 0, -12]}>
      {/* Node 1: "One signal at a time" */}
      <group ref={card1Ref} position={[-2.8, 0.8, 1.5]}>
        {/* Glass plate */}
        <mesh>
          <boxGeometry args={[2.8, 1.8, 0.08]} />
          <meshPhysicalMaterial
            color="#141416"
            roughness={0.1}
            metalness={0.1}
            transmission={0.8}
            thickness={0.5}
            transparent
            opacity={0.7}
          />
        </mesh>
        {/* Gold hairline edge */}
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(2.8, 1.8, 0.08)]} />
          <lineBasicMaterial color="#E8B84A" transparent opacity={0.6} />
        </lineSegments>
        {/* Holographic glyph: Single focused beacon */}
        <mesh position={[0, 0, 0.08]}>
          <ringGeometry args={[0.25, 0.28, 32]} />
          <meshBasicMaterial color="#FFD97A" side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0, 0.08]}>
          <circleGeometry args={[0.1, 16]} />
          <meshBasicMaterial color="#FFD97A" />
        </mesh>
      </group>

      {/* Node 2: "Clear Entry, SL, TP" */}
      <group ref={card2Ref} position={[2.5, -0.4, 0]}>
        {/* Glass plate */}
        <mesh>
          <boxGeometry args={[3.0, 1.9, 0.08]} />
          <meshPhysicalMaterial
            color="#141416"
            roughness={0.1}
            metalness={0.1}
            transmission={0.8}
            thickness={0.5}
            transparent
            opacity={0.7}
          />
        </mesh>
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(3.0, 1.9, 0.08)]} />
          <lineBasicMaterial color="#E8B84A" transparent opacity={0.6} />
        </lineSegments>
        {/* Tri-level bracket glyph */}
        <mesh position={[0, 0.35, 0.08]}>
          <boxGeometry args={[1.2, 0.04, 0.02]} />
          <meshBasicMaterial color="#10B981" />
        </mesh>
        <mesh position={[0, 0, 0.08]}>
          <boxGeometry args={[1.6, 0.04, 0.02]} />
          <meshBasicMaterial color="#FFD97A" />
        </mesh>
        <mesh position={[0, -0.35, 0.08]}>
          <boxGeometry args={[1.2, 0.04, 0.02]} />
          <meshBasicMaterial color="#F43F5E" />
        </mesh>
      </group>

      {/* Node 3: "Cooldown discipline" */}
      <group ref={card3Ref} position={[-0.8, -1.8, -2.5]}>
        {/* Glass plate */}
        <mesh>
          <boxGeometry args={[2.6, 1.7, 0.08]} />
          <meshPhysicalMaterial
            color="#141416"
            roughness={0.1}
            metalness={0.1}
            transmission={0.8}
            thickness={0.5}
            transparent
            opacity={0.7}
          />
        </mesh>
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(2.6, 1.7, 0.08)]} />
          <lineBasicMaterial color="#E8B84A" transparent opacity={0.6} />
        </lineSegments>
        {/* Shield / Timer glyph */}
        <mesh position={[0, 0, 0.08]} rotation={[0, 0, Math.PI / 4]}>
          <ringGeometry args={[0.22, 0.26, 4]} />
          <meshBasicMaterial color="#FFD97A" side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
};
