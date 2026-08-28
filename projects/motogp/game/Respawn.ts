import { RESPAWN } from '../config';

/**
 * Auto-respawn watchdog: fires when the bike leaves the playable envelope —
 * fell through the authored venue, left its playable envelope, or has been
 * upside-down too long. Manual respawn (R) bypasses the checks but still owes
 * the cooldown.
 */
export class RespawnMonitor {
  private upsideDownSec = 0;
  private cooldownUntil = -Infinity;

  /**
   * Feed once per fixed step.
   * The inputs are measured against the real playable triangle meshes. The old
   * generated centerline is intentionally excluded because it follows a wrong
   * branch in parts of this supplied venue.
   */
  update(
    dt: number,
    simTimeSec: number,
    state: {
      uprightDot: number;
      surfaceDistance: number;
      heightAboveSurface: number;
    },
  ): boolean {
    if (simTimeSec < this.cooldownUntil) return false;

    let trigger =
      state.heightAboveSurface < RESPAWN.maxBelowRoadM ||
      state.heightAboveSurface > RESPAWN.maxAboveRoadM ||
      state.surfaceDistance > RESPAWN.maxDistanceFromAsphaltM;

    if (state.uprightDot < RESPAWN.upsideDownDotThreshold) {
      this.upsideDownSec += dt;
      if (this.upsideDownSec >= RESPAWN.upsideDownTimeSec) trigger = true;
    } else {
      this.upsideDownSec = 0;
    }

    if (trigger) {
      this.cooldownUntil = simTimeSec + RESPAWN.cooldownSec;
      this.upsideDownSec = 0;
    }
    return trigger;
  }

  /** Manual respawn also owes the cooldown so it can't machine-gun. */
  notifyManual(simTimeSec: number): void {
    this.cooldownUntil = simTimeSec + RESPAWN.cooldownSec;
    this.upsideDownSec = 0;
  }
}
