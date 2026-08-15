import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
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
  assert.match(html, /<title>Internet Nonsense Lab — Please Touch Everything · Three\.js Fun<\/title>/i);
  assert.match(html, /Internet Nonsense Lab home/);
  assert.match(html, /INTERNET/);
  assert.match(html, /NONSENSE LAB/);
  assert.match(html, /favicon-v2\.png/);
  assert.match(html, /THE MEME\./);
  assert.match(html, /THEN THE WORLD\./);
  assert.match(html, /RESET THE LAB/);
  assert.match(html, /FOLLOW/);
  assert.match(html, /MORE INTERNET NONSENSE/);
  assert.match(html, /https:\/\/x\.com\/manudotdev\?ref_src=twsrc%5Etfw/);
  assert.match(html, /Follow @manudotdev on X for more interactive experiments/);
  assert.match(html, /The original joke, now with polygons/);
  assert.match(html, /UNIVERSAL NOD PROTOCOL/);
  assert.match(html, /VINYL PURR-SUASION/);
  assert.match(html, /AWKWARD STAREDOWN/);
  assert.match(html, /PLACEBO PROTOCOL/);
  assert.match(html, /CLIENT DEMO STABILIZER/);
  assert.match(html, /THREE\.JS/);
  assert.match(html, /LOADING 3D CHARACTERS/);
  assert.match(html, /ORIGINAL MEME/);
  assert.match(html, /INTERACTIVE 3D REMAKE/);
  assert.match(html, /MOVE AROUND HIS FACE/);
  assert.match(html, /ZERO CLICKING REQUIRED/);
  assert.match(html, /nod-map\.png/);
  assert.match(html, /Hey, man, what(?:&#x27;|')s up\?/);
  assert.match(html, /Hey, I need to/);
  assert.match(html, /Yo, man, check this/);
  assert.match(html, /Greetings sir\. You have my respect\./);
  assert.match(html, /gorilla facing an original charcoal Godzilla build/);
  assert.match(html, /Godzilla staring awkwardly at a gorilla/);
  assert.doesNotMatch(html, /TRY THE SPOON|hardest-thing\.png/);
  assert.match(html, /dj-cat\.png/);
  assert.match(html, /radioactive-dinosaur\.png/);
  assert.match(html, /brain-pill\.png/);
  assert.match(html, /client-demo\.png/);
  assert.match(html, /GUYS I&#x27;M GONNA TRY MY BEST/);
  assert.match(html, /BUT IT&#x27;S A F\*CKING RADIOACTIVE DINOSAUR/);
  assert.match(html, /heal my disease/);
  assert.match(html, /takes pill with no effect/);
  assert.match(html, /You son of a bitch, I(?:&#x27;|')m in/);
  assert.match(html, /WHEN CLIENT WANTS DEMO/);
  assert.match(html, /BUT PRODUCT ISN&#x27;T READY/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships the licensed 3D character models used by the meme scenes", () => {
  const modelDirectory = new URL("../public/interactable-memes/models/", import.meta.url);
  for (const filename of ["cat.glb", "gorilla.glb", "small-airplane.glb"]) {
    const model = new URL(filename, modelDirectory);
    assert.equal(existsSync(model), true, `${filename} is missing`);
    assert.ok(statSync(model).size > 10_000, `${filename} is unexpectedly small`);
  }
});

test("ships the five Blender-authored dioramas and their rendered loading posters", () => {
  const modelDirectory = new URL("../public/interactable-memes/studio-models/", import.meta.url);
  const previewDirectory = new URL("../public/interactable-memes/studio-previews/", import.meta.url);

  for (const scene of ["nod", "scratch", "reactor", "brain", "demo"]) {
    const model = new URL(`${scene}.glb`, modelDirectory);
    const preview = new URL(`${scene}.png`, previewDirectory);
    assert.equal(existsSync(model), true, `${scene}.glb is missing`);
    assert.equal(existsSync(preview), true, `${scene}.png is missing`);
    assert.ok(statSync(model).size > 10_000, `${scene}.glb is unexpectedly small`);
    assert.ok(statSync(preview).size > 10_000, `${scene}.png is unexpectedly small`);
  }
});

test("ships the named interactive props and keeps the gorilla scene core-free", () => {
  const directory = new URL("../public/interactable-memes/studio-models/", import.meta.url);
  const nod = readFileSync(new URL("nod.glb", directory)).toString("latin1");
  const reactor = readFileSync(new URL("reactor.glb", directory)).toString("latin1");
  const demo = readFileSync(new URL("demo.glb", directory)).toString("latin1");

  assert.match(nod, /NodHead/);
  assert.match(nod, /NodBeard/);
  assert.match(nod, /NodArrow_up/);
  assert.match(nod, /NodArrow_right/);
  assert.match(nod, /NodArrow_left/);
  assert.match(nod, /NodArrow_down/);
  assert.match(reactor, /Geo_Gorilla/);
  assert.match(reactor, /Godzilla/);
  assert.match(reactor, /GodzillaStareEye/);
  assert.match(reactor, /GodzillaDorsalPlate/);
  assert.match(reactor, /Godzilla atomic cyan/);
  assert.doesNotMatch(reactor, /Trex|TRex/);
  assert.doesNotMatch(reactor, /ReactorCore|CoreCrystal|CoreRing/);
  assert.match(demo, /Fuselage_Cube/);
  assert.match(demo, /ExcavatorArm/);
  assert.match(demo, /ExcavatorUpper/);
  assert.match(demo, /PlaneRig/);
});

test("ships absolute social preview metadata", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /property="og:image" content="http:\/\/localhost:3000\/interactable-memes\/og-v9\.png"/i);
  assert.match(html, /name="twitter:card" content="summary_large_image"/i);
  assert.match(html, /name="twitter:image" content="http:\/\/localhost:3000\/interactable-memes\/og-v9\.png"/i);
});
