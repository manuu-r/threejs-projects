import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCalibration,
  calculateDepthRatio,
  calculatePenetrationCorrection,
  calculateWholeHandVelocity,
  fuseForearmVelocity,
  handCenter,
  mapLandmarkToScene,
  wholeHandMotionCenter,
  type CalibratedHandFrame,
  type HandPoint,
} from "../app/handMapping.ts";

function makeHand(centerX: number): HandPoint[] {
  const hand = Array.from({ length: 21 }, () => ({
    x: centerX,
    y: 0.5,
    z: 0,
  }));
  hand[0] = { x: centerX, y: 0.62, z: 0 };
  hand[5] = { x: centerX - 0.045, y: 0.51, z: -0.012 };
  hand[9] = { x: centerX - 0.005, y: 0.49, z: -0.02 };
  hand[13] = { x: centerX + 0.038, y: 0.505, z: -0.016 };
  hand[17] = { x: centerX + 0.075, y: 0.535, z: -0.01 };
  return hand;
}

function perspectiveScale(hand: HandPoint[], ratio: number) {
  return hand.map((point) => ({
    x: 0.5 + (point.x - 0.5) * ratio,
    y: 0.5 + (point.y - 0.5) * ratio,
    z: point.z * ratio,
  }));
}

function frameFor(
  calibration: ReturnType<typeof calculateCalibration>,
): CalibratedHandFrame {
  const bagRadius = 0.5;
  const guardGap = 0.42;
  return {
    midpointX: calibration.midpointX,
    midpointY: calibration.midpointY,
    aspect: calibration.aspect,
    palmPairs: calibration.palmPairs,
    cameraDistance: calibration.cameraDistance,
    unitsPerImage: calibration.cameraDistance / 0.9,
    bagCenter: { x: 0, y: 3, z: 0 },
    bagRadius,
    guardGap,
    punchGain: guardGap / Math.min(0.32, calibration.cameraDistance * 0.3),
  };
}

test("larger apparent palms are measured as closer to the webcam", () => {
  const hands = [makeHand(0.38), makeHand(0.62)];
  const baseline = calculateCalibration(hands, 16 / 9);
  const closer = calculateCalibration(
    hands.map((hand) => perspectiveScale(hand, 1.4)),
    16 / 9,
  );
  assert.ok(closer.cameraDistance < baseline.cameraDistance);
});

test("moving toward the webcam maps the hand toward the bag", () => {
  const hand = makeHand(0.38);
  const other = makeHand(0.62);
  const calibration = calculateCalibration([hand, other], 16 / 9);
  const frame = frameFor(calibration);
  const baselineRatio = calculateDepthRatio(hand, calibration);
  const baseline = mapLandmarkToScene(
    hand[9],
    handCenter(hand),
    baselineRatio,
    frame,
  );
  const closerHand = perspectiveScale(hand, 1.5);
  const closer = mapLandmarkToScene(
    closerHand[9],
    handCenter(closerHand),
    calculateDepthRatio(closerHand, calibration),
    frame,
  );
  assert.ok(closer.z < baseline.z - 0.2);
});

test("perspective growth does not make X drift and mirror direction is preserved", () => {
  const hand = makeHand(0.38);
  const other = makeHand(0.62);
  const calibration = calculateCalibration([hand, other], 16 / 9);
  const frame = frameFor(calibration);
  const baseline = mapLandmarkToScene(
    hand[9],
    handCenter(hand),
    1,
    frame,
  );
  const closerHand = perspectiveScale(hand, 1.5);
  const closer = mapLandmarkToScene(
    closerHand[9],
    handCenter(closerHand),
    calculateDepthRatio(closerHand, calibration),
    frame,
  );
  assert.ok(Math.abs(closer.x - baseline.x) < 1e-9);

  const imageRight = { ...hand[9], x: calibration.midpointX + 0.08 };
  const mirrored = mapLandmarkToScene(
    imageRight,
    handCenter(hand),
    1,
    frame,
  );
  assert.ok(mirrored.x < frame.bagCenter.x);
});

test("a fist may compress the surface but cannot pass through the bag", () => {
  const bagCenter = { x: 0, y: 3, z: 0 };
  const deeplyInside = { x: 0, y: 3, z: -0.4 };
  const correction = calculatePenetrationCorrection(
    deeplyInside,
    bagCenter,
    0.5,
    2.2,
  );
  const correctedZ = deeplyInside.z + correction;
  assert.ok(Math.abs(correctedZ - (0.535 - 0.018)) < 1e-9);

  const missedBag = { x: 0.8, y: 3, z: -0.4 };
  assert.equal(
    calculatePenetrationCorrection(missedBag, bagCenter, 0.5, 2.2),
    0,
  );
});

test("whole-hand motion follows the palm while rejecting one noisy fingertip", () => {
  const previous = makeHand(0.5);
  const current = previous.map((point) => ({
    x: point.x + 0.012,
    y: point.y - 0.006,
    z: point.z - 0.03,
  }));
  current[8] = { x: 1.8, y: -1.2, z: 0.9 };

  const velocity = calculateWholeHandVelocity(current, previous, 0.03);
  assert.ok(Math.abs(velocity.x - 0.4) < 0.08);
  assert.ok(Math.abs(velocity.y + 0.2) < 0.08);
  assert.ok(Math.abs(velocity.z + 1) < 0.08);
});

test("whole-hand center translates consistently for open and closed hands", () => {
  const hand = makeHand(0.5);
  const before = wholeHandMotionCenter(hand);
  const translated = hand.map((point, index) => ({
    x: point.x - 0.04,
    y: point.y + 0.025,
    z: point.z - 0.08 + (index % 4 === 0 ? 0.002 : 0),
  }));
  const after = wholeHandMotionCenter(translated);

  assert.ok(Math.abs(after.x - before.x + 0.04) < 1e-9);
  assert.ok(Math.abs(after.y - before.y - 0.025) < 1e-9);
  assert.ok(Math.abs(after.z - before.z + 0.08) < 0.001);
});

test("forearm motion stabilizes punch velocity and rejects pose spikes", () => {
  const handVelocity = { x: 0.3, y: 0.1, z: -1.2 };
  const previousForearm = { x: 0, y: 0, z: 0 };
  const currentForearm = { x: 0.006, y: 0, z: -0.027 };
  const fused = fuseForearmVelocity(
    handVelocity,
    currentForearm,
    previousForearm,
    0.03,
  );
  assert.ok(fused.z > handVelocity.z);
  assert.ok(fused.z < -0.9);

  const poseSpike = fuseForearmVelocity(
    handVelocity,
    { x: 2, y: -1, z: 1 },
    previousForearm,
    0.03,
  );
  assert.deepEqual(poseSpike, handVelocity);
});
