/**
 * End-to-end check for makers on phones: one pane at a time behind a bottom tab bar, nothing
 * wider than the screen, and the desktop layout unchanged.
 *
 *   node scripts/e2e-mobile.mjs [url] [screenshotDir]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const URL = process.argv[2] ?? 'http://localhost:5173';
const OUT = process.argv[3] ?? 'e2e-results';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const phone = await browser.newContext({ ...devices['iPhone 13'] });
await phone.addInitScript(() => localStorage.setItem('modellio:onboarded', '1'));
const page = await phone.newPage();
page.on('pageerror', (e) => errors.push(e.message));

const MAKERS = [
  ['keyring', 'keyring-left', 'keyring-right'],
  ['keytag', 'keytag-left', 'keytag-right'],
  ['sign', 'sign-left', 'sign-right'],
  ['cookie', 'cookie-left', 'cookie-right'],
  ['vase', 'vase-left', 'vase-right'],
];
let n = 0;
for (const [id, left, right] of MAKERS) {
  await page.goto(`${URL}/?studio=${id}`, { waitUntil: 'load' });
  await page.getByTestId(`${id}-studio`).waitFor({ timeout: 20000 });
  const tabs = page.getByTestId('maker-mobile-tabs').getByRole('button');
  const vis = async (t) => page.getByTestId(t).isVisible();
  const main = page.getByTestId(`${id}-studio`).locator('main');
  const atCanvas = (await main.isVisible()) && !(await vis(left)) && !(await vis(right));
  await tabs.nth(0).click();
  const atTools = (await vis(left)) && !(await main.isVisible()) && !(await vis(right));
  await tabs.nth(2).click();
  const atSettings = (await vis(right)) && !(await vis(left)) && !(await main.isVisible());
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  await page.screenshot({ path: `${OUT}/mobile-${id}-settings.png` });
  await tabs.nth(1).click();
  check(
    `${++n}. ${id}: one pane at a time on a phone, nothing wider than the screen`,
    atCanvas && atTools && atSettings && width <= 390,
    `canvas ${atCanvas}, tools ${atTools}, settings ${atSettings}, width ${width}`,
  );
}
await phone.close();

const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await desk.addInitScript(() => localStorage.setItem('modellio:onboarded', '1'));
const d = await desk.newPage();
d.on('pageerror', (e) => errors.push(e.message));
await d.goto(`${URL}/?studio=keyring`, { waitUntil: 'load' });
await d.getByTestId('keyring-studio').waitFor({ timeout: 20000 });
check(
  `${n + 1}. On desktop all three columns show and there is no tab bar`,
  (await d.getByTestId('keyring-left').isVisible()) &&
    (await d.getByTestId('keyring-right').isVisible()) &&
    !(await d.getByTestId('maker-mobile-tabs').isVisible()),
);

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
