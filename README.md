# Punch Challenge

A browser-based 3D heavy-bag experience built with Three.js, cannon-es and
MediaPipe Hand Landmarker.

## Run locally

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, choose **Start camera**, keep both hands visible,
then hold two thumbs up. Calibration maps the hands'
midpoint, separation and depth to the bag position and scale. Punch with an
open palm or closed fist.

Camera hand tracking is required. Mouse, touch and keyboard strikes are
intentionally disabled so every score comes from a tracked punch.

## Implementation

- Three.js WebGL gym, HDR reflections, PBR bag and rigged human hand meshes
- cannon-es rigid body, cylinder collider and point-to-point hanging constraint
- 42 kg reference mass, linear/angular damping, low restitution and rubber friction
- MediaPipe's 21 hand and 33 pose landmarks, on-device inference and mirrored overlay
- whole-hand plus wrist–elbow forearm velocity, proximity/approach gating and off-centre impulses
- spatial Web Audio impact thump, particles and transient bag squash
- camera-only gesture input with no pointer or keyboard scoring path

The camera stream stays in the browser. It is not recorded or uploaded.

## Asset sources

The locally bundled environment assets are public-domain CC0 works from
[Poly Haven](https://polyhaven.com/):

- **Machine Shop 02** HDRI by Sergej Majboroda
- **Rubber Tiles** material by Amal Kumar

The rigged left/right hand meshes come from the Immersive Web
`@webxr-input-profiles/assets` generic-hand profile and are distributed under
the MIT license.

The hand and pose landmarker models are the official MediaPipe models
distributed by Google.

## Verification

```bash
npm run build
npm run lint
npx tsc --noEmit
npm test
```
