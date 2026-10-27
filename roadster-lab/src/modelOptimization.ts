import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
/** Batch static opaque geometry by material while preserving wheels, the yoke,
 * and configuration-dependent passenger seating as independently movable nodes. */
export function batchStaticMeshes(root:T.Object3D,preserve:readonly T.Object3D[]=[]):number {
 root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert();
 const animated=(o:T.Object3D):boolean=>{
  if(preserve.includes(o))return true;
  for(let n:T.Object3D|null=o;n&&n!==root;n=n.parent)if(n.name==='Yoke'||n.name.startsWith('Wheel_')||n.name.startsWith('Brake_')||n.name==='Active_Aero'||n.name==='Secondary_Display')return true;
  return false;
 };
 const buckets=new Map<string,T.Mesh[]>();
 root.traverse(o=>{
  if(!(o instanceof T.Mesh)||animated(o)||Array.isArray(o.material)||o.material.transparent)return;
  const key=o.material.uuid+Object.keys(o.geometry.attributes).sort().join(',')+Boolean(o.geometry.index);
  const bucket=buckets.get(key)??[];bucket.push(o);buckets.set(key,bucket);
 });
 let removed=0;
 for(const meshes of buckets.values()){
  if(meshes.length<3)continue;
  const geometries=meshes.map(o=>o.geometry.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld)));
  const merged=mergeGeometries(geometries,false);for(const g of geometries)g.dispose();if(!merged)continue;
  const batch=new T.Mesh(merged,meshes[0]!.material);batch.name='Static_material_batch';batch.castShadow=batch.receiveShadow=true;root.add(batch);
  for(const original of meshes)original.parent?.remove(original);removed+=meshes.length-1;
 }
 root.updateMatrixWorld(true);return removed;
}
