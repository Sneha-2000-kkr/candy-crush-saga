import { detectCombo, hasAnyMatch, hasMatchAt } from './MatchDetector';
import { Board, isPlayable, Move, Pos, randInt, RNG, SpecialType } from './Types';

export function isAdjacent(a: Pos, b: Pos): boolean {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

export function swapCells(b: Board, p: Pos, q: Pos): void {
  const t = b.cells[p.r][p.c];
  b.cells[p.r][p.c] = b.cells[q.r][q.c];
  b.cells[q.r][q.c] = t;
}

/** Why a swap is rejected (or 'ok'). */
export type SwapCheck = 'ok' | 'not-adjacent' | 'hole' | 'empty' | 'honey' | 'no-match';

export function checkSwap(b: Board, p: Pos, q: Pos): SwapCheck {
  if (!isAdjacent(p, q)) return 'not-adjacent';
  if (!isPlayable(b, p.r, p.c) || !isPlayable(b, q.r, q.c)) return 'hole';
  if (!b.cells[p.r][p.c] || !b.cells[q.r][q.c]) return 'empty';
  if (b.honey[p.r][p.c] > 0 || b.honey[q.r][q.c] > 0) return 'honey';
  swapCells(b, p, q);
  const ok = detectCombo(b, p, q) !== null || hasMatchAt(b, p.r, p.c) || hasMatchAt(b, q.r, q.c);
  swapCells(b, p, q);
  return ok ? 'ok' : 'no-match';
}

export function isValidSwap(b: Board, p: Pos, q: Pos): boolean {
  return checkSwap(b, p, q) === 'ok';
}

export function findValidMoves(b: Board, limit = Infinity): Move[] {
  const moves: Move[] = [];
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      if (!b.mask[r][c]) continue;
      const a = { r, c };
      for (const d of [
        { r, c: c + 1 },
        { r: r + 1, c },
      ]) {
        if (isValidSwap(b, a, d)) {
          moves.push({ a, b: d });
          if (moves.length >= limit) return moves;
        }
      }
    }
  }
  return moves;
}

export function hasValidMoves(b: Board): boolean {
  return findValidMoves(b, 1).length > 0;
}

/** Deadlock = settled board with zero valid moves. */
export function isDeadlocked(b: Board): boolean {
  return !hasValidMoves(b);
}

function randomFillNoMatch(b: Board, numColors: number, rng: RNG): void {
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      if (!b.mask[r][c]) {
        b.cells[r][c] = null;
        continue;
      }
      let color = randInt(rng, numColors);
      for (let tries = 0; tries < numColors; tries++) {
        const hBad =
          c >= 2 &&
          b.cells[r][c - 1]?.color === color &&
          b.cells[r][c - 2]?.color === color;
        const vBad =
          r >= 2 &&
          b.cells[r - 1][c]?.color === color &&
          b.cells[r - 2][c]?.color === color;
        if (!hBad && !vBad) break;
        color = (color + 1) % numColors;
      }
      b.cells[r][c] = { color, special: SpecialType.NONE };
    }
  }
}

/**
 * Shuffles the existing candies (specials preserved) until the board has no
 * pending match and at least `minMoves` valid moves. Ice/honey stay put and no
 * player move is consumed. Falls back to a fresh colour fill if needed.
 */
export function shuffleBoard(b: Board, numColors: number, rng: RNG, minMoves = 1): number {
  const spots: Pos[] = [];
  for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) if (b.mask[r][c]) spots.push({ r, c });
  const candies = spots.map((p) => b.cells[p.r][p.c]!).filter(Boolean);
  let attempts = 0;
  for (; attempts < 200; attempts++) {
    for (let i = candies.length - 1; i > 0; i--) {
      const j = randInt(rng, i + 1);
      [candies[i], candies[j]] = [candies[j], candies[i]];
    }
    spots.forEach((p, i) => (b.cells[p.r][p.c] = candies[i] ?? null));
    if (!hasAnyMatch(b) && findValidMoves(b, minMoves).length >= minMoves) return attempts + 1;
  }
  // fallback: brand-new colours (specials are dropped in this extreme case)
  for (; attempts < 2000; attempts++) {
    randomFillNoMatch(b, numColors, rng);
    if (findValidMoves(b, minMoves).length >= minMoves) return attempts + 1;
  }
  return -1;
}

/** Auto-shuffle when deadlocked. Returns true when a shuffle happened. */
export function ensureMoves(b: Board, numColors: number, rng: RNG): boolean {
  if (hasValidMoves(b)) return false;
  shuffleBoard(b, numColors, rng, 1);
  return true;
}

export { randomFillNoMatch };
