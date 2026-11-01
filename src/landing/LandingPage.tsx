import React, { useEffect, useRef, useState, useCallback, useMemo, Suspense, lazy } from 'react';
import * as THREE from 'three';
import { useMarket } from '../context/MarketContext';
import { IntroDiamond } from '../components/IntroDiamond';
import { LiveMarketCard } from '../components/LiveMarketCard';
import { MarketSessionsClock } from '../components/MarketSessionsClock';
import { openTelegram } from '../lib/telegramConfig';
import {
  ArrowUpRight,
  Send,
  ShieldCheck,
  Radio,
  Sparkles,
  LockOpen,
  TrendingUp,
  TrendingDown,
  Clock,
  Zap,
} from 'lucide-react';

const LazyFaqSection = lazy(() => import('../components/FaqSection'));

// ============================================================================
// TOP 5 TUNABLE CONSTANTS (sarraf-premium specification)
// ============================================================================
export const PARTICLE_COUNT = 4800; // 1) Total morphing gold particles across all 6 chapters
export const TRAVEL_PER_CHAPTER = 12; // 2) Camera -Z travel distance per chapter (total 60 world units)
export const TERRAIN_OPACITY = 0.42; // 3) Peak opacity of the gold wireframe shader valley terrain
export const FOV_KICK_STRENGTH = 9; // 4) Scroll-velocity FOV widening multiplier (clamped to +15 deg)
export const SCROLL_LERP_DAMPING = 5.5; // 5) Exponential scroll smoothing factor: 1 - exp(-dt * 5.5)

const TERRAIN_AMPS_BY_CHAPTER = [0.7, 1.5, 1.0, 1.3, 0.9, 0.5];
const CHAPTER_META = [
  { index: 0, code: '01 / 06 — HERO', short: 'HERO', numeral: '79' },
  { index: 1, code: '02 / 06 — LIVE MARKET', short: 'MARKET', numeral: '01' },
  { index: 2, code: '03 / 06 — PRECISION', short: 'PRECISION', numeral: '02' },
  { index: 3, code: '04 / 06 — NEWS RADAR', short: 'RADAR', numeral: '03' },
  { index: 4, code: '05 / 06 — TELEGRAM', short: 'TELEGRAM', numeral: '04' },
  { index: 5, code: '06 / 06 — FINALE', short: 'VAULT', numeral: 'Au' },
];

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function easeInOutCubic(x: number): number {
  const t = clamp(x, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Procedural soft radial sprite texture for additive gold points
function createGoldRadialSprite(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255, 250, 228, 1)');
    g.addColorStop(0.26, 'rgba(255, 217, 122, 0.88)');
    g.addColorStop(0.62, 'rgba(232, 184, 74, 0.25)');
    g.addColorStop(1, 'rgba(184, 134, 40, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Precompute all 6 chapter shapes + scattered intro sphere + per-particle burst vectors
function buildMorphShapes(count: number) {
  const shapes: Float32Array[] = [
    new Float32Array(count * 3), // 0: Elongated octahedron diamond (Hero)
    new Float32Array(count * 3), // 1: Gold ingot / beveled bar box (Live Market)
    new Float32Array(count * 3), // 2: Torus ring (Precision)
    new Float32Array(count * 3), // 3: Globe with latitude rings (News Radar)
    new Float32Array(count * 3), // 4: Double helix (Telegram)
    new Float32Array(count * 3), // 5: Concentric vault rings with radial spokes (Finale)
  ];

  const introScatter = new Float32Array(count * 3);
  const burstVectors = new Float32Array(count * 3);
  const delays = new Float32Array(count);
  const swirls = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  const palette = [
    new THREE.Color(0xffd97a),
    new THREE.Color(0xe8b84a),
    new THREE.Color(0xb88628),
  ];

  // Octahedron faces & edges for Shape 0 (Hero Diamond)
  const rad0 = 1.48;
  const yScale0 = 1.52;
  const topV = [0, rad0 * yScale0, 0];
  const botV = [0, -rad0 * yScale0, 0];
  const eqV = [
    [rad0, 0, 0],
    [0, 0, rad0],
    [-rad0, 0, 0],
    [0, 0, -rad0],
  ];
  const faces0: number[][][] = [
    [topV, eqV[0], eqV[1]],
    [topV, eqV[1], eqV[2]],
    [topV, eqV[2], eqV[3]],
    [topV, eqV[3], eqV[0]],
    [botV, eqV[1], eqV[0]],
    [botV, eqV[2], eqV[1]],
    [botV, eqV[3], eqV[2]],
    [botV, eqV[0], eqV[3]],
  ];
  const edges0: number[][][] = [
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

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const uRand = (i + 0.5) / count;

    // Intro scattered sphere (radius 3.8..8.8)
    const sr = 3.8 + Math.random() * 5.0;
    const sTheta = Math.random() * Math.PI * 2;
    const sCosPhi = 2 * Math.random() - 1;
    const sSinPhi = Math.sqrt(Math.max(0, 1 - sCosPhi * sCosPhi));
    introScatter[i3] = sr * sSinPhi * Math.cos(sTheta);
    introScatter[i3 + 1] = sr * sCosPhi;
    introScatter[i3 + 2] = sr * sSinPhi * Math.sin(sTheta);

    // Mid-transition burst / dispersion vector
    const br = 0.65 + Math.random() * 1.35;
    const bTheta = Math.random() * Math.PI * 2;
    const bCos = 2 * Math.random() - 1;
    const bSin = Math.sqrt(Math.max(0, 1 - bCos * bCos));
    burstVectors[i3] = br * bSin * Math.cos(bTheta);
    burstVectors[i3 + 1] = br * bCos;
    burstVectors[i3 + 2] = br * bSin * Math.sin(bTheta);

    delays[i] = Math.random() * 0.36;
    swirls[i] = 1.45 + Math.random() * 1.55;

    const col = palette[i % palette.length];
    colors[i3] = col.r;
    colors[i3 + 1] = col.g;
    colors[i3 + 2] = col.b;

    // ------------------------------------------------------------------------
    // SHAPE 0: Elongated Octahedron Diamond (Hero)
    // ------------------------------------------------------------------------
    if (i % 4 === 0) {
      const edge = edges0[i % edges0.length];
      const s = Math.random();
      shapes[0][i3] = edge[0][0] + (edge[1][0] - edge[0][0]) * s;
      shapes[0][i3 + 1] = edge[0][1] + (edge[1][1] - edge[0][1]) * s;
      shapes[0][i3 + 2] = edge[0][2] + (edge[1][2] - edge[0][2]) * s;
    } else {
      const face = faces0[i % 8];
      let u = Math.random();
      let v = Math.random();
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      const w = 1 - u - v;
      shapes[0][i3] = w * face[0][0] + u * face[1][0] + v * face[2][0];
      shapes[0][i3 + 1] = w * face[0][1] + u * face[1][1] + v * face[2][1];
      shapes[0][i3 + 2] = w * face[0][2] + u * face[1][2] + v * face[2][2];
    }

    // ------------------------------------------------------------------------
    // SHAPE 1: Gold Ingot / Beveled Bullion Bar (Live Market)
    // ------------------------------------------------------------------------
    const barW = 1.35;
    const barH = 2.15;
    const barD = 0.62;
    const facePick = i % 6;
    let bx = (Math.random() - 0.5) * 2 * barW;
    let by = (Math.random() - 0.5) * 2 * barH;
    let bz = (Math.random() - 0.5) * 2 * barD;
    if (facePick === 0) bz = barD;
    else if (facePick === 1) bz = -barD;
    else if (facePick === 2) bx = barW;
    else if (facePick === 3) bx = -barW;
    else if (facePick === 4) by = barH;
    else by = -barH;
    // Trapezoidal bullion taper on front face
    const taper = bz > 0 ? 0.84 : 1.0;
    shapes[1][i3] = bx * taper;
    shapes[1][i3 + 1] = by * (bz > 0 ? 0.92 : 1.0);
    shapes[1][i3 + 2] = bz;

    // ------------------------------------------------------------------------
    // SHAPE 2: Precision Torus Ring (Precision)
    // ------------------------------------------------------------------------
    const majorR = 1.55;
    const minorR = 0.46;
    const uTorus = uRand * Math.PI * 2 * 13;
    const vTorus = ((i * 7) % count) / count * Math.PI * 2;
    shapes[2][i3] = (majorR + minorR * Math.cos(vTorus)) * Math.cos(uTorus);
    shapes[2][i3 + 1] = (majorR + minorR * Math.cos(vTorus)) * Math.sin(uTorus);
    shapes[2][i3 + 2] = minorR * Math.sin(vTorus);

    // ------------------------------------------------------------------------
    // SHAPE 3: Globe with Latitude Rings (News Radar)
    // ------------------------------------------------------------------------
    const globeR = 1.72;
    if (i % 3 === 0) {
      // Crisp latitude rings
      const latBands = [-0.65, -0.35, 0, 0.35, 0.65];
      const sinLat = latBands[i % latBands.length];
      const cosLat = Math.sqrt(Math.max(0, 1 - sinLat * sinLat));
      const lon = Math.random() * Math.PI * 2;
      shapes[3][i3] = globeR * cosLat * Math.cos(lon);
      shapes[3][i3 + 1] = globeR * sinLat;
      shapes[3][i3 + 2] = globeR * cosLat * Math.sin(lon);
    } else {
      // Fibonacci sphere distribution
      const phi = Math.acos(1 - 2 * uRand);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      shapes[3][i3] = globeR * Math.sin(phi) * Math.cos(theta);
      shapes[3][i3 + 1] = globeR * Math.cos(phi);
      shapes[3][i3 + 2] = globeR * Math.sin(phi) * Math.sin(theta);
    }

    // ------------------------------------------------------------------------
    // SHAPE 4: Double Helix (Telegram)
    // ------------------------------------------------------------------------
    const helixH = 4.2;
    const helixR = 1.15;
    const turns = 3.2;
    const strand = i % 2;
    const isRung = i % 9 === 0;
    const hNorm = Math.random();
    const hy = (hNorm - 0.5) * helixH;
    const hAngle = hNorm * Math.PI * 2 * turns + (strand === 0 ? 0 : Math.PI);
    if (isRung) {
      const rungLerp = Math.random() * 2 - 1;
      shapes[4][i3] = Math.cos(hAngle) * helixR * rungLerp;
      shapes[4][i3 + 1] = hy;
      shapes[4][i3 + 2] = Math.sin(hAngle) * helixR * rungLerp;
    } else {
      const jitter = (Math.random() - 0.5) * 0.12;
      shapes[4][i3] = Math.cos(hAngle) * (helixR + jitter);
      shapes[4][i3 + 1] = hy;
      shapes[4][i3 + 2] = Math.sin(hAngle) * (helixR + jitter);
    }

    // ------------------------------------------------------------------------
    // SHAPE 5: Concentric Vault Rings with Radial Spokes (Finale)
    // ------------------------------------------------------------------------
    if (i % 5 === 0) {
      // 12 radial vault locking spokes
      const spokeIdx = i % 12;
      const spokeAngle = (spokeIdx / 12) * Math.PI * 2;
      const spokeDist = 0.35 + Math.random() * 2.05;
      shapes[5][i3] = Math.cos(spokeAngle) * spokeDist;
      shapes[5][i3 + 1] = Math.sin(spokeAngle) * spokeDist;
      shapes[5][i3 + 2] = (Math.random() - 0.5) * 0.14;
    } else {
      const ringRadii = [0.65, 1.15, 1.68, 2.22];
      const ringR = ringRadii[i % ringRadii.length] + (Math.random() - 0.5) * 0.06;
      const rAngle = Math.random() * Math.PI * 2;
      shapes[5][i3] = Math.cos(rAngle) * ringR;
      shapes[5][i3 + 1] = Math.sin(rAngle) * ringR;
      shapes[5][i3 + 2] = (Math.random() - 0.5) * 0.18;
    }
  }

  return { shapes, introScatter, burstVectors, delays, swirls, colors };
}

export const LandingPage: React.FC = () => {
  const { priceData, macroEvents, openLoginModal } = useMarket();

  // Session-aware intro state
  const [introComplete, setIntroComplete] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        return sessionStorage.getItem('sarraf_preloader_seen') === 'true';
      } catch {
        return false;
      }
    }
    return false;
  });

  const [isLiteMode, setIsLiteMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  });

  const [activeChapterIdx, setActiveChapterIdx] = useState<number>(0);
  const [depthMeters, setDepthMeters] = useState<number>(0);

  // Refs for DOM elements driven directly in the 60fps loop without React re-renders
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const wrapRefs = useRef<(HTMLDivElement | null)[]>([]);
  const numeralRefs = useRef<(HTMLDivElement | null)[]>([]);
  const marqueeTrackRef = useRef<HTMLDivElement>(null);

  // Mutable animation state shared between IntroDiamond and the persistent Three.js canvas
  const introStateRef = useRef({
    assembleP: introComplete ? 1 : 0,
    punchP: introComplete ? 1 : 0,
    beamFlash: 0,
  });

  const handleIntroStateUpdate = useCallback(
    (assembleP: number, punchP: number, beamFlash: number) => {
      introStateRef.current.assembleP = assembleP;
      introStateRef.current.punchP = punchP;
      introStateRef.current.beamFlash = beamFlash;
    },
    []
  );

  const handleIntroComplete = useCallback(() => {
    introStateRef.current.assembleP = 1;
    introStateRef.current.punchP = 1;
    introStateRef.current.beamFlash = 0;
    setIntroComplete(true);
  }, []);

  const scrollToChapter = useCallback((idx: number) => {
    const targetEl = sectionRefs.current[idx];
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (typeof window !== 'undefined') {
      window.scrollTo({
        top: idx * window.innerHeight,
        behavior: 'smooth',
      });
    }
  }, []);

  // IntersectionObserver for headline line masks and .rv fade/blur/translate items
  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
          }
        }
      },
      { threshold: 0.18 }
    );

    sectionRefs.current.forEach((sec) => {
      if (sec) io.observe(sec);
    });

    const rvNodes = document.querySelectorAll('.rv');
    rvNodes.forEach((node) => io.observe(node));

    return () => io.disconnect();
  }, []);

  // ==========================================================================
  // Persistent Full-Screen Vanilla Three.js Scene + Scroll Choreography Loop
  // ==========================================================================
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Detect low-end / software WebGL for pixelRatio cap
    const isLowEndGl = (() => {
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

    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let spriteTex: THREE.CanvasTexture | null = null;
    let particlesGeo: THREE.BufferGeometry | null = null;
    let posAttr: THREE.BufferAttribute | null = null;
    let corePointsMat: THREE.PointsMaterial | null = null;
    let glowPointsMat: THREE.PointsMaterial | null = null;
    let objectGroup: THREE.Group | null = null;
    let orbitRingsGroup: THREE.Group | null = null;
    let orbitMat1: THREE.LineBasicMaterial | null = null;
    let orbitMat2: THREE.LineBasicMaterial | null = null;
    let terrainMesh: THREE.Mesh | null = null;
    let terrainMat: THREE.ShaderMaterial | null = null;
    const gateMeshes: { line: THREE.LineLoop; mat: THREE.LineBasicMaterial; z: number }[] = [];
    const shardMeshes: { mesh: THREE.LineSegments; baseZ: number; rotSpeed: number }[] = [];
    const disposableGeometries: THREE.BufferGeometry[] = [];
    const disposableMaterials: THREE.Material[] = [];

    const morphData = buildMorphShapes(PARTICLE_COUNT);
    const currentPositions = new Float32Array(PARTICLE_COUNT * 3);

    if (!isLiteMode) {
      const width = window.innerWidth || 1;
      const height = window.innerHeight || 1;

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 120);
      camera.position.set(0, 0, 8);

      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: !isLowEndGl,
        powerPreference: 'high-performance',
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setPixelRatio(
        isLowEndGl ? 1.0 : Math.min(window.devicePixelRatio || 1, 1.75)
      );
      renderer.setSize(width, height);
      renderer.setClearColor(0x050505, 1);

      const canvasEl = renderer.domElement;
      canvasEl.style.display = 'block';
      canvasEl.style.width = '100%';
      canvasEl.style.height = '100%';
      container.appendChild(canvasEl);

      // ----------------------------------------------------------------------
      // 1. 4800-Particle Morphing System + Fake Bloom Glow Layer
      // ----------------------------------------------------------------------
      objectGroup = new THREE.Group();
      scene.add(objectGroup);

      particlesGeo = new THREE.BufferGeometry();
      posAttr = new THREE.BufferAttribute(currentPositions, 3);
      posAttr.setUsage(THREE.DynamicDrawUsage);
      particlesGeo.setAttribute('position', posAttr);
      particlesGeo.setAttribute(
        'color',
        new THREE.BufferAttribute(morphData.colors, 3)
      );
      disposableGeometries.push(particlesGeo);

      spriteTex = createGoldRadialSprite();

      corePointsMat = new THREE.PointsMaterial({
        size: 0.056,
        map: spriteTex,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.94,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      glowPointsMat = new THREE.PointsMaterial({
        size: 0.165,
        map: spriteTex,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      disposableMaterials.push(corePointsMat, glowPointsMat);

      const corePoints = new THREE.Points(particlesGeo, corePointsMat);
      const glowPoints = new THREE.Points(particlesGeo, glowPointsMat);
      corePoints.frustumCulled = false;
      glowPoints.frustumCulled = false;
      objectGroup.add(corePoints);
      objectGroup.add(glowPoints);

      // ----------------------------------------------------------------------
      // 2. Orbit Rings around Hero (ch 0) & Finale (ch 5)
      // ----------------------------------------------------------------------
      orbitRingsGroup = new THREE.Group();
      objectGroup.add(orbitRingsGroup);

      const createRingGeo = (radius: number, segs = 96) => {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
        }
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        disposableGeometries.push(g);
        return g;
      };

      orbitMat1 = new THREE.LineBasicMaterial({
        color: 0xe8b84a,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      orbitMat2 = new THREE.LineBasicMaterial({
        color: 0xffd97a,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      disposableMaterials.push(orbitMat1, orbitMat2);

      const ring1 = new THREE.LineLoop(createRingGeo(2.25), orbitMat1);
      ring1.rotation.x = Math.PI * 0.38;
      ring1.rotation.y = Math.PI * 0.12;
      orbitRingsGroup.add(ring1);

      const ring2 = new THREE.LineLoop(createRingGeo(2.68), orbitMat2);
      ring2.rotation.x = -Math.PI * 0.32;
      ring2.rotation.y = -Math.PI * 0.22;
      orbitRingsGroup.add(ring2);

      // ----------------------------------------------------------------------
      // 3. 9 Diamond-Shaped Wireframe Gates along -Z
      // ----------------------------------------------------------------------
      const gatePts = [
        new THREE.Vector3(0, 4.4, 0),
        new THREE.Vector3(3.4, 0, 0),
        new THREE.Vector3(0, -4.4, 0),
        new THREE.Vector3(-3.4, 0, 0),
      ];
      const sharedGateGeo = new THREE.BufferGeometry().setFromPoints(gatePts);
      disposableGeometries.push(sharedGateGeo);

      for (let g = 0; g < 9; g++) {
        const gz = -4 - g * 7.2;
        const gMat = new THREE.LineBasicMaterial({
          color: g % 2 === 0 ? 0xe8b84a : 0xb88628,
          transparent: true,
          opacity: 0.18,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        disposableMaterials.push(gMat);
        const gateLoop = new THREE.LineLoop(sharedGateGeo, gMat);
        gateLoop.position.set(0, 0, gz);
        gateLoop.rotation.z = (g % 2) * 0.08;
        scene.add(gateLoop);
        gateMeshes.push({ line: gateLoop, mat: gMat, z: gz });
      }

      // ----------------------------------------------------------------------
      // 4. ~30 Floating Gold Wireframe Octahedron Shards along -Z
      // ----------------------------------------------------------------------
      const rawShardGeo = new THREE.OctahedronGeometry(0.24, 0);
      rawShardGeo.scale(1, 1.45, 1);
      const shardEdgesGeo = new THREE.EdgesGeometry(rawShardGeo);
      rawShardGeo.dispose();
      disposableGeometries.push(shardEdgesGeo);

      const shardMat = new THREE.LineBasicMaterial({
        color: 0xe8b84a,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      disposableMaterials.push(shardMat);

      for (let s = 0; s < 30; s++) {
        const shard = new THREE.LineSegments(shardEdgesGeo, shardMat);
        const angle = (s * 2.39996) % (Math.PI * 2);
        const radius = 2.8 + (s % 5) * 1.15;
        const sz = 4 - s * 2.35;
        shard.position.set(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius * 0.75,
          sz
        );
        shard.rotation.set(s * 0.4, s * 0.7, s * 0.2);
        const scale = 0.55 + (s % 4) * 0.28;
        shard.scale.setScalar(scale);
        scene.add(shard);
        shardMeshes.push({
          mesh: shard,
          baseZ: sz,
          rotSpeed: 0.25 + (s % 5) * 0.12,
        });
      }

      // ----------------------------------------------------------------------
      // 5. Gold Wireframe Shader Terrain under Camera (PlaneGeometry 70x90, 64x64)
      // ----------------------------------------------------------------------
      const terrainGeo = new THREE.PlaneGeometry(70, 90, 64, 64);
      disposableGeometries.push(terrainGeo);

      terrainMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAmp: { value: TERRAIN_AMPS_BY_CHAPTER[0] },
          uCamZ: { value: 8.0 },
          uOpacity: { value: TERRAIN_OPACITY },
          uColorLow: { value: new THREE.Color(0xb88628) },
          uColorHigh: { value: new THREE.Color(0xffd97a) },
        },
        vertexShader: `
          uniform float uTime;
          uniform float uAmp;
          varying float vDist;
          varying float vElev;

          void main() {
            vec4 worldPos = modelMatrix * vec4(position, 1.0);

            // Flat valley in the center, rising along the sides
            float valley = smoothstep(1.8, 15.5, abs(worldPos.x));

            // World-anchored layered sin waves so the terrain never swims when snapped
            float n1 = sin(worldPos.x * 0.26 + worldPos.z * 0.17 + uTime * 0.35);
            float n2 = cos(worldPos.x * 0.14 - worldPos.z * 0.22 + uTime * 0.22);
            float n3 = sin((worldPos.x + worldPos.z) * 0.42 - uTime * 0.18) * 0.45;

            float ridge = (n1 + n2 + n3) * uAmp * valley;
            float canyonLift = pow(smoothstep(4.0, 28.0, abs(worldPos.x)), 1.35) * 2.4 * uAmp;
            worldPos.y += ridge + canyonLift;

            vElev = clamp((ridge + canyonLift) / max(0.001, uAmp * 3.2), 0.0, 1.0);
            vec4 viewPos = viewMatrix * worldPos;
            vDist = -viewPos.z;

            gl_Position = projectionMatrix * viewPos;
          }
        `,
        fragmentShader: `
          uniform float uOpacity;
          uniform vec3 uColorLow;
          uniform vec3 uColorHigh;
          varying float vDist;
          varying float vElev;

          void main() {
            // Fade by distance: near 7-20, far 32-64
            float nearAlpha = smoothstep(7.0, 20.0, vDist);
            float farAlpha = 1.0 - smoothstep(32.0, 64.0, vDist);
            float alpha = nearAlpha * farAlpha * uOpacity;

            if (alpha <= 0.002) discard;

            vec3 col = mix(uColorLow, uColorHigh, vElev);
            gl_FragColor = vec4(col, alpha);
          }
        `,
        wireframe: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      disposableMaterials.push(terrainMat);

      terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
      terrainMesh.rotation.x = -Math.PI / 2;
      terrainMesh.position.set(0, -3.4, -22);
      scene.add(terrainMesh);
    }

    // Pointer / touch parallax
    let targetPtrX = 0;
    let targetPtrY = 0;
    let curPtrX = 0;
    let curPtrY = 0;

    const onPointerMove = (e: PointerEvent) => {
      const nx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      const ny = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
      targetPtrX = nx * 0.35;
      targetPtrY = -ny * 0.25;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const t = e.touches[0];
        const nx = (t.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
        const ny = (t.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
        targetPtrX = nx * 0.3;
        targetPtrY = -ny * 0.2;
      }
    };

    const onResize = () => {
      if (!renderer || !camera) return;
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.setPixelRatio(
        isLowEndGl ? 1.0 : Math.min(window.devicePixelRatio || 1, 1.75)
      );
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    // Animation loop state
    let rafId = 0;
    let prevTime = performance.now();
    let smoothChapter = 0;
    let lastParticleChapter = -999;
    let lastParticleAssembleP = -999;
    let lastHudChapter = -1;
    let lastHudDepth = -1;
    let rotYAccumulator = 0;

    const cellZ = 90 / 64; // Exact grid spacing for world-anchored terrain Z snap

    const animate = (now: number) => {
      // Pause rendering when tab is hidden
      if (document.hidden) {
        prevTime = now;
        rafId = requestAnimationFrame(animate);
        return;
      }

      const dt = Math.min(0.05, Math.max(0.001, (now - prevTime) / 1000));
      prevTime = now;
      const elapsedSec = now * 0.001;

      // 1) Compute normalized scroll progress (0..1) and target chapter (0..5)
      const maxScroll = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight
      );
      const rawProgress = clamp(window.scrollY / maxScroll, 0, 1);
      const targetChapter = rawProgress * 5;

      const lerpFactor = reducedMotion
        ? 1
        : 1 - Math.exp(-dt * SCROLL_LERP_DAMPING);
      const prevChapter = smoothChapter;
      smoothChapter += (targetChapter - smoothChapter) * lerpFactor;

      const velocity = Math.abs(smoothChapter - prevChapter) / dt;

      // Update React HUD state only when values actually change
      const nearestChapter = clamp(Math.round(smoothChapter), 0, 5);
      if (nearestChapter !== lastHudChapter) {
        lastHudChapter = nearestChapter;
        setActiveChapterIdx(nearestChapter);
      }

      const depthVal = Math.round(smoothChapter * 240);
      if (Math.abs(depthVal - lastHudDepth) >= 2) {
        lastHudDepth = depthVal;
        setDepthMeters(depthVal);
      }

      // 2) Scroll-linked DOM motion: section .wrap opacity/translateY & outline numerals
      for (let idx = 0; idx < 6; idx++) {
        const d = smoothChapter - idx;
        const wrapEl = wrapRefs.current[idx];
        if (wrapEl) {
          if (reducedMotion) {
            wrapEl.style.opacity = '1';
            wrapEl.style.transform = 'none';
          } else {
            const op = clamp(1.25 - Math.abs(d) * 1.5, 0, 1);
            const ty = d * 30;
            wrapEl.style.opacity = op.toFixed(3);
            wrapEl.style.transform = `translate3d(0, ${ty.toFixed(1)}px, 0)`;
          }
        }

        const numEl = numeralRefs.current[idx];
        if (numEl && !reducedMotion) {
          const numTy = -d * 150;
          numEl.style.transform = `translate3d(0, ${numTy.toFixed(1)}px, 0)`;
        }
      }

      // Fixed background marquee moving with time + scroll
      if (marqueeTrackRef.current && !reducedMotion) {
        const marqueeOffset = ((elapsedSec * 28 + smoothChapter * 140) % 1200);
        marqueeTrackRef.current.style.transform = `translate3d(${-marqueeOffset.toFixed(1)}px, 0, 0)`;
      }

      // 3) Update Three.js WebGL scene if not in Lite Mode
      if (
        renderer &&
        scene &&
        camera &&
        objectGroup &&
        posAttr &&
        corePointsMat &&
        glowPointsMat &&
        orbitRingsGroup &&
        orbitMat1 &&
        orbitMat2 &&
        terrainMesh &&
        terrainMat
      ) {
        const w = window.innerWidth || 1;
        const h = window.innerHeight || 1;
        const isPortrait = h > w;

        curPtrX += (targetPtrX - curPtrX) * Math.min(1, dt * 6);
        curPtrY += (targetPtrY - curPtrY) * Math.min(1, dt * 6);

        // Camera flythrough along -Z
        const trav = reducedMotion ? 0 : smoothChapter * TRAVEL_PER_CHAPTER;
        const introPunch = introStateRef.current.punchP;
        const introCamOffset = (1 - introPunch) * 1.85;
        const baseDist = isPortrait ? 9.2 : 7.4;

        camera.position.z = baseDist - trav + introCamOffset;
        camera.position.x = curPtrX * 0.45;
        camera.position.y = curPtrY * 0.32;

        // Scroll-velocity FOV kick: fov = 45 + clamp(velocity * 9, 0, 15)
        const targetFov = reducedMotion
          ? 45
          : 45 + clamp(velocity * FOV_KICK_STRENGTH, 0, 15);
        if (Math.abs(camera.fov - targetFov) > 0.05) {
          camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
          camera.updateProjectionMatrix();
        }

        // Glow layer opacity rises with scroll velocity + intro beam flash
        const velGlowBoost = clamp(velocity * 0.08, 0, 0.22);
        const flashBoost = introStateRef.current.beamFlash * 0.25;
        glowPointsMat.opacity = 0.22 + velGlowBoost + flashBoost;

        // Responsive object placement relative to camera
        const finaleCenterWeight = smoothstep(4.1, 4.95, smoothChapter);
        const introCenterWeight = 1 - introPunch;

        let targetObjX = 0;
        let targetObjY = 0;
        let baseScale = 1.0;

        if (isPortrait) {
          baseScale = 0.74;
          // During intro centered (y=0.35), on landing in upper screen (y=2.1), Finale slightly lower (y=1.55)
          const landingY = 2.1 * (1 - finaleCenterWeight * 0.26);
          targetObjX = 0;
          targetObjY = landingY * (1 - introCenterWeight) + 0.35 * introCenterWeight;
        } else {
          baseScale = 1.0;
          // Landscape: right side (x=2.7, y=0.1), centered during Intro and Finale (ch 5)
          const rightWeight = (1 - finaleCenterWeight) * (1 - introCenterWeight);
          targetObjX = 2.7 * rightWeight;
          targetObjY = 0.1 * rightWeight;
        }

        objectGroup.position.set(
          camera.position.x * 0.35 + targetObjX,
          camera.position.y * 0.35 + targetObjY,
          camera.position.z - baseDist
        );

        const breath = 1 + Math.sin(elapsedSec * 1.9) * 0.025;
        objectGroup.scale.setScalar(baseScale * breath);

        rotYAccumulator += dt * 0.42;
        objectGroup.rotation.y = rotYAccumulator + curPtrX * 0.65;
        objectGroup.rotation.x =
          0.16 + Math.sin(elapsedSec * 0.8) * 0.05 + curPtrY * 0.45;

        // Update 4800 particle positions ONLY when chapter or intro assembly changes
        const assembleP = introStateRef.current.assembleP;
        const chapterChanged = Math.abs(smoothChapter - lastParticleChapter) > 0.0004;
        const assembleChanged = Math.abs(assembleP - lastParticleAssembleP) > 0.0004;

        if (chapterChanged || assembleChanged) {
          lastParticleChapter = smoothChapter;
          lastParticleAssembleP = assembleP;

          const chFloor = clamp(Math.floor(smoothChapter), 0, 4);
          const chCeil = chFloor + 1;
          const rawFract = clamp(smoothChapter - chFloor, 0, 1);

          const shapeA = morphData.shapes[chFloor];
          const shapeB = morphData.shapes[chCeil];
          const scatter = morphData.introScatter;
          const burst = morphData.burstVectors;
          const delays = morphData.delays;
          const swirls = morphData.swirls;

          for (let i = 0; i < PARTICLE_COUNT; i++) {
            const i3 = i * 3;
            const d = delays[i];

            // Morph between shapeA and shapeB with per-particle delay + mid-transition burst
            const localMorphRaw = (rawFract - d * 0.55) / (1 - d * 0.55);
            const localT = clamp(localMorphRaw, 0, 1);
            const mEase = easeInOutCubic(localT);
            const burstAmt = reducedMotion ? 0 : Math.sin(localT * Math.PI);

            let mx =
              shapeA[i3] +
              (shapeB[i3] - shapeA[i3]) * mEase +
              burst[i3] * burstAmt;
            let my =
              shapeA[i3 + 1] +
              (shapeB[i3 + 1] - shapeA[i3 + 1]) * mEase +
              burst[i3 + 1] * burstAmt;
            let mz =
              shapeA[i3 + 2] +
              (shapeB[i3 + 2] - shapeA[i3 + 2]) * mEase +
              burst[i3 + 2] * burstAmt;

            // Blend with intro scattered sphere when assembleP < 1
            if (assembleP < 0.999) {
              const introRaw = (assembleP - d) / (1 - d);
              const introClamped = clamp(introRaw, 0, 1);
              const introEase = easeInOutCubic(introClamped);

              const lx = scatter[i3] + (mx - scatter[i3]) * introEase;
              const ly = scatter[i3 + 1] + (my - scatter[i3 + 1]) * introEase;
              const lz = scatter[i3 + 2] + (mz - scatter[i3 + 2]) * introEase;

              const swirlAngle = (1 - introEase) * swirls[i];
              const cosA = Math.cos(swirlAngle);
              const sinA = Math.sin(swirlAngle);

              mx = lx * cosA - lz * sinA;
              my = ly;
              mz = lx * sinA + lz * cosA;
            }

            currentPositions[i3] = mx;
            currentPositions[i3 + 1] = my;
            currentPositions[i3 + 2] = mz;
          }

          posAttr.needsUpdate = true;
        }

        // Orbit rings visibility: prominent in Hero (ch 0) and Finale (ch 5), fade in middle chapters
        const heroRingVis = 1 - smoothstep(0.15, 0.95, smoothChapter);
        const finaleRingVis = smoothstep(4.1, 4.9, smoothChapter);
        const ringAlpha = Math.max(heroRingVis, finaleRingVis) * introPunch;
        orbitMat1.opacity = 0.34 * ringAlpha;
        orbitMat2.opacity = 0.22 * ringAlpha;
        orbitRingsGroup.rotation.z = elapsedSec * 0.22;

        // Update 9 diamond wireframe gates along -Z (fade opacity by distance to camera)
        for (let g = 0; g < gateMeshes.length; g++) {
          const gate = gateMeshes[g];
          const distToCam = camera.position.z - gate.z;
          // Visible ahead of camera between distance 2 and 34
          const nearFade = smoothstep(1.5, 6.5, distToCam);
          const farFade = 1 - smoothstep(18.0, 36.0, distToCam);
          gate.mat.opacity = nearFade * farFade * 0.26 * introPunch;
          gate.line.rotation.z += dt * 0.06 * (g % 2 === 0 ? 1 : -1);
        }

        // Update ~30 floating octahedron shards
        for (let s = 0; s < shardMeshes.length; s++) {
          const item = shardMeshes[s];
          item.mesh.rotation.y += dt * item.rotSpeed;
          item.mesh.rotation.x += dt * item.rotSpeed * 0.6;
        }

        // Update world-anchored gold shader terrain
        const chIdx = clamp(Math.floor(smoothChapter), 0, 4);
        const chFrac = clamp(smoothChapter - chIdx, 0, 1);
        const amp =
          TERRAIN_AMPS_BY_CHAPTER[chIdx] +
          (TERRAIN_AMPS_BY_CHAPTER[chIdx + 1] - TERRAIN_AMPS_BY_CHAPTER[chIdx]) *
            chFrac;

        // Snap terrain Z to grid cell increments so vertices stay locked in world space
        const snappedZ =
          Math.floor((camera.position.z - 26) / cellZ) * cellZ;
        terrainMesh.position.z = snappedZ;

        terrainMat.uniforms.uTime.value = elapsedSec;
        terrainMat.uniforms.uAmp.value = amp;
        terrainMat.uniforms.uCamZ.value = camera.position.z;
        terrainMat.uniforms.uOpacity.value = TERRAIN_OPACITY * introPunch;

        renderer.render(scene, camera);
      }

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('resize', onResize);

      disposableGeometries.forEach((g) => g.dispose());
      disposableMaterials.forEach((m) => m.dispose());
      spriteTex?.dispose();

      if (renderer) {
        const dom = renderer.domElement;
        renderer.dispose();
        if (dom && dom.parentNode === container) {
          container.removeChild(dom);
        }
      }
    };
  }, [isLiteMode]);

  // Live price formatting & sparkline generation from useMarket()
  const formattedPrice = useMemo(() => {
    const val = priceData.price ?? 4165.5;
    return val.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, [priceData.price]);

  const priceDelta = useMemo(() => {
    if (priceData.previousClose && priceData.price) {
      const diff = priceData.price - priceData.previousClose;
      const pct = (diff / priceData.previousClose) * 100;
      return { diff, pct };
    }
    return {
      diff: priceData.change24h ?? 14.8,
      pct: priceData.changePercent24h ?? 0.36,
    };
  }, [
    priceData.price,
    priceData.previousClose,
    priceData.change24h,
    priceData.changePercent24h,
  ]);

  const activeChapterMeta = CHAPTER_META[activeChapterIdx] || CHAPTER_META[0];
  const depthFormatted = String(depthMeters).padStart(4, '0');

  return (
    <div className="relative bg-[#050505] text-[#FAFAFA] selection:bg-[#E8B84A]/30 selection:text-[#FFD97A] overflow-x-hidden w-full">
      {/* Seamless Intro Overlay (shares the persistent 4800-particle Three.js canvas) */}
      {!introComplete && (
        <IntroDiamond
          sharedCanvas={!isLiteMode}
          onStateUpdate={handleIntroStateUpdate}
          onComplete={handleIntroComplete}
        />
      )}

      {/* Persistent Full-Screen Vanilla Three.js Canvas or Lite Mode Fallback */}
      {isLiteMode ? (
        <div className="sarraf-lite-bg" />
      ) : (
        <div
          ref={canvasMountRef}
          className="fixed inset-0 z-0 pointer-events-none w-full h-full"
        />
      )}

      {/* Vignette & Film Grain Overlays */}
      <div className="sarraf-vignette" />
      <div className="film-grain" />

      {/* Fixed Outline-Text Marquee behind content */}
      <div className="fixed inset-x-0 top-1/2 -translate-y-1/2 z-2 pointer-events-none overflow-hidden opacity-75">
        <div
          ref={marqueeTrackRef}
          className="sarraf-marquee-outline text-[13vw] sm:text-[9.5vw] tracking-tight flex items-center gap-12"
        >
          <span>
            XAU/USD ◆ GOLD ◆ REAL TIME ◆ SIGNALS ◆ XAU/USD ◆ GOLD ◆ REAL TIME ◆ SIGNALS ◆
          </span>
          <span>
            XAU/USD ◆ GOLD ◆ REAL TIME ◆ SIGNALS ◆ XAU/USD ◆ GOLD ◆ REAL TIME ◆ SIGNALS ◆
          </span>
        </div>
      </div>

      {/* ====================================================================
          FIXED TOP BAR (safe-area-inset aware)
         ==================================================================== */}
      <header
        className="fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 sm:px-8 py-3.5 bg-gradient-to-b from-[#050505]/90 via-[#050505]/50 to-transparent backdrop-blur-md border-b border-[#E8B84A]/10"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)',
          paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 1rem)',
          paddingRight: 'calc(env(safe-area-inset-right, 0px) + 1rem)',
        }}
      >
        <button
          onClick={() => scrollToChapter(0)}
          className="flex items-center gap-2.5 text-left cursor-pointer group"
        >
          <span className="text-[#FFD97A] text-xs transition-transform duration-300 group-hover:rotate-45">
            ◆
          </span>
          <span className="font-mono text-xs sm:text-sm font-bold tracking-[0.32em] text-white">
            SARRAF
          </span>
        </button>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* XAU/USD LIVE Pill */}
          <div className="inline-flex items-center gap-2 px-2.5 sm:px-3 py-1 rounded-full bg-[#0c0c0e]/90 border border-[#E8B84A]/30 font-mono text-[10px] sm:text-xs">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                priceData.status === 'LIVE'
                  ? 'bg-emerald-400 animate-pulse'
                  : 'bg-amber-400'
              }`}
            />
            <span className="text-[#FFD97A] font-semibold tracking-wider">
              XAU/USD
            </span>
            <span className="text-white font-bold tabular-nums">
              ${formattedPrice}
            </span>
            <span className="hidden xs:inline text-[9px] text-emerald-400 uppercase tracking-widest">
              {priceData.status === 'LIVE' ? 'LIVE' : 'CLOSED'}
            </span>
          </div>

          {/* Lite Mode Toggle */}
          <button
            onClick={() => setIsLiteMode((prev) => !prev)}
            title="Toggle 3D / Lite Mode"
            className={`px-2.5 py-1 rounded-full font-mono text-[10px] tracking-widest uppercase border transition-colors cursor-pointer ${
              isLiteMode
                ? 'bg-[#E8B84A]/20 border-[#FFD97A] text-[#FFD97A]'
                : 'bg-white/5 border-white/15 text-neutral-400 hover:text-white'
            }`}
          >
            {isLiteMode ? 'LITE' : '3D'}
          </button>

          {/* Terminal Sign In */}
          <button
            onClick={openLoginModal}
            className="px-3.5 sm:px-4 py-1.5 rounded-full bg-gradient-to-r from-[#B88628] via-[#E8B84A] to-[#FFD97A] text-black font-mono text-[10px] sm:text-xs font-bold tracking-widest uppercase hover:brightness-110 active:scale-95 transition-all cursor-pointer shadow-[0_0_20px_rgba(232,184,74,0.3)]"
          >
            Enter
          </button>
        </div>
      </header>

      {/* ====================================================================
          FIXED BOTTOM HUD (Chapter label + progress dots + DEPTH 0000 M)
         ==================================================================== */}
      <div
        className="fixed bottom-0 inset-x-0 z-30 flex items-center justify-between px-4 sm:px-8 py-3 bg-gradient-to-t from-[#050505]/95 via-[#050505]/60 to-transparent pointer-events-none"
        style={{
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.65rem)',
          paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 1rem)',
          paddingRight: 'calc(env(safe-area-inset-right, 0px) + 1rem)',
        }}
      >
        <div className="font-mono text-[10px] sm:text-xs tracking-[0.22em] text-[#FFD97A] uppercase">
          {activeChapterMeta.code}
        </div>

        {/* Interactive Chapter Progress Dots */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {CHAPTER_META.map((ch) => {
            const active = ch.index === activeChapterIdx;
            return (
              <button
                key={ch.index}
                onClick={() => scrollToChapter(ch.index)}
                aria-label={`Jump to ${ch.short}`}
                className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                  active
                    ? 'w-6 bg-[#FFD97A] shadow-[0_0_10px_#FFD97A]'
                    : 'w-1.5 bg-white/25 hover:bg-[#E8B84A]/60'
                }`}
              />
            );
          })}
        </div>

        <div className="font-mono text-[10px] sm:text-xs tracking-[0.22em] text-neutral-400 tabular-nums">
          DEPTH <span className="text-[#E8B84A]">{depthFormatted}</span> M
        </div>
      </div>

      {/* ====================================================================
          MAIN SCROLLABLE 6-CHAPTER DOCUMENT (6 x 100svh, scroll-snap)
         ==================================================================== */}
      <main className="relative z-10 w-full">
        {/* ------------------------------------------------------------------
            CHAPTER 0: HERO ("79" Atomic Number of Gold)
           ------------------------------------------------------------------ */}
        <section
          ref={(el) => {
            sectionRefs.current[0] = el;
          }}
          className="sarraf-section in-view px-4 sm:px-8 pt-20 pb-16"
        >
          {/* Giant Outline Numeral Behind Section */}
          <div
            ref={(el) => {
              numeralRefs.current[0] = el;
            }}
            className="sarraf-outline-num absolute right-4 sm:right-12 bottom-16 sm:bottom-auto sm:top-1/4 text-[36vw] sm:text-[22vw]"
          >
            79
          </div>

          <div
            ref={(el) => {
              wrapRefs.current[0] = el;
            }}
            className="wrap max-w-6xl mx-auto w-full flex flex-col justify-end lg:justify-center min-h-[82svh] pb-6 sm:pb-0"
          >
            <div className="max-w-xl space-y-4 sm:space-y-6">
              <div className="rv inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E8B84A]/10 border border-[#E8B84A]/30 font-mono text-[10px] tracking-[0.28em] text-[#FFD97A] uppercase">
                <Sparkles className="w-3 h-3 text-[#FFD97A]" />
                <span>ELEMENT 79 ◆ XAU/USD INTELLIGENCE</span>
              </div>

              <h1 className="text-4xl xs:text-5xl sm:text-7xl font-semibold tracking-tight leading-[1.03] text-white">
                <span className="hl-mask">
                  <span className="hl-line">Gold, moving in</span>
                </span>
                <span className="hl-mask">
                  <span className="hl-line hl-line-d1 font-serif italic font-normal text-[#FFD97A] gold-glow-text">
                    real time.
                  </span>
                </span>
              </h1>

              <p className="rv rv-d1 text-sm sm:text-base text-neutral-300 leading-relaxed max-w-md">
                Institutional-grade XAU/USD spot telemetry, macro news radar, and disciplined execution signals delivered directly to Telegram.
              </p>

              {/* Hero CTAs */}
              <div className="rv rv-d2 flex flex-wrap items-center gap-3 pt-1">
                <button
                  onClick={openLoginModal}
                  className="px-6 sm:px-8 py-3.5 rounded-full bg-gradient-to-r from-[#B88628] via-[#E8B84A] to-[#FFD97A] text-black font-mono text-xs font-bold tracking-[0.2em] uppercase hover:brightness-110 active:scale-95 transition-all shadow-[0_0_30px_rgba(232,184,74,0.4)] cursor-pointer flex items-center gap-2"
                >
                  <span>Enter SARRAF</span>
                  <ArrowUpRight className="w-4 h-4" />
                </button>

                <button
                  onClick={() => openTelegram()}
                  className="px-6 sm:px-7 py-3.5 rounded-full bg-white/5 hover:bg-[#E8B84A]/15 border border-[#E8B84A]/35 text-[#FFD97A] font-mono text-xs font-semibold tracking-[0.18em] uppercase transition-all cursor-pointer flex items-center gap-2"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Telegram Bot</span>
                </button>
              </div>

              {/* Compact Hero Telemetry Strip */}
              <div className="rv rv-d3 sarraf-glass p-3.5 sm:p-4 max-w-md mt-2">
                <span className="sarraf-corner-tl" />
                <span className="sarraf-corner-tr" />
                <span className="sarraf-corner-bl" />
                <span className="sarraf-corner-br" />
                <div className="grid grid-cols-3 gap-3 font-mono text-xs">
                  <div>
                    <div className="text-[9px] text-neutral-400 tracking-wider uppercase">
                      SPOT XAU/USD
                    </div>
                    <div className="text-sm sm:text-base font-bold text-[#FFD97A] tabular-nums mt-0.5">
                      ${formattedPrice}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-neutral-400 tracking-wider uppercase">
                      24H CHANGE
                    </div>
                    <div
                      className={`text-sm sm:text-base font-bold tabular-nums mt-0.5 flex items-center gap-1 ${
                        priceDelta.diff >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {priceDelta.diff >= 0 ? (
                        <TrendingUp className="w-3.5 h-3.5" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {priceDelta.diff >= 0 ? '+' : ''}
                        {priceDelta.pct.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-neutral-400 tracking-wider uppercase">
                      SPREAD
                    </div>
                    <div className="text-sm sm:text-base font-bold text-white tabular-nums mt-0.5">
                      {priceData.spread !== null
                        ? `${priceData.spread.toFixed(2)}`
                        : '0.30'}{' '}
                      <span className="text-[10px] text-neutral-400">USD</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            CHAPTER 1: LIVE MARKET ("01" — Gold Ingot / Bullion Bar)
           ------------------------------------------------------------------ */}
        <section
          ref={(el) => {
            sectionRefs.current[1] = el;
          }}
          className="sarraf-section px-4 sm:px-8 pt-20 pb-16"
        >
          <div
            ref={(el) => {
              numeralRefs.current[1] = el;
            }}
            className="sarraf-outline-num absolute right-4 sm:right-12 bottom-16 sm:bottom-auto sm:top-1/4 text-[36vw] sm:text-[22vw]"
          >
            01
          </div>

          <div
            ref={(el) => {
              wrapRefs.current[1] = el;
            }}
            className="wrap max-w-6xl mx-auto w-full flex flex-col justify-end lg:justify-center min-h-[82svh] pb-6 sm:pb-0"
          >
            <div className="max-w-xl space-y-4 sm:space-y-5">
              <div className="rv font-mono text-[10px] sm:text-xs tracking-[0.28em] text-[#E8B84A] uppercase">
                01 ◆ LIVE BULLION TELEMETRY
              </div>

              <h2 className="text-3xl xs:text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.06] text-white">
                <span className="hl-mask">
                  <span className="hl-line">Every tick,</span>
                </span>
                <span className="hl-mask">
                  <span className="hl-line hl-line-d1 font-serif italic font-normal text-[#FFD97A] gold-glow-text">
                    unfiltered.
                  </span>
                </span>
              </h2>

              <p className="rv rv-d1 text-xs sm:text-sm text-neutral-300 leading-relaxed max-w-md">
                Direct institutional XAU/USD feed with real-time bid/ask liquidity, 24-hour range boundaries, and session momentum tracking.
              </p>

              {/* Real Live Price Feed + Smooth 60-Sample Canvas Chart */}
              <LiveMarketCard />

              {/* Compact Global Bullion Sessions Clock (Sydney, Tokyo, London, New York) */}
              <MarketSessionsClock />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            CHAPTER 2: PRECISION ("02" — Torus Ring)
           ------------------------------------------------------------------ */}
        <section
          ref={(el) => {
            sectionRefs.current[2] = el;
          }}
          className="sarraf-section px-4 sm:px-8 pt-20 pb-16"
        >
          <div
            ref={(el) => {
              numeralRefs.current[2] = el;
            }}
            className="sarraf-outline-num absolute right-4 sm:right-12 bottom-16 sm:bottom-auto sm:top-1/4 text-[36vw] sm:text-[22vw]"
          >
            02
          </div>

          <div
            ref={(el) => {
              wrapRefs.current[2] = el;
            }}
            className="wrap max-w-6xl mx-auto w-full flex flex-col justify-end lg:justify-center min-h-[82svh] pb-6 sm:pb-0"
          >
            <div className="max-w-xl space-y-4 sm:space-y-5">
              <div className="rv font-mono text-[10px] sm:text-xs tracking-[0.28em] text-[#E8B84A] uppercase flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-[#FFD97A]" />
                <span>02 ◆ SIGNAL ARCHITECTURE</span>
              </div>

              <h2 className="text-3xl xs:text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.06] text-white">
                <span className="hl-mask">
                  <span className="hl-line">Engineered for</span>
                </span>
                <span className="hl-mask">
                  <span className="hl-line hl-line-d1 font-serif italic font-normal text-[#FFD97A] gold-glow-text">
                    asymmetric precision.
                  </span>
                </span>
              </h2>

              <p className="rv rv-d1 text-xs sm:text-sm text-neutral-300 leading-relaxed max-w-md">
                Every setup is calibrated with strict invalidation levels, staged take-profit targets, and automated break-even protection. One active signal at a time—never overlapping noise.
              </p>

              {/* Signal Architecture Bars Card */}
              <div className="rv rv-d2 sarraf-glass p-4 sm:p-6 max-w-lg space-y-3.5 font-mono">
                <span className="sarraf-corner-tl" />
                <span className="sarraf-corner-tr" />
                <span className="sarraf-corner-bl" />
                <span className="sarraf-corner-br" />

                <div className="flex items-center justify-between text-xs border-b border-white/10 pb-2.5">
                  <span className="text-[#FFD97A] font-bold tracking-wider">
                    XAU/USD ◆ LONG ARCHITECTURE
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#E8B84A]/20 text-[#FFD97A] text-[10px]">
                    R:R 1 : 3.4
                  </span>
                </div>

                {/* Animated Level Bars */}
                <div className="space-y-2.5 text-xs">
                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-neutral-400">ENTRY ZONE</span>
                      <span className="text-white font-semibold">$4,165.20 – $4,167.00</span>
                    </div>
                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full w-[62%] bg-gradient-to-r from-[#B88628] to-[#FFD97A] rounded-full" />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-emerald-400">TARGET 1 (BE LOCK)</span>
                      <span className="text-emerald-300 font-semibold">$4,175.00 (+98 PIPS)</span>
                    </div>
                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full w-[78%] bg-emerald-400 rounded-full" />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-[#FFD97A]">TARGET 2 / RUNNER</span>
                      <span className="text-[#FFD97A] font-semibold">$4,196.00 (+308 PIPS)</span>
                    </div>
                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full w-[92%] bg-gradient-to-r from-[#E8B84A] to-[#FFD97A] rounded-full" />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-rose-400">HARD STOP LOSS</span>
                      <span className="text-rose-300 font-semibold">$4,153.00 (-122 PIPS)</span>
                    </div>
                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full w-[28%] bg-rose-500/80 rounded-full" />
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-white/10 text-[10px] text-neutral-400 leading-snug">
                  Risk disclaimer: XAU/USD signals are for informational research only, not financial advice—never risk capital you cannot afford to lose.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            CHAPTER 3: NEWS RADAR ("03" — Globe with Latitude Rings)
           ------------------------------------------------------------------ */}
        <section
          ref={(el) => {
            sectionRefs.current[3] = el;
          }}
          className="sarraf-section px-4 sm:px-8 pt-20 pb-16"
        >
          <div
            ref={(el) => {
              numeralRefs.current[3] = el;
            }}
            className="sarraf-outline-num absolute right-4 sm:right-12 bottom-16 sm:bottom-auto sm:top-1/4 text-[36vw] sm:text-[22vw]"
          >
            03
          </div>

          <div
            ref={(el) => {
              wrapRefs.current[3] = el;
            }}
            className="wrap max-w-6xl mx-auto w-full flex flex-col justify-end lg:justify-center min-h-[82svh] pb-6 sm:pb-0"
          >
            <div className="max-w-xl space-y-4 sm:space-y-5">
              <div className="rv font-mono text-[10px] sm:text-xs tracking-[0.28em] text-[#E8B84A] uppercase flex items-center gap-2">
                <Radio className="w-3.5 h-3.5 text-[#FFD97A]" />
                <span>03 ◆ MACRO NEWS RADAR</span>
              </div>

              <h2 className="text-3xl xs:text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.06] text-white">
                <span className="hl-mask">
                  <span className="hl-line">Macro shocks,</span>
                </span>
                <span className="hl-mask">
                  <span className="hl-line hl-line-d1 font-serif italic font-normal text-[#FFD97A] gold-glow-text">
                    mapped ahead.
                  </span>
                </span>
              </h2>

              <p className="rv rv-d1 text-xs sm:text-sm text-neutral-300 leading-relaxed max-w-md">
                Automated volatility shields pause new signal dispatches before high-impact CPI, FOMC, and NFP releases—and score the directional gold bias the second actuals print.
              </p>

              {/* Macro Event List Card */}
              <div className="rv rv-d2 sarraf-glass p-4 sm:p-5 max-w-lg space-y-2.5 font-mono">
                <span className="sarraf-corner-tl" />
                <span className="sarraf-corner-tr" />
                <span className="sarraf-corner-bl" />
                <span className="sarraf-corner-br" />

                {macroEvents.slice(0, 3).map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-black/50 border border-white/5 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            ev.impact === 'CRITICAL' || ev.impact === 'HIGH'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/35'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/35'
                          }`}
                        >
                          {ev.impact === 'CRITICAL' ? 'HIGH' : ev.impact}
                        </span>
                        <span className="text-white font-semibold">{ev.title}</span>
                      </div>
                      <div className="text-[10px] text-neutral-400">
                        Forecast: <span className="text-neutral-200">{ev.forecast}</span> · Prev:{' '}
                        <span className="text-neutral-200">{ev.previous}</span>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="inline-flex items-center gap-1 text-[10px] text-[#FFD97A]">
                        <Clock className="w-3 h-3" />
                        <span>{ev.timeRemaining}</span>
                      </div>
                      <div className="text-[9px] text-neutral-400 uppercase mt-0.5">
                        BIAS: {ev.bias}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            CHAPTER 4: TELEGRAM ("04" — Double Helix)
           ------------------------------------------------------------------ */}
        <section
          ref={(el) => {
            sectionRefs.current[4] = el;
          }}
          className="sarraf-section px-4 sm:px-8 pt-20 pb-16"
        >
          <div
            ref={(el) => {
              numeralRefs.current[4] = el;
            }}
            className="sarraf-outline-num absolute right-4 sm:right-12 bottom-16 sm:bottom-auto sm:top-1/4 text-[36vw] sm:text-[22vw]"
          >
            04
          </div>

          <div
            ref={(el) => {
              wrapRefs.current[4] = el;
            }}
            className="wrap max-w-6xl mx-auto w-full flex flex-col justify-end lg:justify-center min-h-[82svh] pb-6 sm:pb-0"
          >
            <div className="max-w-xl space-y-4 sm:space-y-5">
              <div className="rv font-mono text-[10px] sm:text-xs tracking-[0.28em] text-[#E8B84A] uppercase flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-[#FFD97A]" />
                <span>04 ◆ INSTANT TELEGRAM DISPATCH</span>
              </div>

              <h2 className="text-3xl xs:text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.06] text-white">
                <span className="hl-mask">
                  <span className="hl-line">Direct to your phone.</span>
                </span>
                <span className="hl-mask">
                  <span className="hl-line hl-line-d1 font-serif italic font-normal text-[#FFD97A] gold-glow-text">
                    Zero friction.
                  </span>
                </span>
              </h2>

              <p className="rv rv-d1 text-xs sm:text-sm text-neutral-300 leading-relaxed max-w-md">
                Receive clean entry alerts, automatic Target 1 break-even notifications, and live XAU/USD status updates inside the SARRAF Telegram bot.
              </p>

              {/* Sequential Telegram Signal Bubbles */}
              <div className="space-y-2.5 max-w-lg font-mono text-xs">
                <div className="rv rv-d1 sarraf-glass p-3.5 sm:p-4">
                  <div className="flex items-center justify-between text-[10px] text-[#FFD97A] mb-1">
                    <span className="font-bold">⚡ SARRAF BOT · XAU/USD BUY SIGNAL</span>
                    <span className="text-neutral-400">14:02 UTC</span>
                  </div>
                  <div className="text-neutral-200 text-[11px] leading-relaxed">
                    ENTRY: <span className="text-white font-semibold">$4,165.50</span> · SL:{' '}
                    <span className="text-rose-400">$4,153.00</span> · TP1:{' '}
                    <span className="text-emerald-400">$4,175.00</span> · TP2:{' '}
                    <span className="text-[#FFD97A]">$4,196.00</span>
                  </div>
                </div>

                <div className="rv rv-d2 sarraf-glass p-3.5 sm:p-4 border border-emerald-500/30">
                  <div className="flex items-center justify-between text-[10px] text-emerald-300 mb-1">
                    <span className="font-bold">🎯 TARGET 1 HIT (+95 PIPS)</span>
                    <span className="text-neutral-400">14:38 UTC</span>
                  </div>
                  <div className="text-neutral-300 text-[11px]">
                    Stop Loss automatically moved to Entry ($4,165.50). Runner active toward TP2.
                  </div>
                </div>

                <div className="rv rv-d3 pt-1 space-y-2">
                  <button
                    onClick={() => openTelegram()}
                    className="px-6 py-3 rounded-full bg-gradient-to-r from-[#B88628] via-[#E8B84A] to-[#FFD97A] text-black font-mono text-xs font-bold tracking-[0.2em] uppercase hover:brightness-110 active:scale-95 transition-all cursor-pointer inline-flex items-center gap-2 shadow-[0_0_25px_rgba(232,184,74,0.35)]"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Open Telegram Bot</span>
                  </button>
                  <p className="text-[10px] font-mono text-neutral-400">
                    Signals are for informational research only and not financial advice—spot gold trading carries high risk.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------------
            CHAPTER 5: FINALE ("Au" — Concentric Vault Rings with Radial Spokes)
           ------------------------------------------------------------------ */}
        <section
          ref={(el) => {
            sectionRefs.current[5] = el;
          }}
          className="sarraf-section px-4 sm:px-8 pt-20 pb-24"
        >
          <div
            ref={(el) => {
              numeralRefs.current[5] = el;
            }}
            className="sarraf-outline-num absolute left-1/2 -translate-x-1/2 top-1/4 text-[40vw] sm:text-[25vw]"
          >
            Au
          </div>

          <div
            ref={(el) => {
              wrapRefs.current[5] = el;
            }}
            className="wrap max-w-3xl mx-auto w-full text-center flex flex-col items-center justify-end lg:justify-center min-h-[82svh] pb-8 sm:pb-0"
          >
            <div className="sarraf-glass p-6 sm:p-10 w-full space-y-5">
              <span className="sarraf-corner-tl" />
              <span className="sarraf-corner-tr" />
              <span className="sarraf-corner-bl" />
              <span className="sarraf-corner-br" />

              <div className="rv inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#E8B84A]/15 border border-[#E8B84A]/35 font-mono text-[10px] tracking-[0.3em] text-[#FFD97A] uppercase">
                <LockOpen className="w-3.5 h-3.5 text-[#FFD97A]" />
                <span>CHAPTER 06 ◆ ACCESS TERMINAL</span>
              </div>

              <h2 className="text-4xl xs:text-5xl sm:text-7xl font-semibold tracking-tight leading-[1.04] text-white">
                <span className="hl-mask">
                  <span className="hl-line">The Vault is</span>
                </span>
                <span className="hl-mask">
                  <span className="hl-line hl-line-d1 font-serif italic font-normal text-[#FFD97A] gold-glow-text">
                    unlocked.
                  </span>
                </span>
              </h2>

              <p className="rv rv-d1 text-xs sm:text-base text-neutral-300 max-w-xl mx-auto leading-relaxed">
                Step inside the live SARRAF terminal or connect your Telegram in one tap for real-time XAU/USD execution intelligence.
              </p>

              <div className="rv rv-d2 flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2">
                <button
                  onClick={openLoginModal}
                  className="w-full sm:w-auto px-8 py-4 rounded-full bg-gradient-to-r from-[#B88628] via-[#E8B84A] to-[#FFD97A] text-black font-mono text-xs font-bold tracking-[0.22em] uppercase hover:brightness-110 active:scale-95 transition-all cursor-pointer shadow-[0_0_40px_rgba(232,184,74,0.45)] flex items-center justify-center gap-2"
                >
                  <span>Enter SARRAF</span>
                  <ArrowUpRight className="w-4 h-4" />
                </button>

                <button
                  onClick={() => openTelegram()}
                  className="w-full sm:w-auto px-8 py-4 rounded-full bg-white/5 hover:bg-[#E8B84A]/15 border border-[#E8B84A]/40 text-[#FFD97A] font-mono text-xs font-semibold tracking-[0.2em] uppercase transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  <span>Open Telegram Bot</span>
                </button>
              </div>

              {/* Accessible FAQ Accordion before Footer (Lazy-loaded) */}
              <Suspense
                fallback={
                  <div className="py-4 font-mono text-xs text-neutral-500">
                    Loading FAQ…
                  </div>
                }
              >
                <LazyFaqSection />
              </Suspense>

              {/* Footer with Legal Links + Risk Disclaimer */}
              <footer className="rv rv-d3 pt-5 border-t border-white/10 space-y-3 text-[10px] font-mono text-neutral-400 leading-relaxed">
                <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-[#FFD97A]">
                  <a
                    href="/terms"
                    onClick={(e) => {
                      e.preventDefault();
                      window.history.pushState({}, '', '/terms');
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    }}
                    className="hover:underline"
                  >
                    Terms of Use
                  </a>
                  <span className="text-neutral-600">·</span>
                  <a
                    href="/privacy"
                    onClick={(e) => {
                      e.preventDefault();
                      window.history.pushState({}, '', '/privacy');
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    }}
                    className="hover:underline"
                  >
                    Privacy Policy
                  </a>
                  <span className="text-neutral-600">·</span>
                  <a
                    href="/risk-disclosure"
                    onClick={(e) => {
                      e.preventDefault();
                      window.history.pushState({}, '', '/risk-disclosure');
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    }}
                    className="hover:underline"
                  >
                    Risk Disclosure
                  </a>
                </div>
                <div className="text-neutral-500">
                  © 2026 SARRAF ◆ Spot gold (XAU/USD) trading carries significant risk and may not be suitable for all investors. Signals and telemetry are for informational research only and do not constitute financial advice.
                </div>
              </footer>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

// Helper smoothstep for JS math
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export default LandingPage;
