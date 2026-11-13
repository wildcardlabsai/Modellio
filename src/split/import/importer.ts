import { readPackage, getPart, REL_TEXTURE } from './opc';
import type { L3Module } from './lib3mf';
import { parseWithLib3mf, type RawModel } from './parse3mf';
import { objectKey, scanModelParts, type ScanResult } from './scan';
import { parseModelParts } from './fastParse';
import { readVendorData } from './vendor';
import { flattenInstances } from '../model/flatten';
import { resolveMaterials } from '../model/materialResolver';
import type { ImportIssue, ThreeMFDocument, ThreeMFMesh, ThreeMFObject } from '../model/types';
import { ThreeMFImportError } from './xml';

export type ImportProgress = (fraction: number, stage: string) => void;

export const EXTENSION_NAMES: Record<string, string> = {
  'http://schemas.microsoft.com/3dmanufacturing/core/2015/02': 'Core',
  'http://schemas.microsoft.com/3dmanufacturing/material/2015/02': 'Materials and Properties',
  'http://schemas.microsoft.com/3dmanufacturing/production/2015/06': 'Production',
  'http://schemas.microsoft.com/3dmanufacturing/beamlattice/2017/02': 'Beam Lattice',
  'http://schemas.microsoft.com/3dmanufacturing/slice/2015/07': 'Slice',
  'http://schemas.microsoft.com/3dmanufacturing/securecontent/2019/04': 'Secure Content',
  'http://schemas.3mf.io/3dmanufacturing/volumetric/2022/01': 'Volumetric',
  'http://schemas.3mf.io/3dmanufacturing/displacement/2022/07': 'Displacement',
  'http://schemas.bambulab.com/package/2021': 'Bambu Studio',
  'http://schemas.slic3r.org/3mf/2017/06': 'PrusaSlicer',
};

const UNSUPPORTED_LABELS: Record<string, string> = {
  beamlattice: 'beam lattices',
  slicestack: 'slice stacks',
  sliceref: 'slice references',
  levelset: 'level sets',
  volumedata: 'volumetric data',
  displacementmesh: 'displacement meshes',
  implicitfunction: 'implicit functions',
};

export interface ImportOptions {
  /**
   * The model reader. "fast" (default) is MODELLIO's streaming reader. "lib3mf" uses the
   * official 3MF Consortium library (WebAssembly); tests run both and compare the results.
   */
  reader?: 'fast' | 'lib3mf';
  lib?: L3Module;
}

/**
 * Import pipeline: package → model reader → vendor metadata → instances → material
 * resolution → document. Pure (no DOM), so it runs in a worker and in tests. Throws
 * ThreeMFImportError for problems with the file.
 */
export async function importThreeMF(
  bytes: Uint8Array,
  fileName: string,
  onProgress: ImportProgress = () => {},
  options: ImportOptions = {},
): Promise<ThreeMFDocument> {
  const issues: ImportIssue[] = [];
  onProgress(0.02, 'Opening package');
  const pkg = await readPackage(bytes);
  onProgress(0.08, 'Reading model');
  const modelParts = pkg.modelParts.map((path) => ({ path, bytes: getPart(pkg.parts, path)! })).filter((p) => p.bytes);
  let raw: RawModel;
  let scan: ScanResult;
  if (options.reader === 'lib3mf') {
    if (!options.lib) throw new Error('The lib3mf reader needs a loaded module.');
    raw = parseWithLib3mf(options.lib, bytes, { onProgress: (f) => onProgress(0.08 + f * 0.7, 'Reading triangles') });
    scan = scanModelParts(modelParts, pkg.rootModel);
  } else {
    ({ raw, scan } = parseModelParts(modelParts, pkg.rootModel, { onProgress: (f) => onProgress(0.08 + f * 0.7, 'Reading triangles') }));
  }
  onProgress(0.8, 'Reading colour data');
  const { data: vendor, notes } = readVendorData(pkg.parts);
  for (const n of notes) issues.push({ level: 'warning', code: 'vendor-note', message: n });
  if (vendor) {
    const label = vendor.vendor === 'bambu' ? 'Bambu Studio / OrcaSlicer' : 'PrusaSlicer';
    issues.push({
      level: 'info',
      code: 'vendor',
      message: `${label} project data found: object and part colour assignments are read from the slicer settings.`,
    });
  }

  const warnings = new Map<string, number>();
  for (const w of raw.warnings) warnings.set(w, (warnings.get(w) ?? 0) + 1);
  for (const [w, n] of warnings) {
    // Slicer paint attributes are unknown to the 3MF reader; this importer reads them itself.
    if (/Invalid Attribute in namespace/i.test(w) && scan.paint.size > 0) {
      issues.push({
        level: 'info',
        code: 'vendor-attributes',
        message: `The 3MF reader skipped ${n} slicer-specific attribute(s); slicer paint data was read separately.`,
        count: n,
      });
      continue;
    }
    // Missing production-extension UUIDs don't affect geometry or colour.
    const harmless = /UUID .*missing/i.test(w);
    issues.push({
      level: harmless ? 'info' : 'warning',
      code: 'lib3mf-warning',
      message: `3MF reader: ${w}${n > 1 ? ` (×${n})` : ''}`,
      count: n,
    });
  }
  for (const [el, n] of scan.unsupported)
    issues.push({
      level: 'warning',
      code: 'unsupported-content',
      message: `The file contains ${n} ${UNSUPPORTED_LABELS[el] ?? el}, which Split Studio does not use. Only triangle meshes are imported.`,
      count: n,
    });
  const known = new Set(Object.values(scan.namespaces).filter((u) => EXTENSION_NAMES[u]));
  const extensions = [...new Set(Object.values(scan.namespaces))].map((u) => EXTENSION_NAMES[u] ?? u).filter((n) => n !== 'Core');
  for (const prefix of scan.requiredExtensions) {
    const uri = scan.namespaces[prefix];
    if (uri && !known.has(uri))
      issues.push({
        level: 'warning',
        code: 'unknown-extension',
        message: `The file requires an extension this importer doesn't know (${uri}). Its geometry was read, but data from that extension is ignored.`,
      });
  }
  const textures = pkg.relationships.filter((r) => r.type === REL_TEXTURE).length;
  if (textures && raw.textureGroups.size === 0)
    issues.push({
      level: 'info',
      code: 'texture-attachment',
      message: `The package contains ${textures} texture image(s) that no triangle uses.`,
    });

  onProgress(0.85, 'Resolving materials');
  const flat = flattenInstances(raw, issues);
  const { materials, perTriangle } = resolveMaterials(raw, scan, vendor, flat, issues);

  onProgress(0.92, 'Building document');
  const doc = buildDocument(raw, flat, materials, perTriangle, issues, vendor?.objects, scan);
  doc.fileName = fileName;
  doc.fileSize = bytes.length;
  doc.extensions = extensions;
  doc.relationships = pkg.relationships;
  doc.application = raw.metadata.Application ?? (vendor ? (vendor.vendor === 'bambu' ? 'Bambu Studio' : 'PrusaSlicer') : null);
  if (doc.stats.placedTriangles === 0) {
    throw new ThreeMFImportError(
      raw.meshes.length === 0
        ? 'The file contains no triangle meshes to split.'
        : 'The file has meshes, but none of them are placed on the build plate (no build items reference them).',
    );
  }
  onProgress(1, 'Done');
  return doc;
}

function buildDocument(
  raw: RawModel,
  flat: ReturnType<typeof flattenInstances>,
  materials: ThreeMFDocument['materials'],
  perTriangle: Map<number, Uint32Array>,
  issues: ImportIssue[],
  vendorObjects?: Map<number, { name?: string; extruder?: number }>,
  scan?: ScanResult,
): ThreeMFDocument {
  const objects: ThreeMFObject[] = [];
  const indexOfUid = new Map<number, number>();
  const uidToRef = (uid: number) => raw.resources.get(uid) ?? { id: uid, path: '/3D/3dmodel.model' };
  for (const m of raw.meshes) {
    const mesh: ThreeMFMesh = {
      vertices: m.vertices,
      triangles: m.triangles,
      perTriangleMaterialIds: perTriangle.get(m.uid) ?? new Uint32Array(m.triangles.length / 3),
      bounds: bounds(m.vertices),
      paint: scan?.paint.get(objectKey(m.path, m.id)),
    };
    indexOfUid.set(m.uid, objects.length);
    objects.push({
      objectId: m.id,
      path: m.path,
      name: m.name,
      type: m.type,
      mesh,
      componentReferences: [],
      objectLevelProperty: m.objectLevel ? { resourceId: m.objectLevel.uid, propertyId: m.objectLevel.pid } : null,
      vendor: vendorObjects?.get(m.id),
    });
  }
  for (const c of raw.components) {
    indexOfUid.set(c.uid, objects.length);
    objects.push({
      objectId: c.id,
      path: c.path,
      name: c.name,
      type: c.type,
      mesh: null,
      componentReferences: c.components.map((x) => ({ objectId: uidToRef(x.uid).id, path: uidToRef(x.uid).path, transform: x.transform })),
      objectLevelProperty: null,
      vendor: vendorObjects?.get(c.id),
    });
  }
  const instances: ThreeMFDocument['instances'] = flat.map((f) => {
    const objectIndex = indexOfUid.get(f.meshUid)!;
    const root = objects[indexOfUid.get(f.rootUid) ?? objectIndex];
    const leaf = objects[objectIndex];
    const rootName = root.vendor?.name || root.name || `Object ${root.objectId}`;
    const leafName = leaf.name || `Part ${leaf.objectId}`;
    return {
      instanceId: f.instanceId,
      buildItemIndex: f.buildItemIndex,
      componentPath: f.componentPath,
      objectIndex,
      transform: f.transform,
      name: f.componentPath.length ? `${rootName} › ${leafName}` : rootName,
    };
  });
  const emptyMeshes = raw.meshes.filter((m) => m.triangles.length === 0).length;
  if (emptyMeshes)
    issues.push({ level: 'info', code: 'empty-mesh', message: `${emptyMeshes} mesh object(s) have no triangles.`, count: emptyMeshes });
  const unplaced = raw.meshes.filter((m) => !flat.some((f) => f.meshUid === m.uid) && m.triangles.length > 0).length;
  if (unplaced)
    issues.push({
      level: 'info',
      code: 'unplaced',
      message: `${unplaced} mesh object(s) are defined but not placed on the build plate; they are not shown.`,
      count: unplaced,
    });
  let triangles = 0;
  let vertices = 0;
  for (const m of raw.meshes) {
    triangles += m.triangles.length / 3;
    vertices += m.vertices.length / 3;
  }
  const placedTriangles = instances.reduce((s, i) => s + (objects[i.objectIndex].mesh?.triangles.length ?? 0) / 3, 0);
  return {
    fileName: '',
    fileSize: 0,
    metadata: raw.metadata,
    units: raw.unit,
    application: null,
    extensions: [],
    materials,
    objects,
    buildItems: raw.buildItems.map((b, index) => {
      const ref = uidToRef(b.objectUid);
      return { index, objectId: ref.id, path: ref.path, transform: b.transform, partNumber: b.partNumber };
    }),
    instances,
    relationships: [],
    issues,
    stats: { triangles, vertices, meshObjects: raw.meshes.length, instances: instances.length, placedTriangles },
  };
}

function bounds(v: Float32Array): ThreeMFMesh['bounds'] {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (v[i + k] < min[k]) min[k] = v[i + k];
      if (v[i + k] > max[k]) max[k] = v[i + k];
    }
  if (v.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}
