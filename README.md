# Kinetiq Punch Lab

A browser-based 3D heavy-bag experience built with Three.js, cannon-es and
MediaPipe Hand Landmarker.

## Run locally

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, choose **Start camera**, place both hands side by
side and hold two thumbs up. Calibration maps the hands' midpoint, separation
and depth to the bag position and scale. Punch with an open palm or closed fist.

Without a camera, choose **Practice without camera**, swipe/tap the bag, or use
`J`, `K`, or `Space`.

## Implementation

- Three.js WebGL gym, HDR reflections, PBR bag and rendered landmark hands
- cannon-es rigid body, cylinder collider and point-to-point hanging constraint
- 42 kg reference mass, linear/angular damping, low restitution and rubber friction
- MediaPipe's 21 landmarks per hand, on-device inference and mirrored overlay
- knuckle-center velocity, proximity/approach gating and off-centre impulses
- spatial Web Audio impact thump, particles and transient bag squash
- keyboard, pointer and reduced-motion accessibility fallbacks

The camera stream stays in the browser. It is not recorded or uploaded.

## Asset sources

The locally bundled environment assets are public-domain CC0 works from
[Poly Haven](https://polyhaven.com/):

- **Machine Shop 02** HDRI by Sergej Majboroda
- **Rubber Tiles** material by Amal Kumar

The hand landmarker model is the official MediaPipe model distributed by
Google. The generated `public/og.png` is used only as the site's social preview.

## Verification

```bash
npm run build
npm run lint
npx tsc --noEmit
npm test
```
