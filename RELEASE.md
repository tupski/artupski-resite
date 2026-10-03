# Release Process — Artupski ReSite

This document defines how Artupski ReSite is versioned, tagged, built, and verified for release. It
is the authoritative reference for producing a distributable desktop build.

---

## 1. Versioning

Artupski ReSite follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (`MAJOR.MINOR.PATCH`).
While the MVP is pre-1.0 (`0.x.y`), the following applies:

- **MAJOR** — reserved; `1.0.0` marks the first stable release.
- **MINOR** — a new user-facing capability or a completed roadmap phase.
- **PATCH** — backwards-compatible fixes.

The version string must be **identical** in all three locations:

| # | File | Field |
| :-- | :--- | :--- |
| 1 | `package.json` | `"version"` |
| 2 | `src-tauri/tauri.conf.json` | `"version"` |
| 3 | `src-tauri/Cargo.toml` | `[package] version` |

After changing `src-tauri/Cargo.toml`, refresh the lockfile so `src-tauri/Cargo.lock` matches:

```bash
cargo update -p artupski-resite --manifest-path src-tauri/Cargo.toml
# or simply let `cargo build`/`cargo check` update the lockfile.
```

The current MVP release version is **`0.1.0`**.

---

## 2. Tag format

Release tags are annotated and use the format `v<semver>`:

```bash
git tag -a v0.1.0 -m "Artupski ReSite v0.1.0"
```

The `release.yml` workflow triggers on tags matching `v*`.

---

## 3. Artifact matrix

| Platform | Bundle target | Artifact(s) | Produced by |
| :--- | :--- | :--- | :--- |
| Windows | `nsis`, `msi` | `*.exe` (NSIS installer), `*.msi` (WiX) | `npm run tauri:build` (local or `windows-latest` CI) |
| macOS | `dmg`, `app` | `*.dmg`, `*.app` | macOS CI runner (`macos-latest`); **not** cross-built on Windows |

Artifacts are written under `src-tauri/target/release/bundle/`. The Tauri `bundle.targets` array is
declared explicitly in `src-tauri/tauri.conf.json` (`["nsis", "msi", "dmg", "app"]`); each CI job
builds only the targets valid for its OS.

**Packaged workers.** The Node workers are staged as self-contained `.js` bundles under
`src-tauri/resources/workers/` (plus a copy of the runtime `playwright-core` package), declared as
Tauri `bundle.resources`. This is what lets a packaged app locate and launch its crawler and clone
preview server (see `docs/impl-plan/phase-16-impl-plan.md` §8.2 / C1). Staging runs automatically as
part of `beforeBuildCommand`; you can also run it directly with `npm run stage-workers`.

---

## 4. Release steps

1. **Bump the version** in the three locations above (§1) and refresh `Cargo.lock`.
2. **Update `CHANGELOG.md`** with the release entry.
3. **Run the gates** locally (all must pass):

   ```bash
   npm run typecheck
   npm run lint
   npm run test
   npm run build
   cargo check --manifest-path src-tauri/Cargo.toml
   cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
   ```

4. **Build the installers**:

   ```bash
   npm run tauri:build
   ```

5. **Commit**, then create the annotated tag (§2) and push it (with a remote configured):

   ```bash
   git commit -am "chore(release): v0.1.0"
   git tag -a v0.1.0 -m "Artupski ReSite v0.1.0"
   git push origin main --follow-tags
   ```

6. **CI** (`release.yml`) builds the Windows `nsis` + `msi` and the macOS `dmg` + `app`, and attaches
   them to the GitHub release.

---

## 5. Clean-install checklist (manual verification)

The PLAN §650 verification ("install the generated desktop package on a clean environment") is a
**manual** step; it is not automatable in this environment (no clean VM). Record the result honestly.

- [ ] Install the Windows `.msi` (or `.exe`) on a machine with **Node.js `>= 20`** on `PATH` and
      **Chromium installed** via `npx playwright install chromium`.
- [ ] Launch **Artupski ReSite**; the window renders with no console errors.
- [ ] Run one scan against the local fixture (`npm run fixture:serve`, then scan
      `http://127.0.0.1:9099/blueprint`).
- [ ] Confirm the crawl completes and pages/technologies persist.
- [ ] Generate a Blueprint, synthesize components, generate a project, and export a ZIP.
- [ ] Confirm `dist/index.html` is produced by the generated project's own `npm run build`.
- [ ] Confirm the crawler works in the packaged app — i.e. the packaged worker resolves (this is the
      C1 verification; a failure here means `bundle.resources` staging is broken).

The `RUN_DESKTOP_E2E=1` gate is documented in `docs/dev/TESTING.md` §5.14 for the optional
packaged-shell smoke; it is not wired to an automated runner in this environment.

---

## 6. Code signing (out of scope for the MVP)

Local and CI artifacts are **unsigned**. Unsigned installers may trigger OS SmartScreen/Gatekeeper
warnings (the PLAN §649 risk). Production signing is a release-time step that requires platform
credentials and is deliberately not configured here:

- **Windows** — Authenticode code-signing certificate (EV or OV) via `signtool`.
- **macOS** — an Apple Developer ID certificate + `codesign` and `notarytool` notarization.

When signing is added, wire the credentials through CI secrets and set the relevant Tauri signing
configuration; do **not** commit any certificate or password.

---

## 7. Updater artifacts

`createUpdaterArtifacts` is `false`. The MVP ships no auto-updater; this is stated explicitly rather
than left implicit. Enabling it later requires an updater signing key and a hosting endpoint.
