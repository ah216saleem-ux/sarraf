import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VaultFinaleDoorProps {
  progress: number;
}

export const VaultFinaleDoor: React.FC<VaultFinaleDoorProps> = ({ progress }) => {
  const outerRingRef = useRef<THREE.Group>(null);
  const innerRingRef = useRef<THREE.Group>(null);
  const doorPivotRef = useRef<THREE.Group>(null);
  const boltsRef = useRef<THREE.Group>(null);
  const lightFloodRef = useRef<THREE.Mesh>(null);

  // Scene 6 active towards end: 0.88 -> 1.0
  const openProgress = THREE.MathUtils.smoothstep(progress, 0.88, 0.99);

  useFrame((state) => {
    // Rings counter-rotate as unlocking sequence engages
    if (outerRingRef.current) {
      outerRingRef.current.rotation.z = -openProgress * Math.PI * 0.75 + state.clock.elapsedTime * 0.05;
    }
    if (innerRingRef.current) {
      innerRingRef.current.rotation.z = openProgress * Math.PI * 1.25 - state.clock.elapsedTime * 0.05;
    }

    // Radial locking bolts retract outward/inward
    if (boltsRef.current) {
      const retract = 1.0 - openProgress * 0.35;
      boltsRef.current.children.forEach((bolt) => {
        bolt.scale.set(1, retract, 1);
      });
    }

    // Heavy vault door swings open around pivot
    if (doorPivotRef.current) {
      // Swing open on Y axis up to -75 degrees
      doorPivotRef.current.rotation.y = -openProgress * 1.3;
    }

    // Volumetric floodlight intensifies as door cracks open
    if (lightFloodRef.current) {
      const mat = lightFloodRef.current.material as THREE.MeshBasicMaterial;
      if (mat) {
        mat.opacity = openProgress * 0.85;
      }
    }
  });

  return (
    <group position={[0, 0, -32]}>
      {/* Background Volumetric Golden Light Burst from inside the vault */}
      <mesh ref={lightFloodRef} position={[0, 0, -2]}>
        <planeGeometry args={[16, 16]} />
        <meshBasicMaterial
          color="#FFD97A"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Massive Vault Outer Fixed Wall & Frame */}
      <mesh position={[0, 0, -0.3]}>
        <ringGeometry args={[3.2, 8, 48]} />
        <meshStandardMaterial
          color="#09090b"
          roughness={0.4}
          metalness={0.9}
        />
      </mesh>

      {/* Outer Golden Flange Rim */}
      <mesh position={[0, 0, -0.1]}>
        <ringGeometry args={[3.15, 3.3, 64]} />
        <meshStandardMaterial
          color="#E8B84A"
          roughness={0.2}
          metalness={0.95}
        />
      </mesh>

      {/* Vault Door Pivot (Hinged at left x = -3.2) */}
      <group position={[-3.2, 0, 0]}>
        <group ref={doorPivotRef} position={[3.2, 0, 0]}>
          {/* Main Vault Door Heavy Disc */}
          <mesh>
            <cylinderGeometry args={[3.1, 3.1, 0.4, 48]} />
            <meshStandardMaterial
              color="#0d0d10"
              roughness={0.25}
              metalness={0.88}
            />
          </mesh>

          {/* Central Golden Boss / Emblem */}
          <mesh position={[0, 0, 0.22]}>
            <cylinderGeometry args={[0.9, 0.9, 0.15, 32]} />
            <meshStandardMaterial
              color="#E8B84A"
              roughness={0.15}
              metalness={0.95}
            />
          </mesh>

          {/* Outer Rotating Gear Ring with Gold Teeth */}
          <group ref={outerRingRef} position={[0, 0, 0.24]}>
            <mesh>
              <ringGeometry args={[2.2, 2.6, 48]} />
              <meshBasicMaterial color="#FFD97A" side={THREE.DoubleSide} />
            </mesh>
            {/* Teeth lugs */}
            {Array.from({ length: 16 }).map((_, i) => {
              const angle = (i / 16) * Math.PI * 2;
              return (
                <mesh
                  key={i}
                  position={[Math.cos(angle) * 2.4, Math.sin(angle) * 2.4, 0]}
                  rotation={[0, 0, angle]}
                >
                  <boxGeometry args={[0.15, 0.35, 0.05]} />
                  <meshBasicMaterial color="#E8B84A" />
                </mesh>
              );
            })}
          </group>

          {/* Inner Counter-Rotating Mechanism Ring */}
          <group ref={innerRingRef} position={[0, 0, 0.26]}>
            <mesh>
              <ringGeometry args={[1.3, 1.6, 36]} />
              <meshBasicMaterial color="#FFD97A" side={THREE.DoubleSide} />
            </mesh>
            {/* Spoke rods */}
            {Array.from({ length: 6 }).map((_, i) => {
              const angle = (i / 6) * Math.PI * 2;
              return (
                <mesh key={i} rotation={[0, 0, angle]} position={[0, 0, 0.02]}>
                  <boxGeometry args={[0.08, 1.4, 0.03]} />
                  <meshBasicMaterial color="#E8B84A" />
                </mesh>
              );
            })}
          </group>

          {/* 12 Heavy Radial Locking Steel/Gold Bolts */}
          <group ref={boltsRef} position={[0, 0, 0.05]}>
            {Array.from({ length: 12 }).map((_, i) => {
              const angle = (i / 12) * Math.PI * 2;
              return (
                <group key={i} rotation={[0, 0, angle]}>
                  <mesh position={[0, 2.8, 0]}>
                    <cylinderGeometry args={[0.12, 0.12, 0.9, 16]} />
                    <meshStandardMaterial
                      color="#E8B84A"
                      roughness={0.1}
                      metalness={0.95}
                    />
                  </mesh>
                </group>
              );
            })}
          </group>
        </group>
      </group>
    </group>
  );
};
