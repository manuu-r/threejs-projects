import { RESPAWN } from '../config';

/**
 * Auto-respawn watchdog: fires when the bike leaves the playable envelope —
 * fell through the world, is past the barrier line by a margin (glitch), or
 * has been upside-down too long. Manual respawn (R) bypasses the checks but
 * still owes the cooldown.
 */
export class RespawnMonitor {
  private upsideDownSec = 0;
  private cooldownUntil = -Infinity;

  /**
   * Feed once per fixed step.
   * @param lateralAbs    |signed distance from centerline| in meters
   * @param lateralLimit  this sample's barrier offset + RESPAWN margin
   */
  update(
    dt: number,
    simTimeSec: number,
    state: { y: number; uprightDot: number; lateralAbs: number; lateralLimit: number },
  ): boolean {
    if (simTimeSec < this.cooldownUntil) return false;

    let trigger = state.y < RESPAWN.minY || state.lateralAbs > state.lateralLimit;

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
