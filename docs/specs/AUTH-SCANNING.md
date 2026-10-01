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

---

## 4. Encryption & Privacy Guarantees

### 4.1 Local Cryptographic Storage

- **Cipher**: AES-256-GCM (Galois/Counter Mode) authenticated encryption.
- **Key Derivation**: Key derived via PBKDF2 (100,000 iterations, SHA-512) using desktop app unique installation machine ID + project ID salt.
- **Storage Boundary**: Encrypted session records stored exclusively in local SQLite database file `resite.db`.
- **Zero Cloud Transmission**: Session tokens, auth headers, and cookies are strictly forbidden from being sent to external AI API endpoints, telemetries, or remote servers.
- **Prompt Sanitization**: AI Blueprint prompts filter out all `Authorization` headers, `Cookie` headers, `Bearer` tokens, and private session storage keys.

### 4.2 Session Clearance & Destruction

- **Explicit Project Session Clear**: User can click "Clear Session" in Project Settings to execute immediate cryptographic deletion:
  - `DELETE FROM auth_sessions WHERE project_id = ?;`
  - Playwright browser context storage state files deleted from filesystem.
- **Auto-Expiry Purge**: Session records past cookie `expires` timestamp are automatically purged before crawl execution.
- **Temporary Worker Context Isolation**: Each Playwright crawl worker runs in an ephemeral in-memory context; browser profile folders are deleted on worker exit.
