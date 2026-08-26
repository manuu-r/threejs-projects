"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- A plain root link avoids a vinext client-runtime duplication bug. */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type {
  FaceLandmarker,
  FaceLandmarkerResult,
  HandLandmarker,
  HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import {
  ACTION_LABELS,
  DEFAULT_MAPPINGS,
  GESTURE_LABELS,
  GestureStateMachine,
  classifyHandGesture,
  isFingerNearLips,
  mapCameraTrackingTarget,
  palmMovementSpeed,
  type BehaviorState,
  type GestureMappings,
  type GestureName,
  type GestureObservation,
  type LampAction,
  type Landmark,
} from "./gestureEngine";
import {
  HOP_STEP,
  nextHopDestination,
  sampleBallisticHop,
  sampleHopArmMomentum,
  type BallisticHop,
} from "./hopPhysics";
import { cameraFacingHeadYaw, yawToFace } from "./orientation";
import { DORMANT_LAMP_POSE, WAKE_SETTLE_MS } from "./pose";
import {
  createMusicMotionState,
  resetMusicMotionState,
  sampleMusicMotion,
} from "./musicMotion";
import { createFaceMaskRenderer } from "../punch-power/PunchLab";

type Phase = "idle" | "loading" | "active" | "error";

type LampSettings = {
  reactionSpeed: number;
  smoothness: number;
  brightness: number;
  lightColor: string;
};

type LampPose = {
  baseYaw: number;
  shoulder: number;
  elbow: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  rootZ: number;
};

const LAMP_LIGHT_ENABLED = false;

type LampSceneApi = {
  updateObservation: (observation: GestureObservation | null) => void;
  wakeFromGesture: () => boolean;
  perform: (action: LampAction) => void;
  setSettings: (settings: LampSettings) => void;
  setBeat: (level: number) => void;
  setMusicPlaying: (playing: boolean) => void;
  setMuted: (muted: boolean) => void;
  getPose: () => LampPose;
  dispose: () => void;
};

const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const GESTURES = Object.keys(GESTURE_LABELS) as GestureName[];
const RESPONSE_GESTURES: GestureName[] = [
  "point",
  "palm_move",
  "fist",
  "peace",
  "thumbs_up",
  "thumbs_down",
];

const GESTURE_ICONS: Partial<Record<GestureName, string>> = {
  point: "☝",
  palm_move: "🫲",
  open_palm: "✋",
  fist: "✊",
  peace: "✌",
  thumbs_up: "👍",
  thumbs_down: "👎",
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const radians = THREE.MathUtils.degToRad;
const HEAD_LEVEL_CORRECTION = radians(-3.2);

function createLampScene(
  canvas: HTMLCanvasElement,
  onReady: () => void,
): LampSceneApi {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x061017);
  scene.fog = new THREE.FogExp2(0x061017, 0.24);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 30);
  camera.position.set(-1.42, 1.02, 2.3);
  camera.lookAt(0.12, 0.55, 0);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const environmentRenderTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = environmentRenderTarget.texture;
  scene.environmentIntensity = 0.82;
  pmremGenerator.dispose();

  scene.add(new THREE.HemisphereLight(0xd9f8ff, 0x142027, 2.2));
  scene.add(new THREE.AmbientLight(0xaed3df, 0.72));
  const key = new THREE.DirectionalLight(0xffbd75, 4.4);
  key.position.set(2.5, 3.2, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  const rim = new THREE.PointLight(0x45dfff, 11, 6, 1.8);
  rim.position.set(-1.35, 1.3, -1.35);
  scene.add(rim);
  const frontFill = new THREE.DirectionalLight(0xe8fbff, 3.4);
  frontFill.position.set(-1.5, 1.7, 3.8);
  scene.add(frontFill);
  const faceFill = new THREE.PointLight(0xffe7c2, 6.8, 5.5, 1.45);
  faceFill.position.set(-0.9, 1.25, 2.15);
  scene.add(faceFill);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 128),
    new THREE.MeshPhysicalMaterial({
      color: 0x081820,
      metalness: 0.48,
      roughness: 0.22,
      clearcoat: 0.35,
      clearcoatRoughness: 0.28,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const lampSpotTarget = new THREE.Object3D();
  scene.add(lampSpotTarget);
  const lampSpot = new THREE.SpotLight(
    0xffa24a,
    LAMP_LIGHT_ENABLED ? 180 : 0,
    7,
    radians(31),
    0.72,
    1.25,
  );
  lampSpot.castShadow = true;
  lampSpot.shadow.mapSize.set(1024, 1024);
  lampSpot.shadow.bias = -0.00015;
  lampSpot.target = lampSpotTarget;
  lampSpot.visible = false;
  scene.add(lampSpot);

  const floorGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffa24a,
    transparent: true,
    opacity: 0.34,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const floorGlow = new THREE.Mesh(new THREE.CircleGeometry(0.62, 64), floorGlowMaterial);
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.y = 0.008;
  floorGlow.frustumCulled = false;
  floorGlow.visible = false;
  scene.add(floorGlow);

  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = 128;
  glowCanvas.height = 128;
  const glowContext = glowCanvas.getContext("2d");
  if (glowContext) {
    const gradient = glowContext.createRadialGradient(64, 64, 3, 64, 64, 63);
    gradient.addColorStop(0, "rgba(255,255,238,1)");
    gradient.addColorStop(0.2, "rgba(255,189,92,0.9)");
    gradient.addColorStop(0.58, "rgba(255,144,48,0.22)");
    gradient.addColorStop(1, "rgba(255,128,32,0)");
    glowContext.fillStyle = gradient;
    glowContext.fillRect(0, 0, 128, 128);
  }
  const bulbGlowTexture = new THREE.CanvasTexture(glowCanvas);
  bulbGlowTexture.colorSpace = THREE.SRGBColorSpace;
  const bulbGlowMaterial = new THREE.SpriteMaterial({
    map: bulbGlowTexture,
    color: 0xffb15a,
    transparent: true,
    opacity: 0.58,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const bulbGlow = new THREE.Sprite(bulbGlowMaterial);
  bulbGlow.scale.set(0.48, 0.48, 1);
  bulbGlow.frustumCulled = false;
  bulbGlow.visible = false;
  scene.add(bulbGlow);

  const rings = new THREE.Group();
  for (const radius of [0.53, 0.88, 1.3, 1.82]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius, radius + 0.004, 128),
      new THREE.MeshBasicMaterial({ color: 0x2b6f7b, transparent: true, opacity: 0.2 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    rings.add(ring);
  }
  scene.add(rings);

  const dustCount = 170;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let index = 0; index < dustCount; index += 1) {
    dustPositions[index * 3] = (Math.random() - 0.5) * 4.5;
    dustPositions[index * 3 + 1] = Math.random() * 2.2;
    dustPositions[index * 3 + 2] = (Math.random() - 0.5) * 3.2;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({ color: 0x91ecff, size: 0.007, transparent: true, opacity: 0.22 }),
  );
  scene.add(dust);

  let lamp: THREE.Object3D | null = null;
  let baseYaw: THREE.Object3D | null = null;
  let shoulder: THREE.Object3D | null = null;
  let elbow: THREE.Object3D | null = null;
  let headPitch: THREE.Object3D | null = null;
  let headYaw: THREE.Object3D | null = null;
  let eyeLeft: THREE.Object3D | null = null;
  let eyeRight: THREE.Object3D | null = null;
  let pupilLeft: THREE.Object3D | null = null;
  let pupilRight: THREE.Object3D | null = null;
  let bulb: THREE.Mesh | null = null;
  let eyeLeftScale = new THREE.Vector3(1, 1, 1);
  let eyeRightScale = new THREE.Vector3(1, 1, 1);
  let pupilLeftScale = new THREE.Vector3(1, 1, 1);
  let pupilRightScale = new THREE.Vector3(1, 1, 1);
  let headYawRestY = 0;
  let eyeFade = 1;
  const blinkMaterials: Array<{ material: THREE.Material; opacity: number }> = [];
  let lampFloorY = 0.003;

  const lampLight = new THREE.PointLight(
    0xff8a35,
    LAMP_LIGHT_ENABLED ? 36 : 0,
    4.2,
    1.45,
  );
  scene.add(lampLight);
  const bulbWorld = new THREE.Vector3();
  const headWorldQuaternion = new THREE.Quaternion();
  const headForwardBasis = new THREE.Vector3(0, 0, 1);
  const headForward = new THREE.Vector3();
  const beamDirection = new THREE.Vector3();
  const beamOrigin = new THREE.Vector3();
  const beamTargetPoint = new THREE.Vector3();

  new GLTFLoader().load(
    "/lamp/character-lamp.glb",
    (gltf) => {
      lamp = gltf.scene;
      lamp.scale.setScalar(1.18);
      lamp.position.set(0.22, 0, 0);
      lamp.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
          object.frustumCulled = false;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (!(material instanceof THREE.MeshStandardMaterial)) continue;
            material.envMapIntensity = 1.35;
            if (material.name === "Lamp Graphite") {
              material.color.multiplyScalar(1.9);
              material.emissive.set(0x162a31);
              material.emissiveIntensity = 0.72;
            } else if (material.name === "Lamp Spring Steel") {
              material.color.multiplyScalar(1.3);
              material.emissive.set(0x091216);
              material.emissiveIntensity = 0.38;
            } else if (material.name === "Luxo Graphite Metal") {
              material.color.set(0x10252d);
              material.envMapIntensity = 1.3;
            } else if (material.name === "Luxo Spring Steel") {
              material.color.set(0x526c76);
              material.envMapIntensity = 1.75;
            } else if (material.name === "Luxo Pearl Blue Enamel") {
              material.color.set(0x315c6d);
              material.envMapIntensity = 1.45;
            } else if (material.name === "Luxo Porcelain Face") {
              material.color.set(0xd8c69e);
              material.envMapIntensity = 1.05;
            } else if (material.name === "Luxo Teal Iris") {
              material.color.set(0x009aa3);
              material.envMapIntensity = 1.3;
            } else if (material.name === "Luxo Champagne Accent") {
              material.color.set(0xb36c24);
              material.envMapIntensity = 1.8;
            } else if (material.name === "Luxo Eye White") {
              material.color.set(0xf4e6c4);
            } else if (material.name === "Luxo Eye Rim") {
              material.color.set(0x071a20);
            }
          }
        }
      });
      baseYaw = lamp.getObjectByName("BaseYaw") ?? null;
      shoulder = lamp.getObjectByName("Shoulder") ?? null;
      elbow = lamp.getObjectByName("Elbow") ?? null;
      headPitch = lamp.getObjectByName("HeadPitch") ?? null;
      headYaw = lamp.getObjectByName("HeadYaw") ?? null;
      eyeLeft = lamp.getObjectByName("EyeLeft") ?? null;
      eyeRight = lamp.getObjectByName("EyeRight") ?? null;
      pupilLeft = lamp.getObjectByName("PupilLeft") ?? null;
      pupilRight = lamp.getObjectByName("PupilRight") ?? null;
      bulb = (lamp.getObjectByName("LampBulb") as THREE.Mesh | undefined) ?? null;
      if (bulb?.material instanceof THREE.MeshStandardMaterial) {
        bulb.material.emissiveIntensity = 0;
      }
      eyeLeftScale = eyeLeft?.scale.clone() ?? eyeLeftScale;
      eyeRightScale = eyeRight?.scale.clone() ?? eyeRightScale;
      pupilLeftScale = pupilLeft?.scale.clone() ?? pupilLeftScale;
      pupilRightScale = pupilRight?.scale.clone() ?? pupilRightScale;

      // Put the arm plane front-to-back so its elbow recedes behind the base,
      // then turn only the head back toward the viewer.
      lamp.updateMatrixWorld(true);
      const base = lamp.getObjectByName("Base");
      if (base && elbow && eyeLeft && eyeRight && pupilLeft && pupilRight && headYaw) {
        const getFaceFrame = () => {
          const eyeCenter = eyeLeft!.getWorldPosition(new THREE.Vector3())
            .add(eyeRight!.getWorldPosition(new THREE.Vector3()))
            .multiplyScalar(0.5);
          const pupilCenter = pupilLeft!.getWorldPosition(new THREE.Vector3())
            .add(pupilRight!.getWorldPosition(new THREE.Vector3()))
            .multiplyScalar(0.5);
          return { eyeCenter, pupilCenter };
        };
        const { eyeCenter, pupilCenter } = getFaceFrame();
        const authoredForward = pupilCenter.clone().sub(eyeCenter).setY(0).normalize();

        headYaw.getWorldQuaternion(headWorldQuaternion);
        headForwardBasis.copy(authoredForward).applyQuaternion(
          headWorldQuaternion.clone().invert(),
        );

        const baseCenter = base.getWorldPosition(new THREE.Vector3());
        const elbowCenter = elbow.getWorldPosition(new THREE.Vector3());
        const armTowardElbow = elbowCenter.sub(baseCenter).setY(0).normalize();
        const awayFromViewer = baseCenter.clone().sub(camera.position).setY(0).normalize();
        lamp.rotation.y = yawToFace(armTowardElbow, awayFromViewer);
        lamp.updateMatrixWorld(true);

        // A separate neck correction keeps the face square to the viewer while
        // the elbow remains behind. A second pass removes the small perspective
        // error caused by the face moving around its physical neck pivot.
        for (let pass = 0; pass < 2; pass += 1) {
          const alignedFace = getFaceFrame();
          const faceForward = alignedFace.pupilCenter.clone()
            .sub(alignedFace.eyeCenter)
            .setY(0)
            .normalize();
          const towardViewer = camera.position.clone()
            .sub(alignedFace.pupilCenter)
            .setY(0)
            .normalize();
          headYawRestY += yawToFace(faceForward, towardViewer);
          headYaw.rotation.y = headYawRestY;
          lamp.updateMatrixWorld(true);
        }
      }

      for (const part of [eyeLeft, eyeRight, pupilLeft, pupilRight]) {
        part?.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
          const blinkableMaterials = sourceMaterials.map((sourceMaterial) => {
            const material = sourceMaterial.clone();
            material.transparent = true;
            material.depthWrite = false;
            blinkMaterials.push({ material, opacity: material.opacity });
            if (material instanceof THREE.MeshStandardMaterial) {
              if (material.name === "Luxo Eye White") {
                material.emissive.set(0x12353d);
                material.emissiveIntensity = 0.24;
              } else if (material.name === "Luxo Eye Catchlight") {
                material.emissive.set(0xffa84f);
                material.emissiveIntensity = 1.6;
                material.toneMapped = false;
              }
            }
            return material;
          });
          object.material = Array.isArray(object.material) ? blinkableMaterials : blinkableMaterials[0];
        });
      }
      const bounds = new THREE.Box3().setFromObject(lamp);
      lampFloorY = 0.003 - bounds.min.y;
      lamp.position.y = lampFloorY;
      scene.add(lamp);
      onReady();
    },
    undefined,
    () => onReady(),
  );

  let observation: GestureObservation | null = null;
  let trackingMode: "follow" | "point" | null = null;
  let currentAction: LampAction | null = null;
  let actionStarted = 0;
  let wakeStarted = -Infinity;
  let wakeSettlesAt = 0;
  let dormant = true;
  let paused = false;
  let locked = false;
  let sleeping = false;
  let muted = false;
  let musicLevel = 0;
  let musicPlaying = false;
  const musicMotionState = createMusicMotionState();
  let travelTargetZ = 0;
  let activeHop: BallisticHop | null = null;
  let settings: LampSettings = {
    reactionSpeed: 1,
    smoothness: 0.7,
    brightness: 0.82,
    lightColor: "#ff9b43",
  };
  const pose: LampPose = { ...DORMANT_LAMP_POSE };
  const lockedPose: LampPose = { ...pose };
  let filteredTrackingTarget: ReturnType<typeof mapCameraTrackingTarget> | null = null;

  const startInPlaceHop = () => {
    if (activeHop) return false;
    activeHop = { fromZ: pose.rootZ, toZ: pose.rootZ, startedAt: elapsed };
    return true;
  };

  const wakeFromGesture = () => {
    if (!dormant) return false;
    const now = performance.now();
    dormant = false;
    sleeping = false;
    paused = false;
    locked = false;
    trackingMode = null;
    filteredTrackingTarget = null;
    currentAction = "wake";
    actionStarted = now;
    wakeStarted = now;
    wakeSettlesAt = now + WAKE_SETTLE_MS;
    return true;
  };

  const perform = (action: LampAction) => {
    currentAction = action;
    const now = performance.now();
    actionStarted = now;
    if (action === "freeze") {
      paused = true;
      trackingMode = null;
      filteredTrackingTarget = null;
    } else if (action === "pause") {
      paused = true;
    } else if (action === "follow_palm") {
      paused = false;
      locked = false;
      sleeping = false;
      trackingMode = "follow";
      filteredTrackingTarget = null;
    } else if (action === "point_light") {
      paused = false;
      locked = false;
      sleeping = false;
      trackingMode = "point";
      filteredTrackingTarget = null;
    } else if (action === "friendly") {
      paused = false;
      sleeping = false;
      locked = false;
      startInPlaceHop();
    } else if (action === "lock") {
      locked = true;
      trackingMode = null;
      filteredTrackingTarget = null;
      Object.assign(lockedPose, pose);
    } else if (action === "sleep") {
      sleeping = true;
      paused = false;
      trackingMode = null;
      filteredTrackingTarget = null;
    } else if (action === "wake") {
      dormant = false;
      sleeping = false;
      paused = false;
      locked = false;
      wakeStarted = now;
      wakeSettlesAt = now + WAKE_SETTLE_MS;
    } else if (action === "closer" || action === "back") {
      paused = false;
      sleeping = false;
      locked = false;
      const travelStep = action === "closer" ? HOP_STEP : -HOP_STEP;
      travelTargetZ = clamp(travelTargetZ + travelStep, -0.5, 0.5);
    }
  };

  const resize = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  let previousFrameTime = performance.now();
  let elapsed = 0;
  let frame = 0;
  let nextBlink = 2.1;
  let blinkUntil = 0;
  const animate = () => {
    frame = requestAnimationFrame(animate);
    const frameTime = performance.now();
    const dt = Math.min((frameTime - previousFrameTime) / 1000, 1 / 24);
    previousFrameTime = frameTime;
    elapsed += dt;
    const actionTime = (frameTime - actionStarted) / 1000;
    const wakeProgress = clamp((frameTime - wakeStarted) / WAKE_SETTLE_MS, 0, 1);
    const wakeSettling = frameTime < wakeSettlesAt;
    const musicMotion = sampleMusicMotion(
      musicMotionState,
      musicLevel,
      musicPlaying,
      elapsed,
      dt,
    );
    const targets: LampPose = { ...pose };

    if (!dormant && !paused && !locked && !sleeping) {
      const idleAmount = wakeSettling ? 0 : 1;
      targets.baseYaw = Math.sin(elapsed * 0.42) * 0.018 * idleAmount;
      targets.shoulder = Math.sin(elapsed * 0.62) * 0.006 * idleAmount;
      targets.elbow = Math.sin(elapsed * 0.52 + 1.1) * 0.009 * idleAmount;
      targets.headPitch = Math.sin(elapsed * 0.8) * 0.012 * idleAmount;
      targets.headYaw = 0;
      targets.headRoll = 0;
    }

    if (!wakeSettling && !dormant && !paused && !locked && !sleeping && trackingMode && observation?.palm) {
      const cameraTarget = mapCameraTrackingTarget(
        observation.palm,
        trackingMode === "point" ? observation.direction : undefined,
      );
      filteredTrackingTarget ??= {
        baseYaw: pose.baseYaw,
        shoulder: pose.shoulder,
        elbow: pose.elbow,
        headPitch: pose.headPitch,
        headYaw: pose.headYaw,
      };
      const trackingDamping = 5.2;
      const trackingDeadband = radians(0.45);
      for (const key of ["baseYaw", "shoulder", "elbow", "headPitch", "headYaw"] as const) {
        if (Math.abs(cameraTarget[key] - filteredTrackingTarget[key]) > trackingDeadband) {
          filteredTrackingTarget[key] = THREE.MathUtils.damp(
            filteredTrackingTarget[key],
            cameraTarget[key],
            trackingDamping,
            dt,
          );
        }
        targets[key] = filteredTrackingTarget[key];
      }
    }

    if (locked) Object.assign(targets, lockedPose);
    if (dormant) {
      Object.assign(targets, DORMANT_LAMP_POSE);
    } else if (sleeping) {
      targets.baseYaw = DORMANT_LAMP_POSE.baseYaw;
      targets.shoulder = DORMANT_LAMP_POSE.shoulder;
      targets.elbow = DORMANT_LAMP_POSE.elbow;
      targets.headPitch = DORMANT_LAMP_POSE.headPitch;
      targets.headYaw = DORMANT_LAMP_POSE.headYaw;
      targets.headRoll = DORMANT_LAMP_POSE.headRoll;
    }

    const canDance = musicPlaying && !paused && !locked && !sleeping && !wakeSettling;
    if (canDance) {
      targets.baseYaw += musicMotion.baseYaw;
      targets.shoulder += musicMotion.shoulder;
      targets.elbow += musicMotion.elbow;
      targets.headPitch += musicMotion.headPitch;
      targets.headRoll += musicMotion.headRoll;
      targets.headYaw += musicMotion.headYaw;
      if (musicMotion.shouldHop && startInPlaceHop()) {
        currentAction = "friendly";
        actionStarted = frameTime;
      }
    }

    if (!activeHop && Math.abs(travelTargetZ - pose.rootZ) > 0.0001) {
      activeHop = {
        fromZ: pose.rootZ,
        toZ: nextHopDestination(pose.rootZ, travelTargetZ),
        startedAt: elapsed,
      };
    }
    let hopLift = 0;
    if (activeHop) {
      const hop = sampleBallisticHop(activeHop, elapsed);
      const momentum = sampleHopArmMomentum(activeHop, hop);
      targets.shoulder += momentum.shoulder;
      targets.elbow += momentum.elbow;
      targets.headPitch += momentum.headPitch;
      targets.headRoll += momentum.headRoll;
      pose.rootZ = hop.z;
      hopLift = hop.lift;
      if (hop.landed) {
        pose.rootZ = activeHop.toZ;
        activeHop = null;
      }
    }

    let gestureLift = 0;
    if (currentAction === "friendly" && actionTime < 1.8 && !wakeSettling) {
      const friendlyEnvelope = 1 - clamp(actionTime / 1.8, 0, 1);
      targets.baseYaw += Math.sin(actionTime * Math.PI * 2.3) * 0.14 * friendlyEnvelope;
      targets.headRoll += Math.sin(actionTime * Math.PI * 3.4) * 0.07 * friendlyEnvelope;
    }
    if (wakeSettling) {
      const wakeArc = Math.sin(wakeProgress * Math.PI);
      targets.headPitch -= wakeArc * 0.055;
      targets.headRoll += wakeArc * 0.025;
      gestureLift = wakeArc * 0.028;
    }
    if (currentAction === "mute" && actionTime < 1.2 && !wakeSettling) {
      targets.headPitch += 0.24;
      targets.headRoll -= 0.09;
    }
    const damping = 4.2 + (1 - settings.smoothness) * 8.5;
    pose.baseYaw = THREE.MathUtils.damp(pose.baseYaw, targets.baseYaw, damping, dt);
    pose.shoulder = THREE.MathUtils.damp(pose.shoulder, targets.shoulder, damping, dt);
    pose.elbow = THREE.MathUtils.damp(pose.elbow, targets.elbow, damping, dt);
    pose.headPitch = THREE.MathUtils.damp(pose.headPitch, targets.headPitch, damping + 1, dt);
    pose.headYaw = THREE.MathUtils.damp(pose.headYaw, targets.headYaw, damping + 1, dt);
    pose.headRoll = THREE.MathUtils.damp(pose.headRoll, targets.headRoll, damping + 1, dt);

    if (baseYaw) baseYaw.rotation.y = pose.baseYaw;
    if (shoulder) shoulder.rotation.x = pose.shoulder;
    if (elbow) elbow.rotation.x = pose.elbow;
    if (headPitch) headPitch.rotation.x = pose.headPitch;
    if (headYaw) {
      headYaw.rotation.y = cameraFacingHeadYaw(
        headYawRestY,
        pose.headYaw,
        pose.baseYaw,
      );
      headYaw.rotation.z = HEAD_LEVEL_CORRECTION + pose.headRoll;
    }
    if (lamp) {
      lamp.position.z = pose.rootZ;
      const lift = Math.max(hopLift, gestureLift);
      const airborneY = lampFloorY + lift;
      lamp.position.y = lift > 0
        ? airborneY
        : THREE.MathUtils.damp(lamp.position.y, lampFloorY, 12, dt);
    }

    if (elapsed >= nextBlink) {
      blinkUntil = elapsed + 0.13;
      nextBlink = elapsed + 2.7 + Math.random() * 3.1;
    }
    const gestureBlink = currentAction !== null && (
      (actionTime >= 0.06 && actionTime < 0.17) ||
      (actionTime >= 0.27 && actionTime < 0.38)
    );
    const forcedBlink = gestureBlink || dormant || (sleeping && actionTime >= 0.44);
    const blinkTarget = elapsed < blinkUntil || forcedBlink ? 0 : 1;
    eyeFade = THREE.MathUtils.damp(eyeFade, blinkTarget, 32, dt);
    const eyeSquash = 0.04 + eyeFade * 0.96;
    const pupilScale = 0.06 + eyeFade * 0.94;
    if (eyeLeft) eyeLeft.scale.y = eyeLeftScale.y * eyeSquash;
    if (eyeRight) eyeRight.scale.y = eyeRightScale.y * eyeSquash;
    if (pupilLeft) pupilLeft.scale.copy(pupilLeftScale).multiplyScalar(pupilScale);
    if (pupilRight) pupilRight.scale.copy(pupilRightScale).multiplyScalar(pupilScale);
    for (const entry of blinkMaterials) entry.material.opacity = entry.opacity * eyeFade;
    const lightColor = new THREE.Color(settings.lightColor);
    const visibleBrightness = LAMP_LIGHT_ENABLED ? 0.5 + settings.brightness * 0.5 : 0;
    const sleepFactor = sleeping ? 0.72 : 1;
    const reactiveBeat = muted ? 0 : musicMotion.envelope;
    const pulse = 1 + reactiveBeat * 0.85;
    lampLight.color.lerp(lightColor, 0.18);
    lampLight.intensity = THREE.MathUtils.damp(
      lampLight.intensity,
      44 * visibleBrightness * sleepFactor * pulse,
      8,
      dt,
    );
    lampSpot.color.lerp(lightColor, 0.18);
    lampSpot.intensity = THREE.MathUtils.damp(
      lampSpot.intensity,
      210 * visibleBrightness * sleepFactor * pulse,
      8,
      dt,
    );
    floorGlowMaterial.color.lerp(lightColor, 0.18);
    bulbGlowMaterial.color.lerp(lightColor, 0.18);
    floorGlowMaterial.opacity = THREE.MathUtils.damp(
      floorGlowMaterial.opacity,
      0.42 * visibleBrightness * sleepFactor,
      8,
      dt,
    );
    bulbGlowMaterial.opacity = THREE.MathUtils.damp(
      bulbGlowMaterial.opacity,
      0.72 * visibleBrightness * sleepFactor * pulse,
      8,
      dt,
    );
    if (bulb && headYaw) {
      lampSpot.visible = LAMP_LIGHT_ENABLED;
      floorGlow.visible = LAMP_LIGHT_ENABLED;
      bulbGlow.visible = LAMP_LIGHT_ENABLED;
      bulb.getWorldPosition(bulbWorld);
      lampLight.position.copy(bulbWorld);
      headYaw.getWorldQuaternion(headWorldQuaternion);
      headForward.copy(headForwardBasis).applyQuaternion(headWorldQuaternion).normalize();
      beamDirection.copy(headForward);
      beamDirection.y = Math.min(beamDirection.y - 0.58, -0.24);
      beamDirection.normalize();
      beamOrigin.copy(bulbWorld).addScaledVector(headForward, 0.085);
      const floorDistance = clamp((0.012 - beamOrigin.y) / beamDirection.y, 0.72, 4.3);
      beamTargetPoint.copy(beamOrigin).addScaledVector(beamDirection, floorDistance);
      lampSpot.position.copy(beamOrigin);
      lampSpotTarget.position.copy(beamTargetPoint);
      floorGlow.position.set(beamTargetPoint.x, 0.008, beamTargetPoint.z);
      const poolScale = 0.85 + floorDistance * 0.1;
      floorGlow.scale.set(poolScale, poolScale, poolScale);
      bulbGlow.position.copy(beamOrigin);
      const material = bulb.material as THREE.MeshStandardMaterial;
      if (material.emissive) material.emissive.copy(lightColor);
      material.emissiveIntensity = LAMP_LIGHT_ENABLED
        ? 4.2 + visibleBrightness * 5.2 * sleepFactor * pulse
        : 0;
    }
    musicLevel *= Math.pow(0.05, dt);
    dust.rotation.y += dt * 0.012;
    rings.rotation.z -= dt * 0.01;
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(animate);

  return {
    updateObservation(next) {
      observation = next;
    },
    wakeFromGesture,
    perform,
    setSettings(next) {
      settings = next;
    },
    setBeat(level) {
      musicLevel = clamp(level, 0, 1);
    },
    setMusicPlaying(next) {
      if (next && !musicPlaying) {
        resetMusicMotionState(musicMotionState, elapsed);
        wakeFromGesture();
      }
      musicPlaying = next;
      if (!next) musicLevel = 0;
    },
    setMuted(next) {
      muted = next;
    },
    getPose() {
      return { ...pose };
    },
    dispose() {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      bulbGlowTexture.dispose();
      bulbGlowMaterial.dispose();
      environmentRenderTarget.dispose();
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
    },
  };
}

export default function LampLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const faceMaskCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sceneRef = useRef<LampSceneApi | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const faceMaskRendererRef = useRef<ReturnType<typeof createFaceMaskRenderer> | null>(null);
  const latestFaceRef = useRef<FaceLandmarkerResult | null>(null);
  const trackingFrameRef = useRef(0);
  const previousVideoTimeRef = useRef(-1);
  const previousFaceTimeRef = useRef(-1);
  const stateMachineRef = useRef(new GestureStateMachine());
  const wakeInputLockUntilRef = useRef(0);
  const coverStartRef = useRef<number | null>(null);
  const previousPalmSampleRef = useRef<{ palm: Landmark; at: number } | null>(null);
  const movingPalmUntilRef = useRef(0);
  const lastUiUpdateRef = useRef(0);
  const mappingsRef = useRef<GestureMappings>(DEFAULT_MAPPINGS);
  const reactionSpeedRef = useRef(1);
  const actionHandlerRef = useRef<(action: LampAction, observation: GestureObservation) => void>(() => undefined);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const recordingRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const musicUrlRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [modelReady, setModelReady] = useState(false);
  const [cameraLive, setCameraLive] = useState(false);
  const [cameraExpanded, setCameraExpanded] = useState(true);
  const [muted, setMuted] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicName, setMusicName] = useState("No local track");
  const [recording, setRecording] = useState(false);
  const [statusText, setStatusText] = useState("Camera is off");
  const [handsDetected, setHandsDetected] = useState(0);
  const [behaviorState, setBehaviorState] = useState<BehaviorState>("Idle");
  const [candidateProgress, setCandidateProgress] = useState(0);
  const [currentGesture, setCurrentGesture] = useState<GestureName | null>(null);
  const [lastAction, setLastAction] = useState<LampAction | null>(null);
  const [mappings, setMappings] = useState<GestureMappings>(DEFAULT_MAPPINGS);
  const [settings] = useState<LampSettings>({
    reactionSpeed: 1,
    smoothness: 0.7,
    brightness: 0.82,
    lightColor: "#ff9b43",
  });

  useEffect(() => {
    let cancelled = false;
    const saved = localStorage.getItem("lamp-gesture-mappings");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as Partial<GestureMappings>;
      queueMicrotask(() => {
        if (!cancelled) {
          setMappings({
            ...Object.fromEntries(
              GESTURES.map((gesture) => [gesture, parsed[gesture] ?? DEFAULT_MAPPINGS[gesture]]),
            ) as GestureMappings,
            palm_move: "follow_palm",
          });
        }
      });
    } catch {
      localStorage.removeItem("lamp-gesture-mappings");
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    mappingsRef.current = mappings;
    localStorage.setItem("lamp-gesture-mappings", JSON.stringify(mappings));
  }, [mappings]);

  useEffect(() => {
    reactionSpeedRef.current = settings.reactionSpeed;
    sceneRef.current?.setSettings(settings);
  }, [settings]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    sceneRef.current = createLampScene(canvas, () => setModelReady(true));
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = faceMaskCanvasRef.current;
    if (!canvas) return;
    faceMaskRendererRef.current = createFaceMaskRenderer(canvas);
    return () => {
      faceMaskRendererRef.current?.dispose();
      faceMaskRendererRef.current = null;
    };
  }, []);

  const ensureAudioContext = useCallback(() => {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    void audioContextRef.current.resume();
    return audioContextRef.current;
  }, []);

  const playPersonalitySound = useCallback((action: LampAction) => {
    if (muted) return;
    const context = ensureAudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const frequencies: Partial<Record<LampAction, number>> = {
      friendly: 760,
      closer: 540,
      back: 390,
      wake: 690,
    };
    oscillator.frequency.value = frequencies[action] ?? 460;
    oscillator.type = action === "friendly" || action === "wake" ? "sine" : "triangle";
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.075, context.currentTime + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.22);
  }, [ensureAudioContext, muted]);

  const performAction = useCallback((action: LampAction) => {
    sceneRef.current?.perform(action);
    setLastAction(action);
    if (action === "mute") {
      if (audioRef.current) audioRef.current.muted = true;
      setMuted(true);
      sceneRef.current?.setMuted(true);
    } else if (action === "wake") {
      setMuted(false);
      if (audioRef.current) audioRef.current.muted = false;
      sceneRef.current?.setMuted(false);
    }
    playPersonalitySound(action);
  }, [playPersonalitySound]);

  useEffect(() => {
    actionHandlerRef.current = performAction;
  }, [performAction]);

  const drawOverlay = useCallback((
    hands: HandLandmarkerResult,
    face: FaceLandmarkerResult | null,
    observation: GestureObservation | null,
  ) => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 360;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    faceMaskRendererRef.current?.update(face, width, height);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.lineCap = "round";
    hands.landmarks.forEach((hand, handIndex) => {
      const color = handIndex === 0 ? "#62e9ff" : "#ffad4a";
      context.strokeStyle = color;
      context.fillStyle = color;
      context.lineWidth = Math.max(2, width / 360);
      context.shadowColor = color;
      context.shadowBlur = 8;
      HAND_CONNECTIONS.forEach(([from, to]) => {
        context.beginPath();
        context.moveTo(hand[from].x * width, hand[from].y * height);
        context.lineTo(hand[to].x * width, hand[to].y * height);
        context.stroke();
      });
      hand.forEach((point, index) => {
        context.beginPath();
        context.arc(point.x * width, point.y * height, index === 8 ? 4.8 : 2.5, 0, Math.PI * 2);
        context.fill();
      });
    });
    if (observation?.direction && hands.landmarks[0]?.[8]) {
      const tip = hands.landmarks[0][8];
      context.strokeStyle = "#fff4df";
      context.setLineDash([6, 7]);
      context.beginPath();
      context.moveTo(tip.x * width, tip.y * height);
      context.lineTo(
        (tip.x + observation.direction.x * 0.24) * width,
        (tip.y + observation.direction.y * 0.24) * height,
      );
      context.stroke();
      context.setLineDash([]);
    }
    context.shadowBlur = 0;
  }, []);

  useEffect(() => {
    if (!cameraLive || phase !== "active") return;
    let cancelled = false;
    const luminanceCanvas = document.createElement("canvas");
    luminanceCanvas.width = 24;
    luminanceCanvas.height = 14;
    const luminanceContext = luminanceCanvas.getContext("2d", { willReadFrequently: true });
    let lastLuminanceCheck = 0;

    const track = () => {
      if (cancelled) return;
      const video = videoRef.current;
      const handLandmarker = handLandmarkerRef.current;
      const faceLandmarker = faceLandmarkerRef.current;
      if (!video || !handLandmarker || !faceLandmarker || !streamRef.current) return;
      const now = performance.now();
      if (video.readyState >= 2 && video.currentTime !== previousVideoTimeRef.current) {
        previousVideoTimeRef.current = video.currentTime;
        const handResult = handLandmarker.detectForVideo(video, now);
        if (now - previousFaceTimeRef.current > 45) {
          previousFaceTimeRef.current = now;
          latestFaceRef.current = faceLandmarker.detectForVideo(video, now);
        }
        const face = latestFaceRef.current;
        const landmarks = handResult.landmarks[0] as Landmark[] | undefined;
        const faceLandmarks = face?.faceLandmarks[0] as Landmark[] | undefined;
        const trackingConfidence = handResult.handedness?.[0]?.[0]?.score ?? 0;
        let observation = landmarks
          ? classifyHandGesture(landmarks, trackingConfidence)
          : null;

        const detectedPalm = observation?.palm;
        if (detectedPalm) {
          const previous = previousPalmSampleRef.current;
          if (previous && now - previous.at >= 70) {
            const speed = palmMovementSpeed(previous.palm, detectedPalm, now - previous.at);
            if (speed >= 0.22) movingPalmUntilRef.current = now + 520;
            previousPalmSampleRef.current = { palm: detectedPalm, at: now };
          } else if (!previous) {
            previousPalmSampleRef.current = { palm: detectedPalm, at: now };
          }
          const movingPalm = now < movingPalmUntilRef.current
            && (observation?.gesture === "open_palm" || observation?.gesture === "palm_move");
          if (movingPalm) {
            observation = {
              gesture: "palm_move",
              confidence: Math.max(0.9, trackingConfidence),
              palm: detectedPalm,
            };
          }
        } else {
          previousPalmSampleRef.current = null;
          movingPalmUntilRef.current = 0;
        }

        if (landmarks && faceLandmarks && isFingerNearLips(landmarks, faceLandmarks)) {
          observation = {
            gesture: "finger_near_lips",
            confidence: Math.max(0.9, trackingConfidence),
            palm: observation?.palm,
          };
        }

        if (!landmarks && now - lastLuminanceCheck > 220 && luminanceContext) {
          lastLuminanceCheck = now;
          luminanceContext.drawImage(video, 0, 0, 24, 14);
          const pixels = luminanceContext.getImageData(0, 0, 24, 14).data;
          let sum = 0;
          for (let index = 0; index < pixels.length; index += 4) {
            sum += pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
          }
          const average = sum / (pixels.length / 4);
          const covered = average < 26 && !faceLandmarks;
          if (covered) {
            coverStartRef.current ??= now;
            if (now - coverStartRef.current > 920) {
              observation = { gesture: "camera_cover", confidence: 0.96 };
            }
          } else {
            coverStartRef.current = null;
          }
        } else if (landmarks) {
          coverStartRef.current = null;
        }

        setHandsDetected(handResult.landmarks.length);
        drawOverlay(handResult, face, observation);
        const faceFollow = !observation && faceLandmarks?.[1]
          ? {
              gesture: "palm_move" as const,
              confidence: 0.88,
              palm: faceLandmarks[1],
            }
          : null;
        const justWoke = observation ? sceneRef.current?.wakeFromGesture() ?? false : false;
        if (justWoke) {
          wakeInputLockUntilRef.current = now + WAKE_SETTLE_MS;
          stateMachineRef.current.reset();
        }
        sceneRef.current?.updateObservation(observation ?? faceFollow);
        const inputLockedForWake = now < wakeInputLockUntilRef.current;
        const update = inputLockedForWake
          ? {
              state: "Performing action" as const,
              progress: 1,
              observation: null,
            }
          : stateMachineRef.current.update(
              observation,
              now,
              mappingsRef.current,
              1 / reactionSpeedRef.current,
            );
        if (update.triggeredAction && update.observation) {
          actionHandlerRef.current(update.triggeredAction, update.observation);
        }
        if (now - lastUiUpdateRef.current > 70 || update.triggeredAction) {
          lastUiUpdateRef.current = now;
          setBehaviorState(update.state);
          setCandidateProgress(update.progress);
          setCurrentGesture(update.observation?.gesture ?? null);
          setStatusText(
            update.observation
              ? `${GESTURE_LABELS[update.observation.gesture]} · ${Math.round(update.observation.confidence * 100)}%`
              : "Show the lamp a gesture",
          );
        }
      }
      trackingFrameRef.current = requestAnimationFrame(track);
    };
    trackingFrameRef.current = requestAnimationFrame(track);
    return () => {
      cancelled = true;
      cancelAnimationFrame(trackingFrameRef.current);
    };
  }, [cameraLive, drawOverlay, phase]);

  const createVisionModels = useCallback(async () => {
    const { FilesetResolver, FaceLandmarker, HandLandmarker } = await import("@mediapipe/tasks-vision");
    const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const handOptions = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: "/mediapipe/models/hand_landmarker.task", delegate },
      runningMode: "VIDEO" as const,
      numHands: 2,
      minHandDetectionConfidence: 0.62,
      minHandPresenceConfidence: 0.58,
      minTrackingConfidence: 0.58,
    });
    const faceOptions = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: "/mediapipe/models/face_landmarker.task", delegate },
      runningMode: "VIDEO" as const,
      numFaces: 1,
      minFaceDetectionConfidence: 0.54,
      minFacePresenceConfidence: 0.52,
      minTrackingConfidence: 0.52,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    try {
      handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, handOptions("GPU"));
      faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(vision, faceOptions("GPU"));
    } catch {
      handLandmarkerRef.current?.close();
      faceLandmarkerRef.current?.close();
      handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, handOptions("CPU"));
      faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(vision, faceOptions("CPU"));
    }
  }, []);

  const startCamera = useCallback(async () => {
    setPhase("loading");
    setStatusText("Loading hand + face vision…");
    setCameraExpanded(true);
    ensureAudioContext();
    try {
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
      await createVisionModels();
      previousVideoTimeRef.current = -1;
      previousFaceTimeRef.current = -1;
      stateMachineRef.current.reset();
      setCameraLive(true);
      setPhase("active");
      setStatusText("Show the lamp a gesture");
    } catch (error) {
      console.error(error);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraLive(false);
      setPhase("error");
      setStatusText("Camera unavailable · check browser permission");
    }
  }, [createVisionModels, ensureAudioContext]);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(trackingFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    handLandmarkerRef.current?.close();
    handLandmarkerRef.current = null;
    faceLandmarkerRef.current?.close();
    faceLandmarkerRef.current = null;
    latestFaceRef.current = null;
    stateMachineRef.current.reset();
    wakeInputLockUntilRef.current = 0;
    previousPalmSampleRef.current = null;
    movingPalmUntilRef.current = 0;
    sceneRef.current?.updateObservation(null);
    const overlay = overlayRef.current?.getContext("2d");
    if (overlayRef.current && overlay) overlay.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    faceMaskRendererRef.current?.update(
      null,
      videoRef.current?.videoWidth || 640,
      videoRef.current?.videoHeight || 360,
    );
    setCameraLive(false);
    setHandsDetected(0);
    setBehaviorState("Idle");
    setCurrentGesture(null);
    setCandidateProgress(0);
    setPhase("idle");
    setStatusText("Camera is off");
  }, []);

  const forceGesture = useCallback((gesture: GestureName) => {
    if (sceneRef.current?.wakeFromGesture()) {
      setBehaviorState("Performing action");
      setCurrentGesture(gesture);
      setCandidateProgress(1);
      setLastAction("wake");
      return;
    }
    const update = stateMachineRef.current.force(gesture, performance.now(), mappingsRef.current);
    setBehaviorState(update.state);
    setCurrentGesture(gesture);
    setCandidateProgress(1);
    if (update.triggeredAction && update.observation) {
      actionHandlerRef.current(update.triggeredAction, update.observation);
    }
  }, []);

  const connectMusicAnalyser = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return null;
    const context = ensureAudioContext();
    if (!mediaSourceRef.current) {
      mediaSourceRef.current = context.createMediaElementSource(audio);
      audioAnalyserRef.current = context.createAnalyser();
      audioAnalyserRef.current.fftSize = 256;
      mediaSourceRef.current.connect(audioAnalyserRef.current).connect(context.destination);
    }
    return audioAnalyserRef.current;
  }, [ensureAudioContext]);

  useEffect(() => {
    if (!musicPlaying) return;
    let cancelled = false;
    const levels = new Uint8Array(128);
    const pulse = () => {
      if (cancelled) return;
      const analyser = audioAnalyserRef.current;
      if (analyser) {
        analyser.getByteFrequencyData(levels);
        const bass = levels.slice(0, 18).reduce((sum, level) => sum + level, 0) / (18 * 255);
        sceneRef.current?.setBeat(Math.max(0, (bass - 0.12) * 1.8));
      }
      requestAnimationFrame(pulse);
    };
    requestAnimationFrame(pulse);
    return () => { cancelled = true; };
  }, [musicPlaying]);

  useEffect(() => {
    sceneRef.current?.setMusicPlaying(musicPlaying);
  }, [musicPlaying]);

  const chooseMusic = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const audio = audioRef.current;
    if (!file || !audio) return;
    if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
    musicUrlRef.current = URL.createObjectURL(file);
    audio.src = musicUrlRef.current;
    audio.loop = true;
    audio.muted = muted;
    setMusicName(file.name);
    connectMusicAnalyser();
    void audio.play().then(() => setMusicPlaying(true)).catch(() => setMusicPlaying(false));
  }, [connectMusicAnalyser, muted]);

  const toggleMusic = useCallback(() => {
    const audio = audioRef.current;
    if (!audio?.src) {
      fileInputRef.current?.click();
      return;
    }
    connectMusicAnalyser();
    if (audio.paused) void audio.play().then(() => setMusicPlaying(true));
    else {
      audio.pause();
      setMusicPlaying(false);
    }
  }, [connectMusicAnalyser]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    if (audioRef.current) audioRef.current.muted = next;
    sceneRef.current?.setMuted(next);
  }, [muted]);

  const toggleRecording = useCallback(() => {
    if (recordingRef.current && recordingRef.current.state !== "inactive") {
      recordingRef.current.stop();
      setRecording(false);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.captureStream !== "function") return;
    const stream = canvas.captureStream(30);
    const preferred = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType: preferred });
    recordingChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) recordingChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(recordingChunksRef.current, { type: preferred });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "lamp-performance.webm";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 500);
    };
    recorder.start(250);
    recordingRef.current = recorder;
    setRecording(true);
  }, []);

  useEffect(() => () => {
    stopCamera();
    audioRef.current?.pause();
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }
    if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
  }, [stopCamera]);

  const phaseLabel = useMemo(() => {
    if (phase === "active") return "Tracking live";
    if (phase === "loading") return "Loading local vision";
    if (phase === "error") return "Permission needed";
    return modelReady ? "Lamp ready" : "Preparing lamp";
  }, [modelReady, phase]);

  return (
    <main
      className="lamp-shell"
      data-phase={phase}
      data-testid="lamp-lab"
    >
      <canvas ref={canvasRef} className="lamp-stage" aria-label="Expressive articulated 3D character lamp" />
      <div className="lamp-atmosphere" />
      <div className="lamp-grain" />

      <header className="lamp-topbar">
        <a className="lamp-brand" href="/" aria-label="Back to experiments">
          <span className="lamp-brand-mark">L</span>
          <span>LAMP</span>
        </a>
        <div className="lamp-system">
          <span className="lamp-model-chip"><i className={modelReady ? "ready" : ""} /> ARTICULATED CHARACTER</span>
          <span className="lamp-system-state"><i /> {phaseLabel}</span>
          <button type="button" onClick={toggleMusic}>{musicPlaying ? "PAUSE MUSIC" : "LOAD MUSIC"}</button>
          <button type="button" onClick={toggleMute}>{muted ? "UNMUTE" : "SOUND ON"}</button>
        </div>
      </header>

      {(phase === "idle" || phase === "loading" || phase === "error") && (
        <section className="lamp-intro" aria-labelledby="lamp-title">
          <p className="lamp-kicker">A LAMP THAT LEARNS YOUR LANGUAGE</p>
          <h1 id="lamp-title">Meet the lamp.<br /><em>Say it with your hands.</em></h1>
          <p>
            Point, move your palm, pause, or lean in. The lamp reads your gestures locally and
            turns them into light, movement, and character.
          </p>
          <div className="lamp-intro-actions">
            <button
              type="button"
              onClick={startCamera}
              disabled={phase === "loading"}
              data-testid="start-lamp-camera"
            >
              <span>{phase === "loading" ? "LOADING VISION…" : phase === "error" ? "TRY CAMERA AGAIN" : "START CAMERA"}</span>
              <b>↗</b>
            </button>
            <button type="button" className="lamp-secondary-button" onClick={() => forceGesture("peace")}>
              PREVIEW PERSONALITY
            </button>
          </div>
          <small>Private by design · video and landmarks never leave this device</small>
        </section>
      )}

      {phase === "active" && (
        <section className="lamp-live-card" aria-label="Current lamp behavior">
          <p>BEHAVIOUR STATE</p>
          <strong>{behaviorState}</strong>
          <div className="lamp-candidate-meter"><span style={{ width: `${candidateProgress * 100}%` }} /></div>
          <dl>
            <div><dt>Gesture</dt><dd>{currentGesture ? GESTURE_LABELS[currentGesture] : "Watching"}</dd></div>
            <div><dt>Response</dt><dd>{lastAction ? ACTION_LABELS[lastAction] : "Idle motion"}</dd></div>
            <div><dt>Hands</dt><dd>{handsDetected}/2</dd></div>
          </dl>
          <div className="lamp-live-actions">
            <button type="button" onClick={toggleRecording} className={recording ? "recording" : ""}>
              {recording ? "STOP + SAVE VIDEO" : "RECORD PERFORMANCE"}
            </button>
          </div>
        </section>
      )}

      <aside className={`lamp-camera ${cameraExpanded ? "expanded" : "collapsed"}`} aria-label="Mirrored gesture tracking camera">
        <div className="lamp-camera-head">
          <span><i className={cameraLive ? "live" : ""} /> HAND + MASK TRACKING <small>3D FACE POSE + BLINK + JAW / LIVE</small></span>
          <button type="button" onClick={() => setCameraExpanded((expanded) => !expanded)} aria-label={cameraExpanded ? "Collapse camera" : "Expand camera"}>{cameraExpanded ? "−" : "+"}</button>
        </div>
        <div className="lamp-camera-view">
          <video ref={videoRef} muted playsInline aria-label="Camera preview">
            <track kind="captions" src="/lamp/empty.vtt" srcLang="en" label="No spoken content" />
          </video>
          <canvas
            ref={faceMaskCanvasRef}
            className="lamp-face-mask-layer"
            aria-label="Tracked three-dimensional face mask"
          />
          <canvas
            ref={overlayRef}
            className="lamp-hand-landmark-layer"
            aria-label="Tracked hand landmarks"
          />
          {!cameraLive && <div className="lamp-camera-empty">CAMERA<small>OFFLINE</small></div>}
          <i className="frame tl" /><i className="frame tr" /><i className="frame bl" /><i className="frame br" />
          {currentGesture && cameraLive && <div className="lamp-gesture-badge">{GESTURE_LABELS[currentGesture]}</div>}
        </div>
        <div className="lamp-camera-status">
          <span>{statusText}</span>
          {cameraLive && <button type="button" onClick={stopCamera}>STOP</button>}
        </div>
      </aside>

      <footer className="lamp-dock" aria-label="Gesture preview shortcuts">
        <div className="lamp-dock-copy"><strong>TRY A RESPONSE</strong><span>Camera gestures use confirmation; previews run instantly</span></div>
        <div className="lamp-gesture-shortcuts">
          {RESPONSE_GESTURES.map((gesture) => (
            <button type="button" key={gesture} onClick={() => forceGesture(gesture)} title={`${GESTURE_LABELS[gesture]} → ${ACTION_LABELS[mappings[gesture]]}`}>
              <span>{GESTURE_ICONS[gesture] ?? "•"}</span>
              <small>{GESTURE_LABELS[gesture]}</small>
            </button>
          ))}
        </div>
        <div className="lamp-track-name"><span>{musicPlaying ? "REACTING TO" : "LOCAL MUSIC"}</span><strong>{musicName}</strong></div>
      </footer>

      <input ref={fileInputRef} type="file" accept="audio/*" hidden onChange={chooseMusic} />
      <audio ref={audioRef} preload="metadata">
        <track kind="captions" src="/lamp/empty.vtt" srcLang="en" label="Local audio" />
      </audio>
    </main>
  );
}
