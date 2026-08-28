import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

type SurfaceKind = 'asphalt' | 'kerb' | 'gravel' | 'grass' | 'paving';

const DRIVEABLE_SURFACES = new Map<string, { roughness: number; kind: SurfaceKind }>([
  ['Object_22', { roughness: 0.95, kind: 'grass' }], // terrain underlay
  ['Object_24', { roughness: 0.84, kind: 'asphalt' }], // asphalt
  ['Object_25', { roughness: 0.7, kind: 'kerb' }], // painted kerbs
  ['Object_27', { roughness: 0.98, kind: 'gravel' }], // gravel
  ['Object_34', { roughness: 0.95, kind: 'grass' }], // verge
  ['Object_40', { roughness: 0.82, kind: 'paving' }], // pit paving
]);

/** The downloaded venue accidentally contains an unrelated legacy motorcycle. */
const EXCLUDED_VENUE_OBJECTS = new Set([
  'a.001',
  // Legacy pine-wall billboards sit above sloped terrain and visibly float.
  // The venue retains its grounded modeled vegetation without this layer.
  'Object_28',
  'Object_29',
  'Object_31',
  'Object_56',
]);

/**
 * Loads the Blender-exported circuit and adds it to the scene. Meshes receive
 * shadows; only tall props (gantry) cast them — a 5k-tri ribbon casting into a
 * bike-sized shadow frustum is wasted fill.
 */
export async function loadTrackVisuals(
  scene: THREE.Scene,
  url = '/motogp/nurburgring-gp.glb',
): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const detailMaps = {
    // uv1 is expressed in world metres. Each 512px tile therefore spans
    // several metres; much denser repetition aliases into broad moiré bands
    // under a shallow racing-camera angle.
    asphalt: createSurfaceMaps(0x93a5, 0.08, 0.72),
    kerb: createSurfaceMaps(0xc11b, 0.12, 0.48),
    gravel: createSurfaceMaps(0x6a7e, 0.1, 1.35),
    grass: createSurfaceMaps(0x51a5, 0.08, 1.15),
    paving: createSurfaceMaps(0xb17a, 0.1, 0.62),
  } satisfies Record<SurfaceKind, SurfaceMaps>;

  const root = gltf.scene;
  root.name = 'NurburgringGP2016';
  for (const name of EXCLUDED_VENUE_OBJECTS) {
    const accidentalAsset = root.getObjectByName(name);
    if (accidentalAsset) accidentalAsset.removeFromParent();
  }
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.receiveShadow = true;
    obj.castShadow = false;
    obj.frustumCulled = true;

    const surface = DRIVEABLE_SURFACES.get(obj.name);
    if (surface?.kind === 'asphalt') smoothCoincidentNormals(obj.geometry);
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        // Imported alpha flags on opaque road meshes caused z-sorting shimmer
        // and occasional see-through patches. Preserve transparent fences and
        // glass, but make every rideable surface an ordinary depth-writing PBR
        // material with restrained, daylight-readable highlights.
        if (surface !== undefined) {
          material.transparent = false;
          material.opacity = 1;
          material.alphaTest = 0;
          material.depthWrite = true;
          material.side = THREE.FrontSide;
          material.flatShading = false;
          material.polygonOffset = surface.kind === 'asphalt';
          material.polygonOffsetFactor = surface.kind === 'asphalt' ? -2 : 0;
          material.polygonOffsetUnits = surface.kind === 'asphalt' ? -4 : 0;
          material.roughness = surface.roughness;
          material.metalness = 0;
          const maps = detailMaps[surface.kind];
          if (surface.kind === 'asphalt') {
            material.map = maps.albedo;
            material.color.set(0xffffff);
          }
          // Venue maps use mirrored island UVs intended for the original game
          // shader. In a stock PBR shader they reveal every triangle/island as
          // a large herringbone pattern, most visibly on asphalt. Replace the
          // complete surface detail set with our world-planar maps so scale and
          // direction stay consistent across the whole ribbon.
          if (surface.kind === 'asphalt') {
            // This particular road ribbon has discontinuous vertex normals at
            // most triangulation edges. A tangent normal map exaggerates those
            // edges even with planar UVs, so use planar height relief here.
            material.normalMap = null;
            material.bumpMap = maps.roughness;
            material.bumpScale = 0.006;
          } else {
            material.normalMap = maps.normal;
            material.normalScale.setScalar(0.38);
          }
          material.roughnessMap = maps.roughness;
          material.aoMap = maps.ao;
          material.aoMapIntensity = surface.kind === 'asphalt' ? 0.38 : 0.5;
          const position = obj.geometry.getAttribute('position');
          const planarUv = new Float32Array(position.count * 2);
          for (let i = 0; i < position.count; i++) {
            planarUv[i * 2] = position.getX(i);
            planarUv[i * 2 + 1] = position.getZ(i);
          }
          obj.geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(planarUv, 2));
          // Imported tangents were generated from the asset's mirrored uv0.
          // Let Three derive a cotangent frame from the active planar channel;
          // retaining the old tangent attribute makes the normal map expose the
          // triangulation as alternating diagonal bands.
          obj.geometry.deleteAttribute('tangent');
          maps.normal.channel = 1;
          maps.roughness.channel = 1;
          maps.ao.channel = 1;
          maps.albedo.channel = 1;
          if (material.bumpMap) material.bumpMap.channel = 1;
        }
        if (material.map) {
          material.map.colorSpace = THREE.SRGBColorSpace;
          material.map.anisotropy = Math.max(material.map.anisotropy, 8);
          material.map.needsUpdate = true;
        }
        if (material.emissiveMap) material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        if (material.normalMap) material.normalMap.colorSpace = THREE.NoColorSpace;
        if (material.bumpMap) material.bumpMap.colorSpace = THREE.NoColorSpace;
        if (material.roughnessMap) material.roughnessMap.colorSpace = THREE.NoColorSpace;
        if (material.metalnessMap) material.metalnessMap.colorSpace = THREE.NoColorSpace;
        if (material.aoMap) material.aoMap.colorSpace = THREE.NoColorSpace;
        material.envMapIntensity = surface?.kind === 'asphalt' ? 0.9 : surface ? 0.76 : 0.9;
        material.needsUpdate = true;
      }
    }
  });

  const visuals = new THREE.Group();
  visuals.name = 'MotoGPTrackVisuals';
  // Collision samples were extracted directly from this GLB, in this transform.
  visuals.add(root);
  visuals.userData.disposeRealismMaps = () => {
    for (const maps of Object.values(detailMaps)) {
      maps.normal.dispose();
      maps.roughness.dispose();
      maps.ao.dispose();
      maps.albedo.dispose();
    }
  };
  scene.add(visuals);
  return visuals;
}

interface SurfaceMaps {
  albedo: THREE.DataTexture;
  normal: THREE.DataTexture;
  roughness: THREE.DataTexture;
  ao: THREE.DataTexture;
}

/**
 * The venue road is exported as split triangles, each with a slightly
 * different normal. Average normals for vertices occupying the same point so
 * daylight and AO do not reveal the underlying triangulation.
 */
function smoothCoincidentNormals(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  if (!position) return;
  const sums = new Map<string, THREE.Vector3>();
  const face = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const key = (i: number): string =>
    `${Math.round(position.getX(i) * 1000)},${Math.round(position.getY(i) * 1000)},${Math.round(position.getZ(i) * 1000)}`;
  const addTriangle = (ia: number, ib: number, ic: number): void => {
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    face.crossVectors(ab, ac);
    if (face.lengthSq() < 1e-12) return;
    for (const i of [ia, ib, ic]) {
      const vertexKey = key(i);
      const sum = sums.get(vertexKey);
      if (sum) sum.add(face);
      else sums.set(vertexKey, face.clone());
    }
  };
  const index = geometry.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      addTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    }
  } else {
    for (let i = 0; i < position.count; i += 3) addTriangle(i, i + 1, i + 2);
  }
  const normals = new Float32Array(position.count * 3);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < position.count; i++) {
    const normal = sums.get(key(i))?.normalize() ?? up.clone();
    // Suppress the exporter-created cross-track corrugation while retaining a
    // small share of the broad banking/grade normal.
    normal.lerp(up, 0.9).normalize();
    normals[i * 3] = normal.x;
    normals[i * 3 + 1] = normal.y;
    normals[i * 3 + 2] = normal.z;
  }
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
}

/** Compact tileable micro-detail maps layered over the venue's authored albedo. */
function createSurfaceMaps(seed: number, repeat: number, relief: number): SurfaceMaps {
  const size = 512;
  const height = new Float32Array(size * size);
  const hash = (x: number, y: number): number => {
    let n = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
  };
  const valueNoise = (x: number, y: number, cellSize: number, octave: number): number => {
    const cells = size / cellSize;
    const gx = Math.floor(x / cellSize);
    const gy = Math.floor(y / cellSize);
    const tx0 = (x % cellSize) / cellSize;
    const ty0 = (y % cellSize) / cellSize;
    const tx = tx0 * tx0 * (3 - 2 * tx0);
    const ty = ty0 * ty0 * (3 - 2 * ty0);
    const h = (ix: number, iy: number): number =>
      hash((ix % cells) + octave * 101, (iy % cells) + octave * 149);
    const x0 = THREE.MathUtils.lerp(h(gx, gy), h(gx + 1, gy), tx);
    const x1 = THREE.MathUtils.lerp(h(gx, gy + 1), h(gx + 1, gy + 1), tx);
    return THREE.MathUtils.lerp(x0, x1, ty);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Smooth tileable random fields avoid both cell blocks and obvious
      // sinusoidal repetition at the helmet camera's grazing road angle.
      const coarse = valueNoise(x, y, 64, 1);
      const medium = valueNoise(x, y, 16, 2);
      const fine = valueNoise(x, y, 4, 3);
      const grain = hash(x, y);
      height[y * size + x] = THREE.MathUtils.clamp(
        coarse * 0.44 + medium * 0.31 + fine * 0.2 + grain * 0.05,
        0,
        1,
      );
    }
  }

  const normalData = new Uint8Array(size * size * 4);
  const albedoData = new Uint8Array(size * size * 4);
  const roughData = new Uint8Array(size * size * 4);
  const aoData = new Uint8Array(size * size * 4);
  const sample = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const h = sample(x, y);
      let nx = (sample(x - 1, y) - sample(x + 1, y)) * relief;
      let ny = (sample(x, y - 1) - sample(x, y + 1)) * relief;
      const inv = 1 / Math.hypot(nx, ny, 1);
      nx *= inv;
      ny *= inv;
      normalData[i] = Math.round((nx * 0.5 + 0.5) * 255);
      normalData[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalData[i + 2] = Math.round(inv * 255);
      normalData[i + 3] = 255;
      // Fresh race asphalt is dark grey, not crushed black. Retain enough
      // albedo for sunlight, tyre wear and contact shadows to remain legible.
      const asphaltTone = Math.round(98 + (h - 0.5) * 24 + (hash(x * 7, y * 11) > 0.992 ? 16 : 0));
      albedoData.set([asphaltTone, asphaltTone + 2, asphaltTone + 5, 255], i);
      const rough = THREE.MathUtils.clamp(0.72 + (h - 0.5) * 0.34, 0, 1) * 255;
      roughData.set([rough, rough, rough, 255], i);
      const ao = THREE.MathUtils.clamp(0.86 + h * 0.14, 0, 1) * 255;
      aoData.set([ao, ao, ao, 255], i);
    }
  }

  const make = (data: Uint8Array, colorSpace = THREE.NoColorSpace): THREE.DataTexture => {
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.name = `MotoGPSurfaceDetail:${seed}`;
    texture.colorSpace = colorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.anisotropy = 12;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.needsUpdate = true;
    return texture;
  };
  return {
    albedo: make(albedoData, THREE.SRGBColorSpace),
    normal: make(normalData),
    roughness: make(roughData),
    ao: make(aoData),
  };
}
