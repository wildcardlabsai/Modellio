/**
 * End-to-end check for MODELLIO 2.3 Stage 4D (one visual system): every maker, Split Studio and
 * the Design Studio use the shared dark theme at desktop, laptop, tablet and phone sizes, with no
 * plain-white interface panels, readable text (WCAG AA contrast, measured from the computed
 * colours) and no sideways scrolling. Screenshots of each are saved for review.
 *
 *   node scripts/e2e-visual.mjs [url] [screenshotDir]
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

const WORKSPACES = [
  { id: 'keyring', root: 'keyring-studio' },
  { id: 'keytag', root: 'keytag-studio' },
  { id: 'sign', root: 'sign-studio' },
  { id: 'cookie', root: 'cookie-studio' },
  { id: 'vase', root: 'vase-studio' },
  { id: 'split', root: 'split-studio' },
  { id: 'design', root: 'viewport' },
];
const SIZES = [
  { id: 'desktop', opts: { viewport: { width: 1440, height: 900 } } },
  { id: 'laptop', opts: { viewport: { width: 1280, height: 800 } } },
  { id: 'tablet', opts: { ...devices['iPad Pro 11'] } },
  { id: 'phone', opts: { ...devices['iPhone 13'] } },
];

/** In the page: theme, white panels, contrast failures and overflow. */
const audit = () => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r, g, b, a };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  /** The colour behind an element: the nearest ancestor with a (mostly) opaque background. */
  const behind = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.85) return c;
      if (getComputedStyle(e).backgroundImage !== 'none' && e !== el) return null; // gradient: not measurable
    }
    return { r: 10, g: 16, b: 38, a: 1 };
  };
  const skip = (el) => el.closest('[data-testid="design-canvas"], canvas, svg, [aria-hidden="true"], .sr-only, [disabled], .landing');
  const themed = !!document.querySelector('[data-ui="studio-dark"]');
  // Large interface panels with a plain white background.
  const white = [...document.querySelectorAll('aside, header, nav, section, main, [role="dialog"], [role="toolbar"]')]
    .filter((e) => {
      const r = e.getBoundingClientRect();
      const c = parse(getComputedStyle(e).backgroundColor);
      return r.width * r.height > 20000 && c && c.a > 0.85 && c.r > 245 && c.g > 245 && c.b > 245 && !skip(e);
    })
    .map((e) => e.tagName.toLowerCase() + (e.getAttribute('aria-label') ? `[${e.getAttribute('aria-label')}]` : ''));
  // Text contrast (AA: 4.5, or 3 for large text).
  const fails = [];
  let measured = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (skip(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || Number(st.opacity) < 0.95) continue;
    let faded = false;
    for (let e = el; e; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 0.95) faded = true;
    if (faded) continue;
    const fg = parse(st.color);
    const bg = behind(el);
    if (!fg || !bg) continue;
    const mix = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
    const [l1, l2] = [lum(mix), lum(bg)].sort((a, b) => b - a);
    const ratio = (l1 + 0.05) / (l2 + 0.05);
    const size = parseFloat(st.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(st.fontWeight) >= 700);
    measured++;
    if (ratio < (large ? 3 : 4.5)) fails.push(`${el.textContent.trim().slice(0, 30)} (${ratio.toFixed(2)})`);
  }
  // The logo keeps its proportions (it was once squeezed by the nav on phones).
  const logo = document.querySelector('header img[alt="modellio"]');
  const logoRatio =
    logo && logo.naturalWidth
      ? logo.getBoundingClientRect().width / logo.getBoundingClientRect().height / (logo.naturalWidth / logo.naturalHeight)
      : 1;
  // Floating controls at the bottom of the Design Studio view must not sit on top of each other.
  const boxes = ['[aria-label="Units"]', '[aria-label="Snap increment"]', 'button[aria-label="Home view"]']
    .map((q) => document.querySelector(q)?.parentElement?.getBoundingClientRect())
    .filter(Boolean);
  let overlaps = 0;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps++;
    }
  return {
    themed,
    white,
    fails,
    measured,
    overflow: document.documentElement.scrollWidth - innerWidth,
    logoRatio,
    overlaps,
  };
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const size of SIZES) {
  const context = await browser.newContext(size.opts);
  await context.addInitScript(() => localStorage.setItem('modellio:onboarded', '1'));
  const page = await context.newPage();
  for (const w of WORKSPACES) {
    await page.goto(`${URL}/?studio=${w.id}`, { waitUntil: 'networkidle' });
    await page.getByTestId(w.root).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(700);
    const a = await page.evaluate(audit);
    const tag = `${w.id} · ${size.id}`;
    check(`${tag}: uses the shared theme`, a.themed);
    check(`${tag}: no plain-white interface panels`, a.white.length === 0, a.white.join(', '));
    check(
      `${tag}: text is readable (AA contrast)`,
      a.fails.length === 0,
      a.fails.length ? a.fails.slice(0, 4).join(' | ') : `${a.measured} text elements`,
    );
    check(`${tag}: no sideways scrolling`, a.overflow <= 1, a.overflow > 1 ? `${a.overflow}px too wide` : '');
    check(`${tag}: the logo keeps its proportions`, Math.abs(a.logoRatio - 1) < 0.05, a.logoRatio.toFixed(2));
    if (w.id === 'design') check(`${tag}: the floating view controls don't overlap`, a.overlaps === 0, `${a.overlaps} overlapping`);
    await page.screenshot({ path: `${OUT}/visual-${w.id}-${size.id}.png` });
  }
  await context.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
