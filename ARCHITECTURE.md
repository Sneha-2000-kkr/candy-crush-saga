Project Architecture & Autonomous Agent Execution Rules

1. Mission & Product Vision
Build a zero-maintenance, mobile-first Infinite Procedural Match-3 Game (Candy Crush style) shipped first as an auto-updating Progressive Web App (PWA) and later packaged as a standalone Android .apk via Capacitor.
- Zero Hardcoded Levels: Every level (1 to infinity) and the Saga Map path must be generated procedurally via deterministic math and seeded PRNG.
- Zero Manual Intervention: Once shipped, the app must endlessly generate new grid shapes, blockers, difficulty curves, and visual themes without requiring code updates.

2. Autonomous Agent Execution Protocol (CRITICAL)
- DO NOT pause or ask for user approval between file edits, terminal commands, dependency installations, or test runs. Execute end-to-end within the requested phase.
- Self-Healing Test Loop: After writing or modifying code in any phase, automatically run the test suite (npm test / Playwright). If any test fails, analyze the stack trace, fix the root cause immediately, and re-run until 100% of tests pass before concluding your turn.
- Strict Decoupling Rule: NEVER import phaser or DOM/window globals inside src/core/ or src/procedural/. The core engine must remain 100% pure TypeScript so headless bots can simulate thousands of games at maximum CPU speed.

3. Tech Stack & Directory Structure
- Build Tool & Language: Vite + TypeScript (Strict Mode)
- Game Engine: Phaser 3 (Canvas/WebGL rendering, tweens, particles, camera shake)
- Audio: Procedural Web Audio API synthesizer (zero external .mp3/.wav dependencies)
- Testing: Vitest (Headless Bot & Unit Tests) + Playwright (Mobile E2E Touch Tests)
- Packaging: PWA (manifest.json + Network-First Service Worker) -> Capacitor (.apk)

Folder Structure:
- ARCHITECTURE.md (This blueprint & agent rulebook)
- index.html (Locked mobile viewport with user-scalable=no)
- public/manifest.json (PWA standalone full-screen config)
- public/sw.js (Network-First Service Worker for silent updates)
- src/core/Types.ts (Grid, Tile, Candy, Blocker, SpecialType interfaces)
- src/core/GridEngine.ts (Dynamic grid masks 0=hole and 1=active, gravity, refills)
- src/core/MatchDetector.ts (3-match, 4-Striped, L/T-Wrapped, 5-ColorBomb, Combos)
- src/core/MoveValidator.ts (Valid swap checker, deadlock detector, auto-shuffler)
- src/procedural/SeededRNG.ts (Deterministic PRNG Mulberry32)
- src/procedural/LevelGenerator.ts (Infinite levels, Sawtooth difficulty, cutouts, Ice/Honey)
- src/procedural/AdaptiveDifficulty.ts (Mercy mechanic: boosts helpful spawns if failStreak >= 2)
- src/audio/SoundSynth.ts (Web Audio API pop, chime, laser & ascending combo tones)
- src/scenes/BootScene.ts (Procedural texture/sprite generation with zero external PNGs)
- src/scenes/SagaMapScene.ts (Infinite math-driven S-curve path + dynamic biomes)
- src/scenes/GameScene.ts (Interactive board, 25px swipe controls, laser/bomb VFX)
- src/storage/SaveManager.ts (localStorage wrapper for level, stars, failStreak)
- src/main.ts (Phaser game bootstrap & SW registration)
- tests/core-mechanics.test.ts (Unit tests for special candies, combos, and holes)
- tests/bot-simulator.test.ts (Headless AI bot playing 200+ levels & 5,000+ cascades)
- tests/e2e-mobile.spec.ts (Playwright mobile viewport 390x844 swipe & save test)

4. Core Game Design & Procedural Rules

A. Multi-Layer Grid Architecture
Each cell (r, c) has three independent layers:
1. Mask Layer (0 | 1): 0 = non-playable cutout/hole (candies neither spawn here nor fall into it; gravity routes vertically past holes).
2. Underlay Blocker (Ice): 0 | 1 | 2 HP. Matching a candy on top reduces Ice HP by 1.
3. Overlay Blocker (Honey): 0 | 1 HP. Locks the candy in place (cannot be swapped) until an adjacent match or special blast clears the Honey.

B. Special Candies & Chain Reactions
- 4-in-a-row: Spawns STRIPED_H or STRIPED_V (clears full row or column).
- L-shape or T-shape (5 tiles): Spawns WRAPPED (explodes 3x3 area twice).
- 5-in-a-row: Spawns COLOR_BOMB (clears all candies of swapped color).
- Special + Special Swaps:
- STRIPED + WRAPPED -> Giant Cross Laser/Electric blast (clears 3 rows + 3 columns).
- COLOR_BOMB + STRIPED/WRAPPED -> Turns all candies of the most frequent color into that special candy and detonates them sequentially.
- COLOR_BOMB + COLOR_BOMB -> Clears entire playable board + damages all Ice/Honey by 1 layer.

C. Infinite Procedural Progression (LevelGenerator.ts)
- Sawtooth Difficulty Curve: Difficulty ramps up over 5-level cycles; every 5th and 10th level is a Hard/Boss Level, followed immediately by a Relief Level (6, 11, 16...).
- Feature Unlocks:
- Level 1-5: Full 8x8 grid, 5 candy colors, score target.
- Level 6+: 6th candy color + symmetric grid cutouts + Level 1 Ice.
- Level 12+: Honey locks introduced.
- Level 20+: 2-layer thick Ice + tighter move budgets.
- Adaptive Difficulty (Mercy Mechanic):
- If failStreak >= 2 on the current level, GridEngine switches spawn weighting to Assist Mode (35% higher probability of spawning colors matching neighbors of empty top slots to encourage natural cascades). Reset failStreak = 0 upon victory.

5. Automated Testing & Quality Gate Specification

Every phase MUST pass these automated checks before moving forward:

Gate 1: Headless Unit & Edge-Case Tests (tests/core-mechanics.test.ts)
- Verify 4-match, L/T-match, and 5-match generate exact special types.
- Verify gravity correctly skips 0 (hole) cells without losing or duplicating candies.
- Verify Honey prevents direct swapping until broken by an adjacent match.
- Verify deadlock detector triggers auto-shuffle when 0 valid moves exist.

Gate 2: Autonomous AI Bot Stress Simulator (tests/bot-simulator.test.ts)
- Bot Logic: Greedy heuristic evaluator that scans all valid swaps, scores each move (+50 for special combo, +30 for Ice/Honey hit, +10 per matched tile), and executes the highest-scoring move.
- Stress Run: Simulate Levels 1 through 200 continuously (up to 5,000+ cascade cycles).
- Mandatory Assertions:
1. 0 infinite cascade loops (max cascade depth safeguard < 50).
2. 0 undefined/null tile corruptions on playable (1) cells.
3. Every generated level starts with >= 2 valid moves (guaranteed solvability).
4. Statistical verification that failStreak >= 2 (Assist Mode) yields a measurably higher average cascade/clear rate than failStreak = 0.

Gate 3: Playwright Mobile E2E Verification (tests/e2e-mobile.spec.ts)
- Emulate iPhone/Android portrait viewport (390x844, hasTouch: true).
- Boot app -> verify SagaMapScene renders Level 1 -> tap Level 1 -> perform simulated touch-swipe gestures on GameScene canvas -> verify score increases -> reload page -> verify localStorage state persists with 0 console errors.
