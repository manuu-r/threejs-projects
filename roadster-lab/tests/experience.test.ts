import test from 'node:test';import assert from 'node:assert/strict';
import { ExperienceDirector } from '../src/Experience.ts';import { VehiclePhysics } from '../src/Physics.ts';import { SIM } from '../src/config.ts';import { neutralControls } from '../src/types.ts';
function setup(){const p=new VehiclePhysics();p.setVariant('rocket');const e=new ExperienceDirector();e.prepare(p);return {p,e};}
test('simple mode makes thrust available without an extra arming step and preserves finite gas',()=>{
 const {p,e}=setup();assert.ok(p.armed&&p.assist&&p.fan);const initial=p.gas.mass;
 for(let i=0;i<60;i++){p.controls=e.controls({...neutralControls(),throttle:1,boost:true},p);e.update(p,SIM.dt);p.step();}
 assert.ok(p.body.velocity.z>5);assert.ok(p.gas.mass<initial);assert.ok(p.gas.mass>0);assert.ok(p.gas.deliveredImpulse>5000);
});
test('one lift command rises and automatically lands without exhausting the reserve',()=>{
 const {p,e}=setup();assert.equal(e.toggleFlight(p),true);let peak=0,landCommand=false,airborne=false;
 for(let i=0;i<720;i++){
  p.controls=e.controls(neutralControls(),p);landCommand=e.update(p,SIM.dt)||landCommand;p.step();const t=p.telemetry();peak=Math.max(peak,t.altitude);airborne=airborne||t.contact===0;
 }
 assert.ok(airborne&&peak>.65&&peak<1.8,`peak ${peak}`);assert.ok(landCommand);assert.equal(p.flying,false);assert.ok(p.vehicle.numWheelsOnGround>=3);assert.ok(p.gas.reserve>5000,`reserve ${p.gas.reserve}`);assert.equal(p.damage,0);
});
test('simple airborne controls use steering to turn, keep height assisted and inhibit rear thrust',()=>{
 const {p,e}=setup();e.toggleFlight(p);for(let i=0;i<120;i++){p.controls=e.controls(neutralControls(),p);e.update(p,SIM.dt);p.step();}
 const heading=p.telemetry().heading;for(let i=0;i<45;i++){p.controls=e.controls({...neutralControls(),steer:1,boost:true,lift:1,pitch:1,yaw:-1},p);e.update(p,SIM.dt);p.step();assert.equal(p.controls.boost,false);assert.equal(p.controls.lift,0);assert.equal(p.controls.pitch,0);}
 assert.ok(p.telemetry().heading<heading-.02);assert.ok(p.assist);assert.equal(p.rearForce,0);assert.equal(p.targetAltitude,1.15);
});
test('a low-reserve vehicle can still command landing, but cannot initiate another lift',()=>{
 const {p,e}=setup();e.toggleFlight(p);p.gas.consume(1000000,.08);assert.ok(p.gas.reserve<p.body.mass*SIM.gravity*1.5);assert.equal(e.toggleFlight(p),true);assert.equal(p.targetAltitude,0);
 p.flying=false;assert.equal(e.toggleFlight(p),false);
});
