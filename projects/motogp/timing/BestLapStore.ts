import { TIMING } from '../config.ts';

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

  loadHistory(): number[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(TIMING.lapListStorageKey) ?? '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
        .slice(-50);
    } catch {
      return [];
    }
  }

  appendHistory(ms: number): void {
    try {
      const history = this.loadHistory();
      history.push(Math.round(ms));
      localStorage.setItem(TIMING.lapListStorageKey, JSON.stringify(history.slice(-50)));
    } catch {
      // Persistent history is optional when storage is unavailable.
    }
  }
}
