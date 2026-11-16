import { base64ToBytes, bytesToBase64 } from './base64';

it('round-trips bytes through base64, including large files', () => {
  const big = new Uint8Array(200_000).map((_, i) => (i * 31) % 256);
  expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  expect(bytesToBase64(new Uint8Array([104, 105]))).toBe('aGk=');
});
