import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Renderer + scene + lights + sky. The sun's shadow frustum tracks a target each frame. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private composer: EffectComposer;
  private speedGrade: ShaderPass;
  private environmentTarget: THREE.WebGLRenderTarget;
  private sun: THREE.DirectionalLight;
  private sunTarget: THREE.Object3D;
  private readonly sunDirection = new THREE.Vector3();
  private readonly shadowRight = new THREE.Vector3();
  private readonly shadowUp = new THREE.Vector3();
  private readonly shadowCenter = new THREE.Vector3();
  private readonly renderPixelRatio: number;
  private readonly onResize = () => this.handleResize();

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      // SMAA is applied after post-processing. A second MSAA stage wastes GPU
      // time and made frame pacing visibly uneven on high-DPI displays.
      antialias: false,
      powerPreference: 'high-performance',
    });
    // Full 2× Retina resolution made the multi-pass pipeline miss alternating
    // frames on the venue GLB. 1.25× remains sharper than CSS resolution while
    // keeping SSAO, shadows and SMAA at a stable cadence.
    this.renderPixelRatio = Math.min(window.devicePixelRatio, 1.25);
    this.renderer.setPixelRatio(this.renderPixelRatio);
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.5;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // PCF shadows remain stable as the shadow camera follows the motorcycle.
    // VSM was producing bright bleeding and shimmer against the pit buildings.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xaebfca, 0.00018);

    // near 0.5: depth precision is what keeps the road decals (2–4 cm above the
    // grass) from z-fighting at distance — 0.1 costs 5× of it for nothing.
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 2500);

    // Open-sky ambient must preserve form in black helmets, tyres and carbon.
    // A weak hemisphere light crushed all three into the asphalt in rear view.
    this.scene.add(new THREE.HemisphereLight(0xdcecff, 0x4b5645, 0.24));

    this.sun = new THREE.DirectionalLight(0xfff0d8, 1.65);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0001;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 2;
    this.sun.shadow.blurSamples = 8;
    const cam = this.sun.shadow.camera;
    cam.left = -38;
    cam.right = 38;
    cam.top = 38;
    cam.bottom = -38;
    cam.near = 1;
    cam.far = 300;
    this.sunTarget = new THREE.Object3D();
    this.sun.target = this.sunTarget;
    this.scene.add(this.sun, this.sunTarget);

    // Subtle camera-side skylight, analogous to the broad fill used by a
    // broadcast camera. It creates a readable rim across the rider and rear
    // tyre when the physical sun is ahead of the motorcycle.
    const rearFill = new THREE.DirectionalLight(0xc8dcf5, 0.12);
    const rearFillTarget = new THREE.Object3D();
    rearFill.position.set(0, 2.5, 1.5);
    rearFillTarget.position.set(0, 0, -4);
    rearFill.target = rearFillTarget;
    this.camera.add(rearFill, rearFillTarget);
    this.scene.add(this.camera);

    const sky = new Sky();
    sky.scale.setScalar(10000);
    const u = sky.material.uniforms as Record<string, { value: unknown }>;
    u['turbidity']!.value = 4.8;
    u['rayleigh']!.value = 1.35;
    u['mieCoefficient']!.value = 0.0035;
    u['mieDirectionalG']!.value = 0.85;
    const sunDir = new THREE.Vector3(-0.68, 0.76, -0.36).normalize();
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
    this.scene.environmentIntensity = 0.46;
    pmrem.dispose();

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.renderPixelRatio);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Do not use screen-space AO or bloom here. Both are reconstructed from
    // neighbouring pixels every frame and visibly shimmer across the finely
    // triangulated circuit at speed. Authored AO maps and real sun shadows are
    // temporally stable and provide the grounding instead.
    this.speedGrade = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
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
        varying vec2 vUv;
        void main() {
          vec3 color = texture2D(tDiffuse, vUv).rgb;
          float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
          color = mix(vec3(luminance), color, 1.035);
          // Preserve separation in dark PBR materials instead of clipping
          // helmet, tyre and asphalt into one near-black silhouette.
          float shadowWeight = 1.0 - smoothstep(0.035, 0.24, luminance);
          color += vec3(0.005, 0.0065, 0.0085) * shadowWeight;
          color = (color - 0.5) * 0.995 + 0.5;
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
    // Snap the moving shadow camera in its own light-space axes. World X/Z
    // snapping still moved oblique sunlight by fractional shadow texels and
    // was the source of distracting bright/dark crawl while riding.
    const shadowTexel = 76 / 2048;
    this.shadowRight.crossVectors(this.sunDirection, THREE.Object3D.DEFAULT_UP).normalize();
    this.shadowUp.crossVectors(this.shadowRight, this.sunDirection).normalize();
    this.shadowCenter.set(targetPos.x, targetPos.y, targetPos.z);
    const rightDistance = Math.round(this.shadowCenter.dot(this.shadowRight) / shadowTexel) * shadowTexel;
    const upDistance = Math.round(this.shadowCenter.dot(this.shadowUp) / shadowTexel) * shadowTexel;
    // Translation along the light direction only changes shadow depth; a
    // quarter-metre step is finer than the bias range and prevents suspension
    // movement from invalidating the complete projection every frame.
    const depthDistance = Math.round(this.shadowCenter.dot(this.sunDirection) * 4) / 4;
    this.shadowCenter
      .copy(this.shadowRight).multiplyScalar(rightDistance)
      .addScaledVector(this.shadowUp, upDistance)
      .addScaledVector(this.sunDirection, depthDistance);
    this.sun.position.copy(this.shadowCenter).addScaledVector(this.sunDirection, 200);
    this.sunTarget.position.copy(this.shadowCenter);
  }

  render(): void {
    this.composer.render();
  }

  /** Motion cue is intentionally optical only; it never changes camera position. */
  setSpeedEffect(speedMps: number): void {
    void speedMps;
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
