import Phaser from 'phaser';
import { sound } from '../audio/SoundSynth';
import { difficultyTag } from '../procedural/LevelGenerator';
import { SeededRNG } from '../procedural/SeededRNG';
import { save } from '../storage/SaveManager';

export const W = 720;
export const H = 1280;

const SPACING = 170;
const AMPLITUDE = 210;
const FREQ = 0.62;
const BASE_Y = H - 260; // screen y of level 1 at scroll 0
const NODE_R = 46;
const BIOME_LEN = 15;

interface Biome {
  name: string;
  top: number;
  bottom: number;
  path: number;
  node: number;
  accent: number;
  decor: 'lolly' | 'leaf' | 'flake' | 'star';
}

export const BIOMES: Biome[] = [
  { name: 'Candy Meadow', top: 0x8fe3ff, bottom: 0xb6f5a8, path: 0xfff4c2, node: 0xff6fa5, accent: 0xff4d8d, decor: 'lolly' },
  { name: 'Honey Forest', top: 0xf6b73c, bottom: 0x7a4a14, path: 0xffe29a, node: 0xffb000, accent: 0xff8a00, decor: 'leaf' },
  { name: 'Ice Glacier', top: 0xdff6ff, bottom: 0x5aa9d6, path: 0xffffff, node: 0x4cc9f0, accent: 0x1d7fb8, decor: 'flake' },
  { name: 'Electric Galaxy', top: 0x0b0620, bottom: 0x4b1d8f, path: 0x9be7ff, node: 0xb15cff, accent: 0x00e5ff, decor: 'star' },
];

export const biomeIndex = (level: number) => Math.floor((level - 1) / BIOME_LEN) % BIOMES.length;
export const biomeOf = (level: number) => BIOMES[biomeIndex(level)];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(lerp(ar, br, t)) << 16) | (Math.round(lerp(ag, bg, t)) << 8) | Math.round(lerp(ab, bb, t));
}
const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/** Sky colour at a (fractional) level position, blended across biome borders. */
export function skyColorAt(lp: number): number {
  const b = Math.max(0, (lp - 1) / BIOME_LEN);
  const i = Math.floor(b);
  const f = b - i;
  const cur = BIOMES[i % BIOMES.length];
  const next = BIOMES[(i + 1) % BIOMES.length];
  const c = lerpColor(cur.bottom, cur.top, f);
  return lerpColor(c, lerpColor(next.bottom, next.top, 0), smooth((f - 0.8) / 0.2));
}

export function nodeX(level: number): number {
  return W / 2 + AMPLITUDE * Math.sin(level * FREQ);
}

export class SagaMapScene extends Phaser.Scene {
  private scroll = 0;
  private velocity = 0;
  private dragging = false;
  private dragStartY = 0;
  private dragStartScroll = 0;
  private downPos = { x: 0, y: 0 };
  private moved = false;
  private lastY = 0;
  private bg!: Phaser.GameObjects.Graphics;
  private path!: Phaser.GameObjects.Graphics;
  private nodes = new Map<number, Phaser.GameObjects.Container>();
  private hudTitle!: Phaser.GameObjects.Text;
  private hudSub!: Phaser.GameObjects.Text;
  private muteBtn!: Phaser.GameObjects.Text;
  private dirty = true;

  constructor() {
    super('SagaMapScene');
  }

  private screenY(level: number): number {
    return BASE_Y - (level - 1) * SPACING + this.scroll;
  }

  private levelAtScreenY(y: number): number {
    return (BASE_Y + this.scroll - y) / SPACING + 1;
  }

  create(data: { focus?: number }): void {
    this.nodes.clear();
    this.cameras.main.setBackgroundColor(0x000000);
    this.bg = this.add.graphics().setDepth(0);
    this.path = this.add.graphics().setDepth(1);

    const focus = data?.focus ?? save.unlocked;
    this.scroll = Math.max(0, (focus - 1) * SPACING - (BASE_Y - H * 0.55));
    this.velocity = 0;

    // HUD (fixed)
    this.add.rectangle(W / 2, 70, W, 140, 0x000000, 0.35).setDepth(50);
    this.hudTitle = this.add
      .text(W / 2, 48, '', { fontFamily: 'Arial Black, Arial', fontSize: '44px', color: '#ffffff', stroke: '#000', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(51);
    this.hudSub = this.add
      .text(W / 2, 98, '', { fontFamily: 'Arial', fontSize: '26px', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(51);
    this.muteBtn = this.add
      .text(W - 40, 70, save.muted ? '🔇' : '🔊', { fontSize: '44px' })
      .setOrigin(0.5)
      .setDepth(51)
      .setInteractive({ useHandCursor: true });
    this.muteBtn.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      save.setMuted(!save.muted);
      sound.setMuted(save.muted);
      this.muteBtn.setText(save.muted ? '🔇' : '🔊');
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      sound.unlock();
      sound.setMuted(save.muted);
      this.dragging = true;
      this.moved = false;
      this.dragStartY = p.y;
      this.dragStartScroll = this.scroll;
      this.downPos = { x: p.x, y: p.y };
      this.lastY = p.y;
      this.velocity = 0;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      if (Math.abs(p.y - this.downPos.y) > 12 || Math.abs(p.x - this.downPos.x) > 12) this.moved = true;
      this.setScroll(this.dragStartScroll + (p.y - this.dragStartY));
      this.velocity = p.y - this.lastY;
      this.lastY = p.y;
    });
    const up = (p: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (!this.moved) this.tap(p.x, p.y);
    };
    this.input.on('pointerup', up);
    this.input.on('pointerupoutside', up);
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.setScroll(this.scroll - dy);
    });
    this.scale.on('resize', () => (this.dirty = true));
    this.dirty = true;
  }

  private setScroll(v: number): void {
    this.scroll = Math.max(0, v); // level 1 is the bottom of the world; up is infinite
    this.dirty = true;
  }

  private tap(x: number, y: number): void {
    const approx = Math.round(this.levelAtScreenY(y));
    for (let n = approx - 1; n <= approx + 1; n++) {
      if (n < 1) continue;
      const dx = x - nodeX(n);
      const dy = y - this.screenY(n);
      if (dx * dx + dy * dy <= (NODE_R + 14) ** 2) {
        if (n <= save.unlocked) {
          sound.click();
          this.scene.start('GameScene', { level: n });
        } else {
          this.tweens.add({ targets: this.nodes.get(n), x: nodeX(n) + 8, yoyo: true, repeat: 3, duration: 40 });
          sound.invalid();
        }
        return;
      }
    }
  }

  update(_t: number, dt: number): void {
    if (!this.dragging && Math.abs(this.velocity) > 0.3) {
      this.setScroll(this.scroll + this.velocity * (dt / 16));
      this.velocity *= 0.94;
      if (this.scroll <= 0) this.velocity = 0;
    }
    if (this.dirty) {
      this.redraw();
      this.dirty = false;
    }
  }

  private redraw(): void {
    const top = this.levelAtScreenY(H + SPACING);
    const bottom = this.levelAtScreenY(-SPACING);
    const first = Math.max(1, Math.floor(top));
    const last = Math.ceil(bottom);

    // ---- background strips coloured by position (smooth biome transitions)
    this.bg.clear();
    const STRIP = 32;
    for (let y = 0; y < H; y += STRIP) {
      const lp = this.levelAtScreenY(y + STRIP / 2);
      this.bg.fillStyle(skyColorAt(lp), 1);
      this.bg.fillRect(0, y, W, STRIP + 1);
    }

    // ---- procedural decorations (deterministic per level, only for visible levels)
    for (let n = first; n <= last; n++) {
      const rng = SeededRNG.forLevel(n, 77);
      const biome = biomeOf(n);
      const y = this.screenY(n);
      for (let k = 0; k < 3; k++) {
        const side = rng.chance(0.5) ? -1 : 1;
        const x = W / 2 + side * rng.range(150, 330) + rng.range(-30, 30);
        const dy = y + rng.range(-SPACING / 2, SPACING / 2);
        const s = rng.range(10, 26);
        this.decor(biome, x, dy, s, rng);
      }
    }

    // ---- S-curve path
    this.path.clear();
    for (let pass = 0; pass < 2; pass++) {
      for (let n = Math.max(1, first - 1); n <= last; n++) {
        const biome = biomeOf(n);
        const steps = 10;
        this.path.lineStyle(pass === 0 ? 30 : 18, pass === 0 ? 0x000000 : biome.path, pass === 0 ? 0.25 : 1);
        this.path.beginPath();
        for (let s = 0; s <= steps; s++) {
          const l = n + s / steps;
          const px = W / 2 + AMPLITUDE * Math.sin(l * FREQ);
          const py = this.screenY(l);
          if (s === 0) this.path.moveTo(px, py);
          else this.path.lineTo(px, py);
        }
        this.path.strokePath();
      }
    }

    // ---- virtual scrolling: create / destroy node containers for the visible window
    for (const [n, c] of this.nodes) {
      if (n < first || n > last) {
        c.destroy();
        this.nodes.delete(n);
      }
    }
    for (let n = first; n <= last; n++) {
      let c = this.nodes.get(n);
      if (!c) {
        c = this.makeNode(n);
        this.nodes.set(n, c);
      }
      c.setPosition(nodeX(n), this.screenY(n));
    }

    const cur = Math.max(1, Math.min(Math.round(this.levelAtScreenY(H * 0.5)), 1e9));
    const biome = biomeOf(cur);
    this.hudTitle.setText(biome.name);
    this.hudSub.setText(`Level ${cur}  ·  Zone ${Math.floor((cur - 1) / BIOME_LEN) + 1}  ·  Unlocked ${save.unlocked}`);
  }

  private decor(b: Biome, x: number, y: number, s: number, rng: SeededRNG): void {
    const g = this.bg;
    switch (b.decor) {
      case 'lolly':
        g.fillStyle(0xffffff, 0.8);
        g.fillRect(x - 2, y, 4, s * 1.6);
        g.fillStyle(rng.chance(0.5) ? 0xff6fa5 : 0xffd166, 1);
        g.fillCircle(x, y, s);
        g.fillStyle(0xffffff, 0.7);
        g.fillCircle(x, y, s * 0.45);
        break;
      case 'leaf':
        g.fillStyle(0x4a2c0a, 0.9);
        g.fillRect(x - 4, y, 8, s * 2);
        g.fillStyle(0xffc933, 0.9);
        g.fillTriangle(x - s * 1.2, y + 4, x + s * 1.2, y + 4, x, y - s * 1.8);
        break;
      case 'flake':
        g.lineStyle(3, 0xffffff, 0.85);
        for (let i = 0; i < 3; i++) {
          const a = (i * Math.PI) / 3;
          g.lineBetween(x - Math.cos(a) * s, y - Math.sin(a) * s, x + Math.cos(a) * s, y + Math.sin(a) * s);
        }
        break;
      case 'star':
        g.fillStyle(rng.chance(0.3) ? 0x00e5ff : 0xffffff, 0.9);
        g.fillCircle(x, y, s / 5);
        g.fillStyle(0xffffff, 0.15);
        g.fillCircle(x, y, s / 2);
        break;
    }
  }

  private makeNode(n: number): Phaser.GameObjects.Container {
    const biome = biomeOf(n);
    const unlocked = n <= save.unlocked;
    const stars = save.starsFor(n);
    const tag = difficultyTag(n);
    const c = this.add.container(0, 0).setDepth(10);
    const g = this.add.graphics();
    const base = unlocked ? biome.node : 0x7c7c8a;
    g.fillStyle(0x000000, 0.3);
    g.fillCircle(3, 7, NODE_R);
    g.fillStyle(tag === 'boss' ? 0xff2d55 : tag === 'hard' ? 0xff8a00 : base, 1);
    g.fillCircle(0, 0, NODE_R);
    g.fillStyle(0xffffff, 0.3);
    g.fillEllipse(-10, -18, NODE_R * 0.9, NODE_R * 0.5);
    g.lineStyle(6, n === save.unlocked ? 0xffffff : biome.accent, 1);
    g.strokeCircle(0, 0, NODE_R);
    c.add(g);
    c.add(
      this.add
        .text(0, -2, unlocked ? String(n) : '🔒', {
          fontFamily: 'Arial Black, Arial',
          fontSize: unlocked ? (n >= 1000 ? '30px' : '40px') : '34px',
          color: '#ffffff',
          stroke: '#00000088',
          strokeThickness: 5,
        })
        .setOrigin(0.5),
    );
    if (stars > 0) {
      c.add(this.add.text(0, NODE_R + 18, '★'.repeat(stars) + '☆'.repeat(3 - stars), { fontSize: '26px', color: '#ffd60a', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5));
    }
    if (n === save.unlocked) {
      const ring = this.add.circle(0, 0, NODE_R + 8).setStrokeStyle(5, 0xffffff, 0.9);
      c.add(ring);
      this.tweens.add({ targets: ring, scale: 1.25, alpha: 0, duration: 1100, repeat: -1 });
    }
    return c;
  }
}
