/**
 * End-to-end check for the landing page and studio navigation, in Chromium.
 *
 *   node scripts/e2e-landing.mjs [url] [screenshotDir]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL = process.argv[2] ?? 'http://localhost:5173';
const OUT = process.argv[3] ?? 'e2e-results';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => localStorage.setItem('modellio:onboarded', '1'));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const path = () => new globalThis.URL(page.url()).search;

// 1. Landing
await page.goto(URL + '/', { waitUntil: 'networkidle' });
const landing = page.getByTestId('landing');
check('1. / shows the landing page', await landing.isVisible());
check(
  '2. The first screen offers both paths: Design Studio from scratch, or a maker',
  (await page.getByRole('heading', { level: 1 }).textContent()).includes('What are you making') &&
    (await page
      .getByTestId('path-scratch')
      .getByRole('link', { name: /Start designing/ })
      .isVisible()) &&
    (await page.getByTestId('path-makers').getByTestId('maker-link-cookie').isVisible()) &&
    (await page.getByTestId('path-makers').getByTestId('maker-link-split').isVisible()),
);
const fold = await page.evaluate(() => {
  const r = (id) => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
  return { scratch: r('path-scratch').top, makers: r('path-makers').top, h: window.innerHeight };
});
check('2b. Both paths start above the fold on a laptop screen', fold.scratch < fold.h && fold.makers < fold.h, JSON.stringify(fold));
check('3. The editor is not mounted on the landing page', (await page.getByTestId('left-panel').count()) === 0);
for (const id of ['design', 'split', 'cookie'])
  check(`4. Live studio card: ${id}`, await page.getByTestId(`studio-card-${id}`).isVisible());
const soon = ['keyring', 'sign', 'organiser', 'box', 'lithophane'];
let soonOk = true;
for (const id of soon) {
  const card = page.getByTestId(`soon-card-${id}`);
  soonOk &&=
    (await card.isVisible()) && (await card.textContent()).includes('Coming soon') && (await card.locator('a, button').count()) === 0;
}
check('5. Coming-soon studios are listed, labelled and not clickable', soonOk);
const imgs = await page.evaluate(async () => {
  const list = [...document.querySelectorAll('[data-testid="landing"] img')];
  for (const img of list) {
    img.loading = 'eager';
    if (!img.complete)
      await new Promise((r) => img.addEventListener('load', r, { once: true }) || img.addEventListener('error', r, { once: true }));
  }
  return list.map((i) => ({ src: i.getAttribute('src'), ok: i.naturalWidth > 0 }));
});
check(
  '6. Every image on the page loads',
  imgs.length >= 10 && imgs.every((i) => i.ok),
  imgs
    .filter((i) => !i.ok)
    .map((i) => i.src)
    .join(', '),
);
await page.getByRole('navigation', { name: 'Page sections' }).first().getByRole('link', { name: 'FAQ' }).click();
await page.waitForTimeout(600);
check('7. Section links scroll to their section', await page.getByRole('heading', { name: 'Questions', exact: true }).isVisible());
const faq = page.locator('details').first();
await faq.locator('summary').click();
check('8. FAQ answers expand', await faq.evaluate((d) => d.open));
await page.screenshot({ path: `${OUT}/landing-01-desktop.png` });

// 2. Navigation into studios and back
await page
  .getByRole('link', { name: /Open Design Studio/ })
  .first()
  .click();
await page.getByTestId('left-panel').waitFor({ timeout: 15000 });
check('9. "Open Design Studio" opens the editor at ?studio=design', path() === '?studio=design' && !page.url().includes('#'), page.url());
await page.getByRole('link', { name: 'Modellio home' }).click();
await landing.waitFor();
check('10. The logo returns to the landing page', path() === '');
await page
  .getByTestId('studio-card-split')
  .getByRole('link', { name: /Open Split Studio/ })
  .click();
await page.getByTestId('split-studio').waitFor({ timeout: 15000 });
check('11. The Split Studio card opens Split Studio', path() === '?studio=split');
await page.goBack();
await landing.waitFor();
check('12. Browser Back returns to the landing page', path() === '');
await page.goForward();
await page.getByTestId('split-studio').waitFor({ timeout: 15000 });
check('13. Browser Forward returns to Split Studio', true);
await page.reload({ waitUntil: 'networkidle' });
check('14. Reloading a studio URL stays in that studio', await page.getByTestId('split-studio').isVisible());
const href = await page
  .goto(URL + '/', { waitUntil: 'networkidle' })
  .then(() => page.getByTestId('studio-card-design').getByRole('link').getAttribute('href'));
check('15. Studio links are real URLs (open in a new tab)', href === '/?studio=design', href);

// 3. Templates open in the Design Studio
await page.getByRole('button', { name: /Open the Phone stand template/i }).click();
await page.getByTestId('left-panel').waitFor({ timeout: 15000 });
const ok = await page
  .waitForFunction(() => window.modellio.store.getState().doc.rootIds.length > 0, null, { timeout: 15000 })
  .then(
    () => true,
    () => false,
  );
const name = await page.evaluate(() => window.modellio.projects.getState().current?.name ?? '');
check('16. A template card opens that template in the Design Studio', ok && /phone stand/i.test(name), name);

// 4. Share links still open the editor directly (including older links without ?studio)
const shareUrl = await page.evaluate(() => window.modellio.projects.getState().shareLink().url ?? null);
const legacy = shareUrl ? shareUrl.replace('?studio=design', '') : null;
check('17. New share links include ?studio=design', shareUrl?.includes('?studio=design#share='), shareUrl?.slice(0, 60));
if (legacy) {
  const rp = await context.newPage();
  await rp.goto(legacy, { waitUntil: 'networkidle' });
  const shared = await rp
    .getByRole('region', { name: 'Shared design' })
    .waitFor({ timeout: 15000 })
    .then(
      () => true,
      () => false,
    );
  check('18. Older share links (no ?studio) open the shared design', shared && (await rp.getByTestId('landing').count()) === 0);
  await rp.close();
}

// 5. Accessibility
await page.goto(URL + '/', { waitUntil: 'networkidle' });
await page.addScriptTag({ content: fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') });
const violations = await page.evaluate(async () => {
  const r = await window.axe.run(document, { resultTypes: ['violations'] });
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target?.join(' ')}`);
});
check('19. No serious accessibility violations on the landing page', violations.length === 0, violations.slice(0, 4).join(' | '));

// 6. Phone and tablet
for (const [label, vp] of [
  ['phone', { width: 390, height: 844 }],
  ['tablet', { width: 820, height: 1180 }],
]) {
  const c = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: label === 'phone' });
  const p = await c.newPage();
  await p.goto(URL + '/', { waitUntil: 'networkidle' });
  const overflow = await p.evaluate(() => {
    const el = document.querySelector('[data-testid="landing"]');
    return el.scrollWidth > el.clientWidth || document.documentElement.scrollWidth > window.innerWidth;
  });
  check(`20. ${label}: no horizontal scrolling`, !overflow);
  if (label === 'phone') {
    await p.getByRole('button', { name: 'Open menu' }).tap();
    const menu = p.locator('#landing-mobile-nav');
    check(
      '21. phone: the menu opens with section links and a studio link',
      (await menu.isVisible()) && (await menu.getByRole('link', { name: /Open Design Studio/ }).isVisible()),
    );
    await menu.getByRole('link', { name: 'Templates' }).tap();
    await p.waitForTimeout(500);
    check(
      '22. phone: menu links navigate and close the menu',
      !(await menu.isVisible()) && (await p.getByRole('heading', { name: 'Or start from a template' }).isVisible()),
    );
  }
  await p.screenshot({ path: `${OUT}/landing-02-${label}.png` });
  await c.close();
}

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
