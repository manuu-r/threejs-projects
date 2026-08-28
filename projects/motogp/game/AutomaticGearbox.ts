export interface AutomaticGearboxConfig {
  readonly gearRatios: readonly number[];
  readonly differentialRatio: number;
  readonly wheelRadiusM: number;
  readonly maxRpm: number;
  readonly shiftUpRpm: number;
  readonly shiftDownRpm: number;
  readonly kickdownRpm: number;
  readonly shiftDurationSec: number;
  readonly shiftLockoutSec: number;
}

export interface GearboxCommand {
  readonly gear: number;
  /** Normalized clutch engagement: 0 is open, 1 is fully engaged. */
  readonly clutch: number;
  /** Torque reduction while the quickshifter unloads the drivetrain. */
  readonly driveScale: number;
  readonly shifting: boolean;
}

/** Engine RPM implied by road speed when the clutch is fully engaged. */
export function coupledRpmAtSpeed(
  speedMps: number,
  gearRatio: number,
  differentialRatio: number,
  wheelRadiusM: number,
): number {
  const wheelRps = Math.max(0, speedMps) / (2 * Math.PI * wheelRadiusM);
  return wheelRps * 60 * gearRatio * differentialRatio;
}

/**
 * Deterministic six-speed race gearbox layered over Jolt's manual transmission.
 * It never selects neutral: stopped/coasting means first or the last road gear.
 */
export class AutomaticGearbox {
  private readonly config: AutomaticGearboxConfig;
  private selectedGear = 1;
  private shiftElapsedSec = Number.POSITIVE_INFINITY;
  private lockoutRemainingSec = 0;

  constructor(config: AutomaticGearboxConfig) {
    if (config.gearRatios.length === 0) throw new Error('Automatic gearbox needs at least one gear');
    this.config = config;
  }

  get gear(): number {
    return this.selectedGear;
  }

  reset(): GearboxCommand {
    this.selectedGear = 1;
    this.shiftElapsedSec = Number.POSITIVE_INFINITY;
    this.lockoutRemainingSec = 0;
    return { gear: 1, clutch: 1, driveScale: 1, shifting: false };
  }

  update(dt: number, speedMps: number, throttle: number): GearboxCommand {
    const step = Math.max(0, Math.min(0.1, dt));
    const safeThrottle = Math.max(0, Math.min(1, throttle));

    if (Number.isFinite(this.shiftElapsedSec)) {
      this.shiftElapsedSec += step;
      const t = Math.min(1, this.shiftElapsedSec / this.config.shiftDurationSec);
      const clutch = t * t * (3 - 2 * t);
      if (t >= 1) {
        this.shiftElapsedSec = Number.POSITIVE_INFINITY;
        this.lockoutRemainingSec = this.config.shiftLockoutSec;
      }
      return {
        gear: this.selectedGear,
        clutch,
        driveScale: 0.12 + 0.88 * clutch,
        shifting: t < 1,
      };
    }

    this.lockoutRemainingSec = Math.max(0, this.lockoutRemainingSec - step);
    if (this.lockoutRemainingSec === 0) {
      const rpm = this.rpmForGear(speedMps, this.selectedGear);
      const canUpshift = this.selectedGear < this.config.gearRatios.length;
      const canDownshift = this.selectedGear > 1;

      // Only upshift under load. Lifting the throttle holds the current gear,
      // giving predictable engine braking instead of falling into neutral.
      if (canUpshift && safeThrottle > 0.08 && rpm >= this.config.shiftUpRpm) {
        this.beginShift(this.selectedGear + 1);
      } else if (canDownshift) {
        // Under renewed throttle, downshift slightly earlier for useful drive;
        // while coasting, retain the gear until road speed genuinely falls.
        const downshiftRpm = this.config.shiftDownRpm + safeThrottle * this.config.kickdownRpm;
        const lowerGearRpm = this.rpmForGear(speedMps, this.selectedGear - 1);
        if (rpm <= downshiftRpm && lowerGearRpm < this.config.maxRpm * 0.94) {
          this.beginShift(this.selectedGear - 1);
        }
      }
    }

    if (Number.isFinite(this.shiftElapsedSec)) {
      return { gear: this.selectedGear, clutch: 0, driveScale: 0.12, shifting: true };
    }
    return { gear: this.selectedGear, clutch: 1, driveScale: 1, shifting: false };
  }

  private beginShift(nextGear: number): void {
    this.selectedGear = Math.max(1, Math.min(this.config.gearRatios.length, nextGear));
    this.shiftElapsedSec = 0;
  }

  private rpmForGear(speedMps: number, gear: number): number {
    return coupledRpmAtSpeed(
      Math.abs(speedMps),
      this.config.gearRatios[gear - 1]!,
      this.config.differentialRatio,
      this.config.wheelRadiusM,
    );
  }
}
