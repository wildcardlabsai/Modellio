import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { studioUrl, useStudio, type StudioId } from '@/app/studio';

/**
 * MODELLIO 2.0 platform components for navy surfaces (landing page, dashboard, maker headers).
 * The Design Studio's light panels keep their own controls.
 */

type Variant = 'primary' | 'secondary' | 'ghost';
const VARIANT: Record<Variant, string> = {
  primary: 'btn-gradient text-white',
  secondary: 'border border-night-line bg-night-800/70 text-fog hover:border-violet-400/60 hover:bg-night-700',
  ghost: 'text-haze hover:bg-white/5 hover:text-white',
};
const SIZE = { sm: 'h-9 px-3.5 text-[13px]', md: 'h-11 px-5 text-[15px]', lg: 'h-12 px-6 text-[16px]' };

export function buttonClass(variant: Variant = 'primary', size: keyof typeof SIZE = 'md', extra = '') {
  return `inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${SIZE[size]} ${VARIANT[variant]} ${extra}`;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZE }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...rest} />;
}

/** A link into a workspace with a real href (opens in a new tab too) and in-app navigation on click. */
export function StudioLink({
  to,
  className,
  children,
  label,
  testId,
  before,
}: {
  to: StudioId;
  className?: string;
  children: ReactNode;
  label?: string;
  testId?: string;
  /** Runs before navigating (e.g. pick a project or a view). */
  before?: () => void;
}) {
  return (
    <a
      href={studioUrl(to)}
      aria-label={label}
      className={className}
      data-testid={testId}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        before?.();
        useStudio.getState().setStudio(to);
      }}
    >
      {children}
    </a>
  );
}

export function SectionHeading({ eyebrow, title, intro, id }: { eyebrow?: string; title: string; intro?: string; id?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      {eyebrow && <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-violet-300">{eyebrow}</p>}
      <h2 id={id} className="mt-2 text-[32px] font-bold leading-tight tracking-tight text-white sm:text-[40px]">
        {title}
      </h2>
      {intro && <p className="mt-3 text-[16px] leading-relaxed text-haze sm:text-[17px]">{intro}</p>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-[14px] text-haze">
      <Loader2 size={18} className="animate-spin text-violet-400" aria-hidden /> {label}…
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  actions,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="card-night flex flex-col items-center px-6 py-10 text-center" data-testid="empty-state">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet/15 text-violet-300">{icon}</span>
      <h3 className="mt-4 text-[18px] font-semibold text-white">{title}</h3>
      {children && <p className="mt-1.5 max-w-md text-[14px] leading-relaxed text-haze">{children}</p>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

/** A modal confirmation (Escape cancels, focus starts on Cancel so Enter never deletes by accident). */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night-950/70 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="surface-night w-full max-w-sm rounded-2xl border border-night-line bg-night-850 p-5 text-fog shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-[17px] font-semibold text-white">
          {title}
        </h2>
        <div className="mt-2 text-[14px] leading-relaxed text-haze">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className={buttonClass('secondary', 'sm')} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={
              danger
                ? 'inline-flex h-9 items-center rounded-xl bg-red-600 px-3.5 text-[13px] font-semibold text-white hover:bg-red-500'
                : buttonClass('primary', 'sm')
            }
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
