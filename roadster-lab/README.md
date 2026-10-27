# Cockpit — Prototype Driving Experience

An independent, unbadged first-person vehicle experience built with Three.js and cannon-es. The project is isolated in this subfolder, with its own dependency lockfile, original Blender geometry, physics, optional lessons and documentation.

Choose **Start driving** for simple controls, or **Take a cockpit ride** for a physics-driven demonstration from the driver's seat. The dashboard shows speed and thrust reserve. Detailed systems and training exercises remain in the Lessons menu.

## Play

Use Node.js 22.13 or newer:

```sh
cd /Users/manu/Dev_stuff/threejs-fun/roadster-lab
npm ci
npm run dev
```

Open **http://127.0.0.1:5178/**. The existing parent dependencies also resolve in this workspace. `npm ci` makes the subfolder independent when copied elsewhere.

| Simple control | Action |
| --- | --- |
| W / S or up / down | Accelerate / brake |
| A / D or left / right | Steer; turn during assisted flight |
| Space | Hold for rear thrust on the ground |
| H | Brief assisted lift; press again to land sooner |
| Drag | Look around the cabin; orbit in exterior view |
| C / V | Change camera / recenter |
| R | Start a fresh drive with full reserve |
| P / Escape | Pause |

The simple mode configures arming, fan and stabilization automatically. Slow below approximately 20 km/h before lifting. Height is assisted to roughly 1.15 m; landing is commanded after 2.5 seconds or when reserve is needed for descent. This convenience uses the same physical forces and finite gas reservoir as training. It does not move the body by directly setting its position.

Keyboard, standard gamepad and touch controls are supported. In simple mode, gamepad triggers operate the pedals, left stick steers/turns, A supplies thrust, Y requests lift, X changes camera and Menu pauses. Touch exposes pedals, steering, thrust and lift.

## Build and verify

```sh
npm run test
npm run build
npm run preview
```

The production preview uses **http://127.0.0.1:4178/**. Serve `dist/` over HTTP; opening its index directly from the filesystem will not correctly load modules/assets. The build is self-contained and uses no account, backend, camera, microphone, location, analytics or external media service. Progress is saved locally when browser storage is available.

There are 44 automated checks covering physical trajectories, all seven lessons, beginner assistance, finite reserve, landing, collisions, camera visibility, model loading and brand-neutral published notes. See [docs/VERIFICATION.md](docs/VERIFICATION.md) for evidence and limits.

## What changed in the cockpit-first revision

- Joined body surfaces, broad shoulders and nose, curved dark canopy, flush light covers, larger five-blade rims, recessed rear outlets and blower/diffuser hardware.
- Formed window pillars, charcoal headliner, white yoke surround, unbadged center pad, gray door trim and subdued red accents.
- Embedded speed readout and central control screen in simple mode; the auxiliary flight display appears in training mode.
- Small controls strip, contextual help, one-click entry and a seated demonstration.
- Smoothed acceleration cues, spatial road vibration, gentle speed-dependent field of view, EV harmonics, airflow, road noise and gas hiss.
- Visible manufacturer names, full vehicle names and badges removed. Source-specific research and attribution are retained privately in `docs/`; the published app uses neutral [simulation notes](public/notes.md).

The geometry follows visible design relationships and inferred dimensions. It is an original reconstruction, rather than manufacturer CAD. Flight mappings, nozzle behavior and deployment timing are illustrative assumptions.

## Optional training

Seven exercises cover orientation, precision braking, slalom/grip, rear impulse, hover/landing, flight translation and manual attitude recovery. Each includes a briefing, objectives, feedback, scoring and a telemetry export.

Training configurations are labeled **Road**, **Boost** and **Flight**. F arms gas, Space supplies rear thrust, H engages flight/commands landing, L changes stabilization, Z/X yaws and E/Q changes altitude or collective. These extra controls are available in training, rather than being required for the main experience.

For precision braking, approach at about 100 km/h, ease the accelerator to hold that speed, then brake at the amber line. Full throttle to the braking line enters much too fast. For slalom, keep inputs small and look through the next gate.

## Physical model

The engine advances a rigid body with four raycast suspension wheels at 120 fixed steps per second. It includes power/traction limits, combined tire forces, braking, rolling resistance, drag relative to wind, suction downforce, speed-dependent aero load and physical barriers/buildings. Wet conditions lower grip.

Gas consumption follows delivered impulse and assumed exhaust velocity. Reservoir pressure decreases with an idealized adiabatic blowdown law; a simplified regulator fades near cutoff. Changing gas mass changes vehicle mass and inertia. Lift and attitude correction share the same finite reservoir, and depletion leaves gravity active.

Initial mass is 1,800 kg, with 180 kg gas; effective exhaust velocity is 650 m/s, full/cutoff pressure 300/35 bar, rear force 22 kN, maximum lift 33 kN and usable impulse about 91.8 kN·s. All are simulation assumptions. The ideal-air storage implication is approximately 505 litres at 293 K, before vessel walls or plumbing; packaging feasibility is not established.

This is not a calibrated production-vehicle model. It omits measured tire curves, flexible-body deformation, biomechanics, detailed fluid dynamics, thermal tank behavior and certified controllers. Distant mountains are scenery; the flat proving ground, perimeter and reachable buildings are the principal collision surfaces.

## Implementation

| Files | Responsibility |
| --- | --- |
| `src/Physics.ts`, `src/TireVehicle.ts`, `src/config.ts` | Dynamics, finite gas, suspension and tuning |
| `src/Experience.ts`, `src/Runtime.ts`, `src/Demo.ts` | Beginner assistance, sessions and demonstration |
| `src/Cockpit.ts`, `src/modelOptimization.ts` | Camera, model, instruments, mirror, plumes and batching |
| `src/lessons.ts`, `src/World.ts` | Optional lessons and proving ground |
| `src/Input.ts`, `src/Audio.ts` | Inputs and procedural audio |
| `src/main.ts`, `src/styles.css` | Menus and minimal driving interface |
| `art/build_cockpit.py`, `art/exterior_shell.py` | Reproducible original Blender authoring |
| `public/assets/vehicle.glb` | Portable vehicle mesh |
| `public/notes.md` | Published simulation notes |
| `docs/RESEARCH.md`, `docs/ASSET-SOURCES.md` | Private source study and provenance |

The local `TireVehicle` subclass corrects a cannon-es 0.20 straight-line skid-limit edge case without modifying installed dependencies. The wet-braking regression test exercises that correction.

The local development self-check exports only this application's own rendered canvas and generated UI state under the ignored `output/` directory. It does not observe or control desktop/browser UI. It is excluded from production builds.
