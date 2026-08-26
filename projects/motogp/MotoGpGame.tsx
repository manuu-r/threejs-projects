"use client";

import { useEffect, useRef, useState } from "react";
import { startMotoGpGame } from "./GameRuntime";

export default function MotoGpGame() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let mounted = true;
    let dispose: (() => void) | undefined;

    void startMotoGpGame(host)
      .then((cleanup) => {
        if (mounted) dispose = cleanup;
        else cleanup();
      })
      .catch((reason: unknown) => {
        console.error("MotoGP game failed to start", reason);
        if (mounted) {
          setError(reason instanceof Error ? reason.message : "The game could not be loaded.");
        }
      });

    return () => {
      mounted = false;
      dispose?.();
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
      <p className="motogp-game__controls">
        <kbd>W</kbd>/<kbd>↑</kbd> accelerate · <kbd>S</kbd>/<kbd>↓</kbd> brake · <kbd>A</kbd>/<kbd>D</kbd> steer · <kbd>R</kbd> recover · <kbd>C</kbd> rear/rider view
      </p>
    </main>
  );
}
