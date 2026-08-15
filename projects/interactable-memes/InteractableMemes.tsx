"use client";

import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Shot = { id: number; x: number; y: number; glyph: string };

const levels = ["DORMANT", "SUSPICIOUS", "GLOWING", "DINOSAUR"];
const reactions = [
  "BRAIN: No.",
  "BRAIN: Fine, but make it dramatic.",
  "BRAIN: You son of a bitch, I’m in.",
  "BRAIN: We have learned absolutely nothing.",
];

export default function InteractableMemes() {
  const [shots, setShots] = useState<Shot[]>([]);
  const [shotCount, setShotCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isScratching, setIsScratching] = useState(false);
  const [recordRotation, setRecordRotation] = useState(0);
  const [bpm, setBpm] = useState(118);
  const [reactorLevel, setReactorLevel] = useState(0);
  const [pillDoses, setPillDoses] = useState(0);
  const shotId = useRef(0);
  const scratchX = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  function fireFingerGun(event?: ReactPointerEvent<HTMLButtonElement>) {
    const rect = event?.currentTarget.getBoundingClientRect();
    const x = event && rect ? ((event.clientX - rect.left) / rect.width) * 100 : 50;
    const y = event && rect ? ((event.clientY - rect.top) / rect.height) * 100 : 48;
    const id = shotId.current++;

    setShots((current) => [...current.slice(-7), { id, x, y, glyph: id % 3 === 0 ? "POW!" : "PEW!" }]);
    setShotCount((count) => count + 1);
    timers.current.push(
      window.setTimeout(() => setShots((current) => current.filter((shot) => shot.id !== id)), 720),
    );
  }

  function aimFingerGun(event: ReactPointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--aim-x", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--aim-y", `${event.clientY - rect.top}px`);
  }

  function startScratch(event: ReactPointerEvent<HTMLButtonElement>) {
    setIsScratching(true);
    setIsPlaying(false);
    scratchX.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function scratch(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!isScratching) return;
    const delta = event.clientX - scratchX.current;
    scratchX.current = event.clientX;
    setRecordRotation((rotation) => rotation + delta * 1.8);
  }

  function stopScratch(event: ReactPointerEvent<HTMLButtonElement>) {
    setIsScratching(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resetAll() {
    setShots([]);
    setShotCount(0);
    setIsPlaying(true);
    setIsScratching(false);
    setRecordRotation(0);
    setBpm(118);
    setReactorLevel(0);
    setPillDoses(0);
  }

  const discStyle = {
    "--record-turn": `${recordRotation}deg`,
    "--spin-speed": `${Math.max(0.45, 9 - bpm / 17)}s`,
  } as CSSProperties;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Interactable Memes home">
          <span className="brand-mark">IM</span>
          <span>INTERACTABLE<br />MEMES</span>
        </a>
        <nav className="chapter-nav" aria-label="Meme machines">
          <a href="#standoff">01</a>
          <a href="#scratch">02</a>
          <a href="#reactor">03</a>
          <a href="#brain">04</a>
        </nav>
        <button className="reset-button" type="button" onClick={resetAll}>REMIX MEME ↻</button>
      </header>

      <section className="hero" id="top">
        <div className="hero-noise" aria-hidden="true" />
        <div className="hero-copy">
          <p className="eyebrow"><span>LIVE</span> A tiny experiment in serious nonsense</p>
          <h1>MEMES YOU<br /><em>CAN TOUCH.</em></h1>
          <p className="intro">
            Four familiar images. Four unnecessary control panels. Point, scratch,
            activate, and medicate your way through the internet’s finest logic.
          </p>
          <a className="enter-button" href="#standoff">ENTER THE LAB <span>↓</span></a>
        </div>

        <div className="hero-stack" aria-label="Four interactive meme previews">
          <a className="stack-card stack-card-one" href="#standoff">
            <Image src="/interactable-memes/source/finger-guns.png" alt="Office finger-gun standoff" width={708} height={534} />
            <span>01 / CROSSFIRE</span>
          </a>
          <a className="stack-card stack-card-two" href="#scratch">
            <Image src="/interactable-memes/source/dj-cat.png" alt="Cat DJ at a turntable" width={744} height={402} />
            <span>02 / DJ CAT</span>
          </a>
          <a className="stack-card stack-card-three" href="#reactor">
            <Image src="/interactable-memes/source/radioactive-dinosaur.png" alt="Gorilla radioactive dinosaur meme" width={720} height={463} />
            <span>03 / REACTOR</span>
          </a>
          <a className="stack-card stack-card-four" href="#brain">
            <Image src="/interactable-memes/source/brain-pill.png" alt="Morty agrees to take a pill meme" width={500} height={488} />
            <span>04 / BRAIN</span>
          </a>
        </div>

        <div className="hero-footer" aria-hidden="true">
          <span>SCROLL TO ACTIVATE</span><span>NO MEMES WERE IMPROVED IN THIS PROCESS</span>
        </div>
      </section>

      <section className="meme-room room-standoff" id="standoff">
        <div className="room-copy">
          <p className="room-index">01 / OFFICE CROSSFIRE</p>
          <h2>Finger guns.<br /><em>Real stakes.</em></h2>
          <p>Move your cursor to aim. Tap anywhere in the frame to return fire.</p>
          <div className="scoreboard" aria-live="polite">
            <span>SHOTS FIRED</span><strong>{String(shotCount).padStart(2, "0")}</strong>
          </div>
        </div>
        <div className="machine machine-standoff">
          <div className="machine-label"><span>GESTURE RECOGNITION: EXTREMELY MANUAL</span><span>ARMED</span></div>
          <button
            className="image-button standoff-stage"
            type="button"
            aria-label="Aim and fire a finger gun"
            onPointerMove={aimFingerGun}
            onPointerDown={fireFingerGun}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fireFingerGun();
              }
            }}
          >
            <Image src="/interactable-memes/source/finger-guns.png" alt="Michael Scott surrounded by finger guns" width={708} height={534} />
            <span className="crosshair" aria-hidden="true" />
            {shots.map((shot) => (
              <span
                className="shot-burst"
                key={shot.id}
                style={{ left: `${shot.x}%`, top: `${shot.y}%` }}
                aria-hidden="true"
              >{shot.glyph}</span>
            ))}
          </button>
          <p className="machine-tip">TIP / TAP FAST FOR MAXIMUM CORPORATE TENSION</p>
        </div>
      </section>

      <section className="meme-room room-scratch" id="scratch">
        <div className="room-copy">
          <p className="room-index">02 / VINYL PURR-SUASION</p>
          <h2>Scratch the<br /><em>cat-alogue.</em></h2>
          <p>Drag the record back and forth, or let DJ Whiskers run the booth.</p>
          <div className="dj-controls">
            <button type="button" onClick={() => setIsPlaying((playing) => !playing)}>
              {isPlaying ? "PAUSE SET Ⅱ" : "PLAY SET ▶"}
            </button>
            <label>
              <span>BPM <b>{bpm}</b></span>
              <input
                type="range"
                min="72"
                max="180"
                value={bpm}
                onChange={(event) => setBpm(Number(event.target.value))}
                aria-label="DJ set tempo"
              />
            </label>
          </div>
        </div>
        <div className={`machine machine-scratch${isPlaying ? " is-playing" : ""}${isScratching ? " is-scratching" : ""}`}>
          <div className="machine-label"><span>FELINE FREQUENCY MODULATOR</span><span>{isScratching ? "SCRATCH!" : `${bpm} BPM`}</span></div>
          <div className="dj-stage">
            <Image src="/interactable-memes/source/dj-cat.png" alt="Cat DJ raising one paw over a turntable" width={744} height={402} />
            <div className="equalizer" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</div>
            <div className="record-spinner" style={discStyle}>
              <button
                className="scratch-disc"
                type="button"
                aria-label="Drag to scratch the record"
                onPointerDown={startScratch}
                onPointerMove={scratch}
                onPointerUp={stopScratch}
                onPointerCancel={stopScratch}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    setIsPlaying(false);
                    setRecordRotation((rotation) => rotation + (event.key === "ArrowLeft" ? -24 : 24));
                  }
                  if (event.key === " ") {
                    event.preventDefault();
                    setIsPlaying((playing) => !playing);
                  }
                }}
              ><span>DRAG<br />ME</span></button>
            </div>
          </div>
          <p className="machine-tip">TIP / THE CAT ACCEPTS REQUESTS, THEN IGNORES THEM</p>
        </div>
      </section>

      <section className="meme-room room-reactor" id="reactor">
        <div className="room-copy">
          <p className="room-index">03 / EFFORT REACTOR</p>
          <h2>Try your<br /><em>absolute best.</em></h2>
          <p>Increase the effort level. Scientific accuracy stops at “radioactive dinosaur.”</p>
          <button
            className="reactor-trigger"
            type="button"
            onClick={() => setReactorLevel((level) => (level + 1) % levels.length)}
          >PUSH FOR MORE EFFORT <span>＋</span></button>
        </div>
        <div className={`machine machine-reactor reactor-level-${reactorLevel}`}>
          <div className="machine-label"><span>UNLICENSED MOTIVATION CHAMBER</span><span>{levels[reactorLevel]}</span></div>
          <button
            className="image-button reactor-stage"
            type="button"
            aria-label={`Effort level ${reactorLevel + 1} of ${levels.length}: ${levels[reactorLevel]}. Activate next level.`}
            onClick={() => setReactorLevel((level) => (level + 1) % levels.length)}
          >
            <Image src="/interactable-memes/source/radioactive-dinosaur.png" alt="Gorilla promises to fight a radioactive dinosaur" width={720} height={463} />
            <span className="reactor-glow" aria-hidden="true" />
            <span className="hazard-symbol" aria-hidden="true">☢</span>
            <span className="reactor-readout" aria-hidden="true">
              {levels.map((level, index) => <i className={index <= reactorLevel ? "active" : ""} key={level} />)}
            </span>
          </button>
          <p className="machine-tip">CURRENT THREAT / {levels[reactorLevel]} · CLICK IMAGE TO ESCALATE</p>
        </div>
      </section>

      <section className="meme-room room-brain" id="brain">
        <div className="room-copy">
          <p className="room-index">04 / PLACEBO PROTOCOL</p>
          <h2>Ask brain.<br /><em>Ignore brain.</em></h2>
          <p>Take another zero-effect pill and watch your internal governance collapse.</p>
          <button className="pill-button" type="button" onClick={() => setPillDoses((dose) => dose + 1)}>
            TAKE PILL <span>CAPSULE {String(pillDoses + 1).padStart(2, "0")}</span>
          </button>
          <p className="brain-response" aria-live="polite">{reactions[pillDoses % reactions.length]}</p>
        </div>
        <div className={`machine machine-brain dose-${Math.min(pillDoses, 3)}`}>
          <div className="machine-label"><span>DECISION OVERRIDE SIMULATOR</span><span>{pillDoses} DOSE{pillDoses === 1 ? "" : "S"}</span></div>
          <button
            className="image-button brain-stage"
            type="button"
            aria-label="Take another no-effect pill"
            onClick={() => setPillDoses((dose) => dose + 1)}
          >
            <Image src="/interactable-memes/source/brain-pill.png" alt="Morty saying: You son of a bitch, I'm in" width={500} height={488} />
            {pillDoses > 0 && <span className="falling-pill" key={pillDoses} aria-hidden="true"><i /><b /></span>}
            <span className="approval-stamp" aria-hidden="true">BRAIN<br />APPROVED</span>
          </button>
          <p className="machine-tip">SIDE EFFECTS / COMMITMENT, CONFIDENCE, MORE MEMES</p>
        </div>
      </section>

      <footer className="manifesto" id="about">
        <p className="manifesto-index">05 / FIELD NOTES</p>
        <h2>Memes were never meant to sit still.<br /><span>So we taught them some moves.</span></h2>
        <div className="manifesto-grid">
          <p>Four images entered the lab. They left with buttons, knobs, questionable physics, and a much stronger sense of agency.</p>
          <p className="aside-copy">BUILT FOR CURIOUS POINTERS<br />TOUCHSCREENS WELCOME<br /><strong>EST. 2026</strong></p>
        </div>
        <a className="back-to-top" href="#top">RUN THE EXPERIMENT AGAIN ↑</a>
      </footer>
    </main>
  );
}
