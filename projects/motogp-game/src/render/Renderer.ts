import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

/** Renderer + scene + lights + sky. The sun's shadow frustum tracks a target each frame. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private sun: THREE.DirectionalLight;
  private sunTarget: THREE.Object3D;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      // Road decals sit centimetres above the grass; 16-bit depth buffers
      // (SwiftShader, some mobile GPUs) can't resolve that past ~50 m.
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xbfd4e6, 400, 1800);

    // near 0.5: depth precision is what keeps the road decals (2–4 cm above the
    // grass) from z-fighting at distance — 0.1 costs 5× of it for nothing.
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 2500);

    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x6b7a4a, 0.55));

    this.sun = new THREE.DirectionalLight(0xfff2df, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -70;
    cam.right = 70;
    cam.top = 70;
    cam.bottom = -70;
    cam.near = 1;
    cam.far = 500;
    this.sunTarget = new THREE.Object3D();
    this.sun.target = this.sunTarget;
    this.scene.add(this.sun, this.sunTarget);

    const sky = new Sky();
    sky.scale.setScalar(10000);
    const u = sky.material.uniforms as Record<string, { value: unknown }>;
    u['turbidity']!.value = 6;
    u['rayleigh']!.value = 1.6;
    u['mieCoefficient']!.value = 0.004;
    u['mieDirectionalG']!.value = 0.85;
    const sunDir = new THREE.Vector3(-0.45, 0.5, -0.6).normalize();
    u['sunPosition']!.value = sunDir;
    this.sun.position.copy(sunDir).multiplyScalar(200);
    this.scene.add(sky);

    window.addEventListener('resize', () => this.handleResize());
  }

  /** Keep the shadow frustum centered near `target` (the bike). */
  trackSunOn(targetPos: { x: number; y: number; z: number }): void {
    const dir = this.sun.position.clone().normalize();
    this.sun.position.set(targetPos.x + dir.x * 200, targetPos.y + dir.y * 200, targetPos.z + dir.z * 200);
    this.sunTarget.position.set(targetPos.x, targetPos.y, targetPos.z);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private handleResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
