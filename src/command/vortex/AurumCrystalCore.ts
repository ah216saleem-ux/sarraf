import * as THREE from 'three';
import { Phase4State } from './types';

export interface TickRippleEvent {
  direction: 'BUY' | 'SELL' | 'FLAT';
  delta: number;
}

export class AurumCrystalCore {
  public group: THREE.Group;

  // 1. Core Faceted Crystal & Inner Core
  private crystalMesh: THREE.Mesh;
  private crystalMat: THREE.MeshPhysicalMaterial;
  private innerCoreMesh: THREE.Mesh;
  private innerCoreMat: THREE.MeshStandardMaterial;

  // 2. Shell Nodes & Lines
  private nodeMesh: THREE.InstancedMesh;
  private nodeMat: THREE.MeshStandardMaterial;
  private lineSegments: THREE.LineSegments;
  private lineMat: THREE.LineBasicMaterial;
  private nodeCount: number;
  private nodePositions: THREE.Vector3[] = [];
  private nodeIntensities: Float32Array; // flash decay per node
  private dummy = new THREE.Object3D();

  // 3. Three Thin Torus Rings
  private ringsGroup: THREE.Group;
  private ring1: THREE.Mesh;
  private ring2: THREE.Mesh;
  private ring3: THREE.Mesh;
  private ringMat1: THREE.MeshStandardMaterial;
  private ringMat2: THREE.MeshStandardMaterial;
  private ringMat3: THREE.MeshStandardMaterial;

  // 4. Effects: Shockwave, Lock-ring, TP flash, SL flash, Cooldown ring
  private shockwaveMesh: THREE.Mesh;
  private shockwaveMat: THREE.MeshBasicMaterial;
  private shockwaveProgress = 0;
  private shockwaveActive = false;

  private lockRingMesh: THREE.Mesh;
  private lockRingMat: THREE.MeshStandardMaterial;

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

  // Real lighting inside group/scene
  public lightsGroup: THREE.Group;
  private keyLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;

  // Color targets & active lerp color
  private activeColor = new THREE.Color('#f5c451');
  private targetColor = new THREE.Color('#f5c451');
  private goldColor = new THREE.Color('#f5c451');
  private buyColor = new THREE.Color('#22e08a');
  private sellColor = new THREE.Color('#ff3b6b');

  // Ripple state
  private rippleWavefront = -1; // radius of expanding wavefront
  private rippleSpeed = 4.5;
  private rippleActive = false;
  private rippleColor = new THREE.Color('#22e08a');
  private rippleStrength = 1.0;

  constructor(isMobile: boolean = false) {
    this.group = new THREE.Group();
    this.lightsGroup = new THREE.Group();
    this.nodeCount = isMobile ? 40 : 90;

    // --- LIGHTING ---
    this.hemiLight = new THREE.HemisphereLight(0xfff4d6, 0x141824, 0.7);
    this.lightsGroup.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
    this.keyLight.position.set(3, 4, 4);
    this.lightsGroup.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0xf5c451, 1.1);
    this.rimLight.position.set(-3, -2, -3);
    this.lightsGroup.add(this.rimLight);

    // --- 1. CORE CRYSTAL ---
    // Faceted icosahedron crystal (detail 1), flat-shaded, metalness 0.9, roughness 0.25, clearcoat
    const crystalGeo = new THREE.IcosahedronGeometry(0.72, 1);
    this.crystalMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#f5c451'),
      emissive: new THREE.Color('#8a6818'),
      emissiveIntensity: 0.35,
      metalness: 0.9,
      roughness: 0.25,
      clearcoat: 0.8,
      clearcoatRoughness: 0.2,
      flatShading: true,
      reflectivity: 0.9,
    });
    this.crystalMesh = new THREE.Mesh(crystalGeo, this.crystalMat);
    this.group.add(this.crystalMesh);

    // Small emissive inner core
    const innerGeo = new THREE.IcosahedronGeometry(0.24, 0);
    this.innerCoreMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#f5c451'),
      emissive: new THREE.Color('#f5c451'),
      emissiveIntensity: 1.2,
      flatShading: true,
      metalness: 0.5,
      roughness: 0.3,
    });
    this.innerCoreMesh = new THREE.Mesh(innerGeo, this.innerCoreMat);
    this.group.add(this.innerCoreMesh);

    // --- 2. NETWORK SHELL ---
    // 90 nodes (40 on mobile) distributed on a sphere (radius 1.7) around the crystal
    const shellRadius = 1.72;
    this.nodePositions = [];
    this.nodeIntensities = new Float32Array(this.nodeCount);

    // Fibonacci sphere distribution for even spread
    const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
    for (let i = 0; i < this.nodeCount; i++) {
      const y = 1 - (i / (this.nodeCount - 1)) * 2; // y goes from 1 to -1
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = phi * i;
      const x = Math.cos(theta) * radiusAtY;
      const z = Math.sin(theta) * radiusAtY;
      this.nodePositions.push(new THREE.Vector3(x * shellRadius, y * shellRadius, z * shellRadius));
    }

    // InstancedMesh for small node spheres
    const nodeSphereGeo = new THREE.SphereGeometry(0.038, 8, 8);
    this.nodeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#f5c451'),
      emissive: new THREE.Color('#f5c451'),
      emissiveIntensity: 0.6,
      metalness: 0.8,
      roughness: 0.3,
    });
    this.nodeMesh = new THREE.InstancedMesh(nodeSphereGeo, this.nodeMat, this.nodeCount);
    for (let i = 0; i < this.nodeCount; i++) {
      this.dummy.position.copy(this.nodePositions[i]);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.nodeMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.nodeMesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.nodeMesh);

    // Lines joined to 3 nearest neighbours
    const lineIndices: number[] = [];
    for (let i = 0; i < this.nodeCount; i++) {
      // Find 3 nearest neighbours
      const distances: { idx: number; dist: number }[] = [];
      for (let j = 0; j < this.nodeCount; j++) {
        if (i === j) continue;
        distances.push({ idx: j, dist: this.nodePositions[i].distanceTo(this.nodePositions[j]) });
      }
      distances.sort((a, b) => a.dist - b.dist);
      for (let k = 0; k < Math.min(3, distances.length); k++) {
        const neighbor = distances[k].idx;
        // Avoid duplicate pair
        if (i < neighbor) {
          lineIndices.push(i, neighbor);
        }
      }
    }

    const linePoints: number[] = [];
    for (let idx = 0; idx < lineIndices.length; idx += 2) {
      const a = this.nodePositions[lineIndices[idx]];
      const b = this.nodePositions[lineIndices[idx + 1]];
      linePoints.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
    this.lineMat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#f5c451'),
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.lineSegments = new THREE.LineSegments(lineGeo, this.lineMat);
    this.group.add(this.lineSegments);

    // --- 3. THREE THIN TORUS RINGS ---
    this.ringsGroup = new THREE.Group();

    const ringGeo1 = new THREE.TorusGeometry(1.45, 0.012, 8, 80);
    this.ringMat1 = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#f5c451'),
      metalness: 0.85,
      roughness: 0.3,
      emissive: new THREE.Color('#7a5810'),
      emissiveIntensity: 0.4,
    });
    this.ring1 = new THREE.Mesh(ringGeo1, this.ringMat1);
    this.ring1.rotation.set(0.4, 0.2, 0.1);
    this.ringsGroup.add(this.ring1);

    const ringGeo2 = new THREE.TorusGeometry(1.88, 0.012, 8, 90);
    this.ringMat2 = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#f5c451'),
      metalness: 0.85,
      roughness: 0.3,
      emissive: new THREE.Color('#7a5810'),
      emissiveIntensity: 0.4,
    });
    this.ring2 = new THREE.Mesh(ringGeo2, this.ringMat2);
    this.ring2.rotation.set(-0.5, 0.8, -0.3);
    this.ringsGroup.add(this.ring2);

    const ringGeo3 = new THREE.TorusGeometry(2.25, 0.011, 8, 100);
    this.ringMat3 = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#f5c451'),
      metalness: 0.85,
      roughness: 0.3,
      emissive: new THREE.Color('#7a5810'),
      emissiveIntensity: 0.35,
    });
    this.ring3 = new THREE.Mesh(ringGeo3, this.ringMat3);
    this.ring3.rotation.set(0.9, -0.4, 0.6);
    this.ringsGroup.add(this.ring3);

    this.group.add(this.ringsGroup);

    // --- 4. EFFECTS ---
    // Signal Shockwave ring
    const waveGeo = new THREE.TorusGeometry(1.0, 0.025, 8, 64);
    this.shockwaveMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#22e08a'),
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.shockwaveMesh = new THREE.Mesh(waveGeo, this.shockwaveMat);
    this.shockwaveMesh.rotation.x = Math.PI / 2;
    this.group.add(this.shockwaveMesh);

    // Lock-ring snapping around crystal
    const lockGeo = new THREE.TorusGeometry(0.88, 0.02, 8, 48);
    this.lockRingMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#f5c451'),
      emissive: new THREE.Color('#f5c451'),
      emissiveIntensity: 0.8,
      metalness: 0.9,
      roughness: 0.2,
      transparent: true,
      opacity: 0.0,
    });
    this.lockRingMesh = new THREE.Mesh(lockGeo, this.lockRingMat);
    this.group.add(this.lockRingMesh);

    // TP Gold Flash shell
    const tpGeo = new THREE.IcosahedronGeometry(0.82, 1);
    this.tpFlashMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#f5c451'),
      transparent: true,
      opacity: 0.0,
      wireframe: true,
      depthWrite: false,
    });
    this.tpFlashMesh = new THREE.Mesh(tpGeo, this.tpFlashMat);
    this.group.add(this.tpFlashMesh);

    // SL Red Flash shell
    const slGeo = new THREE.IcosahedronGeometry(0.82, 1);
    this.slFlashMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff3b6b'),
      transparent: true,
      opacity: 0.0,
      wireframe: true,
      depthWrite: false,
    });
    this.slFlashMesh = new THREE.Mesh(slGeo, this.slFlashMat);
    this.group.add(this.slFlashMesh);

    // Cooldown countdown ring
    const cdGeo = new THREE.TorusGeometry(2.55, 0.015, 8, 80);
    this.cooldownRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#8a96a8'),
      transparent: true,
      opacity: 0.0,
    });
    this.cooldownRingMesh = new THREE.Mesh(cdGeo, this.cooldownRingMat);
    this.cooldownRingMesh.rotation.x = Math.PI / 2;
    this.group.add(this.cooldownRingMesh);
  }

  // Returns 6 distinct node world positions for the HUD floating labels
  public getAnchorNodePosition(index: number): THREE.Vector3 {
    const indices = [4, 15, 27, 42, 58, 73];
    const targetIdx = (indices[index % indices.length] || 0) % this.nodeCount;
    return this.nodePositions[targetIdx].clone();
  }

  // Live color update based on Buy/Sell dominance
  public updateColor(buyRatio: number) {
    // buyRatio 0..100
    // Gold when balanced (45-55%), Teal-green #22e08a when BUY is dominant, Red #ff3b6b when SELL dominant
    if (buyRatio >= 45 && buyRatio <= 55) {
      this.targetColor.copy(this.goldColor);
    } else if (buyRatio > 55) {
      // Lerp between gold and buyColor based on dominance (55 -> 100)
      const t = Math.min(1.0, (buyRatio - 55) / 30);
      this.targetColor.copy(this.goldColor).lerp(this.buyColor, t);
    } else {
      // Lerp between gold and sellColor based on dominance (45 -> 0)
      const t = Math.min(1.0, (45 - buyRatio) / 30);
      this.targetColor.copy(this.goldColor).lerp(this.sellColor, t);
    }
  }

  // Every real tick sends a bright pulse from the crystal along lines to shell nodes
  public triggerTickRipple(tick: TickRippleEvent) {
    this.rippleActive = true;
    this.rippleWavefront = 0.0;
    const isUp = tick.direction === 'BUY' || tick.delta > 0;
    const isFlat = tick.direction === 'FLAT' || Math.abs(tick.delta) < 0.01;
    if (isFlat) {
      this.rippleColor.copy(this.goldColor);
    } else if (isUp) {
      this.rippleColor.copy(this.buyColor);
    } else {
      this.rippleColor.copy(this.sellColor);
    }
    this.rippleStrength = Math.min(2.0, Math.max(0.6, Math.abs(tick.delta) * 1.5 || 1.0));
  }

  // Phase 4 Hooks
  public triggerSignal(side: 'BUY' | 'SELL') {
    this.shockwaveActive = true;
    this.shockwaveProgress = 0;
    this.shockwaveMat.color.set(side === 'BUY' ? '#22e08a' : '#ff3b6b');
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

  public update(deltaSec: number, introProgress: number, p4State: Phase4State) {
    const elapsed = performance.now() * 0.001;

    // Smooth lerp activeColor toward targetColor (never white)
    this.activeColor.lerp(this.targetColor, deltaSec * 3.0);

    // Apply color to crystal emissive, nodes, lines, rings
    this.crystalMat.color.copy(this.activeColor);
    this.crystalMat.emissive.copy(this.activeColor).multiplyScalar(0.4);
    this.innerCoreMat.color.copy(this.activeColor);
    this.innerCoreMat.emissive.copy(this.activeColor);
    this.nodeMat.color.copy(this.activeColor);
    this.nodeMat.emissive.copy(this.activeColor).multiplyScalar(0.7);
    this.lineMat.color.copy(this.activeColor);
    this.ringMat1.color.copy(this.activeColor);
    this.ringMat2.color.copy(this.activeColor);
    this.ringMat3.color.copy(this.activeColor);

    // --- 1. CORE ROTATION & BREATHING ---
    // Scale breathes 1.00 - 1.03
    const breathe = 1.0 + Math.sin(elapsed * 2.0) * 0.015;
    const introScale = Math.min(1.0, Math.max(0.01, introProgress));

    this.crystalMesh.scale.set(breathe * introScale, breathe * introScale, breathe * introScale);
    this.innerCoreMesh.scale.set(breathe * introScale, breathe * introScale, breathe * introScale);

    this.crystalMesh.rotation.y += deltaSec * 0.35;
    this.crystalMesh.rotation.x += deltaSec * 0.15;
    this.innerCoreMesh.rotation.y -= deltaSec * 0.5;

    // --- 2. SHELL ROTATION IN OPPOSITE DIRECTION ---
    const shellRotDelta = -deltaSec * 0.22;
    this.nodeMesh.rotation.y += shellRotDelta;
    this.nodeMesh.rotation.z += shellRotDelta * 0.3;
    this.lineSegments.rotation.y += shellRotDelta;
    this.lineSegments.rotation.z += shellRotDelta * 0.3;

    // --- 3. RINGS ROTATION ---
    this.ring1.rotation.z += deltaSec * 0.45;
    this.ring2.rotation.y -= deltaSec * 0.35;
    this.ring3.rotation.x += deltaSec * 0.25;

    // --- 4. TICK RIPPLE EXPANSION & NODE FLASH (fade over 600ms) ---
    if (this.rippleActive) {
      this.rippleWavefront += deltaSec * this.rippleSpeed;
      if (this.rippleWavefront > 2.5) {
        this.rippleActive = false;
      }
    }

    // Update node flash intensities
    let nodesUpdated = false;
    for (let i = 0; i < this.nodeCount; i++) {
      if (this.rippleActive) {
        const d = this.nodePositions[i].length();
        if (Math.abs(d - this.rippleWavefront) < 0.35) {
          this.nodeIntensities[i] = Math.max(this.nodeIntensities[i], this.rippleStrength);
        }
      }

      // Decay over ~600ms (deltaSec / 0.6 = deltaSec * 1.66)
      if (this.nodeIntensities[i] > 0) {
        this.nodeIntensities[i] = Math.max(0, this.nodeIntensities[i] - deltaSec * 1.66);
        const scale = 1.0 + this.nodeIntensities[i] * 0.6;
        this.dummy.position.copy(this.nodePositions[i]);
        this.dummy.scale.set(scale * introScale, scale * introScale, scale * introScale);
        this.dummy.updateMatrix();
        this.nodeMesh.setMatrixAt(i, this.dummy.matrix);
        nodesUpdated = true;
      } else if (introScale < 0.99) {
        this.dummy.position.copy(this.nodePositions[i]);
        this.dummy.scale.set(introScale, introScale, introScale);
        this.dummy.updateMatrix();
        this.nodeMesh.setMatrixAt(i, this.dummy.matrix);
        nodesUpdated = true;
      }
    }
    if (nodesUpdated) {
      this.nodeMesh.instanceMatrix.needsUpdate = true;
    }

    // --- 5. EFFECTS ---
    // Signal Shockwave & Lock-ring
    if (this.shockwaveActive) {
      this.shockwaveProgress += deltaSec * 1.8;
      if (this.shockwaveProgress <= 1.0) {
        const waveScale = this.shockwaveProgress * 3.8;
        this.shockwaveMesh.scale.set(waveScale, waveScale, waveScale);
        this.shockwaveMat.opacity = (1.0 - this.shockwaveProgress) * 0.75;

        // Snap lock ring
        this.lockRingMat.opacity = Math.sin(this.shockwaveProgress * Math.PI) * 0.85;
        this.lockRingMesh.rotation.z += deltaSec * 4.0;
      } else {
        this.shockwaveActive = false;
        this.shockwaveMat.opacity = 0;
        this.lockRingMat.opacity = 0;
      }
    }

    // TP Flash (Gold flash)
    if (this.tpFlashActive) {
      this.tpFlashProgress += deltaSec * 2.2;
      if (this.tpFlashProgress <= 1.0) {
        const s = 1.0 + this.tpFlashProgress * 1.8;
        this.tpFlashMesh.scale.set(s, s, s);
        this.tpFlashMat.opacity = (1.0 - this.tpFlashProgress) * 0.7;
      } else {
        this.tpFlashActive = false;
        this.tpFlashMat.opacity = 0;
      }
    }

    // SL Flash (Red flash)
    if (this.slFlashActive) {
      this.slFlashProgress += deltaSec * 2.2;
      if (this.slFlashProgress <= 1.0) {
        const s = 1.0 + this.slFlashProgress * 1.8;
        this.slFlashMesh.scale.set(s, s, s);
        this.slFlashMat.opacity = (1.0 - this.slFlashProgress) * 0.75;
      } else {
        this.slFlashActive = false;
        this.slFlashMat.opacity = 0;
      }
    }

    if (p4State.cooldownSeconds > 0) {
      this.setCooldown(p4State.cooldownSeconds);
    }
  }

  public dispose() {
    this.crystalMesh.geometry.dispose();
    this.crystalMat.dispose();

    this.innerCoreMesh.geometry.dispose();
    this.innerCoreMat.dispose();

    this.nodeMesh.geometry.dispose();
    this.nodeMat.dispose();

    this.lineSegments.geometry.dispose();
    this.lineMat.dispose();

    this.ring1.geometry.dispose();
    this.ringMat1.dispose();
    this.ring2.geometry.dispose();
    this.ringMat2.dispose();
    this.ring3.geometry.dispose();
    this.ringMat3.dispose();

    this.shockwaveMesh.geometry.dispose();
    this.shockwaveMat.dispose();

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
