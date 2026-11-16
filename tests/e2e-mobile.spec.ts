import { CDPSession, expect, Page, test } from '@playwright/test';

/* Gate 3 — mobile portrait (390x844, hasTouch) E2E against the production build. */

const GAME_W = 720;
const GAME_H = 1280;
// board geometry mirrors GameScene (BX=40, BY=360, CELL=80)
const cellX = (c: number) => 40 + c * 80 + 40;
const cellY = (r: number) => 360 + r * 80 + 40;

type TouchType = 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';
type AnyScene = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function toPage(page: Page, gx: number, gy: number) {
  const r = await page.evaluate(() => {
    const b = document.querySelector('canvas')!.getBoundingClientRect();
    return { left: b.left, top: b.top, w: b.width, h: b.height };
  });
  return { x: r.left + (gx * r.w) / GAME_W, y: r.top + (gy * r.h) / GAME_H };
}

class Touch {
  constructor(
    private cdp: CDPSession,
    private page: Page,
  ) {}
  private send(type: TouchType, x?: number, y?: number) {
    return this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x: x!, y: y!, id: 1 }],
    });
  }
  async tapGame(gx: number, gy: number) {
    const p = await toPage(this.page, gx, gy);
    await this.send('touchStart', p.x, p.y);
    await this.page.waitForTimeout(40);
    await this.send('touchEnd');
  }
}

const sceneActive = (page: Page, key: string) =>
  page.waitForFunction((k) => (window as any).__candy?.game?.scene?.isActive(k), key, { timeout: 30_000 });

const gameReady = (page: Page) =>
  page.waitForFunction(
    () => {
      const s = (window as any).__candy?.game?.scene?.getScene('GameScene');
      return !!s && (window as any).__candy.game.scene.isActive('GameScene') && s.busy === false && s.sprites?.size > 0;
    },
    undefined,
    { timeout: 30_000 },
  );

const sceneGet = <T>(page: Page, fn: (s: AnyScene) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__candy.game.scene.getScene('GameScene'))`) as Promise<T>;

/** Real touch swipe: touchstart -> touchmove (<25px: nothing) -> touchmove (>25px: swap fires) -> touchend. */
async function swipeValidMove(page: Page, cdp: CDPSession, expectInstantSwap: boolean) {
  const move = await page.evaluate(() => (window as any).__candy.validMoves()[0] as { a: { r: number; c: number }; b: { r: number; c: number } });
  const dr = move.b.r - move.a.r;
  const dc = move.b.c - move.a.c;
  const start = await toPage(page, cellX(move.a.c), cellY(move.a.r));
  const scale = (await toPage(page, 1, 0)).x - (await toPage(page, 0, 0)).x; // css px per game px
  const send = (type: TouchType, x?: number, y?: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: x!, y: y!, id: 1 }],
    });

  const movesBefore = await sceneGet(page, (s) => s.movesLeft);
  await send('touchStart', start.x, start.y);
  // 10 game-px drag (< 25px threshold): must NOT swap
  await send('touchMove', start.x + dc * 10 * scale, start.y + dr * 10 * scale);
  await page.waitForTimeout(80);
  expect(await sceneGet(page, (s) => s.movesLeft)).toBe(movesBefore);
  // 40 game-px drag (> 25px): swap must fire while the finger is still down
  await send('touchMove', start.x + dc * 40 * scale, start.y + dr * 40 * scale);
  if (expectInstantSwap) {
    await page.waitForFunction(
      (before) => (window as any).__candy.game.scene.getScene('GameScene').movesLeft < (before as number),
      movesBefore,
      { timeout: 5_000 },
    );
  }
  await send('touchEnd');
  return movesBefore;
}

test.describe('Gate 3 — mobile E2E', () => {
  test('PWA shell: locked viewport, manifest, network-first service worker', async ({ page, request }) => {
    await page.goto('/');
    const viewport = await page.locator('meta[name=viewport]').getAttribute('content');
    expect(viewport).toContain('user-scalable=no');
    expect(viewport).toContain('maximum-scale=1');
    const css = await page.evaluate(() => ({
      body: getComputedStyle(document.body).touchAction,
      html: getComputedStyle(document.documentElement).touchAction,
      overscroll: getComputedStyle(document.body).overscrollBehaviorY,
    }));
    expect(css.body).toBe('none');
    expect(css.html).toBe('none');
    expect(css.overscroll).toBe('none');

    const manifestHref = await page.locator('link[rel=manifest]').getAttribute('href');
    const res = await request.get(manifestHref!);
    expect(res.ok()).toBeTruthy();
    const manifest = await res.json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('portrait');
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBeTruthy();

    // service worker registered by main.ts and active
    const swState = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return { scope: reg.scope, active: reg.active?.state, url: reg.active?.scriptURL };
    });
    expect(swState.active).toBe('activated');
    expect(swState.url).toContain('/sw.js');
    const sw = await (await request.get('/sw.js')).text();
    expect(sw).toContain('fetch(req)'); // network first
    expect(sw).toMatch(/catch\(\(\) => caches\.match/); // cache only as fallback
  });

  test('full flow: map -> swipe -> score -> fail modal -> win modal -> reload persistence, zero errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));

    await page.goto('/');
    const cdp = await page.context().newCDPSession(page);
    const touch = new Touch(cdp, page);

    // ---- SagaMapScene renders Level 1
    await sceneActive(page, 'SagaMapScene');
    await page.waitForFunction(() => (window as any).__candy.game.scene.getScene('SagaMapScene').nodes.has(1));
    const node1 = await page.evaluate(() => {
      const n = (window as any).__candy.game.scene.getScene('SagaMapScene').nodes.get(1);
      return { x: n.x, y: n.y };
    });
    expect(node1.y).toBeGreaterThan(0);
    expect(node1.y).toBeLessThan(GAME_H);
    expect(await page.evaluate(() => (window as any).__candy.save.unlocked)).toBe(1);

    // ---- tap Level 1 (real touch)
    await touch.tapGame(node1.x, node1.y);
    await sceneActive(page, 'GameScene');
    await gameReady(page);
    expect(await sceneGet(page, (s) => s.level)).toBe(1);
    const startMoves = await sceneGet(page, (s) => s.movesLeft);

    // ---- real swipe: score updates, swap fires before finger lift
    await swipeValidMove(page, cdp, true);
    await page.waitForFunction(
      () => {
        const s = (window as any).__candy.game.scene.getScene('GameScene');
        return s.busy === false && s.engine.score > 0 && s.shownScore === s.engine.score;
      },
      undefined,
      { timeout: 60_000 },
    );
    const afterSwipe = await sceneGet(page, (s) => ({ score: s.engine.score, moves: s.movesLeft, text: s.scoreText.text as string, integrity: s.engine.validateIntegrity() }));
    expect(afterSwipe.score).toBeGreaterThan(0);
    expect(afterSwipe.moves).toBe(startMoves - 1);
    expect(afterSwipe.text).toContain(String(afterSwipe.score));
    expect(afterSwipe.integrity).toBeNull();

    // ---- FAIL modal: last move, unreachable target
    await sceneGet(page, (s) => {
      s.movesLeft = 1;
      s.cfg.goals.targetScore = 1_000_000;
      return true;
    });
    await swipeValidMove(page, cdp, false);
    await page.waitForFunction(() => (window as any).__candy.game.scene.getScene('GameScene').ended === true, undefined, { timeout: 60_000 });
    const failTexts = await sceneGet(page, (s) => s.children.list.filter((o: AnyScene) => typeof o.text === 'string').map((o: AnyScene) => o.text as string));
    expect(failTexts).toContain('Out of Moves');
    expect(await page.evaluate(() => localStorage.getItem('candy.failStreak'))).toBe('1');

    // Try Again (tap the button) -> fresh identical level
    await touch.tapGame(GAME_W / 2, 730);
    await page.waitForFunction(() => {
      const s = (window as any).__candy.game.scene.getScene('GameScene');
      return s.ended === false && s.busy === false && s.movesLeft > 1 && s.sprites.size > 0;
    });
    expect(await sceneGet(page, (s) => s.movesLeft)).toBe(startMoves);

    // ---- WIN modal: trivial target
    await sceneGet(page, (s) => {
      s.cfg.goals.targetScore = 1;
      return true;
    });
    await swipeValidMove(page, cdp, false);
    await page.waitForFunction(() => (window as any).__candy.game.scene.getScene('GameScene').ended === true, undefined, { timeout: 60_000 });
    const winTexts = await sceneGet(page, (s) => s.children.list.filter((o: AnyScene) => typeof o.text === 'string').map((o: AnyScene) => o.text as string));
    expect(winTexts).toContain('Level Complete!');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('candy.save.v1')!));
    expect(saved.unlocked).toBe(2);
    expect(saved.stars['1']).toBeGreaterThanOrEqual(1);
    expect(await page.evaluate(() => localStorage.getItem('candy.failStreak'))).toBe('0'); // reset on win

    // Map button -> SagaMapScene focused on level 2
    await touch.tapGame(GAME_W / 2, 810);
    await sceneActive(page, 'SagaMapScene');
    await page.waitForFunction(() => (window as any).__candy.game.scene.getScene('SagaMapScene').nodes.has(2));

    // ---- reload: progress persists
    await page.reload();
    await sceneActive(page, 'SagaMapScene');
    const after = await page.evaluate(() => ({
      unlocked: (window as any).__candy.save.unlocked,
      stars1: (window as any).__candy.save.starsFor(1),
      raw: JSON.parse(localStorage.getItem('candy.save.v1')!),
    }));
    expect(after.unlocked).toBe(2);
    expect(after.stars1).toBeGreaterThanOrEqual(1);
    expect(after.raw.unlocked).toBe(2);
    await page.waitForFunction(() => (window as any).__candy.game.scene.getScene('SagaMapScene').nodes.has(2));

    // ---- zero console / page errors for the whole session
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
