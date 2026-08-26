import * as THREE from 'three';
import { CAMERA } from '../config';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const SNAP_FWD = new THREE.Vector3(0, 0, 1);

/**
 * Speed-sensitive chase camera: pulls back and widens FOV with speed, banks
 * slightly with lean. Render-rate smoothing only (physics is fixed-step).
 */
export class ChaseCamera {
  /** true = chase rig; false = near-cockpit view. */
  mode: 'chase' | 'cockpit' = 'chase';

  private posSmoothed = new THREE.Vector3(0, 4, -10);
  private lookSmoothed = new THREE.Vector3();
  private fovCurrent = CAMERA.fovBaseDeg;
  private bankCurrent = 0;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  toggleMode(): void {
    this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
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
  update(dt: number, bikePos: THREE.Vector3, bikeFwd: THREE.Vector3, leanDeg: number, speedMps: number): void {
    const cam = this.camera;
    const kPos = 1 - Math.exp(-CAMERA.positionSmoothing * dt);
    const kLook = 1 - Math.exp(-CAMERA.lookSmoothing * dt);

    if (this.mode === 'cockpit') {
      // Sits just behind the rider's head, inheriting most of the bike's motion.
      const height = 1.15;
      this.tmpA.copy(bikeFwd).multiplyScalar(0.15);
      cam.position.set(bikePos.x + this.tmpA.x, bikePos.y + height, bikePos.z + this.tmpA.z);
      this.tmpB.copy(bikePos).addScaledVector(bikeFwd, 8);
      this.tmpB.y += 0.6;
      cam.up.copy(WORLD_UP);
      cam.lookAt(this.tmpB);
      cam.fov = CAMERA.fovBaseDeg + speedMps * 0.1;
      cam.updateProjectionMatrix();
      return;
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
}
