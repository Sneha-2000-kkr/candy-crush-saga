import { GridEngine, MoveResult } from '../../src/core/GridEngine';
import { detectCombo, findMatches } from '../../src/core/MatchDetector';
import { findValidMoves, swapCells } from '../../src/core/MoveValidator';
import { Board, cloneBoard, Move } from '../../src/core/Types';

/** Greedy heuristic: +50 special/combo, +30 ice/honey hit, +10 per matched tile. */
export function scoreMove(board: Board, m: Move): number {
  const bd = cloneBoard(board);
  swapCells(bd, m.a, m.b);
  const combo = detectCombo(bd, m.a, m.b);
  if (combo) return 50 + 10 * combo.seeds.length + 30;
  const groups = findMatches(bd, [m.a, m.b]);
  let s = 0;
  let hit = false;
  for (const g of groups) {
    s += 10 * g.cells.length;
    if (g.spawn) s += 50;
    for (const p of g.cells) {
      if (bd.ice[p.r][p.c] > 0 || bd.honey[p.r][p.c] > 0) hit = true;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (bd.honey[p.r + dr]?.[p.c + dc]) hit = true;
      }
    }
  }
  return s + (hit ? 30 : 0);
}

export function bestMove(board: Board): Move | null {
  const moves = findValidMoves(board);
  let best: Move | null = null;
  let bestScore = -1;
  for (const m of moves) {
    const sc = scoreMove(board, m);
    if (sc > bestScore) {
      best = m;
      bestScore = sc;
    }
  }
  return best;
}

export function playBotMove(engine: GridEngine): MoveResult | null {
  const m = bestMove(engine.board);
  if (!m) return null;
  return engine.swap(m.a, m.b);
}
