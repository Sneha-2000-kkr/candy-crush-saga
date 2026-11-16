import Phaser from 'phaser';
import { sound } from '../audio/SoundSynth';
import { GridEngine, MoveResult, SnapCell, TraceStep } from '../core/GridEngine';
import { checkSwap, findValidMoves } from '../core/MoveValidator';
import { Candy, Pos, SpecialType } from '../core/Types';
import { createEngineForLevel, generateLevel, isLevelWon, LevelConfig } from '../procedural/LevelGenerator';
import { save } from '../storage/SaveManager';
import { candyKey, CANDY_COLORS } from './BootScene';
import { biomeOf, H, W } from './SagaMapScene';

const CELL = 80;
const BX = (W - 8 * CELL) / 2;
const BY = 360;
const SPRITE_SCALE = CELL / 104;
const SWIPE_PX = 25;
const HINT_MS = 4000;
const CASCADE_WORDS = ['', '', 'Sweet!', 'Tasty!', 'Delicious!', 'Divine!', 'Sugar Crush!'];

type Tween = Phaser.Types.Tweens.TweenBuilderConfig;

export class GameScene extends Phaser.Scene {
  private level = 1;
  private cfg!: LevelConfig;
  engine!: GridEngine; // public: read by the E2E debug hook
  private sprites = new Map<Candy, Phaser.GameObjects.Image>();
  private iceSprites: (Phaser.GameObjects.Image | null)[][] = [];
  private honeySprites: (Phaser.GameObjects.Image | null)[][] = [];
  private movesLeft = 0;
  private shownScore = 0;
  private busy = true;
  private ended = false;
  private pressed: Pos | null = null;
  private pressPt = { x: 0, y: 0 };
  private fired = false;
  private hintTimer?: Phaser.Time.TimerEvent;
  private hintTweens: Phaser.Tweens.Tween[] = [];
  private hintSprites: Phaser.GameObjects.Image[] = [];
  private fx!: Phaser.GameObjects.Particles.ParticleEmitter;
  private boardMask!: Phaser.Display.Masks.GeometryMask;
  private movesText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private goalText!: Phaser.GameObjects.Text;
  private barFill!: Phaser.GameObjects.Rectangle;

  constructor() {
    super('GameScene');
  }

  init(data: { level?: number }): void {
    this.level = Math.max(1, data?.level ?? save.unlocked);
  }

  // ------------------------------------------------------------------ setup

  create(): void {
    this.sprites.clear();
    this.hintTweens = [];
    this.hintSprites = [];
    this.ended = false;
    this.busy = true;
    this.pressed = null;

    this.cfg = generateLevel(this.level); // deterministic: retry => identical layout
    this.engine = createEngineForLevel(this.cfg, save.adaptive.assistProbability);
    this.engine.trace = true;
    this.movesLeft = this.cfg.maxMoves;
    this.shownScore = 0;

    this.drawBackground();
    const mg = this.make.graphics({ x: 0, y: 0 }, false);
    mg.fillStyle(0xffffff, 1);
    mg.fillRect(0, BY - 12, W, 8 * CELL + 24);
    this.boardMask = mg.createGeometryMask();
    this.drawBoardBase();
    this.buildHud();

    this.fx = this.add
      .particles(0, 0, 'spark', {
        speed: { min: 90, max: 340 },
        lifespan: 520,
        scale: { start: 0.9, end: 0 },
        alpha: { start: 1, end: 0 },
        blendMode: 'ADD',
        emitting: false,
      })
      .setDepth(30);

    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('pointerupoutside', this.onUp, this);
    this.events.once('shutdown', () => {
      this.input.off('pointerdown', this.onDown, this);
      this.input.off('pointermove', this.onMove, this);
      this.input.off('pointerup', this.onUp, this);
      this.input.off('pointerupoutside', this.onUp, this);
    });

    // initial drop-in
    const snap = this.snapshot();
    void this.syncBoard(snap, 'settle').then(() => {
      this.syncOverlays(this.engine.board.ice, this.engine.board.honey, false);
      this.busy = false;
      this.resetIdle();
    });
  }

  private snapshot(): (SnapCell | null)[][] {
    return this.engine.board.cells.map((row) => row.map((c) => (c ? { candy: c, color: c.color, special: c.special } : null)));
  }

  private cx = (c: number) => BX + c * CELL + CELL / 2;
  private cy = (r: number) => BY + r * CELL + CELL / 2;

  private drawBackground(): void {
    const biome = biomeOf(this.level);
    const g = this.add.graphics().setDepth(0);
    const strips = 40;
    for (let i = 0; i < strips; i++) {
      const t = i / (strips - 1);
      const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
      const top = biome.top;
      const bot = biome.bottom;
      const col =
        (lerp((top >> 16) & 255, (bot >> 16) & 255) << 16) |
        (lerp((top >> 8) & 255, (bot >> 8) & 255) << 8) |
        lerp(top & 255, bot & 255);
      g.fillStyle(col, 1);
      g.fillRect(0, (H / strips) * i, W, H / strips + 1);
    }
  }

  private drawBoardBase(): void {
    const b = this.engine.board;
    const g = this.add.graphics().setDepth(1);
    g.fillStyle(0x000000, 0.28);
    g.fillRoundedRect(BX - 14, BY - 14, b.cols * CELL + 28, b.rows * CELL + 28, 26);
    this.iceSprites = Array.from({ length: b.rows }, () => Array<Phaser.GameObjects.Image | null>(b.cols).fill(null));
    this.honeySprites = Array.from({ length: b.rows }, () => Array<Phaser.GameObjects.Image | null>(b.cols).fill(null));
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        if (!b.mask[r][c]) continue;
        this.add.image(this.cx(c), this.cy(r), 'tile').setScale(CELL / TEXSIZE).setDepth(1);
      }
    }
  }

  private buildHud(): void {
    const biome = biomeOf(this.level);
    const tag = this.cfg.tag;
    this.add.rectangle(W / 2, 130, W, 260, 0x000000, 0.35).setDepth(40);
    const back = this.add
      .text(46, 56, '◀', { fontSize: '48px', color: '#ffffff', stroke: '#000', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(41)
      .setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => {
      sound.click();
      this.scene.start('SagaMapScene', { focus: this.level });
    });
    const tagLabel = tag === 'boss' ? '  ·  BOSS' : tag === 'hard' ? '  ·  HARD' : tag === 'relief' ? '  ·  RELAX' : '';
    this.add
      .text(W / 2, 48, `Level ${this.level}${tagLabel}`, { fontFamily: 'Arial Black, Arial', fontSize: '46px', color: '#ffffff', stroke: '#000', strokeThickness: 7 })
      .setOrigin(0.5)
      .setDepth(41);
    this.add.text(W / 2, 92, biome.name, { fontFamily: 'Arial', fontSize: '24px', color: '#ffffffcc' }).setOrigin(0.5).setDepth(41);
    if (save.adaptive.assistActive) {
      this.add.text(W - 30, 56, '🍬 Sweet Assist', { fontFamily: 'Arial', fontSize: '22px', color: '#ffe066' }).setOrigin(1, 0.5).setDepth(41);
    }

    this.add.text(110, 160, 'MOVES', { fontFamily: 'Arial', fontSize: '22px', color: '#ffffffcc' }).setOrigin(0.5).setDepth(41);
    this.movesText = this.add
      .text(110, 208, String(this.movesLeft), { fontFamily: 'Arial Black, Arial', fontSize: '64px', color: '#ffffff', stroke: '#000', strokeThickness: 8 })
      .setOrigin(0.5)
      .setDepth(41);

    this.add.text(W / 2 + 70, 156, 'SCORE', { fontFamily: 'Arial', fontSize: '22px', color: '#ffffffcc' }).setOrigin(0.5).setDepth(41);
    this.scoreText = this.add
      .text(W / 2 + 70, 196, `0 / ${this.cfg.goals.targetScore}`, { fontFamily: 'Arial Black, Arial', fontSize: '38px', color: '#ffffff', stroke: '#000', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(41);
    this.add.rectangle(W / 2 + 70, 236, 400, 18, 0x000000, 0.5).setDepth(41);
    this.barFill = this.add.rectangle(W / 2 + 70 - 200, 236, 1, 14, 0xffd60a).setOrigin(0, 0.5).setDepth(42);
    this.goalText = this.add
      .text(W / 2, 290, '', { fontFamily: 'Arial', fontSize: '28px', color: '#ffffff', stroke: '#000', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(41);
    this.refreshHud();
  }

  private refreshHud(): void {
    this.movesText.setText(String(this.movesLeft));
    const target = this.cfg.goals.targetScore;
    this.scoreText.setText(`${Math.round(this.shownScore)} / ${target}`);
    this.barFill.width = Math.max(1, Math.min(1, this.shownScore / target) * 400);
    const parts: string[] = [];
    if (this.cfg.goals.clearIce) parts.push(`❄ Ice ${this.engine.iceRemaining()}`);
    if (this.cfg.goals.clearHoney) parts.push(`🍯 Honey ${this.engine.honeyRemaining()}`);
    this.goalText.setText(parts.join('     '));
  }

  // ------------------------------------------------------------------ input

  private cellAt(x: number, y: number): Pos | null {
    const c = Math.floor((x - BX) / CELL);
    const r = Math.floor((y - BY) / CELL);
    const b = this.engine.board;
    if (r < 0 || c < 0 || r >= b.rows || c >= b.cols || !b.mask[r][c]) return null;
    return { r, c };
  }

  private onDown(p: Phaser.Input.Pointer): void {
    sound.unlock();
    sound.setMuted(save.muted);
    this.resetIdle();
    if (this.busy || this.ended) return;
    this.pressed = this.cellAt(p.x, p.y);
    this.pressPt = { x: p.x, y: p.y };
    this.fired = false;
  }

  /** Swap triggers as soon as the finger has dragged 25px — no need to lift. */
  private onMove(p: Phaser.Input.Pointer): void {
    if (!this.pressed || this.fired || this.busy || this.ended || !p.isDown) return;
    const dx = p.x - this.pressPt.x;
    const dy = p.y - this.pressPt.y;
    if (Math.hypot(dx, dy) < SWIPE_PX) return;
    this.fired = true;
    const a = this.pressed;
    const b: Pos = Math.abs(dx) > Math.abs(dy) ? { r: a.r, c: a.c + Math.sign(dx) } : { r: a.r + Math.sign(dy), c: a.c };
    void this.attempt(a, b);
  }

  private onUp(): void {
    this.pressed = null;
  }

  // ------------------------------------------------------------------ idle hint

  private resetIdle(): void {
    this.clearHint();
    this.hintTimer?.remove(false);
    if (this.ended) return;
    this.hintTimer = this.time.delayedCall(HINT_MS, () => this.showHint());
  }

  private showHint(): void {
    if (this.busy || this.ended) return;
    const moves = findValidMoves(this.engine.board);
    if (!moves.length) return;
    const m = moves[Math.floor(Math.random() * moves.length)];
    for (const p of [m.a, m.b]) {
      const cd = this.engine.board.cells[p.r][p.c];
      const sp = cd ? this.sprites.get(cd) : undefined;
      if (!sp) continue;
      this.hintSprites.push(sp);
      sp.setDepth(6);
      this.hintTweens.push(
        this.tweens.add({ targets: sp, scale: SPRITE_SCALE * 1.22, duration: 360, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
      );
    }
  }

  private clearHint(): void {
    this.hintTweens.forEach((t) => t.remove());
    this.hintTweens = [];
    this.hintSprites.forEach((s) => {
      if (s.active) s.setScale(SPRITE_SCALE).setDepth(5);
    });
    this.hintSprites = [];
  }

  // ------------------------------------------------------------------ moves

  private tw(config: Tween): Promise<void> {
    return new Promise((res) => this.tweens.add({ ...config, onComplete: () => res() }));
  }

  private spriteAt(p: Pos): Phaser.GameObjects.Image | undefined {
    const cd = this.engine.board.cells[p.r]?.[p.c];
    return cd ? this.sprites.get(cd) : undefined;
  }

  private async attempt(a: Pos, b: Pos): Promise<void> {
    const bd = this.engine.board;
    if (b.r < 0 || b.c < 0 || b.r >= bd.rows || b.c >= bd.cols || !bd.mask[b.r][b.c]) return;
    this.busy = true;
    this.clearHint();
    const check = checkSwap(bd, a, b);
    if (check !== 'ok') {
      // bounce back
      sound.invalid();
      const sa = this.spriteAt(a);
      const sb = this.spriteAt(b);
      if (check === 'honey') {
        const hs = [this.honeySprites[a.r][a.c], this.honeySprites[b.r][b.c]].filter(Boolean) as Phaser.GameObjects.Image[];
        await Promise.all(hs.map((h) => this.tw({ targets: h, x: h.x + 7, yoyo: true, repeat: 3, duration: 40 })));
      } else if (sa && sb) {
        const ax = sa.x, ay = sa.y, bx = sb.x, by = sb.y;
        await Promise.all([
          this.tw({ targets: sa, x: bx, y: by, duration: 110, yoyo: true, ease: 'Sine.easeInOut' }),
          this.tw({ targets: sb, x: ax, y: ay, duration: 110, yoyo: true, ease: 'Sine.easeInOut' }),
        ]);
      }
      this.busy = false;
      this.resetIdle();
      return;
    }

    this.movesLeft--;
    this.refreshHud();
    sound.swap();
    const result: MoveResult = this.engine.swap(a, b);
    await this.playTrace(result.trace);
    this.shownScore = this.engine.score;
    this.refreshHud();

    if (isLevelWon(this.engine, this.cfg)) return this.finish(true);
    if (this.movesLeft <= 0) return this.finish(false);
    this.busy = false;
    this.resetIdle();
  }

  private async playTrace(trace: TraceStep[]): Promise<void> {
    for (const step of trace) {
      if (step.kind === 'board') {
        if (step.reason === 'shuffle') this.banner('No moves — shuffling!', 0xffffff);
        await this.syncBoard(step.grid, step.reason);
        this.syncOverlays(step.ice, step.honey, false);
      } else {
        await this.playClear(step);
      }
    }
  }

  // ------------------------------------------------------------------ rendering sync

  private syncBoard(grid: (SnapCell | null)[][], reason: 'swap' | 'convert' | 'settle' | 'shuffle'): Promise<void> {
    const rows = grid.length;
    const cols = grid[0].length;
    const seen = new Set<Candy>();
    const jobs: Promise<void>[] = [];
    const incoming = Array<number>(cols).fill(0);
    for (let c = 0; c < cols; c++) {
      for (let r = rows - 1; r >= 0; r--) {
        const cell = grid[r][c];
        if (!cell) continue;
        seen.add(cell.candy);
        const key = candyKey(cell.color, cell.special);
        let sp = this.sprites.get(cell.candy);
        const ty = this.cy(r);
        const tx = this.cx(c);
        if (!sp) {
          incoming[c]++;
          sp = this.add.image(tx, BY - incoming[c] * CELL + CELL / 2, key).setScale(SPRITE_SCALE).setDepth(5);
          sp.setMask(this.boardMask); // candies drop in from behind the HUD edge, never over it
          this.sprites.set(cell.candy, sp);
        } else if (sp.texture.key !== key) {
          sp.setTexture(key);
          const s = sp;
          jobs.push(this.tw({ targets: s, scale: SPRITE_SCALE * 1.45, duration: 130, yoyo: true, ease: 'Back.easeOut' }));
          this.sprites.set(cell.candy, sp);
        }
        const dist = Math.abs(sp.y - ty) / CELL;
        const dx = Math.abs(sp.x - tx);
        if (dist > 0.01 || dx > 0.5) {
          const isSwap = reason === 'swap' || reason === 'shuffle';
          jobs.push(
            this.tw({
              targets: sp,
              x: tx,
              y: ty,
              duration: isSwap ? 140 : Math.min(520, 170 + dist * 55),
              ease: isSwap ? 'Sine.easeInOut' : 'Bounce.easeOut',
            }),
          );
        }
      }
    }
    for (const [candy, sp] of this.sprites) {
      if (!seen.has(candy)) {
        sp.destroy();
        this.sprites.delete(candy);
      }
    }
    return Promise.all(jobs).then(() => undefined);
  }

  private syncOverlays(ice: number[][], honey: number[][], animate: boolean): void {
    for (let r = 0; r < ice.length; r++) {
      for (let c = 0; c < ice[0].length; c++) {
        this.overlay(this.iceSprites, r, c, ice[r][c], 'ice', 2, animate);
        this.overlay(this.honeySprites, r, c, honey[r][c], 'honey', 4, animate);
      }
    }
    this.refreshHudOverlays();
  }

  private refreshHudOverlays(): void {
    let ice = 0;
    let honey = 0;
    for (const row of this.iceSprites) for (const s of row) if (s) ice += s.getData('hp') as number;
    for (const row of this.honeySprites) for (const s of row) if (s) honey += 1;
    const parts: string[] = [];
    if (this.cfg.goals.clearIce) parts.push(`❄ Ice ${ice}`);
    if (this.cfg.goals.clearHoney) parts.push(`🍯 Honey ${honey}`);
    this.goalText.setText(parts.join('     '));
  }

  private overlay(
    grid: (Phaser.GameObjects.Image | null)[][],
    r: number,
    c: number,
    hp: number,
    kind: 'ice' | 'honey',
    depth: number,
    animate: boolean,
  ): void {
    const cur = grid[r][c];
    if (hp > 0) {
      const key = kind === 'ice' ? `ice${Math.min(2, hp)}` : 'honey';
      if (!cur) {
        const s = this.add.image(this.cx(c), this.cy(r), key).setScale(CELL / TEXSIZE).setDepth(depth);
        s.setData('hp', hp);
        grid[r][c] = s;
      } else if (cur.getData('hp') !== hp) {
        cur.setTexture(key).setData('hp', hp);
        if (animate) this.tweens.add({ targets: cur, scale: (CELL / TEXSIZE) * 1.12, yoyo: true, duration: 90 });
      }
    } else if (cur) {
      grid[r][c] = null;
      if (animate) {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const shard = this.add
            .image(cur.x, cur.y, 'spark')
            .setTint(kind === 'ice' ? 0xbdf3ff : 0xffc933)
            .setScale(0.6)
            .setDepth(31);
          this.tweens.add({ targets: shard, x: cur.x + Math.cos(a) * 60, y: cur.y + Math.sin(a) * 60, alpha: 0, scale: 0, duration: 420, onComplete: () => shard.destroy() });
        }
        this.tweens.add({
          targets: cur,
          alpha: 0,
          scale: (CELL / TEXSIZE) * (kind === 'ice' ? 1.3 : 0.6),
          y: kind === 'honey' ? cur.y + 20 : cur.y,
          duration: 300,
          onComplete: () => cur.destroy(),
        });
      } else cur.destroy();
    }
  }

  // ------------------------------------------------------------------ VFX

  private async playClear(step: Extract<TraceStep, { kind: 'clear' }>): Promise<void> {
    const jobs: Promise<void>[] = [];
    const pos = (p: Pos) => ({ x: this.cx(p.c), y: this.cy(p.r) });

    sound.pop(Math.max(0, step.level - 1));
    let beams = 0;
    let boom = false;

    // special detonations
    for (const t of step.triggers) {
      const p = pos(t.pos);
      if (t.special === SpecialType.STRIPED_H) {
        this.beam(BX - 30, p.y, BX + 8 * CELL + 30, p.y, 0x66f0ff, 16);
        beams++;
      } else if (t.special === SpecialType.STRIPED_V) {
        this.beam(p.x, BY - 30, p.x, BY + 8 * CELL + 30, 0x66f0ff, 16);
        beams++;
      } else if (t.special === SpecialType.COLOR_BOMB) {
        step.cleared.slice(0, 40).forEach((c) => this.lightning(p.x, p.y, pos(c.pos).x, pos(c.pos).y, 0xff7bff));
        beams++;
      }
    }
    for (const b of step.bursts) {
      this.ring(pos(b).x, pos(b).y, CELL * 1.6, 0xffe066);
      boom = true;
    }
    // special + special combos
    if (step.combo && step.comboCenter) {
      const p = pos(step.comboCenter);
      beams++;
      switch (step.combo) {
        case 'STRIPED_STRIPED':
          this.beam(BX - 30, p.y, BX + 8 * CELL + 30, p.y, 0xff5cf4, 26);
          this.beam(p.x, BY - 30, p.x, BY + 8 * CELL + 30, 0xff5cf4, 26);
          break;
        case 'STRIPED_WRAPPED':
          for (let d = -1; d <= 1; d++) {
            this.beam(BX - 30, p.y + d * CELL, BX + 8 * CELL + 30, p.y + d * CELL, 0xff5cf4, 30);
            this.beam(p.x + d * CELL, BY - 30, p.x + d * CELL, BY + 8 * CELL + 30, 0xff5cf4, 30);
          }
          boom = true;
          break;
        case 'WRAPPED_WRAPPED':
          this.ring(p.x, p.y, CELL * 3.2, 0xff5cf4);
          boom = true;
          break;
        case 'BOMB_BOMB':
          this.cameras.main.flash(320, 255, 255, 255);
          for (let i = 0; i < 18; i++) this.lightning(p.x, p.y, BX + Math.random() * 8 * CELL, BY + Math.random() * 8 * CELL, 0x9be7ff);
          boom = true;
          break;
        default:
          step.cleared.slice(0, 45).forEach((c) => this.lightning(p.x, p.y, pos(c.pos).x, pos(c.pos).y, 0x9be7ff));
          break;
      }
    }
    if (beams) sound.laser();
    if (boom) sound.boom();
    if (step.spawns.length) sound.chime();

    // pop the cleared candies
    for (const c of step.cleared) {
      const sp = this.sprites.get(c.candy);
      if (!sp) continue;
      this.sprites.delete(c.candy);
      const p = pos(c.pos);
      const col = c.special === SpecialType.COLOR_BOMB ? 0xffffff : CANDY_COLORS[c.color] ?? 0xffffff;
      this.fx.setParticleTint(col);
      this.fx.explode(4, p.x, p.y);
      jobs.push(
        this.tw({ targets: sp, scale: SPRITE_SCALE * 1.35, alpha: 0, duration: 180, ease: 'Quad.easeOut' }).then(() => sp.destroy()),
      );
    }

    // ice / honey
    this.syncOverlays(step.ice, step.honey, true);

    // juice: shake, popup, combo word
    const big = step.triggers.length > 0 || !!step.combo || step.bursts.length > 0;
    if (big || step.cleared.length >= 6) {
      const inten = Math.min(0.02, 0.003 + step.cleared.length * 0.0003 + (step.combo ? 0.006 : 0) + (big ? 0.003 : 0));
      this.cameras.main.shake(big ? 260 : 150, inten);
    }
    if (step.cleared.length) {
      const sum = step.cleared.reduce((a, c) => ({ x: a.x + this.cx(c.pos.c), y: a.y + this.cy(c.pos.r) }), { x: 0, y: 0 });
      this.popup(sum.x / step.cleared.length, sum.y / step.cleared.length, `+${step.score}`, step.level);
    }
    if (step.level >= 2 && CASCADE_WORDS[Math.min(step.level, CASCADE_WORDS.length - 1)]) {
      this.banner(CASCADE_WORDS[Math.min(step.level, CASCADE_WORDS.length - 1)], 0xffe066);
    }

    this.shownScore += step.score;
    this.refreshHud();
    jobs.push(new Promise<void>((res) => this.time.delayedCall(beams || boom ? 340 : 200, () => res())));
    await Promise.all(jobs);
  }

  private popup(x: number, y: number, text: string, level: number): void {
    const t = this.add
      .text(x, y, text, {
        fontFamily: 'Arial Black, Arial',
        fontSize: `${Math.min(64, 34 + level * 6)}px`,
        color: '#fff7b0',
        stroke: '#a84300',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(60)
      .setScale(0.4);
    this.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: y - 110, alpha: 0, delay: 350, duration: 650, onComplete: () => t.destroy() });
  }

  private banner(text: string, color: number): void {
    const t = this.add
      .text(W / 2, BY + 4 * CELL, text, {
        fontFamily: 'Arial Black, Arial',
        fontSize: '70px',
        color: '#' + color.toString(16).padStart(6, '0'),
        stroke: '#3a0ca3',
        strokeThickness: 10,
      })
      .setOrigin(0.5)
      .setDepth(70)
      .setScale(0.3)
      .setAngle(-6);
    this.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 60, delay: 650, duration: 350, onComplete: () => t.destroy() });
  }

  /** Glowing laser beam: layered additive strokes (+ WebGL Glow FX when available). */
  private beam(x1: number, y1: number, x2: number, y2: number, color: number, thick: number): void {
    const g = this.add.graphics().setDepth(25).setBlendMode(Phaser.BlendModes.ADD);
    const layers: [number, number, number][] = [
      [thick * 3, color, 0.18],
      [thick * 1.7, color, 0.4],
      [thick * 0.7, 0xffffff, 1],
    ];
    for (const [w, col, a] of layers) {
      g.lineStyle(w, col, a);
      g.lineBetween(x1, y1, x2, y2);
    }
    this.glow(g, color);
    this.tweens.add({ targets: g, alpha: 0, duration: 420, delay: 80, onComplete: () => g.destroy() });
    this.fx.setParticleTint(color);
    for (let i = 0; i < 6; i++) this.fx.explode(2, x1 + (x2 - x1) * (i / 5), y1 + (y2 - y1) * (i / 5));
  }

  /** Jagged electric arc. */
  private lightning(x1: number, y1: number, x2: number, y2: number, color: number): void {
    const g = this.add.graphics().setDepth(25).setBlendMode(Phaser.BlendModes.ADD);
    const n = 9;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const off = i === 0 || i === n ? 0 : (Math.random() - 0.5) * 28;
      pts.push({ x: x1 + dx * t + nx * off, y: y1 + dy * t + ny * off });
    }
    for (const [w, col, a] of [[14, color, 0.25], [6, color, 0.6], [2.5, 0xffffff, 1]] as [number, number, number][]) {
      g.lineStyle(w, col, a);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach((p) => g.lineTo(p.x, p.y));
      g.strokePath();
    }
    this.glow(g, color);
    this.tweens.add({ targets: g, alpha: 0, duration: 360, delay: 60, onComplete: () => g.destroy() });
  }

  private ring(x: number, y: number, radius: number, color: number): void {
    const g = this.add.graphics().setDepth(25).setBlendMode(Phaser.BlendModes.ADD);
    g.lineStyle(14, color, 0.9);
    g.strokeCircle(0, 0, radius);
    g.fillStyle(color, 0.25);
    g.fillCircle(0, 0, radius);
    g.setPosition(x, y).setScale(0.2);
    this.glow(g, color);
    this.tweens.add({ targets: g, scale: 1, alpha: 0, duration: 420, ease: 'Cubic.easeOut', onComplete: () => g.destroy() });
  }

  private glow(obj: Phaser.GameObjects.Graphics, color: number): void {
    if (this.game.renderer.type !== Phaser.WEBGL) return;
    try {
      obj.postFX?.addGlow(color, 4, 0, false, 0.1, 12);
    } catch {
      /* FX unsupported: layered strokes already look glowy */
    }
  }

  // ------------------------------------------------------------------ end of level

  private finish(won: boolean): void {
    this.ended = true;
    this.busy = true;
    this.hintTimer?.remove(false);
    this.clearHint();
    const target = this.cfg.goals.targetScore;
    let stars = 0;
    if (won) {
      stars = this.engine.score >= target * 1.6 ? 3 : this.engine.score >= target * 1.25 ? 2 : 1;
      save.completeLevel(this.level, stars);
      sound.win();
    } else {
      save.failLevel();
      sound.fail();
    }

    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.6).setDepth(100).setAlpha(0);
    this.tweens.add({ targets: dim, alpha: 1, duration: 250 });
    const panel = this.add.graphics().setDepth(101);
    panel.fillStyle(0x2b1055, 0.97);
    panel.fillRoundedRect(W / 2 - 290, 330, 580, 520, 36);
    panel.lineStyle(8, won ? 0xffd60a : 0xff4d6d, 1);
    panel.strokeRoundedRect(W / 2 - 290, 330, 580, 520, 36);
    const title = this.add
      .text(W / 2, 410, won ? 'Level Complete!' : 'Out of Moves', { fontFamily: 'Arial Black, Arial', fontSize: '56px', color: won ? '#ffd60a' : '#ff8fa3', stroke: '#000', strokeThickness: 8 })
      .setOrigin(0.5)
      .setDepth(102);
    const starsText = this.add
      .text(W / 2, 520, won ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '', { fontSize: '96px', color: '#ffd60a', stroke: '#000', strokeThickness: 8 })
      .setOrigin(0.5)
      .setDepth(102)
      .setScale(0.2);
    this.tweens.add({ targets: starsText, scale: 1, duration: 500, ease: 'Back.easeOut', delay: 200 });
    const streak = save.failStreak;
    const msg = won
      ? `Score ${this.engine.score}`
      : `Score ${this.engine.score} / ${target}` + (streak >= 2 ? '\nA little extra sweetness will help next try!' : '');
    this.add.text(W / 2, 620, msg, { fontFamily: 'Arial', fontSize: '30px', color: '#ffffff', align: 'center' }).setOrigin(0.5).setDepth(102);
    void title;

    if (won) {
      this.button(W / 2, 730, 'Next Level ▶', 0x38d96b, () => this.scene.start('GameScene', { level: this.level + 1 }));
      this.button(W / 2, 810, 'Map', 0x3a86ff, () => this.scene.start('SagaMapScene', { focus: this.level + 1 }), 0.7);
    } else {
      this.button(W / 2, 730, 'Try Again', 0xff9f1c, () => this.scene.start('GameScene', { level: this.level }));
      this.button(W / 2, 810, 'Map', 0x3a86ff, () => this.scene.start('SagaMapScene', { focus: this.level }), 0.7);
    }
  }

  private button(x: number, y: number, label: string, color: number, cb: () => void, scale = 1): void {
    const bg = this.add.graphics().setDepth(102);
    bg.fillStyle(color, 1);
    bg.fillRoundedRect(-200 * scale, -34 * scale, 400 * scale, 68 * scale, 30);
    bg.lineStyle(4, 0xffffff, 0.8);
    bg.strokeRoundedRect(-200 * scale, -34 * scale, 400 * scale, 68 * scale, 30);
    bg.setPosition(x, y);
    this.add
      .text(x, y, label, { fontFamily: 'Arial Black, Arial', fontSize: `${Math.round(38 * scale)}px`, color: '#ffffff', stroke: '#000', strokeThickness: 5 })
      .setOrigin(0.5)
      .setDepth(103);
    const hit = this.add.rectangle(x, y, 400 * scale, 68 * scale, 0xffffff, 0.001).setDepth(104).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => {
      sound.click();
      cb();
    });
  }
}

const TEXSIZE = 128;
