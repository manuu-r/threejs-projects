import * as THREE from 'three';
import { LoadingScreen } from './ui/LoadingScreen';
import { Hud } from './ui/Hud';
import { Renderer } from './render/Renderer';
import { ChaseCamera } from './render/ChaseCamera';
import { Clock } from './core/clock';
import { PhysicsWorld } from './core/physicsWorld';
import { Controls } from './input/InputIntent';
import { Bike } from './game/Bike';
import { RespawnMonitor } from './game/Respawn';
import { TrackData } from './track/TrackData';
import { buildTrackPhysics } from './track/TrackPhysics';
import { loadTrackVisuals } from './track/TrackVisuals';
import { Checkpoints } from './track/Checkpoints';
import { LapTimer } from './timing/LapTimer';
import { BestLapStore } from './timing/BestLapStore';
import { ENGINE, PHYSICS, RESPAWN } from './config';

/**
 * Bootstrap: loading screen -> physics init -> circuit build -> game loop.
 * Fixed-step: input -> bike forces -> physics step -> telemetry -> timing.
 */

const PARAMS = new URLSearchParams(location.search);
/** Dev-only autopilot (`?autodrive`): pure-pursuit laps for headless verification. */
const AUTO = PARAMS.has('autodrive');
/** `?autodrive&steertest`: straight, then hold full-right — verifies turn handedness. */
const STEER_TEST = PARAMS.has('steertest');
const AUTO_STEPS_PER_FRAME = 200; // 3.33 s of sim per frame
const AUTO_SIM_LIMIT_SEC = 420;

async function main(): Promise<void> {
  const loading = new LoadingScreen();
  loading.setText('Initializing physics…');

  const container = document.getElementById('app')!;
  const renderer3d = new Renderer(container);
  const clock = new Clock();
  const world = await PhysicsWorld.create();

  loading.setText('Loading circuit…');
  const track = await TrackData.load();
  buildTrackPhysics(world, track);
  await loadTrackVisuals(renderer3d.scene);

  const controls = new Controls();
  const spawn = track.spawnPose();
  const bike = new Bike(world, { x: spawn.x, y: spawn.y, z: spawn.z }, spawn.yaw);
  renderer3d.scene.add(bike.root);

  const chase = new ChaseCamera(renderer3d.camera);
  bike.syncVisuals();
  chase.snap(bike.root.position); // no first-frame camera lerp across the map

  // --- timing / rules ---------------------------------------------------------
  const bestLapStore = new BestLapStore();
  let bestMs = bestLapStore.load();
  const lapTimer = new LapTimer();
  const checkpoints = new Checkpoints(track);
  const respawnMonitor = new RespawnMonitor();
  const hud = new Hud(track, bestMs);

  const intent = controls.intent;

  let paused = false;
  let simTimeSec = 0;
  let lastDriveAngle = 0; // autodrive steering angle, for the progress log
  let lapWasValid = true; // for transition-only invalid logging
  let stuckSec = 0; // autodrive: low-speed timer triggering a reverse unstick
  let unstickUntil = 0; // simTime while the unstick reverse is active
  let steerLogNext = 0; // steertest: next simTime to log heading
  const bikePos = new THREE.Vector3();
  const bikeFwd = new THREE.Vector3();

  // Autopilot corner-speed plan: per-sample target speed from local curvature
  // (v = sqrt(aLat / curvature)), capped to the straight-line pace.
  const AUTO_VMAX = 52; // m/s ≈ 187 km/h
  const AUTO_ALAT = 8.5; // m/s² cornering trust
  const speedTarget: number[] = [];
  {
    const k = 6; // half-window: ±24 m of centerline
    for (let i = 0; i < track.count; i++) {
      const a = track.samples[(i - k + track.count) % track.count]!.t;
      const b = track.samples[(i + k) % track.count]!.t;
      const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[2] * b[2]));
      const curv = Math.acos(dot) / (2 * k * track.spacing);
      speedTarget.push(Math.min(AUTO_VMAX, Math.sqrt(AUTO_ALAT / Math.max(curv, 1e-4))));
    }
  }

  function fixedStep(dt: number): void {
    if (paused) return;
    simTimeSec += dt;

    controls.update(dt);
    if (AUTO) autodrive();
    bike.prePhysicsUpdate(dt, intent);
    world.step(dt);
    bike.postPhysicsUpdate();
    // Keep the respawn anchor current even when rAF never fires (headless AUTO):
    // onFrame-only updates made doRespawn() aim seconds-stale positions.
    bikePos.copy(bike.root.position);

    // Timing & anti-cheat (root.position is at most one frame stale — gates
    // are ~427 m apart, so this is far inside tolerance).
    const ev = checkpoints.update(bike.root.position.x, bike.root.position.z);
    if (ev.lapStarted) {
      lapTimer.start(simTimeSec);
      if (AUTO) console.log(`[lap] started @${simTimeSec.toFixed(2)}s`);
    }
    if (!checkpoints.valid && lapTimer.running) {
      lapTimer.invalidateCurrent();
      if (AUTO && lapWasValid) console.log(`[lap] invalidated @${simTimeSec.toFixed(2)}s`);
    }
    lapWasValid = checkpoints.valid;
    if (ev.lapCompleted) {
      const ms = lapTimer.completeLap(simTimeSec);
      if (AUTO) console.log(`[lap] completed ${ms}ms @${simTimeSec.toFixed(2)}s`);
      if (ms !== null && (bestMs === null || ms < bestMs)) {
        bestMs = ms;
        bestLapStore.save(ms);
        if (AUTO) console.log(`[lap] best saved ${ms}ms (localStorage: ${bestLapStore.load()})`);
      }
    }

    // Auto-respawn watchdog.
    const nearest = checkpoints.nearestIndex;
    const sample = nearest >= 0 ? track.samples[nearest]! : null;
    const px = bike.root.position.x;
    const pz = bike.root.position.z;
    const lateralAbs = sample ? Math.abs(checkpoints.lateralOffset(px, pz)) : 0;
    const uprightDot = Math.cos((bike.telemetry.leanDeg * Math.PI) / 180);
    let needsRespawn = false;
    if (!STEER_TEST) needsRespawn = respawnMonitor.update(dt, simTimeSec, {      y: bike.root.position.y,
      uprightDot,
      lateralAbs,
      lateralLimit: (sample ? sample.bl : 0) + RESPAWN.offTrackLateralMargin,
    });
    if (needsRespawn) {
      if (AUTO) console.log(`[lap] auto-respawn @${simTimeSec.toFixed(2)}s`);
      doRespawn(false);
    }
  }

  if (AUTO) {
    // Headless virtual time fast-forwards TIMERS, not rAF (which fires only a
    // handful of times), so the autopilot drives the sim from a timer chain.
    const autoTick = (): void => {
      if (simTimeSec >= AUTO_SIM_LIMIT_SEC) {
        console.log(`[auto] done t=${simTimeSec.toFixed(1)}s`);
        return;
      }
      const lastLog = Math.floor(simTimeSec / 10);
      for (let k = 0; k < AUTO_STEPS_PER_FRAME; k++) fixedStep(1 / PHYSICS.fixedHz);
      if (Math.floor(simTimeSec / 10) !== lastLog) {
        console.log(
          `[auto] t=${simTimeSec.toFixed(1)}s speed=${bike.telemetry.speedKph.toFixed(0)}km/h ` +
          `gear=${bike.telemetry.gear} nearest=${checkpoints.nearestIndex} ` +
          `ang=${((lastDriveAngle * 180) / Math.PI).toFixed(0)}deg valid=${checkpoints.valid}`,
        );
      }
      bike.syncVisuals();
      hud.update(
        {
          speedKph: bike.telemetry.speedKph,
          gear: bike.telemetry.gear,
          rpm01: bike.telemetry.rpm / ENGINE.maxRpm,
          leanDeg: bike.telemetry.leanDeg,
          currentMs: lapTimer.currentMs(simTimeSec),
          lastLapMs: lapTimer.lastLapMs,
          bestMs,
          lapValid: checkpoints.valid,
          bikePos,
        },
        performance.now(),
      );
      setTimeout(autoTick, 0);
    };
    setTimeout(autoTick, 0);
  } else {
    clock.onFixedStep = fixedStep;
  }

  /** Pure-pursuit + curvature speed plan along the centerline (verification only). */
  function autodrive(): void {
    // Handedness probe: cruise straight, then hold full-right steering. A right
    // turn must increase heading yaw (atan2(fwd.x, fwd.z)); if it decreases,
    // the steering axis sign is inverted.
    if (STEER_TEST) {
      intent.throttle = 0.5;
      intent.brake = 0;
      intent.steer = simTimeSec < 2.5 ? 0 : 1;
      bike.getForwardInto(bikeFwd);
      if (simTimeSec >= steerLogNext) {
        steerLogNext += 0.25;
        console.log(
          `[steer] t=${simTimeSec.toFixed(2)} ` +
          `yaw=${((Math.atan2(bikeFwd.x, bikeFwd.z) * 180) / Math.PI).toFixed(1)} ` +
          `x=${bike.root.position.x.toFixed(1)} z=${bike.root.position.z.toFixed(1)} ` +
          `v=${bike.telemetry.speedKph.toFixed(0)}`,
        );
      }
      return;
    }

    const i = checkpoints.nearestIndex;
    if (i < 0) return;
    const speed = bike.telemetry.speedKph / 3.6;

    // Reverse unstick: beached against a barrier at ~0 speed. Reverse briefly
    // (Bike maps brake-at-standstill to reverse), then resume. Keeps the lap
    // valid — no respawn involved.
    if (simTimeSec < unstickUntil) {
      intent.throttle = 0;
      intent.brake = 0.8;
      intent.steer = 0;
      return;
    }
    // Beached (slow, roughly on target) or facing away from the line at low
    // speed: both need the reverse unstick — pure pursuit can't recover a bike
    // that's pointing >120° off its lookahead target.
    const backwards = Math.abs(lastDriveAngle) > 2.1; // ~120°
    if ((speed < 0.6 && !backwards) || (backwards && speed < 2)) {
      stuckSec += 1 / PHYSICS.fixedHz;
      if (stuckSec > 6) {
        stuckSec = 0;
        unstickUntil = simTimeSec + 1.6;
        if (AUTO) console.log(`[auto] unstick reverse @${simTimeSec.toFixed(1)}s`);
        return;
      }
    } else {
      stuckSec = 0;
    }

    const ahead = Math.max(3, Math.round((6 + speed * 0.9) / track.spacing));
    const target = track.samples[(i + ahead) % track.count]!;
    bike.getForwardInto(bikeFwd);
    const dx = target.p[0] - bike.root.position.x;
    const dz = target.p[2] - bike.root.position.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len;
    const nz = dz / len;
    // Signed angle forward->target about +Y (positive = target to the right).
    const angle = Math.atan2(bikeFwd.z * nx - bikeFwd.x * nz, bikeFwd.x * nx + bikeFwd.z * nz);
    intent.steer = Math.max(-1, Math.min(1, angle * 2.0));
    lastDriveAngle = angle;

    // Speed plan: slowest corner within braking range, relaxed by distance.
    let vAllow = AUTO_VMAX;
    for (let d = 0; d < 90; d += 3) {
      const vt = speedTarget[(i + d) % track.count]!;
      vAllow = Math.min(vAllow, Math.sqrt(vt * vt + 2 * 7 * d * track.spacing));
    }
    if (speed < vAllow) intent.throttle = 0.9;
    else intent.throttle = 0;
    intent.brake = speed > vAllow + 2 ? 0.7 : 0;
  }

  function doRespawn(manual: boolean): void {
    const i = track.nearestSample(bikePos.x, bikePos.z, checkpoints.nearestIndex);
    const s = track.samples[i]!;
    bike.respawnAt(s.p[0], s.p[2], Math.atan2(s.t[0], s.t[2]));
    if (manual) respawnMonitor.notifyManual(simTimeSec);
    checkpoints.invalidate(); // respawns never count toward the current lap
    if (lapTimer.running) lapTimer.invalidateCurrent();
  }

  clock.onFrame = (frameDt) => {
    bike.syncVisuals();
    bikePos.copy(bike.root.position);
    bike.getForwardInto(bikeFwd);

    // Autopilot runs skip rendering — headless verification only needs the HUD DOM.
    if (!AUTO) {
      chase.update(frameDt, bikePos, bikeFwd, bike.telemetry.leanDeg, bike.telemetry.speedKph / 3.6);
      renderer3d.trackSunOn({ x: bikePos.x, y: bikePos.y, z: bikePos.z });
      renderer3d.render();
    }

    hud.update(
      {
        speedKph: bike.telemetry.speedKph,
        gear: bike.telemetry.gear,
        rpm01: bike.telemetry.rpm / ENGINE.maxRpm,
        leanDeg: bike.telemetry.leanDeg,
        currentMs: lapTimer.currentMs(simTimeSec),
        lastLapMs: lapTimer.lastLapMs,
        bestMs,
        lapValid: checkpoints.valid,
        bikePos,
      },
      performance.now(),
    );

    // Edge-triggered input handling (per rendered frame is plenty).
    const actions = controls.takeActions();
    if (actions.cameraToggle) chase.toggleMode();
    if (actions.pauseToggle) paused = !paused;
    if (actions.rebuildBike) bike.rebuild();
    if (actions.recover) doRespawn(true);
  };

  clock.start();
  loading.hide();
}

main().catch((err) => {
  console.error(err);
  showFatal(err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err));
});

/** Revive the loading overlay with a fatal message (incl. WASM stack traces). */
function showFatal(message: string): void {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.style.display = 'flex';
  const text = document.getElementById('loading-text');
  if (text) {
    text.style.whiteSpace = 'pre-wrap';
    text.style.fontSize = '13px';
    text.textContent = `Failed to load: ${message}`;
  }
}

// Errors thrown inside rAF/fixed-step callbacks never reach main()'s catch.
window.addEventListener('error', (e) => {
  const err = e.error;
  showFatal(err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  const reason: unknown = e.reason;
  showFatal(reason instanceof Error ? `${reason.message}\n\n${reason.stack ?? ''}` : String(reason));
});
