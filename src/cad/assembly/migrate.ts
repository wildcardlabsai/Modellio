import type { ComponentDef, ExplodeView, GroupObject, Joint, ModelDocument } from '@/types/document';
import { createId } from '@/utils/id';
import { collectSubtree } from '../document';
import { linkInstanceDraft } from './links';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const KINDS = ['rigid', 'revolute', 'slider', 'cylindrical', 'planar'];
const VALUES = ['angle', 'offset', 'u', 'v'];

/**
 * Bring a document's assembly data to schema 4 (in place, after its objects were migrated):
 * component definitions, a definition and link ids for every component group (so older copies
 * stay independent: each gets its own), and well-formed joints and exploded views.
 */
export function migrateAssemblyDraft(doc: ModelDocument, raw: Record<string, unknown>) {
  const defs: Record<string, ComponentDef> = {};
  if (isObj(raw.components))
    for (const [id, d] of Object.entries(raw.components))
      if (isObj(d) && d.id === id && typeof d.name === 'string')
        defs[id] = { id, name: d.name || 'Component', createdAt: isNum(d.createdAt) ? d.createdAt : Date.now() };
  doc.components = defs;
  // Component groups without a definition (older documents) get one each.
  for (const g of Object.values(doc.objects)) {
    if (g.kind !== 'group' || !g.component) continue;
    if (!g.componentId || !defs[g.componentId]) {
      const id = g.componentId ?? createId('cmp');
      linkInstanceDraft(doc, g.id, id, g.name);
    } else for (const sub of collectSubtree(doc, [g.id]).slice(1)) doc.objects[sub].defNode ??= createId('dn');
  }
  const joints: Record<string, Joint> = {};
  if (isObj(raw.joints))
    for (const [id, j] of Object.entries(raw.joints)) {
      if (!isObj(j) || j.id !== id || !KINDS.includes(j.kind as string)) continue;
      if (typeof j.a !== 'string' || typeof j.b !== 'string' || !doc.objects[j.a] || !doc.objects[j.b]) continue;
      const frame = (f: unknown) => Array.isArray(f) && f.length === 16 && f.every(isNum);
      if (!frame(j.frameA) || !frame(j.frameB)) continue;
      const values: Joint['values'] = {};
      if (isObj(j.values)) for (const k of VALUES) if (isNum(j.values[k])) values[k as keyof Joint['values']] = j.values[k] as number;
      const limits: NonNullable<Joint['limits']> = {};
      if (isObj(j.limits))
        for (const k of VALUES) {
          const l = j.limits[k];
          if (Array.isArray(l) && l.length === 2 && isNum(l[0]) && isNum(l[1]) && l[0] <= l[1])
            limits[k as keyof Joint['values']] = [l[0], l[1]];
        }
      joints[id] = {
        id,
        name: typeof j.name === 'string' && j.name ? j.name : 'Joint',
        kind: j.kind as Joint['kind'],
        a: j.a,
        b: j.b,
        frameA: j.frameA as number[],
        frameB: j.frameB as number[],
        values,
        ...(Object.keys(limits).length ? { limits } : {}),
        ...(j.suppressed === true ? { suppressed: true } : {}),
      };
    }
  doc.joints = joints;
  const views: Record<string, ExplodeView> = {};
  if (isObj(raw.explodeViews))
    for (const [id, v] of Object.entries(raw.explodeViews)) {
      if (!isObj(v) || v.id !== id || !Array.isArray(v.steps)) continue;
      const steps = v.steps
        .filter(
          (st): st is Record<string, unknown> =>
            isObj(st) && typeof st.id === 'string' && Array.isArray(st.objectIds) && Array.isArray(st.offset),
        )
        .map((st) => ({
          id: st.id as string,
          ...(typeof st.name === 'string' ? { name: st.name } : {}),
          objectIds: (st.objectIds as unknown[]).filter((o): o is string => typeof o === 'string' && !!doc.objects[o]),
          offset: [0, 1, 2].map((i) => (isNum((st.offset as unknown[])[i]) ? (st.offset as number[])[i] : 0)) as [number, number, number],
        }))
        .filter((st) => st.objectIds.length);
      views[id] = { id, name: typeof v.name === 'string' && v.name ? v.name : 'Exploded view', steps };
    }
  doc.explodeViews = views;
}

/** Instance groups of a document, by component. */
export const componentGroups = (doc: ModelDocument) =>
  Object.values(doc.objects).filter((o): o is GroupObject => o.kind === 'group' && !!o.componentId);
