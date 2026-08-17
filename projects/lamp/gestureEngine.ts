export type Landmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
};

export type GestureName =
  | "point"
  | "palm_move"
  | "open_palm"
  | "fist"
  | "ok"
  | "peace"
  | "thumbs_up"
  | "thumbs_down"
  | "finger_near_lips"
  | "wave"
  | "camera_cover"
  | "clap"
  | "voice_follow"
  | "voice_stay";

export type LampAction =
  | "point_light"
  | "follow_palm"
  | "freeze"
  | "pause"
  | "confirm"
  | "friendly"
  | "closer"
  | "back"
  | "mute"
  | "wave_back"
  | "sleep"
  | "wake"
  | "lock";

export type GestureObservation = {
  gesture: GestureName;
  confidence: number;
  palm?: Landmark;
  direction?: Landmark;
};

export type GestureMappings = Record<GestureName, LampAction>;

export type BehaviorState =
  | "Idle"
  | "Gesture candidate"
  | "Gesture confirmed"
  | "Performing action";

export type BehaviorUpdate = {
  state: BehaviorState;
  progress: number;
  observation: GestureObservation | null;
  triggeredAction?: LampAction;
};

export const GESTURE_LABELS: Record<GestureName, string> = {
  point: "Point",
  palm_move: "Move palm",
  open_palm: "Open palm / stop",
  fist: "Hold fist",
  ok: "OK sign",
  peace: "Peace sign",
  thumbs_up: "Thumbs up",
  thumbs_down: "Thumbs down",
  finger_near_lips: "Finger near lips",
  wave: "Wave",
  camera_cover: "Cover camera",
  clap: "Clap",
  voice_follow: "“Follow me”",
  voice_stay: "“Stay there”",
};

export const ACTION_LABELS: Record<LampAction, string> = {
  point_light: "Aim light",
  follow_palm: "Follow palm",
  freeze: "Emergency freeze",
  pause: "Pause",
  confirm: "Confirm / nod",
  friendly: "Friendly animation",
  closer: "Move closer",
  back: "Move back",
  mute: "Mute + quiet",
  wave_back: "Wave back",
  sleep: "Sleep + dim",
  wake: "Wake up",
  lock: "Lock position",
};

export const DEFAULT_MAPPINGS: GestureMappings = {
  point: "point_light",
  palm_move: "follow_palm",
  open_palm: "freeze",
  fist: "pause",
  ok: "confirm",
  peace: "friendly",
  thumbs_up: "closer",
  thumbs_down: "back",
  finger_near_lips: "mute",
  wave: "wave_back",
  camera_cover: "sleep",
  clap: "wake",
  voice_follow: "follow_palm",
  voice_stay: "lock",
};

export const JOINT_LIMITS = {
  baseYaw: [-120, 120],
  shoulderPitch: [-20, 95],
  elbowPitch: [10, 135],
  headPitch: [-45, 45],
  headYaw: [-55, 55],
} as const;

const HOLD_TIMES: Record<GestureName, number> = {
  point: 420,
  palm_move: 300,
  open_palm: 110,
  fist: 450,
  ok: 400,
  peace: 420,
  thumbs_up: 760,
  thumbs_down: 620,
  finger_near_lips: 650,
  wave: 260,
  camera_cover: 900,
  clap: 0,
  voice_follow: 0,
  voice_stay: 0,
};

const ACTION_DURATIONS: Record<LampAction, number> = {
  point_light: 1300,
  follow_palm: 1400,
  freeze: 620,
  pause: 900,
  confirm: 900,
  friendly: 1800,
  closer: 1150,
  back: 1150,
  mute: 1200,
  wave_back: 1500,
  sleep: 2200,
  wake: 1800,
  lock: 900,
};

const distance = (a: Landmark, b: Landmark) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const midpoint = (points: Landmark[]): Landmark => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
});

const extended = (hand: Landmark[], tip: number, pip: number, mcp: number) => {
  const wrist = hand[0];
  const palmScale = Math.max(distance(wrist, hand[9]), 0.025);
  const tipReach = distance(wrist, hand[tip]);
  const pipReach = distance(wrist, hand[pip]);
  const straightness = distance(hand[mcp], hand[tip]) / Math.max(distance(hand[mcp], hand[pip]), 0.001);
  return tipReach > pipReach + palmScale * 0.08 && straightness > 1.35;
};

export function palmCenter(hand: Landmark[]): Landmark {
  return midpoint([hand[0], hand[5], hand[9], hand[13], hand[17]]);
}

export function pointingVector(hand: Landmark[]): Landmark {
  const base = hand[5];
  const tip = hand[8];
  const length = Math.max(distance(base, tip), 0.001);
  return {
    x: (tip.x - base.x) / length,
    y: (tip.y - base.y) / length,
    z: (tip.z - base.z) / length,
  };
}

export function classifyHandGesture(
  hand: Landmark[],
  trackingConfidence = 1,
): GestureObservation | null {
  if (hand.length < 21 || trackingConfidence < 0.7) return null;
  const index = extended(hand, 8, 6, 5);
  const middle = extended(hand, 12, 10, 9);
  const ring = extended(hand, 16, 14, 13);
  const pinky = extended(hand, 20, 18, 17);
  const palm = palmCenter(hand);
  const palmWidth = Math.max(distance(hand[5], hand[17]), 0.025);
  const thumbOpen = distance(hand[4], hand[5]) > palmWidth * 0.72;
  const thumbIndexDistance = distance(hand[4], hand[8]) / palmWidth;
  const foldedCount = [index, middle, ring, pinky].filter((value) => !value).length;
  const confidence = Math.min(0.98, trackingConfidence * 0.96);

  if (thumbIndexDistance < 0.3 && middle && ring && pinky) {
    return { gesture: "ok", confidence, palm };
  }
  if (index && middle && !ring && !pinky && distance(hand[8], hand[12]) > palmWidth * 0.42) {
    return { gesture: "peace", confidence, palm };
  }
  if (index && !middle && !ring && !pinky) {
    return {
      gesture: "point",
      confidence,
      palm,
      direction: pointingVector(hand),
    };
  }
  if (foldedCount === 4 && thumbOpen) {
    const vertical = hand[0].y - hand[4].y;
    if (Math.abs(vertical) > palmWidth * 0.55) {
      return {
        gesture: vertical > 0 ? "thumbs_up" : "thumbs_down",
        confidence,
        palm,
      };
    }
  }
  if (index && middle && ring && pinky && thumbOpen) {
    return { gesture: "open_palm", confidence, palm };
  }
  if (foldedCount === 4 && distance(hand[8], palm) < palmWidth * 1.15) {
    return { gesture: "fist", confidence, palm };
  }
  return { gesture: "palm_move", confidence: Math.min(confidence, 0.9), palm };
}

export function isFingerNearLips(hand: Landmark[], face: Landmark[]): boolean {
  if (hand.length < 21 || face.length < 292) return false;
  const mouth = midpoint([face[13], face[14], face[61], face[291]]);
  const faceScale = Math.max(distance(face[33], face[263]), 0.08);
  return distance(hand[8], mouth) / faceScale < 0.33;
}

export type IkSolution = { shoulder: number; elbow: number };

export type CameraTrackingTarget = {
  baseYaw: number;
  shoulder: number;
  elbow: number;
  headPitch: number;
  headYaw: number;
};

export function solveTwoBoneIK(
  vertical: number,
  forward: number,
  upperLength = 0.407,
  lowerLength = 0.464,
): IkSolution {
  const minimum = Math.abs(upperLength - lowerLength) + 0.002;
  const maximum = upperLength + lowerLength - 0.002;
  const rawDistance = Math.hypot(vertical, forward);
  const reach = Math.min(maximum, Math.max(minimum, rawDistance));
  const targetAngle = Math.atan2(forward, vertical);
  const shoulderOffset = Math.acos(
    Math.min(1, Math.max(-1, (reach ** 2 + upperLength ** 2 - lowerLength ** 2) / (2 * reach * upperLength))),
  );
  const innerElbow = Math.acos(
    Math.min(1, Math.max(-1, (upperLength ** 2 + lowerLength ** 2 - reach ** 2) / (2 * upperLength * lowerLength))),
  );
  return {
    shoulder: targetAngle - shoulderOffset,
    elbow: Math.PI - innerElbow,
  };
}

const degrees = (value: number) => value * (Math.PI / 180);
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

/**
 * Maps raw MediaPipe coordinates into the mirrored selfie view used by the UI.
 * The IK target is calibrated around the lamp's authored rest pose, so looking at a
 * centered person keeps the weighted base upright instead of solving toward an
 * unrelated full-extension target.
 */
export function mapCameraTrackingTarget(
  palm: Landmark,
  direction?: Landmark,
): CameraTrackingTarget {
  const mirroredX = 1 - palm.x;
  const lateral = clamp((mirroredX - 0.5) * 2, -1, 1);
  const verticalScreen = clamp((0.5 - palm.y) * 2, -1, 1);
  const depth = clamp(-palm.z * 4, -0.7, 0.7);

  const rest = solveTwoBoneIK(0.637, 0.105);
  const target = solveTwoBoneIK(
    0.637 + verticalScreen * 0.075 - depth * 0.03,
    0.105 + depth * 0.11 + Math.abs(lateral) * 0.025,
  );

  const mirroredPointX = direction ? -direction.x : 0;
  // MediaPipe's Y axis increases downward. The lamp's positive head pitch also
  // looks downward, so the raw pointing direction already has the right sign.
  const pointY = direction ? direction.y : 0;
  return {
    baseYaw: clamp(lateral * degrees(28), -degrees(32), degrees(32)),
    shoulder: clamp(target.shoulder - rest.shoulder, -degrees(18), degrees(22)),
    elbow: clamp(target.elbow - rest.elbow, -degrees(26), degrees(24)),
    headPitch: clamp(verticalScreen * degrees(18) + pointY * degrees(13), -degrees(38), degrees(38)),
    headYaw: clamp(lateral * degrees(24) + mirroredPointX * degrees(14), -degrees(42), degrees(42)),
  };
}

export class WaveDetector {
  private samples: Array<{ x: number; at: number }> = [];
  private lastWave = -Infinity;

  update(wristX: number, at: number) {
    this.samples.push({ x: wristX, at });
    this.samples = this.samples.filter((sample) => at - sample.at <= 850);
    if (at - this.lastWave < 1200 || this.samples.length < 7) return false;
    let reversals = 0;
    let previousDirection = 0;
    for (let index = 1; index < this.samples.length; index += 1) {
      const delta = this.samples[index].x - this.samples[index - 1].x;
      const direction = Math.abs(delta) > 0.012 ? Math.sign(delta) : previousDirection;
      if (previousDirection && direction && direction !== previousDirection) reversals += 1;
      previousDirection = direction;
    }
    const xs = this.samples.map((sample) => sample.x);
    if (reversals >= 2 && Math.max(...xs) - Math.min(...xs) > 0.18) {
      this.lastWave = at;
      this.samples = [];
      return true;
    }
    return false;
  }

  reset() {
    this.samples = [];
  }
}

export class GestureStateMachine {
  state: BehaviorState = "Idle";
  private candidate: GestureName | null = null;
  private candidateStarted = 0;
  private confirmedGesture: GestureName | null = null;
  private performingUntil = 0;

  update(
    observation: GestureObservation | null,
    now: number,
    mappings: GestureMappings,
    reactionScale = 1,
  ): BehaviorUpdate {
    if (this.state === "Performing action" && now >= this.performingUntil) {
      this.state = "Idle";
    }
    if (!observation || observation.confidence < 0.85) {
      this.candidate = null;
      this.confirmedGesture = null;
      if (this.state !== "Performing action") this.state = "Idle";
      return { state: this.state, progress: 0, observation };
    }
    if (observation.gesture !== this.candidate) {
      this.candidate = observation.gesture;
      this.candidateStarted = now;
      this.confirmedGesture = null;
      this.state = "Gesture candidate";
    }
    const hold = HOLD_TIMES[observation.gesture] * Math.max(0.55, reactionScale);
    const progress = hold === 0 ? 1 : Math.min(1, (now - this.candidateStarted) / hold);
    if (progress < 1) {
      return { state: this.state, progress, observation };
    }
    if (this.confirmedGesture === observation.gesture) {
      return { state: this.state, progress: 1, observation };
    }
    this.confirmedGesture = observation.gesture;
    this.state = "Gesture confirmed";
    const action = mappings[observation.gesture];
    this.state = "Performing action";
    this.performingUntil = now + ACTION_DURATIONS[action];
    return {
      state: this.state,
      progress: 1,
      observation,
      triggeredAction: action,
    };
  }

  force(gesture: GestureName, now: number, mappings: GestureMappings): BehaviorUpdate {
    const observation = { gesture, confidence: 1 } satisfies GestureObservation;
    this.candidate = gesture;
    this.confirmedGesture = gesture;
    this.state = "Performing action";
    const action = mappings[gesture];
    this.performingUntil = now + ACTION_DURATIONS[action];
    return { state: this.state, progress: 1, observation, triggeredAction: action };
  }

  reset() {
    this.state = "Idle";
    this.candidate = null;
    this.confirmedGesture = null;
    this.performingUntil = 0;
  }
}
