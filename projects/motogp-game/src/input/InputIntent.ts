import type { ActionFlags, InputIntent } from '../types';
import { STEERING } from '../config';

export type { InputIntent };

const GAMEPAD_DEADZONE = 0.12;
const RAMP_ATTACK = 4.0; // 1/s toward held
const RAMP_RELEASE = 6.0; // 1/s toward released

/**
 * Keyboard + gamepad merged input with analog-style ramps.
 * update(dt) must be called once per FIXED step so behavior is timestep-independent.
 */
export class Controls {
  readonly intent: InputIntent = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  /** Edge-triggered flags, consumed via takeActions(). */
  private actions: ActionFlags = {
    recover: false,
    cameraToggle: false,
    pauseToggle: false,
    toggleDebugPhysics: false,
    toggleDebugTrack: false,
    rebuildBike: false,
  };

  private keys = new Set<string>();
  private steerCurrent = 0;
  private throttleCurrent = 0;
  private brakeCurrent = 0;
  private prevGamepadButtons: boolean[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => this.handleKey(e, true));
    window.addEventListener('keyup', (e) => this.handleKey(e, false));
  }

  takeActions(): ActionFlags {
    const out = { ...this.actions };
    for (const k of Object.keys(this.actions) as Array<keyof ActionFlags>) this.actions[k] = false;
    return out;
  }

  private handleKey(e: KeyboardEvent, down: boolean): void {
    const code = e.code;
    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'F3', 'F9', 'F10'].includes(code)
    ) {
      e.preventDefault();
    }
    if (down && !this.keys.has(code)) this.fireAction(code);
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  private fireAction(code: string): void {
    switch (code) {
      case 'KeyR': this.actions.recover = true; break;
      case 'KeyC': this.actions.cameraToggle = true; break;
      case 'KeyP': this.actions.pauseToggle = true; break;
      case 'F3': this.actions.toggleDebugPhysics = true; break;
      case 'F9': this.actions.toggleDebugPhysics = true; break;
      case 'F10': this.actions.toggleDebugTrack = true; break;
      case 'KeyT': this.actions.rebuildBike = true; break;
    }
  }

  /** Merge keyboard state + gamepad into the ramped intent. Call once per fixed step. */
  update(dt: number): void {
    const pad = navigator.getGamepads?.()[0] ?? null;

    let steerTarget = 0;
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > GAMEPAD_DEADZONE) steerTarget = ax;
    }
    if (!steerTarget) {
      const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
      const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
      steerTarget = (right ? 1 : 0) - (left ? 1 : 0);
    }

    let throttleHeld =
      this.keys.has('KeyW') || this.keys.has('ArrowUp') || !!pad?.buttons[7]?.pressed;
    let brakeHeld =
      this.keys.has('KeyS') || this.keys.has('ArrowDown') || !!pad?.buttons[6]?.pressed;
    const handbrakeHeld =
      this.keys.has('Space') || !!pad?.buttons[0]?.pressed;

    // Analog triggers (0..1) bypass the ramp.
    const padThrottle = pad?.buttons[7]?.value ?? 0;
    const padBrake = pad?.buttons[6]?.value ?? 0;
    if (padThrottle > 0.01) {
      this.throttleCurrent = Math.min(1, padThrottle);
      throttleHeld = false;
    }
    if (padBrake > 0.01) {
      this.brakeCurrent = Math.min(1, padBrake);
      brakeHeld = false;
    }

    this.throttleCurrent = ramp(this.throttleCurrent, throttleHeld ? 1 : 0, RAMP_ATTACK, RAMP_RELEASE, dt);
    this.brakeCurrent = ramp(this.brakeCurrent, brakeHeld ? 1 : 0, RAMP_ATTACK, RAMP_RELEASE, dt);

    // Steering ramp: slower when engaging, faster when re-centering.
    const rate = Math.abs(steerTarget) > Math.abs(this.steerCurrent)
      ? STEERING.steerSpeedPerSec
      : STEERING.returnSpeedPerSec;
    const delta = steerTarget - this.steerCurrent;
    this.steerCurrent += Math.max(-rate * dt, Math.min(rate * dt, delta));

    this.intent.throttle = this.throttleCurrent;
    this.intent.brake = this.brakeCurrent;
    this.intent.steer = this.steerCurrent;
    this.intent.handbrake = handbrakeHeld ? 1 : 0;

    // Gamepad edge-triggered buttons -> action flags.
    if (pad) {
      pad.buttons.forEach((b, i) => {
        const pressed = b.pressed;
        const was = this.prevGamepadButtons[i] ?? false;
        if (pressed && !was) {
          if (i === 1) this.actions.recover = true; // B
          if (i === 3) this.actions.cameraToggle = true; // Y
        }
        this.prevGamepadButtons[i] = pressed;
      });
    }
  }

  /** Reset ramps (on respawn/pause resume). */
  reset(): void {
    this.throttleCurrent = 0;
    this.brakeCurrent = 0;
    this.steerCurrent = 0;
    this.keys.clear();
  }
}

function ramp(current: number, target: number, attack: number, release: number, dt: number): number {
  if (current === target) return current;
  const rate = target > current ? attack : release;
  const maxDelta = rate * dt;
  const delta = target - current;
  return Math.abs(delta) <= maxDelta ? target : current + Math.sign(delta) * maxDelta;
}
