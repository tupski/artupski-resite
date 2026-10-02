# Event System Specification - Artupski ReSite

Architecture, event taxonomy, payload interfaces, verbose process logging, streaming IPC, and buffering mechanics.

---

## 1. Event System Architecture

- Core Engine: Standard TypeScript `EventEmitter` combined with Tauri 2 IPC event bridge (`@tauri-apps/api/event`).
- Flow Direction: Bi-directional IPC support. Internal worker events flow from Node.js/Tauri native layer -> Rust IPC bridge -> React Zustand frontend store.
- Design Goal: High-throughput execution telemetry with zero UI frame drops.

```
+------------------+         +-------------------+         +---------------------+
| TypeScript Core  | ------> | Rust Native Layer | ------> | React Frontend UI   |
| Engine/Workers   | (EventEmitter / stdio)      | (Tauri Emit)          | (Zustand Store)     |
+------------------+         +-------------------+         +---------------------+
```

---

## 2. Event Naming Taxonomy

Standardized event key structure: `<domain>.<action_or_state>`.

- `scanner.*`: Page discovery, crawling progress, DOM capture, HAR recording.
- `technology.*`: Framework detection, signature matching, scoring.
- `asset.*`: Downloading, hashing, processing, saving.
- `responsive.*`: Viewport switching, responsive rule extraction.
- `auth.*`: Session initialization, cookie extraction, login auto-fill.
- `blueprint.*`: Schema parsing, Zod validation, blueprint generation.
- `clone.*`: Local HTML path rewriting, web server serving, static preview (`clone.started`, `clone.file_generated`, `clone.asset_downloaded`, `clone.server_started`, `clone.server_stopped`, `clone.completed`, `clone.failed`).
- `ai.*`: Provider configuration, connection/health checks, and schema-constrained generation lifecycle (`ai.config_saved`, `ai.connection_started`, `ai.connection_verified`, `ai.connection_failed`, `ai.generation_started`, `ai.generation_completed`, `ai.generation_failed`). Payloads carry provider id, model, and counts only — **never** the API key, request headers, or prompt/completion content.
- `project.*`: Codebase generation, file writing, package installation.
- `storage.*`: Local database initialization, migration lifecycle, readiness.
- `process.*`: Child-process lifecycle (spawn/ready/busy/stopping/stopped/exited/failed).
- `browser.*`: Browser runtime detection and controlled session lifecycle.

---

## 3. Event Payload TypeScript Interfaces

```typescript
export type EventDomain =
  | 'scanner'
  | 'technology'
  | 'asset'
  | 'responsive'
  | 'auth'
  | 'blueprint'
  | 'clone'
  | 'project'
  | 'storage';

export interface BaseEventPayload {
  eventId: string;
  projectId: string;
  timestamp: string;
  domain: EventDomain;
}

// Scanner Events
export interface ScannerProgressEventPayload extends BaseEventPayload {
  domain: 'scanner';
  scanId: string;
  discoveredPages: number;
  scannedPages: number;
  currentUrl: string;
  phase: 'navigating' | 'extracting_dom' | 'capturing_screenshot' | 'idle';
  progressPercentage: number;
}

export interface ScannerPageCapturedEventPayload extends BaseEventPayload {
  domain: 'scanner';
  scanId: string;
  pageId: string;
  url: string;
  statusCode: number;
  title: string;
  loadTimeMs: number;
}

// Technology Detection Events
export interface TechnologyDetectedEventPayload extends BaseEventPayload {
  domain: 'technology';
  scanId: string;
  category: string;
  name: string;
  version?: string;
  confidence: number;
  source: 'js_variable' | 'header' | 'html_meta' | 'dom_pattern';
}

// Asset Events
export interface AssetDownloadedEventPayload extends BaseEventPayload {
  domain: 'asset';
  scanId: string;
  assetId: string;
  sourceUrl: string;
  localPath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

// Responsive Events
export interface ResponsiveBreakpointEventPayload extends BaseEventPayload {
  domain: 'responsive';
  scanId: string;
  width: number;
  height: number;
  deviceLabel: string;
  overridesFound: number;
}

// Authentication Events
export interface AuthStateChangedEventPayload extends BaseEventPayload {
  domain: 'auth';
  authType: 'cookie' | 'bearer_token' | 'interactive';
  status: 'detecting' | 'authenticated' | 'failed';
  cookiesCount: number;
  userIdentifier?: string;
}

// Blueprint Events
export interface BlueprintStatusEventPayload extends BaseEventPayload {
  domain: 'blueprint';
  blueprintId?: string;
  status: 'validating' | 'completed' | 'failed';
  schemaVersion: number;
  validationErrors?: string[];
}

// Clone Events
export interface CloneStatusEventPayload extends BaseEventPayload {
  domain: 'clone';
  status: 'rewriting' | 'ready' | 'failed';
  localServerUrl?: string;
  totalRewrittenFiles: number;
}

// Project Events
export interface ProjectGenerationEventPayload extends BaseEventPayload {
  domain: 'project';
  targetFramework: string;
  currentStep: string;
  filesGenerated: number;
  totalFiles: number;
  progressPercentage: number;
}

// Storage Events (Phase 2 - local database lifecycle)
export interface StorageInitializingEventPayload extends BaseEventPayload {
  domain: 'storage';
}

export interface StorageReadyEventPayload extends BaseEventPayload {
  domain: 'storage';
  databaseLocation: string;
  appliedMigrations: number[];
}

export interface StorageMigrationStartedEventPayload extends BaseEventPayload {
  domain: 'storage';
  version: number;
  name: string;
}

export interface StorageMigrationCompletedEventPayload extends BaseEventPayload {
  domain: 'storage';
  version: number;
  name: string;
  appliedCount: number;
}

export interface StorageMigrationFailedEventPayload extends BaseEventPayload {
  domain: 'storage';
  version: number | null;
  code: string;
  message: string;
}
```

### 3.1 Storage Event Keys (Phase 2)

Emitted by `storageService` during startup and migration, using the existing `createEvent` envelope pattern:

| Event key | Emitted when |
| :--- | :--- |
| `storage.initializing` | Storage initialization begins. |
| `storage.migration_started` | Immediately before a pending migration is applied. |
| `storage.migration_completed` | After a migration commits. |
| `storage.migration_failed` | Initialization or a migration fails (carries the structured error code and message). |
| `storage.ready` | The database is open, migrated, and repositories are available. |

### 3.2 Process & Browser Event Keys (Phase 3)

Emitted by `ProcessManager` and `browserRuntime` using the shared `createEvent` envelope (`BaseEventPayload`). Payload interfaces live in `src/services/infra/eventBus.ts`.

| Event key | Emitted when | Payload highlights |
| :--- | :--- | :--- |
| `process.spawning` | A worker spawn begins. | `processName` |
| `process.ready` | Spawn + handshake succeeded, or a request batch drained. | `processName`, `pid?` |
| `process.busy` | At least one request is in flight. | `processName`, `pid?` |
| `process.stopping` | Graceful shutdown begins. | `processName`, `pid?` |
| `process.stopped` | The worker has fully stopped. | `processName` |
| `process.exited` | The worker's exit event fired (managed or unexpected). | `processName`, `code`, `signal`, `unexpected` |
| `process.failed` | Spawn/timeout/protocol failure. | `processName`, `code`, `message` |
| `browser.detection_started` | Browser detection begins. | `engine`, `installed` |
| `browser.detected` | A browser engine was found. | `engine`, `installed`, `version?`, `executablePath?` |
| `browser.missing` | No usable browser was found (or startup failed). | `engine`, `code`, `message` |
| `browser.session_started` | A controlled browser session launched. | `engine`, `sessionId` |
| `browser.session_closed` | A controlled browser session closed. | `engine`, `sessionId` |

### 3.3 Scanner (crawler) Event Keys (Phase 4)

Emitted by the crawler application service (`src/services/scanner/crawlerService.ts`) using the shared `createEvent` envelope. Payload interfaces live in `src/services/infra/eventBus.ts`.

| Event key | Emitted when | Payload highlights |
| :--- | :--- | :--- |
| `scanner.started` | A crawl begins. | `scanId`, `seedUrl`, `maxDepth`, `maxPages` |
| `scanner.page_discovered` | A URL is added to the frontier. | `scanId`, `url`, `depth` |
| `scanner.page_started` | Extraction of a dequeued page begins. | `scanId`, `url`, `depth` |
| `scanner.page_loaded` | A page finished extracting successfully. | `scanId`, `url`, `statusCode`, `title`, `depth` |
| `scanner.page_failed` | A single page failed but the crawl continues (recoverable). | `scanId`, `url`, `code`, `message` |
| `scanner.progress` | Coalesced progress tick (at most once every N scanned pages - never per DOM node). | `scanId`, `pagesScanned`, `pagesDiscovered`, `progressPercentage`, `currentUrl` |
| `scanner.cancelled` | A crawl was cancelled by the user. | `scanId`, `pagesScanned`, `pagesDiscovered` |
| `scanner.completed` | A crawl finishes. | `scanId`, `pagesScanned`, `pagesDiscovered` |
| `scanner.failed` | The crawl fails fatally. | `scanId`, `url`, `code`, `message` |

`scanner.failed` is reserved for a **fatal** crawl failure (browser crash, protocol violation, unexpected worker exit); a recoverable page-level error is emitted as `scanner.page_failed` and the crawl continues. Progress is emitted on a bounded cadence (`progressEveryPages`), not once per page or per node.

### 3.4 Blueprint Event Keys (Phase 9)

Emitted by the Blueprint lifecycle wrapper (`src/services/blueprint/blueprintLifecycle.ts`) using the shared `createEvent` envelope. Payload interfaces live in `src/services/infra/eventBus.ts`. Payloads carry ids, counts, validity, and **bounded** validation messages only - never document bytes, credentials, or cookies.

| Event key | Emitted when | Payload highlights |
| :--- | :--- | :--- |
| `blueprint.started` | Synthesis begins for a scan. | `scanId`, `projectId`, `sourceUrl?` |
| `blueprint.generated` | A **valid** document was persisted. | `blueprintId`, `version`, `schemaVersion`, `pageCount`, `componentCount` |
| `blueprint.validation_failed` | A document failed validation, or synthesis/persistence failed (an invalid document is still persisted with `is_valid = 0`). | `blueprintId?`, `schemaVersion`, `errorCount`, bounded `errors[]` |
| `blueprint.completed` | The lifecycle attempt finished (always emitted last, success or failure). | `blueprintId?`, `version`, `isValid`, `partial`, `skippedPages` |

Ordering guarantee: `blueprint.started` → (`blueprint.generated` \| `blueprint.validation_failed`) → `blueprint.completed`. A Blueprint failure **never** changes a crawl's terminal status (`scanner.completed`/`scanner.failed` are unaffected).

---

## 4. Verbose Process Console Logging Architecture

Structured telemetry logging system for real-time streaming and persistence to SQLite `process_logs`.

```typescript
export type LogLevel = 'debug' | 'info' | 'success' | 'warning' | 'error';

export interface ProcessLogEntry {
  id?: number;
  projectId: string;
  scanId?: string;
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  details?: Record<string, unknown> | string;
  phase: string;
  progress?: number;
}
```

---

## 5. Streaming IPC, Buffering & Batching

To prevent main thread UI stutter during rapid crawl events (e.g., 500 network calls/sec), events are buffered in memory and flushed in batches.

```typescript
export class IPCEventStreamer {
  private buffer: ProcessLogEntry[] = [];
  private batchSize = 50;
  private flushIntervalMs = 100;
  private timer: NodeJS.Timeout | null = null;

  constructor(private emitToFrontend: (batch: ProcessLogEntry[]) => void) {
    this.startTimer();
  }

  public push(log: ProcessLogEntry): void {
    this.buffer.push(log);
    if (this.buffer.length >= this.batchSize) {
      this.flush();
    }
  }

  public flush(): void {
    if (this.buffer.length === 0) return;
    const batch = [...this.buffer];
    this.buffer = [];
    this.emitToFrontend(batch);
  }

  private startTimer(): void {
    this.timer = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  public destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.flush();
  }
}
```

---

## 6. Frontend Log Filtering & Virtualized View Controls

React console interface features:
- Filter Controls: Severity toggle (`debug`, `info`, `success`, `warning`, `error`), text regex search, and category dropdown.
- Performance Strategy: Virtualized list rendering via `@tanstack/react-virtual` to display 100,000+ log lines with 60 FPS scrolling.
- Auto-Scroll: Pauses auto-scroll when user manually scrolls up in history.
