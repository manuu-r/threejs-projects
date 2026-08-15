"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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

type LoadState = {
  status: "loading" | "ready" | "error";
  progress: number;
};

type SceneActors = {
  hands: THREE.Object3D[];
  platters: THREE.Object3D[];
  bars: THREE.Object3D[];
  pills: THREE.Object3D[];
  portalRings: THREE.Object3D[];
  smoke: THREE.Object3D[];
  officeHero?: THREE.Object3D;
  cat?: THREE.Object3D;
  gorilla?: THREE.Object3D;
  trex?: THREE.Object3D;
  reactor?: THREE.Object3D;
  morty?: THREE.Object3D;
  mortyArm?: THREE.Object3D;
  rick?: THREE.Object3D;
  brain?: THREE.Object3D;
  plane?: THREE.Object3D;
  propeller?: THREE.Object3D;
  excavatorArm?: THREE.Object3D;
};

const SCENE_URLS: Record<DioramaVariant, string> = {
  crossfire: "/interactable-memes/studio-models/crossfire.glb",
  scratch: "/interactable-memes/studio-models/scratch.glb",
  reactor: "/interactable-memes/studio-models/reactor.glb",
  brain: "/interactable-memes/studio-models/brain.glb",
  demo: "/interactable-memes/studio-models/demo.glb",
};

const POSTER_URLS: Record<DioramaVariant, string> = {
  crossfire: "/interactable-memes/studio-previews/crossfire.png",
  scratch: "/interactable-memes/studio-previews/scratch.png",
  reactor: "/interactable-memes/studio-previews/reactor.png",
  brain: "/interactable-memes/studio-previews/brain.png",
  demo: "/interactable-memes/studio-previews/demo.png",
};

const BACKGROUNDS: Record<DioramaVariant, number> = {
  crossfire: 0x080909,
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
    hands: namedChildren(asset, "FingerGun_").filter((object) => /^FingerGun_\d+$/.test(object.name)),
    platters: [asset.getObjectByName("Platter_L"), asset.getObjectByName("Platter_R")].filter(Boolean) as THREE.Object3D[],
    bars: namedChildren(asset, "EQ_"),
    pills: namedChildren(asset, "Pill_").filter((object) => /^Pill_\d+$/.test(object.name)),
    portalRings: namedChildren(asset, "PortalRing_"),
    smoke: namedChildren(asset, "Smoke_"),
    officeHero: asset.getObjectByName("OfficeHero"),
    cat: asset.getObjectByName("DJCat"),
    gorilla: asset.getObjectByName("Gorilla"),
    trex: asset.getObjectByName("Trex"),
    reactor: asset.getObjectByName("ReactorCore"),
    morty: asset.getObjectByName("Morty"),
    mortyArm: asset.getObjectByName("MortyPointArm"),
    rick: asset.getObjectByName("Rick"),
    brain: asset.getObjectByName("Brain"),
    plane: asset.getObjectByName("PlaneRig"),
    propeller: asset.getObjectByName("Propeller"),
    excavatorArm: asset.getObjectByName("ExcavatorArm"),
  };

  Object.values(actors).forEach((entry) => {
    if (Array.isArray(entry)) entry.forEach((object) => rememberTransform(object));
    else rememberTransform(entry);
  });
  return actors;
}

function fitAsset(asset: THREE.Object3D, hero: boolean) {
  asset.updateMatrixWorld(true);
  const initial = new THREE.Box3().setFromObject(asset);
  const size = initial.getSize(new THREE.Vector3());
  const targetWidth = hero ? 8.25 : 7.8;
  const targetHeight = hero ? 5.15 : 4.95;
  const scale = Math.min(targetWidth / Math.max(size.x, 0.01), targetHeight / Math.max(size.y, 0.01));
  asset.scale.setScalar(scale);
  asset.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(asset);
  const center = fitted.getCenter(new THREE.Vector3());
  asset.position.set(-center.x, -center.y - 0.05, -center.z);
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
  onAction,
  onDragStart,
}: MemeDioramaProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef(onAction);
  const dragStartRef = useRef(onDragStart);
  const stateRef = useRef({ motion, speed });
  const labelRef = useRef(ariaLabel);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading", progress: 0 });

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
    renderer.toneMappingExposure = 1.12;
    renderer.domElement.className = "diorama-canvas";
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("role", "button");
    renderer.domElement.setAttribute("aria-label", labelRef.current);
    mount.appendChild(renderer.domElement);

    const background = BACKGROUNDS[variant];
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(background);
    scene.fog = new THREE.FogExp2(background, 0.055);
    const camera = new THREE.PerspectiveCamera(hero ? 34 : 38, 1, 0.1, 100);
    camera.position.set(0, 0.1, hero ? 9.2 : 8.65);

    scene.add(new THREE.HemisphereLight(0xfff4df, 0x10101a, 2.3));
    const key = new THREE.DirectionalLight(0xfff6e7, 5.5);
    key.position.set(-4.2, 6.5, 6.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    scene.add(key);
    const rim = new THREE.PointLight(new THREE.Color(accent), 54, 15, 1.7);
    rim.position.set(4.2, 2.3, 4.5);
    scene.add(rim);
    const fill = new THREE.PointLight(0x7448ff, 32, 13, 1.8);
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
    let previousMotion = stateRef.current.motion;
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
        fitAsset(asset, hero);
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
      camera.position.z = width < 560 ? (hero ? 10.8 : 10.1) : (hero ? 9.2 : 8.65);
      camera.updateProjectionMatrix();
    }

    function activate() {
      impact = 1;
      actionRef.current?.();
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
      if (!dragging) return;
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
      if (!actors || reducedMotion) return;
      const live = stateRef.current;
      if (variant === "crossfire") {
        actors.hands.forEach((hand, index) => {
          const base = basePosition(hand);
          hand.position.z = base.z + Math.sin(elapsed * 1.7 + index) * 0.045 + impact * 0.32;
          hand.rotation.y = baseRotation(hand).y + Math.sin(elapsed * 0.8 + index) * 0.04;
        });
        if (actors.officeHero) actors.officeHero.rotation.z = baseRotation(actors.officeHero).z + Math.sin(elapsed * 1.1) * 0.012 - impact * 0.045;
      }
      if (variant === "scratch") animateScratch(elapsed, delta, live);
      if (variant === "reactor") {
        const power = Math.min(live.motion, 3);
        if (actors.reactor) {
          actors.reactor.rotation.y += delta * (0.65 + power * 0.5);
          const base = baseScale(actors.reactor);
          const pulse = 1 + power * 0.06 + Math.sin(elapsed * (2.2 + power)) * 0.04 + impact * 0.08;
          actors.reactor.scale.set(base.x * pulse, base.y * pulse, base.z * pulse);
        }
        if (actors.gorilla) actors.gorilla.rotation.z = baseRotation(actors.gorilla).z + Math.sin(elapsed * (1.1 + power * 0.4)) * (0.012 + power * 0.014);
        if (actors.trex) actors.trex.rotation.z = baseRotation(actors.trex).z + Math.sin(elapsed * 1.35) * 0.018 - impact * 0.055;
        actors.smoke.forEach((puff, index) => {
          puff.position.y = basePosition(puff).y + Math.sin(elapsed * 0.9 + index * 0.7) * 0.07;
        });
        rim.intensity = 40 + power * 12 + impact * 18;
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
          actors.plane.position.y = base.y + Math.sin(elapsed * (1.5 + panic * 0.25)) * (0.025 + panic * 0.018);
          actors.plane.rotation.z = baseRotation(actors.plane).z + Math.sin(elapsed * 1.3) * (0.018 + panic * 0.018) + impact * 0.08;
        }
        if (actors.excavatorArm) actors.excavatorArm.rotation.z = baseRotation(actors.excavatorArm).z + Math.sin(elapsed * 1.05) * 0.014 + panic * 0.008 + impact * 0.04;
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
        currentX + (reducedMotion ? 0 : Math.sin(elapsed * 0.62) * 0.01),
        currentY,
        reducedMotion ? 0 : Math.sin(elapsed * 0.48) * 0.006 + impact * 0.018,
      );
      orbitRoot.position.y = reducedMotion ? 0 : Math.sin(elapsed * 0.78) * 0.018;
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
  }, [accent, hero, variant]);

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
      <span className="diorama-hint" aria-hidden="true">DRAG TO ORBIT · TAP TO ACTIVATE</span>
    </div>
  );
}
