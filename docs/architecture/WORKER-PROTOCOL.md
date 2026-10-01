# Worker Protocol Specification - Artupski ReSite

Phase 3 foundation for the dedicated Node.js worker process (the future Playwright crawler). This document is the single source of truth for the wire contract shared by the TypeScript host (`ProcessManager` / `browserRuntime`) and the worker entrypoint (`src/workers/crawler/index.ts`).

---

## 1. Transport

- **stdio, newline-delimited JSON.** Each frame is one UTF-8 JSON object terminated by `\n`. The host writes commands to the worker's stdin; the worker writes results/events/logs to stdout.
- **No WebSocket.** This deliberately avoids widening the webview CSP `connect-src` directive in `src-tauri/tauri.conf.json`. It matches `AGENTS.md` section 3 ("stdio IPC / JSON message streams") and `ARCHITECTURE.md` section 5 (resolved from "stdio or WebSocket" to **stdio**).
- **The React UI never speaks the protocol.** Only the `ProcessManager` and services layered on it (e.g. `browserRuntime`) read/write frames. Components consume `process.*` / `browser.*` events.

```
React UI  ──(EventBus events)──  browserRuntime  ──(typed request)──  ProcessManager
                                                                          │
                                                     (Rust process_spawn / process_write)
                                                                          │
                                                          Node worker  ◀──┴──▶  stdio JSON frames
```

---

## 2. Envelope

Every frame is a single envelope. The shape is defined in `src/services/infra/workerProtocol.ts`.

```typescript
interface WorkerEnvelope<TType, TPayload> {
  protocolVersion: number;   // integer; currently 1
  id: string;                // correlation id (uuid)
  type: 'command' | 'result' | 'event' | 'log' | 'error';
  payload: TPayload;
  error?: StructuredError;   // present on failed result / error frames
}
```

| Type | Direction | Purpose |
| :--- | :--- | :--- |
| `command` | host → worker | An operation to perform (`ping`, `launch`, `navigate`, `close`, `extract`, `abort`, `detectLogin`). |
| `result` | worker → host | The correlated outcome of a command (matched by `id`). May carry `error`. |
| `event` | worker → host | Asynchronous worker telemetry (e.g. `browser.launched`). |
| `log` | worker → host | Structured log line (level + message + optional metadata). |
| `error` | worker → host | A protocol-level problem (e.g. a malformed frame the worker received). |

### 2.1 Versioning

- `WORKER_PROTOCOL_VERSION` is an **integer**, currently `1`.
- Both sides **reject** any frame whose `protocolVersion` is not an exact match, surfacing `WORKER_PROTOCOL_VIOLATION`.
- Bump the version only on a **breaking** wire change; additive fields (like `ping.browser`) do not require a bump.

### 2.2 Deterministic serialization

- `stableStringify()` emits object keys in **sorted order at every depth**, so identical messages always produce identical bytes (diffable, cache-friendly).
- `MAX_FRAME_BYTES` (1 MiB) caps a single frame. Serializing beyond it throws `WORKER_PROTOCOL_VIOLATION`; decoding drops oversize frames and counts them.

### 2.3 Framing & buffering

- `decodeFrames(buffer)` splits an accumulated stdio buffer on `\n`, returning complete frames, the unterminated remainder, and an oversize count.
- The host keeps a bounded remainder (`maxBufferBytes`) so a runaway worker cannot exhaust memory.
- Empty frames are **rejected**, not ignored, so a silent framing bug is never masked.

---

## 3. Commands

Phase 3 implements `ping` / `launch` / `navigate` / `close`. Phase 4 (workstream 1) adds `extract` and `abort` — still **no** DOM/CSS/JS analysis, network analysis, technology detection, or screenshotting (those are later phases).

| Command | Payload | Result |
| :--- | :--- | :--- |
| `ping` | `{}` | `{ pong: true, workerVersion, browser? }` — also reports browser availability without downloading. |
| `launch` | `{ engine: 'chromium', headless, executablePath? }` | `{ sessionId, engine, version }` |
| `navigate` | `{ sessionId, url, timeoutMs }` | `{ sessionId, url, status, title }` |
| `close` | `{ sessionId }` | `{ sessionId }` |
| `extract` | `{ sessionId, url, timeoutMs, followRedirects?, allowedContentTypes?, maxRedirects? }` | `{ sessionId, page: NormalizedPage }` |
| `abort` | `{ sessionId }` | `{ sessionId }` |

- `navigate.timeoutMs` and `extract.timeoutMs` are **clamped to ≤ 30 000 ms** by both the worker and the host client (AGENTS.md section 4, "Zero Headless Hangs").
- `launch` throws `BROWSER_NOT_INSTALLED` when no Chromium build is present and no explicit `executablePath` was supplied.
- `extract` enforces the shared URL/network policy at the pre-navigation boundary and re-validates the final URL after redirects; it returns a bounded, normalized `NormalizedPage` (never raw DOM). `maxRedirects` is capped at 5 and `allowedContentTypes` defaults to HTML only.
- `abort` cancels an in-flight extraction for a session.

### 3.1 Versioning note (Phase 4)

The Phase 4 additions are **additive**: the envelope shape is unchanged and `WORKER_PROTOCOL_VERSION` stays `1`. A Phase 3 host that does not know `extract`/`abort` is unaffected (it never sends them); a Phase 4 host requires a Phase 4 worker, which is the same worker process shipped here.

---

## 4. Runtime validation

- Every frame crossing the boundary is validated (`validateMessage`) before use: envelope shape, integer version, non-empty `id`, known `type`, and a payload matching the type.
- A `result` frame that carries an `error` only needs the command discriminator in its payload (a placeholder is expected), because the failure detail lives in `error`.
- Malformed frames produce a `StructuredError` with code `WORKER_PROTOCOL_VIOLATION`; the host logs it, emits `process.failed`, fails in-flight requests, and reaps the worker.

---

## 5. Process lifecycle (host side)

The `ProcessManager` state machine:

```
not_started → starting → ready ⇄ busy
                   │        │
                   ▼        ▼
                failed   stopping → stopped → starting (restart)
```

- **Duplicate-start prevention:** concurrent `start()` calls share one promise.
- **Startup timeout:** spawn + handshake are bounded (≤ 30s).
- **Communication timeout:** each `request()` is bounded (≤ 30s) and a non-responsive worker is failed and reaped.
- **Graceful shutdown → forced kill:** `stop()` requests termination, waits a bounded grace period (default 500 ms), then force-kills the tree.
- **Unexpected exit:** detected via the exit listener; in-flight requests are rejected with `PROCESS_EXITED_UNEXPECTEDLY` and `process.exited` is emitted.
- **Cleanup:** listeners and timers are always disposed; `resetForTests()` returns the manager to `not_started`.

---

## 6. Security

- The worker is spawned by the sandboxed Rust commands (`process_spawn`) with an **array** of arguments and **no shell**.
- The executable must be on the Rust allowlist (`node` / `node.exe`).
- The child environment is a sanitized allowlist; sensitive host variables are never inherited.
- stdout/stderr are streamed as bounded lines; stdin writes are size-capped.
- See `docs/security/SECURITY.md` section 6 for the full model.
