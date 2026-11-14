/**
 * Photographs the makers' real 3D output on a transparent background for the landing page,
 * dashboard and maker cards (public/landing/hero-*.webp and maker-*.webp). Uses product-shot
 * mode (`?shot=1`: no grid, transparent clear colour), then trims and converts with Python/PIL.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/render-product-shots.mjs [url]
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.argv[2] ?? 'http://localhost:4173';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'modellio-shots-'));
fs.mkdirSync('public/landing', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  localStorage.setItem('modellio:onboarded', '1');
  for (const k of ['modellio:keyring', 'modellio:keytag', 'modellio:sign', 'modellio:cookie-design', 'modellio:vase'])
    localStorage.removeItem(k);
});
// Everything but the 3D canvas is hidden and transparent.
const ONLY_CANVAS = `
  *{background:transparent!important;box-shadow:none!important;border-color:transparent!important}
  header,nav,aside,[data-testid$="-header"],[data-testid$="-mini-preview"],button,[role=radiogroup],p,h1,h2,span{visibility:hidden!important}
  canvas{visibility:visible!important}
`;

async function shot(file, viewport) {
  await page.addStyleTag({ content: ONLY_CANVAS });
  await page.waitForTimeout(900);
  const box = await page.locator(viewport).boundingBox();
  const raw = path.join(TMP, `${file}.png`);
  await page.screenshot({ path: raw, clip: box, omitBackground: true });
  // Trim the transparent margin, fit within 900 px, save as WebP with alpha.
  execFileSync('python3', [
    '-I',
    '-c',
    `import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA')
bb = im.getbbox()
im = im.crop(bb)
im.thumbnail((900, 900))
im.save(sys.argv[2], 'WEBP', quality=88, method=6)`,
    raw,
    `public/landing/${file}.webp`,
  ]);
  console.log('✔', file);
}

async function plaque(studio, key, template, file) {
  await page.goto(`${URL}/?studio=${studio}&shot=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction((k) => window[k], key);
  await page.evaluate(([k, t]) => window[k].openTemplate(t), [key, template]);
  await page.waitForTimeout(200);
  await page.waitForFunction((k) => !window[k].store.getState().building && window[k].store.getState().result, key, { timeout: 30000 });
  await page.getByRole('radio', { name: '3D', exact: true }).click();
  await shot(file, `[data-testid="${studio}-viewport"]`);
}

async function vase(template, file) {
  await page.goto(`${URL}/?studio=vase&shot=1`, { waitUntil: 'networkidle' });
  await page.evaluate((t) => window.modellioVase.store.getState().applyTemplate(t), template);
  await page.waitForTimeout(200);
  await page.waitForFunction(() => !window.modellioVase.store.getState().building && window.modellioVase.store.getState().result, null, {
    timeout: 30000,
  });
  await shot(file, '[data-testid="vase-viewport"]');
}

async function cookie(template, file) {
  await page.goto(`${URL}/?studio=cookie&shot=1`, { waitUntil: 'networkidle' });
  await page.evaluate((t) => window.modellioCookie.openCookieTemplate(t), template);
  await page.waitForTimeout(200);
  await page.waitForFunction(
    () => !window.modellioCookie.store.getState().building && window.modellioCookie.store.getState().result,
    null,
    { timeout: 30000 },
  );
  await page.getByRole('radio', { name: '3D', exact: true }).click();
  await shot(file, '[data-testid="cookie-viewport"]');
}

await plaque('keyring', 'modellioKeyring', 'script', 'hero-keyring');
await plaque('sign', 'modellioSign', 'house-number', 'hero-sign');
await vase('spiral-star', 'hero-vase');
await vase('ribbed-planter', 'hero-planter');
await plaque('keyring', 'modellioKeyring', 'gamer', 'maker-keyring');
await plaque('keytag', 'modellioKeyTag', 'locker', 'maker-keytag');
await plaque('sign', 'modellioSign', 'arch-welcome', 'maker-sign');
await vase('twisted-hex', 'maker-vase');
await cookie('gingerbread', 'maker-cookie');

// Split Studio: the built-in multi-colour sample, split into parts.
await page.goto(`${URL}/?studio=split&shot=1`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Try a sample' }).click();
await page.getByTestId('split-colour').first().waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);
await shot('maker-split', 'canvas');

await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });
for (const f of fs.readdirSync('public/landing').filter((f) => f.endsWith('.webp')))
  console.log(f, (fs.statSync(`public/landing/${f}`).size / 1024).toFixed(0), 'KB');
