import * as THREE from 'three';
import { GateArcState } from './types';

export interface FlowRiversVisualizerConfig {
  canvas: HTMLCanvasElement;
  isLite: boolean;
  reducedMotion: boolean;
  variant: 'command' | 'hero';
}

export interface FlowRiversDataUpdate {
  currentPrice: number;
  previousPrice: number;
  bid: number;
  ask: number;
  spread: number;
  buyRatio: number; // 0 to 100
  sellRatio: number; // 0 to 100
  ticksPerMin: number;
  tickDirection: 'BUY' | 'SELL' | 'FLAT';
  tickDelta: number;
  // History
  priceHistory: number[]; // Last 300 ticks or 120 M1 closes
  // Market levels
  nearestSupport?: number;
  nearestResistance?: number;
  pocPrice?: number;
  absorptionPrice?: number;
  fvgPrice?: number;
  // Active signal
  activeSignal?: {
    side: 'BUY' | 'SELL';
    entry: number;
    sl: number;
    tp1: number;
    tp2?: number;
    tp3?: number;
  } | null;
  // Gates
  gates?: GateArcState[];
  isMarketClosed?: boolean;
  isReplay?: boolean;
}

export interface FloatingLabelProjection {
  id: string;
  label: string;
  value: string;
  subValue?: string;
  x: number; // screen pixel X
  y: number; // screen pixel Y
  color: string;
  glowColor: string;
  showConnector: boolean;
  lineEndX?: number;
  lineEndY?: number;
}

export class FlowRiversVisualizer {
  private canvas: HTMLCanvasElement;
  private isLite: boolean;
  private reducedMotion: boolean;
  private variant: 'command' | 'hero';

  // Three.js Core
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private animFrameId: number | null = null;
  private clock: THREE.Clock;
  private isDestroyed: boolean = false;
  private isPaused: boolean = false;

  // Particle System
  private particleCount: number = 20000;
  private particlePoints: THREE.Points | null = null;
  private particleMaterial: THREE.ShaderMaterial | null = null;
  private particleGeometry: THREE.BufferGeometry | null = null;

  // Price Thread Texture & Mesh
  private priceTextureSize: number = 256;
  private priceDataTexture: THREE.DataTexture | null = null;
  private priceTextureData: Float32Array;
  private priceThreadLine: THREE.Line | null = null;
  private priceThreadHalo: THREE.Line | null = null;
  private priceHeadGlow: THREE.Mesh | null = null;

  // Comets Pool
  private cometMesh: THREE.InstancedMesh | null = null;
  private readonly maxComets: number = 60;
  private comets: Array<{
    active: boolean;
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    length: number;
    isUp: boolean;
    alpha: number;
  }> = [];

  // TP Gold Burst Particle System
  private tpBurstPoints: THREE.Points | null = null;
  private tpBurstActive: boolean = false;
  private tpBurstTimer: number = 0;

  // Glitch effect state
  private isGlitching: boolean = false;
  private glitchTimer: number = 0;

  // Eased Price Bounds for smooth auto-fit
  private currentYMin: number = 0;
  private currentYMax: number = 100;
  private targetYMin: number = 0;
  private targetYMax: number = 100;

  // State & Uniform references
  private buyRatioSmooth: number = 0.5;
  private sellRatioSmooth: number = 0.5;
  private flowSpeedSmooth: number = 0.35;
  private introProgress: number = 1.0;
  private shockwaveActive: boolean = false;
  private shockwaveSide: 'BUY' | 'SELL' = 'BUY';
  private shockwaveProgress: number = 0;
  private rippleProgress: number = 1.0;
  private rippleCenterY: number = 0;

  // Cached data
  private lastPrice: number = 0;
  private tickDeltasWindow: number[] = [];
  private latestUpdate: FlowRiversDataUpdate | null = null;

  // Callbacks
  public onLabelsUpdate?: (labels: FloatingLabelProjection[]) => void;
  public onPriceHeadUpdate?: (screenX: number, screenY: number, price: number, direction: 'BUY' | 'SELL' | 'FLAT') => void;

  constructor(config: FlowRiversVisualizerConfig) {
    this.canvas = config.canvas;
    this.isLite = config.isLite;
    this.reducedMotion = config.reducedMotion;
    this.variant = config.variant;
    this.clock = new THREE.Clock();

    // Determine particle count: 20k desktop, 6k mobile, 4k lite
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    if (this.isLite) {
      this.particleCount = 4000;
    } else if (isMobile) {
      this.particleCount = 6000;
    } else {
      this.particleCount = 20000;
    }

    // Set intro progress
    this.introProgress = this.reducedMotion ? 1.0 : 0.0;

    // Allocate Price Texture Data
    this.priceTextureData = new Float32Array(this.priceTextureSize * 4);
    for (let i = 0; i < this.priceTextureSize * 4; i++) {
      this.priceTextureData[i] = 0.5;
    }

    // Setup Three.js
    const width = this.canvas.clientWidth || 800;
    const height = this.canvas.clientHeight || 360;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(0, 0, 7.5);
    this.camera.lookAt(0, 0, 0);

    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: !this.isLite,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(dpr);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;

    this.initPriceDataTexture();
    this.initParticleSystem(dpr);
    this.initPriceThread();
    this.initComets();
    this.initTPBurst();

    this.startLoop();
  }

  private initPriceDataTexture() {
    this.priceDataTexture = new THREE.DataTexture(
      this.priceTextureData,
      this.priceTextureSize,
      1,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    this.priceDataTexture.minFilter = THREE.LinearFilter;
    this.priceDataTexture.magFilter = THREE.LinearFilter;
    this.priceDataTexture.needsUpdate = true;
  }

  private initParticleSystem(dpr: number) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.particleCount * 3);
    const seeds = new Float32Array(this.particleCount * 4);
    const sizes = new Float32Array(this.particleCount);

    for (let i = 0; i < this.particleCount; i++) {
      // X in [-4.0, 4.0]
      const x = (Math.random() - 0.5) * 8.0;
      // Y in [-2.0, 2.0]
      const y = (Math.random() - 0.5) * 3.6;
      // Z in [-0.8, 0.8]
      const z = (Math.random() - 0.5) * 1.6;

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Seed vector:
      // x: sine phase
      // y: cosine phase / stream lane
      // z: speed variance (0.7 to 1.3)
      // w: color random threshold (0.0 to 1.0) & buy/sell drift bias
      seeds[i * 4 + 0] = Math.random();
      seeds[i * 4 + 1] = Math.random();
      seeds[i * 4 + 2] = 0.7 + Math.random() * 0.6;
      seeds[i * 4 + 3] = Math.random();

      // Size: 0.9 - 1.8px scaled by DPR
      sizes[i] = (0.9 + Math.random() * 0.9) * dpr;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.particleGeometry = geometry;

    // Custom Vertex & Fragment Shader
    this.particleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0.0 },
        uFlowSpeed: { value: 0.3 },
        uBuyRatio: { value: 0.5 },
        uSellRatio: { value: 0.5 },
        uPriceTexture: { value: this.priceDataTexture },
        uThreadAttraction: { value: 0.45 },
        uPriceYScale: { value: 3.2 },
        uIntroProgress: { value: this.introProgress },
        uShockwaveActive: { value: 0.0 },
        uShockwaveX: { value: -4.0 },
        uShockwaveColor: { value: new THREE.Vector3(0.133, 0.878, 0.541) },
        uRippleRadius: { value: 0.0 },
        uRippleStrength: { value: 0.0 },
        uRippleCenterY: { value: 0.0 },
        uPixelRatio: { value: dpr },
        uGlitchIntensity: { value: 0.0 },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uFlowSpeed;
        uniform float uBuyRatio;
        uniform float uSellRatio;
        uniform sampler2D uPriceTexture;
        uniform float uThreadAttraction;
        uniform float uPriceYScale;
        uniform float uIntroProgress;
        uniform float uShockwaveActive;
        uniform float uShockwaveX;
        uniform float uRippleRadius;
        uniform float uRippleStrength;
        uniform float uRippleCenterY;
        uniform float uGlitchIntensity;

        attribute vec4 aSeed;
        attribute float aSize;

        varying vec4 vSeed;
        varying float vAlpha;
        varying float vDepth;

        void main() {
          vSeed = aSeed;

          // 1. Particle X flow: stream left-to-right (right edge is +4.0 "now")
          float rawX = position.x + uTime * uFlowSpeed * aSeed.z;
          float x = mod(rawX + 4.0, 8.0) - 4.0;

          // Intro scatter settling
          if (uIntroProgress < 0.99) {
            float noiseOffset = sin(position.y * 10.0 + position.x * 5.0) * (1.0 - uIntroProgress) * 1.5;
            x = mix(position.x + noiseOffset, x, uIntroProgress);
          }

          // 2. Layered sine/curl river wave motion
          float wave1 = sin(x * 1.6 + aSeed.x * 6.28) * 0.24;
          float wave2 = cos(x * 3.2 + uTime * 0.7 + aSeed.y * 3.14) * 0.12;
          float wave3 = sin(x * 0.7 + aSeed.z * 12.56) * 0.18;
          float riverWave = wave1 + wave2 + wave3;

          // 3. BUY vs SELL vertical drift
          // BUY particles drift upward, SELL particles drift downward
          float normProgress = (x + 4.0) / 8.0; // 0.0 at left, 1.0 at right
          float verticalDrift = 0.0;
          if (aSeed.w > 0.5) {
            // Leans buy
            verticalDrift = normProgress * (uBuyRatio - 0.3) * 0.48;
          } else {
            // Leans sell
            verticalDrift = -normProgress * (uSellRatio - 0.3) * 0.48;
          }

          // 4. Sample the price thread texture at normProgress
          vec4 threadSample = texture2D(uPriceTexture, vec2(clamp(normProgress, 0.005, 0.995), 0.5));
          float threadNormY = threadSample.r;
          float threadWorldY = (threadNormY - 0.5) * uPriceYScale;

          // Streams bend toward the thread
          float baseY = position.y * 0.6 + riverWave + verticalDrift;
          float y = mix(baseY, threadWorldY + riverWave * 0.4, uThreadAttraction);

          // 5. Big tick circular ripple from thread head (x = 3.9, y = uRippleCenterY)
          if (uRippleStrength > 0.01) {
            vec2 rippleCenter = vec2(3.9, uRippleCenterY);
            float d = distance(vec2(x, y), rippleCenter);
            float rippleDist = abs(d - uRippleRadius);
            if (rippleDist < 0.65) {
              float waveDisp = sin(rippleDist * 4.8) * uRippleStrength * 0.25;
              y += waveDisp;
            }
          }

          // 6. Shockwave sweeping across the field
          if (uShockwaveActive > 0.01) {
            float distToShock = abs(x - uShockwaveX);
            if (distToShock < 0.85) {
              float boost = (1.0 - distToShock / 0.85) * uShockwaveActive * 0.35;
              y += sin(distToShock * 3.14) * boost;
            }
          }

          // 7. Glitch displacement on SL hit
          if (uGlitchIntensity > 0.01) {
            float gX = sin(position.y * 30.0 + uTime * 50.0) * uGlitchIntensity * 0.15;
            x += gX;
          }

          vec3 pos = vec3(x, y, position.z);

          // Fade out at edges to blend seamlessly into canvas background
          float edgeFade = smoothstep(-4.0, -3.4, x) * smoothstep(4.0, 3.6, x);
          vAlpha = (0.28 + aSeed.z * 0.32) * edgeFade;

          // Point size: 0.9 - 1.8px scaled by distance and shocks
          float sizeFactor = 1.0;
          if (uShockwaveActive > 0.01) {
            float distToShock = abs(x - uShockwaveX);
            if (distToShock < 0.8) {
              sizeFactor += (1.0 - distToShock / 0.8) * 0.5;
            }
          }

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = aSize * (300.0 / -mvPosition.z) * 0.12 * sizeFactor;
          gl_Position = projectionMatrix * mvPosition;
          vDepth = -mvPosition.z;
        }
      `,
      fragmentShader: `
        uniform float uBuyRatio;
        uniform float uSellRatio;
        uniform float uShockwaveActive;
        uniform vec3 uShockwaveColor;
        uniform float uGlitchIntensity;

        varying vec4 vSeed;
        varying float vAlpha;
        varying float vDepth;

        void main() {
          // Soft circular disc: gl_PointCoord discard beyond 0.5
          vec2 coord = gl_PointCoord - vec2(0.5);
          float r = length(coord);
          if (r > 0.5) discard;

          // Soft alpha edge
          float discAlpha = smoothstep(0.5, 0.05, r);

          // Three defined colors:
          // Teal: #22e08a -> (0.133, 0.878, 0.541)
          // Red: #ff3b6b -> (1.0, 0.231, 0.420)
          // Gold: #c9a24a -> (0.788, 0.635, 0.290)
          vec3 teal = vec3(0.133, 0.878, 0.541);
          vec3 red = vec3(1.0, 0.231, 0.420);
          vec3 gold = vec3(0.788, 0.635, 0.290);

          // Share follows live buy/sell ratio via random threshold per particle
          float threshold = vSeed.w;
          vec3 color = gold;

          float buyCutoff = uBuyRatio * 0.9;
          float sellCutoff = 1.0 - (uSellRatio * 0.9);

          if (threshold < buyCutoff) {
            color = teal;
          } else if (threshold > sellCutoff) {
            color = red;
          } else {
            color = gold;
          }

          // If shockwave active, particle tint leans strongly to the side color for 3s
          if (uShockwaveActive > 0.01) {
            color = mix(color, uShockwaveColor, uShockwaveActive * 0.7);
          }

          // RGB Glitch flash on SL
          if (uGlitchIntensity > 0.05) {
            color = mix(color, vec3(1.0, 0.1, 0.2), uGlitchIntensity * 0.6);
          }

          float finalAlpha = vAlpha * discAlpha;
          // Stay within alpha 0.25 - 0.70 range
          finalAlpha = clamp(finalAlpha, 0.0, 0.70);

          gl_FragColor = vec4(color, finalAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.particlePoints = new THREE.Points(geometry, this.particleMaterial);
    this.scene.add(this.particlePoints);
  }

  private initPriceThread() {
    const pointsCount = 300;
    const positions = new Float32Array(pointsCount * 3);
    for (let i = 0; i < pointsCount; i++) {
      const x = -4.0 + (i / (pointsCount - 1)) * 7.9;
      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0.05;
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // 1. Thin bright gold thread line
    const brightMat = new THREE.LineBasicMaterial({
      color: 0xffd97a,
      transparent: true,
      opacity: 0.95,
      linewidth: 1,
    });
    this.priceThreadLine = new THREE.Line(lineGeo, brightMat);
    this.scene.add(this.priceThreadLine);

    // 2. Wider faint halo line
    const haloMat = new THREE.LineBasicMaterial({
      color: 0xc9a24a,
      transparent: true,
      opacity: 0.28,
      linewidth: 3,
    });
    this.priceThreadHalo = new THREE.Line(lineGeo.clone(), haloMat);
    this.priceThreadHalo.position.z = 0.02;
    this.scene.add(this.priceThreadHalo);

    // 3. Head glowing dot
    const headGeo = new THREE.SphereGeometry(0.045, 12, 12);
    const headMat = new THREE.MeshBasicMaterial({
      color: 0xffd97a,
      transparent: true,
      opacity: 0.95,
    });
    this.priceHeadGlow = new THREE.Mesh(headGeo, headMat);
    this.priceHeadGlow.position.set(3.9, 0, 0.1);
    this.scene.add(this.priceHeadGlow);
  }

  private initComets() {
    // Comets: pooled small bright comets spawned on every real tick from thread head
    for (let i = 0; i < this.maxComets; i++) {
      this.comets.push({
        active: false,
        x: 3.9,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 1.0,
        length: 0.1,
        isUp: true,
        alpha: 0,
      });
    }

    // InstancedMesh for comets (tiny lines/stretched quads)
    const cometGeo = new THREE.PlaneGeometry(0.035, 0.035);
    const cometMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.cometMesh = new THREE.InstancedMesh(cometGeo, cometMat, this.maxComets);
    this.cometMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.cometMesh);
  }

  private initTPBurst() {
    // TP burst: gold particle burst along the price thread
    const count = 500;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      pos[i * 3 + 0] = -4.0 + Math.random() * 8.0;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.4;

      vel[i * 3 + 0] = (Math.random() - 0.5) * 0.8;
      vel[i * 3 + 1] = (Math.random() - 0.5) * 1.6;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xf5c451,
      size: 0.04,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.tpBurstPoints = new THREE.Points(geo, mat);
    this.scene.add(this.tpBurstPoints);
  }

  // Handle incoming real-time data from feed & signal engine
  public updateData(update: FlowRiversDataUpdate) {
    this.latestUpdate = update;

    const price = update.currentPrice || update.bid || 0;
    const delta = update.tickDelta || (this.lastPrice > 0 ? price - this.lastPrice : 0);

    // Track tick delta window for big tick threshold (top 10% in last minute)
    if (Math.abs(delta) > 0.001) {
      this.tickDeltasWindow.push(Math.abs(delta));
      if (this.tickDeltasWindow.length > 80) this.tickDeltasWindow.shift();

      // Check big tick
      let isBigTick = false;
      if (this.tickDeltasWindow.length >= 10) {
        const sorted = [...this.tickDeltasWindow].sort((a, b) => a - b);
        const top10Threshold = sorted[Math.floor(sorted.length * 0.9)];
        if (Math.abs(delta) >= Math.max(top10Threshold, 0.15)) {
          isBigTick = true;
        }
      } else if (Math.abs(delta) >= 0.20) {
        isBigTick = true;
      }

      // Spawn Comet on real tick
      this.spawnTickComet(delta > 0, delta);

      // Trigger ripple on big tick
      if (isBigTick && !this.reducedMotion) {
        this.triggerBigTickRipple();
      }
    }

    this.lastPrice = price;

    // Smooth buy/sell ratio
    const targetBuy = (update.buyRatio || 50) / 100;
    const targetSell = (update.sellRatio || 50) / 100;
    this.buyRatioSmooth = targetBuy;
    this.sellRatioSmooth = targetSell;

    // Smooth flow speed based on real ticks per min
    const tpm = Math.max(update.ticksPerMin || 10, 5);
    // Base speed ~0.20, scale up to ~0.70 with 300 t/m
    this.flowSpeedSmooth = 0.20 + Math.min(tpm / 250, 1.0) * 0.45;

    // Update Price Thread & calculate eased Y range
    this.updatePriceThreadAndTexture(update);
  }

  private spawnTickComet(isUp: boolean, delta: number) {
    // Find inactive comet
    const comet = this.comets.find((c) => !c.active);
    if (!comet) return;

    const absDelta = Math.abs(delta);
    const length = Math.min(0.08 + absDelta * 0.4, 0.45);
    const speed = (0.6 + Math.min(absDelta * 1.5, 1.2)) * (isUp ? 1 : -1);

    comet.active = true;
    comet.x = 3.9;
    comet.y = this.priceHeadGlow ? this.priceHeadGlow.position.y : 0;
    comet.vx = -(0.2 + Math.random() * 0.3);
    comet.vy = speed;
    comet.life = 0;
    comet.maxLife = 0.65 + Math.min(absDelta * 0.5, 0.4);
    comet.length = length;
    comet.isUp = isUp;
    comet.alpha = 0.5; // additive max 0.5 as required
  }

  private triggerBigTickRipple() {
    this.rippleProgress = 0.0;
    this.rippleCenterY = this.priceHeadGlow ? this.priceHeadGlow.position.y : 0;
  }

  private updatePriceThreadAndTexture(update: FlowRiversDataUpdate) {
    const history = update.priceHistory || [];
    if (history.length === 0) return;

    // 1. Calculate price window [min, max]
    let minP = Infinity;
    let maxP = -Infinity;

    for (let i = 0; i < history.length; i++) {
      const p = history[i];
      if (p < minP) minP = p;
      if (p > maxP) maxP = p;
    }

    // Include active signal levels in padding if present
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

    // Include nearest support/resistance
    if (update.nearestSupport && update.nearestSupport > 0) {
      minP = Math.min(minP, update.nearestSupport);
    }
    if (update.nearestResistance && update.nearestResistance > 0) {
      maxP = Math.max(maxP, update.nearestResistance);
    }

    if (minP === Infinity || maxP === -Infinity || minP === maxP) {
      const p = update.currentPrice || 2700;
      minP = p - 2.0;
      maxP = p + 2.0;
    }

    // Add 15% padding
    const range = Math.max(maxP - minP, 1.0);
    this.targetYMin = minP - range * 0.15;
    this.targetYMax = maxP + range * 0.15;

    // Initialize on first tick
    if (this.currentYMin === 0 && this.currentYMax === 100) {
      this.currentYMin = this.targetYMin;
      this.currentYMax = this.targetYMax;
    }

    // Update thread geometry & DataTexture
    if (!this.priceThreadLine || !this.priceDataTexture) return;

    const lineGeo = this.priceThreadLine.geometry as THREE.BufferGeometry;
    const posAttr = lineGeo.getAttribute('position') as THREE.BufferAttribute;
    const pointsCount = posAttr.count;

    // Sample history across pointsCount
    const histLen = history.length;
    const yRange = Math.max(this.currentYMax - this.currentYMin, 0.01);

    for (let i = 0; i < pointsCount; i++) {
      const histIdx = Math.floor((i / (pointsCount - 1)) * (histLen - 1));
      const p = history[histIdx] || update.currentPrice;
      const normY = THREE.MathUtils.clamp((p - this.currentYMin) / yRange, 0.0, 1.0);
      const worldY = (normY - 0.5) * 3.2;

      posAttr.setY(i, worldY);

      // Also populate texture data (256 samples)
      const texIdx = Math.floor((i / (pointsCount - 1)) * (this.priceTextureSize - 1));
      this.priceTextureData[texIdx * 4 + 0] = normY; // Red channel = normY
      this.priceTextureData[texIdx * 4 + 1] = 0.0;
      this.priceTextureData[texIdx * 4 + 2] = 0.0;
      this.priceTextureData[texIdx * 4 + 3] = 1.0;
    }

    posAttr.needsUpdate = true;
    this.priceDataTexture.needsUpdate = true;

    // Mirror to halo
    if (this.priceThreadHalo) {
      const haloGeo = this.priceThreadHalo.geometry as THREE.BufferGeometry;
      const haloPos = haloGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pointsCount; i++) {
        haloPos.setY(i, posAttr.getY(i));
      }
      haloPos.needsUpdate = true;
    }

    // Update head position
    const headWorldY = posAttr.getY(pointsCount - 1);
    if (this.priceHeadGlow) {
      this.priceHeadGlow.position.set(3.9, headWorldY, 0.08);
    }
  }

  // Hook Triggers (Section A.6)
  public triggerSignal(side: 'BUY' | 'SELL') {
    this.shockwaveActive = true;
    this.shockwaveSide = side;
    this.shockwaveProgress = 0.0;

    if (this.particleMaterial) {
      const color = side === 'BUY'
        ? new THREE.Vector3(0.133, 0.878, 0.541) // Teal
        : new THREE.Vector3(1.0, 0.231, 0.420); // Red
      this.particleMaterial.uniforms.uShockwaveColor.value = color;
    }
  }

  public triggerResult(result: 'TP' | 'SL') {
    if (result === 'TP') {
      // Gold burst along the thread
      this.tpBurstActive = true;
      this.tpBurstTimer = 0.0;
      if (this.tpBurstPoints) {
        (this.tpBurstPoints.material as THREE.PointsMaterial).opacity = 0.85;
      }
    } else {
      // Red glitch flash (RGB split 300ms, disabled under reduced motion)
      if (!this.reducedMotion) {
        this.isGlitching = true;
        this.glitchTimer = 0.3; // 300ms
      }
    }
  }

  public setCooldown(_secondsLeft: number) {
    // Cooldown pill managed in React UI; visualizer eases back to normal wait state
    this.shockwaveActive = false;
  }

  public skipIntro() {
    this.introProgress = 1.0;
    if (this.particleMaterial) {
      this.particleMaterial.uniforms.uIntroProgress.value = 1.0;
    }
  }

  public setLiteMode(isLite: boolean) {
    this.isLite = isLite;
  }

  // Animation Loop
  private startLoop() {
    const animate = () => {
      if (this.isDestroyed) return;

      this.animFrameId = requestAnimationFrame(animate);

      if (this.isPaused) return;

      const delta = this.clock.getDelta();
      const elapsed = this.clock.getElapsedTime();

      // Smooth ease Y axis auto-fit
      this.currentYMin = THREE.MathUtils.lerp(this.currentYMin, this.targetYMin, 0.05);
      this.currentYMax = THREE.MathUtils.lerp(this.currentYMax, this.targetYMax, 0.05);

      // Intro progress
      if (this.introProgress < 1.0) {
        this.introProgress = Math.min(1.0, this.introProgress + delta * 0.5); // 2s intro
      }

      // Update particle shader uniforms
      if (this.particleMaterial) {
        const u = this.particleMaterial.uniforms;
        u.uTime.value = elapsed;
        u.uFlowSpeed.value = this.flowSpeedSmooth;
        u.uBuyRatio.value = this.buyRatioSmooth;
        u.uSellRatio.value = this.sellRatioSmooth;
        u.uIntroProgress.value = this.introProgress;

        // Shockwave sweep
        if (this.shockwaveActive) {
          this.shockwaveProgress += delta / 3.0; // 3 seconds sweep
          if (this.shockwaveProgress >= 1.0) {
            this.shockwaveActive = false;
            u.uShockwaveActive.value = 0.0;
          } else {
            u.uShockwaveActive.value = 1.0 - this.shockwaveProgress;
            // Sweep from x = -4 to +4
            u.uShockwaveX.value = -4.0 + this.shockwaveProgress * 8.0;
          }
        } else {
          u.uShockwaveActive.value = 0.0;
        }

        // Ripple expansion
        if (this.rippleProgress < 1.0) {
          this.rippleProgress += delta * 1.1; // ~1s ripple duration
          u.uRippleRadius.value = this.rippleProgress * 6.0;
          u.uRippleStrength.value = (1.0 - this.rippleProgress) * 0.8;
          u.uRippleCenterY.value = this.rippleCenterY;
        } else {
          u.uRippleStrength.value = 0.0;
        }

        // Glitch handling
        if (this.isGlitching) {
          this.glitchTimer -= delta;
          if (this.glitchTimer <= 0) {
            this.isGlitching = false;
            u.uGlitchIntensity.value = 0.0;
          } else {
            u.uGlitchIntensity.value = this.glitchTimer / 0.3;
          }
        } else {
          u.uGlitchIntensity.value = 0.0;
        }
      }

      // Update Comets
      this.updateComets(delta);

      // Update TP Gold Burst
      this.updateTPBurst(delta);

      // Project floating labels and head price position to screen coordinates
      this.projectOverlayCoordinates();

      // Render Three.js Scene
      this.renderer.render(this.scene, this.camera);
    };

    this.animFrameId = requestAnimationFrame(animate);
  }

  private updateComets(delta: number) {
    if (!this.cometMesh) return;

    const dummy = new THREE.Object3D();

    for (let i = 0; i < this.maxComets; i++) {
      const comet = this.comets[i];
      if (!comet.active) {
        dummy.position.set(0, 0, -100);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        this.cometMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      comet.life += delta;
      if (comet.life >= comet.maxLife) {
        comet.active = false;
        dummy.position.set(0, 0, -100);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        this.cometMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      comet.x += comet.vx * delta;
      comet.y += comet.vy * delta;

      const progress = comet.life / comet.maxLife;
      const scaleX = (1.0 - progress) * (comet.length / 0.035);
      const scaleY = (1.0 - progress * 0.7);

      dummy.position.set(comet.x, comet.y, 0.07);
      dummy.scale.set(scaleX, scaleY, 1.0);
      dummy.rotation.z = Math.atan2(comet.vy, comet.vx);
      dummy.updateMatrix();

      this.cometMesh.setMatrixAt(i, dummy.matrix);
    }

    this.cometMesh.instanceMatrix.needsUpdate = true;
  }

  private updateTPBurst(delta: number) {
    if (!this.tpBurstActive || !this.tpBurstPoints) return;

    this.tpBurstTimer += delta;
    const progress = this.tpBurstTimer / 2.0;

    if (progress >= 1.0) {
      this.tpBurstActive = false;
      (this.tpBurstPoints.material as THREE.PointsMaterial).opacity = 0.0;
      return;
    }

    const geo = this.tpBurstPoints.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const vel = geo.getAttribute('aVel') as THREE.BufferAttribute;

    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, pos.getX(i) + vel.getX(i) * delta * 0.6);
      pos.setY(i, pos.getY(i) + vel.getY(i) * delta * 0.6);
      pos.setZ(i, pos.getZ(i) + vel.getZ(i) * delta * 0.6);
    }
    pos.needsUpdate = true;

    (this.tpBurstPoints.material as THREE.PointsMaterial).opacity = (1.0 - progress) * 0.85;
  }

  // Convert 3D world coordinates to screen pixel coordinates
  private worldToScreen(worldX: number, worldY: number, worldZ: number = 0) {
    const vec = new THREE.Vector3(worldX, worldY, worldZ);
    vec.project(this.camera);

    const width = this.canvas.clientWidth || 800;
    const height = this.canvas.clientHeight || 360;

    const x = ((vec.x + 1) / 2) * width;
    const y = ((-vec.y + 1) / 2) * height;

    return { x, y };
  }

  // Convert a price value to 3D world Y
  public priceToWorldY(price: number): number {
    const yRange = Math.max(this.currentYMax - this.currentYMin, 0.01);
    const normY = THREE.MathUtils.clamp((price - this.currentYMin) / yRange, 0.0, 1.0);
    return (normY - 0.5) * 3.2;
  }

  // Project labels and head coordinates for React UI overlays
  private projectOverlayCoordinates() {
    if (!this.latestUpdate) return;

    const width = this.canvas.clientWidth || 800;
    const height = this.canvas.clientHeight || 360;

    // 1. Price Head screen coords
    if (this.priceHeadGlow && this.onPriceHeadUpdate) {
      const headPos = this.priceHeadGlow.position;
      const screenHead = this.worldToScreen(headPos.x, headPos.y, headPos.z);
      this.onPriceHeadUpdate(
        screenHead.x,
        screenHead.y,
        this.latestUpdate.currentPrice,
        this.latestUpdate.tickDirection
      );
    }

    if (!this.onLabelsUpdate) return;

    const labels: FloatingLabelProjection[] = [];
    const isHero = this.variant === 'hero';

    // Near head labels:
    const headWorldY = this.priceHeadGlow ? this.priceHeadGlow.position.y : 0;
    const headScreen = this.worldToScreen(3.8, headWorldY, 0);

    // Hero Variant: only PRICE, FLOW, TICKS
    if (isHero) {
      labels.push({
        id: 'hero-price',
        label: 'PRICE',
        value: this.latestUpdate.currentPrice > 0 ? `$${this.latestUpdate.currentPrice.toFixed(2)}` : 'N/A',
        x: Math.min(headScreen.x - 40, width - 110),
        y: Math.max(headScreen.y - 45, 20),
        color: '#ffd97a',
        glowColor: 'rgba(255, 217, 122, 0.4)',
        showConnector: true,
        lineEndX: headScreen.x,
        lineEndY: headScreen.y,
      });

      labels.push({
        id: 'hero-flow',
        label: 'FLOW',
        value: `${this.latestUpdate.buyRatio.toFixed(0)}% BUY`,
        x: 20,
        y: 60,
        color: this.latestUpdate.buyRatio >= 50 ? '#22e08a' : '#ff3b6b',
        glowColor: this.latestUpdate.buyRatio >= 50 ? 'rgba(34, 224, 138, 0.3)' : 'rgba(255, 59, 107, 0.3)',
        showConnector: false,
      });

      labels.push({
        id: 'hero-ticks',
        label: 'TICKS',
        value: `${this.latestUpdate.ticksPerMin || 0} t/m`,
        x: 20,
        y: 95,
        color: '#8a9ba8',
        glowColor: 'rgba(138, 155, 168, 0.2)',
        showConnector: false,
      });

      this.onLabelsUpdate(labels);
      return;
    }

    // Command Variant Labels:
    // MOMENTUM, SENTIMENT, TICK DATA near the head
    const tpm = this.latestUpdate.ticksPerMin || 0;
    const buyR = this.latestUpdate.buyRatio || 50;

    labels.push({
      id: 'lbl-momentum',
      label: 'MOMENTUM',
      value: buyR > 55 ? 'BULLISH' : buyR < 45 ? 'BEARISH' : 'NEUTRAL',
      x: Math.min(headScreen.x - 90, width - 130),
      y: Math.max(headScreen.y - 65, 30),
      color: buyR > 55 ? '#22e08a' : buyR < 45 ? '#ff3b6b' : '#c9a24a',
      glowColor: buyR > 55 ? 'rgba(34, 224, 138, 0.3)' : buyR < 45 ? 'rgba(255, 59, 107, 0.3)' : 'rgba(201, 162, 74, 0.3)',
      showConnector: true,
      lineEndX: headScreen.x - 20,
      lineEndY: headScreen.y,
    });

    labels.push({
      id: 'lbl-sentiment',
      label: 'SENTIMENT',
      value: `${buyR >= 50 ? '+' : '-'}${Math.abs(buyR - 50).toFixed(0)}% ${buyR >= 50 ? 'BUY' : 'SELL'}`,
      x: Math.min(headScreen.x - 90, width - 130),
      y: Math.min(headScreen.y + 40, height - 70),
      color: buyR >= 50 ? '#22e08a' : '#ff3b6b',
      glowColor: buyR >= 50 ? 'rgba(34, 224, 138, 0.3)' : 'rgba(255, 59, 107, 0.3)',
      showConnector: true,
      lineEndX: headScreen.x - 20,
      lineEndY: headScreen.y + 10,
    });

    labels.push({
      id: 'lbl-ticks',
      label: 'TICK DATA',
      value: `${tpm} t/m`,
      subValue: `Δ ${this.latestUpdate.tickDelta >= 0 ? '+' : ''}${this.latestUpdate.tickDelta.toFixed(2)}`,
      x: Math.max(width * 0.45, 120),
      y: 35,
      color: '#8a9ba8',
      glowColor: 'rgba(138, 155, 168, 0.25)',
      showConnector: false,
    });

    // POC / PROFILE at real POC height
    if (this.latestUpdate.pocPrice && this.latestUpdate.pocPrice > 0) {
      const pocWorldY = this.priceToWorldY(this.latestUpdate.pocPrice);
      const pocScreen = this.worldToScreen(-1.5, pocWorldY, 0);
      labels.push({
        id: 'lbl-poc',
        label: 'POC/PROFILE',
        value: `$${this.latestUpdate.pocPrice.toFixed(2)}`,
        x: Math.max(15, pocScreen.x - 50),
        y: THREE.MathUtils.clamp(pocScreen.y, 40, height - 60),
        color: '#f5c451',
        glowColor: 'rgba(245, 196, 81, 0.35)',
        showConnector: true,
        lineEndX: pocScreen.x + 30,
        lineEndY: pocScreen.y,
      });
    }

    // ABSORPTION at nearest demand/supply zone height
    if (this.latestUpdate.absorptionPrice && this.latestUpdate.absorptionPrice > 0) {
      const absWorldY = this.priceToWorldY(this.latestUpdate.absorptionPrice);
      const absScreen = this.worldToScreen(-2.6, absWorldY, 0);
      labels.push({
        id: 'lbl-absorption',
        label: 'ABSORPTION',
        value: `$${this.latestUpdate.absorptionPrice.toFixed(2)}`,
        x: Math.max(15, absScreen.x - 45),
        y: THREE.MathUtils.clamp(absScreen.y, 40, height - 60),
        color: '#22e08a',
        glowColor: 'rgba(34, 224, 138, 0.3)',
        showConnector: true,
        lineEndX: absScreen.x + 25,
        lineEndY: absScreen.y,
      });
    }

    // FVG / OB at nearest real FVG/OB level
    if (this.latestUpdate.fvgPrice && this.latestUpdate.fvgPrice > 0) {
      const fvgWorldY = this.priceToWorldY(this.latestUpdate.fvgPrice);
      const fvgScreen = this.worldToScreen(0.5, fvgWorldY, 0);
      labels.push({
        id: 'lbl-fvg',
        label: 'FVG/OB',
        value: `$${this.latestUpdate.fvgPrice.toFixed(2)}`,
        x: Math.min(width - 120, fvgScreen.x),
        y: THREE.MathUtils.clamp(fvgScreen.y, 40, height - 60),
        color: '#38bdf8',
        glowColor: 'rgba(56, 189, 248, 0.3)',
        showConnector: true,
        lineEndX: fvgScreen.x - 20,
        lineEndY: fvgScreen.y,
      });
    } else {
      labels.push({
        id: 'lbl-fvg',
        label: 'FVG/OB',
        value: 'N/A',
        x: Math.min(width - 100, width * 0.7),
        y: 35,
        color: '#5b6577',
        glowColor: 'transparent',
        showConnector: false,
      });
    }

    this.onLabelsUpdate(labels);
  }

  public handleResize() {
    if (!this.canvas) return;
    const width = this.canvas.clientWidth || 800;
    const height = this.canvas.clientHeight || 360;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5);
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(dpr);

    if (this.particleMaterial) {
      this.particleMaterial.uniforms.uPixelRatio.value = dpr;
    }
  }

  public destroy() {
    this.isDestroyed = true;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.particlePoints) {
      this.scene.remove(this.particlePoints);
      this.particleGeometry?.dispose();
      this.particleMaterial?.dispose();
    }

    if (this.priceThreadLine) {
      this.scene.remove(this.priceThreadLine);
      this.priceThreadLine.geometry.dispose();
      (this.priceThreadLine.material as THREE.Material).dispose();
    }

    if (this.priceThreadHalo) {
      this.scene.remove(this.priceThreadHalo);
      this.priceThreadHalo.geometry.dispose();
      (this.priceThreadHalo.material as THREE.Material).dispose();
    }

    if (this.priceHeadGlow) {
      this.scene.remove(this.priceHeadGlow);
      this.priceHeadGlow.geometry.dispose();
      (this.priceHeadGlow.material as THREE.Material).dispose();
    }

    if (this.cometMesh) {
      this.scene.remove(this.cometMesh);
      this.cometMesh.geometry.dispose();
      (this.cometMesh.material as THREE.Material).dispose();
    }

    if (this.tpBurstPoints) {
      this.scene.remove(this.tpBurstPoints);
      this.tpBurstPoints.geometry.dispose();
      (this.tpBurstPoints.material as THREE.Material).dispose();
    }

    this.priceDataTexture?.dispose();
    this.renderer.dispose();
  }
}
