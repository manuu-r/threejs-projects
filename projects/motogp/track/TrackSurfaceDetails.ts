import * as THREE from 'three';
import type { TrackData } from './TrackData';

export interface TrackSurfaceDetails {
  root: THREE.Group;
  dispose(): void;
}

/**
 * Subtle, geometry-following wear around the authored start/finish complex.
 * Keeping these decals to the verified pit-straight samples avoids placing a
 * generated ribbon on Nürburgring branches that are not part of the race lap.
 */
export function createTrackSurfaceDetails(track: TrackData): TrackSurfaceDetails {
  const root = new THREE.Group();
  root.name = 'TrackSurfaceDetails';
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const start = track.json.startSampleIndex;

  const racingLine = buildRibbon(track, start - 72, start + 72, 0.86, 0);
  const lineMaterial = new THREE.MeshStandardMaterial({
    color: 0x17191a,
    roughness: 0.64,
    metalness: 0,
    transparent: true,
    opacity: 0.11,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const line = new THREE.Mesh(racingLine, lineMaterial);
  line.name = 'RacingLineWear';
  line.receiveShadow = true;
  root.add(line);
  geometries.push(racingLine);
  materials.push(lineMaterial);

  const skidMaterial = new THREE.MeshBasicMaterial({
    color: 0x08090a,
    transparent: true,
    opacity: 0.17,
    depthWrite: false,
    toneMapped: true,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  materials.push(skidMaterial);
  for (const [from, to, lateral] of [
    [-55, -38, -0.2],
    [-54, -37, 0.2],
    [31, 44, -0.16],
    [32, 45, 0.16],
  ] as const) {
    const geometry = buildRibbon(track, start + from, start + to, 0.075, lateral);
    const mark = new THREE.Mesh(geometry, skidMaterial);
    mark.name = 'BakedTyreMark';
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

function buildRibbon(
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
      const offset = lateralOffset + side * half;
      positions.push(
        sample.p[0] + sample.n[0] * offset,
        sample.p[1] + 0.028,
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
