# Phase 15 Implementation Plan — Settings, Telemetry, Security & Error Handling Hardening

Source of truth: `docs/product/PLAN.md` (Phase 15 §562-574). Supporting:
`docs/security/SECURITY.md` §2 (API key management & OS keychain), §3.3 (session seed
limitation), §4 (prompt/data separation), `docs/security/PRIVACY.md` §3 (purge / key
revocation), `docs/architecture/ERROR-HANDLING.md` §1-4, `docs/architecture/EVENT-SYSTEM.md`
§2-3, `docs/architecture/ARCHITECTURE.md` §3.6/§4, `docs/architecture/DATABASE.md` §2/§3,
`docs/design/UI-SPEC.md` §2.1/§3/§5, `docs/dev/TESTING.md`, `AGENTS.md` §2/§6/§7/§9,
`docs/impl-plan/phase-10-impl-plan.md`, `phase-11-impl-plan.md`, `phase-12-impl-plan.md`,
`phase-13-impl-plan.md`, `phase-14-impl-plan.md`, and the `anti-ui-slop` skill.

> Written after the mandatory repository audit and **before** any implementation. Where the
> pre-implementation roadmap wording and the architecture/spec docs disagree, the hierarchy
> **PLAN.md (authoritative, newest) > spec > architecture docs > PRD** is applied and every
> deviation is recorded in §20 here and in `CHANGELOG.md`.

---

## 1. Phase identification

**Phase 15 — Settings, Telemetry, Security & Error Handling Hardening.**

This is the final hardening phase before Phase 16 (E2E integration + release packaging). It
consumes the settings, secret, error, and event surfaces built in Phases 1-14 and closes the
hardening items those phases explicitly deferred to Phase 15 (OS-keychain key storage, a
global React error boundary, an error-notification toast system, and a complete Settings
screen).

## 2. Objective

Finalize the application so that **invalid configurations surface actionable errors without
crashing the app**, and so that **secrets are never persisted or emitted in the clear**:

1. **Complete the Settings screen** — full, persisted management of theme, AI provider
   configuration (base URL / model / key), and crawler defaults, plus a security/retention
   surface (revoke key, purge captured sessions).
2. **Move the AI API key off plaintext SQLite into the OS keychain** (`SECURITY.md` §2.1,
   `AGENTS.md` §6.1), with an honest migration from the existing `app_settings.ai.credentials`
   row and a fail-closed path when no OS secret store is available.
3. **Sanitize secrets from logs and export** — reuse the existing `redactSecrets` helper at
   every logging/export/event boundary so cookie/token/key material can never reach a log sink
   or the Phase 14 exporter.
4. **Wrap the UI tree in a global React error boundary** with user-friendly recovery actions.
5. **Ship an error-notification toast system** so structured errors become visible, actionable
   notices instead of silent failures, including a guard for unhandled background-worker /
   IPC exceptions.

It is a **UI + service + narrow native** increment. It adds the first new Rust command surface
since Phase 9 (a keychain boundary) and the first shared UI chrome components under
`src/components/common/`, while reusing every existing store, event, error, and provider
abstraction.

## 3. Repository audit (actual repository state)

All commands were run against the working tree before writing this plan.

**Git state (exact output):**

```
$ git status
On branch main
Your branch is ahead of 'origin/main' by 4 commits.
  (use "git push" to publish your local commits)

nothing to commit, working tree clean

$ git status --porcelain=v1 -uall
(empty output)

$ git branch --show-current
main

$ git log -5 --oneline
9d78324 feat(export): add project export and documentation generation (phase 14)
4d1869b feat(diff): add visual verification and diff engine (phase 13)
8162cf1 feat(generator): add full-stack project generator (phase 12)
e19ae02 feat(generator): add AI component extraction and synthesis (phase 11)
ce36103 feat(ai): add OpenAI-compatible AI provider abstraction and generation engine

$ git diff --stat
(empty output)

$ git log -1 --format="%H %ci"
9d78324ede9bf7244f360e2fadaa9d28462e5eef 2026-10-03 03:24:27 +0700
```

- **Baseline commit:** `9d78324ede9bf7244f360e2fadaa9d28462e5eef` (Phase 14).
- **Branch:** `main`; **working tree:** clean; **4 commits ahead of `origin/main`**
  (`e19ae02`…`9d78324`); nothing staged, nothing untracked.

**Baseline verification (all run in this audit):**

| Gate | Command | Result |
| :--- | :--- | :--- |
| Typecheck | `npm run typecheck` | **PASS** (exit 0, no output) |
| Lint | `npm run lint` | **PASS** (exit 0, `--max-warnings 0`) |
| Test | `npm run test` | **PASS** — **909 passed / 25 skipped (934)**, **94 files passed / 10 skipped**, duration **96.13 s** |
| Build | `npm run build` | **PASS** — `tsc --noEmit && vite build`, `✓ built in 6.80s` (existing chunk-size / dynamic-vs-static import warnings only, non-fatal) |
| Rust | `cargo check --manifest-path src-tauri/Cargo.toml` | **PASS** (`Finished dev profile … in 25.05s`) |
| Format | `npm run format:check` | **RED (pre-existing)** — 106 files are not Prettier-formatted; **not in the DoD** (`AGENTS.md` §9) and unchanged by Phase 15 |

No pre-existing test failures. The 25 skipped tests are the opt-in browser/AI/build/export E2E
suites gated by `RUN_BROWSER_TESTS` / `RUN_AI_TESTS` / `RUN_PROJECT_BUILD` / `RUN_EXPORT_E2E`.

**Existing coverage relevant to Phase 15 (what is already built):**

- **Settings screen exists but is incomplete** — `src/routes/SettingsRoute.tsx` renders an
  Appearance panel (theme radios + `compactDensity` checkbox), an AI-provider panel, and a
  `Workspace` placeholder that literally says *"Not configured (later phase)"*.
- **Theme is already fully persisted** — `src/stores/settingsStore.ts` (`resite.settings`
  localStorage key via Zustand `persist`), consumed by `AppHeader` and `SettingsRoute`.
- **AI base URL / model / key form already exists** — `src/stores/aiStore.ts` +
  `src/components/settings/AiProviderPanel.tsx` (provider presets, `validateBaseUrl`, key
  masking, honest `unconfigured | idle | testing | ready | error` states) and
  `src/services/ai/config.ts` (base-URL validation, separate `ai.config` / `ai.credentials`
  keys).
- **The AI API key is stored in plaintext in `app_settings`** — `AI_CREDENTIALS_KEY =
  'ai.credentials'` (`src/services/ai/config.ts:18`). `SettingsRoute.tsx:132-133` and
  `SECURITY.md` §3.3 both record that OS-keychain storage is **deferred to Phase 15**.
- **Session cookies are already encrypted at rest** — `src/services/auth/crypto.ts`
  (AES-256-GCM + PBKDF2-HMAC-SHA512 100k) and `authSessionService.ts`; the seed is a random
  per-install value in `app_settings` (`auth.installation_id`), explicitly documented as an
  installation identifier, **not** keychain-backed (`SECURITY.md` §3.3).
- **`redactSecrets` already exists** — exported from `src/services/auth/crypto.ts`; the Phase 5
  notes describe it as "a defensive last line". It is **not yet wired** into the logger, the
  event bus, or the Phase 14 exporter.
- **A toast *store* exists but nothing renders it** — `src/stores/uiStore.ts` exposes
  `notices: Notice[]` with `pushNotice` / `dismissNotice`; the only consumer is `Sidebar.tsx`
  (sidebar state). There is **no toast region component**, no auto-dismiss, and no
  error-event bridge.
- **No error boundary exists anywhere** — a search for `ErrorBoundary|errorBoundary` across
  `src` returns nothing. `src/app/App.tsx` mounts `<RouterProvider>` directly.
- **No `src/services/security/` and no `src/components/common/` directory exist** — both are
  greenfield.
- **No keychain/native secret support exists** — `src-tauri/Cargo.toml` depends only on
  `tauri`, `serde`, `serde_json`; there is **no `keyring` crate**, no `tauri-plugin-*`, and
  `src-tauri/capabilities/default.json` remains `["core:default"]` only. `src-tauri/src/lib.rs`
  registers `app_info`, `runtime_info`, the storage/asset/clone/blueprint file commands, and
  the four `process_*` commands — no secret command.
- **Crawler limits are hard-clamped** — `src/services/scanner/crawlLimits.ts` fixes
  `maxConcurrency` at **1** (`HARD_CRAWL_LIMITS.maxConcurrency = 1`, clamped in
  `resolveCrawlLimits`) because the Phase 3/4 worker holds a single abort controller per
  browser session. `maxDepth`/`maxPages`/`headless` are **transient Scan-screen state**
  (`src/routes/ScanRoute.tsx`), not persisted settings.
- **Errors are centralized** — `src/services/infra/errors.ts` (`ErrorCode` union,
  `ErrorCategory`, `createStructuredError`, `toStructuredError`), plus factories
  `src/services/scanner/errors.ts`, `src/services/infra/processErrors.ts`,
  `src/services/storage/errors.ts`, `src/services/ai/errors.ts`.
- **Events are centralized** — `src/services/infra/eventBus.ts` (`EventDomain`, `AppEventType`,
  `AppEventPayloadMap`, `createEvent`, `eventBus`). There is **no `security` domain and no
  `app.error` event** yet.
- **The logger is the single sanctioned console boundary** — `src/services/infra/logger.ts`,
  with pluggable sinks. No sink scrubs secrets today.
- **No `process_logs` table exists** — `DATABASE.md` §3 sketches it and `EVENT-SYSTEM.md` §4
  describes it, but migrations `001`-`008` never create it (verified: no `process_logs`
  reference in `src/services/storage/migrations/`).

**Documentation discrepancies found (recorded, not silently resolved):**

1. `PLAN.md` Phase 15 **Goal** says "credential encryption" and **Scope** says "API key secure
   storage"; `SECURITY.md` §2.1 mandates an OS keychain. The phase title also says
   **"Telemetry"**, but no scope bullet names a telemetry *table*, and `process_logs` is
   sketched only in `DATABASE.md`/`EVENT-SYSTEM.md`. Resolution in §5/§20 (C3).
2. `PLAN.md` Phase 15 task 1 says **"crawler concurrency"**, but `crawlLimits.ts` fixes
   concurrency at 1 by architecture. Resolution in §5/§20 (C2).
3. `DATABASE.md` §6 / `PRIVACY.md` §3 name a `scan_sessions` table and a
   `AppData/Local/ArtupskiReSite/projects/{id}` wipe path; the as-built tables/paths differ
   (`auth_sessions`, app-local-data sandbox). Phase 15 aligns the *settings* wording, not the
   storage layout (already documented as-built).
4. `UI-SPEC.md` §2 does not define a dedicated Settings screen; §2.1 lists per-scan
   configuration and §3 defines the design tokens. Phase 15 extends the existing
   `SettingsRoute` using the §3 token system (no new design language).

**Risks / unverifiable assumptions (stated, not guessed):**

1. Adding the `keyring` crate has **not** been compiled during this read-only audit. Windows
   uses the Credential Manager backend (builds without extra services); Linux needs an active
   Secret Service/DBus daemon (`TODO.md` open question). This is the single largest build risk
   of the phase and is mitigated in §12/§20 (C1).
2. `format:check` is RED across 106 files at baseline; Phase 15 will not run `prettier --write`
   over unrelated files (that would create an unreviewable diff). New/changed files should be
   authored Prettier-clean where practical, but `format:check` is **not** a Phase 15 gate.

## 4. Requirements traceability matrix

Authoritative requirement text is quoted in §5. Every requirement maps to an implementation
or to a documented reason it is already satisfied.

| # | Requirement | Authoritative source | Existing coverage | Required change | Verification |
| :-- | :--- | :--- | :--- | :--- | :--- |
| **R1** | "Provide full settings management" | PLAN §568 | `SettingsRoute` (theme + AI + placeholder); `settingsStore` (theme/density) | Add crawler-defaults panel + security panel; make `Workspace` real | `SettingsRoute.test.tsx`, `settingsStore.test.ts` |
| **R1a** | AI base URL management | PLAN §568 | `AiProviderPanel` + `aiStore` + `validateBaseUrl` | Reuse unchanged; surface save/test failures as toasts | existing `AiProviderPanel.test.tsx` + new toast assertions |
| **R1b** | API key management | PLAN §568 | Form + masking exist; key stored **plaintext** in `app_settings` | Move key to OS keychain with honest migration (§9) | `keychain.test.ts`, `config.test.ts`, leakage test (R6) |
| **R1c** | Crawler concurrency | PLAN §568 | `crawlLimits.ts` hard-fixes concurrency at **1** | Persist **depth/pages/headless/viewports/blueprint** defaults; do **not** show a fake concurrency dial (C2) | `settingsStore.test.ts`, `ScanRoute` seed test |
| **R1d** | Theme management | PLAN §568 | Fully implemented (`settingsStore`, `AppHeader`, `SettingsRoute`) | **Already satisfied** — no change (retain) | existing `settingsStore.test.ts` / `AppShell.test.tsx` |
| **R2** | "API keys … securely stored" | PLAN §569; SECURITY §2.1; AGENTS §6.1 | Plaintext `ai.credentials` in SQLite | New Rust keychain boundary + TS service + migration (§9) | `keychain.test.ts`, native `cargo check`, leakage test |
| **R3a** | "session cookies … securely stored" | PLAN §569; SECURITY §3.1 | **Already satisfied** (AES-256-GCM, `auth_sessions`, PBKDF2) | No change to the cipher; verify no regression | existing `crypto.test.ts` / `authSessionService.test.ts` |
| **R3b** | "sanitized from export logs" | PLAN §569 | `redactSecrets` exists but is unwired | Wire redaction into logger sinks, export events, and toast payloads | `redaction.test.ts`; exporter leakage assertions |
| **R4** | "Wrap UI tree in error boundaries with user-friendly recovery actions" | PLAN §570 | **None** | New `ErrorBoundary.tsx` + wrap `App.tsx` | `ErrorBoundary.test.tsx` (R7) |
| **R5** | "error notification toast system" | PLAN §564 | `uiStore.notices` exists, nothing renders it | New `ToastRegion.tsx` + auto-dismiss + error-event bridge | `ToastRegion.test.tsx`, `uiStore.test.ts` |
| **R6** | "Security key leakage tests" | PLAN §571 | `crypto.test.ts` asserts no plaintext in the session row | Add tests asserting the AI key never appears in `app_settings`, logs, events, or export output | `keychain.test.ts`, `redaction.test.ts`, `config.test.ts` |
| **R7** | "error boundary trigger tests" | PLAN §571 | **None** | Tests that a thrown child renders the fallback + recovery actions | `ErrorBoundary.test.tsx` |
| **R8** | "Invalid configurations surface actionable errors without app crashes" | PLAN §572 | AI panel shows inline errors; no toast; no boundary | Toasts for structured errors + boundary catch; no raw stack in UI | `SettingsRoute.test.tsx`, `ToastRegion.test.tsx` |
| **R9** | "Provide invalid AI URL; confirm clean error toast and recovery option" | PLAN §574 | `validateBaseUrl` rejects it inline | Route the failure to a toast with a recovery action | integration test: invalid URL → toast + recover |
| **R10** | "Unhandled exceptions in background workers breaking IPC bridge" (risk) | PLAN §573 | `ProcessManager` handles unexpected exit; no UI guard | Global `error`/`unhandledrejection` guard + process-exit toast | `globalErrorHandlers.test.ts`; no bridge crash |
| **R11** | Telemetry surface (phase **title** only) | PLAN §562 (title) | `eventBus` + `logger` + bounded event domains | Interpreted as the existing bounded event/log surface + toasts; **no new telemetry table** (C3) | §20 C3; existing `eventBus.test.ts` / `logger.test.ts` |

**No requirement is left unmapped.** R1d and R3a are already satisfied and are verified as
regression coverage; R11 is satisfied by the existing event/logger surface and is explicitly
scoped out of new persistence in §20 (C3).

## 5. Exact implementation scope

Authoritative `PLAN.md` text (verbatim, §562-574):

> **Phase 15: Settings, Telemetry, Security & Error Handling Hardening**
> - **Goal**: Finalize application settings, credential encryption, error boundaries, and crash recovery.
> - **Scope**: Settings UI, API key secure storage, global React error boundary, error notification toast system.
> - **Dependencies**: All prior phases.
> - **Files/Modules Affected**: `src/components/settings/`, `src/services/security/`, `src/components/common/ErrorBoundary.tsx`.
> - **Implementation Tasks**:
>   1. Provide full settings management (AI base URL, keys, crawler concurrency, theme).
>   2. Ensure API keys and session cookies are securely stored and sanitized from export logs.
>   3. Wrap UI tree in error boundaries with user-friendly recovery actions.
> - **Tests**: Security key leakage tests and error boundary trigger tests.
> - **Acceptance Criteria**: Invalid configurations surface actionable errors without app crashes.
> - **Potential Risks**: Unhandled exceptions in background workers breaking IPC bridge.
> - **Verification**: Provide invalid AI URL; confirm clean error toast and recovery option.

Scope decisions taken (state as decisions; validated against code in §3/§7):

1. **S1 — Complete the Settings screen** (`src/components/settings/`, `src/routes/SettingsRoute.tsx`):
   a `CrawlerSettingsPanel` (persisted depth/pages/headless + viewport/blueprint toggles that
   seed the Scan screen) and a `SecuritySettingsPanel` (key status + revoke, captured-session
   purge, honest "secrets are never logged" note). Theme and AI panels are retained.
2. **S2 — OS-keychain API-key storage**: a narrow Rust boundary (`src-tauri/src/secret.rs`,
   `keyring` crate, service `com.artupski.resite.apikeys`, account = provider slug) exposed as
   `secret_set` / `secret_get` / `secret_delete` / `secret_available`, wrapped by
   `src/services/security/keychain.ts`. `src/services/ai/config.ts` reads the key from the
   keychain first, migrates any legacy `app_settings.ai.credentials` value once, and then
   deletes the plaintext row. When no OS store is available the key is **not** persisted
   (fail closed) and an honest `SECRET_STORAGE_UNAVAILABLE` is surfaced — plaintext is never
   re-introduced.
3. **S3 — Secret redaction**: `src/services/security/redaction.ts` reuses
   `redactSecrets` from `src/services/auth/crypto.ts` and exposes a logger sink scrubber plus a
   bounded event/export payload scrubber, wired into `src/services/infra/logger.ts` (default
   sink) and asserted against the Phase 14 exporter output.
4. **S4 — Global error boundary** (`src/components/common/ErrorBoundary.tsx`): a class
   boundary around the routed tree with recovery actions ("Try again" resets the boundary
   subtree, "Reload application", "Copy error details"). No stack trace is rendered as UI text.
5. **S5 — Toast system** (`src/components/common/ToastRegion.tsx` + `src/stores/uiStore.ts`):
   extend the existing `notices` model with severity/tone, auto-dismiss timing, and a bounded
   queue; render an `aria-live` region in `AppLayout`; bridge `AppEventType` error events and
   structured failures into notices.
6. **S6 — Crash/IPC resilience**: register `window` `error` and `unhandledrejection` handlers
   in `App.tsx` that push a bounded notice (never rethrow into the render tree), and bridge
   `process.exited`/`process.failed` into a toast so a worker crash is visible but never takes
   the UI down.
7. **S7 — Tests**: security key-leakage tests and error-boundary trigger tests are the
   PLAN-mandated suites; plus store/toast/settings/keychain/redaction suites.
8. **S8 — No new telemetry persistence**: the phase title's "Telemetry" is satisfied by the
   existing bounded `eventBus` + `logger`; **no `process_logs` table/migration** is added
   (C3, §20).

## 6. Explicit exclusions

- **No Phase 16 work.** No `e2e/` pipeline suite, no Tauri release bundler / installer / code
  signing, no `tauri.conf.json` bundle-target changes.
- **No new telemetry table or `process_logs` migration.** `DATABASE.md` §3's `process_logs`
  sketch remains deferred; the title's "Telemetry" maps to the existing event/log surface (C3).
- **No change to the session cipher.** `crypto.ts` (AES-256-GCM/PBKDF2), `auth_sessions`,
  `authClassifier`, and the interactive-capture flow are untouched. The *seed* stays a
  per-install `app_settings` value; moving it to the keychain is **not** in the Phase 15 scope
  bullets (the bullets name API keys, not the session KDF seed) and is recorded as deferred
  (C4, §20). This preserves the documented `SECURITY.md` §3.3 limitation rather than silently
  claiming a stronger guarantee.
- **No new AI provider/model work** beyond key *storage*; `provider.ts`, `pipeline.ts`,
  `presets.ts`, and the Phase 11/12/13/14 engines are untouched.
- **No crawler concurrency control** (the architecture fixes it at 1) and no change to
  `crawlLimits.ts` hard bounds (C2).
- **No speculative state framework, no new UI library.** Reuse the existing `Panel`, `Button`,
  `Input`, `Badge`, `StatusIndicator`, `EmptyState`, and CSS-variable tokens; the toast/error
  chrome is hand-built to `anti-ui-slop` (no MUI/AntD per `AGENTS.md` §8).
- **No secret ever leaves the process boundary.** No key material in events, logs, toasts,
  exports, or the DOM.
- **No unrelated Prettier reformat** of the 106 pre-existing non-conforming files.

## 7. Existing architecture / components to reuse (do not duplicate)

| Need | Reuse (exact symbol + `path:line`) |
| :--- | :--- |
| Settings persistence (theme/density) | `useSettingsStore`, `SETTINGS_STORAGE_KEY` (`src/stores/settingsStore.ts:11,22`) |
| Transient notices store | `Notice`, `UiState.notices`, `pushNotice`, `dismissNotice` (`src/stores/uiStore.ts:9,15-23,37-42`) |
| AI config + key persistence | `loadAIConfig`/`saveAIConfig`/`loadAIKey`/`saveAIKey`, `AI_CREDENTIALS_KEY` (`src/services/ai/config.ts:17-18,53,63,93,117`) |
| AI engine seam | `AiEngine`, `createAiEngine` (`src/services/ai/engine.ts:59,88`) |
| AI settings accessor seam | `AISettingsAccess` (`src/services/ai/config.ts:39`) — extend, don't fork |
| Structured errors | `ErrorCode`, `ErrorCategory`, `StructuredError`, `createStructuredError`, `toStructuredError` (`src/services/infra/errors.ts:24,11,70,100,124`) |
| Error factories | `createProcessError` (`src/services/infra/processErrors.ts:55`), `createStorageError` (`src/services/storage/errors.ts`), `createAiError` (`src/services/ai/errors.ts`) |
| Events | `EventDomain`, `AppEventType`, `AppEventPayloadMap`, `createEvent`, `eventBus` (`src/services/infra/eventBus.ts:11,30,619,724,814`) |
| Logger + sinks | `Logger`, `LogSink`, `logger` (`src/services/infra/logger.ts:55,24,147`) |
| Secret redaction | `redactSecrets` (`src/services/auth/crypto.ts`) |
| IPC wrapper convention | `safeInvoke` + `IpcResult<T>` (`src/services/ipc/commands.ts:81,50`) |
| Native command registration | `src-tauri/src/lib.rs:58-85` (`generate_handler!`) |
| Native sandbox conventions | `src-tauri/src/storage.rs` (fixed target + containment + atomic write), `asset.rs`/`clone.rs`/`blueprint.rs` |
| Settings UI primitives | `Panel`, `Input`, `Button`, `Badge`, `StatusIndicator`, `EmptyState` (`src/components/ui/`) |
| Existing AI panel | `AiProviderPanel` (`src/components/settings/AiProviderPanel.tsx`) |
| Scan configuration state | `ScanRoute` config (`src/routes/ScanRoute.tsx:521-551`) |
| Crawl limits (fixed concurrency) | `resolveCrawlLimits`, `HARD_CRAWL_LIMITS` (`src/services/scanner/crawlLimits.ts:38,84`) |
| Session lifecycle (for purge) | `authSessionService` clear/purge (`src/services/auth/authSessionService.ts`) |
| UI design tokens | `UI-SPEC.md` §3.1 → `src/styles/tokens.css`, Tailwind utilities |
| Test conventions | `src/test/setup.ts`, Testing Library; storage in-memory helper `createTestStorage()` |

## 8. Input / output / public contracts

All shapes are implementation-ready TypeScript. New public types live beside their services
(or in `src/types/`); native payloads mirror the existing `commands.ts` conventions.

### 8.1 Keychain service (`src/services/security/keychain.ts`)

```ts
export interface SecretRef {
  /** Account within the app service, e.g. a provider slug (`openai`). */
  readonly account: string;
}

export type SecretResult =
  | { ok: true; value: string | null }
  | { ok: false; error: StructuredError };

/** True when an OS secret store is usable in this environment. */
export function secretAvailable(): Promise<boolean>;

/** Read a secret; `null` when absent. Never logs the value. */
export function getSecret(account: string): Promise<SecretResult>;

/** Write/replace a secret. Empty value deletes it. */
export function setSecret(account: string, value: string): Promise<{ ok: boolean; error?: StructuredError }>;

/** Delete a secret; missing is success. */
export function deleteSecret(account: string): Promise<{ ok: boolean; error?: StructuredError }>;
```

Native commands (Rust): `secret_available() -> bool`, `secret_get(account) -> Option<String>`,
`secret_set(account, value)`, `secret_delete(account)`. The frontend never supplies a service
name or a path; the Rust module hard-codes the service identifier.

### 8.2 Redaction (`src/services/security/redaction.ts`)

```ts
/** Scrub secret-looking fields from an arbitrary structured value (recursive). */
export function scrubSecrets<T>(value: T): T;

/** A `LogSink`-compatible scrubber that redacts metadata + error details. */
export function createRedactingSink(next: LogSink): LogSink;
```

Reuses `redactSecrets` (`src/services/auth/crypto.ts`) for the field-name/pattern rules.

### 8.3 Crawler settings (persisted)

```ts
export interface CrawlerSettings {
  maxDepth: number;   // clamped 1..5 by the Scan screen
  maxPages: number;   // clamped 1..200
  headless: boolean;
  captureViewports: boolean;
  generateBlueprint: boolean;
}
```

Added to `SettingsState` with `setCrawlerSettings(partial)`; persisted under the existing
`resite.settings` key. The Scan screen seeds its initial configuration from these values.

### 8.4 Toast/notice model (`src/stores/uiStore.ts`, extended)

```ts
export interface Notice {
  id: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
  message: string;
  /** Optional actionable label + handler (recovery affordance). */
  action?: { label: string; kind: 'retry' | 'reload' | 'settings' };
  /** Auto-dismiss after this many ms; 0 = sticky. */
  durationMs: number;
}
```

`pushNotice` gains an optional `durationMs`; a bounded queue (max 5) drops the oldest notice.

### 8.5 Error boundary props (`src/components/common/ErrorBoundary.tsx`)

```ts
export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback; the default is the honest recovery panel. */
  fallback?: (state: { error: Error; reset: () => void }) => ReactNode;
  /** Called with a scrubbed error description (never a secret). */
  onError?: (info: { message: string; code?: string }) => void;
}
```

### 8.6 New error codes (`src/services/infra/errors.ts`, appended to `ErrorCode`)

```ts
| 'SECRET_STORAGE_UNAVAILABLE'
| 'SECRET_READ_FAILED'
| 'SECRET_WRITE_FAILED'
```

No new `ErrorCategory`: use the existing `io` category (secret storage is a native/IO concern).

### 8.7 New events (`src/services/infra/eventBus.ts`)

`EventDomain` gains `'security'`. `AppEventType` gains:

```ts
| 'security.key_stored'
| 'security.key_revoked'
| 'security.key_unavailable'
```

Payloads carry a provider id / boolean / bounded code only — **never** the key value. An
`app.error` event is **not** added; toasts are fed by existing structured-error results and by
a small `pushNotice` bridge, keeping the taxonomy minimal.

## 9. Data model & migration implications

- **SQLite schema:** **no migration.** The AI key leaves `app_settings`; it does not gain a
  table. The legacy `ai.credentials` row is read once for migration and then deleted via the
  existing `SettingsRepository.delete` (`src/services/storage/repositories/settingsRepository.ts`).
  No `MIGRATIONS` array change, so all `001`-`008` checksums remain stable.
- **Keychain layout (external store):** service `com.artupski.resite.apikeys`, account =
  provider slug (`openai`, `openrouter`, `ollama`, …). No path or service is caller-supplied.
- **Migration path (forward-only, honest):**
  1. On `loadAIKey`, if a keychain entry exists → use it.
  2. Else if a legacy `app_settings.ai.credentials` value exists → use it **and** attempt a
     one-time keychain write; on success delete the plaintext row; on failure keep the plaintext
     row for this run and surface `SECRET_STORAGE_UNAVAILABLE` (never silently lose the key).
  3. Else → no key.
- **No data loss:** the migration is idempotent and only deletes plaintext after a confirmed
  keychain write.
- **`auth_sessions`** is unchanged (R3a already satisfied). Session **purge** reuses the
  existing repository delete/purge APIs; it is a data operation, not a schema change.
- **`process_logs`** is **not** created (C3).

## 10. Module & file changes

| Path | Change | Purpose |
| :--- | :--- | :--- |
| `src-tauri/src/secret.rs` | **New** | Narrow OS-keychain boundary (`secret_available/get/set/delete`) via the `keyring` crate; service id hard-coded; no path/service from the caller. |
| `src-tauri/src/lib.rs` | **Changed** | `mod secret;` + register the four `secret_*` commands in `generate_handler!`. |
| `src-tauri/Cargo.toml` | **Changed** | Add `keyring = { version = "3", features = [...] }` (feature set chosen per platform at implementation; see §12/§20 C1). |
| `src/services/security/keychain.ts` | **New** | TS wrapper over `secret_*` with `IpcResult` mapping and honest `SECRET_STORAGE_UNAVAILABLE`. |
| `src/services/security/redaction.ts` | **New** | `scrubSecrets` + `createRedactingSink`, reusing `redactSecrets`. |
| `src/services/security/index.ts` | **New** | Barrel (mirrors other service barrels). |
| `src/services/security/__tests__/keychain.test.ts` | **New** | Available/unavailable, get/set/delete, no-plaintext, error mapping. |
| `src/services/security/__tests__/redaction.test.ts` | **New** | Recursive scrubbing of keys/cookies/tokens in metadata + export payloads. |
| `src/services/ai/config.ts` | **Changed** | `loadAIKey`/`saveAIKey` prefer the keychain, migrate legacy plaintext once, fail closed when unavailable. |
| `src/services/ai/engine.ts` | **Changed (small)** | Surface `SECRET_STORAGE_UNAVAILABLE` honestly from `saveConfig`. |
| `src/services/infra/errors.ts` | **Changed** | Append `SECRET_STORAGE_UNAVAILABLE`, `SECRET_READ_FAILED`, `SECRET_WRITE_FAILED`. |
| `src/services/infra/eventBus.ts` | **Changed** | Add `'security'` domain + three `security.*` keys/payloads/map entries. |
| `src/services/infra/logger.ts` | **Changed (small)** | Optional default redacting sink wiring (or documented opt-in from `App.tsx`). |
| `src/services/ipc/commands.ts` | **Changed** | `secretAvailable`/`secretGet`/`secretSet`/`secretDelete` wrappers over `safeInvoke`. |
| `src/stores/settingsStore.ts` | **Changed** | Add `CrawlerSettings` + `setCrawlerSettings`; persist under `resite.settings`. |
| `src/stores/uiStore.ts` | **Changed** | Notice `action`/`durationMs`, bounded queue, auto-dismiss; `pushErrorNotice` helper. |
| `src/components/common/ErrorBoundary.tsx` | **New** | Global class error boundary + honest recovery panel. |
| `src/components/common/ErrorBoundary.test.tsx` | **New** | Trigger test: thrown child → fallback + recovery (PLAN-mandated). |
| `src/components/common/ToastRegion.tsx` | **New** | `aria-live` toast region rendering `uiStore.notices` with actions. |
| `src/components/common/ToastRegion.test.tsx` | **New** | Render, auto-dismiss, action invocation, a11y roles. |
| `src/components/common/errorBridge.ts` | **New** | Subscribes error events / structured results → `pushNotice` (scrubbed). |
| `src/components/common/errorBridge.test.ts` | **New** | Event → toast mapping; no secret in payload. |
| `src/components/settings/CrawlerSettingsPanel.tsx` | **New** | Crawler-defaults form bound to `settingsStore`. |
| `src/components/settings/CrawlerSettingsPanel.test.tsx` | **New** | Render + change + persistence assertions. |
| `src/components/settings/SecuritySettingsPanel.tsx` | **New** | Key status/revoke + session purge + honest "never logged" note. |
| `src/components/settings/SecuritySettingsPanel.test.tsx` | **New** | Revoke/purge flows, honest unavailable state. |
| `src/app/App.tsx` | **Changed** | Wrap `RouterProvider` in `ErrorBoundary`; mount `ToastRegion`; register `error`/`unhandledrejection` guards; start `errorBridge`. |
| `src/components/layout/AppLayout.tsx` | **Changed** | Render `ToastRegion` in the chrome. |
| `src/routes/SettingsRoute.tsx` | **Changed** | Mount the crawler + security panels; replace the "deferred keychain" copy. |
| `src/routes/ScanRoute.tsx` | **Changed (small)** | Seed configuration from persisted `CrawlerSettings`. |
| `src/services/scanner/scanService.ts` | **Changed (small)** | Accept persisted viewport/blueprint defaults from the caller (no behavior change when omitted). |
| `docs/product/PLAN.md`, `CHANGELOG.md`, `docs/README.md`, `docs/architecture/ARCHITECTURE.md`, `docs/architecture/EVENT-SYSTEM.md`, `docs/architecture/ERROR-HANDLING.md`, `docs/architecture/DATABASE.md`, `docs/dev/TESTING.md`, `docs/security/SECURITY.md`, `docs/design/UI-SPEC.md`, `AGENTS.md` | **Changed** | As-built notes, keychain status, `security.*` events, `SECRET_*` codes, test tier. |
| `docs/impl-plan/phase-15-impl-plan.md` | This file | — |

## 11. UI / UX behavior

Governed by `anti-ui-slop` and `UI-SPEC.md` §3/§5 (high-density, purposeful desktop
ergonomics; no neon/glow/floating-card tropes; visible focus; ≥32 px targets; ≥4.5:1 contrast).

- **Settings screen** (extends `SettingsRoute`, `PageShell` + `Panel` layout):
  - **Appearance** (unchanged): theme radios + compact density.
  - **AI provider** (retained): presets, base URL, model, masked key, connection test. Save/test
    failures now also raise a toast; inline error remains.
  - **Crawler defaults** (new): max depth (1-5), max pages (1-200), run-headless toggle,
    capture-viewports toggle, generate-blueprint toggle. A caption states plainly that
    **concurrency is fixed at 1** by the browser worker (no dead control). Values persist and
    seed the Scan screen.
  - **Security & privacy** (new): API-key status (configured / not configured / storage
    unavailable) with a **Revoke key** action; **Purge captured sessions** action; a plain
    statement that secrets are never written to logs or exports.
  - **Workspace** (replaces the placeholder): shows the sandboxed app-data location via the
    existing storage command, or an honest "unavailable" state.
- **Error boundary fallback**: a compact panel ("Something went wrong"), the scrubbed error
  message (no stack trace), and three actions — **Try again** (resets the boundary subtree),
  **Reload application**, **Copy error details**. Focus is moved to the panel heading; the
  region is `role="alert"`.
- **Toast region**: fixed, non-blocking, bottom-right (or top-right), stacked, max 5, each with
  tone icon + text + optional action + dismiss. `aria-live="polite"` for info/success,
  `aria-live="assertive"` for danger. Auto-dismiss (default 6 s; sticky for actionable
  errors), pause on hover/focus, keyboard-dismissible with `Escape`.
- **States**: every new surface has honest `loading | ready | empty | error | unavailable`
  states; nothing is fabricated (mirrors the Phase 4-14 store convention).
- **No layout regression**: chrome stays within the existing header/sidebar grid; toasts are an
  overlay, not a layout shift.

## 12. Security considerations

- **Keychain boundary (new native surface).** The Rust module hard-codes the service id and
  accepts only a bounded `account` slug (validated `[a-z0-9_-]{1,64}`); the frontend can never
  choose a service, path, or executable. No generic secret-store passthrough is exposed.
- **Fail closed.** If the OS store is unavailable, the key is **not** written to SQLite; the
  app surfaces `SECRET_STORAGE_UNAVAILABLE` and keeps the key only for the session. Plaintext
  persistence is never re-introduced. (This is the honest resolution of the Linux
  headless-DBus open question in `TODO.md`.)
- **Migration hygiene.** The legacy plaintext row is deleted only after a confirmed keychain
  write; a failed write leaves the key usable and reports the problem.
- **Redaction at every boundary.** `scrubSecrets` is applied to logger metadata/error details,
  toast payloads, and export-adjacent event payloads. Field rules reuse `redactSecrets`
  (cookie/authorization/token/password/apiKey/key), including arrays and nested objects.
- **No secret in events/DOM.** `security.*` payloads carry ids/booleans/codes only; the key is
  never rendered (masked input only) and never logged.
- **Session purge** performs a real delete through the existing repository (cryptographic
  deletion for `auth_sessions`) — no soft-delete that leaves ciphertext behind.
- **No CSP/capability widening for the keychain.** `secret_*` are custom app commands, not
  plugin permissions, so `capabilities/default.json` stays `["core:default"]` (same rationale as
  the Phase 3 `process_*` commands). The CSP is unchanged.
- **Error boundary safety.** The boundary and global handlers never rethrow into the render
  tree and never render `error.stack` as UI text; the message is scrubbed before display/copy.
- **No new network access.** Nothing in Phase 15 contacts the network except the pre-existing
  AI health check the user explicitly triggers.

## 13. Error & failure handling

- **Structured errors everywhere.** Every new failure is a `StructuredError` with an actionable
  `suggestedAction`; nothing is thrown at the UI. New codes: `SECRET_STORAGE_UNAVAILABLE`,
  `SECRET_READ_FAILED`, `SECRET_WRITE_FAILED` (`category: 'io'`).
- **Invalid AI configuration** (the PLAN verification case): `validateBaseUrl` rejects a bad
  URL; the store returns a structured error; a **danger toast** with a "Open settings" recovery
  action is shown; the app does not crash.
- **Keychain unavailable**: non-fatal; the AI panel shows an honest "key not stored" state and
  the scan/generation flows keep working without a persisted key.
- **Boundary catch**: any render/lifecycle throw in the routed tree renders the fallback;
  "Try again" resets the subtree so a transient fault recovers without an app reload.
- **Global guards**: `window.onerror` / `unhandledrejection` push a bounded notice and log a
  scrubbed entry; the IPC bridge is never left in a broken state (the guard does not touch the
  bridge).
- **Worker/IPC risk (PLAN §573)**: `process.exited` (unexpected) and `process.failed` are
  bridged to a warning toast with a "Try again" action; `ProcessManager` already owns restart
  and cleanup, so a worker crash surfaces without taking down the renderer.
- **Partial failures**: revoking a key that is already gone is a success; purging sessions when
  none exist is an honest empty state.
- **Never throws**: new services return discriminated results; the boundary is the last resort.

## 14. Test strategy

Default suite (`npm run test`, Vitest + Testing Library, deterministic, no network):

- **Key leakage (PLAN-mandated)** — `src/services/security/__tests__/keychain.test.ts`:
  `secret_*` mapping (available/unavailable), get/set/delete, and an assertion that the key
  value appears in **no** `app_settings` value, log entry, or emitted event.
  `redaction.test.ts`: recursive scrubbing of `apiKey`/`authorization`/`cookie`/`token`/
  `password` fields (incl. arrays) in metadata and in an export-shaped payload.
  `src/services/ai/__tests__/config.test.ts` (extended): keychain-first read, one-time legacy
  migration + plaintext deletion, and fail-closed when unavailable.
- **Error boundary trigger (PLAN-mandated)** — `src/components/common/ErrorBoundary.test.tsx`:
  a child that throws renders the fallback (no raw stack), `role="alert"`, focus movement, and
  each recovery action (reset / reload / copy) invoked correctly.
- **Toast system** — `ToastRegion.test.tsx`: render by tone, auto-dismiss, action invocation,
  `aria-live` politeness, Escape dismiss, bounded queue. `uiStore.test.ts` (extended): queue
  cap, auto-dismiss, `pushErrorNotice`.
- **Settings** — `settingsStore.test.ts` (extended): `CrawlerSettings` round-trip + clamp
  seeding. `CrawlerSettingsPanel.test.tsx`, `SecuritySettingsPanel.test.tsx`: render/change/
  revoke/purge + honest unavailable states.
- **Bridge** — `errorBridge.test.ts`: error event → scrubbed notice; no secret in the payload.
- **Regression** — the full existing suite must stay green (**909 passed / 25 skipped**
  baseline), especially `crypto.test.ts` (session cipher), `AiProviderPanel.test.tsx`,
  `AppShell.test.tsx`, the storage suite, and the Phase 12/13/14 service suites.

**Opt-in / native:** `cargo check` (and `cargo clippy --all-targets`) validate the new Rust
module compiles. A real keychain round-trip is environment-dependent; where no OS store is
present the test asserts the honest unavailable path rather than a false PASS.

## 15. Integration & E2E verification

- **Settings → Scan seed**: set crawler defaults in Settings, open Scan, assert the form is
  seeded from persisted values (component/integration test).
- **Invalid AI URL (PLAN verification, R9)**: type an invalid base URL in the AI panel, save →
  assert an actionable danger toast with a recovery action and **no crash** (integration test
  over `SettingsRoute` + `ToastRegion`).
- **Key lifecycle**: configure a key → keychain entry written and the legacy plaintext row
  removed → revoke → keychain entry gone and status honest.
- **Worker-crash resilience**: inject a simulated `process.exited` (unexpected) → assert a
  warning toast and that the routed UI remains mounted.
- **Boundary recovery**: force a child throw → fallback renders → "Try again" restores the
  tree without a reload.
- **Manual smoke (desktop)**: `npm run tauri:dev`; verify Settings panels, toast, boundary, and
  keychain on the host OS. Where a real OS keychain is unavailable, verify the honest
  unavailable state.
- **No later-phase work** is exercised (Phase 16 owns the full Scan→Blueprint→Project→Build
  pipeline and installer packaging).

## 16. Acceptance criteria (1:1 with `PLAN.md` §562-574)

1. Full settings management is delivered: AI base URL/keys, crawler defaults, and theme.
   *(PLAN task 1)* — with concurrency honestly documented as fixed at 1 (C2).
2. API keys are stored in the OS keychain and session cookies remain AES-256-GCM encrypted at
   rest; both are sanitized from logs and export output. *(PLAN task 2)*
3. The UI tree is wrapped in a global React error boundary with user-friendly recovery actions.
   *(PLAN task 3)*
4. An error-notification toast system surfaces structured errors, including background-worker
   failures, without crashing the app. *(PLAN scope)*
5. Security key-leakage tests and error-boundary trigger tests pass. *(PLAN Tests)*
6. Invalid configurations surface actionable errors without app crashes. *(PLAN Acceptance)*
7. Providing an invalid AI URL yields a clean error toast and a recovery option. *(PLAN
   Verification)*
8. All verification gates (§17) pass; Phases 1-14 behavior, events, and schema are unchanged.

## 17. Verification commands

```text
npm run typecheck
npm run lint
npm run test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

Focused Phase 15 suites:

```text
npx vitest run src/services/security
npx vitest run src/components/common
npx vitest run src/components/settings
npx vitest run src/stores/uiStore.test.ts src/stores/settingsStore.test.ts
```

`npm run format:check` is **pre-existing RED** (106 files) and is **not** a Phase 15 gate. The
`keyring` crate compiles on the host OS (`cargo check`) but a **real** keychain round-trip
requires a live OS secret store and is verified manually in the desktop shell.

## 18. Documentation changes

- `docs/product/PLAN.md`: mark Phase 15 COMPLETE with an as-built note (mirroring Phases 8-14).
- `CHANGELOG.md`: new `[Unreleased]` Phase 15 entry.
- `docs/README.md`: index `src/services/security/`, `src/components/common/`, and this plan.
- `docs/architecture/ARCHITECTURE.md`: §3.6 (infrastructure) + §4 (Rust boundary) keychain
  note; §5.x error/toast seam.
- `docs/architecture/EVENT-SYSTEM.md`: document the `security.*` domain.
- `docs/architecture/ERROR-HANDLING.md`: add the `SECRET_*` taxonomy rows.
- `docs/architecture/DATABASE.md`: note the key moved out of `app_settings` (no migration) and
  that `process_logs` remains deferred.
- `docs/security/SECURITY.md`: §2 keychain status as-built; §3.3 seed limitation retained
  (C4); redaction wiring.
- `docs/design/UI-SPEC.md`: record the Settings/toast/error-boundary as-built surfaces.
- `docs/dev/TESTING.md`: add the Phase 15 test tier.
- `AGENTS.md`: update §6.1 wording to reflect that the keychain boundary is now implemented.
- `docs/impl-plan/phase-15-impl-plan.md`: this plan.

## 19. Git / commit strategy

One focused commit on `main`:

```text
feat(security): add settings, keychain key storage, error boundary and toasts (phase 15)
```

Do not amend Phase 14; do not push. If the native `keyring` dependency proves unavailable in
the environment, the fallback is a **second, clearly-scoped** commit that keeps the honest
unavailable path (documented in §20) rather than shipping a broken build. One logical phase,
one reviewable boundary.

## 20. Specification discrepancies & justified deviations

1. **C1 — OS keychain via the `keyring` crate (new native dependency).** `SECURITY.md` §2.1
   and `AGENTS.md` §6.1 mandate OS keychain storage; Phase 10-14 deferred it to Phase 15. This
   is the phase's only new Rust dependency and is the largest build risk (Linux DBus). It is
   added because the roadmap explicitly scopes "API key secure storage"; the plan fails closed
   where no store exists instead of silently keeping plaintext. **Recorded, not silent.**
2. **C2 — "crawler concurrency" is not exposed as a control.** `PLAN.md` §568 names crawler
   concurrency, but `crawlLimits.ts` fixes `maxConcurrency` at **1** by architecture (a single
   abort controller per browser session). Phase 15 therefore persists the *honest* crawler
   defaults (depth, pages, headless, viewports, blueprint) and states plainly that concurrency
   is fixed. Shipping a dead concurrency dial would violate `anti-ui-slop` honesty.
3. **C3 — "Telemetry" adds no persistence.** The phase **title** says Telemetry, but no scope
   bullet names a telemetry table and `process_logs` exists only as a `DATABASE.md` sketch. The
   title's telemetry is satisfied by the existing bounded `eventBus` + `logger` + the new
   toasts; **no `process_logs` migration** is added (avoids speculative schema).
4. **C4 — the session-KDF seed stays a per-install `app_settings` value.** Phase 15's scope
   bullets name **API keys**, not the session encryption seed. Moving the seed to the keychain
   would change the documented `SECURITY.md` §3.3 threat model and is not required to satisfy
   any Phase 15 criterion. The limitation is retained and restated honestly (never presented as
   hardware-backed); moving it is deferred to a future hardening item.
5. **C5 — Error boundary is a class component.** React 18 has no hook equivalent for
   `componentDidCatch`; a class boundary under `src/components/common/ErrorBoundary.tsx` is the
   PLAN-named path and the standard, dependency-free approach (no `react-error-boundary`
   package).
6. **C6 — Toast system extends `uiStore`, it does not create a new store.** `uiStore.notices`
   already exists; Phase 15 adds severity/action/auto-dismiss and a renderer rather than a
   parallel notification store (no duplicated state).
7. **C7 — No new `ErrorCategory`.** The new `SECRET_*` codes reuse `category: 'io'`, matching
   the Phase 14 precedent of reusing existing categories.
8. **C8 — `format:check` remains RED and is not fixed.** The baseline is already red across 106
   files; reformatting them would create an unreviewable diff unrelated to Phase 15. New files
   are authored Prettier-clean where practical. Recorded so the red gate is not mistaken for a
   Phase 15 regression.

**Known limitations (informational, as built):**

- A real OS-keychain round-trip cannot be asserted in CI without a live secret store; the
  honest unavailable path is what the default suite verifies.
- The key is held in memory during an AI request by necessity (`provider.ts` reads it per
  call); Phase 15 does not add memory zeroization (the existing `SECURITY.md` §2.2 "cleared
  from heap" language remains aspirational and is restated honestly).

**Unresolved questions (deferred, not guessed):**

- Whether a later phase moves the session-KDF seed to the keychain (C4) and adds
  `process_logs` telemetry persistence (C3).
- Which exact `keyring` feature set is optimal across Windows/macOS/Linux headless (resolved at
  implementation, verified by `cargo check` + a manual desktop smoke test).

### As-built status (appended after implementation, Phase 15 complete)

Implementation matched this plan: all of §16's acceptance criteria are delivered and **no new
deviation beyond C1-C8 was discovered**. The verification gates in §17 all passed — `typecheck`,
`lint`, `test` (**986 passed / 25 skipped**), `build`, `cargo check`, `cargo clippy --all-targets`,
the focused Phase 15 suites, the regression suites, and the opt-in `RUN_EXPORT_E2E=1` exporter
suite. `format:check` remains pre-existing RED (repo-wide, not a gate; C8). The `keyring` crate v3
compiles with features `windows-native`, `apple-native`, `sync-secret-service` (Linux DBus); the
real round-trip remains a manual desktop check, as stated in §17 and the known limitations. The
plan's §3 audit and §5-§15 scope text are left as the pre-implementation record; the as-built
narrative lives in `docs/product/PLAN.md` (Phase 15 note) and `CHANGELOG.md`.
