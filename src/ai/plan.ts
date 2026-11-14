/**
 * The AI Design Assistant's command language. The model never writes code: it returns a plan
 * of these commands (constrained by PLAN_SCHEMA), and the plan is checked by validatePlan on
 * the server and again in the browser before anything touches the design.
 *
 * Pure TypeScript with no app imports, so the serverless function can use it too.
 */

export const ASSISTANT_SHAPES = [
  'box',
  'cylinder',
  'sphere',
  'cone',
  'pyramid',
  'roof',
  'torus',
  'tube',
  'wedge',
  'halfSphere',
  'polygon',
  'star',
  'capsule',
  'gear',
  'paraboloid',
] as const;
export type AssistantShape = (typeof ASSISTANT_SHAPES)[number];

export type Vec3 = [number, number, number];

export type PlanCommand =
  | {
      op: 'add_shape';
      ref: string;
      shape: AssistantShape;
      name: string | null;
      size: Vec3;
      position: Vec3;
      rotation: Vec3 | null;
      color: string | null;
      hole: boolean;
    }
  | { op: 'add_text'; ref: string; text: string; height: number; depth: number; position: Vec3; color: string | null; hole: boolean }
  | { op: 'set_size'; target: string; size: Vec3 }
  | { op: 'set_position'; target: string; position: Vec3 }
  | { op: 'set_rotation'; target: string; rotation: Vec3 }
  | { op: 'set_color'; target: string; color: string }
  | { op: 'set_hole'; target: string; hole: boolean }
  | { op: 'combine'; ref: string; targets: string[]; mode: 'union' | 'subtract' | 'intersect'; name: string | null }
  | { op: 'delete'; target: string };

export interface Plan {
  /** A short message to the person: what the plan does, or the question to answer. */
  reply: string;
  /** True when the request is too vague to act on: `reply` asks a question and there are no commands. */
  needsClarification: boolean;
  commands: PlanCommand[];
}

/** What the model is told about the current design (top-level objects only). */
export interface SceneObjectSummary {
  id: string;
  name: string;
  kind: 'shape' | 'group';
  shape: string | null;
  size: Vec3;
  position: Vec3;
  rotation: Vec3;
  hole: boolean;
}

export const LIMITS = {
  commands: 40,
  size: [0.2, 500] as const,
  position: 1000,
  text: 120,
  name: 60,
  reply: 1200,
  prompt: 1500,
  scene: 100,
};

// --- JSON schema (structured outputs) ------------------------------------------------------
const num = { type: 'number' };
const vec3 = { type: 'array', items: num, description: '[x, y, z] in millimetres (exactly 3 numbers)' };
const vec3OrNull = { anyOf: [vec3, { type: 'null' }] };
const strOrNull = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const variant = (op: string, props: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: ['op', ...Object.keys(props)],
  properties: { op: { type: 'string', enum: [op] }, ...props },
});

export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'needsClarification', 'commands'],
  properties: {
    reply: { type: 'string' },
    needsClarification: { type: 'boolean' },
    commands: {
      type: 'array',
      items: {
        anyOf: [
          variant('add_shape', {
            ref: { type: 'string' },
            shape: { type: 'string', enum: [...ASSISTANT_SHAPES] },
            name: strOrNull,
            size: vec3,
            position: vec3,
            rotation: vec3OrNull,
            color: strOrNull,
            hole: { type: 'boolean' },
          }),
          variant('add_text', {
            ref: { type: 'string' },
            text: { type: 'string' },
            height: num,
            depth: num,
            position: vec3,
            color: strOrNull,
            hole: { type: 'boolean' },
          }),
          variant('set_size', { target: { type: 'string' }, size: vec3 }),
          variant('set_position', { target: { type: 'string' }, position: vec3 }),
          variant('set_rotation', { target: { type: 'string' }, rotation: vec3 }),
          variant('set_color', { target: { type: 'string' }, color: { type: 'string' } }),
          variant('set_hole', { target: { type: 'string' }, hole: { type: 'boolean' } }),
          variant('combine', {
            ref: { type: 'string' },
            targets: { type: 'array', items: { type: 'string' } },
            mode: { type: 'string', enum: ['union', 'subtract', 'intersect'] },
            name: strOrNull,
          }),
          variant('delete', { target: { type: 'string' } }),
        ],
      },
    },
  },
} as const;

// --- validation ----------------------------------------------------------------------------
export type ValidationResult = { ok: true; plan: Plan } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const COLOR = /^#[0-9a-fA-F]{6}$/;
const REF = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * Check a plan strictly: shape, types, ranges, colours, and that every target is either an
 * object in the design or something an earlier command created (and not since deleted or
 * combined away). Anything wrong rejects the whole plan.
 */
export function validatePlan(raw: unknown, sceneIds: Iterable<string>): ValidationResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['The plan is not an object.'] };
  const { reply, needsClarification, commands } = raw;
  if (typeof reply !== 'string' || !reply.trim()) errors.push('Missing reply.');
  else if (reply.length > LIMITS.reply) errors.push('Reply too long.');
  if (typeof needsClarification !== 'boolean') errors.push('needsClarification must be true or false.');
  if (!Array.isArray(commands)) return { ok: false, errors: [...errors, 'commands must be a list.'] };
  if (commands.length > LIMITS.commands) errors.push(`Too many steps (${commands.length}; at most ${LIMITS.commands}).`);
  if (needsClarification === true && commands.length) errors.push('A clarifying question cannot also change the design.');

  const live = new Set(sceneIds);
  const created = new Set<string>();
  const out: PlanCommand[] = [];
  commands.forEach((c, i) => {
    const at = `Step ${i + 1}`;
    const err = (m: string) => errors.push(`${at}: ${m}`);
    if (!isObj(c) || typeof c.op !== 'string') return err('not a command.');
    const vec = (v: unknown, what: string, check: (n: number) => boolean, range: string): v is Vec3 => {
      if (!Array.isArray(v) || v.length !== 3 || !v.every(finite)) {
        err(`${what} must be three numbers.`);
        return false;
      }
      if (!v.every(check)) {
        err(`${what} must be ${range}.`);
        return false;
      }
      return true;
    };
    const sizeOk = (v: unknown) =>
      vec(v, 'size', (n) => n >= LIMITS.size[0] && n <= LIMITS.size[1], `${LIMITS.size[0]}–${LIMITS.size[1]} mm`);
    const posOk = (v: unknown) => vec(v, 'position', (n) => Math.abs(n) <= LIMITS.position, `within ±${LIMITS.position} mm`);
    const rotOk = (v: unknown) => vec(v, 'rotation', (n) => Math.abs(n) <= 360, 'within ±360°');
    const colorOk = (v: unknown, nullable: boolean) =>
      (nullable && v === null) || (typeof v === 'string' && COLOR.test(v)) || (err('colour must be #RRGGBB.'), false);
    const nameOk = (v: unknown) =>
      v === null || (typeof v === 'string' && v.trim().length > 0 && v.length <= LIMITS.name) || (err('name is invalid.'), false);
    const target = (v: unknown) => {
      if (typeof v !== 'string' || !(live.has(v) || created.has(v))) {
        err(`refers to "${String(v)}", which is not in the design.`);
        return false;
      }
      return true;
    };
    const newRef = (v: unknown) => {
      if (typeof v !== 'string' || !REF.test(v)) return (err('ref must be a short name (letters, numbers, - or _).'), false);
      if (live.has(v) || created.has(v)) return (err(`ref "${v}" is already used.`), false);
      return true;
    };
    const fail = errors.length;
    switch (c.op) {
      case 'add_shape': {
        newRef(c.ref);
        if (!ASSISTANT_SHAPES.includes(c.shape as AssistantShape)) err(`unknown shape "${String(c.shape)}".`);
        nameOk(c.name);
        sizeOk(c.size);
        posOk(c.position);
        if (c.rotation !== null) rotOk(c.rotation);
        colorOk(c.color, true);
        if (typeof c.hole !== 'boolean') err('hole must be true or false.');
        if (errors.length === fail) {
          created.add(c.ref as string);
          out.push({
            op: 'add_shape',
            ref: c.ref as string,
            shape: c.shape as AssistantShape,
            name: (c.name as string | null) ?? null,
            size: c.size as Vec3,
            position: c.position as Vec3,
            rotation: (c.rotation as Vec3 | null) ?? null,
            color: (c.color as string | null) ?? null,
            hole: c.hole as boolean,
          });
        }
        return;
      }
      case 'add_text': {
        newRef(c.ref);
        if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > LIMITS.text) err(`text must be 1–${LIMITS.text} characters.`);
        if (!finite(c.height) || c.height < 1 || c.height > 300) err('text height must be 1–300 mm.');
        if (!finite(c.depth) || c.depth < 0.2 || c.depth > 100) err('text depth must be 0.2–100 mm.');
        posOk(c.position);
        colorOk(c.color, true);
        if (typeof c.hole !== 'boolean') err('hole must be true or false.');
        if (errors.length === fail) {
          created.add(c.ref as string);
          out.push({
            op: 'add_text',
            ref: c.ref as string,
            text: c.text as string,
            height: c.height as number,
            depth: c.depth as number,
            position: c.position as Vec3,
            color: (c.color as string | null) ?? null,
            hole: c.hole as boolean,
          });
        }
        return;
      }
      case 'set_size':
        if (target(c.target) && sizeOk(c.size)) out.push({ op: 'set_size', target: c.target as string, size: c.size as Vec3 });
        return;
      case 'set_position':
        if (target(c.target) && posOk(c.position))
          out.push({ op: 'set_position', target: c.target as string, position: c.position as Vec3 });
        return;
      case 'set_rotation':
        if (target(c.target) && rotOk(c.rotation))
          out.push({ op: 'set_rotation', target: c.target as string, rotation: c.rotation as Vec3 });
        return;
      case 'set_color':
        if (target(c.target) && colorOk(c.color, false))
          out.push({ op: 'set_color', target: c.target as string, color: c.color as string });
        return;
      case 'set_hole':
        if (!target(c.target)) return;
        if (typeof c.hole !== 'boolean') return err('hole must be true or false.');
        out.push({ op: 'set_hole', target: c.target as string, hole: c.hole });
        return;
      case 'combine': {
        newRef(c.ref);
        const t = c.targets;
        if (!Array.isArray(t) || t.length < 2) err('combine needs two or more targets.');
        else {
          t.forEach(target);
          if (new Set(t).size !== t.length) err('combine lists a target twice.');
        }
        if (c.mode !== 'union' && c.mode !== 'subtract' && c.mode !== 'intersect')
          err('combine mode must be union, subtract or intersect.');
        nameOk(c.name);
        if (errors.length === fail) {
          // The parts now live inside the new group.
          for (const id of t as string[]) {
            live.delete(id);
            created.delete(id);
          }
          created.add(c.ref as string);
          out.push({
            op: 'combine',
            ref: c.ref as string,
            targets: t as string[],
            mode: c.mode as 'union' | 'subtract' | 'intersect',
            name: (c.name as string | null) ?? null,
          });
        }
        return;
      }
      case 'delete':
        if (!target(c.target)) return;
        live.delete(c.target as string);
        created.delete(c.target as string);
        out.push({ op: 'delete', target: c.target as string });
        return;
      default:
        err(`unknown command "${c.op}".`);
    }
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, plan: { reply: (reply as string).trim(), needsClarification: needsClarification as boolean, commands: out } };
}

// --- plain-language preview ----------------------------------------------------------------
const mm = (v: Vec3) => v.map((n) => +n.toFixed(1)).join(' × ') + ' mm';
const at = (v: Vec3) => `(${v.map((n) => +n.toFixed(1)).join(', ')})`;

/** One line per step, for the preview the person approves. `names` maps scene ids to names. */
export function describeCommand(c: PlanCommand, names: Record<string, string>): string {
  const n = (id: string) => names[id] ?? id;
  switch (c.op) {
    case 'add_shape':
      return `Add ${c.hole ? 'a hole: ' : 'a '}${c.name ?? c.shape} ${mm(c.size)} at ${at(c.position)}${c.rotation ? `, rotated ${at(c.rotation)}°` : ''}`;
    case 'add_text':
      return `Add ${c.hole ? 'engraved ' : ''}text “${c.text}”, ${c.height} mm tall, ${c.depth} mm deep, at ${at(c.position)}`;
    case 'set_size':
      return `Resize ${n(c.target)} to ${mm(c.size)}`;
    case 'set_position':
      return `Move ${n(c.target)} to ${at(c.position)}`;
    case 'set_rotation':
      return `Rotate ${n(c.target)} to ${at(c.rotation)}°`;
    case 'set_color':
      return `Colour ${n(c.target)} ${c.color}`;
    case 'set_hole':
      return `Make ${n(c.target)} ${c.hole ? 'a hole' : 'solid'}`;
    case 'combine':
      return `${c.mode === 'union' ? 'Join' : c.mode === 'subtract' ? 'Cut' : 'Intersect'} ${c.targets.map(n).join(', ')}${c.name ? ` as “${c.name}”` : ''}`;
    case 'delete':
      return `Delete ${n(c.target)}`;
  }
}
