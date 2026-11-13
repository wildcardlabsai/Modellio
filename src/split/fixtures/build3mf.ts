import { strToU8, zipSync } from 'fflate';

/**
 * Deterministic synthetic 3MF packages for tests and the built-in sample. Everything is
 * written as XML text so each fixture documents exactly which 3MF feature it exercises.
 */
export interface FxTriangle {
  v: [number, number, number];
  /** Raw extra attributes, e.g. { pid: '1', p1: '0' } or { paint_color: '8' }. */
  attrs?: Record<string, string>;
}

export interface FxMesh {
  vertices: [number, number, number][];
  triangles: FxTriangle[];
}

export interface FxObject {
  id: number;
  name?: string;
  type?: string;
  /** Extra object attributes, e.g. { pid: '1', pindex: '0' }. */
  attrs?: Record<string, string>;
  mesh?: FxMesh;
  components?: { objectid: number; transform?: string; path?: string }[];
}

export interface FxModelPart {
  /** Raw resource XML placed before the objects (materials, colour groups …). */
  resources?: string;
  objects: FxObject[];
}

export interface FxPackage {
  unit?: string;
  metadata?: Record<string, string>;
  /** Extra namespace declarations (prefix → URI). "m" is always declared, "p" when production paths are used. */
  namespaces?: Record<string, string>;
  requiredextensions?: string;
  root: FxModelPart;
  build: { objectid: number; transform?: string; path?: string; partnumber?: string }[];
  /** Additional model parts (production extension), path → part. */
  subModels?: Record<string, FxModelPart>;
  /** Extra package files (vendor metadata, textures), path → content. */
  files?: Record<string, string | Uint8Array>;
  /** Extra relationships from the root model part. */
  modelRels?: { target: string; type: string }[];
  /** Omit the start relationship (malformed-package tests). */
  omitStartRel?: boolean;
}

const NS_CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const NS_M = 'http://schemas.microsoft.com/3dmanufacturing/material/2015/02';
const NS_P = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';

const attrs = (a?: Record<string, string>) =>
  a
    ? Object.entries(a)
        .map(([k, v]) => ` ${k}="${v}"`)
        .join('')
    : '';

function objectXml(o: FxObject): string {
  const head = `<object id="${o.id}" type="${o.type ?? 'model'}"${o.name ? ` name="${o.name}"` : ''}${attrs(o.attrs)}>`;
  if (o.mesh) {
    const v = o.mesh.vertices.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('');
    const t = o.mesh.triangles.map((t) => `<triangle v1="${t.v[0]}" v2="${t.v[1]}" v3="${t.v[2]}"${attrs(t.attrs)}/>`).join('');
    return `${head}<mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh></object>`;
  }
  const c = (o.components ?? [])
    .map(
      (c) =>
        `<component${c.path ? ` p:path="${c.path}"` : ''} objectid="${c.objectid}"${c.transform ? ` transform="${c.transform}"` : ''}/>`,
    )
    .join('');
  return `${head}<components>${c}</components></object>`;
}

function modelXml(part: FxModelPart, pkg: FxPackage, isRoot: boolean): string {
  // The production namespace is declared only when used (it makes lib3mf expect UUIDs).
  const usesP =
    !!pkg.subModels ||
    pkg.build.some((b) => b.path) ||
    ([pkg.root, ...Object.values(pkg.subModels ?? {})] as FxModelPart[]).some((m) =>
      m.objects.some((o) => o.components?.some((c) => c.path)),
    );
  const ns = { m: NS_M, ...(usesP ? { p: NS_P } : {}), ...(pkg.namespaces ?? {}) };
  const nsAttrs = Object.entries(ns)
    .map(([k, v]) => ` xmlns:${k}="${v}"`)
    .join('');
  const meta = isRoot
    ? Object.entries(pkg.metadata ?? {})
        .map(([k, v]) => `<metadata name="${k}">${v}</metadata>`)
        .join('')
    : '';
  const build = isRoot
    ? `<build>${pkg.build
        .map(
          (b) =>
            `<item objectid="${b.objectid}"${b.path ? ` p:path="${b.path}"` : ''}${b.transform ? ` transform="${b.transform}"` : ''}${b.partnumber ? ` partnumber="${b.partnumber}"` : ''}/>`,
        )
        .join('')}</build>`
    : '<build/>';
  const req = isRoot && pkg.requiredextensions ? ` requiredextensions="${pkg.requiredextensions}"` : '';
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="${pkg.unit ?? 'millimeter'}" xml:lang="en-US" xmlns="${NS_CORE}"${nsAttrs}${req}>` +
    `${meta}<resources>${part.resources ?? ''}${part.objects.map(objectXml).join('')}</resources>${build}</model>`
  );
}

export function build3mf(pkg: FxPackage): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
      `<Default Extension="png" ContentType="image/png"/><Default Extension="config" ContentType="text/xml"/></Types>`,
  );
  if (!pkg.omitStartRel)
    files['_rels/.rels'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
    );
  files['3D/3dmodel.model'] = strToU8(modelXml(pkg.root, pkg, true));
  const rels = [
    ...Object.keys(pkg.subModels ?? {}).map((target) => ({ target, type: 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel' })),
    ...(pkg.modelRels ?? []),
  ];
  if (rels.length)
    files['3D/_rels/3dmodel.model.rels'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        rels.map((r, i) => `<Relationship Target="${r.target}" Id="rel${i + 1}" Type="${r.type}"/>`).join('') +
        `</Relationships>`,
    );
  for (const [path, part] of Object.entries(pkg.subModels ?? {})) files[path.replace(/^\//, '')] = strToU8(modelXml(part, pkg, false));
  for (const [path, content] of Object.entries(pkg.files ?? {}))
    files[path.replace(/^\//, '')] = typeof content === 'string' ? strToU8(content) : content;
  return zipSync(files, { level: 1 });
}

/** Axis-aligned box mesh (12 triangles, outward winding). Optional per-triangle attributes by index. */
export function boxMesh(
  min: [number, number, number],
  max: [number, number, number],
  triAttrs?: (i: number) => Record<string, string> | undefined,
): FxMesh {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const vertices: [number, number, number][] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const faces: [number, number, number][] = [
    [0, 2, 1],
    [0, 3, 2], // bottom
    [4, 5, 6],
    [4, 6, 7], // top
    [0, 1, 5],
    [0, 5, 4], // front
    [1, 2, 6],
    [1, 6, 5], // right
    [2, 3, 7],
    [2, 7, 6], // back
    [3, 0, 4],
    [3, 4, 7], // left
  ];
  return { vertices, triangles: faces.map((v, i) => ({ v, attrs: triAttrs?.(i) })) };
}

/** Closed cylinder (prism) mesh around (cx, cy) from z0 to z1. */
export function cylinderMesh(cx: number, cy: number, r: number, z0: number, z1: number, segments = 24): FxMesh {
  const vertices: [number, number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = +(cx + r * Math.cos(a)).toFixed(4);
    const y = +(cy + r * Math.sin(a)).toFixed(4);
    vertices.push([x, y, z0], [x, y, z1]);
  }
  const bottom = vertices.push([cx, cy, z0]) - 1;
  const top = vertices.push([cx, cy, z1]) - 1;
  const triangles: FxTriangle[] = [];
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    const [b0, t0, b1, t1] = [i * 2, i * 2 + 1, j * 2, j * 2 + 1];
    triangles.push({ v: [b0, b1, t1] }, { v: [b0, t1, t0] }, { v: [bottom, b1, b0] }, { v: [top, t0, t1] });
  }
  return { vertices, triangles };
}

/**
 * Built-in sample: a multi-colour "eye" badge. A white base plate, a blue iris and a black
 * pupil as separate objects (base materials), plus a cube coloured per triangle (colour group).
 */
export function sampleEyeBadge(): Uint8Array {
  return build3mf({
    metadata: { Title: 'Eye badge (sample)', Application: 'MODELLIO sample' },
    root: {
      resources:
        `<basematerials id="1"><base name="White PLA" displaycolor="#F4F4F2"/><base name="Blue PLA" displaycolor="#2F6FDE"/><base name="Black PLA" displaycolor="#1B1B1F"/></basematerials>` +
        `<m:colorgroup id="2"><m:color color="#E0262B"/><m:color color="#F5C518"/></m:colorgroup>`,
      objects: [
        { id: 10, name: 'Base plate', attrs: { pid: '1', pindex: '0' }, mesh: cylinderMesh(0, 0, 20, 0, 3, 48) },
        { id: 11, name: 'Iris', attrs: { pid: '1', pindex: '1' }, mesh: cylinderMesh(0, 0, 11, 3, 5, 40) },
        { id: 12, name: 'Pupil', attrs: { pid: '1', pindex: '2' }, mesh: cylinderMesh(0, 0, 5, 5, 6.5, 32) },
        // Per-triangle colours: red sides, yellow top and bottom.
        { id: 13, name: 'Two-tone cube', mesh: boxMesh([28, -6, 0], [40, 6, 12], (i) => ({ pid: '2', p1: i < 4 ? '1' : '0' })) },
      ],
    },
    build: [{ objectid: 10 }, { objectid: 11 }, { objectid: 12 }, { objectid: 13 }],
  });
}

/** Icosphere (watertight, outward) with optional per-triangle attributes chosen from the triangle centroid. */
export function icosphereMesh(
  r: number,
  subdivisions: number,
  centre: [number, number, number] = [0, 0, 0],
  triAttrs?: (c: [number, number, number]) => Record<string, string> | undefined,
): FxMesh {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: [number, number, number][] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ];
  let faces: [number, number, number][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  const norm = (v: [number, number, number]): [number, number, number] => {
    const l = Math.hypot(...v);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  verts = verts.map(norm);
  for (let s = 0; s < subdivisions; s++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      let m = cache.get(k);
      if (m === undefined) {
        m = verts.push(norm([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2])) - 1;
        cache.set(k, m);
      }
      return m;
    };
    const next: [number, number, number][] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const vertices = verts.map(
    ([x, y, z]) =>
      [+(centre[0] + x * r).toFixed(5), +(centre[1] + y * r).toFixed(5), +(centre[2] + z * r).toFixed(5)] as [number, number, number],
  );
  return {
    vertices,
    triangles: faces.map((v) => {
      const c: [number, number, number] = [0, 1, 2].map((k) => (vertices[v[0]][k] + vertices[v[1]][k] + vertices[v[2]][k]) / 3) as [
        number,
        number,
        number,
      ];
      return { v, attrs: triAttrs?.(c) };
    }),
  };
}
