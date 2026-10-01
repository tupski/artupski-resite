/**
 * Scan store - Artupski ReSite
 *
 * Models the scan lifecycle defined in UI-SPEC section 4. Phase 1 held only
 * configuration/input state; Phase 4 (workstream 3) drives the real crawler:
 * `startScan()` delegates to `scanService` and mirrors the *real* crawl events
 * (`scanner.*`) into honest progress, discovered pages, and logs. It never
 * fabricates percentages or metrics - every counter comes from the frontier.
 */
import { create } from 'zustand';
import { eventBus, type AppEvent } from '../services/infra/eventBus';
import { runScan, cancelScan } from '../services/scanner/scanService';
import { useAuthStore } from './authStore';
import type { ScanLogEntry, ScanLogLevel, ScanProgress, ScanStatus } from '../types/scan';

/** Sliding window keeps memory bounded for the live console. */
const MAX_LOG_ENTRIES = 1000;
/** Bound on remembered discovered URLs (hard crawl cap is 200). */
const MAX_DISCOVERED = 1000;

export interface ScanConfiguration {
  maxDepth: number;
  maxPages: number;
  headless: boolean;
  /** Reserved for the responsive phase; not yet honored by the crawler. */
  viewports: {
    desktop: boolean;
    tablet: boolean;
    mobile: boolean;
  };
}

const EMPTY_PROGRESS: ScanProgress = {
  pagesScanned: 0,
  pagesDiscovered: 0,
  percentage: 0,
  currentUrl: null
};

export interface ScanState {
  targetUrl: string;
  /** Owning project for the next scan (resolved from the Projects view). */
  projectId: string | null;
  projectTitle: string;
  status: ScanStatus;
  scanId: string | null;
  progress: ScanProgress;
  logs: ScanLogEntry[];
  discoveredPages: string[];
  /** Honest, user-facing error for the current attempt (no raw stack traces). */
  error: { code: string; message: string; suggestedAction: string } | null;
  configuration: ScanConfiguration;
  setTargetUrl: (url: string) => void;
  setProjectId: (id: string | null) => void;
  setProjectTitle: (title: string) => void;
  setStatus: (status: ScanStatus) => void;
  updateConfiguration: (patch: Partial<ScanConfiguration>) => void;
  appendLog: (level: ScanLogLevel, message: string) => void;
  startScan: () => Promise<void>;
  cancelScan: () => Promise<void>;
  resetScan: () => void;
}

export const DEFAULT_SCAN_CONFIGURATION: ScanConfiguration = {
  maxDepth: 2,
  maxPages: 25,
  headless: true,
  viewports: {
    desktop: true,
    tablet: false,
    mobile: false
  }
};

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Statuses from which a new scan may start. */
function canStart(status: ScanStatus): boolean {
  return status !== 'scanning';
}

export const useScanStore = create<ScanState>((set, get) => ({
  targetUrl: '',
  projectId: null,
  projectTitle: '',
  status: 'idle',
  scanId: null,
  progress: EMPTY_PROGRESS,
  logs: [],
  discoveredPages: [],
  error: null,
  configuration: DEFAULT_SCAN_CONFIGURATION,

  setTargetUrl: (targetUrl) => set({ targetUrl }),
  setProjectId: (projectId) => set({ projectId }),
  setProjectTitle: (projectTitle) => set({ projectTitle }),
  setStatus: (status) => set({ status }),

  updateConfiguration: (patch) =>
    set((state) => ({
      configuration: {
        ...state.configuration,
        ...patch,
        viewports: {
          ...state.configuration.viewports,
          ...(patch.viewports ?? {})
        }
      }
    })),

  appendLog: (level, message) =>
    set((state) => ({
      logs: [
        ...state.logs.slice(-(MAX_LOG_ENTRIES - 1)),
        { id: createId(), timestamp: new Date().toISOString(), level, message }
      ]
    })),

  startScan: async () => {
    const { targetUrl, projectId, configuration, status } = get();
    if (!canStart(status)) {
      return;
    }
    if (!projectId) {
      set({
        status: 'configuring',
        error: {
          code: 'INVALID_URL',
          message: 'Select or create a project for this target before scanning.',
          suggestedAction: 'Open the Projects view, create a project for this URL, then scan it.'
        }
      });
      return;
    }

    const scanId = createId();
    const unsubscribers = subscribeToScan(scanId, set, get);
    set({
      status: 'scanning',
      scanId,
      error: null,
      logs: [],
      discoveredPages: [],
      progress: { ...EMPTY_PROGRESS }
    });
    get().appendLog('info', `Starting crawl of ${targetUrl}`);

    // Whether the user chose to scan with a captured session. The service
    // re-loads and injects the session (or fails cleanly if it is gone).
    const authenticated = useAuthStore.getState().mode === 'session';
    if (authenticated) {
      get().appendLog('info', 'Authenticated scan: injecting the stored session.');
    }

    try {
      const result = await runScan({
        scanId,
        projectId,
        seedUrl: targetUrl,
        limits: { maxDepth: configuration.maxDepth, maxPages: configuration.maxPages },
        headless: configuration.headless,
        authenticated
      });

      if (!result.ok) {
        // A pre-flight failure (no project, runtime unavailable, already
        // running): stay ready so the user can correct it and retry.
        set({ status: 'configuring', error: toUiError(result.error) });
        get().appendLog('error', result.error.message);
        return;
      }

      const outcome = result.data;
      // A failed authenticated scan is only "authenticated" factually: report
      // the auth-specific outcome distinctly. Never present an auth-walled or
      // blocked page as a successful authenticated result.
      if (outcome.pagesAuthRequired > 0 || outcome.pagesBlocked > 0) {
        get().appendLog(
          'warn',
          `Auth classification: ${outcome.pagesAuthRequired} page(s) required authentication, ` +
            `${outcome.pagesBlocked} page(s) blocked.`
        );
      }
      set((state) => ({
        status: outcome.status,
        error: outcome.error ? toUiError(outcome.error) : null,
        progress: {
          pagesScanned: outcome.pagesScanned,
          pagesDiscovered: outcome.pagesDiscovered,
          percentage: outcome.status === 'completed' ? 100 : state.progress.percentage,
          currentUrl: null
        }
      }));
      const authSuffix = outcome.authenticated ? ' (authenticated)' : '';
      const summary =
        outcome.status === 'completed'
          ? `Crawl complete${authSuffix}: ${outcome.pagesScanned} page(s) scanned` +
            (outcome.pageFailures > 0 ? `, ${outcome.pageFailures} failed` : '')
          : outcome.status === 'cancelled'
            ? `Crawl cancelled after ${outcome.pagesScanned} page(s)`
            : `Crawl failed${authSuffix}: ${outcome.error?.message ?? 'unknown error'}`;
      get().appendLog(outcome.status === 'failed' ? 'error' : 'info', summary);
    } finally {
      unsubscribers();
    }
  },

  cancelScan: async () => {
    const { scanId, status } = get();
    if (status !== 'scanning' || !scanId) {
      return;
    }
    get().appendLog('warn', 'Cancellation requested');
    await cancelScan(scanId);
  },

  resetScan: () =>
    set({
      status: 'idle',
      scanId: null,
      progress: EMPTY_PROGRESS,
      logs: [],
      discoveredPages: [],
      error: null
    })
}));

function toUiError(error: { code: string; message: string; suggestedAction: string }) {
  return { code: error.code, message: error.message, suggestedAction: error.suggestedAction };
}

/**
 * Mirror real crawler events for one scan into the store. Returns an
 * unsubscribe that detaches every listener (called in `finally`).
 */
function subscribeToScan(
  scanId: string,
  set: (partial: Partial<ScanState> | ((state: ScanState) => Partial<ScanState>)) => void,
  get: () => ScanState
): () => void {
  const matches = (event: AppEvent): boolean => {
    const payload = event.payload as { scanId?: string };
    return payload.scanId === scanId;
  };

  const unsubscribers = [
    eventBus.on('scanner.page_discovered', (event) => {
      if (!matches(event)) return;
      const payload = event.payload as { url: string };
      set((state) => ({
        discoveredPages: [...state.discoveredPages.slice(-(MAX_DISCOVERED - 1)), payload.url]
      }));
    }),

    eventBus.on('scanner.page_started', (event) => {
      if (!matches(event)) return;
      const payload = event.payload as { url: string };
      set((state) => ({ progress: { ...state.progress, currentUrl: payload.url } }));
    }),

    eventBus.on('scanner.page_loaded', (event) => {
      if (!matches(event)) return;
      const payload = event.payload as { url: string; statusCode: number | null; title: string };
      const title = payload.title.length > 0 ? ` "${payload.title}"` : '';
      get().appendLog('info', `Loaded ${payload.url}${title} [${payload.statusCode ?? '—'}]`);
    }),

    eventBus.on('scanner.page_failed', (event) => {
      if (!matches(event)) return;
      const payload = event.payload as { url: string; code: string; message: string };
      get().appendLog('warn', `Failed ${payload.url}: ${payload.message} (${payload.code})`);
    }),

    eventBus.on('scanner.progress', (event) => {
      if (!matches(event)) return;
      const payload = event.payload as {
        pagesScanned: number;
        pagesDiscovered: number;
        progressPercentage: number;
        currentUrl: string | null;
      };
      set({
        progress: {
          pagesScanned: payload.pagesScanned,
          pagesDiscovered: payload.pagesDiscovered,
          percentage: payload.progressPercentage,
          currentUrl: payload.currentUrl
        }
      });
    }),

    eventBus.on('scanner.failed', (event) => {
      if (!matches(event)) return;
      const payload = event.payload as { code: string; message: string };
      get().appendLog('error', `Crawl failed: ${payload.message} (${payload.code})`);
    })
  ];

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}
