import { isOutlineFile, isPictureFile, isSvgFile } from './outlines';

describe('artwork file detection', () => {
  it('recognises raster pictures by type or extension', () => {
    expect(isPictureFile('logo.png', 'image/png')).toBe(true);
    expect(isPictureFile('photo.JPG')).toBe(true);
    expect(isPictureFile('x.webp', '')).toBe(true);
  });
  it('does not treat other image/* types (CAD drawings, icons) as pictures', () => {
    expect(isPictureFile('plan.dwg', 'image/vnd.dwg')).toBe(false);
    expect(isPictureFile('drawing.dxf', 'image/vnd.dxf')).toBe(false);
    expect(isOutlineFile('plan.dwg', 'image/vnd.dwg')).toBe(false);
  });
  it('keeps SVGs separate from pictures', () => {
    expect(isSvgFile('a.svg', 'image/svg+xml')).toBe(true);
    expect(isPictureFile('a.svg', 'image/svg+xml')).toBe(false);
  });
});
