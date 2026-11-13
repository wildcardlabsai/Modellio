import { maskFromRgba, otsu } from '../cookie/trace';

export interface UploadedImage {
  kind: 'image';
  name: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  threshold: number;
  invert: boolean;
  usesAlpha: boolean;
}

/** Read a picture file (PNG/JPG/WebP) into RGBA pixels, scaled so the longest side is at most 600 px. */
export async function readImageFile(file: File): Promise<UploadedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const threshold = otsu(rgba, width * height);
  const { usesAlpha } = maskFromRgba(rgba, width, height, threshold, false);
  return { kind: 'image', name: file.name, width, height, rgba, threshold, invert: false, usesAlpha };
}
