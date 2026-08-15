"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

export type DioramaVariant = "crossfire" | "scratch" | "reactor" | "brain" | "demo";

type MemeDioramaProps = {
  variant: DioramaVariant;
  accent: string;
  ariaLabel: string;
  motion?: number;
  speed?: number;
  hero?: boolean;
  onAction?: () => void;
  onDragStart?: () => void;
};

type SceneActors = {
  bars: THREE.Mesh[];
  hands: THREE.Group[];
  pills: THREE.Group[];
  clouds: THREE.Group[];
  officeCharacter?: THREE.Group;
  cat?: THREE.Group;
  gorilla?: THREE.Group;
  trex?: THREE.Group;
  boy?: THREE.Group;
  boyArm?: THREE.Group;
  scientist?: THREE.Group;
  brain?: THREE.Group;
  platters: THREE.Mesh[];
  reactor?: THREE.Group;
  plane?: THREE.Group;
  excavator?: THREE.Group;
  excavatorArm?: THREE.Group;
  businessShoot?: THREE.AnimationAction;
  trexAttack?: THREE.AnimationAction;
};

const MODEL_URLS = {
  business: "/interactable-memes/models/business-man.glb",
  cat: "/interactable-memes/models/cat.glb",
  gorilla: "/interactable-memes/models/gorilla.glb",
  trex: "/interactable-memes/models/trex.glb",
};

function material(color: THREE.ColorRepresentation, emissive = 0, roughness = 0.58) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: emissive ? color : 0x000000,
    emissiveIntensity: emissive,
    metalness: 0.12,
    roughness,
  });
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  surface: THREE.Material,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
) {
  const object = new THREE.Mesh(geometry, surface);
  object.position.set(...position);
  object.rotation.set(...rotation);
  object.scale.set(...scale);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function setModelShadows(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function normalizeModel(object: THREE.Object3D, targetHeight: number) {
  const initial = new THREE.Box3().setFromObject(object);
  const size = initial.getSize(new THREE.Vector3());
  const scale = targetHeight / Math.max(size.y, 0.001);
  object.scale.setScalar(scale);
  const fitted = new THREE.Box3().setFromObject(object);
  const center = fitted.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.y -= fitted.min.y;
  object.position.z -= center.z;
}

function makeTextPanel(text: string, width: number, height: number, accent: string, inverse = false) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = Math.max(192, Math.round((height / width) * 1024));
  const context = canvas.getContext("2d");
  if (!context) return new THREE.Group();

  context.fillStyle = inverse ? "#11110f" : "#f0ede4";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = accent;
  context.lineWidth = 24;
  context.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
  context.fillStyle = inverse ? "#f0ede4" : "#11110f";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `900 ${Math.min(122, canvas.height * 0.35)}px Arial`;
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const lineHeight = canvas.height / (lines.length + 0.3);
    context.fillText(line, canvas.width / 2, lineHeight * (index + 0.68), canvas.width - 72);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  const back = addMesh(group, new THREE.BoxGeometry(width, height, 0.09), material(inverse ? 0x11110f : 0xf0ede4), [0, 0, 0]);
  const face = addMesh(group, new THREE.PlaneGeometry(width - 0.06, height - 0.06), new THREE.MeshBasicMaterial({ map: texture }), [0, 0, 0.051]);
  back.userData.generatedTexture = texture;
  face.userData.generatedTexture = texture;
  return group;
}

function makeFingerGun(skin: THREE.Material, sleeve: THREE.Material, side: 1 | -1) {
  const hand = new THREE.Group();
  const arm = addMesh(hand, new THREE.CapsuleGeometry(0.2, 1.15, 6, 12), sleeve, [-side * 0.82, 0, 0], [0, 0, Math.PI / 2]);
  const palm = addMesh(hand, new THREE.BoxGeometry(0.58, 0.42, 0.3), skin, [0, 0, 0]);
  const index = addMesh(hand, new THREE.CapsuleGeometry(0.11, 0.88, 6, 12), skin, [side * 0.62, 0.12, 0], [0, 0, Math.PI / 2]);
  const thumb = addMesh(hand, new THREE.CapsuleGeometry(0.1, 0.42, 6, 12), skin, [side * 0.18, 0.4, 0], [0, 0, side * 0.68]);
  arm.castShadow = palm.castShadow = index.castShadow = thumb.castShadow = true;
  hand.rotation.z = side === 1 ? 0 : Math.PI;
  return hand;
}

function makeCapsule(upper = 0xef334e, lower = 0xf8f3e8) {
  const capsule = new THREE.Group();
  addMesh(capsule, new THREE.CapsuleGeometry(0.13, 0.19, 5, 12), material(upper, 0.06), [0, 0.14, 0]);
  addMesh(capsule, new THREE.CapsuleGeometry(0.13, 0.19, 5, 12), material(lower), [0, -0.14, 0]);
  return capsule;
}

function makeEye(parent: THREE.Object3D, x: number, y: number, z: number, scale = 1) {
  addMesh(parent, new THREE.SphereGeometry(0.22 * scale, 20, 16), material(0xffffff), [x, y, z], [0, 0, 0], [1, 1.1, 0.5]);
  return addMesh(parent, new THREE.SphereGeometry(0.075 * scale, 16, 12), material(0x101010), [x, y, z + 0.12 * scale]);
}

function makeCartoonBoy(actors: SceneActors) {
  const boy = new THREE.Group();
  const skin = material(0xf3bd7b);
  const yellow = material(0xf5dc3f);
  const denim = material(0x4f72b8);
  const red = material(0xc73343);
  addMesh(boy, new THREE.SphereGeometry(0.58, 24, 18), skin, [0, 1.85, 0]);
  const leftPupil = makeEye(boy, -0.22, 1.95, 0.48, 1.05);
  const rightPupil = makeEye(boy, 0.22, 1.95, 0.48, 1.05);
  boy.userData.pupils = [leftPupil, rightPupil];
  for (let index = 0; index < 9; index += 1) {
    const hair = addMesh(boy, new THREE.SphereGeometry(0.23, 12, 8), material(0x6d381f), [-0.42 + (index % 4) * 0.28, 2.28 + Math.floor(index / 4) * 0.12, -0.05], [0, 0, 0], [1, 0.65, 0.72]);
    hair.rotation.z = index * 0.2;
  }
  addMesh(boy, new THREE.BoxGeometry(0.82, 1.05, 0.46), yellow, [0, 0.86, 0]);
  addMesh(boy, new THREE.BoxGeometry(0.88, 0.48, 0.5), denim, [0, 0.17, 0]);
  addMesh(boy, new THREE.BoxGeometry(0.78, 1.12, 0.25), red, [0, 0.92, -0.34]);
  const leftLeg = addMesh(boy, new THREE.CapsuleGeometry(0.16, 0.62, 6, 12), skin, [-0.23, -0.45, 0]);
  const rightLeg = addMesh(boy, new THREE.CapsuleGeometry(0.16, 0.62, 6, 12), skin, [0.23, -0.45, 0]);
  leftLeg.rotation.z = 0.04;
  rightLeg.rotation.z = -0.04;
  const leftArm = new THREE.Group();
  addMesh(leftArm, new THREE.CapsuleGeometry(0.14, 0.85, 6, 12), skin, [0, -0.42, 0]);
  leftArm.position.set(-0.52, 1.2, 0.05);
  leftArm.rotation.z = 1.13;
  boy.add(leftArm);
  const pointFinger = addMesh(leftArm, new THREE.CapsuleGeometry(0.065, 0.44, 5, 10), skin, [-0.2, -0.88, 0], [0, 0, Math.PI / 2]);
  pointFinger.rotation.z = Math.PI / 2;
  const rightArm = addMesh(boy, new THREE.CapsuleGeometry(0.14, 0.84, 6, 12), skin, [0.55, 0.85, 0], [0, 0, -0.16]);
  rightArm.rotation.z = -0.15;
  actors.boy = boy;
  actors.boyArm = leftArm;
  return boy;
}

function makeScientist(actors: SceneActors) {
  const scientist = new THREE.Group();
  const skin = material(0xeab47b);
  const white = material(0xf4f2e8);
  const cyan = material(0x93e4e8);
  addMesh(scientist, new THREE.SphereGeometry(0.48, 24, 18), skin, [0, 2.3, 0]);
  makeEye(scientist, -0.18, 2.4, 0.4, 0.88);
  makeEye(scientist, 0.18, 2.4, 0.4, 0.88);
  for (let index = 0; index < 10; index += 1) {
    addMesh(scientist, new THREE.ConeGeometry(0.2, 0.72, 8), material(0x9bc7d8), [-0.52 + index * 0.115, 2.82 + Math.sin(index) * 0.1, -0.05], [0, 0, -0.9 + index * 0.2]);
  }
  addMesh(scientist, new THREE.BoxGeometry(1.05, 1.5, 0.45), white, [0, 1.1, 0]);
  addMesh(scientist, new THREE.BoxGeometry(0.58, 1.25, 0.48), cyan, [0, 1.18, 0.04]);
  addMesh(scientist, new THREE.CapsuleGeometry(0.16, 1.15, 6, 12), white, [-0.68, 1.05, 0], [0, 0, 0.12]);
  addMesh(scientist, new THREE.CapsuleGeometry(0.16, 1.15, 6, 12), white, [0.68, 1.05, 0], [0, 0, -0.12]);
  addMesh(scientist, new THREE.CapsuleGeometry(0.18, 0.9, 6, 12), material(0x503a2a), [-0.28, -0.03, 0]);
  addMesh(scientist, new THREE.CapsuleGeometry(0.18, 0.9, 6, 12), material(0x503a2a), [0.28, -0.03, 0]);
  actors.scientist = scientist;
  return scientist;
}

function makeBrain() {
  const brain = new THREE.Group();
  const pink = material(0xef6b8a, 0.22);
  for (let index = 0; index < 13; index += 1) {
    const lobe = addMesh(brain, new THREE.SphereGeometry(0.24, 14, 10), pink, [((index % 4) - 1.5) * 0.28, (Math.floor(index / 4) - 1) * 0.22, (index % 2) * 0.13]);
    lobe.scale.set(1, 0.72, 0.78);
  }
  return brain;
}

function makeTurntable(parent: THREE.Object3D, x: number, accent: string) {
  const turntable = new THREE.Group();
  addMesh(turntable, new THREE.BoxGeometry(2.2, 0.35, 1.7), material(0x202124, 0, 0.35), [0, 0, 0]);
  const disc = addMesh(turntable, new THREE.CylinderGeometry(0.68, 0.68, 0.08, 48), material(0x080808, 0.08, 0.28), [0, 0.23, 0], [Math.PI / 2, 0, 0]);
  addMesh(turntable, new THREE.CylinderGeometry(0.16, 0.16, 0.1, 24), material(accent, 0.32), [0, 0.29, 0], [Math.PI / 2, 0, 0]);
  addMesh(turntable, new THREE.BoxGeometry(0.06, 0.06, 1.05), material(0xd8d5ca, 0.08, 0.3), [0.73, 0.35, 0.06], [0, 0.36, 0]);
  turntable.position.set(x, -1.22, 0.25);
  parent.add(turntable);
  return { turntable, disc };
}

function makeAirplane() {
  const plane = new THREE.Group();
  const white = material(0xf8f8f3, 0.04, 0.35);
  const stripe = material(0x27303d, 0.04, 0.3);
  const metal = material(0xbfc4c8, 0.08, 0.25);
  const body = addMesh(plane, new THREE.CapsuleGeometry(0.3, 3.3, 12, 24), white, [0, 0, 0], [0, 0, Math.PI / 2]);
  body.scale.z = 0.84;
  addMesh(plane, new THREE.BoxGeometry(1.35, 0.1, 2.4), white, [0.2, -0.02, 0], [0, -0.08, 0]);
  addMesh(plane, new THREE.BoxGeometry(0.72, 0.72, 0.09), white, [-1.65, 0.35, 0], [0, 0, -0.08]);
  addMesh(plane, new THREE.BoxGeometry(1.5, 0.11, 0.95), white, [-1.42, 0.04, 0]);
  addMesh(plane, new THREE.BoxGeometry(2.6, 0.08, 0.16), stripe, [0.1, 0.11, 0.26]);
  for (let index = 0; index < 12; index += 1) addMesh(plane, new THREE.SphereGeometry(0.045, 10, 8), material(0x161d28, 0.08), [-1.05 + index * 0.2, 0.18, 0.29]);
  for (const z of [-0.68, 0.68]) {
    addMesh(plane, new THREE.CapsuleGeometry(0.15, 0.48, 6, 12), metal, [0.45, -0.25, z], [0, 0, Math.PI / 2]);
  }
  return plane;
}

function makeExcavator(actors: SceneActors) {
  const rig = new THREE.Group();
  const yellow = material(0xe4a51c, 0.04, 0.42);
  const dark = material(0x292724, 0, 0.3);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x83c4dc, transparent: true, opacity: 0.72, roughness: 0.18, metalness: 0.1 });
  for (const z of [-0.55, 0.55]) {
    addMesh(rig, new THREE.BoxGeometry(1.9, 0.48, 0.42), dark, [0, 0, z]);
    for (let index = 0; index < 5; index += 1) addMesh(rig, new THREE.CylinderGeometry(0.18, 0.18, 0.08, 16), material(0x515151), [-0.65 + index * 0.32, 0, z * 1.05], [Math.PI / 2, 0, 0]);
  }
  addMesh(rig, new THREE.BoxGeometry(1.35, 0.64, 1.05), yellow, [-0.15, 0.58, 0]);
  addMesh(rig, new THREE.BoxGeometry(0.72, 0.65, 0.82), glass, [0.18, 1.02, 0]);
  const armPivot = new THREE.Group();
  addMesh(armPivot, new THREE.BoxGeometry(2.85, 0.26, 0.34), yellow, [1.33, 0, 0]);
  const forearmPivot = new THREE.Group();
  addMesh(forearmPivot, new THREE.BoxGeometry(1.7, 0.23, 0.32), yellow, [0.76, 0, 0]);
  const bucket = addMesh(forearmPivot, new THREE.BoxGeometry(0.6, 0.62, 0.64), dark, [1.62, -0.22, 0], [0, 0, -0.25]);
  bucket.scale.set(1, 1, 1.1);
  forearmPivot.position.set(2.65, 0, 0);
  forearmPivot.rotation.z = -0.52;
  armPivot.add(forearmPivot);
  armPivot.position.set(0.2, 1.05, 0);
  armPivot.rotation.z = 0.58;
  rig.add(armPivot);
  actors.excavatorArm = armPivot;
  return rig;
}

function addOffice(root: THREE.Group) {
  const beige = material(0xb5a58f, 0, 0.78);
  const charcoal = material(0x262525, 0, 0.6);
  addMesh(root, new THREE.BoxGeometry(10, 5.8, 0.16), beige, [0, 0.65, -2.25]);
  for (const x of [-2.7, 2.7]) {
    addMesh(root, new THREE.BoxGeometry(2.45, 2.45, 0.1), material(0x3d444a, 0.04), [x, 0.85, -2.12]);
    for (let index = 0; index < 12; index += 1) addMesh(root, new THREE.BoxGeometry(2.3, 0.045, 0.05), material(0xc8c2b5), [x, -0.2 + index * 0.18, -2.02]);
  }
  for (let index = 0; index < 5; index += 1) {
    const chair = new THREE.Group();
    addMesh(chair, new THREE.BoxGeometry(0.85, 0.14, 0.72), charcoal, [0, 0.35, 0]);
    addMesh(chair, new THREE.BoxGeometry(0.85, 0.85, 0.14), charcoal, [0, 0.85, -0.3], [-0.1, 0, 0]);
    addMesh(chair, new THREE.CylinderGeometry(0.055, 0.055, 0.75, 10), charcoal, [-0.32, -0.04, 0.25]);
    addMesh(chair, new THREE.CylinderGeometry(0.055, 0.055, 0.75, 10), charcoal, [0.32, -0.04, 0.25]);
    chair.position.set(-3.2 + index * 1.6, -2.05, -1.35);
    root.add(chair);
  }
}

function addBrickWall(root: THREE.Group) {
  const mortar = material(0xc7a77f, 0, 0.86);
  addMesh(root, new THREE.BoxGeometry(10, 5.7, 0.16), material(0x916849, 0, 0.86), [0, 0.6, -2.3]);
  for (let row = 0; row < 12; row += 1) {
    for (let column = 0; column < 12; column += 1) {
      const x = -4.9 + column * 0.9 + (row % 2) * 0.45;
      addMesh(root, new THREE.BoxGeometry(0.79, 0.3, 0.08), mortar, [x, -1.1 + row * 0.38, -2.17]);
    }
  }
}

function addZoo(root: THREE.Group) {
  addMesh(root, new THREE.BoxGeometry(10, 0.22, 7), material(0x49853c, 0, 0.9), [0, -2.05, -0.25]);
  for (let index = 0; index < 12; index += 1) {
    const rock = addMesh(root, new THREE.DodecahedronGeometry(0.38 + (index % 3) * 0.13, 0), material(0x7d7468), [-4.4 + index * 0.82, -1.75 + (index % 2) * 0.1, -1.8 + (index % 4) * 0.3]);
    rock.scale.y = 0.62;
  }
}

function addRunway(root: THREE.Group, actors: SceneActors) {
  addMesh(root, new THREE.BoxGeometry(12, 0.18, 8), material(0x8b8e91, 0, 0.9), [0, -2.12, -0.3]);
  for (let index = 0; index < 8; index += 1) addMesh(root, new THREE.BoxGeometry(0.1, 0.03, 0.82), material(0xf0ede4), [-4.2 + index * 1.2, -1.99, 0.1]);
  for (let index = 0; index < 7; index += 1) {
    const cloud = new THREE.Group();
    for (let puff = 0; puff < 5; puff += 1) addMesh(cloud, new THREE.SphereGeometry(0.34 + (puff % 2) * 0.12, 14, 10), material(0xffffff, 0, 0.92), [(puff - 2) * 0.38, Math.sin(puff) * 0.12, 0]);
    cloud.position.set(-5 + index * 1.7, 2.2 + (index % 2) * 0.48, -2.1);
    root.add(cloud);
    actors.clouds.push(cloud);
  }
}

function findClip(gltf: GLTF, needle: string) {
  return gltf.animations.find((clip) => clip.name.includes(needle));
}

export function MemeDiorama({
  variant,
  accent,
  ariaLabel,
  motion = 0,
  speed = 118,
  hero = false,
  onAction,
  onDragStart,
}: MemeDioramaProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef(onAction);
  const dragStartRef = useRef(onDragStart);
  const stateRef = useRef({ motion, speed });
  const labelRef = useRef(ariaLabel);

  useEffect(() => { actionRef.current = onAction; }, [onAction]);
  useEffect(() => { dragStartRef.current = onDragStart; }, [onDragStart]);
  useEffect(() => { stateRef.current = { motion, speed }; }, [motion, speed]);
  useEffect(() => {
    labelRef.current = ariaLabel;
    mountRef.current?.querySelector("canvas")?.setAttribute("aria-label", ariaLabel);
  }, [ariaLabel]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.domElement.className = "diorama-canvas";
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("role", "button");
    renderer.domElement.setAttribute("aria-label", labelRef.current);
    mount.appendChild(renderer.domElement);

    const backgrounds: Record<DioramaVariant, number> = {
      crossfire: 0x7f7467,
      scratch: 0x5b3fcc,
      reactor: 0x739c47,
      brain: 0x82cae8,
      demo: 0x79bce2,
    };
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(backgrounds[variant]);
    scene.fog = new THREE.Fog(backgrounds[variant], 10, 18);
    const camera = new THREE.PerspectiveCamera(hero ? 34 : 38, 1, 0.1, 100);
    camera.position.set(0, hero ? 0.25 : 0.15, hero ? 8.9 : 8.2);

    scene.add(new THREE.HemisphereLight(0xfff7e9, 0x24211f, 2.25));
    const key = new THREE.DirectionalLight(0xffffff, 5.2);
    key.position.set(-4, 7, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const rim = new THREE.PointLight(new THREE.Color(accent), 26, 13);
    rim.position.set(4.3, 1.4, 3.5);
    scene.add(rim);
    const fill = new THREE.PointLight(0x7d66ff, 12, 10);
    fill.position.set(-4, -0.5, 3);
    scene.add(fill);

    const root = new THREE.Group();
    scene.add(root);
    const actors: SceneActors = { bars: [], hands: [], pills: [], clouds: [], platters: [] };
    const mixers: THREE.AnimationMixer[] = [];
    const generatedTextures: THREE.Texture[] = [];
    const loader = new GLTFLoader();
    let disposed = false;

    const floor = addMesh(root, new THREE.PlaneGeometry(12, 9), new THREE.ShadowMaterial({ color: 0x11110f, opacity: 0.28 }), [0, -2.18, 0], [-Math.PI / 2, 0, 0]);
    floor.receiveShadow = true;
    const grid = new THREE.GridHelper(12, 24, new THREE.Color(accent), 0x3d3d3d);
    grid.position.y = -2.16;
    grid.material.transparent = true;
    grid.material.opacity = 0.26;
    root.add(grid);

    function addPanel(text: string, width: number, height: number, position: [number, number, number], rotation: [number, number, number] = [0, 0, 0], inverse = false) {
      const panel = makeTextPanel(text, width, height, accent, inverse);
      panel.position.set(...position);
      panel.rotation.set(...rotation);
      panel.traverse((object) => {
        const texture = object.userData.generatedTexture as THREE.Texture | undefined;
        if (texture && !generatedTextures.includes(texture)) generatedTextures.push(texture);
      });
      root.add(panel);
      return panel;
    }

    async function loadCharacter(url: string, targetHeight: number, position: [number, number, number], rotationY = 0) {
      const gltf = await loader.loadAsync(url);
      if (disposed) {
        gltf.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) object.geometry.dispose();
        });
        return null;
      }
      const wrapper = new THREE.Group();
      normalizeModel(gltf.scene, targetHeight);
      setModelShadows(gltf.scene);
      wrapper.add(gltf.scene);
      wrapper.position.set(...position);
      wrapper.rotation.y = rotationY;
      root.add(wrapper);
      return { wrapper, gltf };
    }

    if (variant === "crossfire") {
      addOffice(root);
      addPanel("OFFICE CROSSFIRE", 3.1, 0.56, [0, 2.48, -1.65], [0, 0, -0.025], true);
      const skin = material(0xd5a27d);
      const sleeve = material(0xe8e5dc);
      const handPositions: Array<[number, number, number, 1 | -1, number]> = [
        [-3.05, 1.1, 0.6, 1, -0.08], [3.0, 0.95, 0.7, -1, 0.1], [-3.0, -0.75, 0.85, 1, 0.14], [3.05, -0.95, 0.9, -1, -0.12],
      ];
      handPositions.forEach(([x, y, z, side, tilt]) => {
        const hand = makeFingerGun(skin, sleeve, side);
        hand.position.set(x, y, z);
        hand.rotation.z += tilt;
        root.add(hand);
        actors.hands.push(hand);
      });
      void loadCharacter(MODEL_URLS.business, 3.65, [0, -2.12, 0.05]).then((loaded) => {
        if (!loaded) return;
        actors.officeCharacter = loaded.wrapper;
        const mixer = new THREE.AnimationMixer(loaded.gltf.scene);
        mixers.push(mixer);
        const idle = findClip(loaded.gltf, "Idle_Gun_Pointing") ?? findClip(loaded.gltf, "Idle_Neutral");
        const shoot = findClip(loaded.gltf, "Idle_Gun_Shoot") ?? findClip(loaded.gltf, "Gun_Shoot");
        if (idle) mixer.clipAction(idle).play();
        if (shoot) {
          actors.businessShoot = mixer.clipAction(shoot);
          actors.businessShoot.setLoop(THREE.LoopOnce, 1);
          actors.businessShoot.clampWhenFinished = false;
        }
      });
    }

    if (variant === "scratch") {
      addBrickWall(root);
      addPanel("DJ CAT / LIVE", 2.55, 0.52, [0, 2.45, -1.7], [0, 0, 0.02], true);
      const left = makeTurntable(root, -1.23, accent);
      const right = makeTurntable(root, 1.23, accent);
      actors.platters.push(left.disc, right.disc);
      for (let index = 0; index < 13; index += 1) {
        const bar = addMesh(root, new THREE.BoxGeometry(0.22, 0.55, 0.2), material(accent, 0.34), [-2.55 + index * 0.43, 1.85, -1.75]);
        actors.bars.push(bar);
      }
      void loadCharacter(MODEL_URLS.cat, 2.25, [0, -0.95, 0.1], 0).then((loaded) => {
        if (!loaded) return;
        actors.cat = loaded.wrapper;
        const mixer = new THREE.AnimationMixer(loaded.gltf.scene);
        mixers.push(mixer);
        const headbutt = findClip(loaded.gltf, "Headbutt") ?? findClip(loaded.gltf, "Idle");
        if (headbutt) mixer.clipAction(headbutt).play();
      });
    }

    if (variant === "reactor") {
      addZoo(root);
      addPanel("GUYS I'M GONNA TRY MY BEST", 4.65, 0.58, [0, 2.45, -1.65], [0, 0, -0.018]);
      addPanel("BUT IT'S A RADIOACTIVE DINOSAUR", 5.25, 0.62, [0, -1.72, 1.25], [0.32, 0, 0.012], true);
      const reactor = new THREE.Group();
      const core = addMesh(reactor, new THREE.IcosahedronGeometry(0.43, 2), material(accent, 0.7, 0.22), [0, 0, 0]);
      for (let index = 0; index < 3; index += 1) addMesh(reactor, new THREE.TorusGeometry(0.68 + index * 0.2, 0.035, 8, 48), material(accent, 0.45), [0, 0, 0], [index * 0.68, index * 0.45, index * 0.82]);
      reactor.position.set(0.15, -0.2, 0.55);
      reactor.userData.core = core;
      root.add(reactor);
      actors.reactor = reactor;
      void loadCharacter(MODEL_URLS.gorilla, 2.6, [-1.7, -2.05, 0.05], -0.28).then((loaded) => { if (loaded) actors.gorilla = loaded.wrapper; });
      void loadCharacter(MODEL_URLS.trex, 2.85, [1.75, -2.04, -0.15], 0.22).then((loaded) => {
        if (!loaded) return;
        actors.trex = loaded.wrapper;
        const mixer = new THREE.AnimationMixer(loaded.gltf.scene);
        mixers.push(mixer);
        const idle = findClip(loaded.gltf, "TRex_Idle");
        const attack = findClip(loaded.gltf, "TRex_Attack");
        if (idle) mixer.clipAction(idle).play();
        if (attack) {
          actors.trexAttack = mixer.clipAction(attack);
          actors.trexAttack.setLoop(THREE.LoopOnce, 1);
        }
      });
    }

    if (variant === "brain") {
      addMesh(root, new THREE.BoxGeometry(10, 5.8, 0.15), material(0xa7bcbd, 0, 0.82), [0, 0.55, -2.25]);
      addMesh(root, new THREE.BoxGeometry(10, 0.2, 7), material(0x71868b, 0, 0.82), [0, -2.08, -0.2]);
      addPanel("ME: HEAL MY DISEASE\nBRAIN: NO", 3.65, 1.05, [-1.15, 2.22, -1.65], [0, 0.06, -0.035]);
      const boy = makeCartoonBoy(actors);
      boy.position.set(-0.85, -1.42, 0.3);
      root.add(boy);
      const scientist = makeScientist(actors);
      scientist.position.set(1.25, -1.65, -0.15);
      scientist.scale.setScalar(1.08);
      root.add(scientist);
      const brain = makeBrain();
      brain.position.set(2.5, 1.65, 0.4);
      brain.scale.setScalar(0.78);
      root.add(brain);
      actors.brain = brain;
      for (let index = 0; index < 11; index += 1) {
        const pill = makeCapsule();
        pill.position.set(-3.4 + (index % 6) * 1.25, 2.9 + Math.floor(index / 6) * 0.62, -0.2 + (index % 3) * 0.3);
        pill.rotation.set(index * 0.24, index * 0.31, index * 0.46);
        pill.userData.originY = pill.position.y;
        pill.userData.offset = index * 0.66;
        root.add(pill);
        actors.pills.push(pill);
      }
    }

    if (variant === "demo") {
      addRunway(root, actors);
      addPanel("CLIENT WANTS A DEMO", 3.45, 0.58, [-1.15, 2.45, -1.5], [0, 0.05, -0.025]);
      addPanel("PRODUCT ISN'T READY", 3.55, 0.58, [1.2, -1.55, 1.45], [0.32, -0.05, 0.02], true);
      const excavator = makeExcavator(actors);
      excavator.position.set(-2.05, -2.02, 0.05);
      excavator.scale.setScalar(0.78);
      root.add(excavator);
      actors.excavator = excavator;
      const plane = makeAirplane();
      plane.position.set(1.55, 0.18, 0.2);
      plane.rotation.set(0.02, -0.18, -0.12);
      plane.scale.setScalar(0.92);
      root.add(plane);
      actors.plane = plane;
    }

    let targetX = hero ? -0.04 : -0.08;
    let targetY = hero ? -0.26 : -0.08;
    let currentX = targetX;
    let currentY = targetY;
    let dragging = false;
    let dragged = false;
    let lastX = 0;
    let lastY = 0;
    let pointerX = 0;
    let pointerY = 0;
    let impact = 0;
    let scratchVelocity = 0;
    let pillDrop = 0;
    let previousMotion = stateRef.current.motion;
    let frame = 0;
    let visible = true;
    const timer = new THREE.Timer();
    timer.connect(document);

    function resize() {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.position.z = width < 560 ? (hero ? 10.5 : 9.8) : (hero ? 8.9 : 8.2);
      camera.updateProjectionMatrix();
    }

    function onPointerDown(event: PointerEvent) {
      dragging = true;
      dragged = false;
      lastX = event.clientX;
      lastY = event.clientY;
      dragStartRef.current?.();
      renderer.domElement.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
      targetY += dx * 0.006;
      targetX = THREE.MathUtils.clamp(targetX + dy * 0.0045, -0.5, 0.5);
      scratchVelocity += dx * 0.018;
      lastX = event.clientX;
      lastY = event.clientY;
    }

    function activate() {
      impact = 1;
      pillDrop = 1;
      actionRef.current?.();
    }

    function onPointerUp(event: PointerEvent) {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      if (!dragged) activate();
    }

    function onPointerCancel(event: PointerEvent) {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        targetY += event.key === "ArrowLeft" ? -0.2 : 0.2;
      }
    }

    function animate(timestamp?: number) {
      frame = requestAnimationFrame(animate);
      timer.update(timestamp);
      if (!visible) return;
      const elapsed = timer.getElapsed();
      const delta = Math.min(timer.getDelta(), 0.05);
      const live = stateRef.current;
      mixers.forEach((mixer) => mixer.update(delta));
      currentX = THREE.MathUtils.lerp(currentX, targetX, dragging ? 0.16 : 0.065);
      currentY = THREE.MathUtils.lerp(currentY, targetY, dragging ? 0.16 : 0.065);
      impact *= 0.9;
      scratchVelocity *= 0.935;
      pillDrop *= 0.965;
      root.rotation.set(currentX + Math.sin(elapsed * 0.65) * 0.012, currentY, Math.sin(elapsed * 0.52) * 0.008 + impact * 0.025);
      root.position.y = Math.sin(elapsed * 0.82) * 0.025;

      if (live.motion !== previousMotion) {
        previousMotion = live.motion;
        if (variant === "crossfire" && actors.businessShoot) actors.businessShoot.reset().fadeIn(0.05).play();
        if (variant === "reactor" && actors.trexAttack) actors.trexAttack.reset().fadeIn(0.08).play();
        if (variant === "brain") pillDrop = 1;
      }

      if (variant === "crossfire") {
        actors.hands.forEach((hand, index) => {
          hand.position.z = 0.62 + Math.sin(elapsed * 1.9 + index) * 0.06 + impact * 0.55;
          hand.rotation.y = Math.sin(elapsed * 0.8 + index) * 0.06;
        });
        if (actors.officeCharacter) actors.officeCharacter.rotation.z = Math.sin(elapsed * 1.2) * 0.012 - impact * 0.04;
      }

      if (variant === "scratch") {
        actors.platters.forEach((disc) => {
          disc.rotation.y += (live.motion ? live.speed / 1200 : 0) + scratchVelocity;
        });
        actors.bars.forEach((bar, index) => { bar.scale.y = 0.35 + Math.abs(Math.sin(elapsed * (2 + live.speed / 95) + index * 0.7)) * (live.motion ? 1.65 : 0.15); });
        if (actors.cat) {
          actors.cat.rotation.z = Math.sin(elapsed * (live.motion ? 3.2 : 0.7)) * (live.motion ? 0.08 : 0.018);
          actors.cat.position.y = -0.95 + Math.abs(Math.sin(elapsed * 2.2)) * (live.motion ? 0.11 : 0.02);
        }
      }

      if (variant === "reactor") {
        const power = Math.min(live.motion, 3);
        if (actors.reactor) {
          actors.reactor.rotation.x += delta * (0.45 + power * 0.35);
          actors.reactor.rotation.y += delta * (0.72 + power * 0.5);
          actors.reactor.scale.setScalar(0.8 + power * 0.18 + Math.sin(elapsed * (2 + power)) * 0.05);
        }
        if (actors.gorilla) actors.gorilla.rotation.z = Math.sin(elapsed * (1.4 + power)) * (0.02 + power * 0.025);
        if (actors.trex) actors.trex.position.x = 1.75 + Math.sin(elapsed * 1.2) * 0.06 - power * 0.08;
        rim.intensity = 14 + power * 14 + impact * 22;
      }

      if (variant === "brain") {
        const dose = Math.min(live.motion, 5);
        if (actors.brain) {
          actors.brain.rotation.y = elapsed * 0.55;
          actors.brain.scale.setScalar(0.68 + dose * 0.045 + impact * 0.18);
        }
        if (actors.boy) {
          const pupils = actors.boy.userData.pupils as THREE.Object3D[];
          pupils.forEach((pupil, index) => {
            const restingX = index === 0 ? -0.22 : 0.22;
            pupil.position.x = THREE.MathUtils.lerp(pupil.position.x, restingX + pointerX * 0.045, 0.08);
            pupil.position.y = THREE.MathUtils.lerp(pupil.position.y, 1.95 + pointerY * 0.035, 0.08);
          });
        }
        if (actors.boyArm) actors.boyArm.rotation.z = 1.13 + Math.sin(elapsed * 1.4) * 0.05 + impact * 0.32;
        actors.pills.forEach((pill, index) => {
          const fall = pillDrop > 0.05 && index === live.motion % actors.pills.length;
          pill.position.y = fall ? 2.8 - (1 - pillDrop) * 5.2 : pill.userData.originY + Math.sin(elapsed * 1.5 + pill.userData.offset) * 0.16;
          pill.rotation.x += delta * (0.7 + index * 0.04);
          pill.rotation.z += delta * 0.6;
        });
      }

      if (variant === "demo") {
        const panic = Math.min(live.motion, 4);
        if (actors.plane) {
          actors.plane.rotation.z = -0.12 + Math.sin(elapsed * (1.6 + panic * 0.55)) * (0.035 + panic * 0.05) + impact * 0.14;
          actors.plane.position.y = 0.18 + Math.sin(elapsed * 2.1) * (0.045 + panic * 0.03);
          actors.plane.position.x = 1.55 + Math.sin(elapsed * 1.25) * panic * 0.05;
        }
        if (actors.excavatorArm) actors.excavatorArm.rotation.z = 0.58 + Math.sin(elapsed * 1.18) * 0.04 + panic * 0.045 + impact * 0.13;
        actors.clouds.forEach((cloud, index) => { cloud.position.x = -5 + ((elapsed * (0.14 + index * 0.014) + index * 1.7) % 11); });
      }

      renderer.render(scene, camera);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    const visibilityObserver = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { rootMargin: "180px" });
    visibilityObserver.observe(mount);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);
    renderer.domElement.addEventListener("keydown", onKeyDown);
    resize();
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      renderer.domElement.removeEventListener("keydown", onKeyDown);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const surfaces = Array.isArray(object.material) ? object.material : [object.material];
          surfaces.forEach((surface) => surface.dispose());
        }
      });
      generatedTextures.forEach((texture) => texture.dispose());
      timer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [accent, hero, variant]);

  return (
    <div className={`diorama-stage${hero ? " diorama-stage-hero" : ""}`} data-variant={variant} ref={mountRef}>
      <div className="webgl-fallback" aria-hidden="true">LOADING 3D CHARACTERS…</div>
      <span className="diorama-hint" aria-hidden="true">DRAG TO ORBIT · TAP TO ACTIVATE</span>
    </div>
  );
}
