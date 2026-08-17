# Lamp

This is a browser-based control and behavior prototype for an expressive articulated character lamp. The experience runs at `/lamp` and keeps camera, landmark, microphone, and music analysis on the user's device.

## Runtime architecture

- `LampLab.tsx` owns the Three.js scene, local MediaPipe hand/face tracking, procedural animation, local audio analysis, voice/clap input, recording, and the UI. Its camera view reuses Punch Power's exact sculpted Three.js face-mask renderer.
- `gestureEngine.ts` contains pure gesture classification, wave detection, two-bone IK, joint limits, and the debounced behavior state machine.
- `behaviorPack.ts` creates a dependency-free ZIP containing mappings, animation names, light settings, safety parameters, the GLB, and a physical-controller configuration foundation.
- `public/lamp/character-lamp.glb` is the web model. Named transform nodes include `LampRoot`, `BaseYaw`, `Shoulder`, `Elbow`, `HeadPitch`, `HeadYaw`, `DriveWheelLeft`, `DriveWheelRight`, and `CasterWheel`. The three wheels roll with the lamp's persistent, damped forward/back movement.
- The editable Blender source and placement backups live in `art/lamp/`.
- Eye blinks drive both eye and pupil meshes through the same eased squash and opacity fade, so no pupil remains visible after the eyelids close.
- The lamp stays visibly on through a head-tracked warm spotlight, bulb halo, and floor spill; sleep reduces these effects without switching them off. The light is intentionally atmospheric without a visible projection cone.
- The head-pitch axis is seated in a dedicated steel neck axle with brass retaining collars, keeping the head visually connected through its full pitch movement.
- Eyebrow expressions are additive to the rotations authored in Blender, so idle and animated poses retain the exact imported eyebrow alignment.

## Gesture safety

Recognition uses a confidence floor and per-gesture hold duration before an action fires. A gesture remains debounced until it changes or disappears. Open palm is the intentionally fast emergency freeze, while movement, sleep, and proximity commands require longer confirmation.

## Physical lamp handoff

The downloaded behavior pack is transport-agnostic. `board-config.json` provides joint limits, update rate, smoothing, and emergency-stop behavior; a later hardware adapter can translate these normalized behavior commands to PWM servo targets or another board transport. Mechanical limits and collision constraints must still be validated on the physical assembly before energizing motors.

## Model source

The base asset is **Desk Lamp Arm 01** by Kuutti Siitonen and Yann Kervran from Poly Haven, licensed CC0. This project adds the character face, emissive lighting, materials, hierarchy, and animation pivots used by the prototype.
