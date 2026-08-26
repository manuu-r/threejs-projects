import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  buildBehaviorPackArchive,
  buildSessionReplay,
} from "../projects/lamp/behaviorPack.ts";
import { DEFAULT_MAPPINGS } from "../projects/lamp/gestureEngine.ts";
import { DORMANT_LAMP_POSE, WAKE_SETTLE_MS } from "../projects/lamp/pose.ts";

const projectRoot = new URL("../", import.meta.url);
const decoder = new TextDecoder();

function readStoredZip(bytes) {
  const entries = new Map();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    assert.equal(method, 0, "behavior-pack files must remain dependency-free stored ZIP entries");
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    entries.set(name, bytes.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

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
  assert.doesNotMatch(html, /BEHAVIOURS/);
  assert.doesNotMatch(html, /DOWNLOAD BEHAVIOUR PACK/);
  assert.doesNotMatch(html, /Lamp behavior editor/);
  assert.doesNotMatch(html, /ENABLE CLAP \+ VOICE|MIC \+ VOICE ON/);
  assert.match(html, /Move palm/);
  assert.doesNotMatch(html, /Finger near lips|Cover camera|>Clap</i);
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
  assert.ok(!nodeNames.has("DriveWheelLeft"));
  assert.ok(!nodeNames.has("DriveWheelRight"));
  assert.ok(!nodeNames.has("CasterWheel"));
  assert.ok(nodeNames.has("RubberFoot_1"));
  assert.ok(nodeNames.has("RubberFoot_2"));
  assert.ok(nodeNames.has("RubberFoot_3"));
  assert.ok(nodeNames.has("RubberFoot_4"));
  assert.ok(nodeNames.has("PupilLeft"));
  assert.ok(nodeNames.has("PupilRight"));
  assert.ok(nodeNames.has("PupilCoreLeft"));
  assert.ok(nodeNames.has("PupilCoreRight"));
  assert.ok(nodeNames.has("CatchlightLeft"));
  assert.ok(nodeNames.has("CatchlightRight"));
  assert.ok(!nodeNames.has("BrowLeft"));
  assert.ok(!nodeNames.has("BrowRight"));
  assert.ok(nodeNames.has("NeckAxle"));
  assert.ok(nodeNames.has("NeckCollarHead"));
  assert.ok(nodeNames.has("NeckCollarArm"));
  assert.ok(nodeNames.has("FacePlate"));
  assert.ok(nodeNames.has("Spring_1"));
  assert.ok(nodeNames.has("Spring_2"));
  assert.ok(nodeNames.has("Spring_3"));
  assert.ok(nodeNames.has("Spring_4"));
  assert.match(attribution, /aiden915/i);
  assert.match(attribution, /pistiwique/i);
  assert.match(attribution, /CC BY|Attribution 4\.0/i);

  await Promise.all([
    access(new URL("public/mediapipe/models/hand_landmarker.task", projectRoot)),
    access(new URL("public/mediapipe/models/face_landmarker.task", projectRoot)),
    access(new URL("public/mediapipe/wasm", projectRoot)),
  ]);
});

test("the shipped rig holds a connected upright task-lamp stance", async () => {
  Object.defineProperty(globalThis, "self", {
    value: globalThis,
    configurable: true,
  });
  const model = await readFile(new URL("public/lamp/character-lamp.glb", projectRoot));
  const arrayBuffer = model.buffer.slice(
    model.byteOffset,
    model.byteOffset + model.byteLength,
  );
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, "", resolve, reject);
  });
  const lamp = gltf.scene;
  const baseYaw = lamp.getObjectByName("BaseYaw");
  const shoulder = lamp.getObjectByName("Shoulder");
  const elbow = lamp.getObjectByName("Elbow");
  const headPitch = lamp.getObjectByName("HeadPitch");
  const headYaw = lamp.getObjectByName("HeadYaw");
  const base = lamp.getObjectByName("Base");
  const shade = lamp.getObjectByName("Lamp_lamp_head");
  assert.ok(baseYaw && shoulder && elbow && headPitch && headYaw && base && shade);

  baseYaw.rotation.y = DORMANT_LAMP_POSE.baseYaw;
  shoulder.rotation.x = DORMANT_LAMP_POSE.shoulder;
  elbow.rotation.x = DORMANT_LAMP_POSE.elbow;
  headPitch.rotation.x = DORMANT_LAMP_POSE.headPitch;
  headYaw.rotation.y = DORMANT_LAMP_POSE.headYaw;
  lamp.updateMatrixWorld(true);

  const baseBounds = new THREE.Box3().setFromObject(base);
  const shadeBounds = new THREE.Box3().setFromObject(shade);
  const standingHeight = shadeBounds.max.y - baseBounds.min.y;
  const shadeClearance = shadeBounds.min.y - baseBounds.max.y;
  const shoulderPosition = shoulder.getWorldPosition(new THREE.Vector3());
  const elbowPosition = elbow.getWorldPosition(new THREE.Vector3());
  const headPosition = headPitch.getWorldPosition(new THREE.Vector3());
  assert.equal(DORMANT_LAMP_POSE.shoulder, 0);
  assert.equal(DORMANT_LAMP_POSE.elbow, 0);
  assert.ok(elbowPosition.y - shoulderPosition.y > 0.17, "lower arm must rise from the base");
  assert.ok(headPosition.y - elbowPosition.y > 0.23, "upper arm must rise from the elbow");
  assert.ok(DORMANT_LAMP_POSE.baseYaw > THREE.MathUtils.degToRad(30));
  assert.equal(DORMANT_LAMP_POSE.headPitch, THREE.MathUtils.degToRad(60));
  assert.equal(DORMANT_LAMP_POSE.headYaw, THREE.MathUtils.degToRad(35));
  assert.ok(standingHeight > 0.7, `standing lamp is too short: ${standingHeight}`);
  assert.ok(shadeClearance > 0.2, `shade is too close to the base: ${shadeClearance}`);
  assert.equal(WAKE_SETTLE_MS, 1_550);
});

test("builds a complete behavior pack and replay from the user's active mappings", async () => {
  const model = await readFile(new URL("public/lamp/character-lamp.glb", projectRoot));
  const mappings = {
    ...DEFAULT_MAPPINGS,
    peace: "sleep",
    fist: "lock",
  };
  const settings = {
    mappings,
    reactionSpeed: 1.3,
    smoothness: 0.85,
    lightColor: "#ffc266",
    brightness: 0.95,
    personality: "Quiet companion",
  };
  const createdAt = "2026-08-18T00:00:00.000Z";
  const archive = buildBehaviorPackArchive(settings, {
    createdAt,
    motionClipGlb: new Uint8Array(model),
  });
  const entries = readStoredZip(archive);
  assert.deepEqual([...entries.keys()], [
    "lamp-behaviour.json",
    "gesture-mappings.json",
    "motion-clips.json",
    "light-settings.json",
    "board-config.json",
    "gesture-profile.json",
    "audio/README.txt",
    "ATTRIBUTION.md",
    "motion-clips.glb",
  ]);

  const jsonEntry = (name) => JSON.parse(decoder.decode(entries.get(name)));
  assert.deepEqual(jsonEntry("gesture-mappings.json"), mappings);
  assert.deepEqual(jsonEntry("light-settings.json"), {
    color: "#ffc266",
    brightness: 0.95,
    pulseOnBeat: true,
  });
  const manifest = jsonEntry("lamp-behaviour.json");
  assert.equal(manifest.createdAt, createdAt);
  assert.equal(manifest.personality.name, "Quiet companion");
  assert.equal(manifest.safety.minimumGestureConfidence, 0.85);
  const board = jsonEntry("board-config.json");
  assert.equal(board.emergencyStopAction, mappings.open_palm);
  assert.equal(board.updateRateHz, 50);
  assert.equal(sha256(entries.get("motion-clips.glb")), sha256(model));

  const replay = JSON.parse(buildSessionReplay([
    { at: 1250, gesture: "peace", action: "sleep", confidence: 0.94 },
  ], mappings, createdAt));
  assert.equal(replay.createdAt, createdAt);
  assert.deepEqual(replay.mappings, mappings);
  assert.equal(replay.events[0].action, "sleep");
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
  assert.doesNotMatch(component, /SpeechRecognition|webkitSpeechRecognition|enableVoice|listenForClap/);
  assert.match(component, /captureStream\(30\)/);
  assert.match(component, /travelTargetZ/);
  assert.match(component, /sampleBallisticHop/);
  assert.match(component, /sampleMusicMotion/);
  assert.match(component, /setMusicPlaying/);
  assert.match(component, /startInPlaceHop/);
  assert.match(component, /HEAD_LEVEL_CORRECTION = radians\(-3\.2\)/);
  assert.match(component, /HEAD_LEVEL_CORRECTION \+ pose\.headRoll/);
  assert.match(component, /targets\.headRoll = 0/);
  assert.doesNotMatch(component, /DriveWheelLeft|DriveWheelRight|CasterWheel/);
  assert.match(component, /const armTowardElbow/);
  assert.match(component, /const awayFromViewer/);
  assert.match(component, /cameraFacingHeadYaw/);
  assert.match(component, /import \{ DORMANT_LAMP_POSE, WAKE_SETTLE_MS \} from "\.\/pose"/);
  assert.match(component, /wakeInputLockUntilRef/);
  assert.match(component, /trackingDeadband = radians\(0\.45\)/);
  assert.match(component, /wakeFromGesture/);
  assert.match(component, /const RESPONSE_GESTURES: GestureName\[\] = \[/);
  assert.match(component, /RESPONSE_GESTURES\.map/);
  assert.match(component, /palm_move: "🫲"/);
  assert.match(component, /palmMovementSpeed/);
  assert.match(component, /palm_move: "follow_palm"/);
  assert.doesNotMatch(component, /Point, wave/i);
  assert.doesNotMatch(component, /downloadSessionReplay|downloadBehaviorPack|lamp-editor/);
  assert.match(component, /const LAMP_LIGHT_ENABLED = false/);
  assert.match(component, /visibleBrightness = LAMP_LIGHT_ENABLED \? 0\.5/);
  assert.match(component, /const gestureBlink/);
  assert.match(component, /getObjectByName\("PupilLeft"\)/);
  assert.match(component, /entry\.material\.opacity = entry\.opacity \* eyeFade/);
  assert.doesNotMatch(component, /BrowLeft|BrowRight|browLeft|browRight/);
  assert.match(component, /new THREE\.SpotLight/);
  assert.match(component, /const floorGlow = new THREE\.Mesh/);
  assert.match(component, /new THREE\.FogExp2\(0x061017, 0\.24\)/);
  assert.doesNotMatch(component, /CylinderGeometry\(0\.025, 0\.42/);
  assert.doesNotMatch(component, /https?:\/\/(?!polyhaven)/i);

  assert.match(engine, /class GestureStateMachine/);
  assert.match(engine, /emergencyStop|open_palm|HOLD_TIMES/i);
  assert.match(engine, /solveTwoBoneIK/);
  assert.match(engine, /JOINT_LIMITS/);
  assert.doesNotMatch(engine, /WaveDetector|\bok:\s*"OK sign"|\bwave:\s*"Wave"/);
  assert.doesNotMatch(engine, /"clap"|"voice_follow"|"voice_stay"/);
  assert.doesNotMatch(component, /gesture:\s*"wave"|gesture === "ok"|WaveDetector/);
  assert.match(punch, /export function createFaceMaskRenderer/);

  assert.match(pack, /lamp\.physical-board\/v1/);
  assert.match(pack, /board-config\.json/);
  assert.match(pack, /motion-clips\.glb/);
  assert.match(pack, /application\/zip/);
});
