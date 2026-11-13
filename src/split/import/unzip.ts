import { unzipSync } from 'fflate';

/**
 * ZIP reader that inflates entries with the platform's native DecompressionStream
 * (several times faster than a JavaScript inflater on large model parts), decompressing
 * entries in parallel. Falls back to fflate where DecompressionStream or the archive
 * layout isn't supported.
 */
export async function unzip(bytes: Uint8Array, keep: (name: string) => boolean): Promise<Record<string, Uint8Array>> {
  if (typeof DecompressionStream === 'undefined') return unzipSync(bytes, { filter: (f) => keep(f.name) });
  const entries = readCentralDirectory(bytes);
  if (!entries) return unzipSync(bytes, { filter: (f) => keep(f.name) });
  const out: Record<string, Uint8Array> = {};
  await Promise.all(
    entries
      .filter((e) => keep(e.name))
      .map(async (e) => {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const lh = e.localHeader;
        if (dv.getUint32(lh, true) !== 0x04034b50) throw new Error(`bad local header for ${e.name}`);
        const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
        const data = bytes.subarray(start, start + e.compressedSize);
        if (e.method === 0) out[e.name] = data.slice();
        else if (e.method === 8) out[e.name] = await inflateRaw(data, e.size);
        else throw new Error(`unsupported compression method ${e.method} for ${e.name}`);
      }),
  );
  return out;
}

async function inflateRaw(data: Uint8Array, size: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const out = new Uint8Array(size);
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > out.length) throw new Error('entry is larger than its declared size');
    out.set(value, at);
    at += value.length;
  }
  if (at !== size) throw new Error('entry is shorter than its declared size');
  return out;
}

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeader: number;
}

/** Central directory (with ZIP64 sizes). Returns null for layouts this reader doesn't handle. */
function readCentralDirectory(b: Uint8Array): Entry[] | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) return null;
  let count = dv.getUint16(eocd + 10, true);
  let offset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || offset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || dv.getUint32(loc, true) !== 0x07064b50) return null;
    const z = Number(dv.getBigUint64(loc + 8, true));
    if (dv.getUint32(z, true) !== 0x06064b50) return null;
    count = Number(dv.getBigUint64(z + 32, true));
    offset = Number(dv.getBigUint64(z + 48, true));
  }
  const names = new TextDecoder();
  const entries: Entry[] = [];
  let p = offset;
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) return null;
    const method = dv.getUint16(p + 10, true);
    let compressedSize = dv.getUint32(p + 20, true);
    let size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    let localHeader = dv.getUint32(p + 42, true);
    const name = names.decode(b.subarray(p + 46, p + 46 + nameLen));
    // ZIP64 extended information.
    let e = p + 46 + nameLen;
    const end = e + extraLen;
    while (e + 4 <= end) {
      const id = dv.getUint16(e, true);
      const len = dv.getUint16(e + 2, true);
      if (id === 1) {
        let q = e + 4;
        if (size === 0xffffffff) {
          size = Number(dv.getBigUint64(q, true));
          q += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = Number(dv.getBigUint64(q, true));
          q += 8;
        }
        if (localHeader === 0xffffffff) localHeader = Number(dv.getBigUint64(q, true));
      }
      e += 4 + len;
    }
    if (dv.getUint16(p + 8, true) & 1) return null; // encrypted
    if (!name.endsWith('/')) entries.push({ name, method, compressedSize, size, localHeader });
    p = end + commentLen;
  }
  return entries;
}
