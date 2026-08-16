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
  JOINT_LIMITS,
  WaveDetector,
  classifyHandGesture,
  isFingerNearLips,
  solveTwoBoneIK,
  type BehaviorState,
  type GestureMappings,
  type GestureName,
  type GestureObservation,
  type LampAction,
  type Landmark,
} from "./gestureEngine";
import {
  downloadBehaviorPack,
  downloadSessionReplay,
  type SessionEvent,
} from "./behaviorPack";

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

type LampSceneApi = {
  updateObservation: (observation: GestureObservation | null) => void;
  perform: (action: LampAction) => void;
  setSettings: (settings: LampSettings) => void;
  setBeat: (level: number) => void;
  setMuted: (muted: boolean) => void;
  getPose: () => LampPose;
  dispose: () => void;
};

type SpeechEvent = {
  results: ArrayLike<{ 0: { transcript: string } }>;
};

type SpeechRecognizer = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognizerConstructor = new () => SpeechRecognizer;

const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const ACTIONS = Object.keys(ACTION_LABELS) as LampAction[];
const GESTURES = Object.keys(GESTURE_LABELS) as GestureName[];
const TRACKED_GESTURES: GestureName[] = [
  "point",
  "palm_move",
  "open_palm",
  "fist",
  "ok",
  "peace",
  "thumbs_up",
  "thumbs_down",
  "finger_near_lips",
  "wave",
  "camera_cover",
  "clap",
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const radians = THREE.MathUtils.degToRad;

function createLampScene(
  canvas: HTMLCanvasElement,
  onReady: () => void,
): LampSceneApi {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x061017);
  scene.fog = new THREE.FogExp2(0x061017, 0.64);

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
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  scene.add(new THREE.HemisphereLight(0xbcefff, 0x03080b, 1.6));
  const key = new THREE.DirectionalLight(0xffbd75, 4.8);
  key.position.set(2.5, 3.2, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  const rim = new THREE.PointLight(0x45dfff, 23, 6, 1.8);
  rim.position.set(-1.35, 1.3, -1.35);
  scene.add(rim);

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
  let browLeft: THREE.Object3D | null = null;
  let browRight: THREE.Object3D | null = null;
  let bulb: THREE.Mesh | null = null;
  let eyeLeftScale = new THREE.Vector3(1, 1, 1);
  let eyeRightScale = new THREE.Vector3(1, 1, 1);

  const lampLight = new THREE.PointLight(0xff8a35, 18, 3.2, 1.7);
  scene.add(lampLight);
  const bulbWorld = new THREE.Vector3();

  new GLTFLoader().load(
    "/lamp/luma-character-lamp.glb",
    (gltf) => {
      lamp = gltf.scene;
      lamp.scale.setScalar(1.43);
      lamp.position.set(0.22, 0.003, 0);
      lamp.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
          object.frustumCulled = false;
        }
      });
      baseYaw = lamp.getObjectByName("BaseYaw") ?? null;
      shoulder = lamp.getObjectByName("Shoulder") ?? null;
      elbow = lamp.getObjectByName("Elbow") ?? null;
      headPitch = lamp.getObjectByName("HeadPitch") ?? null;
      headYaw = lamp.getObjectByName("HeadYaw") ?? null;
      eyeLeft = lamp.getObjectByName("EyeLeft") ?? null;
      eyeRight = lamp.getObjectByName("EyeRight") ?? null;
      browLeft = lamp.getObjectByName("BrowLeft") ?? null;
      browRight = lamp.getObjectByName("BrowRight") ?? null;
      bulb = (lamp.getObjectByName("LampBulb") as THREE.Mesh | undefined) ?? null;
      eyeLeftScale = eyeLeft?.scale.clone() ?? eyeLeftScale;
      eyeRightScale = eyeRight?.scale.clone() ?? eyeRightScale;
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
  let paused = false;
  let locked = false;
  let sleeping = false;
  let muted = false;
  let beat = 0;
  let settings: LampSettings = {
    reactionSpeed: 1,
    smoothness: 0.7,
    brightness: 0.82,
    lightColor: "#ff9b43",
  };
  const pose: LampPose = {
    baseYaw: 0,
    shoulder: 0,
    elbow: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    rootZ: 0,
  };
  const lockedPose: LampPose = { ...pose };

  const perform = (action: LampAction) => {
    currentAction = action;
    actionStarted = performance.now();
    if (action === "freeze") {
      paused = true;
      trackingMode = null;
    } else if (action === "pause") {
      paused = true;
    } else if (action === "follow_palm") {
      paused = false;
      locked = false;
      sleeping = false;
      trackingMode = "follow";
    } else if (action === "point_light") {
      paused = false;
      locked = false;
      sleeping = false;
      trackingMode = "point";
    } else if (action === "lock") {
      locked = true;
      trackingMode = null;
      Object.assign(lockedPose, pose);
    } else if (action === "sleep") {
      sleeping = true;
      paused = false;
      trackingMode = null;
    } else if (action === "wake") {
      sleeping = false;
      paused = false;
      locked = false;
    } else if (action === "closer" || action === "back") {
      paused = false;
      sleeping = false;
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
    const actionTime = (performance.now() - actionStarted) / 1000;
    const targets: LampPose = { ...pose };

    if (!paused && !locked && !sleeping) {
      targets.baseYaw = Math.sin(elapsed * 0.42) * 0.035;
      targets.shoulder = Math.sin(elapsed * 0.62) * 0.012;
      targets.elbow = Math.sin(elapsed * 0.52 + 1.1) * 0.018;
      targets.headPitch = Math.sin(elapsed * 0.8) * 0.025;
      targets.headYaw = 0;
      targets.headRoll = Math.sin(elapsed * 0.51) * 0.022;
    }

    if (!paused && !locked && !sleeping && trackingMode && observation?.palm) {
      const palm = observation.palm;
      const vertical = clamp((1 - palm.y) * 0.76, 0.22, 0.78);
      const forward = clamp(0.2 - palm.z * 1.2, 0.1, 0.62);
      const solution = solveTwoBoneIK(vertical, forward);
      const targetAngle = Math.atan2(forward, vertical);
      const desiredShoulder = targetAngle * 2 - solution.shoulder;
      const shoulderRest = radians(36);
      const elbowRest = radians(85);
      targets.baseYaw = clamp(
        (0.5 - palm.x) * 1.7,
        radians(JOINT_LIMITS.baseYaw[0]),
        radians(JOINT_LIMITS.baseYaw[1]),
      );
      targets.shoulder = clamp(
        desiredShoulder - shoulderRest,
        radians(JOINT_LIMITS.shoulderPitch[0] - 36),
        radians(JOINT_LIMITS.shoulderPitch[1] - 36),
      );
      targets.elbow = clamp(
        solution.elbow - elbowRest,
        radians(JOINT_LIMITS.elbowPitch[0] - 85),
        radians(JOINT_LIMITS.elbowPitch[1] - 85),
      );
      targets.headPitch = clamp((0.48 - palm.y) * 0.8, -radians(45), radians(45));
      targets.headYaw = clamp((0.5 - palm.x) * 0.72, -radians(55), radians(55));
      if (trackingMode === "point" && observation.direction) {
        targets.headPitch += clamp(-observation.direction.y * 0.36, -0.28, 0.28);
        targets.headYaw += clamp(-observation.direction.x * 0.34, -0.3, 0.3);
      }
    }

    if (locked) Object.assign(targets, lockedPose);
    if (sleeping) {
      targets.shoulder = radians(38);
      targets.elbow = radians(-34);
      targets.headPitch = radians(34);
      targets.headRoll = radians(-8);
      targets.rootZ = -0.05;
    } else if (currentAction === "closer") {
      targets.rootZ = 0.24 * Math.min(1, actionTime / 0.8);
    } else if (currentAction === "back") {
      targets.rootZ = -0.2 * Math.min(1, actionTime / 0.8);
    } else {
      targets.rootZ = 0;
    }

    if (currentAction === "confirm" && actionTime < 0.9) {
      targets.headPitch += Math.sin(actionTime * Math.PI * 4) * 0.16;
    }
    if (currentAction === "friendly" && actionTime < 1.8) {
      targets.baseYaw += Math.sin(actionTime * Math.PI * 2.3) * 0.2;
      targets.headRoll += Math.sin(actionTime * Math.PI * 3.4) * 0.16;
      if (lamp) lamp.position.y = Math.abs(Math.sin(actionTime * Math.PI * 2.4)) * 0.055;
    } else if (currentAction === "wave_back" && actionTime < 1.5) {
      targets.baseYaw += Math.sin(actionTime * Math.PI * 5) * 0.24;
      targets.headRoll += Math.sin(actionTime * Math.PI * 5 + 0.8) * 0.12;
    } else if (currentAction === "wake" && actionTime < 1.8) {
      targets.headPitch += Math.sin(actionTime * Math.PI * 4) * 0.13 * (1 - actionTime / 1.8);
      if (lamp) lamp.position.y = Math.abs(Math.sin(actionTime * Math.PI * 2.4)) * 0.07;
    } else if (lamp) {
      lamp.position.y = THREE.MathUtils.damp(lamp.position.y, 0.003, 6, dt);
    }
    if (currentAction === "mute" && actionTime < 1.2) {
      targets.headPitch += 0.24;
      targets.headRoll -= 0.09;
    }
    if (beat > 0.04 && !sleeping) {
      targets.headPitch += beat * 0.11;
      targets.baseYaw += Math.sin(elapsed * 7.2) * beat * 0.055;
    }

    const damping = 4.2 + (1 - settings.smoothness) * 8.5;
    pose.baseYaw = THREE.MathUtils.damp(pose.baseYaw, targets.baseYaw, damping, dt);
    pose.shoulder = THREE.MathUtils.damp(pose.shoulder, targets.shoulder, damping, dt);
    pose.elbow = THREE.MathUtils.damp(pose.elbow, targets.elbow, damping, dt);
    pose.headPitch = THREE.MathUtils.damp(pose.headPitch, targets.headPitch, damping + 1, dt);
    pose.headYaw = THREE.MathUtils.damp(pose.headYaw, targets.headYaw, damping + 1, dt);
    pose.headRoll = THREE.MathUtils.damp(pose.headRoll, targets.headRoll, damping + 1, dt);
    pose.rootZ = THREE.MathUtils.damp(pose.rootZ, targets.rootZ, damping, dt);

    if (baseYaw) baseYaw.rotation.y = pose.baseYaw;
    if (shoulder) shoulder.rotation.x = pose.shoulder;
    if (elbow) elbow.rotation.x = pose.elbow;
    if (headPitch) headPitch.rotation.x = pose.headPitch;
    if (headYaw) {
      headYaw.rotation.y = pose.headYaw;
      headYaw.rotation.z = pose.headRoll;
    }
    if (lamp) lamp.position.z = pose.rootZ;

    if (elapsed >= nextBlink) {
      blinkUntil = elapsed + 0.13;
      nextBlink = elapsed + 2.7 + Math.random() * 3.1;
    }
    const forcedBlink =
      (currentAction === "friendly" && actionTime < 0.42 && Math.sin(actionTime * 28) > 0.1) ||
      sleeping;
    const blink = elapsed < blinkUntil || forcedBlink ? 0.08 : 1;
    if (eyeLeft) eyeLeft.scale.y = THREE.MathUtils.damp(eyeLeft.scale.y, eyeLeftScale.y * blink, 24, dt);
    if (eyeRight) eyeRight.scale.y = THREE.MathUtils.damp(eyeRight.scale.y, eyeRightScale.y * blink, 24, dt);
    if (browLeft && browRight) {
      const curious = currentAction === "friendly" && actionTime < 1.8 ? 0.16 : 0;
      browLeft.rotation.z = THREE.MathUtils.damp(browLeft.rotation.z, curious, 10, dt);
      browRight.rotation.z = THREE.MathUtils.damp(browRight.rotation.z, -curious, 10, dt);
    }

    const lightColor = new THREE.Color(settings.lightColor);
    const quietFactor = muted ? 0.44 : 1;
    const sleepFactor = sleeping ? 0.06 : 1;
    const pulse = 1 + beat * 0.85;
    lampLight.color.lerp(lightColor, 0.18);
    lampLight.intensity = THREE.MathUtils.damp(
      lampLight.intensity,
      23 * settings.brightness * quietFactor * sleepFactor * pulse,
      8,
      dt,
    );
    if (bulb) {
      bulb.getWorldPosition(bulbWorld);
      lampLight.position.copy(bulbWorld);
      const material = bulb.material as THREE.MeshStandardMaterial;
      if (material.emissive) material.emissive.copy(lightColor);
      material.emissiveIntensity = 1.6 + settings.brightness * 3 * quietFactor * sleepFactor * pulse;
    }
    beat *= Math.pow(0.05, dt);
    dust.rotation.y += dt * 0.012;
    rings.rotation.z -= dt * 0.01;
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(animate);

  return {
    updateObservation(next) {
      observation = next;
    },
    perform,
    setSettings(next) {
      settings = next;
    },
    setBeat(level) {
      beat = Math.max(beat, clamp(level, 0, 1));
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
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const microphoneRef = useRef<MediaStream | null>(null);
  const sceneRef = useRef<LampSceneApi | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const latestFaceRef = useRef<FaceLandmarkerResult | null>(null);
  const trackingFrameRef = useRef(0);
  const previousVideoTimeRef = useRef(-1);
  const previousFaceTimeRef = useRef(-1);
  const stateMachineRef = useRef(new GestureStateMachine());
  const waveDetectorRef = useRef(new WaveDetector());
  const coverStartRef = useRef<number | null>(null);
  const lastUiUpdateRef = useRef(0);
  const mappingsRef = useRef<GestureMappings>(DEFAULT_MAPPINGS);
  const reactionSpeedRef = useRef(1);
  const actionHandlerRef = useRef<(action: LampAction, observation: GestureObservation) => void>(() => undefined);
  const replayRef = useRef<SessionEvent[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const voiceRecognitionRef = useRef<SpeechRecognizer | null>(null);
  const voiceEnabledRef = useRef(false);
  const microphoneFrameRef = useRef(0);
  const lastClapRef = useRef(-Infinity);
  const recordingRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const musicUrlRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [modelReady, setModelReady] = useState(false);
  const [cameraLive, setCameraLive] = useState(false);
  const [cameraExpanded, setCameraExpanded] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
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
  const [personality, setPersonality] = useState("Curious companion");
  const [settings, setSettings] = useState<LampSettings>({
    reactionSpeed: 1,
    smoothness: 0.7,
    brightness: 0.82,
    lightColor: "#ff9b43",
  });

  useEffect(() => {
    let cancelled = false;
    const saved = localStorage.getItem("luma-gesture-mappings");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as Partial<GestureMappings>;
      queueMicrotask(() => {
        if (!cancelled) setMappings({ ...DEFAULT_MAPPINGS, ...parsed });
      });
    } catch {
      localStorage.removeItem("luma-gesture-mappings");
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    mappingsRef.current = mappings;
    localStorage.setItem("luma-gesture-mappings", JSON.stringify(mappings));
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
      confirm: 620,
      friendly: 760,
      closer: 540,
      back: 390,
      wake: 690,
      wave_back: 720,
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

  const performAction = useCallback((action: LampAction, observation: GestureObservation) => {
    sceneRef.current?.perform(action);
    setLastAction(action);
    replayRef.current.push({
      at: Math.round(performance.now()),
      gesture: observation.gesture,
      action,
      confidence: Number(observation.confidence.toFixed(3)),
    });
    if (replayRef.current.length > 600) replayRef.current.shift();
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
    const faceLandmarks = face?.faceLandmarks[0];
    if (faceLandmarks?.[13] && faceLandmarks[14]) {
      const upper = faceLandmarks[13];
      const lower = faceLandmarks[14];
      context.shadowBlur = 7;
      context.strokeStyle = "#ffad4a";
      context.lineWidth = 2;
      context.beginPath();
      context.ellipse(
        ((upper.x + lower.x) / 2) * width,
        ((upper.y + lower.y) / 2) * height,
        width * 0.019,
        Math.max(3, Math.abs(upper.y - lower.y) * height * 1.7),
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
    }
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

        if (landmarks && faceLandmarks && isFingerNearLips(landmarks, faceLandmarks)) {
          observation = {
            gesture: "finger_near_lips",
            confidence: Math.max(0.9, trackingConfidence),
            palm: observation?.palm,
          };
        } else if (
          landmarks &&
          waveDetectorRef.current.update(landmarks[0].x, now)
        ) {
          observation = {
            gesture: "wave",
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
        sceneRef.current?.updateObservation(observation ?? faceFollow);
        const update = stateMachineRef.current.update(
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
              : "Show Luma a gesture",
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
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
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
      waveDetectorRef.current.reset();
      setCameraLive(true);
      setPhase("active");
      setStatusText("Show Luma a gesture");
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
    sceneRef.current?.updateObservation(null);
    const overlay = overlayRef.current?.getContext("2d");
    if (overlayRef.current && overlay) overlay.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    setCameraLive(false);
    setHandsDetected(0);
    setBehaviorState("Idle");
    setCurrentGesture(null);
    setCandidateProgress(0);
    setPhase("idle");
    setStatusText("Camera is off");
  }, []);

  const forceGesture = useCallback((gesture: GestureName) => {
    const update = stateMachineRef.current.force(gesture, performance.now(), mappingsRef.current);
    setBehaviorState(update.state);
    setCurrentGesture(gesture);
    setCandidateProgress(1);
    if (update.triggeredAction && update.observation) {
      actionHandlerRef.current(update.triggeredAction, update.observation);
    }
  }, []);

  const parseVoiceCommand = useCallback((transcript: string) => {
    const normalized = transcript.toLowerCase();
    if (normalized.includes("follow me")) forceGesture("voice_follow");
    else if (normalized.includes("stay there") || normalized.includes("hold still")) forceGesture("voice_stay");
    else if (normalized.includes("wake up")) forceGesture("clap");
    else if (normalized.includes("go to sleep")) forceGesture("camera_cover");
  }, [forceGesture]);

  const stopVoice = useCallback(() => {
    voiceEnabledRef.current = false;
    cancelAnimationFrame(microphoneFrameRef.current);
    voiceRecognitionRef.current?.stop();
    voiceRecognitionRef.current = null;
    microphoneRef.current?.getTracks().forEach((track) => track.stop());
    microphoneRef.current = null;
    setVoiceEnabled(false);
  }, []);

  const enableVoice = useCallback(async () => {
    if (voiceEnabledRef.current) {
      stopVoice();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      microphoneRef.current = stream;
      voiceEnabledRef.current = true;
      setVoiceEnabled(true);
      const context = ensureAudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const levels = new Uint8Array(analyser.fftSize);
      let previousRms = 0;
      const listenForClap = () => {
        if (!voiceEnabledRef.current) return;
        analyser.getByteTimeDomainData(levels);
        let sum = 0;
        for (const level of levels) {
          const normalized = (level - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / levels.length);
        const now = performance.now();
        if (rms > 0.2 && previousRms < 0.09 && now - lastClapRef.current > 1400) {
          lastClapRef.current = now;
          forceGesture("clap");
        }
        previousRms = rms;
        microphoneFrameRef.current = requestAnimationFrame(listenForClap);
      };
      microphoneFrameRef.current = requestAnimationFrame(listenForClap);

      const speechWindow = window as typeof window & {
        SpeechRecognition?: SpeechRecognizerConstructor;
        webkitSpeechRecognition?: SpeechRecognizerConstructor;
      };
      const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
      if (Recognition) {
        const recognition = new Recognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = "en-US";
        recognition.onresult = (event) => {
          const result = event.results[event.results.length - 1];
          if (result?.[0]?.transcript) parseVoiceCommand(result[0].transcript);
        };
        recognition.onend = () => {
          if (voiceEnabledRef.current) {
            try { recognition.start(); } catch { /* Browser is already restarting recognition. */ }
          }
        };
        recognition.start();
        voiceRecognitionRef.current = recognition;
      }
    } catch {
      setStatusText("Microphone unavailable · camera gestures still work");
      stopVoice();
    }
  }, [ensureAudioContext, forceGesture, parseVoiceCommand, stopVoice]);

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
      anchor.download = "luma-performance.webm";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 500);
    };
    recorder.start(250);
    recordingRef.current = recorder;
    setRecording(true);
  }, []);

  useEffect(() => () => {
    stopCamera();
    stopVoice();
    audioRef.current?.pause();
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext?.state !== "closed") void audioContext.close().catch(() => undefined);
    if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
  }, [stopCamera, stopVoice]);

  const phaseLabel = useMemo(() => {
    if (phase === "active") return "Tracking live";
    if (phase === "loading") return "Loading local vision";
    if (phase === "error") return "Permission needed";
    return modelReady ? "Luma ready" : "Preparing Luma";
  }, [modelReady, phase]);

  return (
    <main
      className="lamp-shell"
      data-phase={phase}
      data-panel={panelOpen ? "open" : "closed"}
      data-testid="luma-lamp-lab"
    >
      <canvas ref={canvasRef} className="lamp-stage" aria-label="Expressive articulated 3D character lamp" />
      <div className="lamp-atmosphere" />
      <div className="lamp-grain" />

      <header className="lamp-topbar">
        <a className="lamp-brand" href="/" aria-label="Back to experiments">
          <span className="lamp-brand-mark">L</span>
          <span>LUMA / BEHAVIOUR LAB</span>
        </a>
        <div className="lamp-system">
          <span className="lamp-model-chip"><i className={modelReady ? "ready" : ""} /> CC0 ARTICULATED MODEL</span>
          <span className="lamp-system-state"><i /> {phaseLabel}</span>
          <button type="button" onClick={toggleMusic}>{musicPlaying ? "PAUSE MUSIC" : "LOAD MUSIC"}</button>
          <button type="button" onClick={toggleMute}>{muted ? "UNMUTE" : "SOUND ON"}</button>
          <button type="button" className={panelOpen ? "active" : ""} onClick={() => setPanelOpen((open) => !open)}>
            BEHAVIOURS
          </button>
        </div>
      </header>

      {(phase === "idle" || phase === "loading" || phase === "error") && (
        <section className="lamp-intro" aria-labelledby="luma-title">
          <p className="lamp-kicker">A LAMP THAT LEARNS YOUR LANGUAGE</p>
          <h1 id="luma-title">Meet Luma.<br /><em>Say it with your hands.</em></h1>
          <p>
            Point, wave, pause, or lean in. Luma reads your gestures locally and
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
            <button type="button" onClick={enableVoice} className={voiceEnabled ? "active" : ""}>
              {voiceEnabled ? "MIC + VOICE ON" : "ENABLE CLAP + VOICE"}
            </button>
            <button type="button" onClick={toggleRecording} className={recording ? "recording" : ""}>
              {recording ? "STOP + SAVE VIDEO" : "RECORD PERFORMANCE"}
            </button>
          </div>
        </section>
      )}

      <aside className={`lamp-editor ${panelOpen ? "open" : ""}`} aria-label="Lamp behavior editor">
        <div className="lamp-editor-head">
          <div><small>PERSONALITY PACK</small><strong>Teach Luma</strong></div>
          <button type="button" onClick={() => setPanelOpen(false)} aria-label="Close behavior editor">×</button>
        </div>
        <label className="lamp-field">
          <span>Personality name</span>
          <input value={personality} onChange={(event) => setPersonality(event.target.value)} />
        </label>
        <div className="lamp-slider-grid">
          <label><span>Reaction speed <b>{settings.reactionSpeed.toFixed(1)}×</b></span><input type="range" min="0.6" max="1.5" step="0.1" value={settings.reactionSpeed} onChange={(event) => setSettings((current) => ({ ...current, reactionSpeed: Number(event.target.value) }))} /></label>
          <label><span>Motion smoothing <b>{Math.round(settings.smoothness * 100)}%</b></span><input type="range" min="0.15" max="0.95" step="0.05" value={settings.smoothness} onChange={(event) => setSettings((current) => ({ ...current, smoothness: Number(event.target.value) }))} /></label>
          <label><span>Brightness <b>{Math.round(settings.brightness * 100)}%</b></span><input type="range" min="0.05" max="1" step="0.05" value={settings.brightness} onChange={(event) => setSettings((current) => ({ ...current, brightness: Number(event.target.value) }))} /></label>
          <label className="lamp-color-field"><span>Light color</span><input type="color" value={settings.lightColor} onChange={(event) => setSettings((current) => ({ ...current, lightColor: event.target.value }))} /></label>
        </div>
        <div className="lamp-mapping-head"><span>Gesture</span><span>Luma responds with</span></div>
        <div className="lamp-mappings">
          {GESTURES.map((gesture) => (
            <label key={gesture}>
              <span>{GESTURE_LABELS[gesture]}</span>
              <select value={mappings[gesture]} onChange={(event) => setMappings((current) => ({ ...current, [gesture]: event.target.value as LampAction }))}>
                {ACTIONS.map((action) => <option key={action} value={action}>{ACTION_LABELS[action]}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="lamp-editor-footer">
          <button type="button" className="lamp-export-button" onClick={() => void downloadBehaviorPack({ mappings, reactionSpeed: settings.reactionSpeed, smoothness: settings.smoothness, lightColor: settings.lightColor, brightness: settings.brightness, personality })}>
            DOWNLOAD BEHAVIOUR PACK <b>↓</b>
          </button>
          <button type="button" onClick={() => downloadSessionReplay(replayRef.current)}>SESSION REPLAY</button>
          <button type="button" onClick={() => setMappings(DEFAULT_MAPPINGS)}>RESET MAPPINGS</button>
        </div>
      </aside>

      <aside className={`lamp-camera ${cameraExpanded ? "expanded" : "collapsed"} ${panelOpen ? "panel-open" : ""}`} aria-label="Mirrored gesture tracking camera">
        <div className="lamp-camera-head">
          <span><i className={cameraLive ? "live" : ""} /> HAND + FACE TRACKING <small>21 LANDMARKS / HAND</small></span>
          <button type="button" onClick={() => setCameraExpanded((expanded) => !expanded)} aria-label={cameraExpanded ? "Collapse camera" : "Expand camera"}>{cameraExpanded ? "−" : "+"}</button>
        </div>
        <div className="lamp-camera-view">
          <video ref={videoRef} muted playsInline aria-label="Camera preview">
            <track kind="captions" src="/lamp/empty.vtt" srcLang="en" label="No spoken content" />
          </video>
          <canvas ref={overlayRef} aria-label="Tracked hand and mouth landmarks" />
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
          {TRACKED_GESTURES.slice(0, 9).map((gesture) => (
            <button type="button" key={gesture} onClick={() => forceGesture(gesture)} title={`${GESTURE_LABELS[gesture]} → ${ACTION_LABELS[mappings[gesture]]}`}>
              <span>{gesture === "point" ? "☝" : gesture === "open_palm" ? "✋" : gesture === "fist" ? "✊" : gesture === "ok" ? "👌" : gesture === "peace" ? "✌" : gesture === "thumbs_up" ? "👍" : gesture === "thumbs_down" ? "👎" : gesture === "finger_near_lips" ? "☝" : "👋"}</span>
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
