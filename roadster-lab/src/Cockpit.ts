import * as T from 'three';
import { batchStaticMeshes } from './modelOptimization.ts';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { VehiclePhysics } from './Physics.ts';
import type { Telemetry, View } from './types.ts';
import { variantNames } from './config.ts';
interface Display {canvas:HTMLCanvasElement;ctx:CanvasRenderingContext2D;texture:T.CanvasTexture;}
function display(w=1024,h=640):Display{const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.repeat.x=-1;texture.offset.x=1;return {canvas,ctx:canvas.getContext('2d')!,texture};}
export class Cockpit {
 readonly car=new T.Group();readonly primary=display(1024,400);readonly center=display();readonly secondary=display(800,400);
 private thumbnail:HTMLCanvasElement|undefined;
 simple=false;private secondaryPod:T.Object3D|undefined;private secondaryFace:T.Mesh|undefined;
 private yoke:T.Object3D|undefined;private passengerSeats:T.Object3D[]=[];private glazing:T.Object3D[]=[];private wheels:(T.Object3D|undefined)[]=[];private brakes:(T.Object3D|undefined)[]=[];private aero:T.Object3D|undefined;
 private steam:T.Points;private steamPositions:Float32Array;private jets=new T.Group();
 private mirrorTarget=new T.WebGLRenderTarget(512,128,{type:T.HalfFloatType});private mirrorCam=new T.PerspectiveCamera(58,4,.1,3000);private frame=0;
 private head=new T.Vector3(.46,.47,-.48);private v=new T.Vector3();private q=new T.Quaternion();private bodyQ=new T.Quaternion();private desiredPos=new T.Vector3();private lookTarget=new T.Vector3();
 lookYaw=0;lookPitch=0;view:View='cockpit';fov=64;motion=.65;
 constructor(private scene:T.Scene,private camera:T.PerspectiveCamera,private renderer:T.WebGLRenderer){
   this.car.scale.x=-1;scene.add(this.car);
   this.steamPositions=new Float32Array(360*3);const geo=new T.BufferGeometry();geo.setAttribute('position',new T.BufferAttribute(this.steamPositions,3));
   const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d')!;const grad=ctx.createRadialGradient(32,32,0,32,32,32);grad.addColorStop(0,'rgba(235,242,240,.45)');grad.addColorStop(1,'rgba(235,242,240,0)');ctx.fillStyle=grad;ctx.fillRect(0,0,64,64);
   this.steam=new T.Points(geo,new T.PointsMaterial({map:new T.CanvasTexture(c),color:'#d9e4e2',size:.32,transparent:true,opacity:.33,depthWrite:false,sizeAttenuation:true}));this.steam.frustumCulled=false;scene.add(this.steam);
 }
 async load(progress?:(p:number)=>void){
   const gltf=await new GLTFLoader().loadAsync('./assets/vehicle.glb?v=20261017-unbadged-6',e=>{if(e.total)progress?.(e.loaded/e.total);});
   const object=gltf.scene;
   object.traverse(o=>{if(o instanceof T.Mesh){o.castShadow=true;o.receiveShadow=true;
    const mats=Array.isArray(o.material)?o.material:[o.material];for(const mat of mats)if(mat instanceof T.MeshStandardMaterial){mat.envMapIntensity=.65;if(mat.name.includes('microsuede')||mat.name.includes('grain'))this.addGrain(mat);}
   }});
   this.car.add(object);
   object.traverse(o=>{if(/^(Ultrawhite_seat|Suede_seat|Ultrawhite_fixed|Support_bolster|Integrated_head)/.test(o.name)&&o.position.x>.2)this.passengerSeats.push(o);});
   object.traverse(o=>{if(o instanceof T.Mesh){for(const m of Array.isArray(o.material)?o.material:[o.material]){if(m instanceof T.MeshStandardMaterial&&m.transparent&&m.name.toLowerCase().includes('canopy')){m.transparent=true;m.opacity=.98;m.depthWrite=false;m.side=T.DoubleSide;this.glazing.push(o);}}}});
   batchStaticMeshes(object,this.passengerSeats);
   this.yoke=object.getObjectByName('Yoke');
   this.createThumbnail(object);
   this.wheels=[0,1,2,3].map(i=>object.getObjectByName('Wheel_'+i));
   for(const wheel of this.wheels)if(wheel)batchStaticMeshes(wheel);
   this.brakes=[0,1,2,3].map(i=>object.getObjectByName('Brake_'+i));this.aero=object.getObjectByName('Active_Aero');
   this.screen(this.primary.texture,-.46,.292,.645,.32,.125);
   this.screen(this.center.texture,.04,.285,.573,.38,.25);
   this.secondaryFace=this.screen(this.secondary.texture,.60,.325,.773,.25,.125);this.secondaryPod=object.getObjectByName('Secondary_Display');
   this.screen(this.mirrorTarget.texture,0,.595,.278,.235,.051,true);
   this.car.updateMatrixWorld(true);
 }
 /** Render the authored vehicle for the center screen, using the same materials
  * and geometry as the full-size car instead of a placeholder outline. */
 private createThumbnail(object:T.Object3D){
   const scene=new T.Scene();scene.background=new T.Color('#091112');scene.environment=this.scene.environment;scene.environmentIntensity=.8;
   const car=new T.Group();car.scale.x=-1;car.add(object.clone(true));scene.add(car);
   const sun=new T.DirectionalLight('#ffffff',3);sun.position.set(-3,5,4);scene.add(sun);scene.add(new T.HemisphereLight('#dce4ef','#293139',.8));
   const camera=new T.PerspectiveCamera(37,1.5,.1,50);camera.position.set(-4,1.6,5.3);camera.lookAt(0,.05,0);
   const size=this.renderer.getSize(new T.Vector2()),ratio=this.renderer.getPixelRatio(),target=this.renderer.getRenderTarget();
   this.renderer.setRenderTarget(null);this.renderer.setPixelRatio(1);this.renderer.setSize(600,400,false);this.renderer.render(scene,camera);
   this.thumbnail=document.createElement('canvas');this.thumbnail.width=600;this.thumbnail.height=400;this.thumbnail.getContext('2d')!.drawImage(this.renderer.domElement,0,0);
   this.renderer.setPixelRatio(ratio);this.renderer.setSize(size.x,size.y,false);this.renderer.setRenderTarget(target);
 }
 private addGrain(mat:T.MeshStandardMaterial){
   if(mat.roughnessMap)return;
   const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d')!;const data=x.createImageData(128,128);
   for(let i=0;i<data.data.length;i+=4){const value=230+Math.random()*20;data.data[i]=data.data[i+1]=data.data[i+2]=value;data.data[i+3]=255;}x.putImageData(data,0,0);const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(60,60);mat.roughnessMap=t;mat.roughness=.92;mat.needsUpdate=true;
 }
 private screen(map:T.Texture,x:number,y:number,z:number,w:number,h:number,toneMapped=false){
   const mesh=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map,toneMapped}));mesh.position.set(x,y,z);mesh.rotation.y=Math.PI;this.car.add(mesh);return mesh;
 }
 update(p:VehiclePhysics,t:Telemetry,dt:number,paused:boolean){
   if(this.secondaryPod)this.secondaryPod.visible=!this.simple;if(this.secondaryFace)this.secondaryFace.visible=!this.simple;
   const body=p.body;for(const seat of this.passengerSeats)seat.visible=t.variant!=='rocket';for(const glass of this.glazing){glass.visible=this.view!=='hood';if(glass instanceof T.Mesh)for(const material of Array.isArray(glass.material)?glass.material:[glass.material])if(material instanceof T.MeshStandardMaterial){material.opacity=this.view==='cockpit'?.035:.97;material.envMapIntensity=this.view==='cockpit'?.3:.75;}}
   this.car.position.set(body.position.x,body.position.y,body.position.z);this.bodyQ.set(body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w);this.car.quaternion.copy(this.bodyQ);
   if(this.yoke)this.yoke.rotation.z=t.steer*2.8;
   this.wheels.forEach((w,i)=>{if(!w)return;const info=p.vehicle.wheelInfos[i^1]!;w.rotation.x=info.rotation;w.rotation.y=-info.steering;w.position.y=-.02-info.suspensionLength;const brake=this.brakes[i];if(brake){brake.rotation.y=-info.steering;brake.position.y=w.position.y;}});
   if(this.aero){const deploy=t.flying?0:T.MathUtils.smoothstep(t.speed,70,150);this.aero.position.y=T.MathUtils.damp(this.aero.position.y,.235+deploy*.075,5,dt||.016);this.aero.rotation.x=T.MathUtils.damp(this.aero.rotation.x,-deploy*(.10+p.controls.brake*.65),5,dt||.016);}
   const speedFov=this.motion*(Math.min(t.speed,240)/240)*3;
   this.camera.fov=T.MathUtils.damp(this.camera.fov,(this.view==='chase'?52:this.fov)+speedFov,6,dt||.016);this.camera.updateProjectionMatrix();
   if(this.view==='cockpit'){
     const g=this.motion*.015;const bob=paused?0:(Math.sin(t.z*7)+Math.sin(t.z*11.3)*.4)*Math.min(.0009,t.speed*.000009)*this.motion;
     this.v.set(.46-T.MathUtils.clamp(t.lateralG*g,-.035,.035),.47+bob,-.48-T.MathUtils.clamp(t.longitudinalG*g,-.035,.035));
     this.head.lerp(this.v,1-Math.exp(-Math.max(dt,.016)*7));this.v.copy(this.head).applyQuaternion(this.bodyQ).add(this.car.position);this.camera.position.copy(this.v);
     const pitch=T.MathUtils.clamp(t.longitudinalG,-2,2)*this.motion*.007,roll=T.MathUtils.clamp(t.lateralG,-2,2)*this.motion*.008;
     this.q.setFromEuler(new T.Euler(this.lookPitch-.025+pitch,Math.PI+this.lookYaw,roll,'YXZ'));this.camera.quaternion.copy(this.bodyQ).multiply(this.q);
   }else if(this.view==='hood'){
     this.v.set(0,.63,1.35).applyQuaternion(this.bodyQ).add(this.car.position);this.camera.position.copy(this.v);
     this.lookTarget.set(0,.55,30).applyQuaternion(this.bodyQ).add(this.car.position);this.camera.lookAt(this.lookTarget);
   }else{
     const az=this.lookYaw,el=T.MathUtils.clamp(.3+this.lookPitch,.08,1.1),r=6.3;
     this.desiredPos.set(Math.sin(az)*Math.cos(el)*r,Math.sin(el)*r+.2,-Math.cos(az)*Math.cos(el)*r).applyQuaternion(this.bodyQ).add(this.car.position);
     this.camera.position.lerp(this.desiredPos,1-Math.exp(-dt*8));
     this.lookTarget.set(0,.5,2.5).applyQuaternion(this.bodyQ).add(this.car.position);this.camera.lookAt(this.lookTarget);
   }
   this.car.visible=this.view!=='hood';
   this.drawDisplays(t);this.updateSteam(t);
   // The rearview mirror is a real secondary scene render at a lower cadence.
   if(this.view==='cockpit'&&this.frame++%5===0){
     this.mirrorCam.position.set(0,.595,.25).applyQuaternion(this.bodyQ).add(this.car.position);
     this.mirrorCam.quaternion.copy(this.bodyQ);this.car.visible=false;this.steam.visible=false;
     const target=this.renderer.getRenderTarget();this.renderer.setRenderTarget(this.mirrorTarget);this.renderer.render(this.scene,this.mirrorCam);this.renderer.setRenderTarget(target);
     this.car.visible=true;this.steam.visible=true;
   }
 }
 private updateSteam(t:Telemetry){
   const rear=t.thrust>50,lift=t.liftThrust>50;this.steam.visible=rear||lift;
   if(!rear&&!lift)return;
   for(let i=0;i<360;i++){
    const a=((i*0.137+t.elapsed*1.9)%1);const spread=a*.7;let x:number,y:number,z:number;
    if(i<180&&rear){x=[-.57,-.19,.19,.57][i%4]!+Math.sin(i*32)*spread;y=-.132+Math.cos(i*23)*spread;z=-2.45-a*7;}
    else if(lift){x=(i%2?-.78:.78)+Math.sin(i*32)*spread;y=-.3-a*3;z=(i%3?1.3:-1.3)+Math.cos(i*23)*spread;}
    else{x=0;y=-100;z=0;}
    this.v.set(x,y,z).applyQuaternion(this.bodyQ).add(this.car.position);
    this.steamPositions[i*3]=this.v.x;this.steamPositions[i*3+1]=this.v.y;this.steamPositions[i*3+2]=this.v.z;
   }
   this.steam.geometry.getAttribute('position').needsUpdate=true;
 }
 private text(ctx:CanvasRenderingContext2D,s:string,x:number,y:number,size:number,color='#e8eee3',align:CanvasTextAlign='left'){
   ctx.font=`${size>60?'400':'500'} ${size}px Arial`;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(s,x,y);
 }
 private drawDisplays(t:Telemetry){
   const a=this.primary.ctx;a.fillStyle='#080f10';a.fillRect(0,0,1024,400);
   if(this.simple){
    this.text(a,String(Math.round(t.speed)),505,288,218,'#edf2f4','center');this.text(a,'KM/H',730,280,27,'#9babb5');this.text(a,t.gear,80,78,35,'#d9e3eb');
    a.fillStyle='#253038';a.fillRect(80,335,840,4);a.fillStyle=t.thrust>100?'#df8d80':'#b8c9d5';a.fillRect(80,335,840*Math.min(1,t.speed/360),4);
   }else{
   this.text(a,String(Math.round(t.speed)).padStart(2,'0'),80,277,200);
   this.text(a,'KM/H',320,274,28,'#9ba9a5');this.text(a,t.gear,80,75,42,'#d9e3eb');
   this.text(a,t.flying?'FLIGHT':t.fan?'SUCTION ACTIVE':'ROAD',920,70,28,'#d9e3eb','right');
   this.text(a,`${t.longitudinalG.toFixed(2)} g`,920,177,52,'#e8eee3','right');
   this.text(a,`${Math.round(t.downforce/1000)} kN DOWNFORCE`,920,245,25,'#9ba9a5','right');
   a.fillStyle='#26332e';a.fillRect(80,327,840,5);a.fillStyle='#d9e3eb';a.fillRect(80,327,840*Math.min(1,t.speed/360),5);
   }
   this.primary.texture.needsUpdate=true;
   const c=this.center.ctx;c.fillStyle='#091112';c.fillRect(0,0,1024,640);
   this.text(c,'VEHICLE',60,65,26);this.text(c,variantNames[t.variant].toUpperCase(),964,65,24,'#d9e3eb','right');
   c.strokeStyle='#34443d';c.lineWidth=2;c.beginPath();c.moveTo(60,90);c.lineTo(964,90);c.stroke();
   if(this.thumbnail)c.drawImage(this.thumbnail,65,150,500,334);
   if(!this.simple)this.text(c,'SYSTEM OVERVIEW',85,147,19,'#8fa198');
   for(const [i,label] of (this.simple?[]:['REAR','LIFT','ATTITUDE']).entries()){
    const active=i===0?t.thrust>0:i===1?t.liftThrust>0:t.flying;
    c.fillStyle=active?'#d9e3eb':'#35443e';c.beginPath();c.arc(100+i*158,515,5,0,Math.PI*2);c.fill();this.text(c,label,115+i*158,522,19,active?'#d9e3eb':'#8fa198');
   }
   if(this.simple){
    this.text(c,t.flying?(t.verticalSpeed<-.1?'LANDING':'LIFT ACTIVE'):t.thrust>100?'THRUST ACTIVE':'READY TO DRIVE',610,165,24,'#d9e3eb');
    this.text(c,`${Math.round(t.reserve/91781*100)}%`,610,275,76);this.text(c,'THRUST RESERVE',610,315,21,'#8fa198');
    c.fillStyle='#26392e';c.fillRect(610,348,310,7);c.fillStyle='#d9e3eb';c.fillRect(610,348,310*Math.min(1,t.reserve/91781),7);
    this.text(c,t.flying?`${t.altitude.toFixed(1)} m`:'D',610,450,54);this.text(c,t.flying?'HEIGHT':'DRIVE',610,488,21,'#8fa198');
    this.text(c,'PROTOTYPE / SIMULATED DRIVE',60,602,20,'#8fa198');this.center.texture.needsUpdate=true;
   }else{
   this.text(c,t.armed?'GAS SYSTEM ARMED':'GAS SYSTEM SAFED',610,165,23,t.armed?'#d9e3eb':'#84958d');
   this.text(c,t.pressure.toFixed(0),610,260,78);this.text(c,'BAR',850,260,24,'#8fa198');
   c.fillStyle='#26392e';c.fillRect(610,290,310,10);c.fillStyle=t.pressure<70?'#d8aa68':'#d9e3eb';c.fillRect(610,290,310*Math.min(1,t.pressure/300),10);
   this.text(c,`${(t.reserve/1000).toFixed(1)} kN·s`,610,352,38);this.text(c,'USABLE IMPULSE',610,385,21,'#8fa198');
   this.text(c,`${((t.thrust+t.liftThrust)/1000).toFixed(1)} kN`,610,450,38);this.text(c,'COMMANDED THRUST',610,483,21,'#8fa198');
   c.fillStyle='#1b2925';c.fillRect(60,553,904,1);this.text(c,t.flying?(t.assist?'STABILIZATION ON':'MANUAL ATTITUDE'):'TEACHING MODEL · ASSUMED PARAMETERS',60,602,22,'#9cafa1');this.center.texture.needsUpdate=true;
   }
   const h=this.secondary.ctx;h.fillStyle='#090f11';h.fillRect(0,0,800,400);
   h.save();h.translate(230,200);h.beginPath();h.arc(0,0,147,0,Math.PI*2);h.clip();h.rotate(-t.roll);const pitchOffset=t.pitch*270;
   h.fillStyle='#344852';h.fillRect(-220,-350+pitchOffset,440,350);h.fillStyle='#4b4939';h.fillRect(-220,pitchOffset,440,350);h.strokeStyle='#bbc8b4';h.lineWidth=2;h.beginPath();h.moveTo(-220,pitchOffset);h.lineTo(220,pitchOffset);h.stroke();
   for(let i=-3;i<=3;i++){if(!i)continue;h.beginPath();h.moveTo(-40,i*40+pitchOffset);h.lineTo(40,i*40+pitchOffset);h.stroke();}h.restore();
   h.strokeStyle='#d9e3eb';h.lineWidth=4;h.beginPath();h.moveTo(125,200);h.lineTo(205,200);h.moveTo(255,200);h.lineTo(335,200);h.stroke();
   this.text(h,'ALTITUDE',470,88,25,'#9aaa9f');this.text(h,`${t.altitude.toFixed(1)} m`,470,165,58);
   this.text(h,`${t.verticalSpeed>=0?'+':''}${t.verticalSpeed.toFixed(1)} m/s`,470,236,35);
   this.text(h,t.flying?(t.assist?'HOLD':'MANUAL'):'GROUND',470,315,26,'#d9e3eb');this.secondary.texture.needsUpdate=true;
 }
 dispose(){this.mirrorTarget.dispose();for(const d of [this.primary,this.center,this.secondary])d.texture.dispose();this.steam.geometry.dispose();(this.steam.material as T.Material).dispose();}
}
