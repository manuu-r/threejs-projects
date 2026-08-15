"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const memes = [
  { top: "ME: ONE QUICK IDEA", bottom: "THE IDEA AT 2:47 AM", icon: "◉_◉", color: "#d8ff28" },
  { top: "NO THOUGHTS", bottom: "ONLY OPEN TABS", icon: "(•‿•)", color: "#ff633b" },
  { top: "SHIP IT FRIDAY?", bottom: "ABSOLUTELY NORMAL BEHAVIOR", icon: "ಠ_ಠ", color: "#77d7ff" },
];

function createMemeTexture(meme: (typeof memes)[number]) {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1120;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);

  context.fillStyle = "#f0eadc";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = meme.color;
  context.fillRect(34, 34, canvas.width - 68, canvas.height - 68);
  context.strokeStyle = "#191713";
  context.lineWidth = 8;
  context.strokeRect(34, 34, canvas.width - 68, canvas.height - 68);

  context.fillStyle = "#191713";
  context.textAlign = "center";
  context.font = "900 58px Arial";
  context.fillText(meme.top, 450, 135);
  context.font = "900 148px Arial";
  context.fillText(meme.icon, 450, 570);
  context.font = "900 51px Arial";
  context.fillText(meme.bottom, 450, 985);

  context.font = "700 25px Courier New";
  context.textAlign = "left";
  context.fillText("INTERACTABLE MEMES®", 64, 1082);
  context.textAlign = "right";
  context.fillText("TOUCH ME", 836, 1082);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function MemeStage() {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{ remix: () => void; poke: () => void } | null>(null);
  const [status, setStatus] = useState("DRAG THE CARD. CLICK TO POKE.");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const container = mount;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0.15, 8.2);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = "stage-canvas";
    renderer.domElement.setAttribute("aria-label", "Interactive 3D meme card. Drag to rotate and click to poke.");
    renderer.domElement.setAttribute("role", "img");
    container.insertBefore(renderer.domElement, container.firstChild);

    scene.add(new THREE.HemisphereLight(0xfff7e8, 0x191713, 2.4));
    const keyLight = new THREE.DirectionalLight(0xffffff, 4.5);
    keyLight.position.set(3, 5, 6);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const card = new THREE.Group();
    card.position.set(1.8, 0.1, 0);
    scene.add(card);

    const edgeMaterial = new THREE.MeshStandardMaterial({
      color: 0x191713,
      roughness: 0.62,
      metalness: 0.08,
    });
    const geometry = new THREE.BoxGeometry(3.25, 4.05, 0.16, 12, 12, 2);
    const textures = memes.map(createMemeTexture);
    const materials = textures.map(
      (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.78, metalness: 0 }),
    );
    const mesh = new THREE.Mesh(geometry, [edgeMaterial, edgeMaterial, edgeMaterial, edgeMaterial, materials[0], edgeMaterial]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    card.add(mesh);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(5.5, 5.5),
      new THREE.ShadowMaterial({ color: 0x191713, opacity: 0.18 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(1.8, -2.45, -0.1);
    shadow.receiveShadow = true;
    scene.add(shadow);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const targetRotation = new THREE.Vector2(-0.05, -0.2);
    const currentRotation = new THREE.Vector2(-0.05, -0.2);
    let activeMeme = 0;
    let dragging = false;
    let dragged = false;
    let startX = 0;
    let startY = 0;
    let pokeVelocity = 0;
    let pokeOffset = 0;
    let animationFrame = 0;
    const clock = new THREE.Clock();

    function resize() {
      const width = container.clientWidth;
      const height = container.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      card.position.x = width < 780 ? 0.85 : 1.85;
      shadow.position.x = card.position.x;
      camera.position.z = width < 780 ? 9.2 : 8.2;
    }

    function setPointer(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function onPointerDown(event: PointerEvent) {
      dragging = true;
      dragged = false;
      startX = event.clientX;
      startY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent) {
      setPointer(event);
      if (!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 5) dragged = true;
      targetRotation.y += dx * 0.008;
      targetRotation.x += dy * 0.006;
      targetRotation.x = THREE.MathUtils.clamp(targetRotation.x, -0.75, 0.75);
      startX = event.clientX;
      startY = event.clientY;
    }

    function poke() {
      pokeVelocity += 0.16;
      setStatus("BOOP. PHYSICS WERE NECESSARY.");
      window.setTimeout(() => setStatus("DRAG THE CARD. CLICK TO POKE."), 1100);
    }

    function onPointerUp(event: PointerEvent) {
      setPointer(event);
      dragging = false;
      renderer.domElement.releasePointerCapture(event.pointerId);
      raycaster.setFromCamera(pointer, camera);
      if (!dragged && raycaster.intersectObject(mesh).length) poke();
    }

    function remix() {
      activeMeme = (activeMeme + 1) % memes.length;
      mesh.material[4] = materials[activeMeme];
      targetRotation.y += Math.PI * 2;
      pokeVelocity += 0.08;
      setStatus(`REMIX ${String(activeMeme + 1).padStart(2, "0")} / ${memes.length.toString().padStart(2, "0")}`);
    }

    apiRef.current = { remix, poke };

    function animate() {
      const elapsed = clock.getElapsedTime();
      currentRotation.lerp(targetRotation, dragging ? 0.18 : 0.08);
      pokeVelocity += -pokeOffset * 0.085;
      pokeVelocity *= 0.9;
      pokeOffset += pokeVelocity;
      card.rotation.set(
        currentRotation.x + Math.sin(elapsed * 0.8) * 0.025,
        currentRotation.y + Math.sin(elapsed * 0.55) * 0.045,
        Math.sin(elapsed * 0.7) * 0.018 + pokeOffset * 0.12,
      );
      card.position.y = 0.12 + Math.sin(elapsed * 1.1) * 0.1;
      card.scale.setScalar(1 + Math.abs(pokeOffset) * 0.02);
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    animate();

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    return () => {
      apiRef.current = null;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      geometry.dispose();
      edgeMaterial.dispose();
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="stage-shell" ref={mountRef}>
      <p className="status-pill" aria-live="polite">{status}</p>
      <div className="meme-controls">
        <button type="button" onClick={() => apiRef.current?.poke()}>POKE IT</button>
        <button className="primary-control" type="button" onClick={() => apiRef.current?.remix()}>
          REMIX MEME ↻
        </button>
      </div>
    </div>
  );
}
