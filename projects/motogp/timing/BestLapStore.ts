import { TIMING } from '../config';

/** Best-lap persistence. Tolerates missing/broken localStorage silently. */
export class BestLapStore {
  private key: string;

  constructor(key = TIMING.bestLapStorageKey) {
    this.key = key;
  }

  load(): number | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const ms = Number(JSON.parse(raw));
      return Number.isFinite(ms) && ms > 0 ? ms : null;
    } catch {
      return null;
    }
  }

  save(ms: number): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(Math.round(ms)));
    } catch {
      // Private mode / quota — best lap just won't persist.
    }
  }
}
