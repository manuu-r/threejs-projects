/**
 * Lap clock driven by simulation time (fixed-step accumulated), so pausing
 * physics pauses the timer for free.
 */
export class LapTimer {
  private startTime = 0;
  private _running = false;
  private _currentInvalid = false;

  lastLapMs: number | null = null;

  get running(): boolean {
    return this._running;
  }

  /** The lap in progress; null before the first start-line crossing. */
  currentMs(simTimeSec: number): number | null {
    return this._running ? (simTimeSec - this.startTime) * 1000 : null;
  }

  start(simTimeSec: number): void {
    this.startTime = simTimeSec;
    this._running = true;
    this._currentInvalid = false;
  }

  /**
   * Complete the lap at `simTimeSec`. Returns the lap time in ms, or null if
   * the lap was invalidated (checkpoints missed). The next lap starts timing
   * from the same instant — crossing the line is both finish and start.
   */
  completeLap(simTimeSec: number): number | null {
    const ms = (simTimeSec - this.startTime) * 1000;
    this.startTime = simTimeSec;
    const result = this._currentInvalid ? null : ms;
    this._currentInvalid = false;
    this.lastLapMs = result;
    return result;
  }

  invalidateCurrent(): void {
    this._currentInvalid = true;
  }
}
