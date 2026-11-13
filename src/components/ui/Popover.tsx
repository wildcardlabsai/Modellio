import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  side?: 'bottom' | 'top';
}

/** Minimal accessible popover: closes on outside click and Escape. */
export function Popover({ trigger, children, align = 'left', side = 'bottom' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          role="dialog"
          className={`absolute z-40 rounded-xl border border-line bg-white p-3 shadow-float ${align === 'right' ? 'right-0' : 'left-0'} ${
            side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
