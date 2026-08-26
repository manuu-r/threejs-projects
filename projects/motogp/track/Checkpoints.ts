import type { TrackData } from './TrackData';

/** Events from one fixed-step update. The object is reused — copy fields out if kept. */
export interface CheckpointEvents {
  /** The expected gate was crossed in the right direction. */
  passed: boolean;
  /** First-ever start-line crossing: timing starts now (not a completed lap). */
  lapStarted: boolean;
  /** Start-line crossing with every gate already passed in order. */
  lapCompleted: boolean;
}

/**
 * Arc-length checkpoint gates over the dense centerline, enforced strictly in
 * order and direction. Gate 0 sits on the start line; the first crossing arms
 * the timer, every later in-order start-line crossing completes a lap.
 * Skipping any gate (cutting, respawn abuse) invalidates the current lap.
 *
 * Nearest-sample tracking uses a windowed search around the previous index,
 * so this costs O(window) per step.
 */
export class Checkpoints {
  readonly gateIndices: number[];

  private readonly track: TrackData;
  /** Which gate in gateIndices must be crossed next. */
  private nextGate = 0;
  private armed = false;
  private _valid = true;
  private hint = -1;
  private prevProgress = 0;

  private readonly events: CheckpointEvents = { passed: false, lapStarted: false, lapCompleted: false };

  constructor(track: TrackData) {
    this.track = track;
    const gates = Math.max(2, track.json.checkpoints ?? 8);
    const n = track.count;
    const start = track.json.startSampleIndex % n;
    this.gateIndices = Array.from({ length: gates }, (_, k) => (start + Math.round((k * n) / gates)) % n);
    this.prevProgress = start / n;
  }

  get valid(): boolean {
    return this._valid;
  }

  /** Fraction of the lap completed by gates (0 until the lap is armed). */
  get progress(): number {
    if (!this.armed) return 0;
    return this.nextGate / this.gateIndices.length;
  }

  /** Index of the centerline sample nearest the last-updated position (-1 initially). */
  get nearestIndex(): number {
    return this.hint;
  }

  /** Signed lateral offset from the centerline at the nearest sample (meters, + = right). */
  lateralOffset(x: number, z: number): number {
    const i = this.hint >= 0 ? this.hint : this.track.nearestSample(x, z);
    const s = this.track.samples[i]!;
    return (x - s.p[0]) * s.n[0] + (z - s.p[2]) * s.n[2];
  }

  reset(): void {
    this.nextGate = 0;
    this.armed = false;
    this._valid = true;
    this.hint = -1;
  }

  invalidate(): void {
    this._valid = false;
  }

  /** Call once per fixed step with the vehicle position. */
  update(x: number, z: number): CheckpointEvents {
    const ev = this.events;
    ev.passed = false;
    ev.lapStarted = false;
    ev.lapCompleted = false;

    this.hint = this.track.nearestSample(x, z, this.hint);
    const progress = this.hint / this.track.count;
    const prev = this.prevProgress;
    this.prevProgress = progress;

    if (!this._valid) {
      // Lap already lost. Crossing the start line forward re-arms a fresh
      // attempt (racing convention: the line always starts a new lap).
      const g0 = this.gateIndices[0]! / this.track.count;
      if (frac(prev - g0) > 0.9 && frac(progress - g0) < 0.1) {
        this._valid = true;
        this.armed = true;
        this.nextGate = 1 % this.gateIndices.length;
        ev.passed = true;
        ev.lapStarted = true;
      }
      return ev;
    }

    for (let k = 0; k < this.gateIndices.length; k++) {
      const g = this.gateIndices[k]! / this.track.count;
      const dPrev = frac(prev - g);
      const dCur = frac(progress - g);
      // Just-behind (≈1) → just-ahead (≈0) = forward crossing.
      if (!(dPrev > 0.9 && dCur < 0.1)) continue;

      if (k !== this.nextGate) {
        // Out-of-order crossing = part of the circuit skipped. But ignore
        // grazes within ~12 m of the gate (rollback-and-recreep at the line).
        if (dCur > 0.005) {
          this.invalidate();
          return ev;
        }
        continue;
      }

      ev.passed = true;
      if (!this.armed) {
        this.armed = true;
        ev.lapStarted = true;
      } else if (this.nextGate === 0) {
        ev.lapCompleted = true;
      }
      this.nextGate = (this.nextGate + 1) % this.gateIndices.length;
      return ev;
    }
    return ev;
  }
}

function frac(v: number): number {
  return v - Math.floor(v);
}
