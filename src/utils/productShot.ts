/**
 * Product-shot mode (`?shot=1`), used by `scripts/render-landing-images.mjs` to photograph the
 * makers' real 3D output on a transparent background. Has no effect otherwise.
 */
export const productShot = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('shot') === '1';

/** Clear colour for preview canvases: transparent in product-shot mode. */
export function clearPreview(gl: { setClearColor: (c: string, a?: number) => void }) {
  if (productShot) gl.setClearColor('#000000', 0);
  else gl.setClearColor('#f5f7fb');
}
