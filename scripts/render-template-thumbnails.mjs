/**
 * Builds every template in the real app, checks that each Boolean result is
 * valid, and renders the card thumbnails into public/templates/<id>.jpg.
 *
 *   npm run dev
 *   node scripts/render-template-thumbnails.mjs [url]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.addInitScript(() => localStorage.setItem('modellio:onboarded', '1'));
await page.goto(URL + '/?studio=design', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const ids = await page.evaluate(() => window.modellio.templates.map((t) => t.id));
let failed = 0;
for (let i = 0; i < ids.length; i++) {
  const result = await page.evaluate(async (i) => {
    const { projects, templates, store, computeCombined } = window.modellio;
    await projects.getState().createFromTemplate(templates[i]);
    const doc = store.getState().doc;
    const groups = Object.values(doc.objects).filter((o) => o.kind === 'group' && o.combine);
    for (let t = 0; t < 100; t++) {
      const rs = groups.map((g) => computeCombined(store.getState().doc, g.id));
      if (rs.every((r) => r && !r.stale))
        return { objects: Object.keys(doc.objects).length, results: rs.map((r) => ({ error: r.error, tris: r.triangles })) };
      await new Promise((r) => setTimeout(r, 100));
    }
    return { error: 'timeout' };
  }, i);
  const ok = !result.error && result.results.every((r) => !r.error && r.tris > 0);
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✘'} ${ids[i]} — ${JSON.stringify(result)}`);
  await page.waitForTimeout(600);
  const dataUrl = await page.evaluate(() => window.modellio.viewport.captureThumbnail());
  if (dataUrl) fs.writeFileSync(`public/templates/${ids[i]}.jpg`, Buffer.from(dataUrl.split(',')[1], 'base64'));
}
await browser.close();
process.exit(failed ? 1 : 0);
