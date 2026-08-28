import * as THREE from 'three';
import type { TrackData } from './TrackData';

export interface TrackSurfaceDetails {
  root: THREE.Group;
  dispose(): void;
}

/** Fixed, render-only tyre deposits at heavy-braking zones. */
export function createTrackSurfaceDetails(track: TrackData): TrackSurfaceDetails {
  const root = new THREE.Group();
  root.name = 'TrackSurfaceDetails';
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const start = track.json.startSampleIndex;

  const skidMaterial = new THREE.MeshBasicMaterial({
    color: 0x101112,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
    toneMapped: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -12,
    polygonOffsetUnits: -12,
  });
  materials.push(skidMaterial);
  for (const [from, to, lateral] of [
    [-55, -38, -0.2],
    [-54, -37, 0.2],
    [31, 44, -0.16],
    [32, 45, 0.16],
    [96, 111, -0.18],
    [97, 112, 0.18],
    [246, 260, -0.18],
    [247, 261, 0.18],
    [482, 497, -0.18],
    [483, 498, 0.18],
    [718, 733, -0.18],
    [719, 734, 0.18],
  ] as const) {
    const geometry = buildTyreMark(track, start + from, start + to, 0.105, lateral);
    const mark = new THREE.Mesh(geometry, skidMaterial);
    mark.name = 'BakedTyreMark';
    mark.renderOrder = 4;
    root.add(mark);
    geometries.push(geometry);
  }

  return {
    root,
    dispose() {
      root.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

function buildTyreMark(
  track: TrackData,
  fromInclusive: number,
  toInclusive: number,
  width: number,
  lateralOffset: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const count = toInclusive - fromInclusive + 1;
  for (let step = 0; step < count; step++) {
    const sample = track.samples[((fromInclusive + step) % track.count + track.count) % track.count]!;
    const edgeFade = Math.min(1, step / 8, (count - 1 - step) / 8);
    const half = width * 0.5 * Math.max(0.02, edgeFade);
    for (const side of [-1, 1]) {
      // Tiny deterministic wandering keeps the deposits organic while the
      // underlying authored road and its collision mesh remain untouched.
      const progress = count > 1 ? step / (count - 1) : 0;
      const wander = Math.sin(progress * Math.PI * 2.4 + lateralOffset * 11) * 0.018;
      const offset = lateralOffset + wander + side * half;
      positions.push(
        sample.p[0] + sample.n[0] * offset,
        sample.p[1] + 0.12,
        sample.p[2] + sample.n[2] * offset,
      );
    }
    if (step < count - 1) {
      const i = step * 2;
      indices.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
