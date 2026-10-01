import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Visible label - required; placeholder is never used as the only label. */
  label: string;
  /** Optional hint rendered beneath the field. */
  hint?: ReactNode;
  /** Validation message; also switches the field to its invalid style. */
  error?: string | null;
  leadingAddon?: ReactNode;
  trailingAddon?: ReactNode;
  inputClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leadingAddon, trailingAddon, id, className, inputClassName, ...props },
  ref
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedById = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  const isInvalid = Boolean(error);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-caption font-medium text-text-secondary">
        {label}
      </label>
      <div
        className={cn(
          'flex h-9 items-center rounded border bg-base',
          'transition-colors duration-100',
          isInvalid
            ? 'border-danger focus-within:border-danger'
            : 'border-border-subtle focus-within:border-border-focus'
        )}
      >
        {leadingAddon ? (
          <span className="pl-2.5 text-text-muted" aria-hidden="true">
            {leadingAddon}
          </span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={isInvalid || undefined}
          aria-describedby={describedById}
          className={cn(
            'h-full w-full bg-transparent px-2.5 text-body text-text-primary',
            'placeholder:text-text-muted focus:outline-none',
            inputClassName
          )}
          {...props}
        />
        {trailingAddon ? <span className="pr-2.5">{trailingAddon}</span> : null}
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-caption text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
