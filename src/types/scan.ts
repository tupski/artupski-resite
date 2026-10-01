/**
 * Scan lifecycle types - Artupski ReSite
 *
 * UI-SPEC section 4 defines the lifecycle. Phase 1 modelled the states without
 * implementing any scanner behavior. Phase 4 (workstream 3) wires the store and
 * route to the real crawler service, so the UI lifecycle now mirrors the crawl
 * outcome the service actually reports (see `CrawlTerminalStatus`).
 */

export type ScanStatus =
  | 'idle'
  | 'configuring'
  | 'scanning'
  | 'completed'
  | 'failed'
  | 'cancelled';

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
  configuring: 'Ready',
  scanning: 'Scanning',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/**
 * Progress derived from real crawl counters (never fabricated). `percentage`
 * is the crawl service's own coalesced percentage (0..100); `pagesScanned` /
 * `pagesDiscovered` come from the frontier. `currentUrl` is the page whose
 * extraction is in flight, when known.
 */
export interface ScanProgress {
  pagesScanned: number;
  pagesDiscovered: number;
  percentage: number;
  currentUrl: string | null;
}
