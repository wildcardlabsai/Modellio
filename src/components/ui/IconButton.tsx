import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  active?: boolean;
  children: ReactNode;
  tooltipSide?: 'top' | 'bottom' | 'right' | 'left';
  variant?: 'ghost' | 'floating';
}

const SIDE: Record<NonNullable<Props['tooltipSide']>, string> = {
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
};

/** Accessible icon button with a styled tooltip that shows its keyboard shortcut. */
export function IconButton({
  label,
  shortcut,
  active,
  children,
  tooltipSide = 'bottom',
  variant = 'ghost',
  className = '',
  ...rest
}: Props) {
  const base =
    variant === 'floating'
      ? active
        ? 'bg-brand text-white shadow-sm'
        : 'text-[#344054] hover:bg-brand-50 hover:text-brand'
      : active
        ? 'bg-brand-50 text-brand'
        : 'text-[#344054] hover:bg-[#f2f4f7]';
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={`group/tt relative inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${base} ${className}`}
      {...rest}
    >
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 hidden whitespace-nowrap rounded-md bg-navy px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover/tt:block ${SIDE[tooltipSide]}`}
      >
        {label}
        {shortcut && <kbd className="ml-1.5 rounded bg-white/15 px-1 font-sans text-[10px] text-white/80">{shortcut}</kbd>}
      </span>
    </button>
  );
}
