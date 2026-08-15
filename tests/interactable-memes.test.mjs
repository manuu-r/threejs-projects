import assert from "node:assert/strict";
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
  assert.match(html, /finger-guns\.png/);
  assert.match(html, /dj-cat\.png/);
  assert.match(html, /radioactive-dinosaur\.png/);
  assert.match(html, /brain-pill\.png/);
  assert.match(html, /client-demo\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships absolute social preview metadata", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /property="og:image" content="http:\/\/localhost:3000\/interactable-memes\/og-v3\.png"/i);
  assert.match(html, /name="twitter:card" content="summary_large_image"/i);
});
