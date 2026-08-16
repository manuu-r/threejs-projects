# Luma Lamp Lab

Luma is a browser-based control and behavior prototype for an expressive articulated character lamp. The experience runs at `/lamp` and keeps camera, landmark, microphone, and music analysis on the user's device.

## Runtime architecture

- `LampLab.tsx` owns the Three.js scene, local MediaPipe hand/face tracking, procedural animation, local audio analysis, voice/clap input, recording, and the UI.
- `gestureEngine.ts` contains pure gesture classification, wave detection, two-bone IK, joint limits, and the debounced behavior state machine.
- `behaviorPack.ts` creates a dependency-free ZIP containing mappings, animation names, light settings, safety parameters, the GLB, and a physical-controller configuration foundation.
- `public/lamp/luma-character-lamp.glb` is the web model. Named transform nodes are `LampRoot`, `BaseYaw`, `Shoulder`, `Elbow`, `HeadPitch`, and `HeadYaw`.
- `art/lamp/luma-character-lamp.blend` is the editable source. The exact user-adjusted visual placement is backed up at `art/lamp/luma-character-lamp.user-placement.blend`.

## Gesture safety

Recognition uses a confidence floor and per-gesture hold duration before an action fires. A gesture remains debounced until it changes or disappears. Open palm is the intentionally fast emergency freeze, while movement, sleep, and proximity commands require longer confirmation.

## Physical lamp handoff

The downloaded behavior pack is transport-agnostic. `board-config.json` provides joint limits, update rate, smoothing, and emergency-stop behavior; a later hardware adapter can translate these normalized behavior commands to PWM servo targets or another board transport. Mechanical limits and collision constraints must still be validated on the physical assembly before energizing motors.

## Model source

The base asset is **Desk Lamp Arm 01** by Kuutti Siitonen and Yann Kervran from Poly Haven, licensed CC0. Luma adds the character face, emissive lighting, materials, hierarchy, and animation pivots used by this prototype.
