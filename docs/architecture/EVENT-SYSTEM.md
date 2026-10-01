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
- `clone.*`: Local HTML path rewriting, web server serving, static preview.
- `project.*`: Codebase generation, file writing, package installation.

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
  | 'project';

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
```

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
