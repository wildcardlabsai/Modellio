/**
 * Capture a real screenshot of the Design Studio for the landing page:
 *   public/landing/design-studio-2026.jpg (1600 × 1000).
 * Run against `vite preview`:  node scripts/render-studio-shot.mjs [url]
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.argv[2] ?? 'http://localhost:4173';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1600 / 1440 });
await ctx.addInitScript(() => localStorage.setItem('modellio:onboarded', '1'));
const page = await ctx.newPage();
await page.goto(`${URL}/?studio=design`, { waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const s = window.modellio.store.getState();
  s.selectAll();
  s.deleteSelected();
  const id = s.addShape('gear', [0, 0], { exact: true });
  s.setSize(id, [60, 60, 12]);
  s.setPosition(id, [0, 0, 6]);
  s.setParam(id, 'teeth', 14);
  s.setParam(id, 'bore', 22);
  s.setColor(id, '#7C3AED');
  s.rename(id, 'Gear');
  s.select([id]);
  s.requestFrame();
});
await page.waitForTimeout(2500);
await page.screenshot({ path: 'public/landing/design-studio-2026.jpg', type: 'jpeg', quality: 86 });
console.log('saved public/landing/design-studio-2026.jpg');
await browser.close();
