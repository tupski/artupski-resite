import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  /** Rendered at the right edge of the header row (actions, status, meta). */
  actions?: ReactNode;
  /** Remove inner padding when the body manages its own layout. */
  flush?: boolean;
}

/**
 * Section container with a compact header. Used to group related controls and
 * content; intentionally flatter than a marketing "card".
 */
export function Panel({ title, actions, flush, className, children, ...props }: PanelProps) {
  return (
    <section
      className={cn('overflow-hidden rounded border border-border-subtle bg-surface', className)}
      {...props}
    >
      {title || actions ? (
        <header className="flex h-9 items-center justify-between gap-3 border-b border-border-subtle px-3">
          {typeof title === 'string' ? (
            <h2 className="text-caption font-semibold uppercase tracking-wide text-text-secondary">
              {title}
            </h2>
          ) : (
            title
          )}
          {actions ? <div className="flex items-center gap-1.5">{actions}</div> : null}
        </header>
      ) : null}
      <div className={flush ? undefined : 'p-3'}>{children}</div>
    </section>
  );
}
