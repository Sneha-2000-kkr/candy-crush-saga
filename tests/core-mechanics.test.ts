import { describe, expect, it } from 'vitest';
import { GridEngine } from '../src/core/GridEngine';
import { detectCombo, findMatches } from '../src/core/MatchDetector';
import { checkSwap, findValidMoves, hasValidMoves, isDeadlocked, swapCells } from '../src/core/MoveValidator';
import { Pos, SpecialType, randomFillHelper } from './helpers/core';
import { SeededRNG } from '../src/procedural/SeededRNG';

const full = (n = 8) => Array.from({ length: n }, () => Array.from({ length: n }, () => 1));

/** Background lattice that never contains a 3-run, using colours 0..4 (colour 5 is reserved for test candies). */
const bg = (r: number, c: number) => (r + 2 * c) % 5;

function makeEngine(mask = full(), opts: Partial<ConstructorParameters<typeof GridEngine>[0]> = {}): GridEngine {
  const e = new GridEngine({ mask, rng: new SeededRNG(1), numColors: 6, ...opts });
  e.loadColors(mask.map((row, r) => row.map((_, c) => bg(r, c))));
  return e;
}

function put(e: GridEngine, cells: Pos[], color = 5) {
  for (const p of cells) e.setCandy(p.r, p.c, color);
}

const P = (r: number, c: number): Pos => ({ r, c });

describe('Gate 1 — special candy creation', () => {
  it('3-in-a-row creates no special', () => {
    const e = makeEngine();
    put(e, [P(3, 0), P(3, 1), P(2, 2)]);
    swapCells(e.board, P(2, 2), P(3, 2));
    const g = findMatches(e.board, [P(2, 2), P(3, 2)]);
    expect(g).toHaveLength(1);
    expect(g[0].shape).toBe('LINE3');
    expect(g[0].spawn).toBeNull();
  });

  it('4 horizontal => STRIPED_V (real Candy Crush), spawned at the swapped cell', () => {
    const e = makeEngine();
    put(e, [P(3, 0), P(3, 1), P(3, 3), P(2, 2)]);
    swapCells(e.board, P(2, 2), P(3, 2));
    const g = findMatches(e.board, [P(2, 2), P(3, 2)]);
    expect(g).toHaveLength(1);
    expect(g[0].shape).toBe('LINE4_H');
    expect(g[0].spawn).toEqual({ pos: P(3, 2), special: SpecialType.STRIPED_V });
  });

  it('4 vertical => STRIPED_H', () => {
    const e = makeEngine();
    put(e, [P(0, 3), P(1, 3), P(3, 3), P(2, 2)]);
    swapCells(e.board, P(2, 2), P(2, 3));
    const g = findMatches(e.board, [P(2, 2), P(2, 3)]);
    expect(g).toHaveLength(1);
    expect(g[0].shape).toBe('LINE4_V');
    expect(g[0].spawn?.special).toBe(SpecialType.STRIPED_H);
  });

  it('L shape => WRAPPED', () => {
    const e = makeEngine();
    put(e, [P(3, 0), P(3, 1), P(4, 2), P(5, 2), P(2, 2)]);
    swapCells(e.board, P(2, 2), P(3, 2));
    const g = findMatches(e.board, [P(2, 2), P(3, 2)]);
    expect(g).toHaveLength(1);
    expect(g[0].shape).toBe('L');
    expect(g[0].cells).toHaveLength(5);
    expect(g[0].spawn?.special).toBe(SpecialType.WRAPPED);
  });

  it('T shape => WRAPPED', () => {
    const e = makeEngine();
    put(e, [P(3, 1), P(3, 3), P(4, 2), P(5, 2), P(2, 2)]);
    swapCells(e.board, P(2, 2), P(3, 2));
    const g = findMatches(e.board, [P(2, 2), P(3, 2)]);
    expect(g).toHaveLength(1);
    expect(g[0].shape).toBe('T');
    expect(g[0].spawn).toEqual({ pos: P(3, 2), special: SpecialType.WRAPPED });
  });

  it('5-in-a-row => COLOR_BOMB', () => {
    const e = makeEngine();
    put(e, [P(3, 0), P(3, 1), P(3, 3), P(3, 4), P(2, 2)]);
    swapCells(e.board, P(2, 2), P(3, 2));
    const g = findMatches(e.board, [P(2, 2), P(3, 2)]);
    expect(g).toHaveLength(1);
    expect(g[0].shape).toBe('LINE5');
    expect(g[0].spawn?.special).toBe(SpecialType.COLOR_BOMB);
  });

  it('engine records the special creation when the swap is executed', () => {
    const e = makeEngine();
    put(e, [P(3, 0), P(3, 1), P(3, 3), P(2, 2)]);
    const res = e.swap(P(2, 2), P(3, 2));
    expect(res.valid).toBe(true);
    expect(res.specialsCreated).toBeGreaterThanOrEqual(1);
    expect(e.validateIntegrity()).toBeNull();
  });
});

describe('Gate 1 — special + special combos', () => {
  it('STRIPED + WRAPPED => 3 rows + 3 columns', () => {
    const e = makeEngine();
    e.setCandy(3, 3, 5, SpecialType.STRIPED_H);
    e.setCandy(3, 4, 5, SpecialType.WRAPPED);
    expect(checkSwap(e.board, P(3, 3), P(3, 4))).toBe('ok');
    swapCells(e.board, P(3, 3), P(3, 4));
    const plan = detectCombo(e.board, P(3, 3), P(3, 4))!;
    expect(plan.type).toBe('STRIPED_WRAPPED');
    expect(new Set(plan.seeds.map((p) => p.r * 100 + p.c)).size).toBe(3 * 8 + 3 * 8 - 9);
  });

  it('COLOR_BOMB + normal => all candies of that colour', () => {
    const e = makeEngine();
    e.setCandy(3, 3, 0, SpecialType.COLOR_BOMB);
    const target = e.board.cells[3][4]!.color;
    const count = e.board.cells.flat().filter((c) => c && c.color === target).length;
    swapCells(e.board, P(3, 3), P(3, 4));
    const plan = detectCombo(e.board, P(3, 3), P(3, 4))!;
    expect(plan.type).toBe('BOMB_COLOR');
    expect(plan.seeds.length).toBe(count + 1);
  });

  it('COLOR_BOMB + COLOR_BOMB => clears whole board and damages all ice by 1', () => {
    const ice = full().map((row) => row.map(() => 1));
    const e = makeEngine(full(), { ice });
    e.setCandy(3, 3, 0, SpecialType.COLOR_BOMB);
    e.setCandy(3, 4, 0, SpecialType.COLOR_BOMB);
    const res = e.swap(P(3, 3), P(3, 4));
    expect(res.valid).toBe(true);
    expect(res.combo).toBe('BOMB_BOMB');
    expect(res.iceHits).toBe(64);
    expect(e.iceRemaining()).toBe(0);
    expect(e.validateIntegrity()).toBeNull();
  });

  it('COLOR_BOMB + STRIPED converts the most frequent colour to stripes and detonates', () => {
    const e = makeEngine();
    e.setCandy(3, 3, 0, SpecialType.COLOR_BOMB);
    e.setCandy(3, 4, 5, SpecialType.STRIPED_H);
    swapCells(e.board, P(3, 3), P(3, 4));
    const plan = detectCombo(e.board, P(3, 3), P(3, 4))!;
    expect(plan.type).toBe('BOMB_STRIPED');
    expect(plan.convert.length).toBeGreaterThan(5);
    swapCells(e.board, P(3, 3), P(3, 4));
    const res = e.swap(P(3, 3), P(3, 4));
    expect(res.valid).toBe(true);
    expect(res.specialsTriggered).toBeGreaterThan(5);
    expect(e.validateIntegrity()).toBeNull();
  });

  it('WRAPPED + WRAPPED => 5x5 blast', () => {
    const e = makeEngine();
    e.setCandy(3, 3, 5, SpecialType.WRAPPED);
    e.setCandy(3, 4, 5, SpecialType.WRAPPED);
    swapCells(e.board, P(3, 3), P(3, 4));
    const plan = detectCombo(e.board, P(3, 3), P(3, 4))!;
    expect(plan.type).toBe('WRAPPED_WRAPPED');
    expect(plan.seeds).toHaveLength(25);
  });
});

describe('Gate 1 — gravity with holes', () => {
  it('routes candies past holes without losing or duplicating any', () => {
    const mask = full();
    mask[3][2] = 0;
    mask[4][2] = 0;
    const e = new GridEngine({ mask, rng: { next: () => 0.99 }, numColors: 6 });
    e.loadColors(mask.map((row, r) => row.map((_, c) => bg(r, c))));
    // column 2 (top->bottom): 0,1,2,[hole],[hole],3,4,empty
    const col = [0, 1, 2, -1, -1, 3, 4, -1];
    col.forEach((v, r) => {
      if (mask[r][2]) e.board.cells[r][2] = v >= 0 ? { color: v, special: SpecialType.NONE } : null;
    });
    e.gravityAndRefill();
    const result = e.board.cells.map((row) => row[2]?.color ?? null);
    // old candies shift down in order; refill (rng 0.99 => colour 5) lands on top
    expect(result).toEqual([5, 0, 1, null, null, 2, 3, 4]);
    expect(e.board.cells[3][2]).toBeNull();
    expect(e.board.cells[4][2]).toBeNull();
    expect(e.validateIntegrity()).toBeNull();
  });

  it('full cascades on a holey board never put candies in holes or leave gaps', () => {
    const mask = full();
    [[0, 0], [0, 7], [7, 0], [7, 7], [3, 3], [3, 4], [4, 3], [4, 4]].forEach(([r, c]) => (mask[r][c] = 0));
    const e = new GridEngine({ mask, rng: new SeededRNG(7), numColors: 6 });
    e.fillInitial(2);
    for (let i = 0; i < 60; i++) {
      const mv = findValidMoves(e.board)[0];
      if (!mv) break;
      e.swap(mv.a, mv.b);
      expect(e.validateIntegrity()).toBeNull();
    }
  });
});

describe('Gate 1 — honey locks', () => {
  const honey = () => {
    const h = full().map((row) => row.map(() => 0));
    h[3][3] = 1;
    return h;
  };

  it('blocks direct swaps of a honeyed cell', () => {
    const e = makeEngine(full(), { honey: honey() });
    // would be a valid match if honey were not present
    put(e, [P(3, 1), P(3, 2), P(2, 4)]);
    expect(checkSwap(e.board, P(3, 3), P(3, 4))).toBe('honey');
    put(e, [P(3, 1), P(3, 2)]);
    e.setCandy(3, 4, 5);
    const before = JSON.stringify(e.board.cells);
    const res = e.swap(P(3, 3), P(3, 4));
    expect(res.valid).toBe(false);
    expect(JSON.stringify(e.board.cells)).toBe(before);
    // identical layout without honey is a legal move
    const free = makeEngine(full());
    put(free, [P(3, 1), P(3, 2), P(2, 3)]);
    expect(checkSwap(free.board, P(2, 3), P(3, 3))).toBe('ok');
  });

  it('is broken by an adjacent match, after which the cell can be swapped', () => {
    const e = makeEngine(full(), { honey: honey() });
    put(e, [P(4, 1), P(4, 2), P(5, 3)]);
    expect(e.honeyRemaining()).toBe(1);
    const res = e.swap(P(5, 3), P(4, 3)); // (4,3) sits directly below the honey at (3,3)
    expect(res.valid).toBe(true);
    expect(res.honeyHits).toBe(1);
    expect(e.honeyRemaining()).toBe(0);
    expect(checkSwap(e.board, P(3, 3), P(3, 4)) === 'honey').toBe(false);
  });
});

describe('Gate 1 — deadlock detection & auto-shuffle', () => {
  it('detects zero valid moves and auto-shuffles to a playable board', () => {
    const mask = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => 1));
    const rng = new SeededRNG(99);
    const e = new GridEngine({ mask, rng: new SeededRNG(5), numColors: 6 });
    let found = false;
    for (let i = 0; i < 50000 && !found; i++) {
      randomFillHelper(e.board, 6, rng);
      if (isDeadlocked(e.board)) found = true;
    }
    expect(found).toBe(true);
    expect(hasValidMoves(e.board)).toBe(false);
    expect(findValidMoves(e.board)).toHaveLength(0);

    const shuffled = e.ensurePlayable();
    expect(shuffled).toBe(true);
    expect(hasValidMoves(e.board)).toBe(true);
    expect(e.validateIntegrity()).toBeNull();
    // a playable board is left alone
    expect(e.ensurePlayable()).toBe(false);
  });
});
