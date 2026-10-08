import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { globalScrollState } from '../scrollTimeline';

interface WorldCameraProps {
  progress: number;
}

// 6 cinematic waypoints for seamless continuous camera spline navigation
const WAYPOINT_POSITIONS = [
  new THREE.Vector3(0, 0, 11.2),     // Scene 1: Hero entry (Vault slit)
  new THREE.Vector3(0, 0, 4.8),      // Slit pass-through
  new THREE.Vector3(1.1, 0.3, 1.6),  // Scene 2: Live Market (Gold bar assembly)
  new THREE.Vector3(-0.9, -0.2, -7.8), // Scene 3: Precision (3 drifting glass nodes)
  new THREE.Vector3(2.4, 0.6, -17.2), // Scene 4: News Radar (Orbital globe sweep)
  new THREE.Vector3(0.4, 0.1, -11.5), // Scene 5: Telegram (Light plane & phone)
  new THREE.Vector3(0, 0, -26.2),    // Scene 6: Finale (Massive Vault door opening)
];

const WAYPOINT_LOOKS = [
  new THREE.Vector3(0, 0, 7.8),
  new THREE.Vector3(0, 0, 0.0),
  new THREE.Vector3(1.5, 0, -2.0),
  new THREE.Vector3(0, 0, -12.0),
  new THREE.Vector3(0, 0, -22.0),
  new THREE.Vector3(0.5, 0, -14.5),
  new THREE.Vector3(0, 0, -32.0),
];

export const WorldCamera: React.FC<WorldCameraProps> = ({ progress }) => {
  const { camera } = useThree();
  const currentLookAt = useRef(new THREE.Vector3(0, 0, 7.8));
  const smoothProgress = useRef(progress);

  // Smooth Catmull-Rom continuous splines for position and lookAt
  const posCurve = useMemo(() => {
    return new THREE.CatmullRomCurve3(WAYPOINT_POSITIONS, false, 'centripetal', 0.5);
  }, []);

  const lookCurve = useMemo(() => {
    return new THREE.CatmullRomCurve3(WAYPOINT_LOOKS, false, 'centripetal', 0.5);
  }, []);

  useFrame((_, delta) => {
    // Smooth progress damping with consistent cubic-bezier-like responsiveness
    smoothProgress.current = THREE.MathUtils.damp(smoothProgress.current, progress, 5.5, delta);
    const p = Math.min(Math.max(smoothProgress.current, 0), 1);

    // Sample continuous spline positions
    const targetPos = posCurve.getPointAt(p);
    const targetLook = lookCurve.getPointAt(p);

    // Apply interactive pointer parallax (mouse or mobile touch drag)
    const pointer = globalScrollState.pointer;
    pointer.x = THREE.MathUtils.damp(pointer.x, pointer.targetX, 4.0, delta);
    pointer.y = THREE.MathUtils.damp(pointer.y, pointer.targetY, 4.0, delta);

    targetPos.x += pointer.x * 0.4;
    targetPos.y += pointer.y * 0.3;
    targetLook.x += pointer.x * 0.12;
    targetLook.y += pointer.y * 0.08;

    // Apply camera position
    camera.position.copy(targetPos);

    // Smoothly interpolate lookAt
    currentLookAt.current.lerp(targetLook, 0.14);
    camera.lookAt(currentLookAt.current);
  });

  return null;
};
