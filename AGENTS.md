# Agent Operations Manual (AGENTS.md)

## 1. Project Overview & Operational Mission

Artupski ReSite is a desktop-native reverse engineering, website cloning, and site blueprinting tool built on Tauri 2, React, TypeScript, Tailwind CSS, Playwright, SQLite, and external LLM APIs (OpenAI, Anthropic, OpenRouter).

All AI coding agents contributing to this codebase must adhere strictly to the operational boundaries, file structures, and technical mandates defined in this document.

---

## 2. Mandatory Frontend Skill Requirement

```
=====================================================================================
CRITICAL MANDATE FOR FRONTEND IMPLEMENTATION:
Before writing, modifying, reviewing, or styling ANY user interface, component,
CSS file, or layout, you MUST explicitly read and strictly comply with:

    C:\Users\Kakarama Room\.agents\skills\anti-ui-slop\SKILL.md

No generic AI interface templates. No low-contrast text. No missing loading states.
Ground all UI designs in production-grade ergonomics.
=====================================================================================
```

---

## 3. Architectural Boundaries & File Ownership

The project enforces strict separation between desktop host, UI client, background workers, and persistent storage:

```
artupski-resite/
├── src-tauri/               # Native Rust desktop bridge (Keyring, OS windows, native FS)
├── src/                     # React Frontend & Core Business Logic
│   ├── components/          # Reusable UI components (Modals, Buttons, Forms)
│   ├── routes/              # Page views (Dashboard, Scanner, Blueprints, Settings)
│   ├── stores/              # Zustand application stores
│   ├── services/            # Infrastructure services
│   │   ├── infra/           # EventBus, Logger, ProcessManager
│   │   ├── db/              # SQLite repositories & migrations
│   │   ├── scanner/         # Crawler orchestration & tech detection
│   │   ├── blueprint/       # AST parsing & blueprint synthesis
│   │   ├── ai/              # Multi-provider LLM clients & prompt compilers
│   │   └── generator/       # Project scaffolders & file bundlers
│   └── workers/             # Isolated Node.js child processes
│       └── crawler/         # Playwright scraping engine
└── test/                    # Integration & E2E test suites
```

### Module Boundaries
- `src-tauri`: Never invoke Node.js packages. Handles OS-level operations only.
- `src/workers/crawler`: Isolated execution. Interacts with frontend exclusively via stdio IPC / JSON message streams orchestrated by `ProcessManager`.
- `src/services/db`: Only layer authorized to execute SQLite SQL statements. Frontend components must consume DB through typed repository classes.

---

## 4. Scanner & Reverse Engineering Rules

1. Zero Headless Hangs: Headless Playwright runs must define explicit navigation and network timeouts (max 30s).
2. Asset Integrity: Downloaded assets must verify HTTP status 200 before disk persistence. Failed downloads must fall back to remote URL or placeholder.
3. DOM Sanitization: Stripped script tags and dynamic event listeners before passing serialized DOM to blueprint compiler.

---

## 5. AI Provider Abstractions

1. All LLM calls must pass through `LlmProviderAdapter` interface (`src/services/ai/providerAdapter.ts`).
2. Do not hardcode provider client instances directly in feature code.
3. Every prompt compiler must output strict JSON structured schemas validated via Zod.
4. Always handle streaming responses and rate-limiting errors gracefully with user-visible progress indicators.

---

## 6. Security & Privacy Rules

1. API Keys: Never write API keys to disk files or SQLite. Store them only in the OS credential store through the native keychain boundary (`src-tauri/src/secret.rs`, wrapped by `src/services/security/keychain.ts`; service `com.artupski.resite.apikeys`, account = provider slug). The boundary is **fail-closed** — when no OS store is available the key is not persisted at all (never a plaintext fallback), and the app surfaces `SECRET_STORAGE_UNAVAILABLE`.
2. Sessions: Store captured `storageState.json` using AES-256-GCM encryption at rest.
3. Untrusted Data: Always wrap crawled DOM/CSS content in explicit `<UNTRUSTED_CRAWLED_DATA>` XML boundary delimiters in LLM prompts.
4. Path Sandboxing: Assert canonical sandbox path on all asset and code generation file write operations.

---

## 7. Event & Logging Conventions

1. Use `EventBus` for decoupled inter-component signaling.
2. Use structured `Logger` (`src/services/infra/logger.ts`) with severity levels (`DEBUG`, `INFO`, `WARN`, `ERROR`).
3. Never use raw `console.log` in production code.

---

## 8. "DO NOT DO THIS" Anti-Patterns

- DO NOT commit credentials, API keys, or raw scan outputs containing personal session cookies to git.
- DO NOT spawn long-running child processes without registering them with `ProcessManager` for cleanup.
- DO NOT bypass Zod validation when parsing blueprint JSON payloads.
- DO NOT use shell concatenation (`exec('node ' + script)`); always use array arguments with `spawn()`.
- DO NOT install heavyweight UI libraries (MUI, Ant Design). Use Tailwind CSS + Radix UI primitives.

---

## 9. Definition of Done (DoD)

A task or pull request is complete only when:
1. `anti-ui-slop` compliance verified for all UI code.
2. TypeScript compiles with zero errors (`npm run typecheck`).
3. Unit and integration tests pass (`npm run test`).
4. Linting passes (`npm run lint`).
5. Security sandboxing verified for any file or process manipulation.
6. Documentation and specifications updated if data models or interfaces changed.
