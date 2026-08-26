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
  collisionSteps: 1,
  /** World coordinates must stay within ±2 km (float-precision WASM build). */
  maxWorldCoord: 2000,
} as const;

export const CHASSIS = {
  massKg: 200,
  halfExtents: { x: 0.2, y: 0.32, z: 0.78 },
  comOffset: { x: 0, y: -0.32, z: 0 },
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
  suspensionFrequencyHzFront: 2.2,
  suspensionFrequencyHzRear: 2.8,
  suspensionDamping: 0.5,
  inertia: 0.9,
  angularDamping: 0.2,
  casterAngleDeg: 26,
  brakeTorqueFront: 900,
  brakeTorqueRear: 250,
  handBrakeTorque: 600,
} as const;

export const ENGINE = {
  maxTorque: 210,
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
  gearRatios: [2.35, 1.9, 1.58, 1.33, 1.16, 1.04, 0.95],
  reverseGearRatios: [-2.8],
  shiftUpRpm: 11500,
  shiftDownRpm: 6500,
  clutchStrength: 3.0,
  modeAuto: 0, // ETransmissionMode_Auto
} as const;

export const DIFFERENTIAL = {
  ratio: 3.2,
  limitedSlipRatio: 2.5,
  leftWheelIndex: -1,
  rightWheelIndex: 1, // single-track vehicle: both map to the rear wheel
} as const;

export const STEERING = {
  maxSteerAngleDeg: 24,
  steerSpeedPerSec: 3.2,
  returnSpeedPerSec: 4.5,
} as const;

export const LEAN = {
  maxLeanAngleDeg: 52,
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
  lateralCurve: [
    [0, 1.6],
    [0.55, 1.65],
    [1.0, 1.3],
  ] as ReadonlyArray<readonly [number, number]>,
} as const;

export const SURFACES = {
  asphaltFriction: 1.25,
  grassFriction: 0.55,
  kerbFriction: 1.1,
  barrierFriction: 0.25,
} as const;

export const AERO = {
  /** F = -k * v * |v|; tuned so terminal ≈ 315 km/h in top gear. */
  dragK: 0.42,
  downforceK: 0.06,
} as const;

export const CAMERA = {
  baseDistance: 6.5,
  distancePerSpeed: 0.05,
  baseHeight: 2.2,
  heightPerSpeed: 0.01,
  lookAheadBase: 6,
  lookAheadPerSpeed: 0.15,
  positionSmoothing: 6,
  lookSmoothing: 9,
  fovBaseDeg: 62,
  fovMaxDeg: 74,
  fovAtSpeedMps: 90,
  maxBankDeg: 8,
} as const;

export const RESPAWN = {
  cooldownSec: 1,
  offTrackLateralMargin: 3,
  minY: -5,
  upsideDownDotThreshold: 0.15,
  upsideDownTimeSec: 2,
  spawnHeightAboveGround: 0.75,
} as const;

export const TIMING = {
  checkpointCount: 8,
  bestLapStorageKey: 'motogp.bestlap.v1',
  lapListStorageKey: 'motogp.laps.v1',
} as const;
