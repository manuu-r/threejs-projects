#!/usr/bin/env node
/**
 * Generate art/motogp/track.json — the CANONICAL track definition consumed by the
 * Blender builder (tools/blender/build_track.py).
 *
 * Layout: star-shaped (polar) control points around the origin, ordered by
 * increasing angle — guaranteed non-self-intersecting. Radius variation creates
 * corners; scale is chosen so lap length lands ≈ 2.5 km.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ART_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// [angleDeg, radiusM, halfWidthM | null, curb: 'none'|'left'|'right'|'both']
// Radii are pre-scale; SCALE 1.15 splines out to a ≈3.4 km lap (Blender reports
// the exact resampled length).
const SCALE = 1.15;
const ANCHORS = [
  //        θ      r     hw   curbs
  [0, 494, null, 'none'], // start/finish straight
  [18, 494, null, 'none'],
  [36, 443, null, 'both'], // T1 braking entry
  [54, 345, null, 'both'], // T1 apex (fast right)
  [72, 380, null, 'right'],
  [90, 466, null, 'none'],
  [108, 500, null, 'none'], // kink
  [126, 512, null, 'left'], // T4 entry
  [144, 403, null, 'both'], // T4 braking
  [162, 288, null, 'both'], // T5 hairpin apex
  [180, 264, null, 'both'], // hairpin exit
  [198, 345, null, 'right'],
  [216, 443, null, 'none'], // esses L
  [234, 391, null, 'both'], // esses R
  [252, 322, null, 'both'], // T8 tight left
  [270, 368, null, 'none'],
  [288, 460, null, 'none'], // fast sweeper
  [306, 495, 8.5, 'none'], // back straight
  [324, 512, null, 'left'], // final carousel entry
  [342, 500, null, 'left'], // carousel onto main straight
];

const DEFAULT_HALF_WIDTH = 7.0;

function round(v, digits = 2) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

const points = ANCHORS.map(([deg, r, hw, curb]) => {
  const a = (deg * Math.PI) / 180;
  const radius = r * SCALE;
  return {
    p: [round(Math.cos(a) * radius), 0, round(Math.sin(a) * radius)],
    hw: hw ?? DEFAULT_HALF_WIDTH,
    curb,
  };
});

// Sanity: closed-loop length estimate from control points (lower bound on real length).
let chordSum = 0;
for (let i = 0; i < points.length; i++) {
  const a = points[i].p;
  const b = points[(i + 1) % points.length].p;
  chordSum += Math.hypot(b[0] - a[0], b[2] - a[2]);
}

const out = {
  version: 1,
  name: 'Circuito Verde GP',
  closed: true,
  units: 'meters',
  spline: 'catmullrom-uniform',
  resampleSpacingM: 4.0,
  defaultHalfWidthM: DEFAULT_HALF_WIDTH,
  defaultBarrierOffsetM: 3.5,
  checkpoints: 8,
  points,
};

mkdirSync(ART_ROOT, { recursive: true });
writeFileSync(join(ART_ROOT, 'track.json'), JSON.stringify(out, null, 2) + '\n');

console.log(`wrote art/motogp/track.json: ${points.length} anchors, control-polygon ≈ ${Math.round(chordSum)} m`);
console.log('note: Blender reports the exact splined/resampled lap length.');
