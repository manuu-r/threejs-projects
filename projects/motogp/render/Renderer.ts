import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Renderer + scene + lights + sky. The sun's shadow frustum tracks a target each frame. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private composer: EffectComposer;
  private ssao: SSAOPass;
  private speedGrade: ShaderPass;
  private environmentTarget: THREE.WebGLRenderTarget;
  private sun: THREE.DirectionalLight;
  private sunTarget: THREE.Object3D;
  private readonly sunDirection = new THREE.Vector3();
  private readonly onResize = () => this.handleResize();

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      // SMAA is applied after post-processing. A second MSAA stage wastes GPU
      // time and made frame pacing visibly uneven on high-DPI displays.
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.52;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // PCF shadows remain stable as the shadow camera follows the motorcycle.
    // VSM was producing bright bleeding and shimmer against the pit buildings.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x9fb2c1, 0.00022);

    // near 0.5: depth precision is what keeps the road decals (2–4 cm above the
    // grass) from z-fighting at distance — 0.1 costs 5× of it for nothing.
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 2500);

    this.scene.add(new THREE.HemisphereLight(0xd8e9ff, 0x4b5638, 0.18));

    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.48);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00008;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2;
    this.sun.shadow.blurSamples = 8;
    const cam = this.sun.shadow.camera;
    cam.left = -55;
    cam.right = 55;
    cam.top = 55;
    cam.bottom = -55;
    cam.near = 1;
    cam.far = 360;
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
    const sunDir = new THREE.Vector3(-0.48, 0.62, -0.62).normalize();
    u['sunPosition']!.value = sunDir;
    this.sun.position.copy(sunDir).multiplyScalar(200);
    this.scene.add(sky);

    // Build an HDR radiance environment from the analytical sky. PBR bike,
    // glass and metal now receive stable IBL reflections without shipping a
    // second enormous panorama alongside the already-large venue asset.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileCubemapShader();
    this.environmentTarget = pmrem.fromScene(this.scene, 0.02, 0.1, 10000);
    this.scene.environment = this.environmentTarget.texture;
    this.scene.environmentIntensity = 0.22;
    pmrem.dispose();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Screen-space AO supplies the missing contact shadow under the tyres and
    // between rider, tank and cockpit. Keep the radius tight to avoid halos.
    this.ssao = new SSAOPass(this.scene, this.camera, width, height, 24);
    this.ssao.kernelRadius = 2.5;
    this.ssao.minDistance = 0.002;
    this.ssao.maxDistance = 0.012;
    this.composer.addPass(this.ssao);

    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.012, 0.1, 1.3);
    this.composer.addPass(bloom);
    this.speedGrade = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uRadialBlur: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uRadialBlur;
        varying vec2 vUv;
        void main() {
          vec2 direction = (vUv - 0.5) * uRadialBlur;
          vec3 color = texture2D(tDiffuse, vUv).rgb * 0.42;
          color += texture2D(tDiffuse, vUv - direction).rgb * 0.24;
          color += texture2D(tDiffuse, vUv + direction).rgb * 0.24;
          color += texture2D(tDiffuse, vUv + direction * 1.8).rgb * 0.10;
          float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
          color = mix(vec3(luminance), color, 1.035);
          color = (color - 0.5) * 1.025 + 0.5;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.composer.addPass(this.speedGrade);
    this.composer.addPass(new SMAAPass());
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', this.onResize);
  }

  /** Keep the shadow frustum centered near `target` (the bike). */
  trackSunOn(targetPos: { x: number; y: number; z: number }): void {
    this.sunDirection.copy(this.sun.position).sub(this.sunTarget.position).normalize();
    // Lock movement to small world-space increments so sub-pixel chassis
    // vibration cannot make every shadow edge crawl from frame to frame.
    const targetX = Math.round(targetPos.x * 20) / 20;
    const targetY = Math.round(targetPos.y * 20) / 20;
    const targetZ = Math.round(targetPos.z * 20) / 20;
    this.sun.position.set(
      targetX + this.sunDirection.x * 200,
      targetY + this.sunDirection.y * 200,
      targetZ + this.sunDirection.z * 200,
    );
    this.sunTarget.position.set(targetX, targetY, targetZ);
  }

  render(): void {
    this.composer.render();
  }

  /** Motion cue is intentionally optical only; it never changes camera position. */
  setSpeedEffect(speedMps: number): void {
    this.speedGrade.uniforms.uRadialBlur!.value =
      THREE.MathUtils.smoothstep(speedMps, 28, 92) * 0.0014;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.composer.dispose();
    this.environmentTarget.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private handleResize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }
}
