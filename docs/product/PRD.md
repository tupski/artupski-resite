# Product Requirements Document (PRD) - Artupski ReSite

## 1. Problem Statement
Modern website reverse-engineering requires capturing live sites (HTML, CSS, JS, assets, authenticated pages, responsive layouts) and converting raw assets into structured, maintainable technical blueprints and full-stack software projects. Existing tools only extract static HTML dumps or simple screenshots without analyzing tech stacks, extracting component hierarchies, or generating production-ready target code.

Artupski ReSite solves this by providing automated URL scanning, authentication session handling, tech stack detection, responsive layout analysis, blueprint generation, static cloning, visual verification, and AI-driven full-stack project generation.

---

## 2. Target User Personas & Use Cases

### Personas
1. **Full-Stack Developer**: Needs to re-implement legacy web applications or client sites into modern tech stacks (React, Next.js, Vue, Tailwind).
2. **UI/UX Engineer**: Analyzes existing responsive web interfaces to convert designs into clean component architectures.
3. **Agency / Freelancer**: Rapidly prototypes and bootstraps client projects derived from existing live references.

### Primary Use Cases
- Reverse-engineer legacy or unmaintained websites into clean TypeScript/React codebases.
- Capture authenticated user sessions (dashboards, settings pages) behind login forms for analysis.
- Extract responsive breakpoints and design tokens (colors, typography, spacing).
- Generate standardized project documentation and AI-executable build blueprints.

---

## 3. Core User Journey
1. **URL Entry**: User provides target URL and scan parameters.
2. **Scan**: Playwright launches headless browser to crawl DOM, network requests, scripts, and media.
3. **Auth (If Required)**: User supplies login credentials or session tokens; Playwright handles form auth or cookie injection.
4. **Tech Detection**: Scanner inspects script tags, headers, global JS variables, CSS classes, and metadata.
5. **Responsive Analysis**: Multi-viewport rendering captures layout state across Mobile, Tablet, Desktop.
6. **Blueprint Generation**: AI Engine constructs normalized site representation (routes, components, state, data structures).
7. **Static Clone**: Raw HTML/CSS/JS and asset bundle downloaded and stored locally.
8. **Visual Verification**: Visual diff comparison between live capture and target rendering.
9. **Stack Selection**: User selects target framework (e.g., React + Tailwind + Vite).
10. **Project Documentation**: Auto-generation of project architecture specs and setup guides.
11. **Code Generation**: AI engine generates modular project source code.

---

## 4. MVP vs Future Scope

### MVP Scope (Phase 0 - Phase 16)
- Local desktop application (Tauri 2 + React + TS).
- Single-page and multi-page crawler via Playwright.
- Session & cookie authentication capture.
- Framework, library, and asset detection engine.
- Responsive layout snapshot engine.
- SQLite local database storage.
- Standard blueprint JSON generation.
- Full-stack target code generation (Vite + React + TS + Tailwind).
- Local AI Provider abstraction (OpenAI API compliant REST endpoints).

### Post-MVP (Future Scope)
- **Admin Generator & Management**: Automated admin panel scaffolding, backend DB schema migration from scanned UI tables, live RBAC mapping, and dynamic admin dashboard code generation.
- Cloud team workspace sync and remote storage.
- Automated API mock server generation from network traffic traces.

---

## 5. Agent Operational Directives & Skill Constraints
- **Frontend Implementation Skill Rule**: Any frontend implementation agent MUST read `C:\Users\Kakarama Room\.agents\skills\anti-ui-slop\SKILL.md` before writing UI components or frontend code for generated applications or the desktop interface itself.
