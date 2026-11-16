// One-off: renders PWA icons (public/icon-192.png, icon-512.png) with Playwright's Chromium.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [192, 512]) {
  const dataUrl = await page.evaluate((s) => {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#5b2bb8');
    g.addColorStop(1, '#2b1055');
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
    const cols = ['#ff4d6d', '#ffd60a', '#38d96b', '#3a86ff'];
    [[0.32, 0.32], [0.68, 0.32], [0.32, 0.68], [0.68, 0.68]].forEach(([a, b], i) => {
      x.fillStyle = cols[i];
      x.beginPath();
      x.arc(s * a, s * b, s * 0.15, 0, 7);
      x.fill();
      x.fillStyle = 'rgba(255,255,255,.7)';
      x.beginPath();
      x.ellipse(s * a - s * 0.05, s * b - s * 0.06, s * 0.05, s * 0.03, 0, 0, 7);
      x.fill();
    });
    return c.toDataURL('image/png');
  }, size);
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), Buffer.from(dataUrl.split(',')[1], 'base64'));
}
await browser.close();
console.log('icons written');
