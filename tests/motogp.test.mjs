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

test("ships the baked Ducati/rider assembly, cockpit forearms and downloaded GP circuit", async () => {
  const [bike, cockpitArms, venue] = await Promise.all([
    readFile(new URL("public/motogp/ducati-rider-game-rig.glb", projectRoot)),
    readFile(new URL("public/motogp/ducati-rider-cockpit-arms.glb", projectRoot)),
    readFile(new URL("public/motogp/nurburgring-gp.glb", projectRoot)),
    access(new URL("public/motogp/track-collision.json", projectRoot)),
  ]);
  assert.ok(bike.length > 20_000_000, "baked Ducati and rider must retain the supplied detail");
  assert.ok(cockpitArms.length > 500_000, "cockpit view must ship textured forearms, not glove cutouts");
  assert.ok(venue.length > 20_000_000, "downloaded circuit venue must ship with the game");
  const jsonChunkLength = bike.readUInt32LE(12);
  const gltf = JSON.parse(bike.subarray(20, 20 + jsonChunkLength).toString("utf8").trimEnd());
  assert.ok(gltf.materials.length >= 30, "race bike must retain its authored materials");
  const armsJsonLength = cockpitArms.readUInt32LE(12);
  const armsGltf = JSON.parse(cockpitArms.subarray(20, 20 + armsJsonLength).toString("utf8").trimEnd());
  assert.ok(armsGltf.nodes.some((node) => /Marc93_Rider_Arms_Cockpit/.test(node.name ?? "")));
  assert.ok(armsGltf.extensionsUsed.includes("EXT_texture_webp"), "cockpit textures must stay compressed");
});

test("uses the Marc Marquez Ducati assembly and keeps unsafe generated ads disabled", async () => {
  const [bikeSource, runtimeSource, atmosphereSource] = await Promise.all([
    readFile(new URL("projects/motogp/game/Bike.ts", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/GameRuntime.ts", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/track/TrackAtmosphere.ts", projectRoot), "utf8"),
  ]);
  assert.match(bikeSource, /ducati-rider-game-rig\.glb/);
  assert.match(bikeSource, /mount\.position\.set\(0, -0\.975, 0\)/);
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
  assert.match(runtimeSource, /queryPlayableSurface/);
  assert.match(runtimeSource, /lastSafeRoad/);
  assert.doesNotMatch(physicsSource, /deep recovery floor/i);
  const collision = JSON.parse(collisionSource);
  assert.ok(collision.vertices.length / 3 >= 100_000, "all authored driveable surfaces must ship");
  assert.ok(collision.triangles.length / 3 >= 70_000, "collision must cover every tarmac section");
  assert.ok(collision.parts.some((part) => part.object === "Object_24" && part.role === "asphalt"));
  assert.ok(collision.parts.some((part) => part.object === "Object_17" && part.role === "runoff"));
  assert.ok(collision.parts.some((part) => part.object === "Object_18" && part.role === "gravel"));
  assert.ok(collision.parts.some((part) => part.object === "Object_32" && part.role === "verge"));
  for (const part of collision.parts) {
    const first = part.triangleOffset * 3;
    const end = first + part.triangleCount * 3;
    for (const index of collision.triangles.slice(first, end)) {
      assert.ok(index >= part.vertexOffset && index < part.vertexOffset + part.vertexCount,
        `${part.role} triangle must reference only its own authored vertices`);
    }
  }
  assert.match(physicsSource, /frictionForRole/);
  assert.match(physicsSource, /case 'gravel'/);
  assert.match(physicsSource, /case 'runoff'/);
  assert.match(physicsSource, /garageApron/);
  assert.match(physicsSource, /const inner = 6/);
  assert.match(physicsSource, /const outer = 42/);
  assert.match(physicsSource, /PLAYABLE_ROLES/);
  assert.match(physicsSource, /buildVenueObstaclePhysics/);
  assert.match(physicsSource, /world\.addStaticBox/);
  assert.match(runtimeSource, /bike\.forceCrash\(0\.82\)/);
  assert.doesNotMatch(runtimeSource, /roadSurface\.horizontalDistance > 16/);
  assert.match(runtimeSource, /startCrashSequence/);
});

test("maps every added run-off layer as upward rideable geometry", async () => {
  const collision = JSON.parse(await readFile(
    new URL("public/motogp/nurburgring-asphalt-collision.json", projectRoot),
    "utf8",
  ));
  for (const object of ["Object_17", "Object_18", "Object_32"]) {
    const part = collision.parts.find((candidate) => candidate.object === object);
    assert.ok(part, `${object} must have authored collision`);
    assert.ok(part.triangleCount > 300, `${object} must retain its complete surface sheet`);
    const first = part.triangleOffset * 3;
    const end = first + part.triangleCount * 3;
    for (let triangle = first; triangle < end; triangle += 3) {
      const indices = collision.triangles.slice(triangle, triangle + 3);
      const [a, b, c] = indices.map((index) => collision.vertices.slice(index * 3, index * 3 + 3));
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const normalY = ab[2] * ac[0] - ab[0] * ac[2];
      assert.ok(normalY > 0, `${object} collision must be wound upward`);
    }
  }
});

test("never reads detached Jolt wheel handles from the render loop", async () => {
  const bikeSource = await readFile(
    new URL("projects/motogp/game/Bike.ts", projectRoot),
    "utf8",
  );
  const syncVisuals = bikeSource.slice(
    bikeSource.indexOf("syncVisuals(interpolationAlpha"),
    bikeSource.indexOf("respawnAt(", bikeSource.indexOf("syncVisuals(interpolationAlpha")),
  );
  assert.match(bikeSource, /captureWheelState/);
  assert.match(syncVisuals, /wheelSuspensionLength/);
  assert.doesNotMatch(syncVisuals, /constraint\.GetWheel/);
});

test("removes the accidental legacy bike and hardens driveable track materials", async () => {
  const visualsSource = await readFile(
    new URL("projects/motogp/track/TrackVisuals.ts", projectRoot),
    "utf8",
  );
  assert.match(visualsSource, /EXCLUDED_VENUE_OBJECTS/);
  assert.match(visualsSource, /'a\.001'/);
  assert.match(visualsSource, /'Object_28'/);
  assert.match(visualsSource, /'Object_29'/);
  assert.match(visualsSource, /'Object_31'/);
  assert.match(visualsSource, /'Object_56'/);
  assert.match(visualsSource, /DRIVEABLE_SURFACES/);
  assert.match(visualsSource, /material\.transparent = false/);
  assert.match(visualsSource, /material\.map\.anisotropy/);
});

test("ships explicit rear chase and rider camera modes", async () => {
  const cameraSource = await readFile(
    new URL("projects/motogp/render/ChaseCamera.ts", projectRoot),
    "utf8",
  );
  assert.match(cameraSource, /mode: 'rear' \| 'rider' = 'rear'/);
  assert.match(cameraSource, /REAR CHASE/);
  assert.match(cameraSource, /RIDER VIEW/);
  assert.match(cameraSource, /rigidly chassis-local/);
  assert.match(cameraSource, /this\.posSmoothed\.copy\(this\.tmpB\)/);
  assert.doesNotMatch(cameraSource, /riderFollow/);
});

test("uses an ACES, IBL and restrained post-processing pipeline", async () => {
  const rendererSource = await readFile(
    new URL("projects/motogp/render/Renderer.ts", projectRoot),
    "utf8",
  );
  assert.match(rendererSource, /ACESFilmicToneMapping/);
  assert.match(rendererSource, /SRGBColorSpace/);
  assert.match(rendererSource, /PMREMGenerator/);
  assert.match(rendererSource, /scene\.environment =/);
  assert.match(rendererSource, /SSAOPass/);
  assert.match(rendererSource, /UnrealBloomPass/);
  assert.match(rendererSource, /SMAAPass/);
  assert.match(rendererSource, /PCFShadowMap/);
  assert.match(rendererSource, /toneMappingExposure = 0\.57/);
  assert.match(rendererSource, /rearFill/);
  assert.match(rendererSource, /shadowWeight/);
});

test("adds tiled track micro-detail and bounded speed effects", async () => {
  const [visualsSource, surfaceSource, speedSource, atmosphereSource] = await Promise.all([
    readFile(new URL("projects/motogp/track/TrackVisuals.ts", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/track/TrackSurfaceDetails.ts", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/render/SpeedEffects.ts", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/track/TrackAtmosphere.ts", projectRoot), "utf8"),
  ]);
  assert.match(visualsSource, /material\.normalMap/);
  assert.match(visualsSource, /material\.roughnessMap/);
  assert.match(visualsSource, /material\.aoMap/);
  assert.match(visualsSource, /RepeatWrapping/);
  assert.match(visualsSource, /const asphaltTone = Math\.round\(98/);
  assert.match(surfaceSource, /RacingLineWear/);
  assert.match(surfaceSource, /BakedTyreMark/);
  assert.match(speedSource, /WheelMotionBlur/);
  assert.match(speedSource, /DynamicTyreMarks/);
  assert.match(speedSource, /surfaceDistance > 0\.65/);
  assert.match(speedSource, /createSoftParticleMap/);
  assert.match(speedSource, /createRadialGradient/);
  assert.doesNotMatch(speedSource, /throttle > 0\.82/);
  assert.match(atmosphereSource, /new THREE\.InstancedMesh/);
  assert.match(atmosphereSource, /new THREE\.LOD/);
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
  const [runtimeSource, soundSource, hudSource, bikeSource, configSource] = await Promise.all([
    readFile(new URL("projects/motogp/GameRuntime.ts", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/audio/EngineSound.ts", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/ui/Hud.ts", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/game/Bike.ts", projectRoot), "utf8"),
    readFile(new URL("projects/motogp/config.ts", projectRoot), "utf8"),
  ]);
  assert.match(runtimeSource, /new EngineSound\(\)/);
  assert.match(runtimeSource, /engineSound\.update\([\s\S]*bike\.telemetry\.rpm \/ ENGINE\.maxRpm[\s\S]*intent\.throttle/);
  assert.match(runtimeSource, /engineSound\.dispose\(\)/);
  assert.match(soundSource, /new AudioContext\(\)/);
  assert.match(soundSource, /window\.addEventListener\('keydown', this\.arm\)/);
  assert.match(hudSource, /AUTO · GEAR/);
  assert.match(bikeSource, /ETransmissionMode_Manual/);
  assert.match(bikeSource, /this\.telemetry\.gear = this\.gearbox\.gear/);
  assert.match(configSource, /gearRatios: \[3\.35, 2\.55, 2\.02, 1\.68, 1\.42, 1\.2\]/);
});

test("automatic MotoGP gearbox holds a road gear while coasting", async () => {
  const { AutomaticGearbox } = await import(
    new URL("../projects/motogp/game/AutomaticGearbox.ts", import.meta.url)
  );
  const gearbox = new AutomaticGearbox({
    gearRatios: [3.35, 2.55, 2.02, 1.68, 1.42, 1.2],
    differentialRatio: 3.4,
    wheelRadiusM: 0.31,
    maxRpm: 12500,
    shiftUpRpm: 10800,
    shiftDownRpm: 6200,
    kickdownRpm: 900,
    shiftDurationSec: 0.1,
    shiftLockoutSec: 0.14,
  });

  // Accelerate beyond the old first-gear ceiling and allow each quickshift to finish.
  for (const speedKph of [140, 140, 140, 180, 180, 180, 220, 220, 220]) {
    for (let i = 0; i < 20; i++) gearbox.update(1 / 60, speedKph / 3.6, 1);
  }
  assert.ok(gearbox.gear >= 4, `expected an upshift sequence, got gear ${gearbox.gear}`);

  // Releasing the throttle can downshift as speed falls, but can never select N.
  for (let speedKph = 220; speedKph >= 0; speedKph -= 2) {
    const command = gearbox.update(1 / 60, speedKph / 3.6, 0);
    assert.ok(command.gear >= 1);
  }
  assert.equal(gearbox.gear, 1);
});

test("crash detection ignores kerbs but separates major impacts", async () => {
  const { CrashDetector } = await import(
    new URL("../projects/motogp/game/CrashDetector.ts", import.meta.url)
  );
  const detector = new CrashDetector();
  assert.equal(detector.update({
    speedMps: 35,
    deltaVelocityMps: 2.2,
    uprightDot: 0.92,
    angularSpeedRad: 1.4,
    frontContact: true,
    rearContact: true,
  }), null);
  const crash = detector.update({
    speedMps: 35,
    deltaVelocityMps: 11,
    uprightDot: 0.12,
    angularSpeedRad: 9,
    frontContact: true,
    rearContact: false,
  });
  assert.ok(crash);
  assert.ok(crash.severity >= 0.45 && crash.severity <= 1);
  assert.equal(detector.update({
    speedMps: 35,
    deltaVelocityMps: 20,
    uprightDot: -1,
    angularSpeedRad: 15,
    frontContact: false,
    rearContact: false,
  }), null, "one impact must emit one crash event");
});

test("cinematic slow motion is brief and requests one recovery", async () => {
  const { CinematicSlowMotion } = await import(
    new URL("../projects/motogp/game/CinematicSlowMotion.ts", import.meta.url)
  );
  const effect = new CinematicSlowMotion();
  effect.trigger(0.8);
  let minimum = 1;
  let recoveries = 0;
  for (let i = 0; i < 240; i++) {
    const state = effect.update(1 / 60);
    minimum = Math.min(minimum, state.timeScale);
    if (state.recover) recoveries++;
  }
  assert.ok(minimum >= 0.2 && minimum < 0.5);
  assert.equal(recoveries, 1);
  assert.equal(effect.update(1 / 60).active, false);
});

test("lap timer records valid history with millisecond precision", async () => {
  const { LapTimer } = await import(
    new URL("../projects/motogp/timing/LapTimer.ts", import.meta.url)
  );
  const timer = new LapTimer();
  timer.start(10);
  assert.equal(timer.lapNumber, 1);
  assert.equal(timer.completeLap(94.583), 84583);
  timer.start(100);
  timer.invalidateCurrent();
  assert.equal(timer.completeLap(180), null);
  assert.deepEqual(timer.historyMs, [84583]);
  assert.equal(timer.sessionBestMs, 84583);
  assert.equal(timer.lapNumber, 3, "invalid attempts still advance the current lap number");
});

test("HUD presents crash feedback and complete lap timing fields", async () => {
  const hudSource = await readFile(
    new URL("projects/motogp/ui/Hud.ts", projectRoot),
    "utf8",
  );
  assert.match(hudSource, /RIDER DOWN/);
  assert.match(hudSource, /crashVignette/);
  for (const label of ["TIME", "LAST LAP", "BEST", "SESSION"]) {
    assert.match(hudSource, new RegExp(`row\\('${label}'\\)`));
  }
});

test("best lap and recent lap history persist safely", async () => {
  const savedStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    const { BestLapStore } = await import(
      new URL("../projects/motogp/timing/BestLapStore.ts", import.meta.url)
    );
    const store = new BestLapStore("motogp.test.best");
    store.save(84583.4);
    store.appendHistory(85123.8);
    store.appendHistory(84583.4);
    assert.equal(store.load(), 84583);
    assert.deepEqual(store.loadHistory(), [85124, 84583]);
  } finally {
    if (savedStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = savedStorage;
  }
});

test("checkpoints require a complete forward lap in strict order", async () => {
  const { Checkpoints } = await import(
    new URL("../projects/motogp/track/Checkpoints.ts", import.meta.url)
  );
  const count = 100;
  const samples = Array.from({ length: count }, (_, i) => ({
    p: [i, 0, 0],
    t: [1, 0, 0],
    n: [0, 0, 1],
  }));
  const track = {
    json: { checkpoints: 4, startSampleIndex: 0 },
    count,
    samples,
    nearestSample: (x) => ((Math.round(x) % count) + count) % count,
  };
  const checkpoints = new Checkpoints(track);

  checkpoints.update(98, 0);
  assert.equal(checkpoints.update(2, 0).lapStarted, true);
  for (const gate of [25, 50, 75]) {
    checkpoints.update(gate - 2, 0);
    assert.equal(checkpoints.update(gate + 2, 0).passed, true);
  }
  checkpoints.update(98, 0);
  assert.equal(checkpoints.update(2, 0).lapCompleted, true);

  const cut = new Checkpoints(track);
  cut.update(98, 0);
  cut.update(2, 0);
  cut.update(48, 0);
  cut.update(52, 0);
  assert.equal(cut.valid, false, "skipping the first sector must invalidate the lap");
});

test("track collision welds render-only seams without changing its surface", async () => {
  const source = await readFile(
    new URL("projects/motogp/track/TrackPhysics.ts", projectRoot),
    "utf8",
  );
  assert.match(source, /export function weldCollisionMesh/);
  assert.match(source, /a === b \|\| b === c \|\| c === a/);
  assert.match(source, /preventing suspension chatter/);
});
