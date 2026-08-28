"use client";

import { useEffect, useRef, useState } from "react";
import { startMotoGpGame } from "./GameRuntime";

interface SharedGameSession {
  refs: number;
  promise: Promise<void>;
  dispose?: () => void;
  disposeWhenReady: boolean;
  disposeTimer?: number;
}

/**
 * React development remounts effects once to expose unsafe side effects. The
 * circuit and bike load asynchronously, so a plain effect can briefly create
 * two WebGL render loops in the same viewport. Share that in-flight startup
 * and defer zero-reference disposal by one task; the remount adopts the same
 * renderer before it can be torn down or duplicated.
 */
const gameSessions = new WeakMap<HTMLElement, SharedGameSession>();

function retainGameSession(host: HTMLElement): SharedGameSession {
  let session = gameSessions.get(host);
  if (!session) {
    const created: SharedGameSession = {
      refs: 0,
      promise: Promise.resolve(),
      disposeWhenReady: false,
    };
    created.promise = startMotoGpGame(host)
      .then((dispose) => {
        created.dispose = dispose;
        if (created.disposeWhenReady) {
          created.dispose();
          created.dispose = undefined;
        }
      })
      .catch((error: unknown) => {
        gameSessions.delete(host);
        throw error;
      });
    session = created;
    gameSessions.set(host, created);
  }
  session.refs++;
  session.disposeWhenReady = false;
  if (session.disposeTimer !== undefined) window.clearTimeout(session.disposeTimer);
  return session;
}

function releaseGameSession(host: HTMLElement, session: SharedGameSession): void {
  session.refs = Math.max(0, session.refs - 1);
  if (session.refs > 0) return;
  session.disposeTimer = window.setTimeout(() => {
    if (session.refs > 0) return;
    gameSessions.delete(host);
    if (session.dispose) {
      session.dispose();
      session.dispose = undefined;
    } else {
      session.disposeWhenReady = true;
    }
  }, 0);
}

export default function MotoGpGame() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let mounted = true;
    const session = retainGameSession(host);
    void session.promise
      .catch((reason: unknown) => {
        console.error("MotoGP game failed to start", reason);
        if (mounted) {
          setError(reason instanceof Error ? reason.message : "The game could not be loaded.");
        }
      });

    return () => {
      mounted = false;
      releaseGameSession(host, session);
    };
  }, []);

  return (
    <main className="motogp-game">
      <div ref={hostRef} className="motogp-game__viewport" aria-label="MotoGP time trial game">
        {error ? (
          <p className="motogp-game__error" role="alert">
            Unable to start MotoGP Time Trial: {error}
          </p>
        ) : (
          <p className="motogp-game__status" role="status">
            Loading MotoGP Time Trial…
          </p>
        )}
      </div>
      <a
        className="motogp-x-follow"
        href="https://x.com/manudotdev?ref_src=twsrc%5Etfw"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Follow @manudotdev on X for more Three.js experiments"
      >
        <span className="motogp-x-follow__mark" aria-hidden="true">𝕏</span>
        <span className="motogp-x-follow__copy"><small>FOLLOW</small><strong>@MANUDOTDEV</strong></span>
        <span className="motogp-x-follow__arrow" aria-hidden="true">↗</span>
      </a>
      <p className="motogp-game__controls">
        <kbd>W</kbd>/<kbd>↑</kbd> accelerate · <kbd>S</kbd>/<kbd>↓</kbd> brake · <kbd>A</kbd>/<kbd>D</kbd> steer · <kbd>R</kbd> recover · <kbd>C</kbd> rear/rider view
      </p>
    </main>
  );
}
