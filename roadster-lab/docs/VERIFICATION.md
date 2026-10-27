# Verification record

Updated 17 October 2026 in the separate `roadster-lab/` project.

## Completed checks

- `npm run test`: **44 passing automated checks**, covering the real cannon-es simulation and actual Three.js GLTF parsing, not a mocked vehicle.
- `npm run build`: TypeScript checking and Vite production compilation succeed. The static build includes the cockpit asset, research, favicon, application code and styles.
- The development page at `http://127.0.0.1:5178/` returned HTTP 200. The cockpit GLB and research document also returned HTTP 200; the current model is approximately 8.1 MB, with a separately bundled 1.4 MB HDR lighting map.
- The local preview server is running on port 5178. It was handed to the app's native browser panel; no computer-control interaction is required to play manually.
- Blender successfully exported the original model and rendered driver/exterior checks. The saved scene inspection confirmed the authored Roadster scene and its objects/materials. Both rendered images were inspected and the model was refined for cockpit sightlines, display visibility, glazing, wheel hardware and body detail.
- The detailed source study remains in `docs/RESEARCH.md`. Published `public/notes.md` is checked for substantive simulation documentation, the selected parameters, primary engineering references and absence of manufacturer/vehicle branding.
- The project has an independent lockfile. Dependency resolution and lockfile preparation completed using the already-available package metadata; no additional production service is required.

## What the tests prove

### Vehicle and gas dynamics

The tests integrate throttle, braking, steering, drive/neutral/reverse, coasting, drag, suspension equilibrium and solid barrier response. They verify that wet tires without fan assistance stop over a greater distance than dry tires. They cover low-speed fan downforce and airborne crosswind drift. A banked free-fall check prevents a misleading one-g load reading when the body is rotated.

Gas tests verify impulse/mass conservation, decreasing pressure, finite usable reserve and cutoff. Performance and safed configurations cannot generate rear thrust. Reverse and brake interlocks inhibit it. Useful propulsion reduces the gas mass and vehicle mass. The local inertia remains tied to the shape and mass rather than incorrectly changing with a world-rotated bounding box.

Flight tests verify engagement conditions, takeoff, a stable brief hover, absence of tire contact while airborne, forward/lateral/yaw signs relative to the pilot view, manual rotational persistence, consumption of gas for torque, and the loss of lift authority on depletion. Reset clears accumulated input, velocity, damage, flight state and depleted reservoir.

### Lessons and demonstration

All seven exercises are completed by actual control inputs passed through the dynamics model and the same lesson evaluator used by the game. The tests do not set the car at its success location or directly mark an exercise complete. In particular:

- The braking driver holds about 100 km/h and stops in the defined box.
- The slalom driver follows all five gates in order under physical steering.
- The impulse driver supplies the minimum rear impulse and brakes to a stop.
- Hover, translation and manual yaw exercises finish with ground contact and useful gas remaining.
- Waiting at the start, skipping a gate, failing to restore assistance, and entering the brake box at excessive speed cannot falsely pass.
- The demonstration physically accelerates and brakes, explicitly resets between its two exercises, then lifts, yaws and lands without damage and with reserve remaining.

### Asset and camera integrity

The portable asset is parsed by the actual Three.js GLTF loader. The tests check finite geometry and sensible overall dimensions, required movable wheel/yoke roots, and the display nodes. The seated 64-degree widescreen camera projects the yoke and all three display centers inside the image; the primary display aligns with the driver and the center touchscreen appears to the right. A forward ray intersects no opaque cabin geometry (exterior glazing is hidden in the pilot view). The lower numerical portions of both forward screens are also checked for occlusion. The revised asset is checked for its low roof, four outlets in one horizontal row, and independently preserved aero and brake pivots.

The same static-mesh batching function used at runtime is tested for a substantial draw-call reduction while preserving model bounds, forward sightlines, passenger-seat nodes and animation pivots.

## Verification limits

The running browser application reported successful WebGL rendering, no graphics error and no context loss. Its local development self-check exercised the generated lesson list, controls/settings/research panels, lesson start, gear and camera selection, live telemetry, pause/resume input state and Rocket controls. Every reported boolean check passed. This uses the app's own code and renderer, without desktop capture or browser-control tools. The report and its own rendered canvases are saved under the ignored `output/` directory.

The revised model's actual in-game cockpit, front three-quarter and rear three-quarter renders were inspected. They show the same exported geometry and materials used by the simulation. A separate center-screen export verifies the vehicle thumbnail and pressure/impulse readouts. The latest self-check reported roughly 260 scene draw calls and fewer than 700,000 rendered triangles after runtime batching; these are workload counts, not a frame-rate guarantee. Blender studio images are independently labeled asset renders.

Physical gamepad and touch devices were not tested. Internal browser checks do not prove every possible sequence of user interaction, and no external computer-control input was used, following the user's restriction. Keyboard/gamepad/touch mappings, focus handling, settings and CSV export compile and were reviewed in source.

No claim of measured real-Roadster behavior is made. No production vehicle CAD, tire curves, controller source, thrust curve, certified flight envelope or detailed tank hardware was available. The report and settings expose the chosen assumptions, including the large hypothetical reservoir and short endurance. Distant mountains are scenery; the physical training surfaces are the flat proving ground, collision perimeter and reachable apron buildings. This is a physically coherent educational reconstruction, rather than a validated engineering or driver-certification model.


## Cockpit-first and unbadged revision

Four added physical checks verify immediate rear-thrust access in simple mode, one-command lift with automatic touchdown and reserve remaining, steering-to-yaw mapping with rear thrust inhibited in flight, and the ability to command descent even after reserve falls below the takeoff threshold. The complete suite contains 44 checks.

The app's internal browser self-check now also verifies one-click experience setup, hidden advanced system rail, hidden external telemetry/coach panels and reset retaining the simplified mode. It checks the generated interface for manufacturer/full-vehicle names. The running renderer reports whether the auxiliary display is hidden in simple mode. These checks use application code and its own scene, without computer-control tools.

The scene and current public build were regenerated from the authoring sources after the final body/cabin adjustments. Public vehicle geometry is `assets/vehicle.glb`, the editable local source is `art/prototype-source.blend`, and neither the private reference photographs nor the source-specific research report is included in the published runtime.
