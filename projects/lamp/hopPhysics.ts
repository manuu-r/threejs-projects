export const HOP_GRAVITY = 4.8;
export const HOP_HEIGHT = 0.095;
export const HOP_STEP = 0.26;
export const HOP_PRELOAD_SECONDS = 0.22;
export const HOP_RECOVERY_SECONDS = 0.32;
export const HOP_REBOUND_HEIGHT = 0.018;
export const HOP_TAKEOFF_SPEED = Math.sqrt(2 * HOP_GRAVITY * HOP_HEIGHT);
export const HOP_DURATION_SECONDS = (2 * HOP_TAKEOFF_SPEED) / HOP_GRAVITY;

export type BallisticHop = {
  fromZ: number;
  toZ: number;
  startedAt: number;
};

export type BallisticHopSample = {
  z: number;
  lift: number;
  verticalVelocity: number;
  progress: number;
  preloadProgress: number;
  recoveryProgress: number;
  phase: "preload" | "airborne" | "recovery" | "landed";
  landed: boolean;
};

export type HopArmMomentum = {
  shoulder: number;
  elbow: number;
  headPitch: number;
  headRoll: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const LANDING_EPSILON_SECONDS = 1e-9;

/** Returns one short step toward the requested travel target. */
export function nextHopDestination(fromZ: number, targetZ: number): number {
  const remaining = targetZ - fromZ;
  return fromZ + Math.sign(remaining) * Math.min(Math.abs(remaining), HOP_STEP);
}

/**
 * Samples a projectile with constant horizontal speed and vertical acceleration -g.
 * The lamp lands at exactly the authored floor height after one symmetric arc.
 */
export function sampleBallisticHop(hop: BallisticHop, now: number): BallisticHopSample {
  const motionTime = Math.max(0, now - hop.startedAt);
  const preloadProgress = clamp01(motionTime / HOP_PRELOAD_SECONDS);
  const touchdownTime = HOP_PRELOAD_SECONDS + HOP_DURATION_SECONDS;
  const settledTime = touchdownTime + HOP_RECOVERY_SECONDS;
  const isAirborne = motionTime >= HOP_PRELOAD_SECONDS - LANDING_EPSILON_SECONDS
    && motionTime < touchdownTime - LANDING_EPSILON_SECONDS;
  const isRecovering = motionTime >= touchdownTime - LANDING_EPSILON_SECONDS
    && motionTime < settledTime - LANDING_EPSILON_SECONDS;
  const flightTime = Math.max(0, motionTime - HOP_PRELOAD_SECONDS);
  const clampedTime = Math.min(flightTime, HOP_DURATION_SECONDS);
  const progress = motionTime >= HOP_PRELOAD_SECONDS
    ? clamp01(clampedTime / HOP_DURATION_SECONDS)
    : 0;
  const recoveryProgress = motionTime >= touchdownTime
    ? clamp01((motionTime - touchdownTime) / HOP_RECOVERY_SECONDS)
    : 0;
  const landed = motionTime >= settledTime - LANDING_EPSILON_SECONDS;
  const lift = isAirborne
    ? Math.max(
        0,
        HOP_TAKEOFF_SPEED * clampedTime
          - 0.5 * HOP_GRAVITY * clampedTime * clampedTime,
      )
    : isRecovering
      ? HOP_REBOUND_HEIGHT
        * Math.sin(recoveryProgress * Math.PI)
        * (1 - recoveryProgress)
      : 0;

  return {
    z: hop.fromZ + (hop.toZ - hop.fromZ) * progress,
    lift,
    verticalVelocity: isAirborne
      ? HOP_TAKEOFF_SPEED - HOP_GRAVITY * clampedTime
      : 0,
    progress,
    preloadProgress,
    recoveryProgress,
    phase: landed
      ? "landed"
      : isRecovering
        ? "recovery"
        : isAirborne
          ? "airborne"
          : "preload",
    landed,
  };
}

/**
 * Uses the complete articulated arm as a reaction mass: it winds up opposite
 * travel, snaps through on takeoff, then counter-swings before landing.
 */
export function sampleHopArmMomentum(
  hop: BallisticHop,
  sample: BallisticHopSample,
): HopArmMomentum {
  const direction = Math.sign(hop.toZ - hop.fromZ) || 1;
  const radians = Math.PI / 180;

  if (sample.phase === "landed") {
    return { shoulder: 0, elbow: 0, headPitch: 0, headRoll: 0 };
  }

  if (sample.phase === "preload") {
    const compression = Math.sin(sample.preloadProgress * Math.PI / 2) ** 1.25;
    return {
      shoulder: -direction * 18 * radians * compression,
      elbow: direction * 28 * radians * compression,
      headPitch: direction * 9 * radians * compression,
      headRoll: -direction * 3.5 * radians * compression,
    };
  }

  if (sample.phase === "recovery") {
    const decay = (1 - sample.recoveryProgress) ** 2;
    const spring = decay * Math.cos(sample.recoveryProgress * Math.PI * 2.5);
    return {
      shoulder: -direction * 20 * radians * spring,
      elbow: direction * 30 * radians * spring,
      headPitch: direction * 10 * radians * spring,
      headRoll: -direction * 4 * radians * spring,
    };
  }

  const verticalMomentum = sample.verticalVelocity / HOP_TAKEOFF_SPEED;
  const flightEnvelope = Math.sin(sample.progress * Math.PI);
  const release = Math.exp(-sample.progress * 5);
  const shoulder = direction * radians * (20 * verticalMomentum + 7 * release);
  return {
    shoulder,
    elbow: direction * radians * (
      10 * verticalMomentum
      + 8 * release
      - 30 * flightEnvelope
    ),
    headPitch: -shoulder * 0.72 + direction * 6 * radians * flightEnvelope,
    headRoll: direction * 4 * radians * flightEnvelope,
  };
}
