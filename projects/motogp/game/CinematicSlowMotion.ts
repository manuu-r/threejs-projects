export interface SlowMotionState {
  timeScale: number;
  active: boolean;
  recover: boolean;
}

/** Smooth, short crash slow motion driven by unscaled real time. */
export class CinematicSlowMotion {
  private elapsedSec = 0;
  private durationSec = 0;
  private minimumScale = 1;
  private scale = 1;
  private active = false;

  trigger(severity: number): void {
    const s = Math.max(0, Math.min(1, severity));
    this.elapsedSec = 0;
    this.durationSec = 2.1 + s * 0.9;
    this.minimumScale = 0.42 - s * 0.2;
    this.active = true;
  }

  update(realDt: number): SlowMotionState {
    if (!this.active) {
      this.scale += (1 - this.scale) * (1 - Math.exp(-7 * realDt));
      return { timeScale: this.scale, active: false, recover: false };
    }

    this.elapsedSec += Math.max(0, realDt);
    const enterEnd = 0.32;
    const exitStart = this.durationSec - 0.65;
    let target = this.minimumScale;
    if (this.elapsedSec < enterEnd) {
      target = 1 + (this.minimumScale - 1) * smoothstep(this.elapsedSec / enterEnd);
    } else if (this.elapsedSec > exitStart) {
      target = this.minimumScale + (1 - this.minimumScale) * smoothstep(
        (this.elapsedSec - exitStart) / Math.max(0.01, this.durationSec - exitStart),
      );
    }
    this.scale += (target - this.scale) * (1 - Math.exp(-10 * realDt));

    if (this.elapsedSec < this.durationSec) {
      return { timeScale: this.scale, active: true, recover: false };
    }
    this.active = false;
    this.scale = 1;
    return { timeScale: 1, active: false, recover: true };
  }

  reset(): void {
    this.elapsedSec = 0;
    this.durationSec = 0;
    this.minimumScale = 1;
    this.scale = 1;
    this.active = false;
  }
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}
