import { describe, expect, it, vi, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { ASSISTANT_SHAPES, describeCommand, validatePlan } from './plan';
import { parseRequest, planDesign } from './assistantService';
import { getShapeDefinition } from '@/cad/shapeRegistry';
import { POST } from '../../api/assistant';

const box = (ref: string, extra: Record<string, unknown> = {}) => ({
  op: 'add_shape',
  ref,
  shape: 'box',
  name: null,
  size: [10, 10, 10],
  position: [0, 0, 5],
  rotation: null,
  color: null,
  hole: false,
  ...extra,
});
const plan = (commands: unknown[], extra: Record<string, unknown> = {}) => ({ reply: 'OK', needsClarification: false, commands, ...extra });

describe('validatePlan', () => {
  it('accepts a well-formed plan and keeps refs usable', () => {
    const r = validatePlan(
      plan([
        box('a'),
        box('h', { shape: 'cylinder', hole: true }),
        { op: 'combine', ref: 'c', targets: ['a', 'h'], mode: 'subtract', name: 'Plate' },
        { op: 'set_color', target: 'c', color: '#FF0000' },
      ]),
      [],
    );
    expect(r.ok).toBe(true);
  });
  it('every shape the assistant may use exists in the Studio', () => {
    for (const s of ASSISTANT_SHAPES) expect(getShapeDefinition(s).type).toBe(s);
  });
  it('rejects unknown shapes, bad sizes, bad colours and unknown commands', () => {
    const r = validatePlan(
      plan([box('a', { shape: 'teapot' }), box('b', { size: [0, 10, 10] }), box('c', { color: 'red' }), { op: 'run_code', code: 'x' }]),
      [],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join(' ')).toMatch(/unknown shape/);
      expect(r.errors.join(' ')).toMatch(/size must be/);
      expect(r.errors.join(' ')).toMatch(/#RRGGBB/);
      expect(r.errors.join(' ')).toMatch(/unknown command "run_code"/);
    }
  });
  it('rejects targets that are not in the design, and parts that were combined away', () => {
    expect(validatePlan(plan([{ op: 'delete', target: 'nope' }]), ['real']).ok).toBe(false);
    expect(validatePlan(plan([{ op: 'delete', target: 'real' }]), ['real']).ok).toBe(true);
    const r = validatePlan(
      plan([
        box('a'),
        box('b'),
        { op: 'combine', ref: 'g', targets: ['a', 'b'], mode: 'union', name: null },
        { op: 'set_color', target: 'a', color: '#000000' },
      ]),
      [],
    );
    expect(r.ok).toBe(false);
  });
  it('rejects duplicate refs, NaN, wrong vector lengths and huge plans', () => {
    expect(validatePlan(plan([box('a'), box('a')]), []).ok).toBe(false);
    expect(validatePlan(plan([box('a', { position: [0, Number.NaN, 0] })]), []).ok).toBe(false);
    expect(validatePlan(plan([box('a', { size: [10, 10] })]), []).ok).toBe(false);
    expect(validatePlan(plan(Array.from({ length: 41 }, (_, i) => box(`b${i}`))), []).ok).toBe(false);
  });
  it('a clarifying question cannot carry commands', () => {
    expect(validatePlan(plan([], { needsClarification: true, reply: 'How big?' }), []).ok).toBe(true);
    expect(validatePlan(plan([box('a')], { needsClarification: true }), []).ok).toBe(false);
  });
  it('describes steps in plain language', () => {
    const r = validatePlan(plan([box('a', { name: 'Base', size: [60, 40, 3] })]), []);
    expect(r.ok && describeCommand(r.plan.commands[0], {})).toBe('Add a Base 60 × 40 × 3 mm at (0, 0, 5)');
  });
});

const fakeClient = (create: () => unknown) => ({ beta: { messages: { create: vi.fn(async () => create()) } } }) as unknown as Anthropic;
const message = (text: string, stop_reason = 'end_turn') => ({ content: [{ type: 'text', text }], stop_reason });
const req = { prompt: 'a cube', scene: [] };

describe('assistant service', () => {
  it('validates the request body', () => {
    expect(typeof parseRequest(null)).toBe('string');
    expect(typeof parseRequest({ prompt: '', scene: [] })).toBe('string');
    expect(typeof parseRequest({ prompt: 'x'.repeat(5000), scene: [] })).toBe('string');
    expect(parseRequest({ prompt: 'a cube', scene: [] })).toEqual({ prompt: 'a cube', scene: [], history: [] });
  });
  it('returns a validated plan, using structured output and the server-side fallback', async () => {
    const client = fakeClient(() => message(JSON.stringify(plan([box('a')]))));
    const r = await planDesign(client, req);
    expect(r.status).toBe(200);
    const args = (client.beta.messages.create as unknown as { mock: { calls: Record<string, unknown>[][] } }).mock.calls[0][0];
    expect(args.model).toBe('claude-opus-5-5');
    expect(args.fallbacks).toBe('default');
    expect((args.output_config as { format: { type: string } }).format.type).toBe('json_schema');
  });
  it('rejects invalid plans, refusals and non-JSON output instead of guessing', async () => {
    expect(
      (
        await planDesign(
          fakeClient(() => message(JSON.stringify(plan([box('a', { shape: 'teapot' })])))),
          req,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await planDesign(
          fakeClient(() => message('', 'refusal')),
          req,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await planDesign(
          fakeClient(() => message('not json')),
          req,
        )
      ).status,
    ).toBe(502);
  });
});

describe('/api/assistant', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('answers 503 when no API key is configured', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const r = await POST(new Request('http://x/api/assistant', { method: 'POST', body: JSON.stringify(req) }));
    expect(r.status).toBe(503);
  });
  it('answers 400 for a bad body (key present, model never called)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-used');
    const r = await POST(new Request('http://x/api/assistant', { method: 'POST', body: '{"prompt":""}' }));
    expect(r.status).toBe(400);
  });
});
