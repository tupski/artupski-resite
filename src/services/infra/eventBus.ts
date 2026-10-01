/**
 * EventBus foundation - Artupski ReSite
 * Source of truth: docs/architecture/EVENT-SYSTEM.md.
 *
 * Phase 1 establishes the type-safe pub/sub infrastructure and the event
 * taxonomy. The feature domains (scanner, technology, blueprint, clone,
 * project, ...) are declared here as the contract future engines will emit
 * against - they are intentionally NOT implemented in this phase.
 */

export type EventDomain =
  | 'scanner'
  | 'technology'
  | 'asset'
  | 'responsive'
  | 'auth'
  | 'blueprint'
  | 'clone'
  | 'project'
  | 'storage'
  | 'process'
  | 'browser'
  | 'app';

/** Canonical event keys, following the `<domain>.<action_or_state>` taxonomy. */
export type AppEventType =
  | 'app.started'
  | 'app.theme_changed'
  | 'storage.initializing'
  | 'storage.ready'
  | 'storage.migration_started'
  | 'storage.migration_completed'
  | 'storage.migration_failed'
  | 'scanner.started'
  | 'scanner.browser_started'
  | 'scanner.navigation_started'
  | 'scanner.page_discovered'
  | 'scanner.page_started'
  | 'scanner.page_loaded'
  | 'scanner.page_failed'
  | 'scanner.progress'
  | 'scanner.cancelled'
  | 'scanner.completed'
  | 'scanner.failed'
  | 'technology.scan_started'
  | 'technology.detected'
  | 'technology.scan_completed'
  | 'asset.download_started'
  | 'asset.downloaded'
  | 'responsive.viewport_captured'
  | 'auth.required'
  | 'auth.completed'
  | 'auth.failed'
  | 'blueprint.started'
  | 'blueprint.generated'
  | 'blueprint.validation_failed'
  | 'blueprint.completed'
  | 'clone.started'
  | 'clone.file_generated'
  | 'clone.completed'
  | 'project.started'
  | 'project.file_generated'
  | 'project.completed'
  | 'process.spawning'
  | 'process.ready'
  | 'process.busy'
  | 'process.stopping'
  | 'process.stopped'
  | 'process.exited'
  | 'process.failed'
  | 'browser.detection_started'
  | 'browser.detected'
  | 'browser.missing'
  | 'browser.session_started'
  | 'browser.session_closed';

/** Base envelope carried by every event (EVENT-SYSTEM.md section 3). */
export interface BaseEventPayload {
  eventId: string;
  timestamp: string;
  domain: EventDomain;
  projectId?: string;
}

export interface AppStartedPayload extends BaseEventPayload {
  domain: 'app';
  version: string;
}

export interface ThemeChangedPayload extends BaseEventPayload {
  domain: 'app';
  theme: string;
  resolved: 'light' | 'dark';
}

export interface StorageInitializingPayload extends BaseEventPayload {
  domain: 'storage';
}

export interface StorageReadyPayload extends BaseEventPayload {
  domain: 'storage';
  databaseLocation: string;
  appliedMigrations: number[];
}

export interface StorageMigrationStartedPayload extends BaseEventPayload {
  domain: 'storage';
  version: number;
  name: string;
}

export interface StorageMigrationCompletedPayload extends BaseEventPayload {
  domain: 'storage';
  version: number;
  name: string;
  appliedCount: number;
}

export interface StorageMigrationFailedPayload extends BaseEventPayload {
  domain: 'storage';
  version: number | null;
  code: string;
  message: string;
}

/** ProcessManager lifecycle payloads (Phase 3). */
export interface ProcessLifecyclePayload extends BaseEventPayload {
  domain: 'process';
  /** Logical name of the managed process (e.g. "crawler"). */
  processName: string;
  /** OS process id once spawned; absent before the handle exists. */
  pid?: number;
}

export interface ProcessExitedPayload extends BaseEventPayload {
  domain: 'process';
  processName: string;
  pid?: number;
  code: number | null;
  /** Numeric signal number on Unix; always `null` on Windows. */
  signal: number | null;
  /** True when the exit was not initiated by a managed shutdown. */
  unexpected: boolean;
}

export interface ProcessFailedPayload extends BaseEventPayload {
  domain: 'process';
  processName: string;
  code: string;
  message: string;
}

/** Browser runtime payloads (Phase 3). */
export interface BrowserDetectedPayload extends BaseEventPayload {
  domain: 'browser';
  engine: string;
  installed: boolean;
  version?: string;
  executablePath?: string;
}

export interface BrowserMissingPayload extends BaseEventPayload {
  domain: 'browser';
  engine: string;
  code: string;
  message: string;
}

export interface BrowserSessionPayload extends BaseEventPayload {
  domain: 'browser';
  engine: string;
  sessionId: string;
}

/** Scanner (crawler) payloads (Phase 4). */
export interface ScannerStartedPayload extends BaseEventPayload {
  domain: 'scanner';
  scanId: string;
  seedUrl: string;
  maxDepth: number;
  maxPages: number;
}

export interface ScannerPageDiscoveredPayload extends BaseEventPayload {
  domain: 'scanner';
  scanId: string;
  url: string;
  depth: number;
}

export interface ScannerPageLoadedPayload extends BaseEventPayload {
  domain: 'scanner';
  scanId: string;
  url: string;
  statusCode: number | null;
  title: string;
  depth: number;
}

export interface ScannerPageStartedPayload extends BaseEventPayload {
  domain: 'scanner';
  scanId: string;
  url: string;
  depth: number;
}

/** A single page failed but the crawl continues (recoverable page-level error). */
export interface ScannerPageFailedPayload extends BaseEventPayload {
  domain: 'scanner';
  scanId: string;
  url: string;
  code: string;
  message: string;
}

/**
 * Coalesced crawl progress. Emitted at a bounded cadence (see the crawler
 * service), never once per DOM node, so the UI is not flooded.
 */
export interface ScannerProgressPayload extends BaseEventPayload {
  domain: 'scanner';
  scanId: string;
  pagesScanned: number;
  pagesDiscovered: number;
  /** 0..100, derived from scanned/max pages. */
  progressPercentage: number;
  currentUrl: string | null;
}

export interface ScannerCompletedPayload extends BaseEventPayload {
  domain: 'scanner';
  scanId: string;
  pagesScanned: number;
  pagesDiscovered: number;
}

export interface ScannerCancelledPayload extends BaseEventPayload {
  domain: 'scanner';
  scanId: string;
  pagesScanned: number;
  pagesDiscovered: number;
}

export interface ScannerFailedPayload extends BaseEventPayload {
  domain: 'scanner';
  scanId: string;
  url: string;
  code: string;
  message: string;
}

/** Technology detection payloads (Phase 5). */
export interface TechnologyScanStartedPayload extends BaseEventPayload {
  domain: 'technology';
  scanId: string;
  pagesConsidered: number;
}

export interface TechnologyDetectedPayload extends BaseEventPayload {
  domain: 'technology';
  scanId: string;
  technologyId: string;
  name: string;
  category: string;
  confidence: number;
  confidenceStatus: string;
  version: string | null;
}

export interface TechnologyScanCompletedPayload extends BaseEventPayload {
  domain: 'technology';
  scanId: string;
  detectedCount: number;
  pagesWithEvidence: number;
  /** True when the caller should warn that capture was incomplete. */
  partial: boolean;
}

/** Payload map: ties each event key to a concrete, structured payload. */
export interface AppEventPayloadMap {
  'app.started': AppStartedPayload;
  'app.theme_changed': ThemeChangedPayload;
  'storage.initializing': StorageInitializingPayload;
  'storage.ready': StorageReadyPayload;
  'storage.migration_started': StorageMigrationStartedPayload;
  'storage.migration_completed': StorageMigrationCompletedPayload;
  'storage.migration_failed': StorageMigrationFailedPayload;
  'process.spawning': ProcessLifecyclePayload;
  'process.ready': ProcessLifecyclePayload;
  'process.busy': ProcessLifecyclePayload;
  'process.stopping': ProcessLifecyclePayload;
  'process.stopped': ProcessLifecyclePayload;
  'process.exited': ProcessExitedPayload;
  'process.failed': ProcessFailedPayload;
  'browser.detection_started': BrowserDetectedPayload;
  'browser.detected': BrowserDetectedPayload;
  'browser.missing': BrowserMissingPayload;
  'browser.session_started': BrowserSessionPayload;
  'browser.session_closed': BrowserSessionPayload;
  'scanner.started': ScannerStartedPayload;
  'scanner.page_discovered': ScannerPageDiscoveredPayload;
  'scanner.page_started': ScannerPageStartedPayload;
  'scanner.page_loaded': ScannerPageLoadedPayload;
  'scanner.page_failed': ScannerPageFailedPayload;
  'scanner.progress': ScannerProgressPayload;
  'scanner.cancelled': ScannerCancelledPayload;
  'scanner.completed': ScannerCompletedPayload;
  'scanner.failed': ScannerFailedPayload;
  'technology.scan_started': TechnologyScanStartedPayload;
  'technology.detected': TechnologyDetectedPayload;
  'technology.scan_completed': TechnologyScanCompletedPayload;
  // Future feature domains are reserved in the taxonomy but carry no payload
  // contract until their engines exist (see docs/product/PLAN.md Phase 2+).
  [key: string]: BaseEventPayload;
}

export type AppEvent<T extends AppEventType = AppEventType> = {
  type: T;
  payload: AppEventPayloadMap[T];
};

export type EventListener<T extends AppEventType = AppEventType> = (event: AppEvent<T>) => void;

/** Minimal runtime validation for payloads crossing IPC boundaries. */
export function isBaseEventPayload(value: unknown): value is BaseEventPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.eventId === 'string' &&
    typeof candidate.timestamp === 'string' &&
    typeof candidate.domain === 'string'
  );
}

function createEventId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Build a well-formed event, filling the required envelope fields. */
export function createEvent<T extends AppEventType>(
  type: T,
  payload: Omit<AppEventPayloadMap[T], keyof BaseEventPayload> & Partial<BaseEventPayload>
): AppEvent<T> {
  const domain = type.split('.')[0] as EventDomain;
  return {
    type,
    payload: {
      eventId: createEventId(),
      timestamp: new Date().toISOString(),
      domain,
      ...payload,
    } as AppEventPayloadMap[T],
  };
}

/**
 * Type-safe publish/subscribe bus.
 *
 * Subscribe handlers are keyed by event type so consumers cannot accidentally
 * receive unrelated events. `emit` rejects payloads that lack the base
 * envelope, keeping the bus from degrading into an untyped string dump.
 */
export class EventBus {
  private readonly listeners = new Map<AppEventType, Set<EventListener>>();

  on<T extends AppEventType>(type: T, listener: EventListener<T>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as EventListener);
    return () => this.off(type, listener);
  }

  once<T extends AppEventType>(type: T, listener: EventListener<T>): () => void {
    const unsubscribe = this.on(type, (event) => {
      unsubscribe();
      listener(event);
    });
    return unsubscribe;
  }

  off<T extends AppEventType>(type: T, listener: EventListener<T>): void {
    const set = this.listeners.get(type);
    if (!set) {
      return;
    }
    set.delete(listener as EventListener);
    if (set.size === 0) {
      this.listeners.delete(type);
    }
  }

  emit<T extends AppEventType>(event: AppEvent<T>): void {
    if (!isBaseEventPayload(event.payload)) {
      throw new Error(`Refusing to emit malformed event "${event.type}" payload.`);
    }
    const set = this.listeners.get(event.type);
    if (!set) {
      return;
    }
    for (const listener of [...set]) {
      listener(event);
    }
  }

  listenerCount(type?: AppEventType): number {
    if (type) {
      return this.listeners.get(type)?.size ?? 0;
    }
    let total = 0;
    for (const set of this.listeners.values()) {
      total += set.size;
    }
    return total;
  }

  /** Remove listeners; pass a type to clear only that channel. */
  clear(type?: AppEventType): void {
    if (type) {
      this.listeners.delete(type);
    } else {
      this.listeners.clear();
    }
  }
}

/** Shared application event bus. */
export const eventBus = new EventBus();
