import type { TrackCollisionJson, TrackSample } from '../types';

export interface SpawnPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Grid boxes sit this many samples behind the start line. */
const SPAWN_BACK_SAMPLES = 3;

/**
 * Runtime view of track-collision.json — the dense centerline the Blender
 * builder meshed from. Physics, checkpoints, respawn and the minimap all read
 * from this one array so they can never drift from the visuals.
 */
export class TrackData {
  readonly json: TrackCollisionJson;

  private constructor(json: TrackCollisionJson) {
    this.json = json;
  }

  static async load(url = '/assets/track-collision.json'): Promise<TrackData> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`track data ${res.status} ${url}`);
    const json = (await res.json()) as TrackCollisionJson;
    if (json.version !== 1) throw new Error(`unsupported track version ${json.version}`);
    if (!Array.isArray(json.samples) || json.samples.length < 8) {
      throw new Error('track samples missing or too short');
    }
    return new TrackData(json);
  }

  get name(): string {
    return this.json.name;
  }

  get samples(): TrackSample[] {
    return this.json.samples;
  }

  get count(): number {
    return this.json.samples.length;
  }

  get spacing(): number {
    return this.json.spacing;
  }

  get lapLengthM(): number {
    return this.spacing * this.count;
  }

  /**
   * Grid position and heading (yaw around +Y, forward = tangent). A few samples
   * BEHIND the start line — like a real grid box — so the first forward pass
   * over gate 0 is a real crossing event that arms the lap timer.
   */
  spawnPose(): SpawnPose {
    const n = this.count;
    const idx = ((this.json.startSampleIndex - SPAWN_BACK_SAMPLES) % n + n) % n;
    const s = this.samples[idx] ?? this.samples[0]!;
    return {
      x: s.p[0],
      y: s.p[1],
      z: s.p[2],
      // Forward is +Z rotated by yaw; tangent t already encodes it.
      yaw: Math.atan2(s.t[0], s.t[2]),
    };
  }

  /**
   * Nearest centerline sample index to (x, z). With a hint (last known index)
   * only a window around it is searched — O(1) per step instead of O(n).
   */
  nearestSample(x: number, z: number, hint = -1, window = 32): number {
    const n = this.count;
    if (hint >= 0 && hint < n) {
      let best = -1;
      let bestD = Infinity;
      for (let k = -window; k <= window; k++) {
        const i = (hint + k + n) % n;
        const p = this.samples[i]!.p;
        const dx = p[0] - x;
        const dz = p[2] - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    }
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const p = this.samples[i]!.p;
      const dx = p[0] - x;
      const dz = p[2] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
}
