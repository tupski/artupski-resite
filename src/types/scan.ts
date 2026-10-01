/**
 * Scan lifecycle types - Artupski ReSite
 *
 * UI-SPEC section 4 defines the lifecycle. Phase 1 models the states without
 * implementing any scanner behavior (see docs/product/PLAN.md Phase 2+).
 */

export type ScanStatus =
  | 'idle'
  | 'configuring'
  | 'scanning'
  | 'auth_required'
  | 'completed'
  | 'failed';

export type ScanLogLevel = 'info' | 'warn' | 'error';

export interface ScanLogEntry {
  id: string;
  timestamp: string;
  level: ScanLogLevel;
  message: string;
}

/** Human-readable labels for lifecycle states, used by the UI. */
export const SCAN_STATUS_LABEL: Record<ScanStatus, string> = {
  idle: 'Idle',
  configuring: 'Configuring',
  scanning: 'Scanning',
  auth_required: 'Auth required',
  completed: 'Completed',
  failed: 'Failed',
};
