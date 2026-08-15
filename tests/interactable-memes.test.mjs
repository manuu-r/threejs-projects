import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/interactable-memes", {
      headers: { accept: "text/html" },
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

test("server-renders the interactable memes experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Interactable Memes — Memes You Can Orbit · Three\.js Fun<\/title>/i);
  assert.match(html, /MEMES YOU/);
  assert.match(html, /CAN ORBIT\./);
  assert.match(html, /RESET THE LAB/);
  assert.match(html, /Five experiments in serious nonsense/);
  assert.match(html, /3D OFFICE CROSSFIRE/);
  assert.match(html, /3D VINYL PURR-SUASION/);
  assert.match(html, /3D EFFORT REACTOR/);
  assert.match(html, /3D PLACEBO PROTOCOL/);
  assert.match(html, /CLIENT DEMO STABILIZER/);
  assert.match(html, /THREE\.JS/);
  assert.match(html, /LOADING 3D CHARACTERS/);
  assert.match(html, /Five meme casts rebuilt as actual Three\.js characters/);
  assert.doesNotMatch(html, /finger-guns\.png|dj-cat\.png|radioactive-dinosaur\.png|brain-pill\.png|client-demo\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships the licensed 3D character models used by the meme scenes", () => {
  const modelDirectory = new URL("../public/interactable-memes/models/", import.meta.url);
  for (const filename of ["business-man.glb", "cat.glb", "gorilla.glb", "trex.glb"]) {
    const model = new URL(filename, modelDirectory);
    assert.equal(existsSync(model), true, `${filename} is missing`);
    assert.ok(statSync(model).size > 10_000, `${filename} is unexpectedly small`);
  }
});

test("ships absolute social preview metadata", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /property="og:image" content="http:\/\/localhost:3000\/interactable-memes\/og-v4\.png"/i);
  assert.match(html, /name="twitter:card" content="summary_large_image"/i);
});
