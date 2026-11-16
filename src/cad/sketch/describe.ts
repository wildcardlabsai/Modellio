import type { Constraint, Sketch } from './types';

/** The entities and points a constraint refers to (for highlighting and clean-up). */
export function constraintRefs(c: Constraint): string[] {
  switch (c.kind) {
    case 'horizontal':
    case 'vertical':
    case 'distance':
      return [c.line];
    case 'radius':
      return [c.entity];
    case 'coincident':
      return [c.a, c.b];
    case 'pointX':
    case 'pointY':
      return [c.point];
    case 'parallel':
    case 'perpendicular':
    case 'equal':
    case 'angle':
      return [c.l1, c.l2];
    case 'tangent':
    case 'concentric':
      return [c.e1, c.e2, ...(c.kind === 'tangent' && c.at ? [c.at] : [])];
    case 'symmetric':
      return [c.a, c.b, c.line];
    case 'midpoint':
    case 'pointOnLine':
    case 'pointLineDistance':
      return [c.point, c.line];
    case 'pointOnCurve':
      return [c.point, c.entity];
    case 'pointDistance':
      return [c.a, c.b];
    case 'smooth':
      return [c.point, c.h1, c.h2];
  }
}

/** A short, plain description of a constraint. */
export function describeConstraint(c: Constraint): string {
  switch (c.kind) {
    case 'horizontal':
      return 'Horizontal';
    case 'vertical':
      return 'Vertical';
    case 'distance':
      return `Length ${c.value.toFixed(2)} mm`;
    case 'radius':
      return `Diameter ${(c.value * 2).toFixed(2)} mm`;
    case 'coincident':
      return 'Coincident';
    case 'parallel':
      return 'Parallel';
    case 'perpendicular':
      return 'Perpendicular';
    case 'equal':
      return 'Equal';
    case 'pointX':
      return `X = ${c.value.toFixed(2)} mm`;
    case 'pointY':
      return `Y = ${c.value.toFixed(2)} mm`;
    case 'tangent':
      return c.inside ? 'Tangent (inside)' : 'Tangent';
    case 'concentric':
      return 'Concentric';
    case 'symmetric':
      return 'Symmetric';
    case 'midpoint':
      return 'Midpoint';
    case 'pointOnLine':
      return 'Point on line';
    case 'pointOnCurve':
      return 'Point on curve';
    case 'angle':
      return `Angle ${c.value.toFixed(1)}°`;
    case 'pointDistance':
      return `Distance ${c.value.toFixed(2)} mm`;
    case 'pointLineDistance':
      return `Distance to line ${c.value.toFixed(2)} mm`;
    case 'smooth':
      return 'Smooth';
  }
}

/** "Length 40.00 mm and Horizontal": the constraints with these ids, for messages. */
export function nameConstraints(s: Sketch, ids: string[]): string {
  const names = ids
    .map((id) => s.constraints.find((c) => c.id === id))
    .filter((c): c is Constraint => !!c)
    .map(describeConstraint);
  if (!names.length) return 'the existing constraints';
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Constraints that carry a value the user can change (a dimension). */
export const isDimension = (c: Constraint): c is Extract<Constraint, { value: number }> => 'value' in c;
