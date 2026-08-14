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
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import type {
  HandLandmarker,
  HandLandmarkerResult,
  NormalizedLandmark,
} from "@mediapipe/tasks-vision";

type Phase = "idle" | "loading" | "calibrating" | "active" | "error";

type SessionStats = {
  hits: number;
  combo: number;
  speed: number;
  force: number;
  best: number;
};

type Calibration = {
  midpointX: number;
  midpointY: number;
  separation: number;
  depth: number;
};

type PunchSample = {
  point: THREE.Vector3;
  velocity: THREE.Vector3;
  speed: number;
  at: number;
};

type ArenaApi = {
  setTrackingResult: (
    result: HandLandmarkerResult,
    time: number,
  ) => void;
  calibrate: (calibration: Calibration) => void;
  manualPunch: (x: number, y: number, power?: number) => void;
  enableAudio: () => Promise<void>;
  setAudioEnabled: (enabled: boolean) => void;
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

const KNUCKLES = [5, 9, 13, 17] as const;

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

function handCenter(hand: NormalizedLandmark[]) {
  const total = KNUCKLES.reduce(
    (acc, index) => {
      acc.x += hand[index].x;
      acc.y += hand[index].y;
      acc.z += hand[index].z;
      return acc;
    },
    { x: 0, y: 0, z: 0 },
  );
  return {
    x: total.x / KNUCKLES.length,
    y: total.y / KNUCKLES.length,
    z: total.z / KNUCKLES.length,
  };
}

function calculateCalibration(hands: NormalizedLandmark[][]): Calibration {
  const first = handCenter(hands[0]);
  const second = handCenter(hands[1]);
  const separation = Math.hypot(first.x - second.x, first.y - second.y);
  return {
    midpointX: (first.x + second.x) / 2,
    midpointY: (first.y + second.y) / 2,
    separation,
    depth: (first.z + second.z) / 2,
  };
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
  ctx.fillStyle = "rgba(255,255,255,.94)";
  ctx.textAlign = "center";
  ctx.font = "900 128px Arial Narrow, Arial";
  ctx.fillText("KINETIQ", 512, 450);
  ctx.fillStyle = "rgba(255,255,255,.56)";
  ctx.font = "600 34px Arial";
  ctx.letterSpacing = "13px";
  ctx.fillText("HEAVY / 42 KG", 512, 525);
  ctx.strokeStyle = "rgba(255,255,255,.32)";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(512, 410, 245, 0, Math.PI * 2);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
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
  const handColors = [0x64ffe0, 0xffc861];
  handGroups.forEach((group, handIndex) => {
    group.visible = false;
    scene.add(group);
    const material = new THREE.MeshStandardMaterial({
      color: handColors[handIndex],
      emissive: handColors[handIndex],
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.72,
      roughness: 0.18,
    });
    for (let i = 0; i < 21; i += 1) {
      const joint = new THREE.Mesh(
        new THREE.SphereGeometry(KNUCKLES.includes(i as (typeof KNUCKLES)[number]) ? 0.075 : 0.048, 10, 8),
        material,
      );
      group.add(joint);
      handJoints[handIndex].push(joint);
    }
    for (let i = 0; i < CONNECTIONS.length; i += 1) {
      const bone = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 1, 7),
        material,
      );
      group.add(bone);
      handBones[handIndex].push(bone);
    }
  });

  function landmarkToWorld(landmark: NormalizedLandmark) {
    return new THREE.Vector3(
      (0.5 - landmark.x) * 7.35,
      (0.55 - landmark.y) * 5.2 + 2.05,
      landmark.z * 9.2 + 0.08,
    );
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
    const force = Math.round(clamp(cappedSpeed * 118 + impulseMagnitude * 21, 180, 1480));
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
        continue;
      }
      group.visible = true;
      const positions = landmarks.map(landmarkToWorld);
      positions.forEach((position, index) => {
        handJoints[handIndex][index].position.copy(position);
      });
      CONNECTIONS.forEach(([from, to], index) => {
        setCylinderBetween(
          handBones[handIndex][index],
          positions[from],
          positions[to],
        );
      });

      const fist = KNUCKLES.reduce(
        (center, index) => center.add(positions[index]),
        new THREE.Vector3(),
      ).multiplyScalar(1 / KNUCKLES.length);
      const previous = previousHands[handIndex];
      const dt = previous ? clamp((time - previous.at) / 1000, 1 / 120, 0.12) : 1 / 60;
      const velocity = previous
        ? fist.clone().sub(previous.point).divideScalar(dt)
        : new THREE.Vector3();
      const speed = velocity.length();
      previousHands[handIndex] = {
        point: fist.clone(),
        velocity: velocity.clone(),
        speed,
        at: time,
      };

      if (!active || !previous || time - lastHits[handIndex] < 280) continue;
      const bagCenter = new THREE.Vector3(
        bagBody.position.x,
        bagBody.position.y,
        bagBody.position.z,
      );
      const localToBag = fist.clone().sub(bagCenter);
      const radialDistance = Math.hypot(localToBag.x, localToBag.z);
      const verticalInside = Math.abs(localToBag.y) < bagHeight * 0.58;
      const fastEnough = speed > 1.18;
      const nearSurface = radialDistance < bagRadius + 0.34;
      const approaching = velocity.dot(bagCenter.clone().sub(fist)) > 0.12;
      if (verticalInside && fastEnough && nearSurface && approaching) {
        lastHits[handIndex] = time;
        applyPunch(fist, velocity, speed);
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
      0.15 + bagBody.position.x * 0.018,
      0.018,
    );
    camera.lookAt(0, 2.8, 0);
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
    calibrate(calibration) {
      const scale = clamp(0.87 + (calibration.separation - 0.16) * 1.45, 0.82, 1.22);
      const x = clamp((0.5 - calibration.midpointX) * 3.6, -1.55, 1.55);
      const y = clamp(3.0 + (0.48 - calibration.midpointY) * 1.45, 2.62, 3.42);
      const z = clamp(calibration.depth * 5.4, -0.65, 0.55);
      setupPhysics(scale, x, y, z);
      active = true;
      bagBody.wakeUp();
      bagBody.applyImpulse(new CANNON.Vec3(0.7, 0, 0.18));
    },
    manualPunch(x, y, power = 1) {
      active = true;
      const point = new THREE.Vector3(
        bagBody.position.x + clamp(x, -1, 1) * bagRadius,
        bagBody.position.y + clamp(y, -1, 1) * bagHeight * 0.35,
        bagBody.position.z + bagRadius,
      );
      const velocity = new THREE.Vector3(-x * 0.38, -y * 0.12, -1)
        .normalize()
        .multiplyScalar(clamp(power, 1.8, 8.2));
      applyPunch(point, velocity, velocity.length());
    },
    async enableAudio() {
      if (listener.context.state !== "running") await listener.context.resume();
      if (!audioReady) buildImpactBuffer();
    },
    setAudioEnabled(enabled) {
      audioEnabled = enabled;
      if (!enabled && impactAudio.isPlaying) impactAudio.stop();
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
    },
  };
}

export default function PunchLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<ArenaApi | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackingFrameRef = useRef(0);
  const previousVideoTimeRef = useRef(-1);
  const thumbsStartRef = useRef<number | null>(null);
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
  const pointerStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const phaseLabel = useMemo(() => {
    if (phase === "active") return "Tracking live";
    if (phase === "calibrating") return "Calibration active";
    if (phase === "loading") return "Loading hand model";
    if (phase === "error") return "Manual mode ready";
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
      if (!video || !landmarker || streamRef.current === null) return;
      const now = performance.now();
      if (
        video.readyState >= 2 &&
        video.currentTime !== previousVideoTimeRef.current
      ) {
        previousVideoTimeRef.current = video.currentTime;
        const result = landmarker.detectForVideo(video, now);
        setHandsDetected(result.landmarks.length);
        drawOverlay(result);
        arenaRef.current?.setTrackingResult(result, now);

        if (phase !== "active") {
          const ready =
            result.landmarks.length === 2 &&
            result.landmarks.every((hand) => isThumbUp(hand));
          if (ready) {
            if (thumbsStartRef.current === null) thumbsStartRef.current = now;
            const progress = clamp((now - thumbsStartRef.current) / 900, 0, 1);
            setThumbProgress(progress);
            setStatusText(progress < 1 ? "Hold that pose" : "Range locked");
            if (progress >= 1) {
              arenaRef.current?.calibrate(calculateCalibration(result.landmarks));
              setPhase("active");
              setStatusText("Bag mapped — throw a punch");
              setThumbProgress(1);
            }
          } else {
            thumbsStartRef.current = null;
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
    setStatusText("Starting camera and hand model…");
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

      const { FilesetResolver, HandLandmarker } = await import(
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
      setCameraLive(true);
      setPhase("calibrating");
      setStatusText("Bring both hands into frame");
    } catch (error) {
      console.error(error);
      setPhase("active");
      setStatusText("Camera unavailable · manual sparring enabled");
      arenaRef.current?.calibrate({
        midpointX: 0.5,
        midpointY: 0.5,
        separation: 0.28,
        depth: 0,
      });
    }
  }, []);

  const useManualMode = useCallback(async () => {
    await arenaRef.current?.enableAudio();
    arenaRef.current?.calibrate({
      midpointX: 0.5,
      midpointY: 0.5,
      separation: 0.28,
      depth: 0,
    });
    setPhase("active");
    setStatusText("Manual sparring · swipe or tap the bag");
  }, []);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(trackingFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    setCameraLive(false);
    setHandsDetected(0);
    setPhase("idle");
    setStatusText("Camera is off");
    setThumbProgress(0);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
    };
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || phase === "loading" || phase === "calibrating") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const duration = Math.max(50, performance.now() - start.time);
    const gestureSpeed = Math.hypot(dx, dy) / duration;
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = -(((event.clientY - rect.top) / rect.height - 0.5) * 2);
    arenaRef.current?.manualPunch(x, y, clamp(2.2 + gestureSpeed * 7, 2.2, 7.8));
    if (phase === "idle" || phase === "error") setPhase("active");
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key.toLowerCase() !== "j" && event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      const side = event.key.toLowerCase() === "j" ? -0.5 : 0.5;
      arenaRef.current?.manualPunch(side, 0.08, 5.4);
      if (phase === "idle") setPhase("active");
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [phase]);

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
        aria-label="Interactive 3D boxing gym and physics punching bag"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      />
      <div className="vignette" />
      <div className="grain" />

      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            K
          </span>
          <span className="brand-word">KINETIQ</span>
          <span className="brand-divider" />
          <span className="brand-sub">PUNCH LAB</span>
        </div>
        <div className="system-strip">
          <span className="system-dot" />
          <span>{phaseLabel}</span>
          <span className="system-rule" />
          <span>THREE.JS / CANNON-ES</span>
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
        <div className="stat-block stat-primary">
          <span className="stat-label">IMPACT</span>
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

      {(phase === "idle" || phase === "loading") && (
        <section className="intro-panel" aria-labelledby="intro-title">
          <p className="eyebrow">CAMERA-TRACKED BOXING SIMULATION</p>
          <h1 id="intro-title">
            YOUR HANDS.
            <br />
            <em>REAL IMPACT.</em>
          </h1>
          <p className="intro-copy">
            Turn on your camera, frame both hands and hold a thumbs-up. We’ll map
            your reach to a 42 kg physics bag — then every open-hand or closed-fist
            strike moves it for real.
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
            <button type="button" className="text-button" onClick={useManualMode}>
              PRACTICE WITHOUT CAMERA
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

      {(phase === "calibrating" || phase === "error") && (
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
            <small>MEDIAPIPE / LIVE</small>
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
          <canvas ref={overlayRef} aria-label="Tracked hand landmark overlay" />
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
            <button type="button" onClick={stopCamera}>
              STOP
            </button>
          )}
          {!cameraLive && phase === "active" && (
            <button type="button" onClick={startCamera}>
              CAMERA
            </button>
          )}
        </div>
      </section>

      <footer className="bottombar">
        <div className="physics-tags">
          <span>42 KG RIGID BODY</span>
          <span>6-DOF SWING</span>
          <span>SPATIAL IMPACT AUDIO</span>
        </div>
        <div className="manual-hint">
          <kbd>J</kbd>
          <kbd>K</kbd>
          <span>or swipe to test the bag</span>
        </div>
      </footer>
    </main>
  );
}
