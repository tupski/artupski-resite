# Artupski ReSite

Desktop-native website reverse engineering, cloning, and site blueprinting tool.

Artupski ReSite crawls a website you own or are authorized to test, produces a structured
**Blueprint** of its pages, components, and design system, synthesizes React components, generates a
buildable **Vite + React + TypeScript + Tailwind** project, and exports it with documentation — all
**locally**, with no data sent anywhere unless you explicitly configure an AI provider.

> **Authorized use only.** Only scan sites you own or have explicit written permission to test. The
> crawler enforces an SSRF-hardened URL/network policy and blocks private/loopback targets outside a
> trusted seed origin, but *you* are responsible for having the right to crawl a target.

---

## Contents

- [Prerequisites](#prerequisites)
- [Install](#install)
- [Quick start](#quick-start)
- [Run your first scan](#run-your-first-scan)
- [Build & package](#build--package)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Security posture](#security-posture)
- [Documentation](#documentation)

---

## Prerequisites

Artupski ReSite runs on the **host Node.js runtime** and a **Playwright-installed Chromium**; it
does not bundle either. Install these first (see also [`CONTRIBUTING.md`](CONTRIBUTING.md) §2.1):

| Requirement | Version | Notes |
| :--- | :--- | :--- |
| **Node.js** | `>= 20` (22.6+ or 24 recommended) | Dev + the packaged app's worker runtime. Node 22.6+/24 is required for the dev `.ts` workers; the packaged app ships pre-bundled `.js` workers. |
| **Chromium** | installed via `npx playwright install chromium` | The crawler drives real Chromium. Required for scanning. |
| **Rust toolchain** | stable (`rustc >= 1.78`, `cargo`) | Only to build the desktop shell (`npm run tauri:dev` / `npm run tauri:build`). |
| **OS build tools** | Windows: VS C++ Build Tools + WebView2 · macOS: Xcode CLT · Linux: `libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev` | Only for the desktop shell build. |

---

## Install

```bash
git clone https://github.com/tupski/artupski-resite.git
cd artupski-resite

# Frontend, worker, and test dependencies
npm install

# Playwright browser binaries (Chromium is the only engine the MVP uses)
npx playwright install chromium
```

---

## Quick start

```bash
# Launch the desktop app (Vite dev server + Tauri shell)
npm run tauri:dev
```

For a browser-only preview of the UI (no native features):

```bash
npm run dev
```

---

## Run your first scan

1. Launch the app (`npm run tauri:dev`).
2. Open **Scan**, enter a URL you are authorized to test, and choose the crawl limits.
3. Watch the live progress and the event stream; the crawl persists pages and detected technologies
   to a local SQLite database.
4. Enable **Generate Blueprint** to capture page evidence and synthesize a Blueprint document.
5. From the Blueprint, synthesize components and **generate a project** into a local folder.
6. **Export** the generated project as a ZIP (with `README.md`, `ARCHITECTURE.md`, and
   `COMPONENTS.md`) or a copied folder.

To try the pipeline without a real site, run the local fixture server and scan it:

```bash
npm run fixture:serve            # http://127.0.0.1:9099
# then scan http://127.0.0.1:9099/blueprint
```

---

## Build & package

```bash
# Type-check + production webview bundle into dist/
npm run build

# Stage the Node workers as Tauri resources, then build the desktop installers
npm run tauri:build
```

`npm run tauri:build` runs `npm run build` and `npm run stage-workers` (see
`beforeBuildCommand` in `src-tauri/tauri.conf.json`), then bundles:

| Platform | Artifacts |
| :--- | :--- |
| Windows | `.msi` (WiX) and `.exe` (NSIS) under `src-tauri/target/release/bundle/` |
| macOS | `.dmg` and `.app` (built on a macOS runner — see [`RELEASE.md`](RELEASE.md)) |

The Node workers are staged as self-contained `.js` bundles under
`src-tauri/resources/workers/`, and the runtime `playwright-core` package is shipped alongside them;
both are declared as Tauri `bundle.resources`. See [`RELEASE.md`](RELEASE.md) for the full release
process.

---

## Testing

```bash
npm run typecheck        # tsc --noEmit (src + e2e)
npm run lint             # eslint (0 warnings allowed)
npm run test             # Vitest default suite (hermetic: no browser, no network)
```

Opt-in suites (skipped by default):

```bash
# Real Chromium against the local fixture server (requires `npx playwright install chromium`)
RUN_BROWSER_TESTS=1 npm run test:browser

# The composed Phase 16 end-to-end pipeline (offline half always runs; build half needs the network)
npx vitest run e2e
RUN_PROJECT_BUILD=1 npx vitest run e2e
```

`npm run format:check` is a pre-existing, repo-wide RED and is **not** part of the definition of done
(see [`AGENTS.md`](AGENTS.md) §9).

---

## Troubleshooting

### "Node runtime not found" / worker fails to spawn

The packaged app launches its worker with `node`/`node.exe` from your `PATH`. Install Node.js
`>= 20` and ensure it is on `PATH`, then relaunch. The error surfaces as `PROCESS_SPAWN_FAILED` — it
is never silently swallowed.

### "Chromium is not installed" / browser.missing

Install the browser binary once:

```bash
npx playwright install chromium
```

The app does not download or bundle Chromium at runtime.

### Keychain unavailable

On Linux the AI API key is stored in the OS Secret Service (DBus); if no secret store is running,
key storage reports **unavailable** and the app **fails closed** (it never falls back to plaintext).
Start a Secret Service (e.g. `gnome-keyring`) or configure a provider that needs no key. On Windows
the Credential Manager and on macOS the Keychain are used.

### Dev worker uses TypeScript type stripping

In a dev checkout the workers run as `.ts` via `node --experimental-strip-types`; use Node 22.6+ (or
24). Packaged builds use pre-bundled `.js` and do not need the flag.

---

## Security posture

- **Local-first**: crawling, Blueprinting, generation, and export run on your machine. No telemetry.
- **Sandboxed processes**: the Rust layer spawns only allowlisted `node`/`node.exe` with an argument
  array (never a shell) and a sanitized environment.
- **SSRF-hardened crawler**: a URL/network policy rejects private/loopback targets outside the
  trusted seed origin and enforces redirect/scope limits.
- **Secrets**: AI API keys live in the OS keychain, never in SQLite; logs and exports are scrubbed.
- **No secret capture**: Blueprint evidence contains structure + computed styles only — never
  cookies, storage values, input values, or auth headers.

See [`docs/security/SECURITY.md`](docs/security/SECURITY.md) and
[`docs/security/PRIVACY.md`](docs/security/PRIVACY.md).

---

## Documentation

| Document | Description |
| :--- | :--- |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Development setup, conventions, commit/PR standards. |
| [`RELEASE.md`](RELEASE.md) | Versioning, tagging, artifact matrix, clean-install checklist. |
| [`AGENTS.md`](AGENTS.md) | Repository-wide engineering rules and the definition of done. |
| [`CHANGELOG.md`](CHANGELOG.md) | Notable changes by phase. |
| [`docs/README.md`](docs/README.md) | Index of all product, architecture, spec, and dev docs. |
