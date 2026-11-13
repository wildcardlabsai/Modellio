import type { RawBuildItem, RawColourEntry, RawComponents, RawMesh, RawModel, RawResource } from './parse3mf';
import { objectKey, PaintBuilder, type ScanResult } from './scan';
import { ThreeMFImportError } from './xml';
import { UNIT_TO_MM, type Mat4, type ThreeMFUnit } from '../model/types';

/**
 * Fast 3MF model reader. A single pass per model part over the XML text, with no
 * per-element allocation on the hot path (vertices and triangles), so large models
 * parse at hundreds of MB/s instead of one WebAssembly call per value.
 *
 * It produces exactly the structures the lib3mf reader produces (RawModel, using the
 * same conventions: lib3mf-style unique resource IDs, property IDs = index + 1), plus the
 * data lib3mf's JavaScript binding cannot return (paint, composite and multi-property
 * constituents). Unit tests compare the two readers on every fixture, so lib3mf stays the
 * reference implementation for correctness.
 *
 * Coverage: core (objects, meshes, components, build, transforms, units, metadata),
 * Materials and Properties (base materials, colour groups, texture groups, composites,
 * multi-properties) and Production (model parts referenced by p:path). Other content
 * (beam lattices, slices, volumetric data …) is counted and reported, never silently dropped.
 */

const UNSUPPORTED = new Set(['beamlattice', 'slicestack', 'sliceref', 'levelset', 'volumedata', 'displacementmesh', 'implicitfunction']);

class Grow32F {
  a = new Float32Array(1024);
  n = 0;
  push3(x: number, y: number, z: number) {
    if (this.n + 3 > this.a.length) this.grow();
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  grow() {
    const b = new Float32Array(this.a.length * 2);
    b.set(this.a);
    this.a = b;
  }
  done() {
    return this.a.slice(0, this.n);
  }
}
class Grow32U {
  a = new Uint32Array(1024);
  n = 0;
  push(v: number) {
    if (this.n === this.a.length) {
      const b = new Uint32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
  done() {
    return this.a.slice(0, this.n);
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeEntities(v: string): string {
  if (v.indexOf('&') < 0) return v;
  return v.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

const isSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9;

const TEXT_DECODER = new TextDecoder();
const POW10 = Array.from({ length: 41 }, (_, i) => 10 ** (i - 20));

/** Index of an ASCII sequence in bytes, from `from`. */
function find(b: Uint8Array, seq: string, from: number): number {
  const c0 = seq.charCodeAt(0);
  for (let i = b.indexOf(c0, from); i >= 0; i = b.indexOf(c0, i + 1)) {
    let ok = true;
    for (let k = 1; k < seq.length; k++)
      if (b[i + k] !== seq.charCodeAt(k)) {
        ok = false;
        break;
      }
    if (ok) return i;
  }
  return -1;
}
function starts(b: Uint8Array, at: number, seq: string): boolean {
  for (let k = 0; k < seq.length; k++) if (b[at + k] !== seq.charCodeAt(k)) return false;
  return true;
}

/** Parse a decimal number in s[start, end) without allocating; falls back to parseFloat for unusual input. */
function num(s: Uint8Array, start: number, end: number): number {
  let i = start;
  while (i < end && isSpace(s[i])) i++;
  let neg = false;
  let c = s[i];
  if (c === 45) {
    neg = true;
    i++;
  } else if (c === 43) i++;
  let mant = 0;
  let digits = 0;
  let exp = 0;
  let any = false;
  while (i < end) {
    c = s[i];
    if (c < 48 || c > 57) break;
    if (digits < 17) {
      mant = mant * 10 + (c - 48);
      if (mant) digits++;
    } else exp++;
    any = true;
    i++;
  }
  if (c === 46) {
    i++;
    while (i < end) {
      c = s[i];
      if (c < 48 || c > 57) break;
      if (digits < 17) {
        mant = mant * 10 + (c - 48);
        if (mant) digits++;
        exp--;
      }
      any = true;
      i++;
    }
  }
  if (i < end && (c === 101 || c === 69)) {
    i++;
    let eneg = false;
    c = s[i];
    if (c === 45) {
      eneg = true;
      i++;
    } else if (c === 43) i++;
    let e = 0;
    let edig = false;
    while (i < end) {
      c = s[i];
      if (c < 48 || c > 57) break;
      e = e * 10 + (c - 48);
      edig = true;
      i++;
    }
    if (!edig) return parseFloat(TEXT_DECODER.decode(s.subarray(start, end)));
    exp += eneg ? -e : e;
  }
  while (i < end && isSpace(s[i])) i++;
  if (!any || i !== end) return parseFloat(TEXT_DECODER.decode(s.subarray(start, end)));
  const v =
    exp === 0 ? mant : exp >= -20 && exp < 0 ? mant / POW10[20 - exp] : exp > 0 && exp <= 20 ? mant * POW10[20 + exp] : mant * 10 ** exp;
  return neg ? -v : v;
}

function uint(s: Uint8Array, start: number, end: number): number {
  let v = 0;
  let any = false;
  for (let i = start; i < end; i++) {
    const c = s[i];
    if (c >= 48 && c <= 57) {
      v = v * 10 + (c - 48);
      any = true;
    } else if (!isSpace(c)) return NaN;
  }
  return any ? v : NaN;
}

function parseColour(v: string | undefined): { colour: string; alpha: number } | null {
  const m = /^\s*#([0-9a-f]{6})([0-9a-f]{2})?\s*$/i.exec(v ?? '');
  if (!m) return null;
  return { colour: '#' + m[1].toUpperCase(), alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}

function parseTransform(v: string | undefined, scale: number): Mat4 | null {
  if (!v) return null;
  const f = v.trim().split(/\s+/).map(Number);
  if (f.length !== 12 || f.some((x) => !Number.isFinite(x))) return null;
  return [f[0], f[1], f[2], 0, f[3], f[4], f[5], 0, f[6], f[7], f[8], 0, f[9] * scale, f[10] * scale, f[11] * scale, 1];
}

const IDENT: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

interface PendingMesh {
  mesh: RawMesh;
  /** Model IDs of triangle property groups (resolved to uids after the part is read). */
  triPidModel: Uint32Array;
  objPid: number | null;
  objPindex: number;
}

export interface FastParseResult {
  raw: RawModel;
  scan: ScanResult;
}

export interface FastParseOptions {
  onProgress?: (fraction: number) => void;
}

const TEXT = new TextDecoder();

export function parseModelParts(
  parts: { path: string; bytes: Uint8Array }[],
  rootPath: string,
  options: FastParseOptions = {},
): FastParseResult {
  const resources = new Map<number, RawResource>();
  const uidOf = new Map<string, number>();
  let nextUid = 1;
  const meshes: RawMesh[] = [];
  const components: RawComponents[] = [];
  const pendingComponents: { comp: RawComponents; refs: { path: string; id: number }[] }[] = [];
  const buildItems: (RawBuildItem & { ref: { path: string; id: number } })[] = [];
  const baseGroups = new Map<number, RawColourEntry[]>();
  const colourGroups = new Map<number, RawColourEntry[]>();
  const textureGroups = new Map<number, { texturePath: string; count: number }>();
  const texturePaths = new Map<string, string>();
  const textureRefs: { uid: number; key: string }[] = [];
  const composites = new Map<number, { baseUid: number; count: number }>();
  const compositeBaseRefs: { uid: number; key: string }[] = [];
  const multis = new Map<number, { layerUids: number[]; count: number }>();
  const multiRefs: { uid: number; keys: string[] }[] = [];
  const metadata: Record<string, string> = {};
  const warnings: string[] = [];
  const scan: ScanResult = {
    paint: new Map(),
    composites: new Map(),
    multis: new Map(),
    requiredExtensions: [],
    namespaces: {},
    unsupported: new Map(),
  };
  let rootUnit: ThreeMFUnit = 'millimeter';
  const totalBytes = parts.reduce((s, p) => s + p.bytes.length, 0) || 1;
  let doneBytes = 0;

  const register = (path: string, id: number, kind: RawResource['kind']): number => {
    const key = objectKey(path, id);
    if (uidOf.has(key)) throw new ThreeMFImportError(`The 3MF model could not be read: Duplicate Resource ID ${id} in ${path}.`);
    const uid = nextUid++;
    uidOf.set(key, uid);
    resources.set(uid, { uid, id, path, kind });
    return uid;
  };

  // Root part first, so its unit is known.
  const ordered = [...parts].sort((a, b) =>
    a.path.toLowerCase() === rootPath.toLowerCase() ? -1 : b.path.toLowerCase() === rootPath.toLowerCase() ? 1 : 0,
  );
  for (const part of ordered) {
    const isRoot = part.path.toLowerCase() === rootPath.toLowerCase();
    const b = part.bytes;
    const str = (x: number, y: number) => TEXT.decode(b.subarray(x, y));
    const path = part.path;
    const n = b.length;
    const stack: string[] = [];
    let scale = 1;
    let unitSeen = false;

    let current: PendingMesh | null = null;
    let currentObj: { id: number; name: string; type: string; pid: number | null; pindex: number } | null = null;
    let verts: Grow32F | null = null;
    let tris: Grow32U | null = null;
    let triPid: Grow32U | null = null;
    let triP: Grow32U | null = null;
    let paint: PaintBuilder | null = null;
    let comp: { comp: RawComponents; refs: { path: string; id: number }[] } | null = null;
    let base: RawColourEntry[] | null = null;
    let colours: RawColourEntry[] | null = null;
    let tex: { texturePath: string; count: number } | null = null;
    let compo: { matid: number; matindices: number[]; values: number[][] } | null = null;
    let multi: { pids: number[]; pindices: number[][] } | null = null;
    let metaName: string | null = null;
    const pendingMeshes: PendingMesh[] = [];
    let nextProgress = 0;

    let i = 0;
    for (;;) {
      const lt = b.indexOf(60, i);
      if (lt < 0) break;
      const c1 = b[lt + 1];
      if (c1 === 33) {
        if (starts(b, lt, '<!--')) {
          const e = find(b, '-->', lt + 4);
          if (e < 0) throw broken(path, 'an unterminated comment');
          i = e + 3;
        } else if (starts(b, lt, '<![CDATA[')) {
          const e = find(b, ']]>', lt + 9);
          if (e < 0) throw broken(path, 'an unterminated CDATA section');
          if (metaName !== null) metadata[metaName] = (metadata[metaName] ?? '') + str(lt + 9, e);
          i = e + 3;
        } else {
          const e = b.indexOf(62, lt);
          if (e < 0) throw broken(path, 'an unterminated declaration');
          i = e + 1;
        }
        continue;
      }
      if (c1 === 63) {
        const e = find(b, '?>', lt);
        if (e < 0) throw broken(path, 'an unterminated processing instruction');
        i = e + 2;
        continue;
      }
      if (c1 === 47) {
        const gt = b.indexOf(62, lt);
        if (gt < 0) throw broken(path, 'an unterminated closing tag');
        const qname = str(lt + 2, gt).trim();
        const local = qname.slice(qname.indexOf(':') + 1);
        if (local === 'vertex' || local === 'triangle') {
          i = gt + 1;
          continue;
        }
        const open = stack.pop();
        if (open !== local) throw broken(path, `</${qname}> where </${open ?? 'nothing'}> was expected`);
        // Element end handling.
        if (local === 'object') {
          if (current && verts && tris && triPid && triP) {
            current.mesh.vertices = verts.done();
            current.mesh.triangles = tris.done();
            current.triPidModel = triPid.done();
            current.mesh.triProps = triP.done();
            current.mesh.triResource = new Uint32Array(current.mesh.triangles.length / 3);
            const nv = current.mesh.vertices.length / 3;
            const t = current.mesh.triangles;
            for (let k = 0; k < t.length; k++)
              if (t[k] >= nv)
                throw new ThreeMFImportError(`Object ${current.mesh.id} has a triangle that refers to a vertex that does not exist.`);
            if (paint && paint.size) scan.paint.set(objectKey(path, current.mesh.id), paint.finish(current.mesh.triangles.length / 3));
            pendingMeshes.push(current);
          } else if (currentObj && !comp) {
            // An object with neither a mesh nor components.
            register(path, currentObj.id, 'other');
          }
          current = null;
          currentObj = null;
          verts = tris = triPid = triP = null;
          paint = null;
          comp = null;
        } else if (local === 'metadata') metaName = null;
        else if (local === 'basematerials') base = null;
        else if (local === 'colorgroup') colours = null;
        else if (local === 'texture2dgroup') tex = null;
        else if (local === 'compositematerials') compo = null;
        else if (local === 'multiproperties') multi = null;
        i = gt + 1;
        continue;
      }

      // Opening tag: name.
      let j = lt + 1;
      let colon = -1;
      while (j < n) {
        const c = b[j];
        if (isSpace(c) || c === 47 || c === 62) break;
        if (c === 58) colon = j;
        j++;
      }
      const ls = colon >= 0 ? colon + 1 : lt + 1;
      const llen = j - ls;

      // Hot path: <vertex x y z/>
      if (llen === 6 && b[ls] === 118 && starts(b, ls, 'vertex') && verts) {
        let x = 0;
        let y = 0;
        let z = 0;
        let k = j;
        for (;;) {
          while (k < n && isSpace(b[k])) k++;
          const c = b[k];
          if (c === 47 || c === 62) break;
          const a0 = k;
          while (k < n && b[k] !== 61 && !isSpace(b[k])) k++;
          const a1 = k;
          while (k < n && b[k] !== 34 && b[k] !== 39) k++;
          const q = b[k];
          const v0 = k + 1;
          const v1 = b.indexOf(q, v0);
          if (v1 < 0) throw broken(path, 'an unterminated attribute');
          k = v1 + 1;
          if (a1 - a0 === 1) {
            const an = b[a0];
            if (an === 120) x = num(b, v0, v1);
            else if (an === 121) y = num(b, v0, v1);
            else if (an === 122) z = num(b, v0, v1);
          }
        }
        if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)))
          throw new ThreeMFImportError(`The 3MF model could not be read: a vertex in object ${currentObj?.id} has an invalid coordinate.`);
        verts.push3(x * scale, y * scale, z * scale);
        const gt = b.indexOf(62, k);
        i = gt + 1;
        continue;
      }
      // Hot path: <triangle v1 v2 v3 [pid p1 p2 p3] [paint]/>
      if (llen === 8 && b[ls] === 116 && starts(b, ls, 'triangle') && tris && triPid && triP) {
        let va = -1;
        let vb = -1;
        let vc = -1;
        let pid = -1;
        let p1 = -1;
        let p2 = -1;
        let p3 = -1;
        let k = j;
        for (;;) {
          while (k < n && isSpace(b[k])) k++;
          const ch = b[k];
          if (ch === 47 || ch === 62) break;
          const a0 = k;
          while (k < n && b[k] !== 61 && !isSpace(b[k])) k++;
          const a1 = k;
          while (k < n && b[k] !== 34 && b[k] !== 39) k++;
          const q = b[k];
          const v0 = k + 1;
          const v1 = b.indexOf(q, v0);
          if (v1 < 0) throw broken(path, 'an unterminated attribute');
          k = v1 + 1;
          const len = a1 - a0;
          if (len === 2) {
            const f = b[a0];
            const d = b[a0 + 1];
            if (f === 118) {
              if (d === 49) va = uint(b, v0, v1);
              else if (d === 50) vb = uint(b, v0, v1);
              else if (d === 51) vc = uint(b, v0, v1);
            } else if (f === 112) {
              if (d === 49) p1 = uint(b, v0, v1);
              else if (d === 50) p2 = uint(b, v0, v1);
              else if (d === 51) p3 = uint(b, v0, v1);
            }
          } else if (len === 3 && starts(b, a0, 'pid')) pid = uint(b, v0, v1);
          else if ((len === 11 && starts(b, a0, 'paint_color')) || (len > 16 && starts(b, a1 - 16, 'mmu_segmentation'))) {
            if (v1 > v0) {
              (paint ??= new PaintBuilder()).add(tris.n / 3, str(v0, v1));
            }
          }
        }
        if (!(va >= 0 && vb >= 0 && vc >= 0))
          throw new ThreeMFImportError(
            `The 3MF model could not be read: a triangle in object ${currentObj?.id} has missing or invalid vertex indices.`,
          );
        tris.push(va);
        tris.push(vb);
        tris.push(vc);
        const obj = current!;
        if (pid < 0 && p1 >= 0 && obj.objPid !== null) pid = obj.objPid;
        if (pid >= 0) {
          if (p1 < 0) p1 = pid === obj.objPid ? obj.objPindex : 0;
          if (p2 < 0) p2 = p1;
          if (p3 < 0) p3 = p1;
          triPid.push(pid + 1);
          triP.push(p1 + 1);
          triP.push(p2 + 1);
          triP.push(p3 + 1);
        } else {
          triPid.push(0);
          triP.push(0);
          triP.push(0);
          triP.push(0);
        }
        const gt = b.indexOf(62, k);
        i = gt + 1;
        if (lt > nextProgress) {
          nextProgress = lt + 4_000_000;
          options.onProgress?.((doneBytes + lt) / totalBytes);
        }
        continue;
      }

      // General element: read attributes into an object.
      const attrs: Record<string, string> = {};
      let k = j;
      for (;;) {
        while (k < n && isSpace(b[k])) k++;
        const ch = b[k];
        if (ch === 47 || ch === 62 || k >= n) break;
        const a0 = k;
        while (k < n && b[k] !== 61 && !isSpace(b[k])) k++;
        const name = str(a0, k);
        while (k < n && b[k] !== 34 && b[k] !== 39) k++;
        const q = b[k];
        const v0 = k + 1;
        const v1 = b.indexOf(q, v0);
        if (v1 < 0) throw broken(path, 'an unterminated attribute');
        attrs[name] = decodeEntities(str(v0, v1));
        k = v1 + 1;
      }
      const gt = b.indexOf(62, k);
      if (gt < 0) throw broken(path, 'an unterminated tag');
      const selfClosing = b[gt - 1] === 47;
      const local = str(ls, j);
      i = gt + 1;
      const local2 = (name: string) => attrs[name] ?? attrs[Object.keys(attrs).find((x) => x.endsWith(':' + name)) ?? ''];

      switch (local) {
        case 'model': {
          if (!unitSeen) {
            unitSeen = true;
            const u = (attrs.unit ?? 'millimeter') as ThreeMFUnit;
            if (!(u in UNIT_TO_MM)) throw new ThreeMFImportError(`The 3MF model could not be read: unknown unit "${attrs.unit}".`);
            if (isRoot) rootUnit = u;
            scale = UNIT_TO_MM[u];
            if (isRoot)
              for (const [name, value] of Object.entries(attrs)) {
                if (name === 'xmlns') scan.namespaces[''] = value;
                else if (name.startsWith('xmlns:')) scan.namespaces[name.slice(6)] = value;
                else if (name === 'requiredextensions') scan.requiredExtensions = value.split(/\s+/).filter(Boolean);
              }
          }
          break;
        }
        case 'metadata':
          if (stack.length === 1 && isRoot && attrs.name) {
            metaName = attrs.name;
            if (!selfClosing) {
              const end = b.indexOf(60, i);
              metadata[metaName] = decodeEntities(str(i, end).trim());
            } else metadata[metaName] = attrs.value ?? '';
          }
          break;
        case 'object': {
          const id = Number(attrs.id);
          if (!Number.isInteger(id)) throw new ThreeMFImportError('The 3MF model could not be read: an object has no valid id.');
          const pid = attrs.pid !== undefined ? Number(attrs.pid) : null;
          currentObj = {
            id,
            name: attrs.name ?? '',
            type: attrs.type ?? 'model',
            pid,
            pindex: attrs.pindex !== undefined ? Number(attrs.pindex) : 0,
          };
          break;
        }
        case 'mesh': {
          if (!currentObj) break;
          const uid = register(path, currentObj.id, 'mesh');
          verts = new Grow32F();
          tris = new Grow32U();
          triPid = new Grow32U();
          triP = new Grow32U();
          current = {
            mesh: {
              uid,
              id: currentObj.id,
              path,
              name: currentObj.name,
              type: currentObj.type,
              vertices: new Float32Array(0),
              triangles: new Uint32Array(0),
              triResource: new Uint32Array(0),
              triProps: new Uint32Array(0),
              objectLevel: null,
            },
            triPidModel: new Uint32Array(0),
            objPid: currentObj.pid,
            objPindex: currentObj.pindex,
          };
          break;
        }
        case 'components': {
          if (!currentObj) break;
          const uid = register(path, currentObj.id, 'components');
          comp = { comp: { uid, id: currentObj.id, path, name: currentObj.name, type: currentObj.type, components: [] }, refs: [] };
          components.push(comp.comp);
          pendingComponents.push(comp);
          break;
        }
        case 'component': {
          if (!comp) break;
          const ref = { path: local2('path') || path, id: Number(attrs.objectid) };
          comp.refs.push(ref);
          comp.comp.components.push({ uid: 0, transform: parseTransform(attrs.transform, scale) ?? IDENT });
          break;
        }
        case 'item': {
          if (stack[stack.length - 1] !== 'build' || !isRoot) break;
          const ref = { path: local2('path') || path, id: Number(attrs.objectid) };
          buildItems.push({
            objectUid: 0,
            ref,
            transform: parseTransform(attrs.transform, scale) ?? IDENT,
            partNumber: attrs.partnumber ?? '',
          });
          break;
        }
        case 'basematerials': {
          const uid = register(path, Number(attrs.id), 'base');
          base = [];
          baseGroups.set(uid, base);
          break;
        }
        case 'base': {
          if (!base) break;
          const c = parseColour(attrs.displaycolor) ?? { colour: '#FFFFFF', alpha: 1 };
          base.push({ pid: base.length + 1, name: attrs.name ?? '', ...c });
          break;
        }
        case 'colorgroup': {
          const uid = register(path, Number(attrs.id), 'colour');
          colours = [];
          colourGroups.set(uid, colours);
          break;
        }
        case 'color': {
          if (!colours) break;
          const c = parseColour(attrs.color) ?? { colour: '#FFFFFF', alpha: 1 };
          colours.push({ pid: colours.length + 1, ...c });
          break;
        }
        case 'texture2d':
          register(path, Number(attrs.id), 'image');
          texturePaths.set(objectKey(path, Number(attrs.id)), attrs.path ?? '');
          break;
        case 'texture2dgroup': {
          const uid = register(path, Number(attrs.id), 'texture');
          tex = { texturePath: '', count: 0 };
          textureGroups.set(uid, tex);
          textureRefs.push({ uid, key: objectKey(path, Number(attrs.texid)) });
          break;
        }
        case 'tex2coord':
          if (tex) tex.count++;
          break;
        case 'compositematerials': {
          const id = Number(attrs.id);
          const uid = register(path, id, 'composite');
          compo = { matid: Number(attrs.matid), matindices: nums(attrs.matindices), values: [] };
          scan.composites.set(objectKey(path, id), compo);
          composites.set(uid, { baseUid: 0, count: 0 });
          compositeBaseRefs.push({ uid, key: objectKey(path, Number(attrs.matid)) });
          break;
        }
        case 'composite':
          if (compo) compo.values.push(nums(attrs.values));
          break;
        case 'multiproperties': {
          const id = Number(attrs.id);
          const uid = register(path, id, 'multi');
          multi = { pids: nums(attrs.pids), pindices: [] };
          scan.multis.set(objectKey(path, id), multi);
          multis.set(uid, { layerUids: [], count: 0 });
          multiRefs.push({ uid, keys: multi.pids.map((p) => objectKey(path, p)) });
          break;
        }
        case 'multi':
          if (multi) multi.pindices.push(nums(attrs.pindices));
          break;
        default:
          if (UNSUPPORTED.has(local)) scan.unsupported.set(local, (scan.unsupported.get(local) ?? 0) + 1);
      }
      if (!selfClosing) stack.push(local);
    }
    if (stack.length) throw broken(path, `<${stack[stack.length - 1]}> is never closed`);

    // Resolve this part's triangle property references (resources are scoped to their part).
    for (const pm of pendingMeshes) {
      const { mesh, triPidModel } = pm;
      for (let t = 0; t < triPidModel.length; t++) {
        const m = triPidModel[t];
        if (m === 0) continue;
        mesh.triResource[t] = uidOf.get(objectKey(path, m - 1)) ?? 0xffffffff;
      }
      if (pm.objPid !== null) mesh.objectLevel = { uid: uidOf.get(objectKey(path, pm.objPid)) ?? 0xffffffff, pid: pm.objPindex + 1 };
      meshes.push(mesh);
    }
    doneBytes += part.bytes.length;
    options.onProgress?.(doneBytes / totalBytes);
  }

  // Cross-part references.
  for (const { uid, key } of textureRefs) textureGroups.get(uid)!.texturePath = texturePaths.get(key) ?? '';
  for (const { uid, key } of compositeBaseRefs) {
    const c = composites.get(uid)!;
    c.baseUid = uidOf.get(key) ?? 0;
    c.count = scan.composites.get(objectKey(resources.get(uid)!.path, resources.get(uid)!.id))?.values.length ?? 0;
  }
  for (const { uid, keys } of multiRefs) {
    const m = multis.get(uid)!;
    m.layerUids = keys.map((k) => uidOf.get(k) ?? 0);
    m.count = scan.multis.get(objectKey(resources.get(uid)!.path, resources.get(uid)!.id))?.pindices.length ?? 0;
  }
  // Unresolved references keep an impossible uid; flattenInstances reports them.
  for (const pc of pendingComponents)
    pc.refs.forEach((r, k) => (pc.comp.components[k].uid = uidOf.get(objectKey(r.path, r.id)) ?? 0xffffffff));
  const items: RawBuildItem[] = buildItems.map((b) => ({
    objectUid: uidOf.get(objectKey(b.ref.path, b.ref.id)) ?? 0xffffffff,
    transform: b.transform,
    partNumber: b.partNumber,
  }));

  return {
    raw: {
      unit: rootUnit,
      metadata,
      resources,
      meshes,
      components,
      buildItems: items,
      baseGroups,
      colourGroups,
      textureGroups,
      composites,
      multis,
      attachments: [],
      warnings,
    },
    scan,
  };
}

function nums(v: string | undefined): number[] {
  return (v ?? '').trim().split(/\s+/).filter(Boolean).map(Number);
}

function broken(path: string, what: string): ThreeMFImportError {
  return new ThreeMFImportError(`The 3MF model could not be read: ${path.replace(/^\//, '')} is not valid XML (${what}).`);
}
