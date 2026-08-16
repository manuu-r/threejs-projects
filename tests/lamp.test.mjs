import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
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

test("server-renders the Luma behavior lab", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Luma Lamp Lab<\/title>/i);
  assert.match(html, /Meet Luma\./);
  assert.match(html, /START CAMERA/);
  assert.match(html, /PREVIEW PERSONALITY/);
  assert.match(html, /BEHAVIOURS/);
  assert.match(html, /DOWNLOAD BEHAVIOUR PACK/);
  assert.match(html, /HAND \+ FACE TRACKING/);
  assert.match(html, /video and landmarks never leave this device/i);
  assert.match(html, /data-testid="luma-lamp-lab"/);
});

test("ships the refined lamp and local vision dependencies", async () => {
  const [model, attribution] = await Promise.all([
    stat(new URL("public/lamp/luma-character-lamp.glb", projectRoot)),
    readFile(new URL("public/lamp/ATTRIBUTION.md", projectRoot), "utf8"),
  ]);
  assert.ok(model.size > 500_000);
  assert.match(attribution, /Poly Haven/i);
  assert.match(attribution, /CC0/i);

  await Promise.all([
    access(new URL("public/mediapipe/models/hand_landmarker.task", projectRoot)),
    access(new URL("public/mediapipe/models/face_landmarker.task", projectRoot)),
    access(new URL("public/mediapipe/wasm", projectRoot)),
  ]);
});

test("keeps recognition local and exports physical-lamp foundations", async () => {
  const [component, engine, pack] = await Promise.all([
    readFile(new URL("projects/lamp/LampLab.tsx", projectRoot), "utf8"),
    readFile(new URL("projects/lamp/gestureEngine.ts", projectRoot), "utf8"),
    readFile(new URL("projects/lamp/behaviorPack.ts", projectRoot), "utf8"),
  ]);

  assert.match(component, /FilesetResolver\.forVisionTasks\("\/mediapipe\/wasm"\)/);
  assert.match(component, /\/mediapipe\/models\/hand_landmarker\.task/);
  assert.match(component, /\/mediapipe\/models\/face_landmarker\.task/);
  assert.match(component, /SpeechRecognition/);
  assert.match(component, /captureStream\(30\)/);
  assert.doesNotMatch(component, /https?:\/\/(?!polyhaven)/i);

  assert.match(engine, /class GestureStateMachine/);
  assert.match(engine, /emergencyStop|open_palm|HOLD_TIMES/i);
  assert.match(engine, /solveTwoBoneIK/);
  assert.match(engine, /JOINT_LIMITS/);

  assert.match(pack, /luma\.physical-board\/v1/);
  assert.match(pack, /board-config\.json/);
  assert.match(pack, /motion-clips\.glb/);
  assert.match(pack, /application\/zip/);
});
