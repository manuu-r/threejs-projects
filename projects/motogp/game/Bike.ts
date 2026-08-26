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
  /** Resolves after the Ducati GLB has loaded, or after fallback loading fails. */
  readonly ready: Promise<void>;
  /** Wheel assemblies: tyre, rim, rotor, and a coloured hub. */
  readonly wheelMeshes: THREE.Group[] = [];
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
  private steerCurrent = 0; // -1..1 after input shaping and speed cap
  /** Emergency fallback parts — removed once the authored Ducati GLB loads. */
  private placeholderBody = new THREE.Group();
  private stepListener: InstanceType<JoltModule['VehicleConstraintStepListener']> | null = null;
  /** Signed longitudinal speed in m/s (+forward). Updated in postPhysicsUpdate. */
  private forwardSpeed = 0;
  /** Reusable target for getForwardInto in fixed-step code (no THREE import needed). */
  private fwdTmp = { x: 0, y: 0, z: 0 };
  private riderVisual: THREE.Object3D | null = null;
  private riderCockpitHands: THREE.Object3D | null = null;
  private riderVisible = true;

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
    this.ready = this.loadModel();
  }

  /**
   * Swap the fallback for the single Blender-authored Ducati + rider assembly.
   * Blender already established the real-world scale, forward axis and rider
   * contacts, so runtime must not normalize or rotate the model again.
   */
  private async loadModel(): Promise<void> {
    try {
      const gltf = await new GLTFLoader().loadAsync('/motogp/ducati-rider-game-rig.glb');
      gltf.scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
      });

      const mount = new THREE.Group();
      mount.name = 'MarcMarquez93Ducati';
      // Physics root is the chassis centre; the Blender assembly is ground-based.
      mount.position.set(0, -0.74, 0);
      mount.add(gltf.scene);
      this.riderVisual = gltf.scene.getObjectByName('Marc93_Rider_Baked_Final') ?? null;
      this.riderCockpitHands = gltf.scene.getObjectByName('Marc93_Rider_Hands_Cockpit') ?? null;
      if (this.riderVisual) this.riderVisual.visible = this.riderVisible;
      if (this.riderCockpitHands) this.riderCockpitHands.visible = !this.riderVisible;

      this.placeholderBody.removeFromParent();
      for (const wheel of this.wheelMeshes) wheel.visible = false;
      this.root.add(mount);
    } catch {
      // Model missing/broken — the placeholder stays. Fine for a dev build.
    }
  }

  /** Rider view swaps the body shell for the baked gloves gripping the clip-ons. */
  setRiderVisible(visible: boolean): void {
    this.riderVisible = visible;
    if (this.riderVisual) this.riderVisual.visible = visible;
    if (this.riderCockpitHands) this.riderCockpitHands.visible = !visible;
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
    vehicle.mMaxPitchRollAngle = 48 * DEG;

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
        // Jolt's motorcycle sample uses the opposite of the suspension
        // direction as the steering axis.
        ws.mSteeringAxis = new Jolt.Vec3(0, 1, -casterTan).Normalized();
      } else {
        ws.mSuspensionDirection = new Jolt.Vec3(0, -1, 0);
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
      // Only the front wheel steers. This used to be assigned after the rear
      // zero above and accidentally gave both wheels 24 degrees of lock.
      ws.mMaxSteerAngle = isFront ? STEERING.maxSteerAngleDeg * DEG : 0;
      ws.mMaxBrakeTorque = isFront ? WHEELS.brakeTorqueFront : WHEELS.brakeTorqueRear;
      ws.mMaxHandBrakeTorque = 0;
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
  prePhysicsUpdate(_dt: number, intent: InputIntent): void {
    const { bodyInterface, scratch } = this.world;
    const { vec3 } = scratch;

    // Keyboard/gamepad input is shaped and progressively capped with speed.
    // Jolt then applies its physics-derived speed/lean steering limit as a
    // second safety layer inside MotorcycleController::PreCollide.
    const speedKph = Math.abs(this.forwardSpeed) * 3.6;
    const speedScale = sampleCurve(STEERING.speedInputScale, speedKph);
    const steerTarget =
      Math.sign(intent.steer) * Math.pow(Math.abs(intent.steer), STEERING.inputExponent) * speedScale;
    // Controls already applies a timestep-independent steering ramp. Applying
    // a second ramp here made keyboard steering feel delayed and unresponsive.
    const brakingStability =
      1 - THREE.MathUtils.smoothstep(speedKph, 40, 180) * intent.brake * 0.35;
    this.steerCurrent = steerTarget * brakingStability;

    // MotoGP control: S/Down is always a brake. There is no reverse gear and
    // braking at rest must never command negative drive torque.
    let forward = intent.throttle;
    let brake = intent.brake;

    // As in Jolt's official motorcycle sample, reduce braking while leaned so
    // a cornering brake tap does not instantly spin the bike around.
    if (brake > 0) {
      const sinLean = Math.sin(Math.min(89, Math.abs(this.telemetry.leanDeg)) * DEG);
      brake *= Math.max(0.12, (1 - sinLean) ** 2);
    }

    // Anti-wheelie traction control: once the rear is planted and the front
    // lifts, progressively cut drive instead of letting engine torque rotate
    // the entire chassis around the rear axle.
    if (!this.telemetry.wheelContacts[0] && this.telemetry.wheelContacts[1] && forward > 0) {
      forward *= 0.22;
    }
    this.controller.SetDriverInput(forward, this.steerCurrent, brake, 0);

    // Active pitch damper, only while the front wheel is airborne. It permits
    // road crests but arrests a power wheelie before rider/bike leave the road
    // plane. Torque is applied about the bike's world-space right axis.
    if (!this.telemetry.wheelContacts[0] && this.telemetry.wheelContacts[1]) {
      bodyInterface.GetPositionAndRotation(this.bodyId, scratch.rvec3, scratch.quat);
      const q = scratch.quat;
      const qx = q.GetX(), qy = q.GetY(), qz = q.GetZ(), qw = q.GetW();
      const rightX = 1 - 2 * (qy * qy + qz * qz);
      const rightY = 2 * (qx * qy + qw * qz);
      const rightZ = 2 * (qx * qz - qw * qy);
      const forwardY = 2 * (qy * qz - qw * qx);
      // Body::GetAngularVelocity returns a borrowed accessor into the body.
      // Never destroy it: doing so frees WASM-owned memory and causes the
      // delayed `memory access out of bounds` crash seen under throttle.
      const angularVelocity = this.body.GetAngularVelocity();
      const pitchRate =
        angularVelocity.GetX() * rightX +
        angularVelocity.GetY() * rightY +
        angularVelocity.GetZ() * rightZ;
      const liftError = Math.max(0, forwardY - Math.sin(8 * DEG));
      const torque = THREE.MathUtils.clamp(liftError * 6200 - pitchRate * 950, -2400, 6200);
      vec3.Set(rightX * torque, rightY * torque, rightZ * torque);
      bodyInterface.AddTorque(this.bodyId, vec3, this.Jolt.EActivation_DontActivate);
    }

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

    if (forward !== 0 || brake !== 0 || Math.abs(this.steerCurrent) > 0.01) {
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

  /** Upright reset at a sampled road point, heading yawRad, zero velocity. */
  respawnAt(x: number, roadY: number, z: number, yawRad: number): void {
    const { Jolt, bodyInterface } = this.world;
    const pos = new Jolt.RVec3(x, roadY + SPAWN_Y, z);
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

  /**
   * Read the authoritative fixed-step body pose without waiting for the next
   * rendered frame. Returns world-up dot bike-up: +1 upright, -1 inverted.
   */
  getPhysicsPoseInto(
    position: { x: number; y: number; z: number },
    forward: { x: number; y: number; z: number },
  ): number {
    const { bodyInterface, scratch } = this.world;
    bodyInterface.GetPositionAndRotation(this.bodyId, scratch.rvec3, scratch.quat);
    const p = scratch.rvec3;
    const q = scratch.quat;
    position.x = p.GetX();
    position.y = p.GetY();
    position.z = p.GetZ();
    const x = q.GetX(), y = q.GetY(), z = q.GetZ(), w = q.GetW();
    forward.x = 2 * (x * z + w * y);
    forward.y = 2 * (y * z - w * x);
    forward.z = 1 - 2 * (x * x + y * y);
    return 1 - 2 * (x * x + z * z);
  }

  dispose(): void {
    const { physicsSystem } = this.world;
    if (this.stepListener) physicsSystem.RemoveStepListener(this.stepListener);
    physicsSystem.RemoveConstraint(this.constraint);
    this.world.destroyBody(this.bodyId);
  }

  /** Low-poly fallback shown only if the authored Ducati GLB fails to load. */
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

    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x08090c, roughness: 0.84, metalness: 0.02 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x1d2836, roughness: 0.24, metalness: 0.94 });
    const rotorMat = new THREE.MeshStandardMaterial({ color: 0xaab4be, roughness: 0.28, metalness: 0.9 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0xc92430, roughness: 0.2, metalness: 0.52 });
    const tyreGeo = new THREE.CylinderGeometry(WHEELS.radius, WHEELS.radius * 0.97, WHEELS.width, 28, 2);
    tyreGeo.rotateZ(-Math.PI / 2); // cylinder axis Y → axle along X
    const rimGeo = new THREE.CylinderGeometry(WHEELS.radius * 0.66, WHEELS.radius * 0.66, WHEELS.width * 1.14, 24, 1);
    rimGeo.rotateZ(-Math.PI / 2);
    const rotorGeo = new THREE.CylinderGeometry(WHEELS.radius * 0.54, WHEELS.radius * 0.54, 0.012, 24, 1);
    rotorGeo.rotateZ(-Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(WHEELS.radius * 0.18, WHEELS.radius * 0.18, WHEELS.width * 1.28, 16, 1);
    hubGeo.rotateZ(-Math.PI / 2);
    for (const isFront of [true, false]) {
      const wheel = new THREE.Group();
      const tyre = new THREE.Mesh(tyreGeo, tyreMat);
      tyre.castShadow = true;
      tyre.receiveShadow = true;
      const rim = new THREE.Mesh(rimGeo, rimMat);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      const leftRotor = new THREE.Mesh(rotorGeo, rotorMat);
      leftRotor.position.x = -WHEELS.width * 0.63;
      const rightRotor = new THREE.Mesh(rotorGeo, rotorMat);
      rightRotor.position.x = WHEELS.width * 0.63;
      wheel.add(tyre, rim, hub, leftRotor, rightRotor);
      wheel.position.set(0, WHEELS.attachY, isFront ? WHEELS.zFront : WHEELS.zRear);
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

function sampleCurve(points: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    if (x > x1) continue;
    const [x0, y0] = points[i - 1]!;
    const t = (x - x0) / Math.max(1e-6, x1 - x0);
    return y0 + (y1 - y0) * t;
  }
  return points[points.length - 1]![1];
}
