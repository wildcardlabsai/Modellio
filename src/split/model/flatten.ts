import type { RawModel } from '../import/parse3mf';
import { IDENTITY, determinant3, multiply } from './mat4';
import type { ImportIssue, Mat4 } from './types';

/**
 * Expand build items and (nested) components into placed mesh instances. Each instance keeps
 * its own composed transform; meshes are never duplicated or merged, so two placements of
 * the same object stay two instances.
 */
export interface FlatInstance {
  instanceId: string;
  buildItemIndex: number;
  componentPath: number[];
  meshUid: number;
  /** Unique ID of the build item's object (the "root" object). */
  rootUid: number;
  transform: Mat4;
  mirrored: boolean;
}

const MAX_DEPTH = 32;

export function flattenInstances(raw: RawModel, issues: ImportIssue[]): FlatInstance[] {
  const meshes = new Set(raw.meshes.map((m) => m.uid));
  const comps = new Map(raw.components.map((c) => [c.uid, c]));
  const out: FlatInstance[] = [];
  let missing = 0;
  let cycles = 0;
  raw.buildItems.forEach((item, b) => {
    const walk = (uid: number, transform: Mat4, path: number[], stack: number[]) => {
      if (meshes.has(uid)) {
        out.push({
          instanceId: ['b' + b, ...path.map((p) => 'c' + p)].join('/'),
          buildItemIndex: b,
          componentPath: path,
          meshUid: uid,
          rootUid: item.objectUid,
          transform,
          mirrored: determinant3(transform) < 0,
        });
        return;
      }
      const c = comps.get(uid);
      if (!c) {
        missing++;
        return;
      }
      if (stack.includes(uid) || stack.length >= MAX_DEPTH) {
        cycles++;
        return;
      }
      c.components.forEach((child, i) => walk(child.uid, multiply(transform, child.transform), [...path, i], [...stack, uid]));
    };
    walk(item.objectUid, item.transform ?? IDENTITY, [], []);
  });
  if (missing)
    issues.push({
      level: 'error',
      code: 'missing-object',
      message: `${missing} build item or component reference(s) point to an object that is not in the file; they were skipped.`,
      count: missing,
    });
  if (cycles)
    issues.push({
      level: 'error',
      code: 'component-cycle',
      message: `${cycles} component reference(s) form a loop or are nested too deeply; they were skipped.`,
      count: cycles,
    });
  if (raw.buildItems.length === 0)
    issues.push({
      level: 'warning',
      code: 'empty-build',
      message: 'The file has no build items, so nothing is placed on the build plate.',
    });
  const mirrored = out.filter((i) => i.mirrored).length;
  if (mirrored)
    issues.push({
      level: 'info',
      code: 'mirrored',
      message: `${mirrored} instance(s) are mirrored by their transform. Their geometry is kept exactly as placed.`,
      count: mirrored,
    });
  return out;
}
