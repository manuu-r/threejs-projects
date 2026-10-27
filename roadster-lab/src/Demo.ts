import type { VehiclePhysics } from './Physics.ts';
import { neutralControls } from './types.ts';
/** A real-physics demonstration. The explicit reset between the two exercises
 * refills the finite reservoir; neither sequence sets velocity or attitude. */
export class DemoDirector {
 time=0;phase=0;done=false;caption='Rear-thrust launch · real-time rigid-body simulation';
 start(p:VehiclePhysics){p.setVariant('thrust');p.armed=true;this.time=0;this.phase=0;this.done=false;}
 update(p:VehiclePhysics,dt:number){
  this.time+=dt;p.controls=neutralControls();
  if(this.phase===0){
   if(this.time<1.7){p.controls.throttle=1;p.controls.boost=this.time>.4&&this.time<1.1;}
   else{p.controls.brake=1;this.caption='Precision braking · tire forces and suction downforce';}
   if(this.time>5.2){this.phase=1;this.time=0;p.setVariant('rocket');p.armed=true;p.toggleFlight();this.caption='New exercise / fresh reservoir · assisted hover';}
  }else{
   if(this.time>1.25&&this.time<1.8){p.controls.yaw=.7;this.caption='Yaw pulse · gas jets create torque about the center of mass';}
   if(this.time>2.2&&p.targetAltitude>0){p.toggleFlight();this.caption='Controlled descent · conserving impulse for touchdown';}
   if(this.time>5){this.done=true;this.caption='Demonstration complete · take the controls';}
  }
 }
}
