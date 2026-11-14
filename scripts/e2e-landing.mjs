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
    (await page.getByText('Design • Create • Customise • 3D Print').isVisible()) &&
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
check('2b. The hero product image loads', imgs);
const art = await page.evaluate(async () => {
  const imgs = [...document.querySelectorAll('[data-testid="maker-art"]')];
  await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => i.addEventListener('load', r, { once: true })))));
  return imgs.map((i) => ({ src: i.getAttribute('src'), ok: i.naturalWidth > 0, natural: i.naturalWidth / i.naturalHeight }));
});
check(
  '2c. Each maker card shows its own product image (five supplied images and the cookie render)',
  art.length === 6 &&
    art.every((a) => a.ok) &&
    new Set(art.map((a) => a.src)).size === 6 &&
    art.filter((a) => a.src.startsWith('/landing/art/')).length === 5,
  art.map((a) => a.src).join(', '),
);
check('3. The editor is not mounted on the landing page', (await page.getByTestId('left-panel').count()) === 0);
for (const id of ['keyring', 'keytag', 'sign', 'vase', 'split', 'cookie', 'design'])
  check(`4. Card on the page: ${id}`, await page.getByTestId(`studio-card-${id}`).isVisible());
check(
  '5. Only tools that exist are advertised (no unbuilt tools on the page)',
  (await page.getByText('Coming soon').count()) === 0 && (await page.getByTestId('tool-lithophane').count()) === 0,
);
check('5a. All nine live tools are listed', (await page.locator('[data-testid^="tool-"]').count()) === 9);
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

// Layout across widths: no overflow, sensible maker columns, undistorted images.
for (const [w, cols] of [
  [1440, 3],
  [1024, 3],
  [768, 2],
  [430, 1],
  [390, 1],
]) {
  const c = await browser.newContext({ viewport: { width: w, height: 900 } });
  const p = await c.newPage();
  await p.goto(URL + '/', { waitUntil: 'networkidle' });
  const r = await p.evaluate(async () => {
    const el = document.querySelector('[data-testid="landing"]');
    for (let y = 0; y < el.scrollHeight; y += 600) {
      el.scrollTop = y;
      await new Promise((res) => setTimeout(res, 50));
    }
    const imgs = [
      ...document.querySelectorAll('[data-testid="maker-art"], [data-testid="hero-visuals"] img, [data-testid="studio-card-design"] img'),
    ];
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((res) => i.addEventListener('load', res, { once: true })))));
    const grid = document.querySelector('[data-testid="maker-grid"]');
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    // object-contain: the drawn picture keeps its ratio; for plain images the box must match.
    const distorted = imgs.filter((i) => {
      const fit = getComputedStyle(i).objectFit;
      if (fit === 'contain') return false;
      const box = i.getBoundingClientRect();
      return Math.abs(box.width / box.height - i.naturalWidth / i.naturalHeight) > 0.02;
    }).length;
    const overflow = el.scrollWidth > el.clientWidth || document.documentElement.scrollWidth > window.innerWidth;
    const tiny = [...document.querySelectorAll('[data-testid="landing"] p, [data-testid="landing"] a, [data-testid="landing"] h3')].filter(
      (n) => n.offsetParent && parseFloat(getComputedStyle(n).fontSize) < 12,
    ).length;
    return { cols, distorted, overflow, tiny };
  });
  check(
    `23. ${w}px: no sideways scroll, ${cols}-column makers, undistorted images, no text under 12 px`,
    !r.overflow && r.cols === cols && r.distorted === 0 && r.tiny === 0,
    JSON.stringify(r),
  );
  await c.close();
}
const company = page.getByRole('navigation', { name: 'Company' });
check(
  '24. Footer: Privacy Policy and the licences are separate links on their own lines',
  (await company.getByRole('link', { name: 'Privacy Policy' }).count()) === 1 &&
    (await company.getByRole('link', { name: 'Open-source licences' }).count()) === 1 &&
    (await company.locator('li').count()) === 3,
);

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
