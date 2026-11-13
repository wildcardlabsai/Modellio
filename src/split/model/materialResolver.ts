import type { RawMesh, RawModel } from '../import/parse3mf';
import { decodePaint, PaintDecodeError } from '../import/paint';
import { objectKey, type ScanResult } from '../import/scan';
import type { PartRole, VendorData, VendorObject } from '../import/vendor';
import type { FlatInstance } from './flatten';
import type { ImportIssue, MaterialKind, ThreeMFMaterial } from './types';

/**
 * MaterialResolver: decides the physical material of every triangle.
 *
 * Precedence (highest first), per triangle:
 *  1. Slicer paint (`paint_color` / `mmu_segmentation`) with a non-zero state → that filament.
 *  2. Slicer part (Bambu) or volume (Prusa) role: non-printing volumes → "not printed".
 *  3. Slicer part / volume extruder, then object extruder → that filament.
 *     (A slicer file prints with these assignments, so they win over 3MF material properties.)
 *  4. 3MF triangle property (pid / p1..p3) → base material, colour, texture, composite or multi-property.
 *  5. 3MF object-level property (pid / pindex).
 *  6. Unassigned.
 *
 * Distinct source definitions stay distinct materials (two base materials with the same
 * colour are not merged); colour-group colours are keyed by value, since a colour *is* the
 * material there. Anything approximated (gradients, textures, composites, multi-properties,
 * sub-triangle paint) is flagged on the material and reported with a count.
 */
export interface ResolvedMaterials {
  materials: ThreeMFMaterial[];
  /** Mesh uid → per-triangle material index. */
  perTriangle: Map<number, Uint32Array>;
  /** Mesh uid → per-triangle material ignoring paint (painted meshes only); paint state 0 uses it. */
  paintBase: Map<number, Uint32Array>;
  /** Paint state / filament slot → material index. */
  filamentMaterials: Record<number, number>;
}

const NEUTRAL = '#B8BCC4';
/** Fallback colours for filament slots whose colour isn't in the file (Bambu's default order). */
const SLOT_PALETTE = ['#F2F2F2', '#161616', '#E0262B', '#1F5BD8', '#F5C518', '#2BA84A', '#F07D1A', '#8C3FC9'];

export function resolveMaterials(
  raw: RawModel,
  scan: ScanResult,
  vendor: VendorData | null,
  instances: FlatInstance[],
  issues: ImportIssue[],
): ResolvedMaterials {
  const materials: ThreeMFMaterial[] = [];
  const byKey = new Map<string, number>();
  const add = (key: string, make: () => Omit<ThreeMFMaterial, 'materialId' | 'key'>): number => {
    const found = byKey.get(key);
    if (found !== undefined) return found;
    const id = materials.length;
    materials.push({ materialId: id, key, ...make() });
    byKey.set(key, id);
    return id;
  };
  const counts = new Map<string, number>();
  const count = (code: string, n = 1) => counts.set(code, (counts.get(code) ?? 0) + n);

  const vendorName = vendor?.vendor === 'prusa' ? 'PrusaSlicer extruder' : 'Bambu Studio / Orca filament';
  const filament = (slot: number) =>
    add(`filament:${slot}`, () => {
      const f = vendor?.filaments.find((x) => x.slot === slot);
      if (!f) count('filament-colour-unknown');
      return {
        name: `Filament ${slot}${f?.type ? ` · ${f.type}` : ''}`,
        colour: f?.colour ?? SLOT_PALETTE[(slot - 1) % SLOT_PALETTE.length],
        alpha: 1,
        materialType: 'filament',
        sourceDefinition: `${vendorName} ${slot}`,
        approximate: !f,
      };
    });
  const ROLE_NAMES: Record<PartRole, string> = {
    part: 'Part',
    modifier: 'Modifier volume (not printed)',
    negative: 'Negative volume (not printed)',
    support_blocker: 'Support blocker (not printed)',
    support_enforcer: 'Support enforcer (not printed)',
  };
  const nonPrinting = (role: PartRole) =>
    add(`nonprinting:${role}`, () => ({
      name: ROLE_NAMES[role],
      colour: '#9AA1AD',
      alpha: 1,
      materialType: 'nonprinting',
      sourceDefinition: 'Slicer volume type',
      approximate: false,
    }));
  const unassigned = () =>
    add('unassigned', () => ({
      name: 'No colour assigned',
      colour: NEUTRAL,
      alpha: 1,
      materialType: 'unassigned',
      sourceDefinition: 'No material in the file',
      approximate: false,
    }));

  const resLabel = (uid: number) => {
    const r = raw.resources.get(uid);
    return r ? `#${r.id}${r.path.toLowerCase() === '/3d/3dmodel.model' ? '' : ` in ${r.path}`}` : `uid ${uid}`;
  };
  const toHexA = (a: number) =>
    Math.round(a * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();

  type Described = { key: string; make: () => Omit<ThreeMFMaterial, 'materialId' | 'key'>; count?: string };
  /** Material index for a 3MF property (resource uid + property id), or null when it can't be resolved. */
  const property = (uid: number, pid: number): number | null => {
    const d = describe(uid, pid);
    if (!d) return null;
    if (d.count) count(d.count);
    return add(d.key, d.make);
  };
  /** Describe a property's material without registering it (multi-properties look inside their layers). */
  const describe = (uid: number, pid: number): Described | null => {
    const r = raw.resources.get(uid);
    if (!r) return null;
    switch (r.kind) {
      case 'base': {
        const e = raw.baseGroups.get(uid)?.[pid - 1];
        if (!e) return null;
        return {
          key: `base:${r.path}#${r.id}:${pid}`,
          make: () => ({
            name: e.name || `Material ${pid}`,
            colour: e.colour,
            alpha: e.alpha,
            materialType: 'base',
            sourceDefinition: `Base materials ${resLabel(uid)}, entry ${pid - 1}`,
            approximate: false,
          }),
        };
      }
      case 'colour': {
        const e = raw.colourGroups.get(uid)?.[pid - 1];
        if (!e) return null;
        return {
          key: `colour:${e.colour}${toHexA(e.alpha)}`,
          make: () => ({
            name: `Colour ${e.colour}`,
            colour: e.colour,
            alpha: e.alpha,
            materialType: 'colour',
            sourceDefinition: `Colour group ${resLabel(uid)}, entry ${pid - 1}`,
            approximate: false,
          }),
        };
      }
      case 'texture': {
        const t = raw.textureGroups.get(uid);
        return {
          key: `texture:${r.path}#${r.id}`,
          count: 'texture',
          make: () => ({
            name: `Texture ${t?.texturePath.split('/').pop() || r.id}`,
            colour: NEUTRAL,
            alpha: 1,
            materialType: 'texture' as MaterialKind,
            sourceDefinition: `Texture group ${resLabel(uid)}${t?.texturePath ? ` (${t.texturePath})` : ''}`,
            approximate: true,
          }),
        };
      }
      case 'composite': {
        const def = scan.composites.get(objectKey(r.path, r.id));
        const comp = raw.composites.get(uid);
        const values = def?.values[pid - 1];
        if (!comp || !def || !values) return null;
        const base = raw.baseGroups.get(comp.baseUid) ?? [];
        let rr = 0;
        let gg = 0;
        let bb = 0;
        let total = 0;
        values.forEach((v, i) => {
          const e = base[def.matindices[i]];
          if (!e || !(v > 0)) return;
          rr += v * parseInt(e.colour.slice(1, 3), 16);
          gg += v * parseInt(e.colour.slice(3, 5), 16);
          bb += v * parseInt(e.colour.slice(5, 7), 16);
          total += v;
        });
        if (total <= 0) return null;
        const hx = (n: number) =>
          Math.round(n / total)
            .toString(16)
            .padStart(2, '0')
            .toUpperCase();
        return {
          key: `composite:${r.path}#${r.id}:${pid}`,
          count: 'composite',
          make: () => ({
            name: `Blend ${pid}`,
            colour: `#${hx(rr)}${hx(gg)}${hx(bb)}`,
            alpha: 1,
            materialType: 'composite',
            sourceDefinition: `Composite materials ${resLabel(uid)}, entry ${pid - 1}`,
            approximate: true,
          }),
        };
      }
      case 'multi': {
        const def = scan.multis.get(objectKey(r.path, r.id));
        const m = raw.multis.get(uid);
        const idx = def?.pindices[pid - 1];
        if (!m || !idx) return null;
        // Use the last colour-bearing layer (the most specific one).
        const colourLayers = m.layerUids
          .map((layerUid, i) => {
            const kind = raw.resources.get(layerUid)?.kind;
            return kind === 'base' || kind === 'colour' ? describe(layerUid, (idx[i] ?? 0) + 1) : null;
          })
          .filter((d): d is Described => d !== null);
        const layer = colourLayers.length ? colourLayers[colourLayers.length - 1].make() : null;
        if (!layer) return null;
        return {
          key: `multi:${r.path}#${r.id}:${pid}`,
          count: 'multi',
          make: () => ({
            name: `${layer.name} (multi-property)`,
            colour: layer.colour,
            alpha: layer.alpha,
            materialType: 'multi',
            sourceDefinition: `Multi-properties ${resLabel(uid)}, entry ${pid - 1}`,
            approximate: true,
          }),
        };
      }
      default:
        return null;
    }
  };

  // Vendor context per mesh (the root objects that place it).
  const rootsOfMesh = new Map<number, Set<number>>();
  for (const inst of instances) {
    let set = rootsOfMesh.get(inst.meshUid);
    if (!set) rootsOfMesh.set(inst.meshUid, (set = new Set()));
    set.add(inst.rootUid);
  }
  const rootPath = (uid: number) => raw.resources.get(uid);
  const vendorContext = (mesh: RawMesh): { obj: VendorObject; partRole: PartRole; extruder?: number } | null => {
    if (!vendor) return null;
    const roots = [...(rootsOfMesh.get(mesh.uid) ?? [])];
    const contexts = roots
      .map((rootUid) => {
        const root = rootPath(rootUid);
        const obj = root ? vendor.objects.get(root.id) : undefined;
        if (!obj) return null;
        if (rootUid === mesh.uid) return { obj, partRole: 'part' as PartRole, extruder: obj.extruder };
        const part = obj.parts.find((p) => p.id === mesh.id);
        return { obj, partRole: part?.role ?? 'part', extruder: part?.extruder ?? obj.extruder };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    if (contexts.length > 1 && new Set(contexts.map((c) => `${c.partRole}:${c.extruder}`)).size > 1) count('vendor-ambiguous');
    return contexts[0] ?? null;
  };

  // Per-triangle lookups are cached: the loop below runs once per triangle (millions on large files).
  const propCache = new Map<number, { mat: number | null; code?: string; kind?: string }>();
  const cachedProperty = (uid: number, pid: number) => {
    const key = uid * 4294967296 + pid;
    let hit = propCache.get(key);
    if (!hit) {
      const d = describe(uid, pid);
      hit = d ? { mat: add(d.key, d.make), code: d.count, kind: raw.resources.get(uid)?.kind } : { mat: null };
      propCache.set(key, hit);
    }
    return hit;
  };
  const filamentCache: number[] = [];
  const filamentOf = (slot: number) => (filamentCache[slot] ??= filament(slot));

  const perTriangle = new Map<number, Uint32Array>();
  const paintBase = new Map<number, Uint32Array>();
  for (const mesh of raw.meshes) {
    const n = mesh.triangles.length / 3;
    const out = new Uint32Array(n);
    const paint = scan.paint.get(objectKey(mesh.path, mesh.id));
    const ctx = vendorContext(mesh);
    const objectLevel = mesh.objectLevel ? property(mesh.objectLevel.uid, mesh.objectLevel.pid) : null;
    if (mesh.objectLevel && objectLevel === null) count('missing-material');
    // Decoded once per distinct paint string.
    const paintInfo = paint?.strings.map((str) => {
      try {
        const d = decodePaint(str);
        return { majority: d.majority, split: d.split, invalid: false };
      } catch (e) {
        if (!(e instanceof PaintDecodeError)) throw e;
        return { majority: 0, split: false, invalid: true };
      }
    });
    const codes = paint?.codes;
    const baseOut = codes ? new Uint32Array(n) : null;
    // Fine paint can use filaments that are never a triangle's main colour: register them all.
    paint?.strings.forEach((str, k) => {
      if (!paintInfo![k].split) return;
      for (const st of decodePaint(str).areas.keys()) if (st > 0) filamentOf(st);
    });
    const volumes = ctx?.obj.volumes ?? [];
    let unassignedId = -1;
    let nPaint = 0;
    let nSplit = 0;
    let nInvalid = 0;
    let nOverSpec = 0;
    let nMissing = 0;
    let nGradient = 0;
    let nUnassigned = 0;
    const kindCounts = new Map<string, number>();
    for (let t = 0; t < n; t++) {
      let nonPrintingMat = -1;
      let extruderMat = -1;
      let state = 0;
      // 1–3: slicer assignments.
      if (ctx || paint) {
        let role: PartRole = ctx?.partRole ?? 'part';
        let extruder = ctx?.extruder;
        if (volumes.length) {
          const vol = volumes.find((v) => t >= v.firstTriangle && t <= v.lastTriangle);
          if (vol) {
            role = vol.role;
            extruder = vol.extruder ?? ctx?.obj.extruder;
          }
        }
        if (role !== 'part') nonPrintingMat = nonPrinting(role);
        else {
          const code = codes ? codes[t] : 0;
          if (code) {
            const info = paintInfo![code - 1];
            if (info.invalid) nInvalid++;
            if (info.split) nSplit++;
            state = info.majority;
            if (state > 0) nPaint++;
          }
          if (ctx) extruderMat = filamentOf(extruder && extruder > 0 ? extruder : 1);
        }
      }
      if (nonPrintingMat >= 0) {
        out[t] = nonPrintingMat;
        if (baseOut) baseOut[t] = nonPrintingMat;
        continue;
      }
      // The triangle's material without paint: slicer extruder, else 3MF properties (4–5), else unassigned.
      let base = extruderMat;
      const uid = mesh.triResource[t];
      if (base >= 0) {
        if (uid !== 0) nOverSpec++;
      } else if (uid !== 0) {
        const p1 = mesh.triProps[t * 3];
        const hit = cachedProperty(uid, p1);
        if (hit.mat === null) {
          if (state === 0) nMissing++;
        } else {
          base = hit.mat;
          if (state === 0) {
            if (hit.code) kindCounts.set(hit.code, (kindCounts.get(hit.code) ?? 0) + 1);
            if ((p1 !== mesh.triProps[t * 3 + 1] || p1 !== mesh.triProps[t * 3 + 2]) && hit.kind !== 'texture') nGradient++;
          }
        }
      } else if (objectLevel !== null) base = objectLevel;
      if (base < 0) {
        if (unassignedId < 0) unassignedId = unassigned();
        base = unassignedId;
        if (state === 0) nUnassigned++;
      }
      if (baseOut) baseOut[t] = base;
      out[t] = state > 0 ? filamentOf(state) : base;
    }
    if (nPaint) count('paint', nPaint);
    if (nSplit) count('paint-split', nSplit);
    if (nInvalid) count('paint-invalid', nInvalid);
    if (nOverSpec) count('vendor-over-spec', nOverSpec);
    if (nMissing) count('missing-material', nMissing);
    if (nGradient) count('gradient', nGradient);
    if (nUnassigned) count('unassigned', nUnassigned);
    for (const [code, k] of kindCounts) count(code, k);
    perTriangle.set(mesh.uid, out);
    if (baseOut) paintBase.set(mesh.uid, baseOut);
  }

  const msg: Record<string, [ImportIssue['level'], (n: number) => string]> = {
    paint: ['info', (n) => `${n} triangle(s) use slicer paint colours; they are assigned to the painted filament.`],
    'paint-split': [
      'warning',
      (n) =>
        `${n} painted triangle(s) contain more than one colour inside the triangle (fine paint). The preview shows each triangle's main colour; exact sub-triangle splitting is not available yet.`,
    ],
    'paint-invalid': ['warning', (n) => `${n} triangle(s) have paint data that could not be decoded; they use their part's filament.`],
    texture: [
      'warning',
      (n) => `${n} triangle(s) are coloured by a texture image. Textures can't be split by colour; they are shown in neutral grey.`,
    ],
    composite: ['warning', (n) => `${n} triangle(s) use composite (blended) materials; the preview shows the blended colour.`],
    multi: ['warning', (n) => `${n} triangle(s) use multi-property materials; the colour layer is used.`],
    gradient: [
      'warning',
      (n) => `${n} triangle(s) have a different colour at each corner (gradient); each uses its first corner's colour.`,
    ],
    'missing-material': [
      'error',
      (n) => `${n} triangle(s) or object(s) refer to a material that is not in the file; they are treated as unassigned.`,
    ],
    unassigned: ['info', (n) => `${n} triangle(s) have no colour information.`],
    'filament-colour-unknown': ['warning', (n) => `${n} filament slot(s) have no colour in the file; placeholder colours are shown.`],
    'vendor-over-spec': [
      'info',
      (n) =>
        `${n} triangle(s) have both 3MF material properties and slicer assignments; the slicer assignment is used because that is what prints.`,
    ],
    'vendor-ambiguous': [
      'warning',
      (n) => `${n} mesh(es) are used by several slicer objects with different filaments; the first assignment is used.`,
    ],
  };
  for (const [code, n] of counts) {
    const m = msg[code];
    if (m) issues.push({ level: m[0], code, message: m[1](n), count: n });
  }
  return {
    materials,
    perTriangle,
    paintBase,
    filamentMaterials: Object.fromEntries(filamentCache.map((m, slot) => [slot, m]).filter((x) => x[1] !== undefined)),
  };
}
