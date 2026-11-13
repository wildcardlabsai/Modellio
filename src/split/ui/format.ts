export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
export const formatCount = (n: number) => n.toLocaleString('en-GB');
export const formatArea = (mm2: number) =>
  mm2 >= 10000
    ? `${(mm2 / 100).toLocaleString('en-GB', { maximumFractionDigits: 1 })} cm²`
    : `${mm2.toLocaleString('en-GB', { maximumFractionDigits: 1 })} mm²`;
export const formatMm = (v: number) => `${(Math.round(v * 100) / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;

export const UNIT_LABEL: Record<string, string> = {
  micron: 'Microns',
  millimeter: 'Millimetres',
  centimeter: 'Centimetres',
  inch: 'Inches',
  foot: 'Feet',
  meter: 'Metres',
};

export const KIND_LABEL: Record<string, string> = {
  base: '3MF base material',
  colour: '3MF colour',
  texture: '3MF texture',
  composite: '3MF composite material',
  multi: '3MF multi-property',
  filament: 'Slicer filament',
  nonprinting: 'Not printed',
  unassigned: 'No colour data',
};
