import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

export interface IntroDiamondProps {
  onComplete?: () => void;
  /** Alias for compatibility with existing Preloader prop signature */
  onLoaded?: () => void;
  /**
   * When true, LandingPage's persistent Three.js canvas renders the 4800 particles
   * so the intro-to-hero handoff has zero cut or re-initialization.
   */
  sharedCanvas?: boolean;
  /**
   * Reports normalized assembly progress (0..1) and punchprogress (0..1) to a shared scene.
   */
  onStateUpdate?: (assembleP: number, punchP: number, beamFlash: number) => void;
}

export const INTRO_PARTICLE_COUNT = 4800;
const INTRO_DURATION_MS = 3600;
const PAUSE_AT_100_MS = 350;
const REVEAL_PUNCH_MS = 650;
const WATCHDOG_TIMEOUT_MS = 7000;

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
  if (progress >= 68) return 'Calibrating signals';
  if (progress >= 34) return 'Syncing XAU/USD feed';
  return 'Connecting to live market';
}

function createSoftParticleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 248, 220, 1)');
    grad.addColorStop(0.28, 'rgba(255, 217, 122, 0.85)');
    grad.addColorStop(0.65, 'rgba(232, 184, 74, 0.22)');
    grad.addColorStop(1, 'rgba(184, 134, 40, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export const IntroDiamond: React.FC<IntroDiamondProps> = ({
  onComplete,
  onLoaded,
  sharedCanvas = false,
  onStateUpdate,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  const [displayProgress, setDisplayProgress] = useState<number>(0);
  const [isRevealing, setIsRevealing] = useState<boolean>(false);
  const [beamFlashActive, setBeamFlashActive] = useState<boolean>(false);

  // CRITICAL: Keep all callbacks and environment flags in refs so parent re-renders
  // NEVER restart the intro effect or reset progress.
  const onCompleteRef = useRef(onComplete);
  const onLoadedRef = useRef(onLoaded);
  const onStateUpdateRef = useRef(onStateUpdate);
  const sharedCanvasRef = useRef(sharedCanvas);
  const reducedMotionRef = useRef<boolean>(
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );

  useEffect(() => {
    onCompleteRef.current = onComplete;
    onLoadedRef.current = onLoaded;
    onStateUpdateRef.current = onStateUpdate;
    sharedCanvasRef.current = sharedCanvas;
  }, [onComplete, onLoaded, onStateUpdate, sharedCanvas]);

  const phaseRef = useRef<'loading' | 'pausing' | 'punching' | 'done'>('loading');
  const progressRef = useRef<number>(0);
  const pauseStartRef = useRef<number>(0);
  const punchStartRef = useRef<number>(0);
  const hasCompletedRef = useRef<boolean>(false);
  const skipRequestedRef = useRef<boolean>(false);

  const completeOnce = useCallback(() => {
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

    onStateUpdateRef.current?.(1, 1, 0);
    onLoadedRef.current?.();
    onCompleteRef.current?.();
  }, []);

  const handleSkip = useCallback(() => {
    if (phaseRef.current === 'done' || phaseRef.current === 'punching') return;
    skipRequestedRef.current = true;
  }, []);

  // Stable single-run effect (empty dependency array []) so parent re-renders NEVER restart the intro
  useEffect(() => {
    // 7s Watchdog timer that force-completes no matter what
    const watchdogId = window.setTimeout(() => {
      completeOnce();
    }, WATCHDOG_TIMEOUT_MS);

    const startTime = performance.now();
    let prevTime = startTime;
    let rafId = 0;
    let lastPct = -1;

    // If sharedCanvas is true, LandingPage owns the WebGL canvas and we drive progress + punch state
    if (sharedCanvasRef.current || reducedMotionRef.current) {
      const duration = reducedMotionRef.current ? 750 : INTRO_DURATION_MS;

      const stepShared = (now: number) => {
        if (hasCompletedRef.current) return;

        if (skipRequestedRef.current && phaseRef.current === 'loading') {
          progressRef.current = 1;
          setDisplayProgress(100);
          phaseRef.current = 'punching';
          punchStartRef.current = now;
          setBeamFlashActive(true);
          setIsRevealing(true);
        }

        if (phaseRef.current === 'loading') {
          const raw = Math.min(1, (now - startTime) / duration);
          const eased = easeInOutCubic(raw);
          progressRef.current = eased;

          const pct = Math.min(100, Math.round(eased * 100));
          if (pct !== lastPct) {
            lastPct = pct;
            setDisplayProgress(pct);
          }

          onStateUpdateRef.current?.(eased, 0, 0);

          if (raw >= 1) {
            progressRef.current = 1;
            setDisplayProgress(100);
            if (reducedMotionRef.current) {
              setIsRevealing(true);
              completeOnce();
              return;
            }
            phaseRef.current = 'pausing';
            pauseStartRef.current = now;
            setBeamFlashActive(true);
          }
        } else if (phaseRef.current === 'pausing') {
          const pauseElapsed = now - pauseStartRef.current;
          const flashIntensity = Math.sin(Math.min(1, pauseElapsed / PAUSE_AT_100_MS) * Math.PI);
          onStateUpdateRef.current?.(1, 0, flashIntensity);

          if (pauseElapsed >= PAUSE_AT_100_MS || skipRequestedRef.current) {
            phaseRef.current = 'punching';
            punchStartRef.current = now;
            setIsRevealing(true);
          }
        } else if (phaseRef.current === 'punching') {
          const punchT = Math.min(1, (now - punchStartRef.current) / REVEAL_PUNCH_MS);
          const punchEase = easeOutCubic(punchT);
          onStateUpdateRef.current?.(1, punchEase, Math.max(0, 1 - punchT * 1.5));

          if (punchT >= 1) {
            completeOnce();
            return;
          }
        }

        rafId = requestAnimationFrame(stepShared);
      };

      rafId = requestAnimationFrame(stepShared);
      return () => {
        window.clearTimeout(watchdogId);
        cancelAnimationFrame(rafId);
      };
    }

    // Standalone Three.js WebGL scene (used when IntroDiamond is mounted standalone)
    const container = mountRef.current;
    if (!container) {
      completeOnce();
      return () => window.clearTimeout(watchdogId);
    }

    const isLowEnd = (() => {
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
    const baseCamZ = isPortrait ? 9.2 : 7.4;
    camera.position.set(0, 0, baseCamZ);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: !isLowEnd,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(isLowEnd ? 1 : Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);

    const canvasEl = renderer.domElement;
    canvasEl.style.display = 'block';
    canvasEl.style.width = '100%';
    canvasEl.style.height = '100%';
    container.appendChild(canvasEl);

    // 1. Vertical Gold Light Beam
    const beamGroup = new THREE.Group();
    scene.add(beamGroup);

    const coreBeamGeo = new THREE.PlaneGeometry(0.024, 18);
    const coreBeamMat = new THREE.MeshBasicMaterial({
      color: 0xffd97a,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    beamGroup.add(new THREE.Mesh(coreBeamGeo, coreBeamMat));

    const glowBeamGeo = new THREE.PlaneGeometry(0.34, 18);
    const glowBeamMat = new THREE.MeshBasicMaterial({
      color: 0xe8b84a,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    beamGroup.add(new THREE.Mesh(glowBeamGeo, glowBeamMat));
    beamGroup.scale.set(1, 0.0001, 1);

    // 2. 4800 Gold Particles + Fake Bloom Glow Layer + Elongated Octahedron Wireframe
    const diamondGroup = new THREE.Group();
    scene.add(diamondGroup);

    const diamondRadius = 1.45;
    const diamondYScale = 1.5;

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
    diamondGroup.add(new THREE.LineSegments(edgesGeo, edgesMat));

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

    const startPositions = new Float32Array(INTRO_PARTICLE_COUNT * 3);
    const targetPositions = new Float32Array(INTRO_PARTICLE_COUNT * 3);
    const currentPositions = new Float32Array(INTRO_PARTICLE_COUNT * 3);
    const colors = new Float32Array(INTRO_PARTICLE_COUNT * 3);
    const delays = new Float32Array(INTRO_PARTICLE_COUNT);
    const swirls = new Float32Array(INTRO_PARTICLE_COUNT);

    const palette = [
      new THREE.Color(0xffd97a),
      new THREE.Color(0xe8b84a),
      new THREE.Color(0xb88628),
    ];

    for (let i = 0; i < INTRO_PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      const r = 3.8 + Math.random() * 5.2;
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

      const c = palette[i % palette.length];
      colors[i3] = c.r;
      colors[i3 + 1] = c.g;
      colors[i3 + 2] = c.b;

      delays[i] = Math.random() * 0.44;
      swirls[i] = 1.4 + Math.random() * 1.6;
    }

    const particlesGeo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(currentPositions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    particlesGeo.setAttribute('position', posAttr);
    particlesGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const spriteTex = createSoftParticleTexture();

    const corePointsMat = new THREE.PointsMaterial({
      size: 0.055,
      map: spriteTex,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const glowPointsMat = new THREE.PointsMaterial({
      size: 0.16,
      map: spriteTex,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const corePoints = new THREE.Points(particlesGeo, corePointsMat);
    const glowPoints = new THREE.Points(particlesGeo, glowPointsMat);
    corePoints.frustumCulled = false;
    glowPoints.frustumCulled = false;
    diamondGroup.add(corePoints);
    diamondGroup.add(glowPoints);

    const handleResize = () => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize, { passive: true });

    let rotY = 0;

    const tick = (now: number) => {
      if (hasCompletedRef.current) return;

      if (document.hidden) {
        prevTime = now;
        rafId = requestAnimationFrame(tick);
        return;
      }

      const dt = Math.min(0.05, (now - prevTime) / 1000);
      prevTime = now;
      const elapsedSec = (now - startTime) / 1000;

      if (skipRequestedRef.current && phaseRef.current === 'loading') {
        progressRef.current = 1;
        setDisplayProgress(100);
        phaseRef.current = 'punching';
        punchStartRef.current = now;
        setBeamFlashActive(true);
        setIsRevealing(true);
      }

      if (phaseRef.current === 'loading') {
        const raw = Math.min(1, (now - startTime) / INTRO_DURATION_MS);
        const eased = easeInOutCubic(raw);
        progressRef.current = eased;

        const pct = Math.min(100, Math.round(eased * 100));
        if (pct !== lastPct) {
          lastPct = pct;
          setDisplayProgress(pct);
        }

        if (raw >= 1) {
          progressRef.current = 1;
          setDisplayProgress(100);
          phaseRef.current = 'pausing';
          pauseStartRef.current = now;
          setBeamFlashActive(true);
        }
      } else if (phaseRef.current === 'pausing') {
        if (now - pauseStartRef.current >= PAUSE_AT_100_MS || skipRequestedRef.current) {
          phaseRef.current = 'punching';
          punchStartRef.current = now;
          setIsRevealing(true);
        }
      }

      let punchEase = 0;
      if (phaseRef.current === 'punching') {
        const punchT = Math.min(1, (now - punchStartRef.current) / REVEAL_PUNCH_MS);
        punchEase = easeOutCubic(punchT);
        if (punchT >= 1) {
          completeOnce();
          return;
        }
      }

      const p = progressRef.current;

      // Update vertical gold light beam
      const beamGrow = easeOutCubic(elapsedSec / 1.6);
      beamGroup.scale.set(1 + punchEase * 2.5, Math.max(0.0001, beamGrow), 1);
      const flashBoost = phaseRef.current === 'pausing' ? 1.6 : 1.0;
      coreBeamMat.opacity = 0.92 * flashBoost * (1 - punchEase);
      glowBeamMat.opacity = 0.28 * flashBoost * (1 - punchEase);

      // Update 4800 particles
      for (let i = 0; i < INTRO_PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        const delay = delays[i];
        const localRaw = (p - delay) / (1 - delay);
        const localClamped = localRaw <= 0 ? 0 : localRaw >= 1 ? 1 : localRaw;
        const e = easeInOutCubic(localClamped);

        const lx = startPositions[i3] + (targetPositions[i3] - startPositions[i3]) * e;
        const ly = startPositions[i3 + 1] + (targetPositions[i3 + 1] - startPositions[i3 + 1]) * e;
        const lz = startPositions[i3 + 2] + (targetPositions[i3 + 2] - startPositions[i3 + 2]) * e;

        const angle = (1 - e) * swirls[i];
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        currentPositions[i3] = lx * cosA - lz * sinA;
        currentPositions[i3 + 1] = ly;
        currentPositions[i3 + 2] = lx * sinA + lz * cosA;
      }
      posAttr.needsUpdate = true;

      const wireFade = p > 0.72 ? easeOutCubic((p - 0.72) / 0.28) : 0;
      edgesMat.opacity = wireFade * 0.75 * (1 - punchEase);

      rotY += dt * 0.52;
      diamondGroup.rotation.y = rotY;
      diamondGroup.rotation.x = 0.16 + Math.sin(elapsedSec * 0.9) * 0.04;

      // Camera push-in punch at 100%
      camera.position.z = baseCamZ - punchEase * 2.2;

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      window.clearTimeout(watchdogId);
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);

      coreBeamGeo.dispose();
      coreBeamMat.dispose();
      glowBeamGeo.dispose();
      glowBeamMat.dispose();
      octaGeo.dispose();
      edgesGeo.dispose();
      edgesMat.dispose();
      particlesGeo.dispose();
      corePointsMat.dispose();
      glowPointsMat.dispose();
      spriteTex.dispose();
      renderer.dispose();

      if (canvasEl.parentNode === container) {
        container.removeChild(canvasEl);
      }
    };
  }, [completeOnce]);

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
      className={`fixed inset-0 z-50 flex items-center justify-center cursor-pointer select-none overflow-hidden transition-opacity duration-600 ${
        isRevealing ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{
        backgroundColor: sharedCanvas ? 'transparent' : '#050505',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      {/* Standalone WebGL mount when not sharing LandingPage's canvas */}
      {!sharedCanvas && (
        <div
          ref={mountRef}
          className="absolute inset-0 z-10 pointer-events-none w-full h-full"
        />
      )}

      {/* Growing vertical gold light beam overlay (for sharedCanvas & flash boost) */}
      <div
        className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 z-20 flex items-center justify-center transition-opacity duration-500"
        style={{
          opacity: isRevealing ? 0 : 1,
        }}
      >
        <div
          className="w-[1.5px] h-full bg-gradient-to-b from-transparent via-[#FFD97A] to-transparent transition-transform duration-700 ease-out"
          style={{
            transform: `scaleY(${Math.max(0.08, displayProgress / 100)})`,
            boxShadow: beamFlashActive
              ? '0 0 38px 6px rgba(255, 217, 122, 0.95), 0 0 80px 16px rgba(232, 184, 74, 0.65)'
              : '0 0 18px 2px rgba(232, 184, 74, 0.55)',
          }}
        />
      </div>

      {/* Loading HUD: SARRAF ◆ XAU/USD, thin gold bar, status text, percentage, TAP TO SKIP */}
      <div
        className={`relative z-30 flex flex-col items-center justify-end h-full w-full max-w-xs px-6 pb-12 sm:pb-16 pointer-events-none transition-all duration-500 ${
          isRevealing ? 'opacity-0 translate-y-3' : 'opacity-100 translate-y-0'
        }`}
      >
        <div className="flex items-center gap-2.5 mb-3.5">
          <span className="font-mono text-sm tracking-[0.35em] font-bold text-white">
            SARRAF
          </span>
          <span className="text-[#FFD97A] text-[10px] leading-none">◆</span>
          <span className="font-mono text-[10px] tracking-widest text-[#E8B84A]/90">
            XAU/USD
          </span>
        </div>

        <div className="relative w-full h-[1.5px] bg-white/10 rounded-full overflow-hidden">
          <div
            className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-[#B88628] via-[#FFD97A] to-[#E8B84A] transition-all duration-75 ease-out shadow-[0_0_12px_#E8B84A]"
            style={{ width: `${displayProgress}%` }}
          />
        </div>

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
