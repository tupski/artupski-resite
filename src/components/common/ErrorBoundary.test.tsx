import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from './ErrorBoundary';

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('sk-abcdef123456 leaked boom');
  }
  return <p>recovered content</p>;
}

describe('ErrorBoundary', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React logs the caught error to console.error; keep the test output quiet.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the fallback when a child throws, without exposing a stack', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
    // The scrubbed message is shown; the raw provider-style key is not.
    expect(alert).not.toHaveTextContent('sk-abcdef123456');
    expect(alert).toHaveTextContent('[redacted]');
    // No stack trace is rendered as UI text.
    expect(alert.textContent ?? '').not.toContain('at Bomb');
  });

  it('moves focus to the fallback heading', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toHaveFocus();
  });

  it('calls onError with a scrubbed message', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0].message).toContain('[redacted]');
    expect(onError.mock.calls[0]?.[0].message).not.toContain('sk-abcdef123456');
  });

  it('resets the boundary when "Try again" is clicked', async () => {
    const user = userEvent.setup();
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) {
        throw new Error('transient boom');
      }
      return <p>recovered content</p>;
    }

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // The underlying fault clears; "Try again" resets the boundary subtree and
    // the child renders without an app reload.
    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('recovered content')).toBeInTheDocument();
  });

  it('renders a custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={({ reset }) => <button onClick={reset}>custom reset</button>}>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByRole('button', { name: 'custom reset' })).toBeInTheDocument();
  });
});
