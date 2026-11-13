import { strToU8, zipSync } from 'fflate';
import type { ExportBody } from './collect';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => String(Math.round(v * 1e5) / 1e5);

/**
 * 3MF (3D Manufacturing Format): a zip of XML parts. Unlike STL it carries
 * units (millimetres), object names and colours, and is the preferred input
 * for modern slicers (PrusaSlicer, Bambu Studio, OrcaSlicer, Cura).
 */
export function write3mf(bodies: ExportBody[], title = 'MODELLIO design'): Uint8Array {
  const colors: string[] = [];
  const colorIndex = (hex: string) => {
    const c = hex.toUpperCase();
    let i = colors.indexOf(c);
    if (i === -1) i = colors.push(c) - 1;
    return i;
  };
  const objects: string[] = [];
  const items: string[] = [];
  bodies.forEach((b, k) => {
    const id = k + 2; // id 1 is the material group
    const p = b.mesh.positions;
    const ix = b.mesh.indices;
    const verts: string[] = [];
    for (let i = 0; i < p.length; i += 3) verts.push(`<vertex x="${num(p[i])}" y="${num(p[i + 1])}" z="${num(p[i + 2])}"/>`);
    const tris: string[] = [];
    for (let t = 0; t < ix.length; t += 3) tris.push(`<triangle v1="${ix[t]}" v2="${ix[t + 1]}" v3="${ix[t + 2]}"/>`);
    objects.push(
      `<object id="${id}" type="model" name="${esc(b.name)}" pid="1" pindex="${colorIndex(b.color)}"><mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh></object>`,
    );
    items.push(`<item objectid="${id}"/>`);
  });
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Title">${esc(title)}</metadata><metadata name="Application">MODELLIO</metadata>` +
    `<resources><basematerials id="1">${colors.map((c, i) => `<base name="Colour ${i + 1}" displaycolor="${c}FF"/>`).join('')}</basematerials>` +
    `${objects.join('')}</resources><build>${items.join('')}</build></model>`;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
    },
    { level: 6 },
  );
}
