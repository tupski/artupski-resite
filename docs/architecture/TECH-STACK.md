# Technology Stack Specification - Artupski ReSite

## 1. Core Frameworks & Libraries

### Desktop Shell & Native Layer
- **Tauri 2**: Lightweight cross-platform native wrapper and window manager.
- **Rust**: Systems programming language powering Tauri back-end, OS file system I/O, and child process lifecycle management.

### User Interface & Frontend Runtime
- **React 18/19**: UI component hierarchy and rendering.
- **TypeScript (v5+)**: Strict static typing across all business logic and UI layers.
- **Tailwind CSS**: Utility-first styling framework with design token integration.
- **Zustand**: Fast, lightweight state management for scans, blueprints, and UI settings.
- **React Router (v6+)**: Client-side view routing inside the desktop window.

### Browser Automation Engine
- **Playwright**: Headless browser automation controlling Chromium, Firefox, and WebKit.
- Used for DOM snapshot extraction, dynamic script evaluation, authenticated sessions, responsive viewport rendering, and screenshot generation.

### Local Persistence
- **SQLite**: Embedded database used for metadata, scan runs, asset registries, blueprint JSON trees, and application settings.
- **`sql.js` (SQLite 3 compiled to WebAssembly) - as built in Phase 2**: structured queries with strict TypeScript typing through typed repositories. This supersedes the earlier `Prisma or Kysely / better-sqlite3` suggestion: the engine must run inside the Tauri webview *and* under Vitest/jsdom without a native build step. It is still SQLite 3.
- **Rust file boundary**: `src-tauri/src/storage.rs` provides sandboxed atomic read/write for the single `app.db` file (no schema/CRUD, no generic SQL). See `DATABASE.md` section 2.1.
- **`test:storage`**: `vitest run src/services/storage` exercises the storage layer against isolated in-memory databases.

---

## 2. AI Abstraction Layer

Artupski ReSite uses an OpenAI-compatible REST API client to integrate interchangeably with cloud models and local inference engines.

### Supported Backends
- OpenAI API (GPT-4o, GPT-4o-mini)
- OpenRouter
- 9Router
- Ollama (Local LLM runner)
- LM Studio (Local LLM runner)

### Configuration Variables
The AI integration relies on standard environment variables or application-level setting entries:

```bash
# Base endpoint for chat completions
AI_BASE_URL="http://localhost:11434/v1" # Example for Ollama
# Authentication key (optional or dummy for local backends)
AI_API_KEY="sk-custom-or-local"
# Target model identifier
AI_MODEL="llama3.1"
```

### Abstraction Contract
- Standard HTTP payload format (`/v1/chat/completions`).
- Supports JSON schema enforcement (`response_format: { type: "json_object" }`).
- Streaming token handling via Server-Sent Events (SSE).
- Dynamic timeout, retry, and rate-limit backoff handler.

---

## 3. UI Guidelines & Quality Contract
- All frontend development agents must read and adhere to `C:\Users\Kakarama Room\.agents\skills\anti-ui-slop\SKILL.md` before implementing or revising UI components.
- **Design tokens**: Tailwind CSS v3 is configured in `tailwind.config.js` with semantic color utilities backed by CSS variables defined in `src/styles/tokens.css`. Hex values come from `docs/design/UI-SPEC.md` section 3.1; components must not hardcode colors.

---

## 4. Phase 1 Toolchain & Scripts

The Phase 1 foundation introduces the following npm scripts (see `package.json`):

| Script | Purpose |
| :--- | :--- |
| `npm run dev` | Start the Vite dev server (browser preview) on port `1420`. |
| `npm run build` | Typecheck and produce the production `dist/` bundle. |
| `npm run typecheck` | `tsc --noEmit` strict type check. |
| `npm run lint` | ESLint (`--max-warnings 0`). |
| `npm run test` | Vitest unit/component suite. |
| `npm run tauri:dev` | Launch the native Tauri window (requires Rust toolchain). |
| `npm run tauri:build` | Build the native desktop bundle (requires Rust toolchain). |

Test tooling: Vitest + React Testing Library + jsdom. No Playwright browser binaries are installed in Phase 1.
