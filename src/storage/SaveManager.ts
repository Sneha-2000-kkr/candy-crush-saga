import { AdaptiveDifficulty, defaultStore, KeyValueStore } from '../procedural/AdaptiveDifficulty';

const KEY = 'candy.save.v1';

export interface SaveData {
  /** Highest level the player may start. */
  unlocked: number;
  /** Best stars (1-3) per completed level. */
  stars: Record<number, number>;
  muted: boolean;
}

/** localStorage wrapper for level progress, stars, mute and the failStreak (via AdaptiveDifficulty). */
export class SaveManager {
  readonly adaptive: AdaptiveDifficulty;
  private data: SaveData;

  constructor(private readonly store: KeyValueStore = defaultStore()) {
    this.adaptive = new AdaptiveDifficulty(store);
    this.data = this.load();
  }

  private load(): SaveData {
    const fresh: SaveData = { unlocked: 1, stars: {}, muted: false };
    try {
      const raw = this.store.getItem(KEY);
      if (!raw) return fresh;
      const p = JSON.parse(raw) as Partial<SaveData>;
      return {
        unlocked: Number.isInteger(p.unlocked) && (p.unlocked as number) >= 1 ? (p.unlocked as number) : 1,
        stars: p.stars && typeof p.stars === 'object' ? p.stars : {},
        muted: !!p.muted,
      };
    } catch {
      return fresh;
    }
  }

  private persist(): void {
    try {
      this.store.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* quota / blocked storage: keep playing in memory */
    }
  }

  get unlocked(): number {
    return this.data.unlocked;
  }

  starsFor(level: number): number {
    return this.data.stars[level] ?? 0;
  }

  get muted(): boolean {
    return this.data.muted;
  }

  setMuted(m: boolean): void {
    this.data.muted = m;
    this.persist();
  }

  get failStreak(): number {
    return this.adaptive.failStreak;
  }

  completeLevel(level: number, stars: number): void {
    this.data.stars[level] = Math.max(this.starsFor(level), stars);
    this.data.unlocked = Math.max(this.data.unlocked, level + 1);
    this.adaptive.recordWin();
    this.persist();
  }

  failLevel(): number {
    return this.adaptive.recordFail();
  }
}

export const save = new SaveManager();
