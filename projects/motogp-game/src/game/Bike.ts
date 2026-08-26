import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PhysicsWorld } from '../core/physicsWorld';
import type { JoltModule } from '../core/jolt';
import { LAYER_MOVING } from '../core/jolt';
import {
  AERO,
  CHASSIS,
  DIFFERENTIAL,
  ENGINE,
  LEAN,
  STEERING,
  TRANSMISSION,
  TYRES,
  WHEELS,
} from '../config';
import type { InputIntent, Telemetry } from '../types';

type BodyID = InstanceType<JoltModule['BodyID']>;
type Body = InstanceType<JoltModule['Body']>;
type VehicleConstraint = InstanceType<JoltModule['VehicleConstraint']>;
type MotorcycleController = InstanceType<JoltModule['MotorcycleController']>;

const DEG = Math.PI / 180;
/** Chassis-center spawn height above ground (radius − attachY + margin). */
const SPAWN_Y = WHEELS.radius - WHEELS.attachY + 0.15;

/**
 * The motorcycle: jolt VehicleConstraint + MotorcycleController (lean spring),
 * driver-input smoothing and telemetry. Knows nothing about laps; visuals sync
 * via syncVisuals() into the exposed THREE.Group.
 */
export class Bike {
  readonly bodyId: BodyID;
  readonly root = new THREE.Group(); // chassis transform target; caller adds to scene
  readonly wheelMeshes: THREE.Mesh[] = [];
  /** Rebuilt by rebuild() — always access through this field. */
  constraint: VehicleConstraint;
  controller: MotorcycleController;

  telemetry: Telemetry = {
    speedKph: 0,
    rpm: 0,
    gear: 1,
    leanDeg: 0,
    wheelContacts: [false, false],
  };

  private world: PhysicsWorld;
  private Jolt: JoltModule;
  private body: Body;
  private steerCurrent = 0; // -1..1, smoothed here like the official demo
  /** Placeholder body parts — removed as a group once bike.glb loads. */
  private placeholderBody = new THREE.Group();
  private stepListener: InstanceType<JoltModule['VehicleConstraintStepListener']> | null = null;
  /** Signed longitudinal speed in m/s (+forward). Updated in postPhysicsUpdate. */
  private forwardSpeed = 0;
  /** Reusable target for getForwardInto in fixed-step code (no THREE import needed). */
  private fwdTmp = { x: 0, y: 0, z: 0 };

  constructor(world: PhysicsWorld, spawn: { x: number; y: number; z: number }, yawRad = 0) {
    this.world = world;
    this.Jolt = world.Jolt;
    const { Jolt, bodyInterface } = world;

    // --- chassis body: box with lowered center of mass ------------------------
    const boxSettings = new Jolt.BoxShapeSettings(
      new Jolt.Vec3(CHASSIS.halfExtents.x, CHASSIS.halfExtents.y, CHASSIS.halfExtents.z),
      0,
      undefined,
    );
    const comSettings = new Jolt.OffsetCenterOfMassShapeSettings(
      new Jolt.Vec3(CHASSIS.comOffset.x, CHASSIS.comOffset.y, CHASSIS.comOffset.z),
      boxSettings,
    );
    const shape = comSettings.Create().Get(); // ownership transferred out of result

    const bcs = new Jolt.BodyCreationSettings(
      shape,
      new Jolt.RVec3(spawn.x, spawn.y + SPAWN_Y, spawn.z),
      Jolt.Quat.prototype.sRotation(new Jolt.Vec3(0, 1, 0), yawRad),
      Jolt.EMotionType_Dynamic,
      LAYER_MOVING,
    );
    bcs.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
    bcs.mMassPropertiesOverride.mMass = CHASSIS.massKg;
    bcs.mMotionQuality = Jolt.EMotionQuality_LinearCast;
    bcs.mAllowSleeping = false;

    this.body = bodyInterface.CreateBody(bcs);
    this.bodyId = this.body.GetID();
    this.body.SetFriction(CHASSIS.friction);
    this.body.SetRestitution(CHASSIS.restitution);
    bodyInterface.AddBody(this.bodyId, Jolt.EActivation_Activate);
    // bcs/shape/settings stay alive — creation chains belong to the binding
    // (jolt.ts memory rules; destroying them corrupts the heap with delay).

    // --- vehicle constraint ---------------------------------------------------
    this.constraint = this.buildConstraint(this.body);
    world.physicsSystem.AddConstraint(this.constraint);
    this.addStepListener();
    this.controller = Jolt.castObject(this.constraint.GetController(), Jolt.MotorcycleController);

    this.buildPlaceholderVisuals();
    void this.loadModel();
  }

  /**
   * Swap the placeholder body for the Blender bike.glb when it arrives. The
   * model is authored in the physics frame (forward +Z, origin = chassis
   * center, no wheels), so it mounts with no transform. Wheels stay procedural
   * — they follow live suspension/steer/spin state.
   */
  private async loadModel(): Promise<void> {
    try {
      const gltf = await new GLTFLoader().loadAsync('/assets/bike.glb');
      gltf.scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.castShadow = true;
        obj.matrixAutoUpdate = false;
        obj.updateMatrix();
      });
      this.placeholderBody.removeFromParent();
      this.root.add(gltf.scene);
    } catch {
      // Model missing/broken — the placeholder stays. Fine for a dev build.
    }
  }

  /**
   * Build the VehicleConstraint from config values. Extracted so rebuild() can
   * recreate it after tuning changes — lean params are settings-only (they must be
   * set on MotorcycleControllerSettings BEFORE the VehicleConstraint is built).
   */
  private buildConstraint(body: Body): VehicleConstraint {
    const { Jolt } = this.world;

    const vehicle = new Jolt.VehicleConstraintSettings();
    vehicle.mUp = new Jolt.Vec3(0, 1, 0);
    vehicle.mForward = new Jolt.Vec3(0, 0, 1);
    vehicle.mMaxPitchRollAngle = 70 * DEG;

    // Wheels: front steerable with a caster-tilted suspension axis.
    const casterTan = Math.tan(WHEELS.casterAngleDeg * DEG);
    for (const isFront of [true, false]) {
      const ws = new Jolt.WheelSettingsWV();
      ws.mPosition = new Jolt.Vec3(0, WHEELS.attachY, isFront ? WHEELS.zFront : WHEELS.zRear);
      ws.mRadius = WHEELS.radius;
      ws.mWidth = WHEELS.width;
      if (isFront) {
        const dir = new Jolt.Vec3(0, -1, casterTan).Normalized();
        ws.mSuspensionDirection = dir;
        ws.mSteeringAxis = dir;
      } else {
        ws.mSuspensionDirection = new Jolt.Vec3(0, -1, 0);
        ws.mMaxSteerAngle = 0;
      }
      const spring = new Jolt.SpringSettings();
      spring.mMode = Jolt.ESpringMode_FrequencyAndDamping;
      spring.mFrequency = isFront
        ? WHEELS.suspensionFrequencyHzFront
        : WHEELS.suspensionFrequencyHzRear;
      spring.mDamping = WHEELS.suspensionDamping;
      ws.mSuspensionSpring = spring;
      ws.mSuspensionMinLength = WHEELS.suspensionMinLength;
      ws.mSuspensionMaxLength = WHEELS.suspensionMaxLength;
      ws.mInertia = WHEELS.inertia;
      ws.mAngularDamping = WHEELS.angularDamping;
      ws.mMaxSteerAngle = STEERING.maxSteerAngleDeg * DEG;
      ws.mMaxBrakeTorque = isFront ? WHEELS.brakeTorqueFront : WHEELS.brakeTorqueRear;
      ws.mMaxHandBrakeTorque = isFront ? 0 : WHEELS.handBrakeTorque;
      for (const [x, y] of TYRES.longitudinalCurve) ws.mLongitudinalFriction.AddPoint(x, y);
      for (const [x, y] of TYRES.lateralCurve) ws.mLateralFriction.AddPoint(x, y);
      vehicle.mWheels.push_back(ws);
    }

    // Motorcycle controller: lean spring + engine + transmission.
    const cs = new Jolt.MotorcycleControllerSettings();
    cs.mEngine.mMaxTorque = ENGINE.maxTorque;
    cs.mEngine.mMinRPM = ENGINE.minRpm;
    cs.mEngine.mMaxRPM = ENGINE.maxRpm;
    for (const [x, y] of ENGINE.normalizedTorqueCurve) {
      cs.mEngine.mNormalizedTorque.AddPoint(x, y);
    }
    cs.mTransmission.mMode = Jolt.ETransmissionMode_Auto;
    for (const r of TRANSMISSION.gearRatios) cs.mTransmission.mGearRatios.push_back(r);
    for (const r of TRANSMISSION.reverseGearRatios) {
      cs.mTransmission.mReverseGearRatios.push_back(r);
    }
    cs.mTransmission.mShiftUpRPM = TRANSMISSION.shiftUpRpm;
    cs.mTransmission.mShiftDownRPM = TRANSMISSION.shiftDownRpm;
    cs.mTransmission.mClutchStrength = TRANSMISSION.clutchStrength;

    const diff = new Jolt.VehicleDifferentialSettings();
    diff.mLeftWheel = DIFFERENTIAL.leftWheelIndex;
    diff.mRightWheel = DIFFERENTIAL.rightWheelIndex;
    diff.mDifferentialRatio = DIFFERENTIAL.ratio;
    diff.mLimitedSlipRatio = DIFFERENTIAL.limitedSlipRatio;
    cs.mDifferentials.push_back(diff);

    cs.mMaxLeanAngle = LEAN.maxLeanAngleDeg * DEG;
    cs.mLeanSpringConstant = LEAN.springConstant;
    cs.mLeanSpringDamping = LEAN.springDamping;
    cs.mLeanSpringIntegrationCoefficient = LEAN.integrationCoefficient;
    cs.mLeanSpringIntegrationCoefficientDecay = LEAN.integrationCoefficientDecay;
    cs.mLeanSmoothingFactor = LEAN.smoothingFactor;
    vehicle.mController = cs;

    const constraint = new Jolt.VehicleConstraint(body, vehicle);
    const tester = new Jolt.VehicleCollisionTesterCastCylinder(LAYER_MOVING, 1);
    constraint.SetVehicleCollisionTester(tester);
    // cs/ws/spring/vehicle/tester all stay alive — see jolt.ts memory rules.

    return constraint;
  }

  private addStepListener(): void {
    this.stepListener = new this.Jolt.VehicleConstraintStepListener(this.constraint);
    this.world.physicsSystem.AddStepListener(this.stepListener);
  }

  /**
   * Destroy and rebuild the constraint (dev key T) — the only way to retune lean
   * parameters at runtime after editing config.ts (HMR-friendly tuning loop).
   */
  rebuild(): void {
    const { Jolt, physicsSystem, bodyInterface } = this.world;
    if (this.stepListener) physicsSystem.RemoveStepListener(this.stepListener);
    physicsSystem.RemoveConstraint(this.constraint);
    // The old constraint is intentionally NOT destroyed — same binding rule as
    // creation chains (jolt.ts). Dev-only path; the leak is bounded by presses.
    bodyInterface.ActivateBody(this.bodyId);
    this.constraint = this.buildConstraint(this.body);
    physicsSystem.AddConstraint(this.constraint);
    this.addStepListener();
    this.controller = Jolt.castObject(this.constraint.GetController(), Jolt.MotorcycleController);
  }

  /** Called once per fixed step, BEFORE world.step(). */
  prePhysicsUpdate(dt: number, intent: InputIntent): void {
    const { bodyInterface, scratch } = this.world;
    const { vec3 } = scratch;

    // Steering ramp (official-demo scheme: rate * dt inside the fixed step).
    const rate =
      Math.abs(intent.steer) > Math.abs(this.steerCurrent)
        ? STEERING.steerSpeedPerSec
        : STEERING.returnSpeedPerSec;
    const delta = intent.steer - this.steerCurrent;
    this.steerCurrent += Math.max(-rate * dt, Math.min(rate * dt, delta));

    // Arcade direction handling: braking wins while moving the "wrong" way;
    // reverse only engages once nearly stopped (symmetric for forward).
    let forward = 0;
    let brake = 0;
    if (intent.throttle > 0 && this.forwardSpeed < -0.6) brake = intent.throttle;
    else if (intent.brake > 0 && this.forwardSpeed > 0.6) brake = intent.brake;
    else if (intent.brake > 0) forward = -intent.brake;
    else forward = intent.throttle;

    this.controller.SetDriverInput(forward, this.steerCurrent, brake, intent.handbrake);

    // Aerodynamic drag + downforce (forces reset after each Step).
    const speedSq = this.forwardSpeed * this.forwardSpeed;
    if (speedSq > 1) {
      this.getForwardInto(this.fwdTmp);
      const dragMag = AERO.dragK * speedSq;
      vec3.Set(-this.fwdTmp.x * dragMag, -this.fwdTmp.y * dragMag, -this.fwdTmp.z * dragMag);
      bodyInterface.AddForce(this.bodyId, vec3, this.Jolt.EActivation_DontActivate);
      vec3.Set(0, -AERO.downforceK * speedSq, 0);
      bodyInterface.AddForce(this.bodyId, vec3, this.Jolt.EActivation_DontActivate);
    }

    if (forward !== 0 || brake !== 0 || intent.handbrake > 0 || Math.abs(this.steerCurrent) > 0.01) {
      bodyInterface.ActivateBody(this.bodyId);
    }
  }

  /** Called once per fixed step, AFTER world.step(). Snapshots telemetry. */
  postPhysicsUpdate(): void {
    const { bodyInterface, scratch } = this.world;
    const { quat, rvec3 } = scratch;

    const vel = bodyInterface.GetLinearVelocity(this.bodyId); // allocating getter
    this.getForwardInto(this.fwdTmp);
    this.forwardSpeed =
      vel.GetX() * this.fwdTmp.x + vel.GetY() * this.fwdTmp.y + vel.GetZ() * this.fwdTmp.z;
    this.telemetry.speedKph = vel.Length() * 3.6;
    this.Jolt.destroy(vel);

    bodyInterface.GetPositionAndRotation(this.bodyId, rvec3, quat);
    this.telemetry.leanDeg = computeLean(quat);
    this.telemetry.rpm = this.controller.GetEngine().GetCurrentRPM();
    this.telemetry.gear = this.controller.GetTransmission().GetCurrentGear();
    this.telemetry.wheelContacts[0] = this.constraint.GetWheel(0).HasContact();
    this.telemetry.wheelContacts[1] = this.constraint.GetWheel(1).HasContact();
  }

  /** Copy body transform onto the visual group; place/spin/steer the wheel meshes. */
  syncVisuals(): void {
    const { bodyInterface, scratch } = this.world;
    const { rvec3, quat } = scratch;
    bodyInterface.GetPositionAndRotation(this.bodyId, rvec3, quat);
    this.root.position.set(rvec3.GetX(), rvec3.GetY(), rvec3.GetZ());
    this.root.quaternion.set(quat.GetX(), quat.GetY(), quat.GetZ(), quat.GetW());

    for (const [i, mesh] of this.wheelMeshes.entries()) {
      const wheel = this.constraint.GetWheel(i);
      const suspLen = wheel.GetSuspensionLength();
      const isFront = i === 0;
      // Suspension travel along the (castered) suspension direction.
      let dy = -suspLen;
      let dz = 0;
      if (isFront) {
        const invLen = 1 / Math.hypot(1, Math.tan(WHEELS.casterAngleDeg * DEG));
        dy = -suspLen * invLen;
        dz = suspLen * Math.tan(WHEELS.casterAngleDeg * DEG) * invLen;
      }
      mesh.position.set(0, WHEELS.attachY + dy, (isFront ? WHEELS.zFront : WHEELS.zRear) + dz);
      mesh.rotation.set(
        wheel.GetRotationAngle(),
        isFront ? wheel.GetSteerAngle() : 0,
        0,
        'YXZ', // spin about X applied in the steered frame
      );
    }
  }

  /** Upright reset at (x,z), heading yawRad, zero velocity. */
  respawnAt(x: number, z: number, yawRad: number): void {
    const { Jolt, bodyInterface } = this.world;
    const pos = new Jolt.RVec3(x, SPAWN_Y, z);
    // sRotation returns a shared-slot alias — consume inline, never destroy.
    const yawQ = Jolt.Quat.prototype.sRotation(new Jolt.Vec3(0, 1, 0), yawRad);
    const zero = new Jolt.Vec3(0, 0, 0);
    bodyInterface.SetPositionRotationAndVelocity(this.bodyId, pos, yawQ, zero, zero);
    bodyInterface.ActivateBody(this.bodyId);
    Jolt.destroy(pos);
    Jolt.destroy(zero);
    this.steerCurrent = 0;
  }

  /**
   * World-space forward direction into a plain {x,y,z} target — accepts
   * THREE.Vector3. Allocation-free via the out-param API.
   */
  getForwardInto(target: { x: number; y: number; z: number }): void {
    const { bodyInterface, scratch } = this.world;
    bodyInterface.GetPositionAndRotation(this.bodyId, scratch.rvec3, scratch.quat);
    const q = scratch.quat;
    const x = q.GetX(), y = q.GetY(), z = q.GetZ(), w = q.GetW();
    target.x = 2 * (x * z + w * y);
    target.y = 2 * (y * z - w * x);
    target.z = 1 - 2 * (x * x + y * y);
  }

  dispose(): void {
    const { physicsSystem } = this.world;
    if (this.stepListener) physicsSystem.RemoveStepListener(this.stepListener);
    physicsSystem.RemoveConstraint(this.constraint);
    this.world.destroyBody(this.bodyId);
  }

  /** Placeholder low-poly visuals until bike.glb loads (kept as fallback). */
  private buildPlaceholderVisuals(): void {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd81e2c, metalness: 0.3, roughness: 0.4 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.7 });

    const fairing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 1.3), bodyMat);
    fairing.position.set(0, 0.05, 0.15);
    fairing.castShadow = true;
    this.placeholderBody.add(fairing);

    const rider = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.4, 4, 8), darkMat);
    rider.position.set(0, 0.45, -0.25);
    rider.rotation.x = 1.0; // tuck
    rider.castShadow = true;
    this.placeholderBody.add(rider);
    this.root.add(this.placeholderBody);

    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.9 });
    const geo = new THREE.CylinderGeometry(WHEELS.radius, WHEELS.radius, WHEELS.width, 20);
    geo.rotateZ(-Math.PI / 2); // cylinder axis Y → axle along X
    for (const isFront of [true, false]) {
      const wheel = new THREE.Mesh(geo, tyreMat);
      wheel.position.set(0, WHEELS.attachY, isFront ? WHEELS.zFront : WHEELS.zRear);
      wheel.castShadow = true;
      this.wheelMeshes.push(wheel);
      this.root.add(wheel);
    }
  }
}

/** Signed lean angle (deg) of a body rotation about its forward axis; positive = right. */
function computeLean(q: InstanceType<JoltModule['Quat']>): number {
  const x = q.GetX(), y = q.GetY(), z = q.GetZ(), w = q.GetW();
  // Body-up = q * (0,1,0)
  const ux = 2 * (x * y + w * z);
  const uy = 1 - 2 * (x * x + z * z);
  const uz = 2 * (y * z - w * x);
  // Horizontal forward = flatten(q * (0,0,1)); world-right = cross(up, fwdHoriz)
  const fx = 2 * (x * z + w * y);
  const fz = 1 - 2 * (x * x + y * y);
  const len = Math.hypot(fx, fz) || 1e-6;
  const rx = fz / len;
  const rz = -fx / len;
  return Math.atan2(ux * rx + uz * rz, uy) / DEG;
}
