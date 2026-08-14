export type HandPoint = {
  x: number;
  y: number;
  z: number;
};

export type HandCalibration = {
  midpointX: number;
  midpointY: number;
  separation: number;
  depth: number;
  aspect: number;
  palmPairs: number[];
  cameraDistance: number;
};

export type CalibratedHandFrame = {
  midpointX: number;
  midpointY: number;
  aspect: number;
  palmPairs: number[];
  cameraDistance: number;
  unitsPerImage: number;
  bagCenter: HandPoint;
  bagRadius: number;
  guardGap: number;
  punchGain: number;
};

export const KNUCKLES = [5, 9, 13, 17] as const;
export const CAMERA_FOCAL_X_NORMALIZED = 0.9;

const ASSUMED_WRIST_TO_MIDDLE_MCP_METERS = 0.1;
const PALM_DEPTH_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 9],
  [0, 5],
  [0, 17],
  [5, 17],
  [5, 9],
  [9, 13],
  [13, 17],
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function handCenter(hand: HandPoint[]) {
  const total = KNUCKLES.reduce(
    (acc, index) => {
      acc.x += hand[index].x;
      acc.y += hand[index].y;
      acc.z += hand[index].z;
      return acc;
    },
    { x: 0, y: 0, z: 0 },
  );
  return {
    x: total.x / KNUCKLES.length,
    y: total.y / KNUCKLES.length,
    z: total.z / KNUCKLES.length,
  };
}

export function palmPairDistances(hand: HandPoint[], aspect: number) {
  return PALM_DEPTH_PAIRS.map(([from, to]) => {
    const dx = hand[from].x - hand[to].x;
    const dy = (hand[from].y - hand[to].y) / aspect;
    const dz = hand[from].z - hand[to].z;
    return Math.hypot(dx, dy, dz);
  });
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function calculateCalibration(
  hands: HandPoint[][],
  aspect: number,
): HandCalibration {
  const first = handCenter(hands[0]);
  const second = handCenter(hands[1]);
  const separation = Math.hypot(first.x - second.x, first.y - second.y);
  const firstPairs = palmPairDistances(hands[0], aspect);
  const secondPairs = palmPairDistances(hands[1], aspect);
  const palmPairs = firstPairs.map(
    (distance, index) => (distance + secondPairs[index]) / 2,
  );
  const cameraDistance = clamp(
    (ASSUMED_WRIST_TO_MIDDLE_MCP_METERS * CAMERA_FOCAL_X_NORMALIZED) /
      Math.max(palmPairs[0], 0.035),
    0.42,
    1.35,
  );
  return {
    midpointX: (first.x + second.x) / 2,
    midpointY: (first.y + second.y) / 2,
    separation,
    depth: (first.z + second.z) / 2,
    aspect,
    palmPairs,
    cameraDistance,
  };
}

export function averageCalibration(samples: HandCalibration[]): HandCalibration {
  const count = Math.max(samples.length, 1);
  const average = (pick: (sample: HandCalibration) => number) =>
    samples.reduce((sum, sample) => sum + pick(sample), 0) / count;
  return {
    midpointX: average((sample) => sample.midpointX),
    midpointY: average((sample) => sample.midpointY),
    separation: average((sample) => sample.separation),
    depth: average((sample) => sample.depth),
    aspect: average((sample) => sample.aspect),
    cameraDistance: average((sample) => sample.cameraDistance),
    palmPairs: PALM_DEPTH_PAIRS.map((_, index) =>
      average((sample) => sample.palmPairs[index]),
    ),
  };
}

export function calculateDepthRatio(
  hand: HandPoint[],
  calibration: Pick<HandCalibration, "aspect" | "palmPairs">,
) {
  const currentPairs = palmPairDistances(hand, calibration.aspect);
  return clamp(
    median(
      currentPairs.map(
        (distance, index) =>
          distance / Math.max(calibration.palmPairs[index], 0.001),
      ),
    ),
    0.62,
    2.4,
  );
}

export function mapLandmarkToScene(
  landmark: HandPoint,
  center: HandPoint,
  depthRatio: number,
  frame: CalibratedHandFrame,
) {
  const safeDepthRatio = clamp(depthRatio, 0.62, 2.4);
  const currentCameraDistance = frame.cameraDistance / safeDepthRatio;
  const forwardMeters = frame.cameraDistance - currentCameraDistance;
  const forwardTravel = clamp(
    forwardMeters * frame.punchGain,
    -0.22,
    frame.guardGap + frame.bagRadius * 0.34,
  );
  const cameraX = (0.5 - landmark.x) / safeDepthRatio;
  const calibratedX = 0.5 - frame.midpointX;
  const cameraY = (0.5 - landmark.y) / safeDepthRatio;
  const calibratedY = 0.5 - frame.midpointY;
  const localPoseDepth =
    ((landmark.z - center.z) / safeDepthRatio) *
    frame.unitsPerImage *
    0.5;
  return {
    x:
      frame.bagCenter.x +
      (cameraX - calibratedX) * frame.unitsPerImage,
    y:
      frame.bagCenter.y +
      ((cameraY - calibratedY) * frame.unitsPerImage) / frame.aspect,
    z:
      frame.bagCenter.z +
      frame.bagRadius +
      frame.guardGap -
      forwardTravel +
      localPoseDepth,
  };
}

export function calculatePenetrationCorrection(
  fist: HandPoint,
  bagCenter: HandPoint,
  bagRadius: number,
  bagHeight: number,
  maximumPenetration = 0.075,
) {
  const deltaX = fist.x - bagCenter.x;
  const verticalInside = Math.abs(fist.y - bagCenter.y) < bagHeight * 0.58;
  const expandedRadius = bagRadius + 0.035;
  if (!verticalInside || Math.abs(deltaX) >= expandedRadius) return 0;
  const frontSurfaceZ =
    bagCenter.z +
    Math.sqrt(Math.max(0, expandedRadius ** 2 - deltaX ** 2));
  return Math.max(0, frontSurfaceZ - maximumPenetration - fist.z);
}

export const DEFAULT_CALIBRATION: HandCalibration = {
  midpointX: 0.5,
  midpointY: 0.5,
  separation: 0.28,
  depth: 0,
  aspect: 16 / 9,
  palmPairs: [0.115, 0.105, 0.12, 0.1, 0.055, 0.052, 0.055],
  cameraDistance: 0.78,
};
