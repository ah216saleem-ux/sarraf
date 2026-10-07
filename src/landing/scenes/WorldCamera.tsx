import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { globalScrollState } from '../scrollTimeline';

interface WorldCameraProps {
  progress: number;
}

// 6 cinematic waypoints for seamless continuous camera navigation
const WAYPOINTS = [
  // Scene 1: Hero entry (Vault slit)
  { p: 0.0,  pos: new THREE.Vector3(0, 0, 11.2),   look: new THREE.Vector3(0, 0, 7.8) },
  { p: 0.15, pos: new THREE.Vector3(0, 0, 4.8),    look: new THREE.Vector3(0, 0, 0.0) },
  // Scene 2: Live Market (Gold bar assembly)
  { p: 0.32, pos: new THREE.Vector3(1.1, 0.3, 1.6), look: new THREE.Vector3(1.5, 0, -2.0) },
  // Scene 3: Precision (3 drifting glass nodes)
  { p: 0.50, pos: new THREE.Vector3(-0.9, -0.2, -7.8), look: new THREE.Vector3(0, 0, -12.0) },
  // Scene 4: News Radar (Orbital globe sweep)
  { p: 0.68, pos: new THREE.Vector3(2.4, 0.6, -17.2), look: new THREE.Vector3(0, 0, -22.0) },
  // Scene 5: Telegram (Light plane & phone)
  { p: 0.82, pos: new THREE.Vector3(0.4, 0.1, -11.5), look: new THREE.Vector3(0.5, 0, -14.5) },
  // Scene 6: Finale (Massive Vault door opening)
  { p: 1.0,  pos: new THREE.Vector3(0, 0, -26.2),  look: new THREE.Vector3(0, 0, -32.0) },
];

export const WorldCamera: React.FC<WorldCameraProps> = ({ progress }) => {
  const { camera } = useThree();
  const currentLookAt = useRef(new THREE.Vector3(0, 0, 7.8));
  const smoothProgress = useRef(progress);

  useFrame((_, delta) => {
    // Smooth progress damping for ultra-silky inertia
    smoothProgress.current = THREE.MathUtils.damp(smoothProgress.current, progress, 6.0, delta);
    const p = Math.min(Math.max(smoothProgress.current, 0), 1);

    // Find bounding keyframe segments
    let i = 0;
    while (i < WAYPOINTS.length - 2 && WAYPOINTS[i + 1].p < p) {
      i++;
    }
    const w0 = WAYPOINTS[i];
    const w1 = WAYPOINTS[i + 1];

    const segmentSpan = Math.max(0.0001, w1.p - w0.p);
    const segmentProgress = THREE.MathUtils.smoothstep(p, w0.p, w1.p);

    // Interpolate base camera position & lookAt target
    const targetPos = new THREE.Vector3().lerpVectors(w0.pos, w1.pos, segmentProgress);
    const targetLook = new THREE.Vector3().lerpVectors(w0.look, w1.look, segmentProgress);

    // Apply interactive pointer parallax (mouse or mobile touch drag)
    const pointer = globalScrollState.pointer;
    // Smooth pointer damping
    pointer.x = THREE.MathUtils.damp(pointer.x, pointer.targetX, 4.0, delta);
    pointer.y = THREE.MathUtils.damp(pointer.y, pointer.targetY, 4.0, delta);

    targetPos.x += pointer.x * 0.45;
    targetPos.y += pointer.y * 0.35;
    targetLook.x += pointer.x * 0.15;
    targetLook.y += pointer.y * 0.1;

    // Apply camera position
    camera.position.copy(targetPos);

    // Smoothly interpolate lookAt
    currentLookAt.current.lerp(targetLook, 0.12);
    camera.lookAt(currentLookAt.current);
  });

  return null;
};
