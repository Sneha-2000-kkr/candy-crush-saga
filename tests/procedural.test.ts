import { describe, expect, it } from 'vitest';
import {
  AdaptiveDifficulty,
  ASSIST_BOOST,
  FAIL_STREAK_KEY,
  MemoryStore,
} from '../src/procedural/AdaptiveDifficulty';
import { createEngineForLevel, difficultyTag, difficultyValue, generateLevel } from '../src/procedural/LevelGenerator';
import { SeededRNG } from '../src/procedural/SeededRNG';

describe('SeededRNG', () => {
  it('is deterministic and level-stable', () => {
    const a = new SeededRNG(42);
    const b = new SeededRNG(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    expect(SeededRNG.forLevel(7).next()).toBe(SeededRNG.forLevel(7).next());
    expect(SeededRNG.forLevel(7).next()).not.toBe(SeededRNG.forLevel(8).next());
  });
  it('produces values in [0,1)', () => {
    const r = new SeededRNG(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('LevelGenerator', () => {
  it('Level N is identical on every call (retry-safe), including the starting board', () => {
    for (const n of [1, 6, 12, 25, 137, 1000]) {
      expect(generateLevel(n)).toEqual(generateLevel(n));
      const a = createEngineForLevel(generateLevel(n));
      const b = createEngineForLevel(generateLevel(n));
      expect(a.board.cells).toEqual(b.board.cells);
    }
  });

  it('sawtooth: every 5th hard, every 10th boss, then a relief level', () => {
    expect(difficultyTag(5)).toBe('hard');
    expect(difficultyTag(10)).toBe('boss');
    expect(difficultyTag(6)).toBe('relief');
    expect(difficultyTag(11)).toBe('relief');
    expect(difficultyTag(1)).toBe('normal');
    for (let n = 5; n <= 500; n += 5) {
      expect(difficultyValue(n)).toBeGreaterThan(difficultyValue(n + 1));
    }
  });

  it('introduces features progressively', () => {
    const l1 = generateLevel(1);
    expect(l1.numColors).toBe(5);
    expect(l1.mask.flat().every((v) => v === 1)).toBe(true);
    expect(l1.ice.flat().every((v) => v === 0)).toBe(true);

    let sawHole = false;
    let sawIce = false;
    for (let n = 6; n <= 11; n++) {
      const l = generateLevel(n);
      expect(l.numColors).toBe(6);
      sawHole ||= l.mask.flat().some((v) => v === 0);
      sawIce ||= l.ice.flat().some((v) => v === 1);
      expect(l.honey.flat().every((v) => v === 0)).toBe(true);
    }
    expect(sawHole).toBe(true);
    expect(sawIce).toBe(true);

    let sawHoney = false;
    for (let n = 12; n <= 30; n++) sawHoney ||= generateLevel(n).honey.flat().some((v) => v === 1);
    expect(sawHoney).toBe(true);

    let sawIce2 = false;
    for (let n = 20; n <= 60; n++) {
      const l = generateLevel(n);
      sawIce2 ||= l.ice.flat().some((v) => v === 2);
      expect(l.mask.flat().length).toBe(64);
    }
    expect(sawIce2).toBe(true);
    for (let n = 1; n < 20; n++) expect(generateLevel(n).ice.flat().every((v) => v <= 1)).toBe(true);
  });

  it('cutouts are symmetric (left/right) and ice/honey sit only on active tiles', () => {
    for (let n = 6; n <= 120; n++) {
      const l = generateLevel(n);
      for (let r = 0; r < l.rows; r++) {
        for (let c = 0; c < l.cols; c++) {
          expect(l.mask[r][c]).toBe(l.mask[r][l.cols - 1 - c]);
          if (!l.mask[r][c]) {
            expect(l.ice[r][c]).toBe(0);
            expect(l.honey[r][c]).toBe(0);
          }
        }
      }
    }
  });

  it('rejects invalid level numbers and handles huge N', () => {
    expect(() => generateLevel(0)).toThrow();
    expect(() => generateLevel(1.5)).toThrow();
    const big = generateLevel(1_000_000);
    expect(big.maxMoves).toBeGreaterThanOrEqual(12);
  });
});

describe('AdaptiveDifficulty', () => {
  it('persists failStreak, activates assist at >= 2, resets on win', () => {
    const store = new MemoryStore();
    const ad = new AdaptiveDifficulty(store);
    expect(ad.assistActive).toBe(false);
    expect(ad.assistProbability).toBe(0);
    ad.recordFail();
    expect(ad.assistActive).toBe(false);
    ad.recordFail();
    expect(ad.failStreak).toBe(2);
    expect(ad.assistActive).toBe(true);
    expect(ad.assistProbability).toBe(ASSIST_BOOST);
    expect(store.getItem(FAIL_STREAK_KEY)).toBe('2');
    // survives "reload"
    expect(new AdaptiveDifficulty(store).assistActive).toBe(true);
    ad.recordWin();
    expect(ad.failStreak).toBe(0);
    expect(ad.assistActive).toBe(false);
  });

  it('tolerates corrupt storage', () => {
    const store = new MemoryStore();
    store.setItem(FAIL_STREAK_KEY, 'garbage');
    expect(new AdaptiveDifficulty(store).failStreak).toBe(0);
  });
});
