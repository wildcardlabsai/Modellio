import { beforeEach, describe, expect, it } from 'vitest';
import { __setWorkerFactory, buildBrepAsync, exportStepInWorker, getBrep, SupersededError } from './client';
import type { BrepBuild, BrepRequest } from './types';

/** A stand-in worker: records what it is asked to do; the test answers when it likes. */
class FakeWorker {
  sent: { id: number; type: string; req?: BrepRequest }[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage(m: { id: number; type: string; req?: BrepRequest }) {
    this.sent.push(m);
  }
  terminate() {}
  /** Finish the job that is running. */
  finish(res: unknown = build()) {
    const m = this.sent[this.sent.length - 1];
    this.onmessage!({ data: { type: 'result', id: m.id, res } } as MessageEvent);
  }
}

const build = (): BrepBuild =>
  ({
    positions: new Float32Array(),
    indices: new Uint32Array(),
    edges: [],
    faces: [],
    half: [0.5, 0.5, 0.5],
    volume: 1,
    size: [1, 1, 1],
    centre: [0, 0, 0],
    problems: [],
  }) as BrepBuild;
const req = (radius: number, size = 10): BrepRequest => ({
  recipe: { base: { kind: 'primitive', shape: 'box', params: { radius } }, ops: [] },
  size: [size, size, size],
});
const radiusOf = (m: { req?: BrepRequest }) => (m.req!.recipe.base as unknown as { params: { radius: number } }).params.radius;

let w: FakeWorker;
beforeEach(() => {
  w = new FakeWorker();
  __setWorkerFactory(() => w as unknown as Worker);
});

describe('precise-solid job queue', () => {
  it('runs tool previews before builds for the 3D view, and STEP jobs last', async () => {
    getBrep(req(1)); // starts at once (the engine is idle)
    getBrep(req(2)); // waits: 3D view
    const step = exportStepInWorker([]); // waits: one-off job
    const preview = buildBrepAsync(req(3)); // waits: interactive
    expect(w.sent.map((m) => m.type)).toEqual(['build']);
    w.finish();
    expect(radiusOf(w.sent[1])).toBe(3); // the preview jumped the queue
    w.finish();
    await expect(preview).resolves.toBeTruthy();
    expect(radiusOf(w.sent[2])).toBe(2);
    w.finish();
    expect(w.sent[3].type).toBe('export-step');
    w.finish({ bytes: new Uint8Array(), faceted: 0 });
    await expect(step).resolves.toBeTruthy();
  });

  it('a newer preview in the same lane replaces one that has not started', async () => {
    getBrep(req(1)); // keeps the engine busy
    const first = buildBrepAsync(req(2), { lane: 'fillet' });
    const second = buildBrepAsync(req(3), { lane: 'fillet' });
    await expect(first).rejects.toBeInstanceOf(SupersededError);
    w.finish();
    w.finish();
    await expect(second).resolves.toBeTruthy();
    // Only the latest preview was built.
    expect(w.sent.map(radiusOf)).toEqual([1, 3]);
  });

  it('never cancels a preview that is already being built', async () => {
    const first = buildBrepAsync(req(2), { lane: 'fillet' }); // starts at once
    const second = buildBrepAsync(req(3), { lane: 'fillet' });
    w.finish();
    await expect(first).resolves.toBeTruthy();
    w.finish();
    await expect(second).resolves.toBeTruthy();
  });

  it('gives a 3D-view build the preview priority when a tool asks for the same request', async () => {
    getBrep(req(1)); // running
    getBrep(req(2)); // 3D view
    getBrep(req(4)); // 3D view
    const p = buildBrepAsync(req(4)); // same request as the last one: moves up
    w.finish();
    expect(radiusOf(w.sent[1])).toBe(4);
    w.finish();
    await expect(p).resolves.toBeTruthy();
  });
});
