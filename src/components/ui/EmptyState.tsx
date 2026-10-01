import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Non-decorative empty-state surface with a clear next step. */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-10 text-center',
        className
      )}
    >
      {icon ? <div className="text-text-muted">{icon}</div> : null}
      <div className="flex flex-col gap-1">
        <p className="text-heading text-text-primary">{title}</p>
        <p className="max-w-sm text-body text-text-secondary">{description}</p>
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
