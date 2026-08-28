import * as THREE from 'three';
import { LEAN } from '../config';
import type { TrackData } from '../track/TrackData';

export interface HudSnapshot {
  speedKph: number;
  gear: number;
  /** Engine RPM normalized to [0,1] against the rev limit. */
  rpm01: number;
  leanDeg: number;
  currentMs: number | null;
  lastLapMs: number | null;
  bestMs: number | null;
  sessionBestMs: number | null;
  lapNumber: number;
  lapHistoryMs: readonly number[];
  /** False while the in-progress lap is invalidated. */
  lapValid: boolean;
  crashed: boolean;
  impactSeverity: number;
  cameraMode: string;
  bikePos: THREE.Vector3;
}

const UPDATE_INTERVAL_MS = 66; // ~15 Hz

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
  parent: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  parent.appendChild(e);
  return e;
}

function fmtTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '--:--.---';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = Math.floor(ms % 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

/** Plain-DOM racing HUD + 2D-canvas minimap. Internally throttled to ~15 Hz. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly speedValue: HTMLElement;
  private readonly speedCluster: HTMLElement;
  private readonly gearValue: HTMLElement;
  private readonly rpmFill: HTMLElement;
  private readonly leanNeedle: HTMLElement;
  private readonly currentTime: HTMLElement;
  private readonly lastTime: HTMLElement;
  private readonly bestTime: HTMLElement;
  private readonly sessionBestTime: HTMLElement;
  private readonly lapNumber: HTMLElement;
  private readonly lapHistory: HTMLElement;
  private readonly invalidFlash: HTMLElement;
  private readonly newBestFlash: HTMLElement;
  private readonly crashVignette: HTMLElement;
  private readonly crashLabel: HTMLElement;
  private readonly cameraMode: HTMLElement;
  private readonly cockpitTft: HTMLElement;
  private readonly cockpitSpeed: HTMLElement;
  private readonly cockpitGear: HTMLElement;
  private readonly cockpitRpm: HTMLElement;
  private readonly minimapCtx: CanvasRenderingContext2D;
  private readonly mapPath: Path2D;
  private readonly mapGateDots: Array<[number, number]>;
  private readonly mapScale: number;
  private readonly mapOffset: { x: number; y: number };
  private readonly track: TrackData;

  private lastDraw = 0;
  private flashUntil = 0;
  private bestFlashUntil = 0;
  private bestMs: number | null;

  constructor(host: HTMLElement, track: TrackData, bestMs: number | null) {
    this.track = track;
    this.bestMs = bestMs;

    this.root = el(
      'div',
      {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        color: '#fff',
        textShadow: '0 1px 3px rgba(0,0,0,.7)',
        userSelect: 'none',
      },
      host,
    );

    // --- lap panel (top left) -------------------------------------------------
    const laps = el(
      'div',
      { position: 'absolute', top: '14px', left: '16px', fontSize: '20px', lineHeight: '1.45' },
      this.root,
    );
    const row = (label: string): HTMLElement => {
      const r = el('div', { display: 'flex', gap: '10px' }, laps);
      el('span', { width: '72px', opacity: '0.75', fontSize: '15px' }, r).textContent = label;
      return el('span', { fontVariantNumeric: 'tabular-nums' }, r);
    };
    this.currentTime = row('TIME');
    this.lastTime = row('LAST LAP');
    this.bestTime = row('BEST');
    this.sessionBestTime = row('SESSION');
    this.lapNumber = row('LAP');
    this.lapHistory = el(
      'div',
      {
        marginTop: '8px',
        paddingTop: '7px',
        borderTop: '1px solid rgba(255,255,255,.22)',
        color: 'rgba(255,255,255,.72)',
        fontSize: '12px',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: '1.45',
        whiteSpace: 'pre',
      },
      laps,
    );

    // --- minimap (top right) ----------------------------------------------------
    const MAP = 190;
    const mapCanvas = el(
      'canvas',
      { position: 'absolute', top: '14px', right: '16px' },
      this.root,
    );
    mapCanvas.width = MAP;
    mapCanvas.height = MAP;
    this.minimapCtx = mapCanvas.getContext('2d')!;

    // Normalize centerline into the canvas square.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of track.samples) {
      minX = Math.min(minX, s.p[0]);
      maxX = Math.max(maxX, s.p[0]);
      minZ = Math.min(minZ, s.p[2]);
      maxZ = Math.max(maxZ, s.p[2]);
    }
    const pad = 12;
    this.mapScale = Math.min((MAP - pad * 2) / (maxX - minX), (MAP - pad * 2) / (maxZ - minZ));
    this.mapOffset = {
      x: (MAP - this.mapScale * (minX + maxX)) / 2,
      y: (MAP - this.mapScale * (minZ + maxZ)) / 2,
    };

    this.mapPath = new Path2D();
    track.samples.forEach((s, i) => {
      const [mx, my] = this.mapPoint(s.p[0], s.p[2]);
      if (i === 0) this.mapPath.moveTo(mx, my);
      else this.mapPath.lineTo(mx, my);
    });
    this.mapPath.closePath();
    this.mapGateDots = [];
    for (const gi of new CheckpointGateList(track)) {
      const s = track.samples[gi]!;
      this.mapGateDots.push(this.mapPoint(s.p[0], s.p[2]));
    }

    // --- speed cluster (bottom right) -----------------------------------------
    const cluster = el(
      'div',
      {
        position: 'absolute',
        bottom: '18px',
        right: '22px',
        textAlign: 'right',
      },
      this.root,
    );
    this.speedCluster = cluster;

    const rpmTrack = el(
      'div',
      {
        width: '240px',
        height: '8px',
        background: 'rgba(255,255,255,.18)',
        borderRadius: '4px',
        overflow: 'hidden',
        marginBottom: '8px',
        marginLeft: 'auto',
      },
      cluster,
    );
    this.rpmFill = el(
      'div',
      { height: '100%', width: '0%', background: '#e33', borderRadius: '4px' },
      rpmTrack,
    );

    const speedRow = el('div', { display: 'flex', alignItems: 'baseline', gap: '12px', justifyContent: 'flex-end' }, cluster);
    this.speedValue = el(
      'span',
      { fontSize: '54px', fontWeight: '700', fontVariantNumeric: 'tabular-nums', lineHeight: '1' },
      speedRow,
    );
    el('span', { fontSize: '16px', opacity: '0.75' }, speedRow).textContent = 'km/h';

    this.gearValue = el(
      'div',
      { fontSize: '22px', fontWeight: '800', opacity: '0.94', marginTop: '5px', letterSpacing: '1px' },
      cluster,
    );
    this.gearValue.textContent = 'AUTO · GEAR N';

    // Cockpit-mounted Ducati TFT. It is shown only in rider view and sits in
    // the real instrument sightline between the clip-ons, so the rendered
    // gloves remain visible on both sides of it.
    this.cockpitTft = el(
      'div',
      {
        position: 'absolute',
        left: '50%',
        bottom: '14px',
        transform: 'translateX(-50%) perspective(300px) rotateX(8deg)',
        width: '178px',
        height: '78px',
        display: 'none',
        overflow: 'hidden',
        boxSizing: 'border-box',
        border: '2px solid #aeb6c1',
        borderRadius: '7px',
        background: 'linear-gradient(145deg,#111720,#030507 72%)',
        boxShadow: '0 4px 14px rgba(0,0,0,.82), inset 0 0 0 2px rgba(0,0,0,.8)',
        textShadow: 'none',
      },
      this.root,
    );
    const tftHeader = el(
      'div',
      {
        height: '15px',
        padding: '1px 7px 0',
        boxSizing: 'border-box',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#c9152b',
        color: '#fff',
        fontSize: '7px',
        fontWeight: '900',
        fontStyle: 'italic',
        letterSpacing: '.8px',
      },
      this.cockpitTft,
    );
    el('span', {}, tftHeader).textContent = 'DUCATI CORSE';
    el('span', {}, tftHeader).textContent = 'MARC 93';
    const tftMain = el(
      'div',
      { display: 'flex', height: '43px', alignItems: 'center', padding: '0 8px' },
      this.cockpitTft,
    );
    this.cockpitSpeed = el(
      'div',
      {
        flex: '1',
        color: '#f5f8fc',
        fontSize: '32px',
        fontWeight: '900',
        lineHeight: '1',
        textAlign: 'center',
        fontVariantNumeric: 'tabular-nums',
      },
      tftMain,
    );
    el('span', { fontSize: '8px', color: '#aeb7c4', marginLeft: '-4px', alignSelf: 'flex-end', marginBottom: '7px' }, tftMain).textContent = 'km/h';
    const cockpitGearBox = el(
      'div',
      {
        width: '39px',
        marginLeft: '6px',
        color: '#fff',
        border: '2px solid #c9152b',
        borderRadius: '5px',
        textAlign: 'center',
      },
      tftMain,
    );
    el(
      'div',
      { color: '#ff5263', fontSize: '8px', fontWeight: '900', lineHeight: '11px', letterSpacing: '1px' },
      cockpitGearBox,
    ).textContent = 'AUTO';
    this.cockpitGear = el(
      'div',
      { fontSize: '24px', fontWeight: '900', lineHeight: '24px' },
      cockpitGearBox,
    );
    this.cockpitGear.textContent = 'N';
    const tftRpmTrack = el(
      'div',
      { height: '5px', margin: '6px 7px 0', background: '#202833', borderRadius: '2px', overflow: 'hidden' },
      this.cockpitTft,
    );
    this.cockpitRpm = el('div', { width: '0%', height: '100%', background: '#f4f7fb' }, tftRpmTrack);

    // Lean gauge (bottom left): centered needle over a gradient bar.
    const leanWrap = el(
      'div',
      {
        position: 'absolute',
        bottom: '26px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '260px',
        height: '6px',
        borderRadius: '3px',
        background: 'linear-gradient(to right, rgba(255,255,255,.35), rgba(255,255,255,.08), rgba(255,255,255,.35))',
      },
      this.root,
    );
    this.leanNeedle = el(
      'div',
      {
        position: 'absolute',
        top: '-5px',
        left: '50%',
        width: '4px',
        height: '16px',
        borderRadius: '2px',
        background: '#ffd24d',
        marginLeft: '-2px',
      },
      leanWrap,
    );

    // --- invalid flash (center) -------------------------------------------------
    this.invalidFlash = el(
      'div',
      {
        position: 'absolute',
        top: '38%',
        left: '50%',
        transform: 'translate(-50%,-50%)',
        fontSize: '42px',
        fontWeight: '800',
        letterSpacing: '2px',
        color: '#ff5252',
        opacity: '0',
        transition: 'opacity .15s',
      },
      this.root,
    );
    this.invalidFlash.textContent = 'LAP INVALID';

    this.newBestFlash = el(
      'div',
      {
        position: 'absolute',
        top: '31%',
        left: '50%',
        transform: 'translate(-50%,-50%) scale(.96)',
        padding: '12px 20px',
        border: '1px solid rgba(91,255,151,.7)',
        borderRadius: '8px',
        background: 'rgba(4,35,20,.75)',
        color: '#5bff97',
        fontSize: '27px',
        fontWeight: '900',
        letterSpacing: '2px',
        opacity: '0',
        transition: 'opacity .2s, transform .25s',
      },
      this.root,
    );
    this.newBestFlash.textContent = 'NEW PERSONAL BEST';

    this.crashVignette = el(
      'div',
      {
        position: 'absolute',
        inset: '0',
        zIndex: '5',
        background: 'radial-gradient(circle at center, transparent 34%, rgba(92,0,5,.2) 68%, rgba(120,0,8,.72) 100%)',
        opacity: '0',
        transition: 'opacity .12s ease-out',
      },
      this.root,
    );
    this.crashLabel = el(
      'div',
      {
        position: 'absolute',
        left: '50%',
        top: '22%',
        zIndex: '6',
        transform: 'translate(-50%,-50%) scale(.92)',
        padding: '10px 18px',
        border: '1px solid rgba(255,104,112,.78)',
        borderRadius: '5px',
        background: 'rgba(28,2,4,.76)',
        color: '#ff737c',
        fontSize: '24px',
        fontWeight: '900',
        letterSpacing: '3px',
        opacity: '0',
        transition: 'opacity .12s, transform .18s',
      },
      this.root,
    );
    this.crashLabel.textContent = 'RIDER DOWN';

    this.cameraMode = el(
      'div',
      {
        position: 'absolute',
        top: '18px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '6px 10px',
        border: '1px solid rgba(255,255,255,.3)',
        borderRadius: '999px',
        background: 'rgba(5,9,14,.35)',
        fontSize: '11px',
        fontWeight: '700',
        letterSpacing: '1.4px',
      },
      this.root,
    );
  }

  dispose(): void {
    this.root.remove();
  }

  flashInvalid(nowMs: number): void {
    this.flashUntil = nowMs + 1600;
  }

  flashNewBest(nowMs: number): void {
    this.bestFlashUntil = nowMs + 2400;
  }

  /** Called every rendered frame; redraws at ~15 Hz. */
  update(snap: HudSnapshot, nowMs: number): void {
    if (nowMs - this.lastDraw < UPDATE_INTERVAL_MS) return;
    this.lastDraw = nowMs;

    this.speedValue.textContent = String(Math.round(Math.max(0, snap.speedKph)));
    const gear = snap.gear <= 0 ? 'N' : String(snap.gear);
    this.gearValue.textContent = `AUTO · GEAR ${gear}`;

    const rpmPct = Math.min(100, snap.rpm01 * 100);
    this.rpmFill.style.width = `${rpmPct.toFixed(1)}%`;
    this.rpmFill.style.background = snap.rpm01 > 0.92 ? '#ff3b30' : snap.rpm01 > 0.75 ? '#ffb340' : '#37d067';

    const leanFrac = THREE.MathUtils.clamp(snap.leanDeg / LEAN.maxLeanAngleDeg, -1, 1);
    this.leanNeedle.style.left = `${(50 + leanFrac * 48).toFixed(1)}%`;

    this.currentTime.textContent = fmtTime(snap.currentMs);
    this.currentTime.style.color = snap.lapValid ? '#fff' : '#ff5252';
    this.lastTime.textContent = fmtTime(snap.lastLapMs);
    this.bestTime.textContent = fmtTime(snap.bestMs);
    this.sessionBestTime.textContent = fmtTime(snap.sessionBestMs);
    this.lapNumber.textContent = snap.lapNumber > 0 ? String(snap.lapNumber) : '--';
    this.lapHistory.textContent = snap.lapHistoryMs.length
      ? snap.lapHistoryMs
          .slice(-4)
          .reverse()
          .map((ms) => `•  ${fmtTime(ms)}`)
          .join('\n')
      : 'NO COMPLETED LAPS';
    this.cameraMode.textContent = snap.cameraMode;
    this.cockpitTft.style.display = snap.cameraMode === 'RIDER VIEW' ? 'block' : 'none';
    this.speedCluster.style.display = snap.cameraMode === 'RIDER VIEW' ? 'none' : 'block';
    this.cockpitSpeed.textContent = String(Math.round(Math.max(0, snap.speedKph)));
    this.cockpitGear.textContent = gear;
    this.cockpitRpm.style.width = `${rpmPct.toFixed(1)}%`;
    this.cockpitRpm.style.background =
      snap.rpm01 > 0.92 ? '#ff2a34' : snap.rpm01 > 0.75 ? '#ffb000' : '#f4f7fb';

    this.invalidFlash.style.opacity = nowMs < this.flashUntil ? '1' : '0';
    const showBest = nowMs < this.bestFlashUntil;
    this.newBestFlash.style.opacity = showBest ? '1' : '0';
    this.newBestFlash.style.transform = `translate(-50%,-50%) scale(${showBest ? '1' : '.96'})`;
    const crashOpacity = snap.crashed
      ? THREE.MathUtils.lerp(0.42, 0.78, THREE.MathUtils.clamp(snap.impactSeverity, 0, 1))
      : 0;
    this.crashVignette.style.opacity = crashOpacity.toFixed(2);
    this.crashLabel.style.opacity = snap.crashed ? '1' : '0';
    this.crashLabel.style.transform = `translate(-50%,-50%) scale(${snap.crashed ? '1' : '.92'})`;

    this.drawMinimap(snap.bikePos);
  }

  private drawMinimap(bikePos: THREE.Vector3): void {
    const ctx = this.minimapCtx;
    ctx.clearRect(0, 0, 190, 190);
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.stroke(this.mapPath);

    // Start line tick.
    const s0 = this.track.samples[this.track.json.startSampleIndex]!;
    const [sx, sy] = this.mapPoint(s0.p[0], s0.p[2]);
    ctx.fillStyle = '#fff';
    ctx.fillRect(sx - 1.5, sy - 5, 3, 10);

    // Gates.
    ctx.fillStyle = 'rgba(255,210,80,.9)';
    for (const [gx, gy] of this.mapGateDots) {
      ctx.beginPath();
      ctx.arc(gx, gy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Bike dot.
    const [bx, by] = this.mapPoint(bikePos.x, bikePos.z);
    ctx.fillStyle = '#ff453a';
    ctx.beginPath();
    ctx.arc(bx, by, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }

  private mapPoint(x: number, z: number): [number, number] {
    return [this.mapOffset.x + x * this.mapScale, this.mapOffset.y + z * this.mapScale];
  }
}

/** Minimal adapter so the HUD can show gate dots without owning Checkpoints. */
class CheckpointGateList implements Iterable<number> {
  constructor(private track: TrackData) {}

  *[Symbol.iterator](): Iterator<number> {
    const gates = Math.max(2, this.track.json.checkpoints ?? 8);
    const n = this.track.count;
    const start = this.track.json.startSampleIndex % n;
    for (let k = 1; k < gates; k++) yield (start + Math.round((k * n) / gates)) % n;
  }
}
