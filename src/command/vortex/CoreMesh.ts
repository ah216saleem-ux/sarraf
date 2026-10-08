import * as THREE from 'three';
import { Phase4State } from './types';

export class CoreMesh {
  public group: THREE.Group;
  private coreSphere: THREE.Mesh;
  private glowSprite: THREE.Sprite;
  private raysGroup: THREE.Group;
  private shockwaveMesh: THREE.Mesh;
  private lockRingMesh: THREE.Mesh;
  private cooldownRingMesh: THREE.Mesh;

  private shockwaveProgress = 0;
  private shockwaveActive = false;

  private tpBurstProgress = 0;
  private tpBurstActive = false;
  private tpBurstMesh: THREE.Points;

  constructor() {
    this.group = new THREE.Group();

    // 1. Central Core Sphere
    const sphereGeo = new THREE.SphereGeometry(0.32, 24, 24);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#f5c451'),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });
    this.coreSphere = new THREE.Mesh(sphereGeo, sphereMat);
    this.group.add(this.coreSphere);

    // 2. Additive Radial Glow Sprite
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255, 220, 120, 1)');
      gradient.addColorStop(0.25, 'rgba(245, 196, 81, 0.6)');
      gradient.addColorStop(0.65, 'rgba(245, 196, 81, 0.15)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
    }
    const spriteTexture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: spriteTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: 0.85,
    });
    this.glowSprite = new THREE.Sprite(spriteMat);
    this.glowSprite.scale.set(2.4, 2.4, 1.0);
    this.group.add(this.glowSprite);

    // 3. Slow Light Rays (3 intersecting thin quads rotating at different speeds)
    this.raysGroup = new THREE.Group();
    const rayGeo = new THREE.PlaneGeometry(0.12, 4.5);
    const rayMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#f5c451'),
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    for (let r = 0; r < 4; r++) {
      const ray = new THREE.Mesh(rayGeo, rayMat);
      ray.rotation.z = (r * Math.PI) / 4;
      this.raysGroup.add(ray);
    }
    this.group.add(this.raysGroup);

    // 4. Phase 4 Hooks: Shockwave ring + Lock-ring
    const waveGeo = new THREE.TorusGeometry(1.0, 0.04, 8, 48);
    const waveMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#22e08a'),
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
    });
    this.shockwaveMesh = new THREE.Mesh(waveGeo, waveMat);
    this.shockwaveMesh.rotation.x = Math.PI / 2;
    this.group.add(this.shockwaveMesh);

    const lockGeo = new THREE.TorusGeometry(0.85, 0.02, 8, 36);
    const lockMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#f5c451'),
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
    });
    this.lockRingMesh = new THREE.Mesh(lockGeo, lockMat);
    this.group.add(this.lockRingMesh);

    // 5. Phase 4 Hooks: Cooldown thin ring
    const cdGeo = new THREE.TorusGeometry(1.4, 0.015, 8, 64);
    const cdMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#e8edf5'),
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
    });
    this.cooldownRingMesh = new THREE.Mesh(cdGeo, cdMat);
    this.cooldownRingMesh.rotation.x = Math.PI / 2;
    this.group.add(this.cooldownRingMesh);

    // 6. Phase 4 Hooks: TP Gold burst particles
    const tpGeo = new THREE.BufferGeometry();
    const tpCount = 60;
    const tpPositions = new Float32Array(tpCount * 3);
    for (let i = 0; i < tpCount * 3; i++) tpPositions[i] = 0;
    tpGeo.setAttribute('position', new THREE.BufferAttribute(tpPositions, 3));
    const tpMat = new THREE.PointsMaterial({
      color: new THREE.Color('#f5c451'),
      size: 0.18,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
    });
    this.tpBurstMesh = new THREE.Points(tpGeo, tpMat);
    this.group.add(this.tpBurstMesh);
  }

  public triggerSignal(side: 'BUY' | 'SELL') {
    this.shockwaveActive = true;
    this.shockwaveProgress = 0;
    (this.shockwaveMesh.material as THREE.MeshBasicMaterial).color.set(
      side === 'BUY' ? '#22e08a' : '#ff3b6b'
    );
  }

  public triggerResult(result: 'TP' | 'SL') {
    if (result === 'TP') {
      this.tpBurstActive = true;
      this.tpBurstProgress = 0;
    }
  }

  public setCooldown(secondsLeft: number) {
    const mat = this.cooldownRingMesh.material as THREE.MeshBasicMaterial;
    if (secondsLeft > 0) {
      mat.opacity = 0.6;
      const angle = (Math.min(secondsLeft, 60) / 60) * Math.PI * 2;
      this.cooldownRingMesh.rotation.z = angle;
    } else {
      mat.opacity = 0.0;
    }
  }

  public update(deltaSec: number, introProgress: number, p4State: Phase4State) {
    // Core breathing animation
    const breathe = 1.0 + Math.sin(Date.now() * 0.0025) * 0.08;
    const introScale = Math.min(1.0, introProgress * 1.25);
    this.coreSphere.scale.set(introScale * breathe, introScale * breathe, introScale * breathe);
    this.glowSprite.scale.set(2.4 * introScale * breathe, 2.4 * introScale * breathe, 1.0);

    // Slow rotating light rays
    this.raysGroup.rotation.z += deltaSec * 0.15;
    this.raysGroup.scale.set(introScale, introScale, introScale);

    // Phase 4 shockwave animation if active
    if (this.shockwaveActive) {
      this.shockwaveProgress += deltaSec * 1.6;
      const waveMat = this.shockwaveMesh.material as THREE.MeshBasicMaterial;
      const lockMat = this.lockRingMesh.material as THREE.MeshBasicMaterial;

      if (this.shockwaveProgress <= 1.0) {
        const scale = this.shockwaveProgress * 4.2;
        this.shockwaveMesh.scale.set(scale, scale, scale);
        waveMat.opacity = (1.0 - this.shockwaveProgress) * 0.85;

        lockMat.opacity = Math.sin(this.shockwaveProgress * Math.PI) * 0.75;
        this.lockRingMesh.rotation.z += deltaSec * 3.0;
      } else {
        this.shockwaveActive = false;
        waveMat.opacity = 0;
        lockMat.opacity = 0;
      }
    }

    // Phase 4 TP burst animation if active
    if (this.tpBurstActive) {
      this.tpBurstProgress += deltaSec * 1.8;
      const mat = this.tpBurstMesh.material as THREE.PointsMaterial;
      if (this.tpBurstProgress <= 1.0) {
        mat.opacity = (1.0 - this.tpBurstProgress) * 0.9;
        this.tpBurstMesh.scale.set(
          1.0 + this.tpBurstProgress * 3.5,
          1.0 + this.tpBurstProgress * 3.5,
          1.0 + this.tpBurstProgress * 3.5
        );
      } else {
        this.tpBurstActive = false;
        mat.opacity = 0;
      }
    }

    if (p4State.cooldownSeconds > 0) {
      this.setCooldown(p4State.cooldownSeconds);
    }
  }

  public dispose() {
    this.coreSphere.geometry.dispose();
    (this.coreSphere.material as THREE.Material).dispose();

    this.glowSprite.material.map?.dispose();
    this.glowSprite.material.dispose();

    this.raysGroup.children.forEach((c) => {
      const mesh = c as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });

    this.shockwaveMesh.geometry.dispose();
    (this.shockwaveMesh.material as THREE.Material).dispose();

    this.lockRingMesh.geometry.dispose();
    (this.lockRingMesh.material as THREE.Material).dispose();

    this.cooldownRingMesh.geometry.dispose();
    (this.cooldownRingMesh.material as THREE.Material).dispose();

    this.tpBurstMesh.geometry.dispose();
    (this.tpBurstMesh.material as THREE.Material).dispose();
  }
}
