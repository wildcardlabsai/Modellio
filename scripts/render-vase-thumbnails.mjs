/**
 * Renders a thumbnail for every Vase Maker template into public/vase/<id>.jpg, using the
 * real maker in the browser (so thumbnails always match what the template builds).
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/render-vase-thumbnails.mjs [url]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.argv[2] ?? 'http://localhost:4173';
fs.mkdirSync('public/vase', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 560 } });
await page.addInitScript(() => localStorage.setItem('modellio:onboarded', '1'));
await page.goto(URL + '/?studio=vase', { waitUntil: 'networkidle' });
await page.getByTestId('vase-viewport').waitFor();
// Hide the overlay buttons so only the model shows.
await page.addStyleTag({ content: '[data-testid="vase-viewport"] > div:not(:first-child){display:none!important}' });
const ids = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="vase-template"]')].map((b) => b.getAttribute('data-template')),
);
for (const id of ids) {
  await page.evaluate((id) => window.modellioVase.store.getState().applyTemplate(id), id);
  await page.waitForFunction(
    () => {
      const s = window.modellioVase.store.getState();
      return !s.building && s.result;
    },
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(500);
  const box = await page.getByTestId('vase-viewport').boundingBox();
  const side = Math.min(box.width, box.height) - 20;
  await page.screenshot({
    path: `public/vase/${id}.jpg`,
    type: 'jpeg',
    quality: 78,
    clip: { x: box.x + (box.width - side) / 2, y: box.y + (box.height - side) / 2, width: side, height: side },
  });
  console.log('✔', id);
}
await browser.close();
