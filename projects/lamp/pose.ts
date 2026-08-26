const degreesToRadians = (value: number) => value * (Math.PI / 180);

export const WAKE_SETTLE_MS = 1_550;

/**
 * An upright task-lamp stance measured against the shipped GLB pivots. The
 * authored neutral arm joints form the classic two-segment silhouette; a base
 * turn exposes that profile while the shade looks down toward the viewer.
 */
export const DORMANT_LAMP_POSE = Object.freeze({
  baseYaw: degreesToRadians(35),
  shoulder: 0,
  elbow: 0,
  headPitch: degreesToRadians(60),
  headYaw: degreesToRadians(35),
  headRoll: 0,
  rootZ: 0,
});
