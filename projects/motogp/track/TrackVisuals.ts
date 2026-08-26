import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.receiveShadow = true;
    obj.castShadow = false;
    obj.frustumCulled = true;
  });

  const visuals = new THREE.Group();
  visuals.name = 'MotoGPTrackVisuals';
  // Collision samples were extracted directly from this GLB, in this transform.
  visuals.add(root);
  scene.add(visuals);
  return visuals;
}
