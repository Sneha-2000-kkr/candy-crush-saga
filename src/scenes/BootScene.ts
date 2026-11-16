import Phaser from 'phaser';
import { SpecialType } from '../core/Types';

export const TEX = 128;
export const CANDY_COLORS = [0xff4d6d, 0xff9f1c, 0xffd60a, 0x38d96b, 0x3a86ff, 0xb15cff];
const SHAPES = ['circle', 'square', 'diamond', 'hex', 'triangle', 'star'] as const;
type Shape = (typeof SHAPES)[number];

export function candyKey(color: number, special: SpecialType): string {
  if (special === SpecialType.COLOR_BOMB) return 'bomb';
  return `c${color}_${special}`;
}

function shade(color: number, f: number): number {
  const c = Phaser.Display.Color.IntegerToColor(color);
  const m = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  return Phaser.Display.Color.GetColor(m(c.red), m(c.green), m(c.blue));
}

function points(shape: Shape, cx: number, cy: number, r: number): Phaser.Math.Vector2[] {
  const pts: Phaser.Math.Vector2[] = [];
  const v = (x: number, y: number) => pts.push(new Phaser.Math.Vector2(x, y));
  switch (shape) {
    case 'diamond':
      v(cx, cy - r * 1.1);
      v(cx + r * 1.1, cy);
      v(cx, cy + r * 1.1);
      v(cx - r * 1.1, cy);
      break;
    case 'hex':
      for (let i = 0; i < 6; i++) v(cx + r * 1.05 * Math.cos((i * Math.PI) / 3), cy + r * 1.05 * Math.sin((i * Math.PI) / 3));
      break;
    case 'triangle':
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        v(cx + r * 1.25 * Math.cos(a), cy + r * 0.25 + r * 1.25 * Math.sin(a));
      }
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? r * 1.15 : r * 0.55;
        v(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
      }
      break;
    default:
      break;
  }
  return pts;
}

function fillShape(g: Phaser.GameObjects.Graphics, shape: Shape, cx: number, cy: number, r: number, color: number): void {
  g.fillStyle(color, 1);
  if (shape === 'circle') g.fillCircle(cx, cy, r);
  else if (shape === 'square') g.fillRoundedRect(cx - r * 0.92, cy - r * 0.92, r * 1.84, r * 1.84, r * 0.38);
  else g.fillPoints(points(shape, cx, cy, r), true);
}

function drawCandy(g: Phaser.GameObjects.Graphics, idx: number, special: SpecialType): void {
  const cx = TEX / 2;
  const cy = TEX / 2;
  const r = 40;
  const color = CANDY_COLORS[idx];
  const shape = SHAPES[idx];
  // soft shadow
  g.fillStyle(0x000000, 0.22);
  g.fillEllipse(cx, cy + r + 6, r * 1.7, 12);
  fillShape(g, shape, cx, cy, r + 4, shade(color, -0.4)); // rim
  fillShape(g, shape, cx, cy, r, color);
  fillShape(g, shape, cx, cy + 2, r * 0.72, shade(color, 0.25)); // inner glow
  // gloss
  g.fillStyle(0xffffff, 0.75);
  g.fillEllipse(cx - r * 0.35, cy - r * 0.42, r * 0.55, r * 0.3);
  g.fillStyle(0xffffff, 0.35);
  g.fillCircle(cx + r * 0.3, cy + r * 0.35, 3.5);

  if (special === SpecialType.STRIPED_H || special === SpecialType.STRIPED_V) {
    g.fillStyle(0xffffff, 0.85);
    const w = r * 1.35;
    for (const o of [-0.5, 0, 0.5]) {
      if (special === SpecialType.STRIPED_H) g.fillRoundedRect(cx - w / 2, cy + o * r - 4, w, 8, 4);
      else g.fillRoundedRect(cx + o * r - 4, cy - w / 2, 8, w, 4);
    }
    g.lineStyle(3, 0xffffff, 0.9);
    g.strokeCircle(cx, cy, r + 8);
  }
  if (special === SpecialType.WRAPPED) {
    g.lineStyle(5, 0xffffff, 0.95);
    g.strokeRoundedRect(cx - r - 6, cy - r - 6, (r + 6) * 2, (r + 6) * 2, 14);
    g.fillStyle(0xffffff, 0.95);
    g.fillTriangle(cx - r - 6, cy, cx - r - 22, cy - 14, cx - r - 22, cy + 14);
    g.fillTriangle(cx + r + 6, cy, cx + r + 22, cy - 14, cx + r + 22, cy + 14);
    g.fillRect(cx - 4, cy - r - 6, 8, (r + 6) * 2);
  }
}

function drawBomb(g: Phaser.GameObjects.Graphics): void {
  const cx = TEX / 2;
  const cy = TEX / 2;
  g.fillStyle(0x000000, 0.25);
  g.fillEllipse(cx, cy + 46, 70, 12);
  g.fillStyle(0x15151f, 1);
  g.fillCircle(cx, cy, 46);
  g.fillStyle(0x2d2f4a, 1);
  g.fillCircle(cx, cy, 40);
  CANDY_COLORS.forEach((col, i) => {
    for (let k = 0; k < 3; k++) {
      const a = (i * 3 + k) * 0.7 + i;
      const d = 14 + ((i * 7 + k * 11) % 20);
      g.fillStyle(col, 1);
      g.fillRoundedRect(cx + Math.cos(a) * d - 6, cy + Math.sin(a) * d - 2.5, 12, 5, 2.5);
    }
  });
  g.fillStyle(0xffffff, 0.55);
  g.fillEllipse(cx - 16, cy - 20, 26, 12);
  g.lineStyle(3, 0xffffff, 0.8);
  g.strokeCircle(cx, cy, 47);
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const bake = (key: string, w = TEX, h = TEX) => {
      g.generateTexture(key, w, h);
      g.clear();
    };

    for (let i = 0; i < CANDY_COLORS.length; i++) {
      for (const sp of [SpecialType.NONE, SpecialType.STRIPED_H, SpecialType.STRIPED_V, SpecialType.WRAPPED]) {
        drawCandy(g, i, sp);
        bake(candyKey(i, sp));
      }
    }
    drawBomb(g);
    bake('bomb');

    // board tile
    g.fillStyle(0xffffff, 0.14);
    g.fillRoundedRect(3, 3, TEX - 6, TEX - 6, 18);
    bake('tile');

    // translucent ice (1 and 2 layers)
    for (const layers of [1, 2]) {
      g.fillStyle(0x9be7ff, layers === 1 ? 0.42 : 0.62);
      g.fillRoundedRect(4, 4, TEX - 8, TEX - 8, 16);
      g.lineStyle(layers === 1 ? 4 : 8, 0xe9fbff, 0.9);
      g.strokeRoundedRect(4, 4, TEX - 8, TEX - 8, 16);
      g.lineStyle(3, 0xffffff, 0.8);
      g.beginPath();
      g.moveTo(22, 40);
      g.lineTo(52, 22);
      g.moveTo(80, 108);
      g.lineTo(108, 84);
      g.moveTo(30, 96);
      g.lineTo(44, 78);
      if (layers === 2) {
        g.moveTo(64, 30);
        g.lineTo(76, 58);
        g.lineTo(60, 76);
      }
      g.strokePath();
      g.fillStyle(0xffffff, 0.35);
      g.fillTriangle(10, 10, 60, 10, 10, 60);
      bake(`ice${layers}`);
    }

    // golden honey cage
    g.fillStyle(0xffb000, 0.28);
    g.fillRoundedRect(6, 6, TEX - 12, TEX - 12, 18);
    g.lineStyle(7, 0xffc933, 1);
    g.strokeRoundedRect(6, 6, TEX - 12, TEX - 12, 18);
    g.lineStyle(6, 0xffd966, 1);
    for (const x of [38, 64, 90]) {
      g.beginPath();
      g.moveTo(x, 8);
      g.lineTo(x, TEX - 8);
      g.strokePath();
    }
    g.lineStyle(6, 0xe69a00, 1);
    g.beginPath();
    g.moveTo(8, 64);
    g.lineTo(TEX - 8, 64);
    g.strokePath();
    g.fillStyle(0xffb000, 0.95);
    for (const x of [20, 56, 100]) g.fillCircle(x, 112, 8);
    g.fillStyle(0xfff0b3, 0.9);
    g.fillCircle(64, 64, 8);
    bake('honey');

    // particles / glow
    for (let i = 8; i >= 1; i--) {
      g.fillStyle(0xffffff, 0.12 + (1 - i / 8) * 0.25);
      g.fillCircle(32, 32, i * 4);
    }
    bake('spark', 64, 64);
    for (let i = 16; i >= 1; i--) {
      g.fillStyle(0xffffff, 0.04);
      g.fillCircle(64, 64, i * 4);
    }
    bake('glow');

    g.destroy();
    this.scene.start('SagaMapScene');
  }
}
