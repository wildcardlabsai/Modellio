/**
 * Renders the product screenshots used on the landing page into public/landing/.
 * They are real captures of the running app, so they stay truthful as the UI changes.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/render-landing-images.mjs [url]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.argv[2] ?? 'http://localhost:4173';
fs.mkdirSync('public/landing', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 });
await page.addInitScript(() => localStorage.setItem('modellio:onboarded', '1'));

// Design Studio with the desk organiser template, selected so the inspector shows real dimensions.
await page.goto(URL + '/?studio=design', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.evaluate(async () => {
  const { projects, templates, store, computeCombined } = window.modellio;
  await projects.getState().init();
  await projects.getState().createFromTemplate(templates.find((t) => t.id === 'desk-organiser'));
  for (let t = 0; t < 100; t++) {
    const doc = store.getState().doc;
    const groups = Object.values(doc.objects).filter((o) => o.kind === 'group' && o.combine);
    if (groups.every((g) => computeCombined(doc, g.id)?.stale === false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  store.getState().select([store.getState().doc.rootIds[0]]);
});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'public/landing/design-studio.jpg', type: 'jpeg', quality: 82 });

// Split Studio with the built-in multi-colour sample (no selection, so every colour shows at full strength).
await page.goto(URL + '/?studio=split', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Try a sample' }).click();
await page.getByTestId('split-colour').first().waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'public/landing/split-studio.jpg', type: 'jpeg', quality: 82 });

// Cookie maker with the gingerbread shape (cutter, stamp and handle).
await page.goto(URL + '/?studio=cookie', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Gingerbread' }).click();
await page.waitForFunction(
  () => window.modellioCookie.store.getState().result?.parts.length === 3 && !window.modellioCookie.store.getState().building,
  null,
  { timeout: 30000 },
);
await page.waitForTimeout(1200);
await page.screenshot({ path: 'public/landing/cookie-maker.jpg', type: 'jpeg', quality: 82 });

await browser.close();
for (const f of fs.readdirSync('public/landing')) console.log(f, (fs.statSync(`public/landing/${f}`).size / 1024).toFixed(0), 'KB');
