import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://punch-lab.test/", {
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

test("server-renders the finished Kinetiq experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Punch Lab · Kinetiq<\/title>/i);
  assert.match(html, /YOUR HANDS\./);
  assert.match(html, /REAL IMPACT\./);
  assert.match(html, /START CAMERA/);
  assert.match(html, /PRACTICE WITHOUT CAMERA/);
  assert.match(html, /MEDIAPIPE \/ LIVE/);
  assert.match(html, /data-testid="start-camera"/);
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
    access(new URL("public/assets/machine_shop_02_1k.hdr", projectRoot)),
    access(new URL("public/assets/rubber_tiles_diff_1k.jpg", projectRoot)),
    access(new URL("public/og.png", projectRoot)),
  ]);
  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});
