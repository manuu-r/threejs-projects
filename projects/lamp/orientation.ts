export type HorizontalDirection = { x: number; z: number };

/** Returns the shortest Y-axis rotation that aligns one horizontal direction to another. */
export function yawToFace(
  authoredForward: HorizontalDirection,
  desiredForward: HorizontalDirection,
): number {
  const authoredYaw = Math.atan2(authoredForward.x, authoredForward.z);
  const desiredYaw = Math.atan2(desiredForward.x, desiredForward.z);
  const difference = desiredYaw - authoredYaw;
  return Math.atan2(Math.sin(difference), Math.cos(difference));
}

/** Keeps the shade facing the viewer while the whole arm yaws underneath it. */
export function cameraFacingHeadYaw(
  restYaw: number,
  expressiveYaw: number,
  baseYaw: number,
): number {
  return restYaw + expressiveYaw - baseYaw;
}
