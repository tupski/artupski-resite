# Privacy Specification & Local-First Principles

## 1. Local-First Architecture Guarantee

Artupski ReSite enforces an uncompromising local-first computing model.

```
+-----------------------------------------------------------------------------------+
|                        LOCAL MACHINE STORAGE BOUNDARY                             |
|                                                                                   |
|  [SQLite Database]      [Screenshots & Assets]     [Blueprints & Projects]        |
|  - URL History           - Full page PNG/WebP      - Component Tree JSON          |
|  - Encrypted Sessions    - Fonts, SVGs, CSS files  - Generated React Code         |
|                                                                                   |
|                   ZERO REMOTE CLOUD SYNC / ZERO TELEMETRY                         |
+-----------------------------------------------------------------------------------+
                                         |
                                         | Explicit LLM Invocation Only
                                         v
                      +-------------------------------------+
                      | External LLM Provider API           |
                      | (OpenAI / Anthropic / OpenRouter)   |
                      +-------------------------------------+
```

### 1.1 Data Residency
- All scan runs, harvested network traffic, computed DOM trees, responsive layout screenshots, blueprint AST models, cloned code repositories, and SQLite databases reside strictly on local disk (`%LOCALAPPDATA%` on Windows, `~/Library/Application Support` on macOS).
- No telemetry, analytics, event tracking, crash reporting, or diagnostic pings are sent to any Artupski or third-party tracking servers.

---

## 2. Transparency Around LLM Data Transmission

Network traffic leaves the local machine strictly under two scenarios:
1. Target website scanning (Playwright outbound HTTP/HTTPS requests to target site).
2. Remote LLM API requests for blueprint synthesis and code generation.

### 2.1 Explicit LLM Payload Inventory
When an LLM request is triggered, payload content is restricted to:
- Extracted DOM structure outline (HTML tags, CSS classes, element hierarchy).
- Extracted design tokens (colors, font family names, spacing values, border radiuses).
- System prompt instructions and JSON schema validation rules.

### 2.2 Data Never Sent to LLM
- User credentials, session tokens, cookies, and `localStorage` states.
- Local system paths, user home directory names, or OS username.
- Binary asset payloads (images, fonts, binary downloads) unless explicitly invoking vision models with user-selected UI crop screenshots.

### 2.3 Anonymization & PII Scrubbing
Before sending DOM snippets to remote LLM endpoints:
- Email addresses matched via `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}` are replaced with `user@example.com`.
- Phone numbers matched via E.164 / standard formats are masked with `+1-555-0100`.
- Authentication tokens, API keys, or JWTs found in attributes/scripts are stripped.

---

## 3. Session Purging & Key Revocation Procedures

Users maintain full sovereign control over local storage and external credentials.

### 3.1 One-Click Session Purge
- Location: Settings -> Privacy -> Purge Session Data.
- Actions executed:
  1. Delete all encrypted records in `scan_sessions` table.
  2. Clear temporary Playwright profile cache directories (`AppData/Local/Temp/artupski-playwright-*`).
  3. Overwrite in-memory session caches with zeros.

### 3.2 Key Revocation
- Users can clear stored API keys from OS Keychain at any time via Settings -> API Keys -> Revoke Key.
- Application executes immediate native OS keychain deletion calls and unloads memory references.

### 3.3 Full Project Wipe
- Deleting a project permanently deletes all corresponding SQLite records (`projects`, `scan_runs`, `assets`, `blueprints`) using foreign key `CASCADE` rules and unlinks the on-disk asset directory (`rm -rf AppData/Local/ArtupskiReSite/projects/{project_id}`).
