import { MemeStage } from "./MemeStage";

export default function Home() {
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#stage" aria-label="Interactable Memes home">
          <span className="brand-mark">iM</span>
          <span>INTERACTABLE<br />MEMES</span>
        </a>
        <div className="issue">ISSUE 001&nbsp; / &nbsp;INTERNET OBJECTS</div>
        <a className="about-link" href="#about">WHAT IS THIS? ↘</a>
      </header>

      <section className="hero" id="stage">
        <div className="hero-copy">
          <p className="eyebrow">A tiny experiment in serious nonsense</p>
          <h1>MEMES YOU<br /><em>CAN TOUCH.</em></h1>
          <p className="intro">
            The internet&apos;s flattest art form, given depth, wobble, and
            absolutely unnecessary physics.
          </p>
        </div>
        <MemeStage />
        <div className="scroll-note" aria-hidden="true">
          <span>DRAG TO ORBIT</span>
          <span className="scroll-arrow">↗</span>
        </div>
      </section>

      <section className="manifesto" id="about">
        <p className="manifesto-index">01 / WHY</p>
        <h2>
          Memes were never meant to sit still.<br />
          <span>So we taught them some moves.</span>
        </h2>
        <div className="manifesto-grid">
          <p>
            Tilt the cards. Poke the punchlines. Remix the mood. Every object in
            this little gallery reacts to you, because passive scrolling has had
            a very long run.
          </p>
          <p className="aside-copy">
            MADE WITH THREE.JS<br />
            AND POOR JUDGEMENT<br />
            <strong>EST. 2026</strong>
          </p>
        </div>
      </section>
    </main>
  );
}
