"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type DioramaVariant = "nod" | "scratch" | "reactor" | "brain" | "demo";
export type NodDirection = "center" | "up" | "right" | "left" | "down";

type MemeDioramaProps = {
  variant: DioramaVariant;
  accent: string;
  ariaLabel: string;
  motion?: number;
  speed?: number;
  hero?: boolean;
  orbitable?: boolean;
  onAction?: () => void;
  onDragStart?: () => void;
  onNodDirection?: (direction: NodDirection) => void;
};

type LoadState = {
  status: "loading" | "ready" | "error";
  progress: number;
};

type SceneActors = {
  nodArrows: THREE.Object3D[];
  nodPupils: THREE.Object3D[];
  platters: THREE.Object3D[];
  bars: THREE.Object3D[];
  pills: THREE.Object3D[];
  portalRings: THREE.Object3D[];
  smoke: THREE.Object3D[];
  starePupils: THREE.Object3D[];
  nodHead?: THREE.Object3D;
  nodBeard?: THREE.Object3D;
  cat?: THREE.Object3D;
  gorilla?: THREE.Object3D;
  godzilla?: THREE.Object3D;
  reactor?: THREE.Object3D;
  morty?: THREE.Object3D;
  mortyArm?: THREE.Object3D;
  rick?: THREE.Object3D;
  brain?: THREE.Object3D;
  plane?: THREE.Object3D;
  propeller?: THREE.Object3D;
  excavatorArm?: THREE.Object3D;
  excavatorUpper?: THREE.Object3D;
};

const SCENE_URLS: Record<DioramaVariant, string> = {
  nod: "/interactable-memes/studio-models/nod.glb?v=11",
  scratch: "/interactable-memes/studio-models/scratch.glb?v=11",
  reactor: "/interactable-memes/studio-models/reactor.glb?v=12",
  brain: "/interactable-memes/studio-models/brain.glb?v=11",
  demo: "/interactable-memes/studio-models/demo.glb?v=11",
};

const POSTER_URLS: Record<DioramaVariant, string> = {
  nod: "/interactable-memes/studio-previews/nod.png?v=11",
  scratch: "/interactable-memes/studio-previews/scratch.png?v=11",
  reactor: "/interactable-memes/studio-previews/reactor.png?v=12",
  brain: "/interactable-memes/studio-previews/brain.png?v=11",
  demo: "/interactable-memes/studio-previews/demo.png?v=11",
};

const BACKGROUNDS: Record<DioramaVariant, number> = {
  nod: 0x030a0f,
  scratch: 0x09050f,
  reactor: 0x070b05,
  brain: 0x031015,
  demo: 0x100a03,
};

function namedChildren(root: THREE.Object3D, prefix: string) {
  const found: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name.startsWith(prefix)) found.push(object);
  });
  return found;
}

function rememberTransform(object?: THREE.Object3D) {
  if (!object) return;
  object.userData.basePosition = object.position.clone();
  object.userData.baseRotation = object.rotation.clone();
  object.userData.baseScale = object.scale.clone();
}

function basePosition(object: THREE.Object3D) {
  return object.userData.basePosition as THREE.Vector3;
}

function baseRotation(object: THREE.Object3D) {
  return object.userData.baseRotation as THREE.Euler;
}

function baseScale(object: THREE.Object3D) {
  return object.userData.baseScale as THREE.Vector3;
}

function collectActors(asset: THREE.Object3D): SceneActors {
  const actors: SceneActors = {
    nodArrows: namedChildren(asset, "NodArrow_").filter((object) => /^NodArrow_(up|right|left|down)$/.test(object.name)),
    nodPupils: namedChildren(asset, "NodPupil_"),
    platters: [asset.getObjectByName("Platter_L"), asset.getObjectByName("Platter_R")].filter(Boolean) as THREE.Object3D[],
    bars: namedChildren(asset, "EQ_"),
    pills: namedChildren(asset, "Pill_").filter((object) => /^Pill_\d+$/.test(object.name)),
    portalRings: namedChildren(asset, "PortalRing_"),
    smoke: namedChildren(asset, "Smoke_"),
    starePupils: namedChildren(asset, "GodzillaStarePupil_"),
    nodHead: asset.getObjectByName("NodHead"),
    nodBeard: asset.getObjectByName("NodBeard"),
    cat: asset.getObjectByName("DJCat"),
    gorilla: asset.getObjectByName("Gorilla"),
    godzilla: asset.getObjectByName("Godzilla"),
    reactor: asset.getObjectByName("ReactorCore"),
    morty: asset.getObjectByName("Morty"),
    mortyArm: asset.getObjectByName("MortyPointArm"),
    rick: asset.getObjectByName("Rick"),
    brain: asset.getObjectByName("Brain"),
    plane: asset.getObjectByName("PlaneRig"),
    propeller: asset.getObjectByName("Propeller"),
    excavatorArm: asset.getObjectByName("ExcavatorArm"),
    excavatorUpper: asset.getObjectByName("ExcavatorUpper"),
  };

  Object.values(actors).forEach((entry) => {
    if (Array.isArray(entry)) entry.forEach((object) => rememberTransform(object));
    else rememberTransform(entry);
  });
  return actors;
}

function fitAsset(asset: THREE.Object3D, hero: boolean, variant: DioramaVariant) {
  asset.updateMatrixWorld(true);
  const initial = new THREE.Box3().setFromObject(asset);
  const size = initial.getSize(new THREE.Vector3());
  const targetWidth = variant === "demo" ? 6.3 : hero ? 8.25 : 7.8;
  const targetHeight = variant === "demo" ? 5.2 : hero ? 5.15 : 4.95;
  const scale = Math.min(targetWidth / Math.max(size.x, 0.01), targetHeight / Math.max(size.y, 0.01));
  asset.scale.setScalar(scale);
  asset.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(asset);
  const center = fitted.getCenter(new THREE.Vector3());
  if (variant === "demo") {
    const pivot = asset.getObjectByName("ExcavatorUpper");
    const pivotPosition = pivot?.getWorldPosition(new THREE.Vector3()) ?? center;
    asset.position.set(-pivotPosition.x, -center.y - 0.15, -pivotPosition.z);
  } else {
    asset.position.set(-center.x, -center.y - 0.05, -center.z);
  }
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const surfaces = Array.isArray(object.material) ? object.material : [object.material];
    surfaces.forEach((surface) => {
      Object.values(surface).forEach((value) => {
        if (value instanceof THREE.Texture) value.dispose();
      });
      surface.dispose();
    });
  });
}

export function MemeDiorama({
  variant,
  accent,
  ariaLabel,
  motion = 0,
  speed = 118,
  hero = false,
  orbitable = true,
  onAction,
  onDragStart,
  onNodDirection,
}: MemeDioramaProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef(onAction);
  const dragStartRef = useRef(onDragStart);
  const nodDirectionRef = useRef(onNodDirection);
  const stateRef = useRef({ motion, speed });
  const labelRef = useRef(ariaLabel);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading", progress: 0 });

  useEffect(() => { actionRef.current = onAction; }, [onAction]);
  useEffect(() => { dragStartRef.current = onDragStart; }, [onDragStart]);
  useEffect(() => { nodDirectionRef.current = onNodDirection; }, [onNodDirection]);
  useEffect(() => { stateRef.current = { motion, speed }; }, [motion, speed]);
  useEffect(() => {
    labelRef.current = ariaLabel;
    mountRef.current?.querySelector("canvas")?.setAttribute("aria-label", ariaLabel);
  }, [ariaLabel]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    setLoadState({ status: "loading", progress: 0 });

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      setLoadState({ status: "error", progress: 0 });
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.domElement.className = `diorama-canvas${variant === "nod" ? " is-directional" : orbitable ? "" : " is-click-only"}`;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("role", variant === "nod" ? "application" : "button");
    renderer.domElement.setAttribute("aria-label", labelRef.current);
    mount.appendChild(renderer.domElement);

    const background = BACKGROUNDS[variant];
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(background);
    scene.fog = new THREE.FogExp2(background, 0.026);
    const camera = new THREE.PerspectiveCamera(hero ? 34 : 38, 1, 0.1, 100);
    const cameraDistance = variant === "demo" ? 9.5 : hero ? 9.2 : 8.65;
    camera.position.set(0, variant === "nod" ? 0.3 : 0.1, cameraDistance);
    camera.lookAt(0, variant === "nod" ? 0.05 : 0, 0);

    scene.add(new THREE.HemisphereLight(0xfff4df, 0x08080d, 0.92));
    const key = new THREE.DirectionalLight(0xfff6e7, 3.6);
    key.position.set(-4.2, 6.5, 6.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    scene.add(key);
    const rim = new THREE.PointLight(new THREE.Color(accent), 39, 15, 1.7);
    rim.position.set(4.2, 2.3, 4.5);
    scene.add(rim);
    const fill = new THREE.PointLight(0x7448ff, 19, 13, 1.8);
    fill.position.set(-4.5, -1.4, 4.2);
    scene.add(fill);

    const orbitRoot = new THREE.Group();
    scene.add(orbitRoot);
    const modelRoot = new THREE.Group();
    orbitRoot.add(modelRoot);
    const loader = new GLTFLoader();
    let actors: SceneActors | null = null;
    let asset: THREE.Object3D | null = null;
    let disposed = false;
    let visible = true;
    let frame = 0;
    let targetX = hero ? -0.05 : -0.08;
    let targetY = hero ? -0.24 : -0.12;
    let currentX = targetX;
    let currentY = targetY;
    let dragging = false;
    let dragged = false;
    let lastX = 0;
    let lastY = 0;
    let impact = 0;
    let scratchVelocity = 0;
    const nodTarget = { x: 0, y: 0, direction: "center" as NodDirection };
    let previousMotion = stateRef.current.motion;
    let demoSpinAngle = 0;
    const timer = new THREE.Timer();
    timer.connect(document);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    loader.load(
      SCENE_URLS[variant],
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        asset = gltf.scene;
        asset.name = `${variant}-blender-diorama`;
        asset.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = true;
          object.receiveShadow = true;
          const surfaces = Array.isArray(object.material) ? object.material : [object.material];
          surfaces.forEach((surface) => {
            if (surface instanceof THREE.MeshStandardMaterial) {
              surface.flatShading = true;
              surface.needsUpdate = true;
            }
          });
        });
        fitAsset(asset, hero, variant);
        modelRoot.add(asset);
        actors = collectActors(asset);
        setLoadState({ status: "ready", progress: 100 });
      },
      (event) => {
        if (!event.total || disposed) return;
        setLoadState({ status: "loading", progress: Math.min(99, Math.round((event.loaded / event.total) * 100)) });
      },
      () => {
        if (!disposed) setLoadState({ status: "error", progress: 0 });
      },
    );

    function resize() {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.position.z = variant === "demo"
        ? width < 560 ? 11.2 : 9.5
        : width < 560 ? (hero ? 10.8 : 10.1) : (hero ? 9.2 : 8.65);
      camera.position.y = variant === "nod" ? (width < 560 ? 0.45 : 0.3) : 0.1;
      camera.lookAt(0, variant === "nod" ? 0.05 : 0, 0);
      camera.updateProjectionMatrix();
    }

    function activate() {
      if (variant === "nod") return;
      impact = 1;
      actionRef.current?.();
    }

    function updateNod(clientX: number, clientY: number) {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = THREE.MathUtils.clamp(((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1, -1, 1);
      const y = THREE.MathUtils.clamp(((clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1, -1, 1);
      nodTarget.x = x;
      nodTarget.y = y;
      const direction: NodDirection = Math.hypot(x, y) < 0.22
        ? "center"
        : Math.abs(y) >= Math.abs(x)
          ? y < 0 ? "up" : "down"
          : x < 0 ? "right" : "left";
      if (direction !== nodTarget.direction) {
        nodTarget.direction = direction;
        nodDirectionRef.current?.(direction);
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (variant === "nod") {
        updateNod(event.clientX, event.clientY);
        renderer.domElement.setPointerCapture(event.pointerId);
        return;
      }
      dragging = true;
      dragged = false;
      lastX = event.clientX;
      lastY = event.clientY;
      if (orbitable) dragStartRef.current?.();
      renderer.domElement.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent) {
      if (variant === "nod") {
        updateNod(event.clientX, event.clientY);
        return;
      }
      if (!dragging || !orbitable) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
      targetY += dx * 0.006;
      targetX = THREE.MathUtils.clamp(targetX + dy * 0.0045, -0.48, 0.48);
      scratchVelocity += dx * 0.014;
      lastX = event.clientX;
      lastY = event.clientY;
    }

    function onPointerUp(event: PointerEvent) {
      if (variant === "nod") {
        if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
        return;
      }
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      if (!dragged) activate();
    }

    function onPointerCancel(event: PointerEvent) {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (variant === "nod" && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        const point = event.key === "ArrowUp" ? [0, -1]
          : event.key === "ArrowDown" ? [0, 1]
            : event.key === "ArrowLeft" ? [-1, 0]
              : [1, 0];
        const rect = renderer.domElement.getBoundingClientRect();
        updateNod(rect.left + ((point[0] + 1) / 2) * rect.width, rect.top + ((point[1] + 1) / 2) * rect.height);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
      if (orbitable && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        targetY += event.key === "ArrowLeft" ? -0.22 : 0.22;
      }
    }

    function animateScratch(elapsed: number, delta: number, live: { motion: number; speed: number }) {
      if (!actors) return;
      actors.platters.forEach((platter) => {
        platter.rotation.y += live.motion ? delta * (2.4 + live.speed / 32) + scratchVelocity : scratchVelocity;
      });
      actors.bars.forEach((bar, index) => {
        const base = baseScale(bar);
        bar.scale.y = base.y * (0.35 + Math.abs(Math.sin(elapsed * (2.3 + live.speed / 85) + index * 0.61)) * (live.motion ? 1.5 : 0.18));
      });
      if (actors.cat) {
        const base = baseRotation(actors.cat);
        actors.cat.rotation.z = base.z + Math.sin(elapsed * (live.motion ? 3.1 : 0.8)) * (live.motion ? 0.065 : 0.014);
      }
    }

    function animateActors(elapsed: number, delta: number) {
      if (!actors) return;
      const live = stateRef.current;
      if (variant === "nod") {
        if (actors.nodHead) {
          const base = baseRotation(actors.nodHead);
          const amount = reducedMotion ? 1 : 0.12;
          actors.nodHead.rotation.x = THREE.MathUtils.lerp(actors.nodHead.rotation.x, base.x + nodTarget.y * 0.34, amount);
          actors.nodHead.rotation.y = THREE.MathUtils.lerp(actors.nodHead.rotation.y, base.y + nodTarget.x * 0.46, amount);
          actors.nodHead.rotation.z = THREE.MathUtils.lerp(actors.nodHead.rotation.z, base.z - nodTarget.x * 0.07, amount);
        }
        actors.nodPupils.forEach((eye) => {
          const base = basePosition(eye);
          eye.position.x = base.x + nodTarget.x * 0.04;
          eye.position.y = base.y - nodTarget.y * 0.035;
        });
        if (actors.nodBeard) {
          const base = baseRotation(actors.nodBeard);
          actors.nodBeard.rotation.x = base.x + nodTarget.y * 0.045;
          actors.nodBeard.rotation.z = base.z - nodTarget.x * 0.04;
        }
        actors.nodArrows.forEach((arrow, index) => {
          const direction = arrow.name.replace("NodArrow_", "") as NodDirection;
          const selected = direction === nodTarget.direction;
          const pulse = selected && !reducedMotion ? 1.08 + Math.sin(elapsed * 6 + index) * 0.07 : selected ? 1.1 : 0.86;
          const base = baseScale(arrow);
          arrow.scale.set(base.x * pulse, base.y * pulse, base.z * pulse);
        });
        rim.intensity = 34 + (nodTarget.direction === "center" ? 0 : 10);
      }
      if (reducedMotion) return;
      if (variant === "scratch") animateScratch(elapsed, delta, live);
      if (variant === "reactor") {
        const power = Math.min(live.motion, 3);
        if (actors.gorilla) {
          const base = basePosition(actors.gorilla);
          actors.gorilla.position.x = base.x - power * 0.035 - impact * 0.08;
          actors.gorilla.rotation.z = baseRotation(actors.gorilla).z - Math.sin(elapsed * 0.75) * (0.006 + power * 0.008) - impact * 0.035;
        }
        if (actors.godzilla) {
          const base = basePosition(actors.godzilla);
          actors.godzilla.position.x = base.x - power * 0.06 - impact * 0.13;
          actors.godzilla.rotation.z = baseRotation(actors.godzilla).z + Math.sin(elapsed * (0.65 + power * 0.08)) * (0.008 + power * 0.01) + impact * 0.04;
        }
        actors.starePupils.forEach((pupil, index) => {
          const base = basePosition(pupil);
          pupil.position.x = base.x - Math.abs(Math.sin(elapsed * 0.8 + index * 0.5)) * (0.018 + power * 0.015);
          pupil.position.y = base.y - impact * 0.025;
        });
        rim.intensity = 34 + power * 5 + impact * 8;
      }
      if (variant === "brain") {
        actors.portalRings.forEach((ring, index) => {
          ring.rotation.z = baseRotation(ring).z + elapsed * (index % 2 ? -0.12 : 0.09);
        });
        actors.pills.forEach((pill, index) => {
          const base = basePosition(pill);
          pill.position.y = base.y + Math.sin(elapsed * 1.4 + index * 0.63) * 0.12 - (impact > 0.08 && index === live.motion % Math.max(actors.pills.length, 1) ? (1 - impact) * 2.6 : 0);
          pill.rotation.x = baseRotation(pill).x + elapsed * (0.35 + index * 0.018);
          pill.rotation.z = baseRotation(pill).z + elapsed * 0.28;
        });
        if (actors.brain) actors.brain.rotation.y = baseRotation(actors.brain).y + elapsed * 0.32;
        if (actors.mortyArm) actors.mortyArm.rotation.z = baseRotation(actors.mortyArm).z + Math.sin(elapsed * 1.4) * 0.05 + impact * 0.24;
        if (actors.rick) actors.rick.rotation.z = baseRotation(actors.rick).z + Math.sin(elapsed * 0.8) * 0.012;
      }
      if (variant === "demo") {
        const panic = Math.min(live.motion, 4);
        if (actors.propeller) actors.propeller.rotation.x = baseRotation(actors.propeller).x + elapsed * (3.8 + panic * 1.4);
        if (actors.plane) {
          const base = basePosition(actors.plane);
          actors.plane.position.y = base.y + Math.sin(elapsed * (1.5 + panic * 0.25)) * (0.012 + panic * 0.008);
          actors.plane.rotation.z = baseRotation(actors.plane).z + Math.sin(elapsed * 1.3) * (0.008 + panic * 0.008);
        }
        if (actors.excavatorUpper) {
          const base = baseRotation(actors.excavatorUpper);
          demoSpinAngle += delta * (0.22 + panic * 0.18);
          actors.excavatorUpper.rotation.y = base.y + demoSpinAngle + impact * 0.18;
        }
        if (actors.excavatorArm) {
          const base = baseRotation(actors.excavatorArm);
          actors.excavatorArm.rotation.z = base.z + Math.sin(elapsed * 1.05) * (0.018 + panic * 0.008);
        }
      }
    }

    function animate(timestamp?: number) {
      frame = requestAnimationFrame(animate);
      timer.update(timestamp);
      if (!visible) return;
      const elapsed = timer.getElapsed();
      const delta = Math.min(timer.getDelta(), 0.05);
      const live = stateRef.current;
      if (live.motion !== previousMotion) {
        previousMotion = live.motion;
        impact = 1;
      }
      currentX = THREE.MathUtils.lerp(currentX, targetX, dragging ? 0.16 : 0.06);
      currentY = THREE.MathUtils.lerp(currentY, targetY, dragging ? 0.16 : 0.06);
      impact *= 0.9;
      scratchVelocity *= 0.93;
      orbitRoot.rotation.set(
        currentX + (reducedMotion || !orbitable ? 0 : Math.sin(elapsed * 0.62) * 0.01),
        currentY,
        reducedMotion || !orbitable ? impact * 0.018 : Math.sin(elapsed * 0.48) * 0.006 + impact * 0.018,
      );
      orbitRoot.position.y = reducedMotion || !orbitable ? 0 : Math.sin(elapsed * 0.78) * 0.018;
      animateActors(elapsed, delta);
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
      if (asset) disposeObject(asset);
      timer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [accent, hero, orbitable, variant]);

  const statusText = loadState.status === "ready"
    ? "BLENDER SCENE LIVE"
    : loadState.status === "error"
      ? "RENDERED POSTER · LIVE 3D UNAVAILABLE"
      : `LOADING 3D CHARACTERS… ${loadState.progress}%`;

  return (
    <div
      className={`diorama-stage${hero ? " diorama-stage-hero" : ""} is-${loadState.status}`}
      data-variant={variant}
      data-renderer="blender-glb"
      ref={mountRef}
    >
      <Image
        className="diorama-poster"
        src={POSTER_URLS[variant]}
        alt=""
        fill
        sizes="(max-width: 1000px) 100vw, 58vw"
        aria-hidden="true"
      />
      <div className="webgl-fallback" aria-hidden="true">
        <span>{statusText}</span>
        {loadState.status === "loading" ? <i style={{ "--load-progress": `${loadState.progress}%` } as React.CSSProperties} /> : null}
      </div>
      <span className="diorama-engine" aria-hidden="true">BLENDER → GLB → LIVE</span>
      <span className="diorama-hint" aria-hidden="true">{variant === "nod" ? "MOVE AROUND HIS FACE · NO CLICK NEEDED" : orbitable ? "DRAG TO ORBIT · TAP TO ACTIVATE" : "TAP TO ACTIVATE"}</span>
    </div>
  );
}
