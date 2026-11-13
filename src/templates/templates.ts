import type { EditorState } from '@/store/editorStore';
import type { ObjectId } from '@/types/document';

/**
 * Starter designs. Each is built with the same editor commands a person would
 * use (shapes, holes, hollow, text, Combine), so every template is fully
 * editable — nothing is a baked mesh.
 */
export interface Template {
  id: string;
  name: string;
  description: string;
  tags: string[];
  level: 'Beginner' | 'Intermediate';
  build: (e: EditorState) => Promise<void>;
}

/** Add a primitive with exact size and position (mm). */
function part(
  e: EditorState,
  type: Parameters<EditorState['addShape']>[0],
  size: [number, number, number],
  pos: [number, number, number],
  opts?: { hole?: boolean; name?: string; color?: string; params?: Record<string, number>; rot?: [number, number, number] },
): ObjectId {
  const id = e.addShape(type, [pos[0], pos[1]], { exact: true });
  e.setSize(id, size);
  e.setPosition(id, pos);
  if (opts?.rot) e.setRotation(id, opts.rot);
  if (opts?.params) for (const [k, v] of Object.entries(opts.params)) e.setParam(id, k, v);
  if (opts?.hole) e.setHole([id], true);
  if (opts?.name) e.rename(id, opts.name);
  if (opts?.color) e.setColor(id, opts.color);
  return id;
}

function combine(e: EditorState, ids: ObjectId[], name: string): ObjectId {
  e.select(ids);
  e.combineSelected('union');
  const gid = e.selection[0];
  e.rename(gid, name);
  return gid;
}

export const TEMPLATES: Template[] = [
  {
    id: 'desk-organiser',
    name: 'Desk organiser',
    description: 'A three-compartment tray with rounded corners. Change the size and the walls follow.',
    tags: ['Hollow', 'Combine'],
    level: 'Beginner',
    build: async (e) => {
      const tray = part(e, 'box', [150, 70, 45], [0, 0, 22.5], {
        name: 'Tray',
        color: '#2463EB',
        params: { shell: 2.4, openTop: 1, radius: 6 },
      });
      const d1 = part(e, 'box', [2.4, 66, 42.6], [-25, 0, 23.7], { name: 'Divider', color: '#2463EB' });
      const d2 = part(e, 'box', [2.4, 66, 42.6], [25, 0, 23.7], { name: 'Divider', color: '#2463EB' });
      combine(e, [tray, d1, d2], 'Desk organiser');
    },
  },
  {
    id: 'name-keychain',
    name: 'Name keychain',
    description: 'Raised lettering on a rounded tag with a ring hole. Edit the text to make it yours.',
    tags: ['Text', 'Holes'],
    level: 'Beginner',
    build: async (e) => {
      const tag = part(e, 'box', [62, 22, 3], [0, 0, 1.5], { name: 'Tag', color: '#F97316', params: { radius: 1.4 } });
      const ring = part(e, 'cylinder', [5, 5, 10], [-24, 0, 2], { name: 'Ring hole', hole: true });
      const text = await e.addText('MAKER', [6, 0]);
      if (text) {
        await e.setText(text, { fontSize: 11 });
        const t = e.doc.objects[text];
        if (t?.kind === 'shape') {
          e.setSize(text, [t.size[0], t.size[1], 1.6]);
          e.setPosition(text, [6, 0, 3.8]);
        }
      }
      combine(e, text ? [tag, ring, text] : [tag, ring], 'Keychain');
    },
  },
  {
    id: 'phone-stand',
    name: 'Phone stand',
    description: 'A sturdy stand that holds a phone at a comfortable reading angle.',
    tags: ['Rotation', 'Combine'],
    level: 'Intermediate',
    build: async (e) => {
      const base = part(e, 'box', [80, 70, 6], [0, 0, 3], { name: 'Base', color: '#10B981', params: { radius: 2 } });
      const back = part(e, 'box', [80, 8, 72], [0, 14, 33], { name: 'Back rest', color: '#10B981', rot: [-22, 0, 0] });
      const lip = part(e, 'box', [80, 6, 14], [0, -24, 7], { name: 'Front lip', color: '#10B981' });
      const cable = part(e, 'box', [14, 30, 20], [0, -20, 6], { name: 'Cable slot', hole: true });
      combine(e, [base, back, lip, cable], 'Phone stand');
      e.dropToWorkplane(e.selection);
    },
  },
  {
    id: 'hex-coaster',
    name: 'Hex coaster',
    description: 'A hexagonal coaster with an engraved star — a quick, satisfying first print.',
    tags: ['Engraving', 'Holes'],
    level: 'Beginner',
    build: async (e) => {
      const hex = part(e, 'polygon', [95, 95, 5], [0, 0, 2.5], { name: 'Coaster', color: '#8B5CF6', params: { sides: 6 } });
      const star = part(e, 'star', [52, 52, 3], [0, 0, 5], { name: 'Star engraving', hole: true });
      combine(e, [hex, star], 'Hex coaster');
    },
  },
  {
    id: 'plant-pot',
    name: 'Plant pot',
    description: 'A round pot with a drainage hole. Hollow walls are set in the inspector.',
    tags: ['Hollow', 'Holes'],
    level: 'Beginner',
    build: async (e) => {
      const pot = part(e, 'cylinder', [80, 80, 75], [0, 0, 37.5], {
        name: 'Pot',
        color: '#EC4899',
        params: { shell: 2.4, openTop: 1, segments: 96 },
      });
      const drain = part(e, 'cylinder', [10, 10, 10], [0, 0, 1], { name: 'Drainage hole', hole: true });
      combine(e, [pot, drain], 'Plant pot');
    },
  },
  {
    id: 'cable-clip',
    name: 'Cable clip',
    description: 'A C-shaped clip that keeps a cable tidy. Mirror and duplicate to make a set.',
    tags: ['Tube', 'Holes'],
    level: 'Beginner',
    build: async (e) => {
      const ring = part(e, 'tube', [20, 20, 10], [0, 0, 10], { name: 'Ring', color: '#0EA5E9', params: { wall: 3, segments: 64 } });
      const gap = part(e, 'box', [6, 12, 14], [0, 8, 10], { name: 'Opening', hole: true });
      const foot = part(e, 'box', [24, 6, 10], [0, -10, 3], { name: 'Foot', color: '#0EA5E9' });
      e.setRotation(ring, [90, 0, 0]);
      e.setRotation(gap, [90, 0, 0]);
      e.setPosition(ring, [0, 0, 10]);
      e.setPosition(gap, [0, 0, 18]);
      e.setPosition(foot, [0, 0, 3]);
      e.setSize(foot, [24, 10, 6]);
      combine(e, [ring, gap, foot], 'Cable clip');
    },
  },
];
