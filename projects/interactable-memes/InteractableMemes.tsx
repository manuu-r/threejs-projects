"use client";

import Image from "next/image";
import { useState } from "react";
import { MemeDiorama } from "./MemeDiorama";

const levels = ["NOTICED", "EYE CONTACT", "AWKWARD", "VERY AWKWARD"];
const reactions = [
  "BRAIN: No.",
  "BRAIN: Fine, but make it dramatic.",
  "BRAIN: You son of a bitch, I'm in.",
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
        <Image className="hero-art" src="/interactable-memes/og-v5.png" alt="Interactable Memes ensemble in the polished low-poly studio art direction" fill priority sizes="100vw" />
        <div className="hero-shade" aria-hidden="true" />
        <div className="hero-noise" aria-hidden="true" />
        <div className="hero-copy">
          <p className="eyebrow"><span>LIVE 3D</span> The original joke, now with polygons</p>
          <h1>THE MEME.<br /><em>THEN THE WORLD.</em></h1>
          <p className="intro">See every source image beside its Blender-built low-poly remake. Same punchline. Studio lighting, named moving parts, real shadows, and unnecessary depth.</p>
          <a className="enter-button" href="#standoff">COMPARE THE FIRST MEME <span>↓</span></a>
        </div>
        <div className="hero-target-note"><span>3D ART DIRECTION</span><strong>THIS ENERGY → EVERY SCENE</strong></div>
        <div className="hero-footer" aria-hidden="true"><span>ORIGINAL / 3D / INTERACTIVE</span><span>DRAG · TAP · MAKE THE JOKE WORSE</span></div>
      </section>

      <section className="meme-room room-standoff" id="standoff" data-room="01">
        <div className="room-heading">
          <div className="room-copy">
            <p className="room-index">01 / OFFICE CROSSFIRE</p>
            <h2>Finger guns.<br /><em>Real depth.</em></h2>
            <p>The flat stand-ins are gone. The remake now uses four skinned anatomical hand meshes and a rigged, properly proportioned businessman in a real suit.</p>
          </div>
          <div className="scoreboard" aria-live="polite"><span>SHOTS FIRED</span><strong>{String(shotCount).padStart(2, "0")}</strong></div>
        </div>
        <div className="meme-comparison">
          <MemeReference src="/interactable-memes/source/finger-guns.png" alt="Original office finger-gun standoff meme" width={708} height={534} index="01" note="THE ORIGINAL FRAME / MAXIMUM CORPORATE TENSION" />
          <div className="machine machine-standoff">
            <div className="compare-label"><span>INTERACTIVE 3D REMAKE</span><span>01B / ARMED</span></div>
            <MemeDiorama variant="crossfire" accent="#d8ff38" motion={shotCount} orbitable={false} ariaLabel="Static 3D finger-gun standoff. Click to fire and knock down the suited man." onAction={() => setShotCount((count) => count + 1)} />
            <p className="machine-tip">CLICK TO FIRE · CAMERA LOCKED · RESET TO STAND HIM UP</p>
          </div>
        </div>
      </section>

      <section className="meme-room room-scratch" id="scratch" data-room="02">
        <div className="room-heading">
          <div className="room-copy">
            <p className="room-index">02 / VINYL PURR-SUASION</p>
            <h2>Scratch the<br /><em>cat-alogue.</em></h2>
            <p>The reference cat becomes a custom low-poly DJ with pixel shades, articulated paws, twin decks, speakers, brickwork, and a physical equalizer.</p>
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

      <section className="meme-room room-reactor" id="reactor" data-room="03">
        <div className="room-heading">
          <div className="room-copy">
            <p className="room-index">03 / AWKWARD STAREDOWN</p>
            <h2>Try your best.<br /><em>Avoid eye contact.</em></h2>
            <p>No glowing core and no invented reactor. Just the actual gorilla and T‑Rex meshes locked in the deeply uncomfortable eye contact the joke deserves.</p>
          </div>
          <button className="reactor-trigger" type="button" onClick={() => setReactorLevel((level) => (level + 1) % levels.length)}>MAKE THE STARE WEIRDER <span>＋</span></button>
        </div>
        <div className="meme-comparison">
          <MemeReference src="/interactable-memes/source/radioactive-dinosaur.png" alt="Original gorilla radioactive dinosaur meme" width={720} height={463} index="03" note="GUYS I'M GONNA TRY MY BEST / BUT IT'S A F*CKING RADIOACTIVE DINOSAUR" />
          <div className={`machine machine-reactor reactor-level-${reactorLevel}`}>
            <div className="compare-label"><span>INTERACTIVE 3D REMAKE</span><span>{levels[reactorLevel]}</span></div>
            <div className="scene-meme-copy scene-meme-copy-reactor" aria-hidden="true">
              <strong>GUYS I'M GONNA TRY MY BEST</strong>
              <strong>BUT IT'S A F*CKING RADIOACTIVE DINOSAUR</strong>
            </div>
            <MemeDiorama variant="reactor" accent="#b7ff2f" motion={reactorLevel} ariaLabel={`3D gorilla and dinosaur stare-down at ${levels[reactorLevel]} level. Drag to orbit and tap to intensify the eye contact.`} onAction={() => setReactorLevel((level) => (level + 1) % levels.length)} />
            <p className="machine-tip">STARE STATUS / {levels[reactorLevel]} · TAP TO MAKE IT WORSE</p>
          </div>
        </div>
      </section>

      <section className="meme-room room-brain" id="brain" data-room="04">
        <div className="room-heading">
          <div className="room-copy">
            <p className="room-index">04 / PLACEBO PROTOCOL</p>
            <h2>Ask brain.<br /><em>Ignore brain.</em></h2>
            <p>The flat cartoon becomes a portal-lit decision chamber with two modeled characters, expressive eyes, floating capsules, and one unhelpful brain.</p>
          </div>
          <div className="brain-controls">
            <button className="pill-button" type="button" onClick={() => setPillDoses((dose) => dose + 1)}>TAKE PILL <span>CAPSULE {String(pillDoses + 1).padStart(2, "0")}</span></button>
            <p className="brain-response" aria-live="polite">{reactions[pillDoses % reactions.length]}</p>
          </div>
        </div>
        <div className="meme-comparison">
          <MemeReference src="/interactable-memes/source/brain-pill.png" alt="Original brain and pill cartoon meme" width={500} height={488} index="04" note={'Me: "heal my disease" / Brain: "No" / Me: *takes pill with no effect* / Brain:'} />
          <div className={`machine machine-brain dose-${Math.min(pillDoses, 3)}`}>
            <div className="compare-label"><span>INTERACTIVE 3D REMAKE</span><span>{pillDoses} DOSE{pillDoses === 1 ? "" : "S"}</span></div>
            <div className="scene-meme-copy scene-meme-copy-brain" aria-hidden="true">
              <strong>{'Me: "heal my disease"'}</strong>
              <strong>{'Brain: "No"'}</strong>
              <strong>Me: *takes pill with no effect*</strong>
              <strong>Brain:</strong>
              <b>You son of a bitch, I'm in</b>
            </div>
            <MemeDiorama variant="brain" accent="#ff3158" motion={pillDoses} ariaLabel="3D brain and pill chamber. Drag to orbit and tap to take another pill." onAction={() => setPillDoses((dose) => dose + 1)} />
            <p className="machine-tip">TAP TO PRESCRIBE · EYES FOLLOW POINTER · PILLS HAVE GRAVITY-ISH</p>
          </div>
        </div>
      </section>

      <section className="meme-room room-demo" id="demo" data-room="05">
        <div className="room-heading">
          <div className="room-copy">
            <p className="room-index">05 / CLIENT DEMO STABILIZER</p>
            <h2>Product not ready.<br /><em>Client is.</em></h2>
            <p>The licensed airplane is physically cradled in the excavator bucket. The boom now carries it, swings it, and spins the whole product demo around.</p>
          </div>
          <div className="demo-controls">
            <button className="demo-trigger" type="button" onClick={() => setDemoLevel((level) => (level + 1) % demoStates.length)}>SHIP THE DEMO ANYWAY <span>↗</span></button>
            <p className="demo-status" aria-live="polite">{demoStates[demoLevel]}</p>
          </div>
        </div>
        <div className="meme-comparison">
          <MemeReference src="/interactable-memes/source/client-demo.png" alt="Original excavator holding an airplane meme" width={1453} height={1094} index="05" note="WHEN CLIENT WANTS DEMO / BUT PRODUCT ISN'T READY" />
          <div className={`machine machine-demo demo-level-${demoLevel}`}>
            <div className="compare-label"><span>INTERACTIVE 3D REMAKE</span><span>{12 + demoLevel * 22}% STABLE</span></div>
            <div className="scene-meme-copy scene-meme-copy-demo" aria-hidden="true">
              <strong>WHEN CLIENT WANTS DEMO</strong>
              <strong>BUT PRODUCT ISN'T READY</strong>
            </div>
            <MemeDiorama variant="demo" accent="#ffcc22" motion={demoLevel} ariaLabel="3D excavator gripping and spinning an airplane. Drag to orbit and tap to spin the client demo faster." onAction={() => setDemoLevel((level) => (level + 1) % demoStates.length)} />
            <p className="machine-tip">EXCAVATOR GRIP: LOCKED · TAP TO SPIN THE DEMO FASTER</p>
          </div>
        </div>
      </section>

      <footer className="manifesto" id="about">
        <p className="manifesto-index">06 / FIELD NOTES</p>
        <h2>The reference stays visible.<br /><span>The 3D joke has to earn it.</span></h2>
        <div className="manifesto-grid">
          <p>Every room keeps the supplied meme visible beside its real-time reconstruction. The models, sets, props, and rendered loading posters all come from the same Blender art pipeline.</p>
          <p className="aside-copy">MODELED IN BLENDER · EXPORTED AS GLB<br />ANIMATED WITH THREE.JS<br />POINTERS + TOUCHSCREENS WELCOME<br /><strong>DEPTH: FINALLY OBVIOUS</strong></p>
        </div>
        <p className="asset-credits">All five interactive dioramas are original low-poly assets modeled and rendered in Blender, then exported as optimized GLB scenes with named parts for live browser animation.</p>
        <a className="back-to-top" href="#top">RUN THE COMPARISON AGAIN ↑</a>
      </footer>
    </main>
  );
}
