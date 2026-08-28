/**
 * Lap clock driven by the unscaled fixed-step race clock. Pausing still stops
 * it, while cinematic crash slow motion never makes a lap artificially longer.
 */
export class LapTimer {
  private startTime = 0;
  private _running = false;
  private _currentInvalid = false;
  private completedLapCount = 0;

  lastLapMs: number | null = null;
  readonly historyMs: number[] = [];

  get running(): boolean {
    return this._running;
  }

  get lapNumber(): number {
    return this.completedLapCount + (this._running ? 1 : 0);
  }

  get sessionBestMs(): number | null {
    return this.historyMs.length ? Math.min(...this.historyMs) : null;
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
    this.completedLapCount++;
    this._currentInvalid = false;
    this.lastLapMs = result;
    if (result !== null) this.historyMs.push(result);
    return result;
  }

  invalidateCurrent(): void {
    this._currentInvalid = true;
  }
}
