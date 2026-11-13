import { strFromU8 } from 'fflate';
import { localName, walkXml } from './xml';

/**
 * Supplementary pass over model XML for the data the lib3mf JavaScript binding can't
 * return (its vector-returning getters are unbound) and for vendor attributes that
 * aren't part of the 3MF specification:
 *
 * - per-triangle paint (`paint_color`, `slic3rpe:mmu_segmentation`), sparse by triangle index
 * - composite material constituents and multi-property index lists
 * - declared extensions and content the import can't use (beam lattices, slices, volumetric data)
 *
 * The pass only runs over parts that contain something it needs, found by a cheap byte search.
 */
export interface ScanResult {
  /** "path#objectId" → (triangle index → paint string). */
  paint: Map<string, PaintTable>;
  composites: Map<string, { matid: number; matindices: number[]; values: number[][] }>;
  multis: Map<string, { pids: number[]; pindices: number[][] }>;
  /** Root model element attributes / namespaces. */
  requiredExtensions: string[];
  namespaces: Record<string, string>;
  /** Element local names found that the import does not support (e.g. beamlattice). */
  unsupported: Map<string, number>;
}

export const objectKey = (path: string, id: number) => `${path}#${id}`;

/**
 * Slicer paint per triangle, stored densely: codes[t] = 0 for an unpainted triangle,
 * otherwise 1 + an index into `strings` (identical paint strings are stored once).
 */
export interface PaintTable {
  codes: Uint32Array;
  strings: string[];
}

export class PaintBuilder {
  private index = new Map<string, number>();
  readonly strings: string[] = [];
  private entries: number[] = [];
  add(triangle: number, value: string) {
    let k = this.index.get(value);
    if (k === undefined) {
      k = this.strings.push(value);
      this.index.set(value, k);
    }
    this.entries.push(triangle, k);
  }
  get size() {
    return this.entries.length / 2;
  }
  finish(triangles: number): PaintTable {
    const codes = new Uint32Array(triangles);
    for (let i = 0; i < this.entries.length; i += 2) if (this.entries[i] < triangles) codes[this.entries[i]] = this.entries[i + 1];
    return { codes, strings: this.strings };
  }
}

const UNSUPPORTED = new Set(['beamlattice', 'slicestack', 'sliceref', 'levelset', 'volumedata', 'displacementmesh', 'implicitfunction']);

function contains(bytes: Uint8Array, needles: string[]): boolean {
  // Model parts can be large; decode once and use indexOf (fast, native).
  const text = strFromU8(bytes);
  return needles.some((n) => text.includes(n));
}

export function scanModelParts(parts: { path: string; bytes: Uint8Array }[], rootPath: string): ScanResult {
  const result: ScanResult = {
    paint: new Map(),
    composites: new Map(),
    multis: new Map(),
    requiredExtensions: [],
    namespaces: {},
    unsupported: new Map(),
  };
  for (const { path, bytes } of parts) {
    const isRoot = path.toLowerCase() === rootPath.toLowerCase();
    const needles = ['paint_color', 'mmu_segmentation', 'compositematerials', 'multiproperties', ...UNSUPPORTED];
    if (!isRoot && !contains(bytes, needles)) continue;
    if (isRoot && !contains(bytes, needles)) {
      // Only the root element is needed: read the header.
      readRootHeader(strFromU8(bytes.subarray(0, Math.min(bytes.length, 8192))), result);
      continue;
    }
    scanPart(path, strFromU8(bytes), isRoot, result);
  }
  return result;
}

function readRootHeader(head: string, result: ScanResult) {
  const m = /<(?:\w+:)?model\b([^>]*)>/.exec(head);
  if (!m) return;
  for (const a of m[1].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) applyRootAttr(a[1], a[2], result);
}

function applyRootAttr(name: string, value: string, result: ScanResult) {
  if (name === 'xmlns') result.namespaces[''] = value;
  else if (name.startsWith('xmlns:')) result.namespaces[name.slice(6)] = value;
  else if (name === 'requiredextensions') result.requiredExtensions = value.split(/\s+/).filter(Boolean);
}

function scanPart(path: string, xml: string, isRoot: boolean, result: ScanResult) {
  let objectId: number | null = null;
  let triangle = -1;
  let paint: PaintBuilder | null = null;
  const flush = () => {
    if (paint && objectId !== null) result.paint.set(objectKey(path, objectId), paint.finish(triangle + 1));
  };
  let composite: { matid: number; matindices: number[]; values: number[][] } | null = null;
  let multi: { pids: number[]; pindices: number[][] } | null = null;
  let first = true;
  const nums = (s: string | undefined) => (s ?? '').trim().split(/\s+/).filter(Boolean).map(Number);
  walkXml(
    xml,
    {
      open: (tag, a) => {
        const n = localName(tag);
        if (first) {
          first = false;
          if (isRoot && n === 'model') for (const [k, v] of Object.entries(a)) applyRootAttr(k, v, result);
        }
        switch (n) {
          case 'object':
            objectId = Number(a.id);
            triangle = -1;
            paint = null;
            break;
          case 'triangle': {
            triangle++;
            const p = a.paint_color ?? a['slic3rpe:mmu_segmentation'];
            if (p && objectId !== null) (paint ??= new PaintBuilder()).add(triangle, p);
            break;
          }
          case 'compositematerials':
            composite = { matid: Number(a.matid), matindices: nums(a.matindices), values: [] };
            result.composites.set(objectKey(path, Number(a.id)), composite);
            break;
          case 'composite':
            composite?.values.push(nums(a.values));
            break;
          case 'multiproperties':
            multi = { pids: nums(a.pids), pindices: [] };
            result.multis.set(objectKey(path, Number(a.id)), multi);
            break;
          case 'multi':
            multi?.pindices.push(nums(a.pindices));
            break;
          default:
            if (UNSUPPORTED.has(n)) result.unsupported.set(n, (result.unsupported.get(n) ?? 0) + 1);
        }
      },
      close: (tag) => {
        const n = localName(tag);
        if (n === 'object') {
          flush();
          paint = null;
          objectId = null;
        } else if (n === 'compositematerials') composite = null;
        else if (n === 'multiproperties') multi = null;
      },
    },
    path.replace(/^\//, ''),
  );
}
