# Error Handling Specification - Artupski ReSite

System failure modes taxonomy, structured error schemas, recovery strategies, and process cancellation mechanics.

---

## 1. Failure Modes Taxonomy

| Code Domain | Error Code | Category | Root Cause |
|---|---|---|---|
| `NET_` | `INVALID_URL` | Network / Input | Malformed or unreachable protocol scheme. |
| `NET_` | `DNS_RESOLUTION_FAILED` | Network | Hostname cannot be resolved by OS DNS. |
| `NET_` | `CONNECTION_TIMED_OUT` | Network | Target server did not respond within timeout window. |
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
