import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ToastRegion } from './ToastRegion';
import { MAX_NOTICES, useUiStore } from '../../stores/uiStore';

describe('ToastRegion', () => {
  beforeEach(() => {
    useUiStore.setState({ notices: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when there are no notices', () => {
    const { container } = render(<ToastRegion />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders notices with a polite live region for non-danger tones', () => {
    useUiStore.getState().pushNotice({ tone: 'info', message: 'All good' });
    render(<ToastRegion />);

    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('All good');
    expect(toast).toHaveAttribute('aria-live', 'polite');
  });

  it('renders danger notices as an assertive alert', () => {
    useUiStore.getState().pushNotice({ tone: 'danger', message: 'It broke', durationMs: 0 });
    render(<ToastRegion />);

    const toast = screen.getByRole('alert');
    expect(toast).toHaveTextContent('It broke');
    expect(toast).toHaveAttribute('aria-live', 'assertive');
  });

  it('dismisses a notice via its dismiss button', () => {
    useUiStore.getState().pushNotice({ tone: 'info', message: 'dismiss me' });
    render(<ToastRegion />);

    fireEvent.click(screen.getByRole('button', { name: /dismiss notification/i }));
    expect(useUiStore.getState().notices).toHaveLength(0);
    expect(screen.queryByText('dismiss me')).not.toBeInTheDocument();
  });

  it('invokes the provided action handler', () => {
    const onAction = vi.fn();
    useUiStore
      .getState()
      .pushNotice({ tone: 'danger', message: 'retry me', action: { label: 'Try again', kind: 'retry' } });
    render(<ToastRegion onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]?.[0].message).toBe('retry me');
  });

  it('auto-dismisses a non-actionable notice after its duration', () => {
    vi.useFakeTimers();
    useUiStore.getState().pushNotice({ tone: 'info', message: 'ephemeral', durationMs: 1000 });
    render(<ToastRegion />);
    expect(screen.getByText('ephemeral')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1001);
    });

    expect(useUiStore.getState().notices).toHaveLength(0);
  });

  it('keeps actionable notices sticky by default', () => {
    vi.useFakeTimers();
    useUiStore
      .getState()
      .pushNotice({ tone: 'danger', message: 'sticky', action: { label: 'Try again', kind: 'retry' } });
    render(<ToastRegion />);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText('sticky')).toBeInTheDocument();
  });

  it('dismisses the most recent notice on Escape', () => {
    useUiStore.getState().pushNotice({ tone: 'info', message: 'first' });
    useUiStore.getState().pushNotice({ tone: 'info', message: 'second' });
    render(<ToastRegion />);

    fireEvent.keyDown(window, { key: 'Escape' });

    const notices = useUiStore.getState().notices;
    expect(notices).toHaveLength(1);
    expect(notices[0]?.message).toBe('first');
  });

  it('renders at most MAX_NOTICES toasts (bounded stack)', () => {
    for (let i = 0; i < MAX_NOTICES + 4; i += 1) {
      useUiStore.getState().pushNotice({ tone: 'info', message: `toast-${i}` });
    }
    render(<ToastRegion />);

    expect(screen.getAllByRole('status')).toHaveLength(MAX_NOTICES);
    expect(screen.queryByText('toast-0')).not.toBeInTheDocument();
  });
});
