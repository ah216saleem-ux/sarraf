import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GateArcState } from './types';

export interface PulseNetVisualizerConfig {
  canvas: HTMLCanvasElement;
  isLite: boolean;
  reducedMotion: boolean;
  variant: 'command' | 'hero';
}

export interface PulseNetDataUpdate {
  currentPrice: number;
  previousPrice: number;
  bid: number;
  ask: number;
  spread: number;
  tickDelta: number;
  tickDirection: 'BUY' | 'SELL' | 'FLAT';
  ticksPerMin: number;
  // Rolling price history
  priceHistory: number[];
  // Market levels
  nearestSupport?: number;
  nearestResistance?: number;
  pocPrice?: number;
  absorptionPrice?: number;
  fvgPrice?: number;
  // Active trade signal
  activeSignal?: {
    side: 'BUY' | 'SELL';
    entry: number;
    sl: number;
    tp1: number;
    tp2?: number;
    tp3?: number;
  } | null;
  // Gate alignment states
  gates?: GateArcState[];
  isMarketClosed?: boolean;
  isReplay?: boolean;
}

export interface PulseNetNodePoint {
  x: number;
  y: number;
  z: number;
  price: number;
  type: 'TICK' | 'CANDLE' | 'LEVEL' | 'GATE' | 'SIGNAL';
  delta: number;
  direction: 'BUY' | 'SELL' | 'FLAT';
  createdTime: number;
  active: boolean;
  intensity: number; // 0..1
}

export interface PulseNetLineSegment {
  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  createdTime: number;
  life: number;
  maxLife: number;
  active: boolean;
}

export interface PulseNetFlare {
  x: number;
  y: number;
  z: number;
  createdTime: number;
  lifetime: number; // ~0.8s
  maxOpacity: number; // capped at 0.8
  color: THREE.Color;
  active: boolean;
}

export interface PulseNetOverlayProjection {
  priceHead: {
    x: number;
    y: number;
    price: number;
    direction: 'BUY' | 'SELL' | 'FLAT';
    visible: boolean;
  };
  networkStats: {
    activeNodes: number;
    activeLines: number;
    ticksPerMin: number;
  };
}

export class PulseNetVisualizer {
  private canvas: HTMLCanvasElement;
  private isLite: boolean;
  private reducedMotion: boolean;
  private variant: 'command' | 'hero';

  // Three.js Core
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private animFrameId: number | null = null;
  private clock: THREE.Clock;
  private isDestroyed: boolean = false;
  public isPaused: boolean = false;

  // Post-processing
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private useBloom: boolean = false;
  private fpsBuffer: number[] = [];
  private lastFpsCheck: number = 0;

  // Interaction: slow orbit + pointer parallax
  private orbitAngle: number = 0;
  private targetPointerX: number = 0;
  private targetPointerY: number = 0;
  private currentPointerX: number = 0;
  private currentPointerY: number = 0;
  private isPointerDown: boolean = false;
  private lastPointerDownX: number = 0;
  private userOrbitOffset: number = 0;

  // Eased Auto-Fit Price Bounds
  private currentYMin: number = 0;
  private currentYMax: number = 100;
  private targetYMin: number = 0;
  private targetYMax: number = 100;

  // Ring Buffer Pools (Rule: Max 160 nodes & 700 line segments alive at once)
  private readonly maxNodes: number = 160;
  private readonly maxLineSegments: number = 700;
  private readonly maxFlares: number = 24;

  private nodesPool: PulseNetNodePoint[] = [];
  private nodesHeadIndex: number = 0;
  private linesPool: PulseNetLineSegment[] = [];
  private linesHeadIndex: number = 0;
  private flaresPool: PulseNetFlare[] = [];
  private flaresHeadIndex: number = 0;

  // Three.js Objects
  private nodesPoints: THREE.Points | null = null;
  private nodesGeometry: THREE.BufferGeometry | null = null;
  private nodesMaterial: THREE.ShaderMaterial | null = null;

  private linesSegments: THREE.LineSegments | null = null;
  private linesGeometry: THREE.BufferGeometry | null = null;
  private linesMaterial: THREE.ShaderMaterial | null = null;

  // Star Dust (decorative only, carrying no label or semantic meaning)
  private starDustPoints: THREE.Points | null = null;

  // Flare Sprites Group
  private flareGroup: THREE.Group | null = null;
  private flareSprites: THREE.Sprite[] = [];
  private flareTexture: THREE.CanvasTexture | null = null;
  private glowTexture: THREE.CanvasTexture | null = null;

  // Signal Indicator Beam & Rings
  private signalBeamGroup: THREE.Group | null = null;
  private activeSignalSide: 'BUY' | 'SELL' | null = null;

  // Shockwave / TP Burst / SL Glitch State
  private tpBurstActive: boolean = false;
  private tpBurstProgress: number = 0;
  private slGlitchActive: boolean = false;
  private slGlitchTimer: number = 0;

  // Cached Latest Data
  private latestUpdate: PulseNetDataUpdate | null = null;
  private lastKnownPrice: number = 0;
  private nodeSequenceIndex: number = 0;
  private previousNode: PulseNetNodePoint | null = null;

  // Callbacks
  public onProjectionUpdate?: (data: PulseNetOverlayProjection) => void;

  constructor(config: PulseNetVisualizerConfig) {
    this.canvas = config.canvas;
    this.isLite = config.isLite;
    this.reducedMotion = config.reducedMotion;
    this.variant = config.variant;
    this.clock = new THREE.Clock();

    const width = this.canvas.clientWidth || 800;
    const height = this.canvas.clientHeight || 360;

    // 1. Scene & Camera (Perspective, slow orbit + small parallax)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x03050a);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(0, 0, 7.8);
    this.camera.lookAt(0, 0, 0);

    // 2. WebGL Renderer (Tone mapping ACESFilmic, exposure 0.9, DPR capped at 1.5)
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5);
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: false,
        antialias: !this.isLite,
        powerPreference: 'high-performance',
      });
      this.renderer.setSize(width, height, false);
      this.renderer.setPixelRatio(dpr);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 0.9;
    } catch (e) {
      console.error('WebGL renderer creation failed:', e);
      return;
    }

    // 3. Post-processing Bloom setup (Only if not in LITE mode and FPS stays above 45)
    this.setupPostProcessing(width, height);

    // 4. Initialize Ring-buffer pools and geometries
    this.initPools();
    this.initTextures();
    this.initStarDust();
    this.initNodesMesh(dpr);
    this.initLinesMesh();
    this.initFlaresMesh();
    this.initSignalBeams();

    // 5. Setup interaction listeners (pointer parallax + drag orbit)
    this.setupEventListeners();

    // 6. Start Render Loop
    this.startLoop();
  }

  private setupPostProcessing(width: number, height: number) {
    if (this.isLite || !this.renderer) {
      this.useBloom = false;
      return;
    }

    try {
      this.composer = new EffectComposer(this.renderer);
      const renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(renderPass);

      // UnrealBloomPass: subtle glow for bright nodes without blowout
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.45, // strength
        0.35, // radius
        0.82  // threshold
      );
      this.composer.addPass(this.bloomPass);
      this.useBloom = true;
    } catch (err) {
      console.warn('Bloom postprocessing initialization skipped:', err);
      this.useBloom = false;
      this.composer = null;
    }
  }

  private initPools() {
    this.nodesPool = [];
    for (let i = 0; i < this.maxNodes; i++) {
      this.nodesPool.push({
        x: 0,
        y: 0,
        z: 0,
        price: 0,
        type: 'TICK',
        delta: 0,
        direction: 'FLAT',
        createdTime: 0,
        active: false,
        intensity: 0,
      });
    }

    this.linesPool = [];
    for (let i = 0; i < this.maxLineSegments; i++) {
      this.linesPool.push({
        startX: 0,
        startY: 0,
        startZ: 0,
        endX: 0,
        endY: 0,
        endZ: 0,
        createdTime: 0,
        life: 0,
        maxLife: 3.5,
        active: false,
      });
    }

    this.flaresPool = [];
    for (let i = 0; i < this.maxFlares; i++) {
      this.flaresPool.push({
        x: 0,
        y: 0,
        z: 0,
        createdTime: 0,
        lifetime: 0.8,
        maxOpacity: 0.8,
        color: new THREE.Color(0xffffff),
        active: false,
      });
    }
  }

  // Create procedural textures for high-performance star-streak flares & glows
  private initTextures() {
    // 1. Star-streak sprite: thin rays (1 to 2 px tall, max 120 px long), soft falloff, zero box fill
    const flareCanvas = document.createElement('canvas');
    flareCanvas.width = 128;
    flareCanvas.height = 128;
    const fCtx = flareCanvas.getContext('2d');
    if (fCtx) {
      const cx = 64;
      const cy = 64;

      fCtx.clearRect(0, 0, 128, 128);

      // Horizontal ray: thin (1.5 px tall), max 120 px long, soft exponential fade
      const hGrad = fCtx.createLinearGradient(4, cy, 124, cy);
      hGrad.addColorStop(0, 'rgba(255,255,255,0)');
      hGrad.addColorStop(0.25, 'rgba(215,235,255,0.4)');
      hGrad.addColorStop(0.5, 'rgba(255,255,255,0.95)');
      hGrad.addColorStop(0.75, 'rgba(215,235,255,0.4)');
      hGrad.addColorStop(1, 'rgba(255,255,255,0)');
      fCtx.fillStyle = hGrad;
      fCtx.fillRect(4, cy - 0.75, 120, 1.5);

      // Vertical ray: thin (1.5 px wide), 60 px long
      const vGrad = fCtx.createLinearGradient(cx, 34, cx, 94);
      vGrad.addColorStop(0, 'rgba(255,255,255,0)');
      vGrad.addColorStop(0.5, 'rgba(255,255,255,0.85)');
      vGrad.addColorStop(1, 'rgba(255,255,255,0)');
      fCtx.fillStyle = vGrad;
      fCtx.fillRect(cx - 0.75, 34, 1.5, 60);

      // Tiny pin core
      const core = fCtx.createRadialGradient(cx, cy, 0, cx, cy, 3.5);
      core.addColorStop(0, 'rgba(255,255,255,1.0)');
      core.addColorStop(0.5, 'rgba(215,235,255,0.6)');
      core.addColorStop(1, 'rgba(215,235,255,0)');
      fCtx.fillStyle = core;
      fCtx.beginPath();
      fCtx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      fCtx.fill();
    }
    this.flareTexture = new THREE.CanvasTexture(flareCanvas);

    // 2. Radial glow texture
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 64;
    glowCanvas.height = 64;
    const gCtx = glowCanvas.getContext('2d');
    if (gCtx) {
      const grad = gCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.2, 'rgba(180, 215, 255, 0.6)');
      grad.addColorStop(0.6, 'rgba(70, 130, 220, 0.15)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      gCtx.fillStyle = grad;
      gCtx.fillRect(0, 0, 64, 64);
    }
    this.glowTexture = new THREE.CanvasTexture(glowCanvas);
  }

  // Faint star dust (very slow camera drift, no meaning or semantic label)
  private initStarDust() {
    const count = this.isLite ? 80 : 220;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 12.0;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 7.0;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 6.0;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0x4a6288,
      size: 1.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });

    this.starDustPoints = new THREE.Points(geo, mat);
    this.scene.add(this.starDustPoints);
  }

  // Nodes: THREE.Points with ShaderMaterial
  // Soft round discs only (discard outside radius 0.5 of gl_PointCoord, size 2 to 5 px at DPR 1)
  // Colour near-white with cool blue tint (#cfe6ff), normal or low-alpha blending, no flat fills
  private initNodesMesh(dpr: number) {
    this.nodesGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.maxNodes * 3);
    const colors = new Float32Array(this.maxNodes * 3);
    const sizes = new Float32Array(this.maxNodes);
    const alphas = new Float32Array(this.maxNodes);

    for (let i = 0; i < this.maxNodes; i++) {
      positions[i * 3 + 0] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = -999; // hidden initially

      colors[i * 3 + 0] = 0.81; // #cfe6ff
      colors[i * 3 + 1] = 0.90;
      colors[i * 3 + 2] = 1.0;

      sizes[i] = 3.2 * dpr;
      alphas[i] = 0.0;
    }

    this.nodesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.nodesGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.nodesGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.nodesGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

    const vertexShader = `
      attribute float aSize;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      uniform float uPixelRatio;

      void main() {
        vColor = color;
        vAlpha = aAlpha;
        // Plain pixel value clamped between 2.0 and 9.0; no size attenuation
        float uSize = aSize;
        float brightness = vAlpha;
        gl_PointSize = clamp(uSize * uPixelRatio * (1.0 + 0.5 * brightness), 2.0, 9.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d); // soft falloff
        gl_FragColor = vec4(vColor, a * vAlpha);
      }
    `;

    this.nodesMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: dpr },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      vertexColors: true,
      blending: THREE.NormalBlending,
    });

    this.nodesPoints = new THREE.Points(this.nodesGeometry, this.nodesMaterial);
    this.scene.add(this.nodesPoints);
  }

  // Lines: LineSegments material: LineBasicMaterial, color #8fb4e8, transparent, opacity driven per-segment 0.15 to 0.55
  private initLinesMesh() {
    this.linesGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.maxLineSegments * 2 * 3);
    const alphas = new Float32Array(this.maxLineSegments * 2);

    for (let i = 0; i < this.maxLineSegments * 2; i++) {
      positions[i * 3 + 0] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = -999;
      alphas[i] = 0.0;
    }

    this.linesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.linesGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    this.linesGeometry.setDrawRange(0, 0);

    // Vertex colors or custom shader material with line color #8fb4e8 and per-vertex alpha
    const vertexShader = `
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      varying float vAlpha;
      void main() {
        // Line color #8fb4e8 = rgb(0.56, 0.706, 0.91)
        gl_FragColor = vec4(vec3(0.56, 0.706, 0.91), clamp(vAlpha, 0.0, 0.55));
      }
    `;

    this.linesMaterial = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });

    this.linesSegments = new THREE.LineSegments(this.linesGeometry, this.linesMaterial);
    this.scene.add(this.linesSegments);
  }

  // Flares: thin star-streak sprites on bright nodes with radial falloff
  private initFlaresMesh() {
    this.flareGroup = new THREE.Group();
    this.flareSprites = [];

    if (!this.flareTexture) return;

    for (let i = 0; i < this.maxFlares; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.flareTexture,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.45, 0.45, 1.0);
      sprite.position.set(0, 0, -999);
      this.flareGroup.add(sprite);
      this.flareSprites.push(sprite);
    }

    this.scene.add(this.flareGroup);
  }

  // Signal Indicator Beams & Concentric Rings for Active Trades
  private initSignalBeams() {
    this.signalBeamGroup = new THREE.Group();

    // Geometric ring markers for entry/TP/SL active states
    const ringGeo = new THREE.RingGeometry(0.12, 0.16, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x22e08a,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.name = 'signalRing';
    ringMesh.position.set(0, 0, -999);

    this.signalBeamGroup.add(ringMesh);
    this.scene.add(this.signalBeamGroup);
  }

  // Pointer Parallax & Slow Drag Orbit
  private setupEventListeners() {
    const onPointerMove = (e: MouseEvent | TouchEvent) => {
      let clientX = 0;
      let clientY = 0;
      if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ('clientX' in e) {
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
      }

      const rect = this.canvas.getBoundingClientRect();
      const normX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const normY = -(((clientY - rect.top) / rect.height) * 2 - 1);

      this.targetPointerX = normX * 0.45;
      this.targetPointerY = normY * 0.35;

      if (this.isPointerDown) {
        const deltaX = clientX - this.lastPointerDownX;
        this.userOrbitOffset += deltaX * 0.005;
        this.lastPointerDownX = clientX;
      }
    };

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      this.isPointerDown = true;
      if ('touches' in e && e.touches.length > 0) {
        this.lastPointerDownX = e.touches[0].clientX;
      } else if ('clientX' in e) {
        this.lastPointerDownX = (e as MouseEvent).clientX;
      }
    };

    const onPointerUp = () => {
      this.isPointerDown = false;
    };

    this.canvas.addEventListener('mousemove', onPointerMove);
    this.canvas.addEventListener('touchmove', onPointerMove, { passive: true });
    this.canvas.addEventListener('mousedown', onPointerDown);
    this.canvas.addEventListener('touchstart', onPointerDown, { passive: true });
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchend', onPointerUp);
  }

  // Update real-time feed and signal engine data
  public updateData(update: PulseNetDataUpdate) {
    this.latestUpdate = update;

    const price = update.currentPrice || update.bid || 0;
    if (price <= 0) return;

    const delta = update.tickDelta || (this.lastKnownPrice > 0 ? price - this.lastKnownPrice : 0);

    // Dynamic price bound auto-fit with padding
    this.recalculatePriceBounds(update);

    // REAL TICK SPAWN RULE: Each real tick spawns ONE node
    // Position: angle around the network by arrival order (chain winds around),
    // height (y) by real price inside auto-fit range, small radial depth variation
    if (this.lastKnownPrice === 0 || Math.abs(price - this.lastKnownPrice) > 0.001) {
      this.spawnTickNode(price, delta, update.tickDirection);
    }

    this.lastKnownPrice = price;
  }

  private recalculatePriceBounds(update: PulseNetDataUpdate) {
    const history = update.priceHistory || [];
    let minP = update.currentPrice;
    let maxP = update.currentPrice;

    if (history.length > 0) {
      for (let i = 0; i < history.length; i++) {
        const p = history[i];
        if (p < minP) minP = p;
        if (p > maxP) maxP = p;
      }
    }

    if (update.activeSignal) {
      if (update.activeSignal.entry) {
        minP = Math.min(minP, update.activeSignal.entry);
        maxP = Math.max(maxP, update.activeSignal.entry);
      }
      if (update.activeSignal.sl) {
        minP = Math.min(minP, update.activeSignal.sl);
        maxP = Math.max(maxP, update.activeSignal.sl);
      }
      if (update.activeSignal.tp1) {
        minP = Math.min(minP, update.activeSignal.tp1);
        maxP = Math.max(maxP, update.activeSignal.tp1);
      }
    }

    if (update.nearestSupport && update.nearestSupport > 0) {
      minP = Math.min(minP, update.nearestSupport);
    }
    if (update.nearestResistance && update.nearestResistance > 0) {
      maxP = Math.max(maxP, update.nearestResistance);
    }

    const range = Math.max(maxP - minP, 1.2);
    this.targetYMin = minP - range * 0.18;
    this.targetYMax = maxP + range * 0.18;

    if (this.currentYMin === 0 && this.currentYMax === 100) {
      this.currentYMin = this.targetYMin;
      this.currentYMax = this.targetYMax;
    }
  }

  // Convert real price to world Y in 3D coordinate space
  public priceToWorldY(price: number): number {
    const range = Math.max(this.currentYMax - this.currentYMin, 0.01);
    const norm = THREE.MathUtils.clamp((price - this.currentYMin) / range, 0.0, 1.0);
    // Y bounds inside [-1.75, +1.75]
    return (norm - 0.5) * 3.5;
  }

  // Spawn node for real tick
  private spawnTickNode(price: number, delta: number, direction: 'BUY' | 'SELL' | 'FLAT') {
    const node = this.nodesPool[this.nodesHeadIndex];
    this.nodesHeadIndex = (this.nodesHeadIndex + 1) % this.maxNodes;

    // Angle winds around cyclically (e.g. 137.5 degrees golden angle spacing for natural constellation dispersion)
    const angle = (this.nodeSequenceIndex * (Math.PI * 0.382)) % (Math.PI * 2);
    const radius = 2.4 + (Math.sin(this.nodeSequenceIndex * 1.7) * 0.55);
    const y = this.priceToWorldY(price);
    const z = Math.cos(angle) * (radius * 0.42);
    const x = Math.sin(angle) * radius;

    const absDelta = Math.abs(delta);
    const intensity = Math.min(0.35 + absDelta * 1.5, 1.0);

    node.x = x;
    node.y = y;
    node.z = z;
    node.price = price;
    node.type = 'TICK';
    node.delta = delta;
    node.direction = direction;
    node.createdTime = this.clock.getElapsedTime();
    node.active = true;
    node.intensity = intensity;

    // RULE: Spawn flare if notable tick (abs delta >= $0.15)
    if (absDelta >= 0.15 && !this.reducedMotion) {
      this.spawnFlare(x, y, z, direction === 'BUY' ? new THREE.Color(0x22e08a) : new THREE.Color(0xff3b6b), 0.75);
    }

    // Connect lines: Each new node must connect to the previous node and to its 2 nearest recent nodes
    this.connectNewNodeLines(node);
    this.previousNode = node;

    this.nodeSequenceIndex++;
  }

  // Connect thin glowing lines from newly arrived node to previous node and 2 nearest recent nodes
  private connectNewNodeLines(newNode: PulseNetNodePoint) {
    const time = this.clock.getElapsedTime();
    const connectedNodes = new Set<PulseNetNodePoint>();

    const addLineSegment = (target: PulseNetNodePoint) => {
      if (connectedNodes.has(target)) return;
      connectedNodes.add(target);

      const line = this.linesPool[this.linesHeadIndex];
      this.linesHeadIndex = (this.linesHeadIndex + 1) % this.maxLineSegments;

      line.startX = newNode.x;
      line.startY = newNode.y;
      line.startZ = newNode.z;
      line.endX = target.x;
      line.endY = target.y;
      line.endZ = target.z;
      line.createdTime = time;
      line.life = 0;
      line.maxLife = 4.0; // visible smoothly over 4s
      line.active = true;
    };

    // 1. Connect to previous node
    if (this.previousNode && this.previousNode.active && this.previousNode !== newNode) {
      addLineSegment(this.previousNode);
    }

    // 2. Connect to its 2 nearest recent nodes
    const candidates: Array<{ node: PulseNetNodePoint; distSq: number }> = [];
    for (let i = 0; i < this.maxNodes; i++) {
      const other = this.nodesPool[i];
      if (!other.active || other === newNode || connectedNodes.has(other)) continue;

      const dx = newNode.x - other.x;
      const dy = newNode.y - other.y;
      const dz = newNode.z - other.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      candidates.push({ node: other, distSq });
    }

    candidates.sort((a, b) => a.distSq - b.distSq);
    for (let i = 0; i < Math.min(candidates.length, 2); i++) {
      addLineSegment(candidates[i].node);
    }
  }

  // Spawn star-streak flare sprite
  public spawnFlare(x: number, y: number, z: number, color: THREE.Color, maxOpacity: number = 0.8) {
    const flare = this.flaresPool[this.flaresHeadIndex];
    const sprite = this.flareSprites[this.flaresHeadIndex];
    this.flaresHeadIndex = (this.flaresHeadIndex + 1) % this.maxFlares;

    flare.x = x;
    flare.y = y;
    flare.z = z;
    flare.createdTime = this.clock.getElapsedTime();
    flare.lifetime = 0.8;
    flare.maxOpacity = Math.min(maxOpacity, 0.8);
    flare.color.copy(color);
    flare.active = true;

    if (sprite) {
      sprite.position.set(x, y, z);
      (sprite.material as THREE.SpriteMaterial).color.copy(color);
      (sprite.material as THREE.SpriteMaterial).opacity = flare.maxOpacity;
      sprite.scale.set(0.45, 0.45, 1.0);
    }
  }

  // Hooks: triggerSignal, triggerResult, setCooldown
  public triggerSignal(side: 'BUY' | 'SELL') {
    this.activeSignalSide = side;

    // Flare burst on recent nodes in signal color (teal for BUY, red for SELL)
    const signalColor = side === 'BUY' ? new THREE.Color(0x22e08a) : new THREE.Color(0xff3b6b);

    // Find the 3 most recent nodes and spawn flares
    let flared = 0;
    for (let i = this.maxNodes - 1; i >= 0 && flared < 3; i--) {
      const node = this.nodesPool[i];
      if (node.active) {
        this.spawnFlare(node.x, node.y, node.z, signalColor, 0.8);
        flared++;
      }
    }
  }

  public triggerResult(result: 'TP' | 'SL') {
    if (result === 'TP') {
      // Gold burst along active lines & nodes
      this.tpBurstActive = true;
      this.tpBurstProgress = 0.0;
      const goldColor = new THREE.Color(0xf5c451);
      for (let i = 0; i < Math.min(this.maxFlares, 6); i++) {
        const node = this.nodesPool[i];
        if (node.active) {
          this.spawnFlare(node.x, node.y, node.z, goldColor, 0.8);
        }
      }
    } else {
      // Red glitch flash (RGB split / shake disabled if reducedMotion)
      if (!this.reducedMotion) {
        this.slGlitchActive = true;
        this.slGlitchTimer = 0.3; // 300ms
      }
    }
  }

  public setCooldown(_secondsLeft: number) {
    // Calms down network activity; handled gracefully in UI
    this.activeSignalSide = null;
  }

  public setLiteMode(isLite: boolean) {
    this.isLite = isLite;
    if (isLite) {
      this.useBloom = false;
    }
  }

  // Animation Loop
  private startLoop() {
    const animate = () => {
      if (this.isDestroyed) return;

      this.animFrameId = requestAnimationFrame(animate);

      if (this.isPaused) return;

      const delta = this.clock.getDelta();
      const time = this.clock.getElapsedTime();

      // Monitor FPS for dynamic bloom deactivation if drops below 45 FPS
      this.trackFps(delta);

      // Smooth ease Y axis auto-fit
      this.currentYMin = THREE.MathUtils.lerp(this.currentYMin, this.targetYMin, 0.06);
      this.currentYMax = THREE.MathUtils.lerp(this.currentYMax, this.targetYMax, 0.06);

      // Camera Orbit & Pointer Parallax
      this.updateCameraMovement(delta);

      // Update Buffer Geometries (Nodes, Lines, Flares)
      this.updateNodesGeometry(time);
      this.updateLinesGeometry(time, delta);
      this.updateFlares(time, delta);

      // Glitch shake handling
      if (this.slGlitchActive) {
        this.slGlitchTimer -= delta;
        if (this.slGlitchTimer <= 0) {
          this.slGlitchActive = false;
        } else {
          this.camera.position.x += (Math.random() - 0.5) * 0.04;
          this.camera.position.y += (Math.random() - 0.5) * 0.04;
        }
      }

      // Project Head Price & Overlay Coordinates
      this.projectOverlayCoordinates();

      // Render Scene
      if (this.useBloom && this.composer) {
        this.composer.render();
      } else if (this.renderer) {
        this.renderer.render(this.scene, this.camera);
      }
    };

    this.animFrameId = requestAnimationFrame(animate);
  }

  private trackFps(delta: number) {
    if (delta <= 0) return;
    const currentFps = 1.0 / delta;
    this.fpsBuffer.push(currentFps);
    if (this.fpsBuffer.length > 30) this.fpsBuffer.shift();

    const now = performance.now();
    if (now - this.lastFpsCheck > 1000) {
      this.lastFpsCheck = now;
      const avgFps = this.fpsBuffer.reduce((a, b) => a + b, 0) / this.fpsBuffer.length;
      if (avgFps < 45 && this.useBloom) {
        // Disable bloom to protect frame rate
        this.useBloom = false;
      }
    }
  }

  private updateCameraMovement(delta: number) {
    // Respect prefers-reduced-motion: no orbit, no flares shake
    if (!this.reducedMotion) {
      // Slow orbit: about 1 degree per second (0.0174 rad/s)
      this.orbitAngle += delta * 0.0175;
    }

    // Pointer parallax easing
    this.currentPointerX = THREE.MathUtils.lerp(this.currentPointerX, this.targetPointerX, 0.05);
    this.currentPointerY = THREE.MathUtils.lerp(this.currentPointerY, this.targetPointerY, 0.05);

    const totalAngle = this.orbitAngle + this.userOrbitOffset;
    const radius = 7.8;

    const camX = Math.sin(totalAngle) * radius + this.currentPointerX;
    const camZ = Math.cos(totalAngle) * radius;
    const camY = this.currentPointerY;

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(0, 0, 0);

    // Star dust very slow drift
    if (this.starDustPoints && !this.reducedMotion) {
      this.starDustPoints.rotation.y += delta * 0.004;
    }
  }

  private updateNodesGeometry(time: number) {
    if (!this.nodesGeometry) return;

    const posAttr = this.nodesGeometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.nodesGeometry.getAttribute('color') as THREE.BufferAttribute;
    const sizeAttr = this.nodesGeometry.getAttribute('aSize') as THREE.BufferAttribute;
    const alphaAttr = this.nodesGeometry.getAttribute('aAlpha') as THREE.BufferAttribute;

    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5);

    // Find newest active node (price core) to render gold
    let newestNodeIndex = -1;
    let newestCreatedTime = -1;
    for (let i = 0; i < this.maxNodes; i++) {
      const n = this.nodesPool[i];
      if (n.active && n.createdTime > newestCreatedTime) {
        newestCreatedTime = n.createdTime;
        newestNodeIndex = i;
      }
    }

    for (let i = 0; i < this.maxNodes; i++) {
      const node = this.nodesPool[i];
      if (!node.active) {
        posAttr.setXYZ(i, 0, 0, -999);
        alphaAttr.setX(i, 0.0);
        continue;
      }

      const age = time - node.createdTime;
      // Re-map Y dynamically to current auto-fit range
      const currentY = this.priceToWorldY(node.price);

      posAttr.setXYZ(i, node.x, currentY, node.z);

      // Node size: clamp base size between 2.0 and 5.0 (shader further clamps gl_PointSize max 9.0)
      const baseSize = THREE.MathUtils.clamp(2.0 + node.intensity * 2.0, 2.0, 5.0);
      sizeAttr.setX(i, baseSize);

      // Node colour: near-white cool blue (#cfe6ff). Newest node (price core) gold (#f5c451).
      if (i === newestNodeIndex) {
        // Gold: #f5c451 = rgb(0.96, 0.77, 0.32)
        colAttr.setXYZ(i, 0.96, 0.77, 0.32);
      } else if (this.activeSignalSide === 'BUY') {
        colAttr.setXYZ(i, 0.70, 0.95, 0.88); // subtle teal-tinted cool white
      } else if (this.activeSignalSide === 'SELL') {
        colAttr.setXYZ(i, 0.98, 0.75, 0.80); // subtle red-tinted cool white
      } else {
        // Cool blue: #cfe6ff = rgb(0.81, 0.90, 1.0)
        colAttr.setXYZ(i, 0.81, 0.90, 1.0);
      }

      // Alpha: starts bright (max 0.9), settles smoothly to 0.30
      const alpha = THREE.MathUtils.clamp(0.9 - age * 0.08, 0.30, 0.90);
      alphaAttr.setX(i, alpha);
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
  }

  private updateLinesGeometry(time: number, delta: number) {
    if (!this.linesGeometry) return;

    const posAttr = this.linesGeometry.getAttribute('position') as THREE.BufferAttribute;
    const alphaAttr = this.linesGeometry.getAttribute('aAlpha') as THREE.BufferAttribute;

    let activeSegmentsCount = 0;

    for (let i = 0; i < this.maxLineSegments; i++) {
      const line = this.linesPool[i];
      const v0 = i * 2;
      const v1 = i * 2 + 1;

      if (!line.active) {
        posAttr.setXYZ(v0, 0, 0, -999);
        posAttr.setXYZ(v1, 0, 0, -999);
        alphaAttr.setX(v0, 0.0);
        alphaAttr.setX(v1, 0.0);
        continue;
      }

      line.life += delta;
      if (line.life >= line.maxLife) {
        line.active = false;
        posAttr.setXYZ(v0, 0, 0, -999);
        posAttr.setXYZ(v1, 0, 0, -999);
        alphaAttr.setX(v0, 0.0);
        alphaAttr.setX(v1, 0.0);
        continue;
      }

      posAttr.setXYZ(v0, line.startX, line.startY, line.startZ);
      posAttr.setXYZ(v1, line.endX, line.endY, line.endZ);

      // Fade out over time: alpha 0.15 to 0.55 per segment
      const progress = line.life / line.maxLife;
      const alpha = THREE.MathUtils.lerp(0.55, 0.15, progress);

      alphaAttr.setX(v0, alpha);
      alphaAttr.setX(v1, alpha);
      activeSegmentsCount++;
    }

    posAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    this.linesGeometry.setDrawRange(0, this.maxLineSegments * 2);
  }

  private updateFlares(time: number, delta: number) {
    for (let i = 0; i < this.maxFlares; i++) {
      const flare = this.flaresPool[i];
      const sprite = this.flareSprites[i];
      if (!flare.active || !sprite) continue;

      const age = time - flare.createdTime;
      if (age >= flare.lifetime) {
        flare.active = false;
        (sprite.material as THREE.SpriteMaterial).opacity = 0;
        sprite.position.set(0, 0, -999);
        continue;
      }

      const progress = age / flare.lifetime;
      // Quick rise, exponential falloff (lifetime ~0.8s)
      const currentOpacity = (1.0 - progress) * flare.maxOpacity;
      (sprite.material as THREE.SpriteMaterial).opacity = currentOpacity;

      // Slight expansion as it fades
      const scale = 0.40 + progress * 0.15;
      sprite.scale.set(scale, scale, 1.0);
    }
  }

  // Convert 3D world coordinates to 2D screen coordinates
  public worldToScreen(worldX: number, worldY: number, worldZ: number = 0) {
    const vec = new THREE.Vector3(worldX, worldY, worldZ);
    vec.project(this.camera);

    const width = this.canvas.clientWidth || 800;
    const height = this.canvas.clientHeight || 360;

    const x = ((vec.x + 1) / 2) * width;
    const y = ((-vec.y + 1) / 2) * height;

    return { x, y, isBehind: vec.z > 1.0 };
  }

  private projectOverlayCoordinates() {
    if (!this.onProjectionUpdate || !this.latestUpdate) return;

    // Find the latest active node for head price tracker
    let latestNode: PulseNetNodePoint | null = null;
    let maxTime = -1;
    let activeNodesCount = 0;

    for (let i = 0; i < this.maxNodes; i++) {
      const n = this.nodesPool[i];
      if (n.active) {
        activeNodesCount++;
        if (n.createdTime > maxTime) {
          maxTime = n.createdTime;
          latestNode = n;
        }
      }
    }

    let activeLinesCount = 0;
    for (let i = 0; i < this.maxLineSegments; i++) {
      if (this.linesPool[i].active) activeLinesCount++;
    }

    let screenPos = { x: 0, y: 0, isBehind: false };
    if (latestNode) {
      screenPos = this.worldToScreen(latestNode.x, this.priceToWorldY(latestNode.price), latestNode.z);
    }

    this.onProjectionUpdate({
      priceHead: {
        x: screenPos.x,
        y: screenPos.y,
        price: latestNode ? latestNode.price : this.latestUpdate.currentPrice || 0,
        direction: this.latestUpdate.tickDirection || 'FLAT',
        visible: !screenPos.isBehind && latestNode !== null,
      },
      networkStats: {
        activeNodes: activeNodesCount,
        activeLines: activeLinesCount,
        ticksPerMin: this.latestUpdate.ticksPerMin || 0,
      },
    });
  }

  public handleResize() {
    if (!this.canvas || !this.renderer) return;
    const width = this.canvas.clientWidth || 800;
    const height = this.canvas.clientHeight || 360;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5);
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(dpr);

    if (this.composer) {
      this.composer.setSize(width, height);
    }
  }

  public destroy() {
    this.isDestroyed = true;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.nodesPoints) {
      this.scene.remove(this.nodesPoints);
      this.nodesGeometry?.dispose();
      this.nodesMaterial?.dispose();
    }

    if (this.linesSegments) {
      this.scene.remove(this.linesSegments);
      this.linesGeometry?.dispose();
      this.linesMaterial?.dispose();
    }

    if (this.starDustPoints) {
      this.scene.remove(this.starDustPoints);
      this.starDustPoints.geometry.dispose();
      (this.starDustPoints.material as THREE.Material).dispose();
    }

    if (this.flareGroup) {
      this.scene.remove(this.flareGroup);
      for (const s of this.flareSprites) {
        (s.material as THREE.Material).dispose();
      }
    }

    if (this.signalBeamGroup) {
      this.scene.remove(this.signalBeamGroup);
    }

    this.flareTexture?.dispose();
    this.glowTexture?.dispose();
    this.composer?.dispose();
    this.renderer?.dispose();
  }
}
