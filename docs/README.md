# Artupski ReSite — Documentation

This folder contains all project documentation, organized by category. For project-level
guidelines and history, see the root files: [`README.md`](../README.md) (install, usage, build,
troubleshooting), [`RELEASE.md`](../RELEASE.md) (versioning and release process),
[`AGENTS.md`](../AGENTS.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md), and
[`CHANGELOG.md`](../CHANGELOG.md).

## Product

| Document | Description |
| :--- | :--- |
| [`PRD.md`](product/PRD.md) | Product requirements: goals, audience, and scope. |
| [`PLAN.md`](product/PLAN.md) | Phased rollout and development roadmap. |
| [`TODO.md`](product/TODO.md) | Task backlog and outstanding work. |

## Architecture

| Document | Description |
| :--- | :--- |
| [`ARCHITECTURE.md`](architecture/ARCHITECTURE.md) | System topology, layers, and module ownership. |
| [`ARCHITECTURE-REVIEW.md`](architecture/ARCHITECTURE-REVIEW.md) | Review and recommendations on the architecture. |
| [`TECH-STACK.md`](architecture/TECH-STACK.md) | Frameworks, tooling, and technology choices. |
| [`EVENT-SYSTEM.md`](architecture/EVENT-SYSTEM.md) | Event taxonomy and messaging design. |
| [`ERROR-HANDLING.md`](architecture/ERROR-HANDLING.md) | Error handling strategy and conventions. |
| [`WORKER-PROTOCOL.md`](architecture/WORKER-PROTOCOL.md) | Worker stdio JSON protocol and process lifecycle. |
| [`DATABASE.md`](architecture/DATABASE.md) | Schema, tables, relations, and indexing. |

### Source Modules (as built)

| Module | Description |
| :--- | :--- |
| [`src/services/security/`](../src/services/security/) | Phase 15 security services: `keychain.ts` (OS credential-store boundary over the native `secret_*` commands) and `redaction.ts` (`scrubSecrets` + `createRedactingSink`), reusing `redactSecrets`. |
| [`src/components/common/`](../src/components/common/) | Phase 15 shared UI chrome: `ErrorBoundary.tsx` (global class error boundary), `ToastRegion.tsx` (aria-live notice overlay), and `errorBridge.ts` (worker/global-failure → scrubbed notice). |

## Specs

| Document | Description |
| :--- | :--- |
| [`SCANNER-SPEC.md`](specs/SCANNER-SPEC.md) | Scanner engine specification. |
| [`TECHNOLOGY-DETECTION.md`](specs/TECHNOLOGY-DETECTION.md) | Technology detection rules and heuristics. |
| [`AUTH-SCANNING.md`](specs/AUTH-SCANNING.md) | Authenticated scanning flows. |
| [`CLONE-SPEC.md`](specs/CLONE-SPEC.md) | Site cloning specification. |
| [`BLUEPRINT-SPEC.md`](specs/BLUEPRINT-SPEC.md) | Blueprint data model and output format. |
| [`PROJECT-GENERATOR-SPEC.md`](specs/PROJECT-GENERATOR-SPEC.md) | Project generator specification. |
| [`ADMIN-SPEC.md`](specs/ADMIN-SPEC.md) | Admin requirements specification. |
| [`AI-SPEC.md`](specs/AI-SPEC.md) | AI engine specification. |

## Design

| Document | Description |
| :--- | :--- |
| [`UI-SPEC.md`](design/UI-SPEC.md) | Screens, design tokens, and component hierarchy. |
| [`RESPONSIVE-SPEC.md`](design/RESPONSIVE-SPEC.md) | Responsive behavior and breakpoints. |

## Security

| Document | Description |
| :--- | :--- |
| [`SECURITY.md`](security/SECURITY.md) | Security model and threat considerations. |
| [`PRIVACY.md`](security/PRIVACY.md) | Privacy policy and data handling. |

## Development

| Document | Description |
| :--- | :--- |
| [`TESTING.md`](dev/TESTING.md) | Testing strategy and guidelines. |

## Implementation Plans

| Document | Description |
| :--- | :--- |
| [`phase-8-impl-plan.md`](impl-plan/phase-8-impl-plan.md) | Static clone engine & local asset server (Phase 8): files, migration, protocol, tests, risks, and the C3-C7 decision resolutions. |
| [`phase-9-impl-plan.md`](impl-plan/phase-9-impl-plan.md) | Website blueprint specification & normalization engine (Phase 9): prerequisite evidence capture, schema, engine, migration `008`, protocol, tests, risks, and the C8-C13 decision resolutions. |
| [`phase-10-impl-plan.md`](impl-plan/phase-10-impl-plan.md) | AI provider abstraction & engine (Phase 10): OpenAI-compatible client, presets, token budgeting, defensive payload isolation, Zod generation pipeline, `app_settings` persistence, events, tests, and security/non-goals. |
| [`phase-11-impl-plan.md`](impl-plan/phase-11-impl-plan.md) | AI-powered component extraction & synthesis (Phase 11): component prompt, bounded payload chunking, Zod output contract, deterministic JSX cleanliness gate, `component.*` events, tests, and the "render matching UI" deviation. |
| [`phase-12-impl-plan.md`](impl-plan/phase-12-impl-plan.md) | Full-stack project generator (Phase 12): Vite + React + TS + Tailwind assembly from Blueprint + synthesized components, routes/tokens integration, path safety, resource limits, `project.*` events, and the opt-in real-build E2E. |
| [`phase-13-impl-plan.md`](impl-plan/phase-13-impl-plan.md) | Visual verification & diff engine (Phase 13): dependency-free PNG codec + pixel diff core, managed loopback server for the generated project, multi-viewport capture/diff service, `diff.*` events, `asset_read` sandbox command, and the side-by-side/slider/diff viewer. |
| [`phase-14-impl-plan.md`](impl-plan/phase-14-impl-plan.md) | Project documentation & export engine (Phase 14): the `src/services/exporter/` module (`docGenerator.ts`, dependency-free deterministic `zip.ts`, `zipExporter.ts` orchestration) generating `README.md`/`ARCHITECTURE.md`/`COMPONENTS.md` and bundling a generated project to ZIP or folder, with path confinement, reject-not-truncate limits, `export.*` events, and the opt-in `RUN_EXPORT_E2E=1` unzip/verify E2E. |
| [`phase-15-impl-plan.md`](impl-plan/phase-15-impl-plan.md) | Settings, telemetry, security & error-handling hardening (Phase 15): the completed Settings screen (crawler defaults + security panels), OS-keychain API-key storage (`src-tauri/src/secret.rs` + `src/services/security/keychain.ts`, fail-closed migration off plaintext `app_settings`), secret redaction at the logging boundary, a global `ErrorBoundary`, the `ToastRegion`/`errorBridge` toast system, the `security.*` events, and the `SECRET_*` error codes (deviations C1-C8). |
| [`phase-16-impl-plan.md`](impl-plan/phase-16-impl-plan.md) | End-to-end integration testing & release packaging (Phase 16): the composed offline + real-browser `e2e/` pipeline suites, the packaged-worker fix (staged Tauri `bundle.resources` + a packaged-aware resolver, C1), the recorded performance harness, the `README.md`/`RELEASE.md` docs, CI workflows, and the `v0.1.0` release (deviations C1-C7). |
