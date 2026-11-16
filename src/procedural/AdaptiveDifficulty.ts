/** Minimal storage interface so this module never touches DOM globals directly. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class MemoryStore implements KeyValueStore {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

/** Resolves localStorage when present (browser), else an in-memory fallback (tests/bots). */
export function defaultStore(): KeyValueStore {
  try {
    const ls = (globalThis as { localStorage?: KeyValueStore }).localStorage;
    if (ls) {
      ls.getItem('__probe__');
      return ls;
    }
  } catch {
    /* storage blocked */
  }
  return new MemoryStore();
}

export const FAIL_STREAK_KEY = 'candy.failStreak';
export const ASSIST_THRESHOLD = 2;
/** Extra probability of a helpful (neighbour-matching) spawn in Assist Mode. */
export const ASSIST_BOOST = 0.15;

export class AdaptiveDifficulty {
  constructor(private readonly store: KeyValueStore = defaultStore()) {}

  get failStreak(): number {
    try {
      const n = parseInt(this.store.getItem(FAIL_STREAK_KEY) ?? '0', 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  private set failStreak(v: number) {
    try {
      this.store.setItem(FAIL_STREAK_KEY, String(Math.max(0, v)));
    } catch {
      /* ignore storage errors */
    }
  }

  recordFail(): number {
    this.failStreak = this.failStreak + 1;
    return this.failStreak;
  }

  /** Winning resets the streak. */
  recordWin(): void {
    this.failStreak = 0;
  }

  get assistActive(): boolean {
    return this.failStreak >= ASSIST_THRESHOLD;
  }

  /** Value to feed into GridEngine's `assistProbability`. */
  get assistProbability(): number {
    return this.assistActive ? ASSIST_BOOST : 0;
  }
}
