import * as THREE from 'three';
import type { Bike } from '../game/Bike';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Restrained broadcast/helmet-camera speed cues with bounded GPU cost. */
export class SpeedEffects {
  readonly root = new THREE.Group();

  private readonly dust: ParticlePool;
  private readonly smoke: ParticlePool;
  private readonly wheelBlur: THREE.Mesh[] = [];
  private readonly skidGeometry: THREE.BufferGeometry;
  private readonly skidPositions = new Float32Array(256 * 2 * 3);
  private skidCursor = 0;
  private previousLeft = new THREE.Vector3();
  private previousRight = new THREE.Vector3();
  private hasSkidPrevious = false;
  private readonly right = new THREE.Vector3();
  private readonly rear = new THREE.Vector3();

  constructor(private readonly bike: Bike) {
    this.root.name = 'MotoGPSpeedEffects';
    this.dust = new ParticlePool(90, 0xc1a071, 0.24, 0.5);
    this.smoke = new ParticlePool(60, 0xc8ced3, 0.3, 0.34);
    this.root.add(this.dust.points, this.smoke.points);

    this.skidGeometry = new THREE.BufferGeometry();
    this.skidPositions.fill(-9999);
    this.skidGeometry.setAttribute('position', new THREE.BufferAttribute(this.skidPositions, 3));
    const skidMaterial = new THREE.LineBasicMaterial({
      color: 0x111214,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      toneMapped: true,
    });
    const skids = new THREE.LineSegments(this.skidGeometry, skidMaterial);
    skids.name = 'DynamicTyreMarks';
    skids.frustumCulled = false;
    this.root.add(skids);

    const blurMaterial = createWheelBlurMaterial();
    for (const z of [0.75, -0.75]) {
      const wheel = new THREE.Mesh(new THREE.CircleGeometry(0.292, 40), blurMaterial.clone());
      wheel.name = z > 0 ? 'FrontWheelMotionBlur' : 'RearWheelMotionBlur';
      wheel.rotation.y = Math.PI / 2;
      wheel.position.set(0, -0.5, z);
      wheel.renderOrder = 2;
      this.wheelBlur.push(wheel);
      bike.root.add(wheel);
    }
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
    this.right.crossVectors(WORLD_UP, bikeFwd).normalize();
    this.rear.copy(bikePos).addScaledVector(bikeFwd, -0.72);

    const blurOpacity = THREE.MathUtils.smoothstep(speedMps, 18, 76) * 0.22;
    for (let i = 0; i < this.wheelBlur.length; i++) {
      const wheel = this.wheelBlur[i]!;
      const source = this.bike.wheelMeshes[i];
      if (source) wheel.position.copy(source.position);
      (wheel.material as THREE.ShaderMaterial).uniforms.uOpacity!.value = blurOpacity;
      wheel.visible = blurOpacity > 0.008;
    }

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
      this.appendSkids(bikePos, bikeFwd, surfaceY);
    } else {
      this.hasSkidPrevious = false;
    }

    this.dust.update(dt);
    this.smoke.update(dt);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.dust.dispose();
    this.smoke.dispose();
    this.skidGeometry.dispose();
    for (const child of [...this.root.children]) {
      if (child instanceof THREE.LineSegments) (child.material as THREE.Material).dispose();
    }
    for (const wheel of this.wheelBlur) {
      wheel.removeFromParent();
      wheel.geometry.dispose();
      (wheel.material as THREE.Material).dispose();
    }
  }

  private appendSkids(bikePos: THREE.Vector3, bikeFwd: THREE.Vector3, surfaceY: number): void {
    const center = this.rear.copy(bikePos).addScaledVector(bikeFwd, -0.68);
    const left = new THREE.Vector3().copy(center).addScaledVector(this.right, -0.085);
    const right = new THREE.Vector3().copy(center).addScaledVector(this.right, 0.085);
    left.y = surfaceY + 0.026;
    right.y = surfaceY + 0.026;
    if (this.hasSkidPrevious) {
      this.writeSkidSegment(this.previousLeft, left);
      this.writeSkidSegment(this.previousRight, right);
    }
    this.previousLeft.copy(left);
    this.previousRight.copy(right);
    this.hasSkidPrevious = true;
  }

  private writeSkidSegment(a: THREE.Vector3, b: THREE.Vector3): void {
    const offset = (this.skidCursor % 256) * 6;
    this.skidPositions.set([a.x, a.y, a.z, b.x, b.y, b.z], offset);
    this.skidCursor++;
    (this.skidGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
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
    const material = new THREE.PointsMaterial({
      color,
      size,
      sizeAttenuation: true,
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
    (this.points.material as THREE.Material).dispose();
  }
}

function createWheelBlurMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv - 0.5;
        float r = length(p) * 2.0;
        float rim = smoothstep(0.98, 0.78, r) * smoothstep(0.18, 0.36, r);
        float spokes = 0.56 + 0.14 * sin(atan(p.y, p.x) * 18.0 + r * 21.0);
        gl_FragColor = vec4(vec3(0.045) * spokes, rim * uOpacity);
      }
    `,
  });
}
