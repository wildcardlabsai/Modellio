import { strFromU8 } from 'fflate';
import { unzip } from './unzip';
import { ThreeMFImportError, localName, walkXml } from './xml';

/**
 * Open Packaging Conventions (OPC) reader: the ZIP container, content types and
 * relationships. Model geometry itself is parsed by lib3mf; this reader exists to
 * report the package structure and to reach vendor (slicer) metadata parts.
 */
export interface OpcPackage {
  /** Part name (no leading slash) → bytes. */
  parts: Map<string, Uint8Array>;
  relationships: { source: string; target: string; type: string }[];
  /** Absolute path of the root 3D model part, e.g. "/3D/3dmodel.model". */
  rootModel: string;
  /** All model parts ("*.model"), root first. */
  modelParts: string[];
}

export const REL_3DMODEL = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
export const REL_TEXTURE = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dtexture';

const norm = (p: string) => p.replace(/^\/+/, '');

/** Resolve a relationship target relative to the part that owns the .rels file. */
function resolveTarget(source: string, target: string): string {
  if (target.startsWith('/')) return target;
  const base = source.slice(0, source.lastIndexOf('/') + 1);
  const out: string[] = [];
  for (const seg of (base + target).split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return '/' + out.join('/');
}

export async function readPackage(bytes: Uint8Array): Promise<OpcPackage> {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ThreeMFImportError('This file is not a 3MF package (3MF files are ZIP archives, and this one is not).');
  }
  let entries: Record<string, Uint8Array>;
  try {
    // Thumbnails, textures and embedded G-code are not needed: skip decompressing them.
    entries = await unzip(bytes, (name) => !/\.(png|jpe?g|bmp|webp|gcode|svg)$/i.test(name));
  } catch (e) {
    throw new ThreeMFImportError(`The 3MF package is damaged and could not be unzipped (${(e as Error).message}).`);
  }
  const parts = new Map<string, Uint8Array>();
  // Part names are case-insensitive in OPC; keep the original but look up case-insensitively.
  for (const [name, data] of Object.entries(entries)) if (!name.endsWith('/')) parts.set(name, data);

  const relationships: OpcPackage['relationships'] = [];
  for (const [name, data] of parts) {
    const m = /^(.*?)_rels\/([^/]*)\.rels$/i.exec(name);
    if (!m) continue;
    const source = '/' + m[1] + m[2];
    walkXml(
      strFromU8(data),
      {
        open: (tag, a) => {
          if (localName(tag) === 'Relationship' && a.Target)
            relationships.push({
              source: source === '/' ? '/' : source,
              target: resolveTarget(source === '/' ? '/' : source, a.Target),
              type: a.Type ?? '',
            });
        },
      },
      name,
    );
  }
  const root = relationships.find((r) => r.source === '/' && r.type === REL_3DMODEL);
  if (!root) {
    const fallback = [...parts.keys()].find((p) => /^3D\/[^/]*\.model$/i.test(p));
    if (!fallback) throw new ThreeMFImportError('The package has no 3D model part, so it is not a 3MF file.');
    throw new ThreeMFImportError(`The package does not declare its 3D model (missing _rels/.rels start relationship; found ${fallback}).`);
  }
  if (!getPart(parts, root.target))
    throw new ThreeMFImportError(`The package declares ${root.target} as its 3D model, but that part is missing.`);
  const modelParts = [
    root.target,
    ...[...parts.keys()]
      .filter((p) => /\.model$/i.test(p))
      .map((p) => '/' + p)
      .filter((p) => p.toLowerCase() !== root.target.toLowerCase()),
  ];
  return { parts, relationships, rootModel: root.target, modelParts };
}

export function getPart(parts: Map<string, Uint8Array>, path: string): Uint8Array | undefined {
  const want = norm(path);
  const direct = parts.get(want);
  if (direct) return direct;
  const lower = want.toLowerCase();
  for (const [k, v] of parts) if (k.toLowerCase() === lower) return v;
  return undefined;
}
