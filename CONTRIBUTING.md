# Contributing Guidelines

## 1. Code of Conduct & Philosophy

Artupski ReSite is a high-performance, local-first reverse engineering desktop suite. Contributors must prioritize local data sovereignty, deterministic execution, and zero bloat.

---

## 2. Development Setup

### 2.1 Prerequisites
- Node.js: `>= 20.x LTS`
- Rust Toolchain: `stable` (`rustc >= 1.78`, `cargo`)
- OS Dependencies:
  - Windows: Visual Studio C++ Build Tools, WebView2 Runtime.
  - macOS: Xcode Command Line Tools.
  - Linux: `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`.

### 2.2 Initial Setup Commands
```bash
# Clone repository
git clone https://github.com/tupski/artupski-resite.git
cd artupski-resite

# Install frontend & worker dependencies
npm install

# Install Playwright browser binaries
npx playwright install chromium

# Launch development environment (Vite dev server + Tauri shell)
npm run tauri:dev
```

---

## 3. Repository Conventions & Code Style

- Language: Strict TypeScript across frontend, workers, and Node helpers. Idiomatic Rust in `src-tauri`.
- Styling: Tailwind CSS v3. All UI components MUST adhere to the frontend standards specified in `anti-ui-slop`.
- Linting & Formatting:
  - ESLint with `@typescript-eslint/recommended` and `eslint-plugin-react-hooks`.
  - Prettier for formatting (2 spaces, single quotes, no trailing commas).
  - Clippy for Rust linting (`cargo clippy --all-targets -- -D warnings`).

---

## 4. Git Commit Standards (Conventional Commits)

All commits must follow the [Conventional Commits v1.0.0](https://www.conventionalcommits.org/) specification:

$$\text{Format: } <\text{type}>(<\text{scope}>): <\text{description}>$$

### Allowed Types
- `feat`: New user-facing feature.
- `fix`: Bug fix.
- `docs`: Documentation updates.
- `style`: Formatting, missing semicolons, no code change.
- `refactor`: Code refactoring without behavioral changes.
- `perf`: Performance improvements.
- `test`: Adding or correcting tests.
- `chore`: Build tooling, dependency bumps, repo maintenance.

### Examples
- `feat(scanner): add support for shadow DOM tree extraction`
- `fix(auth): handle expired cookies during authenticated crawl replay`
- `docs(api): update Blueprint JSON schema definitions`

---

## 5. Pull Request (PR) Requirements

Before opening a PR:
1. Ensure all unit and integration tests pass: `npm run test`.
2. Ensure full typecheck passes: `npm run typecheck`.
3. Ensure no lint or formatting errors: `npm run lint && cargo clippy`.
4. Keep PR scope focused to a single feature or bug fix.
5. Provide a clear PR description detailing:
   - What changed.
   - Why the change was made.
   - Manual testing steps executed.
   - Any database schema migration implications.
