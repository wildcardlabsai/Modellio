const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short, collision-resistant random id (≈ 62 bits of entropy). */
export function createId(prefix = 'obj'): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}
