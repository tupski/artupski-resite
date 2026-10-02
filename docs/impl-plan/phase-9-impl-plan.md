# Phase 9 Implementation Plan — Website Blueprint Specification & Normalization Engine

Source of truth: `docs/specs/BLUEPRINT-SPEC.md` (the authoritative Blueprint specification).
Supporting: `docs/architecture/ARCHITECTURE.md` (§2 Layer 2, §3.1 Scanner Engine, §3.6 store seam), `docs/architecture/DATABASE.md` (§3 `blueprints` sketch, §6 blueprint filesystem layout), `docs/architecture/WORKER-PROTOCOL.md`, `docs/architecture/EVENT-SYSTEM.md` (`blueprint.*`), `docs/architecture/ERROR-HANDLING.md` (`BLUEPRINT_VALIDATION_FAILED`, `UNSUPPORTED_VERSION`), `docs/specs/PROJECT-GENERATOR-SPEC.md` and `docs/specs/AI-SPEC.md` (downstream consumers of the Blueprint), `docs/specs/TECHNOLOGY-DETECTION.md`, `docs/specs/SCANNER-SPEC.md`, `docs/design/RESPONSIVE-SPEC.md`, `docs/design/UI-SPEC.md` (§2.4 Blueprint tab), `docs/product/PLAN.md` (Phase 9), `docs/dev/TESTING.md`, `AGENTS.md`.

> This plan was written before implementation (Step 3) and is updated in place as "as built" notes are appended. Where the pre-implementation wording of the spec and the architecture docs disagree, the hierarchy **spec > architecture docs > PRD > roadmap** is applied, and any deviation is recorded here and in `CHANGELOG.md`.

---

## 1. Goal & acceptance criteria

Produce a single **schema-validated `blueprint.json` document** per scan: a framework-agnostic intermediate representation that normalizes the captured DOM, page metadata, design tokens, routing topology, components, forms, and detected technologies into the exact structure defined by `BLUEPRINT-SPEC.md`, so downstream generators (`PROJECT-GENERATOR-SPEC.md`) and AI prompts (`AI-SPEC.md`) can consume it without touching raw crawl artifacts.

- **Acceptance (PLAN.md Phase 9)**: the emitted Blueprint passes the `BLUEPRINT-SPEC.md` §4 Zod schema completely.
- **Non-goals in this phase**: AI/LLM synthesis (Phase 10–11), React/Tailwind component code generation (Phase 11–12), visual diffing (Phase 13), documentation/ZIP export (Phase 14). No network access is introduced.

### 1.1 CRITICAL GAP inherited from Phases 4/6/7

The Blueprint is defined as a normalization of *parsed DOM and layout data* (`ARCHITECTURE.md` §2 Layer 2) and *computed styles* (`BLUEPRINT-SPEC.md` §2.9: "Consolidated design tokens derived from DOM computed styles"). The repository does **not** currently capture the evidence that requires:

1. **No persisted DOM/HTML body at scan time.** `scan_pages` stores metadata/structure only (title, headings, links, images *URLs*). The bounded `PageTechEvidence.htmlSnippet` is a truncated head/first-N-bytes signature, not a traversable DOM. Raw HTML is captured **only** during Phase 8 clone generation (`extract` with `captureHtml`), it is written into the *rewritten* clone tree, and `scan_pages.raw_html_path` is never written by the crawler (`crawlerService.extractWithRetry` calls `worker.extract` without `captureHtml`).
2. **No computed-style / design-token evidence at all.** No module captures `getComputedStyle`, CSS custom properties, font stacks, spacing, radii, or shadows. The only style-adjacent evidence is the Phase 7 `responsive_captures.element_map`, a bounded visible-element map (`selector`, `x`, `y`, `width`, `height`, `visible`, `display`, `fontSize`) with no color/typography/spacing/radius/shadow values.

A Blueprint cannot be fabricated from page metadata alone, and design tokens cannot be invented. Therefore Phase 9 must **first** add a bounded, read-only **blueprint evidence capture** capability (a new worker command + persistence), then normalize. This mirrors the Phase 8 "critical-gap fix first" precedent.

**Honesty rule (mandatory).** A detected technology or a visual/layout pattern is **evidence**, never proof of a specific component implementation. The Blueprint must distinguish **observed evidence** from **inferred semantic classification** (see §5.6). Where the spec is silent on provenance (§10, decision C8), Phase 9 adds an **optional, additive** provenance namespace; it never weakens the required schema.

---

## 2. Current-state findings (inspection)

- **Branch / HEAD**: `main` at `6e4ae802b19058972161d7096b1908d4fbf96221` ("feat(clone): add static clone engine and local asset server"). No merge/rebase in progress; `.git` has no `MERGE_HEAD`/`REBASE_HEAD`; working tree is clean.
- **Phase status**: Phases 0–8 are implemented and documented (see `PLAN.md` per-phase "as built" notes and `CHANGELOG.md`). Phase 9 is **not started**.
- **No Blueprint code exists.** Searches for `blueprint` under `src/**/*.ts*` return only: reserved `blueprint.*` event keys and the `blueprint` error category/`BLUEPRINT_VALIDATION_FAILED` code (`eventBus.ts`, `errors.ts`), the `blueprints` table sketch in `DATABASE.md` §3, and `projects.status = 'blueprint_ready'`. There is no `src/services/blueprint/`, no `src/types/blueprint.ts`, no `blueprints` migration, no `BlueprintRepository`, no store, no UI.
- **Dependency output contracts (exact, as built)**:
  - **Scan pages** — `ScanPage` (`src/types/models.ts`) / `scan_pages` (migration `002` + `raw_html_path` in `007`): `id, scanId, url, finalUrl, path, depth, httpStatus, title, metaDescription, canonicalUrl, robotsMeta, status('completed'|'failed'|'timeout'|'skipped'), authStatus, errorCode, errorMessage, loadTimeMs, domContentLoadedTimeMs, domNodeCount, headings[], internalLinks[], externalLinks[], images[{src,alt,internal}], warnings[], capturedAt, createdAt, rawHtmlPath|null`. `rawHtmlPath` is currently always null for crawler-written rows.
  - **Assets** — `CloneAsset` / `scan_assets` (migration `007`): `sourceUrl, localPath, mimeType, sizeBytes, sha256, assetType('image'|'stylesheet'|'script'|'font'|'video'|'audio'|'document'|'other')`. Bytes on disk under `<app_local_data_dir>/clones/v1/`.
  - **Technology** — `ScanTechnology` / `scan_technologies` (migration `003`): `technologyId, category, name, version|null, confidenceStatus('detected'|'probable'|'unknown'), confidence(0..1), versionStatus('exact'|'major_only'|'unavailable'), detectionSource, evidence[{vector,evidence,weight}], pages[], limitation|null`.
  - **Responsive** — `ResponsiveCapture` / `responsive_captures` (migration `006`): `profile('desktop'|'tablet'|'mobile'), width, height, deviceScaleFactor, isMobile, hasTouch, screenshotPath|null, detectedBreakpoints[] (numbers), elementMap[{key,tagName,selector,x,y,width,height,visible,display,fontSize}], truncated, capturedAt`. One row per `(page_id, profile)`.
  - **Clone evidence** — clone tree at `<clones>/v1/` (`index.html`, `pages/*.html`, `css/`, `js/`, `assets/`, `manifest.json`), reachable only through the sandboxed Rust `clone_read` command.
- **Worker protocol**: `WORKER_PROTOCOL_VERSION` is `1`; all additions so far are additive. Commands: `ping, launch, navigate, close, extract, abort, detectLogin, captureState, captureViewport, captureAssets, serveClone, stopClone`.
- **Storage**: repositories `projects, scans, pages, technologies, authSessions, responsiveCaptures, assets, settings` (`StorageRepositories`). Latest migration is `007_scan_assets` (version 7). No `blueprints` repository.
- **Store seam pattern** (`cloneStore`, `technologyStore`, `responsiveStore`): read persisted rows as source of truth, mirror the domain `*.events` for live refresh, honest `loading | empty | error | partial` states, injectable test seams.
- **Event taxonomy** already reserves `blueprint.started`, `blueprint.generated`, `blueprint.validation_failed`, `blueprint.completed` (no payload contracts yet).
- **Error taxonomy** already reserves `blueprint` category and `BLUEPRINT_VALIDATION_FAILED`, `UNSUPPORTED_VERSION` codes.

---

## 3. Scope & explicit non-goals

### 3.1 In scope

1. The Phase 9 **critical-gap fix**: bounded, read-only blueprint-evidence capture (DOM + computed-style subset + CSS custom properties) and its persistence.
2. `src/types/blueprint.ts` + the Zod `BlueprintSchema` mirroring `BLUEPRINT-SPEC.md` §3/§4 exactly, plus the additive optional provenance extension (§5.6).
3. `src/services/blueprint/` normalization engine: DOM→component segmentation, design-token extraction, route/page/navigation modeling, state/form modeling, technology/asset/responsive consumption.
4. Persistence: migration `008_blueprints` (append-only), `BlueprintRepository`, sandboxed blueprint file I/O.
5. Validation engine + migration runner skeleton (`BlueprintMigrationRunner`, zero registered migrations at v1).
6. Lifecycle integration in `scanService` after a completed crawl.
7. A read-only `BlueprintPanel` + `blueprintStore` on the Scan route with honest states.
8. Tests, fixtures, and documentation updates.

### 3.2 Explicit non-goals

- No AI/LLM calls (Phase 10–11) and no prompt compilation; the Blueprint is produced deterministically.
- No code generation / project scaffolding (Phase 12) and no doc/ZIP export (Phase 14).
- No visual diffing (Phase 13).
- No inference of Tailwind utility classes from responsive captures (deferred Phase 7 work stays deferred).
- No "guessing" of values the evidence does not support: missing evidence is represented as absent/empty (see §5.6), never fabricated.
- No new process manager, browser runtime, or crawler; no `WORKER_PROTOCOL_VERSION` bump.
- No changes to migrations `001`–`007` (checksums must stay stable).

---

## 4. Blueprint schema design (mirrors `BLUEPRINT-SPEC.md` exactly)

The Zod schema in `BLUEPRINT-SPEC.md` §4 is the **authoritative validator** (the spec titles it "Blueprint Validation Engine"). `src/types/blueprint.ts` provides the matching TypeScript interfaces from §3. The following table reproduces the required structure, field types, and required/optional status. Optionality is taken from the §4 Zod (`.optional()`) and §3 (`?`); everything else is required.

### 4.1 Root

| Field | Type | Required |
| :--- | :--- | :--- |
| `$schema` | `string` | optional |
| `blueprint_version` | literal `1` | required |
| `generated_at` | ISO-8601 datetime string | required |
| `source_url` | URL string | required |
| `generator` | `{ name: string; version: string }` | required |
| `site` | `BlueprintSite` | required |
| `pages` | `BlueprintPage[]` | required |
| `routes` | `BlueprintRoute[]` | required |
| `components` | `BlueprintComponent[]` | required |
| `layout` | `BlueprintLayout` | required |
| `navigation` | `BlueprintNavigation` | required |
| `content` | `BlueprintContent` | required |
| `assets` | `BlueprintAssets` | required |
| `design_system` | `BlueprintDesignSystem` | required |
| `responsive_rules` | `BlueprintResponsiveRules` | required |
| `interactions` | `BlueprintInteraction[]` | required |
| `forms` | `BlueprintForm[]` | required |
| `authentication` | `BlueprintAuthentication` | required |
| `technologies` | `BlueprintTechnologies` | required |
| `seo` | `BlueprintSeo` | required |
| `analytics` | `BlueprintAnalytics` | required |
| `infrastructure` | `BlueprintInfrastructure` | required |
| `admin_requirements` | `BlueprintAdminRequirements` | required |
| `provenance` | additive optional extension (§5.6) | optional |

### 4.2 Section fields (required/optional)

- **`site`** (§2.1): `name`, `domain`, `canonical_url` (URL), `default_locale`, `supported_locales[]`, `direction('ltr'|'rtl')`, `favicon_url`, `theme_color`, `description` — all required.
- **`pages`** (§2.2): `id`, `path` (must start `/`), `title`, `layout_id`, `template`, `is_dynamic`, `dynamic_param_names[]`, `meta` (record of string), `root_component_ids[]` — all required.
- **`routes`** (§2.3): `path` (starts `/`), `page_id`, `auth_required`, `allowed_roles[]`, `redirect_to` (string|null) required; `route_params?` optional array of `{ name, type, pattern? }`.
- **`components`** (§2.4): `id`, `name`, `category('ui_primitive'|'composite'|'layout'|'data_display'|'form')`, `variants` (record<string,string>), `props[]`, `children_slots[]`, `dependencies[]` — all required. Each prop: `name`, `type('string'|'number'|'boolean'|'enum'|'object'|'array')`, `required` required; `options?`, `default?` optional.
- **`layout`** (§2.5): `default_layout_id` required; `definitions[]` each with `id`, `name`, `header_component_id|null`, `footer_component_id|null`, `sidebar_component_id|null`, `container_width`, `body_bg_color`, `slots[]` — required.
- **`navigation`** (§2.6): `primary_menu`, `footer_menu`, `user_menu` — each `BlueprintNavItem[]` required. Nav item: `id`, `label` required; `href?`, `action?`, `target?('_self'|'_blank')`, `requires_auth?`, `children?[]` optional. *(Spec §4 Zod uses `z.array(z.any())` here — a weakness; Phase 9 strengthens it to `BlueprintNavItemSchema` while keeping the JSON shape identical. Recorded as decision C9.)*
- **`content`** (§2.7): `strings` (record<string,string>), `blocks[]` each `{ id, type('markdown'|'html'|'json'), content }` — required.
- **`assets`** (§2.8): `images[]` (`id, source_url, local_path, mime_type, sha256` required; `width?`, `height?` optional), `icons[]` (`id`, `type('inline_svg'|'font_icon'|'image')` required; `svg_content?`, `glyph_name?` optional), `fonts[]` (`family, weights[], styles[], source('google_fonts'|'custom_file'|'system')` required; `files?[]` optional).
- **`design_system`** (§2.9): `colors` (record<string, string | record<string,string>>), `typography` (`font_sans[]`, `font_mono[]`, `font_sizes` record, `line_heights` record), `spacing` record, `radii` record, `shadows` record — required.
- **`responsive_rules`** (§2.10): `breakpoints` (record<string,string>), `overrides[]` each `{ component_id, breakpoint, action }` required; `value?`, `target_slot?` optional.
- **`interactions`** (§2.11): `id`, `trigger_component_id`, `event`, `action` required; `target_component_id?`, `animation?{type,duration_ms}` optional.
- **`forms`** (§2.12): `id`, `name`, `method('GET'|'POST'|'PUT'|'DELETE')`, `action_endpoint`, `fields[]`, `submit_button_label` required; `success_message?`, `error_message?` optional. Field: `name, label, type, required` required; `placeholder?`, `options?[{label,value}]`, `validations?[{rule, value?, message}]` optional.
- **`authentication`** (§2.13): `type('none'|'jwt'|'cookie_session'|'oauth'|'basic')`, `roles[]`, `protected_route_patterns[]` required; `login_route?`, `logout_route?`, `dashboard_route?`, `session_storage_type?`, `cookie_names?[]` optional.
- **`technologies`** (§2.14): all optional — `frontend_framework?{name,version?,confidence}`, `ui_libraries?[]{name,version?,confidence}`, `runtime?{name,confidence}`, `cdn?{name,confidence}`, `analytics?[]{name,id?}`.
- **`seo`** (§2.15): `default_title_template`, `open_graph` (record), `twitter` (record), `structured_data[]{type,data}` — required.
- **`analytics`** (§2.16): `providers[]{provider, page_view_tracking}` required with `container_id?`; `custom_events[]{event_name, trigger_component_id, parameters}` required.
- **`infrastructure`** (§2.17): `node_version`, `package_manager('npm'|'pnpm'|'yarn'|'bun')`, `recommended_target('vercel'|'cloudflare_pages'|'netlify'|'docker'|'static_spa')`, `env_variables[]{key,required,secret,description}` with `default?`, `build_command`, `output_directory` — required.
- **`admin_requirements`** (§2.18): `entities[]{name,plural,fields[]{name,type, primary_key?/searchable?/sortable?/options?}, capabilities[]}` — required (may be `{ entities: [] }` when no evidence).

### 4.3 Versioning

- Root integer `blueprint_version: 1` (literal). `$schema` is `https://artupski.com/schemas/blueprint.v1.json` (optional in the document; emitted for tooling).
- The DB row also carries `version` (blueprint document revision) and `schema_version` (integer, currently `1`) per `DATABASE.md` §3.
- `BlueprintMigrationRunner` implements the `BLUEPRINT-SPEC.md` §5 contract (never mutate in place; deterministic defaults; lossless conversion preserving unhandled fields under `_v1_legacy_props`; re-run the target Zod validator and abort without overwriting disk on failure). At v1 the registry is empty; the runner is exercised by a synthetic v1→v2 test fixture.

---

## 5. Normalization strategy

### 5.1 Blueprint evidence capture (critical-gap fix, worker)

Add one additive worker command **`captureBlueprint`** (or, preferred for cohesion, extend `extract` with a bounded `captureBlueprintEvidence` option and a matching `extractBlueprint` client method). Recommended shape:

- Payload: `{ sessionId, url, timeoutMs, maxNodes?, maxBytes? }`.
- The worker navigates with the **same** URL/network policy as `extract`/`captureAssets`, then returns a **bounded semantic DOM tree** plus a **computed-style subset**:
  - `nodes[]`: `{ id, parentId, tag, role, text?, attrs (allowlisted, secret-stripped), classes[], childIds[], visible, bounds {x,y,width,height}, styles { display, position, flexDirection, gridTemplateColumns, fontSize, fontWeight, lineHeight, color, backgroundColor, borderRadius, boxShadow, margin, padding, gap, fontFamily } }`.
  - `cssVariables`: `Record<string,string>` read from `:root`/`html`.
  - `fontFaces`: bounded list of `@font-face` families/weights (no bytes).
  - `forms`: bounded form descriptors (action/method/fields/labels/validation attributes).
  - `truncated`, `nodeCount`, `byteLength`.
- Caps: `MAX_BLUEPRINT_NODES` (e.g. 5 000), `MAX_BLUEPRINT_BYTES` (e.g. 4 MiB), bounded text per node, allowlisted attributes only. Over-cap content is truncated and flagged.
- **Security**: never read or return cookie values, `Authorization`/token headers, input `value`s, or password fields' contents; strip `<script>` bodies; truncate data URIs. Reuse `evaluateUrlPolicy` on every navigation/redirect exactly as `extract` does.
- Persist the raw bounded evidence to disk via a sandboxed Rust command (see §6) and store only a path on the page row (additive nullable column, migration `008`), analogous to `scan_pages.raw_html_path`.

> Decision: reuse Phase 8's `captureHtml` where the raw HTML body is needed for text/content extraction, and use the new computed-style/DOM evidence for tokens and structure. Both are bounded and policy-checked.

### 5.2 DOM → component segmentation

- Deterministic, rule-based (no AI). Segment the semantic tree by landmark and repetition heuristics:
  - Landmarks → `layout` slots: `<header>`→header, `<nav>`→primary/footer nav, `<main>`→main, `<aside>`→sidebar, `<footer>`→footer.
  - Repeated sibling structures with the same signature (tag + class-set + child shape) → a single `composite` component with `variants` derived from observed class differences (e.g. `primary`/`secondary`), and per-instance `props` where values differ.
  - Interactive/form controls → `ui_primitive` / `form` components.
  - Data regions (tables, definition lists, card grids bound to repeated data) → `data_display`.
- **Nesting rules**: components form a tree via `root_component_ids` per page; nesting is bounded by `MAX_COMPONENT_DEPTH` (e.g. 12) and `MAX_COMPONENTS` (e.g. 500). A cycle is impossible (tree from DOM parent links); depth overflow collapses to a `composite` leaf with a `limitation` note (provenance).
- **Component identity**: stable ids (`cmp_<slug>_<n>`) derived deterministically from structural signature, so re-runs are stable and diffable.
- **Honesty**: every component carries provenance (`observed` vs `inferred`); a technology detection (e.g. "Tailwind CSS") never upgrades a component's `category` to a specific implementation. A visual pattern (e.g. a card grid) is `inferred: composite`, not asserted as a named library component.

### 5.3 Design-token extraction

- Inputs: `cssVariables` (highest trust — author-declared), `computed-style subset` frequencies across visible nodes, and `fontFaces`.
- Normalize into `design_system`:
  - `colors`: cluster observed `color`/`backgroundColor` values; map CSS variables to semantic keys when names are recognizable (`--primary`, `--background`, …); emit `primary` scale objects only when a real scale is observed (never invent 50/500/900 steps).
  - `typography`: `font_sans`/`font_mono` from observed `fontFamily` stacks; `font_sizes`/`line_heights` as named steps (`xs`…`4xl`) mapped from observed values (documented mapping table); values are the **observed** CSS strings, not Tailwind guesses.
  - `spacing`, `radii`, `shadows`: keyed records derived from observed values (bounded cardinality; overflow dropped with a warning).
- Deduplicate and sort deterministically. Every token entry carries provenance (observed CSS var vs computed frequency).

### 5.4 Routes, pages, navigation

- **Pages** from persisted `scan_pages` where `status = 'completed'`: `id` stable per URL; `path` from `ScanPage.path`; `title` from `ScanPage.title`; `template` classified from structure (landing/content/app); `layout_id` from the dominant layout signature; `meta` from title/description/robots/canonical; `root_component_ids` from §5.2.
- **Dynamic routes**: infer `is_dynamic`/`dynamic_param_names` from repeated path segments across pages (e.g. `/blog/a`, `/blog/b` → `/blog/:slug`); only when ≥2 observed instances agree, never guessed from a single page.
- **Routes** mirror pages with `auth_required` from `ScanPage.authStatus` (`auth_required`/`blocked`) and `allowed_roles` from auth evidence; `redirect_to` from observed redirects when captured, else null.
- **Navigation** from segmented header/footer nav components: `primary_menu`/`footer_menu`/`user_menu` with `href`, `target`, nested `children`, and `requires_auth` from auth classification of the target path. Out-of-scope external links are preserved as items, never fetched.

### 5.5 State, forms, interactions, content, assets, technologies

- **State**: `BLUEPRINT-SPEC.md` has **no dedicated `state` section** (see §10, C10). State is represented via `interactions[]` (trigger/event/action/target) and component `variants`; explicit client-state stores are out of scope (would require executing site JS, which is forbidden).
- **Forms**: from the bounded form descriptors (action/method/fields/labels/required/placeholder/options/`pattern`/`min`/`max`/`minlength`/`maxlength` → `validations[]`); `success_message`/`error_message` only when observed, else omitted.
- **Content**: `strings` keyed by a deterministic `page.section.field` scheme from headings/labels/button text; `blocks` from long-form text (markdown only when the source is clearly markdown-like, else `html`).
- **Assets**: images/icons/fonts mapped from `scan_assets` (+ observed `<img>`/`<svg>`); `local_path` from the clone tree; `sha256`/`mime_type`/dimensions from `scan_assets`; inline SVG content bounded.
- **Technologies**: projected from `scan_technologies` into the spec's five optional buckets (`frontend_framework`, `ui_libraries`, `runtime`, `cdn`, `analytics`). Mapping is by `category`; only `detected`/`probable` are surfaced, with confidence preserved; `unknown` candidates are omitted (matching the detection engine's own suppression).

### 5.6 Evidence vs inference & missing/conflicting evidence (mandatory)

- The spec is silent on provenance. Phase 9 adds an **optional, additive** `provenance` namespace (non-breaking; absent documents still validate):
  - `provenance.observations`: bounded list of `{ kind, ref, source }` linking an output node/section to its evidence (page URL, DOM node id, CSS variable name, asset sha256, technology id).
  - `provenance.inferences`: `{ ref, method, confidence, limitation? }` for any semantic classification (component category, dynamic route, layout mapping).
  - `provenance.evidence_summary`: `{ pagesConsidered, pagesWithEvidence, nodesObserved, nodesTruncated, designTokensObserved, designTokensInferred, technologiesDetected }`.
- **Missing evidence** → the field is emitted as the spec's empty value (`[]`, `{}`, `''`, `null` where the type allows) and recorded in `provenance` as absent; never fabricated. Example: no computed colors → `design_system.colors` is `{}` (valid) with an `inferences` limitation note.
- **Conflicting evidence** (e.g. two font stacks, a nav present on one page but not another) → emit both observed candidates where the type permits (e.g. `font_sans` array), pick a deterministic primary for singular fields, and record the conflict in `provenance.inferences.limitation`. Never silently drop a conflicting observation.
- **Ambiguous evidence** (a repeated block that could be a card or a list) → keep it as the lower-commitment `composite` category with `confidence < 1` and a limitation note.

---

## 6. Persistence & migration (append-only)

**Decision: persistence is required.** The Blueprint document is large; only its path + validation metadata live in SQLite (consistent with `DATABASE.md` §3/§6 and the Phase 7/8 "bytes on disk, metadata in DB" rule).

- **Migration `008_blueprints.ts` (version 8)** — creates the `blueprints` table from `DATABASE.md` §3:
  - Columns: `id`, `project_id` (`REFERENCES projects(id) ON DELETE CASCADE`), `scan_id` (`REFERENCES scans(id) ON DELETE SET NULL`), `version` (document revision, default 1), `schema_version` (integer, default 1), `file_path` (sandboxed path to `blueprint.v1.json`), `is_valid` (0/1), `validation_errors` (JSON array), `created_at`, `updated_at`.
  - Indexes: `idx_blueprints_project_id`, `idx_blueprints_scan_id`. Add a **unique** `idx_blueprints_scan_version (scan_id, version)` so re-running synthesis updates the existing revision rather than duplicating.
  - **Additive nullable column** on `scan_pages` for the captured blueprint evidence path (e.g. `blueprint_evidence_path TEXT`), so evidence survives between runs without re-crawling; nullable ⇒ legacy/non-blueprint scans unaffected.
- **Filesystem**: new sandboxed Rust module `src-tauri/src/blueprint.rs` exposing `blueprint_root` / `blueprint_write` / `blueprint_read` / `blueprint_delete`, confined to `<app_local_data_dir>/blueprints` (same hard-sandbox pattern as `clone.rs`/`asset.rs`; rejects absolute paths and `..`). Output at `<blueprints>/v1/<blueprintId>.json`. *(Open decision C11: `DATABASE.md` §6 sketches `<project>/blueprint/`; Phase 8 chose `<app_local_data_dir>/clones` (spec over arch) for the same containment reasons — Phase 9 follows that precedent.)*
- **`BlueprintRepository`** owns all `blueprints` SQL: `upsert` (conflict on `(scan_id, version)`), `getById`, `findLatestByScan`, `listByProject`, `deleteByScan`, `deleteById`.
- **Registration**: export `BlueprintRepository` from `src/services/storage/index.ts`, register it in `StorageRepositories` (`buildRepositories`), add row/domain mappers in `src/services/storage/types.ts`, and add `Blueprint`/`BlueprintValidationError` domain types to `src/types/models.ts`.
- **Backward compatibility**: append-only; `001`–`007` untouched; all changes are `CREATE … IF NOT EXISTS` / nullable `ADD COLUMN`.

---

## 7. Worker protocol changes

Additive; `WORKER_PROTOCOL_VERSION` stays `1` (no existing frame changes meaning).

1. **New command `captureBlueprint`** (or `extract` option) returning the bounded DOM + computed-style evidence from §5.1. Validated at the boundary (`COMMAND_NAMES`, `validateCommandPayload`, `validateResultPayload`) reusing the existing primitives; malformed frames remain `WORKER_PROTOCOL_VIOLATION`.
2. **New limits** in `workerProtocol.ts`: `MAX_BLUEPRINT_NODES`, `MAX_BLUEPRINT_BYTES`, `MAX_BLUEPRINT_TEXT_CHARS`, `MAX_BLUEPRINT_FORMS`, `MAX_BLUEPRINT_CSS_VARS`.
3. **No secrets**: never read cookie values, auth headers, input values, or password contents; attribute allowlist; script bodies stripped. No secret is ever echoed in a result, log, or event.
4. **Re-export** the new symbols through `src/workers/crawler/protocol.ts`; implement in `src/workers/crawler/index.ts`; add the typed client method in `src/services/scanner/scannerWorkerClient.ts`.

---

## 8. Service, store & UI integration

### 8.1 Service layer (`src/services/blueprint/`)

- Pure modules (no I/O, unit-tested): `domNormalizer.ts` (tree → components), `designTokens.ts`, `routes.ts` (pages/routes/navigation), `forms.ts`, `content.ts`, `assets.ts`, `technologies.ts`, `evidence.ts` (provenance), `schema.ts` (Zod `BlueprintSchema` mirroring the spec), `migrations.ts` (`BlueprintMigrationRunner`), `validate.ts`.
- `blueprintService.ts` (orchestrator): composes the pure modules over persisted `scan_pages` + `scan_technologies` + `responsive_captures` + `scan_assets` + captured evidence; assembles the root document; validates with Zod; writes the JSON through the sandboxed Rust command; persists the `blueprints` row; emits `blueprint.*` events; returns an honest `{ ok, blueprintId, valid, errors, warnings, skippedPages }` report. A page without captured evidence is **skipped and counted**, never fabricated.
- `blueprintFactory.ts`: wires the service to live storage/worker/IPC seams (mirrors `cloneFactory.ts`).
- `runBlueprint.ts`: the UI seam (resolve project/scan → run synthesis → persist → return report), mirroring `runClone.ts`.

### 8.2 Store (`src/stores/blueprintStore.ts`)

- Read-only UI state: `blueprint: BlueprintRoot | null`, `validation: { valid, errors } | null`, `loading`, `error`, `partial`, `loadForScan(scanId)`, `watch(scanId)`, `clear()`.
- The database is the source of truth (`findLatestByScan`); `blueprint.*` events trigger a refresh. Never fabricate a Blueprint or a "valid" badge.

### 8.3 Lifecycle integration

- Run in `scanService.runScan` **after a completed crawl**, after technology detection (already inside `CrawlerService`) and after the optional responsive capture step, gated by an opt-in request flag (e.g. `runScan({ blueprint: true })`), so existing callers are unaffected.
- A blueprint failure never changes the crawl's terminal status (same rule as responsive capture). A completed scan with synthesis enabled always ends with a persisted, validated Blueprint row (or an explicit `is_valid = 0` with errors).
- Emit `blueprint.started` → (`blueprint.generated` | `blueprint.validation_failed`) → `blueprint.completed`; add the four payload interfaces to `eventBus.ts` and `EVENT-SYSTEM.md`.

### 8.4 UI expectations

- Per `UI-SPEC.md` §2.4, the Blueprint surface is a **raw interactive JSON viewer with a schema-validator badge**. Phase 9 delivers a minimal, honest `BlueprintPanel` on the Scan route (backed by `blueprintStore`):
  - "Generate blueprint" action, validation badge (`Valid` / `Invalid` with error list), document metadata (version, generated_at, page/component counts), "Export Blueprint JSON", and loading/empty/error/partial states.
  - Reuses existing primitives only (`Panel`, `Badge`, `Button`, `StatusIndicator`, `EmptyState`) and existing tokens; no new palette; `anti-ui-slop` compliance mandatory.
  - A richer Components/Routes inspector tab is deferred to Phase 11+ (documented).
- English copy only; no secrets or raw cookie material is rendered.

---

## 9. Validation & error handling

- **Runtime validation**: `BlueprintSchema` (Zod) validates the assembled document before persistence. Invalid documents are persisted with `is_valid = 0` and a bounded `validation_errors` JSON array (paths + messages), and `blueprint.validation_failed` is emitted with the error code `BLUEPRINT_VALIDATION_FAILED` (category `blueprint`).
- **Version handling**: an unknown `blueprint_version` raises `UNSUPPORTED_VERSION`; the migration runner migrates legacy documents to the target version and re-validates, aborting without overwriting disk on failure (spec §5.2).
- **Error reporting**: all failures surface as `StructuredError` (never thrown at the UI). Non-fatal per-page/evidence problems are collected in `warnings` and `provenance` and reported honestly; a partial Blueprint is labelled partial.
- **Disk safety**: write to a temp path then atomic rename via the sandboxed command; never overwrite a valid document with an invalid one.

---

## 10. Security & resource limits

- **No credentials/cookies/tokens**: the evidence capture reads structure/styles only; cookie names (not values), auth headers, input values, and password contents are never captured, logged, emitted, or persisted. Prompt-injection isolation (AI-SPEC §5) is a Phase 10 concern; Phase 9 stores untrusted text verbatim as data.
- **Bounded recursion & payload**: `MAX_COMPONENT_DEPTH`, `MAX_COMPONENTS`, `MAX_BLUEPRINT_NODES`, `MAX_BLUEPRINT_BYTES`, `MAX_BLUEPRINT_TEXT_CHARS`, bounded token cardinality; over-cap content truncated and flagged.
- **Sandboxing**: all file I/O goes through the sandboxed Rust `blueprint.rs` (absolute/`..`/symlink-escape rejected, app-local-data confinement); the frontend never supplies a path.
- **No network**: normalization is a pure function of persisted evidence; no new network access (matching the detection engine's rule).
- **No secret in events/logs**: `blueprint.*` payloads carry ids, counts, validity, and bounded error messages only.

---

## 11. Test matrix & fixtures

- **Unit — schema** (`src/services/blueprint/__tests__/schema.test.ts`): valid document passes; missing section/field, bad color, non-`/`-prefixed path, unknown enum, bad URL, wrong `blueprint_version` all fail with descriptive paths. Includes the spec's §2 example documents.
- **Unit — normalizer** (`domNormalizer.test.ts`): landmark segmentation, repeated-sibling component merging, nesting/depth caps, deterministic ids, honesty (technology detection does not upgrade category), missing/conflicting/ambiguous evidence handling.
- **Unit — design tokens** (`designTokens.test.ts`): CSS-variable precedence, computed-style clustering, no invented scale steps, deterministic ordering, cardinality caps.
- **Unit — routes/forms/content/assets/technologies** (`routes.test.ts`, `forms.test.ts`, `content.test.ts`, `assets.test.ts`, `technologies.test.ts`): dynamic-route inference requires ≥2 instances; form validation mapping; technology category projection; empty-evidence empties.
- **Unit — provenance** (`evidence.test.ts`): observations/inferences recorded; missing vs conflicting vs ambiguous distinctions.
- **Unit — migrations** (`migrations.test.ts`): synthetic v1→v2 runner (never mutates in place; lossless `_v1_legacy_props`; re-validates; aborts without overwriting on failure).
- **Storage** (`src/services/storage/__tests__/blueprints.test.ts`): migration 008 registration/checksum/table+indexes + `blueprint_evidence_path` column; `BlueprintRepository` upsert/conflict/list/cascade/reopen.
- **Protocol** (`src/services/infra/workerProtocol.test.ts`): `captureBlueprint` command/result validation (valid + malformed); limits.
- **Service** (`blueprintService.test.ts`): full synthesis over fake evidence + in-memory storage → asserts a schema-valid document, the persisted row, and the honest **skip** path when a page has no evidence.
- **Store** (`src/stores/blueprintStore.test.ts`): honest loading/empty/error/partial from persisted rows.
- **Fixtures** (`scripts/fixtures/blueprint/**`): a small multi-page fixture with landmarks, a repeated card grid, a nav with dropdowns, a contact form, CSS variables, fonts, and a responsive breakpoint — served by `fixtureServer.mjs` on a dedicated port.
- **Opt-in real-browser E2E** (`src/workers/crawler/__tests__/blueprintCapture.e2e.test.ts`, gate `RUN_BROWSER_TESTS=1`, dedicated fixture port): drives the real worker to capture evidence and asserts the resulting Blueprint passes Zod and contains the expected landmarks/components/tokens.
- **Tooling**: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:storage`, `npm run build`, the opt-in browser suite, and `cargo check` / `cargo clippy` / `cargo fmt --check` in `src-tauri`.

### 11.1 Acceptance criteria → verification

| Acceptance criterion | Verification |
| :--- | :--- |
| Emitted Blueprint passes the §4 Zod schema completely | `blueprintService.test.ts` + `schema.test.ts`; E2E asserts `BlueprintSchema.safeParse(...).success === true` |
| Document mirrors `BLUEPRINT-SPEC.md` §2/§3/§4 exactly | `schema.test.ts` against the spec's example documents; `typecheck` |
| Observed evidence is distinguished from inferred classification | `evidence.test.ts` + `domNormalizer.test.ts` honesty assertions |
| Missing/conflicting/ambiguous evidence is represented, never fabricated | normalizer/design-token/routes tests |
| Persistence + append-only migration | `blueprints.test.ts` (migration 008, checksum, cascade, reopen) |
| No credentials/cookies/tokens in any artifact | evidence-capture tests assert absent secrets; store/UI render tests |
| Bounded recursion/payload | limit tests in normalizer/protocol |
| Lifecycle never changes crawl terminal status | `blueprintService.test.ts` failure-path test |
| Honest UI states | `blueprintStore.test.ts` + panel render test |

---

## 12. Files expected to change

### 12.1 New

| Path | Responsibility |
| :--- | :--- |
| `src/types/blueprint.ts` | TypeScript interfaces mirroring `BLUEPRINT-SPEC.md` §3 + additive `provenance`. |
| `src/services/blueprint/schema.ts` | Zod `BlueprintSchema` mirroring §4 (authoritative validator). |
| `src/services/blueprint/domNormalizer.ts` | Bounded DOM → component segmentation + nesting rules. |
| `src/services/blueprint/designTokens.ts` | Design-token extraction/normalization. |
| `src/services/blueprint/routes.ts` | Pages/routes/navigation modeling + dynamic-route inference. |
| `src/services/blueprint/forms.ts` | Form/validation modeling. |
| `src/services/blueprint/content.ts` | Content strings/blocks extraction. |
| `src/services/blueprint/assets.ts` | Asset registry projection from `scan_assets`. |
| `src/services/blueprint/technologies.ts` | Technology projection from `scan_technologies`. |
| `src/services/blueprint/evidence.ts` | Provenance (observations/inferences/evidence_summary). |
| `src/services/blueprint/validate.ts` | Validation wrapper + bounded error formatting. |
| `src/services/blueprint/migrations.ts` | `BlueprintMigrationRunner` (spec §5). |
| `src/services/blueprint/blueprintService.ts` | Orchestrator. |
| `src/services/blueprint/blueprintFactory.ts` | Live-seam wiring. |
| `src/services/blueprint/runBlueprint.ts` | UI seam. |
| `src/services/blueprint/index.ts` | Public surface. |
| `src/services/storage/migrations/008_blueprints.ts` | Migration 8 — `blueprints` table + `scan_pages.blueprint_evidence_path`. |
| `src/services/storage/repositories/blueprintRepository.ts` | All `blueprints` SQL. |
| `src/stores/blueprintStore.ts` | Read-only Blueprint UI state. |
| `src/components/blueprint/BlueprintPanel.tsx` | Scan-route Blueprint viewer + validator badge + export. |
| `src-tauri/src/blueprint.rs` | Sandboxed blueprint file I/O. |
| `scripts/fixtures/blueprint/**` | Blueprint capture fixtures. |
| `src/services/blueprint/__tests__/*.test.ts` | Unit + service tests. |
| `src/workers/crawler/__tests__/blueprintCapture.e2e.test.ts` | Opt-in real-Chromium E2E. |
| `docs/impl-plan/phase-9-impl-plan.md` | This document. |

### 12.2 Changed (additive / backward-compatible)

| Path | Change |
| :--- | :--- |
| `src/services/infra/workerProtocol.ts` | `captureBlueprint` command/result + limits + boundary validation. |
| `src/workers/crawler/protocol.ts` | Re-export the new symbols. |
| `src/workers/crawler/index.ts` | Implement `captureBlueprint`. |
| `src/services/scanner/scannerWorkerClient.ts` | Typed `captureBlueprint` client method. |
| `src/services/scanner/crawlerService.ts` | Optionally capture blueprint evidence per page (opt-in). |
| `src/services/scanner/scanService.ts` | Run synthesis after a completed crawl (opt-in flag). |
| `src/services/storage/{index.ts,types.ts,storageService.ts}` | Export `BlueprintRepository`; register it; add row/domain mappers. |
| `src/types/models.ts` | `Blueprint` domain type; `ScanPage.blueprintEvidencePath`. |
| `src/services/storage/migrations/index.ts` | Register migration 008. |
| `src/services/ipc/commands.ts` (+ `index.ts`) | `blueprintRoot` / `blueprintWrite` / `blueprintRead` / `blueprintDelete` wrappers. |
| `src/services/infra/eventBus.ts` | `blueprint.*` payload interfaces + payload map. |
| `src/routes/ScanRoute.tsx` | Mount `BlueprintPanel`. |
| `src-tauri/src/lib.rs` | Register the blueprint commands. |
| `scripts/fixtureServer.mjs` | Serve the blueprint fixture routes. |
| Docs | `PLAN.md`, `CHANGELOG.md`, `BLUEPRINT-SPEC.md` (as-built note), `ARCHITECTURE.md`, `DATABASE.md`, `WORKER-PROTOCOL.md`, `EVENT-SYSTEM.md`, `TESTING.md`, `docs/README.md`. |

---

## 13. Regression risks & mitigations

| Risk | Mitigation |
| :--- | :--- |
| Editing an applied migration breaks checksums. | New `008` only; `001`–`007` untouched; checksum test still passes. |
| Worker protocol change breaks existing consumers. | Purely additive; version stays `1`; every new frame validated; existing tests must pass. |
| Fabricating components/tokens from weak evidence. | Mandatory provenance; missing/conflicting/ambiguous handled explicitly; technology detection never asserts an implementation. |
| Bloated component trees (PLAN.md risk). | Hard caps on depth/nodes/components/bytes; deterministic collapse to a leaf with a limitation note. |
| Sensitive data (cookies/tokens/input values) leaking into evidence. | Attribute allowlist; never read values/headers; secret-absence assertions in tests; no secrets in events/logs. |
| Large Blueprint ballooning the DB (sql.js exports one buffer). | Document on disk; only path + validation metadata in SQLite. |
| Blueprint failure changing crawl status. | Synthesis runs after the crawl settles; failures are recorded, never propagated to the crawl's terminal status. |
| New worker command bypassing the URL/network policy. | Reuse `evaluateUrlPolicy` at every navigation/redirect, exactly as `extract`/`captureAssets` do. |
| Path traversal in blueprint file I/O. | Sandboxed Rust `blueprint.rs` with app-local-data confinement; rejects absolute/`..`/symlink escapes. |

---

## 14. Out of scope (explicit)

- AI/LLM synthesis, prompt compilation, self-repair loops (`AI-SPEC.md`) — Phase 10–11.
- Component code synthesis (React/Tailwind), project scaffolding, router/state generation — Phase 11–12.
- Visual diff / pixel comparison — Phase 13.
- Documentation generation and ZIP export — Phase 14.
- Tailwind responsive-utility inference from responsive captures (deferred Phase 7 work) — **not** Phase 9.
- Executing site JavaScript to observe runtime state — forbidden; state is represented via `interactions`/`variants` only.
- Admin-subsystem generation beyond the `admin_requirements` section — post-MVP.

---

## 15. Open decisions

| # | Decision | Resolution | Rationale (hierarchy) |
| :- | :--- | :--- | :--- |
| **C8** | Provenance is absent from `BLUEPRINT-SPEC.md`. | Add an **optional, additive** `provenance` namespace + optional per-node confidence, documented as a Phase 9 extension. Required fields are untouched, so existing/valid documents still validate. | The spec is silent (not contradictory); `ARCHITECTURE.md` §2 Layer 2 mandates normalization of *observed* data, and the mission requires distinguishing evidence from inference. Additive-only keeps `blueprint_version: 1` stable. |
| **C9** | Spec §4 Zod types `navigation.*` as `z.array(z.any())` (weak), while §3 types `BlueprintNavItem[]`. | Strengthen to `BlueprintNavItemSchema`; JSON shape is identical, so no consumer is broken. | Spec §3 (typed interface) and §2.6 (example) agree; §4's `any` is a validator omission. Spec is the authority, and a stricter validator cannot reject a valid §2.6 document. |
| **C10** | PLAN.md Phase 9 mentions "state", but `BLUEPRINT-SPEC.md` has no `state` section. | Model state via `interactions[]` + component `variants`; do not add a non-spec `state` section. | Spec > roadmap. Adding a required section would violate the schema; runtime state would require executing site JS (forbidden). |
| **C11** | Blueprint output location: `DATABASE.md` §6 (`<project>/blueprint/`) vs the established sandbox (`<app_local_data_dir>/clones`). | `<app_local_data_dir>/blueprints/v1/` via a new sandboxed `blueprint.rs`. | Same containment rationale as Phase 8 decision C4 (spec/architecture conflict resolved toward the safe sandbox); no per-project directory is used by any prior phase. Recorded as a deviation. |
| **C12** | How to obtain DOM/computed-style evidence (the critical gap). | New additive worker command `captureBlueprint` + a persisted evidence path (migration `008`), not a second crawler. | Reuses the Phase 3 process boundary and Phase 4 URL policy; no new process manager/runtime; bounded and policy-checked like `captureAssets`. |
| **C13** | Whether synthesis runs automatically after a crawl. | Opt-in via `scanService.runScan({ blueprint: true })`, after a completed crawl and after responsive capture; failures never change the crawl status. | Mirrors the Phase 7 responsive-capture gating; keeps existing callers unchanged. |

---

## 16. As-built notes

Appended as the implementation lands. Verification evidence (exact command results) is reported with the Step 5 verification. *(Empty at plan time.)*

### 16.1 Lifecycle integration, persistence, events, store & IPC (as built)

Delivered by this subtask; the UI panel/route is a later subtask.

- **Lifecycle wrapper** `src/services/blueprint/blueprintLifecycle.ts` keeps `runBlueprint` pure: `runBlueprintLifecycle(request, deps)` runs synthesis (injectable) → writes the document via the sandboxed `blueprint_write` seam → upserts the `blueprints` row (repository owns all SQL) → emits `blueprint.*`. It NEVER throws; failures return an honest `BlueprintLifecycleOutcome` with `failed: true`.
- **Integration point** in `scanService.runScan`: after a COMPLETED crawl, after technology detection and after the optional responsive-capture and evidence-capture steps, gated by `request.blueprint === true`. `runBlueprintLifecycle` runs in its own `try`-free path (it cannot throw), so a Blueprint failure can never change the crawl's terminal status; the honest outcome is attached as `ScanRunOutcome.blueprint`.
- **Failure isolation**: synthesis/file/persistence failures emit `blueprint.validation_failed` + `blueprint.completed` and persist nothing. An **invalid** document is persisted with `is_valid = 0` + bounded `validation_errors` rather than discarded.
- **Regeneration**: a new run computes `version + 1` (max existing + 1), preserving history and respecting the UNIQUE `(scan_id, version)` index.
- **No-orphan**: the file is written before the row; if the row write fails the file is deleted (tested).
- **Events**: `blueprint.started` → (`blueprint.generated` \| `blueprint.validation_failed`) → `blueprint.completed` (existing reserved keys; payload interfaces added to `eventBus.ts`, contracts documented in `EVENT-SYSTEM.md` §3.4).
- **Store** `src/stores/blueprintStore.ts`: `idle \| loading \| empty \| ready \| partial \| error`; `loadForScan`, `generate`, `exportJson`, `watch`, `clear`. Invalid/unreadable documents are surfaced as `partial` with real validation errors; nothing is fabricated.
- **IPC** (`src/services/ipc/commands.ts` + `index.ts`): `blueprintGenerate`, `blueprintGetLatest`, `blueprintExport` - thin wrappers over the lifecycle + storage; the Rust sandbox is reused, never duplicated.
- **Tests**: `blueprintLifecycle.test.ts` (round-trip, regeneration, invalid persistence, no-orphan, event order), `scanServiceBlueprint.test.ts` (integration + failure isolation + opt-out), `blueprintStore.test.ts` (honest states), plus the eventBus payload contract.

### 16.2 Schema, engine, UI, verification & deviations (as built)

Appended at finalization. Full verification evidence (exact command results) is reported with the Step 5 verification.

- **Schema location (deviation from §12.1)**: the Zod validator lives in `src/types/blueprint.ts` (not a separate `src/services/blueprint/schema.ts`), so the spec's §3 interfaces and §4 Zod are co-located as the single source of truth. `validateBlueprint()` is the entry point; `UNSUPPORTED_VERSION` is reported before schema parsing and every other failure as `BLUEPRINT_VALIDATION_FAILED` with a dot-joined path.
- **Module list (actual)**: `src/services/blueprint/` ships `analytics.ts`, `assemble.ts`, `assets.ts`, `blueprintFactory.ts`, `blueprintLifecycle.ts`, `blueprintService.ts`, `content.ts`, `designTokens.ts`, `domNormalizer.ts`, `evidence.ts`, `forms.ts`, `index.ts`, `infrastructure.ts`, `routes.ts`, `runBlueprint.ts`, `site.ts`, `technologies.ts`, `util.ts`, `validate.ts`. The `migrations.ts` (`BlueprintMigrationRunner`) named in §12.1 was **not** needed: no in-document migration exists at `blueprint_version: 1`, and `validateBlueprint` already reports `UNSUPPORTED_VERSION`, so a speculative runner would be dead infrastructure. `site.ts`/`analytics.ts`/`infrastructure.ts`/`util.ts`/`assemble.ts` were added during implementation to keep each normalizer small and single-purpose.
- **Dependency (deviation)**: `zod@^3.23.8` added as a **runtime** dependency (`package.json` + `package-lock.json`). The spec's authoritative validator is Zod; the repo had no runtime Zod before Phase 9.
- **Evidence capture (prerequisite)**: `src/workers/crawler/blueprintCapture.ts` (self-contained probe + pure coercion helpers), `src/services/scanner/blueprintEvidenceCapture.ts` (host-side orchestration), `scanService.runScan({ blueprint: true })` opt-in. The probe is bounded (nodes/bytes/text/forms/css-vars + per-depth/per-category caps), navigates under the shared URL policy, and is secret-free (attribute allowlist; no values/headers/storage; `script`/`style` bodies stripped).
- **Persistence**: migration `008_blueprints.ts` (append-only; `blueprints` + `scan_pages.blueprint_evidence_path`), `BlueprintRepository`, sandboxed `src-tauri/src/blueprint.rs` (`blueprint_root`/`blueprint_write`/`blueprint_read`/`blueprint_delete`; app-local-data confined, atomic, 64 MiB cap). The document lives at `<app_local_data_dir>/blueprints/v1/<id>.json` (decision C11).
- **UI**: `src/components/blueprint/BlueprintPanel.tsx` (+ test) mounted in `src/routes/ScanRoute.tsx`; read-only, honest states, validator badge, JSON export. No fabricated content.
- **Documentation**: `PLAN.md` (Phase 9 as-built), `CHANGELOG.md`, `ARCHITECTURE.md` §5.z, `DATABASE.md` §2.7/§6.1, `WORKER-PROTOCOL.md` §7, `EVENT-SYSTEM.md` §3.4, `TESTING.md` §5.7, `docs/README.md`, and this plan.
