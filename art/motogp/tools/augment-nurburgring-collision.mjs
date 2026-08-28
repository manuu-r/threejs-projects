#!/usr/bin/env node
/**
 * Append the Nürburgring GLB's missing rideable surface meshes to the compact
 * collision export. Existing authored road/barrier parts are preserved exactly.
 *
 * Run from the repository root:
 *   node art/motogp/tools/augment-nurburgring-collision.mjs
 *   node art/motogp/tools/augment-nurburgring-collision.mjs --dry-run
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';

const repo = resolve(import.meta.dirname, '../../..');
const glbPath = resolve(repo, 'public/motogp/nurburgring-gp.glb');
const collisionPath = resolve(repo, 'public/motogp/nurburgring-asphalt-collision.json');
const addedSurfaces = new Map([
  ['Object_17', 'runoff'], // green painted run-off / braking apron
  ['Object_18', 'gravel'], // high-resolution gravel trap layer
  ['Object_32', 'verge'],  // grass strip between kerb and gravel
]);

const COMPONENT = {
  5120: { ctor: Int8Array, bytes: 1 },
  5121: { ctor: Uint8Array, bytes: 1 },
  5122: { ctor: Int16Array, bytes: 2 },
  5123: { ctor: Uint16Array, bytes: 2 },
  5125: { ctor: Uint32Array, bytes: 4 },
  5126: { ctor: Float32Array, bytes: 4 },
};
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function parseGlb(path) {
  const file = readFileSync(path);
  if (file.toString('utf8', 0, 4) !== 'glTF') throw new Error(`${path} is not a GLB`);
  let json;
  let bin;
  for (let offset = 12; offset < file.length;) {
    const length = file.readUInt32LE(offset);
    const type = file.readUInt32LE(offset + 4);
    const chunk = file.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8').replace(/\0+$/, ''));
    if (type === 0x004e4942) bin = chunk;
    offset += 8 + length;
  }
  if (!json || !bin) throw new Error('GLB requires embedded JSON and BIN chunks');
  return { json, bin };
}

function readAccessor(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const view = gltf.bufferViews[accessor.bufferView];
  const component = COMPONENT[accessor.componentType];
  const width = WIDTH[accessor.type];
  if (!component || !width) throw new Error(`unsupported accessor ${accessorIndex}`);
  if (accessor.sparse) throw new Error(`sparse accessor ${accessorIndex} is unsupported`);
  const stride = view.byteStride ?? component.bytes * width;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const result = new component.ctor(accessor.count * width);
  const source = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const readers = {
    5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16',
    5125: 'getUint32', 5126: 'getFloat32',
  };
  const read = readers[accessor.componentType];
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < width; c++) {
      result[i * width + c] = source[read](base + i * stride + c * component.bytes, true);
    }
  }
  return result;
}

function localMatrix(node) {
  if (node.matrix) return new THREE.Matrix4().fromArray(node.matrix);
  return new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
    new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
    new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]),
  );
}

function worldMatrices(gltf) {
  const worlds = new Map();
  const visit = (index, parent) => {
    const world = parent.clone().multiply(localMatrix(gltf.nodes[index]));
    worlds.set(index, world);
    for (const child of gltf.nodes[index].children ?? []) visit(child, world);
  };
  const scene = gltf.scenes[gltf.scene ?? 0];
  for (const root of scene.nodes ?? []) visit(root, new THREE.Matrix4());
  return worlds;
}

function extractSurface(gltf, bin, worlds, object, role) {
  const nodeIndex = gltf.nodes.findIndex((node) => node.name === object);
  if (nodeIndex < 0) throw new Error(`missing GLB node ${object}`);
  const node = gltf.nodes[nodeIndex];
  if (node.mesh === undefined) throw new Error(`${object} has no mesh`);
  const matrix = worlds.get(nodeIndex);
  const vertices = [];
  const triangles = [];
  const normalBuckets = { steep: 0, sloped: 0, driveable: 0 };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  for (const primitive of gltf.meshes[node.mesh].primitives) {
    if ((primitive.mode ?? 4) !== 4) throw new Error(`${object} is not TRIANGLES`);
    const positions = readAccessor(gltf, bin, primitive.attributes.POSITION);
    const indices = primitive.indices === undefined
      ? Uint32Array.from({ length: positions.length / 3 }, (_, i) => i)
      : readAccessor(gltf, bin, primitive.indices);
    const vertexOffset = vertices.length / 3;
    for (let i = 0; i < positions.length; i += 3) {
      a.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(matrix);
      vertices.push(a.x, a.y, a.z);
    }
    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i];
      const ib = indices[i + 1];
      const ic = indices[i + 2];
      a.fromArray(vertices, (vertexOffset + ia) * 3);
      b.fromArray(vertices, (vertexOffset + ib) * 3);
      c.fromArray(vertices, (vertexOffset + ic) * 3);
      const cross = ab.subVectors(b, a).cross(ac.subVectors(c, a));
      if (cross.lengthSq() < 1e-10) continue;
      const ny = cross.y / cross.length();
      const up = Math.abs(ny);
      if (up >= 0.5) normalBuckets.driveable++;
      else if (up >= 0.2) normalBuckets.sloped++;
      else normalBuckets.steep++;
      // These objects are road/run-off sheets. Keep their upward/sloped faces
      // and omit vertical skirts or undersides that can snag a wheel. Banking
      // on this circuit remains comfortably above the 0.2 threshold.
      if (up < 0.2) continue;
      if (ny >= 0) triangles.push(vertexOffset + ia, vertexOffset + ib, vertexOffset + ic);
      else triangles.push(vertexOffset + ia, vertexOffset + ic, vertexOffset + ib);
    }
  }
  return { object, role, vertices, triangles, normalBuckets };
}

const { json: gltf, bin } = parseGlb(glbPath);
const worlds = worldMatrices(gltf);
const surfaces = [...addedSurfaces].map(([object, role]) =>
  extractSurface(gltf, bin, worlds, object, role));
for (const surface of surfaces) {
  console.log(
    `${surface.object} (${surface.role}): ${surface.vertices.length / 3} vertices, ` +
    `${surface.triangles.length / 3} rideable triangles`,
    surface.normalBuckets,
  );
}
if (process.argv.includes('--dry-run')) process.exit(0);

const collision = JSON.parse(readFileSync(collisionPath, 'utf8'));
const appendedNames = new Set(addedSurfaces.keys());
const originalParts = collision.parts.filter((part) => !appendedNames.has(part.object));
const originalVertexCount = Math.max(...originalParts.map((part) => part.vertexOffset + part.vertexCount));
const originalTriangleCount = Math.max(...originalParts.map((part) => part.triangleOffset + part.triangleCount));
collision.vertices.length = originalVertexCount * 3;
collision.triangles.length = originalTriangleCount * 3;
collision.parts = originalParts;

for (const surface of surfaces) {
  const vertexOffset = collision.vertices.length / 3;
  const triangleOffset = collision.triangles.length / 3;
  collision.vertices.push(...surface.vertices);
  collision.triangles.push(...surface.triangles.map((index) => index + vertexOffset));
  collision.parts.push({
    object: surface.object,
    role: surface.role,
    vertexOffset,
    vertexCount: surface.vertices.length / 3,
    triangleOffset,
    triangleCount: surface.triangles.length / 3,
  });
}
collision.source = 'nurburgring-gp.glb authored road, run-off, gravel, verge and barrier meshes';
writeFileSync(collisionPath, `${JSON.stringify(collision)}\n`);
console.log(`updated ${collisionPath}`);
