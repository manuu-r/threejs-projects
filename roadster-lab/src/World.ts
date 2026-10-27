import * as T from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { GATES } from './lessons.ts';
import type { LessonId } from './types.ts';
const boxGeo=new T.BoxGeometry(1,1,1);
const dummy=new T.Object3D();
function seeded(seed:number){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function texture(size:number,base:number,variance:number,seed=21):T.CanvasTexture{
 const c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d')!;const im=ctx.createImageData(size,size);const rand=seeded(seed);
 for(let i=0;i<im.data.length;i+=4){const v=base+(rand()-.5)*variance;im.data[i]=v;im.data[i+1]=v+1;im.data[i+2]=v+2;im.data[i+3]=255;}
 ctx.putImageData(im,0,0);const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.colorSpace=T.SRGBColorSpace;return t;
}
export function box(scene:T.Object3D,material:T.Material,x:number,y:number,z:number,w:number,h:number,d:number){const m=new T.Mesh(boxGeo,material);m.position.set(x,y,z);m.scale.set(w,h,d);m.receiveShadow=true;m.castShadow=true;scene.add(m);return m;}
export class ProvingGround {
 readonly ready:Promise<void>;
 readonly group=new T.Group(); readonly training=new T.Group(); readonly sky=new Sky();
 readonly sun=new T.DirectionalLight('#fff1d4',2.7);readonly asphalt:T.MeshPhysicalMaterial;
 readonly landingPad=new T.Group();private gates:T.Group[]=[];
 private current:LessonId='orientation';private windSock:T.Group;private time=0;
 constructor(scene:T.Scene,renderer:T.WebGLRenderer){
   scene.add(this.group);this.group.add(this.training);
   this.sky.scale.setScalar(8000);this.sky.material.uniforms.turbidity!.value=3.8;
   this.sky.material.uniforms.rayleigh!.value=1.3;this.sky.material.uniforms.mieCoefficient!.value=.003;
   this.sky.material.uniforms.mieDirectionalG!.value=.82;
   const sunPos=new T.Vector3(-.72,.28,.68).normalize();this.sky.material.uniforms.sunPosition!.value.copy(sunPos);scene.add(this.sky);
   const pmrem=new T.PMREMGenerator(renderer);const skyScene=new T.Scene();const envSky=this.sky.clone();envSky.scale.setScalar(1);skyScene.add(envSky);const env=pmrem.fromScene(skyScene,.025,.1,100);scene.environment=env.texture;pmrem.dispose();
   scene.environmentIntensity=.65;
   this.ready=new HDRLoader().loadAsync('./assets/sky-lighting.hdr').then(hdr=>{hdr.mapping=T.EquirectangularReflectionMapping;const generator=new T.PMREMGenerator(renderer);const lighting=generator.fromEquirectangular(hdr);scene.environment=lighting.texture;env.dispose();hdr.dispose();generator.dispose();}).catch(()=>{});
   scene.add(new T.HemisphereLight('#dce9f1','#b6a086',.5));
   this.sun.position.copy(sunPos).multiplyScalar(150);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);
   const sc=this.sun.shadow.camera;sc.left=-30;sc.right=30;sc.top=30;sc.bottom=-30;sc.near=20;sc.far=300;this.sun.shadow.bias=-.00025;this.sun.shadow.normalBias=.018;this.sun.shadow.blurSamples=8;scene.add(this.sun);scene.add(this.sun.target);
   scene.fog=new T.FogExp2('#c8c5b4',.00032);
   const sandMap=texture(256,153,22);sandMap.repeat.set(700,700);
   const sand=new T.MeshStandardMaterial({color:'#b5a58a',map:sandMap,roughness:1});
   const ground=new T.Mesh(new T.PlaneGeometry(14000,14000),sand);ground.rotation.x=-Math.PI/2;ground.position.y=-.035;ground.receiveShadow=true;this.group.add(ground);
   const asphaltMap=texture(512,84,37);asphaltMap.repeat.set(7,470);asphaltMap.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
   this.asphalt=new T.MeshPhysicalMaterial({color:'#777f7c',map:asphaltMap,roughness:.91,metalness:.03,clearcoat:0});
   const strip=new T.Mesh(new T.PlaneGeometry(38,3000),this.asphalt);strip.rotation.x=-Math.PI/2;strip.position.y=.003;strip.receiveShadow=true;this.group.add(strip);
   const shoulder=new T.MeshStandardMaterial({color:'#aaa598',roughness:.95});
   for(const x of [-20,20])box(this.group,shoulder,x,-.018,0,2,.035,3000);
   const line=new T.MeshStandardMaterial({color:'#e2e1d6',roughness:.9});
   for(const x of [-15.8,15.8])box(this.group,line,x,.008,0,.18,.008,2940);
   const lines=new T.InstancedMesh(boxGeo,line,74);let j=0;
   for(let z=-1450;z<1450;z+=40){dummy.position.set(0,.012,z);dummy.scale.set(.26,.008,18);dummy.updateMatrix();lines.setMatrixAt(j++,dummy.matrix);}lines.count=j;lines.receiveShadow=true;this.group.add(lines);
   const white=new T.MeshStandardMaterial({color:'#d8d6c9',roughness:.95});
   const barrier=new T.InstancedMesh(boxGeo,white,600);j=0;
   for(const x of [-22,22])for(let z=-1495;z<1500;z+=10){dummy.position.set(x,.75,z);dummy.scale.set(1.6,1.5,9.65);dummy.updateMatrix();barrier.setMatrixAt(j++,dummy.matrix);}barrier.castShadow=barrier.receiveShadow=true;this.group.add(barrier);
   for(const z of [-1500,1500])box(this.group,white,0,.75,z,45,1.5,1.5);
   const lightMat=new T.MeshBasicMaterial({color:'#eac49d'});
   const lamps=new T.InstancedMesh(new T.CylinderGeometry(.055,.065,.15,6),lightMat,200);j=0;
   for(const x of [-16.6,16.6])for(let z=-1450;z<1450;z+=30){dummy.position.set(x,.10,z);dummy.scale.set(1,1,1);dummy.updateMatrix();lamps.setMatrixAt(j++,dummy.matrix);}lamps.count=j;this.group.add(lamps);
   // Real-size airport hangars and a distant control tower give speed/scale cues.
   const hangar=new T.MeshStandardMaterial({color:'#b6b9b0',roughness:.62,metalness:.28});
   const dark=new T.MeshStandardMaterial({color:'#3e4746',roughness:.55});
   const apron=new T.Mesh(new T.PlaneGeometry(260,700),new T.MeshStandardMaterial({color:'#9c9c8d',roughness:.95}));apron.rotation.x=-Math.PI/2;apron.position.set(-165,-.005,-320);this.group.add(apron);
   for(let z=-550;z<100;z+=130){box(this.group,hangar,-160,10,z,75,20,85);box(this.group,dark,-121.9,8,z,1,15,63);
    const roof=box(this.group,hangar,-160,21,z,78,3,89);roof.rotation.z=.025;
    for(let r=-40;r<=40;r+=5)box(this.group,hangar,-121.3,8,z+r,.18,16,.12);
    this.sign('R / '+String((z+550)/130+1).padStart(2,'0'),[-121,17,z],12,2,Math.PI/2);
   }
   box(this.group,white,-80,18,-70,8,36,8);box(this.group,dark,-80,37,-70,16,6,14);box(this.group,white,-80,41,-70,18,2,16);
   this.sign('PROTOTYPE  /  PROVING GROUND',[-55,8,-485],34,3,Math.PI/2);
   const mastMat=new T.MeshStandardMaterial({color:'#747b74',metalness:.7,roughness:.4});
   for(let z=-1000;z<=1000;z+=120)for(const x of [-48,48]){box(this.group,mastMat,x,6,z,.14,12,.14);box(this.group,white,x,12,z,1.5,.25,.4);}
   this.mountains();this.rocks();
   this.windSock=new T.Group();this.windSock.position.set(38,7,-470);this.group.add(this.windSock);box(this.group,mastMat,38,3.5,-470,.08,7,.08);
   const sock=new T.Mesh(new T.ConeGeometry(.35,2.5,12,1,true),new T.MeshStandardMaterial({color:'#d37843',side:T.DoubleSide}));sock.rotation.z=Math.PI/2;sock.position.x=1;this.windSock.add(sock);
   this.training.add(this.landingPad);
   const pad=new T.Mesh(new T.RingGeometry(4.6,4.75,96),new T.MeshBasicMaterial({color:'#cbdcb8',side:T.DoubleSide}));pad.rotation.x=-Math.PI/2;pad.position.set(0,.018,-500);this.landingPad.add(pad);
   const ring=new T.Mesh(new T.RingGeometry(6.7,6.75,96),new T.MeshBasicMaterial({color:'#a4b28b',side:T.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.set(0,.019,-500);this.landingPad.add(ring);
   this.sign('H',[0,.02,-500],3,3,0,true,this.landingPad);
   for(let i=0;i<GATES.length;i++){
    const g=GATES[i]!;const group=new T.Group();group.position.set(g.x,0,g.z);this.training.add(group);this.gates.push(group);
    const green=new T.MeshStandardMaterial({color:'#c5df9f',emissive:'#32441b',emissiveIntensity:.4,roughness:.6});
    for(const x of [-3,3]){box(group,green,x,1.2,0,.13,2.4,.13);box(group,dark,x,.07,0,.6,.14,.6);}
    this.sign(String(i+1),[0,2.5,0],1.1,.65,Math.PI,false,group);
   }
   const amber=new T.MeshStandardMaterial({color:'#c9aa60',roughness:.8});
   const brakeGroup=new T.Group();brakeGroup.name='BrakingMarkers';this.training.add(brakeGroup);
   box(brakeGroup,amber,0,.018,-360,29,.01,.5);
   for(const x of [-12,12])box(brakeGroup,amber,x,.018,-315,.22,.01,80);
   box(brakeGroup,amber,0,.018,-275,24,.01,.3);
   this.sign('BRAKE',[0,.025,-354],8,2,0,true,brakeGroup);
   this.sign('STOP',[0,.026,-290],5,2,0,true,brakeGroup);
   this.setLesson('orientation');
 }
 private sign(text:string,pos:[number,number,number],w:number,h:number,rot=0,flat=false,parent:T.Object3D=this.group){
   const c=document.createElement('canvas');c.width=1024;c.height=256;const ctx=c.getContext('2d')!;ctx.fillStyle=flat?'#d2cba9':'#18221f';ctx.fillRect(0,0,1024,256);ctx.fillStyle=flat?'#39433b':'#dae3cc';ctx.font='500 80px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,128);
   const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;const m=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map,side:T.DoubleSide}));m.position.set(...pos);if(flat){m.rotation.x=-Math.PI/2;m.rotation.z=Math.PI;}else m.rotation.y=rot;parent.add(m);return m;
 }
 private mountains(){
   const rand=seeded(48);const geo=new T.PlaneGeometry(10000,10000,130,130);geo.rotateX(-Math.PI/2);const a=geo.getAttribute('position');
   for(let i=0;i<a.count;i++){const x=a.getX(i),z=a.getZ(i),r=Math.hypot(x,z);const peaks=Math.sin(x*.0018)*Math.cos(z*.0023)*180+Math.sin(x*.004+z*.002)*70+rand()*65;const edge=T.MathUtils.smoothstep(r,1600,2700);a.setY(i,edge*(240+peaks)-8);}
   geo.computeVertexNormals();const m=new T.Mesh(geo,new T.MeshStandardMaterial({color:'#8f9085',roughness:1,flatShading:false}));m.receiveShadow=true;this.group.add(m);
 }
 private rocks(){
   const rand=seeded(38);const count=700;const rocks=new T.InstancedMesh(new T.IcosahedronGeometry(1,0),new T.MeshStandardMaterial({color:'#a4977e',roughness:1}),count);
   for(let i=0;i<count;i++){const side=rand()>.5?1:-1;dummy.position.set(side*(40+rand()*1000),rand()*.3,-1500+rand()*3000);const s=.2+rand()*2.4;dummy.scale.set(s,s*.45,s*.8);dummy.rotation.set(rand(),rand()*6,rand());dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);}this.group.add(rocks);
 }
 setLesson(id:LessonId){this.current=id;for(const g of this.gates)g.visible=id==='slalom'||id==='sandbox';this.landingPad.visible=['hover','translation','manual','sandbox'].includes(id);this.training.getObjectByName('BrakingMarkers')!.visible=id==='braking'||id==='sandbox';}
 update(dt:number,x:number,z:number,wind:number,wet:boolean,passedGates=0){
  this.time+=dt;this.sun.position.set(x-108,80,z+102);this.sun.target.position.set(x,0,z);this.sun.target.updateMatrixWorld();
  this.windSock.rotation.y=Math.sin(this.time*1.7)*.09;this.windSock.rotation.z=Math.min(.4,Math.abs(wind)*.035);
  this.asphalt.roughness=wet?.26:.91;this.asphalt.clearcoat=wet?.55:0;
  this.gates.forEach((g,i)=>{g.visible=(this.current==='slalom'||this.current==='sandbox')&&i>=passedGates;});
 }
}
