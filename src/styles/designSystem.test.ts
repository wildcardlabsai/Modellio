import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One visual system: the makers and Split Studio take their interface colours from the design
 * tokens (so they follow the shared theme), never from hard-coded hex values. Colours that are
 * content (filament palettes, 3D materials, the light artboard a design is drawn on) are written
 * as SVG/three.js values, not Tailwind classes, and are not checked here.
 */
const ROOTS = ['src/makers', 'src/split'];
// UI classes with a literal colour: bg-[#…], text-[#…], border-[#…], hover:…, ring-[#…].
const LITERAL = /\b(?:hover:|focus:)?(?:bg|text|border|ring|outline|from|to|via|accent|divide|placeholder)-\[#[0-9a-fA-F]{3,8}\]/g;
// Drawing on the light artboard (the design canvas and the vase profile), which stays light in every theme.
const ARTBOARD_ALLOWED: Record<string, string[]> = {
  'src/makers/vase/ProfileEditor.tsx': ['border-[#E4E0D6]'],
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

describe('one design system for the makers and Split Studio', () => {
  it('uses design tokens for interface colours (no hard-coded hex classes)', () => {
    const found: string[] = [];
    for (const f of ROOTS.flatMap(files)) {
      const allowed = ARTBOARD_ALLOWED[f] ?? [];
      for (const m of readFileSync(f, 'utf8').match(LITERAL) ?? []) if (!allowed.includes(m)) found.push(`${f}: ${m}`);
    }
    expect(found).toEqual([]);
  });
  it('uses the panel token rather than plain white panels', () => {
    const found = ROOTS.flatMap(files).filter((f) => /(?<![\w:/-])bg-white(?![/\w-])/.test(readFileSync(f, 'utf8')));
    expect(found).toEqual([]);
  });
});
