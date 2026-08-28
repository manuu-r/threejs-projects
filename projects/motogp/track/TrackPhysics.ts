import { SURFACES } from '../config';
import type { PhysicsWorld } from '../core/physicsWorld';
import type { TrackData } from './TrackData';

export interface AsphaltCollisionData {
  version: 1;
  source: string;
  parts?: Array<{
    object: string;
    role: string;
    vertexOffset: number;
    vertexCount: number;
    triangleOffset: number;
    triangleCount: number;
  }>;
  /** Flat xyz triples in Three/Jolt coordinates (Y up). */
  vertices: number[];
  /** Flat vertex-index triples, wound upward. */
  triangles: number[];
}

const GRID_CELL_SIZE = 25;
const ASPHALT_ROLES = new Set(['asphalt']);
const PLAYABLE_ROLES = new Set(['asphalt', 'curb', 'gravel', 'terrain', 'verge', 'paving']);
const asphaltSpatialIndexes = new WeakMap<AsphaltCollisionData, Map<string, number[]>>();
const playableSpatialIndexes = new WeakMap<AsphaltCollisionData, Map<string, number[]>>();

export async function loadAsphaltCollision(
  url = '/motogp/nurburgring-asphalt-collision.json',
): Promise<AsphaltCollisionData> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`asphalt collision ${response.status} ${url}`);
  const data = (await response.json()) as AsphaltCollisionData;
  if (
    data.version !== 1 ||
    data.vertices.length < 9 ||
    data.vertices.length % 3 !== 0 ||
    data.triangles.length < 3 ||
    data.triangles.length % 3 !== 0
  ) {
    throw new Error('invalid Nürburgring asphalt collision mesh');
  }
  asphaltSpatialIndexes.set(data, buildSpatialIndex(data, ASPHALT_ROLES));
  playableSpatialIndexes.set(data, buildSpatialIndex(data, PLAYABLE_ROLES));
  return data;
}

/**
 * Static collision for the circuit. The asphalt triangles come directly from
 * the supplied Nürburgring GLB. It combines the authored tarmac sections with
 * their terrain underlay so every visible road section has continuous support
 * while retaining the real elevation and camber.
 */
export function buildTrackPhysics(
  world: PhysicsWorld,
  track: TrackData,
  asphalt: AsphaltCollisionData,
): void {
  // Do not add a second, artificial floor below the venue. A bike that left
  // the road used to land on that floor underneath the rendered circuit and
  // could then drive around upside-down. The road-aware watchdog now restores
  // the last safe asphalt pose before the bike can leave the scene.
  if (asphalt.parts?.length) {
    for (const part of asphalt.parts) {
      const vertexOffset = part.vertexOffset * 3;
      const vertices = asphalt.vertices.slice(vertexOffset, vertexOffset + part.vertexCount * 3);
      const triangleOffset = part.triangleOffset * 3;
      const triangles = asphalt.triangles
        .slice(triangleOffset, triangleOffset + part.triangleCount * 3)
        .map((index) => index - part.vertexOffset);
      const welded = weldCollisionMesh(vertices, triangles);
      world.addStaticMesh(welded.vertices, welded.triangles, {
        friction: frictionForRole(part.role),
        restitution: 0,
      });
    }
  } else {
    world.addStaticMesh(asphalt.vertices, asphalt.triangles, {
      friction: SURFACES.asphaltFriction,
      restitution: 0,
    });
  }

  // The supplied collision export stops at the pit-lane apron even though the
  // rendered garages continue farther back. Extend only that verified
  // start/finish service area with an invisible, upward-wound paving plane so
  // the player can enter the garage bays without falling through the venue.
  const grid = track.samples[track.json.startSampleIndex]!;
  const back = 150;
  const inner = -6;
  const outer = -42;
  const point = (along: number, lateral: number): [number, number, number] => [
    grid.p[0] + grid.t[0] * along + grid.n[0] * lateral,
    grid.p[1] - 0.035,
    grid.p[2] + grid.t[2] * along + grid.n[2] * lateral,
  ];
  const garageApron = [
    ...point(-back, inner),
    ...point(-back, outer),
    ...point(back, outer),
    ...point(back, inner),
  ];
  world.addStaticMesh(garageApron, [0, 1, 2, 0, 2, 3], {
    friction: SURFACES.pavingFriction,
    restitution: 0,
  });

  world.optimizeBroadPhase();
}

/**
 * Merge position-identical vertices that were split only for UVs/materials in
 * the render mesh. Shared indices let Jolt recognize internal triangle edges,
 * preventing suspension chatter and tiny launches at invisible texture seams.
 */
export function weldCollisionMesh(
  vertices: readonly number[],
  triangles: readonly number[],
  tolerance = 1e-4,
): { vertices: number[]; triangles: number[] } {
  const inverse = 1 / tolerance;
  const weldedVertices: number[] = [];
  const weldedTriangles: number[] = [];
  const remap = new Uint32Array(vertices.length / 3);
  const unique = new Map<string, number>();

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i]!;
    const y = vertices[i + 1]!;
    const z = vertices[i + 2]!;
    const key = `${Math.round(x * inverse)},${Math.round(y * inverse)},${Math.round(z * inverse)}`;
    let index = unique.get(key);
    if (index === undefined) {
      index = weldedVertices.length / 3;
      unique.set(key, index);
      weldedVertices.push(x, y, z);
    }
    remap[i / 3] = index;
  }

  for (let i = 0; i < triangles.length; i += 3) {
    const a = remap[triangles[i]!]!;
    const b = remap[triangles[i + 1]!]!;
    const c = remap[triangles[i + 2]!]!;
    if (a === b || b === c || c === a) continue;
    weldedTriangles.push(a, b, c);
  }
  return { vertices: weldedVertices, triangles: weldedTriangles };
}

function frictionForRole(role: string): number {
  switch (role) {
    case 'asphalt': return SURFACES.asphaltFriction;
    case 'curb': return SURFACES.kerbFriction;
    case 'gravel': return SURFACES.gravelFriction;
    case 'paving': return SURFACES.pavingFriction;
    case 'barrier': return SURFACES.barrierFriction;
    case 'terrain':
    case 'verge':
    default: return SURFACES.grassFriction;
  }
}

export interface AsphaltSurfaceHit {
  x: number;
  y: number;
  z: number;
  /** Horizontal distance to the closest authored asphalt triangle. */
  horizontalDistance: number;
}

/**
 * Find the closest point on the authored asphalt in XZ, selecting the nearest
 * elevation when circuit pieces overlap. This is the authoritative playable
 * envelope; the legacy timing centerline is deliberately not consulted.
 */
export function queryAsphaltSurface(
  asphalt: AsphaltCollisionData,
  x: number,
  y: number,
  z: number,
): AsphaltSurfaceHit {
  return querySurface(asphalt, x, y, z, asphaltSpatialIndexes, ASPHALT_ROLES);
}

/**
 * Closest authored rideable surface, including pit paving and run-off. This is
 * used for grounding/recovery; barrier walls are deliberately excluded.
 */
export function queryPlayableSurface(
  asphalt: AsphaltCollisionData,
  x: number,
  y: number,
  z: number,
): AsphaltSurfaceHit {
  return querySurface(asphalt, x, y, z, playableSpatialIndexes, PLAYABLE_ROLES);
}

function querySurface(
  asphalt: AsphaltCollisionData,
  x: number,
  y: number,
  z: number,
  indexes: WeakMap<AsphaltCollisionData, Map<string, number[]>>,
  roles: ReadonlySet<string>,
): AsphaltSurfaceHit {
  const { vertices, triangles } = asphalt;
  let bestScore = Infinity;
  let bestX = x;
  let bestY = y;
  let bestZ = z;
  let bestHorizontalSq = Infinity;

  for (const i of candidateTriangleOffsets(asphalt, x, z, indexes, roles)) {
    const ai = triangles[i]! * 3;
    const bi = triangles[i + 1]! * 3;
    const ci = triangles[i + 2]! * 3;
    const ax = vertices[ai]!, ay = vertices[ai + 1]!, az = vertices[ai + 2]!;
    const bx = vertices[bi]!, by = vertices[bi + 1]!, bz = vertices[bi + 2]!;
    const cx = vertices[ci]!, cy = vertices[ci + 1]!, cz = vertices[ci + 2]!;
    const [wa, wb, wc] = closestTriangleWeights2d(x, z, ax, az, bx, bz, cx, cz);
    const sx = ax * wa + bx * wb + cx * wc;
    const sy = ay * wa + by * wb + cy * wc;
    const sz = az * wa + bz * wb + cz * wc;
    const horizontalSq = (sx - x) ** 2 + (sz - z) ** 2;
    const vertical = sy - y;
    // Horizontal containment dominates; vertical distance disambiguates
    // bridges and stacked pieces of asphalt.
    const score = horizontalSq + vertical * vertical * 0.04;
    if (score >= bestScore) continue;
    bestScore = score;
    bestHorizontalSq = horizontalSq;
    bestX = sx;
    bestY = sy;
    bestZ = sz;
  }

  return {
    x: bestX,
    y: bestY,
    z: bestZ,
    horizontalDistance: Math.sqrt(bestHorizontalSq),
  };
}

/** Barycentric weights of the closest point on a triangle projected into XZ. */
function closestTriangleWeights2d(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): [number, number, number] {
  const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(denominator) > 1e-9) {
    const wa = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / denominator;
    const wb = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / denominator;
    const wc = 1 - wa - wb;
    if (wa >= 0 && wb >= 0 && wc >= 0) return [wa, wb, wc];
  }

  const ab = closestEdgeWeight(px, pz, ax, az, bx, bz);
  const bc = closestEdgeWeight(px, pz, bx, bz, cx, cz);
  const ca = closestEdgeWeight(px, pz, cx, cz, ax, az);
  if (ab.distanceSq <= bc.distanceSq && ab.distanceSq <= ca.distanceSq) {
    return [1 - ab.t, ab.t, 0];
  }
  if (bc.distanceSq <= ca.distanceSq) return [0, 1 - bc.t, bc.t];
  return [ca.t, 0, 1 - ca.t];
}

function closestEdgeWeight(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { t: number; distanceSq: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 1e-12
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq))
    : 0;
  const x = ax + dx * t;
  const z = az + dz * t;
  return { t, distanceSq: (x - px) ** 2 + (z - pz) ** 2 };
}

/** Closest safe authored-road point; used only for spawn/recovery. */
export function nearestAsphaltPoint(
  asphalt: AsphaltCollisionData,
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number } {
  const edge = queryAsphaltSurface(asphalt, x, y, z);
  const dx = edge.x - x;
  const dz = edge.z - z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.1) return { x: edge.x, y: edge.y + 0.035, z: edge.z };

  // The legacy timing line is outside the pit-straight asphalt. Continue from
  // the closest edge toward the track by half a lane, then resolve elevation
  // again. This produces a stable grid position on tarmac, not on the grass.
  const inset = Math.min(4, distance);
  const insetX = edge.x + (dx / distance) * inset;
  const insetZ = edge.z + (dz / distance) * inset;
  const road = queryAsphaltSurface(asphalt, insetX, y, insetZ);
  return { x: road.x, y: road.y + 0.035, z: road.z };
}

function buildSpatialIndex(
  asphalt: AsphaltCollisionData,
  roles: ReadonlySet<string>,
): Map<string, number[]> {
  const index = new Map<string, number[]>();
  const { vertices, triangles } = asphalt;
  const triangleIndexes = asphalt.parts?.length
    ? asphalt.parts
      .filter((part) => roles.has(part.role))
      .flatMap((part) => Array.from(
        { length: part.triangleCount },
        (_, i) => part.triangleOffset + i,
      ))
    : Array.from({ length: triangles.length / 3 }, (_, i) => i);
  for (const triangleIndex of triangleIndexes) {
    const i = triangleIndex * 3;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let corner = 0; corner < 3; corner++) {
      const offset = triangles[i + corner]! * 3;
      const vx = vertices[offset]!;
      const vz = vertices[offset + 2]!;
      minX = Math.min(minX, vx);
      maxX = Math.max(maxX, vx);
      minZ = Math.min(minZ, vz);
      maxZ = Math.max(maxZ, vz);
    }
    const minCellX = Math.floor(minX / GRID_CELL_SIZE);
    const maxCellX = Math.floor(maxX / GRID_CELL_SIZE);
    const minCellZ = Math.floor(minZ / GRID_CELL_SIZE);
    const maxCellZ = Math.floor(maxZ / GRID_CELL_SIZE);
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const key = `${cellX},${cellZ}`;
        const cell = index.get(key);
        if (cell) cell.push(i);
        else index.set(key, [i]);
      }
    }
  }
  return index;
}

function candidateTriangleOffsets(
  asphalt: AsphaltCollisionData,
  x: number,
  z: number,
  indexes: WeakMap<AsphaltCollisionData, Map<string, number[]>>,
  roles: ReadonlySet<string>,
): readonly number[] {
  let index = indexes.get(asphalt);
  if (!index) {
    index = buildSpatialIndex(asphalt, roles);
    indexes.set(asphalt, index);
  }
  const cellX = Math.floor(x / GRID_CELL_SIZE);
  const cellZ = Math.floor(z / GRID_CELL_SIZE);
  const direct = index.get(`${cellX},${cellZ}`);
  if (direct?.length) return direct;

  // Recovery queries can happen just outside a surface cell. Expand locally
  // before falling back to the complete mesh, which is exceptionally rare.
  for (let radius = 1; radius <= 4; radius++) {
    const nearby: number[] = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        const cell = index.get(`${cellX + dx},${cellZ + dz}`);
        if (cell) nearby.push(...cell);
      }
    }
    if (nearby.length) return nearby;
  }
  if (asphalt.parts?.length) {
    return asphalt.parts
      .filter((part) => roles.has(part.role))
      .flatMap((part) => Array.from(
        { length: part.triangleCount },
        (_, i) => (part.triangleOffset + i) * 3,
      ));
  }
  return Array.from({ length: asphalt.triangles.length / 3 }, (_, i) => i * 3);
}
