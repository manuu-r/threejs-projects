import * as T from 'three';
import { VehiclePhysics } from './Physics.ts';
import { ProvingGround } from './World.ts';
import { Cockpit } from './Cockpit.ts';
import { SimAudio } from './Audio.ts';
import { Input, type Action } from './Input.ts';
import { LESSONS, LessonEngine } from './lessons.ts';
import { SIM } from './config.ts';
import { ExperienceDirector } from './Experience.ts';
import { DemoDirector } from './Demo.ts';
import type { LessonId, Telemetry, Variant } from './types.ts';
export class Simulator {
 readonly physics=new VehiclePhysics();readonly lessons=new LessonEngine();readonly audio=new SimAudio();
 readonly scene=new T.Scene();readonly camera=new T.PerspectiveCamera(64,1,.025,9000);
 readonly renderer:T.WebGLRenderer;readonly world:ProvingGround;readonly cockpit:Cockpit;readonly input:Input;
 running=false;ready=false;demo:DemoDirector|undefined;experience:ExperienceDirector|undefined;timeScale=1;
 records:Telemetry[]=[];private lastRecord=0;private accumulator=0;private prev=0;private raf=0;private uiTime=0;private outcomeSent=false;
 onTick:((t:Telemetry)=>void)|undefined;onOutcome:(()=>void)|undefined;onPause:(()=>void)|undefined;onNotice:((s:string)=>void)|undefined;
 private resizeObserver:ResizeObserver;private started=false;
 constructor(readonly canvas:HTMLCanvasElement){
  this.renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFShadowMap;
  this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.85;
  this.world=new ProvingGround(this.scene,this.renderer);this.cockpit=new Cockpit(this.scene,this.camera,this.renderer);
  this.input=new Input(a=>this.action(a),(x,y)=>{this.cockpit.lookYaw=this.cockpit.view==='chase'?this.cockpit.lookYaw-x*.004:T.MathUtils.clamp(this.cockpit.lookYaw-x*.003,-2.65,2.65);this.cockpit.lookPitch=T.MathUtils.clamp(this.cockpit.lookPitch-y*.003,-.7,.9);},canvas);
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement!);this.resize();
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.pause();this.onNotice?.('Graphics context was lost. Reload this page to restart the renderer.');});
 }
 async load(){await this.world.ready;await this.cockpit.load();this.ready=true;this.raf=requestAnimationFrame(this.frame);}
 private resize(){const r=this.canvas.parentElement!.getBoundingClientRect();this.renderer.setSize(r.width,r.height,false);this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix();}
 start(id:LessonId,variant?:Variant){
  this.started=true;const lesson=LESSONS.find(l=>l.id===id)!;this.physics.variant=variant??lesson.variant;this.physics.reset(lesson.spawn.x,lesson.spawn.z);
  this.lessons.reset(id);this.world.setLesson(id);this.cockpit.view='cockpit';this.cockpit.lookYaw=this.cockpit.lookPitch=0;
  this.records=[];this.lastRecord=0;this.outcomeSent=false;this.accumulator=0;this.demo=undefined;this.experience=undefined;this.running=true;this.input.active=true;this.input.clear();
  void this.audio.start().catch(()=>this.onNotice?.('Audio unavailable. The simulation will continue silently.'));
 }
 startExperience(){this.start('sandbox','rocket');this.experience=new ExperienceDirector();this.experience.prepare(this.physics);this.world.setLesson('orientation');}
 startDemo(inside=false){this.start('sandbox','thrust');this.demo=new DemoDirector();this.demo.start(this.physics);this.cockpit.view=inside?'cockpit':'chase';if(inside)this.experience=new ExperienceDirector();this.world.setLesson('orientation');this.input.active=false;}
 reset(){if(this.experience)this.startExperience();else{const id=this.lessons.lesson.id,variant=this.physics.variant;this.start(id,variant);}this.onNotice?.('Fresh drive. Full gas reserve.');}
 pause(){this.running=false;this.input.active=false;this.input.clear();this.accumulator=0;}
 resume(){if(!this.ready)return;this.running=true;this.input.active=!this.demo;this.input.clear();void this.audio.start().catch(()=>{});}
 action(a:Action){
  if(a==='pause'){if(this.running){this.pause();this.onPause?.();}else this.onPause?.();return;}
  if(!this.running)return;
  const p=this.physics;
  if(this.experience&&['arm','assist','fan','gear'].includes(a))return;
  if(this.demo&&!['camera','lookReset','reset'].includes(a))return;
  switch(a){
   case'arm':p.toggleArmed();this.onNotice?.(p.blocked||(p.armed?'Gas system armed. Hold Space for rear thrust.':'Gas system safed.'));break;
   case'hover':if(this.experience){this.experience.toggleFlight(p);this.onNotice?.(p.blocked||(p.flying?'A short assisted lift. H lands sooner.':'Back on the ground.'));}else{p.toggleFlight();this.onNotice?.(p.blocked||(p.flying?'Flight system engaged. Watch the gas reserve.':'Flight system disengaged.'));}break;
   case'assist':if(p.flying){p.assist=!p.assist;if(p.assist)p.targetAltitude=Math.max(.6,p.telemetry().altitude);this.onNotice?.(p.assist?'Attitude and altitude hold restored.':'Manual attitude. E / Q controls collective.');}else this.onNotice?.('Engage flight before changing attitude assistance.');break;
   case'fan':p.fan=!p.fan;this.onNotice?.(p.fan?'Suction downforce enabled.':'Suction downforce disabled.');break;
   case'camera':this.cockpit.lookYaw=this.cockpit.lookPitch=0;this.cockpit.view=({cockpit:'chase',chase:'hood',hood:'cockpit'} as const)[this.cockpit.view];break;
   case'reset':this.reset();break;
   case'gear':if(p.body.velocity.length()<.28){p.gear=p.gear==='D'?'N':p.gear==='N'?'R':'D';this.onNotice?.(`Gear ${p.gear} selected.`);}else this.onNotice?.('Stop before changing direction.');break;
   case'lookReset':this.cockpit.lookPitch=this.cockpit.lookYaw=0;break;
  }
 }
 private frame=(now:number)=>{
  const delta=Math.min(.0667,this.prev?(now-this.prev)/1000:1/60);this.prev=now;
  if(this.running){
   this.accumulator+=delta*this.timeScale;
   const raw=this.demo?undefined:this.input.sample();
   while(this.accumulator>=SIM.dt){
    if(this.demo){this.demo.update(this.physics,SIM.dt);if(this.demo.done){this.demo=undefined;this.input.active=true;this.cockpit.view='cockpit';this.onNotice?.('Your controls are live. R resets and replenishes gas.');}}
    if(raw&&!this.demo)this.physics.controls=this.experience?this.experience.controls(raw,this.physics):raw;
    if(this.experience&&!this.demo&&this.experience.update(this.physics,SIM.dt))this.onNotice?.('Assisted landing. Keeping impulse in reserve for touchdown.');
    this.physics.step();const t=this.physics.telemetry();
    if(!this.demo&&!this.experience)this.lessons.update(t,SIM.dt,this.physics.controls.brake>.1);
    if(t.elapsed<this.lastRecord)this.lastRecord=0;
    if(t.elapsed-this.lastRecord>=.05){this.records.push({...t});if(this.records.length>24000)this.records.shift();this.lastRecord=t.elapsed;}
    this.accumulator-=SIM.dt;
    if((this.lessons.state.complete||this.lessons.state.failed)&&!this.outcomeSent){this.outcomeSent=true;this.audio.chime(this.lessons.state.complete);this.pause();this.onOutcome?.();break;}
   }
  }
  const t=this.physics.telemetry();this.world.update(delta,t.x,t.z,this.physics.wind,this.physics.wet,this.lessons.state.gate);
  this.cockpit.simple=!!this.experience||!this.started;this.cockpit.update(this.physics,t,delta,!this.running);this.audio.update(t,!this.running);
  this.renderer.render(this.scene,this.camera);this.uiTime+=delta;
  if(this.uiTime>.08){this.onTick?.(t);this.uiTime=0;}
  this.raf=requestAnimationFrame(this.frame);
 };
 csv():string{
  const keys:(keyof Telemetry)[]=['elapsed','variant','speed','forwardSpeed','x','z','altitude','verticalSpeed','heading','pitch','roll','longitudinalG','lateralG','loadG','pressure','gas','reserve','thrust','liftThrust','contact','slip','downforce','energy','armed','flying','assist','fan','gear','damage'];
  return keys.join(',')+'\n'+this.records.map(t=>keys.map(k=>typeof t[k]==='number'?(t[k] as number).toFixed(5):t[k]).join(',')).join('\n');
 }
 dispose(){cancelAnimationFrame(this.raf);this.resizeObserver.disconnect();this.input.dispose();void this.audio.dispose();this.cockpit.dispose();this.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});this.renderer.dispose();}
}
