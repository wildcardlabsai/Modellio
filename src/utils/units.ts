import { useEditor } from '@/store/editorStore';
import { roundTo } from './math';

/**
 * Display units. Documents are ALWAYS stored in millimetres; only what the
 * user sees and types is converted.
 */
export type Unit = 'mm' | 'in';

export const MM_PER_INCH = 25.4;

export const toDisplay = (mm: number, unit: Unit) => (unit === 'in' ? mm / MM_PER_INCH : mm);
export const fromDisplay = (v: number, unit: Unit) => (unit === 'in' ? v * MM_PER_INCH : v);
export const unitDecimals = (unit: Unit) => (unit === 'in' ? 3 : 2);
export const unitStep = (unit: Unit) => (unit === 'in' ? 0.0625 : 1);

/** Format a length (given in mm) in the current display unit, without the unit name. */
export function formatLength(mm: number, unit: Unit = useEditor.getState().units): string {
  return roundTo(toDisplay(mm, unit), unitDecimals(unit)).toFixed(unitDecimals(unit));
}

export function useUnits() {
  const unit = useEditor((s) => s.units);
  return {
    unit,
    label: unit,
    toDisplay: (mm: number) => toDisplay(mm, unit),
    fromDisplay: (v: number) => fromDisplay(v, unit),
    decimals: unitDecimals(unit),
    step: unitStep(unit),
    format: (mm: number) => formatLength(mm, unit),
  };
}

/** Snap increments offered for each unit (stored in mm). */
export const SNAP_PRESETS: Record<Unit, { label: string; mm: number }[]> = {
  mm: [0.1, 0.25, 0.5, 1, 2, 5, 10].map((v) => ({ label: `${v} mm`, mm: v })),
  in: [
    ['1/32″', 1 / 32],
    ['1/16″', 1 / 16],
    ['1/8″', 1 / 8],
    ['1/4″', 1 / 4],
    ['1/2″', 1 / 2],
    ['1″', 1],
  ].map(([label, v]) => ({ label: label as string, mm: roundTo((v as number) * MM_PER_INCH, 6) })),
};
