# Lamp

This is a browser-based control and behavior prototype for an expressive articulated character lamp. The experience runs at `/lamp` and keeps camera, landmark, and music analysis on the user's device.

## Runtime architecture

- `LampLab.tsx` owns the Three.js scene, local MediaPipe hand/face tracking, procedural animation, local music analysis, recording, and the UI. Its camera view reuses Punch Power's exact sculpted Three.js face-mask renderer.
- `gestureEngine.ts` contains pure gesture classification, two-bone IK, joint limits, and the debounced behavior state machine.
- `hopPhysics.ts` contains the deterministic projectile motion used for short forward/back hops, plus a four-stage spring cycle: deep whole-arm compression, launch snap, airborne counter-swing, and a damped landing rebound.
- `behaviorPack.ts` creates a dependency-free ZIP containing mappings, animation names, light settings, safety parameters, the GLB, and a physical-controller configuration foundation.
- `public/lamp/character-lamp.glb` is the web model, rebuilt from the downloaded Luxo rig as a clean rigid-pivot hierarchy. Named transform nodes include `LampRoot`, `BaseYaw`, `Shoulder`, `Elbow`, `HeadPitch`, and `HeadYaw`. Four rubber contact pads ground the wheel-free base, while forward/back travel uses a constant-horizontal-speed ballistic arc with gravity and an exact landing time.
- The editable generated source is `art/lamp/luxo-character-lamp-v2.blend`; the downloaded archive, extracted source, reproducible build script, and pre-replacement backup also live in `art/lamp/`.
- Eye blinks drive both eye and pupil meshes through the same eased squash and opacity fade, so no pupil remains visible after the eyelids close.
- The lamp's bulb, beam, halo, and floor spill are switched off. Neutral studio lighting keeps the character and its mechanical joints clearly readable without making the shade look illuminated.
- Loaded music drives coordinated whole-lamp choreography from local bass energy: damped head-bangs, alternating gaze and roll accents, base sway, shoulder/elbow counter-motion, and bass compression. Strong beats occasionally trigger an in-place peace-sign hop using the same ballistic spring and whole-arm counter-swing as gesture movement.
- The shoulder, elbow, and head controllers are centered on the evaluated visible bearings. The head-pitch axis is seated in a dedicated steel neck axle with brass retaining collars, keeping the head visually connected through its full movement envelope.
- At load time, the runtime aligns the base-to-elbow axis away from the viewer so the elbow sits visually behind the lamp. It then derives the head's true direction from its eye and pupil geometry, turns the neck toward the viewer, and uses that same basis for the light direction.
- The initial presentation is an unlit upright task-lamp stance: the lower arm rises from the base, the elbow remains clearly readable behind it, and the upper arm reaches diagonally into a deeply downward-facing shade. The eyes close while dormant; the first real hand gesture or response preview wakes the expression and aligns the lamp for interaction. Face-only tracking cannot wake it accidentally.
- Mirrored hand following uses a widened, bounded motion envelope: roughly 100° of base travel, 104° of combined head pitch, 120° of head yaw, and a larger two-bone reach response for high, low, near, and far palm positions.
- The browless face uses layered graphite eye rims, warm sclera, teal irises, deep pupils, and amber catchlights. Gaze direction and full-eye blinking carry the expression without eyebrow geometry.

## Gesture safety

Recognition uses a confidence floor and per-gesture hold duration before an action fires. A gesture remains debounced until it changes or disappears. Open palm is the intentionally fast emergency freeze, while movement, sleep, and proximity commands require longer confirmation.

## Physical lamp handoff

The downloaded behavior pack is transport-agnostic. `board-config.json` provides joint limits, update rate, smoothing, and emergency-stop behavior; a later hardware adapter can translate these normalized behavior commands to PWM servo targets or another board transport. Mechanical limits and collision constraints must still be validated on the physical assembly before energizing motors.

## Model source

The downloaded base is **Luxo Jr. Rig**, uploaded by **aiden915** on Sketchfab and credited there to **pistiwique**, licensed CC BY 4.0. The initially referenced `kadejanes6410` listing is recorded separately because the downloaded archive came from the `aiden915` listing. This project adds a browless layered-eye character face, a pearl-blue and champagne material palette, rigid web animation pivots, connected neck hardware, wheel-free contact pads, and local gesture/music behavior. The bulb remains off.
