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
const h1 = (await page.getByRole('heading', { level: 1 }).textContent()) ?? '';
check(
  '2. Hero: MODELLIO, the headline, the label and both calls to action',
  h1.includes('MODELLIO') &&
    h1.includes('The Complete 3D Creation Platform') &&
    (await page.getByText('Design · Create · Customise · 3D Print').isVisible()) &&
    (await page.getByTestId('hero-get-started').isVisible()) &&
    (await page.getByRole('button', { name: 'Watch Overview' }).isVisible()),
  h1,
);
const imgs = await page
  .waitForFunction(
    () => [...document.querySelectorAll('[data-testid="hero-visuals"] img')].every((i) => i.complete && i.naturalWidth > 0),
    null,
    { timeout: 10000 },
  )
  .then(
    () => true,
    () => false,
  );
check('2b. Hero product renders (keyring, vase, sign, planter) load', imgs);
check('3. The editor is not mounted on the landing page', (await page.getByTestId('left-panel').count()) === 0);
for (const id of ['keyring', 'keytag', 'sign', 'vase', 'split', 'cookie', 'design'])
  check(`4. Card on the page: ${id}`, await page.getByTestId(`studio-card-${id}`).isVisible());
const soon = ['lithophane', 'thread'];
let soonOk = true;
for (const id of soon) {
  const card = page.getByTestId(`soon-card-${id}`);
  soonOk &&= (await card.isVisible()) && (await card.getByText('Coming soon').isVisible()) && (await card.getByRole('link').count()) === 0;
}
check('5. Tools that are not built yet are labelled Coming soon and are not links', soonOk);
check(
  '5b. Live tools link into the Design Studio',
  (await page.getByTestId('tool-gear').getByRole('link').getAttribute('href')) === '/?studio=design',
);

// Overview dialog
await page.getByRole('button', { name: 'Watch Overview' }).click();
const ov = page.getByTestId('overview-dialog');
await ov.waitFor();
const first = await ov.locator('p').first().textContent();
await page.getByRole('button', { name: 'Next step' }).click();
const second = await ov.locator('p').first().textContent();
check('6. "Watch Overview" opens a step-by-step overview', first !== second, `${first} → ${second}`);
await page.keyboard.press('Escape');
check('6b. Escape closes the overview', (await ov.count()) === 0);

// Section links
await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pricing' }).click();
await page.waitForTimeout(700);
check('7. Header section links scroll to their section', await page.getByRole('heading', { name: 'Free while we build' }).isVisible());
const faq = page.locator('details').first();
await faq.locator('summary').click();
check('8. FAQ answers expand', await faq.evaluate((d) => d.open));

// 2. Navigation into the app
await page.goto(URL + '/', { waitUntil: 'networkidle' });
await page.getByTestId('open-design-studio').click();
await page.getByTestId('left-panel').waitFor({ timeout: 15000 });
check('9. "Open Design Studio" opens the editor at ?studio=design', path() === '?studio=design' && !page.url().includes('#'), page.url());
await page.getByRole('link', { name: 'Modellio home' }).click();
await landing.waitFor();
check('10. The logo returns to the landing page', path() === '');
await page.getByTestId('studio-card-split').click();
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
await page.goto(URL + '/', { waitUntil: 'networkidle' });
const href = await page.getByTestId('hero-get-started').getAttribute('href');
check('15. Links are real URLs (open in a new tab)', href === '/?studio=dashboard', href);
await page.getByTestId('hero-get-started').click();
await page.getByTestId('dashboard').waitFor({ timeout: 15000 });
check('15b. "Get Started Free" opens the dashboard', path() === '?studio=dashboard');

// 3. Templates open in the Design Studio (from the Explore link)
await page.goto(URL + '/', { waitUntil: 'networkidle' });
await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Explore' }).click();
await page.getByRole('button', { name: /Use phone stand/i }).click();
await page.getByTestId('left-panel').waitFor({ timeout: 15000 });
const ok = await page
  .waitForFunction(() => window.modellio.store.getState().doc.rootIds.length > 0, null, { timeout: 15000 })
  .then(
    () => true,
    () => false,
  );
const name = await page.evaluate(() => window.modellio.projects.getState().current?.name ?? '');
check('16. Explore → a template opens it in the Design Studio', ok && /phone stand/i.test(name), name);

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
    const menu = p.getByTestId('mobile-menu');
    check(
      '21. phone: the menu opens with section links and Get Started',
      (await menu.isVisible()) &&
        (await menu.getByRole('link', { name: 'Design Studio' }).isVisible()) &&
        (await menu.getByRole('link', { name: 'Get Started Free' }).isVisible()),
    );
    await menu.getByRole('link', { name: 'Tools' }).tap();
    await p.waitForTimeout(700);
    check(
      '22. phone: menu links navigate and close the menu',
      (await menu.count()) === 0 && (await p.getByRole('heading', { name: 'Powerful Design Tools' }).isVisible()),
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
