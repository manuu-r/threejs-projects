import * as THREE from 'three';

/** Restrained broadcast/helmet-camera speed cues with bounded GPU cost. */
export class SpeedEffects {
  readonly root = new THREE.Group();

  private readonly dust: ParticlePool;
  private readonly smoke: ParticlePool;
  private readonly rear = new THREE.Vector3();

  constructor() {
    this.root.name = 'MotoGPSpeedEffects';
    this.dust = new ParticlePool(90, 0xc1a071, 0.24, 0.5);
    this.smoke = new ParticlePool(60, 0xc8ced3, 0.3, 0.34);
    this.root.add(this.dust.points, this.smoke.points);
  }

  update(
    dt: number,
    bikePos: THREE.Vector3,
    bikeFwd: THREE.Vector3,
    speedMps: number,
    _throttle: number,
    brake: number,
    surfaceDistance: number,
    surfaceY: number,
  ): void {
    this.rear.copy(bikePos).addScaledVector(bikeFwd, -0.72);

    const dustRate = surfaceDistance > 0.65 && speedMps > 7 ? Math.min(3, Math.ceil(speedMps / 22)) : 0;
    for (let i = 0; i < dustRate; i++) {
      this.dust.spawn(
        this.rear.x + (Math.random() - 0.5) * 0.3,
        surfaceY + 0.08,
        this.rear.z + (Math.random() - 0.5) * 0.3,
        -bikeFwd.x * (1.5 + Math.random() * 2.2) + (Math.random() - 0.5) * 0.7,
        0.6 + Math.random() * 1.1,
        -bikeFwd.z * (1.5 + Math.random() * 2.2) + (Math.random() - 0.5) * 0.7,
        0.65 + Math.random() * 0.55,
      );
    }

    const tyreSmoke = surfaceDistance < 0.5 && brake > 0.72 && speedMps > 18;
    if (tyreSmoke) {
      this.smoke.spawn(
        this.rear.x,
        surfaceY + 0.1,
        this.rear.z,
        -bikeFwd.x * 1.1 + (Math.random() - 0.5) * 0.25,
        0.45 + Math.random() * 0.45,
        -bikeFwd.z * 1.1 + (Math.random() - 0.5) * 0.25,
        0.55 + Math.random() * 0.35,
      );
    }

    this.dust.update(dt);
    this.smoke.update(dt);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.dust.dispose();
    this.smoke.dispose();
  }
}

class ParticlePool {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private cursor = 0;

  constructor(count: number, color: number, size: number, opacity: number) {
    this.positions = new Float32Array(count * 3);
    this.positions.fill(-9999);
    this.velocities = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const particleMap = createSoftParticleMap();
    const material = new THREE.PointsMaterial({
      color,
      size,
      sizeAttenuation: true,
      map: particleMap,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: true,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number): void {
    const i = this.cursor++ % this.life.length;
    const j = i * 3;
    this.positions.set([x, y, z], j);
    this.velocities.set([vx, vy, vz], j);
    this.life[i] = life;
  }

  update(dt: number): void {
    for (let i = 0; i < this.life.length; i++) {
      if (this.life[i]! <= 0) continue;
      const j = i * 3;
      this.life[i] -= dt;
      if (this.life[i]! <= 0) {
        this.positions[j + 1] = -9999;
        continue;
      }
      this.positions[j] += this.velocities[j]! * dt;
      this.positions[j + 1] += this.velocities[j + 1]! * dt;
      this.positions[j + 2] += this.velocities[j + 2]! * dt;
      this.velocities[j] *= Math.exp(-1.8 * dt);
      this.velocities[j + 1] = this.velocities[j + 1]! * Math.exp(-1.2 * dt) + 0.22 * dt;
      this.velocities[j + 2] *= Math.exp(-1.8 * dt);
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    const material = this.points.material as THREE.PointsMaterial;
    material.map?.dispose();
    material.dispose();
  }
}

/** Soft alpha falloff avoids the square confetti look of raw point sprites. */
function createSoftParticleMap(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,255,0.82)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.42)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}
