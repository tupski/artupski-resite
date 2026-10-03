import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startErrorBridge } from './errorBridge';
import { createEvent, eventBus } from '../../services/infra/eventBus';
import { useUiStore } from '../../stores/uiStore';

describe('errorBridge', () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    useUiStore.setState({ notices: [] });
  });

  afterEach(() => {
    stop?.();
    stop = null;
    eventBus.clear();
  });

  it('pushes a danger toast when a process fails', () => {
    stop = startErrorBridge();

    eventBus.emit(
      createEvent('process.failed', {
        processName: 'crawler',
        code: 'PROCESS_EXITED_UNEXPECTEDLY',
        message: 'Worker "crawler" exited unexpectedly.'
      })
    );

    const [notice] = useUiStore.getState().notices;
    expect(notice?.tone).toBe('danger');
    expect(notice?.message).toContain('exited unexpectedly');
    expect(notice?.action).toBeDefined();
  });

  it('pushes a warning toast for an unexpected process exit', () => {
    stop = startErrorBridge();

    eventBus.emit(
      createEvent('process.exited', {
        processName: 'crawler',
        pid: 42,
        code: 1,
        signal: null,
        unexpected: true
      })
    );

    const [notice] = useUiStore.getState().notices;
    expect(notice?.tone).toBe('warning');
    expect(notice?.message).toContain('crawler');
    expect(notice?.action).toEqual({ label: 'Try again', kind: 'retry' });
  });

  it('ignores a managed (expected) process exit', () => {
    stop = startErrorBridge();

    eventBus.emit(
      createEvent('process.exited', {
        processName: 'crawler',
        pid: 42,
        code: 0,
        signal: null,
        unexpected: false
      })
    );

    expect(useUiStore.getState().notices).toHaveLength(0);
  });

  it('handles a global error event without rethrowing and scrubs the message', () => {
    stop = startErrorBridge();

    const error = new Error('boom sk-abcdef123456');
    expect(() => {
      window.dispatchEvent(
        new ErrorEvent('error', { error, message: error.message, cancelable: true })
      );
    }).not.toThrow();

    const [notice] = useUiStore.getState().notices;
    expect(notice?.tone).toBe('danger');
    expect(notice?.message).toContain('[redacted]');
    expect(notice?.message).not.toContain('sk-abcdef123456');
    expect(notice?.action).toEqual({ label: 'Reload application', kind: 'reload' });
  });

  it('handles an unhandled rejection and marks it handled', () => {
    stop = startErrorBridge();

    const event = new Event('unhandledrejection', { cancelable: true }) as Event & {
      reason?: unknown;
    };
    event.reason = new Error('background failure');

    window.dispatchEvent(event);

    const [notice] = useUiStore.getState().notices;
    expect(notice?.tone).toBe('danger');
    expect(notice?.message).toContain('background failure');
    expect(event.defaultPrevented).toBe(true);
  });

  it('is idempotent: repeated start does not double-register listeners', () => {
    const stopFirst = startErrorBridge();
    const stopSecond = startErrorBridge();
    expect(stopSecond).toBe(stopFirst);
    expect(eventBus.listenerCount('process.failed')).toBe(1);
    expect(eventBus.listenerCount('process.exited')).toBe(1);

    stop = stopFirst;
  });

  it('cleanup removes listeners and allows a fresh start', () => {
    const stopFirst = startErrorBridge();
    stopFirst();
    expect(eventBus.listenerCount('process.failed')).toBe(0);

    // A new bridge can be started after cleanup.
    stop = startErrorBridge();
    expect(eventBus.listenerCount('process.failed')).toBe(1);
  });
});
