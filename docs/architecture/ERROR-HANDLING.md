# Error Handling Specification - Artupski ReSite

System failure modes taxonomy, structured error schemas, recovery strategies, and process cancellation mechanics.

---

## 1. Failure Modes Taxonomy

| Code Domain | Error Code | Category | Root Cause |
|---|---|---|---|
| `NET_` | `INVALID_URL` | Network / Input | Malformed or unreachable protocol scheme. |
| `NET_` | `URL_POLICY_VIOLATION` | Network / Input | Target is outside the crawler access policy (private/loopback/link-local/metadata address, credentials, port, or scheme). |
| `NET_` | `DNS_RESOLUTION_FAILED` | Network | Hostname cannot be resolved by OS DNS. |
| `NET_` | `CONNECTION_TIMED_OUT` | Network | Target server did not respond within timeout window. |
| `NET_` | `UNSUPPORTED_CONTENT_TYPE` | Network / Input | The target is not an HTML page and cannot be extracted. |
| `NET_` | `SSL_CERTIFICATE_INVALID` | Network / TLS | Expired, self-signed, or untrusted certificate. |
| `BROWSER_` | `PLAYWRIGHT_CRASHED` | Automation | Browser process terminated abnormally (OOM / OS signal). |
| `BROWSER_` | `NAVIGATION_ABORTED` | Automation | Page redirected repeatedly or navigation loop detected. |
| `BROWSER_` | `EXECUTION_CONTEXT_DESTROYED` | Automation | DOM node destroyed while extracting style/layout data. |
| `AUTH_` | `LOGIN_FAILED` | Authentication | Form credentials rejected by target application. |
| `AUTH_` | `SESSION_EXPIRED` | Authentication | Cookies or tokens invalidated during active scan. |
| `AUTH_` | `CAPTCHA_CHALLENGE_BLOCKED` | Anti-Bot | Cloudflare Turnstile, reCAPTCHA, or Akamai challenge. |
| `AI_` | `API_KEY_INVALID` | LLM Provider | Missing, expired, or unauthorized API key. |
| `AI_` | `RATE_LIMIT_EXCEEDED` | LLM Provider | 429 Too Many Requests response from LLM vendor. |
| `AI_` | `CONTEXT_LENGTH_EXCEEDED` | LLM Provider | Token budget exceeded during component synthesis. |
| `AI_` | `MALFORMED_OUTPUT` | LLM Provider | Model generated unparsable JSON or truncated code. |
| `BP_` | `BLUEPRINT_VALIDATION_FAILED` | Schema / Parser | Blueprint JSON violated Zod validation constraints. |
| `BP_` | `UNSUPPORTED_VERSION` | Schema / Parser | Target version unsupported by migration runners. |
| `IO_` | `DISK_FULL` | Filesystem | Insufficient storage space on target drive. |
| `IO_` | `PERMISSION_DENIED` | Filesystem | OS denied write/read access to target folder. |
| `DB_` | `SQLITE_BUSY` | Persistence | SQLite database locked by concurrent worker process. |
| `DB_` | `SQLITE_CORRUPT` | Persistence | Disk corruption or damaged database header. |
| `DB_` | `STORAGE_INIT_FAILED` | Persistence | Local storage (sql.js engine or `app.db`) failed to initialize at startup. |
| `DB_` | `STORAGE_NOT_READY` | Persistence | A repository was used before local storage finished initializing. |
| `DB_` | `STORAGE_READ_FAILED` | Persistence | Reading the `app.db` bytes failed. |
| `DB_` | `STORAGE_WRITE_FAILED` | Persistence | Atomically writing the `app.db` bytes failed. |
| `DB_` | `MIGRATION_FAILED` | Persistence | A schema migration threw and was rolled back. |
| `DB_` | `MIGRATION_CHECKSUM_MISMATCH` | Persistence | An applied migration no longer matches its recorded checksum (fatal; refuses to continue). |
| `PROC_` | `USER_CANCELLED` | Lifecycle | User aborted scan or generation task via UI. |
| `PROC_` | `SCAN_ALREADY_RUNNING` | Lifecycle | A scan was requested while another scan is still live (one crawl at a time). |
| `PROC_` | `PROCESS_SPAWN_FAILED` | Process | The worker process could not be started (e.g. Node missing, spawn rejected). |
| `PROC_` | `PROCESS_TIMEOUT` | Process | A worker operation exceeded its startup or communication timeout. |
| `PROC_` | `PROCESS_EXITED_UNEXPECTEDLY` | Process | The worker exited on its own (crash/OOM/signal) without a managed shutdown. |
| `PROC_` | `WORKER_PROTOCOL_VIOLATION` | Process | A frame failed validation (malformed, unknown type, version mismatch). |
| `PROC_` | `WORKER_SHUTDOWN_FAILED` | Process | The worker did not stop within the grace period and was force-terminated. |
| `BROWSER_` | `BROWSER_NOT_INSTALLED` | Browser | No Playwright Chromium build was found for the runtime. |
| `EXPORT_` | `EXPORT_VALIDATION_FAILED` | Validation / Input | Export request failed boundary validation (unknown mode, empty project name/root). |
| `EXPORT_` | `EXPORT_LIMIT_EXCEEDED` | Validation / Input | Export exceeded a bounded resource cap (entries/bytes); the run is rejected, never truncated. |
| `EXPORT_` | `EXPORT_READ_FAILED` | Filesystem | Listing or reading a source file beneath the project root failed. |
| `EXPORT_` | `EXPORT_WRITE_FAILED` | Filesystem | Writing the export artifact (ZIP archive or folder) failed. |
| `EXPORT_` | `EXPORT_DOC_GENERATION_FAILED` | Generation | Generating the Markdown documentation set failed. (An oversized document is reported per-document as `EXPORT_DOC_TOO_LARGE` and never truncates the set.) |
| `SECRET_` | `SECRET_STORAGE_UNAVAILABLE` | IO / Keychain | No usable OS credential store exists, so the key is not persisted (fail closed); a legacy plaintext key is used for the session only and never re-created. |
| `SECRET_` | `SECRET_READ_FAILED` | IO / Keychain | Reading a secret from the OS credential store failed, or the account slug was invalid. |
| `SECRET_` | `SECRET_WRITE_FAILED` | IO / Keychain | Writing or deleting a secret in the OS credential store failed, or the account slug was invalid. |

The `SECRET_*` codes (Phase 15) reuse the existing **`io`** category (secret storage is a native/IO concern); **no new `ErrorCategory` is added** (deviation C7). The message and `suggestedAction` never contain key material.

---

## 2. Structured Error Response Objects

Standardized error interface emitted across IPC and persisted in process logs:

```typescript
export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info';

export interface StructuredError {
  code: string;
  category: 'network' | 'browser' | 'auth' | 'ai' | 'blueprint' | 'io' | 'database' | 'process';
  message: string;
  severity: ErrorSeverity;
  recoverable: boolean;
  retryable: boolean;
  retryCount?: number;
  maxRetries?: number;
  details?: Record<string, unknown>;
  stackTrace?: string;
  suggestedAction: string;
  timestamp: string;
}
```

### Example Structured Error Object: CAPTCHA Triggered

```json
{
  "code": "CAPTCHA_CHALLENGE_BLOCKED",
  "category": "auth",
  "message": "Encountered Cloudflare Turnstile CAPTCHA challenge at https://example.com/login",
  "severity": "fatal",
  "recoverable": true,
  "retryable": false,
  "details": {
    "url": "https://example.com/login",
    "provider": "cloudflare_turnstile",
    "detected_selector": "iframe[src*='challenges.cloudflare.com']"
  },
  "suggestedAction": "Switch to Interactive Login mode to manually solve the CAPTCHA inside the browser window.",
  "timestamp": "2026-10-01T02:30:00.000Z"
}
```

---

## 3. Recovery & Retry Strategies

### 3.1 Exponential Backoff with Jitter
Used for network requests and rate-limited AI vendor endpoints:

$$\text{delay} = \min(\text{maxDelay}, \text{baseDelay} \times 2^{\text{attempt}}) \pm \text{jitter}$$

```typescript
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000,
  maxDelayMs = 10000
): Promise<T> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      if (attempt >= maxRetries || !err.retryable) {
        throw err;
      }
      const backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      const jitter = Math.random() * 200;
      await new Promise((res) => setTimeout(res, backoff + jitter));
    }
  }
  throw new Error('Retry limit reached');
}
```

### 3.2 Degraded Fallback Execution
- AI Synthesis Failure: If LLM fails to synthesize clean React components, generator falls back to deterministic AST HTML-to-JSX transpilation without LLM enhancement.
- Screenshot Failure: If WebP capture fails due to graphics driver issues, browser switches to headless software rasterizer (SwiftShader) and PNG capture.

---

## 4. Cancellation Architecture

Cancellation is executed via cooperative `AbortController` signals passed down to all asynchronous sub-tasks.

```
[ User Clicks 'Cancel' in UI ]
               |
               v
    (Tauri IPC Command: cancel_process)
               |
               v
     [ AbortController.abort() ]
               |
       +-------+--------------------+-------------------+
       |                            |                   |
       v                            v                   v
[ Playwright Worker ]       [ AI Client Stream ]    [ Code Generator ]
- close page/context/browser - abort HTTP request   - abort file writing
- delete temp browser dir    - rollback token state - remove partial files
```

### 4.1 Process Cleanup Checklist
When process aborts (cancelled or fatal crash):
1. **Browser Cleanup**:
   - Issue `browser.close()` and `context.close()`.
   - Terminate lingering Chromium child PID if unresponsive after 3 seconds (`SIGKILL` / `taskkill /F /PID`).
2. **Filesystem Cleanup**:
   - Delete temporary `.tmp` download staging directories.
   - Retain valid completed page artifacts in `source/` if project state is inspectable.
3. **Database State Consistency**:
   - Update `scans` table: set `status = 'cancelled'` and `completed_at = CURRENT_TIMESTAMP`.
   - Flush pending logs in memory buffer to `process_logs` table before releasing connection pool.

### 4.2 Phase 4 Crawl Lifecycle, Cancellation & Partial Scans (as built)

The crawler application service (`src/services/scanner/crawlerService.ts`) owns the scan lifecycle for one crawl. Transitions are enforced by a pure state machine (`src/services/scanner/lifecycle.ts`) over the persisted `scans.status` union:

```
pending ──start──▶ in_progress ──┬─ success ─▶ completed
                                 ├─ partial page failures ─▶ completed
                                 ├─ fatal failure ─▶ failed
                                 └─ cancel ─▶ cancelled
```

- `completed` / `failed` / `cancelled` are terminal; a completed scan is never marked failed/cancelled, and vice versa. `SCAN_ALREADY_RUNNING` is returned when a second scan is requested while one is live (in-process or persisted).
- **Recoverable vs fatal**: a network/timeout/unsupported-content failure is a *page-level* error (persisted as a failed page, `scanner.page_failed` emitted, crawl continues). A fatal worker/browser failure (`PLAYWRIGHT_CRASHED`, `WORKER_PROTOCOL_VIOLATION`, `PROCESS_EXITED_UNEXPECTEDLY`, `PROCESS_SPAWN_FAILED`, `PROCESS_TIMEOUT`, `BROWSER_NOT_INSTALLED`) stops the crawl and records the scan as `failed`.
- **Cancellation**: `cancel(scanId)` sets a cooperative flag and calls the worker's `abort` for the in-flight session; the loop stops, persists whatever pages were already captured (partial progress is never discarded), records `cancelled`, and releases the active-run slot. Shutting the worker process down is owned by the layer that started it.
- **Ordering guarantee**: a scan is only ever marked `completed` *after* the final page batch is written, so a reported-complete scan is durably persisted. Unexpected worker termination still yields a consistent terminal scan outcome (`failed`).
- **Partial/failed scans**: useful progress is retained; an incomplete scan is never reported as completed. Structured logs never include credentials, sensitive page contents, or unrestricted worker output, and no raw stack trace is surfaced to the UI (it is retained only on the `StructuredError`).
