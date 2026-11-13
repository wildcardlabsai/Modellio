import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { projectFromFile, projectToFile, ProjectFormatError, type ProjectData } from './project';

/**
 * Share links carry the whole design in the URL fragment (#share=…),
 * deflate-compressed and base64url-encoded. Fragments are never sent to a
 * server, so the design stays private between sender and recipient, and no
 * backend is needed. Very large designs (big imported meshes) should be
 * shared as project files instead.
 */
export const SHARE_PREFIX = '#share=';
/** Browsers handle long URLs, but chat apps and email clients don't: keep links reasonable. */
export const MAX_SHARE_CHARS = 1_500_000;

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeShareFragment(project: ProjectData): string {
  return SHARE_PREFIX + toBase64Url(deflateSync(strToU8(projectToFile(project)), { level: 9 }));
}

export function decodeShareFragment(hash: string): ProjectData {
  if (!hash.startsWith(SHARE_PREFIX)) throw new ProjectFormatError('This is not a MODELLIO share link.');
  let json: string;
  try {
    json = strFromU8(inflateSync(fromBase64Url(hash.slice(SHARE_PREFIX.length))));
  } catch {
    throw new ProjectFormatError('This share link is incomplete or damaged. Ask for the link again.');
  }
  return projectFromFile(json);
}
