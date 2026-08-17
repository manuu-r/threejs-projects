import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://lamp-lab.test/lamp", {
      headers: { accept: "text/html", host: "lamp-lab.test" },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the lamp behavior experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Meet the lamp<\/title>/i);
  assert.match(html, /Meet the lamp\./);
  assert.match(html, /START CAMERA/);
  assert.match(html, /PREVIEW PERSONALITY/);
  assert.match(html, /BEHAVIOURS/);
  assert.match(html, /DOWNLOAD BEHAVIOUR PACK/);
  assert.match(html, /HAND \+ MASK TRACKING/);
  assert.match(html, /3D FACE POSE \+ BLINK \+ JAW \/ LIVE/);
  assert.match(html, /video and landmarks never leave this device/i);
  assert.match(html, /data-testid="lamp-lab"/);
});

test("ships the refined lamp and local vision dependencies", async () => {
  const [model, attribution] = await Promise.all([
    readFile(new URL("public/lamp/character-lamp.glb", projectRoot)),
    readFile(new URL("public/lamp/ATTRIBUTION.md", projectRoot), "utf8"),
  ]);
  assert.ok(model.length > 500_000);
  const jsonChunkLength = model.readUInt32LE(12);
  const gltf = JSON.parse(model.subarray(20, 20 + jsonChunkLength).toString("utf8").trimEnd());
  const nodeNames = new Set(gltf.nodes.map((node) => node.name));
  assert.ok(nodeNames.has("DriveWheelLeft"));
  assert.ok(nodeNames.has("DriveWheelRight"));
  assert.ok(nodeNames.has("CasterWheel"));
  assert.ok(nodeNames.has("PupilLeft"));
  assert.ok(nodeNames.has("PupilRight"));
  assert.ok(nodeNames.has("BrowLeft"));
  assert.ok(nodeNames.has("BrowRight"));
  assert.ok(nodeNames.has("NeckAxle"));
  assert.ok(nodeNames.has("NeckCollarHead"));
  assert.ok(nodeNames.has("NeckCollarArm"));
  assert.match(attribution, /Poly Haven/i);
  assert.match(attribution, /CC0/i);

  await Promise.all([
    access(new URL("public/mediapipe/models/hand_landmarker.task", projectRoot)),
    access(new URL("public/mediapipe/models/face_landmarker.task", projectRoot)),
    access(new URL("public/mediapipe/wasm", projectRoot)),
  ]);
});

test("keeps recognition local and exports physical-lamp foundations", async () => {
  const [component, engine, pack, punch] = await Promise.all([
    readFile(new URL("projects/lamp/LampLab.tsx", projectRoot), "utf8"),
    readFile(new URL("projects/lamp/gestureEngine.ts", projectRoot), "utf8"),
    readFile(new URL("projects/lamp/behaviorPack.ts", projectRoot), "utf8"),
    readFile(new URL("projects/punch-power/PunchLab.tsx", projectRoot), "utf8"),
  ]);

  assert.match(component, /FilesetResolver\.forVisionTasks\("\/mediapipe\/wasm"\)/);
  assert.match(component, /\/mediapipe\/models\/hand_landmarker\.task/);
  assert.match(component, /\/mediapipe\/models\/face_landmarker\.task/);
  assert.match(component, /createFaceMaskRenderer/);
  assert.match(component, /className="lamp-face-mask-layer"/);
  assert.match(component, /outputFaceBlendshapes: true/);
  assert.match(component, /outputFacialTransformationMatrixes: true/);
  assert.match(component, /SpeechRecognition/);
  assert.match(component, /captureStream\(30\)/);
  assert.match(component, /travelTargetZ/);
  assert.match(component, /DriveWheelLeft/);
  assert.match(component, /visibleBrightness = 0\.5/);
  assert.match(component, /const gestureBlink/);
  assert.match(component, /getObjectByName\("PupilLeft"\)/);
  assert.match(component, /entry\.material\.opacity = entry\.opacity \* eyeFade/);
  assert.match(component, /browLeftRestZ \+ curious/);
  assert.match(component, /browRightRestZ - curious/);
  assert.match(component, /new THREE\.SpotLight/);
  assert.match(component, /const floorGlow = new THREE\.Mesh/);
  assert.match(component, /new THREE\.FogExp2\(0x061017, 0\.24\)/);
  assert.doesNotMatch(component, /CylinderGeometry\(0\.025, 0\.42/);
  assert.doesNotMatch(component, /https?:\/\/(?!polyhaven)/i);

  assert.match(engine, /class GestureStateMachine/);
  assert.match(engine, /emergencyStop|open_palm|HOLD_TIMES/i);
  assert.match(engine, /solveTwoBoneIK/);
  assert.match(engine, /JOINT_LIMITS/);
  assert.match(punch, /export function createFaceMaskRenderer/);

  assert.match(pack, /lamp\.physical-board\/v1/);
  assert.match(pack, /board-config\.json/);
  assert.match(pack, /motion-clips\.glb/);
  assert.match(pack, /application\/zip/);
});
