import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://motogp.test/motogp", {
      headers: { accept: "text/html", host: "motogp.test" },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the MotoGP time trial route", async () => {
  const response = await render();
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<title>MotoGP Time Trial · Three\.js Fun<\/title>/i);
  assert.match(html, /Loading MotoGP Time Trial/i);
  assert.match(html, /Jolt Physics/i);
});

test("ships the baked Ducati/rider assembly and downloaded GP circuit", async () => {
  const [bike, venue] = await Promise.all([
    readFile(new URL("public/motogp/ducati-rider-game-rig.glb", projectRoot)),
    readFile(new URL("public/motogp/nurburgring-gp.glb", projectRoot)),
    access(new URL("public/motogp/track-collision.json", projectRoot)),
  ]);
  assert.ok(bike.length > 20_000_000, "baked Ducati and rider must retain the supplied detail");
  assert.ok(venue.length > 20_000_000, "downloaded circuit venue must ship with the game");
  const jsonChunkLength = bike.readUInt32LE(12);
  const gltf = JSON.parse(bike.subarray(20, 20 + jsonChunkLength).toString("utf8").trimEnd());
  assert.ok(gltf.materials.length >= 30, "race bike must retain its authored materials");
});

test("uses the Marc Marquez Ducati assembly and keeps unsafe generated ads disabled", async () => {
  const [bikeSource, runtimeSource, atmosphereSource] = await Promise.all([
    readFile(new URL("projects/motogp/game/Bike.ts", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/GameRuntime.ts", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/track/TrackAtmosphere.ts", projectRoot), "utf8"),
  ]);
  assert.match(bikeSource, /ducati-rider-game-rig\.glb/);
  assert.match(bikeSource, /MarcMarquez93Ducati/);
  assert.match(bikeSource, /this\.ready = this\.loadModel\(\)/);
  assert.match(runtimeSource, /await bike\.ready/);
  assert.match(atmosphereSource, /TRACKSIDE_AD_SLOTS/);
  assert.match(atmosphereSource, /ENABLE_LEGACY_GENERATED_PLACEMENTS = false/);
});

test("recovers against the authored asphalt instead of a synthetic world floor", async () => {
  const [runtimeSource, physicsSource, collisionSource] = await Promise.all([
    readFile(new URL("projects/motogp/GameRuntime.ts", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/track/TrackPhysics.ts", projectRoot), "utf8"),
    readFile(new URL("public/motogp/nurburgring-asphalt-collision.json", projectRoot), "utf8"),
  ]);
  assert.match(runtimeSource, /queryAsphaltSurface/);
  assert.match(runtimeSource, /lastSafeRoad/);
  assert.doesNotMatch(physicsSource, /deep recovery floor/i);
  const collision = JSON.parse(collisionSource);
  assert.ok(collision.vertices.length / 3 >= 100_000, "all authored driveable surfaces must ship");
  assert.ok(collision.triangles.length / 3 >= 70_000, "collision must cover every tarmac section");
  assert.ok(collision.parts.some((part) => part.object === "Object_27"), "start-grid tarmac must collide");
});

test("ships explicit rear chase and rider camera modes", async () => {
  const cameraSource = await readFile(
    new URL("projects/motogp/render/ChaseCamera.ts", projectRoot),
    "utf8",
  );
  assert.match(cameraSource, /mode: 'rear' \| 'rider' = 'rear'/);
  assert.match(cameraSource, /REAR CHASE/);
  assert.match(cameraSource, /RIDER VIEW/);
});

test("maps left and right input to the expected motorcycle turn direction", async () => {
  const bikeSource = await readFile(
    new URL("projects/motogp/game/Bike.ts", projectRoot),
    "utf8",
  );
  assert.match(bikeSource, /SetDriverInput\(forward, this\.steerCurrent, brake, 0\)/);
  assert.match(bikeSource, /mMaxSteerAngle = isFront \? STEERING\.maxSteerAngleDeg \* DEG : 0/);
  assert.match(bikeSource, /speedInputScale/);
});

test("uses brake-only MotoGP controls with no scripted drift path", async () => {
  const [bikeSource, configSource, gameSource, inputSource] = await Promise.all([
    readFile(new URL("projects/motogp/game/Bike.ts", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/config.ts", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/MotoGpGame.tsx", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/input/InputIntent.ts", projectRoot), "utf8"),
  ]);
  assert.doesNotMatch(configSource, /reverseGearRatios/);
  assert.doesNotMatch(bikeSource, /forward = -intent\.brake/);
  assert.doesNotMatch(bikeSource, /rearSlide|powerSlide|trailSlide/);
  assert.match(bikeSource, /mMaxHandBrakeTorque = 0/);
  assert.match(inputSource, /BRAKE_ATTACK = 2\.5/);
  assert.doesNotMatch(gameSource, /drift/i);
});

test("clears held controls and uses an older stable pose during recovery", async () => {
  const runtimeSource = await readFile(
    new URL("projects/motogp/GameRuntime.ts", projectRoot),
    "utf8",
  );
  assert.match(runtimeSource, /safeRoadHistory/);
  assert.match(runtimeSource, /controls\.reset\(\)/);
});

test("shows the automatic gear and drives engine audio from live RPM", async () => {
  const [runtimeSource, soundSource, hudSource] = await Promise.all([
    readFile(new URL("projects/motogp/GameRuntime.ts", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/audio/EngineSound.ts", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/ui/Hud.ts", projectRoot), "utf8"),
  ]);
  assert.match(runtimeSource, /new EngineSound\(\)/);
  assert.match(runtimeSource, /engineSound\.update\(bike\.telemetry\.rpm \/ ENGINE\.maxRpm, intent\.throttle\)/);
  assert.match(runtimeSource, /engineSound\.dispose\(\)/);
  assert.match(soundSource, /new AudioContext\(\)/);
  assert.match(soundSource, /window\.addEventListener\('keydown', this\.arm\)/);
  assert.match(hudSource, /AUTO · GEAR/);
});
