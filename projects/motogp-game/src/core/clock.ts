import { PHYSICS } from '../config';

const FIXED_DT = 1 / PHYSICS.fixedHz;

/**
 * requestAnimationFrame loop with a fixed-timestep physics accumulator.
 * Fixed-step callbacks run 0..maxSubsteps times per frame; frame callbacks run once.
 */
export class Clock {
  /** Called every fixed step with FIXED_DT. */
  onFixedStep: (dt: number) => void = () => {};
  /** Called once per rendered frame with the (clamped) frame delta. */
  onFrame: (dt: number) => void = () => {};

  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private running = false;

  fps = 0;
  /** Milliseconds spent inside onFixedStep this frame — debug HUD. */
  lastPhysicsMs = 0;

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
    while (this.accumulator >= FIXED_DT && steps < PHYSICS.maxSubsteps) {
      this.onFixedStep(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === PHYSICS.maxSubsteps) this.accumulator = 0;

    this.lastPhysicsMs = performance.now() - t0;
    this.onFrame(frameDt);
  }
}
