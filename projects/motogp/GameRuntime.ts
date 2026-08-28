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
import {
  buildTrackPhysics,
  loadAsphaltCollision,
  nearestAsphaltPoint,
  queryAsphaltSurface,
  queryPlayableSurface,
} from './track/TrackPhysics';
import { loadTrackVisuals } from './track/TrackVisuals';
import { createTrackAtmosphere } from './track/TrackAtmosphere';
import { createTrackSurfaceDetails } from './track/TrackSurfaceDetails';
import { Checkpoints } from './track/Checkpoints';
import { LapTimer } from './timing/LapTimer';
import { BestLapStore } from './timing/BestLapStore';
import { ENGINE, PHYSICS } from './config';
import { EngineSound } from './audio/EngineSound';
import { CinematicSlowMotion } from './game/CinematicSlowMotion';
import { SpeedEffects } from './render/SpeedEffects';

/**
 * Bootstrap: loading screen -> physics init -> circuit build -> game loop.
 * Fixed-step: input -> bike forces -> physics step -> telemetry -> timing.
 */

/**
 * Starts the game within a React-owned host and returns its teardown function.
 * Keeping this runtime DOM-local lets the experiment coexist with the other
 * routes in the shared app shell rather than owning the whole document.
 */
export async function startMotoGpGame(container: HTMLElement): Promise<() => void> {
  const params = new URLSearchParams(window.location.search);
  /** Dev-only autopilot (`?autodrive`): pure-pursuit laps for headless verification. */
  const AUTO = params.has('autodrive');
  /** `?autodrive&steertest`: straight, then hold full-right — verifies turn handedness. */
  const STEER_TEST = params.has('steertest');
  /** `?autodrive&speedtest`: straight-line acceleration then closed-throttle coast. */
  const SPEED_TEST = params.has('speedtest');
  /** `?autodrive&braketest`: accelerate, then apply a full straight-line brake. */
  const BRAKE_TEST = params.has('braketest');
  /** Rendered verification keeps the real scene visible while the bot drives. */
  const AUTO_RENDER = params.has('render');
  /** Dev-only pit/garage grounding probe. */
  const GARAGE_TEST = params.has('garagetest');
  /** Dev-only grass/run-off grounding probe. */
  const OFFROAD_TEST = params.has('offroadtest');
  const AUTO_STEPS_PER_FRAME = AUTO_RENDER ? 1 : 200; // real-time vs headless fast-forward
  const AUTO_SIM_LIMIT_SEC = SPEED_TEST ? 24 : BRAKE_TEST ? 14 : STEER_TEST ? 8 : 420;

  container.replaceChildren();
  const loading = new LoadingScreen(container);
  loading.setText('Initializing physics…');

  const renderer3d = new Renderer(container);
  const clock = new Clock();
  const world = await PhysicsWorld.create();

  loading.setText('Loading circuit…');
  const track = await TrackData.load();
  const asphalt = await loadAsphaltCollision();
  buildTrackPhysics(world, track, asphalt);
  const trackVisuals = await loadTrackVisuals(renderer3d.scene);
  const atmosphere = createTrackAtmosphere(track);
  renderer3d.scene.add(atmosphere.root);
  const surfaceDetails = createTrackSurfaceDetails(track);
  renderer3d.scene.add(surfaceDetails.root);

  const controls = new Controls();
  const engineSound = new EngineSound();
  const slowMotion = new CinematicSlowMotion();
  const spawn = track.spawnPose();
  // Resolve the grid anchor vertically against the authored surface. The GLB
  // contains stacked terrain and tarmac, so the centerline elevation is needed
  // to choose the visible road rather than the lower terrain shell.
  const pitGrid = track.samples[track.json.startSampleIndex]!;
  const testLateral = GARAGE_TEST ? 24 : OFFROAD_TEST ? 15 : null;
  const testX = testLateral === null ? spawn.x : pitGrid.p[0] + pitGrid.n[0] * testLateral;
  const testZ = testLateral === null ? spawn.z : pitGrid.p[2] + pitGrid.n[2] * testLateral;
  const testSurface = queryPlayableSurface(asphalt, testX, pitGrid.p[1], testZ);
  const defaultSpawnRoad = nearestAsphaltPoint(asphalt, spawn.x, spawn.y, spawn.z);
  const spawnRoad = testLateral === null
    ? defaultSpawnRoad
    : { x: testX, y: testSurface.y + 0.035, z: testZ };
  const spawnYaw = testLateral === null ? spawn.yaw : Math.atan2(pitGrid.t[0], pitGrid.t[2]);
  const bike = new Bike(world, spawnRoad, spawnYaw);
  renderer3d.scene.add(bike.root);
  // Do not render the procedural fallback for a frame while the large Ducati
  // asset streams in. It remains available only if the GLB genuinely fails.
  loading.setText('Loading Ducati and rider…');
  await bike.ready;
  bike.settleSuspension();
  const speedEffects = new SpeedEffects(bike);
  renderer3d.scene.add(speedEffects.root);

  const chase = new ChaseCamera(renderer3d.camera);
  bike.syncVisuals();
  chase.snap(bike.root.position); // no first-frame camera lerp across the map
  // Deterministic visual-QA entry point; ordinary players still toggle with C.
  if (params.has('rider')) {
    chase.toggleMode();
    bike.setRiderVisible(false);
  }

  // --- timing / rules ---------------------------------------------------------
  const bestLapStore = new BestLapStore();
  let bestMs = bestLapStore.load();
  const lapTimer = new LapTimer();
  const checkpoints = new Checkpoints(track);
  const respawnMonitor = new RespawnMonitor();
  const hud = new Hud(container, track, bestMs);

  const intent = controls.intent;

  let paused = false;
  let disposed = false;
  let autoTimer: number | null = null;
  /** Scaled physics time; deliberately separate from the race clock below. */
  let simTimeSec = 0;
  /** Unscaled fixed-step time keeps lap timing correct during crash slow motion. */
  let raceTimeSec = 0;
  let pendingCrashRecovery = false;
  let lastDriveAngle = 0; // autodrive steering angle, for the progress log
  let lapWasValid = true; // for transition-only invalid logging
  let stuckSec = 0; // autodrive: low-speed timer triggering recovery
  let steerLogNext = 0; // steertest: next simTime to log heading
  const bikePos = new THREE.Vector3();
  const bikeFwd = new THREE.Vector3();
  const bikeUp = new THREE.Vector3(0, 1, 0);
  const crashRiderPos = new THREE.Vector3();
  let lastSafeRoad = OFFROAD_TEST
    ? { x: defaultSpawnRoad.x, y: defaultSpawnRoad.y, z: defaultSpawnRoad.z, yaw: spawn.yaw }
    : { x: spawnRoad.x, y: spawnRoad.y, z: spawnRoad.z, yaw: spawnYaw };
  const safeRoadHistory = [lastSafeRoad];
  let nextSafePoseSampleSec = 0;
  let lastSurfaceDistance = 0;
  let lastSurfaceY = spawnRoad.y;

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

  function fixedStep(dt: number, raceDt = dt): void {
    if (paused) return;
    if (pendingCrashRecovery) {
      pendingCrashRecovery = false;
      doRespawn(false);
      return;
    }
    simTimeSec += dt;
    raceTimeSec += raceDt;

    // Input response stays tied to real time even while crash physics is slowed.
    controls.update(raceDt);
    if (AUTO) autodrive();
    bike.prePhysicsUpdate(dt, intent);
    world.step(dt);
    const crash = bike.postPhysicsUpdate(dt);
    if (crash) {
      slowMotion.trigger(crash.severity);
      checkpoints.invalidate();
      if (lapTimer.running) lapTimer.invalidateCurrent();
      controls.reset();
    }
    // Read directly from Jolt. Visual root transforms update only once per
    // rendered frame and were too stale to protect a fast-moving bike.
    const uprightDot = bike.getPhysicsPoseInto(bikePos, bikeFwd);
    const roadSurface = queryAsphaltSurface(asphalt, bikePos.x, bikePos.y, bikePos.z);
    const surface = queryPlayableSurface(asphalt, bikePos.x, bikePos.y, bikePos.z);
    lastSurfaceDistance = roadSurface.horizontalDistance;
    lastSurfaceY = surface.y;
    const heightAboveSurface = bikePos.y - surface.y;
    const heightAboveRoad = bikePos.y - roadSurface.y;
    const securelyOnAsphalt =
      roadSurface.horizontalDistance < 0.12 &&
      heightAboveRoad > 0.25 &&
      heightAboveRoad < 1.8 &&
      uprightDot > 0.78 &&
      bike.telemetry.wheelContacts[0] &&
      bike.telemetry.wheelContacts[1];
    if (securelyOnAsphalt && simTimeSec >= nextSafePoseSampleSec) {
      safeRoadHistory.push({
        x: roadSurface.x,
        y: roadSurface.y,
        z: roadSurface.z,
        yaw: Math.atan2(bikeFwd.x, bikeFwd.z),
      });
      if (safeRoadHistory.length > 8) safeRoadHistory.shift();
      // Recover roughly 0.75 s before the newest safe sample, not at the
      // unstable edge of the incident that triggered the watchdog.
      lastSafeRoad = safeRoadHistory[Math.max(0, safeRoadHistory.length - 4)]!;
      nextSafePoseSampleSec = simTimeSec + 0.25;
    }

    const ev = bike.telemetry.crashed
      ? { passed: false, lapStarted: false, lapCompleted: false }
      : checkpoints.update(bikePos.x, bikePos.z);
    if (ev.lapStarted) {
      lapTimer.start(raceTimeSec);
      if (AUTO) console.log(`[lap] started @${raceTimeSec.toFixed(2)}s`);
    }
    if (!checkpoints.valid && lapTimer.running) {
      lapTimer.invalidateCurrent();
      if (AUTO && lapWasValid) console.log(`[lap] invalidated @${simTimeSec.toFixed(2)}s`);
    }
    lapWasValid = checkpoints.valid;
    if (ev.lapCompleted) {
      const ms = lapTimer.completeLap(raceTimeSec);
      if (AUTO) console.log(`[lap] completed ${ms}ms @${raceTimeSec.toFixed(2)}s`);
      if (ms !== null) bestLapStore.appendHistory(ms);
      if (ms !== null && (bestMs === null || ms < bestMs)) {
        bestMs = ms;
        bestLapStore.save(ms);
        hud.flashNewBest(performance.now());
        if (AUTO) console.log(`[lap] best saved ${ms}ms (localStorage: ${bestLapStore.load()})`);
      }
    }

    // Auto-respawn watchdog.
    const outsideWorld =
      !Number.isFinite(surface.horizontalDistance) ||
      surface.horizontalDistance > 35 ||
      heightAboveSurface < -0.9 ||
      (roadSurface.horizontalDistance < 18 && heightAboveRoad < -0.45) ||
      bikePos.y < 3;
    let needsRespawn = !STEER_TEST && outsideWorld;
    if (!needsRespawn && !STEER_TEST && !bike.telemetry.crashed) {
      needsRespawn = respawnMonitor.update(dt, simTimeSec, {
        uprightDot,
        surfaceDistance: surface.horizontalDistance,
        heightAboveSurface,
      });
    }
    if (needsRespawn) {
      if (AUTO) console.log(`[lap] auto-respawn @${simTimeSec.toFixed(2)}s`);
      doRespawn(false);
    }
  }

  if (AUTO) {
    // Headless virtual time fast-forwards TIMERS, not rAF (which fires only a
    // handful of times), so the autopilot drives the sim from a timer chain.
    const autoTick = (): void => {
      if (disposed) return;
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
          currentMs: lapTimer.currentMs(raceTimeSec),
          lastLapMs: lapTimer.lastLapMs,
          bestMs,
          sessionBestMs: lapTimer.sessionBestMs,
          lapNumber: lapTimer.lapNumber,
          lapHistoryMs: lapTimer.historyMs,
          lapValid: checkpoints.valid,
          cameraMode: chase.modeLabel,
          bikePos,
        },
        performance.now(),
      );
      autoTimer = window.setTimeout(autoTick, AUTO_RENDER ? 1000 / PHYSICS.fixedHz : 0);
    };
    autoTimer = window.setTimeout(autoTick, 0);
  } else {
    clock.onFixedStep = fixedStep;
  }

  /** Pure-pursuit + curvature speed plan along the centerline (verification only). */
  function autodrive(): void {
    if (SPEED_TEST || BRAKE_TEST) {
      // The grid straight is long enough to demonstrate an upshift, followed
      // by a meaningful in-gear coast before its braking zone.
      const accelerationEnd = BRAKE_TEST ? 7.2 : 9.5;
      intent.throttle = simTimeSec < accelerationEnd ? 1 : 0;
      intent.brake = BRAKE_TEST && simTimeSec >= accelerationEnd && simTimeSec < 10.5 ? 1 : 0;
      intent.steer = 0;
      if (simTimeSec >= steerLogNext) {
        steerLogNext += 0.25;
        console.log(
          `[speed] t=${simTimeSec.toFixed(2)} ` +
          `v=${bike.telemetry.speedKph.toFixed(1)} gear=${bike.telemetry.gear} ` +
          `rpm=${bike.telemetry.rpm.toFixed(0)} throttle=${intent.throttle.toFixed(0)}`,
        );
      }
      return;
    }

    // Handedness probe: cruise straight, then hold full-right steering. This
    // model/controller pairing produces decreasing mathematical yaw for the
    // player-visible right turn; the live camera view is authoritative.
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

    // A race bike has no reverse. The verification driver uses the same safe
    // recovery action as the player if it becomes beached or faces backward.
    const backwards = Math.abs(lastDriveAngle) > 2.1; // ~120°
    if ((speed < 0.6 && !backwards) || (backwards && speed < 2)) {
      stuckSec += 1 / PHYSICS.fixedHz;
      if (stuckSec > 4) {
        stuckSec = 0;
        doRespawn(false);
        if (AUTO) console.log(`[auto] recovered stuck bike @${simTimeSec.toFixed(1)}s`);
        return;
      }
    } else {
      stuckSec = 0;
    }

    const ahead = Math.max(3, Math.round((6 + speed * 0.9) / track.spacing));
    const target = track.samples[(i + ahead) % track.count]!;
    bike.getForwardInto(bikeFwd);
    // Fixed-step verification must use the latest physics pose. The rendered
    // root only updates once after a 200-step batch and made autopilot steer
    // toward a stale position, masking drivetrain behavior with recoveries.
    const dx = target.p[0] - bikePos.x;
    const dz = target.p[2] - bikePos.z;
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
    // A held throttle/steering command was immediately recreating the crash,
    // causing an inescapable recover-crash loop. Require a fresh key press.
    controls.reset();
    bike.respawnAt(
      lastSafeRoad.x,
      lastSafeRoad.y,
      lastSafeRoad.z,
      lastSafeRoad.yaw,
    );
    bikePos.set(lastSafeRoad.x, lastSafeRoad.y, lastSafeRoad.z);
    slowMotion.reset();
    clock.timeScale = 1;
    if (manual) respawnMonitor.notifyManual(simTimeSec);
    checkpoints.invalidate(); // respawns never count toward the current lap
    if (lapTimer.running) lapTimer.invalidateCurrent();
  }

  clock.onFrame = (frameDt) => {
    const cinematic = slowMotion.update(frameDt);
    clock.timeScale = cinematic.timeScale;
    if (cinematic.recover) pendingCrashRecovery = true;
    bike.syncVisuals(clock.interpolationAlpha);
    bikePos.copy(bike.root.position);
    bikeFwd.set(0, 0, 1).applyQuaternion(bike.root.quaternion).normalize();
    bikeUp.set(0, 1, 0).applyQuaternion(bike.root.quaternion).normalize();

    // Ordinary autopilot runs skip rendering; `&render` is the rider-camera
    // regression harness used to verify hard acceleration at real speed.
    if (!AUTO || AUTO_RENDER) {
      if (bike.telemetry.crashed && bike.getCrashRiderPositionInto(crashRiderPos)) {
        chase.updateCrash(frameDt, bikePos, bikeFwd, crashRiderPos, bike.telemetry.impactSeverity);
      } else {
        chase.update(
          frameDt,
          bikePos,
          bikeFwd,
          bike.telemetry.leanDeg,
          bike.telemetry.speedKph / 3.6,
          bikeUp,
        );
      }
      renderer3d.trackSunOn({ x: bikePos.x, y: bikePos.y, z: bikePos.z });
      speedEffects.update(
        frameDt,
        bikePos,
        bikeFwd,
        bike.telemetry.speedKph / 3.6,
        intent.throttle,
        intent.brake,
        lastSurfaceDistance,
        lastSurfaceY,
      );
      renderer3d.setSpeedEffect(bike.telemetry.speedKph / 3.6);
      renderer3d.render();
    }
    engineSound.update(
      bike.telemetry.rpm / ENGINE.maxRpm,
      bike.telemetry.crashed ? 0 : intent.throttle,
    );

    hud.update(
      {
        speedKph: bike.telemetry.speedKph,
        gear: bike.telemetry.gear,
        rpm01: bike.telemetry.rpm / ENGINE.maxRpm,
        leanDeg: bike.telemetry.leanDeg,
        currentMs: lapTimer.currentMs(raceTimeSec),
        lastLapMs: lapTimer.lastLapMs,
        bestMs,
        sessionBestMs: lapTimer.sessionBestMs,
        lapNumber: lapTimer.lapNumber,
        lapHistoryMs: lapTimer.historyMs,
        lapValid: checkpoints.valid,
        cameraMode: chase.modeLabel,
        bikePos,
      },
      performance.now(),
    );

    // Edge-triggered input handling (per rendered frame is plenty).
    const actions = controls.takeActions();
    if (actions.cameraToggle) {
      chase.toggleMode();
      bike.setRiderVisible(chase.mode === 'rear');
    }
    if (actions.pauseToggle) {
      paused = !paused;
      engineSound.setMuted(paused);
    }
    if (actions.rebuildBike) bike.rebuild();
    if (actions.recover) doRespawn(true);
  };

  clock.start();
  loading.hide();

  return () => {
    disposed = true;
    if (autoTimer !== null) window.clearTimeout(autoTimer);
    clock.stop();
    controls.dispose();
    engineSound.dispose();
    hud.dispose();
    atmosphere.dispose();
    surfaceDetails.dispose();
    speedEffects.dispose();
    (trackVisuals.userData.disposeRealismMaps as (() => void) | undefined)?.();
    trackVisuals.removeFromParent();
    bike.dispose();
    world.dispose();
    renderer3d.dispose();
    container.replaceChildren();
  };
}
