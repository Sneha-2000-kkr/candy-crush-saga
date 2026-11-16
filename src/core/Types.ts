/** Pure data types for the headless Match-3 core. No DOM / Phaser imports allowed. */

export interface RNG {
  /** Uniform float in [0, 1). */
  next(): number;
}

export interface Pos {
  r: number;
  c: number;
}

export enum SpecialType {
  NONE = 0,
  STRIPED_H = 1, // clears its whole row
  STRIPED_V = 2, // clears its whole column
  WRAPPED = 3, // 3x3 explosion, twice
  COLOR_BOMB = 4,
}

/** Colour value carried by Color Bombs; never matches anything. */
export const BOMB_COLOR = -1;

export interface Candy {
  color: number;
  special: SpecialType;
}

/**
 * Three independent layers per cell:
 *  mask  : 0 = hole, 1 = playable
 *  ice   : 0..2 HP underlay
 *  honey : 0..1 HP overlay (locks the cell from being swapped)
 */
export interface Board {
  rows: number;
  cols: number;
  mask: number[][];
  cells: (Candy | null)[][];
  ice: number[][];
  honey: number[][];
}

export interface Move {
  a: Pos;
  b: Pos;
}

export const NUM_CANDY_TYPES = 6;
export const MAX_CASCADE_DEPTH = 50;

export const key = (p: Pos): number => p.r * 1000 + p.c;

export function randInt(rng: RNG, n: number): number {
  return Math.floor(rng.next() * n);
}

export function makeGrid<T>(rows: number, cols: number, fill: T): T[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
}

export function createBoard(mask: number[][], ice?: number[][], honey?: number[][]): Board {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const m = mask.map((row) => row.map((v) => (v ? 1 : 0)));
  const iceG = makeGrid(rows, cols, 0);
  const honeyG = makeGrid(rows, cols, 0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!m[r][c]) continue;
      iceG[r][c] = Math.max(0, Math.min(2, ice?.[r]?.[c] ?? 0));
      honeyG[r][c] = honey?.[r]?.[c] ? 1 : 0;
    }
  }
  return { rows, cols, mask: m, cells: makeGrid<Candy | null>(rows, cols, null), ice: iceG, honey: honeyG };
}

export function cloneBoard(b: Board): Board {
  return {
    rows: b.rows,
    cols: b.cols,
    mask: b.mask.map((r) => r.slice()),
    cells: b.cells.map((row) => row.map((x) => (x ? { ...x } : null))),
    ice: b.ice.map((r) => r.slice()),
    honey: b.honey.map((r) => r.slice()),
  };
}

export function inBounds(b: Board, r: number, c: number): boolean {
  return r >= 0 && c >= 0 && r < b.rows && c < b.cols;
}

export function isPlayable(b: Board, r: number, c: number): boolean {
  return inBounds(b, r, c) && b.mask[r][c] === 1;
}

export function playableCells(b: Board): Pos[] {
  const out: Pos[] = [];
  for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) if (b.mask[r][c]) out.push({ r, c });
  return out;
}

export function samePos(a: Pos, b: Pos): boolean {
  return a.r === b.r && a.c === b.c;
}
