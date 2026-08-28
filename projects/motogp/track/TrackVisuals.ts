import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DRIVEABLE_SURFACES = new Map<string, number>([
  ['Object_22', 0.95], // terrain underlay
  ['Object_24', 0.78], // asphalt
  ['Object_25', 0.72], // painted kerbs
  ['Object_27', 0.98], // gravel
  ['Object_34', 0.95], // verge
  ['Object_40', 0.82], // pit paving
]);

/** The downloaded venue accidentally contains an unrelated legacy motorcycle. */
const EXCLUDED_VENUE_OBJECTS = new Set(['a.001']);

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

    const roughness = DRIVEABLE_SURFACES.get(obj.name);
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        // Imported alpha flags on opaque road meshes caused z-sorting shimmer
        // and occasional see-through patches. Preserve transparent fences and
        // glass, but make every rideable surface an ordinary depth-writing PBR
        // material with restrained, daylight-readable highlights.
        if (roughness !== undefined) {
          material.transparent = false;
          material.opacity = 1;
          material.alphaTest = 0;
          material.depthWrite = true;
          material.side = THREE.FrontSide;
          material.roughness = roughness;
          material.metalness = 0;
        }
        if (material.map) {
          material.map.anisotropy = Math.max(material.map.anisotropy, 8);
          material.map.needsUpdate = true;
        }
        material.needsUpdate = true;
      }
    }
  });

  const visuals = new THREE.Group();
  visuals.name = 'MotoGPTrackVisuals';
  // Collision samples were extracted directly from this GLB, in this transform.
  visuals.add(root);
  scene.add(visuals);
  return visuals;
}
