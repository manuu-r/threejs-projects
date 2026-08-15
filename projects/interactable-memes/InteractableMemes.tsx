"use client";

import Image from "next/image";
import { useState } from "react";
import { MemeDiorama } from "./MemeDiorama";

const levels = ["DORMANT", "SUSPICIOUS", "GLOWING", "DINOSAUR"];
const reactions = [
  "BRAIN: No.",
  "BRAIN: Fine, but make it dramatic.",
  "BRAIN: You son of a bitch, I’m in.",
  "BRAIN: We have learned absolutely nothing.",
];
const demoStates = [
  "PRODUCT STATUS: NOT READY",
  "ADDING VERY CONVINCING FAKE DATA…",
  "MOVING THE BUGS OFFSCREEN…",
  "RENAMING ‘BROKEN’ TO ‘BETA’…",
  "DEMO READY-ISH. DO NOT REFRESH.",
];

type MemeReferenceProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  index: string;
  note: string;
};

function MemeReference({ src, alt, width, height, index, note }: MemeReferenceProps) {
  return (
    <figure className="reference-card">
      <div className="compare-label"><span>ORIGINAL MEME</span><span>{index}A / FLAT</span></div>
      <div className="reference-media">
        <Image src={src} alt={alt} width={width} height={height} sizes="(max-width: 900px) 100vw, 42vw" />
      </div>
      <figcaption>{note}</figcaption>
    </figure>
  );
}

export default function InteractableMemes() {
  const [shotCount, setShotCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [bpm, setBpm] = useState(118);
  const [reactorLevel, setReactorLevel] = useState(0);
  const [pillDoses, setPillDoses] = useState(0);
  const [demoLevel, setDemoLevel] = useState(0);

  function resetAll() {
    setShotCount(0);
    setIsPlaying(true);
    setBpm(118);
    setReactorLevel(0);
    setPillDoses(0);
    setDemoLevel(0);
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Interactable Memes home">
          <span className="brand-mark">IM</span>
          <span>INTERACTABLE<br />MEMES</span>
        </a>
        <nav className="chapter-nav" aria-label="Meme machines">
          <a href="#standoff">01</a><a href="#scratch">02</a><a href="#reactor">03</a><a href="#brain">04</a><a href="#demo">05</a>
        </nav>
        <button className="reset-button" type="button" onClick={resetAll}>RESET THE LAB ↻</button>
      </header>

      <section className="hero" id="top">
        <Image className="hero-art" src="/interactable-memes/og-v4.png" alt="Low-poly 3D ensemble of the five interactive meme remakes" fill priority sizes="100vw" />
        <div className="hero-shade" aria-hidden="true" />
        <div className="hero-noise" aria-hidden="true" />
        <div className="hero-copy">
          <p className="eyebrow"><span>LIVE 3D</span> The original joke, now with polygons</p>
          <h1>THE MEME.<br /><em>THEN THE WORLD.</em></h1>
          <p className="intro">See every source image beside its interactive low-poly remake. Same punchline. More shadows, motion, creatures, machinery, and unnecessary depth.</p>
          <a className="enter-button" href="#standoff">COMPARE THE FIRST MEME <span>↓</span></a>
        </div>
        <div className="hero-target-note"><span>3D ART DIRECTION</span><strong>THIS ENERGY → EVERY SCENE</strong></div>
        <div className="hero-footer" aria-hidden="true"><span>ORIGINAL / 3D / INTERACTIVE</span><span>DRAG · TAP · MAKE THE JOKE WORSE</span></div>
      </section>

      <section className="meme-room room-standoff" id="standoff">
        <div className="room-heading">
          <div className="room-copy">
            <p className="room-index">01 / OFFICE CROSSFIRE</p>
            <h2>Finger guns.<br /><em>Real depth.</em></h2>
            <p>The original frame stays intact on the left. On the right, the suited character and every accusatory hand occupy real 3D space.</p>
          </div>
          <div className="scoreboard" aria-live="polite"><span>SHOTS FIRED</span><strong>{String(shotCount).padStart(2, "0")}</strong></div>
        </div>
        <div className="meme-comparison">
          <MemeReference src="/interactable-memes/source/finger-guns.png" alt="Original office finger-gun standoff meme" width={708} height={534} index="01" note="THE ORIGINAL FRAME / MAXIMUM CORPORATE TENSION" />
          <div className="machine machine-standoff">
            <div className="compare-label"><span>INTERACTIVE 3D REMAKE</span><span>01B / ARMED</span></div>
            <MemeDiorama variant="crossfire" accent="#d8ff38" motion={shotCount} ariaLabel="3D finger-gun standoff. Drag to orbit and tap to fire." onAction={() => setShotCount((count) => count + 1)} />
            <p className="machine-tip">DRAG TO ORBIT · TAP TO FIRE · SUIT MODEL IS FULLY ANIMATED</p>
          </div>
        </div>
      </section>

      <section className="meme-room room-scratch" id="scratch">
        <div className="room-heading">
          <div className="room-copy">
            <p className="room-index">02 / VINYL PURR-SUASION</p>
            <h2>Scratch the<br /><em>cat-alogue.</em></h2>
            <p>The reference cat becomes a shaded low-poly DJ with animated ears, glasses, decks, speakers, and a physical equalizer.</p>
          </div>
          <div className="dj-controls">
            <button type="button" onClick={() => setIsPlaying((playing) => !playing)}>{isPlaying ? "PAUSE SET Ⅱ" : "PLAY SET ▶"}</button>
            <label><span>BPM <b>{bpm}</b></span><input type="range" min="72" max="180" value={bpm} onChange={(event) => setBpm(Number(event.target.value))} aria-label="DJ set tempo" /></label>
          </div>
        </div>
        <div className="meme-comparison">
          <MemeReference src="/interactable-memes/source/dj-cat.png" alt="Original cat DJ meme" width={744} height={402} index="02" note="THE ORIGINAL LOOP / ONE CAT, ZERO REQUESTS" />
          <div className="machine machine-scratch">
            <div className="compare-label"><span>INTERACTIVE 3D REMAKE</span><span>{isPlaying ? `${bpm} BPM` : "PAUSED"}</span></div>
            <MemeDiorama variant="scratch" accent="#b7ff2f" motion={isPlaying ? 1 : 0} speed={bpm} ariaLabel="3D cat DJ booth. Drag to orbit and scratch; tap to play or pause." onAction={() => setIsPlaying((playing) => !playing)} onDragStart={() => setIsPlaying(false)} />
            <p className="machine-tip">DRAG THE DECK · TAP TO DROP THE BEAT · CAT HAS ACTUAL VOLUME</p>
          </div>
        </div>
      </section>

      <section className="meme-room room-reactor" id="reactor">
        <div className="room-heading">
          <div className="room-copy">
            <p className="room-index">03 / EFFORT REACTOR</p>
            <h2>Try your<br /><em>absolute best.</em></h2>
            <p>The gorilla, T‑Rex, rocks, captions, and radioactive core are separate lit objects. Orbit them to inspect exactly how bad the situation is.</p>
          </div>
          <button className="reactor-trigger" type="button" onClick={() => setReactorLevel((level) => (level + 1) % levels.length)}>PUSH FOR MORE EFFORT <span>＋</span></button>
        </div>
        <div className="meme-comparison">
          <MemeReference src="/interactable-memes/source/radioactive-dinosaur.png" alt="Original gorilla radioactive dinosaur meme" width={720} height={463} index="03" note="THE ORIGINAL WARNING / HE WILL TRY HIS BEST" />
          <div className={`machine machine-reactor reactor-level-${reactorLevel}`}>
            <div className="compare-label"><span>INTERACTIVE 3D REMAKE</span><span>{levels[reactorLevel]}</span></div>
            <MemeDiorama variant="reactor" accent="#b7ff2f" motion={reactorLevel} ariaLabel={`3D radioactive dinosaur reactor at ${levels[reactorLevel]} level. Drag to orbit and tap to escalate.`} onAction={() => setReactorLevel((level) => (level + 1) % levels.length)} />
            <p className="machine-tip">CORE STATUS / {levels[reactorLevel]} · TAP TO ESCALATE</p>
          </div>
        </div>
      </section>

      <section className="meme-room room-brain" id="brain">
        <div className="room-heading">
          <div className="room-copy">
            <p className="room-index">04 / PLACEBO PROTOCOL</p>
            <h2>Ask brain.<br /><em>Ignore brain.</em></h2>
            <p>The flat cartoon becomes a complete low-poly decision chamber with two characters, expressive eyes, floating pills, and one unhelpful brain.</p>
          </div>
          <div className="brain-controls">
            <button className="pill-button" type="button" onClick={() => setPillDoses((dose) => dose + 1)}>TAKE PILL <span>CAPSULE {String(pillDoses + 1).padStart(2, "0")}</span></button>
            <p className="brain-response" aria-live="polite">{reactions[pillDoses % reactions.length]}</p>
          </div>
        </div>
        <div className="meme-comparison">
          <MemeReference src="/interactable-memes/source/brain-pill.png" alt="Original brain and pill cartoon meme" width={500} height={488} index="04" note="THE ORIGINAL DECISION / MEDICALLY QUESTIONABLE" />
          <div className={`machine machine-brain dose-${Math.min(pillDoses, 3)}`}>
            <div className="compare-label"><span>INTERACTIVE 3D REMAKE</span><span>{pillDoses} DOSE{pillDoses === 1 ? "" : "S"}</span></div>
            <MemeDiorama variant="brain" accent="#ff3158" motion={pillDoses} ariaLabel="3D brain and pill chamber. Drag to orbit and tap to take another pill." onAction={() => setPillDoses((dose) => dose + 1)} />
            <p className="machine-tip">TAP TO PRESCRIBE · EYES FOLLOW POINTER · PILLS HAVE GRAVITY-ISH</p>
          </div>
        </div>
      </section>

      <section className="meme-room room-demo" id="demo">
        <div className="room-heading">
          <div className="room-copy">
            <p className="room-index">05 / CLIENT DEMO STABILIZER</p>
            <h2>Product not ready.<br /><em>Client is.</em></h2>
            <p>The new prop-plane asset sits on a fully modeled excavator rig. Tap to increase panic while the boom and aircraft fight the laws of demos.</p>
          </div>
          <div className="demo-controls">
            <button className="demo-trigger" type="button" onClick={() => setDemoLevel((level) => (level + 1) % demoStates.length)}>SHIP THE DEMO ANYWAY <span>↗</span></button>
            <p className="demo-status" aria-live="polite">{demoStates[demoLevel]}</p>
          </div>
        </div>
        <div className="meme-comparison">
          <MemeReference src="/interactable-memes/source/client-demo.png" alt="Original excavator holding an airplane meme" width={1453} height={1094} index="05" note="THE ORIGINAL WORKAROUND / PLEASE DO NOT ASK QUESTIONS" />
          <div className={`machine machine-demo demo-level-${demoLevel}`}>
            <div className="compare-label"><span>INTERACTIVE 3D REMAKE</span><span>{12 + demoLevel * 22}% STABLE</span></div>
            <MemeDiorama variant="demo" accent="#ffcc22" motion={demoLevel} ariaLabel="3D excavator holding up an airplane. Drag to orbit and tap to make the client demo shakier." onAction={() => setDemoLevel((level) => (level + 1) % demoStates.length)} />
            <p className="machine-tip">DRAG FOR PROOF · TAP FOR CONFIDENCE · NEVER REFRESH</p>
          </div>
        </div>
      </section>

      <footer className="manifesto" id="about">
        <p className="manifesto-index">06 / FIELD NOTES</p>
        <h2>The reference stays visible.<br /><span>The 3D joke has to earn it.</span></h2>
        <div className="manifesto-grid">
          <p>Every room now makes the comparison explicit: the supplied meme on one side, its real-time low-poly reconstruction on the other. No pretending a textured screenshot is a 3D character.</p>
          <p className="aside-copy">BUILT WITH THREE.JS + GLB<br />POINTERS + TOUCHSCREENS WELCOME<br /><strong>DEPTH: FINALLY OBVIOUS</strong></p>
        </div>
        <p className="asset-credits">3D assets: <a href="https://poly.pizza/m/JFrLIKqvCH">Business Man</a>, <a href="https://poly.pizza/m/qKICY6xla2">Cat</a>, and <a href="https://poly.pizza/m/UYtneO5FpF">T‑Rex</a> by Quaternius (CC0); <a href="https://poly.pizza/m/bmfQ1j9CeO2">Gorilla</a> by Poly by Google and <a href="https://poly.pizza/m/7cvx6ex-xfL">Small Airplane</a> by Vojtěch Balák (CC BY 3.0). Other characters, hands, sets, and machinery modeled in Three.js.</p>
        <a className="back-to-top" href="#top">RUN THE COMPARISON AGAIN ↑</a>
      </footer>
    </main>
  );
}
