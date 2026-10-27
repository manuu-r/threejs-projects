import test from 'node:test';import assert from 'node:assert/strict';
import { VehiclePhysics } from '../src/Physics.ts';import { LessonEngine,GATES,LESSONS } from '../src/lessons.ts';import { DemoDirector } from '../src/Demo.ts';import { neutralControls,type LessonId } from '../src/types.ts';import { SIM } from '../src/config.ts';
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
function completeExercise(id:LessonId){
 const p=new VehiclePhysics(),l=new LessonEngine(id);p.setVariant(l.lesson.variant);let landing=false,manual=false;
 if(['hover','translation','manual'].includes(id)){p.toggleArmed();p.toggleFlight();}if(id==='impulse')p.toggleArmed();
 for(let i=0;i<120*90&&!l.state.complete&&!l.state.failed;i++){
  const t=p.telemetry();p.controls=neutralControls();
  switch(id){
   case'orientation':p.controls.throttle=l.state.stage===0?1:0;p.controls.brake=l.state.stage===1?1:0;break;
   case'braking':p.controls.throttle=t.z< -360?clamp((101-t.speed)/10,0,1):0;p.controls.brake=t.z>=-360?1:0;break;
   case'slalom':{const g=GATES[Math.min(l.state.gate,4)]!;const angle=Math.atan2(g.x-t.x,Math.max(10,g.z-t.z));const e=angle-t.heading;const err=Math.atan2(Math.sin(e),Math.cos(e));p.controls.steer=clamp(-err*3,-1,1);p.controls.throttle=clamp((12-t.speed/3.6)/3,0,1);p.controls.brake=clamp((t.speed/3.6-12)/5,0,.5);break;}
   case'impulse':p.controls.boost=l.state.stage<2;p.controls.brake=l.state.stage===2?1:0;break;
   default:
    if(id==='translation'&&l.state.stage===1&&t.altitude>1.3)p.controls.throttle=.9;
    if(id==='manual'&&l.state.stage===1&&t.altitude>1.5){if(!manual){p.assist=false;manual=true;}p.controls.yaw=.35;}
    if(l.state.stage===2&&!landing){if(id==='manual'){p.assist=true;p.targetAltitude=t.altitude;}p.toggleFlight();landing=true;}
  }
  p.step();l.update(p.telemetry(),SIM.dt,p.controls.brake>.1);
 }
 return {p,l};
}
for(const lesson of LESSONS.filter(l=>l.id!=='sandbox'))test(`${lesson.number}: ${lesson.subtitle} is completable using physical pilot inputs`,()=>{
 const {p,l}=completeExercise(lesson.id);assert.equal(l.state.failed,false,l.state.reason);assert.equal(l.state.complete,true,JSON.stringify(l.state));assert.ok(l.state.score>=80);assert.equal(l.state.progress,1);assert.ok(p.damage<10);
 if(['hover','translation','manual'].includes(lesson.id)){assert.equal(p.flying,false);assert.ok(p.gas.mass<180&&p.gas.mass>40);assert.ok(p.telemetry().contact>=3);}
});
test('waiting at the start cannot falsely complete an exercise',()=>{for(const id of ['orientation','braking','slalom','impulse','hover','translation','manual'] as const){const p=new VehiclePhysics(),l=new LessonEngine(id);for(let i=0;i<100;i++)l.update(p.telemetry(),SIM.dt);assert.equal(l.state.complete,false);assert.equal(l.state.stage,0);}});
test('missing an ordered gate fails and explains the miss',()=>{const p=new VehiclePhysics(),l=new LessonEngine('slalom');const t=p.telemetry();t.z=-449;t.x=8;l.update(t,SIM.dt);assert.equal(l.state.failed,true);assert.match(l.state.reason,/Gate 1 missed/);});
test('manual lesson requires actual yaw plus restoring assistance before landing',()=>{const p=new VehiclePhysics(),l=new LessonEngine('manual');const t=p.telemetry();t.flying=true;t.altitude=2;l.update(t,SIM.dt);t.assist=false;l.update(t,SIM.dt);assert.equal(l.state.stage,1);t.heading=.2;l.update(t,SIM.dt);assert.equal(l.state.stage,2);t.flying=false;t.contact=4;t.altitude=0;l.update(t,SIM.dt);assert.equal(l.state.complete,false);t.assist=true;l.update(t,SIM.dt);assert.equal(l.state.complete,true);});
test('full-throttle entry overshoots the precision stopping box',()=>{const p=new VehiclePhysics(),l=new LessonEngine('braking');for(let i=0;i<1800&&!l.state.failed;i++){const d=p.body.position.z-SIM.startZ;p.controls.throttle=d<140?1:0;p.controls.brake=d>=140?1:0;p.step();l.update(p.telemetry(),SIM.dt,p.controls.brake>0);}assert.equal(l.state.failed,true);assert.match(l.state.reason,/100 km\/h/);});
test('demonstration launches, brakes, resets explicitly, yaws in hover and lands with gas remaining',()=>{
 const p=new VehiclePhysics(),d=new DemoDirector();d.start(p);let peak=0,alt=0,yaw=0,resets=0,lastPhase=0;
 for(let i=0;i<2000&&!d.done;i++){d.update(p,SIM.dt);p.step();if(d.phase!==lastPhase){resets++;lastPhase=d.phase;}const t=p.telemetry();peak=Math.max(peak,t.speed);alt=Math.max(alt,t.altitude);yaw=Math.max(yaw,Math.abs(t.heading));}
 assert.equal(d.done,true);assert.equal(resets,1);assert.ok(peak>70);assert.ok(alt>1.5);assert.ok(yaw>.3);assert.equal(p.flying,false);assert.equal(p.damage,0);assert.ok(p.gas.mass>40);assert.ok(p.telemetry().speed<1);
});
