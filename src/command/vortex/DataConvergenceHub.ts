import * as THREE from 'three';
import { GateArcState } from './types';

export interface HubNodeProjection {
  index: number;
  id: string;
  label: string;
  x: number;
  y: number;
  isBehind: boolean;
  angle: number;
  distance: number;
}

export interface HubVisualizerOptions {
  isLite: boolean;
  prefersReducedMotion: boolean;
  onFpsDrop?: () => void;
}

interface DataPacket {
  active: boolean;
  nodeIndex: number;
  progress: number;
  speed: number;
  color: THREE.Color;
  size: number;
  alpha: number;
  mesh: THREE.Sprite;
}

const NODE_LABELS = [
  'PRICE FEED',
  'TICK FLOW',
  'CANDLES',
  'NEWS',
  'LEVELS',
  'SESSIONS',
  'SPREAD',
  'VOLUME',
];

const NODE_RADIUS = 3.6;
const TILT_Y_FACTOR = 0.62;
const TILT_Z_FACTOR = 0.38;

export class DataConvergenceHub {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private options: HubVisualizerOptions;

  // Three.js instances
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private animFrameId: number = 0;
  private clock: THREE.Clock;

  // Scene Objects
  private hubGroup: THREE.Group;
  private coreGroup: THREE.Group;
  private coreWireframe: THREE.LineSegments;
  private innerCore: THREE.Mesh;
  private coreHalo: THREE.Sprite | null = null;
  private nodeMeshes: THREE.Group[] = [];
  private nodeLines: THREE.Line[] = [];
  private gateArcs: THREE.Mesh[] = [];
  private tradeBeam: THREE.Line | null = null;
  private cooldownRing: THREE.Mesh | null = null;

  // Textures
  private packetTexture: THREE.CanvasTexture;
  private haloTexture: THREE.CanvasTexture;

  // Packet Pool
  private packets: DataPacket[] = [];
  private maxPackets: number = 40;

  // Node Positions (local to hubGroup)
  private nodePositions: THREE.Vector3[] = [];
  private nodePulseTimes: number[] = new Array(8).fill(0);

  // Animation States
  private introActive: boolean = true;
  private introStartTime: number = 0;
  private isMarketClosed: boolean = false;
  private isDisconnected: boolean = false;
  private isLite: boolean = false;
  private currentStage: 'WAIT' | 'BUY' | 'SELL' | 'COOLDOWN' = 'WAIT';
  private stageColor: THREE.Color = new THREE.Color(0xf5c451); // Gold
  private targetStageColor: THREE.Color = new THREE.Color(0xf5c451);

  // Results & Glitch
  private glitchActive: boolean = false;
  private glitchEndTime: number = 0;
  private tpBurstActive: boolean = false;
  private tpBurstEndTime: number = 0;

  // Cooldown
  private cooldownSeconds: number = 0;
  private cooldownMaxSeconds: number = 0;

  // Interaction & Inertia
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private rotVelX: number = 0;
  private rotVelY: number = 0;
  private targetCamDistance: number = 7.8;
  private currentCamDistance: number = 7.8;

  // Performance / FPS tracking
  private fpsCounter: number = 0;
  private lastFpsCheck: number = 0;
  private lowFpsSeconds: number = 0;

  // Gate States (8 gates)
  private gateStates: GateArcState[] = [];

  constructor(container: HTMLElement, canvas: HTMLCanvasElement, options: HubVisualizerOptions) {
    this.container = container;
    this.canvas = canvas;
    this.options = options;
    this.isLite = options.isLite;
    this.maxPackets = options.isLite ? 12 : 40;
    this.clock = new THREE.Clock();

    // Scene & Camera
    this.scene = new THREE.Scene();
    const width = container.clientWidth || 360;
    const height = container.clientHeight || 320;
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(0, 1.2, this.targetCamDistance);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;

    // Lights
    const ambLight = new THREE.AmbientLight(0xffeedd, 0.45);
    this.scene.add(ambLight);
    const dirLight = new THREE.DirectionalLight(0xfff5dd, 0.75);
    dirLight.position.set(4, 8, 5);
    this.scene.add(dirLight);

    // Generate Textures
    this.packetTexture = this.createSoftDiscTexture();
    this.haloTexture = this.createHaloTexture();

    // Root Group
    this.hubGroup = new THREE.Group();
    this.hubGroup.rotation.x = 0.25; // Slight forward tilt for perspective
    this.scene.add(this.hubGroup);

    // Build Central Core
    this.coreGroup = new THREE.Group();
    this.hubGroup.add(this.coreGroup);

    const icoGeom = new THREE.IcosahedronGeometry(0.85, 0);
    const wireGeom = new THREE.WireframeGeometry(icoGeom);
    const wireMat = new THREE.LineBasicMaterial({
      color: 0xf5c451,
      transparent: true,
      opacity: 0.85,
    });
    this.coreWireframe = new THREE.LineSegments(wireGeom, wireMat);
    this.coreGroup.add(this.coreWireframe);

    const innerGeom = new THREE.IcosahedronGeometry(0.42, 1);
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0xf5c451,
      emissive: 0xd4a017,
      emissiveIntensity: 0.8,
      roughness: 0.35,
      metalness: 0.75,
    });
    this.innerCore = new THREE.Mesh(innerGeom, innerMat);
    this.coreGroup.add(this.innerCore);

    if (!this.isLite) {
      const haloMat = new THREE.SpriteMaterial({
        map: this.haloTexture,
        color: 0xf5c451,
        transparent: true,
        opacity: 0.32,
        blending: THREE.NormalBlending,
        depthWrite: false,
      });
      this.coreHalo = new THREE.Sprite(haloMat);
      this.coreHalo.scale.set(3.2, 3.2, 1);
      this.coreGroup.add(this.coreHalo);
    }

    // Build 8 Source Nodes and Lines
    this.buildNodesAndLines();

    // Build Gate Ring (8 Arc Segments)
    this.buildGateRing();

    // Build Packet Pool
    this.initPacketPool();

    // Setup Intro
    if (options.prefersReducedMotion) {
      this.introActive = false;
      this.introStartTime = 0;
    } else {
      this.introActive = true;
      this.introStartTime = performance.now();
    }

    // Bind Interaction Events
    this.bindEvents();

    // Start Rendering Loop
    this.lastFpsCheck = performance.now();
    this.tick();
  }

  private createSoftDiscTexture(): THREE.CanvasTexture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.85)');
    grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.25)');
    grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  private createHaloTexture(): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255, 220, 120, 0.9)');
    grad.addColorStop(0.25, 'rgba(245, 196, 81, 0.5)');
    grad.addColorStop(0.6, 'rgba(212, 160, 23, 0.15)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  private buildNodesAndLines() {
    this.nodePositions = [];
    this.nodeMeshes = [];
    this.nodeLines = [];

    for (let i = 0; i < 8; i++) {
      const angle = (i * (Math.PI * 2)) / 8 - Math.PI / 2;
      const x = Math.cos(angle) * NODE_RADIUS;
      const y = Math.sin(angle) * NODE_RADIUS * TILT_Y_FACTOR;
      const z = Math.sin(angle) * NODE_RADIUS * TILT_Z_FACTOR;

      const pos = new THREE.Vector3(x, y, z);
      this.nodePositions.push(pos);

      // Node Anchor Group
      const nodeGroup = new THREE.Group();
      nodeGroup.position.copy(pos);

      // Inner sphere
      const sphereGeom = new THREE.SphereGeometry(0.09, 16, 16);
      const sphereMat = new THREE.MeshBasicMaterial({
        color: 0xf5c451,
        transparent: true,
        opacity: 0.9,
      });
      const sphere = new THREE.Mesh(sphereGeom, sphereMat);
      nodeGroup.add(sphere);

      // Outer ring
      const ringGeom = new THREE.RingGeometry(0.14, 0.18, 20);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x8a9ba8,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      nodeGroup.add(ring);

      this.hubGroup.add(nodeGroup);
      this.nodeMeshes.push(nodeGroup);

      // Connecting Line (Core (0,0,0) -> Node pos)
      const lineGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        pos,
      ]);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x6e8092,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      });
      const line = new THREE.Line(lineGeom, lineMat);
      this.hubGroup.add(line);
      this.nodeLines.push(line);
    }
  }

  private buildGateRing() {
    this.gateArcs = [];
    const innerR = 1.68;
    const outerR = 1.84;
    const totalSegments = 8;
    const spanRad = ((Math.PI * 2) / totalSegments) * 0.82; // arc width with ~18% gap

    for (let i = 0; i < totalSegments; i++) {
      const centerAngle = (i * (Math.PI * 2)) / totalSegments - Math.PI / 2;
      const startAngle = centerAngle - spanRad / 2;

      const ringGeom = new THREE.RingGeometry(innerR, outerR, 20, 1, startAngle, spanRad);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x5b6577, // Default LOCKED grey
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      });

      const arcMesh = new THREE.Mesh(ringGeom, mat);
      // Give userData for raycasting/tap
      arcMesh.userData = { gateIndex: i };
      this.hubGroup.add(arcMesh);
      this.gateArcs.push(arcMesh);
    }
  }

  private initPacketPool() {
    this.packets = [];
    for (let i = 0; i < this.maxPackets; i++) {
      const spriteMat = new THREE.SpriteMaterial({
        map: this.packetTexture,
        color: 0xf5c451,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(0.18, 0.18, 1);
      sprite.visible = false;
      this.hubGroup.add(sprite);

      this.packets.push({
        active: false,
        nodeIndex: 0,
        progress: 0,
        speed: 0.8,
        color: new THREE.Color(0xf5c451),
        size: 0.18,
        alpha: 0,
        mesh: sprite,
      });
    }
  }

  public setLiteMode(isLite: boolean) {
    this.isLite = isLite;
    this.maxPackets = isLite ? 12 : 40;
    if (this.coreHalo) {
      this.coreHalo.visible = !isLite;
    }
  }

  public setMarketClosed(closed: boolean, disconnected: boolean = false) {
    this.isMarketClosed = closed;
    this.isDisconnected = disconnected;

    if (closed || disconnected) {
      // Dim lines to 0.15
      this.nodeLines.forEach((line) => {
        (line.material as THREE.LineBasicMaterial).opacity = 0.15;
        (line.material as THREE.LineBasicMaterial).color.setHex(0x605a4a);
      });
      // Muted grey-gold
      this.targetStageColor.setHex(0x8c8266);
    } else {
      this.nodeLines.forEach((line) => {
        (line.material as THREE.LineBasicMaterial).opacity = 0.22;
        (line.material as THREE.LineBasicMaterial).color.setHex(0x6e8092);
      });
      this.targetStageColor.copy(this.getStageColorForLifecycle());
    }
  }

  private getStageColorForLifecycle(): THREE.Color {
    if (this.currentStage === 'BUY') return new THREE.Color(0x22e08a);
    if (this.currentStage === 'SELL') return new THREE.Color(0xff3b6b);
    return new THREE.Color(0xf5c451);
  }

  public updateGates(gates: GateArcState[]) {
    this.gateStates = gates;
    for (let i = 0; i < 8 && i < gates.length; i++) {
      const g = gates[i];
      const arc = this.gateArcs[i];
      if (!arc) continue;

      const mat = arc.material as THREE.MeshBasicMaterial;
      if (this.isMarketClosed || this.isDisconnected) {
        mat.color.setHex(0x5b6577);
        mat.opacity = 0.4;
      } else if (g.status === 'PASS') {
        mat.color.setHex(0x22e08a); // Green
        mat.opacity = 0.95;
      } else if (g.status === 'FAIL') {
        mat.color.setHex(0xff3b6b); // Red
        mat.opacity = 0.95;
      } else {
        mat.color.setHex(0x5b6577); // Grey
        mat.opacity = 0.55;
      }
    }
  }

  // Trigger Scan Line pulse to a node
  public triggerScanPulse(nodeIndex: number) {
    if (this.isMarketClosed || this.isDisconnected) return;
    if (nodeIndex >= 0 && nodeIndex < 8) {
      this.nodePulseTimes[nodeIndex] = performance.now();
    }
  }

  // Spawn packet along node line
  private spawnPacket(nodeIndex: number, colorHex: number, scaleMultiplier: number = 1.0) {
    if (this.isMarketClosed || this.isDisconnected) return;

    // Find inactive packet in pool
    const packet = this.packets.find((p) => !p.active);
    if (!packet) return;

    packet.active = true;
    packet.nodeIndex = nodeIndex;
    packet.progress = 0;
    packet.speed = 0.65 + Math.random() * 0.45;
    packet.color.setHex(colorHex);
    packet.size = Math.min(0.16 * scaleMultiplier, 0.38);
    packet.alpha = 0.9;

    const mat = packet.mesh.material as THREE.SpriteMaterial;
    mat.color.copy(packet.color);
    mat.opacity = 0.9;
    packet.mesh.scale.set(packet.size, packet.size, 1);
    packet.mesh.visible = true;

    // Position at node
    const pos = this.nodePositions[nodeIndex];
    if (pos) packet.mesh.position.copy(pos);

    // Also pulse node scan line
    this.triggerScanPulse(nodeIndex);
  }

  public triggerTickPacket(delta: number, direction: 'BUY' | 'SELL' | 'FLAT') {
    const scale = Math.min(1.0 + Math.abs(delta) * 1.5, 2.4);
    let color = 0xf5c451; // Gold on flat
    if (direction === 'BUY' || delta > 0) color = 0x22e08a; // Teal
    else if (direction === 'SELL' || delta < 0) color = 0xff3b6b; // Red

    this.spawnPacket(0, color, scale); // Node 0: PRICE FEED
    this.spawnPacket(1, color, 0.9);   // Node 1: TICK FLOW
  }

  public triggerCandlePacket(isUp: boolean) {
    this.spawnPacket(2, isUp ? 0x22e08a : 0xff3b6b, 1.3); // Node 2: CANDLES
  }

  public triggerNewsPacket() {
    this.spawnPacket(3, 0xf5c451, 1.2); // Node 3: NEWS
  }

  public triggerLevelsPacket() {
    this.spawnPacket(4, 0x5ce1e6, 1.1); // Node 4: LEVELS
  }

  public triggerSessionPacket() {
    this.spawnPacket(5, 0xe0b84f, 1.0); // Node 5: SESSIONS
  }

  public triggerSpreadPacket() {
    this.spawnPacket(6, 0x8a9ba8, 0.9); // Node 6: SPREAD
  }

  public triggerVolumePacket() {
    this.spawnPacket(7, 0x22e08a, 1.1); // Node 7: VOLUME
  }

  public triggerSignal(side: 'BUY' | 'SELL') {
    this.currentStage = side;
    this.targetStageColor.setHex(side === 'BUY' ? 0x22e08a : 0xff3b6b);

    // Flash gate ring with accent burst
    this.gateArcs.forEach((arc) => {
      const mat = arc.material as THREE.MeshBasicMaterial;
      mat.opacity = 1.0;
    });

    // Create / Update trade beam
    if (!this.tradeBeam) {
      const beamGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 2.1, 0),
      ]);
      const beamMat = new THREE.LineBasicMaterial({
        color: side === 'BUY' ? 0x22e08a : 0xff3b6b,
        transparent: true,
        opacity: 0.85,
        linewidth: 2,
      });
      this.tradeBeam = new THREE.Line(beamGeom, beamMat);
      this.hubGroup.add(this.tradeBeam);
    } else {
      (this.tradeBeam.material as THREE.LineBasicMaterial).color.setHex(
        side === 'BUY' ? 0x22e08a : 0xff3b6b
      );
      this.tradeBeam.visible = true;
    }
  }

  public triggerResult(result: 'TP' | 'SL') {
    if (result === 'TP') {
      // Gold burst along all lines
      this.tpBurstActive = true;
      this.tpBurstEndTime = performance.now() + 850;
      for (let i = 0; i < 8; i++) {
        this.spawnPacket(i, 0xf5c451, 1.8);
      }
    } else {
      // SL hit: red glitch flash
      this.glitchActive = true;
      this.glitchEndTime = performance.now() + 450;
    }

    if (this.tradeBeam) {
      this.tradeBeam.visible = false;
    }
  }

  public setCooldown(secondsLeft: number, maxSeconds: number = 60) {
    this.cooldownSeconds = secondsLeft;
    this.cooldownMaxSeconds = maxSeconds || 60;

    if (secondsLeft > 0) {
      this.currentStage = 'COOLDOWN';
      this.targetStageColor.setHex(0x7a6a3a);

      // Dim lines to 0.1
      this.nodeLines.forEach((line) => {
        (line.material as THREE.LineBasicMaterial).opacity = 0.1;
      });

      // Show thin countdown ring
      if (!this.cooldownRing) {
        const ringGeom = new THREE.RingGeometry(1.45, 1.48, 36);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xf5c451,
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide,
        });
        this.cooldownRing = new THREE.Mesh(ringGeom, ringMat);
        this.hubGroup.add(this.cooldownRing);
      }
      this.cooldownRing.visible = true;
    } else {
      this.currentStage = 'WAIT';
      this.targetStageColor.setHex(0xf5c451);
      if (this.cooldownRing) this.cooldownRing.visible = false;
      this.nodeLines.forEach((line) => {
        (line.material as THREE.LineBasicMaterial).opacity = 0.22;
      });
    }
  }

  public skipIntro() {
    this.introActive = false;
    this.introStartTime = 0;
  }

  public resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  // Get projected 2D coordinates of all 8 nodes for the React collision-avoiding HUD
  public getNodeProjectedCoordinates(): HubNodeProjection[] {
    const list: HubNodeProjection[] = [];
    const width = this.canvas.clientWidth || 360;
    const height = this.canvas.clientHeight || 320;
    const tempVec = new THREE.Vector3();

    for (let i = 0; i < 8; i++) {
      const pos = this.nodePositions[i];
      if (!pos) continue;

      // Transform local position to world position
      tempVec.copy(pos);
      this.hubGroup.localToWorld(tempVec);

      // Determine if behind camera or center
      const distance = this.camera.position.distanceTo(tempVec);
      const isBehind = tempVec.z > 0.8;

      // Project to 2D NDC [-1, 1]
      tempVec.project(this.camera);

      // Convert NDC to screen pixel coords
      const x = ((tempVec.x + 1) / 2) * width;
      const y = ((-tempVec.y + 1) / 2) * height;

      const angle = (i * (Math.PI * 2)) / 8;

      list.push({
        index: i,
        id: `node-${i}`,
        label: NODE_LABELS[i] || `NODE ${i}`,
        x,
        y,
        isBehind,
        angle,
        distance,
      });
    }

    return list;
  }

  // Get projected position of the central core
  public getCoreProjectedCoordinates(): { x: number; y: number } {
    const width = this.canvas.clientWidth || 360;
    const height = this.canvas.clientHeight || 320;
    const tempVec = new THREE.Vector3(0, 0, 0);
    this.hubGroup.localToWorld(tempVec);
    tempVec.project(this.camera);

    return {
      x: ((tempVec.x + 1) / 2) * width,
      y: ((-tempVec.y + 1) / 2) * height,
    };
  }

  // Raycasting for gate arcs tooltip
  public checkGateArcIntersect(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const intersects = raycaster.intersectObjects(this.gateArcs, false);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      if (hit.userData && typeof hit.userData.gateIndex === 'number') {
        return hit.userData.gateIndex;
      }
    }
    return null;
  }

  private bindEvents() {
    const onPointerDown = (e: PointerEvent) => {
      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.rotVelX = 0;
      this.rotVelY = 0;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;

      this.rotVelY = dx * 0.005;
      this.rotVelX = dy * 0.003;

      this.hubGroup.rotation.y += this.rotVelY;
      this.hubGroup.rotation.x = Math.max(
        -0.4,
        Math.min(0.65, this.hubGroup.rotation.x + this.rotVelX)
      );
    };

    const onPointerUp = () => {
      this.isDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomDelta = e.deltaY * 0.004;
      this.targetCamDistance = Math.max(5.5, Math.min(10.5, this.targetCamDistance + zoomDelta));
    };

    this.canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    this.canvas.addEventListener('wheel', onWheel, { passive: false });
  }

  private tick = () => {
    this.animFrameId = requestAnimationFrame(this.tick);

    // Pause when page is hidden
    if (typeof document !== 'undefined' && document.hidden) return;

    const delta = Math.min(this.clock.getDelta(), 0.1);
    const now = performance.now();

    // FPS check & Lite auto-enablement
    this.fpsCounter++;
    if (now - this.lastFpsCheck >= 1000) {
      const currentFps = (this.fpsCounter * 1000) / (now - this.lastFpsCheck);
      this.fpsCounter = 0;
      this.lastFpsCheck = now;

      if (currentFps < 30) {
        this.lowFpsSeconds++;
        if (this.lowFpsSeconds >= 3 && !this.isLite) {
          this.setLiteMode(true);
          if (this.options.onFpsDrop) this.options.onFpsDrop();
        }
      } else {
        this.lowFpsSeconds = 0;
      }
    }

    // Intro Animation Progression (2.5s)
    let introFactor = 1.0;
    if (this.introActive) {
      const introElapsed = (now - this.introStartTime) / 1000;
      if (introElapsed >= 2.5) {
        this.introActive = false;
        introFactor = 1.0;
      } else {
        introFactor = Math.min(1.0, introElapsed / 2.5);
      }
    }

    // Camera Zoom smooth lerp
    this.currentCamDistance += (this.targetCamDistance - this.currentCamDistance) * 0.1;
    this.camera.position.z = this.currentCamDistance;

    // Glitch Shake handling
    if (this.glitchActive) {
      if (now > this.glitchEndTime) {
        this.glitchActive = false;
        this.camera.position.x = 0;
        this.camera.position.y = 1.2;
      } else {
        this.camera.position.x = (Math.random() - 0.5) * 0.15;
        this.camera.position.y = 1.2 + (Math.random() - 0.5) * 0.15;
      }
    }

    // Rotation & Inertia
    if (!this.isDragging) {
      // Auto-rotation (slower if market closed)
      const autoSpeed = this.isMarketClosed || this.isDisconnected ? 0.04 : 0.12;
      this.hubGroup.rotation.y += autoSpeed * delta;

      // Damp drag velocity
      this.hubGroup.rotation.y += this.rotVelY;
      this.hubGroup.rotation.x += this.rotVelX;
      this.rotVelY *= 0.92;
      this.rotVelX *= 0.92;
    }

    // Smooth stage color lerp
    this.stageColor.lerp(this.targetStageColor, 0.08);

    // Core Wireframe and Inner mesh rotation & breathing
    const breathRate = this.isMarketClosed || this.isDisconnected ? 1.0 : 2.2;
    const breathScale =
      (1.0 + Math.sin(now * 0.001 * breathRate) * 0.04) * (this.introActive ? introFactor : 1.0);
    this.coreGroup.scale.set(breathScale, breathScale, breathScale);
    this.coreWireframe.rotation.x += 0.3 * delta;
    this.coreWireframe.rotation.y += 0.4 * delta;
    this.innerCore.rotation.y -= 0.5 * delta;

    // Apply color to core
    (this.coreWireframe.material as THREE.LineBasicMaterial).color.copy(this.stageColor);
    (this.innerCore.material as THREE.MeshStandardMaterial).emissive.copy(this.stageColor);
    if (this.coreHalo) {
      (this.coreHalo.material as THREE.SpriteMaterial).color.copy(this.stageColor);
    }

    // Nodes and Lines update
    for (let i = 0; i < 8; i++) {
      const line = this.nodeLines[i];
      const nodeMesh = this.nodeMeshes[i];
      if (!line || !nodeMesh) continue;

      // Pulse decay
      const pulseAge = (now - this.nodePulseTimes[i]) / 1000;
      let lineOpacity = this.isMarketClosed || this.isDisconnected ? 0.15 : 0.22;
      let nodeScale = 1.0;

      if (pulseAge >= 0 && pulseAge <= 0.45 && !this.isMarketClosed && !this.isDisconnected) {
        const pulseProgress = 1.0 - pulseAge / 0.45;
        lineOpacity = Math.min(0.35, 0.22 + pulseProgress * 0.13); // Opacity capped at 0.35 max
        nodeScale = 1.0 + pulseProgress * 0.35;
      }

      // Intro expansion
      if (this.introActive) {
        const nodeIntroThreshold = 0.2 + (i / 8) * 0.5;
        if (introFactor < nodeIntroThreshold) {
          nodeScale = 0;
          lineOpacity = 0;
        } else {
          const appearProgress = Math.min(1.0, (introFactor - nodeIntroThreshold) * 4.0);
          nodeScale *= appearProgress;
          lineOpacity *= appearProgress;
        }
      }

      (line.material as THREE.LineBasicMaterial).opacity = lineOpacity;
      nodeMesh.scale.set(nodeScale, nodeScale, nodeScale);
    }

    // Gate Arcs update during intro / breathing
    if (this.introActive) {
      const ringIntroProg = Math.max(0, Math.min(1.0, (introFactor - 0.7) * 3.33));
      this.gateArcs.forEach((arc) => {
        arc.scale.set(ringIntroProg, ringIntroProg, ringIntroProg);
      });
    } else {
      this.gateArcs.forEach((arc) => {
        arc.scale.set(1, 1, 1);
      });
    }

    // TP Gold Burst animation
    if (this.tpBurstActive) {
      if (now > this.tpBurstEndTime) {
        this.tpBurstActive = false;
      } else {
        const burstProgress = 1.0 - (this.tpBurstEndTime - now) / 850;
        this.nodeLines.forEach((line) => {
          (line.material as THREE.LineBasicMaterial).opacity = 0.35 * (1.0 - burstProgress);
          (line.material as THREE.LineBasicMaterial).color.setHex(0xf5c451);
        });
      }
    }

    // Packets Simulation (traveling along lines into core)
    if (!this.isMarketClosed && !this.isDisconnected) {
      for (const packet of this.packets) {
        if (!packet.active) continue;

        packet.progress += packet.speed * delta;
        if (packet.progress >= 1.0) {
          // Entered core!
          packet.active = false;
          packet.mesh.visible = false;
          continue;
        }

        const nodePos = this.nodePositions[packet.nodeIndex];
        if (!nodePos) continue;

        // Position: from nodePos (progress=0) to (0,0,0) (progress=1)
        const t = packet.progress;
        packet.mesh.position.set(
          nodePos.x * (1 - t),
          nodePos.y * (1 - t),
          nodePos.z * (1 - t)
        );

        // Alpha envelope: fade in at start, fade out at core
        let alpha = 0.9;
        if (t < 0.15) alpha = t / 0.15;
        else if (t > 0.85) alpha = (1.0 - t) / 0.15;
        (packet.mesh.material as THREE.SpriteMaterial).opacity = alpha * 0.9;
      }
    } else {
      // Hide all packets when market closed or disconnected
      for (const packet of this.packets) {
        packet.active = false;
        packet.mesh.visible = false;
      }
    }

    // Render Scene
    this.renderer.render(this.scene, this.camera);
  };

  public dispose() {
    cancelAnimationFrame(this.animFrameId);

    // Dispose Geometries and Materials
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Sprite) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      }
    });

    this.packetTexture.dispose();
    this.haloTexture.dispose();
    this.renderer.dispose();
  }
}
