import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface TelegramLightPlaneProps {
  progress: number;
}

export const TelegramLightPlane: React.FC<TelegramLightPlaneProps> = ({ progress }) => {
  const planeGroupRef = useRef<THREE.Group>(null);
  const phoneGroupRef = useRef<THREE.Group>(null);
  const ribbonTrailRef = useRef<THREE.Line>(null);

  // Scene 5 active around 0.74 -> 0.92
  const sceneProgress = THREE.MathUtils.smoothstep(progress, 0.74, 0.90);

  // Procedural origami paper-plane geometry
  const planeGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    // Vertices of classic aerodynamic paper airplane:
    // Nose, Left wing tip, Right wing tip, Tail center, Keel bottom
    const vertices = new Float32Array([
      // Top left wing face
      0, 0, 1.2,    -1.1, 0.15, -0.9,   0, 0.25, -0.7,
      // Top right wing face
      0, 0, 1.2,    0, 0.25, -0.7,      1.1, 0.15, -0.9,
      // Left keel face
      0, 0, 1.2,    0, 0.25, -0.7,      0, -0.3, -0.6,
      // Right keel face
      0, 0, 1.2,    0, -0.3, -0.6,      0, 0.25, -0.7,
    ]);
    geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geom.computeVertexNormals();
    return geom;
  }, []);

  const planeEdges = useMemo(() => {
    return new THREE.EdgesGeometry(planeGeometry);
  }, [planeGeometry]);

  // Ribbon trail geometry
  const trailGeometry = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 50; i++) {
      const t = i / 49;
      points.push(new THREE.Vector3(
        -2.5 + Math.sin(t * Math.PI * 2) * 1.5,
        -1.0 + t * 2.0,
        -26 + t * 14
      ));
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }, []);

  const ribbonMesh = useMemo(() => {
    const mat = new THREE.LineBasicMaterial({
      color: '#E8B84A',
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Line(trailGeometry, mat);
  }, [trailGeometry]);

  useFrame((state) => {
    const time = state.clock.elapsedTime;

    if (ribbonMesh) {
      (ribbonMesh.material as THREE.LineBasicMaterial).opacity = 0.4 * sceneProgress;
    }

    // Paper plane flies forward and banks towards camera
    if (planeGroupRef.current) {
      // Flight trajectory driven by scroll + continuous hover
      const flyZ = -22 + sceneProgress * 12 + Math.sin(time * 2) * 0.2;
      const flyX = -1.2 + Math.sin(sceneProgress * Math.PI) * 1.8 + Math.cos(time * 1.5) * 0.2;
      const flyY = -0.2 + Math.sin(time * 2.2) * 0.25;

      planeGroupRef.current.position.set(flyX, flyY, flyZ);
      planeGroupRef.current.rotation.z = Math.sin(time * 2) * 0.15 + (sceneProgress > 0.5 ? -0.25 : 0.2);
      planeGroupRef.current.rotation.x = 0.1 + Math.cos(time * 1.8) * 0.08;
      planeGroupRef.current.rotation.y = 0.15 + Math.sin(time * 1.2) * 0.1;
    }

    // 3D Phone mock floating and turning
    if (phoneGroupRef.current) {
      phoneGroupRef.current.rotation.y = -0.35 + Math.sin(time * 0.8) * 0.06;
      phoneGroupRef.current.rotation.x = 0.12 + Math.cos(time * 0.6) * 0.04;
      phoneGroupRef.current.position.y = 0.2 + Math.sin(time * 1.1) * 0.1;
    }
  });

  return (
    <group position={[0, 0, -10]}>
      {/* Light Paper Plane */}
      <group ref={planeGroupRef} position={[-1.2, 0, -15]}>
        {/* Translucent emissive wings */}
        <mesh geometry={planeGeometry}>
          <meshBasicMaterial
            color="#FFD97A"
            transparent
            opacity={0.35}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        {/* Crisp golden glowing wireframe edges */}
        <lineSegments geometry={planeEdges}>
          <lineBasicMaterial
            color="#FFF1C2"
            linewidth={2}
            blending={THREE.AdditiveBlending}
          />
        </lineSegments>
        {/* Jet nose beacon */}
        <pointLight color="#FFD97A" intensity={2.0} distance={5} />
      </group>

      {/* Flight ribbon trail */}
      <primitive object={ribbonMesh} />

      {/* 3D Phone Mockup Chassis */}
      <group ref={phoneGroupRef} position={[2.2, 0, -14]}>
        {/* Phone outer body frame */}
        <mesh>
          <boxGeometry args={[2.2, 4.4, 0.16]} />
          <meshStandardMaterial
            color="#0c0c0e"
            roughness={0.25}
            metalness={0.9}
          />
        </mesh>

        {/* Golden chamfered perimeter rim */}
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(2.2, 4.4, 0.16)]} />
          <lineBasicMaterial color="#E8B84A" transparent opacity={0.65} />
        </lineSegments>

        {/* Glass screen display */}
        <mesh position={[0, 0, 0.09]}>
          <planeGeometry args={[2.0, 4.1]} />
          <meshBasicMaterial color="#08080a" />
        </mesh>

        {/* Dynamic Island pill notch */}
        <mesh position={[0, 1.8, 0.1]}>
          <capsuleGeometry args={[0.07, 0.35, 4, 8]} />
          <meshBasicMaterial color="#000000" />
        </mesh>

        {/* Screen glowing signal header bar */}
        <mesh position={[0, 1.45, 0.1]}>
          <planeGeometry args={[1.8, 0.25]} />
          <meshBasicMaterial color="#1a1813" />
        </mesh>

        {/* Screen signal card hologram preview */}
        <mesh position={[0, 0.2, 0.1]}>
          <planeGeometry args={[1.7, 1.9]} />
          <meshBasicMaterial
            color="#E8B84A"
            transparent
            opacity={0.12}
          />
        </mesh>
        <lineSegments position={[0, 0.2, 0.1]}>
          <edgesGeometry args={[new THREE.BoxGeometry(1.7, 1.9, 0.01)]} />
          <lineBasicMaterial color="#FFD97A" transparent opacity={0.4} />
        </lineSegments>
      </group>
    </group>
  );
};
