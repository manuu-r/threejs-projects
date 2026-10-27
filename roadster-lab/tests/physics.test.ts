import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from 'cannon-es';
import { VehiclePhysics, GasSystem } from '../src/Physics.ts';
import { SIM } from '../src/config.ts';
import { neutralControls } from '../src/types.ts';
const steps=(p:VehiclePhysics,seconds:number)=>{for(let i=0;i<seconds/SIM.dt;i++)p.step();};
const near=(a:number,b:number,epsilon:number)=>assert.ok(Math.abs(a-b)<epsilon,`${a} should be within ${epsilon} of ${b}`);

test('suspension settles and holds a stationary car without numerical drift',()=>{
 const p=new VehiclePhysics();steps(p,12);assert.equal(p.vehicle.numWheelsOnGround,4);near(p.body.position.z,SIM.startZ,.01);near(p.body.position.x,0,.001);assert.ok(p.body.position.y>.5&&p.body.position.y<.7);assert.equal(p.damage,0);
});
test('throttle accelerates forward; braking removes momentum without a chassis flip',()=>{
 const p=new VehiclePhysics();p.controls.throttle=1;steps(p,3);assert.ok(p.telemetry().speed>100);assert.ok(p.body.position.z>SIM.startZ+40);
 p.controls.throttle=0;p.controls.brake=1;steps(p,4);assert.ok(p.telemetry().speed<1);assert.ok(Math.abs(p.telemetry().pitch)<.1);assert.equal(p.damage,0);
});
test('right steering turns toward the right side of a +Z-facing pilot view',()=>{
 const p=new VehiclePhysics();p.controls.throttle=.4;steps(p,2);p.controls.steer=.3;steps(p,1);assert.ok(p.body.position.x<-.5);assert.ok(p.telemetry().heading<0);assert.ok(p.telemetry().contact>=3);
});
test('coasting and aerodynamic drag reduce speed; releasing a jet does not erase velocity',()=>{
 const p=new VehiclePhysics();p.setVariant('thrust');p.armed=true;p.controls.boost=true;steps(p,.4);const speed=p.telemetry().speed;p.controls.boost=false;p.step();assert.ok(p.telemetry().speed>speed*.97);steps(p,2);assert.ok(p.telemetry().speed<speed);
});
test('gas conserves impulse and exhaust mass; blowdown and usable cutoff agree',()=>{
 const g=new GasSystem();near(g.reserve,91781.498,1);assert.equal(g.pressure,300);const m=g.mass;g.consume(22000,.5);near(m-g.mass,11000/650,1e-9);near(g.deliveredImpulse,11000,1e-9);assert.ok(g.pressure<300);
 const initial=g.deliveredImpulse+g.reserve;g.consume(1e9,1);assert.ok(g.reserve<1e-7);near(g.deliveredImpulse,initial,1e-6);near(g.pressure,35,1e-7);assert.equal(g.consume(1000,1),0);assert.ok(g.mass>0);
});
test('performance and safed gas systems cannot produce jet thrust',()=>{
 for(const variant of ['performance','thrust'] as const){const p=new VehiclePhysics();p.setVariant(variant);p.controls.boost=true;steps(p,.5);assert.equal(p.rearForce,0);assert.equal(p.gas.mass,SIM.gasMass);assert.ok(p.telemetry().speed<1);}
});
test('rear thrust is interlocked with brake and reverse',()=>{
 const p=new VehiclePhysics();p.setVariant('thrust');p.armed=true;p.controls.boost=true;p.controls.brake=1;p.step();assert.equal(p.rearForce,0);p.controls.brake=0;p.gear='R';p.step();assert.equal(p.rearForce,0);assert.equal(p.gas.mass,SIM.gasMass);
});
test('rear propulsion adds force, spends gas, and reduces total mass',()=>{
 const base=new VehiclePhysics(),boosted=new VehiclePhysics();boosted.setVariant('thrust');base.controls.throttle=boosted.controls.throttle=1;boosted.armed=true;boosted.controls.boost=true;steps(base,1);steps(boosted,1);assert.ok(boosted.telemetry().speed>base.telemetry().speed+25);assert.ok(boosted.gas.mass<150);near(boosted.body.mass,SIM.dryMass+boosted.gas.mass,.5);assert.ok(boosted.gas.deliveredImpulse>20000);
});
test('wet tires without fan downforce need more stopping distance',()=>{
 const distance=(wet:boolean)=>{const p=new VehiclePhysics();p.fan=false;p.wet=wet;p.reset();p.controls.throttle=1;while(p.telemetry().speed<85)p.step();p.controls.throttle=0;p.controls.brake=1;const start=p.body.position.z;let i=0;while(p.telemetry().speed>1&&i++<1200)p.step();assert.ok(i<1200);return p.body.position.z-start;};
 const dry=distance(false),wet=distance(true);assert.ok(wet>dry*1.12,`${wet} wet vs ${dry} dry`);
});
test('suction adds low-speed downforce and crosswind creates a measurable aerodynamic force',()=>{
 const p=new VehiclePhysics();p.step();assert.ok(p.downforce>12000);p.fan=false;p.step();assert.ok(p.downforce<1);p.setVariant('rocket');p.armed=true;p.toggleFlight();steps(p,1.8);p.wind=12;steps(p,.5);assert.ok(Math.abs(p.body.position.x)>.001);assert.ok(p.energyKwh>=0);
});
test('flight engagement requires Rocket, arming, low speed, and useful reserve',()=>{
 const p=new VehiclePhysics();assert.equal(p.toggleFlight(),false);p.setVariant('rocket');assert.equal(p.toggleFlight(),false);p.toggleArmed();p.body.velocity.z=10;assert.equal(p.toggleFlight(),false);p.body.velocity.z=0;p.gas.consume(1e9,1);assert.equal(p.toggleFlight(),false);p.reset();p.toggleArmed();assert.equal(p.toggleFlight(),true);assert.equal(p.toggleArmed(),false);
});
test('assisted lift leaves the ground and holds a realistic finite-reserve hover',()=>{
 const p=new VehiclePhysics();p.setVariant('rocket');p.armed=true;p.toggleFlight();steps(p,3);near(p.telemetry().altitude,2.2,.15);assert.equal(p.vehicle.numWheelsOnGround,0);assert.ok(p.gas.mass<110);assert.ok(p.gas.mass>85);assert.ok(p.verticalForce>14000);assert.equal(p.downforce,0);
});
test('pilot forward/strafe/yaw controls act in the correct visual direction',()=>{
 const p=new VehiclePhysics();p.setVariant('rocket');p.armed=true;p.toggleFlight();steps(p,1.6);p.controls.throttle=.7;p.controls.steer=.5;p.controls.yaw=.3;steps(p,.8);assert.ok(p.body.velocity.z>.05);assert.ok(p.body.velocity.x<-.05);assert.ok(p.telemetry().heading<-.01);
});
test('manual control applies torque and retains angular motion after a pulse',()=>{
 const p=new VehiclePhysics();p.setVariant('rocket');p.armed=true;p.toggleFlight();steps(p,1.6);p.assist=false;p.controls.yaw=.5;steps(p,.2);const rate=Math.abs(p.body.angularVelocity.y);p.controls.yaw=0;steps(p,.2);assert.ok(rate>.05);assert.ok(Math.abs(p.body.angularVelocity.y)>rate*.8);assert.ok(p.telemetry().heading<0);
});
test('attitude corrections spend the same finite gas reserve',()=>{
 const calm=new VehiclePhysics(),turn=new VehiclePhysics();for(const p of [calm,turn]){p.setVariant('rocket');p.armed=true;p.toggleFlight();steps(p,1.6);p.assist=false;}
 turn.controls.yaw=.8;steps(calm,.4);steps(turn,.4);assert.ok(turn.gas.mass<calm.gas.mass-.5);
});
test('gas depletion removes lift authority and gravity returns the car to ground',()=>{
 const p=new VehiclePhysics();p.setVariant('rocket');p.armed=true;p.toggleFlight();steps(p,9);assert.ok(p.gas.authority<.01);assert.ok(p.telemetry().altitude<.2);assert.ok(p.vehicle.numWheelsOnGround>=2);assert.ok(p.gas.mass>=38.7);assert.ok(p.gas.mass<40);
});
test('a solid runway barrier changes motion and registers a hard impact',()=>{
 const p=new VehiclePhysics();p.body.position.x=19.4;p.body.velocity.x=13;steps(p,.6);assert.ok(p.body.position.x<22);assert.ok(p.body.velocity.x<2);assert.ok(p.damage>0);
});
test('changing orientation cannot change the local inertia at a fixed mass',()=>{
 const p=new VehiclePhysics();p.setVariant('rocket');p.gas.consume(1000,1);p.step();const initial=p.body.inertia.clone();p.body.quaternion.setFromAxisAngle(new C.Vec3(0,1,0),Math.PI/4);p.gas.consume(100,1);p.step();const ratio=p.body.mass/(SIM.dryMass+SIM.gasMass-1000/SIM.exhaustVelocity);near(p.body.inertia.x/initial.x,ratio,1e-8);near(p.body.inertia.z/initial.z,ratio,1e-8);
});
test('reset clears velocities, damage, control input, mode and depleted reservoir',()=>{
 const p=new VehiclePhysics();p.setVariant('rocket');p.armed=true;p.toggleFlight();steps(p,2);p.damage=50;p.controls.yaw=1;p.reset();assert.equal(p.gas.mass,180);assert.equal(p.body.mass,1800);assert.equal(p.armed,false);assert.equal(p.flying,false);assert.equal(p.damage,0);assert.equal(p.elapsed,0);assert.deepEqual(p.controls,neutralControls());near(p.body.position.z,SIM.startZ,.001);assert.equal(p.vehicle.numWheelsOnGround,4);
});

test('drive, neutral and reverse select the expected longitudinal behavior',()=>{
 const p=new VehiclePhysics();p.gear='N';p.controls.throttle=1;steps(p,1);assert.ok(p.telemetry().speed<.1);p.gear='R';steps(p,1);assert.ok(p.telemetry().forwardSpeed< -20);assert.ok(p.body.position.z<SIM.startZ-2);
});
test('banked free fall has zero proper vertical load rather than a fictitious one g',()=>{
 const p=new VehiclePhysics();p.fan=false;p.body.position.y=10;p.body.quaternion.setFromAxisAngle(new C.Vec3(0,0,1),Math.PI/2);p.body.velocity.setZero();p.step();assert.ok(Math.abs(p.telemetry().loadG)<.01);assert.equal(p.vehicle.numWheelsOnGround,0);
});
