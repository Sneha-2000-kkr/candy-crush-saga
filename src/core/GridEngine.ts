import {
  ComboType,
  detectCombo,
  expandBlast,
  findMatches,
  hasAnyMatch,
  MatchGroup,
  Spawn,
} from './MatchDetector';
import { ensureMoves, findValidMoves, isValidSwap, randomFillNoMatch, shuffleBoard, swapCells } from './MoveValidator';
import {
  Board,
  BOMB_COLOR,
  Candy,
  createBoard,
  key,
  MAX_CASCADE_DEPTH,
  NUM_CANDY_TYPES,
  Pos,
  randInt,
  RNG,
  SpecialType,
} from './Types';

export interface GridEngineOptions {
  mask: number[][];
  rng: RNG;
  numColors?: number;
  ice?: number[][];
  honey?: number[][];
  /** Probability [0..1] that a refill spawn is "helpful" (Assist Mode). 0 = off. */
  assistProbability?: number;
}

/** A candy as seen in a trace snapshot (object identity lets a renderer track sprites). */
export interface SnapCell {
  candy: Candy;
  color: number;
  special: SpecialType;
}

export type TraceStep =
  | {
      kind: 'board';
      reason: 'swap' | 'convert' | 'settle' | 'shuffle';
      grid: (SnapCell | null)[][];
      ice: number[][];
      honey: number[][];
    }
  | {
      kind: 'clear';
      cleared: { pos: Pos; candy: Candy; color: number; special: SpecialType }[];
      spawns: { pos: Pos; special: SpecialType }[];
      triggers: { pos: Pos; special: SpecialType }[];
      /** Wrapped explosion centres (first or second blast). */
      bursts: Pos[];
      combo: ComboType | null;
      comboCenter: Pos | null;
      score: number;
      level: number;
      ice: number[][];
      honey: number[][];
      iceHits: Pos[];
      honeyBroken: Pos[];
    };

export interface MoveResult {
  valid: boolean;
  score: number;
  /** Candies removed from the board (all steps). */
  cleared: number;
  /** Number of cascade rounds that followed the initial clear. */
  cascades: number;
  specialsCreated: number;
  specialsTriggered: number;
  combo: ComboType | null;
  iceHits: number;
  honeyHits: number;
  shuffled: boolean;
  /** True if the MAX_CASCADE_DEPTH safeguard tripped (should never happen). */
  capped: boolean;
  /** Step-by-step animation script; only filled when `engine.trace` is true. */
  trace: TraceStep[];
}

const emptyResult = (valid: boolean): MoveResult => ({
  valid,
  score: 0,
  cleared: 0,
  cascades: 0,
  specialsCreated: 0,
  specialsTriggered: 0,
  combo: null,
  iceHits: 0,
  honeyHits: 0,
  shuffled: false,
  capped: false,
  trace: [],
});

const DIRS = [
  { r: -1, c: 0 },
  { r: 1, c: 0 },
  { r: 0, c: -1 },
  { r: 0, c: 1 },
];

export class GridEngine {
  board: Board;
  readonly numColors: number;
  rng: RNG;
  assistProbability: number;
  score = 0;
  /** When true, swap() records a TraceStep[] for renderers. */
  trace = false;
  private stepCtx: { combo: ComboType | null; center: Pos | null; bursts: Pos[] } = {
    combo: null,
    center: null,
    bursts: [],
  };

  constructor(opts: GridEngineOptions) {
    this.board = createBoard(opts.mask, opts.ice, opts.honey);
    this.numColors = opts.numColors ?? NUM_CANDY_TYPES;
    this.rng = opts.rng;
    this.assistProbability = opts.assistProbability ?? 0;
  }

  get assistMode(): boolean {
    return this.assistProbability > 0;
  }

  // ---------------------------------------------------------------- setup

  /** Fills the board with no pending matches and at least `minMoves` valid moves. */
  fillInitial(minMoves = 2): void {
    for (let i = 0; i < 500; i++) {
      randomFillNoMatch(this.board, this.numColors, this.rng);
      if (findValidMoves(this.board, minMoves).length >= minMoves) return;
    }
    throw new Error('GridEngine.fillInitial: could not build a playable board (mask too restrictive)');
  }

  /** Test/debug helper: load colours directly. Negative value = leave empty. */
  loadColors(grid: number[][]): void {
    for (let r = 0; r < this.board.rows; r++) {
      for (let c = 0; c < this.board.cols; c++) {
        const v = grid[r]?.[c] ?? -1;
        this.board.cells[r][c] = this.board.mask[r][c] && v >= 0 ? { color: v, special: SpecialType.NONE } : null;
      }
    }
  }

  setCandy(r: number, c: number, color: number, special: SpecialType = SpecialType.NONE): void {
    this.board.cells[r][c] = { color: special === SpecialType.COLOR_BOMB ? BOMB_COLOR : color, special };
  }

  iceRemaining(): number {
    return this.board.ice.reduce((s, row) => s + row.reduce((a, v) => a + v, 0), 0);
  }

  honeyRemaining(): number {
    return this.board.honey.reduce((s, row) => s + row.reduce((a, v) => a + v, 0), 0);
  }

  /** Shuffle (without costing a move) if the board is deadlocked. */
  ensurePlayable(): boolean {
    return ensureMoves(this.board, this.numColors, this.rng);
  }

  shuffle(): void {
    shuffleBoard(this.board, this.numColors, this.rng, 1);
  }

  // ---------------------------------------------------------------- moves

  swap(a: Pos, b: Pos): MoveResult {
    if (!isValidSwap(this.board, a, b)) return emptyResult(false);
    const res = emptyResult(true);
    const bd = this.board;
    swapCells(bd, a, b);
    const pendingWrapped: Pos[] = [];
    this.pushBoard(res, 'swap');

    const combo = detectCombo(bd, a, b);
    if (combo) {
      res.combo = combo.type;
      for (const p of combo.consume) bd.cells[p.r][p.c]!.special = SpecialType.NONE;
      for (const cv of combo.convert) {
        const cd = bd.cells[cv.pos.r][cv.pos.c];
        if (cd) cd.special = cv.special;
      }
      if (combo.convert.length) this.pushBoard(res, 'convert');
      this.stepCtx = { combo: combo.type, center: b, bursts: [] };
      this.clearStep(combo.seeds, [], 1, res, pendingWrapped, combo.type === 'BOMB_BOMB' ? 3 : 1);
    } else {
      const groups = findMatches(bd, [a, b]);
      this.clearGroups(groups, 1, res, pendingWrapped);
    }

    // cascade loop
    let depth = 0;
    for (;;) {
      this.gravityAndRefill();
      this.pushBoard(res, 'settle');
      if (pendingWrapped.length) {
        const seeds: Pos[] = [];
        const centres = pendingWrapped.splice(0);
        this.stepCtx = { combo: null, center: null, bursts: centres };
        for (const w of centres) {
          for (let r = w.r - 1; r <= w.r + 1; r++)
            for (let c = w.c - 1; c <= w.c + 1; c++)
              if (r >= 0 && c >= 0 && r < bd.rows && c < bd.cols && bd.mask[r][c]) seeds.push({ r, c });
        }
        depth++;
        if (depth >= MAX_CASCADE_DEPTH) {
          res.capped = true;
          break;
        }
        this.clearStep(seeds, [], depth + 1, res, pendingWrapped, 1);
        continue;
      }
      const groups = findMatches(bd);
      if (groups.length === 0) break;
      depth++;
      if (depth >= MAX_CASCADE_DEPTH) {
        res.capped = true;
        break;
      }
      this.clearGroups(groups, depth + 1, res, pendingWrapped);
    }
    res.cascades = depth;
    this.score += res.score;
    res.shuffled = this.ensurePlayable();
    if (res.shuffled) this.pushBoard(res, 'shuffle');
    return res;
  }

  // ---------------------------------------------------------------- internals

  private pushBoard(res: MoveResult, reason: 'swap' | 'convert' | 'settle' | 'shuffle'): void {
    if (!this.trace) return;
    const bd = this.board;
    res.trace.push({
      kind: 'board',
      reason,
      grid: bd.cells.map((row) => row.map((cd) => (cd ? { candy: cd, color: cd.color, special: cd.special } : null))),
      ice: bd.ice.map((r) => r.slice()),
      honey: bd.honey.map((r) => r.slice()),
    });
  }

  private clearGroups(
    groups: MatchGroup[],
    mult: number,
    res: MoveResult,
    pendingWrapped: Pos[],
  ): void {
    const seeds: Pos[] = [];
    const spawns: Spawn[] = [];
    const spawnKeys = new Set<number>();
    for (const g of groups) if (g.spawn) spawnKeys.add(key(g.spawn.pos));
    for (const g of groups) {
      if (g.spawn) spawns.push(g.spawn);
      for (const p of g.cells) if (!spawnKeys.has(key(p))) seeds.push(p);
    }
    // spawn cells are part of the match for ice/honey damage purposes
    const extra = spawns.map((s) => s.pos);
    this.clearStep(seeds, spawns, mult, res, pendingWrapped, 1, extra);
  }

  private clearStep(
    seeds: Pos[],
    spawns: Spawn[],
    mult: number,
    res: MoveResult,
    pendingWrapped: Pos[],
    bonusMult: number,
    extraDamage: Pos[] = [],
  ): void {
    const bd = this.board;
    const blast = expandBlast(bd, seeds);
    const clearedKeys = new Set(blast.cleared.map(key));
    const validSpawns = spawns.filter((s) => !clearedKeys.has(key(s.pos)));
    const damage = new Map<number, Pos>();
    for (const p of blast.cleared) damage.set(key(p), p);
    for (const p of extraDamage) damage.set(key(p), p);

    const ctx = this.stepCtx;
    this.stepCtx = { combo: null, center: null, bursts: [] };
    const clearedInfo = this.trace
      ? blast.cleared.map((p) => {
          const cd = bd.cells[p.r][p.c]!;
          return { pos: p, candy: cd, color: cd.color, special: cd.special };
        })
      : [];
    const iceHitPos: Pos[] = [];
    const honeyPos: Pos[] = [];
    // Ice: -1 HP for every tile in the match/blast
    for (const p of damage.values()) {
      if (bd.ice[p.r][p.c] > 0) {
        bd.ice[p.r][p.c]--;
        res.iceHits++;
        iceHitPos.push(p);
      }
    }
    // Honey: breaks when the cell itself or an orthogonal neighbour was cleared
    const honeyBroken = new Set<number>();
    for (const p of damage.values()) {
      if (bd.honey[p.r][p.c] > 0) honeyBroken.add(key(p));
      for (const d of DIRS) {
        const r = p.r + d.r;
        const c = p.c + d.c;
        if (r >= 0 && c >= 0 && r < bd.rows && c < bd.cols && bd.honey[r][c] > 0) honeyBroken.add(key({ r, c }));
      }
    }
    for (const k of honeyBroken) {
      const r = Math.floor(k / 1000);
      const c = k % 1000;
      bd.honey[r][c] = 0;
      res.honeyHits++;
      honeyPos.push({ r, c });
    }

    for (const p of blast.cleared) bd.cells[p.r][p.c] = null;
    for (const s of validSpawns) {
      const cd = bd.cells[s.pos.r][s.pos.c] as Candy | null;
      if (cd) {
        // mutate in place so renderers keep tracking the same candy object
        if (s.special === SpecialType.COLOR_BOMB) cd.color = BOMB_COLOR;
        cd.special = s.special;
      }
      res.specialsCreated++;
    }
    const matchedTiles = blast.cleared.length + validSpawns.length;
    res.cleared += blast.cleared.length;
    res.specialsTriggered += blast.triggered;
    res.score += matchedTiles * 10 * mult * bonusMult + blast.triggered * 20 * mult + validSpawns.length * 20;
    pendingWrapped.push(...blast.wrapped);
    if (this.trace) {
      res.trace.push({
        kind: 'clear',
        cleared: clearedInfo,
        spawns: validSpawns.map((sp) => ({ pos: sp.pos, special: sp.special })),
        triggers: blast.triggers,
        bursts: [...ctx.bursts, ...blast.wrapped],
        combo: ctx.combo,
        comboCenter: ctx.center,
        score: matchedTiles * 10 * mult * bonusMult + blast.triggered * 20 * mult + validSpawns.length * 20,
        level: mult,
        ice: bd.ice.map((r) => r.slice()),
        honey: bd.honey.map((r) => r.slice()),
        iceHits: iceHitPos,
        honeyBroken: honeyPos,
      });
    }
  }

  /** Gravity routes vertically past holes; refill spawns into remaining empties. */
  gravityAndRefill(): void {
    const bd = this.board;
    for (let c = 0; c < bd.cols; c++) {
      const rowsInCol: number[] = [];
      for (let r = bd.rows - 1; r >= 0; r--) if (bd.mask[r][c]) rowsInCol.push(r); // bottom -> top
      const candies = rowsInCol.map((r) => bd.cells[r][c]).filter((x): x is Candy => !!x);
      rowsInCol.forEach((r, i) => (bd.cells[r][c] = candies[i] ?? null));
    }
    // refill bottom -> top so spawn logic can see settled neighbours below / beside
    for (let r = bd.rows - 1; r >= 0; r--) {
      for (let c = 0; c < bd.cols; c++) {
        if (bd.mask[r][c] && !bd.cells[r][c]) {
          bd.cells[r][c] = { color: this.spawnColor(r, c), special: SpecialType.NONE };
        }
      }
    }
  }

  private colorAt(r: number, c: number): number {
    const bd = this.board;
    if (r < 0 || c < 0 || r >= bd.rows || c >= bd.cols || !bd.mask[r][c]) return -1;
    return bd.cells[r][c]?.color ?? -1;
  }

  /**
   * Spawn colour. In Assist Mode, with `assistProbability` the colour is chosen
   * to be helpful: one that completes a 3-in-a-row with already-settled
   * neighbours, otherwise one matching an adjacent candy.
   */
  private spawnColor(r: number, c: number): number {
    if (this.assistProbability > 0 && this.rng.next() < this.assistProbability) {
      const L1 = this.colorAt(r, c - 1);
      const L2 = this.colorAt(r, c - 2);
      const R1 = this.colorAt(r, c + 1);
      const R2 = this.colorAt(r, c + 2);
      const D1 = this.colorAt(r + 1, c);
      const D2 = this.colorAt(r + 2, c);
      const U1 = this.colorAt(r - 1, c);
      const completing: number[] = [];
      if (L1 >= 0 && L1 === L2) completing.push(L1);
      if (R1 >= 0 && R1 === R2) completing.push(R1);
      if (D1 >= 0 && D1 === D2) completing.push(D1);
      if (L1 >= 0 && L1 === R1) completing.push(L1);
      if (U1 >= 0 && U1 === D1) completing.push(U1);
      if (completing.length) return completing[randInt(this.rng, completing.length)];
      const neighbours = [L1, R1, D1, U1].filter((x) => x >= 0);
      if (neighbours.length) return neighbours[randInt(this.rng, neighbours.length)];
    }
    return randInt(this.rng, this.numColors);
  }

  /** Sanity check used by tests: every playable cell holds a valid candy. */
  validateIntegrity(): string | null {
    const bd = this.board;
    for (let r = 0; r < bd.rows; r++) {
      for (let c = 0; c < bd.cols; c++) {
        const cd = bd.cells[r][c];
        if (!bd.mask[r][c]) {
          if (cd) return `candy in hole at ${r},${c}`;
          continue;
        }
        if (!cd) return `missing candy at ${r},${c}`;
        if (typeof cd.color !== 'number' || Number.isNaN(cd.color)) return `bad colour at ${r},${c}`;
        if (cd.special === SpecialType.COLOR_BOMB ? cd.color !== BOMB_COLOR : cd.color < 0 || cd.color >= this.numColors)
          return `colour out of range at ${r},${c}`;
        if (bd.ice[r][c] < 0 || bd.ice[r][c] > 2) return `bad ice at ${r},${c}`;
      }
    }
    return hasAnyMatch(bd) ? 'unresolved match left on board' : null;
  }
}
