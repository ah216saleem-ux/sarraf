import * as THREE from 'three';
import { Candle } from '../data/commandTypes';

export class CandleRing {
  public group: THREE.Group;
  private bodyMesh: THREE.InstancedMesh;
  private wickMesh: THREE.InstancedMesh;
  private supportRing: THREE.Mesh;
  private resistanceRing: THREE.Mesh;
  private radius = 3.35;
  private candleCount = 30;
  private dummy = new THREE.Object3D();

  private colorGreen = new THREE.Color('#22e08a');
  private colorRed = new THREE.Color('#ff3b6b');

  constructor() {
    this.group = new THREE.Group();

    // 1. Instanced Mesh for Candle Bodies
    const bodyGeo = new THREE.BoxGeometry(0.12, 1.0, 0.08);
    const bodyMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
    });
    this.bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, this.candleCount);
    this.bodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.bodyMesh);

    // 2. Instanced Mesh for Candle Wicks
    const wickGeo = new THREE.BoxGeometry(0.02, 1.0, 0.02);
    const wickMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    });
    this.wickMesh = new THREE.InstancedMesh(wickGeo, wickMat, this.candleCount);
    this.wickMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.wickMesh);

    // 3. Thin Glowing Support & Resistance Rings
    const ringGeo = new THREE.TorusGeometry(this.radius, 0.015, 8, 80);

    const supMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#22e08a'),
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
    });
    this.supportRing = new THREE.Mesh(ringGeo, supMat);
    this.supportRing.rotation.x = Math.PI / 2;
    this.supportRing.position.y = -0.55;
    this.group.add(this.supportRing);

    const resMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#f5c451'),
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
    });
    this.resistanceRing = new THREE.Mesh(ringGeo, resMat);
    this.resistanceRing.rotation.x = Math.PI / 2;
    this.resistanceRing.position.y = 0.55;
    this.group.add(this.resistanceRing);

    // Initialize with default empty matrices
    this.updateCandles([]);
  }

  public updateCandles(candles: Candle[]) {
    // Take the last 30 candles (or fewer if feed is warming up)
    const active = candles.slice(-this.candleCount);
    const count = active.length;

    // Find price range to normalize candle heights within [-0.5, +0.5]
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    for (const c of active) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    }
    const priceSpan = Math.max(0.5, maxPrice - minPrice);
    const heightScale = 0.85 / priceSpan;

    for (let i = 0; i < this.candleCount; i++) {
      if (i >= count) {
        // Hide unused instances
        this.dummy.position.set(0, -999, 0);
        this.dummy.scale.set(0.0001, 0.0001, 0.0001);
        this.dummy.updateMatrix();
        this.bodyMesh.setMatrixAt(i, this.dummy.matrix);
        this.wickMesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      const c = active[i];
      const isUp = c.close >= c.open;
      const col = isUp ? this.colorGreen : this.colorRed;

      // Newest candle is at index count - 1, positioned to face the front (+Z axis, angle 0)
      const offsetIndex = i - (count - 1);
      const angle = (offsetIndex / this.candleCount) * Math.PI * 2;

      const x = Math.sin(angle) * this.radius;
      const z = Math.cos(angle) * this.radius;

      // Candle body height and center
      const bodyHeight = Math.max(0.03, Math.abs(c.close - c.open) * heightScale);
      const bodyCenterY = ((c.open + c.close) * 0.5 - (minPrice + maxPrice) * 0.5) * heightScale;

      // Candle wick height and center
      const wickHeight = Math.max(0.05, (c.high - c.low) * heightScale);
      const wickCenterY = ((c.high + c.low) * 0.5 - (minPrice + maxPrice) * 0.5) * heightScale;

      // 1. Position & scale body
      this.dummy.position.set(x, bodyCenterY, z);
      this.dummy.rotation.set(0, angle, 0);
      this.dummy.scale.set(1.0, bodyHeight, 1.0);
      this.dummy.updateMatrix();
      this.bodyMesh.setMatrixAt(i, this.dummy.matrix);
      this.bodyMesh.setColorAt(i, col);

      // 2. Position & scale wick
      this.dummy.position.set(x, wickCenterY, z);
      this.dummy.scale.set(1.0, wickHeight, 1.0);
      this.dummy.updateMatrix();
      this.wickMesh.setMatrixAt(i, this.dummy.matrix);
      this.wickMesh.setColorAt(i, col);
    }

    this.bodyMesh.instanceMatrix.needsUpdate = true;
    if (this.bodyMesh.instanceColor) this.bodyMesh.instanceColor.needsUpdate = true;

    this.wickMesh.instanceMatrix.needsUpdate = true;
    if (this.wickMesh.instanceColor) this.wickMesh.instanceColor.needsUpdate = true;
  }

  public update(deltaSec: number, introProgress: number) {
    // Slow ambient rotation
    this.group.rotation.y += deltaSec * 0.12;

    // Scale in during intro
    const scale = Math.min(1.0, Math.max(0.001, (introProgress - 0.25) / 0.75));
    this.group.scale.set(scale, scale, scale);

    // Subtle breathing pulse for support & resistance rings
    const ringPulse = 1.0 + Math.sin(Date.now() * 0.003) * 0.03;
    this.supportRing.scale.set(ringPulse, ringPulse, ringPulse);
    this.resistanceRing.scale.set(ringPulse, ringPulse, ringPulse);
  }

  public dispose() {
    this.bodyMesh.geometry.dispose();
    if (Array.isArray(this.bodyMesh.material)) {
      this.bodyMesh.material.forEach((m) => m.dispose());
    } else {
      this.bodyMesh.material.dispose();
    }

    this.wickMesh.geometry.dispose();
    if (Array.isArray(this.wickMesh.material)) {
      this.wickMesh.material.forEach((m) => m.dispose());
    } else {
      this.wickMesh.material.dispose();
    }

    this.supportRing.geometry.dispose();
    (this.supportRing.material as THREE.Material).dispose();

    this.resistanceRing.geometry.dispose();
    (this.resistanceRing.material as THREE.Material).dispose();
  }
}
