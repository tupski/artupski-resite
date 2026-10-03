/**
 * Global error boundary - Artupski ReSite
 * Source of truth: docs/impl-plan/phase-15-impl-plan.md sections 5 (S4), 8.5, 11 and 13.
 *
 * React 18 has no hook equivalent for `componentDidCatch`, so this is a class
 * component (C5, no new dependency). It renders an honest, compact recovery
 * panel: the scrubbed message is shown, the raw `error.stack` never is, and
 * three recovery actions are offered. Focus moves to the panel heading on catch
 * and the region is announced as an alert.
 */
import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { IconAlert } from '../ui/icons';
import { scrubErrorMessage } from './errorBridge';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback; the default is the honest recovery panel. */
  fallback?: (state: { error: Error; reset: () => void }) => ReactNode;
  /** Called with a scrubbed error description (never a secret). */
  onError?: (info: { message: string; code?: string }) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  private readonly headingRef = createRef<HTMLHeadingElement>();

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The stack is logged (scrubbed sink) but never rendered as UI text.
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.props.onError?.({ message: scrubErrorMessage(error.message) });
    // Move focus to the panel heading so assistive tech lands on the alert.
    this.headingRef.current?.focus();
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  private reload = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  private copyDetails = (): void => {
    const error = this.state.error;
    const details = error
      ? `Message: ${scrubErrorMessage(error.message)}\nName: ${error.name}`
      : 'No error details available.';
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(details).catch(() => undefined);
    }
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback({ error, reset: this.reset });
    }

    return (
      <div
        role="alert"
        className="flex min-h-[50vh] w-full items-center justify-center p-6"
      >
        <div className="w-full max-w-md rounded border border-border-subtle bg-surface p-4">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 text-danger" aria-hidden="true">
              <IconAlert size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <h2
                ref={this.headingRef}
                tabIndex={-1}
                className="text-heading text-text-primary focus-visible:outline-none"
              >
                Something went wrong
              </h2>
              <p className="mt-1 break-words text-body text-text-secondary">
                {scrubErrorMessage(error.message)}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={this.reset}>
              Try again
            </Button>
            <Button variant="secondary" size="sm" onClick={this.reload}>
              Reload application
            </Button>
            <Button variant="ghost" size="sm" onClick={this.copyDetails}>
              Copy error details
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
