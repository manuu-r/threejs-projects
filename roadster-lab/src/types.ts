export type Variant = 'performance' | 'thrust' | 'rocket';
export type View = 'cockpit' | 'chase' | 'hood';
export type LessonId = 'orientation' | 'braking' | 'slalom' | 'impulse' | 'hover' | 'translation' | 'manual' | 'sandbox';
export interface Controls {
  throttle: number; brake: number; steer: number; boost: boolean;
  lift: number; yaw: number; pitch: number; roll: number;
}
export const neutralControls = (): Controls => ({ throttle: 0, brake: 0, steer: 0, boost: false, lift: 0, yaw: 0, pitch: 0, roll: 0 });
export interface Telemetry {
  speed: number; forwardSpeed: number; altitude: number; verticalSpeed: number;
  pressure: number; gas: number; reserve: number; thrust: number; liftThrust: number;
  longitudinalG: number; lateralG: number; loadG: number; steer: number;
  x: number; z: number; heading: number; pitch: number; roll: number;
  contact: number; slip: number; downforce: number; energy: number;
  armed: boolean; flying: boolean; assist: boolean; fan: boolean; variant: Variant;
  gear: 'D' | 'R' | 'N'; damage: number; elapsed: number; blocked: string;
}
