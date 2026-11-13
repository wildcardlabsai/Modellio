/**
 * Safe arithmetic evaluator for numeric fields: supports + - * / ( ) and
 * decimals, e.g. "20+5", "100/3", "(12.5*2)-1". No eval().
 * Returns null for invalid input.
 */
export function evaluateExpression(input: string): number | null {
  const src = input.replace(/,/g, '.').replace(/\s+/g, '');
  if (!src) return null;
  let i = 0;

  const peek = () => src[i];
  const number = (): number | null => {
    const m = /^\d*\.?\d+(e[+-]?\d+)?|^\d+\./i.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const factor = (): number | null => {
    if (peek() === '-') {
      i++;
      const v = factor();
      return v === null ? null : -v;
    }
    if (peek() === '+') {
      i++;
      return factor();
    }
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') return null;
      i++;
      return v;
    }
    return number();
  };
  const term = (): number | null => {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = src[i++];
      const r = factor();
      if (r === null) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const expr = (): number | null => {
    let v = term();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = src[i++];
      const r = term();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };

  const result = expr();
  if (result === null || i !== src.length || !Number.isFinite(result)) return null;
  return result;
}
