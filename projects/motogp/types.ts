/** Merged keyboard+gamepad input state for one physics step. */
export interface InputIntent {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1 (positive = right)
}

/** Edge-triggered actions consumed once per press. */
export interface ActionFlags {
  recover: boolean;
  cameraToggle: boolean;
  pauseToggle: boolean;
  toggleDebugPhysics: boolean;
  toggleDebugTrack: boolean;
  rebuildBike: boolean;
}

export interface Telemetry {
  speedKph: number;
  rpm: number;
  gear: number;
  leanDeg: number; // positive = leaning right
  wheelContacts: boolean[];
  crashed: boolean;
  impactSeverity: number;
}

/** Dense centerline sample written by the Blender track builder. */
export interface TrackSample {
  p: [number, number, number];
  t: [number, number, number];
  n: [number, number, number];
  hw: number;
  bl: number;
  br: number;
  curbL: boolean;
  curbR: boolean;
}

export interface TrackCollisionJson {
  version: number;
  name: string;
  spacing: number;
  checkpoints: number;
  startSampleIndex: number;
  samples: TrackSample[];
}

export type GameState = 'loading' | 'ready' | 'driving' | 'paused';
