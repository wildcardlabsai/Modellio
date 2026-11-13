import type * as THREE from 'three';
import type opentype from 'opentype.js';
import type { ManifoldToplevel } from 'manifold-3d';
import type { SimplePolygon } from 'manifold-3d';
import { manifoldToMeshData, meshDataToGeometry, type MeshData } from '../kernel/meshData';

export interface TextLayout {
  content: string;
  /** Em size in mm. */
  fontSize: number;
  /** Extrusion depth in mm. */
  depth: number;
  /** Curve flattening segments per Bézier. */
  curveSegments?: number;
}

/**
 * Convert font outlines to 2D contours (mm, Y up). Multi-line text is laid
 * out left-aligned with 1.25× line spacing.
 */
export function textContours(font: opentype.Font, layout: TextLayout): SimplePolygon[] {
  const seg = Math.max(2, Math.round(layout.curveSegments ?? 6));
  const lines = layout.content.split('\n');
  const contours: SimplePolygon[] = [];
  lines.forEach((line, li) => {
    const path = font.getPath(line, 0, li * layout.fontSize * 1.25, layout.fontSize);
    let current: [number, number][] = [];
    let x = 0;
    let y = 0;
    const push = (px: number, py: number) => current.push([px, -py]); // opentype is Y-down
    const close = () => {
      // Drop a duplicated closing point and degenerate contours.
      if (current.length > 1) {
        const [fx, fy] = current[0];
        const [lx, ly] = current[current.length - 1];
        if (Math.abs(fx - lx) < 1e-9 && Math.abs(fy - ly) < 1e-9) current.pop();
      }
      if (current.length >= 3) contours.push(current);
      current = [];
    };
    for (const c of path.commands) {
      switch (c.type) {
        case 'M':
          close();
          x = c.x;
          y = c.y;
          push(x, y);
          break;
        case 'L':
          x = c.x;
          y = c.y;
          push(x, y);
          break;
        case 'Q':
          for (let i = 1; i <= seg; i++) {
            const t = i / seg;
            const a = (1 - t) * (1 - t),
              b = 2 * (1 - t) * t,
              d = t * t;
            push(a * x + b * c.x1 + d * c.x, a * y + b * c.y1 + d * c.y);
          }
          x = c.x;
          y = c.y;
          break;
        case 'C':
          for (let i = 1; i <= seg; i++) {
            const t = i / seg;
            const a = (1 - t) ** 3,
              b = 3 * (1 - t) ** 2 * t,
              d = 3 * (1 - t) * t * t,
              e = t ** 3;
            push(a * x + b * c.x1 + d * c.x2 + e * c.x, a * y + b * c.y1 + d * c.y2 + e * c.y);
          }
          x = c.x;
          y = c.y;
          break;
        case 'Z':
          close();
          break;
      }
    }
    close();
  });
  return contours;
}

/**
 * Build solid text with the kernel: contours → CrossSection (non-zero fill,
 * which unions overlapping glyph parts correctly) → extrude. The result is
 * guaranteed manifold, so text can be used directly in Boolean operations.
 */
export function buildTextMesh(k: ManifoldToplevel, font: opentype.Font, layout: TextLayout): MeshData | null {
  const contours = textContours(font, layout);
  if (!contours.length) return null;
  const cs = new k.CrossSection(contours, 'NonZero');
  try {
    if (cs.isEmpty()) return null;
    const solid = k.Manifold.extrude(cs, Math.max(0.01, layout.depth));
    try {
      return manifoldToMeshData(solid);
    } finally {
      solid.delete();
    }
  } finally {
    cs.delete();
  }
}

export function buildTextGeometry(k: ManifoldToplevel, font: opentype.Font, layout: TextLayout): THREE.BufferGeometry | null {
  const mesh = buildTextMesh(k, font, layout);
  return mesh ? meshDataToGeometry(mesh, (40 * Math.PI) / 180) : null;
}
