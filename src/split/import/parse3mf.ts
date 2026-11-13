import type { L3Model, L3Module } from './lib3mf';
import { ThreeMFImportError } from './xml';
import { UNIT_TO_MM, type Mat4, type ThreeMFUnit } from '../model/types';

/**
 * lib3mf → raw model. Values are read exactly as lib3mf reports them; units are
 * converted to millimetres here (vertices and transform translations), nothing else
 * is interpreted. Resource references use lib3mf's *unique* resource IDs (one ID
 * space across all model parts), which `RawModel.resources` maps back to the
 * (part path, model ID) pairs written in the file.
 */
export type RawResourceKind = 'base' | 'colour' | 'texture' | 'composite' | 'multi' | 'mesh' | 'components' | 'image' | 'other';

export interface RawResource {
  uid: number;
  id: number;
  path: string;
  kind: RawResourceKind;
}

export interface RawMesh {
  uid: number;
  id: number;
  path: string;
  name: string;
  type: string;
  vertices: Float32Array;
  triangles: Uint32Array;
  /** Per triangle: lib3mf unique resource ID of its property group (0 = none). */
  triResource: Uint32Array;
  /** Per triangle: property IDs at the three corners. */
  triProps: Uint32Array;
  objectLevel: { uid: number; pid: number } | null;
}

export interface RawComponents {
  uid: number;
  id: number;
  path: string;
  name: string;
  type: string;
  components: { uid: number; transform: Mat4 }[];
}

export interface RawBuildItem {
  objectUid: number;
  transform: Mat4;
  partNumber: string;
}

export interface RawColourEntry {
  pid: number;
  name?: string;
  colour: string;
  alpha: number;
}

export interface RawModel {
  unit: ThreeMFUnit;
  metadata: Record<string, string>;
  resources: Map<number, RawResource>;
  meshes: RawMesh[];
  components: RawComponents[];
  buildItems: RawBuildItem[];
  baseGroups: Map<number, RawColourEntry[]>;
  colourGroups: Map<number, RawColourEntry[]>;
  textureGroups: Map<number, { texturePath: string; count: number }>;
  composites: Map<number, { baseUid: number; count: number }>;
  multis: Map<number, { layerUids: number[]; count: number }>;
  attachments: { path: string; relationship: string }[];
  warnings: string[];
}

const hex2 = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped WASM binding objects. */
const del = (o: any) => {
  try {
    o?.delete?.();
  } catch {
    /* already released */
  }
};

/** Convert lib3mf's sTransform (Fields[4][3], row-vector convention) to a column-major 4×4 in mm. */
function readTransform(t: any, scale: number): Mat4 {
  const f = (r: number, c: number) => Number(t[`get_Fields_${r}_${c}`]());
  const m = [
    f(0, 0),
    f(0, 1),
    f(0, 2),
    0,
    f(1, 0),
    f(1, 1),
    f(1, 2),
    0,
    f(2, 0),
    f(2, 1),
    f(2, 2),
    0,
    f(3, 0) * scale,
    f(3, 1) * scale,
    f(3, 2) * scale,
    1,
  ];
  del(t);
  return m;
}

function colourOf(c: any): { colour: string; alpha: number } {
  const out = { colour: '#' + hex2(c.get_Red()) + hex2(c.get_Green()) + hex2(c.get_Blue()), alpha: c.get_Alpha() / 255 };
  del(c);
  return out;
}

export interface ParseOptions {
  onProgress?: (fraction: number, label: string) => void;
}

let fileCounter = 0;

export function parseWithLib3mf(M: L3Module, bytes: Uint8Array, options: ParseOptions = {}): RawModel {
  const progress = options.onProgress ?? (() => {});
  const wrapper = new M.CWrapper();
  const model: L3Model = wrapper.CreateModel();
  const reader = model.QueryReader('3mf');
  reader.SetStrictModeActive(false);
  const file = `/split-import-${++fileCounter}.3mf`;
  M.FS.writeFile(file, bytes);
  try {
    reader.ReadFromFile(file);
  } catch (e) {
    throw new ThreeMFImportError(`The 3MF model could not be read: ${describeLibError(e)}`);
  } finally {
    try {
      M.FS.unlink(file);
    } catch {
      /* ignore */
    }
  }
  const warnings: string[] = [];
  const warningCount = reader.GetWarningCount();
  for (let i = 0; i < warningCount; i++) {
    try {
      const w = reader.GetWarning(i);
      warnings.push(typeof w === 'string' ? w : String(w?.Warning ?? w?.return ?? w));
    } catch {
      warnings.push('lib3mf reported a warning that could not be read.');
    }
  }

  const unitEnum = model.GetUnit();
  const units: [ThreeMFUnit, keyof L3Module['eModelUnit']][] = [
    ['micron', 'MicroMeter'],
    ['millimeter', 'MilliMeter'],
    ['centimeter', 'CentiMeter'],
    ['inch', 'Inch'],
    ['foot', 'Foot'],
    ['meter', 'Meter'],
  ];
  const unit = units.find(([, k]) => M.eModelUnit[k] === unitEnum)?.[0] ?? 'millimeter';
  const scale = UNIT_TO_MM[unit];

  const metadata: Record<string, string> = {};
  const mg = model.GetMetaDataGroup();
  for (let i = 0; i < mg.GetMetaDataCount(); i++) {
    const md = mg.GetMetaData(i);
    metadata[md.GetName()] = md.GetValue();
  }

  // Resource directory (unique ID → part path + model ID + kind).
  const resources = new Map<number, RawResource>();
  const pt = M.ePropertyType;
  const it = model.GetResources();
  while (it.MoveNext()) {
    const r = it.GetCurrent();
    const uid = r.GetUniqueResourceID();
    let path = '/3D/3dmodel.model';
    try {
      path = r.PackagePart().GetPath();
    } catch {
      /* root part */
    }
    let kind: RawResourceKind = 'other';
    const t = model.GetPropertyTypeByID(uid);
    if (t === pt.BaseMaterial) kind = 'base';
    else if (t === pt.Colors) kind = 'colour';
    else if (t === pt.TexCoord) kind = 'texture';
    else if (t === pt.Composite) kind = 'composite';
    else if (t === pt.Multi) kind = 'multi';
    resources.set(uid, { uid, id: r.GetModelResourceID(), path, kind });
  }
  const objectType = (o: any) => {
    const t = o.GetType();
    const e = M.eObjectType;
    return t === e.Model
      ? 'model'
      : t === e.Support
        ? 'support'
        : t === e.SolidSupport
          ? 'solidsupport'
          : t === e.Surface
            ? 'surface'
            : 'other';
  };

  // Property groups. Groups read from a file number their properties 1..count in file order.
  const baseGroups = new Map<number, RawColourEntry[]>();
  const colourGroups = new Map<number, RawColourEntry[]>();
  const textureGroups = new Map<number, { texturePath: string; count: number }>();
  const composites = new Map<number, { baseUid: number; count: number }>();
  const multis = new Map<number, { layerUids: number[]; count: number }>();
  for (const r of resources.values()) {
    if (r.kind === 'base') {
      const g = model.GetBaseMaterialGroupByID(r.uid);
      const out: RawColourEntry[] = [];
      for (let pid = 1; pid <= g.GetCount(); pid++) out.push({ pid, name: g.GetName(pid), ...colourOf(g.GetDisplayColor(pid)) });
      baseGroups.set(r.uid, out);
    } else if (r.kind === 'colour') {
      const g = model.GetColorGroupByID(r.uid);
      const out: RawColourEntry[] = [];
      for (let pid = 1; pid <= g.GetCount(); pid++) out.push({ pid, ...colourOf(g.GetColor(pid)) });
      colourGroups.set(r.uid, out);
    } else if (r.kind === 'texture') {
      const g = model.GetTexture2DGroupByID(r.uid);
      let texturePath = '';
      try {
        texturePath = g.GetTexture2D().GetAttachment().GetPath();
      } catch {
        /* missing texture image */
      }
      textureGroups.set(r.uid, { texturePath, count: g.GetCount() });
      r.kind = 'texture';
    } else if (r.kind === 'composite') {
      const g = model.GetCompositeMaterialsByID(r.uid);
      composites.set(r.uid, { baseUid: g.GetBaseMaterialGroup().GetUniqueResourceID(), count: g.GetCount() });
    } else if (r.kind === 'multi') {
      const g = model.GetMultiPropertyGroupByID(r.uid);
      const layerUids: number[] = [];
      for (let i = 0; i < g.GetLayerCount(); i++) {
        const l = g.GetLayer(i);
        layerUids.push(l.get_ResourceID());
        del(l);
      }
      multis.set(r.uid, { layerUids, count: g.GetCount() });
    }
  }
  const hasProperties = baseGroups.size + colourGroups.size + textureGroups.size + composites.size + multis.size > 0;

  // Mesh objects (the expensive part: element-by-element reads).
  const meshList: any[] = [];
  const mi = model.GetMeshObjects();
  while (mi.MoveNext()) meshList.push(mi.GetCurrentMeshObject());
  let totalTris = 0;
  for (const mo of meshList) totalTris += mo.GetTriangleCount();
  let doneTris = 0;
  const meshes: RawMesh[] = [];
  for (const mo of meshList) {
    const uid = mo.GetUniqueResourceID();
    const res = resources.get(uid);
    if (res) res.kind = 'mesh';
    const nv = mo.GetVertexCount();
    const nt = mo.GetTriangleCount();
    const vertices = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      const v = mo.GetVertex(i);
      vertices[i * 3] = v.get_Coordinates0() * scale;
      vertices[i * 3 + 1] = v.get_Coordinates1() * scale;
      vertices[i * 3 + 2] = v.get_Coordinates2() * scale;
      del(v);
    }
    const triangles = new Uint32Array(nt * 3);
    const triResource = new Uint32Array(nt);
    const triProps = new Uint32Array(nt * 3);
    let objectLevel: RawMesh['objectLevel'] = null;
    const ol = mo.GetObjectLevelProperty();
    if (ol && ol.return) objectLevel = { uid: ol.UniqueResourceID, pid: ol.PropertyID };
    for (let i = 0; i < nt; i++) {
      const t = mo.GetTriangle(i);
      const a = t.get_Indices0();
      const b = t.get_Indices1();
      const c = t.get_Indices2();
      del(t);
      if (a >= nv || b >= nv || c >= nv)
        throw new ThreeMFImportError(`Object ${res?.id ?? uid} has a triangle that refers to a vertex that does not exist.`);
      triangles[i * 3] = a;
      triangles[i * 3 + 1] = b;
      triangles[i * 3 + 2] = c;
      if (hasProperties) {
        const wrap = mo.GetTriangleProperties(i);
        const p = wrap.Property ?? wrap;
        triResource[i] = p.get_ResourceID();
        triProps[i * 3] = p.get_PropertyIDs0();
        triProps[i * 3 + 1] = p.get_PropertyIDs1();
        triProps[i * 3 + 2] = p.get_PropertyIDs2();
        del(p);
      }
      if ((++doneTris & 0x3fff) === 0) progress(doneTris / Math.max(1, totalTris), 'Reading triangles');
    }
    meshes.push({
      uid,
      id: res?.id ?? mo.GetModelResourceID(),
      path: res?.path ?? '/3D/3dmodel.model',
      name: mo.GetName() ?? '',
      type: objectType(mo),
      vertices,
      triangles,
      triResource,
      triProps,
      objectLevel,
    });
  }

  const components: RawComponents[] = [];
  const ci = model.GetComponentsObjects();
  while (ci.MoveNext()) {
    const co = ci.GetCurrentComponentsObject();
    const uid = co.GetUniqueResourceID();
    const res = resources.get(uid);
    if (res) res.kind = 'components';
    const list: RawComponents['components'] = [];
    for (let i = 0; i < co.GetComponentCount(); i++) {
      const c = co.GetComponent(i);
      list.push({
        uid: c.GetObjectResource().GetUniqueResourceID(),
        transform: c.HasTransform() ? readTransform(c.GetTransform(), scale) : identity(),
      });
    }
    components.push({
      uid,
      id: res?.id ?? co.GetModelResourceID(),
      path: res?.path ?? '/3D/3dmodel.model',
      name: co.GetName() ?? '',
      type: objectType(co),
      components: list,
    });
  }

  const buildItems: RawBuildItem[] = [];
  const bi = model.GetBuildItems();
  while (bi.MoveNext()) {
    const item = bi.GetCurrent();
    buildItems.push({
      objectUid: item.GetObjectResource().GetUniqueResourceID(),
      transform: item.HasObjectTransform() ? readTransform(item.GetObjectTransform(), scale) : identity(),
      partNumber: item.GetPartNumber() ?? '',
    });
  }

  const attachments: RawModel['attachments'] = [];
  for (let i = 0; i < model.GetAttachmentCount(); i++) {
    const a = model.GetAttachment(i);
    attachments.push({ path: a.GetPath(), relationship: a.GetRelationShipType() });
  }
  del(model);
  progress(1, 'Reading triangles');
  return {
    unit,
    metadata,
    resources,
    meshes,
    components,
    buildItems,
    baseGroups,
    colourGroups,
    textureGroups,
    composites,
    multis,
    attachments,
    warnings,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function describeLibError(e: unknown): string {
  const s = String((e as Error)?.message ?? e);
  // lib3mf exceptions look like "ELib3MFInterfaceException: <message>" or carry an error code.
  const m = /Exception:?\s*(.*)$/s.exec(s);
  const msg = (m ? m[1] : s).trim() || 'unknown error';
  return /^\d+$/.test(msg) ? `lib3mf error ${msg}` : msg;
}
