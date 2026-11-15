import { migratePlanes, migrateSketchesDraft } from '@/cad/sketchRecords';
import { validateRecipe } from '@/cad/brep/types';
import type { ModelDocument, SceneObject } from '@/types/document';
import type { MeshData } from '../kernel/meshData';
import { collectSubtree } from '../document';
import { createEmptyDocument } from '../document';

/**
 * The persisted project. Plain data (typed arrays for meshes) so it can be
 * stored in IndexedDB as-is, and turned into a portable JSON file.
 *
 * Designed to map 1:1 onto a future cloud backend (Supabase): `meta` → a
 * `projects` table row, `document` → JSONB column, `assets` → storage objects.
 */
export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  objectCount: number;
  /** Small PNG data URL rendered from the viewport. */
  thumbnail?: string;
  /**
   * The workspace that made the project: 'design' (the Design Studio) or a maker
   * ('keyring', 'keytag', 'sign', 'cookie', 'vase'). Missing on projects saved before
   * MODELLIO 2.0, which are Design Studio projects.
   */
  workspace?: string;
}

/**
 * A maker's own settings, kept with the project so the maker can reopen it exactly. The
 * generated geometry is also stored in `document` as ordinary mesh objects, so the same
 * project opens in the Design Studio. `schema` is the maker's settings version (each maker
 * migrates its own older settings).
 */
export interface MakerProjectState {
  studio: string;
  schema: number;
  state: unknown;
}

export interface ProjectData {
  meta: ProjectMeta;
  document: ModelDocument;
  /** Mesh assets referenced by mesh shapes (imports, flattened Booleans). */
  assets: Record<string, MeshData>;
  /** Present when a maker made the project. */
  maker?: MakerProjectState;
}

/** The workspace a project belongs to (older projects are Design Studio projects). */
export const workspaceOf = (meta: Pick<ProjectMeta, 'workspace'>) => meta.workspace ?? 'design';

export const PROJECT_FILE_FORMAT = 'modellio-project';
/** v2 (MODELLIO 2.0): adds `meta.workspace` and `maker`. v1 files open as Design Studio projects. */
/** 3: precise solids (`solid` shapes with a feature recipe). */
/** 4: carries schema-2 documents (standalone sketches, components). */
/** 5: carries schema-3 documents (reference planes, sketch placements). */
export const PROJECT_FILE_VERSION = 5;
/** 2: standalone sketches and components; 3: reference planes and sketch placements (older documents are upgraded on load). */
export const CURRENT_SCHEMA = 3;

export class ProjectFormatError extends Error {}

/** Asset ids referenced by a document. */
export function referencedAssets(doc: ModelDocument): string[] {
  const ids = new Set<string>();
  for (const o of Object.values(doc.objects)) if (o.kind === 'shape' && o.meshId) ids.add(o.meshId);
  return [...ids];
}

// ---------- validation & migration ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isVec3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/**
 * Validate (and migrate) an untrusted document. Throws ProjectFormatError
 * with a readable message if it can't be used. Repairs small inconsistencies
 * (dangling child references, missing optional fields) instead of failing.
 */
export function migrateDocument(raw: unknown): ModelDocument {
  if (!isObj(raw)) throw new ProjectFormatError('The project contains no design.');
  const version = raw.schemaVersion;
  if (typeof version !== 'number') throw new ProjectFormatError('Missing schema version.');
  if (version > CURRENT_SCHEMA) throw new ProjectFormatError('This project was made with a newer version of MODELLIO.');
  if (!isObj(raw.objects) || !Array.isArray(raw.rootIds)) throw new ProjectFormatError('The design data is incomplete.');

  const doc = createEmptyDocument();
  if (isObj(raw.settings) && Array.isArray(raw.settings.workplane) && raw.settings.workplane.length === 2) {
    doc.settings.workplane = [Number(raw.settings.workplane[0]) || 200, Number(raw.settings.workplane[1]) || 200];
  }
  for (const [id, value] of Object.entries(raw.objects)) {
    if (!isObj(value) || value.id !== id) throw new ProjectFormatError(`Object ${id} is malformed.`);
    const t = value.transform;
    if (!isObj(t) || !isVec3(t.position) || !isVec3(t.rotation)) throw new ProjectFormatError(`Object ${id} has an invalid transform.`);
    if (value.kind === 'shape') {
      if (typeof value.shape !== 'string' || !isVec3(value.size)) throw new ProjectFormatError(`Shape ${id} is malformed.`);
      if (value.shape === 'solid') {
        const problem = validateRecipe(value.feature);
        if (problem) throw new ProjectFormatError(`Solid ${id}: ${problem}`);
      }
    } else if (value.kind === 'group') {
      if (!Array.isArray(value.children)) throw new ProjectFormatError(`Group ${id} is malformed.`);
    } else {
      throw new ProjectFormatError(`Object ${id} has an unknown kind.`);
    }
    const o = structuredClone(value) as unknown as SceneObject;
    o.name = typeof o.name === 'string' && o.name ? o.name : 'Object';
    o.visible = o.visible !== false;
    o.locked = o.locked === true;
    o.parentId = typeof o.parentId === 'string' ? o.parentId : null;
    if (o.kind === 'group' && o.component !== undefined && o.component !== true) delete o.component;
    if (o.kind === 'shape') {
      o.params = isObj(o.params) ? o.params : {};
      o.color = typeof o.color === 'string' ? o.color : '#2463EB';
      o.isHole = o.isHole === true;
      if (o.finish !== undefined && !(['matte', 'satin', 'gloss'] as unknown[]).includes(o.finish)) delete o.finish;
      if (o.opacity !== undefined) {
        if (typeof o.opacity !== 'number' || !Number.isFinite(o.opacity) || o.opacity >= 1) delete o.opacity;
        else o.opacity = Math.max(0.1, o.opacity);
      }
    }
    doc.objects[id] = o;
  }
  // Reference planes (schema 3), then standalone sketches (schema 2) and their placements.
  doc.planes = migratePlanes(raw.planes);
  migrateSketchesDraft(doc, raw.sketches);
  // Repair references.
  for (const o of Object.values(doc.objects)) {
    if (o.kind === 'group') o.children = o.children.filter((c) => doc.objects[c]?.parentId === o.id);
    if (o.parentId && doc.objects[o.parentId]?.kind !== 'group') o.parentId = null;
  }
  doc.rootIds = (raw.rootIds as unknown[]).filter(
    (id): id is string => typeof id === 'string' && !!doc.objects[id] && !doc.objects[id].parentId,
  );
  // Anything orphaned becomes top-level rather than silently disappearing.
  const reachable = new Set(collectSubtree(doc, doc.rootIds));
  for (const o of Object.values(doc.objects)) {
    if (!reachable.has(o.id) && !o.parentId) doc.rootIds.push(o.id);
  }
  return doc;
}

// ---------- portable file (.modellio) ----------

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Serialise a project to a self-contained JSON file (meshes base64-encoded, little-endian). */
export function projectToFile(p: ProjectData): string {
  const assets: Record<string, { positions: string; indices: string }> = {};
  for (const id of referencedAssets(p.document)) {
    const a = p.assets[id];
    if (!a) continue;
    assets[id] = {
      positions: toBase64(new Uint8Array(a.positions.buffer, a.positions.byteOffset, a.positions.byteLength)),
      indices: toBase64(new Uint8Array(a.indices.buffer, a.indices.byteOffset, a.indices.byteLength)),
    };
  }
  const { thumbnail: _thumb, ...meta } = p.meta;
  void _thumb;
  return JSON.stringify({
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    meta,
    document: p.document,
    assets,
    ...(p.maker ? { maker: p.maker } : {}),
  });
}

/** Parse a .modellio file. Throws ProjectFormatError for anything invalid. */
export function projectFromFile(text: string): ProjectData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFormatError('This file is not a MODELLIO project (invalid JSON).');
  }
  if (!isObj(raw) || raw.format !== PROJECT_FILE_FORMAT) throw new ProjectFormatError('This file is not a MODELLIO project.');
  if (typeof raw.version !== 'number' || raw.version > PROJECT_FILE_VERSION)
    throw new ProjectFormatError('This project file is from a newer version of MODELLIO.');
  const document = migrateDocument(raw.document);
  const assets: Record<string, MeshData> = {};
  const rawAssets = isObj(raw.assets) ? raw.assets : {};
  for (const id of referencedAssets(document)) {
    const a = rawAssets[id];
    if (!isObj(a) || typeof a.positions !== 'string' || typeof a.indices !== 'string')
      throw new ProjectFormatError(`Mesh data for ${id} is missing.`);
    const pb = fromBase64(a.positions);
    const ib = fromBase64(a.indices);
    if (pb.byteLength % 12 || ib.byteLength % 12) throw new ProjectFormatError(`Mesh data for ${id} is corrupt.`);
    const positions = new Float32Array(pb.buffer, pb.byteOffset, pb.byteLength / 4).slice();
    const indices = new Uint32Array(ib.buffer, ib.byteOffset, ib.byteLength / 4).slice();
    const vcount = positions.length / 3;
    for (const i of indices) if (i >= vcount) throw new ProjectFormatError(`Mesh data for ${id} is corrupt.`);
    assets[id] = { positions, indices };
  }
  const m = isObj(raw.meta) ? raw.meta : {};
  const now = Date.now();
  return {
    meta: {
      id: typeof m.id === 'string' ? m.id : '',
      name: typeof m.name === 'string' && m.name ? m.name : 'Imported project',
      createdAt: typeof m.createdAt === 'number' ? m.createdAt : now,
      updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : now,
      objectCount: Object.keys(document.objects).length,
      ...(typeof m.workspace === 'string' ? { workspace: m.workspace } : {}),
    },
    document,
    assets,
    ...(readMaker(raw.maker) ?? {}),
  };
}

/** Validate a stored maker block (anything malformed is dropped, keeping the geometry). */
function readMaker(v: unknown): { maker: MakerProjectState } | null {
  if (!isObj(v) || typeof v.studio !== 'string' || typeof v.schema !== 'number' || !('state' in v)) return null;
  return { maker: { studio: v.studio, schema: v.schema, state: v.state } };
}
