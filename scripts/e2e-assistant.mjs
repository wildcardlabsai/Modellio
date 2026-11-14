/**
 * End-to-end check for the AI Design Assistant panel. The static preview server has no API, so
 * the first checks see the real "not reachable" state; the rest intercept /api/assistant in the
 * browser with fixed responses to exercise preview → apply → undo, discard, server errors and
 * the client-side check that rejects an invalid plan. (No model is called by this suite.)
 *
 *   node scripts/e2e-assistant.mjs [url] [screenshotDir]
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
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
const S = (fn, arg) => page.evaluate(fn, arg);
const roots = () =>
  S(() => {
    const d = window.modellio.store.getState().doc;
    return d.rootIds.map((id) => ({ id, name: d.objects[id].name, kind: d.objects[id].kind }));
  });
const openPanel = async () => {
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  await page.getByTestId('assistant-panel').waitFor();
};

// 1. Real state on a static deployment: no API → says so, input disabled.
await page.goto(`${URL}/?studio=design`, { waitUntil: 'networkidle' });
await page.getByTestId('viewport').waitFor();
await openPanel();
await page.getByTestId('assistant-unavailable').waitFor({ timeout: 8000 });
check('1. Without an API the panel says the assistant is not reachable', await page.getByTestId('assistant-unavailable').isVisible());
check('2. …and the input is disabled (no fake replies)', await page.getByTestId('assistant-input').isDisabled());

// 2. Server without a key → 503 → "not set up".
await page.route('**/api/assistant', (r) =>
  r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"The AI assistant is not set up on this server."}' }),
);
await page.reload({ waitUntil: 'networkidle' });
await openPanel();
await page.getByTestId('assistant-unavailable').waitFor();
check(
  '3. A server without a key shows the set-up message',
  /ANTHROPIC_API_KEY/.test(await page.getByTestId('assistant-unavailable').textContent()),
);
await page.unroute('**/api/assistant');

// 3. A configured server returning a plan.
const PLAN = {
  reply: 'A 60 × 40 mm plate with a 4 mm hole near one corner.',
  needsClarification: false,
  commands: [
    {
      op: 'add_shape',
      ref: 'plate',
      shape: 'box',
      name: 'Plate',
      size: [60, 40, 3],
      position: [0, 0, 1.5],
      rotation: null,
      color: '#2463EB',
      hole: false,
    },
    {
      op: 'add_shape',
      ref: 'h1',
      shape: 'cylinder',
      name: 'Hole',
      size: [4, 4, 5],
      position: [25, 15, 1.5],
      rotation: null,
      color: null,
      hole: true,
    },
    { op: 'combine', ref: 'part', targets: ['plate', 'h1'], mode: 'subtract', name: 'Drilled plate' },
  ],
};
let reply = { status: 200, body: { plan: PLAN } };
const sent = [];
await page.route('**/api/assistant', async (r) => {
  if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":true}' });
  sent.push(JSON.parse(r.request().postData()));
  await new Promise((res) => setTimeout(res, 300));
  return r.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) });
});
await page.reload({ waitUntil: 'networkidle' });
await S(() => {
  const s = window.modellio.store.getState();
  s.selectAll();
  s.deleteSelected();
});
await openPanel();
await page.getByTestId('assistant-input').fill('A 60 x 40 plate with a hole');
await page.getByTestId('assistant-send').click();
await page.getByTestId('assistant-steps').waitFor();
check(
  '4. The request carries the prompt and a design summary',
  sent[0]?.prompt?.startsWith('A 60 x 40 plate') && Array.isArray(sent[0]?.scene),
);
const steps = await page.getByTestId('assistant-steps').locator('li').allTextContents();
check(
  '5. The plan is previewed as plain-language steps',
  steps.length === 3 && /Add a Plate 60 × 40 × 3 mm/.test(steps[0]) && /Cut Plate, Hole/.test(steps[2]),
  steps.join(' | '),
);
check('6. Nothing changes before Apply', (await roots()).length === 0);
await page.screenshot({ path: `${OUT}/assistant-01-preview.png` });
await page.getByTestId('assistant-apply').click();
await page.getByText('Applied · Ctrl+Z to undo').waitFor();
const r1 = await roots();
check(
  '7. Apply builds the part (one combined group)',
  r1.length === 1 && r1[0].kind === 'group' && r1[0].name === 'Drilled plate',
  JSON.stringify(r1),
);
const size = await S(() => {
  const d = window.modellio.store.getState().doc;
  const p = Object.values(d.objects).find((o) => o.name === 'Plate');
  return p.size;
});
check('8. At the sizes in the plan', JSON.stringify(size) === '[60,40,3]', JSON.stringify(size));
await page.screenshot({ path: `${OUT}/assistant-02-applied.png` });
await S(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
await page.keyboard.press('Control+z');
check('9. One Ctrl+Z removes the whole plan', (await roots()).length === 0);

// 4. Discard, server error, invalid plan, clarifying question.
await page.getByTestId('assistant-input').fill('again');
await page.getByTestId('assistant-send').click();
await page.getByTestId('assistant-apply').nth(0).waitFor();
await page.getByRole('button', { name: 'Discard' }).click();
check('10. Discard leaves the design alone', (await roots()).length === 0 && (await page.getByText('Discarded').count()) === 1);

reply = { status: 502, body: { error: 'The assistant service returned an error (500).' } };
await page.getByTestId('assistant-input').fill('break');
await page.getByTestId('assistant-send').click();
await page.getByTestId('assistant-error').first().waitFor();
check('11. Server errors are shown, not hidden', /returned an error/.test(await page.getByTestId('assistant-error').first().textContent()));

reply = { status: 200, body: { plan: { ...PLAN, commands: [{ op: 'delete', target: 'not-in-design' }] } } };
await page.getByTestId('assistant-input').fill('bad');
await page.getByTestId('assistant-send').click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid="assistant-error"]').length === 2);
check(
  '12. A plan that targets unknown objects is rejected in the browser',
  /rejected/.test(await page.getByTestId('assistant-error').nth(1).textContent()),
);

reply = { status: 200, body: { plan: { reply: 'How tall should the stand be?', needsClarification: true, commands: [] } } };
await page.getByTestId('assistant-input').fill('make a stand');
await page.getByTestId('assistant-send').click();
await page.getByText('How tall should the stand be?').waitFor();
check('13. A clarifying question has nothing to apply', (await page.getByTestId('assistant-apply').count()) === 0);

check('No unexpected runtime errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
