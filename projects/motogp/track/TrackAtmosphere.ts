import * as THREE from 'three';
import type { TrackData } from './TrackData';

/**
 * Replaceable inventory for future commercial trackside placements. Keeping
 * these as named slots means real campaigns can swap textures later without
 * touching placement or game logic.
 */
export const TRACKSIDE_AD_SLOTS = [
  { id: 'primary', label: 'YOUR BRAND', background: '#e8f7ff', foreground: '#101722' },
  { id: 'partner', label: 'RACE PARTNER', background: '#e32636', foreground: '#ffffff' },
  { id: 'event', label: 'TRACKSIDE', background: '#77d8ef', foreground: '#101722' },
] as const;

// The supplied venue and the legacy generated timing line diverge on several
// branches. Keep the inventory API, but do not render placements until they
// are authored against named sockets on the real Nürburgring scene.
const ENABLE_LEGACY_GENERATED_PLACEMENTS = false;

export interface TrackAtmosphere {
  root: THREE.Group;
  dispose(): void;
}

/** Lightweight instanced spectators and reusable ad inventory. */
export function createTrackAtmosphere(track: TrackData): TrackAtmosphere {
  const root = new THREE.Group();
  root.name = 'TrackAtmosphere';
  const disposables: Array<{ dispose(): void }> = [];

  if (ENABLE_LEGACY_GENERATED_PLACEMENTS) {
    buildAdHoardings(root, track, disposables);
    buildCrowd(root, track, disposables);
  }
  root.userData.adInventory = TRACKSIDE_AD_SLOTS.map((slot) => slot.id);

  return {
    root,
    dispose() {
      root.removeFromParent();
      for (const item of disposables) item.dispose();
    },
  };
}

function buildAdHoardings(
  root: THREE.Group,
  track: TrackData,
  disposables: Array<{ dispose(): void }>,
): void {
  const boardGeometry = new THREE.PlaneGeometry(5.2, 1.25);
  const postGeometry = new THREE.CylinderGeometry(0.045, 0.06, 1.35, 6);
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0x202833, roughness: 0.68, metalness: 0.6 });
  disposables.push(boardGeometry, postGeometry, postMaterial);

  const matrices = TRACKSIDE_AD_SLOTS.map(() => [] as THREE.Matrix4[]);
  const postMatrices: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
  const target = new THREE.Vector3();
  let boardIndex = 0;

  for (let i = 8; i < track.count; i += 24) {
    const sample = track.samples[i]!;
    for (const side of [1, -1]) {
      const edge = side > 0 ? sample.bl : sample.br;
      // The legacy timing line can sit near a branch edge; reserve a generous
      // commercial setback so no board ever becomes a track obstacle.
      const lateral = side * (edge + 16);
      const x = sample.p[0] + sample.n[0] * lateral;
      const z = sample.p[2] + sample.n[2] * lateral;
      dummy.position.set(x, sample.p[1] + 1.18, z);
      target.set(sample.p[0], sample.p[1] + 1.18, sample.p[2]);
      dummy.lookAt(target);
      dummy.updateMatrix();
      matrices[boardIndex % matrices.length]!.push(dummy.matrix.clone());

      for (const along of [-1.95, 1.95]) {
        dummy.position.set(
          x + sample.t[0] * along,
          sample.p[1] + 0.53,
          z + sample.t[2] * along,
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        postMatrices.push(dummy.matrix.clone());
      }
      boardIndex++;
    }
  }

  for (let slotIndex = 0; slotIndex < TRACKSIDE_AD_SLOTS.length; slotIndex++) {
    const slot = TRACKSIDE_AD_SLOTS[slotIndex]!;
    const texture = createAdTexture(slot.label, slot.background, slot.foreground);
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
    const instanceMatrices = matrices[slotIndex]!;
    const mesh = new THREE.InstancedMesh(boardGeometry, material, instanceMatrices.length);
    mesh.name = `AdSlot:${slot.id}`;
    for (let i = 0; i < instanceMatrices.length; i++) mesh.setMatrixAt(i, instanceMatrices[i]!);
    mesh.instanceMatrix.needsUpdate = true;
    root.add(mesh);
    disposables.push(texture, material);
  }

  const posts = new THREE.InstancedMesh(postGeometry, postMaterial, postMatrices.length);
  posts.name = 'AdHoardingPosts';
  for (let i = 0; i < postMatrices.length; i++) posts.setMatrixAt(i, postMatrices[i]!);
  posts.instanceMatrix.needsUpdate = true;
  root.add(posts);
}

function buildCrowd(
  root: THREE.Group,
  track: TrackData,
  disposables: Array<{ dispose(): void }>,
): void {
  const geometry = new THREE.CapsuleGeometry(0.16, 0.78, 2, 5);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.84,
    vertexColors: true,
  });
  const transforms: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const palette = [0xe8edf4, 0xe32636, 0x77d8ef, 0x182131, 0xf6c74e, 0xffffff];
  const dummy = new THREE.Object3D();

  // Denser near the start/finish, sparser around the rest of the circuit.
  for (let i = 0; i < track.count; i += i < 110 || i > track.count - 70 ? 5 : 12) {
    const sample = track.samples[i]!;
    for (const side of [1, -1]) {
      const edge = side > 0 ? sample.bl : sample.br;
      for (let row = 0; row < 3; row++) {
        const jitter = hash01(i * 17 + row * 31 + (side > 0 ? 7 : 13));
        const lateral = side * (edge + 18 + row * 0.72 + jitter * 0.35);
        const along = (jitter - 0.5) * 3.2;
        dummy.position.set(
          sample.p[0] + sample.n[0] * lateral + sample.t[0] * along,
          sample.p[1] + 0.56 + hash01(i + row * 91) * 0.08,
          sample.p[2] + sample.n[2] * lateral + sample.t[2] * along,
        );
        const scale = 0.9 + hash01(i * 43 + row * 5) * 0.18;
        dummy.scale.setScalar(scale);
        dummy.rotation.set(0, Math.atan2(sample.t[0], sample.t[2]) + jitter * 0.45, 0);
        dummy.updateMatrix();
        transforms.push(dummy.matrix.clone());
        colors.push(new THREE.Color(palette[(i + row + (side > 0 ? 0 : 3)) % palette.length]!));
      }
    }
  }

  const crowd = new THREE.InstancedMesh(geometry, material, transforms.length);
  crowd.name = 'InstancedCrowd';
  for (let i = 0; i < transforms.length; i++) {
    crowd.setMatrixAt(i, transforms[i]!);
    crowd.setColorAt(i, colors[i]!);
  }
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  crowd.castShadow = false;
  crowd.receiveShadow = false;
  root.add(crowd);
  disposables.push(geometry, material);
}

function createAdTexture(label: string, background: string, foreground: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = foreground;
  ctx.fillRect(0, 0, 22, canvas.height);
  ctx.fillRect(canvas.width - 22, 0, 22, canvas.height);
  ctx.font = 'italic 900 116px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 5);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}
