import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://punch-lab.test/punch-power", {
      headers: { accept: "text/html", host: "punch-lab.test" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the finished punch challenge", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Punch Challenge · Three\.js Fun<\/title>/i);
  assert.match(html, /YOUR HANDS\./);
  assert.match(html, /REAL IMPACT\./);
  assert.match(html, /START CAMERA/);
  assert.doesNotMatch(html, /PRACTICE WITHOUT CAMERA|swipe to test|manual sparring/i);
  assert.match(html, /HAND \+ MASK TRACKING/);
  assert.match(html, /3D FACE POSE \+ BLINK \+ JAW \/ LIVE/);
  assert.doesNotMatch(html, /FOREARM|ELBOW|SHOULDER/i);
  assert.match(html, /FIRST 20 TO SCORE/);
  assert.match(html, /1501 N/);
  assert.match(html, /1 YEAR OF/);
  assert.match(html, /SPARCD FREE/);
  assert.match(html, /AT LAUNCH/);
  assert.match(html, />Follow<\/a>/);
  assert.match(html, /twitter-follow-button/);
  assert.match(html, /data-show-screen-name="false"/);
  assert.match(html, /https:\/\/platform\.x\.com\/widgets\.js/);
  assert.match(
    html,
    /https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-F5WCNFZYZW/,
  );
  assert.match(html, /gtag\('config', 'G-F5WCNFZYZW'\)/);
  assert.match(html, /data-testid="start-camera"/);
  assert.doesNotMatch(html, /KINETIQ|THREE\.JS \/ CANNON-ES/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Building your site/i);
});

test("ships the local tracking model and visual assets", async () => {
  const packageJson = await readFile(new URL("package.json", projectRoot), "utf8");
  assert.match(packageJson, /"three"/);
  assert.match(packageJson, /"cannon-es"/);
  assert.match(packageJson, /"@mediapipe\/tasks-vision"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await Promise.all([
    access(new URL("public/mediapipe/models/hand_landmarker.task", projectRoot)),
    access(new URL("public/mediapipe/models/pose_landmarker_lite.task", projectRoot)),
    access(new URL("public/mediapipe/models/face_landmarker.task", projectRoot)),
    access(new URL("public/assets/machine_shop_02_1k.hdr", projectRoot)),
    access(new URL("public/assets/rubber_tiles_diff_1k.jpg", projectRoot)),
    access(new URL("public/assets/hands/left.glb", projectRoot)),
    access(new URL("public/assets/hands/right.glb", projectRoot)),
  ]);
  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});

test("keeps punching camera-only", async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL("projects/punch-power/PunchLab.tsx", projectRoot), "utf8"),
    readFile(new URL("projects/punch-power/styles.css", projectRoot), "utf8"),
  ]);

  assert.doesNotMatch(
    component,
    /manualPunch|onPointerDown|onPointerUp|addEventListener\(["']keydown|DEFAULT_CALIBRATION/,
  );
  assert.match(component, /const HAND_SIZE_GAIN = 1\.4/);
  assert.match(component, /className="x-follow-logo"/);
  assert.match(component, />\s*𝕏\s*<\/span>/);
  assert.match(component, /Left and right hands showing thumbs up/);
  assert.match(component, /gesture-hand-left/);
  assert.match(component, /PoseLandmarker\.createFromOptions/);
  assert.match(component, /FaceLandmarker\.createFromOptions/);
  assert.match(component, /drawDeadpoolMask/);
  assert.match(component, /createFaceMaskRenderer/);
  assert.match(component, /outputFaceBlendshapes: true/);
  assert.match(component, /outputFacialTransformationMatrixes: true/);
  assert.match(component, /leftEyeOpenBaseline/);
  assert.match(component, /landmarkDistance\(386, 374\)/);
  assert.match(component, /faceLeftBlink/);
  assert.match(component, /className="face-mask-layer"/);
  assert.match(component, /\/audio\/x-gon-give-it-to-u\.mp3/);
  assert.match(component, /const BACKGROUND_MUSIC_VOLUME = 0\.08/);
  assert.match(component, /Mute music and impacts/);
  assert.match(component, /startFallbackMusic/);
  assert.match(component, /musicBus\.gain\.linearRampToValueAtTime\(0\.18/);
  assert.match(component, /setPoseResult: updatePose/);
  assert.doesNotMatch(component, /upperArm/);
  assert.doesNotMatch(component, /armGroups|armSurfaces/);
  assert.match(component, /GLTFLoader/);
  assert.match(component, /\/assets\/hands\/left\.glb/);
  assert.doesNotMatch(component, /const armConnections|FOREARMS DETECTED|Keep both elbows/);
  assert.match(styles, /\.arena-canvas\s*\{[^}]*pointer-events:\s*none;/s);
  assert.match(styles, /\.stats-rail\s*\{[^}]*transform:\s*scale\(1\.2\);/s);
  assert.match(component, /mass:\s*42,/);
  assert.match(component, /linearDamping:\s*0\.17/);
  assert.match(component, /angularDamping:\s*0\.29/);
  assert.match(component, /relativeImpactPoint/);
  assert.match(component, /point\.x - bagBody\.position\.x/);
  assert.match(styles, /\.camera-card\s*\{[^}]*width:\s*330px;/s);
  assert.match(styles, /\.camera-viewport\s*\{[^}]*aspect-ratio:\s*16 \/ 9;/s);
});
