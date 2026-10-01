/**
 * Scan lifecycle state machine - Artupski ReSite
 * Source of truth: docs/specs/SCANNER-SPEC.md section 4.1, docs/architecture/
 * ERROR-HANDLING.md section 4.1, and the persisted `ScanStatus` union
 * (`src/types/models.ts`).
 *
 * The persisted lifecycle is intentionally small and matches the `scans.status`
 * CHECK constraint from migration 001:
 *
 *   pending ──start──▶ in_progress ──┬─ success ─▶ completed
 *                                    ├─ partial failure ─▶ completed
 *                                    ├─ fatal failure ─▶ failed
 *                                    └─ cancel ─▶ cancelled
 *
 * Rules enforced here:
 *   - `completed` / `failed` / `cancelled` are terminal: no further transition.
 *   - a completed scan is never marked failed/cancelled, and vice versa.
 *   - re-entering `in_progress` from `pending` is the only "start" move.
 *
 * This module is pure (no I/O, no persistence) so the transition rules can be
 * unit-tested exhaustively and reused by the orchestrator before it writes.
 */
import type { ScanStatus } from '../../types/models';

export const TERMINAL_SCAN_STATUSES: readonly ScanStatus[] = ['completed', 'failed', 'cancelled'];

const TERMINAL = new Set<ScanStatus>(TERMINAL_SCAN_STATUSES);

/** Allowed transitions between persisted scan states. */
const TRANSITIONS: Record<ScanStatus, readonly ScanStatus[]> = {
  pending: ['in_progress', 'cancelled', 'failed'],
  in_progress: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: []
};

export function isTerminalScanStatus(status: ScanStatus): boolean {
  return TERMINAL.has(status);
}

export function canTransition(from: ScanStatus, to: ScanStatus): boolean {
  if (from === to) {
    return true;
  }
  return TRANSITIONS[from].includes(to);
}

/**
 * Throwing guard for the orchestrator. Returns `to` when the transition is
 * legal; throws otherwise so an illegal write can never reach the database.
 */
export function assertTransition(from: ScanStatus, to: ScanStatus): ScanStatus {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal scan status transition: ${from} -> ${to}.`);
  }
  return to;
}
