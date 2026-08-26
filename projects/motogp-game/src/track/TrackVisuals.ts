import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Loads the Blender-exported circuit and adds it to the scene. Meshes receive
 * shadows; only tall props (gantry) cast them — a 5k-tri ribbon casting into a
 * bike-sized shadow frustum is wasted fill.
 */
export async function loadTrackVisuals(scene: THREE.Scene, url = '/assets/track.glb'): Promise<THREE.Group> {
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    new GLTFLoader().load(
      url,
      resolve,
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });

  const root = gltf.scene;
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.receiveShadow = true;
    obj.castShadow = obj.name.startsWith('gantry');
    obj.matrixAutoUpdate = false;
    obj.updateMatrix();
  });

  scene.add(root);
  return root;
}
