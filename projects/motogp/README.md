# MotoGP Time Trial

A Three.js and Jolt Physics time-trial experiment mounted at `/motogp`.

## Structure

- `MotoGpGame.tsx` owns the React lifecycle for the game canvas.
- `GameRuntime.ts` bootstraps physics, track loading, rendering, HUD, and input.
- `public/motogp/` holds the runtime GLB and collision assets.
- `art/motogp/` holds the source track definition and Blender generators.
- `track/TrackAtmosphere.ts` preserves named ad slots; legacy generated placements stay disabled until safe sockets are authored on the supplied venue.

## Supplied 3D assets

- `ducati-rider-game-rig.glb` is the Blender-authored Ducati, rider, cockpit
  hands, and rearsets used at runtime. Only the final game-rig hierarchy is
  exported; studio floors and legacy rider/bike iterations are excluded.
- `nurburgring-gp.glb` is the visible circuit venue.
- `nurburgring-asphalt-collision.json` supplies the authored road collision,
  while `track-collision.json` supplies the timing/checkpoint centreline.

The neutral ad slots are generated in code. Before a
commercial release, confirm the licences for every downloaded model and clear
the use of rider names, number treatments, team liveries, and sponsor marks.
`TRACKSIDE_AD_SLOTS` is intentionally data-driven so paid creative can replace
the placeholders later without changing placement code.

## Asset regeneration

From the repository root:

```bash
node art/motogp/tools/gen-track.mjs
blender --background --factory-startup --python art/motogp/tools/blender/build_bike.py
blender --background --factory-startup --python art/motogp/tools/blender/build_track.py
```

The generated files are written directly to `public/motogp/`.
