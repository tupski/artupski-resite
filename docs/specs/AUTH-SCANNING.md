# Authenticated Scanning & Session Management Specification

## 1. Architecture & Privacy Principles

Artupski ReSite scans protected dashboard and portal areas using user-in-the-loop session capture. Application **never stores raw passwords or credentials**. Authentication state is captured via browser storage snapshots (`storageState.json`), encrypted locally, and injected into headless crawler contexts.

```
+-----------------------------------------------------------------------------------+
|                           User Triggers Auth Scan Mode                            |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                   Controlled Interactive Playwright Window Spawn                  |
|          (Non-Headless Chromium Instance with Isolated Auth Context)              |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                     User Performs Interactive Login / MFA                         |
|   (Credentials entered directly by user into target site; never logged/stored)    |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                        Session Capture & Extraction Hook                          |
|         (Cookies, LocalStorage, SessionStorage, Origin Storage Tokens)            |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|               AES-256-GCM Session Encryption & Local SQLite Storage               |
|            (Key derived from local machine seed; zero cloud sync)                 |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                       Authenticated Crawl Execution Engine                        |
|       (Injects Decrypted Storage State into Headless Scan Worker Contexts)        |
+-----------------------------------------------------------------------------------+
```

---

## 2. Interactive Login Flow & Session Capture

### 2.1 Workflow Steps

1. User clicks **Scan with Authentication** in desktop interface.
2. System spawns interactive (headed) Playwright browser window pointing to target login URL.
3. User completes authentication (OAuth 2.0, SSO, Google/GitHub sign-in, MFA, CAPTCHA, or standard form).
4. User clicks **Capture Session & Start Scan** button in floating desktop overlay or app UI.
5. System invokes `context.storageState()` and extracts:
   - Cookies (Name, Value, Domain, Path, Expiry, HttpOnly, Secure, SameSite).
   - `localStorage` key-value pairs per origin.
   - `sessionStorage` snapshot per origin via `page.evaluate()`.
6. Interactive browser instance is closed immediately.
7. Captured payload is encrypted and stored in local SQLite database associated with active project.

### 2.2 Storage State Model

```typescript
export interface AuthCookieRecord {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface OriginStorageRecord {
  origin: string;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

export interface EncryptedSessionStateModel {
  id: string;
  projectId: string;
  targetDomain: string;
  encryptedPayload: string; // AES-256-GCM ciphertext (Base64)
  iv: string;               // 12-byte initialization vector (Base64)
  authTag: string;          // 16-byte authentication tag (Base64)
  createdAt: string;
  expiresAt?: string;
  cookieCount: number;
  originCount: number;
}
```

---

## 3. Auth-Walled Page & Redirect Detection

### 3.1 Detection Signals & Indicators

Scanner monitors every navigation request for signs of authentication blocks or session invalidation:

1. **HTTP Status Codes**:
   - `401 Unauthorized`: Endpoint requires authentication.
   - `403 Forbidden`: Authenticated user lacks permissions or session expired.
   - `302 / 303 / 307 / 308 Redirect` to known login paths (`/login`, `/signin`, `/auth`, `/oauth/authorize`, `/accounts/login`).
2. **Client-Side SPA Redirects**:
   - Navigation URL requested: `https://app.example.com/dashboard/settings`.
   - Final loaded URL after router push: `https://app.example.com/login?redirect=%2Fdashboard%2Fsettings`.
3. **DOM Login Form Presence**:
   - Detection of `input[type="password"]`, `<form action="*login*">`, or sign-in buttons on requested URL.
4. **Session Expiry & Token Invalidation**:
   - Network response header `Set-Cookie` invalidating auth tokens (e.g., `Max-Age=0` or `expires=1970-01-01`).
   - XHR/Fetch API returning `{"error": "unauthorized"}` or `{"message": "jwt expired"}`.

### 3.2 Page Categorization Taxonomy

Every crawled URL is assigned one of 5 auth status classifications:

| Category | Definition | Criteria |
|---|---|---|
| `public` | Accessible without session cookies | Returns 200 OK without auth cookies; no auth redirect. |
| `authenticated` | Protected page successfully scanned with active session | Returns 200 OK with session state injected; protected DOM content present. |
| `auth_required` | Protected page requested without session or with expired session | Redirects to login, returns 401/403, or displays login form. |
| `blocked` | Access denied due to IP ban, Cloudflare challenge, or WAF | HTTP 429, Cloudflare 1020, CAPTCHA roadblock without login form. |
| `unknown` | Page errored or timed out before auth classification | Network failure, DNS resolution failure, navigation timeout. |

**Honesty note (as built)**: an `authenticated` classification reports that the page was fetched **with a session in effect**, not that its protection was independently verified. Distinguishing a public page from a protected page the session unlocked would require a second, unauthenticated request, which is forbidden (out-of-scope side effects). Consumers and UI must therefore present `authenticated` as "scanned with an active session", never as "access was proven to require authentication".

---

## 4. Encryption & Privacy Guarantees

### 4.1 Local Cryptographic Storage

- **Cipher**: AES-256-GCM (Galois/Counter Mode) authenticated encryption.
- **Key Derivation**: Key derived via PBKDF2 (100,000 iterations, SHA-512) using the per-installation seed (`app_settings` `auth.installation_id`) + a random per-session salt stored with the record. (The seed is an installation identifier, not an OS-keychain secret; see `SECURITY.md` §3.3.)
- **Storage Boundary**: Encrypted session records stored exclusively in local SQLite database file `resite.db`.
- **Zero Cloud Transmission**: Session tokens, auth headers, and cookies are strictly forbidden from being sent to external AI API endpoints, telemetries, or remote servers.
- **Prompt Sanitization**: AI Blueprint prompts filter out all `Authorization` headers, `Cookie` headers, `Bearer` tokens, and private session storage keys.

### 4.2 Session Clearance & Destruction

- **Explicit Project Session Clear**: User can click "Clear Session" in Project Settings to execute immediate cryptographic deletion:
  - `DELETE FROM auth_sessions WHERE project_id = ?;`
  - Playwright browser context storage state files deleted from filesystem.
- **Auto-Expiry Purge**: Session records past cookie `expires` timestamp are automatically purged before crawl execution.
- **Temporary Worker Context Isolation**: Each Playwright crawl worker runs in an ephemeral in-memory context; browser profile folders are deleted on worker exit.

---

## 5. Implementation Notes (as built)

Delivery order note: this phase was implemented **after** Technology Detection, which was committed first as `2191b29`. The phase numbers are unchanged (Technology Detection remains Phase 6 by heading; Authentication remains Phase 5); only the order differs. See `docs/product/PLAN.md` for the full reconciliation.

### 5.1 Delivered

- **Interactive capture window (§2.1)**: `BrowserRuntime.launchCaptureSession()` opens a **headed**, user-in-the-loop Playwright window through the existing crawler worker (`launch` with `capture: true`). The user signs in manually; `BrowserRuntime.captureSessionState()` then calls the worker's new `captureState` command, which returns a storage state **scoped to the target host** (cookies whose domain does not apply and origins whose hostname is not the scope host are dropped). `cancelCapture()`/`close` and shutdown always close the window. `authSessionService.beginInteractiveCapture` / `completeInteractiveCapture` / `cancelInteractiveCapture` drive the flow and reuse the existing encrypt+persist path. The worker NEVER automates credential entry, never reads a typed password, and never emits the captured state as an event or log line.
- **Crypto**: `src/services/auth/crypto.ts` - AES-256-GCM, IV fresh per encryption, 16-byte tag verified on decrypt (tamper/wrong-seed/malformed-envelope all fail closed with `STORAGE_READ_FAILED`). Key derived by PBKDF2 (100,000 iterations, SHA-512) - see §4.1, which mandates PBKDF2 (not Argon2id). A `redactSecrets` helper exists as a defensive last line so cookie/token/authorization fields cannot reach a log.
- **Seed**: the KDF seed is a random per-installation value stored in `app_settings` (`auth.installation_id`) - an installation identifier, NOT an OS-keychain secret. See `SECURITY.md` §3.3 for the threat model and the tracked keychain hardening item.
- **Persistence**: migrations `004_auth_sessions` (v4) and `005_scan_page_auth` (v5); `AuthSessionRepository` owns all `auth_sessions` SQL. One active session per project is enforced by a partial UNIQUE index.
- **Injection**: the worker `launch` command accepts an optional `authState`; every session gets its own explicit Playwright context with `storageState` applied **in memory only**. No plaintext session file is ever written.
- **Detection/classification**: `src/services/scanner/authClassifier.ts` assigns each page `public | authenticated | auth_required | blocked | unknown`. A wall is always `auth_required` (even with a session injected) because it proves the session did not hold. `blocked` covers CAPTCHA/WAF/429; `unknown` covers fetch failure/timeout. **Semantics**: `authenticated` means the page was reached **with a session in effect**, NOT independently proven to be protected; without a forbidden unauthenticated comparison request a public page fetched during an authenticated scan is also labelled `authenticated`. Consumers must not read it as verified access.
- **Lifecycle**: `close`/shutdown close the isolated context first (dropping injected cookies/storage) then the browser. Session purge runs before a crawl loads a session; "Clear Session" performs a cryptographic deletion.
- **Events**: `auth.completed`, `auth.session_cleared`, `auth.session_expired`, `auth.scan_started` - none carries a secret.

### 5.2 Supported authentication methods

Only the **interactive captured-session** model is supported: a Playwright `storageState` (cookies + localStorage/sessionStorage) captured from a user-completed login, encrypted at rest, and replayed for that project + target domain. No password storage, no bearer/basic credential entry, no programmatic login.

### 5.3 Interactive capture window (delivered)

Section 2.1's headed interactive browser window is **delivered**. The user chooses a sign-in URL on the Scan screen, the application opens a real headed window, the user completes login/MFA/SSO manually, then captures the resulting session. The capture is scoped to the target host, encrypted with AES-256-GCM, and stored as the project's single active session for replay.

- The worker launches headed only for a session marked `capture: true`; a capture session MUST be headed and MUST NOT carry an injected `authState` (enforced at both the protocol boundary and the worker). A capture context therefore can never be silently promoted to a scan context.
- Capture is split into separate requests (`launch` … user logs in … `captureState` … `close`), so the human login is never bounded by the 30s worker request ceiling; each individual round-trip stays within it.
- `sessionStorage` is read from the signed-in, same-origin pages (Playwright's `storageState()` omits it) so the captured model matches §2.1 step 5.
- **Residual limitation**: the classifier's `authenticated` value reports session use, not verified protection (see `authClassifier.ts` and §3.2). State is scoped by hostname; a target that sets an unrelated parent-domain cookie will have that cookie retained only when it legitimately applies to the scope host.
