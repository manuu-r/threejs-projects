import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import * as T from 'three';import {batchStaticMeshes} from '../src/modelOptimization.ts';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const file=readFileSync(new URL('../public/assets/vehicle.glb',import.meta.url));
const gltf=await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');
const model=gltf.scene;model.scale.x=-1;model.updateMatrixWorld(true);
const camera=new T.PerspectiveCamera(64,16/9,.025,9000);camera.position.set(.46,.47,-.48);camera.quaternion.setFromEuler(new T.Euler(-.025,Math.PI,0,'YXZ'));camera.updateMatrixWorld();
test('portable cockpit loads in the real Three.js GLTF loader with animation roots intact',()=>{
 for(const name of ['Yoke','Wheel_0','Wheel_1','Wheel_2','Wheel_3','Screen_Primary','Screen_Center','Screen_Secondary','Screen_Mirror'])assert.ok(model.getObjectByName(name),name);
 const box=new T.Box3().setFromObject(model);const size=box.getSize(new T.Vector3());assert.ok(size.z>4.6&&size.z<5.1);assert.ok(size.x>2&&size.x<2.8);
 let meshes=0,triangles=0;model.traverse(o=>{if(o instanceof T.Mesh){meshes++;const p=o.geometry.getAttribute('position');for(const value of p.array)assert.ok(Number.isFinite(value));triangles+=(o.geometry.index?.count??p.count)/3;}});assert.ok(meshes>100);assert.ok(triangles>10000&&triangles<500000);
});
test('the yoke and all three displays project into the seated widescreen view',()=>{
 for(const name of ['Yoke','Screen_Primary','Screen_Center','Screen_Secondary']){const pt=model.getObjectByName(name)!.getWorldPosition(new T.Vector3()).project(camera);assert.ok(Math.abs(pt.x)<.9,`${name} horizontal ${pt.x}`);assert.ok(Math.abs(pt.y)<.9,`${name} vertical ${pt.y}`);assert.ok(pt.z>0&&pt.z<1);}
 const p=model.getObjectByName('Screen_Primary')!.getWorldPosition(new T.Vector3()).project(camera);assert.ok(Math.abs(p.x)<.05,'Primary display should align with the driver');const c=model.getObjectByName('Screen_Center')!.getWorldPosition(new T.Vector3()).project(camera);assert.ok(c.x>.2,'Center screen should appear to the driver’s right');
});
test('the forward pilot sightline is clear of opaque cabin geometry',()=>{
 const ray=new T.Raycaster(camera.position,new T.Vector3(0,0,-1).applyQuaternion(camera.quaternion),.05,20);
 const opaque=ray.intersectObject(model,true).filter(hit=>{const m=(hit.object as T.Mesh).material;return !Array.isArray(m)&&!m.transparent&&m.opacity>.95;});assert.equal(opaque.length,0,opaque.map(h=>h.object.name).join(', '));
});
test('detailed source research is retained privately and public notes are brand neutral',()=>{
 const original=readFileSync(new URL('../docs/RESEARCH.md',import.meta.url),'utf8');
 assert.ok(original.split(/\s+/).length>3000);assert.match(original,/https:\/\/www.tesla.com\/roadster/);assert.match(original,/https:\/\/.*nasa.gov/);
 const notes=readFileSync(new URL('../public/notes.md',import.meta.url),'utf8');assert.ok(notes.length>6000);assert.doesNotMatch(notes,/tesla|spacex|roadster/i);assert.match(notes,/300 \/ 35 bar/);assert.match(notes,/1,800 kg/);assert.match(notes,/NASA/);
 assert.ok(!model.getObjectByName('Yoke_badge'));
});

test('runtime geometry batching reduces draw calls without changing shape or animation pivots',()=>{
 const copy=model.clone(true);copy.updateMatrixWorld(true);const before=new T.Box3().setFromObject(copy);
 const preserved:T.Object3D[]=[];copy.traverse(o=>{if(/^(Ultrawhite_seat|Suede_seat|Ultrawhite_fixed|Support_bolster|Integrated_head)/.test(o.name)&&o.position.x>.2)preserved.push(o);});
 const yoke=copy.getObjectByName('Yoke')!;const pivot=yoke.getWorldPosition(new T.Vector3());
 const removed=batchStaticMeshes(copy,preserved);assert.ok(removed>100,`Only ${removed} objects batched`);
 const after=new T.Box3().setFromObject(copy);assert.ok(before.min.distanceTo(after.min)<1e-5);assert.ok(before.max.distanceTo(after.max)<1e-5);
 assert.ok(copy.getObjectByName('Yoke')===yoke);assert.ok(yoke.getWorldPosition(new T.Vector3()).distanceTo(pivot)<1e-8);for(let i=0;i<4;i++)assert.ok(copy.getObjectByName('Wheel_'+i));
 for(const seat of preserved)assert.ok(seat.parent);const ray=new T.Raycaster(camera.position,new T.Vector3(0,0,-1).applyQuaternion(camera.quaternion),.05,20);assert.equal(ray.intersectObject(copy,true).filter(h=>(h.object as T.Mesh).material instanceof T.Material&&!((h.object as T.Mesh).material as T.Material).transparent&&((h.object as T.Mesh).material as T.Material).opacity>.95).length,0);
});

test('both forward displays remain unobstructed down to their numerical readouts',()=>{
 for(const name of ['Screen_Primary','Screen_Secondary']){
  const node=model.getObjectByName(name)!;const center=node.getWorldPosition(new T.Vector3());
  for(const [dx,dy] of [[0,0],[0,-.04],[.08,-.04],[-.08,-.04]]){
   const target=center.clone().add(new T.Vector3(dx,dy,-.004));const ray=new T.Raycaster(camera.position,target.clone().sub(camera.position).normalize(),.05,target.distanceTo(camera.position)+.02);
   const solid=ray.intersectObject(model,true).find(hit=>{const material=(hit.object as T.Mesh).material;return !Array.isArray(material)&&!material.transparent&&material.opacity>.95;});
   assert.equal(solid?.object.name,name,`${name} at ${dx},${dy} is hidden by ${solid?.object.name}`);
  }
 }
});


test('the revised coupe has a low roof, four horizontal rear outlets and independent aero/brake pivots',()=>{
 const bounds=new T.Box3().setFromObject(model);assert.ok(bounds.max.y<.82,`Roof too tall: ${bounds.max.y}`);assert.ok(bounds.max.y>.68);
 const bells:T.Object3D[]=[];model.traverse(o=>{if(o.name.startsWith('Rear_cold_gas_bell'))bells.push(o);});assert.equal(bells.length,4);
 const centers=bells.map(o=>new T.Box3().setFromObject(o).getCenter(new T.Vector3()));assert.ok(Math.max(...centers.map(p=>p.y))-Math.min(...centers.map(p=>p.y))<.005);assert.ok(new Set(centers.map(p=>p.x.toFixed(2))).size===4);
 for(const name of ['Active_Aero','Brake_0','Brake_1','Brake_2','Brake_3'])assert.ok(model.getObjectByName(name),name);
 const copy=model.clone(true);batchStaticMeshes(copy);for(const name of ['Active_Aero','Brake_0','Brake_1','Brake_2','Brake_3'])assert.ok(copy.getObjectByName(name),`${name} was incorrectly merged into the fixed body`);
});
