import * as THREE from 'three';
import { Candle, ZoneItem, OriginLevel } from '../data/commandTypes';
import { Phase4State } from './types';

export interface ScanLabelAnchor {
  id: string;
  numId: string;
  label: string;
  worldPos: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface DiscAnchor {
  id: string;
  label: string;
  price: number;
  worldPos: THREE.Vector3;
  color: string;
}

export interface TickPulseEvent {
  direction: 'BUY' | 'SELL' | 'FLAT';
  delta: number;
}

export class MarketScanVisualizer {
  public group: THREE.Group;

  // 1. Point Cloud Sculpture
  private pointsMesh: THREE.Points | null = null;
  private pointsGeo: THREE.BufferGeometry | null = null;
  private pointsMaterial: THREE.ShaderMaterial | null = null;

  // 2. Space Dust
  private dustMesh: THREE.Points | null = null;
  private dustGeo: THREE.BufferGeometry | null = null;
  private dustMaterial: THREE.PointsMaterial | null = null;

  // 3. Wireframe Bounding Box, Axis Ticks & Floor Grid
  private boxGroup: THREE.Group;
  private floorGrid: THREE.LineSegments | null = null;
  private floorGridMat: THREE.LineBasicMaterial | null = null;
  private boxWireframe: THREE.LineSegments | null = null;
  private boxWireframeMat: THREE.LineBasicMaterial | null = null;
  private axisTicks: THREE.LineSegments | null = null;
  private axisTicksMat: THREE.LineBasicMaterial | null = null;

  // 4. Translucent S/R & Zone Discs
  private discsGroup: THREE.Group;
  private discMeshes: THREE.Mesh[] = [];
  private discAnchors: DiscAnchor[] = [];

  // 5. Effects: Scan Ring, Lock Ring, Flash, Cooldown
  private scanRingMesh: THREE.Mesh;
  private scanRingMat: THREE.MeshBasicMaterial;
  private scanRingProgress = 0;
  private scanRingActive = false;

  private lockRingMesh: THREE.Mesh;
  private lockRingMat: THREE.MeshBasicMaterial;

  private tpFlashMesh: THREE.Mesh;
  private tpFlashMat: THREE.MeshBasicMaterial;
  private tpFlashProgress = 0;
  private tpFlashActive = false;

  private slFlashMesh: THREE.Mesh;
  private slFlashMat: THREE.MeshBasicMaterial;
  private slFlashProgress = 0;
  private slFlashActive = false;

  private cooldownRingMesh: THREE.Mesh;
  private cooldownRingMat: THREE.MeshBasicMaterial;

  // Tick Pulse & Glitch State
  private pulseProgress = 0.0;
  private pulseActive = false;
  private pulseLength = 0.22;
  private pulseIntensity = 0.0;
  private pulseColor = new THREE.Color('#22e08a');
  private pulseSpeed = 2.4;

  private glitchAmount = 0.0;
  private glitchSliceY = 0.0;
  private glitchTimer = 0;

  // Color targets & tint
  private globalTint = new THREE.Color('#f2e6c4');
  private goldColor = new THREE.Color('#f2e6c4');
  private buyColor = new THREE.Color('#22e08a');
  private sellColor = new THREE.Color('#ff3b6b');

  // Configuration
  private maxPoints: number;
  private isLite: boolean;
  private isMobile: boolean;

  // Anchor cache
  private anchorCache: ScanLabelAnchor[] = [];
  private anchorLocalPositions: Map<string, THREE.Vector3> = new Map();

  constructor(isMobile: boolean = false, isLite: boolean = false) {
    this.isMobile = isMobile;
    this.isLite = isLite;
    this.maxPoints = isLite ? 8000 : isMobile ? 12000 : 40000;

    this.group = new THREE.Group();
    this.boxGroup = new THREE.Group();
    this.discsGroup = new THREE.Group();
    this.group.add(this.boxGroup);
    this.group.add(this.discsGroup);

    // Build space dust (unless LITE)
    if (!this.isLite) {
      this.initSpaceDust();
    }

    // Build Bounding Box & Floor Grid
    this.initBoundingBoxAndGrid();

    // Build Effects (Scan Ring, Lock Ring, Flash, Cooldown)
    this.initEffects();

    // Default label positions
    this.initDefaultAnchors();
  }

  public setLiteMode(isLite: boolean) {
    if (this.isLite === isLite) return;
    this.isLite = isLite;
    this.maxPoints = isLite ? 8000 : this.isMobile ? 12000 : 40000;
    if (this.isLite && this.dustMesh) {
      this.group.remove(this.dustMesh);
    } else if (!this.isLite && !this.dustMesh) {
      this.initSpaceDust();
    }
  }

  // --- SPACE DUST (1,500 points) ---
  private initSpaceDust() {
    const dustCount = 1500;
    const positions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 6.5;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 4.6;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 6.5;
    }
    this.dustGeo = new THREE.BufferGeometry();
    this.dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.dustMaterial = new THREE.PointsMaterial({
      color: new THREE.Color('#d4c59a'),
      size: 1.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.dustMesh = new THREE.Points(this.dustGeo, this.dustMaterial);
    this.group.add(this.dustMesh);
  }

  // --- WIREFRAME BOUNDING BOX, AXIS TICKS & FLOOR GRID ---
  private initBoundingBoxAndGrid() {
    const minX = -2.2, maxX = 2.2;
    const minY = -1.8, maxY = 1.8;
    const minZ = -2.2, maxZ = 2.2;

    // 1. Floor Grid (subtle lines on XZ plane at minY)
    const gridLines: number[] = [];
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const u = minX + (maxX - minX) * (i / steps);
      // Line parallel to Z
      gridLines.push(u, minY, minZ, u, minY, maxZ);
      // Line parallel to X
      gridLines.push(minX, minY, u, maxX, minY, u);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridLines, 3));
    this.floorGridMat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#38bdf8'),
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    });
    this.floorGrid = new THREE.LineSegments(gridGeo, this.floorGridMat);
    this.boxGroup.add(this.floorGrid);

    // 2. Wireframe Bounding Box (12 edges)
    const boxPts: number[] = [
      // Bottom square
      minX, minY, minZ, maxX, minY, minZ,
      maxX, minY, minZ, maxX, minY, maxZ,
      maxX, minY, maxZ, minX, minY, maxZ,
      minX, minY, maxZ, minX, minY, minZ,
      // Top square
      minX, maxY, minZ, maxX, maxY, minZ,
      maxX, maxY, minZ, maxX, maxY, maxZ,
      maxX, maxY, maxZ, minX, maxY, maxZ,
      minX, maxY, maxZ, minX, maxY, minZ,
      // 4 Vertical Pillars
      minX, minY, minZ, minX, maxY, minZ,
      maxX, minY, minZ, maxX, maxY, minZ,
      maxX, minY, maxZ, maxX, maxY, maxZ,
      minX, minY, maxZ, minX, maxY, maxZ,
    ];
    const boxGeo = new THREE.BufferGeometry();
    boxGeo.setAttribute('position', new THREE.Float32BufferAttribute(boxPts, 3));
    this.boxWireframeMat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#7a8b9e'),
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });
    this.boxWireframe = new THREE.LineSegments(boxGeo, this.boxWireframeMat);
    this.boxGroup.add(this.boxWireframe);

    // 3. Axis Ticks along vertical edges
    const tickPts: number[] = [];
    const numTicks = 9;
    for (let i = 0; i <= numTicks; i++) {
      const y = minY + (maxY - minY) * (i / numTicks);
      // Ticks on front-left pillar
      tickPts.push(minX, y, maxZ, minX + 0.12, y, maxZ);
      // Ticks on back-right pillar
      tickPts.push(maxX, y, minZ, maxX - 0.12, y, minZ);
    }
    const ticksGeo = new THREE.BufferGeometry();
    ticksGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickPts, 3));
    this.axisTicksMat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#f2e6c4'),
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.axisTicks = new THREE.LineSegments(ticksGeo, this.axisTicksMat);
    this.boxGroup.add(this.axisTicks);
  }

  // --- EFFECTS (Scan Ring, Lock Ring, Flashes, Cooldown) ---
  private initEffects() {
    // Scan sweep ring (flat thin torus)
    const scanGeo = new THREE.TorusGeometry(2.1, 0.015, 8, 72);
    this.scanRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#38bdf8'),
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.scanRingMesh = new THREE.Mesh(scanGeo, this.scanRingMat);
    this.scanRingMesh.rotation.x = Math.PI / 2;
    this.group.add(this.scanRingMesh);

    // Lock ring (octagonal polygon ring)
    const lockGeo = new THREE.RingGeometry(2.2, 2.25, 8);
    this.lockRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#22e08a'),
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.lockRingMesh = new THREE.Mesh(lockGeo, this.lockRingMat);
    this.lockRingMesh.rotation.x = Math.PI / 2;
    this.group.add(this.lockRingMesh);

    // TP Flash (Gold sweep cylinder)
    const tpGeo = new THREE.CylinderGeometry(2.2, 2.2, 0.15, 32, 1, true);
    this.tpFlashMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#f5c451'),
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.tpFlashMesh = new THREE.Mesh(tpGeo, this.tpFlashMat);
    this.group.add(this.tpFlashMesh);

    // SL Flash (Red glitch ring)
    const slGeo = new THREE.CylinderGeometry(2.2, 2.2, 0.25, 32, 1, true);
    this.slFlashMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff3b6b'),
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.slFlashMesh = new THREE.Mesh(slGeo, this.slFlashMat);
    this.group.add(this.slFlashMesh);

    // Cooldown ring
    const cdGeo = new THREE.TorusGeometry(2.35, 0.012, 8, 64);
    this.cooldownRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#38bdf8'),
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.cooldownRingMesh = new THREE.Mesh(cdGeo, this.cooldownRingMat);
    this.cooldownRingMesh.rotation.x = Math.PI / 2;
    this.group.add(this.cooldownRingMesh);
  }

  // --- DEFAULT ANCHORS ---
  private initDefaultAnchors() {
    this.anchorLocalPositions.set('momentum', new THREE.Vector3(1.4, 0.3, 1.2));
    this.anchorLocalPositions.set('sentiment', new THREE.Vector3(0.0, 1.6, 0.4));
    this.anchorLocalPositions.set('poc', new THREE.Vector3(-1.3, 0.0, 0.8));
    this.anchorLocalPositions.set('absorption', new THREE.Vector3(1.2, -0.6, 0.7));
    this.anchorLocalPositions.set('tickdata', new THREE.Vector3(0.2, -1.4, 1.3));
    this.anchorLocalPositions.set('fvg', new THREE.Vector3(-1.1, 0.8, -0.5));
  }

  // --- PRICE SCULPTURE POINT CLOUD BUILD (Real Data Only) ---
  public updateCandles(
    candles: Candle[],
    currentPrice: number,
    supportLevel: number,
    resistanceLevel: number,
    buyZones: ZoneItem[] = [],
    sellZones: ZoneItem[] = [],
    originLevels: OriginLevel[] = []
  ) {
    if (!candles || candles.length === 0) return;

    // Last 150 real candles
    const recent = candles.slice(-150);
    const N = recent.length;
    if (N < 2) return;

    // Find price min / max
    let pMin = Infinity;
    let pMax = -Infinity;
    for (const c of recent) {
      if (c.low < pMin) pMin = c.low;
      if (c.high > pMax) pMax = c.high;
    }
    if (currentPrice > 0) {
      pMin = Math.min(pMin, currentPrice - 0.5);
      pMax = Math.max(pMax, currentPrice + 0.5);
    }
    const pRange = Math.max(0.5, pMax - pMin);

    // Compute Centerline 3D Helix Path
    const centerPath: THREE.Vector3[] = [];
    const tubeRadii: number[] = [];
    const isUpList: boolean[] = [];
    const bodyVolList: number[] = [];

    for (let i = 0; i < N; i++) {
      const c = recent[i];
      const t = i / (N - 1); // 0 (oldest at back) to 1 (newest at front)

      // Curls into a gentle helix around vertical axis
      // t = 1 is at front (angle = 0, z = +R)
      const angle = (t - 1.0) * 2.8 * Math.PI;
      const helixRadius = 1.45 + t * 0.35;
      const x = Math.sin(angle) * helixRadius;
      const z = Math.cos(angle) * helixRadius;

      // Price maps to Y in [-1.4, 1.4]
      const priceVal = i === N - 1 && currentPrice > 0 ? currentPrice : c.close;
      const y = -1.4 + ((priceVal - pMin) / pRange) * 2.8;

      centerPath.push(new THREE.Vector3(x, y, z));

      // Range = Volatility -> tube radius
      const range = Math.max(0.2, c.high - c.low);
      const r = THREE.MathUtils.clamp(0.08 + (range / pRange) * 1.5, 0.1, 0.38);
      tubeRadii.push(r);

      isUpList.push(c.close >= c.open);
      bodyVolList.push(c.volume || 1);
    }

    // Distribute points along the tube
    const totalPoints = this.maxPoints;
    const ptsPerCandle = Math.floor(totalPoints / N);
    const actualTotal = ptsPerCandle * N;

    const positions = new Float32Array(actualTotal * 3);
    const baseColors = new Float32Array(actualTotal * 3);
    const alphas = new Float32Array(actualTotal);
    const candleIndices = new Float32Array(actualTotal);
    const noiseOffsets = new Float32Array(actualTotal * 3);
    const sliceYs = new Float32Array(actualTotal);

    const teal = new THREE.Color('#22e08a');
    const red = new THREE.Color('#ff3b6b');
    const paleGold = new THREE.Color('#f2e6c4');

    let pIdx = 0;
    for (let i = 0; i < N; i++) {
      const center = centerPath[i];
      const r = tubeRadii[i];
      const isUp = isUpList[i];
      const t = i / (N - 1); // 0 (oldest) to 1 (newest)
      const normIdx = t;

      // Tangent
      const prev = centerPath[Math.max(0, i - 1)];
      const next = centerPath[Math.min(N - 1, i + 1)];
      const tangent = next.clone().sub(prev).normalize();
      if (tangent.lengthSq() < 0.001) tangent.set(0, 1, 0);

      // Normal and Binormal perpendicular to tangent
      const up = Math.abs(tangent.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const normal = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

      for (let j = 0; j < ptsPerCandle; j++) {
        const phi = Math.random() * Math.PI * 2;
        // Radial distribution inside the tube with denser skin
        const radFrac = 0.35 + Math.sqrt(Math.random()) * 0.65;
        const rad = r * radFrac;

        // Offset from center
        const offset = normal.clone().multiplyScalar(Math.cos(phi) * rad)
          .add(binormal.clone().multiplyScalar(Math.sin(phi) * rad));

        const px = center.x + offset.x;
        const py = center.y + offset.y;
        const pz = center.z + offset.z;

        positions[pIdx * 3 + 0] = px;
        positions[pIdx * 3 + 1] = py;
        positions[pIdx * 3 + 2] = pz;

        sliceYs[pIdx] = center.y;

        // Space noise offset for intro converge
        noiseOffsets[pIdx * 3 + 0] = (Math.random() - 0.5) * 5.0;
        noiseOffsets[pIdx * 3 + 1] = (Math.random() - 0.5) * 4.0;
        noiseOffsets[pIdx * 3 + 2] = (Math.random() - 0.5) * 5.0;

        // Color: body points teal or red, outer perimeter/wicks pale gold
        let col: THREE.Color;
        if (radFrac > 0.88) {
          col = paleGold;
        } else {
          col = isUp ? teal : red;
        }

        baseColors[pIdx * 3 + 0] = col.r;
        baseColors[pIdx * 3 + 1] = col.g;
        baseColors[pIdx * 3 + 2] = col.b;

        // Alpha: oldest candle fades out (~0.28), newest at front is brightest (~0.9)
        const ageAlpha = 0.28 + t * 0.62;
        alphas[pIdx] = ageAlpha;

        // Candle normalized index for scan pulse traveling along tube
        candleIndices[pIdx] = normIdx;

        pIdx++;
      }
    }

    // Create or update Points geometry
    if (!this.pointsGeo) {
      this.pointsGeo = new THREE.BufferGeometry();
    }
    this.pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.pointsGeo.setAttribute('aBaseColor', new THREE.BufferAttribute(baseColors, 3));
    this.pointsGeo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    this.pointsGeo.setAttribute('aCandleIndex', new THREE.BufferAttribute(candleIndices, 1));
    this.pointsGeo.setAttribute('aNoise', new THREE.BufferAttribute(noiseOffsets, 3));
    this.pointsGeo.setAttribute('aSliceY', new THREE.BufferAttribute(sliceYs, 1));

    if (!this.pointsMaterial) {
      this.initShaderMaterial();
    }

    if (!this.pointsMesh && this.pointsMaterial) {
      this.pointsMesh = new THREE.Points(this.pointsGeo, this.pointsMaterial);
      this.group.add(this.pointsMesh);
    }

    // Update Anchor Positions from Real Data
    // 1. Momentum: newest end of the tube
    const newestCenter = centerPath[N - 1];
    this.anchorLocalPositions.set('momentum', newestCenter.clone().add(new THREE.Vector3(0.2, 0.1, 0.2)));

    // 2. Sentiment: highest point of sculpture
    let highestIdx = 0;
    let highestY = -Infinity;
    for (let i = 0; i < N; i++) {
      if (centerPath[i].y > highestY) {
        highestY = centerPath[i].y;
        highestIdx = i;
      }
    }
    this.anchorLocalPositions.set('sentiment', centerPath[highestIdx].clone().add(new THREE.Vector3(0, 0.25, 0)));

    // 3. POC/Profile: POC price level height
    const pocPrice = originLevels[0]?.priceLevel || (currentPrice > 0 ? currentPrice : recent[N - 1].close);
    const pocY = -1.4 + ((pocPrice - pMin) / pRange) * 2.8;
    this.anchorLocalPositions.set('poc', new THREE.Vector3(-1.3, pocY, 0.6));

    // 4. Absorption: nearest demand/supply zone height
    const nearZonePrice = buyZones[0]?.mid || sellZones[0]?.mid || (currentPrice > 0 ? currentPrice - 1.5 : recent[N - 1].close);
    const zoneY = -1.4 + ((nearZonePrice - pMin) / pRange) * 2.8;
    this.anchorLocalPositions.set('absorption', new THREE.Vector3(1.3, zoneY, 0.6));

    // 5. Tick data: low front
    this.anchorLocalPositions.set('tickdata', new THREE.Vector3(0.1, -1.3, 1.4));

    // 6. FVG/OB: height from middle
    this.anchorLocalPositions.set('fvg', new THREE.Vector3(-1.1, (highestY + pocY) * 0.5, -0.4));

    // Update Translucent S/R and Zone Discs at real price heights
    this.updateDiscs(pMin, pRange, supportLevel, resistanceLevel, buyZones, sellZones);
  }

  // --- TRANSLUCENT S/R & ZONE DISCS ---
  private updateDiscs(
    pMin: number,
    pRange: number,
    supportLevel: number,
    resistanceLevel: number,
    buyZones: ZoneItem[],
    sellZones: ZoneItem[]
  ) {
    // Clear old discs
    for (const d of this.discMeshes) {
      this.discsGroup.remove(d);
      d.geometry.dispose();
      (d.material as THREE.Material).dispose();
    }
    this.discMeshes = [];
    this.discAnchors = [];

    const getY = (val: number) => -1.4 + ((val - pMin) / pRange) * 2.8;

    // Resistance Disc (Red/Amber translucent ring)
    if (resistanceLevel > 0) {
      const y = getY(resistanceLevel);
      if (y >= -1.8 && y <= 1.8) {
        const disc = this.createTranslucentDisc(y, '#ff3b6b', 0.22, 1.8);
        this.discMeshes.push(disc);
        this.discsGroup.add(disc);
        this.discAnchors.push({
          id: 'res_disc',
          label: `RES $${resistanceLevel.toFixed(1)}`,
          price: resistanceLevel,
          worldPos: new THREE.Vector3(1.3, y, 0.4),
          color: '#ff3b6b',
        });
      }
    }

    // Support Disc (Teal/Green translucent ring)
    if (supportLevel > 0) {
      const y = getY(supportLevel);
      if (y >= -1.8 && y <= 1.8) {
        const disc = this.createTranslucentDisc(y, '#22e08a', 0.22, 1.8);
        this.discMeshes.push(disc);
        this.discsGroup.add(disc);
        this.discAnchors.push({
          id: 'sup_disc',
          label: `SUP $${supportLevel.toFixed(1)}`,
          price: supportLevel,
          worldPos: new THREE.Vector3(-1.3, y, 0.4),
          color: '#22e08a',
        });
      }
    }

    // Demand Zone (Teal blob ring)
    if (buyZones.length > 0) {
      const y = getY(buyZones[0].mid);
      if (y >= -1.8 && y <= 1.8) {
        const disc = this.createTranslucentDisc(y, '#22e08a', 0.18, 1.55);
        this.discMeshes.push(disc);
        this.discsGroup.add(disc);
        this.discAnchors.push({
          id: 'demand_disc',
          label: `DEMAND $${buyZones[0].mid.toFixed(1)}`,
          price: buyZones[0].mid,
          worldPos: new THREE.Vector3(1.1, y, -0.4),
          color: '#22e08a',
        });
      }
    }

    // Supply Zone (Red blob ring)
    if (sellZones.length > 0) {
      const y = getY(sellZones[0].mid);
      if (y >= -1.8 && y <= 1.8) {
        const disc = this.createTranslucentDisc(y, '#ff3b6b', 0.18, 1.55);
        this.discMeshes.push(disc);
        this.discsGroup.add(disc);
        this.discAnchors.push({
          id: 'supply_disc',
          label: `SUPPLY $${sellZones[0].mid.toFixed(1)}`,
          price: sellZones[0].mid,
          worldPos: new THREE.Vector3(-1.1, y, -0.4),
          color: '#ff3b6b',
        });
      }
    }
  }

  private createTranslucentDisc(y: number, colorHex: string, opacity: number, radius: number): THREE.Mesh {
    const geo = new THREE.RingGeometry(radius - 0.25, radius, 36);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = y;
    return mesh;
  }

  // --- CUSTOM SHADER MATERIAL (Anti-Overexposure + Normal Blending) ---
  private initShaderMaterial() {
    this.pointsMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0.0 },
        uDpr: { value: Math.min(window.devicePixelRatio || 1, 1.5) },
        uIntroProgress: { value: 1.0 },
        uPulseProgress: { value: -1.0 },
        uPulseColor: { value: new THREE.Color('#22e08a') },
        uPulseIntensity: { value: 0.0 },
        uPulseLength: { value: 0.2 },
        uGlitchAmount: { value: 0.0 },
        uGlitchSliceY: { value: 0.0 },
        uGlobalTint: { value: new THREE.Color('#f2e6c4') },
        uGlobalAlpha: { value: 1.0 },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uDpr;
        uniform float uIntroProgress;
        uniform float uPulseProgress;
        uniform vec3 uPulseColor;
        uniform float uPulseIntensity;
        uniform float uPulseLength;
        uniform float uGlitchAmount;
        uniform float uGlitchSliceY;
        uniform vec3 uGlobalTint;

        attribute vec3 aBaseColor;
        attribute float aAlpha;
        attribute float aCandleIndex;
        attribute vec3 aNoise;
        attribute float aSliceY;

        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          // Intro 2.5s noise convergence
          float introEase = smoothstep(0.0, 1.0, uIntroProgress);
          vec3 targetPos = position;

          // Subtle Glitch displacement on top 10% big ticks
          if (uGlitchAmount > 0.0) {
            float sliceDist = abs(aSliceY - uGlitchSliceY);
            if (sliceDist < 0.35) {
              targetPos.x += sin(targetPos.y * 25.0 + uTime * 15.0) * uGlitchAmount * 0.18;
              targetPos.z += cos(targetPos.x * 20.0 + uTime * 15.0) * uGlitchAmount * 0.12;
            }
          }

          vec3 finalPos = mix(aNoise, targetPos, introEase);
          vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          // Size attenuation (~1.4px to 2.2px x DPR)
          float baseSize = 1.65 * uDpr;
          gl_PointSize = baseSize * (280.0 / -mvPosition.z);
          gl_PointSize = clamp(gl_PointSize, 1.0, 4.5);

          // Color calculation
          vec3 col = aBaseColor;

          // Blend with Global Tint (Buy teal / Sell red / Gold balanced)
          col = mix(col, uGlobalTint, 0.45);

          // Scan pulse traveling from newest end backwards
          if (uPulseIntensity > 0.0) {
            float pDist = abs(aCandleIndex - uPulseProgress);
            if (pDist < uPulseLength) {
              float pFactor = (1.0 - (pDist / uPulseLength)) * uPulseIntensity;
              col = mix(col, uPulseColor, pFactor * 0.85);
              col += uPulseColor * (pFactor * 0.4);
            }
          }

          vColor = col;
          vAlpha = aAlpha * introEase;
        }
      `,
      fragmentShader: `
        uniform float uGlobalAlpha;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          // Soft round circular sprite
          vec2 coord = gl_PointCoord - vec2(0.5);
          float dist = length(coord);
          if (dist > 0.5) discard;

          float softEdge = smoothstep(0.5, 0.12, dist);
          float alpha = vAlpha * softEdge * uGlobalAlpha;

          gl_FragColor = vec4(vColor, alpha);
        }
      `,
    });
  }

  // --- TRIGGER SCAN PULSE ON EVERY REAL TICK ---
  public triggerTickPulse(event: TickPulseEvent) {
    this.pulseActive = true;
    this.pulseProgress = 1.0; // starts at newest candle (1.0) and travels to oldest (0.0)
    this.pulseColor = event.direction === 'BUY'
      ? new THREE.Color('#22e08a')
      : event.direction === 'SELL'
      ? new THREE.Color('#ff3b6b')
      : new THREE.Color('#f2e6c4');

    // Bigger tick delta = brighter and longer pulse
    const d = Math.abs(event.delta);
    this.pulseIntensity = Math.min(1.0, 0.55 + d * 0.8);
    this.pulseLength = Math.min(0.4, 0.18 + d * 0.25);

    // Subtle glitch trigger on big tick delta (> $0.40)
    if (d > 0.4 && !this.isLite) {
      this.glitchAmount = Math.min(0.8, d * 0.9);
      this.glitchSliceY = (Math.random() - 0.5) * 2.2;
      this.glitchTimer = 0.2; // 200ms
    }
  }

  // --- SIGNAL / TP / SL / COOLDOWN HOOKS ---
  public triggerSignal(side: 'BUY' | 'SELL') {
    this.scanRingActive = true;
    this.scanRingProgress = 0;
    this.scanRingMat.color = side === 'BUY' ? this.buyColor : this.sellColor;
    this.lockRingMat.color = side === 'BUY' ? this.buyColor : this.sellColor;
  }

  public triggerResult(result: 'TP' | 'SL') {
    if (result === 'TP') {
      this.tpFlashActive = true;
      this.tpFlashProgress = 0;
    } else {
      this.slFlashActive = true;
      this.slFlashProgress = 0;
    }
  }

  public setCooldown(secondsLeft: number) {
    if (secondsLeft > 0) {
      this.cooldownRingMat.opacity = 0.65;
      const angle = (Math.min(secondsLeft, 1800) / 1800) * Math.PI * 2;
      this.cooldownRingMesh.rotation.z = angle;
    } else {
      this.cooldownRingMat.opacity = 0.0;
    }
  }

  // --- 6 CAMERA-FACING ANCHORS FOR SCAN LABELS ---
  public getLabelAnchors(): ScanLabelAnchor[] {
    const list: ScanLabelAnchor[] = [];
    const centerWorld = new THREE.Vector3().setFromMatrixPosition(this.group.matrixWorld);

    const defs = [
      { id: 'momentum', numId: '01', label: 'MOMENTUM' },
      { id: 'sentiment', numId: '02', label: 'SENTIMENT' },
      { id: 'poc', numId: '03', label: 'POC/PROFILE' },
      { id: 'absorption', numId: '04', label: 'ABSORPTION' },
      { id: 'tickdata', numId: '05', label: 'TICK DATA' },
      { id: 'fvg', numId: '06', label: 'FVG/OB' },
    ];

    for (const def of defs) {
      const local = this.anchorLocalPositions.get(def.id) || new THREE.Vector3(0, 0, 0);
      const worldPos = local.clone().applyMatrix4(this.group.matrixWorld);
      const normal = worldPos.clone().sub(centerWorld).normalize();
      list.push({
        id: def.id,
        numId: def.numId,
        label: def.label,
        worldPos,
        normal,
      });
    }

    this.anchorCache = list;
    return list;
  }

  // --- TRANSLUCENT S/R & ZONE DISC LABELS ---
  public getDiscAnchors(): DiscAnchor[] {
    return this.discAnchors.map((d) => ({
      ...d,
      worldPos: d.worldPos.clone().applyMatrix4(this.group.matrixWorld),
    }));
  }

  // --- MAIN ANIMATION UPDATE ---
  public update(deltaSec: number, introProgress: number, p4State: Phase4State, buyRatio: number = 50) {
    const elapsed = performance.now() * 0.001;

    // Smooth lerp Global Tint based on live BUY/SELL ratio
    // Balanced 45-55% -> gold, BUY dominant -> teal, SELL dominant -> red
    const ratioNorm = (buyRatio - 50) / 50; // -1 to +1
    let targetTint: THREE.Color;
    if (buyRatio >= 45 && buyRatio <= 55) {
      targetTint = this.goldColor;
    } else if (ratioNorm > 0) {
      targetTint = new THREE.Color().lerpColors(this.goldColor, this.buyColor, Math.min(1.0, ratioNorm * 1.5));
    } else {
      targetTint = new THREE.Color().lerpColors(this.goldColor, this.sellColor, Math.min(1.0, Math.abs(ratioNorm) * 1.5));
    }
    this.globalTint.lerp(targetTint, deltaSec * 3.5);

    // Update Shader Uniforms
    if (this.pointsMaterial) {
      this.pointsMaterial.uniforms.uTime.value = elapsed;
      this.pointsMaterial.uniforms.uIntroProgress.value = introProgress;
      this.pointsMaterial.uniforms.uGlobalTint.value.copy(this.globalTint);

      // Tick pulse traveling backwards from newest (1.0) to oldest (0.0)
      if (this.pulseActive) {
        this.pulseProgress -= deltaSec * this.pulseSpeed;
        if (this.pulseProgress < -this.pulseLength) {
          this.pulseActive = false;
          this.pulseIntensity = 0.0;
        }
      }
      this.pointsMaterial.uniforms.uPulseProgress.value = this.pulseProgress;
      this.pointsMaterial.uniforms.uPulseColor.value.copy(this.pulseColor);
      this.pointsMaterial.uniforms.uPulseIntensity.value = this.pulseIntensity;
      this.pointsMaterial.uniforms.uPulseLength.value = this.pulseLength;

      // Glitch decay
      if (this.glitchTimer > 0) {
        this.glitchTimer -= deltaSec;
        if (this.glitchTimer <= 0) {
          this.glitchAmount = 0.0;
        }
      }
      this.pointsMaterial.uniforms.uGlitchAmount.value = this.glitchAmount;
      this.pointsMaterial.uniforms.uGlitchSliceY.value = this.glitchSliceY;
    }

    // Intro 2.5s draw-in: Fade in bounding box & floor grid as points converge
    const boxIntro = Math.min(1.0, Math.max(0.0, (introProgress - 0.25) / 0.75));
    if (this.floorGridMat) this.floorGridMat.opacity = 0.12 * boxIntro;
    if (this.boxWireframeMat) this.boxWireframeMat.opacity = 0.2 * boxIntro;
    if (this.axisTicksMat) this.axisTicksMat.opacity = 0.35 * boxIntro;

    // Space Dust gentle drift
    if (this.dustMesh && !this.isLite) {
      this.dustMesh.rotation.y += deltaSec * 0.035;
      this.dustMesh.rotation.x = Math.sin(elapsed * 0.2) * 0.04;
    }

    // Scan sweep ring animation
    if (this.scanRingActive) {
      this.scanRingProgress += deltaSec * 1.8;
      if (this.scanRingProgress <= 1.0) {
        // Sweeps top (Y = 1.8) to bottom (Y = -1.8)
        this.scanRingMesh.position.y = 1.8 - this.scanRingProgress * 3.6;
        this.scanRingMat.opacity = Math.sin(this.scanRingProgress * Math.PI) * 0.85;

        // Snapping lock ring
        this.lockRingMat.opacity = Math.sin(this.scanRingProgress * Math.PI) * 0.9;
        this.lockRingMesh.rotation.z += deltaSec * 5.0;
      } else {
        this.scanRingActive = false;
        this.scanRingMat.opacity = 0;
        this.lockRingMat.opacity = 0;
      }
    }

    // TP Flash (Gold flash)
    if (this.tpFlashActive) {
      this.tpFlashProgress += deltaSec * 2.2;
      if (this.tpFlashProgress <= 1.0) {
        const s = 1.0 + this.tpFlashProgress * 1.6;
        this.tpFlashMesh.scale.set(s, s, s);
        this.tpFlashMat.opacity = (1.0 - this.tpFlashProgress) * 0.7;
      } else {
        this.tpFlashActive = false;
        this.tpFlashMat.opacity = 0;
      }
    }

    // SL Flash (Red glitch flash)
    if (this.slFlashActive) {
      this.slFlashProgress += deltaSec * 2.2;
      if (this.slFlashProgress <= 1.0) {
        const s = 1.0 + this.slFlashProgress * 1.6;
        this.slFlashMesh.scale.set(s, s, s);
        this.slFlashMat.opacity = (1.0 - this.slFlashProgress) * 0.75;
      } else {
        this.slFlashActive = false;
        this.slFlashMat.opacity = 0;
      }
    }

    // Cooldown ring
    if (p4State.cooldownSeconds > 0) {
      this.setCooldown(p4State.cooldownSeconds);
    }
  }

  public dispose() {
    if (this.pointsMesh) {
      this.group.remove(this.pointsMesh);
      this.pointsGeo?.dispose();
      this.pointsMaterial?.dispose();
    }
    if (this.dustMesh) {
      this.group.remove(this.dustMesh);
      this.dustGeo?.dispose();
      this.dustMaterial?.dispose();
    }
    for (const d of this.discMeshes) {
      this.discsGroup.remove(d);
      d.geometry.dispose();
      (d.material as THREE.Material).dispose();
    }
    this.discMeshes = [];
    this.discAnchors = [];

    this.floorGridMat?.dispose();
    this.boxWireframeMat?.dispose();
    this.axisTicksMat?.dispose();

    this.scanRingMesh.geometry.dispose();
    this.scanRingMat.dispose();
    this.lockRingMesh.geometry.dispose();
    this.lockRingMat.dispose();
    this.tpFlashMesh.geometry.dispose();
    this.tpFlashMat.dispose();
    this.slFlashMesh.geometry.dispose();
    this.slFlashMat.dispose();
    this.cooldownRingMesh.geometry.dispose();
    this.cooldownRingMat.dispose();
  }
}
