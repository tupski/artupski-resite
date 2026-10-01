import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:opacity-90 active:opacity-80 border border-transparent',
  secondary:
    'bg-surface-elevated text-text-primary border border-border-subtle hover:border-border-focus',
  ghost: 'bg-transparent text-text-secondary border border-transparent hover:text-text-primary hover:bg-surface',
  danger:
    'bg-transparent text-danger border border-danger/40 hover:bg-danger hover:text-white',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  // UI-SPEC section 5.2: interactive targets at least 32px tall.
  sm: 'h-7 px-2.5 text-caption gap-1.5',
  md: 'h-8 px-3 text-body gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded font-medium whitespace-nowrap',
        'transition-colors duration-100',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    />
  );
});
