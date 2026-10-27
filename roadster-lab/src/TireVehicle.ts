import { RaycastVehicle, Vec3 } from 'cannon-es';
/** cannon-es 0.20's upstream friction routine computes longitudinal skidInfo,
 * but applies that limiter only when sideImpulse !== 0. A perfectly straight
 * launch/braking run can therefore bypass tire grip entirely. Correct the
 * already-applied forward impulse in that one case; combined-slip contacts
 * retain the engine's normal circle limiter. No dependency files are patched. */
export class TireVehicle extends RaycastVehicle {
 private axle=new Vec3();private forward=new Vec3();private correction=new Vec3();private arm=new Vec3();
 override updateFriction(dt:number){
  super.updateFriction(dt);
  for(let i=0;i<this.wheelInfos.length;i++){
   const wheel=this.wheelInfos[i]!;
   if(!wheel.raycastResult.body||wheel.sideImpulse!==0||wheel.skidInfo>=1||wheel.forwardImpulse===0)continue;
   this.getWheelTransformWorld(i).vectorToWorldFrame(new Vec3(1,0,0),this.axle);
   const normal=wheel.raycastResult.hitNormalWorld;const projection=this.axle.dot(normal);
   normal.scale(projection,this.correction);this.axle.vsub(this.correction,this.axle);this.axle.normalize();
   normal.cross(this.axle,this.forward);this.forward.normalize();
   this.forward.scale(wheel.forwardImpulse*(wheel.skidInfo-1),this.correction);
   wheel.raycastResult.hitPointWorld.vsub(this.chassisBody.position,this.arm);
   this.chassisBody.applyImpulse(this.correction,this.arm);wheel.forwardImpulse*=wheel.skidInfo;
  }
 }
}
