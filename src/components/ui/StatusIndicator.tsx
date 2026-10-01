import { cn } from '../../lib/cn';

export type StatusTone = 'idle' | 'active' | 'success' | 'warning' | 'danger';

export interface StatusIndicatorProps {
  tone: StatusTone;
  label: string;
  /** Pulse the dot to signal active work. Motion explains state only. */
  pulse?: boolean;
  className?: string;
}

const TONE_DOT: Record<StatusTone, string> = {
  idle: 'bg-text-muted',
  active: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export function StatusIndicator({ tone, label, pulse, className }: StatusIndicatorProps) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-caption text-text-secondary', className)}>
      <span
        className={cn('h-1.5 w-1.5 rounded-full', TONE_DOT[tone], pulse && 'animate-pulse')}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
