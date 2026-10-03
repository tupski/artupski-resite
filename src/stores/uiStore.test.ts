import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_NOTICES, useUiStore } from './uiStore';
import { createStructuredError } from '../services/infra/errors';

describe('uiStore', () => {
  beforeEach(() => {
    useUiStore.setState({ sidebarExpanded: true, notices: [] });
  });

  it('toggles the sidebar', () => {
    expect(useUiStore.getState().sidebarExpanded).toBe(true);
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarExpanded).toBe(false);
  });

  it('adds and dismisses notices', () => {
    useUiStore.getState().pushNotice({ tone: 'info', message: 'hello' });
    const [notice] = useUiStore.getState().notices;
    expect(notice?.message).toBe('hello');
    expect(notice?.id).toBeTruthy();

    useUiStore.getState().dismissNotice(notice!.id);
    expect(useUiStore.getState().notices).toHaveLength(0);
  });

  it('preserves an action and durationMs on a pushed notice', () => {
    useUiStore.getState().pushNotice({
      tone: 'warning',
      message: 'worker stopped',
      action: { label: 'Try again', kind: 'retry' },
      durationMs: 0
    });
    const [notice] = useUiStore.getState().notices;
    expect(notice?.action).toEqual({ label: 'Try again', kind: 'retry' });
    expect(notice?.durationMs).toBe(0);
  });

  it('bounds the queue at MAX_NOTICES, dropping the oldest', () => {
    for (let i = 0; i < MAX_NOTICES + 3; i += 1) {
      useUiStore.getState().pushNotice({ tone: 'info', message: `notice-${i}` });
    }
    const notices = useUiStore.getState().notices;
    expect(notices).toHaveLength(MAX_NOTICES);
    expect(notices[0]?.message).toBe('notice-3');
    expect(notices[notices.length - 1]?.message).toBe(`notice-${MAX_NOTICES + 2}`);
  });

  it('maps an IO/secret StructuredError to a sticky danger notice with a settings action', () => {
    useUiStore.getState().pushErrorNotice(
      createStructuredError({
        code: 'SECRET_STORAGE_UNAVAILABLE',
        category: 'io',
        message: 'The OS credential store is unavailable.'
      })
    );
    const [notice] = useUiStore.getState().notices;
    expect(notice?.tone).toBe('danger');
    expect(notice?.message).toContain('credential store');
    expect(notice?.action).toEqual({ label: 'Open settings', kind: 'settings' });
    expect(notice?.durationMs).toBe(0);
  });

  it('maps a retryable process error to a retry action', () => {
    useUiStore.getState().pushErrorNotice(
      createStructuredError({
        code: 'PROCESS_TIMEOUT',
        category: 'process',
        message: 'Worker timed out.',
        retryable: true
      })
    );
    const [notice] = useUiStore.getState().notices;
    expect(notice?.tone).toBe('danger');
    expect(notice?.action).toEqual({ label: 'Try again', kind: 'retry' });
  });

  it('maps a non-retryable error to a reload action', () => {
    useUiStore.getState().pushErrorNotice(
      createStructuredError({
        code: 'UNKNOWN_ERROR',
        category: 'process',
        message: 'Something failed.'
      })
    );
    const [notice] = useUiStore.getState().notices;
    expect(notice?.action).toEqual({ label: 'Reload application', kind: 'reload' });
  });
});
