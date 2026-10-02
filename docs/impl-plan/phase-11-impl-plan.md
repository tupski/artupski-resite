# Phase 11 Implementation Plan — AI-Powered Component Extraction & Synthesis

Source of truth: `docs/product/PLAN.md` (Phase 11). Supporting: `docs/specs/AI-SPEC.md`
(§3 token budget/chunking, §4 generation pipeline, §5 injection mitigation),
`docs/specs/PROJECT-GENERATOR-SPEC.md` (§3 component generator contract — the component code
generator is explicitly shared with the project generator), `docs/specs/BLUEPRINT-SPEC.md`
(§2.4 components, §2.9 design system), `docs/architecture/ARCHITECTURE.md` (§2 Layer 2/3,
§3.2 AI engine, §4 Rust/TS boundary, §6 store seam), `docs/architecture/EVENT-SYSTEM.md`,
`docs/architecture/ERROR-HANDLING.md`, `docs/dev/TESTING.md`, `docs/impl-plan/phase-10-impl-plan.md`,
`AGENTS.md`.

> This plan was written after the mandatory audit (task step 2) and before implementation
> (task step 4). Where the pre-implementation wording of the roadmap and the architecture docs
> disagree, the hierarchy **spec > architecture docs > PRD > roadmap** is applied and any
> deviation is recorded here and in `CHANGELOG.md`.

---

## 1. Phase objective

Use the Phase 10 AI engine to transform **Blueprint component nodes and extracted design tokens**
into clean **TypeScript React components styled with Tailwind utility classes**, with a
deterministic, framework-independent prompt + validation boundary. The phase delivers:

1. **Component prompt engineering** — a defensive `componentPrompt` builder that feeds a *bounded,
   sanitized* payload (component definitions + design tokens + observed markup fragments) to the
   AI engine under the AI-SPEC `<DATA_PAYLOAD>` isolation and a fixed authoring contract.
2. **Code synthesis pipeline** — a `componentSynthesizer` that always targets *structured output*
   (JSON) validated by Zod, never free-form prose; structurally validates the returned code and
   preserves useful partial evidence when individual components fail.
3. **JSX cleanliness optimizer** — a deterministic post-processor that rejects AI-slop
   (conversational filler, TODO/placeholder comments, `any`, unused imports, empty handlers) and
   normalizes the emitted JSX/TSX whitespace and import ordering.

### 1.1 Official scope and non-goals

**In scope (PLAN.md Phase 11):**

- Component prompt engineering (`src/services/ai/prompts/componentPrompt.ts`).
- Code synthesis pipeline (`src/services/generator/componentSynthesizer.ts`).
- JSX cleanliness optimizer (deterministic, no LLM).
- Feeding Blueprint component nodes + design tokens to the AI engine (Phase 10).
- Generating clean TS React components with Tailwind classes.
- Ensuring no AI-slop code or useless comments.

**Non-goals (explicitly deferred; must NOT be implemented here):**

- **Full project generation** (file tree, manifests, router config, install/build) — Phase 12.
  Phase 11 emits *component artifacts*, not a runnable project.
- **Visual diffing / rendering verification** — Phase 13. The acceptance criterion "render matching
  UI" is *not* pixel-verified in Phase 11; it is bounded to the contract that generated components
  are framework-idiomatic React+Tailwind derived from observed evidence (see §12 risks/limitations).
- **Doc/ZIP export** — Phase 14; **OS keychain** — Phase 15.
- No new worker, no new IPC command, no database migration, no new runtime dependency.
- Phase 11 does **not** wire synthesis into the scan lifecycle automatically. It is an opt-in
  service invoked explicitly by a caller (mirrors the Phase 10 "inert until configured" stance).

### 1.2 Acceptance criteria (from PLAN.md)

- **A1** — Generated components compile with TypeScript (`tsc`-safe output: valid TSX identifier,
  typed props interface, JSX element tree, no undefined references) and use Tailwind classes.
- **A2** — Generated components *render matching UI* — bounded to "derived from the Blueprint's
  observed component/design-token evidence", not pixel equivalence (Phase 13 owns pixel diffing).
- **A3** — "No AI-slop code or useless comments are generated" — enforced by the deterministic
  JSX cleanliness optimizer + a Zod output contract that forbids commentary fields.
- **A4** — Massive DOM trees do not exceed the model context window (PLAN.md risk) — via the
  documented AI-SPEC §3.2 chunking strategy (per-component budgeting + `CONTEXT_LENGTH_EXCEEDED`).
- **A5** — Blueprint integrity: observed vs inferred provenance preserved; no fabricated content.
- **A6** — Injection isolation: all Blueprint/HTML/CSS is untrusted `<DATA_PAYLOAD>`.
- **A7** — No secret leakage; bounded events only.

---

## 2. Audit findings that shape this phase

1. **No `src/services/generator/` exists** and no `src/services/ai/prompts/componentPrompt.ts`
   exists — Phase 11 is genuinely new. Confirmed via directory listing + repo-wide search.
2. The Phase 10 plan and `ARCHITECTURE.md` §3.2 **explicitly defer** "component synthesis /
   HTML→React conversion" to Phase 11, naming `componentSynthesizer` and `componentPrompt`.
   Phase 11 therefore has **no dedicated spec file**; the authoritative sources are
   `PLAN.md` §Phase 11 + `AI-SPEC.md` + `PROJECT-GENERATOR-SPEC.md` §3 (which contains the
   shared component code-generator contract). **No specification conflict**: `PLAN.md` Phase 11
   is a subset/consumer of `PROJECT-GENERATOR-SPEC.md` §3.
3. **Reusable engine exists**: `src/services/ai/engine.ts#generate<T>()` → `GenerationPipeline`
   (JSON extraction + Zod + bounded repair) already implements AI-SPEC §4. The Phase 11
   synthesizer must consume `AiEngine.generate`, not re-implement any client/transport logic.
4. `zod@^3.23.8` is already a runtime dependency. No new dependency is needed for Phase 11 (JSX
   cleanliness is a deterministic string/regex pass; no Prettier engine dependency is introduced
   because PLAN.md Phase 11 requires *clean* output, and `PROJECT-GENERATOR-SPEC.md` §4.2 places the
   Prettier step in the **project generator** (Phase 12), not the component synthesizer).
5. `eventBus.ts` follows `<domain>.<action_or_state>`. Phase 11 adds a bounded `component.*`
   domain (`component.started`, `component.generated`, `component.failed`, `component.completed`)
   carrying ids/counts only — *no prompt/code content*, consistent with `ai.*` and `blueprint.*`.
6. `src/services/infra/errors.ts` already reserves the `ai` category and `CONTEXT_LENGTH_EXCEEDED`,
   `MALFORMED_OUTPUT`. Phase 11 reuses these; **no error-model change required**.
7. Blueprint `components[]` is a flat registry with an optional `children` id-reference list and
   `MAX_COMPONENT_DEPTH = 12`, `MAX_COMPONENTS = 500`. The synthesizer walks this graph
   iteratively (stack-safe) and never trusts it without validation.
8. `design_system` provides color/typography/spacing/radii/shadows token records — the exact
   evidence the prompt must relay so Tailwind classes reflect observed values.

---

## 3. Architecture & integration points

```
src/types/componentSynth.ts        ── Phase 11 type contracts (SynthesizedComponent, request/result, limits)
src/services/ai/prompts/
  └── componentPrompt.ts           ── defensive component authoring prompt + deterministic payload projection
src/services/generator/
  ├── componentPayload.ts          ── Blueprint → bounded per-component payload (chunking, token economy)
  ├── jsxCleanliness.ts            ── deterministic AI-slop detector + JSX/TSX normalizer
  ├── componentSchema.ts           ── Zod contract for the model's structured output
  ├── componentSynthesizer.ts      ── orchestration: chunk → prompt → generate → validate → clean → aggregate
  └── index.ts                     ── public surface
```

- **AI engine integration**: `componentSynthesizer` depends on a narrow
  `ComponentSynthesisEngine` seam (`{ generate }`) that is structurally satisfied by
  `AiEngine` from Phase 10 (`src/services/ai/engine.ts`). Tests inject a scripted engine; the
  live engine is the default. No concrete provider is imported.
- **Event seam**: a `ComponentEventSink` (defaulting to `eventBus.emit`) so the orchestrator
  stays testable and emits `component.*` exactly like `blueprintLifecycle` emits `blueprint.*`.
- **Store/UI**: Phase 11 exposes a service-layer only. No new route or store is required by the
  official scope (the roadmap lists only service modules). UI wiring is deferred to the caller/UI
  phase that consumes these artifacts; this keeps the change minimal and avoids speculative UI.

---

## 4. Component synthesis data flow

```
caller (opt-in)
  │  request: { components[], designSystem, fragments?, sourceUrl, options }
  ▼
selectTargets()          ── deterministic ordering + cap (MAX_SYNTHESIS_COMPONENTS)
  ▼
per component:
  projectComponentPayload()  ── observed-only evidence + token slice + fragment (sanitized by pipeline)
  buildComponentSystemPrompt()  ── fixed authoring contract + AI-SPEC §5.1 security directives
  engine.generate({ schema: ComponentOutputSchema, maxRepairAttempts })   ← Phase 10
      ├─ token budget guard (CONTEXT_LENGTH_EXCEEDED, no network)
      ├─ <DATA_PAYLOAD> isolation + JSON mode + Zod + bounded repair
      └─ success → raw { name, fileName, code }
  ▼
assessCleanliness(code)  ── reject AI-slop; deterministic violations list
  ├─ violations → component marked `failed` (honest), others continue
  └─ clean → optimizeJsx(code) ── normalized, deterministic output
  ▼
aggregate: SynthesizedComponent[] + honest per-component outcomes + summary counts
  ▼
events: component.started → (component.generated | component.failed)* → component.completed
```

**Failure isolation**: one component failing (over-budget, malformed, slop) never aborts the run;
the aggregate returns every successful artifact plus a bounded, honest error per failure. This
mirrors the Blueprint lifecycle's "never throw past the boundary" contract.

---

## 5. Blueprint input requirements

- Synthesis requires a **validated** Blueprint document (Phase 9 `validateBlueprint`). The
  synthesizer accepts the `Blueprint` type and, when given untrusted JSON, validates first via
  `validateBlueprint`; an invalid document is refused with `BLUEPRINT_VALIDATION_FAILED`
  (no partial fabrication).
- **Observed vs inferred preserved**: each synthesized component records the source
  `componentId`, its `category`, and the input `confidence`/provenance so a consumer can tell
  which artifact came from observed vs inferred evidence. The prompt is told to *not invent*
  markup that is not evidenced; a component with no dedicated fragment may be skipped
  (`skipped: true`, honest reason) rather than hallucinated.
- **No fabrication**: variants/props come from the Blueprint verbatim; design tokens are relayed
  as `{value → token name}` so Tailwind classes are grounded in observed values.

---

## 6. AI engine integration requirements

- Use `AiEngine.generate<T>(GenerationTask<T>)` (Phase 10). Reuse `buildSystemPrompt`
  (AI-SPEC §5.1 directives always prepended) and the pipeline's `<DATA_PAYLOAD>` wrapping.
- `responseFormat: 'json_object'`, `temperature: 0` (via pipeline — already enforced).
- `maxRepairAttempts` is a small fixed bound (default 1) — bounded self-repair only.
- **Never** put the API key/credentials/headers in the system prompt, payload, events, or errors.
- **No trust** in a syntactically valid result: the Zod contract validates *structure*, and the
  deterministic cleanliness optimizer validates *quality*; neither is bypassed.

---

## 7. Output schema & validation strategy

The model returns **structured JSON** (not free code) so validation is schema-driven; the code is
one field, keeping the contract Zod-verifiable:

```ts
{
  componentId: string,     // must echo the requested id (cross-check)
  name: string,            // PascalCase React identifier
  fileName: string,        // "<Name>.tsx"
  code: string             // TSX source (validated + cleaned downstream)
}
```

Validation layers:

1. **Zod** (`ComponentOutputSchema`): types + non-empty code + PascalCase identifier.
2. **Cross-check**: `componentId` must equal the requested id; mismatch → component failure.
3. **Structural TSX validation** (`assessCleanliness` + `validateTsxStructure`): balanced braces
   (bounded), a single exported/declared component identifier, an `import` guard, no HTML `<script>`,
   no `dangerouslySetInnerHTML`, no `eval`/`Function`, no `require`, no `process.env`.
4. **Cleanliness optimizer**: rejects conversational filler, TODO/FIXME/placeholder comments,
   `: any`, unused imports (best-effort static check), empty handlers, and `console.*`; then
   normalizes indentation/blank lines and import ordering deterministically.

The code is **never executed**. It is validated textually; no sandbox/eval is introduced.

---

## 8. Component representation & organization

- Output is a **flat artifact set** keyed by `componentId`, each with `{ componentId, name,
  fileName, code, category, sourceUrl, variantKeys, confidence? }`.
- Naming is deterministic: identifier from the Blueprint `name` (PascalCase, sanitized), file
  `<Name>.tsx`. A duplicate identifier collision gets a stable `_2`, `_3` suffix by deterministic
  order.
- Deterministic ordering follows the Blueprint component order (already normalized by Phase 9).

---

## 9. Persistence requirements

**None.** Phase 11 produces in-memory artifacts returned to the caller. Persisting generated code
belongs to Phase 12 (project file emission) and the generic artifact flow. No migration, no new
table, no `app_settings` key. This is the minimal, non-invasive choice and keeps existing storage
untouched.

## 10. UI & interaction requirements

**None required by the official scope.** The roadmap lists only service-layer files. Displaying or
exporting synthesized components belongs to later phases (Phase 12/14). No route, store, or
component is added; existing UI behavior is unaffected.

## 11. Security & resource controls (implemented + tested)

| Control | Implementation |
| :--- | :--- |
| Prompt injection isolation | All evidence via `<DATA_PAYLOAD>`; fixed prompt; AI-SPEC §5.1 directives |
| No code execution | Textual validation only; no `eval`, no sandbox, no preview |
| Unsafe generated code | Reject `<script>`, `dangerouslySetInnerHTML`, `eval`, `Function`, `require`, dynamic `import(` |
| Secret isolation | Prompt/events/errors never carry config secrets; bounded event payloads |
| Oversized output | `MAX_COMPONENT_CODE_CHARS` cap → `MALFORMED_OUTPUT` failure |
| Excessive nesting/recursion | `MAX_SYNTHESIS_COMPONENTS` cap; iterative graph walk; bounded brace depth |
| Path traversal | Only logical `fileName` stored; no filesystem write in Phase 11; filename sanitized (no separators) |
| Resource exhaustion | Token budget guard (no network on overflow) + per-run component cap |
| Cancellation/timeout | Delegated to the Phase 10 provider; abort mid-run stops remaining components (records honest partial) |
| Failure isolation | Per-component try/catch; aggregate never throws |

## 12. Risks, assumptions & unresolved questions

- **R1 — "Render matching UI" is not pixel-verified.** Phase 13 owns pixel diffing. Phase 11
  bounds the criterion to *evidence-grounded, framework-idiomatic TSX* and documents this as a
  limitation. **Recorded deviation** vs. a literal reading of the acceptance criterion.
- **R2 — TS compile "correctness" without a real compiler.** We validate structure + cleanliness
  deterministically but do not run `tsc` on generated code (that is a Phase 12 project-build
  concern). Tests assert the structural contract (typed props interface, single component, valid
  identifier, balanced braces) rather than invoking a compiler.
- **R3 — Small local models.** Handled by JSON mode + bounded repair + honest `MALFORMED_OUTPUT`.
- **R4 — Fragment availability.** The Phase 9 Blueprint does not always carry a dedicated HTML
  fragment per component; when absent the prompt relies on variants/props/tokens and a component
  may be honestly skipped rather than invented.
- **Unresolved:** whether a later phase persists artifacts; excluded here by the TODO/later-phase
  rule.

## 13. Verification commands

```bash
npm run typecheck
npm run lint
npm run test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

Plus focused Phase 11 suites:
`npx vitest run src/services/generator src/services/ai/prompts`.

## 14. Documentation updates

- `docs/product/PLAN.md` — mark Phase 11 status + as-built note.
- `CHANGELOG.md` — `[Unreleased]` Phase 11 entry.
- `docs/architecture/ARCHITECTURE.md` — §3.3/§3.4 as-built note + `component.*` events.
- `docs/architecture/EVENT-SYSTEM.md` — `component.*` taxonomy + payloads.
- `docs/dev/TESTING.md` — Phase 11 test tier.
- `docs/README.md` — link this plan.
