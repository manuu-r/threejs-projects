"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type {
  HandLandmarker,
  HandLandmarkerResult,
  NormalizedLandmark,
  PoseLandmarker,
  PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import {
  averageCalibration,
  calculateCalibration,
  calculateDepthRatio,
  calculatePenetrationCorrection,
  calculateWholeHandVelocity,
  fuseForearmVelocity,
  CAMERA_FOCAL_X_NORMALIZED,
  handCenter,
  KNUCKLES,
  mapLandmarkToScene,
  type CalibratedHandFrame,
  type HandCalibration,
} from "./handMapping";

type Phase = "idle" | "loading" | "calibrating" | "active" | "error";

type SessionStats = {
  hits: number;
  combo: number;
  speed: number;
  force: number;
  best: number;
};

type Calibration = HandCalibration;

type PunchSample = {
  landmarks: THREE.Vector3[];
  velocity: THREE.Vector3;
  forearmPoint: THREE.Vector3 | null;
  distance: number;
  depthRatio: number;
  at: number;
};

type HandAssetRig = {
  root: THREE.Object3D;
  joints: Map<string, THREE.Object3D>;
  restPositions: Map<string, THREE.Vector3>;
  restQuaternions: Map<string, THREE.Quaternion>;
};

type ArenaApi = {
  setTrackingResult: (
    result: HandLandmarkerResult,
    time: number,
  ) => void;
  setPoseResult: (result: PoseLandmarkerResult, time: number) => void;
  calibrate: (calibration: Calibration) => { cameraDistance: number };
  enableAudio: () => Promise<void>;
  setAudioEnabled: (enabled: boolean) => void;
  setHitDetection: (enabled: boolean) => void;
  dispose: () => void;
};

const CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

const HAND_CONTACT_ZONES: ReadonlyArray<ReadonlyArray<number>> = [
  KNUCKLES,
  [4, 8, 12, 16, 20],
  [3, 7, 11, 15, 19],
  [0, 5, 9, 13, 17],
];

const HAND_SIZE_GAIN = 1.4;
const HAND_POSITION_GAIN = 1.28 * HAND_SIZE_GAIN;
const REAL_HAND_MESH_SCALE = 1.62;
const EXPOSED_FINGER_JOINTS = new Set([3, 4, 7, 8, 11, 12, 15, 16, 19, 20]);
const POSE_ARM_INDICES = [
  { shoulder: 11, elbow: 13, wrist: 15 },
  { shoulder: 12, elbow: 14, wrist: 16 },
] as const;

const HAND_ASSET_FINGERS = [
  { name: "index-finger", points: [5, 6, 7, 8] },
  { name: "middle-finger", points: [9, 10, 11, 12] },
  { name: "ring-finger", points: [13, 14, 15, 16] },
  { name: "pinky-finger", points: [17, 18, 19, 20] },
] as const;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function isThumbUp(hand: NormalizedLandmark[]) {
  if (hand.length < 21) return false;
  const thumbExtended =
    hand[4].y < hand[3].y &&
    hand[3].y < hand[2].y &&
    hand[4].y < hand[5].y - 0.035;
  const fingersFolded = [
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ].filter(([tip, pip]) => hand[tip].y > hand[pip].y - 0.005).length;
  const upright = Math.abs(hand[0].x - hand[9].x) < 0.18;
  return thumbExtended && fingersFolded >= 3 && upright;
}

function makeLabelTexture(
  title: string,
  subtitle: string,
  accent = "#ef3f3f",
) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 1024, 512);
  gradient.addColorStop(0, "#151719");
  gradient.addColorStop(1, "#050607");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(255,255,255,.13)";
  ctx.lineWidth = 6;
  ctx.strokeRect(26, 26, 972, 460);
  ctx.fillStyle = accent;
  ctx.fillRect(55, 70, 12, 370);
  ctx.fillStyle = "#f4f1e8";
  ctx.font = "900 98px Arial Narrow, Arial";
  ctx.textAlign = "left";
  ctx.fillText(title, 100, 245);
  ctx.fillStyle = "rgba(244,241,232,.65)";
  ctx.font = "600 34px Arial";
  ctx.letterSpacing = "8px";
  ctx.fillText(subtitle, 106, 325);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function makeBagMarkTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 1024, 1024);
  ctx.strokeStyle = "rgba(255,255,255,.38)";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(512, 492, 282, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,.94)";
  ctx.beginPath();
  ctx.moveTo(394, 635);
  ctx.bezierCurveTo(310, 611, 269, 541, 284, 452);
  ctx.bezierCurveTo(300, 351, 383, 285, 489, 279);
  ctx.bezierCurveTo(603, 271, 704, 330, 728, 430);
  ctx.bezierCurveTo(754, 540, 687, 626, 591, 654);
  ctx.lineTo(394, 635);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(334, 477);
  ctx.bezierCurveTo(247, 469, 210, 520, 231, 581);
  ctx.bezierCurveTo(254, 646, 323, 660, 387, 621);
  ctx.lineTo(404, 538);
  ctx.bezierCurveTo(385, 505, 360, 485, 334, 477);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,.78)";
  ctx.roundRect(384, 625, 230, 142, 28);
  ctx.fill();
  ctx.strokeStyle = "rgba(151,8,18,.5)";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(392, 637);
  ctx.lineTo(608, 637);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeHandWrapTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const base = ctx.createLinearGradient(0, 0, 256, 256);
  base.addColorStop(0, "#f5f1e7");
  base.addColorStop(0.52, "#ded8cb");
  base.addColorStop(1, "#f0ece2");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);

  ctx.lineWidth = 0.75;
  for (let y = 1; y < 256; y += 3) {
    ctx.strokeStyle = y % 9 === 1 ? "rgba(90,82,72,.22)" : "rgba(255,255,255,.42)";
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y + 12);
    ctx.stroke();
  }
  for (let x = -256; x < 256; x += 7) {
    ctx.strokeStyle = "rgba(112,102,90,.12)";
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 256, 256);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3.5, 5.5);
  texture.anisotropy = 8;
  return texture;
}

function makeSkinTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const base = ctx.createRadialGradient(92, 72, 12, 128, 128, 210);
  base.addColorStop(0, "#d7a080");
  base.addColorStop(0.56, "#bd8064");
  base.addColorStop(1, "#9f6854");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 900; i += 1) {
    const x = (i * 73) % 256;
    const y = (i * 151 + Math.floor(i / 7) * 19) % 256;
    const shade = 94 + ((i * 31) % 55);
    ctx.fillStyle = `rgba(${shade}, ${Math.max(45, shade - 35)}, ${Math.max(38, shade - 44)}, 0.055)`;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.strokeStyle = "rgba(100, 55, 48, 0.09)";
  ctx.lineWidth = 0.7;
  for (let y = 18; y < 256; y += 34) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(70, y - 5, 168, y + 7, 256, y - 2);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.2, 2.2);
  texture.anisotropy = 8;
  return texture;
}

function setCylinderBetween(
  mesh: THREE.Mesh,
  start: THREE.Vector3,
  end: THREE.Vector3,
) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  mesh.position.copy(midpoint);
  mesh.scale.set(1, direction.length(), 1);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
}

function addBox(
  scene: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
  rotation: [number, number, number] = [0, 0, 0],
  shadows = true,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  scene.add(mesh);
  return mesh;
}

function createArena(
  canvas: HTMLCanvasElement,
  onImpact: (speed: number, force: number) => void,
): ArenaApi {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090b0d);
  scene.fog = new THREE.FogExp2(0x090b0d, 0.027);

  const camera = new THREE.PerspectiveCamera(
    43,
    canvas.clientWidth / canvas.clientHeight,
    0.05,
    70,
  );
  camera.position.set(0.15, 3.15, 9.1);
  camera.lookAt(0, 2.8, 0);

  const hemi = new THREE.HemisphereLight(0x9bb6c8, 0x241514, 1.05);
  scene.add(hemi);
  const key = new THREE.SpotLight(0xffe6cf, 165, 28, Math.PI / 5, 0.55, 1.25);
  key.position.set(-3.8, 7.2, 5.5);
  key.target.position.set(0, 2.6, -0.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.00025;
  scene.add(key, key.target);
  const rim = new THREE.SpotLight(0xff2929, 88, 18, Math.PI / 4, 0.8, 1.1);
  rim.position.set(5.5, 5.5, -2.5);
  rim.target.position.set(0, 2.8, 0);
  scene.add(rim, rim.target);
  const coolFill = new THREE.PointLight(0x76baff, 20, 12, 2);
  coolFill.position.set(-5, 3.5, -2.5);
  scene.add(coolFill);

  const textureLoader = new THREE.TextureLoader();
  const floorMap = textureLoader.load("/assets/rubber_tiles_diff_1k.jpg");
  const floorNormal = textureLoader.load("/assets/rubber_tiles_nor_gl_1k.jpg");
  for (const texture of [floorMap, floorNormal]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 8);
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  floorMap.colorSpace = THREE.SRGBColorSpace;

  const rubber = new THREE.MeshStandardMaterial({
    map: floorMap,
    normalMap: floorNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    color: 0x4c4c4d,
    roughness: 0.86,
    metalness: 0.02,
  });
  const concrete = new THREE.MeshStandardMaterial({
    color: 0x34383a,
    roughness: 0.92,
    metalness: 0.04,
    bumpScale: 0.12,
  });
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x171a1c,
    roughness: 0.38,
    metalness: 0.78,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: 0x858b8e,
    roughness: 0.28,
    metalness: 0.9,
  });
  const red = new THREE.MeshStandardMaterial({
    color: 0xa40f18,
    roughness: 0.48,
    metalness: 0.16,
  });
  const ropeWhite = new THREE.MeshStandardMaterial({
    color: 0xd4d0c6,
    roughness: 0.68,
  });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 30), rubber);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  addBox(scene, [18, 7.2, 0.35], [0, 3.6, -6.2], concrete);
  addBox(scene, [0.35, 7.2, 15], [-9, 3.6, 0.8], concrete);
  addBox(scene, [0.35, 7.2, 15], [9, 3.6, 0.8], concrete);
  addBox(scene, [18, 0.28, 15], [0, 7.1, 0.6], darkMetal);

  // Ceiling trusses and practical lights.
  for (let z = -5; z <= 5; z += 2.5) {
    addBox(scene, [17.5, 0.14, 0.16], [0, 6.75, z], steel);
  }
  for (const x of [-5.7, 0, 5.7]) {
    addBox(scene, [0.22, 0.16, 13.5], [x, 6.78, 0], steel);
  }
  for (const x of [-4.7, 0, 4.7]) {
    const strip = addBox(
      scene,
      [2.4, 0.06, 0.42],
      [x, 6.55, 2.4],
      new THREE.MeshStandardMaterial({
        color: 0xfff4df,
        emissive: 0xffdfb0,
        emissiveIntensity: 3.2,
      }),
      [0, 0, 0],
      false,
    );
    strip.layers.enable(0);
  }

  // Left-side boxing ring.
  const ring = new THREE.Group();
  ring.position.set(-5.5, 0, -2.4);
  scene.add(ring);
  addBox(ring, [5.5, 0.45, 4.4], [0, 0.23, 0], darkMetal);
  addBox(
    ring,
    [5.15, 0.09, 4.05],
    [0, 0.5, 0],
    new THREE.MeshStandardMaterial({
      color: 0x27333a,
      roughness: 0.9,
    }),
  );
  const postMaterial = new THREE.MeshStandardMaterial({
    color: 0xe2e3df,
    roughness: 0.38,
    metalness: 0.35,
  });
  const postPositions: [number, number, number][] = [
    [-2.62, 1.45, -2.08],
    [2.62, 1.45, -2.08],
    [-2.62, 1.45, 2.08],
    [2.62, 1.45, 2.08],
  ];
  for (const position of postPositions) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.12, 2.9, 12),
      postMaterial,
    );
    post.position.set(...position);
    post.castShadow = true;
    ring.add(post);
  }
  const ropeGeometry = new THREE.CylinderGeometry(0.025, 0.025, 1, 10);
  for (const y of [1.05, 1.52, 1.98]) {
    const levels: Array<[THREE.Vector3, THREE.Vector3, THREE.Material]> = [
      [
        new THREE.Vector3(-2.62, y, -2.08),
        new THREE.Vector3(2.62, y, -2.08),
        y === 1.52 ? red : ropeWhite,
      ],
      [
        new THREE.Vector3(-2.62, y, 2.08),
        new THREE.Vector3(2.62, y, 2.08),
        y === 1.52 ? red : ropeWhite,
      ],
      [
        new THREE.Vector3(-2.62, y, -2.08),
        new THREE.Vector3(-2.62, y, 2.08),
        y === 1.52 ? red : ropeWhite,
      ],
      [
        new THREE.Vector3(2.62, y, -2.08),
        new THREE.Vector3(2.62, y, 2.08),
        y === 1.52 ? red : ropeWhite,
      ],
    ];
    for (const [start, end, material] of levels) {
      const rope = new THREE.Mesh(ropeGeometry, material);
      setCylinderBetween(rope, start, end);
      ring.add(rope);
    }
  }

  // Lockers, bench, weights, wall signage and background bags.
  const lockerMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a3033,
    roughness: 0.45,
    metalness: 0.72,
  });
  for (let i = 0; i < 5; i += 1) {
    const locker = addBox(
      scene,
      [0.9, 2.65, 0.65],
      [4.5 + i * 0.92, 1.34, -5.58],
      lockerMaterial,
    );
    const vent = addBox(
      locker,
      [0.48, 0.025, 0.015],
      [0, 0.75, 0.34],
      steel,
      [0, 0, 0],
      false,
    );
    vent.castShadow = false;
  }
  addBox(scene, [3.7, 0.18, 0.85], [5.7, 0.72, -3.72], darkMetal);
  addBox(scene, [0.16, 0.72, 0.16], [4.2, 0.36, -3.72], steel);
  addBox(scene, [0.16, 0.72, 0.16], [7.2, 0.36, -3.72], steel);
  const rack = new THREE.Group();
  rack.position.set(6.35, 0.15, -1.25);
  scene.add(rack);
  addBox(rack, [3.15, 0.14, 0.6], [0, 0.6, 0], steel);
  addBox(rack, [3.15, 0.14, 0.6], [0, 1.2, 0], steel);
  for (let i = 0; i < 5; i += 1) {
    for (const y of [0.72, 1.32]) {
      const weight = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18 + i * 0.018, 0.18 + i * 0.018, 0.35, 14),
        darkMetal,
      );
      weight.rotation.z = Math.PI / 2;
      weight.position.set(-1.2 + i * 0.6, y, 0);
      rack.add(weight);
    }
  }
  const signMaterial = new THREE.MeshBasicMaterial({
    map: makeLabelTexture("EARNED", "NOT GIVEN"),
  });
  addBox(scene, [4.5, 2.25, 0.06], [-4.6, 4.7, -5.98], signMaterial, [0, 0, 0], false);
  const scoreMaterial = new THREE.MeshBasicMaterial({
    map: makeLabelTexture("12:00", "ROUND 01", "#43e5c3"),
  });
  addBox(scene, [2.55, 1.25, 0.06], [5.6, 4.85, -5.98], scoreMaterial, [0, 0, 0], false);

  const backgroundBagMaterial = new THREE.MeshStandardMaterial({
    color: 0x202326,
    roughness: 0.6,
    metalness: 0.08,
  });
  for (const x of [-7.3, 7.7]) {
    const hanger = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.45, 1.7, 20),
      backgroundBagMaterial,
    );
    hanger.position.set(x, 3.35, -2.8);
    hanger.castShadow = true;
    scene.add(hanger);
    const chain = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 2.55, 6),
      steel,
    );
    chain.position.set(x, 5.45, -2.8);
    scene.add(chain);
  }

  // HDRI provides realistic reflections without replacing the authored gym room.
  new HDRLoader().load(
    "/assets/machine_shop_02_1k.hdr",
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = texture;
      scene.environmentIntensity = 0.55;
    },
    undefined,
    () => undefined,
  );

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.allowSleep = true;
  if (world.solver instanceof CANNON.GSSolver) world.solver.iterations = 14;
  world.broadphase = new CANNON.SAPBroadphase(world);
  const bagPhysicsMaterial = new CANNON.Material("dense-leather-bag");
  const floorPhysicsMaterial = new CANNON.Material("rubber-floor");
  world.addContactMaterial(
    new CANNON.ContactMaterial(bagPhysicsMaterial, floorPhysicsMaterial, {
      friction: 0.56,
      restitution: 0.045,
    }),
  );
  const floorBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Plane(),
    material: floorPhysicsMaterial,
  });
  floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floorBody);

  let bagScale = 1;
  let bagHeight = 2.35;
  let bagRadius = 0.56;
  let bagBody: CANNON.Body;
  let anchorBody: CANNON.Body;
  let bagConstraint: CANNON.PointToPointConstraint;
  let anchorPosition = new THREE.Vector3(0.25, 6.18, 0);
  let active = false;
  let squash = 0;
  let disposed = false;
  let calibratedHandFrame: CalibratedHandFrame | null = null;
  const handDepthScales = [1, 1];
  const cameraTarget = new THREE.Vector3(0, 2.8, 0);

  const bagGroup = new THREE.Group();
  scene.add(bagGroup);
  const profile = [
    new THREE.Vector2(0.28, -1.16),
    new THREE.Vector2(0.48, -1.08),
    new THREE.Vector2(0.56, -0.82),
    new THREE.Vector2(0.57, 0.7),
    new THREE.Vector2(0.53, 1.02),
    new THREE.Vector2(0.37, 1.15),
  ];
  const bagShell = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 48),
    new THREE.MeshPhysicalMaterial({
      color: 0xa20e18,
      roughness: 0.34,
      metalness: 0.05,
      clearcoat: 0.26,
      clearcoatRoughness: 0.46,
      sheen: 0.25,
      sheenColor: new THREE.Color(0xff2727),
    }),
  );
  bagShell.castShadow = true;
  bagShell.receiveShadow = true;
  bagGroup.add(bagShell);
  const seamMaterial = new THREE.MeshStandardMaterial({
    color: 0x3c080b,
    roughness: 0.72,
  });
  for (const y of [-1.03, 1.02]) {
    const seam = new THREE.Mesh(
      new THREE.TorusGeometry(y < 0 ? 0.49 : 0.47, 0.013, 6, 64),
      seamMaterial,
    );
    seam.rotation.x = Math.PI / 2;
    seam.position.y = y;
    bagGroup.add(seam);
  }
  const mark = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.9),
    new THREE.MeshStandardMaterial({
      map: makeBagMarkTexture(),
      transparent: true,
      roughness: 0.42,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  mark.position.set(0, 0.22, 0.566);
  bagGroup.add(mark);

  const topCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.37, 0.48, 0.12, 32),
    seamMaterial,
  );
  topCap.position.y = 1.12;
  bagGroup.add(topCap);

  const chainGroup = new THREE.Group();
  scene.add(chainGroup);
  const chainSegments: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i += 1) {
    const chain = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 1, 8),
      steel,
    );
    chain.castShadow = true;
    chainGroup.add(chain);
    chainSegments.push(chain);
  }
  const ceilingPlate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.33, 0.33, 0.13, 24),
    darkMetal,
  );
  ceilingPlate.position.copy(anchorPosition);
  scene.add(ceilingPlate);

  function setupPhysics(scale = 1, x = 0.25, y = 3.02, z = 0) {
    if (bagConstraint) world.removeConstraint(bagConstraint);
    if (bagBody) world.removeBody(bagBody);
    if (anchorBody) world.removeBody(anchorBody);
    bagScale = scale;
    bagHeight = 2.35 * scale;
    bagRadius = 0.56 * scale;
    const chainLength = clamp(6.18 - y - bagHeight / 2, 0.62, 1.65);
    anchorPosition = new THREE.Vector3(x, y + bagHeight / 2 + chainLength, z);
    bagBody = new CANNON.Body({
      mass: 42 * Math.pow(scale, 2.1),
      material: bagPhysicsMaterial,
      shape: new CANNON.Cylinder(bagRadius, bagRadius * 0.92, bagHeight, 24),
      position: new CANNON.Vec3(x, y, z),
      linearDamping: 0.24,
      angularDamping: 0.39,
      allowSleep: true,
      sleepSpeedLimit: 0.08,
      sleepTimeLimit: 1.6,
    });
    anchorBody = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      position: new CANNON.Vec3(
        anchorPosition.x,
        anchorPosition.y,
        anchorPosition.z,
      ),
    });
    world.addBody(bagBody);
    world.addBody(anchorBody);
    bagConstraint = new CANNON.PointToPointConstraint(
      anchorBody,
      new CANNON.Vec3(0, 0, 0),
      bagBody,
      new CANNON.Vec3(0, bagHeight / 2 + chainLength, 0),
      1e6,
    );
    bagConstraint.collideConnected = false;
    world.addConstraint(bagConstraint);
    ceilingPlate.position.copy(anchorPosition);
    bagGroup.scale.setScalar(scale);
  }

  setupPhysics();

  const handGroups = [new THREE.Group(), new THREE.Group()];
  const handJoints: THREE.Mesh[][] = [[], []];
  const handBones: THREE.Mesh[][] = [[], []];
  const handSurfaces: Array<{
    palm: THREE.Mesh;
    heel: THREE.Mesh;
    thenar: THREE.Mesh;
    wristband: THREE.Mesh;
    nails: THREE.Mesh[];
    wrapLayers: THREE.Mesh[];
  }> = [];
  const segmentRadii = [
    0.04, 0.037, 0.033, 0.028,
    0.05, 0.043, 0.035, 0.029,
    0.052,
    0.044, 0.036, 0.03,
    0.053,
    0.042, 0.034, 0.028,
    0.052,
    0.039, 0.032, 0.027,
    0.048,
  ];
  const fingertipIndices = new Set([4, 8, 12, 16, 20]);
  const middleJointIndices = new Set([3, 6, 7, 10, 11, 14, 15, 18, 19]);
  const wrapTexture = makeHandWrapTexture();
  wrapTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const skinTexture = makeSkinTexture();
  skinTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const wrapMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xf2eee4,
    map: wrapTexture,
    bumpMap: wrapTexture,
    bumpScale: 0.009,
    roughness: 0.92,
    metalness: 0,
    clearcoat: 0.04,
    sheen: 0.28,
    sheenColor: new THREE.Color(0xffffff),
  });
  const skinMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: skinTexture,
    bumpMap: skinTexture,
    bumpScale: 0.0045,
    emissive: new THREE.Color(0x4a1c12),
    emissiveIntensity: 0.07,
    roughness: 0.62,
    metalness: 0.01,
    clearcoat: 0.14,
    clearcoatRoughness: 0.5,
    sheen: 0.4,
    sheenColor: new THREE.Color(0xffd0b3),
  });
  const nailMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xf0c5ad,
    roughness: 0.38,
    clearcoat: 0.45,
    clearcoatRoughness: 0.3,
  });
  handGroups.forEach((group, handIndex) => {
    group.visible = false;
    scene.add(group);
    for (let i = 0; i < 21; i += 1) {
      const radius =
        i === 0
          ? 0.055 * HAND_SIZE_GAIN
          : KNUCKLES.includes(i as (typeof KNUCKLES)[number])
            ? 0.061 * HAND_SIZE_GAIN
            : fingertipIndices.has(i)
              ? 0.039 * HAND_SIZE_GAIN
              : middleJointIndices.has(i)
                ? 0.043 * HAND_SIZE_GAIN
                : 0.047 * HAND_SIZE_GAIN;
      const joint = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 16, 12),
        EXPOSED_FINGER_JOINTS.has(i) ? skinMaterial : wrapMaterial,
      );
      joint.castShadow = true;
      joint.visible = false;
      group.add(joint);
      handJoints[handIndex].push(joint);
    }
    for (let i = 0; i < CONNECTIONS.length; i += 1) {
      const radius = segmentRadii[i] * HAND_SIZE_GAIN;
      const [, to] = CONNECTIONS[i];
      const bone = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.84, radius, 1, 14),
        EXPOSED_FINGER_JOINTS.has(to) ? skinMaterial : wrapMaterial,
      );
      bone.castShadow = true;
      bone.visible = false;
      group.add(bone);
      handBones[handIndex].push(bone);
    }
    const palm = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 24),
      wrapMaterial,
    );
    const heel = new THREE.Mesh(
      new THREE.SphereGeometry(1, 28, 20),
      wrapMaterial,
    );
    const thenar = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 18),
      wrapMaterial,
    );
    const wristband = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1, 1, 24),
      wrapMaterial,
    );
    const nails = [4, 8, 12, 16, 20].map(() =>
      new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), nailMaterial),
    );
    nails.forEach((nail) => {
      nail.visible = false;
    });
    const wrapLayers = Array.from({ length: 4 }, () =>
      new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), wrapMaterial),
    );
    [palm, heel, thenar, wristband, ...nails, ...wrapLayers].forEach((mesh) => {
      mesh.castShadow = true;
      mesh.renderOrder = 2;
      group.add(mesh);
    });
    handSurfaces.push({ palm, heel, thenar, wristband, nails, wrapLayers });

  });

  const handAssetRigs: Array<{
    left: HandAssetRig | null;
    right: HandAssetRig | null;
  }> = [
    { left: null, right: null },
    { left: null, right: null },
  ];
  const handAssetLoader = new GLTFLoader();

  function createHandAssetRig(template: THREE.Object3D, slot: number) {
    const root = cloneSkeleton(template);
    const joints = new Map<string, THREE.Object3D>();
    const restPositions = new Map<string, THREE.Vector3>();
    const restQuaternions = new Map<string, THREE.Quaternion>();
    root.visible = false;
    root.scale.setScalar(REAL_HAND_MESH_SCALE);
    root.traverse((object) => {
      if (object.name) {
        joints.set(object.name, object);
        restPositions.set(object.name, object.position.clone());
        restQuaternions.set(object.name, object.quaternion.clone());
      }
      if (object instanceof THREE.Mesh) {
        object.material = skinMaterial;
        object.castShadow = true;
        object.frustumCulled = false;
        object.renderOrder = 1;
      }
    });
    handGroups[slot].add(root);
    return { root, joints, restPositions, restQuaternions };
  }

  Promise.all([
    handAssetLoader.loadAsync("/assets/hands/left.glb"),
    handAssetLoader.loadAsync("/assets/hands/right.glb"),
  ])
    .then(([left, right]) => {
      if (disposed) return;
      for (let slot = 0; slot < 2; slot += 1) {
        handAssetRigs[slot].left = createHandAssetRig(left.scene, slot);
        handAssetRigs[slot].right = createHandAssetRig(right.scene, slot);
      }
    })
    .catch((error: unknown) => {
      console.warn("Human hand assets could not be loaded", error);
    });

  function driveHandAsset(
    handIndex: number,
    handedness: "left" | "right",
    positions: THREE.Vector3[],
  ) {
    const slot = handAssetRigs[handIndex];
    const rig = slot[handedness];
    if (slot.left) slot.left.root.visible = handedness === "left";
    if (slot.right) slot.right.root.visible = handedness === "right";
    if (!rig) return;

    const targets = new Map<string, THREE.Vector3>();
    const chains: string[][] = [];
    const target = (name: string, position: THREE.Vector3) => {
      targets.set(name, position.clone().multiplyScalar(1 / REAL_HAND_MESH_SCALE));
    };

    target("wrist", positions[0]);
    const thumbChain = [
      "thumb-metacarpal",
      "thumb-phalanx-proximal",
      "thumb-phalanx-distal",
      "thumb-tip",
    ];
    [1, 2, 3, 4].forEach((landmark, index) => {
      target(thumbChain[index], positions[landmark]);
    });
    chains.push(thumbChain);

    HAND_ASSET_FINGERS.forEach(({ name, points }) => {
      const chain = [
        `${name}-metacarpal`,
        `${name}-phalanx-proximal`,
        `${name}-phalanx-intermediate`,
        `${name}-phalanx-distal`,
        `${name}-tip`,
      ];
      target(chain[0], positions[0].clone().lerp(positions[points[0]], 0.46));
      points.forEach((landmark, index) => {
        target(chain[index + 1], positions[landmark]);
      });
      chains.push(chain);
    });

    const orient = (name: string, adjacentName: string, reverse = false) => {
      const joint = rig.joints.get(name);
      const rest = rig.restPositions.get(name);
      const restAdjacent = rig.restPositions.get(adjacentName);
      const restQuaternion = rig.restQuaternions.get(name);
      const current = targets.get(name);
      const currentAdjacent = targets.get(adjacentName);
      if (
        !joint ||
        !rest ||
        !restAdjacent ||
        !restQuaternion ||
        !current ||
        !currentAdjacent
      ) {
        return;
      }
      const restDirection = reverse
        ? rest.clone().sub(restAdjacent)
        : restAdjacent.clone().sub(rest);
      const currentDirection = reverse
        ? current.clone().sub(currentAdjacent)
        : currentAdjacent.clone().sub(current);
      if (restDirection.lengthSq() < 1e-8 || currentDirection.lengthSq() < 1e-8) {
        return;
      }
      const delta = new THREE.Quaternion().setFromUnitVectors(
        restDirection.normalize(),
        currentDirection.normalize(),
      );
      joint.position.copy(current);
      joint.quaternion.copy(delta.multiply(restQuaternion));
    };

    const wristNext = "middle-finger-metacarpal";
    orient("wrist", wristNext);
    chains.forEach((chain) => {
      chain.forEach((name, index) => {
        if (index < chain.length - 1) orient(name, chain[index + 1]);
        else orient(name, chain[index - 1], true);
      });
    });
  }

  const handFrameMatrix = new THREE.Matrix4();
  function poseHandPart(
    mesh: THREE.Mesh,
    center: THREE.Vector3,
    lateral: THREE.Vector3,
    longitudinal: THREE.Vector3,
    scale: THREE.Vector3,
  ) {
    const yAxis = longitudinal.clone().normalize();
    const xAxis = lateral
      .clone()
      .addScaledVector(yAxis, -lateral.dot(yAxis));
    if (xAxis.lengthSq() < 1e-6) xAxis.set(1, 0, 0);
    xAxis.normalize();
    const zAxis = xAxis.clone().cross(yAxis).normalize();
    handFrameMatrix.makeBasis(xAxis, yAxis, zAxis);
    mesh.position.copy(center);
    mesh.quaternion.setFromRotationMatrix(handFrameMatrix);
    mesh.scale.copy(scale);
  }

  function landmarkToWorld(
    landmark: NormalizedLandmark,
    center: ReturnType<typeof handCenter>,
    depthRatio: number,
  ) {
    if (calibratedHandFrame) {
      const mapped = mapLandmarkToScene(
        landmark,
        center,
        depthRatio,
        calibratedHandFrame,
      );
      return new THREE.Vector3(mapped.x, mapped.y, mapped.z);
    }
    return new THREE.Vector3(
      bagBody.position.x + (0.5 - landmark.x) * 1.4,
      bagBody.position.y + (0.5 - landmark.y) * 0.9,
      bagBody.position.z + bagRadius + 0.52 + landmark.z * 1.35,
    );
  }

  let latestPose: PoseLandmarkerResult | null = null;
  let latestPoseTime = 0;

  function updatePose(result: PoseLandmarkerResult, time: number) {
    latestPose = result;
    latestPoseTime = time;
  }

  function poseTrackedForearmPoint(
    handImageCenter: ReturnType<typeof handCenter>,
    wristWorld: THREE.Vector3,
    palmLength: number,
    depthRatio: number,
    time: number,
  ) {
    const pose = latestPose?.landmarks[0];
    if (!pose || time - latestPoseTime > 180 || !calibratedHandFrame) {
      return null;
    }

    const armIndex = POSE_ARM_INDICES.reduce((closest, candidate) => {
      const closestWrist = pose[closest.wrist];
      const candidateWrist = pose[candidate.wrist];
      const closestDistance = Math.hypot(
        closestWrist.x - handImageCenter.x,
        closestWrist.y - handImageCenter.y,
      );
      const candidateDistance = Math.hypot(
        candidateWrist.x - handImageCenter.x,
        candidateWrist.y - handImageCenter.y,
      );
      return candidateDistance < closestDistance ? candidate : closest;
    });
    const poseWrist = pose[armIndex.wrist];
    const poseElbow = pose[armIndex.elbow];
    const armConfidence = Math.min(
      poseWrist.visibility ?? 0,
      poseElbow.visibility ?? 0,
    );
    if (armConfidence < 0.34) {
      return null;
    }

    const frame = calibratedHandFrame;
    const poseScale = (frame.unitsPerImage / clamp(depthRatio, 0.72, 2.1)) * 1.62;
    const poseDelta = (from: NormalizedLandmark, to: NormalizedLandmark) =>
      new THREE.Vector3(
        (from.x - to.x) * poseScale,
        ((from.y - to.y) * poseScale) / frame.aspect,
        (to.z - from.z) * poseScale * 0.42,
      );
    const fitLimb = (
      start: THREE.Vector3,
      delta: THREE.Vector3,
      minimum: number,
      maximum: number,
    ) => {
      if (delta.lengthSq() < 1e-6) delta.set(0, -1, 0);
      const length = delta.length();
      return start
        .clone()
        .add(delta.normalize().multiplyScalar(clamp(length, minimum, maximum)));
    };
    const elbowWorld = fitLimb(
      wristWorld,
      poseDelta(poseWrist, poseElbow),
      palmLength * 1.65,
      palmLength * 3.5,
    );
    return wristWorld.clone().lerp(elbowWorld, 0.38);
  }

  const previousHands: Array<PunchSample | null> = [null, null];
  const lastHits = [0, 0];

  const particleCount = 72;
  const particleGeometry = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particleCount * 3);
  const particleVelocities = Array.from(
    { length: particleCount },
    () => new THREE.Vector3(),
  );
  const particleLife = new Float32Array(particleCount);
  particleGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(particlePositions, 3),
  );
  const particleMaterial = new THREE.PointsMaterial({
    color: 0xffe4b0,
    size: 0.055,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particles);

  const listener = new THREE.AudioListener();
  camera.add(listener);
  const impactAudio = new THREE.PositionalAudio(listener);
  impactAudio.setRefDistance(2.2);
  impactAudio.setRolloffFactor(1.35);
  impactAudio.setDistanceModel("inverse");
  bagGroup.add(impactAudio);
  let audioReady = false;
  let audioEnabled = true;

  function buildImpactBuffer() {
    const context = listener.context;
    const duration = 0.34;
    const sampleRate = context.sampleRate;
    const buffer = context.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const t = i / sampleRate;
      const envelope = Math.exp(-t * 15);
      const low = Math.sin(2 * Math.PI * (82 - t * 22) * t);
      const slap = (Math.random() * 2 - 1) * Math.exp(-t * 42);
      data[i] = (low * 0.78 + slap * 0.38) * envelope;
    }
    impactAudio.setBuffer(buffer);
    impactAudio.setVolume(0.82);
    audioReady = true;
  }

  function burst(point: THREE.Vector3, direction: THREE.Vector3) {
    for (let i = 0; i < particleCount; i += 1) {
      particlePositions[i * 3] = point.x;
      particlePositions[i * 3 + 1] = point.y;
      particlePositions[i * 3 + 2] = point.z;
      particleVelocities[i]
        .set(
          (Math.random() - 0.5) * 2.8,
          (Math.random() - 0.15) * 2.5,
          (Math.random() - 0.5) * 2.8,
        )
        .addScaledVector(direction, 0.28);
      particleLife[i] = 0.35 + Math.random() * 0.38;
    }
    particleMaterial.opacity = 0.95;
    particleGeometry.attributes.position.needsUpdate = true;
  }

  function applyPunch(point: THREE.Vector3, velocity: THREE.Vector3, speed: number) {
    const cappedSpeed = clamp(speed, 1.1, 9.5);
    const towardBag = new THREE.Vector3()
      .subVectors(
        new THREE.Vector3(bagBody.position.x, bagBody.position.y, bagBody.position.z),
        point,
      )
      .normalize();
    const strikeDirection = velocity.clone().normalize();
    if (!Number.isFinite(strikeDirection.x)) strikeDirection.copy(towardBag);
    strikeDirection.lerp(towardBag, 0.34).normalize();
    const impulseMagnitude = cappedSpeed * 4.2;
    const impulse = strikeDirection.multiplyScalar(impulseMagnitude);
    bagBody.wakeUp();
    bagBody.applyImpulse(
      new CANNON.Vec3(impulse.x, impulse.y * 0.42, impulse.z),
      new CANNON.Vec3(point.x, point.y, point.z),
    );
    const force = Math.round(clamp(cappedSpeed * 118 + impulseMagnitude * 21, 180, 1580));
    squash = clamp(cappedSpeed / 8.5, 0.18, 0.82);
    burst(point, impulse.clone().normalize());
    if (audioEnabled && audioReady && listener.context.state === "running") {
      if (impactAudio.isPlaying) impactAudio.stop();
      impactAudio.setPlaybackRate(0.86 + Math.random() * 0.22);
      impactAudio.setVolume(clamp(0.34 + cappedSpeed / 12, 0.42, 0.95));
      impactAudio.play();
    }
    onImpact(cappedSpeed, force);
  }

  let latestHands: HandLandmarkerResult | null = null;
  let latestHandsTime = 0;

  function updateHands(result: HandLandmarkerResult, time: number) {
    latestHands = result;
    latestHandsTime = time;
    for (let handIndex = 0; handIndex < 2; handIndex += 1) {
      const landmarks = result.landmarks[handIndex];
      const group = handGroups[handIndex];
      if (!landmarks) {
        group.visible = false;
        previousHands[handIndex] = null;
        handDepthScales[handIndex] = 1;
        continue;
      }
      group.visible = true;
      const center = handCenter(landmarks);
      const frame = calibratedHandFrame;
      const rawDepthRatio = frame
        ? calculateDepthRatio(landmarks, frame)
        : 1;
      handDepthScales[handIndex] = THREE.MathUtils.lerp(
        handDepthScales[handIndex],
        clamp(rawDepthRatio, 0.62, 2.4),
        0.28,
      );
      const positions = landmarks.map((landmark) =>
        landmarkToWorld(landmark, center, handDepthScales[handIndex]),
      );
      const motionPositions = positions.map((position) => position.clone());
      const bagCenter = new THREE.Vector3(
        bagBody.position.x,
        bagBody.position.y,
        bagBody.position.z,
      );
      const contactPoints = HAND_CONTACT_ZONES.map((zone) =>
        zone
          .reduce(
            (contactCenter, index) => contactCenter.add(motionPositions[index]),
            new THREE.Vector3(),
          )
          .multiplyScalar(1 / zone.length),
      );
      const rawContact = contactPoints.reduce((closest, candidate) => {
        const closestLocal = closest.clone().sub(bagCenter);
        const candidateLocal = candidate.clone().sub(bagCenter);
        const closestScore =
          Math.hypot(closestLocal.x, closestLocal.z) +
          Math.max(0, Math.abs(closestLocal.y) - bagHeight * 0.58) * 1.6;
        const candidateScore =
          Math.hypot(candidateLocal.x, candidateLocal.z) +
          Math.max(0, Math.abs(candidateLocal.y) - bagHeight * 0.58) * 1.6;
        return candidateScore < closestScore ? candidate : closest;
      });

      const rawFist = KNUCKLES.reduce(
        (fistCenter, index) => fistCenter.add(positions[index]),
        new THREE.Vector3(),
      ).multiplyScalar(1 / KNUCKLES.length);
      const correctedContact = rawContact.clone();
      if (active) {
        const correction = calculatePenetrationCorrection(
          rawContact,
          {
            x: bagBody.position.x,
            y: bagBody.position.y,
            z: bagBody.position.z,
          },
          bagRadius,
          bagHeight,
        );
        if (correction > 0) {
          positions.forEach((position) => {
            position.z += correction;
          });
          rawFist.z += correction;
          correctedContact.z += correction;
        }
      }

      const visualPositions = positions.map((position) =>
        rawFist
          .clone()
          .add(position.clone().sub(rawFist).multiplyScalar(HAND_POSITION_GAIN)),
      );
      if (active) {
        const visualContact = HAND_CONTACT_ZONES.flatMap((zone) => zone)
          .reduce(
            (frontmost, index) =>
              visualPositions[index].z < frontmost.z
                ? visualPositions[index]
                : frontmost,
            visualPositions[KNUCKLES[0]],
          );
        const visualCorrection = calculatePenetrationCorrection(
          visualContact,
          { x: bagBody.position.x, y: bagBody.position.y, z: bagBody.position.z },
          bagRadius,
          bagHeight,
        );
        if (visualCorrection > 0) {
          visualPositions.forEach((position) => {
            position.z += visualCorrection;
          });
        }
      }
      const handednessLabel =
        result.handedness?.[handIndex]?.[0]?.categoryName?.toLowerCase();
      const handedness: "left" | "right" =
        handednessLabel === "right" ? "right" : "left";
      driveHandAsset(handIndex, handedness, visualPositions);
      const surface = handSurfaces[handIndex];
      const wrist = visualPositions[0];
      const visualFist = KNUCKLES.reduce(
        (fistCenter, index) => fistCenter.add(visualPositions[index]),
        new THREE.Vector3(),
      ).multiplyScalar(1 / KNUCKLES.length);
      const palmVector = visualFist.clone().sub(wrist);
      const palmLength = clamp(
        palmVector.length(),
        0.12 * HAND_SIZE_GAIN,
        0.36 * HAND_SIZE_GAIN,
      );
      const palmDirection =
        palmVector.lengthSq() > 1e-6
          ? palmVector.clone().normalize()
          : new THREE.Vector3(0, 1, 0);
      const lateralVector = visualPositions[5].clone().sub(visualPositions[17]);
      const handWidth = clamp(
        lateralVector.length(),
        0.105 * HAND_SIZE_GAIN,
        0.36 * HAND_SIZE_GAIN,
      );
      const lateralDirection =
        lateralVector.lengthSq() > 1e-6
          ? lateralVector.clone().normalize()
          : new THREE.Vector3(1, 0, 0);
      const palmCenter = wrist
        .clone()
        .lerp(visualFist, 0.59)
        .addScaledVector(palmDirection, 0.012 * HAND_SIZE_GAIN);
      poseHandPart(
        surface.palm,
        palmCenter,
        lateralDirection,
        palmDirection,
        new THREE.Vector3(
          handWidth * 0.45 + 0.012 * HAND_SIZE_GAIN,
          palmLength * 0.35 + 0.012 * HAND_SIZE_GAIN,
          handWidth * 0.105 + 0.007 * HAND_SIZE_GAIN,
        ),
      );
      poseHandPart(
        surface.heel,
        wrist.clone().lerp(visualFist, 0.29),
        lateralDirection,
        palmDirection,
        new THREE.Vector3(
          handWidth * 0.38 + 0.01 * HAND_SIZE_GAIN,
          palmLength * 0.19 + 0.01 * HAND_SIZE_GAIN,
          handWidth * 0.09 + 0.006 * HAND_SIZE_GAIN,
        ),
      );
      const thenarCenter = wrist
        .clone()
        .lerp(visualPositions[5], 0.55)
        .lerp(visualPositions[2], 0.24);
      poseHandPart(
        surface.thenar,
        thenarCenter,
        lateralDirection,
        palmDirection,
        new THREE.Vector3(
          handWidth * 0.2 + 0.008 * HAND_SIZE_GAIN,
          palmLength * 0.18 + 0.008 * HAND_SIZE_GAIN,
          handWidth * 0.085 + 0.005 * HAND_SIZE_GAIN,
        ),
      );

      surface.wrapLayers.forEach((layer, layerIndex) => {
        const progress = 0.34 + layerIndex * 0.125;
        const layerCenter = wrist
          .clone()
          .lerp(visualFist, progress)
          .addScaledVector(palmDirection, (layerIndex - 1.5) * 0.0015);
        poseHandPart(
          layer,
          layerCenter,
          lateralDirection,
          palmDirection,
          new THREE.Vector3(
            handWidth * (0.43 + layerIndex * 0.012),
            palmLength * 0.052,
            handWidth * 0.11 + 0.006 * HAND_SIZE_GAIN,
          ),
        );
      });

      const bandEnd = wrist
        .clone()
        .addScaledVector(palmDirection, 0.026 * HAND_SIZE_GAIN);
      const bandStart = wrist
        .clone()
        .addScaledVector(palmDirection, -palmLength * 0.28);
      const bandVector = bandEnd.clone().sub(bandStart);
      poseHandPart(
        surface.wristband,
        bandStart.clone().lerp(bandEnd, 0.5),
        lateralDirection,
        bandVector,
        new THREE.Vector3(
          handWidth * 0.34 + 0.012 * HAND_SIZE_GAIN,
          bandVector.length(),
          handWidth * 0.16 + 0.008 * HAND_SIZE_GAIN,
        ),
      );

      [4, 8, 12, 16, 20].forEach((tipIndex, nailIndex) => {
        const previousIndex = tipIndex - 1;
        const fingerDirection = visualPositions[tipIndex]
          .clone()
          .sub(visualPositions[previousIndex]);
        if (fingerDirection.lengthSq() < 1e-6) fingerDirection.copy(palmDirection);
        const nailNormal = lateralDirection.clone().cross(fingerDirection);
        if (nailNormal.lengthSq() < 1e-6) nailNormal.set(0, 0, 1);
        nailNormal.normalize();
        const nailCenter = visualPositions[tipIndex]
          .clone()
          .addScaledVector(
            fingerDirection.clone().normalize(),
            -0.012 * HAND_SIZE_GAIN,
          )
          .addScaledVector(nailNormal, 0.012 * HAND_SIZE_GAIN);
        const nailWidth = (tipIndex === 4 ? 0.023 : 0.02) * HAND_SIZE_GAIN;
        poseHandPart(
          surface.nails[nailIndex],
          nailCenter,
          lateralDirection,
          fingerDirection,
          new THREE.Vector3(
            nailWidth,
            0.028 * HAND_SIZE_GAIN,
            0.007 * HAND_SIZE_GAIN,
          ),
        );
      });

      visualPositions.forEach((position, index) => {
        handJoints[handIndex][index].position.copy(position);
      });
      CONNECTIONS.forEach(([from, to], index) => {
        setCylinderBetween(
          handBones[handIndex][index],
          visualPositions[from],
          visualPositions[to],
        );
      });

      const forearmPoint = poseTrackedForearmPoint(
        center,
        wrist,
        palmLength,
        handDepthScales[handIndex],
        time,
      );

      const previous = previousHands[handIndex];
      const dt = previous ? clamp((time - previous.at) / 1000, 1 / 120, 0.12) : 1 / 60;
      const wholeHandVelocity = previous
        ? calculateWholeHandVelocity(
            motionPositions,
            previous.landmarks,
            dt,
          )
        : { x: 0, y: 0, z: 0 };
      const fusedVelocity = fuseForearmVelocity(
        wholeHandVelocity,
        forearmPoint,
        previous?.forearmPoint ?? null,
        dt,
      );
      const rawVelocity = new THREE.Vector3(
        fusedVelocity.x,
        fusedVelocity.y,
        fusedVelocity.z,
      );
      const velocity = previous
        ? previous.velocity.clone().lerp(rawVelocity, 0.42)
        : rawVelocity;
      const speed = velocity.length();
      const depthRate = previous
        ? (handDepthScales[handIndex] - previous.depthRatio) / dt
        : 0;
      const localToBag = rawContact.clone().sub(bagCenter);
      const radialDistance = Math.hypot(localToBag.x, localToBag.z);
      previousHands[handIndex] = {
        landmarks: motionPositions.map((position) => position.clone()),
        velocity: velocity.clone(),
        forearmPoint: forearmPoint?.clone() ?? null,
        distance: radialDistance,
        depthRatio: handDepthScales[handIndex],
        at: time,
      };

      if (!active || !previous || time - lastHits[handIndex] < 360) continue;
      const verticalInside = Math.abs(localToBag.y) < bagHeight * 0.58;
      const fastEnough = speed > 0.98;
      const nearSurface = radialDistance < bagRadius + 0.12;
      const crossedSurface = previous.distance >= bagRadius + 0.1;
      const closingSpeed = velocity.dot(
        bagCenter.clone().sub(rawContact).normalize(),
      );
      const approaching = closingSpeed > 0.6;
      const movingTowardCamera = depthRate > 0.34 && -velocity.z > 0.46;
      if (
        verticalInside &&
        fastEnough &&
        nearSurface &&
        crossedSurface &&
        approaching &&
        movingTowardCamera
      ) {
        lastHits[handIndex] = time;
        applyPunch(correctedContact, velocity, speed);
      }
    }
  }

  let previousFrame = performance.now();
  let frameId = 0;
  const bagTopOffsets = [
    new THREE.Vector3(0.28, 0, 0.28),
    new THREE.Vector3(-0.28, 0, 0.28),
    new THREE.Vector3(0.28, 0, -0.28),
    new THREE.Vector3(-0.28, 0, -0.28),
  ];
  const anchorOffsets = [
    new THREE.Vector3(0.12, 0, 0.12),
    new THREE.Vector3(-0.12, 0, 0.12),
    new THREE.Vector3(0.12, 0, -0.12),
    new THREE.Vector3(-0.12, 0, -0.12),
  ];

  function animate(now: number) {
    if (disposed) return;
    frameId = requestAnimationFrame(animate);
    const dt = clamp((now - previousFrame) / 1000, 1 / 120, 1 / 24);
    previousFrame = now;
    world.step(1 / 60, dt, 5);

    bagGroup.position.set(bagBody.position.x, bagBody.position.y, bagBody.position.z);
    bagGroup.quaternion.set(
      bagBody.quaternion.x,
      bagBody.quaternion.y,
      bagBody.quaternion.z,
      bagBody.quaternion.w,
    );
    squash *= Math.pow(0.035, dt);
    const squashScale = bagScale * (1 - squash * 0.12);
    const bulgeScale = bagScale * (1 + squash * 0.085);
    bagGroup.scale.set(bulgeScale, squashScale, bulgeScale);

    const bagTop = new THREE.Vector3(0, bagHeight / 2, 0).applyQuaternion(
      bagGroup.quaternion,
    ).add(bagGroup.position);
    bagTopOffsets.forEach((offset, index) => {
      const topPoint = offset
        .clone()
        .multiplyScalar(bagScale)
        .applyQuaternion(bagGroup.quaternion)
        .add(bagTop);
      const anchorPoint = anchorPosition.clone().add(anchorOffsets[index]);
      setCylinderBetween(chainSegments[index], topPoint, anchorPoint);
    });

    let living = 0;
    for (let i = 0; i < particleCount; i += 1) {
      if (particleLife[i] <= 0) continue;
      particleLife[i] -= dt;
      if (particleLife[i] <= 0) continue;
      living += 1;
      particleVelocities[i].y -= 4.2 * dt;
      particlePositions[i * 3] += particleVelocities[i].x * dt;
      particlePositions[i * 3 + 1] += particleVelocities[i].y * dt;
      particlePositions[i * 3 + 2] += particleVelocities[i].z * dt;
    }
    particleMaterial.opacity = living ? clamp(living / particleCount, 0, 0.85) : 0;
    particleGeometry.attributes.position.needsUpdate = true;

    if (latestHands && now - latestHandsTime > 250) {
      handGroups.forEach((group) => {
        group.visible = false;
      });
    }
    camera.position.x = THREE.MathUtils.lerp(
      camera.position.x,
      0.15 + bagBody.position.x * 0.12,
      0.025,
    );
    camera.position.z = THREE.MathUtils.lerp(
      camera.position.z,
      9.1 + bagBody.position.z * 0.16,
      0.025,
    );
    cameraTarget.lerp(
      new THREE.Vector3(
        bagBody.position.x * 0.48,
        2.8 + (bagBody.position.y - 3.02) * 0.16,
        bagBody.position.z,
      ),
      0.035,
    );
    camera.lookAt(cameraTarget);
    renderer.render(scene, camera);
  }
  frameId = requestAnimationFrame(animate);

  const resizeObserver = new ResizeObserver(() => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(canvas);

  return {
    setTrackingResult: updateHands,
    setPoseResult: updatePose,
    calibrate(calibration) {
      const cameraDistance = clamp(calibration.cameraDistance, 0.42, 1.35);
      const unitsPerImage = clamp(
        cameraDistance / CAMERA_FOCAL_X_NORMALIZED,
        0.52,
        1.5,
      );
      const scale = clamp(
        0.9 + (cameraDistance - 0.78) * 0.06,
        0.86,
        0.96,
      );
      const x = clamp(
        (0.5 - calibration.midpointX) * unitsPerImage * 1.2,
        -0.8,
        0.8,
      );
      const y = clamp(
        3.02 +
          ((0.48 - calibration.midpointY) * unitsPerImage * 0.75) /
            calibration.aspect,
        2.78,
        3.28,
      );
      const z = clamp((0.78 - cameraDistance) * 1.35, -0.78, 0.48);
      setupPhysics(scale, x, y, z);
      const guardGap = clamp(cameraDistance * 0.48, 0.34, 0.52);
      const expectedPunchTravel = clamp(cameraDistance * 0.3, 0.18, 0.32);
      calibratedHandFrame = {
        midpointX: calibration.midpointX,
        midpointY: calibration.midpointY,
        aspect: calibration.aspect,
        palmPairs: [...calibration.palmPairs],
        cameraDistance,
        unitsPerImage,
        bagCenter: { x, y, z },
        bagRadius,
        guardGap,
        punchGain: guardGap / expectedPunchTravel,
      };
      previousHands[0] = null;
      previousHands[1] = null;
      handDepthScales[0] = 1;
      handDepthScales[1] = 1;
      active = true;
      bagBody.wakeUp();
      bagBody.applyImpulse(new CANNON.Vec3(0.7, 0, 0.18));
      return { cameraDistance };
    },
    async enableAudio() {
      if (listener.context.state !== "running") await listener.context.resume();
      if (!audioReady) buildImpactBuffer();
    },
    setAudioEnabled(enabled) {
      audioEnabled = enabled;
      if (!enabled && impactAudio.isPlaying) impactAudio.stop();
    },
    setHitDetection(enabled) {
      active = enabled;
      previousHands[0] = null;
      previousHands[1] = null;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      impactAudio.stop();
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry?.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => material?.dispose());
        }
      });
      floorMap.dispose();
      floorNormal.dispose();
      wrapTexture.dispose();
      skinTexture.dispose();
    },
  };
}

export default function PunchLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<ArenaApi | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const latestPoseResultRef = useRef<PoseLandmarkerResult | null>(null);
  const previousPoseTimeRef = useRef(-1);
  const streamRef = useRef<MediaStream | null>(null);
  const trackingFrameRef = useRef(0);
  const previousVideoTimeRef = useRef(-1);
  const thumbsStartRef = useRef<number | null>(null);
  const calibrationSamplesRef = useRef<Calibration[]>([]);
  const calibrationLockedRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusText, setStatusText] = useState("Camera is off");
  const [handsDetected, setHandsDetected] = useState(0);
  const [thumbProgress, setThumbProgress] = useState(0);
  const [audioOn, setAudioOn] = useState(true);
  const [cameraLive, setCameraLive] = useState(false);
  const [cameraExpanded, setCameraExpanded] = useState(true);
  const [stats, setStats] = useState<SessionStats>({
    hits: 0,
    combo: 0,
    speed: 0,
    force: 0,
    best: 0,
  });
  const comboTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const phaseLabel = useMemo(() => {
    if (phase === "active") return "Tracking live";
    if (phase === "calibrating") return "Calibration active";
    if (phase === "loading") return "Loading hand + arm model";
    if (phase === "error") return "Camera required";
    return "Awaiting camera";
  }, [phase]);

  const onImpact = useCallback((speed: number, force: number) => {
    setStats((previous) => {
      const nextCombo = previous.combo + 1;
      return {
        hits: previous.hits + 1,
        combo: nextCombo,
        speed,
        force,
        best: Math.max(previous.best, force),
      };
    });
    if (comboTimeoutRef.current) clearTimeout(comboTimeoutRef.current);
    comboTimeoutRef.current = setTimeout(() => {
      setStats((previous) => ({ ...previous, combo: 0 }));
    }, 1850);
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    arenaRef.current = createArena(canvasRef.current, onImpact);
    return () => {
      arenaRef.current?.dispose();
      arenaRef.current = null;
      if (comboTimeoutRef.current) clearTimeout(comboTimeoutRef.current);
    };
  }, [onImpact]);

  const drawOverlay = useCallback((result: HandLandmarkerResult) => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 360;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, width, height);
    result.landmarks.forEach((hand, handIndex) => {
      const color = handIndex === 0 ? "#56ffdb" : "#ffc45a";
      ctx.lineWidth = Math.max(2, width / 320);
      ctx.lineCap = "round";
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 9;
      CONNECTIONS.forEach(([from, to]) => {
        ctx.beginPath();
        ctx.moveTo(hand[from].x * width, hand[from].y * height);
        ctx.lineTo(hand[to].x * width, hand[to].y * height);
        ctx.stroke();
      });
      hand.forEach((point, index) => {
        ctx.beginPath();
        ctx.fillStyle = KNUCKLES.includes(index as (typeof KNUCKLES)[number])
          ? "#fff6df"
          : color;
        ctx.arc(
          point.x * width,
          point.y * height,
          KNUCKLES.includes(index as (typeof KNUCKLES)[number]) ? 5 : 3.2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      });
      ctx.shadowBlur = 0;
    });
  }, []);

  useEffect(() => {
    if (phase !== "calibrating" && !(phase === "active" && cameraLive)) return;
    let cancelled = false;

    const trackFrame = () => {
      if (cancelled) return;
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      const poseLandmarker = poseLandmarkerRef.current;
      if (!video || !landmarker || !poseLandmarker || streamRef.current === null) return;
      const now = performance.now();
      if (
        video.readyState >= 2 &&
        video.currentTime !== previousVideoTimeRef.current
      ) {
        previousVideoTimeRef.current = video.currentTime;
        const result = landmarker.detectForVideo(video, now);
        if (now - previousPoseTimeRef.current >= 52) {
          previousPoseTimeRef.current = now;
          const poseResult = poseLandmarker.detectForVideo(video, now);
          latestPoseResultRef.current = poseResult;
          arenaRef.current?.setPoseResult(poseResult, now);
        }
        setHandsDetected(result.landmarks.length);
        drawOverlay(result);
        arenaRef.current?.setTrackingResult(result, now);

        if (phase !== "active") {
          const ready =
            result.landmarks.length === 2 &&
            result.landmarks.every((hand) => isThumbUp(hand));
          if (ready) {
            const aspect =
              (video.videoWidth || 1280) / (video.videoHeight || 720);
            const sample = calculateCalibration(result.landmarks, aspect);
            calibrationSamplesRef.current.push(sample);
            if (calibrationSamplesRef.current.length > 45) {
              calibrationSamplesRef.current.shift();
            }
            if (thumbsStartRef.current === null) {
              thumbsStartRef.current = now;
              calibrationSamplesRef.current = [sample];
            }
            const progress = clamp((now - thumbsStartRef.current) / 900, 0, 1);
            setThumbProgress(progress);
            setStatusText(progress < 1 ? "Hold that pose" : "Range locked");
            if (progress >= 1 && !calibrationLockedRef.current) {
              calibrationLockedRef.current = true;
              const calibration = averageCalibration(
                calibrationSamplesRef.current,
              );
              const mapped = arenaRef.current?.calibrate(calibration);
              setPhase("active");
              setStatusText(
                mapped
                  ? `Range mapped at ${Math.round(mapped.cameraDistance * 100)} cm — punch forward`
                  : "Bag mapped — punch forward",
              );
              setThumbProgress(1);
            }
          } else {
            thumbsStartRef.current = null;
            calibrationSamplesRef.current = [];
            calibrationLockedRef.current = false;
            setThumbProgress(0);
            setStatusText(
              result.landmarks.length < 2
                ? "Bring both hands into frame"
                : "Place hands side by side · thumbs up",
            );
          }
        }
      }
      trackingFrameRef.current = requestAnimationFrame(trackFrame);
    };

    trackingFrameRef.current = requestAnimationFrame(trackFrame);
    return () => {
      cancelled = true;
      cancelAnimationFrame(trackingFrameRef.current);
    };
  }, [cameraLive, drawOverlay, phase]);

  const startCamera = useCallback(async () => {
    setPhase("loading");
    setStatusText("Starting hand tracking…");
    setCameraExpanded(true);
    try {
      await arenaRef.current?.enableAudio();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Camera view unavailable");
      video.srcObject = stream;
      await video.play();

      const { FilesetResolver, HandLandmarker, PoseLandmarker } = await import(
        "@mediapipe/tasks-vision"
      );
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      try {
        landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/mediapipe/models/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.56,
          minHandPresenceConfidence: 0.52,
          minTrackingConfidence: 0.52,
        });
      } catch {
        landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/mediapipe/models/hand_landmarker.task",
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.56,
          minHandPresenceConfidence: 0.52,
          minTrackingConfidence: 0.52,
        });
      }
      try {
        poseLandmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/mediapipe/models/pose_landmarker_lite.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.52,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputSegmentationMasks: false,
        });
      } catch {
        poseLandmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/mediapipe/models/pose_landmarker_lite.task",
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.52,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputSegmentationMasks: false,
        });
      }
      previousPoseTimeRef.current = -1;
      latestPoseResultRef.current = null;
      setCameraLive(true);
      arenaRef.current?.setHitDetection(false);
      calibrationSamplesRef.current = [];
      calibrationLockedRef.current = false;
      setPhase("calibrating");
      setStatusText("Bring both hands into frame");
    } catch (error) {
      console.error(error);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      poseLandmarkerRef.current?.close();
      poseLandmarkerRef.current = null;
      latestPoseResultRef.current = null;
      setCameraLive(false);
      arenaRef.current?.setHitDetection(false);
      setPhase("error");
      setStatusText("Camera unavailable · hand tracking required");
    }
  }, []);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(trackingFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    poseLandmarkerRef.current?.close();
    poseLandmarkerRef.current = null;
    latestPoseResultRef.current = null;
    previousPoseTimeRef.current = -1;
    setCameraLive(false);
    setHandsDetected(0);
    setPhase("idle");
    setStatusText("Camera is off");
    setThumbProgress(0);
    calibrationSamplesRef.current = [];
    calibrationLockedRef.current = false;
  }, []);

  const recalibrate = useCallback(() => {
    arenaRef.current?.setHitDetection(false);
    thumbsStartRef.current = null;
    previousVideoTimeRef.current = -1;
    calibrationSamplesRef.current = [];
    calibrationLockedRef.current = false;
    setThumbProgress(0);
    setHandsDetected(0);
    setPhase("calibrating");
    setStatusText("Bring both hands into frame");
    setCameraExpanded(true);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const toggleAudio = useCallback(async () => {
    const next = !audioOn;
    setAudioOn(next);
    arenaRef.current?.setAudioEnabled(next);
    if (next) await arenaRef.current?.enableAudio();
  }, [audioOn]);

  return (
    <main className="experience-shell" data-phase={phase}>
      <canvas
        ref={canvasRef}
        className="arena-canvas"
        aria-label="3D boxing gym and hand-tracked physics punching bag"
      />
      <div className="vignette" />
      <div className="grain" />

      <header className="topbar">
        <div className="glove-lockup" aria-label="Boxing glove">
          <span className="glove-logo" aria-hidden="true">
            <span className="glove-logo-shape" />
            <span className="glove-logo-cuff" />
          </span>
        </div>
        <div className="system-strip">
          <span className="system-dot" />
          <span>{phaseLabel}</span>
          <button
            className="icon-button"
            type="button"
            onClick={toggleAudio}
            aria-label={audioOn ? "Mute impact audio" : "Enable impact audio"}
            aria-pressed={audioOn}
          >
            {audioOn ? "SOUND ON" : "MUTED"}
          </button>
        </div>
      </header>

      <aside className="stats-rail" aria-label="Punch session statistics">
        <div className="challenge-card">
          <span className="proof-code" aria-label="Screenshot verification number">
            1501
          </span>
          <span className="challenge-kicker">FIRST 20 TO SCORE</span>
          <strong className="challenge-score">1501 N</strong>
          <div
            className="challenge-prize"
            aria-label="One year of Sparcd free at launch"
          >
            <strong aria-hidden="true">
              <span>1 YEAR OF</span>
              <span>SPARCD FREE</span>
            </strong>
            <span className="challenge-launch" aria-hidden="true">
              AT LAUNCH
            </span>
          </div>
          <small className="challenge-details">
            TAG ME + POST YOUR SCORE SCREENSHOT
          </small>
        </div>
        <div className="stat-block stat-primary">
          <span className="stat-label">PUNCH SCORE</span>
          <strong>{stats.force || "—"}</strong>
          <span className="stat-unit">NEWTONS</span>
        </div>
        <div className="stat-block">
          <span className="stat-label">VELOCITY</span>
          <strong>{stats.speed ? stats.speed.toFixed(1) : "—"}</strong>
          <span className="stat-unit">M / S</span>
        </div>
        <div className="stat-pair">
          <div>
            <span className="stat-label">HITS</span>
            <strong>{String(stats.hits).padStart(2, "0")}</strong>
          </div>
          <div>
            <span className="stat-label">COMBO</span>
            <strong>{stats.combo ? `×${stats.combo}` : "—"}</strong>
          </div>
        </div>
        <div className="best-readout">
          <span>SESSION BEST</span>
          <span>{stats.best ? `${stats.best} N` : "NO HITS YET"}</span>
        </div>
      </aside>

      {(phase === "idle" || phase === "loading" || phase === "error") && (
        <section className="intro-panel" aria-labelledby="intro-title">
          <p className="eyebrow">CAMERA-TRACKED BOXING SIMULATION</p>
          <h1 id="intro-title">
            YOUR HANDS.
            <br />
            <em>REAL IMPACT.</em>
          </h1>
          <p className="intro-copy">
            Turn on your camera and keep both hands in frame. Hold two thumbs up
            to map your reach to the 42 kg physics bag — then
            every open-hand or closed-fist strike moves it for real.
          </p>
          <div className="intro-actions">
            <button
              type="button"
              className="primary-button"
              onClick={startCamera}
              disabled={phase === "loading"}
              data-testid="start-camera"
            >
              <span>{phase === "loading" ? "LOADING VISION…" : "START CAMERA"}</span>
              <b aria-hidden="true">↗</b>
            </button>
          </div>
          <div className="privacy-note">
            <span className="privacy-icon">◉</span>
            <span>
              On-device tracking
              <small>Video never leaves your browser</small>
            </span>
          </div>
        </section>
      )}

      {phase === "calibrating" && (
        <section className="calibration-card" data-testid="calibration-card">
          <div className="card-index">01 / CALIBRATE</div>
          <div className="gesture-icon" aria-hidden="true">
            <span>☝</span>
            <span>☝</span>
          </div>
          <h2>SET YOUR RANGE</h2>
          <p>
            Hold both hands side by side
            <br />
            and give two thumbs up.
          </p>
          <div className="calibration-meter">
            <span style={{ width: `${Math.max(4, thumbProgress * 100)}%` }} />
          </div>
          <div className="detection-row">
            <span className={handsDetected === 2 ? "detected" : ""} />
            {handsDetected}/2 HANDS DETECTED
          </div>
        </section>
      )}

      {phase === "active" && stats.hits === 0 && (
        <div className="punch-prompt" data-testid="punch-prompt">
          <span className="prompt-line" />
          <div>
            <strong>THROW YOUR FIRST PUNCH</strong>
            <span>OPEN PALM OR CLOSED FIST</span>
          </div>
        </div>
      )}

      <section
        className={`camera-card ${cameraExpanded ? "expanded" : "collapsed"}`}
        aria-label="Mirrored hand tracking camera"
      >
        <div className="camera-head">
          <div>
            <span className={`live-dot ${cameraLive ? "live" : ""}`} />
            <strong>HAND TRACKING</strong>
            <small>21 LANDMARKS / HAND</small>
          </div>
          <button
            type="button"
            onClick={() => setCameraExpanded((value) => !value)}
            aria-label={cameraExpanded ? "Collapse camera" : "Expand camera"}
          >
            {cameraExpanded ? "−" : "+"}
          </button>
        </div>
        <div className="camera-viewport">
          <video ref={videoRef} muted playsInline aria-label="Camera preview" />
          <canvas
            ref={overlayRef}
            aria-label="Tracked hand landmark overlay"
          />
          {!cameraLive && (
            <div className="camera-placeholder">
              <span>CAMERA</span>
              <small>OFFLINE</small>
            </div>
          )}
          <i className="corner corner-tl" />
          <i className="corner corner-tr" />
          <i className="corner corner-bl" />
          <i className="corner corner-br" />
        </div>
        <div className="camera-status" data-testid="camera-status">
          <span>{statusText}</span>
          {cameraLive && (
            <div className="camera-actions">
              {phase === "active" && (
                <button type="button" onClick={recalibrate}>
                  RECAL
                </button>
              )}
              <button type="button" onClick={stopCamera}>
                STOP
              </button>
            </div>
          )}
        </div>
      </section>

      <footer className="bottombar">
        <div className="physics-tags">
          <span>42 KG RIGID BODY</span>
          <span>6-DOF SWING</span>
          <span>SPATIAL IMPACT AUDIO</span>
        </div>
      </footer>
    </main>
  );
}
