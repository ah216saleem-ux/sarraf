import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

export interface IntroDiamondProps {
  onComplete?: () => void;
  /** Alias for compatibility with existing Preloader prop signature */
  onLoaded?: () => void;
}

const PARTICLE_COUNT = 3200;
const DUST_COUNT = 300;
const SIMULATED_DURATION_MS = 3400;
const PAUSE_AT_100_MS = 350;
const DOOR_SPLIT_DURATION_MS = 1250;

function easeOutCubic(x: number): number {
  const inv = 1 - Math.min(1, Math.max(0, x));
  return 1 - inv * inv * inv;
}

function easeInOutCubic(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function getStatusText(progress: number): string {
  if (progress >= 95) return 'Ready';
  if (progress >= 70) return 'Calibrating signals';
  if (progress >= 35) return 'Syncing XAU/USD feed';
  return 'Connecting to live market';
}

export const IntroDiamond: React.FC<IntroDiamondProps> = ({ onComplete, onLoaded }) => {
  const mountRef = useRef<HTMLDivElement>(null);

  const [displayProgress, setDisplayProgress] = useState<number>(0);
  const [isSplitting, setIsSplitting] = useState<boolean>(false);
  const [isSimpleFadeOut, setIsSimpleFadeOut] = useState<boolean>(false);
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  });

  // Mutable animation state refs to avoid React re-renders tearing down WebGL
  const progressRef = useRef<number>(0);
  const realTargetRef = useRef<number>(0);
  const realReadyCountRef = useRef<number>(0);
  const phaseRef = useRef<'loading' | 'pausing' | 'splitting' | 'done'>('loading');
  const splitStartTimeRef = useRef<number>(0);
  const hasCompletedRef = useRef<boolean>(false);
  const timersRef = useRef<number[]>([]);

  const fireComplete = useCallback(() => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    phaseRef.current = 'done';

    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('sarraf_preloader_seen', 'true');
      } catch {
        // Ignore storage errors in private mode
      }
    }

    onLoaded?.();
    onComplete?.();
  }, [onComplete, onLoaded]);

  const triggerSplitSequence = useCallback(
    (immediateSkip = false) => {
      if (phaseRef.current === 'splitting' || phaseRef.current === 'done') return;

      // Clear any pending pause timers
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];

      progressRef.current = 1;
      setDisplayProgress(100);

      if (reducedMotion) {
        phaseRef.current = 'splitting';
        setIsSimpleFadeOut(true);
        const fadeTimer = window.setTimeout(() => {
          fireComplete();
        }, 420);
        timersRef.current.push(fadeTimer);
        return;
      }

      const startDoors = () => {
        if (phaseRef.current === 'done') return;
        phaseRef.current = 'splitting';
        splitStartTimeRef.current = performance.now();
        setIsSplitting(true);

        const doneTimer = window.setTimeout(() => {
          fireComplete();
        }, DOOR_SPLIT_DURATION_MS);
        timersRef.current.push(doneTimer);
      };

      if (immediateSkip) {
        startDoors();
      } else {
        phaseRef.current = 'pausing';
        const pauseTimer = window.setTimeout(startDoors, PAUSE_AT_100_MS);
        timersRef.current.push(pauseTimer);
      }
    },
    [fireComplete, reducedMotion]
  );

  // Skip handler on tap / click / keydown
  const handleSkip = useCallback(() => {
    triggerSplitSequence(true);
  }, [triggerSplitSequence]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // Connect to REAL load state (fonts + first XAU/USD price fetch) with ~3.4s eased fallback
  useEffect(() => {
    let fontsResolved = false;
    let priceResolved = false;

    const markTaskDone = (weight: number) => {
      realTargetRef.current = Math.min(1, realTargetRef.current + weight);
      realReadyCountRef.current += 1;
    };

    // 1. Real font loading check
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      document.fonts.ready
        .then(() => {
          if (!fontsResolved) {
            fontsResolved = true;
            markTaskDone(0.45);
          }
        })
        .catch(() => {
          if (!fontsResolved) {
            fontsResolved = true;
            markTaskDone(0.45);
          }
        });
    } else {
      fontsResolved = true;
      markTaskDone(0.45);
    }

    // 2. Real first price/data fetch check
    fetch('/api/price/xauusd')
      .then((res) => {
        if (!priceResolved) {
          priceResolved = true;
          markTaskDone(res.ok ? 0.55 : 0.45);
        }
      })
      .catch(() => {
        if (!priceResolved) {
          priceResolved = true;
          markTaskDone(0.45);
        }
      });

    return () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };
  }, []);

  // Main Three.js Scene & Progress Loop
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // If reduced motion is enabled, run a lightweight progress timer and simple fade
    if (reducedMotion) {
      const start = performance.now();
      let rafId = 0;
      const tickReduced = (now: number) => {
        const t = Math.min(1, (now - start) / 900);
        progressRef.current = t;
        setDisplayProgress(Math.round(t * 100));
        if (t >= 1) {
          triggerSplitSequence(false);
        } else {
          rafId = requestAnimationFrame(tickReduced);
        }
      };
      rafId = requestAnimationFrame(tickReduced);
      return () => cancelAnimationFrame(rafId);
    }

    // Detect software WebGL for safe frame pacing / antialias
    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return false;
      }
    })();

    const width = window.innerWidth || 1;
    const height = window.innerHeight || 1;
    const isPortrait = height > width;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, isPortrait ? 9 : 7);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);

    const canvasEl = renderer.domElement;
    canvasEl.style.display = 'block';
    canvasEl.style.width = '100%';
    canvasEl.style.height = '100%';
    container.appendChild(canvasEl);

    // -------------------------------------------------------------------------
    // 1. Thin Vertical Gold Light Beam (scaleY 0 -> 1 over 1.6s ease-out)
    // -------------------------------------------------------------------------
    const beamGroup = new THREE.Group();
    scene.add(beamGroup);

    const coreBeamGeo = new THREE.PlaneGeometry(0.022, 16);
    const coreBeamMat = new THREE.MeshBasicMaterial({
      color: 0xffd97a,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const coreBeamMesh = new THREE.Mesh(coreBeamGeo, coreBeamMat);
    beamGroup.add(coreBeamMesh);

    const glowBeamGeo = new THREE.PlaneGeometry(0.28, 16);
    const glowBeamMat = new THREE.MeshBasicMaterial({
      color: 0xe8b84a,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const glowBeamMesh = new THREE.Mesh(glowBeamGeo, glowBeamMat);
    beamGroup.add(glowBeamMesh);

    beamGroup.scale.set(1, 0.0001, 1);

    // -------------------------------------------------------------------------
    // 2. Diamond Group: 3200 Gold Particles + Elongated Octahedron Wireframe
    // -------------------------------------------------------------------------
    const diamondGroup = new THREE.Group();
    scene.add(diamondGroup);

    const diamondRadius = 1.35;
    const diamondYScale = 1.5;

    // Build elongated octahedron geometry for wireframe & surface sampling
    const octaGeo = new THREE.OctahedronGeometry(diamondRadius, 0);
    octaGeo.scale(1, diamondYScale, 1);

    const edgesGeo = new THREE.EdgesGeometry(octaGeo);
    const edgesMat = new THREE.LineBasicMaterial({
      color: 0xe8b84a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const wireframeLines = new THREE.LineSegments(edgesGeo, edgesMat);
    diamondGroup.add(wireframeLines);

    // Precompute the 8 triangular faces of the elongated octahedron for surface sampling
    const topV = [0, diamondRadius * diamondYScale, 0];
    const botV = [0, -diamondRadius * diamondYScale, 0];
    const eqV = [
      [diamondRadius, 0, 0],
      [0, 0, diamondRadius],
      [-diamondRadius, 0, 0],
      [0, 0, -diamondRadius],
    ];
    const faces: number[][][] = [
      [topV, eqV[0], eqV[1]],
      [topV, eqV[1], eqV[2]],
      [topV, eqV[2], eqV[3]],
      [topV, eqV[3], eqV[0]],
      [botV, eqV[1], eqV[0]],
      [botV, eqV[2], eqV[1]],
      [botV, eqV[3], eqV[2]],
      [botV, eqV[0], eqV[3]],
    ];
    const edgesList: number[][][] = [
      [topV, eqV[0]],
      [topV, eqV[1]],
      [topV, eqV[2]],
      [topV, eqV[3]],
      [botV, eqV[0]],
      [botV, eqV[1]],
      [botV, eqV[2]],
      [botV, eqV[3]],
      [eqV[0], eqV[1]],
      [eqV[1], eqV[2]],
      [eqV[2], eqV[3]],
      [eqV[3], eqV[0]],
    ];

    const startPositions = new Float32Array(PARTICLE_COUNT * 3);
    const targetPositions = new Float32Array(PARTICLE_COUNT * 3);
    const currentPositions = new Float32Array(PARTICLE_COUNT * 3);
    const particleDelays = new Float32Array(PARTICLE_COUNT);
    const particleSwirls = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;

      // Scattered spherical start position: radius 3.5 - 8.5
      const r = 3.5 + Math.random() * 5.0;
      const theta = Math.random() * Math.PI * 2;
      const cosPhi = 2 * Math.random() - 1;
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));

      const sx = r * sinPhi * Math.cos(theta);
      const sy = r * cosPhi;
      const sz = r * sinPhi * Math.sin(theta);

      startPositions[i3] = sx;
      startPositions[i3 + 1] = sy;
      startPositions[i3 + 2] = sz;

      currentPositions[i3] = sx;
      currentPositions[i3 + 1] = sy;
      currentPositions[i3 + 2] = sz;

      // Target position on surface of elongated octahedron (25% along edges for crisp facets, 75% across faces)
      let tx = 0;
      let ty = 0;
      let tz = 0;
      if (i % 4 === 0) {
        const edge = edgesList[i % edgesList.length];
        const s = Math.random();
        tx = edge[0][0] + (edge[1][0] - edge[0][0]) * s;
        ty = edge[0][1] + (edge[1][1] - edge[0][1]) * s;
        tz = edge[0][2] + (edge[1][2] - edge[0][2]) * s;
      } else {
        const face = faces[i % 8];
        let u = Math.random();
        let v = Math.random();
        if (u + v > 1) {
          u = 1 - u;
          v = 1 - v;
        }
        const w = 1 - u - v;
        tx = w * face[0][0] + u * face[1][0] + v * face[2][0];
        ty = w * face[0][1] + u * face[1][1] + v * face[2][1];
        tz = w * face[0][2] + u * face[1][2] + v * face[2][2];
      }

      targetPositions[i3] = tx;
      targetPositions[i3 + 1] = ty;
      targetPositions[i3 + 2] = tz;

      // Each particle has a random delay (0 - 0.45) and swirl angle
      particleDelays[i] = Math.random() * 0.45;
      particleSwirls[i] = 1.35 + Math.random() * 1.65;
    }

    const particlesGeo = new THREE.BufferGeometry();
    const posAttribute = new THREE.BufferAttribute(currentPositions, 3);
    posAttribute.setUsage(THREE.DynamicDrawUsage);
    particlesGeo.setAttribute('position', posAttribute);

    const particlesMat = new THREE.PointsMaterial({
      color: 0xffd97a,
      size: 0.035,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const diamondPoints = new THREE.Points(particlesGeo, particlesMat);
    diamondPoints.frustumCulled = false;
    diamondGroup.add(diamondPoints);

    // -------------------------------------------------------------------------
    // 3. ~300 Faint Dim-Gold Dust Particles Floating in Background
    // -------------------------------------------------------------------------
    const dustPositions = new Float32Array(DUST_COUNT * 3);
    const dustSpeeds = new Float32Array(DUST_COUNT);
    const dustPhases = new Float32Array(DUST_COUNT);

    for (let i = 0; i < DUST_COUNT; i++) {
      const i3 = i * 3;
      dustPositions[i3] = (Math.random() - 0.5) * 14;
      dustPositions[i3 + 1] = (Math.random() - 0.5) * 12;
      dustPositions[i3 + 2] = -2 - Math.random() * 6;
      dustSpeeds[i] = 0.08 + Math.random() * 0.18;
      dustPhases[i] = Math.random() * Math.PI * 2;
    }

    const dustGeo = new THREE.BufferGeometry();
    const dustPosAttr = new THREE.BufferAttribute(dustPositions, 3);
    dustPosAttr.setUsage(THREE.DynamicDrawUsage);
    dustGeo.setAttribute('position', dustPosAttr);

    const dustMat = new THREE.PointsMaterial({
      color: 0xb88628,
      size: 0.028,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const dustPoints = new THREE.Points(dustGeo, dustMat);
    dustPoints.frustumCulled = false;
    scene.add(dustPoints);

    // -------------------------------------------------------------------------
    // 4. Pointer / Touch Parallax & Responsive Camera Z
    // -------------------------------------------------------------------------
    let targetParallaxX = 0;
    let targetParallaxY = 0;
    let currentParallaxX = 0;
    let currentParallaxY = 0;

    const handlePointerMove = (e: PointerEvent) => {
      const nx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      const ny = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
      targetParallaxX = nx * 0.32;
      targetParallaxY = -ny * 0.24;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const t = e.touches[0];
        const nx = (t.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
        const ny = (t.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
        targetParallaxX = nx * 0.32;
        targetParallaxY = -ny * 0.24;
      }
    };

    const handleResize = () => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      camera.aspect = w / h;
      camera.position.z = h > w ? 9 : 7;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('resize', handleResize, { passive: true });

    // -------------------------------------------------------------------------
    // 5. Animation Loop (60fps, Zero Per-Frame Allocations)
    // -------------------------------------------------------------------------
    let frameId = 0;
    const startTime = performance.now();
    let prevTime = startTime;
    let lastDisplayRounded = -1;
    let rotYAccumulator = 0;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      } else {
        frameId = window.setTimeout(cb, 80);
      }
    };

    const tick = () => {
      if (phaseRef.current === 'done') return;

      const now = performance.now();
      const dt = Math.min(0.05, (now - prevTime) / 1000);
      prevTime = now;
      const elapsedSec = (now - startTime) / 1000;

      // 1) Update loading progress (simulated ~3.4s with easing blended with real tasks)
      if (phaseRef.current === 'loading') {
        const rawSim = Math.min(1, (now - startTime) / SIMULATED_DURATION_MS);
        const simProgress = easeInOutCubic(rawSim);

        // If both real tasks (fonts + price) finished early, allow faster convergence after 1.6s beam growth
        const bothRealReady = realReadyCountRef.current >= 2 && elapsedSec > 1.6;
        const targetP = bothRealReady
          ? Math.max(simProgress, Math.min(1, (elapsedSec - 0.3) / 1.8))
          : Math.max(simProgress, realTargetRef.current * simProgress);

        progressRef.current += (targetP - progressRef.current) * Math.min(1, dt * 10);
        if (rawSim >= 0.995 || progressRef.current >= 0.996) {
          progressRef.current = 1;
        }

        const pct = Math.min(100, Math.round(progressRef.current * 100));
        if (pct !== lastDisplayRounded) {
          lastDisplayRounded = pct;
          setDisplayProgress(pct);
        }

        if (progressRef.current >= 1) {
          triggerSplitSequence(false);
        }
      }

      const p = progressRef.current;

      // Compute exit progress (0 -> 1 over 1.25s when splitting)
      let exitT = 0;
      if (phaseRef.current === 'splitting') {
        exitT = Math.min(1, Math.max(0, (now - splitStartTimeRef.current) / DOOR_SPLIT_DURATION_MS));
      }
      const exitEase = easeInOutCubic(exitT);

      // 2) Vertical Gold Light Beam: scaleY 0 -> 1 in 1.6s ease-out, fades during split
      const beamGrow = easeOutCubic(elapsedSec / 1.6);
      beamGroup.scale.set(1, Math.max(0.0001, beamGrow), 1);
      const beamPulse = 0.88 + Math.sin(elapsedSec * 4.0) * 0.12;
      const beamExitFade = 1 - Math.min(1, exitT * 1.6);
      coreBeamMat.opacity = 0.9 * beamPulse * beamExitFade;
      glowBeamMat.opacity = 0.24 * beamPulse * beamExitFade;

      // 3) Update 3200 Gold Particles (sphere -> swirl -> elongated octahedron surface)
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        const delay = particleDelays[i];
        const localRaw = (p - delay) / (1 - delay);
        const localClamped = localRaw <= 0 ? 0 : localRaw >= 1 ? 1 : localRaw;
        const e = easeInOutCubic(localClamped);

        const sx = startPositions[i3];
        const sy = startPositions[i3 + 1];
        const sz = startPositions[i3 + 2];

        const tx = targetPositions[i3];
        const ty = targetPositions[i3 + 1];
        const tz = targetPositions[i3 + 2];

        // Linear position interpolation before swirl rotation
        const lx = sx + (tx - sx) * e;
        const ly = sy + (ty - sy) * e;
        const lz = sz + (tz - sz) * e;

        // Small Y-rotation swirl that decreases to 0 as particle assembles
        const angle = (1 - e) * particleSwirls[i];
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        currentPositions[i3] = lx * cosA - lz * sinA;
        currentPositions[i3 + 1] = ly;
        currentPositions[i3 + 2] = lx * sinA + lz * cosA;
      }
      posAttribute.needsUpdate = true;

      // 4) Wireframe edges fade in at progress > 75%
      const wireFadeIn = p > 0.75 ? easeOutCubic((p - 0.75) / 0.25) : 0;
      const fadeOutExit = 1 - exitEase;
      edgesMat.opacity = wireFadeIn * 0.85 * fadeOutExit;
      particlesMat.opacity = 0.92 * fadeOutExit;

      // 5) Diamond rotation, X tilt, breathing scale,parallax, and exit scale-up toward camera
      currentParallaxX += (targetParallaxX - currentParallaxX) * Math.min(1, dt * 6);
      currentParallaxY += (targetParallaxY - currentParallaxY) * Math.min(1, dt * 6);

      rotYAccumulator += dt * 0.48;
      diamondGroup.rotation.y = rotYAccumulator + currentParallaxX * 0.85;
      diamondGroup.rotation.x = 0.18 + Math.sin(elapsedSec * 0.9) * 0.05 + currentParallaxY * 0.65;

      const breathScale = 1 + Math.sin(elapsedSec * 2.1) * 0.035;
      const exitScaleMultiplier = 1 + exitEase * 1.85;
      diamondGroup.scale.setScalar(breathScale * exitScaleMultiplier);
      diamondGroup.position.z = exitEase * 2.4;

      // 6) Update ~300 background dim-gold dust particles
      for (let i = 0; i < DUST_COUNT; i++) {
        const i3 = i * 3;
        dustPositions[i3 + 1] += dustSpeeds[i] * dt;
        dustPositions[i3] += Math.sin(elapsedSec * 0.6 + dustPhases[i]) * 0.06 * dt;
        if (dustPositions[i3 + 1] > 6) {
          dustPositions[i3 + 1] = -6;
        }
      }
      dustPosAttr.needsUpdate = true;
      dustMat.opacity = 0.32 * fadeOutExit;

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('resize', handleResize);

      // Clean up all geometries, materials, and renderer
      coreBeamGeo.dispose();
      coreBeamMat.dispose();
      glowBeamGeo.dispose();
      glowBeamMat.dispose();
      octaGeo.dispose();
      edgesGeo.dispose();
      edgesMat.dispose();
      particlesGeo.dispose();
      particlesMat.dispose();
      dustGeo.dispose();
      dustMat.dispose();

      renderer.dispose();
      if (canvasEl.parentNode === container) {
        container.removeChild(canvasEl);
      }
    };
  }, [reducedMotion, triggerSplitSequence]);

  const statusText = getStatusText(displayProgress);

  return (
    <div
      onClick={handleSkip}
      onTouchStart={handleSkip}
      role="button"
      tabIndex={0}
      aria-label="Skip intro animation"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
          handleSkip();
        }
      }}
      className={`fixed inset-0 z-50 flex items-center justify-center cursor-pointer select-none overflow-hidden transition-opacity duration-400 ${
        isSimpleFadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      {/* Left Vault Door */}
      <div
        className={`absolute top-0 bottom-0 left-0 w-1/2 bg-[#050505] border-r border-[#E8B84A]/25 z-10 will-change-transform ${
          isSplitting ? '-translate-x-full' : 'translate-x-0'
        }`}
        style={{
          transition: 'transform 1.25s cubic-bezier(0.76, 0, 0.16, 1)',
        }}
      >
        <div
          className={`absolute right-0 top-0 bottom-0 w-[1.5px] bg-gradient-to-b from-transparent via-[#FFD97A] to-transparent shadow-[0_0_18px_#E8B84A] transition-opacity duration-500 ${
            isSplitting ? 'opacity-0' : 'opacity-90'
          }`}
        />
      </div>

      {/* Right Vault Door */}
      <div
        className={`absolute top-0 bottom-0 right-0 w-1/2 bg-[#050505] border-l border-[#E8B84A]/25 z-10 will-change-transform ${
          isSplitting ? 'translate-x-full' : 'translate-x-0'
        }`}
        style={{
          transition: 'transform 1.25s cubic-bezier(0.76, 0, 0.16, 1)',
        }}
      >
        <div
          className={`absolute left-0 top-0 bottom-0 w-[1.5px] bg-gradient-to-b from-transparent via-[#FFD97A] to-transparent shadow-[0_0_18px_#E8B84A] transition-opacity duration-500 ${
            isSplitting ? 'opacity-0' : 'opacity-90'
          }`}
        />
      </div>

      {/* Three.js WebGL Viewport Container */}
      <div
        ref={mountRef}
        className="absolute inset-0 z-20 pointer-events-none w-full h-full"
      />

      {/* Existing Loading Text & Progress Bar Layout */}
      <div
        className={`relative z-30 flex flex-col items-center justify-end h-full w-full max-w-xs px-6 pb-12 sm:pb-16 pointer-events-none transition-all duration-500 ${
          isSplitting ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
        }`}
      >
        {/* Brand Name Typography: SARRAF ◆ XAU/USD */}
        <div className="flex items-center gap-2.5 mb-3.5">
          <span className="font-mono text-sm tracking-[0.35em] font-bold text-white">
            SARRAF
          </span>
          <span className="text-[#FFD97A] text-[10px] leading-none">◆</span>
          <span className="font-mono text-[10px] tracking-widest text-[#E8B84A]/90">
            XAU/USD
          </span>
        </div>

        {/* Thin Gold Progress Bar */}
        <div className="relative w-full h-[1.5px] bg-white/10 rounded-full overflow-hidden">
          <div
            className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-[#B88628] via-[#FFD97A] to-[#E8B84A] transition-all duration-75 ease-out shadow-[0_0_12px_#E8B84A]"
            style={{ width: `${displayProgress}%` }}
          />
        </div>

        {/* Status Text & Percentage Readout */}
        <div className="w-full mt-3 flex justify-between items-center text-[10px] font-mono text-neutral-400 tabular-nums">
          <span className="tracking-widest">{statusText}</span>
          <span className="text-[#FFD97A] font-bold">{displayProgress}%</span>
        </div>

        <span className="mt-4 text-[9px] font-mono tracking-widest text-neutral-500 uppercase">
          TAP TO SKIP
        </span>
      </div>
    </div>
  );
};

export default IntroDiamond;
