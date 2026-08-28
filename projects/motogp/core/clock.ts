import { PHYSICS } from '../config';

const FIXED_DT = 1 / PHYSICS.fixedHz;

/**
 * requestAnimationFrame loop with a fixed-timestep physics accumulator.
 * Fixed-step callbacks run 0..maxSubsteps times per frame; frame callbacks run once.
 */
export class Clock {
  /** Called with scaled simulation dt and unscaled race-clock dt. */
  onFixedStep: (simulationDt: number, raceDt: number) => void = () => {};
  /** Called once per rendered frame with the (clamped) frame delta. */
  onFrame: (dt: number) => void = () => {};

  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;
  /** Real elapsed time waiting to be assigned to the next physics batch. */
  private raceAccumulator = 0;
  private running = false;

  /** Physics-only cinematic scale; the accumulator and race clock stay real-time. */
  timeScale = 1;

  fps = 0;
  /** Milliseconds spent inside onFixedStep this frame — debug HUD. */
  lastPhysicsMs = 0;

  /** Fraction between the two latest fixed poses for render interpolation. */
  get interpolationAlpha(): number {
    return Math.max(0, Math.min(1, this.accumulator / FIXED_DT));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.tick(now);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick(now: number): void {
    // Clamp kills the tab-switch spiral of death; drop excess accumulated time.
    const frameDt = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;

    this.fps = frameDt > 0 ? 1 / frameDt : 0;
    const t0 = performance.now();

    let steps = 0;
    this.accumulator += frameDt;
    this.raceAccumulator += frameDt;
    const stepsThisFrame = Math.min(
      Math.floor(this.accumulator / FIXED_DT),
      PHYSICS.maxSubsteps,
    );
    // Physics catch-up is deliberately capped, but a frame hitch must not make
    // the lap clock run slow. Spread the complete real elapsed interval across
    // the fixed updates that will execute this frame.
    const raceDt = stepsThisFrame > 0 ? this.raceAccumulator / stepsThisFrame : 0;
    while (this.accumulator >= FIXED_DT && steps < stepsThisFrame) {
      this.onFixedStep(FIXED_DT * this.timeScale, raceDt);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps > 0) this.raceAccumulator = 0;
    if (steps === PHYSICS.maxSubsteps) this.accumulator = 0;

    this.lastPhysicsMs = performance.now() - t0;
    this.onFrame(frameDt);
  }
}
