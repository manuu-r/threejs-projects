"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import * as THREE from "three";

export type DioramaVariant = "crossfire" | "scratch" | "reactor" | "brain" | "demo";

type MemeDioramaProps = {
  src: string;
  imageWidth: number;
  imageHeight: number;
  variant: DioramaVariant;
  accent: string;
  ariaLabel: string;
  motion?: number;
  speed?: number;
  onAction?: () => void;
  onDragStart?: () => void;
};

function standardMaterial(color: THREE.ColorRepresentation, emissive = 0) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: emissive ? color : 0x000000,
    emissiveIntensity: emissive,
    metalness: 0.18,
    roughness: 0.48,
  });
}

function addFingerGun(parent: THREE.Group, x: number, y: number, side: 1 | -1, skin: THREE.Material) {
  const hand = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.42, 0.28), skin);
  const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.84, 5, 10), skin);
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.42, 5, 10), skin);
  finger.rotation.z = Math.PI / 2;
  finger.position.x = side * 0.58;
  finger.position.y = 0.13;
  thumb.rotation.z = side * 0.7;
  thumb.position.set(side * 0.18, 0.38, 0);
  hand.add(palm, finger, thumb);
  hand.position.set(x, y, 0.62);
  hand.rotation.z = side === 1 ? 0.06 : Math.PI - 0.06;
  hand.userData.baseX = x;
  hand.userData.baseY = y;
  parent.add(hand);
  return hand;
}

function addCapsule(parent: THREE.Group, position: THREE.Vector3, rotation: THREE.Euler) {
  const capsule = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.18, 5, 12), standardMaterial(0xef334e, 0.06));
  const bottom = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.18, 5, 12), standardMaterial(0xf8f3e8));
  top.position.y = 0.13;
  bottom.position.y = -0.13;
  capsule.add(top, bottom);
  capsule.position.copy(position);
  capsule.rotation.copy(rotation);
  parent.add(capsule);
  return capsule;
}

function addAirplane(parent: THREE.Group) {
  const plane = new THREE.Group();
  const white = standardMaterial(0xf6f4e8, 0.04);
  const dark = standardMaterial(0x24262d);
  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 2.25, 8, 16), white);
  fuselage.rotation.z = Math.PI / 2;
  const wings = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.07, 1.7), white);
  wings.position.x = 0.15;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.48, 0.08), white);
  tail.position.set(-1.12, 0.28, 0);
  const windows = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.07, 0.36), dark);
  windows.position.set(0.25, 0.1, 0.14);
  plane.add(fuselage, wings, tail, windows);
  plane.position.set(1.35, 0.55, 1.05);
  plane.rotation.set(0.08, -0.14, -0.12);
  parent.add(plane);
  return plane;
}

function addExcavator(parent: THREE.Group) {
  const rig = new THREE.Group();
  const yellow = standardMaterial(0xe4a51c, 0.04);
  const dark = standardMaterial(0x292724);
  const tracks = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.34, 0.72), dark);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.68, 0.72), yellow);
  body.position.y = 0.48;
  const armPivot = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.22, 0.28), yellow);
  arm.position.x = 1.08;
  const bucket = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.56, 0.5), dark);
  bucket.position.set(2.24, -0.17, 0);
  armPivot.add(arm, bucket);
  armPivot.position.set(0.2, 0.86, 0);
  armPivot.rotation.z = 0.42;
  rig.add(tracks, body, armPivot);
  rig.position.set(-2.1, -1.3, 0.86);
  rig.userData.arm = armPivot;
  parent.add(rig);
  return rig;
}

export function MemeDiorama({
  src,
  imageWidth,
  imageHeight,
  variant,
  accent,
  ariaLabel,
  motion = 0,
  speed = 118,
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
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = "diorama-canvas";
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("role", "button");
    renderer.domElement.setAttribute("aria-label", labelRef.current);
    const fallback = mount.querySelector<HTMLElement>(".diorama-fallback");
    if (fallback) fallback.hidden = true;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 0.05, 8.3);

    scene.add(new THREE.HemisphereLight(0xfffaee, 0x24211f, 2.35));
    const key = new THREE.DirectionalLight(0xffffff, 4.2);
    key.position.set(-3, 5, 7);
    key.castShadow = true;
    scene.add(key);
    const rim = new THREE.PointLight(new THREE.Color(accent), 14, 11);
    rim.position.set(3.6, 0.8, 3.5);
    scene.add(rim);

    const root = new THREE.Group();
    scene.add(root);

    const ratio = imageWidth / imageHeight;
    const cardWidth = Math.min(5.55, 4.05 * ratio);
    const cardHeight = cardWidth / ratio;
    const texture = new THREE.TextureLoader().load(src);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const paper = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7, metalness: 0 });
    const edge = standardMaterial(0x11110f);
    const card = new THREE.Mesh(
      new THREE.BoxGeometry(cardWidth, cardHeight, 0.18, 2, 2, 1),
      [edge, edge, edge, edge, paper, edge],
    );
    card.castShadow = true;
    card.receiveShadow = true;
    root.add(card);

    const backPlate = new THREE.Mesh(
      new THREE.BoxGeometry(cardWidth + 0.38, cardHeight + 0.38, 0.08),
      standardMaterial(accent, 0.12),
    );
    backPlate.position.z = -0.17;
    backPlate.rotation.z = -0.025;
    root.add(backPlate);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 7),
      new THREE.ShadowMaterial({ color: 0x11110f, opacity: 0.22 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -cardHeight / 2 - 0.72;
    floor.position.z = 0.1;
    floor.receiveShadow = true;
    scene.add(floor);

    const sceneProps = new THREE.Group();
    root.add(sceneProps);
    const moving: THREE.Object3D[] = [];
    const accentMaterial = standardMaterial(accent, 0.35);
    let heroObject: THREE.Object3D | null = null;
    let secondaryObject: THREE.Object3D | null = null;

    if (variant === "crossfire") {
      const skin = standardMaterial(0xd5a27d);
      moving.push(
        addFingerGun(sceneProps, -cardWidth / 2 - 0.18, 1.12, 1, skin),
        addFingerGun(sceneProps, cardWidth / 2 + 0.18, 0.86, -1, skin),
        addFingerGun(sceneProps, -cardWidth / 2 - 0.12, -0.9, 1, skin),
        addFingerGun(sceneProps, cardWidth / 2 + 0.15, -1.1, -1, skin),
      );
      for (let index = 0; index < 6; index += 1) {
        const shot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), accentMaterial);
        shot.position.set((index % 2 ? 1 : -1) * (2.8 + index * 0.08), 1.3 - index * 0.52, 1.1);
        sceneProps.add(shot);
        moving.push(shot);
      }
    }

    if (variant === "scratch") {
      const platter = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, 0.12, 64), standardMaterial(0x171717, 0.05));
      disc.rotation.x = Math.PI / 2;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.045, 10, 64), accentMaterial);
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.14, 32), accentMaterial);
      label.rotation.x = Math.PI / 2;
      label.position.z = 0.08;
      platter.add(disc, ring, label);
      platter.position.set(-0.05, -cardHeight / 2 + 0.34, 0.72);
      sceneProps.add(platter);
      heroObject = platter;
      for (let index = 0; index < 11; index += 1) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.16), accentMaterial);
        bar.position.set(-2.2 + index * 0.43, cardHeight / 2 - 0.35, 0.58);
        sceneProps.add(bar);
        moving.push(bar);
      }
    }

    if (variant === "reactor") {
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 2), accentMaterial);
      core.position.set(cardWidth / 2 - 0.45, -cardHeight / 2 + 0.48, 0.85);
      sceneProps.add(core);
      heroObject = core;
      for (let index = 0; index < 3; index += 1) {
        const orbit = new THREE.Mesh(new THREE.TorusGeometry(0.86 + index * 0.2, 0.035, 8, 48), accentMaterial);
        orbit.position.copy(core.position);
        orbit.rotation.set(index * 0.75, index * 0.45, index * 0.9);
        sceneProps.add(orbit);
        moving.push(orbit);
      }
      for (let index = 0; index < 18; index += 1) {
        const particle = new THREE.Mesh(new THREE.SphereGeometry(0.035 + (index % 3) * 0.018, 8, 8), accentMaterial);
        particle.userData.angle = index * 1.91;
        particle.userData.radius = 1.3 + (index % 5) * 0.18;
        sceneProps.add(particle);
        moving.push(particle);
      }
    }

    if (variant === "brain") {
      const brain = new THREE.Group();
      const brainMaterial = standardMaterial(0xef6b8a, 0.16);
      for (let index = 0; index < 9; index += 1) {
        const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), brainMaterial);
        lobe.scale.set(1, 0.76, 0.72);
        lobe.position.set((index % 3 - 1) * 0.3, (Math.floor(index / 3) - 1) * 0.22, (index % 2) * 0.08);
        brain.add(lobe);
      }
      brain.position.set(cardWidth / 2 - 0.55, -cardHeight / 2 + 0.55, 0.84);
      sceneProps.add(brain);
      heroObject = brain;
      for (let index = 0; index < 8; index += 1) {
        const pill = addCapsule(
          sceneProps,
          new THREE.Vector3(-cardWidth / 2 + 0.25 + (index % 4) * 0.55, cardHeight / 2 + 0.3 + Math.floor(index / 4) * 0.45, 0.7),
          new THREE.Euler(0.2 * index, 0.3 * index, 0.5 * index),
        );
        pill.userData.offset = index * 0.7;
        moving.push(pill);
      }
    }

    if (variant === "demo") {
      heroObject = addAirplane(sceneProps);
      secondaryObject = addExcavator(sceneProps);
      const warning = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.1, 8, 3), accentMaterial);
      warning.position.set(cardWidth / 2 - 0.45, cardHeight / 2 - 0.5, 0.8);
      warning.rotation.z = Math.PI / 2;
      sceneProps.add(warning);
      moving.push(warning);
    }

    let targetX = -0.05;
    let targetY = -0.08;
    let currentX = targetX;
    let currentY = targetY;
    let dragging = false;
    let dragged = false;
    let lastX = 0;
    let lastY = 0;
    let impact = 0;
    let scratchVelocity = 0;
    let frame = 0;
    let visible = true;
    let previousElapsed = 0;
    const clock = new THREE.Clock();

    function resize() {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.position.z = width < 560 ? 9.4 : 8.3;
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
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
      targetY += dx * 0.006;
      targetX = THREE.MathUtils.clamp(targetX + dy * 0.0045, -0.58, 0.58);
      scratchVelocity += dx * 0.014;
      lastX = event.clientX;
      lastY = event.clientY;
    }

    function onPointerUp(event: PointerEvent) {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      if (!dragged) {
        impact = 1;
        actionRef.current?.();
      }
    }

    function onPointerCancel(event: PointerEvent) {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        impact = 1;
        actionRef.current?.();
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        targetY += event.key === "ArrowLeft" ? -0.18 : 0.18;
      }
    }

    function animate() {
      frame = requestAnimationFrame(animate);
      if (!visible) return;
      const elapsed = clock.getElapsedTime();
      const delta = Math.min(elapsed - previousElapsed, 0.05);
      previousElapsed = elapsed;
      const live = stateRef.current;
      currentX = THREE.MathUtils.lerp(currentX, targetX, dragging ? 0.16 : 0.07);
      currentY = THREE.MathUtils.lerp(currentY, targetY, dragging ? 0.16 : 0.07);
      impact *= 0.89;
      scratchVelocity *= 0.94;
      root.rotation.set(currentX + Math.sin(elapsed * 0.72) * 0.018, currentY, Math.sin(elapsed * 0.58) * 0.012 + impact * 0.045);
      root.position.y = Math.sin(elapsed * 0.9) * 0.055;
      root.position.z = impact * 0.12;

      if (variant === "crossfire") {
        moving.forEach((object, index) => {
          object.position.z = 0.62 + Math.sin(elapsed * 2.2 + index) * 0.08 + impact * (index < 4 ? 0.45 : 1.25);
          if (index >= 4) object.scale.setScalar(0.7 + impact * 3 + Math.sin(elapsed * 4 + index) * 0.2);
        });
      }

      if (variant === "scratch") {
        if (heroObject) heroObject.rotation.z += (live.motion ? live.speed / 1600 : 0) + scratchVelocity;
        moving.forEach((bar, index) => {
          bar.scale.y = 0.45 + Math.abs(Math.sin(elapsed * (2 + live.speed / 80) + index * 0.7)) * (live.motion ? 1.55 : 0.2);
        });
      }

      if (variant === "reactor") {
        const power = Math.min(live.motion, 3);
        if (heroObject) {
          heroObject.rotation.x += delta * (0.6 + power);
          heroObject.rotation.y += delta * (0.8 + power);
          heroObject.scale.setScalar(0.76 + power * 0.16 + Math.sin(elapsed * (2 + power)) * 0.06);
        }
        moving.slice(0, 3).forEach((ring, index) => { ring.rotation.z += delta * (0.4 + power * 0.45 + index * 0.18); });
        moving.slice(3).forEach((particle, index) => {
          const angle = particle.userData.angle + elapsed * (0.3 + power * 0.25);
          const radius = particle.userData.radius;
          particle.position.set(Math.cos(angle) * radius, Math.sin(angle * 1.3) * radius * 0.65, 0.75 + Math.sin(angle + index) * 0.4);
        });
        rim.intensity = 8 + power * 10 + impact * 18;
      }

      if (variant === "brain") {
        if (heroObject) {
          heroObject.rotation.y = Math.sin(elapsed) * 0.28;
          heroObject.scale.setScalar(0.72 + Math.min(live.motion, 4) * 0.09 + impact * 0.22);
        }
        moving.forEach((pill, index) => {
          pill.rotation.x += delta * (0.6 + index * 0.08);
          pill.rotation.z += delta * 0.55;
          pill.position.y += Math.sin(elapsed * 1.7 + pill.userData.offset) * 0.002;
        });
      }

      if (variant === "demo") {
        const panic = Math.min(live.motion, 4);
        if (heroObject) {
          heroObject.rotation.z = -0.12 + Math.sin(elapsed * (1.5 + panic)) * (0.035 + panic * 0.035) + impact * 0.18;
          heroObject.position.y = 0.55 + Math.sin(elapsed * 2.2) * (0.05 + panic * 0.025);
          heroObject.position.x = 1.35 + Math.sin(elapsed * 1.3) * panic * 0.04;
        }
        if (secondaryObject) {
          const arm = secondaryObject.userData.arm as THREE.Group;
          arm.rotation.z = 0.42 + Math.sin(elapsed * 1.2) * 0.05 + panic * 0.055 + impact * 0.16;
        }
        moving.forEach((object) => { object.rotation.z += delta * (0.5 + panic * 0.3); });
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
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      texture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      if (fallback) fallback.hidden = false;
    };
  }, [accent, imageHeight, imageWidth, src, variant]);

  return (
    <div className="diorama-stage" data-variant={variant} ref={mountRef}>
      <Image className="diorama-fallback" src={src} alt={ariaLabel} width={imageWidth} height={imageHeight} />
      <span className="diorama-hint" aria-hidden="true">DRAG TO ORBIT · TAP TO ACTIVATE</span>
    </div>
  );
}
