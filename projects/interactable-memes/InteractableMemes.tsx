"use client";

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
          <a href="#standoff">01</a>
          <a href="#scratch">02</a>
          <a href="#reactor">03</a>
          <a href="#brain">04</a>
          <a href="#demo">05</a>
        </nav>
        <button className="reset-button" type="button" onClick={resetAll}>RESET THE LAB ↻</button>
      </header>

      <section className="hero" id="top">
        <div className="hero-noise" aria-hidden="true" />
        <div className="hero-copy">
          <p className="eyebrow"><span>LIVE 3D</span> Five experiments in serious nonsense</p>
          <h1>MEMES YOU<br /><em>CAN ORBIT.</em></h1>
          <p className="intro">
            Five meme casts rebuilt as actual Three.js characters, creatures,
            vehicles, sets, and props—with depth, animation, and inadvisable controls.
          </p>
          <a className="enter-button" href="#standoff">ENTER THE 3D LAB <span>↓</span></a>
        </div>

        <div className="hero-character-stage" aria-label="Interactive 3D character preview">
          <MemeDiorama
            variant="crossfire"
            accent="#d8ff38"
            hero
            ariaLabel="Interactive 3D suited office character surrounded by finger guns. Drag to orbit."
          />
          <nav className="hero-scene-nav" aria-label="Jump to a 3D meme scene">
            <a href="#standoff">01 MAN</a><a href="#scratch">02 CAT</a><a href="#reactor">03 BEASTS</a><a href="#brain">04 BRAIN</a><a href="#demo">05 CHAOS</a>
          </nav>
        </div>

        <div className="hero-footer" aria-hidden="true">
          <span>DRAG EVERY SCENE TO ORBIT</span><span>REAL DEPTH · FAKE PHYSICS · FIVE BAD IDEAS</span>
        </div>
      </section>

      <section className="meme-room room-standoff" id="standoff">
        <div className="room-copy">
          <p className="room-index">01 / 3D OFFICE CROSSFIRE</p>
          <h2>Finger guns.<br /><em>Real depth.</em></h2>
          <p>Drag the entire standoff through space. Tap the scene to return fire and recoil every 3D hand.</p>
          <div className="scoreboard" aria-live="polite">
            <span>SHOTS FIRED</span><strong>{String(shotCount).padStart(2, "0")}</strong>
          </div>
        </div>
        <div className="machine machine-standoff">
          <div className="machine-label"><span>THREE.JS GESTURE RECONSTRUCTION</span><span>ARMED</span></div>
          <MemeDiorama
            variant="crossfire"
            accent="#d8ff38"
            motion={shotCount}
            ariaLabel="3D finger-gun standoff. Drag to orbit and tap to fire."
            onAction={() => setShotCount((count) => count + 1)}
          />
          <p className="machine-tip">3D ACTION / ORBIT, AIM, FIRE, QUESTION MANAGEMENT</p>
        </div>
      </section>

      <section className="meme-room room-scratch" id="scratch">
        <div className="room-copy">
          <p className="room-index">02 / 3D VINYL PURR-SUASION</p>
          <h2>Scratch the<br /><em>cat-alogue.</em></h2>
          <p>Orbit the booth, spin the floating record, and make the 3D equalizer work much harder than the DJ.</p>
          <div className="dj-controls">
            <button type="button" onClick={() => setIsPlaying((playing) => !playing)}>
              {isPlaying ? "PAUSE SET Ⅱ" : "PLAY SET ▶"}
            </button>
            <label>
              <span>BPM <b>{bpm}</b></span>
              <input type="range" min="72" max="180" value={bpm} onChange={(event) => setBpm(Number(event.target.value))} aria-label="DJ set tempo" />
            </label>
          </div>
        </div>
        <div className="machine machine-scratch">
          <div className="machine-label"><span>FELINE FREQUENCY MODULATOR / WEBGL</span><span>{isPlaying ? `${bpm} BPM` : "PAUSED"}</span></div>
          <MemeDiorama
            variant="scratch"
            accent="#d8ff38"
            motion={isPlaying ? 1 : 0}
            speed={bpm}
            ariaLabel="3D cat DJ booth. Drag to orbit and scratch; tap to play or pause."
            onAction={() => setIsPlaying((playing) => !playing)}
            onDragStart={() => setIsPlaying(false)}
          />
          <p className="machine-tip">3D ACTION / DRAG THE DECK · TAP TO DROP THE BEAT</p>
        </div>
      </section>

      <section className="meme-room room-reactor" id="reactor">
        <div className="room-copy">
          <p className="room-index">03 / 3D EFFORT REACTOR</p>
          <h2>Try your<br /><em>absolute best.</em></h2>
          <p>Raise the reactor power and inspect the radioactive meme core from angles nature never intended.</p>
          <button className="reactor-trigger" type="button" onClick={() => setReactorLevel((level) => (level + 1) % levels.length)}>
            PUSH FOR MORE EFFORT <span>＋</span>
          </button>
        </div>
        <div className={`machine machine-reactor reactor-level-${reactorLevel}`}>
          <div className="machine-label"><span>UNLICENSED 3D MOTIVATION CHAMBER</span><span>{levels[reactorLevel]}</span></div>
          <MemeDiorama
            variant="reactor"
            accent="#d8ff38"
            motion={reactorLevel}
            ariaLabel={`3D radioactive dinosaur reactor at ${levels[reactorLevel]} level. Drag to orbit and tap to escalate.`}
            onAction={() => setReactorLevel((level) => (level + 1) % levels.length)}
          />
          <p className="machine-tip">CORE STATUS / {levels[reactorLevel]} · TAP TO ESCALATE</p>
        </div>
      </section>

      <section className="meme-room room-brain" id="brain">
        <div className="room-copy">
          <p className="room-index">04 / 3D PLACEBO PROTOCOL</p>
          <h2>Ask brain.<br /><em>Ignore brain.</em></h2>
          <p>Rotate the decision chamber and prescribe another floating 3D capsule with absolutely no effect.</p>
          <button className="pill-button" type="button" onClick={() => setPillDoses((dose) => dose + 1)}>
            TAKE PILL <span>CAPSULE {String(pillDoses + 1).padStart(2, "0")}</span>
          </button>
          <p className="brain-response" aria-live="polite">{reactions[pillDoses % reactions.length]}</p>
        </div>
        <div className={`machine machine-brain dose-${Math.min(pillDoses, 3)}`}>
          <div className="machine-label"><span>VOLUMETRIC DECISION OVERRIDE</span><span>{pillDoses} DOSE{pillDoses === 1 ? "" : "S"}</span></div>
          <MemeDiorama
            variant="brain"
            accent="#ef334e"
            motion={pillDoses}
            ariaLabel="3D brain and pill chamber. Drag to orbit and tap to take another pill."
            onAction={() => setPillDoses((dose) => dose + 1)}
          />
          <p className="machine-tip">SIDE EFFECTS / VOLUMETRIC CONFIDENCE, DEPTH, MORE MEMES</p>
        </div>
      </section>

      <section className="meme-room room-demo" id="demo">
        <div className="room-copy">
          <p className="room-index">05 / CLIENT DEMO STABILIZER</p>
          <h2>Product not ready.<br /><em>Client is.</em></h2>
          <p>Hold the 3D plane together with an excavator, confidence, and increasingly aggressive demo theatre.</p>
          <button className="demo-trigger" type="button" onClick={() => setDemoLevel((level) => (level + 1) % demoStates.length)}>
            SHIP THE DEMO ANYWAY <span>↗</span>
          </button>
          <p className="demo-status" aria-live="polite">{demoStates[demoLevel]}</p>
        </div>
        <div className={`machine machine-demo demo-level-${demoLevel}`}>
          <div className="machine-label"><span>PRODUCTION READINESS SIMULATOR / ALLEGEDLY 3D</span><span>{12 + demoLevel * 22}% STABLE</span></div>
          <MemeDiorama
            variant="demo"
            accent="#ffdc3d"
            motion={demoLevel}
            ariaLabel="3D excavator holding up an airplane. Drag to orbit and tap to make the client demo shakier."
            onAction={() => setDemoLevel((level) => (level + 1) % demoStates.length)}
          />
          <p className="machine-tip">CLIENT MODE / TAP TO ADD CONFIDENCE · NEVER REFRESH</p>
        </div>
      </section>

      <footer className="manifesto" id="about">
        <p className="manifesto-index">06 / FIELD NOTES</p>
        <h2>Memes were never meant to sit still.<br /><span>Now they refuse to stay flat.</span></h2>
        <div className="manifesto-grid">
          <p>Five references entered the lab. Their characters left as modeled, lit, orbitable 3D scenes with controls, questionable physics, and a much stronger sense of agency.</p>
          <p className="aside-copy">BUILT WITH THREE.JS<br />POINTERS + TOUCHSCREENS WELCOME<br /><strong>DEPTH: UNNECESSARY</strong></p>
        </div>
        <p className="asset-credits">
          3D character assets: <a href="https://poly.pizza/m/JFrLIKqvCH">Business Man</a>, <a href="https://poly.pizza/m/qKICY6xla2">Cat</a>, and <a href="https://poly.pizza/m/UYtneO5FpF">T-Rex</a> by Quaternius (CC0); <a href="https://poly.pizza/m/bmfQ1j9CeO2">Gorilla</a> by Poly by Google (CC BY 3.0). Other characters and vehicles modeled in Three.js.
        </p>
        <a className="back-to-top" href="#top">RUN THE EXPERIMENT AGAIN ↑</a>
      </footer>
    </main>
  );
}
