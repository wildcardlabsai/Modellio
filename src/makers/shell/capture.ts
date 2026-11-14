/**
 * A small JPEG of a maker's 3D preview for project thumbnails. Previews render with
 * `preserveDrawingBuffer`, so their canvas can be read at any time.
 */
export function capturePreview(): string | undefined {
  const canvases = [...document.querySelectorAll<HTMLCanvasElement>('[data-maker-preview] canvas')];
  const src = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!src || !src.width || !src.height) return undefined;
  try {
    const w = 320;
    const h = 240;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0e1530';
    g.fillRect(0, 0, w, h);
    const k = Math.max(w / src.width, h / src.height);
    g.drawImage(src, (w - src.width * k) / 2, (h - src.height * k) / 2, src.width * k, src.height * k);
    return c.toDataURL('image/jpeg', 0.82);
  } catch {
    return undefined;
  }
}
