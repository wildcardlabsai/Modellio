import { create } from 'zustand';
import type { MeshData } from '@/cad/kernel/meshData';
import { isOutlineFile, isPictureFile, isSvgFile, outlineFromFile, type Outline } from './outlines';
import type { ColouredPart } from './threemf';

/**
 * The asset library: files people add (logos, artwork, models) kept on this device so they
 * can be reused in the Design Studio and in every maker. Stored in IndexedDB; if that is
 * unavailable (private windows), the library still works for the session.
 */
export type AssetKind = 'svg' | 'image' | 'stl' | 'obj' | '3mf';

export interface AssetRecord {
  id: string;
  name: string;
  kind: AssetKind;
  type: string;
  blob: Blob;
  /** Small preview (data URL). */
  thumb: string;
  size: number;
  addedAt: number;
}

/** Drag type for assets dragged from the Assets panel onto the 3D view. */
export const ASSET_DRAG_MIME = 'application/x-modellio-asset';

export const ASSET_ACCEPT = '.svg,.png,.jpg,.jpeg,.webp,.stl,.obj,.3mf';
const MAX_BYTES = 200 * 1024 * 1024;

export function assetKind(name: string, type = ''): AssetKind | null {
  if (isSvgFile(name, type)) return 'svg';
  if (isPictureFile(name, type)) return 'image';
  const ext = name.toLowerCase().split('.').pop();
  return ext === 'stl' || ext === 'obj' || ext === '3mf' ? ext : null;
}
export const isOutlineAsset = (a: AssetRecord) => a.kind === 'svg' || a.kind === 'image';
export const assetFile = (a: AssetRecord) => new File([a.blob], a.name, { type: a.type });

// --- storage -------------------------------------------------------------------------------
const DB = 'modellio-assets';
const STORE = 'assets';
let dbPromise: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = run(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// --- thumbnails ----------------------------------------------------------------------------
const THUMB = 96;
function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = THUMB;
  const g = c.getContext('2d')!;
  g.fillStyle = '#F5F7FB';
  g.fillRect(0, 0, THUMB, THUMB);
  return [c, g];
}

export function outlineThumb(o: Outline): string {
  const [c, g] = canvas();
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of o.polys)
    for (const [x, y] of p) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  const s = (THUMB * 0.8) / Math.max(maxX - minX, maxY - minY, 1e-9);
  const ox = THUMB / 2 - ((minX + maxX) / 2) * s;
  const oy = THUMB / 2 + ((minY + maxY) / 2) * s;
  g.beginPath();
  for (const p of o.polys) {
    p.forEach(([x, y], i) => (i ? g.lineTo(ox + x * s, oy - y * s) : g.moveTo(ox + x * s, oy - y * s)));
    g.closePath();
  }
  g.fillStyle = '#1D2939';
  // Under the positive rule, reversed (hole) loops cancel like even-odd for simple artwork.
  g.fill(o.fillRule === 'EvenOdd' ? 'evenodd' : 'nonzero');
  return c.toDataURL('image/png');
}

/** A shaded isometric view of meshes (painter's algorithm; large meshes are sampled). */
export function meshThumb(parts: { mesh: MeshData; color?: string }[]): string {
  const [c, g] = canvas();
  const tris: { d: number; pts: number[]; shade: number; color: string }[] = [];
  const ax = [0.7071, -0.7071, 0];
  const ay = [0.4082, 0.4082, 0.8165];
  const az = [0.5774, 0.5774, -0.5774];
  const light = [0.3, -0.5, 0.81];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const total = parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0);
  const stride = Math.max(1, Math.ceil(total / 40000));
  for (const { mesh, color = '#64748B' } of parts) {
    const P = mesh.positions;
    const I = mesh.indices;
    for (let t = 0; t < I.length; t += 3 * stride) {
      const v = [I[t], I[t + 1], I[t + 2]].map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
      const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
      const e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      if ((n[0] * az[0] + n[1] * az[1] + n[2] * az[2]) / len > 0) continue; // back face
      const shade = Math.max(0.25, (n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / len);
      const pts: number[] = [];
      let d = 0;
      for (const p of v) {
        const x = p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2];
        const y = p[0] * ay[0] + p[1] * ay[1] + p[2] * ay[2];
        d += p[0] * az[0] + p[1] * az[1] + p[2] * az[2];
        pts.push(x, y);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      tris.push({ d, pts, shade, color });
    }
  }
  if (!tris.length) return c.toDataURL('image/png');
  tris.sort((a, b) => b.d - a.d);
  const s = (THUMB * 0.84) / Math.max(maxX - minX, maxY - minY, 1e-9);
  const ox = THUMB / 2 - ((minX + maxX) / 2) * s;
  const oy = THUMB / 2 + ((minY + maxY) / 2) * s;
  for (const t of tris) {
    const n = parseInt(t.color.slice(1, 7), 16) || 0x64748b;
    const k = 0.35 + 0.65 * t.shade;
    g.fillStyle = `rgb(${Math.round((n >> 16) * k)},${Math.round(((n >> 8) & 255) * k)},${Math.round((n & 255) * k)})`;
    g.beginPath();
    g.moveTo(ox + t.pts[0] * s, oy - t.pts[1] * s);
    g.lineTo(ox + t.pts[2] * s, oy - t.pts[3] * s);
    g.lineTo(ox + t.pts[4] * s, oy - t.pts[5] * s);
    g.closePath();
    g.fill();
    g.strokeStyle = g.fillStyle;
    g.lineWidth = 0.5;
    g.stroke();
  }
  return c.toDataURL('image/png');
}

/** Meshes from a mesh file (STL, OBJ: raw file units; 3MF: millimetres with colours). */
export async function meshPartsFromFile(file: File): Promise<{ parts: ColouredPart[]; format: 'stl' | 'obj' | '3mf' }> {
  if (/\.3mf$/i.test(file.name)) {
    const [{ importInWorker }, { threeMfParts }] = await Promise.all([import('@/split/worker/client'), import('./threemf')]);
    const parts = threeMfParts(await importInWorker(file));
    if (!parts.length) throw new Error(`"${file.name}" has no objects to add.`);
    return { parts, format: '3mf' };
  }
  const { parseMeshFile } = await import('@/cad/import/importMesh');
  const parsed = parseMeshFile(file.name, await file.arrayBuffer());
  return { parts: parsed.parts, format: parsed.format };
}

async function thumbFor(file: File, kind: AssetKind): Promise<string> {
  try {
    if (isOutlineFile(file.name, file.type)) return outlineThumb(await outlineFromFile(file));
    const { parts } = await meshPartsFromFile(file);
    return meshThumb(parts);
  } catch {
    const [c, g] = canvas();
    g.fillStyle = '#667085';
    g.font = 'bold 22px sans-serif';
    g.textAlign = 'center';
    g.fillText(kind.toUpperCase(), THUMB / 2, THUMB / 2 + 8);
    return c.toDataURL('image/png');
  }
}

// --- store ---------------------------------------------------------------------------------
interface AssetState {
  assets: AssetRecord[];
  loaded: boolean;
  load: () => Promise<void>;
  /** Save files to the library (duplicates by name and size are reused). Returns their records. */
  add: (files: File[]) => Promise<AssetRecord[]>;
  remove: (id: string) => Promise<void>;
}

const newId = () => `asset_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const useAssets = create<AssetState>((set, get) => ({
  assets: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    const all = ((await tx('readonly', (s) => s.getAll())) as AssetRecord[] | null) ?? [];
    const known = new Set(get().assets.map((a) => a.id));
    const merged = [...get().assets, ...all.filter((a) => !known.has(a.id))].sort((a, b) => b.addedAt - a.addedAt);
    set({ assets: merged, loaded: true });
  },
  add: async (files) => {
    const out: AssetRecord[] = [];
    for (const file of files) {
      const kind = assetKind(file.name, file.type);
      if (!kind || file.size > MAX_BYTES) continue;
      const existing = get().assets.find((a) => a.name === file.name && a.size === file.size);
      if (existing) {
        out.push(existing);
        continue;
      }
      const rec: AssetRecord = {
        id: newId(),
        name: file.name,
        kind,
        type: file.type || (kind === 'svg' ? 'image/svg+xml' : ''),
        blob: file,
        thumb: await thumbFor(file, kind),
        size: file.size,
        addedAt: Date.now(),
      };
      await tx('readwrite', (s) => s.put(rec));
      set({ assets: [rec, ...get().assets] });
      out.push(rec);
    }
    return out;
  },
  remove: async (id) => {
    await tx('readwrite', (s) => s.delete(id));
    set({ assets: get().assets.filter((a) => a.id !== id) });
  },
}));
