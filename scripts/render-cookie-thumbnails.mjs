/**
 * Renders a thumbnail for every Cookie Maker template into public/cookie/<id>.jpg, from the
 * real maker's design canvas (so thumbnails always match what the template builds).
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/render-cookie-thumbnails.mjs [url]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.argv[2] ?? 'http://localhost:4173';
fs.mkdirSync('public/cookie', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 660 }, deviceScaleFactor: 0.5 });
await page.addInitScript(() => localStorage.setItem('modellio:onboarded', '1'));
await page.goto(URL + '/?studio=cookie', { waitUntil: 'networkidle' });
await page.getByTestId('cookie-studio').waitFor();
// Cookie thumbnails show the design itself (the 3D parts are too small to read side by side).
await page.addStyleTag({
  content: '[data-testid="cookie-mini-preview"],[data-testid="design-canvas"] > div{display:none!important}',
});
await page.getByRole('radio', { name: /Templates/ }).click();
const ids = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="cookie-template"]')].map((b) => b.getAttribute('data-template')),
);
for (const id of ids) {
  await page.evaluate((id) => window.modellioCookie.openCookieTemplate(id), id);
  await page.waitForTimeout(150);
  await page.waitForFunction(
    () => {
      const s = window.modellioCookie.store.getState();
      return !s.building && s.result;
    },
    null,
    { timeout: 30000 },
  );
  await page.evaluate(() => window.modellioCookie.store.getState().select(null));
  await page.waitForTimeout(300);
  const box = await page.getByTestId('design-canvas').boundingBox();
  const side = Math.min(box.width, box.height) * 0.78;
  await page.screenshot({
    path: `public/cookie/${id}.jpg`,
    type: 'jpeg',
    quality: 80,
    clip: { x: box.x + (box.width - side) / 2, y: box.y + (box.height - side) / 2, width: side, height: side },
  });
  console.log('✔', id);
}
await browser.close();
