import { Board, BOMB_COLOR, Candy, isPlayable, key, Pos, samePos, SpecialType } from './Types';

export type MatchShape = 'LINE3' | 'LINE4_H' | 'LINE4_V' | 'LINE5' | 'L' | 'T';

export interface Spawn {
  pos: Pos;
  special: SpecialType;
}

export interface MatchGroup {
  cells: Pos[];
  color: number;
  shape: MatchShape;
  /** Special candy created by this match (kept on the board), if any. */
  spawn: Spawn | null;
}

interface Run {
  cells: Pos[];
  horizontal: boolean;
}

function matchColor(b: Board, r: number, c: number): number {
  if (!isPlayable(b, r, c)) return -1;
  const cd = b.cells[r][c];
  return cd && cd.color >= 0 ? cd.color : -1;
}

function findRuns(b: Board): Run[] {
  const runs: Run[] = [];
  for (let r = 0; r < b.rows; r++) {
    let c = 0;
    while (c < b.cols) {
      const col = matchColor(b, r, c);
      if (col < 0) {
        c++;
        continue;
      }
      let e = c + 1;
      while (e < b.cols && matchColor(b, r, e) === col) e++;
      if (e - c >= 3) {
        const cells: Pos[] = [];
        for (let k = c; k < e; k++) cells.push({ r, c: k });
        runs.push({ cells, horizontal: true });
      }
      c = e;
    }
  }
  for (let c = 0; c < b.cols; c++) {
    let r = 0;
    while (r < b.rows) {
      const col = matchColor(b, r, c);
      if (col < 0) {
        r++;
        continue;
      }
      let e = r + 1;
      while (e < b.rows && matchColor(b, e, c) === col) e++;
      if (e - r >= 3) {
        const cells: Pos[] = [];
        for (let k = r; k < e; k++) cells.push({ r: k, c });
        runs.push({ cells, horizontal: false });
      }
      r = e;
    }
  }
  return runs;
}

/** Fast check: does a match of 3+ pass through (r,c)? Used by swap validation. */
export function hasMatchAt(b: Board, r: number, c: number): boolean {
  const col = matchColor(b, r, c);
  if (col < 0) return false;
  let h = 1;
  for (let k = c - 1; matchColor(b, r, k) === col; k--) h++;
  for (let k = c + 1; matchColor(b, r, k) === col; k++) h++;
  if (h >= 3) return true;
  let v = 1;
  for (let k = r - 1; matchColor(b, k, c) === col; k--) v++;
  for (let k = r + 1; matchColor(b, k, c) === col; k++) v++;
  return v >= 3;
}

export function hasAnyMatch(b: Board): boolean {
  for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) if (hasMatchAt(b, r, c)) return true;
  return false;
}

/**
 * Finds all match groups. Overlapping horizontal/vertical runs of one colour are
 * merged into a single group (L / T / plus shapes).
 *  - 5+ in a row        -> COLOR_BOMB
 *  - L / T (merged)     -> WRAPPED
 *  - 4 in a row         -> like real Candy Crush: a horizontal run makes STRIPED_V (clears its column),
 *                          a vertical run makes STRIPED_H (clears its row)
 * `hint` positions (the swapped cells) are preferred as the spawn location.
 */
export function findMatches(b: Board, hint: Pos[] = []): MatchGroup[] {
  const runs = findRuns(b);
  if (runs.length === 0) return [];

  // union-find over cells
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root)! !== root) root = parent.get(root)!;
    while (parent.get(x)! !== root) {
      const next: number = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const union = (x: number, y: number) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };
  for (const run of runs) {
    const k0 = key(run.cells[0]);
    find(k0);
    for (let i = 1; i < run.cells.length; i++) union(k0, key(run.cells[i]));
  }

  const byRoot = new Map<number, Run[]>();
  for (const run of runs) {
    const root = find(key(run.cells[0]));
    const list = byRoot.get(root);
    if (list) list.push(run);
    else byRoot.set(root, [run]);
  }

  const groups: MatchGroup[] = [];
  for (const groupRuns of byRoot.values()) {
    const cellMap = new Map<number, Pos>();
    for (const run of groupRuns) for (const p of run.cells) cellMap.set(key(p), p);
    const cells = [...cellMap.values()];
    const color = b.cells[cells[0].r][cells[0].c]!.color;
    const hRuns = groupRuns.filter((r) => r.horizontal);
    const vRuns = groupRuns.filter((r) => !r.horizontal);
    const longest = groupRuns.reduce((a, r) => (r.cells.length > a.cells.length ? r : a), groupRuns[0]);

    let shape: MatchShape;
    let special: SpecialType = SpecialType.NONE;
    let intersection: Pos | null = null;

    if (longest.cells.length >= 5) {
      shape = 'LINE5';
      special = SpecialType.COLOR_BOMB;
    } else if (hRuns.length > 0 && vRuns.length > 0) {
      special = SpecialType.WRAPPED;
      shape = 'T';
      outer: for (const h of hRuns) {
        for (const v of vRuns) {
          for (const p of h.cells) {
            if (v.cells.some((q) => samePos(p, q))) {
              intersection = p;
              const hi = h.cells.findIndex((q) => samePos(q, p));
              const vi = v.cells.findIndex((q) => samePos(q, p));
              const hEnd = hi === 0 || hi === h.cells.length - 1;
              const vEnd = vi === 0 || vi === v.cells.length - 1;
              shape = hEnd && vEnd ? 'L' : 'T';
              break outer;
            }
          }
        }
      }
    } else if (longest.cells.length === 4) {
      shape = longest.horizontal ? 'LINE4_H' : 'LINE4_V';
      special = longest.horizontal ? SpecialType.STRIPED_V : SpecialType.STRIPED_H;
    } else {
      shape = 'LINE3';
    }

    let spawn: Spawn | null = null;
    if (special !== SpecialType.NONE) {
      const plain = (p: Pos) => b.cells[p.r][p.c]!.special === SpecialType.NONE;
      let pos: Pos | undefined = hint.find((h) => cellMap.has(key(h)) && plain(h));
      if (!pos && intersection && plain(intersection)) pos = intersection;
      if (!pos) {
        const mid = longest.cells[Math.floor(longest.cells.length / 2)];
        if (plain(mid)) pos = mid;
      }
      if (!pos) pos = cells.find(plain);
      if (pos) spawn = { pos, special };
    }
    groups.push({ cells, color, shape, spawn });
  }
  return groups;
}

// ---------------------------------------------------------------- blasts

export interface BlastResult {
  cleared: Pos[];
  /** Every special that detonated (for VFX). */
  triggers: { pos: Pos; special: SpecialType }[];
  /** Wrapped candies that detonated; they explode a second time after gravity. */
  wrapped: Pos[];
  triggered: number;
}

export function mostFrequentColor(b: Board, exclude?: Pos[]): number {
  const skip = new Set((exclude ?? []).map(key));
  const counts = new Map<number, number>();
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const cd = b.cells[r][c];
      if (!b.mask[r][c] || !cd || cd.color < 0 || skip.has(key({ r, c }))) continue;
      counts.set(cd.color, (counts.get(cd.color) ?? 0) + 1);
    }
  }
  let best = -1;
  let bestN = 0;
  for (const [col, n] of [...counts.entries()].sort((x, y) => x[0] - y[0])) {
    if (n > bestN) {
      best = col;
      bestN = n;
    }
  }
  return best;
}

export function cellsOfColor(b: Board, color: number): Pos[] {
  const out: Pos[] = [];
  for (let r = 0; r < b.rows; r++)
    for (let c = 0; c < b.cols; c++) {
      const cd = b.cells[r][c];
      if (b.mask[r][c] && cd && cd.color === color) out.push({ r, c });
    }
  return out;
}

function rowCells(b: Board, r: number): Pos[] {
  const out: Pos[] = [];
  if (r < 0 || r >= b.rows) return out;
  for (let c = 0; c < b.cols; c++) if (b.mask[r][c]) out.push({ r, c });
  return out;
}

function colCells(b: Board, c: number): Pos[] {
  const out: Pos[] = [];
  if (c < 0 || c >= b.cols) return out;
  for (let r = 0; r < b.rows; r++) if (b.mask[r][c]) out.push({ r, c });
  return out;
}

export function areaCells(b: Board, center: Pos, radius: number): Pos[] {
  const out: Pos[] = [];
  for (let r = center.r - radius; r <= center.r + radius; r++)
    for (let c = center.c - radius; c <= center.c + radius; c++) if (isPlayable(b, r, c)) out.push({ r, c });
  return out;
}

/**
 * Expands a seed set through chain reactions: any special candy inside the
 * cleared area detonates in turn. Board is NOT mutated.
 */
export function expandBlast(b: Board, seeds: Pos[]): BlastResult {
  const cleared = new Map<number, Pos>();
  const queue: Pos[] = [];
  const wrapped: Pos[] = [];
  const triggers: { pos: Pos; special: SpecialType }[] = [];
  let triggered = 0;
  const add = (p: Pos) => {
    if (!isPlayable(b, p.r, p.c) || !b.cells[p.r][p.c]) return;
    const k = key(p);
    if (cleared.has(k)) return;
    cleared.set(k, p);
    queue.push(p);
  };
  seeds.forEach(add);
  while (queue.length) {
    const p = queue.shift()!;
    const cd: Candy = b.cells[p.r][p.c]!;
    if (cd.special !== SpecialType.NONE) triggers.push({ pos: p, special: cd.special });
    switch (cd.special) {
      case SpecialType.STRIPED_H:
        triggered++;
        rowCells(b, p.r).forEach(add);
        break;
      case SpecialType.STRIPED_V:
        triggered++;
        colCells(b, p.c).forEach(add);
        break;
      case SpecialType.WRAPPED:
        triggered++;
        wrapped.push(p);
        areaCells(b, p, 1).forEach(add);
        break;
      case SpecialType.COLOR_BOMB: {
        triggered++;
        const col = mostFrequentColor(b, [p]);
        if (col >= 0) cellsOfColor(b, col).forEach(add);
        break;
      }
      default:
        break;
    }
  }
  return { cleared: [...cleared.values()], triggers, wrapped, triggered };
}

// ---------------------------------------------------------------- combos

export type ComboType =
  | 'BOMB_BOMB'
  | 'BOMB_COLOR'
  | 'BOMB_STRIPED'
  | 'BOMB_WRAPPED'
  | 'STRIPED_STRIPED'
  | 'STRIPED_WRAPPED'
  | 'WRAPPED_WRAPPED';

export interface ComboPlan {
  type: ComboType;
  /** Candies whose own special must be disabled (they are consumed by the combo). */
  consume: Pos[];
  /** Candies to convert into a special before detonation. */
  convert: { pos: Pos; special: SpecialType }[];
  seeds: Pos[];
}

const isStriped = (s: SpecialType) => s === SpecialType.STRIPED_H || s === SpecialType.STRIPED_V;

/**
 * Detects a special+special (or colour-bomb) combo for two swapped candies.
 * Call with the board state AFTER the swap; `a` and `b` are the two positions.
 * Blast centre for area combos is `b` (the destination of the player's drag).
 * Returns null for ordinary swaps.
 */
export function detectCombo(b: Board, a: Pos, bp: Pos): ComboPlan | null {
  const ca = b.cells[a.r][a.c];
  const cb = b.cells[bp.r][bp.c];
  if (!ca || !cb) return null;
  const sa = ca.special;
  const sb = cb.special;
  if (sa === SpecialType.NONE && sb === SpecialType.NONE) return null;

  const bombA = sa === SpecialType.COLOR_BOMB;
  const bombB = sb === SpecialType.COLOR_BOMB;

  if (bombA && bombB) {
    const seeds: Pos[] = [];
    for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) if (b.mask[r][c]) seeds.push({ r, c });
    return { type: 'BOMB_BOMB', consume: [a, bp], convert: [], seeds };
  }

  if (bombA || bombB) {
    const bombPos = bombA ? a : bp;
    const otherPos = bombA ? bp : a;
    const other = bombA ? cb : ca;
    if (other.special === SpecialType.NONE) {
      return {
        type: 'BOMB_COLOR',
        consume: [bombPos],
        convert: [],
        seeds: [bombPos, ...cellsOfColor(b, other.color)],
      };
    }
    // bomb + striped/wrapped: most frequent colour becomes that special, then detonates
    const color = mostFrequentColor(b, [bombPos, otherPos]);
    const targets = color >= 0 ? cellsOfColor(b, color) : [];
    const convert = targets.map((p) => ({
      pos: p,
      special:
        other.special === SpecialType.WRAPPED
          ? SpecialType.WRAPPED
          : (p.r + p.c) % 2 === 0
            ? SpecialType.STRIPED_H
            : SpecialType.STRIPED_V,
    }));
    return {
      type: other.special === SpecialType.WRAPPED ? 'BOMB_WRAPPED' : 'BOMB_STRIPED',
      consume: [bombPos, otherPos],
      convert,
      seeds: [bombPos, otherPos, ...targets],
    };
  }

  if (isStriped(sa) && isStriped(sb)) {
    return {
      type: 'STRIPED_STRIPED',
      consume: [a, bp],
      convert: [],
      seeds: [...rowCells(b, bp.r), ...colCells(b, bp.c)],
    };
  }
  if ((isStriped(sa) && sb === SpecialType.WRAPPED) || (sa === SpecialType.WRAPPED && isStriped(sb))) {
    const seeds: Pos[] = [];
    for (let d = -1; d <= 1; d++) {
      seeds.push(...rowCells(b, bp.r + d), ...colCells(b, bp.c + d));
    }
    return { type: 'STRIPED_WRAPPED', consume: [a, bp], convert: [], seeds };
  }
  if (sa === SpecialType.WRAPPED && sb === SpecialType.WRAPPED) {
    return { type: 'WRAPPED_WRAPPED', consume: [a, bp], convert: [], seeds: areaCells(b, bp, 2) };
  }
  return null;
}

export { BOMB_COLOR };
