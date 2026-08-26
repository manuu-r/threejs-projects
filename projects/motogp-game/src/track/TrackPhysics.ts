import { SURFACES } from '../config';
import type { PhysicsWorld } from '../core/physicsWorld';
import { setYawQuat } from '../core/jolt';
import type { TrackData } from './TrackData';

/** Asphalt patch half-length: sample spacing + overlap so seams can never gap. */
const ASPHALT_OVERLAP_M = 0.35;
const ASPHALT_HALF_THICKNESS = 0.05;

/** One barrier segment per N samples (visual chunks are 8 m; physics 16 m). */
const BARRIER_STEP_SAMPLES = 4;
const BARRIER_HALF_WIDTH = 0.12;
const BARRIER_HALF_HEIGHT = 0.6;
const BARRIER_CENTER_Y = 0.55;
const BARRIER_OVERLAP_M = 0.25;

/**
 * Static collision for the circuit, built from the same dense samples the
 * visuals were meshed from:
 *   - one big grass box under everything,
 *   - an oriented asphalt box per centerline sample (top face at y=0),
 *   - barrier boxes both sides every few samples.
 * All restitution 0 — dead bounces feel better than lively ones.
 */
export function buildTrackPhysics(world: PhysicsWorld, track: TrackData): void {
  const { Jolt } = world;

  // Grass base covering the whole circuit (circuit radius ≈ 600 m).
  world.addStaticBox(
    { x: 1600, y: 1, z: 1600 },
    { x: 0, y: -1, z: 0 },
    { friction: SURFACES.grassFriction, restitution: 0 },
  );

  // One owned quaternion, re-oriented per body. NEVER use static factories
  // (sRotation) here — they alias a shared WASM temp and destroy()ing them
  // corrupts the heap (see jolt.ts memory rules).
  const yawQuat = new Jolt.Quat(0, 0, 0, 1);
  try {
    // Asphalt ribbon.
    for (const s of track.samples) {
      setYawQuat(yawQuat, Math.atan2(s.t[0], s.t[2]));
      world.addStaticBox(
        {
          x: s.hw,
          y: ASPHALT_HALF_THICKNESS,
          z: track.spacing / 2 + ASPHALT_OVERLAP_M,
        },
        { x: s.p[0], y: -ASPHALT_HALF_THICKNESS, z: s.p[2] },
        { friction: SURFACES.asphaltFriction, restitution: 0, rotationQuat: yawQuat },
      );
    }

    // Barriers both sides.
    const halfLen = (track.spacing * BARRIER_STEP_SAMPLES) / 2 + BARRIER_OVERLAP_M;
    const samples = track.samples;
    for (let i = 0; i < samples.length; i += BARRIER_STEP_SAMPLES) {
      const s = samples[i];
      if (!s) break;
      setYawQuat(yawQuat, Math.atan2(s.t[0], s.t[2]));
      for (const offset of [s.bl, -s.br]) {
        world.addStaticBox(
          { x: BARRIER_HALF_WIDTH, y: BARRIER_HALF_HEIGHT, z: halfLen },
          {
            x: s.p[0] + s.n[0] * offset,
            y: BARRIER_CENTER_Y,
            z: s.p[2] + s.n[2] * offset,
          },
          { friction: SURFACES.barrierFriction, restitution: 0, rotationQuat: yawQuat },
        );
      }
    }
  } finally {
    Jolt.destroy(yawQuat);
  }

  world.optimizeBroadPhase();
}
