/**
 * Single source of truth for every tunable in the game.
 * Modules read from here; never hardcode magic numbers elsewhere.
 */

/** Project-wide axis conventions: Y up, bike forward +Z, right +X. */
export const AXIS = {
  /** Residual yaw (radians) applied to the visual bike model wrapper only — never to physics. */
  BIKE_MODEL_YAW_OFFSET: 0,
} as const;

export const PHYSICS = {
  fixedHz: 60,
  maxSubsteps: 5,
  gravityY: -9.81,
  /** Two collision substeps plus linear casting prevent high-speed tunnelling. */
  collisionSteps: 2,
  /** World coordinates must stay within ±2 km (float-precision WASM build). */
  maxWorldCoord: 2000,
} as const;

export const CHASSIS = {
  massKg: 200,
  halfExtents: { x: 0.2, y: 0.32, z: 0.78 },
  comOffset: { x: 0, y: -0.42, z: -0.05 },
  friction: 0.5,
  restitution: 0,
} as const;

export const WHEELS = {
  radius: 0.31,
  width: 0.06,
  attachY: -0.29,
  zFront: 0.75,
  zRear: -0.75,
  suspensionMinLength: 0.22,
  suspensionMaxLength: 0.42,
  suspensionFrequencyHzFront: 3.2,
  suspensionFrequencyHzRear: 3.5,
  suspensionDamping: 0.72,
  inertia: 0.9,
  angularDamping: 0.2,
  casterAngleDeg: 26,
  /** Stable race-bike bias: strong front brake, light rear brake. */
  brakeTorqueFront: 720,
  brakeTorqueRear: 90,
} as const;

export const ENGINE = {
  maxTorque: 168,
  minRpm: 1200,
  maxRpm: 12500,
  /** [normalizedRPM, torqueFraction] — soft bottom end for forgiving launches. */
  normalizedTorqueCurve: [
    [0.09, 0.55],
    [0.35, 0.85],
    [0.6, 1.0],
    [0.82, 1.0],
    [1.0, 0.88],
  ] as ReadonlyArray<readonly [number, number]>,
} as const;

export const TRANSMISSION = {
  /** Six close-ratio road gears; upshifts land near 111/146/184/221/261 km/h. */
  gearRatios: [3.35, 2.55, 2.02, 1.68, 1.42, 1.2],
  shiftUpRpm: 10800,
  shiftDownRpm: 6200,
  /** Additional downshift threshold at full throttle for quicker response. */
  kickdownRpm: 900,
  /** Seamless-box style torque cut and post-shift hysteresis. */
  shiftDurationSec: 0.1,
  shiftLockoutSec: 0.14,
  clutchStrength: 8.0,
} as const;

export const DIFFERENTIAL = {
  ratio: 3.4,
  limitedSlipRatio: 2.5,
  leftWheelIndex: -1,
  rightWheelIndex: 1, // single-track vehicle: both map to the rear wheel
} as const;

export const STEERING = {
  /** Race-bike clip-on lock; Jolt further limits this from speed and lean. */
  maxSteerAngleDeg: 18,
  steerSpeedPerSec: 3.0,
  returnSpeedPerSec: 4.5,
  inputExponent: 1.15,
  /** [km/h, maximum normalized steering input]. */
  speedInputScale: [
    [0, 0.9],
    [20, 0.75],
    [40, 0.62],
    [80, 0.42],
    [140, 0.28],
    [220, 0.18],
    [320, 0.12],
  ] as ReadonlyArray<readonly [number, number]>,
} as const;

export const LEAN = {
  maxLeanAngleDeg: 45,
  springConstant: 5200,
  springDamping: 1100,
  integrationCoefficient: 0,
  integrationCoefficientDecay: 4,
  smoothingFactor: 0.85,
} as const;

export const TYRES = {
  /** [slipX, frictionY] */
  longitudinalCurve: [
    [0, 1.35],
    [0.35, 1.5],
    [1.0, 1.2],
  ] as ReadonlyArray<readonly [number, number]>,
  /** Shared high-grip lateral curve: neither wheel has a scripted slide path. */
  lateralCurve: [
    [0, 1.42],
    [0.45, 1.5],
    [1.0, 1.18],
  ] as ReadonlyArray<readonly [number, number]>,
} as const;

export const SURFACES = {
  asphaltFriction: 1.25,
  grassFriction: 0.55,
  gravelFriction: 0.72,
  kerbFriction: 1.1,
  pavingFriction: 1.05,
  barrierFriction: 0.25,
} as const;

export const AERO = {
  /** F = -k * v * |v|; tuned so terminal ≈ 315 km/h in top gear. */
  dragK: 0.42,
  downforceK: 0.11,
} as const;

export const CAMERA = {
  baseDistance: 4.35,
  distancePerSpeed: 0.026,
  baseHeight: 1.18,
  heightPerSpeed: 0.006,
  lookAheadBase: 4.1,
  lookAheadPerSpeed: 0.09,
  positionSmoothing: 6,
  lookSmoothing: 9,
  fovBaseDeg: 58,
  fovMaxDeg: 70,
  fovAtSpeedMps: 90,
  maxBankDeg: 8,
  riderNear: 0.025,
  /** Helmet anchor measured against the baked cockpit-arm bounds. */
  riderHeight: 0.9,
  riderLongitudinalOffset: -0.22,
  riderLookVerticalOffset: -4.2,
  riderFovBaseDeg: 86,
  /** A restrained speed FOV shift; position never changes with throttle. */
  riderFovMaxDeg: 88,
  riderVibrationM: 0.0012,
} as const;

export const RESPAWN = {
  cooldownSec: 2,
  maxDistanceFromAsphaltM: 4,
  maxBelowRoadM: -0.45,
  maxAboveRoadM: 6,
  upsideDownDotThreshold: 0.3,
  upsideDownTimeSec: 0.75,
  spawnHeightAboveGround: 0.75,
} as const;

export const CRASH = {
  riderMassKg: 70,
  riderCapsuleRadius: 0.2,
  riderCapsuleHalfHeight: 0.43,
  riderFriction: 0.78,
  riderRestitution: 0.12,
} as const;

export const TIMING = {
  checkpointCount: 8,
  bestLapStorageKey: 'motogp.bestlap.v1',
  lapListStorageKey: 'motogp.laps.v1',
} as const;
