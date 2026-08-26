/**
 * jolt-physics loading, layer tables and memory-management helpers.
 *
 * MEMORY RULES (the WASM heap is manual):
 *  - Never `new Jolt.Vec3()` (or RVec3/Quat/Mat44) inside the frame loop — use the
 *    scratch pool from makeScratch() instead.
 *  - Prefer out-param APIs (GetPositionAndRotation etc.); when an allocating getter
 *    is unavoidable, Jolt.destroy() the result immediately after copying out.
 *  - CREATION CHAINS ARE THE BINDING'S PROBLEM, NOT OURS: after
 *    CreateBody/AddBody (or AddConstraint), do NOT destroy the *Settings,
 *    *Result, Shape or tester objects you built for it. Destroying them causes
 *    DELAYED heap corruption (OOB crashes dozens of calls later — release build
 *    gives no hint; debug build asserts Reference.h:40 immediately). Verified
 *    empirically: zero-destroy setup runs 1282 static bodies + vehicle sim
 *    clean; any destroy in the chain crashes within ~2–20 allocations.
 *    Setup-time object counts are bounded, so treat them as owned by Jolt.
 *  - DO destroy per-frame allocating getters (GetLinearVelocity …) right after
 *    copying values out — those leak real memory every step otherwise.
 *  - STATIC FACTORIES ARE ALIASES: `Quat.prototype.sIdentity()`, `sRotation()`,
 *    `Mat44.prototype.s*()` … all return wrappers over ONE shared WASM temp slot
 *    per type. Every call clobbers every result previously returned by ANY static
 *    factory of that type, and Jolt.destroy()ing one corrupts the heap (verified:
 *    aliased .ptr across calls). Consume within the same expression as the ctor /
 *    call that copies it — never store, never destroy. For a lasting rotation use
 *    `new Jolt.Quat(...)` (a real allocation) or mutate one with quat.Set(x,y,z,w).
 *  - Never destroy objects returned by accessors into other Jolt objects
 *    (GetEngine(), GetWheel(i), GetConstraint(), ...).
 *  - emscripten arrays (mWheels, mDifferentials, mGearRatios): use clear()/push_back(),
 *    never assign JS arrays.
 *  - Positions are RVec3; directions are Vec3. Mixing throws at runtime, not compile time.
 */

/**
 * The default export is an async factory: `declare function Jolt<T>(target?: T):
 * Promise<T & typeof Jolt>` whose resolved value carries every class constructor
 * as a namespace member (`Jolt.Vec3`, ...). Keep one instance for the app.
 */
import initJolt from 'jolt-physics';

export type JoltModule = Awaited<ReturnType<typeof initJolt>>;

let cachedJolt: JoltModule | null = null;

/** Load and initialize the wasm-compat build (WASM inlined — no asset serving). */
export async function loadJolt(): Promise<JoltModule> {
  if (!cachedJolt) cachedJolt = await initJolt();
  return cachedJolt;
}

export const LAYER_NON_MOVING = 0;
export const LAYER_MOVING = 1;
export const NUM_OBJECT_LAYERS = 2;
export const BP_LAYER_NON_MOVING = 0;
export const BP_LAYER_MOVING = 1;
export const NUM_BROAD_PHASE_LAYERS = 2;

/**
 * Configure collision layers on fresh JoltSettings:
 * moving collides with everything; non-moving only receives collisions.
 * All three filter/interface objects are required by PhysicsSystem::Init.
 */
export function configureLayers(Jolt: JoltModule, settings: InstanceType<JoltModule['JoltSettings']>): void {
  const objectFilter = new Jolt.ObjectLayerPairFilterTable(NUM_OBJECT_LAYERS);
  objectFilter.EnableCollision(LAYER_MOVING, LAYER_NON_MOVING);
  objectFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING);

  const bpInterface = new Jolt.BroadPhaseLayerInterfaceTable(NUM_OBJECT_LAYERS, NUM_BROAD_PHASE_LAYERS);
  bpInterface.MapObjectToBroadPhaseLayer(
    LAYER_NON_MOVING,
    new Jolt.BroadPhaseLayer(BP_LAYER_NON_MOVING),
  );
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, new Jolt.BroadPhaseLayer(BP_LAYER_MOVING));

  const objVsBpFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(
    bpInterface,
    NUM_BROAD_PHASE_LAYERS,
    objectFilter,
    NUM_OBJECT_LAYERS,
  );

  settings.mObjectLayerPairFilter = objectFilter;
  settings.mBroadPhaseLayerInterface = bpInterface;
  settings.mObjectVsBroadPhaseLayerFilter = objVsBpFilter;
}

export interface Scratch {
  vec3: InstanceType<JoltModule['Vec3']>;
  rvec3: InstanceType<JoltModule['RVec3']>;
  quat: InstanceType<JoltModule['Quat']>;
  /** Second reusable Vec3 for call sites that need two directions at once. */
  vec3b: InstanceType<JoltModule['Vec3']>;
}

/** Preallocated per-frame read/write targets — allocate once, reuse forever. */
export function makeScratch(Jolt: JoltModule): Scratch {
  return {
    vec3: new Jolt.Vec3(0, 0, 0),
    vec3b: new Jolt.Vec3(0, 0, 0),
    rvec3: new Jolt.RVec3(0, 0, 0),
    quat: new Jolt.Quat(0, 0, 0, 1),
  };
}

/** Yaw-only quaternion about +Y written into an owned quat (no static-factory alias). */
export function setYawQuat(
  q: InstanceType<JoltModule['Quat']>,
  yawRad: number,
): InstanceType<JoltModule['Quat']> {
  q.Set(0, Math.sin(yawRad / 2), 0, Math.cos(yawRad / 2));
  return q;
}
