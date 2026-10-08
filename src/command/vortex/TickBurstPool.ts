import * as THREE from 'three';

export interface TickEvent {
  direction: 'BUY' | 'SELL' | 'FLAT';
  delta: number;
}

export class TickBurstPool {
  public mesh: THREE.Points;
  private maxParticles = 100;
  private positions: Float32Array;
  private velocities: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private ages: Float32Array;
  private maxAges: Float32Array;
  private headIndex = 0;
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;

  constructor() {
    this.positions = new Float32Array(this.maxParticles * 3);
    this.velocities = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 3);
    this.sizes = new Float32Array(this.maxParticles);
    this.ages = new Float32Array(this.maxParticles);
    this.maxAges = new Float32Array(this.maxParticles);

    // Initialize all particles as dormant at origin
    for (let i = 0; i < this.maxParticles; i++) {
      this.positions[i * 3 + 0] = 0;
      this.positions[i * 3 + 1] = 0;
      this.positions[i * 3 + 2] = 0;

      this.velocities[i * 3 + 0] = 0;
      this.velocities[i * 3 + 1] = 0;
      this.velocities[i * 3 + 2] = 0;

      this.colors[i * 3 + 0] = 0.96;
      this.colors[i * 3 + 1] = 0.77;
      this.colors[i * 3 + 2] = 0.32;

      this.sizes[i] = 0;
      this.ages[i] = 1.0;
      this.maxAges[i] = 1.0;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    // Create radial circle texture for burst particles
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.3, 'rgba(255,255,255,0.8)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 32, 32);
    }
    const texture = new THREE.CanvasTexture(canvas);

    this.material = new THREE.PointsMaterial({
      size: 0.16,
      vertexColors: true,
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.mesh = new THREE.Points(this.geometry, this.material);
  }

  public emit(tick: TickEvent) {
    const burstCount = 14;
    const deltaMagnitude = Math.max(0.1, Math.min(Math.abs(tick.delta) * 1.8, 3.5));
    const isBuy = tick.direction === 'BUY';
    const isFlat = tick.direction === 'FLAT';

    // Target colors
    const r = isFlat ? 0.96 : isBuy ? 0.133 : 1.0;
    const g = isFlat ? 0.77 : isBuy ? 0.878 : 0.231;
    const b = isFlat ? 0.32 : isBuy ? 0.541 : 0.420;

    for (let j = 0; j < burstCount; j++) {
      const idx = (this.headIndex + j) % this.maxParticles;

      // Reset to core
      this.positions[idx * 3 + 0] = 0;
      this.positions[idx * 3 + 1] = 0;
      this.positions[idx * 3 + 2] = 0;

      // Random spherical distribution with outward speed
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = (1.5 + Math.random() * 2.5) * deltaMagnitude;

      this.velocities[idx * 3 + 0] = Math.sin(phi) * Math.cos(theta) * speed;
      this.velocities[idx * 3 + 1] = Math.cos(phi) * speed * 0.85;
      this.velocities[idx * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;

      // Set color (brighter if higher delta)
      const brightnessBoost = 1.0 + Math.min(deltaMagnitude * 0.4, 0.8);
      this.colors[idx * 3 + 0] = Math.min(1.0, r * brightnessBoost);
      this.colors[idx * 3 + 1] = Math.min(1.0, g * brightnessBoost);
      this.colors[idx * 3 + 2] = Math.min(1.0, b * brightnessBoost);

      this.ages[idx] = 0;
      this.maxAges[idx] = 0.5 + Math.random() * 0.4;
      this.sizes[idx] = (0.12 + Math.random() * 0.1) * deltaMagnitude;
    }

    this.headIndex = (this.headIndex + burstCount) % this.maxParticles;
  }

  public update(deltaSec: number) {
    let hasActive = false;
    const posAttr = this.geometry.attributes.position as THREE.BufferAttribute;
    const colAttr = this.geometry.attributes.color as THREE.BufferAttribute;

    for (let i = 0; i < this.maxParticles; i++) {
      if (this.ages[i] < this.maxAges[i]) {
        hasActive = true;
        this.ages[i] += deltaSec;
        const progress = this.ages[i] / this.maxAges[i];

        // Motion physics with drag damping
        this.positions[i * 3 + 0] += this.velocities[i * 3 + 0] * deltaSec;
        this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * deltaSec;
        this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * deltaSec;

        this.velocities[i * 3 + 0] *= 0.94;
        this.velocities[i * 3 + 1] *= 0.94;
        this.velocities[i * 3 + 2] *= 0.94;

        // Fade color towards zero near death
        const fade = Math.max(0, 1.0 - progress);
        this.colors[i * 3 + 0] *= fade;
        this.colors[i * 3 + 1] *= fade;
        this.colors[i * 3 + 2] *= fade;
      } else {
        // Dormant
        this.positions[i * 3 + 0] = 0;
        this.positions[i * 3 + 1] = 0;
        this.positions[i * 3 + 2] = 0;
      }
    }

    if (hasActive) {
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    }
  }

  public dispose() {
    this.geometry.dispose();
    if (this.material.map) this.material.map.dispose();
    this.material.dispose();
  }
}
