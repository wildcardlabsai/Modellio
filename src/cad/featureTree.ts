/**
 * The Design Browser's feature view, derived live from the document: never a second store, so
 * it cannot drift from what is really built. Every node points at real data, and every action
 * it offers is one the app actually performs (see `FeatureEdit`).
 */
import type { ModelDocument, ObjectId, SceneObject, ShapeObject, SketchId } from '@/types/document';
import { sketchUsers } from './sketchRecords';
import type { FeatureOp } from '@/cad/brep/types';
import type { Sketch } from '@/cad/sketch/types';

/** What "Edit" on a node really opens. */
export type FeatureEdit =
  | { kind: 'sketch'; objectId: ObjectId } // a sketched solid: the sketch editor
  | { kind: 'loft' | 'sweep'; objectId: ObjectId } // the loft / sweep panel
  | { kind: 'op'; objectId: ObjectId; opId: string; op: FeatureOp['kind'] } // the feature panel for that operation
  | { kind: 'settings'; objectId: ObjectId }; // the Inspector's settings for the shape

export type FeatureNodeKind = 'component' | 'boolean' | 'body' | 'cutter' | 'base' | 'op';

export interface FeatureNode {
  key: string;
  kind: FeatureNodeKind;
  label: string;
  /** A short second line: sizes, counts or why something cannot be edited. */
  detail?: string;
  objectId: ObjectId;
  opId?: string;
  edit?: FeatureEdit;
  /** Ops only: turned off, and can be turned back on. */
  suppressed?: boolean;
  children: FeatureNode[];
}

/** Where a sketch lives, and how to open it in the real sketch editor. */
export type SketchSource =
  | { kind: 'record'; sketchId: SketchId } // a standalone sketch (it may drive several bodies, or none)
  | { kind: 'profile'; objectId: ObjectId }
  | { kind: 'section'; objectId: ObjectId; index: number }
  | { kind: 'sweep-profile' | 'sweep-path'; objectId: ObjectId }
  | { kind: 'solid-sketch'; objectId: ObjectId }; // inside a precise solid made from a sketch: kept, not editable

export interface SketchNode {
  key: string;
  label: string;
  /** The bodies it drives (names), empty for a sketch on its own. */
  owners: string[];
  /** The body it belongs to or drives first (null for a sketch on its own). */
  objectId: ObjectId | null;
  /** Bodies built from it (standalone sketches). */
  users: ObjectId[];
  source: SketchSource;
  editable: boolean;
  /** Number of lines, arcs and circles, for the second line. */
  entities: number;
  sketch: Sketch;
}

const PRIMITIVE_LABEL: Record<string, string> = {
  box: 'Box',
  cylinder: 'Cylinder',
  cone: 'Cone',
  sphere: 'Sphere',
  torus: 'Torus',
  wedge: 'Wedge',
  tube: 'Tube',
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

const HOLE_STYLE = { simple: 'Hole', counterbore: 'Counterbore hole', countersink: 'Countersink hole' } as const;

/** A short name and description of an operation (shared by the Features view and the Inspector). */
export function describeOp(op: FeatureOp): { label: string; detail: string } {
  switch (op.kind) {
    case 'fillet':
      return { label: 'Fillet', detail: `R ${op.radius} mm · ${plural(op.edges.length, 'edge')}` };
    case 'chamfer':
      return { label: 'Chamfer', detail: `${op.distance} mm · ${plural(op.edges.length, 'edge')}` };
    case 'shell':
      return { label: 'Shell', detail: `${op.thickness} mm walls · ${plural(op.faces.length, 'open face')}` };
    case 'draft':
      return { label: 'Draft', detail: `${op.angle}° · ${plural(op.faces.length, 'face')}` };
    case 'hole': {
      const n = op.pattern?.count ?? 1;
      const depth = op.hole.depth > 0 ? `${op.hole.depth} mm deep` : 'through';
      const copies = n > 1 ? ` · ${n} in a ${op.pattern!.kind === 'linear' ? 'row' : 'circle'}` : '';
      return { label: HOLE_STYLE[op.hole.style], detail: `Ø${op.hole.diameter} mm ${depth}${copies}` };
    }
  }
}

function opNode(o: ShapeObject, op: FeatureOp): FeatureNode {
  const d = describeOp(op);
  return {
    key: `${o.id}:op:${op.id}`,
    kind: 'op',
    label: d.label,
    detail: `${d.detail}${op.suppressed ? ' · off' : ''}`,
    objectId: o.id,
    opId: op.id,
    edit: { kind: 'op', objectId: o.id, opId: op.id, op: op.kind },
    suppressed: !!op.suppressed,
    children: [],
  };
}

/** The node(s) a shape is built from: its base feature, then its operations in order. */
function shapeFeatures(o: ShapeObject): FeatureNode[] {
  const key = `${o.id}:base`;
  if (o.shape === 'solid' && o.feature) {
    const b = o.feature.base;
    const base: FeatureNode =
      b.kind === 'primitive'
        ? { key, kind: 'base', label: PRIMITIVE_LABEL[b.shape] ?? b.shape, detail: 'Precise primitive', objectId: o.id, children: [] }
        : b.kind === 'sketch'
          ? {
              key,
              kind: 'base',
              label: b.op === 'extrude' ? 'Extrude' : 'Revolve',
              detail: `From a sketch · ${b.op === 'extrude' ? `${b.depth} mm` : `${b.angle}°`} · fixed when made precise`,
              objectId: o.id,
              children: [],
            }
          : b.kind === 'brep'
            ? { key, kind: 'base', label: 'Imported solid', detail: `${b.source} · no history`, objectId: o.id, children: [] }
            : b.kind === 'loft'
              ? {
                  key,
                  kind: 'base',
                  label: 'Loft',
                  detail: `${plural(b.sections.length, 'section')} · ${b.ruled ? 'straight' : 'smooth'}`,
                  objectId: o.id,
                  edit: { kind: 'loft', objectId: o.id },
                  children: [],
                }
              : {
                  key,
                  kind: 'base',
                  label: 'Sweep',
                  detail: `${b.corners} corners · ${b.pathPlane === 'XY' ? 'flat' : 'upright'} path`,
                  objectId: o.id,
                  edit: { kind: 'sweep', objectId: o.id },
                  children: [],
                };
    return [base, ...o.feature.ops.map((op) => opNode(o, op))];
  }
  if (o.shape === 'profile' && o.sketch) {
    const revolve = (o.params.op ?? 0) >= 1;
    return [
      {
        key,
        kind: 'base',
        label: revolve ? 'Revolve' : 'Extrude',
        detail: revolve ? `Sketch · ${o.params.angle ?? 360}°` : `Sketch · ${o.params.depth ?? 5} mm`,
        objectId: o.id,
        edit: { kind: 'sketch', objectId: o.id },
        children: [],
      },
    ];
  }
  if (o.shape === 'mesh')
    return [{ key, kind: 'base', label: 'Imported mesh', detail: 'Triangles · no history', objectId: o.id, children: [] }];
  if (o.shape === 'text')
    return [
      {
        key,
        kind: 'base',
        label: 'Text',
        detail: `“${(o.text?.content ?? '').slice(0, 24)}”`,
        objectId: o.id,
        edit: { kind: 'settings', objectId: o.id },
        children: [],
      },
    ];
  return [
    {
      key,
      kind: 'base',
      label: o.name,
      detail: 'Shape settings',
      objectId: o.id,
      edit: { kind: 'settings', objectId: o.id },
      children: [],
    },
  ];
}

function objectNode(doc: ModelDocument, o: SceneObject): FeatureNode {
  if (o.kind === 'group') {
    const children = o.children
      .map((c) => doc.objects[c])
      .filter(Boolean)
      .map((c) => objectNode(doc, c));
    if (o.combine) {
      const solids = children.filter((c) => c.kind !== 'cutter').length;
      const cutters = children.length - solids;
      return {
        key: o.id,
        kind: 'boolean',
        label: o.name,
        detail: `${o.combine === 'union' ? 'Union' : 'Intersect'} · ${plural(solids, 'body')}${cutters ? ` − ${plural(cutters, 'cutter')}` : ''}`,
        objectId: o.id,
        children,
      };
    }
    return {
      key: o.id,
      kind: 'component',
      label: o.name,
      detail: `${o.component ? 'Component' : 'Assembly'} · ${plural(children.length, 'part')}`,
      objectId: o.id,
      children,
    };
  }
  return {
    key: o.id,
    kind: o.isHole ? 'cutter' : 'body',
    label: o.name,
    detail: o.isHole ? 'Cutter (hole)' : undefined,
    objectId: o.id,
    children: shapeFeatures(o),
  };
}

/** Every top-level body, component and Boolean, with what each is built from. */
export function deriveFeatureTree(doc: ModelDocument): FeatureNode[] {
  return doc.rootIds
    .map((id) => doc.objects[id])
    .filter(Boolean)
    .map((o) => objectNode(doc, o));
}

const sketchCounts = (s: Sketch) => ({ entities: s.entities.length, sketch: s });

/** Every sketch in the design: standalone sketches (with the bodies they drive), then loft and sweep sketches. */
export function deriveSketches(doc: ModelDocument): SketchNode[] {
  const out: SketchNode[] = [];
  for (const r of Object.values(doc.sketches ?? {})) {
    const users = sketchUsers(doc, r.id);
    out.push({
      key: `record:${r.id}`,
      label: r.name,
      owners: users.map((u) => u.name),
      objectId: users[0]?.id ?? null,
      users: users.map((u) => u.id),
      source: { kind: 'record', sketchId: r.id },
      editable: true,
      ...sketchCounts(r.sketch),
    });
  }
  const one = (o: ShapeObject, key: string, label: string, source: SketchSource, sketch: Sketch, editable = true) =>
    out.push({ key, label, owners: [o.name], objectId: o.id, users: [], source, editable, ...sketchCounts(sketch) });
  const visit = (id: ObjectId) => {
    const o = doc.objects[id];
    if (!o) return;
    if (o.kind === 'group') return o.children.forEach(visit);
    // A sketched body without a standalone sketch (a version 1 document not yet migrated).
    if (o.shape === 'profile' && o.sketch && !(o.sketchId && doc.sketches?.[o.sketchId]))
      one(o, `${o.id}:sketch`, `${o.name} sketch`, { kind: 'profile', objectId: o.id }, o.sketch);
    const b = o.shape === 'solid' ? o.feature?.base : undefined;
    if (b?.kind === 'loft')
      b.sections.forEach((sec, index) =>
        one(o, `${o.id}:section:${index}`, `Section ${index + 1}`, { kind: 'section', objectId: o.id, index }, sec.sketch),
      );
    if (b?.kind === 'sweep') {
      one(o, `${o.id}:profile`, 'Sweep profile', { kind: 'sweep-profile', objectId: o.id }, b.profile);
      one(o, `${o.id}:path`, 'Sweep path', { kind: 'sweep-path', objectId: o.id }, b.path);
    }
    if (b?.kind === 'sketch') one(o, `${o.id}:solid-sketch`, `${o.name} sketch`, { kind: 'solid-sketch', objectId: o.id }, b.sketch, false);
  };
  doc.rootIds.forEach(visit);
  return out;
}

/**
 * The objects a history step changed: added, removed or edited between two documents. Documents
 * are immutable and structurally shared, so an unchanged object keeps the same reference.
 */
export function changedObjectIds(before: ModelDocument, after: ModelDocument): ObjectId[] {
  if (before === after || before.objects === after.objects) return [];
  const ids = new Set<ObjectId>();
  for (const id in after.objects) if (before.objects[id] !== after.objects[id]) ids.add(id);
  for (const id in before.objects) if (!(id in after.objects)) ids.add(id);
  return [...ids];
}
