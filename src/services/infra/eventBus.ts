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
  | 'component'
  | 'project'
  | 'diff'
  | 'ai'
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
  | 'auth.session_cleared'
  | 'auth.session_expired'
  | 'auth.scan_started'
  | 'blueprint.started'
  | 'blueprint.generated'
  | 'blueprint.validation_failed'
  | 'blueprint.completed'
  | 'clone.started'
  | 'clone.file_generated'
  | 'clone.asset_downloaded'
  | 'clone.server_started'
  | 'clone.server_stopped'
  | 'clone.completed'
  | 'clone.failed'
  | 'component.started'
  | 'component.generated'
  | 'component.failed'
  | 'component.completed'
  | 'project.started'
  | 'project.file_generated'
  | 'project.completed'
  | 'diff.started'
  | 'diff.captured'
  | 'diff.computed'
  | 'diff.completed'
  | 'diff.failed'
  | 'ai.config_saved'
  | 'ai.connection_started'
  | 'ai.connection_verified'
  | 'ai.connection_failed'
  | 'ai.generation_started'
  | 'ai.generation_completed'
  | 'ai.generation_failed'
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
  | 'browser.session_closed'
  | 'browser.capture_opened'
  | 'browser.capture_closed'
  | 'responsive.captured';

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

/** Authentication session payloads (Phase 5 - authenticated scanning). */
export interface AuthCompletedPayload extends BaseEventPayload {
  domain: 'auth';
  /** Target domain the session was captured for (never a secret). */
  targetDomain?: string;
  cookieCount: number;
  originCount: number;
}

export interface AuthFailedPayload extends BaseEventPayload {
  domain: 'auth';
  code: string;
  message: string;
}

export interface AuthSessionClearedPayload extends BaseEventPayload {
  domain: 'auth';
  removed: number;
}

export interface AuthScanStartedPayload extends BaseEventPayload {
  domain: 'auth';
  scanId: string;
  /** True when a captured session was injected for this scan. */
  authenticated: boolean;
}

/**
 * Blueprint lifecycle payloads (Phase 9). They carry ids, counts, validity, and
 * bounded validation messages only - never document bytes, credentials, or any
 * other secret. Emitted `blueprint.started` -> (`blueprint.generated` |
 * `blueprint.validation_failed`) -> `blueprint.completed`.
 */
export interface BlueprintStartedPayload extends BaseEventPayload {
  domain: 'blueprint';
  scanId: string;
  /** Seed/target URL the Blueprint is being synthesized for (never a secret). */
  sourceUrl?: string;
  /** Completed pages considered for synthesis (0 before synthesis resolves). */
  pagesConsidered?: number;
}

export interface BlueprintGeneratedPayload extends BaseEventPayload {
  domain: 'blueprint';
  scanId: string;
  blueprintId: string;
  /** Document revision (`blueprints.version`). */
  version: number;
  schemaVersion: number;
  /** Always true on the `generated` event (invalid docs use validation_failed). */
  isValid: boolean;
  pageCount: number;
  componentCount: number;
}

export interface BlueprintValidationFailedPayload extends BaseEventPayload {
  domain: 'blueprint';
  scanId: string;
  /** Present when a document was assembled and persisted; absent otherwise. */
  blueprintId?: string;
  schemaVersion: number;
  errorCount: number;
  /** Bounded `path: message` strings; never document content. */
  errors: string[];
}

export interface BlueprintCompletedPayload extends BaseEventPayload {
  domain: 'blueprint';
  scanId: string;
  blueprintId?: string;
  version: number;
  isValid: boolean;
  /** True when evidence was skipped/truncated or synthesis failed entirely. */
  partial: boolean;
  skippedPages: number;
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

/** Responsive viewport capture completed (Phase 7). */
export interface ResponsiveCapturedPayload extends BaseEventPayload {
  domain: 'responsive';
  scanId: string;
  captured: number;
  skipped: number;
  profiles: string[];
}

export interface TechnologyScanCompletedPayload extends BaseEventPayload {
  domain: 'technology';
  scanId: string;
  detectedCount: number;
  pagesWithEvidence: number;
  /** True when the caller should warn that capture was incomplete. */
  partial: boolean;
}

/** Static clone lifecycle (Phase 8). Counts/paths only - never file contents. */
export interface CloneStartedPayload extends BaseEventPayload {
  domain: 'clone';
  scanId: string;
  pageCount: number;
}

export interface CloneFileGeneratedPayload extends BaseEventPayload {
  domain: 'clone';
  scanId: string;
  /** Local clone-tree path (never an absolute host path). */
  file: string;
}

export interface CloneAssetDownloadedPayload extends BaseEventPayload {
  domain: 'clone';
  scanId: string;
  /** Root-relative clone path of the written asset. */
  localPath: string;
  /** Content hash - safe, non-secret. */
  sha256: string;
  sizeBytes: number;
}

export interface CloneServerPayload extends BaseEventPayload {
  domain: 'clone';
  /** Loopback preview URL (present when started). */
  url?: string;
}

export interface CloneCompletedPayload extends BaseEventPayload {
  domain: 'clone';
  scanId: string;
  generatedPages: number;
  skippedPages: number;
  assetsWritten: number;
  assetsSkipped: number;
  /** True when some pages/assets could not be captured. */
  partial: boolean;
}

export interface CloneFailedPayload extends BaseEventPayload {
  domain: 'clone';
  scanId: string | null;
  code: string;
  message: string;
}

/**
 * AI engine lifecycle payloads (Phase 10). They carry provider id, model, and
 * counts only - NEVER the API key, request headers, or prompt/completion content.
 */
export interface AiConfigSavedPayload extends BaseEventPayload {
  domain: 'ai';
  providerId: string;
  /** True when a non-empty API key is currently stored (never the key itself). */
  hasApiKey: boolean;
  /** Model id only; the base URL is omitted to avoid leaking internal origins. */
  model: string;
}

export interface AiConnectionStartedPayload extends BaseEventPayload {
  domain: 'ai';
  providerId: string;
}

export interface AiConnectionVerifiedPayload extends BaseEventPayload {
  domain: 'ai';
  providerId: string;
  modelCount: number;
}

export interface AiConnectionFailedPayload extends BaseEventPayload {
  domain: 'ai';
  providerId: string;
  code: string;
  /** Bounded, redacted message (never a key or request header). */
  message: string;
}

export interface AiGenerationStartedPayload extends BaseEventPayload {
  domain: 'ai';
  providerId: string;
  /** Logical task name (e.g. "component.synthesize"). */
  taskName: string;
}

export interface AiGenerationCompletedPayload extends BaseEventPayload {
  domain: 'ai';
  providerId: string;
  taskName: string;
  /** Number of model round-trips performed (1 + repair passes). */
  attempts: number;
  totalTokens: number;
}

export interface AiGenerationFailedPayload extends BaseEventPayload {
  domain: 'ai';
  providerId: string;
  taskName: string;
  code: string;
  message: string;
}

/**
 * Component synthesis lifecycle payloads (Phase 11). They carry component ids,
 * names, and counts only - NEVER generated code, prompt content, or blueprint
 * evidence.
 */
export interface ComponentStartedPayload extends BaseEventPayload {
  domain: 'component';
  /** Number of components this run intends to attempt (after capping). */
  requested: number;
}

export interface ComponentGeneratedPayload extends BaseEventPayload {
  domain: 'component';
  /** Blueprint component id the artifact traces back to. */
  componentId: string;
  /** PascalCase identifier of the generated component. */
  name: string;
  /** Bounded code length (chars) - the code itself is never emitted. */
  codeLength: number;
}

export interface ComponentFailedPayload extends BaseEventPayload {
  domain: 'component';
  componentId: string;
  name: string;
  code: string;
  /** Bounded, actionable message; never code content or secrets. */
  message: string;
}

export interface ComponentCompletedPayload extends BaseEventPayload {
  domain: 'component';
  requested: number;
  succeeded: number;
  failed: number;
  /** True when the run stopped early (cap reached or caller aborted). */
  partial: boolean;
}

/**
 * Project generation lifecycle payloads (Phase 12). They carry file paths,
 * counts, and byte sizes only - NEVER generated file contents or Blueprint
 * evidence.
 */
export interface ProjectStartedPayload extends BaseEventPayload {
  domain: 'project';
  /** Number of files the run intends to write (after planning). */
  files: number;
  /** Number of components assembled into the project. */
  components: number;
  /** Number of routes injected into the router. */
  routes: number;
}

export interface ProjectFileGeneratedPayload extends BaseEventPayload {
  domain: 'project';
  /** POSIX-relative path of the written file (never absolute). */
  path: string;
  /** Bounded byte size of the written file. */
  bytes: number;
}

export interface ProjectCompletedPayload extends BaseEventPayload {
  domain: 'project';
  /** Number of files actually written. */
  files: number;
  /** Total bytes written. */
  bytes: number;
  /** True when any artifact was skipped or any route dropped. */
  partial: boolean;
}

/**
 * Visual diff lifecycle payloads (Phase 13). They carry viewport names, counts,
 * and a similarity percentage only - NEVER screenshot bytes, decoded pixels, or
 * page text.
 */
export interface DiffStartedPayload extends BaseEventPayload {
  domain: 'diff';
  /** Number of viewports the run intends to compare. */
  viewports: number;
  /** Number of generated routes being verified. */
  routes: number;
}

export interface DiffCapturedPayload extends BaseEventPayload {
  domain: 'diff';
  /** Viewport profile name (e.g. `desktop`). */
  profile: string;
  /** True when the generated page render was captured successfully. */
  generated: boolean;
  /** True when the original captured screenshot was available. */
  original: boolean;
}

export interface DiffComputedPayload extends BaseEventPayload {
  domain: 'diff';
  profile: string;
  mismatchedPixels: number;
  totalPixels: number;
  similarityPercent: number;
}

export interface DiffCompletedPayload extends BaseEventPayload {
  domain: 'diff';
  viewports: number;
  compared: number;
  skipped: number;
  /** Mean similarity across compared viewports (0-100). */
  averageSimilarityPercent: number;
  /** True when any viewport was skipped or had a dimension mismatch. */
  partial: boolean;
}

export interface DiffFailedPayload extends BaseEventPayload {
  domain: 'diff';
  code: string;
  message: string;
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
  // Interactive capture carries NO secret: only the opaque session id.
  'browser.capture_opened': BrowserSessionPayload;
  'browser.capture_closed': BrowserSessionPayload;
  'responsive.captured': ResponsiveCapturedPayload;
  'clone.started': CloneStartedPayload;
  'clone.file_generated': CloneFileGeneratedPayload;
  'clone.asset_downloaded': CloneAssetDownloadedPayload;
  'clone.server_started': CloneServerPayload;
  'clone.server_stopped': CloneServerPayload;
  'clone.completed': CloneCompletedPayload;
  'clone.failed': CloneFailedPayload;
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
  'auth.required': AuthFailedPayload;
  'auth.failed': AuthFailedPayload;
  'auth.completed': AuthCompletedPayload;
  'auth.session_cleared': AuthSessionClearedPayload;
  'auth.session_expired': AuthFailedPayload;
  'auth.scan_started': AuthScanStartedPayload;
  'blueprint.started': BlueprintStartedPayload;
  'blueprint.generated': BlueprintGeneratedPayload;
  'blueprint.validation_failed': BlueprintValidationFailedPayload;
  'blueprint.completed': BlueprintCompletedPayload;
  'ai.config_saved': AiConfigSavedPayload;
  'ai.connection_started': AiConnectionStartedPayload;
  'ai.connection_verified': AiConnectionVerifiedPayload;
  'ai.connection_failed': AiConnectionFailedPayload;
  'ai.generation_started': AiGenerationStartedPayload;
  'ai.generation_completed': AiGenerationCompletedPayload;
  'ai.generation_failed': AiGenerationFailedPayload;
  'component.started': ComponentStartedPayload;
  'component.generated': ComponentGeneratedPayload;
  'component.failed': ComponentFailedPayload;
  'component.completed': ComponentCompletedPayload;
  'project.started': ProjectStartedPayload;
  'project.file_generated': ProjectFileGeneratedPayload;
  'project.completed': ProjectCompletedPayload;
  'diff.started': DiffStartedPayload;
  'diff.captured': DiffCapturedPayload;
  'diff.computed': DiffComputedPayload;
  'diff.completed': DiffCompletedPayload;
  'diff.failed': DiffFailedPayload;
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
      ...payload
    } as AppEventPayloadMap[T]
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
