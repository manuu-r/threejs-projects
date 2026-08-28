import * as THREE from 'three';
import type { TrackData } from './TrackData';

/**
 * Replaceable inventory for future commercial trackside placements. Keeping
 * these as named slots means real campaigns can swap textures later without
 * touching placement or game logic.
 */
export const TRACKSIDE_AD_SLOTS = [
  { id: 'brake-late', label: 'BRAKE LATE.\nBLAME THE TYRES.', background: '#f4f0e9', foreground: '#111318' },
  { id: 'apex', label: 'APEX?\nNEVER MET HER.', background: '#f4f0e9', foreground: '#111318' },
  { id: 'full-send', label: 'FULL SEND.\nHALF TALENT.', background: '#f4f0e9', foreground: '#111318' },
] as const;

// The supplied venue and the legacy generated timing line diverge on several
// branches. Keep the inventory API, but do not render placements until they
// are authored against named sockets on the real Nürburgring scene.
const ENABLE_LEGACY_GENERATED_PLACEMENTS = false;
const ENABLE_VERIFIED_PIT_STRAIGHT_PLACEMENTS = true;

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
  if (ENABLE_VERIFIED_PIT_STRAIGHT_PLACEMENTS) {
    buildFrameHoardings(root, disposables);
    buildPitStraightCrowd(root, track, disposables);
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

/** Artwork fitted into the three empty bays of the authored Object_39 frames. */
function buildFrameHoardings(
  root: THREE.Group,
  disposables: Array<{ dispose(): void }>,
): void {
  const frameSockets = [
    { center: [42.2, 69.2, -340.25], size: [18.2, 8.6] },
    { center: [74.0, 69.2, -340.25], size: [21.2, 8.6] },
    { center: [99.7, 69.2, -340.25], size: [23.2, 8.6] },
  ] as const;

  for (let board = 0; board < frameSockets.length; board++) {
    const socket = frameSockets[board]!;
    const slot = TRACKSIDE_AD_SLOTS[board]!;
    const geometry = new THREE.PlaneGeometry(socket.size[0], socket.size[1]);
    const texture = createAdTexture(slot.label, slot.background, slot.foreground, true);
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.46,
      metalness: 0.01,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `AdSlot:${slot.id}:Object_39_Frame`;
    mesh.position.set(socket.center[0], socket.center[1], socket.center[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    disposables.push(geometry, texture, material);
  }
}

function buildPitStraightCrowd(
  root: THREE.Group,
  track: TrackData,
  disposables: Array<{ dispose(): void }>,
): void {
  const geometry = new THREE.CapsuleGeometry(0.15, 0.7, 2, 5);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, vertexColors: true });
  const crowd = new THREE.InstancedMesh(geometry, material, 132);
  crowd.name = 'PitStraightInstancedCrowd';
  const palette = [0xf2f4f8, 0xca1728, 0x1b2639, 0xf0c541, 0x71cce4];
  const start = track.json.startSampleIndex;
  const dummy = new THREE.Object3D();
  let instance = 0;
  for (let step = -52; step <= 52; step += 4) {
    const sample = track.samples[(start + step + track.count) % track.count]!;
    for (const side of [-1, 1]) {
      const edge = side > 0 ? sample.bl : sample.br;
      for (let row = 0; row < 2; row++) {
        if (instance >= crowd.count) break;
        const jitter = hash01(step * 37 + row * 11 + side * 101);
        const lateral = side * (edge + 23 + row * 0.58 + jitter * 0.3);
        dummy.position.set(
          sample.p[0] + sample.n[0] * lateral + sample.t[0] * (jitter - 0.5) * 1.7,
          sample.p[1] + 0.55 + row * 0.46,
          sample.p[2] + sample.n[2] * lateral + sample.t[2] * (jitter - 0.5) * 1.7,
        );
        dummy.rotation.set(0, Math.atan2(-sample.n[0] * side, -sample.n[2] * side), 0);
        dummy.scale.setScalar(0.9 + jitter * 0.16);
        dummy.updateMatrix();
        crowd.setMatrixAt(instance, dummy.matrix);
        crowd.setColorAt(instance, new THREE.Color(palette[instance % palette.length]!));
        instance++;
      }
    }
  }
  crowd.count = instance;
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  crowd.castShadow = false;
  root.add(crowd);
  disposables.push(geometry, material);
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

function createAdTexture(
  label: string,
  background: string,
  foreground: string,
  funnyArtwork = false,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const paint = (image?: CanvasImageSource): void => {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (image) ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = foreground;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const lines = label.split('\n');
    ctx.font = `italic 900 ${lines.length > 1 ? 72 : 104}px Arial, sans-serif`;
    const top = canvas.height * 0.5 - (lines.length - 1) * 42;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i]!, 64, top + i * 84, 690);
    }
    texture.needsUpdate = true;
  };
  paint();
  if (funnyArtwork) {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => paint(image);
    image.src = '/motogp/funny-hoarding-base.png';
  }
  return texture;
}

function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}
