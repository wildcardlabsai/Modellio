import { useEditor } from '@/store/editorStore';
import { initKernel } from '@/cad/kernel/kernel';
import type { Plan, SceneObjectSummary, Vec3 } from './plan';

/** The design as the assistant sees it: top-level objects, in world millimetres. */
export function sceneSummary(): SceneObjectSummary[] {
  const { doc } = useEditor.getState();
  return doc.rootIds.slice(0, 100).map((id) => {
    const o = doc.objects[id];
    const r = (v: number[]) => v.map((n) => Math.round(n * 100) / 100) as Vec3;
    return {
      id,
      name: o.name,
      kind: o.kind,
      shape: o.kind === 'shape' ? o.shape : null,
      size: r(o.kind === 'shape' ? o.size : [0, 0, 0]),
      position: r(o.transform.position),
      rotation: r(o.transform.rotation),
      hole: o.kind === 'shape' ? !!o.isHole : false,
    };
  });
}

/**
 * Apply a validated plan to the design as a single undoable step ("Assistant: …"). Every
 * command goes through the same editor actions a person uses. If anything fails, the whole
 * plan is rolled back and the error is returned.
 */
export async function executePlan(
  plan: Plan,
  label = 'Assistant',
): Promise<{ ok: true; created: string[] } | { ok: false; error: string }> {
  const e = () => useEditor.getState();
  if (e().readOnly) return { ok: false, error: 'This design is read-only.' };
  await initKernel();
  const ids = new Map<string, string>();
  const resolve = (t: string) => ids.get(t) ?? t;
  const created: string[] = [];
  e().beginTransaction(label);
  try {
    for (const c of plan.commands) {
      switch (c.op) {
        case 'add_shape': {
          const id = e().addShape(c.shape, [c.position[0], c.position[1]], { exact: true });
          if (!id) throw new Error(`Could not add a ${c.shape}.`);
          e().setSize(id, c.size);
          if (c.rotation) e().setRotation(id, c.rotation);
          e().setPosition(id, c.position);
          if (c.color) e().setColor(id, c.color);
          if (c.hole) e().setHole([id], true);
          if (c.name) e().rename(id, c.name);
          ids.set(c.ref, id);
          created.push(id);
          break;
        }
        case 'add_text': {
          const id = await e().addText(c.text, [c.position[0], c.position[1]]);
          if (!id) throw new Error('Could not add the text.');
          await e().setText(id, { fontSize: c.height });
          const o = e().doc.objects[id];
          if (o?.kind === 'shape') e().setSize(id, [o.size[0], o.size[1], c.depth]);
          e().setPosition(id, c.position);
          if (c.color) e().setColor(id, c.color);
          if (c.hole) e().setHole([id], true);
          ids.set(c.ref, id);
          created.push(id);
          break;
        }
        case 'set_size':
          e().setSize(resolve(c.target), c.size);
          break;
        case 'set_position':
          e().setPosition(resolve(c.target), c.position);
          break;
        case 'set_rotation':
          e().setRotation(resolve(c.target), c.rotation);
          break;
        case 'set_color':
          e().setColor(resolve(c.target), c.color);
          break;
        case 'set_hole':
          e().setHole([resolve(c.target)], c.hole);
          break;
        case 'combine': {
          const targets = c.targets.map(resolve);
          e().select(targets);
          e().combineSelected(c.mode);
          const gid = e().selection[0];
          if (!gid || targets.includes(gid) || e().doc.objects[gid]?.kind !== 'group') throw new Error('Could not combine those objects.');
          if (c.name) e().rename(gid, c.name);
          ids.set(c.ref, gid);
          created.push(gid);
          break;
        }
        case 'delete':
          e().select([resolve(c.target)]);
          e().deleteSelected();
          break;
      }
    }
    e().commitTransaction();
    const alive = created.filter((id) => e().doc.objects[id] && e().doc.rootIds.includes(id));
    if (alive.length) e().select(alive);
    return { ok: true, created: alive };
  } catch (err) {
    e().cancelTransaction();
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
