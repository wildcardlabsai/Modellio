import type { ExportBody } from './collect';

export type UpAxis = 'z' | 'y';

/** Convert a Z-up position to the requested up axis (Y-up: x, z, -y — a proper rotation). */
function orient(x: number, y: number, z: number, up: UpAxis): [number, number, number] {
  return up === 'z' ? [x, y, z] : [x, z, -y];
}

function triNormal(a: number[], b: number[], c: number[]): [number, number, number] {
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    uz = b[2] - a[2];
  const vx = c[0] - a[0],
    vy = c[1] - a[1],
    vz = c[2] - a[2];
  const nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/**
 * Binary STL (little-endian). Units are millimetres; STL has no unit field, and
 * slicers assume mm. All bodies are written into one file.
 */
export function writeBinaryStl(bodies: ExportBody[], up: UpAxis = 'z'): ArrayBuffer {
  const triCount = bodies.reduce((n, b) => n + b.mesh.indices.length / 3, 0);
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  const header = 'MODELLIO binary STL - units: millimetres';
  for (let i = 0; i < 80; i++) view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0x20);
  view.setUint32(80, triCount, true);
  let o = 84;
  for (const b of bodies) {
    const p = b.mesh.positions;
    const ix = b.mesh.indices;
    for (let t = 0; t < ix.length; t += 3) {
      const v = [ix[t], ix[t + 1], ix[t + 2]].map((i) => orient(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], up));
      const n = triNormal(v[0], v[1], v[2]);
      for (const c of [n, ...v]) {
        view.setFloat32(o, c[0], true);
        view.setFloat32(o + 4, c[1], true);
        view.setFloat32(o + 8, c[2], true);
        o += 12;
      }
      view.setUint16(o, 0, true);
      o += 2;
    }
  }
  return buffer;
}

const fmt = (v: number) => {
  const s = v.toPrecision(9);
  return s.includes('e') ? v.toExponential(6) : String(Number(s));
};

/** ASCII STL — larger, but human-readable. One `solid` per body. */
export function writeAsciiStl(bodies: ExportBody[], up: UpAxis = 'z'): string {
  const lines: string[] = [];
  for (const b of bodies) {
    const name = b.name.replace(/\s+/g, '_') || 'part';
    lines.push(`solid ${name}`);
    const p = b.mesh.positions;
    const ix = b.mesh.indices;
    for (let t = 0; t < ix.length; t += 3) {
      const v = [ix[t], ix[t + 1], ix[t + 2]].map((i) => orient(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], up));
      const n = triNormal(v[0], v[1], v[2]);
      lines.push(`  facet normal ${n.map(fmt).join(' ')}`, '    outer loop');
      for (const c of v) lines.push(`      vertex ${c.map(fmt).join(' ')}`);
      lines.push('    endloop', '  endfacet');
    }
    lines.push(`endsolid ${name}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Wavefront OBJ with one named object per body and shared, welded vertices.
 * Colours are written as `usemtl` names (hex), with an optional MTL library.
 */
export function writeObj(bodies: ExportBody[], up: UpAxis = 'z', mtlFileName?: string): { obj: string; mtl: string } {
  const lines = ['# MODELLIO OBJ export', '# units: millimetres', `# up axis: ${up.toUpperCase()}`];
  if (mtlFileName) lines.push(`mtllib ${mtlFileName}`);
  const materials = new Map<string, string>();
  let base = 1;
  for (const b of bodies) {
    const name = b.name.replace(/\s+/g, '_') || 'part';
    const mat = `mat_${b.color.replace('#', '').toUpperCase()}`;
    materials.set(mat, b.color);
    lines.push(`o ${name}`);
    const p = b.mesh.positions;
    for (let i = 0; i < p.length; i += 3)
      lines.push(
        `v ${orient(p[i], p[i + 1], p[i + 2], up)
          .map(fmt)
          .join(' ')}`,
      );
    if (mtlFileName) lines.push(`usemtl ${mat}`);
    const ix = b.mesh.indices;
    for (let t = 0; t < ix.length; t += 3) lines.push(`f ${ix[t] + base} ${ix[t + 1] + base} ${ix[t + 2] + base}`);
    base += p.length / 3;
  }
  const mtl = ['# MODELLIO materials'];
  for (const [name, hex] of materials) {
    const c = [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4));
    mtl.push(`newmtl ${name}`, `Kd ${c.join(' ')}`, 'Ka 0 0 0', 'Ks 0.1 0.1 0.1', 'd 1', '');
  }
  return { obj: lines.join('\n') + '\n', mtl: mtl.join('\n') };
}
