const clamp = (value: number, minimum: number, maximum: number) => (
  Math.min(maximum, Math.max(minimum, value))
);
const radians = (degrees: number) => degrees * (Math.PI / 180);

const ONSET_FLOOR = 0.23;
const ONSET_RISE = 0.055;
const ONSET_COOLDOWN_SECONDS = 0.18;
const FIRST_HOP_DELAY_SECONDS = 4.8;
const HOP_INTERVALS_SECONDS = [6.4, 7.8, 7.0] as const;
const HEAD_SPRING_STIFFNESS = 60;
const HEAD_SPRING_DAMPING = 4;

export const MUSIC_HEADBANG_LIMIT = radians(13);
export const MUSIC_BASE_SWAY_LIMIT = radians(8);
export const MUSIC_SHOULDER_LIMIT = radians(11);
export const MUSIC_ELBOW_LIMIT = radians(18);
export const MUSIC_HEAD_YAW_LIMIT = radians(10);

export type MusicMotionState = {
  previousInput: number;
  envelope: number;
  headPitch: number;
  headVelocity: number;
  swayPhase: number;
  beatAccent: number;
  beatSide: -1 | 1;
  lastOnsetAt: number;
  nextHopAt: number;
  hopCount: number;
};

export type MusicMotionSample = {
  headPitch: number;
  headRoll: number;
  headYaw: number;
  baseYaw: number;
  shoulder: number;
  elbow: number;
  envelope: number;
  onset: boolean;
  shouldHop: boolean;
};

export function createMusicMotionState(now = 0): MusicMotionState {
  return {
    previousInput: 0,
    envelope: 0,
    headPitch: 0,
    headVelocity: 0,
    swayPhase: 0,
    beatAccent: 0,
    beatSide: -1,
    lastOnsetAt: -Infinity,
    nextHopAt: now + FIRST_HOP_DELAY_SECONDS,
    hopCount: 0,
  };
}

export function resetMusicMotionState(state: MusicMotionState, now: number) {
  Object.assign(state, createMusicMotionState(now));
}

/**
 * Converts bass energy into coordinated whole-lamp choreography. Each onset
 * compresses the arm and kicks the neck spring, while the sustained envelope
 * drives alternating base sway, arm counter-motion, and camera-facing gaze.
 */
export function sampleMusicMotion(
  state: MusicMotionState,
  input: number,
  playing: boolean,
  now: number,
  dt: number,
): MusicMotionSample {
  const safeDt = clamp(dt, 0, 1 / 24);
  const target = playing ? clamp(input, 0, 1) : 0;
  const rise = target - state.previousInput;
  const onset = playing
    && target >= ONSET_FLOOR
    && rise >= ONSET_RISE
    && now - state.lastOnsetAt >= ONSET_COOLDOWN_SECONDS;
  state.previousInput = target;

  let shouldHop = false;
  if (onset) {
    state.lastOnsetAt = now;
    const impulse = radians(95) * (0.72 + target * 0.78);
    state.headVelocity = Math.min(state.headVelocity + impulse, radians(180));
    state.beatAccent = Math.max(state.beatAccent, 0.48 + target * 0.52);
    state.beatSide = state.beatSide === 1 ? -1 : 1;
    if (target >= 0.42 && now >= state.nextHopAt) {
      shouldHop = true;
      const interval = HOP_INTERVALS_SECONDS[state.hopCount % HOP_INTERVALS_SECONDS.length];
      state.hopCount += 1;
      state.nextHopAt = now + interval;
    }
  }

  const envelopeRate = target > state.envelope ? 11 : 4.2;
  state.envelope += (target - state.envelope) * (1 - Math.exp(-envelopeRate * safeDt));
  const acceleration = -HEAD_SPRING_STIFFNESS * state.headPitch
    - HEAD_SPRING_DAMPING * state.headVelocity;
  state.headVelocity += acceleration * safeDt;
  state.headPitch = clamp(
    state.headPitch + state.headVelocity * safeDt,
    -MUSIC_HEADBANG_LIMIT,
    MUSIC_HEADBANG_LIMIT,
  );
  if (Math.abs(state.headPitch) === MUSIC_HEADBANG_LIMIT) state.headVelocity *= 0.35;

  state.swayPhase += safeDt * (2.8 + state.envelope * 3.4);
  const groove = state.envelope * state.envelope * (3 - 2 * state.envelope);
  const lateral = Math.sin(state.swayPhase);
  const counter = Math.cos(state.swayPhase);
  const doubleTime = Math.sin(state.swayPhase * 2);
  const beatAccent = state.beatAccent;
  const beatSide = state.beatSide;
  state.beatAccent *= Math.exp(-7.2 * safeDt);

  const baseYaw = clamp(
    radians(6.5) * lateral * groove + radians(2.4) * beatSide * beatAccent,
    -MUSIC_BASE_SWAY_LIMIT,
    MUSIC_BASE_SWAY_LIMIT,
  );
  const shoulder = clamp(
    radians(5.2) * doubleTime * groove + radians(6.5) * beatAccent,
    -MUSIC_SHOULDER_LIMIT,
    MUSIC_SHOULDER_LIMIT,
  );
  const elbow = clamp(
    radians(-8.5) * doubleTime * groove
      + radians(3.2) * counter * groove
      - radians(10) * beatAccent,
    -MUSIC_ELBOW_LIMIT,
    MUSIC_ELBOW_LIMIT,
  );
  const headYaw = clamp(
    radians(-5.5) * lateral * groove + radians(4.5) * beatSide * beatAccent,
    -MUSIC_HEAD_YAW_LIMIT,
    MUSIC_HEAD_YAW_LIMIT,
  );
  const headRoll = radians(3.4) * counter * groove
    + radians(2.8) * beatSide * beatAccent;

  return {
    headPitch: state.headPitch,
    headRoll,
    headYaw,
    baseYaw,
    shoulder,
    elbow,
    envelope: state.envelope,
    onset,
    shouldHop,
  };
}
