# Phase 10 Implementation Plan — AI Provider Abstraction & Engine

Source of truth: `docs/specs/AI-SPEC.md` (the authoritative AI engine specification).
Supporting: `docs/product/PLAN.md` (Phase 10), `docs/architecture/ARCHITECTURE.md` (§2 Layer 3, §3.2 AI Engine, §4 Rust/TS boundary, §6 store seam), `docs/architecture/TECH-STACK.md` (§2 AI Abstraction Layer), `docs/architecture/EVENT-SYSTEM.md` (`ai.*`), `docs/architecture/ERROR-HANDLING.md` (`AI_*` codes), `docs/architecture/DATABASE.md` (`app_settings`), `docs/specs/BLUEPRINT-SPEC.md` (downstream payload), `docs/dev/TESTING.md`, `docs/design/UI-SPEC.md`, `AGENTS.md`.

> This plan was written after the mandatory audit (Step 2) and before implementation (Step 4). Where the pre-implementation wording of the spec and the architecture docs disagree, the hierarchy **spec > architecture docs > PRD > roadmap** is applied, and any deviation is recorded here and in `CHANGELOG.md`.

---

## 1. Goal & acceptance criteria

Deliver a **provider-agnostic AI engine** in the TypeScript layer that:

1. Talks to any **OpenAI-compatible REST endpoint** (`/v1/chat/completions`, `/v1/models`) configured via `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`.
2. Supports **Ollama, LM Studio, OpenRouter, 9Router, and OpenAI** via a preset matrix plus custom base URLs, with a real **health check** (`validateCredentials()` / `listModels()`).
3. Handles **streaming token parsing** (SSE) and **non-streaming** completions with usage accounting, timeouts, and abort support.
4. Enforces **structured output** through a Zod schema validated **generation pipeline** with bounded **self-repair** passes.
5. Isolates all untrusted crawler/blueprint content as a `<DATA_PAYLOAD>` and defends against **prompt injection**.

- **Acceptance (PLAN.md Phase 10)**: "Successfully communicate with local Ollama or OpenAI endpoint and return valid structured JSON."
- **Verification (PLAN.md Phase 10)**: "Run prompt against test endpoint; verify valid typed object returned."

### 1.1 Non-goals (explicitly deferred)

- **Component synthesis / HTML→React conversion** — Phase 11 (`componentSynthesizer`, `componentPrompt`).
- **Full project generation** — Phase 12.
- **Visual diffing** — Phase 13; **doc/ZIP export** — Phase 14; **settings/security hardening UI + OS keychain** — Phase 15.
- **No network access is introduced by default**: the engine is inert until the user configures an endpoint; no telemetry, no calls home.
- Phase 10 does **not** wire the AI engine into the scan lifecycle. The Blueprint (Phase 9) remains the sole post-crawl output. The engine is a reusable service consumed by Phases 11+.

---

## 2. Audit findings that shape this phase

1. **No `src/services/ai/` exists** and no `ai.*` event domain is declared. Phase 10 is genuinely new.
2. `src/services/infra/errors.ts` **already reserves** the `ai` error category and the codes `API_KEY_INVALID`, `RATE_LIMIT_EXCEEDED`, `CONTEXT_LENGTH_EXCEEDED`, `MALFORMED_OUTPUT` (ERROR-HANDLING.md §1). No error-model change is needed — only wiring.
3. `zod@^3.23.8` is already a runtime dependency (added by Phase 9); the AI-SPEC `GenerationPipeline` contract is `z.ZodSchema`-based, so no new dependency is required.
4. `app_settings` (`SettingsRepository`, migration `001`) is the established key/value store; AI configuration is persisted there, not in a new table.
5. `eventBus.ts` follows the `<domain>.<action_or_state>` taxonomy (`blueprint.*`, `clone.*`); Phase 10 adds a bounded `ai.*` lifecycle the same way.
6. `ARCHITECTURE.md` §4 places **AI prompt orchestration in TypeScript** — this is not a Rust/worker responsibility. No worker protocol change is required (`WORKER_PROTOCOL_VERSION` stays `1`).
7. **No conflict** exists between `PLAN.md` Phase 10, `AI-SPEC.md`, and `TECH-STACK.md` §2. The spec is more detailed than the roadmap and is treated as authoritative.

---

## 3. Architecture & integration points

```
src/types/ai.ts                 ── provider + engine type contracts (IAIProvider, AIMessage, ...)
src/services/ai/
  ├── provider.ts               ── OpenAICompatibleProvider (chat/stream/models/health, SSE parsing)
  ├── presets.ts                ── PROVIDER_PRESETS matrix + base-URL normalization/validation
  ├── errors.ts                 ── map HTTP/transport failures → StructuredError (category 'ai')
  ├── tokenBudget.ts            ── MODEL_BUDGET_PROFILES + TokenBudgetManager
  ├── payload.ts                ── untrusted-data sanitization + <DATA_PAYLOAD> wrapping/escaping
  ├── prompts/
  │   └── systemPrompt.ts       ── defensive system prompt (AI-SPEC §5.1) + builder
  ├── pipeline.ts               ── GenerationPipeline (extract JSON, Zod validate, bounded repair)
  ├── config.ts                 ── AI settings <-> app_settings persistence (SettingsRepository)
  └── engine.ts                 ── createAiEngine(): resolves config → provider, health check
src/stores/aiStore.ts           ── honest UI state (config, health, models), mirrors `ai.*` events
src/components/settings/AiProviderPanel.tsx ── configure endpoint/model/key + test connection
```

- **Data flow (health check)**: UI → `aiStore.testConnection()` → `engine.healthCheck()` → `OpenAICompatibleProvider.validateCredentials()` → `GET {baseUrl}/models` → normalized `{ valid, error?, models? }` → store state + `ai.*` event.
- **Data flow (generation, Phase 11 consumer)**: caller builds `GenerationTask<T>` → `GenerationPipeline.executeTask` → `sanitizePayload` + `<DATA_PAYLOAD>` wrap → `TokenBudgetManager.fitsInContext` guard → `chatCompletion(json_object, temperature 0)` → `extractJson` → `schema.safeParse` → on failure, bounded repair pass with bounded error text → validated `T`.
- **Persistence**: `AiConfigRepository`-style helpers over `SettingsRepository` (`app_settings`), storing non-secret fields (`baseUrl`, `model`, `providerId`, `timeoutMs`) as JSON under a single key and the **API key under a separate key**, never logged.

---

## 4. Data models & persistence

- **No migration.** AI configuration lives in the existing `app_settings` table (an addition already documented from PLAN.md Phase 2).
- Keys: `ai.config` (JSON: `{ providerId, baseUrl, model, timeoutMs, updatedAt }`) and `ai.credentials` (JSON: `{ apiKey }`). The key is stored locally, is **never** returned to the event bus, is never written to logs, and is masked in any UI/export.
- **No new files, no temp files, no Rust sandbox change.** Phase 10 does not write documents to disk.

---

## 5. Data contracts (from AI-SPEC.md, authoritative)

`AIMessage`, `AICompletionOptions`, `AICompletionResponse`, `IAIProvider`, `ProviderConfig`, `ModelContextConfig`, `GenerationTask<T>` — mirrored verbatim in `src/types/ai.ts`. Deviations, if any, are additive and recorded.

---

## 6. Frontend / backend responsibilities

- **TypeScript (this phase)**: entire engine, provider client, token budgeting, prompt isolation, pipeline, persistence helpers, store, and settings panel.
- **Rust**: unchanged. The AI engine uses the webview `fetch` path already available; **no new IPC command is introduced**. (If a future phase needs native HTTP, it will be a separate documented decision.)
- **Workers**: unchanged. AI orchestration is a main-process service, not a browser-tier worker.

### 6.1 CSP / network note
The webview `connect-src` currently allows the app's own origins. Phase 10 **does not widen CSP globally**; the provider base URL is user-configured. Runtime calls to a user endpoint require the endpoint to be reachable from the webview. This is documented as a known limitation, and the health check surfaces a clear error when the endpoint is unreachable rather than failing silently.

---

## 7. Security & privacy

- **Prompt injection**: all crawler/blueprint payloads are untrusted. `payload.ts` wraps them in `<DATA_PAYLOAD>...</DATA_PAYLOAD>`, escapes any embedded closing tag, strips oversized `data:` URIs, and the system prompt (AI-SPEC §5.1) instructs the model to treat the block as literal data only. Output is constrained to JSON and validated by Zod — freeform text is never executed.
- **Secret leakage**: the API key is never emitted in events, logs, errors, or generic UI text. Provider errors surface status + a bounded body excerpt with the key redacted.
- **SSRF/URL handling**: `presets.ts` validates the configured base URL (http/https only, no embedded credentials, normalized); the engine never follows arbitrary URLs from page content.
- **Resource limits**: bounded timeouts (default 60s), bounded `maxTokens`, bounded response body read, bounded repair attempts, and a token-budget guard that rejects over-budget payloads with `CONTEXT_LENGTH_EXCEEDED`.
- **Honest failure**: network/HTTP/parse failures are represented as `StructuredError` (category `ai`) and surfaced to the UI; nothing is fabricated.

---

## 8. Failure isolation

- A failed health check or generation **never** mutates Blueprint, clone, scan, or project data. The AI store is independent and read-only with respect to those domains.
- The generation pipeline never throws past its boundary: it returns a discriminated result carrying a `StructuredError`.
- Repeated operations are idempotent: config save upserts; health checks are stateless; a cancelled/aborted generation leaves no partial persisted state.

---

## 9. Testing strategy

Default (browser-free) Vitest tier — no network:
- `src/services/ai/__tests__/presets.test.ts` — preset matrix, base-URL normalization/rejection (scheme, credentials).
- `src/services/ai/__tests__/tokenBudget.test.ts` — profile lookup, usable budget, `fitsInContext`.
- `src/services/ai/__tests__/payload.test.ts` — `<DATA_PAYLOAD>` wrapping, closing-tag escaping, data-URI truncation, injection strings preserved literally.
- `src/services/ai/__tests__/pipeline.test.ts` — JSON extraction (raw + fenced), Zod validation, bounded repair pass (success + exhausted), budget rejection.
- `src/services/ai/__tests__/provider.test.ts` — via an injected `fetch` stub: chat completion mapping, usage/finish reason, SSE stream assembly, HTTP error → `StructuredError`, timeout/abort, `listModels`/`validateCredentials`.
- `src/services/ai/__tests__/config.test.ts` — config save/load round-trip over an in-memory `SettingsRepository`, key isolation, no secret in the non-secret blob.
- `src/stores/aiStore.test.ts` — honest `idle|loading|ready|error` states, event mirroring, no fabricated "connected" state.

Integration (opt-in, `RUN_AI_TESTS=1`): a local mock OpenAI-compatible HTTP server (Node `http`) exercising a real non-streaming + streaming round-trip end-to-end. Documented in `docs/dev/TESTING.md`.

---

## 10. Acceptance criteria (mapping to PLAN.md Phase 10)

| # | Criterion | Evidence |
| :- | :--- | :--- |
| A1 | OpenAI REST client honors `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL` | `provider.ts` + `presets.ts` unit tests |
| A2 | Structured output parser (JSON mode + Zod) | `pipeline.test.ts` |
| A3 | Ollama / LM Studio / OpenRouter / OpenAI supported with health check | `presets.test.ts` + `provider.test.ts` (`validateCredentials`, `listModels`) |
| A4 | Streaming + non-streaming completion return typed responses | `provider.test.ts` (SSE), mock-server integration |
| A5 | Return valid structured JSON against a test endpoint | integration test (mock) + pipeline tests |
| A6 | No prompt-injection execution path; payload isolated | `payload.test.ts` + system prompt |
| A7 | No secret leakage in events/logs/errors | `config.test.ts` + provider error redaction test |
| A8 | Honest UI states; no fabricated connectivity | `aiStore.test.ts` + panel states |

---

## 11. Verification commands

```bash
npm run typecheck
npm run lint
npm run test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

Plus `RUN_AI_TESTS=1 npx vitest run src/services/ai` for the opt-in mock-server tier.

---

## 12. Documentation updates

- `docs/product/PLAN.md` — mark Phase 10 status + as-built note.
- `CHANGELOG.md` — `[Unreleased]` Phase 10 entry.
- `docs/architecture/ARCHITECTURE.md` — §3.2 as-built note.
- `docs/architecture/EVENT-SYSTEM.md` — `ai.*` taxonomy.
- `docs/dev/TESTING.md` — Phase 10 test tier.
- `docs/README.md` — link this plan.
- `docs/specs/AI-SPEC.md` — only if a deviation is required (none expected).

---

## 13. Risks & unresolved questions

- **CSP / webview fetch to arbitrary endpoints**: the health check may be blocked by the webview network policy on some platforms. *Mitigation*: surface a truthful, actionable error; document as a limitation. A future native-HTTP bridge is out of Phase 10 scope.
- **Small local model JSON quality**: hangs/malformed JSON are expected; handled by JSON-mode + bounded repair passes + `MALFORMED_OUTPUT`.
- **Unresolved**: whether Phase 15 will move the API key to the OS keychain. Phase 10 stores it in `app_settings` (plaintext-local), consistent with the current security model, and documents the deferral.
