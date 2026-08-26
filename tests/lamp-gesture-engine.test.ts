import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MAPPINGS,
  GestureStateMachine,
  classifyHandGesture,
  isFingerNearLips,
  mapCameraTrackingTarget,
  palmMovementSpeed,
  pointingVector,
  solveTwoBoneIK,
  type Landmark,
} from "../projects/lamp/gestureEngine.ts";
import {
  HOP_DURATION_SECONDS,
  HOP_HEIGHT,
  HOP_PRELOAD_SECONDS,
  HOP_RECOVERY_SECONDS,
  HOP_REBOUND_HEIGHT,
  HOP_STEP,
  nextHopDestination,
  sampleBallisticHop,
  sampleHopArmMomentum,
} from "../projects/lamp/hopPhysics.ts";
import { cameraFacingHeadYaw, yawToFace } from "../projects/lamp/orientation.ts";
import {
  MUSIC_BASE_SWAY_LIMIT,
  MUSIC_ELBOW_LIMIT,
  MUSIC_HEADBANG_LIMIT,
  MUSIC_HEAD_YAW_LIMIT,
  MUSIC_SHOULDER_LIMIT,
  createMusicMotionState,
  resetMusicMotionState,
  sampleMusicMotion,
} from "../projects/lamp/musicMotion.ts";

type FingerName = "index" | "middle" | "ring" | "pinky";
type ThumbPose = "open" | "closed" | "up" | "down";

const fingerJoints: Record<FingerName, [number, number, number, number]> = {
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

const fingerGeometry: Record<FingerName, {
  mcp: Landmark;
  extended: [Landmark, Landmark, Landmark];
  folded: [Landmark, Landmark, Landmark];
}> = {
  index: {
    mcp: { x: 0.42, y: 0.64, z: 0 },
    extended: [
      { x: 0.41, y: 0.49, z: 0 },
      { x: 0.4, y: 0.38, z: 0 },
      { x: 0.39, y: 0.26, z: 0 },
    ],
    folded: [
      { x: 0.42, y: 0.56, z: 0 },
      { x: 0.435, y: 0.62, z: 0 },
      { x: 0.445, y: 0.68, z: 0 },
    ],
  },
  middle: {
    mcp: { x: 0.48, y: 0.62, z: 0 },
    extended: [
      { x: 0.49, y: 0.46, z: 0 },
      { x: 0.5, y: 0.34, z: 0 },
      { x: 0.51, y: 0.2, z: 0 },
    ],
    folded: [
      { x: 0.48, y: 0.54, z: 0 },
      { x: 0.495, y: 0.61, z: 0 },
      { x: 0.505, y: 0.68, z: 0 },
    ],
  },
  ring: {
    mcp: { x: 0.54, y: 0.64, z: 0 },
    extended: [
      { x: 0.55, y: 0.49, z: 0 },
      { x: 0.555, y: 0.39, z: 0 },
      { x: 0.56, y: 0.28, z: 0 },
    ],
    folded: [
      { x: 0.54, y: 0.56, z: 0 },
      { x: 0.555, y: 0.62, z: 0 },
      { x: 0.565, y: 0.69, z: 0 },
    ],
  },
  pinky: {
    mcp: { x: 0.6, y: 0.68, z: 0 },
    extended: [
      { x: 0.61, y: 0.54, z: 0 },
      { x: 0.625, y: 0.44, z: 0 },
      { x: 0.64, y: 0.34, z: 0 },
    ],
    folded: [
      { x: 0.6, y: 0.6, z: 0 },
      { x: 0.615, y: 0.65, z: 0 },
      { x: 0.625, y: 0.71, z: 0 },
    ],
  },
};

function makeHand(extendedFingers: FingerName[], thumbPose: ThumbPose = "open") {
  const hand = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.7, z: 0 }));
  hand[0] = { x: 0.5, y: 0.82, z: 0 };
  hand[1] = { x: 0.45, y: 0.75, z: 0 };
  hand[2] = { x: 0.4, y: 0.7, z: 0 };
  hand[3] = { x: 0.35, y: 0.64, z: 0 };
  hand[4] = {
    open: { x: 0.27, y: 0.58, z: 0 },
    closed: { x: 0.45, y: 0.66, z: 0 },
    up: { x: 0.4, y: 0.38, z: 0 },
    down: { x: 0.42, y: 0.98, z: 0 },
  }[thumbPose];

  const extendedSet = new Set(extendedFingers);
  for (const finger of Object.keys(fingerJoints) as FingerName[]) {
    const [mcp, pip, dip, tip] = fingerJoints[finger];
    const geometry = fingerGeometry[finger];
    hand[mcp] = geometry.mcp;
    [hand[pip], hand[dip], hand[tip]] = extendedSet.has(finger)
      ? geometry.extended
      : geometry.folded;
  }
  return hand;
}

test("classifies the supported static gestures from 21 hand landmarks", () => {
  const cases: Array<[string, Landmark[], string]> = [
    ["point", makeHand(["index"], "closed"), "point"],
    ["peace", makeHand(["index", "middle"], "closed"), "peace"],
    ["open palm", makeHand(["index", "middle", "ring", "pinky"], "open"), "open_palm"],
    ["fist", makeHand([], "closed"), "fist"],
    ["thumbs up", makeHand([], "up"), "thumbs_up"],
    ["thumbs down", makeHand([], "down"), "thumbs_down"],
    ["ambiguous movement", makeHand(["index", "middle", "ring"], "closed"), "palm_move"],
  ];

  for (const [label, hand, expected] of cases) {
    const observation = classifyHandGesture(hand, 0.96);
    assert.equal(observation?.gesture, expected, label);
    assert.ok((observation?.confidence ?? 0) >= 0.85, label);
    assert.ok(observation?.palm, label);
  }
  assert.equal(classifyHandGesture(makeHand(["index"]), 0.65), null);
});

test("derives a normalized pointing vector from index base to fingertip", () => {
  const direction = pointingVector(makeHand(["index"], "closed"));
  assert.ok(direction.y < -0.95);
  assert.ok(Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 1e-12);
});

test("measures deliberate palm movement independently of frame rate", () => {
  const previous = { x: 0.42, y: 0.55, z: -0.1 };
  const current = { x: 0.47, y: 0.55, z: -0.1 };
  assert.ok(Math.abs(palmMovementSpeed(previous, current, 100) - 0.5) < 1e-12);
  assert.ok(palmMovementSpeed(previous, { x: 0.421, y: 0.55, z: -0.1 }, 100) < 0.02);
});

test("recognizes a fingertip near the lips using hand and face scale", () => {
  const hand = makeHand(["index"], "closed");
  const face = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  face[13] = { x: 0.5, y: 0.5, z: 0 };
  face[14] = { x: 0.5, y: 0.52, z: 0 };
  face[61] = { x: 0.46, y: 0.51, z: 0 };
  face[291] = { x: 0.54, y: 0.51, z: 0 };
  face[33] = { x: 0.35, y: 0.4, z: 0 };
  face[263] = { x: 0.65, y: 0.4, z: 0 };
  hand[8] = { x: 0.5, y: 0.54, z: 0 };
  assert.equal(isFingerNearLips(hand, face), true);
  hand[8] = { x: 0.85, y: 0.85, z: 0 };
  assert.equal(isFingerNearLips(hand, face), false);
});

test("requires a sustained high-confidence gesture before acting", () => {
  const machine = new GestureStateMachine();
  const observation = { gesture: "peace" as const, confidence: 0.94 };

  const candidate = machine.update(observation, 1_000, DEFAULT_MAPPINGS);
  assert.equal(candidate.state, "Gesture candidate");
  assert.equal(candidate.triggeredAction, undefined);

  const stillHolding = machine.update(observation, 1_300, DEFAULT_MAPPINGS);
  assert.ok(stillHolding.progress > 0.7 && stillHolding.progress < 1);
  assert.equal(stillHolding.triggeredAction, undefined);

  const confirmed = machine.update(observation, 1_430, DEFAULT_MAPPINGS);
  assert.equal(confirmed.state, "Performing action");
  assert.equal(confirmed.triggeredAction, "friendly");

  const debounced = machine.update(observation, 1_600, DEFAULT_MAPPINGS);
  assert.equal(debounced.triggeredAction, undefined);
});

test("emergency stop confirms far faster than friendly gestures", () => {
  const machine = new GestureStateMachine();
  const stop = { gesture: "open_palm" as const, confidence: 0.98 };
  machine.update(stop, 0, DEFAULT_MAPPINGS);
  const result = machine.update(stop, 115, DEFAULT_MAPPINGS);
  assert.equal(result.triggeredAction, "freeze");
});

test("low-confidence observations cannot trigger an action", () => {
  const machine = new GestureStateMachine();
  const weak = { gesture: "thumbs_up" as const, confidence: 0.7 };
  machine.update(weak, 0, DEFAULT_MAPPINGS);
  const result = machine.update(weak, 2_000, DEFAULT_MAPPINGS);
  assert.equal(result.state, "Idle");
  assert.equal(result.triggeredAction, undefined);
});

test("two-bone IK stays finite for unreachable targets", () => {
  for (const [vertical, forward] of [[0, 0], [9, 7], [-4, 3], [0.35, 0.2]]) {
    const solution = solveTwoBoneIK(vertical, forward);
    assert.ok(Number.isFinite(solution.shoulder));
    assert.ok(Number.isFinite(solution.elbow));
    assert.ok(solution.elbow >= 0 && solution.elbow <= Math.PI);
  }
});

test("camera mapping mirrors lateral motion and preserves an upright arm envelope", () => {
  const centered = mapCameraTrackingTarget({ x: 0.5, y: 0.5, z: -0.1 });
  const cameraLeft = mapCameraTrackingTarget({ x: 0.2, y: 0.5, z: -0.2 });
  const cameraRight = mapCameraTrackingTarget({ x: 0.8, y: 0.5, z: -0.2 });

  assert.ok(Math.abs(centered.shoulder) < Math.PI / 12);
  assert.ok(Math.abs(centered.elbow) < Math.PI / 12);
  assert.ok(cameraLeft.baseYaw > 0);
  assert.ok(cameraRight.baseYaw < 0);
  assert.ok(Math.abs(cameraLeft.baseYaw + cameraRight.baseYaw) < 1e-9);
  assert.ok(Math.abs(cameraLeft.shoulder) <= 38 * Math.PI / 180);
  assert.ok(Math.abs(cameraLeft.elbow) <= 38 * Math.PI / 180);
  assert.ok(Math.abs(cameraLeft.baseYaw) > 30 * Math.PI / 180);
});

test("camera mapping uses a broad but bounded vertical and depth range", () => {
  const high = mapCameraTrackingTarget({ x: 0.5, y: 0.05, z: -0.1 });
  const low = mapCameraTrackingTarget({ x: 0.5, y: 0.95, z: -0.1 });
  const near = mapCameraTrackingTarget({ x: 0.5, y: 0.5, z: -0.18 });
  const far = mapCameraTrackingTarget({ x: 0.5, y: 0.5, z: 0.18 });

  assert.ok(high.headPitch < -25 * Math.PI / 180);
  assert.ok(low.headPitch > 25 * Math.PI / 180);
  assert.ok(Math.abs(high.shoulder - low.shoulder) > 20 * Math.PI / 180);
  assert.ok(Math.abs(near.shoulder - far.shoulder) > 20 * Math.PI / 180);
  for (const sample of [high, low, near, far]) {
    assert.ok(Math.abs(sample.headPitch) <= 52 * Math.PI / 180);
    assert.ok(Math.abs(sample.shoulder) <= 38 * Math.PI / 180);
    assert.ok(Math.abs(sample.elbow) <= 38 * Math.PI / 180);
  }
});

test("point direction is mirrored into the lamp's camera-facing head turn", () => {
  const rightwardInRawCamera = mapCameraTrackingTarget(
    { x: 0.5, y: 0.5, z: -0.1 },
    { x: 1, y: 0, z: 0 },
  );
  const leftwardInRawCamera = mapCameraTrackingTarget(
    { x: 0.5, y: 0.5, z: -0.1 },
    { x: -1, y: 0, z: 0 },
  );
  assert.ok(rightwardInRawCamera.headYaw < 0);
  assert.ok(leftwardInRawCamera.headYaw > 0);
});

test("pointing up looks up and pointing down looks down", () => {
  const pointingUp = mapCameraTrackingTarget(
    { x: 0.5, y: 0.5, z: -0.1 },
    { x: 0, y: -1, z: 0 },
  );
  const pointingDown = mapCameraTrackingTarget(
    { x: 0.5, y: 0.5, z: -0.1 },
    { x: 0, y: 1, z: 0 },
  );

  assert.ok(pointingUp.headPitch < 0);
  assert.ok(pointingDown.headPitch > 0);
});

test("ballistic travel reaches the authored apex and lands exactly on the floor", () => {
  const hop = { fromZ: 0, toZ: HOP_STEP, startedAt: 10 };
  const takeoff = sampleBallisticHop(hop, 10);
  const preload = sampleBallisticHop(hop, 10 + HOP_PRELOAD_SECONDS / 2);
  const apex = sampleBallisticHop(
    hop,
    10 + HOP_PRELOAD_SECONDS + HOP_DURATION_SECONDS / 2,
  );
  const touchdown = sampleBallisticHop(
    hop,
    10 + HOP_PRELOAD_SECONDS + HOP_DURATION_SECONDS,
  );
  const rebound = sampleBallisticHop(
    hop,
    10 + HOP_PRELOAD_SECONDS + HOP_DURATION_SECONDS + HOP_RECOVERY_SECONDS / 2,
  );
  const landing = sampleBallisticHop(
    hop,
    10 + HOP_PRELOAD_SECONDS + HOP_DURATION_SECONDS + HOP_RECOVERY_SECONDS,
  );

  assert.equal(takeoff.z, 0);
  assert.equal(takeoff.lift, 0);
  assert.equal(preload.phase, "preload");
  assert.equal(preload.z, 0);
  assert.equal(preload.lift, 0);
  assert.ok(Math.abs(apex.z - HOP_STEP / 2) < 1e-12);
  assert.ok(Math.abs(apex.lift - HOP_HEIGHT) < 1e-12);
  assert.ok(Math.abs(apex.verticalVelocity) < 1e-12);
  assert.equal(touchdown.phase, "recovery");
  assert.equal(touchdown.landed, false);
  assert.ok(Math.abs(touchdown.z - HOP_STEP) < 1e-12);
  assert.ok(rebound.lift > 0 && rebound.lift < HOP_REBOUND_HEIGHT);
  assert.ok(Math.abs(landing.z - HOP_STEP) < 1e-12);
  assert.equal(landing.lift, 0);
  assert.equal(landing.landed, true);
});

test("the whole arm winds up and counter-swings to create hop momentum", () => {
  const hop = { fromZ: 0, toZ: HOP_STEP, startedAt: 20 };
  const preloadSample = sampleBallisticHop(hop, 20 + HOP_PRELOAD_SECONDS * 0.9);
  const takeoffSample = sampleBallisticHop(hop, 20 + HOP_PRELOAD_SECONDS);
  const descentSample = sampleBallisticHop(
    hop,
    20 + HOP_PRELOAD_SECONDS + HOP_DURATION_SECONDS * 0.8,
  );
  const recoverySample = sampleBallisticHop(
    hop,
    20 + HOP_PRELOAD_SECONDS + HOP_DURATION_SECONDS + HOP_RECOVERY_SECONDS * 0.25,
  );
  const landingSample = sampleBallisticHop(
    hop,
    20 + HOP_PRELOAD_SECONDS + HOP_DURATION_SECONDS + HOP_RECOVERY_SECONDS,
  );
  const preload = sampleHopArmMomentum(hop, preloadSample);
  const takeoff = sampleHopArmMomentum(hop, takeoffSample);
  const descent = sampleHopArmMomentum(hop, descentSample);
  const recovery = sampleHopArmMomentum(hop, recoverySample);
  const landing = sampleHopArmMomentum(hop, landingSample);

  assert.ok(preload.shoulder < 0);
  assert.ok(preload.elbow > 0);
  assert.ok(takeoff.shoulder > 0);
  assert.ok(takeoff.elbow > 0);
  assert.ok(takeoff.headPitch < 0);
  assert.ok(descent.shoulder < 0);
  assert.ok(Math.abs(descent.elbow) > 0.05);
  assert.ok(Math.abs(preload.shoulder) > 12 * Math.PI / 180);
  assert.ok(Math.abs(takeoff.shoulder - preload.shoulder) > 35 * Math.PI / 180);
  assert.ok(Math.abs(recovery.shoulder) > 0.05);
  assert.ok(Math.abs(recovery.elbow) > 0.08);
  assert.deepEqual(landing, { shoulder: 0, elbow: 0, headPitch: 0, headRoll: 0 });
});

test("music bass onsets produce a smooth bounded down-and-up neck motion", () => {
  const state = createMusicMotionState(0);
  let maximum = 0;
  let minimum = 0;
  let previous = 0;
  let maximumStep = 0;

  for (let frame = 0; frame < 150; frame += 1) {
    const now = frame / 60;
    const input = frame === 6 || frame === 42 || frame === 78 ? 0.82 : 0.08;
    const sample = sampleMusicMotion(state, input, true, now, 1 / 60);
    maximum = Math.max(maximum, sample.headPitch);
    minimum = Math.min(minimum, sample.headPitch);
    maximumStep = Math.max(maximumStep, Math.abs(sample.headPitch - previous));
    previous = sample.headPitch;
  }

  assert.ok(maximum > 4 * Math.PI / 180, "bass should drive the shade downward");
  assert.ok(minimum < -2 * Math.PI / 180, "the damped neck should rebound visibly upward");
  assert.ok(maximum <= MUSIC_HEADBANG_LIMIT);
  assert.ok(maximumStep < 3 * Math.PI / 180, "head motion must remain frame-smooth");
});

test("music coordinates a bounded whole-lamp groove around the neck spring", () => {
  const state = createMusicMotionState(0);
  let baseRange = 0;
  let shoulderRange = 0;
  let elbowRange = 0;
  let headYawRange = 0;
  let sawCounterMotion = false;

  for (let frame = 0; frame < 300; frame += 1) {
    const now = frame / 60;
    const strongBeat = frame % 24 === 0;
    const sample = sampleMusicMotion(state, strongBeat ? 0.88 : 0.3, true, now, 1 / 60);
    baseRange = Math.max(baseRange, Math.abs(sample.baseYaw));
    shoulderRange = Math.max(shoulderRange, Math.abs(sample.shoulder));
    elbowRange = Math.max(elbowRange, Math.abs(sample.elbow));
    headYawRange = Math.max(headYawRange, Math.abs(sample.headYaw));
    if (sample.shoulder * sample.elbow < 0) sawCounterMotion = true;
  }

  assert.ok(baseRange > 4 * Math.PI / 180);
  assert.ok(shoulderRange > 5 * Math.PI / 180);
  assert.ok(elbowRange > 8 * Math.PI / 180);
  assert.ok(headYawRange > 4 * Math.PI / 180);
  assert.ok(baseRange <= MUSIC_BASE_SWAY_LIMIT);
  assert.ok(shoulderRange <= MUSIC_SHOULDER_LIMIT);
  assert.ok(elbowRange <= MUSIC_ELBOW_LIMIT);
  assert.ok(headYawRange <= MUSIC_HEAD_YAW_LIMIT);
  assert.equal(sawCounterMotion, true);
});

test("music schedules sparse strong-beat hops and resets cleanly", () => {
  const state = createMusicMotionState(0);
  let firstHop = false;
  let earlyExtraHop = false;

  for (let frame = 0; frame < 480; frame += 1) {
    const now = frame / 60;
    const strongBeat = frame % 30 === 0;
    const sample = sampleMusicMotion(state, strongBeat ? 0.9 : 0.04, true, now, 1 / 60);
    if (sample.shouldHop && now >= 4.8 && now < 5.5) firstHop = true;
    if (sample.shouldHop && now >= 5.5 && now < 8) earlyExtraHop = true;
  }

  assert.equal(firstHop, true);
  assert.equal(earlyExtraHop, false);
  resetMusicMotionState(state, 20);
  const silent = sampleMusicMotion(state, 0, false, 20, 1 / 60);
  assert.equal(silent.shouldHop, false);
  assert.equal(silent.headPitch, 0);
  assert.equal(Math.abs(silent.baseYaw), 0);
  assert.equal(Math.abs(silent.shoulder), 0);
  assert.equal(Math.abs(silent.elbow), 0);
  assert.equal(Math.abs(silent.headYaw), 0);
});

test("hop planning moves in fixed steps without overshooting its target", () => {
  assert.equal(nextHopDestination(0, 0.5), HOP_STEP);
  assert.equal(nextHopDestination(0, -0.5), -HOP_STEP);
  assert.equal(nextHopDestination(0.44, 0.5), 0.5);
  assert.equal(nextHopDestination(-0.44, -0.5), -0.5);
});

test("authored diagonal facing is rotated onto the viewer direction", () => {
  const authored = { x: -0.59, z: 0.81 };
  const viewer = { x: -0.5, z: 0.87 };
  const yaw = yawToFace(authored, viewer);
  const rotated = {
    x: authored.x * Math.cos(yaw) + authored.z * Math.sin(yaw),
    z: -authored.x * Math.sin(yaw) + authored.z * Math.cos(yaw),
  };
  const authoredLength = Math.hypot(rotated.x, rotated.z);
  const viewerLength = Math.hypot(viewer.x, viewer.z);
  const alignment = (rotated.x * viewer.x + rotated.z * viewer.z)
    / (authoredLength * viewerLength);

  assert.ok(alignment > 0.999999);
});

test("head yaw counter-rotates the base so music nods stay camera-facing", () => {
  const restYaw = -26 * Math.PI / 180;
  const dormantBaseYaw = 35 * Math.PI / 180;
  const dormant = cameraFacingHeadYaw(restYaw, dormantBaseYaw, dormantBaseYaw);
  const awake = cameraFacingHeadYaw(restYaw, 0, 0);
  const dancing = cameraFacingHeadYaw(restYaw, 6 * Math.PI / 180, -4 * Math.PI / 180);

  assert.equal(dormant, restYaw);
  assert.equal(awake, restYaw);
  assert.ok(Math.abs(dancing - restYaw - 10 * Math.PI / 180) < 1e-12);
});
