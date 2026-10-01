import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, isTerminalScanStatus, TERMINAL_SCAN_STATUSES } from './lifecycle';
import type { ScanStatus } from '../../types/models';

describe('scan lifecycle state machine', () => {
  it('allows the documented forward transitions', () => {
    expect(canTransition('pending', 'in_progress')).toBe(true);
    expect(canTransition('pending', 'cancelled')).toBe(true);
    expect(canTransition('pending', 'failed')).toBe(true);
    expect(canTransition('in_progress', 'completed')).toBe(true);
    expect(canTransition('in_progress', 'failed')).toBe(true);
    expect(canTransition('in_progress', 'cancelled')).toBe(true);
  });

  it('treats completed/failed/cancelled as terminal', () => {
    for (const status of TERMINAL_SCAN_STATUSES) {
      expect(isTerminalScanStatus(status)).toBe(true);
      // No transition out of a terminal state (self no-ops excepted).
      for (const target of TERMINAL_SCAN_STATUSES) {
        if (target !== status) {
          expect(canTransition(status, target)).toBe(false);
        }
      }
      expect(canTransition(status, 'in_progress')).toBe(false);
    }
    expect(isTerminalScanStatus('pending')).toBe(false);
    expect(isTerminalScanStatus('in_progress')).toBe(false);
  });

  it('never moves a terminal scan to a different terminal state', () => {
    expect(canTransition('completed', 'failed')).toBe(false);
    expect(canTransition('failed', 'cancelled')).toBe(false);
    expect(canTransition('cancelled', 'completed')).toBe(false);
  });

  it('allows a no-op self transition (idempotent write)', () => {
    expect(canTransition('in_progress', 'in_progress')).toBe(true);
  });

  it('assertTransition returns the target for legal moves and throws otherwise', () => {
    expect(assertTransition('pending', 'in_progress')).toBe('in_progress');
    expect(() => assertTransition('completed', 'failed')).toThrow(/Illegal scan status transition/);
  });

  it('covers every persisted status without a missing rule', () => {
    const all: ScanStatus[] = ['pending', 'in_progress', 'completed', 'failed', 'cancelled'];
    for (const from of all) {
      for (const to of all) {
        expect(typeof canTransition(from, to)).toBe('boolean');
      }
    }
  });
});
