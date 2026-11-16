import { describe, expect, it } from 'vitest';
import { GridEngine } from '../src/core/GridEngine';
import { findValidMoves } from '../src/core/MoveValidator';
import { MAX_CASCADE_DEPTH } from '../src/core/Types';
import { ASSIST_BOOST } from '../src/procedural/AdaptiveDifficulty';
import { createEngineForLevel, generateLevel } from '../src/procedural/LevelGenerator';
import { SeededRNG } from '../src/procedural/SeededRNG';
import { playBotMove } from './helpers/bot';

describe('Gate 2 — headless bot stress run (levels 1..200)', () => {
  it('plays 200 levels with no loops, no corruption, and solvable starts', () => {
    let totalMoves = 0;
    let totalCascades = 0;
    let maxDepth = 0;
    let shuffles = 0;
    let wins = 0;

    for (let level = 1; level <= 200; level++) {
      const cfg = generateLevel(level);
      const engine = createEngineForLevel(cfg);

      // 3. every level starts with >= 2 valid moves
      expect(findValidMoves(engine.board).length, `level ${level} start moves`).toBeGreaterThanOrEqual(2);
      expect(engine.validateIntegrity(), `level ${level} initial integrity`).toBeNull();

      const budget = Math.max(cfg.maxMoves, 90); // stress: play well beyond the move budget (5,000+ cascades)
      for (let m = 0; m < budget; m++) {
        const res = playBotMove(engine);
        expect(res, `level ${level} move ${m}: bot found no move`).not.toBeNull();
        if (!res) break;
        totalMoves++;
        totalCascades += res.cascades;
        maxDepth = Math.max(maxDepth, res.cascades);
        if (res.shuffled) shuffles++;
        // 1. no infinite cascade loops
        expect(res.capped, `level ${level} move ${m} hit cascade cap`).toBe(false);
        expect(res.cascades).toBeLessThan(MAX_CASCADE_DEPTH);
        // 2. no undefined/null on playable cells
        expect(engine.validateIntegrity(), `level ${level} move ${m} integrity`).toBeNull();
        if (m === cfg.maxMoves - 1 && engine.score >= cfg.goals.targetScore) wins++;
      }
    }
    console.log(
      `[bot] moves=${totalMoves} cascades=${totalCascades} maxDepth=${maxDepth} shuffles=${shuffles} winsAtBudget=${wins}`,
    );
    expect(totalMoves).toBeGreaterThanOrEqual(18000);
    expect(totalCascades).toBeGreaterThanOrEqual(5000);
    expect(maxDepth).toBeLessThan(MAX_CASCADE_DEPTH);
  });

  it('Assist Mode (failStreak >= 2) clears measurably more than normal play', () => {
    const GAMES = 80;
    const MOVES = 30;
    const mask = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 1));
    const run = (assist: number) => {
      let cleared = 0;
      let cascades = 0;
      for (let seed = 1; seed <= GAMES; seed++) {
        // identical initial boards: fillInitial never uses assist spawns
        const e = new GridEngine({ mask, rng: new SeededRNG(seed * 7919), numColors: 6, assistProbability: assist });
        e.fillInitial(2);
        for (let m = 0; m < MOVES; m++) {
          const res = playBotMove(e);
          if (!res) break;
          cleared += res.cleared;
          cascades += res.cascades;
        }
      }
      const n = GAMES * MOVES;
      return { clearRate: cleared / n, cascadeRate: cascades / n };
    };
    const normal = run(0);
    const assist = run(ASSIST_BOOST);
    console.log('[assist] normal', normal, 'assist', assist);
    expect(assist.cascadeRate).toBeGreaterThan(normal.cascadeRate);
    expect(assist.clearRate).toBeGreaterThan(normal.clearRate);
  });
});
