import type { RNG } from '../core/Types';

/** Deterministic Mulberry32 PRNG. Same seed => same sequence, always. */
export class SeededRNG implements RNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Stable per-level generator: Level N always yields the same stream. */
  static forLevel(level: number, salt = 0): SeededRNG {
    return new SeededRNG(levelSeed(level, salt));
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Integer in [min, max] inclusive. */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

/** Integer hash (murmur-style finalizer) so adjacent levels get unrelated seeds. */
export function levelSeed(level: number, salt = 0): number {
  let h = (Math.imul(level | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b) ^ 0x27d4eb2f) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
