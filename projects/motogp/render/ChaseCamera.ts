import * as THREE from 'three';
import { CAMERA } from '../config';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const SNAP_FWD = new THREE.Vector3(0, 0, 1);

/**
 * Two riding views: a low rear chase shot that frames the complete bike and a
 * rider-eye view that sits just above the tank. Render-rate smoothing only
 * (physics is fixed-step).
 */
export class ChaseCamera {
  mode: 'rear' | 'rider' = 'rear';
  readonly camera: THREE.PerspectiveCamera;

  private posSmoothed = new THREE.Vector3(0, 4, -10);
  private lookSmoothed = new THREE.Vector3();
  private fovCurrent = CAMERA.fovBaseDeg;
  private bankCurrent = 0;
  private crashOrbit = 0;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  toggleMode(): void {
    this.mode = this.mode === 'rear' ? 'rider' : 'rear';
  }

  get modeLabel(): string {
    return this.mode === 'rear' ? 'REAR CHASE' : 'RIDER VIEW';
  }

  /** Jump the rig straight onto its target with no smoothing — used at spawn. */
  snap(bikePos: THREE.Vector3): void {
    // dt = 1000 s drives every smoothing factor to exactly 1.
    this.update(1000, bikePos, SNAP_FWD, 0, 0);
  }

  /**
   * @param bikePos    world position of the chassis
   * @param bikeFwd    unit forward vector (world)
   * @param leanDeg    signed lean angle, + = right
   * @param speedMps   speed in m/s
   */
  update(
    dt: number,
    bikePos: THREE.Vector3,
    bikeFwd: THREE.Vector3,
    leanDeg: number,
    speedMps: number,
    bikeUp: THREE.Vector3 = WORLD_UP,
  ): void {
    const cam = this.camera;
    const kPos = 1 - Math.exp(-CAMERA.positionSmoothing * dt);
    const kLook = 1 - Math.exp(-CAMERA.lookSmoothing * dt);

    if (this.mode === 'rider') {
      // Visor-mounted camera follows the bike's real up axis so hands, wrists,
      // tank, and horizon lean as one connected cockpit instead of floating.
      this.tmpA
        .copy(bikePos)
        .addScaledVector(bikeUp, CAMERA.riderHeight)
        .addScaledVector(bikeFwd, CAMERA.riderLongitudinalOffset);
      const riderFollow = 1 - Math.exp(-18 * dt);
      this.posSmoothed.lerp(this.tmpA, riderFollow);
      cam.position.copy(this.posSmoothed);
      this.tmpB.copy(bikePos).addScaledVector(bikeFwd, 11);
      this.tmpB.addScaledVector(bikeUp, CAMERA.riderLookVerticalOffset);
      this.lookSmoothed.lerp(this.tmpB, 1 - Math.exp(-20 * dt));
      cam.up.copy(bikeUp);
      cam.lookAt(this.lookSmoothed);
      const riderFov = Math.min(CAMERA.riderFovMaxDeg, CAMERA.riderFovBaseDeg + speedMps * 0.07);
      if (cam.near !== CAMERA.riderNear) {
        cam.near = CAMERA.riderNear;
        cam.updateProjectionMatrix();
      }
      if (Math.abs(cam.fov - riderFov) > 0.01) {
        cam.fov = riderFov;
        cam.updateProjectionMatrix();
      }
      return;
    }

    if (cam.near !== 0.5) {
      cam.near = 0.5;
      cam.updateProjectionMatrix();
    }

    const dist = CAMERA.baseDistance + CAMERA.distancePerSpeed * speedMps;
    const height = CAMERA.baseHeight + CAMERA.heightPerSpeed * speedMps;

    // Desired position: behind on the horizontalized forward axis.
    this.tmpA.set(bikeFwd.x, 0, bikeFwd.z);
    if (this.tmpA.lengthSq() < 1e-4) this.tmpA.set(0, 0, 1);
    this.tmpA.normalize().multiplyScalar(-dist);
    const desiredX = bikePos.x + this.tmpA.x;
    const desiredZ = bikePos.z + this.tmpA.z;

    this.posSmoothed.x += (desiredX - this.posSmoothed.x) * kPos;
    this.posSmoothed.y += (bikePos.y + height - this.posSmoothed.y) * kPos;
    this.posSmoothed.z += (desiredZ - this.posSmoothed.z) * kPos;
    cam.position.copy(this.posSmoothed);

    // Look at a point ahead of the bike.
    this.tmpB.copy(bikePos).addScaledVector(bikeFwd, CAMERA.lookAheadBase + CAMERA.lookAheadPerSpeed * speedMps);
    this.tmpB.y += 0.6;
    this.lookSmoothed.lerp(this.tmpB, kLook);

    // Bank with lean (max ~8°), smoothed.
    const bankTarget = THREE.MathUtils.clamp(
      (leanDeg / 52) * CAMERA.maxBankDeg,
      -CAMERA.maxBankDeg,
      CAMERA.maxBankDeg,
    );
    this.bankCurrent += (bankTarget - this.bankCurrent) * kLook;
    cam.up.set(Math.sin((this.bankCurrent * Math.PI) / 180), Math.cos((this.bankCurrent * Math.PI) / 180), 0);

    cam.lookAt(this.lookSmoothed);

    const fovTarget =
      CAMERA.fovBaseDeg +
      (CAMERA.fovMaxDeg - CAMERA.fovBaseDeg) *
        THREE.MathUtils.clamp(speedMps / CAMERA.fovAtSpeedMps, 0, 1);
    this.fovCurrent += (fovTarget - this.fovCurrent) * kPos;
    if (Math.abs(cam.fov - this.fovCurrent) > 0.01) {
      cam.fov = this.fovCurrent;
      cam.updateProjectionMatrix();
    }
  }

  /** Smooth orbiting two-subject shot used only while crash physics continues. */
  updateCrash(
    dt: number,
    bikePos: THREE.Vector3,
    bikeFwd: THREE.Vector3,
    riderPos: THREE.Vector3,
    severity: number,
  ): void {
    const cam = this.camera;
    this.crashOrbit += dt * (0.28 + severity * 0.2);
    this.tmpB.copy(bikePos).lerp(riderPos, 0.48);
    const separation = Math.min(6, bikePos.distanceTo(riderPos));
    const distance = 6.5 + separation * 0.65 + severity * 2;
    this.tmpA.set(bikeFwd.x, 0, bikeFwd.z);
    if (this.tmpA.lengthSq() < 1e-4) this.tmpA.set(0, 0, 1);
    this.tmpA.normalize();
    const sideX = this.tmpA.z;
    const sideZ = -this.tmpA.x;
    this.tmpC.set(
      this.tmpB.x - this.tmpA.x * distance + sideX * Math.sin(this.crashOrbit) * 2.2,
      this.tmpB.y + 2.2 + severity * 0.8,
      this.tmpB.z - this.tmpA.z * distance + sideZ * Math.sin(this.crashOrbit) * 2.2,
    );
    this.posSmoothed.lerp(this.tmpC, 1 - Math.exp(-4.5 * dt));
    this.lookSmoothed.lerp(this.tmpB, 1 - Math.exp(-7 * dt));
    cam.position.copy(this.posSmoothed);
    cam.up.copy(WORLD_UP);
    cam.lookAt(this.lookSmoothed);
    cam.near = 0.12;
    const targetFov = 55 + severity * 5;
    this.fovCurrent += (targetFov - this.fovCurrent) * (1 - Math.exp(-5 * dt));
    cam.fov = this.fovCurrent;
    cam.updateProjectionMatrix();
  }
}
