import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { evaluateExpression } from '@/utils/expression';
import { roundTo } from '@/utils/math';

interface Props {
  value: number;
  onCommit: (value: number) => void;
  /** Axis badge, e.g. "X". */
  label?: string;
  labelClass?: string;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  disabled?: boolean;
  suffix?: string;
  ariaLabel: string;
  integer?: boolean;
}

/**
 * Precise numeric input. Accepts arithmetic ("20+5"), commits on Enter/blur,
 * reverts on Escape, and steps with ↑/↓ (Shift ×10, Alt ×0.1).
 */
export function NumberField({
  value,
  onCommit,
  label,
  labelClass = 'text-muted',
  step = 1,
  min,
  max,
  decimals = 2,
  disabled,
  suffix,
  ariaLabel,
  integer,
}: Props) {
  const format = (v: number) => (integer ? String(Math.round(v)) : roundTo(v, decimals).toFixed(decimals));
  const [text, setText] = useState(format(value));
  const [error, setError] = useState(false);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals]);

  const clampValue = (v: number) => {
    let r = integer ? Math.round(v) : v;
    if (min !== undefined) r = Math.max(min, r);
    if (max !== undefined) r = Math.min(max, r);
    return r;
  };

  const commit = (raw = text) => {
    const v = evaluateExpression(raw);
    if (v === null) {
      setError(true);
      return false;
    }
    setError(false);
    const c = clampValue(v);
    setText(format(c));
    if (Math.abs(c - value) > 1e-9) onCommit(c);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (commit()) (e.target as HTMLInputElement).select();
    } else if (e.key === 'Escape') {
      setText(format(value));
      setError(false);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      const base = evaluateExpression(text) ?? value;
      const next = clampValue(roundTo(base + (e.key === 'ArrowUp' ? 1 : -1) * step * mult, 6));
      setText(format(next));
      onCommit(next);
    }
  };

  return (
    <label
      className={`group flex h-9 min-w-0 items-center gap-1.5 rounded-lg border bg-white px-2 transition-colors ${
        error ? 'border-red-400 ring-2 ring-red-100' : 'border-line hover:border-[#c9d2e0] focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15'
      } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      {label && <span className={`text-[11px] font-bold ${labelClass}`}>{label}</span>}
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        disabled={disabled}
        value={text}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={() => {
          focused.current = false;
          if (!commit()) {
            setText(format(value));
            setError(false);
          }
        }}
        onChange={(e) => {
          setText(e.target.value);
          setError(false);
        }}
        onKeyDown={onKeyDown}
        className="w-full min-w-0 bg-transparent text-[13px] font-medium tabular-nums text-ink outline-none"
      />
      {suffix && <span className="text-[11px] text-muted">{suffix}</span>}
    </label>
  );
}
