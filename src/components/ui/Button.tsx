import { forwardRef, type ButtonHTMLAttributes } from 'react';

/**
 * The app's button, built on the design tokens so it follows the workspace theme (light or the
 * Studio's dark). Variants: primary (the one main action), secondary, ghost (toolbar-like), danger.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-600 border border-transparent',
  secondary: 'border border-line bg-panel text-ink-2 hover:border-line-strong hover:bg-canvas',
  ghost: 'border border-transparent text-ink-2 hover:bg-canvas',
  danger: 'border border-transparent bg-red-600 text-white hover:bg-red-700',
};
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[12px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-[13px] gap-2 rounded-lg',
};

export const buttonClasses = (variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra = '') =>
  `inline-flex shrink-0 items-center justify-center font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${extra}`;

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }
>(function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...rest }, ref) {
  return <button ref={ref} type={type} className={buttonClasses(variant, size, className)} {...rest} />;
});
