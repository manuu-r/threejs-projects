import type { VehiclePhysics } from './Physics.ts';
import type { Controls } from './types.ts';
import { SIM } from './config.ts';
/** Optional beginner assistance. Forces still come entirely from VehiclePhysics.
 * The finite reservoir is never refilled or hidden during an experience. */
export class ExperienceDirector {
 private flightTime=0;
 prepare(p:VehiclePhysics){p.armed=true;p.assist=true;p.fan=true;this.flightTime=0;}
 controls(raw:Controls,p:VehiclePhysics):Controls {
  return {...raw,boost:p.flying?false:raw.boost,lift:0,pitch:0,roll:0,yaw:p.flying?raw.steer*.75:0,steer:p.flying?raw.steer*.18:raw.steer};
 }
 toggleFlight(p:VehiclePhysics):boolean {
  const wasFlying=p.flying;const accepted=p.toggleFlight();
  if(accepted&&!wasFlying){p.targetAltitude=1.15;this.flightTime=0;}
  return accepted;
 }
 update(p:VehiclePhysics,dt:number):boolean {
  p.assist=true;p.fan=true;
  if(!p.flying){this.flightTime=0;return false;}
  this.flightTime+=dt;
  // Reserve enough impulse for descent and arresting the sink rate.
  if(p.targetAltitude>0&&(this.flightTime>2.5||p.gas.reserve<p.body.mass*SIM.gravity*1.7)){
   p.toggleFlight();return true;
  }
  return false;
 }
 hint(p:VehiclePhysics):string {
  const t=p.telemetry();
  if(t.damage>35)return 'A hard landing. Press R for a fresh drive.';
  if(t.flying)return p.targetAltitude===0?'Settling back onto the runway.':'You’re airborne. W/S moves forward/back; A/D turns. Landing is assisted.';
  if(t.reserve<1000)return 'Gas reserve used. Keep driving, or press R to start fresh.';
  if(t.elapsed<5&&t.speed<8)return 'Hold W to pull away. S brakes. A and D steer.';
  if(t.thrust>100)return 'Feel the extra push. Release Space to end the burst.';
  if(t.speed>100)return 'Ease off W and brake with S. Small steering inputs work best.';
  if(t.speed<15)return 'Space adds thrust. H gives you a brief assisted lift.';
  return 'Look around by dragging the view. Your speed is on the dashboard.';
 }
}
