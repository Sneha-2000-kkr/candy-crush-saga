import { GridEngine } from '../core/GridEngine';
import { makeGrid } from '../core/Types';
import { SeededRNG, levelSeed } from './SeededRNG';

export type DifficultyTag = 'normal' | 'hard' | 'boss' | 'relief';

export interface LevelConfig {
  level: number;
  seed: number;
  rows: number;
  cols: number;
  /** 1 = active tile, 0 = hole. */
  mask: number[][];
  /** Ice HP per cell (0..2). */
  ice: number[][];
  /** Honey HP per cell (0..1). */
  honey: number[][];
  numColors: number;
  maxMoves: number;
  tag: DifficultyTag;
  /** 0..1 */
  difficulty: number;
  goals: { targetScore: number; clearIce: boolean; clearHoney: boolean };
}

const SIZE = 8;

/** Every 5th level = Hard, every 10th = Boss, the level right after = Relief. */
export function difficultyTag(level: number): DifficultyTag {
  if (level % 10 === 0) return 'boss';
  if (level % 5 === 0) return 'hard';
  if (level > 1 && (level - 1) % 5 === 0) return 'relief';
  return 'normal';
}

/** Sawtooth: ramps over each 5-level cycle on top of a slow long-term trend. */
export function difficultyValue(level: number): number {
  const trend = 1 - Math.exp(-level / 60);
  const phase = ((level - 1) % 5) / 4; // 0..1 inside the cycle
  const tagAdj = { normal: 0, hard: 0.2, boss: 0.35, relief: -0.25 }[difficultyTag(level)];
  return Math.min(1, Math.max(0, 0.1 + 0.35 * trend + 0.3 * phase + tagAdj));
}

function validMask(mask: number[][]): boolean {
  const rows = mask.length;
  const cols = mask[0].length;
  let start: [number, number] | null = null;
  let total = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!mask[r][c]) continue;
      total++;
      start ??= [r, c];
      let n = 0;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (mask[r + dr]?.[c + dc]) n++;
      if (n < 2) return false;
    }
  if (!start) return false;
  const seen = new Set<number>([start[0] * 100 + start[1]]);
  const stack = [start];
  while (stack.length) {
    const [r, c] = stack.pop()!;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (mask[nr]?.[nc] && !seen.has(nr * 100 + nc)) {
        seen.add(nr * 100 + nc);
        stack.push([nr, nc]);
      }
    }
  }
  return seen.size === total;
}

/** Mirror positions for a symmetric orbit (left/right, optionally top/bottom). */
function orbit(r: number, c: number, rows: number, cols: number, vertical: boolean): [number, number][] {
  const pts: [number, number][] = [[r, c], [r, cols - 1 - c]];
  if (vertical) pts.push([rows - 1 - r, c], [rows - 1 - r, cols - 1 - c]);
  const seen = new Set<number>();
  return pts.filter(([a, b]) => {
    const k = a * 100 + b;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function makeMask(rng: SeededRNG, orbits: number): number[][] {
  for (let attempt = 0; attempt < 30; attempt++) {
    const mask = makeGrid(SIZE, SIZE, 1);
    const vertical = rng.chance(0.5);
    for (let i = 0; i < orbits; i++) {
      const r = rng.range(0, vertical ? SIZE / 2 - 1 : SIZE - 1);
      const c = rng.range(0, SIZE / 2 - 1);
      for (const [pr, pc] of orbit(r, c, SIZE, SIZE, vertical)) mask[pr][pc] = 0;
    }
    if (validMask(mask)) return mask;
  }
  return makeGrid(SIZE, SIZE, 1);
}

function scatter(
  rng: SeededRNG,
  mask: number[][],
  grid: number[][],
  orbits: number,
  value: () => number,
): void {
  const vertical = rng.chance(0.5);
  let placed = 0;
  for (let guard = 0; guard < orbits * 20 && placed < orbits; guard++) {
    const r = rng.range(0, SIZE - 1);
    const c = rng.range(0, SIZE / 2 - 1);
    const pts = orbit(r, c, SIZE, SIZE, vertical).filter(([a, b]) => mask[a][b] && !grid[a][b]);
    if (pts.length === 0) continue;
    const v = value();
    for (const [a, b] of pts) grid[a][b] = v;
    placed++;
  }
}

/** Deterministic: generateLevel(n) always returns an identical config. */
export function generateLevel(level: number): LevelConfig {
  if (!Number.isInteger(level) || level < 1) throw new RangeError(`level must be an integer >= 1 (got ${level})`);
  const seed = levelSeed(level);
  const rng = new SeededRNG(seed ^ 0x51ed270b);
  const tag = difficultyTag(level);
  const d = difficultyValue(level);
  const reliefScale = tag === 'relief' ? 0.5 : 1;

  const numColors = level >= 6 ? 6 : 5;

  // Symmetric cutouts from level 6
  const mask =
    level >= 6 ? makeMask(rng, Math.round((1 + 5 * d) * reliefScale)) : makeGrid(SIZE, SIZE, 1);

  // Ice (single layer from L6, double layers from L20)
  const ice = makeGrid(SIZE, SIZE, 0);
  if (level >= 6) {
    const orbits = Math.max(2, Math.round((2 + 6 * d) * reliefScale));
    scatter(rng, mask, ice, orbits, () => (level >= 20 && rng.chance(0.4 + 0.2 * d) ? 2 : 1));
  }

  // Honey from L12
  const honey = makeGrid(SIZE, SIZE, 0);
  if (level >= 12) {
    const orbits = Math.max(1, Math.round((1 + 3 * d) * reliefScale));
    scatter(rng, mask, honey, orbits, () => 1);
  }

  let maxMoves = 28 - Math.round(10 * d);
  if (level >= 20) maxMoves -= 3; // tighter budgets
  if (tag === 'hard') maxMoves -= 2;
  if (tag === 'boss') maxMoves -= 3;
  if (tag === 'relief') maxMoves += 4;
  maxMoves = Math.max(12, maxMoves);

  const targetScore = Math.round((maxMoves * (70 + 90 * d)) / 50) * 50;
  const hasIce = ice.some((row) => row.some((v) => v > 0));
  const hasHoney = honey.some((row) => row.some((v) => v > 0));

  return {
    level,
    seed,
    rows: SIZE,
    cols: SIZE,
    mask,
    ice,
    honey,
    numColors,
    maxMoves,
    tag,
    difficulty: d,
    goals: { targetScore, clearIce: hasIce, clearHoney: hasHoney },
  };
}

/** Builds a ready-to-play engine (>= 2 valid moves guaranteed), deterministic per level. */
export function createEngineForLevel(config: LevelConfig, assistProbability = 0): GridEngine {
  const engine = new GridEngine({
    mask: config.mask,
    ice: config.ice,
    honey: config.honey,
    numColors: config.numColors,
    rng: new SeededRNG(config.seed),
    assistProbability,
  });
  engine.fillInitial(2);
  return engine;
}

export function isLevelWon(engine: GridEngine, config: LevelConfig): boolean {
  return (
    engine.score >= config.goals.targetScore &&
    (!config.goals.clearIce || engine.iceRemaining() === 0) &&
    (!config.goals.clearHoney || engine.honeyRemaining() === 0)
  );
}
