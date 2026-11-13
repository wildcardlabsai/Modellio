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
 * reverts on Escape, and steps with ↑/↓ (Shift ×10, Alt ×0.1) or the arrow buttons
 * (click, Shift-click ×10, press and hold to repeat).
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

  /** Step from the current text (or value) and commit; returns the new value. */
  const stepBy = (dir: 1 | -1, mult: number, from?: number) => {
    const base = from ?? evaluateExpression(text) ?? value;
    const next = clampValue(roundTo(base + dir * step * mult, 6));
    setText(format(next));
    setError(false);
    onCommit(next);
    return next;
  };

  // Press and hold an arrow button to keep stepping.
  const repeat = useRef<{ timer: ReturnType<typeof setTimeout> | null; current: number }>({ timer: null, current: 0 });
  const stopRepeat = () => {
    if (repeat.current.timer) clearTimeout(repeat.current.timer);
    repeat.current.timer = null;
  };
  useEffect(() => stopRepeat, []);
  const startRepeat = (dir: 1 | -1, shift: boolean) => {
    stopRepeat();
    const mult = shift ? 10 : 1;
    repeat.current.current = stepBy(dir, mult);
    const tick = (delay: number) => {
      repeat.current.timer = setTimeout(() => {
        repeat.current.current = stepBy(dir, mult, repeat.current.current);
        tick(60);
      }, delay);
    };
    tick(400);
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
      stepBy(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
    }
  };

  const atMax = max !== undefined && value >= max - 1e-9;
  const atMin = min !== undefined && value <= min + 1e-9;
  const arrow = (dir: 1 | -1) => (
    <button
      type="button"
      tabIndex={-1}
      data-testid={dir > 0 ? 'step-up' : 'step-down'}
      title={`${dir > 0 ? 'Increase' : 'Decrease'} (Shift-click ×10)`}
      disabled={disabled || (dir > 0 ? atMax : atMin)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        startRepeat(dir, e.shiftKey);
      }}
      onPointerUp={stopRepeat}
      onPointerLeave={stopRepeat}
      onPointerCancel={stopRepeat}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          stepBy(dir, e.shiftKey ? 10 : 1);
        }
      }}
      className="flex h-[15px] w-4 items-center justify-center rounded-[3px] text-[#667085] hover:bg-brand-50 hover:text-brand active:bg-brand-100 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <svg viewBox="0 0 8 5" className="h-[5px] w-2" aria-hidden>
        <path d={dir > 0 ? 'M0 5 4 0 8 5Z' : 'M0 0 4 5 8 0Z'} fill="currentColor" />
      </svg>
    </button>
  );

  return (
    <div
      onMouseDown={(e) => {
        // Clicking the field's padding focuses the input; the arrow buttons handle themselves.
        if (e.target === e.currentTarget) {
          e.preventDefault();
          (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus();
        }
      }}
      className={`group flex h-9 min-w-0 items-center gap-1.5 rounded-lg border bg-white pl-2 pr-0.5 transition-colors ${
        error
          ? 'border-red-400 ring-2 ring-red-100'
          : 'border-line hover:border-[#c9d2e0] focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15'
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
      {!disabled && (
        // Pointer-only: keyboard users step with ↑/↓ in the field, which screen readers announce.
        <span className="flex shrink-0 flex-col justify-center gap-px" aria-hidden data-testid="number-steppers">
          {arrow(1)}
          {arrow(-1)}
        </span>
      )}
    </div>
  );
}
