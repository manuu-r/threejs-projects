export interface CrashSample {
  speedMps: number;
  deltaVelocityMps: number;
  uprightDot: number;
  angularSpeedRad: number;
  frontContact: boolean;
  rearContact: boolean;
}

export interface CrashEvent {
  /** Normalized cinematic intensity. Values above 1 are clamped. */
  severity: number;
  reason: 'impact' | 'tumble' | 'landing';
}

/**
 * Fixed-step crash classifier. Ordinary kerb hits and wheel contact changes are
 * ignored; a crash requires meaningful road speed plus impact, rotation, or a
 * hard airborne-to-ground landing.
 */
export class CrashDetector {
  private wasAirborne = false;
  private active = false;

  update(sample: CrashSample): CrashEvent | null {
    if (this.active) return null;

    const airborne = !sample.frontContact && !sample.rearContact;
    const landing = this.wasAirborne && !airborne;
    this.wasAirborne = airborne;

    if (sample.speedMps < 9) return null;

    const impactScore = sample.deltaVelocityMps / 7.5;
    const tumbleScore = Math.max(
      (0.32 - sample.uprightDot) / 0.32,
      (sample.angularSpeedRad - 6.5) / 5,
    );
    const landingScore = landing ? sample.deltaVelocityMps / 10.5 : 0;
    const score = Math.max(impactScore, tumbleScore, landingScore);
    if (score < 1) return null;

    this.active = true;
    const reason = landingScore >= impactScore && landingScore >= tumbleScore
      ? 'landing'
      : tumbleScore > impactScore
        ? 'tumble'
        : 'impact';
    return { severity: Math.min(1, 0.45 + (score - 1) * 0.35), reason };
  }

  reset(): void {
    this.wasAirborne = false;
    this.active = false;
  }
}
