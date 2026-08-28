import {
  LAYER_MOVING,
  LAYER_NON_MOVING,
  configureLayers,
  loadJolt,
  type JoltModule,
  type Scratch,
  makeScratch,
} from './jolt';
import { PHYSICS } from '../config';

type BodyID = InstanceType<JoltModule['BodyID']>;

/**
 * emscripten binds static factories on the prototype — this is the canonical
 * call form. The result is an ALIAS into shared WASM scratch (see jolt.ts):
 * consume it in the same expression and never destroy it.
 */
export function identityQuat(Jolt: JoltModule): InstanceType<JoltModule['Quat']> {
  return Jolt.Quat.prototype.sIdentity();
}

/**
 * Owns the JoltInterface / PhysicsSystem and provides thin, allocation-free
 * helpers for creating bodies. One instance per app.
 */
export class PhysicsWorld {
  readonly Jolt: JoltModule;
  readonly jolt: InstanceType<JoltModule['JoltInterface']>;
  readonly physicsSystem: InstanceType<JoltModule['PhysicsSystem']>;
  readonly bodyInterface: InstanceType<JoltModule['BodyInterface']>;
  readonly scratch: Scratch;

  private constructor(Jolt: JoltModule) {
    this.Jolt = Jolt;
    const settings = new Jolt.JoltSettings();
    settings.mMaxWorkerThreads = 3;
    configureLayers(Jolt, settings);
    this.jolt = new Jolt.JoltInterface(settings);
    Jolt.destroy(settings);
    this.physicsSystem = this.jolt.GetPhysicsSystem();
    this.bodyInterface = this.physicsSystem.GetBodyInterface();
    this.scratch = makeScratch(Jolt);
  }

  static async create(): Promise<PhysicsWorld> {
    return new PhysicsWorld(await loadJolt());
  }

  step(dt: number): void {
    this.jolt.Step(dt, PHYSICS.collisionSteps);
  }

  optimizeBroadPhase(): void {
    this.physicsSystem.OptimizeBroadPhase();
  }

  /** Static axis-aligned box (the ground). Top face sits at position.y + halfExtents.y. */
  addStaticBox(
    halfExtents: { x: number; y: number; z: number },
    position: { x: number; y: number; z: number },
    opts: { friction?: number; restitution?: number; rotationQuat?: InstanceType<JoltModule['Quat']> } = {},
  ): BodyID {
    const { Jolt } = this;
    const shapeSettings = new Jolt.BoxShapeSettings(
      new Jolt.Vec3(halfExtents.x, halfExtents.y, halfExtents.z),
      0,
      undefined,
    );
    // NOTE: Create() transfers shape ownership out of the result in this
    // binding — destroying the RESULT trips Reference.h:40. Destroy the
    // shape once consumed instead.
    const shape = shapeSettings.Create().Get();
    const bodySettings = new Jolt.BodyCreationSettings(
      shape,
      new Jolt.RVec3(position.x, position.y, position.z),
      opts.rotationQuat ?? identityQuat(Jolt),
      Jolt.EMotionType_Static,
      LAYER_NON_MOVING,
    );
    const body = this.bodyInterface.CreateBody(bodySettings);
    if (opts.friction !== undefined) body.SetFriction(opts.friction);
    if (opts.restitution !== undefined) body.SetRestitution(opts.restitution);
    this.bodyInterface.AddBody(body.GetID(), Jolt.EActivation_DontActivate);
    // No destroys here — see jolt.ts memory rules: the creation chain belongs
    // to the binding; freeing any of it corrupts the heap (delayed OOB).
    return body.GetID();
  }

  /**
   * Static triangle mesh used for authored venue geometry.  Keeping the real
   * asphalt as one mesh avoids the stair-step launches caused by thousands of
   * yaw-only boxes on an elevated circuit.
   */
  addStaticMesh(
    vertices: readonly number[],
    triangles: readonly number[],
    opts: { friction?: number; restitution?: number } = {},
  ): BodyID {
    const { Jolt } = this;
    const vertexList = new Jolt.VertexList();
    vertexList.reserve(vertices.length / 3);
    for (let i = 0; i < vertices.length; i += 3) {
      vertexList.push_back(new Jolt.Float3(vertices[i]!, vertices[i + 1]!, vertices[i + 2]!));
    }

    const triangleList = new Jolt.IndexedTriangleList();
    triangleList.reserve(triangles.length / 3);
    for (let i = 0; i < triangles.length; i += 3) {
      triangleList.push_back(
        new Jolt.IndexedTriangle(triangles[i]!, triangles[i + 1]!, triangles[i + 2]!, 0),
      );
    }

    const materials = new Jolt.PhysicsMaterialList();
    materials.push_back(new Jolt.PhysicsMaterial());
    const shapeSettings = new Jolt.MeshShapeSettings(vertexList, triangleList, materials);
    shapeSettings.mBuildQuality = Jolt.MeshShapeSettings_EBuildQuality_FavorRuntimePerformance;
    shapeSettings.Sanitize();
    const shape = shapeSettings.Create().Get();
    const bodySettings = new Jolt.BodyCreationSettings(
      shape,
      new Jolt.RVec3(0, 0, 0),
      identityQuat(Jolt),
      Jolt.EMotionType_Static,
      LAYER_NON_MOVING,
    );
    const body = this.bodyInterface.CreateBody(bodySettings);
    if (opts.friction !== undefined) body.SetFriction(opts.friction);
    if (opts.restitution !== undefined) body.SetRestitution(opts.restitution);
    this.bodyInterface.AddBody(body.GetID(), Jolt.EActivation_DontActivate);
    return body.GetID();
  }

  /** Dynamic sphere (smoke-test / props). */
  addDynamicSphere(radius: number, position: { x: number; y: number; z: number }, massKg: number): BodyID {
    const { Jolt } = this;
    const shapeSettings = new Jolt.SphereShapeSettings(radius);
    const shape = shapeSettings.Create().Get(); // ownership transferred out of result
    const bodySettings = new Jolt.BodyCreationSettings(
      shape,
      new Jolt.RVec3(position.x, position.y, position.z),
      identityQuat(Jolt),
      Jolt.EMotionType_Dynamic,
      LAYER_MOVING,
    );
    bodySettings.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
    bodySettings.mMassPropertiesOverride.mMass = massKg;
    const body = this.bodyInterface.CreateBody(bodySettings);
    this.bodyInterface.AddBody(body.GetID(), Jolt.EActivation_Activate);
    // Creation-chain objects stay alive (jolt.ts memory rules).
    return body.GetID();
  }

  /** Continuous dynamic capsule used by the detached rider during a crash. */
  addDynamicCapsule(
    halfHeight: number,
    radius: number,
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number; w: number },
    massKg: number,
    opts: {
      friction?: number;
      restitution?: number;
      linearVelocity?: { x: number; y: number; z: number };
      angularVelocity?: { x: number; y: number; z: number };
    } = {},
  ): BodyID {
    const { Jolt } = this;
    const shapeSettings = new Jolt.CapsuleShapeSettings(halfHeight, radius);
    const shape = shapeSettings.Create().Get();
    const bodySettings = new Jolt.BodyCreationSettings(
      shape,
      new Jolt.RVec3(position.x, position.y, position.z),
      new Jolt.Quat(rotation.x, rotation.y, rotation.z, rotation.w),
      Jolt.EMotionType_Dynamic,
      LAYER_MOVING,
    );
    bodySettings.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
    bodySettings.mMassPropertiesOverride.mMass = massKg;
    bodySettings.mMotionQuality = Jolt.EMotionQuality_LinearCast;
    bodySettings.mAllowSleeping = true;
    bodySettings.mLinearDamping = 0.08;
    bodySettings.mAngularDamping = 0.16;
    const body = this.bodyInterface.CreateBody(bodySettings);
    if (opts.friction !== undefined) body.SetFriction(opts.friction);
    if (opts.restitution !== undefined) body.SetRestitution(opts.restitution);
    const id = body.GetID();
    this.bodyInterface.AddBody(id, Jolt.EActivation_Activate);
    if (opts.linearVelocity) {
      const v = new Jolt.Vec3(opts.linearVelocity.x, opts.linearVelocity.y, opts.linearVelocity.z);
      this.bodyInterface.SetLinearVelocity(id, v);
      Jolt.destroy(v);
    }
    if (opts.angularVelocity) {
      const v = new Jolt.Vec3(opts.angularVelocity.x, opts.angularVelocity.y, opts.angularVelocity.z);
      this.bodyInterface.SetAngularVelocity(id, v);
      Jolt.destroy(v);
    }
    return id;
  }

  destroyBody(id: BodyID): void {
    this.bodyInterface.RemoveBody(id);
    this.bodyInterface.DestroyBody(id);
  }

  dispose(): void {
    this.Jolt.destroy(this.jolt);
  }
}
