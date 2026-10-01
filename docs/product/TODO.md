# Project Backlog & Technical Debt Tracking (TODO.md)

## 1. Technical Debt & Immediate Refinements

- [ ] **Dynamic CSS Scope Isolation**: Improve handling of overlapping global CSS declarations when re-bundling multi-page static clones into unified single-page bundles.
- [ ] **Canvas / WebGL Vector Capture**: Currently, canvas elements are captured as static bitmap snapshot renders. Investigate AST capture of Canvas rendering contexts for vector SVG reconstruction.
- [ ] **Large DOM Virtualization in Blueprint Inspector**: Ensure tree inspector renders 10,000+ DOM nodes without dropping below 60fps using `@tanstack/react-virtual`.
- [ ] **SQLite WAL Checkpointing**: Implement automated DB maintenance thread to execute `PRAGMA wal_checkpoint(TRUNCATE)` on application shutdown to prevent unbounded WAL file growth.

---

## 2. Unresolved Design Decisions

- [ ] **Decoupled Playwright Runtime Distribution**:
  - *Current Design*: Bundled Playwright node worker requiring `npx playwright install chromium`.
  - *Open Question*: Should desktop installer bundle a standalone pre-packaged Chromium binary, or prompt user to download on first run to keep initial download size under 50MB?
- [ ] **Tauri Keyring Fallback on Headless Linux**:
  - *Issue*: Some Linux developer setups lack active DBus SecretService daemon (`gnome-keyring`).
  - *Decision Needed*: Specify fallback encrypted file store using user-prompted master password.
- [ ] **Local LLM Integration (Ollama / llama.cpp)**:
  - *Open Question*: Should Artupski ReSite bundle an optional local inference adapter for users with high-VRAM GPUs wanting 100% offline blueprint synthesis?

---

## 3. Post-MVP Feature Roadmap

### Phase 18: Advanced Interactive Animation Extraction
- Capture CSS keyframe animations and Framer Motion spring physics definitions from crawled target sites.
- Output high-fidelity Tailwind animation classes and Framer Motion motion primitives in generated React projects.

### Phase 19: Full-Stack Code Generation (Next.js 14 App Router)
- Expand Project Generator beyond single-page Vite React apps to support Next.js 14 App Router, Server Components, and API route scaffolding.

### Phase 20: Figma & Penpot Export Bridge
- Synthesize Blueprint JSON models directly into `.fig` or Penpot vector design format for UI/UX designer handoff.

### Phase 21: Collaborative Scan Export Bundles
- Export self-contained `.artupski` archive packages (encrypted zip containing SQLite slice + local assets) for sharing scans between team members.
