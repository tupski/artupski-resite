/**
 * Toast region - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-15-impl-plan.md sections 5 (S5), 8.4, 11 and 13.
 *
 * Renders `uiStore.notices` as fixed, non-blocking, stacked chrome (max 5). Each
 * toast carries a tone icon, its message, an optional recovery action and a
 * dismiss control. Danger toasts announce assertively; every other tone is
 * polite. Auto-dismiss defaults to 6s but pauses while hovered/focused, and
 * actionable notices stay sticky until acted on or dismissed. `Escape` dismisses
 * the most recent notice.
 *
 * Built to `anti-ui-slop`: token-based colors only, no glow/neon, visible focus,
 * >=32px hit targets and >=4.5:1 contrast.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useUiStore, type Notice } from '../../stores/uiStore';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { IconAlert, IconCheck, IconInfo, IconX } from '../ui/icons';

/** Auto-dismiss delay for non-actionable notices. */
export const DEFAULT_TOAST_DURATION_MS = 6000;

/**
 * Marks a subtree as already owned by a toast host. `App` wraps the routed tree
 * in `ToastRegionProvider` and renders the real region itself; a `ToastRegion`
 * rendered inside the shell then defers (returns null) instead of double-mounting.
 */
const ToastHostContext = createContext(false);

/** Declare that this subtree's toasts are hosted by an ancestor `ToastRegion`. */
export function ToastRegionProvider({ children }: { children: ReactNode }) {
  return <ToastHostContext.Provider value={true}>{children}</ToastHostContext.Provider>;
}

export interface ToastRegionProps {
  /**
   * Optional action interceptor (used by tests and by hosts that own routing).
   * When provided, the default `reload`/`settings` behavior is skipped.
   */
  onAction?: (notice: Notice) => void;
}

interface ToneStyle {
  icon: typeof IconInfo;
  iconClass: string;
  borderClass: string;
}

const TONE_STYLES: Record<Notice['tone'], ToneStyle> = {
  info: { icon: IconInfo, iconClass: 'text-brand', borderClass: 'border-border-subtle' },
  success: { icon: IconCheck, iconClass: 'text-success', borderClass: 'border-success/40' },
  warning: { icon: IconAlert, iconClass: 'text-warning', borderClass: 'border-warning/40' },
  danger: { icon: IconAlert, iconClass: 'text-danger', borderClass: 'border-danger/50' }
};

function resolveDuration(notice: Notice): number {
  if (typeof notice.durationMs === 'number') {
    return notice.durationMs;
  }
  // Actionable notices are sticky by default; everything else auto-dismisses.
  return notice.action ? 0 : DEFAULT_TOAST_DURATION_MS;
}

interface ToastItemProps {
  notice: Notice;
  onDismiss: (id: string) => void;
  onAction?: (notice: Notice) => void;
}

function ToastItem({ notice, onDismiss, onAction }: ToastItemProps) {
  const duration = resolveDuration(notice);
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(duration);
  const style = TONE_STYLES[notice.tone];
  const Icon = style.icon;

  useEffect(() => {
    if (duration <= 0 || paused) {
      return;
    }
    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(notice.id), remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
    };
  }, [duration, paused, notice.id, onDismiss]);

  const handleAction = () => {
    if (onAction) {
      onAction(notice);
    } else if (notice.action?.kind === 'reload') {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    } else if (notice.action?.kind === 'settings') {
      if (typeof window !== 'undefined') {
        window.location.assign('/settings');
      }
    }
    // 'retry' has no host callback here: dismissing hands control back to the
    // user, who re-triggers the operation from the relevant screen.
    onDismiss(notice.id);
  };

  return (
    <div
      role={notice.tone === 'danger' ? 'alert' : 'status'}
      aria-live={notice.tone === 'danger' ? 'assertive' : 'polite'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        'pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-2.5',
        'rounded border bg-surface-elevated p-2.5 shadow-lg',
        style.borderClass
      )}
    >
      <span className={cn('mt-0.5 shrink-0', style.iconClass)} aria-hidden="true">
        <Icon size={16} />
      </span>

      <p className="min-w-0 flex-1 break-words text-body text-text-primary">{notice.message}</p>

      <div className="flex shrink-0 items-center gap-1">
        {notice.action ? (
          <Button variant="secondary" size="sm" onClick={handleAction}>
            {notice.action.label}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Dismiss notification"
          onClick={() => onDismiss(notice.id)}
        >
          <IconX size={14} />
        </Button>
      </div>
    </div>
  );
}

/** Fixed, non-blocking overlay that renders the store's bounded notice queue. */
export function ToastRegion({ onAction }: ToastRegionProps) {
  const notices = useUiStore((state) => state.notices);
  const dismissNotice = useUiStore((state) => state.dismissNotice);
  const hostedByAncestor = useContext(ToastHostContext);

  // Escape dismisses the most recent notice.
  useEffect(() => {
    if (hostedByAncestor) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      const last = notices[notices.length - 1];
      if (last) {
        dismissNotice(last.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hostedByAncestor, notices, dismissNotice]);

  // An ancestor already renders the region; do not double-mount.
  if (hostedByAncestor || notices.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="toast-region"
      className="pointer-events-none fixed bottom-3 right-3 z-50 flex flex-col gap-2"
    >
      {notices.map((notice) => (
        <ToastItem
          key={notice.id}
          notice={notice}
          onDismiss={dismissNotice}
          {...(onAction ? { onAction } : {})}
        />
      ))}
    </div>
  );
}
