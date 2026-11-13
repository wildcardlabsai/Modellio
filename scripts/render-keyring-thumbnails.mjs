/**
 * Renders a thumbnail for every Keyring Maker template into public/keyring/<id>.jpg, using the
 * real maker in the browser (so thumbnails always match what the template builds).
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/render-keyring-thumbnails.mjs [url]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.argv[2] ?? 'http://localhost:4173';
fs.mkdirSync('public/keyring', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 660 }, deviceScaleFactor: 0.5 });
await page.addInitScript(() => localStorage.setItem('modellio:onboarded', '1'));
await page.goto(URL + '/?studio=keyring', { waitUntil: 'networkidle' });
await page.getByTestId('keyring-studio').waitFor();
await page.getByRole('radio', { name: '3D' }).click();
await page.getByTestId('keyring-viewport').waitFor();
await page.addStyleTag({ content: '[data-testid="keyring-viewport"] > div:not(:first-child){display:none!important}' });
await page.getByRole('radio', { name: /Templates/ }).click();
const ids = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="keyring-template"]')].map((b) => b.getAttribute('data-template')),
);
for (const id of ids) {
  await page.evaluate((id) => window.modellioKeyring.openKeyringTemplate(id), id);
  await page.waitForTimeout(150);
  await page.waitForFunction(
    () => {
      const s = window.modellioKeyring.store.getState();
      return !s.building && s.result;
    },
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(500);
  const box = await page.getByTestId('keyring-viewport').boundingBox();
  const side = Math.min(box.width, box.height) - 20;
  await page.screenshot({
    path: `public/keyring/${id}.jpg`,
    type: 'jpeg',
    quality: 80,
    clip: { x: box.x + (box.width - side) / 2, y: box.y + (box.height - side) / 2, width: side, height: side },
  });
  console.log('✔', id);
}
await browser.close();
