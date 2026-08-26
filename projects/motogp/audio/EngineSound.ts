/**
 * Procedural inline-4 engine note: firing-frequency saw + an octave-down
 * square, through a throttle-driven lowpass. Browsers block audio until a user
 * gesture, so the context arms itself on the first key press / gamepad button.
 */
export class EngineSound {
  private ctx: AudioContext | null = null;
  private saw: OscillatorNode | null = null;
  private sub: OscillatorNode | null = null;
  private noiseGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private master: GainNode | null = null;
  private armed = false;
  private disposed = false;
  private readonly arm = (): void => {
    if (this.armed || this.disposed) return;
    this.armed = true;
    void this.start();
    window.removeEventListener('keydown', this.arm);
    window.removeEventListener('pointerdown', this.arm);
  };

  constructor() {
    window.addEventListener('keydown', this.arm);
    window.addEventListener('pointerdown', this.arm);
  }

  private async start(): Promise<void> {
    try {
      const ctx = new AudioContext();
      await ctx.resume();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = 0.0;
      this.master.connect(ctx.destination);

      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 900;
      this.filter.Q.value = 1.2;
      this.filter.connect(this.master);

      // Firing frequency (≈ rpm/60 × 2 for an inline-4) and its sub-octave.
      this.saw = ctx.createOscillator();
      this.saw.type = 'sawtooth';
      this.saw.frequency.value = 80;
      const sawGain = ctx.createGain();
      sawGain.gain.value = 0.55;
      this.saw.connect(sawGain).connect(this.filter);

      this.sub = ctx.createOscillator();
      this.sub.type = 'square';
      this.sub.frequency.value = 40;
      const subGain = ctx.createGain();
      subGain.gain.value = 0.3;
      this.sub.connect(subGain).connect(this.filter);

      // Intake/exhaust rush: filtered noise, louder with revs.
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = 1400;
      this.noiseGain = ctx.createGain();
      this.noiseGain.gain.value = 0;
      noise.connect(this.noiseGain);
      this.noiseGain.connect(this.master);

      this.saw.start();
      this.sub.start();
      noise.start();
    } catch {
      // No audio (headless, blocked autoplay) — stay silent forever.
      this.ctx = null;
    }
  }

  /** Per-frame: rpm01 [0..1] against the rev limit, throttle 0..1. */
  update(rpm01: number, throttle: number): void {
    if (!this.ctx || !this.saw || !this.sub || !this.filter || !this.master || !this.noiseGain) return;
    const rpm = Math.max(0.05, Math.min(1.05, rpm01));
    const firing = (rpm * 12500 * 2) / 60; // Hz
    const t = this.ctx.currentTime;
    this.saw.frequency.setTargetAtTime(firing, t, 0.03);
    this.sub.frequency.setTargetAtTime(firing / 2, t, 0.03);
    this.filter.frequency.setTargetAtTime(500 + rpm * 3200 + throttle * 1400, t, 0.05);
    const load = 0.05 + throttle * 0.12 + rpm * 0.05;
    this.master.gain.setTargetAtTime(load, t, 0.08);
    this.noiseGain.gain.setTargetAtTime(rpm * 0.05, t, 0.1);
  }

  /** Mute/unmute (pause menu). */
  setMuted(muted: boolean): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.1, this.ctx.currentTime, 0.05);
    }
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('keydown', this.arm);
    window.removeEventListener('pointerdown', this.arm);
    try { this.saw?.stop(); } catch { /* already stopped */ }
    try { this.sub?.stop(); } catch { /* already stopped */ }
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.saw = null;
    this.sub = null;
    this.filter = null;
    this.master = null;
    this.noiseGain = null;
  }
}
