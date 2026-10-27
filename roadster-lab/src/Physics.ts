import * as C from 'cannon-es';
import { TireVehicle } from './TireVehicle.ts';
import { SIM } from './config.ts';
import { neutralControls, type Controls, type Telemetry, type Variant } from './types.ts';
const clamp = (x:number,a:number,b:number) => Math.min(b,Math.max(a,x));
const up = new C.Vec3(0,1,0);

/** Constant-volume, adiabatic ideal-gas blowdown. A regulator holds nominal
 * thrust until supply pressure approaches its assumed minimum. No combustion. */
export class GasSystem {
  mass: number = SIM.gasMass;
  deliveredImpulse = 0;
  get pressure(): number { return SIM.fullPressureBar * (this.mass / SIM.gasMass) ** SIM.gamma; }
  get authority(): number { return clamp((this.pressure-SIM.minimumPressureBar) / 55,0,1); }
  get usableMass(): number { return Math.max(0,this.mass-SIM.gasMass*(SIM.minimumPressureBar/SIM.fullPressureBar)**(1/SIM.gamma)); }
  get reserve():number { return this.usableMass * SIM.exhaustVelocity; }
  /** Returns fraction of the requested impulse actually delivered; never creates gas. */
  consume(forceMagnitude:number,dt:number):number {
    const wanted=Math.max(0,forceMagnitude)*dt;
    if(wanted===0)return 1;
    const impulse=Math.min(wanted,this.reserve);
    this.mass=Math.max(0,this.mass-impulse/SIM.exhaustVelocity);
    this.deliveredImpulse+=impulse;
    return impulse/wanted;
  }
  reset(){this.mass=SIM.gasMass;this.deliveredImpulse=0;}
}

export class VehiclePhysics {
  readonly world = new C.World({gravity:new C.Vec3(0,-SIM.gravity,0)});
  readonly body: C.Body;
  readonly vehicle: TireVehicle;
  readonly gas = new GasSystem();
  controls:Controls = neutralControls();
  variant:Variant='performance';
  armed=false; flying=false; assist=true; fan=true;
  gear:'D'|'R'|'N'='D'; wet=false; wind=0;
  targetAltitude=2.2; steer=0; elapsed=0; damage=0;
  rearForce=0; verticalForce=0; downforce=0; energyKwh=0; blocked='';
  private lastVelocity=new C.Vec3();
  private accel=new C.Vec3();
  private colliding=false;
  private pendingImpact=0;
  private tmp=new C.Vec3();
  private localVelocity=new C.Vec3();
  private localOmega=new C.Vec3();
  private qInv=new C.Quaternion();
  private euler=new C.Vec3();
  private lastGrounded=true;
  readonly obstacles: {x:number;y:number;z:number;hx:number;hy:number;hz:number}[]=[];

  constructor(){
    this.world.broadphase=new C.SAPBroadphase(this.world);
    this.world.allowSleep=false;
    (this.world.solver as C.GSSolver).iterations=12;
    const asphalt=new C.Material('asphalt');
    const chassis=new C.Material('chassis');
    this.world.defaultContactMaterial.friction=0.5;
    this.world.addContactMaterial(new C.ContactMaterial(asphalt,chassis,{friction:0.45,restitution:0.03}));
    const ground=new C.Body({mass:0,material:asphalt,shape:new C.Plane()});
    ground.quaternion.setFromEuler(-Math.PI/2,0,0);
    this.world.addBody(ground);
    this.body=new C.Body({mass:SIM.dryMass+SIM.gasMass,material:chassis,
      shape:new C.Box(new C.Vec3(.88,.22,2.05)),linearDamping:.002,angularDamping:.16});
    this.body.position.set(0,SIM.heightAtRest,SIM.startZ);
    this.body.allowSleep=false;
    this.vehicle=new TireVehicle({chassisBody:this.body,indexRightAxis:0,indexForwardAxis:2,indexUpAxis:1});
    for(const z of [SIM.wheelbase/2,-SIM.wheelbase/2])for(const x of [-SIM.track/2,SIM.track/2]){
      this.vehicle.addWheel({chassisConnectionPointLocal:new C.Vec3(x,-.02,z),directionLocal:new C.Vec3(0,-1,0),
        axleLocal:new C.Vec3(-1,0,0),radius:SIM.tireRadius,suspensionRestLength:.32,
        suspensionStiffness:48,dampingCompression:4.2,dampingRelaxation:5.0,
        maxSuspensionForce:42000,maxSuspensionTravel:.22,frictionSlip:1.25,forwardAcceleration:.5,sideAcceleration:1,
        rollInfluence:.08,customSlidingRotationalSpeed:-25,useCustomSlidingRotationalSpeed:true,
        isFrontWheel:z>0});
    }
    this.vehicle.addToWorld(this.world);
    // Visible, finite collision perimeter. The plane itself is deliberately
    // continuous so wheel rays cannot fall through visual asphalt segments.
    this.addBox(-22,.75,0,.8,.75,1500);this.addBox(22,.75,0,.8,.75,1500);
    this.addBox(0,.75,1500,22.5,.75,.75);this.addBox(0,.75,-1500,22.5,.75,.75);
    // Reachable apron buildings retain collision shapes even if a Rocket hops
    // the low runway barriers during free practice. Dimensions match World.ts.
    for(let z=-550;z<100;z+=130){this.addBox(-160,10,z,37.5,10,42.5);this.addBox(-160,21,z,39,1.5,44.5);}
    this.addBox(-80,18,-70,4,18,4);this.addBox(-80,37,-70,8,3,7);this.addBox(-80,41,-70,9,1,8);
    this.body.addEventListener('collide',(e:{contact:C.ContactEquation})=>{
      const impact=Math.abs(e.contact.getImpactVelocityAlongNormal());
      if(impact>2.5){this.pendingImpact=Math.max(this.pendingImpact,impact);this.colliding=true;}
    });
    this.reset();
  }
  addBox(x:number,y:number,z:number,hx:number,hy:number,hz:number){
    this.world.addBody(new C.Body({mass:0,shape:new C.Box(new C.Vec3(hx,hy,hz)),position:new C.Vec3(x,y,z)}));
    this.obstacles.push({x,y,z,hx,hy,hz});
  }
  reset(x=0,z:number=SIM.startZ){
    this.body.position.set(x,SIM.heightAtRest,z);this.body.quaternion.set(0,0,0,1);
    this.body.velocity.setZero();this.body.angularVelocity.setZero();this.body.force.setZero();this.body.torque.setZero();
    this.body.previousPosition.copy(this.body.position);this.body.interpolatedPosition.copy(this.body.position);
    this.body.previousQuaternion.copy(this.body.quaternion);this.body.interpolatedQuaternion.copy(this.body.quaternion);
    this.body.aabbNeedsUpdate=true;this.body.wakeUp();
    this.gas.reset();this.elapsed=0;this.damage=0;this.armed=false;this.flying=false;this.assist=true;
    this.controls=neutralControls();this.gear='D';this.steer=0;this.targetAltitude=2.2;
    this.rearForce=0;this.verticalForce=0;this.energyKwh=0;this.blocked='';this.pendingImpact=0;
    this.lastVelocity.setZero();this.accel.setZero();this.lastGrounded=true;
    for(let i=0;i<4;i++){this.vehicle.applyEngineForce(0,i);this.vehicle.setBrake(0,i);this.vehicle.setSteeringValue(0,i);this.vehicle.updateWheelTransform(i);}
    // Let the suspension find its static equilibrium without counting lesson time.
    this.body.mass=SIM.dryMass+SIM.gasMass;this.body.invMass=1/this.body.mass;
    C.Box.calculateInertia(new C.Vec3(.88,.22,2.05),this.body.mass,this.body.inertia);
    this.body.invInertia.set(1/this.body.inertia.x,1/this.body.inertia.y,1/this.body.inertia.z);this.body.updateInertiaWorld(true);this.body.updateSolveMassProperties();
    for(let i=0;i<90;i++){
      if(this.fan)this.body.applyLocalForce(new C.Vec3(0,-SIM.fanDownforce,0));
      this.world.step(SIM.dt);
    }
    this.lastVelocity.copy(this.body.velocity);
  }
  setVariant(v:Variant){this.variant=v;this.reset();}
  toggleArmed(){
    if(this.variant==='performance'){this.blocked='Select Boost or Flight to arm gas propulsion.';return false;}
    if(this.armed&&this.flying){this.blocked='Land before disarming the flight system.';return false;}
    this.armed=!this.armed;this.blocked='';return true;
  }
  toggleFlight(){
    if(this.variant!=='rocket'){this.blocked='Flight is available only in the flight configuration.';return false;}
    if(!this.armed){this.blocked='Arm the gas system first (F).';return false;}
    if(this.flying){this.targetAltitude=0;this.assist=true;this.blocked='Automatic descent commanded.';return true;}
    if(this.gas.reserve < this.body.mass*SIM.gravity*1.5){this.blocked='Insufficient impulse reserve. Reset for a full reservoir.';return false;}
    if(this.body.velocity.length()>5.6){this.blocked='Slow below 20 km/h before engaging hover.';return false;}
    this.flying=true;this.assist=true;this.targetAltitude=2.2;this.blocked='';return true;
  }
  step(dt:number=SIM.dt){
    const b=this.body,c=this.controls;this.elapsed+=dt;
    if(b.mass!==SIM.dryMass+this.gas.mass){
      b.mass=SIM.dryMass+this.gas.mass;b.invMass=1/b.mass;
      // Recompute local box inertia directly: a world-rotated AABB would give
      // a spurious orientation-dependent inertia during gas depletion.
      C.Box.calculateInertia(new C.Vec3(.88,.22,2.05),b.mass,b.inertia);
      b.invInertia.set(1/b.inertia.x,1/b.inertia.y,1/b.inertia.z);
      b.updateInertiaWorld(true);b.updateSolveMassProperties();
    }
    b.quaternion.inverse(this.qInv);this.qInv.vmult(b.velocity,this.localVelocity);
    b.quaternion.toEuler(this.euler);this.qInv.vmult(b.angularVelocity,this.localOmega);
    const speed=Math.abs(this.localVelocity.z);
    const grounded=this.vehicle.numWheelsOnGround>=2;
    const height=Math.max(0,b.position.y-SIM.heightAtRest);
    this.blocked='';
    const groundFactor=Math.exp(-height*4);
    const trackGrip=Math.abs(b.position.x)<SIM.runwayHalfWidth?1:.45;
    const maxSteer=.43/(1+speed*.035);
    const wantedSteer=c.steer*maxSteer;
    this.steer+=(wantedSteer-this.steer)*(1-Math.exp(-dt*8));
    // With +Z forward, pilot-right is -X. A negative yaw turns right.
    for(let i=0;i<2;i++)this.vehicle.setSteeringValue(-this.steer,i);
    const motorSign=this.gear==='D'?1:this.gear==='R'?-1:0;
    const motorForce=this.flying?0:c.throttle*motorSign*Math.min(SIM.motorForce,SIM.motorPower/Math.max(8,speed));
    const motorLimit=speed>SIM.maxSpeed?0:1;
    for(let i=0;i<4;i++){
      this.vehicle.applyEngineForce(-motorForce*motorLimit/4,i);
      this.vehicle.setBrake(this.flying?0:c.brake*5400*dt+(this.gear==='N'?0:c.throttle<.01?205*dt:0),i);
      this.vehicle.wheelInfos[i]!.frictionSlip=1.25*(this.wet?.62:1)*trackGrip;
    }
    this.downforce=(this.fan&&!this.flying?SIM.fanDownforce*groundFactor:0)+(this.flying?0:.5*SIM.airDensity*SIM.wingAreaCoefficient*speed*speed);
    if(this.downforce>0)b.applyLocalForce(new C.Vec3(0,-this.downforce,0));
    // Drag follows velocity relative to ambient air, not chassis heading.
    const relative=b.velocity.clone();relative.x-=this.wind;
    const airSpeed=relative.length();
    if(airSpeed>0.001){relative.scale(-.5*SIM.airDensity*SIM.dragArea*airSpeed,this.tmp);b.applyForce(this.tmp);}
    if(grounded&&speed>.1)b.applyLocalForce(new C.Vec3(0,0,-Math.sign(this.localVelocity.z)*SIM.rollingCoefficient*b.mass*SIM.gravity));
    this.rearForce=0;this.verticalForce=0;
    let pitchTorque=0,rollTorque=0,yawTorque=0;
    if(c.boost){
      if(!this.armed)this.blocked='Gas system safed. Press F to arm.';
      else if(this.variant==='performance')this.blocked='Road mode has no thrusters.';
      else if(this.gear==='R'&&!this.flying)this.blocked='Rear boost is inhibited in reverse.';
      else if(c.brake>.05&&!this.flying)this.blocked='Release the brake to fire rear thrusters.';
      else this.rearForce=SIM.rearThrust*this.gas.authority;
    }
    if(this.flying){
      const q=b.quaternion;
      const bodyUp=q.vmult(up);
      if(this.assist){
        this.targetAltitude=clamp(this.targetAltitude+c.lift*1.6*dt,0,SIM.maxTrainingAltitude);
        // Cascade: pilot translation -> lean target -> torque; altitude -> lift.
        // Body pitch about +X tilts lift toward +Z; roll about +Z toward -X (pilot right).
        const desiredPitch=c.throttle*.16-c.brake*.16;
        const desiredRoll=c.steer*.16;
        pitchTorque=(desiredPitch-this.euler.x)*14000-this.localOmega.x*6500;
        rollTorque=(desiredRoll-this.euler.z)*14000-this.localOmega.z*6500;
        yawTorque=-c.yaw*SIM.attitudeTorque-this.localOmega.y*4200;
        const altitudeError=this.targetAltitude-height;
        this.verticalForce=clamp(b.mass*(SIM.gravity+altitudeError*7-b.velocity.y*4.5)/Math.max(.45,bodyUp.y),0,SIM.liftThrust);
      }else{
        pitchTorque=(c.pitch||(c.throttle-c.brake))*SIM.attitudeTorque;
        rollTorque=c.steer*SIM.attitudeTorque;
        yawTorque=-c.yaw*SIM.attitudeTorque;
        this.verticalForce=clamp(b.mass*SIM.gravity+c.lift*SIM.liftThrust*.5,0,SIM.liftThrust);
      }
      this.verticalForce*=this.gas.authority;
      pitchTorque=clamp(pitchTorque,-SIM.attitudeTorque,SIM.attitudeTorque)*this.gas.authority;
      rollTorque=clamp(rollTorque,-SIM.attitudeTorque,SIM.attitudeTorque)*this.gas.authority;
      yawTorque=clamp(yawTorque,-SIM.attitudeTorque,SIM.attitudeTorque)*this.gas.authority;
      // A pair of opposed jets costs 2F for torque T=2rF. Count both jets.
    }
    const attitudeForce=(Math.abs(pitchTorque)+Math.abs(rollTorque)+Math.abs(yawTorque))/SIM.leverArm;
    const fraction=this.gas.consume(this.rearForce+this.verticalForce+attitudeForce,dt);
    this.rearForce*=fraction;this.verticalForce*=fraction;
    if(this.rearForce>0){
      // Two rear jets at symmetric offsets: each provides half the commanded
      // force. Off-centre application remains physical if tuning becomes asymmetric.
      for(const x of [-.65,.65])b.applyLocalForce(new C.Vec3(0,0,this.rearForce/2),new C.Vec3(x,0,-1.9));
    }
    if(this.verticalForce>0)for(const x of [-.78,.78])for(const z of [-1.3,1.3])b.applyLocalForce(new C.Vec3(0,this.verticalForce/4,0),new C.Vec3(x,-.1,z));
    if(this.flying){b.quaternion.vmult(new C.Vec3(pitchTorque*fraction,yawTorque*fraction,rollTorque*fraction),this.tmp);b.torque.vadd(this.tmp,b.torque);}
    this.energyKwh+=(Math.abs(motorForce*this.localVelocity.z)+(this.fan&&!this.flying?25000:0))*dt/3.6e6;
    this.world.step(dt);
    b.velocity.vsub(this.lastVelocity,this.accel);this.accel.scale(1/dt,this.accel);this.lastVelocity.copy(b.velocity);
    if(this.colliding){this.damage=clamp(this.damage+this.pendingImpact*3,0,100);this.colliding=false;this.pendingImpact=0;}
    const nowGrounded=this.vehicle.numWheelsOnGround>=2;
    if(this.flying&&nowGrounded&&height<.12&&this.targetAltitude<.2){this.flying=false;this.verticalForce=0;}
    if(this.flying&&this.gas.authority<.05)this.blocked='Gas reserve depleted. Gravity continues to act.';
    if(!this.lastGrounded&&nowGrounded&&this.accel.y>25)this.damage=clamp(this.damage+(this.accel.y-25)*.04,0,100);
    this.lastGrounded=nowGrounded;
  }
  telemetry():Telemetry {
    const b=this.body;b.quaternion.inverse(this.qInv);this.qInv.vmult(b.velocity,this.localVelocity);
    b.quaternion.toEuler(this.euler);
    const a=this.qInv.vmult(this.accel);
    const localGravityCorrection=this.qInv.vmult(new C.Vec3(0,SIM.gravity,0));
    return {speed:b.velocity.length()*3.6,forwardSpeed:this.localVelocity.z*3.6,
      altitude:Math.max(0,b.position.y-SIM.heightAtRest),verticalSpeed:b.velocity.y,
      pressure:this.gas.pressure,gas:this.gas.mass,reserve:this.gas.reserve,
      thrust:this.rearForce,liftThrust:this.verticalForce,
      longitudinalG:a.z/SIM.gravity,lateralG:a.x/SIM.gravity,loadG:(a.y+localGravityCorrection.y)/SIM.gravity,
      steer:this.steer,x:b.position.x,z:b.position.z,heading:this.euler.y,pitch:this.euler.x,roll:this.euler.z,
      contact:this.vehicle.numWheelsOnGround,slip:1-Math.min(...this.vehicle.wheelInfos.map(w=>w.skidInfo)),
      downforce:this.downforce,energy:this.energyKwh,armed:this.armed,flying:this.flying,assist:this.assist,
      fan:this.fan,variant:this.variant,gear:this.gear,damage:this.damage,elapsed:this.elapsed,blocked:this.blocked};
  }
}
